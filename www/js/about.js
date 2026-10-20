// About: what the app is, privacy, how to install and use it, and where its
// code is. Written for the people the app is shared with (soldiers, anyone
// keeping track of their wellbeing), so a new user finds everything they
// need here without someone sitting next to them.

import { esc } from './util.js';
import { t } from './i18n.js';

const REPO = 'https://github.com/AvielMer/tracker';

export function renderAbout(el, ctx) {
  // This app's own address — the one to share (a copy of the app hosted
  // elsewhere shares its own address, not this one).
  const url = new URL('./', location.href).href;
  const sec = (title, body) => `<h2 class="day">${esc(title)}</h2><div class="card pad about-text">${body}</div>`;
  const p = (key) => `<p>${esc(t(key))}</p>`;
  el.innerHTML = `
    <div class="about-head">
      <img src="icons/icon-192.png" alt="" width="56" height="56">
      <div><b>Tracker</b><br><span class="muted small" data-ver></span></div>
    </div>
    <p class="about-lead">${esc(t('ABOUT_WHAT'))}</p>
    <button class="btn primary wide" data-act="share">${t('Share this app')}</button>
    ${sec(t('Your privacy'), p('ABOUT_PRIVACY') + p('ABOUT_BACKUP'))}
    ${sec(t('Install on your phone'), p('ABOUT_INSTALL'))}
    ${sec(t('How to use it'), `<ul class="about-list">
      <li><b>${t('Events')}</b> — ${esc(t('ABOUT_EVENTS'))}</li>
      <li><b>${t('Training')}</b> — ${esc(t('ABOUT_TRAINING'))}</li>
      <li><b>${t('Log')}</b> — ${esc(t('ABOUT_LOG'))}</li>
      <li><b>${t('Settings')}</b> — ${esc(t('ABOUT_SETTINGS'))}</li>
    </ul>`)}
    ${sec(t('Your language'), p('ABOUT_LANGUAGE'))}
    ${sec(t('Important'), `<p class="warn">${esc(t('ABOUT_MEDICAL'))}</p>`)}
    ${sec(t('Free · public code'), `${p('ABOUT_SOURCE')}
      <a class="btn wide" href="${REPO}" target="_blank" rel="noopener">GitHub · AvielMer/tracker ↗</a>`)}
    <p class="small muted center about-url">${esc(url)}</p>`;

  // The version is the cache name the service worker uses (sw.js VERSION),
  // so it can never be out of date.
  if ('caches' in window) {
    caches.keys().then((keys) => {
      const v = Math.max(...keys.map((k) => Number(/^tracker-v(\d+)$/.exec(k)?.[1] || 0)));
      const box = el.querySelector('[data-ver]');
      if (v > 0 && box) box.textContent = t('Version {v}', { v });
    }).catch(() => {});
  }

  el.querySelector('[data-act="share"]').addEventListener('click', async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Tracker', text: t('SHARE_TEXT'), url });
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // closed the share menu
    }
    try {
      await navigator.clipboard.writeText(url);
      ctx.toast(t('Link copied'));
    } catch {
      prompt(t('Copy this link:'), url);
    }
  });
}
