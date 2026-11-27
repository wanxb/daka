import assert from 'node:assert/strict';
import test from 'node:test';
import {
  celebrationPaper,
  createCelebration,
  celebrationTiming,
  paperProjection,
} from '../miniprogram/application/celebration';

// Rendering snapshots must remain bounded and finite: a corrupt measurement cannot become a full-screen overlay.
test('庆祝忽略无效卡片尺寸，有限轨迹保持56片且不依赖运行时逐帧更新', () => {
  const rect = { left: 16, top: 170, width: 170, height: 180 };
  for (const invalid of [
    { ...rect, width: 0 },
    { ...rect, top: NaN },
    { ...rect, height: -1 },
  ])
    assert.equal(createCelebration(invalid, 'purple', 1), null);
  const first = createCelebration(rect, 'purple', 42)!;
  assert.equal(first.x, 101);
  assert.equal(first.y, 260);
  assert.equal(first.papers.length, 56);
  assert.equal(new Set(first.papers.map((paper) => paper.id)).size, 56);
  assert.deepEqual(first, createCelebration(rect, 'purple', 42));
  assert.notDeepEqual(first.papers, createCelebration(rect, 'purple', 43)!.papers);
  assert.ok(JSON.stringify(first).length < 400000);
  for (const paper of first.papers) {
    assert.doesNotMatch(paper.style, /NaN|Infinity|undefined/);
    assert.match(paper.style, /--f0:translate3d\(0px,0px,0\) matrix\(/);
    assert.match(paper.style, /--f40:translate3d\(/);
    assert.match(paper.style, /--c0:#[0-9a-f]{6}/);
  }
  assert.ok(celebrationTiming.cleanup > celebrationTiming.paper);
});

// Known flat/edge-on poses guard the source of the prototype/native discrepancy: matrix projection, not 3D boxes.
test('方纸片以二维矩阵翻面，不拉成长彩带；缩小范围后仍保留原有落下和侧向漂移', () => {
  assert.deepEqual(paperProjection(0, Math.PI / 2, 0, 1, 1), [1, 0, -0, 1]);
  const edge = paperProjection(0, 0, 0, 1, 1);
  assert.equal(edge[3], 0);
  // Only displacement is compressed; keep the restored physical projection and fade contract.
  assert.equal(celebrationPaper.rangeScale, 0.7);
  const result = createCelebration({ left: 0, top: 100, width: 170, height: 180 }, 'purple', 42)!;
  const ends = result.papers.map((paper) => {
    const match = /--f40:translate3d\((-?[\d.]+)px,(-?[\d.]+)px,0\)/.exec(paper.style)!;
    return { x: Number(match[1]), y: Number(match[2]) };
  });
  assert.ok(ends.reduce((sum, end) => sum + end.y, 0) / ends.length > 100);
  assert.ok(Math.max(...ends.map((end) => end.x)) - Math.min(...ends.map((end) => end.x)) > 140);
});
