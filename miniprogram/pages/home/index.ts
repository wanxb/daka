import { prepare, service } from '../../application/service';
import { errorText, projectTile, recordText } from '../../application/presentation';
import { newId, type Database, type PracticeRecord } from '../../domain/model';
/** Home retains its own search/scroll state while all durable commands go through the application layer. */
Page({
  data: {
    query: '',
    searchFocus: false,
    loadError: false,
    tiles: [] as ReturnType<typeof projectTile>[],
    loading: true,
    error: '',
    busyId: '',
    toast: '',
    expiresAt: 0,
  },
  _db: null as Database | null,
  _lastTap: 0,
  _tapProject: '',
  _quickId: '',
  _quickProject: '',
  _alive: true,
  _loadVersion: 0,
  onShow() {
    this._alive = true;
    void this.load();
  },
  onUnload() {
    this._alive = false;
    this._loadVersion++;
  },
  async load() {
    const version = ++this._loadVersion;
    try {
      const db = await prepare();
      if (!this._alive || version !== this._loadVersion) return;
      this._db = db;
      this.setData({ loading: false, loadError: false, error: '' });
      this.filter();
    } catch (error) {
      if (this._alive && version === this._loadVersion)
        this.setData({ loading: false, loadError: true, error: errorText(error) });
    }
  },
  filter() {
    const q = this.data.query.normalize('NFKC').trim().toLocaleLowerCase();
    this.setData({
      tiles: (this._db?.projects || [])
        .filter((p) => p.name.normalize('NFKC').toLocaleLowerCase().includes(q))
        .map((p) =>
          projectTile(
            p,
            this._db!.records.filter((r) => r.projectId === p.id),
          ),
        ),
    });
  },
  search(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ query: e.detail.value });
    this.filter();
  },
  clearSearch() {
    this.setData({ query: '', searchFocus: true });
    this.filter();
  },
  blurSearch() {
    this.setData({ searchFocus: false });
  },
  finishSearch() {
    wx.hideKeyboard();
  },
  add() {
    if (!this._db || this.data.busyId) return;
    this.setData({ toast: '' });
    wx.navigateTo({ url: '/pages/project-edit/index' });
  },
  detail(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busyId) return;
    this.setData({ toast: '' });
    wx.navigateTo({ url: '/pages/project-detail/index?id=' + e.currentTarget.dataset.id });
  },
  async record(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id),
      p = this._db?.projects.find((p) => p.id === id);
    if (!p || this.data.busyId) return;
    this.setData({ toast: '' });
    if (!p.directEntryEnabled) {
      this.selectComponent('#record-sheet')?.open(p);
      return;
    }
    if (this._tapProject === id && Date.now() - this._lastTap < 500) return;
    this._tapProject = id;
    this._lastTap = Date.now();
    if (this._quickProject !== id) {
      this._quickId = '';
      this._quickProject = id;
    }
    this._quickId ||= newId();
    this.setData({ busyId: id });
    try {
      const record = await service().quickRecord(id, this._quickId);
      this._quickId = '';
      await this.load();
      this.notify('已记录 ' + recordText(p, record));
    } catch (error) {
      this.setData({ error: errorText(error) });
    } finally {
      this.setData({ busyId: '' });
    }
  },
  async saved(e: WechatMiniprogram.CustomEvent<{ record: PracticeRecord; editing: boolean }>) {
    await this.load();
    const p = this._db?.projects.find((p) => p.id === e.detail.record.projectId);
    if (p) this.notify('已记录 ' + recordText(p, e.detail.record));
  },
  notify(message: string) {
    this.setData({ toast: message, expiresAt: this._db?.undo?.expiresAt || 0 });
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
});
