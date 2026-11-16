// Tidebreak Terminal's map: one data table drives the visible geometry, the
// collision volumes, the walkable heights and the bot waypoint graph, so what
// the player sees is exactly what the simulation collides with.
// Coordinates: x east, z south, metres. Attackers spawn north (z < 0),
// defenders south (z > 0). Site A is the west crane yard, site B the east
// warehouse yard.
import * as THREE from 'three';
import { PALETTE, MAP } from './config.js';
import { mergeParts, mat4 } from './merge.js';
import {
  containerTexture, concreteTexture, groundTexture, hazardTexture,
  metalTexture, letterTexture, skylineTexture,
} from './textures.js';

// Box: [cx, cz, w, d, height, y0, material]. y0 defaults to ground level.
const B = (x, z, w, d, h, mat, y0 = 0) => ({ x, z, w, d, h, y0, mat });
const BOXES = [
  // Perimeter walls.
  B(0, -24.6, 66, 1.2, 5, 'concrete'), B(0, 24.6, 66, 1.2, 5, 'concrete'),
  B(-32.6, 0, 1.2, 50, 5, 'concrete'), B(32.6, 0, 1.2, 50, 5, 'concrete'),
  // Mid: the block that breaks the spawn-to-spawn sightline, and the doors.
  B(0, -9, 7, 2.6, 2.6, 'red'),
  B(-4.5, 3, 5, 2.6, 2.6, 'teal'), B(-4.5, 3, 5, 2.6, 2.6, 'ochre', 2.6),
  B(4.5, 3, 5, 2.6, 2.6, 'blue'),
  // Lane dividers: container walls with connector gaps at z = -8 and z = +3.
  B(-14, -15, 2, 8, 2.6, 'red'), B(-14, -2, 2, 6, 2.6, 'teal'), B(-14, 8, 2, 6, 2.6, 'blue'),
  B(14, -15, 2, 8, 2.6, 'ochre'), B(14, -2, 2, 6, 2.6, 'red'), B(14, 8, 2, 6, 2.6, 'teal'),
  // A lane stacks and cover.
  B(-24, -12, 8, 2.6, 2.6, 'teal'), B(-25, -12, 4, 2.6, 2.6, 'red', 2.6),
  B(-28, -4, 1.2, 1.2, 1.2, 'crate'), B(-19, -6, 1.2, 1.2, 1.2, 'crate'),
  B(-27, 3, 1.2, 1.2, 1.2, 'crate'), B(-20, 5, 1.2, 1.2, 1.2, 'crate'),
  // Crane deck: a slab on legs, walkable on top, passable underneath.
  B(-23, 10, 9, 7, 0.4, 'metal', 3.6),
  B(-26.8, 7.2, 0.5, 0.5, 3.6, 'metal'), B(-19.2, 7.2, 0.5, 0.5, 3.6, 'metal'),
  B(-26.8, 12.8, 0.5, 0.5, 3.6, 'metal'), B(-19.2, 12.8, 0.5, 0.5, 3.6, 'metal'),
  // Site A props.
  B(-28, 12, 1.1, 1.1, 1.1, 'barrel'), B(-18, 14, 1.1, 1.1, 1.1, 'barrel'),
  B(-29, 8, 1.2, 1.2, 1.2, 'crate'),
  // Warehouse yard walls (site B): gaps at the north door, west door, south door.
  B(18, 2, 4, 1, 4, 'concrete'), B(28, 2, 4, 1, 4, 'concrete'),
  B(16, 4.5, 1, 5, 4, 'concrete'), B(16, 13.5, 1, 5, 4, 'concrete'),
  B(19, 16, 6, 1, 4, 'concrete'), B(28, 16, 4, 1, 4, 'concrete'),
  // Yard interior: conveyor, crates, office block.
  B(23, 8, 8, 1.2, 0.9, 'metal'),
  B(19, 6, 1.2, 1.2, 1.2, 'crate'), B(27, 6, 1.2, 1.2, 1.2, 'crate'),
  B(19, 13, 1.2, 1.2, 1.2, 'crate'), B(27, 13, 1.2, 1.2, 1.2, 'crate'),
  B(28.5, 11, 3, 3, 3, 'concrete'),
  B(18, 14, 1.1, 1.1, 1.1, 'barrel'),
  // B lane stacks and cover.
  B(24, -12, 8, 2.6, 2.6, 'ochre'),
  B(28, -4, 1.2, 1.2, 1.2, 'crate'), B(19, -6, 1.2, 1.2, 1.2, 'crate'),
  // Defender mid cover + spawn crates.
  B(0, 16, 4, 1, 1.2, 'concrete'),
  B(-6, 17, 1.2, 1.2, 1.2, 'crate'), B(6, 17, 1.2, 1.2, 1.2, 'crate'),
  B(-10, 21, 1.2, 1.2, 1.2, 'crate'), B(10, 21, 1.2, 1.2, 1.2, 'crate'),
];

// Walkable ramp up to the crane deck: height rises linearly from z1 to z0.
const RAMPS = [
  { minX: -26, maxX: -20, zLow: 17, zHigh: 13.5, h: 4 },
];

// Waypoint graph for bot movement. Nodes are ground positions; edges are
// walkable links (ramps included). Node 8 is the crane deck, reached via 9.
const NODES = [
  [0, -20], [-14, -18], [14, -18], [0, -14], [-22, -16], [-26, -8],
  [-22, 0], [-22, 8], [-23, 10], [-23, 15], [-27, 12], [22, -16],
  [26, -8], [22, 0], [23, 4], [23, 10], [27, 12], [19, 13],
  [0, -8], [0, 0], [0, 5], [-11, 6], [11, 6], [0, 12],
  [-8, 18], [8, 18], [0, 20], [-18, 14], [18, 14], [0, 15],
  [-27, 6], [27, 8],
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 11], [3, 18], [4, 5], [5, 6],
  [6, 7], [6, 21], [7, 9], [9, 8], [7, 10], [7, 30], [10, 27], [30, 27],
  [11, 12], [12, 13], [13, 14], [13, 22], [14, 15], [15, 16], [15, 17],
  [15, 31], [16, 28], [17, 28], [31, 28], [18, 19], [19, 20], [19, 21],
  [19, 22], [20, 23], [21, 27], [22, 28], [23, 24], [23, 25], [23, 29],
  [24, 26], [25, 26], [24, 27], [25, 28], [27, 26], [28, 26], [29, 26],
  [29, 24], [29, 25],
];

const LAMPS = [
  { x: -12, z: -16, color: PALETTE.lamp, light: false },
  { x: 12, z: -16, color: PALETTE.lamp, light: false },
  { x: -24, z: 2, color: PALETTE.lamp, light: true },
  { x: 24, z: 2, color: PALETTE.lamp, light: false },
  { x: 0, z: 12, color: PALETTE.lampCool, light: true },
  { x: -23, z: 10, color: PALETTE.lampCool, light: false, deck: true },
];

export function buildMap(scene) {
  const mats = {
    red: new THREE.MeshLambertMaterial({ map: containerTexture('#8e3428', 11) }),
    teal: new THREE.MeshLambertMaterial({ map: containerTexture('#2a5f5e', 23) }),
    ochre: new THREE.MeshLambertMaterial({ map: containerTexture('#9c7423', 37) }),
    blue: new THREE.MeshLambertMaterial({ map: containerTexture('#2c4563', 51) }),
    concrete: new THREE.MeshLambertMaterial({ map: concreteTexture() }),
    metal: new THREE.MeshLambertMaterial({ map: metalTexture() }),
    crate: new THREE.MeshLambertMaterial({ map: containerTexture('#6e5230', 71) }),
    barrel: new THREE.MeshLambertMaterial({ color: 0x7a3030 }),
  };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const colliders = [];

  // Static boxes are merged per material: one draw call per material
  // instead of one per box. Collision volumes are recorded separately
  // (the same data drives both, so they can never drift apart).
  const byMat = new Map();
  for (const b of BOXES) {
    if (!byMat.has(b.mat)) byMat.set(b.mat, []);
    byMat.get(b.mat).push({
      geo: boxGeo,
      matrix: mat4(b.x, b.y0 + b.h / 2, b.z, 0, 0, 0, b.w, b.h, b.d),
    });
    colliders.push({
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
      y0: b.y0, y1: b.y0 + b.h,
    });
  }
  for (const [mat, parts] of byMat) scene.add(mergeParts(parts, mats[mat]));

  // Ground: one big wet asphalt plane.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 150),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Painted site letters on the ground.
  for (const [site, letter] of [['A', 'A'], ['B', 'B']]) {
    const s = MAP.sites[site];
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: letterTexture(letter), transparent: true, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(s.cx, 0.02, s.cz);
    scene.add(decal);
  }

  // Hazard strips at the site entrances.
  const hazardMat = new THREE.MeshLambertMaterial({ map: hazardTexture() });
  for (const [x, z, w] of [[-23, 0.5, 8], [23, 1.2, 6]]) {
    const strip = new THREE.Mesh(boxGeo, hazardMat);
    strip.scale.set(w, 0.06, 1);
    strip.position.set(x, 0.03, z);
    scene.add(strip);
  }

  // The crane: mast + jib merged (static), cab merged into the same metal
  // mesh family by colour, and a swaying hook kept separate (it animates).
  const craneMat = mats.metal;
  scene.add(mergeParts([
    { geo: boxGeo, matrix: mat4(-23, 6.5, 10, 0, 0, 0, 1.4, 13, 1.4) },
    { geo: boxGeo, matrix: mat4(-14, 12.4, 10, 0, 0, 0, 20, 0.9, 0.9) },
    { geo: boxGeo, matrix: mat4(-29.5, 12.4, 10, 0, 0, 0, 7, 0.9, 0.9) },
  ], craneMat));
  const cab = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x222a33 }));
  cab.scale.set(2.2, 1.8, 2); cab.position.set(-23, 10.6, 10);
  scene.add(cab);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6, 5), craneMat);
  cable.position.set(-8, 9.4, 10);
  scene.add(cable);
  const hook = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xd8a020 }));
  hook.scale.set(0.9, 0.9, 0.9); hook.position.set(-8, 6.2, 10);
  scene.add(hook);

  // Forklifts: body + mast + seat merged per lift (the whole lift is one
  // static pose, so per-part materials merge into two meshes per lift).
  const liftYellow = new THREE.MeshLambertMaterial({ color: 0xc78d1e });
  const liftDark = new THREE.MeshLambertMaterial({ color: 0x1c2128 });
  for (const [fx, fz, ry] of [[-5, -1, 0.4], [5, 1, Math.PI - 0.3]]) {
    const lift = new THREE.Group();
    const body = mergeParts([
      { geo: boxGeo, matrix: mat4(0, 0.6, 0, 0, 0, 0, 1.6, 0.9, 2.4) },
    ], liftYellow);
    const dark = mergeParts([
      { geo: boxGeo, matrix: mat4(0, 1.2, -1.25, 0, 0, 0, 1.4, 2.2, 0.25) },
      { geo: boxGeo, matrix: mat4(0, 1.25, 0.3, 0, 0, 0, 0.7, 0.7, 0.7) },
    ], liftDark);
    lift.add(body, dark);
    lift.position.set(fx, 0, fz); lift.rotation.y = ry;
    scene.add(lift);
    colliders.push({ minX: fx - 1, maxX: fx + 1, minZ: fz - 1.4, maxZ: fz + 1.4, y0: 0, y1: 1.6 });
  }

  // Lamp poles merged into one mesh; heads merged per colour. Real lights
  // stay on two lamps only (fragment cost scales with light count).
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2f36 });
  scene.add(mergeParts(LAMPS.map((lamp) => ({
    geo: poleGeo,
    matrix: mat4(lamp.x, lamp.deck ? 6.7 : 2.7, lamp.z),
  })), poleMat));
  const headGeo = new THREE.SphereGeometry(0.28, 10, 8);
  const headsByColor = new Map();
  for (const lamp of LAMPS) {
    if (!headsByColor.has(lamp.color)) headsByColor.set(lamp.color, []);
    headsByColor.get(lamp.color).push({
      geo: headGeo,
      matrix: mat4(lamp.x, lamp.deck ? 9.4 : 5.4, lamp.z),
    });
    if (lamp.light) {
      const light = new THREE.PointLight(lamp.color, 85, 30, 1.8);
      light.position.set(lamp.x, 5.2, lamp.z);
      scene.add(light);
    }
  }
  for (const [color, parts] of headsByColor) {
    scene.add(mergeParts(parts, new THREE.MeshBasicMaterial({ color })));
  }

  // Distant port skyline: dark slabs with lit windows, merged per texture.
  const skyMat = new THREE.MeshBasicMaterial({ map: skylineTexture(3) });
  const skyMat2 = new THREE.MeshBasicMaterial({ map: skylineTexture(9) });
  const skyline = [[-52, -30, 26, 18], [-8, -48, 34, 24], [40, -38, 28, 15], [56, 6, 20, 20], [44, 40, 30, 14], [-4, 52, 40, 20], [-54, 28, 24, 16], [58, -24, 18, 26]];
  const skyGroups = [[], []];
  skyline.forEach(([x, z, w, h], i) => {
    skyGroups[i % 2].push({ geo: boxGeo, matrix: mat4(x, h / 2 - 1, z, 0, 0, 0, w, h, 2) });
  });
  scene.add(mergeParts(skyGroups[0], skyMat));
  scene.add(mergeParts(skyGroups[1], skyMat2));

  // Stars: a thin shell of points high above the fog.
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(240 * 3);
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * Math.PI * 2 + (i % 7) * 0.37;
    const r = 55 + (i % 13) * 3;
    starPos[i * 3] = Math.cos(a) * r;
    starPos[i * 3 + 1] = 48 + (i % 19) * 1.7;
    starPos[i * 3 + 2] = Math.sin(a) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcdd8ea, size: 0.55, fog: false, transparent: true, opacity: 0.8 }));
  scene.add(stars);

  // --- Collision + queries (pure math, no three.js objects needed) ---

  // Highest walkable surface at (x, z) that feet at height feetY can step onto.
  function groundHeightAt(x, z, feetY) {
    let g = 0;
    for (const r of RAMPS) {
      if (x >= r.minX && x <= r.maxX && z >= r.zHigh && z <= r.zLow) {
        const t = (r.zLow - z) / (r.zLow - r.zHigh);
        const h = t * r.h;
        if (h <= feetY + 0.55 && h > g) g = h;
      }
    }
    // Deck slab top.
    if (x >= -27.5 && x <= -18.5 && z >= 6.5 && z <= 13.5 && 4 <= feetY + 0.55) g = Math.max(g, 4);
    return g;
  }

  // Push a vertical capsule (feet y, radius r, height h) out of every
  // collider whose vertical span overlaps the capsule's step zone.
  // Returns true if any push happened. Mutates pos {x, z}.
  function resolveCircle(pos, feetY, radius, height) {
    let pushed = false;
    const stepTop = feetY + 0.55;
    const headY = feetY + height;
    for (const c of colliders) {
      if (c.y1 <= stepTop || c.y0 >= headY) continue;
      const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      let dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 < 1e-9) {
        // Centre inside the box footprint: push out along the smallest exit.
        const exits = [
          [c.minX - radius - pos.x, 0], [c.maxX + radius - pos.x, 0],
          [0, c.minZ - radius - pos.z], [0, c.maxZ + radius - pos.z],
        ];
        exits.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        pos.x += exits[0][0]; pos.z += exits[0][1];
      } else {
        const d = Math.sqrt(d2);
        const push = radius - d;
        pos.x += (dx / d) * push; pos.z += (dz / d) * push;
      }
      pushed = true;
    }
    return pushed;
  }

  // Ray vs colliders + ground plane. Returns nearest distance or Infinity.
  function rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    if (dy < -1e-6 && oy > 0) {
      const t = -oy / dy;
      if (t < best) best = t;
    }
    for (const c of colliders) {
      let t0 = 0, t1 = best;
      // Slab test, axis by axis.
      let ok = true;
      const o = [ox, oy, oz], d = [dx, dy, dz];
      const mn = [c.minX, c.y0, c.minZ], mx = [c.maxX, c.y1, c.maxZ];
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < mn[a] || o[a] > mx[a]) { ok = false; break; }
        } else {
          let ta = (mn[a] - o[a]) / d[a], tb = (mx[a] - o[a]) / d[a];
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) { ok = false; break; }
        }
      }
      if (ok && t0 > 0.001 && t0 < best) best = t0;
    }
    return best;
  }

  // Line of sight between two points, optionally blocked by smoke spheres.
  function losBlocked(ax, ay, az, bx, by, bz, smokes) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    const wall = rayHit(ax, ay, az, dx / len, dy / len, dz / len, len);
    if (wall < len - 0.05) return true;
    if (smokes) {
      for (const s of smokes) {
        // Segment-sphere test: closest approach of the segment to the centre.
        const px = s.x - ax, py = s.y - ay, pz = s.z - az;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (len * len)));
        const cx = ax + dx * t - s.x, cy = ay + dy * t - s.y, cz = az + dz * t - s.z;
        if (cx * cx + cy * cy + cz * cz < s.radius * s.radius) return true;
      }
    }
    return false;
  }

  // Waypoint graph: adjacency + BFS shortest path.
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) { adjacency[a].push(b); adjacency[b].push(a); }

  function nearestNode(x, z) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < NODES.length; i++) {
      const dx = NODES[i][0] - x, dz = NODES[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  const _prev = new Int16Array(NODES.length);
  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ), goal = nearestNode(toX, toZ);
    if (start === goal) return [goal];
    _prev.fill(-1);
    const queue = [start];
    _prev[start] = start;
    while (queue.length) {
      const n = queue.shift();
      if (n === goal) break;
      for (const m of adjacency[n]) {
        if (_prev[m] === -1) { _prev[m] = n; queue.push(m); }
      }
    }
    if (_prev[goal] === -1) return [goal];
    const path = [];
    let n = goal;
    while (n !== start) { path.push(n); n = _prev[n]; }
    path.reverse();
    return path;
  }

  function updateMap(time) {
    // The crane hook sways almost imperceptibly in the wind.
    hook.position.x = -8 + Math.sin(time * 0.35) * 0.25;
    cable.position.x = -8 + Math.sin(time * 0.35) * 0.13;
    cable.rotation.z = Math.sin(time * 0.35) * 0.04;
  }

  return {
    colliders, groundHeightAt, resolveCircle, rayHit, losBlocked,
    nodes: NODES, nearestNode, findPath, updateMap,
  };
}
