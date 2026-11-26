import { colorOptions, projectIcons, iconTones, resolveProjectIcon } from '../domain/appearance';

/** Resolve only generated name/color pairs; unsupported or old IDs never become arbitrary image paths. */
export function iconSource(name: string, tone: string): string {
  // Historical IDs map to current glyphs without retaining redundant color asset copies.
  const current = resolveProjectIcon(name);
  const safeName = Object.prototype.hasOwnProperty.call(iconTones, current) ? current : 'target';
  const tones = iconTones[safeName];
  const safeTone = tones.includes(tone) ? tone : tones.includes('muted') ? 'muted' : tones[0];
  return `/assets/icons/${safeTone}/${safeName}.svg`;
}

/** Keep extended selections visible when folded without mutating the canonical order or saved form. */
export function compactOptions<T extends { id: string }>(
  options: T[],
  selected: string,
  expanded: boolean,
): T[] {
  if (expanded) return options;
  const compact = options.slice(0, 5);
  const current = options.find((option) => option.id === selected);
  if (current && !compact.some((option) => option.id === selected)) compact[4] = current;
  return compact;
}

/** Expansion is transient view state; only color/icon belong to the project and retained raw draft. */
export function appearanceChoices(form: { color: string; icon: string }, expanded: boolean) {
  return {
    colors: compactOptions(colorOptions, form.color, expanded),
    icons: compactOptions(projectIcons, resolveProjectIcon(form.icon), expanded),
  };
}
