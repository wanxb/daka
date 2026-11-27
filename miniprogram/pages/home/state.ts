/** Modules share the same native page instance: no second state store, lifecycle or event dispatch is introduced. */
import type { projectTile } from '../../application/presentation';
import type {
  SuccessCelebration,
  createCelebrationSequence,
} from '../../application/celebration-sequence';
import type { CardSlot } from '../../application/project-order';
import { inputLimits } from '../../domain/input-limits';
import type { Database, PracticeRecord } from '../../domain/model';
export const homeData = {
  arranging: false,
  arrangeSaving: false,
  draggingId: '',
  dragStyle: '',
  shiftStyles: {} as Record<string, string>,
  placeholderStyle: '',
  settling: false,
  motionDelays: {} as Record<string, number>,
  navigationHeight: 88,
  tileHeight: 208,
  query: '',
  searchFocus: false,
  loadError: false,
  tiles: [] as ReturnType<typeof projectTile>[],
  loading: true,
  projectLimitReached: false,
  error: '',
  busyId: '',
  toast: '',
  shareRecordId: '',
  expiresAt: 0,
  limits: inputLimits,
  celebration: null as SuccessCelebration | null,
};
export const homeState = {
  _orderIds: [] as string[],
  _originalOrder: [] as string[],
  _scrollTop: 0,
  _drag: null as null | {
    id: string;
    startX: number;
    startY: number;
    scroll: number;
    target: number;
    slots: CardSlot[];
    x: number;
    y: number;
  },
  _scrollTimer: null as ReturnType<typeof setInterval> | null,
  _dropTimer: null as ReturnType<typeof setTimeout> | null,
  _previewTarget: -1,
  _dragVersion: 0,
  _suppressTapUntil: 0,
  _navigationHeight: 88,
  _db: null as Database | null,
  // A snapshot/day pair owns all aggregates; searching only filters ready cards and never rescans record history.
  _tileSource: null as Database | null,
  _tileDay: '',
  _tileCache: [] as ReturnType<typeof projectTile>[],
  _lastTap: 0,
  _tapProject: '',
  _quickId: '',
  _quickProject: '',
  _alive: true,
  _visible: true,
  _sheetOpen: false,
  _pendingCelebration: null as PracticeRecord | null,
  _celebrationVersion: 0,
  // Lazily initialize per instance: module-level closures would leak the sequence between home pages.
  _celebrationSequence: null as ReturnType<typeof createCelebrationSequence> | null,
  _celebrationTimer: null as ReturnType<typeof setTimeout> | null,
  _loadVersion: 0,
  // A hide/show cycle must not revive an export started before the page was hidden.
  _shareEpoch: 0,
  _sharing: false,
};
/** Narrow runtime contract for extracted actions; Page remains the sole owner of their lifecycle. */
export type HomePage = WechatMiniprogram.Page.Instance<
  typeof homeData,
  typeof homeState & {
    load(): Promise<void>;
    filter(): void;
    stopCelebration(): void;
    celebrateRecord(record: PracticeRecord): void;
    notify(message: string, record?: PracticeRecord): void;
    cancelDrag(): void;
    previewDrag(): void;
  }
>;
