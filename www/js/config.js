// Config: all events, exercises and routines come from tracker_config.json.
// Nothing about WHICH items exist is hardcoded in the JavaScript.
//
// Safety rule (same as watch_drift): a broken config must never crash the
// app. We keep the raw text the user saved AND the last config that passed
// validation. If the current text is broken, we run on the last good one
// and show exactly what's wrong.

import * as storage from './storage.js';

const KEY_TEXT = 'config_text';      // what the user saved (may be broken)
const KEY_GOOD = 'config_last_good'; // last version that validated

export const ASK_FIELDS = ['intensity', 'duration_min', 'note'];
const EXERCISE_TYPES = ['reps', 'seconds'];
const EMPTY = { events: [], exercises: [], routines: [] };

// Returns { ok, errors: [..], config } — config is a cleaned-up copy.
// Errors name the exact spot ("events[2].name") so they can be fixed in
// any text editor.
export function validateConfig(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['The file must be a JSON object { ... }'], config: null };
  }
  const out = { events: [], exercises: [], routines: [] };

  const checkList = (key, checkItem) => {
    const list = obj[key] ?? [];
    if (!Array.isArray(list)) { errors.push(`"${key}" must be a list [ ... ]`); return; }
    const seen = new Set();
    list.forEach((it, i) => {
      const at = `${key}[${i}]`;
      if (!it || typeof it !== 'object') { errors.push(`${at}: must be an object { ... }`); return; }
      if (typeof it.id !== 'string' || !it.id.trim()) errors.push(`${at}: "id" is missing`);
      else if (seen.has(it.id)) errors.push(`${at}: id "${it.id}" is used twice`);
      else seen.add(it.id);
      if (typeof it.name !== 'string' || !it.name.trim()) errors.push(`${at}: "name" is missing`);
      if ('hidden' in it && typeof it.hidden !== 'boolean') errors.push(`${at}: "hidden" must be true or false`);
      checkItem(it, at);
      out[key].push({ ...it });
    });
  };

  checkList('events', (ev, at) => {
    if ('ask' in ev) {
      if (!Array.isArray(ev.ask)) errors.push(`${at}: "ask" must be a list, e.g. ["intensity"]`);
      else ev.ask.forEach((a) => {
        if (!ASK_FIELDS.includes(a)) errors.push(`${at}: unknown ask field "${a}" (allowed: ${ASK_FIELDS.join(', ')})`);
      });
    }
    if ('private' in ev && typeof ev.private !== 'boolean') errors.push(`${at}: "private" must be true or false`);
    if ('displayLabel' in ev && typeof ev.displayLabel !== 'string') errors.push(`${at}: "displayLabel" must be text`);
  });

  checkList('exercises', (ex, at) => {
    if (!EXERCISE_TYPES.includes(ex.type)) errors.push(`${at}: "type" must be "reps" or "seconds"`);
    if ('allowWeight' in ex && typeof ex.allowWeight !== 'boolean') errors.push(`${at}: "allowWeight" must be true or false`);
  });

  const exIds = new Set((Array.isArray(obj.exercises) ? obj.exercises : []).map((e) => e && e.id));
  checkList('routines', (r, at) => {
    if (!Array.isArray(r.exercises)) errors.push(`${at}: "exercises" must be a list of exercise ids`);
    else r.exercises.forEach((id) => {
      if (!exIds.has(id)) errors.push(`${at}: exercise "${id}" does not exist in "exercises"`);
    });
  });

  return { ok: errors.length === 0, errors, config: errors.length ? null : out };
}

export function parseConfigText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${e.message}`], config: null };
  }
  return validateConfig(obj);
}

export function configToText(config) {
  return JSON.stringify(config, null, 2) + '\n';
}

async function fetchDefaultText() {
  const res = await fetch('./default_config.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Loads the config to run with. Never throws.
// Returns { config, errors, usingFallback }.
export async function loadConfig() {
  try {
    let text = await storage.getValue(KEY_TEXT);
    if (text == null) {
      // First run: start from the neutral default shipped with the app.
      text = await fetchDefaultText();
      await storage.setValue(KEY_TEXT, text);
    }
    const res = parseConfigText(text);
    if (res.ok) {
      await storage.setValue(KEY_GOOD, res.config);
      return { config: res.config, errors: [], usingFallback: false };
    }
    const good = await storage.getValue(KEY_GOOD);
    return { config: good || EMPTY, errors: res.errors, usingFallback: true };
  } catch (e) {
    // Even storage/network failing must not stop the app from opening.
    let good = null;
    try { good = await storage.getValue(KEY_GOOD); } catch { /* ignore */ }
    return { config: good || EMPTY, errors: [`Could not load config: ${e.message}`], usingFallback: true };
  }
}

// Saves a new config ONLY if it validates. Returns the validation result.
export async function saveConfigText(text) {
  const res = parseConfigText(text);
  if (res.ok) {
    await storage.setValue(KEY_TEXT, text);
    await storage.setValue(KEY_GOOD, res.config);
  }
  return res;
}

export function saveConfig(config) {
  return saveConfigText(configToText(config));
}

export async function getConfigText() {
  return (await storage.getValue(KEY_TEXT)) ?? configToText(EMPTY);
}

export async function resetToDefault() {
  return saveConfigText(await fetchDefaultText());
}

// What to show ON SCREEN for an event. Private items show only their
// displayLabel; the real name is used only in the log record and exports.
export function eventLabel(ev) {
  if (ev.private) return ev.displayLabel || '•';
  return ev.name;
}
