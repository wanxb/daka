import { prepare, service } from '../../application/service';
import { errorText } from '../../application/presentation';
import { renderShareImage } from '../../application/share-render';
import {
  shareSourceVersion,
  takeShare,
  type ShareRequest,
  type ShareSnapshot,
} from '../../application/share-snapshot';
import {
  imageShareCapabilities,
  isShareCancel,
  releaseShareImage,
  saveShareImage,
  shareImage,
} from '../../application/share-platform';

/** This private, read-only preview owns its canvas and files, never project or record mutations. */
Page({
  data: {
    snapshot: null as ShareSnapshot | null,
    image: '',
    loading: true,
    error: '',
    invalid: false,
    busy: false,
    timeline: false,
    canShare: false,
    canvasHeight: 1200,
    undoMessage: '',
    expiresAt: 0,
    color: '#6745c6',
    navHeight: 88,
  },
  _request: null as ShareRequest | null,
  _generation: 0,
  _alive: true,
  _visible: false,
  onLoad(options: Record<string, string | undefined>) {
    this._request = takeShare(options.token || '');
    if (!this._request) {
      this.setData({ loading: false, invalid: true, error: '预览已失效，请返回重新分享' });
      return;
    }
    const snapshot = this._request.snapshot,
      capabilities = imageShareCapabilities();
    this.setData({
      snapshot,
      color: snapshot.color,
      timeline: capabilities.timeline,
      canShare: capabilities.imageMenu,
    });
    // Native menu sharing must never forward the private preview route or its ephemeral token.
    wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  },
  onShow() {
    this._visible = true;
    void this.refresh();
  },
  onHide() {
    this._visible = false;
  },
  onUnload() {
    this._alive = false;
    this._generation++;
    if (this.data.image) releaseShareImage(this.data.image);
    this._request = null;
  },
  navLayout(e: WechatMiniprogram.CustomEvent<{ height: number }>) {
    this.setData({ navHeight: e.detail.height });
  },
  async refresh() {
    if (!(await this.validate())) return;
    if (!this.data.image && !this.data.error) await this.generate();
  },
  /** Refresh after returning from background and before every export; undo retains its absolute repository deadline. */
  async validate(): Promise<boolean> {
    const request = this._request;
    if (!request || !this._alive) return false;
    try {
      const db = await prepare();
      if (!this._alive) return false;
      if (shareSourceVersion(db, request.selection.projectId) !== request.version) {
        this._generation++;
        if (this.data.image) releaseShareImage(this.data.image);
        this.setData({
          invalid: true,
          loading: false,
          image: '',
          error: '记录已变更，请返回重新分享',
          undoMessage: '',
          expiresAt: 0,
        });
        return false;
      }
      const undo =
        request.selection.kind === 'record' &&
        db.undo?.type === 'create' &&
        db.undo.record.id === request.selection.recordId &&
        db.undo.expiresAt > Date.now()
          ? db.undo
          : null;
      this.setData({
        undoMessage: undo ? '这条记录仍可撤销' : '',
        expiresAt: undo?.expiresAt || 0,
      });
      return true;
    } catch (error) {
      if (this._alive) this.setData({ loading: false, error: errorText(error) });
      return false;
    }
  },
  async generate() {
    if (!(await this.validate()) || !this._alive) return;
    const version = ++this._generation,
      snapshot = this._request!.snapshot;
    this.setData({ loading: true, error: '' });
    try {
      const canvas = await new Promise<WechatMiniprogram.Canvas>((resolve, reject) => {
        wx.nextTick(() =>
          this.createSelectorQuery()
            .select('#poster-buffer')
            .fields({ node: true })
            .exec((result) => {
              if (!result[0]?.node) reject(new Error('画布暂时无法使用，请重试'));
              else resolve(result[0].node);
            }),
        );
      });
      if (!this._alive || version !== this._generation) return;
      const path = await renderShareImage(canvas, snapshot, this);
      if (!this._alive || version !== this._generation) {
        releaseShareImage(path);
        return;
      }
      if (!(await this.validate()) || version !== this._generation || !this._alive) {
        releaseShareImage(path);
        return;
      }
      const old = this.data.image;
      this.setData({ image: path, loading: false, error: '' });
      if (old) releaseShareImage(old);
    } catch (error) {
      if (this._alive && version === this._generation)
        this.setData({ loading: false, error: errorText(error) });
    }
  },
  async share() {
    await this.act(false);
  },
  /** A late error for an old image cannot invalidate a newly regenerated file. */
  imageFailed(e: WechatMiniprogram.CustomEvent) {
    if (!this._alive || e.currentTarget.dataset.path !== this.data.image) return;
    releaseShareImage(this.data.image);
    this.setData({ image: '', loading: false, error: '图片暂时无法显示，请重新生成' });
  },
  async save() {
    await this.act(true);
  },
  /** Repeated taps cannot open concurrent permission/share panels; no callback claims a completed publication. */
  async act(save: boolean) {
    if (this.data.busy || this.data.loading || this.data.invalid || !this.data.image) return;
    this.setData({ busy: true });
    try {
      if (!(await this.validate()) || !this._visible) return;
      if (save) {
        if (await saveShareImage(this.data.image))
          wx.showToast({ title: '已保存到相册', icon: 'none' });
      } else await shareImage(this.data.image);
    } catch (error) {
      if (!isShareCancel(error) && this._alive)
        wx.showToast({ title: '保存或分享未完成，请重试', icon: 'none' });
    } finally {
      if (this._alive) this.setData({ busy: false });
    }
  },
  async undo() {
    try {
      await service().undo();
      await this.validate();
    } catch (error) {
      wx.showToast({ title: errorText(error), icon: 'none' });
    }
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/home/index' });
  },
});
