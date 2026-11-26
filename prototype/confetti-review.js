/* Selected prototype-only dimensional confetti, independent of record persistence and undo deadlines. */
(() => {
  "use strict";
  let loading, dimensionalQueue = Promise.resolve();
  function load() {
    // Only the pinned local MIT bundle is loaded; no CDN or user-provided script URL is accepted.
    return loading ||= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/tsparticles-confetti-4.6.0.min.js";
      script.onload = () => resolve(window.confetti);
      script.onerror = () => { loading = null; script.remove(); reject(new Error("彩纸效果未能加载")); };
      document.head.append(script);
    });
  }
  function play(canvas, { x, y, colors }) {
    let stopped = false, cleanup = () => {};
    canvas.dataset.engine = "dimensional";
    const alive = () => !stopped && canvas.isConnected;
    const ready = load().then(async library => {
      // Serialize initialization and reuse one library ID so rapid replay cannot grow its internal ID map.
      const pending = dimensionalQueue.then(async () => {
        if (!alive()) return;
        canvas.id = "confetti-review-dimensional";
        const fire = await library.create(canvas, { count: 0 });
        // Late initialization still obtains/destroys its container after cancellation to stop its frame loop.
        const container = await fire({ count: alive() ? 56 : 0, position: { x: x * 100, y: y * 100 }, colors, shapes: ["square"], scalar: 1.05, angle: 90, spread: 100, startVelocity: 11, gravity: .65, decay: .94, drift: .4, ticks: 180, disableForReducedMotion: true });
        cleanup = () => container?.destroy();
        if (!alive()) cleanup();
      });
      // Recover only the queue; this attempt's failure is still reported by the outer handler.
      dimensionalQueue = pending.catch(() => {});
      await pending;
    }).catch(error => {
      const status = document.getElementById("confetti-review-status");
      if (alive() && status) status.textContent = error.message + "，记录已保存。";
    });
    // Storage never waits on particle rendering; cancellation works before and after bundle loading.
    return { ready, reset() { stopped = true; cleanup(); } };
  }
  window.DAKA_CONFETTI_REVIEW = { play };
})();
