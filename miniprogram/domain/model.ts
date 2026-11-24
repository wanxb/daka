/** Canonical local data: time is whole seconds; quantity never means record count. */
export type Metric = 'durationSeconds' | 'quantity';
export type TimeUnit = '时' | '分' | '秒';
export type Mode = 'duration' | 'quantity' | 'both';
export type Color = 'purple' | 'orange' | 'blue' | 'teal' | 'rose';
export interface Project {
  id: string;
  name: string;
  color: Color;
  icon: string;
  mode: Mode;
  primaryMetric: Metric;
  timeUnit: TimeUnit;
  timeMin: number;
  timeMax: number;
  defaultTime: number;
  quantityUnit: string;
  quantityUnitLocked: boolean;
  quantityMin: number;
  quantityMax: number;
  defaultQuantity: number;
  directEntryEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  revision: number;
}
export interface PracticeRecord {
  id: string;
  projectId: string;
  occurredOn: string;
  localTime: string;
  durationSeconds: number | null;
  quantity: number | null;
  quantityUnit: string | null;
  note: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
}
/** Raw strings survive cancellation of project creation, including temporarily invalid configuration. */
export interface ProjectForm {
  id: string;
  name: string;
  color: Color;
  icon: string;
  timeEnabled: boolean;
  quantityEnabled: boolean;
  primaryMetric: Metric;
  timeUnit: TimeUnit;
  timeMin: string;
  timeMax: string;
  defaultTime: string;
  quantityUnit: string;
  quantityMin: string;
  quantityMax: string;
  defaultQuantity: string;
  directEntryEnabled: boolean;
}
export interface RecordInput {
  id: string;
  projectId: string;
  occurredOn: string;
  localTime: string;
  durationSeconds: number | null;
  quantity: number | null;
  note: string;
}
export interface UndoEntry {
  type: 'create' | 'delete';
  record: PracticeRecord;
  expiresAt: number;
}
export interface Database {
  schemaVersion: 1;
  projects: Project[];
  records: PracticeRecord[];
  newProjectDraft: ProjectForm | null;
  undo: UndoEntry | null;
}
export class PracticeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PracticeError';
  }
}
export const emptyDatabase = (): Database => ({
  schemaVersion: 1,
  projects: [],
  records: [],
  newProjectDraft: null,
  undo: null,
});
export const palettes = {
  purple: '#6745c6',
  orange: '#bc421c',
  blue: '#285cce',
  teal: '#087b75',
  rose: '#bd3457',
};
export const factors: Record<TimeUnit, number> = { 时: 3600, 分: 60, 秒: 1 };
export const metricOrder = (p: Project): Metric[] =>
  p.primaryMetric === 'quantity'
    ? ['quantity', 'durationSeconds']
    : ['durationSeconds', 'quantity'];
export const enabled = (p: Project, metric: Metric): boolean =>
  metric === 'quantity' ? p.mode !== 'duration' : p.mode !== 'quantity';
let sequence = 0;
/** IDs, rather than user text, are used in filesystem references and idempotent record submissions. */
export const newId = (kind = 'r'): string =>
  `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${++sequence}`;
export function requireId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new PracticeError('INVALID', '项目或记录标识无效。');
}
export function positive(value: unknown, label: string): number {
  if (
    value === '' ||
    value == null ||
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  )
    throw new PracticeError('INVALID', `${label}请填写大于0的整数。`);
  return Number(value);
}
export function range(min: unknown, max: unknown, label: string): [number, number] {
  const a = Number(min),
    b = Number(max);
  if (
    !/^\d+$/.test(String(min)) ||
    !/^\d+$/.test(String(max)) ||
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    a < 0 ||
    b <= 0 ||
    a > b
  )
    throw new PracticeError('INVALID', `${label}范围需为非负整数，且左值不大于右值。`);
  return [a, b];
}
export function midpoint(min: number, max: number): number {
  return Math.max(1, min + Math.floor((max - min) / 2));
}
export function initialForm(): ProjectForm {
  return {
    id: newId('p'),
    name: '',
    color: 'purple',
    icon: 'book',
    timeEnabled: true,
    quantityEnabled: false,
    primaryMetric: 'durationSeconds',
    timeUnit: '分',
    timeMin: '1',
    timeMax: '120',
    defaultTime: '60',
    quantityUnit: '次',
    quantityMin: '1',
    quantityMax: '100',
    defaultQuantity: '50',
    directEntryEnabled: false,
  };
}
export function projectForm(p: Project): ProjectForm {
  return {
    ...p,
    timeEnabled: p.mode !== 'quantity',
    quantityEnabled: p.mode !== 'duration',
    timeMin: String(p.timeMin),
    timeMax: String(p.timeMax),
    defaultTime: String(p.defaultTime),
    quantityMin: String(p.quantityMin),
    quantityMax: String(p.quantityMax),
    defaultQuantity: String(p.defaultQuantity),
  };
}
export function makeProject(form: ProjectForm, now: number, original?: Project): Project {
  requireId(form.id);
  const name = form.name.trim();
  if (!name || Array.from(name).length > 24)
    throw new PracticeError('INVALID', '项目名称请填写1～24个字符。');
  if (!form.timeEnabled && !form.quantityEnabled)
    throw new PracticeError('INVALID', '请至少开启时间或数量。');
  const [timeMin, timeMax] = range(form.timeMin, form.timeMax, '时间');
  const [quantityMin, quantityMax] = range(form.quantityMin, form.quantityMax, '数量');
  const defaultTime = positive(form.defaultTime, '默认时间'),
    defaultQuantity = positive(form.defaultQuantity, '默认数量');
  if (
    !Object.prototype.hasOwnProperty.call(factors, form.timeUnit) ||
    !Number.isSafeInteger(timeMax * factors[form.timeUnit])
  )
    throw new PracticeError('INVALID', '时间单位或范围无效。');
  if (
    defaultTime < timeMin ||
    defaultTime > timeMax ||
    defaultQuantity < quantityMin ||
    defaultQuantity > quantityMax
  )
    throw new PracticeError('INVALID', '默认值需在各自的范围内。');
  const quantityUnit = form.quantityUnit.trim();
  if (
    !quantityUnit ||
    Array.from(quantityUnit).length > 4 ||
    /[\s\u0000-\u001f\u007f]/.test(quantityUnit)
  )
    throw new PracticeError('INVALID', '数量单位请填写1～4个字符，不含空格。');
  if (original?.quantityUnitLocked && quantityUnit !== original.quantityUnit)
    throw new PracticeError('INVALID', '已有数量记录，数量单位已固定。');
  if (
    !Object.prototype.hasOwnProperty.call(palettes, form.color) ||
    !['book', 'rope', 'dumbbell', 'piano', 'target'].includes(form.icon)
  )
    throw new PracticeError('INVALID', '请选择有效的项目外观。');
  const mode: Mode =
    form.timeEnabled && form.quantityEnabled ? 'both' : form.timeEnabled ? 'duration' : 'quantity';
  const primaryMetric =
    mode === 'duration' ? 'durationSeconds' : mode === 'quantity' ? 'quantity' : form.primaryMetric;
  if (!['durationSeconds', 'quantity'].includes(primaryMetric))
    throw new PracticeError('INVALID', '请选择主要指标。');
  return {
    id: form.id,
    name,
    color: form.color,
    icon: form.icon,
    mode,
    primaryMetric,
    timeUnit: form.timeUnit,
    timeMin,
    timeMax,
    defaultTime,
    quantityMin,
    quantityMax,
    defaultQuantity,
    quantityUnit,
    quantityUnitLocked: original?.quantityUnitLocked || false,
    directEntryEnabled: form.directEntryEnabled,
    createdAt: original?.createdAt ?? now,
    updatedAt: now,
    revision: (original?.revision ?? 0) + 1,
  };
}
/** Time may be decimal only when it resolves to whole seconds. No display rounding is written back. */
export function parseTime(text: string, unit: TimeUnit): number {
  const value = Number(text),
    raw = value * factors[unit],
    seconds = Math.round(raw);
  if (
    !/^\d+(\.\d+)?$/.test(text) ||
    value <= 0 ||
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    Math.abs(raw - seconds) > 1e-7
  )
    throw new PracticeError('INVALID', '时间需大于0，且能精确换算为整秒。');
  return seconds;
}
export function amountText(value: number): string {
  const [whole, fraction] = String(Number(value.toFixed(4))).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
}
export function timeText(seconds: number, unit: TimeUnit): string {
  const amount = seconds / factors[unit],
    rounded = Number(amount.toFixed(4));
  return `${Math.abs(rounded * factors[unit] - seconds) > 1e-7 ? '≈' : ''}${amountText(amount)}${unit}`;
}
export function total(records: PracticeRecord[], metric: Metric): number {
  const value = records.reduce((sum, r) => sum + (r[metric] ?? 0), 0);
  if (!Number.isSafeInteger(value))
    throw new PracticeError('OVERFLOW', '累计数值超出可准确记录的范围。');
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
  if (input.localTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.localTime))
    throw new PracticeError('INVALID', '请选择有效的时间。');
  if (Array.from(input.note).length > 500)
    throw new PracticeError('INVALID', '备注最多500个字符。');
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
    positive(value, metric === 'quantity' ? '数量' : '时间秒数');
    // Old values can survive narrower ranges or a mode switch, but a deliberately changed value cannot.
    if (original && before === value) continue;
    if (!enabled(project, metric))
      throw new PracticeError('INVALID', '该指标已关闭，请重新打开项目设置。');
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
/** Local calendar strings retain the user-confirmed day across timezone and daylight-saving transitions. */
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function calendar(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(calendar(value)) === value;
}
export function moveDay(value: string, offset: number): string {
  const date = calendar(value);
  date.setDate(date.getDate() + offset);
  return dateKey(date);
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
