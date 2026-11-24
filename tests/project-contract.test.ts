import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const readJson = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));

// Guard the package boundary: reviewed browser fixtures must never enter the business bundle.
test('正式源码根独立，所有路由与公共组件文件齐全', () => {
  const project = readJson('project.config.json');
  assert.equal(project.miniprogramRoot, 'miniprogram/');
  const app = readJson('miniprogram/app.json');
  assert.equal(app.renderer, 'webview');
  assert.equal(app.window.navigationStyle, 'custom');
  assert.equal(app.tabBar, undefined);
  assert.equal(app.pages.length, 3);
  for (const route of [...app.pages, 'components/app-navigation/index']) {
    for (const ext of ['ts', 'json', 'wxml', 'wxss']) {
      assert.ok(existsSync(resolve(root, 'miniprogram', `${route}.${ext}`)), `${route}.${ext}`);
    }
  }
  assert.ok(!existsSync(resolve(root, project.miniprogramRoot, 'prototype')));
  assert.deepEqual(readJson('miniprogram/sitemap.json').rules, [{ action: 'disallow', page: '*' }]);
});

// Runtime dependencies and emitted JS are intentionally absent; the IDE compiles native TS.
test('依赖精确锁定，源码中不混入生成的 JavaScript', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(String(version), /^\d+\.\d+\.\d+$/u);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
  }
  const files = readdirSync(resolve(root, 'miniprogram'), { recursive: true });
  assert.ok(!files.some((file) => String(file).endsWith('.js')));
});

// A zero process status must not turn an explicit CLI authorization failure into a successful check.
test(
  '微信CLI失败或等待授权时，快捷任务不会误判为就绪',
  { skip: process.platform !== 'win32' },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'yugong-cli-')),
      file = join(directory, 'fake.cmd');
    try {
      for (const [payload, status] of [
        [{ ok: false, message: 'authorization timeout' }, 1],
        [{ ok: true, result: { status: 'pending' } }, 2],
      ] as const) {
        writeFileSync(file, '@echo off\r\necho ' + JSON.stringify(payload) + '\r\nexit /b 0\r\n');
        const result = spawnSync(
          process.execPath,
          [resolve(root, 'scripts/wechatide.mjs'), 'check_wechatide_status'],
          { env: { ...process.env, WECHATIDE_CLI: file }, encoding: 'utf8', windowsHide: true },
        );
        assert.equal(result.status, status);
        assert.deepEqual(JSON.parse(result.stdout), payload);
      }
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  },
);
