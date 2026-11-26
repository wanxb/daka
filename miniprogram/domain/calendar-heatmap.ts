// Calendar aggregation depends on local dates and persisted contracts, never the domain export facade.
import { calendar, dateKey, moveDay } from './calendar';
import type { Metric, PracticeRecord } from './types';

export interface HeatmapDay {
  date: string;
  day: string;
  inside: boolean;
  future: boolean;
  today: boolean;
  amount: number;
  records: number;
  missing: boolean;
  level: number;
}

/** Derives a bounded month from one project's records. Shades compare daily amounts within the same year.
 * No saved aggregates, targets, default values, record counts or timezone conversion affect the intensity.
 */
export function calendarHeatmap(
  records: PracticeRecord[],
  metric: Metric,
  offset: number,
  today: string,
) {
  const rows = records.filter((row) => row.occurredOn <= today);
  const earliest = rows.reduce(
    (date, row) => (row.occurredOn < date ? row.occurredOn : date),
    today,
  );
  const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const minimumOffset = monthIndex(earliest) - monthIndex(today);
  const safeOffset = Math.max(
    minimumOffset,
    Math.min(0, Number.isFinite(offset) ? Math.trunc(offset) : 0),
  );
  const anchor = calendar(today);
  anchor.setDate(1);
  anchor.setMonth(anchor.getMonth() + safeOffset);
  const month = dateKey(anchor).slice(0, 7),
    start = month + '-01',
    year = month.slice(0, 4);
  const byDay = new Map<string, { amount: number; records: number; measured: number }>();
  let maximum = 0;
  for (const row of rows) {
    if (!row.occurredOn.startsWith(year + '-')) continue;
    const day = byDay.get(row.occurredOn) || { amount: 0, records: 0, measured: 0 };
    day.records++;
    if (row[metric] != null) {
      day.amount += row[metric]!;
      day.measured++;
    }
    byDay.set(row.occurredOn, day);
    maximum = Math.max(maximum, day.amount);
  }
  const first = moveDay(start, -((anchor.getDay() + 6) % 7));
  // Six rows reserve stable geometry for any month; outside/future dates cannot become selectable zeroes.
  const cells: HeatmapDay[] = Array.from({ length: 42 }, (_, index) => {
    const date = moveDay(first, index),
      inside = date.startsWith(month);
    const value = byDay.get(date) || { amount: 0, records: 0, measured: 0 };
    return {
      date,
      day: inside ? String(Number(date.slice(8))) : '',
      inside,
      future: date > today,
      today: date === today,
      amount: value.amount,
      records: value.records,
      missing: value.records > 0 && value.measured === 0,
      level:
        value.amount > 0 ? Math.min(4, Math.max(1, Math.ceil((value.amount / maximum) * 4))) : 0,
    };
  });
  return {
    month,
    offset: safeOffset,
    cells,
    maximum,
    selected: rows.filter((row) => row.occurredOn.startsWith(month)),
    previous: safeOffset > minimumOffset,
    next: safeOffset < 0,
    label: `${year}年${Number(month.slice(5))}月`,
  };
}
