// Change the setup, or translate the whole app, with any AI chat (Claude,
// ChatGPT, Gemini…) — from the phone, without a computer or any coding:
//   1. Copy (or share) a ready-made prompt. It carries everything the AI
//      needs: the rules of tracker_config.json plus the current setup, or
//      every text of the app to translate.
//   2. Paste it into the AI and say what you want.
//   3. Paste the AI's whole answer back here. The JSON is picked out of the
//      answer, merged, checked like any config, and saved only after you
//      see what will change (and with Undo).
// Privacy: private buttons are left out of the setup prompt — the AI never
// sees them — and they stay exactly as they are. The log is never in a
// prompt.

import {
  configToText, eventLabel, fetchDefaultFor, getConfigText, saveConfigText, validateConfig,
} from './config.js';
import { loadLibrary, translateBuiltInNames } from './library.js';
import {
  checkPack, getLang, setLang, t, textsToTranslate,
} from './i18n.js';
import { downloadFile, esc, readFileText } from './util.js';

const REPO = 'https://github.com/AvielMer/tracker';
const ITEMS = ['events', 'exercises', 'routines'];

// --- the prompts -------------------------------------------------------------

function setupPrompt(cfg) {
  const setup = { events: cfg.events.filter((ev) => !ev.private), exercises: cfg.exercises, routines: cfg.routines };
  return `I use "Tracker", a free app for logging events and training (${REPO}). All its buttons, exercises and routines come from one JSON setup file. Please change it the way I ask at the end of this message.

HOW TO ANSWER
- Send the complete new setup as ONE JSON object in a \`\`\`json code block: every item, also the ones you don't change. No comments and no "..." inside the JSON.
- After the code block, say in a few short lines what you changed.
- If my request is unclear, ask me first.

RULES
- Never change an existing "id": my history is linked to it. A new item needs a new unique id made of lowercase latin letters, digits and _ (e.g. "night_sweats"), even when its name is in another language.
- To rename or translate, change only names: "name", "displayLabel", "choices", "unit", a measure's "name", a circuit part's "name".
- To take an item off the screen, prefer "hidden": true (its history stays).
- My private buttons are left out of this file on purpose. The app keeps them as they are.

THE FORMAT
{ "events": [...], "exercises": [...], "routines": [...] }

events = the one-tap buttons:
  "id", "name": required.
  "ask": what to ask right after the tap, in the order given (all optional, the user can skip them):
    "intensity" (1-10), "duration_min" (minutes), "choice" (needs "choices": ["Paracetamol", "Ibuprofen"]),
    "amount" (needs "amount": {"unit": "mg", "values": [200, 400]}), "count" (how many at once),
    "bp" (blood pressure + pulse; can only be combined with "measures" and "note"),
    "measures" (own number fields; needs "measures": [{"id": "weight", "name": "Weight", "unit": "kg"}]), "note".
  "span": true makes a start/finish button (e.g. a bottle opened today and finished tomorrow); not with "bp".
  Optional: "color": "#rrggbb", "hidden": true, "private": true with "displayLabel": "X" (the screen then shows only X).

exercises:
  "id", "name", "type": "reps" or "seconds": required.
  Optional: "allowWeight": true (extra kg), "start": the first number on the +/- stepper, "hidden": true.
  A circuit = several exercises in a row without stopping, with a beep at every switch:
    {"id": "core", "name": "Core circuit", "type": "seconds",
     "parts": [{"name": "Plank", "seconds": 30, "ex": "plank"}, {"name": "Sit-ups", "seconds": 30, "ex": "situps"}],
     "rounds": 2, "pause": 10}
    "ex" is the id of the exercise the part is. If that exercise is "reps", the part means "as many as you can in the time" and the app asks how many at the end.
    "rounds": 1-50 (repeats the list). "pause": 0-600 seconds between parts.

routines:
  "id", "name", "exercises": a list of exercise ids, or {"id": "pullups", "sets": 3, "reps": 8} to set a goal. Every id must exist in "exercises" ("reps" means seconds for a "seconds" exercise).

MY SETUP NOW
\`\`\`json
${JSON.stringify(setup, null, 1)}
\`\`\`

WHAT I WANT (in my own words, in any language):
`;
}

// pack: continuing a language that was already added (only the texts it
// still misses are sent), so the AI keeps its code and name.
function translatePrompt(texts, pack) {
  const target = pack ? `${pack.name} (code "${pack.code}")` : 'the language I write at the end of this message';
  return `Please translate the free app "Tracker" (${REPO}), a one-tap tracker for wellbeing events and training, into ${target}.

HOW TO ANSWER
Send ONE JSON object in a \`\`\`json code block, in exactly this shape:
{
  "language": {
    "code": "${pack ? pack.code : 'the language code, e.g. fr, ar, am, uk, pt-BR'}",
    "name": "${pack ? pack.name : "the language's own name, e.g. Français"}",
    "dir": "${pack ? pack.dir : 'ltr, or rtl for a right-to-left language (Arabic, Persian, Urdu…)'}",
    "texts": { every key below, with its translation }
  }
}
If you can't fit everything, stop after a complete text and close the JSON properly. I'll ask for the rest.

RULES
- Keep every key exactly as it is (also the English and ALL_CAPS ones); translate only the values.
- Keep every {placeholder} exactly as written ({n}, {name}, {time}, …). You may move it within the sentence.
- Keep symbols and emoji (✓ ⚠ ▶ ✎ • → ⏱ 💪 🔔 …).
- These are buttons and labels on a phone: short, simple, friendly, everyday words.
- Where a word changes with the number, write it as "word: {n}" so it fits every number.
- "lib:…" keys are exercise names (street workout / calisthenics), "cat:…" keys are exercise groups, "def:…" keys are the names of the starting buttons and routines.

TEXTS
\`\`\`json
${JSON.stringify(texts, null, 1)}
\`\`\`
${pack ? '' : '\nLANGUAGE:\n'}`;
}

// Every text to translate: the app's own, the library's exercise names
// and groups, and the starting buttons' and routines' names — so "Use …
// names for built-in items" can rename all of them into the new language.
// (The starting exercises are library exercises.)
async function translationTemplate() {
  const texts = textsToTranslate();
  try {
    const lib = await loadLibrary();
    for (const c of lib.categories) texts[`cat:${c.id}`] = c.name.en;
    for (const e of lib.exercises) texts[`lib:${e.id}`] = e.name.en;
  } catch { /* offline: the app's own texts are enough */ }
  try {
    const def = JSON.parse(await fetchDefaultFor('en'));
    for (const sec of ['events', 'routines']) for (const it of def[sec] || []) texts[`def:${sec}:${it.id}`] = it.name;
  } catch { /* offline */ }
  return texts;
}

// --- reading the answer --------------------------------------------------------

const unquote = (s) => { try { return JSON.parse(`"${s}"`); } catch { return null; } };

// The JSON inside an AI's answer: a ```json block, or the outermost { … }.
// A translation that was cut off (answers can hit a length limit) still
// gives every complete "key": "text" pair, so nothing done is lost.
// Returns { obj, partial } or throws with a message for the user.
export function readAnswer(text) {
  const s = String(text || '');
  const blocks = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)(?:```|$)/gi)].map((m) => m[1]);
  for (const c of [...blocks, s]) {
    const a = c.indexOf('{');
    const b = c.lastIndexOf('}');
    if (a < 0 || b <= a) continue;
    const body = c.slice(a, b + 1);
    // (Second try: without trailing commas, a common AI slip.)
    for (const attempt of [body, body.replace(/,\s*([}\]])/g, '$1')]) {
      try { return { obj: JSON.parse(attempt), partial: false }; } catch { /* next */ }
    }
  }
  const texts = {};
  let code = null;
  let name = null;
  let dir = null;
  for (const [, k, v] of s.matchAll(/"((?:[^"\\\n]|\\.)*)"\s*:\s*"((?:[^"\\\n]|\\.)*)"/g)) {
    const key = unquote(k);
    const val = unquote(v);
    if (key == null || val == null) continue;
    if (key === 'code') code = val;
    else if (key === 'name') name = val;
    else if (key === 'dir') dir = val;
    else texts[key] = val;
  }
  if (code && Object.keys(texts).length) return { obj: { language: { code, name: name || code, dir: dir || 'ltr', texts } }, partial: true };
  throw new Error(t('ANSWER_NOT_FOUND'));
}

const isPack = (o) => !!o && typeof o === 'object' && !Array.isArray(o)
  && typeof o.code === 'string' && !!o.texts && typeof o.texts === 'object';

// The current config with the answer applied, or null if the answer has
// neither a setup nor a language in it.
function mergeAnswer(current, obj) {
  const pack = isPack(obj) ? obj : isPack(obj?.language) ? obj.language : null;
  const hasItems = !!obj && typeof obj === 'object' && ITEMS.some((k) => Array.isArray(obj[k]));
  if (!pack && !hasItems) return null;
  const out = JSON.parse(JSON.stringify(current));
  if (hasItems) {
    for (const k of ITEMS) if (Array.isArray(obj[k])) out[k] = obj[k];
    // Private buttons were left out of the prompt, so they aren't in the
    // answer: each goes back where it was.
    current.events.forEach((ev, i) => {
      if (ev.private && !out.events.some((x) => x && x.id === ev.id)) out.events.splice(Math.min(i, out.events.length), 0, ev);
    });
  }
  if (pack) {
    const old = current.language;
    // The same language again (e.g. the texts it was still missing): add up.
    const same = old && old.code === pack.code;
    out.language = {
      code: pack.code,
      name: pack.name || (same ? old.name : pack.code),
      dir: pack.dir || (same ? old.dir : 'ltr'),
      texts: { ...(same ? old.texts : {}), ...pack.texts },
    };
  }
  return out;
}

// What saving would change, in words, so nothing is a surprise.
async function summaryHtml(oldCfg, newCfg) {
  const rows = [];
  const label = (k, x) => (k === 'events' ? eventLabel(x) : x.name);
  for (const [k, title] of [['events', t('Event buttons')], ['exercises', t('Exercises')], ['routines', t('Routines')]]) {
    const before = new Map(oldCfg[k].map((x) => [x.id, x]));
    const after = new Map(newCfg[k].map((x) => [x.id, x]));
    const added = [...after.values()].filter((x) => !before.has(x.id));
    const removed = [...before.values()].filter((x) => !after.has(x.id));
    const changed = [...after.values()].filter((x) => before.has(x.id) && JSON.stringify(before.get(x.id)) !== JSON.stringify(x));
    const moved = !added.length && !removed.length && [...after.keys()].join() !== [...before.keys()].join();
    const bits = [
      added.length ? `${esc(t('new:'))} ${added.map((x) => esc(label(k, x))).join(', ')}` : '',
      changed.length ? `${esc(t('changed:'))} ${changed.map((x) => esc(label(k, x))).join(', ')}` : '',
      removed.length ? `<span class="warn">${esc(t('removed:'))} ${removed.map((x) => esc(label(k, x))).join(', ')} (${esc(t('their history stays in the log'))})</span>` : '',
      moved ? esc(t('new order')) : '',
    ].filter(Boolean);
    if (bits.length) rows.push(`<li><b>${esc(title)}</b> — ${bits.join(' · ')}</li>`);
  }
  if (JSON.stringify(oldCfg.language || null) !== JSON.stringify(newCfg.language || null) && newCfg.language) {
    const p = checkPack(newCfg.language);
    const all = Object.keys(await translationTemplate());
    const missing = all.filter((k) => !p.texts[k]).length;
    rows.push(`<li><b>${esc(t('Language'))}</b> — ${esc(p.name)}: ${esc(t('{n} texts translated', { n: Object.keys(p.texts).length }))}${
      missing ? ` · <span class="warn">${esc(t('{n} still in English', { n: missing }))}</span>` : ''}${
      p.skipped ? ` · <span class="warn">${esc(t('{n} left out (a {…} part was changed)', { n: p.skipped }))}</span>` : ''}</li>`);
  }
  return rows.length ? `<ul class="ai-summary">${rows.join('')}</ul>` : `<p>${esc(t('Nothing would change.'))}</p>`;
}

// --- the sheets -------------------------------------------------------------------

// Hands a prompt over: the share menu (straight into an AI app on a phone)
// or the clipboard; if neither works, the text is shown to copy by hand.
async function giveText(ctx, root, text, how) {
  if (how === 'share') {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    ctx.toast(t('Copied — now paste it into the AI'));
  } catch {
    const box = root.querySelector('[data-manual]');
    box.hidden = false;
    box.value = text;
    box.focus();
    box.select();
    ctx.toast(t('Copy the text in the box (select all → copy)'));
  }
}

const promptButtons = () => `<div class="btn-row">
    <button class="btn primary" data-give="copy">📋 ${t('Copy the prompt')}</button>
    ${navigator.share ? `<button class="btn" data-give="share">${t('Share to an AI app…')}</button>` : ''}
  </div>
  <textarea class="input ai-box" data-manual readonly hidden></textarea>`;

const answerBox = () => `
  <div class="label" style="margin-top:14px">${t('The AI\'s answer')}</div>
  <textarea class="input ai-box" data-answer placeholder="${esc(t('Paste the AI\'s whole answer here'))}"></textarea>
  <button class="btn wide" data-act="check">${t('Check the answer')}</button>
  <div data-result></div>`;

// Wires the answer box: check → show what changes (or what's wrong) →
// Save (with Undo). A language that came with the answer is switched to.
function wireAnswer(ctx, root) {
  const result = root.querySelector('[data-result]');
  // The result is below the box, often off screen on a phone: bring it up.
  const show = (html) => {
    result.innerHTML = html;
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  root.querySelector('[data-act="check"]').addEventListener('click', async () => {
    let merged;
    let partial = false;
    try {
      const ans = readAnswer(root.querySelector('[data-answer]').value);
      partial = ans.partial;
      merged = mergeAnswer(ctx.state.config, ans.obj);
      if (!merged) throw new Error(t('ANSWER_NOT_FOUND'));
    } catch (e) {
      show(`<p class="warn">${esc(e.message)}</p>`);
      return;
    }
    const res = validateConfig(merged);
    if (!res.ok) {
      show(`<p class="warn">${esc(t('The answer has problems — nothing was changed:'))}</p>
        <ul class="errors">${res.errors.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <button class="btn wide" data-act="copy-errors">📋 ${t('Copy the problems for the AI')}</button>`);
      result.querySelector('[data-act="copy-errors"]').addEventListener('click', () => giveText(ctx, root,
        `The app could not use your answer:\n${res.errors.map((x) => `- ${x}`).join('\n')}\nPlease fix these and send the complete JSON again.`, 'copy'));
      return;
    }
    show(`${partial ? `<p class="warn small">${esc(t('The answer was cut off — the complete texts are used, the rest stays in English.'))}</p>` : ''}
      <p class="label">${esc(t('Saving will change:'))}</p>${await summaryHtml(ctx.state.config, res.config)}
      <button class="btn primary wide" data-act="save-answer">${t('Save')}</button>`);
    result.querySelector('[data-act="save-answer"]').addEventListener('click', async () => {
      const oldText = await getConfigText();
      const oldLang = getLang();
      const newLang = JSON.stringify(ctx.state.config.language || null) !== JSON.stringify(res.config.language || null)
        ? res.config.language?.code : null;
      const saved = await saveConfigText(configToText(res.config));
      if (!saved.ok) { ctx.toast(saved.errors[0], { error: true }); return; }
      ctx.closeSheet();
      await ctx.reloadConfig();
      if (newLang) { await setLang(newLang); ctx.refresh(); }
      ctx.toast(t('Saved'), {
        actionLabel: t('Undo'),
        onAction: async () => {
          await saveConfigText(oldText);
          if (newLang) await setLang(oldLang);
          await ctx.reloadConfig();
          ctx.toast(t('Undone'));
        },
      });
    });
  });
}

export function openSetupAI(ctx) {
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>🤖 ${t('Change the setup with AI')}</b>
      <button class="btn" data-act="close">${t('Close')}</button></div>
    <p class="small">${esc(t('AI_SETUP_HINT'))}</p>
    <ol class="steps">
      <li>${esc(t('Copy the prompt (it has your current setup in it).'))}</li>
      <li>${esc(t('Paste it into an AI chat (Claude, ChatGPT, Gemini…) and write what you want, in any language.'))}</li>
      <li>${esc(t('Copy the AI\'s whole answer and paste it below.'))}</li>
    </ol>
    ${promptButtons()}
    <p class="small muted">🔒 ${esc(t('AI_PRIVACY'))}</p>
    ${answerBox()}`);
  root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelectorAll('[data-give]').forEach((b) => b.addEventListener('click', () => giveText(ctx, root, setupPrompt(ctx.state.config), b.dataset.give)));
  wireAnswer(ctx, root);
}

export async function openTranslateAI(ctx) {
  const template = await translationTemplate();
  const pack = ctx.state.config.language || null;
  const p = pack ? checkPack(pack) : null;
  const missing = p ? Object.keys(template).filter((k) => !p.texts[k]) : [];
  const root = ctx.openSheet(`
    <div class="sheet-head"><b>🌐 ${t('Add a language with AI')}</b>
      <button class="btn" data-act="close">${t('Close')}</button></div>
    <p class="small">${esc(t('AI_TRANSLATE_HINT'))}</p>
    <ol class="steps">
      <li>${esc(t('Copy the prompt.'))}</li>
      <li>${esc(t('Paste it into an AI chat (Claude, ChatGPT, Gemini…) and write the language at the end, e.g. French.'))}</li>
      <li>${esc(t('Copy the AI\'s whole answer and paste it below.'))}</li>
    </ol>
    ${promptButtons()}
    ${p ? `<div class="card pad" style="margin-top:12px">
      <b>${esc(p.name)}</b> — ${esc(t('{n} texts translated', { n: Object.keys(p.texts).length }))}
      ${missing.length ? `<p class="small warn">${esc(t('{n} still in English', { n: missing.length }))}</p>
        <button class="btn wide" data-act="give-missing">📋 ${esc(t('Copy a prompt for the missing texts'))}</button>` : ''}
      <div class="btn-row">
        <button class="btn" data-act="export-lang">${t('Save as a file to share')}</button>
        <button class="btn danger" data-act="remove-lang">${esc(t('Remove {name}', { name: p.name }))}</button>
      </div>
    </div>` : ''}
    ${answerBox()}
    <label class="btn wide file">${t('Open a language file')}<input type="file" accept=".json,application/json,text/plain" data-act="open-lang" hidden></label>`);
  root.querySelector('[data-act="close"]').addEventListener('click', () => ctx.closeSheet());
  root.querySelectorAll('[data-give]').forEach((b) => b.addEventListener('click', () => giveText(ctx, root, translatePrompt(template, null), b.dataset.give)));
  root.querySelector('[data-act="give-missing"]')?.addEventListener('click', () => {
    giveText(ctx, root, translatePrompt(Object.fromEntries(missing.map((k) => [k, template[k]])), p), 'copy');
  });
  root.querySelector('[data-act="export-lang"]')?.addEventListener('click', () => {
    downloadFile(`tracker_language_${pack.code}.json`, `${JSON.stringify({ language: pack }, null, 1)}\n`, 'application/json');
  });
  root.querySelector('[data-act="remove-lang"]')?.addEventListener('click', async () => {
    if (!confirm(t('Remove {name}? You can add it again any time.', { name: p.name }))) return;
    // Built-in items still named in this language go back to the language
    // the app returns to — once the language is gone, its names could no
    // longer be told apart from names typed by hand. (Done while it is
    // still loaded, so its names are recognised.)
    const back = getLang() === pack.code ? 'en' : getLang();
    let cfg = JSON.parse(JSON.stringify(ctx.state.config));
    let renamed = 0;
    try {
      ({ cfg, changed: renamed } = await translateBuiltInNames(cfg, back));
    } catch { /* offline: just remove it */ }
    delete cfg.language;
    const res = await saveConfigText(configToText(cfg));
    if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return; }
    if (getLang() === pack.code) await setLang('en');
    ctx.closeSheet();
    await ctx.reloadConfig();
    ctx.toast(renamed ? `${t('Removed')} · ${t('Renamed: {n}', { n: renamed })}` : t('Removed'));
  });
  // A language file someone shared goes through the same checks.
  root.querySelector('[data-act="open-lang"]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    root.querySelector('[data-answer]').value = await readFileText(file);
    root.querySelector('[data-act="check"]').click();
  });
  wireAnswer(ctx, root);
}
