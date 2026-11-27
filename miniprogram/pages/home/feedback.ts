/** Feedback waits for both native sheet exit and durable refresh, and invalidates every late selector callback on dismissal. */
import { recordText } from '../../application/presentation';
import { celebrationTiming } from '../../application/celebration';
import { createCelebrationSequence } from '../../application/celebration-sequence';
import { dateKey, type PracticeRecord } from '../../domain/model';
import type { HomePage } from './state';
export const feedbackMethods = {
  async saved(
    this: HomePage,
    e: WechatMiniprogram.CustomEvent<{ record: PracticeRecord; editing: boolean }>,
  ) {
    this.stopCelebration();
    const version = this._celebrationVersion;
    await this.load();
    if (!this._alive || !this._visible || version !== this._celebrationVersion) return;
    const p = this._db?.projects.find((p) => p.id === e.detail.record.projectId);
    if (p) this.notify('已记录 ' + recordText(p, e.detail.record));
    if (!e.detail.editing && e.detail.record.occurredOn === dateKey()) {
      // The native after-leave event may precede or follow storage refresh; support either ordering.
      if (this._sheetOpen) this._pendingCelebration = e.detail.record;
      else this.celebrateRecord(e.detail.record);
    }
  },
  recordClosed(this: HomePage) {
    this._sheetOpen = false;
    const record = this._pendingCelebration;
    this._pendingCelebration = null;
    if (record) this.celebrateRecord(record);
  },
  /** Decoration is disposable; every dismissal invalidates pending selector callbacks and expiry timers. */
  stopCelebration(this: HomePage) {
    this._celebrationVersion++;
    if (this._celebrationTimer) clearTimeout(this._celebrationTimer);
    this._celebrationTimer = null;
    this._pendingCelebration = null;
    if (this.data.celebration) this.setData({ celebration: null });
  },
  celebrateRecord(this: HomePage, record: PracticeRecord) {
    this.stopCelebration();
    const version = this._celebrationVersion;
    const project = this._db?.projects.find((p) => p.id === record.projectId);
    if (
      !this._alive ||
      !this._visible ||
      this.data.arranging ||
      !project ||
      record.occurredOn !== dateKey() ||
      !this._db?.records.some((r) => r.id === record.id)
    )
      return;
    // Wait for refreshed keyed cards to reach the view layer before measuring the saved record's card.
    wx.nextTick(() => {
      if (version !== this._celebrationVersion || !this._alive || !this._visible) return;
      this.createSelectorQuery()
        .selectAll('.tile')
        .fields({ rect: true, size: true, dataset: true }, (result) => {
          if (version !== this._celebrationVersion || !this._alive || !this._visible) return;
          const rect = (
            Array.isArray(result)
              ? (result as Array<
                  WechatMiniprogram.BoundingClientRectCallbackResult & { dataset: { id: string } }
                >)
              : []
          ).find((item) => item.dataset?.id === project.id);
          const info = wx.getWindowInfo();
          if (
            !rect ||
            rect.top < this._navigationHeight ||
            rect.top + rect.height > info.windowHeight
          )
            return;
          // Only this eligible, current layout callback can advance the disposable visual sequence.
          const sequence = (this._celebrationSequence ||= createCelebrationSequence());
          const celebration = sequence.next(
            { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            project.color,
            Date.now() + version,
            info.windowWidth,
          );
          if (!celebration) return;
          this.setData({ celebration });
          this._celebrationTimer = setTimeout(() => {
            if (version === this._celebrationVersion) this.stopCelebration();
          }, celebrationTiming.cleanup);
        })
        .exec();
    });
  },
  notify(this: HomePage, message: string) {
    this.setData({ toast: message, expiresAt: this._db?.undo?.expiresAt || 0 });
  },
};
