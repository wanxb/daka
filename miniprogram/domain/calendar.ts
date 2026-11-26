/** Calendar arithmetic stays local and keeps occurrence dates independent of saved timestamps. */

/** Local calendar strings retain the user-confirmed day across timezone and daylight-saving transitions. */
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendar(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(calendar(value)) === value;
}

export function moveDay(value: string, offset: number): string {
  const date = calendar(value);
  date.setDate(date.getDate() + offset);
  return dateKey(date);
}
