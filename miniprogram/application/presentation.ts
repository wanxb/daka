import {
  amountText,
  dateKey,
  enabled,
  factors,
  metricOrder,
  readFrequency,
  timeText,
  timeParts,
  timeUnitLabels,
  total,
  type Metric,
  type PracticeRecord,
  type Project,
} from '../domain/model';
import { frequencyStart, frequencyLabels, trendCounts, trendLabels } from '../domain/frequency';
/** Formatting is shared by cards, rows and confirmations so quantities never turn into record counts. */
export function metricText(p: Project, metric: Metric, value: number): string {
  return metric === 'durationSeconds'
    ? timeText(value, p.timeUnit)
    : amountText(value) + p.quantityUnit;
}
/** Amounts and units have different visual roles in the approved prototype. */
export function metricParts(p: Project, metric: Metric, value: number) {
  // Quantities keep literal project units; only durations resolve storage keys to human-readable captions.
  return metric === 'durationSeconds'
    ? timeParts(value, p.timeUnit)
    : { number: amountText(value), unit: p.quantityUnit };
}
export function visibleMetrics(p: Project, rows: PracticeRecord[]): Metric[] {
  return metricOrder(p).filter((m) => enabled(p, m) || rows.some((r) => r[m] != null));
}
export function recordText(p: Project, r: PracticeRecord): string {
  return metricOrder(p)
    .filter((m) => r[m] != null)
    .map((m) => metricText(p, m, r[m]!))
    .join(' · ');
}
/** Cards group 7 days, 4 weeks or 6 months; ordinary views avoid native Canvas scroll overlays. */
export function homeTrend(p: Project, rows: PracticeRecord[], today: string) {
  const frequency = readFrequency(p.frequency),
    count = trendCounts[frequency];
  const starts = Array.from({ length: count + 1 }, (_, index) =>
    frequencyStart(today, frequency, index - count + 1),
  );
  const values = Array<number>(count).fill(0);
  let baseline = 0;
  for (const row of rows) {
    if (row.occurredOn > today) continue;
    const value = row[p.primaryMetric] ?? 0;
    if (row.occurredOn < starts[0]) baseline += value;
    else {
      const index = starts.findIndex(
        (start, i) => i < count && row.occurredOn >= start && row.occurredOn < starts[i + 1],
      );
      if (index >= 0) values[index] += value;
    }
  }
  const maximum = Math.max(...values, 1);
  const bars = values.map((value, index) => ({
    index,
    value,
    width: 60 / count,
    height: value ? Math.max(10, (value / maximum) * 84) : 6,
    opacity: value ? (index === count - 1 ? 1 : 0.6) : 0.18,
  }));
  // Subtract the baseline for drawing only; retain real cumulative values for verification and reading.
  const span = values.reduce((sum, value) => sum + value, 0) || 1;
  let added = 0;
  const steps = values.map((value, index) => {
    const previousY = 92 - (added / span) * 84;
    added += value;
    const y = 92 - (added / span) * 84;
    return {
      index,
      left: (index * 100) / count,
      right: ((index + 1) * 100) / count,
      width: 100 / count,
      previousY,
      y,
      height: previousY - y,
      cumulative: baseline + added,
    };
  });
  return {
    kind: p.primaryMetric === 'quantity' ? 'steps' : 'bars',
    bars,
    steps,
    dotTop: steps[count - 1].y,
    label:
      trendLabels[frequency] +
      (p.primaryMetric === 'quantity' ? '累计数量阶梯图' : '新增时间柱状图'),
  };
}
/** Current-cycle actual amounts lead; frequency never changes lifetime totals or quick-entry amounts. */
export function projectTile(p: Project, rows: PracticeRecord[], todayKey = dateKey()) {
  const metric = p.primaryMetric;
  const frequency = readFrequency(p.frequency),
    label = frequencyLabels[frequency];
  const start = frequencyStart(todayKey, frequency);
  const today = rows.filter((row) => row.occurredOn >= start && row.occurredOn <= todayKey);
  const daily = total(today, metric),
    lifetime = total(rows, metric);
  const missingToday = today.length > 0 && !today.some((row) => row[metric] != null);
  const missingLifetime = rows.length > 0 && !rows.some((row) => row[metric] != null);
  const parts = metricParts(p, metric, daily);
  const amount = metric === 'quantity' ? lifetime : lifetime / factors[p.timeUnit];
  const compact =
    amount >= 1e8
      ? amountText(Number((amount / 1e8).toFixed(1))) + '亿'
      : amount >= 1e4
        ? amountText(Number((amount / 1e4).toFixed(1))) + '万'
        : null;
  const baseUnit = metric === 'quantity' ? p.quantityUnit : timeUnitLabels[p.timeUnit];
  const lifetimeText = missingLifetime
    ? '—'
    : compact
      ? compact + baseUnit
      : metricText(p, metric, lifetime);
  const missingText = metric === 'quantity' ? '数量未记录' : '时间未记录';
  const dailySecondary = metricOrder(p)
    .filter((m) => m !== metric && enabled(p, m) && today.some((row) => row[m] != null))
    .map((m) => metricText(p, m, total(today, m)))
    .join(' · ');
  const defaults = metricOrder(p)
    .filter((m) => enabled(p, m))
    .map((m) =>
      metricText(p, m, m === 'quantity' ? p.defaultQuantity : p.defaultTime * factors[p.timeUnit]),
    );
  // Separate real increments with a list separator, never a slash that could imply a ratio.
  const caption = p.directEntryEnabled ? '记' + defaults.join('、') : '';
  const number = missingToday ? '—' : parts.number;
  const unit = missingToday ? '' : parts.unit;
  // Legacy amounts and units stay readable: use a wider card before shrinking text below 24px.
  const weight = (text: string) =>
    Array.from(text).reduce(
      (sum, c) => sum + (/[\u2e80-\uffff]/.test(c) ? 1 : /[., :/]/.test(c) ? 0.28 : 0.55),
      0,
    );
  const small = number.length > 6;
  return {
    ...p,
    number,
    unit,
    small,
    wideUnit: unit.length > 2,
    wide:
      weight(number) * (small ? 24 : 32) + weight(unit) * 12 > 122 ||
      weight(caption) * 11 > 130 ||
      (weight(lifetimeText) + weight(caption)) * 11 > 142 ||
      weight(dailySecondary) * 11 > 100,
    todayLabel: label + (dailySecondary ? ' · ' + dailySecondary : ''),
    lifetimeText,
    summaryLabel:
      (missingToday ? label + missingText : label + metricText(p, metric, daily)) +
      '，' +
      (missingLifetime ? missingText : '累计' + metricText(p, metric, lifetime)),
    caption,
    recordActionLabel: p.directEntryEnabled
      ? '快速打卡，增加' + defaults.join('、')
      : '打开记录面板',
    trend: homeTrend(p, rows, todayKey),
  };
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : '操作未完成，请重试。';

/** Compact dates retain cross-year context; only presentation changes, never the stored occurrence date. */
export function displayDate(date: string, today = dateKey()): string {
  return (
    (date.slice(0, 4) === today.slice(0, 4) ? '' : date.slice(0, 4) + '年') +
    Number(date.slice(5, 7)) +
    '月' +
    Number(date.slice(8)) +
    '日'
  );
}

/** Date/time summaries are shared without substituting save timestamps for the occurrence date. */
export function recordDateCaption(date: string, today: string, time: string): string {
  return (date === today ? '今天' : displayDate(date, today)) + (time ? ' ' + time : '');
}
/** History remains a projection: pagination and edits retain the original full date, note and metric values. */
export function recordRows(project: Project, rows: PracticeRecord[], today = dateKey()) {
  return rows.map((r) => ({
    id: r.id,
    date: r.occurredOn + (r.localTime ? ' ' + r.localTime : ''),
    value: recordText(project, r),
    note:
      Array.from(r.note).length > 120 ? Array.from(r.note).slice(0, 120).join('') + '…' : r.note,
    // The compact metadata mirrors the prototype; the sheet and aria label keep the complete saved date and note.
    meta:
      recordDateCaption(r.occurredOn, today, r.localTime) +
      (r.note
        ? ' · ' +
          Array.from(r.note).slice(0, 16).join('') +
          (Array.from(r.note).length > 16 ? '…' : '')
        : ''),
  }));
}
