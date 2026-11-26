/** Validate complete snapshots before publishing or accepting a recovered generation; entry limits never truncate legacy data. */
import {
  makeProject,
  positive,
  projectForm,
  readFrequency,
  requireId,
  total,
  validDate,
  type Database,
} from '../domain/model';
import { storedTextLimits } from '../domain/input-limits';
import { assertReceipt } from '../domain/command-receipt';
export function assertDatabase(db: Database): void {
  if (db.newProjectDraft != null) {
    const draft = db.newProjectDraft;
    requireId(draft.id);
    readFrequency(draft.frequency);
    for (const key of [
      'name',
      'color',
      'icon',
      'primaryMetric',
      'timeUnit',
      'timeMin',
      'timeMax',
      'defaultTime',
      'quantityUnit',
      'quantityMin',
      'quantityMax',
      'defaultQuantity',
    ] as const) {
      if (typeof draft[key] !== 'string' || draft[key].length > 2000)
        throw new Error('draft fields');
    }
    for (const key of ['timeEnabled', 'quantityEnabled', 'directEntryEnabled'] as const)
      if (typeof draft[key] !== 'boolean') throw new Error('draft switches');
  }
  if (db.undo != null) {
    if (!['create', 'delete'].includes(db.undo.type) || !Number.isFinite(db.undo.expiresAt))
      throw new Error('undo fields');
    assertDatabase({ ...db, records: [db.undo.record], newProjectDraft: null, undo: null });
  }
  const ids = new Set<string>();
  for (const p of db.projects) {
    assertReceipt(p.lastCommand);
    requireId(p.id);
    if (ids.has(p.id)) throw new Error('duplicate project');
    ids.add(p.id);
    makeProject(projectForm(p), p.updatedAt, p);
    positive(p.revision, 'revision');
    if (!Number.isFinite(p.createdAt) || !Number.isFinite(p.updatedAt))
      throw new Error('project date');
  }
  const recordIds = new Set<string>();
  for (const r of db.records) {
    assertReceipt(r.lastCommand);
    requireId(r.id);
    if (!ids.has(r.projectId) || recordIds.has(r.id) || !validDate(r.occurredOn))
      throw new Error('record identity');
    recordIds.add(r.id);
    if (r.durationSeconds == null && r.quantity == null) throw new Error('empty record');
    if (r.durationSeconds != null) positive(r.durationSeconds, 'seconds');
    if (r.quantity != null) {
      positive(r.quantity, 'quantity');
      const p = db.projects.find((p) => p.id === r.projectId)!;
      if (!p.quantityUnitLocked || r.quantityUnit !== p.quantityUnit)
        throw new Error('quantity unit');
    }
    if (
      typeof r.note !== 'string' ||
      Array.from(r.note).length > storedTextLimits.note ||
      !Number.isFinite(r.createdAt) ||
      !Number.isFinite(r.updatedAt) ||
      (r.localTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.localTime))
    )
      throw new Error('record fields');
    positive(r.revision, 'revision');
  }
  for (const p of db.projects) {
    const rows = db.records.filter((r) => r.projectId === p.id);
    total(rows, 'durationSeconds');
    total(rows, 'quantity');
  }
}
