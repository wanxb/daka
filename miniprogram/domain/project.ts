/** Project configuration preserves legacy values and quantity-unit locks across edits. */
import { inputLimits, storedTextLimits, timeInputLimits, textLength } from './input-limits';
import { palettes, projectIcons, resolveProjectIcon } from './appearance';
import {
  PracticeError,
  type Frequency,
  type Metric,
  type Mode,
  type Project,
  type ProjectForm,
} from './types';
import {
  factors,
  newId,
  positive,
  range,
  requireId,
  timeUnitLabels,
  validateMetricValue,
} from './values';

export function readFrequency(value: unknown): Frequency {
  if (value === undefined) return 'day';
  if (value !== 'day' && value !== 'week' && value !== 'month')
    throw new PracticeError('INVALID', '请选择有效的打卡频率。');
  return value;
}

export const metricOrder = (p: Project): Metric[] =>
  p.primaryMetric === 'quantity'
    ? ['quantity', 'durationSeconds']
    : ['durationSeconds', 'quantity'];

export const enabled = (p: Project, metric: Metric): boolean =>
  metric === 'quantity' ? p.mode !== 'duration' : p.mode !== 'quantity';

export function initialForm(): ProjectForm {
  return {
    id: newId('p'),
    name: '',
    frequency: 'day',
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
  // Command metadata is not editable configuration and must never be recursively copied into the next receipt.
  const { lastCommand: _receipt, ...configuration } = p;
  return {
    ...configuration,
    // Only the editable projection changes; reading a legacy project never rewrites its persisted ID.
    icon: resolveProjectIcon(p.icon),
    frequency: readFrequency(p.frequency),
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
  const unchangedName = original?.name === name;
  if (
    !name ||
    textLength(name) > (unchangedName ? storedTextLimits.projectName : inputLimits.projectName)
  )
    throw new PracticeError('INVALID', `打卡名称请填写1～${inputLimits.projectName}个字。`);
  if (!unchangedName && /[\u0000-\u001f\u007f\u2028\u2029]/.test(name))
    throw new PracticeError('INVALID', '打卡名称不能包含换行或控制字符。');
  if (!form.timeEnabled && !form.quantityEnabled)
    throw new PracticeError('INVALID', '至少开启时间或数量中的一项。');
  // Removing a visible option must not invalidate existing saved projects or silently relabel their values.
  if (form.timeUnit === '秒' && original?.timeUnit !== '秒')
    throw new PracticeError('INVALID', '请选择时间单位。');
  const [timeMin, timeMax] = range(form.timeMin, form.timeMax, '时间');
  const [quantityMin, quantityMax] = range(form.quantityMin, form.quantityMax, '数量');
  const defaultTime = positive(form.defaultTime, '默认时间'),
    defaultQuantity = positive(form.defaultQuantity, '默认数量');
  if (
    !Object.prototype.hasOwnProperty.call(factors, form.timeUnit) ||
    !Number.isSafeInteger(timeMax * factors[form.timeUnit])
  )
    throw new PracticeError('INVALID', '时间配置无效，请检查单位和范围。');
  const timeValues = { timeMin, timeMax, defaultTime };
  for (const field of ['timeMin', 'timeMax', 'defaultTime'] as const)
    if (
      timeValues[field] > timeInputLimits[form.timeUnit] &&
      !(original?.timeUnit === form.timeUnit && original[field] === timeValues[field])
    )
      throw new PracticeError(
        'INVALID',
        `时间范围和默认值不能超过${timeInputLimits[form.timeUnit]}${timeUnitLabels[form.timeUnit]}（365天）。`,
      );
  const quantityValues = { quantityMin, quantityMax, defaultQuantity };
  for (const field of ['quantityMin', 'quantityMax', 'defaultQuantity'] as const)
    if (
      quantityValues[field] > inputLimits.quantity &&
      !(
        original?.quantityUnit === form.quantityUnit.trim() &&
        original[field] === quantityValues[field]
      )
    )
      throw new PracticeError('INVALID', '数量范围和默认值不能超过99,999。');
  if (
    defaultTime < timeMin ||
    defaultTime > timeMax ||
    defaultQuantity < quantityMin ||
    defaultQuantity > quantityMax
  )
    throw new PracticeError('INVALID', '默认值需在对应范围内。');
  const quantityUnit = form.quantityUnit.trim();
  if (
    !quantityUnit ||
    textLength(quantityUnit) > inputLimits.quantityUnit ||
    /[\s\u0000-\u001f\u007f]/.test(quantityUnit)
  )
    throw new PracticeError('INVALID', '数量单位请填写1～4个字符，不含空格。');
  if (original?.quantityUnitLocked && quantityUnit !== original.quantityUnit)
    throw new PracticeError('INVALID', '已有数量记录，单位不可更改。');
  if (
    !Object.prototype.hasOwnProperty.call(palettes, form.color) ||
    !projectIcons.some((icon) => icon.id === resolveProjectIcon(form.icon))
  )
    throw new PracticeError('INVALID', '请选择有效的外观样式。');
  const mode: Mode =
    form.timeEnabled && form.quantityEnabled ? 'both' : form.timeEnabled ? 'duration' : 'quantity';
  const primaryMetric =
    mode === 'duration' ? 'durationSeconds' : mode === 'quantity' ? 'quantity' : form.primaryMetric;
  if (!['durationSeconds', 'quantity'].includes(primaryMetric))
    throw new PracticeError('INVALID', '请选择主要指标。');
  return {
    id: form.id,
    name,
    frequency: readFrequency(form.frequency),
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

/** Legacy configurations stay readable, but a quick action must never create a new entry above current limits. */
export function canQuickRecord(project: Project): boolean {
  try {
    for (const metric of metricOrder(project).filter((metric) => enabled(project, metric)))
      validateMetricValue(
        metric,
        metric === 'quantity'
          ? project.defaultQuantity
          : project.defaultTime * factors[project.timeUnit],
      );
    return true;
  } catch {
    return false;
  }
}
