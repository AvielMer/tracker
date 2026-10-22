// App shell: loads data, routes between screens, toast + bottom sheet,
// home-screen shortcuts, service worker.

import * as storage from './storage.js';
import { loadConfig } from './config.js';
import { renderEvents, logEvent } from './events.js';
import { renderLog } from './log.js';
import { renderAbout } from './about.js';
import { renderStats } from './stats.js';
import { renderSettings, settingsPageTitle } from './settings.js';
import { loadOpenSession, renderTraining } from './training.js';
import { initWelcome, renderWelcome } from './welcome.js';
import { icon } from './icons.js';
import { $, esc } from './util.js';
import {
  initLang, longDate, setLanguagePack, t,
} from './i18n.js';
import { loadDismissed } from './reminders.js';

const SCREENS = {
  events: { title: 'Events', render: renderEvents },
  training: { title: 'Training', render: renderTraining },
  log: { title: 'Log', render: renderLog },
  stats: { title: 'Stats', render: renderStats },
  settings: { title: 'Settings', render: renderSettings },
  // Not a tab: opened from the ⓘ in the header and from Settings.
  about: { title: 'About', render: renderAbout, tab: 'settings' },
};
// The tabs at the bottom, with their icons (icons.js).
const TABS = [['events', 'grid'], ['training', 'dumbbell'], ['log', 'list'], ['stats', 'chart'], ['settings', 'sliders']];

const state = {
  config: { events: [], exercises: [], routines: [] },
  configErrors: [],
  entries: [],
  session: null, // open training session, if any (see training.js)
  remindersDismissed: new Set(), // reminders put off with "not now" today (reminders.js)
  welcome: false, // the first-run welcome is showing (welcome.js)
};

const ctx = { state, toast, openSheet, closeSheet, refresh, reloadConfig, reloadAll };

// "#settings/buttons" → { name: 'settings', sub: 'buttons' }: a Settings
// page has its own address, so the phone's Back button returns to the menu.
function currentRoute() {
  const [name, sub = ''] = location.hash.slice(1).split('/');
  return SCREENS[name] ? { name, sub } : { name: 'events', sub: '' };
}

// True once the user moved between screens: then ‹ (back) returns to where
// they came from (e.g. Training → its settings → back to Training).
let movedInApp = false;

function refresh() {
  document.body.classList.toggle('welcoming', state.welcome);
  if (state.welcome) {
    renderScreen(renderWelcome);
    return;
  }
  const { name, sub } = currentRoute();
  document.querySelectorAll('.nav a').forEach((a) => {
    const key = a.dataset.tab;
    a.classList.toggle('on', key === (SCREENS[name].tab || name));
    a.querySelector('.lbl').textContent = t(SCREENS[key].title);
  });
  // Header: a Settings page or About gets ‹ back and its own title; the
  // Events screen shows today's date above its title.
  const pageTitle = name === 'settings' ? settingsPageTitle(sub) : null;
  $('#title').textContent = t(pageTitle || SCREENS[name].title);
  const back = $('#back-btn');
  back.hidden = !(pageTitle || name === 'about');
  $('.top').classList.toggle('sub', !back.hidden);
  back.setAttribute('aria-label', t('Back'));
  const eyebrow = $('#eyebrow');
  eyebrow.hidden = name !== 'events';
  eyebrow.textContent = name === 'events' ? longDate() : '';
  $('#about-btn').setAttribute('aria-label', t('About this app'));
  // On a page with ‹ the title needs the room (About is in the Settings menu).
  $('#about-btn').hidden = !back.hidden;

  const banner = $('#banner');
  if (state.configErrors.length) {
    banner.hidden = false;
    banner.innerHTML = `${esc(t('⚠ Config problem — using last good version.'))} <a href="#settings/file">${t('Details')}</a>`;
  } else {
    banner.hidden = true;
  }
  // A workout left open (app closed mid-session) is one tap away from
  // every other screen.
  const sb = $('#session-banner');
  if (state.session && name !== 'training') {
    sb.hidden = false;
    sb.innerHTML = `<a href="#training">${icon('play')}<span>${esc(t('▶ {name} in progress — continue', { name: state.session.item_name }).replace(/^▶\s*/, ''))}</span></a>`;
  } else {
    sb.hidden = true;
  }
  renderScreen(SCREENS[name].render, sub);
}

// A bug in one screen must not take down the whole app.
function renderScreen(render, sub) {
  const fail = (e) => {
    $('#screen').innerHTML = `<div class="empty warn">${esc(t('Something went wrong on this screen:'))}<br>${esc(e.message)}</div>`;
    console.error(e);
  };
  try {
    Promise.resolve(render($('#screen'), ctx, sub)).catch(fail);
  } catch (e) {
    fail(e);
  }
}

function applyConfig(res) {
  state.config = res.config;
  state.configErrors = res.errors;
  setLanguagePack(res.config.language || null);
}

async function reloadConfig() {
  applyConfig(await loadConfig());
  refresh();
}

async function reloadAll() {
  state.entries = await storage.listEntries();
  state.remindersDismissed = await loadDismissed();
  await loadOpenSession(state);
  await reloadConfig();
}

// --- toast ---------------------------------------------------------------
let toastTimer = null;
function toast(msg, { actionLabel, onAction, error = false, ms } = {}) {
  const el = $('#toast');
  el.className = 'toast show' + (error ? ' error' : '');
  el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button class="btn">${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) {
    el.querySelector('button').addEventListener('click', () => {
      el.className = 'toast';
      onAction();
    });
  }
  clearTimeout(toastTimer);
  // Longer when there's an Undo button, so there's time to react.
  toastTimer = setTimeout(() => { el.className = 'toast'; }, ms || (actionLabel ? 7000 : error ? 6000 : 2500));
}

// --- bottom sheet --------------------------------------------------------
function openSheet(html) {
  const sheet = $('#sheet');
  sheet.querySelector('.sheet-body').innerHTML = html;
  sheet.hidden = false;
  // An old toast would sit on top of the sheet's buttons; clear it.
  clearTimeout(toastTimer);
  $('#toast').className = 'toast';
  return sheet.querySelector('.sheet-body');
}

function closeSheet() {
  $('#sheet').hidden = true;
}

// --- startup -------------------------------------------------------------
async function handleShortcut() {
  // Home-screen shortcuts open URLs like ./?log=headache or ./?go=training.
  const params = new URLSearchParams(location.search);
  const logId = params.get('log');
  const go = params.get('go');
  // Remove the parameter right away so a page reload doesn't log again.
  if (logId || go) {
    history.replaceState(null, '', location.pathname + (go ? '#' + go : location.hash));
    refresh();
  }
  if (logId) {
    const ev = state.config.events.find((e) => e.id === logId);
    if (ev) await logEvent(ctx, ev);
    else toast(t('Shortcut: no event "{id}" in your config', { id: logId }), { error: true });
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e));
  // When a new version takes over, offer a reload (but not on first install).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast(t('App updated'), { actionLabel: t('Reload'), onAction: () => location.reload(), ms: 15000 });
  });
}

async function start() {
  $('.nav').innerHTML = TABS.map(([key, ic]) => `<a href="#${key}" data-tab="${key}"><span class="ico">${icon(ic)}</span><span class="lbl"></span></a>`).join('');
  $('#back-btn').innerHTML = icon('back', 'flip');
  $('#about-btn').innerHTML = icon('info');
  $('#back-btn').addEventListener('click', (e) => {
    if (movedInApp && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  window.addEventListener('hashchange', () => {
    movedInApp = true;
    closeSheet();
    window.scrollTo(0, 0);
    refresh();
  });

  await initLang();
  try {
    state.entries = await storage.listEntries();
    state.remindersDismissed = await loadDismissed();
    await loadOpenSession(state);
    const res = await loadConfig();
    applyConfig(res);
    // Decided before the first screen is drawn, so a new user never sees a
    // flash of buttons that aren't theirs.
    state.welcome = await initWelcome(state, res.firstRun).catch(() => false);
  } catch (e) {
    $('#screen').innerHTML = `<div class="empty warn">${esc(t('Could not open storage: {msg}', { msg: e.message }))}<br>${esc(t('Try closing and reopening the app.'))}</div>`;
    return;
  }
  refresh();
  await handleShortcut();
  storage.requestPersistence();
  registerServiceWorker();

  // Coming back to the app: re-render so "today" counts roll over at
  // midnight, and re-read the config (in the APK it's a file that may have
  // been edited in another app meanwhile).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('#sheet').hidden && !state.welcome) reloadConfig();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && $('#sheet').hidden && !state.welcome && currentRoute().name === 'events') refresh();
  }, 60000);
}

start();
