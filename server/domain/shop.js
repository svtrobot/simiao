// 道具與供養（設計文檔七章）：「參拜永久免費，付費只買儀式感和沉浸度，不賣靈驗。」
// 紅線都在這裡用程式守著，不靠自覺：
//   · 任何商品都不加功德（買與用都不碰 practice；CLAUDE.md 規則 1）
//   · 沒有隨機內容（目錄不允許機率欄位）——不做抽卡
//   · 商品文字過同一套禁語（消災、改命、保證靈驗、功德充值…）
//   · 每個帳號每日消費上限（未成年人保護的底線；年齡門檻由各市場律師定）
// 商品是包（高香 ×10），買到進背包；不做儲值餘額。
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, newId } from './util.js';
import { marketingViolations } from './compliance.js';

const APPLY = new Set(['lamp_extend', 'tablet_permanent']);
const DAY = 86400000;

export function validateCatalog(c) {
  const errors = [];
  const need = (ok, msg) => { if (!ok) errors.push(msg); };
  need(c && Array.isArray(c.skus), 'skus[] required');
  if (errors.length) return errors;
  const ids = new Set();
  for (const s of c.skus) {
    need(/^[a-z0-9_]{2,40}$/.test(s.id || '') && !ids.has(s.id), `sku id missing or duplicate: ${s.id}`);
    ids.add(s.id);
    need(s.price && Object.values(s.price).every((p) => Number.isInteger(p) && p > 0), `${s.id}: price must be positive integers (minor units)`);
    need(!!s.grants !== !!s.apply, `${s.id}: exactly one of grants / apply`);
    if (s.grants) need(Object.values(s.grants).every((n) => Number.isInteger(n) && n > 0), `${s.id}: grants must be fixed positive counts`);
    if (s.apply) need(APPLY.has(s.apply) && !!s.target, `${s.id}: unknown apply or missing target`);
    // 不做抽卡：任何帶機率 / 隨機的欄位一律拒收
    need(!('chance' in s) && !('random' in s) && !('odds' in s) && !('pool' in s), `${s.id}: random contents are not allowed`);
    need(!('merit' in s), `${s.id}: paid items never grant merit`);
    const text = [...Object.values(s.name || {}), ...Object.values(s.desc || {})].join(' ');
    need(!!s.name?.['zh-Hant'], `${s.id}: name["zh-Hant"] required`);
    need(marketingViolations(text).length === 0, `${s.id}: prohibited marketing language`);
  }
  return errors;
}

export class ShopService {
  /**
   * @param ledger    JsonLedger | PgLedger
   * @param provider  payment channel or null (shop shows prices but cannot sell)
   * @param effects   { lampExtend(user, lampId, days), tabletPermanent(user, target, on) } applied when a targeted sku is paid
   */
  constructor({ contentDir, users, ledger, provider, region, regionPolicy, effects = {} }) {
    Object.assign(this, { users, ledger, provider, effects, tz: regionPolicy.tz, locale: regionPolicy.locale });
    const f = path.join(contentDir, 'shop', 'catalog.json');
    const cat = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { skus: [] };
    const errs = validateCatalog(cat);
    if (errs.length) throw new Error(`shop catalog rejected:\n  - ${errs.join('\n  - ')}`);
    this.currency = cat.currency?.[region] || null;
    this.dailyCap = this.currency ? cat.dailyCap?.[this.currency] ?? 0 : 0;
    this.skus = new Map(cat.skus.filter((s) => this.currency && s.price[this.currency]).map((s) => [s.id, s]));
    this.ritualsAllowed = regionPolicy.ritualsAllowed;
  }

  get enabled() { return !!this.provider && !!this.currency; }

  bag(user) { return { ...(user.bag || {}) }; }

  /** What this visitor can see. `mode` hides ritual items in cultural halls. */
  async list(user, mode = 'ritual', now = Date.now()) {
    const loc = this.locale;
    const skus = [...this.skus.values()].filter((s) => !s.ritual || (this.ritualsAllowed && mode === 'ritual')).map((s) => ({
      id: s.id, context: s.context, name: s.name[loc] || s.name['zh-Hant'], desc: s.desc?.[loc] || s.desc?.['zh-Hant'] || '',
      price: s.price[this.currency], grants: s.grants || null, target: s.target || null,
    }));
    const spent = user && this.enabled ? await this.ledger.paidSince(user.id, this.currency, this.dayStart(now)) : 0;
    return { enabled: this.enabled, provider: this.provider?.id || null, currency: this.currency, skus, bag: user ? this.bag(user) : {}, cap: { limit: this.dailyCap, spent } };
  }

  /** The spending cap is over a rolling 24 hours (stricter than "per calendar day", and the same in every time zone). */
  dayStart(now) { return now - DAY; }

  /** Start a purchase. Returns { order, checkout }. */
  async createOrder(user, { sku: skuId, target = null } = {}, { origin = '', validateTarget = () => true } = {}, now = Date.now()) {
    if (!this.enabled) throw new HttpError(403, 'shop_disabled');
    const sku = this.skus.get(skuId);
    if (!sku) throw new HttpError(422, 'unknown_sku');
    if (sku.ritual && !this.ritualsAllowed) throw new HttpError(403, 'not_in_this_mode');
    if (sku.target && !validateTarget(sku, target)) throw new HttpError(404, 'target_not_found');
    const amount = sku.price[this.currency];
    const spent = await this.ledger.paidSince(user.id, this.currency, this.dayStart(now));
    if (this.dailyCap && spent + amount > this.dailyCap) throw new HttpError(429, 'daily_spend_cap', { limit: this.dailyCap, spent });
    const order = await this.ledger.create({ id: newId(12), userId: user.id, sku: sku.id, amount, currency: this.currency, provider: this.provider.id, target: sku.target ? target : null, createdAt: now });
    const checkout = await this.provider.checkout(order, {
      name: sku.name[this.locale] || sku.name['zh-Hant'],
      successUrl: `${origin}/?paid=${order.id}`, cancelUrl: `${origin}/?paid=cancel`,
    });
    if (checkout.ref) await this.ledger.setRef(order.id, checkout.ref);
    return { order: this.publicOrder(order), checkout: { kind: checkout.kind, url: checkout.url || null } };
  }

  /** A payment arrived (webhook or sandbox). Safe to call any number of times. */
  async complete(orderId, ref = null, now = Date.now()) {
    if (!orderId) throw new HttpError(404, 'order_not_found');
    const { order } = await this.ledger.markPaid(orderId, ref, now);
    if (!order) throw new HttpError(404, 'order_not_found');
    if (order.status === 'paid' && !order.granted && await this.ledger.claimGrant(order.id)) this.grant(order, +1);
    return this.publicOrder(await this.ledger.get(orderId));
  }

  async refund(orderId, now = Date.now()) {
    if (!orderId) return null;
    const { order, changed } = await this.ledger.markRefunded(orderId, now);
    if (changed && order.granted) this.grant(order, -1);
    return order && this.publicOrder(order);
  }

  /** Hand out (sign +1) or take back (sign −1) what an order bought. Never touches merit. */
  grant(order, sign) {
    const sku = this.skus.get(order.sku);
    const user = this.users.store.get('users', order.userId);
    if (!sku || !user) return;
    if (sku.grants) {
      user.bag = user.bag || {};
      for (const [item, n] of Object.entries(sku.grants)) user.bag[item] = Math.max(0, (user.bag[item] || 0) + sign * n);
      this.users.save(user);
    } else if (sku.apply === 'lamp_extend') this.effects.lampExtend?.(user, order.target, sign * sku.days);
    else if (sku.apply === 'tablet_permanent') this.effects.tabletPermanent?.(user, order.target, sign > 0);
  }

  /** Use one item from the bag (高香, 紙紮…). Returns false when there is none. */
  use(user, item, n = 1) {
    if (!user.bag || (user.bag[item] || 0) < n) return false;
    user.bag[item] -= n;
    this.users.save(user);
    return true;
  }

  async orders(user) { return (await this.ledger.byUser(user.id)).map((o) => this.publicOrder(o)); }

  async order(user, id) {
    const o = await this.ledger.get(id);
    if (!o || o.userId !== user.id) throw new HttpError(404, 'order_not_found');
    return this.publicOrder(o);
  }

  publicOrder(o) {
    const sku = this.skus.get(o.sku);
    return { id: o.id, sku: o.sku, name: sku ? sku.name[this.locale] || sku.name['zh-Hant'] : o.sku, amount: o.amount, currency: o.currency, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt };
  }
}
