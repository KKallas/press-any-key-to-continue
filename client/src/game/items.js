// What a skin carries. Kit is what turns a place into an option: a modem
// makes a phone booth a way online; a laptop is what you carry it on. New
// gear unlocks new actions at the places that want it — the inventory is the
// key ring for the city.
//
// Each item: id, name, a one-line note, and a tiny canvas glyph so the KIT
// monitor reads at a glance on a small tube.

export const ITEMS = {
  laptop: {
    id: 'laptop',
    name: 'LUGGABLE PC',
    note: 'a portable you can jack in anywhere there is a line',
    glyph: 'laptop',
  },
  modem: {
    id: 'modem',
    name: 'US ROBOTICS 56.6K',
    note: 'a modem; couples to a phone booth or a café line',
    glyph: 'modem',
  },
  lockpicks: {
    id: 'lockpicks',
    name: 'PICK SET',
    note: 'for a door with a lock and no one behind it',
    glyph: 'pick',
  },
  ruler: {
    id: 'ruler',
    name: 'SLIM JIM',
    note: 'a long steel ruler; down the window to catch a car door',
    glyph: 'ruler',
  },
};

export class Inventory {
  constructor(ids = []) {
    this.ids = new Set(ids);
  }
  has(id) {
    return this.ids.has(id);
  }
  add(id) {
    if (!ITEMS[id]) return false;
    const had = this.ids.has(id);
    this.ids.add(id);
    return !had;
  }
  remove(id) {
    return this.ids.delete(id);
  }
  list() {
    return [...this.ids].map((id) => ITEMS[id]).filter(Boolean);
  }
}
