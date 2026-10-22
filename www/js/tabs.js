// Which tabs show in the bar at the bottom, and in what order — asked for
// as "the period should be a separate tab that you can just open, and the
// training tab can be removed, or the events tab too". The first tab is
// the one the app opens on. Settings is always there (last), so nothing
// can be locked away; a hidden tab still opens from a link (e.g. the
// "workout in progress" banner goes to Training).
// kv "ui_tabs": the visible tabs in order. Missing = automatic: the usual
// tabs, plus Cycle once the setup has a period button.
//
// The Cycle tab is unlocked by the Girl theme — asked for as "the period
// cycle feature only available if a user used the girl theme first" (and
// "self contained": a man who added a period button by mistake couldn't get
// rid of it). Until then there is no Cycle tab and no period button is
// offered anywhere. kv "cycle_unlocked": true once the Girl theme was picked
// (bloom.js). People who already use the Cycle tab (entries of its buttons,
// or the Girl theme on) keep it.
// The Cycle tab's own buttons (config "cycle" period and diary) live only in
// the tab: never on the Events screen or in Settings → Buttons.

import * as storage from './storage.js';
import { cycleSettings } from './cycleCalc.js';

const KEY = 'ui_tabs';
const LOCK = 'cycle_unlocked';
// [title (translation key), icon (icons.js), colour of its tile in Settings]
export const TAB_INFO = {
  events: ['Events', 'grid', '#4f9cf9'],
  cycle: ['Cycle', 'drop', '#e0559a'],
  training: ['Training', 'dumbbell', '#e8833a'],
  log: ['Log', 'list', '#2bb5a0'],
  stats: ['Stats', 'chart', '#7b6cf6'],
  settings: ['Settings', 'sliders', '#8b949e'],
};
export const MAIN_TABS = ['events', 'cycle', 'training', 'log', 'stats'];

let saved = null; // the user's own choice, or null = automatic
let unlocked = false;

export async function initTabs() {
  try {
    const v = await storage.getValue(KEY);
    saved = Array.isArray(v) ? v.filter((k, i) => MAIN_TABS.includes(k) && v.indexOf(k) === i) : null;
  } catch {
    saved = null;
  }
}

// After the config and the log are loaded (app.js start).
export async function initCycleLock(state, theme) {
  let v = null;
  try { v = await storage.getValue(LOCK); } catch { /* not yet */ }
  if (v !== true) {
    const ids = ownedIds(state.config);
    v = theme === 'girl' || state.entries.some((e) => ids.has(e.item_id));
    // Only "yes" is kept: "no" is worked out again next time (e.g. after a
    // backup with period entries was imported).
    if (v) await storage.setValue(LOCK, true).catch(() => {});
  }
  unlocked = !!v;
}

export const cycleUnlocked = () => unlocked;

export async function unlockCycle() {
  unlocked = true;
  await storage.setValue(LOCK, true);
}

// The ids of the Cycle tab's own buttons (config "cycle").
export function ownedIds(config) {
  const c = cycleSettings(config);
  return new Set([c.period, c.diary].filter(Boolean));
}

export const cycleShown = (config) => visibleTabs(config).includes('cycle');

// The setup has a period button for the Cycle tab (config "cycle").
export function hasCycle(config) {
  const id = cycleSettings(config).period;
  return !!id && config.events.some((e) => e.id === id && e.span);
}

export function visibleTabs(config) {
  const list = saved || MAIN_TABS.filter((k) => k !== 'cycle' || hasCycle(config));
  return unlocked ? list : list.filter((k) => k !== 'cycle');
}

// Shows or hides one tab (the Cycle tab's "Turn off", the bloom's "Show me").
export async function showTab(config, key, on) {
  const list = visibleTabs(config).filter((k) => k !== key);
  if (on) list.splice(Math.min(1, list.length), 0, key);
  await setTabs(list);
}

export async function setTabs(list) {
  saved = list.filter((k, i) => MAIN_TABS.includes(k) && list.indexOf(k) === i);
  await storage.setValue(KEY, saved);
}
