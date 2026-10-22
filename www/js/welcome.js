// Welcome: what a new person sees the very first time the app opens.
//
// WHY: found by the user — people who opened the app thought the starting
// buttons (Headache, Panic attack, …) were THEIR buttons, not examples. So
// the app now starts by asking what you want to keep track of. The starting
// buttons are offered as suggestions, and only the ones you pick are added.
//
// Three short steps: hello (+ language) → pick your buttons → how it works.
// kv "welcome": 'pending' until the last step is done, then 'done' — so
// closing the app halfway shows the welcome again next time. 'restart' is
// Settings → Setup file → Start over (see finish()).

import * as storage from './storage.js';
import {
  fetchDefaultFor, parseConfigText, saveConfig, starterButtons,
} from './config.js';
import { describeButton } from './eventEditor.js';
import { translateBuiltInNames } from './library.js';
import { getTheme, setTheme, THEMES } from './theme.js';
import { bloomDone, playBloom } from './bloom.js';
import { ownedIds } from './tabs.js';
import { icon } from './icons.js';
import { esc } from './util.js';
import {
  getLang, languages, setLang, t,
} from './i18n.js';

const KEY = 'welcome';
// The old starting config had this example private button. It was never a
// real button, so it doesn't count as "changed by the user" below.
const OLD_EXAMPLE = 'example_private';

let step = 1;
let restarting = false; // Start over (kv 'restart') rather than a first run
let chosen = new Set();
let options = null; // the starting buttons, in the language they were loaded in
let optionsLang = null;

// Whether to show the welcome. firstRun = there was no config yet.
// An install from before the welcome existed gets it too, but only if
// nothing was ever logged and the buttons are still the starting ones:
// then there is nothing of the user's that it could replace.
export async function initWelcome(state, firstRun) {
  let w = await storage.getValue(KEY);
  if (!w) {
    let untouched = false;
    if (!firstRun && state.entries.length === 0) {
      const starters = new Set((await starterButtons().catch(() => [])).map((e) => e.id));
      untouched = starters.size > 0 && state.config.events.every((e) => starters.has(e.id) || e.id === OLD_EXAMPLE);
    }
    w = firstRun || untouched ? 'pending' : 'done';
    await storage.setValue(KEY, w);
  }
  restarting = w === 'restart';
  return w === 'pending' || w === 'restart';
}

// Settings → Setup file → Start over: the welcome again. Nothing changes
// until its last step, so closing the app (or Cancel) halfway is safe.
export async function restartWelcome(state) {
  await storage.setValue(KEY, 'restart');
  restarting = true;
  step = 1;
  chosen = new Set();
  state.welcome = true;
}

export async function renderWelcome(el, ctx) {
  if (step === 2) await renderPick(el, ctx);
  else if (step === 3) renderTips(el, ctx);
  else renderHello(el, ctx);
}

function go(ctx, n) {
  step = n;
  window.scrollTo(0, 0);
  ctx.refresh();
}

// --- 1. hello ----------------------------------------------------------------
function renderHello(el, ctx) {
  el.innerHTML = `<div class="wl">
    ${restarting ? `<button class="wl-back" data-cancel>${icon('close')}<span>${esc(t('Cancel — keep my setup'))}</span></button>` : ''}
    <div class="wl-hero">
      <img class="wl-logo" src="icons/icon-192.png" alt="" width="76" height="76">
      <h1 class="wl-title">${esc(t('Welcome to Tracker'))}</h1>
      <p class="wl-lead">${esc(t('WELCOME_LEAD'))}</p>
    </div>
    <ul class="wl-points">
      <li><span class="wl-ico">${icon('zap')}</span><span><b>${esc(t('One tap logs it'))}</b>${esc(t('WELCOME_TAP'))}</span></li>
      <li><span class="wl-ico">${icon('dumbbell')}</span><span><b>${esc(t('Training'))}</b>${esc(t('WELCOME_TRAIN'))}</span></li>
      <li><span class="wl-ico">${icon('lock')}</span><span><b>${esc(t('Private'))}</b>${esc(t('WELCOME_PRIVATE'))}</span></li>
    </ul>
    <div class="wl-lang" role="group" aria-label="${esc(t('Language'))}">${languages().map(([code, name]) => `<button class="pill${code === getLang() ? ' on' : ''}" data-lang="${esc(code)}" aria-pressed="${code === getLang()}">${esc(name)}</button>`).join('')}</div>
    <div class="wl-lang wl-theme" role="group" aria-label="${esc(t('Theme'))}">${THEMES.map(([id, name]) => `<button class="pill${id === getTheme() ? ' on' : ''}" data-theme-pick="${id}" aria-pressed="${id === getTheme()}">${id === 'girl' ? '🌸' : '🌙'} ${esc(t(name))}</button>`).join('')}</div>
    <div class="wl-bar"><button class="btn primary big wide" data-next>${esc(t('Get started'))}</button></div>
  </div>`;
  el.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', async () => {
    await setLang(b.dataset.lang);
    ctx.refresh();
  }));
  // The Girl theme the first time: the flowers, and the Cycle tab offered.
  el.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.themePick;
    if (id === 'girl' && getTheme() !== 'girl' && !(await bloomDone())) {
      await playBloom(ctx, { inWelcome: true });
      return;
    }
    await setTheme(id);
    ctx.refresh();
  }));
  el.querySelector('[data-next]').addEventListener('click', () => go(ctx, 2));
  el.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    await storage.setValue(KEY, 'done');
    restarting = false;
    ctx.state.welcome = false;
    ctx.refresh();
  });
}

// --- 2. pick your buttons ---------------------------------------------------------
async function renderPick(el, ctx) {
  // The suggestions in the app's language (reloaded if it was changed).
  if (!options || optionsLang !== getLang()) {
    try {
      options = await starterButtons();
      optionsLang = getLang();
    } catch {
      options = [];
    }
  }
  const n = chosen.size;
  el.innerHTML = `<div class="wl">
    <button class="wl-back" data-back>${icon('back', 'flip')}<span>${esc(t('Back'))}</span></button>
    <h1 class="wl-title">${esc(t('What do you want to keep track of?'))}</h1>
    <p class="wl-lead">${esc(t('WELCOME_PICK_HINT'))}</p>
    <div class="card list wl-picks">${options.map((o) => `
      <button class="lrow-main pick${chosen.has(o.id) ? ' on' : ''}" data-id="${esc(o.id)}" aria-pressed="${chosen.has(o.id)}">
        <span class="dot" style="--c:${o.color || '#8b949e'}"></span>
        <span class="lrow-text"><span class="lrow-name">${esc(o.name)}</span><span class="lrow-sub">${esc(describeButton(o))}</span></span>
        <span class="pick-box">${icon('check')}</span>
      </button>`).join('') || `<div class="pad muted">${esc(t('No internet — you can add your own buttons in a moment.'))}</div>`}</div>
    <p class="small muted wl-note">${esc(t('WELCOME_OWN_HINT'))}</p>
    <div class="wl-bar"><button class="btn primary big wide" data-next>${esc(n ? t('Continue with {n} buttons', { n }) : t("Skip — I'll add my own"))}</button></div>
  </div>`;
  el.querySelector('[data-back]').addEventListener('click', () => go(ctx, 1));
  el.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.id;
    if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
    b.classList.toggle('on', chosen.has(id));
    b.setAttribute('aria-pressed', chosen.has(id));
    const k = chosen.size;
    el.querySelector('[data-next]').textContent = k ? t('Continue with {n} buttons', { n: k }) : t("Skip — I'll add my own");
  }));
  el.querySelector('[data-next]').addEventListener('click', () => go(ctx, 3));
}

// --- 3. how it works --------------------------------------------------------------
function renderTips(el, ctx) {
  // Installed from the home screen already? Then no install tip.
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  el.innerHTML = `<div class="wl">
    <button class="wl-back" data-back>${icon('back', 'flip')}<span>${esc(t('Back'))}</span></button>
    <h1 class="wl-title">${esc(t("You're all set"))}</h1>
    <ul class="wl-points">
      <li><span class="wl-ico">${icon('zap')}</span><span><b>${esc(t('Tap a button'))}</b>${esc(t('TIP_TAP'))}</span></li>
      <li><span class="wl-ico">${icon('undo')}</span><span><b>${esc(t('Made a mistake?'))}</b>${esc(t('TIP_UNDO'))}</span></li>
      <li><span class="wl-ico">${icon('sliders')}</span><span><b>${esc(t('Make it yours'))}</b>${esc(t('TIP_SETTINGS'))}</span></li>
      ${installed ? '' : `<li><span class="wl-ico">${icon('phone')}</span><span><b>${esc(t('Install it'))}</b>${esc(t('TIP_INSTALL'))}</span></li>`}
    </ul>
    <div class="wl-bar"><button class="btn primary big wide" data-done>${esc(t('Start using Tracker'))}</button></div>
  </div>`;
  el.querySelector('[data-back]').addEventListener('click', () => go(ctx, 2));
  const done = el.querySelector('[data-done]');
  done.addEventListener('click', async () => {
    done.disabled = true;
    try {
      await finish(ctx);
    } catch (e) {
      done.disabled = false;
      ctx.toast(t('Failed: {msg}', { msg: e.message }), { error: true });
    }
  });
}

// Saves the config with only the picked buttons. Names of built-in items
// follow the language picked in step 1 (it may differ from the phone's
// language the app started in).
// Start over also puts the starting exercises and routines back. Private
// buttons are always kept: the log has entries under their real names,
// and the screen must keep showing only their short labels. So are the
// Cycle tab's own buttons (tabs.js ownedIds): they aren't offered here —
// they belong to that tab, not to the Events screen.
async function finish(ctx) {
  const { state } = ctx;
  const cfg = JSON.parse(JSON.stringify(state.config));
  if (restarting) {
    const def = parseConfigText(await fetchDefaultFor(getLang()));
    if (!def.ok) throw new Error(def.errors[0]);
    cfg.exercises = def.config.exercises;
    cfg.routines = def.config.routines;
  }
  // (On a first run the config is still the starting one, whose Period
  // buttons are not the user's.)
  const owned = restarting ? ownedIds(state.config) : new Set();
  const mine = new Map(state.config.events.filter((e) => e.private || owned.has(e.id)).map((e) => [e.id, e]));
  cfg.events = (options || []).filter((o) => chosen.has(o.id)).map((o) => {
    const it = JSON.parse(JSON.stringify(mine.get(o.id) || o));
    delete it.hidden;
    return it;
  });
  for (const [id, e] of mine) if (!chosen.has(id)) cfg.events.push(e);
  const { cfg: named } = await translateBuiltInNames(cfg).catch(() => ({ cfg }));
  const res = await saveConfig(named);
  if (!res.ok) throw new Error(res.errors[0]);
  await storage.setValue(KEY, 'done');
  state.welcome = false;
  restarting = false;
  step = 1;
  chosen = new Set();
  options = null;
  if (location.hash && location.hash !== '#events') history.replaceState(null, '', location.pathname + location.search + '#events');
  window.scrollTo(0, 0);
  await ctx.reloadConfig();
}
