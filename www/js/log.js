// Log screen: newest first, grouped by day.
// Tap an entry to edit it or delete it (with undo).

import * as storage from './storage.js';
import { eventLabel } from './config.js';
import {
  esc, friendlyDay, hhmm, isoWithTz, localDate, localTime,
} from './util.js';
import { t } from './i18n.js';
import { measuresHtml, readMeasures } from './events.js';

const PAGE = 200;
let shown = PAGE;

// Label shown ON SCREEN. Private items show their displayLabel; the real
// item_name is only used if the item no longer exists in the config.
export function screenLabel(state, e) {
  if (e.kind === 'session_start') return t('▶ {name} — started', { name: e.item_name });
  if (e.kind === 'session_end') return t('■ {name} — finished', { name: e.item_name });
  const lists = [...state.config.events, ...state.config.exercises];
  const item = lists.find((x) => x.id === e.item_id);
  if (item && e.kind === 'event') return eventLabel(item);
  if (item) return item.name;
  return e.item_name || e.kind;
}

// The custom number fields to show/edit for an entry: the button's current
// ones, plus any stored value whose field was removed from the button since.
function measureDefs(state, e) {
  const item = state?.config.events.find((x) => x.id === e.item_id);
  const defs = [...(item?.measures || [])];
  for (const id of Object.keys(e.measures || {})) {
    if (!defs.some((m) => m.id === id)) defs.push({ id, name: id, unit: '' });
  }
  return defs;
}

export function details(e, state) {
  const parts = [];
  if (e.nth_today) parts.push(`#${e.nth_today}`);
  if (e.set_no && e.bp_sys != null) parts.push(t('reading {n}', { n: e.set_no }));
  if (e.bp_sys != null) parts.push(`${e.bp_sys}/${e.bp_dia}`);
  if (e.pulse != null) parts.push(`♥ ${e.pulse}`);
  for (const m of measureDefs(state, e)) {
    const v = e.measures?.[m.id];
    if (v != null) parts.push(`${m.name} ${v}${m.unit ? ' ' + m.unit : ''}`);
  }
  if (e.choice) parts.push(e.choice);
  if (e.amount != null) parts.push(`${e.amount} ${e.unit || ''}`.trim());
  if (e.count != null && e.count !== 1) parts.push(`×${e.count}`);
  if (e.kind === 'set' && e.set_no) parts.push(t('set {n}', { n: e.set_no }));
  if (e.kind === 'session_end' && e.duration_min != null) parts.push(t('{n} min', { n: e.duration_min }));
  if (e.reps != null) parts.push(t('{n} reps', { n: e.reps }));
  if (e.seconds != null) parts.push(`${e.seconds}s`);
  if (e.weight != null) parts.push(`+${e.weight}kg`);
  if (e.intensity != null) parts.push(t('intensity {n}', { n: e.intensity }));
  if (e.kind !== 'session_end' && e.duration_min != null) parts.push(t('{n} min', { n: e.duration_min }));
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
      const n = all.filter((x) => x.date === day && x.kind === 'event').length;
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
];

// Tap an entry: see it, edit it, or delete it.
// Editing and deleting are the ONLY ways an existing entry ever changes
// (the log is otherwise append-only), and delete can be undone.
export function openDetails(ctx, e) {
  const { state } = ctx;
  const item = state.config.events.find((x) => x.id === e.item_id);
  const ask = new Set(item?.ask || []);
  const fields = EDIT_FIELDS.filter(([k, , , a]) => e[k] != null || (a && ask.has(a)));
  const mDefs = ask.has('measures') || e.measures ? measureDefs(state, e) : [];
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
    ${mDefs.length ? measuresHtml(mDefs, e.measures || {}) : ''}
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

    if (!Object.keys(patch).length) { ctx.closeSheet(); return; }
    try {
      const updated = await storage.updateEntry(e.id, patch);
      if (!updated) throw new Error('entry not found');
      const i = state.entries.findIndex((x) => x.id === e.id);
      if (i >= 0) state.entries[i] = updated;
      state.entries.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    } catch (err) {
      ctx.toast(t('NOT saved: {msg}', { msg: err.message }), { error: true });
      return;
    }
    ctx.closeSheet();
    ctx.refresh();
    ctx.toast(t('Changes saved'));
  });

  root.querySelector('[data-act="delete"]').addEventListener('click', () => deleteWithUndo(ctx, e));
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
