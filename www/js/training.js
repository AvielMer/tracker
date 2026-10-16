// Training screen — built in step 2. For now it shows the routines from
// the config so the "Start training" shortcut has somewhere to land.

import { esc } from './util.js';

export function renderTraining(el, ctx) {
  const { routines, exercises } = ctx.state.config;
  const name = (id) => (exercises.find((x) => x.id === id) || { name: id }).name;
  el.innerHTML = `
    <div class="empty">Training arrives in step 2.</div>
    ${routines.length ? `<h2 class="day">Routines in your config</h2><div class="card pad">${routines.map((r) =>
      `<p><b>${esc(r.name)}</b><br><span class="muted small">${r.exercises.map((id) => esc(name(id))).join(' · ')}</span></p>`).join('')}</div>` : ''}`;
}
