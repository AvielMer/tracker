// The built-in exercise library (exercise_library.json): ~100 street
// workout / calisthenics exercises with names in every UI language.
//
// The library is reference data shipped with the app, NOT your config:
// nothing from it is used until you add it, and adding copies it into your
// tracker_config.json where you can rename or change it like anything else.

import { fetchDefaultFor, makeId } from './config.js';
import {
  getLang, getPack, isBuiltInLang, LANGS, packText,
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
  // The added language's names count as built-in names too, whatever the
  // target: an item renamed INTO it must be recognised (and renamed back)
  // when another language is chosen — otherwise it looks like a name the
  // user typed and stays in that language for good.
  const pack = getPack();
  const packName = (key) => pack?.texts[key] || null;

  // Per section: built-in items as { id, names: { en, he, ru }, packName, parts }.
  const builtIn = { events: new Map(), exercises: new Map(), routines: new Map() };
  defs.forEach((d, i) => {
    if (!d) return;
    for (const sec of Object.keys(builtIn)) {
      for (const it of d[sec] || []) {
        const b = builtIn[sec].get(it.id) || { id: it.id, names: {}, packName: packName(`def:${sec}:${it.id}`) };
        b.names[codes[i]] = it.name;
        builtIn[sec].set(it.id, b);
      }
    }
  });
  for (const e of lib.exercises) {
    const b = builtIn.exercises.get(e.id) || { id: e.id, names: {} };
    b.names = { ...e.name, ...b.names };
    b.packName = packName(`lib:${e.id}`);
    b.parts = e.parts;
    builtIn.exercises.set(e.id, b);
  }
  const hasName = (b, n) => Object.values(b.names).some((x) => normName(x) === n)
    || (!!b.packName && normName(b.packName) === n);
  const find = (sec, n) => [...builtIn[sec].values()].find((x) => hasName(x, n));
  // The name in the chosen language. An added language only has the names
  // its translation has — never English instead.
  const targetOf = (b) => (pack && lang === pack.code && b.packName)
    || b.names[lang] || (isBuiltInLang(lang) ? b.names.en : null);

  const cfg = JSON.parse(JSON.stringify(current));
  let changed = 0;
  for (const sec of Object.keys(builtIn)) {
    for (const it of cfg[sec]) {
      const n = normName(it.name);
      // Same id with a built-in name; or (e.g. "chin-ups" you added
      // yourself under another id) any built-in item with exactly that name.
      let b = builtIn[sec].get(it.id);
      if (!b || !hasName(b, n)) b = find(sec, n);
      if (!b) continue;
      const entry = b.parts ? b : null;
      const target = targetOf(b);
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
  // A circuit part named after a built-in exercise (e.g. picked from the
  // list while the app was in another language) follows that exercise.
  for (const it of cfg.exercises) {
    if (!Array.isArray(it.parts)) continue;
    it.parts = it.parts.map((p) => {
      const name = typeof p === 'string' ? p : p?.name;
      const b = find('exercises', normName(name));
      const target = b && targetOf(b);
      if (!target || target === name) return p;
      changed++;
      return typeof p === 'string' ? target : { ...p, name: target };
    });
  }
  return { cfg, changed };
}
