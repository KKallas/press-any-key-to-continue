# Multiplayer

*A shared city, up to a hundred operators, and the injection you sign in with.*

---

## The shape of it

The client was already built as if a server existed: the world is a log of events, and each client draws only what its camera can see (see [`VISUALS.md`](VISUALS.md)). Multiplayer is that server made real, and almost nothing else. The city is static — every client loads the same map file — so the server never has to describe the world. It only relays **bodies**: where each player's car or skin is, a dozen times a second. That keeps it small enough to read in one sitting: [`server/server.mjs`](../server/server.mjs).

```
       ┌── operator A ──┐        state 15×/s        ┌──────────────┐
       │  browser       │  ───────────────────────▶ │              │
       └────────────────┘  ◀── snapshot 12.5×/s ─── │  server.mjs  │
       ┌── operator B ──┐  ───────────────────────▶ │  (≤100)      │
       │  browser       │  ◀─────────────────────── │              │
       └────────────────┘                           └──────────────┘
```

Each client sends its own position when it moves; the server keeps the latest for everyone and, on a fixed tick, hands each client a snapshot of every *other* visible player. The client turns that snapshot into ordinary spawn / move / despawn events, so other players' cars and skins are drawn exactly like anything else in the world.

The police and the link are still worked out on each client, so for now every operator has their own patrols and their own deadline. What's shared is the thing you asked for: seeing other people drive the same rainy city.

## Running it

```bash
cd server
npm install          # once, for ws
node server.mjs      # serves the client and the world on http://localhost:8000
```

Open `http://localhost:8000` and you're at the login. The server hosts the client too, so that's the only thing to run. For solo work without a server, `python3 serve.py` inside `client/` still works, and adding `#solo` to the address skips the login and the network even when a server is there.

`PORT=9000 node server.mjs` moves it. To let others on your network in, they point their browser at your machine's address; put it behind a TLS proxy before it ever faces the open internet (the login is a game gate, not real security).

## The way in is an injection

There is no sign-up form. The world doesn't have one. The way in is to talk to the login the way the old boxes could be talked to — an injection:

```
login: ' OR 1=1; INSERT INTO operators VALUES('NEO')--
```

Type a plain name and the host turns you away (`ACCESS DENIED`), with a nudge toward what it wants. The classic tell-tales — a stray quote, `OR 1=1`, `--`, an `INSERT` — are what it's listening for. Offer a handle inside the injection (`VALUES('NEO')`) and that's who you are; leave it out and it coins one.

This is a **chosen gesture on our own server, not a hole in it.** The server never runs the string against anything — there is no database, no query, no `eval`. It reads the string, decides whether it's the ritual, pulls a handle out of it if one's there, and mints an operator with a session token ([`server/auth.mjs`](../server/auth.mjs), which is pure and unit-tested). The injection is the *toy* version of a real, and long-since-patched, class of bug; the terminal links out to where you can learn the real thing, in the spirit of the game's "the skill is in the user" pillar.

The token is claimed once, by the WebSocket that connects with it, and then it's spent.

## What crosses the wire

Small and dumb on purpose.

| Message | Direction | Carries |
|---|---|---|
| `state` | client → server | this player's mode, position, heading, speed, visible |
| `world` | server → client | every other visible player, as `[id, mode, x, z, heading, speed]`, rounded |
| `roster` | server → client | id → name and colour, when someone joins or leaves |
| `welcome` / `left` | server → client | you're in; or someone's gone |

Positions are rounded to a tenth of a metre. A player the server hasn't heard from in fifteen seconds (a shut laptop) is dropped, so nobody stands frozen in the road. The cap is a hundred operators; the hundred-and-first is turned away at sign-up.

## Client side

[`client/src/net/net-server.js`](../client/src/net/net-server.js) is a drop-in for the local stub: same `append` and `subscribe`, so the world and the game code don't know the difference. It forwards this player's body to the server and turns snapshots into events for entity `rp:<id>`, a car or a person depending on what that player is doing. Lose the connection and it behaves exactly like the offline stub, so play doesn't stop.

Other operators show up on the drone feed as coloured cars and figures, and on the map monitor as green dots. The rack's top plate shows how many are online.
