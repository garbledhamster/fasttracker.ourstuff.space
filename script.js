import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-analytics.js";
import { load as loadYaml } from "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  reload,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const ENCRYPTED_CACHE_KEY = "fastingTrackerEncryptedStateV1";
const WRAPPED_KEY_STORAGE_KEY = "fastingTrackerWrappedKeyV1";
const DEVICE_KEY_DB = "fastingTrackerCryptoKeys";
const DEVICE_KEY_STORE = "keys";
const DEVICE_KEY_ID = "device-wrap-key";
const RING_CIRC = 2 * Math.PI * 80;
const ENCRYPTION_VERSION = 1;
const PBKDF2_ITERATIONS = 310000;
const NOTES_SCHEMA = Object.freeze({
  text: "",
  createdAt: 0,
  updatedAt: 0,
  dateKey: "YYYY-MM-DD",
  fastContext: {
    wasActive: false,
    fastId: null,
    fastTypeId: null,
    fastTypeLabel: null,
    startTimestamp: null,
    plannedDurationHours: null
  }
});

let FAST_TYPES = [];

const THEME_PRESETS = {
  midnight: {
    label: "Midnight",
    colors: {
      primaryColor: "#06b6d4",
      secondaryColor: "#0891b2",
      backgroundColor: "#020617",
      surfaceColor: "#0f172a",
      surfaceMutedColor: "#1e293b",
      borderColor: "#1e293b",
      textColor: "#f8fafc",
      textMutedColor: "#94a3b8",
      dangerColor: "#dc2626"
    }
  },
  ocean: {
    label: "Ocean",
    colors: {
      primaryColor: "#38bdf8",
      secondaryColor: "#0ea5e9",
      backgroundColor: "#071a2b",
      surfaceColor: "#0b2942",
      surfaceMutedColor: "#123a5a",
      borderColor: "#1e3a5f",
      textColor: "#e0f2fe",
      textMutedColor: "#94a3b8",
      dangerColor: "#f97316"
    }
  },
  sunrise: {
    label: "Sunrise",
    colors: {
      primaryColor: "#fb7185",
      secondaryColor: "#f97316",
      backgroundColor: "#1f0f1a",
      surfaceColor: "#2a1523",
      surfaceMutedColor: "#3b1c2e",
      borderColor: "#4b2237",
      textColor: "#fff1f2",
      textMutedColor: "#fda4af",
      dangerColor: "#f87171"
    }
  }
};

const defaultState = {
  settings: {
    defaultFastTypeId: "16_8",
    notifyOnEnd: true,
    hourlyReminders: true,
    alertsEnabled: false,
    timeDisplayMode: "elapsed",
    theme: {
      presetId: "midnight",
      customColors: { ...THEME_PRESETS.midnight.colors }
    }
  },
  activeFast: null,
  history: [],
  reminders: { endNotified: false, lastHourlyAt: null },
  milestoneTally: {}
};

const firebaseConfig = window.FIREBASE_CONFIG;
if (!firebaseConfig?.apiKey || !firebaseConfig?.authDomain || !firebaseConfig?.projectId || !firebaseConfig?.appId) {
  throw new Error("Missing Firebase configuration. Check firebase-config.js.");
}

const firebaseApp = initializeApp(firebaseConfig);
const analytics = firebaseConfig?.measurementId ? getAnalytics(firebaseApp) : null;
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let state = clone(defaultState);
let selectedFastTypeId = defaultState.settings.defaultFastTypeId;
let pendingTypeId = null;
let calendarMonth = startOfMonth(new Date());
let selectedDayKey = formatDateKey(new Date());
let tickHandle = null;
let toastHandle = null;
let swReg = null;
let appInitialized = false;
let authMode = "sign-in";
let cryptoKey = null;
let keySalt = null;
let pendingPassword = null;
let needsUnlock = false;
let authRememberChoice = null;
let stateUnsubscribe = null;
let notesUnsubscribe = null;
let notesDrawerCloseTimeout = null;
let notesLoaded = false;
let notes = [];
let noteEditorCloseTimeout = null;
let editingNoteId = null;
let editingNoteDateKey = null;
let editingNoteContext = null;
let editingNoteCreatedAt = null;
let editingNoteOpenedAt = null;
let editingNoteInitialText = "";

let navHoldTimer = null;
let navHoldShown = false;
let suppressNavClickEl = null;

// ✅ NEW: Notes overlay state (opens above other tabs)
let currentTab = "timer";
let lastNonNotesTab = "timer";
let ringEmojiTypeId = null;
let ringEmojiSelectionKey = null;
let ringEmojiSelectionDetail = null;
let ringEmojiLayoutSize = 0;
let notesOverlayOpen = false;
let notesPortal = null;
let notesBackdrop = null;
let bodyOverflowBeforeNotes = null;
let notesSwipeHandlersAttached = false;
let noteEditorSwipeHandlersAttached = false;
let pendingConfirmAction = null;
let pendingConfirmCloseFocus = null;

document.addEventListener("DOMContentLoaded", () => {
  void initApp();
});

function $(id) { return document.getElementById(id); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

async function initApp() {
  try {
    FAST_TYPES = await loadFastTypes();
  } catch (err) {
    console.error("Failed to load fast types:", err);
    FAST_TYPES = [];
  }

  if (!Array.isArray(FAST_TYPES) || FAST_TYPES.length === 0) {
    FAST_TYPES = [
      {
        id: defaultState.settings.defaultFastTypeId,
        label: "16:8",
        durationHours: 16,
        bullets: [],
        milestones: []
      }
    ];
  }

  selectedFastTypeId = resolveFastTypeId(selectedFastTypeId);
  initAuthUI();
  initAuthListener();
}

async function loadFastTypes() {
  const response = await fetch("./fast-types.yaml", { cache: "no-store" });
  if (!response.ok) throw new Error(`fast-types.yaml request failed (${response.status})`);
  const text = await response.text();
  const data = loadYaml(text);
  if (!Array.isArray(data)) throw new Error("fast-types.yaml is not a list");
  return data;
}

function resolveFastTypeId(typeId) {
  if (!Array.isArray(FAST_TYPES) || FAST_TYPES.length === 0) {
    return defaultState.settings.defaultFastTypeId;
  }
  const found = FAST_TYPES.find(type => type.id === typeId);
  return found ? found.id : FAST_TYPES[0].id;
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function getStateDocRef(uid) {
  return doc(db, "users", uid, "fastingState", "state");
}

function getUserDocRef(uid) {
  return doc(db, "users", uid);
}

function getNotesCollectionRef(uid) {
  return collection(db, "users", uid, "notes");
}

function getNoteDocRef(uid, noteId) {
  return doc(db, "users", uid, "notes", noteId);
}

function stopNotesListener() {
  if (notesUnsubscribe) {
    notesUnsubscribe();
    notesUnsubscribe = null;
  }
}

async function normalizeNoteSnapshot(snap) {
  const data = snap.data() || {};
  let text = "";
  if (data?.payload?.iv && data?.payload?.ciphertext) {
    try {
      text = await decryptNotePayload(data.payload);
    } catch (err) {
      if (err?.message === "missing-key") throw err;
      throw new Error("decrypt-failed");
    }
  } else if (typeof data.text === "string") {
    text = data.text;
  }
  const normalizedCreatedAt = typeof data.createdAt === "number" ? data.createdAt : 0;
  return {
    id: snap.id,
    text,
    createdAt: normalizedCreatedAt,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    dateKey: typeof data.dateKey === "string" ? data.dateKey : "",
    fastContext: normalizeFastContext(data.fastContext, normalizedCreatedAt)
  };
}

function normalizeFastContext(fastContext, createdAt) {
  if (!fastContext || typeof fastContext !== "object") return buildInactiveFastContext();

  const legacyTypeId = typeof fastContext.typeId === "string" ? fastContext.typeId : null;
  const legacyTypeLabel = typeof fastContext.typeLabel === "string" ? fastContext.typeLabel : null;
  const legacyDuration = typeof fastContext.durationHours === "number" ? fastContext.durationHours : null;
  const wasActive = typeof fastContext.wasActive === "boolean"
    ? fastContext.wasActive
    : Boolean(fastContext.fastId || legacyTypeId || legacyTypeLabel);
  const normalizedCreatedAt = typeof createdAt === "number" ? createdAt : null;
  const startTimestamp = fastContext.startTimestamp ?? null;
  const elapsedMsAtNote = typeof fastContext.elapsedMsAtNote === "number"
    ? fastContext.elapsedMsAtNote
    : (typeof startTimestamp === "number" && typeof normalizedCreatedAt === "number"
      ? Math.max(0, normalizedCreatedAt - startTimestamp)
      : null);

  return {
    wasActive,
    fastId: fastContext.fastId ?? null,
    fastTypeId: fastContext.fastTypeId ?? legacyTypeId,
    fastTypeLabel: fastContext.fastTypeLabel ?? legacyTypeLabel,
    startTimestamp,
    plannedDurationHours: fastContext.plannedDurationHours ?? legacyDuration,
    elapsedMsAtNote
  };
}

function buildInactiveFastContext() {
  return {
    wasActive: false,
    fastId: null,
    fastTypeId: null,
    fastTypeLabel: null,
    startTimestamp: null,
    plannedDurationHours: null,
    elapsedMsAtNote: null
  };
}

function buildFastContextAt(timestampMs) {
  if (!state.activeFast) return buildInactiveFastContext();
  const type = getTypeById(state.activeFast.typeId);
  const elapsedMsAtNote = typeof state.activeFast.startTimestamp === "number"
    ? Math.max(0, (timestampMs ?? Date.now()) - state.activeFast.startTimestamp)
    : null;
  return {
    wasActive: true,
    fastId: state.activeFast.id,
    fastTypeId: state.activeFast.typeId,
    fastTypeLabel: type?.label || null,
    startTimestamp: state.activeFast.startTimestamp,
    plannedDurationHours: state.activeFast.plannedDurationHours,
    elapsedMsAtNote
  };
}

function buildFastContext() {
  return buildFastContextAt(Date.now());
}

async function buildNotePayload({ text, dateKey, fastContext } = {}) {
  const createdAt = Date.now();
  const payload = await encryptNotePayload((text || "").trim());
  return {
    payload,
    createdAt,
    updatedAt: createdAt,
    dateKey: formatDateKey(new Date(createdAt)),
    fastContext: fastContext ?? buildFastContextAt(createdAt)
  };
}

async function buildNoteUpdatePayload({ text, dateKey, fastContext, createdAt } = {}) {
  const payload = { updatedAt: Date.now() };
  if (typeof text === "string") payload.payload = await encryptNotePayload(text.trim());
  if (typeof dateKey === "string") payload.dateKey = dateKey;
  if (fastContext !== undefined) {
    if (fastContext === null || typeof fastContext !== "object") {
      payload.fastContext = fastContext;
    } else {
      const fields = [
        ["wasActive", fastContext.wasActive],
        ["fastId", fastContext.fastId],
        ["fastTypeId", fastContext.fastTypeId],
        ["fastTypeLabel", fastContext.fastTypeLabel],
        ["startTimestamp", fastContext.startTimestamp],
        ["plannedDurationHours", fastContext.plannedDurationHours]
      ];
      fields.forEach(([key, value]) => {
        if (value !== undefined) payload[`fastContext.${key}`] = value;
      });
      if (Object.prototype.hasOwnProperty.call(fastContext, "elapsedMsAtNote")) {
        payload["fastContext.elapsedMsAtNote"] = fastContext.elapsedMsAtNote ?? null;
      }
    }
  }
  if (typeof createdAt === "number") payload.createdAt = createdAt;
  return payload;
}

async function createNote({ text, dateKey, fastContext } = {}) {
  const user = auth.currentUser;
  if (!user) return null;
  const payload = await buildNotePayload({ text, dateKey, fastContext });
  try {
    const docRef = await addDoc(getNotesCollectionRef(user.uid), payload);
    return docRef.id;
  } catch {
    return null;
  }
}

async function updateNote(noteId, { text, dateKey, fastContext, createdAt } = {}) {
  const user = auth.currentUser;
  if (!user || !noteId) return;
  const payload = await buildNoteUpdatePayload({ text, dateKey, fastContext, createdAt });
  try {
    await setDoc(getNoteDocRef(user.uid, noteId), payload, { merge: true });
  } catch {}
}

async function deleteNote(noteId) {
  const user = auth.currentUser;
  if (!user || !noteId) return;
  try {
    await deleteDoc(getNoteDocRef(user.uid, noteId));
  } catch {}
}

function openNoteEditor(note = null) {
  const modal = $("note-editor-modal");
  if (!modal) return;
  if (noteEditorCloseTimeout) {
    clearTimeout(noteEditorCloseTimeout);
    noteEditorCloseTimeout = null;
  }
  editingNoteId = note?.id || null;
  editingNoteDateKey = note?.dateKey || formatDateKey(new Date());
  editingNoteContext = note?.fastContext ?? buildFastContext();
  editingNoteCreatedAt = note?.createdAt ?? null;
  editingNoteOpenedAt = Date.now();

  $("note-editor-content").value = note?.text || "";
  editingNoteInitialText = $("note-editor-content").value.trim();
  updateNoteEditorMeta();
  $("note-editor-delete").classList.toggle("hidden", !editingNoteId);
  modal.classList.remove("hidden");
  requestAnimationFrame(() => modal.classList.add("is-open"));
}

function isTouchDevice() {
  return navigator.maxTouchPoints > 0 || "ontouchstart" in window;
}

async function handleNoteEditorSwipeDismiss() {
  const modal = $("note-editor-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  const text = $("note-editor-content").value.trim();
  const hasChanges = text !== editingNoteInitialText;
  if (hasChanges && text) {
    const saved = await persistNoteEditor({ closeOnSave: false });
    if (!saved) return;
  }
  closeNoteEditor();
}

function attachNoteEditorSwipeHandlers() {
  if (noteEditorSwipeHandlersAttached || !isTouchDevice()) return;
  const panel = document.querySelector("#note-editor-modal .note-editor-panel");
  if (!panel) return;
  noteEditorSwipeHandlersAttached = true;

  let swipeStartX = 0;
  let swipeStartY = 0;

  panel.addEventListener("touchstart", (event) => {
    if (!event.touches || event.touches.length !== 1) return;
    const touch = event.touches[0];
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
  }, { passive: true });

  panel.addEventListener("touchend", async (event) => {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - swipeStartX;
    const deltaY = touch.clientY - swipeStartY;
    swipeStartX = 0;
    swipeStartY = 0;

    if (deltaX > 80 && Math.abs(deltaX) > Math.abs(deltaY)) {
      await handleNoteEditorSwipeDismiss();
    }
  }, { passive: true });
}

function updateNoteEditorMeta() {
  const badge = $("note-editor-fast");
  const dateEl = $("note-editor-date");
  if (!badge || !dateEl) return;

  const dateObj = parseDateKey(editingNoteDateKey);
  const dateLabel = dateObj
    ? dateObj.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Unknown date";
  const createdLabel = editingNoteCreatedAt
    ? `Created ${formatTimeShort(new Date(editingNoteCreatedAt))}`
    : null;
  const openedLabel = editingNoteOpenedAt
    ? `Opened ${formatTimeShort(new Date(editingNoteOpenedAt))}`
    : null;
  const timeLabel = [createdLabel, openedLabel].filter(Boolean).join(" • ");
  dateEl.textContent = timeLabel ? `${dateLabel} • ${timeLabel}` : dateLabel;

  const isActive = Boolean(editingNoteContext?.wasActive);
  const elapsedMsAtNote = editingNoteContext?.elapsedMsAtNote;
  const hasElapsed = isActive && typeof elapsedMsAtNote === "number";
  if (isActive) {
    const typeLabel = editingNoteContext?.fastTypeLabel || "fast";
    const elapsedLabel = hasElapsed ? ` • ${formatElapsedShort(elapsedMsAtNote)} in` : "";
    badge.textContent = `Active ${typeLabel}${elapsedLabel}`;
    badge.classList.remove("is-muted");
  } else {
    badge.textContent = "No active fast";
    badge.classList.add("is-muted");
  }
}

function closeNoteEditor() {
  const modal = $("note-editor-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  if (noteEditorCloseTimeout) clearTimeout(noteEditorCloseTimeout);
  noteEditorCloseTimeout = setTimeout(() => {
    modal.classList.add("hidden");
  }, 250);
  $("note-editor-content").value = "";
  editingNoteId = null;
  editingNoteDateKey = null;
  editingNoteContext = null;
  editingNoteCreatedAt = null;
  editingNoteOpenedAt = null;
  editingNoteInitialText = "";
}

async function persistNoteEditor({ closeOnSave = true } = {}) {
  const text = $("note-editor-content").value.trim();
  if (!text) {
    showToast("Add a note before saving");
    return false;
  }
  try {
    if (editingNoteId) {
      await updateNote(editingNoteId, {
        text,
        dateKey: editingNoteDateKey,
        fastContext: editingNoteContext,
        createdAt: editingNoteCreatedAt
      });
    } else {
      await createNote({ text, dateKey: editingNoteDateKey, fastContext: editingNoteContext });
    }
  } catch (err) {
    if (err?.message === "missing-key") {
      handleNotesDecryptError(err);
      return false;
    }
  }
  renderNotes();
  if (closeOnSave) closeNoteEditor();
  return true;
}

async function saveNoteEditor() {
  await persistNoteEditor();
}

async function removeNote() {
  if (!editingNoteId) return;
  await deleteNote(editingNoteId);
  renderNotes();
  closeNoteEditor();
}

function startNotesListener(uid) {
  stopNotesListener();
  notesLoaded = false;
  notes = [];
  renderNotes();

  notesUnsubscribe = onSnapshot(
    getNotesCollectionRef(uid),
    async (snap) => {
      try {
        const normalized = await Promise.all(snap.docs.map(normalizeNoteSnapshot));
        notesLoaded = true;
        notes = normalized.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        renderNotes();
      } catch (err) {
        handleNotesDecryptError(err);
      }
    },
    (err) => {
      console.error("Notes listener failed:", err);
      notesLoaded = true;
      notes = [];
      renderNotes();

      const code = err?.code || "";
      if (code === "permission-denied") showToast("Notes blocked by Firestore rules / App Check.");
      else if (code === "failed-precondition") showToast("Notes failed-precondition (index/AppCheck/offline).");
      else showToast(`Notes failed to load (${code || "unknown error"})`);
    }
  );
}

function stopStateListener() {
  if (stateUnsubscribe) {
    stateUnsubscribe();
    stateUnsubscribe = null;
  }
}

function startStateListener(uid) {
  stopStateListener();
  stateUnsubscribe = onSnapshot(getStateDocRef(uid), async snap => {
    const payload = snap.data()?.payload;
    if (!payload || !payload.iv || !payload.ciphertext) {
      state = clone(defaultState);
      selectedFastTypeId = resolveFastTypeId(state.settings.defaultFastTypeId);
      pendingTypeId = null;
      renderAll();
      return;
    }
    if (!cryptoKey) return;
    try {
      const decrypted = await decryptStatePayload(payload);
      state = mergeStateWithDefaults(decrypted);
      renderAll();
    } catch {}
  });
}

function getEncryptedCache() {
  try {
    const raw = localStorage.getItem(ENCRYPTED_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setEncryptedCache(payload) {
  try {
    localStorage.setItem(ENCRYPTED_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

function getWrappedKeyStorage(uid) {
  try {
    const raw = localStorage.getItem(`${WRAPPED_KEY_STORAGE_KEY}:${uid}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setWrappedKeyStorage(uid, payload) {
  try {
    localStorage.setItem(`${WRAPPED_KEY_STORAGE_KEY}:${uid}`, JSON.stringify(payload));
  } catch {}
}

function clearWrappedKeyStorage(uid) {
  try {
    localStorage.removeItem(`${WRAPPED_KEY_STORAGE_KEY}:${uid}`);
  } catch {}
}

function openDeviceKeyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEVICE_KEY_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DEVICE_KEY_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadDeviceWrappingKey() {
  try {
    const db = await openDeviceKeyDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DEVICE_KEY_STORE, "readonly");
      const store = tx.objectStore(DEVICE_KEY_STORE);
      const req = store.get(DEVICE_KEY_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function saveDeviceWrappingKey(key) {
  try {
    const db = await openDeviceKeyDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DEVICE_KEY_STORE, "readwrite");
      const store = tx.objectStore(DEVICE_KEY_STORE);
      const req = store.put(key, DEVICE_KEY_ID);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
}

async function getOrCreateDeviceWrappingKey() {
  const existing = await loadDeviceWrappingKey();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
  await saveDeviceWrappingKey(key);
  return key;
}

async function wrapEncryptionKeyForDevice(uid) {
  if (!cryptoKey) return;
  const wrappingKey = await getOrCreateDeviceWrappingKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey(
    "raw",
    cryptoKey,
    wrappingKey,
    { name: "AES-GCM", iv }
  );
  setWrappedKeyStorage(uid, {
    version: ENCRYPTION_VERSION,
    iv: encodeBase64(iv),
    wrappedKey: encodeBase64(new Uint8Array(wrapped))
  });
}

async function unwrapEncryptionKeyFromDevice(uid) {
  const cached = getWrappedKeyStorage(uid);
  if (!cached?.iv || !cached?.wrappedKey) return null;
  const wrappingKey = await loadDeviceWrappingKey();
  if (!wrappingKey) return null;
  try {
    const iv = decodeBase64(cached.iv);
    const wrappedBytes = decodeBase64(cached.wrappedKey);
    return await crypto.subtle.unwrapKey(
      "raw",
      wrappedBytes,
      wrappingKey,
      { name: "AES-GCM", iv },
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  } catch {
    return null;
  }
}

function mergeStateWithDefaults(parsed) {
  const merged = clone(defaultState);
  const parsedSettings = parsed.settings || {};
  const parsedTheme = parsedSettings.theme || {};
  if (parsedTheme.accentColor && !parsedTheme.primaryColor) {
    parsedTheme.primaryColor = parsedTheme.accentColor;
  }
  if (parsedTheme.accentColorStrong && !parsedTheme.secondaryColor) {
    parsedTheme.secondaryColor = parsedTheme.accentColorStrong;
  }
  merged.settings = Object.assign(merged.settings, parsedSettings);
  merged.settings.theme = Object.assign({}, defaultState.settings.theme, parsedTheme);
  merged.activeFast = parsed.activeFast || null;
  merged.history = Array.isArray(parsed.history) ? parsed.history : [];
  merged.reminders = Object.assign(merged.reminders, parsed.reminders || {});
  merged.milestoneTally = parsed?.milestoneTally && typeof parsed.milestoneTally === "object"
    ? parsed.milestoneTally
    : {};
  if (merged.activeFast && !Array.isArray(merged.activeFast.milestonesHit)) {
    merged.activeFast.milestonesHit = [];
  }
  return merged;
}

async function deriveKeyFromPassword(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function encryptStatePayload() {
  if (!cryptoKey) throw new Error("missing-key");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedState = new TextEncoder().encode(JSON.stringify(state));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encodedState
  );
  return {
    version: ENCRYPTION_VERSION,
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(cipherBuffer))
  };
}

async function decryptStatePayload(payload) {
  if (!cryptoKey) throw new Error("missing-key");
  const iv = decodeBase64(payload.iv);
  const ciphertext = decodeBase64(payload.ciphertext);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );
  const decoded = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decoded);
}

async function encryptNotePayload(text) {
  if (!cryptoKey) throw new Error("missing-key");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(text);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encodedText
  );
  return {
    version: ENCRYPTION_VERSION,
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(cipherBuffer))
  };
}

async function decryptNotePayload(payload) {
  if (!cryptoKey) throw new Error("missing-key");
  if (!payload?.iv || !payload?.ciphertext) throw new Error("invalid-payload");
  const iv = decodeBase64(payload.iv);
  const ciphertext = decodeBase64(payload.ciphertext);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );
  return new TextDecoder().decode(decryptedBuffer);
}

function handleNotesDecryptError(err) {
  const message = err?.message === "missing-key" ? "missing-password" : err?.message;
  if (message === "missing-password" || message === "decrypt-failed") {
    cryptoKey = null;
    keySalt = null;
    showReauthPrompt("Please re-enter your password to decrypt your data.");
  }
}

async function resolveEncryptedPayload(uid) {
  try {
    const snap = await getDoc(getStateDocRef(uid));
    if (snap.exists()) return snap.data()?.payload || null;
  } catch {}
  return getEncryptedCache();
}

async function resolveUserSalt(uid, payloadSalt) {
  let storedSalt = null;
  try {
    const snap = await getDoc(getUserDocRef(uid));
    storedSalt = snap.data()?.crypto?.salt || null;
  } catch {}

  if (!storedSalt && payloadSalt) {
    storedSalt = payloadSalt;
    try { await setDoc(getUserDocRef(uid), { crypto: { salt: storedSalt } }, { merge: true }); } catch {}
  }

  if (!storedSalt) {
    storedSalt = encodeBase64(crypto.getRandomValues(new Uint8Array(16)));
    try { await setDoc(getUserDocRef(uid), { crypto: { salt: storedSalt } }, { merge: true }); } catch {}
  }

  return decodeBase64(storedSalt);
}

async function loadState() {
  const user = auth.currentUser;
  if (!user) return clone(defaultState);

  const payload = await resolveEncryptedPayload(user.uid);
  const saltBytes = await resolveUserSalt(user.uid, payload?.salt);
  keySalt = saltBytes;

  if (!payload) {
    if (!cryptoKey) {
      if (pendingPassword) {
        cryptoKey = await deriveKeyFromPassword(pendingPassword, keySalt);
        pendingPassword = null;
        if (authRememberChoice) await wrapEncryptionKeyForDevice(user.uid);
      } else {
        const cachedKey = await unwrapEncryptionKeyFromDevice(user.uid);
        if (cachedKey) cryptoKey = cachedKey;
        else throw new Error("missing-password");
      }
    }
    return clone(defaultState);
  }

  if (!payload.iv || !payload.ciphertext) throw new Error("invalid-payload");

  if (!cryptoKey) {
    if (pendingPassword) {
      cryptoKey = await deriveKeyFromPassword(pendingPassword, keySalt);
      pendingPassword = null;
      if (authRememberChoice) await wrapEncryptionKeyForDevice(user.uid);
    } else {
      const cachedKey = await unwrapEncryptionKeyFromDevice(user.uid);
      if (cachedKey) cryptoKey = cachedKey;
      else throw new Error("missing-password");
    }
  }

  try {
    const decrypted = await decryptStatePayload(payload);
    return mergeStateWithDefaults(decrypted);
  } catch {
    cryptoKey = null;
    keySalt = null;
    throw new Error("decrypt-failed");
  }
}

async function saveState() {
  const user = auth.currentUser;
  if (!user || !cryptoKey || !keySalt) return;

  const payload = await encryptStatePayload();
  payload.salt = encodeBase64(keySalt);

  try { await setDoc(getStateDocRef(user.uid), { payload }, { merge: true }); } catch {}
  setEncryptedCache(payload);
}

async function markUserVerified(user) {
  if (!user) return;
  const payload = {
    email: user.email ?? null,
    emailVerified: Boolean(user.emailVerified),
    updatedAt: Date.now()
  };
  if (user.emailVerified) payload.verifiedAt = Date.now();
  try { await setDoc(getUserDocRef(user.uid), payload, { merge: true }); } catch {}
}

function initUI() {
  initTabs();
  initNavTooltips();
  initFastTypeChips();
  initButtons();
  initSettings();
  initCalendar();
  renderAll();
}

function initAuthListener() {
  onAuthStateChanged(auth, async user => {
    if (user) {
      if (!user.emailVerified) {
        stopStateListener();
        stopNotesListener();
        notesLoaded = false;
        notes = [];
        showVerificationRequired(user);
        return;
      }
      try {
        await completeAuthFlow();
      } catch (err) {
        if (err?.message === "missing-password" || err?.message === "decrypt-failed") {
          showReauthPrompt("Please re-enter your password to decrypt your data.");
          return;
        }
        showReauthPrompt("We couldn't load your encrypted data. Please sign in again.");
      }
    } else {
      stopStateListener();
      stopNotesListener();
      notesLoaded = false;
      notes = [];
      setAuthVisibility(false);
      stopTick();
      cryptoKey = null;
      keySalt = null;
      pendingPassword = null;
      needsUnlock = false;
      authRememberChoice = null;
      closeNotesDrawer(true);
    }
  });
}

function initAuthUI() {
  const form = $("auth-form");
  const toggle = $("auth-toggle");
  const resendBtn = $("verify-email-resend");
  const refreshBtn = $("verify-email-refresh");
  const signOutBtn = $("verify-email-signout");
  form.addEventListener("submit", handleAuthSubmit);
  toggle.addEventListener("click", () => {
    authMode = authMode === "sign-in" ? "sign-up" : "sign-in";
    updateAuthMode();
  });
  resendBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await sendEmailVerification(user);
      showToast("Verification email sent.");
    } catch (err) {
      showToast(err?.message || "Unable to resend verification email.");
    }
  });
  refreshBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await reload(user);
    } catch (err) {
      showToast(err?.message || "Unable to refresh verification status.");
      return;
    }
    if (auth.currentUser?.emailVerified) {
      await markUserVerified(auth.currentUser);
      setVerificationPanel({ visible: false });
      await completeAuthFlow();
    } else {
      showToast("Your email is still unverified.");
    }
  });
  signOutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch {}
    setVerificationPanel({ visible: false });
    setAuthFormDisabled(false);
    $("auth-email").value = "";
    $("auth-password").value = "";
  });
  updateAuthMode();
}

function updateAuthMode() {
  const isSignUp = authMode === "sign-up";
  $("auth-title").textContent = isSignUp ? "Create your account" : "Welcome back";
  $("auth-subtitle").textContent = isSignUp
    ? "Sign up to start tracking your fasts across devices."
    : "Sign in to keep your fasting history synced.";
  $("auth-submit").textContent = isSignUp ? "Create account" : "Sign in";
  $("auth-toggle-text").textContent = isSignUp ? "Already have an account?" : "New here?";
  $("auth-toggle").textContent = isSignUp ? "Sign in" : "Create an account";
  $("auth-error").classList.add("hidden");
  $("auth-error").textContent = "";
  setVerificationPanel({ visible: false });
}

function showReauthPrompt(message) {
  authMode = "sign-in";
  updateAuthMode();
  if (auth.currentUser?.email) $("auth-email").value = auth.currentUser.email;
  $("auth-password").value = "";
  const errorEl = $("auth-error");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
  needsUnlock = true;
  setAuthVisibility(false);
}

function setAuthFormDisabled(disabled) {
  const form = $("auth-form");
  if (!form) return;
  const controls = form.querySelectorAll("input, button");
  controls.forEach((control) => {
    control.disabled = disabled;
  });
  form.classList.toggle("opacity-60", disabled);
  form.classList.toggle("pointer-events-none", disabled);
  const toggle = $("auth-toggle");
  toggle.disabled = disabled;
  toggle.classList.toggle("opacity-60", disabled);
  toggle.classList.toggle("pointer-events-none", disabled);
}

function setVerificationPanel({ visible, email = "" } = {}) {
  const panel = $("verify-email-panel");
  if (!panel) return;
  panel.classList.toggle("hidden", !visible);
  $("verify-email-address").textContent = email || "your inbox";
  setAuthFormDisabled(visible);
}

function showVerificationRequired(user) {
  authMode = "sign-in";
  updateAuthMode();
  if (user?.email) $("auth-email").value = user.email;
  $("auth-error").classList.add("hidden");
  $("auth-error").textContent = "";
  setVerificationPanel({ visible: true, email: user?.email || "" });
  setAuthVisibility(false);
}

function setAuthVisibility(isAuthed) {
  $("app").classList.toggle("hidden", !isAuthed);
  $("auth-screen").classList.toggle("hidden", isAuthed);
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const remember = $("auth-remember").checked;
  const errorEl = $("auth-error");

  errorEl.classList.add("hidden");
  errorEl.textContent = "";

  if (!email || !password) {
    errorEl.textContent = "Please enter both an email and password.";
    errorEl.classList.remove("hidden");
    return;
  }

  try {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    if (authMode === "sign-up") {
      await createUserWithEmailAndPassword(auth, email, password);
      if (auth.currentUser) {
        try {
          await setDoc(getUserDocRef(auth.currentUser.uid), {
            email: auth.currentUser.email ?? email,
            emailVerified: auth.currentUser.emailVerified,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }, { merge: true });
        } catch {}
        try {
          await sendEmailVerification(auth.currentUser);
        } catch (err) {
          showToast(err?.message || "Unable to send verification email.");
        }
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }

    pendingPassword = password;
    authRememberChoice = remember;
    if (auth.currentUser && !remember) clearWrappedKeyStorage(auth.currentUser.uid);

    if (needsUnlock && auth.currentUser) {
      try {
        await completeAuthFlow();
      } catch (err) {
        if (err?.message === "decrypt-failed") {
          showReauthPrompt("Incorrect password. Please try again.");
          return;
        }
        showReauthPrompt("We couldn't unlock your data. Please try again.");
      }
    }
  } catch (err) {
    errorEl.textContent = err?.message || "Unable to authenticate. Please try again.";
    errorEl.classList.remove("hidden");
  }
}

async function completeAuthFlow() {
  if (auth.currentUser?.emailVerified) await markUserVerified(auth.currentUser);
  await loadAppState();
  startStateListener(auth.currentUser.uid);
  startNotesListener(auth.currentUser.uid);
  if (!appInitialized) {
    initUI();
    registerServiceWorker();
    appInitialized = true;
  }
  startTick();
  renderAll();
  needsUnlock = false;
  setAuthVisibility(true);
}

async function loadAppState() {
  state = await loadState();
  selectedFastTypeId = resolveFastTypeId(state.settings.defaultFastTypeId);
  pendingTypeId = null;
  calendarMonth = startOfMonth(new Date());
  selectedDayKey = formatDateKey(new Date());
}

// ✅ NEW: Ensure Notes drawer is an overlay (fixed, above tabs) and closes on outside click
function ensureNotesOverlay() {
  if (notesPortal) return;

  const drawer = $("tab-notes");
  if (!drawer) return;

  notesPortal = document.createElement("div");
  notesPortal.id = "notes-portal";
  notesPortal.style.position = "fixed";
  notesPortal.style.inset = "0";
  notesPortal.style.zIndex = "9999";
  notesPortal.style.display = "none";
  notesPortal.style.pointerEvents = "auto";
  notesPortal.style.touchAction = "pan-y";
  notesPortal.style.overscrollBehaviorX = "contain";

  notesBackdrop = document.createElement("div");
  notesBackdrop.id = "notes-backdrop";
  notesBackdrop.style.position = "absolute";
  notesBackdrop.style.inset = "0";
  notesBackdrop.style.background = "rgba(0,0,0,0.55)";
  notesBackdrop.style.backdropFilter = "blur(2px)";
  notesBackdrop.style.webkitBackdropFilter = "blur(2px)";

  notesPortal.appendChild(notesBackdrop);

  // Move drawer into portal so it can sit above everything
  notesPortal.appendChild(drawer);

  // Make the drawer behave like a right-side sheet on desktop, full width on mobile
  drawer.style.position = "absolute";
  drawer.style.top = "0";
  drawer.style.right = "0";
  drawer.style.bottom = "0";
  drawer.style.left = "auto";
  drawer.style.width = "min(420px, 100vw)";
  drawer.style.maxWidth = "100vw";
  drawer.style.height = "100%";
  drawer.style.overflow = "auto";
  drawer.style.zIndex = "10000";

  // Prevent clicks inside the drawer from closing it via backdrop
  drawer.addEventListener("mousedown", (e) => e.stopPropagation());
  drawer.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
  drawer.addEventListener("click", (e) => e.stopPropagation());

  if (!notesSwipeHandlersAttached && navigator.maxTouchPoints > 0) {
    notesSwipeHandlersAttached = true;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeTracking = false;

    notesPortal.addEventListener("touchstart", (e) => {
      if (!notesOverlayOpen || !e.touches || e.touches.length !== 1) return;
      const touch = e.touches[0];
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
      swipeTracking = true;
    }, { passive: true, capture: true });

    notesPortal.addEventListener("touchmove", (e) => {
      if (!swipeTracking || !e.touches || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - swipeStartX;
      const deltaY = Math.abs(touch.clientY - swipeStartY);
      if (deltaY > 60 && deltaY > Math.abs(deltaX)) {
        swipeTracking = false;
      }
    }, { passive: true, capture: true });

    notesPortal.addEventListener("touchend", (e) => {
      if (!swipeTracking || !notesOverlayOpen) return;
      const touch = e.changedTouches && e.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - swipeStartX;
      const deltaY = Math.abs(touch.clientY - swipeStartY);
      if (deltaX > 60 && deltaY < 40) {
        closeNotesDrawer();
      }
      swipeTracking = false;
    }, { passive: true, capture: true });
  }

  notesBackdrop.addEventListener("click", () => closeNotesDrawer());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && notesOverlayOpen) closeNotesDrawer();
  });

  document.body.appendChild(notesPortal);
}

function setNotesNavActive(on) {
  const notesBtn = document.querySelector('nav .nav-btn[data-tab="notes"]');
  if (!notesBtn) return;
  notesBtn.classList.toggle("nav-btn-active", !!on);
  notesBtn.classList.toggle("text-slate-100", !!on);
  notesBtn.classList.toggle("text-slate-500", !on);
}

function openNotesDrawer() {
  ensureNotesOverlay();
  const drawer = $("tab-notes");
  if (!drawer || !notesPortal) return;

  if (notesDrawerCloseTimeout) {
    clearTimeout(notesDrawerCloseTimeout);
    notesDrawerCloseTimeout = null;
  }

  if (bodyOverflowBeforeNotes === null) bodyOverflowBeforeNotes = document.body.style.overflow || "";
  document.body.style.overflow = "hidden";

  notesPortal.style.display = "block";
  drawer.classList.remove("hidden");
  requestAnimationFrame(() => drawer.classList.add("is-open"));

  notesOverlayOpen = true;
  setNotesNavActive(true);
  renderNotes();
}

function closeNotesDrawer(forceImmediate = false) {
  const drawer = $("tab-notes");
  if (!drawer || !notesPortal) {
    notesOverlayOpen = false;
    setNotesNavActive(false);
    if (bodyOverflowBeforeNotes !== null) {
      document.body.style.overflow = bodyOverflowBeforeNotes;
      bodyOverflowBeforeNotes = null;
    }
    return;
  }

  notesOverlayOpen = false;
  setNotesNavActive(false);

  drawer.classList.remove("is-open");

  if (forceImmediate) {
    drawer.classList.add("hidden");
    notesPortal.style.display = "none";
    if (bodyOverflowBeforeNotes !== null) {
      document.body.style.overflow = bodyOverflowBeforeNotes;
      bodyOverflowBeforeNotes = null;
    }
    return;
  }

  if (notesDrawerCloseTimeout) clearTimeout(notesDrawerCloseTimeout);
  notesDrawerCloseTimeout = setTimeout(() => {
    drawer.classList.add("hidden");
    notesPortal.style.display = "none";
    if (bodyOverflowBeforeNotes !== null) {
      document.body.style.overflow = bodyOverflowBeforeNotes;
      bodyOverflowBeforeNotes = null;
    }
  }, 220);
}

function initTabs() {
  document.querySelectorAll("nav .nav-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      if (suppressNavClickEl === btn) {
        suppressNavClickEl = null;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const tab = btn.dataset.tab;

      // ✅ Notes is now an overlay, not a real tab switch
      if (tab === "notes") {
        if (notesOverlayOpen) closeNotesDrawer();
        else openNotesDrawer();
        return;
      }

      // Switching tabs should close notes overlay if open
      if (notesOverlayOpen) closeNotesDrawer();

      switchTab(tab);
    });
  });

  switchTab("timer");
}

function switchTab(tab) {
  currentTab = tab;
  if (tab !== "notes") lastNonNotesTab = tab;

  ["timer", "history", "settings"].forEach(id => {
    const section = $("tab-" + id);
    const btn = document.querySelector(`nav .nav-btn[data-tab="${id}"]`);
    const active = id === tab;
    section.classList.toggle("hidden", !active);
    btn.classList.toggle("nav-btn-active", active);
    btn.classList.toggle("text-slate-100", active);
    btn.classList.toggle("text-slate-500", !active);
  });

  setNotesNavActive(false);

  if (tab === "history") {
    renderCalendar();
    renderDayDetails();
    renderRecentFasts();
    renderNotes();
  }
  if (tab === "settings") renderSettings();
}

function initNavTooltips() {
  const tooltip = $("nav-tooltip");
  const hide = () => {
    tooltip.classList.add("hidden");
    navHoldShown = false;
    clearTimeout(navHoldTimer);
    navHoldTimer = null;
  };

  const showFor = (btn) => {
    const label = btn.dataset.label || "";
    if (!label) return;
    const r = btn.getBoundingClientRect();
    tooltip.textContent = label;
    tooltip.classList.remove("hidden");

    const pad = 10;
    const tw = tooltip.offsetWidth || 90;
    const th = tooltip.offsetHeight || 24;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(pad, Math.min(window.innerWidth - tw - pad, x));
    let y = r.top - th - 10;
    if (y < pad) y = r.bottom + 10;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  };

  const startHold = (btn) => {
    clearTimeout(navHoldTimer);
    navHoldShown = false;
    suppressNavClickEl = null;
    navHoldTimer = setTimeout(() => {
      navHoldShown = true;
      suppressNavClickEl = btn;
      showFor(btn);
      setTimeout(() => { if (navHoldShown) hide(); }, 1400);
    }, 420);
  };

  document.querySelectorAll("nav .nav-btn").forEach(btn => {
    btn.addEventListener("touchstart", () => startHold(btn), { passive: true });
    btn.addEventListener("touchend", hide, { passive: true });
    btn.addEventListener("touchcancel", hide, { passive: true });

    btn.addEventListener("mousedown", () => startHold(btn));
    btn.addEventListener("mouseup", hide);
    btn.addEventListener("mouseleave", hide);
    btn.addEventListener("blur", hide);
  });

  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("resize", hide, { passive: true });
}

function getTypeById(id) {
  if (!Array.isArray(FAST_TYPES) || FAST_TYPES.length === 0) return null;
  return FAST_TYPES.find(t => t.id === id) || FAST_TYPES[0];
}

function getActiveType() {
  if (state.activeFast?.typeId) return getTypeById(state.activeFast.typeId);
  return getTypeById(selectedFastTypeId);
}

function initFastTypeChips() {
  const container = $("fast-type-chips");
  container.innerHTML = "";
  FAST_TYPES.forEach(type => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.typeId = type.id;
    btn.className = "fast-type-chip text-[11px] md:text-[10px]";
    btn.textContent = type.label;
    btn.addEventListener("click", () => {
      pendingTypeId = type.id;
      openFastTypeModal(getTypeById(pendingTypeId));
    });
    container.appendChild(btn);
  });
  highlightSelectedFastType();
}

function highlightSelectedFastType() {
  const chips = document.querySelectorAll("#fast-type-chips button");
  const current = state.activeFast ? state.activeFast.typeId : selectedFastTypeId;
  chips.forEach(chip => {
    const isActive = chip.dataset.typeId === current;
    if (isActive) {
      chip.classList.add("fast-type-chip--active");
    } else {
      chip.classList.remove("fast-type-chip--active");
    }
  });
}

function applyTypeToActiveFast(typeId) {
  const af = state.activeFast;
  if (!af) return;
  const t = getTypeById(typeId);
  af.typeId = t.id;
  af.plannedDurationHours = t.durationHours;
  af.endTimestamp = af.startTimestamp + t.durationHours * 3600000;
  af.status = "active";
  state.reminders = { endNotified: false, lastHourlyAt: null };
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

function closeFastTypeModal() {
  $("fast-type-modal").classList.add("hidden");
  pendingTypeId = null;
}

function usePendingFastType() {
  if (!pendingTypeId) { closeFastTypeModal(); return; }
  selectedFastTypeId = pendingTypeId;
  state.settings.defaultFastTypeId = selectedFastTypeId;
  if (state.activeFast) applyTypeToActiveFast(selectedFastTypeId);
  void saveState();
  closeFastTypeModal();
  highlightSelectedFastType();
  updateTimer();
  if (!state.activeFast) renderTimerMetaIdle();
  showToast("Fast type applied");
}

function initButtons() {
  $("start-fast-btn").addEventListener("click", confirmStartFast);
  $("stop-fast-btn").addEventListener("click", confirmStopFast);

  $("alerts-btn").addEventListener("click", onAlertsButton);

  $("modal-close").addEventListener("click", closeFastTypeModal);
  $("modal-use-type").addEventListener("click", usePendingFastType);
  $("confirm-fast-close").addEventListener("click", closeConfirmFastModal);
  $("confirm-fast-accept").addEventListener("click", confirmFastAction);
  const confirmBackdrop = document.querySelector("#confirm-fast-modal .confirm-fast-backdrop");
  if (confirmBackdrop) confirmBackdrop.addEventListener("click", closeConfirmFastModal);

  $("toggle-end-alert").addEventListener("click", () => {
    state.settings.notifyOnEnd = !state.settings.notifyOnEnd;
    void saveState();
    renderSettings();
    renderAlertsPill();
  });

  $("toggle-hourly-alert").addEventListener("click", () => {
    state.settings.hourlyReminders = !state.settings.hourlyReminders;
    void saveState();
    renderSettings();
  });

  $("theme-preset-select").addEventListener("change", (event) => {
    setThemePreset(event.target.value);
    applyThemeColors();
    renderSettings();
    void saveState();
  });

  $("theme-primary-color").addEventListener("input", (event) => {
    setCustomThemeColor("primaryColor", event.target.value);
    applyThemeColors();
    void saveState();
  });

  $("theme-secondary-color").addEventListener("input", (event) => {
    setCustomThemeColor("secondaryColor", event.target.value);
    applyThemeColors();
    void saveState();
  });

  $("theme-background-color").addEventListener("input", (event) => {
    setCustomThemeColor("backgroundColor", event.target.value);
    applyThemeColors();
    void saveState();
  });

  $("theme-surface-color").addEventListener("input", (event) => {
    setCustomThemeColor("surfaceColor", event.target.value);
    applyThemeColors();
    void saveState();
  });

  $("theme-surface-muted-color").addEventListener("input", (event) => {
    setCustomThemeColor("surfaceMutedColor", event.target.value);
    applyThemeColors();
    void saveState();
  });

  $("theme-border-color").addEventListener("input", (event) => {
    setCustomThemeColor("borderColor", event.target.value);
    applyThemeColors();
    void saveState();
  });

  $("theme-text-color").addEventListener("input", (event) => {
    setCustomThemeColor("textColor", event.target.value);
    applyThemeColors();
    void saveState();
  });

  $("theme-text-muted-color").addEventListener("input", (event) => {
    setCustomThemeColor("textMutedColor", event.target.value);
    applyThemeColors();
    void saveState();
  });

  $("theme-danger-color").addEventListener("input", (event) => {
    setCustomThemeColor("dangerColor", event.target.value);
    applyThemeColors();
    void saveState();
  });

  $("export-data").addEventListener("click", exportCSV);
  $("clear-data").addEventListener("click", clearAllData);
  $("sign-out").addEventListener("click", async () => {
    try { await signOut(auth); } catch {}
  });

  $("calendar-prev").addEventListener("click", () => { calendarMonth = addMonths(calendarMonth, -1); renderCalendar(); renderDayDetails(); renderNotes(); });
  $("calendar-next").addEventListener("click", () => { calendarMonth = addMonths(calendarMonth, 1); renderCalendar(); renderDayDetails(); renderNotes(); });

  $("default-fast-select").addEventListener("change", e => {
    selectedFastTypeId = e.target.value;
    state.settings.defaultFastTypeId = selectedFastTypeId;
    void saveState();
    highlightSelectedFastType();
    if (!state.activeFast) renderTimerMetaIdle();
    updateTimer();
  });

  $("timer-main").addEventListener("click", cycleTimeMode);

  $("meta-start-btn").addEventListener("click", () => {
    if (!state.activeFast) return;
    openEditStartModal();
  });

  $("edit-start-close").addEventListener("click", closeEditStartModal);
  $("edit-start-now").addEventListener("click", () => { $("edit-start-input").value = toLocalInputValue(new Date()); });
  $("edit-start-save").addEventListener("click", saveEditedStartTime);

  $("new-note-btn").addEventListener("click", () => openNoteEditor());
  const noteEditorBackdrop = document.querySelector("#note-editor-modal .note-editor-backdrop");
  if (noteEditorBackdrop) noteEditorBackdrop.addEventListener("click", closeNoteEditor);
  $("note-editor-close").addEventListener("click", closeNoteEditor);
  $("note-editor-save").addEventListener("click", saveNoteEditor);
  $("note-editor-delete").addEventListener("click", removeNote);
  attachNoteEditorSwipeHandlers();

  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderAll(); });
}

function openConfirmFastModal({ title, message, confirmLabel, confirmClasses, onConfirm, focusAfterClose }) {
  $("confirm-fast-title").textContent = title;
  $("confirm-fast-message").textContent = message;
  $("confirm-fast-accept").textContent = confirmLabel;
  $("confirm-fast-accept").className = confirmClasses;
  pendingConfirmAction = onConfirm;
  pendingConfirmCloseFocus = focusAfterClose || null;
  $("confirm-fast-modal").classList.remove("hidden");
}

function closeConfirmFastModal() {
  $("confirm-fast-modal").classList.add("hidden");
  pendingConfirmAction = null;
  if (pendingConfirmCloseFocus) {
    pendingConfirmCloseFocus.focus();
  }
  pendingConfirmCloseFocus = null;
}

function confirmFastAction() {
  if (typeof pendingConfirmAction === "function") {
    pendingConfirmAction();
  }
  closeConfirmFastModal();
}

function confirmStartFast(event) {
  const type = getTypeById(selectedFastTypeId);
  if (!type) return;
  openConfirmFastModal({
    title: "Start this fast?",
    message: `Start a ${type.label} fast for ${type.durationHours} hours?`,
    confirmLabel: "Start fast",
    confirmClasses: "w-full py-3 md:py-2.5 rounded-xl bg-brand-500 text-slate-950 text-sm md:text-xs font-semibold",
    onConfirm: startFast,
    focusAfterClose: event?.currentTarget
  });
}

function confirmStopFast(event) {
  const af = state.activeFast;
  if (!af) return;
  const type = getTypeById(af.typeId);
  const typeLabel = type ? type.label : "current";
  openConfirmFastModal({
    title: "Stop this fast?",
    message: `Stop and log your ${typeLabel} fast now?`,
    confirmLabel: "Stop fast",
    confirmClasses: "w-full py-3 md:py-2.5 rounded-xl button-danger border text-sm md:text-xs font-semibold",
    onConfirm: stopFastAndLog,
    focusAfterClose: event?.currentTarget
  });
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

  const themeSelect = $("theme-preset-select");
  themeSelect.innerHTML = "";
  Object.entries(THEME_PRESETS).forEach(([id, preset]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = preset.label;
    themeSelect.appendChild(option);
  });
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom";
  themeSelect.appendChild(customOption);
}

function renderSettings() {
  const customTheme = getCustomThemeColors();
  const presetId = resolveThemePresetId();
  $("default-fast-select").value = resolveFastTypeId(state.settings.defaultFastTypeId);
  $("toggle-end-alert").classList.toggle("on", !!state.settings.notifyOnEnd);
  $("toggle-hourly-alert").classList.toggle("on", !!state.settings.hourlyReminders);
  $("theme-preset-select").value = presetId;
  $("theme-custom-controls").classList.toggle("hidden", presetId !== "custom");
  $("theme-primary-color").value = customTheme.primaryColor;
  $("theme-secondary-color").value = customTheme.secondaryColor;
  $("theme-background-color").value = customTheme.backgroundColor;
  $("theme-surface-color").value = customTheme.surfaceColor;
  $("theme-surface-muted-color").value = customTheme.surfaceMutedColor;
  $("theme-border-color").value = customTheme.borderColor;
  $("theme-text-color").value = customTheme.textColor;
  $("theme-text-muted-color").value = customTheme.textMutedColor;
  $("theme-danger-color").value = customTheme.dangerColor;
  renderAlertsPill();
}

function startFast() {
  const type = getTypeById(selectedFastTypeId);
  const now = Date.now();
  state.activeFast = {
    id: "fast_" + now,
    typeId: type.id,
    startTimestamp: now,
    plannedDurationHours: type.durationHours,
    endTimestamp: now + type.durationHours * 3600000,
    status: "active",
    milestonesHit: []
  };
  state.reminders = { endNotified: false, lastHourlyAt: null };
  selectedDayKey = formatDateKey(new Date(now));
  calendarMonth = startOfMonth(new Date(now));
  void saveState();
  renderAll();
  showToast("Fast started");
}

function stopFastAndLog() {
  const af = state.activeFast;
  if (!af) return;
  const now = Date.now();
  const endTs = now;
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
  void saveState();

  calendarMonth = startOfMonth(new Date());
  selectedDayKey = formatDateKey(new Date());
  renderAll();
  showToast("Fast logged");
}

function startTick() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    updateTimer();
    handleAlerts();
  }, 1000);
  updateTimer();
  renderAlertsPill();
}

function stopTick() {
  if (!tickHandle) return;
  clearInterval(tickHandle);
  tickHandle = null;
}

function cycleTimeMode() {
  const order = ["elapsed", "total", "remaining"];
  const cur = state.settings.timeDisplayMode || "elapsed";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  state.settings.timeDisplayMode = next;
  void saveState();
  updateTimer();
}

function ensureRingEmojis() {
  const type = getActiveType();
  const layer = $("ring-emoji-layer");
  if (!layer || !type) return;
  const size = layer.clientWidth;
  const shouldRender = !layer.childElementCount || ringEmojiTypeId !== type.id || ringEmojiLayoutSize !== size;
  if (shouldRender) {
    renderRingEmojis(type, size);
  } else {
    updateRingEmojiProgress(type);
  }
}

function renderRingEmojis(type, size) {
  const layer = $("ring-emoji-layer");
  const title = $("ring-emoji-title");
  const detail = $("ring-emoji-detail");
  if (!layer || !title || !detail) return;

  ringEmojiTypeId = type.id;
  ringEmojiLayoutSize = size;
  layer.innerHTML = "";

  const milestones = Array.isArray(type.milestones) ? type.milestones : [];
  if (!milestones.length || !size) {
    title.textContent = "Tap an emoji to see what’s happening";
    detail.textContent = "";
    return;
  }

  const radius = Math.max(size / 2 - 18, 0);
  const center = size / 2;

  milestones.forEach(milestone => {
    const angle = (milestone.hour / type.durationHours) * 360 - 90;
    const rad = angle * (Math.PI / 180);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ring-emoji-btn";
    btn.textContent = milestone.emoji;
    btn.style.left = `${center + Math.cos(rad) * radius}px`;
    btn.style.top = `${center + Math.sin(rad) * radius}px`;
    btn.dataset.hour = String(milestone.hour);
    btn.dataset.typeId = type.id;
    btn.addEventListener("click", () => selectRingEmoji(type, milestone));
    layer.appendChild(btn);
  });

  const hasSelection = milestones.some(m => `${type.id}-${m.hour}` === ringEmojiSelectionKey);
  if (!hasSelection) {
    ringEmojiSelectionKey = null;
    ringEmojiSelectionDetail = null;
  }
  if (ringEmojiSelectionKey) {
    const selected = milestones.find(m => `${type.id}-${m.hour}` === ringEmojiSelectionKey);
    updateRingEmojiPanel(type, selected);
  } else {
    title.textContent = "Tap an emoji to see what’s happening";
    detail.textContent = `${type.label} milestones wrap the ring.`;
  }

  updateRingEmojiSelectionStyles();
  updateRingEmojiProgress(type);
}

function selectRingEmoji(type, milestone) {
  ringEmojiSelectionKey = `${type.id}-${milestone.hour}`;
  ringEmojiSelectionDetail = getRandomMilestoneDetail(milestone.hour) ?? milestone.detail;
  updateRingEmojiPanel(type, milestone);
  updateRingEmojiSelectionStyles();
}

function getRandomMilestoneDetail(hour) {
  const numericHour = Number(hour);
  const tips = [];

  FAST_TYPES.forEach(type => {
    const milestones = Array.isArray(type?.milestones) ? type.milestones : [];
    milestones.forEach(milestone => {
      if (Number(milestone.hour) === numericHour && milestone.detail) {
        tips.push(milestone.detail);
      }
    });
  });

  if (!tips.length) return null;
  return tips[Math.floor(Math.random() * tips.length)];
}

function updateRingEmojiPanel(type, milestone) {
  const title = $("ring-emoji-title");
  const detail = $("ring-emoji-detail");
  if (!title || !detail) return;

  if (!milestone) {
    title.textContent = "Tap an emoji to see what’s happening";
    detail.textContent = `${type.label} milestones wrap the ring.`;
    return;
  }

  title.textContent = `Hour ${milestone.hour} · ${milestone.label}`;
  detail.textContent = ringEmojiSelectionDetail ?? milestone.detail;
}

function updateRingEmojiSelectionStyles() {
  const layer = $("ring-emoji-layer");
  if (!layer) return;
  layer.querySelectorAll(".ring-emoji-btn").forEach(btn => {
    const key = `${btn.dataset.typeId}-${btn.dataset.hour}`;
    if (key === ringEmojiSelectionKey) btn.classList.add("is-selected");
    else btn.classList.remove("is-selected");
  });
}

function updateRingEmojiProgress(type) {
  const layer = $("ring-emoji-layer");
  if (!layer) return;
  const elapsedHours = state.activeFast
    ? Math.max(0, (Date.now() - state.activeFast.startTimestamp) / 3600000)
    : null;
  const milestones = Array.isArray(type?.milestones) ? type.milestones : [];
  const title = $("ring-emoji-title");
  const detail = $("ring-emoji-detail");
  let visibleCount = 0;

  layer.querySelectorAll(".ring-emoji-btn").forEach(btn => {
    const hour = Number(btn.dataset.hour);
    const isActive = elapsedHours !== null && elapsedHours >= hour;
    const isVisible = elapsedHours === null || elapsedHours >= hour;
    btn.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
    if (isActive) btn.classList.add("is-active");
    else btn.classList.remove("is-active");
  });

  if (elapsedHours !== null && visibleCount === 0 && milestones.length) {
    ringEmojiSelectionKey = null;
    ringEmojiSelectionDetail = null;
    if (title && detail) {
      title.textContent = "Milestones unlock as you fast";
      detail.textContent = `First milestone at hour ${milestones[0].hour}.`;
    }
    return;
  }

  if (ringEmojiSelectionKey) {
    const selectedButton = layer.querySelector(`[data-type-id="${type.id}"][data-hour="${ringEmojiSelectionKey.split("-")[1]}"]`);
    if (!selectedButton || selectedButton.hidden) {
      ringEmojiSelectionKey = null;
      ringEmojiSelectionDetail = null;
      updateRingEmojiPanel(type, null);
      updateRingEmojiSelectionStyles();
    }
  }
}

function updateTimer() {
  const ring = $("progress-ring");
  const main = $("timer-main");
  const mode = $("timer-mode");
  const sub = $("timer-sub");
  const header = $("header-subtitle");
  const status = $("timer-status");
  const typePill = $("timer-type");

  ring.setAttribute("stroke-dasharray", String(RING_CIRC));
  ensureRingEmojis();

  const displayMode = state.settings.timeDisplayMode || "elapsed";
  const type = getActiveType();
  typePill.textContent = type ? (type.label + " fast") : "No fast selected";

  highlightSelectedFastType();

  if (!state.activeFast) {
    status.textContent = "IDLE";
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
    $("stop-fast-btn").classList.add("hidden");
    $("meta-start-btn").disabled = true;
    return;
  }

  trackMilestoneProgress(type);

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

  $("start-fast-btn").classList.add("hidden");
  $("stop-fast-btn").classList.remove("hidden");

  if (now < end) {
    status.textContent = "FASTING";
    header.textContent = "Ends " + formatTimeShort(new Date(end));
  } else {
    status.textContent = "COMPLETE";
    header.textContent = "Fast complete";
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

function trackMilestoneProgress(type) {
  if (!state.activeFast || !type) return;
  const milestones = Array.isArray(type.milestones) ? type.milestones : [];
  if (!milestones.length) return;
  if (!Array.isArray(state.activeFast.milestonesHit)) {
    state.activeFast.milestonesHit = [];
  }
  if (!state.milestoneTally || typeof state.milestoneTally !== "object") {
    state.milestoneTally = {};
  }
  const elapsedHours = Math.max(0, (Date.now() - state.activeFast.startTimestamp) / 3600000);
  let updated = false;
  milestones.forEach(milestone => {
    if (elapsedHours < milestone.hour) return;
    if (state.activeFast.milestonesHit.includes(milestone.hour)) return;
    state.activeFast.milestonesHit.push(milestone.hour);
    const key = String(milestone.hour);
    state.milestoneTally[key] = (state.milestoneTally[key] || 0) + 1;
    updated = true;
  });
  if (updated) void saveState();
}

function renderTimerMetaIdle() {
  const type = getTypeById(selectedFastTypeId);
  $("meta-start-btn").textContent = "—";
  $("meta-end").textContent = "—";
  $("meta-planned").textContent = (type?.durationHours || 0) + " h";
}

async function onAlertsButton() {
  if (!("Notification" in window)) { showToast("Notifications not supported"); return; }
  if (Notification.permission === "denied") { showToast("Alerts blocked in browser settings"); return; }

  if (Notification.permission === "default") {
    const res = await Notification.requestPermission();
    if (res !== "granted") { showToast("Permission not granted"); renderAlertsPill(); return; }
    state.settings.alertsEnabled = true;
    void saveState();
    renderAlertsPill();
    await sendNotification("Alerts enabled", "You’ll be notified when your fast ends.");
    showToast("Alerts enabled");
    return;
  }

  state.settings.alertsEnabled = !state.settings.alertsEnabled;
  void saveState();
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

  if (!("Notification" in window)) { dot.className = "w-2 h-2 md:w-1.5 md:h-1.5 rounded-full bg-slate-600"; label.textContent = "Unavailable"; return; }
  if (Notification.permission === "denied") { dot.className = "w-2 h-2 md:w-1.5 md:h-1.5 rounded-full bg-red-500"; label.textContent = "Blocked"; return; }
  if (Notification.permission === "default") { dot.className = "w-2 h-2 md:w-1.5 md:h-1.5 rounded-full bg-slate-600"; label.textContent = "Enable alerts"; return; }
  if (state.settings.alertsEnabled) { dot.className = "w-2 h-2 md:w-1.5 md:h-1.5 rounded-full bg-emerald-400"; label.textContent = "Alerts on"; }
  else { dot.className = "w-2 h-2 md:w-1.5 md:h-1.5 rounded-full bg-slate-600"; label.textContent = "Alerts off"; }
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
        tag: "fasting-tracker"
      });
      return;
    }
  } catch {}

  try { new Notification(title, { body }); } catch {}
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
    if (state.settings.notifyOnEnd) sendNotification("Fast complete", "You reached your fasting goal.");
    state.reminders.endNotified = true;
    state.reminders.lastHourlyAt = now;
    void saveState();
    return;
  }

  if (state.reminders.endNotified && state.settings.hourlyReminders) {
    const last = state.reminders.lastHourlyAt || endTs;
    if (now - last >= 3600000) {
      sendNotification("Extra hour fasted", "You’re past your target. Break your fast when ready.");
      state.reminders.lastHourlyAt = now;
      void saveState();
    }
  }
}

function openEditStartModal() {
  const start = new Date(state.activeFast.startTimestamp);
  $("edit-start-input").value = toLocalInputValue(start);
  $("edit-start-modal").classList.remove("hidden");
}

function closeEditStartModal() { $("edit-start-modal").classList.add("hidden"); }

function saveEditedStartTime() {
  if (!state.activeFast) return;
  const v = $("edit-start-input").value;
  if (!v) { showToast("Invalid time"); return; }
  const d = new Date(v);
  if (!isFinite(d.getTime())) { showToast("Invalid time"); return; }

  const af = state.activeFast;
  const plannedMs = (af.plannedDurationHours || getActiveType().durationHours || 0) * 3600000;
  af.startTimestamp = d.getTime();
  af.endTimestamp = af.startTimestamp + plannedMs;
  af.status = "active";
  state.reminders = { endNotified: false, lastHourlyAt: null };
  selectedDayKey = formatDateKey(new Date(af.startTimestamp));
  calendarMonth = startOfMonth(new Date(af.startTimestamp));

  void saveState();
  closeEditStartModal();
  updateTimer();
  renderCalendar();
  renderDayDetails();
  showToast("Start time updated");
}

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => t.classList.add("hidden"), 2200);
}

function exportCSV() {
  const rows = [];
  rows.push(["id","typeId","typeLabel","startISO","endISO","durationHours"].join(","));
  for (const e of state.history) {
    const type = getTypeById(e.typeId);
    const startISO = new Date(e.startTimestamp).toISOString();
    const endISO = new Date(e.endTimestamp).toISOString();
    const duration = (typeof e.durationHours === "number" ? e.durationHours : Number(e.durationHours)) || 0;
    rows.push([
      csvCell(e.id),
      csvCell(e.typeId),
      csvCell(type?.label || ""),
      csvCell(startISO),
      csvCell(endISO),
      csvCell(duration.toFixed(2))
    ].join(","));
  }
  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "history.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Exported CSV");
}

function csvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

function clearAllData() {
  if (!confirm("Clear all fasting history and active fast?")) return;
  state = clone(defaultState);
  selectedFastTypeId = state.settings.defaultFastTypeId;
  pendingTypeId = null;
  void saveState();
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
    cell.className = "calendar-day aspect-square flex flex-col items-center justify-center text-[12px] md:text-[11px]";

    let dayNum, date, isCurrent = false;

    if (i < startWeekday) {
      dayNum = daysInPrev - startWeekday + i + 1;
      date = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), dayNum);
      cell.classList.add("calendar-day--muted");
    } else if (i >= startWeekday + daysInMonth) {
      dayNum = i - startWeekday - daysInMonth + 1;
      const nextMonth = addMonths(calendarMonth, 1);
      date = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), dayNum);
      cell.classList.add("calendar-day--muted");
    } else {
      dayNum = i - startWeekday + 1;
      date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), dayNum);
      isCurrent = true;
      cell.classList.add("calendar-day--current");
    }

    const key = formatDateKey(date);
    const data = dayMap[key];
    const hasFast = !!data;
    const isSelected = key === selectedDayKey;
    const isToday = key === todayKey;

    if (isSelected) cell.classList.add("calendar-day--selected");
    else if (hasFast) cell.classList.add("calendar-day--has-fast");
    else cell.classList.add("calendar-day--empty");

    if (isToday && isCurrent) {
      const dot = document.createElement("span");
      dot.className = "calendar-day-dot w-2 h-2 md:w-1.5 md:h-1.5 rounded-full mb-0.5";
      cell.appendChild(dot);
    }

    const dspan = document.createElement("span");
    dspan.textContent = dayNum;
    cell.appendChild(dspan);

    if (hasFast) {
      const tiny = document.createElement("span");
      tiny.className = "calendar-day-hours mt-0.5 text-[10px] md:text-[9px]";
      tiny.textContent = Math.round(data.totalHours) + "h";
      cell.appendChild(tiny);
    }

    cell.addEventListener("click", () => {
      selectedDayKey = key;
      renderCalendar();
      renderDayDetails();
      renderNotes();
    });

    grid.appendChild(cell);
  }
}

function buildDayFastMap({ includeActive = false } = {}) {
  const map = {};
  state.history.forEach(e => {
    const key = formatDateKey(new Date(e.startTimestamp));
    if (!map[key]) map[key] = { entries: [], totalHours: 0 };
    map[key].entries.push(e);
    map[key].totalHours += e.durationHours || 0;
  });
  if (includeActive && state.activeFast) {
    const af = state.activeFast;
    const key = formatDateKey(new Date(af.startTimestamp));
    if (!map[key]) map[key] = { entries: [], totalHours: 0 };
    const elapsedHours = Math.max(0, (Date.now() - af.startTimestamp) / 3600000);
    map[key].entries.push({ ...af, durationHours: elapsedHours, isActive: true });
    map[key].totalHours += elapsedHours;
  }
  return map;
}

function renderDayDetails() {
  const summary = $("day-summary");
  const list = $("day-fast-list");
  const map = buildDayFastMap({ includeActive: true });
  const day = map[selectedDayKey];

  list.innerHTML = "";

  if (!day) { summary.textContent = "No fasts logged"; return; }

  summary.textContent = `${day.entries.length} fast(s), ${day.totalHours.toFixed(1)} total hours`;

  day.entries.forEach(e => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between bg-slate-900 rounded-xl px-3 py-3 md:py-2";

    const left = document.createElement("div");
    left.className = "flex flex-col text-sm md:text-[11px]";

    const type = getTypeById(e.typeId);
    const title = document.createElement("div");
    title.className = "text-slate-100";
    const label = type ? type.label : "Custom";
    title.textContent = e.isActive
      ? `Active • ${label} fast`
      : `${label} • ${Number(e.durationHours).toFixed(1)}h`;

    const time = document.createElement("div");
    time.className = "text-slate-400";
    const timeLabel = `${formatTimeShort(new Date(e.startTimestamp))} → ${formatTimeShort(new Date(e.endTimestamp))}`;
    time.textContent = e.isActive ? `${timeLabel} (in progress)` : timeLabel;

    left.appendChild(title);
    left.appendChild(time);

    row.appendChild(left);
    list.appendChild(row);
  });
}

function renderNotes() {
  renderHistoryNotes();
  renderNotesTab();
}

function renderHistoryNotes() {
  const summary = $("day-notes-summary");
  const list = $("day-notes-list");
  if (!summary || !list) return;

  list.innerHTML = "";

  if (!notesLoaded) {
    summary.textContent = "Loading notes…";
    return;
  }

  const dayNotes = notes.filter(note => note.dateKey === selectedDayKey);
  if (!dayNotes.length) {
    summary.textContent = "No notes yet.";
    return;
  }

  summary.textContent = `${dayNotes.length} note(s)`;
  dayNotes.forEach(note => list.appendChild(buildNoteCard(note)));
}

function renderNotesTab() {
  const list = $("notes-list");
  const empty = $("notes-empty");
  const emptyTitle = $("notes-empty-title");
  const emptyBody = $("notes-empty-body");
  if (!list || !empty || !emptyTitle || !emptyBody) return;

  list.innerHTML = "";

  if (!notesLoaded) {
    emptyTitle.textContent = "Loading notes…";
    emptyBody.textContent = "Your notes will appear here once they sync.";
    empty.classList.remove("hidden");
    return;
  }

  if (!notes.length) {
    emptyTitle.textContent = "No notes yet";
    emptyBody.textContent = "Start a new note to track how your fast feels.";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  notes.forEach(note => list.appendChild(buildNoteCard(note)));
}

function buildNoteCard(note) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "note-card";
  card.addEventListener("click", () => openNoteEditor(note));

  const text = document.createElement("div");
  text.className = "text-slate-100 whitespace-pre-wrap text-sm md:text-xs";
  text.textContent = note.text || "Untitled note";

  const meta = document.createElement("div");
  meta.className = "note-meta";

  const date = document.createElement("span");
  date.textContent = getNoteTimestampLabel(note);

  const badge = document.createElement("span");
  badge.className = "note-badge";
  const isActive = Boolean(note.fastContext?.wasActive);
  const elapsedMsAtNote = note.fastContext?.elapsedMsAtNote;
  const hasElapsed = isActive && typeof elapsedMsAtNote === "number";
  if (isActive) {
    const typeLabel = note.fastContext?.fastTypeLabel || "fast";
    const elapsedLabel = hasElapsed ? ` • ${formatElapsedShort(elapsedMsAtNote)} in` : "";
    badge.textContent = `Active ${typeLabel}${elapsedLabel}`;
  } else {
    badge.textContent = "No active fast";
    badge.classList.add("is-muted");
  }

  meta.appendChild(date);
  meta.appendChild(badge);

  card.appendChild(text);
  card.appendChild(meta);
  return card;
}

function getNoteTimestampLabel(note) {
  const dateObj = parseDateKey(note.dateKey);
  if (dateObj) return dateObj.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return "Unknown date";
}

function renderRecentFasts() {
  const container = $("recent-fast-list");
  container.innerHTML = "";
  if (!state.history.length) {
    const p = document.createElement("p");
    p.className = "text-slate-400 text-sm md:text-xs";
    p.textContent = "No fasts logged yet.";
    container.appendChild(p);
    return;
  }

  state.history.slice(0, 10).forEach(e => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between bg-slate-900 rounded-xl px-3 py-3 md:py-2";

    const left = document.createElement("div");
    left.className = "flex flex-col text-sm md:text-[11px]";

    const type = getTypeById(e.typeId);
    const title = document.createElement("div");
    title.className = "text-slate-100";
    title.textContent = `${type ? type.label : "Custom"} • ${Number(e.durationHours).toFixed(1)}h`;

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
  applyThemeColors();
  renderSettings();
  updateTimer();
  renderCalendar();
  renderDayDetails();
  renderNotes();
  renderRecentFasts();
}

function resolveThemePresetId() {
  const themeState = state.settings.theme || {};
  if (themeState.presetId === "custom") return "custom";
  if (themeState.presetId && THEME_PRESETS[themeState.presetId]) return themeState.presetId;
  if (getLegacyThemeColors(themeState)) return "custom";
  return defaultState.settings.theme.presetId;
}

function getLegacyThemeColors(themeState) {
  const legacyKeys = [
    "primaryColor",
    "secondaryColor",
    "backgroundColor",
    "surfaceColor",
    "surfaceMutedColor",
    "borderColor",
    "textColor",
    "textMutedColor",
    "dangerColor"
  ];
  const hasLegacy = legacyKeys.some(key => themeState?.[key]);
  if (!hasLegacy) return null;
  return legacyKeys.reduce((acc, key) => {
    if (themeState?.[key]) acc[key] = themeState[key];
    return acc;
  }, {});
}

function getCustomThemeColors() {
  const themeState = state.settings.theme || {};
  const legacyColors = getLegacyThemeColors(themeState);
  const customColors = themeState.customColors || legacyColors || {};
  return Object.assign({}, defaultState.settings.theme.customColors, customColors);
}

function setCustomThemeColor(key, value) {
  if (!state.settings.theme) state.settings.theme = {};
  state.settings.theme.presetId = "custom";
  state.settings.theme.customColors = Object.assign({}, getCustomThemeColors(), { [key]: value });
}

function setThemePreset(presetId) {
  if (!state.settings.theme) state.settings.theme = {};
  if (presetId === "custom") {
    state.settings.theme.presetId = "custom";
    state.settings.theme.customColors = getCustomThemeColors();
    return;
  }
  state.settings.theme.presetId = THEME_PRESETS[presetId] ? presetId : defaultState.settings.theme.presetId;
}

function applyThemeColors() {
  const theme = getThemeSettings();
  const root = document.documentElement;
  root.style.setProperty("--primary-color", theme.primaryColor);
  root.style.setProperty("--secondary-color", theme.secondaryColor);
  root.style.setProperty("--background-color", theme.backgroundColor);
  root.style.setProperty("--surface-color", theme.surfaceColor);
  root.style.setProperty("--surface-muted-color", theme.surfaceMutedColor);
  root.style.setProperty("--border-color", theme.borderColor);
  root.style.setProperty("--text-color", theme.textColor);
  root.style.setProperty("--text-muted-color", theme.textMutedColor);
  root.style.setProperty("--danger-color", theme.dangerColor);
  const meta = document.querySelector("meta[name='theme-color']");
  if (meta) meta.setAttribute("content", theme.backgroundColor);
}

function getThemeSettings() {
  const presetId = resolveThemePresetId();
  if (presetId !== "custom" && THEME_PRESETS[presetId]) {
    return Object.assign({}, THEME_PRESETS[presetId].colors);
  }
  return getCustomThemeColors();
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
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function formatElapsedShort(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
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

function parseDateKey(dateKey) {
  if (!dateKey) return null;
  const parts = dateKey.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try { swReg = await navigator.serviceWorker.register("./sw.js"); } catch {}
}
