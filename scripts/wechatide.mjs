import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep the CLI path overridable without changing shared scripts or reading IDE credentials.
const cli = process.env.WECHATIDE_CLI || 'D:/Tencent/微信web开发者工具/wechatide.cmd';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const projectIndex = args.indexOf('--project');
if (projectIndex >= 0 && args[projectIndex + 1]) {
  args[projectIndex + 1] = resolve(root, args[projectIndex + 1]);
}
if (!existsSync(cli)) {
  throw new Error('找不到微信 CLI，请将 WECHATIDE_CLI 设置为 wechatide 的绝对路径。');
}

// Windows .cmd requires a shell; reject metacharacters before entering that boundary.
const safeArgs = ['-c', 'Codex', ...args];
if ([cli, ...safeArgs].some((arg) => /["%&|<>^!\r\n]/u.test(arg))) {
  throw new Error('CLI 参数包含不支持的 shell 字符，请使用直接 CLI 调用。');
}
const child = spawn(
  `"${cli}"`,
  safeArgs.map((arg) => `"${arg}"`),
  {
    cwd: root,
    shell: true,
    stdio: ['inherit', 'pipe', 'inherit'],
    windowsHide: true,
  },
);
// The IDE CLI can encode ok:false while exiting 0. Preserve its JSON and expose a truthful shell status.
let output = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  output = (output + chunk).slice(-4 * 1024 * 1024);
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('close', (code) => {
  process.exitCode = code ?? 1;
  if (code === 0) {
    try {
      if (JSON.parse(output.trim()).ok === false) process.exitCode = 1;
    } catch {
      /* Non-JSON help output keeps the native process status. */
    }
  }
});
