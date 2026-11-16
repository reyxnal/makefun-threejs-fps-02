// Hitscan combat: firing, spread, damage falloff, headshots, armour, kills.
// Every shot is a ray from the shooter's eye against the map's colliders and
// the enemy fighters' capsules. Damage numbers are the only place the
// economy is fed (kill rewards); the round logic lives in rounds.js.
import {
  WEAPONS, HEADSHOT_MULT, ARMOUR_ABSORB, KILL_REWARD, MAX_MONEY,
  PLAYER_HEIGHT,
} from './config.js';
import { S, eyePos, forwardVec } from './state.js';
import { currentWeaponId, weaponOf } from './player.js';

// --- Weapon timers shared by the player and the bots. ---
// Called once per sim step for every fighter. Reload completion lands here
// so the player and the bots share exactly one code path.
export function stepFighterTimers(f, dt) {
  f.fireCooldown = Math.max(0, f.fireCooldown - dt);
  f.switchT = Math.max(0, f.switchT - dt);
  f.throwCd = Math.max(0, f.throwCd - dt);
  f.flash = Math.max(0, f.flash - dt);
  f.bloom = Math.max(0, f.bloom - dt * 1.9);
  if (f.reloading > 0) {
    f.reloading -= dt;
    if (f.reloading <= 0) {
      const id = currentWeaponId(f);
      const need = WEAPONS[id].mag - f.mag[id];
      const take = Math.min(need, f.reserve[id]);
      f.mag[id] += take;
      f.reserve[id] -= take;
      f.reloading = 0;
      if (f.index === 0) S.events.push({ kind: 'reloaded' });
    }
  }
}

export function startReload(f) {
  if (!f.alive || f.reloading > 0) return;
  const id = currentWeaponId(f);
  if (f.mag[id] >= WEAPONS[id].mag || f.reserve[id] <= 0) return;
  f.reloading = WEAPONS[id].reload;
  if (f.index === 0) S.events.push({ kind: 'reload' });
}

export function switchSlot(f, slot) {
  if (!f.alive || f.slot === slot || f.switchT > 0) return;
  if (slot === 'primary' && !f.weapons.primary) return;
  f.slot = slot;
  f.switchT = 0.25;
  f.reloading = 0;
  if (f.index === 0) S.events.push({ kind: 'switch' });
}

// Ray vs a vertical capsule (the fighter's body). Returns {t, head} or null.
// The capsule is the segment feet+0.1 .. feet+1.7 at radius 0.38; the head
// zone is the top 0.3 m. The XZ closest-approach approximation is exact
// for level shots and within a centimetre for pitched ones at play ranges.
function rayCapsule(ox, oy, oz, dx, dy, dz, g, maxT) {
  const ddx = dx, ddz = dz;
  const denom = ddx * ddx + ddz * ddz;
  let t;
  if (denom < 1e-8) {
    // Near-vertical ray: only hits if the shooter is right above the target.
    const ddx2 = g.x - ox, ddz2 = g.z - oz;
    if (ddx2 * ddx2 + ddz2 * ddz2 > 0.38 * 0.38) return null;
    t = (g.y + 1.7 - oy) / dy;
  } else {
    t = ((g.x - ox) * ddx + (g.z - oz) * ddz) / denom;
  }
  if (t < 0 || t > maxT) return null;
  const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
  const hx = px - g.x, hz = pz - g.z;
  if (hx * hx + hz * hz > 0.38 * 0.38) return null;
  const top = g.y + (g.crouch ? 1.3 : 1.7);
  if (py < g.y + 0.05 || py > top) return null;
  return { t, head: py > g.y + 1.42 };
}

export function tryFire(map, f) {
  const w = weaponOf(f);
  if (!f.alive || f.fireCooldown > 0 || f.reloading > 0 || f.switchT > 0) return false;
  const id = w.id;
  if (f.mag[id] <= 0) {
    f.fireCooldown = 0.25;
    if (f.index === 0) S.events.push({ kind: 'dry', x: f.x, z: f.z });
    startReload(f);
    return false;
  }
  f.mag[id]--;
  f.fireCooldown = 60 / w.rpm;
  f.bloom = Math.min(0.09, f.bloom + w.recoil);

  // Spread: base + movement + accumulated bloom, eased by crouching/ADS.
  let spread = w.spread + f.moving * w.moveSpread + f.bloom;
  if (f.airborne) spread += 0.05;
  if (f.crouch) spread *= 0.7;
  const isPlayer = f.index === 0;
  if (isPlayer && S.input.ads) spread *= w.scoped ? 0.25 : 0.5;
  if (f.isBot) spread += f.brain.aimErr;

  const rng = S.rng;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * spread;
  // Offset the aim direction inside a cone of radius `spread` radians.
  const base = forwardVec(f.yaw, f.pitch);
  // Build an orthonormal basis around the aim direction.
  const up = Math.abs(base.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const rx = base.y * up.z - base.z * up.y;
  const ry = base.z * up.x - base.x * up.z;
  const rz = base.x * up.y - base.y * up.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const ux = (base.y * rz - base.z * ry) / rl;
  const uy = (base.z * rx - base.x * rz) / rl;
  const uz = (base.x * ry - base.y * rx) / rl;
  const dir = {
    x: base.x + (rx / rl) * Math.cos(a) * r + ux * Math.sin(a) * r,
    y: base.y + (ry / rl) * Math.cos(a) * r + uy * Math.sin(a) * r,
    z: base.z + (rz / rl) * Math.cos(a) * r + uz * Math.sin(a) * r,
  };
  const dl = Math.hypot(dir.x, dir.y, dir.z);
  dir.x /= dl; dir.y /= dl; dir.z /= dl;

  const eye = eyePos(f);
  const wallDist = map.rayHit(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, w.range);

  let best = null;
  for (const g of S.fighters) {
    if (g.team === f.team || !g.alive) continue;
    const hit = rayCapsule(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, g, wallDist);
    if (hit && (!best || hit.t < best.t)) best = { g, t: hit.t, head: hit.head };
  }

  const endT = best ? best.t : wallDist;
  const hitPoint = { x: eye.x + dir.x * endT, y: eye.y + dir.y * endT, z: eye.z + dir.z * endT };

  if (best) {
    let dmg = w.damage;
    if (best.t > 12) dmg *= 1 - w.falloff * Math.min(1, (best.t - 12) / 40);
    if (best.head) dmg *= w.headMult;
    applyDamage(best.g, dmg, f, best.head, w.id);
    if (isPlayer) S.events.push({ kind: 'hitmark', head: best.head });
  }

  // View kick for the player; bots climb their aim slightly instead.
  if (isPlayer) {
    S.view.recoilPitch += w.kick * 0.012;
    S.view.recoilYaw += (rng() - 0.5) * w.kick * 0.008;
  } else {
    f.pitch += w.kick * 0.004;
  }

  S.noises.push({ x: f.x, z: f.z, radius: w.id === 'l96' ? 26 : 20, kind: 'shot' });
  S.events.push({
    kind: 'shot', by: f.index, weapon: w.id,
    x: eye.x, y: eye.y, z: eye.z,
    tx: hitPoint.x, ty: hitPoint.y, tz: hitPoint.z,
    hit: !!best,
  });
  return true;
}

// Shared damage path for bullets and grenades.
export function applyDamage(victim, dmg, attacker, headshot, weaponId) {
  if (!victim.alive) return;
  let hpDmg = dmg;
  if (victim.armour > 0) {
    const absorbed = Math.min(victim.armour, dmg * ARMOUR_ABSORB);
    victim.armour -= absorbed;
    hpDmg = dmg - absorbed;
  }
  victim.hp -= hpDmg;
  if (victim.index === 0) {
    S.view.damageFlash = Math.min(1, S.view.damageFlash + 0.45);
    S.events.push({ kind: 'hurt' });
  }
  if (victim.hp <= 0) killFighter(victim, attacker, headshot, weaponId);
}

export function killFighter(victim, attacker, headshot, weaponId) {
  victim.alive = false;
  victim.hp = 0;
  victim.reloading = 0;
  if (attacker && attacker !== victim) {
    attacker.money = Math.min(MAX_MONEY, attacker.money + KILL_REWARD);
  }
  S.kills.push({
    a: attacker ? attacker.index : -1, b: victim.index,
    weapon: weaponId, headshot: !!headshot, t: S.time,
  });
  S.events.push({
    kind: 'kill', a: attacker ? attacker.index : -1, b: victim.index,
    weapon: weaponId, headshot: !!headshot,
    x: victim.x, z: victim.z,
  });
  // The bomb drops where its carrier falls.
  if (S.bomb.carrier === victim.index && S.bomb.state === 'carried') {
    S.bomb.state = 'dropped';
    S.bomb.x = victim.x; S.bomb.z = victim.z;
    S.bomb.carrier = null;
    S.events.push({ kind: 'bombdrop', x: victim.x, z: victim.z });
  }
  // The dead player spectates the first living teammate.
  if (victim.index === 0) {
    const mate = S.fighters.find((f) => f.team === 'attack' && f.alive);
    S.view.spectate = mate ? mate.index : -1;
  }
}
