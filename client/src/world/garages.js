// Underground parking. A handful of garages sit along the wider roads, each
// with a short driveway in off the carriageway and a roll-up door; the car
// drives in, the door is its mouth, and it vanishes below. A car headed for a
// building parks in the nearest one (or at the kerb, if none is close) and the
// driver walks the rest.
//
// Sites are deterministic from the map, so a garage is always in the same place.

import * as THREE from 'three';
import { rng } from '../engine/textures.js';

export function garageSites(bounds, roads, seed = 55, count = 10) {
  const r = rng(seed);
  const sites = [];
  for (const rd of roads) {
    if (rd.width < 12) continue;
    const pts = rd.points;
    for (let i = 0; i < pts.length - 1 && sites.length < count; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 26) continue;
      const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      const side = r() < 0.5 ? 1 : -1;
      const inx = -uz * side, inz = ux * side; // unit, points from road toward the garage
      const off = rd.width / 2 + 4; // the door sits this far off the road centre
      const d = L * (0.3 + 0.4 * r());
      const x = a[0] + ux * d + inx * off;
      const z = a[1] + uz * d + inz * off;
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 70)) continue;
      // heading: along the road; inx/inz: from road to door, so the door faces back
      sites.push({ id: `garage-${sites.length}`, x, z, heading: Math.atan2(uz, ux), inx, inz, roadOff: off });
    }
    if (sites.length >= count) break;
  }
  return sites;
}

// A quad strip between two ground points.
function strip(ax, az, bx, bz, width, y, mat) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
  const nx = (-dz / L) * (width / 2), nz = (dx / L) * (width / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    ax - nx, y, az - nz, ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz,
  ], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// The entrance: a driveway in off the road, a dark opening, and a roll-up door
// with a lit lintel over it.
export function garageMesh(site) {
  const grp = new THREE.Group();
  const { x, z, inx, inz } = site;
  // Driveway from the road edge up to the door.
  const roadX = x - inx * (site.roadOff - 1), roadZ = z - inz * (site.roadOff - 1);
  grp.add(strip(roadX, roadZ, x + inx * 3, z + inz * 3, 6, 0.05, new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.9 })));
  // The dark opening the car sinks into.
  grp.add(strip(x - inx * 1, z - inz * 1, x + inx * 5, z + inz * 5, 5.2, 0.06, new THREE.MeshStandardMaterial({ color: 0x010203, roughness: 1 })));
  // The roll-up door, a slatted box facing the road, with a lit lintel.
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 3, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.4 }),
  );
  door.position.set(x + inx * 4.5, 1.5, z + inz * 4.5);
  door.lookAt(door.position.x - inx, 1.5, door.position.z - inz);
  grp.add(door);
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, 0.5, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x15171b, emissive: new THREE.Color(0.1, 0.16, 0.26), emissiveIntensity: 0.8 }),
  );
  lintel.position.set(x + inx * 4.3, 3.1, z + inz * 4.3);
  lintel.lookAt(lintel.position.x - inx, 3.1, lintel.position.z - inz);
  grp.add(lintel);
  return grp;
}
