/* This is a disposable interaction model, not the mini-program persistence implementation.
 * Every displayed total is derived from demonstration records; refreshing restores fixtures. */
(() => {
  "use strict";
  // This embedded website mode exposes statistics only; the full prototype keeps its normal navigation and records.
  const statisticsPreview = parent !== window && new URLSearchParams(location.search).get("preview") === "statistics";
  const homePreview = parent !== window && new URLSearchParams(location.search).get("preview") === "home";
  const statisticsPreviewActions = new Set(["metric", "graph", "range", "period", "calendar-month", "calendar-day", "calendar-clear"]);
  const DEMO_TODAY = "2026-11-24";
  // Standalone review mirrors the native policy in miniprogram/domain/input-limits.ts.
  // Mirror mini-program admission limits; existing demonstration data is never truncated to meet capacity.
  const INPUT_LIMITS = { projects: 15, name: 6, note: 100, breaks: 2, unit: 4, search: 20, quantity: 99999, seconds: 31536000, earliestDate: "1900-01-01" };
  // Mirror the strict native vocabulary so browser review cannot save arbitrary quantity measures.
  const QUANTITY_UNITS = ["次", "个", "件", "张", "页", "字", "本", "篇", "题", "道", "组", "遍", "首", "节", "圈", "步", "米", "千米", "杯", "毫升"];
  const quantityUnitAllowed = unit => QUANTITY_UNITS.includes(unit);
  // Mirrors the shared native policy: a duration day is 86400 seconds; seconds are compatibility-only.
  const TIME_LIMITS = { "分": 525600, "时": 8760, "天": 365, "秒": 31536000 };
  const textLength = text => Array.from(text).length;
  const clipText = (text, maximum) => Array.from(text).slice(0, maximum).join("");
  const oneLine = text => text.replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "");
  const normalizeNote = text => text.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  // Reject an over-limit edit intact: clipping after a middle insertion would delete the existing suffix.
  const clipNote = (text, previous) => {
    const normalized = normalizeNote(text);
    return textLength(normalized) <= INPUT_LIMITS.note && normalized.split("\n").length <= INPUT_LIMITS.breaks + 1 && !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(normalized) ? normalized : previous;
  };
  const numericText = (text, maximum, decimals = 0) => (decimals ? new RegExp("^\\d*(?:\\.\\d{0," + decimals + "})?$") : /^\d*$/).test(text) && text.length <= String(maximum).length + (decimals ? decimals + 1 : 0) && (text === "" || (decimals && text === ".") || (Number.isFinite(Number(text)) && Number(text) <= maximum));
  const acceptNumber = (text, previous, maximum, decimals = 0) => numericText(text, maximum, decimals) || (!numericText(previous, maximum, decimals) && text.length < previous.length && (decimals ? new RegExp("^\\d+(?:\\.\\d{0," + decimals + "})?$") : /^\d+$/).test(text) && Number(text) < Number(previous));
  // Only the selected local Phosphor Regular family is retained in both runtimes.
  const palettes = window.DAKA_APPEARANCE.palettes;
  const projectIcons = window.DAKA_APPEARANCE.projectIcons;
  // Historical IDs map to current glyphs without duplicate picker entries or retained asset copies.
  const resolveProjectIcon = name => Object.prototype.hasOwnProperty.call(window.DAKA_APPEARANCE.projectIconAliases, name) ? window.DAKA_APPEARANCE.projectIconAliases[name] : name;
  const icon = name => window.DAKA_APPEARANCE.icons[resolveProjectIcon(name)] || window.DAKA_APPEARANCE.icons.target;
  // Folded lists pin an extended selection into the last slot without changing the canonical order or draft.
  function appearanceOptions(options, selected) {
    if (state.appearanceExpanded) return options;
    const compact = options.slice(0, 5), current = options.find(option => option.id === selected);
    if (current && !compact.some(option => option.id === selected)) compact[4] = current;
    return compact;
  }
  // Text entered during review must remain literal, even though the prototype renders templates.
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const number = value => Number(value || 0).toLocaleString("zh-CN");
  const pad = value => String(value).padStart(2, "0");
  // Calendar dates are kept as calendar strings: UTC conversion would move records across days.
  const localDate = value => new Date(value + "T12:00:00");
  const key = date => date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  const moveDay = (value, offset) => { const date = localDate(value); date.setDate(date.getDate() + offset); return key(date); };
  // Natural calendar buckets keep infrequent activity meaningful without inventing due dates or targets.
  const frequencyFor = project => project.frequency || "day";
  const frequencyName = project => ({ day: "每日", week: "每周", month: "每月" }[frequencyFor(project)]);
  const frequencyLabel = project => ({ day: "今天", week: "本周", month: "本月" }[frequencyFor(project)]);
  function frequencyStart(date, frequency, offset = 0) {
    const value = localDate(date);
    if (frequency === "month") { value.setDate(1); value.setMonth(value.getMonth() + offset); return key(value); }
    if (frequency === "week") return moveDay(date, -((value.getDay() + 6) % 7) + offset * 7);
    return moveDay(date, offset);
  }
  // Cross-year captions must not imply that an older record happened this year.
  const shortDate = value => (value.slice(0, 4) === DEMO_TODAY.slice(0, 4) ? "" : value.slice(0, 4) + "年") + Number(value.slice(5, 7)) + "月" + Number(value.slice(8)) + "日";
  // Whole-second storage makes hour/minute/second switching lossless and independent of presentation.
  const timeUnits = { "分": 60, "时": 3600, "天": 86400, "秒": 1 };
  const timeFactor = project => timeUnits[project?.timeUnit] || 60;
  const timeUnitFor = project => project?.timeUnit || "分";
  // Full captions are presentation-only; arithmetic and saved draft keys continue to use 分、时、天、秒.
  const timeUnitLabels = { "分": "分钟", "时": "小时", "天": "天", "秒": "秒" };
  const timeUnitLabel = project => timeUnitLabels[timeUnitFor(project)];
  const timeAmount = (seconds, project) => seconds == null ? null : seconds / timeFactor(project);
  const timeNumber = (value, decimals = 4) => Number(Number(value).toFixed(decimals)).toLocaleString("zh-CN", { maximumFractionDigits: decimals });
  const timeDisplay = (seconds, project) => {
    // Day readouts need enough precision to keep small stored durations visibly nonzero.
    const decimals = timeUnitFor(project) === "天" ? 8 : 4;
    const amount = timeAmount(seconds, project), rounded = Number(amount.toFixed(decimals));
    return { number: (Math.abs(rounded * timeFactor(project) - seconds) > 1e-8 ? "≈" : "") + timeNumber(amount, decimals), unit: timeUnitLabel(project) };
  };
  const timeText = (seconds, project) => seconds == null ? "时间未记录" : timeDisplay(seconds, project).number + timeUnitLabel(project);
  // “时间” is the duration label in the UI; stored whole seconds stay separate from the optional clock time.
  const modeLabel = mode => ({ duration: "记时间", quantity: "记数量", both: "记时间与数量", none: "选择打卡类型" }[mode]);
  // Primary order is a project preference, shared by tabs, input controls and saved-record summaries.
  const metricOrder = project => project.primary === "quantity" ? ["quantity", "durationSeconds"] : ["durationSeconds", "quantity"];
  // A project's quantity has one stable unit; a saved amount must never be relabelled as a different measure.
  const unitFor = project => project?.quantityUnit || "次";
  const quantityText = (value, project) => number(value) + unitFor(project);
  // New-project configuration is a separate draft: cancelling must never create a project or a record.
  const RECORD_PREVIEW_LIMIT = 5, RECORD_PAGE_SIZE = 20;
  // Match the native detail: accumulation comes first and is the initial view on every entry.
  const state = { arranging: false, arrangeOrder: [], projects: [], records: [], view: "home", search: "", newProjectDraft: null, projectId: null, metric: "durationSeconds", range: "all", graph: "cumulative", offset: 0, point: null, showAll: false, recordLimit: RECORD_PREVIEW_LIMIT, draft: null, editor: null, confirm: null, undo: null, lastDirect: 0 };
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
    Object.assign(state, { arranging: false, arrangeOrder: [], view: "home", search: "", newProjectDraft: null, homeScroll: 0, projectId: null, draft: null, editor: null, confirm: null, undo: null });
    overlay.innerHTML = "";
    hideToast();
  }

  const projectById = id => state.projects.find(project => project.id === id);
  const recordsFor = id => state.records.filter(record => record.projectId === id);
  const sum = (records, metric) => records.reduce((total, record) => total + (record[metric] || 0), 0);
  const metricAvailable = (records, metric) => records.some(record => record[metric] != null);
  const cssColor = project => "--accent:" + palettes[project.color].start + ";--card-start:" + palettes[project.color].start + ";--card-end:" + palettes[project.color].end;

  // Chart type follows the primary metric: daily time bars versus cumulative quantity steps.
  // Each card scales independently; neither height nor slope compares unrelated project units.
  function tinyChart(project) {
    const records = recordsFor(project.id);
    const frequency = frequencyFor(project);
    const count = { day: 7, week: 4, month: 6 }[frequency];
    const starts = Array.from({ length: count + 1 }, (_, index) => frequencyStart(DEMO_TODAY, frequency, index - count + 1));
    const values = starts.slice(0, count).map((start, index) => sum(records.filter(record => record.date >= start && record.date < starts[index + 1] && record.date <= DEMO_TODAY), project.primary));
    const spanName = { day: "近7天", week: "近4周", month: "近6个月" }[frequency];
    let marks, description;
    if (project.primary === "quantity") {
      // Include the prior cumulative baseline and keep empty days flat. Never smooth or forecast growth.
      const baseline = sum(records.filter(record => record.date < starts[0]), "quantity");
      let running = baseline;
      const totals = [baseline, ...values.map(value => (running += value))];
      const span = totals[count] - baseline || 1;
      const y = value => (26 - (value - baseline) / span * 22).toFixed(2);
      let path = "M2," + y(baseline);
      for (let index = 1; index < totals.length; index++) path += "H" + (2 + index * 125 / count).toFixed(2) + "V" + y(totals[index]);
      marks = '<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/><circle cx="127" cy="' + y(totals[count]) + '" r="2.2" fill="currentColor"/>';
      description = spanName + "累计数量阶梯图，无新增时保持水平";
    } else {
      const maximum = Math.max(...values, 1);
      marks = values.map((value, index) => {
        const height = value ? Math.max(3, value / maximum * 25) : 2;
        return '<rect x="' + (index * 129 / count + 2) + '" y="' + (28 - height) + '" width="' + (129 / count - 7) + '" height="' + height + '" rx="2.5" fill="currentColor" opacity="' + (value ? (index === count - 1 ? '1' : '.6') : '.18') + '"/>';
      }).join('');
      description = spanName + "各周期投入时间柱状图";
    }
    return '<span class="card-trend" role="img" aria-label="' + description + '"><svg class="card-chart" viewBox="0 0 129 30" preserveAspectRatio="none" aria-hidden="true">' + marks + '</svg></span>';
  }

  function cardMarkup(project) {
    const records = recordsFor(project.id), metric = project.primary;
    const total = sum(records, metric), today = records.filter(record => record.date >= frequencyStart(DEMO_TODAY, frequencyFor(project)) && record.date <= DEMO_TODAY);
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
    // Today's amount is the primary visual; zero means no additions today, not missing history.
    // The lifetime summary stays separate so switching the visual emphasis never changes totals.
    const lifetime = big + unit;
    const daily = sum(today, metric);
    const display = metric === "durationSeconds" ? timeDisplay(daily, project) : { number: number(daily), unit: unitFor(project) };
    big = today.length && !metricAvailable(today, metric) ? "—" : display.number; unit = big === "—" ? "" : display.unit;
    const secondaryMetric = metric === "quantity" ? "durationSeconds" : "quantity";
    const dailySecondary = project.mode === "both" && metricAvailable(today, secondaryMetric) ? (secondaryMetric === "quantity" ? quantityText(sum(today, secondaryMetric), project) : timeText(sum(today, secondaryMetric), project)) : "";
    const todayLabel = frequencyLabel(project) + (dailySecondary ? " · " + dailySecondary : "");
    // Direct entry must still expose the actual increment even when the daily total is zero.
    const direct = project.direct ? '<span class="card-quick">记' + escape(defaultDescription(project)) + '</span>' : "";
    return '<article data-project-id="' + project.id + '" class="project-card' + (state.arranging ? ' is-arranging' : '') + '" style="' + cssColor(project) + '"><div class="card-motion"><div class="card-surface"><button class="card-main"' + (state.arranging ? ' disabled' : '') + ' data-action="record" data-id="' + project.id + '" aria-label="记录' + escape(project.name) + '"><span class="card-metrics"><span class="card-day-label">' + escape(todayLabel) + '</span><span class="card-number-line ' + (unit.length > 2 ? "wide-unit" : "") + (String(big).length > 6 ? " long-number" : "") + '" aria-label="' + frequencyLabel(project) + ' ' + escape(big + unit) + '"><span class="card-number">' + big + '</span><span class="card-unit">' + escape(unit) + '</span></span></span>' + tinyChart(project) + '<span class="card-caption"><span>共 ' + escape(lifetime) + '</span>' + direct + '</span></button><button class="card-detail"' + (state.arranging ? ' disabled' : '') + ' data-action="detail" data-id="' + project.id + '" aria-label="查看' + escape(project.name) + '统计"><span class="card-heading"><span class="card-icon">' + icon(project.icon) + '</span><span class="card-name">' + escape(project.name) + '</span></span><span class="detail-disc">' + icon("chevron") + '</span></button></div>' + (state.arranging ? '<button class="arrange-hit" aria-label="移动' + escape(project.name) + '，拖动或使用方向键排序"></button><button class="remove-card" data-action="remove-card" data-id="' + project.id + '" aria-label="删除' + escape(project.name) + '"><span>' + icon('close') + '</span></button>' : '') + '</div></article>';
  }

  function defaultDescription(project) {
    const parts = [];
    if (project.mode !== "quantity" && project.defaultTime) parts.push(project.defaultTime + timeUnitLabel(project));
    if (project.mode !== "duration" && project.defaultQuantity) parts.push(quantityText(project.defaultQuantity, project));
    return parts.join("、");
  }

  // Match only names, retaining project order and totals; normalize width and case for predictable search.
  const searchKey = value => value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  const matchingProjects = () => state.arranging ? state.arrangeOrder.map(projectById).filter(Boolean) : state.projects.filter(project => searchKey(project.name).includes(searchKey(state.search)));

  function homeResultsMarkup() {
    const projects = matchingProjects();
    // The add tile shares the project footprint; additional rows use the existing page scroll.
    return '<div class="project-grid">' + projects.map(cardMarkup).join("") + (state.arranging ? '' : '<button class="add-card" data-action="create"><span class="add-circle">' + icon("plus") + '</span><span>新增打卡</span></button>') + '</div>';
  }

  function searchStatus() {
    if (!searchKey(state.search)) return "";
    const count = matchingProjects().length;
    return count ? "找到 " + count + " 个项目" : "未找到相关项目";
  }

  // The brand placeholder keeps the home title-free; the accessible label still names the search action.
  function renderHome() {
    if (state.arranging) return '<div id="home-results" class="arranging-results">' + homeResultsMarkup() + '</div>';
    return '<div class="home-search" role="search">' + icon("search") + '<input id="project-search" type="search" value="' + escape(state.search) + '" placeholder="北极星打卡" aria-label="搜索项目" aria-controls="home-results" maxlength="40" autocomplete="off" spellcheck="false"><button class="search-clear" data-action="clear-search" aria-label="清空搜索"' + (state.search ? "" : " hidden") + '>' + icon("close") + '</button></div><p id="search-status" class="search-status' + (matchingProjects().length ? " visually-hidden" : "") + '" role="status">' + searchStatus() + '</p><div id="home-results">' + homeResultsMarkup() + '</div>';
  }

  // Update results without replacing the input, protecting keyboard focus, caret and Chinese composition.
  function updateSearch(value) {
    value = clipText(value, INPUT_LIMITS.search);
    const input = document.getElementById("project-search"); if (input.value !== value) input.value = value;
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
      groups = selected.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((record, index) => ({ label: record.time || "第" + (index + 1) + "条", date: record.date + (record.time ? " " + record.time : " · 第" + (index + 1) + "条"), records: [record] }));
    } else if (["week", "month"].includes(state.range)) {
      // A month keeps its complete calendar footprint; future dates are empty slots, never zero-valued records.
      const axisEnd = state.range === "month" ? range.end : range.actualEnd;
      for (let date = range.start; date <= axisEnd; date = moveDay(date, 1)) groups.push({ label: state.range === "month" ? String(Number(date.slice(8))) : "周" + ["日", "一", "二", "三", "四", "五", "六"][localDate(date).getDay()], date, future: date > range.actualEnd, records: selected.filter(record => record.date === date) });
    } else {
      const first = state.range === "year" ? range.start.slice(0, 4) + "-01" : range.start.slice(0, 7);
      const last = range.actualEnd.slice(0, 7);
      for (let date = first + "-01"; date.slice(0, 7) <= last;) {
        const prefix = date.slice(0, 7);
        groups.push({ label: (state.range === "all" && first.slice(0, 4) !== last.slice(0, 4) ? prefix.slice(0, 4) + "/" : "") + Number(prefix.slice(5)) + "月", date: prefix, records: selected.filter(record => record.date.startsWith(prefix)) });
        const value = localDate(date); value.setMonth(value.getMonth() + 1); date = key(value);
      }
    }
    const increments = groups.map(group => sum(group.records, metric));
    let running = baseline;
    let values = increments.map((value, index) => { running += value; return groups[index].future ? null : state.graph === "cumulative" ? running : value; });
    let labels = groups.map(group => group.label), dates = groups.map(group => group.date);
    // Keep actual calendar buckets and their readouts aligned; do not prepend a fabricated opening point.
    if (state.range === "day" && !groups.length) { values = [state.graph === "cumulative" ? baseline : 0]; labels = [shortDate(range.start)]; dates = [range.start]; }
    const periodLabel = state.range === "all" ? "全部时间" : state.range === "day" ? shortDate(range.start) : state.range === "month" ? range.start.slice(0, 4) + "年" + Number(range.start.slice(5, 7)) + "月" : state.range === "year" ? range.start.slice(0, 4) + "年" : shortDate(range.start) + "—" + shortDate(range.actualEnd);
    return { ...range, values, labels, dates, selected, baseline, added: sum(selected, metric), periodLabel };
  }

  function chartValue(value, project) {
    if (state.metric === "durationSeconds") return timeDisplay(value, project).number;
    return value >= 10000 ? (value / 10000).toFixed(1).replace(/\.0$/, "") + "万" : number(Math.round(value));
  }

  function chartMarkup(data, project) {
    const values = data.values, cumulative = state.graph === "cumulative", color = palettes[project.color].start;
    if (!data.selected.length && !data.baseline) return '<div class="chart-empty">所选时段暂无记录</div>';
    // Scale in the displayed unit, then convert back: ticks stay familiar without rounding the stored seconds.
    const factor = state.metric === "durationSeconds" ? timeFactor(project) : 1;
    // Null calendar slots describe the future, so neither scaling nor the final point may treat them as zero.
    const observed = values.filter(value => value != null), lastObserved = values.findLastIndex(value => value != null);
    const minimum = cumulative && state.range !== "all" ? Math.floor(Math.min(data.baseline, ...observed) / factor) * factor : 0;
    const needed = Math.max(1, (Math.max(...observed) - minimum) / factor * 1.14);
    const magnitude = 10 ** Math.floor(Math.log10(needed / 2));
    const interval = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].map(value => value * magnitude).find(value => value * 2 >= needed) || magnitude * 10;
    const span = interval * factor * 2, left = 8, end = 280, top = 22, base = 232;
    // The footer owns exact readouts; only a small unit-label gutter belongs above the marks.
    const x = index => cumulative ? left + 10 + (values.length === 1 ? 126 : index / (values.length - 1) * 252) : left + (end - left) / values.length * (index + .5);
    const y = value => base - (value - minimum) / span * (base - top);
    const gradient = 'chart-fill-' + project.id;
    let markup = `<svg class="main-chart" viewBox="0 0 326 264" aria-hidden="true"><defs><linearGradient id="${gradient}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".11"/><stop offset="100%" stop-color="${color}" stop-opacity=".005"/></linearGradient></defs>`;
    const unit = state.metric === "durationSeconds" ? timeUnitLabel(project) : unitFor(project);
    // Right-align the quiet scale in a narrow gutter, returning horizontal space to the data marks.
    markup += `<text class="chart-unit" x="318" y="10" text-anchor="end">${escape(unit)}</text>`;
    for (let i = 0; i < 3; i++) {
      const value = minimum + span * i / 2, lineY = y(value);
      markup += `<line class="chart-grid" x1="${left}" y1="${lineY}" x2="${end}" y2="${lineY}"/><text class="chart-scale" x="318" y="${lineY + 3}" text-anchor="end">${chartValue(value, project)}</text>`;
    }
    // Sparse calendar guides sit behind marks; month labels follow familiar weekly landmarks, not arbitrary samples.
    const labelCount = Math.min(values.length, state.range === "week" ? 7 : data.labels.some(label => label.length > 6) ? 3 : 4);
    const labelIndices = state.range === "month" ? new Set(values.map((_, i) => i).filter(i => i % 7 === 0)) : new Set(Array.from({ length: labelCount }, (_, i) => labelCount === 1 ? 0 : Math.round(i * (values.length - 1) / (labelCount - 1))));
    labelIndices.forEach(index => {
      if (values.length > 1) markup += `<line class="chart-calendar-guide" x1="${x(index)}" x2="${x(index)}" y1="${top}" y2="${base + 7}"/>`;
    });
    if (cumulative) {
      let path = `M${x(0)},${y(values[0])}`;
      for (let i = 1; i <= lastObserved; i++) path += `H${x(i)}V${y(values[i])}`;
      // Horizontal segments preserve periods without additions; no smoothing invents unrecorded growth.
      markup += `<path d="${path}V${base}H${x(0)}Z" fill="url(#${gradient})"/><path class="chart-line" d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      const slot = (end - left) / values.length, barWidth = Math.min(28, slot * .68);
      values.forEach((value, index) => {
        if (!value) return; // Zero periods keep their space, without a minimum-height bar that suggests an addition.
        const barX = x(index) - barWidth / 2, barY = y(value), radius = Math.min(3, (base - barY) / 2, barWidth / 2);
        const path = `M${barX},${base}V${barY + radius}Q${barX},${barY} ${barX + radius},${barY}H${barX + barWidth - radius}Q${barX + barWidth},${barY} ${barX + barWidth},${barY + radius}V${base}Z`;
        markup += `<path class="chart-bar" d="${path}" fill="${color}" opacity="${state.point == null || state.point === index ? '.88' : '.24'}"/>`;
      });
    }
    values.forEach((value, index) => {
      if (labelIndices.has(index)) markup += `<text x="${x(index)}" y="255" text-anchor="${values.length === 1 ? 'middle' : index === 0 ? 'start' : index === values.length - 1 ? 'end' : 'middle'}">${escape(data.labels[index])}</text>`;
    });
    if (state.point != null && values[state.point] != null) {
      const pointX = x(state.point), value = values[state.point];
      markup += `<line class="chart-indicator" x1="${pointX}" x2="${pointX}" y1="${top}" y2="${base}" stroke="${color}" stroke-opacity=".28"/>`;
      if (cumulative) markup += `<circle cx="${pointX}" cy="${y(value)}" r="6" fill="${color}" fill-opacity=".12"/><circle cx="${pointX}" cy="${y(value)}" r="3.5" fill="${color}" stroke="white" stroke-width="2"/>`;
    }
    if (cumulative && state.point !== lastObserved) markup += `<circle cx="${x(lastObserved)}" cy="${y(values[lastObserved])}" r="3" fill="${color}" stroke="white" stroke-width="1.6"/>`;
    markup += '</svg>';
    return markup;
  }

  function detailMarkup(project) {
    const records = recordsFor(project.id), data = series(project);
    const calendarView = state.graph === "calendar", heat = calendarView ? calendarData(project) : null;
    const calendarDay = heat?.cells.find(cell => cell.date === state.calendarDate);
    const selectedRows = heat ? heat.rows.filter(row => !calendarDay || row.date === calendarDay.date) : data.selected;
    const mainTotal = sum(records, project.primary), secondaryMetric = metricOrder(project)[1];
    const hasBoth = (project.mode !== "quantity" || metricAvailable(records, "durationSeconds")) && (project.mode !== "duration" || metricAvailable(records, "quantity"));
    const totalMarkup = project.primary === "durationSeconds" ? escape(timeDisplay(mainTotal, project).number) + '<span class="lifetime-unit">' + timeUnitLabel(project) + '</span>' : number(mainTotal) + '<span class="lifetime-unit">' + escape(unitFor(project)) + '</span>';
    const secondary = hasBoth ? secondaryMetric === "durationSeconds" ? "累计时间 " + (metricAvailable(records, secondaryMetric) ? timeText(sum(records, secondaryMetric), project) : "未记录") : "累计数量 " + (metricAvailable(records, secondaryMetric) ? quantityText(sum(records, secondaryMetric), project) : "未记录") : "";
    const tabs = hasBoth ? '<div class="metric-selector">' + metricOrder(project).map(metric => `<button data-action="metric" data-value="${metric}" class="${state.metric === metric ? 'active' : ''}" aria-pressed="${state.metric === metric}">${metric === "durationSeconds" ? "时间" : "数量"}</button>`).join("") + '</div>' : "";
    const selected = state.point, value = selected == null ? null : data.values[selected];
    const reading = heat ? calendarDay ? escape(calendarDay.reading) : "" : value == null ? "" : escape(data.dates[selected]) + " · " + (state.graph === "cumulative" ? "累计" : "") + escape(state.metric === "durationSeconds" ? timeText(value, project) : quantityText(value, project));
    // Daily aggregation remains available internally; hide its entry until repeated daily records warrant it.
    const periods = [ ["week", "周"], ["month", "月"], ["year", "年"], ["all", "全部"]].map(([value, label]) => `<button data-action="range" data-value="${value}" class="${state.range === value ? 'active' : ''}" aria-pressed="${state.range === value}">${label}</button>`).join("");
    // A fixed statistics preview omits offscreen editing/navigation controls instead of leaving hidden focus targets.
    const trailing = statisticsPreview ? "" : recordSectionMarkup(records, selectedRows) + '<button class="settings-link" data-action="settings"><span>项目设置</span>' + icon("chevron") + '</button><button class="project-delete" data-action="delete-project">删除项目</button>';
    // Collapse only genuine single-metric summaries; historical values of disabled types retain the dual layout.
    return `<div class="detail-heading"><span class="project-badge">${icon(project.icon)}</span><h1>${escape(project.name)}</h1><span class="frequency-badge">${frequencyName(project)}</span></div>
      <div class="lifetime-caption">累计${project.primary === "durationSeconds" ? "时间" : "数量"}</div><div class="lifetime-number">${totalMarkup}</div>${hasBoth ? '<div class="lifetime-secondary">' + escape(secondary) + '</div>' : ''}${tabs}
      <section class="chart-card ${hasBoth ? '' : 'single-metric'}" aria-label="练习统计"><div class="chart-top"><div class="small-segment" role="group" aria-label="图表类型">${[["cumulative", "累计"], ["distribution", "分布"], ["calendar", "日历"]].map(([id, label]) => `<button data-action="graph" data-value="${id}" class="${state.graph === id ? 'active' : ''}" aria-pressed="${state.graph === id}">${label}</button>`).join("")}</div></div>
      <div class="statistics-body ${heat ? 'calendar-body' : 'standard-body'}">${heat ? `<div class="period-nav calendar-nav"><button data-action="calendar-month" data-delta="-1" aria-label="上个月" ${heat.previous ? '' : 'disabled'}>${icon("back")}</button><strong>${heat.label}</strong><button data-action="calendar-month" data-delta="1" aria-label="下个月" ${(state.calendarOffset || 0) >= 0 ? 'disabled' : ''}>${icon("chevron")}</button></div>${calendarMarkup(heat, reading)}` : `<div class="period-selector">${periods}</div><div class="period-nav ${state.range === 'all' ? 'period-nav-all' : ''}"><button data-action="period" data-delta="-1" aria-label="${state.range === 'week' ? '上一周' : state.range === 'month' ? '上个月' : '上一年'}" ${state.range === 'all' ? 'disabled' : ''}>${icon("back")}</button><strong>${data.periodLabel}</strong><button data-action="period" data-delta="1" aria-label="${state.range === 'week' ? '下一周' : state.range === 'month' ? '下个月' : '下一年'}" ${state.range === 'all' || state.offset >= 0 ? 'disabled' : ''}>${icon("chevron")}</button></div><div class="chart-plot" tabindex="0" role="group" aria-label="${state.graph === 'cumulative' ? '累计' : '分布'}${state.metric === 'durationSeconds' ? '时间' : '数量'}图，点选或使用左右方向键查看准确读数，Esc收起">${chartMarkup(data, project)}</div>`}${heat ? "" : `<div class="chart-footer-reading" role="status">${reading}</div>`}</div></section>
      ${trailing}`;
  }

  // The disposable review mirrors native calendar aggregation: same-year daily amounts, never record counts.
  function calendarData(project) {
    const date = localDate(DEMO_TODAY); date.setDate(1); date.setMonth(date.getMonth() + (state.calendarOffset || 0));
    const month = key(date).slice(0, 7), year = month.slice(0, 4), start = month + "-01";
    const records = recordsFor(project.id).filter(row => row.date <= DEMO_TODAY);
    const annual = new Map();
    records.filter(row => row.date.startsWith(year)).forEach(row => annual.set(row.date, (annual.get(row.date) || 0) + (row[state.metric] || 0)));
    const maximum = Math.max(0, ...annual.values());
    const rows = records.filter(row => row.date.startsWith(month));
    const first = moveDay(start, -((date.getDay() + 6) % 7));
    const cells = Array.from({ length: 42 }, (_, i) => {
      const day = moveDay(first, i), inside = day.startsWith(month), future = day > DEMO_TODAY;
      const entries = rows.filter(row => row.date === day), amount = sum(entries, state.metric);
      const missing = entries.length > 0 && !entries.some(row => row[state.metric] != null);
      const level = amount > 0 ? Math.min(4, Math.max(1, Math.ceil(amount / maximum * 4))) : 0;
      const value = missing ? state.metric === "quantity" ? "数量未记录" : "时间未记录" : state.metric === "quantity" ? quantityText(amount, project) : timeText(amount, project);
      return { date: day, day: inside ? Number(day.slice(8)) : "", disabled: !inside || future, future: inside && future, missing, level, today: day === DEMO_TODAY, reading: shortDate(day) + " · " + value + " · " + entries.length + "条记录" };
    });
    const earliest = records.reduce((min, row) => row.date < min ? row.date : min, DEMO_TODAY).slice(0, 7);
    return { cells, rows, label: year + "年" + Number(month.slice(5)) + "月", previous: month > earliest };
  }

  function calendarMarkup(heat, reading) {
    // Stable six-row geometry and independent selection rings keep touch targets and the record list in place.
    return `<div class="heat-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map(day => `<span>${day}</span>`).join("")}</div><div class="heat-grid" role="group" aria-label="每日${state.metric === 'quantity' ? '数量' : '时间'}记录日历">${heat.cells.map(cell => `<button class="heat-day level-${cell.level} ${cell.today ? 'is-today' : ''} ${state.calendarDate === cell.date ? 'selected' : ''} ${cell.future ? 'future' : ''}" data-action="calendar-day" data-date="${cell.date}" ${cell.disabled ? 'disabled' : ''} aria-pressed="${state.calendarDate === cell.date}" aria-hidden="${!cell.day}" aria-label="${escape(cell.future ? cell.date + "，未来日期" : cell.reading)}"><span>${cell.missing ? '—' : cell.day}</span></button>`).join("")}</div><div class="calendar-footer"><div class="chart-footer-reading calendar-reading" role="status">${reading}</div><div class="heat-legend"><span>少</span>${[1, 2, 3, 4].map(level => `<i class="level-${level}" aria-label="本年单日最多记录${state.metric === 'quantity' ? '数量' : '时间'}的${(level - 1) * 25}%至${level * 25}%"></i>`).join("")}<span>多</span></div></div>`;
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
    return `<section class="record-section"><div class="section-head records-heading"><h2 tabindex="-1">${state.graph === 'calendar' && state.calendarDate && !state.showAll ? shortDate(state.calendarDate) + '的记录' : '打卡记录'}</h2>${state.showAll ? '<button data-action="collapse-records" aria-controls="record-rows" aria-expanded="true">收起</button>' : state.graph === 'calendar' && state.calendarDate ? '<button data-action="calendar-clear">查看本月</button>' : ''}</div><div class="record-list"><div id="record-rows">${visibleRows.length ? visibleRows.map(recordMarkup).join("") : '<div class="empty-records">' + (state.showAll ? '暂无记录' : state.graph === 'calendar' && state.calendarDate ? '当天暂无记录' : '所选时段暂无记录') + '</div>'}</div><div id="record-page-footer">${footer}</div></div><p id="record-count" class="record-count" aria-live="polite">${state.showAll ? '已显示 ' + visibleRows.length + ' / 共 ' : '共 '}${state.graph === "calendar" && !state.showAll ? selected.length : records.length} 条记录</p></section>`;
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
    // Navigation, undo and rerenders must not leave feedback anchored to a replaced card.
    clearCelebration();
    // Replaced nodes must not leave a pagination callback attached to an earlier project or period.
    recordObserver?.disconnect();
    const oldView = screen.dataset.view, oldScroll = screen.scrollTop;
    const project = projectById(state.projectId);
    const back = state.view !== "home" ? '<button class="header-back" data-action="back" aria-label="返回"' + (statisticsPreview ? ' disabled aria-disabled="true"' : '') + '>' + icon("back") + (state.view === "editor" ? "取消" : "") + '</button>' : "";
    // Done belongs to the navigation bar; editing does not add a second toolbar above the cards.
    const leading = state.view === 'home' && state.arranging ? '<button class="header-done" data-action="finish-arrange"><span>完成</span></button>' : back;
    header.innerHTML = leading + '<span class="header-title">' + (state.view === "editor" ? state.editor?.id ? "项目设置" : "新增打卡" : "") + '</span><div class="capsule" aria-hidden="true"><b>···</b><i></i><span></span></div>';
    const color = state.view === "editor" ? state.editor.color : project?.color || "purple";
    document.querySelector(".device").style.setProperty("--accent", palettes[color].start);
    screen.dataset.view = state.view;
    if (state.view === "home") screen.innerHTML = renderHome();
    else if (state.view === "detail" && project) screen.innerHTML = detailMarkup(project);
    else if (state.view === "editor") screen.innerHTML = editorMarkup();
    else { state.view = "home"; screen.innerHTML = renderHome(); }
    screen.scrollTop = oldView === state.view ? oldScroll : state.view === "home" ? state.homeScroll || 0 : 0;
    updateDetailNavTitle();
    updateEditorSave();
    initializeRecordPagination();
  }

  function updateDetailNavTitle() {
    if (state.view !== "detail") return;
    const heading = screen.querySelector(".detail-heading"), title = header.querySelector(".header-title");
    if (!heading || !title) return;
    // The review shell clips content below its toolbar; mirror the native title handoff at that same visible edge.
    const value = heading.getBoundingClientRect().bottom <= screen.getBoundingClientRect().top ? projectById(state.projectId)?.name || "" : "";
    if (title.textContent !== value) title.textContent = value;
  }
  screen.addEventListener("scroll", updateDetailNavTitle, { passive: true });

  function showHome() { state.view = "home"; state.projectId = null; overlay.innerHTML = ""; state.draft = null; render(); }
  function showDetail(id) { const project = projectById(id); if (!project) return; if (state.view === "home") state.homeScroll = screen.scrollTop; Object.assign(state, { view: "detail", projectId: id, metric: project.primary, range: frequencyFor(project) === "day" ? "week" : frequencyFor(project), graph: "cumulative", offset: 0, point: null, calendarDate: null, calendarOffset: 0, showAll: false, recordLimit: RECORD_PREVIEW_LIMIT }); overlay.innerHTML = ""; state.draft = null; render(); }

  function openRecord(id, options = {}) {
    // A fresh input session must never inherit celebratory artwork from the previous save.
    clearCelebration();
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
      // Saved notes are visible on entry; manual collapse/expand keeps the same disposable text.
      supplement: Boolean(options.supplement), notesOpen: Boolean(record?.notes?.trim()), preciseField: null, changed: false, typedKinds: {}, expandedRanges: {}, acceptedValues: {}
    };
    state.draft.acceptedValues = { durationAmount: state.draft.durationAmount, quantity: state.draft.quantity };
    renderSheet();
    // Announce the opened dialog without keeping a close button solely as a focus target.
    overlay.querySelector("#sheet-title")?.focus({ preventScroll: true });
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
    if (value < limits.min || value > limits.max) throw new Error((kind !== "quantity" ? "时间" : "数量") + "请填写" + limits.min + "～" + limits.max + (kind !== "quantity" ? timeUnitLabel(project) : unitFor(project)) + (kind === "quantity" ? "之间的整数。" : "之间的有效时间。"));
  }

  function sliderRange(kind, project) {
    // The range controls the value bounds; integer increments are intrinsic rather than a project setting.
    const current = Number(state.draft[kind]) || state.draft.lastSelected?.[kind] || preferredValue(project, kind);
    const limits = limitsFor(project, kind);
    const source = state.records.find(record => record.id === state.draft.recordId);
    const original = kind === "quantity" ? source?.quantity : timeAmount(source?.durationSeconds, project);
    const previous = state.draft.expandedRanges[kind] || limits;
    const typed = state.draft.typedKinds[kind] && Number.isFinite(current) && current > 0;
    // Grow only this sheet's rail while editing; project preferences wait for the explicit Record action.
    const ceiling = kind === "quantity" ? INPUT_LIMITS.quantity : TIME_LIMITS[timeUnitFor(project)];
    const minimum = Math.min(ceiling, previous.min, limits.min, original ?? limits.min, typed ? Math.floor(current) : limits.min);
    const maximum = Math.min(ceiling, Math.max(previous.max, limits.max, original ?? limits.max, typed ? Math.ceil(current) : limits.max));
    state.draft.expandedRanges[kind] = { min: minimum, max: maximum };
    const span = maximum - minimum;
    const position = value => span ? Math.max(0, Math.min(100, (value - minimum) / span * 100)) : 50;
    // Sliding uses whole selected units; a one-second floor would create repeating decimals that exact-input validation rejects.
    const inputMinimum = Math.max(1, Math.ceil(minimum));
    return { position, minimum, maximum, inputMinimum, current };
  }

  function fieldReadoutMarkup(kind, project, precision) {
    const draft = state.draft, isTime = kind !== "quantity", label = isTime ? "时间" : "数量", unit = isTime ? timeUnitLabel(project) : unitFor(project);
    const active = draft[kind] !== "" && draft[kind] != null;
    const display = active ? isTime ? timeDisplay(Number(draft[kind]) * timeFactor(project), project).number : number(draft[kind]) : "—";
    const maximum = isTime ? TIME_LIMITS[timeUnitFor(project)] : INPUT_LIMITS.quantity;
    const decimals = isTime && unit !== "秒" ? 4 : 0;
    const length = Math.max(String(draft[kind]).length, String(maximum).length + (decimals ? decimals + 1 : 0));
    return precision ? '<div class="ruler-readout precise-readout"><input class="metric-input" inputmode="' + (decimals ? "decimal" : "numeric") + '" maxlength="' + length + '" data-draft="' + kind + '" value="' + escape(draft[kind]) + '" aria-label="精确' + label + '"><small>' + escape(unit) + '</small></div>' : '<button class="ruler-readout" data-action="precise" data-field="' + kind + '" aria-label="精确输入' + label + '"><strong>' + display + '</strong><small>' + escape(unit) + '</small></button>';
  }

  function fieldMarkup(kind, project) {
    const draft = state.draft, isTime = kind !== "quantity", label = isTime ? "时间" : "数量", unit = isTime ? timeUnitLabel(project) : unitFor(project);
    const range = sliderRange(kind, project), active = draft[kind] !== "" && draft[kind] != null;
    const precision = draft.preciseField === kind;
    const display = active ? isTime ? timeDisplay(Number(draft[kind]) * timeFactor(project), project).number : number(draft[kind]) : "—";
    // Native range keeps the thumb under the finger; the input boundary rounds only the recorded amount.
    const scale = '<div class="slider-control"><input class="metric-slider" type="range" min="' + range.minimum + '" max="' + range.maximum + '" step="any" value="' + (active ? draft[kind] : range.current) + '" style="--slider-fill:' + range.position(active ? Number(draft[kind]) : range.current) + '%" data-slider="' + kind + '" aria-label="本次' + label + '" aria-valuetext="' + (active ? display + escape(unit) : "未记录") + '"' + (range.minimum === range.maximum ? ' disabled' : '') + '></div>';
    const readout = fieldReadoutMarkup(kind, project, precision);
    return '<section class="ruler-field ' + (!active ? "ruler-inactive" : "") + '" data-field="' + kind + '"><div class="ruler-field-head"><span class="ruler-label">' + label + '</span>' + readout + '</div>' + scale + '</section>';
  }

  function updateSlider(kind, value, syncThumb = true) {
    if (!state.draft) return;
    state.draft[kind] = value; state.draft.changed = true;
    state.draft.acceptedValues[kind] = value;
    const field = overlay.querySelector('.ruler-field[data-field="' + kind + '"]');
    if (!field) return;
    field.classList.toggle("ruler-inactive", value <= 0);
    const project = projectById(state.draft.projectId);
    const readout = field.querySelector(".ruler-readout strong"), exact = field.querySelector(".metric-input");
    if (readout) readout.textContent = value > 0 ? kind === "quantity" ? number(value) : timeDisplay(value * timeFactor(project), project).number : "—";
    if (exact) exact.value = value;
    const slider = field.querySelector("[data-slider]");
    if (slider) {
      // Keep continuous pointer travel separate from integer data to avoid a thumb that jumps between steps.
      if (syncThumb) slider.value = value;
      slider.style.setProperty("--slider-fill", sliderRange(kind, project).position(Number(slider.value)) + "%");
      slider.setAttribute("aria-valuenow", String(value));
      slider.setAttribute("aria-valuetext", kind === "quantity" ? quantityText(value, project) : timeText(value * timeFactor(project), project));
    }
    updateSubmitButton();
  }

  function initializeSliders() {
    overlay.querySelectorAll("[data-slider]").forEach(slider => {
      const kind = slider.dataset.slider;
      const clamp = value => { const range = sliderRange(kind, projectById(state.draft.projectId)); return Math.max(range.inputMinimum, Math.min(range.maximum, value)); };
      // Typed fractional time and historical values remain exact until this control is deliberately moved.
      slider.addEventListener("input", () => {
        const raw = Number(slider.value);
        updateSlider(kind, clamp(Math.round(raw)), false);
      });
      // Reconcile the thumb once the gesture ends; input and release still require explicit Record to save.
      slider.addEventListener("change", () => { if (state.draft) updateSlider(kind, state.draft[kind]); });
      slider.addEventListener("keydown", event => {
        const range = sliderRange(kind, projectById(state.draft.projectId));
        const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[event.key];
        if (direction == null && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const current = Number(state.draft[kind]) || range.current;
        const next = direction > 0 ? Math.floor(current) + direction : Math.ceil(current) + direction;
        updateSlider(kind, event.key === "Home" ? range.inputMinimum : event.key === "End" ? range.maximum : clamp(next));
      });
    });
  }

  // The save label describes persistence; live amounts remain in the controls and success feedback.
  function submitLabel() {
    return state.draft.recordId ? "保存修改" : "保存记录";
  }

  function renderSheet() {
    const draft = state.draft; if (!draft) return;
    const project = projectById(draft.projectId); if (!project) { closeSheet(); return; }
    // Repainting an existing session must not replay the dialog/scrim entrance when a disclosure changes.
    const updating = overlay.querySelector(".light-sheet") ? " is-updating" : "";
    state.confirm = null;
    const dateFields = draft.supplement
      ? '<div id="record-date-fields" class="supplement-fields"><label class="supplement-row" data-action="pick-temporal"><span>日期</span><input type="date" min="1900-01-01" data-draft="date" value="' + escape(draft.date) + '" max="' + DEMO_TODAY + '" aria-label="日期"></label><label class="supplement-row" data-action="pick-temporal"><span>时间</span><input type="time" data-draft="time" value="' + escape(draft.time) + '" aria-label="时间"></label></div>'
      : "";
    // An expanded date section precedes the entire notes section, including its disclosure label.
    // When date is collapsed, both entry points still share the compact bottom row.
    const notesToggle = '<button class="notes-toggle" data-action="toggle-notes" aria-controls="record-notes" aria-expanded="' + Boolean(draft.notesOpen) + '"><span>' + icon("edit") + (draft.notes ? "备注" : "添加备注") + '</span></button>';
    const tools = '<div class="sheet-tools">' + (draft.supplement ? "" : notesToggle) + '<button class="date-toggle" data-action="supplement" aria-controls="record-date-fields" aria-expanded="' + draft.supplement + '"><span class="date-clock">' + icon("clock") + '</span>' + (draft.date === DEMO_TODAY ? "今天" : shortDate(draft.date)) + (draft.time ? " " + draft.time : "") + icon("chevron") + '</button></div>';
    const oldNote = state.records.find(record => record.id === draft.recordId)?.notes || "";
    const notesInput = draft.notesOpen ? '<textarea id="record-notes" class="notes-input" maxlength="' + Math.max(INPUT_LIMITS.note * 2, oldNote.length) + '" data-draft="notes" aria-label="备注" placeholder="记录想补充的内容">' + escape(draft.notes) + '</textarea><div class="notes-count">' + (oldNote === draft.notes && (textLength(oldNote) > 100 || oldNote.split("\n").length > 3) ? "原备注 " + textLength(oldNote) + " 字" : textLength(draft.notes) + "/100") + '</div>' : "";
    const metricFields = metricOrder(project).map(metric => metric === "durationSeconds" ? draft.showTime ? fieldMarkup("durationAmount", project) : "" : draft.showQuantity ? fieldMarkup("quantity", project) : "").join("");
    overlay.innerHTML = '<div class="overlay' + updating + '" data-scrim="true"><section class="sheet light-sheet' + updating + '" role="dialog" aria-modal="true" aria-labelledby="sheet-title" style="' + cssColor(project) + '"><div class="sheet-heading"><h2 id="sheet-title" tabindex="-1">' + (draft.recordId ? "编辑记录" : escape(project.name)) + '</h2></div>' + metricFields + tools + dateFields + (draft.supplement ? notesToggle : "") + notesInput + '<button id="save-record" class="primary-button" data-action="save-record" aria-label="' + escape(submitLabel()) + '">' + (draft.recordId ? "保存修改" : "保存记录") + '</button>' + (draft.recordId ? '<button class="secondary-button delete-record-button" data-action="delete-record">删除记录</button>' : "") + '</section></div>';
    initializeSliders();
    updateSubmitButton();
  }

  function updateSubmitButton() {
    const button = document.getElementById("save-record");
    if (!button || !state.draft) return;
    button.textContent = state.draft.recordId ? "保存修改" : "保存记录";
    button.setAttribute("aria-label", submitLabel());
    button.disabled = !canSaveRecord();
  }

  function markExplicit() {
    if (!state.draft) return;
    state.draft.explicit = true;
    overlay.querySelectorAll(".field-tip").forEach(element => { element.textContent = "选好后点保存记录"; });
  }

  function closeSheet() {
    // Dismissal discards only this recording session; the independent new-project draft is unaffected.
    state.draft = null; state.confirm = null; overlay.innerHTML = "";
    initializeRecordPagination();
  }

  function readPositive(value, original = null) {
    if (value === "" || value == null) return null;
    const text = String(value).trim();
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) <= 0) throw new Error("请填写大于0的整数。");
    if (Number(text) > INPUT_LIMITS.quantity && Number(text) !== original) throw new Error("单次数量不能超过99,999。");
    return Number(text);
  }

  // Fractions are permitted only when they resolve to whole seconds; quantity remains integer-only.
  function readTime(value, project, originalSeconds = null) {
    if (value === "" || value == null) return null;
    const text = String(value).trim(), amount = Number(text);
    if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(amount) || amount <= 0) throw new Error("请填写大于0的有效时间。");
    if (originalSeconds != null && amount === timeAmount(originalSeconds, project)) return originalSeconds;
    if (!(timeUnitFor(project) === "秒" ? /^\d+$/ : /^\d+(\.\d{1,4})?$/).test(text)) throw new Error("时间最多4位小数，秒数必须为整数。");
    const raw = amount * timeFactor(project), seconds = Math.round(raw);
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || Math.abs(raw - seconds) > 1e-7) throw new Error("时间换算后需精确到整秒，且不能超出可保存范围。");
    if (seconds > INPUT_LIMITS.seconds) throw new Error("单次时间不能超过365天。");
    return seconds;
  }

  function recordCandidate() {
    const draft = state.draft; if (!draft) throw new Error("No active record");
      const existing = draft.recordId ? state.records.find(record => record.id === draft.recordId) : null;
      if (draft.recordId && !existing) throw new Error("这条记录已经不存在，请关闭后重新查看。");
      const project = projectById(draft.projectId); if (!project) throw new Error("项目已经不存在。");
      // Convert exactly once at the boundary; aggregation, edits and undo all retain whole seconds.
      const durationSeconds = readTime(draft.durationAmount, project, existing?.durationSeconds), quantity = readPositive(draft.quantity, existing?.quantity);
      // Removing the skip action makes enabled new metrics mandatory; historical nulls remain untouched.
      if (draft.showTime && durationSeconds == null && (!existing || existing.durationSeconds != null)) throw new Error("请填写本次时间。");
      if (draft.showQuantity && quantity == null && (!existing || existing.quantity != null)) throw new Error("请填写本次数量。");
      if (durationSeconds == null && quantity == null) throw new Error("至少填写一项本次时间或数量。");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(localDate(draft.date).getTime()) || key(localDate(draft.date)) !== draft.date) throw new Error("请选择有效的发生日期。");
      if (draft.date > DEMO_TODAY) throw new Error("请选择今天或之前的发生日期。");
      if (draft.date < INPUT_LIMITS.earliestDate && draft.date !== existing?.date) throw new Error("日期不能早于1900年1月1日。");
      if (draft.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) throw new Error("请选择有效的时间点。");
      const notes = draft.notes === existing?.notes ? existing.notes : normalizeNote(draft.notes).trim();
      if (notes !== existing?.notes && (textLength(notes) > INPUT_LIMITS.note || notes.split("\n").length > 3 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(notes))) throw new Error("备注最多100字、换行2次，不能包含控制字符。");
      // Stage remembered values so validation errors or dismissal cannot partially change configuration.
      const updatedProject = { ...project };
      for (const kind of ["durationAmount", "quantity"]) {
        const value = kind === "quantity" ? quantity : timeAmount(durationSeconds, project);
        const original = kind === "quantity" ? existing?.quantity : timeAmount(existing?.durationSeconds, project);
        if (!draft.typedKinds[kind] || value == null || (existing && value === original)) continue;
        const prefix = kind === "quantity" ? "quantity" : "time";
        updatedProject[prefix + "Min"] = Math.min(project[prefix + "Min"], Math.floor(value));
        updatedProject[prefix + "Max"] = Math.max(project[prefix + "Max"], Math.ceil(value));
        if (kind !== "quantity" && !Number.isSafeInteger(updatedProject.timeMax * timeFactor(project))) throw new Error("时间范围超出可准确记录的范围。");
        if (Number.isSafeInteger(value)) updatedProject[kind === "quantity" ? "defaultQuantity" : "defaultTime"] = value;
      }
      validateRecordAmount(timeAmount(durationSeconds, project), "durationAmount", updatedProject, timeAmount(existing?.durationSeconds, project));
      validateRecordAmount(quantity, "quantity", updatedProject, existing?.quantity);
      const otherRecords = recordsFor(draft.projectId).filter(record => record.id !== draft.recordId);
      if (!Number.isSafeInteger(sum(otherRecords, "durationSeconds") + (durationSeconds || 0)) || !Number.isSafeInteger(sum(otherRecords, "quantity") + (quantity || 0))) throw new Error("累计数值超出当前可准确保存的范围。");
      const reviewTime = new Date(new Date(DEMO_TODAY + "T21:00:00+08:00").getTime() + nextId * 1000).toISOString();
      const record = { id: existing?.id || "entry-" + nextId, projectId: draft.projectId, date: draft.date, time: draft.time, notes, durationSeconds, quantity, quantityUnit: quantity == null ? null : unitFor(project), createdAt: existing?.createdAt || reviewTime, updatedAt: reviewTime };
    return { project, updatedProject, existing, record };
  }

  function canSaveRecord() {
    try { recordCandidate(); return true; } catch { return false; }
  }

  function saveRecord() {
    if (!state.draft) return;
    try {
      const { project, updatedProject, existing, record } = recordCandidate();
      if (!existing) nextId++;
      Object.assign(project, updatedProject);
      if (existing) state.records = state.records.map(value => value.id === record.id ? record : value);
      else state.records.push(record);
      // Use the validated record after commit; an out-of-scope value would leave a saved row behind an open sheet.
      if (record.quantity != null) project.quantityUnitLocked = true;
      closeSheet(); render();
      const summary = metricOrder(project).filter(metric => record[metric] != null).map(metric => metric === "durationSeconds" ? timeText(record[metric], project) : quantityText(record[metric], project)).join(" · ");
      showToast((existing ? "已保存修改 " : "已记录 ") + summary, existing ? null : { type: "create", record });
      // Every new record for today receives equal feedback; edits and past-date entries stay quiet.
      if (!existing && record.date === DEMO_TODAY) celebrateRecord(project);
    } catch { updateSubmitButton(); }
  }

  function recordProject(id) {
    const project = projectById(id); if (!project) return;
    if (project.direct) {
      const valid = (project.mode === "quantity" || (project.defaultTime > 0 && project.defaultTime * timeFactor(project) <= INPUT_LIMITS.seconds)) && (project.mode === "duration" || (project.defaultQuantity > 0 && project.defaultQuantity <= INPUT_LIMITS.quantity));
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

  let celebrationTimer;
  let celebrationEmitter;
  // One bounded overlay belongs to the device, not the scrollable cards; particles never capture input.
  function clearCelebration() {
    clearTimeout(celebrationTimer);
    // Stop the per-device particle renderer before detaching its canvas, including rapid successive saves.
    celebrationEmitter?.reset();
    celebrationEmitter = null;
    document.querySelector(".record-celebration")?.remove();
  }
  function celebrateRecord(project) {
    clearCelebration();
    const device = document.querySelector(".device");
    const card = Array.from(screen.querySelectorAll("[data-project-id]")).find(node => node.dataset.projectId === project.id);
    // A filtered/offscreen card must not make confetti appear in an unrelated visible project.
    if (state.view !== "home" || !card) return;
    const bounds = device.getBoundingClientRect(), target = card.getBoundingClientRect(), viewport = screen.getBoundingClientRect();
    if (target.top >= viewport.bottom || target.bottom <= viewport.top) return;
    const x = (target.left + target.width / 2 - bounds.left) * device.clientWidth / bounds.width;
    // Anchor the confirmation to the exact card center, including any scaled review-device layout.
    const y = (target.top + target.height / 2 - bounds.top) * device.clientHeight / bounds.height;
    const layer = document.createElement("div");
    layer.className = "record-celebration";
    // Keep one celebration strength regardless of how many records this project already has today.
    layer.dataset.intensity = "standard";
    layer.setAttribute("aria-hidden", "true");
    layer.style.setProperty("--burst-x", x + "px");
    layer.style.setProperty("--burst-y", y + "px");
    layer.style.setProperty("--celebration-color", palettes[project.color].start);
    // Frost only the successful card so neighboring totals and navigation remain crisp and readable.
    const glass = document.createElement("span");
    glass.className = "record-success-glass";
    glass.style.cssText = `left:${(target.left - bounds.left) * device.clientWidth / bounds.width}px;top:${(target.top - bounds.top) * device.clientHeight / bounds.height}px;width:${target.width * device.clientWidth / bounds.width}px;height:${target.height * device.clientHeight / bounds.height}px;`;
    layer.append(glass);
    const badge = document.createElement("span");
    badge.className = "record-success-badge";
    // This celebratory handwriting is a one-off illustration; navigation still uses Phosphor Regular.
    // A rounded low hook sweeps into a long tapered tip; the reveal follows that curve, not a rigid V.
    badge.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs><mask id="success-ink-mask"><path class="success-ink-reveal" d="M16 43 C5 67 21 74 38 65 L91 34" fill="none" stroke="white" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></mask></defs><path class="success-ink" mask="url(#success-ink-mask)" d="M19 35 C11 48 12 58 21 60 C25 61 30 60 36 57 L95 29 L36 72 C23 81 11 78 8 69 C4 59 10 44 19 35Z" fill="currentColor"/></svg>';
    layer.append(badge);
    device.append(layer);
    // Realistic Look reference: mix narrow fast and wide slower bursts instead of an evenly spaced fan.
    // Canvas stays inside the prototype device; reduced motion skips allocating the renderer entirely.
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && window.DAKA_CONFETTI_REVIEW) {
      const canvas = document.createElement("canvas");
      canvas.className = "record-confetti-canvas";
      layer.prepend(canvas);
      // Review-only artwork choice shares the success boundary, intensity and lifetime; it is never persisted.
      const variant = document.getElementById('celebration-material')?.value || 'emoji';
      celebrationEmitter = window.DAKA_CONFETTI_REVIEW.play(canvas, { variant, x: x / device.clientWidth, y: y / device.clientHeight, colors: [palettes[project.color].start, "#f0bd58", "#e993aa", "#8bc8ba", "#b7a5e4"] });
    }
    // Cleanup is independent of animationend so reduced motion and interrupted animations cannot leak nodes.
    // Allow the longer mark and falling paper to settle, while subsequent actions can still dismiss immediately.
    celebrationTimer = setTimeout(clearCelebration, 2850);
  }

  function showToast(message, undo = null, subtle = false) {
    clearTimeout(toastTimer); state.undo = undo;
    const toast = document.getElementById("toast");
    // Validation hints use short text only, avoiding a success checkmark or long-lived visual interruption.
    toast.innerHTML = '<span class="toast-message">' + (subtle ? "" : icon("check")) + escape(message) + '</span>' + (undo ? '<button data-action="undo">撤销</button>' : "");
    toast.classList.add("visible");
    toastTimer = setTimeout(hideToast, subtle ? 1500 : 5000);
  }
  function hideToast() { clearTimeout(toastTimer); document.getElementById("toast").classList.remove("visible"); state.undo = null; }
  function undoLast() {
    const undo = state.undo; if (!undo || !projectById(undo.record.projectId)) return;
    if (undo.type === "create") state.records = state.records.filter(record => record.id !== undo.record.id);
    else if (undo.type === "delete" && !state.records.some(record => record.id === undo.record.id)) state.records.push(undo.record);
    hideToast(); render(); showToast("已撤销");
  }

  // A single baseline supplies both the visible new form and safe dormant settings at creation.
  function newEditorForm() {
    return { id: null, name: "", frequency: "day", icon: "book", color: "purple", mode: "duration", primary: "durationSeconds", timeUnit: "分", quantityUnit: "次", quantityUnitLocked: false, timeMin: 1, timeMax: 120, quantityMin: 1, quantityMax: 100, defaultTime: 60, defaultQuantity: 50, direct: false };
  }

  function openEditor(project = null) {
    if (!project && state.projects.length >= INPUT_LIMITS.projects) { showToast(`体验版最多${INPUT_LIMITS.projects}个打卡项目`); return; }
    // Disclosure state belongs to this visit, never to the retained project form.
    state.appearanceExpanded = false;
    if (state.view === "home") state.homeScroll = screen.scrollTop;
    // Keep raw, potentially incomplete text in a clone; validation belongs to explicit creation only.
    state.editor = project ? { ...project, defaultTime: preferredValue(project, "durationAmount"), defaultQuantity: preferredValue(project, "quantity") } : state.newProjectDraft ? { ...state.newProjectDraft } : newEditorForm();
    state.editor.icon = resolveProjectIcon(state.editor.icon);
    state.editor.frequency = frequencyFor(state.editor);
    // Non-frequency settings preserve a deliberately chosen chart scope when returning to detail.
    state.editorChart = project ? { range: state.range, offset: state.offset, showAll: state.showAll, recordLimit: state.recordLimit } : null;
    state.editorReturn = project ? "detail" : "home";
    state.editorBaseline = JSON.stringify(state.editor);
    state.view = "editor"; overlay.innerHTML = ""; state.draft = null; render();
  }

  function settingInput(label, property, placeholder = "选填", inputmode = "numeric") {
    const maximum = property === "defaultTime" ? TIME_LIMITS[timeUnitFor(state.editor)] : INPUT_LIMITS.quantity;
    return '<label class="setting-row"><span>' + label + '</span><input data-editor="' + property + '" maxlength="' + Math.max(String(state.editor[property]).length, String(maximum).length) + '" value="' + escape(state.editor[property]) + '" placeholder="' + placeholder + '" inputmode="' + inputmode + '"></label>';
  }

  // A separator communicates the range visually; explicit accessible labels still distinguish its bounds.
  function rangeSettingMarkup(label, kind) {
    const maximum = kind === "time" ? TIME_LIMITS[timeUnitFor(state.editor)] : INPUT_LIMITS.quantity;
    return `<div class="setting-row range-row"><span>${label}范围</span><div class="range-values">${[["Min", "最小"], ["Max", "最大"]].map(([suffix, text]) => `<label class="range-value"><input data-editor="${kind + suffix}" maxlength="${Math.max(String(state.editor[kind + suffix]).length, String(maximum).length)}" value="${escape(state.editor[kind + suffix])}" style="--value-chars:${Math.max(1, String(state.editor[kind + suffix]).length)}" inputmode="numeric" aria-label="${text + label}"></label>`).join('<span class="range-separator" aria-hidden="true">–</span>')}</div></div>`;
  }

  // Zero is a valid ruler boundary, while saved/default amounts must still produce a positive record.
  function validEditorRange(kind, editor = state.editor) {
    if (!["Min", "Max"].every(suffix => /^\d+$/.test(String(editor[kind + suffix])))) return null;
    const minimum = Number(editor[kind + "Min"]), maximum = Number(editor[kind + "Max"]);
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

  // Switching units changes display configuration only; existing second-based records are never rewritten.
  function changeEditorTimeUnit(unit) {
    const editor = state.editor;
    if (!Object.hasOwn(timeUnits, unit) || unit === editor.timeUnit) return;
    const before = editor.timeMin + "|" + editor.timeMax;
    editor.timeUnit = unit;
    for (const field of ["timeMin", "timeMax", "defaultTime"])
      if (/^\d+$/.test(String(editor[field])) && Number(editor[field]) > TIME_LIMITS[unit]) editor[field] = TIME_LIMITS[unit];
    if (before !== editor.timeMin + "|" + editor.timeMax && validEditorRange("time")) updateEditorDefault("time");
  }

  // Time units are convertible display/input choices; raw records always retain their second-based value.
  function timeUnitSettingMarkup(editor) {
    // Keep the product order 分、时、天; legacy seconds never become a new selectable option.
    return `<div class="setting-row"><span>时间单位</span><div class="time-unit-options" role="group" aria-label="时间单位">${["分", "时", "天"].map(unit => `<button data-action="editor-time-unit" data-value="${unit}" class="${timeUnitFor(editor) === unit ? 'active' : ''}" aria-pressed="${timeUnitFor(editor) === unit}">${timeUnitLabels[unit]}</button>`).join("")}</div></div>`;
  }

  // Name the quantity unit explicitly; its historical lock survives deletion of saved quantity entries.
  function unitSettingMarkup(editor) {
    if (!["quantity", "both"].includes(editor.mode)) return "";
    const locked = Boolean(editor.quantityUnitLocked);
    return '<label class="setting-row quantity-unit-setting"><span>数量单位</span><input data-editor="quantityUnit" value="' + escape(editor.quantityUnit) + '" placeholder="次" maxlength="8" aria-label="' + (locked ? '数量单位，已有记录，不可更改' : '数量单位') + '"' + (locked ? ' readonly' : '') + '></label>';
  }

  function configRowLabel(label, iconName) {
    return `<span class="config-row-label">${icon(iconName)}<span>${escape(label)}</span></span>`;
  }

  // Each metric owns a switch and its parameters; hiding a group leaves its raw editor values intact.
  function metricGroupMarkup(mode, label, parameters) {
    const enabled = state.editor.mode === mode || state.editor.mode === "both";
    const panelId = mode + "-parameters";
    return `<section class="editor-metric-group"><label class="setting-row metric-toggle-row config-heading-row">${configRowLabel(label, mode === "duration" ? "clock" : "quantity")}<input class="toggle" type="checkbox" role="switch" data-action="editor-mode" data-value="${mode}" ${enabled ? 'checked' : ''} aria-label="${label}" aria-controls="${panelId}" aria-expanded="${enabled}"></label><div id="${panelId}" class="metric-parameters" role="group" aria-label="${label}参数" ${enabled ? '' : 'hidden'}>${enabled ? parameters : ''}</div></section>`;
  }

  // Compact 日/周/月 options precede primary preference; descriptive badges retain 每日/每周/每月 and 44px targets.
  function frequencySettingMarkup(editor) {
    return `<div class="setting-row frequency-setting config-heading-row">${configRowLabel("打卡频率", "clock")}<div class="frequency-options" role="group" aria-label="打卡频率">${[["day", "日"], ["week", "周"], ["month", "月"]].map(([value, label]) => `<button data-action="editor-frequency" data-value="${value}" aria-pressed="${frequencyFor(editor) === value}"><span class="${frequencyFor(editor) === value ? 'active' : ''}">${label}</span></button>`).join("")}</div></div>`;
  }

  // One connected card groups time, quantity, the primary metric and direct entry without repeated headings.
  function editorMarkup() {
    const editor = state.editor;
    const timeEnabled = ["duration", "both"].includes(editor.mode), quantityEnabled = ["quantity", "both"].includes(editor.mode);
    const colors = appearanceOptions(Object.entries(palettes).map(([id, value]) => ({id, ...value})), editor.color).map(value => { const color = value.id; return `<button data-action="color" data-value="${color}" style="--swatch-color:${value.start}" aria-label="${value.name}主题色" aria-pressed="${editor.color === color}" class="${editor.color === color ? 'selected' : ''}"><span class="appearance-swatch">${editor.color === color ? icon("check") : ''}</span></button>`; }).join("");
    const icons = appearanceOptions(projectIcons, editor.icon).map(({id: value, label}) => `<button data-action="icon" data-value="${value}" class="${editor.icon === value ? 'selected' : ''}" aria-label="${label}图标">${icon(value)}</button>`).join("");
    const timeParameters = timeUnitSettingMarkup(editor) + rangeSettingMarkup("时间", "time") + settingInput("默认时间", "defaultTime", timeUnitLabel(editor));
    const quantityParameters = unitSettingMarkup(editor) + rangeSettingMarkup("数量", "quantity") + settingInput("默认数量", "defaultQuantity", unitFor(editor));
    // A disabled type cannot become primary, but the stored preference returns when both types are enabled.
    const primary = editor.mode === "both" ? editor.primary : timeEnabled ? "durationSeconds" : quantityEnabled ? "quantity" : null;
    const primaryButtons = [["durationSeconds", "时间", timeEnabled], ["quantity", "数量", quantityEnabled]].map(([value, label, enabled]) => `<button data-action="editor-primary" data-value="${value}" class="${primary === value ? 'active' : ''}" aria-pressed="${primary === value}" ${enabled ? '' : 'disabled'}>${label}</button>`).join("");
    const config = `<div class="setting-box editor-config">${metricGroupMarkup("duration", "时间", timeParameters)}${metricGroupMarkup("quantity", "数量", quantityParameters)}${frequencySettingMarkup(editor)}<div class="setting-row primary-metric-row config-heading-row">${configRowLabel("主要指标", "chart")}<div class="editor-metric-toggle" role="group" aria-label="主要指标">${primaryButtons}</div></div><label class="setting-row direct-entry-row config-heading-row">${configRowLabel("快速打卡", "bolt")}<input class="toggle" type="checkbox" role="switch" data-editor="direct" ${editor.direct ? 'checked' : ''} aria-label="快速打卡"></label></div>`;
    return `<div class="editor-preview" style="${cssColor(editor)}">${icon(editor.icon)}<div><strong id="preview-name">${escape(editor.name || "打卡名称")}</strong><span>${frequencyName(editor)} · ${modeLabel(editor.mode)}</span></div></div><div class="setting-box"><label class="setting-row"><input class="full-name-input" data-editor="name" value="${escape(editor.name)}" placeholder="打卡名称" maxlength="12" aria-label="打卡名称"></label></div><div class="editor-label">外观样式</div><div class="setting-box"><div class="color-options">${colors}</div><div class="icon-options">${icons}</div><button class="appearance-more" data-action="appearance-more" aria-expanded="${Boolean(state.appearanceExpanded)}"><span>${state.appearanceExpanded ? "收起外观" : "更多外观"}</span><span class="appearance-arrow ${state.appearanceExpanded ? "expanded" : ""}">${icon("expand")}</span></button></div><div class="editor-label">打卡类型</div>${config}<button class="primary-button editor-save" data-action="save-project">${editor.id ? "保存设置" : "创建打卡"}</button>`;
  }

  // Submission eligibility and persistence share one prepared clone; raw text remains untouched until blur or a write.
  function preparedEditor(raw) {
    const editor = { ...raw }, baseline = { ...newEditorForm(), ...projectById(raw.id) };
    for (const kind of ["time", "quantity"]) {
      const range = validEditorRange(kind, editor), property = kind === "time" ? "defaultTime" : "defaultQuantity";
      if (range && /^\d+$/.test(String(editor[property])) && Number.isSafeInteger(Number(editor[property])))
        editor[property] = Math.min(range.max, Math.max(1, range.min, Number(editor[property])));
      if (kind === "time" ? ["duration", "both"].includes(editor.mode) : ["quantity", "both"].includes(editor.mode)) continue;
      const fields = kind === "time" ? ["timeUnit", "timeMin", "timeMax", "defaultTime"] : ["quantityUnit", "quantityMin", "quantityMax", "defaultQuantity"];
      const retained = Object.fromEntries(fields.map(field => [field, editor[field]]));
      try {
        // Validate the dormant group alone; an unfinished enabled group must not erase valid hidden settings.
        projectCandidate({ ...baseline, ...retained, id: raw.id, name: "配置", mode: "both" }, false);
      } catch {
        for (const field of fields) editor[field] = baseline[field];
      }
    }
    return editor;
  }

  function projectCandidate(raw = state.editor, prepare = true) {
      const editor = prepare ? preparedEditor(raw) : raw, name = editor.name.trim();
      if (!name) throw new Error("先为这件事起个名字。");
      if (editor.mode === "none") throw new Error("请至少选择时间或数量。");
      if (!Object.hasOwn(timeUnits, editor.timeUnit || "分")) throw new Error("请选择有效的时间单位。");
      if (!["day", "week", "month"].includes(editor.frequency)) throw new Error("请选择有效的打卡频率。");
      const previous = projectById(editor.id);
      if (editor.timeUnit === "秒" && previous?.timeUnit !== "秒") throw new Error("时间单位请选择分、时或天。");
      if (textLength(name) > (name === previous?.name ? 24 : INPUT_LIMITS.name) || (name !== previous?.name && /[\u0000-\u001f\u007f\u2028\u2029]/.test(name))) throw new Error("打卡名称最多6字，不能包含换行。");
      const quantityUnit = String(editor.quantityUnit ?? "次").trim();
      // Units are short literal text, never markup; changing a historical measure requires a new project.
      if (!quantityUnit || Array.from(quantityUnit).length > 4 || /[\s\u0000-\u001f\u007f]/.test(quantityUnit)) throw new Error("单位请填写1～4个字符，不能含空格。");
      if (previous?.quantityUnitLocked && quantityUnit !== unitFor(previous)) throw new Error("已有数量记录，单位不可更改。");
      if (!quantityUnitAllowed(quantityUnit)) throw new Error("请填写支持的常用数量单位。");
      // Prepared hidden groups still pass the same range/default/unit checks as visible groups.
      const readRange = kind => {
        const range = validEditorRange(kind, editor);
        if (!range || !/^\d+$/.test(String(editor[kind + "Min"])) || !/^\d+$/.test(String(editor[kind + "Max"]))) throw new Error((kind !== "quantity" ? "时间" : "数量") + "范围需填写非负整数，最大值须大于0且不小于最小值。");
        const maximum = kind === "time" ? TIME_LIMITS[timeUnitFor(editor)] : INPUT_LIMITS.quantity;
        const sameUnit = previous && (kind === "time" ? timeUnitFor(editor) === timeUnitFor(previous) : quantityUnit === unitFor(previous));
        for (const suffix of ["Min", "Max"]) if (Number(editor[kind + suffix]) > maximum && !(sameUnit && Number(editor[kind + suffix]) === previous[kind + suffix])) throw new Error((kind === "time" ? "时间" : "数量") + "范围不能超过" + maximum + "。");
        return range;
      };
      const timeRange = readRange("time");
      if (!Number.isSafeInteger(timeRange.max * timeFactor(editor))) throw new Error("时间范围换算后超出可准确保存的范围。");
      const quantityRange = readRange("quantity");
      const readDefault = (value, range, label) => {
        const property = label === "时间" ? "defaultTime" : "defaultQuantity";
        const result = readPositive(value, previous?.[property]);
        const maximum = label === "时间" ? TIME_LIMITS[timeUnitFor(editor)] : INPUT_LIMITS.quantity;
        const sameUnit = previous && (label === "时间" ? timeUnitFor(editor) === timeUnitFor(previous) : quantityUnit === unitFor(previous));
        if (result > maximum && !(sameUnit && result === previous[property])) throw new Error("默认" + label + "不能超过" + maximum + "。");
        if (result == null || result < range.min || result > range.max) throw new Error("默认" + label + "需填写范围内的整数。");
        return result;
      };
      const defaultTime = readDefault(editor.defaultTime, timeRange, "时间");
      const defaultQuantity = readDefault(editor.defaultQuantity, quantityRange, "数量");
      const project = { id: editor.id || "project-" + nextId, name, frequency: editor.frequency, color: editor.color, icon: editor.icon, mode: editor.mode, primary: editor.mode === "duration" ? "durationSeconds" : editor.mode === "quantity" ? "quantity" : editor.primary, quantityUnit, quantityUnitLocked: previous?.quantityUnitLocked || false, timeUnit: editor.timeUnit || "分", timeMin: timeRange.min, timeMax: timeRange.max, quantityMin: quantityRange.min, quantityMax: quantityRange.max, defaultTime, defaultQuantity, direct: editor.direct };
    return project;
  }

  function updateEditorSave() {
    const button = document.querySelector(".editor-save");
    // Mirror the native page: either metric restores the action; incomplete fields still use its focus guidance.
    if (button && state.editor) button.disabled = state.editor.mode === "none";
  }

  function focusEditorRequired() {
    const editor = state.editor;
    let field = "name";
    if (editor.name.trim()) {
      if (editor.mode === "none") field = "types";
      else for (const kind of ["time", "quantity"]) {
        if (!(kind === "time" ? ["duration", "both"] : ["quantity", "both"]).includes(editor.mode)) continue;
        if (kind === "quantity" && !quantityUnitAllowed(String(editor.quantityUnit).trim())) { field = "quantityUnit"; break; }
        if (!/^\d+$/.test(String(editor[kind + "Min"]))) { field = kind + "Min"; break; }
        if (!validEditorRange(kind)) { field = kind + "Max"; break; }
        const key = kind === "time" ? "defaultTime" : "defaultQuantity";
        if (!/^\d+$/.test(String(editor[key])) || Number(editor[key]) <= 0) { field = key; break; }
      }
    }
    // Match the native save-time hint without showing the whitelist or adding a persistent error block.
    if (field === "quantityUnit") showToast("不是有效单位", null, true);
    const target = field === "types" ? screen.querySelector('.editor-config [data-action="editor-mode"]') : screen.querySelector('[data-editor="' + field + '"]');
    if (!target) return;
    // Scroll only the phone's content, keeping the surrounding review board in place.
    screen.scrollTo({ top: screen.scrollTop + target.getBoundingClientRect().top - screen.getBoundingClientRect().top - 16, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }

  function saveProject() {
    const editor = state.editor; if (!editor) return;
    // Recheck immediately before creation; a retained draft does not reserve a project slot.
    if (!editor.id && state.projects.length >= INPUT_LIMITS.projects) { showToast(`体验版最多${INPUT_LIMITS.projects}个打卡项目`); return; }
    try {
      const project = projectCandidate();
      const previous = projectById(editor.id), chart = state.editorChart;
      const keepChart = previous && frequencyFor(previous) === frequencyFor(project);
      if (!editor.id) nextId++;
      if (editor.id) state.projects = state.projects.map(value => value.id === editor.id ? project : value);
      else state.projects.push(project);
      // A successful creation consumes its draft and reveals the new card even after a filtered search.
      if (!editor.id) { state.newProjectDraft = null; state.search = ""; }
      const returnTo = state.editorReturn;
      if (returnTo === "detail") { showDetail(project.id); if (keepChart && chart) { Object.assign(state, chart); state.point = null; render(); } } else showHome();
      showToast(editor.id ? "已保存设置" : "已创建打卡");
    } catch { focusEditorRequired(); }
  }

  function confirmDelete(type) {
    const record = type === "record" ? state.records.find(value => value.id === state.draft?.recordId) : null;
    const project = projectById(record?.projectId || state.projectId); if (!project) return;
    state.confirm = { type, projectId: project.id, recordId: record?.id };
    const title = type === "record" ? "删除这条记录？" : "删除「" + project.name + "」？";
    // Empty projects need no record-count reminder in the deletion confirmation.
    const recordCount = recordsFor(project.id).length;
    const projectSummary = recordCount > 0 ? "将删除此项目及其 " + recordCount + " 条记录，" : "将删除此项目，";
    const detail = type === "record" ? "删除后可短暂撤销，累计与图表将同步更新。" : projectSummary + "且无法恢复。";
    overlay.innerHTML = '<div class="overlay"><section class="sheet confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">' + escape(title) + '</h2><p>' + escape(detail) + '</p><button class="primary-button danger-button" data-action="confirm-delete">' + (type === "record" ? "删除记录" : "删除项目") + '</button><button class="secondary-button" data-action="cancel-delete">取消</button></section></div>';
  }

  function deleteConfirmed() {
    const pending = state.confirm; if (!pending) return;
    if (pending.type === "record") {
      const record = state.records.find(value => value.id === pending.recordId); if (!record) return;
      state.records = state.records.filter(value => value.id !== record.id);
      closeSheet(); render(); showToast("已删除记录", { type: "delete", record });
    } else {
      state.records = state.records.filter(record => record.projectId !== pending.projectId);
      state.projects = state.projects.filter(project => project.id !== pending.projectId);
      state.arrangeOrder = state.arrangeOrder.filter(id => id !== pending.projectId);
      hideToast(); closeSheet(); showHome(); showToast("已删除项目");
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
    overlay.innerHTML = '<div class="overlay"><section class="sheet confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="discard-title"><h2 id="discard-title">放弃未保存的修改？</h2><button class="primary-button" data-action="cancel-delete">继续编辑</button><button class="secondary-button delete-record-button" data-action="discard-editor">放弃修改</button></section></div>';
    overlay.querySelector("button")?.focus({ preventScroll: true });
  }

  // Review shortcuts are outside the product frame and never become actual app navigation.
  function frequencyFixtures() {
    resetFixtures();
    const presets = [["motor", "摩托加油", "week", "orange", "bicycle"], ["car", "汽车加油", "month", "blue", "target"]];
    const projects = presets.map(([id, name, frequency, color, icon]) => ({ ...state.projects[4], id, name, frequency, color, icon, quantityMin: 1, quantityMax: 5, defaultQuantity: 1, direct: false }));
    projects.forEach(project => {
      const dates = project.frequency === "month" ? ["2026-05-05", "2026-06-08", "2026-07-10", "2026-08-12", "2026-09-15", "2026-10-18", "2026-11-16"] : ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10", "2026-11-17", "2026-11-23"];
      state.records.push(...dates.map((date, index) => ({ id: project.id + index, projectId: project.id, date, time: "18:00", durationSeconds: null, quantity: 1, quantityUnit: "次", notes: "", createdAt: date + "T18:00:00+08:00" })));
    });
    state.projects = [state.projects[0], ...projects, state.projects[1], state.projects[4]];
  }

  function demoScene(scene) {
    clearCelebration();
    closeSheet();
    // Review-only shortcuts exercise the real success path using disposable fixture records.
    if (scene === "celebration-first" || scene === "celebration-repeat") {
      resetFixtures();
      const id = "reading";
      if (scene === "celebration-first") state.records = state.records.filter(record => record.projectId !== id || record.date !== DEMO_TODAY);
      showHome();
      if (scene === "celebration-repeat") {
        // Reading already has a today fixture; its quick path must receive the same full celebration.
        Object.assign(projectById(id), { direct: true, defaultTime: 30 });
        state.lastDirect = 0;
        recordProject(id);
        return;
      }
      openRecord(id);
      saveRecord();
      return;
    }
    if (["duration", "quantity", "both", "detail"].includes(scene) && !projectById("reading")) resetFixtures();
    if (scene === "reset") { resetFixtures(); render(); }
    else if (scene.startsWith("frequency")) {
      frequencyFixtures();
      if (scene === "frequency-week") showDetail("motor");
      else if (scene === "frequency-month") showDetail("car");
      else if (scene === "frequency-create") { openEditor(); state.editor.frequency = "month"; state.editor.name = "汽车加油"; state.editor.mode = "quantity"; state.editor.primary = "quantity"; state.editor.quantityMin = 1; state.editor.quantityMax = 5; state.editor.defaultQuantity = 1; render(); }
      else showHome();
    }
    else if (scene === "home") showHome();
    else if (scene === "duration") { showHome(); openRecord("reading", { fresh: true }); }
    else if (scene === "quantity") { showHome(); openRecord("basketball", { fresh: true }); }
    else if (scene === "both") { showHome(); openRecord("rope", { fresh: true }); }
    else if (scene === "detail") showDetail("rope");
    else if (scene === "create") openEditor();
    else if (scene === "empty") { state.projects = []; state.records = []; showHome(); }
    document.querySelectorAll("[data-demo]").forEach(button => button.classList.toggle("active", button.dataset.demo === scene));
  }

  // The prototype mirrors native long-press semantics without saving real user data.
  let cardPress = null, cardDrag = null, cardHoldTimer, cardScrollTimer, cardSettleTimer, suppressCardClickUntil = 0;
  function enterArrange() {
    if (state.arranging || state.view !== 'home' || state.draft || state.confirm) return;
    state.arranging = true;
    state.arrangeOrder = state.projects.map(project => project.id);
    suppressCardClickUntil = Date.now() + 600;
    hideToast(); render();
  }
  function finishArrange(commit) {
    clearTimeout(cardSettleTimer); cardSettleTimer = null;
    if (commit) state.projects = state.arrangeOrder.map(projectById).filter(Boolean);
    state.arranging = false; state.arrangeOrder = []; render();
  }
  // Preview the actual packing order, so mixed full-width and half-width cards never overlap while making room.
  function cardPacking(drag) {
    const ids = state.arrangeOrder, next = [...ids], from = next.indexOf(drag.id);
    next.splice(from, 1); next.splice(drag.target, 0, drag.id);
    const left = Math.min(...drag.slots.map(slot => slot.left)), right = Math.max(...drag.slots.map(slot => slot.right));
    const top = Math.min(...drag.slots.map(slot => slot.top));
    const adjacent = drag.slots.findIndex((slot, i) => i > 0 && Math.abs(slot.top - drag.slots[i - 1].top) < 2);
    const gap = adjacent > 0 ? Math.max(0, drag.slots[adjacent].left - drag.slots[adjacent - 1].right) : 12;
    let x = left, y = top, rowHeight = 0;
    const positions = new Map();
    next.forEach(id => {
      const slot = drag.slots[ids.indexOf(id)];
      if (x > left && x + slot.width > right + 1) { x = left; y += rowHeight + gap; rowHeight = 0; }
      positions.set(id, { left: x, top: y, width: slot.width, height: slot.height });
      x += slot.width + gap; rowHeight = Math.max(rowHeight, slot.height);
    });
    return { positions, left, top };
  }
  function updateCardDrag() {
    const drag = cardDrag; if (!drag) return;
    const scroll = screen.scrollTop - drag.scroll;
    drag.card.style.transform = 'translate(' + (drag.x - drag.startX) + 'px,' + (drag.y - drag.startY + scroll) + 'px) scale(1.035)';
    let distance = Infinity;
    drag.slots.forEach((slot, index) => {
      const d = (drag.x - slot.left - slot.width / 2) ** 2 + (drag.y + scroll - slot.top - slot.height / 2) ** 2;
      if (d < distance) { distance = d; drag.target = index; }
    });
    if (drag.previewTarget === drag.target) return;
    drag.previewTarget = drag.target;
    const packing = cardPacking(drag);
    drag.packing = packing;
    // Move the card nearest the insertion hole first, followed by the rest of the affected chain.
    orderedCards().forEach((card, index) => {
      if (card === drag.card) return;
      const target = packing.positions.get(card.dataset.projectId), original = drag.slots[index];
      const dx = target.left - original.left, dy = target.top - original.top;
      card.style.transitionDelay = (dx || dy ? Math.min(140, Math.abs(index - drag.target) * 28) : 0) + 'ms';
      card.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    });
    const hole = packing.positions.get(drag.id);
    Object.assign(drag.placeholder.style, { left: (hole.left - packing.left) + 'px', top: (hole.top - packing.top) + 'px', width: hole.width + 'px', height: hole.height + 'px' });
  }
  // Keep the live nodes and their wiggle timelines; CSS order changes layout without remounting siblings.
  function orderedCards() {
    const cards = new Map(Array.from(screen.querySelectorAll('.project-card'), card => [card.dataset.projectId, card]));
    return state.arrangeOrder.map(id => cards.get(id)).filter(Boolean);
  }
  function commitCardLayout(drag) {
    const cards = orderedCards();
    cards.forEach((card, index) => {
      card.style.transition = 'none';
      card.style.transitionDelay = '0ms';
      card.style.order = index;
      card.style.transform = '';
    });
    drag.card.classList.remove('is-dragging', 'is-settling');
    drag.placeholder.remove();
    // Resolve the new grid and zero offsets together before enabling the next drag's transitions.
    void drag.card.parentElement.offsetWidth;
    cards.forEach(card => { card.style.transition = ''; card.style.transitionDelay = ''; });
    cardSettleTimer = null;
  }
  function stopCardDrag(cancel) {
    clearInterval(cardScrollTimer); cardScrollTimer = null;
    const drag = cardDrag; cardDrag = null;
    if (!drag) return;
    const moved = Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 6;
    if (!cancel && moved) {
      const packing = drag.packing || cardPacking(drag), target = packing.positions.get(drag.id);
      const origin = drag.slots[state.arrangeOrder.indexOf(drag.id)];
      const from = state.arrangeOrder.indexOf(drag.id);
      state.arrangeOrder.splice(from, 1); state.arrangeOrder.splice(drag.target, 0, drag.id);
      drag.card.classList.add('is-settling');
      drag.card.style.transform = 'translate(' + (target.left - origin.left) + 'px,' + (target.top - origin.top) + 'px) scale(1)';
      // Commit DOM order only after the last staggered neighbor has reached its new slot.
      cardSettleTimer = setTimeout(() => commitCardLayout(drag), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380);
    } else {
      screen.querySelectorAll('.project-card').forEach(card => { card.style.transitionDelay = '0ms'; card.style.transform = ''; });
      drag.card.classList.add('is-settling');
      cardSettleTimer = setTimeout(() => commitCardLayout(drag), 230);
    }
    suppressCardClickUntil = Date.now() + 500;
  }
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || state.view !== 'home' || state.confirm || cardSettleTimer) return;
    const card = event.target.closest('.project-card'); if (!card || event.target.closest('.remove-card')) return;
    cardPress = { x: event.clientX, y: event.clientY };
    if (!state.arranging) {
      cardHoldTimer = setTimeout(enterArrange, 500); return;
    }
    event.preventDefault();
    cardDrag = { id: card.dataset.projectId, card, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, scroll: screen.scrollTop, target: state.arrangeOrder.indexOf(card.dataset.projectId),
      slots: orderedCards().map(node => node.getBoundingClientRect()) };
    const placeholder = document.createElement('div');
    placeholder.className = 'drag-placeholder'; placeholder.setAttribute('aria-hidden', 'true');
    card.parentElement.appendChild(placeholder); cardDrag.placeholder = placeholder; cardDrag.previewTarget = -1;
    card.classList.add('is-dragging'); updateCardDrag();
    card.setPointerCapture(event.pointerId);
    cardScrollTimer = setInterval(() => {
      if (!cardDrag) return;
      const rect = screen.getBoundingClientRect(), y = cardDrag.y;
      if (y > rect.bottom - 64) screen.scrollTop += 12;
      else if (y < rect.top + 64) screen.scrollTop -= 12;
      updateCardDrag();
    }, 50);
  });
  document.addEventListener('pointermove', event => {
    if (cardPress && Math.hypot(event.clientX - cardPress.x, event.clientY - cardPress.y) > 8) clearTimeout(cardHoldTimer);
    if (!cardDrag) return;
    event.preventDefault(); cardDrag.x = event.clientX; cardDrag.y = event.clientY; updateCardDrag();
  }, { passive: false });
  document.addEventListener('pointerup', () => { clearTimeout(cardHoldTimer); cardPress = null; stopCardDrag(false); });
  document.addEventListener('pointercancel', () => { clearTimeout(cardHoldTimer); cardPress = null; stopCardDrag(true); });
  document.addEventListener('keydown', event => {
    if (!state.arranging || state.confirm || cardSettleTimer) return;
    if (event.key === 'Escape') { finishArrange(false); return; }
    const card = event.target.closest('.project-card');
    if (!card || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const index = state.arrangeOrder.indexOf(card.dataset.projectId);
    const next = Math.max(0, Math.min(state.arrangeOrder.length - 1, index + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1)));
    state.arrangeOrder.splice(index, 1); state.arrangeOrder.splice(next, 0, card.dataset.projectId);
    render(); screen.querySelector('[data-project-id="' + card.dataset.projectId + '"] .arrange-hit')?.focus();
  });

  document.addEventListener("click", event => {
    const review = event.target.closest("[data-demo]");
    if (review) { demoScene(review.dataset.demo); return; }
    // Match native cancellation only on the home canvas, never on cards, chrome, or confirmation dialogs.
    if (state.arranging && state.view === 'home' && !state.confirm && !cardDrag && !cardSettleTimer && Date.now() >= suppressCardClickUntil && screen.contains(event.target) && !event.target.closest('.project-card')) {
      finishArrange(false); return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) { if (event.target.matches("[data-scrim]") && !state.confirm) closeSheet(); return; }
    const action = button.dataset.action;
    // Keep the presentation on this detail screen even if a stale or synthetic navigation click arrives.
    if (statisticsPreview && !statisticsPreviewActions.has(action)) return;
    if (state.view === 'home' && ['record','detail','create'].includes(action) && (state.arranging || Date.now() < suppressCardClickUntil)) return;
    if (action === 'finish-arrange') { finishArrange(true); return; }
    if (action === 'remove-card') { state.projectId = button.dataset.id; confirmDelete('project'); return; }
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
      const input = overlay.querySelector('.precise-readout input'); input?.focus(); input?.select();
    } else if (action === "toggle-notes") {
      state.draft.notesOpen = !state.draft.notesOpen; renderSheet();
      // Disclosure retains its focus without scrolling the dialog or opening a software keyboard before text entry.
      overlay.querySelector('.notes-toggle')?.focus({ preventScroll: true });
    }
    else if (action === "supplement") { markExplicit(); state.draft.supplement = !state.draft.supplement; state.draft.changed = true; renderSheet(); }
    else if (action === "undo") undoLast();
    else if (action === "calendar-month") { const heat = calendarData(projectById(state.projectId)); if (Number(button.dataset.delta) < 0 && !heat.previous) return; state.calendarOffset = Math.min(0, (state.calendarOffset || 0) + Number(button.dataset.delta)); state.calendarDate = null; state.showAll = false; render(); }
    else if (action === "calendar-day") { state.calendarDate = state.calendarDate === button.dataset.date ? null : button.dataset.date; state.showAll = false; render(); }
    else if (action === "calendar-clear") { state.calendarDate = null; state.showAll = false; render(); }
    else if (action === "metric") { state.metric = button.dataset.value; state.point = null; state.calendarDate = null; if (state.graph === "calendar") state.showAll = false; render(); }
    else if (action === "range") { state.range = button.dataset.value; state.offset = 0; state.point = null; state.showAll = false; state.recordLimit = RECORD_PREVIEW_LIMIT; render(); }
    else if (action === "graph") { state.graph = button.dataset.value; state.point = null; state.calendarDate = null; state.showAll = false; render(); }
    else if (action === "period") { state.offset = Math.min(0, state.offset + Number(button.dataset.delta)); state.point = null; state.showAll = false; state.recordLimit = RECORD_PREVIEW_LIMIT; render(); }
    else if (action === "all-records") { state.calendarDate = null; state.showAll = true; state.recordLimit = RECORD_PAGE_SIZE; render(); }
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
    } else if (action === "appearance-more") {
      // Disclosure does not touch the editor snapshot or retained draft; keep keyboard focus after re-render.
      state.appearanceExpanded = !state.appearanceExpanded;
      render();
      screen.querySelector('[data-action="appearance-more"]')?.focus({ preventScroll: true });
    } else if (action === "color") { state.editor.color = button.dataset.value; render(); }
    else if (action === "editor-frequency") {
      if (!["day", "week", "month"].includes(button.dataset.value)) return;
      state.editor.frequency = button.dataset.value; render();
      screen.querySelector('[data-action="editor-frequency"][data-value="' + button.dataset.value + '"]')?.focus({ preventScroll: true });
    }
    else if (action === "editor-time-unit") { changeEditorTimeUnit(button.dataset.value); render(); }
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
    if (event.isComposing) return;
    const element = event.target;
    // IME intermediate text is left intact; compositionend applies the completed search immediately.
    if (element.id === "project-search" && !event.isComposing) updateSearch(element.value);
    if (element.dataset.draft && state.draft) {
      const field = element.dataset.draft, previous = String(state.draft[field] ?? "");
      if (["durationAmount", "quantity"].includes(field)) {
        const unit = timeUnitFor(projectById(state.draft.projectId));
        const maximum = field === "quantity" ? INPUT_LIMITS.quantity : TIME_LIMITS[unit];
        const decimals = field === "durationAmount" && unit !== "秒" ? 4 : 0;
        if (!acceptNumber(element.value, previous, maximum, decimals) || (!decimals && element.value !== "" && Number(element.value) === 0)) {
          element.value = previous;
          return;
        }
      } else if (field === "notes") {
        const old = state.records.find(record => record.id === state.draft.recordId)?.notes || "";
        const legacyEditing = (textLength(old) > 100 || old.split("\n").length > 3) && (textLength(previous) > 100 || previous.split("\n").length > 3);
        if (legacyEditing && textLength(normalizeNote(element.value)) > textLength(previous)) { element.value = previous; return; }
        element.value = legacyEditing ? normalizeNote(element.value) : clipNote(element.value, previous);
        const counter = overlay.querySelector(".notes-count"); if (counter) counter.textContent = textLength(element.value) + "/100";
      } else if (field === "date" && (element.value < INPUT_LIMITS.earliestDate || element.value > DEMO_TODAY)) {
        element.value = previous; return;
      }
      state.draft[element.dataset.draft] = element.value; state.draft.changed = true; markExplicit();
      if (["durationAmount", "quantity"].includes(element.dataset.draft)) {
        const kind = element.dataset.draft;
        state.draft.typedKinds[kind] = true;
        const slider = overlay.querySelector('[data-slider="' + kind + '"]');
        const range = sliderRange(kind, projectById(state.draft.projectId));
        if (slider && element.value !== "" && Number.isFinite(Number(element.value)) && Number(element.value) > 0) {
          slider.min = range.minimum; slider.max = range.maximum; slider.disabled = range.minimum === range.maximum;
          slider.value = element.value; slider.style.setProperty("--slider-fill", range.position(Number(element.value)) + "%");
        }
      }
      if (["durationAmount", "quantity"].includes(field)) {
        try {
          const project = projectById(state.draft.projectId), old = state.records.find(record => record.id === state.draft.recordId);
          const amount = field === "quantity" ? readPositive(element.value, old?.quantity) : readTime(element.value, project, old?.durationSeconds);
          if (amount != null) state.draft.acceptedValues[field] = element.value;
        } catch { /* Partial decimals do not replace the last complete value. */ }
      }
      updateSubmitButton();
    }
    if (element.dataset.editor && state.editor) {
      const field = element.dataset.editor;
      if (field === "name") {
        const value = oneLine(element.value), previous = state.editor.name;
        // Reject an insertion/paste as a whole instead of sacrificing the original suffix; old names may shrink gradually.
        element.value = textLength(value) <= INPUT_LIMITS.name || textLength(value) < textLength(previous) ? value : previous;
      }
      else if (field === "quantityUnit") {
        if (state.editor.quantityUnitLocked) { element.value = state.editor.quantityUnit; return; }
        const value = oneLine(element.value).replace(/\s/g, ""), previous = state.editor.quantityUnit;
        element.value = textLength(value) <= INPUT_LIMITS.unit || textLength(value) < textLength(previous) ? value : previous;
      } else if (["timeMin", "timeMax", "defaultTime", "quantityMin", "quantityMax", "defaultQuantity"].includes(field)) {
        const maximum = field.startsWith("quantity") || field === "defaultQuantity" ? INPUT_LIMITS.quantity : TIME_LIMITS[timeUnitFor(state.editor)];
        if (!acceptNumber(element.value, String(state.editor[field]), maximum) || (!field.endsWith("Min") && element.value !== "" && Number(element.value) === 0)) { element.value = state.editor[field]; return; }
      }
      state.editor[element.dataset.editor] = element.type === "checkbox" ? element.checked : element.value;
      if (["timeMin", "timeMax", "quantityMin", "quantityMax"].includes(element.dataset.editor)) updateEditorDefault(element.dataset.editor.startsWith("time") ? "time" : "quantity");
      if (element.closest(".range-values")) element.style.setProperty("--value-chars", String(Math.max(1, element.value.length)));
      if (element.dataset.editor === "name") document.getElementById("preview-name").textContent = element.value || "打卡名称";
      updateEditorSave();
    }
  });

  document.addEventListener("focusout", event => {
    if (state.draft && ["durationAmount", "quantity"].includes(event.target.dataset.draft)) {
      const kind = event.target.dataset.draft, project = projectById(state.draft.projectId);
      try {
        const original = state.records.find(record => record.id === state.draft.recordId);
        const value = kind === "quantity" ? readPositive(state.draft[kind], original?.quantity) : timeAmount(readTime(state.draft[kind], project, original?.durationSeconds), project);
        if (value == null) throw new Error("请填写本次" + (kind === "quantity" ? "数量" : "时间") + "。");
        state.draft[kind] = value; state.draft.preciseField = null;
        // Replace only the old readout so the pending click on Record/date/notes retains its original target.
        const readout = event.target.closest(".ruler-readout");
        if (readout) readout.outerHTML = fieldReadoutMarkup(kind, project, false);
      } catch {
        state.draft[kind] = state.draft.acceptedValues[kind]; state.draft.preciseField = null;
        const readout = event.target.closest(".ruler-readout");
        if (readout) readout.outerHTML = fieldReadoutMarkup(kind, project, false);
      }
      updateSubmitButton();
    }
    if (!state.editor || state.view !== "editor") return;
    if (event.target.dataset.editor === "defaultTime") normalizeEditorDefault("time");
    else if (event.target.dataset.editor === "defaultQuantity") normalizeEditorDefault("quantity");
    updateEditorSave();
  });

  document.addEventListener("compositionend", event => {
    // Apply limits to committed text, preserving the complete pinyin composition until the IME confirms it.
    event.target.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // Keep the plot host stable during scrubbing: replacing the page would drop pointer capture and scroll position.
  let chartGesture = null;
  function selectChartPoint(host, index) {
    const project = projectById(state.projectId), data = series(project);
    if (!data.selected.length && !data.baseline) return;
    const next = index == null ? null : Math.max(0, Math.min(data.values.findLastIndex(value => value != null), index));
    if (state.point === next) return;
    state.point = next;
    host.innerHTML = chartMarkup(data, project);
    // The readout stays outside the scrubbed plot, in its fixed footer, so selection cannot resize the card.
    const footer = screen.querySelector(".chart-footer-reading"), value = next == null ? null : data.values[next];
    if (footer) footer.textContent = value == null ? "" : data.dates[next] + " · " + (state.metric === "durationSeconds" ? timeText(value, project) : quantityText(value, project));
  }
  function chartIndexAt(host, clientX) {
    const data = series(projectById(state.projectId)), rect = host.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * 326;
    // Hit testing uses the expanded plot width, keeping readouts aligned with the visible marks.
    return state.graph === "cumulative" ? Math.round((x - 18) / 252 * (data.values.length - 1)) : Math.floor((x - 8) / 272 * data.values.length);
  }
  screen.addEventListener("pointerdown", event => {
    const host = event.target.closest(".chart-plot");
    if (!host || (event.pointerType === "mouse" && event.button !== 0)) return;
    chartGesture = { host, id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false, vertical: false };
    host.setPointerCapture(event.pointerId);
    if (event.pointerType === "mouse") selectChartPoint(host, chartIndexAt(host, event.clientX));
  });
  screen.addEventListener("pointermove", event => {
    if (!chartGesture || event.pointerId !== chartGesture.id) return;
    const dx = Math.abs(event.clientX - chartGesture.x), dy = Math.abs(event.clientY - chartGesture.y);
    // pan-y remains native; only a deliberate horizontal gesture enters chart inspection.
    if (!chartGesture.horizontal && !chartGesture.vertical && Math.max(dx, dy) > 6) {
      chartGesture.horizontal = dx > dy;
      chartGesture.vertical = !chartGesture.horizontal;
    }
    if (chartGesture.horizontal) selectChartPoint(chartGesture.host, chartIndexAt(chartGesture.host, event.clientX));
  });
  screen.addEventListener("pointerup", event => {
    if (!chartGesture || event.pointerId !== chartGesture.id) return;
    if (!chartGesture.vertical) selectChartPoint(chartGesture.host, chartIndexAt(chartGesture.host, event.clientX));
    chartGesture = null;
  });
  screen.addEventListener("pointercancel", () => { chartGesture = null; });
  screen.addEventListener("keydown", event => {
    if (!event.target.matches(".chart-plot") || !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    const last = series(projectById(state.projectId)).values.findLastIndex(value => value != null);
    const next = event.key === "Escape" ? null : event.key === "Home" ? 0 : event.key === "End" ? last : (state.point ?? (event.key === "ArrowRight" ? -1 : last + 1)) + (event.key === "ArrowRight" ? 1 : -1);
    selectChartPoint(event.target, next);
  });

  // Modal focus stays in the active sheet; Escape dismisses this session without saving or retaining input.
  document.addEventListener("keydown", event => {
    if (!overlay.firstElementChild) return;
    // The keyboard's confirmation exits inline editing; only the Record action persists the session.
    if (event.key === "Enter" && ["durationAmount", "quantity"].includes(event.target.dataset.draft)) { event.preventDefault(); event.target.blur(); return; }
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

  // Only the opted-in same-origin parent may request this fixed visual preview; it cannot write data or interrupt editing.
  window.addEventListener("message", event => {
    if (!homePreview || event.origin !== location.origin || event.source !== parent || event.data?.type !== "polaris:preview-basketball-success") return;
    if (state.view !== "home" || state.arranging || state.draft || state.confirm) return;
    const project = projectById("basketball");
    if (project) celebrateRecord(project);
  });

  resetFixtures();
  const params = new URLSearchParams(location.search);
  if (params.get("embed") === "1") document.body.classList.add("embedded");
  if (statisticsPreview) document.body.classList.add("statistics-preview");
  render();
  if (params.get("scene")) demoScene(params.get("scene"));
  // Review links reuse the real prototype state rather than maintaining separate, potentially drifting chart mockups.
  if (state.view === "detail") {
    if (["cumulative", "distribution", "calendar"].includes(params.get("graph"))) state.graph = params.get("graph");
    if (["week", "month", "year", "all"].includes(params.get("range"))) state.range = params.get("range");
    if (["durationSeconds", "quantity"].includes(params.get("metric"))) state.metric = params.get("metric");
    if (params.get("inspect") === "1") state.point = Math.max(0, series(projectById(state.projectId)).values.findLastIndex(value => value != null));
    render();
  }
})();
