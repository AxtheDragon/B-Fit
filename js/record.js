/*
 * Record screen (the start screen): enter a session and save it.
 *
 * The form works on a "draft" object that is autosaved to IndexedDB on every
 * change, so nothing is lost when the app is closed. Numbers are kept as the
 * raw strings typed by the user while drafting and converted on save.
 *
 * Draft shape:
 *   { editingId: number|null, date: 'YYYY-MM-DD', time: 'HH:MM', location: '', note: '',
 *     entries: [ { exerciseId, type: 'strength', sets: [{ weight: '60', reps: '10' }], note, lastInfo }
 *              | { exerciseId, type: 'cardio', duration: '20', intensity: '8', distance: '', laps: '', note, lastInfo } ] }
 * (`lastInfo` and `showNote` only exist in the draft, they are not saved.)
 */
import { getAll, get, put, getSessions, getLastEntry, getDraft, saveDraft, clearDraft, findExerciseByName } from './db.js';
import { h, setChildren, todayISO, nowTime, formatDate, toNumber, numToStr, entrySummary, byId, toast, CATEGORIES } from './util.js';

let draft = null;          // the form state
let exercisesById = new Map();
let muscleGroupsById = new Map();
let pastLocations = [];   // suggestions for the location field
let root = null;           // element the screen renders into
let saveTimer = null;

/* ---------- Draft persistence ---------- */

function newDraft() {
  return { editingId: null, date: todayISO(), time: nowTime(), location: '', note: '', entries: [] };
}

function hasContent(d) {
  return !!(d && (d.entries.length || d.note.trim() || d.editingId));
}

/** Call after every change: saves the draft shortly after typing stops. */
function changed() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

/** Write the draft to storage right now. */
async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (draft) await saveDraft(draft);
}

// Save immediately when the app goes to the background or is closed.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);

/** Called by the router when navigating away from this screen. */
export async function leave() {
  await flush();
  draft = null; // other screens may change the stored draft (e.g. "Edit session")
}

/** Cardio fields: [key, label, unit, inputmode]. All of them are optional. */
const CARDIO_FIELDS = [
  ['duration', 'Duration', 'min', 'decimal'],
  ['intensity', 'Intensity level', 'lvl', 'decimal'],
  ['distance', 'Distance', 'km', 'decimal'],
  ['laps', 'No. of laps', 'laps', 'numeric'],
];

/**
 * Convert a saved session entry into a draft entry (numbers -> strings).
 * `withNote` is false when prefilling from last time: notes are not copied.
 */
function toDraftEntry(entry, withNote = true) {
  const base = { exerciseId: entry.exerciseId, type: entry.type, note: withNote ? entry.note || '' : '' };
  if (entry.type === 'cardio') {
    for (const [key] of CARDIO_FIELDS) base[key] = numToStr(entry[key]);
    return base;
  }
  base.sets = entry.sets.map((s) => ({ weight: numToStr(s.weight), reps: numToStr(s.reps) }));
  return base;
}

/**
 * Load an existing session into the form for editing (used by History).
 * Asks before throwing away another unsaved session.
 */
export async function editSession(session) {
  const current = await getDraft();
  if (hasContent(current) && current.editingId !== session.id &&
      !confirm('You have an unsaved session in the Record screen. Discard it and edit this one?')) {
    return;
  }
  await saveDraft({
    editingId: session.id,
    date: session.date,
    time: session.time || '',
    location: session.location || '',
    note: session.note || '',
    entries: session.entries.map(toDraftEntry),
  });
  location.hash = '#/';
}

/* ---------- Rendering ---------- */

export async function render(container) {
  root = container;
  const [exercises, groups, stored, sessions] = await Promise.all([
    getAll('exercises'), getAll('muscleGroups'), getDraft(), getSessions()]);
  exercisesById = byId(exercises);
  muscleGroupsById = byId(groups);
  // Distinct past locations, most recently used first.
  pastLocations = [...new Set(sessions.map((s) => s.location).filter(Boolean))];
  draft = { time: '', location: '', ...(stored || newDraft()) }; // drafts from v1.0 lack time/location
  // An untouched new form always starts on today's date and the current time.
  if (!hasContent(draft)) { draft.date = todayISO(); draft.time = nowTime(); }
  build();
}

/** (Re)build the whole form from `draft`. Used after structural changes. */
function build() {
  const editing = draft.editingId != null;

  setChildren(root,
    editing && h('div', { class: 'edit-banner' },
      h('span', { class: 'spacer' }, 'Editing a saved session'),
      h('button', { class: 'btn-ghost', onclick: discard }, 'Cancel')),

    h('h1', {}, editing ? 'Edit session' : 'New session'),

    h('div', { class: 'record-top' },
      h('div', { class: 'date-time' },
        h('label', { class: 'field' }, h('span', {}, 'Date'),
          h('input', {
            type: 'date', class: 'date-input', value: draft.date, required: true,
            oninput: (e) => { if (e.target.value) { draft.date = e.target.value; changed(); } },
          })),
        h('label', { class: 'field' }, h('span', {}, 'Time'),
          h('input', {
            type: 'time', class: 'date-input', value: draft.time,
            oninput: (e) => { draft.time = e.target.value; changed(); },
          }))),
      h('label', { class: 'field' }, h('span', {}, 'Location (optional)'),
        h('input', {
          type: 'text', list: 'past-locations', placeholder: 'e.g. Gym, Home', value: draft.location,
          autocomplete: 'off',
          oninput: (e) => { draft.location = e.target.value; changed(); },
        }),
        h('datalist', { id: 'past-locations' }, pastLocations.map((l) => h('option', { value: l })))),
      h('label', { class: 'field' }, h('span', {}, 'Note (optional)'),
        h('textarea', {
          rows: 2, placeholder: 'How did it go?', value: draft.note,
          oninput: (e) => { draft.note = e.target.value; changed(); },
        })),
    ),

    h('div', { id: 'entries' },
      draft.entries.length
        ? draft.entries.map(entryCard)
        : h('p', { class: 'empty' }, 'No exercises yet. Tap “Add exercise” to start.')),

    h('button', { class: 'btn btn-dashed btn-block btn-big', style: 'margin-top:12px', onclick: openAddSheet }, '+ Add exercise'),

    h('div', { class: 'save-bar' },
      h('button', { class: 'btn btn-primary btn-block btn-big', onclick: save }, editing ? 'Save changes' : 'Save session'),
      !editing && hasContent(draft) && h('button', { class: 'btn-ghost', onclick: discard }, 'Discard this session')),
  );
}

/** Card for one exercise in the session. */
function entryCard(entry, index) {
  const ex = exercisesById.get(entry.exerciseId);
  const muscles = ex ? ex.muscleGroupIds.map((id) => muscleGroupsById.get(id)).filter(Boolean) : [];

  const name = ex ? ex.name : 'this exercise';
  const count = draft.entries.length;

  const remove = () => {
    if (!confirm(`Remove ${name} from the session?`)) return;
    draft.entries.splice(index, 1);
    changed();
    build();
  };

  /** Move this exercise up (-1) or down (+1) in the session. */
  const move = (dir) => {
    const [item] = draft.entries.splice(index, 1);
    draft.entries.splice(index + dir, 0, item);
    changed();
    build();
    // Keep the moved card in view so repeated taps are easy.
    root.querySelector(`#entries .card[data-index="${index + dir}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  return h('section', { class: 'card', 'data-index': index },
    h('div', { class: 'card-head' },
      h('div', { class: 'spacer' },
        h('h3', {}, ex ? ex.name : 'Unknown exercise'),
        h('div', { class: 'tags' },
          h('span', { class: `tag ${entry.type}` }, entry.type === 'cardio' ? 'Cardio' : 'Strength'),
          muscles.map((m) => h('span', { class: 'tag' }, m.name)))),
      count > 1 && h('button', {
        class: 'icon-btn move-btn', 'aria-label': `Move ${name} up`, disabled: index === 0, onclick: () => move(-1),
      }, '↑'),
      count > 1 && h('button', {
        class: 'icon-btn move-btn', 'aria-label': `Move ${name} down`, disabled: index === count - 1, onclick: () => move(1),
      }, '↓'),
      h('button', { class: 'icon-btn', 'aria-label': `Remove ${name}`, onclick: remove }, '×')),
    entry.lastInfo && h('p', { class: 'muted small' }, entry.lastInfo),
    entry.type === 'cardio' ? cardioFields(entry) : strengthFields(entry),
    noteField(entry, index),
  );
}

/** Optional note per exercise: a "+ Note" button that opens a text field. */
function noteField(entry, index) {
  if (!entry.note && !entry.showNote) {
    return h('button', {
      class: 'btn-ghost small note-toggle',
      onclick: () => {
        entry.showNote = true;
        build();
        root.querySelector(`#entries .card[data-index="${index}"] textarea`)?.focus();
      },
    }, '+ Note');
  }
  return h('label', { class: 'field', style: 'margin-top:10px' }, h('span', {}, 'Exercise note (optional)'),
    h('textarea', {
      rows: 2, value: entry.note || '', placeholder: 'e.g. felt easy, try more weight next time',
      oninput: (e) => { entry.note = e.target.value; changed(); },
    }));
}

/** Weight × reps rows plus "Add set". */
function strengthFields(entry) {
  const rows = entry.sets.map((set, i) => h('div', { class: 'set-row' },
    h('span', { class: 'set-num' }, i + 1),
    unitInput('kg', set.weight, 'decimal', `Set ${i + 1} weight in kg (optional)`, (v) => { set.weight = v; }),
    h('span', { class: 'set-x' }, '×'),
    unitInput('reps', set.reps, 'numeric', `Set ${i + 1} reps`, (v) => { set.reps = v; }),
    h('button', {
      class: 'icon-btn', 'aria-label': `Remove set ${i + 1}`,
      onclick: () => { entry.sets.splice(i, 1); changed(); build(); },
    }, '−'),
  ));

  const addSet = () => {
    // New set starts with the previous set's values.
    const prev = entry.sets[entry.sets.length - 1];
    entry.sets.push(prev ? { ...prev } : { weight: '', reps: '' });
    changed();
    build();
  };

  return h('div', {},
    rows.length ? rows : h('p', { class: 'muted small' }, 'No sets yet.'),
    h('button', { class: 'btn btn-block', onclick: addSet }, '+ Add set'));
}

/** Duration, intensity, distance and laps inputs (all optional). */
function cardioFields(entry) {
  return h('div', { class: 'cardio-grid' },
    CARDIO_FIELDS.map(([key, label, unit, inputmode]) => h('label', { class: 'field' }, h('span', {}, label),
      unitInput(unit, entry[key] ?? '', inputmode, `${label} (optional)`, (v) => { entry[key] = v; }))));
}

/** Number input with a unit shown inside it. */
function unitInput(unit, value, inputmode, label, onChange) {
  return h('div', { class: 'unit-input' },
    h('input', {
      type: 'text', inputmode, value, 'aria-label': label, autocomplete: 'off',
      enterkeyhint: 'next',
      oninput: (e) => { onChange(e.target.value); changed(); },
      onfocus: (e) => e.target.select(),
    }),
    h('em', {}, unit));
}

/* ---------- Save / discard ---------- */

async function save() {
  const errors = [];
  const entries = [];

  for (const entry of draft.entries) {
    const name = exercisesById.get(entry.exerciseId)?.name || 'An exercise';
    // Anything typed into a number field must be a valid, non-negative number.
    const number = (raw, label) => {
      const n = toNumber(raw);
      if ((raw ?? '').trim() !== '' && (n == null || n < 0)) errors.push(`${name}: “${raw}” is not a valid ${label}.`);
      return n;
    };
    const note = (entry.note || '').trim();
    if (entry.type === 'cardio') {
      const saved = { exerciseId: entry.exerciseId, type: 'cardio' };
      for (const [key, label] of CARDIO_FIELDS) saved[key] = number(entry[key], label.toLowerCase());
      if (note) saved.note = note;
      entries.push(saved);
    } else {
      // Ignore completely empty set rows.
      const sets = entry.sets
        .map((s) => ({ weight: number(s.weight, 'weight'), reps: number(s.reps, 'number of reps') }))
        .filter((s) => s.weight != null || s.reps != null);
      if (!sets.length) errors.push(`${name}: add at least one set.`);
      if (sets.some((s) => s.reps == null || s.reps <= 0)) errors.push(`${name}: enter reps for every set.`);
      entries.push({ exerciseId: entry.exerciseId, type: 'strength', sets, ...(note && { note }) });
    }
  }
  if (!entries.length) errors.push('Add at least one exercise.');
  if (errors.length) { alert(errors.join('\n')); return; }

  const editingId = draft.editingId;
  const existing = editingId != null ? await get('sessions', editingId) : null;
  const now = Date.now();
  const id = await put('sessions', {
    id: editingId ?? undefined,
    date: draft.date,
    time: draft.time || null,
    location: draft.location.trim(),
    note: draft.note.trim(),
    entries,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  });

  clearTimeout(saveTimer);
  draft = newDraft();
  await clearDraft();
  toast(editingId != null ? 'Changes saved' : 'Session saved');
  if (editingId != null) location.hash = `#/session/${id}`;
  else { build(); window.scrollTo(0, 0); }
}

async function discard() {
  const editing = draft.editingId != null;
  if (!confirm(editing ? 'Stop editing? Unsaved changes are lost.' : 'Discard this session?')) return;
  const back = draft.editingId;
  clearTimeout(saveTimer);
  draft = newDraft();
  await clearDraft();
  if (editing) location.hash = `#/session/${back}`;
  else build();
}

/* ---------- Add-exercise sheet ---------- */

/** Add an exercise to the session, prefilled with what was done last time. */
async function addEntry(exercise) {
  const last = await getLastEntry(exercise.id, draft.editingId);
  const prev = last && last.entry.type === exercise.type ? last.entry : null;
  const entry = prev ? toDraftEntry(prev, false) : (exercise.type === 'cardio'
    ? { exerciseId: exercise.id, type: 'cardio', note: '', ...Object.fromEntries(CARDIO_FIELDS.map(([key]) => [key, ''])) }
    : { exerciseId: exercise.id, type: 'strength', note: '', sets: [{ weight: '', reps: '' }] });
  entry.exerciseId = exercise.id;
  if (prev) entry.lastInfo = `Last time (${formatDate(last.session.date, { day: 'numeric', month: 'short' })}): ${entrySummary(prev)}`;

  draft.entries.push(entry);
  changed();
  build();
  const cards = root.querySelectorAll('#entries .card');
  cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function openAddSheet() {
  // Order suggestions by when they were last used (most recent first).
  const lastUsed = new Map();
  for (const s of await getSessions()) {
    for (const e of s.entries) if (!lastUsed.has(e.exerciseId)) lastUsed.set(e.exerciseId, s.date);
  }
  const all = [...exercisesById.values()].sort((a, b) =>
    (lastUsed.get(b.id) || '').localeCompare(lastUsed.get(a.id) || '') || a.name.localeCompare(b.name));

  // State for creating a new exercise
  let newType = 'strength';
  const selectedGroups = new Set();

  const search = h('input', {
    type: 'search', placeholder: 'Search or type a new exercise', autocomplete: 'off',
    'aria-label': 'Exercise name', enterkeyhint: 'done',
    oninput: () => renderResults(),
  });
  const results = h('div', {});
  const dialog = h('dialog', { class: 'sheet', 'aria-label': 'Add exercise' },
    h('div', { class: 'sheet-inner' },
      h('div', { class: 'sheet-head' },
        h('h2', {}, 'Add exercise'),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => dialog.close() }, '×')),
      h('div', { class: 'sheet-body' }, search, results)));

  dialog.addEventListener('close', () => dialog.remove());
  // Tap on the dark backdrop closes the sheet.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  const pick = async (exercise) => { dialog.close(); await addEntry(exercise); };

  function renderResults() {
    const query = search.value.trim();
    const q = query.toLowerCase();
    const matches = all.filter((e) => e.name.toLowerCase().includes(q));
    const exact = all.some((e) => e.name.toLowerCase() === q);

    setChildren(results, matches.length
        ? h('ul', { class: 'suggestions' }, matches.map((ex) => h('li', {},
          h('button', { onclick: () => pick(ex) },
            h('strong', {}, ex.name),
            h('span', { class: 'muted small' }, describeExercise(ex, lastUsed.get(ex.id)))))))
        : (!query && h('p', { class: 'muted' }, 'No exercises yet. Type a name to create one.')),
      query && !exact && createForm(query),
    );
  }

  /** Form for a brand-new exercise: type + muscle groups. */
  function createForm(name) {
    const muscleSection = h('div', { class: newType === 'cardio' ? 'hidden' : '' },
      h('div', { class: 'group-label' }, 'Muscle groups'),
      muscleGroupChips(selectedGroups),
      customGroupForm(async (group) => {
        muscleGroupsById.set(group.id, group);
        selectedGroups.add(group.id);
        renderResults();
      }));

    const typeRadio = (value, label) => h('label', {},
      h('input', {
        type: 'radio', name: 'new-type', value, checked: newType === value,
        onchange: () => { newType = value; muscleSection.classList.toggle('hidden', value === 'cardio'); },
      }),
      h('span', {}, label));

    const create = async () => {
      if (await findExerciseByName(name)) { toast('That exercise already exists'); return; }
      const exercise = {
        name,
        type: newType,
        muscleGroupIds: newType === 'strength' ? [...selectedGroups] : [],
      };
      exercise.id = await put('exercises', exercise);
      exercisesById.set(exercise.id, exercise);
      await pick(exercise);
    };

    return h('div', { class: 'card', style: 'margin-top:16px' },
      h('h3', {}, `New exercise: “${name}”`),
      h('div', { class: 'group-label' }, 'Type'),
      h('div', { class: 'segmented', role: 'radiogroup' }, typeRadio('strength', 'Strength'), typeRadio('cardio', 'Cardio')),
      muscleSection,
      h('button', { class: 'btn btn-primary btn-block', style: 'margin-top:16px', onclick: create }, `Add “${name}”`));
  }

  renderResults();
  root.append(dialog);
  dialog.showModal();
  search.focus();
}

/** "Strength · Chest, Triceps · last 12 Sep" */
function describeExercise(ex, lastDate) {
  const parts = [ex.type === 'cardio' ? 'Cardio' : 'Strength'];
  const muscles = ex.muscleGroupIds.map((id) => muscleGroupsById.get(id)?.name).filter(Boolean);
  if (muscles.length) parts.push(muscles.join(', '));
  if (lastDate) parts.push(`last ${formatDate(lastDate, { day: 'numeric', month: 'short' })}`);
  return parts.join(' · ');
}

/**
 * Checkbox chips for all muscle groups, grouped by category.
 * Toggling a chip adds/removes its id in `selected` (a Set).
 * Exported for reuse on the Exercises screen.
 */
export function muscleGroupChips(selected, groups = [...muscleGroupsById.values()]) {
  return Object.entries(CATEGORIES).map(([cat, label]) => {
    const inCat = groups.filter((g) => g.category === cat);
    if (!inCat.length) return null;
    return h('div', {},
      h('div', { class: 'small muted', style: 'margin:8px 0 4px' }, label),
      h('div', { class: 'chips' }, inCat.map((g) => h('label', { class: 'chip' },
        h('input', {
          type: 'checkbox', checked: selected.has(g.id),
          onchange: (e) => { if (e.target.checked) selected.add(g.id); else selected.delete(g.id); },
        }),
        h('span', {}, g.name)))));
  });
}

/**
 * Small inline form "name + category + Add" for a custom muscle group.
 * Calls onAdded(group) with the stored group. Exported for Settings.
 */
export function customGroupForm(onAdded) {
  const name = h('input', { type: 'text', placeholder: 'Custom muscle group', 'aria-label': 'Custom muscle group name' });
  const category = h('select', { 'aria-label': 'Category' },
    Object.entries(CATEGORIES).map(([value, label]) => h('option', { value }, label)));

  const add = async () => {
    const value = name.value.trim();
    if (!value) { name.focus(); return; }
    const existing = (await getAll('muscleGroups')).find((g) => g.name.toLowerCase() === value.toLowerCase());
    if (existing) { toast(`“${existing.name}” already exists`); return; }
    const group = { name: value, category: category.value };
    group.id = await put('muscleGroups', group);
    name.value = '';
    toast(`Added “${group.name}”`);
    await onAdded(group);
  };

  name.style.gridColumn = '1 / -1'; // name on its own row, category + button below
  return h('div', { style: 'margin-top:12px; display:grid; gap:8px; grid-template-columns: 1fr auto' },
    name, category, h('button', { class: 'btn', onclick: add }, 'Add group'));
}
