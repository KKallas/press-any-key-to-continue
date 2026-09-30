// The client's picture of the world, built only from events.
// It never decides anything; it draws what the log says happened.

import * as THREE from 'three';
import { factories } from './factories.js';
import { createStreet } from '../engine/ground.js';
import { Rain, LensRain } from '../engine/rain.js';
import { markingsTexture, roadMarkingsTexture } from '../engine/textures.js';
import { buildingOutline, blockOutlines } from '../engine/overlay.js';
import { buildDecoBlock } from './deco.js';
import { collisionMap } from '../engine/collision.js';

// Road surface of a generated city as a bitmap, 2 px per metre: the blocks
// are painted solid, everything else is tarmac. Not a barrier: the car can
// climb a kerb, it just goes slower off the road.
function drivableMask(bounds, blocks, margin) {
  const ppm = 2;
  const w = Math.ceil((bounds.maxX - bounds.minX) * ppm);
  const h = Math.ceil((bounds.maxZ - bounds.minZ) * ppm);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineWidth = margin * 2 * ppm;
  g.lineJoin = 'round';
  for (const b of blocks) {
    g.beginPath();
    b.polygon.forEach(([x, z], i) => {
      const px = (x - bounds.minX) * ppm;
      const pz = (z - bounds.minZ) * ppm;
      if (i) g.lineTo(px, pz);
      else g.moveTo(px, pz);
    });
    g.closePath();
    g.fill();
    g.stroke();
  }
  const data = g.getImageData(0, 0, w, h).data;
  const edge = 2;
  return (x, z) => {
    if (x < bounds.minX + edge || x > bounds.maxX - edge || z < bounds.minZ + edge || z > bounds.maxZ - edge) return false;
    const px = Math.floor((x - bounds.minX) * ppm);
    const pz = Math.floor((z - bounds.minZ) * ppm);
    return data[(pz * w + px) * 4] < 128;
  };
}

export class World {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020304);
    this.entities = new Map();
    this.cameras = new Map();
    this.updaters = [];
    this.rainLights = [];
    this.street = null;
    this.rain = null;
    // What the targeting system knows: line segments for the drone's HUD.
    this.overlaySegments = [];
    this.blocks = [];
    // Physical barriers (building footprints, posts) and ways in (doors).
    this.obstacles = [];
    this.posts = [];
    this.doors = [];

    // Cold fill from a sky nobody has written yet.
    this.scene.add(new THREE.HemisphereLight(0x4a7480, 0x080808, 2.2));
    // A cold moon somewhere behind the rain: one lit face, one dark face,
    // so buildings read as shapes and not as holes in the night.
    const moon = new THREE.DirectionalLight(0x8fb4c8, 1.1);
    moon.position.set(-0.6, 1, 0.35);
    this.scene.add(moon);
  }

  apply(event) {
    switch (event.type) {
      case 'spawn':
        return this.spawn(event);
      case 'despawn':
        return this.despawn(event.id);
      case 'move':
        return this.move(event);
      case 'enter':
      case 'exit':
        // Interiors come later; for now the skin just disappears inside.
        return this.move({ id: event.id, props: { ...event.props, visible: event.type === 'exit' } });
      default:
        console.warn('Unknown event', event);
    }
  }

  spawn({ id, kind, props }) {
    if (this.entities.has(id)) this.despawn(id);

    if (kind === 'camera' || kind === 'drone') {
      const cam = new THREE.PerspectiveCamera(props.fov, 1, 0.5, kind === 'drone' ? 1200 : 400);
      const entry = { id, kind, camera: cam, ...props };
      if (kind === 'camera') {
        cam.position.set(...props.position);
        cam.lookAt(new THREE.Vector3(...props.target));
        const housing = factories['camera-housing'](props);
        this.scene.add(housing.object);
        entry.housing = housing.object;
        entry.anchor = new THREE.Vector3(...props.position);
        this.entities.set(id, { kind, object: housing.object });
      }
      this.cameras.set(id, entry);
      return;
    }

    if (kind === 'weather') {
      this.scene.fog = new THREE.FogExp2(0x0b1519, props.fog);
      this.baseFog = props.fog;
      this.rain = new Rain({ center: [0, 0, 0], area: [90, 90], height: 34, wind: props.wind });
      this.rain.setLights(this.rainLights);
      this.scene.add(this.rain.group);
      this.lensRain = new LensRain();
      this.scene.add(this.lensRain.points);
      this.entities.set(id, { kind, object: this.rain.group });
      return;
    }

    if (kind === 'street') {
      const markings = markingsTexture(props.size, props.roadWidth, props.roads, props.seed);
      this.roads = { list: props.roads, half: props.roadWidth / 2, edge: props.size / 2, bounds: props.bounds };
      const { list, half, edge } = this.roads;
      const m = half - 1.1;
      this.surface = (x, z) => list.some((q) => Math.abs(x - q) < m) || list.some((q) => Math.abs(z - q) < m);
      this.bounds = { minX: -edge, maxX: edge, minZ: -edge, maxZ: edge };
      this.limit = edge - 10;
      this.overlaySegments.push(...blockOutlines(props.roads, props.roadWidth / 2));
      const r = props.roads;
      let n = 1;
      for (let j = 0; j < r.length - 1; j++) {
        for (let i = 0; i < r.length - 1; i++) {
          this.blocks.push({ name: `BLK ${String(n++).padStart(2, '0')}`, x: (r[i] + r[i + 1]) / 2, z: (r[j] + r[j + 1]) / 2 });
        }
      }
      this.street = createStreet({ size: props.size, roadWidth: props.roadWidth, markings });
      this.scene.add(this.street.group);
    }

    if (kind === 'city-base') {
      const b = props.bounds;
      const size = 2 * Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minZ), Math.abs(b.maxZ)) + 40;
      this.street = createStreet({ size, roadWidth: 10, markings: roadMarkingsTexture(size, props.roads, props.seed) });
      this.scene.add(this.street.group);
      this.surface = drivableMask(b, props.blocks, 0);
      this.bounds = b;
      this.limit = Math.max(b.maxX, b.maxZ, -b.minX, -b.minZ) - 10;
      props.blocks.forEach((blk, i) => {
        const pts = blk.polygon;
        for (let k = 0; k < pts.length; k++) {
          const a = pts[k];
          const c = pts[(k + 1) % pts.length];
          this.overlaySegments.push({ a: [a[0], 0.2, a[1]], b: [c[0], 0.2, c[1]], alphaA: 0.45, alphaB: 0.45, dashed: true });
        }
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        this.blocks.push({ name: `BLK ${String(i + 1).padStart(2, '0')}`, x: cx, z: cz });
      });
    }

    if (kind === 'deco-block') {
      for (const p of props.plots) {
        this.obstacles.push(p.footprint);
        for (const d of p.doors ?? []) {
          this.doors.push({ plot: p.id, ...d, hx: d.x + d.nx * 1.3, hz: d.z + d.nz * 1.3 });
        }
      }
      const built = buildDecoBlock(props.plots);
      built.overlayStart = this.overlaySegments.length;
      this.overlaySegments.push(...built.outline);
      built.overlayCount = built.outline.length;
      this.scene.add(built.object);
      this.entities.set(id, { kind, ...built });
      return;
    }

    const make = factories[kind];
    if (!make) {
      console.warn(`No factory for "${kind}"`);
      return;
    }
    const built = make(props);
    this.scene.add(built.object);
    if (kind === 'building') {
      this.overlaySegments.push(...buildingOutline(props));
      const { x, z, w, d } = props;
      this.obstacles.push([[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]]);
    }
    if (kind === 'lamp' || kind === 'traffic-light') this.posts.push({ x: props.x, z: props.z, r: 0.2 });
    if (kind === 'terminal') this.posts.push({ x: props.x, z: props.z, r: 0.6 });
    if (built.update) this.updaters.push(built.update);
    if (built.rainLights) {
      this.rainLights.push(...built.rainLights);
      this.rain?.setLights(this.rainLights);
    }
    this.entities.set(id, { kind, ...built });
  }

  // Haze depends on where you look from: thick at street level, thin from altitude.
  useCamera(entry) {
    if (this.scene.fog) this.scene.fog.density = entry.fog ?? this.baseFog;
    for (const c of this.cameras.values()) if (c.housing) c.housing.visible = c !== entry;
  }

  move({ id, props }) {
    const e = this.entities.get(id);
    if (!e) return;
    e.object.position.x = props.x;
    e.object.position.z = props.z;
    if (props.heading !== undefined) e.object.rotation.y = props.heading;
    // Up on the kerb when off the road, and higher still in the air.
    if (this.surface) e.object.position.y = (this.surface(props.x, props.z) ? 0 : 0.15) + (props.air ?? 0);
    if (props.pitch !== undefined) e.object.rotation.z = props.pitch;
    if (props.visible !== undefined) e.object.visible = props.visible;
    e.state = { ...e.state, ...props };
  }

  // Once every spawn has arrived: what stops a car, and what stops a person.
  finalize() {
    const b = this.bounds;
    this.carFree = collisionMap(b, this.obstacles, this.posts, 1.1, 2);
    this.footFree = collisionMap(b, this.obstacles, this.posts, 0.3, 4);
  }

  despawn(id) {
    const e = this.entities.get(id);
    if (!e) return;
    this.scene.remove(e.object);
    if (e.update) this.updaters = this.updaters.filter((u) => u !== e.update);
    this.entities.delete(id);
  }

  update(time, viewportHeight) {
    for (const u of this.updaters) u(time);
    this.rain?.update(time, viewportHeight);
    this.street?.update(time);
  }
}
