// Add / edit one event button: its name, privacy, and what it asks
// after a tap. Everything ends up in the config, nothing is hardcoded.

import { eventLabel, makeId, saveConfig } from './config.js';
import { esc } from './util.js';

const ASK_OPTIONS = [
  ['intensity', 'Intensity (1–10)'],
  ['duration_min', 'Duration (minutes)'],
  ['choice', 'Type — pick from a list (e.g. which medicine)'],
  ['amount', 'Amount — e.g. 400 mg'],
  ['count', 'How many (1–10) — e.g. several at once'],
  ['bp', 'Blood pressure + pulse — a series of readings with a rest timer (only combines with Note)'],
  ['note', 'Note (free text)'],
];

const splitList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

// ev = existing event to edit, or null to add a new one.
export function openEventEditor(ctx, ev) {
  const isNew = !ev;
  const cur = ev || { name: '', ask: [] };
  const ask = new Set(cur.ask || []);
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>${isNew ? 'Add a button' : 'Edit button'}</b></div>
    <div class="label">Name (saved in the log)</div>
    <input class="input" data-f="name" value="${esc(cur.name)}" placeholder="e.g. Medicine">
    <label class="check"><input type="checkbox" data-f="private" ${cur.private ? 'checked' : ''}> Private — show only a short label on screen</label>
    <input class="input" data-f="label" value="${esc(cur.displayLabel || '')}" placeholder="Label shown on screen (e.g. X)" ${cur.private ? '' : 'hidden'}>

    <div class="label" style="margin-top:12px">After a tap, ask:</div>
    ${ASK_OPTIONS.map(([k, text]) => `
      <label class="check"><input type="checkbox" data-ask="${k}" ${ask.has(k) ? 'checked' : ''}> ${esc(text)}</label>
      ${k === 'choice' ? `<div class="ask-cfg" data-cfg="choice" ${ask.has('choice') ? '' : 'hidden'}>
        <input class="input" data-f="choices" value="${esc((cur.choices || []).join(', '))}" placeholder="Paracetamol, Nurofen, Aspirin">
        <div class="small muted">Separate with commas. You can also add new ones later with "Other…".</div></div>` : ''}
      ${k === 'amount' ? `<div class="ask-cfg" data-cfg="amount" ${ask.has('amount') ? '' : 'hidden'}>
        <input class="input" data-f="unit" value="${esc(cur.amount?.unit || '')}" placeholder="Unit, e.g. mg or pills">
        <input class="input" data-f="values" value="${esc((cur.amount?.values || []).join(', '))}" placeholder="Quick numbers, e.g. 200, 400, 500">
        <div class="small muted">These become one-tap buttons. "Other…" lets you type any number.</div></div>` : ''}
    `).join('')}
    <p class="small muted">If you pick just one question, a single tap on the answer saves it.</p>
    <div class="sheet-actions">
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn primary" data-act="save">${isNew ? 'Add' : 'Save'}</button>
    </div>`);

  const f = (k) => root.querySelector(`[data-f="${k}"]`);
  f('private').addEventListener('change', () => { f('label').hidden = !f('private').checked; });
  root.querySelectorAll('[data-ask]').forEach((box) => box.addEventListener('change', () => {
    const cfg = root.querySelector(`[data-cfg="${box.dataset.ask}"]`);
    if (cfg) cfg.hidden = !box.checked;
  }));
  root.querySelector('[data-act="cancel"]').addEventListener('click', () => ctx.closeSheet());

  root.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const name = f('name').value.trim();
    if (!name) { ctx.toast('Type a name first'); return; }
    const chosen = [...root.querySelectorAll('[data-ask]:checked')].map((b) => b.dataset.ask);
    const choices = splitList(f('choices').value);
    const unit = f('unit').value.trim();
    const values = splitList(f('values').value).map((v) => Number(v.replace(/[^0-9.]/g, '')));
    if (chosen.includes('bp') && chosen.some((a) => a !== 'bp' && a !== 'note')) {
      ctx.toast('Blood pressure can only be combined with Note'); return;
    }
    if (chosen.includes('choice') && !choices.length) { ctx.toast('Type at least one type, e.g. Paracetamol'); return; }
    if (chosen.includes('amount')) {
      if (!unit) { ctx.toast('Type a unit for the amount, e.g. mg'); return; }
      if (!values.length || values.some((v) => !(v > 0))) { ctx.toast('Amount numbers must look like: 200, 400'); return; }
    }

    if (ctx.state.configErrors.length && !confirm('Your saved config has errors. Saving here will replace it with the last good version plus this change. Continue?')) return;
    const cfg = JSON.parse(JSON.stringify(ctx.state.config));
    // Start from the existing item so unknown keys (e.g. "hidden") survive.
    const item = isNew ? { id: makeId(cfg.events, f('private').checked ? '' : name) } : cfg.events.find((x) => x.id === ev.id);
    if (!item) { ctx.closeSheet(); return; }
    item.name = name;
    if (f('private').checked) {
      item.private = true;
      item.displayLabel = f('label').value.trim() || name.slice(0, 1).toUpperCase();
    } else {
      delete item.private;
      delete item.displayLabel;
    }
    if (chosen.length) item.ask = chosen; else delete item.ask;
    if (choices.length) item.choices = choices; else delete item.choices;
    if (chosen.includes('amount')) item.amount = { unit, values };
    else if (!(unit && values.length && values.every((v) => v > 0))) delete item.amount;
    if (isNew) cfg.events.push(item);

    const res = await saveConfig(cfg);
    if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return; }
    ctx.closeSheet();
    await ctx.reloadConfig();
    ctx.toast(`${isNew ? 'Added' : 'Saved'} "${eventLabel(item)}"`);
  });
}
