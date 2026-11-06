/*
 * Settings screen: backup (export / import JSON), muscle groups,
 * activity graph colours, storage info, version.
 */
import { getAll, remove, importAll, validateBackup, getUndoInfo, undoImport, getDraft, readMirror, isMirrorFrozen, unfreezeMirror } from './db.js';
import { downloadBackup, shareBackup, canShareFiles, prepareShare, lastBackupText, sessionsSinceBackup, backupUnknown } from './backup.js';
import { h, add, setChildren, todayISO, toast, CATEGORIES } from './util.js';
import { customGroupForm } from './record.js';
import { APP_VERSION } from './version.js';
import { ACTIVITY_CATEGORIES, getCustomColors, saveColors, currentColor, loadColors } from './colors.js';

export async function render(container) {
  const [groups, exercises, sessions, customColors] = await Promise.all([
    getAll('muscleGroups'), getAll('exercises'), getAll('sessions'), getCustomColors()]);

  /* ----- Export: download or share everything as one JSON file ----- */
  const refresh = () => window.dispatchEvent(new HashChangeEvent('hashchange')); // re-render (counts, backup date)
  const exportData = async () => { await downloadBackup(); refresh(); };
  const shareData = async () => { if (await shareBackup()) refresh(); };
  if (canShareFiles()) prepareShare().catch((err) => console.warn('Could not prepare the backup', err));

  /** Import and undo discard the unsaved session on the Record screen: say so. */
  const unsavedNote = async () => {
    const draft = await getDraft();
    if (!draft) return '';
    if (draft.editingId != null) return '\nThe session you are editing on the Record screen will be closed without saving your changes.\n';
    return draft.entries?.length || (draft.note || '').trim()
      ? '\nThe unsaved session on the Record screen will be discarded.\n' : '';
  };

  /* ----- Import: replace everything with a backup file ----- */
  // .txt too: shared backups are .txt files (see backup.js). The content is
  // checked record by record before anything is replaced.
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json,text/plain,.txt', class: 'hidden' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      alert('Import failed: the file is not a B-Fit backup (it does not contain valid JSON).\n\nNothing was changed.');
      return;
    }
    const { errors, warnings } = validateBackup(data);
    if (errors.length) {
      alert(`Import failed: this file is not a valid B-Fit backup.\n• ${errors.join('\n• ')}\n\nNothing was changed.`);
      return;
    }
    const exported = Date.parse(data.exportedAt);
    const from = Number.isNaN(exported) ? 'Backup (date unknown)' : `Backup from ${new Date(exported).toLocaleString()}`;
    if (!confirm(`${from} with ${plural(data.sessions.length, 'session')}.\n` +
      `You currently have ${plural(sessions.length, 'session')}.\n` +
      (warnings.length ? `\nNote: ${warnings.join(' ')} Such entries are imported unchanged.\n` : '') +
      (await unsavedNote()) +
      '\nImport it? All data currently in the app will be replaced. You can undo this in Settings until you change anything.')) return;
    try {
      await importAll(data);
      await loadColors(); // the backup may contain custom activity colours
      toast('Backup imported');
      refresh();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });

  /* ----- Undo last import ----- */
  const undo = await getUndoInfo();
  const undoLast = async () => {
    if (!confirm(`Undo the last import? The data from before it (${plural(undo.sessions, 'session')}) comes back, ` +
      `and the imported data is replaced.\n${await unsavedNote()}`)) return;
    try {
      await undoImport();
      await loadColors();
      toast('Import undone');
      refresh();
    } catch (err) {
      alert(`Undo failed: ${err.message}`);
    }
  };
  const undoButton = undo && h('button', { class: 'btn btn-block', 'data-testid': 'undo-import', onclick: undoLast },
    `Undo last import (back to ${plural(undo.sessions, 'session')})`);

  /* ----- Muscle groups ----- */
  const usedGroupIds = new Set(exercises.flatMap((e) => e.muscleGroupIds));
  const groupList = Object.entries(CATEGORIES).map(([cat, label]) => h('div', {},
    h('div', { class: 'group-label' }, label),
    groups.filter((g) => g.category === cat).map((g) => h('div', { class: 'row', style: 'min-height:44px' },
      h('span', { class: 'spacer' }, g.name, g.builtin ? '' : h('span', { class: 'muted small' }, '  (custom)')),
      // Custom groups that no exercise uses can be deleted.
      !g.builtin && !usedGroupIds.has(g.id) && h('button', {
        class: 'icon-btn', 'aria-label': `Delete ${g.name}`,
        onclick: async () => {
          if (!confirm(`Delete muscle group “${g.name}”?`)) return;
          await remove('muscleGroups', g.id);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        },
      }, '×')))));

  /* ----- Activity graph colours ----- */
  const colors = { ...customColors };
  const colorRows = ACTIVITY_CATEGORIES.map(([key, label]) => h('label', { class: 'color-row' },
    h('span', { class: 'spacer' }, label),
    h('input', {
      type: 'color', value: currentColor(key), 'aria-label': `Colour for ${label}`,
      // Applied (and saved) live while picking
      oninput: (e) => { colors[key] = e.target.value; saveColors(colors); },
    })));
  const resetColors = async () => {
    await saveColors({});
    toast('Default colours restored');
    window.dispatchEvent(new HashChangeEvent('hashchange')); // refresh the pickers
  };
  // Preview: a day with all four categories, and one with two.
  const previewDay = (keys) => h('span', { class: 'day trained color-preview', style: keys.length >= 4 ? '--slices:2' : null },
    keys.map((key) => h('span', { class: `slice cat-${key}` })));

  /* ----- Storage health ----- */
  const unsaved = sessionsSinceBackup(sessions);
  const mirror = readMirror();

  // The safety copy could not be restored (see db.js): offer it as a file, so
  // it can be imported (here, or on another device) or handed on for repair.
  const frozen = mirror && isMirrorFrozen();
  const downloadCopy = () => {
    const blob = new Blob([JSON.stringify(mirror, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `b-fit-safety-copy-${todayISO()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const discardCopy = () => {
    if (!confirm('Discard the safety copy that could not be restored? Download it first if you might still need it.')) return;
    unfreezeMirror();
    toast('The safety copy follows the current data again');
    setTimeout(refresh, 100);
  };
  const frozenInfo = frozen && h('li', { 'data-testid': 'frozen-copy' },
    h('strong', {}, `Local safety copy: could not be restored (${mirror.sessions.length} sessions). `),
    'It is kept unchanged until you import it or discard it. New changes are not copied meanwhile. ',
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: downloadCopy }, 'Download safety copy'),
      h('button', { class: 'btn-ghost', onclick: discardCopy }, 'Discard')));
  const persistInfo = h('li', {}, 'Persistent storage: checking…');
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((p) => {
      persistInfo.textContent = p
        ? 'Persistent storage: yes. The browser will not clear the data to free up space.'
        : 'Persistent storage: no. The browser may clear the data when the phone runs low on space. Installing the app usually fixes this.';
    });
  } else {
    persistInfo.textContent = 'Persistent storage: not supported by this browser.';
  }
  const storageInfo = h('ul', { class: 'health-list muted small', 'data-testid': 'storage-health' },
    h('li', {}, `Last backup: ${lastBackupText(sessions)}`,
      unsaved && !backupUnknown(sessions) ? ` (${unsaved} newer session${unsaved === 1 ? '' : 's'} not in a backup)` : ''),
    frozen ? frozenInfo : h('li', {}, mirror
      ? `Local safety copy: up to date (${mirror.sessions.length} sessions). Restores the data automatically if the browser loses the database.`
      : 'Local safety copy: not available. Export a backup to be safe.'),
    persistInfo);

  add(container,
    h('h1', {}, 'Settings'),

    h('section', { class: 'card stack' },
      h('h3', {}, 'Backup'),
      h('p', { class: 'muted small' },
        `All data is stored only on this device: ${sessions.length} sessions, ${exercises.length} exercises. ` +
        'Export a backup from time to time and keep it somewhere else (Files, Drive, e-mail). ' +
        'Browser storage can be lost, for example when site data is cleared or the app is uninstalled.'),
      canShareFiles() && h('button', { class: 'btn btn-primary btn-block', onclick: shareData }, 'Share backup…'),
      h('button', { class: `btn btn-block${canShareFiles() ? '' : ' btn-primary'}`, onclick: exportData }, 'Export data (JSON)'),
      h('button', { class: 'btn btn-block', onclick: () => fileInput.click() }, 'Import backup…'),
      undoButton,
      fileInput,
      storageInfo),

    h('section', { class: 'card', style: 'margin-top:16px' },
      h('h3', {}, 'Muscle groups'),
      groupList,
      h('div', { class: 'group-label' }, 'Add custom muscle group'),
      customGroupForm(() => window.dispatchEvent(new HashChangeEvent('hashchange')))),

    h('section', { class: 'card', style: 'margin-top:16px' },
      h('div', { class: 'row' },
        h('h3', { class: 'spacer' }, 'Activity colours'),
        previewDay(['upper', 'lower', 'core', 'cardio']),
        previewDay(['upper', 'cardio'])),
      h('p', { class: 'muted small', style: 'margin:4px 0 8px' },
        'Colours of the categories in the Stats activity graph. The defaults are chosen to stay ' +
        'distinguishable with colour blindness and adapt to dark mode; custom colours are used in both modes.'),
      colorRows,
      h('button', { class: 'btn btn-block', style: 'margin-top:8px', onclick: resetColors }, 'Reset to default colours')),

    h('section', { class: 'card', style: 'margin-top:16px' },
      h('div', { class: 'row' },
        h('h3', { class: 'spacer' }, 'About'),
        h('span', { class: 'version-badge', 'data-testid': 'app-version' }, `Version ${APP_VERSION}`)),
      h('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'B-Fit · works offline · no account, no tracking')),
  );
}
