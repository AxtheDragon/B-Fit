/*
 * Category / muscle-group filter, shared by History and Stats.
 *
 * A filter is a plain object { category, muscleGroupId }:
 *   category:      'all' | 'upper' | 'lower' | 'core' | 'cardio'
 *   muscleGroupId: 'all' | id of a muscle group (as a string, from the <select>)
 */
import { h, setChildren, CATEGORIES } from './util.js';

export function createFilter() {
  return { category: 'all', muscleGroupId: 'all' };
}

export function isFiltering(filter) {
  return filter.category !== 'all' || filter.muscleGroupId !== 'all';
}

/** Does one session entry match the filter? */
export function entryMatches(entry, filter, exercisesById, groupsById) {
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

/** The entries of a session that match the filter (empty array = session doesn't match). */
export function matchingEntries(session, filter, exercisesById, groupsById) {
  return session.entries.filter((e) => entryMatches(e, filter, exercisesById, groupsById));
}

let instance = 0;

/**
 * Filter UI: category chips plus a muscle-group dropdown.
 * Changes are written into `filter`, then `onChange()` is called.
 */
export function filterControls(filter, groups, onChange) {
  const radioName = `category-${++instance}`; // unique per screen
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
  muscleSelect.addEventListener('change', () => { filter.muscleGroupId = muscleSelect.value; onChange(); });

  const categoryChip = (value, label) => h('label', { class: 'chip' },
    h('input', {
      type: 'radio', name: radioName, value, checked: filter.category === value,
      onchange: () => { filter.category = value; fillMuscleOptions(); onChange(); },
    }),
    h('span', {}, label));

  fillMuscleOptions();
  return h('div', { class: 'filters' },
    h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Filter by category' },
      categoryChip('all', 'All'),
      Object.entries(CATEGORIES).map(([value, label]) => categoryChip(value, label)),
      categoryChip('cardio', 'Cardio')),
    muscleSelect);
}
