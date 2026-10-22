// Which tabs show in the bar at the bottom, and in what order — asked for
// as "the period should be a separate tab that you can just open, and the
// training tab can be removed, or the events tab too". The first tab is
// the one the app opens on. Settings is always there (last), so nothing
// can be locked away; a hidden tab still opens from a link (e.g. the
// "workout in progress" banner goes to Training).
// kv "ui_tabs": the visible tabs in order. Missing = automatic: the usual
// tabs, plus Cycle once the setup has a period button.

import * as storage from './storage.js';
import { cycleSettings } from './cycleCalc.js';

const KEY = 'ui_tabs';
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

export async function initTabs() {
  try {
    const v = await storage.getValue(KEY);
    saved = Array.isArray(v) ? v.filter((k, i) => MAIN_TABS.includes(k) && v.indexOf(k) === i) : null;
  } catch {
    saved = null;
  }
}

// The setup has a period button for the Cycle tab (config "cycle").
export function hasCycle(config) {
  const id = cycleSettings(config).period;
  return !!id && config.events.some((e) => e.id === id && e.span);
}

export function visibleTabs(config) {
  if (saved) return saved;
  return MAIN_TABS.filter((k) => k !== 'cycle' || hasCycle(config));
}

export async function setTabs(list) {
  saved = list.filter((k, i) => MAIN_TABS.includes(k) && list.indexOf(k) === i);
  await storage.setValue(KEY, saved);
}
