// World effects: falling rain, bullet tracers, impact particles, muzzle
// flashes, smoke clouds, and the bomb prop. All pools are fixed-size and
// pre-allocated; nothing allocates in the per-frame path. Effects only
// ever *read* sim state and the drained event stream.
import * as THREE from 'three';
import { S } from './state.js';

const RAIN_DROPS = 450;
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

  // Tracer pool: thin additive cylinders, oriented along each shot. A 1px
  // line vanishes at range and at low render resolution; a cylinder reads
  // as a streak of fire from any angle, in motion and in a still frame.
  const tracerGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true);
  for (let i = 0; i < TRACER_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(tracerGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0, maxLife: 0.16 });
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
    flashPool.push({ spr, life: 0, maxLife: 0.08, peak: 0.95 });
  }

  // The bomb: a dark case with a blinking LED.
  bombMesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.24, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x2b2f36 }),
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

const _up = new THREE.Vector3(0, 1, 0);
const _tracerDir = new THREE.Vector3();
function spawnTracer(x1, y1, z1, x2, y2, z2) {
  const t = tracers.find((tr) => tr.life <= 0) || tracers[0];
  _tracerDir.set(x2 - x1, y2 - y1, z2 - z1);
  const len = Math.max(0.1, _tracerDir.length());
  _tracerDir.normalize();
  t.mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  t.mesh.quaternion.setFromUnitVectors(_up, _tracerDir);
  t.mesh.scale.set(1, len, 1);
  t.mesh.visible = true;
  t.mesh.material.opacity = 0.9;
  // The fight screenshot holds its tracers for the shutter: each one is a
  // real shot, kept on screen until the capture lands (main.js freezes
  // the sim the moment the shot is ready).
  t.maxLife = S.shotMode === 'fight' ? 999 : 0.16;
  t.life = t.maxLife;
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
  // Held flashes (fight shot) sit at a dimmer peak: several stacked
  // additive sprites at full opacity white the frame out.
  f.peak = S.shotMode === 'fight' ? 0.5 : 0.95;
  f.spr.material.opacity = f.peak;
  f.maxLife = S.shotMode === 'fight' ? 999 : 0.08;
  f.life = f.maxLife;
}

const _muzzle = new THREE.Vector3();
export function onEffectEvent(e) {
  if (e.kind === 'shot') {
    // Tracer origin: the shooter's gun — the viewmodel muzzle for the
    // player, the chest gun for bots. The player's own tracer starts
    // 2.5 m down the shot: a cylinder beginning 0.6 m from the lens fills
    // the frame with its near end. The flash stays at the muzzle.
    const shooter = S.fighters[e.by];
    let ox = e.x, oy = e.y - 0.25, oz = e.z;
    let tx0 = ox, ty0 = oy, tz0 = oz;
    if (e.by === 0) {
      _muzzle.set(0.18, -0.14, -0.6).applyMatrix4(camera.matrixWorld);
      ox = _muzzle.x; oy = _muzzle.y; oz = _muzzle.z;
      const dx = e.tx - e.x, dy = e.ty - e.y, dz = e.tz - e.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const lead = Math.min(2.5, dl * 0.5);
      tx0 = e.x + (dx / dl) * lead; ty0 = e.y + (dy / dl) * lead; tz0 = e.z + (dz / dl) * lead;
    } else if (shooter) {
      oy = shooter.y + 1.2;
      ty0 = oy;
    }
    spawnTracer(tx0, ty0, tz0, e.tx, e.ty, e.tz);
    // The player's own flash sits 0.6 m from the camera: at full size it
    // whites out the held fight frame, so it is staged smaller there.
    const flashScale = (e.by === 0 && S.shotMode === 'fight') ? 0.35 : 0.6;
    spawnFlash(ox, oy, oz, flashScale);
    if (e.hit) spawnParticles(e.tx, e.ty, e.tz, 5, 0x8a1f1a, 1.6, 0.5);
    else spawnParticles(e.tx, e.ty, e.tz, 4, 0xb8b0a0, 1.4, 0.4);
    // The fight shot is ready once a real shot has flown AND the radio has
    // spoken: the frame then shows the tracer, the flash and the callout
    // feed together. (The S.time > 4 fallback in main.js covers a silent
    // radio.)
    if (S.shotMode === 'fight' && S.callouts.length > 0 && !window.__shotReady) {
      window.__shotReady = true;
    }
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
      t.mesh.material.opacity = Math.max(0, t.life / t.maxLife) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  for (const f of flashPool) {
    if (f.life > 0) {
      f.life -= dt;
      f.spr.material.opacity = Math.max(0, f.life / f.maxLife) * f.peak;
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
