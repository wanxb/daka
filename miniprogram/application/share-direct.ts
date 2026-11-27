import { prepare } from './service';
import { errorText } from './presentation';
import { renderShareImage } from './share-render';
import {
  beginShare,
  shareSnapshot,
  shareSourceVersion,
  type ShareSelection,
} from './share-snapshot';
import {
  imageShareCapabilities,
  isShareCancel,
  releaseShareImage,
  shareImage,
} from './share-platform';

let busy = false;
let retainedImage = '';

/** One app-wide export owns loading and native UI; callers supply a lifecycle guard to reject late work. */
export async function shareDirect(
  scope: WechatMiniprogram.Page.TrivialInstance,
  selection: ShareSelection,
  isCurrent: () => boolean,
): Promise<void> {
  if (busy || !isCurrent()) return;
  busy = true;
  try {
    // Keep a save path for old clients without the image menu, never an automatic album permission request.
    if (!imageShareCapabilities().imageMenu) {
      const db = await prepare();
      if (isCurrent())
        await wx.navigateTo({
          url: '/pages/share-preview/index?token=' + beginShare(db, selection),
        });
      return;
    }
    let retry = true;
    while (retry && isCurrent()) {
      retry = false;
      let path = '';
      wx.showLoading({ title: '正在生成', mask: true });
      try {
        const db = await prepare();
        if (!isCurrent()) return;
        const version = shareSourceVersion(db, selection.projectId);
        const snapshot = shareSnapshot(db, selection);
        const canvas = await new Promise<WechatMiniprogram.Canvas>((resolve, reject) => {
          wx.nextTick(() =>
            scope
              .createSelectorQuery()
              .select('#share-buffer')
              .fields({ node: true })
              .exec((result) => {
                if (result[0]?.node) resolve(result[0].node);
                else reject(new Error('画布暂时无法使用，请重试'));
              }),
          );
        });
        if (!isCurrent()) return;
        path = await renderShareImage(canvas, snapshot, scope);
        const latest = await prepare();
        if (!isCurrent()) return;
        if (version !== shareSourceVersion(latest, selection.projectId))
          throw new Error('记录已变更，请重新分享');
        wx.hideLoading();
        await shareImage(path);
        // The native menu can still read its file after success. Retain one image until the next successful export.
        if (retainedImage) releaseShareImage(retainedImage);
        retainedImage = path;
        path = '';
      } catch (error) {
        wx.hideLoading();
        if (isShareCancel(error) || !isCurrent()) return;
        const answer = await wx.showModal({
          title: '暂时无法分享',
          content: errorText(error),
          confirmText: '重试',
          cancelText: '取消',
        });
        retry = answer.confirm;
      } finally {
        wx.hideLoading();
        if (path) releaseShareImage(path);
      }
    }
  } finally {
    busy = false;
  }
}
