// Log screen: newest first, grouped by day.
// Tap an entry to edit it or delete it (with undo).

import * as storage from './storage.js';
import { eventLabel } from './config.js';
import {
  esc, fmtDuration, friendlyDay, hhmm, isoWithTz, localDate, localTime,
} from './util.js';
import { t } from './i18n.js';
import { measuresHtml, readMeasures, seriesKey } from './events.js';

const PAGE = 200;
let shown = PAGE;

// Label shown ON SCREEN. Private items show their displayLabel; the real
// item_name is only used if the item no longer exists in the config.
export function screenLabel(state, e) {
  if (e.kind === 'session_start') return t('▶ {name} — started', { name: e.item_name });
  if (e.kind === 'session_end') return t('■ {name} — finished', { name: e.item_name });
  const lists = [...state.config.events, ...state.config.exercises];
  const item = lists.find((x) => x.id === e.item_id);
  // Start/finish buttons: private labels still apply.
  if (e.kind === 'event_start' || e.kind === 'event_end') {
    const name = item ? eventLabel(item) : e.item_name;
    return t(e.kind === 'event_start' ? '▶ {name} — started' : '■ {name} — finished', { name });
  }
  if (item && e.kind === 'event') return eventLabel(item);
  if (item) return item.name;
  return e.item_name || e.kind;
}

// Blood pressure asks weight (etc.) once per series, on reading 1; every
// reading of the series shows it. Stored once, so editing it in one place
// is enough.
export function seriesMeasures(entries, e) {
  if (e.measures || e.bp_sys == null) return null;
  const key = seriesKey(e);
  return entries.find((x) => x.measures && x.bp_sys != null && seriesKey(x) === key)?.measures || null;
}

// The custom number fields to show/edit for an entry: the button's current
// ones, plus any stored value whose field was removed from the button since.
function measureDefs(state, e, values = e.measures) {
  const item = state?.config.events.find((x) => x.id === e.item_id);
  const defs = [...(item?.measures || [])];
  for (const id of Object.keys(values || {})) {
    if (!defs.some((m) => m.id === id)) defs.push({ id, name: id, unit: '' });
  }
  return defs;
}

function fmtSec(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function details(e, state) {
  const parts = [];
  if (e.nth_today) parts.push(`#${e.nth_today}`);
  if (e.set_no && e.bp_sys != null) parts.push(t('reading {n}', { n: e.set_no }));
  if (e.bp_sys != null) parts.push(`${e.bp_sys}/${e.bp_dia}`);
  if (e.pulse != null) parts.push(`♥ ${e.pulse}`);
  const ms = e.measures || (state ? seriesMeasures(state.entries, e) : null);
  for (const m of measureDefs(state, e, ms)) {
    const v = ms?.[m.id];
    if (v != null) parts.push(`${m.name} ${v}${m.unit ? ' ' + m.unit : ''}`);
  }
  if (e.choice) parts.push(e.choice);
  if (e.amount != null) parts.push(`${e.amount} ${e.unit || ''}`.trim());
  if (e.count != null && e.count !== 1) parts.push(`×${e.count}`);
  if (e.kind === 'set' && e.set_no) parts.push(t('set {n}', { n: e.set_no }));
  if (e.kind === 'session_end' && e.duration_min != null) parts.push(t('{n} min', { n: e.duration_min }));
  if (e.kind === 'event_end' && e.duration_min != null) parts.push(t('lasted {d}', { d: fmtDuration(e.duration_min) }));
  if (e.reps != null) parts.push(t('{n} reps', { n: e.reps }));
  if (e.seconds != null) parts.push(`${e.seconds}s`);
  if (e.weight != null) parts.push(`+${e.weight}kg`);
  if (e.work_sec != null && e.reps != null) parts.push(t('set time {t}', { t: fmtSec(e.work_sec) }));
  if (e.rest_sec != null) parts.push(t('rest {t}', { t: fmtSec(e.rest_sec) }));
  if (e.intensity != null) parts.push(t('intensity {n}', { n: e.intensity }));
  if (e.kind !== 'session_end' && e.kind !== 'event_end' && e.duration_min != null) parts.push(t('{n} min', { n: e.duration_min }));
  return parts.join(' · ');
}

export function renderLog(el, ctx) {
  const { state } = ctx;
  const all = [...state.entries].reverse();
  if (!all.length) {
    el.innerHTML = `<div class="empty">${esc(t('Nothing logged yet. Tap a button on the Events screen.'))}</div>`;
    return;
  }
  const list = all.slice(0, shown);
  let html = '';
  let day = null;
  for (const e of list) {
    if (e.date !== day) {
      if (day !== null) html += '</div>';
      day = e.date;
      const n = all.filter((x) => x.date === day && (x.kind === 'event' || x.kind === 'event_start')).length;
      html += `<h2 class="day">${esc(friendlyDay(day))}<span class="muted">${n ? esc(t('{n} events', { n })) : ''}</span></h2><div class="card">`;
    }
    html += `<button class="row" data-id="${esc(e.id)}">
      <span class="row-time">${esc(hhmm(e.time))}</span>
      <span class="row-main"><span class="row-name">${esc(screenLabel(state, e))}</span>
        <span class="row-sub">${esc(details(e, state))}${e.note ? ' · ' + esc(e.note) : ''}</span></span>
    </button>`;
  }
  html += '</div>';
  if (all.length > shown) html += `<button class="btn wide" data-act="more">${esc(t('Show older ({n} more)', { n: all.length - shown }))}</button>`;
  el.innerHTML = html;

  el.querySelectorAll('.row').forEach((row) => row.addEventListener('click', () => {
    const e = state.entries.find((x) => x.id === row.dataset.id);
    if (e) openDetails(ctx, e);
  }));
  const more = el.querySelector('[data-act="more"]');
  if (more) more.addEventListener('click', () => { shown += PAGE; renderLog(el, ctx); });
}

// Fields that can be edited, in display order. "ask" = the event setting
// that makes the field relevant even while it's still empty.
const EDIT_FIELDS = [
  ['bp_sys', 'Blood pressure — upper', 'num', 'bp'],
  ['bp_dia', 'Blood pressure — lower', 'num', 'bp'],
  ['pulse', 'Pulse', 'num', 'bp'],
  ['choice', 'Type', 'text', 'choice'],
  ['amount', 'Amount', 'num', 'amount'],
  ['count', 'How many', 'num', 'count'],
  ['intensity', 'Intensity (1–10)', 'num', 'intensity'],
  ['duration_min', 'Duration (minutes)', 'num', 'duration_min'],
  ['reps', 'Reps', 'num', null],
  ['seconds', 'Seconds', 'num', null],
  ['weight', 'Weight (kg)', 'num', null],
  ['work_sec', 'Set time (seconds)', 'num', null],
  ['rest_sec', 'Rest before (seconds)', 'num', null],
];

// Tap an entry: see it, edit it, or delete it.
// Editing and deleting are the ONLY ways an existing entry ever changes
// (the log is otherwise append-only), and delete can be undone.
export function openDetails(ctx, e) {
  const { state } = ctx;
  const item = state.config.events.find((x) => x.id === e.item_id);
  const ask = new Set(item?.ask || []);
  // An end's duration is worked out from the two times, not typed.
  const fields = EDIT_FIELDS.filter(([k, , , a]) => (e[k] != null || (a && ask.has(a)))
    && !(e.kind === 'event_end' && k === 'duration_min'));
  const inherited = seriesMeasures(state.entries, e);
  const mDefs = ask.has('measures') || e.measures || inherited ? measureDefs(state, e, e.measures || inherited) : [];
  const otherSeries = bpSeriesNear(state, e);
  const unit = e.unit || item?.amount?.unit || '';
  const info = [
    e.nth_today ? t('#{n} that day', { n: e.nth_today }) : '',
    e.bp_sys != null && e.set_no ? t('reading {n} of a series', { n: e.set_no }) : '',
  ].filter(Boolean).join(' · ');

  const root = ctx.openSheet(`
    <div class="sheet-head">
      <div><b>${esc(screenLabel(state, e))}</b><br><span class="muted">${esc(friendlyDay(e.date))}${info ? ' · ' + esc(info) : ''}</span></div>
      <button class="btn danger" data-act="delete">${t('Delete')}</button>
    </div>
    <div class="edit-grid">
      <label>${t('Date')}<input class="input" type="date" data-e="date" value="${esc(e.date)}"></label>
      <label>${t('Time')}<input class="input" type="time" step="1" data-e="time" value="${esc(e.time)}"></label>
      ${fields.map(([k, lbl, type]) => `<label>${esc(t(lbl))}${k === 'amount' && unit ? ` (${esc(unit)})` : ''}
        <input class="input" data-e="${k}" ${type === 'num' ? 'inputmode="decimal"' : ''} value="${esc(e[k] ?? '')}"
          ${k === 'choice' && item?.choices ? 'list="choice-list"' : ''}></label>`).join('')}
    </div>
    ${mDefs.length ? measuresHtml(mDefs, e.measures || {}, inherited || {}) : ''}
    ${inherited ? `<p class="small muted">${esc(t('Gray numbers come from the first reading of this series.'))}</p>` : ''}
    ${otherSeries.length ? `<label class="label-block">${t('Series')}<select class="input" data-e-series>
      <option value="">${esc(t('Keep as its own series'))}</option>
      ${otherSeries.map((g) => `<option value="${esc(g.key)}">${esc(t('Join the series from {when} ({n} readings)', {
        when: `${friendlyDay(g.head.date)} ${hhmm(g.head.time)}`, n: g.list.length }))}</option>`).join('')}
    </select></label>` : ''}
    ${item?.choices ? `<datalist id="choice-list">${item.choices.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>` : ''}
    <label class="label-block">${t('Note')}<textarea class="input" data-e="note" rows="2">${esc(e.note ?? '')}</textarea></label>
    <div class="sheet-actions">
      <button class="btn" data-act="close">${t('Cancel')}</button>
      <button class="btn primary" data-act="save">${t('Save changes')}</button>
    </div>`);

  const val = (k) => root.querySelector(`[data-e="${k}"]`).value.trim();

  root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());

  root.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const patch = {};
    for (const [k, lbl, type] of fields) {
      const raw = val(k);
      let v = raw === '' ? null : raw;
      if (v != null && type === 'num') {
        v = Number(raw.replace(',', '.'));
        if (!(v > 0)) { ctx.toast(t('{label}: please type a number', { label: t(lbl) })); return; }
        if (k === 'intensity' && v > 10) { ctx.toast(t('Intensity goes from 1 to 10')); return; }
      }
      if (v !== e[k]) patch[k] = v;
    }
    if ('amount' in patch) patch.unit = patch.amount == null ? null : unit || null;
    if (mDefs.length) {
      const r = readMeasures(root, mDefs);
      if (r.error) { ctx.toast(r.error); return; }
      if (JSON.stringify(r.measures) !== JSON.stringify(e.measures ?? null)) patch.measures = r.measures;
    }
    const note = val('note') || null;
    if (note !== e.note) patch.note = note;

    // Date/time: rebuild ts so it keeps the correct timezone offset for
    // that moment (e.g. across a summer-time change).
    const date = val('date');
    const time = val('time');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
      ctx.toast(t('Please fill in a valid date and time')); return;
    }
    const fullTime = time.length === 5 ? `${time}:00` : time;
    if (date !== e.date || fullTime !== e.time) {
      const [Y, M, D] = date.split('-').map(Number);
      const [h, m, sec] = fullTime.split(':').map(Number);
      const d = new Date(Y, M - 1, D, h, m, sec);
      if (d > new Date(Date.now() + 60000)) { ctx.toast(t('That time is in the future')); return; }
      patch.ts = isoWithTz(d);
      patch.date = localDate(d);
      patch.time = localTime(d);
      if (patch.date !== e.date && e.nth_today != null) {
        // Moved to another day: give it its number within THAT day.
        const before = state.entries.filter((x) => x.id !== e.id && x.item_id === e.item_id
          && x.date === patch.date && Date.parse(x.ts) < d.getTime());
        patch.nth_today = new Set(before.map((x) => x.session_id || x.id)).size + 1;
      }
    }

    const joinTo = root.querySelector('[data-e-series]')?.value || '';
    if (!Object.keys(patch).length && !joinTo) { ctx.closeSheet(); return; }
    try {
      if (Object.keys(patch).length) {
        const updated = await storage.updateEntry(e.id, patch);
        if (!updated) throw new Error('entry not found');
        const i = state.entries.findIndex((x) => x.id === e.id);
        if (i >= 0) state.entries[i] = updated;
        if (patch.ts) await fixSpanDuration(state, updated);
        state.entries.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      }
      if (joinTo) await joinSeries(state, seriesKey(state.entries.find((x) => x.id === e.id) || e), joinTo);
    } catch (err) {
      ctx.toast(t('NOT saved: {msg}', { msg: err.message }), { error: true });
      return;
    }
    ctx.closeSheet();
    ctx.refresh();
    ctx.toast(joinTo ? t('Joined into one series') : t('Changes saved'));
  });

  root.querySelector('[data-act="delete"]').addEventListener('click', () => deleteWithUndo(ctx, e));
}

// Other blood-pressure series of the same button within a day of this
// entry — the ones it could be joined to (e.g. after the sheet was closed
// by accident and a new series started).
function bpSeriesNear(state, e) {
  const item = state.config.events.find((x) => x.id === e.item_id);
  if (e.kind !== 'event' || !(e.bp_sys != null || item?.ask?.includes('bp'))) return [];
  const own = seriesKey(e);
  const t0 = Date.parse(e.ts);
  const groups = new Map();
  for (const x of state.entries) {
    if (x.kind !== 'event' || x.item_id !== e.item_id || x.bp_sys == null) continue;
    const k = seriesKey(x);
    if (k === own) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  return [...groups].map(([key, list]) => ({ key, list, head: list[0] }))
    .filter((g) => Math.abs(Date.parse(g.head.ts) - t0) < 24 * 3600 * 1000)
    .sort((a, b) => Math.abs(Date.parse(a.head.ts) - t0) - Math.abs(Date.parse(b.head.ts) - t0));
}

// Joins series fromKey into series toKey: all readings get the same
// session_id, are renumbered 1, 2, 3… by time, and share the "#n that day"
// of the earliest one. (Explicit edit by the user, so it may touch several
// entries — they become one thing.)
async function joinSeries(state, fromKey, toKey) {
  const all = state.entries
    .filter((x) => x.kind === 'event' && (seriesKey(x) === fromKey || seriesKey(x) === toKey))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (!all.length) return;
  const nth = all[0].nth_today;
  for (let i = 0; i < all.length; i++) {
    const x = all[i];
    const patch = {};
    if (x.session_id !== toKey) patch.session_id = toKey;
    if (x.set_no !== i + 1) patch.set_no = i + 1;
    if (x.nth_today !== nth) patch.nth_today = nth;
    if (!Object.keys(patch).length) continue;
    const upd = await storage.updateEntry(x.id, patch);
    const j = state.entries.findIndex((y) => y.id === x.id);
    if (upd && j >= 0) state.entries[j] = upd;
  }
}

// Changing the time of a start or a finish changes how long it lasted, so
// the finish's duration_min is recalculated (the only case where editing
// one entry updates another — they are two halves of one thing).
async function fixSpanDuration(state, e) {
  let start = null;
  let end = null;
  if (e.kind === 'event_start') {
    start = e;
    end = state.entries.find((x) => x.kind === 'event_end' && x.session_id === e.id);
  } else if (e.kind === 'event_end') {
    end = e;
    start = state.entries.find((x) => x.id === e.session_id);
  }
  if (!start || !end) return;
  const duration = Math.max(0, Math.round((Date.parse(end.ts) - Date.parse(start.ts)) / 60000));
  if (duration === end.duration_min) return;
  const upd = await storage.updateEntry(end.id, { duration_min: duration });
  const j = state.entries.findIndex((x) => x.id === end.id);
  if (upd && j >= 0) state.entries[j] = upd;
}

// Delete one entry; the toast offers Undo, which puts it back unchanged.
// Shared by the Log screen and the "Recent" list on the Events screen.
export async function deleteWithUndo(ctx, e) {
  const { state } = ctx;
  let removed;
  try {
    removed = await storage.deleteEntry(e.id);
  } catch (err) {
    ctx.toast(t('NOT deleted: {msg}', { msg: err.message }), { error: true });
    return;
  }
  state.entries = state.entries.filter((x) => x.id !== e.id);
  ctx.closeSheet();
  ctx.refresh();
  ctx.toast(t('Deleted {label} {time}', { label: screenLabel(state, e), time: hhmm(e.time) }), {
    actionLabel: t('Undo'),
    onAction: async () => {
      try {
        await storage.restoreEntry(removed || e);
      } catch (err) {
        ctx.toast(t('Undo failed: {msg}', { msg: err.message }), { error: true });
        return;
      }
      state.entries.push(removed || e);
      state.entries.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      ctx.refresh();
      ctx.toast(t('Restored'));
    },
  });
}
