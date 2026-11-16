// Tidebreak Terminal — boot, fixed-step loop, and wiring.
// The simulation advances in fixed SIM_DT steps kept apart from rendering:
// the accumulator below steps the sim zero or more times per animation frame
// and rendering always draws the latest sim state.
import { SIM_DT, MAP, BOT_NAMES } from './config.js';
import { S, makeFighter, resetMatchState } from './state.js';
import { initRender, buildFighterMeshes, renderFrame, getMap } from './render.js';
import { attachInput } from './input.js';
import { stepPlayer } from './player.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
if (shotName) S.shotMode = shotName;

const container = document.getElementById('view');
const { renderer, map } = initRender(container);
const hudEl = document.getElementById('hud');
const startScreen = document.getElementById('start-screen');
const deployBtn = document.getElementById('deploy-btn');

// --- Match setup (P0: fighters at spawns; rounds.js owns this in P1). ---
resetMatchState();
for (let i = 0; i < 5; i++) {
  const [ax, az] = MAP.spawns.attack[i];
  const [dx, dz] = MAP.spawns.defend[i];
  if (i === 0) S.fighters.push(makeFighter(0, 'attack', 'You', false, ax, az));
  else S.fighters.push(makeFighter(i, 'attack', BOT_NAMES.attack[i], true, ax, az));
  S.fighters.push(makeFighter(5 + i, 'defend', BOT_NAMES.defend[i], true, dx, dz));
}
// Face the map: attackers look south, defenders look north.
for (const f of S.fighters) f.yaw = f.team === 'attack' ? Math.PI : 0;
S.fighters[0].yaw = Math.PI;
buildFighterMeshes();

const inputCtl = attachInput(renderer.domElement, {
  onLockLost() {
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
  inputCtl.lock();
});

// Screenshot mode: skip the start screen, auto-start, and flag readiness
// once a few frames have rendered (the harness waits for this flag).
let shotFrames = 0;
if (S.shotMode) {
  S.started = true;
  startScreen.style.display = 'none';
  hudEl.classList.add('on');
}

// --- Fixed-step loop. ---
let last = performance.now();
let acc = 0;
const MAX_STEPS = 5;

function step(dt) {
  S.time += dt;
  S.frame++;
  stepPlayer(map, dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  inputCtl.poll?.();
  if (S.started && !S.over && !S.paused) {
    acc += elapsed;
    let n = 0;
    while (acc >= SIM_DT && n < MAX_STEPS) {
      step(SIM_DT);
      acc -= SIM_DT;
      n++;
    }
    if (n === MAX_STEPS) acc = 0; // drop backlog rather than spiral
  }
  renderFrame(S.time);
  if (S.shotMode && ++shotFrames === 4) window.__shotReady = true;
}

requestAnimationFrame(frame);
