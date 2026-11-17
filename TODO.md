# ToDo

Open findings and small jobs. Most come from the full code review of v1.5.1
(November 2026). They are not urgent: fix each one when that part of the code
is changed anyway.

Each item has an id. The affected code carries a `TODO(Tn)` comment, so
`grep -rn "TODO(T" js sw.js` lists every spot. When an item is fixed, remove
its comments and move it to "Done" with the version it shipped in.

## Open

### Data safety

- **T1 · Settings says the safety copy is "up to date" when it is not**
  If writing the local safety copy fails (for example because localStorage is
  full), the error only goes to the console, and Settings still reports the
  copy as up to date with an old session count. The 5 MB limit itself is an
  accepted risk; the problem is that hitting it is invisible.
  Reproduced: 3 sessions in the app, Settings said "up to date (2 sessions)".
  *Affected:* `js/db.js` `writeMirror()` (catch block), `js/settings.js`
  storage health list ("Local safety copy" line).
  *Idea:* remember the last failed write (time + error) and show it in
  Settings instead of "up to date"; possibly compare the copy's session count
  with the database.

- **T2 · Import does not check the backup format number**
  `exportAll()` writes `format: 1`, but `validateBackup()` never reads it, so
  an older app would accept a backup written in a future format.
  *Affected:* `js/db.js` `validateBackup()`.
  *Idea:* refuse `format > 1` with "This backup was made with a newer B-Fit
  version. Update the app first."

- **T3 · Backup reminder counts imported sessions as "not in a backup"**
  The reminder compares each session's `createdAt` with the last backup date.
  After importing a backup, sessions created after the last recorded backup
  on this device count as not backed up, although they came from a backup.
  *Affected:* `js/backup.js` `sessionsSinceBackup()` / `shouldNudge()`,
  `js/db.js` `importAll()`.
  *Idea:* treat an import as a backup point (record it in the backup state).

### Record screen

- **T4 · "Edit session" silently drops unsaved edits to the same session**
  While a session is being edited on Record, opening that same session in
  History and tapping "Edit session" again reloads the saved version without
  asking. The check only asks when a *different* session is in the form.
  Reproduced.
  *Affected:* `js/record.js` `editSession()`.
  *Idea:* if the draft already edits this session, just go to Record and keep
  the draft.

- **T5 · A deleted session comes back**
  Deleting a session in History while it is open for editing on Record leaves
  the edit form in place; "Save changes" then creates the session again.
  Reproduced.
  *Affected:* `js/history.js` `renderDetail()` delete handler,
  `js/record.js` `save()` (and `render()`).
  *Idea:* on delete, discard a draft that edits this session (ask first), or
  in `save()` notice that the session no longer exists and ask whether to
  save it as a new one.

- **T6 · Save can run twice**
  "Save session" has no guard: two clicks in quick succession saved two
  identical sessions. Reproduced with scripted clicks; a real double tap is
  unlikely but possible. "Add" in the new-exercise form has the same gap.
  *Affected:* `js/record.js` `save()`, `create()` in `openAddSheet()`.
  *Idea:* disable the button (or ignore clicks) while saving.

- **T7 · Clearing the date field keeps the old date without saying so**
  An empty date is ignored, so the field looks empty but the old date is
  saved.
  *Affected:* `js/record.js` date input in `build()`.
  *Idea:* on blur, put the stored date back into the field.

- **T8 · Number fields accept `0x10` and `1e3`**
  `toNumber()` uses `Number()`, which also parses hex and exponent notation,
  so "0x10" is saved as 16.
  *Affected:* `js/util.js` `toNumber()`.
  *Idea:* only accept digits with one optional `.` or `,`.

### Service worker and start-up

- **T9 · The service worker can overwrite the cached start page**
  Every page navigation in the app's scope is cached under `index.html`.
  After opening `/README.md` directly, the next offline start showed the
  README instead of the app. It repairs itself on the next online start.
  Reproduced.
  *Affected:* `sw.js` fetch handler.
  *Idea:* only store a navigation response as `index.html` when it is the
  app's own start page (URL is `./` or `index.html`).

- **T10 · App updates can mix file versions** (not reproduced)
  Every cached file is refreshed on its own in the background. If the
  connection drops halfway through after a deploy, the next start can load
  new and old modules together and fail until the following online start.
  *Affected:* `sw.js` fetch handler (stale-while-revalidate).
  *Idea:* rely on the versioned cache from `install` (a new `CACHE_VERSION`
  downloads all files at once) and stop updating single files in the
  background.

- **T11 · Blank screen if the database never opens**
  If the browser neither opens the database nor reports an error (for
  example blocked by another tab), the app stays blank with no message.
  *Affected:* `js/app.js` start-up (`openDB().then(...)`), `js/db.js`
  `openDB()` `onblocked`.
  *Idea:* show "Still opening storage… close other B-Fit tabs" after a few
  seconds.

### Project

- **T12 · No automated tests**
  The data safety code (import validation, atomic replace, undo, safety copy
  restore and freeze) is the part that most needs tests, and has none.
  *Affected:* repository as a whole; mainly `js/db.js`.
  *Idea:* a few Playwright tests against a local server, run in a GitHub
  Actions workflow on pull requests.

## Done

(nothing yet)
