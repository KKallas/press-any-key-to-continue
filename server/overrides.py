# The override store: the city's accreted, player-authored layer — and its
# history.
#
# Every object in the world has a base (what the procedural generator makes)
# and, optionally, an override — a bundle a player's own model forged and sent
# back: a new building, interior, behaviour, tweaked params. The base never
# changes; overrides stack on top, keyed by the object's stable id. An
# override can also bring a *new* object into being at the edge of the map,
# where a ghost waits to be made real.
#
# The store is a git repository of its own (inside server/data, so it survives
# a #99 rebuild that wipes the world from GitHub). Every contribution is a
# commit — the game is about leaving a sign, and here a sign is literally a
# commit in the city's history. Don't like what someone made of a building?
# Roll it back a commit and carry on from there.
#
# A bundle is an ordinary zip (your Python forge makes it with zipfile):
#
#   manifest.json   { id, type, prompt, facade?, interior?, behavior?, params?, meta? }
#   facade.png      optional — a facade texture
#   room.json       optional — an interior room definition
#   behavior.js     optional — sandboxed behaviour, run client-side in a Worker
#
# Nothing here executes a bundle. behavior.js is only stored and served; the
# client runs it in a locked-down Worker. The server vets the manifest, keeps
# only safe files, commits them, and remembers them.

import io
import json
import os
import posixpath
import re
import subprocess
import time
import zipfile

TYPES = {'building', 'room', 'car', 'road', 'item'}
ASSET = {
    'facade': {'ext': ['.png', '.jpg', '.webp'], 'max': 4 * 1024 * 1024},
    'interior': {'ext': ['.json'], 'max': 256 * 1024},
    'behavior': {'ext': ['.js'], 'max': 128 * 1024},
}
MAX_BUNDLE = 8 * 1024 * 1024
MAX_ENTRY = 8 * 1024 * 1024
SERVED = re.compile(r'/overrides/([a-z0-9_-]{1,64})/([a-zA-Z0-9_.-]{1,80})')


def slug(s):
    return re.sub(r'[^a-z0-9_-]', '', str(s or '').lower())[:64]


# Open a forge bundle: { filename: bytes } for the files in it, each reachable
# by its full name and its bare name. Caps what any one entry may expand to,
# whatever its header claims.
def unzip(buffer):
    out = {}
    with zipfile.ZipFile(io.BytesIO(buffer)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            if info.file_size > MAX_ENTRY or info.compress_size > MAX_ENTRY:
                raise ValueError('entry too big')
            with zf.open(info) as f:
                data = f.read(MAX_ENTRY + 1)
            if len(data) > MAX_ENTRY:
                raise ValueError('entry too big')
            out[posixpath.basename(info.filename)] = data
            out[info.filename] = data
    return out


class OverrideStore:
    def __init__(self, dir):
        self.dir = dir
        os.makedirs(dir, exist_ok=True)
        self._init_git()
        self.index = self._scan()

    def _git(self, *args):
        r = subprocess.run(['git', *args], cwd=self.dir, capture_output=True, text=True, check=True)
        return r.stdout.strip()

    def _init_git(self):
        try:
            if not os.path.exists(os.path.join(self.dir, '.git')):
                self._git('init', '-q')
                self._git('config', 'user.name', 'the city')
                self._git('config', 'user.email', 'forge@roboarena.org')
                self._git('commit', '--allow-empty', '-q', '-m', 'empty lot')
            self.git = True
        except (OSError, subprocess.CalledProcessError):
            self.git = False  # no git on this host: the store still works, just unversioned

    def _commit(self, msg):
        if not self.git:
            return
        try:
            self._git('add', '-A')
            self._git('commit', '-q', '-m', msg)
        except (OSError, subprocess.CalledProcessError):
            pass  # nothing staged, or git unhappy — not fatal

    # Rebuild the in-memory index by reading each object's stored manifest.
    def _scan(self):
        out = {}
        for id in os.listdir(self.dir):
            if id.startswith('.'):
                continue
            mf = os.path.join(self.dir, id, 'manifest.json')
            if not os.path.exists(mf):
                continue
            try:
                with open(mf, encoding='utf8') as f:
                    out[id] = json.load(f)
            except (OSError, ValueError):
                pass  # skip a broken one
        return out

    def all(self):
        return self.index

    # Take a forged bundle (zip bytes). Returns { ok, id, ver } or { error }.
    def ingest(self, buffer):
        if not buffer or len(buffer) > MAX_BUNDLE:
            return {'error': 'bundle too big'}
        try:
            files = unzip(buffer)
        except Exception:
            return {'error': 'not a readable zip'}
        man_raw = files.get('manifest.json')
        if not man_raw:
            return {'error': 'no manifest.json'}
        try:
            man = json.loads(man_raw.decode('utf8'))
        except ValueError:
            return {'error': 'bad manifest json'}
        if not isinstance(man, dict):
            man = {}
        id = slug(man.get('id'))
        if not id:
            return {'error': 'bad id'}
        type = man.get('type')
        if not isinstance(type, str) or type not in TYPES:
            return {'error': 'bad type'}

        picked = {}
        for field, rule in ASSET.items():
            ref = man.get(field)
            if not ref:
                continue
            base = posixpath.basename(str(ref))
            data = files.get(base) or files.get(str(ref))
            if not data:
                return {'error': f'missing file: {ref}'}
            if os.path.splitext(base)[1].lower() not in rule['ext']:
                return {'error': f'bad {field} type'}
            if len(data) > rule['max']:
                return {'error': f'{field} too big'}
            picked[field] = (base, data)

        odir = os.path.join(self.dir, id)
        os.makedirs(odir, exist_ok=True)
        meta = man.get('meta') if isinstance(man.get('meta'), dict) else {}
        rec = {
            'id': id,
            'type': type,
            'prompt': man['prompt'][:8000] if isinstance(man.get('prompt'), str) else '',
            'params': man['params'] if isinstance(man.get('params'), (dict, list)) else {},
            'meta': {'at': int(time.time() * 1000), 'author': slug(meta.get('author'))[:32] or 'anon'},
            'ver': (self.index.get(id, {}).get('ver') or 0) + 1,
        }
        for field, (base, data) in picked.items():
            with open(os.path.join(odir, base), 'wb') as f:
                f.write(data)
            rec[field] = f'/overrides/{id}/{base}'
        # The manifest is the record itself — the index is derived from it, so a
        # git checkout of an old version restores the object completely.
        with open(os.path.join(odir, 'manifest.json'), 'w', encoding='utf8') as f:
            json.dump(rec, f, indent=2)
        self.index[id] = rec
        self._commit(f"forge {id} {rec['type']} v{rec['ver']} by {rec['meta']['author']}")
        return {'ok': True, 'id': id, 'ver': rec['ver']}

    # The city's history, newest first: [{ hash, msg, at }]. For one object, pass
    # its id to see only the commits that touched it.
    def history(self, id=None):
        if not self.git:
            return []
        try:
            args = ['log', '--pretty=format:%h\x1f%s\x1f%cI', '-n', '50']
            if id:
                args += ['--', slug(id)]
            out = self._git(*args)
            if not out:
                return []
            return [dict(zip(('hash', 'msg', 'at'), line.split('\x1f'))) for line in out.split('\n')]
        except (OSError, subprocess.CalledProcessError):
            return []

    # Roll an object back to how it was before its last change, and commit that
    # as a new step forward (so history stays linear and shared). Returns
    # { ok, id, ver } or { error }.
    def rollback(self, id):
        id = slug(id)
        if not self.git:
            return {'error': 'no history on this host'}
        log = self.history(id)
        if len(log) < 2:
            return {'error': 'nothing earlier to go back to'}
        try:
            # Restore this object's folder as it was one change ago.
            self._git('checkout', log[1]['hash'], '--', id)
            self.index = self._scan()
            ver = self.index.get(id, {}).get('ver') or 0
            self._commit(f'rollback {id} to v{ver}')
            return {'ok': True, 'id': id, 'ver': ver}
        except (OSError, subprocess.CalledProcessError):
            return {'error': 'rollback failed'}

    def resolve(self, url_path):
        m = SERVED.fullmatch(url_path)
        if not m:
            return None
        file = os.path.join(self.dir, m.group(1), m.group(2))
        if not file.startswith(self.dir):
            return None
        return file if os.path.isfile(file) else None
