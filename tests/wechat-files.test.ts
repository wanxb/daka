// A migration failure must remain an explicit unconfirmed update, never a fresh empty installation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatFiles } from '../miniprogram/infrastructure/wechat-files';
import { LocalRepository } from '../miniprogram/infrastructure/repository';
import { initialForm, makeProject } from '../miniprogram/domain/model';

/** Model directory renames and IO failures; migration must preserve the repository, not just redirect reads. */
function filesystem() {
  const disk = new Map<string, string>();
  const state = { failRename: false, failAccess: false, renames: 0 };
  const has = (path: string) =>
    [...disk.keys()].some((key) => key === path || key.startsWith(path + '/'));
  (globalThis as any).wx = {
    env: { USER_DATA_PATH: 'usr' },
    getFileSystemManager: () => ({
      access: (o: any) =>
        state.failAccess
          ? o.fail({ errMsg: 'permission denied' })
          : has(o.path)
            ? o.success({})
            : o.fail({ errMsg: 'ENOENT' }),
      rename: (o: any) => {
        state.renames++;
        if (state.failRename) return o.fail({ errMsg: 'IO error' });
        for (const [path, content] of [...disk]) {
          if (!path.startsWith(o.oldPath + '/')) continue;
          disk.set(o.newPath + path.slice(o.oldPath.length), content);
          disk.delete(path);
        }
        o.success({});
      },
      mkdir: (o: any) => o.success({}),
      readFile: (o: any) =>
        disk.has(o.filePath)
          ? o.success({ data: disk.get(o.filePath) })
          : o.fail({ errMsg: 'ENOENT' }),
      writeFile: (o: any) => {
        disk.set(o.filePath, o.data);
        o.success({});
      },
      readdir: (o: any) =>
        o.success({
          files: [
            ...new Set(
              [...disk.keys()]
                .filter((path) => path.startsWith(o.dirPath + '/'))
                .map((path) => path.slice(o.dirPath.length + 1).split('/')[0]),
            ),
          ],
        }),
      unlink: (o: any) => {
        disk.delete(o.filePath);
        o.success({});
      },
    }),
  };
  return { disk, state };
}

test('存储命名空间升级', async (t) => {
  await t.test('旧库整体迁移，保留记录、草稿、撤销及删除标记，重启后可继续保存', async () => {
    const { disk, state } = filesystem();
    const repo = new LocalRepository(new WechatFiles());
    await repo.transaction((db) => {
      const project = makeProject({ ...initialForm(), name: '阅读' }, 1);
      db.projects.push(project);
      db.records.push({
        id: 'r_1',
        projectId: project.id,
        occurredOn: '2026-11-25',
        localTime: '',
        durationSeconds: 60,
        quantity: null,
        quantityUnit: null,
        note: '保留备注',
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      });
      db.newProjectDraft = initialForm();
      db.undo = { type: 'create', record: db.records[0], expiresAt: 999999 };
      db.projects.push(makeProject({ ...initialForm(), id: 'p_deleted', name: '删除' }, 1));
    });
    await repo.deleteProject('p_deleted');
    const expected = await repo.snapshot();
    // Build a real legacy store with valid checksums rather than bypassing repository validation.
    for (const [path, content] of [...disk]) {
      disk.set(path.replace('/polaris/', '/yugong/'), content);
      disk.delete(path);
    }
    const upgraded = new LocalRepository(new WechatFiles());
    assert.deepEqual(await upgraded.snapshot(), expected);
    assert.equal(state.renames, 1);
    assert.ok(disk.has('usr/polaris/v1/deleted-projects/p_deleted.json'));
    assert.ok([...disk.keys()].every((path) => !path.includes('/yugong/')));
    await upgraded.transaction((db) => {
      db.records[0].note = '迁移后保存';
    });
    assert.equal(
      (await new LocalRepository(new WechatFiles()).snapshot()).records[0].note,
      '迁移后保存',
    );
  });
  await t.test('迁移失败保留旧数据并阻止写入，同一实例可以重试', async () => {
    const { disk, state } = filesystem();
    disk.set('usr/yugong/v1/manifest-a.json', 'old');
    state.failRename = true;
    const files = new WechatFiles();
    await assert.rejects(files.write('manifest-a.json', 'new'), /位置更新尚未确认/);
    assert.deepEqual([...disk], [['usr/yugong/v1/manifest-a.json', 'old']]);
    state.failRename = false;
    assert.equal(await files.read('manifest-a.json'), 'old');
  });
  await t.test('已有新目录时不覆盖，不合并旧库', async () => {
    const { disk, state } = filesystem();
    disk.set('usr/yugong/v1/manifest-a.json', 'old');
    disk.set('usr/polaris/v1/manifest-a.json', 'new');
    assert.equal(await new WechatFiles().read('manifest-a.json'), 'new');
    assert.equal(state.renames, 0);
    assert.equal(disk.get('usr/yugong/v1/manifest-a.json'), 'old');
  });
  await t.test('权限错误不能被当成新安装，恢复权限后可重试', async () => {
    const { disk, state } = filesystem();
    state.failAccess = true;
    const files = new WechatFiles();
    await assert.rejects(files.write('manifest-a.json', 'new'), /无法读取/);
    assert.equal(disk.size, 0);
    state.failAccess = false;
    await files.write('manifest-a.json', 'new');
    assert.equal(disk.get('usr/polaris/v1/manifest-a.json'), 'new');
  });
});
