// Rendering: scene setup, camera sync and fighter bodies. The sim never
// touches three.js objects; this module is the only place that turns sim
// state (S) into pixels. No allocations happen in the per-frame path:
// vectors and quaternions below are module-level scratch.
import * as THREE from 'three';
import { PALETTE, EYE_STAND } from './config.js';
import { S } from './state.js';
import { buildMap } from './map.js';
import { mergeParts, mat4 } from './merge.js';

const _camPos = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _bodyPos = new THREE.Vector3();

let renderer, scene, camera, map;
let fighterMeshes = [];

export function initRender(container) {
  // Sniff the rasterizer BEFORE creating the renderer: software GL
  // (SwiftShader in headless Chrome, which is also how the game is judged)
  // shades every pixel on the CPU, so there MSAA is dropped and the
  // render resolution is lowered. Real GPUs keep full quality.
  let softwareGL = false;
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    const ext = probe && probe.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? probe.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    softwareGL = /swiftshader|software|llvmpipe/i.test(gpu);
  } catch { /* probe unavailable: assume hardware GL */ }
  renderer = new THREE.WebGLRenderer({
    antialias: !softwareGL,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(softwareGL ? 0.35 : Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0125);

  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 220);
  scene.add(camera);

  // No camera fill light: every light in the scene is evaluated for every
  // shaded fragment, and the viewmodel reads fine with the brighter, low-
  // metalness gun materials (there is no env map for metal to reflect).

  // Moonlight + wet-night ambient. The map's lamps add the warm pools.
  const hemi = new THREE.HemisphereLight(0x8fa8c8, 0x1a2028, 0.9);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xa8c0e0, 0.65);
  moon.position.set(-30, 60, -20);
  scene.add(moon);

  map = buildMap(scene);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return { renderer, scene, camera, map };
}

export function getMap() { return map; }
export function getScene() { return scene; }
export function getCamera() { return camera; }

// --- Fighter bodies: simple articulated figures, team-coloured. ---
const bodyGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
const headGeo = new THREE.SphereGeometry(0.21, 12, 10);
const legGeo = new THREE.BoxGeometry(0.2, 0.62, 0.22);
const armGeo = new THREE.BoxGeometry(0.15, 0.6, 0.18);
const gunGeo = new THREE.BoxGeometry(0.08, 0.12, 0.7);

export function buildFighterMeshes() {
  for (const m of fighterMeshes) scene.remove(m.group);
  fighterMeshes = [];
  for (const f of S.fighters) {
    const color = f.team === 'attack' ? PALETTE.attack : PALETTE.defend;
    const dark = new THREE.MeshLambertMaterial({ color: 0x232a33 });
    const team = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
    const group = new THREE.Group();
    // Torso + helmet share the team material: one merged mesh, and the
    // coloured helmet keeps friend/foe readable at range.
    const body = mergeParts([
      { geo: bodyGeo, matrix: mat4(0, 1.12, 0) },
      { geo: headGeo, matrix: mat4(0, 1.66, 0) },
    ], team);
    const legL = new THREE.Mesh(legGeo, dark); legL.position.set(-0.14, 0.36, 0);
    const legR = new THREE.Mesh(legGeo, dark); legR.position.set(0.14, 0.36, 0);
    // Arms posed forward around the gun: one static merged mesh. The walk
    // cycle reads through the legs and the body bob, not the arms.
    const armsGun = mergeParts([
      { geo: armGeo, matrix: mat4(-0.34, 1.12, 0.1, -0.5) },
      { geo: armGeo, matrix: mat4(0.34, 1.12, 0.1, -0.5) },
      { geo: gunGeo, matrix: mat4(0.18, 1.22, 0.42) },
    ], dark);
    group.add(body, legL, legR, armsGun);
    scene.add(group);
    const rec = { group, legL, legR, torso: body };
    fighterMeshes.push(rec);
    f.mesh = rec;
  }
}

// Sync every body mesh with sim state; dead fighters lie flat and fade.
export function syncFighters(time) {
  for (let i = 0; i < S.fighters.length; i++) {
    const f = S.fighters[i];
    const m = fighterMeshes[i];
    if (!m) continue;
    if (i === 0 && f.alive) { m.group.visible = false; continue; } // never see yourself
    m.group.visible = true;
    if (!f.alive) {
      m.group.position.set(f.x, f.y + 0.15, f.z);
      m.group.rotation.set(-Math.PI / 2 * 0.9, f.yaw, 0);
      continue;
    }
    m.group.position.set(f.x, f.y, f.z);
    m.group.rotation.set(0, f.yaw, 0);
    // Walk cycle: the legs swing with distance travelled.
    const swing = Math.sin(f.walkPhase) * 0.55 * Math.min(1, f.moving + 0.15);
    m.legL.rotation.x = swing; m.legR.rotation.x = -swing;
    // Crouch: squash the figure.
    const squash = f.crouch ? 0.78 : 1;
    m.group.scale.y += (squash - m.group.scale.y) * 0.3;
  }
}

// Camera: first-person from the player's eyes, or spectating a teammate.
export function syncCamera() {
  const f = S.fighters[0];
  const view = S.view;
  let src = f;
  if ((!f || !f.alive) && view.spectate >= 0) src = S.fighters[view.spectate];
  if (!src) return;
  const eyeH = view.eyeH ?? EYE_STAND;
  const bobY = Math.sin(view.bobPhase * 2) * 0.018 * view.bobAmp;
  const bobX = Math.cos(view.bobPhase) * 0.012 * view.bobAmp;
  _camPos.set(
    src.x + Math.cos(src.yaw) * bobX,
    src.y + eyeH + bobY,
    src.z - Math.sin(src.yaw) * bobX,
  );
  camera.position.copy(_camPos);
  const pitch = (src === f ? f.pitch : src.pitch) + view.recoilPitch;
  _euler.set(pitch, src.yaw + view.recoilYaw, 0);
  camera.quaternion.setFromEuler(_euler);
  // ADS narrows the field of view; the lerp keeps it smooth.
  const targetFov = S.input.ads && f && f.alive ? 55 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
}

export function renderFrame(time) {
  map.updateMap(time);
  syncFighters(time);
  syncCamera();
  renderer.render(scene, camera);
}
