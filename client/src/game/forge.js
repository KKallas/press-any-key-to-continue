// The utility-room terminal: where you leave your sign on the city.
//
// A building bleeds matrix for a few seconds; click it and you're at this
// terminal. It shows the prompt that made the thing (or the base one, if no
// one has touched it yet), and lets you rewrite it. COMPILE assembles the full
// forge request — your prompt, plus the fixed header and the object's hard
// constraints and the bundle schema — and drops it on your clipboard. You run
// that through your own model (the Python forge), get a zip back, and bring it
// in here: it's sent to the server, committed to the city's history, and the
// next time this area loads, it's real.

import { AssetRegistry } from './assets.js';

// Build the complete instruction a player pastes into their own model.
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
    '  facade.png     a square facade texture, wrapped once around the building',
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

export function forgeTerminal({ id, type, prompt, constraints, submitUrl = '/api/overrides', onDone } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'forge';
  wrap.innerHTML = `
    <div class="forge-crt">
      <div class="forge-head"><span>UTILITY TERMINAL</span><span class="forge-sub">${type.toUpperCase()} · ${id}</span></div>
      <div class="forge-note">rewrite what this is. COMPILE copies the forge request; run it on your model, then LOAD the bundle it returns.</div>
      <textarea class="forge-in" spellcheck="false" aria-label="prompt">${(prompt || '').replace(/</g, '&lt;')}</textarea>
      <div class="forge-row">
        <button type="button" id="forge-compile">COMPILE → CLIPBOARD</button>
        <button type="button" id="forge-load">LOAD BUNDLE…</button>
        <button type="button" id="forge-close">CLOSE</button>
        <input type="file" id="forge-file" accept=".zip,application/zip" hidden />
      </div>
      <div class="forge-msg" id="forge-msg"></div>
    </div>`;
  document.body.appendChild(wrap);
  const ta = wrap.querySelector('.forge-in');
  const msg = wrap.querySelector('#forge-msg');
  const close = () => { wrap.remove(); onDone?.(); };
  ta.focus();

  wrap.querySelector('#forge-compile').addEventListener('click', async () => {
    const text = compilePrompt({ id, type, prompt: ta.value, constraints });
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = 'COPIED. PASTE INTO YOUR FORGE, THEN LOAD THE BUNDLE.';
    } catch {
      // Clipboard blocked (no gesture/permission): show it to copy by hand.
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
    msg.textContent = 'SENDING…';
    const buf = await f.arrayBuffer();
    const r = await AssetRegistry.submit(submitUrl, buf);
    if (r.ok) {
      msg.textContent = `FORGED — ${r.id} v${r.ver}. RELOAD THE AREA TO SEE IT.`;
    } else {
      msg.textContent = `REJECTED: ${r.error || 'bad bundle'}`;
    }
  });

  wrap.querySelector('#forge-close').addEventListener('click', close);
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { close };
}
