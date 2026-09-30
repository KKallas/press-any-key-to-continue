#!/usr/bin/env python3
"""City generator for Press Any Key to Continue.

Turns a real map area into a city file the engine can populate:

    OpenStreetMap  ->  roads, blocks, lots, plots  ->  heights  ->  city.json

Steps (each is a subcommand, so you can stop, edit in Blender, and go on):

    fetch    download an area from OpenStreetMap (Overpass API)
    build    roads, blocks and plots from an .osm file; real building
             footprints are kept, empty land is cut into plots
    heights  fill in heights OpenStreetMap doesn't know: an LLM marks
             each block's height range and character, or a heuristic
             does it when no LLM is available
    access   make sure every building can be walked to from the street,
             carving alleys where needed, and place its doors (build runs
             this for you; run it again after editing in Blender)
    parks    clear a few street-facing plots to grass: the green the game
             uses as shortcuts (run after heights, then access again)

Examples:

    python3 citygen.py fetch --bbox 59.4350,24.7400,59.4400,24.7500 --out area.osm
    python3 citygen.py build area.osm --out city.json --name "Old Town"
    python3 citygen.py heights city.json --llm http://localhost:11434/v1 --model qwen2.5
    python3 citygen.py heights city.json --heuristic
    python3 citygen.py access city.json
    python3 citygen.py parks city.json --count 12

Coordinates in city.json are metres: X east, Z south, origin at the centre
of the area. Polygons are lists of [x, z] points, exterior ring only.

Needs: shapely (pip install shapely). Everything else is standard library.
"""

import argparse
import json
import math
import random
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

try:
    from shapely import make_valid
    from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
    from shapely.geometry.polygon import orient
    from shapely.ops import nearest_points, split, unary_union
except ImportError:  # pragma: no cover
    sys.exit("citygen needs shapely:  pip install shapely")


# Road classes the car can drive on, and how wide they are in metres.
ROAD_WIDTHS = {
    "motorway": 18, "trunk": 16, "primary": 14, "secondary": 12, "tertiary": 11,
    "motorway_link": 8, "trunk_link": 8, "primary_link": 8, "secondary_link": 8, "tertiary_link": 8,
    "unclassified": 9, "residential": 9, "living_street": 7, "service": 6,
}
ROAD_RANK = {c: i for i, c in enumerate(
    ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
     "residential", "living_street", "service"])}

SIDEWALK = 3.0          # metres of pavement between road and lot
PLOT_MAX_AREA = 520.0   # empty land is cut until plots are this small
PLOT_MIN_AREA = 45.0
PLOT_GAP = 0.8          # metres between neighbouring generated buildings
LEVEL_HEIGHT = 3.3
ALLEY_CHANCE = 0.35     # share of early cuts that leave an alley behind
ALLEY_WIDTH = (2.4, 3.6)
WALK_CLEAR = 0.45       # half the narrowest gap a person can walk through


# ---------------------------------------------------------------- fetch ---

OVERPASS = "https://overpass-api.de/api/interpreter"


def cmd_fetch(args):
    s, w, n, e = (float(v) for v in args.bbox.split(","))
    query = f"""
[out:xml][timeout:90];
(
  way["highway"]({s},{w},{n},{e});
  way["building"]({s},{w},{n},{e});
);
(._;>;);
out body;
"""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(args.server, data=data, headers={"User-Agent": "press-any-key-citygen/1"})
    print(f"Fetching {s},{w},{n},{e} from {args.server} ...")
    with urllib.request.urlopen(req, timeout=180) as r:
        xml = r.read().decode("utf-8")
    # Overpass doesn't include the box we asked for; record it so build knows the area.
    xml = re.sub(r"(<osm[^>]*>)", rf'\1\n  <bounds minlat="{s}" minlon="{w}" maxlat="{n}" maxlon="{e}"/>', xml, count=1)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(xml)
    print(f"Wrote {args.out} ({len(xml) // 1024} KB)")


# ---------------------------------------------------------------- build ---

def parse_osm(path):
    root = ET.parse(path).getroot()
    nodes = {}
    for nd in root.iter("node"):
        nodes[nd.get("id")] = (float(nd.get("lat")), float(nd.get("lon")))
    ways = []
    for w in root.iter("way"):
        refs = [r.get("ref") for r in w.findall("nd")]
        tags = {t.get("k"): t.get("v") for t in w.findall("tag")}
        ways.append({"id": w.get("id"), "refs": refs, "tags": tags})
    b = root.find("bounds")
    bounds = None
    if b is not None:
        bounds = tuple(float(b.get(k)) for k in ("minlat", "minlon", "maxlat", "maxlon"))
    return nodes, ways, bounds


class Projection:
    """Local flat projection around the area's centre. Good to a few
    centimetres over a few kilometres, which is all a city game needs."""

    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.kz = 110540.0

    def __call__(self, lat, lon):
        return ((lon - self.lon0) * self.kx, -(lat - self.lat0) * self.kz)


def parse_height(tags):
    h = tags.get("height") or tags.get("building:height")
    if h:
        m = re.match(r"\s*([\d.]+)\s*(m|ft|')?", h)
        if m:
            v = float(m.group(1))
            if m.group(2) in ("ft", "'"):
                v *= 0.3048
            return round(v, 1)
    levels = tags.get("building:levels")
    if levels:
        try:
            return round(float(levels) * LEVEL_HEIGHT + 1.0, 1)
        except ValueError:
            pass
    return None


def polys_of(geom):
    """All polygons in a geometry, whatever shape it came back in."""
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    if hasattr(geom, "geoms"):
        out = []
        for g in geom.geoms:
            out += polys_of(g)
        return out
    return []


def ring(poly, digits=2):
    poly = orient(poly.simplify(0.25, preserve_topology=True), 1.0)
    pts = list(poly.exterior.coords)[:-1]
    return [[round(x, digits), round(z, digits)] for x, z in pts]


def subdivide(poly, rng, depth=0):
    """Cut a piece of land into plots by splitting it across its long side,
    the way land really gets parcelled: repeatedly, and never quite evenly."""
    if poly.area <= PLOT_MAX_AREA or depth > 12:
        return [poly]
    rect = poly.minimum_rotated_rectangle
    c = list(rect.exterior.coords)
    e1 = (c[1][0] - c[0][0], c[1][1] - c[0][1])
    e2 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    long_edge = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
    L = math.hypot(*long_edge)
    ux, uz = long_edge[0] / L, long_edge[1] / L
    cx, cz = rect.centroid.x, rect.centroid.y
    t = (rng.random() - 0.5) * 0.3 * L
    px, pz = cx + ux * t, cz + uz * t
    # Cut perpendicular to the long side.
    far = 4 * L
    cut = LineString([(px - uz * far, pz + ux * far), (px + uz * far, pz - ux * far)])
    try:
        parts = polys_of(split(poly, cut))
    except Exception:
        return [poly]
    if len(parts) < 2:
        return [poly]
    # Early cuts sometimes leave an alley behind: service lanes and
    # passages running through the block to the street.
    if depth <= 3 and rng.random() < ALLEY_CHANCE:
        lane = cut.buffer(rng.uniform(*ALLEY_WIDTH) / 2, cap_style="flat")
        parts = [q for p in parts for q in polys_of(p.difference(lane))]
    out = []
    for p in parts:
        out += subdivide(p, rng, depth + 1)
    return out


def good_plot(p):
    if p.area < PLOT_MIN_AREA:
        return False
    rect = p.minimum_rotated_rectangle
    c = list(rect.exterior.coords)
    sides = sorted([math.dist(c[0], c[1]), math.dist(c[1], c[2])])
    return sides[0] >= 5.0 and p.area / max(rect.area, 1e-6) >= 0.45


def cmd_build(args):
    rng = random.Random(args.seed)
    nodes, ways, bounds = parse_osm(args.osm)
    if args.bbox:
        s, w, n, e = (float(v) for v in args.bbox.split(","))
        bounds = (s, w, n, e)
    if bounds is None:
        lats = [p[0] for p in nodes.values()]
        lons = [p[1] for p in nodes.values()]
        bounds = (min(lats), min(lons), max(lats), max(lons))
    s, w, n, e = bounds
    proj = Projection((s + n) / 2, (w + e) / 2)
    x0, z1 = proj(s, w)
    x1, z0 = proj(n, e)
    area = box(x0, z0, x1, z1)

    # Roads.
    roads = []
    for way in ways:
        cls = way["tags"].get("highway")
        if cls not in ROAD_WIDTHS or way["tags"].get("area") == "yes":
            continue
        if cls == "service" and way["tags"].get("service") in ("parking_aisle", "drive-through"):
            continue
        pts = [proj(*nodes[r]) for r in way["refs"] if r in nodes]
        if len(pts) < 2:
            continue
        line = LineString(pts).intersection(area)
        for part in getattr(line, "geoms", [line]):
            if part.is_empty or part.length < 3 or part.geom_type != "LineString":
                continue
            roads.append({"id": f"r{len(roads) + 1:04d}", "class": cls, "width": ROAD_WIDTHS[cls],
                          "geom": part, "name": way["tags"].get("name")})
    if not roads:
        sys.exit("No drivable roads in this area.")
    road_space = unary_union([r["geom"].buffer(r["width"] / 2, cap_style="flat", join_style="round") for r in roads])

    # Blocks: whatever land the roads leave. Each block keeps its sidewalk;
    # the lot inside it is where buildings stand.
    blocks = []
    for poly in polys_of(area.difference(road_space)):
        if poly.area < 150:
            continue
        lots = [p for p in polys_of(poly.buffer(-SIDEWALK, join_style="mitre")) if p.area > 30]
        near = poly.buffer(1.5)
        classes = sorted({r["class"] for r in roads if r["geom"].intersects(near)}, key=lambda c: ROAD_RANK.get(c, 99))
        blocks.append({"id": f"k{len(blocks) + 1:03d}", "poly": poly, "lots": lots, "roads": classes})

    # Real buildings from the map.
    osm_buildings = []
    for way in ways:
        if "building" not in way["tags"] or len(way["refs"]) < 4 or way["refs"][0] != way["refs"][-1]:
            continue
        pts = [proj(*nodes[r]) for r in way["refs"] if r in nodes]
        if len(pts) < 4:
            continue
        p = make_valid(Polygon(pts))
        for part in polys_of(p):
            if part.area > 12:
                osm_buildings.append({"poly": part, "tags": way["tags"], "osm": way["id"]})

    plots = []

    def add_plot(block, footprint, source, height=None, tags=None, osm=None):
        plots.append({
            "id": f"p{len(plots) + 1:04d}",
            "block": block["id"],
            "footprint": ring(footprint),
            "height": height,
            "source": source,
            "osm": osm,
            "name": (tags or {}).get("name"),
            "prompt": "",
            "seed": rng.randrange(1, 2**31),
        })

    for b in blocks:
        lot_union = unary_union(b["lots"]) if b["lots"] else Polygon()
        if lot_union.is_empty:
            continue
        taken = []
        for ob in osm_buildings:
            if not b["poly"].contains(ob["poly"].representative_point()):
                continue
            fp = ob["poly"].intersection(lot_union)
            for part in polys_of(fp):
                if part.area > 12:
                    add_plot(b, part, "osm", parse_height(ob["tags"]), ob["tags"], ob["osm"])
                    taken.append(part)
        free = lot_union.difference(unary_union([t.buffer(1.5) for t in taken])) if taken else lot_union
        for piece in polys_of(free):
            for plot in subdivide(piece, rng):
                if not good_plot(plot):
                    continue
                fp = plot.buffer(-PLOT_GAP / 2, join_style="mitre")
                for part in polys_of(fp):
                    if good_plot(part):
                        add_plot(b, part, "generated")

    city = {
        "version": 1,
        "name": args.name or args.osm,
        "source": {"osm": args.osm, "bbox": [s, w, n, e], "origin": [proj.lat0, proj.lon0]},
        "bounds": {"minX": round(x0, 2), "maxX": round(x1, 2), "minZ": round(z0, 2), "maxZ": round(z1, 2)},
        "sidewalk": SIDEWALK,
        "roads": [{"id": r["id"], "class": r["class"], "width": r["width"], "name": r["name"],
                   "points": [[round(x, 2), round(z, 2)] for x, z in r["geom"].coords]} for r in roads],
        "blocks": [{"id": b["id"], "polygon": ring(b["poly"]), "lots": [ring(l) for l in b["lots"]],
                    "roads": b["roads"], "character": ""} for b in blocks],
        "plots": plots,
    }
    carved, doors = ensure_access(city, rng)
    save(city, args.out)
    print(f"Access: {doors} doors, {carved} alleys carved to reach boxed-in buildings")
    known = sum(1 for p in plots if p["height"] is not None)
    print(f"{len(roads)} roads, {len(blocks)} blocks, {len(plots)} plots "
          f"({sum(1 for p in plots if p['source'] == 'osm')} from the map, {known} with known height)")
    print(f"Wrote {args.out}. Next: python3 citygen.py heights {args.out}")


# --------------------------------------------------------------- access ---

def road_space_of(city):
    return unary_union([LineString(r["points"]).buffer(r["width"] / 2, cap_style="flat", join_style="round")
                        for r in city["roads"] if len(r["points"]) >= 2])


def reachable_space(city, footprints, roads):
    """Where a person can walk to from the street: everything that isn't a
    building (with a little clearance), in pieces that touch a road."""
    b = city["bounds"]
    area = box(b["minX"], b["minZ"], b["maxX"], b["maxZ"])
    walls = unary_union([f.buffer(WALK_CLEAR, join_style="mitre") for f in footprints if not f.is_empty])
    pieces = polys_of(area.difference(walls))
    return unary_union([p for p in pieces if p.intersects(roads)])


def door_candidates(fp, reach, roads):
    """Facade points you can reach, one per long enough edge, best first."""
    fp = orient(fp, 1.0)
    pts = list(fp.exterior.coords)[:-1]
    out = []
    for i in range(len(pts)):
        (ax, az), (bx, bz) = pts[i], pts[(i + 1) % len(pts)]
        L = math.hypot(bx - ax, bz - az)
        if L < 2.2:
            continue
        nx, nz = (bz - az) / L, -(bx - ax) / L  # outward for a counter-clockwise ring
        # Try spots along the wall, middle first: a wall can be reachable
        # along only part of its length (the end of an alley, a gap).
        n = max(1, int((L - 2.0) / 1.2))
        ts = sorted((0.5 if n == 1 else (1.0 + k * (L - 2.0) / (n - 1)) / L for k in range(n)), key=lambda t: abs(t - 0.5))
        spot = None
        for t in ts:
            mx, mz = ax + (bx - ax) * t, az + (bz - az) * t
            probe = Point(mx + nx * (WALK_CLEAR + 0.4), mz + nz * (WALK_CLEAR + 0.4))
            if reach.contains(probe):
                spot = (mx, mz, probe)
                break
        if spot is None:
            continue
        mx, mz, probe = spot
        street = roads.distance(probe) < SIDEWALK + 1.5
        out.append({"x": round(mx, 2), "z": round(mz, 2), "nx": round(nx, 3), "nz": round(nz, 3),
                    "kind": "street" if street else "alley", "_score": (0 if street else 1, -L)})
    out.sort(key=lambda d: d["_score"])
    if not out and fp.distance(reach) <= WALK_CLEAR + 0.1:
        # Open space only touches a corner: the door goes where it touches.
        a, _ = nearest_points(fp.exterior, reach)
        best = min(range(len(pts)), key=lambda i: LineString([pts[i], pts[(i + 1) % len(pts)]]).distance(a))
        (ax, az), (bx, bz) = pts[best], pts[(best + 1) % len(pts)]
        L = math.hypot(bx - ax, bz - az) or 1
        nx, nz = (bz - az) / L, -(bx - ax) / L
        out.append({"x": round(a.x, 2), "z": round(a.y, 2), "nx": round(nx, 3), "nz": round(nz, 3),
                    "kind": "yard", "_score": (2, 0)})
    return out


def ensure_access(city, rng, passes=4):
    """Every building gets at least one door that can be walked to from the
    street. A boxed-in building gets an alley carved to it through whatever
    stands in the way. Returns (alleys carved, doors placed)."""
    roads = road_space_of(city)
    plots = city["plots"]
    fps = [make_valid(Polygon(p["footprint"])) if len(p["footprint"]) >= 3 else Polygon() for p in plots]
    fps = [max(polys_of(f), key=lambda q: q.area) if polys_of(f) else Polygon() for f in fps]
    carved = 0
    for _ in range(passes):
        reach = reachable_space(city, fps, roads)
        stuck = [i for i, f in enumerate(fps) if not f.is_empty and not door_candidates(f, reach, roads)]
        if not stuck:
            break
        for i in stuck:
            f = fps[i]
            if f.is_empty:
                continue
            a, b = nearest_points(f.exterior, reach)
            L = math.hypot(b.x - a.x, b.y - a.y) or 1
            ux, uz = (b.x - a.x) / L, (b.y - a.y) / L
            path = LineString([(a.x - ux * 0.5, a.y - uz * 0.5), (b.x + ux * 1.5, b.y + uz * 1.5)])
            lane = path.buffer(1.3, cap_style="flat")
            for j, g in enumerate(fps):
                if j != i and not g.is_empty and g.intersects(lane):
                    rest = polys_of(g.difference(lane))
                    fps[j] = max(rest, key=lambda q: q.area) if rest and max(q.area for q in rest) > PLOT_MIN_AREA else Polygon()
            carved += 1
    reach = reachable_space(city, fps, roads)
    kept, doors = [], 0
    for p, f in zip(plots, fps):
        if f.is_empty or f.area < 12:
            continue  # carved away entirely
        p["footprint"] = ring(f)
        cands = door_candidates(Polygon(p["footprint"]), reach, roads)
        chosen = cands[:1]
        for c in cands[1:]:
            if len(chosen) < 3 and rng.random() < 0.3 and all(math.hypot(c["x"] - d["x"], c["z"] - d["z"]) > 6 for d in chosen):
                chosen.append(c)
        for c in chosen:
            c.pop("_score", None)
        p["doors"] = chosen
        doors += len(chosen)
        kept.append(p)
    city["plots"] = kept
    unreachable = sum(1 for p in kept if not p["doors"])
    if unreachable:
        print(f"  {unreachable} buildings still have no reachable door; check them in Blender")
    return carved, doors


def cmd_access(args):
    city = load(args.city)
    carved, doors = ensure_access(city, random.Random(args.seed))
    city.pop("needs_access", None)
    save(city, args.out or args.city)
    print(f"Access: {doors} doors, {carved} alleys carved. Wrote {args.out or args.city}")


# ---------------------------------------------------------------- parks ---

def cmd_parks(args):
    """Turn a few street-facing plots (and small neighbours) into grass."""
    city = load(args.city)
    rng = random.Random(args.seed)
    roads = road_space_of(city)
    plots = city["plots"]
    polys = {p["id"]: Polygon(p["footprint"]) for p in plots}
    candidates = [p for p in plots if p.get("height") and p.get("source") == "generated"
                  and 120 <= polys[p["id"]].area <= 900 and polys[p["id"]].distance(roads) < 6]
    rng.shuffle(candidates)
    chosen = []
    for p in candidates:
        if len(chosen) >= args.count:
            break
        c = polys[p["id"]].centroid
        if any(c.distance(polys[q["id"]].centroid) < args.spacing for q in chosen):
            continue
        chosen.append(p)
    cleared = 0
    for p in chosen:
        park = [p]
        area = polys[p["id"]].area
        # Take in a small neighbour or two, for a park rather than a gap.
        for q in plots:
            if q is p or q["block"] != p["block"] or not q.get("height") or q.get("source") != "generated":
                continue
            if polys[q["id"]].distance(polys[p["id"]]) < 1.6 and area + polys[q["id"]].area < 1300 and rng.random() < 0.6:
                park.append(q)
                area += polys[q["id"]].area
        for q in park:
            q["height"] = 0
            q["use"] = "park"
            q["doors"] = []
            cleared += 1
    save(city, args.out or args.city)
    print(f"Parks: {len(chosen)} parks from {cleared} plots. Wrote {args.out or args.city}. Run access again.")


# -------------------------------------------------------------- heights ---

def block_facts(city):
    """What the height planner gets to see about each block."""
    known = {}
    for p in city["plots"]:
        if p["height"] is not None:
            known.setdefault(p["block"], []).append(p["height"])
    facts = []
    for b in city["blocks"]:
        poly = Polygon(b["polygon"])
        c = poly.centroid
        n = sum(1 for p in city["plots"] if p["block"] == b["id"])
        facts.append({
            "block": b["id"],
            "area_m2": round(poly.area),
            "centre_m": [round(c.x), round(c.y)],
            "dist_from_centre_m": round(math.hypot(c.x, c.y)),
            "roads": b["roads"],
            "plots": n,
            "known_heights_m": known.get(b["id"], []),
        })
    return facts


def heuristic_zone(f, rng, extent):
    """Taller towards the middle and along big roads; lower and patchier at
    the edges. Returns (min_m, max_m, character)."""
    t = min(f["dist_from_centre_m"] / max(extent, 1), 1.0)
    base = 12 + (1 - t) ** 1.6 * 80
    if any(c in ("primary", "secondary", "trunk") for c in f["roads"]):
        base += 12
    if f["known_heights_m"]:
        base = 0.5 * base + 0.5 * (sum(f["known_heights_m"]) / len(f["known_heights_m"])) * 1.4
    lo = max(6, base * (0.45 + rng.random() * 0.2))
    hi = base * (1.1 + rng.random() * 0.5)
    if hi > 55:
        char = "stepped Art Deco towers with setbacks and crowns, 1920s downtown"
    elif hi > 28:
        char = "Art Deco office and hotel blocks, strong vertical piers"
    else:
        char = "low brick and stone commercial fronts, 1920s, signs and awnings"
    return round(lo, 1), round(hi, 1), char


def llm_zones(facts, url, model, brief, timeout):
    """Ask an OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, ...) to
    mark each block's height range and character. Returns {block: zone}."""
    system = (
        "You are the planner for a city in a noir video game: a 1920s Art Deco metropolis "
        "stuck at the last minute of 1999, always night, always raining. You are given city "
        "blocks from a real map. For each block choose a believable height range in metres "
        "for its buildings and a one-line architectural character that an Art Deco building "
        "generator can use. Respect known heights. Make a skyline: a dense tall core, "
        "lower edges, a few surprises. Reply with JSON only, no prose: "
        '[{"block": "k001", "min": 12, "max": 40, "character": "..."}, ...]'
    )
    zones = {}
    for i in range(0, len(facts), 40):
        chunk = facts[i:i + 40]
        user = (f"Area brief: {brief}\n\n" if brief else "") + "Blocks:\n" + json.dumps(chunk)
        body = json.dumps({
            "model": model,
            "temperature": 0.4,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }).encode()
        req = urllib.request.Request(url.rstrip("/") + "/chat/completions", data=body,
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer local"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            reply = json.loads(r.read())["choices"][0]["message"]["content"]
        m = re.search(r"\[.*\]", reply, re.S)
        if not m:
            print(f"  LLM reply had no JSON list for blocks {i + 1}-{i + len(chunk)}; using the heuristic there.")
            continue
        for z in json.loads(m.group(0)):
            try:
                zones[z["block"]] = (float(z["min"]), float(z["max"]), str(z.get("character", "")))
            except (KeyError, TypeError, ValueError):
                pass
    return zones


def cmd_heights(args):
    city = load(args.city)
    rng = random.Random(args.seed)
    facts = block_facts(city)
    b = city["bounds"]
    extent = 0.5 * math.hypot(b["maxX"] - b["minX"], b["maxZ"] - b["minZ"])

    zones = {}
    if not args.heuristic:
        try:
            print(f"Asking {args.model} at {args.llm} to mark {len(facts)} blocks ...")
            zones = llm_zones(facts, args.llm, args.model, args.brief, args.timeout)
            print(f"  {len(zones)} blocks marked by the LLM")
        except Exception as ex:  # no server, wrong model, bad reply
            print(f"  LLM unavailable ({ex}); using the heuristic for every block.")

    by_block = {}
    for f in facts:
        zone = zones.get(f["block"]) or heuristic_zone(f, rng, extent)
        lo, hi, char = zone
        lo, hi = min(lo, hi), max(lo, hi)
        by_block[f["block"]] = (lo, hi)
        for blk in city["blocks"]:
            if blk["id"] == f["block"]:
                blk["character"] = char
                blk["height_range"] = [round(lo, 1), round(hi, 1)]

    filled = empty = 0
    for p in city["plots"]:
        lo, hi = by_block.get(p["block"], (8, 20))
        if p["height"] is None or args.overwrite and p["source"] != "osm":
            # Now and then a plot stays empty: parking, rubble, unwritten.
            if p["source"] == "generated" and rng.random() < args.empty:
                p["height"] = 0
                empty += 1
            else:
                p["height"] = round(lo + (hi - lo) * rng.random() ** 1.4, 1)
                filled += 1
        if not p["prompt"]:
            p["prompt"] = next((b["character"] for b in city["blocks"] if b["id"] == p["block"]), "")
    save(city, args.out or args.city)
    print(f"Heights: {filled} filled, {empty} left empty. Wrote {args.out or args.city}")


# ---------------------------------------------------------------- util ---

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(city, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(city, f, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="download an area from OpenStreetMap")
    f.add_argument("--bbox", required=True, help="south,west,north,east in degrees")
    f.add_argument("--out", required=True)
    f.add_argument("--server", default=OVERPASS)
    f.set_defaults(fn=cmd_fetch)

    b = sub.add_parser("build", help="roads, blocks and plots from an .osm file")
    b.add_argument("osm")
    b.add_argument("--out", required=True)
    b.add_argument("--name")
    b.add_argument("--bbox", help="override the area: south,west,north,east")
    b.add_argument("--seed", type=int, default=1999)
    b.set_defaults(fn=cmd_build)

    h = sub.add_parser("heights", help="fill in unknown heights (LLM or heuristic)")
    h.add_argument("city")
    h.add_argument("--out")
    h.add_argument("--llm", default="http://localhost:11434/v1", help="OpenAI-compatible base URL")
    h.add_argument("--model", default="qwen2.5")
    h.add_argument("--brief", default="", help="a few words about the area, for the LLM")
    h.add_argument("--heuristic", action="store_true", help="don't ask an LLM")
    h.add_argument("--overwrite", action="store_true", help="also replace heights set earlier (not map heights)")
    h.add_argument("--empty", type=float, default=0.08, help="share of generated plots left empty")
    h.add_argument("--timeout", type=float, default=120)
    h.add_argument("--seed", type=int, default=1999)
    h.set_defaults(fn=cmd_heights)

    a = sub.add_parser("access", help="doors for every building, alleys where needed")
    a.add_argument("city")
    a.add_argument("--out")
    a.add_argument("--seed", type=int, default=1999)
    a.set_defaults(fn=cmd_access)

    k = sub.add_parser("parks", help="clear a few street-facing plots to grass")
    k.add_argument("city")
    k.add_argument("--out")
    k.add_argument("--count", type=int, default=12)
    k.add_argument("--spacing", type=float, default=45, help="metres between parks")
    k.add_argument("--seed", type=int, default=1999)
    k.set_defaults(fn=cmd_parks)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
