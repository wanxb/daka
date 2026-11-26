import { axisLabel, chartTransform, niceMaximum, plot } from '../../application/chart-layout';
import type { ChartPoint } from '../../domain/statistics';
/** Rendering consumes an immutable snapshot; the component owns DPR, scheduling, image caching and stale callbacks. */
export interface ChartDrawing {
  mode: string;
  factor: number;
  color: string;
  baseline: number;
  focusBaseline: boolean;
  selectedIndex: number;
}
/** Draw the same logical-pixel commands for steps/bars; never derive or round persisted values here. */
export function drawPlot(
  ctx: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
  width: number,
  height: number,
  points: ChartPoint[],
  options: ChartDrawing,
): void {
  const values = points.map((p) => (options.mode === 'cumulative' ? p.cumulative : p.added));
  // Preserve text proportions while using the available height for data; drawing and picking share the width scale.
  const transform = chartTransform(width, height);
  ctx.translate(transform.left, transform.top);
  ctx.scale(transform.scale, transform.scale);
  const { left, right, top, bottom } = plot,
    w = 310 - left - right,
    h = transform.logicalHeight - top - bottom,
    max = niceMaximum(
      values.reduce((value, n) => Math.max(value, n), 0),
      options.factor,
    );
  const minimum =
    options.focusBaseline && options.mode === 'cumulative'
      ? Math.min(options.baseline, ...values)
      : 0;
  const span = max - minimum || 1;
  const y = (value: number) => top + h - ((value - minimum) / span) * h;
  const slot = w / Math.max(points.length, 1);
  const x = (i: number) =>
    options.mode === 'distribution'
      ? left + slot * (i + 0.5)
      : left + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  ctx.font = '10px -apple-system, Segoe UI, Microsoft YaHei, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  for (let i = 0; i < 3; i++) {
    const value = minimum + (span * i) / 2,
      yy = y(value);
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(302, yy);
    ctx.strokeStyle = '#ededf2';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#85828e';
    ctx.fillText(axisLabel(value / options.factor), 31, yy + 3);
  }
  ctx.fillStyle = options.color;
  ctx.strokeStyle = options.color;
  const selected = options.selectedIndex;
  if (options.mode === 'cumulative') {
    const trace = () => {
      ctx.moveTo(x(0), y(values[0]));
      points.forEach((point, i) => {
        if (i) {
          ctx.lineTo(x(i), y(values[i - 1]));
          ctx.lineTo(x(i), y(point.cumulative));
        }
      });
    };
    ctx.beginPath();
    trace();
    ctx.lineTo(x(points.length - 1), top + h);
    ctx.lineTo(x(0), top + h);
    ctx.closePath();
    ctx.globalAlpha = 0.065;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    trace();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    for (const i of [...new Set([points.length - 1, selected])])
      if (i >= 0 && i < points.length) {
        ctx.beginPath();
        ctx.arc(x(i), y(values[i]), 3.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.strokeStyle = options.color;
      }
  } else
    values.forEach((value, i) => {
      const bw = Math.min(23, slot * 0.56),
        bx = x(i) - bw / 2,
        by = y(value),
        bh = Math.max(0, top + h - by);
      if (bh <= 0) return;
      const r = Math.min(3, bw / 2, bh / 2);
      ctx.globalAlpha = selected < 0 || selected === i ? 0.88 : 0.35;
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.lineTo(bx + bw - r, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
      ctx.lineTo(bx + bw, by + bh - r);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
      ctx.lineTo(bx + r, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
      ctx.lineTo(bx, by + r);
      ctx.quadraticCurveTo(bx, by, bx + r, by);
      ctx.closePath();
      ctx.fill();
    });
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#85828e';
  ctx.textAlign = 'center';
  const labelStep = Math.max(1, Math.ceil(points.length / 5));
  // Real month buckets include the year only when the visible history crosses a year boundary.
  const years = new Set(
    points
      .filter((point) => /^\d{4}-\d{2}$/.test(point.label))
      .map((point) => point.label.slice(0, 4)),
  );
  points.forEach((point, i) => {
    if (i % labelStep === 0 || i === points.length - 1)
      ctx.fillText(
        /^\d{4}-\d{2}$/.test(point.label) && years.size <= 1
          ? Number(point.label.slice(5)) + '月'
          : point.label,
        x(i),
        transform.logicalHeight - 5,
      );
  });
}
