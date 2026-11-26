import { readFile, mkdir, writeFile, copyFile, readdir, unlink, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format } from 'prettier';

// One checked-in palette and SVG source owns both runtimes; generation never fetches network resources.
const root = resolve(import.meta.dirname, '..');
const formatting = JSON.parse(await readFile(resolve(root, '.prettierrc.json'), 'utf8'));
const config = JSON.parse(await readFile(resolve(root, 'shared/project-appearance.json'), 'utf8'));
const source = JSON.parse(await readFile(resolve(root, 'shared/phosphor-regular.json'), 'utf8'));
const projectNames = config.projectIcons.map((item) => item.id);
const mappings = {
  ...Object.fromEntries(config.projectIcons.map((item) => [item.id, item.source])),
  ...config.controls,
};
// Expand the finite project/color expressions used by WXML; unknown expressions fail instead of omitting assets.
const nativeRoot = resolve(root, 'miniprogram');
const iconTones = {};
for (const file of await readdir(nativeRoot, { recursive: true })) {
  if (!file.endsWith('.wxml')) continue;
  const markup = await readFile(resolve(nativeRoot, file), 'utf8');
  for (const [tag] of markup.matchAll(/<ui-icon\b[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(tag)?.[1];
    const tone = /\btone="([^"]+)"/.exec(tag)?.[1] || 'muted';
    const names = ['{{form.icon}}', '{{project.icon}}', '{{item.icon}}', '{{item.id}}'].includes(
      name,
    )
      ? projectNames
      : [name];
    const tones =
      tone === '{{project.color}}'
        ? config.colors.map((item) => item.id)
        : tone === "{{form.icon === item.id?form.color:'muted'}}"
          ? [...config.colors.map((item) => item.id), 'muted']
          : [tone];
    for (const id of names) {
      if (!Object.hasOwn(mappings, id)) throw new Error(`未识别的图标引用：${file} ${name}`);
      for (const color of tones) {
        if (
          ![
            'white',
            'ink',
            'muted',
            'accent',
            'navigation',
            ...config.colors.map((item) => item.id),
          ].includes(color)
        )
          throw new Error(`未识别的图标颜色：${file} ${tone}`);
        (iconTones[id] ||= new Set()).add(color);
      }
    }
  }
}
// Unknown persisted IDs resolve to this real local glyph, so fallback does not require an unused ink family.
(iconTones.target ||= new Set()).add('muted');
for (const id of Object.keys(mappings)) {
  if (!iconTones[id]) throw new Error(`配置中包含未使用图标：${id}`);
}
const usage = Object.fromEntries(
  Object.entries(iconTones).map(([id, tones]) => [id, [...tones].sort()]),
);
const icons = Object.fromEntries(
  Object.entries(mappings).map(([id, name]) => {
    const entry = source.icons[name];
    if (!entry || /<(?:script|foreignObject)|\bon\w+=|(?:href|url)\s*[=(]/i.test(entry.body))
      throw new Error(`图标资源缺失或包含外部内容：${name}`);
    return [
      id,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${entry.width || source.width} ${entry.height || source.height}" aria-hidden="true">${entry.body}</svg>`,
    ];
  }),
);
const palettes = Object.fromEntries(config.colors.map((item) => [item.id, item.start]));
const browser = {
  palettes: Object.fromEntries(
    config.colors.map((item) => [item.id, { start: item.start, end: item.end, name: item.label }]),
  ),
  projectIcons: config.projectIcons,
  projectIconAliases: config.projectIconAliases || {},
  icons,
};
await writeFile(
  resolve(root, 'prototype/appearance.js'),
  '// Generated local Phosphor Regular geometry; preserve native viewBoxes and weights.\nwindow.DAKA_APPEARANCE = ' +
    JSON.stringify(browser) +
    ';\n',
);
await writeFile(
  resolve(root, 'miniprogram/domain/appearance.ts'),
  await format(
    `/** Generated presets keep renderer assets, validation and the browser prototype in sync. */
export const palettes = ${JSON.stringify(palettes, null, 2)} as const;
export type Color = keyof typeof palettes;
export const colorOptions = ${JSON.stringify(
      config.colors.map((item) => ({ id: item.id, label: item.label, color: item.start })),
      null,
      2,
    )};
export const projectIcons = ${JSON.stringify(
      config.projectIcons.map(({ id, label }) => ({ id, label })),
      null,
      2,
    )};
export const iconNames = ${JSON.stringify(Object.keys(icons))};
export const iconTones: Record<string, string[]> = ${JSON.stringify(usage)};
export const projectIconAliases: Record<string, string> = ${JSON.stringify(config.projectIconAliases || {})};
/** Legacy project/draft IDs resolve without duplicate chooser entries or unused SVG copies. */
export function resolveProjectIcon(name: string): string {
  return Object.prototype.hasOwnProperty.call(projectIconAliases, name) ? projectIconAliases[name] : name;
}
`,
    { ...formatting, parser: 'typescript' },
  ),
);
await writeFile(
  resolve(root, 'miniprogram/appearance.wxss'),
  await format(
    '/* Generated palette stops are shared by cards, previews and accent controls. */\n' +
      config.colors
        .map((item) => `.${item.id} { --card-start: ${item.start}; --card-end: ${item.end}; }`)
        .join('\n') +
      '\n',
    { ...formatting, parser: 'css' },
  ),
);
const tones = {
  white: '#ffffff',
  ink: '#1c1c1e',
  muted: '#6b6b73',
  accent: palettes.purple,
  ...palettes,
  navigation: '#285cdd',
};
let count = 0;
const expected = new Set();
for (const [tone, color] of Object.entries(tones)) {
  const folder = resolve(root, 'miniprogram/assets/icons', tone);
  await mkdir(folder, { recursive: true });
  for (const [name, svg] of Object.entries(icons)) {
    // Emit only pairs reached by static controls or finite dynamic chooser/period expressions.
    if (!usage[name].includes(tone)) continue;
    expected.add(resolve(folder, name + '.svg'));
    await writeFile(
      resolve(folder, name + '.svg'),
      '<!-- Phosphor Icons Regular, MIT; see ../LICENSE-Phosphor.txt. Generated: do not edit. -->\n' +
        svg.replaceAll('currentColor', color) +
        '\n',
    );
    count++;
  }
}
// Prune only SVGs in the dedicated generated directory, after every reference and source has been validated.
const assetRoot = resolve(root, 'miniprogram/assets/icons');
for (const relative of await readdir(assetRoot, { recursive: true })) {
  const path = resolve(assetRoot, relative);
  if (relative.endsWith('.svg') && !expected.has(path)) await unlink(path);
}
for (const entry of await readdir(assetRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && (await readdir(resolve(assetRoot, entry.name))).length === 0)
    await rmdir(resolve(assetRoot, entry.name));
}
await copyFile(
  resolve(root, 'shared/LICENSE-Phosphor.txt'),
  resolve(root, 'miniprogram/assets/icons/LICENSE-Phosphor.txt'),
);
await writeFile(
  resolve(root, 'miniprogram/assets/icons/sources.json'),
  await format(
    JSON.stringify(
      {
        library: 'Phosphor Regular',
        source: source.source,
        license: 'MIT',
        mapping: mappings,
        usage,
      },
      null,
      2,
    ),
    { ...formatting, parser: 'json' },
  ),
);
console.log(
  `已生成 ${Object.keys(icons).length} 个Phosphor Regular图标，${count} 个本地色彩资源，${config.colors.length}色/${projectNames.length}项目图标。`,
);
