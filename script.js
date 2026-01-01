import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-analytics.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
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

const FAST_TYPES = [
  {
    id: "8",
    label: "8h",
    durationHours: 8,
    bullets: [
      "1h after eating: Rest-and-digest mode is active while the stomach and pancreas secrete enzymes.",
      "2h after eating: Glucose absorption peaks; insulin guides nutrients into muscle and liver glycogen.",
      "4h after eating: Post-absorptive phase; gastric emptying is mostly complete and insulin is falling.",
      "8h after eating: Lower insulin allows more fat release for fuel as the overnight fast settles in.",
      "Timing varies with meal size, sleep, and activity."
    ]
  },
  {
    id: "12_12",
    label: "12h",
    durationHours: 12,
    bullets: [
      "1h after eating: Rest-and-digest signaling supports active digestion and nutrient breakdown.",
      "2h after eating: Blood glucose is still rising; insulin helps store glucose as glycogen.",
      "4h after eating: The gut starts its cleaning waves (migrating motor complex) as insulin drops.",
      "8h after eating: Glycogen release keeps blood sugar steady while fat use begins to rise.",
      "12h after eating: Fat oxidation increases; early ketones may appear for some people.",
      "Timing varies with meal size, sleep, and activity."
    ]
  },
  {
    id: "14_10",
    label: "14h",
    durationHours: 14,
    bullets: [
      "1h after eating: Digestive enzymes and bile are active under parasympathetic control.",
      "2h after eating: Nutrient absorption and insulin activity remain elevated.",
      "4h after eating: Post-absorptive phase; the gut begins cleaning cycles between meals.",
      "8h after eating: Insulin is lower; fat release for energy becomes more noticeable.",
      "12h after eating: Fat oxidation increases as liver glycogen declines.",
      "14h after eating: Low insulin supports more reliance on fat and stable morning energy.",
      "Timing varies with meal size, sleep, and activity."
    ]
  },
  {
    id: "16_8",
    label: "16:8",
    durationHours: 16,
    bullets: [
      "1h after eating: Rest-and-digest is dominant while the stomach breaks down food.",
      "2h after eating: Glucose uptake peaks; insulin promotes storage and replenishes glycogen.",
      "4h after eating: Post-absorptive phase; the gut’s cleaning cycles can resume.",
      "8h after eating: Lower insulin supports more fat release for fuel.",
      "12h after eating: Fat oxidation increases and ketones may begin to rise modestly.",
      "16h after eating: Liver glycogen is lower, supporting a deeper shift to fat-based fuel.",
      "Timing varies with meal size, sleep, and activity."
    ]
  },
  {
    id: "18_6",
    label: "18:6",
    durationHours: 18,
    bullets: [
      "1h after eating: Digestive enzymes and bile release are active in rest-and-digest mode.",
      "2h after eating: Glucose absorption is high; insulin supports storage in muscle and liver.",
      "4h after eating: Post-absorptive phase; migrating motor complex activity may start.",
      "8h after eating: Insulin is lower and fat use increases.",
      "12h after eating: Fat oxidation rises; ketones may begin to climb modestly.",
      "16h after eating: Liver glycogen is lower, supporting longer fat-based fueling.",
      "18h after eating: Many feel steadier energy and reduced snacking cues.",
      "Timing varies with meal size, sleep, and activity."
    ]
  },
  {
    id: "20_4",
    label: "20:4",
    durationHours: 20,
    bullets: [
      "1h after eating: Active digestion and enzyme secretion dominate.",
      "2h after eating: Glucose absorption and insulin remain elevated.",
      "4h after eating: Post-absorptive phase; gut motility shifts to cleaning cycles.",
      "8h after eating: Lower insulin supports more fat release for energy.",
      "12h after eating: Fat oxidation increases; ketone production can begin to rise.",
      "16h after eating: Glycogen stores are reduced; fat-based fuel is more prominent.",
      "20h after eating: Longer fasting window supports appetite discipline before refeed.",
      "Timing varies with meal size, sleep, and activity."
    ]
  },
  {
    id: "24",
    label: "24h",
    durationHours: 24,
    bullets: [
      "1h after eating: Rest-and-digest remains active as the stomach processes food.",
      "2h after eating: Nutrient absorption peaks; insulin supports storage.",
      "4h after eating: Post-absorptive phase; gut cleaning cycles resume.",
      "8h after eating: Insulin is lower; fat use continues to rise.",
      "12h after eating: Fat oxidation and ketones increase modestly.",
      "16h after eating: Liver glycogen is low; fat-based fueling is dominant.",
      "24h after eating: Longer fasts emphasize hydration and a gentle refeed.",
      "Timing varies with meal size, sleep, and activity."
    ]
  },
  {
    id: "36",
    label: "36h",
    durationHours: 36,
    bullets: [
      "1h after eating: Digestion is active and parasympathetic signaling is high.",
      "2h after eating: Glucose absorption peaks; insulin guides storage.",
      "4h after eating: Post-absorptive phase; gut cleaning cycles can resume.",
      "8h after eating: Lower insulin supports more fat release.",
      "12h after eating: Fat oxidation rises as glycogen declines.",
      "16h after eating: Deeper reliance on fat-based fuel.",
      "24h after eating: Hydration and electrolytes become more important.",
      "36h after eating: Longer fasts should be broken gently with easy-to-digest foods.",
      "Timing varies with meal size, sleep, and activity."
    ]
  }
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

const firebaseConfig = window.FIREBASE_CONFIG;
if (!firebaseConfig?.apiKey || !firebaseConfig?.authDomain || !firebaseConfig?.projectId || !firebaseConfig?.appId) {
  throw new Error("Missing Firebase configuration. Check firebase-config.js.");
}

const firebaseApp = initializeApp(firebaseConfig);
const analytics = firebaseConfig?.measurementId ? getAnalytics(firebaseApp) : null;
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let state = clone(defaultState);
let selectedFastTypeId = defaultState.settings.defaultFastTypeId || FAST_TYPES[0].id;
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
let notesLoaded = false;
let notes = [];
let noteEditorCloseTimeout = null;
let editingNoteId = null;
let editingNoteDateKey = null;
let editingNoteContext = null;
let editingNoteCreatedAt = null;
let editingNoteTimestamp = null;

let navHoldTimer = null;
let navHoldShown = false;
let suppressNavClickEl = null;

document.addEventListener("DOMContentLoaded", () => {
  initAuthUI();
  initAuthListener();
});

function $(id) { return document.getElementById(id); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

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
      if (err?.message === "missing-key") {
        throw err;
      }
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
  if (!fastContext || typeof fastContext !== "object") {
    return buildInactiveFastContext();
  }

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
  if (!state.activeFast) {
    return buildInactiveFastContext();
  }
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
  const payload = {
    updatedAt: Date.now()
  };
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
        if (value !== undefined) {
          payload[`fastContext.${key}`] = value;
        }
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
  editingNoteTimestamp = note?.updatedAt || note?.createdAt || null;

  $("note-editor-content").value = note?.text || "";
  updateNoteEditorMeta();
  $("note-editor-delete").classList.toggle("hidden", !editingNoteId);
  modal.classList.remove("hidden");
  requestAnimationFrame(() => modal.classList.add("is-open"));
}

function updateNoteEditorMeta() {
  const badge = $("note-editor-fast");
  const dateEl = $("note-editor-date");
  if (!badge || !dateEl) return;

  const dateObj = parseDateKey(editingNoteDateKey);
  const dateLabel = dateObj
    ? dateObj.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Unknown date";
  const timeLabel = editingNoteTimestamp ? formatTimeShort(new Date(editingNoteTimestamp)) : "";
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
  editingNoteTimestamp = null;
}

async function saveNoteEditor() {
  const text = $("note-editor-content").value.trim();
  if (!text) {
    showToast("Add a note before saving");
    return;
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
      return;
    }
  }
  renderNotes();
  closeNoteEditor();
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
  notesUnsubscribe = onSnapshot(getNotesCollectionRef(uid), async snap => {
    try {
      const normalized = await Promise.all(snap.docs.map(normalizeNoteSnapshot));
      notesLoaded = true;
      notes = normalized.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      renderNotes();
    } catch (err) {
      handleNotesDecryptError(err);
    }
  });
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
    if (!payload || !payload.iv || !payload.ciphertext || !cryptoKey) return;
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
  merged.settings = Object.assign(merged.settings, parsed.settings || {});
  merged.activeFast = parsed.activeFast || null;
  merged.history = Array.isArray(parsed.history) ? parsed.history : [];
  merged.reminders = Object.assign(merged.reminders, parsed.reminders || {});
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
  if (!payload?.iv || !payload?.ciphertext) {
    throw new Error("invalid-payload");
  }
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
  const message = err?.message === "missing-key"
    ? "missing-password"
    : err?.message;
  if (message === "missing-password" || message === "decrypt-failed") {
    cryptoKey = null;
    keySalt = null;
    showReauthPrompt("Please re-enter your password to decrypt your data.");
  }
}

async function resolveEncryptedPayload(uid) {
  try {
    const snap = await getDoc(getStateDocRef(uid));
    if (snap.exists()) {
      return snap.data()?.payload || null;
    }
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
    try {
      await setDoc(getUserDocRef(uid), { crypto: { salt: storedSalt } }, { merge: true });
    } catch {}
  }

  if (!storedSalt) {
    storedSalt = encodeBase64(crypto.getRandomValues(new Uint8Array(16)));
    try {
      await setDoc(getUserDocRef(uid), { crypto: { salt: storedSalt } }, { merge: true });
    } catch {}
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
        if (cachedKey) {
          cryptoKey = cachedKey;
        } else {
          throw new Error("missing-password");
        }
      }
    }
    return clone(defaultState);
  }

  if (!payload.iv || !payload.ciphertext) {
    throw new Error("invalid-payload");
  }

  if (!cryptoKey) {
    if (pendingPassword) {
      cryptoKey = await deriveKeyFromPassword(pendingPassword, keySalt);
      pendingPassword = null;
      if (authRememberChoice) await wrapEncryptionKeyForDevice(user.uid);
    } else {
      const cachedKey = await unwrapEncryptionKeyFromDevice(user.uid);
      if (cachedKey) {
        cryptoKey = cachedKey;
      } else {
        throw new Error("missing-password");
      }
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

  try {
    await setDoc(getStateDocRef(user.uid), { payload }, { merge: true });
  } catch {}

  setEncryptedCache(payload);
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
    }
  });
}

function initAuthUI() {
  const form = $("auth-form");
  const toggle = $("auth-toggle");

  form.addEventListener("submit", handleAuthSubmit);
  toggle.addEventListener("click", () => {
    authMode = authMode === "sign-in" ? "sign-up" : "sign-in";
    updateAuthMode();
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
}

function showReauthPrompt(message) {
  authMode = "sign-in";
  updateAuthMode();
  if (auth.currentUser?.email) {
    $("auth-email").value = auth.currentUser.email;
  }
  $("auth-password").value = "";
  const errorEl = $("auth-error");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
  needsUnlock = true;
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
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    pendingPassword = password;
    authRememberChoice = remember;
    if (auth.currentUser && !remember) {
      clearWrappedKeyStorage(auth.currentUser.uid);
    }
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
  await loadAppState();
  startStateListener(auth.currentUser.uid);
  startNotesListener(auth.currentUser.uid);
  if (!appInitialized) {
    initUI();
    startTick();
    registerServiceWorker();
    appInitialized = true;
  } else {
    renderAll();
  }
  needsUnlock = false;
  setAuthVisibility(true);
}

async function loadAppState() {
  state = await loadState();
  selectedFastTypeId = state.settings.defaultFastTypeId || FAST_TYPES[0].id;
  pendingTypeId = null;
  calendarMonth = startOfMonth(new Date());
  selectedDayKey = formatDateKey(new Date());
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
      switchTab(btn.dataset.tab);
    });
  });
  switchTab("timer");
}

function switchTab(tab) {
  ["timer", "history", "notes", "settings"].forEach(id => {
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
    renderNotes();
  }
  if (tab === "notes") renderNotes();
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
    btn.className = "w-[35px] h-[35px] flex items-center justify-center text-center leading-none whitespace-normal rounded-full border text-[11px] md:text-[10px] border-slate-700 text-slate-100 bg-slate-900/80";
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
      chip.classList.add("bg-brand-500", "text-slate-950", "border-brand-500");
      chip.classList.remove("bg-slate-900/80", "text-slate-100", "border-slate-700");
    } else {
      chip.classList.remove("bg-brand-500", "text-slate-950", "border-brand-500");
      chip.classList.add("bg-slate-900/80", "text-slate-100", "border-slate-700");
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
  $("start-fast-btn").addEventListener("click", startFast);
  $("stop-fast-btn").addEventListener("click", stopFastAndLog);

  $("alerts-btn").addEventListener("click", onAlertsButton);

  $("modal-close").addEventListener("click", closeFastTypeModal);
  $("modal-use-type").addEventListener("click", usePendingFastType);

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
  $("note-editor-close").addEventListener("click", closeNoteEditor);
  $("note-editor-save").addEventListener("click", saveNoteEditor);
  $("note-editor-delete").addEventListener("click", removeNote);

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
  const type = getTypeById(selectedFastTypeId);
  const now = Date.now();
  state.activeFast = {
    id: "fast_" + now,
    typeId: type.id,
    startTimestamp: now,
    plannedDurationHours: type.durationHours,
    endTimestamp: now + type.durationHours * 3600000,
    status: "active"
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

function updateTimer() {
  const ring = $("progress-ring");
  const main = $("timer-main");
  const mode = $("timer-mode");
  const sub = $("timer-sub");
  const header = $("header-subtitle");
  const status = $("timer-status");
  const typePill = $("timer-type");

  ring.setAttribute("stroke-dasharray", String(RING_CIRC));

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
    cell.className = "aspect-square rounded-xl flex flex-col items-center justify-center text-[12px] md:text-[11px]";

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
      dot.className = "w-2 h-2 md:w-1.5 md:h-1.5 rounded-full bg-brand-500 mb-0.5";
      cell.appendChild(dot);
    }

    const dspan = document.createElement("span");
    dspan.textContent = dayNum;
    cell.appendChild(dspan);

    if (hasFast) {
      const tiny = document.createElement("span");
      tiny.className = "mt-0.5 text-[10px] md:text-[9px] text-cyan-100";
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

  dayNotes.forEach(note => {
    const card = buildNoteCard(note);
    list.appendChild(card);
  });
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

  notes.forEach(note => {
    const card = buildNoteCard(note);
    list.appendChild(card);
  });
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
  if (dateObj) {
    return dateObj.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
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
  renderSettings();
  updateTimer();
  renderCalendar();
  renderDayDetails();
  renderNotes();
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
  if (hours <= 0) {
    return `${minutes}m`;
  }
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
