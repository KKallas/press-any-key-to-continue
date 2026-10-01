// The utility-room terminal: where you leave your sign on the city.
//
// A building bleeds matrix for a few seconds; click it and you're at this
// terminal. It shows the prompt that made the thing (or a made-up one, if no
// one has touched it yet), and lets you rewrite it. COMPILE assembles the full
// forge request — your prompt, plus the fixed header and the object's hard
// constraints and the bundle schema — and drops it on your clipboard. You run
// that through your own model, get a zip back, and bring it in here: it's
// PREVIEWED first (so you can catch inside-out normals or transparency before
// committing), then, if it looks right, sent to the server, committed to the
// city's history, and real on the next load.

import * as THREE from 'three';
import { AssetRegistry } from './assets.js';
import { buildReplacedBuilding } from '../world/deco.js';
import { unzipClient } from './unzip-client.js';

export function compilePrompt({ id, type, prompt, constraints = {} }) {
  const lines = [
    'PRESS ANY KEY TO CONTINUE — FORGE REQUEST',
    `object: ${id}`,
    `type:   ${type}`,
  ];
  for (const [k, v] of Object.entries(constraints)) lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  lines.push(
    '',
    'Return a zip (a "bundle") containing:',
    '  manifest.json  { id, type, prompt, facade?, interior?, behavior?, params?, meta? }',
    '  facade.png     a square facade texture, wrapped once around the building.',
    '                 It must be OPAQUE (no transparency); windows are painted,',
    '                 not cut out.',
    '  behavior.js    OPTIONAL. ES module, runs in a sandboxed Worker (no DOM, no',
    '                 network). export onEnter(ctx) / onTick(ctx) returning an',
    '                 array of effects, e.g. [{effect:"sound",name:"hum"}].',
    '  params         OPTIONAL. { height, glow:"#rrggbb" } and the like.',
    'Keep id and type exactly as above. Nothing else is read.',
    '',
    '--- PROMPT ---',
    prompt || '',
  );
  return lines.join('\n');
}

// A small rotating 3D preview of what the bundle would become. Returns a
// disposer. Building only; other types just show their facade/params.
function preview(container, footprint, rec) {
  const w = 360, h = 260;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x14160f, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(1, 2, 1.4);
  scene.add(key);

  const built = buildReplacedBuilding({ id: 'preview', footprint, height: rec.params?.height }, rec);
  const pivot = new THREE.Group();
  scene.add(pivot);
  let size = new THREE.Vector3(20, 24, 16);
  if (built) {
    const box = new THREE.Box3().setFromObject(built.object);
    const c = box.getCenter(new THREE.Vector3());
    box.getSize(size);
    built.object.position.sub(c); // centre it on the pivot
    pivot.add(built.object);
  }
  const cam = new THREE.PerspectiveCamera(42, w / h, 0.1, 2000);
  const R = Math.max(size.x, size.y, size.z) * 1.7 + 6;
  cam.position.set(R, R * 0.7, R);
  cam.lookAt(0, 0, 0);

  let raf;
  const spin = () => { pivot.rotation.y += 0.012; renderer.render(scene, cam); raf = requestAnimationFrame(spin); };
  spin();
  return () => { cancelAnimationFrame(raf); renderer.dispose(); renderer.domElement.remove(); };
}

export function forgeTerminal({ id, type, prompt, constraints, footprint = null, submitUrl = '/api/overrides', onDone } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'forge';
  wrap.innerHTML = `
    <div class="forge-crt">
      <div class="forge-head"><span>UTILITY TERMINAL</span><span class="forge-sub">${type.toUpperCase()} · ${id}</span></div>
      <div class="forge-note">rewrite what this is. COMPILE copies the forge request; run it on your model, then LOAD the bundle — you'll preview it before it's committed.</div>
      <textarea class="forge-in" spellcheck="false" aria-label="prompt">${(prompt || '').replace(/</g, '&lt;')}</textarea>
      <div class="forge-preview" id="forge-preview" hidden></div>
      <div class="forge-row">
        <button type="button" id="forge-compile">COMPILE → CLIPBOARD</button>
        <button type="button" id="forge-load">LOAD BUNDLE…</button>
        <button type="button" id="forge-accept" hidden>ACCEPT &amp; COMMIT</button>
        <button type="button" id="forge-discard" hidden>DISCARD</button>
        <button type="button" id="forge-close">CLOSE</button>
        <input type="file" id="forge-file" accept=".zip,application/zip" hidden />
      </div>
      <div class="forge-msg" id="forge-msg"></div>
    </div>`;
  document.body.appendChild(wrap);
  const ta = wrap.querySelector('.forge-in');
  const msg = wrap.querySelector('#forge-msg');
  const previewBox = wrap.querySelector('#forge-preview');
  const acceptBtn = wrap.querySelector('#forge-accept');
  const discardBtn = wrap.querySelector('#forge-discard');
  let disposePreview = null;
  let pending = null; // { buffer } awaiting accept
  let facadeUrl = null;

  const clearPreview = () => {
    if (disposePreview) { disposePreview(); disposePreview = null; }
    if (facadeUrl) { URL.revokeObjectURL(facadeUrl); facadeUrl = null; }
    previewBox.hidden = true;
    acceptBtn.hidden = true;
    discardBtn.hidden = true;
    pending = null;
  };
  const close = () => { clearPreview(); wrap.remove(); onDone?.(); };
  ta.focus();

  wrap.querySelector('#forge-compile').addEventListener('click', async () => {
    const text = compilePrompt({ id, type, prompt: ta.value, constraints });
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = 'COPIED. PASTE INTO YOUR FORGE, THEN LOAD THE BUNDLE.';
    } catch {
      msg.textContent = 'CLIPBOARD BLOCKED — SELECT ALL BELOW AND COPY:';
      ta.value = text;
      ta.select();
    }
  });

  const file = wrap.querySelector('#forge-file');
  wrap.querySelector('#forge-load').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    clearPreview();
    msg.textContent = 'READING BUNDLE…';
    try {
      const buffer = await f.arrayBuffer();
      const files = await unzipClient(buffer);
      const manRaw = files.get('manifest.json');
      if (!manRaw) { msg.textContent = 'NO manifest.json IN BUNDLE'; return; }
      const man = JSON.parse(new TextDecoder().decode(manRaw));
      const rec = { params: man.params || {} };
      if (man.facade) {
        const data = files.get(man.facade) || files.get(man.facade.split('/').pop());
        if (data) { facadeUrl = URL.createObjectURL(new Blob([data], { type: 'image/png' })); rec.facade = facadeUrl; }
      }
      if ((man.type || type) === 'building' && footprint) {
        previewBox.hidden = false;
        disposePreview = preview(previewBox, footprint, rec);
        msg.textContent = 'PREVIEW — CHECK THE WALLS, THEN ACCEPT OR DISCARD.';
      } else {
        msg.textContent = `BUNDLE READ (${man.type || type}). ACCEPT TO COMMIT.`;
      }
      pending = { buffer };
      acceptBtn.hidden = false;
      discardBtn.hidden = false;
    } catch (e) {
      msg.textContent = `CAN'T READ BUNDLE: ${String(e?.message || e)}`;
    }
    file.value = '';
  });

  acceptBtn.addEventListener('click', async () => {
    if (!pending) return;
    msg.textContent = 'SENDING…';
    const r = await AssetRegistry.submit(submitUrl, pending.buffer);
    clearPreview();
    msg.textContent = r.ok ? `FORGED — ${r.id} v${r.ver}. RELOAD THE AREA TO SEE IT.` : `REJECTED: ${r.error || 'bad bundle'}`;
  });
  discardBtn.addEventListener('click', () => { clearPreview(); msg.textContent = 'DISCARDED.'; });

  wrap.querySelector('#forge-close').addEventListener('click', close);
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { close };
}
