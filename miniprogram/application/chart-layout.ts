import { amountText } from '../domain/model';
/** Logical-pixel geometry is shared by drawing and hit testing; DPR affects the backing buffer only. */
export const plot = { left: 54, right: 12, top: 16, bottom: 30 };
export function niceMaximum(raw: number, factor: number): number {
  const displayed = raw / factor;
  if (displayed <= 0) return factor;
  const power = Math.pow(10, Math.floor(Math.log10(displayed))),
    scaled = displayed / power;
  return ([1, 2, 5, 10].find((value) => value >= scaled) || 10) * power * factor;
}
/** Tiny hour/minute values must remain visible instead of being rounded to zero on every grid line. */
export function axisLabel(value: number): string {
  if (value >= 1e8) return amountText(Number((value / 1e8).toFixed(1))) + '亿';
  if (value >= 1e4) return amountText(Number((value / 1e4).toFixed(1))) + '万';
  return amountText(value);
}
export function pointIndex(localX: number, width: number, count: number): number | null {
  const available = width - plot.left - plot.right;
  if (
    !Number.isFinite(localX) ||
    available <= 0 ||
    count < 1 ||
    localX < plot.left ||
    localX > width - plot.right
  )
    return null;
  return Math.min(count - 1, Math.floor(((localX - plot.left) / available) * count));
}
