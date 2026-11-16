// Deterministic screenshot setups for the ?shot= hook. Each setup arranges
// REAL game state — fighter positions, phase, bomb, loadout — and then the
// ordinary sim + render loop produces the image. Nothing is composited,
// nothing is drawn by hand; the 'fight' shot even waits for a real tracer
// (effects.js raises __shotReady on the first live shot).
import { S, makeRng } from './state.js';
import { MAP } from './config.js';
import { openBuy } from './hud.js';

function giveRifle(f) {
  f.weapons.primary = 'r4';
  f.mag.r4 = 30; f.reserve.r4 = 90;
  f.slot = 'primary';
}

function placeBot(f, x, z, yaw) {
  f.x = x; f.z = z; f.y = 0; f.yaw = yaw; f.pitch = 0;
  f.brain.state = 'hold';
  f.brain.holdUntil = 999;
  f.brain.path = []; f.brain.pathI = 0;
  f.brain.target = -1;
}

function yawToward(fx, fz, tx, tz) {
  return Math.atan2(-(tx - fx), -(tz - fz));
}

export function applyShotSetup() {
  // Fixed seed so staged shots are reproducible run to run.
  S.rng = makeRng(1337);
  const mode = S.shotMode;
  const me = S.fighters[0];
  if (!me) return;

  // The ROUND banner suits the spawn/buy views; the action shots read
  // better without it. Drop the pending roundstart event for those.
  if (mode === 'fight' || mode === 'site' || mode === 'end') {
    S.events = S.events.filter((e) => e.kind !== 'roundstart');
  }

  if (mode === 'buy') {
    me.money = 3200;
    openBuy();
  } else if (mode === 'fight') {
    S.phase = 'live';
    S.phaseT = 80;
    giveRifle(me);
    me.x = 0; me.z = -3; me.yaw = yawToward(0, -3, 2, 10); me.pitch = 0;
    // The player fires live down the lane (input.fire is only ever cleared
    // by a mouseup, and no mouse exists in shot mode): the frame captures
    // a real tracer, a real muzzle flash, a real hitmarker — and, once a
    // defender drops, a real killfeed line.
    S.input.fire = true;
    // Two defenders up the lane, already engaging: their first real shots
    // are what the harness waits for. They hold far up the lane with wild
    // aim and the player wears armour, so the firefight is captured live
    // instead of the player dropping before the shutter. The first
    // defender is staged wounded, so the opening headshot drops him and
    // the killfeed tells the story.
    const d1 = S.fighters[5], d2 = S.fighters[6];
    placeBot(d1, 2, 10, 0);
    placeBot(d2, -2.5, 12, 0);
    d1.hp = 40;
    me.armour = 100;
    for (const d of [d1, d2]) {
      d.brain.state = 'engage';
      d.brain.target = 0;
      d.brain.reactAt = 0;
      d.brain.aimErr = 0.35;
      d.brain.lastSeenX = me.x; d.brain.lastSeenZ = me.z; d.brain.lastSeenT = 0;
    }
    // A teammate holds the lane beside the player.
    placeBot(S.fighters[1], -3.5, -5, Math.PI - 0.3);
  } else if (mode === 'site') {
    S.phase = 'planted';
    S.phaseT = 20;
    S.bomb.state = 'planted';
    S.bomb.site = 'A';
    S.bomb.x = -21; S.bomb.z = 5;
    S.bomb.timer = 20;
    S.bomb.carrier = null;
    giveRifle(me);
    // Shot from the A-lane entrance, far enough back that the defender on
    // the crane deck clears the deck edge in frame, with the giant site
    // sign behind him and the planted charge in the foreground.
    me.x = -15; me.z = -6;
    me.yaw = yawToward(me.x, me.z, -24, 9);
    me.pitch = 0.05;
    // A defender holds the crane deck above the planted charge, at the
    // deck's east end — clear of the site sign, which hangs on the mast.
    const d = S.fighters[5];
    placeBot(d, -19.5, 10, yawToward(-19.5, 10, me.x, me.z));
    d.y = 4; // standing on the deck
    // A teammate close by on the left, nameplate legible.
    placeBot(S.fighters[1], -18, -2, yawToward(-18, -2, -23, 8));
  } else if (mode === 'end') {
    S.round = 8;
    S.score.attack = 4; S.score.defend = 3;
    S.phase = 'end';
    S.phaseT = 30; // hold the banner while the shot is taken
    S.roundWinner = 'attack';
    S.roundReason = 'BOMB DETONATED';
    S.events.push({ kind: 'roundend', winner: 'attack', reason: 'BOMB DETONATED' });
    giveRifle(me);
    me.x = -20; me.z = 2;
    me.yaw = yawToward(me.x, me.z, -23, 8);
    placeBot(S.fighters[1], -17, 4, yawToward(-17, 4, -23, 8));
  }
  // 'cover' and anything else: the default spawn view, untouched.
}
