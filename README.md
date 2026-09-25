# B-Fit

A simple fitness tracker you can install on your phone. It's a Progressive Web App built with plain HTML, CSS and JavaScript. There's no framework and no build step.

- Record strength sets (kg × reps) and cardio exercises (minutes and intensity level)
- Values from the last time you did an exercise are filled in for you, and a new set copies the previous one
- Unsaved input is autosaved, so closing the app loses nothing
- History with category and muscle-group filters, a progress chart for each exercise
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
js/exercises.js   Exercise list + progress page
js/chart.js       small SVG line chart
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

In the repository go to **Settings → Pages**. Under "Build and deployment", set Source to "Deploy from a branch", then pick branch `main` and folder `/ (root)`.
The app will be available at https://axthedragon.github.io/B-Fit/

After changing the list of files in `sw.js`, bump `CACHE_VERSION` there.
