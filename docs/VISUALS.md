# Visuals

*How the city looks, why it looks that way, and how the engine draws it on almost any machine.*

---

## The camera is an object in the world

You never see the city directly. You see it through the simulation's own surveillance cameras. The near-overhead GTA2 view is a camera on a pole or a drone, and the timestamp in the corner reads **31.12.1999 23:59**. The seconds count up to 59 and fall back to 00. Midnight never comes.

That makes every flaw in the image part of the fiction, not a filter:

- **Lens dirt, flares, streaks.** The camera has glass, and the glass is filthy. Dirt only shows where light hits it, the way real dirt does.
- **Rain on the housing.** Drops sit on the lens and bend the image behind them.
- **Different cameras, different quality.** A cheap back-street camera is noisy, has a fisheye, and has a cracked housing. A bank camera is sharp and clean.
- **Hacking a camera changes your view.** That's a mechanic, not a menu option.
- **Fixed angles, Grim Fandango style.** Near terminals and interiors the view can cut to a mounted camera at a composed, film-like angle, then hand back to the overhead view on the street.
- **Parity.** An AI crew member gets exactly the same feed, dirt and all.

## Look

**Bleach bypass, with a nod to Sin City.** The image is graded as if the silver was never washed out of the print: desaturated, high contrast, crushed blacks, hard highlights. The rule that makes it Sin City is **light keeps its colour**. Neon, lit windows, headlights, and the lamp glow in the rain stay in colour. Everything they fall on goes almost monochrome. One saturated red survives outside the lights too, reserved for things the game wants you to notice (the car you're about to steal, for a start).

**A bad recording.** What reaches the player is not the camera's image but its cheap recording, and it looks like one: about 400 lines with pixels wider than they are tall, interlaced fields whose lines don't quite agree, colour stored at a quarter of the resolution so neon and tail lights bleed in blocks, 8x8 compression blocks with banding in the dark, now and then a macroblock that arrives from the wrong part of the frame, and a band of lines that loses sync and slides. The camera records at 12.5 frames per second, so the world moves in steps. The GPU also rests between frames, which makes the choppy look almost free.

Every camera sets its own recording in its lens profile (`lines`, `fps`, `compression`, `glitch`), so a bank camera can be clean and smooth while a back-street one is a smear.

**Tuning the grade.** The TUNE button opens sliders for every part of the grade: exposure, overall strength, bleach, contrast, shadow lift, how much colour survives outside the lights, and the green shadow tint. Settings are remembered in the browser. COPY gives them as code, to paste over `GRADE_DEFAULTS` in [`pipeline.js`](../client/src/engine/pipeline.js) and make them the default for everyone.

**Warm against cool.** The base is a cold green-cyan night in the tint of the Matrix, with sodium streetlights turning sickly. Against it, a slightly sweeter 90s: tungsten light spilling from windows, magenta and amber neon.

**Rain at the lens.** From the drone, rain doesn't only fall on the street: it starts at the camera. Drops close to the lens are big, soft and out of focus, streaked towards the middle of the picture as they fall away, and shrink to specks over the street. They live on their own render layer, so the wet-street mirror doesn't reflect them, and the street cameras don't see them. LENS RAIN in the TUNE panel sets how many there are.

**Rain and night everywhere.** Wet streets double every light source for free, and darkness hides low detail. Most of the budget goes into light, which is cheap in a browser if you fake it well. It is always night because nobody has ever written daylight (see [`LORE.md`](LORE.md)).

## Engine

**Three.js on WebGL2.** It runs on nearly everything, including old laptops and phones. The generator outputs geometry the way Blender building scripts do, so a 3D engine lets generated buildings drop in without a conversion step.

**Simple geometry, expensive light.** Flat, dark shapes. Strong emissive surfaces for windows, neon, and lamps. Almost all of the style lives in the post-processing chain: three.js's own bloom, then one camera pass that does the glass, dirt, drops, tone mapping and grade.

| Stage | Low | Mid | High |
|---|---|---|---|
| Render scale | 0.6 | 0.85 | 1.0 |
| Wet-street reflections | off (gloss only) | quarter resolution | half resolution |
| Rain streaks | fewer | full | full, lit by lamps |
| Bloom strength | 0.8 | 0.9 | 0.95 |
| Lens dirt in bloom | yes | yes | yes |
| Rain drops on the lens | no | no | yes |
| Chromatic aberration, barrel distortion | no | yes | yes |
| Grade, grain, scanlines, vignette, timestamp | yes | yes | yes |

The grade runs on every tier, because the look must not depend on the hardware. Only the richness of light does.

**Rain lit by lamps.** The rain is drawn entirely on the GPU. Each streak brightens as it passes through a lamp's cone, which is what makes rain at night look like rain.

**Wet streets.** The road mirrors the scene through a low-resolution planar reflection, broken up by puddle masks and ripples. It isn't physically correct, and nobody will notice in the rain.

## Server as the log, client as a camera

The server keeps the truth as an **event log**: a building spawned, a car stolen, a door opened, a machine re-imaged, a skin released. Each client subscribes only to the events its current camera can see and draws them however its hardware allows.

- Rain, flares, reflections, and the grade never touch the server.
- Only what a camera can see is sent, so there is no hidden-world data on the client to cheat with.
- The log is CCTV footage for free. Replay a camera's events and "rewind the tape" becomes a hacking minigame.

In the engine core, a local stub stands in for the server and replays a short spawn log for one block.

## Assets

Stay with CC0 sources so operators can reskin without licensing headaches:

- [Kenney](https://kenney.nl/assets) and [Quaternius](https://quaternius.com) for modular city pieces, cars, and characters
- [Poly Haven](https://polyhaven.com) and [ambientCG](https://ambientcg.com) for textures and HDRIs

The LLM generator configures modular pieces rather than inventing meshes, which keeps the Holy Modular Triad honest. Lens dirt, rain, and window textures are generated in code.

## The drone

**You move as a drone.** The player's view is a surveillance drone over the city, looking almost straight down, low and wide, so tall buildings lean out from the middle of the screen the way they do in GTA2. It climbs as the car speeds up, like GTA2's camera, and drifts in a very slow orbit. From altitude the haze thins out, and the drone's digital recording is smoother (25 fps) but blockier than the street cameras.

**Burned-in symbology.** Everything green is drawn into one layer that joins the picture inside the camera pass, after the grade and before compression, interlacing and noise. So the symbology degrades with the video, the way it does on old aviation footage: pixelated to the video lines, torn with the tape, blocked by the compression, with a soft phosphor halo. The layer holds a heading tape, crosshair, frame brackets, telemetry (altitude, ground speed, zoom, grid reference, mode), the wireframe of the building under the pointer (its roof outline and corner edges that fade down the facade; the rest of the city stays clean), dashed block outlines, block names, known camera positions, and the tracking box. Only the quality buttons and the controls hint stay on top as page elements.

**Seeing through walls.** When a building stands between the drone and the skin, or the car it's driving, the targeting system draws the body's outline in green straight through the facade, so you never lose yourself behind a tower.

**Tracking.** The drone locks on to the car you drive, with a tracking box and ground speed, and leads it slightly. Drag to look away (the mode reads FREE), `F` to lock back on (TRACK).

**Click to drive.** You don't steer; you point. A click on the drone feed sets a waypoint, and the car drives itself there through its own controls (throttle, brake, steering, handbrake), so it can only do what a driver could.

A **single click** drives like everyone else. The car follows the street network, turns at the junctions, keeps to the right-hand lane, slows for corners, and parks at the kerb nearest the waypoint, on the waypoint's side of the street (going round the block for it if it has to). A waypoint off the road means the nearest kerb, and the skin walks the rest.

A **double-click** means as fast as possible: the shortest line, across the grass and the pavement and down the alleys, handbrake drifts through the sharp turns, and kerbs hit fast enough to leave the ground. The route and the waypoint are drawn on the HUD, with longer dashes when it's flat out.

**Click a building** and the car goes to its door: the one nearest the kerb, parked as close as the car can get (about four metres from the door, usually). The building's wireframe comes up under the pointer, so you can see what you're about to click. On foot, a click walks and a double-click runs; click a building or a door and the skin walks in, click the car and it gets in. Touching the keyboard takes over at any time. If the car gets stuck it backs away from whatever stopped it and tries again.

In testing, to 24 random waypoints across West Oakland, both modes arrived every time. A careful drive spent about 83% of its time in the right-hand lane (against 44% for a flat-out one) and averaged about 10 m/s; flat out averaged about 12 m/s with nearly two seconds of airtime per drive.

**On foot and through doors.** Nothing but physical barriers stops you. The car goes anywhere there's room: roads, sidewalks, empty lots, alleys wide enough. Only buildings and posts stop it, and kerbs and paving just slow it down. `E` gets the skin out, and on foot it slips down alleys the car can't. Every building has at least one door, marked as a hotzone on the HUD and lit on the facade. At a door, `E` goes inside, and the feed cuts to the building's own security camera, a dome up in the corner of the lobby: a desk, a terminal left logged in, a strip light that can't decide. It's the same room in every building for now, a placeholder for interiors generated per building later. `E` again comes back out. The drone comes down closer while you're on foot.

**Driving.** The car scrapes along walls and bounces off posts, trees and other cars. Steering is relative to the car, so it stays right as the drone circles. Movement goes through the server as transient events: the client simulates, sends, and draws the car only when the event comes back, so the same path works over a network later.

**Street cameras.** The CCTV cameras are objects in the world, housings with a red tally light on lamp posts, walls and a mast, tagged on the drone feed. Hacking into them comes later, through an in-game web browser of the period. For development, `Tab` jumps into the next camera's feed and `Esc` returns to the drone.

## The rack

The page is a monitor rack from an outside-broadcast truck: rack rails with their screw holes, a maker's plate, tally lights, bezels with knobs and label tapes. The big CRT (**PGM**) carries whichever feed you're on. Down the side, three small ones:

- **MAP**: the city as a dispatch terminal of the period would draw it, in green vectors. Streets, blocks, stippled parks, your car, the police, and the next **link** blinking with its deadline. The bottom line shows the heat.
- **AUX 1** and **AUX 2**: nothing plugged in yet, so they show dim snow and NO INPUT.

On a phone the three small monitors sit in a row under the big one.

## The link and the law

**The link.** The map monitor names a building and a time on the clock: `LINK P0206 BY 23:59:30`. Get the skin there (by car to its door, or into the building) before the clock reads it. Nobody says what the link is for. The clock only ever reads 23:59, so the window is seconds, and it's set tight: a careful drive won't quite make it. You'll have to cut across the grass or speed. On the drone feed the link is a diamond on the ground with a countdown, or an arrow on the edge of the picture pointing the way.

**The police** drive the streets like anyone else, in lane. Drive like everyone else and they don't care. Speed (over about 52 km/h), leave the road, or take off, where a patrol car has a line of sight to you, and the heat goes up:

| Heat | What happens |
|---|---|
| WANTED | The patrols that saw you give chase, light bars and sirens on (the siren is synthesised, and louder the nearer the drone is looking) |
| ROADBLOCK | A patrol car is parked across the road ahead of you |
| AGENTS | A black car comes for you. If it reaches the skin, the skin is lost, and you wake up in a new one somewhere else, with a car |

Out of sight, the heat cools and they give up. Everyone drives through the same car controls and autopilot as you, and sees only what a line of sight allows. The HUD tracks them: a flashing diamond for a patrol, a crossed box for an agent.

## Street clutter

Trees fill the parks and line the wider streets. There are trash cans by the doors, manhole covers in the road, puddles on the pavement, and shop signs over the street doors (HOTEL, PAWN, TV REPAIR, and one that asks KUS ON SUVALINE KLAHV?). Trees and cans are solid; the rest is to look at. Each kind is a single instanced or merged mesh, so the whole city of clutter costs a handful of draw calls.

## Junctions

The street network (a graph split at every crossing, the same one the car drives) tells the markings and the signals where the junctions are. Each arm of a junction gets a **zebra crossing** and a **stop line** painted into the road texture, and the wider streets carry **parking bays** ticked along the kerb between junctions. At the busier crossings a **traffic light** stands on a corner, its red, amber or green lens glowing into the wet road. The signals are set once, out of step with each other, so the city reads as alive from the drone; making them cycle, and making the car and the law obey them, comes later.

## Rooftops

The roof is the one face of a building you always see from a drone, so it does the most work. Each roof has a **parapet** lip and a lighter gravel **deck**, and on it: **puddles** most of all — irregular black pools that catch the light and bloom, because it never stops raining — then glowing **skylights**, a **rooftop sign** (a bright bar painted on the deck, or a lit billboard on legs), and a **fire escape** zigzagging down the tallest wall, which reads as a ladder from above. The old hard clutter — air-conditioning units, water tanks, vents, chimneys, a dish, an antenna with a red light — is still there but sparser, so the water and the signs come through. It all merges into the block's handful of meshes.

## Current state

The engine core in [`client/`](../client) draws the generated West Oakland in the rain on the monitor rack, with the drone, the red car, the skin, patrols, an agent, the link, and the interior camera. `#block01` on the address loads the hand-built test block instead. Run `python3 serve.py` inside `client/` and open http://localhost:8000. It's a small static server with caching turned off, so edits show up on reload.

| Input | Does |
|---|---|
| Click | Set a waypoint. In the car: drive there in lane and park. On foot: walk there. Click a building to go to its door (by car, park by it; on foot, walk in), or the car to get in |
| Double-click | The same, as fast as possible: flat out across the grass in the car, running on foot |
| Drag | Look around (breaks the lock) |
| `E` or `Enter` | Get out of the car; at a door, go in (the feed cuts to the camera inside); inside, come out; next to the car, get in |
| `W` `A` `S` `D`, arrows, `Space`, `Shift` | Manual override: drive or walk yourself (the waypoint is dropped); handbrake; run |
| `F` | Lock the drone back on the car or the skin |
| `Z` `X` | Steer the orbit |
| Scroll, `+` `-` | Zoom the drone's lens |
| `Tab`, `Esc` | Development: into a street camera's feed, back to the drone |
| `1` `2` `3` | Quality tier |
| `G` | Grade on or off |
