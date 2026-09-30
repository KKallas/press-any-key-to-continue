// Green: the grass left over in a block once the buildings are in. Open
// lot ground that isn't hard up against a wall, in patches big enough to be
// a yard or a small park. Alleys and slivers between buildings stay paved.
//
// Green matters to the game: it's the shortcut. A careful driver keeps off
// it; one in a hurry cuts across, and that is what gets noticed.

import * as THREE from 'three';

const PPM = 1; // pixels per metre
const WALL_GAP = 2.2; // metres of paving kept around every building
const MIN_AREA = 90; // square metres for a patch to count as green

export function greenMap(bounds, lots, footprints) {
  const w = Math.ceil((bounds.maxX - bounds.minX) * PPM);
  const h = Math.ceil((bounds.maxZ - bounds.minZ) * PPM);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  const X = (x) => (x - bounds.minX) * PPM;
  const Z = (z) => (z - bounds.minZ) * PPM;
  const path = (poly) => {
    g.beginPath();
    poly.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.closePath();
  };
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  // Lots in white, then every building (and a margin round it) in black.
  g.fillStyle = '#fff';
  for (const lot of lots) {
    path(lot);
    g.fill();
  }
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  g.lineJoin = 'round';
  g.lineWidth = WALL_GAP * 2 * PPM;
  for (const fp of footprints) {
    path(fp);
    g.fill();
    g.stroke();
  }
  // Keep lot edges paved too: a kerb, then grass.
  g.lineWidth = 1.2 * PPM;
  for (const lot of lots) {
    path(lot);
    g.stroke();
  }

  // Keep only patches big enough to be a yard.
  const px = g.getImageData(0, 0, w, h).data;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = px[i * 4] > 128 ? 1 : 0;
  const mask = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const patches = [];
  for (let s = 0; s < w * h; s++) {
    if (!on[s] || seen[s]) continue;
    let top = 0;
    const cells = [];
    stack[top++] = s;
    seen[s] = 1;
    while (top) {
      const k = stack[--top];
      cells.push(k);
      const i = k % w;
      for (const n of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, k - w, k + w]) {
        if (n < 0 || n >= w * h || !on[n] || seen[n]) continue;
        seen[n] = 1;
        stack[top++] = n;
      }
    }
    if (cells.length / (PPM * PPM) < MIN_AREA) continue;
    for (const k of cells) mask[k] = 1;
    patches.push(cells.map((k) => [bounds.minX + ((k % w) + 0.5) / PPM, bounds.minZ + (Math.floor(k / w) + 0.5) / PPM]));
  }

  const test = (x, z) => {
    const i = Math.floor(X(x));
    const j = Math.floor(Z(z));
    return i >= 0 && j >= 0 && i < w && j < h && mask[j * w + i] === 1;
  };
  return { test, mask, w, h, patches };
}

// The grass itself: a sheet over the ground, cut out by the mask with soft,
// ragged edges, dark and matted with rain.
export function grassMesh(bounds, green) {
  const scale = 4; // texture pixels per mask pixel
  const W = green.w * scale;
  const H = green.h * scale;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const small = document.createElement('canvas');
  small.width = green.w;
  small.height = green.h;
  const sg = small.getContext('2d');
  const img = sg.createImageData(green.w, green.h);
  for (let i = 0; i < green.mask.length; i++) {
    const v = green.mask[i] * 255;
    img.data[i * 4] = 78;
    img.data[i * 4 + 1] = 104;
    img.data[i * 4 + 2] = 58;
    img.data[i * 4 + 3] = v;
  }
  sg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.filter = 'blur(2px)';
  g.drawImage(small, 0, 0, W, H);
  g.filter = 'none';
  // Tufts and bare patches.
  g.globalCompositeOperation = 'source-atop';
  let seed = 9;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W * H * 0.004; i++) {
    const v = r();
    g.fillStyle = v < 0.25 ? 'rgba(84,70,48,0.55)' : v < 0.6 ? 'rgba(44,66,36,0.5)' : 'rgba(110,140,80,0.4)';
    g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3);
  }
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.75, metalness: 0, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((bounds.minX + bounds.maxX) / 2, 0.175, (bounds.minZ + bounds.maxZ) / 2); // on the lot, which sits on the kerb slab
  mesh.renderOrder = 1;
  mesh.name = 'grass';
  return mesh;
}
