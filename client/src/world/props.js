// Street furniture: the small things that make a place read as lived in
// from a drone. Trees in the parks and along the sidewalks, trash cans by
// the doors, manhole covers in the road, puddles on the paving, and shop
// signs over the street doors. Everything of a kind is one instanced or
// merged mesh, so a whole city of clutter is a handful of draw calls.
//
// Trees and trash cans are physical: they're returned as posts, and the
// collision maps are built after them.

import * as THREE from 'three';
import { rng } from '../engine/textures.js';

const SIGN_WORDS = [
  ['HOTEL', '#ff3fb0'], ['BAR', '#ff5a2a'], ['PAWN', '#ffc23a'], ['24H', '#40e0ff'], ['TV REPAIR', '#7dff7a'],
  ['CAFE', '#ffb347'], ['LIQUOR', '#ff3040'], ['ROOMS', '#ff66cc'], ['DINER', '#4fd8ff'], ['MOTEL', '#ff4f8b'],
  ['NO VACANCY', '#ff2d2d'], ['OPEN', '#ff4040'], ['JAZZ', '#b980ff'], ['VIDEO', '#48ffd2'], ['PHONE', '#ffe45c'],
  ['AI!', '#ff3fb0'], ['KUS ON SUVALINE KLAHV?', '#40e0ff'], ['MODEMS', '#7dff7a'], ['DISKS', '#ffc23a'], ['LAUNDRY', '#4fd8ff'],
];

function insidePoly([x, z], pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// One canvas of glowing words; each sign shows one row of it.
function signAtlas() {
  const W = 512;
  const rowH = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = rowH * SIGN_WORDS.length;
  const g = c.getContext('2d');
  g.fillStyle = '#07080a';
  g.fillRect(0, 0, c.width, c.height);
  SIGN_WORDS.forEach(([word, col], i) => {
    const y = i * rowH;
    g.strokeStyle = col;
    g.globalAlpha = 0.5;
    g.lineWidth = 3;
    g.strokeRect(6, y + 6, W - 12, rowH - 12);
    g.globalAlpha = 1;
    g.fillStyle = col;
    let size = 44;
    g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
    while (g.measureText(word).width > W - 40 && size > 12) g.font = `bold ${--size}px "Arial Narrow", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = col;
    g.shadowBlur = 12;
    g.fillText(word, W / 2, y + rowH / 2 + 2);
    g.shadowBlur = 0;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A puddle: a flat blob with a ragged edge.
function blobGeometry(seed) {
  const r = rng(seed);
  const shape = new THREE.Shape();
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 0.7 + r() * 0.3;
    const p = [Math.cos(a) * rad, Math.sin(a) * rad * (0.55 + r() * 0.15)];
    if (i) shape.lineTo(p[0], p[1]);
    else shape.moveTo(p[0], p[1]);
  }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

// city: { bounds, blocks (polygons), roads (centre lines), doors, green(x,z),
// greens (patches), surface(x,z), footprints }
export function buildProps(city, seed = 1999) {
  const r = rng(seed);
  const group = new THREE.Group();
  group.name = 'props';
  const posts = [];
  const taken = []; // [x, z, radius] of everything placed, to keep things apart
  const clear = (x, z, rad) => taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + rad);
  const inBuilding = (x, z) => city.footprints.some((fp) => insidePoly([x, z], fp));
  const onSidewalk = (x, z) => !city.surface(x, z) && city.blocks.some((b) => insidePoly([x, z], b));
  for (const d of city.doors) taken.push([d.hx, d.hz, 1.6]);
  for (const l of city.lamps) taken.push([l.x, l.z, 1.2]);

  // ---- Trees: scattered through the parks, and in rows along the sidewalks.
  const trees = [];
  for (const patch of city.greens.patches) {
    const cells = [...patch];
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const want = Math.max(1, Math.floor(cells.length / 55));
    let placed = 0;
    for (const [x, z] of cells) {
      if (placed >= want) break;
      const ok = [[2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dz]) => city.green(x + dx, z + dz));
      if (!ok || !clear(x, z, 3.5)) continue;
      trees.push([x, z, 0.8 + r() * 0.5]);
      taken.push([x, z, 3.5]);
      placed++;
    }
  }
  for (const road of city.roads) {
    if (road.width < 9) continue;
    const pts = road.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      const ux = (x1 - x0) / L;
      const uz = (z1 - z0) / L;
      for (let d = 9 + r() * 8; d < L - 6; d += 16 + r() * 10) {
        for (const side of [-1, 1]) {
          if (r() < 0.45) continue;
          const off = road.width / 2 + 1.7;
          const x = x0 + ux * d - uz * off * side;
          const z = z0 + uz * d + ux * off * side;
          if (!onSidewalk(x, z) || inBuilding(x, z) || !clear(x, z, 2.2)) continue;
          trees.push([x, z, 0.65 + r() * 0.3]);
          taken.push([x, z, 2.2]);
        }
      }
    }
  }
  if (trees.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x1c1510, roughness: 0.9 }), trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x1d3320, roughness: 0.85, flatShading: true }), trees.length * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    let k = 0;
    trees.forEach(([x, z, s], i) => {
      const h = 3.2 * s;
      m.compose(new THREE.Vector3(x, 0.16, z), q, new THREE.Vector3(s, h, s));
      trunks.setMatrixAt(i, m);
      for (let c = 0; c < 3; c++) {
        const a = r() * Math.PI * 2;
        const rad = (0.5 + r() * 0.6) * s;
        e.set(r(), r() * 3, r());
        q.setFromEuler(e);
        const cs = (1.5 + r() * 0.9) * s;
        m.compose(new THREE.Vector3(x + Math.cos(a) * rad, 0.16 + h + (r() - 0.2) * 1.2 * s, z + Math.sin(a) * rad), q, new THREE.Vector3(cs, cs * 0.8, cs));
        crowns.setMatrixAt(k++, m);
      }
      q.identity();
      posts.push({ x, z, r: 0.3 });
    });
    crowns.count = k;
    group.add(trunks, crowns);
  }

  // ---- Trash cans: beside some of the street doors, and here and there.
  const cans = [];
  for (const d of city.doors) {
    if (d.kind !== 'street' || r() < 0.45) continue;
    const side = r() < 0.5 ? -1 : 1;
    const x = d.x + d.nx * 0.9 + -d.nz * 2.1 * side;
    const z = d.z + d.nz * 0.9 + d.nx * 2.1 * side;
    if (!onSidewalk(x, z) || inBuilding(x, z)) continue;
    cans.push([x, z, r()]);
    posts.push({ x, z, r: 0.32 });
  }
  if (cans.length) {
    const body = new THREE.CylinderGeometry(0.3, 0.27, 0.95, 10);
    body.translate(0, 0.475, 0);
    const lid = new THREE.CylinderGeometry(0.33, 0.33, 0.06, 10);
    lid.translate(0, 0.98, 0);
    const bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0x1b2420, roughness: 0.5, metalness: 0.4 }), cans.length);
    const lids = new THREE.InstancedMesh(lid, new THREE.MeshStandardMaterial({ color: 0x101312, roughness: 0.4, metalness: 0.6 }), cans.length);
    const m = new THREE.Matrix4();
    cans.forEach(([x, z, t], i) => {
      m.makeRotationY(t * 6);
      m.setPosition(x, 0.15, z);
      bodies.setMatrixAt(i, m);
      // Some lids knocked askew.
      const tilt = new THREE.Matrix4().makeRotationZ(t < 0.25 ? 0.5 : 0);
      lids.setMatrixAt(i, m.clone().multiply(tilt));
    });
    group.add(bodies, lids);
  }

  // ---- Manhole covers, in the road.
  const holes = [];
  for (const road of city.roads) {
    const pts = road.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 10 + r() * 20; d < L - 5; d += 28 + r() * 25) {
        const off = (r() - 0.5) * road.width * 0.5;
        const ux = (x1 - x0) / L;
        const uz = (z1 - z0) / L;
        holes.push([x0 + ux * d - uz * off, z0 + uz * d + ux * off]);
      }
    }
  }
  if (holes.length) {
    const geo = new THREE.CircleGeometry(0.42, 16);
    geo.rotateX(-Math.PI / 2);
    const lids = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x0d0e0f, roughness: 0.35, metalness: 0.8 }), holes.length);
    const ring = new THREE.RingGeometry(0.42, 0.5, 16);
    ring.rotateX(-Math.PI / 2);
    const rings = new THREE.InstancedMesh(ring, new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.6 }), holes.length);
    const m = new THREE.Matrix4();
    holes.forEach(([x, z], i) => {
      m.makeTranslation(x, 0.012, z);
      lids.setMatrixAt(i, m);
      rings.setMatrixAt(i, m);
    });
    group.add(lids, rings);
  }

  // ---- Puddles on the paving and in the yards: black mirrors for the lamps.
  const puddles = [];
  const b = city.bounds;
  for (let t = 0; t < 2600 && puddles.length < 260; t++) {
    const x = b.minX + r() * (b.maxX - b.minX);
    const z = b.minZ + r() * (b.maxZ - b.minZ);
    if (city.surface(x, z) || city.green(x, z) || inBuilding(x, z)) continue;
    if (!city.blocks.some((bl) => insidePoly([x, z], bl))) continue;
    puddles.push([x, z, 0.6 + r() * 1.6, r() * Math.PI]);
  }
  if (puddles.length) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x030405, roughness: 0.05, metalness: 0.0 });
    const kinds = [blobGeometry(3), blobGeometry(17), blobGeometry(29)];
    kinds.forEach((geo, kIdx) => {
      const mine = puddles.filter((_, i) => i % kinds.length === kIdx);
      const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
      const m = new THREE.Matrix4();
      mine.forEach(([x, z, s, a], i) => {
        m.makeRotationY(a);
        m.scale(new THREE.Vector3(s, 1, s));
        m.setPosition(x, 0.172, z);
        mesh.setMatrixAt(i, m);
      });
      group.add(mesh);
    });
  }

  // ---- Shop signs over the street doors, and blade signs out from the wall.
  const atlas = signAtlas();
  const pos = [];
  const uv = [];
  const quad = (c, ax, ay, v0, v1) => {
    // c: centre [x, y, z]; ax, ay: half-extent vectors along the sign's width and height.
    const P = (sx, sy) => [c[0] + ax[0] * sx + ay[0] * sy, c[1] + ax[1] * sx + ay[1] * sy, c[2] + ax[2] * sx + ay[2] * sy];
    const corners = [P(-1, -1), P(1, -1), P(1, 1), P(-1, -1), P(1, 1), P(-1, 1)];
    const uvs = [[0, v0], [1, v0], [1, v1], [0, v0], [1, v1], [0, v1]];
    corners.forEach((p) => pos.push(...p));
    uvs.forEach((t) => uv.push(...t));
  };
  const rows = SIGN_WORDS.length;
  for (const d of city.doors) {
    if (d.kind !== 'street' || r() < 0.55) continue;
    const row = Math.floor(r() * rows);
    const v1 = 1 - row / rows;
    const v0 = 1 - (row + 1) / rows;
    const tx = -d.nz;
    const tz = d.nx; // along the wall
    if (r() < 0.8) {
      // A marquee over the door, leaning out from the wall so the words
      // face up at the sky as much as at the street.
      const w = 1.6 + r() * 0.8;
      const lean = 0.95; // radians from vertical
      const h = 0.4;
      const ay = [d.nx * h * Math.sin(lean), h * Math.cos(lean), d.nz * h * Math.sin(lean)];
      quad([d.x + d.nx * (0.1 + h * Math.sin(lean)), 3.4 + r() * 0.5, d.z + d.nz * (0.1 + h * Math.sin(lean))], [-tx * w, 0, -tz * w], ay, v0, v1);
    } else {
      // A blade sign sticking out, words running down it: seen from above
      // it's a bright stroke off the facade.
      const along = r() < 0.5 ? -1.4 : 1.4;
      const cx = d.x + tx * along + d.nx * 0.9;
      const cz = d.z + tz * along + d.nz * 0.9;
      quad([cx, 5.2 + r() * 2, cz], [0, 1.4, 0], [d.nx * 0.33, 0, d.nz * 0.33], v0, v1);
    }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    const signs = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: atlas, side: THREE.DoubleSide, color: new THREE.Color(2.4, 2.4, 2.4) }));
    signs.name = 'signs';
    group.add(signs);
  }

  return { group, posts, counts: { trees: trees.length, cans: cans.length, manholes: holes.length, puddles: puddles.length, signs: pos.length / 18 } };
}
