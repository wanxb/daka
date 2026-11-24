import { prepare, service } from '../../application/service';
import { errorText } from '../../application/presentation';
import {
  initialForm,
  midpoint,
  palettes,
  projectForm,
  range,
  type ProjectForm,
  type Project,
} from '../../domain/model';
type FieldEvent = WechatMiniprogram.CustomEvent<{ value: string }>;
/** Configuration owns a separate raw draft; hiding a metric never destroys its parameters. */
Page({
  data: {
    form: initialForm(),
    editing: false,
    loading: true,
    ready: false,
    busy: false,
    error: '',
    locked: false,
    palette: palettes,
    colors: Object.keys(palettes).map((id) => ({
      id,
      label: (
        { purple: '紫色', orange: '橙色', blue: '蓝色', teal: '青色', rose: '玫红色' } as Record<
          string,
          string
        >
      )[id],
      color: palettes[id as keyof typeof palettes],
    })),
    icons: ['book', 'rope', 'dumbbell', 'piano', 'target'],
    units: ['时', '分', '秒'],
  },
  _original: null as Project | null,
  _initial: '',
  _created: false,
  _timer: 0,
  _ready: false,
  _draft: Promise.resolve(),
  _rangeKeys: { time: '', quantity: '' },
  async onLoad(options: Record<string, string | undefined>) {
    try {
      const db = await prepare(),
        p = options.id ? db.projects.find((p) => p.id === options.id) : undefined;
      if (options.id && !p) throw new Error('项目已经不存在。');
      this._original = p || null;
      const form = p ? projectForm(p) : db.newProjectDraft || initialForm();
      this._initial = JSON.stringify(form);
      this._rangeKeys = {
        time: form.timeMin + '|' + form.timeMax,
        quantity: form.quantityMin + '|' + form.quantityMax,
      };
      this._ready = true;
      this.setData({
        form,
        editing: !!p,
        locked: !!p?.quantityUnitLocked,
        ready: true,
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, error: errorText(error) });
    }
  },
  onHide() {
    void this.flushDraft().catch(() => undefined);
  },
  onUnload() {
    if (this._timer) clearTimeout(this._timer);
    void this.flushDraft().catch(() => undefined);
  },
  changed() {
    if (this.data.editing) {
      if (JSON.stringify(this.data.form) !== this._initial)
        wx.enableAlertBeforeUnload({ message: '项目设置尚未保存' });
      else wx.disableAlertBeforeUnload();
    } else {
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        void this.flushDraft().catch(() => undefined);
      }, 250);
    }
  },
  async flushDraft() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = 0;
    }
    if (!this._ready || this.data.editing || this._created) return;
    const form = { ...this.data.form };
    this._draft = service().saveDraft(form);
    try {
      await this._draft;
    } catch (error) {
      this.setData({ error: '草稿未保存：' + errorText(error) });
      throw error;
    }
  },
  text(e: FieldEvent) {
    if (this.data.busy || !this._ready) return;
    const field = String(e.currentTarget.dataset.field) as keyof ProjectForm;
    this.setData({ [`form.${field}`]: e.detail.value, error: '' });
    this.changed();
  },
  choose(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || !this._ready) return;
    const field = String(e.currentTarget.dataset.field);
    this.setData({ [`form.${field}`]: e.currentTarget.dataset.value, error: '' });
    this.changed();
  },
  toggle(e: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    if (this.data.busy || !this._ready) return;
    const field = String(e.currentTarget.dataset.field);
    this.setData({ [`form.${field}`]: e.detail.value, error: '' });
    this.changed();
  },
  settleRange(kind: 'time' | 'quantity'): boolean {
    const f = this.data.form,
      key = f[`${kind}Min`] + '|' + f[`${kind}Max`];
    if (key === this._rangeKeys[kind]) return false;
    try {
      const [a, b] = range(f[`${kind}Min`], f[`${kind}Max`], kind === 'time' ? '时间' : '数量');
      this._rangeKeys[kind] = key;
      this.setData({
        [`form.${kind === 'time' ? 'defaultTime' : 'defaultQuantity'}`]: String(midpoint(a, b)),
      });
      return true;
    } catch {
      return false; /* Incomplete raw ranges stay intact until the user explicitly saves. */
    }
  },
  settleDefault(kind: 'time' | 'quantity'): boolean {
    const f = this.data.form,
      key = kind === 'time' ? 'defaultTime' : 'defaultQuantity';
    try {
      const [a, b] = range(f[`${kind}Min`], f[`${kind}Max`], ''),
        n = Number(f[key]);
      const value = String(
        f[key].trim() !== '' && Number.isFinite(n)
          ? Math.min(b, Math.max(1, a, Math.floor(n)))
          : midpoint(a, b),
      );
      if (value === f[key]) return false;
      this.setData({ [`form.${key}`]: value });
      return true;
    } catch {
      return false; /* Never clamp a default against an invalid range while it is being edited. */
    }
  },
  rangeBlur(e: FieldEvent) {
    if (this.data.busy) return;
    if (this.settleRange(e.currentTarget.dataset.kind === 'quantity' ? 'quantity' : 'time'))
      this.changed();
  },
  defaultBlur(e: FieldEvent) {
    if (this.data.busy) return;
    if (this.settleDefault(e.currentTarget.dataset.kind === 'quantity' ? 'quantity' : 'time'))
      this.changed();
  },
  explainUnitLock() {
    if (this.data.locked && !this.data.busy)
      wx.showToast({ title: '已有数量记录，单位已固定', icon: 'none' });
  },
  async cancel() {
    if (this.data.busy) return;
    if (this.data.editing && JSON.stringify(this.data.form) !== this._initial) {
      const answer = await wx.showModal({
        title: '放弃未保存的修改？',
        confirmText: '放弃修改',
        cancelText: '继续编辑',
      });
      if (!answer.confirm) return;
    }
    if (!this.data.editing) {
      try {
        await this.flushDraft();
      } catch {
        return;
      }
    }
    wx.disableAlertBeforeUnload();
    this.leave();
  },
  leave() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/home/index' });
  },
  async save() {
    if (this.data.busy || !this._ready) return;
    // Finalize focused fields before freezing the submitted configuration; blur ordering differs by keyboard/platform.
    for (const kind of ['time', 'quantity'] as const) {
      this.settleRange(kind);
      this.settleDefault(kind);
    }
    const submitted = { ...this.data.form };
    this.setData({ busy: true, error: '' });
    wx.hideKeyboard();
    try {
      if (!this.data.editing) await this.flushDraft();
      await service().saveProject(submitted, this._original?.revision);
      this._created = true;
      if (this._timer) clearTimeout(this._timer);
      wx.disableAlertBeforeUnload();
      if (!this.data.editing) {
        const pages = getCurrentPages(),
          home = pages.find((p) => p.route === 'pages/home/index');
        home?.setData({ query: '' });
      }
      this.leave();
    } catch (error) {
      this.setData({ error: errorText(error), busy: false });
    }
  },
});
