// Today's date in other calendars too, under the date on the Events and
// Cycle screens (and on a day in the Cycle tab). Asked for as "add the
// Hebrew calendar in Hebrew, and an option to also see the Muslim calendar
// … the Arabic below it", then "add moon phase also".
// Settings → Language & dates → Calendars:
// - kv "cal_hebrew": 'off' | 'he' | 'en'. Not set = in Hebrew for phones in
//   Israel and for the Hebrew app, else off.
// - kv "cal_hijri": 'off' | 'en' | 'ar'. Not set = off.
// - kv "cal_moon": 'off' | 'on'. Not set = off.
// WHY Umm al-Qura for the Muslim date: it's the official calendar of Saudi
// Arabia and what most printed calendars follow. Where a month starts when
// the new moon is seen, the date can be a day apart. Both calendars' days
// really begin at sunset; like printed calendars, this shows the date of
// the day from midnight.

import * as storage from './storage.js';
import { getLang, monthFirst, t } from './i18n.js';
import { moonPhase } from './moon.js';

const FORMS = { hebrew: ['off', 'he', 'en'], hijri: ['off', 'en', 'ar'], moon: ['off', 'on'] };
let saved = { hebrew: null, hijri: null, moon: null };

export async function initCalendars() {
  try {
    saved = {
      hebrew: await storage.getValue('cal_hebrew'),
      hijri: await storage.getValue('cal_hijri'),
      moon: await storage.getValue('cal_moon'),
    };
  } catch { /* defaults */ }
}

function inIsrael() {
  try {
    return /^Asia\/(Jerusalem|Tel_Aviv)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  } catch {
    return false;
  }
}

export function calendarPrefs() {
  const ok = (kind) => (FORMS[kind].includes(saved[kind]) ? saved[kind] : null);
  return {
    hebrew: ok('hebrew') || (inIsrael() || getLang().split('-')[0] === 'he' ? 'he' : 'off'),
    hijri: ok('hijri') || 'off',
    moon: ok('moon') || 'off',
  };
}

export async function setCalendarPref(kind, v) {
  if (!FORMS[kind]?.includes(v)) return;
  saved[kind] = v;
  await storage.setValue(`cal_${kind}`, v);
}

// Hebrew numerals: 22 → כ״ב, 15 → ט״ו (not יה), 6 → ו׳, 787 → תשפ״ז.
// WHY by hand: the phone's date formatter writes Hebrew dates with ordinary
// digits ("19 בחשוון 5787"), and the user asked for letters.
const H1 = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const H10 = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const H100 = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
export function hebrewNumeral(n) {
  const r = n % 100;
  const s = H100[Math.floor(n / 100) % 10] + (r === 15 ? 'טו' : r === 16 ? 'טז' : H10[Math.floor(r / 10)] + H1[r % 10]);
  return s.length > 1 ? `${s.slice(0, -1)}״${s.slice(-1)}` : `${s}׳`;
}

// "יום ו׳ י״ט בחשוון התשפ״ז" (the user's own example: "יום א כב בסיוון
// התשנח"), or "19 Heshvan 5787".
function hebrewDate(date, form, weekday) {
  if (form === 'en') {
    return new Intl.DateTimeFormat(`${monthFirst() ? 'en-US' : 'en-GB'}-u-ca-hebrew`, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  }
  const parts = new Intl.DateTimeFormat('he-u-ca-hebrew', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type)?.value || '';
  const day = hebrewNumeral(parseInt(part('day'), 10));
  const year = `ה${hebrewNumeral(parseInt(part('year'), 10) % 1000)}`;
  return `${weekday ? `${part('weekday')} ` : ''}${day} ב${part('month')} ${year}`;
}

// "19 Jumada I 1448 AH", or "الجمعة، 19 جمادى الأولى 1448 هـ".
function hijriDate(date, form, weekday) {
  const loc = form === 'ar' ? 'ar' : monthFirst() ? 'en-US' : 'en-GB';
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  if (weekday && form === 'ar') opts.weekday = 'long';
  return new Intl.DateTimeFormat(`${loc}-u-ca-islamic-umalqura`, opts).format(date);
}

const MOON_NAMES = {
  new: 'New moon',
  waxing_crescent: 'Waxing crescent',
  first_quarter: 'First quarter',
  waxing_gibbous: 'Waxing gibbous',
  full: 'Full moon',
  waning_gibbous: 'Waning gibbous',
  last_quarter: 'Last quarter',
  waning_crescent: 'Waning crescent',
};

// "🌖 Waning gibbous · 77%" (how much of it is lit), in the app's language.
function moonLine(date) {
  const p = moonPhase(date);
  return `${p.emoji} ${t(MOON_NAMES[p.key])} · ${Math.round(p.lit * 100)}%`;
}

// The day in the calendars that are on, as [{ text, lang }]: Hebrew first,
// the Muslim date below it, then the moon. weekday: also in the Hebrew and
// Arabic lines.
export function otherDates(date, { weekday = false } = {}) {
  const { hebrew, hijri, moon } = calendarPrefs();
  const out = [];
  const add = (on, lang, text) => {
    if (on === 'off') return;
    try { out.push({ text: text(), lang }); } catch { /* an older phone without that calendar */ }
  };
  add(hebrew, hebrew, () => hebrewDate(date, hebrew, weekday));
  add(hijri, hijri, () => hijriDate(date, hijri, weekday));
  add(moon, getLang(), () => moonLine(date));
  return out;
}
