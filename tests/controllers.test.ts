import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dateKey,
  emptyDatabase,
  initialForm,
  type PracticeRecord,
} from '../miniprogram/domain/model';
import { service } from '../miniprogram/application/service';
import { recordPage } from '../miniprogram/application/query';

/** Runs real page/component controllers against the real repository and a callback-compatible wx file adapter.
 * This checks state/commands only; native layout, keyboard, canvas and gestures still require WeChat.
 */
test('正式页面与面板状态流程', async (t) => {
  const disk = new Map<string, string>();
  let pageOptions: any,
    componentOptions: any,
    modalCalls = 0;
  const api: any = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getFileSystemManager: () => ({
      readFile: (o: any) =>
        disk.has(o.filePath)
          ? o.success({ data: disk.get(o.filePath) })
          : o.fail({ errMsg: 'readFile:fail ' + o.filePath + ' not found' }),
      writeFile: (o: any) => {
        disk.set(o.filePath, o.data);
        o.success({});
      },
      mkdir: (o: any) => o.success({}),
      readdir: (o: any) =>
        o.success({
          files: [
            ...new Set(
              [...disk.keys()]
                .filter((p) => p.startsWith(o.dirPath + '/'))
                .map((p) => p.slice(o.dirPath.length + 1).split('/')[0]),
            ),
          ],
        }),
      unlink: (o: any) => {
        disk.delete(o.filePath);
        o.success({});
      },
    }),
    showModal: async () => {
      modalCalls++;
      return { confirm: true, cancel: false };
    },
    getWindowInfo: () => ({ pixelRatio: 2 }),
    showToast: () => {},
    hideKeyboard: () => {},
    enableAlertBeforeUnload: () => {},
    disableAlertBeforeUnload: () => {},
    navigateBack: () => {},
    navigateTo: () => {},
    reLaunch: () => {},
    pageScrollTo: () => {},
  };
  (globalThis as any).wx = api;
  (globalThis as any).Page = (o: any) => {
    pageOptions = o;
  };
  (globalThis as any).Component = (o: any) => {
    componentOptions = o;
  };
  (globalThis as any).getCurrentPages = () => [];
  const make = (options: any) => {
    const instance: any = {
      ...options,
      data: structuredClone(options.data),
      ...options.methods,
      events: [],
    };
    instance.setData = (patch: any) => {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = instance.data;
        for (const part of parts.slice(0, -1))
          target = target[part] ??= /^\d+$/.test(parts[parts.indexOf(part) + 1]) ? [] : {};
        target[parts.at(-1)!] = value;
      }
    };
    instance.triggerEvent = (name: string, detail: any) => instance.events.push({ name, detail });
    instance.selectComponent = () => ({ open: () => {} });
    return instance;
  };
  const event = (dataset: any = {}, value: any = '') => ({
    currentTarget: { dataset },
    detail: { value },
  });
  const reset = () =>
    service().repository.transaction((db) => {
      Object.assign(db, emptyDatabase());
    });
  await import('../miniprogram/components/record-sheet/index');
  const sheetOptions = componentOptions;
  await import('../miniprogram/pages/project-edit/index');
  const editorOptions = pageOptions;
  await import('../miniprogram/pages/home/index');
  const homeOptions = pageOptions;
  await import('../miniprogram/pages/project-detail/index');
  const detailOptions = pageOptions;
  await t.test('模拟器not found视为文件缺失；真实读写失败可重试', async () => {
    assert.equal((await service().snapshot()).projects.length, 0);
    const { WechatFiles } = await import('../miniprogram/infrastructure/wechat-files');
    const original = api.getFileSystemManager;
    api.getFileSystemManager = () => ({
      readFile: (o: any) => o.fail({ errMsg: 'readFile:fail permission denied' }),
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      await assert.rejects(new WechatFiles().read('manifest-a.json'), /无法读取/);
    } finally {
      console.warn = warn;
      api.getFileSystemManager = original;
    }
  });
  await t.test('新增取消保留非法草稿，重开恢复；成功创建后不被退后台重新写回', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'name' }, '阅读'));
    editor.text(event({ field: 'timeMin' }, ''));
    editor.toggle(event({ field: 'timeEnabled' }, false));
    const before = modalCalls;
    await editor.cancel();
    assert.equal(modalCalls, before);
    const restored = make(editorOptions);
    await restored.onLoad({});
    assert.equal(restored.data.form.name, '阅读');
    assert.equal(restored.data.form.timeMin, '');
    assert.equal(restored.data.form.timeEnabled, false);
    restored.text(event({ field: 'timeMin' }, '1'));
    restored.toggle(event({ field: 'timeEnabled' }, true));
    await restored.save();
    await restored.onHide();
    assert.equal((await service().snapshot()).newProjectDraft, null);
    assert.equal((await service().snapshot()).projects.length, 1);
    editor._created = true;
    await editor.onUnload();
  });
  await t.test('范围只在修改时重算，默认值在结束编辑夹入范围，切换不清空', async () => {
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'timeMin' }, '10'));
    editor.text(event({ field: 'timeMax' }, '21'));
    editor.rangeBlur(event({ kind: 'time' }));
    assert.equal(editor.data.form.defaultTime, '15');
    editor.text(event({ field: 'defaultTime' }, '12'));
    editor.defaultBlur(event({ kind: 'time' }));
    editor.rangeBlur(event({ kind: 'time' }));
    assert.equal(editor.data.form.defaultTime, '12');
    editor.toggle(event({ field: 'timeEnabled' }, false));
    editor.toggle(event({ field: 'timeEnabled' }, true));
    assert.equal(editor.data.form.defaultTime, '12');
    editor.text(event({ field: 'defaultQuantity' }, '200'));
    editor.defaultBlur(event({ kind: 'quantity' }));
    assert.equal(editor.data.form.defaultQuantity, '100');
    await editor.flushDraft();
    editor._created = true;
    await editor.onUnload();
  });
  await t.test('滑动、精确输入与备注不保存；关闭重开丢弃，只有记录写入', async () => {
    await reset();
    const project = await service().saveProject({
      ...initialForm(),
      name: '跳绳',
      quantityEnabled: true,
      quantityMax: '2000',
      defaultQuantity: '1000',
      primaryMetric: 'quantity',
    });
    const sheet = make(sheetOptions);
    sheet.open(project);
    assert.equal(sheet.data.fields[0].metric, 'quantity');
    sheet.slide(event({ index: 0 }, 1001));
    assert.equal(sheet.data.fields[0].canonical, 1001);
    assert.equal((await service().snapshot()).records.length, 0);
    sheet.noteInput(event({}, '临时内容'));
    sheet.toggleDate();
    const count = sheet.data.fields.length;
    sheet.close();
    assert.equal(sheet.data.fields.length, count);
    sheet.afterLeave();
    assert.equal(sheet.data.mounted, false);
    assert.equal(sheet.data.fields.length, 0);
    sheet.open(project);
    assert.equal(sheet.data.note, '');
    assert.equal(sheet.data.dateOpen, false);
    assert.equal(sheet.data.fields[0].canonical, 1000);
    sheet.precise(event({ index: 0 }));
    sheet.exactInput(event({ index: 0 }, '750'));
    assert.equal(sheet.data.fields[0].position, 750);
    await sheet.save();
    const db = await service().snapshot();
    assert.equal(db.records.length, 1);
    assert.equal(db.records[0].quantity, 750);
    assert.equal(sheet.data.opened, false);
  });
  await t.test('非法精确输入保存失败保留面板和ID，修正后只写一次', async () => {
    const project = (await service().snapshot()).projects[0],
      sheet = make(sheetOptions);
    sheet.open(project);
    const id = sheet.data.recordId;
    sheet.precise(event({ index: 0 }));
    sheet.exactInput(event({ index: 0 }, '1.5'));
    await sheet.save();
    assert.equal(sheet.data.opened, true);
    assert.equal(sheet.data.recordId, id);
    assert.match(sheet.data.error, /整数/);
    sheet.exactInput(event({ index: 0 }, '751'));
    await sheet.save();
    assert.equal((await service().snapshot()).records.filter((r) => r.id === id).length, 1);
  });
  await t.test('历史1秒换成分后只改备注仍为1秒；原有空指标不补值', async () => {
    await reset();
    const form = { ...initialForm(), name: '阅读', timeUnit: '秒' as const };
    let p = await service().saveProject(form);
    const old = await service().saveRecord({
      id: 'one_second',
      projectId: p.id,
      occurredOn: dateKey(),
      localTime: '',
      durationSeconds: 1,
      quantity: null,
      note: '',
    });
    p = await service().saveProject({ ...form, timeUnit: '分', quantityEnabled: true }, p.revision);
    const sheet = make(sheetOptions);
    sheet.open(p, old);
    sheet.noteInput(event({}, '只改备注'));
    sheet.toggleDate();
    await sheet.save();
    const row = (await service().snapshot()).records[0];
    assert.equal(row.durationSeconds, 1);
    assert.equal(row.quantity, null);
  });
  await t.test('精确输入完成只更新本次值，非法输入就地保留，保存期间拒绝继续修改', async () => {
    const project = (await service().snapshot()).projects[0],
      sheet = make(sheetOptions);
    sheet.open(project);
    sheet.precise(event({ index: 0 }));
    sheet.exactInput(event({ index: 0 }, '2.5'));
    sheet.confirmExact(event({ index: 0 }));
    assert.equal(sheet.data.fields[0].canonical, 150);
    assert.equal(sheet.data.fields[0].precise, false);
    sheet.precise(event({ index: 0 }));
    sheet.exactInput(event({ index: 0 }, '121'));
    sheet.blurExact(event({ index: 0 }));
    assert.equal(sheet.data.fields[0].precise, true);
    assert.match(sheet.data.fields[0].error, /范围内/);
    assert.equal(sheet.data.fields[0].raw, '121');
    sheet.setData({ busy: true });
    const before = sheet.data.note;
    sheet.noteInput(event({}, '不能覆盖提交中的内容'));
    sheet.exactInput(event({ index: 0 }, '3'));
    assert.equal(sheet.data.note, before);
    assert.equal(sheet.data.fields[0].raw, '121');
    sheet.setData({ busy: false });
    sheet.close();
    sheet.afterLeave();
  });
  await t.test('快速打卡防双击，后续独立操作允许重复记录；搜索保留项目原序', async () => {
    await reset();
    const p = await service().saveProject({
      ...initialForm(),
      name: '阅读',
      directEntryEnabled: true,
    });
    const home = make(homeOptions);
    await home.load();
    await Promise.all([home.record(event({ id: p.id })), home.record(event({ id: p.id }))]);
    assert.equal((await service().snapshot()).records.length, 1);
    home._lastTap = Date.now() - 1000;
    await home.record(event({ id: p.id }));
    assert.equal((await service().snapshot()).records.length, 2);
    home.search(event({}, '阅'));
    assert.equal(home.data.tiles.length, 1);
    await home.load();
    assert.equal(home.data.query, '阅');
    home.search(event({}, '跑步'));
    assert.equal(home.data.tiles.length, 0);
    home.clearSearch();
    assert.equal(home.data.query, '');
    assert.equal(home.data.searchFocus, true);
    assert.equal(home.data.tiles.length, 1);
  });
  await t.test('创建前完成聚焦字段归一化，提交期间拒绝配置变更', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'name' }, '专注'));
    editor.text(event({ field: 'defaultTime' }, '200'));
    const saving = editor.save();
    editor.text(event({ field: 'name' }, '迟到输入'));
    editor.toggle(event({ field: 'quantityEnabled' }, true));
    await saving;
    const db = await service().snapshot();
    assert.equal(db.projects[0].name, '专注');
    assert.equal(db.projects[0].defaultTime, 120);
    assert.equal(db.projects[0].mode, 'duration');
    assert.equal(db.newProjectDraft, null);
  });
  await t.test('126条记录：预览5，展开20，每批20到126无重复，收起和切周期重置', async () => {
    await reset();
    const p = await service().saveProject({
      ...initialForm(),
      name: '跳绳',
      quantityEnabled: true,
      primaryMetric: 'quantity',
    });
    await service().repository.transaction((db) => {
      db.projects[0].quantityUnitLocked = true;
      for (let i = 0; i < 126; i++)
        db.records.push({
          id: 'row_' + String(i).padStart(3, '0'),
          projectId: p.id,
          occurredOn: dateKey(),
          localTime: '',
          durationSeconds: 60,
          quantity: 1,
          quantityUnit: '次',
          note: '',
          createdAt: 100,
          updatedAt: 100,
          revision: 1,
        });
    });
    const detail = make(detailOptions);
    detail.onLoad({ id: p.id });
    await detail.load();
    assert.equal(detail.data.records.length, 5);
    assert.equal(detail.data.metrics[0].id, 'quantity');
    detail.expand();
    assert.equal(detail.data.records.length, 20);
    for (let i = 0; i < 6; i++) detail.onReachBottom();
    assert.equal(detail.data.records.length, 126);
    await detail.load();
    assert.equal(detail.data.records.length, 126);
    assert.equal(new Set(detail.data.records.map((r: any) => r.id)).size, 126);
    assert.equal(detail.data.hasMore, false);
    detail.collapse();
    assert.equal(detail.data.records.length, 5);
    detail.expand();
    detail.period(event({ id: 'day' }));
    assert.equal(detail.data.expanded, false);
    assert.equal(detail.data.records.length, 5);
  });
  await t.test('相同日期和保存时间按明确字符顺序分页，混合大小写ID不丢条', async () => {
    const rows = (await service().snapshot()).records
      .slice(0, 4)
      .map((r, i) => ({ ...r, id: ['A', 'a', '_', '0'][i] }));
    let cursor = null;
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const page = recordPage(rows, rows[0].projectId, cursor, 1);
      ids.push(page.items[0].id);
      cursor = page.cursor;
    }
    assert.equal(new Set(ids).size, 4);
  });
  // Saving refreshes data before the sheet finishes leaving; that refresh must not expose a native canvas early.
  await t.test('历史编辑的画布保持隐藏到面板退场，恢复绘制等待新节点挂载', async () => {
    const detail = make(detailOptions);
    const db = await service().snapshot();
    detail.onLoad({ id: db.projects[0].id });
    await detail.load();
    detail.editRecord(event({ id: db.records[0].id }));
    assert.equal(detail.data.sheetOpen, true);
    await detail.saved();
    assert.equal(detail.data.sheetOpen, true);
    detail.sheetClosed();
    assert.equal(detail.data.sheetOpen, false);

    await import('../miniprogram/components/practice-chart/index');
    const chart = make(componentOptions);
    const ticks: (() => void)[] = [];
    api.nextTick = (callback: () => void) => ticks.push(callback);
    let draws = 0;
    chart.draw = () => draws++;
    chart.observers.obscured.call(chart, true);
    assert.equal(ticks.length, 0);
    chart.observers.obscured.call(chart, false);
    assert.equal(draws, 0);
    ticks.shift()!();
    assert.equal(draws, 1);
  });
  await t.test('图表支持Canvas局部触点与普通触点，点选显示原始秒数，滚动不触发读数', async () => {
    await import('../miniprogram/components/practice-chart/index');
    const chart = make(componentOptions),
      ops: string[] = [];
    const ctx: any = {};
    for (const name of [
      'scale',
      'clearRect',
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
      'fillText',
      'fillRect',
      'arc',
      'fill',
    ])
      ctx[name] = (...args: any[]) => {
        assert.ok(!args.some((value) => typeof value === 'number' && !Number.isFinite(value)));
        ops.push(name);
      };
    const node: any = { getContext: () => ctx };
    chart.createSelectorQuery = () => {
      const query: any = {
        select: () => query,
        fields: () => query,
        boundingClientRect: (callback: any) => {
          callback({ left: 100, width: 300 });
          return query;
        },
        exec: (callback: any) => {
          if (callback) callback([{ node, width: 300, height: 200, left: 100, top: 0 }]);
        },
      };
      return query;
    };
    chart.setData({
      points: [{ label: '11月', description: '2026-11', added: 1, cumulative: 1, records: 1 }],
      mode: 'cumulative',
      unit: '时',
      factor: 3600,
      isTime: true,
      color: '#6745c6',
      baseline: 0,
      empty: false,
    });
    chart.startTouch({ touches: [{ x: 200, y: 80 }] });
    chart.endTouch({ touches: [], changedTouches: [{ x: 200, y: 80 }] });
    assert.match(chart.data.reading, /2026-11/);
    assert.match(chart.data.reading, /1秒/);
    assert.equal(chart.data.selectedIndex, 0);
    assert.ok(ops.includes('arc'));
    chart.setData({ reading: '' });
    chart.startTouch({ touches: [{ clientX: 300, clientY: 80 }] });
    chart.endTouch({ touches: [], changedTouches: [{ clientX: 300, clientY: 80 }] });
    assert.match(chart.data.reading, /1秒/);
    chart.setData({ reading: '' });
    chart.startTouch({ touches: [{ x: 200, y: 80 }] });
    chart.endTouch({ touches: [], changedTouches: [{ x: 200, y: 150 }] });
    assert.equal(chart.data.reading, '');
  });
  await reset();
});
