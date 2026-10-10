/*
 * App version, shown on the Settings screen and written into backups.
 * Raise it with every release (and bump CACHE_VERSION in sw.js with it,
 * so installed apps download the new files).
 *
 *   1.0  first release
 *   1.1  session time + location, exercise notes, reorder exercises,
 *        optional cardio fields incl. distance (m) and laps, Stats screen,
 *        exercise notes carry over to the next session
 *   1.2  activity graph: weekday labels stay visible while scrolling
 *   1.3  record page: repeat a previous session as a template
 *   1.4  activity graph: year row above the month labels, days coloured by
 *        category (split when several were trained), colours customizable
 *        in Settings, calendar-year view (Jan–Dec) with year picker;
 *        "1 year" renamed to "12 months"; Exercises page sorted A–Z
 *   1.4.1  exercises can be marked as warm-up; warm-ups are left out of
 *          the activity graph colours
 */
export const APP_VERSION = '1.4.1';
