// Settings: export/import, manage events, config file status.

import * as storage from './storage.js';
import {
  addMissingPresets, eventLabel, getConfigText, resetToDefault, saveConfig, saveConfigText,
} from './config.js';
import { openEventEditor } from './eventEditor.js';
import { openExerciseEditor, openRoutineEditor } from './trainingEditor.js';
import { parseBackup, toBackup, toCSV } from './exporter.js';
import { downloadFile, esc, localDate, readFileText } from './util.js';

export async function renderSettings(el, ctx) {
  const { state } = ctx;
  const persisted = await storage.isPersisted();
  const events = state.config.events;
  const nEvents = state.entries.filter((e) => e.kind === 'event').length;

  el.innerHTML = `
  <h2 class="day">Your data</h2>
  <div class="card pad">
    <p>${state.entries.length} entries saved on this phone (${nEvents} events).</p>
    <p class="small ${persisted ? 'ok' : 'warn'}">${persisted
      ? '✓ Protected storage: the browser won\'t delete your data to free space.'
      : '⚠ Storage not protected yet. Install the app to the home screen, then tap "Protect".'}</p>
    ${persisted ? '' : '<button class="btn" data-act="persist">Protect</button>'}
    <div class="btn-row">
      <button class="btn" data-act="csv">Export CSV</button>
      <button class="btn" data-act="backup">Full backup (JSON)</button>
    </div>
    <label class="btn wide file">Import / restore backup<input type="file" accept=".json,.jsonl,application/json" data-act="import" hidden></label>
  </div>

  <h2 class="day">Event buttons</h2>
  ${manageList('events', events, (ev) => esc(eventLabel(ev)) + (ev.private ? ' <span class="tag">private</span>' : ''))}
  <button class="btn primary wide" data-act="add">+ Add a button</button>
  <p class="small muted">✎ changes a button's name and what it asks after a tap (type, amount, how many, duration…).</p>

  <h2 class="day" id="training-settings">Exercises</h2>
  ${manageList('exercises', state.config.exercises, (x) => esc(x.name)
    + (x.type === 'seconds' ? ' <span class="tag">seconds</span>' : '')
    + (x.allowWeight ? ' <span class="tag">+kg</span>' : ''))}
  <button class="btn primary wide" data-act="add-ex">+ Add an exercise</button>

  <h2 class="day">Routines</h2>
  ${manageList('routines', state.config.routines, (r) => esc(r.name)
    + ` <span class="tag">${(r.exercises || []).length} exercises</span>`)}
  <button class="btn primary wide" data-act="add-routine">+ New routine</button>
  <button class="btn wide" data-act="presets">Add missing preset exercises &amp; routines</button>

  <h2 class="day">Config file</h2>
  <div class="card pad">
    ${state.configErrors.length
      ? `<p class="warn">⚠ Config has problems — using the last good version.</p><ul class="errors">${state.configErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
      : '<p class="ok small">✓ Config OK.</p>'}
    <p class="small muted">${events.length} events, ${state.config.exercises.length} exercises, ${state.config.routines.length} routines. A JSON editor comes in step 4.</p>
    <div class="btn-row">
      <button class="btn" data-act="cfg-export">Export config</button>
      <label class="btn file">Import config<input type="file" accept=".json,application/json" data-act="cfg-import" hidden></label>
    </div>
    <button class="btn wide danger" data-act="cfg-reset">Reset config to default</button>
  </div>
  <p class="small muted center">Tracker · step 2 + 3</p>`;

  // Scroll target from the Training screen's "Edit exercises & routines".
  if (ctx.state.scrollTo) {
    const t = el.querySelector('#' + ctx.state.scrollTo);
    ctx.state.scrollTo = null;
    if (t) t.scrollIntoView();
  }

  const on = (act, fn, evt = 'click') => {
    const n = el.querySelector(`[data-act="${act}"]`);
    if (n) n.addEventListener(evt, fn);
  };

  on('persist', async () => {
    const ok = await storage.requestPersistence();
    ctx.toast(ok ? 'Storage protected' : 'Browser said no — install the app to the home screen first');
    ctx.refresh();
  });

  on('csv', () => {
    downloadFile(`tracker_log_${localDate()}.csv`, toCSV(state.entries), 'text/csv;charset=utf-8');
  });

  on('backup', async () => {
    const text = toBackup(state.entries, await getConfigText());
    downloadFile(`tracker_backup_${localDate()}.json`, text, 'application/json');
  });

  on('import', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { records, invalid, configText } = parseBackup(await readFileText(file));
      // Merge, never replace: entries already on the phone are kept, so
      // importing an older backup can't erase newer data.
      const { added, skipped } = await storage.mergeEntries(records);
      let msg = `Imported ${added} new entries` + (skipped ? `, ${skipped} already here` : '') + (invalid ? `, ${invalid} unreadable skipped` : '');
      if (configText && confirm('The backup also contains a config (your events, exercises, routines). Replace your current config with it?')) {
        const res = await saveConfigText(configText);
        msg += res.ok ? '. Config restored.' : `. Config NOT restored: ${res.errors[0]}`;
      }
      await ctx.reloadAll();
      ctx.toast(msg);
    } catch (err) {
      ctx.toast(`Import failed: ${err.message}`, { error: true });
    }
  }, 'change');

  // --- event manager ---
  // Every change goes through saveConfig(), which validates first, so the
  // in-app editor can never produce a config that breaks the app.
  const change = async (mutate) => {
    if (state.configErrors.length && !confirm('Your saved config has errors. Changing events here will replace it with the last good version plus this change. Continue?')) return;
    const cfg = JSON.parse(JSON.stringify(state.config));
    if (mutate(cfg) === false) return;
    const res = await saveConfig(cfg);
    if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return; }
    await ctx.reloadConfig();
  };

  el.querySelectorAll('.mrow').forEach((row) => {
    const i = Number(row.dataset.i);
    const key = row.dataset.list;
    row.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      const item = state.config[key][i];
      if (act === 'edit') {
        if (key === 'events') openEventEditor(ctx, item);
        else if (key === 'exercises') openExerciseEditor(ctx, item);
        else openRoutineEditor(ctx, item);
        return;
      }
      change((cfg) => {
        const list = cfg[key];
        if (act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        else if (act === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
        else if (act === 'hide') list[i].hidden = !list[i].hidden;
        else return false;
        return true;
      });
    });
  });

  on('add', () => openEventEditor(ctx, null));
  on('add-ex', () => openExerciseEditor(ctx, null));
  on('add-routine', () => openRoutineEditor(ctx, null));
  on('presets', async () => {
    try {
      const n = await addMissingPresets(state.config);
      if (n) await ctx.reloadConfig();
      ctx.toast(n ? `Added ${n} presets` : 'You already have all presets');
    } catch (err) {
      ctx.toast(`Failed: ${err.message}`, { error: true });
    }
  });

  on('cfg-export', async () => {
    downloadFile('tracker_config.json', await getConfigText(), 'application/json');
  });

  on('cfg-import', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const res = await saveConfigText(await readFileText(file));
    if (res.ok) { await ctx.reloadConfig(); ctx.toast('Config imported'); }
    else ctx.toast(`Config NOT imported: ${res.errors.slice(0, 3).join('; ')}`, { error: true, ms: 8000 });
  }, 'change');

  on('cfg-reset', async () => {
    if (!confirm('Replace your config with the default one? Your log entries are NOT affected, but events you added will disappear from the buttons (export the config first to keep them).')) return;
    const res = await resetToDefault().catch((err) => ({ ok: false, errors: [err.message] }));
    if (res.ok) { await ctx.reloadConfig(); ctx.toast('Config reset'); }
    else ctx.toast(`Reset failed: ${res.errors[0]}`, { error: true });
  });
}

// One management list: rows with move up/down, edit and hide/show.
function manageList(key, items, label) {
  if (!items.length) return '<div class="card pad muted">None yet.</div>';
  return `<div class="card">${items.map((it, i) => `
    <div class="mrow${it.hidden ? ' dim' : ''}" data-list="${key}" data-i="${i}">
      <span class="mname">${label(it)}${it.hidden ? ' <span class="tag">hidden</span>' : ''}</span>
      <button class="ibtn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button class="ibtn" data-act="down" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      <button class="ibtn" data-act="edit" aria-label="Edit">✎</button>
      <button class="ibtn" data-act="hide">${it.hidden ? 'Show' : 'Hide'}</button>
    </div>`).join('')}</div>`;
}
