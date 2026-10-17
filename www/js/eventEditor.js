// Add / edit one event button: its name, privacy, and what it asks
// after a tap. Everything ends up in the config, nothing is hardcoded.

import {
  COLORS, eventLabel, makeId, saveConfig,
} from './config.js';
import { esc } from './util.js';
import { t } from './i18n.js';

// Labels are translation keys (see i18n.js).
const ASK_OPTIONS = [
  ['intensity', 'Intensity (1–10)'],
  ['duration_min', 'Duration (minutes)'],
  ['choice', 'ASK_choice'],
  ['amount', 'ASK_amount'],
  ['count', 'ASK_count'],
  ['bp', 'ASK_bp'],
  ['measures', 'ASK_measures'],
  ['note', 'ASK_note'],
];

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
  const cur = ev || { name: '', ask: [] };
  const ask = new Set(cur.ask || []);
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${isNew ? t('Add a button') : t('Edit button')}</b></div>
    <div class="label">${t('Name (saved in the log)')}</div>
    <input class="input" data-f="name" value="${esc(cur.name)}" placeholder="${esc(t('e.g. Medicine'))}">
    <label class="check"><input type="checkbox" data-f="private" ${cur.private ? 'checked' : ''}> ${t('Private — show only a short label on screen')}</label>
    <input class="input" data-f="label" value="${esc(cur.displayLabel || '')}" placeholder="${esc(t('Label shown on screen (e.g. X)'))}" ${cur.private ? '' : 'hidden'}>

    <div class="label" style="margin-top:12px">${t('Color')}</div>
    <div class="swatches">
      <button class="swatch none${cur.color ? '' : ' on'}" data-color="" aria-label="${esc(t('No color'))}">✕</button>
      ${COLORS.map(([hex, nm]) => `<button class="swatch${cur.color?.toLowerCase() === hex ? ' on' : ''}" data-color="${hex}" style="--c:${hex}" aria-label="${nm}"></button>`).join('')}
    </div>
    <div class="label" style="margin-top:12px">${t('After a tap, ask:')}</div>
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
    `).join('')}
    <p class="small muted">${esc(t('ONE_QUESTION_HINT'))}</p>
    <div class="sheet-actions">
      <button class="btn" data-act="cancel">${t('Cancel')}</button>
      <button class="btn primary" data-act="save">${isNew ? t('Add') : t('Save')}</button>
    </div>`);

  const f = (k) => root.querySelector(`[data-f="${k}"]`);
  let color = cur.color || '';
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
  root.querySelector('[data-mlist]').addEventListener('click', (e) => {
    if (e.target.closest('[data-mdel]')) e.target.closest('.mdef').remove();
  });
  root.querySelector('[data-act="cancel"]').addEventListener('click', () => ctx.closeSheet());

  root.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const name = f('name').value.trim();
    if (!name) { ctx.toast(t('Type a name first')); return; }
    const chosen = [...root.querySelectorAll('[data-ask]:checked')].map((b) => b.dataset.ask);
    const choices = splitList(f('choices').value);
    const unit = f('unit').value.trim();
    const values = splitList(f('values').value).map((v) => Number(v.replace(/[^0-9.]/g, '')));
    if (chosen.includes('bp') && chosen.some((a) => !['bp', 'measures', 'note'].includes(a))) {
      ctx.toast(t('Blood pressure can only be combined with your own numbers and Note')); return;
    }
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
    if (chosen.includes('amount')) item.amount = { unit, values };
    else if (!(unit && values.length && values.every((v) => v > 0))) delete item.amount;
    if (isNew) cfg.events.push(item);

    const res = await saveConfig(cfg);
    if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return; }
    ctx.closeSheet();
    await ctx.reloadConfig();
    ctx.toast(t(isNew ? 'Added "{name}"' : 'Saved "{name}"', { name: eventLabel(item) }));
  });
}
