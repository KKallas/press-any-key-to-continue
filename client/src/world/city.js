// A generated city (city.json from tools/citygen) turned into the same kind
// of event log the server sends for anything else. The server would do this
// once per city; clients only ever see the events.

const B = 'CITY';

// Lamps along the roads: every so often, alternating sides, on the kerb.
function placeLamps(city, maxLamps, realLights, start) {
  const lamps = [];
  const spacing = 38;
  for (const road of city.roads) {
    if (road.width < 8) continue;
    const pts = road.points;
    let carry = spacing / 2;
    let side = 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      const ux = (x1 - x0) / L;
      const uz = (z1 - z0) / L;
      for (let d = carry; d < L; d += spacing) {
        const off = road.width / 2 + 1.1;
        const x = x0 + ux * d + -uz * off * side;
        const z = z0 + uz * d + ux * off * side;
        if (!lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 14)) {
          lamps.push({ x, z, arm: [uz * side, -ux * side] });
        }
        side = -side;
      }
      carry = (carry - L) % spacing;
      if (carry < 0) carry += spacing;
    }
  }
  // Keep the ones nearest the start; the nearest few cast real light.
  lamps.sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z));
  return lamps.slice(0, maxLamps).map((l, i) => ({
    t: 0, block: B, type: 'spawn', kind: 'lamp', id: `lamp${i + 1}`,
    props: { x: l.x, z: l.z, arm: l.arm, height: 7, color: '#ff9a3c', intensity: i < realLights ? 260 : 0 },
  }));
}

// Where the car starts: the middle of the biggest road.
function startPoint(city) {
  const road = [...city.roads].sort((a, b) => b.width - a.width || b.points.length - a.points.length)[0];
  const pts = road.points;
  const i = Math.max(0, Math.floor(pts.length / 2) - 1);
  const [x0, z0] = pts[i];
  const [x1, z1] = pts[i + 1];
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, heading: Math.atan2(-(z1 - z0), x1 - x0) };
}

export function cityToEvents(city) {
  const start = startPoint(city);
  const events = [
    { t: 0, block: B, type: 'spawn', kind: 'city-base', id: 'base',
      props: { bounds: city.bounds, sidewalk: city.sidewalk, roads: city.roads, blocks: city.blocks, seed: 7 } },
    { t: 0, block: B, type: 'spawn', kind: 'weather', id: 'weather',
      props: { rain: 1.0, wind: [0.2, 0, 0.06], fog: 0.013 } },
  ];
  // Buildings, one event per block so a block can be regenerated on its own.
  const byBlock = new Map();
  for (const p of city.plots) {
    if (!p.height) continue;
    if (!byBlock.has(p.block)) byBlock.set(p.block, []);
    byBlock.get(p.block).push({ id: p.id, footprint: p.footprint, height: p.height, seed: p.seed, prompt: p.prompt,
      style: p.style, doors: p.doors ?? [] });
  }
  for (const [block, plots] of byBlock) {
    events.push({ t: 0, block: B, type: 'spawn', kind: 'deco-block', id: `bld-${block}`, props: { block, plots } });
  }
  events.push(...placeLamps(city, 40, 6, start));
  events.push({ t: 0, block: B, type: 'spawn', kind: 'car', id: 'car1',
    props: { x: start.x, z: start.z, heading: start.heading, color: '#b3121a', lights: true } });
  events.push({ t: 0, block: B, type: 'spawn', kind: 'drone', id: 'UAV-2',
    props: {
      name: 'UAV-2',
      description: `EO NIGHT · ${(city.name || 'CITY').toUpperCase()}`,
      target: [start.x, 0, start.z],
      altitude: 78, elevation: 84, fov: 44, orbitSpeed: 0.012, climbPerSpeed: 2.2, fog: 0.0032,
      lens: { barrel: 0.0, dirt: 0.15, noise: 0.3, aberration: 0.0008, drops: 0, crack: false, seed: 2,
        lines: 480, fps: 25, compression: 0.9, glitch: 0.35 },
    } });
  return { block: B, events };
}
