// Beeps, vibration and "keep the screen on" for training timers.
//
// Beeps are generated with the Web Audio API, so no sound files are needed
// and they work offline. Browsers only allow sound after a tap, so
// unlockAudio() is called from the "Start set" button (and from Test).
//
// WHY keep the screen on: when the screen turns off, the browser pauses
// the page's timers, so a countdown can't beep. During a workout we ask
// the phone to keep the screen awake instead.
//
// How loud (asked for as "the alarm is not loud enough — when I train I'm
// not always near the phone when it's time to switch"): kv "tr_volume".
// - 'normal': the old soft beeps (sine, fading out).
// - 'loud' (the default): full volume, a sharper alarm-like sound at 2–3
//   kHz, where phone speakers and ears are strongest, held at full
//   strength instead of fading at once, and longer.
// - 'max': as loud, and the end-of-rest / end-of-set alarm repeats 3 times
//   (until a set starts: hush()); the circuit's switch beeps play twice.
// The phone's own media volume still sets the top; a web page can't raise it.

let ac = null;
let soundOn = true;
let level = 'loud';
let wakeLock = null;
let bright = null; // the sharper wave, made once
const live = new Set(); // tones scheduled, so hush() can stop repeats

export const LEVELS = ['normal', 'loud', 'max'];

export function setSoundOn(on) { soundOn = !!on; }
export function isSoundOn() { return soundOn; }
export function setLevel(v) { level = LEVELS.includes(v) ? v : 'loud'; }

export function unlockAudio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch { /* no audio on this device: vibration still works */ }
}

// A square-like wave (odd harmonics): it sounds much louder than a pure
// tone at the same level, like a real alarm.
function brightWave() {
  if (!bright) {
    const imag = new Float32Array([0, 1, 0, 1 / 3, 0, 1 / 5]);
    bright = ac.createPeriodicWave(new Float32Array(imag.length), imag);
  }
  return bright;
}

function tone(freq, ms, delay, loud) {
  const t0 = ac.currentTime + delay;
  const t1 = t0 + ms / 1000;
  const o = ac.createOscillator();
  const g = ac.createGain();
  if (loud) {
    o.setPeriodicWave(brightWave());
    // Up fast, hold at full strength, then off.
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.95, t0 + 0.008);
    g.gain.setValueAtTime(0.95, Math.max(t0 + 0.008, t1 - 0.03));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
  } else {
    o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
  }
  o.frequency.value = freq;
  o.connect(g).connect(ac.destination);
  o.start(t0);
  o.stop(t1 + 0.05);
  live.add(o);
  o.onended = () => live.delete(o);
}

// [frequency Hz, length ms, start s]
const SOFT = {
  tick: [[880, 90]], // last 3 seconds of a countdown
  go: [[1320, 250]], // timing starts
  switch: [[988, 150], [1319, 250, 0.18]], // next part of a circuit
  end: [[1319, 180], [1319, 180, 0.25], [1760, 500, 0.5]], // set finished
  rest: [[880, 160], [1175, 160, 0.2], [1568, 350, 0.4]], // rest goal reached
  pause: [[784, 160], [587, 280, 0.18]], // short pause between circuit parts
};
const LOUD = {
  tick: [[1976, 120]],
  go: [[2637, 400]],
  switch: [[2093, 180], [2794, 360, 0.22]],
  end: [[2637, 220], [2637, 220, 0.3], [3136, 650, 0.6]],
  rest: [[2093, 220], [2637, 220, 0.28], [3136, 520, 0.56]],
  pause: [[1568, 180], [1175, 320, 0.22]],
};
const VIBES = {
  tick: 40, go: 150, switch: [90, 60, 90], end: [200, 100, 200, 100, 400], rest: [150, 80, 150, 80, 300], pause: [60, 60, 60],
};
// 'max': these alarms come back, every REPEAT_GAP seconds.
const REPEATS = { rest: 3, end: 3 };
const REPEAT_GAP = 2.4;
// 'max': these short cues play twice in a row.
const TWICE = new Set(['go', 'switch', 'pause']);

function notes(kind) {
  const base = (level === 'normal' ? SOFT : LOUD)[kind] || [];
  if (level !== 'max') return base;
  if (REPEATS[kind]) {
    return Array.from({ length: REPEATS[kind] }, (_, r) => base.map(([f, ms, d]) => [f, ms, (d || 0) + r * REPEAT_GAP])).flat();
  }
  if (TWICE.has(kind)) {
    const len = Math.max(...base.map(([, ms, d]) => (d || 0) + ms / 1000)) + 0.12;
    return [...base, ...base.map(([f, ms, d]) => [f, ms, (d || 0) + len])];
  }
  return base;
}

function vibes(kind) {
  const v = VIBES[kind] || 50;
  if (level !== 'max' || !REPEATS[kind]) return v;
  // The same buzz again with each repeat of the sound.
  const one = [].concat(v);
  const gap = REPEAT_GAP * 1000 - one.reduce((a, b) => a + b, 0);
  return Array.from({ length: REPEATS[kind] }, (_, r) => (r ? [gap, ...one] : one)).flat();
}

// Vibration works even with sound off (e.g. phone on silent).
export function signal(kind) {
  try { if (navigator.vibrate) navigator.vibrate(vibes(kind)); } catch { /* ignore */ }
  if (!soundOn || !ac) return;
  try {
    if (ac.state === 'suspended') ac.resume();
    for (const [f, ms, d] of notes(kind)) tone(f, ms, d || 0, level !== 'normal');
  } catch { /* ignore */ }
}

// Stops an alarm that is still repeating (a set was started).
export function hush() {
  for (const o of live) { try { o.stop(); } catch { /* already done */ } }
  live.clear();
  try { if (navigator.vibrate) navigator.vibrate(0); } catch { /* ignore */ }
}

export async function keepAwake(on) {
  try {
    if (on) {
      if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock?.request('screen');
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not supported or refused: the workout still works */ }
}
