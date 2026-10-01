// Underground parking. A handful of garages sit along the wider roads; a car
// headed for a building parks in the nearest one (or at the kerb, if none is
// close) and the driver walks the rest. The garage mouth is a dark ramp in the
// pavement; the car vanishes down it.
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
      const off = rd.width / 2 + 3.5; // just off the carriageway, in the pavement
      const side = r() < 0.5 ? 1 : -1;
      const d = L * (0.3 + 0.4 * r());
      const x = a[0] + ux * d + -uz * off * side;
      const z = a[1] + uz * d + ux * off * side;
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 70)) continue;
      sites.push({ id: `garage-${sites.length}`, x, z, heading: Math.atan2(uz, ux) });
    }
    if (sites.length >= count) break;
  }
  return sites;
}

// The ramp mouth: a dark recessed square with a faintly lit lip.
export function garageMesh(site) {
  const g = new THREE.Group();
  const ramp = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 8),
    new THREE.MeshStandardMaterial({ color: 0x04050a, roughness: 0.95, metalness: 0 }),
  );
  ramp.rotation.x = -Math.PI / 2;
  ramp.position.set(site.x, 0.04, site.z);
  g.add(ramp);
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1a1d22, emissive: new THREE.Color(0.06, 0.12, 0.2), emissiveIntensity: 0.6 }),
  );
  lip.position.set(site.x, 0.25, site.z - 4);
  g.add(lip);
  return g;
}
