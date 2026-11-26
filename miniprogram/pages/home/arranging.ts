/** Card arranging owns only transient order/gesture state; persistence still uses the service transaction. */
import { service } from '../../application/service';
import { errorText } from '../../application/presentation';
import { moveProject, nearestSlot, previewProjectOrder } from '../../application/project-order';
import type { HomePage } from './state';
export const arrangingMethods = {
  /** Long-press never falls through to a quick record, including the release tap. */
  enterArrange(this: HomePage) {
    if (!this._db || this.data.busyId || this.data.arranging) return;
    this.stopCelebration();
    wx.hideKeyboard();
    this._orderIds = this._db.projects.map((p) => p.id);
    this._originalOrder = [...this._orderIds];
    this._suppressTapUntil = Date.now() + 600;
    // Bind wiggle phase to identity for this session; a changed array index must not restart a neighbor's motion.
    const motionDelays: Record<string, number> = {};
    this._orderIds.forEach((id, index) => (motionDelays[id] = index % 2 === 0 ? -90 : -180));
    this.setData({ arranging: true, motionDelays, toast: '', searchFocus: false, error: '' });
    this.filter();
  },
  async finishArrange(this: HomePage) {
    if (this.data.arrangeSaving) return;
    this.cancelDrag();
    this.setData({ arrangeSaving: true, error: '' });
    try {
      await service().reorderProjects(this._orderIds, this._originalOrder);
      this.setData({ arranging: false });
      await this.load();
    } catch (error) {
      this.setData({ error: errorText(error) });
      await this.load();
    } finally {
      this.setData({ arrangeSaving: false });
    }
  },
  /** Empty page/grid space cancels only the draft order; confirmed deletions already belong to the store. */
  cancelArrange(this: HomePage, e: WechatMiniprogram.TouchEvent) {
    if (
      !this.data.arranging ||
      this.data.arrangeSaving ||
      this.data.draggingId ||
      this.data.settling ||
      e.target.dataset.arrangeBlank !== true ||
      Date.now() < this._suppressTapUntil
    )
      return;
    this.cancelDrag();
    this._orderIds = [];
    this._originalOrder = [];
    this.setData({ arranging: false, error: '' });
    this.filter();
  },
  async removeCard(this: HomePage, e: WechatMiniprogram.TouchEvent) {
    if (!this.data.arranging || this.data.arrangeSaving || !this._db) return;
    this.cancelDrag();
    const id = String(e.currentTarget.dataset.id),
      project = this._db.projects.find((p) => p.id === id);
    if (!project) return;
    this.setData({ arrangeSaving: true });
    try {
      const count = this._db.records.filter((r) => r.projectId === id).length;
      const answer = await wx.showModal({
        title: '删除「' + project.name + '」？',
        // Keep project deletion wording identical across home and detail; unlike a single record it cannot be restored.
        content: '将删除此项目' + (count ? '及其 ' + count + ' 条记录' : '') + '，且无法恢复。',
        confirmText: '删除项目',
        confirmColor: '#b42318',
      });
      if (answer.confirm) {
        await service().repository.deleteProject(id);
        await this.load();
      }
    } catch (error) {
      this.setData({ error: errorText(error) });
    } finally {
      this.setData({ arrangeSaving: false });
    }
  },
  dragStart(this: HomePage, e: WechatMiniprogram.TouchEvent) {
    if (!this.data.arranging || this.data.arrangeSaving || this.data.settling || !e.touches[0])
      return;
    const point = e.touches[0],
      id = String(e.currentTarget.dataset.id),
      version = ++this._dragVersion;
    wx.createSelectorQuery()
      .in(this)
      .selectAll('.tile')
      .boundingClientRect((rects) => {
        if (version !== this._dragVersion || !this.data.arranging || !Array.isArray(rects)) return;
        const slots = rects.map((rect) => ({
          left: rect.left,
          top: rect.top + this._scrollTop,
          width: rect.width,
          height: rect.height,
        }));
        this._drag = {
          id,
          startX: point.clientX,
          startY: point.clientY,
          scroll: this._scrollTop,
          target: this._orderIds.indexOf(id),
          slots,
          x: point.clientX,
          y: point.clientY,
        };
        this._previewTarget = -1;
        this.setData({ draggingId: id, dragStyle: '' });
        this.previewDrag();
      })
      .exec();
  },
  dragMove(this: HomePage, e: WechatMiniprogram.TouchEvent) {
    if (!this._drag || !e.touches[0]) return;
    this._drag.x = e.touches[0].clientX;
    this._drag.y = e.touches[0].clientY;
    this.previewDrag();
    // Edge scrolling keeps projects below the first screen reachable while the card owns the touch.
    if (!this._scrollTimer)
      this._scrollTimer = setInterval(() => {
        const drag = this._drag;
        if (!drag) return;
        const height = wx.getWindowInfo().windowHeight;
        const delta = drag.y > height - 70 ? 14 : drag.y < this._navigationHeight + 55 ? -14 : 0;
        if (delta)
          wx.pageScrollTo({ scrollTop: Math.max(0, this._scrollTop + delta), duration: 0 });
      }, 50);
  },
  previewDrag(this: HomePage) {
    const drag = this._drag;
    if (!drag) return;
    drag.target = nearestSlot(drag.slots, drag.x, drag.y + this._scrollTop);
    // Only retarget neighbors when the insertion index changes, not on every pointer frame.
    if (this._previewTarget !== drag.target) {
      const preview = previewProjectOrder(this._orderIds, drag.id, drag.target, drag.slots);
      if (preview) {
        const shiftStyles: Record<string, string> = {};
        preview.shifts.forEach((shift) => {
          if (shift.id !== drag.id)
            shiftStyles[shift.id] =
              'transform:translate(' +
              shift.x +
              'px,' +
              shift.y +
              'px);transition-delay:' +
              shift.delay +
              'ms;';
        });
        const hole = preview.hole;
        this.setData({
          shiftStyles,
          placeholderStyle:
            'left:' +
            (hole.left - preview.origin.left) +
            'px;top:' +
            (hole.top - preview.origin.top) +
            'px;width:' +
            hole.width +
            'px;height:' +
            hole.height +
            'px;',
        });
      }
      this._previewTarget = drag.target;
    }
    this.setData({
      dragStyle:
        'transform:translate(' +
        (drag.x - drag.startX) +
        'px,' +
        (drag.y - drag.startY + this._scrollTop - drag.scroll) +
        'px) scale(1.035);',
    });
  },
  dragEnd(this: HomePage) {
    const drag = this._drag;
    if (drag && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 6) {
      const preview = previewProjectOrder(this._orderIds, drag.id, drag.target, drag.slots);
      const shift = preview?.shifts.find((item) => item.id === drag.id);
      this._orderIds = moveProject(this._orderIds, drag.id, drag.target);
      this._suppressTapUntil = Date.now() + 500;
      this._drag = null;
      this._dragVersion++;
      if (this._scrollTimer) clearInterval(this._scrollTimer);
      this._scrollTimer = null;
      // Finish the visual move before committing DOM order, so neighbors cannot snap midway through their cascade.
      this.setData({
        settling: true,
        dragStyle:
          'transform:translate(' + (shift?.x || 0) + 'px,' + (shift?.y || 0) + 'px) scale(1);',
      });
      this._dropTimer = setTimeout(() => this.cancelDrag(), 380);
      return;
    }
    this.cancelDrag();
  },
  cancelDrag(this: HomePage) {
    const wasSettling = this.data.settling;
    const hadVisualDrag =
      !!this._drag ||
      wasSettling ||
      !!this.data.draggingId ||
      Object.keys(this.data.shiftStyles).length > 0;
    this._dragVersion++;
    if (this._dropTimer) clearTimeout(this._dropTimer);
    this._dropTimer = null;
    this._previewTarget = -1;
    if (this._scrollTimer) clearInterval(this._scrollTimer);
    this._scrollTimer = null;
    this._drag = null;
    // Ordinary navigation has no geometry to reset; retransmitting every card here can stall page hiding.
    if (!hadVisualDrag) return;
    // Rebase visual offsets and keyed layout in one render with transitions suppressed.
    // Clearing offsets first would briefly animate neighbors back to their old slots.
    const tiles = wasSettling
      ? this._orderIds
          .map((id) => this.data.tiles.find((tile) => tile.id === id))
          .filter((tile): tile is NonNullable<typeof tile> => !!tile)
      : this.data.tiles;
    const shiftStyles: Record<string, string> = {};
    tiles.forEach((tile) => (shiftStyles[tile.id] = 'transition:none;'));
    this.setData({
      draggingId: '',
      dragStyle: '',
      shiftStyles,
      tiles,
      placeholderStyle: '',
      settling: false,
    });
  },
  async moveCard(this: HomePage, e: WechatMiniprogram.TouchEvent) {
    // A simple tap offers a non-drag alternative for accessibility; a drag's release tap is suppressed.
    if (!this.data.arranging || this.data.arrangeSaving || Date.now() < this._suppressTapUntil)
      return;
    const id = String(e.currentTarget.dataset.id),
      index = this._orderIds.indexOf(id);
    const options = [
      index > 0 ? '前移一位' : '',
      index < this._orderIds.length - 1 ? '后移一位' : '',
    ].filter(Boolean);
    if (!options.length) return;
    const result = await wx.showActionSheet({ itemList: options }).catch(() => null);
    if (result) {
      this._orderIds = moveProject(
        this._orderIds,
        id,
        index + (options[result.tapIndex] === '前移一位' ? -1 : 1),
      );
      this.filter();
    }
  },
};
