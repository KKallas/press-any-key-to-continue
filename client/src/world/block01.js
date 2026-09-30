// The event log for Block 01, as the server would send it to a client that
// is watching CAM 07. Every entity arrives as a plain, serialisable event.
// Coordinates are metres: X runs east, Z runs south, Y is up. Two roads
// cross at the origin; each is 10 m wide with 3 m sidewalks.

const B = 'B01';

const building = (id, x, z, w, d, h, seed) => ({
  t: 0, block: B, type: 'spawn', kind: 'building', id,
  props: { x, z, w, d, h, seed },
});

export const BLOCK_01 = [
  { t: 0, block: B, type: 'spawn', kind: 'street', id: 'street',
    props: { size: 140, roadWidth: 10, sidewalk: 3, curb: 0.15, seed: 7 } },

  { t: 0, block: B, type: 'spawn', kind: 'weather', id: 'weather',
    props: { rain: 1.0, wind: [0.2, 0, 0.06], fog: 0.013 } },

  // North-west lot: the tall one, and the one with the hotel sign.
  building('b01', -14, -14, 10, 10, 34, 11),
  building('b02', -26, -13, 12, 9, 18, 12),
  building('b03', -13, -27, 9, 12, 46, 13),
  building('b04', -27, -27, 12, 12, 24, 14),
  // North-east lot.
  building('b05', 14, -14, 10, 10, 22, 21),
  building('b06', 26, -14, 12, 10, 30, 22),
  building('b07', 15, -27, 12, 12, 38, 23),
  // South-west lot.
  building('b08', -14, 14, 10, 10, 16, 31),
  building('b09', -26, 15, 12, 12, 28, 32),
  // South-east lot, under the camera. Kept low so the camera can see over it.
  building('b10', 14, 15, 10, 10, 6, 41),
  building('b11', 27, 15, 12, 12, 9, 42),

  // A walkway over the north road, between the two tallest towers.
  { t: 0, block: B, type: 'spawn', kind: 'skybridge', id: 'bridge1',
    props: { from: [-8.5, 28, -27], to: [9, 28, -27], width: 3, height: 2.6 } },

  // Streetlamps. The arm points towards the road.
  ...[
    ['lamp1', 6.6, -6.6, -1, 0],
    ['lamp2', -6.6, -6.6, 0, 1],
    ['lamp3', -6.6, 6.6, 1, 0],
    ['lamp4', 6.6, 6.6, 0, -1],
    ['lamp5', -21, -6.6, 0, 1],
    ['lamp6', 22, -6.6, 0, 1],
  ].map(([id, x, z, ax, az]) => ({
    t: 0, block: B, type: 'spawn', kind: 'lamp', id,
    props: { x, z, arm: [ax, az], height: 7, color: '#ff9a3c', intensity: 260 },
  })),

  // Neon. `face` is the direction the sign looks out towards.
  { t: 0, block: B, type: 'spawn', kind: 'neon', id: 'n-hotel',
    props: { text: 'HOTEL', vertical: true, x: -10.5, y: 13, z: -9, face: [0, 1], size: [1.6, 7], color: '#ff2fb4' } },
  { t: 0, block: B, type: 'spawn', kind: 'neon', id: 'n-baar',
    props: { text: 'BAAR', x: 12.5, y: 4.4, z: -9, face: [0, 1], size: [4.4, 1.3], color: '#ffae2f' } },
  { t: 0, block: B, type: 'spawn', kind: 'neon', id: 'n-arvutid',
    props: { text: 'ARVUTID', x: -9, y: 5.4, z: -13.5, face: [1, 0], size: [6, 1.2], color: '#35e6ff', flicker: true } },
  { t: 0, block: B, type: 'spawn', kind: 'neon', id: 'n-24h',
    props: { text: '24H', x: -9, y: 4, z: 13, face: [1, 0], size: [2.6, 1.1], color: '#59ff7a' } },

  { t: 0, block: B, type: 'spawn', kind: 'traffic-light', id: 'tl1',
    props: { x: 5.9, z: -5.9, state: 'red' } },

  // A public terminal. Later this is where the game happens.
  { t: 0, block: B, type: 'spawn', kind: 'terminal', id: 'term1',
    props: { x: 10.6, z: -7.4, face: [0, 1] } },

  // The car you are about to steal. Engine running, lights on.
  { t: 0, block: B, type: 'spawn', kind: 'car', id: 'car1',
    props: { x: -15, z: -3, heading: 0, color: '#b3121a', lights: true } },

  // Skins waiting in the rain.
  { t: 0, block: B, type: 'spawn', kind: 'person', id: 'p1',
    props: { x: -8.2, z: -7.4, umbrella: '#141619', coat: '#23262b', heading: 0.6 } },
  { t: 0, block: B, type: 'spawn', kind: 'person', id: 'p2',
    props: { x: 13.4, z: -7.0, coat: '#a7a39a', heading: 2.8 } },
  { t: 0, block: B, type: 'spawn', kind: 'person', id: 'p3',
    props: { x: -7.4, z: 9.2, umbrella: '#1d2024', coat: '#191b1e', heading: -1.2 } },
  { t: 0, block: B, type: 'spawn', kind: 'person', id: 'p4',
    props: { x: 10.6, z: -6.5, coat: '#2e2a26', heading: 3.14 } },
  { t: 0, block: B, type: 'spawn', kind: 'person', id: 'p5',
    props: { x: -20.5, z: -6.0, umbrella: '#0f1113', coat: '#1a1c20', heading: 1.4 } },

  // Cameras are entities in the world, each with its own glass and its own
  // cheap recording. The player hacks into them from the drone.
  { t: 0, block: B, type: 'spawn', kind: 'camera', id: 'CAM-07',
    props: {
      name: 'CAM 07',
      description: 'BLOCK 01 · S-E MAST',
      mount: 'mast',
      position: [25, 30, 27],
      target: [-4, 1, -7],
      fov: 46,
      lens: {
        barrel: 0.08, dirt: 1.0, noise: 0.35, aberration: 0.0022, drops: 1.0, crack: true, seed: 5,
        lines: 400, fps: 12.5, compression: 0.8, glitch: 1.0,
      },
    } },
  { t: 0, block: B, type: 'spawn', kind: 'camera', id: 'CAM-03',
    props: {
      name: 'CAM 03',
      description: 'LAMP POST · N-W CORNER',
      mount: 'pole',
      position: [-6.2, 6.0, -6.0],
      target: [-15, 0.6, -3],
      fov: 72,
      lens: {
        barrel: 0.2, dirt: 1.3, noise: 0.55, aberration: 0.003, drops: 1.0, crack: false, seed: 17,
        lines: 300, fps: 10, compression: 0.95, glitch: 1.6,
      },
    } },
  { t: 0, block: B, type: 'spawn', kind: 'camera', id: 'CAM-11',
    props: {
      name: 'CAM 11',
      description: 'BAAR ENTRANCE',
      mount: 'wall',
      position: [9.3, 7.2, -9.3],
      target: [1, 0.5, 1],
      fov: 56,
      lens: {
        barrel: 0.05, dirt: 0.4, noise: 0.25, aberration: 0.0015, drops: 0.3, crack: false, seed: 23,
        lines: 480, fps: 15, compression: 0.6, glitch: 0.5,
      },
    } },
  { t: 0, block: B, type: 'spawn', kind: 'camera', id: 'CAM-14',
    props: {
      name: 'CAM 14',
      description: '24H · S-W CORNER',
      mount: 'wall',
      position: [-9.3, 5.5, 9.3],
      target: [5, 0.5, -5],
      fov: 60,
      lens: {
        barrel: 0.12, dirt: 0.9, noise: 0.45, aberration: 0.0025, drops: 0.6, crack: true, seed: 31,
        lines: 360, fps: 12.5, compression: 0.85, glitch: 1.2,
      },
    } },

  // The player's own eye: a drone circling high over the block.
  { t: 0, block: B, type: 'spawn', kind: 'drone', id: 'UAV-2',
    props: {
      name: 'UAV-2',
      description: 'EO NIGHT · WIDE',
      target: [0, 0, 0],
      altitude: 150,
      elevation: 62,
      fov: 16,
      orbitSpeed: 0.03,
      fog: 0.0032,
      lens: {
        barrel: 0.0, dirt: 0.15, noise: 0.3, aberration: 0.0008, drops: 0, crack: false, seed: 2,
        lines: 480, fps: 25, compression: 0.9, glitch: 0.35,
      },
    } },
];
