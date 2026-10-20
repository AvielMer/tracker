// The built-in exercise library (exercise_library.json): ~100 street
// workout / calisthenics exercises with names in every UI language.
//
// The library is reference data shipped with the app, NOT your config:
// nothing from it is used until you add it, and adding copies it into your
// tracker_config.json where you can rename or change it like anything else.

import { fetchDefaultFor, makeId } from './config.js';
import {
  getLang, isBuiltInLang, LANGS, packText,
} from './i18n.js';

let libPromise = null;

export function loadLibrary() {
  if (!libPromise) {
    libPromise = fetch('./exercise_library.json')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .catch((e) => { libPromise = null; throw e; });
  }
  return libPromise;
}

// For comparing names typed by people: "Chin-ups", "chin ups" and
// "CHINUPS" are the same exercise.
export function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

// A library name in a language: built-in names, or the added language's
// translation ("lib:<id>", "cat:<id>"), else English.
export function libName(entry, lang = getLang()) {
  return entry.name[lang] || packText(`lib:${entry.id}`, lang) || entry.name.en;
}

export function catName(cat, lang = getLang()) {
  return cat.name[lang] || packText(`cat:${cat.id}`, lang) || cat.name.en;
}

// The user's exercise that is this library exercise: same id, or the same
// name in any language. Used to avoid adding duplicates.
export function findInConfig(cfg, entry) {
  const names = new Set(Object.values(entry.name).map(normName));
  return cfg.exercises.find((x) => x.id === entry.id || names.has(normName(x.name))) || null;
}

// A config exercise made from a library entry, named in the current language.
export function fromLibrary(entry, existing, lang = getLang()) {
  const id = existing.some((x) => x.id === entry.id) ? makeId(existing, entry.name.en) : entry.id;
  const ex = { id, name: libName(entry, lang), type: entry.type };
  if (entry.allowWeight) ex.allowWeight = true;
  if (entry.start) ex.start = entry.start;
  // Circuits get their own seconds per part (the library's "start" each).
  if (entry.parts) ex.parts = (entry.parts[lang] || entry.parts.en).map((name) => ({ name, seconds: entry.start || 30 }));
  return ex;
}

// Renames BUILT-IN items (starting buttons, exercises, routines) to the
// current language. Only items whose name is still exactly a built-in name
// (in any language) are touched, so anything you named yourself stays as
// you wrote it. Ids never change, so the history stays linked.
// Returns { cfg, changed }.
export async function translateBuiltInNames(current, lang = getLang()) {
  const codes = LANGS.map(([c]) => c);
  const [lib, ...defs] = await Promise.all([
    loadLibrary(),
    ...codes.map((c) => fetchDefaultFor(c).then((txt) => JSON.parse(txt)).catch(() => null)),
  ]);

  // Per section: built-in items as { id, names: { en, he, ru }, parts }.
  const builtIn = { events: new Map(), exercises: new Map(), routines: new Map() };
  defs.forEach((d, i) => {
    if (!d) return;
    for (const sec of Object.keys(builtIn)) {
      for (const it of d[sec] || []) {
        const b = builtIn[sec].get(it.id) || { id: it.id, names: {} };
        b.names[codes[i]] = it.name;
        builtIn[sec].set(it.id, b);
      }
    }
  });
  for (const e of lib.exercises) {
    const b = builtIn.exercises.get(e.id) || { id: e.id, names: {} };
    b.names = { ...e.name, ...b.names };
    // An added language knows only the names its translation has.
    if (!isBuiltInLang(lang) && packText(`lib:${e.id}`, lang)) b.names[lang] = packText(`lib:${e.id}`, lang);
    b.parts = e.parts;
    builtIn.exercises.set(e.id, b);
  }
  const hasName = (b, n) => Object.values(b.names).some((x) => normName(x) === n);

  const cfg = JSON.parse(JSON.stringify(current));
  let changed = 0;
  for (const sec of Object.keys(builtIn)) {
    for (const it of cfg[sec]) {
      const n = normName(it.name);
      // Same id with a built-in name; or (e.g. "chin-ups" you added
      // yourself under another id) any built-in item with exactly that name.
      let b = builtIn[sec].get(it.id);
      if (!b || !hasName(b, n)) b = [...builtIn[sec].values()].find((x) => hasName(x, n));
      if (!b) continue;
      const names = b.names;
      const entry = b.parts ? b : null;
      // (For an added language: only names it really has, never English.)
      const target = names[lang] || (isBuiltInLang(lang) ? names.en : null);
      if (target && target !== it.name) { it.name = target; changed++; }
      // Circuit parts are translated only if they are still the built-in ones.
      if (entry?.parts && Array.isArray(it.parts)) {
        const nameOf = (p) => (typeof p === 'string' ? p : p?.name);
        const same = Object.values(entry.parts).some((p) => p.length === it.parts.length
          && p.every((x, i) => normName(x) === normName(nameOf(it.parts[i]))));
        const want = entry.parts[lang] || (isBuiltInLang(lang) ? entry.parts.en : null);
        if (same && want && want.some((w, i) => w !== nameOf(it.parts[i]))) {
          // Keep each part's seconds; only the names change.
          it.parts = it.parts.map((p, i) => (typeof p === 'string' ? want[i] : { ...p, name: want[i] }));
          changed++;
        }
      }
    }
  }
  return { cfg, changed };
}
