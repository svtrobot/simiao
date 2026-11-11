// 供養（設計文檔七章）：付費只買儀式感，不賣靈驗，也不加功德。伺服器見 server/domain/shop.js。
// 商品是包（高香 ×10），買到進背包；續燈與描金靈位直接作用在指定的那盞燈 / 那個靈位上。
// 付款交給支付平台的頁面（我們看不到卡號）；PAYMENTS=sandbox 的本機部署是測試付款，不扣款。
import { api } from './api.js';
import { t } from './i18n.js';
import { $, toast, openPanel, closePanel } from './ui.js';

export function createShop({ slug }) {
  let state = { enabled: false, skus: [], bag: {}, cap: { limit: 0, spent: 0 }, currency: 'TWD' };
  let ctx = { context: null, target: null, onDone: null };
  let pending = null; // sandbox order waiting for the test payment

  // "NT$120", "US$3.99": a bare "$" would be ambiguous between the two
  const SIGN = { TWD: 'NT$', USD: 'US$' };
  const money = (amount) => `${SIGN[state.currency] || `${state.currency} `}${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: amount % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const itemLine = (bag) => Object.entries(bag).filter(([, n]) => n > 0).map(([k, n]) => `${t(`item.${k}`)} ×${n}`).join('、');

  function setBag(bag) {
    state.bag = { ...bag };
    window.dispatchEvent(new CustomEvent('simiao:bag', { detail: state.bag }));
    if (!$('shop-panel').hidden) $('shop-bag').textContent = itemLine(state.bag) ? t('shop.bag', itemLine(state.bag)) : '';
  }

  async function load() {
    try { state = await api('GET', `/api/shop?t=${encodeURIComponent(slug)}`); setBag(state.bag); } catch { /* shop stays closed */ }
    return state;
  }

  function render() {
    const list = state.skus.filter((s) => !ctx.context || s.context === ctx.context);
    $('shop-note').textContent = !state.enabled ? t('shop.closed') : state.provider === 'sandbox' ? t('shop.sandboxNote') : t('shop.note');
    $('shop-sandbox').hidden = true; pending = null;
    $('shop-list').replaceChildren(...list.map((s) => {
      const li = document.createElement('li');
      const text = document.createElement('div');
      const name = document.createElement('b'); name.textContent = s.name;
      const desc = document.createElement('small'); desc.textContent = s.desc;
      text.append(name, desc);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = money(s.price);
      b.disabled = !state.enabled || (s.target && !ctx.target);
      b.onclick = () => buy(s, b);
      li.append(text, b);
      return li;
    }));
    if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('shop.empty'); $('shop-list').append(li); }
    $('shop-bag').textContent = itemLine(state.bag) ? t('shop.bag', itemLine(state.bag)) : '';
    $('shop-cap').textContent = state.enabled && state.cap.limit ? t('shop.cap', money(state.cap.limit)) : '';
  }

  /** @param opts { context: 'incense' | 'paper' | 'lamp' | 'tablet' | null, target, onDone(bag) } */
  async function open(opts = {}) {
    ctx = { context: opts.context || null, target: opts.target || null, onDone: opts.onDone || null };
    await load();
    render();
    openPanel('shop-panel', () => { const done = ctx.onDone; ctx.onDone = null; done?.(state.bag); });
  }

  async function buy(sku, btn) {
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/shop/orders', { sku: sku.id, target: sku.target ? ctx.target : null });
      if (r.checkout.kind === 'redirect') { location.href = r.checkout.url; return; }
      // sandbox: a test payment that moves no money
      pending = r.order;
      $('shop-sandbox-text').textContent = t('shop.sandboxAsk', sku.name, money(r.order.amount));
      $('shop-sandbox').hidden = false;
      $('shop-sandbox').scrollIntoView({ block: 'nearest' });
    } catch (e) {
      toast(e.status === 429 ? t('shop.capHit') : e.status === 404 ? t('shop.noTarget') : e.status === 403 ? t('shop.closed') : t('err.generic'));
    } finally { btn.disabled = false; }
  }

  async function paySandbox() {
    if (!pending) return;
    try {
      const r = await api('POST', `/api/shop/sandbox/${pending.id}/pay`);
      setBag(r.bag);
      toast(t('shop.done', pending.name), { gold: true });
      pending = null;
      await load(); render();
      if (ctx.target) closePanel('shop-panel'); // a lamp or a tablet: done, go back and look
    } catch { toast(t('err.generic')); }
  }

  /** Back from the payment page: /?paid=<order id> (or =cancel). The webhook may land a moment later. */
  async function checkReturn() {
    const q = new URLSearchParams(location.search);
    const id = q.get('paid');
    if (!id) return;
    q.delete('paid');
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : ''));
    if (id === 'cancel') return;
    for (let i = 0; i < 12; i++) {
      try {
        const r = await api('GET', `/api/shop/orders/${encodeURIComponent(id)}`);
        if (r.order.status === 'paid') { setBag(r.bag); toast(t('shop.done', r.order.name), { gold: true }); return; }
      } catch { return; }
      await new Promise((res) => setTimeout(res, 1500));
    }
    toast(t('shop.pendingLater'));
  }

  $('shop-sandbox-pay').onclick = paySandbox;
  $('shop-sandbox-cancel').onclick = () => { pending = null; $('shop-sandbox').hidden = true; };

  return { open, load, checkReturn, setBag, bag: () => state.bag, enabled: () => !!state.enabled };
}
