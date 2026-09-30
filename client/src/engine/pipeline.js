// Post-processing. three.js's own passes do the heavy lifting:
// RenderPass draws the scene in linear HDR, UnrealBloomPass builds the glow.
// The last pass is ours and it *is* the camera: glass, dirt, drops,
// distortion, tone mapping, then the grade (bleach bypass with the
// Sin City rule), grain, scanlines and vignette.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { lensDirtTexture, lensDropsTexture } from './textures.js';

// The grade, softer than the first cut. Every value is adjustable from the
// TUNE panel; paste the panel's Copy output here to make it the default.
export const GRADE_DEFAULTS = {
  exposure: 1.1, // before tone mapping
  strength: 1.0, // 0 = ungraded, 1 = full grade
  bleach: 0.6, // bleach bypass: silver left in the print
  contrast: 0.5, // gentle to hard, crushed blacks
  lift: 0.15, // opens up the shadows
  color: 0.15, // colour that survives outside the lights
  tint: 0.6, // cold green-cyan in the shadows
};

const CameraShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    tDirt: { value: null },
    tDrops: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uExposure: { value: 1.0 },
    uBarrel: { value: 0.08 },
    uAberration: { value: 0.002 },
    uDirt: { value: 1.0 },
    uDrops: { value: 1.0 },
    uNoise: { value: 0.35 },
    uGrade: { value: 1.0 },
    // Grade controls (see GRADE_DEFAULTS).
    uGradeMix: { value: 1.0 },
    uBleach: { value: 0.6 },
    uContrast: { value: 0.5 },
    uLift: { value: 0.15 },
    uColorKeep: { value: 0.15 },
    uTint: { value: 0.6 },
    // The recording: resolution, interlaced field, compression, glitches.
    uVideoRes: { value: new THREE.Vector2(640, 400) },
    uField: { value: 0 },
    uFrame: { value: 0 },
    uCompress: { value: 0.8 },
    uGlitch: { value: 1.0 },
    uLoss: { value: 0.0 },
    tHud: { value: null },
    uHud: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tBloom, tDirt, tDrops, tHud;
    uniform float uHud;
    uniform float uTime, uAspect, uExposure, uBarrel, uAberration, uDirt, uDrops, uNoise, uGrade;
    uniform float uGradeMix, uBleach, uContrast, uLift, uColorKeep, uTint;
    uniform vec2 uRes, uVideoRes;
    uniform float uField, uFrame, uCompress, uGlitch, uLoss;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // ACES filmic approximation (Narkowicz).
    vec3 aces(vec3 x) {
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    }

    void main() {
      // 1. Glass: barrel distortion of a wide, cheap lens.
      vec2 c = vUv - 0.5;
      float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
      vec2 uv = 0.5 + c * (1.0 - uBarrel * 0.25 + uBarrel * r2);

      // 2. Water on the housing bends what's behind it.
      float drop = 0.0;
      if (uDrops > 0.0) {
        vec2 duv = vec2(vUv.x * uAspect, vUv.y) * 1.1;
        float e = 1.5 / 1024.0;
        drop = texture2D(tDrops, duv).r;
        vec2 slope = vec2(texture2D(tDrops, duv + vec2(e, 0.0)).r - texture2D(tDrops, duv - vec2(e, 0.0)).r,
                          texture2D(tDrops, duv + vec2(0.0, e)).r - texture2D(tDrops, duv - vec2(0.0, e)).r);
        // Small, clamped offset: a drop bends the image, it doesn't teleport it.
        uv -= clamp(slope, -0.25, 0.25) * 0.05 * uDrops;
      }

      // 3. The signal. What reaches you is a cheap recording: few lines,
      // interlaced fields, 8x8 compression blocks, and a tape that tears.
      vec2 px = floor(uv * uVideoRes);
      float odd = mod(px.y + uField, 2.0);
      vec2 vuv = (px + 0.5) / uVideoRes;
      // Fields don't line up: every other line sits a little to the side.
      vuv.x += odd * (0.6 + (hash12(vec2(px.y, uFrame)) - 0.5) * 0.8) / uVideoRes.x;
      // Now and then a band of lines loses sync and slides.
      float tear = step(0.985, hash12(vec2(floor(px.y / 7.0), uFrame)));
      vuv.x += tear * (hash12(vec2(px.y * 0.1, uFrame + 3.0)) - 0.3) * 0.03 * uGlitch;
      // A few macroblocks arrive from the wrong place.
      vec2 blk = floor(px / 8.0);
      float bad = step(1.0 - 0.01 * uGlitch, hash12(blk + fract(uFrame * 0.618) * 97.0));
      vec2 jump = bad * (vec2(hash12(blk + 3.1), hash12(blk + 7.3)) - 0.5) * 0.08;
      vuv += jump;
      uv = vuv;

      // Colour fringing towards the edges.
      vec2 ca = c * uAberration * (0.4 + 3.0 * r2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - ca).b;

      // Chroma is stored at a quarter of the resolution, so colour bleeds
      // in blocks past the edges of neon and tail lights.
      vec2 cuv = (floor(px / 4.0) * 4.0 + 2.0) / uVideoRes + jump;
      vec3 chromaSrc = texture2D(tDiffuse, cuv).rgb;
      float yFine = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float yCoarse = dot(chromaSrc, vec3(0.2126, 0.7152, 0.0722));
      vec3 bled = chromaSrc * min(yFine / max(yCoarse, 1e-4), 4.0);
      col = mix(col, bled, 0.8 * uCompress);

      // 4. Dirt lights up only where the glow falls on it.
      vec3 bloom = texture2D(tBloom, uv).rgb;
      vec3 dirt = texture2D(tDirt, vUv).rgb;
      col += bloom * dirt * 2.4 * uDirt;
      col += bloom * drop * 0.6 * uDrops;

      // 5. Film response.
      col = aces(col * uExposure);
      col = toSRGB(col);

      // 6. Grade. Bleach bypass: silver left in the print.
      if (uGrade > 0.5) {
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        vec3 L = vec3(luma);
        vec3 lo = 2.0 * col * L;
        vec3 hi = 1.0 - 2.0 * (1.0 - col) * (1.0 - L);
        vec3 silver = mix(lo, hi, clamp((luma - 0.45) * 10.0, 0.0, 1.0));
        vec3 bleached = mix(col, silver, uBleach);

        // Near-monochrome base, tinted cold green-cyan in the shadows.
        vec3 mono = vec3(dot(bleached, vec3(0.2126, 0.7152, 0.0722)));
        mono = pow(mono, vec3(0.85));
        mono *= mix(mix(vec3(1.0), vec3(0.82, 1.0, 0.94), uTint), vec3(1.0), smoothstep(0.1, 0.8, mono.r));

        // The Sin City rule: light keeps its colour, and so does red.
        float glowMask = smoothstep(0.05, 0.45, dot(toSRGB(aces(bloom)), vec3(0.333)));
        float bright = smoothstep(0.55, 0.9, luma);
        float red = smoothstep(0.08, 0.3, col.r - max(col.g, col.b));
        float keep = clamp(max(max(max(glowMask, bright * 0.8), red), uColorKeep), 0.0, 1.0);
        vec3 graded = mix(mono, bleached, keep);

        // Contrast: from gentle to hard with crushed blacks.
        vec3 hard = smoothstep(vec3(0.0), vec3(0.97), graded);
        hard = pow(hard, vec3(1.04 + 0.12 * uContrast));
        graded = mix(graded, hard, uContrast);
        // Shadow lift: opens up the dark end without greying the lights.
        graded = pow(max(graded, vec3(0.0)), vec3(1.0 / (1.0 + uLift * 1.5)));
        col = mix(col, graded, uGradeMix);
      }

      // Burned-in symbology. It joins the picture here, after the grade and
      // before compression and noise, so it tears, blocks and interlaces
      // with the rest of the frame. A soft halo stands in for phosphor.
      if (uHud > 0.5) {
        vec2 hp = 1.6 / uVideoRes;
        float core = texture2D(tHud, uv).a;
        float halo = texture2D(tHud, uv + vec2(hp.x, 0.0)).a + texture2D(tHud, uv - vec2(hp.x, 0.0)).a
                   + texture2D(tHud, uv + vec2(0.0, hp.y)).a + texture2D(tHud, uv - vec2(0.0, hp.y)).a;
        vec3 phosphor = vec3(0.55, 1.0, 0.66);
        col = mix(col, phosphor, clamp(core * 0.95 + halo * 0.09, 0.0, 1.0));
      }

      // 7. Compression: banding, and blocks that don't quite agree.
      float levels = mix(96.0, 22.0, uCompress);
      col = floor(col * levels + 0.2 + hash12(blk + 0.5) * 0.6) / levels;
      col *= 1.0 + (hash12(blk + floor(uFrame * 0.25)) - 0.5) * 0.05 * uCompress;

      // 8. The camera's own electronics.
      float t = uTime;
      float grain = hash12(px + fract(uFrame * 0.137) * 491.0) - 0.5;
      col += grain * 0.08 * uNoise;
      col *= mix(1.0, 0.8, odd * uNoise * 1.6);
      float band = smoothstep(0.0, 0.04, abs(fract(vUv.y + t * 0.07) - 0.5) - 0.02);
      col *= mix(1.04, 1.0, band);
      col *= 1.0 - 0.55 * pow(max(length(c * vec2(1.0, 0.85)) * 1.25, 1e-4), 2.4);

      // Signal loss: snow and rolling bars while a feed connects.
      if (uLoss > 0.0) {
        float snow = hash12(px * 1.37 + fract(uFrame * 0.731) * 311.0);
        float roll = step(0.6, fract(vUv.y * 2.5 - uTime * 1.7)) * 0.18;
        col = mix(col, vec3(snow * 0.75 + roll), uLoss);
      }

      // Outside the distorted frame the housing is black.
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.dirtCache = new Map();
    this.drops = lensDropsTexture(9);
    this.composer = null;
    this.grade = true;
  }

  // Rebuilt whenever the tier, size or camera changes; cheap enough.
  build(scene, camera, tier, lens, width, height) {
    this.composer?.dispose();
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: tier.msaa,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(1);
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), tier.bloom, 0.55, 0.9);
    composer.addPass(bloom);

    const cam = new ShaderPass(CameraShader);
    // UnrealBloomPass (three r169) leaves the bloom on its own in
    // renderTargetsHorizontal[0] before blending it into the image. The
    // camera pass reads it there so dirt and drops respond to glow only.
    cam.uniforms.tBloom.value = bloom.renderTargetsHorizontal[0].texture;
    const key = `${lens.seed}-${lens.crack}`;
    if (!this.dirtCache.has(key)) this.dirtCache.set(key, lensDirtTexture(lens.seed ?? 1, lens.crack));
    cam.uniforms.tDirt.value = this.dirtCache.get(key);
    cam.uniforms.tDrops.value = this.drops;
    cam.uniforms.uAspect.value = width / height;
    cam.uniforms.uRes.value.set(width, height);
    cam.uniforms.uBarrel.value = tier.aberration ? lens.barrel : lens.barrel * 0.5;
    cam.uniforms.uAberration.value = tier.aberration ? lens.aberration : 0;
    cam.uniforms.uDirt.value = lens.dirt;
    cam.uniforms.uDrops.value = tier.drops ? lens.drops : 0;
    cam.uniforms.uNoise.value = lens.noise;
    cam.uniforms.uGrade.value = this.grade ? 1 : 0;
    const lines = lens.lines ?? 400;
    // CCTV pixels are wider than they are tall.
    cam.uniforms.uVideoRes.value.set(Math.round(lines * (width / height) * 0.8), lines);
    cam.uniforms.uCompress.value = lens.compression ?? 0.8;
    cam.uniforms.uGlitch.value = lens.glitch ?? 1.0;
    composer.addPass(cam);

    this.composer = composer;
    this.cameraPass = cam;
    this.setHud(this.hud ?? null);
    this.applyGradeParams();
  }

  // The drone's symbology texture, or null for none.
  setHud(texture) {
    this.hud = texture;
    if (this.cameraPass) {
      this.cameraPass.uniforms.tHud.value = texture;
      this.cameraPass.uniforms.uHud.value = texture ? 1 : 0;
    }
  }

  setLoss(v) {
    if (this.cameraPass) this.cameraPass.uniforms.uLoss.value = v;
  }

  // Grade settings from the tuning panel; kept across rebuilds.
  setGradeParams(params) {
    this.gradeParams = { ...(this.gradeParams ?? GRADE_DEFAULTS), ...params };
    this.applyGradeParams();
  }

  applyGradeParams() {
    const u = this.cameraPass?.uniforms;
    const p = this.gradeParams ?? GRADE_DEFAULTS;
    if (!u) return;
    u.uExposure.value = p.exposure;
    u.uGradeMix.value = p.strength;
    u.uBleach.value = p.bleach;
    u.uContrast.value = p.contrast;
    u.uLift.value = p.lift;
    u.uColorKeep.value = p.color;
    u.uTint.value = p.tint;
  }

  setGrade(on) {
    this.grade = on;
    if (this.cameraPass) this.cameraPass.uniforms.uGrade.value = on ? 1 : 0;
  }

  // frame: the camera's frame counter. Each frame is one interlaced field.
  render(time, frame) {
    const u = this.cameraPass.uniforms;
    u.uTime.value = time;
    u.uFrame.value = frame;
    u.uField.value = frame % 2;
    this.composer.render();
  }
}
