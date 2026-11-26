import { amountText, timeText, type TimeUnit } from '../../domain/model';
import { chartTransform, pointIndex } from '../../application/chart-layout';
import { drawPlot } from './renderer';
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
    // Suspend drawing while a record sheet owns focus; its exit observer resumes after the buffer remounts.
    obscured: { type: Boolean, value: false },
    focusBaseline: { type: Boolean, value: false },
  },
  data: { reading: '', empty: true, selectedIndex: -1, imageSrc: '', renderFailed: false },
  observers: {
    obscured(value: boolean) {
      revisions.set(this, (revisions.get(this) || 0) + 1);
      if (!value) wx.nextTick(() => this.draw());
    },
    'points, mode, factor, unit, color, baseline, focusBaseline'() {
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
    plottedPoints(): ChartPoint[] {
      // Use actual statistical buckets directly so the first month and its hit target cannot become a synthetic origin.
      return this.data.points.length
        ? this.data.points
        : [
            {
              label: '当日',
              description: '当日',
              added: 0,
              cumulative: this.data.baseline,
              records: 0,
            },
          ];
    },
    draw() {
      if (this.data.obscured) return;
      const revision = (revisions.get(this) || 0) + 1;
      revisions.set(this, revision);
      this.createSelectorQuery()
        .select('#chart-buffer')
        .fields({ node: true })
        .select('#chart')
        .boundingClientRect()
        .exec((result: CanvasResult[]) => {
          const node = result[0]?.node,
            info = result[1];
          if (!node || !info?.width || !info.height || revision !== revisions.get(this)) return;
          const { width, height } = info,
            dpr = wx.getWindowInfo().pixelRatio;
          node.width = width * dpr;
          node.height = height * dpr;
          const ctx = node.getContext(
            '2d',
          ) as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, height);
          const points = this.plottedPoints();
          const empty =
            !points.some((p) => p.records > 0) &&
            (this.data.mode === 'distribution' || this.data.baseline === 0);
          this.setData({ empty, renderFailed: false });
          if (empty) return;
          drawPlot(ctx, width, height, points, this.data);
          // A cached PNG obeys ordinary view stacking and clipping. The native buffer stays offscreen and never redraws on scroll.
          try {
            const imageSrc = node.toDataURL('image/png', 1);
            if (revision === revisions.get(this)) this.setData({ imageSrc });
          } catch (error) {
            console.warn('practice-chart: could not present the rendered plot', error);
            if (revision === revisions.get(this)) this.setData({ renderFailed: true });
          }
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
      if (this.data.obscured || this.data.empty) return;
      const revision = revisions.get(this);
      this.createSelectorQuery()
        .select('#chart')
        .boundingClientRect((rect) => {
          if (!rect || Array.isArray(rect) || revision !== revisions.get(this)) return;
          // Canvas may expose local x/y; ordinary touch events expose client coordinates instead.
          const localX = Number.isFinite(touch.x) ? touch.x! : touch.clientX! - rect.left;
          const transform = chartTransform(rect.width, rect.height || 182);
          const points = this.plottedPoints();
          const i = pointIndex(
            (localX - transform.left) / transform.scale,
            310,
            points.length,
            this.data.mode,
          );
          if (i == null) return;
          const point = points[i],
            value = this.data.mode === 'cumulative' ? point.cumulative : point.added;
          let text = this.data.isTime
            ? timeText(value, this.data.unit as TimeUnit)
            : amountText(value) + this.data.unit;
          if (text.startsWith('≈')) text += '（' + amountText(value) + '秒）';
          this.setData({
            // A selected readout stays unambiguous even when read independently of the chart mode tabs.
            reading:
              (point.description || point.label) +
              ' · ' +
              (this.data.mode === 'cumulative' ? '累计' : '') +
              text,
            selectedIndex: i,
          });
          this.draw();
        })
        .exec();
    },
  },
});
