# City generator

*From a real map to a city the engine can populate, with a stop in Blender for manual changes.*

---

## The pipeline

```
OpenStreetMap ──fetch──▶ area.osm ──build──▶ city.json ──heights──▶ city.json
                                                   ▲                     │
                                                   └──── Blender ◀───────┘
                                                                         │
                                                  engine: base + buildings ◀┘
```

The **base** is made offline and changes rarely: roads, blocks, plots and their heights. **What stands on it** is made by the engine and changes whenever a prompt changes. Every plot with a height grows an Art Deco building from its footprint, height, seed and prompt.

## 1. Fetch a real area

```bash
cd tools/citygen
pip install shapely
python3 citygen.py fetch --bbox 59.4340,24.7390,59.4390,24.7500 --out area.osm
```

The box is `south,west,north,east` in degrees. Keep it to a few hundred metres a side for now. The fetch uses the public Overpass API, so run it from your own terminal: the sandboxed shells in this project's tooling can't reach it.

## 2. Build roads, blocks and plots

```bash
python3 citygen.py build area.osm --out city.json --name "Old Town"
```

- **Roads**: every drivable OSM road, cut to the area, with a width by class (primary 14 m, residential 9 m, service 6 m, ...).
- **Blocks**: whatever land the roads leave. Each block keeps a 3 m sidewalk, and the **lot** inside it is where buildings stand.
- **Plots**: real building footprints from the map are kept as they are. Empty land is cut into plots by repeatedly splitting across its long side, never quite evenly, the way land really gets parcelled. Slivers are dropped.
- **Heights**: taken from the map's `height` or `building:levels` where it has them. Everything else is left unknown.

## 3. Fill in heights

```bash
python3 citygen.py heights city.json --llm http://localhost:11434/v1 --model qwen2.5 \
    --brief "old harbour district, warehouses by the water, dense core by the square"
python3 citygen.py heights city.json --heuristic      # no LLM needed
```

With an LLM (any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM), the generator sends a short fact sheet per block: size, distance from the centre, which road classes touch it, any known heights. The LLM answers with a height range and a one-line architectural character for each block. Plots get heights inside their block's range, and the character becomes each plot's starting prompt. A few generated plots stay empty on purpose: parking, rubble, land nobody has written yet.

Without an LLM, or if its answer is unusable, a heuristic does the same job: taller towards the middle and along big roads, lower at the edges.

`--overwrite` redoes heights set earlier (never the map's own), and `--empty` sets the share of empty plots.

## 4. Doors and alleys

`build` runs this for you. Run it again after editing in Blender:

```bash
python3 citygen.py access city.json
```

Every building has to be reachable on foot from the street through at least one door:

- While cutting plots, some early cuts leave an **alley** behind: a 2.4 to 3.6 m lane through the block.
- The walkable space is everything that isn't a building, with half a metre of clearance. Only the pieces of it that touch a road count.
- Each building gets a **door** on a wall that faces reachable space: on the street if it can, otherwise on an alley or a yard, and sometimes a second or third door.
- A building that's still boxed in gets an alley carved to it through whatever stands in the way.

Doors are stored with each plot as hotzones (`x`, `z`, outward normal `nx`, `nz`, and `kind`: street, alley or yard). The engine lights them on the facade and shows them on the HUD. The sample city has 350 doors on 229 buildings, and the engine confirms every building can be walked to from the start.

## 5. Edit in Blender

Install [`tools/blender/pak_city.py`](../tools/blender/pak_city.py) through *Edit > Preferences > Add-ons > Install from Disk*. The panel is in the 3D view's sidebar (`N`), tab **PAK City**.

- **Import City** brings in roads (centre-line chains), blocks (flat slabs) and plots (footprints extruded to height). Plots from the map are red, generated plots grey, empty plots black.
- Move, reshape, delete or duplicate anything.
- **Change a height**: scale a plot in Z, move its top, or select plots and use **Set Height**. 0 leaves a plot empty.
- **Edit a prompt or seed**: select a plot; the fields are in the panel and under Object Properties > Custom Properties.
- **Make Plot** turns any mesh you model into a new plot. Its lowest face is the footprint.
- **Export City** writes it all back. Plots that weren't reshaped keep their doors. Reshaped or new plots need `citygen.py access` again, and the export tells you how many.
- New and duplicated plots get fresh ids, never one a deleted plot used, because the engine treats an id as the same building. A reshaped block gets its lot worked out again. A plot moved into another block joins it.

Blocks decide where the tarmac is: everything outside a block is road, and the car is faster there. Buildings and posts are the only barriers. Roads only give road markings and lamp positions, so reshape blocks to change the street layout.

## 6. The engine populates it

Put the file at `client/cities/<name>.json` (the engine loads `west-oakland` for now) and open the client. The engine:

- raises each block as a sidewalk slab with its lot inside, and treats the gaps as road
- builds collision from building footprints and posts only, with one map for the car and a finer one for a person
- paints road markings along the roads and places streetlamps on the kerbs
- grows an Art Deco building on every plot with a height, merged per block so the whole city costs a handful of draw calls per block
- adds the buildings' outlines to the drone's HUD

Add `#block01` to the address for the old hand-built test block.

## The Art Deco generator

[`client/src/world/deco.js`](../client/src/world/deco.js). The recipe comes from 1920s and 30s towers:

1. A **podium** that fills the plot.
2. **Setback tiers** that step inwards as they rise. On an ordinary plot a tier keeps the plot's own shape, shrunk about its centre. On an awkward one it falls back to the largest rectangle that fits.
3. **Vertical piers** up every face, running a little past each parapet.
4. A **crown**: stepped ziggurat, spire, corner fins, or flat. Sometimes a neon band round the top tier, and an aviation light on the tallest.

Windows follow real metres (2.4 m bays, 3.3 m floors), so floors line up across tiers.

Everything is chosen from the plot's seed, so the same plot always grows the same building. A plot can also carry a `style` that overrides any of it:

| Key | Meaning |
|---|---|
| `tiers` | 1 to 4: podium plus setbacks |
| `podium` | share of the height the podium takes (0 to 1) |
| `setback` | how much each tier shrinks (0.6 to 0.9) |
| `pierSpacing`, `pierDepth` | metres |
| `crown` | `ziggurat`, `spire`, `fins` or `flat` |
| `neon` | a colour like `#35e6ff`, or null |
| `stone`, `trim` | linear RGB, e.g. `[0.3, 0.22, 0.12]` for bronze |

This is where prompts come in later. An LLM reads a plot's prompt ("a bronze-crowned hotel with a neon band") and writes its `style`, and the engine regrows the building. The base never changes. Only what stands on it does.

## city.json

Coordinates are metres, X east, Z south, origin at the centre of the area. Polygons are lists of `[x, z]`, outer ring only, counter-clockwise.

```json
{
  "version": 1,
  "name": "West Oakland",
  "source": { "osm": "area.osm", "bbox": [s, w, n, e], "origin": [lat, lon] },
  "bounds": { "minX": -190, "maxX": 190, "minZ": -165, "maxZ": 165 },
  "sidewalk": 3,
  "roads":  [{ "id": "r0001", "class": "residential", "width": 9, "name": "...", "points": [[x, z], ...] }],
  "blocks": [{ "id": "k001", "polygon": [...], "lots": [[...]], "roads": ["residential"],
               "character": "stepped Art Deco towers ...", "height_range": [14, 35] }],
  "plots":  [{ "id": "p0001", "block": "k001", "footprint": [...], "height": 23.2,
               "source": "osm | generated | manual", "osm": "123", "name": null,
               "prompt": "...", "seed": 12345, "style": { },
               "doors": [{ "x": 12.4, "z": -3.1, "nx": 0, "nz": 1, "kind": "street | alley | yard" }] }]
}
```

## Sample

[`client/cities/west-oakland.json`](../client/cities/west-oakland.json) comes from the small West Oakland extract in the osmnx project's test data: 20 roads, 15 blocks, 245 plots (20 of them real footprints), 350 doors. Heights are from the heuristic. Run it through an LLM for a skyline with some intent.
