import {
  fieldReading,
  recordFields,
  trackProgress,
  type RecordField,
} from '../../application/record-fields';
import {
  dateKey,
  factors,
  newId,
  parseTime,
  positive,
  validateMetricValue,
  validateRecord,
  type RecordInput,
  type PracticeRecord,
  type Project,
} from '../../domain/model';
import { service } from '../../application/service';
import { submission } from '../../domain/command-receipt';
import type { CommandReceipt } from '../../domain/types';
import { errorText, recordDateCaption } from '../../application/presentation';
import {
  inputLimits,
  acceptNumericDraft,
  limitNote,
  normalizeNote,
  textLength,
  noteLineBreaks,
} from '../../domain/input-limits';
// Native Component options do not expose arbitrary instance fields; weak keys isolate sessions without view payloads.
const submissions = new WeakMap<object, CommandReceipt>();
/** The session is disposable. Only the explicit save command may cross the repository boundary. */
Component({
  data: {
    mounted: false,
    opened: false,
    busy: false,
    project: null as Project | null,
    original: null as PracticeRecord | null,
    recordId: '',
    fields: [] as RecordField[],
    today: dateKey(),
    date: dateKey(),
    time: '',
    note: '',
    dateOpen: false,
    noteOpen: false,
    dateDisplay: '今天',
    error: '',
    canSave: false,
    limits: inputLimits,
    noteCount: 0,
    noteLegacy: false,
    noteMaxlength: inputLimits.note * 2,
  },
  methods: {
    open(project: Project, original?: PracticeRecord) {
      if (this.data.busy) return;
      submissions.delete(this);
      const fields = recordFields(project, original);
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
        noteCount: textLength(original?.note || ''),
        noteLegacy:
          !!original &&
          (textLength(original.note) > inputLimits.note ||
            noteLineBreaks(original.note) > inputLimits.noteLineBreaks),
        noteMaxlength: Math.max(inputLimits.note * 2, original?.note.length || 0),
        dateOpen: false,
        // Reveal saved notes on entry; later toggles remain independent and never discard the text.
        noteOpen: !!original?.note.trim(),
        dateDisplay: recordDateCaption(
          original?.occurredOn || dateKey(),
          dateKey(),
          original?.localTime || '',
        ),
        error: '',
      });
      this.syncCanSave();
    },
    close() {
      if (this.data.busy) return;
      // Keep geometry/content intact during the native exit animation; destroy the session only afterwards.
      this.setData({ opened: false, canSave: false });
      wx.hideKeyboard();
    },
    beforeLeave() {
      this.setData({ opened: false, canSave: false });
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
      if (
        !this.data.opened ||
        this.data.busy ||
        !p ||
        !f ||
        f.disabled ||
        !Number.isFinite(e.detail.value)
      )
        return;
      // Native step=1 keeps keyboard/assistive increments meaningful; movement never commits a record.
      const value = Math.min(f.max, Math.max(1, f.min, Math.round(e.detail.value)));
      const canonical = f.metric === 'durationSeconds' ? value * factors[p.timeUnit] : value;
      this.setData({
        [`fields[${i}].canonical`]: canonical,
        [`fields[${i}].raw`]: String(value),
        [`fields[${i}].progress`]: trackProgress(value, f.min, f.max),
        [`fields[${i}].display`]: fieldReading(p, f.metric, canonical).display,
        [`fields[${i}].number`]: fieldReading(p, f.metric, canonical).number,
        [`fields[${i}].dirty`]: false,
        error: '',
      });
      this.syncCanSave();
    },
    settle(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
      // A queued native change can arrive after closing/unmounting; it no longer owns any editable field.
      if (!this.data.opened || this.data.busy || !this.data.project) return;
      this.slide(e);
      const i = Number(e.currentTarget.dataset.index),
        f = this.data.fields[i];
      if (!f || f.disabled || !Number.isFinite(e.detail.value)) return;
      const value =
        f.metric === 'durationSeconds'
          ? f.canonical! / factors[this.data.project!.timeUnit]
          : f.canonical!;
      this.setData({ [`fields[${i}].position`]: Math.min(f.max, Math.max(f.min, value)) });
    },
    precise(e: WechatMiniprogram.TouchEvent) {
      if (!this.data.opened || this.data.busy) return;
      const i = Number(e.currentTarget.dataset.index);
      if (!this.data.fields[i] || this.data.fields[i].disabled) return;
      // Switching fields must not hide an invalid edit or leave its visible readout behind its saved value.
      for (let j = 0; j < this.data.fields.length; j++)
        if (j !== i && this.data.fields[j].precise && !this.finishExact(j)) return;
      this.setData({ [`fields[${i}].precise`]: true });
    },
    exactInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (!this.data.opened || this.data.busy) return;
      const i = Number(e.currentTarget.dataset.index);
      const current = this.data.fields[i];
      if (!current || current.disabled) return;
      if (
        !acceptNumericDraft(e.detail.value, current.raw, current.limit, current.decimals) ||
        (!current.decimals && e.detail.value !== '' && Number(e.detail.value) === 0)
      ) {
        // A rejected keystroke changes neither the accepted value nor its ability to be saved.
        return current.raw;
      }
      this.setData({
        [`fields[${i}].raw`]: e.detail.value,
        [`fields[${i}].dirty`]: true,
        [`fields[${i}].remember`]: true,
        error: '',
      });
      const field = this.data.fields[i];
      try {
        const amount =
          field.metric === 'durationSeconds'
            ? parseTime(e.detail.value, this.data.project!.timeUnit) /
              factors[this.data.project!.timeUnit]
            : positive(e.detail.value, '数量');
        // Expansion belongs to this disposable sheet until Record commits it with the project preferences.
        const min = Math.min(field.min, Math.floor(amount)),
          max = Math.max(field.max, Math.ceil(amount));
        this.setData({
          [`fields[${i}].canonical`]:
            field.metric === 'durationSeconds'
              ? Math.round(amount * factors[this.data.project!.timeUnit])
              : amount,
          [`fields[${i}].min`]: min,
          [`fields[${i}].max`]: max,
          [`fields[${i}].position`]: amount,
          [`fields[${i}].progress`]: trackProgress(amount, min, max),
        });
      } catch {
        /* Exact text stays editable until explicit save; invalid input does not move the track. */
      }
      this.syncCanSave();
      return undefined;
    },
    finishExact(index: number): boolean {
      const field = this.data.fields[index],
        project = this.data.project;
      if (!this.data.opened || !field || !project || this.data.busy) return false;
      try {
        // An untouched approximation is a view of historical seconds, never a replacement for them.
        const canonical = !field.dirty
          ? field.canonical!
          : field.metric === 'durationSeconds'
            ? parseTime(field.raw, project.timeUnit)
            : positive(field.raw, '数量');
        const amount =
          field.metric === 'durationSeconds' ? canonical / factors[project.timeUnit] : canonical;
        if (!this.data.original || canonical !== this.data.original[field.metric])
          validateMetricValue(field.metric, canonical);
        const min = field.remember ? Math.min(field.min, Math.floor(amount)) : field.min;
        const max = field.remember ? Math.max(field.max, Math.ceil(amount)) : field.max;
        this.setData({
          [`fields[${index}].canonical`]: canonical,
          [`fields[${index}].dirty`]: false,
          [`fields[${index}].precise`]: false,
          [`fields[${index}].display`]: fieldReading(project, field.metric, canonical).display,
          [`fields[${index}].number`]: fieldReading(project, field.metric, canonical).number,
          [`fields[${index}].min`]: min,
          [`fields[${index}].max`]: max,
          [`fields[${index}].position`]: Math.min(max, Math.max(min, amount)),
          [`fields[${index}].progress`]: trackProgress(amount, min, max),
        });
        this.syncCanSave();
        return true;
      } catch {
        // Empty or incomplete decimal drafts revert to their last complete value when editing ends, without a warning.
        if (field.dirty && field.canonical != null) {
          const value =
            field.metric === 'durationSeconds'
              ? field.canonical / factors[project.timeUnit]
              : field.canonical;
          this.setData({
            [`fields[${index}].raw`]: String(Number(value.toFixed(4))),
            [`fields[${index}].dirty`]: false,
          });
          return this.finishExact(index);
        }
        this.syncCanSave();
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
      // A fixed note viewport expands in one update; native textarea initialization must not resize the sheet again.
      this.setData({ noteOpen: !this.data.noteOpen });
    },
    dateChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (this.data.busy) return;
      this.setData({
        date: e.detail.value,
        dateDisplay: recordDateCaption(e.detail.value, this.data.today, this.data.time),
      });
      this.syncCanSave();
    },
    timeChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (this.data.busy) return;
      this.setData({
        time: e.detail.value,
        dateDisplay: recordDateCaption(this.data.date, this.data.today, e.detail.value),
      });
      this.syncCanSave();
    },
    clearTime() {
      if (this.data.busy) return;
      this.setData({
        time: '',
        dateDisplay: recordDateCaption(this.data.date, this.data.today, ''),
      });
      this.syncCanSave();
    },
    noteInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (this.data.busy) return;
      const previous = this.data.note,
        raw = e.detail.value;
      const legacyEditing =
        this.data.noteLegacy &&
        (textLength(previous) > inputLimits.note ||
          noteLineBreaks(previous) > inputLimits.noteLineBreaks);
      const normalized = normalizeNote(raw);
      // Let an older long note shrink gradually; never replace it with an automatically truncated copy.
      if (legacyEditing && textLength(normalized) > textLength(previous)) {
        return previous;
      }
      // Over-limit insertions keep the whole accepted note, not just its first three lines or 100 characters.
      const value = legacyEditing ? normalized : limitNote(raw, previous);
      this.setData({ note: value, noteCount: textLength(value), error: '' });
      this.syncCanSave();
      if (value !== raw) return value;
      return undefined;
    },
    async removeRecord() {
      const original = this.data.original;
      if (!original || this.data.busy) return;
      const answer = await wx.showModal({
        title: '删除这条记录？',
        content: '删除后可短暂撤销，累计与图表将同步更新。',
        confirmText: '删除记录',
        confirmColor: '#b42318',
      });
      if (!answer.confirm || this.data.busy) return;
      this.setData({ busy: true, error: '' });
      try {
        // Deletion uses the same revision and undo boundary as the history menu; the sheet never edits files itself.
        await service().deleteRecord(original.id, original.revision);
        this.setData({ busy: false });
        this.close();
        this.triggerEvent('deleted');
      } catch (error) {
        this.setData({ busy: false, error: errorText(error) });
      }
    },
    recordInput(): RecordInput {
      const p = this.data.project!,
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
      return {
        id: this.data.recordId,
        projectId: p.id,
        occurredOn: this.data.date,
        localTime: this.data.time,
        ...values,
        note: this.data.note,
      };
    },
    syncCanSave() {
      let canSave = false;
      if (this.data.opened && this.data.project) {
        try {
          const project = { ...this.data.project };
          for (const field of this.data.fields) {
            const kind = field.metric === 'quantity' ? 'quantity' : 'time';
            project[`${kind}Min`] = field.min;
            project[`${kind}Max`] = field.max;
          }
          // Use the same record validator as persistence, including unchanged legacy values and locally expanded rails.
          validateRecord(this.recordInput(), project, dateKey(), this.data.original || undefined);
          canSave = true;
        } catch {
          /* Invalid drafts disable the action; storage/revision failures still receive explicit feedback after submission. */
        }
      }
      this.setData({ canSave });
      return canSave;
    },
    async save() {
      // Closing revokes permission for new writes immediately; an already-started save still owns its completion.
      if (!this.data.opened || this.data.busy || !this.data.project || !this.syncCanSave()) return;
      this.setData({ busy: true, error: '' });
      try {
        const p = this.data.project,
          input = this.recordInput(),
          values = input;
        const remembered = this.data.fields
          .filter(
            (f) =>
              f.remember &&
              values[f.metric] != null &&
              (!this.data.original || values[f.metric] !== this.data.original[f.metric]),
          )
          .map((f) => f.metric);
        // Untouched historical seconds bypass rounded display strings, even after a time-unit change.
        const preferences = remembered.length
          ? { projectRevision: p.revision, metrics: remembered }
          : undefined;
        const receipt = submission(submissions.get(this) || null, [
          input,
          this.data.original?.revision,
          preferences,
        ]);
        submissions.set(this, receipt);
        const record = await service().saveRecord(
          input,
          this.data.original?.revision,
          preferences,
          receipt.id,
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
