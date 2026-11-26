/** Reserve the real status-bar and capsule area instead of hardcoding an iPhone notch. */
Component({
  properties: {
    title: { type: String, value: '' },
    // Pages own the action; the navigation supplies a fixed, safe-area-aware leading button.
    actionText: { type: String, value: '' },
    actionDisabled: { type: Boolean, value: false },
    showBack: { type: Boolean, value: false },
    customBack: { type: Boolean, value: false },
    // Editors use the prototype's visible Cancel label while retaining their draft-aware back handler.
    backText: { type: String, value: '' },
  },
  data: { top: 0, height: 44, right: 96 },
  lifetimes: {
    attached() {
      const windowInfo = wx.getWindowInfo();
      const capsule = wx.getMenuButtonBoundingClientRect();
      const top = windowInfo.statusBarHeight;
      const hasCapsule = capsule.height > 0 && capsule.top >= top;
      this.triggerEvent('layout', {
        height: top + (hasCapsule ? Math.max(44, (capsule.top - top) * 2 + capsule.height) : 44),
      });
      this.setData({
        top,
        height: hasCapsule ? Math.max(44, (capsule.top - top) * 2 + capsule.height) : 44,
        right: hasCapsule ? windowInfo.windowWidth - capsule.left + 8 : 96,
      });
    },
  },
  methods: {
    /** Action events never fall through to navigation or the page's back handler. */
    leadingAction() {
      if (!this.data.actionDisabled) this.triggerEvent('action');
    },
    goBack() {
      // Editors may intercept only their own back button to preserve explicit save/cancel semantics.
      if (this.data.customBack) {
        this.triggerEvent('back');
        return;
      }
      // A direct simulator/deep-link entry has no previous page to return to.
      if (getCurrentPages().length > 1) {
        wx.navigateBack();
      } else {
        wx.reLaunch({ url: '/pages/home/index' });
      }
    },
  },
});
