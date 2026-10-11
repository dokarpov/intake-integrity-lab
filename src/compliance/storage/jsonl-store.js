import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class JsonlLedgerStore {
  constructor(path) {
    if (!path) throw new Error('ledger_path_required');
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) appendFileSync(path, '', { encoding: 'utf8', mode: 0o600 });
  }

  append(event) {
    // One canonical immutable event per line. Production deployments should copy/stream
    // this to immutable/WORM storage; the local file itself is not WORM.
    appendFileSync(this.path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600, flush: true });
  }

  all() {
    const text = readFileSync(this.path, 'utf8');
    if (!text.trim()) return [];
    return text.trimEnd().split('\n').map((line, index) => {
      try { return JSON.parse(line); }
      catch { throw new Error(`ledger_jsonl_corrupt_line:${index + 1}`); }
    });
  }
}
