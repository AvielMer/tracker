// App shell: loads data, routes between screens, toast + bottom sheet,
// home-screen shortcuts, service worker.

import * as storage from './storage.js';
import { loadConfig } from './config.js';
import { renderEvents, logEvent } from './events.js';
import { renderLog } from './log.js';
import { renderSettings } from './settings.js';
import { loadOpenSession, renderTraining } from './training.js';
import { $, esc } from './util.js';

const SCREENS = {
  events: { title: 'Events', render: renderEvents },
  training: { title: 'Training', render: renderTraining },
  log: { title: 'Log', render: renderLog },
  settings: { title: 'Settings', render: renderSettings },
};

const state = {
  config: { events: [], exercises: [], routines: [] },
  configErrors: [],
  entries: [],
  session: null, // open training session, if any (see training.js)
};

const ctx = { state, toast, openSheet, closeSheet, refresh, reloadConfig, reloadAll };

function currentScreen() {
  const name = location.hash.slice(1);
  return SCREENS[name] ? name : 'events';
}

function refresh() {
  const name = currentScreen();
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('on', a.getAttribute('href') === '#' + name);
  });
  $('#title').textContent = SCREENS[name].title;
  const banner = $('#banner');
  if (state.configErrors.length) {
    banner.hidden = false;
    banner.innerHTML = `⚠ Config problem — using last good version. <a href="#settings">Details</a>`;
  } else {
    banner.hidden = true;
  }
  // A workout left open (app closed mid-session) is one tap away from
  // every other screen.
  const sb = $('#session-banner');
  if (state.session && name !== 'training') {
    sb.hidden = false;
    sb.innerHTML = `<a href="#training">▶ ${esc(state.session.item_name)} in progress — continue</a>`;
  } else {
    sb.hidden = true;
  }
  // A bug in one screen must not take down the whole app.
  const fail = (e) => {
    $('#screen').innerHTML = `<div class="empty warn">Something went wrong on this screen:<br>${esc(e.message)}</div>`;
    console.error(e);
  };
  try {
    Promise.resolve(SCREENS[name].render($('#screen'), ctx)).catch(fail);
  } catch (e) {
    fail(e);
  }
}

async function reloadConfig() {
  const res = await loadConfig();
  state.config = res.config;
  state.configErrors = res.errors;
  refresh();
}

async function reloadAll() {
  state.entries = await storage.listEntries();
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
    else toast(`Shortcut: no event "${logId}" in your config`, { error: true });
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e));
  // When a new version takes over, offer a reload (but not on first install).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('App updated', { actionLabel: 'Reload', onAction: () => location.reload(), ms: 15000 });
  });
}

async function start() {
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  window.addEventListener('hashchange', () => { closeSheet(); refresh(); });

  try {
    await reloadAll();
  } catch (e) {
    $('#screen').innerHTML = `<div class="empty warn">Could not open storage: ${esc(e.message)}<br>Try closing and reopening the app.</div>`;
    return;
  }
  await handleShortcut();
  storage.requestPersistence();
  registerServiceWorker();

  // Coming back to the app: re-render so "today" counts roll over at
  // midnight, and re-read the config (in the APK it's a file that may have
  // been edited in another app meanwhile).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('#sheet').hidden) reloadConfig();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && $('#sheet').hidden && currentScreen() === 'events') refresh();
  }, 60000);
}

start();
