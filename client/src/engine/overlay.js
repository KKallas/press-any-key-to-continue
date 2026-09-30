// The tactical overlay: partial wireframes drawn over the drone feed.
// It lives in its own scene and is drawn after the post chain, so it stays
// crisp on top of the degraded video, the way targeting graphics sit on
// real drone footage. Lines carry their own alpha (to fade out) and a
// running length (for dashes).

import * as THREE from 'three';

// Display-space green, written straight to the screen.
export const HUD_GREEN = new THREE.Color(0.55, 1.0, 0.66);

const material = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: HUD_GREEN },
    uOpacity: { value: 0.85 },
  },
  vertexShader: /* glsl */ `
    attribute float aAlpha;
    attribute float aDash;   // metres along the line; < 0 means solid
    varying float vAlpha;
    varying float vDash;
    void main() {
      vAlpha = aAlpha;
      vDash = aDash;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vAlpha;
    varying float vDash;
    void main() {
      if (vDash >= 0.0 && fract(vDash / 1.6) > 0.55) discard;
      gl_FragColor = vec4(uColor, vAlpha * uOpacity);
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});

// Collects line segments, then turns them into one LineSegments object.
class LineBuilder {
  constructor() {
    this.pos = [];
    this.alpha = [];
    this.dash = [];
  }

  // A segment from a to b, fading from alphaA to alphaB; dashed if asked.
  seg(a, b, alphaA = 1, alphaB = alphaA, dashed = false) {
    this.pos.push(...a, ...b);
    this.alpha.push(alphaA, alphaB);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    this.dash.push(dashed ? 0 : -1, dashed ? len : -1);
  }

  rect(x0, z0, x1, z1, y, alpha, dashed) {
    this.seg([x0, y, z0], [x1, y, z0], alpha, alpha, dashed);
    this.seg([x1, y, z0], [x1, y, z1], alpha, alpha, dashed);
    this.seg([x1, y, z1], [x0, y, z1], alpha, alpha, dashed);
    this.seg([x0, y, z1], [x0, y, z0], alpha, alpha, dashed);
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(this.alpha, 1));
    geo.setAttribute('aDash', new THREE.Float32BufferAttribute(this.dash, 1));
    const lines = new THREE.LineSegments(geo, material);
    lines.frustumCulled = false;
    return lines;
  }
}

// A building as the targeting system knows it: a firm roof outline, corner
// edges that fade out partway down the facade, and a dashed footprint.
export function buildingOutline({ x, z, w, d, h }) {
  const L = new LineBuilder();
  const top = h + 0.15;
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const z0 = z - d / 2;
  const z1 = z + d / 2;
  L.rect(x0, z0, x1, z1, top, 0.9, false);
  const fadeTo = top - Math.min(h * 0.55, 14);
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
    L.seg([cx, top, cz], [cx, fadeTo, cz], 0.75, 0.0);
  }
  L.rect(x0, z0, x1, z1, 0.2, 0.3, true);
  return L.build();
}

// Block outlines on the ground, dashed.
export function blockOutlines(roads, half) {
  const L = new LineBuilder();
  for (let i = 0; i < roads.length - 1; i++) {
    for (let j = 0; j < roads.length - 1; j++) {
      L.rect(roads[i] + half + 1, roads[j] + half + 1, roads[i + 1] - half - 1, roads[j + 1] - half - 1, 0.2, 0.45, true);
    }
  }
  return L.build();
}
