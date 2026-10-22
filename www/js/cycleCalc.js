// Cycle predictions for the Cycle tab (cycle.js), worked out from the log
// alone: nothing extra is saved, so a wrong entry fixed in the Log fixes
// the predictions too. Pure functions (no screen, no storage), so they can
// be tested on their own.
//
// HOW (the "calendar method" period apps use) — asked for as "projections
// to allow planning: going out, trying for a baby, safe sex… and the days
// that might be tricky":
// - A cycle runs from the first day of one period to the day before the
//   next. Its length is learned from the gaps between the period starts in
//   the log (the last 6; a gap under 18 or over 50 days is left out — most
//   likely a period that wasn't logged).
// - Next period = the last start + the average cycle.
// - Ovulation ≈ 14 days before the next period. WHY from the end: the
//   days after ovulation vary little; the days before it vary a lot.
// - Fertile days = the 5 days before ovulation (sperm can live that long),
//   the day itself and the day after. When cycles vary, the window is
//   widened by the shortest and the longest cycle, so it stays honest.
// - PMS days = the 5 days before the next period.
// All of this is an estimate. It is never birth control.

export const DAY_MS = 86400000;
// "2026-10-22" ↔ whole days since 1970-01-01. WHY UTC: a day number must
// not shift with summer time.
export function dayNum(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}
export const isoOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export const LUTEAL = 14; // days from ovulation to the next period
const BEFORE = 5; // fertile days before ovulation
const AFTER = 1; // and after it
export const PMS_DAYS = 5;
const MIN_GAP = 18; // plausible cycle lengths; others are left out
const MAX_GAP = 50;
const RECENT = 6; // how many recent cycles / periods the averages use
// A period "running" longer than this was most likely not ended in the
// app: the calendar then shows it with the usual length (and the tab asks).
export const MAX_RUNNING = 14;

export const DEFAULTS = { length: 28, periodLength: 5, fertile: true, pms: true };

// The Cycle tab's settings (config "cycle"), with defaults filled in.
export function cycleSettings(config) {
  const c = (config && config.cycle) || {};
  return {
    period: c.period || null,
    diary: c.diary || null,
    length: c.length || DEFAULTS.length,
    periodLength: c.periodLength || DEFAULTS.periodLength,
    fertile: c.fertile !== false,
    pms: c.pms !== false,
  };
}

// The periods in the log: each start of the period button with its end.
// [{ start, end (null = still running), startRec, endRec }], oldest first.
export function periodsFrom(entries, periodId) {
  const ends = new Map();
  for (const e of entries) {
    if (e.kind === 'event_end' && e.item_id === periodId && e.session_id) ends.set(e.session_id, e);
  }
  return entries.filter((e) => e.kind === 'event_start' && e.item_id === periodId && e.date)
    .map((s) => {
      const endRec = ends.get(s.id) || null;
      const start = dayNum(s.date);
      return { start, end: endRec ? Math.max(start, dayNum(endRec.date)) : null, startRec: s, endRec };
    })
    .sort((a, b) => a.start - b.start);
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// Average cycle and period length learned from the log; the usual lengths
// from the settings until there is something to learn from.
export function cycleStats(periods, settings) {
  const gaps = [];
  for (let i = 1; i < periods.length; i++) gaps.push(periods[i].start - periods[i - 1].start);
  const used = gaps.filter((g) => g >= MIN_GAP && g <= MAX_GAP).slice(-RECENT);
  const lens = periods.filter((p) => p.end != null).map((p) => p.end - p.start + 1)
    .filter((l) => l >= 1 && l <= 12).slice(-RECENT);
  const avg = used.length ? Math.round(mean(used)) : settings.length;
  return {
    avg,
    min: used.length ? Math.min(...used) : avg,
    max: used.length ? Math.max(...used) : avg,
    plen: Math.min(lens.length ? Math.round(mean(lens)) : settings.periodLength, avg - 1),
    cycles: used.length, // how many cycles the average is based on
    periods: lens.length,
  };
}

// Everything the Cycle tab needs, for "today" (a day number).
// Returns null when no period was logged yet.
export function buildCycle(entries, periodId, settings, today) {
  const periods = periodsFrom(entries, periodId);
  if (!periods.length) return null;
  const stats = cycleStats(periods, settings);
  const last = periods[periods.length - 1];
  const running = last.end == null && today >= last.start && today - last.start < MAX_RUNNING;
  const forgotEnd = last.end == null && !running;
  const expected = last.start + stats.avg; // when the next period is due
  const late = !running && today > expected ? today - expected : 0;
  // Later than a whole cycle: most likely periods weren't logged (or a
  // pregnancy) — no more guessing; the tab says so.
  const stale = late > stats.avg;

  // The days each logged period covers on the calendar: to its end; a
  // running one to today; one never ended, the usual length.
  for (const p of periods) {
    p.shownEnd = p.end != null ? p.end : running && p === last ? today : p.start + stats.plen - 1;
  }
  // Logged cycles, then predicted ones for about a year ahead.
  const cycles = periods.map((p, i) => {
    const next = periods[i + 1];
    const len = next ? next.start - p.start : stats.avg; // the last one: expected
    return {
      start: p.start,
      len,
      known: !!next, // its length is known (the next period was logged)
      // A gap no cycle has (e.g. periods not logged for months): no
      // guesses about fertile days inside it.
      odd: !!next && (len < MIN_GAP || len > MAX_GAP),
      period: p,
      periodEnd: p.shownEnd,
    };
  });
  if (!stale) {
    // When late, the next period may come any day: predictions start today.
    let s = late ? today : expected;
    while (s < today + 400) {
      cycles.push({ start: s, len: stats.avg, known: false, period: null, periodEnd: s + stats.plen - 1, predicted: true });
      s += stats.avg;
    }
  }
  for (const c of cycles) {
    c.ovu = c.start + c.len - LUTEAL;
    // A finished cycle: the window around its (now known) ovulation. The
    // current and future ones: widened by how much cycles vary.
    c.fertile = c.known
      ? [c.ovu - BEFORE, c.ovu + AFTER]
      : [c.start + stats.min - LUTEAL - BEFORE, c.start + stats.max - LUTEAL + AFTER];
    c.pms = [c.start + c.len - PMS_DAYS, c.start + c.len - 1];
  }
  return {
    periods, stats, cycles, today, last, lastCycle: cycles[periods.length - 1],
    running, forgotEnd, expected, late, stale, settings,
  };
}

// The cycle a day belongs to (or null before the first logged period).
function cycleOf(m, d) {
  let found = null;
  for (const c of m.cycles) {
    if (c.start <= d) found = c;
    else break;
  }
  return found;
}

// What a day is: { cycleDay, period: 'logged'|'expected'|null, periodDay,
// fertile, ovulation, pms, chance: 'high'|'medium'|'low'|null, phase,
// ovuDay (its cycle's estimated ovulation day) }.
// phase: period | follicular | fertile | luteal | pms | late | null.
export function dayInfo(m, d) {
  if (!m) return null;
  const c = cycleOf(m, d);
  if (!c) return null;
  const p = m.periods.find((x) => x.start <= d && d <= x.shownEnd);
  const out = {
    cycleDay: d - c.start + 1, period: null, periodDay: null,
    fertile: false, ovulation: false, pms: false, chance: null, phase: null, ovuDay: c.ovu,
  };
  if (p) {
    out.period = 'logged';
    out.periodDay = d - p.start + 1;
  } else if ((c.predicted && d <= c.periodEnd)
    // the rest of a period that is running now
    || (m.running && c === m.lastCycle && d > m.today && d < c.start + m.stats.plen)) {
    out.period = 'expected';
    out.periodDay = d - c.start + 1;
  }
  // The current cycle past its expected length (the period is late), or
  // past today when predictions stopped: nothing more to say.
  const beyond = d >= c.start + c.len || (m.stale && d > m.today);
  if (!beyond && !c.odd) {
    out.fertile = d >= c.fertile[0] && d <= c.fertile[1];
    out.ovulation = d === c.ovu;
    out.pms = d >= c.pms[0] && d <= c.pms[1];
    out.chance = out.fertile ? (d >= c.ovu - 2 && d <= c.ovu ? 'high' : 'medium') : 'low';
  }
  if (out.period) out.phase = 'period';
  else if (beyond) out.phase = c === m.lastCycle && d <= m.today ? 'late' : null;
  else if (c.odd) out.phase = null;
  else if (out.fertile) out.phase = 'fertile';
  else if (out.pms) out.phase = 'pms';
  else out.phase = d < c.fertile[0] ? 'follicular' : 'luteal';
  return out;
}

// What's coming, for planning: the next periods and fertile windows, in
// date order (only ones not over yet). [{ type, from, to, ovu? }]
export function comingUp(m, count = 6) {
  if (!m || m.stale) return [];
  const out = [];
  for (const c of m.cycles) {
    if (!c.known && m.settings.fertile && c.fertile[1] >= m.today) {
      out.push({ type: 'fertile', from: Math.max(c.fertile[0], c.start), to: c.fertile[1], ovu: c.ovu });
    }
    if (c.predicted) out.push({ type: 'period', from: c.start, to: c.periodEnd, pms: m.settings.pms ? c.start - PMS_DAYS : null });
  }
  return out.filter((x) => x.to >= m.today).sort((a, b) => a.from - b.from).slice(0, count);
}

// Personal patterns: what was logged notably more often in a phase than on
// other days (at least 1.5 times as often per day, and at least twice) —
// the "tricky days", from the user's own log rather than general advice.
// itemsByDay: Map(dayNum → [{ key, label }]). Rows: { label, n (times in
// the phase), all (times in all), ratio }. Null until a whole cycle is logged.
export function patterns(m, itemsByDay) {
  if (!m || !m.cycles.some((c) => c.known)) return null;
  const PHASES = ['period', 'fertile', 'pms'];
  const days = { period: 0, fertile: 0, pms: 0, all: 0 };
  const counts = new Map();
  for (let d = m.periods[0].start; d < m.today; d++) {
    const info = dayInfo(m, d);
    if (!info || !info.phase || info.phase === 'late') continue;
    days.all++;
    const ph = PHASES.includes(info.phase) ? info.phase : null;
    if (ph) days[ph]++;
    for (const it of itemsByDay.get(d) || []) {
      if (!counts.has(it.key)) counts.set(it.key, { label: it.label, all: 0, period: 0, fertile: 0, pms: 0 });
      const c = counts.get(it.key);
      c.all++;
      if (ph) c[ph]++;
    }
  }
  const out = {};
  for (const ph of PHASES) {
    const rows = [];
    const outDays = days.all - days[ph];
    if (!days[ph]) { out[ph] = rows; continue; }
    for (const [key, c] of counts) {
      if (c[ph] < 2) continue;
      const inRate = c[ph] / days[ph];
      const outRate = outDays ? (c.all - c[ph]) / outDays : 0;
      const ratio = outRate ? inRate / outRate : Infinity;
      if (ratio >= 1.5) rows.push({ key, label: c.label, n: c[ph], all: c.all, ratio });
    }
    rows.sort((a, b) => b.ratio - a.ratio || b.n - a.n);
    out[ph] = rows.slice(0, 4);
  }
  return out;
}
