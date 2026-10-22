// Pick-lists: a button's own lists of answers to tap, e.g. Flow (Light,
// Medium, Heavy), Symptoms (several at once), Energy… Each answer can have a
// small emoji icon, shown in a round badge on the pill — asked for as
// "activities like the My Calendar app's, that look similar".
//
// Config (on an event button, asked with "ask": [..., "lists", ...]):
//   "lists": [{ "id": "flow", "name": "Flow", "options": ["Light",
//              { "name": "Heavy", "icon": "🩸" }], "multi": false }]
// Log record: "answers": { "flow": "Heavy", "symptoms": ["Cramps", "Acne"] }
// — the option NAMES, so the log and the CSV read on their own (like
// "choice"). A list's id never changes once created; renaming an option
// only affects new answers.

import { esc } from './util.js';
import { t } from './i18n.js';

export const optName = (o) => (typeof o === 'string' ? o : o?.name || '');
export const optIcon = (o) => (typeof o === 'string' ? '' : o?.icon || '');

// The lists to show/edit for an entry: the button's lists, plus any stored
// answer whose list was removed from the button since (shown as-is).
export function listDefs(item, answers) {
  const defs = [...(item?.lists || [])];
  for (const [id, v] of Object.entries(answers || {})) {
    if (!defs.some((l) => l.id === id)) defs.push({ id, name: id, options: [].concat(v), multi: Array.isArray(v) });
  }
  return defs;
}

const picked = (answers, l) => [].concat(answers?.[l.id] ?? []);

// One card per list, its answers as pills. answers marks the chosen ones.
export function listsHtml(lists, answers = {}) {
  return lists.map((l) => {
    const on = new Set(picked(answers, l));
    // A stored answer that is no longer an option still shows (and can be
    // unticked), so editing an old entry never loses it silently.
    const opts = [...l.options, ...[...on].filter((v) => !l.options.some((o) => optName(o) === v))];
    return `<div class="opt-card">
      <div class="label">${esc(l.name)}${l.multi ? ` <span class="opt-hint">${esc(t('several at once'))}</span>` : ''}</div>
      <div class="opts" data-list="${esc(l.id)}" data-multi="${l.multi ? 1 : 0}">${opts.map((o) => {
        const name = optName(o);
        const icon = optIcon(o);
        return `<button class="opt${on.has(name) ? ' on' : ''}" data-v="${esc(name)}" aria-pressed="${on.has(name)}">${icon ? `<span class="opt-ico">${esc(icon)}</span>` : ''}<span>${esc(name)}</span></button>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

// Wires the pills inside root. onPick(listId) runs after every tap.
// Returns read(): the answers as { listId: name | [names] }, or null.
export function wireLists(root, lists, answers = {}, onPick = () => {}) {
  const state = new Map(lists.map((l) => [l.id, new Set(picked(answers, l))]));
  root.querySelectorAll('.opts[data-list]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const pill = e.target.closest('.opt');
      if (!pill) return;
      const id = group.dataset.list;
      const set = state.get(id) || new Set();
      const v = pill.dataset.v;
      if (group.dataset.multi !== '1') {
        // One answer: a second tap on the chosen pill unpicks it.
        const was = set.has(v);
        set.clear();
        if (!was) set.add(v);
      } else if (set.has(v)) set.delete(v);
      else set.add(v);
      state.set(id, set);
      group.querySelectorAll('.opt').forEach((p) => {
        p.classList.toggle('on', set.has(p.dataset.v));
        p.setAttribute('aria-pressed', set.has(p.dataset.v));
      });
      onPick(id);
    });
  });
  return () => {
    const out = {};
    for (const l of lists) {
      const set = state.get(l.id);
      if (!set || !set.size) continue;
      // Keep the options' own order, whatever order they were tapped in.
      const order = l.options.map(optName);
      const vals = [...set].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
      out[l.id] = l.multi ? vals : vals[0];
    }
    return Object.keys(out).length ? out : null;
  };
}

// "Flow: Heavy · Symptoms: Cramps, Acne" — for the log.
export function answersText(item, answers) {
  if (!answers) return '';
  return listDefs(item, answers).filter((l) => [].concat(answers[l.id] ?? []).length)
    .map((l) => `${l.name}: ${[].concat(answers[l.id]).join(', ')}`).join(' · ');
}

// The button editor writes options as text: "🩸 Light, 🩸🩸 Heavy, Spotting".
// A first word that starts with a symbol (not a letter or digit) is the icon.
export function parseOptions(text) {
  return String(text || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^([^\p{L}\p{N}\s]\S{0,11})\s+(.+)$/u.exec(s);
    return m ? { name: m[2].trim(), icon: m[1] } : s;
  });
}

export const optionsToText = (options) => (options || [])
  .map((o) => (optIcon(o) ? `${optIcon(o)} ${optName(o)}` : optName(o))).join(', ');
