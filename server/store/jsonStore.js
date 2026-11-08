// Tiny persisted document store: one JSON file per collection, debounced writes.
// Interface (get / put / update / list / remove) mirrors what the PostgreSQL
// repository will expose later (design doc 6.1: multi-tenant by temple_id).
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(dir, { flushMs = 500 } = {}) {
    this.dir = dir;
    this.flushMs = flushMs;
    this.cols = new Map();
    this.dirty = new Set();
    this.timer = null;
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }

  _col(name) {
    let c = this.cols.get(name);
    if (c) return c;
    c = new Map();
    if (this.dir) {
      const f = path.join(this.dir, `${name}.json`);
      if (fs.existsSync(f)) {
        try {
          for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')))) c.set(k, v);
        } catch (e) {
          fs.renameSync(f, `${f}.corrupt-${Date.now()}`);
          console.error(`[store] ${name}.json unreadable, moved aside:`, e.message);
        }
      }
    }
    this.cols.set(name, c);
    return c;
  }

  get(col, id) { return this._col(col).get(id) ?? null; }
  list(col, filter = () => true) { return [...this._col(col).values()].filter(filter); }
  put(col, id, doc) { this._col(col).set(id, doc); this._touch(col); return doc; }
  update(col, id, fn) {
    const cur = this.get(col, id);
    const next = fn(cur);
    if (next === undefined) return cur;
    return this.put(col, id, next);
  }
  remove(col, id) { const ok = this._col(col).delete(id); if (ok) this._touch(col); return ok; }

  _touch(col) {
    if (!this.dir) return;
    this.dirty.add(col);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.dir) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      for (const col of [...this.dirty]) {
        const f = path.join(this.dir, `${col}.json`);
        const tmp = `${f}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this._col(col))));
        fs.renameSync(tmp, f);
        this.dirty.delete(col);
      }
    } catch (e) {
      // keep serving from memory; retry later instead of taking the temple offline
      console.error('[store] flush failed, will retry:', e.message);
      this.timer = setTimeout(() => this.flush(), 5000);
    }
  }
}
