// Training screen: start a routine (or a free session), log sets with a
// big +/- stepper, see today's and last session's sets, rest timer,
// finish with a summary.
//
// Crash safety: every set is appended to the log the moment it's logged,
// and the open session itself (which routine, which exercise is selected,
// stepper values) lives in storage under "open_session". Closing the app
// mid-workout loses nothing; it reopens exactly where it was.

import * as storage from './storage.js';
import { routineSteps } from './config.js';
import { makeRecord } from './record.js';
import { esc, friendlyDay, hhmm, localDate } from './util.js';

const KEY = 'open_session';
let restTimer = null;

export async function loadOpenSession(state) {
  try {
    state.session = (await storage.getValue(KEY)) || null;
  } catch {
    state.session = null;
  }
}

function saveSession(ctx) {
  return storage.setValue(KEY, ctx.state.session);
}

// An exercise from the config; if it was removed meanwhile, a stand-in so
// an open session or old sets never break the screen.
function exercise(ctx, id) {
  return ctx.state.config.exercises.find((x) => x.id === id)
    || { id, name: id, type: 'reps' };
}

const valueOf = (e) => (e.reps ?? e.seconds);

function fmtSet(e) {
  let s = e.seconds != null ? `${e.seconds}s` : `${e.reps}`;
  if (e.weight) s += `+${e.weight}`;
  return s;
}

function sessionSets(ctx, exId) {
  const sid = ctx.state.session.id;
  return ctx.state.entries.filter((e) => e.kind === 'set' && e.session_id === sid && e.item_id === exId);
}

function todaySets(ctx, exId) {
  const today = localDate();
  return ctx.state.entries.filter((e) => e.kind === 'set' && e.item_id === exId && e.date === today);
}

// The sets of this exercise from the most recent OTHER session.
function lastSessionSets(ctx, exId) {
  const sid = ctx.state.session?.id;
  const sets = ctx.state.entries.filter((e) => e.kind === 'set' && e.item_id === exId && e.session_id !== sid);
  if (!sets.length) return [];
  const lastSid = sets[sets.length - 1].session_id;
  return sets.filter((e) => e.session_id === lastSid);
}

function stepFor(ctx, exId) {
  return ctx.state.session.steps.find((s) => s.id === exId) || { id: exId, sets: null, reps: null };
}

// Where the stepper starts: what you just did, else what you did last
// time, else the routine's goal, else the exercise's "start" number.
function startValue(ctx, ex) {
  const mine = sessionSets(ctx, ex.id);
  if (mine.length) return valueOf(mine[mine.length - 1]);
  const last = lastSessionSets(ctx, ex.id);
  if (last.length) return valueOf(last[0]);
  const step = stepFor(ctx, ex.id);
  return step.reps || ex.start || (ex.type === 'seconds' ? 30 : 10);
}

function draft(ctx, ex) {
  const s = ctx.state.session;
  s.draft = s.draft || {};
  if (!s.draft[ex.id]) {
    const mine = sessionSets(ctx, ex.id);
    const last = mine[mine.length - 1] || lastSessionSets(ctx, ex.id)[0];
    s.draft[ex.id] = { value: startValue(ctx, ex), weight: last?.weight || 0 };
  }
  return s.draft[ex.id];
}

function mmss(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function renderTraining(el, ctx) {
  clearInterval(restTimer);
  if (ctx.state.session) renderSession(el, ctx);
  else renderStart(el, ctx);
}

// --- start screen ----------------------------------------------------------
function renderStart(el, ctx) {
  const { routines } = ctx.state.config;
  const visible = routines.filter((r) => !r.hidden);
  const lastDone = (rid) => {
    const ends = ctx.state.entries.filter((e) => e.kind === 'session_start' && e.item_id === rid);
    return ends.length ? friendlyDay(ends[ends.length - 1].date) : null;
  };
  el.innerHTML = `
    ${visible.map((r) => {
      const steps = routineSteps(r);
      const last = lastDone(r.id);
      return `<button class="routine" data-r="${esc(r.id)}">
        <span class="routine-name">${esc(r.name)}</span>
        <span class="routine-ex">${steps.map((s) => esc(exercise(ctx, s.id).name)
          + (s.sets ? ` <span class="muted">${s.sets}×${s.reps || '?'}</span>` : '')).join(' · ')}</span>
        ${last ? `<span class="routine-last">last: ${esc(last)}</span>` : ''}
      </button>`;
    }).join('')}
    <button class="routine free" data-free="1">
      <span class="routine-name">Free session</span>
      <span class="routine-ex">Pick exercises as you go</span>
    </button>
    <p class="center"><a href="#settings" data-goto="training-settings">Edit exercises &amp; routines</a></p>`;

  el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
    startSession(ctx, routines.find((r) => r.id === b.dataset.r));
  }));
  el.querySelector('[data-free]').addEventListener('click', () => startSession(ctx, null));
  el.querySelector('[data-goto]').addEventListener('click', () => { ctx.state.scrollTo = 'training-settings'; });
}

async function startSession(ctx, routine) {
  const steps = routine ? routineSteps(routine).filter((s) => ctx.state.config.exercises.some((x) => x.id === s.id)) : [];
  const start = makeRecord({
    kind: 'session_start',
    item_id: routine ? routine.id : 'free',
    item_name: routine ? routine.name : 'Free session',
  });
  start.session_id = start.id;
  const session = {
    id: start.id,
    item_id: start.item_id,
    item_name: start.item_name,
    started: start.ts,
    steps,
    current: steps[0]?.id || null,
    draft: {},
  };
  try {
    await storage.appendEntry(start);
    ctx.state.session = session;
    await saveSession(ctx);
  } catch (e) {
    ctx.state.session = null;
    ctx.toast(`Could not start: ${e.message}`, { error: true });
    return;
  }
  ctx.state.entries.push(start);
  ctx.refresh();
  if (!steps.length) openAddExercise(ctx);
}

// --- open session ----------------------------------------------------------
function renderSession(el, ctx) {
  const s = ctx.state.session;
  const ex = s.current ? exercise(ctx, s.current) : null;
  const chips = s.steps.map((st) => {
    const n = sessionSets(ctx, st.id).length;
    const done = st.sets && n >= st.sets;
    return `<button class="tr-chip${st.id === s.current ? ' on' : ''}${done ? ' done' : ''}" data-ex="${esc(st.id)}">
      ${esc(exercise(ctx, st.id).name)} <span>${n}${st.sets ? '/' + st.sets : ''}${done ? ' ✓' : ''}</span></button>`;
  }).join('');

  let card = '<div class="empty">Add an exercise to start.</div>';
  if (ex) {
    const step = stepFor(ctx, ex.id);
    const d = draft(ctx, ex);
    const mine = sessionSets(ctx, ex.id);
    const today = todaySets(ctx, ex.id);
    const last = lastSessionSets(ctx, ex.id);
    const unit = ex.type === 'seconds' ? 'seconds' : 'reps';
    const lastSet = mine[mine.length - 1];
    card = `<div class="card pad tr-card">
      <div class="tr-name">${esc(ex.name)}${step.sets ? `<span class="muted"> goal ${step.sets} × ${step.reps || '?'}${ex.type === 'seconds' ? 's' : ''}</span>` : ''}</div>
      <div class="tr-hist">Today: <b>${today.length ? today.map(fmtSet).join('  ') : '—'}</b></div>
      <div class="tr-hist muted">Last time${last.length ? ` (${esc(friendlyDay(last[0].date))})` : ''}: ${last.length ? last.map(fmtSet).join('  ') : '—'}</div>
      <div class="stepper">
        <button class="step-btn" data-step="-1" aria-label="Less">−</button>
        <button class="step-val" data-act="type-value"><b>${d.value}</b><small>${unit}</small></button>
        <button class="step-btn" data-step="1" aria-label="More">+</button>
      </div>
      ${ex.allowWeight ? `<div class="wstep"><span>Extra weight</span>
        <button class="ibtn" data-w="-2.5">−</button><b>${d.weight || 0} kg</b><button class="ibtn" data-w="2.5">+</button></div>` : ''}
      <input class="input" data-act="note" placeholder="Note for this set (optional)">
      <button class="btn primary wide big" data-act="log">Log set ${mine.length + 1}</button>
      <div class="btn-row">
        <button class="btn" data-act="repeat" ${lastSet ? '' : 'disabled'}>Repeat last${lastSet ? ` (${fmtSet(lastSet)})` : ''}</button>
        <button class="btn" data-act="undo" ${lastSet ? '' : 'disabled'}>Undo last set</button>
      </div>
    </div>`;
  }

  const allSets = ctx.state.entries.filter((e) => e.kind === 'set' && e.session_id === s.id);
  const lastAny = allSets[allSets.length - 1];
  el.innerHTML = `
    <div class="tr-head">
      <div><b>${esc(s.item_name)}</b><br><span class="muted small">started ${hhmm(s.started.slice(11, 19))} · <span data-elapsed></span></span></div>
      <button class="btn" data-act="finish">Finish</button>
    </div>
    <div class="rest big-rest">${lastAny ? 'Rest' : 'Started'} <b data-timer>0:00</b>${lastAny ? '' : ' ago'}</div>
    <div class="tr-chips">${chips}<button class="tr-chip add" data-act="add">+ Exercise</button></div>
    ${card}`;

  // Rest timer = time since the last set of ANY exercise in this session.
  const tEl = el.querySelector('[data-timer]');
  const eEl = el.querySelector('[data-elapsed]');
  const from = Date.parse(lastAny ? lastAny.ts : s.started);
  const tick = () => {
    if (!tEl.isConnected) { clearInterval(restTimer); return; }
    tEl.textContent = mmss(Date.now() - from);
    eEl.textContent = mmss(Date.now() - Date.parse(s.started));
  };
  tick();
  restTimer = setInterval(tick, 1000);

  el.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => {
    s.current = b.dataset.ex;
    saveSession(ctx);
    ctx.refresh();
  }));
  el.querySelector('[data-act="add"]').addEventListener('click', () => openAddExercise(ctx));
  el.querySelector('[data-act="finish"]').addEventListener('click', () => openFinish(ctx));
  if (!ex) return;

  const d = draft(ctx, ex);
  const step = ex.type === 'seconds' ? 5 : 1;
  el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    d.value = Math.max(1, d.value + Number(b.dataset.step) * step);
    el.querySelector('.step-val b').textContent = d.value;
  }));
  el.querySelector('[data-act="type-value"]').addEventListener('click', () => {
    const v = Number(prompt(`How many ${ex.type === 'seconds' ? 'seconds' : 'reps'}?`, d.value));
    if (v > 0) { d.value = Math.round(v); el.querySelector('.step-val b').textContent = d.value; }
  });
  el.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
    d.weight = Math.max(0, Math.round(((d.weight || 0) + Number(b.dataset.w)) * 10) / 10);
    el.querySelector('.wstep b').textContent = `${d.weight} kg`;
  }));
  el.querySelector('[data-act="log"]').addEventListener('click', () => {
    const note = el.querySelector('[data-act="note"]').value.trim() || null;
    logSet(ctx, ex, d.value, ex.allowWeight ? d.weight || null : null, note);
  });
  el.querySelector('[data-act="repeat"]').addEventListener('click', () => {
    const mine = sessionSets(ctx, ex.id);
    const last = mine[mine.length - 1];
    if (last) logSet(ctx, ex, valueOf(last), last.weight, null);
  });
  el.querySelector('[data-act="undo"]').addEventListener('click', () => undoLastSet(ctx, ex));
}

// Double-tap guard on "Log set": a set takes far longer than this, so two
// logs within it are a shaky finger, not two sets.
const SET_GUARD_MS = 2000;
let lastLogAt = 0;

async function logSet(ctx, ex, value, weight, note) {
  const now = Date.now();
  if (now - lastLogAt < SET_GUARD_MS) { ctx.toast('Double tap ignored'); return; }
  lastLogAt = now;
  const s = ctx.state.session;
  const n = sessionSets(ctx, ex.id).length + 1;
  const rec = makeRecord({
    kind: 'set',
    item_id: ex.id,
    item_name: ex.name,
    session_id: s.id,
    set_no: n,
    reps: ex.type === 'seconds' ? null : value,
    seconds: ex.type === 'seconds' ? value : null,
    weight: weight || null,
    note,
  });
  try {
    await storage.appendEntry(rec);
  } catch (e) {
    lastLogAt = 0;
    ctx.toast(`Set NOT saved: ${e.message}`, { error: true });
    return;
  }
  ctx.state.entries.push(rec);
  if (navigator.vibrate) navigator.vibrate(30);

  // Goal reached: move on to the next exercise that isn't done yet, so the
  // next set is one tap away. "Back" undoes the jump, not the set.
  const step = stepFor(ctx, ex.id);
  let msg = `${ex.name} set ${n}: ${fmtSet(rec)}`;
  let back = null;
  if (step.sets && n === step.sets) {
    const next = s.steps.find((st) => st.id !== ex.id && !(st.sets && sessionSets(ctx, st.id).length >= st.sets));
    if (next) {
      s.current = next.id;
      msg = `${ex.name} done ✓  Next: ${exercise(ctx, next.id).name}`;
      back = ex.id;
    }
  }
  saveSession(ctx).catch(() => {});
  ctx.refresh();
  ctx.toast(msg, back ? {
    actionLabel: 'Back',
    onAction: () => { s.current = back; saveSession(ctx); ctx.refresh(); },
  } : {});
}

async function undoLastSet(ctx, ex) {
  const mine = sessionSets(ctx, ex.id);
  const last = mine[mine.length - 1];
  if (!last) return;
  try {
    await storage.deleteEntry(last.id);
  } catch (e) {
    ctx.toast(`Undo failed: ${e.message}`, { error: true });
    return;
  }
  ctx.state.entries = ctx.state.entries.filter((e) => e.id !== last.id);
  lastLogAt = 0;
  ctx.refresh();
  ctx.toast(`Removed set ${last.set_no} (${fmtSet(last)})`);
}

function openAddExercise(ctx) {
  const s = ctx.state.session;
  const list = ctx.state.config.exercises.filter((x) => !x.hidden);
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>Add an exercise</b></div>
    ${list.length ? `<div class="pick-list">${list.map((x) => `<button class="btn" data-pick="${esc(x.id)}">${esc(x.name)}${
      s.steps.some((st) => st.id === x.id) ? ' <span class="muted small">(in session)</span>' : ''}</button>`).join('')}</div>`
      : '<p class="muted">No exercises yet. Add some in Settings.</p>'}
    <div class="sheet-actions"><button class="btn" data-act="close">Close</button></div>`);
  root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.pick;
    if (!s.steps.some((st) => st.id === id)) s.steps.push({ id, sets: null, reps: null });
    s.current = id;
    await saveSession(ctx).catch(() => {});
    ctx.closeSheet();
    ctx.refresh();
  }));
}

function summaryHtml(ctx, sets) {
  const byEx = new Map();
  for (const e of sets) {
    if (!byEx.has(e.item_id)) byEx.set(e.item_id, []);
    byEx.get(e.item_id).push(e);
  }
  return `<table class="kv summary">${[...byEx].map(([id, list]) => {
    const secs = list[0].seconds != null;
    const total = list.reduce((n, e) => n + (valueOf(e) || 0), 0);
    return `<tr><th>${esc(exercise(ctx, id).name)}<br><span class="small">${list.map(fmtSet).join('  ')}</span></th>
      <td><b>${list.length}</b> sets<br><b>${total}</b> ${secs ? 'sec' : 'reps'}</td></tr>`;
  }).join('')}</table>`;
}

function openFinish(ctx) {
  const s = ctx.state.session;
  const sets = ctx.state.entries.filter((e) => e.kind === 'set' && e.session_id === s.id);
  if (!sets.length) {
    const root = ctx.openSheet(`
      <div class="sheet-head"><b>No sets logged</b></div>
      <p>Discard this empty session?</p>
      <div class="sheet-actions"><button class="btn" data-act="keep">Keep training</button>
      <button class="btn primary" data-act="discard">Discard</button></div>`);
    root.querySelector('[data-act="keep"]').addEventListener('click', () => ctx.closeSheet());
    root.querySelector('[data-act="discard"]').addEventListener('click', async () => {
      try {
        await storage.deleteEntry(s.id);
        await storage.setValue(KEY, null);
      } catch (e) {
        ctx.toast(`Failed: ${e.message}`, { error: true });
        return;
      }
      ctx.state.entries = ctx.state.entries.filter((e) => e.id !== s.id);
      ctx.state.session = null;
      ctx.closeSheet();
      ctx.refresh();
    });
    return;
  }
  const mins = Math.round((Date.now() - Date.parse(s.started)) / 60000);
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>Finish ${esc(s.item_name)}?</b><span class="muted">${mins} min</span></div>
    ${summaryHtml(ctx, sets)}
    <div class="sheet-actions"><button class="btn" data-act="keep">Keep training</button>
    <button class="btn primary" data-act="confirm-finish">Finish</button></div>`);
  root.querySelector('[data-act="keep"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelector('[data-act="confirm-finish"]').addEventListener('click', async () => {
    const end = makeRecord({ kind: 'session_end', item_id: s.item_id, item_name: s.item_name, session_id: s.id });
    end.duration_min = mins;
    try {
      await storage.appendEntry(end);
      await storage.setValue(KEY, null);
    } catch (e) {
      ctx.toast(`Failed: ${e.message}`, { error: true });
      return;
    }
    ctx.state.entries.push(end);
    ctx.state.session = null;
    ctx.refresh();
    const done = ctx.openSheet(`
      <div class="sheet-head"><b>Well done! 💪</b><span class="muted">${esc(s.item_name)} · ${mins} min</span></div>
      ${summaryHtml(ctx, sets)}
      <div class="sheet-actions"><button class="btn primary" data-act="close">Close</button></div>`);
    done.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
  });
}

