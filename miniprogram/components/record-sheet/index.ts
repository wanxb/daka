import {
  dateKey,
  enabled,
  factors,
  metricOrder,
  newId,
  parseTime,
  positive,
  PracticeError,
  timeText,
  amountText,
  type Metric,
  type PracticeRecord,
  type Project,
} from '../../domain/model';
import { service } from '../../application/service';
import { errorText } from '../../application/presentation';
interface Field {
  metric: Metric;
  label: string;
  unit: string;
  min: number;
  max: number;
  canonical: number | null;
  raw: string;
  display: string;
  position: number;
  dirty: boolean;
  precise: boolean;
  disabled: boolean;
  error: string;
}
/** The session is disposable. Only the explicit save command may cross the repository boundary. */
Component({
  data: {
    mounted: false,
    opened: false,
    busy: false,
    project: null as Project | null,
    original: null as PracticeRecord | null,
    recordId: '',
    fields: [] as Field[],
    today: dateKey(),
    date: dateKey(),
    time: '',
    note: '',
    dateOpen: false,
    noteOpen: false,
    error: '',
  },
  methods: {
    open(project: Project, original?: PracticeRecord) {
      if (this.data.busy) return;
      const fields = metricOrder(project)
        .filter((m) => enabled(project, m) || original?.[m] != null)
        .map((metric) => {
          const isTime = metric === 'durationSeconds',
            min = isTime ? project.timeMin : project.quantityMin,
            max = isTime ? project.timeMax : project.quantityMax;
          const canonical = original
            ? original[metric]
            : isTime
              ? project.defaultTime * factors[project.timeUnit]
              : project.defaultQuantity;
          const value =
            canonical == null ? null : isTime ? canonical / factors[project.timeUnit] : canonical;
          return {
            metric,
            label: isTime ? '时间' : '数量',
            unit: isTime ? project.timeUnit : project.quantityUnit,
            min,
            max,
            canonical,
            raw: value == null ? '' : String(Number(value.toFixed(4))),
            display:
              canonical == null
                ? '未记录'
                : isTime
                  ? timeText(canonical, project.timeUnit)
                  : amountText(canonical) + project.quantityUnit,
            position: value == null ? min : Math.min(max, Math.max(min, value)),
            dirty: false,
            precise: false,
            disabled: !enabled(project, metric) || canonical == null,
            error: '',
          };
        });
      this.setData({
        mounted: true,
        opened: true,
        busy: false,
        project,
        original: original || null,
        recordId: original?.id || newId(),
        fields,
        today: dateKey(),
        date: original?.occurredOn || dateKey(),
        time: original?.localTime || '',
        note: original?.note || '',
        dateOpen: false,
        noteOpen: !!original?.note,
        error: '',
      });
    },
    close() {
      if (this.data.busy) return;
      // Keep geometry/content intact during the native exit animation; destroy the session only afterwards.
      this.setData({ opened: false });
      wx.hideKeyboard();
    },
    beforeLeave() {
      this.setData({ opened: false });
      if (!this.data.busy) wx.hideKeyboard();
    },
    afterLeave() {
      if (this.data.opened || this.data.busy) return;
      this.setData({
        mounted: false,
        fields: [],
        note: '',
        error: '',
        project: null,
        original: null,
        recordId: '',
      });
      this.triggerEvent('closed');
    },
    slide(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
      const i = Number(e.currentTarget.dataset.index),
        f = this.data.fields[i],
        p = this.data.project!;
      if (this.data.busy || f.disabled) return;
      // Native step=1 keeps keyboard/assistive increments meaningful; movement never commits a record.
      const value = Math.min(f.max, Math.max(1, f.min, Math.round(e.detail.value)));
      const canonical = f.metric === 'durationSeconds' ? value * factors[p.timeUnit] : value;
      this.setData({
        [`fields[${i}].canonical`]: canonical,
        [`fields[${i}].raw`]: String(value),
        [`fields[${i}].display`]:
          f.metric === 'durationSeconds'
            ? timeText(canonical, p.timeUnit)
            : amountText(value) + p.quantityUnit,
        [`fields[${i}].dirty`]: false,
        [`fields[${i}].error`]: '',
        error: '',
      });
    },
    settle(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
      if (this.data.busy) return;
      this.slide(e);
      const i = Number(e.currentTarget.dataset.index),
        f = this.data.fields[i];
      const value =
        f.metric === 'durationSeconds'
          ? f.canonical! / factors[this.data.project!.timeUnit]
          : f.canonical!;
      this.setData({ [`fields[${i}].position`]: Math.min(f.max, Math.max(f.min, value)) });
    },
    precise(e: WechatMiniprogram.TouchEvent) {
      if (this.data.busy) return;
      const i = Number(e.currentTarget.dataset.index);
      if (!this.data.fields[i].disabled) this.setData({ [`fields[${i}].precise`]: true });
    },
    exactInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (this.data.busy) return;
      const i = Number(e.currentTarget.dataset.index);
      this.setData({
        [`fields[${i}].raw`]: e.detail.value,
        [`fields[${i}].dirty`]: true,
        [`fields[${i}].error`]: '',
        error: '',
      });
      const field = this.data.fields[i];
      try {
        const amount =
          field.metric === 'durationSeconds'
            ? parseTime(e.detail.value, this.data.project!.timeUnit) /
              factors[this.data.project!.timeUnit]
            : positive(e.detail.value, '数量');
        if (amount >= field.min && amount <= field.max)
          this.setData({ [`fields[${i}].position`]: amount });
      } catch {
        /* Exact text stays editable until explicit save; invalid input does not move the track. */
      }
    },
    finishExact(index: number): boolean {
      const field = this.data.fields[index],
        project = this.data.project;
      if (!field || !project || this.data.busy) return false;
      try {
        // An untouched approximation is a view of historical seconds, never a replacement for them.
        const canonical = !field.dirty
          ? field.canonical!
          : field.metric === 'durationSeconds'
            ? parseTime(field.raw, project.timeUnit)
            : positive(field.raw, '数量');
        const amount =
          field.metric === 'durationSeconds' ? canonical / factors[project.timeUnit] : canonical;
        if (
          field.dirty &&
          canonical !== this.data.original?.[field.metric] &&
          (amount < field.min || amount > field.max)
        )
          throw new PracticeError(
            'INVALID',
            `${field.label}需在${field.min}～${field.max}${field.unit}范围内。`,
          );
        this.setData({
          [`fields[${index}].canonical`]: canonical,
          [`fields[${index}].dirty`]: false,
          [`fields[${index}].precise`]: false,
          [`fields[${index}].error`]: '',
          [`fields[${index}].display`]:
            field.metric === 'durationSeconds'
              ? timeText(canonical, project.timeUnit)
              : amountText(canonical) + project.quantityUnit,
          [`fields[${index}].position`]: Math.min(field.max, Math.max(field.min, amount)),
        });
        return true;
      } catch (error) {
        this.setData({ [`fields[${index}].error`]: errorText(error) });
        return false;
      }
    },
    confirmExact(e: WechatMiniprogram.CustomEvent) {
      if (this.finishExact(Number(e.currentTarget.dataset.index))) wx.hideKeyboard();
    },
    blurExact(e: WechatMiniprogram.CustomEvent) {
      if (!this.data.opened) return;
      this.finishExact(Number(e.currentTarget.dataset.index));
    },
    toggleDate() {
      if (this.data.busy) return;
      this.setData({ dateOpen: !this.data.dateOpen });
    },
    toggleNote() {
      if (this.data.busy) return;
      this.setData({ noteOpen: !this.data.noteOpen });
    },
    dateChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (this.data.busy) return;
      this.setData({ date: e.detail.value });
    },
    timeChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (this.data.busy) return;
      this.setData({ time: e.detail.value });
    },
    clearTime() {
      if (this.data.busy) return;
      this.setData({ time: '' });
    },
    noteInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (this.data.busy) return;
      this.setData({ note: e.detail.value });
    },
    async save() {
      if (this.data.busy || !this.data.project) return;
      this.setData({ busy: true, error: '' });
      try {
        const p = this.data.project,
          values: { durationSeconds: number | null; quantity: number | null } = {
            durationSeconds: null,
            quantity: null,
          };
        for (const f of this.data.fields)
          values[f.metric] =
            f.canonical == null
              ? null
              : f.dirty
                ? f.metric === 'durationSeconds'
                  ? parseTime(f.raw, p.timeUnit)
                  : positive(f.raw, '数量')
                : f.canonical;
        // Untouched historical seconds bypass rounded display strings, even after a time-unit change.
        const record = await service().saveRecord(
          {
            id: this.data.recordId,
            projectId: p.id,
            occurredOn: this.data.date,
            localTime: this.data.time,
            durationSeconds: values.durationSeconds,
            quantity: values.quantity,
            note: this.data.note,
          },
          this.data.original?.revision,
        );
        const editing = !!this.data.original;
        this.setData({ busy: false });
        this.close();
        this.triggerEvent('saved', { record, editing });
      } catch (error) {
        this.setData({ busy: false, mounted: true, opened: true, error: errorText(error) });
      }
    },
  },
});
