// The override store: the city's accreted, player-authored layer — and its
// history.
//
// Every object in the world has a base (what the procedural generator makes)
// and, optionally, an override — a bundle a player's own model forged and sent
// back: a new building, interior, behaviour, tweaked params. The base never
// changes; overrides stack on top, keyed by the object's stable id. An
// override can also bring a *new* object into being at the edge of the map,
// where a ghost waits to be made real.
//
// The store is a git repository of its own (inside server/data, so it survives
// a #99 rebuild that wipes the world from GitHub). Every contribution is a
// commit — the game is about leaving a sign, and here a sign is literally a
// commit in the city's history. Don't like what someone made of a building?
// Roll it back a commit and carry on from there.
//
// A bundle is an ordinary zip (your Python forge makes it with zipfile):
//
//   manifest.json   { id, type, prompt, facade?, interior?, behavior?, params?, meta? }
//   facade.png      optional — a facade texture
//   room.json       optional — an interior room definition
//   behavior.js     optional — sandboxed behaviour, run client-side in a Worker
//
// Nothing here executes a bundle. behavior.js is only stored and served; the
// client runs it in a locked-down Worker. The server vets the manifest, keeps
// only safe files, commits them, and remembers them.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
    fs.mkdirSync(dir, { recursive: true });
    this._initGit();
    this.index = this._scan();
  }

  _git(...args) {
    return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
  _initGit() {
    try {
      if (!fs.existsSync(path.join(this.dir, '.git'))) {
        this._git('init', '-q');
        this._git('config', 'user.name', 'the city');
        this._git('config', 'user.email', 'forge@roboarena.org');
        this._git('commit', '--allow-empty', '-q', '-m', 'empty lot');
      }
      this.git = true;
    } catch (e) {
      this.git = false; // no git on this host: the store still works, just unversioned
    }
  }
  _commit(msg) {
    if (!this.git) return;
    try {
      this._git('add', '-A');
      this._git('commit', '-q', '-m', msg);
    } catch {
      /* nothing staged, or git unhappy — not fatal */
    }
  }

  // Rebuild the in-memory index by reading each object's stored manifest.
  _scan() {
    const out = {};
    for (const id of fs.readdirSync(this.dir)) {
      if (id.startsWith('.')) continue;
      const mf = path.join(this.dir, id, 'manifest.json');
      if (!fs.existsSync(mf)) continue;
      try {
        out[id] = JSON.parse(fs.readFileSync(mf, 'utf8'));
      } catch {
        /* skip a broken one */
      }
    }
    return out;
  }

  all() {
    return this.index;
  }

  // Take a forged bundle (a zip buffer). Returns { ok, id, ver } or { error }.
  ingest(buffer) {
    if (!buffer || buffer.length > MAX_BUNDLE) return { error: 'bundle too big' };
    let files;
    try {
      files = unzip(buffer);
    } catch {
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

    const picked = {};
    for (const [field, rule] of Object.entries(ASSET)) {
      const ref = man[field];
      if (!ref) continue;
      const base = path.basename(String(ref));
      const data = files.get(base) || files.get(ref);
      if (!data) return { error: `missing file: ${ref}` };
      if (!rule.ext.includes(path.extname(base).toLowerCase())) return { error: `bad ${field} type` };
      if (data.length > rule.max) return { error: `${field} too big` };
      picked[field] = { base, data };
    }

    const odir = path.join(this.dir, id);
    fs.mkdirSync(odir, { recursive: true });
    const rec = {
      id,
      type: man.type,
      prompt: typeof man.prompt === 'string' ? man.prompt.slice(0, 8000) : '',
      params: man.params && typeof man.params === 'object' ? man.params : {},
      meta: { at: Date.now(), author: slug(man.meta?.author).slice(0, 32) || 'anon' },
      ver: (this.index[id]?.ver ?? 0) + 1,
    };
    for (const [field, { base, data }] of Object.entries(picked)) {
      fs.writeFileSync(path.join(odir, base), data);
      rec[field] = `/overrides/${id}/${base}`;
    }
    // The manifest is the record itself — the index is derived from it, so a
    // git checkout of an old version restores the object completely.
    fs.writeFileSync(path.join(odir, 'manifest.json'), JSON.stringify(rec, null, 2));
    this.index[id] = rec;
    this._commit(`forge ${id} ${rec.type} v${rec.ver} by ${rec.meta.author}`);
    return { ok: true, id, ver: rec.ver };
  }

  // The city's history, newest first: [{ hash, msg, at }]. For one object, pass
  // its id to see only the commits that touched it.
  history(id = null) {
    if (!this.git) return [];
    try {
      const args = ['log', '--pretty=format:%h\u001f%s\u001f%cI', '-n', '50'];
      if (id) args.push('--', slug(id));
      const out = this._git(...args);
      if (!out) return [];
      return out.split('\n').map((l) => {
        const [hash, msg, at] = l.split('\u001f');
        return { hash, msg, at };
      });
    } catch {
      return [];
    }
  }

  // Roll an object back to how it was before its last change, and commit that
  // as a new step forward (so history stays linear and shared). Returns
  // { ok, id, ver } or { error }.
  rollback(id) {
    id = slug(id);
    if (!this.git) return { error: 'no history on this host' };
    const log = this.history(id);
    if (log.length < 2) return { error: 'nothing earlier to go back to' };
    try {
      // Restore this object's folder as it was one change ago.
      this._git('checkout', log[1].hash, '--', id);
      this.index = this._scan();
      const ver = (this.index[id]?.ver ?? 0);
      this._commit(`rollback ${id} to v${ver}`);
      return { ok: true, id, ver };
    } catch (e) {
      return { error: 'rollback failed' };
    }
  }

  resolve(urlPath) {
    const m = /^\/overrides\/([a-z0-9_-]{1,64})\/([a-zA-Z0-9_.-]{1,80})$/.exec(urlPath);
    if (!m) return null;
    const file = path.join(this.dir, m[1], m[2]);
    if (!file.startsWith(this.dir)) return null;
    return fs.existsSync(file) ? file : null;
  }
}
