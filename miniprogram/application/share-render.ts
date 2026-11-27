import { iconSource } from './appearance';
import { drawPoster, wrap } from './share-poster';
import { ownShareImage } from './share-platform';
import type { ShareSnapshot } from './share-snapshot';

/** Render the same immutable poster for native sharing and compatibility saving; never touch business data. */
export async function renderShareImage(
  canvas: WechatMiniprogram.Canvas,
  snapshot: ShareSnapshot,
  scope: WechatMiniprogram.Page.TrivialInstance,
): Promise<string> {
  const ctx = canvas.getContext(
    '2d',
  ) as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
  // A saved record note is included automatically; an absent note reserves no poster space.
  const notes = snapshot.note ? wrap(ctx, snapshot.note, 690, 28) : [];
  // Only statistics require graph space; a record uses a compact metric-dependent paper.
  const baseHeight = snapshot.kind === 'record' ? (snapshot.metrics[1] ? 840 : 730) : 1220;
  const height = baseHeight + (notes.length ? notes.length * 42 + 70 : 0);
  // Bound decoded/exported pixels: long legacy notes grow the paper vertically, never multiply device DPR.
  if (height > 16000) throw new Error('备注过长，暂时无法生成分享图片');
  canvas.width = 900;
  canvas.height = height;

  const glyph = await loadGlyph(canvas, iconSource(snapshot.icon, snapshot.colorId));
  // The supplied official code is mandatory; do not export an incomplete or fabricated scannable image.
  const miniCode = await loadGlyph(canvas, '/assets/miniprogram-code.jpg');
  if (!miniCode) throw new Error('小程序码暂时无法加载，请重试');
  drawPoster(ctx, snapshot, glyph, notes, height, miniCode);
  const path = await new Promise<string>((resolve, reject) =>
    wx.canvasToTempFilePath(
      {
        canvas,
        width: 900,
        height,
        destWidth: 900,
        destHeight: height,
        fileType: 'png',
        success: (result) => resolve(ownShareImage(result.tempFilePath)),
        fail: reject,
      },
      scope,
    ),
  );
  return path;
}

/** SVG decoding may fail on an older client; official code failure is handled explicitly by the caller. */
function loadGlyph(
  canvas: WechatMiniprogram.Canvas,
  path: string,
): Promise<WechatMiniprogram.Image | null> {
  return new Promise((resolve) => {
    const image = canvas.createImage();
    const timer = setTimeout(() => resolve(null), 2500);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    image.src = path;
  });
}
