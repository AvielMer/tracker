// Charts for the Stats screen: plain SVG, no library — it works offline and
// needs no build step. Drawn to a few fixed data-viz rules:
// - one y-axis per chart (e.g. pulse never shares the blood-pressure scale);
// - thin marks: 2px lines, dots ≥ 8px with a 2px ring in the card colour,
//   columns ≤ 24px wide with a 2px gap and a rounded top on a flat base;
// - a quiet hairline grid; text always in text colours, never the series
//   colour; a legend for 2+ series and the last value written at the end;
// - tap or drag on a chart (or use the arrow keys) to read the values at
//   that point — and every card also has a table, so no value depends on
//   being able to tap.

import { esc } from './util.js';

// The series colours — checked for contrast and colour-blind separation
// with the dataviz validator against both card surfaces: the dark theme's
// #1c1f26 and the Girl theme's white (blue, orange, aqua; in this order).
export const SERIES = ['#3987e5', '#d95926', '#199e70'];

// The chart chrome follows the theme: grid, baseline and the ring around
// dots are CSS variables in app.css, read each time a chart is drawn.
function ink() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return { grid: v('--ch-grid', '#2e333d'), base: v('--ch-base', '#454c58'), surface: v('--card', '#1c1f26') };
}

const H = { line: 150, small: 112 };
const M = { top: 12, bottom: 24, left: 34 };
// Rough width of a label in the 11-12px chart font, to keep labels clear
// of each other and of the edges.
const textW = (s) => String(s).length * 6.6;

// Round tick values for a range ("60 90 120 150", never "57 83 109").
// integer: for counts — never "0.5 times".
export function niceTicks(min, max, count = 4, integer = false) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = (integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).map((f) => f * mag).find((s) => s >= raw) || 10 * mag;
  if (integer) step = Math.max(1, step);
  const lo = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = lo; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

// Rounded top, flat base: the bar grows from the baseline.
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// A line or dot chart.
// spec: { width, small, x0, x1, series: [{ name, color, points: [{ x, y }] }],
//   kind: 'line' | 'dots', area (single line: a soft wash below it),
//   yMin, yMax, yTicks, yTickLabel(v), fmt(y), xFmt(ms) — date in the readout,
//   xAxisFmt(ms) — the 3 dates under the chart }
export function timeChart(spec) {
  const INK = ink();
  const W = spec.width;
  const Hh = spec.small ? H.small : H.line;
  // Room on the right for the last values written at the line ends.
  const ends = spec.kind === 'dots' ? [] : spec.series.filter((s) => s.points.length).map((s) => spec.fmt(s.points[s.points.length - 1].y));
  const right = Math.max(16, ...ends.map((l) => textW(l) + 12));
  const pw = W - M.left - right;
  const ph = Hh - M.top - M.bottom;
  const all = spec.series.flatMap((s) => s.points.map((p) => p.y));
  let lo = spec.yMin ?? Math.min(...all);
  let hi = spec.yMax ?? Math.max(...all);
  // A free scale never zooms in so far that a tiny wobble (pulse 72 → 74)
  // fills the whole height and looks dramatic.
  if (spec.yMin == null && spec.yMax == null) {
    const minSpan = Math.max(4, Math.abs(hi) * 0.08);
    if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  }
  // Whole-number readings (pulse, blood pressure) get whole-number ticks.
  const ticks = spec.yTicks || niceTicks(lo, hi, 4, all.every(Number.isInteger));
  const y0 = Math.min(ticks[0], spec.yMin ?? ticks[0]);
  const y1 = Math.max(ticks[ticks.length - 1], spec.yMax ?? ticks[ticks.length - 1]);
  const span = Math.max(1, spec.x1 - spec.x0);
  const X = (ms) => M.left + ((ms - spec.x0) / span) * pw;
  const Y = (v) => M.top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  const lbl = spec.yTickLabel || ((v) => String(v));

  let svg = '';
  for (const v of ticks) {
    svg += `<line x1="${M.left}" x2="${M.left + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${INK.grid}" stroke-width="1"/>`;
    svg += `<text x="${M.left - 6}" y="${Y(v) + 4}" text-anchor="end" class="ch-tick">${esc(lbl(v))}</text>`;
  }
  const xs = [spec.x0, (spec.x0 + spec.x1) / 2, spec.x1];
  ['start', 'middle', 'end'].forEach((anchor, i) => {
    svg += `<text x="${X(xs[i])}" y="${Hh - 6}" text-anchor="${anchor}" class="ch-tick">${esc(spec.xAxisFmt(xs[i]))}</text>`;
  });
  for (const s of spec.series) {
    const pts = s.points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`);
    if (spec.kind !== 'dots' && pts.length > 1) {
      if (spec.area && spec.series.length === 1) {
        svg += `<path d="M${pts[0]}L${pts.join('L')}L${X(s.points[s.points.length - 1].x).toFixed(1)},${M.top + ph}L${X(s.points[0].x).toFixed(1)},${M.top + ph}Z" fill="${s.color}" opacity="0.1"/>`;
      }
      svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    // Dots: every point on a dot chart; on a line only the last one (plus
    // any point standing alone, which a line can't show).
    s.points.forEach((p, i) => {
      if (spec.kind === 'dots' || i === s.points.length - 1 || s.points.length === 1) {
        svg += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4" fill="${s.color}" stroke="${INK.surface}" stroke-width="2"/>`;
      }
    });
  }
  // The last value, written at the end of each line (skipped when two
  // ends are too close to read — the readout and the table have them).
  if (spec.kind !== 'dots') {
    const ends = spec.series.filter((s) => s.points.length).map((s) => ({ s, p: s.points[s.points.length - 1] }));
    const close = ends.some((a, i) => ends.some((b, j) => i < j && Math.abs(Y(a.p.y) - Y(b.p.y)) < 13));
    if (!close) {
      for (const { p } of ends) {
        svg += `<text x="${X(p.x) + 8}" y="${Y(p.y) + 4}" class="ch-end">${esc(spec.fmt(p.y))}</text>`;
      }
    }
  }
  svg += `<line class="ch-cross" x1="0" x2="0" y1="${M.top}" y2="${M.top + ph}" stroke="${INK.base}" stroke-width="1" visibility="hidden"/>`;
  svg += `<g class="ch-hl"></g>`;

  // Readout positions: every distinct x across the series.
  const stops = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const readout = (i) => {
    const x = stops[i];
    const rows = spec.series.map((s) => {
      const p = s.points.find((q) => q.x === x);
      return p ? { s, p } : null;
    }).filter(Boolean);
    return {
      px: X(x),
      dots: rows.map(({ s, p }) => ({ cx: X(p.x), cy: Y(p.y), color: s.color })),
      title: spec.xFmt(x),
      rows: rows.map(({ s, p }) => ({ color: s.color, name: spec.series.length > 1 ? s.name : '', value: p.label || spec.fmt(p.y) })),
    };
  };
  return mount(W, Hh, svg, stops.length, readout, spec.label, (px) => {
    let best = 0;
    stops.forEach((x, i) => { if (Math.abs(X(x) - px) < Math.abs(X(stops[best]) - px)) best = i; });
    return best;
  });
}

// A column chart over time buckets.
// spec: { width, small, buckets: [{ label, axis, value }], color, fmt(v), label }
export function columnChart(spec) {
  const INK = ink();
  const W = spec.width;
  const Hh = spec.small ? H.small : H.line;
  const pw = W - M.left - 12;
  const ph = Hh - M.top - M.bottom;
  const n = spec.buckets.length;
  const max = Math.max(...spec.buckets.map((b) => b.value), 0);
  const ticks = niceTicks(0, max || 1, 3, spec.integer !== false);
  const top = ticks[ticks.length - 1];
  const Y = (v) => M.top + ph - (v / top) * ph;
  const band = pw / n;
  const bw = Math.max(2, Math.min(24, band - 2));
  const bx = (i) => M.left + band * i + (band - bw) / 2;

  let svg = '';
  for (const v of ticks) {
    svg += `<line x1="${M.left}" x2="${M.left + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? INK.base : INK.grid}" stroke-width="1"/>`;
    svg += `<text x="${M.left - 6}" y="${Y(v) + 4}" text-anchor="end" class="ch-tick">${esc(String(v))}</text>`;
  }
  // Every n-th date under the bars, so they never collide.
  const every = n <= 8 ? 1 : Math.ceil(n / Math.max(1, Math.floor(pw / 44)));
  spec.buckets.forEach((b, i) => {
    if (b.value > 0) svg += `<path d="${barPath(bx(i), Y(b.value), bw, Y(0) - Y(b.value))}" fill="${spec.color}" class="ch-bar" data-i="${i}"/>`;
    if (i % every === 0) {
      svg += `<text x="${bx(i) + bw / 2}" y="${Hh - 6}" text-anchor="middle" class="ch-tick">${esc(b.axis)}</text>`;
    }
  });
  // The biggest bar carries its value (one label, not one per bar), kept
  // clear of the axis numbers on the left and of the right edge.
  const iMax = spec.buckets.findIndex((b) => b.value === max);
  if (max > 0) {
    const label = spec.fmt(max);
    const half = textW(label) / 2;
    const cx = Math.min(M.left + pw - half, Math.max(M.left + half + 4, bx(iMax) + bw / 2));
    svg += `<text x="${cx}" y="${Y(max) - 4}" text-anchor="middle" class="ch-end">${esc(label)}</text>`;
  }
  svg += `<g class="ch-hl"></g>`;

  const readout = (i) => ({
    px: bx(i) + bw / 2,
    bar: i,
    title: spec.buckets[i].label,
    rows: [{ color: spec.color, name: '', value: spec.fmt(spec.buckets[i].value) }],
  });
  return mount(W, Hh, svg, n, readout, spec.label, (px) => Math.max(0, Math.min(n - 1, Math.floor((px - M.left) / band))));
}

// The interactive frame shared by both charts: tap/drag or arrow keys move
// a readout (crosshair + highlighted marks + values). Names in the readout
// are set with textContent: they can be names the user typed.
function mount(W, Hh, inner, count, readout, label, nearest) {
  const INK = ink();
  const box = document.createElement('div');
  box.className = 'chart';
  box.tabIndex = 0;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label || '');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" direction="ltr">${inner}</svg>
    <div class="chart-tip" hidden></div>`;
  if (!count) return box;
  const svg = box.querySelector('svg');
  const tip = box.querySelector('.chart-tip');
  const cross = svg.querySelector('.ch-cross');
  const hl = svg.querySelector('.ch-hl');
  let cur = -1;

  const show = (i) => {
    cur = Math.max(0, Math.min(count - 1, i));
    const r = readout(cur);
    if (cross) { cross.setAttribute('x1', r.px); cross.setAttribute('x2', r.px); cross.setAttribute('visibility', 'visible'); }
    hl.innerHTML = (r.dots || []).map((d) => `<circle cx="${d.cx}" cy="${d.cy}" r="5" fill="${d.color}" stroke="${INK.surface}" stroke-width="2"/>`).join('');
    svg.querySelectorAll('.ch-bar').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === r.bar));
    tip.textContent = '';
    const head = document.createElement('div');
    head.className = 'tip-title';
    head.textContent = r.title;
    tip.append(head);
    for (const row of r.rows) {
      const line = document.createElement('div');
      line.className = 'tip-row';
      const key = document.createElement('span');
      key.className = 'tip-key';
      key.style.background = row.color;
      const val = document.createElement('b');
      val.textContent = row.value;
      line.append(key, val);
      if (row.name) {
        const nm = document.createElement('span');
        nm.className = 'tip-name';
        nm.textContent = row.name;
        line.append(nm);
      }
      tip.append(line);
    }
    tip.hidden = false;
    const scale = box.clientWidth / W || 1;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half, Math.min(box.clientWidth - half, r.px * scale))}px`;
  };
  const hide = () => {
    cur = -1;
    tip.hidden = true;
    if (cross) cross.setAttribute('visibility', 'hidden');
    hl.innerHTML = '';
    svg.querySelectorAll('.ch-bar.on').forEach((b) => b.classList.remove('on'));
  };
  const at = (e) => {
    const rect = svg.getBoundingClientRect();
    show(nearest(((e.clientX - rect.left) / rect.width) * W));
  };
  box.addEventListener('pointerdown', at);
  box.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) at(e); });
  box.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  box.addEventListener('blur', hide);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      show(cur < 0 ? count - 1 : cur + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(count - 1);
    else if (e.key === 'Escape') hide();
  });
  return box;
}
