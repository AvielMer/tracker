// Export (CSV + full JSON backup) and import of a backup.

import { FIELDS, normalizeRecord } from './record.js';
import { isoWithTz } from './util.js';

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(entries) {
  // One column per custom number field (m_weight, m_temp, ...), so
  // spreadsheets get plain numbers instead of a JSON blob.
  const base = FIELDS.filter((f) => f !== 'measures');
  const mKeys = [...new Set(entries.flatMap((e) => Object.keys(e.measures || {})))].sort();
  const lines = [[...base, ...mKeys.map((k) => `m_${k}`)].join(',')];
  for (const e of entries) {
    const m = e.measures || {};
    lines.push([...base.map((f) => csvCell(e[f])), ...mKeys.map((k) => csvCell(m[k]))].join(','));
  }
  // BOM so Excel/Sheets on the phone read non-English notes correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function toBackup(entries, configText) {
  let config;
  try { config = JSON.parse(configText); } catch { config = configText; }
  return JSON.stringify({
    app: 'tracker',
    format: 1,
    exported_at: isoWithTz(),
    config,
    entries,
  }, null, 1);
}

// Accepts our backup file, a plain JSON list of records, or a .jsonl log
// (one record per line, the format the APK will use).
// Returns { records, invalid, configText|null }. Throws only if the file
// is not readable as any of those.
export function parseBackup(text) {
  let data = null;
  try { data = JSON.parse(text); } catch { /* maybe JSONL */ }

  let raw;
  let configText = null;
  if (Array.isArray(data)) raw = data;
  else if (data && Array.isArray(data.entries)) {
    raw = data.entries;
    if (data.config != null) {
      configText = typeof data.config === 'string' ? data.config : JSON.stringify(data.config, null, 2) + '\n';
    }
  } else if (data === null) {
    raw = [];
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    for (const line of lines) {
      try { raw.push(JSON.parse(line)); } catch { raw.push(null); }
    }
    if (!lines.length) throw new Error('The file is empty');
  } else {
    throw new Error('This does not look like a Tracker backup');
  }

  const records = [];
  let invalid = 0;
  for (const r of raw) {
    const rec = normalizeRecord(r);
    if (rec) records.push(rec); else invalid++;
  }
  if (!records.length && invalid) throw new Error(`No valid entries found (${invalid} unreadable)`);
  return { records, invalid, configText };
}
