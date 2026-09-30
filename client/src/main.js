// Engine core entry point: connect to the (local) server, subscribe to the
// block, build the world from events, then look at it through a drone or
// through whichever street camera the player has hacked into.

import * as THREE from 'three';
import { LocalServer } from './net/local-server.js';
import { World } from './world/world.js';
import { BLOCK_01 } from './world/block01.js';
import { Pipeline } from './engine/pipeline.js';
import { TIERS, AutoQuality } from './engine/quality.js';
import { DroneControl } from './engine/drone.js';

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
server.subscribe((e) => e.block === 'B01', (e) => world.apply(e));

const DRONE_ID = 'UAV-2';
const drone = world.cameras.get(DRONE_ID);
const droneControl = new DroneControl(drone, canvas);
const streetCams = [...world.cameras.values()].filter((c) => c.kind === 'camera');
let active = drone;

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
  active.camera.aspect = w / h;
  active.camera.updateProjectionMatrix();
  world.useCamera(active);
  world.street?.setReflection(tier.reflection, w, h);
  world.rain?.setDensity(tier.rain);
  pipeline.build(world.scene, active.camera, tier, active.lens, w, h);
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

// ---- Switching feeds -------------------------------------------------------

let lastFrame = -1;
let loss = 0; // signal loss, 1 = pure snow
let hackTimer = null;

function setActive(entry) {
  active = entry;
  lastFrame = -1;
  droneControl.enabled = entry === drone;
  document.body.classList.toggle('mode-drone', entry.kind === 'drone');
  $('cam-name').textContent = entry.name;
  $('cam-desc').textContent = entry.description;
  $('hint').textContent = entry.kind === 'drone'
    ? 'DRAG OR WASD TO PAN · Q E TO ORBIT · SCROLL TO ZOOM · CLICK A CAMERA TO HACK IT'
    : 'ESC · BACK TO DRONE    TAB · NEXT CAMERA';
  rebuild();
}

// A plausible 1999 login, typed over the snow while the feed connects.
function hackScript(cam) {
  const n = cam.id.replace(/\D/g, '');
  return [
    `> telnet 10.1.0.${Number(n)}`,
    `Trying 10.1.0.${Number(n)}...`,
    `Connected to ${cam.id.toLowerCase()}.`,
    'VIDSERV 2.1 (c) 1998',
    'login: admin',
    'Password: ****',
    `STREAM ${cam.name} · ${cam.lens.lines} LINES · ${cam.lens.fps} FPS`,
    'OK',
  ];
}

function hack(cam) {
  if (hackTimer) clearInterval(hackTimer);
  loss = 1;
  setActive(cam);
  const lines = hackScript(cam);
  const box = $('hack');
  box.hidden = false;
  box.textContent = '';
  let i = 0;
  hackTimer = setInterval(() => {
    if (i < lines.length) {
      box.textContent += (i ? '\n' : '') + lines[i++];
      return;
    }
    clearInterval(hackTimer);
    hackTimer = null;
    box.hidden = true;
  }, 170);
}

function backToDrone() {
  if (hackTimer) clearInterval(hackTimer);
  hackTimer = null;
  $('hack').hidden = true;
  loss = 0.8;
  setActive(drone);
}

function nextCamera() {
  const i = streetCams.indexOf(active);
  hack(streetCams[(i + 1) % streetCams.length]);
}

// Markers over the drone feed for every camera the drone can see.
const markers = new Map();
for (const cam of streetCams) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cam-marker';
  b.innerHTML = `<span class="box"></span><span>${cam.name}</span>`;
  b.setAttribute('aria-label', `Hack ${cam.name}, ${cam.description}`);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    hack(cam);
  });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  $('markers').appendChild(b);
  markers.set(cam, b);
}

const tmp = new THREE.Vector3();
function placeMarkers() {
  for (const [cam, el] of markers) {
    tmp.copy(cam.anchor).project(drone.camera);
    const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 0.96 && Math.abs(tmp.y) < 0.92;
    el.hidden = !onScreen;
    if (onScreen) {
      el.style.left = `${(tmp.x * 0.5 + 0.5) * 100}%`;
      el.style.top = `${(-tmp.y * 0.5 + 0.5) * 100}%`;
    }
  }
}

// ---- Input -----------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.key === '1') applyTier('low');
  else if (e.key === '2') applyTier('mid');
  else if (e.key === '3') applyTier('high');
  else if (e.key === 'g' || e.key === 'G') $('grade').click();
  else if (e.key === 'Escape') backToDrone();
  else if (e.key === 'Tab') {
    e.preventDefault();
    nextCamera();
  }
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rebuild, 150);
});

// ---- On-screen display ------------------------------------------------------

const t0 = performance.now();
function osd(elapsed) {
  // The seconds loop inside the last minute of 1999.
  const s = Math.floor(elapsed) % 60;
  $('time').textContent = `23:59:${String(s).padStart(2, '0')}`;
  $('rec-dot').classList.toggle('off', Math.floor(elapsed * 1.25) % 2 === 1);
  if (active === drone) $('telemetry').textContent = droneControl.telemetry();
}

// ---- Loop --------------------------------------------------------------------

setActive(drone);
syncButtons();
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;

// Each camera records at its own frame rate. The world only moves when the
// active camera takes a frame, and the GPU rests in between.
function frame(now) {
  const dt = Math.min(now - last, 100);
  last = now;
  const time = (now - t0) / 1000;

  if (active === drone) droneControl.update(dt / 1000);
  loss = Math.max(0, loss - dt / 900);
  pipeline.setLoss(loss);

  const fps = active.lens.fps ?? 12.5;
  const n = Math.floor(time * fps);
  if (n !== lastFrame) {
    lastFrame = n;
    const shot = n / fps;
    if (active === drone) {
      droneControl.apply();
      placeMarkers();
    }
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
window.pak = { server, world, pipeline, drone: droneControl, hack: (id) => hack(world.cameras.get(id)), backToDrone };
