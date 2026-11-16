// Tidebreak Terminal — boot, fixed-step loop, and wiring.
// The simulation advances in fixed SIM_DT steps kept apart from rendering:
// the accumulator below steps the sim zero or more times per animation frame
// and rendering always draws the latest sim state. Each rendered frame
// drains the sim's event stream once, fanning it out to HUD, audio and
// effects, so a sound or a tracer can never fire twice for one event.
import { SIM_DT, WEAPONS } from './config.js';
import { S } from './state.js';
import { initRender, buildFighterMeshes, renderFrame, getCamera, getScene } from './render.js';
import { attachInput } from './input.js';
import { stepPlayer, weaponOf } from './player.js';
import { stepBots } from './bots.js';
import { stepGrenades, throwGrenade } from './grenades.js';
import { stepFighterTimers, tryFire, startReload, switchSlot } from './weapons.js';
import { startMatch, stepRound, buyItem } from './rounds.js';
import { initHud, syncHud, onHudEvent, toggleBuy, isBuyOpen, closeBuy } from './hud.js';
import { initAudio, resumeAudio, onAudioEvent, syncAudio } from './audio.js';
import { initEffects, onEffectEvent, updateEffects } from './effects.js';
import { initViewmodel, onViewmodelEvent, updateViewmodel } from './viewmodel.js';
import { applyShotSetup } from './shots.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
if (shotName) S.shotMode = shotName;

const container = document.getElementById('view');
const { renderer, map } = initRender(container);
const hudEl = document.getElementById('hud');
const startScreen = document.getElementById('start-screen');
const deployBtn = document.getElementById('deploy-btn');

// --- Boot order: match state first, then every presentation module. ---
startMatch();
buildFighterMeshes();
initEffects(getScene(), getCamera());
initHud(map, () => inputCtl.lock());
initAudio();
initViewmodel(getCamera());

const inputCtl = attachInput(renderer.domElement, {
  onLockLost() {
    // The buy menu exits the lock on purpose; only a real loss resumes.
    if (isBuyOpen() || S.over || !S.started) return;
    startScreen.style.display = 'flex';
    deployBtn.textContent = 'CLICK TO RESUME';
  },
  onLock() {
    startScreen.style.display = 'none';
    hudEl.classList.add('on');
  },
});

deployBtn.addEventListener('click', () => {
  S.started = true;
  hudEl.classList.add('on');
  resumeAudio();
  inputCtl.lock();
});

// Screenshot mode: skip the start screen, auto-start, arrange the shot,
// and flag readiness once a few frames have rendered (the harness waits
// for this flag; the 'fight' shot raises it on the first live tracer).
let shotFrames = 0;
if (S.shotMode) {
  S.started = true;
  startScreen.style.display = 'none';
  hudEl.classList.add('on');
  applyShotSetup();
}

// --- Player combat actions, resolved once per sim step. ---
let prevFire = false;
let noiseClearT = 0;
const NADE_ORDER = ['frag', 'smoke', 'flash'];

function playerActions(dt) {
  const f = S.fighters[0];
  const input = S.input;
  if (!f || !f.alive) {
    input.reload = false; input.digit = 0;
    input.nadeCycle = false; input.nadeThrow = false; input.buyToggle = false;
    prevFire = input.fire;
    return;
  }
  if (input.buyToggle) {
    input.buyToggle = false;
    toggleBuy();
  }
  if (isBuyOpen()) {
    // Digits buy while the menu is open; nothing else fires.
    if (input.digit > 0) {
      buyItem(f, String(input.digit));
      input.digit = 0;
    }
    prevFire = input.fire;
    return;
  }
  if (input.digit > 0) {
    if (input.digit === 1) switchSlot(f, 'primary');
    else if (input.digit === 2) switchSlot(f, 'sidearm');
    input.digit = 0;
  }
  if (input.reload) {
    input.reload = false;
    startReload(f);
  }
  if (input.nadeCycle) {
    input.nadeCycle = false;
    const i = NADE_ORDER.indexOf(f.nadeSel);
    f.nadeSel = NADE_ORDER[(i + 1) % NADE_ORDER.length];
  }
  if (input.nadeThrow) {
    input.nadeThrow = false;
    throwGrenade(f, f.nadeSel);
  }
  // Fire: automatics spray while held; semi-autos need a fresh press.
  const w = weaponOf(f);
  const wantFire = w.auto ? input.fire : (input.fire && !prevFire);
  if (wantFire && (S.phase === 'live' || S.phase === 'planted')) {
    tryFire(map, f);
  }
  prevFire = input.fire;
}

function step(dt) {
  S.time += dt;
  S.frame++;
  const input = S.input;
  const frozen = S.phase === 'freeze' || S.phase === 'lobby' || S.phase === 'end' || S.phase === 'over';

  if (frozen) {
    // Freeze: look around, buy, but nobody moves or shoots.
    const keepFwd = input.fwd, keepStrafe = input.strafe, keepJump = input.jump;
    input.fwd = 0; input.strafe = 0; input.jump = false;
    stepPlayer(map, dt);
    input.fwd = keepFwd; input.strafe = keepStrafe; input.jump = keepJump;
  } else {
    stepPlayer(map, dt);
    stepBots(map, dt);
    stepGrenades(map, dt);
  }
  playerActions(dt);
  for (const f of S.fighters) stepFighterTimers(f, dt);
  stepRound(map, dt);

  // Noises linger half a second so the 10 Hz bot think always sees them.
  noiseClearT += dt;
  if (noiseClearT > 0.5) {
    noiseClearT = 0;
    S.noises.length = 0;
  }

  // View overlays decay in sim time.
  S.view.damageFlash = Math.max(0, S.view.damageFlash - dt * 1.6);
  S.view.flashBlind = Math.max(0, S.view.flashBlind - dt * 0.7);
}

// --- Fixed-step loop. ---
let last = performance.now();
let acc = 0;
const MAX_STEPS = 5;

function drainEvents() {
  for (const e of S.events) {
    onHudEvent(e);
    onAudioEvent(e);
    onEffectEvent(e);
    onViewmodelEvent(e);
  }
  S.events.length = 0;
}

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  inputCtl.poll();
  // Staged shots (except 'fight') render a frozen arrangement: the sim
  // does not advance, so nobody can die or wander before the capture.
  // 'fight' needs a live sim so a real tracer can fly.
  const liveShot = S.shotMode === 'fight';
  const stepping = S.started && !S.over && !S.paused && (!S.shotMode || liveShot);
  if (stepping) {
    acc += elapsed;
    let n = 0;
    while (acc >= SIM_DT && n < MAX_STEPS) {
      step(SIM_DT);
      acc -= SIM_DT;
      n++;
    }
    if (n === MAX_STEPS) acc = 0; // drop backlog rather than spiral
  }
  drainEvents();
  syncHud(elapsed);
  syncAudio();
  updateEffects(elapsed, S.time);
  updateViewmodel(elapsed);
  renderFrame(S.time);
  if (S.shotMode && S.shotMode !== 'fight' && ++shotFrames === 4) {
    window.__shotReady = true;
  }
  // Fallback for the fight shot: never hang the harness if no tracer flies.
  if (S.shotMode === 'fight' && S.time > 4 && !window.__shotReady) {
    window.__shotReady = true;
  }
}

requestAnimationFrame(frame);
