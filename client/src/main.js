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
import { CarControl } from './engine/car.js';

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

// The car you drive. The drone locks on to it.
const carSpawn = BLOCK_01.find((e) => e.id === 'car1').props;
const car = new CarControl({
  server,
  block: 'B01',
  id: 'car1',
  start: { x: carSpawn.x, z: carSpawn.z, heading: carSpawn.heading },
  roads: world.roads,
});
droneControl.lock = () => ({
  x: car.x,
  z: car.z,
  vx: Math.cos(car.heading) * car.speed,
  vz: -Math.sin(car.heading) * car.speed,
});

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
    ? 'WASD DRIVE · SPACE HANDBRAKE · DRAG TO LOOK · F TRACK CAR · Q E ORBIT · SCROLL ZOOM'
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

// Tags over the drone feed: known cameras, block names, and the tracking
// box on the car. Camera hacking comes later, through an in-game browser.
const tags = [];
function addTag(className, html, anchor) {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  $('markers').appendChild(el);
  tags.push({ el, anchor });
  return el;
}
for (const cam of streetCams) addTag('cam-marker', `<span class="box"></span><span>${cam.name}</span>`, cam.anchor);
for (const b of world.blocks) addTag('block-tag', b.name, new THREE.Vector3(b.x, 0.2, b.z));
const carAnchor = new THREE.Vector3();
const track = addTag('track', '<span class="track-label" id="track-label"></span>', carAnchor);

const tmp = new THREE.Vector3();
const edge = new THREE.Vector3();
function placeTags() {
  carAnchor.set(car.x, 1, car.z);
  for (const { el, anchor } of tags) {
    tmp.copy(anchor).project(drone.camera);
    const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 0.96 && Math.abs(tmp.y) < 0.92;
    el.hidden = !onScreen;
    if (onScreen) {
      el.style.left = `${(tmp.x * 0.5 + 0.5) * 100}%`;
      el.style.top = `${(-tmp.y * 0.5 + 0.5) * 100}%`;
    }
  }
  // Size the tracking box to the car as seen from up here.
  edge.set(3, 0, 0).applyQuaternion(drone.camera.quaternion).add(carAnchor).project(drone.camera);
  tmp.copy(carAnchor).project(drone.camera);
  const px = Math.max(26, Math.abs(edge.x - tmp.x) * window.innerWidth);
  track.style.width = `${px}px`;
  track.style.height = `${px}px`;
  $('track-label').textContent = `TRK CAR-1 · ${car.kmh} KM/H`;
}

// ---- Input -----------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  // Driving keys must not scroll the page or press a focused button.
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    document.activeElement?.blur?.();
  }
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

  car.update(dt / 1000);
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
      placeTags();
      world.rain?.setCenter(droneControl.target.x, droneControl.target.y);
    } else {
      world.rain?.setCenter(active.target[0], active.target[2]);
    }
    world.update(shot, renderer.domElement.height);
    pipeline.render(shot, n);
    if (active === drone) {
      // The targeting overlay, crisp on top of the degraded video.
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      renderer.clearDepth();
      renderer.render(world.overlay, drone.camera);
      renderer.autoClear = true;
    }
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
window.pak = { server, world, pipeline, car, drone: droneControl, hack: (id) => hack(world.cameras.get(id)), backToDrone };
