import {
  dateKey,
  enabled,
  factors,
  metricOrder,
  newId,
  parseTime,
  positive,
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
}
/** The session is disposable. Only the explicit save command may cross the repository boundary. */
Component({
  data: {
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
          };
        });
      this.setData({
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
      this.setData({
        opened: false,
        fields: [],
        note: '',
        error: '',
        project: null,
        original: null,
      });
      this.triggerEvent('closed');
    },
    beforeLeave() {
      // Native back dismissal may happen during an async write; preserve input until its result is known.
      if (this.data.busy) this.setData({ opened: false });
      else if (this.data.opened) this.close();
    },
    slide(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
      const i = Number(e.currentTarget.dataset.index),
        f = this.data.fields[i],
        p = this.data.project!;
      if (f.disabled) return;
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
        error: '',
      });
    },
    settle(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
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
      const i = Number(e.currentTarget.dataset.index);
      if (!this.data.fields[i].disabled) this.setData({ [`fields[${i}].precise`]: true });
    },
    exactInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const i = Number(e.currentTarget.dataset.index);
      this.setData({
        [`fields[${i}].raw`]: e.detail.value,
        [`fields[${i}].dirty`]: true,
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
    toggleDate() {
      this.setData({ dateOpen: !this.data.dateOpen });
    },
    toggleNote() {
      this.setData({ noteOpen: !this.data.noteOpen });
    },
    dateChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.setData({ date: e.detail.value });
    },
    timeChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.setData({ time: e.detail.value });
    },
    clearTime() {
      this.setData({ time: '' });
    },
    noteInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
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
        this.setData({ busy: false, opened: true, error: errorText(error) });
      }
    },
  },
});
