// Events screen: big buttons, one tap = logged.

import * as storage from './storage.js';
import { ASK_FIELDS, eventLabel, saveConfig } from './config.js';
import { deleteWithUndo, details, openDetails, screenLabel } from './log.js';
import { makeRecord } from './record.js';
import { dismissReminder, remindersHtml } from './reminders.js';
import { startRoutine } from './training.js';
import { openAddButtonSheet } from './eventEditor.js';
import { ownedIds } from './tabs.js';
import { listsHtml, wireLists } from './lists.js';
import { icon } from './icons.js';
import {
  esc, fmtDuration, friendlyDay, hhmm, isoWithTz, localDate, localTime,
} from './util.js';
import { dateLocale, t } from './i18n.js';

// Taps on the same button closer together than this are treated as an
// accidental double tap. WHY 3 s: long enough to catch a shaky double
// press or a re-opened shortcut, short enough that a real second event
// is never swallowed (two real headaches are never 3 s apart).
const DOUBLE_TAP_MS = 3000;

// Time of the last tap per item, kept in memory. WHY in addition to
// checking the log: the write to storage takes a moment, and a second tap
// during that moment wouldn't see the first entry yet.
const lastTap = new Map();

const DURATION_CHIPS = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120];

// "How do you feel?" — the record stores the number (1 = awful … 5 =
// great) so it can be charted; the screen shows the face. Labels are
// translation keys.
export const MOODS = [[1, '😫', 'Awful'], [2, '😟', 'Bad'], [3, '😐', 'OK'], [4, '🙂', 'Good'], [5, '😄', 'Great']];
export const moodFace = (n) => MOODS.find(([v]) => v === n)?.[1] || '';

// A blood-pressure series is several log entries (one per reading) that
// share a session_id. It is ONE occurrence: one measuring session.
function occurrences(entries) {
  return new Set(entries.map((e) => e.session_id || e.id)).size;
}

// What counts as "one time" on a button today: a normal event, or the
// start of a start/finish button.
const COUNTED = new Set(['event', 'event_start']);

function todayEvents(state) {
  const today = localDate();
  return state.entries.filter((e) => COUNTED.has(e.kind) && e.date === today);
}

// The running (started, not finished) entry of a start/finish button.
// Worked out from the log itself, so nothing extra has to be saved and a
// crash can't leave it in a wrong state.
export function openSpan(state, evId) {
  const ended = new Set(state.entries.filter((e) => e.kind === 'event_end').map((e) => e.session_id));
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const e = state.entries[i];
    if (e.kind === 'event_start' && e.item_id === evId && !ended.has(e.id)) return e;
  }
  return null;
}

export function renderEvents(el, ctx) {
  const { state } = ctx;
  // The Cycle tab's own buttons live in that tab (tabs.js ownedIds).
  const owned = ownedIds(state.config);
  const events = state.config.events.filter((e) => !e.hidden && !owned.has(e.id));
  const today = todayEvents(state);
  // No buttons (e.g. none picked on the welcome screen): say what buttons
  // are and offer to add one, instead of an empty screen.
  const empty = `<div class="empty-card">
    <span class="empty-ico">${icon('grid')}</span>
    <b>${esc(t('No buttons yet'))}</b>
    <p>${esc(t('EMPTY_EVENTS'))}</p>
    <button class="btn primary" data-act="add">${icon('plus')}<span>${esc(t('Add a button'))}</span></button>
  </div>`;
  el.innerHTML = `${remindersHtml(state, (type, it) => type !== 'event' || !owned.has(it.id))}${events.length ? `<div class="ev-grid">${events.map((ev) => {
    const mine = today.filter((e) => e.item_id === ev.id);
    const last = mine[mine.length - 1];
    // "How many" answers count as that many (2 pills logged once = 2).
    const total = mine.reduce((n, e) => n + (e.count || 1), 0) - (mine.length - occurrences(mine));
    // Colour comes from the config and is validated as #rrggbb there, so
    // it's safe to put into the style attribute.
    const cls = `ev${ev.color ? ' has-color' : ''}`;
    const style = ev.color ? ` style="--c:${ev.color}"` : '';
    const run = ev.span ? openSpan(state, ev.id) : null;
    let sub = last ? esc(t('last {time}', { time: hhmm(last.time) })) + (last.mood ? ` ${moodFace(last.mood)}` : '') : '&nbsp;';
    if (run) sub = `▶ ${esc(t('running {d}', { d: fmtDuration((Date.now() - Date.parse(run.ts)) / 60000) }))}`;
    else if (ev.span) sub = esc(t('tap to start'));
    // The count shows from the first time today; a row of zeros was just
    // noise. A button with a daily goal (e.g. 8 glasses of water) always
    // shows how far along it is: "3/8" and a bar.
    const goal = ev.goal;
    const count = goal ? `<span class="ev-count goal${total >= goal ? ' done' : ''}">${total}/${goal}</span>`
      : total ? `<span class="ev-count">${total}</span>` : '';
    return `<button class="${cls}${run ? ' running' : ''}"${style} data-id="${esc(ev.id)}">
      ${count}
      <span class="ev-name">${esc(eventLabel(ev))}</span>
      <span class="ev-last">${sub}</span>
      ${goal ? `<span class="ev-goal" aria-hidden="true"><i style="width:${Math.min(100, Math.round((total / goal) * 100))}%"></i></span>` : ''}
    </button>`;
  }).join('')}
    <button class="ev ev-add" data-act="add">${icon('plus')}<span>${esc(t('Add a button'))}</span></button>
  </div>` : empty}`;
  el.querySelector('[data-act="add"]').addEventListener('click', () => openAddButtonSheet(ctx));
  wireReminders(el, ctx);

  el.insertAdjacentHTML('beforeend', recentHtml(state, owned));
  el.querySelectorAll('.recent-row').forEach((row) => {
    const entry = () => state.entries.find((x) => x.id === row.dataset.id);
    row.querySelector('.recent-main').addEventListener('click', () => { const e = entry(); if (e) openDetails(ctx, e); });
    row.querySelector('.recent-x').addEventListener('click', () => {
      const e = entry();
      if (e) { lastTap.delete(e.item_id); deleteWithUndo(ctx, e); }
    });
  });

  el.querySelectorAll('.ev[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ev = state.config.events.find((e) => e.id === btn.dataset.id);
      if (!ev) return;
      const run = ev.span ? openSpan(state, ev.id) : null;
      if (run) openFinishSheet(ctx, ev, run);
      else logEvent(ctx, ev);
    });
  });
}

// Reminder cards (reminders.js remindersHtml): "Log now" is the same as
// tapping the button; a routine starts right away; ✕ = not now (until the
// reminder's next time). Also used by the Cycle tab when Events is hidden.
export function wireReminders(el, ctx) {
  const { state } = ctx;
  el.querySelectorAll('.reminder').forEach((card) => {
    const { type, id } = card.dataset;
    card.querySelector('[data-rem-go]').addEventListener('click', () => {
      if (type === 'routine') { startRoutine(ctx, id); return; }
      const ev = state.config.events.find((e) => e.id === id);
      if (!ev) return;
      const run = ev.span ? openSpan(state, ev.id) : null;
      if (run) openFinishSheet(ctx, ev, run);
      else logEvent(ctx, ev);
    });
    card.querySelector('[data-rem-x]').addEventListener('click', async () => {
      await dismissReminder(state, card.dataset.key);
      ctx.refresh();
    });
  });
}

// The last few events, so a wrong tap can be cancelled (✕) or fixed (tap
// the row) right here, without going to the Log. Not the Cycle tab's own
// buttons (owned): those are seen in that tab.
const RECENT = 5;

function recentHtml(state, owned) {
  const recent = state.entries.filter((e) => (e.kind === 'event' || e.kind === 'event_start' || e.kind === 'event_end')
    && !owned.has(e.item_id)).slice(-RECENT).reverse();
  if (!recent.length) return '';
  const today = localDate();
  const rows = recent.map((e) => {
    const sub = details(e, state);
    const when = e.date === today ? hhmm(e.time) : `${friendlyDay(e.date)} ${hhmm(e.time)}`;
    return `<div class="recent-row" data-id="${esc(e.id)}">
      <button class="recent-main"><span class="row-time">${esc(when)}</span>
        <span class="recent-name">${esc(screenLabel(state, e))}</span>
        <span class="recent-sub">${esc(sub)}</span></button>
      <button class="recent-x" aria-label="${esc(t('Delete this entry'))}">${icon('close')}</button>
    </div>`;
  }).join('');
  return `<h2 class="day">${t('Recent')}<a class="small" href="#log">${t('all →')}</a></h2><div class="card">${rows}</div>`;
}

// Logs one event. Also used by the home-screen shortcut (?log=<id>).
// opts.date ("YYYY-MM-DD"): log it on an earlier day, at this time of day
// (the Cycle tab's calendar: "Add to the diary" on a day that's past).
export async function logEvent(ctx, ev, opts = {}) {
  const { state } = ctx;
  const label = eventLabel(ev);
  const nowMs = Date.now();
  let at = new Date(nowMs);
  const past = !!opts.date && opts.date < localDate();
  if (past) {
    const [Y, M, D] = opts.date.split('-').map(Number);
    at = new Date(Y, M - 1, D, at.getHours(), at.getMinutes(), at.getSeconds());
  } else {
    const lastEntry = [...state.entries].reverse()
      .find((e) => COUNTED.has(e.kind) && e.item_id === ev.id);
    const lastMs = Math.max(lastTap.get(ev.id) || 0, lastEntry ? Date.parse(lastEntry.ts) : 0);
    if (nowMs - lastMs < DOUBLE_TAP_MS) {
      const secs = Math.max(1, Math.round((nowMs - lastMs) / 1000));
      ctx.toast(t('Double tap ignored — {label} was logged {secs}s ago', { label, secs }));
      return;
    }
    lastTap.set(ev.id, nowMs);
  }

  // Its number within its day (on an earlier day: among the entries before it).
  const day = localDate(at);
  const nth = occurrences(state.entries.filter((e) => COUNTED.has(e.kind) && e.item_id === ev.id
    && e.date === day && Date.parse(e.ts) < at.getTime())) + 1;
  const rec = makeRecord({
    kind: ev.span ? 'event_start' : 'event',
    item_id: ev.id,
    item_name: ev.name, // real name: goes to the log/exports, never on screen
    nth_today: nth,
  }, at);

  try {
    await storage.appendEntry(rec);
  } catch (e) {
    lastTap.delete(ev.id);
    ctx.toast(t('NOT saved: {msg}', { msg: e.message }), { error: true });
    return;
  }
  state.entries.push(rec);
  if (past) state.entries.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (navigator.vibrate) navigator.vibrate(30);
  ctx.refresh();

  if (ev.ask && ev.ask.includes('bp')) {
    openBpSheet(ctx, ev, rec);
  } else if (ev.ask && ev.ask.length) {
    openAskSheet(ctx, ev, rec);
  } else {
    ctx.toast(past ? t('{label} saved · {day}', { label, day: friendlyDay(rec.date) })
      : t(ev.span ? '{label} started {time}' : '{label} #{n} logged {time}', { label, n: nth, time: hhmm(rec.time) }), {
      actionLabel: t('Undo'),
      onAction: () => undo(ctx, rec),
    });
  }
}

async function undo(ctx, rec) {
  try {
    await storage.deleteEntry(rec.id);
  } catch (e) {
    ctx.toast(t('Undo failed: {msg}', { msg: e.message }), { error: true });
    return;
  }
  ctx.state.entries = ctx.state.entries.filter((e) => e.id !== rec.id);
  lastTap.delete(rec.item_id);
  ctx.closeSheet();
  ctx.refresh();
  ctx.toast(t('Undone'));
}

function chips(field, values, opts = {}) {
  return `<div class="chips${opts.wide ? ' wide' : ''}" data-field="${field}">${values.map((v) =>
    `<button class="chip" data-v="${esc(v)}">${esc(v)}${opts.suffix ? `<small>${esc(opts.suffix)}</small>` : ''}</button>`).join('')}${
    opts.other ? `<button class="chip other" data-other="1">${t('Other…')}</button>` : ''}</div>`;
}

// One sheet section per "ask" field, in the order the config lists them.
function askSection(ev, field) {
  switch (field) {
    case 'mood':
      return [t('How do you feel?'), `<div class="chips mood" data-field="mood">${MOODS.map(([v, face, label]) =>
        `<button class="chip" data-v="${v}" aria-label="${esc(t(label))}"><span class="face">${face}</span><small>${esc(t(label))}</small></button>`).join('')}</div>`];
    case 'intensity':
      return [t('Intensity'), chips('intensity', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])];
    case 'duration_min':
      return [t('Duration (minutes)'), chips('duration_min', DURATION_CHIPS, { other: true })];
    case 'choice':
      return [t('Type'), chips('choice', ev.choices || [], { wide: true, other: true })];
    case 'lists':
      return [null, listsHtml(ev.lists || [])];
    case 'amount':
      return [t('Amount ({unit})', { unit: ev.amount.unit }), chips('amount', ev.amount.values, { other: true })];
    case 'count':
      return [t('How many'), chips('count', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])];
    case 'measures':
      return [null, measuresHtml(ev.measures || [])];
    case 'note':
      return [t('Note'), `<input class="input" data-field="note" placeholder="${esc(t('optional'))}">`];
    default:
      return null;
  }
}

const NUMERIC = new Set(['mood', 'intensity', 'duration_min', 'amount', 'count']);

// The button's own number fields (e.g. Weight kg). Shared by the normal
// sheet and the blood-pressure sheet.
export function measuresHtml(measures, current = {}, hints = {}) {
  return `<div class="mfields">${measures.map((m) => `<label>${esc(m.name)}${m.unit ? ` (${esc(m.unit)})` : ''}
    <input class="input" data-m="${esc(m.id)}" inputmode="decimal" value="${esc(current[m.id] ?? '')}" placeholder="${esc(hints[m.id] ?? '')}"></label>`).join('')}</div>`;
}

// Reads the number fields. Returns { measures } (null when all empty) or
// { error } naming the field that isn't a number.
export function readMeasures(root, measures) {
  const out = {};
  for (const m of measures) {
    const inp = root.querySelector(`[data-m="${CSS.escape(m.id)}"]`);
    const raw = inp ? inp.value.trim().replace(',', '.') : '';
    if (!raw) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) return { error: t('{label}: please type a number', { label: m.name }) };
    out[m.id] = v;
  }
  return { measures: Object.keys(out).length ? out : null };
}

// The last 7 days, for the day strip of a diary-like sheet.
function dayStripHtml(selected) {
  const fWd = new Intl.DateTimeFormat(dateLocale(), { weekday: 'short' });
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return `<div class="daystrip" role="group" aria-label="${esc(t('Which day?'))}">${days.map((d) => {
    const iso = localDate(d);
    return `<button class="day-pick${iso === selected ? ' on' : ''}" data-day="${iso}" aria-pressed="${iso === selected}">
      <small>${esc(fWd.format(d))}</small><b>${d.getDate()}</b></button>`;
  }).join('')}</div>`;
}

// Optional details after logging. The entry is ALREADY saved; this sheet
// only adds details, so closing/skipping it never loses the event.
// A button with pick-lists gets a diary-like sheet (as asked for: "like the
// My Calendar app"): ✕ and ✓ at the top, a strip of the last 7 days (the
// entry can be put on an earlier day), then a card per list.
function openAskSheet(ctx, ev, rec) {
  const label = eventLabel(ev);
  const ask = ev.ask.filter((f) => ASK_FIELDS.includes(f));
  const lists = ask.includes('lists') ? (ev.lists || []) : [];
  const diary = lists.length > 0;
  // A single tap-to-pick question saves on the first tap: fastest path.
  const instant = ask.length === 1 && !['note', 'measures'].includes(ask[0])
    && (ask[0] !== 'lists' || (lists.length === 1 && !lists[0].multi));
  const values = {};
  let day = rec.date;

  const sections = ask.map((f) => askSection(ev, f)).filter(Boolean);
  const body = sections.map(([title, html]) => `<div class="field">${title ? `<div class="label">${esc(title)}</div>` : ''}${html}</div>`).join('');
  const root = ctx.openSheet(diary ? `
    <div class="diary-head">
      <button class="ibtn ghost" data-act="skip" aria-label="${esc(t('Close'))}">${icon('close')}</button>
      <div class="diary-title"><b>${esc(label)}</b>
        <span class="muted small">${esc(t('logged {time}', { time: rec.date === localDate() ? hhmm(rec.time) : `${friendlyDay(rec.date)} ${hhmm(rec.time)}` }))} · <button class="text-btn" data-act="undo">${t('Undo')}</button></span></div>
      ${instant ? '<span class="diary-gap"></span>' : `<button class="ibtn save-check" data-act="save" aria-label="${esc(t('Save'))}">${icon('check')}</button>`}
    </div>
    ${dayStripHtml(day)}
    ${body}
    <div class="sheet-actions">
      <button class="btn" data-act="skip">${t('Skip')}</button>
      ${instant ? '' : `<button class="btn primary" data-act="save">${t('Save')}</button>`}
    </div>` : `
    <div class="sheet-head">
      <div><b>${esc(label)} #${rec.nth_today}</b><br><span class="muted">${esc(t('logged {time}', { time: hhmm(rec.time) }))}</span></div>
      <button class="btn" data-act="undo">${t('Undo')}</button>
    </div>
    ${body}
    <div class="sheet-actions">
      <button class="btn" data-act="skip">${t('Skip')}</button>
      ${instant ? '' : `<button class="btn primary" data-act="save">${t('Save')}</button>`}
    </div>`);

  let readLists = () => null;
  const save = async () => {
    if (ask.includes('measures')) {
      const r = readMeasures(root, ev.measures || []);
      if (r.error) { ctx.toast(r.error); return; }
      if (r.measures) values.measures = r.measures;
    }
    const answers = readLists();
    if (answers) values.answers = answers;
    const note = root.querySelector('[data-field="note"]');
    if (note && note.value.trim()) values.note = note.value.trim();
    if (values.amount != null) values.unit = ev.amount.unit;
    if (day !== rec.date) {
      // Put on an earlier day, at the same time of day; its number is
      // counted within THAT day (as when moving it in the Log).
      const [Y, M, D] = day.split('-').map(Number);
      const [h, m, sec] = rec.time.split(':').map(Number);
      const d = new Date(Y, M - 1, D, h, m, sec);
      values.ts = isoWithTz(d);
      values.date = localDate(d);
      values.time = localTime(d);
      const before = ctx.state.entries.filter((x) => x.id !== rec.id && x.item_id === rec.item_id
        && x.date === values.date && COUNTED.has(x.kind) && Date.parse(x.ts) < d.getTime());
      values.nth_today = occurrences(before) + 1;
    }
    ctx.closeSheet();
    if (!Object.keys(values).length) return;
    try {
      const updated = await storage.updateEntry(rec.id, values);
      if (updated) {
        const i = ctx.state.entries.findIndex((e) => e.id === rec.id);
        if (i >= 0) ctx.state.entries[i] = updated;
        ctx.state.entries.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      }
      const n = updated?.nth_today ?? rec.nth_today;
      ctx.toast(day !== rec.date
        ? t('{label} saved · {day}', { label, day: friendlyDay(day) })
        : t('{label} #{n} saved', { label, n }));
      ctx.refresh();
    } catch (e) {
      ctx.toast(t('Details NOT saved: {msg}', { msg: e.message }), { error: true });
    }
  };

  const pick = (group, chip, field, v) => {
    group.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
    if (values[field] === v) { delete values[field]; return; }
    values[field] = v;
    chip.classList.add('on');
    if (instant) save();
  };

  root.querySelectorAll('.chips').forEach((group) => {
    group.addEventListener('click', async (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const field = group.dataset.field;
      if (chip.dataset.other) {
        const typed = prompt(field === 'choice' ? t('Type name:') : t('Number:'));
        if (typed === null || !typed.trim()) return;
        let v = typed.trim();
        if (NUMERIC.has(field)) {
          v = Number(v.replace(',', '.'));
          if (!(v > 0)) { ctx.toast(t('Please type a number')); return; }
        } else {
          rememberChoice(ctx, ev, v);
        }
        pick(group, chip, field, v);
        return;
      }
      const raw = chip.dataset.v;
      pick(group, chip, field, NUMERIC.has(field) ? Number(raw) : raw);
    });
  });
  if (lists.length) {
    readLists = wireLists(root, lists, {}, () => { if (instant && readLists()) save(); });
  }
  root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    day = b.dataset.day;
    root.querySelectorAll('[data-day]').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b);
    });
  }));
  root.querySelector('[data-act="undo"]').addEventListener('click', () => undo(ctx, rec));
  root.querySelectorAll('[data-act="skip"]').forEach((b) => b.addEventListener('click', () => ctx.closeSheet()));
  root.querySelectorAll('[data-act="save"]').forEach((b) => b.addEventListener('click', save));
}

// A new type typed via "Other…" is added to the button's list, so next
// time it's one tap. Runs in the background; failing only means it isn't
// remembered — the log entry itself is unaffected.
async function rememberChoice(ctx, ev, name) {
  const cfg = JSON.parse(JSON.stringify(ctx.state.config));
  const target = cfg.events.find((x) => x.id === ev.id);
  if (!target || (target.choices || []).some((c) => c.toLowerCase() === name.toLowerCase())) return;
  target.choices = [...(target.choices || []), name];
  if (ctx.state.configErrors.length) return; // don't overwrite a config being fixed
  const res = await saveConfig(cfg);
  if (res.ok) await ctx.reloadConfig();
}

// --- blood pressure series ------------------------------------------------
// Readings taken a few minutes apart settle as you relax, so one tap starts
// a SERIES: every reading is its own log entry with its own time (to see
// the curve), all sharing session_id, numbered with set_no 1, 2, 3...
// The first reading fills the entry the tap already created; later ones are
// created only when saved, so an abandoned "another reading" leaves nothing
// empty behind.

const BP_LIMITS = { bp_sys: [50, 260], bp_dia: [30, 180], pulse: [25, 250] };

function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A BP series is identified by the session_id its readings share (the
// first reading's id).
export function seriesKey(e) {
  return e.session_id || e.id;
}

// The series to continue when measuring again soon after, e.g. because the
// sheet was closed by accident: the readings (oldest first) of the latest
// series whose last reading is less than CONTINUE_MIN minutes old.
const CONTINUE_MIN = 30;
function recentSeries(state, evId, excludeId) {
  const readings = state.entries.filter((e) => e.kind === 'event' && e.item_id === evId
    && e.id !== excludeId && e.bp_sys != null);
  const last = readings[readings.length - 1];
  if (!last || Date.now() - Date.parse(last.ts) > CONTINUE_MIN * 60000) return null;
  return readings.filter((e) => seriesKey(e) === seriesKey(last));
}

function openBpSheet(ctx, ev, first) {
  const label = eventLabel(ev);
  const askNote = ev.ask.includes('note');
  // Custom numbers (e.g. weight) are asked once per series, with reading 1.
  const askMeasures = ev.ask.includes('measures') && (ev.measures || []).length;
  const prev = recentSeries(ctx.state, ev.id, first.id);
  // Measuring again within half an hour is almost always the same session,
  // so continuing is the default (one tap to untick).
  let join = !!prev;
  const saved = []; // readings saved in THIS sheet, in order
  let timer = null;
  const readings = () => (join ? [...prev, ...saved] : saved);
  const head = () => (join ? prev[0] : first);

  const render = () => {
    const all = readings();
    const n = all.length + 1;
    const t0 = Date.parse((all[0] || first).ts);
    const seriesHasMeasures = join && prev.some((r) => r.measures);
    const showMeasures = askMeasures && !saved.length && !seriesHasMeasures;
    const root = ctx.openSheet(`
      <div class="sheet-head">
        <div><b>${esc(label)} #${head().nth_today}</b><br><span class="muted">${t('reading {n}', { n })}</span></div>
        <button class="btn" data-act="undo">${saved.length > 1 ? t('Undo all') : t('Undo')}</button>
      </div>
      ${prev && !saved.length ? `<label class="check join"><input type="checkbox" data-join ${join ? 'checked' : ''}>
        ${esc(t('Continue the series from {time} ({n} readings)', { time: hhmm(prev[0].time), n: prev.length }))}</label>` : ''}
      ${all.length ? `<table class="kv bp-list">${all.map((r) => `<tr>
        <th>${r.set_no}. ${hhmm(r.time)} <span class="muted">+${mmss(Date.parse(r.ts) - t0)}</span></th>
        <td><b>${r.bp_sys}/${r.bp_dia}</b>${r.pulse != null ? ` · ♥ ${r.pulse}` : ''}</td></tr>`).join('')}</table>
        <p class="rest">${t('Resting:')} <b data-timer>0:00</b> ${t('since last reading')}</p>` : ''}
      <div class="bp-row">
        <label>${t('Upper')}<input class="input bp" data-bp="bp_sys" inputmode="numeric" placeholder="120"></label>
        <span class="bp-slash">/</span>
        <label>${t('Lower')}<input class="input bp" data-bp="bp_dia" inputmode="numeric" placeholder="80"></label>
        <label>${t('Pulse')}<input class="input bp" data-bp="pulse" inputmode="numeric" placeholder="70"></label>
      </div>
      ${showMeasures ? measuresHtml(ev.measures || []) : ''}
      ${askNote ? `<input class="input" data-field="note" placeholder="${esc(t('Note (optional)'))}">` : ''}
      <div class="sheet-actions">
        <button class="btn" data-act="done">${saved.length ? t('Done') : t('Skip')}</button>
        <button class="btn primary" data-act="save">${t('Save reading {n}', { n })}</button>
      </div>`);

    clearInterval(timer);
    const tEl = root.querySelector('[data-timer]');
    if (tEl) {
      const last = Date.parse(all[all.length - 1].ts);
      const tick = () => {
        // The sheet was closed (or replaced): stop ticking.
        if (document.getElementById('sheet').hidden || !tEl.isConnected) { clearInterval(timer); return; }
        tEl.textContent = mmss(Date.now() - last);
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    const joinBox = root.querySelector('[data-join]');
    if (joinBox) joinBox.addEventListener('change', () => { join = joinBox.checked; render(); });

    const inputs = [...root.querySelectorAll('[data-bp]')];
    // Jump to the next box once a value is complete, so typing
    // "135 88 72" needs no extra taps.
    inputs.forEach((inp, i) => inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 3);
      const v = Number(inp.value);
      const full = inp.value.length === 3 || (inp.value.length === 2 && v >= 30 && inp.dataset.bp !== 'bp_sys');
      // After the pulse, continue into the first custom number (weight…).
      const next = inputs[i + 1] || root.querySelector('[data-m]');
      if (full && next) next.focus();
    }));
    if (!saved.length) setTimeout(() => inputs[0].focus(), 50);

    // Undo removes only what this sheet created; continued readings from
    // before stay untouched.
    root.querySelector('[data-act="undo"]').addEventListener('click', async () => {
      clearInterval(timer);
      const mine = [first, ...saved.slice(1)];
      try {
        for (const r of mine) await storage.deleteEntry(r.id);
      } catch (e) {
        ctx.toast(t('Undo failed: {msg}', { msg: e.message }), { error: true });
        return;
      }
      const ids = new Set(mine.map((r) => r.id));
      ctx.state.entries = ctx.state.entries.filter((e) => !ids.has(e.id));
      lastTap.delete(ev.id);
      ctx.closeSheet();
      ctx.refresh();
      ctx.toast(t('Undone'));
    });
    root.querySelector('[data-act="done"]').addEventListener('click', () => {
      clearInterval(timer);
      ctx.closeSheet();
      if (saved.length) ctx.toast(t('{label}: readings saved: {n}', { label, n: saved.length }));
    });
    root.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const v = {};
      for (const inp of inputs) v[inp.dataset.bp] = inp.value ? Number(inp.value) : null;
      if (v.bp_sys == null || v.bp_dia == null) { ctx.toast(t('Type the upper and lower number')); return; }
      const odd = Object.entries(v).filter(([k, x]) => x != null && (x < BP_LIMITS[k][0] || x > BP_LIMITS[k][1]));
      if (odd.length && !confirm(t('{values} looks unusual. Save anyway?', { values: odd.map(([, x]) => x).join(', ') }))) return;
      if (v.bp_sys <= v.bp_dia && !confirm(t('Upper is not bigger than lower — swapped? Save anyway?'))) return;
      const noteEl = root.querySelector('[data-field="note"]');
      if (noteEl && noteEl.value.trim()) v.note = noteEl.value.trim();
      if (showMeasures) {
        const r = readMeasures(root, ev.measures);
        if (r.error) { ctx.toast(r.error); return; }
        if (r.measures) v.measures = r.measures;
      }
      v.session_id = seriesKey(head());
      v.set_no = all.length + 1;
      v.nth_today = head().nth_today;
      try {
        let rec;
        if (!saved.length) {
          rec = await storage.updateEntry(first.id, v);
          const i = ctx.state.entries.findIndex((e) => e.id === first.id);
          if (i >= 0 && rec) ctx.state.entries[i] = rec;
        } else {
          rec = makeRecord({ kind: 'event', item_id: ev.id, item_name: ev.name, ...v });
          await storage.appendEntry(rec);
          ctx.state.entries.push(rec);
        }
        if (!rec) throw new Error('entry not found');
        saved.push(rec);
      } catch (e) {
        ctx.toast(t('Reading NOT saved: {msg}', { msg: e.message }), { error: true });
        return;
      }
      if (navigator.vibrate) navigator.vibrate(30);
      ctx.refresh();
      render(); // ready for the next reading, with the rest timer running
    });
  };
  render();
}

// --- start / finish buttons ------------------------------------------------
// Finishing takes two taps (button, then "Finish now") on purpose: a
// finish closes something that may have run for days, so an accidental
// brush of the button must not do it.
export function openFinishSheet(ctx, ev, start) {
  const label = eventLabel(ev);
  const mins = () => (Date.now() - Date.parse(start.ts)) / 60000;
  const root = ctx.openSheet(`
    <div class="sheet-head"><div><b>${esc(label)}</b><br>
      <span class="muted">${esc(t('started {when}', { when: `${friendlyDay(start.date)} ${hhmm(start.time)}` }))}</span></div></div>
    <p class="rest">${esc(t('Running for'))} <b>${esc(fmtDuration(mins()))}</b></p>
    <div class="sheet-actions">
      <button class="btn" data-act="cancel">${t('Cancel')}</button>
      <button class="btn primary" data-act="finish">${t('Finish now')}</button>
    </div>`);
  root.querySelector('[data-act="cancel"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelector('[data-act="finish"]').addEventListener('click', async () => {
    const end = makeRecord({
      kind: 'event_end',
      item_id: ev.id,
      item_name: ev.name,
      session_id: start.id,
      duration_min: Math.round(mins()),
    });
    try {
      await storage.appendEntry(end);
    } catch (e) {
      ctx.toast(t('NOT saved: {msg}', { msg: e.message }), { error: true });
      return;
    }
    ctx.state.entries.push(end);
    lastTap.set(ev.id, Date.now()); // a fast re-tap must not start a new one
    if (navigator.vibrate) navigator.vibrate(30);
    ctx.closeSheet();
    ctx.refresh();
    ctx.toast(t('{label} finished after {d}', { label, d: fmtDuration(end.duration_min) }), {
      actionLabel: t('Undo'),
      onAction: () => undo(ctx, end),
    });
  });
}
