// The first-person weapon: four procedural gun models built from boxes and
// cylinders, attached to the camera. No textures, no assets — silhouette
// and proportion carry the read. Bob follows the sim's view state, recoil
// kicks and springs back, reloading dips the gun, and ADS slides it to the
// centre of the screen.
import * as THREE from 'three';
import { S } from './state.js';
import { currentWeaponId } from './player.js';

let camera, rig, guns = {}, flashQuad, flashT = 0;
let kick = 0, kickRot = 0, adsAmt = 0, curWeapon = null, switchT = 0;

const METAL = new THREE.MeshStandardMaterial({ color: 0x4a545f, roughness: 0.5, metalness: 0.25 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x363d46, roughness: 0.6, metalness: 0.2 });
const GRIP = new THREE.MeshStandardMaterial({ color: 0x5a4a33, roughness: 0.85 });
const ACCENT = new THREE.MeshStandardMaterial({ color: 0x9a7a35, roughness: 0.5, metalness: 0.25 });

function box(w, h, d, mat, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return m;
}
function cyl(r, len, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

function buildP9() {
  const g = new THREE.Group();
  g.add(box(0.05, 0.055, 0.2, METAL, 0, 0, -0.05)); // slide
  g.add(box(0.045, 0.04, 0.14, DARK, 0, -0.045, -0.02)); // frame
  g.add(box(0.042, 0.1, 0.055, GRIP, 0, -0.1, 0.05, 0.25)); // grip
  g.add(box(0.012, 0.02, 0.02, ACCENT, 0, 0.038, -0.13)); // front sight
  return g;
}
function buildK7() {
  const g = new THREE.Group();
  g.add(box(0.055, 0.07, 0.34, METAL, 0, 0, -0.08));
  g.add(cyl(0.02, 0.14, DARK, 0, 0.005, -0.3));
  g.add(box(0.04, 0.12, 0.05, DARK, 0, -0.1, -0.06, 0.1)); // long mag
  g.add(box(0.045, 0.09, 0.05, GRIP, 0, -0.09, 0.08, 0.3)); // grip
  g.add(box(0.04, 0.05, 0.12, DARK, 0, -0.01, 0.14)); // stock
  g.add(box(0.012, 0.025, 0.02, ACCENT, 0, 0.048, -0.2));
  return g;
}
function buildR4() {
  const g = new THREE.Group();
  g.add(box(0.06, 0.075, 0.42, METAL, 0, 0, -0.1));
  g.add(cyl(0.018, 0.2, DARK, 0, 0.005, -0.4));
  g.add(box(0.045, 0.13, 0.06, DARK, 0, -0.1, -0.1, 0.12)); // curved mag
  g.add(box(0.045, 0.09, 0.05, GRIP, 0, -0.09, 0.08, 0.3));
  g.add(box(0.04, 0.05, 0.16, DARK, 0, -0.01, 0.18)); // stock
  g.add(box(0.03, 0.03, 0.1, DARK, 0, 0.055, -0.06)); // carry handle
  g.add(box(0.012, 0.02, 0.02, ACCENT, 0, 0.045, -0.28));
  return g;
}
function buildL96() {
  const g = new THREE.Group();
  g.add(box(0.055, 0.07, 0.4, DARK, 0, 0, -0.08));
  g.add(cyl(0.016, 0.34, METAL, 0, 0.008, -0.42));
  g.add(cyl(0.028, 0.16, DARK, 0, 0.065, -0.1)); // scope
  g.add(box(0.04, 0.09, 0.05, GRIP, 0, -0.085, 0.06, 0.25));
  g.add(box(0.045, 0.06, 0.2, GRIP, 0, -0.02, 0.2)); // wooden stock
  g.add(box(0.012, 0.05, 0.012, METAL, 0.045, 0.01, 0.02)); // bolt
  return g;
}

export function initViewmodel(aCamera) {
  camera = aCamera;
  rig = new THREE.Group();
  rig.scale.set(0.75, 0.75, 0.75);
  camera.add(rig);
  guns = { p9: buildP9(), k7: buildK7(), r4: buildR4(), l96: buildL96() };
  for (const key of Object.keys(guns)) {
    guns[key].visible = false;
    rig.add(guns[key]);
  }
  // Muzzle flash: an additive quad at the barrel tip, randomised per shot.
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.4, 'rgba(255,190,80,0.9)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  flashQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }),
  );
  flashQuad.visible = false;
  flashQuad.renderOrder = 999;
  rig.add(flashQuad);
}

const MUZZLE_Z = { p9: -0.22, k7: -0.42, r4: -0.55, l96: -0.66 };

export function onViewmodelEvent(e) {
  if (e.kind === 'shot' && e.by === 0) {
    kick = Math.min(0.09, kick + 0.035);
    kickRot = Math.min(0.16, kickRot + 0.06);
    flashT = 0.045;
    flashQuad.visible = true;
    flashQuad.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    flashQuad.scale.set(s, s, 1);
  }
  if (e.kind === 'switch') switchT = 0.22;
}

export function updateViewmodel(dt) {
  const f = S.fighters[0];
  if (!f || !f.alive) { rig.visible = false; return; }
  rig.visible = true;
  const wid = currentWeaponId(f);
  if (wid !== curWeapon) {
    if (curWeapon) guns[curWeapon].visible = false;
    guns[wid].visible = true;
    curWeapon = wid;
    switchT = 0.22;
  }
  const view = S.view;

  // ADS slides the gun to the centre; hip keeps it low-right.
  const adsTarget = S.input.ads ? 1 : 0;
  adsAmt += (adsTarget - adsAmt) * Math.min(1, 14 * dt);
  const hip = { x: 0.24, y: -0.21, z: -0.5 };
  const ads = { x: 0, y: -0.148, z: -0.38 };
  const bobX = Math.cos(view.bobPhase) * 0.012 * view.bobAmp * (1 - adsAmt * 0.8);
  const bobY = Math.sin(view.bobPhase * 2) * 0.01 * view.bobAmp * (1 - adsAmt * 0.8);
  rig.position.set(
    hip.x + (ads.x - hip.x) * adsAmt + bobX,
    hip.y + (ads.y - hip.y) * adsAmt + bobY,
    hip.z + (ads.z - hip.z) * adsAmt + kick,
  );

  // Recoil spring: kick decays back to rest.
  kick *= Math.max(0, 1 - 9 * dt);
  kickRot *= Math.max(0, 1 - 9 * dt);
  let rotX = kickRot;

  // Reload dip: the gun tilts down and back while the mag changes.
  if (f.reloading > 0) rotX -= 0.45;
  // Switch dip: brief lower-and-raise on weapon change.
  if (switchT > 0) {
    switchT -= dt;
    rotX -= Math.sin(Math.max(0, switchT) / 0.22 * Math.PI) * 0.35;
  }
  rig.rotation.set(rotX, 0, 0);

  // Muzzle flash follows the current gun's barrel tip.
  if (flashT > 0) {
    flashT -= dt;
    flashQuad.position.set(0, 0.01, MUZZLE_Z[wid]);
    if (flashT <= 0) flashQuad.visible = false;
  }
}
