#!/usr/bin/env python3
"""
watch_drift.py — Watch Drift Recorder for Termux
Logic: press SPACE the moment YOUR WATCH shows :00.
  NTP seconds at that instant = deviation.
  :00 = perfect | :01..30 = watch slow by N sec | :31..59 = watch fast by (60-N) sec
  Use +/- to add/subtract whole minutes when drift exceeds ±30s.

Install: pip install ntplib
Run:     python watch_drift.py

Data file: ~/watch_drift.json  (visible, no leading dot)
If the old hidden file ~/.watch_drift.json exists, it is migrated
automatically on first run.
"""

import curses, json, os, threading, time
from datetime import datetime
from pathlib import Path

# ── Storage ────────────────────────────────────────────────────────────────────
# Data lives next to the script by default, so dropping an updated script into
# the same folder keeps using the same readings.
#
# Override with:  export WATCH_DRIFT_DIR=/some/path
# That matters if you keep the script somewhere disposable: point the data at
# a folder you do not overwrite, and the readings survive any script update.
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR   = Path(os.environ.get("WATCH_DRIFT_DIR") or SCRIPT_DIR)
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATA_FILE  = DATA_DIR / "watch_drift.json"
OLD_FILE   = Path.home() / ".watch_drift.json"    # legacy hidden file

def _profiles_path():
    """Prefer an edited copy in the data directory; otherwise the one that
    shipped beside the script."""
    p = DATA_DIR / "watch_profiles.json"
    return p if p.exists() else SCRIPT_DIR / "watch_profiles.json"

_profiles_cache = {"mtime": None, "list": []}

def load_profiles():
    """Reference data for each watch: movement, spec, storage, notes.
    Read-only as far as the app is concerned — it is a file you (or an AI)
    edit by hand, so it is re-read whenever it changes on disk rather than
    cached for the session. A malformed file must never stop the recorder,
    so any error just yields no profiles."""
    try:
        pf = _profiles_path()
        if not pf.exists():
            _profiles_cache["list"] = []
            return []
        mt = pf.stat().st_mtime
        if _profiles_cache["mtime"] != mt:
            with open(pf) as f:
                doc = json.load(f)
            _profiles_cache["list"]  = doc.get("profiles", [])
            _profiles_cache["mtime"] = mt
    except Exception:
        _profiles_cache["list"] = []
    return _profiles_cache["list"]

def draw_profile_notes(stdscr, row, W, H, w, prof, CYAN, DIM, GOLD, BOLD):
    """Render the profile reference panel. Returns the row after it.

    Lives in its own function because it is needed in two places: the normal
    Trend screen, and the <2-readings screen. The setup guidance in a profile
    (disable this sync, expect that bias, wear it or drawer it) is worth most
    BEFORE the first reading, so gating it behind a fitted rate had it
    backwards."""
    if not prof:
        sa(stdscr, row, 2,
           f"No profile for '{w['name']}' in watch_profiles.json — "
           f"add one with \"match\": \"{w['name']}\"", DIM)
        sa(stdscr, row+2, 2, "  [I] back to graph", GOLD)
        return row + 3
    sa(stdscr, row, 2,
       f"── {prof.get('display_name', w['name'])} "
       f"{prof.get('caseback','')} ──"[:W-3], CYAN | BOLD)
    row += 1
    if prof.get("spec_note"):
        for ln in _wrap(prof["spec_note"], W-6):
            if row >= H-3: break
            sa(stdscr, row, 4, ln, DIM); row += 1
    if prof.get("battery") and row < H-3:
        for ln in _wrap(f"battery: {prof['battery']}", W-6):
            if row >= H-3: break
            sa(stdscr, row, 4, ln, DIM); row += 1
    for note in prof.get("notes", []):
        for j, ln in enumerate(_wrap(note, W-8)):
            if row >= H-3: break
            sa(stdscr, row, 4, ("· " if j == 0 else "  ") + ln, 0)
            row += 1
    sa(stdscr, min(row+1, H-3), 2, "  [I] back to graph", GOLD)
    return min(row + 2, H-2)


def profile_for(watch):
    """Profile matching this watch, or None."""
    if not watch:
        return None
    name = (watch.get("name") or "").strip().lower()
    for p in load_profiles():
        if (p.get("match") or "").strip().lower() == name:
            return p
    return None

def watch_spec(watch):
    """Spec in s/yr: the watch's own setting wins, else the profile's."""
    if watch and watch.get("spec_s_per_year") is not None:
        return watch["spec_s_per_year"]
    p = profile_for(watch)
    return p.get("spec_s_per_year") if p else None

def watch_tolerance(watch):
    if watch and watch.get("tolerance_s") is not None:
        return watch["tolerance_s"]
    p = profile_for(watch)
    return (p.get("tolerance_s") if p else None) or 30

def load_data():
    # one-time migration: hidden file exists, visible one does not
    if OLD_FILE.exists() and not DATA_FILE.exists():
        try:
            OLD_FILE.rename(DATA_FILE)
        except Exception:
            pass
    if DATA_FILE.exists():
        try:
            with open(DATA_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {"watches": [], "readings": []}

def save_data(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

# ── NTP ────────────────────────────────────────────────────────────────────────
# Sync state. ntp_synced is the one that matters: if a sync has never
# succeeded, ntp_offset_ms is 0 and the app is silently using the raw phone
# clock. A phone can easily be a second or more out, which would be recorded
# as watch drift and never questioned. So an unsynced state must be loud.
ntp_offset_ms  = 0.0
ntp_synced     = False
ntp_sync_ts    = 0.0      # unix time of the last good sync
ntp_delay_ms   = None     # round-trip delay of the accepted sample
ntp_server_used = None
ntp_status     = "syncing NTP…"

# sync_ntp() runs on a background thread and updates six related globals in
# sequence. Under the GIL each assignment is atomic, so there is no torn value
# and no memory-barrier problem — but a reader can still catch the SET
# half-updated: synced=True with a stale offset, or a new offset paired with
# the previous server name. The lock below is not about visibility, it is
# about reading those six as one consistent group.
_ntp_lock = threading.Lock()

def ntp_snapshot():
    """All NTP state as one coherent group.

    A reading must be computed from, and labelled with, the SAME sync. Calling
    ntp_ok_to_record(), then ntp_now_ms(), then reading ntp_offset_ms lets a
    sync land in between, so the stored conditions would describe a different
    sync than the one the measurement used."""
    with _ntp_lock:
        return {
            "offset_ms": ntp_offset_ms,
            "delay_ms":  ntp_delay_ms,
            "synced":    ntp_synced,
            "sync_ts":   ntp_sync_ts,
            "server":    ntp_server_used,
            "now_ms":    time.time() * 1000 + ntp_offset_ms,
        }

NTP_STALE_S    = 1800     # after 30 min, warn that the sync is old
NTP_SAMPLES    = 4        # take several, keep the one with the least delay

NTP_SERVERS = [
    "pool.ntp.org",
    "time.google.com",
    "time.cloudflare.com",
    "time.windows.com",
    "il.pool.ntp.org",
]
ntp_server_idx = 0
_on_server_change = None   # set by App so the choice is persisted

def _sample_server(server):
    """Best of NTP_SAMPLES requests, chosen by lowest round-trip delay.

    NTP infers the offset assuming the network delay is symmetric out and
    back. A VPN breaks that: traffic leaves through a distant endpoint and
    the return path can differ, biasing the result by roughly half the
    asymmetry — hundreds of ms is realistic. The lowest-delay sample is the
    least likely to be distorted, and the delay itself is worth recording
    as a quality figure."""
    import ntplib
    c = ntplib.NTPClient()
    best = None
    last_err = None
    for _ in range(NTP_SAMPLES):
        try:
            r = c.request(server, version=3, timeout=4)
            d = r.delay * 1000
            if best is None or d < best[1]:
                best = (r.offset * 1000, d)
        except Exception as e:
            last_err = e
    if best is None:
        raise last_err or RuntimeError("no reply")
    return best

def sync_ntp(try_others=True):
    """Sync against the selected server, falling back to the others.

    Failover matters because the first server in the list is not reliably
    reachable; without it a failed sync leaves the app on the bare system
    clock while still looking normal."""
    global ntp_offset_ms, ntp_status, ntp_synced, ntp_sync_ts
    global ntp_delay_ms, ntp_server_used, ntp_server_idx

    order = [ntp_server_idx]
    if try_others:
        order += [i for i in range(len(NTP_SERVERS)) if i != ntp_server_idx]

    errors = []
    for i in order:
        server = NTP_SERVERS[i]
        ntp_status = f"syncing {server}…"
        try:
            offset, delay = _sample_server(server)
        except ImportError:
            ntp_synced = False
            ntp_status = ("ntplib MISSING — pip install ntplib. "
                          "Readings would use the raw phone clock: DO NOT record.")
            return
        except Exception as e:
            errors.append(f"{server}: {type(e).__name__}")
            continue

        with _ntp_lock:
            ntp_offset_ms   = offset
            ntp_delay_ms    = delay
            ntp_sync_ts     = time.time()
            ntp_server_used = server
            ntp_synced      = True      # last: nothing is "synced" until the
                                        # values it refers to are all in place
        if i != ntp_server_idx:
            # this one worked and the preferred one didn't — make it the
            # preferred one, so the next launch starts where you left off
            ntp_server_idx = i
            if _on_server_change:
                _on_server_change(server)
        ntp_status = (f"NTP OK [{server}]  offset {offset:+.0f}ms  "
                      f"rtt {delay:.0f}ms")
        return

    ntp_synced = False
    ntp_status = ("NTP FAILED (" + ", ".join(errors[:3]) +
                  ") — N=retry  P=server.  NOT SYNCED: do not record.")

def ntp_age_s():
    return (time.time() - ntp_sync_ts) if ntp_synced else None

def ntp_ok_to_record(snap=None):
    """(ok, reason). Recording against an unsynced or stale clock produces
    data that looks fine and is wrong, so it is refused rather than warned
    about."""
    s = snap or ntp_snapshot()
    if not s["synced"]:
        return False, "NOT SYNCED to NTP — press N to sync first."
    age = time.time() - s["sync_ts"]
    if age > NTP_STALE_S:
        return False, (f"NTP sync is {age/60:.0f} min old — press N to "
                       f"re-sync before recording.")
    return True, ""

def resync_ntp():
    threading.Thread(target=sync_ntp, daemon=True).start()

def next_ntp_server():
    global ntp_server_idx
    ntp_server_idx = (ntp_server_idx + 1) % len(NTP_SERVERS)
    if _on_server_change:
        _on_server_change(NTP_SERVERS[ntp_server_idx])
    threading.Thread(target=lambda: sync_ntp(try_others=False),
                     daemon=True).start()

def ntp_now_ms():
    return time.time() * 1000 + ntp_offset_ms

# ── Deviation logic ────────────────────────────────────────────────────────────
#
#  When user presses SPACE their watch shows :00.
#  We read NTP seconds S (0..59).
#
#  Raw interpretation (no minute correction):
#    S in  0     → deviation =  0  (exact)
#    S in  1..30 → deviation = +S  (watch is S seconds SLOW)
#    S in 31..59 → deviation = -(60-S)  (watch is (60-S) seconds FAST)
#
#  With minute correction M (user-set integer, can be negative):
#    total_deviation_seconds = raw + M*60
#
#  Example: watch has drifted +90s slow over a year.
#    NTP reads :30 → raw = +30s
#    User sets M = +1 → total = 30 + 60 = +90s  ✓
#
#  Example: watch is 61s fast.
#    NTP reads :59 → raw = -1s
#    User sets M = -1 → total = -1 - 60 = -61s  ✓

def raw_deviation(ntp_seconds):
    """Returns deviation in seconds from ntp seconds value 0-59."""
    s = int(ntp_seconds) % 60
    if s <= 30:
        return s           # slow
    else:
        return s - 60      # fast  (e.g. 59 → -1)

def total_deviation(ntp_seconds, minute_adjust):
    return raw_deviation(ntp_seconds) + minute_adjust * 60

def fmt_dev_short(sec):
    """Fixed-width deviation for the narrow log. fmt_deviation() returns
    '  0.00s  EXACT' for zero, which is 15 chars and blows the column
    alignment apart on a 48-column phone screen."""
    sign = "+" if sec >= 0 else "−"
    a = abs(sec)
    if a == 0:
        return "  0.0s"
    if a < 60:
        return f"{sign}{a:.1f}s"
    mi, s = divmod(a, 60)
    return f"{sign}{int(mi)}m{s:02.0f}"

def fmt_deviation(sec):
    sign = "+" if sec >= 0 else "−"
    a = abs(sec)
    if a == 0:
        return "  0.00s  EXACT"
    if a < 60:
        return f"{sign}{a:.1f}s"
    m, s = divmod(a, 60)
    return f"{sign}{int(m)}m {s:.0f}s"

def direction(sec):
    if sec == 0:  return "exact"
    if sec  > 0:  return "SLOW"
    return "FAST"

# ── Rate analysis: regression + segmentation ──────────────────────────────────
READ_ERR  = 0.3   # legacy whole-second rows: truncation noise, not ±1s
#
# Old readings stored only int(seconds), discarding the fraction. That looks
# like ±1s, but it is not: truncation always shifts by the fractional part,
# which is uniform on [0,1) — mean 0.5s, rms about that mean 1/sqrt(12) =
# 0.29s. The 0.5s mean shift is CONSTANT within a segment, so it cancels in
# the slope and does not bias any rate. Only the 0.29s scatter is real noise.
# Measured against 13 legacy Citizen readings: residual rms 0.37s, i.e. the
# user's own timing added almost nothing on top of the truncation. Using 1.0
# here would triple every legacy error bar for no reason.
PRESS_ERR = 0.25  # spread of a single hand-eye press, seconds

def read_err(rs):
    """Typical reading error for a set of readings, in seconds.
    A tap-averaged or roll-over reading is ~10-50x better than an eyeball
    read; using the flat 1.0s fallback for those would inflate every error
    bar and hide real scatter. Uses the worst reading present, since the
    fit is limited by its noisiest input."""
    if not rs:
        return READ_ERR
    return max(r.get("readErrSec", READ_ERR) for r in rs)

def lsq_fit(rs):
    """Least-squares linear fit over chronological readings.
    Returns (slope_s_per_day, intercept, slope_stderr) for
    y = slope*(ts/86400)+intercept, or None if <2 points or zero time span.

    slope_stderr is the 1-sigma uncertainty on the slope. With only 2
    points the fit has no spare degrees of freedom, so the scatter cannot
    be estimated from the data; READ_ERR is used as the noise floor
    instead. Two rates differing by less than the sum of their errors are
    not distinguishable."""
    n = len(rs)
    if n < 2:
        return None
    xs = [r["ts"] / 86400 for r in rs]
    ys = [r["totalOffsetSec"] for r in rs]
    mx, my = sum(xs)/n, sum(ys)/n
    sxx = sum((x-mx)**2 for x in xs)
    if sxx < 1e-9:
        return None
    slope = sum((x-mx)*(y-my) for x, y in zip(xs, ys)) / sxx
    icept = my - slope*mx
    if n > 2:
        res = [y - (slope*x + icept) for x, y in zip(xs, ys)]
        s2  = sum(r*r for r in res) / (n - 2)      # unbiased: 2 dof used
        sigma = max(s2 ** 0.5, read_err(rs))       # never below read noise
    else:
        sigma = read_err(rs)
    return slope, icept, sigma / (sxx ** 0.5)

def fit_at(fit, ts):
    s, b = fit[0], fit[1]
    return s * (ts/86400) + b

def fit_err(fit):
    """1-sigma slope uncertainty in s/day, or None."""
    return fit[2] if fit and len(fit) > 2 else None

def segment_readings(rs):
    """Split chronological readings into segments at discontinuities
    (resets / radio syncs / shocks). ADJ rows do NOT break segments —
    totalOffsetSec is continuous through a minute correction.
    Break rule: reading deviates from segment prediction by more than
    5s + 0.1s per day of gap (allowance for rate-estimate error)."""
    segs, cur = [], []
    for r in rs:
        if not cur:
            cur = [r]
            continue
        if r.get("postSync"):
            # user-flagged: taken right after an atomic/radio sync —
            # always starts a fresh segment regardless of jump size
            segs.append(cur)
            cur = [r]
            continue
        gap_days = (r["ts"] - cur[-1]["ts"]) / 86400
        fit = lsq_fit(cur)
        if fit is None:
            # Only one point so far: no rate is known, so "expected" would
            # mean "assume zero drift". After a long gap a perfectly healthy
            # watch then looks like a discontinuity and the segment is split
            # in two, destroying the fit. Wait for a baseline instead.
            cur.append(r)
            continue
        pred = fit_at(fit, r["ts"])
        thr = 5.0 + 0.1 * gap_days
        if abs(r["totalOffsetSec"] - pred) > thr:
            segs.append(cur)
            cur = [r]
        else:
            cur.append(r)
    if cur:
        segs.append(cur)
    return segs

def seg_span_days(seg):
    return (seg[-1]["ts"] - seg[0]["ts"]) / 86400

def min_window_days(rate_est, rs=None):
    """Days of data needed before a rate number is trustworthy:
    2×reading error must be smaller than accumulated drift. Sharper
    readings (tap-averaged) need proportionally less time."""
    err = read_err(rs) if rs else READ_ERR
    if not rate_est or abs(rate_est) < 1e-6:
        return 21.0
    return min(45.0, max(2.0, (2*err) / abs(rate_est)))

def prev_segment_slope(segs, before_idx):
    """Most recent earlier segment with a valid fit."""
    for s in reversed(segs[:before_idx]):
        f = lsq_fit(s)
        if f and seg_span_days(s) >= 2:
            return f[0], seg_span_days(s)
    return None, None

def lifetime_rate(segs):
    """Span-weighted average of per-segment slopes (valid across resets)."""
    num = den = 0.0
    for s in segs:
        f = lsq_fit(s)
        d = seg_span_days(s)
        if f and d >= 2:
            num += f[0]*d
            den += d
    return (num/den) if den > 0 else None

def watch_rate_info(readings):
    """Returns dict describing the current segment's rate situation:
    {rate, syr, collecting, need_days, source, seg, segs, life}"""
    rs = sorted(readings, key=lambda r: r["ts"])
    if len(rs) < 2:
        return {"rate": None, "collecting": True, "need_days": None,
                "source": "none", "seg": rs, "segs": [rs] if rs else [], "life": None}
    segs = segment_readings(rs)
    seg  = segs[-1]
    fit  = lsq_fit(seg)
    prev_slope, _ = prev_segment_slope(segs, len(segs)-1)
    life = lifetime_rate(segs)
    est  = (fit[0] if fit else None) or prev_slope or life
    need = min_window_days(est, seg)
    span = seg_span_days(seg)
    if fit and span >= need:
        return {"rate": fit[0], "collecting": False, "need_days": need,
                "source": "segment", "seg": seg, "segs": segs, "life": life}
    # young segment — fall back to previous segment / lifetime if available
    fallback = prev_slope if prev_slope is not None else life
    return {"rate": fallback, "collecting": True, "need_days": need,
            "source": "previous" if fallback is not None else "none",
            "seg": seg, "segs": segs, "life": life}

def drift_per_day(readings):
    """Regression-based s/day of the current segment (or fallback), or None."""
    return watch_rate_info(readings)["rate"]

def predict_offset(readings, at_ts):
    """Expected total offset at at_ts, using the current segment's fit;
    for a young segment, extrapolate from its last point with the
    previous segment's slope. None if no usable history."""
    rs = sorted(readings, key=lambda r: r["ts"])
    if not rs:
        return None
    info = watch_rate_info(rs)
    seg  = info["seg"]
    fit  = lsq_fit(seg)
    if fit and seg_span_days(seg) >= 2:
        return fit_at(fit, at_ts)
    rate = info["rate"]
    last = seg[-1] if seg else rs[-1]
    if rate is not None:
        return last["totalOffsetSec"] + rate * ((at_ts - last["ts"]) / 86400)
    return None

def reading_method(r):
    """Short tag for how a reading was taken.

    Press and tap carry different systematic bias — a press lands late by
    the user's reaction time, tap-averaging cancels a constant latency by
    fitting the rhythm. Mixing them inside one segment injects a step that
    is not the watch, so the method has to be visible in the log."""
    n = r.get("taps")
    if n:
        # Show the real count, not a "10+" bucket: with tap-averaging the
        # count IS the precision (jitter/sqrt(n)), so a 24-tap reading is
        # meaningfully better than a 10-tap one and should look it.
        return f"T{n}" if n < 100 else "T99"
    # "method" is stored on new readings; older rows have neither field and
    # were all single presses at whole-second resolution.
    return "P" if r.get("method") == "press" else "p"

def _wrap(text, width):
    """Wrap a note to the terminal width without importing textwrap."""
    words, lines, cur = text.split(), [], ""
    for word in words:
        if cur and len(cur) + 1 + len(word) > width:
            lines.append(cur); cur = word
        else:
            cur = f"{cur} {word}".strip()
    if cur:
        lines.append(cur)
    return lines or [""]

def seg_caption(segs, gidx, gseg, what):
    """Caption under the plot. Always names WHICH segment is drawn, so an
    older one can never be mistaken for the live one."""
    n = len(segs)
    live = (gidx == n - 1)
    span = seg_span_days(gseg)
    when = datetime.fromtimestamp(gseg[0]["ts"]).strftime("%m-%d")
    tag = "LIVE" if live else "PAST"
    nav = "  \u2190\u2192 segment" if n > 1 else ""
    return (f"{what} \u00b7 seg {gidx+1}/{n} [{tag}] from {when} \u00b7 "
            f"{span:.0f}d/{len(gseg)}r{nav}")

def fmt_syr(rate_s_per_day):
    v = rate_s_per_day * 365
    sign = "+" if v >= 0 else "−"
    return f"{sign}{abs(v):.0f} s/yr"

def fmt_rate_unit(rate_s_per_day, unit):
    """Format s/day rate in the watch's chosen unit: d, m, or y."""
    mult = {"d": 1.0, "m": 30.44, "y": 365.0}.get(unit, 365.0)
    v = rate_s_per_day * mult
    sign = "+" if v >= 0 else "−"
    dec = 1 if abs(v) < 10 else 0
    return f"{sign}{abs(v):.{dec}f}s/{unit}"

def fmt_ts(unix_ts):
    return datetime.fromtimestamp(unix_ts).strftime("%Y-%m-%d %H:%M")

def fmt_clock():
    t = ntp_now_ms()
    dt = datetime.fromtimestamp(t / 1000)
    ms = int(t % 1000)
    return dt.strftime("%H:%M:%S") + f".{ms:03d}"

def fmt_rate(sec_per_day):
    sign = "+" if sec_per_day >= 0 else "−"
    a = abs(sec_per_day)
    if a < 60:
        return f"{sign}{a:.1f}s/day"
    m, s = divmod(a, 60)
    return f"{sign}{int(m)}m {s:.0f}s/day"

# ── App state ──────────────────────────────────────────────────────────────────
class App:
    def __init__(self):
        self.data          = load_data()
        self._restore_ntp_server()
        self.selected      = 0
        self.screen        = "MARK"
        self.msg           = ""
        self.msg_ts        = 0
        self.input_mode    = False
        self.input_kind    = "add"   # "add" watch name | "spec" spec/tolerance
        self.input_buf     = ""
        self.log_offset    = 0
        self.log_sel       = 0   # selected row in Log screen (0 = newest)
        # per-session minute correction for next reading
        self.minute_adjust = 0
        self.sync_arm      = False   # next SPACE records a SYNC baseline
        self.help_scroll   = 0       # HELP screen scroll position
        self.seg_view      = None    # TREND: which segment to plot (None = latest)
        self.show_notes    = False   # TREND: I toggles the profile notes panel
        self.plot_resid    = True    # G toggles residual vs plain deviation plot
        self.tap_mode      = False   # multi-tap averaging in progress
        self.rejected_taps = 0       # bounces/auto-repeat ignored this run
        self.taps          = []      # NTP ms of each tap
        self.show_bar      = True

    # ── watches ────────────────────────────────────────────────────────────────
    @property
    def watch(self):
        ws = self.data["watches"]
        if not ws: return None
        return ws[min(self.selected, len(ws)-1)]

    def watch_readings(self):
        if not self.watch: return []
        wid = self.watch["id"]
        return sorted(
            [r for r in self.data["readings"] if r["watchId"] == wid],
            key=lambda r: -r["ts"]
        )

    def add_watch(self, name):
        name = name.strip()
        if not name: return
        w = {"id": str(int(time.time()*1000)), "name": name}
        self.data["watches"].append(w)
        self.selected = len(self.data["watches"]) - 1
        save_data(self.data)

    def set_spec(self, text):
        """Parse spec with unit and optional tolerance, e.g.:
        '15/m'  '20/y,10'  '0.5/d 5'  — unit d/m/y (default y).
        Stored normalized to s/yr plus the chosen display unit."""
        if not self.watch:
            return
        try:
            parts = [p for p in text.lower().replace(",", " ").split() if p]
            v = parts[0]
            unit = "y"
            for u in ("d", "m", "y"):
                if v.endswith("/"+u) or v.endswith(u):
                    if v.endswith("/"+u): v = v[:-2]
                    elif v[:-1] and v.endswith(u): v = v[:-1]
                    unit = u
                    break
            spec = float(v)
            per_year = spec * {"d": 365.0, "m": 12.0, "y": 1.0}[unit]
            self.watch["spec_s_per_year"] = per_year
            self.watch["spec_unit"]       = unit
            tol = float(parts[1]) if len(parts) >= 2 else None
            if tol is not None:
                self.watch["tolerance_s"] = tol
            save_data(self.data)
            self._flash(f"  {self.watch['name']}: spec ±{spec:g}s/{unit}"
                        f" (={per_year:g}s/y)"
                        + (f", tol ±{tol:g}s" if tol is not None else ""))
        except (ValueError, IndexError):
            self._flash("  Format: 15/m  or  20/y,10  or  0.5/d 5")

    def delete_watch(self):
        if not self.watch: return
        wid = self.watch["id"]
        self.data["watches"]  = [w for w in self.data["watches"]  if w["id"]      != wid]
        self.data["readings"] = [r for r in self.data["readings"] if r["watchId"] != wid]
        self.selected = max(0, self.selected - 1)
        save_data(self.data)

    # ── readings ───────────────────────────────────────────────────────────────
    def mark_zero(self):
        if not self.watch:
            self._flash("  No watch selected! Go to Watches (W) first.")
            return
        t_ms = ntp_now_ms()
        # debounce: ignore repeat presses within 5s of last reading (key auto-repeat)
        rs = self.watch_readings()
        if rs and (t_ms/1000 - rs[0]["ts"]) < 5:
            self._flash("  Ignored — reading taken <5s ago (D to delete last).")
            return
        self._record_reading(t_ms)

    def _prune_stale_syncs(self):
        """When a new postSync reading is recorded, delete immediately
        preceding readings of the same watch that are also postSync —
        only the freshest sync baseline is kept. Stops at the first
        non-sync reading (real drift data is never touched)."""
        wid = self.watch["id"]
        rs = sorted([r for r in self.data["readings"] if r["watchId"] == wid],
                    key=lambda r: r["ts"])
        drop = set()
        # walk backwards from the reading just before the newest
        for r in reversed(rs[:-1]):
            if r.get("postSync"):
                drop.add(r["id"])
            else:
                break
        if drop:
            self.data["readings"] = [r for r in self.data["readings"]
                                     if r["id"] not in drop]
        return len(drop)

    def adjust_selected_reading(self, delta_min):
        """Change minuteAdjust of the reading selected in the Log screen."""
        rs = self.watch_readings()
        if not rs:
            self._flash("  No readings.")
            return
        i = min(self.log_sel, len(rs) - 1)
        r = rs[i]  # reference into self.data["readings"] — edits persist
        adj = r.get("minuteAdjust", 0) + delta_min
        r["minuteAdjust"]   = adj
        r["totalOffsetSec"] = r["rawOffsetSec"] + adj * 60
        save_data(self.data)
        self._flash(
            f"  {fmt_ts(r['ts'])}  adj {adj:+d}m  →  "
            f"total {fmt_deviation(r['totalOffsetSec'])}  ({direction(r['totalOffsetSec'])})"
        )

    def toggle_sync_flag(self):
        """Mark/unmark the selected reading as taken right after a radio sync."""
        rs = self.watch_readings()
        if not rs:
            self._flash("  No readings.")
            return
        i = min(self.log_sel, len(rs) - 1)
        r = rs[i]
        r["postSync"] = not r.get("postSync", False)
        save_data(self.data)
        state = "SYNC point (starts new segment)" if r["postSync"] else "normal reading"
        self._flash(f"  {fmt_ts(r['ts'])} → {state}")

    def delete_selected_reading(self):
        rs = self.watch_readings()
        if not rs:
            self._flash("  No readings to delete.")
            return
        i = min(self.log_sel, len(rs) - 1)
        rid = rs[i]["id"]
        self.data["readings"] = [r for r in self.data["readings"] if r["id"] != rid]
        self.log_sel = max(0, self.log_sel - 1)
        save_data(self.data)
        self._flash("  Reading deleted.")

    def _restore_ntp_server(self):
        """Start on the server that last worked, not always the first in the
        list. The first entry is not reliably reachable, and silently
        defaulting to it every launch means the app can sit unsynced."""
        global ntp_server_idx, _on_server_change
        saved = self.data.get("ntp_server")
        if saved in NTP_SERVERS:
            ntp_server_idx = NTP_SERVERS.index(saved)
        def remember(name):
            self.data["ntp_server"] = name
            try:
                save_data(self.data)
            except Exception:
                pass
        _on_server_change = remember

    def start_tap_mode(self):
        if not self.watch:
            self._flash("  No watch selected!")
            return
        self.tap_mode = True
        self.taps = []
        self.rejected_taps = 0
        self._flash("  TAP MODE: SPACE on every tick, LAST tap at :00")

    def cancel_tap_mode(self, msg="  Tap mode cancelled."):
        self.tap_mode = False
        self.taps = []
        self.rejected_taps = 0
        self._flash(msg)

    TAP_DEBOUNCE_MS = 450

    def tap(self):
        """Record one tick.

        A real tick is 1s apart, so anything arriving within a fraction of a
        second is not a tap: it is Android key auto-repeat, a held key, or a
        bounce. Without this guard a held key produces dozens of entries ~50ms
        apart, and the tick-counting rounds each gap up to a full second —
        silently destroying the timing model while still reporting a plausible
        tap count."""
        now = ntp_now_ms()
        if self.taps and (now - self.taps[-1]) < self.TAP_DEBOUNCE_MS:
            self.rejected_taps += 1
            return
        self.taps.append(now)

    def maybe_finalize_taps(self):
        """Called every UI cycle. Finalizes ~1.8s after the last tap:
        the last tap is treated as the watch's :00.

        Tick indices are derived from the gaps between taps, not from tap
        order. Assuming taps are consecutive seconds means one missed tick
        shifts every earlier tap by a full second and wrecks the fit; here a
        2s gap is simply read as 'two ticks passed'.

        A ragged rhythm is no longer thrown away — it is recorded with an
        honest readErrSec so later fits can weigh it properly. Only a set
        too ragged to trust the tick counting is refused."""
        if not self.tap_mode or not self.taps:
            return
        if ntp_now_ms() - self.taps[-1] < 1800:
            return
        if len(self.taps) < 3:
            self.cancel_tap_mode(
                f"  Only {len(self.taps)} tap(s) — need ≥3. Nothing recorded.")
            return

        def solve(taps):
            """Returns (T0_ms, rms_ms) with tick indices from actual gaps."""
            idx, acc = [0], 0
            for a, b in zip(taps, taps[1:]):
                acc += max(1, int(round((b - a) / 1000.0)))   # ticks elapsed
                idx.append(acc)
            last = idx[-1]
            T0 = sum(t + (last - i) * 1000.0 for t, i in zip(taps, idx)) / len(taps)
            res = [t - (T0 - (last - i) * 1000.0) for t, i in zip(taps, idx)]
            rms = (sum(x*x for x in res) / len(res)) ** 0.5
            return T0, rms, res, idx

        taps = list(self.taps)
        T0, rms_ms, resid, tick_idx = solve(taps)

        # Trim outliers iteratively, not just one.
        #
        # A UI freeze delays when the keypress is PROCESSED, which is when the
        # timestamp is taken — so a stalled phone produces a tap that is late
        # by the length of the stall. One freeze is common, two is not rare,
        # and the old single-drop rule could not handle two. Trim anything
        # beyond 3x the rms, re-fit, repeat — but never discard more than a
        # fifth of the taps, because past that the problem is the run itself,
        # not a few bad points.
        trimmed = 0
        max_trim = max(1, len(taps) // 5)
        while len(taps) >= 4 and trimmed < max_trim:
            worst_i = max(range(len(taps)), key=lambda i: abs(resid[i]))
            if abs(resid[worst_i]) <= 3 * rms_ms or rms_ms < 30:
                break
            cand = taps[:worst_i] + taps[worst_i+1:]
            t0_t, rms_t, res_t, idx_t = solve(cand)
            if rms_t >= rms_ms:
                break
            T0, taps, rms_ms, resid, tick_idx = t0_t, cand, rms_t, res_t, idx_t
            trimmed += 1

        # A tick is 1s. More taps than seconds elapsed means the input was
        # not ticks at all — refuse rather than fit nonsense.
        elapsed_s = (taps[-1] - taps[0]) / 1000.0
        if len(taps) > elapsed_s + 2:
            self.cancel_tap_mode(
                f"  {len(taps)} taps in {elapsed_s:.0f}s — that is faster than "
                f"the watch ticks. Nothing recorded (stuck key?).")
            return

        if rms_ms > 600:
            self.cancel_tap_mode(
                f"  Taps too uneven (±{rms_ms:.0f}ms) — tick counting unreliable. "
                f"Nothing recorded, try again.")
            return

        n = len(taps)
        self.tap_mode = False
        self.taps = []
        self._record_reading(T0, float_seconds=True, n_taps=n, jitter_ms=rms_ms,
                             tap_resid=resid, tap_idx=tick_idx, trimmed=trimmed)

    def _record_reading(self, t_ms, float_seconds=False, n_taps=None, jitter_ms=None,
                        tap_resid=None, tap_idx=None, trimmed=0):
        """Shared recording path for single-press and tap-averaged readings."""
        snap = ntp_snapshot()          # one sync for the whole reading
        ok, why = ntp_ok_to_record(snap)
        if not ok:
            self._flash("  ✖ " + why)
            return
        post_sync = self.sync_arm
        self.sync_arm = False
        t_sec = t_ms / 1000
        # Keep the true fractional second for BOTH methods.
        #
        # Truncating a press to a whole second (float(int(s))) is biased by
        # sign, not merely coarse: a slow watch at +0.18s truncates to 0.00
        # (toward zero), while a fast watch at -0.2s (NTP :59.8) truncates to
        # -1.0 (away from zero). That is up to ~1s of error in opposite
        # directions depending on which way the watch runs — it would bend a
        # fit, not just blur it. The real uncertainty of a press belongs in
        # readErrSec, where the regression can weigh it, not in a thrown-away
        # fraction.
        s = (t_ms / 1000.0) % 60
        raw = s if s <= 30 else s - 60
        rs   = self.watch_readings()
        pred = predict_offset(rs, t_sec)

        if post_sync:
            adj, mode = self.minute_adjust, "sync"
        elif self.minute_adjust != 0 or pred is None:
            adj  = self.minute_adjust
            mode = "manual" if self.minute_adjust != 0 else "raw"
        else:
            adj  = int(round((pred - raw) / 60))
            mode = "auto"
        # 3 dp, not 1. Rounding to 0.1s quantises every reading to 100 ms,
        # which is COARSER than the measurement itself: a tap reading resolves
        # to ~20 ms and a practised press to ~50 ms. Rounding to a tenth threw
        # away the better half of the information and put a 100 ms staircase
        # into the data the regression fits. Display still shows 0.1s via
        # fmt_deviation; only the stored value keeps the resolution.
        total = round(raw + adj * 60, 3)

        warn = ""
        if not post_sync and pred is not None and abs(total - pred) > 10:
            warn = f"  ⚠ off-trend (expected {fmt_deviation(pred)}) — retake?"

        reading = {
            "id":             str(int(t_ms)),
            "watchId":        self.watch["id"],
            "ts":             t_sec,
            "ntpSeconds":     int(round(s)) % 60,
            "minuteAdjust":   adj,
            "adjMode":        mode,
            "rawOffsetSec":   round(raw, 3),
            "totalOffsetSec": total,
        }
        # Conditions at the moment of recording. A suspicious residual can
        # then be checked against how it was measured instead of guessed at:
        # a big round-trip delay or a different server is a measurement
        # problem, not the watch.
        reading["method"]      = "tap" if n_taps else "press"
        reading["ntpServer"]   = snap["server"]
        reading["ntpOffsetMs"] = round(snap["offset_ms"], 1)
        if snap["delay_ms"] is not None:
            reading["ntpDelayMs"] = round(snap["delay_ms"], 1)
        if post_sync:
            reading["postSync"] = True
        # NTP contributes its own uncertainty. Roughly half the round-trip
        # delay bounds the asymmetry error, and a VPN can make that large —
        # no amount of careful tapping beats a 300ms network bias, so it has
        # to go into the error budget too.
        ntp_err = (snap["delay_ms"] / 2000.0) if snap["delay_ms"] else 0.05
        if n_taps:
            reading["taps"] = n_taps
            reading["tapJitterMs"] = round(jitter_ms, 1)
            if tap_resid:
                # Per-tap deviation from the fitted beat, in ms. Kept because
                # the rms alone hides the shape: a steady drift through the
                # run means you were speeding up or slowing down, which is a
                # different thing from random scatter and is correctable.
                reading["tapResidMs"] = [int(round(x)) for x in tap_resid]
                if tap_idx and len(tap_resid) >= 4:
                    n_ = len(tap_resid)
                    mi = sum(tap_idx)/n_; mr = sum(tap_resid)/n_
                    sxx_ = sum((i-mi)**2 for i in tap_idx)
                    if sxx_ > 0:
                        reading["tapDriftMsPerTick"] = round(
                            sum((i-mi)*(r-mr) for i, r in zip(tap_idx, tap_resid))
                            / sxx_, 2)
                    reading["tapSpanTicks"] = tap_idx[-1]
            if trimmed:
                reading["tapsTrimmed"] = trimmed
            tap_err = max(jitter_ms/1000.0/(n_taps**0.5), 0.02)
            reading["readErrSec"] = round((tap_err**2 + ntp_err**2) ** 0.5, 3)
        else:
            # A single press carries the full spread of hand-eye reaction:
            # roughly 0.25s, and unlike tap-averaging nothing cancels it.
            reading["readErrSec"] = round((PRESS_ERR**2 + ntp_err**2) ** 0.5, 3)
        self.data["readings"].append(reading)
        pruned = self._prune_stale_syncs() if post_sync else 0
        save_data(self.data)
        if n_taps:
            drift = reading.get("tapDriftMsPerTick")
            dtxt = f" drift {drift:+.1f}ms/tick" if drift else ""
            tt = reading.get("tapsTrimmed")
            dtxt += f" ({tt} outlier dropped)" if tt else ""
            prec = f"  [{n_taps} taps ±{jitter_ms:.0f}ms{dtxt}]"
        else:
            prec = ""
        self._flash(
            f"  {'SYNC ' if post_sync else ''}Recorded "
            f"raw={fmt_deviation(raw)} adj={adj:+d}m({mode}) "
            f"total={fmt_deviation(total)} ({direction(total)})"
            f"{prec}{warn}"
            + (f" [{pruned} old sync pruned]" if pruned else "")
        )

    def delete_last_reading(self):
        rs = self.watch_readings()
        if not rs:
            self._flash("  No readings to delete.")
            return
        rid = rs[0]["id"]
        self.data["readings"] = [r for r in self.data["readings"] if r["id"] != rid]
        save_data(self.data)
        self._flash("  Last reading deleted.")

    def _flash(self, msg):
        self.msg    = msg
        self.msg_ts = time.time()

# ── Drawing ────────────────────────────────────────────────────────────────────
def sa(win, y, x, s, attr=0):
    h, w = win.getmaxyx()
    if y < 0 or y >= h or x < 0: return
    ml = w - x - 1
    if ml <= 0: return
    try: win.addstr(y, x, s[:ml], attr)
    except curses.error: pass

def draw(stdscr, app):
    stdscr.erase()
    H, W = stdscr.getmaxyx()
    GOLD  = curses.color_pair(1)
    DIM   = curses.color_pair(2)
    GREEN = curses.color_pair(3)
    RED   = curses.color_pair(4)
    CYAN  = curses.color_pair(5)
    BOLD  = curses.A_BOLD

    # header
    title = " ◉ WATCH DRIFT " if W < 58 else " ◉ WATCH DRIFT RECORDER "
    sa(stdscr, 0, 0, "─"*W, DIM)
    sa(stdscr, 0, max(0, W//2 - len(title)//2), title, GOLD|BOLD)
    if not ntp_synced:
        nattr = RED|BOLD
    elif (ntp_age_s() or 0) > NTP_STALE_S:
        nattr = GOLD|BOLD
    else:
        nattr = DIM
    # A phone terminal is often only ~48 columns. Anything built for 80 gets
    # silently chopped at the right edge, which hides exactly the status the
    # line exists to show. Shorten aggressively when narrow.
    NARROW = W < 58
    age = (ntp_age_s() or 0) if ntp_synced else 0
    agetxt = f"{age/60:.0f}m" if age >= 60 else "fresh"
    if ntp_synced and NARROW:
        srv = (ntp_server_used or "?").replace("time.", "").replace(".com", "") \
                                      .replace(".org", "")
        nline = (f"{srv} {ntp_offset_ms:+.0f}ms rtt {ntp_delay_ms or 0:.0f} "
                 f"{agetxt}")
    elif ntp_synced:
        nline = ntp_status + (f"  ({agetxt} ago)" if age >= 60 else "  (fresh)")
    else:
        nline = ntp_status if not NARROW else "NOT SYNCED — press N"
    sa(stdscr, 1, 1, nline[:W-2], nattr)

    # tabs
    if NARROW:
        tabs = [("W","atch"), ("M","ark"), ("L","og"), ("T","rend"),
                ("H","elp"), ("Q","uit")]
    else:
        tabs = [("W","Watches"), ("M","Mark"), ("L","Log"), ("T","Trend"),
                ("H","Help"), ("Q","Quit")]
    x = 1
    sa(stdscr, 2, 0, "─"*W, DIM)
    for key, label in tabs:
        active = (key == app.screen[0])
        text = f"[{key}]{label}"
        sa(stdscr, 2, x, text, (GOLD|BOLD) if active else DIM)
        x += len(text) + 2

    row = 4

    # flash
    if app.msg and time.time() - app.msg_ts < 4:
        sa(stdscr, row, 0, app.msg[:W], GREEN|BOLD)
        row += 1

    # ══ MARK ══════════════════════════════════════════════════════════════════
    if app.screen == "MARK":
        # live clock
        sa(stdscr, row, 2, "NTP TIME", DIM)
        row += 1
        sa(stdscr, row, 2, fmt_clock(), GOLD|BOLD)
        row += 1

        # second progress bar
        if app.show_bar:
            t_ms  = ntp_now_ms()
            frac  = (t_ms % 1000) / 1000
            bw    = min(W-10, 52)
            filled = int(frac * bw)
            bar   = "█"*filled + "░"*(bw-filled)
            sa(stdscr, row, 2, f"0s │{bar}│ 1s  [B=hide]", DIM)
        else:
            sa(stdscr, row, 2, "[B=show bar]", DIM)
        row += 2

        # selected watch
        w = app.watch
        sa(stdscr, row, 2,
           f"Watch : {w['name']}" if w else "Watch : (none — press W to add one)",
           CYAN|BOLD if w else DIM)
        row += 1

        # minute adjustment
        adj_col = GREEN if app.minute_adjust == 0 else GOLD
        rs_pred = app.watch_readings()
        pred = predict_offset(rs_pred, ntp_now_ms()/1000) if rs_pred else None
        if app.minute_adjust != 0:
            mode_txt = f"MANUAL {app.minute_adjust:+d}min  (</> change, 0=auto)"
        elif pred is not None:
            mode_txt = f"AUTO: trend → {fmt_deviation(pred)} {direction(pred)}"
        else:
            mode_txt = "RAW: need 2+ rdgs (</> = manual)"
        sa(stdscr, row, 2, f"Adj: {mode_txt}", adj_col)
        row += 1

        # explain what the correction does
        sa(stdscr, row, 2,
           "Auto picks minute correction from trend.",
           DIM)
        row += 2

        # last reading summary
        rs = app.watch_readings()
        if rs:
            lr = rs[0]
            total = lr["totalOffsetSec"]
            col = GREEN if total == 0 else (RED if abs(total) > 30 else GOLD)
            sa(stdscr, row, 2,
               f"Last reading : NTP showed :{lr['ntpSeconds']:02d}s  →  "
               f"total {fmt_deviation(total)}  {direction(total)}",
               col)
            row += 1
            rate = drift_per_day(rs)
            if rate is not None:
                sa(stdscr, row, 2,
                   f"Drift rate   : {fmt_rate(rate)}"
                   f"  ≈ {abs(rate)*365/60:.1f} min/year",
                   DIM)
            row += 1
        row += 1

        # big prompt
        if app.tap_mode:
            nt = len(app.taps)
            sa(stdscr, row, 2,
               f"● TAP MODE — tap ANY key on EVERY tick, LAST at :00  [{nt} taps]",
               RED|BOLD)
            row += 1
            if nt == 0:
                hint = "waiting for first tap · Esc cancel"
            else:
                if nt < 3:
                    hint = f"need {3-nt} more tap(s) — keep going · Esc cancel"
                else:
                    # No progress bar here: the screen redraws every 50ms, so
                    # a bar flickers in the corner of your eye exactly when
                    # you are trying to watch the second hand.
                    hint = "stop tapping to RECORD · Esc cancel"
                if app.rejected_taps:
                    hint += f"   ({app.rejected_taps} bounce ignored)"
            sa(stdscr, row, 2, hint, DIM)
            row += 1
        elif app.sync_arm:
            sa(stdscr, row, 2,
               "⚡ SYNC ARMED — next reading records baseline",
               RED|BOLD)
            row += 1
        sa(stdscr, row, 2,
           "━━━  Press SPACE when YOUR WATCH shows :00  ━━━",
           GOLD|BOLD)
        row += 1
        sa(stdscr, row, 2,
           "NTP seconds at that moment = your watch's deviation",
           DIM)
        row += 2
        sa(stdscr, row, 2,
           "NTP :00 = exact │ :01 = 1s slow │ :59 = 1s fast",
           DIM)
        row += 1
        sa(stdscr, row, 2, "Y arm sync  C tap-average  D del last", DIM)

    # ══ HELP ════════════════════════════════════════════════════════════════════════
    elif app.screen == "HELP":
        HL = [
            ("KEYS — anywhere", 1),
            ("  W / M / L / T   Watches · Mark · Log · Trend", 0),
            ("  H or ?          this help        Q   quit", 0),
            ("  N               re-sync NTP      P   next NTP server", 0),
            ("                  The last working server is remembered and used", 0),
            ("                  next launch. If it fails the app tries the", 0),
            ("                  others and adopts whichever works.", 0),

            ("  G               toggle graph: plain ↔ residuals", 0),
            ("  ← →  (on Trend)  page back through older segments;", 0),
            ("                  → returns to the live one. ↑↓ changes watch.", 0),
            ("  B               show / hide the seconds bar", 0),
            ("", 0),
            ("MARK — take a reading", 1),
            ("  SPACE   record now. Press on the moment the watch's", 0),
            ("          second CHANGES, not on a glance — mid-second you", 0),
            ("          only know it to ±0.5s.", 0),
            ("  C       TAP MODE: tap on every tick, LAST tap on :00.", 0),
            ("          Averages many ticks → ~10x better than one press.", 0),
            ("          ANY key counts as a tap. Stop tapping and it saves", 0),
            ("          itself after ~2s. Esc aborts with nothing saved.", 0),
            ("  Y       arm SYNC — next reading is a fresh baseline (after", 0),
            ("          a reset or radio sync). Starts a new segment.", 0),
            ("  D       delete the last reading", 0),
            ("  < >     shift the minute guess by ±1  (see ADJ below)", 0),
            ("", 0),
            ("WATCHES", 1),
            ("  A add   X delete   S set spec/tolerance   Enter → Mark", 0),
            ("  spec      maker's accuracy claim in s/year. Only used to", 0),
            ("            flag a watch as out of spec.", 0),
            ("  tolerance how far off you tolerate before resetting.", 0),
            ("            Drives the 'reset~' date on Trend.", 0),
            ("", 0),
            ("LOG", 1),
            ("  ↑↓ select   PgUp/PgDn jump 10   D delete", 0),
            ("  < >   fix the minute on a PAST reading", 0),
            ("  Y     flag / unflag a reading as a sync baseline", 0),
            ("", 0),
            ("READING THE COLUMNS", 1),
            ("  NTP :SS  the NTP second when you marked.", 0),
            ("  ADJ      whole minutes added. NOT something you did to the", 0),
            ("           watch. A dial shows only seconds, so :16 could be", 0),
            ("           16s slow OR 44s fast — ADJ −1m picks which, from", 0),
            ("           the trend. Wrong? fix it with < > in the Log.", 0),
            ("  TOTAL    true error. Negative = FAST (watch is ahead).", 0),
            ("  \u0394d       days since the previous reading. A rate over a", 0),
            ("           short gap is mostly quantization noise.", 0),
            ("  resid    distance from THIS reading's own segment fit. The", 0),
            ("           deviation column always grows, so it cannot show an", 0),
            ("           odd reading; the residual can. Rows more than 4x", 0),
            ("           their own error off the fit turn RED.", 0),
            ("  M        how it was taken. Tn = tap-averaged over n taps,", 0),
            ("           P = single press, p = pre-2026-09 press (\u00b11s).", 0),
            ("           More taps = better: precision is jitter/\u221an, so", 0),
            ("           T20 is about twice as sharp as T5.", 0),
            ("  Select a row to see its tap detail below the list:", 0),
            ("    n taps \u00b1Xms   your scatter around your own beat", 0),
            ("    beat +X ms/tick  a steady drift through the run means", 0),
            ("                     you sped up or slowed down. Random", 0),
            ("                     scatter averages out; a drift does not", 0),
            ("                     average out as cleanly, so a large one", 0),
            ("                     is worth a retake.", 0),
            ("    worst Xms        the single furthest tap", 0),
            ("           A press lands late by your reaction time (~0.2s", 0),
            ("           measured); tap-averaging cancels a constant", 0),
            ("           latency. A constant bias does NOT affect a rate —", 0),
            ("           it cancels in the slope — but MIXING the two inside", 0),
            ("           one segment injects a step that is not the watch.", 0),
            ("           Trend warns when a segment mixes them.", 0),
            ("", 0),
            ("TREND — what each line means", 1),
            ("  Seg    rate of the CURRENT segment, ±1 sigma. The ± is the", 0),
            ("         whole point: −99 ±23 and −94 are the SAME rate.", 0),
            ("  Life   all segments, weighted by span. 'SAME' / '← CHANGED'", 0),
            ("         compares Seg against it honestly.", 0),
            ("  Now    projected error RIGHT NOW, not the last reading.", 0),
            ("  reset~ the date you cross your tolerance.", 0),
            ("  Resid  scatter around the fit. Small = a straight line", 0),
            ("         explains this watch. SCATTER = rate not trustworthy.", 0),
            ("  collecting  segment too young for its own rate. Shows the", 0),
            ("         previous segment's rate instead of inventing one.", 0),
            ("", 0),
            ("GRAPHS   (G toggles)", 1),
            ("  PLAIN      clock error over time. ● readings, · fit,", 0),
            ("             ─ exact. Sloping down = running fast.", 0),
            ("  RESIDUALS  same data, trend subtracted — only what the", 0),
            ("             trend can't explain is left. Read the SHAPE:", 0),
            ("    flat scatter  → healthy", 0),
            ("    a step        → battery, shock or magnetism", 0),
            ("    slow curve    → temperature. Normal for drawer watches;", 0),
            ("                    quartz runs slower when hot AND cold.", 0),
            ("    widening fan  → the rate itself is changing", 0),
            ("  ← → pages through past segments. The caption always", 0),
            ("  names which one is drawn — LIVE or PAST — and the text", 0),
            ("  above it always describes the live segment.", 0),
            ("  Both axes are linear. Neither is logarithmic.", 0),
            ("", 0),
            ("HOW SEGMENTS WORK", 1),
            ("  A segment is an unbroken run of drift. It breaks ONLY on a", 0),
            ("  sync baseline (Y) or a jump too big to be drift. ADJ does", 0),
            ("  NOT break one — TOTAL stays continuous through it.", 0),
            ("  Resetting a watch ends a segment and discards its", 0),
            ("  accumulated drift — so reset less often than feels natural.", 0),
            ("", 0),
            ("NTP \u2014 THE MEASUREMENT ITSELF", 1),
            ("  The header line is the reference clock. RED = not synced,", 0),
            ("  GOLD = sync is stale. Recording is REFUSED in both cases:", 0),
            ("  an unsynced phone can be a second out and that would be", 0),
            ("  logged as watch drift and never questioned.", 0),
            ("  rtt is the round-trip delay. NTP assumes the network is", 0),
            ("  symmetric out and back; a VPN breaks that and can bias the", 0),
            ("  offset by hundreds of ms. Half the rtt is folded into each", 0),
            ("  reading's error, so a noisy network widens the error bars", 0),
            ("  instead of quietly corrupting the trend.", 0),
            ("  Prefer marking with the VPN off, and stay on one server.", 0),
            ("", 0),
            ("GETTING GOOD NUMBERS", 1),
            ("  · Use tap mode. ±1s reads need WEEKS to pin a rate;", 0),
            ("    ±0.1s reads need days.", 0),
            ("  · Leave long gaps between readings. Rate error shrinks", 0),
            ("    with the SPAN, not with the number of readings.", 0),
            ("  · 2–3 marks a year per watch is enough to catch a step,", 0),
            ("    as long as the span is long.", 0),
            ("  · Keep your phone as a control entry. If IT ever shows", 0),
            ("    drift, the method is wrong, not the watch.", 0),
        ]
        maxrow  = H - 3
        visible = max(1, maxrow - row)
        total   = len(HL)
        app.help_scroll = max(0, min(app.help_scroll, max(0, total - visible)))
        for i in range(app.help_scroll, total):
            if row >= maxrow:
                break
            text, hdr = HL[i]
            sa(stdscr, row, 2, text[:W-3], (GOLD|BOLD) if hdr else DIM)
            row += 1
        if total > visible:
            shown = min(total, app.help_scroll + visible)
            sa(stdscr, maxrow, 2,
               f"  ↑↓ PgUp PgDn scroll   —  {shown}/{total} lines", GOLD)

    # ══ WATCHES ═══════════════════════════════════════════════════════════════
    elif app.screen == "WATCHES":
        sa(stdscr, row, 2, "↑↓ select  A add  X del  S spec  Enter→Mark", DIM)
        row += 1
        sa(stdscr, row, 2, "─"*min(60,W-4), DIM)
        row += 1
        ws = app.data["watches"]
        if not ws:
            sa(stdscr, row, 4, "(no watches — press A)", DIM); row += 1
        for i, w in enumerate(ws):
            rs = [r for r in app.data["readings"] if r["watchId"] == w["id"]]
            info = watch_rate_info(rs)
            unit = w.get("spec_unit", "y")
            if info["rate"] is None:
                rate_s, stat = "collect", ""
            elif info["collecting"]:
                rate_s = fmt_rate_unit(info["rate"], unit) + "?"
                stat   = f"~{info['need_days']:.0f}d"
            else:
                rate_s = fmt_rate_unit(info["rate"], unit)
                spec = watch_spec(w)
                stat = ("OK" if abs(info["rate"]*365) <= spec else "OUT!") if spec else ""
            line = (f" {'▶' if i==app.selected else ' '} {w['name'][:13]:<13}"
                    f" {len(rs):>3}r {rate_s:>9} {stat}")
            col = 0
            if stat == "OUT!": col = RED
            elif stat == "OK": col = GREEN
            if i == app.selected: col = GOLD|BOLD
            sa(stdscr, row, 0, line[:W], col)
            row += 1
        row += 1
        if app.input_mode:
            label = ("New watch name" if app.input_kind == "add"
                     else "Spec: 15/m or 20/y,10 or 0.5/d")
            sa(stdscr, row, 2, f"{label}: {app.input_buf}_", GREEN)
            row += 1
            sa(stdscr, row, 2, "Enter confirm   Esc cancel", DIM)
        else:
            sa(stdscr, row, 2, "?=young seg  ~Nd=days needed", DIM)

    # ══ LOG ═══════════════════════════════════════════════════════════════════
    elif app.screen == "LOG":
        w = app.watch
        if not w:
            sa(stdscr, row, 2, "No watch selected.", DIM)
        else:
            rs = app.watch_readings()
            # Residual of each reading against ITS OWN segment's fit, plus the
            # gap since the previous reading. The residual is what turns the
            # log into a diagnostic: a row far off its own trend is the one to
            # look at, and you cannot see that from the deviation column alone
            # because every row there is "further along" than the last.
            resid_by_id, gap_by_id = {}, {}
            chrono = sorted(rs, key=lambda r: r["ts"])
            for i, r in enumerate(chrono):
                if i:
                    gap_by_id[id(r)] = (r["ts"] - chrono[i-1]["ts"]) / 86400
            lone_by_id = set()
            if len(chrono) >= 2:
                segs_ = segment_readings(chrono)
                for si, seg in enumerate(segs_):
                    f = lsq_fit(seg)
                    if f and len(seg) >= 3 and seg_span_days(seg) > 0:
                        for r in seg:
                            resid_by_id[id(r)] = r["totalOffsetSec"] - fit_at(f, r["ts"])
                    elif len(seg) == 1 and si > 0 and not seg[0].get("postSync"):
                        # A reading alone in its own segment broke away from the
                        # trend hard enough to be called a discontinuity. That is
                        # usually a wrong minute guess, not the watch. It has no
                        # fit of its own, so without this it would show a blank
                        # residual and look perfectly fine.
                        lone_by_id.add(id(seg[0]))
            sa(stdscr, row, 2,
               (f"{w['name']} {len(rs)}r  ↑↓ </> Y D  Enter=detail"
                if W < 58 else
                f"{w['name']} {len(rs)}r  ↑↓sel </> adj Y=sync D=del   "
                f"M: Tn=tap P=press  Enter=detail"),
               CYAN|BOLD)
            row += 1
            sa(stdscr, row, 2, "─"*min(72,W-4), DIM)
            row += 1
            # base row is 30 cols; each extra column costs 6
            LOG_COLS = 0
            if W >= 44: LOG_COLS = 1        # + resid
            if W >= 50: LOG_COLS = 2        # + Δd
            if W >= 58: LOG_COLS = 3        # + full DIR word
            hdr = f"  {'DATE/TIME':<15}{'NTP':>3}{'TOTAL':>8} {'M':>3}"
            if LOG_COLS >= 1: hdr += f" {'resid':>6}"
            if LOG_COLS >= 2: hdr += f"{'Δd':>6}"
            hdr += "  DIR" if LOG_COLS >= 3 else " D"
            sa(stdscr, row, 0, hdr[:W], DIM); row += 1
            visible = H - row - 2
            # clamp selection, then scroll offset follows selection
            app.log_sel = max(0, min(app.log_sel, max(0, len(rs)-1)))
            if app.log_sel < app.log_offset:
                app.log_offset = app.log_sel
            if visible > 0 and app.log_sel >= app.log_offset + visible:
                app.log_offset = app.log_sel - visible + 1
            app.log_offset = max(0, min(app.log_offset, max(0, len(rs)-visible)))
            for idx in range(app.log_offset, min(len(rs), app.log_offset+visible)):
                r   = rs[idx]
                t   = r["totalOffsetSec"]
                sel = (idx == app.log_sel)
                col = GREEN if t==0 else (RED if abs(t)>60 else GOLD if abs(t)>5 else 0)
                if sel: col |= curses.A_REVERSE
                adj = r.get("minuteAdjust", 0)
                syncm = "⚡" if r.get("postSync") else " "
                # Build the row by priority instead of one narrow/wide switch.
                # A 56-column phone has room for the residual even though it
                # cannot fit every column, and the residual is the most useful
                # thing here — a binary cutoff threw it away for no reason.
                g  = gap_by_id.get(id(r))
                rv = resid_by_id.get(id(r))
                lone = id(r) in lone_by_id
                line = (f"{'▶' if sel else ' '}{syncm}{fmt_ts(r['ts'])[2:]:<15}"
                        f":{r['ntpSeconds']:02d}{fmt_dev_short(t):>8}"
                        f" {reading_method(r):>3}")
                if adj:
                    line += "!"
                elif LOG_COLS >= 1:
                    line += " "
                if LOG_COLS >= 1:      # residual
                    line += ("  JUMP" if lone else
                             f"{rv:+6.2f}" if rv is not None else "     ·")
                if LOG_COLS >= 2:      # gap in days
                    line += f"{g:6.1f}" if g is not None and g >= 0.05 else "     ·"
                if LOG_COLS >= 3:      # full direction word
                    line += f"  {direction(t)}"
                else:
                    line += f" {direction(t)[0] if t else 'E'}"
                if not sel:
                    e = r.get("readErrSec", READ_ERR)
                    if lone or (rv is not None and abs(rv) > max(4*e, 0.8)):
                        col = RED | BOLD
                sa(stdscr, row, 0, line[:W], col); row += 1
            # detail for the selected reading
            if rs and 0 <= app.log_sel < len(rs) and row < H-2:
                d = rs[app.log_sel]
                bits = []
                if d.get("taps"):
                    bits.append(f"{d['taps']} taps ±{d.get('tapJitterMs','?')}ms")
                    dr = d.get("tapDriftMsPerTick")
                    if dr is not None:
                        bits.append(f"beat {dr:+.1f}ms/tick")
                    tr = d.get("tapResidMs")
                    if tr:
                        bits.append(f"worst {max(abs(x) for x in tr)}ms")
                if d.get("readErrSec") is not None:
                    bits.append(f"err ±{d['readErrSec']}s")
                if d.get("ntpServer"):
                    bits.append(f"{d['ntpServer']} rtt {d.get('ntpDelayMs','?')}ms")
                if bits:
                    row += 1
                    sa(stdscr, row, 2, ("  " + "  ·  ".join(bits))[:W-3], DIM)

    # ══ READING DETAIL ════════════════════════════════════════════════════════
    elif app.screen == "DETAIL":
        rs = app.watch_readings()
        if not rs or not (0 <= app.log_sel < len(rs)):
            sa(stdscr, row, 2, "No reading selected.  [Esc] back", DIM)
        else:
            d = rs[app.log_sel]
            w = app.watch
            sa(stdscr, row, 2,
               f"Reading detail — {w['name'] if w else '?'}", CYAN|BOLD); row += 1
            sa(stdscr, row, 2, f"{fmt_ts(d['ts'])}   "
               f"{fmt_deviation(d['totalOffsetSec'])} {direction(d['totalOffsetSec'])}",
               GOLD|BOLD); row += 2

            def kv(k, v, attr=DIM):
                nonlocal row
                if row < H-2:
                    sa(stdscr, row, 2, f"{k:<14}{v}"[:W-3], attr); row += 1

            kv("method", "tap-averaged" if d.get("taps") else
                         ("single press" if d.get("method")=="press" else "press (legacy)"))
            kv("NTP second", f":{d.get('ntpSeconds','?')}s   raw "
                             f"{d.get('rawOffsetSec','?')}s   adj "
                             f"{d.get('minuteAdjust',0):+d}m")
            # How far from the whole second the mark actually landed. For a
            # press this is the only feedback on your own timing: the reading
            # cannot separate watch offset from press error, but seeing the
            # millisecond figure shows the scale you are working at.
            # Shown ONLY for a reset mark. On a reset the watch is known to
            # sit at zero, so the sub-second part is your setting error and
            # nothing else. On an ordinary drift mark the same number is
            # dominated by the watch's own offset, so reading it as "how close
            # I hit :00" would be wrong — hence no display there.
            _raw = d.get("rawOffsetSec")
            if _raw is not None and d.get("postSync"):
                frac = float(_raw) - round(float(_raw))
                kv("set to within", f"{abs(frac)*1000:.0f}ms of :00",
                   GREEN if abs(frac) < 0.05 else DIM)
            if d.get("readErrSec") is not None:
                kv("read error", f"±{d['readErrSec']}s")
            if d.get("ntpServer"):
                kv("NTP server", f"{d['ntpServer']}   offset "
                                 f"{d.get('ntpOffsetMs','?')}ms   rtt "
                                 f"{d.get('ntpDelayMs','?')}ms")
            if d.get("postSync"):
                kv("baseline", "⚡ sync — starts a new segment", GREEN)

            tr = d.get("tapResidMs")
            if tr:
                row += 1
                n = len(tr)
                worst = max(abs(x) for x in tr)
                drift = d.get("tapDriftMsPerTick")
                kv("taps", f"{n} over {d.get('tapSpanTicks','?')} ticks", 0)
                kv("your jitter", f"±{d.get('tapJitterMs','?')}ms rms   "
                                  f"worst {worst}ms", 0)
                if d.get("tapsTrimmed"):
                    kv("outliers", f"{d['tapsTrimmed']} dropped (UI stall or "
                                   f"slip) — excluded from the fit", GOLD)
                if drift is not None:
                    verdict = ("steady" if abs(drift) < 2 else
                               "speeding up" if drift > 0 else "slowing down")
                    kv("beat drift", f"{drift:+.2f} ms/tick   ({verdict})",
                       0 if abs(drift) < 2 else GOLD)
                # how much the worst tap actually mattered
                kv("effect on :00", f"±{d.get('tapJitterMs',0)/ (n**0.5):.0f}ms "
                                    f"(jitter/√n — one bad tap barely moves it)")
                row += 1
                # residual plot: one column per tap
                cw = min(W-8, n)
                ch = min(7, H-row-3)
                if ch >= 3 and cw >= 4:
                    amp = max(worst, 1)
                    grid = [[" "]*cw for _ in range(ch)]
                    zr = ch//2
                    for c in range(cw):
                        grid[zr][c] = "·"
                    for i, v in enumerate(tr):
                        c = int(i/(n-1)*(cw-1)) if n > 1 else 0
                        rr = zr - int(round(v/amp*(ch//2)))
                        grid[max(0,min(ch-1,rr))][c] = "●"
                    sa(stdscr, row, 2, f"{amp:>+5.0f}ms ┐", DIM)
                    for i, g in enumerate(grid):
                        sa(stdscr, row+i, 11, "".join(g), GOLD)
                    sa(stdscr, row+ch-1, 2, f"{-amp:>+5.0f}ms ┘", DIM)
                    row += ch
                    sa(stdscr, row, 11,
                       f"tap 1{'':<{max(0,cw-10)}}tap {n}   · = on the beat", DIM)
                    row += 1
            sa(stdscr, min(row+1, H-2), 2, "  [Esc] back to log", GOLD)

    # ══ TREND ══════════════════════════════════════════════════════════════════
    elif app.screen == "TREND":
        w = app.watch
        if not w:
            sa(stdscr, row, 2, "No watch selected.", DIM)
        else:
            rs_all = app.watch_readings()
            rs = sorted(rs_all, key=lambda r: r["ts"])
            sa(stdscr, row, 2, f"Trend — {w['name']}", CYAN|BOLD); row += 1
            prof = profile_for(w)
            if prof:
                mv = prof.get("movement") or "?"
                sp = prof.get("spec_s_per_year")
                conf = prof.get("confidence", "")
                store = prof.get("storage", "")
                bits = [mv]
                if sp is not None:
                    bits.append(f"spec ±{sp:g} s/yr"
                                + (" (inferred)" if conf == "inferred" else ""))
                if store:
                    bits.append(store)
                sa(stdscr, row, 2, " · ".join(bits)[:W-3], DIM)
                row += 1
            row += 1

            if len(rs) < 2:
                if app.show_notes:
                    draw_profile_notes(stdscr, row, W, H, w, prof,
                                       CYAN, DIM, GOLD, BOLD)
                else:
                    n0 = len(rs)
                    for ln in _wrap(
                            f"{n0} reading{'' if n0 == 1 else 's'} — a rate "
                            f"needs 2, and a useful rate needs weeks between "
                            f"them.", W-4):
                        sa(stdscr, row, 2, ln, DIM); row += 1
                    row += 1
                    nxt = ("Press M to take the first one."
                           if n0 == 0 else
                           "Press M again in a few weeks. Precision comes "
                           "from elapsed span, not from reading count.")
                    for ln in _wrap(nxt, W-4):
                        sa(stdscr, row, 2, ln, 0); row += 1
                    if prof:
                        row += 1
                        for ln in _wrap("[I] setup notes for this watch — "
                                        "worth reading before the first mark",
                                        W-6):
                            sa(stdscr, row, 2, ln, GOLD); row += 1
            else:
                info = watch_rate_info(rs)
                segs, seg = info["segs"], info["seg"]
                # which segment the GRAPH shows. None = the live one.
                # The text block above always describes the live segment;
                # only the plot follows this selection, so browsing history
                # can never be mistaken for the current state.
                if app.seg_view is None:
                    gidx = len(segs) - 1
                else:
                    gidx = max(0, min(app.seg_view, len(segs) - 1))
                gseg = segs[gidx]
                first, last = rs[0], rs[-1]
                days = (last["ts"] - first["ts"]) / 86400

                sa(stdscr, row, 2,
                   f"Latest : {fmt_ts(last['ts'])}  {fmt_deviation(last['totalOffsetSec'])} {direction(last['totalOffsetSec'])}", 0)
                row += 1
                hist = f"History: {days:.1f}d  {len(rs)}r  {len(segs)} seg"
                if len(segs) > 1 and gidx != len(segs) - 1:
                    hist += f"   — GRAPH SHOWING SEG {gidx+1} (past)"
                sa(stdscr, row, 2, hist,
                   (GOLD|BOLD) if (len(segs) > 1 and gidx != len(segs)-1) else DIM)
                row += 1

                # current segment
                sspan = seg_span_days(seg)
                if info["collecting"] and seg_span_days(seg) <= 0 and len(seg) > 1:
                    sa(stdscr, row, 2,
                       f"Seg    : {len(seg)} readings at the same instant — "
                       f"no time span, no rate yet", DIM)
                    row += 1
                elif info["collecting"]:
                    nd = info["need_days"] or 0
                    sa(stdscr, row, 2,
                       f"Seg    : collecting {sspan:.1f}d/{len(seg)}r, need {nd:.0f}d", DIM)
                    row += 1
                    if info["rate"] is not None:
                        sa(stdscr, row, 2,
                           f"Expect : {fmt_syr(info['rate'])}  (prev seg)", DIM)
                        row += 1
                else:
                    rate = info["rate"]
                    trend_dir = "LOSE" if rate > 0 else "GAIN"
                    segfit = lsq_fit(seg)
                    err    = fit_err(segfit)
                    errtxt = f" ±{err*365:.0f}" if err else ""
                    sa(stdscr, row, 2,
                       f"Seg    : {fmt_syr(rate)}{errtxt} ({rate:+.2f}s/d) {trend_dir} [{sspan:.0f}d/{len(seg)}r]",
                       GOLD|BOLD)
                    row += 1
                # lifetime
                if info["life"] is not None and len(segs) > 1:
                    life = info["life"]
                    note = ""
                    # is the current segment actually different from lifetime?
                    segfit = lsq_fit(seg)
                    err = fit_err(segfit)
                    if err and not info["collecting"]:
                        gap = abs(info["rate"] - life)
                        note = "  SAME" if gap < 2*err else "  ← CHANGED"
                    sa(stdscr, row, 2,
                       f"Life   : {fmt_syr(life)}  ({len(segs)} seg wtd){note}", DIM)
                    row += 1

                # projection + next reset due
                now_ts = ntp_now_ms()/1000
                proj = predict_offset(rs, now_ts)
                if proj is not None:
                    tol = watch_tolerance(w)
                    line = f"Now    : {fmt_deviation(proj)} {direction(proj)}"
                    rate_p = info["rate"]
                    if rate_p:
                        remain = (tol - abs(proj)) / abs(rate_p)
                        if remain > 0:
                            due = now_ts + remain*86400
                            line += f"  reset~{datetime.fromtimestamp(due).strftime('%m-%d')}"
                        else:
                            line += f"  >±{tol:g}s RESET DUE"
                    sa(stdscr, row, 2, line, CYAN)
                    row += 1

                # fit residuals of current segment
                fit = lsq_fit(seg)
                if fit and len(seg) >= 3:
                    res = [r["totalOffsetSec"] - fit_at(fit, r["ts"]) for r in seg]
                    # n-2: the fit consumes two degrees of freedom, so
                    # dividing by n understates the scatter on short segments
                    rms = (sum(x*x for x in res)/(len(res)-2)) ** 0.5
                    mx  = max(abs(x) for x in res)
                    rerr = read_err(seg)
                    flag = "flat=ok" if rms <= 2*rerr else "SCATTER — fit unreliable"
                    sa(stdscr, row, 2,
                       f"Resid  : rms {rms:.2f}s max {mx:.2f}s ({flag})", DIM)
                    row += 1
                    prof = profile_for(w)
                    sp = watch_spec(w)
                    if sp and not info["collecting"]:
                        syr = abs(info["rate"] * 365)
                        segfit2 = lsq_fit(seg)
                        e2 = (fit_err(segfit2) or 0) * 365
                        # only call a watch out of spec if it is outside by
                        # more than its own error bar — otherwise the verdict
                        # is noise, not a finding
                        if syr - e2 > sp:
                            verdict, col = f"OUT of spec (±{sp:g} s/yr)", RED|BOLD
                        elif syr + e2 < sp:
                            verdict, col = f"within spec (±{sp:g} s/yr)", GREEN
                        else:
                            verdict, col = f"at spec limit (±{sp:g} s/yr)", DIM
                        if prof and prof.get("confidence") == "inferred":
                            verdict += " — spec inferred"
                        sa(stdscr, row, 2, f"Verdict: {verdict}", col)
                        row += 1
                    methods = {("tap" if r.get("taps") else "press") for r in seg}
                    if len(methods) > 1:
                        sa(stdscr, row, 2,
                           "         MIXED press+tap in this segment — press lands "
                           "late by reaction time", GOLD)
                        row += 1
                    if prof and prof.get("storage") == "drawer":
                        sa(stdscr, row, 2,
                           "         drawer watch: a slow seasonal bend in residuals "
                           "is normal", DIM)
                        row += 1
                row += 1

                # ASCII sparkline
                cw = min(W - 14, 60)
                ch = min(9, H - row - 4)
                # Residuals of the CURRENT SEGMENT only, plotted against real
                # elapsed time. Plotting raw totalOffsetSec across all readings
                # spans resets (so the jump dominates the shape) and plotting by
                # index gives a 5-month gap the same width as a 6-minute one.
                prof = profile_for(w)
                if app.show_notes:
                    row = draw_profile_notes(stdscr, row, W, H, w, prof,
                                             CYAN, DIM, GOLD, BOLD)
                    pfit = None
                    ch = 0
                else:
                    pfit = lsq_fit(gseg)
                if ch >= 3 and not app.plot_resid and len(gseg) >= 2 \
                        and seg_span_days(gseg) > 0:
                    # PLAIN view: actual clock error over time, plus the fit
                    # line. Reads like the log does — down = getting faster.
                    pts  = [(r["ts"], r["totalOffsetSec"]) for r in gseg]
                    vals = [v for _, v in pts]
                    lo, hi = min(vals + [0.0]), max(vals + [0.0])
                    if hi - lo < 1e-6:
                        lo, hi = lo - 1, hi + 1
                    pad = (hi - lo) * 0.1
                    lo, hi = lo - pad, hi + pad
                    span = hi - lo
                    t0, t1 = pts[0][0], pts[-1][0]
                    tspan = (t1 - t0) or 1
                    grid = [[" "]*cw for _ in range(ch)]

                    def _row(v):
                        rr = ch-1 - int(((v-lo)/span)*(ch-1))
                        return max(0, min(ch-1, rr))

                    if lo < 0 < hi:                       # zero = watch exact
                        for c in range(cw):
                            grid[_row(0.0)][c] = "─"
                    if pfit:                              # the fitted trend
                        for c in range(cw):
                            ts_c = t0 + (c/(cw-1))*tspan
                            grid[_row(fit_at(pfit, ts_c))][c] = "·"
                    for ts_i, v in pts:                   # the readings
                        col = int(((ts_i - t0)/tspan)*(cw-1))
                        grid[_row(v)][max(0, min(cw-1, col))] = "●"

                    sa(stdscr, row, 2, f"{hi:>+5.1f}s ┐", DIM)
                    for i, gr in enumerate(grid):
                        sa(stdscr, row+i, 11, "".join(gr), GOLD)
                    sa(stdscr, row+ch-1, 2, f"{lo:>+5.1f}s ┘", DIM)
                    row += ch
                    sa(stdscr, row, 11,
                       f"{datetime.fromtimestamp(t0).strftime('%m-%d'):<{cw//2}}"
                       f"{datetime.fromtimestamp(t1).strftime('%m-%d'):>{cw-cw//2}}", DIM)
                    row += 1
                    sa(stdscr, row, 11, seg_caption(segs, gidx, gseg,
                       "clock error · ● readings  · fit  ─ exact"), DIM)
                elif ch >= 3 and pfit and len(gseg) >= 3 and seg_span_days(gseg) > 0:
                    pts  = [(r["ts"], r["totalOffsetSec"] - fit_at(pfit, r["ts"]))
                            for r in gseg]
                    vals = [v for _, v in pts]
                    amp  = max(max(abs(v) for v in vals), READ_ERR/2)
                    lo, hi = -amp, amp          # symmetric around the fit line
                    span = hi - lo
                    t0, t1 = pts[0][0], pts[-1][0]
                    tspan = (t1 - t0) or 1
                    grid = [[" "]*cw for _ in range(ch)]
                    # fit line = zero residual
                    zr = ch-1 - int(((0-lo)/span)*(ch-1))
                    zr = max(0, min(ch-1, zr))
                    for c in range(cw):
                        grid[zr][c] = "·"
                    for ts_i, v in pts:
                        col = int(((ts_i - t0)/tspan)*(cw-1))
                        rr  = ch-1 - int(((v-lo)/span)*(ch-1))
                        rr  = max(0, min(ch-1, rr))
                        grid[rr][max(0, min(cw-1, col))] = "●"
                    sa(stdscr, row, 2, f"{hi:>+5.1f}s ┐", DIM)
                    for i, gr in enumerate(grid):
                        sa(stdscr, row+i, 11, "".join(gr), GOLD)
                    sa(stdscr, row+ch-1, 2, f"{lo:>+5.1f}s ┘", DIM)
                    row += ch
                    lbl_l = datetime.fromtimestamp(t0).strftime("%m-%d")
                    lbl_r = datetime.fromtimestamp(t1).strftime("%m-%d")
                    sa(stdscr, row, 11,
                       f"{lbl_l:<{cw//2}}{lbl_r:>{cw-cw//2}}", DIM)
                    row += 1
                    sa(stdscr, row, 11,
                       f"residuals vs fit · segment only · {seg_span_days(seg):.0f}d"
                       f"   [G]=plain", DIM)
                elif ch >= 3:
                    sa(stdscr, row, 2,
                       "  (residual plot needs 3+ readings in the current segment)",
                       DIM)

    # footer
    sa(stdscr, H-1, 0, "─"*W, DIM)
    sa(stdscr, H-1, 1,
       (" W M L T · I info · H help · SPACE rec · Q quit "
        if W < 58 else
        " W watch M mark L log T trend  I info  H/? HELP  SPACE=rec  Q quit "),
       DIM)

    stdscr.refresh()

# ── Main loop ──────────────────────────────────────────────────────────────────
def main(stdscr):
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(1, curses.COLOR_YELLOW, -1)
    curses.init_pair(2, curses.COLOR_WHITE,  -1)
    curses.init_pair(3, curses.COLOR_GREEN,  -1)
    curses.init_pair(4, curses.COLOR_RED,    -1)
    curses.init_pair(5, curses.COLOR_CYAN,   -1)
    curses.curs_set(0)
    stdscr.nodelay(True)
    stdscr.timeout(50)

    resync_ntp()
    app = App()

    while True:
        app.maybe_finalize_taps()
        draw(stdscr, app)
        key = stdscr.getch()

        # ── text input mode
        if app.input_mode:
            if key in (curses.KEY_ENTER, 10, 13):
                if app.input_kind == "add":
                    app.add_watch(app.input_buf)
                else:
                    app.set_spec(app.input_buf)
                app.input_buf = ""
                app.input_mode = False
            elif key == 27:
                app.input_buf = ""
                app.input_mode = False
            elif key in (curses.KEY_BACKSPACE, 127):
                app.input_buf = app.input_buf[:-1]
            elif 32 <= key < 127:
                if len(app.input_buf) < 30:
                    app.input_buf += chr(key)
            continue

        if key == -1:
            continue
        k = chr(key) if 0 < key < 256 else ""

        # ── TAP MODE swallows everything ──────────────────────────────────
        # Must run BEFORE global nav. Otherwise a mistimed finger landing on
        # w/m/l/t switches screen, n forces an NTP resync, . or , shifts the
        # minute adjust, and q quits the app outright — all mid-tap, all
        # silently dropping the tap that was meant. The user is watching the
        # watch face, not the keyboard, so any key means "tick".
        if app.tap_mode:
            if key == 27:                      # Esc: the one way out
                app.cancel_tap_mode()
            else:
                app.tap()
            continue

        # global nav
        if   k.lower() == "q": break
        elif k.lower() == "w": app.screen = "WATCHES"
        elif k.lower() == "m": app.screen = "MARK"
        elif k.lower() == "l": app.screen = "LOG"
        elif k.lower() == "t": app.screen = "TREND"
        elif k == "?" or (k.lower() == "h" and app.screen != "HELP"): app.screen = "HELP"
        elif k.lower() == "h": app.screen = "MARK"
        elif k.lower() == "b": app.show_bar = not app.show_bar
        elif k.lower() == "g": app.plot_resid = not app.plot_resid
        elif k.lower() == "i":
            # The footer offers "I info" on every screen, so it has to work
            # from every screen — not only from Trend, where it used to live.
            if app.screen == "TREND" and app.show_notes:
                app.show_notes = False
            else:
                app.screen = "TREND"
                app.show_notes = True
        elif k.lower() == "n": resync_ntp()
        elif k.lower() == "p": next_ntp_server()

        # minute correction for NEXT reading (everywhere except Log,
        # where </> edits the selected past reading instead)
        elif (k == ">" or k == ".") and app.screen != "LOG": app.minute_adjust += 1
        elif (k == "<" or k == ",") and app.screen != "LOG": app.minute_adjust -= 1

        # screen actions
        elif app.screen == "MARK":
            if key in (ord(" "), curses.KEY_ENTER, 10, 13):
                app.mark_zero()
            elif k.lower() == "c":
                app.start_tap_mode()
            elif k.lower() == "y":
                app.sync_arm = not app.sync_arm
                app._flash("  Next reading = SYNC baseline ⚡" if app.sync_arm
                           else "  Sync arming cancelled.")
            elif k.lower() == "d":
                app.delete_last_reading()

        elif app.screen == "WATCHES":
            if   key == curses.KEY_UP:              app.selected = max(0, app.selected-1)
            elif key == curses.KEY_DOWN:            app.selected = min(len(app.data["watches"])-1, app.selected+1)
            elif k.lower() == "a":                  app.input_mode = True; app.input_kind = "add";  app.input_buf = ""
            elif k.lower() == "s":                  app.input_mode = True; app.input_kind = "spec"; app.input_buf = ""
            elif k.lower() == "x":                  app.delete_watch()
            elif key in (curses.KEY_ENTER, 10, 13): app.screen = "MARK"; app.seg_view = None

        elif app.screen == "HELP":
            if   key == curses.KEY_UP:    app.help_scroll = max(0, app.help_scroll-1)
            elif key == curses.KEY_DOWN:  app.help_scroll += 1
            elif key == curses.KEY_PPAGE: app.help_scroll = max(0, app.help_scroll-12)
            elif key == curses.KEY_NPAGE: app.help_scroll += 12
            elif key == 27:               app.screen = "MARK"

        elif app.screen == "TREND":
            nsegs = len(watch_rate_info(app.watch_readings())["segs"]) \
                    if app.watch_readings() else 1
            cur = app.seg_view if app.seg_view is not None else nsegs - 1
            if   key == curses.KEY_LEFT:  app.seg_view = max(0, cur - 1)
            elif key == curses.KEY_RIGHT:
                app.seg_view = None if cur + 1 >= nsegs - 1 else cur + 1
            elif key == curses.KEY_UP:    app.selected = max(0, app.selected-1); app.seg_view = None
            elif key == curses.KEY_DOWN:  app.selected += 1; app.seg_view = None
            elif key == 27:               app.seg_view = None; app.show_notes = False

        elif app.screen == "LOG":
            if   key == curses.KEY_UP:    app.log_sel = max(0, app.log_sel-1)
            elif key == curses.KEY_DOWN:  app.log_sel += 1
            elif key == curses.KEY_PPAGE: app.log_sel = max(0, app.log_sel-10)
            elif key == curses.KEY_NPAGE: app.log_sel += 10
            elif k == ">" or k == ".":    app.adjust_selected_reading(+1)
            elif k == "<" or k == ",":    app.adjust_selected_reading(-1)
            elif k.lower() == "y":        app.toggle_sync_flag()
            elif k.lower() == "d":        app.delete_selected_reading()
            elif key in (curses.KEY_ENTER, 10, 13): app.screen = "DETAIL"

        elif app.screen == "DETAIL":
            if key == 27 or k.lower() in ("l",):
                app.screen = "LOG"
            elif key == curses.KEY_UP:
                app.log_sel = max(0, app.log_sel-1)
            elif key == curses.KEY_DOWN:
                app.log_sel += 1

if __name__ == "__main__":
    print("Watch Drift Recorder")
    print(f"  data: {DATA_FILE}")
    print(f"  specs: {_profiles_path()}"
          + ("" if _profiles_path().exists() else "   (not found)"))
    print("pip install ntplib   (for NTP sync)")
    time.sleep(0.4)
    try:
        curses.wrapper(main)
    except KeyboardInterrupt:
        pass
    print(f"Data saved to {DATA_FILE}  —  goodbye.")
