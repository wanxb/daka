/* This is a disposable interaction model, not the mini-program persistence implementation.
 * Every displayed total is derived from demonstration records; refreshing restores fixtures. */
(() => {
  "use strict";
  const DEMO_TODAY = "2026-11-24";
  const palettes = {
    purple: { start: "#6745c6", end: "#785bd5", name: "紫色" },
    orange: { start: "#bc421c", end: "#ca4f27", name: "暖橙" },
    blue: { start: "#285cce", end: "#3b70d5", name: "蓝色" },
    teal: { start: "#087b75", end: "#157e78", name: "青绿" },
    rose: { start: "#bd3457", end: "#cb4261", name: "玫红" }
  };
  const paths = {
    book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z"/>',
    rope: '<path d="M6 17c-5-8-2-14 6-14s11 6 6 14M5 16l3 4M19 16l-3 4M8 7c2-2 6-2 8 0"/><path d="m4 16 2-1 3 5-2 1Zm16 0-2-1-3 5 2 1Z"/>',
    dumbbell: '<path d="M7 8v8M4 9v6M17 8v8M20 9v6M7 12h10M4 12H2m18 0h2"/><path d="M7 7h3v10H7zm7 0h3v10h-3z"/>',
    piano: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7.5 13v7M12 13v7m4.5-7v7M7 4v8h2V4m6 0v8h2V4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><path d="m13 11 8-8m-4 0h4v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    // Search uses the same stroke system as project actions, keeping the home control visually quiet.
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    // Configuration icons share the existing outline weight, caps and viewBox for consistent optical size.
    quantity: '<path d="m9 3-2 18m10-18-2 18M4 9h16M3 15h16"/>',
    chart: '<path d="M4 20V10h4v10m2 0V4h4v16m2 0v-7h4v7M3 20h18"/>',
    bolt: '<path d="m13 3-8 11h6l-1 7L21 9h-8l1-6Z"/>',
    edit: '<path d="m14 5 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',
    repeat: '<path d="M4 8h13l-3-3m3 3-3 3M20 16H7l3 3m-3-3 3-3"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.book) + "</svg>";
  // Text entered during review must remain literal, even though the prototype renders templates.
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const number = value => Number(value || 0).toLocaleString("zh-CN");
  const pad = value => String(value).padStart(2, "0");
  // Calendar dates are kept as calendar strings: UTC conversion would move records across days.
  const localDate = value => new Date(value + "T12:00:00");
  const key = date => date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  const moveDay = (value, offset) => { const date = localDate(value); date.setDate(date.getDate() + offset); return key(date); };
  const shortDate = value => Number(value.slice(5, 7)) + "月" + Number(value.slice(8)) + "日";
  // Whole-second storage makes hour/minute/second switching lossless and independent of presentation.
  const timeUnits = { "分": 60, "时": 3600, "秒": 1 };
  const timeFactor = project => timeUnits[project?.timeUnit] || 60;
  const timeUnitFor = project => project?.timeUnit || "分";
  const timeAmount = (seconds, project) => seconds == null ? null : seconds / timeFactor(project);
  const timeNumber = value => Number(Number(value).toFixed(4)).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  const timeDisplay = (seconds, project) => {
    const amount = timeAmount(seconds, project), rounded = Number(amount.toFixed(4));
    return { number: (Math.abs(rounded * timeFactor(project) - seconds) > 1e-8 ? "≈" : "") + timeNumber(amount), unit: timeUnitFor(project) };
  };
  const timeText = (seconds, project) => seconds == null ? "时间未记录" : timeDisplay(seconds, project).number + timeUnitFor(project);
  // “时间” is the duration label in the UI; stored whole seconds stay separate from the optional clock time.
  const modeLabel = mode => ({ duration: "记时间", quantity: "记数量", both: "时间与数量", none: "选择打卡类型" }[mode]);
  // Primary order is a project preference, shared by tabs, input controls and saved-record summaries.
  const metricOrder = project => project.primary === "quantity" ? ["quantity", "durationSeconds"] : ["durationSeconds", "quantity"];
  // A project's quantity has one stable unit; a saved amount must never be relabelled as a different measure.
  const unitFor = project => project?.quantityUnit || "次";
  const quantityText = (value, project) => number(value) + unitFor(project);
  // New-project configuration is a separate draft: cancelling must never create a project or a record.
  const RECORD_PREVIEW_LIMIT = 5, RECORD_PAGE_SIZE = 20;
  const state = { projects: [], records: [], view: "home", search: "", newProjectDraft: null, projectId: null, metric: "durationSeconds", range: "all", graph: "cumulative", offset: 0, point: null, showAll: false, recordLimit: RECORD_PREVIEW_LIMIT, draft: null, editor: null, confirm: null, undo: null, lastDirect: 0 };
  const screen = document.getElementById("screen");
  const overlay = document.getElementById("overlay-root");
  const header = document.getElementById("app-header");
  let toastTimer;
  let nextId = 1;
  let recordObserver;

  function allocate(total, length, quantum = 1) {
    const base = Math.floor(total / length / quantum) * quantum;
    const result = Array(length).fill(base);
    let remaining = total - base * length;
    for (let i = 0; remaining > 0; i = (i + 1) % length) {
      const increment = Math.min(quantum, remaining);
      result[i] += increment;
      remaining -= increment;
    }
    return result;
  }

  // Fixture totals are authored in minutes, then converted once into the same second-based record model.
  function fixtureRecords(project, totalMinutes, quantity, count, today) {
    const previousMinutes = totalMinutes == null ? [] : allocate(totalMinutes - (today?.durationSeconds || 0) / 60, count, 5);
    const previousQuantities = quantity == null ? [] : allocate(quantity - (today?.quantity || 0), count, 10);
    const records = Array.from({ length: count }, (_, i) => {
      const date = moveDay(DEMO_TODAY, -Math.ceil((count - i) * 1.25));
      return { id: project.id + "-history-" + i, projectId: project.id, date, time: i % 3 === 0 ? "" : i % 2 ? "18:00" : "07:30", durationSeconds: previousMinutes[i] ? previousMinutes[i] * 60 : null, quantity: previousQuantities[i] || null, quantityUnit: previousQuantities[i] ? unitFor(project) : null, notes: "", createdAt: new Date(date + "T20:00:00+08:00").toISOString() };
    });
    if (today) records.push({ id: project.id + "-today", projectId: project.id, date: DEMO_TODAY, time: today.time || "", durationSeconds: today.durationSeconds ?? null, quantity: today.quantity ?? null, quantityUnit: today.quantity ? unitFor(project) : null, notes: today.notes || "", createdAt: new Date(DEMO_TODAY + "T19:00:00+08:00").toISOString() });
    return records;
  }

  function resetFixtures() {
    state.projects = [
      { id: "reading", name: "阅读", icon: "book", color: "purple", mode: "duration", primary: "durationSeconds", timeMin: 1, timeMax: 60, quantityMin: 1, quantityMax: 2000, defaultTime: null, defaultQuantity: null, direct: false },
      { id: "rope", name: "跳绳", icon: "rope", color: "rose", mode: "both", primary: "quantity", timeMin: 5, timeMax: 15, quantityMin: 500, quantityMax: 1500, defaultTime: null, defaultQuantity: null, direct: false },
      { id: "fitness", name: "健身", icon: "dumbbell", color: "orange", mode: "duration", primary: "durationSeconds", timeMin: 30, timeMax: 90, quantityMin: 1, quantityMax: 100, defaultTime: 60, defaultQuantity: null, direct: false },
      { id: "piano", name: "练琴", icon: "piano", color: "blue", mode: "duration", primary: "durationSeconds", timeMin: 15, timeMax: 45, quantityMin: 1, quantityMax: 100, defaultTime: null, defaultQuantity: null, direct: false },
      { id: "basketball", name: "投篮练习", icon: "target", color: "teal", mode: "quantity", primary: "quantity", timeMin: 1, timeMax: 120, quantityMin: 100, quantityMax: 300, defaultTime: null, defaultQuantity: 200, direct: true }
    ];
    state.records = [
      ...fixtureRecords(state.projects[0], 7710, null, 160, { durationSeconds: 1800, time: "08:00", notes: "读完一章" }),
      ...fixtureRecords(state.projects[1], 1120, 126000, 125, { durationSeconds: 600, quantity: 1000, time: "18:00" }),
      ...fixtureRecords(state.projects[2], 2530, null, 50, { durationSeconds: 3600, time: "17:30", notes: "上肢训练" }),
      ...fixtureRecords(state.projects[3], 1425, null, 45, null),
      ...fixtureRecords(state.projects[4], null, 6200, 40, null)
    ];
    // The unit lock survives deletion/undo of the last entry, protecting older history and drafts.
    state.projects.forEach(project => { project.timeUnit = "分"; project.quantityUnit = "次"; project.quantityUnitLocked = state.records.some(record => record.projectId === project.id && record.quantity != null); });
    Object.assign(state, { view: "home", search: "", newProjectDraft: null, homeScroll: 0, projectId: null, draft: null, editor: null, confirm: null, undo: null });
    overlay.innerHTML = "";
    hideToast();
  }

  const projectById = id => state.projects.find(project => project.id === id);
  const recordsFor = id => state.records.filter(record => record.projectId === id);
  const sum = (records, metric) => records.reduce((total, record) => total + (record[metric] || 0), 0);
  const metricAvailable = (records, metric) => records.some(record => record[metric] != null);
  const cssColor = project => "--accent:" + palettes[project.color].start + ";--card-start:" + palettes[project.color].start + ";--card-end:" + palettes[project.color].end;

  function tinyChart(project) {
    const records = recordsFor(project.id);
    const values = Array.from({ length: 30 }, (_, index) => sum(records.filter(record => record.date <= moveDay(DEMO_TODAY, index - 29)), project.primary));
    const low = Math.min(...values), span = Math.max(...values) - low || 1;
    const points = values.map((value, index) => [index * 145 / 29, 23 - (value - low) / span * 20]);
    let path = "M" + points[0].join(",");
    for (let i = 1; i < points.length; i++) path += "H" + points[i][0].toFixed(2) + "V" + points[i][1].toFixed(2);
    return '<svg class="card-chart" viewBox="0 0 145 26" preserveAspectRatio="none" aria-hidden="true"><path d="' + path + 'V26H0Z" fill="white" opacity=".08"/><path d="' + path + '" stroke="white" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function cardMarkup(project) {
    const records = recordsFor(project.id), metric = project.primary;
    const total = sum(records, metric), today = records.filter(record => record.date === DEMO_TODAY);
    let big = number(total), unit = unitFor(project), secondary = "";
    if (metric === "durationSeconds") {
      const display = timeDisplay(total, project), amount = timeAmount(total, project);
      big = display.number; unit = display.unit;
      if (amount >= 10000) { big = (amount / 10000).toFixed(1).replace(/\.0$/, ""); unit = "万" + unit; }
      if (project.mode === "both") secondary = metricAvailable(records, "quantity") ? quantityText(sum(records, "quantity"), project) : "数量未记录";
    } else {
      if (total >= 100000000) { big = (total / 100000000).toFixed(1).replace(/\.0$/, ""); unit = "亿" + unit; }
      else if (total >= 10000) { big = (total / 10000).toFixed(1).replace(/\.0$/, ""); unit = "万" + unit; }
      if (project.mode === "both") secondary = metricAvailable(records, "durationSeconds") ? "时间 " + timeText(sum(records, "durationSeconds"), project) : "时间未记录";
    }
    if (records.length && !metricAvailable(records, metric)) big = "—";
    const todayParts = [];
    if (metricAvailable(today, "quantity") && project.mode !== "duration") todayParts.push(quantityText(sum(today, "quantity"), project));
    if (metricAvailable(today, "durationSeconds") && project.mode !== "quantity") todayParts.push(timeText(sum(today, "durationSeconds"), project));
    const directText = defaultDescription(project);
    // Compact summary tiles keep only one small caption; charts belong in the detail screen.
    let caption = project.direct ? "记" + directText : secondary || (todayParts.length ? "今日 " + todayParts.join(" · ") : "累计");
    if (project.mode === "both" && metric === "quantity" && !project.direct) caption = metricAvailable(records, "durationSeconds") ? timeText(sum(records, "durationSeconds"), project).replace("小时", "时").replace("分钟", "分") : "未记时间";
    if (project.direct) caption = caption.replace("分钟", "分").replace("、", "/");
    return '<article class="project-card" style="' + cssColor(project) + '"><button class="card-main" data-action="record" data-id="' + project.id + '" aria-label="记录' + escape(project.name) + '"><span class="card-icon">' + icon(project.icon) + '</span><span class="card-number-line ' + (unit.length > 2 ? "wide-unit" : "") + (String(big).length > 6 ? " long-number" : "") + '"><span class="card-number">' + big + '</span><span class="card-unit">' + escape(unit) + '</span></span><span class="card-footer"><span class="card-name">' + escape(project.name) + '</span><span class="card-caption">' + escape(caption) + '</span></span></button><button class="card-detail" data-action="detail" data-id="' + project.id + '" aria-label="查看' + escape(project.name) + '统计"><span>' + icon("chevron") + '</span></button></article>';
  }

  function defaultDescription(project) {
    const parts = [];
    if (project.mode !== "quantity" && project.defaultTime) parts.push(project.defaultTime + timeUnitFor(project));
    if (project.mode !== "duration" && project.defaultQuantity) parts.push(quantityText(project.defaultQuantity, project));
    return parts.join("、");
  }

  // Match only names, retaining project order and totals; normalize width and case for predictable search.
  const searchKey = value => value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  const matchingProjects = () => state.projects.filter(project => searchKey(project.name).includes(searchKey(state.search)));

  function homeResultsMarkup() {
    const projects = matchingProjects();
    return '<div class="project-grid' + (!state.projects.length ? " empty-grid" : "") + '">' + projects.map(cardMarkup).join("") + '<button class="add-card" data-action="create"><span class="add-circle">' + icon("plus") + '</span><span>新增项目</span>' + (!state.projects.length ? '<span class="empty-caption">添加一件值得持续投入的事</span>' : "") + '</button></div>';
  }

  function searchStatus() {
    if (!searchKey(state.search)) return "";
    const count = matchingProjects().length;
    return count ? "找到 " + count + " 个项目" : "没有匹配的项目";
  }

  // The brand placeholder keeps the home title-free; the accessible label still names the search action.
  function renderHome() {
    return '<div class="home-search" role="search">' + icon("search") + '<input id="project-search" type="search" value="' + escape(state.search) + '" placeholder="愚公打卡" aria-label="搜索项目" aria-controls="home-results" autocomplete="off" spellcheck="false"><button class="search-clear" data-action="clear-search" aria-label="清空搜索"' + (state.search ? "" : " hidden") + '>' + icon("close") + '</button></div><p id="search-status" class="search-status' + (matchingProjects().length ? " visually-hidden" : "") + '" role="status">' + searchStatus() + '</p><div id="home-results">' + homeResultsMarkup() + '</div>';
  }

  // Update results without replacing the input, protecting keyboard focus, caret and Chinese composition.
  function updateSearch(value) {
    state.search = value;
    document.getElementById("home-results").innerHTML = homeResultsMarkup();
    const status = document.getElementById("search-status");
    status.textContent = searchStatus();
    status.classList.toggle("visually-hidden", matchingProjects().length > 0 || !searchKey(value));
    screen.querySelector(".search-clear").hidden = !value;
    screen.scrollTop = 0;
    state.homeScroll = 0;
  }

  function bounds() {
    const anchor = localDate(DEMO_TODAY);
    let start, end;
    if (state.range === "day") start = end = moveDay(DEMO_TODAY, state.offset);
    else if (state.range === "week") {
      start = moveDay(DEMO_TODAY, -((anchor.getDay() + 6) % 7) + state.offset * 7);
      end = moveDay(start, 6);
    } else if (state.range === "month") {
      const date = new Date(anchor.getFullYear(), anchor.getMonth() + state.offset, 1, 12);
      start = key(date); end = key(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
    } else if (state.range === "year") {
      const year = anchor.getFullYear() + state.offset;
      start = year + "-01-01"; end = year + "-12-31";
    } else {
      const records = recordsFor(state.projectId);
      start = records.length ? records.reduce((value, record) => record.date < value ? record.date : value, DEMO_TODAY) : DEMO_TODAY;
      end = DEMO_TODAY;
    }
    return { start, end, actualEnd: end > DEMO_TODAY ? DEMO_TODAY : end };
  }

  // Rebuilding from records is deliberate: editing an old entry must change every later cumulative point.
  function series(project) {
    const range = bounds(), records = recordsFor(project.id), metric = state.metric;
    const selected = records.filter(record => record.date >= range.start && record.date <= range.actualEnd);
    const baseline = sum(records.filter(record => record.date < range.start), metric);
    let groups = [];
    if (state.range === "day") {
      groups = selected.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((record, index) => ({ label: record.time || "第" + (index + 1) + "条", records: [record] }));
    } else if (["week", "month"].includes(state.range)) {
      for (let date = range.start; date <= range.actualEnd; date = moveDay(date, 1)) groups.push({ label: state.range === "week" ? ["日", "一", "二", "三", "四", "五", "六"][localDate(date).getDay()] : String(Number(date.slice(8))), records: selected.filter(record => record.date === date) });
    } else {
      const first = state.range === "year" ? range.start.slice(0, 4) + "-01" : range.start.slice(0, 7);
      const last = range.actualEnd.slice(0, 7);
      for (let date = first + "-01"; date.slice(0, 7) <= last;) {
        const prefix = date.slice(0, 7);
        groups.push({ label: Number(prefix.slice(5)) + "月", records: selected.filter(record => record.date.startsWith(prefix)) });
        const value = localDate(date); value.setMonth(value.getMonth() + 1); date = key(value);
      }
    }
    const increments = groups.map(group => sum(group.records, metric));
    let running = baseline;
    let values = increments.map(value => { running += value; return state.graph === "cumulative" ? running : value; });
    let labels = groups.map(group => group.label);
    if (state.range === "day" && !groups.length) { values = [state.graph === "cumulative" ? baseline : 0]; labels = ["当日"]; }
    if (["all", "day"].includes(state.range) && state.graph === "cumulative" && values.length) { values.unshift(state.range === "all" ? 0 : baseline); labels.unshift("开始"); }
    const periodLabel = state.range === "all" ? "全部记录" : state.range === "day" ? shortDate(range.start) : state.range === "year" ? range.start.slice(0, 4) + "年" : shortDate(range.start) + "—" + shortDate(range.actualEnd);
    return { ...range, values, labels, selected, baseline, added: sum(selected, metric), periodLabel };
  }

  function chartValue(value, project) {
    if (state.metric === "durationSeconds") return timeDisplay(value, project).number;
    return value >= 10000 ? (value / 10000).toFixed(1).replace(/\.0$/, "") + "万" : number(Math.round(value));
  }

  function chartMarkup(data, project) {
    const values = data.values, width = 310, height = 176, left = 39, right = 8, top = 16, bottom = 25;
    if (!values.length) return '<svg class="main-chart" viewBox="0 0 310 176" role="img" aria-label="当前范围暂无记录"><text x="155" y="87" text-anchor="middle">这段时间还没有记录</text></svg>';
    // Empty/small time charts use one selected unit as their scale, rather than one raw second.
    const maximum = Math.max(...values, state.metric === "durationSeconds" ? timeFactor(project) : 1), minimum = state.graph === "cumulative" && state.range !== "all" ? Math.min(data.baseline, ...values) : 0;
    const span = maximum - minimum || 1, plotWidth = width - left - right, plotHeight = height - top - bottom;
    const x = index => left + (values.length === 1 ? plotWidth / 2 : index / (values.length - 1) * plotWidth);
    const y = value => top + plotHeight - (value - minimum) / span * plotHeight;
    let markup = '<svg class="main-chart" viewBox="0 0 310 176" role="img" aria-label="' + (state.graph === "cumulative" ? "累计" : "分布") + (state.metric === "durationSeconds" ? "时间（" + timeUnitFor(project) + "）" : "数量（" + escape(unitFor(project)) + "）") + '图">';
    for (let i = 0; i < 3; i++) {
      const value = minimum + span * i / 2, lineY = y(value);
      markup += '<line class="chart-grid" x1="' + left + '" y1="' + lineY + '" x2="302" y2="' + lineY + '"/><text x="31" y="' + (lineY + 3) + '" text-anchor="end">' + chartValue(value, project) + '</text>';
    }
    if (state.graph === "cumulative") {
      let path = "M" + x(0) + "," + y(values[0]);
      for (let i = 1; i < values.length; i++) path += "H" + x(i) + "V" + y(values[i]);
      markup += '<path d="' + path + 'V151H' + x(0) + 'Z" fill="' + palettes[project.color].start + '" opacity=".065"/><path d="' + path + '" fill="none" stroke="' + palettes[project.color].start + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
    } else {
      const slot = plotWidth / Math.max(values.length, 1), barWidth = Math.min(23, slot * .56);
      values.forEach((value, index) => {
        const barX = left + slot * (index + .5) - barWidth / 2;
        markup += '<rect x="' + barX + '" y="' + y(value) + '" width="' + barWidth + '" height="' + Math.max(0, 151 - y(value)) + '" rx="3" fill="' + palettes[project.color].start + '" opacity="' + (state.point == null || state.point === index ? ".88" : ".35") + '"/>';
      });
    }
    const labelStep = Math.max(1, Math.ceil(values.length / 5));
    values.forEach((value, index) => {
      const pointX = state.graph === "distribution" ? left + plotWidth / values.length * (index + .5) : x(index);
      if (index % labelStep === 0 || index === values.length - 1) markup += '<text x="' + pointX + '" y="171" text-anchor="middle">' + escape(data.labels[index]) + '</text>';
      if (state.graph === "cumulative" && (index === values.length - 1 || state.point === index)) markup += '<circle cx="' + pointX + '" cy="' + y(value) + '" r="3.3" fill="' + palettes[project.color].start + '" stroke="white" stroke-width="1.8"/>';
      markup += '<rect data-action="chart-point" data-index="' + index + '" x="' + Math.max(left, pointX - Math.max(6, plotWidth / values.length / 2)) + '" y="8" width="' + Math.max(12, plotWidth / values.length) + '" height="145" fill="transparent"/>';
    });
    return markup + "</svg>";
  }

  function detailMarkup(project) {
    const records = recordsFor(project.id), data = series(project);
    const mainTotal = sum(records, project.primary), secondaryMetric = metricOrder(project)[1];
    const hasBoth = (project.mode !== "quantity" || metricAvailable(records, "durationSeconds")) && (project.mode !== "duration" || metricAvailable(records, "quantity"));
    const totalMarkup = project.primary === "durationSeconds" ? escape(timeDisplay(mainTotal, project).number) + '<span class="lifetime-unit">' + timeUnitFor(project) + '</span>' : number(mainTotal) + '<span class="lifetime-unit">' + escape(unitFor(project)) + '</span>';
    const secondary = hasBoth ? secondaryMetric === "durationSeconds" ? "累计时间 " + (metricAvailable(records, secondaryMetric) ? timeText(sum(records, secondaryMetric), project) : "未记录") : "累计数量 " + (metricAvailable(records, secondaryMetric) ? quantityText(sum(records, secondaryMetric), project) : "未记录") : "每一次投入，都在这里留下记录";
    const tabs = hasBoth ? '<div class="metric-selector">' + metricOrder(project).map(metric => `<button data-action="metric" data-value="${metric}" class="${state.metric === metric ? 'active' : ''}" aria-pressed="${state.metric === metric}">${metric === "durationSeconds" ? "时间" : "数量"}</button>`).join("") + '</div>' : "";
    // Keep the default chart free of static guidance; exact values appear only after a point is selected.
    const selectedIndex = state.point, selectedValue = data.values[selectedIndex] ?? data.baseline;
    const pointReadout = selectedIndex == null ? "" : `<div class="chart-point-value" role="status">${escape(data.labels[selectedIndex])} · ${state.graph === "cumulative" ? "累计" : "新增"}<strong>${escape(state.metric === "durationSeconds" ? timeText(selectedValue, project) : quantityText(selectedValue, project))}</strong></div>`;
    const periods = [["day", "日"], ["week", "周"], ["month", "月"], ["year", "年"], ["all", "全部"]].map(([value, label]) => `<button data-action="range" data-value="${value}" class="${state.range === value ? 'active' : ''}" aria-pressed="${state.range === value}">${label}</button>`).join("");
    return `<div class="detail-heading"><span class="project-badge">${icon(project.icon)}</span><h1>${escape(project.name)}</h1></div>
      <div class="lifetime-caption">累计${project.primary === "durationSeconds" ? "时间" : "数量"}</div><div class="lifetime-number">${totalMarkup}</div><div class="lifetime-secondary">${escape(secondary)}</div>${tabs}
      <section class="chart-card" aria-label="练习统计"><div class="chart-top"><div class="small-segment" role="group" aria-label="图表类型"><button data-action="graph" data-value="cumulative" class="${state.graph === 'cumulative' ? 'active' : ''}" aria-pressed="${state.graph === 'cumulative'}">累计</button><button data-action="graph" data-value="distribution" class="${state.graph === 'distribution' ? 'active' : ''}" aria-pressed="${state.graph === 'distribution'}">分布</button></div></div>
      <div class="period-selector">${periods}</div><div class="period-nav"><button data-action="period" data-delta="-1" aria-label="上一周期" ${state.range === 'all' ? 'disabled' : ''}>${icon("back")}</button><strong>${data.periodLabel}</strong><button data-action="period" data-delta="1" aria-label="下一周期" ${state.range === 'all' || state.offset >= 0 ? 'disabled' : ''}>${icon("chevron")}</button></div>
      ${chartMarkup(data, project)}${pointReadout}</section>
      ${recordSectionMarkup(records, data.selected)}<button class="settings-link" data-action="settings"><span>项目设置</span>${icon("chevron")}</button><button class="project-delete" data-action="delete-project">删除本项目</button>`;
  }

  // Stable date/creation ordering prevents duplicate or skipped rows when successive slices are appended.
  function sortedRecordRows(records) {
    return records.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  function recordPageFooter(loaded, total) {
    return loaded < total ? '<button class="show-all" data-action="more-records" data-record-page-trigger>加载更多</button>' : '<div class="records-end" role="status" tabindex="-1">已显示全部记录</div>';
  }

  function recordSectionMarkup(records, selected) {
    // Preview follows the chart period; View all explicitly opens the project's complete history in pages.
    const currentRows = sortedRecordRows(state.showAll ? records : selected);
    const visibleRows = currentRows.slice(0, state.showAll ? state.recordLimit : RECORD_PREVIEW_LIMIT);
    const footer = state.showAll ? recordPageFooter(visibleRows.length, records.length) : records.length > visibleRows.length ? '<button class="show-all" data-action="all-records" aria-controls="record-rows" aria-expanded="false">查看全部记录</button>' : "";
    return `<section class="record-section"><div class="section-head records-heading"><h2 tabindex="-1">打卡记录</h2>${state.showAll ? '<button data-action="collapse-records" aria-controls="record-rows" aria-expanded="true">收起</button>' : ''}</div><div class="record-list"><div id="record-rows">${visibleRows.length ? visibleRows.map(recordMarkup).join("") : '<div class="empty-records">这段时间还没有记录</div>'}</div><div id="record-page-footer">${footer}</div></div><p id="record-count" class="record-count" aria-live="polite">${state.showAll ? '已显示 ' + visibleRows.length + ' / 共 ' : '共 '}${records.length} 条记录</p></section>`;
  }

  function loadMoreRecords() {
    if (state.view !== "detail" || !state.showAll || overlay.firstElementChild) return;
    const rows = document.getElementById("record-rows"), footer = document.getElementById("record-page-footer");
    if (!rows || !footer) return;
    const records = sortedRecordRows(recordsFor(state.projectId)), loaded = rows.querySelectorAll(".record-row").length;
    if (loaded >= records.length) return;
    const keyboardFocus = footer.contains(document.activeElement);
    recordObserver?.disconnect();
    state.recordLimit = Math.min(records.length, loaded + RECORD_PAGE_SIZE);
    // Append a page in place, preserving existing rows, chart state and the user's scroll position.
    rows.insertAdjacentHTML("beforeend", records.slice(loaded, state.recordLimit).map(recordMarkup).join(""));
    footer.innerHTML = recordPageFooter(state.recordLimit, records.length);
    document.getElementById("record-count").textContent = "已显示 " + state.recordLimit + " / 共 " + records.length + " 条记录";
    if (keyboardFocus) footer.firstElementChild?.focus({ preventScroll: true });
    initializeRecordPagination();
  }

  function initializeRecordPagination() {
    recordObserver?.disconnect();
    const trigger = screen.querySelector("[data-record-page-trigger]");
    if (state.view !== "detail" || !state.showAll || !trigger || overlay.firstElementChild || !window.IntersectionObserver) return;
    // The main page owns scrolling; a visible button also supports keyboard/manual loading if needed.
    recordObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting && entry.target.isConnected)) loadMoreRecords();
    }, { root: screen, rootMargin: "0px 0px 160px 0px" });
    recordObserver.observe(trigger);
  }

  function recordMarkup(record) {
    const values = [];
    // Records carry the unit snapshot as well as the project lock, so editing and undo retain their meaning.
    const project = { ...projectById(record.projectId), quantityUnit: record.quantityUnit || unitFor(projectById(record.projectId)) };
    metricOrder(project).forEach(metric => {
      if (record[metric] != null) values.push(metric === "durationSeconds" ? timeText(record[metric], project) : quantityText(record[metric], project));
    });
    const date = record.date === DEMO_TODAY ? "今天" : shortDate(record.date);
    return '<button class="record-row" data-action="edit-record" data-id="' + record.id + '" aria-label="编辑' + escape(date + values.join("、")) + '"><span><span class="record-main">' + escape(values.join(" · ")) + '</span><span class="record-meta" style="display:block">' + date + (record.time ? " " + record.time : "") + (record.notes ? " · " + escape(record.notes.length > 16 ? record.notes.slice(0, 16) + "…" : record.notes) : "") + '</span></span>' + icon("chevron") + '</button>';
  }

  function render() {
    // Replaced nodes must not leave a pagination callback attached to an earlier project or period.
    recordObserver?.disconnect();
    const oldView = screen.dataset.view, oldScroll = screen.scrollTop;
    const project = projectById(state.projectId);
    const back = state.view !== "home" ? '<button class="header-back" data-action="back" aria-label="返回">' + icon("back") + (state.view === "editor" ? "取消" : "") + '</button>' : "";
    header.innerHTML = back + '<span class="header-title">' + (state.view === "editor" ? state.editor?.id ? "项目设置" : "新增项目" : "") + '</span><div class="capsule" aria-hidden="true"><b>···</b><i></i><span></span></div>';
    const color = state.view === "editor" ? state.editor.color : project?.color || "purple";
    document.querySelector(".device").style.setProperty("--accent", palettes[color].start);
    screen.dataset.view = state.view;
    if (state.view === "home") screen.innerHTML = renderHome();
    else if (state.view === "detail" && project) screen.innerHTML = detailMarkup(project);
    else if (state.view === "editor") screen.innerHTML = editorMarkup();
    else { state.view = "home"; screen.innerHTML = renderHome(); }
    screen.scrollTop = oldView === state.view ? oldScroll : state.view === "home" ? state.homeScroll || 0 : 0;
    initializeRecordPagination();
  }

  function showHome() { state.view = "home"; state.projectId = null; overlay.innerHTML = ""; state.draft = null; render(); }
  function showDetail(id) { const project = projectById(id); if (!project) return; if (state.view === "home") state.homeScroll = screen.scrollTop; Object.assign(state, { view: "detail", projectId: id, metric: project.primary, range: "all", graph: "cumulative", offset: 0, point: null, showAll: false, recordLimit: RECORD_PREVIEW_LIMIT }); overlay.innerHTML = ""; state.draft = null; render(); }

  function openRecord(id, options = {}) {
    const project = projectById(id); if (!project) return;
    const record = options.recordId ? state.records.find(value => value.id === options.recordId) : null;
    // Every opening starts from configured defaults or the saved record; dismissed input is never resumed.
    state.draft = {
      projectId: id, recordId: record?.id || null,
      durationAmount: record ? timeAmount(record.durationSeconds, project) ?? "" : project.mode !== "quantity" ? preferredValue(project, "durationAmount") : "",
      timeUnit: timeUnitFor(project),
      quantity: record ? record.quantity ?? "" : project.mode !== "duration" ? preferredValue(project, "quantity") : "",
      showTime: project.mode !== "quantity" || record?.durationSeconds != null,
      showQuantity: project.mode !== "duration" || record?.quantity != null,
      date: record?.date || DEMO_TODAY, time: record?.time || "", notes: record?.notes || "",
      explicit: true,
      supplement: Boolean(options.supplement), notesOpen: false, preciseField: null, changed: false
    };
    renderSheet();
    overlay.querySelector(".close-button")?.focus({ preventScroll: true });
  }

  // Use a difference-based midpoint to avoid overflowing when both bounds are large safe integers.
  const midpoint = (minimum, maximum) => minimum + Math.floor((maximum - minimum) / 2);
  const limitsFor = (project, kind) => kind !== "quantity" ? { min: project.timeMin, max: project.timeMax } : { min: project.quantityMin, max: project.quantityMax };

  function preferredValue(project, kind) {
    const limits = limitsFor(project, kind), value = kind !== "quantity" ? project.defaultTime : project.defaultQuantity;
    return Math.min(limits.max, Math.max(1, limits.min, value == null ? midpoint(limits.min, limits.max) : Math.floor(Number(value))));
  }

  // Shrinking future input limits must not rewrite an old record; unchanged historical values remain valid.
  function validateRecordAmount(value, kind, project, original = null) {
    if (value == null || value === original) return;
    const limits = limitsFor(project, kind);
    if (value < limits.min || value > limits.max) throw new Error((kind !== "quantity" ? "时间" : "数量") + "请填写" + limits.min + "～" + limits.max + (kind !== "quantity" ? timeUnitFor(project) : unitFor(project)) + (kind === "quantity" ? "之间的整数。" : "之间的有效时间。"));
  }

  function sliderRange(kind, project) {
    // The range controls the value bounds; integer increments are intrinsic rather than a project setting.
    const current = Number(state.draft[kind]) || state.draft.lastSelected?.[kind] || preferredValue(project, kind);
    const limits = limitsFor(project, kind);
    const source = state.records.find(record => record.id === state.draft.recordId);
    const original = kind === "quantity" ? source?.quantity : timeAmount(source?.durationSeconds, project);
    const minimum = original == null ? limits.min : Math.min(limits.min, original);
    const maximum = original == null ? limits.max : Math.max(limits.max, original);
    const span = maximum - minimum;
    const position = value => span ? (value - minimum) / span * 100 : 50;
    // A zero lower bound must not turn sliding into the removed skip/empty-record action.
    const inputMinimum = Math.max(minimum, kind === "quantity" ? 1 : 1 / timeFactor(project));
    return { position, minimum, maximum, inputMinimum, current };
  }

  function fieldMarkup(kind, project) {
    const draft = state.draft, isTime = kind !== "quantity", label = isTime ? "时间" : "数量", unit = isTime ? timeUnitFor(project) : unitFor(project);
    const range = sliderRange(kind, project), active = draft[kind] !== "" && draft[kind] != null;
    const precision = draft.preciseField === kind;
    const display = active ? isTime ? timeDisplay(Number(draft[kind]) * timeFactor(project), project).number : number(draft[kind]) : "—";
    // Native range keeps the thumb under the finger; the input boundary rounds only the recorded amount.
    const scale = '<div class="slider-control"><input class="metric-slider" type="range" min="' + range.minimum + '" max="' + range.maximum + '" step="any" value="' + (active ? draft[kind] : range.current) + '" style="--slider-fill:' + range.position(active ? Number(draft[kind]) : range.current) + '%" data-slider="' + kind + '" aria-label="本次' + label + '" aria-valuetext="' + (active ? display + escape(unit) : "未记录") + '"' + (range.minimum === range.maximum ? ' disabled' : '') + '></div>';
    return '<section class="ruler-field ' + (!active ? "ruler-inactive" : "") + '" data-field="' + kind + '"><div class="ruler-field-head"><span class="ruler-label">' + label + '</span><button class="ruler-readout" data-action="precise" data-field="' + kind + '" aria-label="精确输入' + label + '"><strong>' + display + '</strong><small>' + escape(unit) + '</small></button></div>' + (precision ? '<div class="precise-input-row"><input class="metric-input" inputmode="' + (isTime ? "decimal" : "numeric") + '" data-draft="' + kind + '" value="' + escape(draft[kind]) + '" aria-label="精确' + label + '"><button data-action="finish-precise">完成</button></div>' : scale) + '</section>';
  }

  function updateSlider(kind, value, syncThumb = true) {
    if (!state.draft) return;
    state.draft[kind] = value; state.draft.changed = true;
    const field = overlay.querySelector('.ruler-field[data-field="' + kind + '"]');
    if (!field) return;
    field.classList.toggle("ruler-inactive", value <= 0);
    const project = projectById(state.draft.projectId);
    field.querySelector(".ruler-readout strong").textContent = value > 0 ? kind === "quantity" ? number(value) : timeDisplay(value * timeFactor(project), project).number : "—";
    const slider = field.querySelector("[data-slider]");
    if (slider) {
      // Keep continuous pointer travel separate from integer data to avoid a thumb that jumps between steps.
      if (syncThumb) slider.value = value;
      slider.style.setProperty("--slider-fill", sliderRange(kind, project).position(Number(slider.value)) + "%");
      slider.setAttribute("aria-valuenow", String(value));
      slider.setAttribute("aria-valuetext", field.querySelector(".ruler-readout").textContent);
    }
    updateSubmitButton();
    document.getElementById("record-error").textContent = "";
  }

  function initializeSliders() {
    overlay.querySelectorAll("[data-slider]").forEach(slider => {
      const kind = slider.dataset.slider, range = sliderRange(kind, projectById(state.draft.projectId));
      const clamp = value => Math.max(range.inputMinimum, Math.min(range.maximum, value));
      // Typed fractional time and historical values remain exact until this control is deliberately moved.
      slider.addEventListener("input", () => {
        const raw = Number(slider.value);
        updateSlider(kind, clamp(Math.round(raw)), false);
      });
      // Reconcile the thumb once the gesture ends; input and release still require explicit Record to save.
      slider.addEventListener("change", () => { if (state.draft) updateSlider(kind, state.draft[kind]); });
      slider.addEventListener("keydown", event => {
        const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[event.key];
        if (direction == null && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const current = Number(state.draft[kind]) || range.current;
        const next = direction > 0 ? Math.floor(current) + direction : Math.ceil(current) + direction;
        updateSlider(kind, event.key === "Home" ? range.inputMinimum : event.key === "End" ? range.maximum : clamp(next));
      });
    });
  }

  function submitLabel() {
    const draft = state.draft;
    if (draft.recordId) return "保存修改";
    const values = [];
    const project = projectById(draft.projectId);
    metricOrder(project).forEach(metric => {
      const amount = metric === "durationSeconds" ? draft.durationAmount : draft.quantity;
      if (amount !== "" && Number(amount) > 0) values.push(metric === "durationSeconds" ? timeText(Number(amount) * timeFactor(project), project) : quantityText(amount, project));
    });
    return values.length ? "记录 " + values.join("、") : "记录";
  }

  function renderSheet() {
    const draft = state.draft; if (!draft) return;
    const project = projectById(draft.projectId); if (!project) { closeSheet(); return; }
    state.confirm = null;
    const dateFields = draft.supplement
      ? '<div id="record-date-fields" class="supplement-fields"><label class="supplement-row" data-action="pick-temporal"><span>日期</span><input type="date" data-draft="date" value="' + escape(draft.date) + '" max="' + DEMO_TODAY + '" aria-label="日期"></label><label class="supplement-row" data-action="pick-temporal"><span>时间</span><input type="time" data-draft="time" value="' + escape(draft.time) + '" aria-label="时间"></label></div>'
      : "";
    // An expanded date section precedes the entire notes section, including its disclosure label.
    // When date is collapsed, both entry points still share the compact bottom row.
    const notesToggle = '<button class="notes-toggle" data-action="toggle-notes" aria-controls="record-notes" aria-expanded="' + Boolean(draft.notesOpen) + '"><span>' + icon("edit") + (draft.notes ? "备注 · 已填写" : "添加备注") + '</span></button>';
    const tools = '<div class="sheet-tools">' + (draft.supplement ? "" : notesToggle) + '<button class="date-toggle" data-action="supplement" aria-controls="record-date-fields" aria-expanded="' + draft.supplement + '">' + (draft.date === DEMO_TODAY ? "今天" : shortDate(draft.date)) + (draft.time ? " " + draft.time : "") + icon("chevron") + '</button></div>';
    const notesInput = draft.notesOpen ? '<textarea id="record-notes" class="notes-input" maxlength="500" data-draft="notes" aria-label="备注" placeholder="留下一点当时的感受">' + escape(draft.notes) + '</textarea>' : "";
    const metricFields = metricOrder(project).map(metric => metric === "durationSeconds" ? draft.showTime ? fieldMarkup("durationAmount", project) : "" : draft.showQuantity ? fieldMarkup("quantity", project) : "").join("");
    overlay.innerHTML = '<div class="overlay" data-scrim="true"><section class="sheet light-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" style="' + cssColor(project) + '"><div class="sheet-heading"><h2 id="sheet-title">' + (draft.recordId ? "编辑记录" : escape(project.name)) + '</h2><button class="close-button" data-action="close-sheet" aria-label="关闭填写面板">' + icon("close") + '</button></div>' + metricFields + tools + dateFields + (draft.supplement ? notesToggle : "") + notesInput + '<p id="record-error" class="form-error" role="alert"></p><button id="save-record" class="primary-button" data-action="save-record" aria-label="' + escape(submitLabel()) + '">' + (draft.recordId ? "保存修改" : "记录") + '</button>' + (draft.recordId ? '<button class="secondary-button delete-record-button" data-action="delete-record">删除这条记录</button>' : "") + '</section></div>';
    initializeSliders();
  }

  function updateSubmitButton() {
    const button = document.getElementById("save-record");
    if (!button || !state.draft) return;
    button.textContent = state.draft.recordId ? "保存修改" : "记录";
    button.setAttribute("aria-label", submitLabel());
  }

  function markExplicit() {
    if (!state.draft) return;
    state.draft.explicit = true;
    overlay.querySelectorAll(".field-tip").forEach(element => { element.textContent = "选好后点记录"; });
  }

  function closeSheet() {
    // Dismissal discards only this recording session; the independent new-project draft is unaffected.
    state.draft = null; state.confirm = null; overlay.innerHTML = "";
    initializeRecordPagination();
  }

  function readPositive(value) {
    if (value === "" || value == null) return null;
    const text = String(value).trim();
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) <= 0) throw new Error("请填写大于0的整数。");
    return Number(text);
  }

  // Fractions are permitted only when they resolve to whole seconds; quantity remains integer-only.
  function readTime(value, project, originalSeconds = null) {
    if (value === "" || value == null) return null;
    const text = String(value).trim(), amount = Number(text);
    if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(amount) || amount <= 0) throw new Error("请填写大于0的有效时间。");
    if (originalSeconds != null && amount === timeAmount(originalSeconds, project)) return originalSeconds;
    const raw = amount * timeFactor(project), seconds = Math.round(raw);
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || Math.abs(raw - seconds) > 1e-7) throw new Error("时间换算后需精确到整秒，且不能超出可保存范围。");
    return seconds;
  }

  function saveRecord() {
    const draft = state.draft; if (!draft) return;
    try {
      const existing = draft.recordId ? state.records.find(record => record.id === draft.recordId) : null;
      if (draft.recordId && !existing) throw new Error("这条记录已经不存在，请关闭后重新查看。");
      const project = projectById(draft.projectId); if (!project) throw new Error("项目已经不存在。");
      // Convert exactly once at the boundary; aggregation, edits and undo all retain whole seconds.
      const durationSeconds = readTime(draft.durationAmount, project, existing?.durationSeconds), quantity = readPositive(draft.quantity);
      // Removing the skip action makes enabled new metrics mandatory; historical nulls remain untouched.
      if (draft.showTime && durationSeconds == null && (!existing || existing.durationSeconds != null)) throw new Error("请填写本次时间。");
      if (draft.showQuantity && quantity == null && (!existing || existing.quantity != null)) throw new Error("请填写本次数量。");
      if (durationSeconds == null && quantity == null) throw new Error("至少填写一项本次时间或数量。");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(localDate(draft.date).getTime()) || key(localDate(draft.date)) !== draft.date) throw new Error("请选择有效的发生日期。");
      if (draft.date > DEMO_TODAY) throw new Error("请选择今天或之前的发生日期。");
      if (draft.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) throw new Error("请选择有效的时间点。");
      if (Array.from(draft.notes).length > 500) throw new Error("备注最多500个字符。");
      validateRecordAmount(timeAmount(durationSeconds, project), "durationAmount", project, timeAmount(existing?.durationSeconds, project));
      validateRecordAmount(quantity, "quantity", project, existing?.quantity);
      const otherRecords = recordsFor(draft.projectId).filter(record => record.id !== draft.recordId);
      if (!Number.isSafeInteger(sum(otherRecords, "durationSeconds") + (durationSeconds || 0)) || !Number.isSafeInteger(sum(otherRecords, "quantity") + (quantity || 0))) throw new Error("累计数值超出当前可准确保存的范围。");
      const reviewTime = new Date(new Date(DEMO_TODAY + "T21:00:00+08:00").getTime() + nextId * 1000).toISOString();
      const record = { id: existing?.id || "entry-" + nextId++, projectId: draft.projectId, date: draft.date, time: draft.time, notes: draft.notes.trim(), durationSeconds, quantity, quantityUnit: quantity == null ? null : unitFor(project), createdAt: existing?.createdAt || reviewTime, updatedAt: reviewTime };
      if (existing) state.records = state.records.map(value => value.id === record.id ? record : value);
      else state.records.push(record);
      if (quantity != null) project.quantityUnitLocked = true;
      closeSheet(); render();
      const summary = metricOrder(project).filter(metric => record[metric] != null).map(metric => metric === "durationSeconds" ? timeText(record[metric], project) : quantityText(record[metric], project)).join(" · ");
      showToast((existing ? "已修改 " : "已记录 ") + summary, existing ? null : { type: "create", record });
    } catch (error) { const target = document.getElementById("record-error"); if (target) target.textContent = error.message; }
  }

  function recordProject(id) {
    const project = projectById(id); if (!project) return;
    if (project.direct) {
      const valid = (project.mode === "quantity" || project.defaultTime > 0) && (project.mode === "duration" || project.defaultQuantity > 0);
      if (valid) {
        if (Date.now() - state.lastDirect < 300) return;
        state.lastDirect = Date.now();
        openRecord(id);
        saveRecord();
        return;
      }
    }
    openRecord(id);
  }

  function showToast(message, undo = null) {
    clearTimeout(toastTimer); state.undo = undo;
    const toast = document.getElementById("toast");
    toast.innerHTML = '<span class="toast-message">' + icon("check") + escape(message) + '</span>' + (undo ? '<button data-action="undo">撤销</button>' : "");
    toast.classList.add("visible");
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() { clearTimeout(toastTimer); document.getElementById("toast").classList.remove("visible"); state.undo = null; }
  function undoLast() {
    const undo = state.undo; if (!undo || !projectById(undo.record.projectId)) return;
    if (undo.type === "create") state.records = state.records.filter(record => record.id !== undo.record.id);
    else if (undo.type === "delete" && !state.records.some(record => record.id === undo.record.id)) state.records.push(undo.record);
    hideToast(); render(); showToast("已撤销");
  }

  function openEditor(project = null) {
    if (state.view === "home") state.homeScroll = screen.scrollTop;
    // Keep raw, potentially incomplete text in a clone; validation belongs to explicit creation only.
    state.editor = project ? { ...project, defaultTime: preferredValue(project, "durationAmount"), defaultQuantity: preferredValue(project, "quantity") } : state.newProjectDraft ? { ...state.newProjectDraft } : { id: null, name: "", icon: "book", color: "purple", mode: "duration", primary: "durationSeconds", timeUnit: "分", quantityUnit: "次", quantityUnitLocked: false, timeMin: 1, timeMax: 120, quantityMin: 1, quantityMax: 100, defaultTime: 60, defaultQuantity: 50, direct: false };
    normalizeEditorDefault("time"); normalizeEditorDefault("quantity");
    state.editorReturn = project ? "detail" : "home";
    state.editorBaseline = JSON.stringify(state.editor);
    state.view = "editor"; overlay.innerHTML = ""; state.draft = null; render();
  }

  function settingInput(label, property, placeholder = "选填", inputmode = "numeric") {
    return '<label class="setting-row"><span>' + label + '</span><input data-editor="' + property + '" value="' + escape(state.editor[property]) + '" placeholder="' + placeholder + '" inputmode="' + inputmode + '"></label>';
  }

  // A separator communicates the range visually; explicit accessible labels still distinguish its bounds.
  function rangeSettingMarkup(label, kind) {
    return `<div class="setting-row range-row"><span>${label}范围</span><div class="range-values">${[["Min", "最小"], ["Max", "最大"]].map(([suffix, text]) => `<label class="range-value"><input data-editor="${kind + suffix}" value="${escape(state.editor[kind + suffix])}" style="--value-chars:${Math.max(1, String(state.editor[kind + suffix]).length)}" inputmode="numeric" aria-label="${text + label}"></label>`).join('<span class="range-separator" aria-hidden="true">–</span>')}</div></div>`;
  }

  // Zero is a valid ruler boundary, while saved/default amounts must still produce a positive record.
  function validEditorRange(kind) {
    const minimum = Number(state.editor[kind + "Min"]), maximum = Number(state.editor[kind + "Max"]);
    return Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum) && minimum >= 0 && maximum > 0 && maximum >= minimum ? { min: minimum, max: maximum } : null;
  }

  function updateEditorDefault(kind) {
    const range = validEditorRange(kind); if (!range) return;
    const property = kind !== "quantity" ? "defaultTime" : "defaultQuantity";
    state.editor[property] = Math.min(range.max, Math.max(1, midpoint(range.min, range.max)));
    const input = screen.querySelector('[data-editor="' + property + '"]');
    if (input) input.value = state.editor[property];
  }

  // Clamp on editing completion, not each keystroke, so multi-digit manual values remain easy to enter.
  function normalizeEditorDefault(kind) {
    const range = validEditorRange(kind); if (!range) return;
    const property = kind === "time" ? "defaultTime" : "defaultQuantity", raw = state.editor[property];
    const value = raw === "" || !Number.isFinite(Number(raw)) ? midpoint(range.min, range.max) : Math.floor(Number(raw));
    state.editor[property] = Math.min(range.max, Math.max(1, range.min, value));
    const input = screen.querySelector('[data-editor="' + property + '"]');
    if (input) input.value = state.editor[property];
  }

  // Time units are convertible display/input choices; raw records always retain their second-based value.
  function timeUnitSettingMarkup(editor) {
    // Present the units in clock order while retaining minutes as the default selection.
    return `<div class="setting-row"><span>时间单位</span><div class="time-unit-options" role="group" aria-label="时间单位">${["时", "分", "秒"].map(unit => `<button data-action="editor-time-unit" data-value="${unit}" class="${timeUnitFor(editor) === unit ? 'active' : ''}" aria-pressed="${timeUnitFor(editor) === unit}">${unit}</button>`).join("")}</div></div>`;
  }

  // Name the quantity unit explicitly; its historical lock survives deletion of saved quantity entries.
  function unitSettingMarkup(editor) {
    if (!["quantity", "both"].includes(editor.mode)) return "";
    const locked = Boolean(editor.quantityUnitLocked);
    return `<label class="setting-row quantity-unit-setting"><span>数量单位</span><input data-editor="quantityUnit" value="${escape(editor.quantityUnit)}" placeholder="次" maxlength="4" aria-label="数量单位" ${locked ? 'readonly aria-describedby="quantity-unit-note"' : ''}></label>${locked ? '<p id="quantity-unit-note" class="setting-note quantity-unit-note">已有数量记录，单位已固定</p>' : ''}`;
  }

  // Decorative icons accompany visible labels, while assistive technology reads the text only once.
  function configRowLabel(label, iconName) {
    return `<span class="config-row-label">${icon(iconName)}<span>${escape(label)}</span></span>`;
  }

  // Each metric owns a switch and its parameters; hiding a group leaves its raw editor values intact.
  function metricGroupMarkup(mode, label, parameters) {
    const enabled = state.editor.mode === mode || state.editor.mode === "both";
    const panelId = mode + "-parameters";
    return `<section class="editor-metric-group"><label class="setting-row metric-toggle-row config-heading-row">${configRowLabel(label, mode === "duration" ? "clock" : "quantity")}<input class="toggle" type="checkbox" role="switch" data-action="editor-mode" data-value="${mode}" ${enabled ? 'checked' : ''} aria-label="${label}" aria-controls="${panelId}" aria-expanded="${enabled}"></label><div id="${panelId}" class="metric-parameters" role="group" aria-label="${label}参数" ${enabled ? '' : 'hidden'}>${enabled ? parameters : ''}</div></section>`;
  }

  // One connected card groups time, quantity, the primary metric and direct entry without repeated headings.
  function editorMarkup() {
    const editor = state.editor;
    const timeEnabled = ["duration", "both"].includes(editor.mode), quantityEnabled = ["quantity", "both"].includes(editor.mode);
    const colors = Object.entries(palettes).map(([color, value]) => `<button data-action="color" data-value="${color}" style="background:${value.start}" aria-label="${value.name}" aria-pressed="${editor.color === color}" class="${editor.color === color ? 'selected' : ''}">${editor.color === color ? icon("check") : ''}</button>`).join("");
    const icons = [["book", "阅读"], ["rope", "跳绳"], ["dumbbell", "健身"], ["piano", "练琴"], ["target", "练习"]].map(([value, label]) => `<button data-action="icon" data-value="${value}" class="${editor.icon === value ? 'selected' : ''}" aria-label="${label}图标">${icon(value)}</button>`).join("");
    const timeParameters = timeUnitSettingMarkup(editor) + rangeSettingMarkup("时间", "time") + settingInput("默认时间", "defaultTime", timeUnitFor(editor));
    const quantityParameters = unitSettingMarkup(editor) + rangeSettingMarkup("数量", "quantity") + settingInput("默认数量", "defaultQuantity", "选填");
    // A disabled type cannot become primary, but the stored preference returns when both types are enabled.
    const primary = editor.mode === "both" ? editor.primary : timeEnabled ? "durationSeconds" : quantityEnabled ? "quantity" : null;
    const primaryButtons = [["durationSeconds", "时间", timeEnabled], ["quantity", "数量", quantityEnabled]].map(([value, label, enabled]) => `<button data-action="editor-primary" data-value="${value}" class="${primary === value ? 'active' : ''}" aria-pressed="${primary === value}" ${enabled ? '' : 'disabled'}>${label}</button>`).join("");
    const config = `<div class="setting-box editor-config">${metricGroupMarkup("duration", "时间", timeParameters)}${metricGroupMarkup("quantity", "数量", quantityParameters)}<div class="setting-row primary-metric-row config-heading-row">${configRowLabel("主要指标", "chart")}<div class="editor-metric-toggle" role="group" aria-label="主要指标">${primaryButtons}</div></div><label class="setting-row direct-entry-row config-heading-row">${configRowLabel("快速打卡", "bolt")}<input class="toggle" type="checkbox" role="switch" data-editor="direct" ${editor.direct ? 'checked' : ''} aria-label="快速打卡"></label></div>`;
    return `${editor.id ? '<h1 class="editor-title">项目设置</h1>' : ''}<div class="editor-preview" style="${cssColor(editor)}">${icon(editor.icon)}<div><strong id="preview-name">${escape(editor.name || "新的打卡")}</strong><span>${modeLabel(editor.mode)}</span></div></div><div class="setting-box"><label class="setting-row"><input class="full-name-input" data-editor="name" value="${escape(editor.name)}" placeholder="项目名称，例如阅读" maxlength="24" aria-label="项目名称"></label></div><div class="editor-label">项目外观</div><div class="setting-box"><div class="color-options">${colors}</div><div class="icon-options">${icons}</div></div><div class="editor-label">打卡类型</div>${config}<p id="editor-error" class="form-error" role="alert"></p><button class="primary-button editor-save" data-action="save-project">${editor.id ? "保存设置" : "创建项目"}</button>`;
  }

  function saveProject() {
    try {
      const editor = state.editor, name = editor.name.trim();
      if (!name) throw new Error("先为这件事起个名字。");
      if (editor.mode === "none") throw new Error("请至少选择时间或数量。");
      normalizeEditorDefault("time"); normalizeEditorDefault("quantity");
      if (!Object.hasOwn(timeUnits, editor.timeUnit || "分")) throw new Error("请选择有效的时间单位。");
      const previous = projectById(editor.id);
      const quantityUnit = String(editor.quantityUnit ?? "次").trim();
      // Units are short literal text, never markup; changing a historical measure requires a new project.
      if (!quantityUnit || Array.from(quantityUnit).length > 4 || /[\s\u0000-\u001f\u007f]/.test(quantityUnit)) throw new Error("单位请填写1～4个字符，不能含空格。");
      if (previous?.quantityUnitLocked && quantityUnit !== unitFor(previous)) throw new Error("已有数量记录，单位已固定；请新建项目使用其他单位。");
      // Hidden configuration is still retained, so a later re-enable restores the same valid settings.
      const readRange = kind => {
        const range = validEditorRange(kind);
        if (!range || !/^\d+$/.test(String(editor[kind + "Min"])) || !/^\d+$/.test(String(editor[kind + "Max"]))) throw new Error((kind !== "quantity" ? "时间" : "数量") + "范围需填写非负整数，最大值须大于0且不小于最小值。");
        return range;
      };
      const timeRange = readRange("time");
      if (!Number.isSafeInteger(timeRange.max * timeFactor(editor))) throw new Error("时间范围换算后超出可准确保存的范围。");
      const quantityRange = readRange("quantity");
      const readDefault = (value, range, label) => {
        const result = readPositive(value);
        if (result == null || result < range.min || result > range.max) throw new Error("默认" + label + "需填写范围内的整数。");
        return result;
      };
      const defaultTime = readDefault(editor.defaultTime, timeRange, "时间");
      const defaultQuantity = readDefault(editor.defaultQuantity, quantityRange, "数量");
      const project = { id: editor.id || "project-" + nextId++, name, color: editor.color, icon: editor.icon, mode: editor.mode, primary: editor.mode === "duration" ? "durationSeconds" : editor.mode === "quantity" ? "quantity" : editor.primary, quantityUnit, quantityUnitLocked: previous?.quantityUnitLocked || false, timeUnit: editor.timeUnit || "分", timeMin: timeRange.min, timeMax: timeRange.max, quantityMin: quantityRange.min, quantityMax: quantityRange.max, defaultTime, defaultQuantity, direct: editor.direct };
      if (editor.id) state.projects = state.projects.map(value => value.id === editor.id ? project : value);
      else state.projects.push(project);
      // A successful creation consumes its draft and reveals the new card even after a filtered search.
      if (!editor.id) { state.newProjectDraft = null; state.search = ""; }
      const returnTo = state.editorReturn;
      if (returnTo === "detail") showDetail(project.id); else showHome();
      showToast(editor.id ? "设置已保存" : "项目已创建");
    } catch (error) { document.getElementById("editor-error").textContent = error.message; }
  }

  function confirmDelete(type) {
    const record = type === "record" ? state.records.find(value => value.id === state.draft?.recordId) : null;
    const project = projectById(record?.projectId || state.projectId); if (!project) return;
    state.confirm = { type, projectId: project.id, recordId: record?.id };
    const title = type === "record" ? "删除这条记录？" : "删除「" + project.name + "」？";
    const detail = type === "record" ? "这条记录会从累计与图表中移除，删除后可以短暂撤销。" : "本项目和 " + recordsFor(project.id).length + " 条记录将一并删除。首版没有备份恢复，请确认后继续。";
    overlay.innerHTML = '<div class="overlay"><section class="sheet confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">' + escape(title) + '</h2><p>' + escape(detail) + '</p><button class="primary-button danger-button" data-action="confirm-delete">' + (type === "record" ? "删除记录" : "删除本项目") + '</button><button class="secondary-button" data-action="cancel-delete">取消</button></section></div>';
  }

  function deleteConfirmed() {
    const pending = state.confirm; if (!pending) return;
    if (pending.type === "record") {
      const record = state.records.find(value => value.id === pending.recordId); if (!record) return;
      state.records = state.records.filter(value => value.id !== record.id);
      closeSheet(); render(); showToast("记录已删除", { type: "delete", record });
    } else {
      state.records = state.records.filter(record => record.projectId !== pending.projectId);
      state.projects = state.projects.filter(project => project.id !== pending.projectId);
      hideToast(); closeSheet(); showHome(); showToast("项目已删除");
    }
  }

  function leaveEditor() {
    if (state.editorReturn === "detail") showDetail(state.projectId); else showHome();
  }

  function requestBack() {
    if (state.view !== "editor") { showHome(); return; }
    // Cancelling creation silently retains every field; existing-project edits keep their save boundary.
    if (!state.editor.id) {
      state.newProjectDraft = { ...state.editor };
      leaveEditor();
      return;
    }
    if (JSON.stringify(state.editor) === state.editorBaseline) { leaveEditor(); return; }
    state.confirm = { type: "discard-editor" };
    overlay.innerHTML = '<div class="overlay"><section class="sheet confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="discard-title"><h2 id="discard-title">放弃未保存的修改？</h2><p>项目设置还没有保存。你可以继续编辑，或放弃这次修改。</p><button class="primary-button" data-action="cancel-delete">继续编辑</button><button class="secondary-button delete-record-button" data-action="discard-editor">放弃修改</button></section></div>';
    overlay.querySelector("button")?.focus({ preventScroll: true });
  }

  // Review shortcuts are outside the product frame and never become actual app navigation.
  function demoScene(scene) {
    closeSheet();
    if (["duration", "quantity", "both", "detail"].includes(scene) && !projectById("reading")) resetFixtures();
    if (scene === "reset") { resetFixtures(); render(); }
    else if (scene === "home") showHome();
    else if (scene === "duration") { showHome(); openRecord("reading", { fresh: true }); }
    else if (scene === "quantity") { showHome(); openRecord("basketball", { fresh: true }); }
    else if (scene === "both") { showHome(); openRecord("rope", { fresh: true }); }
    else if (scene === "detail") showDetail("rope");
    else if (scene === "create") openEditor();
    else if (scene === "empty") { state.projects = []; state.records = []; showHome(); }
    document.querySelectorAll("[data-demo]").forEach(button => button.classList.toggle("active", button.dataset.demo === scene));
  }

  document.addEventListener("click", event => {
    const review = event.target.closest("[data-demo]");
    if (review) { demoScene(review.dataset.demo); return; }
    const button = event.target.closest("[data-action]");
    if (!button) { if (event.target.matches("[data-scrim]") && !state.confirm) closeSheet(); return; }
    const action = button.dataset.action;
    if (action === "record") recordProject(button.dataset.id);
    else if (action === "detail") showDetail(button.dataset.id);
    else if (action === "create") openEditor();
    else if (action === "clear-search") {
      const input = document.getElementById("project-search");
      input.value = ""; updateSearch(""); input.focus({ preventScroll: true });
    }
    else if (action === "back") requestBack();
    else if (action === "close-sheet") closeSheet();
    else if (action === "save-record") saveRecord();
    else if (action === "pick-temporal") {
      // Opening from the whole row avoids the tiny native icon target; keep the system picker and keyboard.
      const input = button.querySelector("input");
      if (event.target !== input) event.preventDefault();
      input.focus({ preventScroll: true });
      try { input.showPicker?.(); } catch (_) { /* Unsupported/embedded browsers retain normal field focus. */ }
    } else if (action === "precise") {
      state.draft.preciseField = button.dataset.field; renderSheet();
      const input = overlay.querySelector('.precise-input-row input'); input?.focus(); input?.select();
    } else if (action === "finish-precise") {
      try {
        const kind = state.draft.preciseField, project = projectById(state.draft.projectId);
        const original = state.records.find(record => record.id === state.draft.recordId);
        const value = kind === "quantity" ? readPositive(state.draft[kind]) : timeAmount(readTime(state.draft[kind], project, original?.durationSeconds), project);
        if (value == null && (!original || (kind === "quantity" ? original.quantity : original.durationSeconds) != null)) throw new Error("请填写本次" + (kind === "quantity" ? "数量" : "时间") + "。");
        validateRecordAmount(value, kind, project, kind === "quantity" ? original?.quantity : timeAmount(original?.durationSeconds, project));
        state.draft.lastSelected ||= {}; if (value) state.draft.lastSelected[kind] = value;
        state.draft.preciseField = null; renderSheet();
      } catch (error) { document.getElementById("record-error").textContent = error.message; }
    } else if (action === "toggle-notes") {
      state.draft.notesOpen = !state.draft.notesOpen; renderSheet();
      if (state.draft.notesOpen) overlay.querySelector('.notes-input')?.focus();
    }
    else if (action === "supplement") { markExplicit(); state.draft.supplement = !state.draft.supplement; state.draft.changed = true; renderSheet(); }
    else if (action === "undo") undoLast();
    else if (action === "metric") { state.metric = button.dataset.value; state.point = null; render(); }
    else if (action === "range") { state.range = button.dataset.value; state.offset = 0; state.point = null; state.showAll = false; state.recordLimit = RECORD_PREVIEW_LIMIT; render(); }
    else if (action === "graph") { state.graph = button.dataset.value; state.point = null; render(); }
    else if (action === "period") { state.offset = Math.min(0, state.offset + Number(button.dataset.delta)); state.point = null; state.showAll = false; state.recordLimit = RECORD_PREVIEW_LIMIT; render(); }
    else if (action === "chart-point") { state.point = Number(button.dataset.index); render(); }
    else if (action === "all-records") { state.showAll = true; state.recordLimit = RECORD_PAGE_SIZE; render(); }
    else if (action === "more-records") loadMoreRecords();
    else if (action === "collapse-records") {
      state.showAll = false; state.recordLimit = RECORD_PREVIEW_LIMIT; render();
      // Collapsing a long list must return to its heading instead of leaving the user below removed rows.
      const heading = screen.querySelector(".records-heading");
      screen.scrollTop += heading.getBoundingClientRect().top - screen.getBoundingClientRect().top;
      heading.querySelector("h2").focus({ preventScroll: true });
    }
    else if (action === "edit-record") { const record = state.records.find(value => value.id === button.dataset.id); if (record) openRecord(record.projectId, { recordId: record.id }); }
    else if (action === "settings") openEditor(projectById(state.projectId));
    else if (action === "editor-mode") {
      const minutesEnabled = ["duration", "both"].includes(state.editor.mode), quantityEnabled = ["quantity", "both"].includes(state.editor.mode);
      const nextMinutes = button.dataset.value === "duration" ? !minutesEnabled : minutesEnabled;
      const nextQuantity = button.dataset.value === "quantity" ? !quantityEnabled : quantityEnabled;
      state.editor.mode = nextMinutes && nextQuantity ? "both" : nextMinutes ? "duration" : nextQuantity ? "quantity" : "none";
      render();
      // Replacing the group's markup must keep keyboard and screen-reader focus on its switch.
      screen.querySelector('[data-action="editor-mode"][data-value="' + button.dataset.value + '"]')?.focus({ preventScroll: true });
    } else if (action === "color") { state.editor.color = button.dataset.value; render(); }
    else if (action === "editor-time-unit") { state.editor.timeUnit = button.dataset.value; normalizeEditorDefault("time"); render(); }
    else if (action === "icon") { state.editor.icon = button.dataset.value; render(); }
    else if (action === "editor-primary") { state.editor.primary = button.dataset.value; render(); }
    else if (action === "save-project") saveProject();
    else if (action === "delete-record") confirmDelete("record");
    else if (action === "delete-project") confirmDelete("project");
    else if (action === "confirm-delete") deleteConfirmed();
    else if (action === "cancel-delete") { state.confirm = null; if (state.draft) renderSheet(); else overlay.innerHTML = ""; }
    else if (action === "discard-editor") { state.confirm = null; overlay.innerHTML = ""; leaveEditor(); }
  });

  document.addEventListener("focusin", event => { if (event.target.matches("[data-draft]")) markExplicit(); });
  document.addEventListener("input", event => {
    const element = event.target;
    // IME intermediate text is left intact; compositionend applies the completed search immediately.
    if (element.id === "project-search" && !event.isComposing) updateSearch(element.value);
    if (element.dataset.draft && state.draft) {
      state.draft[element.dataset.draft] = element.value; state.draft.changed = true; markExplicit();
      updateSubmitButton();
      const error = document.getElementById("record-error"); if (error) error.textContent = "";
    }
    if (element.dataset.editor && state.editor) {
      state.editor[element.dataset.editor] = element.type === "checkbox" ? element.checked : element.value;
      if (["timeMin", "timeMax", "quantityMin", "quantityMax"].includes(element.dataset.editor)) updateEditorDefault(element.dataset.editor.startsWith("time") ? "time" : "quantity");
      if (element.closest(".range-values")) element.style.setProperty("--value-chars", String(Math.max(1, element.value.length)));
      if (element.dataset.editor === "name") document.getElementById("preview-name").textContent = element.value || "新的打卡";
    }
  });

  document.addEventListener("focusout", event => {
    if (!state.editor || state.view !== "editor") return;
    if (event.target.dataset.editor === "defaultTime") normalizeEditorDefault("time");
    else if (event.target.dataset.editor === "defaultQuantity") normalizeEditorDefault("quantity");
  });

  document.addEventListener("compositionend", event => {
    if (event.target.id === "project-search") updateSearch(event.target.value);
  });

  // Modal focus stays in the active sheet; Escape dismisses this session without saving or retaining input.
  document.addEventListener("keydown", event => {
    if (!overlay.firstElementChild) return;
    if (event.key === "Escape") { if (state.confirm) { state.confirm = null; if (state.draft) renderSheet(); else overlay.innerHTML = ""; } else closeSheet(); }
    if (event.key === "Tab") {
      const elements = [...overlay.querySelectorAll("button,input,textarea")].filter(element => !element.disabled);
      if (!elements.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (!overlay.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  resetFixtures();
  const params = new URLSearchParams(location.search);
  if (params.get("embed") === "1") document.body.classList.add("embedded");
  render();
  if (params.get("scene")) demoScene(params.get("scene"));
})();
