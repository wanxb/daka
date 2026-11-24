import {
  emptyDatabase,
  makeProject,
  positive,
  projectForm,
  requireId,
  total,
  validDate,
  PracticeError,
  type Database,
} from '../domain/model';
/** Drivers expose only relative paths inside this application's user-data root. Missing files return null. */
export interface FileDriver {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  list(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}
interface Reference {
  path: string;
  kind: 'projects' | 'records';
}
interface Manifest {
  schemaVersion: 1;
  generation: number;
  refs: Reference[];
  newProjectDraft: Database['newProjectDraft'];
  undo: Database['undo'];
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function byteLength(text: string): number {
  let length = 0;
  for (const char of text) {
    const n = char.codePointAt(0)!;
    length += n <= 0x7f ? 1 : n <= 0x7ff ? 2 : n <= 0xffff ? 3 : 4;
  }
  return length;
}
// This checksum detects accidental truncation/corruption; it is deliberately not an authentication scheme.
function checksum(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function encode(data: unknown): string {
  const payload = JSON.stringify(data);
  return JSON.stringify({ bytes: byteLength(payload), checksum: checksum(payload), payload });
}
function decode<T>(text: string): T {
  const entry = JSON.parse(text);
  if (
    typeof entry.payload !== 'string' ||
    entry.bytes !== byteLength(entry.payload) ||
    entry.checksum !== checksum(entry.payload)
  )
    throw new Error('checksum');
  return JSON.parse(entry.payload) as T;
}
function assertDatabase(db: Database): void {
  if (db.newProjectDraft != null) {
    const draft = db.newProjectDraft;
    requireId(draft.id);
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
      Array.from(r.note).length > 500 ||
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
/** A serialized copy-on-write repository: only a verified manifest publishes newly written immutable pages. */
export class LocalRepository {
  private state: Database | null = null;
  private generation = 0;
  private loading: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private tombstones = new Set<string>();
  recoveryRequired = false;
  constructor(
    private files: FileDriver,
    private capacityBytes = 120 * 1024 * 1024,
  ) {}
  private async ready(): Promise<void> {
    if (!this.state) {
      this.loading ||= this.load().catch((error) => {
        this.loading = null;
        throw error;
      });
      await this.loading;
    }
  }
  async snapshot(): Promise<Database> {
    await this.ready();
    return clone(this.state!);
  }
  acknowledgeRecovery(): void {
    this.recoveryRequired = false;
  }
  private async load(): Promise<void> {
    this.tombstones = new Set();
    for (const name of await this.files.list('deleted-projects')) {
      if (!name.endsWith('.json')) continue;
      try {
        const marker = decode<{ id: string }>(
          (await this.files.read('deleted-projects/' + name)) || '',
        );
        requireId(marker.id);
        this.tombstones.add(marker.id);
      } catch {
        throw new PracticeError('CORRUPT', '项目删除标记无法读取，请保留本地数据后重试。');
      }
    }
    const candidates: { manifest: Manifest; db: Database }[] = [];
    let invalid = 0;
    for (const slot of ['a', 'b']) {
      const text = await this.files.read(`manifest-${slot}.json`);
      if (text == null) continue;
      try {
        const manifest = decode<Manifest>(text);
        if (manifest.schemaVersion !== 1)
          throw new PracticeError('VERSION', '本地数据来自不同版本，请更新小程序后再试。');
        if (
          !Number.isSafeInteger(manifest.generation) ||
          manifest.generation < 1 ||
          !Array.isArray(manifest.refs)
        )
          throw new Error('manifest');
        const db = emptyDatabase();
        db.newProjectDraft = manifest.newProjectDraft;
        db.undo = manifest.undo;
        for (const ref of manifest.refs) {
          if (
            !/^objects\/(projects|records)\/[A-Za-z0-9_./-]+\.json$/.test(ref.path) ||
            ref.path.includes('..') ||
            !['projects', 'records'].includes(ref.kind)
          )
            throw new Error('reference');
          const content = await this.files.read(ref.path);
          if (content == null) throw new Error('missing page');
          const items = decode<unknown[]>(content);
          if (!Array.isArray(items)) throw new Error('page');
          if (ref.kind === 'projects') db.projects.push(...(items as Database['projects']));
          else db.records.push(...(items as Database['records']));
        }
        // Tombstones override both generations, so fallback to an older manifest cannot resurrect a project.
        db.projects = db.projects.filter((p) => !this.tombstones.has(p.id));
        db.records = db.records.filter((r) => !this.tombstones.has(r.projectId));
        if (db.undo && this.tombstones.has(db.undo.record.projectId)) db.undo = null;
        assertDatabase(db);
        candidates.push({ manifest, db });
      } catch (error) {
        if (error instanceof PracticeError && error.code === 'VERSION') throw error;
        invalid++;
      }
    }
    if (!candidates.length && invalid)
      throw new PracticeError('CORRUPT', '本地数据校验失败，已停止写入以保护现有记录。');
    candidates.sort((a, b) => b.manifest.generation - a.manifest.generation);
    this.state = candidates[0]?.db || emptyDatabase();
    this.generation = candidates[0]?.manifest.generation || 0;
    this.recoveryRequired = invalid > 0;
  }
  async transaction<T>(change: (db: Database) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      await this.ready();
      if (this.recoveryRequired)
        throw new PracticeError('RECOVERY', '检测到损坏的存储副本，请先确认恢复提示。');
      const next = clone(this.state!),
        result = change(next);
      if (next.projects.some((p) => this.tombstones.has(p.id)))
        throw new PracticeError('MISSING', '已删除项目不能重新使用。');
      assertDatabase(next);
      try {
        await this.commit(next);
        return result === undefined ? result : clone(result);
      } catch (error) {
        // A callback can fail after bytes reached disk. Reload before retrying the same stable command ID.
        this.state = null;
        this.loading = null;
        throw error instanceof PracticeError
          ? error
          : new PracticeError('IO', '本地保存未确认，请保留当前输入并重试。');
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async deleteProject(id: string): Promise<void> {
    requireId(id);
    const operation = this.queue.then(async () => {
      await this.ready();
      if (this.recoveryRequired) throw new PracticeError('RECOVERY', '请先确认本地数据恢复提示。');
      if (!this.state!.projects.some((p) => p.id === id))
        throw new PracticeError('MISSING', '项目已经不存在。');
      const marker = encode({ id }),
        path = `deleted-projects/${id}.json`;
      try {
        await this.files.write(path, marker);
        if ((await this.files.read(path)) !== marker) throw new Error('marker readback');
      } catch {
        // A durable deletion marker overrides any stale in-memory project, even after an uncertain callback.
        this.state = null;
        this.loading = null;
        throw new PracticeError('IO', '删除尚未确认，请重新查看项目。');
      }
      this.tombstones.add(id);
      const next = clone(this.state!);
      next.projects = next.projects.filter((p) => p.id !== id);
      next.records = next.records.filter((r) => r.projectId !== id);
      if (next.undo?.record.projectId === id) next.undo = null;
      // Once the durable marker is confirmed deletion has taken effect, even if manifest cleanup is interrupted.
      try {
        await this.commit(next);
      } catch {
        this.state = null;
        this.loading = null;
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  private async commit(db: Database): Promise<void> {
    const generation = this.generation + 1,
      refs: Reference[] = [];
    let suffix = 0;
    let used = await this.collectOrphans();
    const reserve = (text: string) => {
      used += byteLength(text);
      if (used > this.capacityBytes)
        throw new PracticeError('SPACE', '本地空间接近容量上限，请保留现有记录后重试。');
    };
    const page = async (prefix: string, kind: Reference['kind'], data: unknown) => {
      const content = encode(data),
        hash = checksum(content);
      let path = `${prefix}/${hash}.json`,
        before = await this.files.read(path);
      // A hash collision must never overwrite an immutable page referenced by either valid generation.
      if (before != null && before !== content) {
        path = `${prefix}/${hash}-${generation}-${++suffix}.json`;
        before = await this.files.read(path);
      }
      if (before !== content) {
        reserve(content);
        await this.files.write(path, content);
        if ((await this.files.read(path)) !== content) throw new Error('page readback');
      }
      refs.push({ path, kind });
    };
    await page('objects/projects', 'projects', db.projects);
    const buckets = new Map<string, Database['records']>();
    for (const record of db.records) {
      const bucket = `${record.projectId}/${record.occurredOn.slice(0, 7)}`;
      const rows = buckets.get(bucket) || [];
      rows.push(record);
      buckets.set(bucket, rows);
    }
    for (const [bucket, rows] of buckets) {
      let chunk: Database['records'] = [],
        bytes = 2;
      for (const record of rows) {
        const size = byteLength(JSON.stringify(record)) + 1;
        if (bytes + size > 120 * 1024 && chunk.length) {
          await page('objects/records/' + bucket, 'records', chunk);
          chunk = [];
          bytes = 2;
        }
        chunk.push(record);
        bytes += size;
      }
      if (chunk.length) await page('objects/records/' + bucket, 'records', chunk);
    }
    const manifest: Manifest = {
      schemaVersion: 1,
      generation,
      refs,
      newProjectDraft: db.newProjectDraft,
      undo: db.undo,
    };
    const content = encode(manifest),
      path = `manifest-${generation % 2 ? 'a' : 'b'}.json`;
    reserve(content);
    await this.files.write(path, content);
    if ((await this.files.read(path)) !== content) throw new Error('manifest readback');
    this.state = db;
    this.generation = generation;
  }
  private async collectOrphans(): Promise<number> {
    const keep = new Set<string>();
    let used = 0,
      uncertain = false;
    for (const slot of ['a', 'b']) {
      const text = await this.files.read(`manifest-${slot}.json`);
      if (!text) continue;
      used += byteLength(text);
      try {
        decode<Manifest>(text).refs.forEach((ref) => keep.add(ref.path));
      } catch {
        uncertain = true;
      }
    }
    // Recovery consent permits replacing the broken slot, but never permits GC based on unreadable references.
    const walk = async (directory: string): Promise<void> => {
      for (const name of await this.files.list(directory)) {
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '..' || name === '.') continue;
        const path = directory + '/' + name;
        if (!name.endsWith('.json')) {
          await walk(path);
          continue;
        }
        if (!uncertain && !keep.has(path)) {
          try {
            await this.files.remove(path);
            continue;
          } catch {
            /* Failed cleanup consumes capacity but never invalidates committed history. */
          }
        }
        const content = await this.files.read(path);
        if (content) used += byteLength(content);
      }
    };
    await walk('objects');
    for (const name of await this.files.list('deleted-projects')) {
      const text = await this.files.read('deleted-projects/' + name);
      if (text) used += byteLength(text);
    }
    return used;
  }
}
