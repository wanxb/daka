import { celebrationTiming, type CelebrationRect } from './celebration';

/** System glyphs stay atomic (including paired phrases); no remote font or artwork is loaded. */
export const celebrationEmojiPool = [
  '👍',
  '666',
  '💪',
  '🐂🍺',
  '🎉',
  '🎁',
  '👏',
  '🥳',
  '🔥',
  '🏆',
  '✨',
  '💯',
  '🙌',
  '🤩',
  '😎',
  '🚀',
  '🌟',
  '⭐',
  '🎊',
  '🎈',
  '🥇',
  '🏅',
  '🎯',
  '💥',
  '💐',
  '🌈',
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
] as const;
const samples = 40;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const rounded = (value: number) => Number(value.toFixed(3));

/** Prepare validated layout deterministically; WXSS interpolates snapshots without timers or frame-by-frame setData. */
export function createEmojiBurst(
  rect: CelebrationRect,
  viewportWidth: number,
  seed: number,
  previous: readonly string[],
) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const shuffle = (values: string[]) => {
    for (let index = values.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
  };
  // At least eight new glyphs per Emoji burst, even when a paper celebration occurred in between.
  const candidates = shuffle([...celebrationEmojiPool]);
  const fresh = candidates.filter((text) => !previous.includes(text)).slice(0, 8);
  const selected = shuffle([
    ...fresh,
    ...candidates.filter((text) => !fresh.includes(text)).slice(0, 16 - fresh.length),
  ]);
  const origin = rect.left + rect.width / 2;
  // Equal room on both sides protects edge cards from asymmetric compression and keeps the burst centered.
  const room = Math.max(0, Math.min(140, origin - 26, viewportWidth - origin - 26));
  const pairs = Array.from({ length: selected.length / 2 }, (_, index) => ({
    direction: -Math.PI / 2 + index * 2.399963229728653,
    radius: Math.sqrt((index + 1) / (selected.length / 2)),
    size: (index % 3 === 0 ? 28 : 22) + random() * 2,
    phase: random() * Math.PI * 2,
    tilt: (random() - 0.5) * 0.24,
    offsetX: (random() - 0.5) * 6,
  }));
  const extent = Math.max(...pairs.map((pair) => Math.abs(Math.cos(pair.direction) * pair.radius)));
  return selected.map((text, id) => {
    const pairIndex = Math.floor(id / 2),
      pair = pairs[pairIndex],
      sign = id % 2 ? -1 : 1;
    const delay = pairIndex * 0.016;
    const spreadX = (Math.cos(pair.direction) * room * pair.radius * sign) / extent;
    const spreadY = Math.sin(pair.direction) * 88 * pair.radius * sign;
    const phase = pair.phase + (sign < 0 ? Math.PI : 0);
    const style = Array.from({ length: samples + 1 }, (_, frame) => {
      // Both materials share the cleanup deadline; sampling must not outlive the existing success stage.
      const elapsed = ((frame / samples) * celebrationTiming.paper) / 1000,
        age = Math.max(0, elapsed - delay);
      const bloom = 1 - Math.exp(-5 * age);
      const x = pair.offsetX * sign + spreadX * bloom + Math.sin(age * 1.5 + phase) * 2 * bloom;
      const y = spreadY * bloom + 12 * age * age;
      const scale = 0.65 + 0.35 * smooth(age / 0.22);
      const angle = pair.tilt * sign + Math.sin(age * 1.6 + phase) * 0.08;
      const opacity = smooth(age / 0.1) * (1 - smooth((elapsed - 1.85) / 0.9));
      return `--e${frame}:translate3d(${rounded(x)}px,${rounded(y)}px,0) rotate(${rounded(angle)}rad) scale(${rounded(scale)});--a${frame}:${rounded(opacity)};`;
    }).join('');
    return { id, text, size: rounded(pair.size), style };
  });
}
