// The asset registry: the city's override layer, seen from the client.
//
// Every object the world builds — a building, a room, a car, a road, an item —
// has a stable id and a procedural *base*. On top of that sits an optional
// *override*: a bundle a player's own model forged and sent back, carrying a
// new facade, interior, behaviour or tweaked params. The world asks the
// registry for an object's override at build time; if there is one, it's used,
// otherwise the base stands. Nothing else needs to know the difference.
//
// The index is loaded once at startup from the server. Offline (no server, or
// a plain static host) it's simply empty and the city is all base.

export class AssetRegistry {
  constructor(index = {}) {
    this.index = index; // id -> { type, prompt, facade?, interior?, behavior?, params, meta, ver }
  }

  static async load(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return new AssetRegistry({});
      return new AssetRegistry(await res.json());
    } catch {
      return new AssetRegistry({});
    }
  }

  // The override for an object, or null. Pass the object's stable id (a plot
  // id like "bld-7", a car id, an item id).
  get(id) {
    return this.index[id] ?? null;
  }

  has(id) {
    return !!this.index[id];
  }

  // Every override of a kind, as [id, record] — e.g. all building overrides, so
  // the world can pull those plots out of the merged block mesh.
  ofType(type) {
    return Object.entries(this.index).filter(([, r]) => r.type === type);
  }

  // Send a forged bundle (a zip Blob/ArrayBuffer) back to the server. Returns
  // the server's verdict { ok, id, ver } or { error }.
  static async submit(url, bundle) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: bundle });
      return await res.json();
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  }
}
