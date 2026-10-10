/*
 * Activity graph colours: one per category, customizable in Settings.
 *
 * The defaults live in css/style.css as --cat-upper, --cat-lower, ... (with
 * slightly different steps for dark mode). Custom colours are stored in the
 * `meta` store and set as inline CSS variables on <html>, so they win over the
 * defaults in both light and dark mode. Removing them restores the defaults.
 */
import { getMeta, setMeta } from './db.js';
import { CATEGORIES } from './util.js';

/** Categories in the fixed order the slices of a day square are drawn in. */
export const ACTIVITY_CATEGORIES = [
  ...Object.entries(CATEGORIES),
  ['cardio', 'Cardio'],
  ['other', 'Other'], // strength exercises without muscle groups
];

const KEY = 'activityColors';
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Custom colours as { upper: '#rrggbb', ... } (only the ones that were changed). */
export async function getCustomColors() {
  return (await getMeta(KEY)) || {};
}

/** Set the custom colours as CSS variables (missing ones fall back to the defaults). */
export function applyColors(colors) {
  const style = document.documentElement.style;
  for (const [key] of ACTIVITY_CATEGORIES) {
    if (isHex(colors[key])) style.setProperty(`--cat-${key}`, colors[key]);
    else style.removeProperty(`--cat-${key}`);
  }
}

/** Store and apply custom colours. An empty object means "all defaults". */
export async function saveColors(colors) {
  const clean = Object.fromEntries(Object.entries(colors).filter(([key, value]) =>
    ACTIVITY_CATEGORIES.some(([k]) => k === key) && isHex(value)));
  await setMeta(KEY, clean);
  applyColors(clean);
}

/** The colour currently shown for a category, as "#rrggbb" (for <input type=color>). */
export function currentColor(key) {
  // Resolve the CSS variable (it may itself refer to another one) through a probe element.
  const probe = document.createElement('span');
  probe.style.color = `var(--cat-${key})`;
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+/g).slice(0, 3).map(Number);
  probe.remove();
  return `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Load the stored colours at app start. */
export async function loadColors() {
  applyColors(await getCustomColors());
}
