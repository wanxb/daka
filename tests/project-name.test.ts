import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptProjectNameDraft,
  projectNameLength,
  textLength,
} from '../miniprogram/domain/input-limits';
import { initialForm, makeProject } from '../miniprogram/domain/model';

/** Keyboard emoji sequences must consume one visible slot regardless of UTF-16 or component count. */
test('名称按完整Emoji计数：家庭、肤色职业、旗帜、键帽、变体和标签旗均不拆开', () => {
  const england = String.fromCodePoint(
    0x1f3f4,
    0xe0067,
    0xe0062,
    0xe0065,
    0xe006e,
    0xe0067,
    0xe007f,
  );
  for (const emoji of ['😀', '👨‍👩‍👧‍👦', '👩🏽‍💻', '🇨🇳', '1️⃣', '#️⃣', '🏳️‍🌈', '❤️', england]) {
    assert.equal(projectNameLength(emoji), 1, emoji);
    assert.equal(projectNameLength(emoji.repeat(6)), 6, emoji);
    assert.equal(acceptProjectNameDraft(emoji.repeat(6), ''), true);
    const form = { ...initialForm(), name: emoji.repeat(6) };
    assert.equal(makeProject(form, 0).name, form.name);
    assert.equal(acceptProjectNameDraft(emoji.repeat(7), form.name), false);
    assert.throws(() => makeProject({ ...form, name: emoji.repeat(7) }, 0));
  }
  assert.equal(projectNameLength('一二三四五六'), 6);
  // This fix is specific to names; note counters and search retain their existing code-point limits.
  assert.equal(textLength('👨‍👩‍👧‍👦'), 7);
});

/** Editing in the middle may replace a whole symbol, but an oversized insertion cannot remove the old suffix. */
test('名称混排、删除、替换与超限粘贴使用同一边界，ZWJ不能把任意文字连成一个字绕过上限', () => {
  const before = '阅读👩🏽‍💻🇨🇳1️⃣动';
  assert.equal(projectNameLength(before), 6);
  assert.equal(acceptProjectNameDraft('阅👨‍👩‍👧‍👦👩🏽‍💻🇨🇳1️⃣动', before), true);
  assert.equal(acceptProjectNameDraft('阅新读👩🏽‍💻🇨🇳1️⃣动', before), false);
  assert.equal(acceptProjectNameDraft('阅读🇨🇳1️⃣动', before), true);
  assert.equal(acceptProjectNameDraft('', before), true);
  assert.ok(projectNameLength('一‍二‍三‍四‍五‍六‍七') > 6);
});
