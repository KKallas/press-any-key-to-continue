// What the targeting system knows about the city, as plain 3D line
// segments. The HUD projects them onto the drone's picture every frame and
// draws them into the video signal, so they degrade with it.
//
// A segment: { a: [x,y,z], b: [x,y,z], alphaA, alphaB, dashed }

function rect(out, x0, z0, x1, z1, y, alpha, dashed) {
  const s = (a, b) => out.push({ a, b, alphaA: alpha, alphaB: alpha, dashed });
  s([x0, y, z0], [x1, y, z0]);
  s([x1, y, z0], [x1, y, z1]);
  s([x1, y, z1], [x0, y, z1]);
  s([x0, y, z1], [x0, y, z0]);
}

// A building: a firm roof outline, and corner edges that fade out partway
// down the facade.
export function buildingOutline({ x, z, w, d, h }) {
  const out = [];
  const top = h + 0.15;
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const z0 = z - d / 2;
  const z1 = z + d / 2;
  rect(out, x0, z0, x1, z1, top, 0.95, false);
  const fadeTo = top - Math.min(h * 0.55, 14);
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
    out.push({ a: [cx, top, cz], b: [cx, fadeTo, cz], alphaA: 0.8, alphaB: 0, dashed: false });
  }
  return out;
}

// Dashed outlines around each block, on the ground.
export function blockOutlines(roads, half) {
  const out = [];
  for (let i = 0; i < roads.length - 1; i++) {
    for (let j = 0; j < roads.length - 1; j++) {
      rect(out, roads[i] + half + 1, roads[j] + half + 1, roads[i + 1] - half - 1, roads[j + 1] - half - 1, 0.2, 0.5, true);
    }
  }
  return out;
}
