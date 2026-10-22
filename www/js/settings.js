// Settings: a short menu, and each part on its own page (#settings/<page>).
// WHY pages: everything used to be on one very long screen, and people
// couldn't find their way in it. Now the menu says in a line what each part
// is for, and a page holds only that part.

import * as storage from './storage.js';
import {
  addMissingPresets, eventLabel, getConfigText, isCircuit, saveConfig, saveConfigText,
} from './config.js';
import { describeButton, openAddButtonSheet, openEventEditor } from './eventEditor.js';
import { openCircuitEditor, openExerciseEditor, openRoutineEditor } from './trainingEditor.js';
import { openExercisePicker } from './exercisePicker.js';
import { translateBuiltInNames } from './library.js';
import { parseBackup, toBackup, toCSV } from './exporter.js';
import {
  downloadFile, esc, localDate, readFileText,
} from './util.js';
import {
  autoMonthFirst, getDateOrder, getDirPref, getLang, languages, numericDate, setDateOrder, setDirPref, setLang, t,
} from './i18n.js';
import { openSetupAI, openTranslateAI } from './ai.js';
import { remindText, remindTimes } from './reminders.js';
import { restartWelcome } from './welcome.js';
import { getTheme, setTheme, THEMES } from './theme.js';
import {
  hasCycle, MAIN_TABS, setTabs, TAB_INFO, visibleTabs,
} from './tabs.js';
import { cycleSettings, DEFAULTS as CYCLE_DEFAULTS } from './cycleCalc.js';
import { icon } from './icons.js';

// The pages, in menu order. title: translation key; tint: the icon's colour.
const PAGES = {
  buttons: { title: 'Buttons', icon: 'grid', tint: '#4f9cf9', render: pageButtons },
  training: { title: 'Exercises & routines', icon: 'dumbbell', tint: '#e8833a', render: pageTraining },
  reminders: { title: 'Reminders', icon: 'bell', tint: '#d4a72c', render: pageReminders },
  cycle: { title: 'Cycle', icon: 'drop', tint: '#e0559a', render: pageCycle },
  look: { title: 'Theme', icon: 'palette', tint: '#e0559a', render: pageLook },
  tabs: { title: 'Tabs', icon: 'grid', tint: '#4f9cf9', render: pageTabs },
  language: { title: 'Language & dates', icon: 'globe', tint: '#2bb5a0', render: pageLanguage },
  data: { title: 'Backup & export', icon: 'download', tint: '#46b450', render: pageData },
  ai: { title: 'Change with AI', icon: 'sparkle', tint: '#b06ad9', render: pageAI },
  file: { title: 'Setup file', icon: 'file', tint: '#8b949e', render: pageFile },
};

// The header title of a Settings page (null = the menu itself).
export function settingsPageTitle(sub) {
  return PAGES[sub]?.title || null;
}

// Which list is in "Reorder" mode (its rows show ↑ ↓ instead of the eye).
let reordering = null;
let lastPage = null;

export function renderSettings(el, ctx, sub) {
  const page = PAGES[sub] ? sub : null;
  if (page !== lastPage) reordering = null;
  lastPage = page;
  return page ? PAGES[page].render(el, ctx) : renderMenu(el, ctx);
}

const chevron = () => `<span class="lrow-end">${icon('chevron', 'flip')}</span>`;
const tile = (name, tint) => `<span class="tile-ico" style="--c:${tint}">${icon(name)}</span>`;
const rowText = (name, sub, subCls = '') => `<span class="lrow-text"><span class="lrow-name">${name}</span>${sub ? `<span class="lrow-sub${subCls}">${sub}</span>` : ''}</span>`;
const langName = () => languages().find(([c]) => c === getLang())?.[1] || getLang();

function on(el, act, fn, evt = 'click') {
  const n = el.querySelector(`[data-act="${act}"]`);
  if (n) n.addEventListener(evt, fn);
}

// Every change goes through saveConfig(), which validates first, so the
// in-app editors can never produce a config that breaks the app.
async function change(ctx, mutate, okMsg) {
  const { state } = ctx;
  if (state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return;
  const cfg = JSON.parse(JSON.stringify(state.config));
  if (mutate(cfg) === false) return;
  const res = await saveConfig(cfg);
  if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return; }
  await ctx.reloadConfig();
  if (okMsg) ctx.toast(okMsg);
}

// --- the menu ----------------------------------------------------------------
function renderMenu(el, ctx) {
  const { state } = ctx;
  const nRemind = [...state.config.events, ...state.config.routines]
    .filter((x) => !x.hidden && x.remind).reduce((n, x) => n + x.remind.length, 0);
  const row = (key, sub, warn = false) => {
    const p = PAGES[key];
    return `<a class="lrow-main" href="#settings/${key}">${tile(p.icon, p.tint)}${rowText(esc(t(p.title)), esc(sub), warn ? ' warn' : '')}${chevron()}</a>`;
  };
  const tabs = visibleTabs(state.config);
  el.innerHTML = `
    <div class="card list">
      ${row('buttons', t('Add, change, hide or reorder your buttons'))}
      ${row('training', t('For the Training tab'))}
      ${tabs.includes('cycle') || hasCycle(state.config) ? row('cycle', t('For the Cycle tab')) : ''}
      ${row('reminders', nRemind ? t('{n} reminders', { n: nRemind }) : t('When to remind you, for each button or routine'))}
    </div>
    <div class="card list">
      ${row('look', t(THEMES.find(([id]) => id === getTheme())[1]))}
      ${row('tabs', tabs.map((k) => t(TAB_INFO[k][0])).join(' · '))}
      ${row('language', `${langName()} · ${numericDate(localDate())}`)}
      ${row('data', t('{n} entries on this phone', { n: state.entries.length }))}
      ${row('ai', t('Describe changes in your own words'))}
    </div>
    <div class="card list">
      ${row('file', state.configErrors.length ? t('⚠ Has problems') : t('For advanced users'), state.configErrors.length > 0)}
      <a class="lrow-main" href="#about">${tile('info', '#7b8794')}${rowText(esc(t('About this app')), esc(t('How to use it, privacy, help lines')))}${chevron()}</a>
    </div>`;
}

// --- lists of buttons / exercises / routines ---------------------------------------
// Tap a row = edit it. The eye hides it (from the Events screen, or from
// the Training lists) without losing its history. "Reorder" swaps the eyes
// for ↑ ↓ — fewer little buttons on every row the rest of the time.
function listHead(title, key, count) {
  const re = reordering === key;
  return `<div class="list-head"><h2 class="day">${esc(title)}</h2>${count > 1
    ? `<button class="text-btn" data-reorder="${key}">${re ? esc(t('Done')) : `${icon('reorder')}<span>${esc(t('Reorder'))}</span>`}</button>` : ''}</div>`;
}

function itemList(key, items, view, emptyText) {
  if (!items.length) return `<div class="card pad muted">${esc(emptyText)}</div>`;
  const re = reordering === key;
  return `<div class="card list">${items.map((it, i) => {
    const v = view(it);
    const tags = [...(v.tags || []), ...(it.hidden ? [t('hidden')] : [])].map((tg) => ` <span class="tag">${esc(tg)}</span>`).join('');
    return `<div class="lrow${it.hidden ? ' dim' : ''}" data-list="${key}" data-i="${i}">
      <button class="lrow-main" data-act="edit">
        ${v.dot !== undefined ? `<span class="dot" style="--c:${v.dot || 'var(--line)'}"></span>` : ''}
        ${rowText(esc(v.name) + tags, v.sub ? esc(v.sub) : '')}
      </button>
      ${re ? `<button class="ibtn ghost" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('Move up'))}">${icon('up')}</button>
        <button class="ibtn ghost" data-act="down" ${i === items.length - 1 ? 'disabled' : ''} aria-label="${esc(t('Move down'))}">${icon('down')}</button>`
    : `<button class="ibtn ghost" data-act="hide" aria-pressed="${!!it.hidden}" aria-label="${esc(it.hidden ? t('Show') : t('Hide'))}">${icon(it.hidden ? 'eyeOff' : 'eye')}</button>`}
    </div>`;
  }).join('')}</div>`;
}

function wireLists(el, ctx, rerender) {
  el.querySelectorAll('[data-reorder]').forEach((b) => b.addEventListener('click', () => {
    reordering = reordering === b.dataset.reorder ? null : b.dataset.reorder;
    rerender();
  }));
  el.querySelectorAll('.lrow[data-list]').forEach((row) => {
    const i = Number(row.dataset.i);
    const key = row.dataset.list;
    row.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      const item = ctx.state.config[key][i];
      if (!item) return;
      if (act === 'edit') {
        if (key === 'events') openEventEditor(ctx, item);
        else if (key === 'exercises') openExerciseEditor(ctx, item);
        else openRoutineEditor(ctx, item);
        return;
      }
      const hiding = act === 'hide' && !item.hidden;
      change(ctx, (cfg) => {
        const list = cfg[key];
        if (act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        else if (act === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
        else if (act === 'hide') {
          if (list[i].hidden) delete list[i].hidden; else list[i].hidden = true;
        } else return false;
        return true;
      }, act === 'hide' ? t(hiding ? (key === 'events' ? 'Hidden from the Events screen' : 'Hidden') : 'Shown again') : null);
    });
  });
}

// --- Buttons ---------------------------------------------------------------------
function pageButtons(el, ctx) {
  const { events } = ctx.state.config;
  el.innerHTML = `
    <p class="page-hint">${esc(t('BUTTONS_HINT'))}</p>
    <button class="btn primary wide" data-act="add">${icon('plus')}<span>${esc(t('Add a button'))}</span></button>
    ${listHead(t('Your buttons'), 'events', events.length)}
    ${itemList('events', events, (ev) => ({
    dot: ev.color || '', name: eventLabel(ev), tags: ev.private ? [t('private')] : [], sub: describeButton(ev),
  }), t('No buttons yet'))}`;
  wireLists(el, ctx, () => pageButtons(el, ctx));
  on(el, 'add', () => openAddButtonSheet(ctx));
}

// --- Exercises & routines ----------------------------------------------------------
function pageTraining(el, ctx) {
  const { exercises, routines } = ctx.state.config;
  const exSub = (x) => [
    isCircuit(x) ? `⏱ ${t('circuit')}` : t(x.type === 'seconds' ? 'seconds' : 'reps'),
    x.allowWeight ? `+${t('kg')}` : '',
  ].filter(Boolean).join(' · ');
  el.innerHTML = `
    <p class="page-hint">${esc(t('TRAINING_SETTINGS_HINT'))}</p>
    ${listHead(t('Routines'), 'routines', routines.length)}
    ${itemList('routines', routines, (r) => ({
    name: r.name,
    sub: [t('exercises: {n}', { n: (r.exercises || []).length }), r.remind ? `⏰ ${remindTimes(r)}` : ''].filter(Boolean).join(' · '),
  }), t('None yet.'))}
    <button class="btn wide" data-act="add-routine">${icon('plus')}<span>${esc(t('New routine'))}</span></button>
    ${listHead(t('Exercises'), 'exercises', exercises.length)}
    ${itemList('exercises', exercises, (x) => ({ name: x.name, sub: exSub(x) }), t('None yet.'))}
    <div class="btn-row">
      <button class="btn primary" data-act="library">${icon('plus')}<span>${esc(t('From the library'))}</span></button>
      <button class="btn" data-act="add-ex">${icon('plus')}<span>${esc(t('New exercise'))}</span></button>
    </div>
    <button class="btn wide" data-act="add-circuit">${icon('plus')}<span>${esc(t('New circuit (several exercises in a row)'))}</span></button>
    <button class="linklike" data-act="presets">${esc(t('Add missing preset exercises & routines'))}</button>`;
  wireLists(el, ctx, () => pageTraining(el, ctx));
  on(el, 'add-routine', () => openRoutineEditor(ctx, null));
  on(el, 'add-ex', () => openExerciseEditor(ctx, null));
  on(el, 'add-circuit', () => openCircuitEditor(ctx, null));
  on(el, 'library', () => openExercisePicker(ctx, { title: t('Exercise library') }));
  on(el, 'presets', async () => {
    try {
      const n = await addMissingPresets(ctx.state.config);
      if (n) await ctx.reloadConfig();
      ctx.toast(n ? t('Added presets: {n}', { n }) : t('You already have all presets'));
    } catch (err) {
      ctx.toast(t('Failed: {msg}', { msg: err.message }), { error: true });
    }
  });
}

// --- Reminders -------------------------------------------------------------------
// A reminder belongs to a button or a routine (config "remind"), so this
// page only gathers them in one place and opens the right editor.
function openWithReminders(ctx, type, item, addRow) {
  if (type === 'events') openEventEditor(ctx, item);
  else openRoutineEditor(ctx, item);
  const body = document.querySelector('#sheet .sheet-body');
  if (addRow) body.querySelector('[data-radd]')?.click();
  (body.querySelector('[data-rlist] .rrow:last-child') || body.querySelector('[data-radd]'))?.scrollIntoView({ block: 'center' });
}

function pageReminders(el, ctx) {
  const { events, routines } = ctx.state.config;
  const items = [
    ...events.filter((e) => e.remind).map((it) => ({ type: 'events', it })),
    ...routines.filter((r) => r.remind).map((it) => ({ type: 'routines', it })),
  ];
  const label = ({ type, it }) => (type === 'events' ? eventLabel(it) : it.name);
  el.innerHTML = `
    <p class="page-hint">${esc(t('REMINDERS_HINT'))}</p>
    ${items.length ? `<div class="card list">${items.map((x, i) => `
      <button class="lrow-main${x.it.hidden ? ' dim' : ''}" data-i="${i}">
        ${tile(x.type === 'events' ? 'bell' : 'dumbbell', x.type === 'events' ? (x.it.color || '#8b949e') : '#e8833a')}
        ${rowText(esc(label(x)) + (x.it.hidden ? ` <span class="tag">${esc(t('hidden'))}</span>` : ''), esc(remindText(x.it)))}
        <span class="lrow-end">${icon('edit')}</span>
      </button>`).join('')}</div>` : `<div class="card pad muted">${esc(t('No reminders yet'))}</div>`}
    <button class="btn primary wide" data-act="add">${icon('plus')}<span>${esc(t('Add a reminder'))}</span></button>
    <p class="small muted">${esc(t('REMIND_WEB_NOTE'))}</p>`;
  el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
    const x = items[Number(b.dataset.i)];
    openWithReminders(ctx, x.type, x.it, false);
  }));
  on(el, 'add', () => {
    const all = [
      ...events.filter((e) => !e.hidden).map((it) => ({ type: 'events', it })),
      ...routines.filter((r) => !r.hidden).map((it) => ({ type: 'routines', it })),
    ];
    const root = ctx.openSheet(`
      <div class="sheet-head"><b>${esc(t('Remind me about…'))}</b>
        <button class="ibtn ghost" data-act="close" aria-label="${esc(t('Close'))}">${icon('close')}</button></div>
      ${all.length ? `<div class="card list">${all.map((x, i) => `
        <button class="lrow-main" data-pick="${i}">
          ${x.type === 'events' ? `<span class="dot" style="--c:${x.it.color || 'var(--line)'}"></span>` : `<span class="dot-ico">${icon('dumbbell')}</span>`}
          ${rowText(esc(label(x)), x.it.remind ? esc(remindText(x.it)) : '')}
          <span class="lrow-end">${icon('plus')}</span>
        </button>`).join('')}</div>` : `<p class="muted">${esc(t('No buttons yet'))}</p>`}`);
    root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
    root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const x = all[Number(b.dataset.pick)];
      openWithReminders(ctx, x.type, x.it, true);
    }));
  });
}

// --- Theme ---------------------------------------------------------------------------
// Each choice shows a small picture of the theme (drawn in CSS: .tprev-*).
function pageLook(el, ctx) {
  const colors = ['#2bb5a0', '#7b6cf6', '#e8833a', '#e0559a'];
  el.innerHTML = `
    <p class="page-hint">${esc(t('THEME_HINT'))}</p>
    <div class="themes">${THEMES.map(([id, name, desc]) => `
      <button class="theme-card${id === getTheme() ? ' on' : ''}" data-theme-pick="${id}" aria-pressed="${id === getTheme()}">
        <span class="tprev tprev-${id}" aria-hidden="true"><span class="tp-bar"></span>
          <span class="tp-grid">${colors.map((c) => `<i style="--c:${c}"></i>`).join('')}</span><span class="tp-nav"></span></span>
        <span class="pick-box">${icon('check')}</span>
        <span class="theme-name">${esc(t(name))}</span>
        <span class="theme-desc">${esc(t(desc))}</span>
      </button>`).join('')}</div>`;
  el.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', async () => {
    await setTheme(b.dataset.themePick);
    ctx.refresh();
  }));
}

// --- Tabs --------------------------------------------------------------------------
// Show, hide and reorder the tabs at the bottom (tabs.js). The first one is
// where the app opens. Settings can't be hidden.
function pageTabs(el, ctx) {
  const vis = visibleTabs(ctx.state.config);
  const rows = [...vis, ...MAIN_TABS.filter((k) => !vis.includes(k))];
  const re = reordering === 'tabs';
  el.innerHTML = `
    <p class="page-hint">${esc(t('TABS_HINT'))}</p>
    ${listHead(t('Your tabs'), 'tabs', vis.length)}
    <div class="card list">${rows.map((k) => {
    const on = vis.includes(k);
    const i = vis.indexOf(k);
    const [title, ic, tint] = TAB_INFO[k];
    const sub = !on ? t('hidden') : i === 0 ? t('Opens first') : '';
    return `<div class="lrow${on ? '' : ' dim'}" data-tab-row="${k}">
      <div class="lrow-main">${tile(ic, tint)}${rowText(esc(t(title)), esc(sub))}</div>
      ${re ? (on ? `<button class="ibtn ghost" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('Move up'))}">${icon('up')}</button>
        <button class="ibtn ghost" data-act="down" ${i === vis.length - 1 ? 'disabled' : ''} aria-label="${esc(t('Move down'))}">${icon('down')}</button>` : '')
    : `<button class="ibtn ghost" data-act="hide" aria-pressed="${!on}" aria-label="${esc(on ? t('Hide') : t('Show'))}">${icon(on ? 'eye' : 'eyeOff')}</button>`}
    </div>`;
  }).join('')}
      <div class="lrow"><div class="lrow-main">${tile(TAB_INFO.settings[1], TAB_INFO.settings[2])}${rowText(esc(t('Settings')), esc(t('Always there')))}</div></div>
    </div>`;
  el.querySelector('[data-reorder]')?.addEventListener('click', () => {
    reordering = re ? null : 'tabs';
    pageTabs(el, ctx);
  });
  el.querySelectorAll('[data-tab-row]').forEach((row) => row.addEventListener('click', async (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    const k = row.dataset.tabRow;
    const list = [...vis];
    const i = list.indexOf(k);
    if (act === 'hide') {
      if (i >= 0 && list.length === 1) { ctx.toast(t('Keep at least one tab')); return; }
      if (i >= 0) list.splice(i, 1); else list.push(k);
    } else if (act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    else if (act === 'down' && i >= 0 && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    else return;
    await setTabs(list);
    ctx.refresh();
    if (act === 'hide') ctx.toast(t(i >= 0 ? 'Tab hidden' : 'Tab shown'));
  }));
}

// --- Cycle -----------------------------------------------------------------------
// The Cycle tab's settings (config "cycle"): which button marks the period
// days, the diary button, the usual lengths (until the log has its own)
// and whether fertile and PMS days are shown. Each control saves at once.
function pageCycle(el, ctx) {
  const { config } = ctx.state;
  const cs = cycleSettings(config);
  const spans = config.events.filter((e) => e.span);
  const opt = (e, cur) => `<option value="${esc(e.id)}"${e.id === cur ? ' selected' : ''}>${esc(eventLabel(e))}</option>`;
  el.innerHTML = `
    <p class="page-hint">${esc(t('CYCLE_SETTINGS_HINT'))}</p>
    <div class="card pad cy-set">
      <label class="label-block">${esc(t('Period button'))}<select class="input" data-c="period">
        ${spans.some((e) => e.id === cs.period) ? '' : `<option value="" selected>${esc(t('— choose —'))}</option>`}
        ${spans.map((e) => opt(e, cs.period)).join('')}</select></label>
      <p class="small muted">${esc(t('PERIOD_BUTTON_HINT'))}</p>
      <label class="label-block">${esc(t('Diary button'))}<select class="input" data-c="diary">
        <option value="">${esc(t('None'))}</option>
        ${config.events.filter((e) => !e.span).map((e) => opt(e, cs.diary)).join('')}</select></label>
      <label class="label-block">${esc(t('Usual cycle length (days)'))}<input class="input" data-c="length" inputmode="numeric" value="${cs.length}"></label>
      <label class="label-block">${esc(t('Usual period length (days)'))}<input class="input" data-c="periodLength" inputmode="numeric" value="${cs.periodLength}"></label>
      <p class="small muted">${esc(t('USUAL_LENGTH_HINT'))}</p>
      <label class="check"><input type="checkbox" data-c="fertile" ${cs.fertile ? 'checked' : ''}> ${esc(t('Show fertile days and ovulation'))}</label>
      <label class="check"><input type="checkbox" data-c="pms" ${cs.pms ? 'checked' : ''}> ${esc(t('Show PMS days'))}</label>
    </div>
    <a class="btn wide" href="#cycle">${icon('drop')}<span>${esc(t('Open the Cycle tab'))}</span></a>`;
  const LIMITS = { length: [20, 45], periodLength: [1, 12] };
  el.querySelectorAll('[data-c]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.c;
    let v;
    if (inp.type === 'checkbox') v = inp.checked;
    else if (LIMITS[k]) {
      v = Number(inp.value.trim());
      const [lo, hi] = LIMITS[k];
      if (!(Number.isInteger(v) && v >= lo && v <= hi)) {
        ctx.toast(t('Type a whole number from {lo} to {hi}', { lo, hi }));
        inp.value = cs[k];
        return;
      }
    } else v = inp.value || null;
    change(ctx, (cfg) => {
      cfg.cycle = { ...(cfg.cycle || {}) };
      // A default value needn't be written into the setup file.
      if (v === null || v === CYCLE_DEFAULTS[k]) delete cfg.cycle[k]; else cfg.cycle[k] = v;
      return true;
    }, t('Saved'));
  }));
}

// --- Language & dates ------------------------------------------------------------
function pageLanguage(el, ctx) {
  const seg = (items, cur, attr) => `<div class="seg">${items.map(([v, lbl]) => `<button class="${v === cur ? 'on' : ''}" data-${attr}="${esc(v)}" aria-pressed="${v === cur}">${esc(lbl)}</button>`).join('')}</div>`;
  el.innerHTML = `
    <h2 class="day">${esc(t('Language'))}</h2>
    ${seg(languages(), getLang(), 'lang')}
    <button class="btn wide" data-act="add-lang">${icon('sparkle')}<span>${esc(t('Add a language with AI'))}</span></button>
    <h2 class="day">${esc(t('Dates'))}</h2>
    ${seg([['auto', `${t('Automatic')} (${autoMonthFirst() ? '12/31' : '31/12'})`], ['dmy', '31/12/2026'], ['mdy', '12/31/2026']], getDateOrder(), 'date-order')}
    <h2 class="day">${esc(t('Layout'))}</h2>
    ${seg([['auto', t('Automatic')], ['ltr', t('Left → right')], ['rtl', t('Right → left')]], getDirPref(), 'dir')}
    <p class="small muted">${esc(t('LAYOUT_HINT'))}</p>
    <h2 class="day">${esc(t('Names of the starting items'))}</h2>
    <button class="btn wide" data-act="translate">${esc(t('Use {lang} names for built-in items', { lang: langName() }))}</button>
    <p class="small muted">${esc(t('TRANSLATE_HINT'))}</p>`;

  el.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', async () => {
    await setLang(b.dataset.lang);
    ctx.refresh();
  }));
  el.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', async () => {
    await setDirPref(b.dataset.dir);
    ctx.refresh();
  }));
  el.querySelectorAll('[data-date-order]').forEach((b) => b.addEventListener('click', async () => {
    await setDateOrder(b.dataset.dateOrder);
    ctx.refresh();
  }));
  on(el, 'add-lang', () => openTranslateAI(ctx));
  on(el, 'translate', async () => {
    const { state } = ctx;
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
}

// --- Backup & export -------------------------------------------------------------
async function pageData(el, ctx) {
  const { state } = ctx;
  const persisted = await storage.isPersisted();
  const nEvents = state.entries.filter((e) => e.kind === 'event').length;
  el.innerHTML = `
    <div class="card pad">
      <p class="data-count">${esc(t('Entries saved on this phone: {n} (events: {e}).', { n: state.entries.length, e: nEvents }))}</p>
      <p class="small ${persisted ? 'ok' : 'warn'}">${esc(t(persisted ? 'PROTECTED_YES' : 'PROTECTED_NO'))}</p>
      ${persisted ? '' : `<button class="btn" data-act="persist">${icon('shield')}<span>${esc(t('Protect'))}</span></button>`}
    </div>
    <div class="card list">
      <button class="lrow-main" data-act="backup">${tile('download', '#46b450')}${rowText(esc(t('Full backup (JSON)')), esc(t('BACKUP_DESC')))}</button>
      <button class="lrow-main" data-act="csv">${tile('table', '#4f9cf9')}${rowText(esc(t('Export CSV')), esc(t('CSV_DESC')))}</button>
      <label class="lrow-main file">${tile('upload', '#e8833a')}${rowText(esc(t('Import / restore backup')), esc(t('RESTORE_DESC')))}
        <input type="file" accept=".json,.jsonl,application/json" data-act="import" hidden></label>
    </div>
    <p class="small muted">${esc(t('BACKUP_TIP'))}</p>`;

  on(el, 'persist', async () => {
    const ok = await storage.requestPersistence();
    ctx.toast(ok ? t('Storage protected') : t('Browser said no — install the app to the home screen first'));
    ctx.refresh();
  });
  on(el, 'csv', () => {
    downloadFile(`tracker_log_${localDate()}.csv`, toCSV(state.entries), 'text/csv;charset=utf-8');
  });
  on(el, 'backup', async () => {
    const text = toBackup(state.entries, await getConfigText());
    downloadFile(`tracker_backup_${localDate()}.json`, text, 'application/json');
  });
  on(el, 'import', async (e) => {
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
}

// --- Change with AI --------------------------------------------------------------
function pageAI(el, ctx) {
  el.innerHTML = `
    <p class="page-hint">${esc(t('AI_SECTION_HINT'))}</p>
    <div class="card list">
      <button class="lrow-main" data-act="ai-setup">${tile('sparkle', '#b06ad9')}${rowText(esc(t('Change buttons, exercises or routines with AI')), esc(t('AI_SETUP_SHORT')))}${chevron()}</button>
      <button class="lrow-main" data-act="ai-lang">${tile('globe', '#2bb5a0')}${rowText(esc(t('Translate the app into another language with AI')), esc(t('Any language, in a few minutes')))}${chevron()}</button>
    </div>
    <p class="small muted">${esc(t('AI_PRIVACY'))}</p>`;
  on(el, 'ai-setup', () => openSetupAI(ctx));
  on(el, 'ai-lang', () => openTranslateAI(ctx));
}

// --- Setup file (advanced) -------------------------------------------------------
function pageFile(el, ctx) {
  const { state } = ctx;
  el.innerHTML = `
    <p class="page-hint">${esc(t('FILE_HINT'))}</p>
    <div class="card pad">
      ${state.configErrors.length
    ? `<p class="warn">${t('⚠ Config has problems — using the last good version.')}</p><ul class="errors">${state.configErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : `<p class="ok small">${t('✓ Config OK.')}</p>`}
      <p class="small muted">${esc(t('Events: {a} · Exercises: {b} · Routines: {c}', { a: state.config.events.length, b: state.config.exercises.length, c: state.config.routines.length }))}</p>
    </div>
    <div class="card list">
      <button class="lrow-main" data-act="cfg-export">${tile('download', '#4f9cf9')}${rowText(esc(t('Export config')), esc(t('CFG_EXPORT_DESC')))}</button>
      <label class="lrow-main file">${tile('upload', '#e8833a')}${rowText(esc(t('Import config')), esc(t('CFG_IMPORT_DESC')))}
        <input type="file" accept=".json,application/json" data-act="cfg-import" hidden></label>
    </div>
    <button class="btn wide danger" data-act="start-over">${esc(t('Start over — choose your buttons again'))}</button>`;

  on(el, 'cfg-export', async () => {
    downloadFile('tracker_config.json', await getConfigText(), 'application/json');
  });
  on(el, 'cfg-import', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const res = await saveConfigText(await readFileText(file));
    if (res.ok) { await ctx.reloadConfig(); ctx.toast(t('Config imported')); } else ctx.toast(t('Config NOT imported: {msg}', { msg: res.errors.slice(0, 3).join('; ') }), { error: true, ms: 8000 });
  }, 'change');
  // The welcome screen again: pick buttons; the starting exercises and
  // routines come back (welcome.js finish()).
  on(el, 'start-over', async () => {
    if (!confirm(t('START_OVER_CONFIRM'))) return;
    await restartWelcome(state);
    history.replaceState(null, '', `${location.pathname}${location.search}#events`);
    window.scrollTo(0, 0);
    ctx.refresh();
  });
}
