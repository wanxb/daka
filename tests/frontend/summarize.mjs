import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Count the latest completed run per scenario; keep earlier failed/tool runs in raw evidence and disclose their count.
const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.QA_REPORT || resolve(root, 'reports/frontend-20261126'));
const rows = readFileSync(resolve(output, 'results.ndjson'), 'utf8')
  .trim()
  .split('\n')
  .map(JSON.parse);
const latest = new Map();
for (const row of rows) {
  const result = row.result?.result?.result?.result;
  if (!result || result.exception || ['finish', 'reproUncertain'].includes(result.case)) continue;
  const key =
    result.case === 'pressure'
      ? `pressure-${row.input.records}-${row.input.projects}`
      : result.case;
  latest.set(key, { key, input: row.input, at: row.at, ...result });
}
const core = [...latest.values()];
const native = JSON.parse(readFileSync(resolve(output, 'native-checks.json'), 'utf8'));
// New suites run lateEvents as a normal case; retain compatibility with the original separate evidence file.
const late = existsSync(resolve(output, 'late-events.json'))
  ? JSON.parse(readFileSync(resolve(output, 'late-events.json'), 'utf8')).result.result.result
      .result
  : { checks: [] };
const allChecks = [...core.flatMap((result) => result.checks), ...native, ...late.checks];
const summary = {
  at: new Date().toISOString(),
  scenarioCount: core.length,
  runtimeAssertions: core.reduce((sum, result) => sum + result.checks.length, 0),
  nativeAssertions: native.length,
  lateEventAssertions: late.checks.length,
  totalAssertions: allChecks.length,
  passed: allChecks.filter((check) => check.pass).length,
  failed: allChecks.filter((check) => !check.pass).length,
  failedChecks: allChecks.filter((check) => !check.pass),
  earlierFailedRuns: rows.filter((row) => {
    const result = row.result?.result?.result?.result;
    return result && (result.exception || result.checks?.some((check) => !check.pass));
  }).length,
  scenarios: core,
  pressure: core
    .filter((result) => result.case === 'pressure')
    .map((result) => ({ ...result.data, caseElapsedMs: result.elapsedMs })),
  excludedToolOrIncompleteRows: rows.filter(
    (row) =>
      row.toolError ||
      !row.result?.result?.result?.result ||
      row.result.result.result.result.exception,
  ).length,
};
writeFileSync(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
const titles = {
  bootstrap: '首次初始化',
  configInputs: '配置边界/草稿',
  recordInputs: '记录输入边界',
  timeUnits: '三种时间单位',
  cancelAndRace: '取消/迟到保存',
  rapidSubmit: '重复提交',
  fuzz: '异常输入暴力注入',
  uncertainWrites: '写后回调丢失',
  quota: '配额不足',
  staleSessions: '修订/删除冲突',
  arrangement: '整理/排序',
  distinctConcurrency: '独立命令并发',
  writeFailure: '写前失败',
  legacy: '历史兼容',
  projectCapacity: '项目上限/并发创建/旧超额兼容',
  lateEvents: '关闭后迟到组件事件注入',
};
const matrix = [
  '# 实测场景矩阵',
  '',
  '这里只统计完成并回收结果的场景。原生事件与控制器/故障注入的区分见问题清单；重复复现不重复计入断言。',
  '',
  '| 场景 | 断言数 | 通过 | 失败 | 场景耗时ms（含准备/导航） |',
  '|---|---:|---:|---:|---:|',
  ...core.map(
    (result) =>
      `| ${titles[result.case] || result.key} | ${result.checks.length} | ${result.checks.filter((c) => c.pass).length} | ${result.checks.filter((c) => !c.pass).length} | ${result.elapsedMs} |`,
  ),
  `| Automator原生输入事件 | ${native.length} | ${native.filter((c) => c.pass).length} | ${native.filter((c) => !c.pass).length} | — |`,
  `| 关闭后迟到组件事件注入 | ${late.checks.length} | ${late.checks.filter((c) => c.pass).length} | ${late.checks.filter((c) => !c.pass).length} | — |`,
  '',
  `合计${summary.totalAssertions}项断言，${summary.passed}项通过，${summary.failed}项失败。失败断言按共同缺陷归并；性能告警单独记录，不能以数据正确断言通过代替响应体验通过。`,
  '',
];
writeFileSync(resolve(output, '场景矩阵.md'), matrix.join('\n'));
console.log(
  JSON.stringify(
    {
      scenarios: summary.scenarioCount,
      total: summary.totalAssertions,
      passed: summary.passed,
      failed: summary.failed,
      pressure: summary.pressure,
    },
    null,
    2,
  ),
);
