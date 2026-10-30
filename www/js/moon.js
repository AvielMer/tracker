// The moon's phase for a day: asked for as "add moon phase also", next to
// the Hebrew and Muslim dates (both follow the moon). Pure maths with no
// network and no DOM, so it can be tested in node.
// The moon's distance from the sun along the sky ("elongation") comes from
// a low-precision formula (Jean Meeus, Astronomical Algorithms, eq. 48.4).
// It is good to well under a degree, so a phase's time is right to within
// about an hour.

const RAD = Math.PI / 180;

// Degrees at a moment (ms since 1970): 0 = new moon, 90 = first quarter,
// 180 = full moon, 270 = last quarter.
export function elongation(ms) {
  const T = (ms / 86400000 - 10957.5) / 36525; // centuries from 1 Jan 2000, noon
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T; // mean elongation
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T; // the sun's mean anomaly
  const Mm = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T; // the moon's mean anomaly
  const s = (deg) => Math.sin(deg * RAD);
  const e = D + 6.289 * s(Mm) - 2.1 * s(M) + 1.274 * s(2 * D - Mm) + 0.658 * s(2 * D) + 0.214 * s(2 * Mm) + 0.11 * s(D);
  return ((e % 360) + 360) % 360;
}

export const PHASES = [
  ['new', '🌑'], ['waxing_crescent', '🌒'], ['first_quarter', '🌓'], ['waxing_gibbous', '🌔'],
  ['full', '🌕'], ['waning_gibbous', '🌖'], ['last_quarter', '🌗'], ['waning_crescent', '🌘'],
];

// The phase of the phone's local day that holds `date`. A main phase (new,
// first quarter, full, last quarter) is given on the day it happens, one day
// each like a printed calendar; other days get the shape in between.
// lit = how much of the moon is lit at midday, 0–1.
export function moonPhase(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const t0 = new Date(y, m, d).getTime();
  const t1 = new Date(y, m, d + 1).getTime();
  const e0 = elongation(t0);
  let e1 = elongation(t1);
  if (e1 < e0) e1 += 360;
  let k = -1;
  for (let q = 0; q <= 4; q++) if (e0 <= q * 90 && q * 90 < e1) k = (q % 4) * 2;
  const mid = elongation((t0 + t1) / 2);
  if (k < 0) k = mid < 90 ? 1 : mid < 180 ? 3 : mid < 270 ? 5 : 7;
  return { key: PHASES[k][0], emoji: PHASES[k][1], lit: (1 - Math.cos(mid * RAD)) / 2 };
}
