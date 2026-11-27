/* Browser-only share review: images are real local PNGs, while WeChat destinations are simulations.
 * This renderer receives frozen display data and never mutates projects, records or undo deadlines. */
(() => {
  "use strict";
  const root = document.getElementById("share-root");
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  // Prototype-only Phosphor Regular "export", @phosphor-icons/core 2.1.1 (MIT; shared/LICENSE-Phosphor.txt).
  // Trusted inline local geometry inherits UI color and needs no external asset request or native configuration change.
  const shareIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M216,112v96a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V112A16,16,0,0,1,56,96H80a8,8,0,0,1,0,16H56v96H200V112H176a8,8,0,0,1,0-16h24A16,16,0,0,1,216,112ZM93.66,69.66,120,43.31V136a8,8,0,0,0,16,0V43.31l26.34,26.35a8,8,0,0,0,11.32-11.32l-40-40a8,8,0,0,0-11.32,0l-40,40A8,8,0,0,0,93.66,69.66Z"/></svg>';
  let session = null, generation = 0, returnFocus = null;
  const reviewMode = () => document.getElementById("share-review-mode")?.value || "normal";

  /** Revoke every generated blob when replaced; old asynchronous draws cannot resurrect dismissed previews. */
  function close() {
    generation++;
    if (session?.url) URL.revokeObjectURL(session.url);
    session = null;
    root.replaceChildren();
    document.querySelectorAll("[data-share-inert]").forEach(node => { node.inert = false; node.removeAttribute("data-share-inert"); });
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  function open(snapshot, isValid) {
    close();
    returnFocus = document.activeElement;
    // Copy all data before any await: period changes cannot mix dates, totals and chart points.
    session = { data: structuredClone(snapshot), isValid, status: "loading", mode: reviewMode(), url: null, stage: null };
    ["screen", "app-header", "overlay-root"].forEach(id => {
      const node = document.getElementById(id);
      if (!node.inert) { node.inert = true; node.setAttribute("data-share-inert", ""); }
    });
    render();
    root.querySelector("[data-share=close]")?.focus({ preventScroll: true });
    void generate();
  }

  function validate() {
    if (!session || session.isValid()) return true;
    generation++;
    if (session.url) URL.revokeObjectURL(session.url);
    Object.assign(session, { status: "invalid", url: null, stage: null });
    render();
    return false;
  }

  function render() {
    if (!session) return;
    const s = session, d = s.data, ready = s.status === "ready";
    const description = [d.name, d.title, d.date, ...d.metrics.map(m => m.label + m.number + m.unit), d.note].filter(Boolean).join("，");
    // This is the browser simulation of the native menu; no intermediate product preview is inserted.
    const status = s.status === "loading" ? '<span class="share-spinner"></span><p>正在生成图片</p>' : `<p>${s.status === "invalid" ? "记录已变更，请重新分享" : "图片未能生成，请重试"}</p>${s.status === "error" ? '<button data-share="retry">重试</button>' : ''}`;
    root.innerHTML = `<section class="share-direct" style="--share-accent:${d.color}" role="dialog" aria-modal="true" aria-label="${ready ? '微信图片分享面板模拟' : '正在生成分享图片'}">
      ${ready ? `<div class="share-direct-image"><img src="${s.url}" alt="${escape(description)}"></div><div class="share-direct-actions"><span class="share-simulation">原型模拟 · 微信图片分享面板</span><div class="share-destinations"><button data-share="friend"><span>朋友</span>发送给朋友</button><button data-share="timeline" ${s.mode === "legacy" ? 'disabled' : ''}><span>朋友圈</span>分享到朋友圈</button><button data-share="save"><span>保存</span>保存图片</button></div><p class="share-status">${escape(s.message || '浏览器仅演示流程，不会发送或发布')}</p><button class="share-direct-close" data-share="close">取消</button></div>` : `<div class="share-direct-progress" role="status">${status}<button data-share="close">取消</button></div>`}
      ${s.stage === "permission" ? stageMarkup(s) : ''}
    </section>`;
  }

  function stageMarkup(s) {
    if (s.stage === "permission") return `<div class="share-scrim"><section class="share-action-sheet" role="dialog" aria-modal="true" aria-labelledby="share-permission"><span class="share-simulation">原型模拟</span><h3 id="share-permission">无法保存到相册</h3><p>相册权限未开启。图片预览会保留，你可以返回或体验开启权限后的保存流程。</p><button class="share-primary" data-share="grant">模拟开启权限并下载</button><button class="share-save" data-share="back">返回预览</button></section></div>`;
    return `<div class="share-scrim" data-share="back"><section class="share-action-sheet" role="dialog" aria-modal="true" aria-labelledby="share-destinations"><span class="share-simulation">原型模拟 · 微信图片分享面板</span><h3 id="share-destinations">分享这张图片</h3><p>${s.mode === "legacy" ? "此低版本流程不提供朋友圈直达，请保存图片后手动发布。" : "选择去向体验流程，不会实际发送或发布。"}</p><div class="share-destinations"><button data-share="friend"><span>朋友</span>发送给朋友</button><button data-share="timeline" ${s.mode === "legacy" ? 'disabled' : ''}><span>朋友圈</span>分享到朋友圈</button></div><button class="share-save" data-share="back">取消</button></section></div>`;
  }

  function text(ctx, value, x, y, size = 28, color = "#1c1c1e", weight = 400, maximum = 756) {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(String(value), x, y, maximum);
  }

  // Wrap arbitrary old notes without clipping them to today's input limit or interpreting them as markup.
  function wrap(ctx, value, width, size) {
    ctx.font = `400 ${size}px ${font}`;
    return value.split("\n").flatMap(paragraph => {
      const lines = []; let line = "";
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ""; }
        line += char;
      }
      return [...lines, line];
    });
  }

  function rounded(ctx, x, y, width, height, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
  }

  async function projectGlyph(svg, color) {
    // Only bundled, trusted Phosphor SVG reaches this boundary; user strings are drawn as plain text.
    const image = new Image();
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replaceAll("currentColor", color));
    await image.decode();
    return image;
  }

  /** A north-star signature is decorative brand artwork, never a score, target or progress ring. */
  function star(ctx, x, y, radius, color) {
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 4, distance = i % 2 ? radius * .24 : radius;
      ctx.lineTo(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
    }
    ctx.closePath(); ctx.fill();
  }

    function metric(ctx, value, x, y, color, size, available) {
    ctx.font = `400 30px ${font}`;
    const unitWidth = ctx.measureText(value.unit).width;
    ctx.font = `600 ${size}px ${font}`;
    const fitted = Math.min(size, (available - unitWidth - 16) / Math.max(1, ctx.measureText(value.number).width) * size);
    text(ctx, value.number, x - 5, y, fitted, color, 600, available - unitWidth - 16);
    ctx.font = `600 ${fitted}px ${font}`;
    text(ctx, value.unit, x + ctx.measureText(value.number).width + 10, y - 5, 30, "#45454f");
  }

/** Low-contrast horizon bands are brand scenery, never a progress ring or a fabricated data curve. */
function drawBackdrop(ctx, color, height, record) {
    ctx.fillStyle = '#fcfcff';
    ctx.fillRect(0, 0, 900, height);
    const light = ctx.createRadialGradient(860, 80, 0, 730, 170, 760);
    light.addColorStop(0, color + '25');
    light.addColorStop(0.7, color + '08');
    light.addColorStop(1, color + '00');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, 900, height);
    // Anchor the artwork to the footer so long notes expand the content without colliding with it.
    for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath();
        ctx.moveTo(0, height - 108 + layer * 39);
        ctx.quadraticCurveTo(400, height + 28, 900, height - 245 + layer * 72);
        ctx.lineTo(900, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = color + ['09', '09', '0c'][layer];
        ctx.fill();
    }
    if (record) {
        // A single north-star glint carries the identity without competing with the saved amount.
        star(ctx, 765, 270, 26, color + '50');
        star(ctx, 707, 230, 6, color + '38');
    }
}
/** Keep only the saved result and its date; brand and background share one quiet visual system. */
function drawPoster(ctx, d, glyph, notes, height, brand = null) {
    const record = d.kind === 'record';
    drawBackdrop(ctx, d.color, height, record);
    if (glyph)
        ctx.drawImage(glyph, 76, 90, 52, 52);
    else
        star(ctx, 102, 116, 22, d.color);
    text(ctx, d.name, 148, 134, 50, '#222431', 600, 495);
    ctx.textAlign = 'right';
    text(ctx, d.title, 824, 128, 23, '#686a78', 400, 180);
    ctx.textAlign = 'left';
    text(ctx, d.date, 76, 197, 25, '#686a78');
    text(ctx, d.metrics[0].label, 76, 287, 27, '#686a78');
    metric(ctx, d.metrics[0], 76, 429, '#222431', record ? 158 : 140, 748);
    if (record && d.metrics[1]) {
        text(ctx, d.metrics[1].label, 76, 501, 25, '#686a78');
        metric(ctx, d.metrics[1], 76, 577, '#393c4c', 72, 748);
    }
    if (!record) {
        // The plot retains its measured scale; decoration stays outside the white data surface.
        rounded(ctx, 56, 500, 788, 450, 28, '#ffffffde');
        ctx.save();
        ctx.translate(0, -36);
        drawGraph(ctx, d);
        ctx.restore();
    }
    if (record && notes.length) {
        const top = d.metrics[1] ? 630 : 515;
        rounded(ctx, 76, top, 3, notes.length * 42, 1.5, d.color + '66');
        notes.forEach((line, i) => text(ctx, line, 99, top + 30 + i * 42, 28, '#555866', 400, 715));
    }
    // One official brand signature replaces repeated logos, slogans and unrelated record counts.
    if (brand)
        ctx.drawImage(brand, 76, height - 96, 44, 44);
    text(ctx, '北极星打卡', 132, height - 64, 24, '#626675', 500);
}
  function drawGraph(ctx, d) {
    const left = 94, right = 806, top = 650, base = 900;
    if (d.graph === "calendar") {
      const shades = ["#f0f0f5", d.color + "30", d.color + "66", d.color + "a8", d.color];
        ["一", "二", "三", "四", "五", "六", "日"].forEach((day, i) => text(ctx, day, 112 + i * 103, 632, 23, "#73737e"));
      d.cells.forEach((cell, i) => {
        if (!cell.day) return;
        const x = 94 + i % 7 * 103, y = 653 + Math.floor(i / 7) * 44;
        rounded(ctx, x, y, 77, 36, 10, cell.future ? "#f8f8fa" : shades[cell.level]);
        text(ctx, cell.missing ? "—" : cell.day, x + 24, y + 26, 22, cell.future ? "#a1a1ab" : cell.level > 2 ? "#fff" : "#45454f");
      });
      return;
    }
    const values = d.values, valid = values.filter(value => value != null);
    const cumulative = d.graph === "cumulative";
    // Preserve fractional time units instead of flattening short practices.
    const maximum = Math.max(0, ...valid) || 1;
    const minimum = cumulative ? Math.min(d.baseline, ...valid) : 0;
    const span = maximum - minimum || maximum || 1;
    const x = i => left + (right - left) * (i + .5) / Math.max(1, values.length);
    const y = value => base - (value - minimum) / span * (base - top);
    for (let i = 0; i <= 3; i++) {
      const yy = top + (base - top) * i / 3;
      ctx.strokeStyle = "#e8e8ee"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
    }
    if (!valid.length || !valid.some(value => value > 0)) {
      text(ctx, "所选时段暂无记录", 270, 770, 28, "#6b6b73");
    } else if (cumulative) {
      ctx.strokeStyle = d.color; ctx.lineWidth = 6; ctx.lineJoin = "round"; ctx.beginPath();
      let previous = null;
      // Horizontal then vertical segments preserve accumulation; no smoothing invents intermediate practice.
      values.forEach((value, i) => {
        if (value == null) return;
        if (previous == null) ctx.moveTo(x(i), y(value));
        else { ctx.lineTo(x(i), y(previous)); ctx.lineTo(x(i), y(value)); }
        previous = value;
      });
      ctx.stroke();
      const last = values.findLastIndex(value => value != null);
      // Shade the same step geometry, retaining exact daily plateaus rather than a smoothed curve.
      const first = values.findIndex(value => value != null), area = new Path2D();
      area.moveTo(x(first), base); area.lineTo(x(first), y(values[first]));
      let prior = values[first];
      values.forEach((value, i) => { if (value == null || i <= first) return; area.lineTo(x(i), y(prior)); area.lineTo(x(i), y(value)); prior = value; });
      area.lineTo(x(last), base); area.closePath();
      const fill = ctx.createLinearGradient(0, top, 0, base); fill.addColorStop(0, d.color + "27"); fill.addColorStop(1, d.color + "03"); ctx.fillStyle = fill; ctx.fill(area);
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(x(last), y(values[last]), 7, 0, Math.PI * 2); ctx.fill();
    } else {
      const width = Math.max(2, Math.min(42, (right - left) / Math.max(1, values.length) * .55));
      values.forEach((value, i) => {
        if (value > 0) rounded(ctx, x(i) - width / 2, y(value), width, base - y(value), Math.min(7, (base - y(value)) / 2), d.color);
      });
    }
    const indices = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])].filter(i => i >= 0);
    indices.forEach((i, index) => {
      ctx.textAlign = index === 0 ? "left" : index === indices.length - 1 ? "right" : "center";
      text(ctx, d.labels[i] || "", index === 0 ? left : index === indices.length - 1 ? right : x(i), 945, 22, "#6b6b73", 400, 220);
    });
    ctx.textAlign = "left";
    ctx.textAlign = "right";
    // Label the visible scale explicitly; a nonzero cumulative baseline must never masquerade as zero.
    text(ctx, maximum.toLocaleString("zh-CN", { maximumFractionDigits: 4 }), right, 627, 20, "#73737e");
    text(ctx, minimum.toLocaleString("zh-CN", { maximumFractionDigits: 4 }), right, 889, 20, "#73737e");
    ctx.textAlign = "left";
  }

  async function generate(retry = false) {
    if (!validate() || !session) return;
    const current = session, token = ++generation;
    current.status = "loading"; current.stage = null; render();
    try {
      if (current.mode === "generate-failure" && !retry) throw new Error("Review failure");
      await document.fonts.ready;
      const d = current.data, glyph = await projectGlyph(d.icon, d.color);
      // A missing official brand asset fails visibly and can be retried instead of inventing another logo.
      const brand = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image); image.onerror = reject;
        image.src = new URL("brand.png", location.href).href;
      });
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      // Notes extend the compact record paper without touching the footer.
      // Saved remarks follow the record automatically; missing remarks allocate no space.
      const notes = d.note ? wrap(ctx, d.note, 690, 28) : [];
      const noteHeight = notes.length ? notes.length * 42 + 70 : 0;
      canvas.width = 900; canvas.height = (d.kind === "record" ? (d.metrics[1] ? 840 : 730) : 1080) + noteHeight;
      if (canvas.height > 16000) throw new Error("Note exceeds canvas capacity");
      drawPoster(ctx, d, glyph, notes, canvas.height, brand);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Export unavailable")), "image/png"));
      if (token !== generation || current !== session) return;
      if (!validate()) return;
      if (current.url) URL.revokeObjectURL(current.url);
      current.url = URL.createObjectURL(blob); current.status = "ready"; current.message = ""; render();
    } catch {
      if (token === generation && current === session) { current.status = "error"; render(); }
    }
  }

  function download() {
    if (!validate() || !session?.url) return;
    const link = document.createElement("a");
    link.href = session.url; link.download = session.data.filename + ".png";
    document.body.append(link); link.click(); link.remove();
    session.message = "已发起 PNG 下载，请在浏览器下载记录中查看"; session.stage = null; render();
  }

  root.addEventListener("click", event => {
    // A blank tap inside the action sheet must not trigger its backdrop's cancel action.
    const button = event.target.closest("[data-share]");
    if (!button || (button.classList.contains("share-scrim") && event.target !== button)) return;
    if (button.disabled) return;
    const action = button.dataset.share;
    if (action === "close") { close(); return; }
    if (!validate()) return;
    if (action === "retry") { void generate(true); return; }
    if (action === "destinations") session.stage = "destinations";
    else if (action === "back") session.stage = null;
    else if (action === "save") {
      if (session.mode === "album-denied") session.stage = "permission";
      else { download(); return; }
    } else if (action === "grant") { download(); return; }
    else if (["friend", "timeline"].includes(action)) {
      close(); return;
    }
    render();
    (root.querySelector(".share-action-sheet button:not(:disabled)") || root.querySelector("[data-share=destinations]"))?.focus();
  });
  document.addEventListener("keydown", event => {
    if (!session) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation();
      if (session.stage) { session.stage = null; render(); root.querySelector("[data-share=close]")?.focus(); }
      else close();
    }
    if (event.key === "Tab") {
      const host = root.querySelector(".share-action-sheet") || root;
      const buttons = [...host.querySelectorAll("button:not(:disabled),input:not(:disabled)")];
      const first = buttons[0], last = buttons.at(-1);
      if (!buttons.includes(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  window.DakaShare = Object.freeze({ open, close, validate, icon: shareIcon });
})();
