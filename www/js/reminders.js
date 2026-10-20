// Reminders: config "remind" on event buttons and routines, e.g.
// [{ "time": "21:00" }] every day, or [{ "time": "18:00", "days": ["mon",
// "wed", "fri"] }].
//
// WHY the web app shows reminders only as cards: a web page can't wake the
// phone at a set time once it is closed (there is no server to send a push,
// and Android stops web apps in the background). So when the app is open,
// every reminder whose time has come today and that wasn't done yet shows as
// a card at the top of the Events screen. The Android app (step 5) will turn
// the same settings into real notifications.

import * as storage from './storage.js';
import { DAYS, eventLabel } from './config.js';
import { getLang, t } from './i18n.js';
import { esc, localDate } from './util.js';

const KEY = 'reminders_dismissed';
// Done a little early still counts: a mood check-in at 20:30 answers the
// 21:00 reminder, a pill taken at 07:40 the 08:00 one.
const EARLY_MS = 60 * 60 * 1000;

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// "21:00, 08:30" — for the small ⏰ tags in lists.
export const remindTimes = (item) => (item.remind || []).map((r) => r.time).join(', ');

// The latest reminder of an item whose time has come today: { time, at }.
function currentSlot(remind, now) {
  const day = DAYS[now.getDay()];
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const slots = (remind || []).filter((r) => !r.days || r.days.includes(day))
    .map((r) => ({ time: r.time, at: midnight.getTime() + minutesOf(r.time) * 60000 }))
    .filter((s) => s.at <= now.getTime())
    .sort((a, b) => a.at - b.at);
  return slots[slots.length - 1] || null;
}

// Reminders due now: [{ type: 'event' | 'routine', item, time, key }].
// Done = the button was logged (or the routine started) since an hour
// before the reminder. "Not now" hides a reminder until its next time.
export function dueReminders(state, now = new Date()) {
  const out = [];
  const date = localDate(now);
  const check = (type, item, kinds) => {
    const slot = currentSlot(item.remind, now);
    if (!slot) return;
    const key = `${type}:${item.id}:${date}:${slot.time}`;
    if (state.remindersDismissed?.has(key)) return;
    const from = slot.at - EARLY_MS;
    const done = state.entries.some((e) => e.item_id === item.id && kinds.includes(e.kind) && Date.parse(e.ts) >= from);
    if (!done) out.push({ type, item, time: slot.time, key });
  };
  for (const ev of state.config.events) if (!ev.hidden && ev.remind) check('event', ev, ['event', 'event_start', 'event_end']);
  for (const r of state.config.routines) if (!r.hidden && r.remind) check('routine', r, ['session_start']);
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export function remindersHtml(state) {
  const due = dueReminders(state);
  if (!due.length) return '';
  return `<div class="reminders">${due.map((r) => `<div class="reminder" data-key="${esc(r.key)}" data-type="${r.type}" data-id="${esc(r.item.id)}">
    <span class="rem-what"><span class="rem-time">⏰ ${esc(r.time)}</span>
      <b>${esc(r.type === 'event' ? eventLabel(r.item) : r.item.name)}</b></span>
    <button class="btn primary" data-rem-go>${r.type === 'event' ? t('Log now') : `▶ ${t('Start')}`}</button>
    <button class="ibtn" data-rem-x aria-label="${esc(t('Not now'))}">✕</button>
  </div>`).join('')}</div>`;
}

// "Not now" choices, kept for today only (the date is part of the key).
export async function loadDismissed() {
  try {
    const today = `:${localDate()}:`;
    return new Set(((await storage.getValue(KEY)) || []).filter((k) => k.includes(today)));
  } catch {
    return new Set();
  }
}

export async function dismissReminder(state, key) {
  state.remindersDismissed = state.remindersDismissed || new Set();
  state.remindersDismissed.add(key);
  await storage.setValue(KEY, [...state.remindersDismissed]).catch(() => {});
}

// --- the ⏰ part of the button and routine editors ---------------------------

// Weeks start on Sunday in Hebrew and Arabic, on Monday elsewhere.
const weekOrder = () => (['he', 'ar'].includes(getLang().split('-')[0]) ? DAYS : [...DAYS.slice(1), DAYS[0]]);

function dayLetter(d) {
  // 7 Jan 2024 was a Sunday.
  const date = new Date(2024, 0, 7 + DAYS.indexOf(d));
  try {
    return new Intl.DateTimeFormat(getLang(), { weekday: 'narrow' }).format(date);
  } catch {
    return d.slice(0, 1).toUpperCase();
  }
}

function remindRow(r = { time: '21:00' }) {
  const on = new Set(r.days || DAYS);
  return `<div class="rrow">
    <input class="input rtime" type="time" data-rtime value="${esc(r.time)}" aria-label="${esc(t('Time'))}">
    <div class="rdays">${weekOrder().map((d) => `<button class="rday${on.has(d) ? ' on' : ''}" data-day="${d}" aria-pressed="${on.has(d)}">${esc(dayLetter(d))}</button>`).join('')}</div>
    <button class="ibtn" data-rdel aria-label="${esc(t('Remove'))}">✕</button>
  </div>`;
}

export function remindEditorHtml(list) {
  return `<div class="label" style="margin-top:12px">⏰ ${t('Reminders')}</div>
    <div data-rlist>${(list || []).map(remindRow).join('')}</div>
    <button class="btn" data-radd>${t('+ Add a reminder')}</button>
    <p class="small muted">${esc(t('REMIND_WEB_NOTE'))}</p>`;
}

// Wires the editor part. Returns read(): { list } for the config (empty =
// no reminders), or { error }. read(true) returns the rows as they are,
// unchecked — to keep them when an editor redraws itself.
export function wireRemindEditor(root) {
  const list = root.querySelector('[data-rlist]');
  root.querySelector('[data-radd]').addEventListener('click', () => list.insertAdjacentHTML('beforeend', remindRow()));
  list.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day]');
    if (day) {
      day.classList.toggle('on');
      day.setAttribute('aria-pressed', day.classList.contains('on'));
    } else if (e.target.closest('[data-rdel]')) {
      e.target.closest('.rrow').remove();
    }
  });
  return (raw = false) => {
    const out = [];
    for (const row of list.querySelectorAll('.rrow')) {
      const time = row.querySelector('[data-rtime]').value;
      const days = [...row.querySelectorAll('.rday.on')].map((b) => b.dataset.day);
      if (raw) { out.push({ time, days }); continue; }
      if (!/^\d{2}:\d{2}$/.test(time)) return { error: t('Pick a time for each reminder') };
      if (!days.length) return { error: t('Pick at least one day for each reminder') };
      out.push(days.length === 7 ? { time } : { time, days: DAYS.filter((d) => days.includes(d)) });
    }
    return { list: out };
  };
}
