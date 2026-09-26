# B-Fit

A simple fitness tracker you can install on your phone. It's a Progressive Web App built with plain HTML, CSS and JavaScript. There's no framework and no build step.

- Record strength sets (kg × reps) and cardio exercises (minutes, intensity level, distance, laps – all optional)
- Sessions have a date, time, optional location and note; each exercise can have its own note
- Exercises in a session can be reordered
- Values from the last time you did an exercise are filled in for you, and a new set copies the previous one
- Unsaved input is autosaved, so closing the app loses nothing
- History with category and muscle-group filters, a progress chart for each exercise
- Stats: activity graph of training days, workouts per week/month, totals and most frequent exercises
- Everything is stored on the device in IndexedDB, with no account and no server
- Works offline and can be installed with "Add to Home screen"
- Export and import a JSON backup under **Settings**

## Files

```
index.html        app shell + bottom navigation
manifest.json     PWA manifest
sw.js             service worker (offline cache)
css/style.css     styles (mobile-first, dark mode)
js/app.js         router + service worker registration
js/db.js          IndexedDB storage, seed data, export/import
js/record.js      Record screen (start screen) + add-exercise sheet
js/history.js     History list, filters, session detail
js/stats.js       Stats screen (activity graph + statistics)
js/filters.js     category / muscle-group filter (History + Stats)
js/exercises.js   Exercise list + progress page
js/chart.js       small SVG line and bar charts
js/version.js     app version (shown in Settings)
js/settings.js    Backup + muscle groups
js/util.js        helpers
icons/            app icons
```

## Run locally

Any static web server works, for example:

```
npx http-server -p 8080
```

Then open http://localhost:8080. Service workers need `localhost` or HTTPS.

## Deploy (GitHub Pages)

Go to **Settings → Pages** and set Source to **GitHub Actions**. After that, the workflow
`.github/workflows/pages.yml` publishes the app on every push to `main`. You can also run it by hand from the
Actions tab. The app is available at https://axthedragon.github.io/B-Fit/

## Releasing a new version

1. Raise `APP_VERSION` in `js/version.js`.
2. Bump `CACHE_VERSION` in `sw.js`, and add any new files to its list.
3. Push to `main`.

Installed apps pick up the new version the next time they're opened (sometimes only on the second start).
