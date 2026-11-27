/** Shared entry limits protect compact cards and bound individual entries; lifetime totals use separate overflow checks. */
export const inputLimits = {
  // Experience-version admission policy only: reading, editing and recording older larger stores remain valid.
  projects: 15,
  projectName: 6,
  note: 100,
  noteLineBreaks: 2,
  quantityUnit: 4,
  search: 20,
  quantity: 99_999,
  // A day is a fixed duration, not a calendar date span; all visible units share the same 365-day cap.
  durationSeconds: 365 * 86_400,
  timeDecimals: 4,
  earliestDate: '1900-01-01',
} as const;
// These are storage compatibility ceilings, not permission to enter new oversized values.
export const storedTextLimits = { projectName: 24, note: 500 } as const;
/** One strict vocabulary keeps quantity labels meaningful; arbitrary custom units have no compatibility exception. */
export const quantityUnits: readonly string[] = [
  '次',
  '个',
  '件',
  '张',
  '页',
  '字',
  '本',
  '篇',
  '题',
  '道',
  '组',
  '遍',
  '首',
  '节',
  '圈',
  '步',
  '米',
  '千米',
  '杯',
  '毫升',
];
export function quantityUnitAllowed(unit: string): boolean {
  return quantityUnits.includes(unit);
}
// Seconds remain a read/validation compatibility unit; new configuration exposes only 分、时、天.
export const selectableTimeUnits = ['分', '时', '天'] as const;
export const timeInputLimits = { 分: 525_600, 时: 8760, 天: 365, 秒: 31_536_000 } as const;
export const timeIntegerLengths = { 分: 6, 时: 4, 天: 3, 秒: 8 } as const;
export const textLength = (text: string) => Array.from(text).length;
// Emoji can span many code points: pair flags, keycaps, modifiers, tag flags and ZWJ sequences before counting.
// Keep this deterministic on WeChat engines without Intl.Segmenter; other text limits retain their code-point policy.
const projectNameSymbols =
  /\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}[\p{M}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*(?:\u200D\p{Extended_Pictographic}[\p{M}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*)*|[\s\S]/gu;
export const projectNameLength = (text: string) => (text.match(projectNameSymbols) || []).length;
/** Reject a whole oversized edit; never slice a composed emoji or discard text following a middle insertion. */
export function acceptProjectNameDraft(text: string, previous: string): boolean {
  const length = projectNameLength(text);
  return length <= inputLimits.projectName || length < projectNameLength(previous);
}
/** Reject oversized insertion/paste as a whole, while allowing an old long value to shrink without truncation. */
export function acceptTextDraft(text: string, previous: string, maximum: number): boolean {
  return textLength(text) <= maximum || textLength(text) < textLength(previous);
}
/** Code-point slicing never leaves half of a surrogate pair after pasted text is shortened. */
export const limitText = (text: string, maximum: number) =>
  Array.from(text).slice(0, maximum).join('');
export const singleLine = (text: string) =>
  text.replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
export const normalizeNote = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
export const noteLineBreaks = (text: string) => normalizeNote(text).split('\n').length - 1;
/** Reject the entire edit instead of clipping a suffix when text is inserted into an existing note. */
export function limitNote(text: string, previous = ''): string {
  const normalized = normalizeNote(text);
  return textLength(normalized) <= inputLimits.note &&
    noteLineBreaks(normalized) <= inputLimits.noteLineBreaks &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(normalized)
    ? normalized
    : previous;
}
export const numericLength = (maximum: number, decimals = 0) =>
  String(maximum).length + (decimals ? decimals + 1 : 0);
/** Empty/partial decimal text stays editable; sign, exponent and extra decimal places never become a different number. */
export function numericDraft(text: string, maximum: number, decimals = 0): boolean {
  const pattern = decimals ? new RegExp('^\\d*(?:\\.\\d{0,' + decimals + '})?$') : /^\d*$/;
  return (
    pattern.test(text) &&
    text.length <= numericLength(maximum, decimals) &&
    (text === '' ||
      (decimals > 0 && text === '.') ||
      (Number.isFinite(Number(text)) && Number(text) <= maximum))
  );
}
/** Old oversized values can be shortened gradually without allowing a fresh oversized entry or extending the old text. */
export function acceptNumericDraft(
  text: string,
  previous: string,
  maximum: number,
  decimals = 0,
): boolean {
  if (numericDraft(text, maximum, decimals)) return true;
  const pattern = decimals ? new RegExp('^\\d+(?:\\.\\d{0,' + decimals + '})?$') : /^\d+$/;
  return (
    !numericDraft(previous, maximum, decimals) &&
    text.length < previous.length &&
    pattern.test(text) &&
    Number(text) < Number(previous)
  );
}
