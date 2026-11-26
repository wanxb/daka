// The coordinator alone owns write ordering, recovery consent and atomic manifest publication.
import {
  emptyDatabase,
  readFrequency,
  requireId,
  PracticeError,
  type Database,
} from '../domain/model';
import { byteLength, checksum, decode, encode, type Reference, type Manifest } from './file-codec';
import { assertDatabase } from './database-validation';
// Retain the public byte counter for existing tooling without duplicating the storage encoding policy.
export { byteLength } from './file-codec';
/** Drivers expose only relative paths inside this application's user-data root. Missing files return null. */
export interface FileDriver {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  list(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
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
  /** The first committed manifest is the durable initialization receipt, including after all cards are deleted.
   * Existing manifests, drafts and deletion markers belong to returning users; never seed over them.
   */
  async initializeNewUser(create: () => Pick<Database, 'projects' | 'records'>): Promise<void> {
    const operation = this.queue.then(async () => {
      await this.ready();
      if (this.generation > 0 || this.tombstones.size > 0) return;
      const next = { ...clone(this.state!), ...create() };
      assertDatabase(next);
      try {
        // Publish the projects, all records and the receipt together; orphan pages never count as success.
        await this.commit(next);
      } catch (error) {
        // Lost callbacks may follow a durable manifest. Reload before retrying to avoid duplicate fixtures.
        this.state = null;
        this.loading = null;
        throw error instanceof PracticeError
          ? error
          : new PracticeError('IO', '尚未确认是否保存成功，请保留当前输入并重试。');
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
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
        throw new PracticeError(
          'CORRUPT',
          '无法确认项目的删除状态，请勿清除小程序数据，稍后重试。',
        );
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
        // Upgrade missing additive fields in memory only; normal transactions publish them with existing atomicity.
        for (const project of db.projects) project.frequency = readFrequency(project.frequency);
        if (db.newProjectDraft)
          db.newProjectDraft.frequency = readFrequency(db.newProjectDraft.frequency);
        assertDatabase(db);
        candidates.push({ manifest, db });
      } catch (error) {
        if (error instanceof PracticeError && error.code === 'VERSION') throw error;
        invalid++;
      }
    }
    if (!candidates.length && invalid)
      throw new PracticeError('CORRUPT', '本地数据检查未通过，已暂停保存以保护现有记录。');
    candidates.sort((a, b) => b.manifest.generation - a.manifest.generation);
    this.state = candidates[0]?.db || emptyDatabase();
    this.generation = candidates[0]?.manifest.generation || 0;
    this.recoveryRequired = invalid > 0;
  }
  async transaction<T>(change: (db: Database) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      await this.ready();
      if (this.recoveryRequired)
        throw new PracticeError('RECOVERY', '检测到本地数据异常，请先处理数据恢复提示。');
      const next = clone(this.state!),
        result = change(next);
      if (next.projects.some((p) => this.tombstones.has(p.id)))
        throw new PracticeError('MISSING', '此项目已删除，请返回首页。');
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
          : new PracticeError('IO', '尚未确认是否保存成功，请保留当前输入并重试。');
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async deleteProject(id: string): Promise<void> {
    requireId(id);
    const operation = this.queue.then(async () => {
      await this.ready();
      if (this.recoveryRequired) throw new PracticeError('RECOVERY', '请先处理本地数据恢复提示。');
      if (!this.state!.projects.some((p) => p.id === id))
        throw new PracticeError('MISSING', '此项目已不存在，请返回首页。');
      const marker = encode({ id }),
        path = `deleted-projects/${id}.json`;
      try {
        await this.files.write(path, marker);
        if ((await this.files.read(path)) !== marker) throw new Error('marker readback');
      } catch {
        // A durable deletion marker overrides any stale in-memory project, even after an uncertain callback.
        this.state = null;
        this.loading = null;
        throw new PracticeError('IO', '尚未确认是否删除成功，请重新查看项目。');
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
        throw new PracticeError('SPACE', '本地数据接近存储上限，已暂停保存。请勿清除小程序数据。');
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
