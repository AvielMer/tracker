// Beeps, vibration and "keep the screen on" for training timers.
//
// Beeps are generated with the Web Audio API, so no sound files are needed
// and they work offline. Browsers only allow sound after a tap, so
// unlockAudio() is called from the "Start set" button.
//
// WHY keep the screen on: when the screen turns off, the browser pauses
// the page's timers, so a countdown can't beep. During a workout we ask
// the phone to keep the screen awake instead.

let ac = null;
let soundOn = true;
let wakeLock = null;

export function setSoundOn(on) { soundOn = !!on; }
export function isSoundOn() { return soundOn; }

export function unlockAudio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch { /* no audio on this device: vibration still works */ }
}

function tone(freq, ms, delay = 0, vol = 0.3) {
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  o.connect(g).connect(ac.destination);
  o.start(t0);
  o.stop(t0 + ms / 1000 + 0.05);
}

const SOUNDS = {
  tick: [[880, 90]], // last 3 seconds of a countdown
  go: [[1320, 250]], // timing starts
  switch: [[988, 150], [1319, 250, 0.18]], // next part of a circuit
  end: [[1319, 180], [1319, 180, 0.25], [1760, 500, 0.5]], // set finished
  rest: [[880, 160], [1175, 160, 0.2], [1568, 350, 0.4]], // rest goal reached
};
const VIBES = {
  tick: 40, go: 150, switch: [90, 60, 90], end: [200, 100, 200, 100, 400], rest: [150, 80, 150, 80, 300],
};

// Vibration works even with sound off (e.g. phone on silent).
export function signal(kind) {
  try { if (navigator.vibrate) navigator.vibrate(VIBES[kind] || 50); } catch { /* ignore */ }
  if (!soundOn || !ac) return;
  try {
    if (ac.state === 'suspended') ac.resume();
    for (const [f, ms, d] of SOUNDS[kind] || []) tone(f, ms, d || 0);
  } catch { /* ignore */ }
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
