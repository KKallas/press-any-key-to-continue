// Engine core entry point: connect to the (local) server, subscribe to what
// CAM 07 can see, build the world from events, and run the camera.

import * as THREE from 'three';
import { LocalServer } from './net/local-server.js';
import { World } from './world/world.js';
import { BLOCK_01 } from './world/block01.js';
import { Pipeline } from './engine/pipeline.js';
import { TIERS, AutoQuality } from './engine/quality.js';

const $ = (id) => document.getElementById(id);

function fail(message) {
  $('err').hidden = false;
  $('err-detail').textContent = message;
}

const canvas = $('feed');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  fail('This device could not start WebGL.');
  throw e;
}
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the camera pass converts to sRGB itself

// Server and world.
const server = new LocalServer(BLOCK_01);
const world = new World();
const CAMERA_ID = 'CAM-07';
server.subscribe((e) => e.block === 'B01', (e) => world.apply(e));

const cam = world.cameras.get(CAMERA_ID);
$('cam-name').textContent = cam.name;
$('cam-desc').textContent = cam.description;

// Quality.
const pipeline = new Pipeline(renderer);
let tierName = 'high';
let auto = true;
const autoQ = new AutoQuality((next) => applyTier(next, true));

function size() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const tier = TIERS[tierName];
  const w = Math.max(1, Math.round(window.innerWidth * dpr * tier.scale));
  const h = Math.max(1, Math.round(window.innerHeight * dpr * tier.scale));
  return [w, h];
}

function rebuild() {
  const tier = TIERS[tierName];
  const [w, h] = size();
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  cam.camera.aspect = w / h;
  cam.camera.updateProjectionMatrix();
  world.street?.setReflection(tier.reflection, w, h);
  world.rain?.setDensity(tier.rain);
  pipeline.build(world.scene, cam.camera, tier, cam.lens, w, h);
}

function applyTier(name, fromAuto = false) {
  tierName = name;
  if (!fromAuto) {
    auto = false;
    autoQ.enabled = false;
  }
  rebuild();
  syncButtons();
}

function syncButtons() {
  for (const t of ['low', 'mid', 'high']) {
    $(`q-${t}`).setAttribute('aria-pressed', String(!auto && tierName === t));
  }
  $('q-auto').setAttribute('aria-pressed', String(auto));
  $('q-auto').textContent = auto ? `AUTO · ${tierName.toUpperCase()}` : 'AUTO';
}

document.querySelectorAll('[data-tier]').forEach((b) =>
  b.addEventListener('click', () => {
    const t = b.dataset.tier;
    if (t === 'auto') {
      auto = true;
      autoQ.enabled = true;
      autoQ.reset();
      applyTier('high', true);
    } else applyTier(t);
  }),
);

$('grade').addEventListener('click', () => {
  pipeline.setGrade(!pipeline.grade);
  $('grade').setAttribute('aria-pressed', String(pipeline.grade));
});

window.addEventListener('keydown', (e) => {
  if (e.key === '1') applyTier('low');
  if (e.key === '2') applyTier('mid');
  if (e.key === '3') applyTier('high');
  if (e.key === 'g' || e.key === 'G') $('grade').click();
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rebuild, 150);
});

// On-screen display. The seconds loop inside the last minute of 1999.
const t0 = performance.now();
function osd(elapsed) {
  const s = Math.floor(elapsed) % 60;
  $('time').textContent = `23:59:${String(s).padStart(2, '0')}`;
  $('rec-dot').classList.toggle('off', Math.floor(elapsed * 1.25) % 2 === 1);
}

// Loop.
rebuild();
syncButtons();
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;

// The camera records at its own frame rate (12.5 fps for cheap CCTV).
// The world only moves when the camera takes a frame, and the GPU rests
// in between, which also makes the choppy look nearly free.
const fps = cam.lens.fps ?? 12.5;
let lastFrame = -1;

function frame(now) {
  const dt = now - last;
  last = now;
  const time = (now - t0) / 1000;
  const n = Math.floor(time * fps);
  if (n !== lastFrame) {
    lastFrame = n;
    const shot = n / fps;
    world.update(shot, renderer.domElement.height);
    pipeline.render(shot, n);
  }
  osd(time);

  autoQ.frame(dt, tierName);
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 500) {
    $('stats').textContent = `${Math.round((fpsFrames * 1000) / fpsAcc)} FPS · ${tierName.toUpperCase()}`;
    fpsAcc = 0;
    fpsFrames = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the world from the console.
window.pak = { server, world, pipeline };
