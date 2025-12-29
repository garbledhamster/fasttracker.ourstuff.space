const STORAGE_KEY = "fastingTrackerStateV2";
const RING_CIRC = 2 * Math.PI * 80;

const FAST_TYPES = [
  { id: "16_8", label: "16:8", durationHours: 16, bullets: ["Classic daily schedule", "Supports insulin sensitivity", "Flexible eating window"] },
  { id: "18_6", label: "18:6", durationHours: 18, bullets: ["Longer fat-burning window", "Deeper metabolic switch", "Appetite regulation support"] },
  { id: "20_4", label: "20:4", durationHours: 20, bullets: ["Extended fasting period", "May enhance autophagy", "Requires nutrient-dense meals"] },
  { id: "24", label: "24h", durationHours: 24, bullets: ["OMAD style", "Simplifies planning", "Break fast mindfully"] },
  { id: "36", label: "36h", durationHours: 36, bullets: ["Occasional extended fast", "Hydration/electrolytes matter", "Break fast gently"] }
];

const defaultState = {
  settings: {
    defaultFastTypeId: "16_8",
    notifyOnEnd: true,
    hourlyReminders: true,
    alertsEnabled: false,
    timeDisplayMode: "elapsed"
  },
  activeFast: null,
  history: [],
  reminders: { endNotified: false, lastHourlyAt: null }
};

let state = loadState();
let selectedFastTypeId = state.settings.defaultFastTypeId || FAST_TYPES[0].id;
let calendarMonth = startOfMonth(new Date());
let selectedDayKey = formatDateKey(new Date());
let tickHandle = null;
let toastHandle = null;
let swReg = null;

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  startTick();
  registerServiceWorker();
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(defaultState);
    const parsed = JSON.parse(raw);
    const merged = clone(defaultState);
    merged.settings = Object.assign(merged.settings, parsed.settings || {});
    merged.activeFast = parsed.activeFast || null;
    merged.history = Array.isArray(parsed.history) ? parsed.history : [];
    merged.reminders = Object.assign(merged.reminders, parsed.reminders || {});
    return merged;
  } catch {
    return clone(defaultState);
  }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function $(id) { return document.getElementById(id); }

function initUI() {
  initTabs();
  initFastTypeChips();
  initButtons();
  initSettings();
  initCalendar();
  renderAll();
}

function initTabs() {
  document.querySelectorAll("nav .nav-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  switchTab("timer");
}

function switchTab(tab) {
  ["timer", "history", "settings"].forEach(id => {
    const section = $("tab-" + id);
    const btn = document.querySelector(`nav .nav-btn[data-tab="${id}"]`);
    const active = id === tab;
    section.classList.toggle("hidden", !active);
    btn.classList.toggle("nav-btn-active", active);
    btn.classList.toggle("text-slate-100", active);
    btn.classList.toggle("text-slate-500", !active);
  });
  if (tab === "history") {
    renderCalendar();
    renderDayDetails();
    renderRecentFasts();
  }
  if (tab === "settings") renderSettings();
}

function initFastTypeChips() {
  const container = $("fast-type-chips");
  container.innerHTML = "";
  FAST_TYPES.forEach(type => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.typeId = type.id;
    btn.className = "whitespace-nowrap px-3 py-1.5 rounded-full border text-xs border-slate-700 text-slate-100 bg-slate-900/80";
    btn.textContent = type.label;
    btn.addEventListener("click", () => {
      selectedFastTypeId = type.id;
      highlightSelectedFastType();
      openFastTypeModal(type);
      if (!state.activeFast) renderTimerMetaIdle();
      saveSelectedTypeToDefaults();
    });
    container.appendChild(btn);
  });
  highlightSelectedFastType();
}

function saveSelectedTypeToDefaults() {
  state.settings.defaultFastTypeId = selectedFastTypeId;
  saveState();
}

function highlightSelectedFastType() {
  const chips = document.querySelectorAll("#fast-type-chips button");
  chips.forEach(chip => {
    const isActive = chip.dataset.typeId === selectedFastTypeId;
    if (isActive) {
      chip.classList.add("bg-brand-500", "text-slate-950", "border-brand-500");
      chip.classList.remove("bg-slate-900/80", "text-slate-100", "border-slate-700");
    } else {
      chip.classList.remove("bg-brand-500", "text-slate-950", "border-brand-500");
      chip.classList.add("bg-slate-900/80", "text-slate-100", "border-slate-700");
    }
  });
  const type = getSelectedFastType();
  $("timer-type").textContent = type ? (type.label + " fast") : "No fast selected";
}

function openFastTypeModal(type) {
  $("modal-type-label").textContent = type.label + " fast";
  $("modal-type-duration").textContent = type.durationHours + " hours";
  const list = $("modal-bullets");
  list.innerHTML = "";
  type.bullets.forEach(t => {
    const li = document.createElement("li");
    li.textContent = t;
    list.appendChild(li);
  });
  $("fast-type-modal").classList.remove("hidden");
}

function closeFastTypeModal() { $("fast-type-modal").classList.add("hidden"); }

function getSelectedFastType() {
  return FAST_TYPES.find(t => t.id === selectedFastTypeId) || FAST_TYPES[0];
}

function initButtons() {
  $("start-fast-btn").addEventListener("click", startFast);
  $("end-fast-btn").addEventListener("click", () => finishFast(true));
  $("log-fast-btn").addEventListener("click", () => finishFast(false));
  $("alerts-btn").addEventListener("click", onAlertsButton);

  $("modal-close").addEventListener("click", closeFastTypeModal);
  $("modal-use-type").addEventListener("click", closeFastTypeModal);

  $("toggle-end-alert").addEventListener("click", () => {
    state.settings.notifyOnEnd = !state.settings.notifyOnEnd;
    saveState();
    renderSettings();
    renderAlertsPill();
  });

  $("toggle-hourly-alert").addEventListener("click", () => {
    state.settings.hourlyReminders = !state.settings.hourlyReminders;
    saveState();
    renderSettings();
  });

  $("export-data").addEventListener("click", exportData);
  $("clear-data").addEventListener("click", clearAllData);

  $("calendar-prev").addEventListener("click", () => { calendarMonth = addMonths(calendarMonth, -1); renderCalendar(); renderDayDetails(); });
  $("calendar-next").addEventListener("click", () => { calendarMonth = addMonths(calendarMonth, 1); renderCalendar(); renderDayDetails(); });

  $("default-fast-select").addEventListener("change", e => {
    selectedFastTypeId = e.target.value;
    state.settings.defaultFastTypeId = selectedFastTypeId;
    saveState();
    highlightSelectedFastType();
    if (!state.activeFast) renderTimerMetaIdle();
  });

  $("timer-main").addEventListener("click", cycleTimeMode);

  $("meta-start-btn").addEventListener("click", () => {
    if (!state.activeFast) return;
    openEditStartModal();
  });

  $("edit-start-close").addEventListener("click", closeEditStartModal);
  $("edit-start-now").addEventListener("click", () => {
    $("edit-start-input").value = toLocalInputValue(new Date());
  });
  $("edit-start-save").addEventListener("click", saveEditedStartTime);

  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderAll(); });
}

function initSettings() {
  const sel = $("default-fast-select");
  sel.innerHTML = "";
  FAST_TYPES.forEach(t => {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = `${t.label} (${t.durationHours}h)`;
    sel.appendChild(o);
  });
}

function renderSettings() {
  $("default-fast-select").value = state.settings.defaultFastTypeId || FAST_TYPES[0].id;
  $("toggle-end-alert").classList.toggle("on", !!state.settings.notifyOnEnd);
  $("toggle-hourly-alert").classList.toggle("on", !!state.settings.hourlyReminders);
  renderAlertsPill();
}

function startFast() {
  const type = getSelectedFastType();
  const now = Date.now();
  const durationMs = type.durationHours * 3600000;
  state.activeFast = {
    id: "fast_" + now,
    typeId: type.id,
    startTimestamp: now,
    endTimestamp: now + durationMs,
    plannedDurationHours: type.durationHours,
    status: "active"
  };
  state.reminders = { endNotified: false, lastHourlyAt: null };
  saveState();
  renderAll();
  showToast("Fast started");
}

function finishFast(early) {
  const af = state.activeFast;
  if (!af) return;
  const now = Date.now();
  const endTs = early ? now : af.endTimestamp;
  const durHrs = Math.max(0, (endTs - af.startTimestamp) / 3600000);
  state.history.unshift({
    id: af.id,
    typeId: af.typeId,
    startTimestamp: af.startTimestamp,
    endTimestamp: endTs,
    durationHours: Math.round(durHrs * 100) / 100
  });
  state.activeFast = null;
  state.reminders = { endNotified: false, lastHourlyAt: null };
  saveState();
  renderAll();
  calendarMonth = startOfMonth(new Date());
  selectedDayKey = formatDateKey(new Date());
  showToast("Fast logged");
}

function startTick() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    try {
      updateTimer();
      handleAlerts();
    } catch (e) {}
  }, 1000);
  updateTimer();
  renderAlertsPill();
}

function cycleTimeMode() {
  const order = ["elapsed", "total", "remaining"];
  const cur = state.settings.timeDisplayMode || "elapsed";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  state.settings.timeDisplayMode = next;
  saveState();
  updateTimer();
}

function updateTimer() {
  const ring = $("progress-ring");
  const main = $("timer-main");
  const mode = $("timer-mode");
  const sub = $("timer-sub");
  const header = $("header-subtitle");

  ring.setAttribute("stroke-dasharray", String(RING_CIRC));

  const displayMode = state.settings.timeDisplayMode || "elapsed";
  const type = getSelectedFastType();
  const typeLabel = type ? (type.label + " fast") : "No fast selected";
  $("timer-type").textContent = typeLabel;

  if (!state.activeFast) {
    header.textContent = "No active fast";
    ring.setAttribute("stroke-dashoffset", String(RING_CIRC));
    renderTimerMetaIdle();
    const plannedMs = (type?.durationHours || 0) * 3600000;
    const totalStr = formatHMS(plannedMs);

    if (displayMode === "elapsed") {
      mode.textContent = "Time Fasted";
      main.textContent = "00:00:00";
      sub.textContent = "Tap time to change view";
    } else if (displayMode === "total") {
      mode.textContent = "Total Fast";
      main.textContent = totalStr;
      sub.textContent = "Tap time to change view";
    } else {
      mode.textContent = "Time Remaining";
      main.textContent = totalStr;
      sub.textContent = "Tap time to change view";
    }
    $("start-fast-btn").classList.remove("hidden");
    $("end-fast-btn").classList.add("hidden");
    $("log-fast-btn").classList.add("hidden");
    $("meta-start-btn").disabled = true;
    return;
  }

  const af = state.activeFast;
  const now = Date.now();
  const start = af.startTimestamp;
  const end = af.endTimestamp;

  const total = Math.max(1, end - start);
  const elapsed = Math.max(0, now - start);
  const remaining = end - now;

  const progress = Math.min(elapsed / total, 1);
  ring.setAttribute("stroke-dashoffset", String(RING_CIRC * (1 - progress)));

  $("meta-start-btn").disabled = false;
  $("meta-start-btn").textContent = formatDateTime(new Date(start));
  $("meta-end").textContent = formatDateTime(new Date(end));
  $("meta-planned").textContent = (af.plannedDurationHours || Math.round(total / 3600000)) + " h";

  if (now < end) {
    header.textContent = "Ends " + formatTimeShort(new Date(end));
    $("start-fast-btn").classList.add("hidden");
    $("end-fast-btn").classList.remove("hidden");
    $("log-fast-btn").classList.add("hidden");
  } else {
    header.textContent = "Fast complete";
    $("start-fast-btn").classList.add("hidden");
    $("end-fast-btn").classList.add("hidden");
    $("log-fast-btn").classList.remove("hidden");
  }

  if (displayMode === "elapsed") {
    mode.textContent = "Time Fasted";
    main.textContent = formatHMS(elapsed);
    sub.textContent = "Tap time to change view";
  } else if (displayMode === "total") {
    mode.textContent = "Total Fast";
    main.textContent = formatHMS(total);
    sub.textContent = "Tap time to change view";
  } else {
    if (remaining >= 0) {
      mode.textContent = "Time Remaining";
      main.textContent = formatHMS(remaining);
      sub.textContent = "Tap time to change view";
    } else {
      mode.textContent = "Extra Time Fasted";
      main.textContent = formatHMS(-remaining);
      sub.textContent = "Tap time to change view";
    }
  }
}

function renderTimerMetaIdle() {
  const type = getSelectedFastType();
  $("meta-start-btn").textContent = "—";
  $("meta-end").textContent = "—";
  $("meta-planned").textContent = (type?.durationHours || 0) + " h";
}

async function onAlertsButton() {
  if (!("Notification" in window)) {
    showToast("Notifications not supported here");
    return;
  }

  if (Notification.permission === "denied") {
    showToast("Alerts blocked in browser settings");
    return;
  }

  if (Notification.permission === "default") {
    const res = await Notification.requestPermission();
    if (res !== "granted") {
      showToast("Permission not granted");
      renderAlertsPill();
      return;
    }
    state.settings.alertsEnabled = true;
    saveState();
    renderAlertsPill();
    await sendNotification("Alerts enabled", "You’ll be notified when your fast ends.");
    showToast("Alerts enabled");
    return;
  }

  state.settings.alertsEnabled = !state.settings.alertsEnabled;
  saveState();
  renderAlertsPill();
  if (state.settings.alertsEnabled) {
    await sendNotification("Alerts enabled", "You’ll be notified when your fast ends.");
    showToast("Alerts enabled");
  } else {
    showToast("Alerts disabled");
  }
}

function renderAlertsPill() {
  const dot = $("alerts-dot");
  const label = $("alerts-label");

  if (!("Notification" in window)) {
    dot.className = "w-1.5 h-1.5 rounded-full bg-slate-600";
    label.textContent = "Unavailable";
    return;
  }

  if (Notification.permission === "denied") {
    dot.className = "w-1.5 h-1.5 rounded-full bg-red-500";
    label.textContent = "Blocked";
    return;
  }

  if (Notification.permission === "default") {
    dot.className = "w-1.5 h-1.5 rounded-full bg-slate-600";
    label.textContent = "Enable alerts";
    return;
  }

  if (state.settings.alertsEnabled) {
    dot.className = "w-1.5 h-1.5 rounded-full bg-emerald-400";
    label.textContent = "Alerts on";
  } else {
    dot.className = "w-1.5 h-1.5 rounded-full bg-slate-600";
    label.textContent = "Alerts off";
  }
}

async function sendNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    if (swReg && swReg.showNotification) {
      await swReg.showNotification(title, {
        body,
        icon: "assets/favicon/android-chrome-192x192.png",
        badge: "assets/favicon/android-chrome-192x192.png",
        tag: "fasting-tracker",
        renotify: false
      });
      return;
    }
  } catch {}

  try {
    new Notification(title, { body });
  } catch {}
}

function handleAlerts() {
  if (!state.activeFast) return;
  if (!state.settings.alertsEnabled) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const now = Date.now();
  const af = state.activeFast;
  const endTs = af.endTimestamp;

  if (!state.reminders.endNotified && now >= endTs) {
    if (state.settings.notifyOnEnd) {
      sendNotification("Fast complete", "You reached your fasting goal.");
    }
    state.reminders.endNotified = true;
    state.reminders.lastHourlyAt = now;
    saveState();
    return;
  }

  if (state.reminders.endNotified && state.settings.hourlyReminders) {
    const last = state.reminders.lastHourlyAt || endTs;
    if (now - last >= 3600000) {
      sendNotification("Extra hour fasted", "You’re past your target. Break your fast when ready.");
      state.reminders.lastHourlyAt = now;
      saveState();
    }
  }
}

function openEditStartModal() {
  if (!state.activeFast) return;
  const start = new Date(state.activeFast.startTimestamp);
  $("edit-start-input").value = toLocalInputValue(start);
  $("edit-start-modal").classList.remove("hidden");
}

function closeEditStartModal() {
  $("edit-start-modal").classList.add("hidden");
}

function saveEditedStartTime() {
  if (!state.activeFast) return;
  const v = $("edit-start-input").value;
  if (!v) { showToast("Invalid time"); return; }
  const d = new Date(v);
  if (!isFinite(d.getTime())) { showToast("Invalid time"); return; }

  const af = state.activeFast;
  const planned = (af.plannedDurationHours || getSelectedFastType().durationHours || 0) * 3600000;
  af.startTimestamp = d.getTime();
  af.endTimestamp = af.startTimestamp + planned;
  af.status = "active";
  state.reminders = { endNotified: false, lastHourlyAt: null };
  saveState();
  closeEditStartModal();
  updateTimer();
  showToast("Start time updated");
}

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => t.classList.add("hidden"), 2200);
}

function exportData() {
  const payload = JSON.stringify({ history: state.history, settings: state.settings }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fasting-tracker-data.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Exported");
}

function clearAllData() {
  if (!confirm("Clear all fasting history and active fast?")) return;
  state = clone(defaultState);
  selectedFastTypeId = state.settings.defaultFastTypeId;
  saveState();
  renderAll();
  showToast("Cleared");
}

function initCalendar() {
  calendarMonth = startOfMonth(new Date());
  selectedDayKey = formatDateKey(new Date());
}

function renderCalendar() {
  const label = $("calendar-label");
  const grid = $("calendar-grid");
  label.textContent = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  grid.innerHTML = "";

  const first = startOfMonth(calendarMonth);
  const startWeekday = first.getDay();
  const daysInMonth = getDaysInMonth(calendarMonth);
  const prevMonth = addMonths(calendarMonth, -1);
  const daysInPrev = getDaysInMonth(prevMonth);

  const dayMap = buildDayFastMap();
  const todayKey = formatDateKey(new Date());

  for (let i = 0; i < 42; i++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "aspect-square rounded-xl flex flex-col items-center justify-center text-[11px]";

    let dayNum, date, isCurrent = false;

    if (i < startWeekday) {
      dayNum = daysInPrev - startWeekday + i + 1;
      date = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), dayNum);
      cell.classList.add("text-slate-600");
    } else if (i >= startWeekday + daysInMonth) {
      dayNum = i - startWeekday - daysInMonth + 1;
      const nextMonth = addMonths(calendarMonth, 1);
      date = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), dayNum);
      cell.classList.add("text-slate-600");
    } else {
      dayNum = i - startWeekday + 1;
      date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), dayNum);
      isCurrent = true;
      cell.classList.add("text-slate-200");
    }

    const key = formatDateKey(date);
    const data = dayMap[key];
    const hasFast = !!data;
    const isSelected = key === selectedDayKey;
    const isToday = key === todayKey;

    if (isSelected) cell.classList.add("bg-brand-500/20", "border", "border-brand-500");
    else if (hasFast) cell.classList.add("bg-slate-800");
    else cell.classList.add("bg-slate-900");

    if (isToday && isCurrent) {
      const dot = document.createElement("span");
      dot.className = "w-1.5 h-1.5 rounded-full bg-brand-500 mb-0.5";
      cell.appendChild(dot);
    }

    const dspan = document.createElement("span");
    dspan.textContent = dayNum;
    cell.appendChild(dspan);

    if (hasFast) {
      const tiny = document.createElement("span");
      tiny.className = "mt-0.5 text-[9px] text-cyan-100";
      tiny.textContent = Math.round(data.totalHours) + "h";
      cell.appendChild(tiny);
    }

    cell.addEventListener("click", () => {
      selectedDayKey = key;
      renderCalendar();
      renderDayDetails();
    });

    grid.appendChild(cell);
  }
}

function buildDayFastMap() {
  const map = {};
  state.history.forEach(e => {
    const key = formatDateKey(new Date(e.startTimestamp));
    if (!map[key]) map[key] = { entries: [], totalHours: 0 };
    map[key].entries.push(e);
    map[key].totalHours += e.durationHours || 0;
  });
  return map;
}

function renderDayDetails() {
  const summary = $("day-summary");
  const list = $("day-fast-list");
  const map = buildDayFastMap();
  const day = map[selectedDayKey];

  list.innerHTML = "";

  if (!day) {
    summary.textContent = "No fasts logged";
    return;
  }

  const total = day.totalHours;
  summary.textContent = `${day.entries.length} fast(s), ${total.toFixed(1)} total hours`;

  day.entries.forEach(e => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between bg-slate-900 rounded-xl px-3 py-2";

    const left = document.createElement("div");
    left.className = "flex flex-col text-[11px]";

    const type = FAST_TYPES.find(t => t.id === e.typeId);
    const title = document.createElement("div");
    title.className = "text-slate-100";
    title.textContent = `${type ? type.label : "Custom"} • ${e.durationHours.toFixed(1)}h`;

    const time = document.createElement("div");
    time.className = "text-slate-400";
    time.textContent = `${formatTimeShort(new Date(e.startTimestamp))} → ${formatTimeShort(new Date(e.endTimestamp))}`;

    left.appendChild(title);
    left.appendChild(time);

    row.appendChild(left);
    list.appendChild(row);
  });
}

function renderRecentFasts() {
  const container = $("recent-fast-list");
  container.innerHTML = "";
  if (!state.history.length) {
    const p = document.createElement("p");
    p.className = "text-slate-400";
    p.textContent = "No fasts logged yet.";
    container.appendChild(p);
    return;
  }

  state.history.slice(0, 10).forEach(e => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between bg-slate-900 rounded-xl px-3 py-2";

    const left = document.createElement("div");
    left.className = "flex flex-col text-[11px]";

    const type = FAST_TYPES.find(t => t.id === e.typeId);
    const title = document.createElement("div");
    title.className = "text-slate-100";
    title.textContent = `${type ? type.label : "Custom"} • ${e.durationHours.toFixed(1)}h`;

    const start = new Date(e.startTimestamp);
    const time = document.createElement("div");
    time.className = "text-slate-400";
    time.textContent = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} • ${formatTimeShort(start)}`;

    left.appendChild(title);
    left.appendChild(time);

    row.appendChild(left);
    container.appendChild(row);
  });
}

function renderAll() {
  highlightSelectedFastType();
  renderSettings();
  updateTimer();
  renderCalendar();
  renderDayDetails();
  renderRecentFasts();
}

function toLocalInputValue(d) {
  const pad = n => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function formatHMS(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

function formatDateTime(d) {
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTimeShort(d) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function getDaysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function addMonths(d, amount) { return new Date(d.getFullYear(), d.getMonth() + amount, 1); }

function formatDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register("./sw.js");
  } catch {}
}
