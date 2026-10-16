// Log screen: newest first, grouped by day. Tap an entry for details.
// (Edit and delete arrive in step 3.)

import { eventLabel } from './config.js';
import { esc, friendlyDay, hhmm } from './util.js';

const PAGE = 200;
let shown = PAGE;

// Label shown ON SCREEN. Private items show their displayLabel; the real
// item_name is only used if the item no longer exists in the config.
function screenLabel(state, e) {
  const lists = [...state.config.events, ...state.config.exercises];
  const item = lists.find((x) => x.id === e.item_id);
  if (item && e.kind === 'event') return eventLabel(item);
  if (item) return item.name;
  return e.item_name || e.kind;
}

function details(e) {
  const parts = [];
  if (e.nth_today) parts.push(`#${e.nth_today}`);
  if (e.choice) parts.push(e.choice);
  if (e.amount != null) parts.push(`${e.amount} ${e.unit || ''}`.trim());
  if (e.count != null && e.count !== 1) parts.push(`×${e.count}`);
  if (e.reps != null) parts.push(`${e.reps} reps`);
  if (e.seconds != null) parts.push(`${e.seconds}s`);
  if (e.weight != null) parts.push(`+${e.weight}kg`);
  if (e.intensity != null) parts.push(`intensity ${e.intensity}`);
  if (e.duration_min != null) parts.push(`${e.duration_min} min`);
  return parts.join(' · ');
}

export function renderLog(el, ctx) {
  const { state } = ctx;
  const all = [...state.entries].reverse();
  if (!all.length) {
    el.innerHTML = '<div class="empty">Nothing logged yet.<br>Tap a button on the Events screen.</div>';
    return;
  }
  const list = all.slice(0, shown);
  let html = '';
  let day = null;
  for (const e of list) {
    if (e.date !== day) {
      if (day !== null) html += '</div>';
      day = e.date;
      const n = all.filter((x) => x.date === day && x.kind === 'event').length;
      html += `<h2 class="day">${esc(friendlyDay(day))}<span class="muted">${n ? n + ' events' : ''}</span></h2><div class="card">`;
    }
    html += `<button class="row" data-id="${esc(e.id)}">
      <span class="row-time">${esc(hhmm(e.time))}</span>
      <span class="row-main"><span class="row-name">${esc(screenLabel(state, e))}</span>
        <span class="row-sub">${esc(details(e))}${e.note ? ' · ' + esc(e.note) : ''}</span></span>
    </button>`;
  }
  html += '</div>';
  if (all.length > shown) html += `<button class="btn wide" data-act="more">Show older (${all.length - shown} more)</button>`;
  el.innerHTML = html;

  el.querySelectorAll('.row').forEach((row) => row.addEventListener('click', () => {
    const e = state.entries.find((x) => x.id === row.dataset.id);
    if (e) openDetails(ctx, e);
  }));
  const more = el.querySelector('[data-act="more"]');
  if (more) more.addEventListener('click', () => { shown += PAGE; renderLog(el, ctx); });
}

function openDetails(ctx, e) {
  const rows = [
    ['What', screenLabel(ctx.state, e)],
    ['Date', friendlyDay(e.date) + ` (${e.date})`],
    ['Time', e.time],
    ['Number that day', e.nth_today],
    ['Type', e.choice],
    ['Amount', e.amount != null ? `${e.amount} ${e.unit || ''}`.trim() : null],
    ['How many', e.count],
    ['Intensity', e.intensity],
    ['Duration (min)', e.duration_min],
    ['Reps', e.reps],
    ['Seconds', e.seconds],
    ['Weight', e.weight],
    ['Note', e.note],
  ].filter(([, v]) => v != null && v !== '');
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>Entry details</b></div>
    <table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    <p class="muted small">Editing and deleting entries arrives in step 3.</p>
    <div class="sheet-actions"><button class="btn primary" data-act="close">Close</button></div>`);
  root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
}
