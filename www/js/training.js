// Training screen: start a routine (or a free session) and log sets.
//
// The flow follows how a set really happens:
//   set the reps with +/-  →  ▶ Start set (rest timer stops, set timer runs)
//   →  do the set  →  ✓ Done (set is logged, rest timer starts).
// Each set records how long it took (work_sec) and how long you rested
// before it (rest_sec). A rest goal (e.g. 1:30) beeps when rest is over.
//
// Exercises counted in seconds are timed by the app: Start gives a short
// "get ready" countdown, then counts down the stepper's seconds and logs
// the set by itself with a beep. A circuit ("parts", e.g. front plank →
// left side → right side) runs the stepper's seconds for EACH part and
// beeps at every switch.
//
// Crash safety: every set is appended to the log the moment it's logged,
// and the open session (routine, current exercise, stepper values, and a
// set in progress) lives in storage under "open_session". Closing the app
// mid-workout, even mid-set, loses nothing; it reopens where it was.

import * as storage from './storage.js';
import { routineSteps } from './config.js';
import { makeRecord } from './record.js';
import { esc, friendlyDay, hhmm, localDate } from './util.js';
import { t } from './i18n.js';
import {
  keepAwake, setSoundOn, signal, unlockAudio,
} from './alerts.js';
import { openExercisePicker } from './exercisePicker.js';

const KEY = 'open_session';
// Time to get into position after tapping Start on a timed exercise.
const LEAD_MS = 5000;
// Start and Done are the same big button; a second tap this soon after the
// first is a shaky finger, not a real Done/Start.
const PRIMARY_GUARD_MS = 1200;
const REST_GOALS = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];

let tickTimer = null;
let lastPrimary = 0;
let finishing = false;
// Which beeps were already played, so a re-render never repeats one.
const played = { rest: null, go: null, part: null, tick: null };

export async function loadOpenSession(state) {
  try {
    state.session = (await storage.getValue(KEY)) || null;
    const sound = await storage.getValue('tr_sound');
    const goal = await storage.getValue('tr_rest_goal');
    state.trainingPrefs = { sound: sound ?? true, restGoal: goal ?? 90 };
  } catch {
    state.session = null;
    state.trainingPrefs = { sound: true, restGoal: 90 };
  }
  setSoundOn(state.trainingPrefs.sound);
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
const nParts = (ex) => (ex.type === 'seconds' && ex.parts?.length ? ex.parts.length : 1);
// The stepper holds seconds PER PART for a circuit; a logged set holds the total.
const stepperValueOf = (ex, e) => (nParts(ex) > 1 && e.seconds != null
  ? Math.max(1, Math.round(e.seconds / nParts(ex))) : valueOf(e));

function fmtSet(e) {
  let s = e.seconds != null ? `${e.seconds}s` : `${e.reps}`;
  if (e.weight) s += `+${e.weight}`;
  return s;
}

function mmss(ms) {
  const tt = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(tt / 3600);
  const m = Math.floor((tt % 3600) / 60);
  const s = String(tt % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function allSets(ctx) {
  const sid = ctx.state.session.id;
  return ctx.state.entries.filter((e) => e.kind === 'set' && e.session_id === sid);
}

function sessionSets(ctx, exId) {
  return allSets(ctx).filter((e) => e.item_id === exId);
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
  if (mine.length) return stepperValueOf(ex, mine[mine.length - 1]);
  const last = lastSessionSets(ctx, ex.id);
  if (last.length) return stepperValueOf(ex, last[0]);
  const step = stepFor(ctx, ex.id);
  return step.reps || ex.start || (ex.type === 'seconds' ? 30 : 10);
}

function draft(ctx, ex) {
  const s = ctx.state.session;
  s.draft = s.draft || {};
  if (!s.draft[ex.id]) {
    const mine = sessionSets(ctx, ex.id);
    const last = mine[mine.length - 1] || lastSessionSets(ctx, ex.id)[0];
    s.draft[ex.id] = { value: startValue(ctx, ex), weight: last?.weight || 0, note: '' };
  }
  return s.draft[ex.id];
}

// When the current rest began: the end of the last set, or the start of
// the session if no set was done yet.
function restFrom(ctx) {
  const s = ctx.state.session;
  if (s.rest_from) return s.rest_from;
  const sets = allSets(ctx);
  return sets.length ? Date.parse(sets[sets.length - 1].ts) : Date.parse(s.started);
}

export function renderTraining(el, ctx) {
  clearInterval(tickTimer);
  if (ctx.state.session) renderSession(el, ctx);
  else {
    keepAwake(false);
    renderStart(el, ctx);
  }
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
        ${last ? `<span class="routine-last">${esc(t('last: {day}', { day: last }))}</span>` : ''}
      </button>`;
    }).join('')}
    <button class="routine free" data-free="1">
      <span class="routine-name">${t('Free session')}</span>
      <span class="routine-ex">${t('Pick exercises as you go')}</span>
    </button>
    <p class="center"><a href="#settings" data-goto="training-settings">${esc(t('Edit exercises & routines'))}</a></p>`;

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
    item_name: routine ? routine.name : t('Free session'),
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
    phase: 'rest',
    work: null,
    rest_from: null,
  };
  try {
    await storage.appendEntry(start);
    ctx.state.session = session;
    await saveSession(ctx);
  } catch (e) {
    ctx.state.session = null;
    ctx.toast(t('Could not start: {msg}', { msg: e.message }), { error: true });
    return;
  }
  ctx.state.entries.push(start);
  ctx.refresh();
  if (!steps.length) openAddExercise(ctx);
}

// --- open session ----------------------------------------------------------
function renderSession(el, ctx) {
  const s = ctx.state.session;
  const prefs = ctx.state.trainingPrefs || { sound: true, restGoal: 90 };
  const working = s.phase === 'work' && s.work;
  const ex = s.current ? exercise(ctx, s.current) : null;
  keepAwake(true);

  const chips = s.steps.map((st) => {
    const n = sessionSets(ctx, st.id).length;
    const done = st.sets && n >= st.sets;
    return `<button class="tr-chip${st.id === s.current ? ' on' : ''}${done ? ' done' : ''}" data-ex="${esc(st.id)}">
      ${esc(exercise(ctx, st.id).name)} <span>${n}${st.sets ? '/' + st.sets : ''}${done ? ' ✓' : ''}</span></button>`;
  }).join('');

  let card = `<div class="empty">${t('Add an exercise to start.')}</div>`;
  if (ex) {
    const step = stepFor(ctx, ex.id);
    const d = draft(ctx, ex);
    const mine = sessionSets(ctx, ex.id);
    const today = todaySets(ctx, ex.id);
    const last = lastSessionSets(ctx, ex.id);
    const parts = nParts(ex) > 1 ? ex.parts : null;
    const unit = ex.type === 'seconds' ? (parts ? t('seconds each') : t('seconds')) : t('reps');
    const lastSet = mine[mine.length - 1];
    const timedRunning = working && s.work.target != null;
    const n = mine.length + 1;
    card = `<div class="card pad tr-card">
      <div class="tr-name">${esc(ex.name)}${step.sets ? `<span class="muted"> ${esc(t('goal {sets} × {reps}', { sets: step.sets, reps: (step.reps || '?') + (ex.type === 'seconds' ? 's' : '') }))}</span>` : ''}</div>
      ${parts ? `<div class="tr-parts">${parts.map((p) => esc(p)).join(' → ')}</div>` : ''}
      <div class="tr-hist">${t('Today:')} <b>${today.length ? today.map(fmtSet).join('  ') : '—'}</b></div>
      <div class="tr-hist muted">${t('Last time')}${last.length ? ` (${esc(friendlyDay(last[0].date))})` : ''}: ${last.length ? last.map(fmtSet).join('  ') : '—'}</div>
      <div class="stepper${timedRunning ? ' locked' : ''}">
        <button class="step-btn" data-step="-1" aria-label="${t('Less')}" ${timedRunning ? 'disabled' : ''}>−</button>
        <button class="step-val" data-act="type-value" ${timedRunning ? 'disabled' : ''}><b>${d.value}</b><small>${unit}</small></button>
        <button class="step-btn" data-step="1" aria-label="${t('More')}" ${timedRunning ? 'disabled' : ''}>+</button>
      </div>
      ${ex.allowWeight ? `<div class="wstep"><span>${t('Extra weight')}</span>
        <button class="ibtn" data-w="-2.5">−</button><b>${d.weight || 0} ${t('kg')}</b><button class="ibtn" data-w="2.5">+</button></div>` : ''}
      <input class="input" data-act="note" value="${esc(d.note || '')}" placeholder="${esc(t('Note for this set (optional)'))}">
      ${working
        ? `<button class="btn primary wide big done-btn" data-act="primary">✓ ${t('Done — log set {n}', { n })}</button>
           <div class="btn-row"><button class="btn" data-act="cancel-set">${t('Cancel set')}</button></div>`
        : `<button class="btn primary wide big" data-act="primary">▶ ${t('Start set {n}', { n })}</button>
           <div class="btn-row">
             <button class="btn" data-act="repeat" ${lastSet ? '' : 'disabled'}>${t('Repeat last')}${lastSet ? ` (${fmtSet(lastSet)})` : ''}</button>
             <button class="btn" data-act="undo" ${lastSet ? '' : 'disabled'}>${t('Undo last set')}</button>
           </div>
           <button class="linklike" data-act="quick-log">${t('Log set {n} without timer', { n })}</button>`}
    </div>`;
  }

  el.innerHTML = `
    <div class="tr-head">
      <div><b>${esc(s.item_name)}</b><br><span class="muted small">${t('started {time}', { time: hhmm(s.started.slice(11, 19)) })} · <span data-elapsed></span></span></div>
      <div class="tr-head-btns">
        <button class="ibtn" data-act="sound" aria-label="${esc(prefs.sound ? t('Sound on') : t('Sound off'))}">${prefs.sound ? '🔔' : '🔕'}</button>
        <button class="btn" data-act="finish">${t('Finish')}</button>
      </div>
    </div>
    <div class="timer-box${working ? ' work' : ''}" data-box>
      <div class="timer-label" data-label></div>
      <div class="timer-big" data-timer>0:00</div>
      <button class="timer-sub" data-act="rest-goal" data-sub></button>
    </div>
    <div class="tr-chips">${chips}<button class="tr-chip add" data-act="add">${t('+ Exercise')}</button></div>
    ${card}`;

  const $ = (sel) => el.querySelector(sel);
  // Keep the current exercise's chip visible in the scrolling row.
  const onChip = el.querySelector('.tr-chip.on');
  if (onChip) {
    const row = onChip.parentElement;
    row.scrollLeft += onChip.getBoundingClientRect().left - row.getBoundingClientRect().left
      - (row.clientWidth - onChip.clientWidth) / 2;
  }
  const tick = () => {
    if (!$('[data-timer]')?.isConnected) { clearInterval(tickTimer); return; }
    $('[data-elapsed]').textContent = mmss(Date.now() - Date.parse(s.started));
    updateTimer(ctx, el);
  };
  tick();
  tickTimer = setInterval(tick, 200);

  $('[data-act="sound"]').addEventListener('click', async () => {
    prefs.sound = !prefs.sound;
    ctx.state.trainingPrefs = prefs;
    setSoundOn(prefs.sound);
    if (prefs.sound) { unlockAudio(); signal('tick'); }
    await storage.setValue('tr_sound', prefs.sound).catch(() => {});
    ctx.refresh();
  });
  $('[data-act="rest-goal"]').addEventListener('click', () => { if (!working) openRestGoal(ctx); });
  el.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => {
    if (working) { ctx.toast(t('Finish or cancel the current set first')); return; }
    s.current = b.dataset.ex;
    saveSession(ctx);
    ctx.refresh();
  }));
  $('[data-act="add"]').addEventListener('click', () => {
    if (working) { ctx.toast(t('Finish or cancel the current set first')); return; }
    openAddExercise(ctx);
  });
  $('[data-act="finish"]').addEventListener('click', () => {
    if (working) { ctx.toast(t('Finish or cancel the current set first')); return; }
    openFinish(ctx);
  });
  if (!ex) return;

  const d = draft(ctx, ex);
  const stepSize = ex.type === 'seconds' ? 5 : 1;
  el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    d.value = Math.max(1, d.value + Number(b.dataset.step) * stepSize);
    $('.step-val b').textContent = d.value;
    saveSession(ctx).catch(() => {});
  }));
  $('[data-act="type-value"]').addEventListener('click', () => {
    const v = Number(prompt(t('How many?'), d.value));
    if (v > 0) { d.value = Math.round(v); $('.step-val b').textContent = d.value; saveSession(ctx).catch(() => {}); }
  });
  el.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
    d.weight = Math.max(0, Math.round(((d.weight || 0) + Number(b.dataset.w)) * 10) / 10);
    $('.wstep b').textContent = `${d.weight} ${t('kg')}`;
    saveSession(ctx).catch(() => {});
  }));
  // Keep the typed note in the draft: the screen re-draws on Start/Done.
  $('[data-act="note"]').addEventListener('input', (e) => { d.note = e.target.value; });

  $('[data-act="primary"]').addEventListener('click', () => {
    const now = Date.now();
    if (now - lastPrimary < PRIMARY_GUARD_MS) { ctx.toast(t('Double tap ignored')); return; }
    lastPrimary = now;
    if (working) finishWork(ctx, now);
    else startWork(ctx, ex);
  });
  if (working) {
    $('[data-act="cancel-set"]').addEventListener('click', async () => {
      s.phase = 'rest';
      s.work = null;
      await saveSession(ctx).catch(() => {});
      ctx.refresh();
    });
    return;
  }
  $('[data-act="repeat"]').addEventListener('click', () => {
    const mine = sessionSets(ctx, ex.id);
    const last = mine[mine.length - 1];
    if (last) logSet(ctx, ex, valueOf(last), last.weight, null, {});
  });
  $('[data-act="undo"]').addEventListener('click', () => undoLastSet(ctx, ex));
  $('[data-act="quick-log"]').addEventListener('click', () => {
    logSet(ctx, ex, d.value * nParts(ex), ex.allowWeight ? d.weight || null : null, d.note?.trim() || null, {});
  });
}

// The big timer: rest (counting up, with the rest goal) or the running set.
function updateTimer(ctx, el) {
  const s = ctx.state.session;
  const prefs = ctx.state.trainingPrefs || { restGoal: 90 };
  const box = el.querySelector('[data-box]');
  const label = el.querySelector('[data-label]');
  const timer = el.querySelector('[data-timer]');
  const sub = el.querySelector('[data-sub]');
  const now = Date.now();

  if (s.phase !== 'work' || !s.work) {
    const from = restFrom(ctx);
    const rested = now - from;
    const hasSets = allSets(ctx).length > 0;
    const goal = prefs.restGoal * 1000;
    const over = hasSets && goal > 0 && rested >= goal;
    label.textContent = over ? t('Rest is over — go!') : hasSets ? t('Rest') : t('Since start');
    timer.textContent = mmss(rested);
    sub.textContent = goal ? `🔔 ${t('Rest goal')} ${mmss(goal)}` : `🔕 ${t('Rest goal')}: ${t('Off')}`;
    box.classList.toggle('ready', over);
    // Beep once per rest, and only if the goal was reached just now (not
    // when reopening the app long after).
    if (over && played.rest !== from && rested < goal + 5000) {
      played.rest = from;
      signal('rest');
    }
    return;
  }

  const w = s.work;
  const ex = exercise(ctx, w.ex);
  if (w.target == null) {
    // Reps: the set time counts up until you tap Done.
    label.textContent = t('Set in progress');
    timer.textContent = mmss(now - w.start);
    sub.textContent = '';
    return;
  }
  if (now < w.start) {
    // "Get ready" before a timed set.
    const left = Math.ceil((w.start - now) / 1000);
    label.textContent = t('Get ready');
    timer.textContent = String(left);
    sub.textContent = nParts(ex) > 1 ? `${t('First:')} ${ex.parts[0]}` : '';
    if (left <= 3 && played.tick !== `${w.start}:lead:${left}`) {
      played.tick = `${w.start}:lead:${left}`;
      signal('tick');
    }
    return;
  }
  const partMs = w.target * 1000;
  const total = partMs * w.nParts;
  const done = now - w.start;
  if (done >= total) {
    finishWork(ctx, w.start + total, true);
    return;
  }
  if (played.go !== w.start && done < 2000) {
    played.go = w.start;
    signal('go');
  }
  const idx = Math.floor(done / partMs);
  const left = partMs * (idx + 1) - done;
  if (idx > 0 && played.part !== `${w.start}:${idx}`) {
    played.part = `${w.start}:${idx}`;
    signal('switch');
  }
  const secLeft = Math.ceil(left / 1000);
  if (secLeft <= 3 && played.tick !== `${w.start}:${idx}:${secLeft}`) {
    played.tick = `${w.start}:${idx}:${secLeft}`;
    signal('tick');
  }
  label.textContent = w.nParts > 1 ? `${ex.parts[idx] || ''} · ${idx + 1}/${w.nParts}` : t('Hold');
  timer.textContent = mmss(left + 999);
  sub.textContent = w.nParts > 1 && idx + 1 < w.nParts ? `${t('Next:')} ${ex.parts[idx + 1]}` : '';
}

async function startWork(ctx, ex) {
  unlockAudio(); // sound is only allowed after a tap — this is the tap
  const s = ctx.state.session;
  const d = draft(ctx, ex);
  const now = Date.now();
  const timed = ex.type === 'seconds';
  const hadSet = allSets(ctx).length > 0;
  s.work = {
    ex: ex.id,
    pressed: now,
    start: timed ? now + LEAD_MS : now,
    target: timed ? d.value : null, // seconds per part
    nParts: nParts(ex),
    // Rest before this set = from the end of the previous set until now.
    rest_sec: hadSet ? Math.round((now - restFrom(ctx)) / 1000) : null,
  };
  s.phase = 'work';
  await saveSession(ctx).catch(() => {});
  if (!timed) signal('go');
  ctx.refresh();
}

// Ends the running set at endMs and logs it.
async function finishWork(ctx, endMs, auto = false) {
  const s = ctx.state.session;
  const w = s?.work;
  if (!w || finishing) return;
  finishing = true;
  try {
    const ex = exercise(ctx, w.ex);
    const d = draft(ctx, ex);
    const workSec = Math.max(0, Math.round((endMs - w.start) / 1000));
    let value = d.value;
    if (w.target != null) {
      // Timed: log the seconds actually done (all of them if it ran out).
      value = Math.min(workSec, w.target * w.nParts);
      if (value <= 0) { // stopped during "get ready": nothing happened
        s.phase = 'rest';
        s.work = null;
        await saveSession(ctx).catch(() => {});
        ctx.refresh();
        return;
      }
    }
    if (auto) {
      signal('end');
      // The big button just turned back into "Start": a tap meant for
      // "Done" a moment too late must not start the next set.
      lastPrimary = Date.now();
    }
    await logSet(ctx, ex, value, ex.allowWeight ? d.weight || null : null, d.note?.trim() || null,
      { work_sec: workSec, rest_sec: w.rest_sec, at: endMs, noGuard: true });
  } finally {
    finishing = false;
  }
}

// Double-tap guard on quick logging: a set takes far longer than this.
const SET_GUARD_MS = 2000;
let lastLogAt = 0;

async function logSet(ctx, ex, value, weight, note, extra) {
  const now = Date.now();
  if (!extra.noGuard && now - lastLogAt < SET_GUARD_MS) { ctx.toast(t('Double tap ignored')); return; }
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
    work_sec: extra.work_sec ?? null,
    rest_sec: extra.rest_sec ?? null,
    note,
  }, new Date(extra.at || now));
  try {
    await storage.appendEntry(rec);
  } catch (e) {
    lastLogAt = 0;
    ctx.toast(t('Set NOT saved: {msg}', { msg: e.message }), { error: true });
    return;
  }
  ctx.state.entries.push(rec);
  if (navigator.vibrate && !extra.noGuard) navigator.vibrate(30);

  // The set is done: rest starts now.
  s.phase = 'rest';
  s.work = null;
  s.rest_from = Date.parse(rec.ts);
  const d = draft(ctx, ex);
  d.note = '';

  // Goal reached: move on to the next exercise that isn't done yet, so the
  // next set is one tap away. "Back" undoes the jump, not the set.
  const step = stepFor(ctx, ex.id);
  let msg = t('{name} set {n}: {v}', { name: ex.name, n, v: fmtSet(rec) });
  let back = null;
  if (step.sets && n === step.sets) {
    const next = s.steps.find((st) => st.id !== ex.id && !(st.sets && sessionSets(ctx, st.id).length >= st.sets));
    if (next) {
      s.current = next.id;
      msg = t('{name} done ✓  Next: {next}', { name: ex.name, next: exercise(ctx, next.id).name });
      back = ex.id;
    }
  }
  saveSession(ctx).catch(() => {});
  ctx.refresh();
  ctx.toast(msg, back ? {
    actionLabel: t('Back'),
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
    ctx.toast(t('Undo failed: {msg}', { msg: e.message }), { error: true });
    return;
  }
  ctx.state.entries = ctx.state.entries.filter((e) => e.id !== last.id);
  // Rest is measured from the set that is now the last one.
  ctx.state.session.rest_from = null;
  saveSession(ctx).catch(() => {});
  lastLogAt = 0;
  ctx.refresh();
  ctx.toast(t('Removed set {n} ({v})', { n: last.set_no, v: fmtSet(last) }));
}

function openRestGoal(ctx) {
  const prefs = ctx.state.trainingPrefs;
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${t('Rest goal')}</b></div>
    <p class="small muted">${esc(t('REST_GOAL_HINT'))}</p>
    <div class="chips">${REST_GOALS.map((g) => `<button class="chip${g === prefs.restGoal ? ' on' : ''}" data-g="${g}">${g ? mmss(g * 1000) : t('Off')}</button>`).join('')}</div>
    <div class="sheet-actions"><button class="btn" data-act="close">${t('Close')}</button></div>`);
  root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', async () => {
    prefs.restGoal = Number(b.dataset.g);
    await storage.setValue('tr_rest_goal', prefs.restGoal).catch(() => {});
    ctx.closeSheet();
    ctx.refresh();
  }));
}

function openAddExercise(ctx) {
  const s = ctx.state.session;
  openExercisePicker(ctx, {
    title: t('Add an exercise'),
    includeOwn: true,
    markIds: s.steps.map((st) => st.id),
    onPick: async (id) => {
      if (!s.steps.some((st) => st.id === id)) s.steps.push({ id, sets: null, reps: null });
      s.current = id;
      await saveSession(ctx).catch(() => {});
      ctx.closeSheet();
      ctx.refresh();
    },
  });
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
      <td>${t('Sets')}: <b>${list.length}</b><br>${t('Total')}: <b>${total}</b> ${secs ? t('sec') : t('reps')}</td></tr>`;
  }).join('')}</table>`;
}

function openFinish(ctx) {
  const s = ctx.state.session;
  const sets = allSets(ctx);
  if (!sets.length) {
    const root = ctx.openSheet(`
      <div class="sheet-head"><b>${t('No sets logged')}</b></div>
      <p>${t('Discard this empty session?')}</p>
      <div class="sheet-actions"><button class="btn" data-act="keep">${t('Keep training')}</button>
      <button class="btn primary" data-act="discard">${t('Discard')}</button></div>`);
    root.querySelector('[data-act="keep"]').addEventListener('click', () => ctx.closeSheet());
    root.querySelector('[data-act="discard"]').addEventListener('click', async () => {
      try {
        await storage.deleteEntry(s.id);
        await storage.setValue(KEY, null);
      } catch (e) {
        ctx.toast(t('Failed: {msg}', { msg: e.message }), { error: true });
        return;
      }
      ctx.state.entries = ctx.state.entries.filter((e) => e.id !== s.id);
      ctx.state.session = null;
      keepAwake(false);
      ctx.closeSheet();
      ctx.refresh();
    });
    return;
  }
  const mins = Math.round((Date.now() - Date.parse(s.started)) / 60000);
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${esc(t('Finish {name}?', { name: s.item_name }))}</b><span class="muted">${t('{n} min', { n: mins })}</span></div>
    ${summaryHtml(ctx, sets)}
    <div class="sheet-actions"><button class="btn" data-act="keep">${t('Keep training')}</button>
    <button class="btn primary" data-act="confirm-finish">${t('Finish')}</button></div>`);
  root.querySelector('[data-act="keep"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelector('[data-act="confirm-finish"]').addEventListener('click', async () => {
    const end = makeRecord({ kind: 'session_end', item_id: s.item_id, item_name: s.item_name, session_id: s.id });
    end.duration_min = mins;
    try {
      await storage.appendEntry(end);
      await storage.setValue(KEY, null);
    } catch (e) {
      ctx.toast(t('Failed: {msg}', { msg: e.message }), { error: true });
      return;
    }
    ctx.state.entries.push(end);
    ctx.state.session = null;
    keepAwake(false);
    ctx.refresh();
    const done = ctx.openSheet(`
      <div class="sheet-head"><b>${t('Well done! 💪')}</b><span class="muted">${esc(s.item_name)} · ${t('{n} min', { n: mins })}</span></div>
      ${summaryHtml(ctx, sets)}
      <div class="sheet-actions"><button class="btn primary" data-act="close">${t('Close')}</button></div>`);
    done.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
  });
}

