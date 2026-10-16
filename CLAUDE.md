You are helping me build a personal tracking app for my Android phone.
Path: first a web app (PWA) I can test, then the SAME code wrapped
into an APK with Capacitor. reference/watch_drift.py in this repo is
an older app of mine. Use it as the reference for logic and data
safety (live-reloaded JSON config, never crashing on a bad file,
debounce, editable log, comments that explain WHY), not for the UI.

## Goal
Log things in my life so I can analyze them later. Two kinds:
1. Quick events: unplanned things that just happen (headache, panic
   attack, private items). One tap logs it with date and time.
2. Training: planned sessions (mostly street workout / calisthenics)
   logged in sets with reps or seconds.

## Speed of use is the top priority
- Opens straight to the events screen. One tap = logged.
- Big touch targets, works offline, dark mode.
- Home screen shortcuts (long-press the app icon -> "Log headache",
  "Start training") via the web manifest, and later in the APK.

## Architecture
- Plain HTML, CSS, JavaScript (ES modules). No framework, no build
  step, so the same folder runs on GitHub Pages AND drops into
  Capacitor unchanged.
- All storage goes through ONE module (storage.js) with a small
  interface. Web version: IndexedDB. APK version: Capacitor
  Filesystem. Nothing else in the code may touch storage directly.

## Storage
- Append-only log; never overwrite old entries except explicit
  edit/delete. Writes must be crash-safe.
- APK version: log and config live as visible files in
  Documents/Tracker/ (tracker_log.jsonl, tracker_config.json).
- An open training session is saved after every set, so closing the
  app mid-workout loses nothing; it resumes on next open.
- Export: CSV and full JSON backup. Import a backup to restore.
- My log data must never be committed to this repo.

## Config (tracker_config.json)
- ALL events, exercises, and routines come from this file. Nothing
  is hardcoded in the JavaScript.
- Web version: ships with a default config plus an in-app JSON editor
  with validation and export. APK version: read from
  Documents/Tracker/ and re-read whenever the app comes back to the
  foreground, so I (or an AI) can edit it with any text editor.
- A broken config must never crash the app: keep the last good
  config and show what's wrong.
- I can also add, rename, hide, and reorder items in the app.
- "private": true items show "displayLabel" on screen; the real name
  appears only in the log and exports.
- The default config in the repo contains only neutral examples. I
  add my private items inside the app.

Example:
{
  "events": [
    { "id": "headache", "name": "Headache", "ask": ["intensity"] },
    { "id": "panic", "name": "Panic attack",
      "ask": ["intensity", "duration_min"] },
    { "id": "x1", "name": "My private item", "displayLabel": "X",
      "private": true }
  ],
  "exercises": [
    { "id": "pullups", "name": "Pull-ups", "type": "reps" },
    { "id": "pushups", "name": "Push-ups", "type": "reps" },
    { "id": "dips", "name": "Dips", "type": "reps", "allowWeight": true },
    { "id": "plank", "name": "Plank", "type": "seconds" }
  ],
  "routines": [
    { "id": "upper", "name": "Upper body",
      "exercises": ["pullups", "dips", "pushups"] }
  ]
}

## Events screen
- Grid of big buttons with today's count and time of the last one.
- Tap = logged instantly. Then an optional quick sheet for the "ask"
  fields (intensity 1-10 as one-tap chips); skippable.
- Ignore accidental double taps within a few seconds and say so.
- Each entry stores its number that day (#1, #2, ...). Undo button.

## Training screen
- Start from a routine or a free session.
- Per exercise: big +/- stepper for reps (or seconds), "repeat last
  set" button, optional weight and note.
- Show today's sets ("12 10 8"), last session's sets, and time since
  the last set (rest timer).
- Add any exercise mid-session. Finish shows a summary of sets and
  total reps per exercise.

## Log screen
- Newest first, grouped by day. Tap an entry to see details, edit
  amount or note, or delete (with undo).

## Stats screen
- Events per day and per week, sets and reps per exercise per week,
  as simple charts.

## Log record fields
id, ts (ISO 8601 with timezone), date, time, kind ("event", "set",
"session_start", "session_end"), item_id, item_name, nth_today,
session_id, set_no, reps, seconds, weight, intensity, duration_min,
note

## How to work with me
- I'm a beginner and I work from my phone. Explain every step simply.
- Build in steps: 1) events + config + log + export, hosted free on
  GitHub Pages so I can install and test it on my phone,
  2) training, 3) log edit/delete, 4) stats and config editor,
  5) build an APK with Capacitor and the Filesystem storage, using a
  GitHub Actions workflow so the APK builds in the cloud and I can
  download it from GitHub without a computer.
- After each step, tell me exactly what to test on my phone.
- If something is unclear, ask me one question before building.

## Project notes (kept up to date by Claude)
- The app lives in `www/` (Capacitor's default webDir). GitHub Pages
  publishes `www/` via `.github/workflows/pages.yml` on every push to
  `main`. Live URL: https://avielmer.github.io/tracker/
- When changing any file in `www/`, bump `VERSION` in `www/sw.js`
  (and add new files to its `SHELL` list), otherwise phones keep
  serving the old cached copy.
- `.gitignore` blocks exported logs/backups so personal data can't be
  committed by accident.
- Reference files: `reference/watch_drift.py` and
  `WatchDrift-android.zip` were NOT in the repo when the project was
  set up (step 1). Upload them to the repo root and ask Claude to move
  them into `reference/` (unzip the zip into
  `reference/watchdrift-android/`, strip any keystores/passwords/
  personal data, note anything useful for the APK step here).
