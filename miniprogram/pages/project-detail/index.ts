import { prepare, service } from '../../application/service';
import { recordPage, type RecordCursor } from '../../application/query';
import { errorText, metricText, recordText, visibleMetrics } from '../../application/presentation';
import {
  dateKey,
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
/** Chart scope and full-history pagination are independent: expanding records never changes chart totals. */
Page({
  data: {
    project: null as Project | null,
    loading: true,
    error: '',
    metric: 'durationSeconds' as Metric,
    metrics: [] as { id: Metric; label: string }[],
    summaries: [] as { id: Metric; label: string; text: string }[],
    stackedSummary: false,
    period: 'all' as Period,
    periods: [
      { id: 'day', label: '日' },
      { id: 'week', label: '周' },
      { id: 'month', label: '月' },
      { id: 'year', label: '年' },
      { id: 'all', label: '全部' },
    ],
    offset: 0,
    chartMode: 'cumulative',
    points: [] as ChartPoint[],
    baseline: 0,
    periodLabel: '',
    unit: '分',
    factor: 60,
    color: '#6745c6',
    records: [] as { id: string; date: string; value: string; note: string }[],
    expanded: false,
    hasMore: false,
    historyCount: 0,
    selectedCount: 0,
    toast: '',
    expiresAt: 0,
    navHeight: 88,
    deleting: false,
    sheetOpen: false,
  },
  _id: '',
  _db: null as Database | null,
  _rows: [] as PracticeRecord[],
  _selected: [] as PracticeRecord[],
  _cursor: null as RecordCursor | null,
  _request: 0,
  _alive: true,
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
    this.setData({ navHeight: e.detail.height });
  },
  async load() {
    const request = ++this._request;
    try {
      const db = await prepare();
      if (!this._alive || request !== this._request) return;
      const project = db.projects.find((p) => p.id === this._id);
      if (!project) throw new Error('项目已经不存在。');
      this._db = db;
      this._rows = db.records.filter((r) => r.projectId === project.id);
      const metrics = visibleMetrics(project, this._rows);
      const first = !this.data.project;
      const metric =
        first || !metrics.includes(this.data.metric) ? project.primaryMetric : this.data.metric;
      this.setData({
        project,
        metric,
        metrics: metrics.map((id) => ({ id, label: id === 'quantity' ? '数量' : '时间' })),
        summaries: metrics.map((id) => ({
          id,
          label: id === 'quantity' ? '累计数量' : '累计时间',
          text:
            this._rows.some((r) => r[id] != null) || !this._rows.length
              ? metricText(project, id, total(this._rows, id))
              : '未记录',
        })),
        historyCount: this._rows.length,
        color: palettes[project.color],
        loading: false,
        error: '',
      });
      this.setData({ stackedSummary: this.data.summaries.some((item) => item.text.length > 11) });
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
      periodLabel: result.label,
      selectedCount: result.selected.length,
      unit: this.data.metric === 'quantity' ? p.quantityUnit : p.timeUnit,
      factor: this.data.metric === 'quantity' ? 1 : factors[p.timeUnit],
    });
  },
  viewRows(rows: PracticeRecord[]) {
    return rows.map((r) => ({
      id: r.id,
      date: r.occurredOn + (r.localTime ? ' ' + r.localTime : ''),
      value: recordText(this.data.project!, r),
      note:
        Array.from(r.note).length > 120 ? Array.from(r.note).slice(0, 120).join('') + '…' : r.note,
    }));
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
    this.setData({ metric: e.currentTarget.dataset.id as Metric });
    this.chart();
  },
  mode(e: WechatMiniprogram.TouchEvent) {
    this.setData({ chartMode: e.currentTarget.dataset.mode });
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
    this.setData({ expanded: true, toast: '' });
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
    const answer = await wx.showModal({
      title: '删除本项目？',
      content: `将删除「${this.data.project?.name || ''}」及 ${this.data.historyCount} 条打卡记录，无法撤销。`,
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
