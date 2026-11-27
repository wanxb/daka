import assert from 'node:assert/strict';
import test from 'node:test';
import { createCelebration } from '../miniprogram/application/celebration';
import {
  celebrationEmojiPool,
  createEmojiBurst,
} from '../miniprogram/application/celebration-emoji';
import { createCelebrationSequence } from '../miniprogram/application/celebration-sequence';

const rect = { left: 16, top: 180, width: 170, height: 180 };

// Sequence state belongs to a page, never records; a rejected measurement must not consume the next visual turn.
test('成功反馈彩纸与Emoji交替，实例隔离，无效测量不推进，控制器不改写彩纸轨迹', () => {
  const sequence = createCelebrationSequence();
  assert.equal(sequence.next({ ...rect, width: 0 }, 'purple', 1, 390), null);
  const paper = sequence.next(rect, 'purple', 42, 390)!;
  assert.equal(paper.kind, 'paper');
  assert.deepEqual(paper.papers, createCelebration(rect, 'purple', 42)!.papers);
  assert.deepEqual(paper.emojis, []);
  for (const width of [NaN, 0, -1, 100])
    assert.equal(sequence.next(rect, 'purple', 43, width), null);
  const emoji = sequence.next(rect, 'purple', 43, 390)!;
  assert.equal(emoji.kind, 'emoji');
  assert.equal(emoji.emojis.length, 16);
  assert.deepEqual(emoji.papers, []);
  assert.equal(sequence.next(rect, 'purple', 44, 390)!.kind, 'paper');
  const nextEmoji = sequence.next(rect, 'purple', 45, 390)!;
  const previous = new Set(emoji.emojis.map((item) => item.text));
  assert.ok(nextEmoji.emojis.filter((item) => !previous.has(item.text)).length >= 8);
  assert.equal(createCelebrationSequence().next(rect, 'purple', 1, 390)!.kind, 'paper');
});

// Sample full native trajectories, including partial entrance and late fade, rather than only initial/end poses.
test('Emoji每轮16个且相邻至少换8种，左右卡片全过程居中，轨迹有限且桥接负载有界', () => {
  assert.equal(new Set(celebrationEmojiPool).size, 32);
  for (const left of [16, 204]) {
    let previous: string[] = [];
    for (let seed = 0; seed < 20; seed++) {
      const card = { ...rect, left };
      const burst = createEmojiBurst(card, 390, seed, previous);
      assert.deepEqual(burst, createEmojiBurst(card, 390, seed, previous));
      const text = burst.map((item) => item.text);
      assert.equal(new Set(text).size, 16);
      assert.ok(text.filter((item) => !previous.includes(item)).length >= 8);
      assert.ok(text.every((item) => (celebrationEmojiPool as readonly string[]).includes(item)));
      assert.ok(JSON.stringify(burst).length < 150000);
      for (let frame = 0; frame <= 40; frame++) {
        const poses = burst.map((item) => {
          assert.doesNotMatch(item.style, /NaN|Infinity|undefined/);
          const match = new RegExp(
            `--e${frame}:translate3d\\((-?[\\d.]+)px,(-?[\\d.]+)px,0\\)`,
          ).exec(item.style)!;
          assert.ok(match);
          const opacity = Number(new RegExp(`--a${frame}:([\\d.]+);`).exec(item.style)![1]);
          assert.ok(opacity >= 0 && opacity <= 1);
          if (frame === 0 || frame === 40) assert.equal(opacity, 0);
          return { x: Number(match[1]), y: Number(match[2]) };
        });
        assert.ok(Math.abs(poses.reduce((sum, pose) => sum + pose.x, 0)) < 0.01);
        assert.ok(Math.max(...poses.map((pose) => Math.abs(pose.x))) < 85);
        assert.ok(Math.min(...poses.map((pose) => pose.y)) > -90);
      }
      previous = text;
    }
  }
});
