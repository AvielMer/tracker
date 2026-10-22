// The first switch to the Girl theme: flowers bloom over the dark screen
// while a growing circle washes it into the theme's colours. Asked for as
// "when it is switched the first time, an animation of flowers that turn the
// dark screen to beautiful colors". It also unlocks the Cycle tab (tabs.js)
// and offers it. Once only (kv "girl_bloom"); a tap skips to the end; with
// reduced motion everything is simply there.
// WHY a growing hole and not a fade: the dark layer keeps the old colour
// (--bloom-from) while the app underneath is already in the new theme, so
// the colours really spread out from the middle of the screen.

import * as storage from './storage.js';
import { setTheme } from './theme.js';
import { showTab, unlockCycle } from './tabs.js';
import { esc } from './util.js';
import { t } from './i18n.js';

const KEY = 'girl_bloom';

export async function bloomDone() {
  try { return (await storage.getValue(KEY)) === 'done'; } catch { return true; }
}

// A five-petal flower like the Girl theme's (inline SVG).
function flower(petal) {
  const petals = [0, 72, 144, 216, 288].map((r) => `<ellipse rx="9" ry="15" cy="-13" transform="rotate(${r})"/>`).join('');
  return `<svg viewBox="-30 -30 60 60" aria-hidden="true" focusable="false"><g fill="${petal}">${petals}</g>
    <circle r="7" fill="#ffe6bd"/><circle r="3" fill="#f2b06f" opacity=".6"/></svg>`;
}

// [x %, y %, size px, petal colour] — they open as the colour reaches them.
const FLOWERS = [
  [50, 52, 74, '#f7a9c6'], [22, 30, 54, '#cdb8f5'], [80, 26, 62, '#f9c08e'], [12, 62, 46, '#ff8fb1'],
  [86, 60, 50, '#cdb8f5'], [34, 78, 58, '#f9c08e'], [70, 84, 44, '#f7a9c6'], [58, 18, 40, '#ff8fb1'],
  [8, 12, 38, '#f7a9c6'], [93, 9, 34, '#cdb8f5'], [40, 40, 30, '#ffd1e3'], [66, 44, 32, '#ffd1e3'],
  [16, 90, 40, '#cdb8f5'], [90, 92, 38, '#ff8fb1'], [4, 38, 28, '#f9c08e'], [96, 40, 26, '#f7a9c6'],
];

// Plays the bloom over whatever is on screen and switches to the Girl
// theme. inWelcome: on the first welcome screen (don't leave it).
// Resolves with 'show' (the user wants the Cycle tab) or 'later'.
export function playBloom(ctx, { inWelcome = false } = {}) {
  return new Promise((resolve) => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ov = document.createElement('div');
    ov.className = `bloom${reduce ? ' still' : ''}`;
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'bloom-title');
    const dist = (x, y) => Math.hypot(x - 50, (y - 55) * 1.6) / 100;
    ov.innerHTML = `<div class="bloom-hole"></div>
      ${FLOWERS.map(([x, y, s, c]) => `<i class="bloom-fl" style="left:${x}%;top:${y}%;--s:${s}px;--d:${(0.45 + dist(x, y) * 1.5).toFixed(2)}s">${flower(c)}</i>`).join('')}
      ${Array.from({ length: 10 }, (_, k) => `<i class="bloom-pt" style="left:${(k * 10 + 4) % 100}%;--d:${(1.2 + (k % 5) * 0.7).toFixed(1)}s;--t:${(5 + (k % 3) * 1.4).toFixed(1)}s"></i>`).join('')}
      <div class="bloom-card">
        <div class="bloom-ico">${flower('#f7a9c6')}</div>
        <h2 id="bloom-title">${esc(t('Welcome to the Girl theme'))}</h2>
        <p>${esc(t('BLOOM_TEXT'))}</p>
        <button class="btn primary wide" data-bloom="show">${esc(t(inWelcome ? 'Turn on the Cycle tab' : 'Show me the Cycle tab'))}</button>
        <button class="btn wide" data-bloom="later">${esc(t('Later'))}</button>
      </div>`;
    document.body.append(ov);
    // A tap before the card is there jumps to the end.
    ov.addEventListener('click', (e) => { if (!e.target.closest('.bloom-card')) ov.classList.add('skip'); });
    let closing = false;
    const finish = async (choice) => {
      if (closing) return;
      closing = true;
      try {
        if (choice === 'show') await showTab(ctx.state.config, 'cycle', true);
      } catch { /* the tab can still be turned on in Settings → Tabs */ }
      ov.classList.add('done');
      setTimeout(() => ov.remove(), 450);
      if (choice === 'show' && !inWelcome) location.hash = '#cycle';
      else ctx.refresh();
      resolve(choice);
    };
    ov.querySelector('[data-bloom="show"]').addEventListener('click', () => finish('show'));
    ov.querySelector('[data-bloom="later"]').addEventListener('click', () => finish('later'));
    // The app turns pink underneath right away; the hole reveals it.
    (async () => {
      await storage.setValue(KEY, 'done').catch(() => {});
      await unlockCycle().catch(() => {});
      await setTheme('girl');
      ctx.refresh();
    })();
  });
}
