import {
  dateKey,
  enabled,
  factors,
  makeProject,
  newId,
  PracticeError,
  total,
  validateRecord,
  type Database,
  type PracticeRecord,
  type ProjectForm,
  type RecordInput,
} from '../domain/model';
import { LocalRepository } from '../infrastructure/repository';
import { WechatFiles } from '../infrastructure/wechat-files';
/** Commands own validation, revision checks and undo; pages never write filesystem or aggregates directly. */
export class PracticeService {
  constructor(
    public repository: LocalRepository,
    private now: () => number = Date.now,
  ) {}
  snapshot(): Promise<Database> {
    return this.repository.snapshot();
  }
  saveProject(form: ProjectForm, expectedRevision?: number) {
    return this.repository.transaction((db) => {
      const original = db.projects.find((p) => p.id === form.id);
      if (expectedRevision != null && original?.revision !== expectedRevision)
        throw new PracticeError('CONFLICT', '项目已被修改，请返回后重新打开。');
      if (original && expectedRevision == null) {
        const candidate = makeProject(form, original.updatedAt, original);
        if (
          JSON.stringify({ ...candidate, revision: original.revision }) !== JSON.stringify(original)
        )
          throw new PracticeError('CONFLICT', '项目已存在，请返回查看。');
        return original;
      }
      const project = makeProject(form, this.now(), original);
      if (original) db.projects = db.projects.map((p) => (p.id === project.id ? project : p));
      else {
        db.projects.push(project);
        db.newProjectDraft = null;
      }
      return project;
    });
  }
  saveDraft(form: ProjectForm): Promise<void> {
    return this.repository.transaction((db) => {
      db.newProjectDraft = form;
    });
  }
  saveRecord(input: RecordInput, expectedRevision?: number) {
    return this.repository.transaction((db) => {
      const project = db.projects.find((p) => p.id === input.projectId);
      if (!project) throw new PracticeError('MISSING', '项目已经不存在。');
      const old = db.records.find((r) => r.id === input.id);
      if (old && old.projectId !== input.projectId)
        throw new PracticeError('CONFLICT', '记录所属项目不能变更。');
      if (expectedRevision != null && old?.revision !== expectedRevision)
        throw new PracticeError('CONFLICT', '记录已被修改或删除，请重新打开。');
      if (old && expectedRevision == null) {
        // An uncertain write can be retried with the same ID, but differing data is never silently accepted.
        if (
          old.projectId !== input.projectId ||
          old.occurredOn !== input.occurredOn ||
          old.localTime !== input.localTime ||
          old.durationSeconds !== input.durationSeconds ||
          old.quantity !== input.quantity ||
          old.note !== input.note.trim()
        )
          throw new PracticeError('CONFLICT', '记录已保存且内容不同，请返回查看。');
        return old;
      }
      validateRecord(input, project, dateKey(new Date(this.now())), old);
      const record: PracticeRecord = {
        ...input,
        note: input.note.trim(),
        quantityUnit: input.quantity == null ? null : project.quantityUnit,
        createdAt: old?.createdAt ?? this.now(),
        updatedAt: this.now(),
        revision: (old?.revision ?? 0) + 1,
      };
      const rows = db.records
        .filter((r) => r.id !== record.id && r.projectId === project.id)
        .concat(record);
      total(rows, 'durationSeconds');
      total(rows, 'quantity');
      if (old) db.records = db.records.map((r) => (r.id === record.id ? record : r));
      else db.records.push(record);
      if (record.quantity != null) project.quantityUnitLocked = true;
      if (!old) db.undo = { type: 'create', record, expiresAt: this.now() + 5000 };
      return record;
    });
  }
  quickRecord(projectId: string, recordId = newId()) {
    return this.snapshot().then((db) => {
      const p = db.projects.find((p) => p.id === projectId);
      if (!p) throw new PracticeError('MISSING', '项目不存在。');
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
        throw new PracticeError('CONFLICT', '记录已变化，请重新查看。');
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
        throw new PracticeError('EXPIRED', '已超过可撤销时间。');
      const current = db.records.find((r) => r.id === entry.record.id);
      if (entry.type === 'create') {
        if (!current || current.revision !== entry.record.revision)
          throw new PracticeError('CONFLICT', '记录已修改，无法撤销原操作。');
        db.records = db.records.filter((r) => r.id !== current.id);
      } else {
        if (current) throw new PracticeError('CONFLICT', '记录已存在。');
        db.records.push(entry.record);
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
  const db = await service().snapshot();
  if (service().repository.recoveryRequired) {
    const answer = await wx.showModal({
      title: '发现可读的本地副本',
      content:
        '一份存储清单校验失败。当前读取较早的可用副本，可能不含最近修改。是否使用该副本继续？',
      confirmText: '使用副本',
      cancelText: '暂不写入',
    });
    if (answer.confirm) service().repository.acknowledgeRecovery();
  }
  return db;
}
