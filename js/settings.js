/*
 * Settings screen: backup (export / import JSON), muscle groups, storage info.
 */
import { getAll, remove, exportAll, importAll } from './db.js';
import { h, add, setChildren, todayISO, toast, CATEGORIES } from './util.js';
import { customGroupForm } from './record.js';

export async function render(container) {
  const [groups, exercises, sessions] = await Promise.all([getAll('muscleGroups'), getAll('exercises'), getAll('sessions')]);

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

    h('p', { class: 'muted small', style: 'margin-top:24px; text-align:center' }, 'B-Fit · works offline · no account, no tracking'),
  );
}
