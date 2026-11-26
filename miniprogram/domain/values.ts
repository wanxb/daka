/** Numeric admission and duration formatting share exact whole-second invariants. */
import { inputLimits, timeInputLimits } from './input-limits';
import { PracticeError, type Metric, type TimeUnit } from './types';

/** Display captions are separate from persisted unit keys; expanding text must never migrate or reinterpret durations. */
export const timeUnitLabels: Record<TimeUnit, string> = {
  分: '分钟',
  时: '小时',
  天: '天',
  秒: '秒',
};

export const factors: Record<TimeUnit, number> = { 分: 60, 时: 3600, 天: 86_400, 秒: 1 };

let sequence = 0;

/** IDs, rather than user text, are used in filesystem references and idempotent record submissions. */
export const newId = (kind = 'r'): string =>
  `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${++sequence}`;

export function requireId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new PracticeError('INVALID', '无法识别此项目或记录，请返回后重试。');
}

export function positive(value: unknown, label: string): number {
  if (
    value === '' ||
    value == null ||
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  )
    throw new PracticeError('INVALID', `请输入大于0的整数${label}。`);
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
    throw new PracticeError('INVALID', `${label}范围需为非负整数，且下限不能大于上限。`);
  return [a, b];
}

export function midpoint(min: number, max: number): number {
  return Math.max(1, min + Math.floor((max - min) / 2));
}

/** Time may be decimal only when it resolves to whole seconds. No display rounding is written back. */
export function parseTime(text: string, unit: TimeUnit): number {
  const value = Number(text),
    raw = value * factors[unit],
    seconds = Math.round(raw);
  if (
    !(unit === '秒' ? /^\d+$/ : /^\d+(\.\d{1,4})?$/).test(text) ||
    value <= 0 ||
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    Math.abs(raw - seconds) > 1e-7
  )
    throw new PracticeError('INVALID', '时间需大于0，且能精确换算为整秒。');
  if (seconds > inputLimits.durationSeconds)
    throw new PracticeError(
      'INVALID',
      `单次时间不能超过${timeInputLimits[unit]}${timeUnitLabels[unit]}（365天）。`,
    );
  return seconds;
}

/** Canonical record values are numbers. Entry caps never limit historical accumulation or metadata revisions. */
export function validateMetricValue(metric: Metric, value: unknown): void {
  if (typeof value !== 'number') throw new PracticeError('INVALID', '请填写有效数值。');
  positive(value, metric === 'quantity' ? '数量' : '时间');
  if (value > (metric === 'quantity' ? inputLimits.quantity : inputLimits.durationSeconds))
    throw new PracticeError(
      'INVALID',
      metric === 'quantity' ? '单次数量不能超过99,999。' : '单次时间不能超过365天。',
    );
}

export function amountText(value: number, decimals = 4): string {
  const [whole, fraction] = String(Number(value.toFixed(decimals))).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
}

/** Return numeric text and a full unit caption together so callers never strip a raw one-character storage key. */
export function timeParts(seconds: number, unit: TimeUnit) {
  // More display precision for days keeps a small legacy duration from appearing as zero; input policy stays separate.
  const decimals = unit === '天' ? 8 : 4;
  const amount = seconds / factors[unit],
    rounded = Number(amount.toFixed(decimals));
  return {
    number: `${Math.abs(rounded * factors[unit] - seconds) > 1e-7 ? '≈' : ''}${amountText(amount, decimals)}`,
    unit: timeUnitLabels[unit],
  };
}

export function timeText(seconds: number, unit: TimeUnit): string {
  // Cards, records, chart readouts and accessible captions all use the same complete unit wording.
  const parts = timeParts(seconds, unit);
  return parts.number + parts.unit;
}
