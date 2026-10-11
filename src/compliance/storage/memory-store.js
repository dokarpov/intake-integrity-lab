export class MemoryLedgerStore {
  constructor(events = []) {
    this.events = events.map(e => structuredClone(e));
  }

  append(event) {
    this.events.push(structuredClone(event));
  }

  all() {
    return this.events.map(e => structuredClone(e));
  }
}
