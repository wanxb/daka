// Import owners directly so statistics cannot create a cycle through the compatibility entry point.
import { calendar, dateKey, moveDay } from './calendar';
import { total } from './records';
import type { Metric, PracticeRecord } from './types';
export type Period = 'day' | 'week' | 'month' | 'year' | 'all';
export interface ChartPoint {
  label: string;
  description?: string;
  added: number;
  cumulative: number;
  records: number;
}
/** Buckets represent actual records, days or months; cumulative values include the prior-period baseline. */
export function statistics(
  records: PracticeRecord[],
  metric: Metric,
  period: Period,
  offset: number,
  today: string,
) {
  let start = today,
    end = today;
  const base = calendar(today);
  if (period === 'day') start = end = moveDay(today, offset);
  else if (period === 'week') {
    start = moveDay(today, (-(base.getDay() + 6) % 7) + offset * 7);
    end = moveDay(start, 6);
  } else if (period === 'month') {
    base.setDate(1);
    base.setMonth(base.getMonth() + offset);
    start = dateKey(base);
    base.setMonth(base.getMonth() + 1);
    base.setDate(0);
    end = dateKey(base);
  } else if (period === 'year') {
    start = `${base.getFullYear() + offset}-01-01`;
    end = `${base.getFullYear() + offset}-12-31`;
  } else {
    start = records.reduce((min, r) => (r.occurredOn < min ? r.occurredOn : min), today);
  }
  if (end > today || period === 'all') end = today;
  const selected = records.filter((r) => r.occurredOn >= start && r.occurredOn <= end);
  const baseline = total(
    records.filter((r) => r.occurredOn < start),
    metric,
  );
  const byDay = new Map<string, PracticeRecord[]>(),
    byMonth = new Map<string, PracticeRecord[]>();
  for (const row of selected) {
    for (const [map, key] of [
      [byDay, row.occurredOn],
      [byMonth, row.occurredOn.slice(0, 7)],
    ] as const) {
      const bucket = map.get(key) || [];
      bucket.push(row);
      map.set(key, bucket);
    }
  }
  const groups: { label: string; description: string; rows: PracticeRecord[] }[] = [];
  if (period === 'day') {
    selected
      .slice()
      .sort(
        (a, b) =>
          (a.localTime || '99:99').localeCompare(b.localTime || '99:99') ||
          a.createdAt - b.createdAt ||
          a.id.localeCompare(b.id),
      )
      .forEach((r, i) =>
        groups.push({
          label: r.localTime || `第${i + 1}条`,
          description: r.occurredOn + ' ' + (r.localTime || `第${i + 1}条（未填具体时刻）`),
          rows: [r],
        }),
      );
  } else if (period === 'week' || period === 'month') {
    for (let day = start; day <= end; day = moveDay(day, 1))
      groups.push({
        label:
          period === 'week'
            ? ['日', '一', '二', '三', '四', '五', '六'][calendar(day).getDay()]
            : String(Number(day.slice(8))),
        description: day,
        rows: byDay.get(day) || [],
      });
  } else {
    const cursor = calendar(start);
    cursor.setDate(1);
    while (dateKey(cursor).slice(0, 7) <= end.slice(0, 7)) {
      const month = dateKey(cursor).slice(0, 7);
      groups.push({
        label: period === 'all' ? month : `${cursor.getMonth() + 1}月`,
        description: month,
        rows: byMonth.get(month) || [],
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  let running = baseline;
  const points: ChartPoint[] = groups.map((group) => {
    const added = total(group.rows, metric);
    running += added;
    return {
      label: group.label,
      description: group.description,
      added,
      cumulative: running,
      records: group.rows.filter((r) => r[metric] != null).length,
    };
  });
  return {
    start,
    end,
    selected,
    baseline,
    added: total(selected, metric),
    points,
    label: period === 'all' ? '全部时间' : period === 'day' ? start : `${start} — ${end}`,
  };
}
