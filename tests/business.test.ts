import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialForm,
  makeProject,
  metricOrder,
  parseTime,
  timeText,
  amountText,
  dateKey,
  moveDay,
  emptyDatabase,
  type RecordInput,
} from '../miniprogram/domain/model';
import { statistics } from '../miniprogram/domain/statistics';
import {
  LocalRepository,
  byteLength,
  type FileDriver,
} from '../miniprogram/infrastructure/repository';
import { PracticeService } from '../miniprogram/application/service';

/** Deterministic disk with before/after-write failures models lost callbacks and cold restarts. */
class MemoryFiles implements FileDriver {
  data = new Map<string, string>();
  count = 0;
  failAt = -1;
  after = false;
  truncate = false;
  async read(path: string) {
    return this.data.get(path) ?? null;
  }
  async write(path: string, text: string) {
    const fail = ++this.count === this.failAt;
    if (fail && !this.after) throw new Error('disk unavailable');
    this.data.set(path, fail && this.truncate ? text.slice(0, 20) : text);
    if (fail) throw new Error('callback lost');
  }
  async list(path: string) {
    return [
      ...new Set(
        [...this.data.keys()]
          .filter((p) => p.startsWith(path + '/'))
          .map((p) => p.slice(path.length + 1).split('/')[0]),
      ),
    ];
  }
  async remove(path: string) {
    this.data.delete(path);
  }
  copy() {
    const copy = new MemoryFiles();
    copy.data = new Map(this.data);
    return copy;
  }
}
const now = new Date(2026, 10, 24, 12).getTime();
async function setup() {
  const files = new MemoryFiles(),
    repo = new LocalRepository(files),
    api = new PracticeService(repo, () => now);
  const form = { ...initialForm(), id: 'p_test', name: '跳绳', quantityEnabled: true };
  const project = await api.saveProject(form);
  return { files, repo, api, form, project };
}
const input = (id = 'r_1'): RecordInput => ({
  id,
  projectId: 'p_test',
  occurredOn: '2026-11-24',
  localTime: '',
  durationSeconds: 3600,
  quantity: 50,
  note: '',
});

test('默认配置、整数中点与主要指标顺序', () => {
  const f = initialForm();
  assert.equal(f.defaultQuantity, '50');
  assert.equal(f.defaultTime, '60');
  const p = makeProject(
    { ...f, name: '练习', quantityEnabled: true, primaryMetric: 'quantity' },
    now,
  );
  assert.deepEqual(metricOrder(p), ['quantity', 'durationSeconds']);
  assert.throws(() => makeProject({ ...f, name: '', quantityEnabled: false }, now));
  assert.throws(() => makeProject({ ...f, name: '练习', timeEnabled: false }, now));
  assert.throws(() => makeProject({ ...f, name: '练习', defaultTime: '121' }, now));
});
test('时间只接收精确整秒，小数格式化不破坏数值', () => {
  assert.equal(parseTime('1.5', '分'), 90);
  assert.equal(parseTime('0.5', '时'), 1800);
  assert.throws(() => parseTime('0.1', '秒'));
  assert.throws(() => parseTime('1e3', '分'));
  assert.equal(timeText(1, '分'), '≈0.0167分');
  assert.equal(amountText(12345.6789), '12,345.6789');
  assert.equal(byteLength('愚公😀'), 10);
});
test('稳定ID重试只产生一条记录，配置不同不能复用同一ID', async () => {
  const { api, form } = await setup();
  await api.saveProject(form);
  await assert.rejects(api.saveProject({ ...form, defaultTime: '61' }), /已存在/);
  await api.saveRecord(input());
  await api.saveRecord(input());
  assert.equal((await api.snapshot()).records.length, 1);
  await assert.rejects(api.saveRecord({ ...input(), quantity: 51 }), /内容不同/);
});
test('并发提交串行累加；同日相同值的独立记录均保留', async () => {
  const { api } = await setup();
  await Promise.all(Array.from({ length: 8 }, (_, i) => api.saveRecord(input('r_' + i))));
  const rows = (await api.snapshot()).records;
  assert.equal(rows.length, 8);
  assert.equal(statistics(rows, 'quantity', 'all', 0, '2026-11-24').added, 400);
});
test('记录不能跨项目编辑，过期revision不能覆盖', async () => {
  const { api, form } = await setup();
  const r = await api.saveRecord(input());
  await api.saveProject({ ...form, id: 'p_other', name: '其他' });
  await assert.rejects(
    api.saveRecord({ ...input(), projectId: 'p_other' }, r.revision),
    /所属项目/,
  );
  await api.saveRecord({ ...input(), note: '新备注' }, r.revision);
  await assert.rejects(api.saveRecord(input(), r.revision), /已被修改/);
});
test('数量单位首次记录后永久锁定，删除或撤销均不解锁', async () => {
  const { api, form } = await setup();
  await api.saveRecord(input());
  await api.undo();
  const db = await api.snapshot();
  assert.equal(db.records.length, 0);
  assert.equal(db.projects[0].quantityUnitLocked, true);
  await assert.rejects(
    api.saveProject({ ...form, quantityUnit: '页' }, db.projects[0].revision),
    /已固定/,
  );
});
test('范围缩小、关闭指标不改历史；历史空项编辑不补默认', async () => {
  const { api, form } = await setup();
  const r = await api.saveRecord(input());
  await api.saveProject({ ...form, timeMax: '10', defaultTime: '5', quantityEnabled: false }, 1);
  await api.saveRecord({ ...input(), note: '保留旧值' }, r.revision);
  await assert.rejects(api.saveRecord({ ...input(), quantity: 60 }, 2), /指标已关闭/);
  const r2 = await api.saveRecord({ ...input('r_2'), durationSeconds: 300, quantity: null });
  await api.saveProject({ ...form, timeMax: '10', defaultTime: '5' }, 2);
  await api.saveRecord({ ...r2, note: '只修改备注' }, r2.revision);
  assert.equal((await api.snapshot()).records[1].quantity, null);
});
test('非法日期、未来日期、空项、0与数量小数被拒绝', async () => {
  const { api } = await setup();
  for (const change of [
    { occurredOn: '2026-02-30' },
    { occurredOn: '2026-11-25' },
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: null },
    { localTime: '24:00' },
    { note: '字'.repeat(501) },
  ]) {
    await assert.rejects(api.saveRecord({ ...input(), ...change }));
  }
});
test('补记、编辑、删除和撤销后累计含正确历史基数', async () => {
  const { api } = await setup();
  const old = await api.saveRecord({ ...input(), occurredOn: '2026-10-31' });
  await api.saveRecord(input('r_2'));
  let chart = statistics((await api.snapshot()).records, 'quantity', 'month', 0, '2026-11-24');
  assert.equal(chart.baseline, 50);
  assert.equal(chart.points.at(-1)?.cumulative, 100);
  assert.equal(chart.points.length, 24);
  await api.saveRecord({ ...old, quantity: 60 }, old.revision);
  chart = statistics((await api.snapshot()).records, 'quantity', 'month', 0, '2026-11-24');
  assert.equal(chart.baseline, 60);
  await api.deleteRecord(old.id, 2);
  assert.equal(
    statistics((await api.snapshot()).records, 'quantity', 'all', 0, '2026-11-24').added,
    50,
  );
  await api.undo();
  assert.equal(
    statistics((await api.snapshot()).records, 'quantity', 'all', 0, '2026-11-24').added,
    110,
  );
});
test('本地日历、闰日、周一、跨年以及未填写具体时刻', async () => {
  assert.equal(moveDay('2024-02-28', 1), '2024-02-29');
  assert.equal(moveDay('2024-02-29', 1), '2024-03-01');
  assert.equal(dateKey(new Date(2026, 0, 1, 0, 1)), '2026-01-01');
  const week = statistics([], 'quantity', 'week', 0, '2026-01-01');
  assert.equal(week.start, '2025-12-29');
  assert.equal(week.end, '2026-01-01');
  const feb = statistics([], 'quantity', 'month', -1, '2024-03-03');
  assert.equal(feb.points.length, 29);
  const { api } = await setup();
  await api.saveRecord(input());
  assert.equal((await api.snapshot()).records[0].localTime, '');
});
test('新增草稿保留非法原始输入且不创建项目，冷启动可恢复', async () => {
  const { api, files, form } = await setup();
  await api.saveDraft({
    ...form,
    id: 'p_draft',
    name: '未写完',
    timeMin: '',
    timeEnabled: false,
    quantityEnabled: false,
  });
  const db = await new LocalRepository(files).snapshot();
  assert.equal(db.projects.length, 1);
  assert.equal(db.records.length, 0);
  assert.equal(db.newProjectDraft?.timeMin, '');
});
test('撤销使用绝对期限，退后台不延长', async () => {
  const { repo, api } = await setup();
  await api.saveRecord(input());
  await assert.rejects(new PracticeService(repo, () => now + 5001).undo(), /超过/);
  assert.equal((await repo.snapshot()).records.length, 1);
});
test('每个写入点故障后冷启动只出现完整旧版或完整新版，可幂等重试', async () => {
  const base = await setup();
  const probe = base.files.copy();
  const api = new PracticeService(new LocalRepository(probe), () => now);
  await api.saveRecord(input());
  const writes = probe.count;
  assert.ok(writes >= 3);
  for (let step = 1; step <= writes; step++)
    for (const after of [false, true]) {
      const files = base.files.copy();
      files.failAt = step;
      files.after = after;
      const command = new PracticeService(new LocalRepository(files), () => now);
      await assert.rejects(command.saveRecord(input()));
      files.failAt = -1;
      const reopened = new LocalRepository(files);
      const db = await reopened.snapshot();
      assert.ok(db.records.length === 0 || db.records.length === 1);
      if (reopened.recoveryRequired) reopened.acknowledgeRecovery();
      const retry = new PracticeService(reopened, () => now);
      await retry.saveRecord(input());
      assert.equal((await retry.snapshot()).records.length, 1);
    }
});
test('清单半写回落要确认，两个副本损坏不清空，未知版本拒绝降级', async () => {
  const { api, files } = await setup();
  await api.saveRecord(input());
  files.data.set('manifest-b.json', 'broken');
  const repo = new LocalRepository(files);
  assert.equal((await repo.snapshot()).records.length, 0);
  assert.equal(repo.recoveryRequired, true);
  await assert.rejects(
    repo.transaction(() => {}),
    /确认恢复/,
  );
  files.data.set('manifest-a.json', 'broken');
  await assert.rejects(new LocalRepository(files).snapshot(), /校验失败/);
  const other = await setup();
  const path = 'manifest-a.json';
  const entry = JSON.parse(other.files.data.get(path)!);
  const payload = JSON.parse(entry.payload);
  payload.schemaVersion = 2;
  entry.payload = JSON.stringify(payload);
  let hash = 2166136261;
  for (let i = 0; i < entry.payload.length; i++)
    hash = Math.imul(hash ^ entry.payload.charCodeAt(i), 16777619);
  entry.checksum = (hash >>> 0).toString(16);
  entry.bytes = byteLength(entry.payload);
  other.files.data.set(path, JSON.stringify(entry));
  await assert.rejects(new LocalRepository(other.files).snapshot(), /不同版本/);
});
test('删除标记优先于旧清单，迟到创建/记录不能复活，删除后续写正常', async () => {
  const { api, repo, files, form } = await setup();
  await api.saveRecord(input());
  files.failAt = files.count + 2;
  files.after = true;
  await repo.deleteProject('p_test');
  files.failAt = -1;
  assert.equal((await repo.snapshot()).projects.length, 0);
  await assert.rejects(api.saveProject(form), /不能重新使用/);
  await assert.rejects(api.saveRecord(input()), /不存在/);
  await api.saveProject({ ...form, id: 'p_new', name: '新项目' });
  const db = await new LocalRepository(files).snapshot();
  assert.deepEqual(
    db.projects.map((p) => p.id),
    ['p_new'],
  );
  assert.equal(db.records.length, 0);
});
test('软容量不足拒绝新写入并保留已提交数据', async () => {
  const { files } = await setup();
  const repo = new LocalRepository(files, 10);
  await assert.rejects(
    repo.transaction((db) => {
      db.newProjectDraft = initialForm();
    }),
    /容量上限/,
  );
  assert.equal((await new LocalRepository(files).snapshot()).projects.length, 1);
});
test('空库只读不产生文件', async () => {
  const files = new MemoryFiles();
  assert.deepEqual(await new LocalRepository(files).snapshot(), emptyDatabase());
  assert.equal(files.data.size, 0);
});

// Recovery consent must lead to a writable store; it must not get trapped behind GC's corruption guard.
test('确认可读副本后能够修复损坏清单并继续记录', async () => {
  const { api, files } = await setup();
  await api.saveRecord(input());
  files.data.set('manifest-b.json', 'partial');
  const repo = new LocalRepository(files);
  await repo.snapshot();
  repo.acknowledgeRecovery();
  const recovered = new PracticeService(repo, () => now);
  await recovered.saveRecord(input('r_recovered'));
  const cold = await new LocalRepository(files).snapshot();
  assert.equal(cold.records.length, 1);
  assert.equal(cold.records[0].id, 'r_recovered');
});

test('暂时读取失败后可重试，不缓存失败的初始化Promise', async () => {
  const { files } = await setup();
  const read = files.read.bind(files);
  let failed = false;
  files.read = async (path) => {
    if (!failed) {
      failed = true;
      throw new Error('temporary read failure');
    }
    return read(path);
  };
  const repo = new LocalRepository(files);
  await assert.rejects(repo.snapshot());
  assert.equal((await repo.snapshot()).projects.length, 1);
});
test('长中文备注按UTF-8拆页，冷启动还原全部2500条，页大小留有封装余量', async () => {
  const { repo, files } = await setup();
  await repo.transaction((db) => {
    db.projects[0].quantityUnitLocked = true;
    for (let i = 0; i < 2500; i++)
      db.records.push({
        ...input('bulk_' + i),
        quantityUnit: '次',
        note: '字'.repeat(500),
        createdAt: now,
        updatedAt: now,
        revision: 1,
      });
  });
  const pages = [...files.data].filter(([path]) => path.startsWith('objects/records/'));
  assert.ok(pages.length > 10);
  assert.ok(pages.every(([, text]) => byteLength(text) < 128 * 1024));
  assert.equal((await new LocalRepository(files).snapshot()).records.length, 2500);
});
