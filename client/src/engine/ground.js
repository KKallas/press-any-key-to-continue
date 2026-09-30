// The wet street. On mid and high tiers the road mirrors the scene through a
// low-resolution planar reflection, broken up by puddles and rain ripples.
// On the low tier it falls back to a glossy surface lit by the lamps.

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const WetStreetShader = {
  name: 'WetStreet',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tMarkings: { value: null },
    uTime: { value: 0 },
    uSize: { value: 140 },
    uRoad: { value: 5 },
    uReflect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUvProj;
    varying vec3 vWorld;
    void main() {
      vUvProj = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tMarkings;
    uniform float uTime, uSize, uRoad, uReflect;
    varying vec4 vUvProj;
    varying vec3 vWorld;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { return noise(p) * 0.6 + noise(p * 2.3) * 0.3 + noise(p * 5.1) * 0.1; }

    // Rings spreading from rain hits, one per grid cell, restarting at random times.
    vec2 ripples(vec2 p) {
      vec2 n = vec2(0.0);
      for (int k = 0; k < 2; k++) {
        vec2 q = p * (k == 0 ? 1.3 : 2.1) + float(k) * 17.0;
        vec2 cell = floor(q);
        for (int dx = -1; dx <= 1; dx++)
        for (int dy = -1; dy <= 1; dy++) {
          vec2 c = cell + vec2(dx, dy);
          float h = hash(c);
          vec2 center = c + vec2(hash(c + 3.1), hash(c + 7.7));
          float t = fract(uTime * (0.9 + h) + h * 9.0);
          vec2 d = q - center;
          float r = length(d);
          float w = sin((r - t * 0.9) * 38.0) * smoothstep(0.12, 0.0, abs(r - t * 0.9)) * (1.0 - t);
          n += (r > 0.0001 ? d / r : vec2(0.0)) * w;
        }
      }
      return n;
    }

    void main() {
      vec2 xz = vWorld.xz;
      float puddle = smoothstep(0.52, 0.68, fbm(xz * 0.16) + 0.25 * fbm(xz * 0.9));
      float grain = fbm(xz * 3.0);

      vec2 muv = xz / uSize + 0.5;
      float paint = texture2D(tMarkings, muv).r;

      vec3 asphalt = vec3(0.018, 0.020, 0.022) * (0.75 + 0.5 * grain);
      asphalt = mix(asphalt, vec3(0.30, 0.31, 0.30), paint * 0.85);

      vec3 refl = vec3(0.0);
      if (uReflect > 0.5) {
        vec2 rip = ripples(xz) * 0.012;
        vec2 wob = (vec2(noise(xz * 1.7 + uTime * 0.05), noise(xz * 1.7 - 3.0)) - 0.5) * 0.02;
        float rough = mix(0.022, 0.003, puddle);
        vec2 base = vUvProj.xy / vUvProj.w + rip + wob * (1.0 - puddle);
        // A few taps along the vertical: wet asphalt smears lights into streaks.
        refl += texture2D(tDiffuse, base).rgb * 0.30;
        refl += texture2D(tDiffuse, base + vec2(0.0, rough)).rgb * 0.22;
        refl += texture2D(tDiffuse, base - vec2(0.0, rough)).rgb * 0.22;
        refl += texture2D(tDiffuse, base + vec2(rough * 0.5, rough * 2.2)).rgb * 0.13;
        refl += texture2D(tDiffuse, base - vec2(rough * 0.5, rough * 2.2)).rgb * 0.13;
        float strength = mix(0.28, 0.95, puddle) * (1.0 - paint * 0.5);
        refl *= strength * color;
      }
      gl_FragColor = vec4(asphalt + refl, 1.0);
    }
  `,
};

export function createStreet({ size, roadWidth, markings }) {
  const group = new THREE.Group();
  group.name = 'street';
  const geo = new THREE.PlaneGeometry(size, size);

  const reflector = new Reflector(geo, {
    textureWidth: 512,
    textureHeight: 512,
    clipBias: 0.003,
    color: 0xb0b8bc,
    multisample: 0,
    shader: WetStreetShader,
  });
  reflector.rotation.x = -Math.PI / 2;
  const u = reflector.material.uniforms;
  u.tMarkings.value = markings;
  u.uSize.value = size;
  u.uRoad.value = roadWidth / 2;
  group.add(reflector);

  // Low-tier fallback: no mirror, just gloss that catches the lamps.
  const gloss = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0x9a9a9a,
      roughness: 0.28,
      metalness: 0.0,
      map: markings,
    }),
  );
  gloss.rotation.x = -Math.PI / 2;
  gloss.visible = false;
  group.add(gloss);

  return {
    group,
    update(time) {
      u.uTime.value = time;
    },
    // scale: fraction of the drawing buffer used for the reflection, or 0 for off.
    setReflection(scale, width, height) {
      const on = scale > 0;
      reflector.visible = on;
      gloss.visible = !on;
      if (on) {
        reflector.getRenderTarget().setSize(
          Math.max(64, Math.round(width * scale)),
          Math.max(64, Math.round(height * scale)),
        );
      }
    },
  };
}
