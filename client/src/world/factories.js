// Placeholder builders, one per entity kind. Each takes the props from a
// spawn event and returns { object, rainLights?, update? }. Shapes are
// deliberately plain: these get replaced by generated modules later.

import * as THREE from 'three';
import { windowTexture, neonTexture, rng } from '../engine/textures.js';
import { Builder } from './deco.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });
const glow = (color, intensity) =>
  new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 1 });

// A soft additive cone: light made visible by the rain and haze.
function lightCone(color, radius, height, strength = 0.05) {
  const geo = new THREE.ConeGeometry(radius, height, 32, 1, true);
  geo.translate(0, -height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uHeight: { value: height } },
    vertexShader: /* glsl */ `
      varying float vDown;
      varying float vFacing;
      uniform float uHeight;
      void main() {
        vDown = clamp(-position.y / uHeight, 0.0, 1.0);
        vec3 n = normalMatrix * normal;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 v = -mv.xyz;
        // No normalize() or pow() here: on Apple GPUs (Metal) they produced
        // NaN at grazing angles, and the bloom smeared each NaN pixel into
        // a large black box.
        vFacing = abs(dot(n, v)) / max(length(n) * length(v), 1e-4);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vDown;
      varying float vFacing;
      void main() {
        float f = clamp(vFacing, 0.0, 1.0);
        float d = 1.0 - clamp(vDown, 0.0, 1.0);
        float a = f * sqrt(f) * d * d * uStrength;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 8;
  return mesh;
}

function faceRotation([fx, fz]) {
  return Math.atan2(fx, fz);
}

export const factories = {
  // A generated city's ground: every block is a raised sidewalk slab with a
  // darker lot inside it. The roads are simply the gaps between blocks.
  'city-base'({ blocks }) {
    const slab = new Builder();
    const lot = new Builder();
    const concrete = new THREE.Color(0x2a2c2e);
    const dark = new THREE.Color(0x0c0d0e);
    for (const b of blocks) {
      let pts = b.polygon;
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x0, z0] = pts[i];
        const [x1, z1] = pts[(i + 1) % pts.length];
        a += x0 * z1 - x1 * z0;
      }
      if (a < 0) pts = [...pts].reverse();
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % pts.length];
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        slab.wall(p0, p1, 0, 0.15, [(p1[1] - p0[1]) / L, -(p1[0] - p0[0]) / L], concrete, [0, 0]);
      }
      slab.cap(pts, 0.15, concrete);
      for (const l of b.lots ?? []) lot.cap(l, 0.16, dark);
    }
    const group = new THREE.Group();
    const m1 = slab.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }));
    const m2 = lot.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    if (m1) group.add(m1);
    if (m2) group.add(m2);
    return { object: group };
  },

  'camera-housing'({ position, target, mount }) {
    const group = new THREE.Group();
    const metal = std(0x202326, { metalness: 0.4, roughness: 0.45 });
    const p = new THREE.Vector3(...position);
    const t = new THREE.Vector3(...target);
    const body = new THREE.Group();
    const shell = new THREE.Mesh(box(0.28, 0.24, 0.6), metal);
    body.add(shell);
    const hood = new THREE.Mesh(box(0.34, 0.04, 0.72), metal);
    hood.position.y = 0.14;
    body.add(hood);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.08, 14), new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.05, metalness: 0.8 }));
    glass.position.z = -0.301;
    glass.rotation.y = Math.PI;
    body.add(glass);
    // The tally light: a red dot that says someone is watching.
    const tally = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), glow('#ff1a1a', 6));
    tally.position.set(0.1, 0.06, -0.3);
    body.add(tally);
    body.position.copy(p);
    body.lookAt(t);
    body.rotateY(Math.PI); // the lens looks down -z
    group.add(body);
    if (mount === 'mast') {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, p.y, 8), metal);
      mast.position.set(p.x, p.y / 2, p.z);
      group.add(mast);
    } else {
      const arm = new THREE.Mesh(box(0.06, 0.4, 0.06), metal);
      arm.position.set(p.x, p.y + 0.3, p.z);
      group.add(arm);
    }
    return { object: group };
  },

  street({ size, roadWidth, sidewalk, curb, roads, bounds }) {
    // The road surface itself is built by the engine (it needs the renderer
    // for reflections). Here: raised sidewalk slabs between the roads, a
    // darker lot inside each, and empty lots out past the ring roads.
    const group = new THREE.Group();
    const half = roadWidth / 2;
    const concrete = std(0x2a2c2e, { roughness: 0.45 });
    const lotMat = std(0x0c0d0e, { roughness: 0.9 });
    const voidMat = std(0x050506, { roughness: 1 });
    const edge = size / 2;
    // Intervals between roads along one axis; a side that ends at a road
    // gets a sidewalk, a side that ends at the world's edge doesn't.
    const cuts = [-edge, ...roads, edge];
    const spans = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const loRoad = i > 0;
      const hiRoad = i < cuts.length - 2;
      spans.push({ a: cuts[i] + (loRoad ? half : 0), b: cuts[i + 1] - (hiRoad ? half : 0), loRoad, hiRoad });
    }
    for (const sx of spans) {
      for (const sz of spans) {
        const w = sx.b - sx.a;
        const d = sz.b - sz.a;
        const slab = new THREE.Mesh(box(w, curb, d), concrete);
        slab.position.set((sx.a + sx.b) / 2, curb / 2, (sz.a + sz.b) / 2);
        group.add(slab);
        const inside = sx.loRoad && sx.hiRoad && sz.loRoad && sz.hiRoad;
        const la = sx.a + (sx.loRoad ? sidewalk : 0);
        const lb = sx.b - (sx.hiRoad ? sidewalk : 0);
        const ma = sz.a + (sz.loRoad ? sidewalk : 0);
        const mb = sz.b - (sz.hiRoad ? sidewalk : 0);
        const lot = new THREE.Mesh(box(lb - la, 0.02, mb - ma), inside ? lotMat : voidMat);
        lot.position.set((la + lb) / 2, curb + 0.01, (ma + mb) / 2);
        group.add(lot);
      }
    }
    return { object: group };
  },

  building({ x, z, w, d, h, seed }) {
    const r = rng(seed);
    const group = new THREE.Group();
    const wall = new THREE.Color().setHSL(0.55 + r() * 0.08, 0.07, 0.06 + r() * 0.04);
    const floors = Math.max(1, Math.round(h / 3.3));
    const makeSide = (width, s) =>
      std(wall, {
        emissiveMap: windowTexture(Math.max(1, Math.round(width / 2.4)), floors, s),
        emissive: 0xffffff,
        emissiveIntensity: 1.3,
        roughness: 0.55,
      });
    const sideX = makeSide(d, seed * 7 + 1);
    const sideZ = makeSide(w, seed * 7 + 2);
    const roof = std(0x0d0f11, { roughness: 0.9 });
    // Box face order: +x, -x, +y, -y, +z, -z
    const body = new THREE.Mesh(box(w, h, d), [sideX, sideX, roof, roof, sideZ, sideZ]);
    body.position.y = h / 2 + 0.15;
    group.add(body);

    // Rooftop clutter: AC units, a water tank, a parapet line.
    const clutter = std(0x1a1c1f, { roughness: 0.7 });
    const n = 2 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const s = 0.8 + r() * 1.8;
      const unit = new THREE.Mesh(box(s, 0.6 + r() * 1.2, s * (0.6 + r())), clutter);
      unit.position.set((r() - 0.5) * (w - 3), h + 0.15 + 0.5, (r() - 0.5) * (d - 3));
      group.add(unit);
    }
    if (r() < 0.6) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 14), clutter);
      tank.position.set((r() - 0.5) * (w - 4), h + 0.15 + 2.2, (r() - 0.5) * (d - 4));
      group.add(tank);
    }
    const parapet = new THREE.Mesh(box(w + 0.3, 0.5, d + 0.3), std(0x121417));
    parapet.position.y = h + 0.15 + 0.1;
    parapet.scale.set(1, 1, 1);
    group.add(parapet);

    let update;
    // Tall buildings carry a blinking aviation light.
    if (h > 36) {
      const mat = glow('#ff1a1a', 6);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat);
      beacon.position.set(w / 2 - 0.6, h + 0.9, d / 2 - 0.6);
      group.add(beacon);
      update = (t) => {
        mat.emissiveIntensity = (t % 1.6) < 0.25 ? 9 : 0.2;
      };
    }
    group.position.set(x, 0, z);
    return { object: group, update };
  },

  skybridge({ from, to, width, height }) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    const group = new THREE.Group();
    const body = new THREE.Mesh(box(len, height, width), std(0x15181b, { roughness: 0.6 }));
    group.add(body);
    // A lit strip of windows along both sides.
    const strip = glow('#bfe7ff', 0.8);
    for (const s of [-1, 1]) {
      const band = new THREE.Mesh(box(len - 0.6, 0.5, 0.05), strip);
      band.position.set(0, 0.2, s * (width / 2 + 0.01));
      group.add(band);
    }
    group.position.copy(a).add(b).multiplyScalar(0.5);
    group.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    return { object: group };
  },

  lamp({ x, z, arm, height, color, intensity }) {
    const group = new THREE.Group();
    const metal = std(0x1b1d20, { roughness: 0.5, metalness: 0.4 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, height, 8), metal);
    pole.position.y = height / 2 + 0.15;
    group.add(pole);
    const armLen = 1.6;
    const [ax, az] = arm;
    const armMesh = new THREE.Mesh(box(armLen, 0.08, 0.08), metal);
    armMesh.position.set((ax * armLen) / 2, height + 0.15, (az * armLen) / 2);
    armMesh.rotation.y = -Math.atan2(az, ax);
    group.add(armMesh);
    const headPos = new THREE.Vector3(ax * armLen, height + 0.05, az * armLen);
    const head = new THREE.Mesh(box(0.7, 0.14, 0.34), glow(color, 7));
    head.position.copy(headPos);
    head.rotation.y = -Math.atan2(az, ax);
    group.add(head);
    if (intensity > 0) {
      const light = new THREE.PointLight(color, intensity, 26, 2);
      light.position.copy(headPos).add(new THREE.Vector3(0, -0.3, 0));
      group.add(light);
    }
    const cone = lightCone(color, 3.2, height - 0.2, 0.05);
    cone.position.copy(headPos).add(new THREE.Vector3(0, -0.1, 0));
    group.add(cone);
    group.position.set(x, 0, z);
    const world = new THREE.Vector3(x, 0, z).add(headPos);
    return {
      object: group,
      rainLights: intensity > 0 ? [{ position: world, color: new THREE.Color(color), strength: 1.0 }] : [],
    };
  },

  neon({ text, vertical, x, y, z, face, size, color, flicker }) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: neonTexture(text, color, vertical),
      emissiveIntensity: 5,
      roughness: 1,
    });
    const [w, h] = size;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    group.add(sign);
    // Backing box so the sign has some depth from above.
    const back = new THREE.Mesh(box(w + 0.1, h + 0.1, 0.25), std(0x0b0c0d));
    back.position.z = -0.14;
    group.add(back);
    const light = new THREE.PointLight(color, 26, 12, 2);
    light.position.set(0, 0, 1.2);
    group.add(light);
    group.position.set(x + face[0] * 0.3, y, z + face[1] * 0.3);
    group.rotation.y = faceRotation(face);

    let update;
    if (flicker) {
      // A tired transformer: mostly on, with bursts of stutter.
      update = (t) => {
        const burst = Math.sin(t * 0.7) > 0.72;
        const on = !burst || Math.sin(t * 61.0) + Math.sin(t * 23.0) > 0.3;
        mat.emissiveIntensity = on ? 5 : 0.25;
        light.intensity = on ? 26 : 1;
      };
    }
    const wp = new THREE.Vector3(x + face[0] * 1.2, y, z + face[1] * 1.2);
    return {
      object: group,
      update,
      rainLights: [{ position: wp, color: new THREE.Color(color), strength: 0.7 }],
    };
  },

  'traffic-light'({ x, z, state }) {
    const group = new THREE.Group();
    const metal = std(0x17191b, { metalness: 0.4, roughness: 0.5 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4, 8), metal);
    pole.position.y = 2.15;
    group.add(pole);
    const housing = new THREE.Mesh(box(0.4, 1.2, 0.35), metal);
    housing.position.y = 4.0;
    group.add(housing);
    const colors = { red: '#ff2020', amber: '#ffa020', green: '#30ff80' };
    ['red', 'amber', 'green'].forEach((c, i) => {
      const lit = c === state;
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), lit ? glow(colors[c], 4) : std(0x050505));
      lens.position.set(0, 4.35 - i * 0.35, 0.18);
      group.add(lens);
    });
    group.position.set(x, 0, z);
    group.rotation.y = Math.PI / 4;
    return { object: group };
  },

  // A phone booth: a tall glass box with an interior light and a red hood.
  // Somewhere to jack the modem in, out on the street.
  'phone-booth'({ x, z, heading = 0 }) {
    const group = new THREE.Group();
    const frame = std(0x9a2b1f, { metalness: 0.3, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a1518, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.5 });
    const base = new THREE.Mesh(box(1.0, 0.1, 1.0), std(0x15171a));
    base.position.y = 0.2;
    group.add(base);
    for (const [sx, sz] of [[-0.48, 0], [0.48, 0], [0, -0.48], [0, 0.48]]) {
      const post = new THREE.Mesh(box(0.08, 2.2, 0.08), frame);
      post.position.set(sx, 1.3, sz);
      group.add(post);
    }
    const pane = new THREE.Mesh(box(0.94, 1.7, 0.94), glass);
    pane.position.y = 1.35;
    group.add(pane);
    const hood = new THREE.Mesh(box(1.08, 0.35, 1.08), frame);
    hood.position.y = 2.45;
    group.add(hood);
    // The warm light inside, and its glow so it reads at night.
    const lamp = new THREE.Mesh(box(0.7, 0.05, 0.7), glow('#ffdca8', 4));
    lamp.position.y = 2.25;
    group.add(lamp);
    const cone = lightCone('#ffe4b0', 1.6, 3, 0.03);
    cone.position.y = 2.2;
    group.add(cone);
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    return { object: group, rainLights: [{ position: new THREE.Vector3(x, 2.2, z), color: new THREE.Color('#ffe4b0'), strength: 0.6 }] };
  },

  terminal({ x, z, face }) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(box(0.9, 1.9, 0.6), std(0x1d2124, { metalness: 0.3, roughness: 0.4 }));
    body.position.y = 0.95 + 0.15;
    group.add(body);
    const hood = new THREE.Mesh(box(1.1, 0.12, 0.9), std(0x121416));
    hood.position.set(0, 2.1, 0.12);
    group.add(hood);
    // Phosphor green screen, the one thing on this street that isn't 1999 neon.
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), glow('#39ff6a', 3.2));
    screen.position.set(0, 1.45, 0.31);
    group.add(screen);
    const light = new THREE.PointLight('#39ff6a', 6, 4, 2);
    light.position.set(0, 1.4, 0.8);
    group.add(light);
    group.position.set(x, 0, z);
    group.rotation.y = faceRotation(face);
    return { object: group };
  },

  // livery: none, 'police' (black-and-white with a light bar and siren) or
  // 'agent' (black, polished, cold lamps). lights: real lamps (costly; only
  // the player's car has them).
  car({ x, z, heading, color, lights, livery }) {
    const group = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({
      color: livery === 'police' ? 0xd9d9d4 : livery === 'agent' ? 0x050506 : color,
      roughness: livery === 'agent' ? 0.12 : 0.28,
      metalness: livery === 'agent' ? 0.8 : 0.35,
    });
    const body = new THREE.Mesh(box(4.4, 0.75, 1.85), paint);
    body.position.y = 0.72;
    group.add(body);
    const cabin = new THREE.Mesh(box(2.3, 0.62, 1.62), new THREE.MeshStandardMaterial({ color: 0x07090b, roughness: 0.08, metalness: 0.6 }));
    cabin.position.set(-0.25, 1.4, 0);
    group.add(cabin);
    const roof = new THREE.Mesh(box(1.9, 0.06, 1.55), paint);
    roof.position.set(-0.3, 1.73, 0);
    group.add(roof);
    const tyre = std(0x050505, { roughness: 0.9 });
    for (const [wx, wz] of [[1.4, 0.92], [1.4, -0.92], [-1.4, 0.92], [-1.4, -0.92]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14), tyre);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.36, wz);
      group.add(wheel);
    }
    let update;
    if (livery === 'police') {
      // Black doors and bonnet, a light bar on the roof.
      const black = std(0x060606, { roughness: 0.3, metalness: 0.4 });
      for (const s of [-1, 1]) {
        const door = new THREE.Mesh(box(2.2, 0.5, 0.02), black);
        door.position.set(-0.1, 0.7, s * 0.93);
        group.add(door);
      }
      const hood = new THREE.Mesh(box(1.1, 0.02, 1.7), black);
      hood.position.set(1.65, 1.1, 0);
      group.add(hood);
      const bar = new THREE.Mesh(box(0.3, 0.14, 1.3), std(0x111111));
      bar.position.set(-0.3, 1.84, 0);
      group.add(bar);
      const red = glow('#ff1020', 0);
      const blue = glow('#1848ff', 0);
      for (const [mat, side] of [[red, -1], [blue, 1]]) {
        const lamp = new THREE.Mesh(box(0.32, 0.16, 0.55), mat);
        lamp.position.set(-0.3, 1.86, side * 0.36);
        group.add(lamp);
      }
      // One light that swaps colour: the street goes red, blue, red.
      const flash = new THREE.PointLight('#ff1020', 0, 22, 2);
      flash.position.set(-0.3, 2.4, 0);
      group.add(flash);
      update = (time) => {
        const on = !!group.userData.siren && group.visible;
        const phase = Math.floor(time * 6) % 4;
        const redOn = on && (phase === 0 || phase === 2);
        red.emissiveIntensity = redOn ? 14 : on ? 0.6 : 0;
        blue.emissiveIntensity = on && !redOn ? 14 : on ? 0.6 : 0;
        flash.intensity = on ? 60 : 0;
        flash.color.set(redOn ? '#ff1020' : '#1848ff');
      };
    }
    if (!lights && livery) {
      // Lamps that glow but light nothing: cheap, and enough from above.
      const head = glow(livery === 'agent' ? '#cfe6ff' : '#fff1d6', 7);
      const tail = glow('#ff1010', 5);
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(box(0.06, 0.18, 0.4), head);
        h.position.set(2.22, 0.78, s * 0.62);
        group.add(h);
        const t = new THREE.Mesh(box(0.06, 0.16, 0.5), tail);
        t.position.set(-2.22, 0.8, s * 0.58);
        group.add(t);
      }
    }
    if (lights) {
      const head = glow('#fff1d6', 9);
      const tail = glow('#ff1010', 6);
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(box(0.06, 0.18, 0.4), head);
        h.position.set(2.22, 0.78, s * 0.62);
        group.add(h);
        const t = new THREE.Mesh(box(0.06, 0.16, 0.5), tail);
        t.position.set(-2.22, 0.8, s * 0.58);
        group.add(t);
        const beam = lightCone('#fff1d6', 2.8, 12, 0.035);
        beam.rotation.z = Math.PI / 2 - 0.08;
        beam.position.set(2.25, 0.78, s * 0.62);
        group.add(beam);
      }
      const spot = new THREE.SpotLight('#fff1d6', 160, 30, 0.42, 0.6, 2);
      spot.position.set(2.3, 0.8, 0);
      spot.target.position.set(14, 0, 0);
      group.add(spot, spot.target);
      const red = new THREE.PointLight('#ff1010', 4, 5, 2);
      red.position.set(-2.8, 0.8, 0);
      group.add(red);
    }
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    return { object: group, update };
  },

  person({ x, z, umbrella, coat, heading }) {
    const group = new THREE.Group();
    const cloth = std(coat, { roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.0, 4, 10), cloth);
    body.position.y = 0.15 + 0.24 + 0.5;
    body.scale.set(1, 1, 0.75);
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), std(0x2b2724));
    head.position.y = 0.15 + 1.62;
    group.add(head);
    if (umbrella) {
      const canopy = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4),
        new THREE.MeshStandardMaterial({ color: umbrella, roughness: 0.25, metalness: 0.1, side: THREE.DoubleSide }),
      );
      canopy.scale.y = 0.55;
      canopy.position.y = 0.15 + 1.95;
      group.add(canopy);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5), std(0x333333));
      shaft.position.y = 0.15 + 1.75;
      group.add(shaft);
    } else {
      // No umbrella: a hat, collar up.
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 14), std(0x121212));
      hat.position.y = 0.15 + 1.73;
      group.add(hat);
    }
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    return { object: group };
  },
};
