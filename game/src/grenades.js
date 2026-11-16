// Grenades: throwing, bouncing, and the three detonation effects.
// Frag deals radius damage through line of sight; smoke lays a cloud that
// blocks sight (bots and the map's LOS test both honour it); flash blinds
// anyone facing it with a clear line of sight, scaled by distance.
import { GRENADES, GRAVITY, ARMOUR_ABSORB, MAX_MONEY, KILL_REWARD } from './config.js';
import { S, eyePos, forwardVec } from './state.js';
import { applyDamage } from './weapons.js';

export function throwGrenade(f, kind) {
  if (!f.alive || f.throwCd > 0 || f.reloading > 0) return false;
  if (f.grenades[kind] <= 0) return false;
  f.grenades[kind]--;
  f.throwCd = 0.6;
  const eye = eyePos(f);
  const fwd = forwardVec(f.yaw, f.pitch);
  S.grenades.push({
    kind, owner: f.index,
    x: eye.x, y: eye.y - 0.15, z: eye.z,
    vx: fwd.x * 11 + f.vx * 0.5,
    vy: fwd.y * 11 + 3.4,
    vz: fwd.z * 11 + f.vz * 0.5,
    fuse: GRENADES[kind].fuse,
    done: false,
  });
  S.events.push({ kind: 'throw', x: f.x, z: f.z });
  return true;
}

export function stepGrenades(map, dt) {
  for (const g of S.grenades) {
    if (g.done) continue;
    g.fuse -= dt;
    g.vy -= GRAVITY * dt;
    let nx = g.x + g.vx * dt;
    let ny = g.y + g.vy * dt;
    let nz = g.z + g.vz * dt;
    // Ground bounce.
    const ground = map.groundHeightAt(nx, nz, g.y);
    if (ny <= ground + 0.12) {
      ny = ground + 0.12;
      if (Math.abs(g.vy) > 1.6) {
        g.vy = -g.vy * 0.35;
        g.vx *= 0.7; g.vz *= 0.7;
        S.events.push({ kind: 'bounce', x: nx, z: nz });
      } else {
        g.vy = 0; g.vx *= 0.82; g.vz *= 0.82;
      }
    }
    // Wall bounce: the map push-out tells us a wall was hit.
    const pos = { x: nx, z: nz };
    if (map.resolveCircle(pos, ny, 0.12, 0.24)) {
      g.vx *= -0.35; g.vz *= -0.35;
      nx = pos.x; nz = pos.z;
    }
    g.x = nx; g.y = ny; g.z = nz;
    if (g.fuse <= 0) {
      g.done = true;
      detonate(map, g);
    }
  }
  if (S.grenades.some((g) => g.done)) S.grenades = S.grenades.filter((g) => !g.done);

  // Smoke clouds expire on their own clock.
  for (const s of S.smokes) s.ttl -= dt;
  if (S.smokes.some((s) => s.ttl <= 0)) S.smokes = S.smokes.filter((s) => s.ttl > 0);
}

function detonate(map, g) {
  if (g.kind === 'frag') {
    S.events.push({ kind: 'explosion', x: g.x, y: g.y, z: g.z });
    S.noises.push({ x: g.x, z: g.z, radius: 30, kind: 'explosion' });
    const owner = S.fighters[g.owner];
    for (const f of S.fighters) {
      if (!f.alive) continue;
      const chest = { x: f.x, y: f.y + 1.2, z: f.z };
      const d = Math.hypot(chest.x - g.x, chest.y - g.y, chest.z - g.z);
      if (d > GRENADES.frag.radius) continue;
      if (map.losBlocked(g.x, g.y + 0.2, g.z, chest.x, chest.y, chest.z, null)) continue;
      const dmg = GRENADES.frag.damage * (1 - d / (GRENADES.frag.radius + 2)) + 8;
      applyDamage(f, dmg, owner, false, 'frag');
    }
  } else if (g.kind === 'smoke') {
    S.smokes.push({ x: g.x, y: g.y + 0.8, z: g.z, radius: GRENADES.smoke.radius, ttl: GRENADES.smoke.duration });
    S.events.push({ kind: 'smoke', x: g.x, y: g.y, z: g.z });
  } else if (g.kind === 'flash') {
    S.events.push({ kind: 'flashpop', x: g.x, y: g.y, z: g.z });
    S.noises.push({ x: g.x, z: g.z, radius: 24, kind: 'flash' });
    for (const f of S.fighters) {
      if (!f.alive) continue;
      const eye = eyePos(f);
      const d = Math.hypot(eye.x - g.x, eye.y - g.y, eye.z - g.z);
      if (d > GRENADES.flash.radius) continue;
      if (map.losBlocked(g.x, g.y, g.z, eye.x, eye.y, eye.z, S.smokes)) continue;
      // Facing the pop blinds fully; turning away halves it.
      const fwd = forwardVec(f.yaw, f.pitch);
      const toPop = { x: (g.x - eye.x) / d, y: (g.y - eye.y) / d, z: (g.z - eye.z) / d };
      const facing = fwd.x * toPop.x + fwd.y * toPop.y + fwd.z * toPop.z;
      const factor = 0.35 + 0.65 * Math.max(0, facing);
      const blind = GRENADES.flash.duration * (1 - d / GRENADES.flash.radius) * factor;
      if (blind > 0.2) {
        f.flash = Math.max(f.flash, blind);
        if (f.index === 0) S.view.flashBlind = Math.min(1, S.view.flashBlind + blind / 2);
      }
    }
  }
}
