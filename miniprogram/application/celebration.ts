import { palettes, type Color } from '../domain/appearance';

/** View-only snapshots keep particle animation independent of storage and the setData frame loop. */
export interface CelebrationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export const celebrationTiming = { mark: 2400, paper: 2800, cleanup: 2850 } as const;
// These are the approved tsParticles 4.6.0 preview parameters, expressed in CSS pixels at 60Hz.
export const celebrationPaper = {
  count: 56,
  scalar: 1.05,
  speed: 11,
  spread: 100,
  decay: 0.94,
  gravity: 0.65,
  drift: 0.4,
  samples: 40,
  // Shrink displacement only: retain the original spray timing, roll/tilt, shading and gradual fade.
  rangeScale: 0.7,
} as const;
const rounded = (value: number, places = 2) => Number(value.toFixed(places));
const tau = Math.PI * 2;

/** Match tsParticles roll/tilt projection; a paper is a skewed square, not a spinning 3D ribbon. */
export function paperProjection(
  rotation: number,
  roll: number,
  tilt: number,
  cosDirection: number,
  sinDirection: number,
) {
  return [
    Math.cos(rotation),
    Math.sin(rotation) * Math.cos(tilt) * cosDirection,
    -Math.sin(rotation) * Math.sin(tilt) * sinDirection,
    Math.cos(rotation) * Math.sin(roll),
  ];
}

/** The upstream reverse face subtracts 25 HSL lightness points, rather than scaling RGB channels. */
function reverseColor(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((channel) => parseInt(channel, 16) / 255);
  const max = Math.max(...rgb),
    min = Math.min(...rgb),
    delta = max - min;
  const light = (max + min) / 2,
    saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  const hue =
    delta === 0
      ? 0
      : (max === rgb[0]
          ? (rgb[1] - rgb[2]) / delta + (rgb[1] < rgb[2] ? 6 : 0)
          : max === rgb[1]
            ? (rgb[2] - rgb[0]) / delta + 2
            : (rgb[0] - rgb[1]) / delta + 4) * 60;
  const backLight = Math.max(0, light - 0.25),
    amplitude = saturation * Math.min(backLight, 1 - backLight);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (backLight - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return '#' + channel(0) + channel(8) + channel(4);
}

/** Reject corrupt/disappeared layout instead of painting over an unrelated card. */
export function createCelebration(rect: CelebrationRect, color: Color, seed: number) {
  if (!Object.values(rect).every(Number.isFinite) || rect.width <= 0 || rect.height <= 0)
    return null;
  let state = seed >>> 0;
  // Independent randomness cannot alter persistent IDs or make repeat celebrations weaker.
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const colors = [palettes[color], '#f0bd58', '#e993aa', '#8bc8ba', '#b7a5e4'];
  const totalFrames = (celebrationTiming.paper / 1000) * 60;
  const moveSpeed = (celebrationPaper.speed * 3) / 2;
  const decayRate = -Math.log(celebrationPaper.decay);
  // Exact damped displacement follows MovePluginInstance; wobble is cumulative in both axes.
  // Equations/projection adapted from tsParticles 4.6.0 (MIT), license in assets/licenses/LICENSE-tsparticles.txt.
  const decayIntegral = (1 - celebrationPaper.decay) / decayRate;
  const accelerationIntegral = (1 - decayIntegral) / decayRate;
  const accelerationY = (celebrationPaper.gravity * 9.81) / (60 * moveSpeed);
  const papers = Array.from({ length: celebrationPaper.count }, (_, id) => {
    const direction = ((-90 + (random() - 0.5) * celebrationPaper.spread) * Math.PI) / 180;
    const initialSpeed = random();
    let vx = Math.cos(direction) * initialSpeed,
      vy = Math.sin(direction) * initialSpeed;
    const accelerationX = ((random() * 2 - 1) * celebrationPaper.drift) / (60 * moveSpeed);
    let rotation = random() * tau,
      roll = random() * tau,
      tilt = random() * tau,
      wobble = random() * tau;
    const rotationVelocity = (((random() > 0.5 ? 1 : -1) * 60) / 360) * random();
    const rollVelocity = (15 + random() * 10) / 360;
    const tiltVelocity = (((random() > 0.5 ? 1 : -1) * 60) / 360) * random();
    const wobbleVelocity = (random() * 30 - 15) / 360;
    const cosDirection = random() > 0.5 ? 1 : -1,
      sinDirection = random() > 0.5 ? 1 : -1;
    const front = colors[Math.floor(random() * colors.length)],
      back = reverseColor(front);
    let x = 0,
      y = 0;
    const frames: Array<{ x: number; y: number; matrix: number[]; shade: string }> = [];
    const snapshot = () => ({
      x,
      y,
      matrix: paperProjection(rotation, roll, tilt, cosDirection, sinDirection),
      shade: roll % tau >= Math.PI ? back : front,
    });
    frames.push(snapshot());
    for (let frame = 1; frame <= totalFrames; frame++) {
      x += (vx * decayIntegral + accelerationX * accelerationIntegral) * moveSpeed;
      y += (vy * decayIntegral + accelerationY * accelerationIntegral) * moveSpeed;
      vx = vx * celebrationPaper.decay + accelerationX * decayIntegral;
      vy = vy * celebrationPaper.decay + accelerationY * decayIntegral;
      rotation += rotationVelocity;
      roll += rollVelocity;
      tilt += tiltVelocity;
      wobble += wobbleVelocity;
      // The preview's distance=30, speed.move=10 gives 1.8px per 60Hz frame, including downward drift.
      x += 1.8 * Math.cos(wobble);
      y += 1.8 * Math.abs(Math.sin(wobble));
      frames.push(snapshot());
    }
    const style = Array.from({ length: celebrationPaper.samples + 1 }, (_, index) => {
      const frame = frames[Math.round((index / celebrationPaper.samples) * totalFrames)];
      const matrix = frame.matrix.map((value) => rounded(value, 3)).join(',');
      const progress = index / celebrationPaper.samples;
      // Match the preview's gradual particle fade and final container fade rather than holding full opacity.
      const opacity = (1 - progress * 0.9) * (progress <= 0.8 ? 1 : (1 - progress) / 0.2);
      return `--f${index}:translate3d(${rounded(frame.x * celebrationPaper.rangeScale)}px,${rounded(frame.y * celebrationPaper.rangeScale)}px,0) matrix(${matrix},0,0);--c${index}:${frame.shade};--o${index}:${rounded(opacity, 3)};`;
    }).join('');
    return { id, style };
  });
  return { rect, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, papers };
}
