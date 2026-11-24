/** The persisted absolute deadline stays authoritative when a page goes into the background. */
Component({
  properties: { message: { type: String, value: '' }, expiresAt: { type: Number, value: 0 } },
  data: { visible: false, busy: false, timer: 0 },
  observers: {
    'message, expiresAt'() {
      this.refresh();
    },
  },
  pageLifetimes: {
    show() {
      this.refresh();
    },
  },
  lifetimes: {
    detached() {
      if (this.data.timer) clearTimeout(this.data.timer);
    },
  },
  methods: {
    refresh() {
      if (this.data.timer) clearTimeout(this.data.timer);
      const remaining = this.data.expiresAt - Date.now();
      this.setData({ visible: !!this.data.message && remaining > 0, busy: false });
      if (remaining > 0)
        this.data.timer = setTimeout(() => this.setData({ visible: false }), remaining);
    },
    undo() {
      if (this.data.busy) return;
      this.setData({ busy: true });
      this.triggerEvent('undo');
    },
    hide() {
      this.setData({ visible: false });
    },
  },
});
