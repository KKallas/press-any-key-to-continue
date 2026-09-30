// Getting in. Two doors, and the game teaches the first.
//
//   sign up   You've never been here. You get in the way the old boxes could
//             be got into: an injection at the login. That CREATES a
//             persistent operator and hands you a key to keep. This is a
//             chosen gesture on our own server, not a hole in it — we never
//             run the string against anything, no query, no eval. We read it,
//             decide whether it's the ritual, and pull a handle out of it if
//             one is offered.
//
//   log in    You've been here. You give your handle and the key the
//             injection gave you, and you're back as the same operator, with
//             your colour and your session count. A plain handle with no key,
//             and no injection, is turned away.
//
// The injection is the toy version of a real, long-patched class of bug; the
// terminal links out to where the real thing is taught.

// The tell-tales of an injection: a stray quote, a comment, a terminator, a
// tautology, or the SQL verbs people reach for.
const INJECTION = /('|;|--|\/\*|\bor\b\s+1\s*=\s*1|\bunion\b|\binsert\b|\bselect\b|\bdrop\b|\bexec\b)/i;

export function looksLikeInjection(str) {
  return INJECTION.test(String(str ?? ''));
}

// A handle offered inside the injection, e.g. VALUES('NEO') or handle=trinity.
export function handleFrom(str) {
  const m =
    str.match(/(?:values|handle|user(?:name)?|as|name)\s*[('"=\s]+([A-Za-z][A-Za-z0-9_\-]{1,15})/i) ||
    str.match(/['"]([A-Za-z][A-Za-z0-9_\-]{1,15})['"]/);
  return m ? m[1].toUpperCase() : null;
}

function coined(rand = Math.random) {
  const a = ['GHOST', 'NULL', 'ECHO', 'RAVEN', 'MERC', 'VESPER', 'KATE', 'ZERO', 'IONA', 'REV', 'HEX', 'ONYX'];
  return a[Math.floor(rand() * a.length)] + '-' + Math.floor(rand() * 900 + 100);
}

// A plausible handle typed on its own (not an injection): letters, digits,
// dash, underscore. This is someone saying "it's me" so we can ask for a key.
export function isHandle(str) {
  return /^[A-Za-z][A-Za-z0-9_\-]{1,15}$/.test(String(str ?? '').trim());
}

// The first line at the login. db is the OperatorDB; full/max guard the shard.
// Returns one of:
//   { ok:true, created:true, handle, key, color }   fresh account, key shown once
//   { ok:false, needKey:true, handle }               known handle, ask for the key
//   { ok:false, reason }                             turned away
export function parseSignup(line, db, live, max) {
  const str = String(line ?? '').trim().slice(0, 300);
  if (looksLikeInjection(str)) {
    if (live >= max) return { ok: false, reason: `HOST FULL (${max} OPERATORS)` };
    const wanted = handleFrom(str) || coined();
    const acct = db.create(wanted);
    return { ok: true, created: true, handle: acct.handle, key: acct.key, color: acct.color };
  }
  // Not an injection. If it names an operator we know, ask for the key.
  if (isHandle(str) && db.has(str)) return { ok: false, needKey: true, handle: str.toUpperCase() };
  return { ok: false, reason: 'ACCESS DENIED' };
}

// The returning door: handle plus the key the injection gave.
// { ok:true, handle, color, runs } or { ok:false, reason }.
export function parseLogin(handle, key, db, live, max) {
  if (live >= max) return { ok: false, reason: `HOST FULL (${max} OPERATORS)` };
  const who = db.verify(handle, key);
  if (!who) return { ok: false, reason: 'BAD KEY' };
  return { ok: true, ...who };
}
