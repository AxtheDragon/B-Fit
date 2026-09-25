/*
 * Exercises screen: list of all exercises, and a progress page per exercise
 * (chart + every past entry). Exercises can be renamed, have their muscle
 * groups changed, or be deleted if they were never used.
 */
import { getAll, get, put, remove, getSessions, findExerciseByName } from './db.js';
import { h, add, setChildren, formatDate, formatSet, entrySummary, byId, toast } from './util.js';
import { lineChart } from './chart.js';
import { muscleGroupChips } from './record.js';

/** For each exercise id: { count, lastDate } */
function usageStats(sessions) {
  const stats = new Map();
  for (const s of sessions) {
    for (const id of new Set(s.entries.map((e) => e.exerciseId))) {
      const st = stats.get(id) || { count: 0, lastDate: null };
      st.count += 1;
      if (!st.lastDate || s.date > st.lastDate) st.lastDate = s.date;
      stats.set(id, st);
    }
  }
  return stats;
}

export async function renderList(container) {
  const [exercises, groups, sessions] = await Promise.all([getAll('exercises'), getAll('muscleGroups'), getSessions()]);
  const groupsById = byId(groups);
  const stats = usageStats(sessions);
  exercises.sort((a, b) =>
    (stats.get(b.id)?.lastDate || '').localeCompare(stats.get(a.id)?.lastDate || '') || a.name.localeCompare(b.name));

  const list = h('div', {});
  const search = h('input', {
    type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises',
    oninput: () => renderItems(),
  });

  function renderItems() {
    const q = search.value.trim().toLowerCase();
    const sections = [['strength', 'Strength'], ['cardio', 'Cardio']].map(([type, label]) => {
      const items = exercises.filter((e) => e.type === type && e.name.toLowerCase().includes(q));
      if (!items.length) return null;
      return [
        h('h2', {}, label),
        items.map((ex) => {
          const st = stats.get(ex.id);
          const muscles = ex.muscleGroupIds.map((id) => groupsById.get(id)?.name).filter(Boolean);
          return h('a', { class: 'card', href: `#/exercise/${ex.id}` },
            h('h3', {}, ex.name),
            muscles.length > 0 && h('div', { class: 'tags' }, muscles.map((m) => h('span', { class: 'tag' }, m))),
            h('div', { class: 'muted small', style: 'margin-top:4px' },
              st ? `${st.count} session${st.count === 1 ? '' : 's'} · last ${formatDate(st.lastDate)}` : 'Not done yet'));
        }),
      ];
    });
    setChildren(list, sections.some(Boolean) ? sections : h('p', { class: 'empty' }, 'No exercises found.'));
  }

  add(container, h('h1', {}, 'Exercises'), search, list);
  renderItems();
}

export async function renderDetail(container, id) {
  const [exercise, groups, sessions] = await Promise.all([get('exercises', id), getAll('muscleGroups'), getSessions()]);
  if (!exercise) {
    add(container, h('p', { class: 'empty' }, 'This exercise no longer exists.'), h('a', { href: '#/exercises' }, 'Back to exercises'));
    return;
  }
  const groupsById = byId(groups);

  // Every session that contains this exercise, oldest first.
  // (If it appears twice in one session, the entries are combined.)
  const history = sessions
    .map((s) => ({ session: s, entries: s.entries.filter((e) => e.exerciseId === id) }))
    .filter((x) => x.entries.length)
    .reverse();

  const muscles = exercise.muscleGroupIds.map((g) => groupsById.get(g)?.name).filter(Boolean);

  add(container,
    h('a', { href: '#/exercises', class: 'btn btn-ghost', style: 'padding-left:0' }, '‹ Exercises'),
    h('h1', { style: 'margin-bottom:4px' }, exercise.name),
    h('div', { class: 'tags', style: 'margin-bottom:16px' },
      h('span', { class: `tag ${exercise.type}` }, exercise.type === 'cardio' ? 'Cardio' : 'Strength'),
      muscles.map((m) => h('span', { class: 'tag' }, m))),
  );

  if (!history.length) {
    add(container, h('p', { class: 'empty' }, 'No entries yet. Add this exercise to a session to track progress.'));
  } else if (exercise.type === 'cardio') {
    renderCardio(container, history);
  } else {
    renderStrength(container, history);
  }

  add(container, editSection(exercise, groups, history.length));
}

/** Charts need at least two points to show a trend. */
function chartCard(charts) {
  const usable = charts.filter(([, , points]) => points.length >= 2);
  if (!usable.length) return h('p', { class: 'muted small' }, 'The progress chart appears after two sessions.');
  return h('div', { class: 'card stack' }, usable.map(([title, unit, points]) => lineChart(title, unit, points)));
}

function renderStrength(container, history) {
  const rows = history.map(({ session, entries }) => {
    const sets = entries.flatMap((e) => e.sets);
    const weights = sets.map((s) => s.weight).filter((w) => w != null);
    return {
      session,
      sets,
      topWeight: weights.length ? Math.max(...weights) : null,
      maxReps: Math.max(0, ...sets.map((s) => s.reps || 0)),
    };
  });

  // Weighted exercise: chart the heaviest set. Bodyweight: chart the most reps.
  const weighted = rows.some((r) => r.topWeight != null);
  const points = weighted
    ? rows.filter((r) => r.topWeight != null).map((r) => ({ date: r.session.date, value: r.topWeight }))
    : rows.map((r) => ({ date: r.session.date, value: r.maxReps }));

  add(container,
    chartCard([weighted ? ['Top weight', 'kg', points] : ['Most reps in a set', 'reps', points]]),
    h('h2', {}, 'All entries'),
    h('div', { class: 'card' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Sets'), h('th', { class: 'num' }, weighted ? 'Top' : 'Best'))),
      h('tbody', {}, [...rows].reverse().map((r) => h('tr', {},
        h('td', {}, h('a', { href: `#/session/${r.session.id}` }, formatDate(r.session.date, { day: 'numeric', month: 'short', year: '2-digit' }))),
        h('td', {}, r.sets.map(formatSet).join(', ')),
        h('td', { class: 'num' }, weighted ? (r.topWeight != null ? `${r.topWeight} kg` : '–') : `${r.maxReps}`)))))));
}

function renderCardio(container, history) {
  const rows = history.flatMap(({ session, entries }) => entries.map((e) => ({ session, entry: e })));
  add(container, chartCard([
      ['Duration', 'min', rows.map((r) => ({ date: r.session.date, value: r.entry.duration }))],
      ['Intensity', 'level', rows.filter((r) => r.entry.intensity != null).map((r) => ({ date: r.session.date, value: r.entry.intensity }))],
    ]),
    h('h2', {}, 'All entries'),
    h('div', { class: 'card' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', { class: 'num' }, 'Minutes'), h('th', { class: 'num' }, 'Level'))),
      h('tbody', {}, [...rows].reverse().map((r) => h('tr', {},
        h('td', {}, h('a', { href: `#/session/${r.session.id}` }, formatDate(r.session.date, { day: 'numeric', month: 'short', year: '2-digit' }))),
        h('td', { class: 'num' }, r.entry.duration),
        h('td', { class: 'num' }, r.entry.intensity ?? '–')))))));
}

/** Collapsible "Edit exercise" section: rename, muscle groups, delete. */
function editSection(exercise, groups, useCount) {
  const selected = new Set(exercise.muscleGroupIds);
  const name = h('input', { type: 'text', value: exercise.name, 'aria-label': 'Exercise name' });

  const save = async () => {
    const newName = name.value.trim();
    if (!newName) { toast('Name cannot be empty'); return; }
    const clash = await findExerciseByName(newName);
    if (clash && clash.id !== exercise.id) { toast('Another exercise has that name'); return; }
    await put('exercises', { ...exercise, name: newName, muscleGroupIds: exercise.type === 'strength' ? [...selected] : [] });
    toast('Exercise updated');
    window.dispatchEvent(new HashChangeEvent('hashchange')); // re-render this page
  };

  const del = async () => {
    if (!confirm(`Delete “${exercise.name}”?`)) return;
    await remove('exercises', exercise.id);
    toast('Exercise deleted');
    location.hash = '#/exercises';
  };

  return h('details', { class: 'card', style: 'margin-top:24px' },
    h('summary', { style: 'min-height:32px; font-weight:600; cursor:pointer' }, 'Edit exercise'),
    h('div', { class: 'stack', style: 'margin-top:12px' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      exercise.type === 'strength' && h('div', {}, h('div', { class: 'group-label' }, 'Muscle groups'), muscleGroupChips(selected, groups)),
      h('button', { class: 'btn btn-primary btn-block', onclick: save }, 'Save changes'),
      useCount === 0
        ? h('button', { class: 'btn btn-danger btn-block', onclick: del }, 'Delete exercise')
        : h('p', { class: 'muted small' }, 'Exercises used in a session cannot be deleted.')));
}
