// Engine core entry point: connect to the (local) server, subscribe to the
// block, build the world from events, then look at it through a drone or
// through whichever street camera the player has hacked into.

import * as THREE from 'three';
import { LocalServer } from './net/local-server.js';
import { NetServer } from './net/net-server.js';
import { login } from './game/login.js';
import { World } from './world/world.js';
import { BLOCK_01 } from './world/block01.js';
import { cityToEvents } from './world/city.js';
import { Pipeline, GRADE_DEFAULTS } from './engine/pipeline.js';
import { TIERS, AutoQuality } from './engine/quality.js';
import { DroneControl } from './engine/drone.js';
import { CarControl } from './engine/car.js';
import { Hud } from './engine/hud.js';
import { WalkerControl } from './engine/walker.js';
import { NavGrid } from './engine/nav.js';
import { RoadGraph } from './engine/roads.js';
import { Autopilot } from './engine/autopilot.js';
import { pathLength } from './engine/nav.js';
import { MapScreen, Snow } from './engine/monitors.js';
import { Sound } from './engine/audio.js';
import { Mission } from './game/mission.js';
import { Pursuit } from './game/pursuit.js';
import { buildInterior } from './world/interior.js';

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

// Which world: a generated city (cities/<name>.json, made by tools/citygen),
// or the hand-built test block. Add #block01 to the address for the latter.
const CITY = 'west-oakland';
async function loadWorld() {
  if (location.hash === '#block01') return { block: 'B01', events: BLOCK_01 };
  try {
    const res = await fetch(`cities/${CITY}.json`);
    if (!res.ok) throw new Error(res.status);
    return cityToEvents(await res.json());
  } catch (e) {
    console.warn('No generated city, using the test block.', e);
    return { block: 'B01', events: BLOCK_01 };
  }
}
const { block: BLOCK, events: LOG } = await loadWorld();

// Server and world. Try the shared world (a running game server on this
// origin); fall back to solo play if there's none, or if the address says
// #solo. Signing in is an injection at the front page (see login.js).
let server = null;
let net = null;
try {
  const status = location.hash === '#solo' ? null : await fetch('/api/status').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (status) {
    const user = await login('/api/status', '/api/signup', '/api/login');
    net = new NetServer({
      log: LOG,
      block: BLOCK,
      token: user.token,
      me: { car: 'car1', skin: 'skin' },
      onRoster: (roster) => {
        const el = document.getElementById('online');
        if (el) el.textContent = `${roster.size} ONLINE`;
      },
    });
    const ok = await net.connect();
    if (ok) {
      server = net;
      window.__me = user;
    } else {
      net = null;
    }
  }
} catch (e) {
  console.warn('No shared world; solo.', e);
}
if (!server) server = new LocalServer(LOG);

const world = new World();
server.subscribe((e) => e.block === BLOCK, (e) => world.apply(e));
world.finalize();

const DRONE_ID = 'UAV-2';
const drone = world.cameras.get(DRONE_ID);
// Only the drone sees the rain falling past its own lens.
drone.camera.layers.enable(1);
const droneControl = new DroneControl(drone, canvas);
const streetCams = [...world.cameras.values()].filter((c) => c.kind === 'camera');
let active = drone;

// The player is a skin: in the car, on foot, or inside a building.
let mode = 'car';
let insideDoor = null;

const carSpawn = LOG.find((e) => e.id === 'car1').props;
const car = new CarControl({
  server,
  block: BLOCK,
  id: 'car1',
  start: { x: carSpawn.x, z: carSpawn.z, heading: carSpawn.heading },
  free: world.carFree,
  surface: world.surface,
});

// The skin's body, hidden while it sits in the car.
server.append({ block: BLOCK, type: 'spawn', kind: 'person', id: 'skin',
  props: { x: car.x, z: car.z, coat: '#8f8574', heading: 0 } });
server.append({ block: BLOCK, type: 'move', transient: true, id: 'skin', props: { x: car.x, z: car.z, visible: false } });
const walker = new WalkerControl({
  server,
  block: BLOCK,
  id: 'skin',
  free: world.footFree,
  // Screen-up on the ground, from the drone's orbit angle.
  up: () => [-Math.sin(droneControl.theta), -Math.cos(droneControl.theta)],
});

// Route planning: a coarse grid for the car, a finer one for a person.
const carNav = new NavGrid({ bounds: world.bounds, free: world.carFree, surface: world.surface, green: world.green, cell: 1 });
// The street network, for driving in lane like everyone else.
const roads = world.roadLines ? new RoadGraph(world.roadLines, world.bounds) : null;
const footNav = new NavGrid({ bounds: world.bounds, free: world.footFree, surface: world.surface, cell: 0.5 });
const autopilot = new Autopilot({
  car,
  plan: (from, to, m) => carNav.findPath(from, to, { offRoad: m.offRoad, green: m.green }),
  road: roads ? (from, heading, to) => roads.route(from, heading, to) : null,
  blocked: (x, z) => carNav.block(x, z, 1.5),
  see: (a, b) => carNav.clear(a, b, 1),
});

// The law: patrols, roadblocks, agents. Needs the street network.
const pursuit = roads
  ? new Pursuit({ server, block: BLOCK, world, roads, carNav, player: { car, walker, mode: () => mode } })
  : null;
if (pursuit) car.free = pursuit.playerFree();

// The link: somewhere to be, by a time on the clock.
const mission = roads
  ? new Mission({
      doors: world.doors,
      route: (from, to) => {
        const r = roads.route(from, car.heading, to);
        return r ? pathLength(r.pts) : null;
      },
    })
  : null;

// The side monitors.
const mapScreen = world.blockPolys
  ? new MapScreen($('map'), { bounds: world.bounds, blocks: world.blockPolys, roads: world.roadLines, greens: world.greens })
  : null;
const snow = new Snow([...document.querySelectorAll('canvas.snow')]);
const sound = new Sound();

droneControl.limit = world.limit ?? 70;
droneControl.lock = () =>
  mode === 'car'
    ? { x: car.x, z: car.z, vx: Math.cos(car.heading) * car.speed, vz: -Math.sin(car.heading) * car.speed, speed: car.speed }
    : { x: walker.x, z: walker.z, vx: 0, vz: 0, speed: 0, foot: true };

// Doors and the car within reach of the skin, nearest first.
const REACH_DOOR = 1.8;
const REACH_CAR = 3.2;
function nearestDoor() {
  let best = null;
  let bd = REACH_DOOR;
  for (const d of world.doors) {
    const dist = Math.hypot(d.hx - walker.x, d.hz - walker.z);
    if (dist < bd) {
      bd = dist;
      best = d;
    }
  }
  return best;
}
function carInReach() {
  return Math.hypot(car.x - walker.x, car.z - walker.z) < REACH_CAR;
}

// E: out of the car, into a building, back out, back into the car.
function use() {
  if (mode === 'car') {
    if (Math.abs(car.speed) > 3) return; // not while moving
    // Out on the driver's side, or wherever there's room.
    const side = car.heading + Math.PI / 2;
    const placed = walker.place(car.x + Math.cos(side) * 2.2, car.z - Math.sin(side) * 2.2);
    if (!placed) return;
    car.occupied = false;
    autopilot.cancel();
    walker.active = true;
    mode = 'foot';
  } else if (mode === 'foot') {
    const door = nearestDoor();
    if (door) {
      insideDoor = door;
      walker.route = null;
      walker.active = false;
      mode = 'inside';
      server.append({ block: BLOCK, type: 'enter', id: 'skin', props: { plot: door.plot, x: walker.x, z: walker.z } });
      // The feed cuts to the building's own camera.
      interior = buildInterior(door.plot, door.plot.length * 7 + door.plot.charCodeAt(door.plot.length - 1));
      loss = 1;
      setActive(interior);
    } else if (carInReach()) {
      walker.active = false;
      walker.route = null;
      car.occupied = true;
      mode = 'car';
      server.append({ block: BLOCK, type: 'move', transient: true, id: 'skin', props: { x: car.x, z: car.z, visible: false } });
    }
  } else if (mode === 'inside') {
    walker.place(insideDoor.hx, insideDoor.hz, false);
    server.append({ block: BLOCK, type: 'exit', id: 'skin', props: { plot: insideDoor.plot, x: walker.x, z: walker.z } });
    walker.active = true;
    mode = 'foot';
    insideDoor = null;
    interior = null;
    loss = 0.8;
    setActive(drone);
  }
  syncHint();
}

let interior = null;

// An agent got to the skin. It's gone; the player wakes in a new one,
// somewhere else, with a car.
function skinLost() {
  loss = 1;
  say('SKIN LOST · NEW SKIN', 3);
  autopilot.cancel();
  walker.route = null;
  walker.active = false;
  if (mode === 'inside') setActive(drone);
  interior = null;
  insideDoor = null;
  const a = pursuit.agent.car;
  const [spot] = pursuit.randomRoadSpots(1, [a.x, a.z], 160, 450);
  if (spot) car.place(spot[0], spot[1], spot[2], { visible: true });
  car.occupied = true;
  mode = 'car';
  server.append({ block: BLOCK, type: 'move', transient: true, id: 'skin', props: { x: car.x, z: car.z, visible: false } });
  pursuit.reset();
  droneControl.target.set(car.x, car.z);
  droneControl.locked = true;
  syncHint();
}
const hud = new Hud();

// Quality.
const pipeline = new Pipeline(renderer);
let tierName = 'high';
let auto = true;
const autoQ = new AutoQuality((next) => applyTier(next, true));

function size() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const tier = TIERS[tierName];
  // The feed fills the main monitor's tube, whatever size the rack gives it.
  const w = Math.max(1, Math.round((canvas.clientWidth || window.innerWidth) * dpr * tier.scale));
  const h = Math.max(1, Math.round((canvas.clientHeight || window.innerHeight) * dpr * tier.scale));
  return [w, h];
}

function rebuild() {
  const tier = TIERS[tierName];
  const [w, h] = size();
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  active.camera.aspect = w / h;
  active.camera.updateProjectionMatrix();
  if (!active.interior) world.useCamera(active);
  hud.resize(w / h);
  world.street?.setReflection(tier.reflection, w, h);
  world.rain?.setDensity(tier.rain);
  pipeline.build(active.scene ?? world.scene, active.camera, tier, active.lens, w, h);
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

// ---- Grade tuning -------------------------------------------------------------
// Sliders for every part of the grade, plus the rain at the lens. Settings
// are remembered in this browser; COPY gives them as code for the defaults.

const TUNE = [
  { key: 'exposure', label: 'EXPOSURE', min: 0.4, max: 2.5, step: 0.05 },
  { key: 'strength', label: 'STRENGTH', min: 0, max: 1, step: 0.05 },
  { key: 'bleach', label: 'BLEACH', min: 0, max: 1, step: 0.05 },
  { key: 'contrast', label: 'CONTRAST', min: 0, max: 1, step: 0.05 },
  { key: 'lift', label: 'SHADOW LIFT', min: 0, max: 1, step: 0.05 },
  { key: 'color', label: 'COLOUR', min: 0, max: 1, step: 0.05 },
  { key: 'tint', label: 'GREEN TINT', min: 0, max: 1.5, step: 0.05 },
  { key: 'lensRain', label: 'LENS RAIN', min: 0, max: 1, step: 0.05 },
];
const TUNE_DEFAULTS = { ...GRADE_DEFAULTS, lensRain: 0.7 };
const STORE = 'pak.grade';
let tune = { ...TUNE_DEFAULTS };
try {
  tune = { ...tune, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
} catch {
  /* storage unavailable: defaults it is */
}

function applyTune(save = true) {
  pipeline.setGradeParams(tune);
  world.lensRain?.setAmount(tune.lensRain);
  for (const t of TUNE) {
    $(`tune-${t.key}`).value = tune[t.key];
    $(`tune-${t.key}-v`).textContent = Number(tune[t.key]).toFixed(2);
  }
  if (save) {
    try {
      localStorage.setItem(STORE, JSON.stringify(tune));
    } catch {
      /* not remembered, still applied */
    }
  }
}

for (const t of TUNE) {
  const row = document.createElement('div');
  row.className = 'tune-row';
  row.innerHTML = `<label for="tune-${t.key}">${t.label}</label>
    <input type="range" id="tune-${t.key}" min="${t.min}" max="${t.max}" step="${t.step}">
    <output id="tune-${t.key}-v" for="tune-${t.key}"></output>`;
  $('tune-rows').appendChild(row);
  $(`tune-${t.key}`).addEventListener('input', (e) => {
    tune[t.key] = Number(e.target.value);
    applyTune();
  });
}
// Keys typed into the panel must not drive the car.
$('tune-panel').addEventListener('keydown', (e) => e.stopPropagation());
$('tune').addEventListener('click', () => {
  const open = $('tune-panel').hidden;
  $('tune-panel').hidden = !open;
  $('tune').setAttribute('aria-expanded', String(open));
});
$('tune-close').addEventListener('click', () => $('tune').click());
$('tune-reset').addEventListener('click', () => {
  tune = { ...TUNE_DEFAULTS };
  applyTune();
});
$('tune-copy').addEventListener('click', () => {
  const text = JSON.stringify(tune, null, 2);
  const out = $('tune-out');
  out.value = text;
  out.hidden = false;
  const done = () => {
    $('tune-copy').textContent = 'COPIED';
    setTimeout(() => ($('tune-copy').textContent = 'COPY'), 1500);
  };
  navigator.clipboard?.writeText(text).then(done, () => out.select()) ?? out.select();
});

// ---- Switching feeds -------------------------------------------------------

let lastFrame = -1;
let loss = 0; // signal loss, 1 = pure snow
let hackTimer = null;

function setActive(entry) {
  active = entry;
  lastFrame = -1;
  droneControl.enabled = entry === drone;
  pipeline.setHud(entry === drone ? hud.texture : null);
  document.body.classList.toggle('mode-drone', entry.kind === 'drone');
  $('cam-name').textContent = entry.name;
  $('cam-desc').textContent = entry.description;
  syncHint();
  rebuild();
}

function syncHint() {
  const common = 'DRAG LOOK · F TRACK · Z X ORBIT';
  $('pgm-name').textContent = active.name;
  $('hint').textContent = active.interior ? 'E · LEAVE THE BUILDING'
    : active.kind !== 'drone'
    ? 'ESC · BACK TO DRONE    TAB · NEXT CAMERA'
    : mode === 'car' ? `CLICK DRIVE · DOUBLE-CLICK FLAT OUT · E GET OUT · ${common}`
    : mode === 'foot' ? `CLICK WALK · DOUBLE-CLICK RUN · E USE · ${common}`
    : 'E · LEAVE THE BUILDING';
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
  if (!streetCams.length) return;
  const i = streetCams.indexOf(active);
  hack(streetCams[(i + 1) % streetCams.length]);
}

// What the drone's HUD draws: the city's wireframes, known cameras, block
// names and the tracking box, all burned into the video signal.
const hudCams = streetCams.map((c) => ({ name: c.name, pos: c.position }));
function clockText(elapsed) {
  return `23:59:${String(Math.floor(elapsed) % 60).padStart(2, '0')}`;
}
function trackInfo() {
  const tag = droneControl.locked ? 'TRK ' : '';
  if (mode === 'car') return { pos: [car.x, 1, car.z], kmh: car.kmh, label: `${tag}CAR-1  ${car.kmh} KM/H`, size: 3 };
  if (mode === 'foot') return { pos: [walker.x, 1, walker.z], kmh: Math.round(walker.speed * 3.6), label: `${tag}SKIN  ON FOOT`, size: 1.2 };
  return { pos: [insideDoor.x, 1, insideDoor.z], kmh: 0, label: `${tag}SKIN  INSIDE ${insideDoor.plot.toUpperCase()}`, size: 1.6 };
}

// What E would do right now, shown next to the skin.
let flash = { text: '', until: 0 };
function say(text, secs = 1.6) {
  flash = { text, until: performance.now() + secs * 1000 };
}

function promptText() {
  if (performance.now() < flash.until) return flash.text;
  if (mode === 'car') {
    if (autopilot.route) return `AUTO ${autopilot.mode === 'stunt' ? 'FLAT OUT' : 'DRIVE'}  ${Math.round(autopilot.remaining())} M  ${autopilot.route.label ?? ''}`.trim();
    if (car.air > 0) return 'AIRBORNE';
    return Math.abs(car.speed) > 3 ? '' : '[E] GET OUT';
  }
  if (walker.route) return `${walker.route.run ? 'RUN' : 'WALK'}  ${walker.route.label ?? ''}`.trim();
  if (mode === 'inside') return '[E] LEAVE';
  const door = nearestDoor();
  if (door) return `[E] ENTER ${door.plot.toUpperCase()}`;
  if (carInReach()) return '[E] GET IN';
  return '';
}

// The route being followed, for the HUD: from the body to the waypoint.
function routeForHud() {
  if (mode === 'car' && autopilot.route) {
    const r = autopilot.route;
    return { pts: [[car.x, car.z], ...r.pts.slice(r.i)], goal: r.goal, stunt: r.mode === 'stunt' };
  }
  if (mode === 'foot' && walker.route) {
    const r = walker.route;
    return { pts: [[walker.x, walker.z], ...r.pts.slice(r.i)], goal: r.pts[r.pts.length - 1], stunt: r.run };
  }
  return null;
}

// What's under the pointer: the one building whose outline the HUD shows.
const pointer = { x: 0, y: 0, on: false };
canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.on = true;
});
canvas.addEventListener('pointerleave', () => (pointer.on = false));
const hoverRay = new THREE.Raycaster();
function buildingAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  hoverRay.setFromCamera(ndc, drone.camera);
  return world.hitBuilding(hoverRay.ray.origin, hoverRay.ray.direction)?.id ?? null;
}
function hoveredBuilding() {
  return pointer.on ? buildingAt(pointer.x, pointer.y) : null;
}

// The body's shape as points on it, in its own frame, taken once from its
// meshes (light cones left out): the HUD outlines it when a wall is in the way.
const bodyPointsCache = new Map();
function bodyPoints(id) {
  if (bodyPointsCache.has(id)) return bodyPointsCache.get(id);
  const obj = world.entities.get(id)?.object;
  if (!obj) return [];
  obj.updateMatrixWorld(true);
  const inv = obj.matrixWorld.clone().invert();
  const pts = [];
  obj.traverse((m) => {
    if (!m.isMesh || m.material.blending === THREE.AdditiveBlending) return;
    const pos = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 80));
    for (let i = 0; i < pos.count; i += step) {
      pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv));
    }
  });
  bodyPointsCache.set(id, pts);
  return pts;
}

// Is the skin (or its car) behind a building, as the drone sees it? Then
// hand the HUD its outline in world points.
const sight = new THREE.Vector3();
const tmp = new THREE.Vector3();
function ghostOutline() {
  if (mode === 'inside') return null;
  const id = mode === 'car' ? 'car1' : 'skin';
  const obj = world.entities.get(id)?.object;
  if (!obj) return null;
  const eye = drone.camera.getWorldPosition(new THREE.Vector3());
  sight.set(obj.position.x, obj.position.y + 1, obj.position.z).sub(eye);
  const dist = sight.length();
  if (!world.hitBuilding(eye, sight.normalize(), dist - 0.3)) return null;
  obj.updateMatrixWorld();
  return bodyPoints(id).map((p) => tmp.copy(p).applyMatrix4(obj.matrixWorld).toArray());
}

function drawHud(time) {
  const near = mode === 'car' ? [] : world.doors.filter((d) => Math.hypot(d.hx - walker.x, d.hz - walker.z) < 45);
  hud.draw({
    camera: drone.camera,
    segments: world.overlaySegments,
    blocks: world.blocks,
    cams: hudCams,
    doors: near,
    route: routeForHud(),
    hover: hoveredBuilding(),
    ghost: ghostOutline(),
    contacts: pursuit?.contacts(),
    link: mission?.target && mission.state === 'open'
      ? { pos: [mission.target.hx, 0.3, mission.target.hz], label: `LINK ${mission.clock}  T-${Math.ceil(mission.left(time))}` }
      : null,
    activeDoor: mode === 'foot' ? nearestDoor() : null,
    prompt: promptText(),
    track: trackInfo(),
    telemetry: droneControl.telemetry(),
    name: drone.name,
    description: drone.description,
    clock: clockText(time),
    time,
  });
}

// ---- Clicks: set a waypoint -----------------------------------------------
// One click: go there sensibly. Two quick clicks: as fast as possible (the
// car takes the fastest line, drifts and jumps kerbs; on foot, run).

const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function groundAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, drone.camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(ground, p) ? [p.x, p.z] : null;
}

// The door of a building to go to. On foot, the nearest one. By car, the one
// nearest the kerb, so the car can park right by it (then the nearest).
function doorOf(plot, from, byCar = false) {
  let best = null;
  let bd = Infinity;
  for (const d of world.doors) {
    if (d.plot !== plot) continue;
    const kerb = byCar && roads ? roads.nearest(d.hx, d.hz).d : 0;
    const dd = kerb * 10 + Math.hypot(d.hx - from[0], d.hz - from[1]);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  return best;
}

// building: the building clicked on, if any. In the car that means "take me
// to its door": the nearest one, parked as close as the car can get.
function waypoint([x, z], fast, building = null) {
  if (mode === 'car') {
    const door = building ? doorOf(building, [car.x, car.z], true) : null;
    const goal = door ? [door.hx, door.hz] : [x, z];
    if (!autopilot.go(goal, fast ? 'stunt' : 'normal')) say('NO ROUTE');
    else {
      autopilot.route.label = door ? `TO ${door.plot.toUpperCase()}` : '';
      autopilot.route.door = door;
      if (!door && !autopilot.route.reached) say(autopilot.route.parking ? 'PARKING AT THE KERB' : 'CAN\'T GET CLOSER BY CAR');
    }
    return;
  }
  if (mode !== 'foot') return;
  // A door or the car near the click, or a building: walk there and use it.
  let door = building ? doorOf(building, [walker.x, walker.z]) : null;
  let bd = 3;
  for (const d of door ? [] : world.doors) {
    const dd = Math.hypot(d.hx - x, d.hz - z);
    if (dd < bd) {
      bd = dd;
      door = d;
    }
  }
  const toCar = !door && Math.hypot(car.x - x, car.z - z) < 3.5;
  const target = door ? [door.hx, door.hz] : [x, z];
  const pts = footNav.findPath([walker.x, walker.z], target, { offRoad: 1 });
  if (!pts || !walker.follow(pts, fast, door || toCar ? use : null)) {
    say('NO WAY THROUGH');
    return;
  }
  walker.route.label = door ? `TO ${door.plot.toUpperCase()}` : toCar ? 'TO CAR-1' : '';
}

let pendingClick = null;
droneControl.onClick = (cx, cy) => {
  const at = groundAt(cx, cy);
  if (!at) return;
  const building = buildingAt(cx, cy);
  if (pendingClick) {
    clearTimeout(pendingClick.timer);
    pendingClick = null;
    waypoint(at, true, building);
    return;
  }
  pendingClick = { timer: setTimeout(() => { pendingClick = null; waypoint(at, false, building); }, 260) };
};

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
  else if (e.key === 'Escape' && !active.interior) backToDrone();
  else if ((e.key === 'e' || e.key === 'E' || e.key === 'Enter') && (active === drone || active.interior) && !e.repeat) use();
  else if (e.key === 'Tab') {
    e.preventDefault();
    nextCamera();
  }
});

let resizeTimer;
const onResize = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rebuild, 150);
};
window.addEventListener('resize', onResize);
new ResizeObserver(onResize).observe(canvas);

// ---- On-screen display ------------------------------------------------------

const t0 = performance.now();
function osd(elapsed) {
  // The seconds loop inside the last minute of 1999.
  const s = Math.floor(elapsed) % 60;
  $('time').textContent = `23:59:${String(s).padStart(2, '0')}`;
  $('rec-dot').classList.toggle('off', Math.floor(elapsed * 1.25) % 2 === 1);
}

// ---- The game: the link, the law, the side monitors ---------------------------

function playerAt() {
  if (mode === 'car') return [car.x, car.z];
  if (mode === 'foot') return [walker.x, walker.z];
  return [insideDoor.hx, insideDoor.hz];
}

let missionStart = 3;
let monitorT = 0;
function game(dt, time) {
  if (pursuit) {
    pursuit.update(dt, time);
    for (const ev of pursuit.events) {
      if (ev === 'wanted') say('WANTED · POLICE PURSUIT', 2.5);
      else if (ev === 'roadblock-set') say('ROADBLOCK AHEAD', 2.5);
      else if (ev === 'agents') say('AGENTS ACTIVATED', 3);
      else if (ev === 'clear') say('HEAT OFF', 2);
      else if (ev === 'killed') skinLost();
    }
    sound.update(time, pursuit.cars.filter((c) => c.kind === 'police').map((c) => ({ id: c.id, x: c.car.x, z: c.car.z, on: c.siren && c.active })),
      [droneControl.target.x, droneControl.target.y]);
  }
  if (mission) {
    const [px, pz] = playerAt();
    if (mission.state === 'idle' && time > missionStart) mission.next(time, [px, pz]);
    const r = mission.state === 'idle' ? null : mission.update(time, { x: px, z: pz, insidePlot: mode === 'inside' ? insideDoor.plot : null });
    if (r === 'made') say('LINK ESTABLISHED', 3);
    else if (r === 'lost') say('LINK LOST', 3);
    else if (r === 'next') mission.next(time, [px, pz]);
    $('map-label').textContent = mission.state === 'open' ? `BY ${mission.clock}` : mission.state === 'made' ? 'MADE' : mission.state === 'lost' ? 'LOST' : 'LINK';
  }
  monitorT -= dt;
  if (monitorT <= 0) {
    monitorT = 1 / 8;
    mapScreen?.draw({
      now: time,
      car: [car.x, car.z, car.heading],
      skin: mode === 'foot' ? [walker.x, walker.z] : null,
      mission,
      pursuers: pursuit?.contacts(),
      players: net?.contacts(),
      heat: pursuit?.heat ?? 0,
      heatLabel: pursuit?.label(),
    });
    snow.draw(time);
  }
}

// ---- Loop --------------------------------------------------------------------

setActive(drone);
syncButtons();
applyTune(false);
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;

// Each camera records at its own frame rate. The world only moves when the
// active camera takes a frame, and the GPU rests in between.
function frame(now) {
  const dt = Math.min(now - last, 100);
  last = now;
  const time = (now - t0) / 1000;

  let input;
  if (mode === 'car' && autopilot.route) {
    if (car.keyboardActive) autopilot.cancel(); // hands on the wheel: manual
    else input = autopilot.update(dt / 1000) ?? undefined;
  }
  car.update(dt / 1000, input);
  walker.update(dt / 1000);
  game(dt / 1000, time);
  if (net) {
    net.setMode(mode);
    net.tick(now);
  }
  if (active === drone) droneControl.update(dt / 1000);
  loss = Math.max(0, loss - dt / 900);
  pipeline.setLoss(loss);

  const fps = active.lens.fps ?? 12.5;
  const n = Math.floor(time * fps);
  if (n !== lastFrame) {
    lastFrame = n;
    const shot = n / fps;
    if (active.interior) active.update(shot);
    if (active === drone) {
      droneControl.apply();
      drone.camera.updateMatrixWorld();
      drawHud(time);
      world.rain?.setCenter(droneControl.target.x, droneControl.target.y);
    } else {
      world.rain?.setCenter(active.target[0], active.target[2]);
    }
    world.update(shot, renderer.domElement.height);
    if (world.lensRain) world.lensRain.update(shot, active.camera, renderer.domElement.height);
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
window.pak = { net, mission, pursuit, interior: () => interior, skinLost, roads, doorOf, ghostOutline, hoveredBuilding, pointer, server, world, pipeline, car, walker, use, mode: () => mode, autopilot, carNav, footNav, waypoint, drone: droneControl, hack: (id) => hack(world.cameras.get(id)), backToDrone };
