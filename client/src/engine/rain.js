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

  // Rain only falls where someone is looking.
  setCenter(x, z) {
    this.streaks.material.uniforms.uCenter.value.set(x, 0, z);
    this.splashes.material.uniforms.uCenter.value.set(x, 0, z);
  }

  update(time, viewportHeight) {
    this.streaks.material.uniforms.uTime.value = time;
    this.splashes.material.uniforms.uTime.value = time;
    this.splashes.material.uniforms.uScale.value = viewportHeight * 0.9;
  }
}

// Rain that starts at the drone. Drops fall straight down past the lens:
// close to it they are big soft out-of-focus blobs, streaked towards the
// centre of the picture as they fall away, shrinking to specks over the
// street. Lives on its own layer so the wet-street mirror doesn't see it.
export const LENS_RAIN_LAYER = 1;

export class LensRain {
  constructor({ count = 900, depth = 70, seed = 77 } = {}) {
    const r = rng(seed);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) seeds.set([r(), r(), r(), r()], i * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uReach: { value: 0.5 }, // tan of half the field of view, widened for aspect
        uDepth: { value: depth },
        uScale: { value: 800 },
        uAmount: { value: 1 },
        uWind: { value: new THREE.Vector2(0.2, 0.06) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uReach, uDepth, uScale, uAmount;
        uniform vec3 uCam;
        uniform vec2 uWind;
        attribute vec4 aSeed;
        varying vec2 vDir;
        varying float vStreak;
        varying float vAlpha;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          // Thin the drops out as the amount goes down.
          if (aSeed.w > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          float speed = 10.0 + 6.0 * aSeed.w;
          // Some drops only fall the first few metres under the lens (the
          // big ones), the rest all the way down: a drop spends so little
          // time near the lens that otherwise you would hardly ever see one.
          float D = mix(5.0, uDepth, aSeed.y * aSeed.y);
          float run = aSeed.z * D + uTime * speed;
          float cycle = floor(run / D);
          float fall = mod(run, D);                      // metres fallen since the top
          // Each fall starts at a new spot across what the lens can see.
          float sx = hash(cycle * 17.1 + aSeed.x * 91.7) * 2.0 - 1.0;
          float sz = hash(cycle * 31.7 + aSeed.y * 53.3) * 2.0 - 1.0;
          float spread = uReach * D * 0.7;
          vec3 p = vec3(uCam.x + sx * spread + uWind.x * fall,
                        uCam.y + 2.0 - fall,
                        uCam.z + sz * spread + uWind.y * fall);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          if (d < 0.15) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          gl_Position = projectionMatrix * mv;
          // Out of focus near the lens: bigger, fainter; a speck far away.
          float size = uScale * (0.075 / d + 0.0015);
          gl_PointSize = min(size, 180.0);
          vAlpha = clamp(0.9 / (1.0 + d * 0.08), 0.05, 0.9) * (size > 180.0 ? 180.0 / size : 1.0);
          vec2 ndc = gl_Position.xy / gl_Position.w;
          vDir = length(ndc) > 0.001 ? normalize(ndc) : vec2(0.0, 1.0);
          vStreak = clamp(10.0 / d, 1.8, 6.5);  // faster across the picture when close
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vDir;
        varying float vStreak;
        varying float vAlpha;
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          q.y = -q.y;
          // Stretch along the line to the centre: motion blur of the fall.
          float along = dot(q, vDir);
          float across = dot(q, vec2(-vDir.y, vDir.x));
          float e = length(vec2(along, across * vStreak));
          if (e > 1.0) discard;
          float body = smoothstep(1.0, 0.2, e) * 0.22;
          float rim = smoothstep(0.55, 0.85, e) * smoothstep(1.0, 0.85, e) * 0.55; // a bokeh edge
          gl_FragColor = vec4(vec3(0.55, 0.68, 0.75) * (body + rim) * vAlpha, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.layers.set(LENS_RAIN_LAYER);
  }

  update(time, camera, viewportHeight) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    u.uReach.value = Math.tan((camera.fov * Math.PI) / 360) * Math.max(camera.aspect, 1);
    u.uScale.value = viewportHeight;
  }

  setAmount(v) {
    this.material.uniforms.uAmount.value = v;
  }
}
