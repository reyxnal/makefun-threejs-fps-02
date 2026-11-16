// World effects: falling rain, bullet tracers, impact particles, muzzle
// flashes, smoke clouds, and the bomb prop. All pools are fixed-size and
// pre-allocated; nothing allocates in the per-frame path. Effects only
// ever *read* sim state and the drained event stream.
import * as THREE from 'three';
import { S } from './state.js';

const RAIN_DROPS = 900;
const TRACER_POOL = 24;
const PARTICLE_MAX = 240;

let scene, camera;
let rainGeo, rainPos, rainVel;
let tracers = [];
let points, pGeo, pPos, pCol, pVel, pLife, pMaxLife, pCursor = 0;
let flashPool = [];
let smokeTex, puffTex;
const smokeGroups = new Map(); // cloud object -> sprite group
let bombMesh, bombLed;

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export function initEffects(aScene, aCamera) {
  scene = aScene;
  camera = aCamera;
  smokeTex = radialTexture('rgba(190,198,208,0.85)', 'rgba(190,198,208,0)');
  puffTex = radialTexture('rgba(255,240,200,1)', 'rgba(255,160,40,0)');

  // Rain: short vertical line segments in a box that follows the camera.
  rainGeo = new THREE.BufferGeometry();
  rainPos = new Float32Array(RAIN_DROPS * 6);
  rainVel = new Float32Array(RAIN_DROPS);
  for (let i = 0; i < RAIN_DROPS; i++) {
    rainVel[i] = 20 + Math.random() * 6;
    resetDrop(i, true);
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
    color: 0x93a7c4, transparent: true, opacity: 0.32,
  }));
  rain.frustumCulled = false;
  scene.add(rain);

  // Tracer pool: one line per in-flight tracer, fading fast.
  for (let i = 0; i < TRACER_POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  // Particle pool: one Points cloud, per-particle velocity + life in JS.
  pGeo = new THREE.BufferGeometry();
  pPos = new Float32Array(PARTICLE_MAX * 3);
  pCol = new Float32Array(PARTICLE_MAX * 3);
  pVel = new Float32Array(PARTICLE_MAX * 3);
  pLife = new Float32Array(PARTICLE_MAX);
  pMaxLife = new Float32Array(PARTICLE_MAX);
  for (let i = 0; i < PARTICLE_MAX; i++) pPos[i * 3 + 1] = -100;
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.14, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);

  // Muzzle flash pool: additive sprites, shown for one or two frames.
  for (let i = 0; i < 10; i++) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: puffTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    }));
    spr.scale.set(0.6, 0.6, 1);
    spr.visible = false;
    scene.add(spr);
    flashPool.push({ spr, life: 0 });
  }

  // The bomb: a dark case with a blinking LED.
  bombMesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.24, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.4 }),
  );
  body.position.y = 0.12;
  bombLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4030 }),
  );
  bombLed.position.set(0.12, 0.27, 0);
  bombMesh.add(body, bombLed);
  bombMesh.visible = false;
  scene.add(bombMesh);
}

function resetDrop(i, anywhere) {
  const cx = camera.position.x, cz = camera.position.z;
  const x = cx + (Math.random() - 0.5) * 60;
  const z = cz + (Math.random() - 0.5) * 60;
  const y = anywhere ? Math.random() * 30 : 26 + Math.random() * 4;
  rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
  rainPos[i * 6 + 3] = x + 0.06; rainPos[i * 6 + 4] = y - 0.55; rainPos[i * 6 + 5] = z + 0.02;
}

function spawnTracer(x1, y1, z1, x2, y2, z2) {
  const t = tracers.find((tr) => tr.life <= 0) || tracers[0];
  const p = t.line.geometry.attributes.position.array;
  p[0] = x1; p[1] = y1; p[2] = z1; p[3] = x2; p[4] = y2; p[5] = z2;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.visible = true;
  t.line.material.opacity = 0.85;
  t.life = 0.09;
}

function spawnParticles(x, y, z, n, color, speed, life) {
  const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
  for (let k = 0; k < n; k++) {
    const i = pCursor;
    pCursor = (pCursor + 1) % PARTICLE_MAX;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pCol[i * 3] = r; pCol[i * 3 + 1] = g; pCol[i * 3 + 2] = b;
    const a = Math.random() * Math.PI * 2;
    const up = Math.random() * 0.9 + 0.2;
    const sp = speed * (0.4 + Math.random() * 0.8);
    pVel[i * 3] = Math.cos(a) * sp;
    pVel[i * 3 + 1] = up * sp;
    pVel[i * 3 + 2] = Math.sin(a) * sp;
    pLife[i] = pMaxLife[i] = life * (0.6 + Math.random() * 0.7);
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

function spawnFlash(x, y, z, scale) {
  const f = flashPool.find((fl) => fl.life <= 0) || flashPool[0];
  f.spr.position.set(x, y, z);
  f.spr.scale.set(scale, scale, 1);
  f.spr.material.rotation = Math.random() * Math.PI;
  f.spr.visible = true;
  f.spr.material.opacity = 0.95;
  f.life = 0.045;
}

const _muzzle = new THREE.Vector3();
export function onEffectEvent(e) {
  if (e.kind === 'shot') {
    // Tracer origin: the shooter's gun. For the player that is the
    // viewmodel muzzle (in front of the camera); for bots, the chest gun.
    const shooter = S.fighters[e.by];
    let ox = e.x, oy = e.y - 0.25, oz = e.z;
    if (e.by === 0) {
      _muzzle.set(0.18, -0.14, -0.6).applyMatrix4(camera.matrixWorld);
      ox = _muzzle.x; oy = _muzzle.y; oz = _muzzle.z;
    } else if (shooter) {
      oy = shooter.y + 1.2;
    }
    spawnTracer(ox, oy, oz, e.tx, e.ty, e.tz);
    spawnFlash(ox, oy, oz, 0.5);
    if (e.hit) spawnParticles(e.tx, e.ty, e.tz, 5, 0x8a1f1a, 1.6, 0.5);
    else spawnParticles(e.tx, e.ty, e.tz, 4, 0xb8b0a0, 1.4, 0.4);
    if (S.shotMode === 'fight' && !window.__shotReady) window.__shotReady = true;
  } else if (e.kind === 'explosion') {
    spawnParticles(e.x, e.y + 0.3, e.z, 40, 0xff8c30, 6, 0.9);
    spawnParticles(e.x, e.y + 0.3, e.z, 24, 0x5a5a5a, 3.5, 1.3);
    spawnFlash(e.x, e.y + 0.5, e.z, e.big ? 4 : 2.2);
  } else if (e.kind === 'smoke') {
    // The cloud itself is synced from S.smokes in updateEffects.
    spawnParticles(e.x, e.y + 0.3, e.z, 8, 0xc8ccd2, 1.2, 0.6);
  } else if (e.kind === 'bounce') {
    spawnParticles(e.x, e.y ?? 0.2, e.z, 2, 0xd8d2c4, 0.8, 0.3);
  }
}

function syncSmokeClouds(time) {
  // Create a sprite group per live cloud, remove groups for dead clouds.
  for (const [cloud, group] of smokeGroups) {
    if (!S.smokes.includes(cloud)) {
      scene.remove(group);
      smokeGroups.delete(cloud);
    }
  }
  for (const cloud of S.smokes) {
    let group = smokeGroups.get(cloud);
    if (!group) {
      group = new THREE.Group();
      for (let i = 0; i < 8; i++) {
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: smokeTex, transparent: true, opacity: 0.5, depthWrite: false,
        }));
        const a = (i / 8) * Math.PI * 2;
        spr.position.set(Math.cos(a) * 1.4, (i % 3) * 0.8 - 0.6, Math.sin(a) * 1.4);
        spr.scale.set(3.2, 3.2, 1);
        spr.material.rotation = Math.random() * Math.PI;
        group.add(spr);
      }
      group.position.set(cloud.x, cloud.y, cloud.z);
      scene.add(group);
      smokeGroups.set(cloud, group);
    }
    const age = 1 - cloud.ttl / 16;
    const s = 3.2 + age * 1.6;
    for (const spr of group.children) {
      spr.scale.set(s, s, 1);
      spr.material.opacity = 0.5 * Math.min(1, cloud.ttl / 2);
      spr.material.rotation += 0.002;
    }
  }
}

function syncBomb(time) {
  const bomb = S.bomb;
  if (bomb.state === 'carried' && bomb.carrier !== null) {
    const c = S.fighters[bomb.carrier];
    if (!c || !c.alive) { bombMesh.visible = false; return; }
    if (c.index === 0) { bombMesh.visible = false; return; } // your own pack is not visible
    bombMesh.visible = true;
    bombMesh.position.set(
      c.x + Math.sin(c.yaw) * 0.3,
      c.y + 1.25,
      c.z + Math.cos(c.yaw) * 0.3,
    );
    bombMesh.rotation.y = c.yaw;
    bombLed.material.color.setHex(0xff4030);
  } else if (bomb.state === 'dropped' || bomb.state === 'planted') {
    bombMesh.visible = true;
    bombMesh.position.set(bomb.x, 0, bomb.z);
    bombMesh.rotation.y = 0.4;
    if (bomb.state === 'planted') {
      const rate = 2 + (1 - bomb.timer / 35) * 8;
      const on = Math.sin(time * rate * Math.PI) > 0;
      bombLed.material.color.setHex(on ? 0xff4030 : 0x40100c);
    }
  } else {
    bombMesh.visible = false;
  }
}

export function updateEffects(dt, time) {
  // Rain falls and wraps inside its camera-following box.
  for (let i = 0; i < RAIN_DROPS; i++) {
    const fall = rainVel[i] * dt;
    rainPos[i * 6 + 1] -= fall;
    rainPos[i * 6 + 4] -= fall;
    // Recentre drops that drifted behind the camera.
    const dx = rainPos[i * 6] - camera.position.x;
    const dz = rainPos[i * 6 + 2] - camera.position.z;
    if (dx > 30) { rainPos[i * 6] -= 60; rainPos[i * 6 + 3] -= 60; }
    if (dx < -30) { rainPos[i * 6] += 60; rainPos[i * 6 + 3] += 60; }
    if (dz > 30) { rainPos[i * 6 + 2] -= 60; rainPos[i * 6 + 5] -= 60; }
    if (dz < -30) { rainPos[i * 6 + 2] += 60; rainPos[i * 6 + 5] += 60; }
    if (rainPos[i * 6 + 1] < 0) resetDrop(i, false);
  }
  rainGeo.attributes.position.needsUpdate = true;

  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
      if (t.life <= 0) t.line.visible = false;
    }
  }

  for (const f of flashPool) {
    if (f.life > 0) {
      f.life -= dt;
      f.spr.material.opacity = Math.max(0, f.life / 0.045) * 0.95;
      if (f.life <= 0) f.spr.visible = false;
    }
  }

  for (let i = 0; i < PARTICLE_MAX; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -100; continue; }
    pVel[i * 3 + 1] -= 6 * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    if (pPos[i * 3 + 1] < 0.02) { pPos[i * 3 + 1] = 0.02; pVel[i * 3 + 1] = 0; }
  }
  pGeo.attributes.position.needsUpdate = true;

  syncSmokeClouds(time);
  syncBomb(time);
}
