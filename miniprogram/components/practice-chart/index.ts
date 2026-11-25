import { amountText, timeText, type TimeUnit } from '../../domain/model';
import { axisLabel, niceMaximum, pointIndex, plot } from '../../application/chart-layout';
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
interface ChartTouch {
  x?: number;
  y?: number;
  clientX?: number;
  clientY?: number;
}
interface ChartGesture {
  touches: ChartTouch[];
  changedTouches?: ChartTouch[];
}
const gestures = new WeakMap<object, { x: number; y: number; at: number }>();
const touchPosition = (touch: ChartTouch) => ({
  x: touch.clientX ?? touch.x ?? NaN,
  y: touch.clientY ?? touch.y ?? NaN,
});
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
    // Native canvas layers can paint above page-container; detach the node while a record sheet owns focus.
    obscured: { type: Boolean, value: false },
  },
  data: { reading: '', empty: true, selectedIndex: -1 },
  observers: {
    obscured(value: boolean) {
      revisions.set(this, (revisions.get(this) || 0) + 1);
      if (!value) wx.nextTick(() => this.draw());
    },
    'points, mode, factor, unit, color, baseline'() {
      gestures.delete(this);
      this.setData({ reading: '', selectedIndex: -1 });
      this.draw();
    },
  },
  lifetimes: {
    ready() {
      this.draw();
    },
    detached() {
      gestures.delete(this);
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
      if (this.data.obscured) return;
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
          const empty =
            !points.some((p) => p.records > 0) &&
            (this.data.mode === 'distribution' || this.data.baseline === 0);
          this.setData({ empty });
          if (empty) return;
          const { left, right, top, bottom } = plot,
            w = width - left - right,
            h = height - top - bottom,
            max = niceMaximum(
              values.reduce((max, value) => Math.max(max, value), 0),
              this.data.factor,
            );
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
            ctx.fillText(axisLabel(n), left - 8, yy);
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
          const selected = this.data.selectedIndex;
          if (selected >= 0 && selected < points.length) {
            ctx.beginPath();
            ctx.moveTo(x(selected), top);
            ctx.lineTo(x(selected), top + h);
            ctx.strokeStyle = '#b9b4c4';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x(selected), y(values[selected]), 4, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = this.data.color;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          ctx.fillStyle = '#74747c';
          ctx.textAlign = 'center';
          const indexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
          for (const i of indexes)
            if (points[i])
              ctx.fillText(points[i].label, x(i), height - 10, Math.max(40, w / 3 - 5));
        });
    },
    startTouch(e: ChartGesture) {
      const touch = e.touches[0];
      if (touch) {
        const point = touchPosition(touch);
        gestures.set(this, { ...point, at: Date.now() });
      }
    },
    cancelTouch() {
      gestures.delete(this);
    },
    endTouch(e: ChartGesture) {
      const start = gestures.get(this),
        touch = e.changedTouches?.[0];
      gestures.delete(this);
      if (!start || !touch) return;
      const end = touchPosition(touch);
      // Scrolling through the page must not be mistaken for selecting a chart point.
      if (
        Math.abs(end.x - start.x) > 8 ||
        Math.abs(end.y - start.y) > 8 ||
        Date.now() - start.at > 600
      )
        return;
      this.inspectTouch(touch);
    },
    inspectTouch(touch: ChartTouch) {
      if (this.data.obscured || !this.data.points.length || this.data.empty) return;
      const revision = revisions.get(this);
      this.createSelectorQuery()
        .select('#chart')
        .boundingClientRect((rect) => {
          if (!rect || Array.isArray(rect) || revision !== revisions.get(this)) return;
          // Canvas may expose local x/y; ordinary touch events expose client coordinates instead.
          const localX = Number.isFinite(touch.x) ? touch.x! : touch.clientX! - rect.left;
          const i = pointIndex(localX, rect.width, this.data.points.length);
          if (i == null) return;
          const point = this.data.points[i],
            value = this.data.mode === 'cumulative' ? point.cumulative : point.added;
          let text = this.data.isTime
            ? timeText(value, this.data.unit as TimeUnit)
            : amountText(value) + this.data.unit;
          if (text.startsWith('≈')) text += '（' + amountText(value) + '秒）';
          this.setData({
            reading: (point.description || point.label) + ' · ' + text,
            selectedIndex: i,
          });
          this.draw();
        })
        .exec();
    },
  },
});
