import { PracticeError } from '../domain/model';
import type { FileDriver } from './repository';
/** File paths never include project names or notes, and every operation stays under this app-owned root. */
export class WechatFiles implements FileDriver {
  private fs = wx.getFileSystemManager();
  private root = wx.env.USER_DATA_PATH + '/yugong/v1';
  private path(relative: string): string {
    if (
      !/^[A-Za-z0-9_./-]+$/.test(relative) ||
      relative.split('/').some((part) => part === '..' || part === '.') ||
      relative.startsWith('/')
    )
      throw new PracticeError('PATH', '本地数据路径无效。');
    return this.root + '/' + relative;
  }
  // DevTools reports "not found" while devices may report ENOENT; only explicit absence opens an empty store.
  private missing(error: WechatMiniprogram.GeneralCallbackResult): boolean {
    return /no such file|not exist|not found|ENOENT/i.test(error.errMsg);
  }
  read(path: string): Promise<string | null> {
    return new Promise((resolve, reject) =>
      this.fs.readFile({
        filePath: this.path(path),
        encoding: 'utf8',
        success: (result) => resolve(String(result.data)),
        fail: (error) => {
          if (this.missing(error)) resolve(null);
          else {
            console.warn('[local-files] read:', error.errMsg);
            reject(new PracticeError('IO', '本地文件暂时无法读取，请重试。'));
          }
        },
      }),
    );
  }
  async write(path: string, data: string): Promise<void> {
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
            : reject(new PracticeError('IO', '无法创建本地数据目录，请检查设备空间。')),
      }),
    );
    await new Promise<void>((resolve, reject) =>
      this.fs.writeFile({
        filePath: full,
        data,
        encoding: 'utf8',
        success: () => resolve(),
        fail: () => reject(new PracticeError('IO', '本地写入失败，请检查设备空间后重试。')),
      }),
    );
  }
  list(path: string): Promise<string[]> {
    return new Promise((resolve, reject) =>
      this.fs.readdir({
        dirPath: this.path(path),
        success: (result) => resolve(result.files),
        fail: (error) =>
          this.missing(error)
            ? resolve([])
            : reject(new PracticeError('IO', '本地目录暂时无法读取。')),
      }),
    );
  }
  remove(path: string): Promise<void> {
    return new Promise((resolve, reject) =>
      this.fs.unlink({
        filePath: this.path(path),
        success: () => resolve(),
        fail: (error) =>
          this.missing(error) ? resolve() : reject(new PracticeError('IO', '无法清理临时文件。')),
      }),
    );
  }
}
