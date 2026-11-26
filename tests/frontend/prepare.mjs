import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Clone source, never the running user's files. A unique namespace isolates both normal IO and legacy migration.
const root = resolve(import.meta.dirname, '../..');
const runId = process.argv[2] || 'frontend-' + Date.now().toString(36);
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('运行名只允许字母、数字、短横线和下划线');
const output = resolve(root, 'reports', runId);
const qaRoot = resolve(root, '.build', runId, 'project');
if (existsSync(output) || existsSync(qaRoot))
  throw new Error('测试运行已存在，拒绝覆盖证据或复用旧数据');
mkdirSync(join(output, 'evidence'), { recursive: true });
mkdirSync(qaRoot, { recursive: true });
cpSync(resolve(root, 'miniprogram'), join(qaRoot, 'miniprogram'), { recursive: true });
const namespace = 'polaris-qa-' + runId;
const driver = join(qaRoot, 'miniprogram/infrastructure/wechat-files.ts');
const source = readFileSync(driver, 'utf8');
if (!source.includes("'/polaris") || !source.includes("'/yugong"))
  throw new Error('存储结构已变化，需重新审核隔离规则');
writeFileSync(
  driver,
  source
    .replaceAll("'/polaris", "'/" + namespace)
    .replaceAll("'/yugong", "'/" + namespace + '-legacy'),
);
copyFileSync(resolve(root, 'tests/frontend/runtime-harness.ts'), join(qaRoot, 'miniprogram/qa.ts'));
writeFileSync(
  join(qaRoot, 'miniprogram/app.ts'),
  "/** Isolated QA entry; never copy this instrumentation into production. */\nimport { qa } from './qa';\nApp({ qa });\n",
);
const config = JSON.parse(readFileSync(resolve(root, 'project.config.json'), 'utf8'));
config.projectname = '北极星打卡-隔离测试';
writeFileSync(join(qaRoot, 'project.config.json'), JSON.stringify(config, null, 2));
if (existsSync(resolve(root, 'project.private.config.json')))
  copyFileSync(
    resolve(root, 'project.private.config.json'),
    join(qaRoot, 'project.private.config.json'),
  );
writeFileSync(
  join(output, 'session.json'),
  JSON.stringify(
    {
      runId,
      qaRoot,
      namespace,
      source: root,
      startedAt: new Date().toISOString(),
      instrumentation: ['隔离存储命名空间（包含迁移路径）', '仅测试副本App挂载qa入口'],
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ qaRoot, report: output, QA_REPORT: output }, null, 2));
