import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarHeatmap } from '../miniprogram/domain/calendar-heatmap';
import { heatmapColors, heatmapReading } from '../miniprogram/application/calendar-presentation';
import { initialForm, type PracticeRecord, type Project } from '../miniprogram/domain/model';

// Deliberately unrelated save timestamps prove that calendar placement follows occurredOn alone.
const row = (
  date: string,
  quantity: number | null,
  seconds: number | null = null,
): PracticeRecord => ({
  id: date + '-' + quantity,
  projectId: 'p',
  occurredOn: date,
  localTime: '',
  quantity,
  durationSeconds: seconds,
  quantityUnit: '次',
  note: '',
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
});
const day = (result: ReturnType<typeof calendarHeatmap>, date: string) =>
  result.cells.find((cell) => cell.date === date)!;

test('月历遵循本地星期与闰年，固定42格，未来和月外格不伪造数据', () => {
  const result = calendarHeatmap(
    [row('2024-02-29', 100), row('2024-03-05', 9999)],
    'quantity',
    -1,
    '2024-03-03',
  );
  assert.equal(result.month, '2024-02');
  assert.equal(result.cells.length, 42);
  assert.equal(result.cells[0].date, '2024-01-29');
  assert.equal(result.cells.filter((cell) => cell.inside).length, 29);
  assert.equal(day(result, '2024-02-29').amount, 100);
  assert.equal(result.maximum, 100);
  assert.equal(result.previous, false);
  assert.equal(result.next, true);
  const current = calendarHeatmap([], 'quantity', 5, '2026-11-25');
  assert.equal(current.offset, 0);
  assert.equal(day(current, '2026-11-26').future, true);
  assert.equal(current.previous, false);
});

test('同日实际量求和，条数与指标分开，历史缺失与空白日不同', () => {
  const rows = [
    row('2026-11-01', 1000, 60),
    row('2026-11-01', 500, 120),
    row('2026-11-02', null, 90),
  ];
  const quantity = calendarHeatmap(rows, 'quantity', 0, '2026-11-25');
  assert.equal(day(quantity, '2026-11-01').amount, 1500);
  assert.equal(day(quantity, '2026-11-01').records, 2);
  assert.equal(day(quantity, '2026-11-02').missing, true);
  assert.equal(day(quantity, '2026-11-03').missing, false);
  const time = calendarHeatmap(rows, 'durationSeconds', 0, '2026-11-25');
  assert.equal(day(time, '2026-11-01').amount, 180);
  assert.equal(day(time, '2026-11-02').missing, false);
});

test('全年固定参照使同量跨月同色，更新和删除峰值重算档位，跨年独立', () => {
  const rows = [
    row('2025-12-01', 10000),
    row('2026-01-01', 100),
    row('2026-02-01', 25),
    row('2026-03-01', 25),
  ];
  const feb = calendarHeatmap(rows, 'quantity', -9, '2026-11-25');
  const mar = calendarHeatmap(rows, 'quantity', -8, '2026-11-25');
  assert.equal(day(feb, '2026-02-01').level, 1);
  assert.equal(day(mar, '2026-03-01').level, 1);
  const afterDelete = calendarHeatmap(rows.slice(2), 'quantity', -9, '2026-11-25');
  assert.equal(day(afterDelete, '2026-02-01').level, 4);
  rows[1].quantity = 50;
  assert.equal(day(calendarHeatmap(rows, 'quantity', -9, '2026-11-25'), '2026-02-01').level, 2);
  const clamped = calendarHeatmap(rows, 'quantity', -999, '2026-11-25');
  assert.equal(clamped.month, '2025-12');
  assert.equal(clamped.previous, false);
});

test('读数保留精确秒数及项目单位，不以缺失代替0，配色从白到项目色', () => {
  const project = { ...initialForm(), timeUnit: '分', quantityUnit: '页' } as unknown as Project;
  const rows = [row('2026-11-01', 5, 61), row('2026-11-02', null, 60)];
  const time = calendarHeatmap(rows, 'durationSeconds', 0, '2026-11-25');
  const original = structuredClone(rows);
  assert.match(heatmapReading(day(time, '2026-11-01'), project, 'durationSeconds'), /分钟 · 1条/);
  assert.match(
    heatmapReading(day(time, '2026-11-01'), { ...project, timeUnit: '秒' }, 'durationSeconds'),
    /61秒/,
  );
  assert.deepEqual(rows, original);
  const quantity = calendarHeatmap(rows, 'quantity', 0, '2026-11-25');
  assert.match(heatmapReading(day(quantity, '2026-11-02'), project, 'quantity'), /数量未记录/);
  assert.match(heatmapReading(day(quantity, '2026-11-03'), project, 'quantity'), /0页 · 0条/);
  const colors = heatmapColors('#6745c6');
  assert.equal(new Set(colors).size, 5);
  assert.equal(colors[4], '#6745c6');
});
