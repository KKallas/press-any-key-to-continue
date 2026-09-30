// What stops things. Only physical barriers count: building footprints and
// posts (lamps, traffic lights, terminals). Sidewalks, lots, alleys and
// empty plots are open ground. Each kind of body gets its own map, with the
// barriers grown by that body's radius, so a car keeps its distance from a
// wall and a person can slip down an alley the car can't.

export function collisionMap(bounds, polygons, posts, radius, ppm) {
  const w = Math.ceil((bounds.maxX - bounds.minX) * ppm);
  const h = Math.ceil((bounds.maxZ - bounds.minZ) * ppm);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';
  g.lineWidth = radius * 2 * ppm;
  const X = (x) => (x - bounds.minX) * ppm;
  const Z = (z) => (z - bounds.minZ) * ppm;
  for (const poly of polygons) {
    g.beginPath();
    poly.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.closePath();
    g.fill();
    if (radius > 0) g.stroke();
  }
  for (const p of posts) {
    g.beginPath();
    g.arc(X(p.x), Z(p.z), (p.r + radius) * ppm, 0, Math.PI * 2);
    g.fill();
  }
  const data = g.getImageData(0, 0, w, h).data;
  const edge = radius + 0.5;
  return (x, z) => {
    if (x < bounds.minX + edge || x > bounds.maxX - edge || z < bounds.minZ + edge || z > bounds.maxZ - edge) return false;
    const px = Math.floor(X(x));
    const pz = Math.floor(Z(z));
    return data[(pz * w + px) * 4] < 128;
  };
}

// Moves a body from (x, z) by (dx, dz), sliding along whatever it hits.
// Returns the new position and whether it was blocked.
export function slide(free, x, z, dx, dz) {
  if (free(x + dx, z + dz)) return { x: x + dx, z: z + dz, hit: false };
  if (free(x + dx, z)) return { x: x + dx, z, hit: true };
  if (free(x, z + dz)) return { x, z: z + dz, hit: true };
  return { x, z, hit: true };
}
