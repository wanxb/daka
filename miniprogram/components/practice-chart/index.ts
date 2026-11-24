import { amountText, timeText, type TimeUnit } from '../../domain/model';
import type { ChartPoint } from '../../domain/statistics';
type CanvasNode = WechatMiniprogram.Canvas;
interface CanvasResult {
  node: CanvasNode;
  width: number;
  height: number;
  left: number;
  top: number;
}
const revisions = new WeakMap<object, number>();
/** A single 2D canvas draws real steps/bars; no interpolation invents unrecorded practice. */
Component({
  properties: {
    points: { type: Array, value: [] as ChartPoint[] },
    mode: { type: String, value: 'cumulative' },
    unit: { type: String, value: '次' },
    factor: { type: Number, value: 1 },
    isTime: { type: Boolean, value: false },
    color: { type: String, value: '#6745c6' },
    baseline: { type: Number, value: 0 },
  },
  data: { reading: '', empty: true },
  observers: {
    'points, mode, factor, color, baseline'() {
      this.setData({ reading: '' });
      this.draw();
    },
  },
  lifetimes: {
    ready() {
      this.draw();
    },
    detached() {
      revisions.set(this, (revisions.get(this) || 0) + 1);
    },
  },
  pageLifetimes: {
    resize() {
      this.draw();
    },
  },
  methods: {
    draw() {
      const revision = (revisions.get(this) || 0) + 1;
      revisions.set(this, revision);
      this.createSelectorQuery()
        .select('#chart')
        .fields({ node: true, size: true, rect: true })
        .exec((result: CanvasResult[]) => {
          const info = result[0];
          if (!info?.node || revision !== revisions.get(this)) return;
          const { node, width, height } = info,
            dpr = wx.getWindowInfo().pixelRatio;
          node.width = width * dpr;
          node.height = height * dpr;
          const ctx = node.getContext(
            '2d',
          ) as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, height);
          const points = this.data.points,
            values = points.map((p) => (this.data.mode === 'cumulative' ? p.cumulative : p.added));
          const empty = !points.some((p) => p.records > 0) && this.data.baseline === 0;
          this.setData({ empty });
          if (empty) return;
          const left = 54,
            right = 12,
            top = 16,
            bottom = 30,
            w = width - left - right,
            h = height - top - bottom,
            max = values.reduce((max, value) => Math.max(max, value), 1) * 1.12;
          const y = (value: number) => top + h - (value / max) * h,
            step = w / Math.max(points.length, 1),
            x = (i: number) => left + step * (i + 0.5);
          ctx.font = '11px -apple-system, sans-serif';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'right';
          for (let i = 0; i < 3; i++) {
            const value = (max * i) / 2,
              yy = y(value);
            ctx.beginPath();
            ctx.moveTo(left, yy);
            ctx.lineTo(width - right, yy);
            ctx.strokeStyle = '#ededf2';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#74747c';
            const n = value / this.data.factor;
            ctx.fillText(
              n >= 10000
                ? amountText(Number((n / 10000).toFixed(1))) + '万'
                : amountText(Number(n.toFixed(1))),
              left - 8,
              yy,
            );
          }
          ctx.fillStyle = this.data.color;
          ctx.strokeStyle = this.data.color;
          if (this.data.mode === 'cumulative') {
            ctx.beginPath();
            ctx.moveTo(left, y(this.data.baseline));
            points.forEach((p, i) => {
              ctx.lineTo(x(i), y(i ? points[i - 1].cumulative : this.data.baseline));
              ctx.lineTo(x(i), y(p.cumulative));
            });
            ctx.lineTo(
              width - right,
              y(points[points.length - 1]?.cumulative || this.data.baseline),
            );
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.stroke();
          } else
            values.forEach((value, i) => {
              const bw = Math.max(1, Math.min(24, step * 0.55));
              ctx.fillRect(
                x(i) - bw / 2,
                y(value),
                bw,
                Math.max(value > 0 ? 2 : 0, y(0) - y(value)),
              );
            });
          ctx.fillStyle = '#74747c';
          ctx.textAlign = 'center';
          const indexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
          for (const i of indexes)
            if (points[i])
              ctx.fillText(points[i].label, x(i), height - 10, Math.max(40, w / 3 - 5));
        });
    },
    inspect(e: WechatMiniprogram.TouchEvent) {
      const touch = e.touches[0];
      if (!touch || !this.data.points.length || this.data.empty) return;
      this.createSelectorQuery()
        .select('#chart')
        .boundingClientRect((rect) => {
          if (!rect || Array.isArray(rect)) return;
          const x = touch.clientX - rect.left - 54,
            w = rect.width - 66,
            i = Math.min(
              this.data.points.length - 1,
              Math.max(0, Math.floor((x / w) * this.data.points.length)),
            ),
            point = this.data.points[i];
          const value = this.data.mode === 'cumulative' ? point.cumulative : point.added;
          let text = this.data.isTime
            ? timeText(value, this.data.unit as TimeUnit)
            : amountText(value) + this.data.unit;
          if (text.startsWith('≈')) text += '（' + amountText(value) + '秒）';
          this.setData({ reading: point.label + ' · ' + text });
        })
        .exec();
    },
  },
});
