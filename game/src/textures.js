// Procedural canvas textures: every surface in the port is painted in code,
// so the game ships zero image assets and loads nothing over the network.
// Each maker returns a THREE.CanvasTexture; textures are created once and
// shared by every mesh that uses them.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(g, w, h, n, colors, rMin, rMax, rng) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(rng() * colors.length) | 0];
    const r = rMin + rng() * (rMax - rMin);
    g.fillRect(rng() * w, rng() * h, r, r);
  }
}

// Deterministic tiny RNG so textures look the same every load.
function srand(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Corrugated shipping container in one of the port's paint colours.
export function containerTexture(base, seed = 7) {
  const [c, g] = canvas(256, 128);
  const rng = srand(seed);
  g.fillStyle = base; g.fillRect(0, 0, 256, 128);
  // Vertical ribs: alternating light and shadow stripes.
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(x, 0, 5, 128);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x + 10, 0, 6, 128);
  }
  // Rust streaks running down from the top edge.
  for (let i = 0; i < 26; i++) {
    const x = rng() * 256, len = 20 + rng() * 70;
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(90,45,20,0.5)'); grad.addColorStop(1, 'rgba(90,45,20,0)');
    g.fillStyle = grad; g.fillRect(x, 0, 2 + rng() * 4, len);
  }
  // Stencil marks: a faded serial + handling arrows.
  g.fillStyle = 'rgba(235,230,215,0.55)';
  g.font = 'bold 15px monospace';
  g.fillText('TBXU ' + (100000 + ((seed * 7919) % 899999)), 14, 112);
  g.fillRect(196, 12, 34, 4); g.fillRect(196, 22, 34, 4);
  speckle(g, 256, 128, 260, ['rgba(0,0,0,0.14)', 'rgba(255,255,255,0.06)'], 1, 3, rng);
  return tex(c);
}

export function concreteTexture() {
  const [c, g] = canvas(256, 256);
  const rng = srand(31);
  g.fillStyle = '#3a4149'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 1400, ['#333a41', '#424a52', '#2f363d', '#4a525b'], 1, 4, rng);
  // Panel seams + a few damp stains.
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke();
  for (let i = 0; i < 7; i++) {
    const x = rng() * 256, y = rng() * 256, r = 18 + rng() * 34;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(10,14,20,0.30)'); grad.addColorStop(1, 'rgba(10,14,20,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return tex(c, 3, 3);
}

export function groundTexture() {
  const [c, g] = canvas(512, 512);
  const rng = srand(97);
  g.fillStyle = '#323842'; g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 5200, ['#2b3138', '#3a414b', '#272d34', '#424a54'], 1, 3, rng);
  // Faded painted lane lines and tyre arcs.
  g.strokeStyle = 'rgba(216,160,32,0.35)'; g.lineWidth = 5;
  g.setLineDash([34, 26]); g.beginPath(); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
  g.setLineDash([]);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 9;
  g.beginPath(); g.arc(120, 380, 90, 0.3, 2.4); g.stroke();
  g.beginPath(); g.arc(400, 130, 70, 2.8, 5.6); g.stroke();
  // Puddle sheen: darker wet patches.
  for (let i = 0; i < 12; i++) {
    const x = rng() * 512, y = rng() * 512, r = 22 + rng() * 46;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(8,12,20,0.42)'); grad.addColorStop(1, 'rgba(8,12,20,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return tex(c, 4, 4);
}

export function hazardTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#c99a1e'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#15181d';
  for (let x = -128; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 128); g.lineTo(x + 16, 128); g.lineTo(x + 144, 0); g.lineTo(x + 128, 0);
    g.closePath(); g.fill();
  }
  const rng = srand(5);
  speckle(g, 128, 128, 200, ['rgba(0,0,0,0.12)'], 1, 3, rng);
  return tex(c);
}

export function metalTexture() {
  const [c, g] = canvas(128, 128);
  const rng = srand(17);
  g.fillStyle = '#4d565f'; g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 500, ['#454d55', '#576069', '#3d444b'], 1, 3, rng);
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 2; g.strokeRect(2, 2, 124, 124);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  for (const [x, y] of [[10, 10], [118, 10], [10, 118], [118, 118]]) {
    g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
  }
  return tex(c);
}

// Big painted site letter for the ground ("A" / "B"), transparent around it.
export function letterTexture(letter) {
  const [c, g] = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  g.font = '800 190px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(216,160,32,0.85)';
  g.fillText(letter, 128, 136);
  const t = tex(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Distant skyline silhouette with lit windows, for the backdrop boxes.
export function skylineTexture(seed = 3) {
  const [c, g] = canvas(256, 128);
  const rng = srand(seed);
  g.fillStyle = '#0b1018'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 60; i++) {
    const warm = rng() > 0.4;
    g.fillStyle = warm ? 'rgba(255,179,64,0.85)' : 'rgba(159,216,255,0.7)';
    g.fillRect(4 + rng() * 248, 8 + rng() * 108, 3, 4);
  }
  return tex(c);
}
