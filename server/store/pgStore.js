// PostgreSQL-backed document store with the same synchronous interface as JsonStore
// (get / put / update / list / remove), so the domain services do not change (docs/ARCHITECTURE.md).
//
//   memory      every instance holds the working set; reads never wait
//   PostgreSQL  the durable copy: changed documents are upserted in batches every `flushMs`
//   Redis       instances publish their changes; the others apply them within milliseconds
//   catch-up    every `pollMs` each instance re-reads rows changed recently, in case a publish was missed
//
// Conflicts are last-writer-wins per document, ordered by (version, writer id), both in memory and
// in the upsert's WHERE clause. A remote change is applied IN PLACE (same object identity), because
// rooms and sessions hold references to user documents. Run instances behind sticky load balancing
// (docs/CLUSTER.md) so one person's requests land on one instance and such conflicts stay theoretical.
//
// Collections listed in `ephemeral` (e.g. WebAuthn challenges) are replicated but never written to PostgreSQL.
import { metrics } from '../metrics.js';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (
  col text NOT NULL,
  id text NOT NULL,
  doc jsonb,
  v bigint NOT NULL DEFAULT 1,
  writer text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (col, id)
);
CREATE INDEX IF NOT EXISTS docs_updated_at ON docs (updated_at);
`;
const UPSERT = `
INSERT INTO docs (col, id, doc, v, writer, updated_at)
SELECT x->>'c', x->>'k', x->'d', (x->>'v')::bigint, x->>'w', now() FROM jsonb_array_elements($1::jsonb) x
ON CONFLICT (col, id) DO UPDATE SET doc = EXCLUDED.doc, v = EXCLUDED.v, writer = EXCLUDED.writer, updated_at = now()
WHERE (docs.v, docs.writer) <= (EXCLUDED.v, EXCLUDED.writer)`;

const newer = (a, b) => !b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
/** Make `target` equal to `src` without changing its identity. */
function assignInPlace(target, src) {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  return Object.assign(target, src);
}

export class PgStore {
  /**
   * @param pg        PgClient
   * @param redis     RedisClient for PUBLISH (optional: without Redis this is a single-instance store)
   * @param sub       RedisClient dedicated to SUBSCRIBE
   * @param instance  unique id of this server process
   * @param channel   Redis channel shared by every instance of one deployment
   */
  constructor({ pg, redis = null, sub = null, instance, channel = 'simiao:docs', flushMs = 200, pollMs = 10_000, ephemeral = ['challenges'] }) {
    Object.assign(this, { pg, redis, sub, instance, channel, flushMs, pollMs });
    this.ephemeral = new Set(ephemeral);
    this.cols = new Map();      // col → Map(id → doc)
    this.vers = new Map();      // `${col}\0${id}` → [version, writer]
    this.dirty = new Set();     // keys changed locally since the last flush
    this.listeners = [];
    this.timer = null; this.flushing = null; this.pollTimer = null; this.closed = false;
  }

  // ---------------------------------------------------------------- boot

  async ready() {
    await this.pg.exec(SCHEMA);
    const early = [];
    let live = false;
    if (this.sub) {
      await this.sub.subscribe(this.channel, (raw) => {
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (m.i === this.instance) return;
        if (live) for (const ch of m.ch) this._apply(ch); else early.push(...m.ch);
      });
    }
    // load in pages by primary key, so a big table never has to fit in one reply
    let last = ['', ''], n = 0;
    for (;;) {
      const { rows } = await this.pg.query(
        'SELECT col, id, doc::text AS doc, v::text AS v, writer FROM docs WHERE (col, id) > ($1, $2) ORDER BY col, id LIMIT 5000', last);
      for (const r of rows) this._apply({ c: r.col, k: r.id, d: JSON.parse(r.doc), v: Number(r.v), w: r.writer }, true);
      n += rows.length;
      if (rows.length < 5000) break;
      last = [rows[rows.length - 1].col, rows[rows.length - 1].id];
    }
    for (const ch of early) this._apply(ch);
    live = true;
    if (this.pollMs) { this.pollTimer = setInterval(() => this.catchUp().catch(() => {}), this.pollMs); this.pollTimer.unref?.(); }
    return n;
  }

  /** Re-read what changed lately (3 poll periods), in case a Redis message never arrived. */
  async catchUp() {
    const { rows } = await this.pg.query(
      "SELECT col, id, doc::text AS doc, v::text AS v, writer FROM docs WHERE updated_at > now() - ($1::int * interval '1 millisecond') AND writer <> $2",
      [this.pollMs * 3, this.instance]);
    let applied = 0;
    for (const r of rows) if (this._apply({ c: r.col, k: r.id, d: JSON.parse(r.doc), v: Number(r.v), w: r.writer })) applied++;
    return applied;
  }

  /**
   * Create a document only if no instance has yet (e.g. the VAPID key pair): the first INSERT wins
   * and everyone ends up holding the same value.
   */
  async ensure(col, id, factory) {
    const existing = this.get(col, id);
    if (existing) return existing;
    await this.pg.query(
      'INSERT INTO docs (col, id, doc, v, writer) VALUES ($1, $2, $3::jsonb, 1, $4) ON CONFLICT (col, id) DO NOTHING',
      [col, id, JSON.stringify(factory()), this.instance]);
    const { rows } = await this.pg.query('SELECT doc::text AS doc, v::text AS v, writer FROM docs WHERE col = $1 AND id = $2', [col, id]);
    this._apply({ c: col, k: id, d: JSON.parse(rows[0].doc), v: Number(rows[0].v), w: rows[0].writer }, true);
    return this.get(col, id);
  }

  // ---------------------------------------------------------------- the synchronous interface

  _col(name) {
    let c = this.cols.get(name);
    if (!c) this.cols.set(name, (c = new Map()));
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
    const key = `${col}\0${id}`;
    const cur = this.vers.get(key);
    this.vers.set(key, [(cur ? cur[0] : 0) + 1, this.instance]);
    this.dirty.add(key);
    if (!this.timer && !this.closed) this.timer = setTimeout(() => { this.timer = null; this.flush().catch(() => {}); }, this.flushMs);
  }

  /** Called with (col, id, doc | null) after a change from another instance has been applied. */
  onRemote(fn) { this.listeners.push(fn); }

  // ---------------------------------------------------------------- replication

  /** Apply a change from PostgreSQL or another instance. Returns true if it was newer than what we hold. */
  _apply({ c, k, d, v, w }, quiet = false) {
    const key = `${c}\0${k}`;
    if (!newer([v, w], this.vers.get(key))) return false;
    if (this.dirty.has(key)) this.dirty.delete(key); // the remote version supersedes our unsent one
    this.vers.set(key, [v, w]);
    const col = this._col(c);
    if (d === null) col.delete(k);
    else {
      const cur = col.get(k);
      if (cur && typeof cur === 'object' && typeof d === 'object') assignInPlace(cur, d); else col.set(k, d);
    }
    if (!quiet) for (const fn of this.listeners) { try { fn(c, k, d === null ? null : col.get(k)); } catch (e) { console.error('[store] onRemote listener failed:', e.message); } }
    return true;
  }

  /** Publish local changes to the other instances and write them to PostgreSQL. */
  flush() {
    if (this.flushing) return this.flushing.then(() => (this.dirty.size ? this.flush() : undefined));
    if (!this.dirty.size) return Promise.resolve();
    const keys = [...this.dirty];
    this.dirty.clear();
    const changes = keys.map((key) => {
      const i = key.indexOf('\0'), c = key.slice(0, i), k = key.slice(i + 1), [v, w] = this.vers.get(key);
      return { c, k, d: this._col(c).get(k) ?? null, v, w };
    });
    this.flushing = this._send(changes).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async _send(changes) {
    const t0 = performance.now();
    let bytes = 0;
    // 1. tell the other instances (fast path)
    if (this.redis) {
      for (let i = 0; i < changes.length; i += 200) {
        const payload = JSON.stringify({ i: this.instance, ch: changes.slice(i, i + 200) });
        try { await this.redis.command('PUBLISH', this.channel, payload); } catch { /* the catch-up poll covers a lost publish */ }
      }
    }
    // 2. make them durable
    const durable = changes.filter((ch) => !this.ephemeral.has(ch.c));
    for (let i = 0; i < durable.length; i += 500) {
      const batch = durable.slice(i, i + 500);
      // jsonb cannot hold \u0000; drop it rather than poison the batch
      const json = JSON.stringify(batch).replace(/\\u0000/g, '');
      bytes += json.length;
      try { await this.pg.query(UPSERT, [json]); } catch (e) {
        console.error(`[store] PostgreSQL write failed (${batch.length} docs), will retry:`, e.message);
        // put them back unless something newer is already queued
        for (const ch of batch) { const key = `${ch.c}\0${ch.k}`; const cur = this.vers.get(key); if (cur && cur[0] === ch.v && cur[1] === ch.w) this.dirty.add(key); }
        if (!this.timer && !this.closed) this.timer = setTimeout(() => { this.timer = null; this.flush().catch(() => {}); }, 2000);
        break;
      }
    }
    metrics.flush(performance.now() - t0, bytes);
  }

  async close() {
    this.closed = true;
    clearTimeout(this.timer); clearInterval(this.pollTimer);
    try { await this.flush(); if (this.dirty.size) await this.flush(); } catch (e) { console.error('[store] final flush failed:', e.message); }
    await Promise.allSettled([this.pg.close(), this.redis?.close(), this.sub?.close()]);
  }
}
