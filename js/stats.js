/*
 * Stats screen: activity graph (which days had a session) and statistics
 * for a chosen period, both following the category / muscle-group filter.
 *
 * A "workout" is a session with at least one exercise matching the filter.
 */
import { getAll, getSessions } from './db.js';
import { h, add, setChildren, formatDate, parseISODate, toISODate, todayISO, byId, CATEGORIES } from './util.js';
import { createFilter, matchingEntries, filterControls } from './filters.js';
import { barChart } from './chart.js';
import { ACTIVITY_CATEGORIES } from './colors.js'; // colours: CSS variables --cat-upper, ...

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

    /** Categories an entry counts towards, limited to what the filter shows. */
    const categoriesOf = (entry) => {
      let cats;
      if (entry.type === 'cardio') cats = ['cardio'];
      else {
        const groups = (exercisesById.get(entry.exerciseId)?.muscleGroupIds || []).map((id) => groupsById.get(id)).filter(Boolean);
        // With a muscle-group filter, only that group's category counts.
        const relevant = filter.muscleGroupId === 'all' ? groups : groups.filter((g) => String(g.id) === filter.muscleGroupId);
        cats = relevant.length ? relevant.map((g) => g.category) : ['other'];
      }
      return filter.category in CATEGORIES || filter.category === 'cardio' ? cats.filter((c) => c === filter.category) : cats;
    };

    setChildren(content,
      activityCard(workouts, start, categoriesOf),
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
function activityCard(workouts, start, categoriesOf) {
  const byDate = new Map();       // date -> workouts that day
  const catsByDate = new Map();   // date -> Set of categories trained that day
  for (const w of workouts) {
    const date = w.session.date;
    if (!byDate.has(date)) { byDate.set(date, []); catsByDate.set(date, new Set()); }
    byDate.get(date).push(w);
    for (const e of w.entries) categoriesOf(e).forEach((c) => catsByDate.get(date).add(c));
  }
  /** The day's categories in the fixed slice order, as [key, label] pairs. */
  const dayCategories = (iso) => ACTIVITY_CATEGORIES.filter(([key]) => catsByDate.get(iso)?.has(key));
  const usedCategories = new Set([...catsByDate.values()].flatMap((set) => [...set]));

  const today = todayISO();
  const info = h('div', { class: 'activity-info muted small' }, 'Tap a day to see its sessions.');
  const grid = h('div', { class: 'activity-grid', role: 'grid', 'aria-label': 'Activity by day' });
  // Two header rows: years on top, month names below. The first cell of each
  // is a sticky blank corner above the weekday labels, so labels scrolling to
  // the left slide underneath it.
  const yearRow = h('div', { class: 'activity-months activity-years', 'aria-hidden': 'true' }, h('span', { class: 'activity-corner' }));
  const monthRow = h('div', { class: 'activity-months', 'aria-hidden': 'true' }, h('span', { class: 'activity-corner' }));
  let selected = null;

  const selectDay = (cell, iso) => {
    selected?.classList.remove('selected');
    selected = cell;
    cell.classList.add('selected');
    const day = byDate.get(iso) || [];
    setChildren(info,
      h('b', {}, formatDate(iso)),
      day.length > 0 && h('div', {}, dayCategories(iso).map(([, label]) => label).join(' · ')),
      day.length
        ? day.map((w) => h('div', {}, h('a', { href: `#/session/${w.session.id}` },
          [w.session.time, w.session.location].filter(Boolean).join(' · ') || 'Session'),
          ` – ${w.entries.length} exercise${w.entries.length === 1 ? '' : 's'}`))
        : h('div', {}, 'No session'));
  };

  let lastMonth = -1;
  let lastMonthAt = -99;  // week index of the last month label shown
  let firstYear = null;   // year label above the first column
  let weeks = 0;
  for (let week = new Date(start); toISODate(week) <= today; week = addDays(week, 7), weeks++) {
    const month = h('span', {});
    const year = h('span', {});
    if (week.getMonth() !== lastMonth) {
      lastMonth = week.getMonth();
      // Month label above the first week of each month. Labels need ~3
      // columns of room, so one that would be too close is left out – except
      // when the previous one is the first column: that is only a partial
      // month, so its label gives way instead.
      if (weeks - lastMonthAt < 3 && lastMonthAt === 0) {
        monthRow.children[1].textContent = ''; // children[0] is the corner
        lastMonthAt = -99;
      }
      if (weeks - lastMonthAt >= 3) {
        month.textContent = week.toLocaleDateString(undefined, { month: 'short' });
        lastMonthAt = weeks;
      }
      // The year goes in the row above, over the first week of January.
      if (lastMonth === 0) {
        year.textContent = week.getFullYear();
        // A January right at the start already shows the year: drop the
        // first column's year so the two don't overlap.
        if (firstYear && weeks < 3) firstYear.textContent = '';
      }
    }
    // The first column also shows its year, so the start of the graph is clear.
    if (weeks === 0 && !year.textContent) {
      year.textContent = week.getFullYear();
      firstYear = year;
    }
    yearRow.append(year);
    monthRow.append(month);

    const column = h('div', { class: 'activity-week', role: 'row' });
    for (let i = 0; i < 7; i++) {
      const iso = toISODate(addDays(week, i));
      if (iso > today) { column.append(h('span', { class: 'day future' })); continue; }
      const count = byDate.get(iso)?.length || 0;
      const cats = dayCategories(iso);
      // The square is split into one slice per category trained that day:
      // 1 = whole square, 2 / 3 = horizontal halves / thirds (stacked top to
      // bottom), 4 = quarters (2 × 2). --slices is the number of columns.
      const cell = h('button', {
        class: `day${count ? ' trained' : ''}${iso === today ? ' today' : ''}`,
        role: 'gridcell',
        style: cats.length >= 4 ? '--slices:2' : null,
        'aria-label': `${formatDate(iso)}: ${count
          ? `${count} session${count === 1 ? '' : 's'}, ${cats.map(([, label]) => label).join(', ')}`
          : 'no session'}`,
      }, cats.map(([key]) => h('span', { class: `slice cat-${key}` })));
      cell.addEventListener('click', () => selectDay(cell, iso));
      column.append(cell);
    }
    grid.append(column);
  }

  const scroller = h('div', { class: 'activity-scroll' },
    h('div', { class: 'activity-inner' },
      yearRow,
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
    // Legend: the four categories always, "Other" only when it occurs.
    h('div', { class: 'activity-legend muted small', 'aria-hidden': 'true' },
      ACTIVITY_CATEGORIES.filter(([key]) => key !== 'other' || usedCategories.has('other')).map(([key, label]) =>
        h('span', { class: 'legend-item' }, h('span', { class: `swatch cat-${key}` }), label))),
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
  const meters = cardio.reduce((n, e) => n + (e.distance || 0), 0);
  const round = (n) => Math.round(n * 10) / 10;

  const tile = (value, label) => h('div', { class: 'stat-tile' },
    h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));

  return h('section', { class: 'stat-tiles' },
    tile(workouts.length, 'Workouts'),
    tile(round(workouts.length / weeks), 'Per week (avg)'),
    tile(days, 'Training days'),
    tile(sets, 'Strength sets'),
    tile(round(minutes), 'Cardio minutes'),
    // Distance is entered in metres; long totals read better in km.
    meters > 0 && (meters >= 10000
      ? tile(round(meters / 1000), 'Cardio km')
      : tile(Math.round(meters), 'Cardio metres')));
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
