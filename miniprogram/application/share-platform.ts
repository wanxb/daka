/** Compare numeric components, not lexical strings (3.10 must sort after 3.8). */
export function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split('.').map(Number),
    right = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference) return difference > 0;
  }
  return true;
}

/** The API predates timeline support; detecting its presence alone cannot establish the 3.8.2 capability. */
export function imageShareCapabilities() {
  const version = wx.getAppBaseInfo().SDKVersion;
  return {
    imageMenu: typeof wx.showShareImageMenu === 'function',
    timeline: versionAtLeast(version, '3.8.2'),
    entrance: versionAtLeast(version, '3.2.0'),
  };
}

const owned = new Set<string>();
/** Only paths produced by our own canvas export can be removed; business storage never enters this set. */
export function ownShareImage(path: string): string {
  owned.add(path);
  return path;
}
export function releaseShareImage(path: string): void {
  if (!owned.delete(path)) return;
  wx.getFileSystemManager().unlink({
    filePath: path,
    fail() {
      /* Temporary files may already have expired. */
    },
  });
}

/** A successful call means the system menu opened, never that a friend received or published the image. */
export async function shareImage(path: string): Promise<void> {
  const capabilities = imageShareCapabilities();
  if (!capabilities.imageMenu) throw new Error('当前微信版本请保存图片后分享');
  await wx.showShareImageMenu({
    path,
    ...(capabilities.entrance ? { needShowEntrance: true, entrancePath: 'pages/home/index' } : {}),
  });
}

/** Ask for album access only after Save; a denied permission never prevents viewing or using the share menu. */
export async function saveShareImage(path: string): Promise<boolean> {
  const settings = await wx.getSetting();
  if (settings.authSetting['scope.writePhotosAlbum'] === false) {
    const answer = await wx.showModal({
      title: '无法保存到相册',
      content: '请在设置中允许保存到相册，图片预览会保留。',
      confirmText: '去设置',
    });
    if (!answer.confirm) return false;
    const updated = await wx.openSetting();
    if (!updated.authSetting['scope.writePhotosAlbum']) return false;
  }
  await wx.saveImageToPhotosAlbum({ filePath: path });
  return true;
}

/** Native cancellation is a normal exit, not a failed record or a successful share. */
export function isShareCancel(error: unknown): boolean {
  const message = String((error as { errMsg?: string })?.errMsg || '');
  return /cancel/i.test(message);
}
