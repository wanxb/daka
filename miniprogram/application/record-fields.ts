import {
  enabled,
  factors,
  metricOrder,
  timeUnitLabels,
  type Metric,
  type PracticeRecord,
  type Project,
} from '../domain/model';
import { inputLimits, numericLength, timeInputLimits } from '../domain/input-limits';
import { metricParts, metricText } from './presentation';
/** Fields own disposable exact seconds and rail geometry; constructing them must never mutate a project or saved record. */
export interface RecordField {
  metric: Metric;
  label: string;
  unit: string;
  min: number;
  max: number;
  canonical: number | null;
  raw: string;
  display: string;
  number: string;
  position: number;
  progress: number;
  dirty: boolean;
  remember: boolean;
  precise: boolean;
  disabled: boolean;
  limit: number;
  decimals: number;
  inputLength: number;
}

// The visual rail follows live input while the native control retains ownership of the dragging thumb.
export const trackProgress = (value: number, min: number, max: number) =>
  max === min ? 0 : ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;

/** Missing historical metrics stay missing and disabled; display approximations never replace canonical seconds. */
export function fieldReading(project: Project, metric: Metric, canonical: number | null) {
  return canonical == null
    ? { display: '未记录', number: '—' }
    : {
        display: metricText(project, metric, canonical),
        number: metricParts(project, metric, canonical).number,
      };
}
/** Capture defaults or original history once per opening, preserving primary metric order and legacy values. */
export function recordFields(project: Project, original?: PracticeRecord): RecordField[] {
  return metricOrder(project)
    .filter((m) => enabled(project, m) || original?.[m] != null)
    .map((metric) => {
      const isTime = metric === 'durationSeconds';
      const limit = isTime ? timeInputLimits[project.timeUnit] : inputLimits.quantity;
      // Old readouts remain exact, while the interactive rail cannot offer a newly disallowed value.
      const min = Math.min(limit, isTime ? project.timeMin : project.quantityMin);
      const max = Math.min(limit, isTime ? project.timeMax : project.quantityMax);
      const decimals = isTime && project.timeUnit !== '秒' ? inputLimits.timeDecimals : 0;
      const canonical = original
        ? original[metric]
        : isTime
          ? project.defaultTime * factors[project.timeUnit]
          : project.defaultQuantity;
      const value =
        canonical == null ? null : isTime ? canonical / factors[project.timeUnit] : canonical;
      return {
        metric,
        label: isTime ? '时间' : '数量',
        unit: isTime ? timeUnitLabels[project.timeUnit] : project.quantityUnit,
        min,
        max,
        canonical,
        raw: value == null ? '' : String(Number(value.toFixed(4))),
        ...fieldReading(project, metric, canonical),
        position: value == null ? min : Math.min(max, Math.max(min, value)),
        progress: trackProgress(value ?? min, min, max),
        dirty: false,
        remember: false,
        precise: false,
        disabled: !enabled(project, metric) || canonical == null,
        limit,
        decimals,
        inputLength: numericLength(limit, decimals),
      };
    });
}
