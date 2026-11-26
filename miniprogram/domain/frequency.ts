// Cadence shares calendar arithmetic without depending on unrelated project/record initialization.
import { calendar, dateKey, moveDay } from './calendar';
import type { Frequency } from './types';

/** Compact configuration labels and descriptive badges share stable IDs; neither imposes a recording target. */
export const frequencyOptions: { id: Frequency; label: string }[] = [
  { id: 'day', label: '日' },
  { id: 'week', label: '周' },
  { id: 'month', label: '月' },
];
export const frequencyNames: Record<Frequency, string> = {
  day: '每日',
  week: '每周',
  month: '每月',
};
export const frequencyLabels: Record<Frequency, string> = {
  day: '今天',
  week: '本周',
  month: '本月',
};
export const trendCounts: Record<Frequency, number> = { day: 7, week: 4, month: 6 };
export const trendLabels: Record<Frequency, string> = {
  day: '近7天',
  week: '近4周',
  month: '近6个月',
};

/** Local noon avoids UTC date shifts; anchoring before month arithmetic prevents 31st-day rollover. */
export function frequencyStart(today: string, frequency: Frequency, offset = 0): string {
  const base = calendar(today);
  if (frequency === 'month') {
    base.setDate(1);
    base.setMonth(base.getMonth() + offset);
    return dateKey(base);
  }
  if (frequency === 'week') return moveDay(today, -((base.getDay() + 6) % 7) + offset * 7);
  return moveDay(today, offset);
}
