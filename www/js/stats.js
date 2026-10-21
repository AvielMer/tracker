// Stats: charts of what was logged, over a chosen period.
//
// Nothing to set up per button: each button's config already says what it
// records ("ask"), so it gets the charts that fit (asked for as "charts of
// readings like weight and blood pressure"):
//   blood pressure → upper & lower together (same unit), pulse on its own
//     chart (a different measure never shares an axis);
//   its own numbers (e.g. weight kg) → one line each;
//   mood → the average per day/week/month, 😫 … 😄;
//   intensity, duration → a dot for each time;
//   amount → total per day/week/month;
//   every other button → how many times per day/week/month.
// Training: workouts, then reps (or seconds) per exercise.
// Every card also has a table with the same numbers.

import * as storage from './storage.js';
import { eventLabel } from './config.js';
import { columnChart, SERIES, timeChart } from './charts.js';
import { MOODS } from './events.js';
import { esc } from './util.js';
import { getLang, t } from './i18n.js';

const PERIODS = [[7, '7 days'], [30, '30 days'], [91, '3 months'], [365, '1 year']];
const KEY = 'stats_period';
let period = 30;
let loaded = false;

const fmtWith = (opts) => {
  try { return new Intl.DateTimeFormat(getLang(), opts); } catch { return new Intl.DateTimeFormat('en', opts); }
};

// The bars' time slots: days (7 and 30 days), weeks of 7 days ending today
// (3 months), calendar months (1 year).
function makeBuckets(days, now) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const out = [];
  const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  if (days <= 30) {
    for (let i = days - 1; i >= 0; i--) out.push({ start: +shift(today, -i), end: +shift(today, 1 - i), unit: 'day' });
  } else if (days <= 91) {
    for (let i = 12; i >= 0; i--) out.push({ start: +shift(today, 1 - 7 * (i + 1)), end: +shift(today, 1 - 7 * i), unit: 'week' });
  } else {
    for (let i = 11; i >= 0; i--) {
      out.push({
        start: +new Date(today.getFullYear(), today.getMonth() - i, 1),
        end: +new Date(today.getFullYear(), today.getMonth() - i + 1, 1),
        unit: 'month',
      });
    }
  }
  const fDay = fmtWith({ day: 'numeric', month: 'short' });
  const fWd = fmtWith({ weekday: 'short' });
  const fMon = fmtWith({ month: 'short' });
  const fMonY = fmtWith({ month: 'long', year: 'numeric' });
  for (const b of out) {
    const s = new Date(b.start);
    if (b.unit === 'day') {
      b.axis = days <= 7 ? fWd.format(s) : String(s.getDate());
      b.label = `${fWd.format(s)} ${fDay.format(s)}`;
    } else if (b.unit === 'week') {
      b.axis = fDay.format(s);
      b.label = `${fDay.format(s)} – ${fDay.format(new Date(b.end - 1))}`;
    } else {
      b.axis = fMon.format(s);
      b.label = fMonY.format(s);
    }
  }
  return out;
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export async function renderStats(el, ctx) {
  if (!loaded) {
    loaded = true;
    try { period = (await storage.getValue(KEY)) || period; } catch { /* default */ }
  }
  const { state } = ctx;
  const now = Date.now();
  const B = makeBuckets(period, now);
  const x0 = B[0].start;
  const nf = new Intl.NumberFormat(getLang(), { maximumFractionDigits: 1 });
  const fTime = fmtWith({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fAxis = fmtWith(period > 91 ? { month: 'short' } : { day: 'numeric', month: 'short' });
  const unit = B[0].unit;

  el.innerHTML = `
    <div class="st-filter">${PERIODS.map(([d, lbl]) => `<button class="chip${d === period ? ' on' : ''}" data-days="${d}">${esc(t(lbl))}</button>`).join('')}</div>
    <p class="small muted st-caption">${esc(t(unit === 'day' ? 'BARS_DAY' : unit === 'week' ? 'BARS_WEEK' : 'BARS_MONTH'))}</p>
    <div data-cards></div>`;
  el.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', async () => {
    period = Number(b.dataset.days);
    await storage.setValue(KEY, period).catch(() => {});
    renderStats(el, ctx);
  }));
  const holder = el.querySelector('[data-cards]');
  const W = Math.max(260, Math.min(700, holder.clientWidth - 28));

  const inRange = state.entries.filter((e) => {
    const ms = Date.parse(e.ts);
    return ms >= x0 && ms <= now;
  });
  const bucketOf = (ms) => B.findIndex((b) => ms >= b.start && ms < b.end);
  const perBucket = (items, value) => {
    const sums = B.map(() => 0);
    for (const it of items) {
      const i = bucketOf(it.ms);
      if (i >= 0) sums[i] += value(it);
    }
    return B.map((b, i) => ({ ...b, value: Math.round(sums[i] * 10) / 10 }));
  };

  // --- one card per button that has data --------------------------------------
  const cardsFor = (ev) => {
    const mine = inRange.filter((e) => e.item_id === ev.id && ['event', 'event_start', 'event_end'].includes(e.kind));
    if (!mine.length) return null;
    const ask = new Set(ev.ask || []);
    const charts = [];
    const summary = [];

    // Occurrences: a blood-pressure series (readings sharing session_id)
    // counts once; "how many" answers count that many.
    const occ = new Map();
    for (const e of mine.filter((x) => x.kind !== 'event_end')) {
      const k = e.session_id || e.id;
      if (!occ.has(k)) occ.set(k, []);
      occ.get(k).push(e);
    }
    const occurrences = [...occ.values()].map((list) => ({
      ms: Date.parse(list[0].ts), n: list.length > 1 ? 1 : (list[0].count || 1),
    }));

    if (ask.has('bp')) {
      const series = [...occ.values()].map((list) => list.filter((r) => r.bp_sys != null)).filter((l) => l.length);
      const pts = series.map((list) => {
        const last = list[list.length - 1];
        return { x: Date.parse(last.ts), sys: last.bp_sys, dia: last.bp_dia, pulse: last.pulse, no: last.set_no || 1 };
      }).sort((a, b) => a.x - b.x);
      if (pts.length) {
        const last = pts[pts.length - 1];
        summary.push(t('{n} measurements', { n: pts.length }),
          t('last {v}', { v: `${last.sys}/${last.dia}` }),
          t('avg {v}', { v: `${Math.round(avg(pts.map((p) => p.sys)))}/${Math.round(avg(pts.map((p) => p.dia)))}` }));
        charts.push({
          // The legend names the two lines; the card already says what it is.
          title: '',
          tableTitle: t('Blood pressure'),
          legend: [[t('Upper'), SERIES[0]], [t('Lower'), SERIES[1]]],
          note: t('BP_POINT_NOTE'),
          el: timeChart({
            width: W, x0, x1: now, kind: 'line', label: t('Blood pressure'),
            series: [
              { name: t('Upper'), color: SERIES[0], points: pts.map((p) => ({ x: p.x, y: p.sys })) },
              { name: t('Lower'), color: SERIES[1], points: pts.map((p) => ({ x: p.x, y: p.dia })) },
            ],
            fmt: (v) => String(v),
            xFmt: (ms) => `${fTime.format(ms)} · ${t('reading {n}', { n: pts.find((p) => p.x === ms)?.no || 1 })}`,
            xAxisFmt: (ms) => fAxis.format(ms),
          }),
          table: [[t('Time'), t('Upper'), t('Lower'), t('Pulse')], ...pts.slice().reverse().map((p) => [fTime.format(p.x), p.sys, p.dia, p.pulse ?? '—'])],
        });
        const pp = pts.filter((p) => p.pulse != null);
        if (pp.length) {
          charts.push({
            title: `${t('Pulse')} ♥`,
            side: t('avg {v}', { v: Math.round(avg(pp.map((p) => p.pulse))) }),
            el: timeChart({
              width: W, small: true, x0, x1: now, kind: 'line', area: true, label: t('Pulse'),
              series: [{ name: t('Pulse'), color: SERIES[2], points: pp.map((p) => ({ x: p.x, y: p.pulse })) }],
              fmt: (v) => String(v), xFmt: (ms) => fTime.format(ms), xAxisFmt: (ms) => fAxis.format(ms),
            }),
          });
        }
      }
    }

    // The button's own numbers (e.g. weight). With blood pressure they are
    // asked once per series, on reading 1: one point per series.
    for (const m of ev.measures || []) {
      const pts = [];
      if (ask.has('bp')) {
        for (const list of occ.values()) {
          const withM = list.find((r) => r.measures && r.measures[m.id] != null);
          if (withM) pts.push({ x: Date.parse(list[list.length - 1].ts), y: withM.measures[m.id] });
        }
      } else {
        for (const e of mine) if (e.measures && e.measures[m.id] != null) pts.push({ x: Date.parse(e.ts), y: e.measures[m.id] });
      }
      if (!pts.length) continue;
      pts.sort((a, b) => a.x - b.x);
      const u = m.unit ? ` ${m.unit}` : '';
      const change = pts[pts.length - 1].y - pts[0].y;
      charts.push({
        title: `${m.name}${m.unit ? ` (${m.unit})` : ''}`,
        side: pts.length > 1 ? `${t('change {v}', { v: `${change > 0 ? '+' : change < 0 ? '−' : '±'}${nf.format(Math.abs(change))}${u}` })}` : '',
        el: timeChart({
          width: W, x0, x1: now, kind: 'line', area: true, label: m.name,
          series: [{ name: m.name, color: SERIES[0], points: pts }],
          fmt: (v) => `${nf.format(v)}${u}`, xFmt: (ms) => fTime.format(ms), xAxisFmt: (ms) => fAxis.format(ms),
        }),
        table: [[t('Time'), `${m.name}${u ? ` (${m.unit})` : ''}`], ...pts.slice().reverse().map((p) => [fTime.format(p.x), nf.format(p.y)])],
      });
    }

    if (ask.has('mood')) {
      const moods = mine.filter((e) => e.mood != null).map((e) => ({ ms: Date.parse(e.ts), v: e.mood }));
      if (moods.length) {
        const pts = B.map((b) => {
          const vs = moods.filter((m) => m.ms >= b.start && m.ms < b.end).map((m) => m.v);
          return vs.length ? { x: Math.min(now, (b.start + b.end) / 2), y: Math.round(avg(vs) * 10) / 10, b } : null;
        }).filter(Boolean);
        const face = (v) => MOODS[Math.min(4, Math.max(0, Math.round(v) - 1))][1];
        const a = avg(moods.map((m) => m.v));
        summary.push(t('avg {v}', { v: `${face(a)} ${nf.format(a)}` }));
        charts.push({
          title: t('How do you feel?'),
          el: timeChart({
            width: W, x0, x1: now, kind: 'line', label: t('How do you feel?'), yMin: 1, yMax: 5, yTicks: [1, 3, 5],
            yTickLabel: (v) => face(v),
            series: [{ name: t('How do you feel?'), color: SERIES[0], points: pts.map(({ x, y }) => ({ x, y })) }],
            fmt: (v) => `${face(v)} ${nf.format(v)}`,
            xFmt: (ms) => pts.find((p) => p.x === ms)?.b.label || '',
            xAxisFmt: (ms) => fAxis.format(ms),
          }),
          table: [[t('Date'), t('How do you feel?')], ...pts.slice().reverse().map((p) => [p.b.label, `${face(p.y)} ${nf.format(p.y)}`])],
        });
      }
    }

    // How many times: for buttons whose point isn't a reading.
    if (!ask.has('bp') && !ask.has('mood') && !(ask.has('measures') && ask.size <= 2)) {
      const bars = perBucket(occurrences, (o) => o.n);
      const total = bars.reduce((a, b) => a + b.value, 0);
      summary.unshift(t('{n} times', { n: total }));
      charts.push({
        title: t('Times'),
        el: columnChart({ width: W, small: true, buckets: bars, color: SERIES[0], fmt: (v) => nf.format(v), label: t('Times') }),
        table: [[t('Date'), t('Times')], ...bars.filter((b) => b.value).reverse().map((b) => [b.label, nf.format(b.value)])],
      });
    }

    for (const [field, title, yMax] of [['intensity', t('Intensity'), 10], ['duration_min', t('Duration (minutes)'), null]]) {
      if (!ask.has(field) && !(field === 'duration_min' && ev.span)) continue;
      const pts = mine.filter((e) => e[field] != null).map((e) => ({ x: Date.parse(e.ts), y: e[field] }));
      if (!pts.length) continue;
      const a = avg(pts.map((p) => p.y));
      charts.push({
        title,
        side: t('avg {v}', { v: nf.format(a) }),
        el: timeChart({
          width: W, small: true, x0, x1: now, kind: 'dots', label: title,
          yMin: 0, yMax: yMax ?? Math.max(...pts.map((p) => p.y)), yTicks: yMax ? [0, 5, 10] : undefined,
          series: [{ name: title, color: SERIES[0], points: pts }],
          fmt: (v) => (field === 'duration_min' ? t('{n} min', { n: nf.format(v) }) : nf.format(v)),
          xFmt: (ms) => fTime.format(ms), xAxisFmt: (ms) => fAxis.format(ms),
        }),
        table: [[t('Time'), title], ...pts.slice().reverse().map((p) => [fTime.format(p.x), nf.format(p.y)])],
      });
    }

    if (ask.has('amount')) {
      const items = mine.filter((e) => e.amount != null).map((e) => ({ ms: Date.parse(e.ts), v: e.amount }));
      if (items.length) {
        const u = ev.amount?.unit || mine.find((e) => e.unit)?.unit || '';
        const bars = perBucket(items, (it) => it.v);
        charts.push({
          title: t('Amount ({unit})', { unit: u }),
          side: t('total {v}', { v: `${nf.format(bars.reduce((s, b) => s + b.value, 0))} ${u}`.trim() }),
          el: columnChart({ width: W, small: true, buckets: bars, color: SERIES[0], integer: false, fmt: (v) => `${nf.format(v)} ${u}`.trim(), label: t('Amount ({unit})', { unit: u }) }),
          table: [[t('Date'), t('Amount ({unit})', { unit: u })], ...bars.filter((b) => b.value).reverse().map((b) => [b.label, nf.format(b.value)])],
        });
      }
    }
    if (!charts.length) return null;
    return { name: eventLabel(ev), color: ev.color, summary, charts, reading: ask.has('bp') || ask.has('mood') || ask.has('measures') };
  };

  // --- training --------------------------------------------------------------
  const trainingCards = () => {
    const out = [];
    const sessions = inRange.filter((e) => e.kind === 'session_start').map((e) => ({ ms: Date.parse(e.ts) }));
    const sets = inRange.filter((e) => e.kind === 'set');
    if (sessions.length) {
      const bars = perBucket(sessions, () => 1);
      const mins = inRange.filter((e) => e.kind === 'session_end' && e.duration_min != null).reduce((a, e) => a + e.duration_min, 0);
      out.push({
        name: t('Workouts'),
        summary: [t('{n} workouts', { n: sessions.length }), mins ? t('{n} min', { n: mins }) : ''].filter(Boolean),
        charts: [{
          title: t('Workouts'),
          el: columnChart({ width: W, small: true, buckets: bars, color: SERIES[0], fmt: (v) => nf.format(v), label: t('Workouts') }),
          table: [[t('Date'), t('Workouts')], ...bars.filter((b) => b.value).reverse().map((b) => [b.label, b.value])],
        }],
      });
    }
    const ids = [...new Set(sets.map((s) => s.item_id))];
    const order = (id) => {
      const i = state.config.exercises.findIndex((x) => x.id === id);
      return i < 0 ? 1e6 : i;
    };
    ids.sort((a, b) => order(a) - order(b));
    for (const id of ids) {
      const mine = sets.filter((s) => s.item_id === id);
      const ex = state.config.exercises.find((x) => x.id === id);
      // Reps when the sets have them (also "max reps" circuit parts),
      // seconds for holds and circuits.
      const useReps = mine.some((s) => s.reps != null);
      const val = (s) => (useReps ? s.reps || 0 : s.seconds || 0);
      const bars = perBucket(mine.map((s) => ({ ms: Date.parse(s.ts), s })), (it) => val(it.s));
      const total = mine.reduce((a, s) => a + val(s), 0);
      const best = Math.max(...mine.map(val));
      const what = useReps ? t('Reps') : t('Seconds');
      out.push({
        name: ex?.name || mine[mine.length - 1].item_name || id,
        summary: [t('{n} sets', { n: mine.length }), `${what}: ${nf.format(total)}`, t('best {v}', { v: nf.format(best) })],
        charts: [{
          title: what,
          el: columnChart({ width: W, small: true, buckets: bars, color: SERIES[0], fmt: (v) => nf.format(v), label: `${ex?.name || id} — ${what}` }),
          table: [[t('Date'), what], ...bars.filter((b) => b.value).reverse().map((b) => [b.label, nf.format(b.value)])],
        }],
      });
    }
    return out;
  };

  const eventCards = state.config.events.map(cardsFor).filter(Boolean);
  const sections = [
    [t('Readings'), eventCards.filter((c) => c.reading)],
    [t('Events'), eventCards.filter((c) => !c.reading)],
    [t('Training'), trainingCards()],
  ].filter(([, list]) => list.length);

  if (!sections.length) {
    holder.innerHTML = `<div class="empty">${esc(t('Nothing logged in this period.'))}</div>`;
    return;
  }
  for (const [title, list] of sections) {
    holder.insertAdjacentHTML('beforeend', `<h2 class="day">${esc(title)}</h2>`);
    for (const c of list) holder.append(cardEl(c));
  }
}

// One card: name, a short summary, its charts — and the same numbers as
// tables behind a toggle.
function cardEl(c) {
  const card = document.createElement('div');
  card.className = 'card pad st-card';
  const hasTables = c.charts.some((ch) => ch.table);
  card.innerHTML = `
    <div class="st-head">
      <b class="st-name">${c.color ? `<span class="dot" style="--c:${c.color}"></span>` : ''}${esc(c.name)}</b>
      ${hasTables ? `<button class="btn st-toggle" data-tables>${t('Table')}</button>` : ''}
    </div>
    ${c.summary.length ? `<p class="st-sum">${c.summary.map(esc).join(' · ')}</p>` : ''}
    <div class="st-charts"></div>
    <div class="st-tables" hidden>${c.charts.filter((ch) => ch.table).map((ch) => `
      <table class="kv st-table"><caption>${esc(ch.tableTitle || ch.title)}</caption>
        <tr>${ch.table[0].map((h) => `<th>${esc(h)}</th>`).join('')}</tr>
        ${ch.table.slice(1).map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}
      </table>`).join('')}</div>`;
  const box = card.querySelector('.st-charts');
  for (const ch of c.charts) {
    const wrap = document.createElement('div');
    wrap.className = 'st-chart';
    wrap.innerHTML = `<div class="st-ctitle">${ch.title ? `<span>${esc(ch.title)}</span>` : ''}${ch.legend ? `<span class="st-legend">${ch.legend.map(([n, col]) => `<span class="st-key"><i style="background:${col}"></i>${esc(n)}</span>`).join('')}</span>` : ''}${ch.side ? `<span class="st-side">${esc(ch.side)}</span>` : ''}</div>`;
    wrap.append(ch.el);
    if (ch.note) wrap.insertAdjacentHTML('beforeend', `<p class="small muted st-note">${esc(ch.note)}</p>`);
    box.append(wrap);
  }
  card.querySelector('[data-tables]')?.addEventListener('click', (e) => {
    const tables = card.querySelector('.st-tables');
    tables.hidden = !tables.hidden;
    box.hidden = !tables.hidden;
    e.currentTarget.textContent = tables.hidden ? t('Table') : t('Chart');
  });
  return card;
}
