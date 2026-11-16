// Tuning, palette and weapon definitions for Tidebreak Terminal.
// One place for every number the sim reads; nothing here imports three.js,
// so the dossier text stays readable and the numbers are easy to audit.

export const SIM_DT = 1 / 60; // fixed simulation step, seconds
export const ROUND_TIME = 100; // seconds of live play per round
export const FREEZE_TIME = 5; // buy phase at the start of each round
export const BOMB_TIME = 35; // seconds from plant to detonation
export const PLANT_TIME = 3; // seconds of channel to plant
export const DEFUSE_TIME = 5; // seconds of channel to defuse
export const ROUNDS_TO_WIN = 8;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 1400;
export const LOSS_REWARD = 1400;
export const PLANT_REWARD = 300;
export const MAX_MONEY = 9000;

export const EYE_STAND = 1.62; // camera height standing, metres
export const EYE_CROUCH = 1.08; // camera height crouched
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.75;
export const WALK_SPEED = 4.3;
export const CROUCH_SPEED = 2.2;
export const QUIET_SPEED = 2.2; // shift-walk: slow and silent
export const JUMP_SPEED = 4.6;
export const GRAVITY = 12.5;
export const HEADSHOT_MULT = 3; // head hits deal triple damage
export const ARMOUR_ABSORB = 0.5; // armour halves incoming damage

// Palette: a wet night port under sodium lamps.
export const PALETTE = {
  sky: 0x070b14,
  fog: 0x0a1322,
  ground: 0x2c3138,
  concrete: 0x3a4149,
  steel: 0x5a6673,
  rust: 0x7a4a28,
  containerRed: 0x9e3a2c,
  containerTeal: 0x2e6b6a,
  containerOchre: 0xb0822a,
  containerBlue: 0x2e4a6b,
  lamp: 0xffb340, // sodium amber
  lampCool: 0x9fd8ff,
  hazard: 0xd8a020,
  attack: 0xffb340, // Breakers
  defend: 0x4fc3e8, // Harbor Watch
  rain: 0x8fa8c8,
};

// Weapons. damage is the base body-shot damage at close range; spread is in
// radians of cone half-angle; recoil is pitch kick in radians per shot.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 SIDEARM', price: 0, damage: 26, headMult: HEADSHOT_MULT,
    rpm: 352, mag: 12, reserve: 48, auto: false, reload: 1.5,
    spread: 0.006, moveSpread: 0.028, recoil: 0.011, range: 60, falloff: 0.55,
    pellets: 1, kick: 0.6, sound: 'pistol',
  },
  k7: {
    id: 'k7', name: 'K7 SMG', price: 1500, damage: 24, headMult: HEADSHOT_MULT,
    rpm: 750, mag: 30, reserve: 90, auto: true, reload: 2.1,
    spread: 0.011, moveSpread: 0.034, recoil: 0.008, range: 45, falloff: 0.5,
    pellets: 1, kick: 0.45, sound: 'smg',
  },
  r4: {
    id: 'r4', name: 'R4 RIFLE', price: 2700, damage: 33, headMult: HEADSHOT_MULT,
    rpm: 600, mag: 30, reserve: 90, auto: true, reload: 2.4,
    spread: 0.004, moveSpread: 0.03, recoil: 0.013, range: 80, falloff: 0.62,
    pellets: 1, kick: 0.8, sound: 'rifle',
  },
  l96: {
    id: 'l96', name: 'L96 MARKSMAN', price: 4500, damage: 95, headMult: HEADSHOT_MULT,
    rpm: 45, mag: 5, reserve: 15, auto: false, reload: 3.2,
    spread: 0.0005, moveSpread: 0.06, recoil: 0.05, range: 120, falloff: 0.85,
    pellets: 1, kick: 1.6, sound: 'marksman', scoped: true,
  },
};

export const BUY_ITEMS = [
  { key: '1', kind: 'weapon', id: 'k7', label: 'K7 SMG — fast, close quarters' },
  { key: '2', kind: 'weapon', id: 'r4', label: 'R4 Rifle — the all-rounder' },
  { key: '3', kind: 'weapon', id: 'l96', label: 'L96 Marksman — one shot, long lanes' },
  { key: '4', kind: 'armour', id: 'armour', label: 'Armour — halves damage taken', price: 650 },
  { key: '5', kind: 'grenade', id: 'frag', label: 'Frag grenade — radius damage', price: 300 },
  { key: '6', kind: 'grenade', id: 'smoke', label: 'Smoke grenade — blocks sight', price: 300 },
  { key: '7', kind: 'grenade', id: 'flash', label: 'Flash grenade — blinds', price: 200 },
];

export const GRENADES = {
  frag: { id: 'frag', name: 'FRAG', fuse: 2.2, radius: 7, damage: 110, price: 300 },
  smoke: { id: 'smoke', name: 'SMOKE', fuse: 1.4, radius: 4.5, duration: 16, price: 300 },
  flash: { id: 'flash', name: 'FLASH', fuse: 1.6, radius: 22, duration: 2.6, price: 200 },
};

// Map footprint in metres. The playable yard runs x in [-32, 32], z in [-24, 24].
export const MAP = {
  minX: -32, maxX: 32, minZ: -24, maxZ: 24,
  wallHeight: 5,
  sites: {
    A: { name: 'CRANE YARD', minX: -30, maxX: -16, minZ: 0, maxZ: 16, cx: -23, cz: 8 },
    B: { name: 'WAREHOUSE', minX: 16, maxX: 30, minZ: 0, maxZ: 16, cx: 23, cz: 8 },
  },
  spawns: {
    attack: [
      [-8, -20], [-4, -21], [0, -20], [4, -21], [8, -20],
    ],
    defend: [
      [-8, 20], [-4, 21], [0, 20], [4, 21], [8, 20],
    ],
  },
};

export const BOT_NAMES = {
  attack: ['Rook', 'Mira', 'Doss', 'Kite', 'Vex'],
  defend: ['Hale', 'Ondo', 'Bram', 'Sable', 'Noor'],
};
