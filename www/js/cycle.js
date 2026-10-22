// Cycle tab: when the next period is due, the fertile days and the PMS
// days — for planning. Asked for as "a separate period tab… projections to
// allow planning like going out, the goal to make a baby or to have safe
// sex, and the days that might be tricky (when fertile, more flirty, which
// might be good or bad depending on the context)".
// The numbers come from cycleCalc.js, from the log only. This file draws
// them: a status card, a month calendar (tap a day: what it is, what was
// logged, mark a period's start or end), what's coming up, the averages,
// and the user's own patterns per phase. Settings → Cycle holds the
// settings (config "cycle").

import * as storage from './storage.js';
import {
  eventLabel, fetchDefaultFor, parseConfigText, saveConfig,
} from './config.js';
import {
  logEvent, MOODS, openFinishSheet, openSpan, wireReminders,
} from './events.js';
import { details, openDetails, screenLabel } from './log.js';
import { makeRecord } from './record.js';
import { remindersHtml } from './reminders.js';
import { optIcon, optName } from './lists.js';
import { visibleTabs } from './tabs.js';
import { icon } from './icons.js';
import {
  esc, friendlyDay, hhmm, isoWithTz, localDate, localTime,
} from './util.js';
import {
  dateLocale, fmtDay, getLang, t, weekStart,
} from './i18n.js';
import {
  buildCycle, comingUp, cycleSettings, dayInfo, dayNum, isoOf, patterns,
} from './cycleCalc.js';

// Names and notes of the phases (translation keys). The notes are the
// "tricky days" in general words; "Your patterns" below shows the user's own.
const PHASE_NAME = {
  period: 'Period', follicular: 'After your period', fertile: 'Fertile days',
  luteal: 'After ovulation', pms: 'PMS days', late: 'Late',
};

let shift = 0; // the calendar's month, counted from this month

const dateOf = (d) => {
  const [Y, M, D] = isoOf(d).split('-').map(Number);
  return new Date(Y, M - 1, D);
};
const dayText = (d) => friendlyDay(isoOf(d));
// "25–29 Oct" (the phone's own short form for a range of days).
function rangeText(a, b) {
  try {
    const f = new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short' });
    return a === b ? f.format(dateOf(a)) : f.formatRange(dateOf(a), dateOf(b));
  } catch {
    return a === b ? fmtDay(dateOf(a)) : `${fmtDay(dateOf(a))} – ${fmtDay(dateOf(b))}`;
  }
}
// A time on day d (a day number).
const atTime = (d, h, m) => {
  const x = dateOf(d);
  x.setHours(h, m, 0, 0);
  return x;
};

export async function renderCycle(el, ctx) {
  const { state } = ctx;
  const cs = cycleSettings(state.config);
  const periodEv = state.config.events.find((e) => e.id === cs.period && e.span);
  // Events hidden (Settings → Tabs): its reminder cards show here instead.
  const rem = visibleTabs(state.config).includes('events') ? '' : remindersHtml(state);
  if (!periodEv) {
    await renderSetup(el, ctx, rem);
    return;
  }
  const diaryEv = state.config.events.find((e) => e.id === cs.diary && !e.span) || null;
  const today = dayNum(localDate());
  const m = buildCycle(state.entries, periodEv.id, cs, today);
  el.innerHTML = `${rem}${heroHtml(m, cs, diaryEv, today)}
    ${calendarHtml(m, cs, state, periodEv.id, today)}
    ${comingHtml(m, today)}
    ${statsHtml(m, cs)}
    ${patternsHtml(m, cs, state, periodEv.id)}
    <a class="btn wide cy-settings" href="#settings/cycle">${icon('sliders')}<span>${esc(t('Cycle settings'))}</span></a>
    <p class="small muted cy-disclaimer">${esc(t('CYCLE_DISCLAIMER'))}</p>`;
  wireReminders(el, ctx);

  el.querySelector('[data-act="period"]').addEventListener('click', async () => {
    const run = openSpan(state, periodEv.id);
    if (run && m?.running) { openFinishSheet(ctx, periodEv, run); return; }
    // A period never ended in the app ended before this new one.
    if (run) await commit(ctx, { add: [endRecord(periodEv, run, endAt(Math.min(dayNum(run.date) + (m ? m.stats.plen : cs.periodLength) - 1, today - 1)))] });
    logEvent(ctx, periodEv);
  });
  el.querySelector('[data-act="diary"]')?.addEventListener('click', () => logEvent(ctx, diaryEv));
  el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.m);
    shift = v === 0 ? 0 : Math.max(-36, Math.min(14, shift + v));
    ctx.refresh();
  }));
  el.querySelectorAll('.cy-d[data-day]').forEach((b) => b.addEventListener('click', () => {
    openDay(ctx, Number(b.dataset.day), m, cs, periodEv, diaryEv);
  }));
}

// --- status card -------------------------------------------------------------------

// The phase shown for a day: fertile and PMS days only when they're shown
// at all (Settings → Cycle); "late" while the period is late.
function shownPhase(m, info, cs, d) {
  if (!info) return null;
  if (m.late && d >= m.expected && d <= m.today) return 'late';
  let ph = info.phase;
  if (ph === 'fertile' && !cs.fertile) ph = d <= info.ovuDay ? 'follicular' : 'luteal';
  if (ph === 'pms' && !cs.pms) ph = 'luteal';
  return ph;
}

const tag = (cls, text) => `<span class="pill cy-tag"><i class="cy-sw ${cls}"></i>${esc(text)}</span>`;

// What a day is, as small labels: period, fertile, ovulation, PMS, late,
// chance of pregnancy.
function dayTags(m, info, cs, d) {
  if (!info) return [];
  const out = [];
  if (info.period === 'logged') out.push(tag('c-per', t('Period · day {n}', { n: info.periodDay })));
  else if (info.period === 'expected') out.push(tag('c-exp', t('Expected period')));
  if (cs.fertile && info.ovulation) out.push(tag('c-ovu', t('Ovulation (estimated)')));
  else if (cs.fertile && info.fertile) out.push(tag('c-fer', t('Fertile days')));
  if (cs.pms && info.pms && !info.period) out.push(tag('c-pms', t('PMS days')));
  const late = shownPhase(m, info, cs, d) === 'late';
  if (late) out.push(tag('', t('Late')));
  // While late, nobody can say: no chance shown.
  if (cs.fertile && info.chance && !late) out.push(`<span class="pill cy-chance cy-chance-${info.chance}">${esc(t(`CHANCE_${info.chance}`))}</span>`);
  return out;
}

function heroHtml(m, cs, diaryEv, today) {
  let big;
  let sub = '';
  let note = '';
  let tags = [];
  if (!m) {
    big = t('No period logged yet');
    note = t('CYCLE_START_HINT');
  } else {
    const info = dayInfo(m, today);
    if (m.running) {
      big = t('Period · day {n}', { n: today - m.last.start + 1 });
      const endBy = m.last.start + m.stats.plen - 1;
      sub = t('Usually lasts {n} days', { n: m.stats.plen }) + (endBy > today ? ` · ${t('until about {date}', { date: dayText(endBy) })}` : '');
    } else if (m.stale) {
      big = t('No period logged since {date}', { date: dayText(m.last.start) });
      note = t('STALE_NOTE');
    } else {
      if (m.late) big = t('Period is {n} days late', { n: m.late });
      else if (m.expected === today) big = t('Period expected today');
      else big = t('Period in {n} days', { n: m.expected - today });
      sub = `${t('Expected {date}', { date: dayText(m.expected) })} · ${t('Cycle day {n}', { n: today - m.last.start + 1 })}`;
    }
    if (!m.stale) {
      tags = dayTags(m, info, cs, today).filter((x) => !x.includes('c-per')); // the title says it
      const ph = shownPhase(m, info, cs, today);
      if (ph) note = t(`PHASE_${ph}`);
    }
    if (m.forgotEnd) note = t('FORGOT_END_NOTE', { n: today - m.last.start + 1 });
  }
  return `<section class="card cy-hero">
    <div class="cy-big">${esc(big)}</div>
    ${sub ? `<div class="cy-sub">${esc(sub)}</div>` : ''}
    ${tags.length ? `<div class="cy-pills">${tags.join('')}</div>` : ''}
    ${note ? `<p class="cy-note">${esc(note)}</p>` : ''}
    <div class="cy-actions">
      <button class="btn primary" data-act="period">${icon('drop')}<span>${esc(m?.running ? t('Period ended') : t('Period started'))}</span></button>
      ${diaryEv ? `<button class="btn" data-act="diary">${icon('edit')}<span>${esc(eventLabel(diaryEv))}</span></button>` : ''}
    </div>
  </section>`;
}

// --- calendar -------------------------------------------------------------------------

// Days with something logged (other than the period itself): a dot.
function loggedDays(state, periodId) {
  return new Set(state.entries.filter((e) => (e.kind === 'event' || e.kind === 'event_start')
    && e.item_id !== periodId).map((e) => e.date));
}

function calendarHtml(m, cs, state, periodId, today) {
  const now = dateOf(today);
  const first = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const ws = weekStart();
  const lead = (first.getDay() - ws + 7) % 7;
  let wds = [];
  let month = '';
  try {
    const fWd = new Intl.DateTimeFormat(dateLocale(), { weekday: 'narrow' });
    // 4 Jan 2026 was a Sunday.
    wds = Array.from({ length: 7 }, (_, i) => fWd.format(new Date(2026, 0, 4 + ((ws + i) % 7))));
    month = new Intl.DateTimeFormat(dateLocale(), { month: 'long', year: 'numeric' }).format(first);
  } catch { /* an older browser: no names */ }
  const has = loggedDays(state, periodId);
  const d0 = dayNum(localDate(first));
  const cells = Array.from({ length: lead }, () => '<span class="cy-d blank"></span>');
  for (let k = 0; k < days; k++) {
    const d = d0 + k;
    const info = m ? dayInfo(m, d) : null;
    const cls = ['cy-d'];
    const words = [];
    if (info?.period === 'logged') { cls.push('c-per'); words.push(t('Period')); }
    else if (info?.period === 'expected') { cls.push('c-exp'); words.push(t('Expected period')); }
    else if (cs.fertile && info?.ovulation) { cls.push('c-ovu'); words.push(t('Ovulation (estimated)')); }
    else if (cs.fertile && info?.fertile) { cls.push('c-fer'); words.push(t('Fertile days')); }
    if (cs.pms && info?.pms && !info.period) { cls.push('c-pms'); words.push(t('PMS days')); }
    if (d === today) { cls.push('c-today'); words.push(t('Today')); }
    if (has.has(isoOf(d))) cls.push('c-has');
    const label = `${fmtDay(dateOf(d))}${words.length ? ` — ${words.join(', ')}` : ''}`;
    cells.push(`<button class="${cls.join(' ')}" data-day="${d}" aria-label="${esc(label)}"><span>${k + 1}</span></button>`);
  }
  const items = [['c-per', 'Period'], ['c-exp', 'Expected period']];
  if (cs.fertile) items.push(['c-fer', 'Fertile days'], ['c-ovu', 'Ovulation (estimated)']);
  if (cs.pms) items.push(['c-pms', 'PMS days']);
  items.push(['c-has', 'Something logged']);
  return `<section class="card cy-cal">
    <div class="cy-cal-head">
      <button class="ibtn ghost" data-m="-1" aria-label="${esc(t('Previous month'))}">${icon('back', 'flip')}</button>
      <div class="cy-month"><b>${esc(month)}</b>${shift ? `<button class="text-btn" data-m="0">${esc(t('Back to today'))}</button>` : ''}</div>
      <button class="ibtn ghost" data-m="1" aria-label="${esc(t('Next month'))}">${icon('chevron', 'flip')}</button>
    </div>
    <div class="cy-wd" aria-hidden="true">${wds.map((w) => `<span>${esc(w)}</span>`).join('')}</div>
    <div class="cy-grid">${cells.join('')}</div>
    <div class="cy-legend">${items.map(([c, l]) => `<span class="lg"><i class="cy-sw ${c}"></i>${esc(t(l))}</span>`).join('')}</div>
    <p class="small muted cy-tap">${esc(t('Tap a day to see it, or to mark when a period started or ended.'))}</p>
  </section>`;
}

// --- coming up, averages, patterns --------------------------------------------------

function relText(from, to, today) {
  if (from <= today && today <= to) return t('now');
  return from - today === 1 ? t('tomorrow') : t('in {n} days', { n: from - today });
}

function comingHtml(m, today) {
  const rows = comingUp(m, 6);
  if (!rows.length) return '';
  return `<h2 class="day">${esc(t('Coming up'))}</h2>
    <div class="card list cy-coming">${rows.map((r) => {
    const period = r.type === 'period';
    const extra = period ? (r.pms != null && r.pms > today ? t('PMS days may start {date}', { date: dayText(r.pms) }) : '')
      : t('Ovulation around {date}', { date: dayText(r.ovu) });
    return `<div class="cy-row"><i class="cy-sw ${period ? 'c-exp' : 'c-fer'}"></i>
      <div class="cy-row-text"><b>${esc(t(period ? 'Period' : 'Fertile days'))}</b>
        <span>${esc(rangeText(r.from, r.to))}</span>${extra ? `<small>${esc(extra)}</small>` : ''}</div>
      <span class="cy-rel">${esc(relText(r.from, r.to, today))}</span></div>`;
  }).join('')}</div>`;
}

function statsHtml(m, cs) {
  if (!m) return '';
  const s = m.stats;
  const based = s.cycles ? t('Based on your last {n} cycles', { n: s.cycles }) : t('USING_USUAL', { n: cs.length });
  const reg = s.cycles < 2 ? '' : s.max - s.min <= 7 ? t('Your cycle is regular.') : t('IRREGULAR_NOTE', { min: s.min, max: s.max });
  return `<h2 class="day">${esc(t('Your cycle'))}</h2>
    <div class="card pad">
      <div class="cy-stats">
        <div class="cy-stat"><b>${esc(t('{n} days', { n: s.avg }))}</b><span>${esc(t('Cycle length'))}${s.max > s.min ? ` · ${s.min}–${s.max}` : ''}</span></div>
        <div class="cy-stat"><b>${esc(t('{n} days', { n: s.plen }))}</b><span>${esc(t('Period length'))}</span></div>
      </div>
      <p class="small muted">${esc(based)}${reg ? ` ${esc(reg)}` : ''}</p>
    </div>`;
}

// What was logged on each day, as items to compare between phases: each
// answer of a pick-list (e.g. Cramps), each mood face, else the button
// itself (e.g. Headache). Private buttons by their short label only.
function itemsByDay(state, periodId) {
  const evs = new Map(state.config.events.map((e) => [e.id, e]));
  const map = new Map();
  for (const e of state.entries) {
    if (!(e.kind === 'event' || e.kind === 'event_start') || e.item_id === periodId || !e.date) continue;
    const ev = evs.get(e.item_id);
    const items = [];
    for (const l of ev?.lists || []) {
      for (const v of [].concat(e.answers?.[l.id] ?? [])) {
        const ic = optIcon(l.options.find((o) => optName(o) === v));
        items.push({ key: `a:${e.item_id}:${l.id}:${v}`, label: `${ic ? `${ic} ` : ''}${v}` });
      }
    }
    const mood = MOODS.find(([n]) => n === e.mood);
    if (mood) items.push({ key: `mood:${mood[0]}`, label: `${mood[1]} ${t(mood[2])}` });
    if (!items.length && ev) items.push({ key: `e:${ev.id}`, label: eventLabel(ev) });
    const d = dayNum(e.date);
    map.set(d, [...(map.get(d) || []), ...items]);
  }
  return map;
}

function patternsHtml(m, cs, state, periodId) {
  if (!m) return '';
  const p = patterns(m, itemsByDay(state, periodId));
  const phases = [['pms', 'Before your period'], ['period', 'During your period'], ['fertile', 'On fertile days']]
    .filter(([k]) => (k !== 'fertile' || cs.fertile) && (k !== 'pms' || cs.pms));
  let body;
  if (!p) body = `<p class="small muted">${esc(t('PATTERNS_EMPTY'))}</p>`;
  else {
    // Plain counts ("4 of 5 times") read easier than rates, and don't
    // sound dramatic while there is little data.
    const blocks = phases.filter(([k]) => p[k].length).map(([k, title]) => `<div class="cy-pat"><div class="label">${esc(t(title))}</div>
      <div class="cy-pat-list">${p[k].map((r) => `<span class="cy-pat-item">${esc(r.label)} <small>${esc(t('{n} of {all} times', { n: r.n, all: r.all }))}</small></span>`).join('')}</div></div>`);
    body = `${blocks.join('') || `<p class="small muted">${esc(t('Nothing stands out yet — keep logging.'))}</p>`}
      <p class="small muted">${esc(t('PATTERNS_HINT'))}</p>`;
  }
  return `<h2 class="day">${esc(t('Your patterns'))}</h2><div class="card pad">${body}</div>`;
}

// --- a day: what it is, what was logged, mark a period ---------------------------------

// What can be done about the period on day d (today or earlier).
function periodActions(m, d, today) {
  const periods = m ? m.periods : [];
  const cover = coveringPeriod(m, d, today);
  if (cover) {
    const acts = [];
    if (d !== cover.start) acts.push(['move-start', 'Period started this day']);
    if (cover.end !== d) acts.push(['set-end', 'Period ended this day']);
    acts.push(['remove', 'Remove this period', 'danger']);
    return acts;
  }
  const acts = [];
  const next = periods.find((x) => x.start > d);
  // A period starting a few days later: it really started on this day.
  acts.push([next && next.start - d <= 7 ? 'move-next' : 'new', 'Period started this day']);
  // Just after a period (or one never ended): it really ended on this day.
  const prev = [...periods].reverse().find((x) => x.start < d);
  if (prev && (prev.end == null ? d - prev.start <= 20 : d - prev.end <= 7)) acts.push(['extend-end', 'Period ended this day']);
  return acts;
}

// The logged period that day d is part of (a running one: up to today).
function coveringPeriod(m, d, today) {
  if (!m) return null;
  return m.periods.find((x) => x.start <= d && d <= (x.end != null ? x.end
    : x === m.last && m.running ? today : x.shownEnd)) || null;
}

function openDay(ctx, d, m, cs, periodEv, diaryEv) {
  const { state } = ctx;
  const today = dayNum(localDate());
  const iso = isoOf(d);
  const info = m ? dayInfo(m, d) : null;
  let title = iso;
  try {
    title = new Intl.DateTimeFormat(dateLocale(), {
      weekday: 'long', day: 'numeric', month: 'long', ...(dateOf(d).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    }).format(dateOf(d));
  } catch { /* the plain date */ }
  const tags = m ? dayTags(m, info, cs, d) : [];
  const ph = m ? shownPhase(m, info, cs, d) : null;
  const entries = state.entries.filter((e) => e.date === iso && ['event', 'event_start', 'event_end'].includes(e.kind));
  const acts = d <= today ? periodActions(m, d, today) : [];
  const root = ctx.openSheet(`
    <div class="sheet-head"><div><b>${esc(title)}</b>${info?.cycleDay ? `<br><span class="muted small">${esc(t('Cycle day {n}', { n: info.cycleDay }))}</span>` : ''}</div>
      <button class="ibtn ghost" data-act="close" aria-label="${esc(t('Close'))}">${icon('close')}</button></div>
    ${tags.length ? `<div class="cy-pills">${tags.join('')}</div>` : ''}
    ${ph ? `<p class="cy-note">${esc(t(`PHASE_${ph}`))}</p>` : ''}
    ${d > today && info ? `<p class="small muted">${esc(t('An estimate from your log.'))}</p>` : ''}
    ${entries.length ? `<div class="label">${esc(t('Logged this day'))}</div>
      <div class="card">${entries.map((e) => `<div class="recent-row"><button class="recent-main" data-id="${esc(e.id)}">
        <span class="row-time">${esc(hhmm(e.time))}</span><span class="recent-name">${esc(screenLabel(state, e))}</span>
        <span class="recent-sub">${esc(details(e, state))}</span></button></div>`).join('')}</div>` : ''}
    <div class="cy-day-acts">
      ${diaryEv && d <= today ? `<button class="btn primary wide" data-cy="diary">${icon('edit')}<span>${esc(t('Add to {name}', { name: eventLabel(diaryEv) }))}</span></button>` : ''}
      ${acts.map(([act, label, cls]) => `<button class="btn wide${cls ? ` ${cls}` : ''}" data-cy="${act}">${esc(t(label))}</button>`).join('')}
    </div>`);
  root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelectorAll('.recent-main[data-id]').forEach((b) => b.addEventListener('click', () => {
    const e = state.entries.find((x) => x.id === b.dataset.id);
    if (e) openDetails(ctx, e);
  }));
  root.querySelectorAll('[data-cy]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.cy;
    if (act === 'diary') {
      ctx.closeSheet();
      logEvent(ctx, diaryEv, { date: iso });
      return;
    }
    periodChange(ctx, act, d, m, cs, periodEv);
  }));
}

// --- changing periods (explicit edits by the user, with Undo) ----------------------

// Its number within its day, among that day's other starts before it.
function nthOn(state, itemId, at, exceptId) {
  const date = localDate(at);
  return new Set(state.entries.filter((x) => x.id !== exceptId && x.item_id === itemId && x.date === date
    && (x.kind === 'event' || x.kind === 'event_start') && Date.parse(x.ts) < at.getTime())
    .map((x) => x.session_id || x.id)).size + 1;
}

// When a period start or end put on day d happens: now for today, else
// the same time of day as before (or a neutral one).
function onDay(d, rec, h, min) {
  if (d === dayNum(localDate())) return new Date();
  if (!rec) return atTime(d, h, min);
  const x = dateOf(d);
  const [hh, mm, ss] = rec.time.split(':').map(Number);
  x.setHours(hh, mm, ss || 0, 0);
  return x;
}
const endAt = (d) => onDay(d, null, 20, 0);
const stamp = (at) => ({ ts: isoWithTz(at), date: localDate(at), time: localTime(at) });
// An end is always after its start (at least a minute).
const afterStart = (start, at) => new Date(Math.max(at.getTime(), Date.parse(start.ts) + 60000));
const minutes = (start, at) => Math.max(0, Math.round((at.getTime() - Date.parse(start.ts)) / 60000));

function endRecord(ev, start, at) {
  const when = afterStart(start, at);
  return makeRecord({
    kind: 'event_end', item_id: ev.id, item_name: ev.name, session_id: start.id, duration_min: minutes(start, when),
  }, when);
}

async function periodChange(ctx, act, d, m, cs, ev) {
  const { state } = ctx;
  const today = dayNum(localDate());
  const periods = m ? m.periods : [];
  const plen = m ? m.stats.plen : cs.periodLength;
  const ops = { add: [], update: [] };
  const remove = [];
  let msg;
  if (act === 'new') {
    const at = onDay(d, null, 8, 0);
    const start = makeRecord({ kind: 'event_start', item_id: ev.id, item_name: ev.name, nth_today: nthOn(state, ev.id, at) }, at);
    ops.add.push(start);
    // Over already: its end too, at the usual length (easy to change).
    const next = periods.find((x) => x.start > d);
    const endDay = Math.min(d + plen - 1, next ? next.start - 1 : Infinity);
    if (endDay < today) ops.add.push(endRecord(ev, start, endAt(endDay)));
    // An earlier period never ended in the app ended before this one.
    const open = periods.filter((x) => x.start < d && x.end == null && !(x === m.last && m.running));
    for (const x of open) ops.add.push(endRecord(ev, x.startRec, endAt(Math.min(x.start + plen - 1, d - 1))));
    msg = t('Period start saved: {date}', { date: dayText(d) });
  } else if (act === 'move-start' || act === 'move-next') {
    const p = act === 'move-start' ? coveringPeriod(m, d, today) : periods.find((x) => x.start > d);
    if (!p) return;
    const at = onDay(d, p.startRec, 8, 0);
    ops.update.push({ id: p.startRec.id, patch: { ...stamp(at), nth_today: nthOn(state, ev.id, at, p.startRec.id) } });
    if (p.endRec) ops.update.push({ id: p.endRec.id, patch: { duration_min: Math.max(0, Math.round((Date.parse(p.endRec.ts) - at.getTime()) / 60000)) } });
    msg = t('Period start saved: {date}', { date: dayText(d) });
  } else if (act === 'set-end' || act === 'extend-end') {
    const p = act === 'set-end' ? coveringPeriod(m, d, today) : [...periods].reverse().find((x) => x.start < d);
    if (!p) return;
    const at = afterStart(p.startRec, onDay(d, p.endRec, 20, 0));
    if (p.endRec) ops.update.push({ id: p.endRec.id, patch: { ...stamp(at), duration_min: minutes(p.startRec, at) } });
    else ops.add.push(endRecord(ev, p.startRec, at));
    msg = t('Period end saved: {date}', { date: dayText(d) });
  } else if (act === 'remove') {
    const p = coveringPeriod(m, d, today);
    if (!p) return;
    remove.push(p.startRec);
    if (p.endRec) remove.push(p.endRec);
    msg = t('Period removed');
  } else return;
  ops.remove = remove;
  await commit(ctx, ops, msg);
}

// Applies the changes, then offers Undo (which puts everything back as it
// was). ops: { add: [records], update: [{ id, patch }], remove: [records] }.
async function commit(ctx, ops, msg) {
  const { state } = ctx;
  const done = { added: [], before: [] };
  let failed = false;
  try {
    for (const rec of ops.add || []) {
      await storage.appendEntry(rec);
      done.added.push(rec);
    }
    for (const { id, patch } of ops.update || []) {
      const old = state.entries.find((x) => x.id === id);
      if (!(await storage.updateEntry(id, patch))) throw new Error('entry not found');
      if (old) done.before.push(old);
    }
    for (const rec of ops.remove || []) {
      await storage.deleteEntry(rec.id);
      done.before.push(rec);
    }
  } catch (e) {
    failed = true;
    ctx.toast(t('NOT saved: {msg}', { msg: e.message }), { error: true });
  }
  // The log as it now really is (also after a failure halfway).
  state.entries = await storage.listEntries();
  ctx.closeSheet();
  ctx.refresh();
  if (failed || !msg) return;
  ctx.toast(msg, {
    actionLabel: t('Undo'),
    onAction: async () => {
      try {
        for (const rec of done.added) await storage.deleteEntry(rec.id);
        for (const rec of done.before) await storage.restoreEntry(rec);
      } catch (e) {
        ctx.toast(t('Undo failed: {msg}', { msg: e.message }), { error: true });
      }
      state.entries = await storage.listEntries();
      ctx.refresh();
      ctx.toast(t('Undone'));
    },
  });
}

// --- no period button yet ------------------------------------------------------------

// The starting setup names its period and diary buttons (default config
// "cycle"): offer those, or any start/finish button the user has.
async function renderSetup(el, ctx, rem) {
  const { config } = ctx.state;
  let def = null;
  try {
    const res = parseConfigText(await fetchDefaultFor(getLang()));
    if (res.ok) def = res.config;
  } catch { /* offline */ }
  const ids = def?.cycle || {};
  const spans = config.events.filter((e) => e.span);
  const suggested = spans.find((e) => e.id === ids.period) || (spans.length === 1 ? spans[0] : null);
  const diary = config.events.find((e) => e.id === ids.diary && !e.span) || null;
  let body;
  if (suggested) {
    body = `<p>${esc(t('Use your "{name}" button for the Cycle tab?', { name: eventLabel(suggested) }))}</p>
      <button class="btn primary" data-use="${esc(suggested.id)}">${esc(t('Yes, use it'))}</button>`;
  } else if (spans.length) {
    body = `<p>${esc(t('Which button marks your period?'))}</p>
      <div class="cy-pick">${spans.map((e) => `<button class="btn" data-use="${esc(e.id)}">${esc(eventLabel(e))}</button>`).join('')}</div>`;
  } else {
    body = `<p>${esc(t('CYCLE_ADD_HINT'))}</p>
      <button class="btn primary" data-add ${def && ids.period ? '' : 'disabled'}>${icon('plus')}<span>${esc(t('Add the Period buttons'))}</span></button>`;
  }
  el.innerHTML = `${rem}<div class="empty-card">
    <span class="empty-ico">${icon('drop')}</span>
    <b>${esc(t('Your cycle'))}</b>
    <p>${esc(t('CYCLE_INTRO'))}</p>
    ${body}
  </div>
  <p class="small muted cy-disclaimer">${esc(t('CYCLE_DISCLAIMER'))}</p>`;
  wireReminders(el, ctx);
  const save = async (mutate) => {
    const cfg = JSON.parse(JSON.stringify(config));
    mutate(cfg);
    const res = await saveConfig(cfg);
    if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return; }
    await ctx.reloadConfig();
  };
  el.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => save((cfg) => {
    cfg.cycle = { ...(cfg.cycle || {}), period: b.dataset.use };
    if (diary && !cfg.cycle.diary) cfg.cycle.diary = diary.id;
  })));
  el.querySelector('[data-add]')?.addEventListener('click', () => save((cfg) => {
    // The ready-made Period (start/finish) and Period diary buttons.
    for (const id of [ids.period, ids.diary]) {
      const it = def.events.find((e) => e.id === id);
      if (it && !cfg.events.some((e) => e.id === id)) cfg.events.push(JSON.parse(JSON.stringify(it)));
    }
    cfg.cycle = { ...(cfg.cycle || {}), period: ids.period, ...(ids.diary ? { diary: ids.diary } : {}) };
  }));
}
