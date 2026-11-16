// The single shared state object. Every module reads and writes this one
// object (imported as S); nothing keeps a private copy of sim truth.
// Rendering-only caches live on the objects that own them, never here.
import { EYE_STAND, EYE_CROUCH } from './config.js';

// Mulberry32: small, fast, seedable. The match seeds it once; screenshot
// mode seeds it with a fixed value so staged shots are reproducible.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const S = {
  // Run control
  started: false, // player clicked deploy (or shot mode auto-started)
  over: false, // match decided
  paused: false,
  shotMode: null, // string name when ?shot= is present, else null
  rng: makeRng((Date.now() ^ 0x9e3779b9) >>> 0),
  time: 0, // total sim seconds since match start
  frame: 0,

  // Match / round
  phase: 'lobby', // lobby | freeze | live | planted | end
  phaseT: 0, // seconds left in the current phase
  round: 1,
  score: { attack: 0, defend: 0 },
  roundWinner: null,
  roundReason: '',
  bomb: {
    state: 'carried', // carried | planted | exploded | defused | dropped
    site: null, // 'A' | 'B'
    x: 0, z: 0,
    timer: 0,
    carrier: null, // fighter index carrying it
    planter: null, // fighter index channeling a plant
    defuser: null, // fighter index channeling a defuse
    progress: 0, // 0..1 channel progress
  },

  // Fighters: index 0 is always the human player (attack team).
  fighters: [],
  // Sounds the sim raised this step (bots hear them): {x, z, radius, kind}
  noises: [],
  // Grenades in flight / active: {kind, x, y, z, vx, vy, vz, fuse, owner, ...}
  grenades: [],
  smokes: [], // active smoke clouds {x, y, z, radius, until}
  flashes: [], // recent flash pops {x, y, z, until, owner}

  // Player-facing transient feedback (consumed by HUD/effects)
  events: [], // {kind, ...} drained once per rendered frame
  kills: [], // killfeed entries {a, b, weapon, headshot, t}
  // Radio chatter from teammate bots: {who, text, x, z, t}
  callouts: [],
  // Minimap pings where a teammate heard something: {x, z, t}
  pings: [],

  // Input snapshot, written by input.js, read by the sim.
  input: {
    fwd: 0, strafe: 0, crouch: false, quiet: false, jump: false,
    fire: false, fireEdge: false, ads: false,
    lookDX: 0, lookDY: 0, // accumulated mouse deltas, consumed per step
    reload: false, use: false, useEdge: false,
    digit: 0, // number key pressed (0 = none); buy menu or weapon slots
    nadeCycle: false, nadeThrow: false, buyToggle: false,
  },
  keys: {}, // raw key state by code, for menus

  // View / camera state owned by the sim (rendering reads it).
  view: {
    yaw: 0, pitch: 0,
    recoilPitch: 0, recoilYaw: 0, // unrecovered kick, decays in sim
    bobPhase: 0, bobAmp: 0, eyeH: EYE_STAND,
    fov: 75,
    flashBlind: 0, // 0..1 white-out strength
    damageFlash: 0, // 0..1 red vignette strength
    spectate: -1, // fighter index the camera follows when dead
  },
};

// A fighter: human or bot. Bodies are capsules (feet position + height);
// the head is a sphere at feet + HEAD_Y for headshot tests.
export function makeFighter(index, team, name, isBot, x, z) {
  return {
    index, team, name, isBot,
    alive: true,
    x, z, y: 0, vx: 0, vy: 0, vz: 0, // feet position; y is height above ground
    yaw: team === 'attack' ? Math.PI : 0, // face the enemy spawn
    pitch: 0,
    hp: 100, armour: 0,
    money: 800,
    weapons: { primary: null, sidearm: 'p9' },
    slot: 'sidearm', // 'primary' | 'sidearm'
    mag: { p9: 12, k7: 0, r4: 0, l96: 0 },
    reserve: { p9: 48, k7: 0, r4: 0, l96: 0 },
    reloading: 0, // seconds left, 0 = not reloading
    fireCooldown: 0, switchT: 0, throwCd: 0,
    bloom: 0, // accumulated spread from firing
    flash: 0, // seconds of flash blindness remaining
    grenades: { frag: 0, smoke: 0, flash: 0 },
    nadeSel: 'frag',
    crouch: false,
    moving: 0, // 0..1 speed fraction, for spread + sound
    airborne: false,
    stepAcc: 0,
    // Bot brain (unused for the human)
    brain: isBot ? {
      state: 'route', // route | hold | engage | investigate | plant | defuse | rotate
      path: [], pathI: 0,
      holdUntil: 0,
      target: -1, // fighter index currently engaged
      reactAt: 0, // sim time when the bot may open fire
      lastSeenX: 0, lastSeenZ: 0, lastSeenT: -99,
      hearX: 0, hearZ: 0, hearT: -99,
      strafeDir: 1, strafeAt: 0,
      aimErr: 0.02,
      route: null, // 'A' | 'B' | 'mid'
      holdNode: -1,
      skill: 0.55 + (index % 5) * 0.07,
      burstLeft: 0, burstPause: 0, thinkAcc: 0,
      stuckT: 0, stuckX: 0, stuckZ: 0,
      nudgeUntil: 0, nudgeX: 0, nudgeZ: 0,
      scanDir: 1,
      lastCallT: -99, // sim time of this bot's last radio callout
      plantCalled: false, // plant callout already sent this round
    } : null,
    // Rendering handles, attached by the renderer (never sim truth).
    mesh: null, headMesh: null, gunMesh: null,
    walkPhase: 0,
  };
}

export function resetMatchState() {
  S.time = 0; S.frame = 0;
  S.phase = 'lobby'; S.phaseT = 0; S.round = 1;
  S.score.attack = 0; S.score.defend = 0;
  S.roundWinner = null; S.roundReason = '';
  S.bomb.state = 'carried'; S.bomb.site = null; S.bomb.timer = 0;
  S.bomb.carrier = null; S.bomb.planter = null; S.bomb.defuser = null; S.bomb.progress = 0;
  S.fighters.length = 0; S.noises.length = 0; S.grenades.length = 0;
  S.smokes.length = 0; S.flashes.length = 0; S.events.length = 0; S.kills.length = 0;
  S.callouts.length = 0; S.pings.length = 0;
  S.over = false; S.paused = false;
  S.view.recoilPitch = 0; S.view.recoilYaw = 0; S.view.flashBlind = 0;
  S.view.damageFlash = 0; S.view.spectate = -1;
  S.view.eyeH = EYE_STAND; S.view.bobPhase = 0; S.view.bobAmp = 0;
}

// Eye position of a fighter (stand/crouch height from config).
export function eyePos(f) {
  const h = f.crouch ? EYE_CROUCH : EYE_STAND;
  return { x: f.x, y: f.y + h, z: f.z };
}

// Unit forward vector from yaw/pitch (three.js camera convention:
// yaw 0 looks down -Z, positive pitch looks up).
export function forwardVec(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
