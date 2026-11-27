/* Selected prototype-only dimensional confetti, independent of record persistence and undo deadlines. */
(() => {
  "use strict";
  let loading, dimensionalQueue = Promise.resolve();
  // Draw complete phrases directly, so paired glyphs and 666 retain their natural proportions.
  const celebrationEmoji = ['👍', '666', '💪', '🐂🍺', '🎉', '🎁', '👏', '🥳', '🔥', '🏆', '✨', '💯',
    '🙌', '🤩', '😎', '🚀', '🌟', '⭐', '🎊', '🎈', '🥇', '🏅', '🎯', '💥', '💐', '🌈', '❤️', '🧡', '💛', '💚', '💙', '💜'];
  // Session-only variety: each new burst introduces at least eight glyphs absent from the preceding burst.
  let previousEmoji = new Set();
  function shuffleEmoji(values) {
    // Fisher–Yates samples without replacement; phrases stay atomic and cannot be split into separate glyphs.
    for (let index = values.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
  }
  const emojiSprites = new Map();
  function emojiSprite(text, ratio) {
    const key = text + ':' + ratio;
    if (emojiSprites.has(key)) return emojiSprites.get(key);
    const sprite = document.createElement('canvas');
    const context = sprite.getContext('2d');
    if (!context) return null;
    const font = `${text === '666' ? '700' : '400'} 24px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    context.font = font;
    const width = Math.ceil(context.measureText(text).width) + 12, height = 40;
    sprite.width = Math.ceil(width * ratio);
    sprite.height = Math.ceil(height * ratio);
    context.scale(ratio, ratio);
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#ffe08a';
    context.shadowColor = '#32234030';
    context.shadowBlur = 2;
    context.shadowOffsetY = 1;
    context.fillText(text, width / 2, height / 2);
    // Rasterize glyphs/shadows once, including whole paired phrases; frames only composite cached bitmaps.
    const result = { canvas: sprite, width, height };
    emojiSprites.set(key, result);
    return result;
  }
  function warmEmojiSprites() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    celebrationEmoji.forEach(text => emojiSprite(text, ratio));
  }
  // Warm system-emoji bitmaps outside the first success interaction whenever the browser has idle time.
  if (window.requestIdleCallback) window.requestIdleCallback(warmEmojiSprites, { timeout: 800 });
  else setTimeout(warmEmojiSprites, 0);

  function playEmoji(canvas, { x, y, mode }) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return { ready: Promise.resolve(), reset() {} };
    // Reserve half the burst for fresh artwork, then fill/shuffle the remaining slots for varied combinations.
    // Sixteen is deliberately even so opposite-pair centering stays exact without adding rendering loops.
    const candidates = shuffleEmoji([...celebrationEmoji]);
    const fresh = candidates.filter(text => !previousEmoji.has(text)).slice(0, 8);
    const burstEmoji = shuffleEmoji([...fresh, ...candidates.filter(text => !fresh.includes(text)).slice(0, 16 - fresh.length)]);
    previousEmoji = new Set(burstEmoji);
    // Use opposite pairs at different depths: the whole burst stays centered on the card throughout its motion.
    // Both sides share the smaller screen margin; leave room for glyph bodies while letting them cross the card edges.
    const spreadRoom = Math.max(0, Math.min(140, x * width - 26, (1 - x) * width - 26));
    const pairs = Array.from({ length: burstEmoji.length / 2 }, (_, index) => ({
      direction: -Math.PI / 2 + index * 2.399963229728653,
      radius: Math.sqrt((index + 1) / (burstEmoji.length / 2)),
      size: (index % 3 === 0 ? 28 : 22) + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
      tilt: (Math.random() - .5) * .24,
      offsetX: (Math.random() - .5) * 6
    }));
    // Normalize the outermost pair to the available width so the spiral's angle cannot silently shrink the burst.
    const horizontalExtent = Math.max(...pairs.map(pair => Math.abs(Math.cos(pair.direction) * pair.radius)));
    const particles = burstEmoji.map((text, index) => {
      const pair = pairs[Math.floor(index / 2)], sign = index % 2 ? -1 : 1;
      const lane = index / (burstEmoji.length - 1) * 2 - 1;
      return { sprite: emojiSprite(text, ratio),
        spreadX: Math.cos(pair.direction) * spreadRoom * pair.radius * sign / horizontalExtent,
        spreadY: Math.sin(pair.direction) * 88 * pair.radius * sign,
        vx: lane * Math.min(81, spreadRoom) * 2.4,
        vy: -245 - (1 - Math.abs(lane)) * 55,
        size: pair.size,
        delay: mode === 'pop' ? (Math.floor(index / 2) % 3) * .14 : Math.floor(index / 2) * .016,
        tilt: pair.tilt * sign, phase: pair.phase + (sign < 0 ? Math.PI : 0),
        offsetX: pair.offsetX * sign, offsetY: 0 };
    });
    let frame = 0, stopped = false, frameCount = 0, previousTime = 0, worstGap = 0;
    const start = performance.now();
    const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
    function reportCadence() {
      // Review-only diagnostics update once at cleanup, never add DOM writes to the animation hot path.
      const status = document.getElementById('confetti-review-status');
      if (status) { status.dataset.emojiFrames = String(frameCount); status.dataset.emojiMaxGap = worstGap.toFixed(1); }
    }
    function draw(now) {
      if (stopped || !canvas.isConnected) return;
      if (previousTime) worstGap = Math.max(worstGap, now - previousTime);
      previousTime = now;
      frameCount++;
      const elapsed = (now - start) / 1000;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        const age = elapsed - particle.delay;
        if (age < 0 || !particle.sprite) continue;
        const fade = smooth(age / .1) * (1 - smooth((elapsed - 1.85) / .9));
        let dx, dy;
        const bloom = 1 - Math.exp(-5 * age);
        if (mode === 'fountain') {
          // A short ballistic fan gives a clear launch without the rejected tall central jet.
          const impulse = (1 - Math.exp(-2.4 * age)) / 2.4;
          dx = particle.vx * impulse;
          dy = particle.vy * impulse + 50 * age * age;
        } else if (mode === 'pop') {
          // Appear at dispersed anchors in three beats: motion comes from a soft scale rebound, not long travel.
          dx = particle.spreadX;
          dy = particle.spreadY - 16 * smooth(age / .5) + 8 * age * age;
        } else {
          // Fast local release followed by a long gentle drift; unequal radii avoid the previous ring effect.
          dx = particle.spreadX * bloom;
          dy = particle.spreadY * bloom + 12 * age * age;
        }
        const px = x * width + particle.offsetX + dx + Math.sin(age * 1.5 + particle.phase) * 2 * bloom;
        const py = y * height + particle.offsetY + dy;
        const entrance = mode === 'pop'
          ? 1 - Math.exp(-10 * age) * Math.cos(13 * age)
          : .65 + .35 * smooth(age / .22);
        const scale = entrance * particle.size / 24;
        const angle = particle.tilt + Math.sin(age * 1.6 + particle.phase) * .08;
        const cos = Math.cos(angle) * ratio * scale, sin = Math.sin(angle) * ratio * scale;
        // One transform and drawImage per visible glyph: no font shaping, shadows, save/restore or image allocation.
        context.setTransform(cos, sin, -sin, cos, px * ratio, py * ratio);
        context.globalAlpha = fade;
        const sprite = particle.sprite;
        context.drawImage(sprite.canvas, -sprite.width / 2, -sprite.height / 2, sprite.width, sprite.height);
      }
      context.globalAlpha = 1;
      if (elapsed < 2.8) frame = requestAnimationFrame(draw);
      else reportCadence();
    }
    frame = requestAnimationFrame(draw);
    // Replay/undo own a single frame request; disposal cannot leave a second rendering loop running.
    return { ready: Promise.resolve(), reset() { stopped = true; cancelAnimationFrame(frame); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height); reportCadence(); } };
  }
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
  function play(canvas, { x, y, colors, variant = 'emoji' }) {
    canvas.dataset.variant = variant;
    if (variant === 'emoji' || variant === 'emoji-fountain' || variant === 'emoji-pop') {
      canvas.dataset.engine = 'emoji-planar';
      // Review variants never reach the approved paper branch or change its library parameters.
      const mode = variant === 'emoji-fountain' ? 'fountain' : variant === 'emoji-pop' ? 'pop' : 'bloom';
      return playEmoji(canvas, { x, y, mode });
    }
    let stopped = false, cleanup = () => {};
    canvas.dataset.engine = "dimensional";
    canvas.dataset.variant = variant;
    const alive = () => !stopped && canvas.isConnected;
    const ready = load().then(async library => {
      // Serialize initialization and reuse one library ID so rapid replay cannot grow its internal ID map.
      const pending = dimensionalQueue.then(async () => {
        if (!alive()) return;
        canvas.id = "confetti-review-dimensional";
        const fire = await library.create(canvas, { count: 0 });
        // Late initialization still obtains/destroys its container after cancellation to stop its frame loop.
        // Keep the approved paper engine and every motion parameter intact; emoji use an isolated renderer above.
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
