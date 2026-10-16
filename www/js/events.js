// Events screen: big buttons, one tap = logged.

import * as storage from './storage.js';
import { eventLabel } from './config.js';
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
    return `<button class="ev" data-id="${esc(ev.id)}">
      <span class="ev-count${mine.length ? '' : ' zero'}">${mine.length}</span>
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

  const nth = todayEvents(state).filter((e) => e.item_id === ev.id).length + 1;
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

  if (ev.ask && ev.ask.length) {
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

function chips(name, values, current) {
  return `<div class="chips" data-field="${name}">${values.map((v) =>
    `<button class="chip${current === v ? ' on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>`;
}

// Optional details after logging. The entry is ALREADY saved; this sheet
// only adds details, so closing/skipping it never loses the event.
function openAskSheet(ctx, ev, rec) {
  const label = eventLabel(ev);
  const ask = ev.ask;
  // If intensity is the only question, one chip tap saves and closes.
  const instant = ask.length === 1 && ask[0] === 'intensity';
  const values = {};

  const root = ctx.openSheet(`
    <div class="sheet-head">
      <div><b>${esc(label)} #${rec.nth_today}</b><br><span class="muted">logged ${hhmm(rec.time)}</span></div>
      <button class="btn" data-act="undo">Undo</button>
    </div>
    ${ask.includes('intensity') ? `<div class="field"><div class="label">Intensity</div>${chips('intensity', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])}</div>` : ''}
    ${ask.includes('duration_min') ? `<div class="field"><div class="label">Duration (minutes)</div>${chips('duration_min', DURATION_CHIPS)}</div>` : ''}
    ${ask.includes('note') ? `<div class="field"><div class="label">Note</div><input class="input" data-field="note" placeholder="optional"></div>` : ''}
    <div class="sheet-actions">
      <button class="btn" data-act="skip">Skip</button>
      ${instant ? '' : '<button class="btn primary" data-act="save">Save</button>'}
    </div>`);

  const save = async () => {
    const note = root.querySelector('[data-field="note"]');
    if (note && note.value.trim()) values.note = note.value.trim();
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

  root.querySelectorAll('.chips').forEach((group) => {
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const field = group.dataset.field;
      const v = Number(chip.dataset.v);
      const was = values[field] === v;
      group.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      if (was) delete values[field];
      else { values[field] = v; chip.classList.add('on'); }
      if (instant && !was) save();
    });
  });
  root.querySelector('[data-act="undo"]').addEventListener('click', () => undo(ctx, rec));
  root.querySelector('[data-act="skip"]').addEventListener('click', () => ctx.closeSheet());
  const saveBtn = root.querySelector('[data-act="save"]');
  if (saveBtn) saveBtn.addEventListener('click', save);
}
