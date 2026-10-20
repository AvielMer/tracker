// Settings: export/import, manage events, config file status.

import * as storage from './storage.js';
import {
  addMissingPresets, eventLabel, getConfigText, resetToDefault, saveConfig, saveConfigText,
} from './config.js';
import { openEventEditor } from './eventEditor.js';
import { openExerciseEditor, openRoutineEditor } from './trainingEditor.js';
import { openExercisePicker } from './exercisePicker.js';
import { translateBuiltInNames } from './library.js';
import { parseBackup, toBackup, toCSV } from './exporter.js';
import { downloadFile, esc, localDate, readFileText } from './util.js';
import {
  getDirPref, getLang, LANGS, setDirPref, setLang, t,
} from './i18n.js';

export async function renderSettings(el, ctx) {
  const { state } = ctx;
  const persisted = await storage.isPersisted();
  const events = state.config.events;
  const nEvents = state.entries.filter((e) => e.kind === 'event').length;

  el.innerHTML = `
  <h2 class="day">${t('Language')}</h2>
  <div class="lang-row">${LANGS.map(([code, nm]) => `<button class="btn${code === getLang() ? ' primary' : ''}" data-lang="${code}">${nm}</button>`).join('')}</div>
  <div class="label" style="margin-top:12px">${t('Layout')}</div>
  <div class="lang-row">${[['auto', 'Automatic'], ['ltr', 'Left → right'], ['rtl', 'Right → left']].map(([v, lbl]) =>
    `<button class="btn${v === getDirPref() ? ' primary' : ''}" data-dir="${v}">${esc(t(lbl))}</button>`).join('')}</div>
  <p class="small muted">${esc(t('LAYOUT_HINT'))}</p>
  <button class="btn wide" data-act="translate">${esc(t('Use {lang} names for built-in items', { lang: LANGS.find(([c]) => c === getLang())[1] }))}</button>
  <p class="small muted">${esc(t('TRANSLATE_HINT'))}</p>

  <h2 class="day">${t('Your data')}</h2>
  <div class="card pad">
    <p>${esc(t('Entries saved on this phone: {n} (events: {e}).', { n: state.entries.length, e: nEvents }))}</p>
    <p class="small ${persisted ? 'ok' : 'warn'}">${esc(t(persisted ? 'PROTECTED_YES' : 'PROTECTED_NO'))}</p>
    ${persisted ? '' : `<button class="btn" data-act="persist">${t('Protect')}</button>`}
    <div class="btn-row">
      <button class="btn" data-act="csv">${t('Export CSV')}</button>
      <button class="btn" data-act="backup">${t('Full backup (JSON)')}</button>
    </div>
    <label class="btn wide file">${t('Import / restore backup')}<input type="file" accept=".json,.jsonl,application/json" data-act="import" hidden></label>
  </div>

  <h2 class="day">${t('Event buttons')}</h2>
  ${manageList('events', events, (ev) => (ev.color ? `<span class="dot" style="--c:${ev.color}"></span>` : '') + esc(eventLabel(ev)) + (ev.private ? ` <span class="tag">${t('private')}</span>` : ''))}
  <button class="btn primary wide" data-act="add">${t('+ Add a button')}</button>
  <p class="small muted">${esc(t('EDIT_BUTTON_HINT'))}</p>

  <h2 class="day" id="training-settings">${t('Exercises')}</h2>
  ${manageList('exercises', state.config.exercises, (x) => esc(x.name)
    + (x.type === 'seconds' ? ` <span class="tag">${t('seconds')}</span>` : '')
    + (x.allowWeight ? ` <span class="tag">+${t('kg')}</span>` : ''))}
  <div class="btn-row">
    <button class="btn primary" data-act="library">${t('+ Add from library')}</button>
    <button class="btn" data-act="add-ex">${t('+ Add an exercise')}</button>
  </div>

  <h2 class="day">${t('Routines')}</h2>
  ${manageList('routines', state.config.routines, (r) => esc(r.name)
    + ` <span class="tag">${esc(t('exercises: {n}', { n: (r.exercises || []).length }))}</span>`)}
  <button class="btn primary wide" data-act="add-routine">${t('+ New routine')}</button>
  <button class="btn wide" data-act="presets">${esc(t('Add missing preset exercises & routines'))}</button>

  <h2 class="day">${t('Config file')}</h2>
  <div class="card pad">
    ${state.configErrors.length
      ? `<p class="warn">${t('⚠ Config has problems — using the last good version.')}</p><ul class="errors">${state.configErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
      : `<p class="ok small">${t('✓ Config OK.')}</p>`}
    <p class="small muted">${esc(t('Events: {a} · Exercises: {b} · Routines: {c}', { a: events.length, b: state.config.exercises.length, c: state.config.routines.length }))}</p>
    <div class="btn-row">
      <button class="btn" data-act="cfg-export">${t('Export config')}</button>
      <label class="btn file">${t('Import config')}<input type="file" accept=".json,application/json" data-act="cfg-import" hidden></label>
    </div>
    <button class="btn wide danger" data-act="cfg-reset">${t('Reset config to default')}</button>
  </div>
  <p class="small muted center">Tracker</p>`;

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

  el.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', async () => {
    await setLang(b.dataset.lang);
    ctx.refresh();
  }));
  el.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', async () => {
    await setDirPref(b.dataset.dir);
    ctx.refresh();
  }));

  on('persist', async () => {
    const ok = await storage.requestPersistence();
    ctx.toast(ok ? t('Storage protected') : t('Browser said no — install the app to the home screen first'));
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
      let msg = t('Imported new entries: {n}', { n: added })
        + (skipped ? t(', already here: {n}', { n: skipped }) : '')
        + (invalid ? t(', unreadable skipped: {n}', { n: invalid }) : '');
      if (configText && confirm(t('BACKUP_HAS_CONFIG'))) {
        const res = await saveConfigText(configText);
        msg += res.ok ? t('. Config restored.') : t('. Config NOT restored: {msg}', { msg: res.errors[0] });
      }
      await ctx.reloadAll();
      ctx.toast(msg);
    } catch (err) {
      ctx.toast(t('Import failed: {msg}', { msg: t(err.message) }), { error: true });
    }
  }, 'change');

  // --- event manager ---
  // Every change goes through saveConfig(), which validates first, so the
  // in-app editor can never produce a config that breaks the app.
  const change = async (mutate) => {
    if (state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return;
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
  on('library', () => openExercisePicker(ctx, { title: t('Exercise library') }));
  on('translate', async () => {
    if (state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return;
    try {
      const { cfg, changed } = await translateBuiltInNames(state.config);
      if (changed) {
        const res = await saveConfig(cfg);
        if (!res.ok) throw new Error(res.errors[0]);
        await ctx.reloadConfig();
      }
      ctx.toast(changed ? t('Renamed: {n}', { n: changed }) : t('Nothing to rename'));
    } catch (err) {
      ctx.toast(t('Failed: {msg}', { msg: err.message }), { error: true });
    }
  });
  on('add-routine', () => openRoutineEditor(ctx, null));
  on('presets', async () => {
    try {
      const n = await addMissingPresets(state.config);
      if (n) await ctx.reloadConfig();
      ctx.toast(n ? t('Added presets: {n}', { n }) : t('You already have all presets'));
    } catch (err) {
      ctx.toast(t('Failed: {msg}', { msg: err.message }), { error: true });
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
    if (res.ok) { await ctx.reloadConfig(); ctx.toast(t('Config imported')); }
    else ctx.toast(t('Config NOT imported: {msg}', { msg: res.errors.slice(0, 3).join('; ') }), { error: true, ms: 8000 });
  }, 'change');

  on('cfg-reset', async () => {
    if (!confirm(t('RESET_CONFIRM'))) return;
    const res = await resetToDefault().catch((err) => ({ ok: false, errors: [err.message] }));
    if (res.ok) { await ctx.reloadConfig(); ctx.toast(t('Config reset')); }
    else ctx.toast(t('Reset failed: {msg}', { msg: res.errors[0] }), { error: true });
  });
}

// One management list: rows with move up/down, edit and hide/show.
function manageList(key, items, label) {
  if (!items.length) return `<div class="card pad muted">${t('None yet.')}</div>`;
  return `<div class="card">${items.map((it, i) => `
    <div class="mrow${it.hidden ? ' dim' : ''}" data-list="${key}" data-i="${i}">
      <span class="mname">${label(it)}${it.hidden ? ` <span class="tag">${t('hidden')}</span>` : ''}</span>
      <button class="ibtn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="${t('Move up')}">↑</button>
      <button class="ibtn" data-act="down" ${i === items.length - 1 ? 'disabled' : ''} aria-label="${t('Move down')}">↓</button>
      <button class="ibtn" data-act="edit" aria-label="${t('Edit')}">✎</button>
      <button class="ibtn" data-act="hide">${it.hidden ? t('Show') : t('Hide')}</button>
    </div>`).join('')}</div>`;
}
