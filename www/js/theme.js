// Themes: how the app looks. "dark" is the original look; "girl" is light
// and pink with soft watercolours and flowers (asked for as "a theme that
// resembles the My Calendar period app, called girl theme").
// The colours live in app.css as CSS variables; [data-theme="girl"] on
// <html> switches them. Nothing here touches the user's data.

import * as storage from './storage.js';

const KEY = 'ui_theme'; // kv value, plus a hint copy for the first paint
// [id, name, description] — names and descriptions are translation keys.
export const THEMES = [
  ['dark', 'Dark', 'THEME_DARK_DESC'],
  ['girl', 'Girl', 'THEME_GIRL_DESC'],
];
// The phone's top bar follows <meta name="theme-color">.
const BAR = { dark: '#121418', girl: '#fff4f7' };

let current = 'dark';
export const getTheme = () => current;

export function applyTheme(id) {
  current = BAR[id] ? id : 'dark';
  const root = document.documentElement;
  if (current === 'dark') delete root.dataset.theme;
  else root.dataset.theme = current;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[current]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', current === 'dark' ? 'dark' : 'light');
}

// Called first thing on start (from the hint, so there's no flash of the
// dark colours), then again once the real setting has been read.
export function applyThemeHint() {
  applyTheme(storage.readHint(KEY) || 'dark');
}

export async function initTheme() {
  try {
    applyTheme((await storage.getValue(KEY)) || 'dark');
  } catch { /* keep the hint's theme */ }
  storage.writeHint(KEY, current);
}

export async function setTheme(id) {
  applyTheme(id);
  storage.writeHint(KEY, current);
  await storage.setValue(KEY, current);
}
