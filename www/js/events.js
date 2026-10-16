// Events screen: big buttons, one tap = logged.

import * as storage from './storage.js';
import { ASK_FIELDS, eventLabel, saveConfig } from './config.js';
import { makeRecord } from './record.js';
import { esc, hhmm, localDate } from './util.js';

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

// A blood-pressure series is several log entries (one per reading) that
// share a session_id. It is ONE occurrence: one measuring session.
function occurrences(entries) {
  return new Set(entries.map((e) => e.session_id || e.id)).size;
}

function todayEvents(state) {
  const today = localDate();
  return state.entries.filter((e) => e.kind === 'event' && e.date === today);
}

export function renderEvents(el, ctx) {
  const { state } = ctx;
  const events = state.config.events.filter((e) => !e.hidden);
  if (!events.length) {
    el.innerHTML = `<div class="empty">No events yet.<br>Add some in <a href="#settings">Settings</a>.</div>`;
    return;
  }
  const today = todayEvents(state);
  el.innerHTML = `<div class="ev-grid">${events.map((ev) => {
    const mine = today.filter((e) => e.item_id === ev.id);
    const last = mine[mine.length - 1];
    // "How many" answers count as that many (2 pills logged once = 2).
    const total = mine.reduce((n, e) => n + (e.count || 1), 0) - (mine.length - occurrences(mine));
    // Colour comes from the config and is validated as #rrggbb there, so
    // it's safe to put into the style attribute.
    const col = ev.color ? ` has-color" style="--c:${ev.color}` : '';
    return `<button class="ev${col}" data-id="${esc(ev.id)}">
      <span class="ev-count${total ? '' : ' zero'}">${total}</span>
      <span class="ev-name">${esc(eventLabel(ev))}</span>
      <span class="ev-last">${last ? 'last ' + hhmm(last.time) : '&nbsp;'}</span>
    </button>`;
  }).join('')}</div>`;

  el.querySelectorAll('.ev').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ev = state.config.events.find((e) => e.id === btn.dataset.id);
      if (ev) logEvent(ctx, ev);
    });
  });
}

// Logs one event. Also used by the home-screen shortcut (?log=<id>).
export async function logEvent(ctx, ev) {
  const { state } = ctx;
  const label = eventLabel(ev);
  const nowMs = Date.now();

  const lastEntry = [...state.entries].reverse()
    .find((e) => e.kind === 'event' && e.item_id === ev.id);
  const lastMs = Math.max(lastTap.get(ev.id) || 0, lastEntry ? Date.parse(lastEntry.ts) : 0);
  if (nowMs - lastMs < DOUBLE_TAP_MS) {
    const secs = Math.max(1, Math.round((nowMs - lastMs) / 1000));
    ctx.toast(`Double tap ignored — ${label} was logged ${secs}s ago`);
    return;
  }
  lastTap.set(ev.id, nowMs);

  const nth = occurrences(todayEvents(state).filter((e) => e.item_id === ev.id)) + 1;
  const rec = makeRecord({
    kind: 'event',
    item_id: ev.id,
    item_name: ev.name, // real name: goes to the log/exports, never on screen
    nth_today: nth,
  }, new Date(nowMs));

  try {
    await storage.appendEntry(rec);
  } catch (e) {
    lastTap.delete(ev.id);
    ctx.toast(`NOT saved: ${e.message}`, { error: true });
    return;
  }
  state.entries.push(rec);
  if (navigator.vibrate) navigator.vibrate(30);
  ctx.refresh();

  if (ev.ask && ev.ask.includes('bp')) {
    openBpSheet(ctx, ev, rec);
  } else if (ev.ask && ev.ask.length) {
    openAskSheet(ctx, ev, rec);
  } else {
    ctx.toast(`${label} #${nth} logged ${hhmm(rec.time)}`, {
      actionLabel: 'Undo',
      onAction: () => undo(ctx, rec),
    });
  }
}

async function undo(ctx, rec) {
  try {
    await storage.deleteEntry(rec.id);
  } catch (e) {
    ctx.toast(`Undo failed: ${e.message}`, { error: true });
    return;
  }
  ctx.state.entries = ctx.state.entries.filter((e) => e.id !== rec.id);
  lastTap.delete(rec.item_id);
  ctx.closeSheet();
  ctx.refresh();
  ctx.toast('Undone');
}

function chips(field, values, opts = {}) {
  return `<div class="chips${opts.wide ? ' wide' : ''}" data-field="${field}">${values.map((v) =>
    `<button class="chip" data-v="${esc(v)}">${esc(v)}${opts.suffix ? `<small>${esc(opts.suffix)}</small>` : ''}</button>`).join('')}${
    opts.other ? '<button class="chip other" data-other="1">Other…</button>' : ''}</div>`;
}

// One sheet section per "ask" field, in the order the config lists them.
function askSection(ev, field) {
  switch (field) {
    case 'intensity':
      return ['Intensity', chips('intensity', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])];
    case 'duration_min':
      return ['Duration (minutes)', chips('duration_min', DURATION_CHIPS, { other: true })];
    case 'choice':
      return ['Type', chips('choice', ev.choices || [], { wide: true, other: true })];
    case 'amount':
      return [`Amount (${ev.amount.unit})`, chips('amount', ev.amount.values, { other: true })];
    case 'count':
      return ['How many', chips('count', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])];
    case 'note':
      return ['Note', '<input class="input" data-field="note" placeholder="optional">'];
    default:
      return null;
  }
}

const NUMERIC = new Set(['intensity', 'duration_min', 'amount', 'count']);

// Optional details after logging. The entry is ALREADY saved; this sheet
// only adds details, so closing/skipping it never loses the event.
function openAskSheet(ctx, ev, rec) {
  const label = eventLabel(ev);
  const ask = ev.ask.filter((f) => ASK_FIELDS.includes(f));
  // A single tap-to-pick question saves on the first tap: fastest path.
  const instant = ask.length === 1 && ask[0] !== 'note';
  const values = {};

  const sections = ask.map((f) => askSection(ev, f)).filter(Boolean);
  const root = ctx.openSheet(`
    <div class="sheet-head">
      <div><b>${esc(label)} #${rec.nth_today}</b><br><span class="muted">logged ${hhmm(rec.time)}</span></div>
      <button class="btn" data-act="undo">Undo</button>
    </div>
    ${sections.map(([title, body]) => `<div class="field"><div class="label">${esc(title)}</div>${body}</div>`).join('')}
    <div class="sheet-actions">
      <button class="btn" data-act="skip">Skip</button>
      ${instant ? '' : '<button class="btn primary" data-act="save">Save</button>'}
    </div>`);

  const save = async () => {
    const note = root.querySelector('[data-field="note"]');
    if (note && note.value.trim()) values.note = note.value.trim();
    if (values.amount != null) values.unit = ev.amount.unit;
    ctx.closeSheet();
    if (!Object.keys(values).length) return;
    try {
      const updated = await storage.updateEntry(rec.id, values);
      if (updated) {
        const i = ctx.state.entries.findIndex((e) => e.id === rec.id);
        if (i >= 0) ctx.state.entries[i] = updated;
      }
      ctx.toast(`${label} #${rec.nth_today} saved`);
      ctx.refresh();
    } catch (e) {
      ctx.toast(`Details NOT saved: ${e.message}`, { error: true });
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
        const typed = prompt(field === 'choice' ? 'Type name:' : 'Number:');
        if (typed === null || !typed.trim()) return;
        let v = typed.trim();
        if (NUMERIC.has(field)) {
          v = Number(v.replace(',', '.'));
          if (!(v > 0)) { ctx.toast('Please type a number'); return; }
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
  root.querySelector('[data-act="undo"]').addEventListener('click', () => undo(ctx, rec));
  root.querySelector('[data-act="skip"]').addEventListener('click', () => ctx.closeSheet());
  const saveBtn = root.querySelector('[data-act="save"]');
  if (saveBtn) saveBtn.addEventListener('click', save);
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

function openBpSheet(ctx, ev, first) {
  const label = eventLabel(ev);
  const askNote = ev.ask.includes('note');
  const series = []; // saved records of this series, in order
  let timer = null;

  const render = () => {
    const n = series.length + 1;
    const t0 = Date.parse(first.ts);
    const root = ctx.openSheet(`
      <div class="sheet-head">
        <div><b>${esc(label)} #${first.nth_today}</b><br><span class="muted">reading ${n}</span></div>
        <button class="btn" data-act="undo">${series.length > 1 ? 'Undo all' : 'Undo'}</button>
      </div>
      ${series.length ? `<table class="kv bp-list">${series.map((r) => `<tr>
        <th>${r.set_no}. ${hhmm(r.time)} <span class="muted">+${mmss(Date.parse(r.ts) - t0)}</span></th>
        <td><b>${r.bp_sys}/${r.bp_dia}</b>${r.pulse != null ? ` · ♥ ${r.pulse}` : ''}</td></tr>`).join('')}</table>
        <p class="rest">Resting: <b data-timer>0:00</b> since last reading</p>` : ''}
      <div class="bp-row">
        <label>Upper<input class="input bp" data-bp="bp_sys" inputmode="numeric" placeholder="120"></label>
        <span class="bp-slash">/</span>
        <label>Lower<input class="input bp" data-bp="bp_dia" inputmode="numeric" placeholder="80"></label>
        <label>Pulse<input class="input bp" data-bp="pulse" inputmode="numeric" placeholder="70"></label>
      </div>
      ${askNote ? '<input class="input" data-field="note" placeholder="Note (optional)">' : ''}
      <div class="sheet-actions">
        <button class="btn" data-act="done">${series.length ? 'Done' : 'Skip'}</button>
        <button class="btn primary" data-act="save">Save reading ${n}</button>
      </div>`);

    clearInterval(timer);
    const tEl = root.querySelector('[data-timer]');
    if (tEl) {
      const last = Date.parse(series[series.length - 1].ts);
      const tick = () => {
        // The sheet was closed (or replaced): stop ticking.
        if (document.getElementById('sheet').hidden || !tEl.isConnected) { clearInterval(timer); return; }
        tEl.textContent = mmss(Date.now() - last);
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    const inputs = [...root.querySelectorAll('[data-bp]')];
    // Jump to the next box once a value is complete, so typing
    // "135 88 72" needs no extra taps.
    inputs.forEach((inp, i) => inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 3);
      const v = Number(inp.value);
      const full = inp.value.length === 3 || (inp.value.length === 2 && v >= 30 && inp.dataset.bp !== 'bp_sys');
      if (full && inputs[i + 1]) inputs[i + 1].focus();
    }));
    if (!series.length) setTimeout(() => inputs[0].focus(), 50);

    root.querySelector('[data-act="undo"]').addEventListener('click', async () => {
      clearInterval(timer);
      try {
        for (const r of [first, ...series.slice(1)]) await storage.deleteEntry(r.id);
      } catch (e) {
        ctx.toast(`Undo failed: ${e.message}`, { error: true });
        return;
      }
      const ids = new Set([first.id, ...series.map((r) => r.id)]);
      ctx.state.entries = ctx.state.entries.filter((e) => !ids.has(e.id));
      lastTap.delete(ev.id);
      ctx.closeSheet();
      ctx.refresh();
      ctx.toast('Undone');
    });
    root.querySelector('[data-act="done"]').addEventListener('click', () => {
      clearInterval(timer);
      ctx.closeSheet();
      if (series.length) ctx.toast(`${label}: ${series.length} reading${series.length > 1 ? 's' : ''} saved`);
    });
    root.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const v = {};
      for (const inp of inputs) v[inp.dataset.bp] = inp.value ? Number(inp.value) : null;
      if (v.bp_sys == null || v.bp_dia == null) { ctx.toast('Type the upper and lower number'); return; }
      const odd = Object.entries(v).filter(([k, x]) => x != null && (x < BP_LIMITS[k][0] || x > BP_LIMITS[k][1]));
      if (odd.length && !confirm(`${odd.map(([, x]) => x).join(', ')} looks unusual. Save anyway?`)) return;
      if (v.bp_sys <= v.bp_dia && !confirm('Upper is not bigger than lower — swapped? Save anyway?')) return;
      const noteEl = root.querySelector('[data-field="note"]');
      if (noteEl && noteEl.value.trim()) v.note = noteEl.value.trim();
      v.session_id = first.id;
      v.set_no = series.length + 1;
      try {
        let saved;
        if (!series.length) {
          saved = await storage.updateEntry(first.id, v);
          const i = ctx.state.entries.findIndex((e) => e.id === first.id);
          if (i >= 0 && saved) ctx.state.entries[i] = saved;
        } else {
          saved = makeRecord({
            kind: 'event', item_id: ev.id, item_name: ev.name, nth_today: first.nth_today, ...v,
          });
          await storage.appendEntry(saved);
          ctx.state.entries.push(saved);
        }
        if (!saved) throw new Error('entry not found');
        series.push(saved);
      } catch (e) {
        ctx.toast(`Reading NOT saved: ${e.message}`, { error: true });
        return;
      }
      if (navigator.vibrate) navigator.vibrate(30);
      ctx.refresh();
      render(); // ready for the next reading, with the rest timer running
    });
  };
  render();
}
