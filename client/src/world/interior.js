// Inside a building: for now one generic room, seen from the building's own
// security camera up in a corner. A lobby after hours: a desk, a terminal
// left on, a strip light that can't decide, the skin standing in the middle.
// It's a placeholder: interiors will be generated per building later, the
// way the facades are. The feed is a camera like any other, so it gets the
// same lens, grade and bad recording.

import * as THREE from 'three';
import { rng } from '../engine/textures.js';

function screenTexture(plot) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#021006';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#6dff8e';
  g.font = '18px "VT323", "Courier New", monospace';
  ['SunOS 4.1.4', `${plot.toUpperCase()} login: _`, '', 'LAST LOGIN: 31.12.1999', '23:59 ON TTY03', '', 'PRESS ANY KEY', 'TO CONTINUE'].forEach((l, i) => g.fillText(l, 12, 26 + i * 20));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildInterior(plot, seed = 7) {
  const r = rng(seed);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010101);
  scene.fog = new THREE.FogExp2(0x050806, 0.035);
  const W = 9;
  const D = 7;
  const H = 3.4;
  const floorTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      g.fillStyle = (i + j) % 2 ? '#2b2a26' : '#191917';
      g.fillRect(i * 32, j * 32, 32, 32);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2.4);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.25, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.85 });
  const walls = [
    [0, H / 2, -D / 2, W, H, 0.1],
    [0, H / 2, D / 2, W, H, 0.1],
    [-W / 2, H / 2, 0, 0.1, H, D],
    [W / 2, H / 2, 0, 0.1, H, D],
  ];
  for (const [x, y, z, w, h, d] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    scene.add(m);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x1c1d1a, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  scene.add(ceil);
  // The door you came in by, lit from the street.
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.55, 0.25) }));
  door.position.set(0, 1.15, D / 2 - 0.06);
  door.rotation.y = Math.PI;
  scene.add(door);
  // Reception desk, terminal, chair.
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.05, 0.8), wood);
  desk.position.set(-1.6, 0.525, -1.8);
  scene.add(desk);
  const beige = new THREE.MeshStandardMaterial({ color: 0x9c9380, roughness: 0.7 });
  const crt = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.5), beige);
  crt.position.set(-1.4, 1.3, -1.9);
  scene.add(crt);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.33), new THREE.MeshBasicMaterial({ map: screenTexture(plot), color: new THREE.Color(1.6, 1.6, 1.6) }));
  glass.position.set(-1.4, 1.32, -1.64);
  scene.add(glass);
  const glowLight = new THREE.PointLight('#5dff86', 3, 4, 2);
  glowLight.position.set(-1.4, 1.35, -1.2);
  scene.add(glowLight);
  const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshStandardMaterial({ color: 0x1b2b18, flatShading: true }));
  plant.position.set(3.6, 0.9, -2.8);
  scene.add(plant);
  // Filing cabinets down one wall.
  for (let i = 0; i < 4; i++) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x4a4d48, roughness: 0.5, metalness: 0.4 }));
    cab.position.set(W / 2 - 0.4, 0.7, -2.5 + i * 0.7);
    scene.add(cab);
  }
  // The skin, standing where it came in.
  const coat = new THREE.MeshStandardMaterial({ color: 0x8f8574, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.0, 4, 10), coat);
  body.position.set(0.3, 0.9, 1.8);
  scene.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2b2724 }));
  head.position.set(0.3, 1.77, 1.8);
  scene.add(head);
  // Strip light that flickers.
  const tube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 2.8) }));
  tube.position.set(0.5, H - 0.08, 0);
  scene.add(tube);
  const strip = new THREE.PointLight('#dfffe8', 18, 12, 1.6);
  strip.position.set(0.5, H - 0.3, 0);
  scene.add(strip);
  scene.add(new THREE.HemisphereLight(0x223322, 0x050505, 0.6));

  const camera = new THREE.PerspectiveCamera(78, 1, 0.1, 60);
  camera.position.set(W / 2 - 0.3, H - 0.25, D / 2 - 0.3);
  camera.lookAt(-0.8, 0.8, -1.2);

  const entry = {
    id: `INT-${plot}`,
    kind: 'camera',
    interior: true,
    name: `INT ${plot.toUpperCase()}`,
    description: 'LOBBY · CORNER DOME',
    scene,
    camera,
    target: [0, 0, 0],
    lens: { barrel: 0.28, dirt: 0.6, noise: 0.6, aberration: 0.003, drops: 0, crack: false, seed: 23, lines: 288, fps: 8, compression: 1.0, glitch: 1.3 },
    update(time) {
      // The strip light: mostly on, now and then a stutter.
      const f = Math.sin(time * 37) + Math.sin(time * 11.3) + Math.sin(time * 2.1);
      const on = f > -1.9 || r() < 0.3;
      strip.intensity = on ? 18 : 2;
      tube.material.color.setScalar(on ? 3 : 0.4);
    },
  };
  return entry;
}
