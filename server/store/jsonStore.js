// Tiny persisted document store. Interface (get / put / update / list / remove) mirrors what the
// PostgreSQL repository will expose later (design doc 6.1: multi-tenant by temple_id).
//
// On disk, per collection: <col>.json (snapshot) + <col>.log (append-only, one JSON line per
// changed document: [id, doc] or [id, null] for a removal). A flush appends only the documents
// that changed since the last one, so its cost follows activity, not the number of users;
// the log is folded into the snapshot when it grows past the snapshot's size (docs/LOADTEST.md).
// A torn last line after a crash is skipped on load.
import fs from 'node:fs';
import path from 'node:path';
import { metrics } from '../metrics.js';

const COMPACT_MIN = 4 * 1024 * 1024; // don't bother compacting small logs

export class JsonStore {
  constructor(dir, { flushMs = 500 } = {}) {
    this.dir = dir;
    this.flushMs = flushMs;
    this.cols = new Map();
    this.dirty = new Map();   // col → Set(ids changed since the last flush)
    this.sizes = new Map();   // col → { snap, log } bytes on disk
    this.timer = null;
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }

  _file(col, ext) { return path.join(this.dir, `${col}.${ext}`); }

  _col(name) {
    let c = this.cols.get(name);
    if (c) return c;
    c = new Map();
    const size = { snap: 0, log: 0 };
    if (this.dir) {
      const f = this._file(name, 'json');
      if (fs.existsSync(f)) {
        try {
          const text = fs.readFileSync(f, 'utf8');
          size.snap = text.length;
          for (const [k, v] of Object.entries(JSON.parse(text))) c.set(k, v);
        } catch (e) {
          fs.renameSync(f, `${f}.corrupt-${Date.now()}`);
          console.error(`[store] ${name}.json unreadable, moved aside:`, e.message);
        }
      }
      const lf = this._file(name, 'log');
      if (fs.existsSync(lf)) {
        const text = fs.readFileSync(lf, 'utf8');
        size.log = text.length;
        for (const line of text.split('\n')) {
          if (!line) continue;
          let rec;
          try { rec = JSON.parse(line); } catch { continue; } // torn write at a crash
          if (rec[1] === null) c.delete(rec[0]); else c.set(rec[0], rec[1]);
        }
      }
    }
    this.cols.set(name, c);
    this.sizes.set(name, size);
    return c;
  }

  get(col, id) { return this._col(col).get(id) ?? null; }
  list(col, filter = () => true) { return [...this._col(col).values()].filter(filter); }
  put(col, id, doc) { this._col(col).set(id, doc); this._touch(col, id); return doc; }
  update(col, id, fn) {
    const cur = this.get(col, id);
    const next = fn(cur);
    if (next === undefined) return cur;
    return this.put(col, id, next);
  }
  remove(col, id) { const ok = this._col(col).delete(id); if (ok) this._touch(col, id); return ok; }

  _touch(col, id) {
    if (!this.dir) return;
    let ids = this.dirty.get(col);
    if (!ids) this.dirty.set(col, (ids = new Set()));
    ids.add(id);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  /** Append changed documents; fold the log into the snapshot when it has grown big. */
  flush({ compact = false } = {}) {
    clearTimeout(this.timer); this.timer = null;
    if (!this.dir) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      for (const [col, ids] of [...this.dirty]) {
        const t0 = performance.now();
        const c = this._col(col), size = this.sizes.get(col);
        let lines = '';
        for (const id of ids) lines += `${JSON.stringify([id, c.get(id) ?? null])}\n`;
        fs.appendFileSync(this._file(col, 'log'), lines);
        size.log += lines.length;
        this.dirty.delete(col);
        let written = lines.length;
        if (compact || (size.log > COMPACT_MIN && size.log > size.snap)) written += this._compact(col);
        metrics.flush(performance.now() - t0, written);
      }
      if (compact) for (const col of this.cols.keys()) if (this.sizes.get(col)?.log) this._compact(col);
    } catch (e) {
      // keep serving from memory; retry later instead of taking the temple offline
      console.error('[store] flush failed, will retry:', e.message);
      this.timer = setTimeout(() => this.flush(), 5000);
    }
  }

  /** Snapshot = current map; then the log starts empty. Snapshot is written before the log is cleared. */
  _compact(col) {
    const f = this._file(col, 'json'), tmp = `${f}.tmp`;
    const data = JSON.stringify(Object.fromEntries(this._col(col)));
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, f);
    fs.writeFileSync(this._file(col, 'log'), '');
    const size = this.sizes.get(col);
    size.snap = data.length; size.log = 0;
    return data.length;
  }
}
