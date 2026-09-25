/*
 * History screen: past sessions (newest first) with filters,
 * and the detail view of one session (edit / delete).
 */
import { getAll, get, remove, getSessions } from './db.js';
import { h, add, setChildren, formatDate, formatSet, entrySummary, byId, toast, CATEGORIES } from './util.js';
import { editSession } from './record.js';

// Filters are remembered while the app is open.
const filter = { category: 'all', muscleGroupId: 'all' };

/** Does a session entry match the current filters? */
function entryMatches(entry, exercisesById, groupsById) {
  const ex = exercisesById.get(entry.exerciseId);
  const groupIds = ex ? ex.muscleGroupIds : [];

  if (filter.category === 'cardio' && entry.type !== 'cardio') return false;
  if (filter.category in CATEGORIES &&
      !(entry.type === 'strength' && groupIds.some((id) => groupsById.get(id)?.category === filter.category))) {
    return false;
  }
  if (filter.muscleGroupId !== 'all' && !groupIds.includes(Number(filter.muscleGroupId))) return false;
  return true;
}

export async function renderList(container) {
  const [sessions, exercises, groups] = await Promise.all([getSessions(), getAll('exercises'), getAll('muscleGroups')]);
  const exercisesById = byId(exercises);
  const groupsById = byId(groups);

  const list = h('div', {});
  const muscleSelect = h('select', { 'aria-label': 'Filter by muscle group' });

  /** Muscle group options depend on the chosen category. */
  function fillMuscleOptions() {
    const cat = filter.category;
    const visible = groups.filter((g) => cat === 'all' || g.category === cat);
    if (!visible.some((g) => String(g.id) === filter.muscleGroupId)) filter.muscleGroupId = 'all';
    setChildren(muscleSelect,
      h('option', { value: 'all' }, 'All muscle groups'),
      visible.map((g) => h('option', { value: g.id }, g.name)));
    muscleSelect.value = filter.muscleGroupId;
    muscleSelect.disabled = cat === 'cardio';
  }
  muscleSelect.addEventListener('change', () => { filter.muscleGroupId = muscleSelect.value; renderSessions(); });

  function renderSessions() {
    const filtering = filter.category !== 'all' || filter.muscleGroupId !== 'all';
    const shown = sessions
      .map((s) => ({ session: s, entries: s.entries.filter((e) => entryMatches(e, exercisesById, groupsById)) }))
      .filter((x) => x.entries.length);

    if (!sessions.length) {
      setChildren(list, h('p', { class: 'empty' }, 'No sessions saved yet.'));
      return;
    }
    if (!shown.length) {
      setChildren(list, h('p', { class: 'empty' }, 'No sessions match these filters.'));
      return;
    }
    setChildren(list,
      h('p', { class: 'muted small' }, `${shown.length} session${shown.length === 1 ? '' : 's'}`),
      shown.map(({ session, entries }) => h('a', { class: 'card', href: `#/session/${session.id}` },
        h('div', { class: 'session-date' }, formatDate(session.date)),
        session.note && h('div', { class: 'muted small' }, session.note),
        // When filtering, only the matching exercises are listed.
        h('ul', { class: 'session-lines' }, (filtering ? entries : session.entries).map((e) => h('li', {},
          h('b', {}, exercisesById.get(e.exerciseId)?.name || 'Unknown'),
          h('span', {}, entrySummary(e))))))));
  }

  const categoryChip = (value, label) => h('label', { class: 'chip' },
    h('input', {
      type: 'radio', name: 'category', value, checked: filter.category === value,
      onchange: () => { filter.category = value; fillMuscleOptions(); renderSessions(); },
    }),
    h('span', {}, label));

  add(container,
    h('h1', {}, 'History'),
    h('div', { class: 'filters' },
      h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Filter by category' },
        categoryChip('all', 'All'),
        Object.entries(CATEGORIES).map(([value, label]) => categoryChip(value, label)),
        categoryChip('cardio', 'Cardio')),
      muscleSelect),
    list);

  fillMuscleOptions();
  renderSessions();
}

export async function renderDetail(container, id) {
  const [session, exercises, groups] = await Promise.all([get('sessions', id), getAll('exercises'), getAll('muscleGroups')]);
  if (!session) {
    add(container, h('p', { class: 'empty' }, 'This session no longer exists.'), h('a', { href: '#/history' }, 'Back to history'));
    return;
  }
  const exercisesById = byId(exercises);
  const groupsById = byId(groups);

  const del = async () => {
    if (!confirm(`Delete the session from ${formatDate(session.date)}? This cannot be undone.`)) return;
    await remove('sessions', id);
    toast('Session deleted');
    location.hash = '#/history';
  };

  add(container,
    h('a', { href: '#/history', class: 'btn btn-ghost', style: 'padding-left:0' }, '‹ History'),
    h('h1', {}, formatDate(session.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
    session.note && h('p', {}, session.note),
    h('div', { class: 'card' }, session.entries.map((e) => {
      const ex = exercisesById.get(e.exerciseId);
      const muscles = ex ? ex.muscleGroupIds.map((g) => groupsById.get(g)?.name).filter(Boolean) : [];
      return h('div', { class: 'detail-entry' },
        h('div', { class: 'row' },
          ex ? h('a', { href: `#/exercise/${ex.id}` }, h('h3', {}, ex.name)) : h('h3', {}, 'Unknown exercise'),
          h('span', { class: 'spacer' }),
          h('span', { class: `tag ${e.type}` }, e.type === 'cardio' ? 'Cardio' : 'Strength')),
        muscles.length > 0 && h('div', { class: 'muted small' }, muscles.join(', ')),
        e.type === 'cardio'
          ? h('p', { style: 'margin:6px 0 0' }, entrySummary(e))
          : h('ol', { class: 'sets-list' }, e.sets.map((s) => h('li', {}, formatSet(s)))));
    })),
    h('div', { class: 'save-bar' },
      h('button', { class: 'btn btn-primary btn-block btn-big', onclick: () => editSession(session) }, 'Edit session'),
      h('button', { class: 'btn btn-danger btn-block', onclick: del }, 'Delete session')));
}
