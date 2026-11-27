import {
  initialForm,
  makeProject,
  midpoint,
  projectForm,
  range,
  type Project,
  type ProjectForm,
  type TimeUnit,
} from '../domain/model';
import { timeInputLimits, quantityUnitAllowed } from '../domain/input-limits';

const defaults = initialForm();
const metricFields = {
  time: ['timeUnit', 'timeMin', 'timeMax', 'defaultTime'],
  quantity: ['quantityUnit', 'quantityMin', 'quantityMax', 'defaultQuantity'],
} as const;

export type ProjectFocusTarget =
  | 'name'
  | 'types'
  | 'quantityUnit'
  | 'timeMin'
  | 'timeMax'
  | 'defaultTime'
  | 'quantityMin'
  | 'quantityMax'
  | 'defaultQuantity';

/** Locate the first incomplete visible control; this guides editing and never replaces domain write validation. */
export function projectFocusTarget(form: ProjectForm): ProjectFocusTarget {
  if (!form.name.trim()) return 'name';
  if (!form.timeEnabled && !form.quantityEnabled) return 'types';
  for (const kind of ['time', 'quantity'] as const) {
    if (!form[`${kind}Enabled`]) continue;
    // Invalid vocabulary points back to its input rather than misleading users by focusing the name.
    if (kind === 'quantity' && !quantityUnitAllowed(form.quantityUnit.trim()))
      return 'quantityUnit';
    const minimum = `${kind}Min` as const,
      maximum = `${kind}Max` as const;
    if (!/^\d+$/.test(form[minimum])) return minimum;
    try {
      range(form[minimum], form[maximum], '');
    } catch {
      return maximum;
    }
    const key = kind === 'time' ? 'defaultTime' : 'defaultQuantity';
    if (!/^\d+$/.test(form[key]) || Number(form[key]) <= 0) return key;
  }
  // Admission filters handle malformed/oversized edits; the fallback keeps unexpected legacy failures editable.
  return 'name';
}

/** Prepare the same immutable candidate for submission eligibility and persistence; never rewrite a raw draft here. */
export function prepareProjectForm(form: ProjectForm, original?: Project): ProjectForm {
  const candidate = { ...form };
  const baseline = original ? projectForm(original) : { ...defaults, id: form.id };
  for (const kind of ['time', 'quantity'] as const) {
    const key = kind === 'time' ? 'defaultTime' : 'defaultQuantity';
    try {
      const [min, max] = range(candidate[`${kind}Min`], candidate[`${kind}Max`], '');
      // Complete numbers settle on submit just as on blur; empty visible inputs still disable saving.
      if (/^\d+$/.test(candidate[key]) && Number.isSafeInteger(Number(candidate[key])))
        candidate[key] = String(Math.min(max, Math.max(1, min, Number(candidate[key]))));
    } catch {
      /* Incomplete ranges must stay editable and fail the real domain validator when enabled. */
    }
    if (candidate[`${kind}Enabled`]) continue;
    const retained = Object.fromEntries(
      metricFields[kind].map((field) => [field, candidate[field]]),
    );
    try {
      // Test hidden settings in isolation so an unrelated unfinished visible field cannot discard valid values.
      makeProject(
        { ...baseline, ...retained, name: '配置', timeEnabled: true, quantityEnabled: true },
        0,
        original,
      );
    } catch {
      // A collapsed incomplete group uses its last saved settings (or new-project defaults) only for this write.
      Object.assign(
        candidate,
        Object.fromEntries(metricFields[kind].map((field) => [field, baseline[field]])),
      );
    }
  }
  return candidate;
}

/** A unit switch keeps integer controls usable: only values above the new unit’s equivalent 365-day cap are reduced. */
export function changeTimeUnit(form: ProjectForm, unit: TimeUnit): ProjectForm {
  const next = { ...form, timeUnit: unit };
  if (form.timeUnit === unit) return next;
  const maximum = timeInputLimits[unit];
  for (const field of ['timeMin', 'timeMax', 'defaultTime'] as const)
    if (/^\d+$/.test(next[field]) && Number(next[field]) > maximum) next[field] = String(maximum);
  if (next.timeMin !== form.timeMin || next.timeMax !== form.timeMax) {
    try {
      const [min, max] = range(next.timeMin, next.timeMax, '');
      next.defaultTime = String(midpoint(min, max));
    } catch {
      /* Switching units cannot silently fill a deliberately unfinished range. */
    }
  }
  return next;
}
