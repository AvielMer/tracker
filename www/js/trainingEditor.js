// Add / edit exercises and routines. Everything is saved into the config
// (validated first), nothing is hardcoded.

import {
  circuitParts, isCircuit, makeId, routineSteps, saveConfig,
} from './config.js';
import { libName, loadLibrary } from './library.js';
import { esc } from './util.js';
import { getLang, t } from './i18n.js';

async function commit(ctx, mutate, okMsg) {
  if (ctx.state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return false;
  const cfg = JSON.parse(JSON.stringify(ctx.state.config));
  if (mutate(cfg) === false) return false;
  const res = await saveConfig(cfg);
  if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return false; }
  ctx.closeSheet();
  await ctx.reloadConfig();
  if (okMsg) ctx.toast(okMsg);
  return true;
}

// ex = existing exercise, or null for a new one. Circuits have their own
// editor (each exercise in the circuit with its own seconds).
export function openExerciseEditor(ctx, ex) {
  if (isCircuit(ex)) { openCircuitEditor(ctx, ex); return; }
  const isNew = !ex;
  const cur = ex || { name: '', type: 'reps' };
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${isNew ? t('Add an exercise') : t('Edit exercise')}</b></div>
    <div class="label">${t('Name')}</div>
    <input class="input" data-f="name" value="${esc(cur.name)}" placeholder="${esc(t('e.g. Muscle-ups'))}">
    <div class="label" style="margin-top:10px">${t('Counted in')}</div>
    <label class="check"><input type="radio" name="extype" value="reps" ${cur.type !== 'seconds' ? 'checked' : ''}> ${t('Reps')}</label>
    <label class="check"><input type="radio" name="extype" value="seconds" ${cur.type === 'seconds' ? 'checked' : ''}> ${t('Seconds (holds, e.g. plank)')}</label>
    <div class="ask-cfg" data-circuit-tip ${cur.type === 'seconds' ? '' : 'hidden'}>
      <div class="small muted">${esc(t('CIRCUIT_TIP'))}</div>
      <button class="btn" data-act="to-circuit">⏱ ${t('+ New circuit')}</button>
    </div>
    <label class="check"><input type="checkbox" data-f="weight" ${cur.allowWeight ? 'checked' : ''}> ${t('Can add extra weight (kg)')}</label>
    <div class="label" style="margin-top:10px">${t('Start number')}</div>
    <input class="input" data-f="start" inputmode="numeric" value="${esc(cur.start ?? '')}" placeholder="${esc(t('e.g. 10'))}">
    <div class="small muted">${esc(t('START_HINT'))}</div>
    <div class="sheet-actions">
      <button class="btn" data-act="cancel">${t('Cancel')}</button>
      <button class="btn primary" data-act="save">${isNew ? t('Add') : t('Save')}</button>
    </div>`);
  const f = (k) => root.querySelector(`[data-f="${k}"]`);
  root.querySelectorAll('input[name="extype"]').forEach((r) => r.addEventListener('change', () => {
    root.querySelector('[data-circuit-tip]').hidden = root.querySelector('input[name="extype"]:checked').value !== 'seconds';
  }));
  root.querySelector('[data-act="to-circuit"]').addEventListener('click', () => openCircuitEditor(ctx, null, { name: f('name').value.trim() }));
  root.querySelector('[data-act="cancel"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelector('[data-act="save"]').addEventListener('click', () => {
    const name = f('name').value.trim();
    if (!name) { ctx.toast(t('Type a name first')); return; }
    const startRaw = f('start').value.trim();
    const start = startRaw ? Number(startRaw) : null;
    if (startRaw && !(start > 0)) { ctx.toast(t('Start number must be a number')); return; }
    const type = root.querySelector('input[name="extype"]:checked').value;
    commit(ctx, (cfg) => {
      // Start from the existing item so other keys (e.g. "hidden") survive.
      const item = isNew ? { id: makeId(cfg.exercises, name) } : cfg.exercises.find((x) => x.id === ex.id);
      if (!item) return false;
      item.name = name;
      item.type = type;
      if (f('weight').checked) item.allowWeight = true; else delete item.allowWeight;
      if (start) item.start = Math.round(start); else delete item.start;
      if (isNew) cfg.exercises.push(item);
      return true;
    }, t(isNew ? 'Added "{name}"' : 'Saved "{name}"', { name }));
  });
}

function mmss(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function circuitRow(p = { name: '', seconds: 30 }) {
  return `<div class="crow">
    <input class="input" data-cn list="circuit-names" value="${esc(p.name)}" placeholder="${esc(t('e.g. Plank'))}">
    <input class="input mini" data-cs inputmode="numeric" value="${esc(p.seconds ?? 30)}" aria-label="${esc(t('seconds'))}">
    <span class="muted">${t('sec')}</span>
    <button class="ibtn" data-cup aria-label="${esc(t('Move up'))}">↑</button>
    <button class="ibtn" data-cdel aria-label="${esc(t('Remove'))}">✕</button>
  </div>`;
}

// A circuit: several exercises in a row without stopping, each with its own
// seconds, a beep at every switch. Optional rounds (repeat the list) and a
// pause between exercises. ex = existing circuit or null for a new one.
// opts.onSaved(id) runs after saving (e.g. to start it in the workout);
// opts.name pre-fills the name.
export async function openCircuitEditor(ctx, ex, opts = {}) {
  const isNew = !ex;
  let lib = null;
  try { lib = await loadLibrary(); } catch { /* suggestions only */ }
  const lang = getLang();
  const suggestions = [...new Set([
    ...ctx.state.config.exercises.filter((x) => !isCircuit(x)).map((x) => x.name),
    ...(lib ? lib.exercises.filter((e) => !e.parts).map((e) => libName(e, lang)) : []),
  ])];
  const parts = isNew ? [{ name: '', seconds: 30 }, { name: '', seconds: 30 }]
    : circuitParts(ex, ex.start || 30);
  let rounds = ex?.rounds || 1;
  let pause = ex?.pause || 0;

  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${isNew ? t('New circuit') : t('Edit circuit')}</b></div>
    <div class="small muted">${esc(t('CIRCUIT_HINT'))}</div>
    <div class="label" style="margin-top:10px">${t('Name')}</div>
    <input class="input" data-f="name" value="${esc(ex?.name || opts.name || '')}" placeholder="${esc(t('e.g. Core circuit'))}">
    <div class="label" style="margin-top:10px">${t('Exercises in a row — seconds each')}</div>
    <div data-clist>${parts.map(circuitRow).join('')}</div>
    <datalist id="circuit-names">${suggestions.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <button class="btn" data-cadd>${t('+ Add an exercise to the circuit')}</button>
    <div class="cfg-row">
      <span>${t('Rounds')}</span>
      <button class="ibtn" data-rounds="-1">−</button><b data-rounds-v>${rounds}</b><button class="ibtn" data-rounds="1">+</button>
    </div>
    <div class="cfg-row">
      <span>${t('Pause between exercises')}</span>
      <button class="ibtn" data-pause="-5">−</button><b data-pause-v>${pause} ${t('sec')}</b><button class="ibtn" data-pause="5">+</button>
    </div>
    <p class="circuit-total" data-total></p>
    <div class="sheet-actions">
      <button class="btn" data-act="cancel">${t('Cancel')}</button>
      <button class="btn primary" data-act="save">${isNew ? t('Add') : t('Save')}</button>
    </div>`);

  const list = root.querySelector('[data-clist]');
  const read = () => [...list.querySelectorAll('.crow')].map((row) => ({
    name: row.querySelector('[data-cn]').value.trim(),
    seconds: Number(row.querySelector('[data-cs]').value.replace(/[^0-9]/g, '')),
  }));
  const updateTotal = () => {
    const ps = read().filter((p) => p.name && p.seconds > 0);
    const n = ps.length;
    const total = n ? rounds * ps.reduce((a, p) => a + p.seconds, 0) + pause * Math.max(0, n * rounds - 1) : 0;
    root.querySelector('[data-total]').textContent = t('Total: {t}', { t: mmss(total) });
  };
  list.addEventListener('input', updateTotal);
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.crow');
    if (e.target.closest('[data-cdel]')) row.remove();
    else if (e.target.closest('[data-cup]') && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
    updateTotal();
  });
  root.querySelector('[data-cadd]').addEventListener('click', () => {
    const last = read().pop();
    list.insertAdjacentHTML('beforeend', circuitRow({ name: '', seconds: last?.seconds || 30 }));
    list.lastElementChild.querySelector('[data-cn]').focus();
    updateTotal();
  });
  root.querySelectorAll('[data-rounds]').forEach((b) => b.addEventListener('click', () => {
    rounds = Math.min(50, Math.max(1, rounds + Number(b.dataset.rounds)));
    root.querySelector('[data-rounds-v]').textContent = rounds;
    updateTotal();
  }));
  root.querySelectorAll('[data-pause]').forEach((b) => b.addEventListener('click', () => {
    pause = Math.min(600, Math.max(0, pause + Number(b.dataset.pause)));
    root.querySelector('[data-pause-v]').textContent = `${pause} ${t('sec')}`;
    updateTotal();
  }));
  updateTotal();

  root.querySelector('[data-act="cancel"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const name = root.querySelector('[data-f="name"]').value.trim();
    if (!name) { ctx.toast(t('Type a name first')); return; }
    const ps = read().filter((p) => p.name);
    if (!ps.length) { ctx.toast(t('Add at least one exercise with its seconds')); return; }
    if (ps.some((p) => !(p.seconds >= 1 && p.seconds <= 3600))) { ctx.toast(t('Seconds must be a number from 1 to 3600')); return; }
    let id = ex?.id;
    const ok = await commit(ctx, (cfg) => {
      // Start from the existing item so other keys (e.g. "hidden") survive.
      const item = isNew ? { id: makeId(cfg.exercises, name) } : cfg.exercises.find((x) => x.id === ex.id);
      if (!item) return false;
      id = item.id;
      item.name = name;
      item.type = 'seconds';
      item.parts = ps.map((p) => ({ name: p.name, seconds: p.seconds }));
      if (rounds > 1) item.rounds = rounds; else delete item.rounds;
      if (pause > 0) item.pause = pause; else delete item.pause;
      delete item.allowWeight;
      if (isNew) cfg.exercises.push(item);
      return true;
    }, t(isNew ? 'Added "{name}"' : 'Saved "{name}"', { name }));
    if (ok && opts.onSaved) opts.onSaved(id);
  });
}

// r = existing routine, or null for a new one.
export function openRoutineEditor(ctx, r) {
  const isNew = !r;
  const exercises = ctx.state.config.exercises;
  const exName = (id) => (exercises.find((x) => x.id === id) || { name: id }).name;
  const steps = r ? routineSteps(r) : [];
  let name = r ? r.name : '';

  const root = ctx.openSheet('');
  const render = () => {
    root.innerHTML = `
      <div class="sheet-head"><b>${isNew ? t('New routine') : t('Edit routine')}</b>
        ${isNew ? '' : `<button class="btn danger" data-act="delete">${t('Delete')}</button>`}</div>
      <div class="label">${t('Name')}</div>
      <input class="input" data-f="name" value="${esc(name)}" placeholder="${esc(t('e.g. Monday'))}">
      <div class="label" style="margin-top:10px">${esc(t('ROUTINE_STEPS_LABEL'))}</div>
      ${steps.length ? '' : `<p class="muted small">${t('No exercises yet — add some below.')}</p>`}
      ${steps.map((s, i) => `<div class="rstep" data-i="${i}">
        <span class="rstep-name">${esc(exName(s.id))}</span>
        <input class="input mini" data-k="sets" inputmode="numeric" value="${s.sets ?? ''}" placeholder="${t('sets')}" aria-label="${t('sets')}">
        <span class="muted">×</span>
        <input class="input mini" data-k="reps" inputmode="numeric" value="${s.reps ?? ''}" placeholder="${t('reps')}" aria-label="${t('reps')}">
        <button class="ibtn" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="${t('Move up')}">↑</button>
        <button class="ibtn" data-rm="1" aria-label="${t('Remove')}">✕</button>
      </div>`).join('')}
      <div class="add-row">
        <select class="input" data-f="pick">
          <option value="">${t('+ Add exercise…')}</option>
          ${exercises.filter((x) => !x.hidden).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}
        </select>
      </div>
      <div class="sheet-actions">
        <button class="btn" data-act="cancel">${t('Cancel')}</button>
        <button class="btn primary" data-act="save">${isNew ? t('Add routine') : t('Save')}</button>
      </div>`;

    root.querySelector('[data-f="name"]').addEventListener('input', (e) => { name = e.target.value; });
    root.querySelectorAll('.rstep').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
        const v = parseInt(inp.value, 10);
        steps[i][inp.dataset.k] = v > 0 ? v : null;
      }));
      row.querySelector('[data-mv]').addEventListener('click', () => {
        [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
        render();
      });
      row.querySelector('[data-rm]').addEventListener('click', () => { steps.splice(i, 1); render(); });
    });
    root.querySelector('[data-f="pick"]').addEventListener('change', (e) => {
      if (!e.target.value) return;
      const ex = exercises.find((x) => x.id === e.target.value);
      steps.push({ id: ex.id, sets: 3, reps: ex.start ?? null });
      render();
    });
    root.querySelector('[data-act="cancel"]').addEventListener('click', () => ctx.closeSheet());
    root.querySelector('[data-act="save"]').addEventListener('click', () => {
      if (!name.trim()) { ctx.toast(t('Type a name first')); return; }
      if (!steps.length) { ctx.toast(t('Add at least one exercise')); return; }
      commit(ctx, (cfg) => {
        const item = isNew ? { id: makeId(cfg.routines, name) } : cfg.routines.find((x) => x.id === r.id);
        if (!item) return false;
        item.name = name.trim();
        item.exercises = steps.map((s) => {
          if (!s.sets && !s.reps) return s.id;
          const o = { id: s.id };
          if (s.sets) o.sets = s.sets;
          if (s.reps) o.reps = s.reps;
          return o;
        });
        if (isNew) cfg.routines.push(item);
        return true;
      }, t(isNew ? 'Added "{name}"' : 'Saved "{name}"', { name: name.trim() }));
    });
    const del = root.querySelector('[data-act="delete"]');
    if (del) del.addEventListener('click', () => {
      // A routine is only a template: deleting it never touches logged sets.
      if (!confirm(t('Delete routine "{name}"? Your logged workouts are kept.', { name: r.name }))) return;
      commit(ctx, (cfg) => { cfg.routines = cfg.routines.filter((x) => x.id !== r.id); return true; }, t('Routine deleted'));
    });
  };
  render();
}
