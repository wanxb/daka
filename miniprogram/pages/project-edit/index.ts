import { prepare, service } from '../../application/service';
import { submission } from '../../domain/command-receipt';
import type { CommandReceipt } from '../../domain/types';
import { errorText } from '../../application/presentation';
import { frequencyOptions, frequencyNames } from '../../domain/frequency';
import { appearanceChoices } from '../../application/appearance';
import {
  changeTimeUnit,
  prepareProjectForm,
  projectFocusTarget,
} from '../../application/project-form';
import { colorOptions, projectIcons, resolveProjectIcon } from '../../domain/appearance';
import {
  initialForm,
  makeProject,
  midpoint,
  palettes,
  projectForm,
  range,
  readFrequency,
  timeUnitLabels,
  type ProjectForm,
  type Project,
  type TimeUnit,
} from '../../domain/model';
import {
  inputLimits,
  timeInputLimits,
  selectableTimeUnits,
  timeIntegerLengths,
  acceptTextDraft,
  singleLine,
  acceptNumericDraft,
} from '../../domain/input-limits';
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
    canSave: false,
    focusedField: '',
    navigationHeight: 88,
    locked: false,
    palette: palettes,
    ...appearanceChoices({ color: 'purple', icon: 'book' }, false),
    appearanceExpanded: false,
    // The ordered catalog excludes the legacy seconds unit without changing saved record values.
    units: [...selectableTimeUnits],
    timeUnitLabels,
    frequencies: frequencyOptions,
    frequencyNames,
    limits: inputLimits,
    timeLengths: timeIntegerLengths,
  },
  _original: null as Project | null,
  _submission: null as CommandReceipt | null,
  _initial: '',
  _created: false,
  _timer: 0,
  _ready: false,
  _focusVersion: 0,
  _rangeKeys: { time: '', quantity: '' },
  async onLoad(options: Record<string, string | undefined>) {
    try {
      const db = await prepare(),
        p = options.id ? db.projects.find((p) => p.id === options.id) : undefined;
      if (options.id && !p) throw new Error('此项目已不存在，请返回首页。');
      this._original = p || null;
      this._submission = null;
      const raw = p ? projectForm(p) : db.newProjectDraft || initialForm();
      // Only missing legacy cadence defaults to daily; invalid persisted values remain a domain error.
      // Legacy drafts highlight the matching current option without migrating their original stored data.
      const form = {
        ...raw,
        icon: resolveProjectIcon(raw.icon),
        frequency: readFrequency(raw.frequency),
      };
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
        ...appearanceChoices(form, false),
      });
      this.syncCanSave();
    } catch (error) {
      this.setData({ loading: false, error: errorText(error) });
    }
  },
  onHide() {
    this._focusVersion++;
    void this.flushDraft().catch(() => undefined);
  },
  onUnload() {
    this._focusVersion++;
    if (this._timer) clearTimeout(this._timer);
    void this.flushDraft().catch(() => undefined);
  },
  changed() {
    this.syncCanSave();
    if (this.data.editing) {
      if (JSON.stringify(this.data.form) !== this._initial)
        wx.enableAlertBeforeUnload({ message: '设置尚未保存' });
      else wx.disableAlertBeforeUnload();
    } else {
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        void this.flushDraft().catch(() => undefined);
      }, 250);
    }
  },
  syncCanSave() {
    // Validation chooses between a real write and navigation to missing input, without exposing input-limit notices.
    let canSave = false;
    try {
      makeProject(
        prepareProjectForm(this.data.form, this._original || undefined),
        Date.now(),
        this._original || undefined,
      );
      canSave = true;
    } catch {
      /* The same domain boundary still validates every real write. */
    }
    this.setData({ canSave });
    return canSave;
  },
  navigationLayout(e: WechatMiniprogram.CustomEvent<{ height: number }>) {
    this.setData({ navigationHeight: e.detail.height });
  },
  focusRequired() {
    // Unsupported units guide editing back to their own control before any persistence attempt.
    const field = projectFocusTarget(this.data.form);
    // A brief text-only hint explains the blocked save without adding a permanent error row or interrupting typing.
    if (field === 'quantityUnit')
      wx.showToast({ title: '不是有效单位', icon: 'none', duration: 1500, mask: false });
    const version = ++this._focusVersion;
    // Reset native focus before requesting it again, including repeated taps on the same incomplete field.
    this.setData({ focusedField: '' });
    wx.pageScrollTo({
      selector: '#editor-' + field,
      offsetTop: -this.data.navigationHeight - 16,
      duration: 180,
      success: () => {
        // A delayed scroll callback cannot reopen the keyboard after leaving this page.
        if (this.data.busy || !this._ready || version !== this._focusVersion) return;
        this.setData({ focusedField: field === 'types' ? '' : field });
      },
    });
  },
  async flushDraft() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = 0;
    }
    if (!this._ready || this.data.editing || this._created) return;
    const form = { ...this.data.form };
    try {
      // Page free data is cloned per instance; a pending write belongs to this invocation, never the page options.
      await service().saveDraft(form);
    } catch (error) {
      this.setData({ error: '草稿未能保存。' + errorText(error) });
      throw error;
    }
  },
  text(e: FieldEvent) {
    if (this.data.busy || !this._ready) return;
    const field = String(e.currentTarget.dataset.field) as keyof ProjectForm;
    const raw = e.detail.value;
    let value = raw;
    if (field === 'name') {
      value = singleLine(raw);
      if (!acceptTextDraft(value, this.data.form.name, inputLimits.projectName))
        return this.data.form.name;
    } else if (field === 'quantityUnit') {
      if (this.data.locked) return;
      value = singleLine(raw).replace(/\s/g, '');
      if (!acceptTextDraft(value, this.data.form.quantityUnit, inputLimits.quantityUnit))
        return this.data.form.quantityUnit;
    } else if (
      [
        'timeMin',
        'timeMax',
        'defaultTime',
        'quantityMin',
        'quantityMax',
        'defaultQuantity',
      ].includes(field)
    ) {
      const maximum =
        field.startsWith('quantity') || field === 'defaultQuantity'
          ? inputLimits.quantity
          : timeInputLimits[this.data.form.timeUnit];
      const previous = String(this.data.form[field]);
      if (
        !acceptNumericDraft(raw, previous, maximum) ||
        (!field.endsWith('Min') && raw !== '' && Number(raw) === 0)
      ) {
        // Reject the attempted edit without poisoning the last accepted value or exposing input-limit alerts.
        return previous;
      }
    } else return;
    this.setData({ [`form.${field}`]: value, error: '' });
    // Update the dependent default before deriving button state, rather than waiting for a platform-specific blur.
    if (['timeMin', 'timeMax', 'quantityMin', 'quantityMax'].includes(field))
      this.settleRange(field.startsWith('time') ? 'time' : 'quantity');
    this.changed();
    if (value !== raw) return value;
    return undefined;
  },
  choose(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || !this._ready) return;
    const field = String(e.currentTarget.dataset.field);
    // A dataset is not a resource path: accept only known configuration fields and generated preset IDs.
    if (!['timeUnit', 'primaryMetric', 'color', 'icon', 'frequency'].includes(field)) return;
    if (
      field === 'color' &&
      !colorOptions.some((item) => item.id === e.currentTarget.dataset.value)
    )
      return;
    if (field === 'icon' && !projectIcons.some((item) => item.id === e.currentTarget.dataset.value))
      return;
    if (
      field === 'primaryMetric' &&
      !['durationSeconds', 'quantity'].includes(e.currentTarget.dataset.value)
    )
      return;
    if (
      field === 'frequency' &&
      !frequencyOptions.some((item) => item.id === e.currentTarget.dataset.value)
    )
      return;
    if (field === 'timeUnit' && !this.data.units.includes(e.currentTarget.dataset.value)) return;
    if (field === 'timeUnit') {
      const form = changeTimeUnit(this.data.form, e.currentTarget.dataset.value as TimeUnit);
      this.setData({ form, error: '' });
      this._rangeKeys.time = form.timeMin + '|' + form.timeMax;
    } else this.setData({ [`form.${field}`]: e.currentTarget.dataset.value, error: '' });
    if (field === 'color' || field === 'icon')
      this.setData(appearanceChoices(this.data.form, this.data.appearanceExpanded));
    this.changed();
  },
  toggleAppearance() {
    if (this.data.busy || !this._ready) return;
    // Opening options changes no saved configuration and must not mark settings dirty or schedule a draft write.
    const expanded = !this.data.appearanceExpanded;
    this.setData({ appearanceExpanded: expanded, ...appearanceChoices(this.data.form, expanded) });
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
    if (!this.syncCanSave()) {
      // The action stays available as navigation to missing input; incomplete forms still never reach persistence.
      this.focusRequired();
      return;
    }
    // Freeze the exact candidate used by the button. Retain hidden raw fields in the draft if storage fails.
    const submitted = prepareProjectForm(this.data.form, this._original || undefined);
    // Retry the same failed submission, but never reuse its identity after the content changes.
    this._submission = submission(this._submission, [submitted, this._original?.revision]);
    this.setData({ busy: true, error: '' });
    wx.hideKeyboard();
    try {
      if (!this.data.editing) await this.flushDraft();
      await service().saveProject(submitted, this._original?.revision, this._submission.id);
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
