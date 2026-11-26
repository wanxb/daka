import { prepare, service } from '../../application/service';
import { frequencyNames } from '../../domain/frequency';
import { recordPage, type RecordCursor } from '../../application/query';
import {
  errorText,
  displayDate,
  metricParts,
  metricText,
  recordRows,
  visibleMetrics,
} from '../../application/presentation';
import {
  dateKey,
  readFrequency,
  factors,
  palettes,
  sortRecords,
  total,
  type Database,
  type Metric,
  type PracticeRecord,
  type Project,
} from '../../domain/model';
import { statistics, type ChartPoint, type Period } from '../../domain/statistics';
import { calendarHeatmap, type HeatmapDay } from '../../domain/calendar-heatmap';
import { heatmapColors, heatmapReading } from '../../application/calendar-presentation';
/** Chart scope and full-history pagination are independent: expanding records never changes chart totals. */
Page({
  data: {
    project: null as Project | null,
    loading: true,
    error: '',
    metric: 'durationSeconds' as Metric,
    metrics: [] as { id: Metric; label: string }[],
    summaries: [] as { id: Metric; label: string; text: string; number: string; unit: string }[],
    secondarySummary: '',
    period: 'week' as Period,
    frequencyLabel: '',
    periods: [
      // Daily aggregation is retained internally; its entry is deferred until repeated daily records warrant it.
      // { id: 'day', label: '日' },
      { id: 'week', label: '周' },
      { id: 'month', label: '月' },
      { id: 'year', label: '年' },
      { id: 'all', label: '全部' },
    ],
    offset: 0,
    // Long-term accumulation is the first segment and the default when opening project details.
    chartMode: 'cumulative',
    // Calendar navigation is independent from the existing day/week/month/year chart scope.
    calendarOffset: 0,
    calendarDate: '',
    calendarDateLabel: '',
    calendarLabel: '',
    calendarPrevious: false,
    calendarNext: false,
    calendarReading: '',
    calendarCells: [] as (HeatmapDay & {
      background: string;
      reading: string;
      disabled: boolean;
    })[],
    calendarLegend: [] as { level: number; color: string; label: string }[],
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    points: [] as ChartPoint[],
    baseline: 0,
    periodLabel: '',
    unit: '分',
    factor: 60,
    color: '#6745c6',
    records: [] as { id: string; date: string; value: string; note: string; meta: string }[],
    expanded: false,
    hasMore: false,
    historyCount: 0,
    selectedCount: 0,
    toast: '',
    expiresAt: 0,
    navHeight: 88,
    deleting: false,
    sheetOpen: false,
    showNavTitle: false,
  },
  _id: '',
  _db: null as Database | null,
  _rows: [] as PracticeRecord[],
  _selected: [] as PracticeRecord[],
  _cursor: null as RecordCursor | null,
  _request: 0,
  _alive: true,
  _scrollTop: 0,
  _titleThreshold: Infinity,
  onLoad(options: Record<string, string | undefined>) {
    this._id = options.id || '';
  },
  onShow() {
    this._alive = true;
    void this.load();
  },
  onUnload() {
    this._alive = false;
    this._request++;
  },
  navLayout(e: WechatMiniprogram.CustomEvent<{ height: number }>) {
    this.setData({ navHeight: e.detail.height }, () => this.measureTitle());
  },
  measureTitle() {
    if (!this.data.project || !this._alive) return;
    const request = this._request;
    this.createSelectorQuery()
      .select('.detail-heading')
      .boundingClientRect((rect) => {
        if (!rect || Array.isArray(rect) || !this._alive || request !== this._request) return;
        // Measure the actual heading once after layout; scroll events only toggle state when it crosses the toolbar edge.
        this._titleThreshold = Math.max(1, rect.bottom + this._scrollTop - this.data.navHeight);
        this.updateNavTitle();
      })
      .exec();
  },
  updateNavTitle() {
    const show = !!this.data.project && this._scrollTop >= this._titleThreshold;
    if (show !== this.data.showNavTitle) this.setData({ showNavTitle: show });
  },
  onPageScroll(e: { scrollTop: number }) {
    this._scrollTop = Math.max(0, e.scrollTop);
    this.updateNavTitle();
  },
  async load() {
    const request = ++this._request;
    try {
      const db = await prepare();
      if (!this._alive || request !== this._request) return;
      const project = db.projects.find((p) => p.id === this._id);
      if (!project) throw new Error('此项目已不存在，请返回首页。');
      this._db = db;
      this._rows = db.records.filter((r) => r.projectId === project.id);
      const metrics = visibleMetrics(project, this._rows);
      const first = !this.data.project;
      const frequency = readFrequency(project.frequency);
      // Editing records preserves an explicit chart choice; changing cadence deliberately resets its scope.
      const resetPeriod = first || readFrequency(this.data.project?.frequency) !== frequency;
      if (resetPeriod) {
        this._cursor = null;
        // Daily projects open a weekly overview while the single-day chart entry is hidden.
        this.setData({
          period: frequency === 'day' ? 'week' : frequency,
          offset: 0,
          expanded: false,
        });
      }
      const metric =
        first || !metrics.includes(this.data.metric) ? project.primaryMetric : this.data.metric;
      this.setData({
        project,
        frequencyLabel: frequencyNames[frequency],
        metric,
        metrics: metrics.map((id) => ({ id, label: id === 'quantity' ? '数量' : '时间' })),
        summaries: metrics.map((id) => ({
          id,
          label: id === 'quantity' ? '累计数量' : '累计时间',
          text:
            this._rows.some((r) => r[id] != null) || !this._rows.length
              ? metricText(project, id, total(this._rows, id))
              : '未记录',
          ...(this._rows.some((r) => r[id] != null) || !this._rows.length
            ? metricParts(project, id, total(this._rows, id))
            : { number: '未记录', unit: '' }),
        })),
        historyCount: this._rows.length,
        color: palettes[project.color],
        loading: false,
        error: '',
      });
      this.setData(
        {
          secondarySummary: this.data.summaries[1]
            ? this.data.summaries[1].label + ' ' + this.data.summaries[1].text
            : '',
        },
        () => this.measureTitle(),
      );
      this.chart();
      this.list(true);
    } catch (error) {
      if (this._alive && request === this._request)
        this.setData({ loading: false, error: errorText(error) });
    }
  },
  chart() {
    const p = this.data.project;
    if (!p) return;
    if (this.data.chartMode === 'calendar') {
      const heat = calendarHeatmap(
        this._rows,
        this.data.metric,
        this.data.calendarOffset,
        dateKey(),
      );
      const colors = heatmapColors(this.data.color);
      const cells = heat.cells.map((day) => ({
        ...day,
        background: colors[day.level],
        reading: heatmapReading(day, p, this.data.metric),
        disabled: !day.inside || day.future,
      }));
      const selected = cells.find((day) => day.date === this.data.calendarDate && !day.disabled);
      this._selected = selected
        ? heat.selected.filter((row) => row.occurredOn === selected.date)
        : heat.selected;
      this.setData({
        calendarOffset: heat.offset,
        calendarLabel: heat.label,
        calendarDate: selected?.date || '',
        calendarDateLabel: selected ? displayDate(selected.date) : '',
        calendarReading: selected?.reading || '',
        calendarCells: cells,
        calendarPrevious: heat.previous,
        calendarNext: heat.next,
        calendarLegend: [1, 2, 3, 4].map((level) => ({
          level,
          color: colors[level],
          // The reference remains the selected year's largest day, independently for each metric.
          label: `本年单日最多记录${this.data.metric === 'quantity' ? '数量' : '时间'}的${(level - 1) * 25}%至${level * 25}%`,
        })),
        selectedCount: this._selected.length,
      });
      return;
    }
    const result = statistics(
      this._rows,
      this.data.metric,
      this.data.period,
      this.data.offset,
      dateKey(),
    );
    this._selected = result.selected;
    this.setData({
      points: result.points,
      baseline: result.baseline,
      // Format only the caption; selection and cumulative baselines still use full ISO dates.
      periodLabel:
        this.data.period === 'all'
          ? '全部时间'
          : this.data.period === 'day'
            ? displayDate(result.start)
            : displayDate(result.start) + '—' + displayDate(result.end),
      selectedCount: result.selected.length,
      unit: this.data.metric === 'quantity' ? p.quantityUnit : p.timeUnit,
      factor: this.data.metric === 'quantity' ? 1 : factors[p.timeUnit],
    });
  },
  viewRows(rows: PracticeRecord[]) {
    return recordRows(this.data.project!, rows);
  },
  list(preserveCount = false) {
    if (this.data.expanded) {
      // An edit/delete refresh keeps the user's loaded history window instead of collapsing back to page one.
      const limit = preserveCount ? Math.max(20, this.data.records.length) : 20;
      const page = recordPage(this._rows, this._id, null, limit);
      this._cursor = page.cursor;
      this.setData({ records: this.viewRows(page.items), hasMore: page.hasMore });
    } else
      this.setData({
        records: this.viewRows(sortRecords(this._selected).slice(0, 5)),
        hasMore: false,
      });
  },
  metric(e: WechatMiniprogram.TouchEvent) {
    this.setData({ metric: e.currentTarget.dataset.id as Metric, calendarDate: '' });
    this.chart();
    if (this.data.chartMode === 'calendar') {
      this.setData({ expanded: false });
      this.list();
    }
  },
  mode(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode;
    if (!['cumulative', 'distribution', 'calendar'].includes(mode)) return;
    this.setData({ chartMode: mode, calendarDate: '', expanded: false });
    this._cursor = null;
    this.chart();
    this.list();
  },
  calendarMonth(e: WechatMiniprogram.TouchEvent) {
    const delta = Number(e.currentTarget.dataset.delta);
    if (this.data.chartMode !== 'calendar' || (delta !== -1 && delta !== 1)) return;
    if (delta < 0 ? !this.data.calendarPrevious : !this.data.calendarNext) return;
    this.setData({
      calendarOffset: this.data.calendarOffset + delta,
      calendarDate: '',
      expanded: false,
    });
    this._cursor = null;
    this.chart();
    this.list();
  },
  calendarDay(e: WechatMiniprogram.TouchEvent) {
    const date = e.currentTarget.dataset.date;
    const cell = this.data.calendarCells.find((day) => day.date === date);
    // Reject synthetic events for future/outside cells as well as visually disabling their buttons.
    if (this.data.chartMode !== 'calendar' || !cell || cell.disabled) return;
    this.setData({ calendarDate: this.data.calendarDate === date ? '' : date, expanded: false });
    this._cursor = null;
    this.chart();
    this.list();
  },
  calendarClear() {
    this.setData({ calendarDate: '', expanded: false });
    this.chart();
    this.list();
  },
  period(e: WechatMiniprogram.TouchEvent) {
    this.setData({ period: e.currentTarget.dataset.id as Period, offset: 0, expanded: false });
    this._cursor = null;
    this.chart();
    this.list();
  },
  previous() {
    this.setData({ offset: this.data.offset - 1, expanded: false });
    this.chart();
    this.list();
  },
  next() {
    if (this.data.offset >= 0) return;
    this.setData({ offset: this.data.offset + 1, expanded: false });
    this.chart();
    this.list();
  },
  expand() {
    this.setData({ expanded: true, toast: '', calendarDate: '' });
    if (this.data.chartMode === 'calendar') this.chart();
    this.list();
  },
  collapse() {
    this.setData({ expanded: false });
    this._cursor = null;
    this.list();
    wx.pageScrollTo({ selector: '#record-section', offsetTop: -this.data.navHeight, duration: 0 });
  },
  more() {
    if (!this.data.expanded || !this.data.hasMore) return;
    const result = recordPage(this._rows, this._id, this._cursor);
    this._cursor = result.cursor;
    const start = this.data.records.length,
      updates: Record<string, unknown> = { hasMore: result.hasMore };
    this.viewRows(result.items).forEach((row, i) => {
      updates[`records[${start + i}]`] = row;
    });
    this.setData(updates);
  },
  onReachBottom() {
    if (this.data.expanded && this.data.hasMore) this.more();
  },
  editRecord(e: WechatMiniprogram.TouchEvent) {
    const r = this._rows.find((r) => r.id === e.currentTarget.dataset.id);
    if (!r || !this.data.project) return;
    this.setData({ toast: '', sheetOpen: true });
    this.selectComponent('#record-sheet')?.open(this.data.project, r);
  },
  async saved() {
    await this.load();
    wx.showToast({ title: '已保存修改', icon: 'none' });
  },
  async deleted() {
    await this.load();
    this.setData({ toast: '已删除记录', expiresAt: this._db?.undo?.expiresAt || 0 });
  },
  sheetClosed() {
    // Restore the canvas only after the native exit animation has released the overlay.
    this.setData({ sheetOpen: false });
  },
  async recordMenu(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id),
      r = this._rows.find((r) => r.id === id);
    if (!r) return;
    this.setData({ toast: '' });
    const answer = await wx
      .showActionSheet({ itemList: ['编辑记录', '删除记录'] })
      .catch(() => null);
    if (answer?.tapIndex === 0) {
      this.setData({ sheetOpen: true });
      this.selectComponent('#record-sheet')?.open(this.data.project, r);
    } else if (answer?.tapIndex === 1) {
      try {
        await service().deleteRecord(r.id, r.revision);
        await this.load();
        this.setData({ toast: '已删除记录', expiresAt: this._db?.undo?.expiresAt || 0 });
      } catch (error) {
        this.setData({ error: errorText(error) });
      }
    }
  },
  async undo() {
    try {
      await service().undo();
      this.setData({ toast: '' });
      await this.load();
      wx.showToast({ title: '已撤销', icon: 'none' });
    } catch (error) {
      this.setData({ toast: '', error: errorText(error) });
    }
  },
  settings() {
    this.setData({ toast: '' });
    wx.navigateTo({ url: '/pages/project-edit/index?id=' + this._id });
  },
  async deleteProject() {
    if (this.data.deleting) return;
    this.setData({ toast: '' });
    // Mention history only when deleting this project will also remove saved records.
    const recordSummary = this.data.historyCount > 0 ? `及其 ${this.data.historyCount} 条记录` : '';
    const answer = await wx.showModal({
      title: `删除「${this.data.project?.name || ''}」？`,
      content: `将删除此项目${recordSummary}，且无法恢复。`,
      confirmText: '删除项目',
      confirmColor: '#c52e3d',
    });
    if (!answer.confirm) return;
    this.setData({ deleting: true });
    try {
      await service().repository.deleteProject(this._id);
      if (getCurrentPages().length > 1) wx.navigateBack();
      else wx.reLaunch({ url: '/pages/home/index' });
    } catch (error) {
      this.setData({ deleting: false, error: errorText(error) });
    }
  },
});
