// Rain, drawn entirely on the GPU. Each streak falls in the vertex shader and
// lights up as it passes through a lamp's cone, which is what makes rain at
// night read as rain. Splashes on the ground use the same lighting.

import * as THREE from 'three';
import { rng } from './textures.js';

export const MAX_RAIN_LIGHTS = 8;

const lightingGLSL = /* glsl */ `
  uniform vec3 uLightPos[${MAX_RAIN_LIGHTS}];
  uniform vec3 uLightCol[${MAX_RAIN_LIGHTS}];
  uniform int uLightCount;
  vec3 rainLight(vec3 p) {
    vec3 c = vec3(0.020, 0.030, 0.034);
    for (int i = 0; i < ${MAX_RAIN_LIGHTS}; i++) {
      if (i >= uLightCount) break;
      vec3 d = p - uLightPos[i];
      float below = -d.y;
      float dh = length(d.xz);
      // A widening cone under the lamp, plus a small halo around it.
      float cone = smoothstep(below * 0.62 + 0.8, 0.0, dh) * smoothstep(-0.6, 0.4, below);
      float halo = 1.0 / (1.0 + dot(d, d) * 0.9);
      float fall = 1.0 / (1.0 + dot(d, d) * 0.025);
      c += uLightCol[i] * (cone * fall * 1.5 + halo * 0.6);
    }
    return c;
  }
`;

function lightUniforms() {
  return {
    uLightPos: { value: Array.from({ length: MAX_RAIN_LIGHTS }, () => new THREE.Vector3()) },
    uLightCol: { value: Array.from({ length: MAX_RAIN_LIGHTS }, () => new THREE.Vector3()) },
    uLightCount: { value: 0 },
  };
}

export class Rain {
  constructor({ center = [0, 0, 0], area = [70, 70], height = 32, wind = [0.2, 0, 0.06], seed = 3 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'rain';
    this.params = { center, area, height, wind, seed };
    this.lights = [];
    this.streaks = null;
    this.splashes = null;
    this.setDensity(9000);
  }

  setLights(lights) {
    this.lights = lights.slice(0, MAX_RAIN_LIGHTS);
    for (const mat of [this.streaks?.material, this.splashes?.material]) {
      if (mat) this.applyLights(mat);
    }
  }

  applyLights(mat) {
    const u = mat.uniforms;
    u.uLightCount.value = this.lights.length;
    this.lights.forEach((l, i) => {
      u.uLightPos.value[i].copy(l.position);
      u.uLightCol.value[i].set(l.color.r * l.strength, l.color.g * l.strength, l.color.b * l.strength);
    });
  }

  setDensity(count) {
    if (this.count === count) return;
    this.count = count;
    for (const obj of [this.streaks, this.splashes]) {
      if (obj) {
        this.group.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
      }
    }
    this.streaks = this.buildStreaks(count);
    this.splashes = this.buildSplashes(Math.round(count * 0.18));
    this.group.add(this.streaks, this.splashes);
    this.setLights(this.lights);
  }

  buildStreaks(count) {
    const { center, area, height, wind, seed } = this.params;
    const r = rng(seed);
    const seeds = new Float32Array(count * 2 * 4);
    const ends = new Float32Array(count * 2);
    const pos = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const s = [r() - 0.5, r() - 0.5, r() * height, r()];
      for (let e = 0; e < 2; e++) {
        seeds.set(s, (i * 2 + e) * 4);
        ends[i * 2 + e] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3(...center) },
        uArea: { value: new THREE.Vector2(...area) },
        uHeight: { value: height },
        uWind: { value: new THREE.Vector3(...wind) },
        ...lightUniforms(),
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uHeight;
        uniform vec3 uCenter, uWind;
        uniform vec2 uArea;
        attribute vec4 aSeed;
        attribute float aEnd;
        varying vec3 vCol;
        varying float vEnd;
        ${lightingGLSL}
        void main() {
          float speed = 17.0 + 7.0 * aSeed.w;
          float y = mod(aSeed.z - uTime * speed, uHeight);
          vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.z));
          vec3 p = vec3(uCenter.x + aSeed.x * uArea.x, y, uCenter.z + aSeed.y * uArea.y);
          p -= dir * aEnd * (0.55 + 0.5 * aSeed.w);
          vCol = rainLight(p) * (0.6 + 0.8 * aSeed.w);
          vEnd = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        varying float vEnd;
        void main() {
          gl_FragColor = vec4(vCol * mix(1.0, 0.1, vEnd), 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 10;
    return lines;
  }

  buildSplashes(count) {
    const { center, area, seed } = this.params;
    const r = rng(seed + 101);
    const seeds = new Float32Array(count * 4);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) seeds.set([r() - 0.5, r() - 0.5, r(), r()], i * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3(...center) },
        uArea: { value: new THREE.Vector2(area[0] * 0.8, area[1] * 0.8) },
        uScale: { value: 400 },
        ...lightUniforms(),
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uScale;
        uniform vec3 uCenter;
        uniform vec2 uArea;
        attribute vec4 aSeed;
        varying vec3 vCol;
        varying float vPhase;
        ${lightingGLSL}
        void main() {
          float cycle = uTime * (1.6 + aSeed.w) + aSeed.z * 10.0;
          float k = floor(cycle);
          vPhase = fract(cycle);
          // Jump to a new spot every cycle.
          vec2 j = fract(vec2(sin(k * 12.9898 + aSeed.x * 78.2), sin(k * 39.346 + aSeed.y * 11.1)) * 43758.5453) - 0.5;
          vec3 p = vec3(uCenter.x + (aSeed.x + j.x * 0.2) * uArea.x, 0.03, uCenter.z + (aSeed.y + j.y * 0.2) * uArea.y);
          vCol = rainLight(p + vec3(0.0, 0.1, 0.0));
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_PointSize = uScale * (0.18 + 0.2 * aSeed.w) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        varying float vPhase;
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          q.y *= 1.8; // flattened ring, seen from above at an angle
          float r = length(q);
          float ring = smoothstep(0.16, 0.0, abs(r - vPhase)) * (1.0 - vPhase);
          if (ring < 0.01) discard;
          gl_FragColor = vec4(vCol * ring * 1.6, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 9;
    return pts;
  }

  update(time, viewportHeight) {
    this.streaks.material.uniforms.uTime.value = time;
    this.splashes.material.uniforms.uTime.value = time;
    this.splashes.material.uniforms.uScale.value = viewportHeight * 0.9;
  }
}
