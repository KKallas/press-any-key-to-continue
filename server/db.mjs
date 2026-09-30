// The operator database: a flat JSON file, no engine to install. It holds the
// accounts the injection creates, so a handle you make tonight is yours to
// come back to. Small enough for a game shard; swap it for a real store if a
// shard ever outgrows a file.
//
// A record: { handle, salt, hash, color, created, lastSeen, runs }. The key
// is never stored, only a scrypt hash of it, so the file can't hand anyone a
// way in even if it leaks.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'data');
const FILE = path.join(DIR, 'operators.json');

const COLORS = ['#b3121a', '#2f7fff', '#22c55e', '#f59e0b', '#c026d3', '#06b6d4', '#e11d48', '#84cc16', '#f97316', '#8b5cf6'];

export class OperatorDB {
  constructor(file = FILE) {
    this.file = file;
    this.ops = new Map(); // handleLower -> record
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const rec of raw.operators ?? []) this.ops.set(rec.handle.toLowerCase(), rec);
    } catch {
      // No file yet: start empty.
    }
  }

  // Written straight away, and atomically (temp then rename), so a crash
  // mid-write can't corrupt the file and a signup can't be lost to a kill a
  // moment later. Accounts change rarely (create, login), so the cost is nil.
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, operators: [...this.ops.values()] }, null, 0));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('operator db save failed:', e.message);
    }
  }

  has(handle) {
    return this.ops.has(String(handle).toLowerCase());
  }

  get size() {
    return this.ops.size;
  }

  // A handle no one holds yet: the wanted one, or it with -2, -3, ... .
  freeHandle(wanted) {
    let h = wanted;
    let n = 2;
    while (this.ops.has(h.toLowerCase())) h = `${wanted}-${n++}`;
    return h;
  }

  // Create an operator and return { handle, key, color } — the key in the
  // clear, this once, for the player to keep. Never stored in the clear.
  create(wantedHandle) {
    const handle = this.freeHandle(wantedHandle).slice(0, 16);
    const key = keygen();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = scrypt(key, salt);
    const color = COLORS[this.ops.size % COLORS.length];
    const rec = { handle, salt, hash, color, created: Date.now(), lastSeen: Date.now(), runs: 0 };
    this.ops.set(handle.toLowerCase(), rec);
    this.save();
    return { handle, key, color };
  }

  // Create an operator with a handle and a password the player chose (the
  // ?action=createuser front door). The handle must be free — no silent
  // renaming — so a taken name is told to try another.
  createNamed(handle, password) {
    const clean = String(handle || '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_\-]{1,15}$/.test(clean)) return { error: 'bad handle' };
    if (!password || String(password).length < 1) return { error: 'no password' };
    if (this.ops.has(clean.toLowerCase())) return { error: 'taken' };
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = scrypt(String(password), salt);
    const color = COLORS[this.ops.size % COLORS.length];
    const rec = { handle: clean, salt, hash, color, created: Date.now(), lastSeen: Date.now(), runs: 0 };
    this.ops.set(clean.toLowerCase(), rec);
    this.save();
    return { handle: clean, color };
  }

  // Check a returning operator's key. On success bumps their session count
  // and returns { handle, color, runs }; on failure returns null.
  verify(handle, key) {
    const rec = this.ops.get(String(handle).toLowerCase());
    if (!rec) return null;
    const got = scrypt(String(key ?? ''), rec.salt);
    // Constant-time compare, so a wrong key doesn't leak how wrong it was.
    if (got.length !== rec.hash.length || !crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(rec.hash, 'hex'))) return null;
    rec.lastSeen = Date.now();
    rec.runs++;
    this.save();
    return { handle: rec.handle, color: rec.color, runs: rec.runs };
  }
}

function scrypt(key, salt) {
  return crypto.scryptSync(key, salt, 32).toString('hex');
}

// A key that's a fighting chance to remember and a pain to guess:
// three short words and a number, e.g. NEON-RAIN-CODE-4471.
const WORDS = [
  'NEON', 'RAIN', 'CODE', 'GHOST', 'WIRE', 'DUSK', 'ECHO', 'IRON', 'VOID', 'ASH', 'NOVA', 'HALT', 'DRIFT', 'MASK',
  'GRID', 'SALT', 'HEX', 'ONYX', 'FLUX', 'ZERO', 'MOTH', 'GLASS', 'STATIC', 'RUST', 'PULSE', 'SMOKE', 'VESPER', 'RELAY',
];
function keygen() {
  const w = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${w()}-${w()}-${w()}-${crypto.randomInt(1000, 9999)}`;
}
