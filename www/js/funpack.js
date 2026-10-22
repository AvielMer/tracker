// Cute animations for the Cycle tab, as a separate download — asked for
// (feedback from girls using the app: "the cycle tab is too plain") as
// "smiley animal themes and interactive animations; since it might be
// heavy, a separate thing you click to download in the app, so the app
// stays clean".
//
// The pack is www/fun/pack.js. It is NOT in the service worker's list, so
// the app itself stays small. "Download" fetches it once and keeps its code
// on the phone (kv "fun_pack", through storage.js like all storage), so it
// works offline and survives app updates; "Remove" deletes it. It is loaded
// from that copy (a Blob URL), never from the network again. In the APK
// the same fetch reads the file from inside the app.
// The pack only draws: every text it shows comes from the app (i18n).

import * as storage from './storage.js';

// The pack this version of the app was made with (pack.js VERSION): an
// older copy keeps working, and Cycle settings offers the update.
export const PACK_VERSION = 1;
// How the app talks to the pack (pack.js API). A copy with another API is
// not used — Settings asks to download it again.
const PACK_API = 1;
const URL_ = './fun/pack.js';
const KEY = 'fun_pack'; // { version, api, code, bytes, at }
const PREFS = 'fun_prefs'; // { animal }
const OFFER = 'fun_offer'; // 'no' = "Not now" on the Cycle tab's card
const MAX_BYTES = 400000; // a pack is ~35 KB; anything huge isn't ours

let stored; // undefined = not read yet, null = none
let loading = null;

async function readStored() {
  if (stored === undefined) {
    try { stored = (await storage.getValue(KEY)) || null; } catch { stored = null; }
  }
  return stored;
}

// { installed, version, bytes, outdated, broken }
export async function funInfo() {
  const s = await readStored();
  if (!s) return { installed: false };
  return {
    installed: true, version: s.version, bytes: s.bytes, outdated: s.version < PACK_VERSION, broken: s.api !== PACK_API,
  };
}

async function importCode(code) {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    return await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const usable = (m) => !!m && m.API === PACK_API && typeof m.mountStage === 'function'
  && typeof m.buddySvg === 'function' && Array.isArray(m.ANIMALS);

// The pack's module, or null (not downloaded, or it doesn't load — the
// Cycle tab then simply shows no animations; it never breaks the tab).
export function loadFun() {
  if (!loading) {
    loading = (async () => {
      const s = await readStored();
      if (!s || s.api !== PACK_API) return null;
      const m = await importCode(s.code);
      return usable(m) ? m : null;
    })().catch(() => null);
  }
  return loading;
}

// Downloads the pack and keeps it. Throws (with the reason) on failure;
// the copy already on the phone, if any, stays as it was.
export async function downloadFun() {
  const res = await fetch(URL_, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const code = await res.text();
  if (code.length > MAX_BYTES) throw new Error('too big');
  // Checked before it is kept: it must load and be an animation pack.
  const m = await importCode(code);
  if (!usable(m)) throw new Error('not an animation pack');
  const rec = { version: m.VERSION, api: m.API, code, bytes: new Blob([code]).size, at: new Date().toISOString() };
  await storage.setValue(KEY, rec);
  stored = rec;
  loading = Promise.resolve(m);
  return funInfo();
}

// Removed on purpose: the Cycle tab doesn't offer them again (Settings does).
export async function removeFun() {
  await storage.setValue(KEY, null);
  await storage.setValue(OFFER, 'no');
  stored = null;
  loading = null;
}

export async function funPrefs() {
  let p = null;
  try { p = await storage.getValue(PREFS); } catch { /* defaults */ }
  return { animal: 'bunny', ...(p || {}) };
}

export async function setFunPrefs(change) {
  await storage.setValue(PREFS, { ...(await funPrefs()), ...change });
}

export async function offerDismissed() {
  try { return (await storage.getValue(OFFER)) === 'no'; } catch { return false; }
}

export function dismissOffer() {
  return storage.setValue(OFFER, 'no');
}

// "36 KB"
export const sizeText = (bytes) => `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`;
