// Small helpers shared by all screens.

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const pad = (n) => String(n).padStart(2, '0');

// Local calendar date "YYYY-MM-DD". WHY local and not UTC: a headache at
// 00:30 belongs to the day I experienced it, not to yesterday in UTC.
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ISO 8601 with the local offset, e.g. 2026-10-16T09:33:05+03:00.
// WHY: toISOString() gives UTC ("Z") which loses the local time-of-day I
// actually lived; keeping the offset keeps both.
export function isoWithTz(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  // Milliseconds included so two entries made in the same second (e.g.
  // starting a workout and logging the first set) still sort correctly.
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${localDate(d)}T${localTime(d)}.${ms}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function hhmm(time) {
  return (time || '').slice(0, 5);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function friendlyDay(dateStr) {
  const today = localDate();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (dateStr === today) return 'Today';
  if (dateStr === localDate(y)) return 'Yesterday';
  const [Y, M, D] = dateStr.split('-').map(Number);
  const d = new Date(Y, M - 1, D);
  const sameYear = Y === new Date().getFullYear();
  return `${DAYS[d.getDay()]} ${D} ${MONTHS[M - 1]}${sameYear ? '' : ' ' + Y}`;
}

export function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later, not immediately: some Android browsers start the download
  // asynchronously and fail if the URL is already gone.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
