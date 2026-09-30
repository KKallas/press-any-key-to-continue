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

  // The camera itself is an entity in the world, with its own glass.
  { t: 0, block: B, type: 'spawn', kind: 'camera', id: 'CAM-07',
    props: {
      name: 'CAM 07',
      description: 'BLOCK 01 · S-E CORNER',
      position: [25, 30, 27],
      target: [-4, 1, -7],
      fov: 46,
      lens: { barrel: 0.08, dirt: 1.0, noise: 0.35, aberration: 0.0022, drops: 1.0, crack: true, seed: 5 },
    } },
];
