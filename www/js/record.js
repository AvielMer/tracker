// The shape of one log record. Every record has ALL fields (null when not
// used) so CSV columns and later analysis are always consistent.

import { isoWithTz, localDate, localTime, newId } from './util.js';

export const FIELDS = [
  'id', 'ts', 'date', 'time', 'kind', 'item_id', 'item_name', 'nth_today',
  'session_id', 'set_no', 'reps', 'seconds', 'weight', 'work_sec', 'rest_sec', 'intensity',
  'duration_min', 'choice', 'amount', 'unit', 'count', 'bp_sys', 'bp_dia',
  'pulse', 'measures', 'mood', 'note',
];
// "mood": the answer to "How do you feel?", 1 (awful) to 5 (great).
// work_sec / rest_sec (training sets): how long the set took, and how long
// the rest before it was (from the end of the previous set to "Start set").
// "measures" is an object { measure_id: number } for a button's own number
// fields (e.g. { "weight": 78.5 }). In CSV it becomes one column per id,
// named m_<id>, so it stays easy to analyse in a spreadsheet.

// event_start / event_end: a start/finish button ("span"), e.g. a water
// bottle opened today and finished tomorrow. The end's session_id is the
// start's id and its duration_min is the time between them.
export const KINDS = ['event', 'set', 'session_start', 'session_end', 'event_start', 'event_end'];

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
  if (rec.measures !== null && (typeof rec.measures !== 'object' || Array.isArray(rec.measures))) rec.measures = null;
  return rec;
}
