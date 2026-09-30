// Stand-in for the game server.
//
// The real server keeps the truth as an append-only event log and sends each
// client only the events its current camera can see. This stub does the same
// with a fixed log held in memory: subscribe with a filter, receive every
// matching event so far, then any new ones as they are appended.

export class LocalServer {
  constructor(log = []) {
    this.log = [];
    this.subscribers = [];
    for (const event of log) this.append(event);
  }

  append(event) {
    const stamped = { seq: this.log.length, ...event };
    this.log.push(stamped);
    for (const sub of this.subscribers) {
      if (sub.filter(stamped)) sub.handler(stamped);
    }
    return stamped;
  }

  // filter: (event) => boolean. In the real game this is the camera's
  // interest set: its block, and what falls inside its view.
  subscribe(filter, handler) {
    const sub = { filter, handler };
    this.subscribers.push(sub);
    for (const event of this.log) {
      if (filter(event)) handler(event);
    }
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== sub);
    };
  }
}
