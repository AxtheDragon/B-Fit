/* Small shared helpers: DOM building, dates, formatting. */

/** Broad categories that muscle groups belong to. */
export const CATEGORIES = {
  upper: 'Upper body',
  lower: 'Lower body',
  core: 'Core',
};

/**
 * Create a DOM element.
 *   h('button', { class: 'btn', onclick: fn }, 'Save')
 * Attributes starting with "on" become event listeners, `null`/`false`
 * attributes are skipped. Children can be strings, nodes, arrays or null.
 * Text is always inserted as text, so user input can never inject HTML.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (key === 'value') {
      el.value = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, value);
    }
  }
  appendChildren(el, children);
  return el;
}

/** Like el.replaceChildren(), but accepts the same children as h() (arrays, null, false). */
export function setChildren(el, ...children) {
  el.replaceChildren();
  appendChildren(el, children);
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

/** Like el.append(), but accepts the same children as h(). */
export function add(el, ...children) {
  appendChildren(el, children);
}

/** Today's date as "YYYY-MM-DD" in local time. */
export function todayISO() {
  return toISODate(new Date());
}

/** Current time as "HH:MM". */
export function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Date as "YYYY-MM-DD" in local time. */
export function toISODate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-09-25" -> Date at local midnight (avoids UTC off-by-one). */
export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "2026-09-25" -> "Fri, 25 Sep 2026" */
export function formatDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  return parseISODate(iso).toLocaleDateString(undefined, opts);
}

/** Parse a number typed by the user ("62,5" also works). Empty -> null. */
export function toNumber(value) {
  if (value == null) return null;
  const s = String(value).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Number -> string for input fields (null -> ""). */
export function numToStr(n) {
  return n == null ? '' : String(n);
}

/** Format a strength set: "60 kg × 10" or "× 12" for bodyweight. */
export function formatSet(set) {
  return set.weight != null ? `${set.weight} kg × ${set.reps}` : `${set.reps} reps`;
}

/** One-line summary of a session entry, e.g. "3 sets · top 60 kg" or "20 min · level 8 · 5 km". */
export function entrySummary(entry) {
  if (entry.type === 'cardio') {
    // Every cardio field is optional, so only list the ones that were entered.
    const parts = [];
    if (entry.duration != null) parts.push(`${entry.duration} min`);
    if (entry.intensity != null) parts.push(`level ${entry.intensity}`);
    if (entry.distance != null) parts.push(`${entry.distance} km`);
    if (entry.laps != null) parts.push(`${entry.laps} lap${entry.laps === 1 ? '' : 's'}`);
    return parts.join(' · ') || 'done';
  }
  const n = entry.sets.length;
  const weights = entry.sets.map((s) => s.weight).filter((w) => w != null);
  const top = weights.length ? ` · top ${Math.max(...weights)} kg` : '';
  return `${n} set${n === 1 ? '' : 's'}${top}`;
}

/** Sort sessions newest first (by date, then time, then creation time). */
export function sortSessionsDesc(sessions) {
  return sessions.sort((a, b) =>
    b.date.localeCompare(a.date) ||
    (b.time || '').localeCompare(a.time || '') ||
    (b.createdAt || 0) - (a.createdAt || 0));
}

/** "Fri, 25 Sep 2026 · 18:30 · Gym" – the parts that exist. */
export function sessionHeading(session, dateOpts) {
  return [formatDate(session.date, dateOpts), session.time, session.location].filter(Boolean).join(' · ');
}

/** Show a short message at the bottom of the screen. */
let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

/** Make a lookup Map from a list of records with an `id`. */
export function byId(list) {
  return new Map(list.map((item) => [item.id, item]));
}
