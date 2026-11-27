import type { ShareSnapshot } from './share-snapshot';
type Context = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
const font = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
/** Explicit quadratic corners work on the retained 3.0 baseline without browser roundRect/Path2D globals. */
function roundPath(ctx: Context, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
/** Pure native Canvas drawing consumes a frozen snapshot; it never queries storage or creates DOM objects. */
function text(
  ctx: Context,
  value: string | number,
  x: number,
  y: number,
  size = 28,
  color = '#1c1c1e',
  weight = 400,
  maximum = 756,
) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.fillText(String(value), x, y, maximum);
}

// Wrap arbitrary old notes without clipping them to today's input limit or interpreting them as markup.
export function wrap(ctx: Context, value: string, width: number, size: number) {
  ctx.font = `400 ${size}px ${font}`;
  return value.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    return [...lines, line];
  });
}

function rounded(
  ctx: Context,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string | WechatMiniprogram.CanvasRenderingContext.CanvasGradient,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  roundPath(ctx, x, y, width, height, radius);
  ctx.fill();
}

/** A north-star signature is decorative brand artwork, never a score, target or progress ring. */
function star(ctx: Context, x: number, y: number, radius: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 4,
      distance = i % 2 ? radius * 0.24 : radius;
    ctx.lineTo(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
  }
  ctx.closePath();
  ctx.fill();
}

/** Measure both number and unit so large historical values keep their full text inside the hero. */
function metric(
  ctx: Context,
  value: ShareSnapshot['metrics'][number],
  x: number,
  y: number,
  color: string,
  size: number,
  available: number,
) {
  ctx.font = `400 30px ${font}`;
  const unitWidth = ctx.measureText(value.unit).width;
  ctx.font = `600 ${size}px ${font}`;
  const fitted = Math.min(
    size,
    ((available - unitWidth - 16) / Math.max(1, ctx.measureText(value.number).width)) * size,
  );
  text(ctx, value.number, x - 5, y, fitted, color, 600, available - unitWidth - 16);
  ctx.font = `600 ${fitted}px ${font}`;
  text(ctx, value.unit, x + ctx.measureText(value.number).width + 10, y - 5, 30, '#45454f');
}

/** Low-contrast horizon bands are brand scenery, never a progress ring or a fabricated data curve. */
function drawBackdrop(ctx: Context, color: string, height: number, record: boolean) {
  ctx.fillStyle = '#fcfcff';
  ctx.fillRect(0, 0, 900, height);
  const light = ctx.createRadialGradient(860, 80, 0, 730, 170, 760);
  light.addColorStop(0, color + '25');
  light.addColorStop(0.7, color + '08');
  light.addColorStop(1, color + '00');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, 900, height);
  // Anchor the artwork to the footer so long notes expand the content without colliding with it.
  for (let layer = 0; layer < 3; layer++) {
    ctx.beginPath();
    ctx.moveTo(0, height - 108 + layer * 39);
    ctx.quadraticCurveTo(400, height + 28, 900, height - 245 + layer * 72);
    ctx.lineTo(900, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = color + ['09', '09', '0c'][layer];
    ctx.fill();
  }
  if (record) {
    // A single north-star glint carries the identity without competing with the saved amount.
    star(ctx, 765, 270, 26, color + '50');
    star(ctx, 707, 230, 6, color + '38');
  }
}

/** Keep only the saved result and its date; brand and background share one quiet visual system. */
export function drawPoster(
  ctx: Context,
  d: ShareSnapshot,
  glyph: WechatMiniprogram.Image | null,
  notes: string[],
  height: number,
  brand: WechatMiniprogram.Image | null = null,
) {
  const record = d.kind === 'record';
  drawBackdrop(ctx, d.color, height, record);
  if (glyph) ctx.drawImage(glyph, 76, 90, 52, 52);
  else star(ctx, 102, 116, 22, d.color);
  text(ctx, d.name, 148, 134, 50, '#222431', 600, 495);
  ctx.textAlign = 'right';
  text(ctx, d.title, 824, 128, 23, '#686a78', 400, 180);
  ctx.textAlign = 'left';
  text(ctx, d.date, 76, 197, 25, '#686a78');
  text(ctx, d.metrics[0].label, 76, 287, 27, '#686a78');
  metric(ctx, d.metrics[0], 76, 429, '#222431', record ? 158 : 140, 748);
  if (record && d.metrics[1]) {
    text(ctx, d.metrics[1].label, 76, 501, 25, '#686a78');
    metric(ctx, d.metrics[1], 76, 577, '#393c4c', 72, 748);
  }
  if (!record) {
    // The plot retains its measured scale; decoration stays outside the white data surface.
    rounded(ctx, 56, 500, 788, 450, 28, '#ffffffde');
    ctx.save();
    ctx.translate(0, -36);
    drawGraph(ctx, d);
    ctx.restore();
  }
  if (record && notes.length) {
    const top = d.metrics[1] ? 630 : 515;
    rounded(ctx, 76, top, 3, notes.length * 42, 1.5, d.color + '66');
    notes.forEach((line, i) => text(ctx, line, 99, top + 30 + i * 42, 28, '#555866', 400, 715));
  }
  // One official brand signature replaces repeated logos, slogans and unrelated record counts.
  if (brand) ctx.drawImage(brand, 76, height - 96, 44, 44);
  text(ctx, '北极星打卡', 132, height - 64, 24, '#626675', 500);
}

function drawGraph(ctx: Context, d: ShareSnapshot) {
  const left = 94,
    right = 806,
    top = 650,
    base = 900;
  if (d.graph === 'calendar') {
    const shades = ['#f0f0f5', d.color + '30', d.color + '66', d.color + 'a8', d.color];
    ['一', '二', '三', '四', '五', '六', '日'].forEach((day, i) =>
      text(ctx, day, 112 + i * 103, 632, 23, '#73737e'),
    );
    d.cells.forEach((cell, i) => {
      if (!cell.day) return;
      const x = 94 + (i % 7) * 103,
        y = 653 + Math.floor(i / 7) * 44;
      rounded(ctx, x, y, 77, 36, 10, cell.future ? '#f8f8fa' : shades[cell.level]);
      text(
        ctx,
        cell.missing ? '—' : cell.day,
        x + 24,
        y + 26,
        22,
        cell.future ? '#a1a1ab' : cell.level > 2 ? '#fff' : '#45454f',
      );
    });
    return;
  }
  const values = d.values,
    valid = values.filter((value) => value != null);
  const cumulative = d.graph === 'cumulative';
  // Converted day/hour values can be below one; forcing a whole-unit scale would hide valid short practice.
  const maximum = Math.max(0, ...valid) || 1;
  const minimum = cumulative ? Math.min(d.baseline, ...valid) : 0;
  const span = maximum - minimum || maximum || 1;
  const x = (i: number) => left + ((right - left) * (i + 0.5)) / Math.max(1, values.length);
  const y = (value: number) => base - ((value - minimum) / span) * (base - top);
  for (let i = 0; i <= 3; i++) {
    const yy = top + ((base - top) * i) / 3;
    ctx.strokeStyle = '#e8e8ee';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
  }
  if (!valid.length || !valid.some((value) => value > 0)) {
    text(ctx, '所选时段暂无记录', 270, 770, 28, '#6b6b73');
  } else if (cumulative) {
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let previous: number | null = null;
    // Horizontal then vertical segments preserve accumulation; no smoothing invents intermediate practice.
    values.forEach((value, i) => {
      if (value == null) return;
      if (previous == null) ctx.moveTo(x(i), y(value));
      else {
        ctx.lineTo(x(i), y(previous));
        ctx.lineTo(x(i), y(value));
      }
      previous = value;
    });
    ctx.stroke();
    const last = values.length - 1;
    // Shade the same step geometry, retaining exact daily plateaus rather than a smoothed curve.
    const first = values.findIndex((value) => value != null);
    ctx.beginPath();
    ctx.moveTo(x(first), base);
    ctx.lineTo(x(first), y(values[first]));
    let prior = values[first];
    values.forEach((value, i) => {
      if (value == null || i <= first) return;
      ctx.lineTo(x(i), y(prior));
      ctx.lineTo(x(i), y(value));
      prior = value;
    });
    ctx.lineTo(x(last), base);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, top, 0, base);
    fill.addColorStop(0, d.color + '27');
    fill.addColorStop(1, d.color + '03');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(x(last), y(values[last]), 7, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const width = Math.max(2, Math.min(42, ((right - left) / Math.max(1, values.length)) * 0.55));
    values.forEach((value, i) => {
      if (value > 0)
        rounded(
          ctx,
          x(i) - width / 2,
          y(value),
          width,
          base - y(value),
          Math.min(7, (base - y(value)) / 2),
          d.color,
        );
    });
  }
  const indices = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])].filter(
    (i) => i >= 0,
  );
  indices.forEach((i, index) => {
    ctx.textAlign = index === 0 ? 'left' : index === indices.length - 1 ? 'right' : 'center';
    text(
      ctx,
      d.labels[i] || '',
      index === 0 ? left : index === indices.length - 1 ? right : x(i),
      945,
      22,
      '#6b6b73',
      400,
      220,
    );
  });
  ctx.textAlign = 'left';
  ctx.textAlign = 'right';
  // Label the visible scale explicitly; a nonzero cumulative baseline must never masquerade as zero.
  text(
    ctx,
    maximum.toLocaleString('zh-CN', { maximumFractionDigits: 4 }),
    right,
    627,
    20,
    '#73737e',
  );
  text(
    ctx,
    minimum.toLocaleString('zh-CN', { maximumFractionDigits: 4 }),
    right,
    889,
    20,
    '#73737e',
  );
  ctx.textAlign = 'left';
}
