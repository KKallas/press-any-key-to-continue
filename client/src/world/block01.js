// The event log for Block 01, as the server would send it to a client.
// Every entity arrives as a plain, serialisable event.
// Coordinates are metres: X runs east, Z runs south, Y is up.
//
// Four city blocks in a 2x2 grid. Roads run at -50, 0 and 50 on both axes,
// 10 m wide with 3 m sidewalks, so each block's lot spans 8..42 m from the
// centre lines. Past the ring roads the streets run on into empty lots:
// the part of the city nobody has written yet.

const B = 'B01';

const building = (id, x, z, w, d, h, seed) => ({
  t: 0, block: B, type: 'spawn', kind: 'building', id,
  props: { x, z, w, d, h, seed },
});

export const BLOCK_01 = [
  { t: 0, block: B, type: 'spawn', kind: 'street', id: 'street',
    props: { size: 170, roadWidth: 10, sidewalk: 3, curb: 0.15, seed: 7, roads: [-50, 0, 50], bounds: 42 } },

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

  // Filling the four blocks out towards the ring roads.
  building('b12', -14, -38.5, 10, 7, 26, 15),
  building('b13', -27, -38.5, 12, 7, 12, 16),
  building('b14', -38.5, -14, 7, 10, 14, 17),
  building('b15', -38.5, -27, 7, 12, 20, 18),
  building('b16', -38.5, -38.5, 7, 7, 9, 19),
  building('b17', 27.5, -27, 11, 12, 16, 24),
  building('b18', 38.5, -14, 7, 10, 40, 25),
  building('b19', 38.5, -31, 7, 18, 24, 26),
  building('b20', 20, -38.5, 24, 7, 12, 27),
  building('b21', -14, 27, 10, 10, 20, 33),
  building('b22', -26, 30, 12, 10, 36, 34),
  building('b23', -38.5, 20, 7, 24, 18, 35),
  building('b24', -20, 38.5, 24, 7, 10, 36),
  building('b25', 14, 30, 10, 12, 26, 43),
  building('b26', 30, 33, 10, 8, 44, 44),
  building('b27', 38.5, 17, 7, 16, 20, 45),
  building('b28', 20, 39.5, 24, 5, 8, 46),

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
  // Along the ring roads the lamps glow but cast no real light: every real
  // light costs every pixel on screen, and from the drone the glow is enough.
  ...[
    ['lamp7', 43.4, -6.6, 1, 0],
    ['lamp8', -43.4, 6.6, -1, 0],
    ['lamp9', 6.6, 43.4, 0, 1],
    ['lamp10', -6.6, -43.4, 0, -1],
    ['lamp11', 43.4, 43.4, 1, 0],
    ['lamp12', -43.4, -43.4, -1, 0],
    ['lamp13', 43.4, -43.4, 0, -1],
    ['lamp14', -43.4, 43.4, 0, 1],
    ['lamp15', 25, 43.4, 0, 1],
    ['lamp16', -25, -43.4, 0, -1],
  ].map(([id, x, z, ax, az]) => ({
    t: 0, block: B, type: 'spawn', kind: 'lamp', id,
    props: { x, z, arm: [ax, az], height: 7, color: '#ff9a3c', intensity: 0 },
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
