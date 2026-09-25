/*
 * IndexedDB storage. Everything the app knows lives here, on the device.
 *
 * Object stores:
 *   muscleGroups  { id, name, category: 'upper'|'lower'|'core', builtin? }
 *   exercises     { id, name, type: 'strength'|'cardio', muscleGroupIds: [id] }
 *   sessions      { id, date: 'YYYY-MM-DD', note, entries: [Entry], createdAt, updatedAt }
 *                 Entry (strength) = { exerciseId, type: 'strength', sets: [{ weight: number|null, reps: number }] }
 *                 Entry (cardio)   = { exerciseId, type: 'cardio', duration: number, intensity: number|null }
 *   meta          { key, value }  – currently only the autosaved draft (key 'draft')
 */
import { sortSessionsDesc } from './util.js';

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

/** Open (and on first run create + seed) the database. */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (event.oldVersion < 1) {
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

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/**
 * Run `fn(store)` in a transaction and resolve with the result of the
 * request it returns, once the transaction has committed.
 */
async function run(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
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
    exportedAt: new Date().toISOString(),
    muscleGroups: await getAll('muscleGroups'),
    exercises: await getAll('exercises'),
    sessions: await getAll('sessions'),
  };
}

/**
 * Replace all data with the contents of a backup file.
 * Throws a readable error if the file doesn't look like a B-Fit backup.
 */
export async function importAll(data) {
  if (!data || data.app !== 'B-Fit' || !DATA_STORES.every((s) => Array.isArray(data[s]))) {
    throw new Error('This file is not a B-Fit backup.');
  }
  const db = await openDB();
  await new Promise((resolve, reject) => {
    // One transaction: either everything is replaced, or nothing changes.
    const tx = db.transaction(DATA_STORES, 'readwrite');
    for (const storeName of DATA_STORES) {
      const store = tx.objectStore(storeName);
      store.clear();
      data[storeName].forEach((record) => store.put(record));
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Import failed'));
  });
}
