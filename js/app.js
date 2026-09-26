/*
 * App entry point: a tiny hash router plus service worker registration.
 *
 * Routes:
 *   #/               Record session (start screen)
 *   #/history        Session list with filters
 *   #/session/12     One session (view / edit / delete)
 *   #/stats          Activity graph + statistics
 *   #/exercises      Exercise list
 *   #/exercise/3     Progress for one exercise
 *   #/settings       Backup (export / import) and muscle groups
 */
import { openDB } from './db.js';
import * as record from './record.js';
import * as history from './history.js';
import * as stats from './stats.js';
import * as exercises from './exercises.js';
import * as settings from './settings.js';

const main = document.getElementById('app');

const routes = [
  { pattern: /^\/?$/, nav: 'record', screen: record.render, leave: record.leave },
  { pattern: /^\/history$/, nav: 'history', screen: history.renderList },
  { pattern: /^\/session\/(\d+)$/, nav: 'history', screen: history.renderDetail },
  { pattern: /^\/stats$/, nav: 'stats', screen: stats.render },
  { pattern: /^\/exercises$/, nav: 'exercises', screen: exercises.renderList },
  { pattern: /^\/exercise\/(\d+)$/, nav: 'exercises', screen: exercises.renderDetail },
  { pattern: /^\/settings$/, nav: 'settings', screen: settings.render },
];

let current = null;   // route currently shown
let renderId = 0;     // guards against a slow render finishing after a newer one

async function router() {
  const path = location.hash.replace(/^#/, '') || '/';
  let match = null;
  const route = routes.find((r) => (match = path.match(r.pattern))) || routes[0];

  // Give the previous screen a chance to save state (e.g. the draft).
  if (current && current.leave) await current.leave();
  current = route;

  // Highlight the active item in the bottom navigation.
  document.querySelectorAll('.bottom-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route.nav);
    if (a.dataset.route === route.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  const id = ++renderId;
  const container = document.createElement('div');
  const param = match && match[1] ? Number(match[1]) : null;
  try {
    await route.screen(container, param);
  } catch (err) {
    console.error(err);
    container.replaceChildren(Object.assign(document.createElement('p'), { textContent: `Something went wrong: ${err.message}` }));
  }
  if (id !== renderId) return; // user already navigated elsewhere
  main.replaceChildren(container);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', router);

// Start: open the database (creates it on first run), then show the screen.
openDB().then(router).catch((err) => {
  main.textContent = `Could not open storage: ${err.message}`;
});

// Ask the browser not to evict our data when space runs low (best effort;
// installed PWAs usually get this granted automatically).
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then((isPersisted) => { if (!isPersisted) navigator.storage.persist(); });
}

// Offline support + installability.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  });
}
