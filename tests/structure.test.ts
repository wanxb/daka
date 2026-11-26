import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { inspectProject } from '../scripts/check-project.mjs';

/** Synthetic projects verify failures without mutating real sources or allowing tests to reach WeChat data. */
function inspect(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'daka-structure-'));
  try {
    for (const [name, contents] of Object.entries({
      'app.json': '{"pages":[]}',
      'app.ts': 'App({});',
      'app.wxss': '',
      ...files,
    })) {
      const file = resolve(directory, 'miniprogram', name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, contents);
    }
    return inspectProject(directory);
  } finally {
    // Deletion is restricted to this invocation's generated fixture directory under the OS temporary root.
    assert.ok(resolve(directory).startsWith(resolve(tmpdir(), 'daka-structure-')));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('工程检查允许纯类型互引，并沿组件配置和样式导入识别真实入口', () => {
  const result = inspect({
    'app.json': '{"pages":["pages/home/index"]}',
    'pages/home/index.ts': 'import type { A } from "../../domain/a"; Page({});',
    'pages/home/index.wxml': '<record-sheet/>',
    'pages/home/index.wxss': '@import "./calendar.wxss";',
    'pages/home/calendar.wxss': '.calendar { height:44px; }',
    'pages/home/index.json': '{"usingComponents":{"record-sheet":"../../components/sheet/index"}}',
    'components/sheet/index.ts': 'Component({});',
    'components/sheet/index.json': '{}',
    'components/sheet/index.wxml': '<view/>',
    'components/sheet/index.wxss': '',
    'domain/a.ts': 'import type { B } from "./b"; export interface A { b?: B }',
    'domain/b.ts': 'import type { A } from "./a"; export interface B { a?: A }',
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.routes, 2);
  assert.equal(result.styles, 4);
});

test('工程检查拒绝领域依赖应用命令，防止微信平台能力渗入纯领域', () => {
  const result = inspect({
    'app.ts': 'import "./domain/value"; App({});',
    'domain/value.ts': 'import "../application/service";',
    'application/service.ts': 'export const service = {};',
  });
  assert.ok(result.errors.some((error: string) => error.includes('分层依赖倒置')));
});

test('工程检查拒绝运行时循环，避免拆分后出现未初始化的导出', () => {
  const result = inspect({
    'app.ts': 'import "./domain/a"; App({});',
    'domain/a.ts': 'export { b } from "./b"; export const a = 1;',
    'domain/b.ts': 'import { a } from "./a"; export const b = a;',
  });
  assert.ok(result.errors.some((error: string) => error.includes('运行时循环依赖')));
});

test('工程检查识别悬空模块、未引用样式及丢失的图片和导入', () => {
  const result = inspect({
    'app.ts': 'import "./domain/missing"; const image = "/assets/missing.svg"; App({});',
    'app.wxss': '@import "./missing.wxss";',
    'domain/unused.ts': 'export const unused = 1;',
    'unused.wxss': '.unused { color:red; }',
  });
  for (const expected of [
    '模块不存在',
    '静态资源不存在',
    '样式文件不存在',
    '未被原生入口引用的模块',
    '未被原生入口引用的样式',
  ])
    assert.ok(
      result.errors.some((error: string) => error.includes(expected)),
      expected,
    );
});
