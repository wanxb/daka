import { amountText } from '../domain/model';
/** Logical-pixel geometry is shared by drawing and hit testing; DPR affects the backing buffer only. */
export const plot = { left: 39, right: 8, top: 16, bottom: 25 };
/** Width fixes text and hit-test scale; extra height expands data geometry instead of adding letterboxing. */
export function chartTransform(width: number, height: number) {
  const scale = width / 310;
  return { scale, left: 0, top: 0, logicalHeight: height / scale };
}
export function niceMaximum(raw: number, factor: number): number {
  // The approved chart uses its exact maximum, with one selected unit as the empty/small-value floor.
  return Math.max(raw, factor);
}
/** Tiny hour/minute values must remain visible instead of being rounded to zero on every grid line. */
export function axisLabel(value: number): string {
  if (value >= 1e8) return amountText(Number((value / 1e8).toFixed(1))) + '亿';
  if (value >= 1e4) return amountText(Number((value / 1e4).toFixed(1))) + '万';
  return amountText(value);
}
export function pointIndex(
  localX: number,
  width: number,
  count: number,
  mode = 'distribution',
): number | null {
  const available = width - plot.left - plot.right;
  if (
    !Number.isFinite(localX) ||
    available <= 0 ||
    count < 1 ||
    localX < plot.left ||
    localX > width - plot.right
  )
    return null;
  return mode === 'cumulative'
    ? Math.min(count - 1, Math.round(((localX - plot.left) / available) * (count - 1)))
    : Math.min(count - 1, Math.floor(((localX - plot.left) / available) * count));
}
