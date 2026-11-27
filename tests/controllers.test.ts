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
import { projectTile } from '../miniprogram/application/presentation';

/** Runs real page/component controllers against the real repository and a callback-compatible wx file adapter.
 * This checks state/commands only; native layout, keyboard, canvas and gestures still require WeChat.
 */
test('正式页面与面板状态流程', async (t) => {
  const disk = new Map<string, string>();
  let pageOptions: any,
    componentOptions: any,
    modalCalls = 0;
  const scrollCalls: any[] = [];
  // Capture native notifications to distinguish deliberate save-time hints from intrusive typing feedback.
  const toastCalls: any[] = [];
  const api: any = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getFileSystemManager: () => ({
      // Controller tests start without a legacy namespace; filesystem migration has its own failure tests.
      access: (o: any) => o.fail({ errMsg: 'access:fail ENOENT' }),
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
    // Native nextTick waits for the refreshed view; controller tests provide layout explicitly below.
    nextTick: (callback: () => void) => callback(),
    showToast: (options: any) => {
      toastCalls.push(options);
    },
    hideKeyboard: () => {},
    enableAlertBeforeUnload: () => {},
    disableAlertBeforeUnload: () => {},
    navigateBack: () => {},
    navigateTo: () => {},
    reLaunch: () => {},
    pageScrollTo: (options: any) => {
      // Model successful native scrolling so tests can verify focus after the required field becomes visible.
      scrollCalls.push(options);
      options.success?.({});
    },
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
  // Exercise the actual page preparation boundary before resets create an existing, intentionally empty store.
  await t.test('首次首页自动生成三个卡片及统计记录，不显示初始化提示，刷新不重建', async () => {
    const home = make(homeOptions);
    await home.load();
    assert.deepEqual(
      home.data.tiles.map((p: any) => p.name),
      ['阅读', '跳绳', '运动'],
    );
    assert.equal(home.data.loadError, false);
    assert.equal((await service().snapshot()).records.length, 18);
    assert.equal(modalCalls, 0);
    const writes = [...disk];
    await home.load();
    assert.deepEqual([...disk], writes);
  });
  // Model selector responses separately from storage so lifecycle cancellation can invalidate late layout callbacks.
  const feedbackHome = async (projectId: string, delayed = false) => {
    const home = make(homeOptions),
      callbacks: Array<() => void> = [];
    home.createSelectorQuery = () => {
      const query = {
        selectAll: () => query,
        fields: (_options: unknown, callback: (rects: unknown[]) => void) => {
          callbacks.push(() =>
            callback([{ dataset: { id: projectId }, left: 16, top: 180, width: 170, height: 180 }]),
          );
          return query;
        },
        exec: () => {
          if (!delayed) callbacks.at(-1)!();
        },
      };
      return query;
    };
    await home.load();
    return { home, callbacks };
  };
  await t.test('快速打卡按彩纸与Emoji交替，滚动和撤销清理但不回退序列', async () => {
    await reset();
    const project = await service().saveProject({
      ...initialForm(),
      name: '阅读',
      directEntryEnabled: true,
    });
    const oldWindow = api.getWindowInfo;
    api.getWindowInfo = () => ({ windowHeight: 844, windowWidth: 390 });
    const { home } = await feedbackHome(project.id);
    try {
      await home.record(event({ id: project.id }));
      assert.equal((await service().snapshot()).records.length, 1);
      assert.equal(home.data.celebration.papers.length, 56);
      home.onPageScroll({ scrollTop: 10 });
      assert.equal(home.data.celebration, null);
      home._lastTap = 0;
      await home.record(event({ id: project.id }));
      assert.equal((await service().snapshot()).records.length, 2);
      assert.equal(home.data.celebration.kind, 'emoji');
      assert.equal(home.data.celebration.emojis.length, 16);
      assert.equal(home.data.celebration.papers.length, 0);
      await home.undo();
      assert.equal((await service().snapshot()).records.length, 1);
      assert.equal(home.data.celebration, null);
      assert.equal(home._celebrationTimer, null);
      // Undo cancels decoration but does not rewind presentation order or weaken the next success.
      home._lastTap = 0;
      await home.record(event({ id: project.id }));
      assert.equal(home.data.celebration.kind, 'paper');
      assert.equal(home.data.celebration.papers.length, 56);
    } finally {
      home.stopCelebration();
      api.getWindowInfo = oldWindow;
    }
  });
  await t.test('普通记录等待面板离场，编辑和补记过去日期不庆祝', async () => {
    await reset();
    const project = await service().saveProject({ ...initialForm(), name: '阅读' });
    const record = await service().quickRecord(project.id);
    const oldWindow = api.getWindowInfo;
    api.getWindowInfo = () => ({ windowHeight: 844, windowWidth: 390 });
    const { home } = await feedbackHome(project.id);
    try {
      home._sheetOpen = true;
      await home.saved({ detail: { record, editing: false } });
      assert.equal(home.data.celebration, null);
      assert.equal(home._pendingCelebration.id, record.id);
      home.recordClosed();
      assert.equal(home.data.celebration.papers.length, 56);
      // A slow refresh may finish after native leave; that ordering must also start exactly one effect.
      home.stopCelebration();
      home.recordClosed();
      await home.saved({ detail: { record, editing: false } });
      assert.equal(home.data.celebration.kind, 'emoji');
      assert.equal(home.data.celebration.emojis.length, 16);
      assert.equal(home._pendingCelebration, null);
      await home.saved({ detail: { record, editing: true } });
      assert.equal(home.data.celebration, null);
      const past = await service().saveRecord({
        ...record,
        id: 'feedback_past',
        occurredOn: '2026-01-01',
      });
      await home.saved({ detail: { record: past, editing: false } });
      assert.equal(home.data.celebration, null);
      assert.equal(home._pendingCelebration, null);
    } finally {
      home.stopCelebration();
      api.getWindowInfo = oldWindow;
    }
  });
  await t.test('后台与卸载使晚到的测量失效，存储失败不播放成功效果', async () => {
    await reset();
    const project = await service().saveProject({
      ...initialForm(),
      name: '阅读',
      directEntryEnabled: true,
    });
    const record = await service().quickRecord(project.id);
    const oldWindow = api.getWindowInfo;
    api.getWindowInfo = () => ({ windowHeight: 844, windowWidth: 390 });
    const { home, callbacks } = await feedbackHome(project.id, true);
    const originalQuick = service().quickRecord;
    try {
      home.celebrateRecord(record);
      home.onHide();
      callbacks[0]();
      assert.equal(home.data.celebration, null);
      assert.equal(home._celebrationTimer, null);
      // A callback invalidated by backgrounding must not consume the initial paper turn.
      assert.equal(home._celebrationSequence, null);
      home._visible = true;
      home.celebrateRecord(record);
      home.onUnload();
      callbacks[1]();
      assert.equal(home.data.celebration, null);
      assert.equal(home._celebrationSequence, null);
      home._alive = home._visible = true;
      service().quickRecord = async () => {
        throw new Error('storage failed');
      };
      await home.record(event({ id: project.id }));
      assert.equal(home.data.celebration, null);
      assert.equal(home.data.toast, '');
      assert.ok(home.data.error);
      assert.equal((await service().snapshot()).records.length, 1);
      assert.equal(home._celebrationSequence, null);
    } finally {
      service().quickRecord = originalQuick;
      home.stopCelebration();
      api.getWindowInfo = oldWindow;
    }
  });
  // Unsupported units remain editable, but must never reach project persistence or trigger an unrelated error toast.
  await t.test('数量单位不在常用名单时定位单位输入且不创建，改为毫升后才保存', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'name' }, '喝水'));
    editor.toggle(event({ field: 'quantityEnabled' }, true));
    const initialToasts = toastCalls.length;
    editor.text(event({ field: 'quantityUnit' }, '乱填'));
    assert.equal(toastCalls.length, initialToasts);
    await editor.save();
    assert.equal(toastCalls.length, initialToasts + 1);
    assert.deepEqual(toastCalls.at(-1), {
      title: '不是有效单位',
      icon: 'none',
      duration: 1500,
      mask: false,
    });
    assert.equal(editor.data.canSave, false);
    assert.equal(editor.data.focusedField, 'quantityUnit');
    assert.equal(editor.data.error, '');
    assert.equal((await service().snapshot()).projects.length, 0);
    editor.text(event({ field: 'quantityUnit' }, '毫升'));
    await editor.save();
    assert.equal(toastCalls.length, initialToasts + 1);
    assert.equal((await service().snapshot()).projects[0].quantityUnit, '毫升');
    editor.onUnload();
  });
  await t.test(
    '空名称点击创建定位输入而不落库，补齐名称才创建；缺失类型和范围同样定位',
    async () => {
      await reset();
      const editor = make(editorOptions);
      await editor.onLoad({});
      editor.navigationLayout({ detail: { height: 98 } });
      await editor.save();
      assert.equal(scrollCalls.at(-1).selector, '#editor-name');
      assert.equal(scrollCalls.at(-1).offsetTop, -114);
      assert.equal(editor.data.focusedField, 'name');
      assert.equal(editor.data.error, '');
      assert.equal((await service().snapshot()).projects.length, 0);
      editor.text(event({ field: 'name' }, '阅读'));
      editor.toggle(event({ field: 'timeEnabled' }, false));
      await editor.save();
      assert.equal(scrollCalls.at(-1).selector, '#editor-types');
      assert.equal((await service().snapshot()).projects.length, 0);
      editor.toggle(event({ field: 'timeEnabled' }, true));
      editor.text(event({ field: 'timeMin' }, ''));
      await editor.save();
      assert.equal(scrollCalls.at(-1).selector, '#editor-timeMin');
      editor.text(event({ field: 'timeMin' }, '1'));
      await editor.save();
      assert.equal((await service().snapshot()).projects.length, 1);
    },
  );
  // Exercise open, dragging, exact input and persistence so a full caption never leaks into numeric parsing.
  await t.test('分钟小时天在面板和累计中完整显示，数值编辑仍按原单位存整秒', async () => {
    const { factors, timeUnitLabels } = await import('../miniprogram/domain/model');
    for (const unit of ['分', '时', '天'] as const) {
      await reset();
      const p = await service().saveProject({
        ...initialForm(),
        name: '练习',
        timeUnit: unit,
        timeMax: '10',
        defaultTime: '2',
      });
      const sheet = make(sheetOptions);
      sheet.open(p);
      assert.equal(sheet.data.fields[0].unit, timeUnitLabels[unit]);
      assert.equal(sheet.data.fields[0].number, '2');
      sheet.slide(event({ index: 0 }, 3));
      assert.equal(sheet.data.fields[0].number, '3');
      sheet.precise(event({ index: 0 }));
      sheet.exactInput(event({ index: 0 }, '4'));
      sheet.blurExact(event({ index: 0 }));
      assert.equal(sheet.data.fields[0].number, '4');
      assert.equal(sheet.data.fields[0].display, '4' + timeUnitLabels[unit]);
      await sheet.save();
      const db = await service().snapshot();
      assert.equal(db.records[0].durationSeconds, 4 * factors[unit]);
      assert.equal(db.projects[0].timeUnit, unit);
      const detail = make(detailOptions);
      detail.onLoad({ id: p.id });
      await detail.load();
      assert.equal(detail.data.summaries[0].number, '4');
      assert.equal(detail.data.summaries[0].unit, timeUnitLabels[unit]);
    }
    await reset();
  });
  // Submit directly from the focused field: a valid form must not depend on a later native blur event.
  await t.test('创建按钮同步范围中点，未失焦也能一次创建且不重复提交', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'name' }, '阅读'));
    assert.equal(editor.data.canSave, true);
    editor.text(event({ field: 'timeMax' }, '30'));
    assert.equal(editor.data.form.defaultTime, '15');
    assert.equal(editor.data.canSave, true);
    await Promise.all([editor.save(), editor.save()]);
    const db = await service().snapshot();
    assert.equal(db.projects.length, 1);
    assert.equal(db.projects[0].defaultTime, 15);
    assert.equal(db.newProjectDraft, null);
  });
  await t.test('切换小时按365天等价上限适配，不因旧分钟范围误置灰', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'name' }, '健身'));
    editor.text(event({ field: 'timeMax' }, '525600'));
    editor.choose(event({ field: 'timeUnit', value: '时' }));
    assert.equal(editor.data.form.timeMax, '8760');
    assert.equal(editor.data.form.defaultTime, '4380');
    assert.equal(editor.data.canSave, true);
    await editor.save();
    assert.equal((await service().snapshot()).projects[0].timeUnit, '时');
  });
  await t.test('关闭类型保留原始输入，隐藏的未完成配置不阻挡有效类型创建', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'name' }, '阅读'));
    editor.toggle(event({ field: 'quantityEnabled' }, true));
    editor.text(event({ field: 'quantityMin' }, ''));
    editor.text(event({ field: 'quantityUnit' }, ''));
    assert.equal(editor.data.canSave, false);
    editor.toggle(event({ field: 'quantityEnabled' }, false));
    assert.equal(editor.data.canSave, true);
    await editor.cancel();
    const restored = make(editorOptions);
    await restored.onLoad({});
    assert.equal(restored.data.canSave, true);
    restored.toggle(event({ field: 'quantityEnabled' }, true));
    assert.equal(restored.data.form.quantityMin, '');
    assert.equal(restored.data.form.quantityUnit, '');
    assert.equal(restored.data.canSave, false);
    restored.toggle(event({ field: 'quantityEnabled' }, false));
    await restored.save();
    const p = (await service().snapshot()).projects[0];
    assert.equal(p.mode, 'duration');
    assert.equal(p.quantityUnit, '次');
    editor._created = true;
    await editor.onUnload();
  });
  await t.test('按钮与保存使用相同默认值收敛，真正未完成的可见输入仍禁用', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    assert.equal(editor.data.canSave, false);
    editor.text(event({ field: 'name' }, '阅读'));
    editor.text(event({ field: 'defaultTime' }, '200'));
    assert.equal(editor.data.form.defaultTime, '200');
    assert.equal(editor.data.canSave, true);
    editor.text(event({ field: 'defaultTime' }, ''));
    assert.equal(editor.data.canSave, false);
    editor.defaultBlur(event({ kind: 'time' }));
    assert.equal(editor.data.canSave, true);
    editor.text(event({ field: 'timeMin' }, '121'));
    assert.equal(editor.data.canSave, false);
    editor.text(event({ field: 'timeMin' }, '1'));
    editor.toggle(event({ field: 'timeEnabled' }, false));
    assert.equal(editor.data.canSave, false);
    editor.toggle(event({ field: 'timeEnabled' }, true));
    editor.text(event({ field: 'defaultTime' }, '200'));
    await editor.save();
    assert.equal((await service().snapshot()).projects[0].defaultTime, 120);
  });
  // Disabled groups keep valid custom values; an incomplete group falls back only in the submitted copy.
  await t.test('仅数量创建与设置保存共用校验，隐藏时间保留最后保存值且不改历史', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'name' }, '跳绳'));
    editor.text(event({ field: 'defaultTime' }, '35'));
    editor.toggle(event({ field: 'quantityEnabled' }, true));
    editor.toggle(event({ field: 'timeEnabled' }, false));
    editor.text(event({ field: 'quantityMax' }, '30'));
    assert.equal(editor.data.canSave, true);
    await editor.save();
    const p = (await service().snapshot()).projects[0];
    assert.equal(p.mode, 'quantity');
    assert.equal(p.defaultTime, 35);
    assert.equal(p.defaultQuantity, 15);
    const settings = make(editorOptions);
    await settings.onLoad({ id: p.id });
    settings.toggle(event({ field: 'timeEnabled' }, true));
    settings.text(event({ field: 'timeMax' }, ''));
    assert.equal(settings.data.canSave, false);
    settings.toggle(event({ field: 'timeEnabled' }, false));
    assert.equal(settings.data.form.timeMax, '');
    assert.equal(settings.data.canSave, true);
    await settings.save();
    const db = await service().snapshot();
    assert.equal(db.projects[0].timeMax, p.timeMax);
    assert.equal(db.projects[0].defaultTime, 35);
    assert.equal(db.records.length, 0);
  });
  await t.test('创建失败恢复按钮并保留原始草稿，重试沿用标识且仅生成一次', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'name' }, '阅读'));
    editor.text(event({ field: 'defaultTime' }, '200'));
    const id = editor.data.form.id,
      api = service(),
      save = api.saveProject;
    // Inject at the command boundary so the page's failure/retry path uses the real draft repository.
    api.saveProject = () => Promise.reject(new Error('本地写入失败'));
    try {
      await editor.save();
      assert.equal(editor.data.busy, false);
      assert.equal(editor.data.canSave, true);
      assert.equal(editor.data.form.defaultTime, '200');
      assert.match(editor.data.error, /本地写入失败/);
      assert.equal((await service().snapshot()).projects.length, 0);
    } finally {
      api.saveProject = save;
    }
    await Promise.all([editor.save(), editor.save()]);
    const db = await service().snapshot();
    assert.equal(db.projects.length, 1);
    assert.equal(db.projects[0].id, id);
    assert.equal(db.projects[0].defaultTime, 120);
    assert.equal(db.newProjectDraft, null);
  });
  // Controller coverage protects draft retention and deliberate chart-scope resets after settings changes.
  await t.test('频率配置保留草稿且详情随频率初始化，普通刷新保留手动周期', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    assert.equal(editor.data.form.frequency, 'day');
    editor.text(event({ field: 'name' }, '加油'));
    editor.choose(event({ field: 'frequency', value: 'week' }));
    await editor.cancel();
    const restored = make(editorOptions);
    await restored.onLoad({});
    assert.equal(restored.data.form.frequency, 'week');
    restored.choose(event({ field: 'frequency', value: 'year' }));
    assert.equal(restored.data.form.frequency, 'week');
    await restored.save();
    const p = (await service().snapshot()).projects[0];
    assert.equal(p.frequency, 'week');
    const detail = make(detailOptions);
    detail.onLoad({ id: p.id });
    await detail.load();
    assert.equal(detail.data.period, 'week');
    assert.equal(detail.data.frequencyLabel, '每周');
    detail.period(event({ id: 'year' }));
    detail.previous();
    await detail.load();
    assert.equal(detail.data.period, 'year');
    assert.equal(detail.data.offset, -1);
    const settings = make(editorOptions);
    await settings.onLoad({ id: p.id });
    settings.choose(event({ field: 'frequency', value: 'month' }));
    await settings.save();
    detail.expand();
    await detail.load();
    assert.equal(detail.data.period, 'month');
    assert.equal(detail.data.frequencyLabel, '每月');
    assert.equal(detail.data.offset, 0);
    assert.equal(detail.data.expanded, false);
    await reset();
  });
  // Actual controllers share the ordered options and keep canonical seconds during day-unit history edits.
  await t.test('时间单位按分时天排列，天输入扩展与旧秒历史编辑不丢精度', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    assert.deepEqual(editor.data.units, ['分', '时', '天']);
    editor.text(event({ field: 'name' }, '学习'));
    editor.choose(event({ field: 'timeUnit', value: '秒' }));
    assert.equal(editor.data.form.timeUnit, '分');
    editor.choose(event({ field: 'timeUnit', value: '天' }));
    editor.text(event({ field: 'timeMax' }, '10'));
    editor.text(event({ field: 'defaultTime' }, '2'));
    await editor.save();
    let p = (await service().snapshot()).projects[0];
    const sheet = make(sheetOptions);
    sheet.open(p);
    assert.equal(sheet.data.fields[0].unit, '天');
    assert.equal(sheet.data.fields[0].limit, 365);
    sheet.precise(event({ index: 0 }));
    sheet.exactInput(event({ index: 0 }, '365'));
    sheet.exactInput(event({ index: 0 }, '366'));
    assert.equal(sheet.data.fields[0].raw, '365');
    await sheet.save();
    let db = await service().snapshot();
    assert.equal(db.records[0].durationSeconds, 31536000);
    assert.equal(db.projects[0].timeMax, 365);
    p = db.projects[0];
    // Recreate a saved legacy value below the current day range; a new entry must still respect that range.
    const tiny: PracticeRecord = {
      id: 'tiny_day_history',
      projectId: p.id,
      occurredOn: dateKey(),
      localTime: '',
      durationSeconds: 1,
      quantity: null,
      quantityUnit: null,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      revision: 1,
    };
    await service().repository.transaction((stored) => {
      stored.records.push(tiny);
    });
    sheet.open(p, tiny);
    assert.equal(sheet.data.fields[0].number, '≈0.00001157');
    sheet.noteInput(event({}, '保留原秒数'));
    await sheet.save();
    db = await service().snapshot();
    assert.equal(db.records.find((r) => r.id === tiny.id)?.durationSeconds, 1);
    await reset();
  });
  await t.test('模拟器not found视为文件缺失；真实读写失败可重试', async () => {
    assert.equal((await service().snapshot()).projects.length, 0);
    const { WechatFiles } = await import('../miniprogram/infrastructure/wechat-files');
    const original = api.getFileSystemManager;
    api.getFileSystemManager = () => ({
      access: (o: any) => o.fail({ errMsg: 'access:fail ENOENT' }),
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
  await t.test('更多外观仅改变视图，扩展选择收起可见、取消恢复、创建保存', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    const before = JSON.stringify(editor.data.form);
    editor.toggleAppearance();
    assert.equal(JSON.stringify(editor.data.form), before);
    assert.equal(editor._timer, 0);
    assert.equal(editor.data.colors.length, 10);
    assert.equal(editor.data.icons.length, 15);
    editor.choose(event({ field: 'color', value: 'brown' }));
    editor.choose(event({ field: 'icon', value: 'art' }));
    editor.toggleAppearance();
    assert.equal(editor.data.colors[4].id, 'brown');
    assert.equal(editor.data.icons[4].id, 'art');
    editor.choose(event({ field: 'icon', value: '../escape' }));
    assert.equal(editor.data.form.icon, 'art');
    await editor.cancel();
    const restored = make(editorOptions);
    await restored.onLoad({});
    assert.equal(restored.data.appearanceExpanded, false);
    assert.equal(restored.data.form.color, 'brown');
    assert.equal(restored.data.icons[4].id, 'art');
    restored.text(event({ field: 'name' }, '绘画'));
    await restored.save();
    const project = (await service().snapshot()).projects[0];
    assert.equal(project.icon, 'art');
    const settings = make(editorOptions);
    await settings.onLoad({ id: project.id });
    settings.toggleAppearance();
    assert.equal(JSON.stringify(settings.data.form), settings._initial);
    assert.equal((await service().snapshot()).newProjectDraft, null);
    await settings.cancel();
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
  await t.test('非法字符静默拒绝，未完成输入禁用保存，修正后只写一次', async () => {
    const project = (await service().snapshot()).projects[0],
      sheet = make(sheetOptions);
    sheet.open(project);
    const id = sheet.data.recordId;
    sheet.precise(event({ index: 0 }));
    const initial = sheet.data.fields[0].raw;
    sheet.exactInput(event({ index: 0 }, '1.5'));
    assert.equal(sheet.data.fields[0].raw, initial);
    assert.equal(sheet.data.error, '');
    assert.equal(sheet.data.canSave, true);
    sheet.exactInput(event({ index: 0 }, ''));
    assert.equal(sheet.data.canSave, false);
    await sheet.save();
    assert.equal(sheet.data.opened, true);
    assert.equal(sheet.data.recordId, id);
    assert.equal(sheet.data.error, '');
    sheet.exactInput(event({ index: 0 }, '751'));
    await sheet.save();
    assert.equal((await service().snapshot()).records.filter((r) => r.id === id).length, 1);
  });
  await t.test('历史1秒换成分后只改备注仍为1秒；原有空指标不补值', async () => {
    await reset();
    const form = { ...initialForm(), name: '阅读', timeUnit: '分' as const };
    let p = await service().saveProject(form);
    // Seed a pre-option-removal project through storage, never through the new-project command boundary.
    await service().repository.transaction((db) => {
      db.projects[0].timeUnit = '秒';
    });
    p = (await service().snapshot()).projects[0];
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
  await t.test('原位输入和失焦只更新本次草稿，越界可展开滑块，保存期间拒绝继续修改', async () => {
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
    assert.equal(sheet.data.fields[0].precise, false);
    assert.equal(sheet.data.fields[0].max, 121);
    assert.equal(sheet.data.error, '');
    assert.equal(sheet.data.canSave, true);
    assert.equal((await service().snapshot()).projects[0].timeMax, 120);
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
  await t.test('1–30输入35：关闭不改配置，记录后下次面板和项目设置都使用35', async () => {
    await reset();
    const project = await service().saveProject({
      ...initialForm(),
      name: '阅读',
      timeMax: '30',
      defaultTime: '15',
    });
    const sheet = make(sheetOptions);
    sheet.open(project);
    sheet.precise(event({ index: 0 }));
    sheet.exactInput(event({ index: 0 }, '35'));
    sheet.blurExact(event({ index: 0 }));
    assert.equal(sheet.data.fields[0].max, 35);
    assert.equal(sheet.data.fields[0].canonical, 2100);
    assert.equal((await service().snapshot()).projects[0].timeMax, 30);
    sheet.close();
    sheet.afterLeave();
    sheet.open(project);
    assert.equal(sheet.data.fields[0].raw, '15');
    // Save while the input still owns focus; no intermediate Done/blur action is required.
    sheet.precise(event({ index: 0 }));
    sheet.exactInput(event({ index: 0 }, '40'));
    sheet.slide(event({ index: 0 }, 35));
    await sheet.save();
    const db = await service().snapshot();
    assert.equal(db.records[0].durationSeconds, 2100);
    assert.equal(db.projects[0].timeMax, 35);
    assert.equal(db.projects[0].defaultTime, 35);
    sheet.afterLeave();
    sheet.open(db.projects[0]);
    assert.equal(sheet.data.fields[0].raw, '35');
    assert.equal(sheet.data.fields[0].max, 35);
    const editor = make(editorOptions);
    await editor.onLoad({ id: project.id });
    assert.equal(editor.data.form.timeMax, '35');
    assert.equal(editor.data.form.defaultTime, '35');
  });
  await t.test('长按整理屏蔽打卡，拖动仅暂存，完成后保存并恢复搜索', async () => {
    await reset();
    const first = await service().saveProject({
      ...initialForm(),
      name: '阅读',
      directEntryEnabled: true,
    });
    const second = await service().saveProject({ ...initialForm(), name: '练琴' });
    const home = make(homeOptions);
    await home.load();
    home.search(event({}, '阅'));
    home.enterArrange();
    assert.equal(home.data.arranging, true);
    assert.equal(home.data.tiles.length, 2);
    assert.equal(home.data.query, '阅');
    await home.record(event({ id: first.id }));
    assert.equal((await service().snapshot()).records.length, 0);
    home._drag = {
      id: first.id,
      startX: 50,
      startY: 100,
      x: 210,
      y: 100,
      scroll: 0,
      target: 0,
      slots: [
        { left: 0, top: 50, width: 140, height: 140 },
        { left: 152, top: 50, width: 140, height: 140 },
      ],
    };
    home.previewDrag();
    // The real insertion target lives in gesture state; the view only needs the resulting transforms and hole.
    assert.equal(home._orderIds[home._drag.target], second.id);
    assert.match(home.data.shiftStyles[second.id], /translate\(-152px,0px\)/);
    assert.match(home.data.placeholderStyle, /left:152px/);
    home.dragEnd();
    assert.equal(home.data.settling, true);
    assert.deepEqual(home._orderIds, [second.id, first.id]);
    assert.deepEqual(
      (await service().snapshot()).projects.map((p) => p.id),
      [first.id, second.id],
    );
    // A render must never clear preview offsets while cards still occupy their previous slots.
    const patches: any[] = [];
    const applyData = home.setData;
    home.setData = (patch: any) => {
      patches.push(structuredClone(patch));
      applyData(patch);
    };
    const phaseBefore = structuredClone(home.data.motionDelays);
    home.cancelDrag();
    const landing = patches.find((patch) => patch.settling === false);
    assert.deepEqual(
      landing.tiles.map((tile: any) => tile.id),
      [second.id, first.id],
    );
    assert.equal(landing.shiftStyles[second.id], 'transition:none;');
    assert.deepEqual(home.data.motionDelays, phaseBefore);
    home.setData = applyData;
    await home.finishArrange();
    assert.equal(home.data.arranging, false);
    assert.deepEqual(
      (await service().snapshot()).projects.map((p) => p.id),
      [second.id, first.id],
    );
    assert.equal(home.data.tiles.length, 1);
    assert.equal(home.data.query, '阅');
    home.enterArrange();
    home._orderIds.reverse();
    home.onHide();
    await home.load();
    assert.deepEqual(
      (await service().snapshot()).projects.map((p) => p.id),
      [second.id, first.id],
    );
  });
  await t.test('整理空白点击放弃排序并恢复查询，卡片和拖动收尾不误退出', async () => {
    await reset();
    const first = await service().saveProject({ ...initialForm(), name: '阅读' });
    const second = await service().saveProject({ ...initialForm(), name: '运动' });
    const removed = await service().saveProject({ ...initialForm(), name: '跳绳' });
    const home = make(homeOptions);
    await home.load();
    home.search(event({}, '阅'));
    home.enterArrange();
    home._suppressTapUntil = 0;
    home._orderIds.reverse();
    const blank = { target: { dataset: { arrangeBlank: true } } };
    home.cancelArrange({ target: { dataset: {} } });
    assert.equal(home.data.arranging, true);
    for (const patch of [{ arrangeSaving: true }, { draggingId: first.id }, { settling: true }]) {
      home.setData(patch);
      home.cancelArrange(blank);
      assert.equal(home.data.arranging, true);
      home.setData({ arrangeSaving: false, draggingId: '', settling: false });
    }
    // A deletion committed before cancellation is not part of the reversible sorting draft.
    await service().repository.deleteProject(removed.id);
    await home.load();
    home.cancelArrange(blank);
    assert.equal(home.data.arranging, false);
    assert.equal(home.data.query, '阅');
    assert.deepEqual(
      home.data.tiles.map((tile: any) => tile.id),
      [first.id],
    );
    const db = await service().snapshot();
    assert.deepEqual(
      db.projects.map((project) => project.id),
      [first.id, second.id],
    );
    assert.equal(db.projects[0].revision, first.revision);
    home.enterArrange();
    assert.deepEqual(home._orderIds, [first.id, second.id]);
    home.onHide();
  });
  await t.test('整理删除先确认，取消不变，确认后清理记录且不退出整理', async () => {
    await reset();
    const project = await service().saveProject({
      ...initialForm(),
      name: '阅读',
      directEntryEnabled: true,
    });
    await service().quickRecord(project.id);
    const home = make(homeOptions);
    await home.load();
    home.enterArrange();
    const originalModal = api.showModal;
    let content = '';
    api.showModal = async (options: any) => {
      content = options.content;
      return { confirm: false, cancel: true };
    };
    await home.removeCard(event({ id: project.id }));
    assert.match(content, /1 条记录/);
    assert.equal((await service().snapshot()).projects.length, 1);
    assert.equal((await service().snapshot()).records.length, 1);
    api.showModal = originalModal;
    await home.removeCard(event({ id: project.id }));
    const db = await service().snapshot();
    assert.equal(db.projects.length, 0);
    assert.equal(db.records.length, 0);
    assert.equal(db.undo, null);
    assert.equal(home.data.arranging, true);
    assert.equal(home.data.tiles.length, 0);
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
  await t.test('日历选日、切指标、全历史和刷新后重聚合保持一致', async () => {
    await reset();
    const p = await service().saveProject({
      ...initialForm(),
      name: '日历',
      quantityEnabled: true,
      primaryMetric: 'quantity',
    });
    const today = dateKey();
    await service().repository.transaction((db) => {
      // Seeded historical quantity records obey the same unit lock as successful real submissions.
      db.projects[0].quantityUnitLocked = true;
      db.records.push({
        id: 'heat-a',
        projectId: p.id,
        occurredOn: today,
        localTime: '',
        durationSeconds: 60,
        quantity: 1000,
        quantityUnit: '次',
        note: '',
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      });
      db.records.push({ ...db.records[0], id: 'heat-b', quantity: 500 });
    });
    const detail = make(detailOptions);
    detail.onLoad({ id: p.id });
    await detail.load();
    const originalPeriod = detail.data.period;
    detail.mode(event({ mode: 'calendar' }));
    assert.equal(detail.data.calendarCells.length, 42);
    assert.equal(detail.data.calendarReading, '');
    detail.calendarDay(event({ date: today }));
    assert.match(detail.data.calendarReading, /1,500次 · 2条/);
    assert.equal(detail.data.records.length, 2);
    const future = detail.data.calendarCells.find((cell: any) => cell.future);
    detail.calendarDay(event({ date: future.date }));
    assert.equal(detail.data.calendarDate, today);
    detail.metric(event({ id: 'durationSeconds' }));
    assert.equal(detail.data.calendarDate, '');
    detail.calendarDay(event({ date: today }));
    assert.match(detail.data.calendarReading, /2分钟 · 2条/);
    await service().deleteRecord('heat-b', 1);
    await detail.deleted();
    assert.match(detail.data.calendarReading, /1分钟 · 1条/);
    await detail.undo();
    assert.match(detail.data.calendarReading, /2分钟 · 2条/);
    detail.expand();
    assert.equal(detail.data.calendarDate, '');
    assert.equal(detail.data.calendarReading, '');
    detail.mode(event({ mode: 'cumulative' }));
    assert.equal(detail.data.period, originalPeriod);
    assert.equal(detail.data.expanded, false);
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
  await t.test('编辑面板删除可取消、过期版本不覆盖，删除后能够从详情撤销', async () => {
    await reset();
    const project = await service().saveProject({ ...initialForm(), name: '阅读' });
    const original = await service().quickRecord(project.id, 'sheet_delete_record');
    const sheet = make(sheetOptions);
    sheet.open(project, original);
    const confirm = api.showModal;
    try {
      // Cancellation must preserve the editing session and its original persisted record.
      api.showModal = async () => ({ confirm: false });
      await sheet.removeRecord();
      assert.equal(sheet.data.opened, true);
      assert.equal((await service().snapshot()).records.length, 1);
      api.showModal = confirm;
      const revised = await service().saveRecord(
        { ...original, note: '另一处已修改' },
        original.revision,
      );
      await sheet.removeRecord();
      assert.equal(sheet.data.opened, true);
      assert.ok(sheet.data.error);
      assert.equal((await service().snapshot()).records[0].note, '另一处已修改');
      sheet.open(project, revised);
      await sheet.removeRecord();
      assert.equal(sheet.data.opened, false);
      assert.ok(sheet.events.some((event: any) => event.name === 'deleted'));
      assert.equal((await service().snapshot()).records.length, 0);
      const detail = make(detailOptions);
      detail.onLoad({ id: project.id });
      await detail.deleted();
      assert.equal(detail.data.historyCount, 0);
      assert.ok(detail.data.expiresAt > Date.now());
      await detail.undo();
      assert.equal(detail.data.historyCount, 1);
      assert.equal((await service().snapshot()).records[0].note, '另一处已修改');
    } finally {
      api.showModal = confirm;
    }
  });
  await t.test('图表支持Canvas局部触点与普通触点，点选显示原始秒数，滚动不触发读数', async () => {
    await import('../miniprogram/components/practice-chart/index');
    const chart = make(componentOptions),
      ops: string[] = [];
    const ctx: any = {};
    for (const name of [
      'scale',
      'translate',
      'clearRect',
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
      'fillText',
      'fillRect',
      'arc',
      'fill',
      'closePath',
      'quadraticCurveTo',
    ])
      ctx[name] = (...args: any[]) => {
        assert.ok(!args.some((value) => typeof value === 'number' && !Number.isFinite(value)));
        ops.push(name);
      };
    const node: any = {
      getContext: () => ctx,
      toDataURL: () => 'data:image/png;base64,rendered-plot',
    };
    chart.createSelectorQuery = () => {
      const query: any = {
        select: () => query,
        fields: () => query,
        boundingClientRect: (callback: any) => {
          if (callback) callback({ left: 100, width: 300 });
          return query;
        },
        exec: (callback: any) => {
          if (callback) callback([{ node }, { width: 300, height: 200, left: 100, top: 0 }]);
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
    // The displayed plot must stay an ordinary image so native Canvas pixels cannot cover the navigation during scrolling.
    assert.equal(chart.data.imageSrc, 'data:image/png;base64,rendered-plot');
    assert.equal(node.width, 600);
    assert.equal(node.height, 400);
    chart.setData({ reading: '' });
    chart.startTouch({ touches: [{ clientX: 300, clientY: 80 }] });
    chart.endTouch({ touches: [], changedTouches: [{ clientX: 300, clientY: 80 }] });
    assert.match(chart.data.reading, /1秒/);
    chart.setData({ reading: '' });
    chart.startTouch({ touches: [{ x: 200, y: 80 }] });
    chart.endTouch({ touches: [], changedTouches: [{ x: 200, y: 150 }] });
    assert.equal(chart.data.reading, '');
    // The first actual month owns the first drawable/selectable point, including its real cumulative amount.
    const months = [
      { label: '2026-06', description: '2026-06', added: 100, cumulative: 100, records: 1 },
      { label: '2026-07', description: '2026-07', added: 0, cumulative: 100, records: 0 },
      { label: '2026-08', description: '2026-08', added: 200, cumulative: 300, records: 1 },
    ];
    chart.setData({ points: months, isTime: false, unit: '次', factor: 1, baseline: 0 });
    chart.draw();
    assert.deepEqual(chart.plottedPoints(), months);
    chart.startTouch({ touches: [{ x: 40, y: 80 }] });
    chart.endTouch({ touches: [], changedTouches: [{ x: 40, y: 80 }] });
    assert.equal(chart.data.selectedIndex, 0);
    assert.equal(chart.data.reading, '2026-06 · 累计100次');
    // Empty periods can still show a genuine prior-period baseline without inventing a record.
    chart.setData({ points: [], baseline: 3600, focusBaseline: true });
    chart.draw();
    assert.equal(chart.data.empty, false);
    assert.equal(chart.data.points.length, 0);
    assert.equal(chart.plottedPoints().length, 1);
    assert.equal(chart.plottedPoints()[0].cumulative, 3600);
    chart.setData({ mode: 'distribution' });
    chart.draw();
    assert.equal(chart.data.empty, true);
  });
  await t.test('输入现场限制长度、负数与上限，切换单位不清空配置，备注和搜索同步限制', async () => {
    await reset();
    const editor = make(editorOptions);
    await editor.onLoad({});
    editor.text(event({ field: 'name' }, '一二三四五六'));
    editor.text(event({ field: 'name' }, '一新二三四五六'));
    assert.equal(editor.data.form.name, '一二三四五六');
    editor.text(event({ field: 'quantityUnit' }, '超长四字'));
    editor.text(event({ field: 'quantityUnit' }, '超新长四字'));
    assert.equal(editor.data.form.quantityUnit, '超长四字');
    editor.text(event({ field: 'quantityMax' }, '-5'));
    assert.equal(editor.data.form.quantityMax, '100');
    editor.text(event({ field: 'quantityMax' }, '100000'));
    assert.equal(editor.data.form.quantityMax, '100');
    editor.choose(event({ field: 'timeUnit', value: '时' }));
    assert.equal(editor.data.form.timeMax, '120');
    assert.equal(editor.data.error, '');
    assert.equal(editor.data.canSave, true);
    editor.choose(event({ field: 'timeUnit', value: '分' }));
    assert.equal(editor.data.form.timeMax, '120');
    editor.text(event({ field: 'timeMax' }, '525601'));
    assert.equal(editor.data.form.timeMax, '120');
    editor.toggle(event({ field: 'quantityEnabled' }, true));
    // The earlier length-limit probe is intentionally unsupported; choose a real unit before testing record input.
    editor.text(event({ field: 'quantityUnit' }, '次'));
    await editor.save();
    const project = (await service().snapshot()).projects[0];
    const sheet = make(sheetOptions);
    sheet.open(project);
    sheet.precise(event({ index: 1 }));
    const initial = sheet.data.fields[1].raw;
    sheet.exactInput(event({ index: 1 }, '-5'));
    assert.equal(sheet.data.fields[1].raw, initial);
    assert.equal(sheet.data.error, '');
    assert.equal(sheet.data.canSave, true);
    sheet.exactInput(event({ index: 1 }, ''));
    await sheet.save();
    assert.equal((await service().snapshot()).records.length, 0);
    sheet.exactInput(event({ index: 1 }, '99999'));
    sheet.exactInput(event({ index: 1 }, '100000'));
    assert.equal(sheet.data.fields[1].raw, '99999');
    assert.equal(sheet.data.error, '');
    assert.equal(sheet.data.canSave, true);
    assert.equal((await service().snapshot()).records.length, 0);
    sheet.exactInput(event({ index: 1 }, '99999'));
    sheet.noteInput(event({}, '😀'.repeat(100)));
    // Reject over-limit edits as a whole so an insertion cannot remove an existing suffix.
    assert.equal(sheet.noteInput(event({}, '😀'.repeat(101))), '😀'.repeat(100));
    assert.equal(Array.from(sheet.data.note).length, 100);
    assert.equal(sheet.data.noteCount, 100);
    sheet.noteInput(event({}, 'a\nb\nc'));
    assert.equal(sheet.noteInput(event({}, 'a\n\nb\nc')), 'a\nb\nc');
    assert.equal(sheet.data.note, 'a\nb\nc');
    assert.equal(sheet.data.noteCount, 5);
    sheet.noteInput(event({}, 'a\nb\n改c'));
    assert.equal(sheet.data.note, 'a\nb\n改c');
    await sheet.save();
    assert.equal((await service().snapshot()).records[0].quantity, 99999);
    const home = make(homeOptions);
    await home.load();
    home.search(event({}, '字'.repeat(30)));
    assert.equal(home.data.query.length, 20);
    // A previous long note remains editable without losing hundreds of characters after one Backspace.
    sheet.afterLeave();
    sheet.open(project, { ...(await service().snapshot()).records[0], note: '字'.repeat(500) });
    sheet.noteInput(event({}, '字'.repeat(499)));
    assert.equal(sheet.data.note.length, 499);
    sheet.close();
    sheet.afterLeave();
  });
  // Exit animation retains content, but it cannot retain permission to start a new write.
  await t.test('关闭期间拒绝新保存，卸载后迟到滑块不抛错，重开仍可保存', async () => {
    await reset();
    const project = await service().saveProject({ ...initialForm(), name: '边界测试' });
    const sheet = make(sheetOptions);
    sheet.open(project);
    sheet.close();
    await sheet.save();
    assert.equal((await service().snapshot()).records.length, 0);
    sheet.afterLeave();
    assert.doesNotThrow(() => sheet.settle(event({ index: 0 }, 12)));
    sheet.open(project);
    sheet.settle(event({ index: 0 }, 12));
    await sheet.save();
    assert.equal((await service().snapshot()).records[0].durationSeconds, 720);
  });
  // Cached search must still reflect a new snapshot after recording, and ordinary navigation must not resend every card.
  await t.test('首页搜索复用派生数据但新记录立即更新，普通隐藏不重传卡片', async () => {
    await reset();
    const first = await service().saveProject({ ...initialForm(), name: '阅读' });
    const second = await service().saveProject({ ...initialForm(), name: '运动' });
    const home = make(homeOptions);
    await home.load();
    home.search(event({}, '阅读'));
    assert.deepEqual(
      home.data.tiles.map((tile: any) => tile.id),
      [first.id],
    );
    await service().quickRecord(first.id);
    await home.load();
    const db = await service().snapshot();
    assert.deepEqual(home.data.tiles[0], projectTile(db.projects[0], db.records));
    home.clearSearch();
    assert.deepEqual(
      home.data.tiles.map((tile: any) => tile.id),
      [first.id, second.id],
    );
    const patches: any[] = [];
    const setData = home.setData;
    home.setData = (patch: any) => {
      patches.push(patch);
      setData(patch);
    };
    home.onHide();
    assert.equal(
      patches.some((patch) => 'tiles' in patch),
      false,
    );
  });
  await reset();
});
