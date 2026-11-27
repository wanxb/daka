import { prepare, service } from '../../application/service';
import { errorText, projectTile, recordText } from '../../application/presentation';
import { newId, canQuickRecord, dateKey, type PracticeRecord } from '../../domain/model';
import { inputLimits, limitText } from '../../domain/input-limits';
import { homeData, homeState } from './state';
import { arrangingMethods } from './arranging';
import { feedbackMethods } from './feedback';
import { shareDirect } from '../../application/share-direct';
/** The page composes cohesive actions without changing native handler names or lifecycle ordering. */
Page({
  data: homeData,
  ...homeState,
  ...arrangingMethods,
  ...feedbackMethods,
  /** Use the measured native chrome and safe area so three rows fit without assuming an iPhone notch. */
  layout(e?: WechatMiniprogram.CustomEvent<{ height: number }>) {
    if (e) this._navigationHeight = e.detail.height;
    const info = wx.getWindowInfo();
    const bottom = info.safeArea ? Math.max(36, info.screenHeight - info.safeArea.bottom) : 36;
    const available = info.windowHeight - this._navigationHeight - 4 - 44 - 20 - 24 - bottom;
    this.setData({
      navigationHeight: this._navigationHeight,
      tileHeight: Math.max(144, Math.min(208, Math.floor(available / 3))),
    });
  },
  onResize() {
    this.stopCelebration();
    this.cancelDrag();
    this.layout();
  },
  onShow() {
    this._alive = true;
    this._visible = true;
    void this.load();
  },
  onHide() {
    this._shareEpoch++;
    this._visible = false;
    this.stopCelebration();
    // Backgrounding abandons only an unfinished sort; confirmed deletions have already committed.
    this.cancelDrag();
    this.setData({ arranging: false });
  },
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    // Viewport coordinates become stale as soon as the page moves; do not make artwork follow another card.
    this.stopCelebration();
    this._scrollTop = e.scrollTop;
    if (this._drag) this.previewDrag();
  },
  onUnload() {
    this.stopCelebration();
    this.cancelDrag();
    this._alive = false;
    this._loadVersion++;
  },
  async load() {
    const version = ++this._loadVersion;
    try {
      const db = await prepare();
      if (!this._alive || version !== this._loadVersion) return;
      this._db = db;
      // Returning from a preview must not restore sharing for an expired, superseded or undone record.
      if (
        this.data.shareRecordId &&
        (db.undo?.type !== 'create' ||
          db.undo.record.id !== this.data.shareRecordId ||
          db.undo.expiresAt <= Date.now())
      )
        this.setData({ shareRecordId: '', toast: '' });
      if (this.data.arranging) {
        const current = db.projects.map((p) => p.id);
        this._orderIds = this._orderIds
          .filter((id) => current.includes(id))
          .concat(current.filter((id) => !this._orderIds.includes(id)));
        this._originalOrder = current;
      }
      this.setData({ loading: false, loadError: false, error: '' });
      this.filter();
    } catch (error) {
      if (this._alive && version === this._loadVersion)
        this.setData({ loading: false, loadError: true, error: errorText(error) });
    }
  },
  filter() {
    const today = dateKey();
    if (this._tileSource !== this._db || this._tileDay !== today) {
      const groups = new Map<string, PracticeRecord[]>();
      // One history pass replaces the previous project-count × record-count scan on every keystroke.
      for (const record of this._db?.records || []) {
        const rows = groups.get(record.projectId) || [];
        rows.push(record);
        groups.set(record.projectId, rows);
      }
      this._tileCache = (this._db?.projects || []).map((p) =>
        projectTile(p, groups.get(p.id) || [], today),
      );
      this._tileSource = this._db;
      this._tileDay = today;
    }
    const q = (this.data.arranging ? '' : this.data.query)
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase();
    this.setData({
      // Count all projects, including those hidden by the current search; old over-limit stores stay intact.
      projectLimitReached: (this._db?.projects.length || 0) >= inputLimits.projects,
      tiles: (this.data.arranging
        ? this._orderIds
            .map((id) => this._tileCache.find((p) => p.id === id))
            .filter((p): p is NonNullable<typeof p> => !!p)
        : this._tileCache
      ).filter((p) => p.name.normalize('NFKC').toLocaleLowerCase().includes(q)),
    });
  },
  search(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const query = limitText(e.detail.value, inputLimits.search);
    this.setData({ query });
    this.filter();
    if (query !== e.detail.value) return query;
    return undefined;
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
    if (!this._db || this.data.busyId || this.data.arranging) return;
    if (this._db.projects.length >= inputLimits.projects) {
      wx.showToast({ title: `体验版最多${inputLimits.projects}个打卡项目`, icon: 'none' });
      return;
    }
    this.stopCelebration();
    this.setData({ toast: '' });
    wx.navigateTo({ url: '/pages/project-edit/index' });
  },
  detail(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busyId || this.data.arranging || Date.now() < this._suppressTapUntil) return;
    this.stopCelebration();
    this.setData({ toast: '' });
    wx.navigateTo({ url: '/pages/project-detail/index?id=' + e.currentTarget.dataset.id });
  },
  async record(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id),
      p = this._db?.projects.find((p) => p.id === id);
    if (!p || this.data.busyId || this.data.arranging || Date.now() < this._suppressTapUntil)
      return;
    this.stopCelebration();
    this.setData({ toast: '' });
    if (!p.directEntryEnabled || !canQuickRecord(p)) {
      this._sheetOpen = true;
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
      this.notify('已记录 ' + recordText(p, record), record);
      this.celebrateRecord(record);
    } catch (error) {
      this.setData({ error: errorText(error) });
    } finally {
      this.setData({ busyId: '' });
    }
  },
  /** Share the committed result in place; exporting never changes the undo deadline. */
  async shareRecord() {
    if (this._sharing || !this.data.shareRecordId) return;
    const recordId = this.data.shareRecordId;
    this._sharing = true;
    const shareEpoch = this._shareEpoch;
    this.stopCelebration();
    try {
      const db = await prepare(),
        record = db.records.find((r) => r.id === recordId);
      if (!record || recordId !== this.data.shareRecordId || !this._alive || !this._visible) return;
      await shareDirect(
        this,
        {
          kind: 'record',
          projectId: record.projectId,
          recordId: record.id,
        },
        () => this._alive && this._visible && shareEpoch === this._shareEpoch,
      );
    } catch (error) {
      wx.showToast({ title: errorText(error), icon: 'none' });
    } finally {
      this._sharing = false;
    }
  },
  async undo() {
    this.stopCelebration();
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
