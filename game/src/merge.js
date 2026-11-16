// Static geometry merging: several parts sharing one material become one
// draw call. Software rasterizers pay dearly per draw call, so the map's
// boxes and the fighters' bodies are merged here instead of drawn part by
// part. Parts are transformed by a matrix each, then concatenated; all
// parts must carry position + normal + uv (three.js primitives do).
import * as THREE from 'three';

export function mat4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return m;
}

export function mergeParts(parts, material) {
  let vCount = 0, iCount = 0;
  const geos = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    vCount += g.attributes.position.count;
    return g;
  });
  const position = new Float32Array(vCount * 3);
  const normal = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  let o = 0;
  for (const g of geos) {
    position.set(g.attributes.position.array, o * 3);
    normal.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geo, material);
  for (const g of geos) g.dispose();
  return mesh;
}
