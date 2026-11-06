/*
 * Backups: download / share a backup file, remember when the last backup was
 * made, and nudge the user once enough new sessions are not in a backup yet.
 *
 * The backup state lives in localStorage (key 'bfit-backup'), not in
 * IndexedDB, so it is not lost together with the database:
 *   { at: ms timestamp of the last backup, snoozedAt: ms timestamp of the last "Later",
 *     trackedSince: ms timestamp from when on backups are recorded (first start with 1.5) }
 */
import { exportAll, getSessions, getDataVersion } from './db.js';
import { h, todayISO, toast, formatDate, toISODate } from './util.js';

/** Show the reminder once this many sessions are not in a backup. */
export const NUDGE_AFTER = 3;

const STATE_KEY = 'bfit-backup';

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...readState(), ...patch }));
  } catch (err) {
    console.warn('Could not save the backup state', err);
  }
}

// Backups made before version 1.5 were not recorded. Remember from when on they are.
if (!readState().trackedSince) writeState({ trackedSince: Date.now() });

/** Timestamp (ms) of the last backup, or null if there never was one. */
export const lastBackupAt = () => readState().at || null;

/** Sessions created after the last backup. */
export function sessionsSinceBackup(sessions) {
  const since = lastBackupAt() || 0;
  return sessions.filter((s) => (s.createdAt || 0) > since).length;
}

/** Should the backup reminder be shown? */
export function shouldNudge(sessions) {
  const { at = 0, snoozedAt = 0 } = readState();
  const since = Math.max(at, snoozedAt);
  return sessions.filter((s) => (s.createdAt || 0) > since).length >= NUDGE_AFTER;
}

/**
 * True if there is no backup recorded, but sessions from before backups were
 * recorded exist (they may well be in a backup made with an older version).
 */
export function backupUnknown(sessions) {
  if (lastBackupAt()) return false;
  const since = readState().trackedSince || Date.now();
  return sessions.some((s) => (s.createdAt || 0) < since);
}

const markBackedUp = () => writeState({ at: Date.now() });
const snooze = () => writeState({ snoozedAt: Date.now() });

async function backupFile() {
  const data = await exportAll();
  return new File([JSON.stringify(data, null, 2)], `b-fit-backup-${todayISO()}.json`, { type: 'application/json' });
}

/*
 * Sharing. Chrome on Android only shares certain file types (images, video,
 * audio, PDF, plain text, …) – a .json file is refused with "Permission
 * denied". So a shared backup is a .txt file (still JSON inside; Import
 * accepts it). Chrome also only allows sharing right after a tap, so the file
 * is prepared beforehand (prepareShare) and handed over without waiting.
 */
const shareName = () => `b-fit-backup-${todayISO()}.txt`;
let prepared = null; // { file, version }

/** Build the file to share now, so a later tap can share it immediately. */
export async function prepareShare() {
  const version = getDataVersion();
  const data = await exportAll();
  prepared = { file: new File([JSON.stringify(data, null, 2)], shareName(), { type: 'text/plain' }), version };
}

/** Can this browser share a backup file (e.g. to Files, Drive or e-mail)? */
export function canShareFiles() {
  try {
    const probe = new File(['{}'], shareName(), { type: 'text/plain' });
    return !!(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}

/** Download the backup file. Resolves with true. */
export async function downloadBackup() {
  const file = await backupFile();
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  markBackedUp();
  toast('Backup downloaded');
  return true;
}

/** Open the share sheet with the backup file. Resolves with true if it was shared. */
export async function shareBackup() {
  // Use the prepared file if the data hasn't changed since; otherwise build it
  // now (which may take too long for Chrome – then the download fallback runs).
  if (!prepared || prepared.version !== getDataVersion()) await prepareShare();
  const { file } = prepared;
  try {
    await navigator.share({ files: [file], title: 'B-Fit backup' });
  } catch (err) {
    if (err.name === 'AbortError') return false; // share sheet closed
    alert(`Sharing failed: ${err.message}\n\nThe backup is downloaded instead.`);
    return downloadBackup();
  }
  // The share only says an app was picked, not that the file was saved there.
  if (!confirm('Was the backup file saved (for example in Files or Drive)?')) return false;
  markBackedUp();
  toast('Backup saved');
  return true;
}

/** Share if the browser can, download otherwise. */
export const backupNow = () => (canShareFiles() ? shareBackup() : downloadBackup());

/** Date of the last backup as text, "not recorded" (see backupUnknown) or "never". */
export function lastBackupText(sessions) {
  const at = lastBackupAt();
  if (at) return formatDate(toISODate(new Date(at)));
  return backupUnknown(sessions) ? 'not recorded (B-Fit records backups since version 1.5)' : 'never';
}

/**
 * Reminder banner for the start screen, or null when none is due.
 * `onDone` is called after a backup or "Later", to hide it again.
 */
export async function nudgeBanner(onDone) {
  const sessions = await getSessions();
  if (!shouldNudge(sessions)) return null;
  const n = sessionsSinceBackup(sessions);
  if (canShareFiles()) prepareShare().catch((err) => console.warn('Could not prepare the backup', err));
  const headline = backupUnknown(sessions)
    ? `No backup recorded yet for your ${n} session${n === 1 ? '' : 's'}.`
    : `${n} session${n === 1 ? ' is' : 's are'} not in a backup yet.`;
  const banner = h('div', { class: 'backup-nudge', role: 'region', 'aria-label': 'Backup reminder' },
    h('p', {},
      h('strong', {}, headline),
      ' Your data is stored only on this phone. A backup file keeps it safe if the browser loses it.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', onclick: async () => { if (await backupNow()) { banner.remove(); onDone?.(); } } },
        canShareFiles() ? 'Share backup…' : 'Download backup'),
      h('button', { class: 'btn-ghost', onclick: () => { snooze(); banner.remove(); onDone?.(); } }, 'Later')));
  return banner;
}
