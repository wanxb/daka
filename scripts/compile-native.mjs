import { existsSync, mkdtempSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Compile syntax locally with the installed official binaries; this does not claim IDE/runtime acceptance.
const root = fileURLToPath(new URL('../miniprogram/', import.meta.url));
const compilerRoot =
  process.env.WECHAT_COMPILER_ROOT ||
  'D:/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec';
const sourceFiles = readdirSync(root, { recursive: true })
  .map(String)
  .map((path) => path.replaceAll('\\', '/'));
const folder = mkdtempSync(join(tmpdir(), 'beijixing-native-'));
let failed = false;
try {
  for (const [ext, name] of [
    ['wxml', 'wcc.exe'],
    ['wxss', 'wcsc.exe'],
  ]) {
    const binary = join(compilerRoot, name);
    if (!existsSync(binary)) throw new Error('找不到微信离线编译器，请配置 WECHAT_COMPILER_ROOT。');
    const files = sourceFiles.filter((file) => file.endsWith('.' + ext)),
      output = join(folder, ext + '.js');
    const result = spawnSync(binary, ['-o', output, ...files], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      failed = true;
      process.stderr.write((result.stderr || result.stdout).slice(0, 4000));
    }
    process.stdout.write(`${ext.toUpperCase()}: ${files.length} files, exit ${result.status}\n`);
  }
} finally {
  // Only the two known outputs in our newly-created temp directory are eligible for cleanup.
  for (const ext of ['wxml', 'wxss']) rmSync(join(folder, ext + '.js'), { force: true });
  rmdirSync(folder);
}
process.exitCode = failed ? 1 : 0;
