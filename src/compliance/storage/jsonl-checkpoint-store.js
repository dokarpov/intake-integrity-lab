import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class JsonlCheckpointStore {
  constructor(path) {
    if (!path) throw new Error('checkpoint_path_required');
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) appendFileSync(path, '', { encoding: 'utf8', mode: 0o600 });
  }
  append(checkpoint) {
    appendFileSync(this.path, `${JSON.stringify(checkpoint)}\n`, { encoding: 'utf8', mode: 0o600, flush: true });
  }
  all() {
    const text = readFileSync(this.path, 'utf8');
    if (!text.trim()) return [];
    return text.trimEnd().split('\n').map((line, i) => {
      try { return JSON.parse(line); }
      catch { throw new Error(`checkpoint_jsonl_corrupt_line:${i + 1}`); }
    });
  }
}
