# Watch Drift — Android

Native Android port of `watch_drift.py`, the Termux/curses watch drift recorder.

Open the `WatchDrift/` folder in Android Studio and hit Run. Nothing else to configure.

- **minSdk 26**, targetSdk 34, Kotlin 2.0.20, Jetpack Compose (Material 3)
- No third-party runtime dependencies — the NTP client is written from scratch
- Requires only `INTERNET` and `ACCESS_NETWORK_STATE`

---

## The one thing to know before changing anything

`app/src/test/` contains the Python engine's actual output on the real
`watch_drift.json` — six watches, 59 readings — and asserts the Kotlin
reproduces it to 1e-6.

**As ported, it does: 350 checks, 0 failures.** That covers every watch's
segmentation, regression slope, intercept, slope standard error, lifetime
rate, prediction and read-error, plus all 60 deviation cases and 8 tap-solver
scenarios including the outlier-trimming thresholds.

If a change makes those tests fail, the change is wrong — the constants and
branch structure were arrived at empirically against real readings, not chosen
for elegance. Run them with:

```
./gradlew :app:testDebugUnitTest
```

To regenerate the reference data after intentionally changing the Python
engine, re-run the generator against `watch_drift.py` and replace
`app/src/test/resources/reference.json`.

---

## Data compatibility

The on-disk format is **byte-compatible with the Termux app's
`watch_drift.json`**. Readings move in either direction with no conversion.

- **Info tab → Import** — Merge (default) is a union keyed by reading id and
  cannot lose a reading. Replace discards everything first.
- **Info tab → Export** — writes the same schema back out.

Unknown JSON keys are preserved through a load/save cycle, so a file written
by a newer Python version is not silently stripped by this app.

`watch_profiles.json` ships in `assets/`. A copy placed in the app's files dir
overrides it, so profiles stay hand-editable.

---

## What changed from the Python version, and why

Three things are genuinely different. Everything else is a direct port.

**1. Timing uses the monotonic clock, not the wall clock.**

Python stored a wall-clock offset (`time.time() * 1000 + ntp_offset_ms`). On a
phone the wall clock can be stepped at any moment by the OS or the network
operator. A step landing mid-run would be fitted as watch drift and never
questioned. The NTP sync now anchors to `SystemClock.elapsedRealtime()`, which
is immune to clock changes, and all tap timestamps live in that domain.

**2. Taps are timestamped from the input event, not from the handler.**

`MarkScreen.tapPad` reads the pointer event's own `uptimeMillis`, stamped by
the input system when the touch arrived, and takes it on pointer-DOWN rather
than on click.

Both parts matter. A `Button`'s `onClick` fires on *release*, so the recorded
instant would include however long the finger stayed on the glass — variable,
tens to hundreds of ms, which is precisely the jitter tap-averaging exists to
beat. And a clock read inside the handler is late by the length of any UI
stall, which is the exact failure the solver's outlier trimming had to be
built to survive.

This should show up as lower `tapJitterMs` than the Termux app on the same
watch. Worth checking once there are a few runs to compare — if it doesn't,
one of the assumptions above is wrong.

**3. The maths core has no Android or JSON dependency.**

`core/` and `data/Models.kt` are plain Kotlin, so the engine is testable on a
bare JVM with nothing mocked. JSON mapping lives in `data/Json.kt`.

Note that Android's bundled `org.json` is a stub that throws in local unit
tests, which is why `org.json:json` is a `testImplementation` dependency. It
is not shipped in the APK.

---

## Layout

```
core/       Stats.kt      regression, segmentation, error budget
            TapSolver.kt  tick counting, outlier trimming, beat drift
            Recorder.kt   builds a Reading; error budget; sync pruning
            Format.kt     display formatting
data/       Models.kt     domain types, no dependencies
            Json.kt       watch_drift.json mapping
            DataStore.kt  atomic save + .bak, import/export/merge
            Profiles.kt   watch_profiles.json
ntp/        SntpClient.kt RFC 4330 over UDP, best-of-4 by lowest rtt
            NtpRepository.kt  sync state, staleness, snapshot
ui/         AppViewModel.kt  + screens/ (Watches, Mark, Log, Detail, Trend, Info)
```

---

## Behaviour worth preserving

These are invariants, not preferences — each one exists because getting it
wrong produces data that looks fine and is wrong.

- **Recording is refused, not warned about, when NTP is unsynced or over 30
  minutes stale.** An unsynced phone can be a second or more out, and that
  error would be recorded as watch drift.
- **One NTP snapshot per reading.** A reading must be computed from, and
  labelled with, the same sync. Sampling the state twice lets a background
  sync land in between.
- **`postSync` is for when the watch itself was changed** (crown, reset,
  radio or Bluetooth sync) — it starts a new segment. Flagging a reading
  where the watch was not touched throws away the span that gives the rate
  its precision.
- **Minute-adjust rows do not break segments.** `totalOffsetSec` is
  continuous through a minute correction.
- **Stored offsets keep 3 decimal places.** Rounding to 0.1s is coarser than
  the measurement (~20 ms tap, ~50 ms press) and puts a 100 ms staircase into
  the data the regression fits.
- **A press keeps its fractional second.** Truncating is biased by *sign* —
  a slow watch truncates toward zero, a fast one away from it — which bends a
  fit rather than blurring it. The uncertainty belongs in `readErrSec`.
- **`Math.rint`, not `roundToInt`,** wherever the Python used `round()`.
  Python breaks .5 ties to even; Kotlin rounds half up. On tick counts that is
  a whole second.

---

## Known gaps

- **No `tempC` capture UI yet.** The field is in the model and round-trips
  through JSON, ready for a reading to carry the drawer temperature. Nothing
  writes it yet.
- **Profile editing is import-only** — there is no in-app editor for
  `watch_profiles.json`.
- The Compose UI has not been run on a device in this session; the engine
  underneath it is verified, the screens are not.
