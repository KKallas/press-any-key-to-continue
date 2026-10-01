// The override store: the city's accreted, player-authored layer.
//
// Every object in the world has a base (what the procedural generator makes)
// and, optionally, an override — a bundle a player's own model forged and sent
// back: a new facade, a new interior room, new behaviour, tweaked params. The
// base never changes; overrides stack on top, keyed by the object's stable id.
//
// This store is where they live. It sits in server/data (next to the operator
// db), so it survives a #99 rebuild that wipes the world from GitHub — the city
// keeps what players have made of it. Asset files are served statically; the
// index is handed to every client at startup.
//
// A bundle is an ordinary zip (your Python forge makes it with zipfile):
//
//   manifest.json   { id, type, prompt, facade?, interior?, behavior?, params?, meta? }
//   facade.png      optional — a facade texture
//   room.json       optional — an interior room definition (declarative)
//   behavior.js     optional — sandboxed behaviour, run client-side in a Worker
//
// Nothing here executes a bundle. behavior.js is only stored and served; the
// client runs it in a locked-down Worker. The server's whole job is to vet the
// manifest, keep only safe files, and remember them.

import fs from 'node:fs';
import path from 'node:path';
import { unzip } from './unzip.mjs';

const TYPES = new Set(['building', 'room', 'car', 'road', 'item']);
const ASSET = {
  facade: { ext: ['.png', '.jpg', '.webp'], max: 4 * 1024 * 1024 },
  interior: { ext: ['.json'], max: 256 * 1024 },
  behavior: { ext: ['.js'], max: 128 * 1024 },
};
const MAX_BUNDLE = 8 * 1024 * 1024;
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);

export class OverrideStore {
  constructor(dir) {
    this.dir = dir;
    this.indexFile = path.join(dir, 'index.json');
    fs.mkdirSync(dir, { recursive: true });
    this.index = this._read();
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      return {};
    }
  }

  _write() {
    const tmp = this.indexFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.index, null, 2));
    fs.renameSync(tmp, this.indexFile); // atomic, so a kill mid-write can't corrupt it
  }

  // The whole index, for a client at startup: id -> record (urls, not files).
  all() {
    return this.index;
  }

  // Take a forged bundle (a zip buffer). Returns { ok, id, ver } or { error }.
  ingest(buffer) {
    if (!buffer || buffer.length > MAX_BUNDLE) return { error: 'bundle too big' };
    let files;
    try {
      files = unzip(buffer); // Map<name, Buffer>
    } catch (e) {
      return { error: 'not a readable zip' };
    }
    const manRaw = files.get('manifest.json');
    if (!manRaw) return { error: 'no manifest.json' };
    let man;
    try {
      man = JSON.parse(manRaw.toString('utf8'));
    } catch {
      return { error: 'bad manifest json' };
    }
    const id = slug(man.id);
    if (!id) return { error: 'bad id' };
    if (!TYPES.has(man.type)) return { error: 'bad type' };

    // Collect the allowed asset files the manifest points at, vetted.
    const out = {}; // field -> stored filename
    for (const [field, rule] of Object.entries(ASSET)) {
      const ref = man[field];
      if (!ref) continue;
      const base = path.basename(String(ref)); // never a path, only a name in the zip
      const data = files.get(base) || files.get(ref);
      if (!data) return { error: `missing file: ${ref}` };
      if (!rule.ext.includes(path.extname(base).toLowerCase())) return { error: `bad ${field} type` };
      if (data.length > rule.max) return { error: `${field} too big` };
      out[field] = { base, data };
    }

    // Write everything under data/overrides/<id>/, replacing any prior version.
    const odir = path.join(this.dir, id);
    fs.mkdirSync(odir, { recursive: true });
    const rec = {
      type: man.type,
      prompt: typeof man.prompt === 'string' ? man.prompt.slice(0, 8000) : '',
      params: man.params && typeof man.params === 'object' ? man.params : {},
      meta: { at: Date.now(), author: slug(man.meta?.author).slice(0, 32) || 'anon' },
      ver: (this.index[id]?.ver ?? 0) + 1,
    };
    for (const [field, { base, data }] of Object.entries(out)) {
      fs.writeFileSync(path.join(odir, base), data);
      rec[field] = `/overrides/${id}/${base}`; // the url the client will load
    }
    this.index[id] = rec;
    this._write();
    return { ok: true, id, ver: rec.ver };
  }

  // Resolve a served path like /overrides/<id>/<file> to a file on disk, or null.
  resolve(urlPath) {
    const m = /^\/overrides\/([a-z0-9_-]{1,64})\/([a-zA-Z0-9_.-]{1,80})$/.exec(urlPath);
    if (!m) return null;
    const file = path.join(this.dir, m[1], m[2]);
    if (!file.startsWith(this.dir)) return null;
    return fs.existsSync(file) ? file : null;
  }
}
