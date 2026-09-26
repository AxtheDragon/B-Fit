/*
 * Stats screen: activity graph (which days had a session) and statistics
 * for a chosen period, both following the category / muscle-group filter.
 *
 * A "workout" is a session with at least one exercise matching the filter.
 */
import { getAll, getSessions } from './db.js';
import { h, add, setChildren, formatDate, parseISODate, toISODate, todayISO, byId } from './util.js';
import { createFilter, matchingEntries, filterControls } from './filters.js';
import { barChart } from './chart.js';

const PERIODS = [
  ['4w', '4 weeks', 4],
  ['3m', '3 months', 13],
  ['6m', '6 months', 26],
  ['1y', '1 year', 52],
  ['all', 'All', null],
];

// Remembered while the app is open.
const filter = createFilter();
let period = '3m';

/* ---------- Date helpers (weeks start on Monday) ---------- */

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Monday of the week containing `date`. */
function weekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** First Monday of the period: N weeks back, or the week of the first session for "All". */
function periodStart(sessions) {
  const thisWeek = weekStart(new Date());
  const weeks = PERIODS.find(([key]) => key === period)[2];
  if (weeks) return addDays(thisWeek, -7 * (weeks - 1));
  const first = sessions[sessions.length - 1]; // sessions are sorted newest first
  return first ? weekStart(parseISODate(first.date)) : addDays(thisWeek, -7 * 11);
}

/* ---------- Screen ---------- */

export async function render(container) {
  const [sessions, exercises, groups] = await Promise.all([getSessions(), getAll('exercises'), getAll('muscleGroups')]);
  const exercisesById = byId(exercises);
  const groupsById = byId(groups);
  const content = h('div', {});

  function update() {
    const start = periodStart(sessions);
    const startISO = toISODate(start);
    const today = todayISO();
    // Matching sessions inside the period, each with only its matching entries.
    const workouts = sessions
      .filter((s) => s.date >= startISO && s.date <= today)
      .map((s) => ({ session: s, entries: matchingEntries(s, filter, exercisesById, groupsById) }))
      .filter((w) => w.entries.length);

    setChildren(content,
      activityCard(workouts, start),
      summaryTiles(workouts, start),
      frequencyCard(workouts, start),
      topExercises(workouts, exercisesById));
  }

  const periodChip = ([key, label]) => h('label', { class: 'chip' },
    h('input', {
      type: 'radio', name: 'stats-period', value: key, checked: period === key,
      onchange: () => { period = key; update(); },
    }),
    h('span', {}, label));

  add(container,
    h('h1', {}, 'Stats'),
    filterControls(filter, groups, update),
    h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Time period', style: 'margin-bottom:16px' },
      PERIODS.map(periodChip)),
    content);
  update();
}

/* ---------- Activity graph ---------- */

/**
 * GitHub-style grid: one column per week (Mon–Sun), one square per day.
 * Days with a matching session are coloured. Tap a day to see what was done.
 */
function activityCard(workouts, start) {
  const byDate = new Map();
  for (const w of workouts) {
    if (!byDate.has(w.session.date)) byDate.set(w.session.date, []);
    byDate.get(w.session.date).push(w);
  }

  const today = todayISO();
  const info = h('div', { class: 'activity-info muted small' }, 'Tap a day to see its sessions.');
  const grid = h('div', { class: 'activity-grid', role: 'grid', 'aria-label': 'Activity by day' });
  const monthRow = h('div', { class: 'activity-months', 'aria-hidden': 'true' });
  let selected = null;

  const selectDay = (cell, iso) => {
    selected?.classList.remove('selected');
    selected = cell;
    cell.classList.add('selected');
    const day = byDate.get(iso) || [];
    setChildren(info,
      h('b', {}, formatDate(iso)),
      day.length
        ? day.map((w) => h('div', {}, h('a', { href: `#/session/${w.session.id}` },
          [w.session.time, w.session.location].filter(Boolean).join(' · ') || 'Session'),
          ` – ${w.entries.length} exercise${w.entries.length === 1 ? '' : 's'}`))
        : h('div', {}, 'No session'));
  };

  let lastMonth = -1;
  let lastLabelAt = -99;
  let weeks = 0;
  for (let week = new Date(start); toISODate(week) <= today; week = addDays(week, 7), weeks++) {
    // Month label above the first week of each month. Labels need ~3 columns
    // of room, so one that would be too close to the previous is left out.
    const label = h('span', {});
    if (week.getMonth() !== lastMonth) {
      lastMonth = week.getMonth();
      if (weeks - lastLabelAt >= 3) {
        label.textContent = week.toLocaleDateString(undefined, { month: 'short' });
        lastLabelAt = weeks;
      }
    }
    monthRow.append(label);

    const column = h('div', { class: 'activity-week', role: 'row' });
    for (let i = 0; i < 7; i++) {
      const iso = toISODate(addDays(week, i));
      if (iso > today) { column.append(h('span', { class: 'day future' })); continue; }
      const count = byDate.get(iso)?.length || 0;
      const cell = h('button', {
        class: `day level-${Math.min(count, 2)}${iso === today ? ' today' : ''}`,
        role: 'gridcell',
        'aria-label': `${formatDate(iso)}: ${count ? `${count} session${count === 1 ? '' : 's'}` : 'no session'}`,
      });
      cell.addEventListener('click', () => selectDay(cell, iso));
      column.append(cell);
    }
    grid.append(column);
  }

  const scroller = h('div', { class: 'activity-scroll' },
    h('div', { class: 'activity-inner' },
      monthRow,
      h('div', { class: 'activity-body' },
        h('div', { class: 'activity-weekdays', 'aria-hidden': 'true' },
          ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((d) => h('span', {}, d))),
        grid)));
  // Squares grow to fill the card for short periods (14–28px). Long periods
  // keep 14px squares and scroll, starting at the most recent weeks.
  new ResizeObserver(() => {
    const size = Math.floor((scroller.clientWidth - 40) / weeks) - 3;
    scroller.style.setProperty('--cell', `${Math.max(14, Math.min(28, size))}px`);
    scroller.scrollLeft = scroller.scrollWidth;
  }).observe(scroller);

  return h('section', { class: 'card' },
    h('h3', {}, 'Activity'),
    scroller,
    h('div', { class: 'activity-legend muted small', 'aria-hidden': 'true' },
      h('span', { class: 'day level-0' }), 'none',
      h('span', { class: 'day level-1' }), '1 session',
      h('span', { class: 'day level-2' }), '2+'),
    info);
}

/* ---------- Statistics ---------- */

function weeksBetween(start, end) {
  return Math.round((weekStart(end) - start) / (7 * 864e5)) + 1;
}

function summaryTiles(workouts, start) {
  const weeks = weeksBetween(start, new Date());
  const days = new Set(workouts.map((w) => w.session.date)).size;
  const entries = workouts.flatMap((w) => w.entries);
  const sets = entries.filter((e) => e.type === 'strength').reduce((n, e) => n + e.sets.length, 0);
  const cardio = entries.filter((e) => e.type === 'cardio');
  const minutes = cardio.reduce((n, e) => n + (e.duration || 0), 0);
  const km = cardio.reduce((n, e) => n + (e.distance || 0), 0);
  const round = (n) => Math.round(n * 10) / 10;

  const tile = (value, label) => h('div', { class: 'stat-tile' },
    h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));

  return h('section', { class: 'stat-tiles' },
    tile(workouts.length, 'Workouts'),
    tile(round(workouts.length / weeks), 'Per week (avg)'),
    tile(days, 'Training days'),
    tile(sets, 'Strength sets'),
    tile(round(minutes), 'Cardio minutes'),
    km > 0 && tile(round(km), 'Cardio km'));
}

/** Workouts per week (or per month for long periods) as a bar chart. */
function frequencyCard(workouts, start) {
  const weeks = weeksBetween(start, new Date());
  const bars = [];
  if (weeks <= 26) {
    for (let i = 0; i < weeks; i++) {
      const from = addDays(start, 7 * i);
      const fromISO = toISODate(from);
      const toISO = toISODate(addDays(from, 6));
      bars.push({
        label: formatDate(fromISO, { day: 'numeric', month: 'numeric' }),
        tip: `Week of ${formatDate(fromISO, { day: 'numeric', month: 'short' })}`,
        value: workouts.filter((w) => w.session.date >= fromISO && w.session.date <= toISO).length,
      });
    }
  } else {
    const now = new Date();
    for (let m = new Date(start.getFullYear(), start.getMonth(), 1); m <= now; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const prefix = toISODate(m).slice(0, 7); // "YYYY-MM"
      bars.push({
        label: m.toLocaleDateString(undefined, { month: 'short' }),
        tip: m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        value: workouts.filter((w) => w.session.date.startsWith(prefix)).length,
      });
    }
  }
  return h('section', { class: 'card', style: 'margin-top:12px' },
    barChart(weeks <= 26 ? 'Workouts per week' : 'Workouts per month', bars));
}

/** The exercises done most often in the period. */
function topExercises(workouts, exercisesById) {
  const counts = new Map();
  for (const w of workouts) {
    for (const id of new Set(w.entries.map((e) => e.exerciseId))) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length) return h('p', { class: 'empty', style: 'margin-top:12px' }, 'No workouts in this period.');
  const max = top[0][1];
  return h('section', { class: 'card', style: 'margin-top:12px' },
    h('h3', {}, 'Most frequent exercises'),
    h('ul', { class: 'top-list' }, top.map(([id, n]) => {
      const ex = exercisesById.get(id);
      return h('li', {},
        h('div', { class: 'row' },
          ex ? h('a', { href: `#/exercise/${id}`, class: 'spacer' }, ex.name) : h('span', { class: 'spacer' }, 'Unknown'),
          h('span', { class: 'muted small' }, `${n}×`)),
        h('div', { class: 'top-bar', style: `width:${(n / max) * 100}%` }));
    })));
}
