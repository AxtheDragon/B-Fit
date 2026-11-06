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
      try {
        const mirror = created ? readMirror() : null;
        if (mirror) {
          await replaceAll(db, mirror);
          restoredFrom = { sessions: mirror.sessions.length, savedAt: mirror.mirroredAt || null };
        }
      } catch (err) {
        console.error('Restoring the local copy failed', err);
      }
      resolve(db);
      if (!created || !restoredFrom) writeMirror(); // keep the copy current (also creates it for existing users)
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
      if (mirrored) writeMirror();
      resolve(request ? request.result : undefined);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

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
export const saveDraft = (draft) => run('meta', 'readwrite', (s) => s.put({ key: 'draft', value: draft }));
export const clearDraft = () => remove('meta', 'draft');

/* ---------- Backup: export / import ---------- */

/** Everything as one plain object, ready for JSON.stringify. */
export async function exportAll() {
  return {
    app: 'B-Fit',
    format: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    muscleGroups: await getAll('muscleGroups'),
    exercises: await getAll('exercises'),
    sessions: await getAll('sessions'),
    // Since v1.4; older backups simply have no settings.
    settings: Object.fromEntries(await Promise.all(BACKUP_SETTINGS.map(async (key) => [key, await getMeta(key) ?? null]))),
  };
}

/**
 * Replace all data with the contents of a backup file.
 * Throws a readable error if the file doesn't look like a B-Fit backup.
 */
export async function importAll(data) {
  if (!isBackup(data)) throw new Error('This file is not a B-Fit backup.');
  await replaceAll(await openDB(), data);
  writeMirror();
}

const isBackup = (data) => !!data && data.app === 'B-Fit' && DATA_STORES.every((s) => Array.isArray(data[s]));

/** Replace all data stores (and backed-up settings) in one transaction. */
function replaceAll(db, data) {
  return new Promise((resolve, reject) => {
    // One transaction: either everything is replaced, or nothing changes.
    const tx = db.transaction([...DATA_STORES, 'meta'], 'readwrite');
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
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Import failed'));
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
let mirrorQueued = false;

/** Write the local copy soon (several changes in a row are written once). */
function writeMirror() {
  if (mirrorQueued) return;
  mirrorQueued = true;
  setTimeout(async () => {
    mirrorQueued = false;
    try {
      const data = await exportAll();
      localStorage.setItem(MIRROR_KEY, JSON.stringify({ ...data, mirroredAt: data.exportedAt }));
    } catch (err) {
      console.warn('Could not update the local copy', err);
    }
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
