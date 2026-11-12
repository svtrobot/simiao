// Secondary indexes for the document stores (JsonStore, PgStore): "which halls is this person in",
// "which tablets belong to this hall", "the newest 60 public wishes of this temple" — answered by a
// lookup instead of a scan over the whole collection (docs/CLUSTER.md, tools/bench-store.mjs).
//
//   store.index(col, name, keyFn, { order, limit })   declare once (idempotent), usually in a service constructor
//   store.by(col, name, key)                          → documents whose keyFn(doc) is / contains `key`
//
// keyFn(doc) returns a key, an array of keys, or null (not indexed). Indexes follow put / remove and
// changes applied from other instances; a document mutated without a put is not re-indexed — the
// same rule the stores already have for persistence.
//
// With { order, limit } the index keeps, per key, only the `limit` documents with the highest
// order(doc), already sorted (e.g. the wish wall). It holds a little more than `limit` so that a
// removal rarely forces a rebuild of that key from the collection.
export class Indexes {
  /** @param colOf  (name) → Map(id → doc), the store's own collection map */
  constructor(colOf) { this.colOf = colOf; this.defs = new Map(); }

  define(col, name, keyFn, { order = null, limit = 0 } = {}) {
    let m = this.defs.get(col);
    if (!m) this.defs.set(col, (m = new Map()));
    if (m.has(name)) return;
    const idx = { col, keyFn, order, cap: order ? Math.max(1, limit) * 2 : 0, limit, keys: new Map(), of: new Map(), cut: new Set() };
    m.set(name, idx);
    for (const [id, doc] of this.colOf(col)) this._add(idx, id, doc);
  }

  /** A document was written (doc) or removed (null). */
  changed(col, id, doc) {
    const m = this.defs.get(col);
    if (!m) return;
    for (const idx of m.values()) { this._drop(idx, id); if (doc) this._add(idx, id, doc); }
  }

  by(col, name, key) {
    const idx = this.defs.get(col)?.get(name);
    if (!idx) throw new Error(`no index ${col}.${name}`);
    const c = this.colOf(col);
    if (!idx.order) {
      const ids = idx.keys.get(key);
      return ids ? [...ids].map((id) => c.get(id)).filter(Boolean) : [];
    }
    let list = idx.keys.get(key);
    // entries fell out of a truncated list: what should move up is not in it, so look again
    if (idx.cut.has(key) && (!list || list.length < idx.limit)) list = this._rebuild(idx, key);
    return (list || []).slice(0, idx.limit).map((e) => c.get(e.id)).filter(Boolean);
  }

  _keys(idx, doc) { const k = idx.keyFn(doc); return k === null || k === undefined ? [] : Array.isArray(k) ? k : [k]; }

  _add(idx, id, doc) {
    const keys = this._keys(idx, doc);
    if (!keys.length) return;
    idx.of.set(id, keys);
    for (const k of keys) {
      if (!idx.order) {
        let s = idx.keys.get(k);
        if (!s) idx.keys.set(k, (s = new Set()));
        s.add(id);
        continue;
      }
      let list = idx.keys.get(k);
      if (!list) idx.keys.set(k, (list = []));
      const o = idx.order(doc);
      let lo = 0, hi = list.length;                       // descending by order
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].o >= o) lo = mid + 1; else hi = mid; }
      if (lo >= idx.cap) { idx.cut.add(k); continue; }    // older than everything we keep
      list.splice(lo, 0, { id, o });
      if (list.length > idx.cap) { list.pop(); idx.cut.add(k); }
    }
  }

  _drop(idx, id) {
    const keys = idx.of.get(id);
    if (!keys) return;
    idx.of.delete(id);
    for (const k of keys) {
      const held = idx.keys.get(k);
      if (!held) continue;
      if (!idx.order) { held.delete(id); if (!held.size) idx.keys.delete(k); continue; }
      const i = held.findIndex((e) => e.id === id);
      if (i >= 0) held.splice(i, 1);
    }
  }

  _rebuild(idx, key) {
    const all = [];
    for (const [id, doc] of this.colOf(idx.col)) if (this._keys(idx, doc).includes(key)) all.push({ id, o: idx.order(doc) });
    all.sort((a, b) => b.o - a.o);
    if (all.length > idx.cap) all.length = idx.cap; else idx.cut.delete(key);
    idx.keys.set(key, all);
    return all;
  }
}
