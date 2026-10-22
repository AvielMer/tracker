// Add / edit one event button: its name, privacy, and what it asks
// after a tap. Everything ends up in the config, nothing is hardcoded.

import {
  COLORS, eventLabel, makeId, saveConfig, starterButtons,
} from './config.js';
import { remindEditorHtml, remindTimes, wireRemindEditor } from './reminders.js';
import { optionsToText, optName, parseOptions } from './lists.js';
import { icon } from './icons.js';
import { esc } from './util.js';
import { t } from './i18n.js';

// Labels are translation keys (see i18n.js).
const ASK_OPTIONS = [
  ['mood', 'ASK_mood'],
  ['intensity', 'Intensity (1–10)'],
  ['duration_min', 'Duration (minutes)'],
  ['choice', 'ASK_choice'],
  ['lists', 'ASK_lists'],
  ['amount', 'ASK_amount'],
  ['count', 'ASK_count'],
  ['bp', 'ASK_bp'],
  ['measures', 'ASK_measures'],
  ['note', 'ASK_note'],
];

// What a button does after a tap, in a few words ("Asks: how strong, how
// long"), so a list of buttons explains itself. Labels are translation keys.
const ASK_SHORT = {
  mood: 'how you feel',
  intensity: 'how strong',
  duration_min: 'how long',
  choice: 'which one',
  amount: 'how much',
  count: 'how many',
  bp: 'blood pressure and pulse',
  note: 'a note',
};

export function describeButton(ev) {
  // Names you typed (number fields, lists) are shown as written.
  const what = (ev.ask || []).flatMap((a) => {
    if (a === 'measures') return (ev.measures || []).map((m) => m.name);
    if (a === 'lists') return (ev.lists || []).map((l) => l.name);
    return [t(ASK_SHORT[a] || a)];
  }).filter(Boolean);
  // A diary asks a lot: name the first few and count the rest.
  const asks = what.length > 5 ? t('{list} and {n} more', { list: what.slice(0, 4).join(', '), n: what.length - 4 }) : what.join(', ');
  const parts = [];
  if (ev.span) parts.push(t('Start / finish'));
  parts.push(what.length ? t('Asks: {what}', { what: asks }) : t('Just one tap'));
  if (ev.goal) parts.push(t('Goal: {n} a day', { n: ev.goal }));
  if (ev.remind) parts.push(`⏰ ${remindTimes(ev)}`);
  return parts.join(' · ');
}

// One pick-list in the editor: its name, its answers as text ("🩸 Light,
// 🩸🩸 Medium"; an emoji first = the answer's icon), one or several.
function listRow(l = {}) {
  return `<div class="ldef" data-id="${esc(l.id || '')}">
    <div class="ldef-top">
      <input class="input" data-ln value="${esc(l.name || '')}" placeholder="${esc(t('List name, e.g. Flow'))}">
      <button class="ibtn" data-ldel aria-label="${esc(t('Remove'))}">${icon('close')}</button>
    </div>
    <textarea class="input" data-lo rows="2" placeholder="${esc(t('Answers, e.g. 🙂 Good, 😐 OK, 😟 Bad'))}">${esc(optionsToText(l.options))}</textarea>
    <label class="check"><input type="checkbox" data-lm ${l.multi ? 'checked' : ''}> ${esc(t('Several answers at once'))}</label>
  </div>`;
}

// "+ Add a button" (Events screen tile, Settings → Buttons): make your own,
// or one tap on a ready-made one (the app's starting buttons you don't have
// yet). WHY offered here: new users thought the starting buttons were
// theirs; now they're suggestions you pick, here and on the welcome screen.
export async function openAddButtonSheet(ctx) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const have = ctx.state.config.events;
  let ready = [];
  try {
    ready = (await starterButtons()).filter((s) => !have.some((e) => e.id === s.id || norm(e.name) === norm(s.name)));
  } catch { /* offline on a first visit: just "make your own" */ }
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${t('Add a button')}</b>
      <button class="ibtn ghost" data-act="close" aria-label="${esc(t('Close'))}">${icon('close')}</button></div>
    <button class="btn primary wide" data-act="own">${icon('edit')}<span>${t('Make your own button')}</span></button>
    ${ready.length ? `<div class="label sec-label">${t('Ready-made')}</div>
    <div class="card list">${ready.map((ev) => `
      <button class="lrow-main" data-ready="${esc(ev.id)}">
        <span class="dot" style="--c:${ev.color || '#8b949e'}"></span>
        <span class="lrow-text"><span class="lrow-name">${esc(ev.name)}</span><span class="lrow-sub">${esc(describeButton(ev))}</span></span>
        <span class="lrow-end">${icon('plus')}</span>
      </button>`).join('')}</div>` : ''}`);
  root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelector('[data-act="own"]').addEventListener('click', () => openEventEditor(ctx, null));
  root.querySelectorAll('[data-ready]').forEach((b) => b.addEventListener('click', async () => {
    const item = JSON.parse(JSON.stringify(ready.find((r) => r.id === b.dataset.ready)));
    if (ctx.state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return;
    const cfg = JSON.parse(JSON.stringify(ctx.state.config));
    if (cfg.events.some((e) => e.id === item.id)) return;
    cfg.events.push(item);
    const res = await saveConfig(cfg);
    if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return; }
    ctx.closeSheet();
    await ctx.reloadConfig();
    ctx.toast(t('Added "{name}"', { name: item.name }));
  }));
}

function measureRow(m = {}) {
  return `<div class="mdef" data-id="${esc(m.id || '')}">
    <input class="input" data-mn value="${esc(m.name || '')}" placeholder="${esc(t('Name, e.g. Weight'))}">
    <input class="input mini-unit" data-mu value="${esc(m.unit || '')}" placeholder="${esc(t('Unit, e.g. kg'))}">
    <button class="ibtn" data-mdel aria-label="${esc(t('Remove'))}">✕</button>
  </div>`;
}

const splitList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

// ev = existing event to edit, or null to add a new one.
export function openEventEditor(ctx, ev) {
  const isNew = !ev;
  // A new button gets a colour no other button has yet, so the Events
  // screen stays easy to tell apart (any colour, or none, can be picked).
  const used = new Set(ctx.state.config.events.map((e) => (e.color || '').toLowerCase()));
  const cur = ev || { name: '', ask: [], color: (COLORS.find(([hex]) => !used.has(hex)) || COLORS[0])[0] };
  // A button that was never used can be removed; one with entries is hidden
  // instead, so its history keeps its charts.
  const removable = !isNew && !ctx.state.entries.some((e) => e.item_id === ev.id);
  const ask = new Set(cur.ask || []);
  // Most-used first: name, colour, questions. Private and start/finish are
  // rarer, so they wait under "More options".
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${isNew ? t('Add a button') : t('Edit button')}</b>
      <button class="ibtn ghost" data-act="cancel" aria-label="${esc(t('Close'))}">${icon('close')}</button></div>
    <div class="label">${t('Name (saved in the log)')}</div>
    <input class="input" data-f="name" value="${esc(cur.name)}" placeholder="${esc(t('e.g. Medicine'))}">

    <div class="label sec">${t('Color')}</div>
    <div class="swatches">
      <button class="swatch none${cur.color ? '' : ' on'}" data-color="" aria-label="${esc(t('No color'))}">✕</button>
      ${COLORS.map(([hex, nm]) => `<button class="swatch${cur.color?.toLowerCase() === hex ? ' on' : ''}" data-color="${hex}" style="--c:${hex}" aria-label="${nm}"></button>`).join('')}
    </div>
    <div class="label sec">${t('After a tap, ask:')}</div>
    ${ASK_OPTIONS.map(([k, text]) => `
      <label class="check"><input type="checkbox" data-ask="${k}" ${ask.has(k) ? 'checked' : ''}> ${esc(t(text))}</label>
      ${k === 'choice' ? `<div class="ask-cfg" data-cfg="choice" ${ask.has('choice') ? '' : 'hidden'}>
        <input class="input" data-f="choices" value="${esc((cur.choices || []).join(', '))}" placeholder="Paracetamol, Nurofen, Aspirin">
        <div class="small muted">${esc(t('CHOICES_HINT'))}</div></div>` : ''}
      ${k === 'amount' ? `<div class="ask-cfg" data-cfg="amount" ${ask.has('amount') ? '' : 'hidden'}>
        <input class="input" data-f="unit" value="${esc(cur.amount?.unit || '')}" placeholder="${esc(t('Unit, e.g. mg or pills'))}">
        <input class="input" data-f="values" value="${esc((cur.amount?.values || []).join(', '))}" placeholder="${esc(t('Quick numbers, e.g. 200, 400, 500'))}">
        <div class="small muted">${esc(t('AMOUNT_HINT'))}</div></div>` : ''}
      ${k === 'measures' ? `<div class="ask-cfg" data-cfg="measures" ${ask.has('measures') ? '' : 'hidden'}>
        <div data-mlist>${(cur.measures?.length ? cur.measures : [{}]).map(measureRow).join('')}</div>
        <button class="btn" data-madd>${t('+ Add a number')}</button></div>` : ''}
      ${k === 'lists' ? `<div class="ask-cfg" data-cfg="lists" ${ask.has('lists') ? '' : 'hidden'}>
        <div data-llist>${(cur.lists?.length ? cur.lists : [{}]).map(listRow).join('')}</div>
        <button class="btn" data-ladd>${t('+ Add a list')}</button>
        <div class="small muted">${esc(t('LISTS_HINT'))}</div></div>` : ''}
    `).join('')}
    <p class="small muted">${esc(t('ONE_QUESTION_HINT'))}</p>
    <div class="label sec">${t('More options')}</div>
    <label class="check"><input type="checkbox" data-f="private" ${cur.private ? 'checked' : ''}> ${t('Private — show only a short label on screen')}</label>
    <input class="input" data-f="label" value="${esc(cur.displayLabel || '')}" placeholder="${esc(t('Label shown on screen (e.g. X)'))}" ${cur.private ? '' : 'hidden'}>
    <label class="check"><input type="checkbox" data-f="span" ${cur.span ? 'checked' : ''}> ${esc(t('SPAN_OPTION'))}</label>
    <label class="label-block">${t('Daily goal (optional)')}<input class="input" data-f="goal" inputmode="numeric" value="${esc(cur.goal ?? '')}" placeholder="${esc(t('e.g. 8'))}"></label>
    <div class="small muted">${esc(t('GOAL_HINT'))}</div>
    ${remindEditorHtml(cur.remind)}
    <div class="sheet-actions">
      <button class="btn" data-act="cancel">${t('Cancel')}</button>
      <button class="btn primary" data-act="save">${isNew ? t('Add') : t('Save')}</button>
    </div>
    ${removable ? `<button class="linklike danger" data-act="remove">${icon('trash')}<span>${t('Remove this button')}</span></button>` : ''}`);

  const f = (k) => root.querySelector(`[data-f="${k}"]`);
  let color = cur.color || '';
  root.querySelector('[data-act="remove"]')?.addEventListener('click', async () => {
    if (!confirm(t('Remove "{name}"? It was never used, so nothing is lost.', { name: eventLabel(ev) }))) return;
    if (ctx.state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return;
    const cfg = JSON.parse(JSON.stringify(ctx.state.config));
    cfg.events = cfg.events.filter((x) => x.id !== ev.id);
    const res = await saveConfig(cfg);
    if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return; }
    ctx.closeSheet();
    await ctx.reloadConfig();
    ctx.toast(t('Removed'));
  });
  root.querySelectorAll('.swatch').forEach((sw) => sw.addEventListener('click', () => {
    root.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
    sw.classList.add('on');
    color = sw.dataset.color;
  }));
  f('private').addEventListener('change', () => { f('label').hidden = !f('private').checked; });
  root.querySelectorAll('[data-ask]').forEach((box) => box.addEventListener('change', () => {
    const cfg = root.querySelector(`[data-cfg="${box.dataset.ask}"]`);
    if (cfg) cfg.hidden = !box.checked;
  }));
  root.querySelector('[data-madd]').addEventListener('click', () => {
    root.querySelector('[data-mlist]').insertAdjacentHTML('beforeend', measureRow());
  });
  root.querySelector('[data-ladd]').addEventListener('click', () => {
    root.querySelector('[data-llist]').insertAdjacentHTML('beforeend', listRow());
  });
  root.querySelector('[data-llist]').addEventListener('click', (e) => {
    if (e.target.closest('[data-ldel]')) e.target.closest('.ldef').remove();
  });
  root.querySelector('[data-mlist]').addEventListener('click', (e) => {
    if (e.target.closest('[data-mdel]')) e.target.closest('.mdef').remove();
  });
  root.querySelectorAll('[data-act="cancel"]').forEach((b) => b.addEventListener('click', () => ctx.closeSheet()));
  const readRemind = wireRemindEditor(root);

  root.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const name = f('name').value.trim();
    if (!name) { ctx.toast(t('Type a name first')); return; }
    const remind = readRemind();
    if (remind.error) { ctx.toast(remind.error); return; }
    const chosen = [...root.querySelectorAll('[data-ask]:checked')].map((b) => b.dataset.ask);
    const choices = splitList(f('choices').value);
    const unit = f('unit').value.trim();
    const values = splitList(f('values').value).map((v) => Number(v.replace(/[^0-9.]/g, '')));
    if (chosen.includes('bp') && chosen.some((a) => !['bp', 'measures', 'note'].includes(a))) {
      ctx.toast(t('Blood pressure can only be combined with your own numbers and Note')); return;
    }
    if (f('span').checked && chosen.includes('bp')) { ctx.toast(t('A start/finish button can\'t ask blood pressure')); return; }
    // Keep each number field's id once created (old entries refer to it);
    // new rows get an id made from their name.
    const measures = [];
    for (const row of root.querySelectorAll('.mdef')) {
      const mName = row.querySelector('[data-mn]').value.trim();
      if (!mName) continue;
      const m = { id: row.dataset.id || makeId(measures, mName), name: mName };
      if (measures.some((x) => x.id === m.id)) m.id = makeId(measures, mName);
      const mUnit = row.querySelector('[data-mu]').value.trim();
      if (mUnit) m.unit = mUnit;
      measures.push(m);
    }
    if (chosen.includes('measures') && !measures.length) { ctx.toast(t('Type a name for at least one number, e.g. Weight')); return; }
    // Pick-lists: a list keeps its id once created (old answers refer to it).
    const lists = [];
    for (const row of root.querySelectorAll('.ldef')) {
      const lName = row.querySelector('[data-ln]').value.trim();
      const options = parseOptions(row.querySelector('[data-lo]').value);
      if (!lName && !options.length) continue;
      if (!lName) { ctx.toast(t('Type a name for each list')); return; }
      if (!options.length) { ctx.toast(t('Type at least one answer for "{name}"', { name: lName })); return; }
      const low = options.map((o) => optName(o).toLowerCase());
      if (new Set(low).size !== low.length) { ctx.toast(t('"{name}" has the same answer twice', { name: lName })); return; }
      const l = { id: row.dataset.id || makeId(lists, lName), name: lName, options };
      if (lists.some((x) => x.id === l.id)) l.id = makeId(lists, lName);
      if (row.querySelector('[data-lm]').checked) l.multi = true;
      lists.push(l);
    }
    if (chosen.includes('lists') && !lists.length) { ctx.toast(t('Add at least one list with its answers')); return; }
    const goalRaw = f('goal').value.trim();
    const goal = goalRaw ? Number(goalRaw) : null;
    if (goalRaw && !(Number.isInteger(goal) && goal >= 1 && goal <= 1000)) { ctx.toast(t('The goal must be a whole number from 1 to 1000')); return; }
    if (chosen.includes('choice') && !choices.length) { ctx.toast(t('Type at least one type, e.g. Paracetamol')); return; }
    if (chosen.includes('amount')) {
      if (!unit) { ctx.toast(t('Type a unit for the amount, e.g. mg')); return; }
      if (!values.length || values.some((v) => !(v > 0))) { ctx.toast(t('Amount numbers must look like: 200, 400')); return; }
    }

    if (ctx.state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return;
    const cfg = JSON.parse(JSON.stringify(ctx.state.config));
    // Start from the existing item so unknown keys (e.g. "hidden") survive.
    const item = isNew ? { id: makeId(cfg.events, f('private').checked ? '' : name) } : cfg.events.find((x) => x.id === ev.id);
    if (!item) { ctx.closeSheet(); return; }
    item.name = name;
    if (color) item.color = color; else delete item.color;
    if (f('span').checked) item.span = true; else delete item.span;
    if (f('private').checked) {
      item.private = true;
      item.displayLabel = f('label').value.trim() || name.slice(0, 1).toUpperCase();
    } else {
      delete item.private;
      delete item.displayLabel;
    }
    if (chosen.length) item.ask = chosen; else delete item.ask;
    if (choices.length) item.choices = choices; else delete item.choices;
    if (measures.length) item.measures = measures; else delete item.measures;
    if (lists.length) item.lists = lists; else delete item.lists;
    if (goal) item.goal = goal; else delete item.goal;
    if (chosen.includes('amount')) item.amount = { unit, values };
    else if (!(unit && values.length && values.every((v) => v > 0))) delete item.amount;
    if (remind.list.length) item.remind = remind.list; else delete item.remind;
    if (isNew) cfg.events.push(item);

    const res = await saveConfig(cfg);
    if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return; }
    ctx.closeSheet();
    await ctx.reloadConfig();
    ctx.toast(t(isNew ? 'Added "{name}"' : 'Saved "{name}"', { name: eventLabel(item) }));
  });
}
