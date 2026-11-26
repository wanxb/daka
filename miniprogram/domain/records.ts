/** Record validation and accumulation never rewrite untouched historical values. */
import { inputLimits, normalizeNote, textLength, noteLineBreaks } from './input-limits';
import {
  PracticeError,
  type Metric,
  type PracticeRecord,
  type Project,
  type RecordInput,
} from './types';
import { enabled, metricOrder } from './project';
import { factors, positive, requireId, validateMetricValue } from './values';
import { validDate } from './calendar';

export function total(records: PracticeRecord[], metric: Metric): number {
  const value = records.reduce((sum, r) => sum + (r[metric] ?? 0), 0);
  if (!Number.isSafeInteger(value))
    throw new PracticeError('OVERFLOW', '累计数值过大，无法准确保存本次记录。');
  return value;
}

export function validateRecord(
  input: RecordInput,
  project: Project,
  today: string,
  original?: PracticeRecord,
): void {
  requireId(input.id);
  requireId(input.projectId);
  if (!validDate(input.occurredOn) || input.occurredOn > today)
    throw new PracticeError('INVALID', '请选择今天或之前的有效日期。');
  if (input.occurredOn < inputLimits.earliestDate && original?.occurredOn !== input.occurredOn)
    throw new PracticeError('INVALID', '日期不能早于1900年1月1日。');
  if (input.localTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.localTime))
    throw new PracticeError('INVALID', '请选择有效的具体时刻。');
  if (typeof input.note !== 'string') throw new PracticeError('INVALID', '请填写有效备注。');
  // Existing long notes remain intact; only new or deliberately edited content must meet the new entry limit.
  if (original?.note !== input.note) {
    const note = normalizeNote(input.note).trim();
    if (textLength(note) > inputLimits.note)
      throw new PracticeError('INVALID', '备注最多100个字。');
    if (noteLineBreaks(note) > inputLimits.noteLineBreaks)
      throw new PracticeError('INVALID', '备注最多换行2次。');
    if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(note))
      throw new PracticeError('INVALID', '备注不能包含控制字符。');
  }
  if (input.durationSeconds == null && input.quantity == null)
    throw new PracticeError('INVALID', '请填写本次时间或数量。');
  for (const metric of metricOrder(project)) {
    const value = input[metric],
      before = original?.[metric];
    if (value == null) {
      if (enabled(project, metric) && (!original || before != null))
        throw new PracticeError(
          'INVALID',
          `请填写本次${metric === 'quantity' ? '数量' : '时间'}。`,
        );
      continue;
    }
    positive(value, metric === 'quantity' ? '数量' : '时间');
    // Old values can survive narrower ranges or a mode switch, but a deliberately changed value cannot.
    if (original && before === value) continue;
    validateMetricValue(metric, value);
    if (!enabled(project, metric))
      throw new PracticeError('INVALID', '此记录类型已关闭，请前往项目设置检查。');
    const amount = metric === 'quantity' ? value : value / factors[project.timeUnit];
    const min = metric === 'quantity' ? project.quantityMin : project.timeMin;
    const max = metric === 'quantity' ? project.quantityMax : project.timeMax;
    if (amount < min || amount > max)
      throw new PracticeError(
        'INVALID',
        `${metric === 'quantity' ? '数量' : '时间'}需在${min}～${max}范围内。`,
      );
  }
}

export function sortRecords(records: PracticeRecord[]): PracticeRecord[] {
  return records
    .slice()
    .sort(
      (a, b) =>
        b.occurredOn.localeCompare(a.occurredOn) ||
        b.createdAt - a.createdAt ||
        (a.id === b.id ? 0 : a.id < b.id ? 1 : -1),
    );
}
