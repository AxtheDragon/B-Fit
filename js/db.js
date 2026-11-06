/*
 * IndexedDB storage. Everything the app knows lives here, on the device.
 *
 * Object stores:
 *   muscleGroups  { id, name, category: 'upper'|'lower'|'core', builtin? }
 *   exercises     { id, name, type: 'strength'|'cardio', muscleGroupIds: [id] }
 *   sessions      { id, date: 'YYYY-MM-DD', time: 'HH:MM'|null, location, note, entries: [Entry], createdAt, updatedAt }
 *                 Entry (strength) = { exerciseId, type: 'strength', sets: [{ weight: number|null, reps: number }], note? }
 *                 Entry (cardio)   = { exerciseId, type: 'cardio', duration, intensity, distance, laps, note? }
 *                                    (all four cardio numbers are optional / null)
 *                 Both entry types may have `warmup: true` (since v1.4.1).
 *                                    (distance in metres)
 *   time, location and the entry notes were added in v1.1; older records simply lack them.
 *   meta          { key, value }  – the autosaved draft (key 'draft') and settings (e.g. 'activityColors')
 *
 * A copy of the data stores is also kept in localStorage (see "Local safety copy").
 */
import { sortSessionsDesc } from './util.js';
import { APP_VERSION } from './version.js';

const DB_NAME = 'bfit';
const DB_VERSION = 1;
const DATA_STORES = ['muscleGroups', 'exercises', 'sessions'];

/** Preloaded muscle groups, in display order. */
const DEFAULT_MUSCLE_GROUPS = [
  ['Chest', 'upper'], ['Back', 'upper'], ['Shoulders', 'upper'], ['Biceps', 'upper'], ['Triceps', 'upper'],
  ['Legs', 'lower'], ['Glutes', 'lower'],
  ['Abs', 'core'], ['Lower back', 'core'],
];

/** Preloaded exercises. */
const DEFAULT_EXERCISES = [
  { name: 'Bike', type: 'cardio', muscleGroupIds: [] },
  { name: 'Treadmill', type: 'cardio', muscleGroupIds: [] },
];

let dbPromise = null;

/** Set when the database had to be created again and was refilled from the local copy. */
let restoredFrom = null;
/** Info about a restore from the local safety copy at start-up, or null. */
export const getRestoreInfo = () => restoredFrom;

/**
 * Open (and on first run create + seed) the database.
 *
 * The connection is reused. If the browser closes it (site data cleared,
 * storage error, another tab upgrading), the next call opens a new one
 * instead of failing with "The database connection is closing".
 *
 * If the database had to be created from scratch although a local safety
 * copy exists (see "Local safety copy" below), it is refilled from that copy
 * before anyone can use it.
 */
export function openDB() {
  if (dbPromise) return dbPromise;
  const promise = new Promise((resolve, reject) => {
    let created = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (event.oldVersion < 1) {
        created = true;
        db.createObjectStore('muscleGroups', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        sessions.createIndex('date', 'date');
        db.createObjectStore('meta', { keyPath: 'key' });

        // Seed data
        const mg = tx.objectStore('muscleGroups');
        DEFAULT_MUSCLE_GROUPS.forEach(([name, category]) => mg.add({ name, category, builtin: true }));
        const ex = tx.objectStore('exercises');
        DEFAULT_EXERCISES.forEach((e) => ex.add(e));
      }
    };

    request.onsuccess = async () => {
      const db = request.result;
      const forget = () => { if (dbPromise === promise) dbPromise = null; };
      db.onclose = forget; // closed by the browser
      db.onversionchange = () => { db.close(); forget(); }; // another tab wants to upgrade
      // Only a database that was just created can need a restore. In every other
      // case, bring the copy up to date (this also creates it after updating to 1.5).
      const mirror = created ? readMirror() : null;
      if (mirror) {
        try {
          await replaceAll(db, mirror, readDraftCopy());
          restoredFrom = { sessions: mirror.sessions.length, savedAt: mirror.mirroredAt || null };
          if (isMirrorFrozen()) unfreezeMirror(); // an earlier failed copy is restored now
        } catch (err) {
          // Never let the empty database overwrite the copy: the copy is frozen
          // until the user has downloaded and imported it, or discarded it (Settings).
          console.error('Restoring the local copy failed', err);
          freezeMirror();
          restoredFrom = { failed: true, sessions: mirror.sessions.length, savedAt: mirror.mirroredAt || null };
        }
      }
      resolve(db);
      if (!mirror) writeMirror();
    };
    request.onerror = () => { if (dbPromise === promise) dbPromise = null; reject(request.error); };
    request.onblocked = () => console.warn('Database upgrade blocked by another open tab');
  });
  dbPromise = promise;
  return promise;
}

/**
 * Start a transaction. If the cached connection was closed in the meantime
 * (InvalidStateError), open a new connection and try once more.
 */
async function transaction(storeNames, mode) {
  const db = await openDB();
  try {
    return db.transaction(storeNames, mode);
  } catch (err) {
    if (err.name !== 'InvalidStateError') throw err;
    if (dbPromise && (await dbPromise) === db) dbPromise = null;
    return (await openDB()).transaction(storeNames, mode);
  }
}

/** Writes to these stores / meta keys change data that the local copy holds. */
const isMirrored = (storeName, record) => DATA_STORES.includes(storeName)
  || (storeName === 'meta' && record && BACKUP_SETTINGS.includes(record.key));

/**
 * Run `fn(store)` in a transaction and resolve with the result of the
 * request it returns, once the transaction has committed.
 */
async function run(storeName, mode, fn, mirrored = mode === 'readwrite' && DATA_STORES.includes(storeName)) {
  const tx = await transaction(storeName, mode);
  return new Promise((resolve, reject) => {
    const request = fn(tx.objectStore(storeName));
    tx.oncomplete = () => {
      if (mirrored) { dataVersion++; writeMirror(); }
      if (mode === 'readwrite' && storeName === 'sessions') discardUndo(); // undo would lose this change
      resolve(request ? request.result : undefined);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Counts changes to backed-up data, so a prepared backup file can tell if it is outdated. */
let dataVersion = 0;
export const getDataVersion = () => dataVersion;

/* ---------- Generic CRUD ---------- */

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const remove = (store, id) => run(store, 'readwrite', (s) => s.delete(id));

/** Insert or update a record; resolves with its id. */
export function put(store, record) {
  const copy = { ...record };
  if (copy.id == null) delete copy.id; // let IndexedDB assign a new id
  return run(store, 'readwrite', (s) => s.put(copy));
}

/* ---------- Domain helpers ---------- */

/** All sessions, newest first. */
export async function getSessions() {
  return sortSessionsDesc(await getAll('sessions'));
}

/** Find an exercise by name, ignoring case and surrounding spaces. */
export async function findExerciseByName(name) {
  const key = name.trim().toLowerCase();
  return (await getAll('exercises')).find((e) => e.name.toLowerCase() === key) || null;
}

/**
 * The most recent entry for an exercise ("what did I do last time?").
 * Resolves with { entry, session } or null.
 * `excludeSessionId` skips the session currently being edited.
 */
export async function getLastEntry(exerciseId, excludeSessionId = null) {
  for (const session of await getSessions()) {
    if (session.id === excludeSessionId) continue;
    const entry = session.entries.find((e) => e.exerciseId === exerciseId);
    if (entry) return { entry, session };
  }
  return null;
}

/* ---------- Small key/value settings (meta store) ---------- */

export async function getMeta(key) {
  const row = await get('meta', key);
  return row ? row.value : undefined;
}
export const setMeta = (key, value) => run('meta', 'readwrite', (s) => s.put({ key, value }), isMirrored('meta', { key }));

/** Settings that are part of a backup (meta keys). */
const BACKUP_SETTINGS = ['activityColors'];

/* ---------- Draft (unsaved session form) ---------- */

export async function getDraft() {
  const row = await get('meta', 'draft');
  return row ? row.value : null;
}
export function saveDraft(draft) {
  writeDraftCopy(draft); // small, so it is copied right away instead of with the local copy
  return run('meta', 'readwrite', (s) => s.put({ key: 'draft', value: draft }));
}
export function clearDraft() {
  writeDraftCopy(null);
  return remove('meta', 'draft');
}

/* ---------- Backup: export / import ---------- */

/** Everything as one plain object, ready for JSON.stringify. */
export async function exportAll() {
  // One read-only transaction, so the stores are read as one consistent snapshot.
  const tx = await transaction([...DATA_STORES, 'meta'], 'readonly');
  const requests = {};
  for (const storeName of DATA_STORES) requests[storeName] = tx.objectStore(storeName).getAll();
  const settingRequests = BACKUP_SETTINGS.map((key) => [key, tx.objectStore('meta').get(key)]);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return {
    app: 'B-Fit',
    format: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    muscleGroups: requests.muscleGroups.result,
    exercises: requests.exercises.result,
    sessions: requests.sessions.result,
    // Since v1.4; older backups simply have no settings.
    settings: Object.fromEntries(settingRequests.map(([key, req]) => [key, req.result ? req.result.value : null])),
  };
}

/**
 * Replace all data with the contents of a backup file.
 * Throws a readable error if the file isn't a valid B-Fit backup; nothing is
 * changed then. The data from before is kept for "Undo last import"; resolves
 * with { undoSaved } (false if there was no room for it in localStorage).
 */
export async function importAll(data) {
  const problems = validateBackup(data);
  if (problems.length) {
    throw new Error(`This file is not a valid B-Fit backup:\n• ${problems.join('\n• ')}\n\nNothing was changed.`);
  }
  const undoSaved = saveUndo(await exportAll());
  await replaceAll(await openDB(), data);
  dataVersion++;
  if (isMirrorFrozen()) unfreezeMirror(); // the data is back (or deliberately replaced)
  else writeMirror();
  return { undoSaved };
}

/* ---------- Backup validation ---------- */

const isId = (v) => Number.isInteger(v) && v > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isOptNum = (v) => v == null || isNum(v);
const isOptStr = (v) => v == null || typeof v === 'string';
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Check a backup record by record, before anything is written. Returns a
 * list of problems (at most a few, in plain words); empty means it is valid.
 * Accepts every format B-Fit has written since version 1.0.
 */
export function validateBackup(data) {
  if (!isBackup(data)) return ['It does not contain B-Fit data (sessions, exercises and muscle groups).'];
  const problems = [];
  const report = (msg) => { if (problems.length < 5) problems.push(msg); };

  const checkIds = (list, label) => {
    const seen = new Set();
    list.forEach((r, i) => {
      if (!isObj(r) || !isId(r.id)) report(`${label} no. ${i + 1} has no valid id.`);
      else if (seen.has(r.id)) report(`${label} id ${r.id} appears twice.`);
      else seen.add(r.id);
    });
    return seen;
  };
  const groupIds = checkIds(data.muscleGroups, 'Muscle group');
  const exerciseIds = checkIds(data.exercises, 'Exercise');
  checkIds(data.sessions, 'Session');

  for (const g of data.muscleGroups.filter(isObj)) {
    if (typeof g.name !== 'string' || !g.name.trim()) report(`Muscle group ${g.id} has no name.`);
    if (!['upper', 'lower', 'core'].includes(g.category)) report(`Muscle group “${g.name}” has an unknown category.`);
  }
  for (const e of data.exercises.filter(isObj)) {
    if (typeof e.name !== 'string' || !e.name.trim()) report(`Exercise ${e.id} has no name.`);
    if (!['strength', 'cardio'].includes(e.type)) report(`Exercise “${e.name}” has an unknown type.`);
    if (!Array.isArray(e.muscleGroupIds) || !e.muscleGroupIds.every((id) => groupIds.has(id))) {
      report(`Exercise “${e.name}” refers to a muscle group that is missing.`);
    }
  }
  for (const s of data.sessions.filter(isObj)) {
    const label = `Session ${typeof s.date === 'string' ? s.date : s.id}`;
    if (typeof s.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) report(`${label} has no valid date.`);
    if (!isOptStr(s.time) || !isOptStr(s.location) || !isOptStr(s.note)) report(`${label} has an invalid time, location or note.`);
    if (!Array.isArray(s.entries)) { report(`${label} has no exercise list.`); continue; }
    for (const entry of s.entries) {
      if (!isObj(entry) || !exerciseIds.has(entry.exerciseId)) { report(`${label} contains an exercise that is missing.`); continue; }
      if (!isOptStr(entry.note)) report(`${label} has an invalid exercise note.`);
      if (entry.type === 'strength') {
        if (!Array.isArray(entry.sets) || !entry.sets.every((set) => isObj(set) && isOptNum(set.weight) && isOptNum(set.reps))) {
          report(`${label} has invalid sets.`);
        }
      } else if (entry.type === 'cardio') {
        if (!['duration', 'intensity', 'distance', 'laps'].every((k) => isOptNum(entry[k]))) report(`${label} has invalid cardio values.`);
      } else {
        report(`${label} contains an exercise of unknown type.`);
      }
    }
  }
  if (data.settings != null && !isObj(data.settings)) report('The settings part is invalid.');
  return problems;
}

/* ---------- Undo last import ---------- */
/*
 * Before an import replaces everything, the data from before is kept in
 * localStorage. It can be put back until a session is recorded, changed or
 * deleted (after that, undoing would lose that change).
 */
const UNDO_KEY = 'bfit-undo-import';

function saveUndo(data) {
  try {
    localStorage.setItem(UNDO_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data }));
    return true;
  } catch (err) {
    console.warn('No room to keep the data for undo', err);
    discardUndo();
    return false;
  }
}

function discardUndo() {
  try { localStorage.removeItem(UNDO_KEY); } catch { /* storage unavailable */ }
}

/** { savedAt, sessions } of the data an undo would bring back, or null. */
export function getUndoInfo() {
  try {
    const undo = JSON.parse(localStorage.getItem(UNDO_KEY));
    return undo && isBackup(undo.data) ? { savedAt: undo.savedAt, sessions: undo.data.sessions.length } : null;
  } catch {
    return null;
  }
}

/** Put back the data from before the last import. */
export async function undoImport() {
  const undo = JSON.parse(localStorage.getItem(UNDO_KEY));
  if (!undo || !isBackup(undo.data)) throw new Error('There is nothing to undo.');
  // The saved data may lack settings keys that the import added: put them back as "not set".
  const data = { ...undo.data, settings: { ...Object.fromEntries(BACKUP_SETTINGS.map((k) => [k, null])), ...undo.data.settings } };
  await replaceAll(await openDB(), data);
  dataVersion++;
  discardUndo();
  if (isMirrorFrozen()) unfreezeMirror();
  else writeMirror();
}

const isBackup = (data) => !!data && data.app === 'B-Fit' && DATA_STORES.every((s) => Array.isArray(data[s]));

/**
 * Replace all data stores (and backed-up settings) in one transaction.
 * `draft` (optional) is also stored, as the autosaved session form.
 */
function replaceAll(db, data, draft = null) {
  return new Promise((resolve, reject) => {
    // One transaction: either everything is replaced, or nothing changes.
    const tx = db.transaction([...DATA_STORES, 'meta'], 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Import failed'));
    try {
      for (const storeName of DATA_STORES) {
        const store = tx.objectStore(storeName);
        store.clear();
        data[storeName].forEach((record) => store.put(record));
      }
      // Settings from the backup, if it has them (otherwise the current ones stay).
      for (const key of BACKUP_SETTINGS) {
        if (data.settings && key in data.settings) {
          if (data.settings[key] == null) tx.objectStore('meta').delete(key);
          else tx.objectStore('meta').put({ key, value: data.settings[key] });
        }
      }
      if (draft) tx.objectStore('meta').put({ key: 'draft', value: draft });
    } catch (err) {
      // A record IndexedDB refuses (e.g. an invalid id) throws here. Without the
      // abort, the records written so far would still be committed.
      tx.onabort = () => reject(err);
      tx.abort();
    }
  });
}

/* ---------- Local safety copy ---------- */
/*
 * After every change, the same data a backup contains is also written to
 * localStorage. Chrome keeps localStorage in separate files from IndexedDB,
 * so if the browser throws the IndexedDB database away (for example because
 * it considers it damaged), the copy usually survives, and openDB() refills
 * the new, empty database from it. It does NOT survive clearing the site's
 * data – that is what exported backups are for.
 */
const MIRROR_KEY = 'bfit-mirror';
/** Set while the copy holds data that could not be restored; it must not be overwritten then. */
const FROZEN_KEY = 'bfit-mirror-frozen';
/** The autosaved session form, kept separately because it changes on every keystroke. */
const DRAFT_KEY = 'bfit-draft-copy';

let mirrorRunning = false;
let mirrorDirty = false;
let frozen = false;

/**
 * Write the local copy soon. Several changes in a row are written once, and
 * writes never overlap, so an older snapshot can't overwrite a newer one.
 */
function writeMirror() {
  mirrorDirty = true;
  if (mirrorRunning) return; // the running loop picks the change up
  mirrorRunning = true;
  setTimeout(async () => {
    while (mirrorDirty) {
      mirrorDirty = false;
      if (isMirrorFrozen()) break;
      try {
        const data = await exportAll();
        localStorage.setItem(MIRROR_KEY, JSON.stringify({ ...data, mirroredAt: data.exportedAt }));
      } catch (err) {
        console.warn('Could not update the local copy', err);
      }
    }
    mirrorRunning = false;
  }, 0);
}

/** The local copy, or null if there is none (or it is unreadable). */
export function readMirror() {
  try {
    const data = JSON.parse(localStorage.getItem(MIRROR_KEY));
    return isBackup(data) ? data : null;
  } catch {
    return null;
  }
}

/** Is the copy frozen because it could not be restored? */
export function isMirrorFrozen() {
  if (frozen) return true;
  try {
    return localStorage.getItem(FROZEN_KEY) === '1';
  } catch {
    return false;
  }
}

function freezeMirror() {
  frozen = true;
  try {
    localStorage.setItem(FROZEN_KEY, '1');
  } catch (err) {
    console.warn('Could not mark the local copy as frozen', err);
  }
}

/** Let the copy follow the database again (after the user imported or discarded it). */
export function unfreezeMirror() {
  frozen = false;
  try {
    localStorage.removeItem(FROZEN_KEY);
  } catch { /* nothing to undo */ }
  writeMirror();
}

function writeDraftCopy(draft) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch (err) {
    console.warn('Could not copy the draft', err);
  }
}

function readDraftCopy() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}
