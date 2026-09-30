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

**Warm against cool.** The base is a cold green-cyan night in the tint of the Matrix, with sodium streetlights turning sickly. Against it, a slightly sweeter 90s: tungsten light spilling from windows, magenta and amber neon.

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

**Burned-in symbology.** Everything green is drawn into one layer that joins the picture inside the camera pass, after the grade and before compression, interlacing and noise. So the symbology degrades with the video, the way it does on old aviation footage: pixelated to the video lines, torn with the tape, blocked by the compression, with a soft phosphor halo. The layer holds a heading tape, crosshair, frame brackets, telemetry (altitude, ground speed, zoom, grid reference, mode), faint partial wireframes of the buildings (roof outlines and corner edges that fade down the facade), dashed block outlines, block names, known camera positions, and the tracking box. Only the quality buttons and the controls hint stay on top as page elements.

**Tracking.** The drone locks on to the car you drive, with a tracking box and ground speed, and leads it slightly. Drag to look away (the mode reads FREE), `F` to lock back on (TRACK).

**On foot and through doors.** Nothing but physical barriers stops you. The car goes anywhere there's room: roads, sidewalks, empty lots, alleys wide enough. Only buildings and posts stop it, and kerbs and paving just slow it down. `E` gets the skin out, and on foot it slips down alleys the car can't. Every building has at least one door, marked as a hotzone on the HUD and lit on the facade. At a door, `E` goes inside. Interiors come later; for now the skin disappears into the building and the server logs the visit. The drone comes down closer while you're on foot.

**Driving.** Four blocks in a 2x2 grid, ringed by roads that run on past the city into empty lots. The car stays on the roads and scrapes along kerbs. Steering is relative to the car, so it stays right as the drone circles. Movement goes through the server as transient events: the client simulates, sends, and draws the car only when the event comes back, so the same path works over a network later.

**Street cameras.** The CCTV cameras are objects in the world, housings with a red tally light on lamp posts, walls and a mast, tagged on the drone feed. Hacking into them comes later, through an in-game web browser of the period. For development, `Tab` jumps into the next camera's feed and `Esc` returns to the drone.

## Current state

The engine core in [`client/`](../client) draws four blocks in the rain, with placeholder buildings, streets, a drivable red car, a few figures under umbrellas, streetlamps, neon, four street cameras and the drone. Run `python3 serve.py` inside `client/` and open http://localhost:8000. It's a small static server with caching turned off, so edits show up on reload.

| Input | Does |
|---|---|
| `W` `A` `S` `D` or arrow keys | Drive, or walk (on foot W is up on the screen) |
| `Space` | Handbrake |
| `Shift` | Run |
| `E` or `Enter` | Get out of the car; at a door, go in; inside, come out; next to the car, get in |
| Drag | Look around (breaks the lock) |
| `F` | Lock the drone back on the car or the skin |
| `Z` `X` | Steer the orbit |
| Scroll, `+` `-` | Zoom the drone's lens |
| `Tab`, `Esc` | Development: into a street camera's feed, back to the drone |
| `1` `2` `3` | Quality tier |
| `G` | Grade on or off |
