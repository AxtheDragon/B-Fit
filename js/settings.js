/*
 * Settings screen: backup (export / import JSON), muscle groups,
 * activity graph colours, storage info, version.
 */
import { getAll, remove, exportAll, importAll } from './db.js';
import { h, add, setChildren, todayISO, toast, CATEGORIES } from './util.js';
import { customGroupForm } from './record.js';
import { APP_VERSION } from './version.js';
import { ACTIVITY_CATEGORIES, getCustomColors, saveColors, currentColor, loadColors } from './colors.js';

export async function render(container) {
  const [groups, exercises, sessions, customColors] = await Promise.all([
    getAll('muscleGroups'), getAll('exercises'), getAll('sessions'), getCustomColors()]);

  /* ----- Export: download everything as one JSON file ----- */
  const exportData = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `b-fit-backup-${todayISO()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Backup downloaded');
  };

  /* ----- Import: replace everything with a backup file ----- */
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const n = Array.isArray(data.sessions) ? data.sessions.length : 0;
      if (!confirm(`Import this backup with ${n} session${n === 1 ? '' : 's'}?\n\nAll data currently in the app will be replaced.`)) return;
      await importAll(data);
      await loadColors(); // the backup may contain custom activity colours
      toast('Backup imported');
      window.dispatchEvent(new HashChangeEvent('hashchange')); // refresh counts
    } catch (err) {
      alert(`Import failed: ${err instanceof SyntaxError ? 'the file is not valid JSON.' : err.message}`);
    }
  });

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

  /* ----- Storage info ----- */
  const storageInfo = h('p', { class: 'muted small' }, '');
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((p) => {
      storageInfo.textContent = p
        ? 'Storage is persistent: the browser will not clear your data automatically.'
        : 'Storage is not marked persistent yet. Installing the app usually fixes this. Export a backup regularly.';
    });
  }

  add(container,
    h('h1', {}, 'Settings'),

    h('section', { class: 'card stack' },
      h('h3', {}, 'Backup'),
      h('p', { class: 'muted small' },
        `All data is stored only on this device: ${sessions.length} sessions, ${exercises.length} exercises. ` +
        'Export a backup from time to time. Browser storage can be cleared, for example when you uninstall the app.'),
      h('button', { class: 'btn btn-primary btn-block', onclick: exportData }, 'Export data (JSON)'),
      h('button', { class: 'btn btn-block', onclick: () => fileInput.click() }, 'Import backup…'),
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
