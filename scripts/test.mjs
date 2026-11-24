import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Enumerate tests ourselves because Windows cmd does not expand shell globs like POSIX shells.
const root = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(new URL('../tests/', import.meta.url))
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => fileURLToPath(new URL(`../tests/${file}`, import.meta.url)));
if (files.length === 0) throw new Error('没有发现测试文件。');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
