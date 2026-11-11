// 訂單帳本。金錢不能走「後寫者勝」的文檔同步（docs/CLUSTER.md），所以單獨一層：
//   PgLedger    PostgreSQL 的 orders 表，狀態轉移用條件 UPDATE（pending → paid 只會成功一次）
//   JsonLedger  單機模式，寫在文檔存儲的 orders 集合裡（單進程，沒有並發問題）
// 兩者介面相同、皆為 async。金額一律是最小貨幣單位的整數。
const ORDERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  sku text NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  provider text NOT NULL,
  provider_ref text,
  target jsonb,
  created_at bigint NOT NULL,
  paid_at bigint,
  refunded_at bigint,
  granted boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, created_at);
`;

const fromRow = (r) => r && ({
  id: r.id, userId: r.user_id, sku: r.sku, amount: Number(r.amount), currency: r.currency, status: r.status,
  provider: r.provider, providerRef: r.provider_ref, target: r.target ? JSON.parse(r.target) : null,
  createdAt: Number(r.created_at), paidAt: r.paid_at ? Number(r.paid_at) : null, refundedAt: r.refunded_at ? Number(r.refunded_at) : null,
  granted: r.granted === 't' || r.granted === 'true',
});
const COLS = 'id, user_id, sku, amount::text, currency, status, provider, provider_ref, target::text AS target, created_at::text, paid_at::text, refunded_at::text, granted::text';

export class PgLedger {
  constructor(pg) { this.pg = pg; }
  async ready() { await this.pg.exec(ORDERS_SCHEMA); return this; }

  async create(o) {
    await this.pg.query(
      'INSERT INTO orders (id, user_id, sku, amount, currency, status, provider, target, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)',
      [o.id, o.userId, o.sku, o.amount, o.currency, 'pending', o.provider, o.target ? JSON.stringify(o.target) : null, o.createdAt]);
    return this.get(o.id);
  }
  async get(id) { return fromRow((await this.pg.query(`SELECT ${COLS} FROM orders WHERE id = $1`, [id])).rows[0]); }

  /** pending → paid, exactly once. { order, changed } */
  async markPaid(id, ref, now) {
    const { rows } = await this.pg.query(`UPDATE orders SET status = 'paid', paid_at = $2, provider_ref = $3 WHERE id = $1 AND status = 'pending' RETURNING ${COLS}`, [id, now, ref || null]);
    return rows.length ? { order: fromRow(rows[0]), changed: true } : { order: await this.get(id), changed: false };
  }
  /** Only one caller gets to hand out what a paid order bought. */
  async claimGrant(id) {
    return (await this.pg.query("UPDATE orders SET granted = true WHERE id = $1 AND status = 'paid' AND granted = false RETURNING id", [id])).rows.length === 1;
  }
  async markRefunded(id, now) {
    const { rows } = await this.pg.query(`UPDATE orders SET status = 'refunded', refunded_at = $2 WHERE id = $1 AND status = 'paid' RETURNING ${COLS}`, [id, now]);
    return rows.length ? { order: fromRow(rows[0]), changed: true } : { order: await this.get(id), changed: false };
  }
  async setRef(id, ref) { await this.pg.query('UPDATE orders SET provider_ref = $2 WHERE id = $1', [id, ref]); }
  async byUser(userId, limit = 30) {
    return (await this.pg.query(`SELECT ${COLS} FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit])).rows.map(fromRow);
  }
  /** Paid (not refunded) amount since `since`, in one currency. */
  async paidSince(userId, currency, since) {
    return Number((await this.pg.query("SELECT COALESCE(SUM(amount), 0)::text AS n FROM orders WHERE user_id = $1 AND currency = $2 AND status = 'paid' AND paid_at >= $3", [userId, currency, since])).rows[0].n);
  }
}

export class JsonLedger {
  constructor(store) { this.store = store; }
  async ready() { return this; }
  async create(o) {
    const order = { ...o, status: 'pending', providerRef: null, paidAt: null, refundedAt: null, granted: false };
    this.store.put('orders', o.id, order);
    return { ...order };
  }
  async get(id) { const o = this.store.get('orders', id); return o ? { ...o } : null; }
  async markPaid(id, ref, now) {
    const o = this.store.get('orders', id);
    if (!o || o.status !== 'pending') return { order: o ? { ...o } : null, changed: false };
    Object.assign(o, { status: 'paid', paidAt: now, providerRef: ref || o.providerRef });
    this.store.put('orders', id, o);
    return { order: { ...o }, changed: true };
  }
  async claimGrant(id) {
    const o = this.store.get('orders', id);
    if (!o || o.status !== 'paid' || o.granted) return false;
    o.granted = true; this.store.put('orders', id, o);
    return true;
  }
  async markRefunded(id, now) {
    const o = this.store.get('orders', id);
    if (!o || o.status !== 'paid') return { order: o ? { ...o } : null, changed: false };
    Object.assign(o, { status: 'refunded', refundedAt: now });
    this.store.put('orders', id, o);
    return { order: { ...o }, changed: true };
  }
  async setRef(id, ref) { const o = this.store.get('orders', id); if (o) { o.providerRef = ref; this.store.put('orders', id, o); } }
  async byUser(userId, limit = 30) {
    return this.store.list('orders', (o) => o.userId === userId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map((o) => ({ ...o }));
  }
  async paidSince(userId, currency, since) {
    return this.store.list('orders', (o) => o.userId === userId && o.currency === currency && o.status === 'paid' && o.paidAt >= since).reduce((n, o) => n + o.amount, 0);
  }
}
