"""PAK City: edit a Press Any Key to Continue city in Blender.

Imports a city.json made by tools/citygen as editable objects, and exports
it back for the engine to populate with buildings.

  Roads   one object per road, a chain of vertices along its centre line
  Blocks  one flat object per block (sidewalk included)
  Plots   one object per plot, its footprint extruded to its height

What you can do:
  - move, reshape, delete or duplicate plots, blocks and roads
  - change a plot's height: scale it in Z, move its top, or use Set Height
  - edit a plot's prompt or seed in Object Properties > Custom Properties
  - turn any flat or extruded mesh into a new plot with Make Plot

After reshaping plots or blocks, run `citygen.py access city.json` to
re-check that every building can be walked to and to place doors again.

What the engine does with it: every plot with a height gets an Art Deco
building grown from its footprint, height, seed and prompt. Blocks decide
where the car can drive (everything outside a block is road). Roads give
road markings and streetlamp positions.

Install: Edit > Preferences > Add-ons > Install from Disk, pick this file.
The panel is in the 3D view's sidebar (N), tab "PAK City".

Map coordinates are metres, X east and Z south; Blender's Y is north,
so map (x, z) is Blender (x, -z).
"""

bl_info = {
    "name": "PAK City",
    "author": "Press Any Key to Continue",
    "version": (0, 1, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > PAK City",
    "description": "Import, edit and export Press Any Key to Continue city maps",
    "category": "Import-Export",
}

import json
import math
import random

import bmesh
import bpy
from bpy.props import FloatProperty, StringProperty
from bpy_extras.io_utils import ExportHelper, ImportHelper

ROOT = "PAK City"
GROUND = 0.15
PROP_KEYS = ("pak_prompt", "pak_seed", "pak_source", "pak_osm", "pak_name", "pak_style", "pak_block")


def to_blender(x, z):
    return (x, -z)


def to_map(x, y):
    return [round(x, 2), round(-y, 2)]


def collection(name, parent):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        parent.children.link(c)
    return c


def material(name, rgba):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.diffuse_color = rgba
    return m


def signed_area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


def prism_mesh(name, footprint, z0, z1):
    """A footprint (map coordinates) extruded from z0 to z1; flat if z1 <= z0."""
    pts = [to_blender(x, z) for x, z in footprint]
    if signed_area(pts) < 0:
        pts.reverse()
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z0)) for x, y in pts]
    face = bm.faces.new(verts)
    if z1 > z0 + 0.01:
        ext = bmesh.ops.extrude_face_region(bm, geom=[face])
        moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=moved, vec=(0, 0, z1 - z0))
        # The original face is now the bottom; point it down.
        bmesh.ops.reverse_faces(bm, faces=[face])
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def polyline_mesh(name, points):
    me = bpy.data.meshes.new(name)
    verts = [(*to_blender(x, z), GROUND + 0.02) for x, z in points]
    edges = [(i, i + 1) for i in range(len(verts) - 1)]
    me.from_pydata(verts, edges, [])
    return me


def world_verts(obj):
    """Vertices of the evaluated mesh (modifiers applied) in world space."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    mw = obj.matrix_world
    out = [mw @ v.co for v in me.vertices]
    faces = [(list(p.vertices), (mw.to_3x3() @ p.normal).normalized()) for p in me.polygons]
    edges = [tuple(e.vertices) for e in me.edges]
    ev.to_mesh_clear()
    return out, faces, edges


def footprint_of(obj):
    """Footprint (map coordinates) and height of a plot or block object."""
    verts, faces, _ = world_verts(obj)
    if not verts:
        return None, 0
    zmin = min(v.z for v in verts)
    zmax = max(v.z for v in verts)
    # The bottom face: the lowest face, preferring one that points down.
    best = None
    for idx, n in faces:
        z = sum(verts[i].z for i in idx) / len(idx)
        key = (round(z - zmin, 2), -(n.z < -0.5), -len(idx))
        if best is None or key < best[0]:
            best = (key, idx)
    if best is None:
        return None, 0
    pts = [to_map(verts[i].x, verts[i].y) for i in best[1]]
    if signed_area(pts) < 0:
        pts.reverse()
    return pts, zmax - zmin


def chain_of(obj):
    """A road object's vertices in order along its edges."""
    verts, _, edges = world_verts(obj)
    if not edges:
        return [to_map(v.x, v.y) for v in verts]
    adj = {}
    for a, b in edges:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    start = next((v for v, n in adj.items() if len(n) == 1), edges[0][0])
    order, prev, cur = [start], None, start
    while True:
        nxt = [n for n in adj[cur] if n != prev]
        if not nxt or nxt[0] in order:
            break
        prev, cur = cur, nxt[0]
        order.append(cur)
    return [to_map(verts[i].x, verts[i].y) for i in order]


def inset_polygon(pts, amount):
    """Lot inside a block: the block polygon inset by the sidewalk width."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((x, y, 0)) for x, y in (to_blender(*p) for p in pts)])
    bmesh.ops.inset_region(bm, faces=[face], thickness=amount, use_even_offset=True)
    lot = [to_map(v.co.x, v.co.y) for v in face.verts]
    bm.free()
    if len(lot) < 3 or abs(signed_area(lot)) < 20:
        return []
    if signed_area(lot) < 0:
        lot.reverse()
    return [lot]


# ------------------------------------------------------------------ import ---

def build_plot(plot, coll, mats):
    h = plot.get("height") or 0
    me = prism_mesh(plot["id"], plot["footprint"], GROUND + 0.01, GROUND + 0.01 + h)
    obj = bpy.data.objects.new(plot["id"], me)
    coll.objects.link(obj)
    obj["pak_kind"] = "plot"
    obj["pak_id"] = plot["id"]
    obj["pak_block"] = plot.get("block") or ""
    obj["pak_prompt"] = plot.get("prompt") or ""
    obj["pak_seed"] = int(plot.get("seed") or random.randrange(1, 2**31))
    obj["pak_source"] = plot.get("source") or "generated"
    obj["pak_osm"] = plot.get("osm") or ""
    obj["pak_name"] = plot.get("name") or ""
    obj["pak_style"] = json.dumps(plot["style"]) if plot.get("style") else ""
    obj["pak_doors"] = json.dumps(plot.get("doors") or [])
    obj["pak_footprint"] = json.dumps(plot["footprint"])  # to spot reshaped plots on export
    me.materials.append(mats["osm"] if plot.get("source") == "osm" else mats["plot"] if h else mats["empty"])
    return obj


def import_city(path):
    with open(path, encoding="utf-8") as f:
        city = json.load(f)
    scene_coll = bpy.context.scene.collection
    old = bpy.data.collections.get(ROOT)
    if old:
        for o in list(old.all_objects):
            bpy.data.objects.remove(o, do_unlink=True)
        for c in list(old.children_recursive):
            bpy.data.collections.remove(c)
        bpy.data.collections.remove(old)
    root = bpy.data.collections.new(ROOT)
    scene_coll.children.link(root)
    meta = {k: v for k, v in city.items() if k not in ("roads", "blocks", "plots")}
    root["pak_meta"] = json.dumps(meta)
    # New plots always get a fresh id, never one a deleted plot used: the
    # engine treats an id as the same building.
    nums = [int(p["id"][1:]) for p in city["plots"] if p["id"][1:].isdigit()]
    root["pak_next_id"] = max(nums, default=0) + 1
    mats = {
        "road": material("PAK road", (0.9, 0.9, 0.9, 1)),
        "block": material("PAK block", (0.16, 0.17, 0.18, 1)),
        "plot": material("PAK plot", (0.45, 0.55, 0.6, 1)),
        "osm": material("PAK plot (from map)", (0.75, 0.25, 0.22, 1)),
        "empty": material("PAK empty plot", (0.08, 0.08, 0.08, 1)),
    }

    roads = collection("Roads", root)
    for r in city["roads"]:
        obj = bpy.data.objects.new(r["id"], polyline_mesh(r["id"], r["points"]))
        roads.objects.link(obj)
        obj["pak_kind"] = "road"
        obj["pak_id"] = r["id"]
        obj["pak_class"] = r["class"]
        obj["pak_width"] = float(r["width"])
        obj["pak_name"] = r.get("name") or ""

    blocks = collection("Blocks", root)
    for b in city["blocks"]:
        me = prism_mesh(b["id"], b["polygon"], 0, GROUND)
        me.materials.append(mats["block"])
        obj = bpy.data.objects.new(b["id"], me)
        blocks.objects.link(obj)
        obj["pak_kind"] = "block"
        obj["pak_id"] = b["id"]
        obj["pak_character"] = b.get("character") or ""
        obj["pak_roads"] = json.dumps(b.get("roads") or [])
        obj["pak_height_range"] = json.dumps(b.get("height_range") or [])
        obj["pak_lots"] = json.dumps(b.get("lots") or [])
        obj["pak_polygon"] = json.dumps(b["polygon"])  # to spot reshaped blocks on export

    plots = collection("Plots", root)
    for p in city["plots"]:
        build_plot(p, plots, mats)
    return city


# ------------------------------------------------------------------ export ---

def export_city(path):
    root = bpy.data.collections.get(ROOT)
    if root is None:
        raise RuntimeError("No PAK City in this file. Import a city first.")
    city = json.loads(root.get("pak_meta", "{}"))
    city.setdefault("version", 1)
    sidewalk = float(city.get("sidewalk", 3.0))

    roads, blocks, plots = [], [], []
    seen = set()
    needs_access = 0
    objs = sorted(root.all_objects, key=lambda o: o.name)
    for obj in objs:
        kind = obj.get("pak_kind")
        if obj.type != "MESH" or not kind:
            continue
        if kind == "road":
            pts = chain_of(obj)
            if len(pts) >= 2:
                roads.append({"id": obj["pak_id"], "class": obj.get("pak_class", "residential"),
                              "width": float(obj.get("pak_width", 9)), "name": obj.get("pak_name") or None, "points": pts})
        elif kind == "block":
            poly, _ = footprint_of(obj)
            if not poly or len(poly) < 3:
                continue
            lots = json.loads(obj.get("pak_lots", "[]"))
            if json.dumps(poly) != obj.get("pak_polygon"):
                lots = inset_polygon(poly, sidewalk)  # reshaped: work the lot out again
            blocks.append({"id": obj["pak_id"], "polygon": poly, "lots": lots,
                           "roads": json.loads(obj.get("pak_roads", "[]")), "character": obj.get("pak_character", ""),
                           "height_range": json.loads(obj.get("pak_height_range", "[]"))})
        elif kind == "plot":
            poly, h = footprint_of(obj)
            if not poly or len(poly) < 3:
                continue
            pid = obj.get("pak_id") or ""
            if not pid or pid in seen:  # duplicated or new: give it its own id
                n = int(root.get("pak_next_id", 1))
                root["pak_next_id"] = n + 1
                pid = f"p{n:04d}"
                obj["pak_id"] = pid
                obj["pak_seed"] = random.randrange(1, 2**31)
            seen.add(pid)
            style = obj.get("pak_style") or ""
            # Doors stay valid while the footprint does; a reshaped or new
            # plot needs `citygen.py access` to place them again.
            doors = json.loads(obj.get("pak_doors", "[]")) if json.dumps(poly) == obj.get("pak_footprint") else []
            if not doors:
                needs_access += 1
            plots.append({
                "id": pid, "block": obj.get("pak_block") or "", "footprint": poly,
                "height": round(h, 1) if h > 0.3 else 0,
                "source": obj.get("pak_source", "generated"), "osm": obj.get("pak_osm") or None,
                "name": obj.get("pak_name") or None, "prompt": obj.get("pak_prompt", ""),
                "seed": int(obj.get("pak_seed", 1)), "doors": doors,
                **({"style": json.loads(style)} if style else {}),
            })

    # A plot that moved to another block follows it.
    for p in plots:
        cx = sum(x for x, _ in p["footprint"]) / len(p["footprint"])
        cz = sum(z for _, z in p["footprint"]) / len(p["footprint"])
        for b in blocks:
            if point_in(cx, cz, b["polygon"]):
                p["block"] = b["id"]
                break

    city["roads"], city["blocks"], city["plots"] = roads, blocks, plots
    city["needs_access"] = needs_access
    with open(path, "w", encoding="utf-8") as f:
        json.dump(city, f, separators=(",", ":"))
    return city


def point_in(x, z, poly):
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            hit = not hit
        j = i
    return hit


# --------------------------------------------------------------- operators ---

class PAK_OT_import_city(bpy.types.Operator, ImportHelper):
    """Import a city.json made by tools/citygen"""
    bl_idname = "pak.import_city"
    bl_label = "Import City"
    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    def execute(self, context):
        city = import_city(self.filepath)
        self.report({"INFO"}, f"Imported {len(city['plots'])} plots, {len(city['blocks'])} blocks, {len(city['roads'])} roads")
        return {"FINISHED"}


class PAK_OT_export_city(bpy.types.Operator, ExportHelper):
    """Export the edited city back to city.json for the engine"""
    bl_idname = "pak.export_city"
    bl_label = "Export City"
    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    def execute(self, context):
        try:
            city = export_city(self.filepath)
        except RuntimeError as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        msg = f"Exported {len(city['plots'])} plots to {self.filepath}"
        if city.get("needs_access"):
            msg += f". {city['needs_access']} reshaped or new plots need doors: run citygen.py access"
        self.report({"INFO"}, msg)
        return {"FINISHED"}


class PAK_OT_set_height(bpy.types.Operator):
    """Rebuild the selected plots at a given height (0 leaves the plot empty)"""
    bl_idname = "pak.set_height"
    bl_label = "Set Height"
    bl_options = {"REGISTER", "UNDO"}
    height: FloatProperty(name="Height (m)", default=30.0, min=0.0, max=600.0)

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        n = 0
        for obj in context.selected_objects:
            if obj.get("pak_kind") != "plot":
                continue
            poly, _ = footprint_of(obj)
            if not poly:
                continue
            old = obj.data
            obj.data = prism_mesh(obj.name, poly, GROUND + 0.01, GROUND + 0.01 + self.height)
            obj.data.materials.append(old.materials[0] if old.materials else None)
            obj.location = (0, 0, 0)
            obj.rotation_euler = (0, 0, 0)
            obj.scale = (1, 1, 1)
            bpy.data.meshes.remove(old)
            n += 1
        self.report({"INFO"}, f"{n} plots set to {self.height:.1f} m")
        return {"FINISHED"}


class PAK_OT_make_plot(bpy.types.Operator):
    """Turn the selected meshes into plots (the footprint is their lowest face)"""
    bl_idname = "pak.make_plot"
    bl_label = "Make Plot"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        root = bpy.data.collections.get(ROOT)
        plots = root and root.children.get("Plots")
        n = 0
        for obj in context.selected_objects:
            if obj.type != "MESH" or obj.get("pak_kind") == "plot":
                continue
            obj["pak_kind"] = "plot"
            obj["pak_id"] = ""  # assigned on export
            obj["pak_prompt"] = ""
            obj["pak_seed"] = random.randrange(1, 2**31)
            obj["pak_source"] = "manual"
            if plots and obj.name not in plots.objects:
                plots.objects.link(obj)
            n += 1
        self.report({"INFO"}, f"{n} new plots")
        return {"FINISHED"}


class PAK_PT_panel(bpy.types.Panel):
    bl_label = "PAK City"
    bl_idname = "PAK_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "PAK City"

    def draw(self, context):
        col = self.layout.column(align=True)
        col.operator("pak.import_city", icon="IMPORT")
        col.operator("pak.export_city", icon="EXPORT")
        col.separator()
        col.operator("pak.set_height", icon="SORT_ASC")
        col.operator("pak.make_plot", icon="ADD")
        obj = context.active_object
        if obj and obj.get("pak_kind") == "plot":
            box = self.layout.box()
            box.label(text=f"Plot {obj.get('pak_id', '')} · {obj.get('pak_source', '')}")
            box.prop(obj, '["pak_prompt"]', text="Prompt")
            box.prop(obj, '["pak_seed"]', text="Seed")
        elif obj and obj.get("pak_kind") == "block":
            box = self.layout.box()
            box.label(text=f"Block {obj.get('pak_id', '')}")
            box.prop(obj, '["pak_character"]', text="Character")


CLASSES = (PAK_OT_import_city, PAK_OT_export_city, PAK_OT_set_height, PAK_OT_make_plot, PAK_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)


def unregister():
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()
