// Sign-up: the injection is the front door.
//
// There is no form. The only way to mint an operator is to speak to the login
// the way the old boxes could be spoken to: an injection. This is a chosen
// gesture on our own server, not a hole in it. We never run the string
// against anything — no database, no query, no eval. We look at it, decide
// whether it's the ritual, pull a handle out of it if one's offered, and
// that's all. A plain login attempt is turned away, so the game teaches its
// own way in. The injection here is the toy version of a real, long-patched
// class of bug; the link in the terminal points at where to learn the real
// thing.

import crypto from 'node:crypto';

const COLORS = ['#b3121a', '#2f7fff', '#22c55e', '#f59e0b', '#c026d3', '#06b6d4', '#e11d48', '#84cc16', '#f97316', '#8b5cf6'];

// The tell-tales of an injection: a stray quote, a comment, a statement
// terminator, a tautology, or the SQL verbs people reach for.
const INJECTION = /('|;|--|\/\*|\bor\b\s+1\s*=\s*1|\bunion\b|\binsert\b|\bselect\b|\bdrop\b|\bexec\b)/i;

// A handle offered inside the injection, e.g. VALUES('NEO') or handle=trinity.
export function handleFrom(str) {
  const m =
    str.match(/(?:values|handle|user(?:name)?|as|name)\s*[('"=\s]+([A-Za-z][A-Za-z0-9_\-]{1,15})/i) ||
    str.match(/['"]([A-Za-z][A-Za-z0-9_\-]{1,15})['"]/);
  return m ? m[1].toUpperCase() : null;
}

function coined() {
  const a = ['GHOST', 'NULL', 'ECHO', 'RAVEN', 'MERC', 'VESPER', 'KATE', 'ZERO', 'IONA', 'REV', 'HEX', 'ONYX'];
  return a[Math.floor(Math.random() * a.length)] + '-' + Math.floor(Math.random() * 900 + 100);
}

export function looksLikeInjection(str) {
  return INJECTION.test(str);
}

// Decide a sign-up. taken: how many operators already exist; max: the cap.
// Returns { ok, name?, token?, color?, reason? }. Pure but for the random
// token, handle and colour.
export function parseSignup(line, taken, max, colorIndex) {
  const str = String(line ?? '').slice(0, 300);
  if (!looksLikeInjection(str)) return { ok: false, reason: 'ACCESS DENIED' };
  if (taken >= max) return { ok: false, reason: `HOST FULL (${max} OPERATORS)` };
  const token = crypto.randomBytes(16).toString('hex');
  const name = (handleFrom(str) || coined()).slice(0, 16);
  const color = COLORS[colorIndex % COLORS.length];
  return { ok: true, id: token.slice(0, 8), name, token, color };
}
