// Pick an exercise: search your own exercises and the built-in library,
// create a new one just by typing its name, or make a new circuit. Used
// during a workout ("+ Exercise") and in Settings ("+ Add from library").

import { makeId, saveConfig } from './config.js';
import {
  findInConfig, fromLibrary, libName, loadLibrary, normName,
} from './library.js';
import { openCircuitEditor } from './trainingEditor.js';
import { esc } from './util.js';
import { getLang, t } from './i18n.js';

// opts.onPick(id): called with the chosen exercise's id once it exists in
//   the config (library items and new names are added first). Without
//   onPick the sheet stays open so several can be added in a row.
// opts.includeOwn: also list your own exercises (during a workout).
// opts.markIds: ids to mark "(in session)".
export async function openExercisePicker(ctx, opts = {}) {
  let lib = { categories: [], exercises: [] };
  try { lib = await loadLibrary(); } catch { /* offline first run: own + create still work */ }
  const lang = getLang();
  let query = '';

  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${esc(opts.title || t('Add an exercise'))}</b>
      <button class="btn" data-act="close">${t('Close')}</button></div>
    <input class="input" data-q type="search" autocomplete="off" placeholder="${esc(t('Search or type a new name…'))}">
    <button class="btn wide" data-act="new-circuit">⏱ ${t('+ New circuit (several exercises in a row)')}</button>
    <div class="pick-results" data-results></div>`);
  root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
  // The circuit editor replaces this sheet; a saved circuit is picked like
  // any other exercise (during a workout it becomes the current one).
  root.querySelector('[data-act="new-circuit"]').addEventListener('click', () => openCircuitEditor(ctx, null, {
    onSaved: (id) => opts.onPick?.(id),
  }));

  // Adds exercises to the config (validated like every other change).
  const addToConfig = async (ex) => {
    if (ctx.state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return null;
    const cfg = JSON.parse(JSON.stringify(ctx.state.config));
    cfg.exercises.push(ex);
    const res = await saveConfig(cfg);
    if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return null; }
    await ctx.reloadConfig();
    return ex.id;
  };

  const picked = async (id, name) => {
    if (!id) return;
    if (opts.onPick) { opts.onPick(id); return; }
    ctx.toast(t('Added "{name}"', { name }));
    draw();
  };

  // Your exercise matches the search by its own name, and — if it is a
  // library exercise — by its name in every language ("plank" finds
  // "פלאנק").
  const ownNames = (x) => {
    const n = normName(x.name);
    const entry = lib.exercises.find((e) => e.id === x.id)
      || lib.exercises.find((e) => Object.values(e.name).some((v) => normName(v) === n));
    return [n, ...(entry ? Object.values(entry.name).map(normName) : [])];
  };

  const draw = () => {
    const cfg = ctx.state.config;
    const q = normName(query);
    const own = opts.includeOwn
      ? cfg.exercises.filter((x) => !x.hidden && (!q || ownNames(x).some((n) => n.includes(q)))) : [];
    const libItems = lib.exercises.filter((e) => !findInConfig(cfg, e)
      && (!q || Object.values(e.name).some((n) => normName(n).includes(q))));
    const mark = new Set(opts.markIds || []);
    let html = '';
    if (own.length) {
      html += `<div class="label">${t('Your exercises')}</div><div class="pick-list">${own.map((x) =>
        `<button class="btn" data-own="${esc(x.id)}">${esc(x.name)}${x.type === 'seconds' ? ' <span class="tag">⏱</span>' : ''}${mark.has(x.id) ? ` <span class="muted small">${t('(in session)')}</span>` : ''}</button>`).join('')}</div>`;
    }
    for (const cat of lib.categories) {
      const items = libItems.filter((e) => e.cat === cat.id);
      if (!items.length) continue;
      html += `<div class="label">${esc(cat.name[lang] || cat.name.en)}</div><div class="pick-list">${items.map((e) =>
        `<button class="btn lib" data-lib="${esc(e.id)}">${esc(libName(e, lang))}${e.type === 'seconds' ? ' <span class="tag">⏱</span>' : ''}</button>`).join('')}</div>`;
    }
    const exact = cfg.exercises.some((x) => normName(x.name) === q)
      || lib.exercises.some((e) => Object.values(e.name).some((n) => normName(n) === q));
    if (query.trim() && !exact) {
      html += `<div class="label">${esc(t('Create "{name}" — counted in:', { name: query.trim() }))}</div>
        <div class="btn-row"><button class="btn primary" data-new="reps">${t('Reps')}</button>
        <button class="btn primary" data-new="seconds">${t('Seconds')}</button></div>`;
    }
    if (!html) html = `<p class="muted">${t('Nothing found.')}</p>`;
    const results = root.querySelector('[data-results]');
    results.innerHTML = html;

    results.querySelectorAll('[data-own]').forEach((b) => b.addEventListener('click', () => {
      const x = cfg.exercises.find((e) => e.id === b.dataset.own);
      picked(x?.id, x?.name);
    }));
    results.querySelectorAll('[data-lib]').forEach((b) => b.addEventListener('click', async () => {
      const entry = lib.exercises.find((e) => e.id === b.dataset.lib);
      const ex = fromLibrary(entry, ctx.state.config.exercises, lang);
      picked(await addToConfig(ex), ex.name);
    }));
    results.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', async () => {
      const name = query.trim();
      const ex = { id: makeId(ctx.state.config.exercises, name), name, type: b.dataset.new };
      query = '';
      root.querySelector('[data-q]').value = '';
      picked(await addToConfig(ex), name);
    }));
  };

  root.querySelector('[data-q]').addEventListener('input', (e) => { query = e.target.value; draw(); });
  draw();
}
