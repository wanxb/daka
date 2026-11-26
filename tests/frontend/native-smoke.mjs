import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// These steps dispatch native automator input/tap events; runtime stress/fault injection is logged separately.
const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.QA_REPORT || resolve(root, 'reports/frontend-20261126'));
const session = JSON.parse(readFileSync(resolve(output, 'session.json'), 'utf8'));
// Input events may create disposable drafts, so refuse production projects even if a session file is edited incorrectly.
if (!resolve(session.qaRoot).startsWith(resolve(root, '.build') + sep))
  throw new Error('只允许操作.build下的隔离项目');
writeFileSync(resolve(output, 'switch-event.json'), JSON.stringify({ value: true }));
async function call(tool, options = {}) {
  const args = [resolve(root, 'scripts/wechatide.mjs'), tool, '--project', session.qaRoot];
  for (const [key, value] of Object.entries(options)) args.push('--' + key, String(value));
  const raw = await new Promise((resolveOutput, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true, cwd: root });
    let text = '';
    child.stdout.on('data', (data) => (text += data));
    child.stderr.on('data', (data) => process.stderr.write(data));
    child.on('error', reject);
    child.on('close', () => resolveOutput(text));
  });
  const result = JSON.parse(raw);
  appendFileSync(
    resolve(output, 'native-steps.ndjson'),
    JSON.stringify({ at: new Date().toISOString(), tool, options, result }) + '\n',
  );
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.result;
}
const checks = [];
await call('automation_element_action', { action: 'tap', selector: '.add-tile' });
await call('automation_element_action', {
  action: 'input',
  selector: '#editor-name',
  value: '甲乙丙丁戊己',
  'wait-for-selector': '#editor-name',
});
const original = (
  await call('automation_page_action', { action: 'getData', 'data-path': 'form.name' })
).data;
await call('automation_element_action', {
  action: 'input',
  selector: '#editor-name',
  value: '甲新乙丙丁戊己',
});
const name = (await call('automation_page_action', { action: 'getData', 'data-path': 'form.name' }))
  .data;
checks.push({
  name: '原生输入：名称中间超限插入保留原文',
  pass: original === name,
  actual: { before: original, after: name },
});
// Native switch tap does not synthesize its change event in automator; dispatch the documented event explicitly.
await call('automation_element_action', {
  action: 'trigger',
  selector: 'switch[data-field=quantityEnabled]',
  type: 'change',
  'detail-file': resolve(output, 'switch-event.json'),
});
await call('automation_element_action', {
  action: 'input',
  selector: '#editor-quantityUnit',
  value: '甲乙丙丁',
});
await call('automation_element_action', {
  action: 'input',
  selector: '#editor-quantityUnit',
  value: '甲新乙丙丁',
});
const unit = (
  await call('automation_page_action', { action: 'getData', 'data-path': 'form.quantityUnit' })
).data;
checks.push({
  name: '原生输入：数量单位中间超限插入保留原文',
  pass: unit === '甲乙丙丁',
  actual: { before: '甲乙丙丁', after: unit },
});
await call('automation_element_action', {
  action: 'input',
  selector: '#editor-quantityMax',
  value: '100000',
});
const maximum = (
  await call('automation_page_action', { action: 'getData', 'data-path': 'form.quantityMax' })
).data;
checks.push({ name: '原生输入：超数量上限拒绝', pass: maximum === '100', actual: maximum });
await call('simulator_screenshot', {
  path: resolve(output, 'evidence/02-native-input-limits.jpg'),
});
// The next runtime case resets the disposable draft; avoid Page.callMethod's tool-specific `this` binding.
writeFileSync(resolve(output, 'native-checks.json'), JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks, null, 2));
