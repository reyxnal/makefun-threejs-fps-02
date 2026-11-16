// Bot brains: route-following on the waypoint graph, holds with scanning,
// reaction-delayed engagements with strafing, sound investigation, and the
// bomb roles (carrier plants, defenders retake and defuse).
// Thinking runs at 10 Hz; steering and firing run every sim step. Bots see
// through the same LOS test the bullets use, smoke included.
import {
  WALK_SPEED, PLAYER_RADIUS, PLAYER_HEIGHT, GRAVITY, MAP,
  PLANT_TIME, DEFUSE_TIME,
} from './config.js';
import { S, eyePos, forwardVec } from './state.js';
import { tryFire, startReload, switchSlot } from './weapons.js';
import { throwGrenade } from './grenades.js';
import { currentWeaponId } from './player.js';

const THINK_DT = 0.1;
const REACTION = [0.5, 0.28]; // seconds, scaled by (1 - skill)

// Assign routes + holds when a round starts. Attackers split 2/2/1 across
// A/B/mid; defenders anchor two per site plus one mid floater.
export function assignRoles() {
  const atk = S.fighters.filter((f) => f.team === 'attack' && f.isBot);
  const def = S.fighters.filter((f) => f.team === 'defend');
  const routes = ['A', 'A', 'B', 'B'];
  atk.forEach((f, i) => {
    const b = f.brain;
    b.route = routes[i % routes.length];
    b.state = 'route';
    b.path = []; b.pathI = 0;
    b.target = -1; b.holdUntil = 0;
    b.aimErr = 0.045 - b.skill * 0.03;
  });
  const holds = [10, 27, 16, 17, 29];
  def.forEach((f, i) => {
    const b = f.brain;
    b.route = i < 2 ? 'A' : i < 4 ? 'B' : 'mid';
    b.holdNode = holds[i % holds.length];
    b.state = 'route';
    b.path = []; b.pathI = 0;
    b.target = -1;
    b.aimErr = 0.045 - b.skill * 0.03;
  });
}

// Per-round buy for bots: spend on a rifle when affordable, keep a grenade
// in the pocket. Bots buy instantly at round start (no menu).
export function botBuy(f) {
  if (f.money >= 2700 && !f.weapons.primary) {
    f.weapons.primary = 'r4';
    f.mag.r4 = 30; f.reserve.r4 = 90;
    f.money -= 2700;
    f.slot = 'primary';
  } else if (f.money >= 1500 && !f.weapons.primary) {
    f.weapons.primary = 'k7';
    f.mag.k7 = 30; f.reserve.k7 = 90;
    f.money -= 1500;
    f.slot = 'primary';
  }
  if (f.money >= 300 && f.grenades.frag === 0) { f.grenades.frag = 1; f.money -= 300; }
  if (f.money >= 300 && f.grenades.smoke === 0 && S.rng() < 0.5) { f.grenades.smoke = 1; f.money -= 300; }
  if (f.money >= 200 && f.grenades.flash === 0 && S.rng() < 0.4) { f.grenades.flash = 1; f.money -= 200; }
  if (f.money >= 650 && f.armour === 0) { f.armour = 100; f.money -= 650; }
}

function canSee(map, f, g) {
  if (!g.alive) return false;
  const a = eyePos(f), b = eyePos(g);
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (d > 55) return false;
  return !map.losBlocked(a.x, a.y, a.z, b.x, b.y, b.z, S.smokes);
}

function nearestVisibleEnemy(map, f) {
  let best = null, bestD = Infinity;
  for (const g of S.fighters) {
    if (g.team === f.team || !g.alive) continue;
    if (!canSee(map, f, g)) continue;
    const d = Math.hypot(g.x - f.x, g.z - f.z);
    if (d < bestD) { bestD = d; best = g; }
  }
  return best;
}

function angleTo(f, x, z) {
  // Yaw whose forward (-sin, -cos) points at (x, z).
  return Math.atan2(-(x - f.x), -(z - f.z));
}

function turnToward(f, targetYaw, dt, rate) {
  let d = targetYaw - f.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, d));
  f.yaw += step;
  return Math.abs(d - step) < 0.05;
}

function aimAt(f, g, dt) {
  const a = eyePos(f), b = { x: g.x, y: g.y + 1.3, z: g.z };
  const targetYaw = angleTo(f, b.x, b.z);
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const targetPitch = Math.atan2(b.y - a.y, Math.max(0.5, dist));
  // Aim error wanders slowly so bots miss plausibly instead of snapping.
  const wobble = Math.sin(S.time * 1.7 + f.index * 2.1) * f.brain.aimErr;
  turnToward(f, targetYaw + wobble, dt, 5);
  const dp = targetPitch + wobble * 0.5 - f.pitch;
  f.pitch += Math.max(-3 * dt, Math.min(3 * dt, dp));
}

function siteTarget(route) {
  if (route === 'A') return { x: MAP.sites.A.cx, z: MAP.sites.A.cz + 2 };
  if (route === 'B') return { x: MAP.sites.B.cx, z: MAP.sites.B.cz + 2 };
  return { x: 0, z: 12 };
}

function routeTo(map, f, x, z) {
  const b = f.brain;
  const ids = map.findPath(f.x, f.z, x, z);
  b.path = ids.map((id) => ({ x: map.nodes[id][0], z: map.nodes[id][1] }));
  b.path.push({ x, z });
  b.pathI = 0;
}

function inSite(f, site) {
  const s = MAP.sites[site];
  return f.x >= s.minX && f.x <= s.maxX && f.z >= s.minZ && f.z <= s.maxZ;
}

// --- 10 Hz thinking: decisions, not movement. ---
function think(map, f) {
  const b = f.brain;
  if (f.flash > 0) { b.state = 'hold'; return; }

  const enemy = nearestVisibleEnemy(map, f);
  if (enemy) {
    b.lastSeenX = enemy.x; b.lastSeenZ = enemy.z; b.lastSeenT = S.time;
    if (b.target !== enemy.index) {
      b.target = enemy.index;
      const delay = REACTION[1] + (REACTION[0] - REACTION[1]) * (1 - b.skill);
      b.reactAt = S.time + delay;
    }
    b.state = 'engage';
    return;
  }
  if (b.state === 'engage') {
    if (S.time - b.lastSeenT > 1.2) {
      b.target = -1;
      b.state = f.team === 'attack' ? 'route' : 'hold';
    } else {
      // Push the last seen position briefly before giving up.
      b.state = 'investigate';
      b.investigateUntil = S.time + 2;
      routeTo(map, f, b.lastSeenX, b.lastSeenZ);
      return;
    }
  }

  // React to sounds: investigate recent noises inside their radius.
  for (const n of S.noises) {
    const d = Math.hypot(n.x - f.x, n.z - f.z);
    if (d < n.radius && b.state !== 'investigate' && b.state !== 'plant' && b.state !== 'defuse') {
      b.hearX = n.x; b.hearZ = n.z; b.hearT = S.time;
      if (f.team === 'defend' && b.state === 'hold' && S.rng() < 0.6) {
        b.state = 'investigate';
        b.investigateUntil = S.time + 5;
        routeTo(map, f, n.x, n.z);
      } else if (f.team === 'attack' && S.rng() < 0.3) {
        b.state = 'investigate';
        b.investigateUntil = S.time + 4;
        routeTo(map, f, n.x, n.z);
      }
      break;
    }
  }

  const bomb = S.bomb;
  if (f.team === 'attack') {
    if (bomb.carrier === f.index && bomb.state === 'carried') {
      const site = b.route === 'B' ? 'B' : 'A';
      if (inSite(f, site)) {
        b.state = 'plant';
        return;
      }
      if (b.state !== 'route' && b.state !== 'investigate') b.state = 'route';
      if (b.pathI >= b.path.length) routeTo(map, f, MAP.sites[site].cx, MAP.sites[site].cz);
    } else if (bomb.state === 'dropped') {
      // Nearest living attacker recovers the bomb.
      const mates = S.fighters.filter((m) => m.team === 'attack' && m.alive);
      const nearest = mates.reduce((a, m) => (Math.hypot(m.x - bomb.x, m.z - bomb.z) < Math.hypot(a.x - bomb.x, a.z - bomb.z) ? m : a), mates[0]);
      if (nearest === f) {
        if (b.state !== 'route') b.state = 'route';
        if (b.pathI >= b.path.length) routeTo(map, f, bomb.x, bomb.z);
      }
    } else if (bomb.state === 'planted') {
      // After the plant, attackers hold the site and guard the bomb.
      if (b.state !== 'hold') {
        b.state = 'hold';
        b.holdUntil = S.time + 999;
        const s = MAP.sites[bomb.site];
        routeTo(map, f, s.cx + (f.index % 3 - 1) * 4, s.cz + 2);
      }
    } else if (b.state === 'route' && b.pathI >= b.path.length) {
      // Reached the lane end: hold an angle toward the site.
      b.state = 'hold';
      b.holdUntil = S.time + 6 + S.rng() * 4;
    } else if (b.state === 'hold' && S.time > b.holdUntil) {
      b.state = 'route';
      const t = siteTarget(b.route);
      routeTo(map, f, t.x, t.z);
    }
  } else {
    // Defenders.
    if (bomb.state === 'planted') {
      const s = MAP.sites[bomb.site];
      const d = Math.hypot(bomb.x - f.x, bomb.z - f.z);
      if (d < 2.2) {
        b.state = 'defuse';
        return;
      }
      if (b.state !== 'rotate') {
        b.state = 'rotate';
        routeTo(map, f, bomb.x, bomb.z);
      }
    } else if (b.state === 'route' && b.pathI >= b.path.length) {
      b.state = 'hold';
      b.holdUntil = S.time + 999;
    } else if (b.state === 'hold' && b.pathI >= b.path.length && b.holdNode >= 0) {
      // Walked off? Re-path to the hold node.
      const n = map.nodes[b.holdNode];
      if (Math.hypot(n[0] - f.x, n[1] - f.z) > 2) {
        b.state = 'route';
        routeTo(map, f, n[0], n[1]);
      }
    } else if (b.state === 'investigate' && S.time > b.investigateUntil) {
      b.state = 'route';
      const n = map.nodes[b.holdNode];
      if (n) routeTo(map, f, n[0], n[1]);
    }
  }
}

// --- Per-step steering + acting. ---
function steer(map, f, tx, tz, dt, speedMul = 1) {
  const dx = tx - f.x, dz = tz - f.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) return true;
  const targetYaw = angleTo(f, tx, tz);
  turnToward(f, targetYaw, dt, 4.5);
  // Only walk once roughly facing the target; prevents moonwalking.
  let yawDiff = targetYaw - f.yaw;
  while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
  while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
  const speed = WALK_SPEED * speedMul * (Math.abs(yawDiff) > 1.2 ? 0.35 : 1);
  const fwd = forwardVec(f.yaw, 0);
  const pos = { x: f.x + fwd.x * speed * dt, z: f.z + fwd.z * speed * dt };
  map.resolveCircle(pos, f.y, PLAYER_RADIUS, PLAYER_HEIGHT);
  const moved = Math.hypot(pos.x - f.x, pos.z - f.z);
  f.x = pos.x; f.z = pos.z;
  f.moving = Math.min(1, moved / Math.max(1e-6, WALK_SPEED * dt));
  f.walkPhase += moved * 2.4;

  // Stuck detection: barely moved while trying → nudge sideways.
  if (moved < WALK_SPEED * dt * 0.25) {
    f.brain.stuckT += dt;
    if (f.brain.stuckT > 0.9) {
      f.brain.nudgeUntil = S.time + 0.8;
      const side = S.rng() < 0.5 ? 1 : -1;
      f.brain.nudgeX = f.x + Math.cos(f.yaw) * side * 2;
      f.brain.nudgeZ = f.z - Math.sin(f.yaw) * side * 2;
      f.brain.stuckT = 0;
    }
  } else {
    f.brain.stuckT = 0;
  }
  return false;
}

function stepBot(map, f, dt) {
  const b = f.brain;
  if (!f.alive) return;

  // Gravity + ground (bots never jump; ramps lift them via ground height).
  f.vy -= GRAVITY * dt;
  f.y += f.vy * dt;
  const ground = map.groundHeightAt(f.x, f.z, f.y);
  if (f.y <= ground) { f.y = ground; f.vy = 0; f.airborne = false; }
  else f.airborne = true;

  // Think on a 10 Hz clock, staggered per bot.
  b.thinkAcc += dt;
  if (b.thinkAcc >= THINK_DT) {
    b.thinkAcc = 0;
    think(map, f);
  }

  if (f.flash > 0) { f.moving = 0; return; }

  // Nudge override: sidestep out of a stuck spot.
  if (S.time < b.nudgeUntil) {
    steer(map, f, b.nudgeX, b.nudgeZ, dt, 0.7);
    return;
  }

  switch (b.state) {
    case 'engage': {
      const g = S.fighters[b.target];
      if (!g || !g.alive) { b.target = -1; b.state = f.team === 'attack' ? 'route' : 'hold'; break; }
      aimAt(f, g, dt);
      // Strafe perpendicular to the enemy, flipping every 0.7–1.4 s.
      if (S.time > b.strafeAt) {
        b.strafeDir *= -1;
        b.strafeAt = S.time + 0.7 + S.rng() * 0.7;
      }
      const side = { x: Math.cos(f.yaw) * b.strafeDir, z: -Math.sin(f.yaw) * b.strafeDir };
      const pos = { x: f.x + side.x * WALK_SPEED * 0.55 * dt, z: f.z + side.z * WALK_SPEED * 0.55 * dt };
      map.resolveCircle(pos, f.y, PLAYER_RADIUS, PLAYER_HEIGHT);
      const moved = Math.hypot(pos.x - f.x, pos.z - f.z);
      f.x = pos.x; f.z = pos.z;
      f.moving = Math.min(1, moved / Math.max(1e-6, WALK_SPEED * dt));
      f.walkPhase += moved * 2.4;
      // Fire in bursts once the reaction delay has passed.
      if (S.time >= b.reactAt) {
        if (b.burstPause > 0) {
          b.burstPause -= dt;
        } else {
          if (b.burstLeft <= 0) b.burstLeft = 2 + Math.floor(S.rng() * 4);
          if (tryFire(map, f)) {
            b.burstLeft--;
            if (b.burstLeft <= 0) b.burstPause = 0.2 + S.rng() * 0.3;
          }
        }
      }
      // Reload when the magazine is dry and the enemy is briefly unseen.
      if (f.mag[currentWeaponId(f)] === 0) startReload(f);
      break;
    }
    case 'hold': {
      f.moving = 0;
      // Scan: slow yaw sweep across the lane, reversing at the ends.
      const baseYaw = f.team === 'attack' ? Math.PI : 0;
      const sweep = Math.sin(S.time * 0.5 + f.index) * 0.6;
      turnToward(f, baseYaw + sweep * b.scanDir, dt, 1.2);
      // Occasionally toss a smoke toward the site when holding as attacker.
      break;
    }
    case 'plant': {
      f.moving = 0;
      // The channel itself is driven by rounds.js (shared with the player);
      // the bot just stands still and faces the site centre.
      const s = MAP.sites[b.route === 'B' ? 'B' : 'A'];
      turnToward(f, angleTo(f, s.cx, s.cz), dt, 3);
      break;
    }
    case 'defuse': {
      f.moving = 0;
      turnToward(f, angleTo(f, S.bomb.x, S.bomb.z), dt, 3);
      break;
    }
    default: {
      // route / rotate / investigate: follow the waypoint path.
      if (b.pathI < b.path.length) {
        const wp = b.path[b.pathI];
        if (steer(map, f, wp.x, wp.z, dt)) b.pathI++;
      } else {
        f.moving = 0;
      }
      break;
    }
  }

  // Opportunistic grenades: attackers smoke the site entrance as they arrive.
  if (f.team === 'attack' && b.state === 'route' && b.pathI >= b.path.length - 1
      && f.grenades.smoke > 0 && S.rng() < dt * 0.5) {
    const s = MAP.sites[b.route === 'B' ? 'B' : 'A'];
    f.yaw = angleTo(f, s.cx, s.cz);
    f.pitch = 0.35;
    throwGrenade(f, 'smoke');
  }
  // Reload while travelling with a dry or half-empty mag.
  if (b.state === 'route' && f.reloading <= 0) {
    const id = currentWeaponId(f);
    if (f.mag[id] <= magHalf(id) && f.reserve[id] > 0) startReload(f);
  }
}

function magHalf(id) {
  return id === 'l96' ? 2 : 10;
}

export function stepBots(map, dt) {
  for (const f of S.fighters) {
    if (f.isBot) stepBot(map, f, dt);
  }
}

// First paths for a fresh round: attackers to their lane, defenders to holds.
export function sendBotsToPositions(map) {
  for (const f of S.fighters) {
    if (!f.isBot) continue;
    const b = f.brain;
    if (f.team === 'attack') {
      const t = siteTarget(b.route);
      routeTo(map, f, t.x, t.z);
    } else {
      const n = map.nodes[b.holdNode];
      if (n) routeTo(map, f, n[0], n[1]);
    }
  }
}
