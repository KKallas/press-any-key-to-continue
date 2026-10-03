# Getting in. Two doors, and the game teaches the first.
#
#   sign up   You've never been here. You get in the way the old boxes could
#             be got into: an injection at the login. That CREATES a
#             persistent operator and hands you a key to keep. This is a
#             chosen gesture on our own server, not a hole in it — we never
#             run the string against anything, no query, no eval. We read it,
#             decide whether it's the ritual, and pull a handle out of it if
#             one is offered.
#
#   log in    You've been here. You give your handle and the key the
#             injection gave you, and you're back as the same operator, with
#             your colour and your session count. A plain handle with no key,
#             and no injection, is turned away.
#
# The injection is the toy version of a real, long-patched class of bug; the
# terminal links out to where the real thing is taught.

import random
import re

# The tell-tales of an injection: a stray quote, a comment, a terminator, a
# tautology, or the SQL verbs people reach for.
INJECTION = re.compile(r"('|;|--|/\*|\bor\b\s+1\s*=\s*1|\bunion\b|\binsert\b|\bselect\b|\bdrop\b|\bexec\b)", re.I)

HANDLE = re.compile(r'[A-Za-z][A-Za-z0-9_\-]{1,15}\Z')
OFFERED = re.compile(r'''(?:values|handle|user(?:name)?|as|name)\s*[('"=\s]+([A-Za-z][A-Za-z0-9_\-]{1,15})''', re.I)
QUOTED = re.compile(r'''['"]([A-Za-z][A-Za-z0-9_\-]{1,15})['"]''')


def looks_like_injection(line):
    return bool(INJECTION.search(str(line or '')))


# A handle offered inside the injection, e.g. VALUES('NEO') or handle=trinity.
def handle_from(line):
    m = OFFERED.search(line) or QUOTED.search(line)
    return m.group(1).upper() if m else None


def coined():
    a = ['GHOST', 'NULL', 'ECHO', 'RAVEN', 'MERC', 'VESPER', 'KATE', 'ZERO', 'IONA', 'REV', 'HEX', 'ONYX']
    return f'{random.choice(a)}-{random.randrange(100, 1000)}'


# A plausible handle typed on its own (not an injection): letters, digits,
# dash, underscore. This is someone saying "it's me" so we can ask for a key.
def is_handle(line):
    return bool(HANDLE.match(str(line or '').strip()))


# The first line at the login. db is the OperatorDB; live/limit guard the shard.
# Returns one of:
#   { ok:True, created:True, handle, key, color }   fresh account, key shown once
#   { ok:False, needKey:True, handle }               known handle, ask for the key
#   { ok:False, reason }                             turned away
def parse_signup(line, db, live, limit):
    line = str(line or '').strip()[:300]
    if looks_like_injection(line):
        if live >= limit:
            return {'ok': False, 'reason': f'HOST FULL ({limit} OPERATORS)'}
        acct = db.create(handle_from(line) or coined())
        return {'ok': True, 'created': True, 'handle': acct['handle'], 'key': acct['key'], 'color': acct['color']}
    # Not an injection. If it names an operator we know, ask for the key.
    if is_handle(line) and db.has(line):
        return {'ok': False, 'needKey': True, 'handle': line.upper()}
    return {'ok': False, 'reason': 'ACCESS DENIED'}


# The returning door: handle plus the key the injection gave.
# { ok:True, handle, color, runs } or { ok:False, reason }.
def parse_login(handle, key, db, live, limit):
    if live >= limit:
        return {'ok': False, 'reason': f'HOST FULL ({limit} OPERATORS)'}
    who = db.verify(handle, key)
    if not who:
        return {'ok': False, 'reason': 'BAD KEY'}
    return {'ok': True, **who}
