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

// What a button can ask after a tap. Each one fills the log field of the
// same name ("amount" also fills "unit" from the event's config).
// "bp" asks blood pressure + pulse as a series of readings (bp_sys,
// bp_dia, pulse); it can be combined only with "note".
export const ASK_FIELDS = ['intensity', 'duration_min', 'choice', 'amount', 'count', 'bp', 'note'];
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
    const ask = Array.isArray(ev.ask) ? ev.ask : [];
    if (ask.includes('bp') && ask.some((a) => a !== 'bp' && a !== 'note')) {
      errors.push(`${at}: "bp" can only be combined with "note"`);
    }
    if ('choices' in ev || ask.includes('choice')) {
      if (!Array.isArray(ev.choices) || !ev.choices.length
          || ev.choices.some((c) => typeof c !== 'string' || !c.trim())) {
        errors.push(`${at}: "choices" must be a list of names, e.g. ["Paracetamol", "Nurofen"]`);
      }
    }
    if ('amount' in ev || ask.includes('amount')) {
      const a = ev.amount;
      if (!a || typeof a !== 'object' || typeof a.unit !== 'string'
          || !Array.isArray(a.values) || !a.values.length
          || a.values.some((v) => typeof v !== 'number' || !(v > 0))) {
        errors.push(`${at}: "amount" must look like { "unit": "mg", "values": [200, 400] }`);
      }
    }
    if ('color' in ev && !(typeof ev.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(ev.color))) {
      errors.push(`${at}: "color" must look like "#e5534b"`);
    }
    if ('private' in ev && typeof ev.private !== 'boolean') errors.push(`${at}: "private" must be true or false`);
    if ('displayLabel' in ev && typeof ev.displayLabel !== 'string') errors.push(`${at}: "displayLabel" must be text`);
  });

  checkList('exercises', (ex, at) => {
    if (!EXERCISE_TYPES.includes(ex.type)) errors.push(`${at}: "type" must be "reps" or "seconds"`);
    if ('allowWeight' in ex && typeof ex.allowWeight !== 'boolean') errors.push(`${at}: "allowWeight" must be true or false`);
    // "start": the number the +/- stepper starts at the first time.
    if ('start' in ex && !(typeof ex.start === 'number' && ex.start > 0)) errors.push(`${at}: "start" must be a number above 0`);
  });

  const exIds = new Set((Array.isArray(obj.exercises) ? obj.exercises : []).map((e) => e && e.id));
  checkList('routines', (r, at) => {
    if (!Array.isArray(r.exercises)) { errors.push(`${at}: "exercises" must be a list of exercise ids`); return; }
    // Each step is an exercise id, or { "id": ..., "sets": 3, "reps": 8 }
    // to set a goal ("reps" means seconds for a seconds exercise).
    r.exercises.forEach((step, j) => {
      const id = typeof step === 'string' ? step : step && step.id;
      if (!exIds.has(id)) errors.push(`${at}.exercises[${j}]: exercise "${id}" does not exist in "exercises"`);
      if (step && typeof step === 'object') {
        for (const k of ['sets', 'reps']) {
          if (k in step && !(Number.isInteger(step[k]) && step[k] > 0)) errors.push(`${at}.exercises[${j}]: "${k}" must be a whole number above 0`);
        }
      }
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

// A routine step as { id, sets, reps } whether it was written as a plain
// id or as an object.
export function routineSteps(routine) {
  return (routine.exercises || []).map((s) => (typeof s === 'string'
    ? { id: s, sets: null, reps: null }
    : { id: s.id, sets: s.sets ?? null, reps: s.reps ?? null }));
}

// Readable ids for normal items ("pull_ups"); random ids when the name has
// no latin letters, or for private items (so the id never reveals the
// name). An id never changes after creation, so renaming keeps old log
// entries linked to the item.
export function makeId(list, name) {
  const used = new Set(list.map((x) => x.id));
  let base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!base) base = 'p_' + Math.random().toString(36).slice(2, 7);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  return id;
}

// Adds exercises and routines from the shipped default config that the
// user's config doesn't have yet (matched by id). Nothing existing is
// changed. Returns how many were added.
export async function addMissingPresets(current) {
  const def = JSON.parse(await fetchDefaultText());
  const cfg = JSON.parse(JSON.stringify(current));
  let added = 0;
  for (const key of ['exercises', 'routines']) {
    const have = new Set(cfg[key].map((x) => x.id));
    for (const item of def[key] || []) {
      if (!have.has(item.id)) { cfg[key].push(item); added++; }
    }
  }
  if (added) {
    const res = await saveConfig(cfg);
    if (!res.ok) throw new Error(res.errors[0]);
  }
  return added;
}

// Button colours offered in the editor. Any "#rrggbb" works in the config;
// these are picked to stay readable on the dark background.
export const COLORS = [
  ['#e5534b', 'Red'], ['#e8833a', 'Orange'], ['#d4a72c', 'Yellow'],
  ['#46b450', 'Green'], ['#2bb5a0', 'Teal'], ['#4f9cf9', 'Blue'],
  ['#7b6cf6', 'Indigo'], ['#b06ad9', 'Purple'], ['#e0559a', 'Pink'],
  ['#8b949e', 'Gray'],
];
