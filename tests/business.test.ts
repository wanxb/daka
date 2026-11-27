// Copy expectations track user-facing wording; persistence, conflict and recovery assertions remain unchanged.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialForm,
  makeProject,
  metricOrder,
  parseTime,
  timeText,
  timeParts,
  amountText,
  dateKey,
  moveDay,
  emptyDatabase,
  projectForm,
  canQuickRecord,
  type RecordInput,
} from '../miniprogram/domain/model';
import { statistics } from '../miniprogram/domain/statistics';
import {
  LocalRepository,
  byteLength,
  type FileDriver,
} from '../miniprogram/infrastructure/repository';
import { PracticeService } from '../miniprogram/application/service';
import { quantityUnits } from '../miniprogram/domain/input-limits';
import { projectFocusTarget } from '../miniprogram/application/project-form';
import { initialData } from '../miniprogram/application/initial-data';
import { projectTile } from '../miniprogram/application/presentation';
import { type Color, colorOptions, projectIcons } from '../miniprogram/domain/appearance';
import {
  inputLimits,
  limitText,
  limitNote,
  textLength,
  numericDraft,
  acceptNumericDraft,
} from '../miniprogram/domain/input-limits';

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
/** Initial records use calendar days rather than elapsed milliseconds and feed the ordinary aggregation pipeline. */
test('首次卡片覆盖含当天的七天窗口，三种指标、首页与统计使用一致原始记录', () => {
  for (const today of ['2027-01-03', '2028-03-01', '2026-11-26']) {
    const timestamp = new Date(today + 'T00:01:00').getTime();
    const { projects, records } = initialData(timestamp);
    assert.deepEqual(
      projects.map((p) => p.name),
      ['阅读', '跳绳', '运动'],
    );
    assert.deepEqual(
      projects.map((p) => p.mode),
      ['both', 'quantity', 'duration'],
    );
    assert.deepEqual(
      projects.map((p) => p.quantityUnitLocked),
      [true, true, false],
    );
    assert.equal(records.length, 18);
    for (const project of projects) {
      assert.equal(project.frequency, 'day');
      assert.equal(project.directEntryEnabled, false);
      const rows = records.filter((r) => r.projectId === project.id);
      assert.equal(rows.length, 6);
      assert.equal(rows[0].occurredOn, moveDay(today, -6));
      assert.equal(rows.at(-1)!.occurredOn, today);
      assert.ok(
        rows.every((r) => r.occurredOn <= today && r.createdAt === timestamp && !r.localTime),
      );
      const tile = projectTile(project, rows, today);
      assert.equal(
        tile.number,
        project.name === '阅读' ? '25' : project.name === '跳绳' ? '1,000' : '30',
      );
      const metrics = metricOrder(project).filter((metric) => rows.some((r) => r[metric] != null));
      for (const metric of metrics) {
        const expected = rows.reduce((sum, r) => sum + (r[metric] ?? 0), 0);
        const stats = statistics(rows, metric, 'all', 0, today);
        assert.equal(stats.added, expected);
        assert.equal(stats.points.at(-1)!.cumulative, expected);
      }
    }
  }
});

/** A committed manifest, including an empty old store, protects user choices across refreshes and upgrades. */
test('首次初始化并发只写一次，冷启动及跨日不补记录，删光后仍不重建', async () => {
  const files = new MemoryFiles();
  const api = new PracticeService(new LocalRepository(files), () => now);
  await Promise.all([api.initialize(), api.initialize(), api.initialize()]);
  const first = await api.snapshot();
  const writes = files.count;
  const cold = new PracticeService(new LocalRepository(files), () => now + 86400000);
  await cold.initialize();
  assert.deepEqual(await cold.snapshot(), first);
  assert.equal(files.count, writes);
  for (const project of first.projects) await cold.repository.deleteProject(project.id);
  const deleted = new PracticeService(new LocalRepository(files), () => now);
  await deleted.initialize();
  assert.equal((await deleted.snapshot()).projects.length, 0);
  assert.equal((await deleted.snapshot()).records.length, 0);
  // Even if manifests are lost, confirmed deletion markers must never resurrect the example cards.
  files.data.delete('manifest-a.json');
  files.data.delete('manifest-b.json');
  const markerOnly = new PracticeService(new LocalRepository(files), () => now);
  await markerOnly.initialize();
  assert.equal((await markerOnly.snapshot()).projects.length, 0);
});

test('已有项目、仅草稿和已提交空库存档均不追加初始数据，损坏库不当成新用户', async () => {
  for (const kind of ['project', 'draft', 'empty']) {
    const files = new MemoryFiles();
    const api = new PracticeService(new LocalRepository(files), () => now);
    if (kind === 'project') await api.saveProject({ ...initialForm(), name: '自己的' });
    else if (kind === 'draft') await api.saveDraft({ ...initialForm(), name: '草稿' });
    else await api.repository.transaction(() => undefined);
    const before = await api.snapshot();
    const writes = files.count;
    const cold = new PracticeService(new LocalRepository(files), () => now);
    await cold.initialize();
    assert.deepEqual(await cold.snapshot(), before);
    assert.equal(files.count, writes);
  }
  const files = new MemoryFiles();
  files.data.set('manifest-a.json', 'broken');
  const api = new PracticeService(new LocalRepository(files), () => now);
  await assert.rejects(api.initialize(), /本地数据检查未通过/);
  assert.equal(files.count, 0);
});

/** Fail every physical write, including callbacks lost after publication, to prove atomicity and retry safety. */
test('初始化各阶段写入失败不暴露半套数据，重试与冷启动不重复生成', async () => {
  const timestamp = new Date(2027, 0, 3, 12).getTime();
  const baseline = new MemoryFiles();
  await new PracticeService(new LocalRepository(baseline), () => timestamp).initialize();
  for (const after of [false, true]) {
    for (let failAt = 1; failAt <= baseline.count; failAt++) {
      const files = new MemoryFiles();
      files.failAt = failAt;
      files.after = after;
      const api = new PracticeService(new LocalRepository(files), () => timestamp);
      await assert.rejects(api.initialize(), /尚未确认是否保存成功/);
      const snapshot = await new LocalRepository(files).snapshot();
      assert.ok(snapshot.projects.length === 0 || snapshot.projects.length === 3);
      assert.equal(snapshot.records.length, snapshot.projects.length ? 18 : 0);
      files.failAt = -1;
      await api.initialize();
      const cold = new PracticeService(new LocalRepository(files), () => timestamp);
      await cold.initialize();
      const result = await cold.snapshot();
      assert.equal(result.projects.length, 3);
      assert.equal(result.records.length, 18);
      assert.equal(new Set(result.records.map((r) => r.id)).size, 18);
    }
  }
});
/** New presets must survive repository validation and a cold read, while all five legacy appearance IDs stay valid. */
test('扩展外观创建、编辑、草稿和冷启动读回保持一致', async () => {
  const files = new MemoryFiles();
  let api = new PracticeService(new LocalRepository(files), () => now);
  for (const [i, icon] of projectIcons.entries()) {
    const color = colorOptions[i % colorOptions.length].id as Color;
    await api.saveProject({ ...initialForm(), name: '练习', color, icon: icon.id });
  }
  const draft = { ...initialForm(), name: '', color: 'brown' as const, icon: 'art' };
  await api.saveDraft(draft);
  api = new PracticeService(new LocalRepository(files), () => now);
  const snapshot = await api.snapshot();
  assert.equal(snapshot.projects.length, 15);
  assert.deepEqual(snapshot.newProjectDraft, draft);
  assert.deepEqual(
    snapshot.projects.map((p) => p.icon),
    projectIcons.map((item) => item.id),
  );
  const first = snapshot.projects[0];
  await api.saveProject({ ...projectForm(first), color: 'indigo', icon: 'swim' }, first.revision);
  const restored = await new PracticeService(new LocalRepository(files), () => now).snapshot();
  assert.equal(restored.projects[0].color, 'indigo');
  assert.equal(restored.projects[0].icon, 'swim');
});
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

// A durable manifest followed by a lost callback must confirm only the same operation, never another stale editor.
test('编辑回调丢失后操作凭据可冷启动确认，异内容和后续修改仍冲突', async () => {
  for (const target of ['record', 'project'] as const) {
    const { files, api, form, project } = await setup();
    const old = await api.saveRecord(input());
    const request =
      target === 'record' ? { ...input(), note: '修改后' } : { ...form, name: '修改后' };
    const revision = target === 'record' ? old.revision : project.revision;
    const submit = (service: PracticeService, payload = request, token = 'op_retry') =>
      target === 'record'
        ? service.saveRecord(payload as RecordInput, revision, undefined, token)
        : service.saveProject(payload as typeof form, revision, token);
    const write = files.write.bind(files);
    files.write = async (path, text) => {
      await write(path, text);
      if (path.startsWith('manifest-')) throw new Error('lost manifest callback');
    };
    await assert.rejects(submit(api), /重试/);
    files.write = write;
    const cold = new PracticeService(new LocalRepository(files), () => now);
    const confirmed = await submit(cold);
    assert.equal(confirmed.revision, revision + 1);
    await assert.rejects(submit(cold, request, 'op_other'), /更新|更改/);
    const changed =
      target === 'record' ? { ...request, note: '另一个值' } : { ...request, name: '另一个值' };
    await assert.rejects(submit(cold, changed), /冲突|更改|更新|重试/);
    if (target === 'record')
      await cold.saveRecord({ ...input(), note: '后续修改' }, confirmed.revision);
    else await cold.saveProject({ ...form, name: '后续修改' }, confirmed.revision);
    await assert.rejects(submit(cold), /更新|更改/);
  }
});

// Creation capacity is enforced inside the serialized command, including races and returning users with older large stores.
// Mutating the caller's raw draft while a command waits in the repository queue must not forge its saved receipt.
test('排队期间修改调用方对象不改变已提交内容和操作凭据', async () => {
  const { api, form } = await setup();
  const candidate = { ...form, id: 'p_queued', name: '提交名称' };
  const pendingProject = api.saveProject(candidate, undefined, 'op_queued_project');
  candidate.name = '稍后修改';
  assert.equal((await pendingProject).name, '提交名称');
  const record = input();
  const pendingRecord = api.saveRecord(record, undefined, undefined, 'op_queued_record');
  record.note = '稍后修改';
  assert.equal((await pendingRecord).note, '');
  assert.equal((await api.saveRecord(input(), undefined, undefined, 'op_queued_record')).note, '');
});

test('新建回调丢失后重试清除同项目草稿，后续撤销不保留旧编辑凭据', async () => {
  const { api, files, form } = await setup();
  const draft = { ...form, id: 'p_retry_creation' };
  await api.saveDraft(draft);
  const write = files.write.bind(files);
  files.write = async (path, text) => {
    await write(path, text);
    if (path.startsWith('manifest-')) throw new Error('callback lost');
  };
  await assert.rejects(api.saveProject(draft, undefined, 'op_create'), /重试/);
  files.write = write;
  await api.saveDraft(draft);
  await api.saveProject(draft, undefined, 'op_create');
  assert.equal((await api.snapshot()).newProjectDraft, null);
  const old = await api.saveRecord(input(), undefined, undefined, 'op_record');
  await api.deleteRecord(old.id, old.revision);
  await api.undo();
  assert.equal((await api.snapshot()).records[0].lastCommand, undefined);
  assert.throws(
    () => api.saveRecord({ ...input(), quantity: NaN }, undefined, undefined, 'op_record'),
    /有效数值/,
  );
});

test('体验版15项目上限防并发绕过，重试和已有超额存档不受新建限制', async () => {
  const { api, repo, form } = await setup();
  for (let i = 1; i < 14; i++) await api.saveProject({ ...form, id: 'p_' + i });
  const results = await Promise.allSettled([
    api.saveProject({ ...form, id: 'p_last' }),
    api.saveProject({ ...form, id: 'p_over' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await api.snapshot()).projects.length, 15);
  const createdResult = results.find((r) => r.status === 'fulfilled');
  assert.ok(createdResult?.status === 'fulfilled');
  const created = createdResult.value;
  assert.equal((await api.saveProject({ ...form, id: created.id })).id, created.id);
  await repo.deleteProject(created.id);
  await api.saveProject({ ...form, id: 'p_replacement' });
  await repo.transaction((db) => {
    db.projects.push(makeProject({ ...form, id: 'p_legacy_extra' }, now));
  });
  const legacy = (await api.snapshot()).projects.at(-1)!;
  await api.saveProject({ ...projectForm(legacy), name: '旧项目' }, legacy.revision);
  await api.saveRecord({ ...input('r_legacy'), projectId: legacy.id });
  assert.equal((await api.snapshot()).projects.length, 16);
  await assert.rejects(api.saveProject({ ...form, id: 'p_reject' }), /15/);
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
  assert.equal(timeText(1, '分'), '≈0.0167分钟');
  assert.equal(amountText(12345.6789), '12,345.6789');
  assert.equal(byteLength('北极星打卡😀'), 19);
});

// Duration captions use full names, while count labels keep the chosen whitelisted measure.
test('完整时间单位与数值分离，数量单位保持原文', async () => {
  const { metricParts, projectTile } = await import('../miniprogram/application/presentation');
  const p = makeProject({ ...initialForm(), name: '阅读', quantityUnit: '页' }, now);
  assert.deepEqual(timeParts(5400, '分'), { number: '90', unit: '分钟' });
  assert.deepEqual(timeParts(82800, '时'), { number: '23', unit: '小时' });
  assert.equal(timeText(86400, '天'), '1天');
  assert.equal(timeText(1, '秒'), '1秒');
  assert.deepEqual(metricParts(p, 'quantity', 90), { number: '90', unit: '页' });
  const tile = projectTile(p, [], '2026-11-24');
  assert.equal(tile.unit, '分钟');
  assert.equal(tile.number, '0');
  assert.equal(p.timeUnit, '分');
});

/** The domain rejects unsupported measures even when callers bypass the editor's input and focus handling. */
test('常用数量单位名单可保存，空值、任意文字及缩写不能新增或修改保存', async () => {
  assert.equal(quantityUnits.length, 20);
  assert.equal(new Set(quantityUnits).size, 20);
  for (const quantityUnit of quantityUnits) {
    const form = { ...initialForm(), name: '练习', quantityEnabled: true, quantityUnit };
    assert.equal(makeProject(form, now).quantityUnit, quantityUnit);
  }
  const files = new MemoryFiles();
  const api = new PracticeService(new LocalRepository(files), () => now);
  const form = { ...initialForm(), name: '练习', quantityEnabled: true };
  for (const quantityUnit of ['', '随便', 'abc', '123', 'km', '分钟', '😀', '毫 升']) {
    await assert.rejects(api.saveProject({ ...form, quantityUnit }));
    assert.equal((await api.snapshot()).projects.length, 0);
    assert.equal(projectFocusTarget({ ...form, quantityUnit }), 'quantityUnit');
  }
  const project = await api.saveProject({ ...form, quantityUnit: ' 页 ' });
  assert.equal(project.quantityUnit, '页');
  await assert.rejects(
    api.saveProject({ ...projectForm(project), quantityUnit: '随便' }, project.revision),
  );
  assert.equal((await new LocalRepository(files).snapshot()).projects[0].quantityUnit, '页');
});

/** Whitelisted measures can change before recording, but persisted quantities lock their meaning permanently. */
test('数量单位无旧值豁免，首次记数前可改常用单位，记数后锁定且冷启动保留', async () => {
  const files = new MemoryFiles();
  const api = new PracticeService(new LocalRepository(files), () => now);
  const project = await api.saveProject({ ...initialForm(), name: '练习', quantityEnabled: true });
  // Supplying the same unsupported unit as an original must not bypass strict validation.
  const unsupported = { ...project, quantityUnit: '公里' };
  assert.throws(() => makeProject(projectForm(unsupported), now, unsupported), /常用数量单位/);
  const cold = new PracticeService(new LocalRepository(files), () => now);
  const existing = (await cold.snapshot()).projects[0];
  const changed = await cold.saveProject(
    { ...projectForm(existing), quantityUnit: '千米' },
    existing.revision,
  );
  assert.equal(changed.quantityUnit, '千米');
  const record = await cold.quickRecord(project.id);
  assert.equal(record.quantityUnit, '千米');
  const locked = (await cold.snapshot()).projects[0];
  await assert.rejects(
    cold.saveProject({ ...projectForm(locked), quantityUnit: '米' }, locked.revision),
    /单位不可更改/,
  );
  assert.equal((await new LocalRepository(files).snapshot()).records[0].quantityUnit, '千米');
});

test('新输入的文字长度、数值格式与单次上限统一受限，Unicode文字不截断代理对', () => {
  assert.equal(textLength(limitText('😀'.repeat(7), inputLimits.projectName)), 6);
  assert.equal(limitText('😀'.repeat(7), 6), '😀'.repeat(6));
  // Rejected edits must preserve the accepted draft, including text after the insertion point.
  assert.equal(limitNote('字'.repeat(101), '原内容'), '原内容');
  assert.equal(limitNote('a\n\nb\nc', 'a\nb\nc'), 'a\nb\nc');
  assert.equal(limitNote('a\r\nb\nc'), 'a\nb\nc');
  assert.equal(limitNote('字'.repeat(99) + '😀'), '字'.repeat(99) + '😀');
  assert.equal(limitNote('a\u0000b', 'ab'), 'ab');
  for (const raw of ['-1', '+1', '1e3', '1.5', '100000', 'Infinity'])
    assert.equal(numericDraft(raw, 99999), false);
  assert.equal(numericDraft('99999', 99999), true);
  assert.equal(numericDraft('', 99999), true);
  assert.equal(numericDraft('1.2345', 1440, 4), true);
  assert.equal(numericDraft('1.23456', 1440, 4), false);
  assert.equal(acceptNumericDraft('999999', '9999999', 99999), true);
  assert.equal(acceptNumericDraft('9999999', '999999', 99999), false);
  assert.equal(parseTime('24', '时'), 86400);
  assert.equal(parseTime('1440', '分'), 86400);
  assert.equal(parseTime('86400', '秒'), 86400);
  for (const [raw, unit] of [
    ['8761', '时'],
    ['525601', '分'],
    ['31536001', '秒'],
    ['1.00000', '分'],
    ['1.0', '秒'],
  ] as const)
    assert.throws(() => parseTime(raw, unit));
  const form = { ...initialForm(), name: '一二三四五六', quantityEnabled: true };
  assert.equal(makeProject(form, now).name, form.name);
  for (const change of [
    { name: '一二三四五六七' },
    { name: '一\n二' },
    { quantityUnit: '一二三四五' },
    { quantityMax: '100000' },
    { defaultQuantity: '100000', quantityMax: '100000' },
    { timeUnit: '时' as const, timeMax: '8761', defaultTime: '1' },
    { timeMax: '525601' },
  ])
    assert.throws(() => makeProject({ ...form, ...change }, now));
});

test('新记录不能突破硬上限；累计可超出单次上限，范围记忆也不能绕过校验', async () => {
  const { api, form } = await setup();
  const project = await api.saveProject({ ...form, timeMax: '1440', quantityMax: '99999' }, 1);
  await api.saveRecord({
    ...input('cap_a'),
    durationSeconds: 86400,
    quantity: 99999,
    note: '字'.repeat(100),
  });
  await api.saveRecord({ ...input('cap_b'), durationSeconds: 86400, quantity: 99999 });
  const before = await api.snapshot();
  assert.equal(
    before.records.reduce((sum, r) => sum + r.quantity!, 0),
    199998,
  );
  assert.equal(
    before.records.reduce((sum, r) => sum + r.durationSeconds!, 0),
    172800,
  );
  for (const change of [
    { quantity: -1 },
    { quantity: 100000 },
    { quantity: '100' as any },
    { durationSeconds: 31536001 },
    { note: '字'.repeat(101) },
    { note: 'a\nb\nc\nd' },
    { note: 'a\u0000b' },
    { occurredOn: '1899-12-31' },
  ]) {
    await assert.rejects(
      api.saveRecord({ ...input('cap_invalid'), ...change }, undefined, {
        projectRevision: project.revision,
        metrics: ['durationSeconds', 'quantity'],
      }),
    );
    assert.deepEqual(await api.snapshot(), before);
  }
});

test('旧版超限配置与记录冷启动可读，未修改的历史值不截断，新写入仍受限', async () => {
  const { api, files } = await setup();
  await api.repository.transaction((db) => {
    // Model a file written by the previous 24-character / 500-character version, including its larger numeric ranges.
    Object.assign(db.projects[0], {
      name: '旧版项目名称一二三四五六',
      timeMax: 600000,
      defaultTime: 550000,
      quantityMax: 200000,
      defaultQuantity: 100000,
      quantityUnitLocked: true,
    });
    db.records.push({
      ...input('legacy_limits'),
      occurredOn: '1899-12-31',
      durationSeconds: 31536001,
      quantity: 100000,
      quantityUnit: '次',
      note: '字'.repeat(500),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    });
  });
  const cold = new PracticeService(new LocalRepository(files), () => now);
  const db = await cold.snapshot(),
    record = db.records[0],
    project = db.projects[0];
  assert.equal(record.note.length, 500);
  assert.equal(record.quantity, 100000);
  assert.equal(canQuickRecord(project), false);
  await assert.rejects(cold.saveRecord({ ...input('legacy_new'), quantity: 100000 }));
  await assert.rejects(cold.saveRecord({ ...input('legacy_time'), durationSeconds: 31536001 }));
  await cold.saveRecord({ ...record, note: '只改备注，历史值保留' }, record.revision);
  const edited = (await cold.snapshot()).records[0];
  assert.equal(edited.quantity, 100000);
  assert.equal(edited.durationSeconds, 31536001);
  assert.equal(edited.occurredOn, '1899-12-31');
  await cold.saveProject({ ...projectForm(project), color: 'blue' }, project.revision);
  assert.equal((await cold.snapshot()).projects[0].name, project.name);
});
test('稳定ID重试只产生一条记录，配置不同不能复用同一ID', async () => {
  const { api, form } = await setup();
  await api.saveProject(form);
  await assert.rejects(api.saveProject({ ...form, defaultTime: '61' }), /已存在/);
  await api.saveRecord(input());
  await api.saveRecord(input());
  assert.equal((await api.snapshot()).records.length, 1);
  await assert.rejects(api.saveRecord({ ...input(), quantity: 51 }), /其他保存内容/);
});
test('并发提交串行累加；同日相同值的独立记录均保留', async () => {
  const { api } = await setup();
  await Promise.all(Array.from({ length: 8 }, (_, i) => api.saveRecord(input('r_' + i))));
  const rows = (await api.snapshot()).records;
  assert.equal(rows.length, 8);
  assert.equal(statistics(rows, 'quantity', 'all', 0, '2026-11-24').added, 400);
});

test('手动录入越界值时，记录、范围和默认值一次提交，重试与冷启动不重复', async () => {
  const { api, files, form } = await setup();
  const project = await api.saveProject(
    { ...form, timeMax: '30', defaultTime: '15', quantityMax: '30', defaultQuantity: '15' },
    1,
  );
  const record = { ...input('expanded'), durationSeconds: 35 * 60, quantity: 42 };
  const preferences = {
    projectRevision: project.revision,
    metrics: ['durationSeconds', 'quantity'] as const,
  };
  await api.saveRecord(record, undefined, preferences);
  await api.saveRecord(record, undefined, preferences);
  const cold = new PracticeService(new LocalRepository(files), () => now);
  const db = await cold.snapshot(),
    updated = db.projects[0];
  assert.equal(db.records.length, 1);
  assert.equal(updated.timeMin, 1);
  assert.equal(updated.timeMax, 35);
  assert.equal(updated.defaultTime, 35);
  assert.equal(updated.quantityMax, 42);
  assert.equal(updated.defaultQuantity, 42);
  assert.equal(updated.revision, project.revision + 1);
  // Undo removes the record, while remembered input preferences remain available for the next entry.
  await cold.undo();
  assert.equal((await cold.snapshot()).records.length, 0);
  assert.equal((await cold.snapshot()).projects[0].defaultTime, 35);
  const quick = await cold.quickRecord(updated.id, 'expanded_quick');
  assert.equal(quick.durationSeconds, 2100);
  assert.equal(quick.quantity, 42);
});

test('手动输入可扩展下限和更新范围内的默认值；小数时间保留整秒和整数配置', async () => {
  const { api, form } = await setup();
  let project = await api.saveProject(
    {
      ...form,
      timeMin: '10',
      timeMax: '30',
      defaultTime: '20',
      quantityMin: '5',
      quantityMax: '20',
      defaultQuantity: '10',
    },
    1,
  );
  await api.saveRecord({ ...input('lower'), durationSeconds: 300, quantity: 12 }, undefined, {
    projectRevision: project.revision,
    metrics: ['durationSeconds', 'quantity'],
  });
  project = (await api.snapshot()).projects[0];
  assert.equal(project.timeMin, 5);
  assert.equal(project.timeMax, 30);
  assert.equal(project.defaultTime, 5);
  assert.equal(project.quantityMin, 5);
  assert.equal(project.quantityMax, 20);
  assert.equal(project.defaultQuantity, 12);
  await api.saveRecord({ ...input('fraction'), durationSeconds: 150, quantity: 12 }, undefined, {
    projectRevision: project.revision,
    metrics: ['durationSeconds'],
  });
  const db = await api.snapshot();
  assert.equal(db.records[1].durationSeconds, 150);
  assert.equal(db.projects[0].timeMin, 2);
  assert.equal(db.projects[0].defaultTime, 5);
});

test('非法记录和过期项目版本不会留下单独的范围或默认值修改', async () => {
  const { api, form } = await setup();
  const project = await api.saveProject({ ...form, timeMax: '30', defaultTime: '15' }, 1);
  const before = await api.snapshot();
  await assert.rejects(
    api.saveRecord({ ...input(), durationSeconds: 2100, note: '字'.repeat(501) }, undefined, {
      projectRevision: project.revision,
      metrics: ['durationSeconds'],
    }),
  );
  assert.deepEqual(await api.snapshot(), before);
  await api.saveProject({ ...form, timeMax: '40', defaultTime: '20' }, project.revision);
  const latest = await api.snapshot();
  await assert.rejects(
    api.saveRecord({ ...input(), durationSeconds: 2100 }, undefined, {
      projectRevision: project.revision,
      metrics: ['durationSeconds'],
    }),
    /项目设置已更新/,
  );
  assert.deepEqual(await api.snapshot(), latest);
});
test('记录不能跨项目编辑，过期revision不能覆盖', async () => {
  const { api, form } = await setup();
  const r = await api.saveRecord(input());
  await api.saveProject({ ...form, id: 'p_other', name: '其他' });
  await assert.rejects(
    api.saveRecord({ ...input(), projectId: 'p_other' }, r.revision),
    /移到其他项目/,
  );
  await api.saveRecord({ ...input(), note: '新备注' }, r.revision);
  await assert.rejects(api.saveRecord(input(), r.revision), /已更改或删除/);
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
    /不可更改/,
  );
});
test('范围缩小、关闭指标不改历史；历史空项编辑不补默认', async () => {
  const { api, form } = await setup();
  const r = await api.saveRecord(input());
  await api.saveProject({ ...form, timeMax: '10', defaultTime: '5', quantityEnabled: false }, 1);
  await api.saveRecord({ ...input(), note: '保留旧值' }, r.revision);
  await assert.rejects(api.saveRecord({ ...input(), quantity: 60 }, 2), /记录类型已关闭/);
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
test('范围和默认值与记录在每个写入故障点均共同提交或共同回退', async () => {
  const base = await setup();
  const project = await base.api.saveProject({ ...base.form, timeMax: '30', defaultTime: '15' }, 1);
  const value = { ...input('atomic_preference'), durationSeconds: 2100 };
  const preferences = { projectRevision: project.revision, metrics: ['durationSeconds'] as const };
  const probe = base.files.copy();
  await new PracticeService(new LocalRepository(probe), () => now).saveRecord(
    value,
    undefined,
    preferences,
  );
  for (let step = 1; step <= probe.count; step++)
    for (const after of [false, true]) {
      const files = base.files.copy();
      files.failAt = step;
      files.after = after;
      await assert.rejects(
        new PracticeService(new LocalRepository(files), () => now).saveRecord(
          value,
          undefined,
          preferences,
        ),
      );
      files.failAt = -1;
      const cold = new LocalRepository(files),
        db = await cold.snapshot();
      // A lost callback may already have committed, but never leaves a record/configuration mismatch.
      assert.equal(db.projects[0].timeMax, db.records.length ? 35 : 30);
      assert.equal(db.projects[0].defaultTime, db.records.length ? 35 : 15);
      if (cold.recoveryRequired) cold.acknowledgeRecovery();
      const retry = new PracticeService(cold, () => now);
      await retry.saveRecord(value, undefined, preferences);
      assert.equal((await retry.snapshot()).records.length, 1);
      assert.equal((await retry.snapshot()).projects[0].defaultTime, 35);
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
    /处理数据恢复/,
  );
  files.data.set('manifest-a.json', 'broken');
  await assert.rejects(new LocalRepository(files).snapshot(), /检查未通过/);
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
  await assert.rejects(api.saveProject(form), /已删除/);
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
    /存储上限/,
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

/** A permutation must survive a cold read without revising projects or touching any recorded amount. */
test('整理顺序原子保存、冷启动还原；陈旧或非法列表不能覆盖项目', async () => {
  const { files, api, project } = await setup();
  const second = await api.saveProject({ ...initialForm(), name: '阅读' });
  const third = await api.saveProject({ ...initialForm(), name: '练琴' });
  await api.saveRecord(input());
  const before = await api.snapshot(),
    ids = before.projects.map((p) => p.id);
  const desired = [third.id, project.id, second.id];
  await api.reorderProjects(desired, ids);
  const cold = await new LocalRepository(files).snapshot();
  assert.deepEqual(
    cold.projects.map((p) => p.id),
    desired,
  );
  assert.deepEqual(cold.records, before.records);
  assert.deepEqual(cold.undo, before.undo);
  assert.deepEqual(
    cold.projects.find((p) => p.id === project.id),
    before.projects[0],
  );
  await assert.rejects(api.reorderProjects([project.id, project.id, second.id]), /项目列表已变化/);
  await assert.rejects(api.reorderProjects([project.id, second.id, 'p_missing']), /项目列表已变化/);
  await assert.rejects(api.reorderProjects(ids, ids), /排序已变化/);
  const added = await api.saveProject({ ...initialForm(), name: '跑步' });
  await assert.rejects(api.reorderProjects(desired), /项目列表已变化/);
  assert.deepEqual(
    (await api.snapshot()).projects.map((p) => p.id),
    [...desired, added.id],
  );
  await api.repository.deleteProject(second.id);
  await assert.rejects(api.reorderProjects([...desired, added.id]), /项目列表已变化/);
  assert.ok(!(await api.snapshot()).projects.some((p) => p.id === second.id));
});

/** A failed write leaves the previous order readable and can be retried using the same intended permutation. */
test('排序落盘失败不产生半个顺序，重试后保持全部项目', async () => {
  const { files, api, project } = await setup();
  const second = await api.saveProject({ ...initialForm(), name: '阅读' });
  const ids = [project.id, second.id],
    desired = [...ids].reverse();
  files.failAt = files.count + 1;
  await assert.rejects(api.reorderProjects(desired, ids), /尚未确认是否保存成功/);
  files.failAt = -1;
  assert.deepEqual(
    (await new LocalRepository(files).snapshot()).projects.map((p) => p.id),
    ids,
  );
  await api.reorderProjects(desired, ids);
  assert.deepEqual(
    (await new LocalRepository(files).snapshot()).projects.map((p) => p.id),
    desired,
  );
});

/** Pointer positions use document coordinates so auto-scroll and wide slots use the same ordering rule. */
/** A long move opens a real insertion hole and displaces every intervening card, nearest first. */
test('拖动跨越多个位置时卡片依次让位，反向拖动回到原位不改ID', async () => {
  const { previewProjectOrder } = await import('../miniprogram/application/project-order');
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const slots = ids.map((_, i) => ({
    left: (i % 2) * 162,
    top: 200 + Math.floor(i / 2) * 192,
    width: 150,
    height: 180,
  }));
  const forward = previewProjectOrder(ids, 'a', 4, slots)!;
  assert.deepEqual(forward.hole, slots[4]);
  assert.deepEqual(
    forward.shifts.map((shift) => [shift.id, shift.x, shift.y, shift.delay]),
    [
      ['a', 0, 384, 0],
      ['b', -162, 0, 84],
      ['c', 162, -192, 56],
      ['d', -162, 0, 28],
      ['e', 162, -192, 0],
      ['f', 0, 0, 0],
    ],
  );
  const backward = previewProjectOrder(ids, 'e', 0, slots)!;
  assert.deepEqual(backward.hole, slots[0]);
  assert.equal(backward.shifts[0].delay, 0);
  assert.equal(backward.shifts[3].delay, 84);
  assert.equal(backward.shifts[5].x, 0);
  const returned = previewProjectOrder(ids, 'a', 0, slots)!;
  assert.ok(returned.shifts.every((shift) => shift.x === 0 && shift.y === 0 && shift.delay === 0));
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f']);
});

/** A full-row legacy card must repack with its original size rather than being pushed into a half-width slot. */
test('宽卡参与让位时重新排布各行，预览不重叠，空位保持被拖卡片尺寸', async () => {
  const { previewProjectOrder } = await import('../miniprogram/application/project-order');
  const ids = ['wide', 'b', 'c', 'd'];
  const slots = [
    { left: 0, top: 200, width: 312, height: 180 },
    { left: 0, top: 392, width: 150, height: 180 },
    { left: 162, top: 392, width: 150, height: 180 },
    { left: 0, top: 584, width: 150, height: 180 },
  ];
  const preview = previewProjectOrder(ids, 'd', 0, slots)!;
  assert.equal(preview.hole.width, 150);
  const shifted = preview.shifts.map((shift, i) => ({
    ...slots[i],
    left: slots[i].left + shift.x,
    top: slots[i].top + shift.y,
  }));
  assert.equal(shifted[0].width, 312);
  for (let i = 0; i < shifted.length; i++)
    for (let j = i + 1; j < shifted.length; j++) {
      const a = shifted[i],
        b = shifted[j];
      assert.ok(
        a.left + a.width <= b.left ||
          b.left + b.width <= a.left ||
          a.top + a.height <= b.top ||
          b.top + b.height <= a.top,
      );
    }
  assert.equal(previewProjectOrder(ids, 'd', 0, []), null);
});

test('拖动目标计算与移动不丢ID，边缘滚动后仍命中正确位置', async () => {
  const { moveProject, nearestSlot } = await import('../miniprogram/application/project-order');
  const slots = [
    { left: 0, top: 200, width: 150, height: 180 },
    { left: 162, top: 200, width: 150, height: 180 },
    { left: 0, top: 392, width: 312, height: 180 },
  ];
  assert.equal(nearestSlot(slots, 200, 290), 1);
  assert.equal(nearestSlot(slots, 120, 480), 2);
  assert.equal(nearestSlot([], 0, 0), -1);
  assert.deepEqual(moveProject(['a', 'b', 'c'], 'a', 2), ['b', 'c', 'a']);
  assert.deepEqual(moveProject(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
  assert.deepEqual(moveProject(['a', 'b'], 'x', 1), ['a', 'b']);
  assert.deepEqual(moveProject(['a', 'b'], 'a', -1), ['a', 'b']);
});

test('首页当天缺失指标不伪装为零，长快速增量保留原文并使用更宽卡片', async () => {
  const { project } = await setup();
  const { projectTile } = await import('../miniprogram/application/presentation');
  const p = {
    ...project,
    quantityUnit: '毫升',
    directEntryEnabled: true,
    defaultTime: 999999,
    defaultQuantity: 999999,
  };
  const tile = projectTile(p, [], '2026-11-24');
  assert.equal(tile.wide, true);
  assert.match(tile.caption, /999,999毫升/);
  const missing = projectTile(
    { ...project, primaryMetric: 'durationSeconds' },
    [
      {
        ...input(),
        durationSeconds: null,
        quantityUnit: '次',
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
    ],
    '2026-11-24',
  );
  assert.equal(missing.number, '—');
  assert.equal(missing.summaryLabel, '今天时间未记录，时间未记录');
  // Daily values remain exact while the quieter lifetime text may abbreviate with its unit intact.
  const compact = projectTile(
    { ...project, primaryMetric: 'quantity' },
    [
      {
        ...input(),
        quantity: 126000,
        quantityUnit: '次',
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
    ],
    '2026-11-24',
  );
  assert.equal(compact.number, '126,000');
  assert.equal(compact.lifetimeText, '12.6万次');
  assert.equal(compact.unit, '次');
  assert.equal(compact.wide, false);
});

/** Dates and amounts, rather than saved timestamps or record counts, drive the new daily emphasis. */
test('首页当天主次指标、零新增与累计分别计算，跨天重新聚合', async () => {
  const { project } = await setup();
  const { projectTile } = await import('../miniprogram/application/presentation');
  const rows = [
    { ...input('old'), occurredOn: '2026-11-20', quantity: 5000, durationSeconds: 6000 },
    { ...input('today1'), quantity: 1000, durationSeconds: 600 },
    { ...input('today2'), quantity: 500, durationSeconds: 300 },
  ].map((row) => ({ ...row, quantityUnit: '次', createdAt: now, updatedAt: now, revision: 1 }));
  const p = { ...project, primaryMetric: 'quantity' as const };
  const today = projectTile(p, rows, '2026-11-24');
  assert.equal(today.number, '1,500');
  assert.equal(today.todayLabel, '今天 · 15分钟');
  assert.equal(today.lifetimeText, '6,500次');
  assert.equal(today.trend.kind, 'steps');
  assert.match(today.summaryLabel, /今天1,500次，累计6,500次/);
  const tomorrow = projectTile(p, rows, '2026-11-25');
  assert.equal(tomorrow.number, '0');
  assert.equal(tomorrow.todayLabel, '今天');
  assert.equal(tomorrow.lifetimeText, '6,500次');
  const time = projectTile({ ...p, primaryMetric: 'durationSeconds' }, rows, '2026-11-24');
  assert.equal(time.number, '15');
  assert.equal(time.todayLabel, '今天 · 1,500次');
  assert.equal(time.trend.kind, 'bars');
});

/** Gaps stay flat and past edits/deletions rebuild all subsequent cumulative points. */
test('首页七日简图保留基数、空日与真实新增，不把其他日期混进当天', async () => {
  const { project } = await setup();
  const { projectTile } = await import('../miniprogram/application/presentation');
  const p = { ...project, primaryMetric: 'quantity' as const };
  const row = (id: string, occurredOn: string, quantity: number) => ({
    ...input(id),
    occurredOn,
    quantity,
    quantityUnit: '次',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  });
  const rows = [
    row('base', '2026-11-01', 900),
    row('start', '2026-11-18', 100),
    row('end', '2026-11-24', 200),
  ];
  const card = projectTile(p, rows, '2026-11-24');
  assert.equal(card.trend.steps[0].cumulative, 1000);
  assert.equal(card.trend.steps[1].cumulative, 1000);
  assert.equal(card.trend.steps[1].height, 0);
  assert.equal(card.trend.steps[6].cumulative, 1200);
  const edited = projectTile(p, [rows[0], { ...rows[1], quantity: 400 }, rows[2]], '2026-11-24');
  assert.equal(edited.trend.steps[6].cumulative, 1500);
  assert.equal(edited.number, '200');
  const deleted = projectTile(p, [rows[0], rows[2]], '2026-11-24');
  assert.equal(deleted.trend.steps[6].cumulative, 1100);
  const empty = projectTile(p, [], '2026-11-24');
  assert.equal(empty.number, '0');
  assert.ok(empty.trend.steps.every((step) => step.height === 0));
  assert.ok(empty.trend.bars.every((bar) => bar.value === 0));
});

test('图表的小数单位坐标不全部变零，命中仅限绘图区，读数包含完整日期', async () => {
  const { axisLabel, niceMaximum, pointIndex } =
    await import('../miniprogram/application/chart-layout');
  const max = niceMaximum(1, 3600);
  assert.ok(max >= 1);
  assert.notEqual(axisLabel(max / 3600), '0');
  assert.equal(pointIndex(0, 300, 10), null);
  assert.equal(pointIndex(54, 300, 10), 0);
  assert.equal(pointIndex(288, 300, 10), 9);
  const { api } = await setup();
  await api.saveRecord(input());
  const result = statistics((await api.snapshot()).records, 'quantity', 'week', 0, '2026-11-24');
  assert.equal(result.points.at(-1)?.description, '2026-11-24');
});

/** Calendar-boundary examples protect cadence from rolling-day approximations and UTC month shifts. */
test('频率按自然周和自然月分桶，跨年、闰年与大小月保持日历边界', async () => {
  const { frequencyStart } = await import('../miniprogram/domain/frequency');
  assert.equal(frequencyStart('2027-01-03', 'week'), '2026-12-28');
  assert.equal(frequencyStart('2027-01-04', 'week'), '2027-01-04');
  assert.equal(frequencyStart('2024-03-31', 'month', -1), '2024-02-01');
  assert.equal(frequencyStart('2024-02-29', 'month', 1), '2024-03-01');
  assert.equal(frequencyStart('2027-01-31', 'month', -1), '2026-12-01');
});

/** The same history must regroup without modifying values, secondary metrics, defaults or lifetime totals. */
test('首页频率适配7天4周6月，周期量与简图基数独立且支持缺失、补记和删除', async () => {
  const { project } = await setup();
  const { projectTile, homeTrend } = await import('../miniprogram/application/presentation');
  const p = { ...project, primaryMetric: 'quantity' as const };
  const row = (id: string, occurredOn: string, quantity: number | null) => ({
    ...input(id),
    occurredOn,
    quantity,
    durationSeconds: 60,
    quantityUnit: '次',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  });
  const rows = [
    row('base', '2026-05-31', 100),
    row('june', '2026-06-01', 10),
    row('oldWeek', '2026-11-02', 20),
    row('sunday', '2026-11-22', 30),
    row('monday', '2026-11-23', 40),
    row('today', '2026-11-24', 50),
  ];
  const before = JSON.stringify(rows);
  const day = projectTile(p, rows, '2026-11-24');
  assert.equal(day.number, '50');
  assert.equal(day.trend.bars.length, 7);
  const week = projectTile({ ...p, frequency: 'week' }, rows, '2026-11-24');
  assert.equal(week.number, '90');
  assert.equal(week.todayLabel, '本周 · 2分钟');
  assert.equal(week.trend.bars.length, 4);
  assert.deepEqual(
    week.trend.bars.map((b) => b.value),
    [20, 0, 30, 90],
  );
  assert.deepEqual(
    week.trend.steps.map((b) => b.cumulative),
    [130, 130, 160, 250],
  );
  assert.match(week.trend.label, /近4周/);
  const month = projectTile({ ...p, frequency: 'month' }, rows, '2026-11-24');
  assert.equal(month.number, '140');
  assert.equal(month.todayLabel, '本月 · 4分钟');
  assert.equal(month.trend.bars.length, 6);
  assert.deepEqual(
    month.trend.bars.map((b) => b.value),
    [10, 0, 0, 0, 0, 140],
  );
  assert.equal(month.trend.steps[0].cumulative, 110);
  assert.equal(month.trend.steps[5].cumulative, 250);
  assert.match(month.trend.label, /近6个月/);
  assert.equal(month.lifetimeText, week.lifetimeText);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(projectTile({ ...p, frequency: 'month' }, rows, '2026-12-01').number, '0');
  assert.equal(
    projectTile({ ...p, frequency: 'week' }, [row('missing', '2026-11-23', null)], '2026-11-24')
      .number,
    '—',
  );
  assert.equal(projectTile({ ...p, frequency: 'week' }, [], '2026-11-24').number, '0');
  const edited = rows.map((r) => (r.id === 'june' ? { ...r, quantity: 15 } : r));
  assert.equal(
    homeTrend({ ...p, frequency: 'month' }, edited, '2026-11-24').steps[5].cumulative,
    255,
  );
  assert.equal(
    homeTrend({ ...p, frequency: 'month' }, rows.slice(1), '2026-11-24').steps[5].cumulative,
    150,
  );
  const time = homeTrend(
    { ...p, frequency: 'week', primaryMetric: 'durationSeconds' },
    rows,
    '2026-11-24',
  );
  assert.equal(time.kind, 'bars');
  assert.deepEqual(
    time.bars.map((b) => b.value),
    [60, 0, 60, 120],
  );
});

/** A cold read upgrades only absent fields; explicit bad cadence cannot be silently treated as valid data. */
test('频率和草稿冷启动持久化、旧字段缺失兼容、非法频率拒绝与历史不变', async () => {
  const { files, api, project } = await setup();
  await api.saveRecord(input());
  const history = (await api.snapshot()).records;
  let current = (await api.snapshot()).projects[0];
  for (const frequency of ['week', 'month', 'day'] as const) {
    current = await api.saveProject({ ...projectForm(current), frequency }, current.revision);
    const cold = await new PracticeService(new LocalRepository(files), () => now).snapshot();
    assert.equal(cold.projects[0].frequency, frequency);
    assert.deepEqual(cold.records, history);
  }
  const draft = { ...initialForm(), frequency: 'month' as const };
  await api.saveDraft(draft);
  assert.equal(
    (await new PracticeService(new LocalRepository(files), () => now).snapshot()).newProjectDraft
      ?.frequency,
    'month',
  );
  await api.repository.transaction((db) => {
    // Recreate pre-feature on-disk data through the repository's actual checksum/manifest writer.
    delete (db.projects[0] as Partial<typeof project>).frequency;
    delete (db.newProjectDraft as Partial<typeof draft>).frequency;
  });
  const legacy = await new PracticeService(new LocalRepository(files), () => now).snapshot();
  assert.equal(legacy.projects[0].frequency, 'day');
  assert.equal(legacy.newProjectDraft?.frequency, 'day');
  assert.deepEqual(legacy.records, history);
  assert.throws(
    () => makeProject({ ...initialForm(), name: '非法', frequency: 'year' as any }, now),
    /频率/,
  );
  await assert.rejects(
    api.repository.transaction((db) => {
      db.projects[0].frequency = 'year' as any;
    }),
    /频率/,
  );
});

/** Unit choice changes presentation, never canonical duration or the record's calendar assignment. */
test('分时天共用365天上限，天按24小时换算，秒只兼容已有项目', async () => {
  const { selectableTimeUnits, timeInputLimits, timeIntegerLengths } =
    await import('../miniprogram/domain/input-limits');
  assert.deepEqual(selectableTimeUnits, ['分', '时', '天']);
  assert.equal(initialForm().timeUnit, '分');
  for (const [unit, maximum] of [
    ['分', 525600],
    ['时', 8760],
    ['天', 365],
  ] as const) {
    assert.equal(timeInputLimits[unit], maximum);
    assert.equal(timeIntegerLengths[unit], String(maximum).length);
    assert.equal(parseTime(String(maximum), unit), 31536000);
    assert.throws(() => parseTime(String(maximum + 1), unit));
    const form = {
      ...initialForm(),
      name: '投入',
      timeUnit: unit,
      timeMin: '0',
      timeMax: String(maximum),
      defaultTime: '1',
    };
    assert.equal(makeProject(form, now).timeUnit, unit);
    assert.throws(() => makeProject({ ...form, timeMax: String(maximum + 1) }, now));
  }
  assert.equal(parseTime('0.5', '天'), 43200);
  assert.equal(parseTime('0.0025', '天'), 216);
  for (const raw of ['0.0001', '0.12345', '-1', '1e2', '366'])
    assert.throws(() => parseTime(raw, '天'));
  assert.equal(timeText(172800, '天'), '2天');
  assert.equal(timeText(43200, '天'), '0.5天');
  assert.equal(timeText(1, '天'), '≈0.00001157天');
  assert.throws(
    () => makeProject({ ...initialForm(), name: '旧单位', timeUnit: '秒' }, now),
    /请选择时间单位/,
  );
  const legacy = {
    ...makeProject({ ...initialForm(), name: '旧项目' }, now),
    timeUnit: '秒' as const,
  };
  assert.equal(makeProject(projectForm(legacy), now, legacy).timeUnit, '秒');
});

/** Quick entry, manual expansion, display totals and cold reads must all agree on the same second-based data. */
test('天单位贯穿快速记录、精确扩展、累计统计、热力图与历史切换', async () => {
  const { api, project, files } = await setup();
  const { projectTile, recordText } = await import('../miniprogram/application/presentation');
  const { calendarHeatmap } = await import('../miniprogram/domain/calendar-heatmap');
  const { heatmapReading } = await import('../miniprogram/application/calendar-presentation');
  let p = await api.saveProject(
    {
      ...projectForm(project),
      timeUnit: '天',
      timeMax: '10',
      defaultTime: '2',
      primaryMetric: 'durationSeconds',
      directEntryEnabled: true,
    },
    project.revision,
  );
  const quick = await api.quickRecord(p.id, 'day_quick');
  assert.equal(quick.durationSeconds, 172800);
  await api.saveRecord(
    { ...input('day_cap'), durationSeconds: parseTime('365', '天') },
    undefined,
    { projectRevision: p.revision, metrics: ['durationSeconds'] },
  );
  const snapshot = await api.snapshot();
  p = snapshot.projects[0];
  assert.equal(p.timeMax, 365);
  assert.equal(p.defaultTime, 365);
  assert.equal(p.timeUnit, '天');
  assert.equal(projectTile(p, snapshot.records, '2026-11-24').number, '367');
  assert.match(projectTile(p, snapshot.records, '2026-11-24').caption, /365天/);
  assert.match(recordText(p, quick), /2天/);
  const result = statistics(snapshot.records, 'durationSeconds', 'month', 0, '2026-11-24');
  assert.equal(result.added, 367 * 86400);
  const heatmap = calendarHeatmap(snapshot.records, 'durationSeconds', 0, '2026-11-24');
  const day = heatmap.cells.find((cell) => cell.date === '2026-11-24')!;
  assert.match(heatmapReading(day, p, 'durationSeconds'), /367天/);
  const history = snapshot.records;
  const hours = await api.saveProject(
    { ...projectForm(p), timeUnit: '时', timeMax: '8760', defaultTime: '8760' },
    p.revision,
  );
  assert.match(recordText(hours, quick), /48小时/);
  const cold = await new PracticeService(new LocalRepository(files), () => now).snapshot();
  assert.deepEqual(cold.records, history);
});
