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

/** Decorative light, paper grain and contours never encode quantities, completion or chart trends. */
function drawBackdrop(ctx: Context, color: string, height: number, record: boolean) {
  ctx.fillStyle = '#fafbff';
  ctx.fillRect(0, 0, 900, height);
  const light = ctx.createRadialGradient(900, 0, 30, 760, 210, 920);
  light.addColorStop(0, color + '48');
  light.addColorStop(0.52, color + '16');
  light.addColorStop(1, color + '00');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, 900, height);
  const sky = ctx.createRadialGradient(0, height, 0, 100, height - 100, 630);
  sky.addColorStop(0, '#8db9ee29');
  sky.addColorStop(1, '#8db9ee00');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 900, height);
  // Broad translucent folds enrich the paper without introducing another text or metric region.
  ctx.beginPath();
  ctx.moveTo(900, -80);
  ctx.lineTo(900, height * 0.62);
  ctx.quadraticCurveTo(635, height * 0.48, 526, 196);
  ctx.closePath();
  ctx.fillStyle = '#ffffff55';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(900, 20);
  ctx.lineTo(900, height * 0.66);
  ctx.quadraticCurveTo(724, height * 0.4, 620, 138);
  ctx.closePath();
  ctx.fillStyle = color + '0a';
  ctx.fill();
  // Deterministic fine grain avoids flicker and keeps every export of the same layout visually stable.
  ctx.fillStyle = '#33435b07';
  for (let i = 0; i < 1000; i++) {
    const x = (i * 127 + 31) % 907,
      y = (((i * 211 + 53) % 1237) / 1237) * height;
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  for (let layer = 0; layer < 3; layer++) {
    ctx.beginPath();
    ctx.moveTo(0, height - 136 + layer * 42);
    ctx.quadraticCurveTo(370, height + 18, 900, height - 274 + layer * 72);
    ctx.lineTo(900, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = color + ['12', '0c', '10'][layer];
    ctx.fill();
  }
  // Open contour lines are scenery, deliberately detached from the plotted data surface.
  ctx.save();
  ctx.strokeStyle = color + '18';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-70, height - 260 + i * 22);
    ctx.bezierCurveTo(160, height - 352 + i * 20, 300, height + 56, 620, height - 126 + i * 16);
    ctx.stroke();
  }
  ctx.restore();
  if (record) {
    star(ctx, 742, 326, 91, color + '12');
    star(ctx, 747, 321, 39, '#ffffffb0');
    star(ctx, 780, 262, 11, color + '66');
    star(ctx, 674, 393, 8, color + '44');
    ctx.fillStyle = color + '42';
    [
      [705, 246, 3],
      [810, 365, 3],
      [652, 304, 2],
    ].forEach(([x, y, r]) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    // The statistics variant is quieter near the graph and concentrates its geometry in the header.
    ctx.save();
    ctx.strokeStyle = color + '1c';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(914, 290, 116 + i * 24, Math.PI * 0.73, Math.PI * 1.55);
      ctx.stroke();
    }
    ctx.restore();
    // Match the record card's large glint while retaining the statistics header placement.
    star(ctx, 774, 274, 91, color + '12');
    star(ctx, 774, 274, 39, '#ffffffc9');
  }
}

/** Fixed Canvas line icons keep the two result states consistent across platforms without emoji font variance. */
function drawStatus(ctx: Context, d: ShareSnapshot, record: boolean) {
  const x = 648,
    y = 90;
  rounded(ctx, x, y, 176, 52, 26, '#ffffffa8');
  ctx.save();
  ctx.translate(x + 26, y + 26);
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (record) {
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(-1, 5);
    ctx.lineTo(7, -5);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-12, -12);
    ctx.lineTo(-12, 12);
    ctx.lineTo(13, 12);
    ctx.stroke();
    [
      [-5, 3],
      [3, -4],
      [11, -10],
    ].forEach(([xx, yy]) => {
      ctx.beginPath();
      ctx.moveTo(xx, 7);
      ctx.lineTo(xx, yy);
      ctx.stroke();
    });
  }
  ctx.restore();
  ctx.textAlign = 'right';
  text(ctx, d.title, 808, 125, 23, d.color, 500, 118);
  ctx.textAlign = 'left';
}
/** Keep only the saved result and its date; brand and background share one quiet visual system. */
export function drawPoster(
  ctx: Context,
  d: ShareSnapshot,
  glyph: WechatMiniprogram.Image | null,
  notes: string[],
  height: number,
  miniCode: WechatMiniprogram.Image | null = null,
) {
  const record = d.kind === 'record';
  drawBackdrop(ctx, d.color, height, record);
  if (glyph) ctx.drawImage(glyph, 76, 90, 52, 52);
  else star(ctx, 102, 116, 22, d.color);
  text(ctx, d.name, 148, 134, 50, '#222431', 600, 495);
  drawStatus(ctx, d, record);
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
  // Preserve the official image and its built-in white background; omit the extra rounded backing plate.
  if (miniCode) {
    // Raise the pair as one unit: the caption needs its own breathing room below the code.
    const size = 164,
      x = 900 - 76 - size,
      y = height - 76 - size;
    ctx.drawImage(miniCode, x + 8, y + 8, size - 16, size - 16);
    // The code already contains the logo; one quiet caption identifies the app without duplicating artwork.
    ctx.textAlign = 'center';
    text(ctx, '北极星打卡', x + size / 2, height - 42, 27, '#555866', 400, size);
    ctx.textAlign = 'left';
  }
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
