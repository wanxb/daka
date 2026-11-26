import type { HeatmapDay } from '../domain/calendar-heatmap';
import type { Metric, Project } from '../domain/model';
import { displayDate, metricText } from './presentation';

/** Explicit colors avoid unsupported color-mix in WXSS and keep day numbers independent from the heat fill. */
export function heatmapColors(color: string): string[] {
  const rgb = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  return [
    '#f1f1f5',
    ...[0.14, 0.32, 0.58, 1].map(
      (alpha) =>
        '#' +
        rgb
          .map((part) =>
            Math.round(255 + (part - 255) * alpha)
              .toString(16)
              .padStart(2, '0'),
          )
          .join(''),
    ),
  ];
}

/** Missing historical metrics remain distinct from an actual empty day, including in screen-reader readouts. */
export function heatmapReading(day: HeatmapDay, project: Project, metric: Metric): string {
  const value = day.missing
    ? metric === 'quantity'
      ? '数量未记录'
      : '时间未记录'
    : metricText(project, metric, day.amount);
  return `${displayDate(day.date)} · ${value} · ${day.records}条记录`;
}
