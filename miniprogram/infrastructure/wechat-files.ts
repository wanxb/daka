// User-facing failures distinguish uncertain writes from confirmed failures; never suggest clearing local records.
import { PracticeError } from '../domain/model';
import type { FileDriver } from './repository';
/** File paths never include project names or notes, and every operation stays under this app-owned root. */
export class WechatFiles implements FileDriver {
  private fs = wx.getFileSystemManager();
  // Keep the schema version separate from the product identifier so future formats can coexist.
  private root = wx.env.USER_DATA_PATH + '/polaris/v1';
  private initialization: Promise<void> | null = null;
  /** Migrate the entire old namespace, including deletion markers; never merge or overwrite an existing new store. */
  private ready(): Promise<void> {
    return (this.initialization ||= this.migrate().catch((error) => {
      this.initialization = null;
      throw error;
    }));
  }
  private exists(path: string): Promise<boolean> {
    return new Promise((resolve, reject) =>
      this.fs.access({
        path,
        success: () => resolve(true),
        fail: (error) =>
          this.missing(error)
            ? resolve(false)
            : reject(new PracticeError('IO', '暂时无法读取本地数据，请重试。')),
      }),
    );
  }
  private async migrate(): Promise<void> {
    const current = wx.env.USER_DATA_PATH + '/polaris';
    const legacy = wx.env.USER_DATA_PATH + '/yugong';
    if ((await this.exists(current)) || !(await this.exists(legacy))) return;
    // Rename within USER_DATA_PATH preserves relative manifest references without copying partial generations.
    // A failed migration blocks all IO rather than opening a misleading empty database.
    await new Promise<void>((resolve, reject) =>
      this.fs.rename({
        oldPath: legacy,
        newPath: current,
        success: () => resolve(),
        fail: () => reject(new PracticeError('IO', '本地数据位置更新尚未确认，请重试。')),
      }),
    );
  }
  private path(relative: string): string {
    if (
      !/^[A-Za-z0-9_./-]+$/.test(relative) ||
      relative.split('/').some((part) => part === '..' || part === '.') ||
      relative.startsWith('/')
    )
      throw new PracticeError('PATH', '无法访问本地数据位置。');
    return this.root + '/' + relative;
  }
  // DevTools reports "not found" while devices may report ENOENT; only explicit absence opens an empty store.
  private missing(error: WechatMiniprogram.GeneralCallbackResult): boolean {
    return /no such file|not exist|not found|ENOENT/i.test(error.errMsg);
  }
  async read(path: string): Promise<string | null> {
    await this.ready();
    return new Promise((resolve, reject) =>
      this.fs.readFile({
        filePath: this.path(path),
        encoding: 'utf8',
        success: (result) => resolve(String(result.data)),
        fail: (error) => {
          if (this.missing(error)) resolve(null);
          else {
            console.warn('[local-files] read:', error.errMsg);
            reject(new PracticeError('IO', '暂时无法读取本地数据，请重试。'));
          }
        },
      }),
    );
  }
  async write(path: string, data: string): Promise<void> {
    await this.ready();
    const full = this.path(path),
      dirPath = full.slice(0, full.lastIndexOf('/'));
    await new Promise<void>((resolve, reject) =>
      this.fs.mkdir({
        dirPath,
        recursive: true,
        success: () => resolve(),
        fail: (error) =>
          /exist/i.test(error.errMsg)
            ? resolve()
            : reject(new PracticeError('IO', '无法准备本地存储空间，请检查设备剩余空间。')),
      }),
    );
    await new Promise<void>((resolve, reject) =>
      this.fs.writeFile({
        filePath: full,
        data,
        encoding: 'utf8',
        success: () => resolve(),
        fail: () => reject(new PracticeError('IO', '保存失败，请检查设备剩余空间后重试。')),
      }),
    );
  }
  async list(path: string): Promise<string[]> {
    await this.ready();
    return new Promise((resolve, reject) =>
      this.fs.readdir({
        dirPath: this.path(path),
        success: (result) => resolve(result.files),
        fail: (error) =>
          this.missing(error)
            ? resolve([])
            : reject(new PracticeError('IO', '暂时无法读取本地数据，请重试。')),
      }),
    );
  }
  async remove(path: string): Promise<void> {
    await this.ready();
    return new Promise((resolve, reject) =>
      this.fs.unlink({
        filePath: this.path(path),
        success: () => resolve(),
        fail: (error) =>
          this.missing(error)
            ? resolve()
            : reject(new PracticeError('IO', '暂时无法清理临时文件。')),
      }),
    );
  }
}
