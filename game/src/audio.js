// Synthesized sound: every effect is built from oscillators and filtered
// noise at runtime — no audio assets, no network. World sounds attenuate
// with distance and pan with the direction relative to the player's view.
import { S, eyePos } from './state.js';
import { WEAPONS } from './config.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let lastBeep = 0;

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  // One second of white noise, reused by every noise-based sound.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function resumeAudio() {
  initAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

// Positional mix for a world position: gain falls with distance, pan
// follows the bearing relative to the player's facing.
function mixAt(x, z) {
  const p = S.fighters[0];
  if (!p) return { gain: 0.6, pan: 0 };
  const dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  const gain = Math.max(0.05, 1 / (1 + d * 0.09));
  // Bearing: 0 = ahead, + = right. Forward is (-sin yaw, -cos yaw).
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const rx = -fz, rz = fx; // right vector
  const pan = d < 0.5 ? 0 : Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d));
  return { gain, pan };
}

function noise(dur, { type = 'bandpass', freq = 1200, q = 0.8, gain = 0.6, pan = 0, sweepTo = null, when = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = type; filt.frequency.setValueAtTime(freq, t); filt.Q.value = q;
  if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  src.connect(filt).connect(g).connect(panner).connect(master);
  src.start(t); src.stop(t + dur + 0.05);
}

function tone(freq, dur, { type = 'sine', gain = 0.3, pan = 0, sweepTo = null, when = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  osc.connect(g).connect(panner).connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);
}

function gunshot(weaponId, x, z) {
  const { gain, pan } = mixAt(x, z);
  if (weaponId === 'p9') {
    noise(0.09, { freq: 1800, gain: 0.55 * gain, pan });
    tone(130, 0.09, { sweepTo: 55, gain: 0.4 * gain, pan });
  } else if (weaponId === 'k7') {
    noise(0.06, { freq: 2400, gain: 0.45 * gain, pan });
    tone(150, 0.06, { sweepTo: 70, gain: 0.3 * gain, pan });
  } else if (weaponId === 'r4') {
    noise(0.12, { freq: 1500, gain: 0.6 * gain, pan });
    tone(95, 0.12, { sweepTo: 45, gain: 0.45 * gain, pan });
  } else if (weaponId === 'l96') {
    noise(0.28, { type: 'lowpass', freq: 900, sweepTo: 120, gain: 0.8 * gain, pan });
    tone(75, 0.32, { sweepTo: 32, gain: 0.6 * gain, pan });
  }
}

export function onAudioEvent(e) {
  if (!ctx) return;
  switch (e.kind) {
    case 'shot': gunshot(e.weapon, e.x, e.z); break;
    case 'dry': tone(1900, 0.03, { type: 'square', gain: 0.12 }); break;
    case 'reload':
      tone(700, 0.04, { type: 'square', gain: 0.1 });
      tone(500, 0.04, { type: 'square', gain: 0.1, when: 0.3 });
      break;
    case 'reloaded': tone(900, 0.05, { type: 'square', gain: 0.12 }); break;
    case 'switch': tone(600, 0.04, { type: 'square', gain: 0.08 }); break;
    case 'step': if (!e.quiet) noise(0.05, { type: 'lowpass', freq: 420, gain: 0.12 }); break;
    case 'jump': noise(0.06, { type: 'lowpass', freq: 300, gain: 0.1 }); break;
    case 'land': {
      const { gain, pan } = mixAt(e.x ?? 0, e.z ?? 0);
      tone(90, 0.1, { sweepTo: 45, gain: 0.3 * gain, pan });
      break;
    }
    case 'throw': noise(0.18, { freq: 900, sweepTo: 2200, gain: 0.2 }); break;
    case 'bounce': {
      const { gain, pan } = mixAt(e.x, e.z);
      tone(320, 0.05, { gain: 0.2 * gain, pan });
      break;
    }
    case 'explosion': {
      const { gain, pan } = mixAt(e.x, e.z);
      const big = e.big ? 1.4 : 1;
      noise(0.8 * big, { type: 'lowpass', freq: 700, sweepTo: 60, gain: 0.9 * gain, pan });
      tone(100, 0.7 * big, { sweepTo: 28, gain: 0.7 * gain, pan });
      break;
    }
    case 'smoke': {
      const { gain, pan } = mixAt(e.x, e.z);
      noise(0.4, { freq: 800, gain: 0.25 * gain, pan });
      break;
    }
    case 'flashpop': {
      const { gain, pan } = mixAt(e.x, e.z);
      noise(0.15, { freq: 3000, gain: 0.5 * gain, pan });
      tone(3200, 1.1, { gain: 0.08 * gain, pan });
      break;
    }
    case 'hitmark': tone(e.head ? 1800 : 1400, 0.035, { gain: 0.22 }); break;
    case 'hurt': tone(110, 0.12, { sweepTo: 60, gain: 0.35 }); break;
    case 'kill':
      if (e.a === 0) { tone(660, 0.07, { gain: 0.2 }); tone(880, 0.09, { gain: 0.2, when: 0.07 }); }
      break;
    case 'buy': tone(880, 0.06, { gain: 0.18 }); tone(1320, 0.08, { gain: 0.18, when: 0.06 }); break;
    case 'buydenied': tone(110, 0.16, { type: 'square', gain: 0.14 }); break;
    case 'bombpickup': tone(520, 0.08, { gain: 0.2 }); break;
    case 'bombdrop': tone(300, 0.1, { gain: 0.2 }); break;
    case 'planted':
      tone(700, 0.1, { type: 'square', gain: 0.2 });
      tone(700, 0.1, { type: 'square', gain: 0.2, when: 0.18 });
      tone(700, 0.1, { type: 'square', gain: 0.2, when: 0.36 });
      break;
    case 'roundstart': tone(520, 0.12, { gain: 0.15 }); break;
    case 'golive': tone(780, 0.1, { gain: 0.18 }); break;
    case 'roundend': {
      const won = e.winner === 'attack';
      const seq = won ? [523, 659, 784] : [392, 330, 262];
      seq.forEach((fq, i) => tone(fq, 0.16, { gain: 0.2, when: i * 0.12 }));
      break;
    }
    case 'matchend': {
      const won = e.winner === 'attack';
      const seq = won ? [523, 659, 784, 1047] : [392, 370, 349, 330];
      seq.forEach((fq, i) => tone(fq, 0.22, { gain: 0.22, when: i * 0.16 }));
      break;
    }
    default: break;
  }
}

// The planted bomb beeps faster as detonation approaches.
export function syncAudio() {
  if (!ctx || S.phase !== 'planted') return;
  const remain = S.bomb.timer;
  const interval = 0.25 + (remain / 35) * 0.75;
  if (S.time - lastBeep > interval) {
    lastBeep = S.time;
    const { gain, pan } = mixAt(S.bomb.x, S.bomb.z);
    tone(1200, 0.06, { type: 'square', gain: 0.25 * gain, pan });
  }
}
