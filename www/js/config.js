// Config: all events, exercises and routines come from tracker_config.json.
// Nothing about WHICH items exist is hardcoded in the JavaScript.
//
// Safety rule (same as watch_drift): a broken config must never crash the
// app. We keep the raw text the user saved AND the last config that passed
// validation. If the current text is broken, we run on the last good one
// and show exactly what's wrong.

import * as storage from './storage.js';
import { getLang } from './i18n.js';

const KEY_TEXT = 'config_text';      // what the user saved (may be broken)
const KEY_GOOD = 'config_last_good'; // last version that validated

// What a button can ask after a tap. Each one fills the log field of the
// same name ("amount" also fills "unit" from the event's config).
// "bp" asks blood pressure + pulse as a series of readings (bp_sys,
// bp_dia, pulse); it can be combined only with "measures" and "note".
// "measures" asks the button's own number fields (e.g. weight in kg),
// stored in the record's "measures" object as { id: number }.
// "mood" asks "How do you feel?" with five faces, stored as 1 (awful) to
// 5 (great) in the record's "mood" field.
export const ASK_FIELDS = ['mood', 'intensity', 'duration_min', 'choice', 'amount', 'count', 'bp', 'measures', 'note'];
// Reminder days, indexed like Date.getDay().
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
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

  // "remind" (event buttons and routines): [{ "time": "21:00" }] every day,
  // or with "days": ["mon", "wed", "fri"]. See reminders.js.
  const checkRemind = (it, at) => {
    if (!('remind' in it)) return;
    const ok = Array.isArray(it.remind) && it.remind.length <= 12 && it.remind.every((r) => r && typeof r === 'object'
      && typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)
      && (!('days' in r) || (Array.isArray(r.days) && r.days.length && r.days.every((d) => DAYS.includes(d))
        && new Set(r.days).size === r.days.length)));
    if (!ok) errors.push(`${at}: "remind" must look like [{ "time": "21:00" }] or [{ "time": "08:30", "days": ["mon", "wed", "fri"] }]`);
  };

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
    if (ask.includes('bp') && ask.some((a) => !['bp', 'measures', 'note'].includes(a))) {
      errors.push(`${at}: "bp" can only be combined with "measures" and "note"`);
    }
    if ('measures' in ev || ask.includes('measures')) {
      const m = ev.measures;
      const ids = new Set();
      if (!Array.isArray(m) || !m.length || m.some((x) => !x || typeof x.id !== 'string' || !x.id
          || typeof x.name !== 'string' || !x.name.trim() || ('unit' in x && typeof x.unit !== 'string')
          || ids.size === ids.add(x.id).size)) {
        errors.push(`${at}: "measures" must look like [{ "id": "weight", "name": "Weight", "unit": "kg" }] with different ids`);
      }
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
    // "span": true makes a start/finish button (see record.js event_start).
    if ('span' in ev && typeof ev.span !== 'boolean') errors.push(`${at}: "span" must be true or false`);
    if (ev.span && ask.includes('bp')) errors.push(`${at}: a start/finish button ("span") can't ask "bp"`);
    if ('private' in ev && typeof ev.private !== 'boolean') errors.push(`${at}: "private" must be true or false`);
    checkRemind(ev, at);
    if ('displayLabel' in ev && typeof ev.displayLabel !== 'string') errors.push(`${at}: "displayLabel" must be text`);
  });

  checkList('exercises', (ex, at) => {
    if (!EXERCISE_TYPES.includes(ex.type)) errors.push(`${at}: "type" must be "reps" or "seconds"`);
    if ('allowWeight' in ex && typeof ex.allowWeight !== 'boolean') errors.push(`${at}: "allowWeight" must be true or false`);
    // "start": the number the +/- stepper starts at the first time.
    if ('start' in ex && !(typeof ex.start === 'number' && ex.start > 0)) errors.push(`${at}: "start" must be a number above 0`);
    // "parts": a timed circuit — several exercises in a row without
    // stopping, a beep at every switch. Each part is { "name", "seconds" }
    // (or just a name: then all parts use the +/- stepper's seconds).
    // A part's "ex" is the id of the exercise it is; when that exercise is
    // counted in reps, the part means "as many as you can in the time" and
    // the app asks how many at the end (an unknown id is just ignored).
    // "rounds": repeat the whole list; "pause": seconds between parts.
    if ('parts' in ex) {
      if (ex.type !== 'seconds') errors.push(`${at}: "parts" only works with "type": "seconds"`);
      const okPart = (p) => (typeof p === 'string' && p.trim())
        || (p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim()
          && Number.isInteger(p.seconds) && p.seconds > 0 && p.seconds <= 3600
          && (!('ex' in p) || (typeof p.ex === 'string' && p.ex)));
      if (!Array.isArray(ex.parts) || !ex.parts.length || ex.parts.length > 30 || !ex.parts.every(okPart)) {
        errors.push(`${at}: "parts" must look like [{ "name": "Plank", "seconds": 30 }, { "name": "Sit-ups", "seconds": 30, "ex": "situps" }]`);
      }
    }
    if ('rounds' in ex && !(Number.isInteger(ex.rounds) && ex.rounds >= 1 && ex.rounds <= 50)) {
      errors.push(`${at}: "rounds" must be a whole number from 1 to 50`);
    }
    if ('pause' in ex && !(Number.isInteger(ex.pause) && ex.pause >= 0 && ex.pause <= 600)) {
      errors.push(`${at}: "pause" must be a whole number of seconds from 0 to 600`);
    }
  });

  const exIds = new Set((Array.isArray(obj.exercises) ? obj.exercises : []).map((e) => e && e.id));
  checkList('routines', (r, at) => {
    checkRemind(r, at);
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

  // "language": one more UI language, translated by an AI (see i18n.js):
  // { "code": "fr", "name": "Français", "dir": "ltr", "texts": { … } }.
  if (obj.language != null) {
    const L = obj.language;
    if (typeof L !== 'object' || Array.isArray(L)) {
      errors.push('"language" must look like { "code": "fr", "name": "Français", "dir": "ltr", "texts": { ... } }');
    } else {
      if (typeof L.code !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(L.code)) errors.push('language: "code" must be a language code like "fr" or "pt-BR"');
      if (typeof L.name !== 'string' || !L.name.trim()) errors.push('language: "name" is missing (the language\'s own name, e.g. "Français")');
      if ('dir' in L && !['ltr', 'rtl'].includes(L.dir)) errors.push('language: "dir" must be "ltr" or "rtl"');
      if (!L.texts || typeof L.texts !== 'object' || Array.isArray(L.texts)) errors.push('language: "texts" must look like { "Events": "Événements", ... }');
      else if (Object.values(L.texts).some((v) => typeof v !== 'string')) errors.push('language: every text must be a string');
      out.language = { code: L.code, name: L.name, dir: L.dir === 'rtl' ? 'rtl' : 'ltr', texts: L.texts };
    }
  }

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

// The starting config in the current UI language (same ids in every
// language, so presets and history line up); English if that's missing.
function fetchDefaultText() {
  return fetchDefaultFor(getLang());
}

export async function fetchDefaultFor(lang) {
  const files = lang === 'en' ? ['default_config.json'] : [`default_config.${lang}.json`, 'default_config.json'];
  let last;
  for (const f of files) {
    try {
      const res = await fetch(`./${f}`, { cache: 'no-cache' });
      if (res.ok) return await res.text();
      last = new Error(`HTTP ${res.status}`);
    } catch (e) { last = e; }
  }
  throw last;
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

// Circuits: an exercise counted in seconds with a list of parts.
export const isCircuit = (ex) => ex?.type === 'seconds' && Array.isArray(ex.parts) && ex.parts.length > 0;
// Every part has its own seconds (the format the circuit editor writes).
export const hasOwnTimes = (ex) => isCircuit(ex) && ex.parts.every((p) => typeof p === 'object');
// A circuit's parts as [{ name, seconds, ex }]; parts written as plain
// names (older format) all use eachSec, the +/- stepper's seconds.
export function circuitParts(ex, eachSec) {
  return (ex.parts || []).map((p) => (typeof p === 'string'
    ? { name: p, seconds: eachSec, ex: null } : { name: p.name, seconds: p.seconds, ex: p.ex || null }));
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
