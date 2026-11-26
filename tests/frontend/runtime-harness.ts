/** Test-copy instrumentation only: the runner refuses to execute against the production storage namespace.
 * User actions still invoke real page/component handlers; fixtures and IO faults are reported separately from native input.
 */
import { service } from './application/service';
import {
  dateKey,
  emptyDatabase,
  factors,
  initialForm,
  makeProject,
  moveDay,
  newId,
  projectForm,
  total,
} from './domain/model';

const pause = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));
const page = (): any => getCurrentPages().slice(-1)[0];
const svc = () => service();
const snapshot = () => svc().snapshot();
const event = (field: string, value: any) => ({
  currentTarget: { dataset: { field } },
  detail: { value },
});
const metricEvent = (index: number, value?: any) => ({
  currentTarget: { dataset: { index } },
  detail: { value },
});
const checks: any[] = [];
const check = (name: string, pass: boolean, actual?: any, expected?: any) =>
  checks.push({ name, pass, actual, expected });
let restoration: null | (() => void) = null;
let series = 0;

async function waitPage(route: string) {
  for (let i = 0; i < 100; i++) {
    const p = page();
    if (p && p.route === route && p.data.loading === false) return p;
    await pause(40);
  }
  throw new Error('页面未就绪: ' + route);
}
async function home() {
  // Test cleanup abandons disposable editor drafts; native confirmation UX is tested separately, not bypassed in production.
  wx.disableAlertBeforeUnload();
  if (page()?.route !== 'pages/home/index') await wx.reLaunch({ url: '/pages/home/index' });
  const p = await waitPage('pages/home/index');
  const panel = p.selectComponent('#record-sheet');
  if (panel?.data.mounted) {
    panel.close();
    await pause();
  }
  return p;
}
async function reset() {
  await home();
  await svc().repository.transaction((db) => Object.assign(db, emptyDatabase()));
}
async function seed(extra: any = {}) {
  await reset();
  const p = await svc().saveProject({
    ...initialForm(),
    id: newId('qa'),
    name: '测试项目',
    quantityEnabled: true,
    quantityUnit: '页',
    defaultTime: '30',
    defaultQuantity: '12',
    ...extra,
  });
  await page().load();
  return p;
}
async function editor(p?: any) {
  await home();
  await wx.navigateTo({ url: '/pages/project-edit/index' + (p ? '?id=' + p.id : '') });
  return waitPage('pages/project-edit/index');
}
async function detail(p: any) {
  await home();
  await wx.navigateTo({ url: '/pages/project-detail/index?id=' + p.id });
  return waitPage('pages/project-detail/index');
}
async function sheet(p: any, old?: any) {
  const h = await home();
  const s = h.selectComponent('#record-sheet');
  h._sheetOpen = true;
  s.open(p, old);
  await pause();
  return s;
}
function snapshotField(s: any, index: number) {
  const f = s.data.fields[index];
  return { raw: f.raw, canonical: f.canonical, canSave: s.data.canSave, error: s.data.error };
}
function failManifest(afterWrite: boolean) {
  const files: any = (svc().repository as any).files;
  const original = files.write.bind(files);
  let failed = false;
  files.write = async (path: string, text: string) => {
    if (!failed && path.startsWith('manifest-')) {
      failed = true;
      if (afterWrite) await original(path, text);
      throw new Error(afterWrite ? 'QA_LOST_CALLBACK' : 'QA_WRITE_DENIED');
    }
    return original(path, text);
  };
  restoration = () => {
    files.write = original;
  };
}

const cases: Record<string, (input: any) => Promise<any>> = {
  async bootstrap() {
    // The App RPC can connect before the first page's initialization transaction finishes.
    await home();
    const db = await snapshot();
    check(
      '隔离新存档为3项目18条记录',
      db.projects.length === 3 && db.records.length === 18,
      { projects: db.projects.length, records: db.records.length },
      { projects: 3, records: 18 },
    );
    await page().load();
    check('刷新不重复初始化', (await snapshot()).records.length === 18);
    return { storageRoot: (svc().repository as any).files.root, route: page().route };
  },
  async configInputs() {
    await reset();
    const p = await editor();
    p.text(event('name', '甲乙丙丁戊己'));
    const valid = p.data.form.name;
    const nameReturn = p.text(event('name', '甲新乙丙丁戊己'));
    check(
      '名称中间超限插入保留原文',
      p.data.form.name === valid,
      { before: valid, after: p.data.form.name, returned: nameReturn },
      valid,
    );
    p.text(event('quantityUnit', '甲乙丙丁'));
    const unit = p.data.form.quantityUnit;
    p.text(event('quantityUnit', '甲新乙丙丁'));
    check(
      '数量单位中间超限插入保留原文',
      p.data.form.quantityUnit === unit,
      { before: unit, after: p.data.form.quantityUnit },
      unit,
    );
    p.text(event('name', '😀'.repeat(6)));
    check('6个Unicode码点名称可保存', p.data.form.name === '😀'.repeat(6) && p.data.canSave);
    const payloads = [
      '-1',
      '+1',
      '1e3',
      'Infinity',
      'NaN',
      '1.2',
      '100000',
      '９９',
      '1,000',
      ' ',
      '9'.repeat(10000),
    ];
    for (const raw of payloads) {
      p.text(event('quantityMax', '100'));
      p.text(event('quantityMax', raw));
      check(
        '配置拒绝异常数量 ' + raw.slice(0, 18),
        p.data.form.quantityMax === '100',
        p.data.form.quantityMax,
        '100',
      );
    }
    p.text(event('timeMin', '120'));
    p.text(event('timeMax', '1'));
    check('倒置范围禁写', p.data.canSave === false);
    p.text(event('timeMin', '0'));
    p.text(event('timeMax', '1'));
    check(
      '0至1范围默认值为1',
      p.data.form.defaultTime === '1' && p.data.canSave,
      p.data.form.defaultTime,
      '1',
    );
    p.toggle(event('timeEnabled', false));
    p.toggle(event('quantityEnabled', false));
    check('两类关闭不可保存但可保留草稿', p.data.canSave === false);
    await p.cancel();
    const draft = (await snapshot()).newProjectDraft;
    check(
      '取消保留独立草稿，不生成项目',
      draft?.timeEnabled === false &&
        draft?.quantityEnabled === false &&
        (await snapshot()).projects.length === 0,
    );
    const restored = await editor();
    check(
      '草稿再次打开保持未完成状态',
      restored.data.form.timeEnabled === false &&
        restored.data.form.quantityEnabled === false &&
        restored.data.form.name === draft?.name,
    );
    await restored.cancel();
    return { payloadCount: payloads.length };
  },
  async recordInputs() {
    const p = await seed();
    const s = await sheet(p);
    const initial = (await snapshot()).records.length;
    for (const raw of [
      '-1',
      '+1',
      '1e3',
      '99999.5',
      '100000',
      'NaN',
      'Infinity',
      '９９',
      '1,000',
      '9'.repeat(10000),
    ]) {
      const before = s.data.fields[1].raw;
      s.exactInput(metricEvent(1, raw));
      check('记录数量拒绝 ' + raw.slice(0, 18), s.data.fields[1].raw === before, {
        before,
        after: s.data.fields[1].raw,
      });
    }
    s.exactInput(metricEvent(1, '99999'));
    check(
      '最大合法数量有效',
      s.data.fields[1].canonical === 99999 && s.data.canSave,
      snapshotField(s, 1),
    );
    s.exactInput(metricEvent(0, '0.5'));
    check(
      '0.5分钟精确存储候选为30秒',
      s.data.fields[0].canonical === 30 && s.data.canSave,
      snapshotField(s, 0),
    );
    for (const raw of ['', '.', '0.0001']) {
      s.exactInput(metricEvent(0, raw));
      check('未完成/非整秒禁保存 ' + raw, s.data.canSave === false, snapshotField(s, 0));
      s.finishExact(0);
      check(
        '结束精确编辑恢复上次完整秒数 ' + raw,
        s.data.fields[0].canonical === 30 && s.data.canSave,
        snapshotField(s, 0),
      );
    }
    s.noteInput({ detail: { value: '甲\n乙\n丙' } });
    s.noteInput({ detail: { value: '甲\n\n乙\n丙' } });
    check('第三次换行不丢末尾', s.data.note === '甲\n乙\n丙', s.data.note);
    s.noteInput({ detail: { value: '😀'.repeat(100) } });
    s.noteInput({ detail: { value: '😀'.repeat(101) } });
    check(
      '100码点备注再插入不丢原文',
      s.data.note === '😀'.repeat(100) && s.data.noteCount === 100,
    );
    s.dateChange({ detail: { value: '1899-12-31' } });
    check('1900年前禁保存', s.data.canSave === false);
    s.dateChange({ detail: { value: moveDay(dateKey(), 1) } });
    check('未来日期禁保存', s.data.canSave === false);
    s.dateChange({ detail: { value: '1900-01-01' } });
    check('1900年首日可保存', s.data.canSave);
    s.timeChange({ detail: { value: '24:00' } });
    check('非法时刻禁保存', s.data.canSave === false);
    s.timeChange({ detail: { value: '23:59' } });
    check('23:59可保存', s.data.canSave);
    check('所有输入均未提前落库', (await snapshot()).records.length === initial);
    s.close();
    await pause();
    return { limits: { quantity: 99999, timeSeconds: 31536000, note: 100 } };
  },
  async timeUnits() {
    for (const unit of ['分', '时', '天']) {
      const max: any = { 分: 525600, 时: 8760, 天: 365 };
      const p = await seed({
        timeUnit: unit,
        timeMax: String(max[unit]),
        defaultTime: '1',
        quantityEnabled: false,
      });
      const s = await sheet(p);
      s.exactInput(metricEvent(0, String(max[unit])));
      check(
        unit + '对应365天上限可输入',
        s.data.fields[0].canonical === 31536000 && s.data.canSave,
        snapshotField(s, 0),
      );
      s.exactInput(metricEvent(0, String(max[unit] + 1)));
      check(
        unit + '超365天保留最后合法值',
        s.data.fields[0].canonical === 31536000,
        snapshotField(s, 0),
      );
      s.slide(metricEvent(0, 0));
      check(
        unit + '零下限拖动仍为整数正单位',
        s.data.fields[0].canonical === factors[unit as '分'],
        snapshotField(s, 0),
      );
      s.close();
      await pause();
    }
  },
  async cancelAndRace() {
    const p = await seed();
    const baseline = (await snapshot()).records.length;
    for (let i = 0; i < 20; i++) {
      const s = await sheet(p);
      s.exactInput(metricEvent(0, '35'));
      s.noteInput({ detail: { value: '未保存' + i } });
      s.close();
      await pause();
    }
    check('20次输入取消无写入', (await snapshot()).records.length === baseline);
    const s = await sheet(p);
    check('重开恢复默认值与空备注', s.data.fields[0].canonical === 1800 && s.data.note === '');
    s.close();
    await s.save();
    await pause();
    const db = await snapshot();
    check(
      '退出动画内迟到保存不应提交',
      db.records.length === baseline,
      {
        records: db.records.length,
        baseline,
        opened: s.data.opened,
        mounted: s.data.mounted,
        error: s.data.error,
      },
      baseline,
    );
    return { closeCycles: 20 };
  },
  async rapidSubmit() {
    const p = await seed({ directEntryEnabled: true });
    const h = await home();
    await Promise.all(
      Array.from({ length: 100 }, () => h.record({ currentTarget: { dataset: { id: p.id } } })),
    );
    await pause(600);
    check(
      '100次同时快速打卡仅保存1条',
      (await snapshot()).records.length === 1,
      (await snapshot()).records.length,
      1,
    );
    await Promise.all(
      Array.from({ length: 100 }, () => h.record({ currentTarget: { dataset: { id: p.id } } })),
    );
    await pause();
    check(
      '间隔后另一轮100次仅新增1条',
      (await snapshot()).records.length === 2,
      (await snapshot()).records.length,
      2,
    );
    const regular = await seed();
    const s = await sheet(regular);
    await Promise.all(Array.from({ length: 100 }, () => s.save()));
    await pause();
    check(
      '普通面板100次并发保存仅1条',
      (await snapshot()).records.length === 1,
      (await snapshot()).records.length,
      1,
    );
    return { attempts: 300 };
  },
  async distinctConcurrency(input) {
    const p = await seed();
    const count = input.count || 200;
    const start = Date.now();
    const jobs = Array.from({ length: count }, (_, i) =>
      svc().saveRecord({
        id: newId('qac'),
        projectId: p.id,
        occurredOn: dateKey(),
        localTime: '',
        durationSeconds: 60,
        quantity: 1,
        note: '并发' + i,
      }),
    );
    const results = await Promise.allSettled(jobs);
    const db = await snapshot();
    check(
      '独立命令队列无丢失',
      db.records.length === count,
      { count: db.records.length, rejected: results.filter((r) => r.status === 'rejected').length },
      count,
    );
    check('独立命令ID不重复', new Set(db.records.map((r) => r.id)).size === count);
    await page().load();
    check(
      '首页累计与并发写入一致',
      page().data.tiles[0].lifetimeText === count + '分钟',
      page().data.tiles[0].lifetimeText,
      count + '分钟',
    );
    return { count, elapsedMs: Date.now() - start };
  },
  async staleSessions() {
    const p = await seed();
    const s = await sheet(p);
    s.exactInput(metricEvent(0, '35'));
    await svc().saveProject({ ...projectForm(p), defaultTime: '40' }, p.revision);
    await s.save();
    check(
      '项目修订冲突拒绝迟到保存',
      (await snapshot()).records.length === 0 && s.data.opened && Boolean(s.data.error),
      s.data.error,
    );
    s.close();
    await pause();
    const fresh = (await snapshot()).projects[0];
    const record = await svc().quickRecord(fresh.id);
    const edit = await sheet(fresh, record);
    await svc().deleteRecord(record.id, record.revision);
    edit.noteInput({ detail: { value: '迟到修改' } });
    await edit.save();
    check(
      '已删除记录不被历史编辑复活',
      (await snapshot()).records.length === 0 && Boolean(edit.data.error),
      edit.data.error,
    );
    edit.close();
    await pause();
    const pending = await sheet(fresh);
    await svc().repository.deleteProject(fresh.id);
    await pending.save();
    check(
      '删除项目后迟到保存不复活项目',
      (await snapshot()).projects.length === 0 &&
        (await snapshot()).records.length === 0 &&
        Boolean(pending.data.error),
      pending.data.error,
    );
    pending.close();
    await pause();
  },
  async writeFailure() {
    const p = await seed();
    const s = await sheet(p);
    s.exactInput(metricEvent(0, '150'));
    failManifest(false);
    await s.save();
    restoration?.();
    restoration = null;
    const db = await snapshot();
    check(
      '写入失败记录/范围不分离',
      db.records.length === 0 &&
        db.projects[0].timeMax === 120 &&
        db.projects[0].defaultTime === 30,
      {
        records: db.records.length,
        max: db.projects[0].timeMax,
        default: db.projects[0].defaultTime,
      },
    );
    check(
      '失败后保留面板及用户输入',
      s.data.opened && !s.data.busy && s.data.fields[0].canonical === 9000 && Boolean(s.data.error),
      { opened: s.data.opened, busy: s.data.busy, error: s.data.error },
    );
    await s.save();
    await pause();
    const after = await snapshot();
    check(
      '失败重试原子保存一条记录及配置',
      after.records.length === 1 &&
        after.projects[0].timeMax === 150 &&
        after.projects[0].defaultTime === 150,
    );
  },
  async uncertainWrites() {
    const p = await seed();
    const s = await sheet(p);
    s.noteInput({ detail: { value: '首次' } });
    failManifest(true);
    await s.save();
    restoration?.();
    restoration = null;
    check('新记录回调丢失后仍保留可重试面板', s.data.opened && Boolean(s.data.error));
    await s.save();
    await pause();
    let db = await snapshot();
    check('新记录同ID重试不重复', db.records.length === 1 && !s.data.opened, {
      count: db.records.length,
      error: s.data.error,
    });
    const old = db.records[0];
    const edit = await sheet(db.projects[0], old);
    edit.noteInput({ detail: { value: '修改后' } });
    failManifest(true);
    await edit.save();
    restoration?.();
    restoration = null;
    const firstError = edit.data.error;
    await edit.save();
    db = await snapshot();
    check(
      '历史编辑回调丢失后同内容重试可确认成功',
      !edit.data.opened && !edit.data.error,
      {
        firstError,
        retryError: edit.data.error,
        opened: edit.data.opened,
        revision: db.records[0].revision,
        note: db.records[0].note,
      },
      '关闭面板并确认已保存',
    );
    edit.close();
    await pause();
    const original = db.projects[0];
    const settings = await editor(original);
    settings.text(event('name', '改后项目'));
    failManifest(true);
    await settings.save();
    restoration?.();
    restoration = null;
    const error = settings.data.error;
    await settings.save();
    // navigateBack is asynchronous even though the controller's save Promise has resolved.
    if (!settings.data.error) await waitPage('pages/home/index');
    check(
      '设置回调丢失后同内容重试可确认成功',
      page().route !== 'pages/project-edit/index',
      { firstError: error, retryError: settings.data.error, route: page().route },
      '返回详情/首页',
    );
    // Discard the stale view without writing another project; the durable first write is inspected directly.
    wx.disableAlertBeforeUnload();
    await wx.reLaunch({ url: '/pages/home/index' });
    await waitPage('pages/home/index');
  },
  async quota() {
    const p = await seed();
    const s = await sheet(p);
    const repo: any = svc().repository;
    const capacity = repo.capacityBytes;
    restoration = () => {
      repo.capacityBytes = capacity;
    };
    repo.capacityBytes = 1;
    await s.save();
    restoration();
    restoration = null;
    check(
      '配额不足有错误且不显示成功',
      (await snapshot()).records.length === 0 && s.data.opened && Boolean(s.data.error),
      s.data.error,
    );
    await s.save();
    await pause();
    check('恢复空间后可重试', (await snapshot()).records.length === 1);
  },
  async arrangement() {
    const p = await seed();
    await svc().saveProject({ ...initialForm(), name: '另一项目' });
    const h = await home();
    await h.load();
    h.search({ detail: { value: '测试' } });
    h.enterArrange();
    check('搜索中整理显示全部项目', h.data.tiles.length === 2 && h.data.query === '测试');
    await Promise.all(
      Array.from({ length: 100 }, () => h.record({ currentTarget: { dataset: { id: p.id } } })),
    );
    check('整理状态100次打卡被屏蔽', (await snapshot()).records.length === 0);
    const before = (await snapshot()).projects.map((p) => ({ id: p.id, revision: p.revision }));
    h._orderIds.reverse();
    await Promise.all([h.finishArrange(), h.finishArrange()]);
    const after = (await snapshot()).projects;
    check(
      '排序只改顺序不改修订',
      after[0].id === before[1].id &&
        after.every((p) => before.some((b) => b.id === p.id && b.revision === p.revision)),
    );
    check('整理完成恢复查询', h.data.query === '测试' && h.data.tiles.length === 1);
  },
  async pressure(input) {
    await reset();
    const count = input.records || 1000;
    const projectCount = input.projects || 10;
    const tag = ++series;
    const today = dateKey();
    const start = Date.now();
    qa.progress = { phase: '写入隔离压力数据', records: count, projects: projectCount };
    await svc().repository.transaction((db) => {
      db.projects = Array.from({ length: projectCount }, (_, i) => ({
        ...makeProject(
          {
            ...initialForm(),
            id: 'qa_load_' + tag + '_' + i,
            name: '压测' + String(i).padStart(3, '0'),
            quantityEnabled: true,
            defaultTime: '1',
            defaultQuantity: '1',
          },
          Date.now(),
        ),
        quantityUnitLocked: true,
      }));
      db.records = Array.from({ length: count }, (_, i) => ({
        id: 'qa_load_r_' + tag + '_' + i,
        projectId: db.projects[i % projectCount].id,
        occurredOn: moveDay(today, -Math.floor(i / projectCount) % 730),
        localTime: '',
        durationSeconds: 60,
        quantity: 1,
        quantityUnit: '次',
        note: '',
        createdAt: Date.now() + i,
        updatedAt: Date.now() + i,
        revision: 1,
      }));
    });
    const seededMs = Date.now() - start;
    qa.progress = { phase: '首页与搜索压测', records: count, projects: projectCount };
    const h = await home();
    let tick = Date.now();
    await h.load();
    const homeMs = Date.now() - tick;
    await pause(400);
    const viewTiles: any = await new Promise((resolveCount) =>
      h
        .createSelectorQuery()
        .selectAll('.tile')
        .boundingClientRect((items: any) => resolveCount(Array.isArray(items) ? items.length : -1))
        .exec(),
    );
    check(
      '压测首页实际渲染项目数与数据一致',
      viewTiles === projectCount,
      { viewTiles, dataTiles: h.data.tiles.length },
      projectCount,
    );
    const homeTransferCharacters = JSON.stringify({ tiles: h.data.tiles }).length;
    const filters: number[] = [];
    for (let i = 0; i < 20; i++) {
      tick = Date.now();
      h.search({ detail: { value: i % 2 ? '压测' : '不存在' } });
      filters.push(Date.now() - tick);
    }
    h.search({ detail: { value: '' } });
    check(
      '压测首页完整且无错误',
      h.data.tiles.length === projectCount && h.data.error === '',
      { tiles: h.data.tiles.length, error: h.data.error },
      projectCount,
    );
    const db = await snapshot();
    const p = db.projects[0];
    qa.progress = { phase: '详情、分页与图表切换压测', records: count, projects: projectCount };
    tick = Date.now();
    const d = await detail(p);
    const detailMs = Date.now() - tick;
    tick = Date.now();
    d.expand();
    for (let i = 0; i < 24 && d.data.hasMore; i++) d.more();
    const pageMs = Date.now() - tick;
    check(
      '分页加载无重复',
      new Set(d.data.records.map((r: any) => r.id)).size === d.data.records.length,
      { loaded: d.data.records.length },
    );
    d.collapse();
    check('收起恢复5条预览', d.data.records.length <= 5);
    for (let i = 0; i < 120; i++)
      d.mode({
        currentTarget: { dataset: { mode: ['cumulative', 'distribution', 'calendar'][i % 3] } },
      });
    await pause(600);
    check('120次图表切换后页面仍可用', !d.data.error && d.data.project.id === p.id, {
      error: d.data.error,
      mode: d.data.chartMode,
    });
    return {
      records: count,
      projects: projectCount,
      seededMs,
      homeJsMs: homeMs,
      detailNavigationAndLoadMs: detailMs,
      searchJsMaxMs: Math.max(...filters),
      searchJsAverageMs: filters.reduce((a, b) => a + b, 0) / filters.length,
      paginationJsMs: pageMs,
      viewTiles,
      homeTransferCharacters,
      projectHistory: db.records.filter((r) => r.projectId === p.id).length,
    };
  },
  async fuzz(input) {
    const p = await seed();
    const s = await sheet(p);
    const count = input.count || 1000;
    let value = 0x1234;
    let exceptions = 0;
    const bad = [
      '-0',
      '-999',
      '+1',
      '0x10',
      '1e309',
      '1e3',
      'NaN',
      'Infinity',
      '1..2',
      '１',
      '١',
      '999999999999999999',
      '\u0000',
      '\n',
      '<script>',
      '\u202e99',
    ];
    for (let i = 0; i < count; i++) {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      const raw = bad[value % bad.length];
      try {
        s.exactInput(metricEvent(i % 2, raw));
      } catch {
        exceptions++;
      }
    }
    check('1000次异常输入不抛出未处理异常', exceptions === 0, exceptions, 0);
    check(
      '异常输入不污染正整数候选',
      s.data.fields.every((f: any) => Number.isSafeInteger(f.canonical) && f.canonical > 0) &&
        s.data.canSave,
    );
    check('异常输入不自动保存', (await snapshot()).records.length === 0);
    s.close();
    await pause();
    return { events: count, seed: '0x1234', exceptions };
  },
  async legacy() {
    const p = await seed();
    await svc().repository.transaction((db) => {
      db.projects[0].name = '旧名称'.repeat(8);
      db.projects[0].timeUnit = '天';
      db.projects[0].quantityUnitLocked = true;
      db.records = [
        {
          id: newId('old'),
          projectId: p.id,
          occurredOn: '2024-02-29',
          localTime: '',
          durationSeconds: 1,
          quantity: null,
          quantityUnit: null,
          note: '旧备注'.repeat(150),
          createdAt: 0,
          updatedAt: 0,
          revision: 1,
        },
      ];
    });
    const db = await snapshot();
    const d = await detail(db.projects[0]);
    check('旧24字项目名完整显示', d.data.project.name.length === 24, d.data.project.name);
    const s = await sheet(db.projects[0], db.records[0]);
    check('旧长备注完整可读', s.data.note.length === 450, s.data.note.length, 450);
    check(
      '历史缺失数量不补默认值',
      s.data.fields[1].canonical === null && s.data.fields[1].disabled,
    );
    s.precise(metricEvent(0));
    s.finishExact(0);
    s.noteInput({ detail: { value: '只改备注' } });
    await s.save();
    const saved = (await snapshot()).records[0];
    check('天单位显示近似值不覆盖历史1秒', saved.durationSeconds === 1, saved.durationSeconds, 1);
    check('历史数量空值仍为空', saved.quantity === null);
    return { originalNoteLength: 450, durationSeconds: saved.durationSeconds };
  },
  async reproUncertain(input) {
    const p = await seed();
    if (input.target === 'record') {
      const record = await svc().quickRecord(p.id);
      const db = await snapshot();
      const s = await sheet(db.projects[0], record);
      s.noteInput({ detail: { value: '修改后' } });
      failManifest(true);
      await s.save();
      restoration?.();
      restoration = null;
      const firstError = s.data.error;
      await s.save();
      check('历史编辑保存回调丢失可原内容重试', !s.data.opened && !s.data.error, {
        firstError,
        retryError: s.data.error,
        opened: s.data.opened,
        persistedNote: (await snapshot()).records[0].note,
      });
      return { target: 'record', firstError, retryError: s.data.error };
    }
    const e = await editor(p);
    e.text(event('name', '改后项目'));
    failManifest(true);
    await e.save();
    restoration?.();
    restoration = null;
    const firstError = e.data.error;
    await e.save();
    if (!e.data.error) await waitPage('pages/home/index');
    check('项目设置保存回调丢失可原内容重试', page().route !== 'pages/project-edit/index', {
      firstError,
      retryError: e.data.error,
      persistedName: (await snapshot()).projects[0].name,
    });
    return { target: 'settings', firstError, retryError: e.data.error };
  },
  /** Capacity checks use real commands; only the legacy extra project bypasses admission to model a prior-version store. */
  async projectCapacity() {
    const p = await seed();
    for (let i = 1; i < 14; i++)
      await svc().saveProject({ ...initialForm(), id: 'qa_capacity_' + i, name: '项目' + i });
    const results = await Promise.allSettled([
      svc().saveProject({ ...initialForm(), id: 'qa_capacity_last', name: '最后名额' }),
      svc().saveProject({ ...initialForm(), id: 'qa_capacity_over', name: '超额项目' }),
    ]);
    check(
      '两个并发创建争夺第15个名额只成功一个',
      results.filter((r) => r.status === 'fulfilled').length === 1 &&
        (await snapshot()).projects.length === 15,
    );
    const h = await home();
    await h.load();
    check('15项目首页显示容量原因', h.data.projectLimitReached && h.data.tiles.length === 15);
    h.search({ detail: { value: '不存在' } });
    check('搜索隐藏卡片不释放名额', h.data.projectLimitReached && h.data.tiles.length === 0);
    h.add();
    await pause();
    check('到达上限不能由首页打开新增', page().route === 'pages/home/index');
    await svc().repository.deleteProject(p.id);
    await h.load();
    check('删除后首页恢复新增', !h.data.projectLimitReached);
    h.clearSearch();
    await svc().saveProject({ ...initialForm(), id: 'qa_capacity_replacement', name: '补回项目' });
    await svc().repository.transaction((db) => {
      db.projects.push(
        makeProject({ ...initialForm(), id: 'qa_legacy_extra', name: '旧项目' }, Date.now()),
      );
    });
    let db = await snapshot();
    const old = db.projects.find((x) => x.id === 'qa_legacy_extra')!;
    await svc().saveProject({ ...projectForm(old), name: '旧项目改名' }, old.revision);
    await svc().quickRecord(old.id);
    await h.load();
    check(
      '旧超额存档完整可读且允许编辑和记录',
      h.data.tiles.length === 16 && (await snapshot()).records.length === 1,
    );
    const e = await editor();
    e.text(event('name', '绕过入口'));
    await e.save();
    db = await snapshot();
    check(
      '直接新增页保存仍被事务拦截且不清理草稿',
      db.projects.length === 16 && Boolean(e.data.error) && db.newProjectDraft?.name === '绕过入口',
      e.data.error,
    );
    wx.disableAlertBeforeUnload();
    await wx.reLaunch({ url: '/pages/home/index' });
    await waitPage('pages/home/index');
  },
  /** These are deliberately late handler calls, not a claim of physical gesture reproduction. */
  async lateEvents() {
    const p = await seed();
    const s = await sheet(p);
    await pause(300);
    s.close();
    await pause(350);
    check(
      '迟到事件前组件已完全退场',
      !s.data.opened && !s.data.mounted && s.data.fields.length === 0,
    );
    for (const method of [
      'slide',
      'settle',
      'exactInput',
      'confirmExact',
      'blurExact',
      'precise',
    ]) {
      try {
        s[method](metricEvent(0, method === 'exactInput' ? '12' : 12));
        check('迟到事件 ' + method, true);
      } catch (error) {
        check('迟到事件 ' + method, false, String(error));
      }
    }
    check('迟到事件不产生记录', (await snapshot()).records.length === 0);
  },
  async finish() {
    await home();
    await page().load();
    return {
      route: page().route,
      error: page().data.error,
      projects: (await snapshot()).projects.length,
      records: (await snapshot()).records.length,
    };
  },
};

export const qa: any = {
  running: false,
  lastResult: null,
  progress: null,
  /** Navigation destroys the originating webview RPC; run from App scope and poll a durable test result instead. */
  start(input: any) {
    if (qa.running) throw new Error('已有测试运行中');
    qa.running = true;
    qa.lastResult = null;
    qa.progress = { phase: '开始场景', case: input.case };
    setTimeout(async () => {
      try {
        qa.lastResult = await qa.run(input);
      } finally {
        qa.running = false;
      }
    }, 300);
    return { started: true, case: input.case };
  },
  status() {
    return { running: qa.running, progress: qa.progress, result: qa.lastResult };
  },
  async run(input: any) {
    const root = (svc().repository as any).files.root;
    if (typeof root !== 'string' || !root.includes('/polaris-qa-'))
      throw new Error('安全边界：拒绝在真实存储运行压测');
    checks.length = 0;
    const started = Date.now();
    try {
      const data = await cases[input.case](input);
      return { case: input.case, elapsedMs: Date.now() - started, checks: [...checks], data };
    } catch (error) {
      return {
        case: input.case,
        elapsedMs: Date.now() - started,
        checks: [...checks],
        exception: String(error),
        stack: (error as Error).stack,
      };
    } finally {
      restoration?.();
      restoration = null;
    }
  },
};
