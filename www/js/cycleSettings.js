// The Cycle tab's own settings, inside the tab (#cycle/settings) — asked for
// as "make the cycle tab's settings self contained": everything about the
// cycle is in one place, and nothing of it is in the rest of the app.
// - which button marks the period days, the diary button, the usual lengths
//   (until the log has its own), fertile and PMS days shown or not
//   (config "cycle", see cycleCalc.js);
// - the tab's own buttons (Period, diary): edit them here — they are not on
//   the Events screen or in Settings → Buttons (tabs.js ownedIds);
// - the cute animations (funpack.js);
// - Turn off the Cycle tab: hides it and its buttons; unused buttons are
//   removed. Nothing logged is deleted.

import { eventLabel, saveConfig } from './config.js';
import { openEventEditor } from './eventEditor.js';
import { cycleSettings, DEFAULTS as CYCLE_DEFAULTS } from './cycleCalc.js';
import {
  downloadFun, funInfo, funPrefs, loadFun, removeFun, setFunPrefs, sizeText,
} from './funpack.js';
import { ownedIds, showTab, visibleTabs } from './tabs.js';
import { icon } from './icons.js';
import { esc } from './util.js';
import { t } from './i18n.js';

// Every change is validated by saveConfig first, so a mistake here can never
// break the setup.
async function change(ctx, mutate, okMsg) {
  const { state } = ctx;
  if (state.configErrors.length && !confirm(t('CONFIG_ERRORS_CONFIRM'))) return false;
  const cfg = JSON.parse(JSON.stringify(state.config));
  if (mutate(cfg) === false) return false;
  const res = await saveConfig(cfg);
  if (!res.ok) { ctx.toast(res.errors[0], { error: true }); return false; }
  await ctx.reloadConfig();
  if (okMsg) ctx.toast(okMsg);
  return true;
}

export function renderCycleSettings(el, ctx) {
  const { config } = ctx.state;
  const cs = cycleSettings(config);
  const spans = config.events.filter((e) => e.span);
  const periodEv = config.events.find((e) => e.id === cs.period) || null;
  const diaryEv = config.events.find((e) => e.id === cs.diary) || null;
  const opt = (e, cur) => `<option value="${esc(e.id)}"${e.id === cur ? ' selected' : ''}>${esc(eventLabel(e))}</option>`;
  const editRow = (ev, label) => (ev ? `<button class="lrow-main" data-edit="${esc(ev.id)}">
    <span class="dot" style="--c:${ev.color || 'var(--line)'}"></span>
    <span class="lrow-text"><span class="lrow-name">${esc(label)}</span><span class="lrow-sub">${esc(eventLabel(ev))}</span></span>
    <span class="lrow-end">${icon('chevron', 'flip')}</span></button>` : '');
  el.innerHTML = `
    <p class="page-hint">${esc(t('CYCLE_SETTINGS_HINT'))}</p>
    <div class="card pad cy-set">
      <label class="label-block">${esc(t('Usual cycle length (days)'))}<input class="input" data-c="length" inputmode="numeric" value="${cs.length}"></label>
      <label class="label-block">${esc(t('Usual period length (days)'))}<input class="input" data-c="periodLength" inputmode="numeric" value="${cs.periodLength}"></label>
      <p class="small muted">${esc(t('USUAL_LENGTH_HINT'))}</p>
      <label class="check"><input type="checkbox" data-c="fertile" ${cs.fertile ? 'checked' : ''}> ${esc(t('Show fertile days and ovulation'))}</label>
      <label class="check"><input type="checkbox" data-c="pms" ${cs.pms ? 'checked' : ''}> ${esc(t('Show PMS days'))}</label>
    </div>
    <h2 class="day">${esc(t("This tab's buttons"))}</h2>
    ${periodEv || diaryEv ? `<div class="card list">${editRow(periodEv, t('Period button'))}${editRow(diaryEv, t('Diary button'))}</div>` : ''}
    <div class="card pad cy-set">
      <label class="label-block">${esc(t('Period button'))}<select class="input" data-c="period">
        ${spans.some((e) => e.id === cs.period) ? '' : `<option value="" selected>${esc(t('— choose —'))}</option>`}
        ${spans.map((e) => opt(e, cs.period)).join('')}</select></label>
      <p class="small muted">${esc(t('PERIOD_BUTTON_HINT'))}</p>
      <label class="label-block">${esc(t('Diary button'))}<select class="input" data-c="diary">
        <option value="">${esc(t('None'))}</option>
        ${config.events.filter((e) => !e.span).map((e) => opt(e, cs.diary)).join('')}</select></label>
    </div>
    <div data-fun-sec></div>
    <h2 class="day">${esc(t('Turn off'))}</h2>
    <div class="card pad">
      <p class="small muted">${esc(t('CYCLE_OFF_HINT'))}</p>
      <button class="btn wide danger" data-act="off">${esc(t('Turn off the Cycle tab'))}</button>
    </div>`;
  funSection(el.querySelector('[data-fun-sec]'), ctx);

  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const ev = ctx.state.config.events.find((e) => e.id === b.dataset.edit);
    if (ev) openEventEditor(ctx, ev);
  }));
  const LIMITS = { length: [20, 45], periodLength: [1, 12] };
  el.querySelectorAll('[data-c]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.c;
    let v;
    if (inp.type === 'checkbox') v = inp.checked;
    else if (LIMITS[k]) {
      v = Number(inp.value.trim());
      const [lo, hi] = LIMITS[k];
      if (!(Number.isInteger(v) && v >= lo && v <= hi)) {
        ctx.toast(t('Type a whole number from {lo} to {hi}', { lo, hi }));
        inp.value = cs[k];
        return;
      }
    } else v = inp.value || null;
    change(ctx, (cfg) => {
      cfg.cycle = { ...(cfg.cycle || {}) };
      // A default value needn't be written into the setup file.
      if (v === null || v === CYCLE_DEFAULTS[k]) delete cfg.cycle[k]; else cfg.cycle[k] = v;
      return true;
    }, t('Saved'));
  }));
  el.querySelector('[data-act="off"]').addEventListener('click', () => turnOff(ctx));
}

// Hides the tab. Its buttons that were never used are removed from the
// setup too (Undo puts everything back); used ones stay, out of sight, so
// their entries keep their names.
async function turnOff(ctx) {
  const { state } = ctx;
  const before = JSON.parse(JSON.stringify(state.config));
  const owned = ownedIds(state.config);
  const unused = state.config.events.filter((e) => owned.has(e.id) && !state.entries.some((x) => x.item_id === e.id));
  if (unused.length) {
    const ok = await change(ctx, (cfg) => {
      cfg.events = cfg.events.filter((e) => !unused.some((u) => u.id === e.id));
      return true;
    });
    if (!ok) return;
  }
  await showTab(state.config, 'cycle', false);
  location.hash = `#${visibleTabs(state.config)[0] || 'settings'}`;
  ctx.toast(t('Cycle tab turned off'), {
    actionLabel: t('Undo'),
    onAction: async () => {
      if (unused.length) {
        const res = await saveConfig(before);
        if (res.ok) await ctx.reloadConfig();
      }
      await showTab(ctx.state.config, 'cycle', true);
      location.hash = '#cycle';
    },
  });
}

// The cute animations for the Cycle tab (funpack.js): download or remove
// them, and pick the animal buddy.
const ANIMAL_NAME = { bunny: 'Bunny', kitty: 'Kitty', panda: 'Panda', fox: 'Fox', bear: 'Bear' };

async function funSection(box, ctx) {
  const info = await funInfo();
  const fun = info.installed ? await loadFun() : null;
  const { animal } = await funPrefs();
  const getBtn = (label) => `<button class="btn primary wide" data-fun="get">${icon('download')}<span>${esc(label)}</span></button>`;
  box.innerHTML = `<h2 class="day">${esc(t('Cute animations'))}</h2>
    <div class="card pad fun-sec">
      <p class="small muted">${esc(t('FUN_DESC'))}</p>
      ${!info.installed ? getBtn(t('Download')) : `
        ${fun ? `<div class="label">${esc(t('Your buddy'))}</div>
          <div class="fun-pick">${fun.ANIMALS.map((a) => `<button class="fun-pick-b${a === animal ? ' on' : ''}" data-animal="${esc(a)}" aria-pressed="${a === animal}">
            ${fun.buddySvg(a, 'hello')}<span>${esc(t(ANIMAL_NAME[a] || a))}</span></button>`).join('')}</div>`
    : `<p class="warn small">${esc(t('FUN_BROKEN'))}</p>`}
        <p class="small muted">${esc(t('On this phone · {size}', { size: sizeText(info.bytes) }))}</p>
        ${info.outdated || !fun ? getBtn(t('Update the animations')) : ''}
        <button class="btn wide danger" data-fun="remove">${esc(t('Remove the animations'))}</button>`}
    </div>`;
  box.querySelector('[data-fun="get"]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.querySelector('span').textContent = t('Downloading…');
    try {
      await downloadFun();
      ctx.toast(t('Animations downloaded ✨'));
    } catch (err) {
      ctx.toast(t('FUN_FAIL'), { error: true });
      console.warn('Download failed:', err);
    }
    funSection(box, ctx);
  });
  box.querySelector('[data-fun="remove"]')?.addEventListener('click', async () => {
    await removeFun();
    ctx.toast(t('Animations removed'));
    funSection(box, ctx);
  });
  box.querySelectorAll('[data-animal]').forEach((b) => b.addEventListener('click', async () => {
    await setFunPrefs({ animal: b.dataset.animal });
    funSection(box, ctx);
  }));
}
