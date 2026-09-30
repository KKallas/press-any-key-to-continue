// The client's picture of the world, built only from events.
// It never decides anything; it draws what the log says happened.

import * as THREE from 'three';
import { factories } from './factories.js';
import { createStreet } from '../engine/ground.js';
import { Rain } from '../engine/rain.js';
import { markingsTexture } from '../engine/textures.js';

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

    // Cold fill from a sky nobody has written yet.
    this.scene.add(new THREE.HemisphereLight(0x4a7480, 0x080808, 1.5));
  }

  apply(event) {
    switch (event.type) {
      case 'spawn':
        return this.spawn(event);
      case 'despawn':
        return this.despawn(event.id);
      default:
        console.warn('Unknown event', event);
    }
  }

  spawn({ id, kind, props }) {
    if (this.entities.has(id)) this.despawn(id);

    if (kind === 'camera') {
      const cam = new THREE.PerspectiveCamera(props.fov, 1, 0.5, 400);
      cam.position.set(...props.position);
      cam.lookAt(new THREE.Vector3(...props.target));
      this.cameras.set(id, { id, camera: cam, ...props });
      return;
    }

    if (kind === 'weather') {
      this.scene.fog = new THREE.FogExp2(0x0b1519, props.fog);
      this.rain = new Rain({ center: [0, 0, 0], area: [80, 80], height: 34, wind: props.wind });
      this.rain.setLights(this.rainLights);
      this.scene.add(this.rain.group);
      this.entities.set(id, { kind, object: this.rain.group });
      return;
    }

    if (kind === 'street') {
      const markings = markingsTexture(props.size, props.roadWidth, props.sidewalk, props.seed);
      this.street = createStreet({ size: props.size, roadWidth: props.roadWidth, markings });
      this.scene.add(this.street.group);
    }

    const make = factories[kind];
    if (!make) {
      console.warn(`No factory for "${kind}"`);
      return;
    }
    const built = make(props);
    this.scene.add(built.object);
    if (built.update) this.updaters.push(built.update);
    if (built.rainLights) {
      this.rainLights.push(...built.rainLights);
      this.rain?.setLights(this.rainLights);
    }
    this.entities.set(id, { kind, ...built });
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
