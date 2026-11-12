// 支付通道。帳本與商品目錄不認識任何平台；每個通道只做兩件事：
//   checkout(order, info) → { kind: 'redirect', url } | { kind: 'sandbox' }
//   webhook(rawBody, headers) → { type: 'paid' | 'refunded' | 'ignored', orderId, ref }（簽名不對就丟 HttpError）
//   refund(order) → 把整筆錢退回原付款方式（後台發起；平台自己的退款通知之後也會到 webhook，重複無害）
// 沙盒通道只給本機開發用（PAYMENTS=sandbox），不扣款。Stripe 通道填了 STRIPE_SECRET_KEY 才啟用。
// 之後的綠界 / LINE Pay 是同樣形狀的第三個通道。
import crypto from 'node:crypto';
import { HttpError } from './util.js';

export const sandbox = () => ({
  id: 'sandbox',
  async checkout() { return { kind: 'sandbox' }; },
  webhook() { throw new HttpError(404, 'not_found'); },
  async refund() { /* no money moved, nothing to send back */ },
});

/** Stripe's webhook signature: header `t=<unix>,v1=<hex hmac-sha256 of "t.payload">`. */
export function verifyStripeSignature(rawBody, header, secret, now = Date.now(), toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const t = Number(parts.t);
  if (!t || !parts.v1) throw new HttpError(400, 'bad_signature');
  if (Math.abs(now / 1000 - t) > toleranceSec) throw new HttpError(400, 'stale_signature');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  let given;
  try { given = Buffer.from(parts.v1, 'hex'); } catch { throw new HttpError(400, 'bad_signature'); }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(400, 'bad_signature');
}

/** x-www-form-urlencoded with Stripe's bracket notation for nested objects. */
function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out;
}

export const stripe = ({ secretKey, webhookSecret, fetchImpl = fetch }) => ({
  id: 'stripe',
  /** Hosted Checkout: we never see a card number. */
  async checkout(order, { name, successUrl, cancelUrl }) {
    const body = form({
      mode: 'payment', success_url: successUrl, cancel_url: cancelUrl, client_reference_id: order.id,
      metadata: { order: order.id }, payment_intent_data: { metadata: { order: order.id } },
      line_items: { 0: { quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.amount, product_data: { name } } } },
    }).join('&');
    const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', body, signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `order-${order.id}` },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.url) throw new HttpError(502, 'payment_provider_error', { detail: json?.error?.code || res.status });
    return { kind: 'redirect', url: json.url, ref: json.id };
  },
  /** Full refund to the original payment method. A paid order's ref is its PaymentIntent. */
  async refund(order) {
    if (!/^pi_/.test(order.providerRef || '')) throw new HttpError(409, 'no_payment_ref');
    const body = form({ payment_intent: order.providerRef, reason: 'requested_by_customer', metadata: { order: order.id } }).join('&');
    const res = await fetchImpl('https://api.stripe.com/v1/refunds', {
      method: 'POST', body, signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `refund-${order.id}` },
    });
    const json = await res.json().catch(() => null);
    // already refunded on Stripe's side (e.g. from their dashboard): our books just need to catch up
    if (!res.ok && json?.error?.code !== 'charge_already_refunded') throw new HttpError(502, 'payment_provider_error', { detail: json?.error?.code || res.status });
  },
  webhook(rawBody, headers, now = Date.now()) {
    verifyStripeSignature(rawBody, headers['stripe-signature'], webhookSecret, now);
    let ev;
    try { ev = JSON.parse(rawBody); } catch { throw new HttpError(400, 'invalid_json'); }
    const o = ev?.data?.object || {};
    if (ev.type === 'checkout.session.completed' && o.payment_status === 'paid') return { type: 'paid', orderId: o.client_reference_id || o.metadata?.order, ref: o.payment_intent || o.id };
    if (ev.type === 'charge.refunded') return { type: 'refunded', orderId: o.metadata?.order, ref: o.id };
    return { type: 'ignored' };
  },
});

/** Which channel this deployment uses, or null when payments are off. */
export function providerFor(config) {
  const p = config.payments || {};
  if (!config.regionPolicy.ritualsAllowed) return null; // 大陸版不開（另案接當地支付與合規）
  if (p.provider === 'stripe' && p.stripeSecretKey && p.stripeWebhookSecret) return stripe({ secretKey: p.stripeSecretKey, webhookSecret: p.stripeWebhookSecret });
  if (p.provider === 'sandbox') return sandbox();
  return null;
}
