// Ghosts: the frontier where the city grows.
//
// Out toward the edge of the map, in the margin beyond the built blocks, sit a
// handful of ghost sites — a lot where a building could stand, a stub where a
// road could run. A ghost is only a potential: it shimmers in and out, there
// and then not. Catch one while it's there, click it, and you're at the same
// utility terminal — but the id you're forging is a *new* object. Send a bundle
// back for it and next time the area loads it's no longer a ghost: it's ground.
//
// The sites are deterministic (seeded from the map), so a ghost's id is stable:
// the bundle you forge for ghost-bld-3 becomes the real building at ghost-bld-3
// every reload after. That stability is the whole trick — it's how a sign you
// leave at the edge stays put.

import * as THREE from 'three';
import { rng } from '../engine/textures.js';

function bbox(fp) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of fp) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, z); d = Math.max(d, z); }
  return { x: (a + c) / 2, z: (b + d) / 2, w: c - a, d: d - b };
}

// A flat strip quad between two points, lying on the ground at height y.
function stripGeometry(a, b, width, y = 0.12) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || 1;
  const nx = (-dz / L) * (width / 2), nz = (dx / L) * (width / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    a[0] - nx, y, a[1] - nz, a[0] + nx, y, a[1] + nz,
    b[0] + nx, y, b[1] + nz, b[0] - nx, y, b[1] - nz,
  ], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

// A ghost building: a shimmering wireframe box standing on the empty lot.
export function ghostBuildingMesh(site) {
  const { x, z, w, d } = bbox(site.footprint);
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, site.height, d));
  const mat = new THREE.LineBasicMaterial({ color: 0x6dff8e, transparent: true, opacity: 0.3, depthWrite: false });
  const line = new THREE.LineSegments(edges, mat);
  line.position.set(x, site.height / 2, z);
  return line;
}

// A ghost road: a faint translucent strip where a road could run.
export function ghostRoadMesh(site) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x6dff8e, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
  return new THREE.Mesh(stripGeometry(site.points[0], site.points[1], site.width), mat);
}

// A forged road, made real: a dark asphalt strip with a dashed centre line.
export function forgedRoadMesh(site, rec) {
  const group = new THREE.Group();
  const col = rec?.params?.color ? new THREE.Color(rec.params.color) : new THREE.Color(0x14161a);
  group.add(new THREE.Mesh(stripGeometry(site.points[0], site.points[1], site.width, 0.06), new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 })));
  const line = new THREE.Mesh(stripGeometry(site.points[0], site.points[1], 0.3, 0.08), new THREE.MeshBasicMaterial({ color: 0xd9d4c2 }));
  group.add(line);
  return group;
}

// A ring of ghost sites around the city's edge: some lots, some road stubs.
// bounds: { minX, maxX, minZ, maxZ }.
export function ghostSites(bounds, seed = 99) {
  const r = rng(seed);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const span = Math.min(bounds.maxX - cx, bounds.maxZ - cz, cx - bounds.minX, cz - bounds.minZ);
  const R = span * 0.86; // out near the edge, still inside the world
  const sites = [];
  const N = 7;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2 + r() * 0.3;
    const x = cx + Math.cos(ang) * R;
    const z = cz + Math.sin(ang) * R;
    if (i % 3 === 2) {
      // A road stub, running radially outward.
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const L = 30 + r() * 24;
      sites.push({
        id: `ghost-road-${i}`,
        type: 'road',
        points: [[x, z], [x + dx * L, z + dz * L]],
        width: 12,
        phase: r() * Math.PI * 2,
      });
    } else {
      // A building lot: an axis-aligned rectangle.
      const w = 14 + r() * 8;
      const d = 12 + r() * 8;
      const fp = [
        [x - w / 2, z - d / 2], [x + w / 2, z - d / 2],
        [x + w / 2, z + d / 2], [x - w / 2, z + d / 2],
      ];
      sites.push({
        id: `ghost-bld-${i}`,
        type: 'building',
        footprint: fp,
        height: 18 + Math.round(r() * 20),
        phase: r() * Math.PI * 2,
      });
    }
  }
  return sites;
}
