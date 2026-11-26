import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Each case resets only the guarded QA namespace. Keep scenarios sequential so fault injection never overlaps another write.
const root = resolve(import.meta.dirname, '../..');
if (!process.env.QA_REPORT) throw new Error('请显式设置QA_REPORT，禁止覆盖前次测试证据');
const log = resolve(process.env.QA_REPORT, 'suite-output.txt');
const cases = [
  'bootstrap',
  'configInputs',
  'recordInputs',
  'timeUnits',
  'cancelAndRace',
  'rapidSubmit',
  'fuzz',
  'uncertainWrites',
  'quota',
  'staleSessions',
  'arrangement',
  'distinctConcurrency',
  'writeFailure',
  'legacy',
  'projectCapacity',
  'lateEvents',
  { case: 'pressure', records: 1000, projects: 10 },
  { case: 'pressure', records: 10000, projects: 15 },
  { case: 'pressure', records: 50000, projects: 15 },
];
// Resume only at an explicit known case after inspecting a failure; completed earlier evidence remains in the report.
const from = process.argv[2];
const start = from
  ? cases.findIndex((item) => (typeof item === 'string' ? item : item.case) === from)
  : 0;
if (start < 0) throw new Error('未知起始场景');
for (const item of cases.slice(start)) {
  const input = typeof item === 'string' ? { case: item } : item;
  process.stdout.write(`开始 ${JSON.stringify(input)}\n`);
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'tests/frontend/run-case.mjs'), JSON.stringify(input)],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: process.env,
    },
  );
  appendFileSync(log, JSON.stringify(input) + '\n' + result.stdout + result.stderr + '\n');
  process.stdout.write(result.stdout);
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exitCode = result.status || 1;
    break;
  }
}
