# The operator database: a flat JSON file, no engine to install. It holds the
# accounts the injection creates, so a handle you make tonight is yours to
# come back to. Small enough for a game shard; swap it for a real store if a
# shard ever outgrows a file.
#
# A record: { handle, salt, hash, color, created, lastSeen, runs }. The key
# is never stored, only a scrypt hash of it, so the file can't hand anyone a
# way in even if it leaks.

import hashlib
import hmac
import json
import os
import re
import secrets
import time

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(HERE, 'data', 'operators.json')

COLORS = ['#b3121a', '#2f7fff', '#22c55e', '#f59e0b', '#c026d3', '#06b6d4', '#e11d48', '#84cc16', '#f97316', '#8b5cf6']

HANDLE = re.compile(r'[A-Za-z][A-Za-z0-9_\-]{1,15}\Z')


def now_ms():
    return int(time.time() * 1000)


class OperatorDB:
    def __init__(self, file=FILE):
        self.file = file
        self.ops = {}  # handle, lowercased -> record
        self.load()

    def load(self):
        try:
            with open(self.file, encoding='utf8') as f:
                raw = json.load(f)
            for rec in raw.get('operators') or []:
                self.ops[rec['handle'].lower()] = rec
        except (OSError, ValueError, KeyError, AttributeError):
            pass  # No file yet: start empty.

    # Written straight away, and atomically (temp then rename), so a crash
    # mid-write can't corrupt the file and a signup can't be lost to a kill a
    # moment later. Accounts change rarely (create, login), so the cost is nil.
    def save(self):
        try:
            os.makedirs(os.path.dirname(self.file), exist_ok=True)
            tmp = self.file + '.tmp'
            with open(tmp, 'w', encoding='utf8') as f:
                json.dump({'version': 1, 'operators': list(self.ops.values())}, f, separators=(',', ':'))
            os.replace(tmp, self.file)
        except OSError as e:
            print('operator db save failed:', e)

    def has(self, handle):
        return str(handle).lower() in self.ops

    @property
    def size(self):
        return len(self.ops)

    # A handle no one holds yet: the wanted one, or it with -2, -3, ... .
    def free_handle(self, wanted):
        h, n = wanted, 2
        while h.lower() in self.ops:
            h = f'{wanted}-{n}'
            n += 1
        return h

    def _add(self, handle, secret):
        salt = secrets.token_hex(16)
        color = COLORS[len(self.ops) % len(COLORS)]
        rec = {'handle': handle, 'salt': salt, 'hash': scrypt(secret, salt), 'color': color,
               'created': now_ms(), 'lastSeen': now_ms(), 'runs': 0}
        self.ops[handle.lower()] = rec
        self.save()
        return rec

    # Create an operator and return { handle, key, color } — the key in the
    # clear, this once, for the player to keep. Never stored in the clear.
    def create(self, wanted_handle):
        handle = self.free_handle(wanted_handle)[:16]
        key = keygen()
        rec = self._add(handle, key)
        return {'handle': handle, 'key': key, 'color': rec['color']}

    # Create an operator with a handle and a password the player chose (the
    # ?action=createuser front door). The handle must be free — no silent
    # renaming — so a taken name is told to try another.
    def create_named(self, handle, password):
        clean = str(handle or '').strip()
        if not HANDLE.match(clean):
            return {'error': 'bad handle'}
        if not password:
            return {'error': 'no password'}
        if clean.lower() in self.ops:
            return {'error': 'taken'}
        rec = self._add(clean, str(password))
        return {'handle': clean, 'color': rec['color']}

    # Check a returning operator's key. On success bumps their session count
    # and returns { handle, color, runs }; on failure returns None.
    def verify(self, handle, key):
        rec = self.ops.get(str(handle).lower())
        if not rec:
            return None
        got = scrypt(str(key if key is not None else ''), rec['salt'])
        # Constant-time compare, so a wrong key doesn't leak how wrong it was.
        if not hmac.compare_digest(got, rec['hash']):
            return None
        rec['lastSeen'] = now_ms()
        rec['runs'] += 1
        self.save()
        return {'handle': rec['handle'], 'color': rec['color'], 'runs': rec['runs']}


# Same parameters the Node server used (its scrypt defaults), so accounts made
# before the move to Python still open with their old keys.
def scrypt(key, salt):
    return hashlib.scrypt(key.encode('utf8'), salt=salt.encode('utf8'), n=16384, r=8, p=1, dklen=32).hex()


# A key that's a fighting chance to remember and a pain to guess:
# three short words and a number, e.g. NEON-RAIN-CODE-4471.
WORDS = [
    'NEON', 'RAIN', 'CODE', 'GHOST', 'WIRE', 'DUSK', 'ECHO', 'IRON', 'VOID', 'ASH', 'NOVA', 'HALT', 'DRIFT', 'MASK',
    'GRID', 'SALT', 'HEX', 'ONYX', 'FLUX', 'ZERO', 'MOTH', 'GLASS', 'STATIC', 'RUST', 'PULSE', 'SMOKE', 'VESPER', 'RELAY',
]


def keygen():
    w = lambda: secrets.choice(WORDS)
    return f'{w()}-{w()}-{w()}-{1000 + secrets.randbelow(9000)}'
