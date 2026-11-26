// User-facing failures distinguish uncertain writes from confirmed failures; never suggest clearing local records.
import { commandReceipt, confirms } from '../domain/command-receipt';
import { inputLimits } from '../domain/input-limits';
import {
  dateKey,
  enabled,
  factors,
  makeProject,
  newId,
  positive,
  PracticeError,
  projectForm,
  total,
  validateRecord,
  validateMetricValue,
  type Database,
  type Metric,
  type PracticeRecord,
  type Project,
  type ProjectForm,
  type RecordInput,
} from '../domain/model';
import { LocalRepository } from '../infrastructure/repository';
import { WechatFiles } from '../infrastructure/wechat-files';
import { normalizeNote } from '../domain/input-limits';
import { initialData } from './initial-data';
/** Explicit numeric entry may remember preferences only against the project revision shown in that sheet. */
export interface RecordPreferences {
  projectRevision: number;
  metrics: readonly Metric[];
}
/** Build configuration changes in the same staged transaction as the record; typing and blur never persist them. */
function recordingProject(
  project: Project,
  input: RecordInput,
  metrics: readonly Metric[],
  now: number,
) {
  const form = projectForm(project);
  let changed = false;
  for (const metric of new Set(metrics)) {
    if (!['durationSeconds', 'quantity'].includes(metric) || !enabled(project, metric))
      throw new PracticeError('INVALID', '此记录类型已关闭，请前往项目设置检查。');
    validateMetricValue(metric, input[metric]);
    const value = positive(input[metric], metric === 'quantity' ? '数量' : '时间');
    const amount = metric === 'quantity' ? value : value / factors[project.timeUnit];
    const kind = metric === 'quantity' ? 'quantity' : 'time';
    const minimum = String(Math.min(project[`${kind}Min`], Math.floor(amount)));
    const maximum = String(Math.max(project[`${kind}Max`], Math.ceil(amount)));
    const key = metric === 'quantity' ? 'defaultQuantity' : 'defaultTime';
    // Configuration defaults remain integers; fractional time stays exact in the record, without rounding it into a new default.
    const preferred = Number.isSafeInteger(amount) ? String(amount) : form[key];
    changed ||=
      minimum !== form[`${kind}Min`] || maximum !== form[`${kind}Max`] || preferred !== form[key];
    form[`${kind}Min`] = minimum;
    form[`${kind}Max`] = maximum;
    form[key] = preferred;
  }
  return changed ? makeProject(form, now, project) : project;
}
/** Commands own validation, revision checks and undo; pages never write filesystem or aggregates directly. */
export class PracticeService {
  constructor(
    public repository: LocalRepository,
    private now: () => number = Date.now,
  ) {}
  snapshot(): Promise<Database> {
    return this.repository.snapshot();
  }
  /** UI preparation opts into first-use data; low-level snapshots remain read-only for recovery and inspection. */
  async initialize(): Promise<void> {
    await this.repository.initializeNewUser(() => initialData(this.now()));
  }
  /** A stable optional operation ID confirms only this exact command after an uncertain durable write. */
  saveProject(form: ProjectForm, expectedRevision?: number, operationId?: string) {
    // Capture before entering the queue: a caller's later edits must not change the content covered by this receipt.
    form = { ...form };
    const receipt = commandReceipt(operationId, [form, expectedRevision]);
    return this.repository.transaction((db) => {
      const original = db.projects.find((p) => p.id === form.id);
      if (original && confirms(original.lastCommand, receipt)) {
        // A creation retry may have flushed its still-open draft again after the first durable commit.
        if (expectedRevision == null && db.newProjectDraft?.id === original.id)
          db.newProjectDraft = null;
        return original;
      }
      if (expectedRevision != null && original?.revision !== expectedRevision)
        throw new PracticeError('CONFLICT', '项目设置已更新，请返回后重新打开。');
      if (original && expectedRevision == null) {
        const candidate = {
          ...makeProject(form, original.updatedAt, original),
          lastCommand: original.lastCommand,
        };
        if (
          JSON.stringify({ ...candidate, revision: original.revision }) !== JSON.stringify(original)
        )
          throw new PracticeError('CONFLICT', '此项目已存在，请返回查看。');
        if (db.newProjectDraft?.id === original.id) db.newProjectDraft = null;
        return original;
      }
      // Capacity belongs inside this serialized transaction; retries/updates and legacy stores do not consume new slots.
      if (!original && db.projects.length >= inputLimits.projects)
        throw new PracticeError(
          'LIMIT',
          `体验版最多创建${inputLimits.projects}个打卡项目。请删除不需要的项目后再新增。`,
        );
      const project = makeProject(form, this.now(), original);
      if (receipt) project.lastCommand = receipt;
      if (original) db.projects = db.projects.map((p) => (p.id === project.id ? project : p));
      else {
        db.projects.push(project);
        db.newProjectDraft = null;
      }
      return project;
    });
  }
  /** Persist a complete permutation atomically; stale views must not drop new projects or resurrect deleted IDs. */
  reorderProjects(ids: readonly string[], expectedOrder?: readonly string[]): Promise<void> {
    return this.repository.transaction((db) => {
      const current = db.projects.map((p) => p.id),
        byId = new Map(db.projects.map((p) => [p.id, p]));
      if (
        ids.length !== current.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !byId.has(id))
      )
        throw new PracticeError('CONFLICT', '项目列表已变化，请重新整理。');
      if (
        expectedOrder &&
        (expectedOrder.length !== current.length ||
          expectedOrder.some((id, i) => id !== current[i]))
      )
        throw new PracticeError('CONFLICT', '排序已变化，请重新整理。');
      // Array order already round-trips through the repository; project revisions and records stay untouched.
      db.projects = ids.map((id) => byId.get(id)!);
    });
  }
  saveDraft(form: ProjectForm): Promise<void> {
    return this.repository.transaction((db) => {
      db.newProjectDraft = form;
    });
  }
  /** Omitting preferences retains strict range validation for quick records and existing callers. */
  saveRecord(
    input: RecordInput,
    expectedRevision?: number,
    preferences?: RecordPreferences,
    operationId?: string,
  ) {
    // Only editable record fields identify the command; callers may pass a persisted record with extra metadata.
    const {
      id,
      projectId,
      occurredOn,
      localTime,
      durationSeconds,
      quantity,
      note: requestedNote,
    } = input;
    input = {
      id,
      projectId,
      occurredOn,
      localTime,
      durationSeconds,
      quantity,
      note: requestedNote,
    };
    preferences = preferences ? { ...preferences, metrics: [...preferences.metrics] } : undefined;
    const receipt = commandReceipt(operationId, [
      { id, projectId, occurredOn, localTime, durationSeconds, quantity, note: requestedNote },
      expectedRevision,
      preferences,
    ]);
    return this.repository.transaction((db) => {
      const project = db.projects.find((p) => p.id === input.projectId);
      if (!project) throw new PracticeError('MISSING', '此项目已不存在，请返回首页。');
      const old = db.records.find((r) => r.id === input.id);
      if (typeof input.note !== 'string') throw new PracticeError('INVALID', '请填写有效备注。');
      // Normalize new text once for both retries and persistence; untouched legacy notes keep their exact contents.
      const note = old?.note === input.note ? old.note : normalizeNote(input.note).trim();
      if (old && old.projectId !== input.projectId)
        throw new PracticeError('CONFLICT', '无法将记录移到其他项目。');
      if (old && confirms(old.lastCommand, receipt)) return old;
      if (expectedRevision != null && old?.revision !== expectedRevision)
        throw new PracticeError('CONFLICT', '此记录已更改或删除，请关闭后重新打开。');
      if (old && expectedRevision == null) {
        // An uncertain write can be retried with the same ID, but differing data is never silently accepted.
        if (
          old.projectId !== input.projectId ||
          old.occurredOn !== input.occurredOn ||
          old.localTime !== input.localTime ||
          old.durationSeconds !== input.durationSeconds ||
          old.quantity !== input.quantity ||
          old.note !== note
        )
          throw new PracticeError('CONFLICT', '此记录已有其他保存内容，请返回查看。');
        return old;
      }
      // Idempotent retries above must succeed even when the first commit already advanced the project revision.
      if (preferences?.metrics.length && preferences.projectRevision !== project.revision)
        throw new PracticeError('CONFLICT', '项目设置已更新，请关闭记录面板后重新打开。');
      const updatedProject = preferences?.metrics.length
        ? recordingProject(project, input, preferences.metrics, this.now())
        : project;
      validateRecord({ ...input, note }, updatedProject, dateKey(new Date(this.now())), old);
      const record: PracticeRecord = {
        id,
        projectId,
        occurredOn,
        localTime,
        durationSeconds,
        quantity,
        note,
        quantityUnit: input.quantity == null ? null : project.quantityUnit,
        createdAt: old?.createdAt ?? this.now(),
        updatedAt: this.now(),
        revision: (old?.revision ?? 0) + 1,
      };
      if (receipt) record.lastCommand = receipt;
      const rows = db.records
        .filter((r) => r.id !== record.id && r.projectId === project.id)
        .concat(record);
      total(rows, 'durationSeconds');
      total(rows, 'quantity');
      if (old) db.records = db.records.map((r) => (r.id === record.id ? record : r));
      else db.records.push(record);
      if (record.quantity != null) updatedProject.quantityUnitLocked = true;
      if (updatedProject !== project)
        db.projects = db.projects.map((p) => (p.id === project.id ? updatedProject : p));
      if (!old) db.undo = { type: 'create', record, expiresAt: this.now() + 5000 };
      return record;
    });
  }
  quickRecord(projectId: string, recordId = newId()) {
    return this.snapshot().then((db) => {
      const p = db.projects.find((p) => p.id === projectId);
      if (!p) throw new PracticeError('MISSING', '此项目已不存在，请返回首页。');
      return this.saveRecord({
        id: recordId,
        projectId,
        occurredOn: dateKey(new Date(this.now())),
        localTime: '',
        durationSeconds: enabled(p, 'durationSeconds') ? p.defaultTime * factors[p.timeUnit] : null,
        quantity: enabled(p, 'quantity') ? p.defaultQuantity : null,
        note: '',
      });
    });
  }
  deleteRecord(id: string, expectedRevision: number): Promise<void> {
    return this.repository.transaction((db) => {
      const record = db.records.find((r) => r.id === id);
      if (!record || record.revision !== expectedRevision)
        throw new PracticeError('CONFLICT', '记录已更新，请重新查看。');
      db.records = db.records.filter((r) => r.id !== id);
      db.undo = { type: 'delete', record, expiresAt: this.now() + 5000 };
    });
  }
  undo(): Promise<void> {
    return this.repository.transaction((db) => {
      const entry = db.undo;
      if (
        !entry ||
        this.now() >= entry.expiresAt ||
        !db.projects.some((p) => p.id === entry.record.projectId)
      )
        throw new PracticeError('EXPIRED', '已超过撤销时限。');
      const current = db.records.find((r) => r.id === entry.record.id);
      if (entry.type === 'create') {
        if (!current || current.revision !== entry.record.revision)
          throw new PracticeError('CONFLICT', '记录已修改，无法撤销之前的操作。');
        db.records = db.records.filter((r) => r.id !== current.id);
      } else {
        if (current) throw new PracticeError('CONFLICT', '记录已存在，无法重复恢复。');
        // Restoration is a later command: an earlier editor's receipt cannot acknowledge a pre-deletion save again.
        const { lastCommand: _receipt, ...restored } = entry.record;
        db.records.push(restored);
      }
      db.undo = null;
    });
  }
}
let singleton: PracticeService | undefined;
/** Lazy platform access keeps domain/repository code executable in isolated tests without a WeChat global. */
export function service(): PracticeService {
  return (singleton ||= new PracticeService(new LocalRepository(new WechatFiles())));
}
export async function prepare(): Promise<Database> {
  // All business pages prepare before reading, so navigation and refresh share the same one-time transaction.
  await service().initialize();
  const db = await service().snapshot();
  if (service().repository.recoveryRequired) {
    const answer = await wx.showModal({
      title: '可使用较早的数据副本',
      content:
        '最近的本地数据检查未通过。目前显示较早的数据副本，可能缺少最近的记录或修改。是否使用此副本继续保存？',
      confirmText: '使用此副本',
      cancelText: '暂不保存',
    });
    if (answer.confirm) service().repository.acknowledgeRecovery();
  }
  return db;
}
