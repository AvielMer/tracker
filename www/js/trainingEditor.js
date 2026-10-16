// Add / edit exercises and routines. Everything is saved into the config
// (validated first), nothing is hardcoded.

import { makeId, routineSteps, saveConfig } from './config.js';
import { esc } from './util.js';

async function commit(ctx, mutate, okMsg) {
  if (ctx.state.configErrors.length && !confirm('Your saved config has errors. Saving here will replace it with the last good version plus this change. Continue?')) return false;
  const cfg = JSON.parse(JSON.stringify(ctx.state.config));
  if (mutate(cfg) === false) return false;
  const res = await saveConfig(cfg);
  if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return false; }
  ctx.closeSheet();
  await ctx.reloadConfig();
  if (okMsg) ctx.toast(okMsg);
  return true;
}

// ex = existing exercise, or null for a new one.
export function openExerciseEditor(ctx, ex) {
  const isNew = !ex;
  const cur = ex || { name: '', type: 'reps' };
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${isNew ? 'Add an exercise' : 'Edit exercise'}</b></div>
    <div class="label">Name</div>
    <input class="input" data-f="name" value="${esc(cur.name)}" placeholder="e.g. Muscle-ups">
    <div class="label" style="margin-top:10px">Counted in</div>
    <label class="check"><input type="radio" name="extype" value="reps" ${cur.type !== 'seconds' ? 'checked' : ''}> Reps</label>
    <label class="check"><input type="radio" name="extype" value="seconds" ${cur.type === 'seconds' ? 'checked' : ''}> Seconds (holds, e.g. plank)</label>
    <label class="check"><input type="checkbox" data-f="weight" ${cur.allowWeight ? 'checked' : ''}> Can add extra weight (kg)</label>
    <div class="label" style="margin-top:10px">Start number</div>
    <input class="input" data-f="start" inputmode="numeric" value="${esc(cur.start ?? '')}" placeholder="e.g. 10">
    <div class="small muted">Where the +/− starts the very first time. After that it starts from what you did last.</div>
    <div class="sheet-actions">
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn primary" data-act="save">${isNew ? 'Add' : 'Save'}</button>
    </div>`);
  const f = (k) => root.querySelector(`[data-f="${k}"]`);
  root.querySelector('[data-act="cancel"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelector('[data-act="save"]').addEventListener('click', () => {
    const name = f('name').value.trim();
    if (!name) { ctx.toast('Type a name first'); return; }
    const startRaw = f('start').value.trim();
    const start = startRaw ? Number(startRaw) : null;
    if (startRaw && !(start > 0)) { ctx.toast('Start number must be a number'); return; }
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
    }, `${isNew ? 'Added' : 'Saved'} "${name}"`);
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
      <div class="sheet-head"><b>${isNew ? 'New routine' : 'Edit routine'}</b>
        ${isNew ? '' : '<button class="btn danger" data-act="delete">Delete</button>'}</div>
      <div class="label">Name</div>
      <input class="input" data-f="name" value="${esc(name)}" placeholder="e.g. Monday">
      <div class="label" style="margin-top:10px">Exercises — goal sets × reps (or seconds), both optional</div>
      ${steps.length ? '' : '<p class="muted small">No exercises yet — add some below.</p>'}
      ${steps.map((s, i) => `<div class="rstep" data-i="${i}">
        <span class="rstep-name">${esc(exName(s.id))}</span>
        <input class="input mini" data-k="sets" inputmode="numeric" value="${s.sets ?? ''}" placeholder="sets" aria-label="sets">
        <span class="muted">×</span>
        <input class="input mini" data-k="reps" inputmode="numeric" value="${s.reps ?? ''}" placeholder="reps" aria-label="reps">
        <button class="ibtn" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button class="ibtn" data-rm="1" aria-label="Remove">✕</button>
      </div>`).join('')}
      <div class="add-row">
        <select class="input" data-f="pick">
          <option value="">+ Add exercise…</option>
          ${exercises.filter((x) => !x.hidden).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}
        </select>
      </div>
      <div class="sheet-actions">
        <button class="btn" data-act="cancel">Cancel</button>
        <button class="btn primary" data-act="save">${isNew ? 'Add routine' : 'Save'}</button>
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
      if (!name.trim()) { ctx.toast('Type a name first'); return; }
      if (!steps.length) { ctx.toast('Add at least one exercise'); return; }
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
      }, `${isNew ? 'Added' : 'Saved'} "${name.trim()}"`);
    });
    const del = root.querySelector('[data-act="delete"]');
    if (del) del.addEventListener('click', () => {
      // A routine is only a template: deleting it never touches logged sets.
      if (!confirm(`Delete routine "${r.name}"? Your logged workouts are kept.`)) return;
      commit(ctx, (cfg) => { cfg.routines = cfg.routines.filter((x) => x.id !== r.id); return true; }, 'Routine deleted');
    });
  };
  render();
}
