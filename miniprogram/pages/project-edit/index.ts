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
    colors: Object.keys(palettes).map((id) => ({
      id,
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
    const field = String(e.currentTarget.dataset.field) as keyof ProjectForm;
    this.setData({ [`form.${field}`]: e.detail.value, error: '' });
    this.changed();
  },
  choose(e: WechatMiniprogram.TouchEvent) {
    const field = String(e.currentTarget.dataset.field);
    this.setData({ [`form.${field}`]: e.currentTarget.dataset.value, error: '' });
    this.changed();
  },
  toggle(e: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const field = String(e.currentTarget.dataset.field);
    this.setData({ [`form.${field}`]: e.detail.value, error: '' });
    this.changed();
  },
  rangeBlur(e: FieldEvent) {
    const kind = e.currentTarget.dataset.kind === 'quantity' ? 'quantity' : 'time',
      f = this.data.form;
    const key = f[`${kind}Min`] + '|' + f[`${kind}Max`];
    if (key === this._rangeKeys[kind]) return;
    try {
      const [a, b] = range(f[`${kind}Min`], f[`${kind}Max`], kind === 'time' ? '时间' : '数量');
      this._rangeKeys[kind] = key;
      this.setData({
        [`form.${kind === 'time' ? 'defaultTime' : 'defaultQuantity'}`]: String(midpoint(a, b)),
      });
      this.changed();
    } catch {
      /* Incomplete ranges remain editable raw strings and are rejected only on explicit save. */
    }
  },
  defaultBlur(e: FieldEvent) {
    const kind = e.currentTarget.dataset.kind === 'quantity' ? 'quantity' : 'time',
      f = this.data.form;
    try {
      const [a, b] = range(f[`${kind}Min`], f[`${kind}Max`], ''),
        key = kind === 'time' ? 'defaultTime' : 'defaultQuantity';
      const n = Number(f[key]);
      const normalized =
        f[key].trim() !== '' && Number.isFinite(n)
          ? Math.min(b, Math.max(1, a, Math.floor(n)))
          : midpoint(a, b);
      this.setData({ [`form.${key}`]: String(normalized) });
      this.changed();
    } catch {
      /* Never clamp against an invalid range while a user is still typing. */
    }
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
    this.setData({ busy: true, error: '' });
    try {
      if (!this.data.editing) await this.flushDraft();
      await service().saveProject(this.data.form, this._original?.revision);
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
