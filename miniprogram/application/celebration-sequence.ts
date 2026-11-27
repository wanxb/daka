import type { Color } from '../domain/appearance';
import { createCelebration, type CelebrationRect } from './celebration';
import { createEmojiBurst } from './celebration-emoji';

/** One presentation contract keeps page markup independent of particle preparation and alternation policy. */
export interface SuccessCelebration {
  kind: 'paper' | 'emoji';
  rect: CelebrationRect;
  x: number;
  y: number;
  papers: Array<{ id: number; style: string }>;
  emojis: ReturnType<typeof createEmojiBurst>;
}

/** Own per-page, disposable visual state only. Dismissal/undo never rewinds it or touches record persistence. */
export function createCelebrationSequence() {
  let nextKind: SuccessCelebration['kind'] = 'paper';
  let previousEmoji: string[] = [];
  return {
    /** Advance only after valid visible layout has produced a snapshot; rejected measurements consume no turn. */
    next(
      rect: CelebrationRect,
      color: Color,
      seed: number,
      viewportWidth: number,
    ): SuccessCelebration | null {
      if (
        !Object.values(rect).every(Number.isFinite) ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        !Number.isFinite(viewportWidth) ||
        viewportWidth <= 0 ||
        rect.left < 0 ||
        rect.left + rect.width > viewportWidth + 1
      )
        return null;
      let result: SuccessCelebration;
      if (nextKind === 'paper') {
        const paper = createCelebration(rect, color, seed);
        if (!paper) return null;
        result = { ...paper, kind: 'paper', emojis: [] };
      } else {
        const emojis = createEmojiBurst(rect, viewportWidth, seed, previousEmoji);
        result = {
          kind: 'emoji',
          rect,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          papers: [],
          emojis,
        };
        previousEmoji = emojis.map((item) => item.text);
      }
      nextKind = nextKind === 'paper' ? 'emoji' : 'paper';
      return result;
    },
  };
}
