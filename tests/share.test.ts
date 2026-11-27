import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderShareImage } from '../miniprogram/application/share-render';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyDatabase,
  initialForm,
  makeProject,
  type PracticeRecord,
} from '../miniprogram/domain/model';
import {
  beginShare,
  shareSnapshot,
  shareSourceVersion,
  takeShare,
} from '../miniprogram/application/share-snapshot';
import {
  versionAtLeast,
  imageShareCapabilities,
  saveShareImage,
  shareImage,
  ownShareImage,
  releaseShareImage,
} from '../miniprogram/application/share-platform';
import { drawPoster } from '../miniprogram/application/share-poster';
import { calendarHeatmap } from '../miniprogram/domain/calendar-heatmap';
import { visibleCalendarWeeks } from '../miniprogram/application/calendar-presentation';

test('日历四五六周展示保留完整月份与未来日期，不修改42格统计快照', () => {
  for (const [today, expected] of [
    ['2021-02-15', 4],
    ['2026-06-20', 5],
    ['2026-08-20', 6],
  ] as const) {
    const heat = calendarHeatmap([], 'quantity', 0, today),
      before = JSON.stringify(heat);
    const visible = visibleCalendarWeeks(heat.cells);
    assert.equal(visible.rows, expected);
    assert.equal(visible.cells.length, expected * 7);
    assert.equal(
      visible.cells.filter((c) => c.inside).length,
      heat.cells.filter((c) => c.inside).length,
    );
    assert.ok(visible.cells.some((c) => c.inside && c.future));
    assert.ok(visible.cells.slice(-7).some((c) => c.inside));
    assert.equal(JSON.stringify(heat), before);
  }
});

/** Fixtures use persisted contracts, with dates chosen around a month boundary to expose baseline mistakes. */
function fixture() {
  const db = emptyDatabase();
  const p = makeProject(
    { ...initialForm(), name: '阅读', quantityEnabled: true, quantityUnit: '页' },
    1,
  );
  const record = (
    id: string,
    day: string,
    seconds: number | null,
    quantity: number | null,
  ): PracticeRecord => ({
    id,
    projectId: p.id,
    occurredOn: day,
    localTime: '',
    durationSeconds: seconds,
    quantity,
    quantityUnit: quantity == null ? null : '页',
    note: '<script>literal</script>\n读完一章',
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
  });
  db.projects = [p];
  db.records = [
    record('before', '2026-10-31', 600, 10),
    record('first', '2026-11-01', 60, 2),
    record('second', '2026-11-01', 120, 3),
    record('missing', '2026-11-02', null, 7),
  ];
  return { db, p };
}

test('单次分享只含本次指标、单位快照及实际备注，不包含其他记录', () => {
  const { db, p } = fixture();
  p.primaryMetric = 'quantity';
  const before = JSON.stringify(db);
  const s = shareSnapshot(db, { kind: 'record', projectId: p.id, recordId: 'first' }, '2026-11-27');
  assert.deepEqual(
    s.metrics.map((m) => m.number + m.unit),
    ['2页', '1分钟'],
  );
  assert.equal(s.title, '打卡成功');
  assert.equal(s.summary, '');
  assert.equal(s.count, '');
  assert.ok(!s.description.includes('最近'));
  assert.equal(s.note, db.records[1].note);
  // Missing remarks stay absent instead of creating a placeholder on the shared poster.
  db.records[1].note = '';
  assert.equal(shareSnapshot(db, { kind: 'record', projectId: p.id, recordId: 'first' }).note, '');
  db.records[1].note = s.note;
  assert.equal(JSON.stringify(db), before);
  db.records[1].quantityUnit = '次';
  assert.equal(
    shareSnapshot(db, { kind: 'record', projectId: p.id, recordId: 'first' }).metrics[0].unit,
    '次',
  );
});

test('统计分享复用周期基数，日历忽略列表筛选且缺失时间不冒充零', () => {
  const { db, p } = fixture();
  const selection = {
    kind: 'statistics' as const,
    projectId: p.id,
    graph: 'cumulative' as const,
    metric: 'quantity' as const,
    period: 'month' as const,
    offset: 0,
    calendarOffset: 0,
  };
  const s = shareSnapshot(db, selection, '2026-11-27');
  assert.equal(s.metrics[0].number, '22');
  assert.equal(s.baseline, 10);
  assert.equal(s.metrics[0].label, '当前累计');
  assert.match(s.summary, /截至 2026.11.27/);
  const historical = shareSnapshot(db, { ...selection, offset: -1 }, '2026-11-27');
  assert.match(historical.summary, /截至 2026.10.31/);
  assert.equal(historical.metrics[0].number, '10');
  assert.match(s.summary, /本期新增 12页/);
  assert.equal(s.values.at(-1), 22);
  assert.equal(
    shareSnapshot(db, { ...selection, graph: 'distribution' }, '2026-11-27').metrics[0].number,
    '12',
  );
  const heat = shareSnapshot(db, { ...selection, graph: 'calendar' }, '2026-11-27');
  assert.equal(heat.cells.length, 42);
  assert.match(heat.date, /2026.11.01 — 2026.11.27/);
  assert.equal(heat.count, '3 条记录 · 2 个投入日');
  const missing = shareSnapshot(
    db,
    { ...selection, graph: 'distribution', metric: 'durationSeconds', period: 'day', offset: -25 },
    '2026-11-27',
  );
  assert.equal(missing.metrics[0].number, '—');
  p.timeUnit = '天';
  const tiny = shareSnapshot(
    db,
    { kind: 'record', projectId: p.id, recordId: 'first' },
    '2026-11-27',
  );
  assert.notEqual(tiny.metrics[0].number, '0');
});

test('分享来源版本在兄弟记录编辑/撤销/项目删除时失效；导航票据只可消费一次', () => {
  const { db, p } = fixture();
  const version = shareSourceVersion(db, p.id);
  const token = beginShare(db, { kind: 'record', projectId: p.id, recordId: 'first' });
  assert.equal(takeShare('wrong'), null);
  const request = takeShare(token)!;
  assert.equal(takeShare(token), null);
  db.records[2].revision++;
  assert.notEqual(shareSourceVersion(db, p.id), version);
  assert.equal(request.snapshot.metrics[0].number, '1');
  db.records = [];
  assert.throws(() => shareSnapshot(db, { kind: 'record', projectId: p.id, recordId: 'first' }));
  db.projects = [];
  assert.equal(shareSourceVersion(db, p.id), '');
});

test('平台兼容区分3.0图片接口与3.8.2朋友圈能力，取消相册授权不保存，只清理自有图片', async () => {
  const calls: unknown[] = [];
  const wxMock = {
    getAppBaseInfo: () => ({ SDKVersion: '3.0.0' }),
    showShareImageMenu: async (options: unknown) => {
      calls.push(options);
    },
    getSetting: async () => ({ authSetting: { 'scope.writePhotosAlbum': false } }),
    showModal: async () => ({ confirm: false }),
    saveImageToPhotosAlbum: async () => {
      throw new Error('must not save');
    },
    getFileSystemManager: () => ({ unlink: (options: unknown) => calls.push(options) }),
  };
  const previous = globalThis.wx;
  Object.assign(globalThis, { wx: wxMock });
  try {
    assert.equal(versionAtLeast('3.10.0', '3.8.2'), true);
    assert.equal(imageShareCapabilities().timeline, false);
    await shareImage('tmp-a');
    assert.deepEqual(calls[0], { path: 'tmp-a' });
    assert.equal(await saveShareImage('tmp-a'), false);
    releaseShareImage('/business/storage');
    assert.equal(calls.length, 1);
    ownShareImage('tmp-a');
    releaseShareImage('tmp-a');
    releaseShareImage('tmp-a');
    assert.equal(calls.length, 2);
    wxMock.getAppBaseInfo = () => ({ SDKVersion: '3.8.2' });
    assert.equal(imageShareCapabilities().timeline, true);
    await shareImage('tmp-b');
    assert.deepEqual(calls[2], {
      path: 'tmp-b',
      needShowEntrance: true,
      entrancePath: 'pages/home/index',
    });
  } finally {
    Object.assign(globalThis, { wx: previous });
  }
});

test('原生海报无需DOM/Path2D，三类统计和双项记录的全部坐标均为有限数', () => {
  const { db, p } = fixture();
  const text: string[] = [];
  const ctx = new Proxy(
    {
      measureText: (value: string) => ({ width: Array.from(value).length * 20 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillText: (value: string) => text.push(String(value)),
    },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        return (...args: unknown[]) => {
          for (const n of args)
            if (typeof n === 'number')
              assert.ok(Number.isFinite(n), `${String(key)} received ${n}`);
        };
      },
    },
  ) as unknown as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
  drawPoster(
    ctx,
    shareSnapshot(db, { kind: 'record', projectId: p.id, recordId: 'first' }),
    null,
    ['literal note'],
    1312,
  );
  for (const graph of ['cumulative', 'distribution', 'calendar'] as const)
    drawPoster(
      ctx,
      shareSnapshot(
        db,
        {
          kind: 'statistics',
          projectId: p.id,
          graph,
          metric: 'quantity',
          period: 'month',
          offset: 0,
          calendarOffset: 0,
        },
        '2026-11-27',
      ),
      null,
      [],
      1200,
    );
  assert.ok(text.includes('literal note'));
  assert.ok(text.includes('当前累计'));
  assert.ok(!text.includes('期末累计'));
  assert.ok(!text.includes('已记录'));
  assert.ok(!text.includes('最近 7 天'));
  assert.ok(!text.includes('每一次投入，慢慢有形'));
  assert.ok(!text.includes('累计变化'));
  assert.ok(!text.includes('少'));
  assert.ok(!text.includes('多'));
  assert.ok(text.includes('本期新增'));
});

test('预览页拒绝失效票据，旧图片错误不覆盖新预览，卸载释放文件并取消迟到绘制', async () => {
  const previousPage = globalThis.Page,
    previousWx = globalThis.wx;
  let definition: any;
  const removed: string[] = [];
  Object.assign(globalThis, {
    Page: (options: any) => {
      definition = options;
    },
    wx: {
      getFileSystemManager: () => ({
        unlink: (options: { filePath: string }) => removed.push(options.filePath),
      }),
    },
  });
  try {
    await import('../miniprogram/pages/share-preview/index');
    const page = {
      ...definition,
      data: { ...definition.data },
      setData(patch: any) {
        Object.assign(this.data, patch);
      },
    };
    page.onLoad({ token: 'copied-or-expired' });
    assert.equal(page.data.invalid, true);
    assert.equal(page.data.loading, false);
    assert.equal(page.data.snapshot, null);
    page.data.image = ownShareImage('tmp-current');
    page.imageFailed({ currentTarget: { dataset: { path: 'tmp-old' } } });
    assert.equal(page.data.image, 'tmp-current');
    assert.equal(removed.length, 0);
    const generation = page._generation;
    page.onUnload();
    assert.equal(page._generation, generation + 1);
    assert.equal(page._alive, false);
    assert.deepEqual(removed, ['tmp-current']);
  } finally {
    Object.assign(globalThis, { Page: previousPage, wx: previousWx });
  }
});

/** Exercise the real renderer boundary: mandatory official artwork must survive the export unchanged and never overlap data. */
test('分享导出保留官方码原图，单次和三类统计的码区不遮挡内容，码加载失败不导出', async () => {
  const nativeCode = readFileSync(
    new URL('../miniprogram/assets/miniprogram-code.jpg', import.meta.url),
  );
  const prototypeCode = readFileSync(new URL('../prototype/miniprogram-code.jpg', import.meta.url));
  assert.deepEqual(nativeCode, prototypeCode);
  assert.equal(
    createHash('sha256').update(nativeCode).digest('hex'),
    '4c2c69ea2e25f52697f08a9584e88a88457741ae3da56eccd50203686289e202',
  );
  const previous = globalThis.wx;
  let exports = 0;
  const images: { source: string; x: number; y: number; width: number; height: number }[] = [];
  const labels: { value: string; x: number; y: number }[] = [];
  const ctx = new Proxy(
    {
      measureText: (v: string) => ({ width: Array.from(v).length * 20 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      drawImage: (img: { source: string }, x: number, y: number, width: number, height: number) =>
        images.push({ source: img.source, x, y, width, height }),
      fillText: (value: string, x: number, y: number) =>
        labels.push({ value: String(value), x, y }),
    },
    { get: (target: any, key) => (key in target ? target[key] : () => {}) },
  );
  const canvas = (failCode = false) => ({
    width: 0,
    height: 0,
    getContext: () => ctx,
    createImage: () => ({
      source: '',
      onload: () => {},
      onerror: () => {},
      set src(path: string) {
        this.source = path;
        if (failCode && path.endsWith('miniprogram-code.jpg')) this.onerror();
        else this.onload();
      },
    }),
  });
  Object.assign(globalThis, {
    wx: {
      canvasToTempFilePath: (options: any) => {
        exports++;
        options.success({ tempFilePath: 'tmp-code-' + exports });
      },
      getFileSystemManager: () => ({ unlink() {} }),
    },
  });
  try {
    const { db, p } = fixture();
    const selection = {
      kind: 'statistics' as const,
      projectId: p.id,
      graph: 'cumulative' as const,
      metric: 'quantity' as const,
      period: 'month' as const,
      offset: 0,
      calendarOffset: 0,
    };
    const snapshots = [
      shareSnapshot(db, { kind: 'record', projectId: p.id, recordId: 'first' }),
      ...(['cumulative', 'distribution', 'calendar'] as const).map((graph) =>
        shareSnapshot(db, { ...selection, graph }),
      ),
    ];
    // Long remarks must push the code down instead of covering its dots or caption.
    snapshots[0].note = '一'.repeat(100) + '\n' + '二'.repeat(100);
    for (const snapshot of snapshots) {
      images.length = 0;
      labels.length = 0;
      const buffer = canvas();
      const path = await renderShareImage(
        buffer as unknown as WechatMiniprogram.Canvas,
        snapshot,
        {} as WechatMiniprogram.Page.TrivialInstance,
      );
      assert.equal(buffer.width, 900);
      const code = images.find((img) => img.source.endsWith('miniprogram-code.jpg'))!;
      assert.ok(code);
      assert.equal(code.width, code.height);
      assert.ok(code.x > 600 && code.x + code.width < buffer.width);
      const name = labels.filter((label) => label.value === '北极星打卡');
      assert.equal(name.length, 1);
      assert.ok(name[0].x > 600 && name[0].y > code.y + code.height + 27);
      assert.ok(name[0].y <= buffer.height - 40);
      assert.ok(labels.some((label) => label.value === snapshot.title));
      if (snapshot.kind === 'statistics') {
        assert.equal(buffer.height, 1220);
        assert.ok(code.y > 950, 'code must be below the entire chart surface');
      } else {
        const remarkBottom = Math.max(
          ...labels
            .filter((label) => label.value.includes('一') || label.value.includes('二'))
            .map((label) => label.y),
        );
        assert.ok(code.y > remarkBottom + 20);
      }
      releaseShareImage(path);
    }
    const before = exports;
    await assert.rejects(
      renderShareImage(
        canvas(true) as unknown as WechatMiniprogram.Canvas,
        snapshots[1],
        {} as WechatMiniprogram.Page.TrivialInstance,
      ),
      /小程序码暂时无法加载/,
    );
    assert.equal(exports, before);
  } finally {
    Object.assign(globalThis, { wx: previous });
  }
});
