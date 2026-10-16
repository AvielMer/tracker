// The shape of one log record. Every record has ALL fields (null when not
// used) so CSV columns and later analysis are always consistent.

import { isoWithTz, localDate, localTime, newId } from './util.js';

export const FIELDS = [
  'id', 'ts', 'date', 'time', 'kind', 'item_id', 'item_name', 'nth_today',
  'session_id', 'set_no', 'reps', 'seconds', 'weight', 'intensity',
  'duration_min', 'choice', 'amount', 'unit', 'count', 'note',
];

export const KINDS = ['event', 'set', 'session_start', 'session_end'];

export function makeRecord(fields, now = new Date()) {
  const rec = {};
  for (const f of FIELDS) rec[f] = null;
  Object.assign(rec, {
    id: newId(),
    ts: isoWithTz(now),
    date: localDate(now),
    time: localTime(now),
  }, fields);
  return rec;
}

// Used when importing a backup: accept only things that look like records,
// and fill in any missing fields so old/partial files still import.
export function normalizeRecord(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.ts !== 'string' || Number.isNaN(Date.parse(r.ts))) return null;
  if (!KINDS.includes(r.kind)) return null;
  const rec = {};
  for (const f of FIELDS) rec[f] = r[f] ?? null;
  return rec;
}
