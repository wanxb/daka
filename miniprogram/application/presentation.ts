import {
  amountText,
  enabled,
  factors,
  metricOrder,
  timeText,
  total,
  type Metric,
  type PracticeRecord,
  type Project,
} from '../domain/model';
/** Formatting is shared by cards, rows and confirmations so quantities never turn into record counts. */
export function metricText(p: Project, metric: Metric, value: number): string {
  return metric === 'durationSeconds'
    ? timeText(value, p.timeUnit)
    : amountText(value) + p.quantityUnit;
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
export function projectTile(p: Project, rows: PracticeRecord[]) {
  const metric = p.primaryMetric,
    value = total(rows, metric),
    unit = metric === 'quantity' ? p.quantityUnit : p.timeUnit;
  const amount = metric === 'quantity' ? value : value / factors[p.timeUnit];
  const number =
    amount >= 1e8
      ? amountText(Number((amount / 1e8).toFixed(1))) + '亿'
      : amount >= 1e4
        ? amountText(Number((amount / 1e4).toFixed(1))) + '万'
        : metric === 'durationSeconds'
          ? timeText(value, p.timeUnit).slice(0, -p.timeUnit.length)
          : amountText(amount);
  const secondary = metricOrder(p).find((m) => m !== metric && rows.some((r) => r[m] != null));
  const defaults = metricOrder(p)
    .filter((m) => enabled(p, m))
    .map((m) =>
      metricText(p, m, m === 'quantity' ? p.defaultQuantity : p.defaultTime * factors[p.timeUnit]),
    );
  return {
    ...p,
    number,
    unit,
    small: number.length > 6,
    caption: p.directEntryEnabled
      ? '记 ' + defaults.join(' / ')
      : secondary
        ? metricText(p, secondary, total(rows, secondary))
        : rows.length
          ? rows.length + '条记录'
          : '尚未记录',
  };
}
export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : '操作未完成，请重试。';
