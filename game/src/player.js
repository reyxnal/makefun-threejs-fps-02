// The human player's first-person controller: acceleration-based movement,
// crouching, jumping, capsule-vs-map collision, view bob and recoil recovery.
// Runs inside the fixed-step sim; rendering reads the fighter + view state.
import {
  EYE_STAND, EYE_CROUCH, PLAYER_RADIUS, PLAYER_HEIGHT, WALK_SPEED,
  CROUCH_SPEED, QUIET_SPEED, JUMP_SPEED, GRAVITY, SIM_DT,
} from './config.js';
import { S } from './state.js';

const LOOK_SENS = 0.0022;
const PITCH_MAX = 1.45;

export function stepPlayer(map, dt) {
  const f = S.fighters[0];
  if (!f || !f.alive) return;
  const input = S.input;
  const view = S.view;

  // --- Look: mouse deltas turn yaw/pitch; consumed once per step. ---
  f.yaw -= input.lookDX * LOOK_SENS;
  f.pitch -= input.lookDY * LOOK_SENS;
  if (f.pitch > PITCH_MAX) f.pitch = PITCH_MAX;
  if (f.pitch < -PITCH_MAX) f.pitch = -PITCH_MAX;
  input.lookDX = 0; input.lookDY = 0;

  // --- Wish direction in world space. ---
  const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
  let wx = 0, wz = 0;
  if (input.fwd !== 0 || input.strafe !== 0) {
    // Forward is -Z rotated by yaw (three.js camera convention).
    wx = -sin * input.fwd + cos * input.strafe;
    wz = -cos * input.fwd - sin * input.strafe;
    const len = Math.hypot(wx, wz);
    wx /= len; wz /= len;
  }
  const crouch = input.crouch;
  f.crouch = crouch;
  let speed = crouch ? CROUCH_SPEED : (input.quiet ? QUIET_SPEED : WALK_SPEED);
  if (input.ads) speed *= 0.6;

  // --- Acceleration + friction as one exponential approach. ---
  // Ground control is snappy; air control is weak, so jumps commit you.
  const rate = f.airborne ? 2.2 : 10;
  const k = Math.min(1, rate * dt);
  f.vx = (f.vx ?? 0) + (wx * speed - (f.vx ?? 0)) * k;
  f.vz = (f.vz ?? 0) + (wz * speed - (f.vz ?? 0)) * k;

  // --- Integrate + collide (circle vs map AABBs). ---
  const pos = { x: f.x + f.vx * dt, z: f.z + f.vz * dt };
  const feetY = f.y;
  map.resolveCircle(pos, feetY, PLAYER_RADIUS, PLAYER_HEIGHT);
  f.x = pos.x; f.z = pos.z;

  // --- Vertical: gravity, jump, land on the walkable surface. ---
  const ground = map.groundHeightAt(f.x, f.z, f.y);
  if (input.jump && !f.airborne) {
    f.vy = JUMP_SPEED; f.airborne = true;
    S.events.push({ kind: 'jump' });
  }
  input.jump = false;
  f.vy -= GRAVITY * dt;
  f.y += f.vy * dt;
  const groundNow = map.groundHeightAt(f.x, f.z, f.y);
  if (f.y <= groundNow) {
    if (f.airborne && f.vy < -3) {
      S.noises.push({ x: f.x, z: f.z, radius: 10, kind: 'land' });
      S.events.push({ kind: 'land' });
    }
    f.y = groundNow; f.vy = 0; f.airborne = false;
  }

  // --- Movement fraction drives spread, sound and view bob. ---
  const hSpeed = Math.hypot(f.vx, f.vz);
  f.moving = Math.min(1, hSpeed / WALK_SPEED);
  view.bobPhase += hSpeed * dt * 2.1;
  const targetBob = f.airborne ? 0 : f.moving * (crouch ? 0.4 : 1);
  view.bobAmp += (targetBob - view.bobAmp) * Math.min(1, 8 * dt);

  // Eye height eases between stand and crouch.
  const targetEye = crouch ? EYE_CROUCH : EYE_STAND;
  view.eyeH = (view.eyeH ?? EYE_STAND) + (targetEye - (view.eyeH ?? EYE_STAND)) * Math.min(1, 12 * dt);

  // --- Footsteps: audible unless walking quietly or crouched. ---
  f.stepAcc = (f.stepAcc ?? 0) + hSpeed * dt;
  const stride = crouch || input.quiet ? 3.4 : 2.3;
  if (f.stepAcc > stride && hSpeed > 0.5 && !f.airborne) {
    f.stepAcc = 0;
    S.events.push({ kind: 'step', quiet: crouch || input.quiet });
    if (!crouch && !input.quiet) S.noises.push({ x: f.x, z: f.z, radius: 7, kind: 'step' });
  }

  // --- Recoil + bloom recover; stopping to aim pays. ---
  const recover = Math.min(1, 3.2 * dt);
  view.recoilPitch *= (1 - recover);
  view.recoilYaw *= (1 - recover);
  f.bloom = Math.max(0, f.bloom - dt * 1.9);
  f.fireCooldown = Math.max(0, f.fireCooldown - dt);
  if (f.reloading > 0) {
    f.reloading -= dt;
    if (f.reloading <= 0) {
      const w = currentWeaponId(f);
      const need = weaponMagSize(w) - f.mag[w];
      const take = Math.min(need, f.reserve[w]);
      f.mag[w] += take; f.reserve[w] -= take;
      f.reloading = 0;
      S.events.push({ kind: 'reloaded' });
    }
  }
}

// Helpers shared with weapons.js (kept here to avoid a circular import).
import { WEAPONS } from './config.js';
export function currentWeaponId(f) {
  return f.slot === 'primary' && f.weapons.primary ? f.weapons.primary : f.weapons.sidearm;
}
export function weaponMagSize(id) { return WEAPONS[id].mag; }
export function weaponOf(f) { return WEAPONS[currentWeaponId(f)]; }
