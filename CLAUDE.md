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
"session_start", "session_end", "event_start", "event_end"), item_id, item_name, nth_today,
session_id, set_no, reps, seconds, weight, work_sec, rest_sec, intensity,
duration_min, choice, amount, unit, count, bp_sys, bp_dia, pulse, measures,
note
(work_sec / rest_sec on training sets: how long the set took, and the rest
before it — from the end of the previous set to "Start set".)
("measures" = { measure_id: number } for a button's own number fields;
CSV turns it into one column per id, named m_<id>.)

## Configurable event buttons (added after step 1)
Each event's "ask" list picks what the quick sheet asks after a tap,
in that order: "intensity" (1-10), "duration_min", "choice" (pick from
the event's "choices" list, e.g. which medicine; "Other…" adds a new
one to the list), "amount" (one-tap values from
"amount": {"unit": "mg", "values": [200, 400]}, or type any number),
"count" (how many at once, 1-10; the button's daily total adds these
up), "bp" (blood pressure + pulse, see below), "measures" (the
button's own number fields from "measures": [{"id": "weight", "name":
"Weight", "unit": "kg"}]; ids never change once created), "note". If only one
question is asked, one tap on the answer saves.
Blood pressure ("ask": ["bp"], combinable only with "measures" and
"note"; measures are asked once, with reading 1, and shown/exported for
every reading of the series; tapping again within 30 min offers — ticked by
default — to continue that series; in the Log a reading can be joined into
another series of the same button within a day, which renumbers set_no
and nth_today): one tap
starts a SERIES of readings (measure, rest, measure again — numbers
settle as you relax). Each reading is its own log entry with its own
time; all share session_id = the first entry's id, and set_no is the
reading number (1, 2, 3...). A rest timer shows time since the last
reading. The button's daily count counts a series once. All of this is editable in Settings → ✎ / + Add a button.
Start/finish buttons ("span": true, not combinable with "bp"): first tap
logs kind "event_start" (asks the button's questions), button shows
"running 1 d 4 h"; next tap opens a sheet with "Finish now" (two taps on
purpose) which logs "event_end" with session_id = start id and
duration_min. The running start is worked out from the log (a start
with no end). Editing either time recalculates the end's duration_min.
Example:
  { "id": "medicine", "name": "Medicine", "ask": ["choice", "amount"],
    "choices": ["Paracetamol", "Ibuprofen"],
    "amount": { "unit": "mg", "values": [200, 400, 500, 1000] } }

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
- Step 3 done: Log screen → tap an entry → edit date, time, every
  value it has (or its button asks for) and the note, or Delete (with
  Undo in the toast). Moving an entry to another day renumbers only
  that entry's nth_today; other entries are never touched.
- Step 2 done (training): Training tab → routine or Free session.
  Open session = kv "open_session" in storage (routine, steps, current
  exercise, stepper drafts); every set is appended to the log at once,
  so closing the app loses nothing and a banner offers "continue".
  Records: session_start (session_id = its own id), set (item_id =
  exercise, set_no, reps|seconds, weight, note), session_end
  (duration_min). Stepper starts at: last set this session → first set
  of last session → routine goal → exercise "start" → 10 reps / 30 s.
  Reaching a routine goal jumps to the next unfinished exercise.
  Set flow (rewritten after user feedback): ▶ Start set stops the rest
  timer and starts the set; ✓ Done logs it (work_sec, rest_sec) and starts
  rest. Phase is saved in the session ("phase", "work", "rest_from"), so a
  set in progress survives closing the app. Same big button for Start and
  Done → taps within 1.2 s of each other are ignored. Rest goal (kv
  "tr_rest_goal", default 90 s) beeps once when reached; sound toggle (kv
  "tr_sound"). Exercises in seconds: Start = 5 s "get ready" (3-2-1 ticks),
  countdown of the stepper's seconds, auto-logged with a beep.
  Circuits (type seconds + "parts"; asked for as "plank 30 s, legs up 30 s
  without stopping, a sound at every switch"): "parts": [{"name",
  "seconds"}], optional "rounds" (repeat the list, 1-50) and "pause"
  (seconds between parts, 0-600). One set runs everything in a row: a
  timeline of segments (work/pause) is planned at Start and saved in the
  session (work.segs); beeps: go, switch at each new part, a softer
  "pause" sound, 3-2-1 ticks before every change. Logged seconds = work
  actually done (pauses not counted; Done mid-circuit logs what was done),
  work_sec = whole time. Circuit editor (trainingEditor.js
  openCircuitEditor): "+ New circuit" in the workout's exercise picker,
  Settings → Exercises, and the exercise editor's "Seconds" tip; "✎ Edit
  circuit" on the training card. Old format (parts = plain names) still
  works: every part uses the stepper's seconds; editing converts it.
  Choosing a circuit's exercises (asked for as "choose from existing
  exercises, timed first, then all the library; e.g. sit-ups, as many as
  I can in a set time"): the circuit editor keeps its state in a model
  and opens exercisePicker in "circuit" mode in the same sheet (timed
  exercises first — yours + library — then your reps exercises, then the
  library's; no circuits; several taps in a row, "✓ Done" goes back). A
  library pick is added to the config right away. A part stores "ex" (the
  exercise id). A part whose exercise is "reps" = "max reps": during it
  the timer says "As many as you can!", and after the circuit (also after
  "Log set without timer") a skippable sheet asks how many per part and
  round; each answer is its own set record of that exercise with reps AND
  seconds (= the time box), ts = when that part ended, session_id = the
  session. state.entries is re-sorted by ts after that (the whole app
  expects time order). fmtSet shows such a set as "25 (30s)".
  alerts.js: Web Audio beeps + vibration + screen wake lock during a
  session (timers can't beep with the screen off).
  Config: exercise "start"; routine steps may be "id" or
  {"id", "sets", "reps"}. Settings has editors for exercises and
  routines, plus "Add missing preset exercises & routines" (merges
  default_config.json by id, changes nothing existing).
- Exercise library: `www/exercise_library.json` (~100 street-workout
  exercises, names in en/he/ru, categories, 2 circuits). Reference data
  only — copied into the config when picked (library circuits get
  {"name", "seconds": start} parts). `library.js` (match by id or
  by name in any language, so duplicates aren't offered; translate built-in
  names), `exercisePicker.js` (search own + library, or "Create" a new
  one; used by Training "+ Exercise" and Settings "+ Add from library").
  Settings → Language → "Use … names for built-in items" renames only
  items whose name is still a built-in name in some language (by id or by
  name), never names the user typed. Default config exercise names must
  equal the library names (checked when the library was built).
- Events screen shows "Recent": the last 5 events; ✕ deletes (toast
  Undo), tapping a row opens the same edit sheet as the Log
  (log.js exports openDetails / deleteWithUndo for this).
- About screen (`about.js`, route #about, not a tab — the header ⓘ and a
  button at the top of Settings open it): what the app is, privacy,
  backup, install, how to use, language, "not medical advice" + Israeli
  help lines (ERAN 1201, MDA 101), the GitHub link, "Share this app"
  (navigator.share, else copy the link). The version shown is read from
  the service worker's cache name (tracker-vN), so it's never stale. The
  code is described as public, not "open source": the repo has no
  LICENSE (the user's call). README.md is written for the people the app
  is shared with (privacy, install, AI helper, he/ru sections) — keep it
  in step with features.
- AI helper (`ai.js`, Settings → "Change with AI", and Language → "Add a
  language with AI"). Asked for as "a prompt for any capable AI that edits
  the setup file and translates it, so the app is in any language".
  - Setup prompt = format rules + the current config WITHOUT private
    events (privacy) and without "language". On paste, private events
    missing from the answer are put back at their old positions.
  - Translation prompt = every DICT key with its English (ALL_CAPS keys
    give their "en" text) + "lib:<id>" / "cat:<id>" library names; it
    asks for {"language": {code, name, dir, texts}}. "Copy a prompt for
    the missing texts" sends only what's still untranslated; pasting the
    same language code again ADDS texts.
  - Pasting: the JSON is taken from a ```json block or the outermost {…}
    (a retry drops trailing commas); a cut-off translation still yields
    every complete "key": "text" pair. The merged config is validated,
    a summary of what changes is shown, Save has Undo, and a new language
    is switched to. "Save as a file to share" / "Open a language file".
- Added language: config "language" = {code, name, dir, texts}
  (validated in config.js). i18n.js setLanguagePack() is called on every
  config load; languages() = built-ins + the added one; t() prefers its
  texts for its code (it can also improve he/ru). Its texts come from
  outside, so cleanPack() drops a text whose {placeholders} differ from
  the English, strips < >, and turns " into “ ” (many t() results go into
  innerHTML/attributes unescaped). libName/catName use "lib:"/"cat:"
  texts; "Use … names for built-in items" in an added language only uses
  names it really has (never English). The translation also carries
  "def:events:<id>" / "def:routines:<id>" (starting buttons/routines) so
  those get renamed too.
  Bug found by the user (Arabic): after "Use العربية names", going back to
  English and "Use English names" left the exercises in Arabic, and
  removing the language too. Fixed: translateBuiltInNames counts the added
  language's names (lib:/def:) as built-in names whatever the target, so
  they are renamed back; "Remove <language>" first renames built-in items
  back to the language the app returns to (once the pack is gone its
  names can't be told from typed ones); circuit parts named after a
  built-in exercise follow it. Routine lines on the Training start screen
  wrap each "name sets×reps" in <bdi>, so names in another script (Arabic
  in an English UI, English in Hebrew) don't scramble the order.
- UI languages: English, Hebrew (RTL), Russian. `www/js/i18n.js`:
  t('English text {var}', {var}) — the English text is the key, so a
  missing translation just shows English. New UI text MUST go through
  t() with he/ru added to DICT. Language: phone language on first run,
  then Settings → Language (kv "ui_lang"). Hebrew sets dir="rtl"; CSS
  uses logical properties (inline-start/end, text-align: start) — keep
  it that way. Names typed by the user are never translated. Starting
  config per language: default_config.json / .he.json / .ru.json (same
  ids). Config validation errors stay English (they name JSON keys).
  Settings → Layout: Automatic (Hebrew mirrors) / Left → right /
  Right → left (kv "ui_dir"). When the layout direction differs from
  the language's, <html> gets class "bidi-plain" so each text picks its
  own direction (unicode-bidi: plaintext) while the layout stays put.
- Event buttons can have "color": "#rrggbb" (validated; editor offers
  10 swatches in config.js COLORS). Missing color = plain gray button.
- ts includes milliseconds (…T15:03:05.123+03:00) so entries made in
  the same second sort correctly.
- `.gitignore` blocks exported logs/backups so personal data can't be
  committed by accident.
- Reference: `reference/watch_drift.py` (Termux/curses app) and
  `reference/watchdrift-android/` (its native Kotlin/Compose port, from
  WatchDrift-android.zip). Removed from the port because they were my
  personal data: `app/src/test/resources/watch_drift.json` (real
  readings), `reference.json` (derived from it) and
  `app/src/main/assets/watch_profiles.json` (my watches). So its
  StatsTest no longer runs — it's reference code only, not built.
  There were no keystores or passwords in it.

### Lessons from the reference apps (for storage and the APK, step 5)
- DON'T copy `watch_drift.py`'s `save_data()`: it rewrites the whole
  file in place (a crash mid-write loses everything), and `load_data()`
  returns an EMPTY dataset on a parse error, so the next save wipes the
  log. Never treat an unreadable log as empty.
- DO copy the Android port's `data/DataStore.kt` pattern for the
  Capacitor Filesystem storage: write to `.tmp`, keep a `.bak` of the
  last good file, then rename; on load, fall back to `.bak` if the main
  file is missing or broken. For `tracker_log.jsonl` prefer appending
  one line per entry; skip (and report) unreadable lines instead of
  failing the whole file. Rewrite the whole file (tmp + rename) only
  for explicit edit/delete.
- Import = merge by id, existing entry wins (DataStore.merge). The web
  app already does this.
- Config live-reload: `load_profiles()` re-reads only when the file's
  mtime changes, and a malformed file never stops the app. Ours goes
  further and keeps the last good config.
- `res/xml/backup_rules.xml` + `data_extraction_rules.xml`: include the
  data files in Android auto-backup. Worth adding to the Capacitor
  android project.
- The port has NO signing config. For a downloadable APK from GitHub
  Actions, a debug-signed APK is enough to install on my phone; if a
  release keystore is ever made, keep it in GitHub Secrets, never in
  the repo.
- The port targets compileSdk 34, minSdk 26, Java 17 — a sane baseline
  for the Capacitor android project too.
