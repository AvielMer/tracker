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
  cycleShown, cycleUnlocked, MAIN_TABS, ownedIds, setTabs, TAB_INFO, visibleTabs,
} from './tabs.js';
import { bloomDone, playBloom } from './bloom.js';
import { dragSort } from './dragSort.js';
import { icon } from './icons.js';

// The pages, in menu order. title: translation key; tint: the icon's colour.
const PAGES = {
  buttons: { title: 'Buttons', icon: 'grid', tint: '#4f9cf9', render: pageButtons },
  training: { title: 'Exercises & routines', icon: 'dumbbell', tint: '#e8833a', render: pageTraining },
  reminders: { title: 'Reminders', icon: 'bell', tint: '#d4a72c', render: pageReminders },
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

// Which list is in "Reorder" mode (its rows show a grip to drag instead of
// the eye).
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
// Returns true once saved.
async function change(ctx, mutate, okMsg) {
  const { state } = ctx;
  if (state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return false;
  const cfg = JSON.parse(JSON.stringify(state.config));
  if (mutate(cfg) === false) return false;
  const res = await saveConfig(cfg);
  if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return false; }
  await ctx.reloadConfig();
  if (okMsg) ctx.toast(okMsg);
  return true;
}

// --- the menu ----------------------------------------------------------------
function renderMenu(el, ctx) {
  const { state } = ctx;
  const off = cycleShown(state.config) ? new Set() : ownedIds(state.config);
  const nRemind = [...state.config.events.filter((e) => !off.has(e.id)), ...state.config.routines]
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

// --- lists of exercises / routines (and the bits Buttons and Tabs share) -----------
// Tap a row = edit it. The eye hides it (from the Events screen, or from
// the Training lists) without losing its history. "Reorder" swaps the eyes
// for grips to drag the rows by (dragSort.js) — fewer little buttons on
// every row the rest of the time.
function listHead(title, key, count) {
  const re = reordering === key;
  return `<div class="list-head"><h2 class="day">${esc(title)}</h2>${count > 1
    ? `<button class="text-btn" data-reorder="${key}">${re ? esc(t('Done')) : `${icon('reorder')}<span>${esc(t('Reorder'))}</span>`}</button>` : ''}</div>
    ${re && count > 1 ? `<p class="small muted reorder-hint">${esc(t('REORDER_HINT'))}</p>` : ''}`;
}

const grip = () => `<button class="ibtn ghost grip" aria-label="${esc(t('Drag to move'))}">${icon('grip')}</button>`;

// Moves the item at slots[from] to place `to` among the slots (indexes into
// arr, in order). Items outside the slots keep their places: hidden buttons
// and the Cycle tab's own, which aren't on the list being sorted.
function moveWithin(arr, slots, from, to) {
  const items = slots.map((i) => arr[i]);
  items.splice(to, 0, items.splice(from, 1)[0]);
  slots.forEach((i, k) => { arr[i] = items[k]; });
}

function itemList(key, items, view, emptyText) {
  if (!items.length) return `<div class="card pad muted">${esc(emptyText)}</div>`;
  const re = reordering === key;
  return `<div class="card list"${re ? ` data-drag-list="${key}"` : ''}>${items.map((it, i) => {
    const v = view(it);
    const tags = [...(v.tags || []), ...(it.hidden ? [t('hidden')] : [])].map((tg) => ` <span class="tag">${esc(tg)}</span>`).join('');
    return `<div class="lrow${it.hidden ? ' dim' : ''}" data-list="${key}" data-i="${i}"${re ? ` data-drag-key="${esc(it.id)}"` : ''}>
      <button class="lrow-main" data-act="edit">
        ${v.dot !== undefined ? `<span class="dot" style="--c:${v.dot || 'var(--line)'}"></span>` : ''}
        ${rowText(esc(v.name) + tags, v.sub ? esc(v.sub) : '')}
      </button>
      ${re ? grip()
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
        if (key === 'exercises') openExerciseEditor(ctx, item);
        else openRoutineEditor(ctx, item);
        return;
      }
      if (act !== 'hide') return;
      const hiding = !item.hidden;
      change(ctx, (cfg) => {
        const it = cfg[key][i];
        if (it.hidden) delete it.hidden; else it.hidden = true;
        return true;
      }, t(hiding ? 'Hidden' : 'Shown again'));
    });
  });
  el.querySelectorAll('[data-drag-list]').forEach((box) => {
    const key = box.dataset.dragList;
    dragSort(box, (from, to, id) => change(ctx, (cfg) => {
      const list = cfg[key];
      if (list[from]?.id !== id) return false; // the setup changed meanwhile
      list.splice(to, 0, list.splice(from, 1)[0]);
      return true;
    }));
  });
}

// --- Buttons ---------------------------------------------------------------------
// Swipe a button sideways to take it off the list — asked for as "you can
// swipe left or right to get the button out of your button list" (someone
// had added buttons they didn't want and couldn't get rid of them). Never
// used = removed; used = hidden, so its entries keep their name and charts.
// Hidden buttons wait folded under "Hidden (n)". The Cycle tab's own buttons
// aren't here: they belong to the tab (Cycle tab → Cycle settings).
let showHidden = false;

function pageButtons(el, ctx) {
  const { state } = ctx;
  const owned = ownedIds(state.config);
  const all = state.config.events.map((ev, i) => ({ ev, i })).filter(({ ev }) => !owned.has(ev.id));
  const shown = all.filter(({ ev }) => !ev.hidden);
  const hidden = all.filter(({ ev }) => ev.hidden);
  const used = (ev) => state.entries.some((e) => e.item_id === ev.id);
  const re = reordering === 'events';
  const row = ({ ev, i }) => {
    // What a swipe does: never used → remove; used and showing → hide.
    const swipe = re ? null : !used(ev) ? 'remove' : ev.hidden ? null : 'hide';
    const what = swipe === 'remove' ? `${icon('trash')}<span>${esc(t('Remove'))}</span>` : `${icon('eyeOff')}<span>${esc(t('Hide'))}</span>`;
    const tags = [...(ev.private ? [t('private')] : []), ...(ev.hidden ? [t('hidden')] : [])].map((tg) => ` <span class="tag">${esc(tg)}</span>`).join('');
    return `<div class="lrow sw${ev.hidden ? ' dim' : ''}" data-ev-i="${i}"${swipe ? ` data-swipe="${swipe}"` : ''}${re ? ` data-drag-key="${esc(ev.id)}"` : ''}>
      ${swipe ? `<span class="swipe-bg ${swipe}" aria-hidden="true"><span>${what}</span><span>${what}</span></span>` : ''}
      <div class="lrow-slide">
        <button class="lrow-main" data-act="edit"><span class="dot" style="--c:${ev.color || 'var(--line)'}"></span>
          ${rowText(esc(eventLabel(ev)) + tags, esc(describeButton(ev)))}</button>
        ${re ? grip()
    : `<button class="ibtn ghost" data-act="hide" aria-pressed="${!!ev.hidden}" aria-label="${esc(ev.hidden ? t('Show') : t('Hide'))}">${icon(ev.hidden ? 'eyeOff' : 'eye')}</button>`}
      </div>
    </div>`;
  };
  el.innerHTML = `
    <p class="page-hint">${esc(t('BUTTONS_HINT'))}</p>
    <button class="btn primary wide" data-act="add">${icon('plus')}<span>${esc(t('Add a button'))}</span></button>
    ${listHead(t('Your buttons'), 'events', shown.length)}
    ${shown.length ? `<div class="card list" data-list-shown${re ? ' data-drag-list="events"' : ''}>${shown.map(row).join('')}</div>`
    : `<div class="card pad muted">${esc(t('No buttons yet'))}</div>`}
    ${shown.length && !re ? `<p class="small muted swipe-hint">${esc(t('SWIPE_HINT'))}</p>` : ''}
    ${hidden.length && !re ? `<button class="text-btn hid-toggle" data-act="hidden" aria-expanded="${showHidden}">${icon(showHidden ? 'up' : 'down')}<span>${esc(t('Hidden ({n})', { n: hidden.length }))}</span></button>
      ${showHidden ? `<div class="card list">${hidden.map(row).join('')}</div>` : ''}` : ''}
    ${cycleUnlocked() && state.config.events.some((e) => owned.has(e.id)) ? `<p class="small muted">${esc(t('CYCLE_BUTTONS_NOTE'))}</p>` : ''}`;
  const rerender = () => pageButtons(el, ctx);
  on(el, 'add', () => openAddButtonSheet(ctx));
  on(el, 'hidden', () => { showHidden = !showHidden; rerender(); });
  el.querySelector('[data-reorder]')?.addEventListener('click', () => {
    reordering = re ? null : 'events';
    rerender();
  });
  el.querySelectorAll('.lrow[data-ev-i]').forEach((row) => {
    const i = Number(row.dataset.evI);
    row.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act || row.dataset.swiped) return;
      const ev = ctx.state.config.events[i];
      if (!ev) return;
      if (act === 'edit') openEventEditor(ctx, ev);
      else if (act === 'hide') hideButton(ctx, i, !ev.hidden);
    });
  });
  // Dragged among the buttons on the list; hidden ones keep their places.
  dragSort(el.querySelector('[data-drag-list="events"]'), (from, to, id) => change(ctx, (cfg) => {
    const slots = shown.map((x) => x.i);
    if (cfg.events[slots[from]]?.id !== id) return false; // the setup changed meanwhile
    moveWithin(cfg.events, slots, from, to);
    return true;
  }));
  wireSwipe(el, (row) => {
    const i = Number(row.dataset.evI);
    if (row.dataset.swipe === 'remove') removeButton(ctx, i);
    else hideButton(ctx, i, true);
  });
}

async function hideButton(ctx, i, hide) {
  const ev = ctx.state.config.events[i];
  const ok = await change(ctx, (cfg) => {
    if (hide) cfg.events[i].hidden = true; else delete cfg.events[i].hidden;
    return true;
  });
  if (!ok) return;
  ctx.toast(t(hide ? 'Hidden — its history stays in the log' : 'Shown again'), hide ? {
    actionLabel: t('Undo'),
    onAction: () => change(ctx, (cfg) => { const x = cfg.events.find((e) => e.id === ev.id); if (x) delete x.hidden; return !!x; }),
  } : {});
}

// Only for a button with nothing in the log (checked by the caller).
async function removeButton(ctx, i) {
  const ev = JSON.parse(JSON.stringify(ctx.state.config.events[i]));
  const ok = await change(ctx, (cfg) => { cfg.events.splice(i, 1); return true; });
  if (!ok) return;
  ctx.toast(t('Removed "{name}"', { name: eventLabel(ev) }), {
    actionLabel: t('Undo'),
    onAction: () => change(ctx, (cfg) => {
      if (cfg.events.some((e) => e.id === ev.id)) return false;
      cfg.events.splice(Math.min(i, cfg.events.length), 0, ev);
      return true;
    }),
  });
}

// Rows with data-swipe slide with the finger; let go past a third of the
// width and onSwipe(row) runs. A mostly-vertical move scrolls the page as
// usual, and a swipe never counts as a tap on the row.
function wireSwipe(el, onSwipe) {
  el.querySelectorAll('.lrow[data-swipe]').forEach((row) => {
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let id = null;
    let drag = false;
    const reset = () => { row.classList.remove('swiping', 'far'); row.style.removeProperty('--dx'); };
    row.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; drag = false; id = e.pointerId;
    });
    row.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const mx = e.clientX - x0;
      const my = e.clientY - y0;
      if (!drag) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { id = null; return; }
        if (Math.abs(mx) < 12 || Math.abs(mx) < Math.abs(my) * 1.5) return;
        drag = true;
        row.classList.add('swiping');
        try { row.setPointerCapture(id); } catch { /* fine */ }
      }
      dx = mx;
      row.style.setProperty('--dx', `${dx}px`);
      row.classList.toggle('far', Math.abs(dx) > row.offsetWidth / 3);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!drag) return;
      drag = false;
      // The click that follows a swipe must not open the editor.
      row.dataset.swiped = '1';
      setTimeout(() => { delete row.dataset.swiped; }, 350);
      if (e.type === 'pointerup' && Math.abs(dx) > row.offsetWidth / 3) {
        row.classList.remove('swiping');
        row.classList.add('gone');
        row.style.setProperty('--dx', `${Math.sign(dx) * row.offsetWidth}px`);
        setTimeout(() => onSwipe(row), 200);
      } else reset();
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
  });
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
  const { config } = ctx.state;
  const { routines } = config;
  // The Cycle tab's own buttons only while that tab is on (self-contained).
  const off = cycleShown(config) ? new Set() : ownedIds(config);
  const events = config.events.filter((e) => !off.has(e.id));
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
    const id = b.dataset.themePick;
    if (id === 'girl' && getTheme() !== 'girl' && !(await bloomDone())) {
      await playBloom(ctx);
      return;
    }
    await setTheme(id);
    ctx.refresh();
  }));
}

// --- Tabs --------------------------------------------------------------------------
// Show, hide and reorder the tabs at the bottom (tabs.js). The first one is
// where the app opens. Settings can't be hidden.
function pageTabs(el, ctx) {
  const vis = visibleTabs(ctx.state.config);
  // The Cycle tab is offered only once the Girl theme unlocked it (tabs.js).
  const rows = [...vis, ...MAIN_TABS.filter((k) => !vis.includes(k) && (k !== 'cycle' || cycleUnlocked()))];
  const re = reordering === 'tabs';
  el.innerHTML = `
    <p class="page-hint">${esc(t('TABS_HINT'))}</p>
    ${listHead(t('Your tabs'), 'tabs', vis.length)}
    <div class="card list"${re ? ' data-drag-list="tabs"' : ''}>${rows.map((k) => {
    const on = vis.includes(k);
    const i = vis.indexOf(k);
    const [title, ic, tint] = TAB_INFO[k];
    const sub = !on ? t('hidden') : i === 0 ? t('Opens first') : '';
    return `<div class="lrow${on ? '' : ' dim'}" data-tab-row="${k}"${re && on ? ` data-drag-key="${k}"` : ''}>
      <div class="lrow-main">${tile(ic, tint)}${rowText(esc(t(title)), esc(sub))}</div>
      ${re ? (on ? grip() : '')
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
    if (e.target.closest('button')?.dataset.act !== 'hide') return;
    const k = row.dataset.tabRow;
    const list = [...vis];
    const i = list.indexOf(k);
    if (i >= 0 && list.length === 1) { ctx.toast(t('Keep at least one tab')); return; }
    if (i >= 0) list.splice(i, 1); else list.push(k);
    await setTabs(list);
    ctx.refresh();
    ctx.toast(t(i >= 0 ? 'Tab hidden' : 'Tab shown'));
  }));
  dragSort(el.querySelector('[data-drag-list="tabs"]'), async (from, to) => {
    const list = [...vis];
    list.splice(to, 0, list.splice(from, 1)[0]);
    await setTabs(list);
    ctx.refresh();
  });
}

// --- Language & dates ------------------------------------------------------------
// The language and layout choices stay in the same places whatever the
// direction — found by the user: after switching to Hebrew the row mirrored,
// so English wasn't where it had been. A `fixed` row is always left to
// right, and each name is still written in its own direction.
function pageLanguage(el, ctx) {
  const seg = (items, cur, attr, fixed = false) => `<div class="seg"${fixed ? ' dir="ltr"' : ''}>${items.map(([v, lbl]) => `<button class="${v === cur ? 'on' : ''}" data-${attr}="${esc(v)}" aria-pressed="${v === cur}"${fixed ? ' dir="auto"' : ''}>${esc(lbl)}</button>`).join('')}</div>`;
  el.innerHTML = `
    <h2 class="day">${esc(t('Language'))}</h2>
    ${seg(languages(), getLang(), 'lang', true)}
    <button class="btn wide" data-act="add-lang">${icon('sparkle')}<span>${esc(t('Add a language with AI'))}</span></button>
    <h2 class="day">${esc(t('Dates'))}</h2>
    ${seg([['auto', `${t('Automatic')} (${autoMonthFirst() ? '12/31' : '31/12'})`], ['dmy', '31/12/2026'], ['mdy', '12/31/2026']], getDateOrder(), 'date-order')}
    <h2 class="day">${esc(t('Layout'))}</h2>
    ${seg([['auto', t('Automatic')], ['ltr', t('Left → right')], ['rtl', t('Right → left')]], getDirPref(), 'dir', true)}
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
