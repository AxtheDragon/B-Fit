/*
 * Backups: download / share a backup file, remember when the last backup was
 * made, and nudge the user once enough new sessions are not in a backup yet.
 *
 * The backup state lives in localStorage (key 'bfit-backup'), not in
 * IndexedDB, so it is not lost together with the database:
 *   { at: ms timestamp of the last backup, snoozedAt: ms timestamp of the last "Later" }
 */
import { exportAll, getSessions } from './db.js';
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

const markBackedUp = () => writeState({ at: Date.now() });
const snooze = () => writeState({ snoozedAt: Date.now() });

async function backupFile() {
  const data = await exportAll();
  return new File([JSON.stringify(data, null, 2)], `b-fit-backup-${todayISO()}.json`, { type: 'application/json' });
}

/** Can this browser share a file (e.g. to Files, Drive or e-mail)? */
export function canShareFiles() {
  try {
    const probe = new File(['{}'], 'b-fit-backup.json', { type: 'application/json' });
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
  const file = await backupFile();
  try {
    await navigator.share({ files: [file], title: 'B-Fit backup' });
  } catch (err) {
    if (err.name === 'AbortError') return false; // share sheet closed
    alert(`Sharing failed: ${err.message}\n\nThe backup is downloaded instead.`);
    return downloadBackup();
  }
  markBackedUp();
  toast('Backup shared');
  return true;
}

/** Share if the browser can, download otherwise. */
export const backupNow = () => (canShareFiles() ? shareBackup() : downloadBackup());

/** Date of the last backup as text, or "never". */
export function lastBackupText() {
  const at = lastBackupAt();
  return at ? formatDate(toISODate(new Date(at))) : 'never';
}

/**
 * Reminder banner for the start screen, or null when none is due.
 * `onDone` is called after a backup or "Later", to hide it again.
 */
export async function nudgeBanner(onDone) {
  const sessions = await getSessions();
  if (!shouldNudge(sessions)) return null;
  const n = sessionsSinceBackup(sessions);
  const banner = h('div', { class: 'backup-nudge', role: 'region', 'aria-label': 'Backup reminder' },
    h('p', {},
      h('strong', {}, `${n} session${n === 1 ? ' is' : 's are'} not in a backup yet.`),
      ' Your data is stored only on this phone. A backup file keeps it safe if the browser loses it.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', onclick: async () => { if (await backupNow()) { banner.remove(); onDone?.(); } } },
        canShareFiles() ? 'Share backup…' : 'Download backup'),
      h('button', { class: 'btn-ghost', onclick: () => { snooze(); banner.remove(); onDone?.(); } }, 'Later')));
  return banner;
}
