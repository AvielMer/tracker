// storage.js — the ONLY module allowed to touch persistent storage.
//
// WHY one module: the web version stores data in IndexedDB, but the APK
// version (step 5) will store it as visible files in Documents/Tracker/
// (tracker_log.jsonl + tracker_config.json) via Capacitor Filesystem.
// Keeping every read/write behind this small interface means that swap
// changes this one file and nothing else.
//
// Interface:
//   appendEntry(rec)          add a NEW log record (never overwrites)
//   updateEntry(id, patch)    explicit edit of one record
//   deleteEntry(id)           explicit delete, returns the removed record
//   restoreEntry(rec)         put a record back (used by Undo)
//   mergeEntries(recs)        add records whose id is not stored yet (import)
//   listEntries()             all records, oldest first
//   getValue(key) / setValue(key, value)   small key/value store
//                             (config text, last good config, open session)
//   requestPersistence() / isPersisted()

const DB_NAME = 'tracker';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('log')) {
          db.createObjectStore('log', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null; // allow a retry instead of caching the failure
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

// Runs fn inside one transaction and resolves only when the transaction
// has COMMITTED (oncomplete), not when the request succeeded.
// WHY: a request "success" can still be rolled back if the app is killed
// before commit. Waiting for oncomplete, plus durability "strict" (flush to
// disk before reporting done), is what makes a write crash-safe: once the
// UI says "logged", the entry is really on disk.
function run(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const opts = mode === 'readwrite' ? { durability: 'strict' } : undefined;
    const t = db.transaction(storeName, mode, opts);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
    fn(t.objectStore(storeName), (v) => { out = v; });
  }));
}

export function appendEntry(rec) {
  // add() (not put()) fails if the id already exists, so an append can
  // never silently overwrite an old entry.
  return run('log', 'readwrite', (s, done) => {
    s.add(rec).onsuccess = () => done(rec);
  });
}

export function updateEntry(id, patch) {
  return run('log', 'readwrite', (s, done) => {
    const g = s.get(id);
    g.onsuccess = () => {
      if (!g.result) { done(null); return; }
      const updated = { ...g.result, ...patch, id };
      s.put(updated).onsuccess = () => done(updated);
    };
  });
}

export function deleteEntry(id) {
  return run('log', 'readwrite', (s, done) => {
    const g = s.get(id);
    g.onsuccess = () => {
      if (!g.result) { done(null); return; }
      const old = g.result;
      s.delete(id).onsuccess = () => done(old);
    };
  });
}

export function restoreEntry(rec) {
  return run('log', 'readwrite', (s, done) => {
    s.put(rec).onsuccess = () => done(rec);
  });
}

export function mergeEntries(recs) {
  return run('log', 'readwrite', (s, done) => {
    let added = 0;
    let skipped = 0;
    for (const rec of recs) {
      const r = s.add(rec);
      r.onsuccess = () => { added++; done({ added, skipped }); };
      r.onerror = (e) => {
        // Already have this id: keep the stored one. preventDefault stops
        // this single failed add from aborting the whole import.
        e.preventDefault();
        skipped++;
        done({ added, skipped });
      };
    }
    if (!recs.length) done({ added, skipped });
  });
}

export async function listEntries() {
  const all = await run('log', 'readonly', (s, done) => {
    const r = s.getAll();
    r.onsuccess = () => done(r.result);
  });
  // Sort by real time, not by the ts string: entries made in different
  // time zones have different offsets, so string order could be wrong.
  return all.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

export function getValue(key) {
  return run('kv', 'readonly', (s, done) => {
    const r = s.get(key);
    r.onsuccess = () => done(r.result);
  });
}

export function setValue(key, value) {
  return run('kv', 'readwrite', (s, done) => {
    s.put(value, key).onsuccess = () => done(value);
  });
}

// Browsers may wipe site data when the phone is low on space unless the
// site has "persistent" storage. Ask for it so the log isn't evicted.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch { /* not supported: nothing else we can do */ }
  return false;
}

export async function isPersisted() {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      return await navigator.storage.persisted();
    }
  } catch { /* ignore */ }
  return false;
}
