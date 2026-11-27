import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import {
  type Color,
  colorOptions,
  projectIcons,
  iconNames,
  iconTones,
} from '../miniprogram/domain/appearance';
import { appearanceChoices, iconSource } from '../miniprogram/application/appearance';
import { initialForm, makeProject, projectForm } from '../miniprogram/domain/model';

/** Distinct purposes should not turn into repeated silhouettes; saved IDs remain readable without duplicate assets. */
test('15个打卡图标用途独立，旧人形和钢琴标识映射到当前选项', () => {
  const config = JSON.parse(
    readFileSync(new URL('../shared/project-appearance.json', import.meta.url), 'utf8'),
  );
  assert.equal(
    new Set(config.projectIcons.map((item: { source: string }) => item.source)).size,
    15,
  );
  assert.equal(new Set(projectIcons.map((item) => item.id)).size, 15);
  assert.ok(
    config.projectIcons.every((item: { source: string }) => !item.source.startsWith('person-')),
  );
  for (const [old, current] of [
    ['rope', 'run'],
    ['walk', 'run'],
    ['piano', 'music'],
  ]) {
    const project = makeProject({ ...initialForm(), name: '练习', icon: old }, Date.now());
    assert.equal(projectForm(project).icon, current);
    assert.equal(project.icon, old);
    assert.equal(iconSource(old, 'white'), iconSource(current, 'white'));
    assert.ok(
      appearanceChoices({ color: 'purple', icon: old }, false).icons.some(
        (item) => item.id === current,
      ),
    );
    assert.ok(
      !existsSync(new URL(`../miniprogram/assets/icons/white/${old}.svg`, import.meta.url)),
    );
  }
});

/** Protect finite choice counts, retained selection and path coverage rather than snapshots of SVG implementation. */
test('外观折叠不丢失扩展选项，也不修改原始配置', () => {
  const form = { ...initialForm(), color: 'brown' as const, icon: 'art' };
  const before = structuredClone(form);
  const closed = appearanceChoices(form, false);
  assert.equal(closed.colors.length, 5);
  assert.equal(closed.icons.length, 5);
  assert.equal(closed.colors[4].id, 'brown');
  assert.equal(closed.icons[4].id, 'art');
  assert.equal(appearanceChoices(form, true).colors.length, 10);
  assert.equal(appearanceChoices(form, true).icons.length, 15);
  assert.equal(appearanceChoices({ color: 'purple', icon: 'book' }, false).icons[4].id, 'target');
  assert.deepEqual(form, before);
  assert.equal(projectIcons[4].id, 'target');
});

/** Every accepted preset must have the actual local asset needed by cards, choosers and period controls. */
test('所有可保存外观和界面图标均有本地Regular资源，卡片白字对比度达标', () => {
  const shared = JSON.parse(
    readFileSync(new URL('../shared/project-appearance.json', import.meta.url), 'utf8'),
  );
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const color of shared.colors) {
    for (const hex of [color.start, color.end])
      assert.ok(1.05 / (luminance(hex) + 0.05) >= 4.5, color.id + ':' + hex);
  }
  for (const [index, icon] of projectIcons.entries()) {
    const color = colorOptions[index % colorOptions.length];
    const p = makeProject(
      { ...initialForm(), name: '练习', color: color.id as Color, icon: icon.id },
      Date.now(),
    );
    assert.equal(p.icon, icon.id);
  }
  const expected: string[] = [];
  for (const icon of iconNames) {
    for (const tone of iconTones[icon]) {
      expected.push(`${tone}/${icon}.svg`);
      const svg = readFileSync(
        new URL(`../miniprogram/assets/icons/${tone}/${icon}.svg`, import.meta.url),
        'utf8',
      );
      assert.match(svg, /viewBox="0 0 256 256"/);
      assert.doesNotMatch(svg, /currentColor|stroke-width="1\.8"|<script|foreignObject/);
      assert.equal(iconSource(icon, tone), `/assets/icons/${tone}/${icon}.svg`);
    }
  }
  // Exact directory equality catches stale files, including obsolete names and unreferenced color copies.
  const actual = readdirSync(new URL('../miniprogram/assets/icons/', import.meta.url), {
    recursive: true,
  })
    .map(String)
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.replaceAll('\\', '/'));
  assert.deepEqual(actual.sort(), expected.sort());
  // The approved share/export control joins the existing local Phosphor vocabulary.
  assert.equal(iconNames.length, 28);
  const source = JSON.parse(
    readFileSync(new URL('../shared/phosphor-regular.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    Object.keys(source.icons).sort(),
    [
      ...new Set([
        ...shared.projectIcons.map((item: { source: string }) => item.source),
        ...Object.values(shared.controls),
      ]),
    ].sort(),
  );
  assert.ok(!existsSync(new URL('../prototype/icon-libraries/catalog.js', import.meta.url)));
  for (const [name, tone] of [
    ['../escape', 'white'],
    ['clock', 'brown'],
    ['check', 'ink'],
    ['__proto__', '../escape'],
  ]) {
    const path = iconSource(name, tone);
    assert.ok(existsSync(new URL('../miniprogram' + path, import.meta.url)), path);
  }
  for (const color of colorOptions) {
    for (const icon of [...projectIcons.map((item) => item.id), 'back', 'chevron'])
      assert.ok(
        existsSync(new URL(`../miniprogram/assets/icons/${color.id}/${icon}.svg`, import.meta.url)),
        color.id + ':' + icon,
      );
  }
  assert.throws(() =>
    makeProject({ ...initialForm(), name: '练习', icon: '../external' }, Date.now()),
  );
});
