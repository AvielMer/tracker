// Cute animations for the Cycle tab: an animal buddy and interactive
// animations. Asked for (feedback from girls using the app: "the cycle tab
// is too plain") as "smiley themes with animals and interactive animations;
// since it might be heavy, a separate thing you download in the app, so
// the app stays clean".
//
// This file is NOT part of the app: the service worker doesn't keep it,
// and the app downloads it only when asked (Settings → Cycle, or the card
// on the Cycle tab). The app keeps the downloaded copy on the phone and
// loads it from there (js/funpack.js). So this file must stay self-contained:
// no imports. It only draws — every text it shows comes from the app,
// already translated.
//
// What the app calls (API 1):
//   mountStage(el, { animal, mood, lines, start, label, reduceMotion })
//   decorateCalendar(el, { intro, reduceMotion })
//   celebrate(el)          — a burst of hearts, e.g. after "Period started"
//   buddySvg(animal, mood) — a buddy picture, e.g. for the picker
// moods: hello, period, follicular, fertile, ovulation, luteal, pms, late.
// Everything moves with CSS transforms and opacity only (light on the
// battery), and nothing moves when the phone asks for reduced motion.

export const API = 1;
export const VERSION = 1;
export const ANIMALS = ['bunny', 'kitty', 'panda', 'fox', 'bear'];

// --- the buddies (inline SVG, drawn for this app) ---------------------------------

const LOOK = {
  bunny: { head: '#fffaf8', ear: '#fffaf8', inner: '#ffc4d6', nose: '#ff8fb1', ink: '#6b4453' },
  kitty: { head: '#ffd6a3', ear: '#ffd6a3', inner: '#ffb7c5', nose: '#ff8fa3', ink: '#6b4330', stripe: '#eda25a' },
  panda: { head: '#ffffff', ear: '#34343f', inner: '#34343f', nose: '#34343f', ink: '#2f2f3a', patch: '#34343f' },
  fox: { head: '#ff9f5a', ear: '#ff9f5a', inner: '#fff1e3', nose: '#4a2c1a', ink: '#5c3320', cheek: '#fff4ea', tip: '#5c3320' },
  bear: { head: '#c98d5e', ear: '#c98d5e', inner: '#a8703f', nose: '#4a2c1a', ink: '#4a2c1a', muzzle: '#f2d6b8' },
};
const PINK = '#ff8fab';
const HEART = '#ff5c8a';
const GOLD = '#ffc93c';
const st = (ink, w = 2.5) => `stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const heartPath = (x, y, s) => `M${x} ${y + s * 0.9}C${x - s * 1.3} ${y + s * 0.1} ${x - s * 1.1} ${y - s * 0.9} ${x - s * 0.5} ${y - s * 0.9}C${x - s * 0.2} ${y - s * 0.9} ${x} ${y - s * 0.6} ${x} ${y - s * 0.35}C${x} ${y - s * 0.6} ${x + s * 0.2} ${y - s * 0.9} ${x + s * 0.5} ${y - s * 0.9}C${x + s * 1.1} ${y - s * 0.9} ${x + s * 1.3} ${y + s * 0.1} ${x} ${y + s * 0.9}Z`;
const starPath = (x, y, r) => {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
};
const sparkPath = (x, y, r) => `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;
const flower = (x, y, r, petal = '#ffb3cf') => {
  let s = '';
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    s += `<circle cx="${(x + r * Math.cos(a)).toFixed(1)}" cy="${(y + r * Math.sin(a)).toFixed(1)}" r="${(r * 0.78).toFixed(1)}" fill="${petal}"/>`;
  }
  return `${s}<circle cx="${x}" cy="${y}" r="${(r * 0.62).toFixed(1)}" fill="${GOLD}"/>`;
};

function ears(a, c) {
  const s = st(c.ink);
  switch (a) {
    case 'bunny': return `
      <g class="fb-ear fb-ear-l"><ellipse cx="45" cy="21" rx="10.5" ry="24" fill="${c.ear}" ${s} transform="rotate(-12 45 38)"/>
        <ellipse cx="45" cy="23" rx="5" ry="16" fill="${c.inner}" transform="rotate(-12 45 38)"/></g>
      <g class="fb-ear fb-ear-r"><ellipse cx="75" cy="21" rx="10.5" ry="24" fill="${c.ear}" ${s} transform="rotate(12 75 38)"/>
        <ellipse cx="75" cy="23" rx="5" ry="16" fill="${c.inner}" transform="rotate(12 75 38)"/></g>`;
    case 'kitty': return `
      <path d="M25 54L31 17L56 37Z" fill="${c.ear}" ${s}/><path d="M32 45L35 26L48 37Z" fill="${c.inner}"/>
      <path d="M95 54L89 17L64 37Z" fill="${c.ear}" ${s}/><path d="M88 45L85 26L72 37Z" fill="${c.inner}"/>`;
    case 'fox': return `
      <path d="M24 57L29 12L58 36Z" fill="${c.ear}" ${s}/><path d="M31 46L33 24L49 37Z" fill="${c.inner}"/><path d="M27.4 26L29 12L36.5 18.5Z" fill="${c.tip}"/>
      <path d="M96 57L91 12L62 36Z" fill="${c.ear}" ${s}/><path d="M89 46L87 24L71 37Z" fill="${c.inner}"/><path d="M92.6 26L91 12L83.5 18.5Z" fill="${c.tip}"/>`;
    case 'panda': return `<circle cx="30" cy="38" r="12.5" fill="${c.ear}"/><circle cx="90" cy="38" r="12.5" fill="${c.ear}"/>`;
    default: return `<circle cx="30" cy="38" r="13" fill="${c.ear}" ${s}/><circle cx="30" cy="38" r="6.5" fill="${c.inner}"/>
      <circle cx="90" cy="38" r="13" fill="${c.ear}" ${s}/><circle cx="90" cy="38" r="6.5" fill="${c.inner}"/>`;
  }
}

// Under the face: panda eye patches, fox cheeks, bear muzzle, kitty stripes.
function marks(a, c) {
  switch (a) {
    case 'panda': return `<ellipse cx="44" cy="64" rx="9.5" ry="11.5" fill="${c.patch}" transform="rotate(-28 44 64)"/>
      <ellipse cx="76" cy="64" rx="9.5" ry="11.5" fill="${c.patch}" transform="rotate(28 76 64)"/>`;
    case 'fox': return `<path d="M22 72Q38 68 50 80Q56 96 60 99Q64 96 70 80Q82 68 98 72Q95 97 60 101Q25 97 22 72Z" fill="${c.cheek}"/>`;
    case 'bear': return `<ellipse cx="60" cy="81" rx="15" ry="11" fill="${c.muzzle}"/>`;
    case 'kitty': return `<path d="M53 34l1.5 7M60 32v7.5M67 34l-1.5 7" ${st(c.stripe, 2.6)} fill="none"/>`;
    default: return '';
  }
}

function eyes(mood, ink, panda) {
  const on = panda ? '#ffffff' : ink; // eyes on dark patches are light
  const hi = panda ? ink : '#ffffff';
  const open = (y = 64) => `<g class="fb-eyes"><ellipse cx="45" cy="${y}" rx="4.6" ry="5.6" fill="${on}"/><circle cx="46.7" cy="${y - 2.2}" r="1.7" fill="${hi}"/>
    <ellipse cx="75" cy="${y}" rx="4.6" ry="5.6" fill="${on}"/><circle cx="76.7" cy="${y - 2.2}" r="1.7" fill="${hi}"/></g>`;
  switch (mood) {
    case 'period': return `<path d="M39 64q6 5 12 0M69 64q6 5 12 0" ${st(on, 2.6)} fill="none"/>`;
    case 'luteal': return `<path d="M39 66q6-6 12 0M69 66q6-6 12 0" ${st(on, 2.6)} fill="none"/>`;
    case 'fertile': return `<path d="${heartPath(45, 64, 6)}" fill="${HEART}"/><path d="${heartPath(75, 64, 6)}" fill="${HEART}"/>`;
    case 'ovulation': return `<path d="${starPath(45, 64, 7)}" fill="${GOLD}" ${st(ink, 1.2)}/><path d="${starPath(75, 64, 7)}" fill="${GOLD}" ${st(ink, 1.2)}/>`;
    // A little blue, not cross: worried brows and a tiny tear.
    case 'pms': return `${open(66)}<path d="M37 58l10-4M83 58l-10-4" ${st(on, 2.4)} fill="none"/>
      <path class="fb-tear" d="M82 72q-2.6 4 0 6.2q2.6-2.2 0-6.2z" fill="#7fb8ff"/>`;
    case 'late': return `<g class="fb-eyes"><ellipse cx="45" cy="63" rx="4.6" ry="5.6" fill="${on}"/><circle cx="46" cy="60" r="1.7" fill="${hi}"/>
      <ellipse cx="75" cy="63" rx="4.6" ry="5.6" fill="${on}"/><circle cx="76" cy="60" r="1.7" fill="${hi}"/></g><path d="M68 52q7-4 13 1" ${st(on, 2.2)} fill="none"/>`;
    default: return open();
  }
}

function mouth(mood, a, c) {
  const nose = a === 'kitty' ? `<path d="M56.5 72.5h7l-3.5 4z" fill="${c.nose}" ${st(c.nose, 1.5)}/>`
    : a === 'bunny' ? `<ellipse cx="60" cy="74" rx="3.6" ry="2.7" fill="${c.nose}"/>`
      : `<ellipse cx="60" cy="74" rx="4.6" ry="3.3" fill="${c.nose}"/>`;
  const s = `${st(c.ink, 2.3)} fill="none"`;
  let m;
  switch (mood) {
    case 'ovulation': m = `<path d="M52 79q8 11 16 0z" fill="#e25570" ${st(c.ink, 2.3)}/>`; break;
    case 'period': m = `<path d="M56 80q4 3 8 0" ${s}/>`; break;
    case 'pms': m = `<path d="M54 84q6-5 12 0" ${s}/>`; break;
    case 'late': m = `<path d="M53 82q2.3-2 4.6 0t4.6 0t4.6 0" ${s}/>`; break;
    default: m = `<path d="M53 79q3.5 4 7 0q3.5 4 7 0" ${s}/>`;
  }
  const blush = mood === 'fertile' || mood === 'ovulation' ? 0.9 : mood === 'pms' ? 0.35 : 0.55;
  const whiskers = a === 'kitty' ? `<path d="M24 71l13 2M24 79l13-1M96 71l-13 2M96 79l-13-1" ${st(c.ink, 1.6)} fill="none" opacity=".6"/>` : '';
  return `${nose}${m}<ellipse cx="34" cy="76" rx="6.5" ry="4" fill="${PINK}" opacity="${blush}"/><ellipse cx="86" cy="76" rx="6.5" ry="4" fill="${PINK}" opacity="${blush}"/>${whiskers}`;
}

// What the buddy has with it, by mood.
function extras(mood, c) {
  const ink = c.ink;
  switch (mood) {
    case 'period': return `<path d="${heartPath(60, 106, 12)}" fill="#ff9dbb" ${st(ink, 2)}/>
      <text class="fb-z" x="96" y="34" font-size="15" font-weight="800" fill="${ink}">z</text>
      <text class="fb-z fb-z2" x="104" y="22" font-size="11" font-weight="800" fill="${ink}">z</text>`;
    case 'follicular': return `<path class="fb-spark" d="${sparkPath(102, 26, 7)}" fill="${GOLD}"/>
      <path class="fb-spark fb-s2" d="${sparkPath(15, 44, 5)}" fill="${GOLD}"/><path class="fb-spark fb-s3" d="${sparkPath(110, 58, 4)}" fill="${GOLD}"/>`;
    case 'fertile': return `<g transform="translate(-2 0)">${flower(24, 46, 5.2)}</g>
      <path class="fb-heart" d="${heartPath(100, 34, 6)}" fill="${HEART}"/><path class="fb-heart fb-h2" d="${heartPath(108, 52, 4)}" fill="${HEART}"/>`;
    case 'ovulation': return `<path d="M33 37q27-14 54 0" fill="none" stroke="#7cc47f" stroke-width="3" stroke-linecap="round"/>
      ${flower(36, 36, 4.4)}${flower(60, 29, 5)}${flower(84, 36, 4.4)}`;
    case 'luteal': return `<path class="fb-steam" d="M56 99q-2.5-3.5 0-7M64 99q-2.5-3.5 0-7" ${st(ink, 1.8)} fill="none" opacity=".5"/>
      <path d="M47 101h26v6a13 10 0 0 1-26 0z" fill="#ffffff" ${st(ink, 2)}/><path d="M73 103q8 0 7 6q-1 5-8 4" ${st(ink, 2)} fill="none"/>
      <path d="M52 104h16" stroke="#ffb3cf" stroke-width="3" stroke-linecap="round"/>`;
    case 'pms': return `<g class="fb-cloud"><path d="M84 30a7 7 0 0 1 13-3a6 6 0 0 1 11 4a5 5 0 0 1-1 10h-21a6 6 0 0 1-2-11z" fill="#c9d3e6" ${st(ink, 1.8)}/>
      <path class="fb-drop" d="M91 45q-2.2 3.4 0 5.4q2.2-2 0-5.4z" fill="#6fa8ff"/><path class="fb-drop fb-d2" d="M99 45q-2.2 3.4 0 5.4q2.2-2 0-5.4z" fill="#6fa8ff"/></g>`;
    case 'late': return `<g class="fb-q"><circle cx="101" cy="25" r="11" fill="#ffffff" ${st(ink, 2)}/>
      <text x="101" y="30.5" text-anchor="middle" font-size="15" font-weight="800" fill="${ink}">?</text></g>`;
    default: return '';
  }
}

function paws(mood, c) {
  const s = st(c.ink, 2.3);
  const paw = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="11.5" ry="8" fill="${c.head}" ${s}/><path d="M${x - 3.5} ${y - 2}v3.5M${x + 3.5} ${y - 2}v3.5" ${st(c.ink, 1.6)} opacity=".55"/>`;
  if (mood === 'hello') {
    return `${paw(40, 112)}<g class="fb-wave"><ellipse cx="103" cy="76" rx="10" ry="11.5" fill="${c.head}" ${s} transform="rotate(18 103 76)"/>
      <ellipse cx="104" cy="79" rx="4.2" ry="3.4" fill="${PINK}"/><circle cx="98.5" cy="71.5" r="1.9" fill="${PINK}"/>
      <circle cx="103" cy="69" r="1.9" fill="${PINK}"/><circle cx="107.5" cy="71" r="1.9" fill="${PINK}"/></g>`;
  }
  return `${paw(40, 112)}${paw(80, 112)}`;
}

export function buddySvg(animal, mood = 'hello') {
  const a = LOOK[animal] ? animal : 'bunny';
  const c = LOOK[a];
  const below = mood === 'period' || mood === 'luteal' ? extras(mood, c) : ''; // held between the paws
  return `<svg class="fb fb-${a} fb-${mood}" viewBox="0 0 120 124" aria-hidden="true" focusable="false">
    <g class="fb-body">${ears(a, c)}
      <ellipse cx="60" cy="66" rx="40" ry="35" fill="${c.head}" ${st(c.ink)}/>
      ${marks(a, c)}${eyes(mood, c.ink, a === 'panda')}${mouth(mood, a, c)}
      ${below ? '' : extras(mood, c)}
    </g>${below}${paws(mood, c)}</svg>`;
}

// Little things that float up and can be popped, by mood; treats by animal.
const FLOATS = {
  hello: 'heart', period: 'bubble', follicular: 'spark', fertile: 'heart', ovulation: 'flower', luteal: 'bubble', pms: 'bubble', late: 'bubble',
};
const TREAT = { bunny: 'carrot', kitty: 'fish', panda: 'leaf', fox: 'star', bear: 'honey' };
function shape(kind) {
  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
  switch (kind) {
    case 'heart': return svg(`<path d="${heartPath(12, 12, 9)}" fill="var(--fun-heart)"/>`);
    case 'spark': return svg(`<path d="${sparkPath(12, 12, 10)}" fill="${GOLD}"/>`);
    case 'flower': return svg(flower(12, 12, 5.2));
    case 'star': return svg(`<path d="${starPath(12, 12, 10)}" fill="${GOLD}"/>`);
    case 'carrot': return svg('<path d="M6 19L16 9l-1.5-1.5L4.5 17.5z" fill="#ff8c42"/><path d="M15 9l3-4M15.5 9.5l4-1.5M14.5 8.5l1.5-4" stroke="#5bb45f" stroke-width="2" stroke-linecap="round"/>');
    case 'fish': return svg('<path d="M3 12q6-7 13 0q-7 7-13 0z" fill="#7fb8ff"/><path d="M16 12l5-4v8z" fill="#7fb8ff"/><circle cx="8" cy="11" r="1.2" fill="#2f2f3a"/>');
    case 'leaf': return svg('<path d="M5 19q0-12 14-14q0 14-14 14z" fill="#6cc070"/><path d="M5 19l9-9" stroke="#3f8f44" stroke-width="1.5"/>');
    case 'honey': return svg('<path d="M12 3q6 8 6 12a6 6 0 0 1-12 0q0-4 6-12z" fill="#ffb627"/>');
    default: return svg('<circle cx="12" cy="12" r="8.5" fill="var(--fun-bubble)" stroke="var(--fun-bubble-edge)" stroke-width="1.5"/><circle cx="9" cy="9" r="2" fill="#ffffff" opacity=".7"/>');
  }
}

// --- styles (added to the page once) ----------------------------------------------

const CSS = `
.fun-stage { position: relative; height: 112px; margin: 0 0 -34px; z-index: 2; pointer-events: none;
  --fun-heart: var(--cy-period); --fun-bubble: color-mix(in srgb, var(--cy-fertile) 22%, transparent);
  --fun-bubble-edge: color-mix(in srgb, var(--cy-fertile) 60%, transparent); }
.fun-stage button { pointer-events: auto; -webkit-tap-highlight-color: transparent; }
.fun-buddy { position: absolute; inset-inline-end: 10px; bottom: 0; width: 112px; height: 116px; padding: 0; border: 0;
  background: none; cursor: pointer; touch-action: manipulation; }
.fun-buddy .fb { width: 100%; height: 100%; overflow: visible; display: block; }
.fun-bubble { position: absolute; inset-inline-end: 128px; bottom: 50px; max-width: calc(100% - 140px);
  padding: 9px 14px; border-radius: 18px; background: var(--card); color: var(--text); box-shadow: var(--shadow);
  font-size: 15px; font-weight: 650; line-height: 1.3; pointer-events: auto; cursor: pointer; transform-origin: 100% 100%; }
[dir="rtl"] .fun-bubble { transform-origin: 0 100%; }
.fun-bubble::after { content: ''; position: absolute; bottom: 9px; inset-inline-end: -7px; width: 14px; height: 14px;
  background: var(--card); transform: rotate(45deg); border-radius: 3px; }
.fun-float { position: absolute; bottom: 30px; width: 40px; height: 40px; padding: 8px; border: 0; background: none;
  opacity: 0; animation: fun-rise var(--dur) linear var(--delay) infinite; }
.fun-float svg { width: 100%; height: 100%; display: block; }
.fun-float.pop { animation: fun-pop .45s ease-out forwards; }
.fun-p { position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px; pointer-events: none;
  animation: fun-burst var(--t, .9s) cubic-bezier(.2,.7,.3,1) forwards; }
.fun-p svg { width: 100%; height: 100%; display: block; }
.fun-p.dot { width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 3px; background: var(--c); }

.fb-body { transform-origin: 60px 110px; animation: fun-breathe 3.2s ease-in-out infinite; }
.fb-eyes { transform-box: fill-box; transform-origin: center; animation: fun-blink 4.6s infinite; }
.fb-wave { transform-box: fill-box; transform-origin: 30% 90%; animation: fun-wave 1.6s ease-in-out infinite; }
.fb-z { animation: fun-z 2.8s ease-in-out infinite; } .fb-z2 { animation-delay: 1.4s; }
.fb-spark { transform-box: fill-box; transform-origin: center; animation: fun-twinkle 1.8s ease-in-out infinite; }
.fb-s2 { animation-delay: .6s; } .fb-s3 { animation-delay: 1.2s; }
.fb-heart { transform-box: fill-box; transform-origin: center; animation: fun-heart 2.4s ease-in-out infinite; } .fb-h2 { animation-delay: 1.1s; }
.fb-steam { animation: fun-steam 2.6s ease-in-out infinite; }
.fb-drop { animation: fun-rain 1.3s linear infinite; } .fb-d2 { animation-delay: .65s; }
.fb-tear { transform-box: fill-box; transform-origin: 50% 0; animation: fun-tear 2.6s ease-in-out infinite; }
.fb-q { transform-box: fill-box; transform-origin: 30% 100%; animation: fun-tilt 2.2s ease-in-out infinite; }
.fun-buddy.boing .fb { animation: fun-boing .7s cubic-bezier(.3,1.6,.5,1); }
.fun-buddy.intro .fb { animation: fun-peek .8s cubic-bezier(.3,1.4,.5,1) both; }
.fun-bubble.intro, .fun-bubble.swap { animation: fun-bubble .45s cubic-bezier(.3,1.5,.5,1) both; }
.fun-bubble.intro { animation-delay: .35s; }

.fun-st { position: absolute; inset-inline-end: -3px; top: -4px; width: 16px; height: 16px; pointer-events: none; }
.fun-st svg { width: 100%; height: 100%; display: block; }
.cy-grid.fun-intro .cy-d:not(.blank) { animation: fun-cell .42s cubic-bezier(.3,1.5,.5,1) both; animation-delay: calc(var(--i) * 12ms); }
.cy-d.fun-bounce { animation: fun-tap .3s ease-out; }
.cy-d.c-today.fun-today { animation: fun-glow 2.4s ease-in-out infinite; }

@keyframes fun-breathe { 0%, 100% { transform: translateY(0) scale(1, 1); } 50% { transform: translateY(-2px) scale(1.012, .99); } }
@keyframes fun-blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
@keyframes fun-wave { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-18deg); } 75% { transform: rotate(12deg); } }
@keyframes fun-z { 0% { opacity: 0; transform: translate(0, 4px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(6px, -10px); } }
@keyframes fun-twinkle { 0%, 100% { transform: scale(.6) rotate(0); opacity: .5; } 50% { transform: scale(1.15) rotate(20deg); opacity: 1; } }
@keyframes fun-heart { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-5px) scale(1.12); } }
@keyframes fun-steam { 0%, 100% { opacity: .15; transform: translateY(2px); } 50% { opacity: .6; transform: translateY(-2px); } }
@keyframes fun-rain { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(12px); opacity: 0; } }
@keyframes fun-tear { 0%, 60%, 100% { transform: translateY(0) scale(1); opacity: .9; } 80% { transform: translateY(3px) scale(1.1); opacity: 1; } }
@keyframes fun-tilt { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(8deg); } }
@keyframes fun-boing { 0% { transform: translateY(0) scale(1, 1); } 25% { transform: translateY(2px) scale(1.12, .86); }
  55% { transform: translateY(-22px) scale(.92, 1.1); } 80% { transform: translateY(0) scale(1.06, .95); } 100% { transform: translateY(0) scale(1, 1); } }
@keyframes fun-peek { from { transform: translateY(46px) scale(.7); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fun-bubble { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fun-rise { 0% { transform: translate(0, 10px) scale(.6); opacity: 0; } 15% { opacity: .95; }
  50% { transform: translate(var(--sway), -40px) scale(1); } 85% { opacity: .9; } 100% { transform: translate(0, -92px) scale(.9); opacity: 0; } }
@keyframes fun-pop { 0% { transform: scale(1); opacity: 1; } 60% { transform: scale(1.7); opacity: .7; } 100% { transform: scale(2.2); opacity: 0; } }
@keyframes fun-burst { 0% { transform: translate(0, 0) rotate(0) scale(.4); opacity: 1; }
  70% { opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--r)) scale(1); opacity: 0; } }
@keyframes fun-cell { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fun-tap { 0% { transform: scale(1); } 40% { transform: scale(.86); } 100% { transform: scale(1); } }
@keyframes fun-glow { 0%, 100% { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--text); }
  50% { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--text), 0 0 0 9px color-mix(in srgb, var(--cy-period) 25%, transparent); } }
.fun-still *, .fun-still *::before, .fun-still *::after { animation: none !important; }
.fun-still .fun-float { display: none; }
`;

function addStyles() {
  if (document.getElementById('fun-pack-css')) return;
  const s = document.createElement('style');
  s.id = 'fun-pack-css';
  s.textContent = CSS;
  document.head.append(s);
}

// --- the stage on the Cycle tab ----------------------------------------------------

const rnd = (a, b) => a + Math.random() * (b - a);
let lastMood = null;
let lastIntro = 0;

export function mountStage(el, opts = {}) {
  addStyles();
  const { animal = 'bunny', mood = 'hello', lines = [], label = '', reduceMotion = false } = opts;
  let i = Math.abs(opts.start || 0) % Math.max(1, lines.length);
  // The entrance plays when the tab is opened, not on every refresh.
  const intro = !reduceMotion && (mood !== lastMood || Date.now() - lastIntro > 300000);
  if (intro) lastIntro = Date.now();
  lastMood = mood;
  const kind = FLOATS[mood] || 'bubble';
  const floats = reduceMotion ? '' : Array.from({ length: 5 }, (_, k) => `<button class="fun-float" tabindex="-1" aria-hidden="true"
    style="inset-inline-start:${(4 + k * 13 + rnd(-3, 3)).toFixed(1)}%;--dur:${rnd(6.5, 10).toFixed(1)}s;--delay:${(k * 1.6 + rnd(0, 1)).toFixed(1)}s;--sway:${rnd(-14, 14).toFixed(0)}px">${shape(k === 2 ? TREAT[animal] || kind : kind)}</button>`).join('');
  el.classList.toggle('fun-still', reduceMotion);
  el.innerHTML = `${floats}
    ${lines.length ? `<div class="fun-bubble${intro ? ' intro' : ''}" aria-live="polite"></div>` : ''}
    <button class="fun-buddy${intro ? ' intro' : ''}" aria-label="${label.replace(/[<>"&]/g, '')}">${buddySvg(animal, mood)}</button>`;
  const bubble = el.querySelector('.fun-bubble');
  if (bubble) bubble.textContent = lines[i];
  const buddy = el.querySelector('.fun-buddy');
  const say = () => {
    if (!bubble || lines.length < 2) return;
    i = (i + 1) % lines.length;
    bubble.textContent = lines[i];
    bubble.classList.remove('intro', 'swap');
    void bubble.offsetWidth; // restart the animation
    bubble.classList.add('swap');
  };
  buddy.addEventListener('click', () => {
    say();
    if (navigator.vibrate) navigator.vibrate(12);
    if (reduceMotion) return;
    buddy.classList.remove('intro', 'boing');
    void buddy.offsetWidth;
    buddy.classList.add('boing');
    burst(el, buddy, 7, [kind === 'bubble' ? 'heart' : kind, TREAT[animal]]);
  });
  bubble?.addEventListener('click', say);
  el.querySelectorAll('.fun-float').forEach((f) => {
    f.addEventListener('click', () => {
      f.classList.add('pop');
      if (navigator.vibrate) navigator.vibrate(8);
      burst(el, f, 4, [kind]);
    });
    // After popping, float again from a new spot.
    f.addEventListener('animationend', (e) => {
      if (e.animationName !== 'fun-pop') return;
      f.classList.remove('pop');
      f.style.insetInlineStart = `${rnd(3, 62).toFixed(1)}%`;
    });
  });
}

// Particles flying out of an element (hearts, treats, confetti).
function burst(stage, from, n, kinds) {
  const s = stage.getBoundingClientRect();
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2 - s.left;
  const y = r.top + r.height / 2 - s.top;
  const colors = ['var(--cy-period)', 'var(--cy-fertile)', 'var(--cy-pms)', GOLD, '#ff9dbb'];
  for (let k = 0; k < n; k++) {
    const p = document.createElement('i');
    const a = rnd(0, Math.PI * 2);
    const d = rnd(40, 95);
    const isDot = k % 3 === 2;
    p.className = `fun-p${isDot ? ' dot' : ''}`;
    if (!isDot) p.innerHTML = shape(kinds[k % kinds.length] || 'heart');
    p.style.cssText = `left:${x}px;top:${y}px;--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d - 30).toFixed(0)}px;--r:${rnd(-120, 120).toFixed(0)}deg;--t:${rnd(0.7, 1.1).toFixed(2)}s;--c:${colors[k % colors.length]}`;
    p.addEventListener('animationend', () => p.remove());
    stage.append(p);
  }
}

// A bigger burst, e.g. after "Period started".
export function celebrate(el) {
  if (!el || el.classList.contains('fun-still')) return;
  const buddy = el.querySelector('.fun-buddy');
  if (!buddy) return;
  buddy.classList.remove('intro', 'boing');
  void buddy.offsetWidth;
  buddy.classList.add('boing');
  burst(el, buddy, 16, ['heart', 'spark', 'flower']);
}

// --- calendar stickers ---------------------------------------------------------------

const STICKER = {
  flower: shape('flower'),
  heart: shape('heart'),
  paw: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="var(--cy-period)"><ellipse cx="12" cy="15.5" rx="5" ry="4.2"/><circle cx="6" cy="10" r="2.3"/><circle cx="10" cy="6.5" r="2.3"/><circle cx="14" cy="6.5" r="2.3"/><circle cx="18" cy="10" r="2.3"/></g></svg>',
};

export function decorateCalendar(el, opts = {}) {
  addStyles();
  if (!el) return;
  const grid = el.querySelector('.cy-grid');
  if (!grid) return;
  const cells = [...grid.querySelectorAll('.cy-d:not(.blank)')];
  cells.forEach((c, k) => {
    c.style.setProperty('--i', k);
    let kind = null;
    if (c.classList.contains('c-ovu')) kind = 'flower';
    else if (c.classList.contains('c-today')) kind = 'paw';
    else if (c.classList.contains('c-exp') && !cells[k - 1]?.classList.contains('c-exp')) kind = 'heart';
    if (kind) c.insertAdjacentHTML('beforeend', `<i class="fun-st">${STICKER[kind]}</i>`);
    if (!opts.reduceMotion) {
      c.addEventListener('pointerdown', () => {
        c.classList.remove('fun-bounce');
        void c.offsetWidth;
        c.classList.add('fun-bounce');
      });
      if (c.classList.contains('c-today')) c.classList.add('fun-today');
    }
  });
  if (opts.intro && !opts.reduceMotion) grid.classList.add('fun-intro');
}
