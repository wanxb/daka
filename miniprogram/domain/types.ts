/** Persisted contracts and error identity stay independent of UI and platform code. */
import type { Color } from './appearance';

/** Canonical local data: time is whole seconds; quantity never means record count. */
export type Metric = 'durationSeconds' | 'quantity';

/** 秒 is retained solely for reading and editing legacy projects; all durations remain whole seconds. */
export type TimeUnit = '分' | '时' | '天' | '秒';

// Missing stored values belong to pre-frequency data; explicit invalid values must still fail validation.
export type Frequency = 'day' | 'week' | 'month';

export type Mode = 'duration' | 'quantity' | 'both';

/** One bounded receipt confirms a lost callback without treating an unrelated stale edit as success. */
export interface CommandReceipt {
  id: string;
  request: string;
}

export interface Project {
  lastCommand?: CommandReceipt;
  id: string;
  name: string;
  /** Display cadence is independent of the metric and the number of records. */
  frequency: Frequency;
  color: Color;
  icon: string;
  mode: Mode;
  primaryMetric: Metric;
  timeUnit: TimeUnit;
  timeMin: number;
  timeMax: number;
  defaultTime: number;
  quantityUnit: string;
  quantityUnitLocked: boolean;
  quantityMin: number;
  quantityMax: number;
  defaultQuantity: number;
  directEntryEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface PracticeRecord {
  lastCommand?: CommandReceipt;
  id: string;
  projectId: string;
  occurredOn: string;
  localTime: string;
  durationSeconds: number | null;
  quantity: number | null;
  quantityUnit: string | null;
  note: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

/** Raw strings survive cancellation of project creation, including temporarily invalid configuration. */
export interface ProjectForm {
  id: string;
  name: string;
  /** Display cadence is independent of the metric and the number of records. */
  frequency: Frequency;
  color: Color;
  icon: string;
  timeEnabled: boolean;
  quantityEnabled: boolean;
  primaryMetric: Metric;
  timeUnit: TimeUnit;
  timeMin: string;
  timeMax: string;
  defaultTime: string;
  quantityUnit: string;
  quantityMin: string;
  quantityMax: string;
  defaultQuantity: string;
  directEntryEnabled: boolean;
}

export interface RecordInput {
  id: string;
  projectId: string;
  occurredOn: string;
  localTime: string;
  durationSeconds: number | null;
  quantity: number | null;
  note: string;
}

export interface UndoEntry {
  type: 'create' | 'delete';
  record: PracticeRecord;
  expiresAt: number;
}

export interface Database {
  schemaVersion: 1;
  projects: Project[];
  records: PracticeRecord[];
  newProjectDraft: ProjectForm | null;
  undo: UndoEntry | null;
}

export class PracticeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PracticeError';
  }
}

export const emptyDatabase = (): Database => ({
  schemaVersion: 1,
  projects: [],
  records: [],
  newProjectDraft: null,
  undo: null,
});
