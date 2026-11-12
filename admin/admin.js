const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('simiao.admin') || '';

async function call(method, path, body) {
  const res = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.status), { data, status: res.status });
  return data;
}

const ORG = { temple: '寺院/道觀', memorial: '陵園/殯葬', tourism: '文旅', culture: '文化空間', family: '家族祠堂' };
const TIER = { starter: '入門版', standard: '標準版', flagship: '旗艦版' };
const STATUS = { pending: '待審核', approved: '已通過', rejected: '已駁回' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- 檢舉與內容、帳號 ----
const STATE = { public: '公開', held: '已收起（待看）', removed: '已下架' };
const REASON = { ad: '廣告', abuse: '不當內容', other: '其他' };
const LOG = { hide: '下架', keep: '保留 / 恢復', mute: '禁言', unmute: '解除禁言' };
const fail = (what) => (err) => alert(`${what}失敗：${err.data?.error || err.message}`);

async function loadContent() {
  const q = new URLSearchParams({ kind: $('content-kind').value, filter: $('content-filter').value });
  if ($('content-q').value.trim()) q.set('q', $('content-q').value.trim());
  const d = await call('GET', `/api/admin/content?${q}`);
  $('content-open').textContent = d.open ? `待處理的檢舉：${d.open} 則` : '沒有待處理的檢舉';
  $('content').innerHTML = d.items.length ? d.items.map((i) => `
    <tr>
      <td class="num">${esc(when(i.createdAt))}</td>
      <td>${esc(i.text)}<div><code>${esc(i.templeId)}</code></div></td>
      <td><a class="link" data-user="${esc(i.authorId)}">${esc(i.authorName || '—')}</a>${i.authorMuted ? ' <span class="pill muted-pill">禁言中</span>' : ''}<div><code>${esc(i.authorId)}</code></div></td>
      <td>${i.reports ? `${i.reports} 人${Object.entries(i.reasons).map(([k, n]) => `<div class="muted">${esc(REASON[k] || k)} ×${n}</div>`).join('')}` : '<span class="muted">—</span>'}</td>
      <td><span class="pill ${esc(i.state)}">${STATE[i.state] || esc(i.state)}</span>${i.removedReason ? `<div class="muted">${esc(i.removedReason)}</div>` : ''}</td>
      <td><div class="row">
        ${i.state !== 'removed' ? `<button type="button" class="secondary" data-hide="${esc(i.kind)}/${esc(i.id)}">下架</button>` : ''}
        ${i.state !== 'public' || i.reportStatus === 'open' ? `<button type="button" class="secondary" data-restore="${esc(i.kind)}/${esc(i.id)}">${i.state === 'public' ? '保留' : '恢復'}</button>` : ''}
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted">沒有符合的內容</td></tr>';
}

async function loadUsers() {
  const q = $('users-q').value.trim();
  const [d, log] = await Promise.all([call('GET', `/api/admin/users?${new URLSearchParams(q ? { q } : {})}`), call('GET', '/api/admin/modlog')]);
  $('users').innerHTML = d.users.length ? d.users.map((u) => `
    <tr>
      <td>${esc(u.name)}<div><code>${esc(u.id)}</code></div></td>
      <td class="num">${esc(when(u.createdAt))}</td>
      <td class="num">功德 ${u.merit}<div class="muted">${u.minutes} 分鐘 · 連續 ${u.streak} 天</div></td>
      <td class="num">祈願牌 ${u.wishes} · 燈 ${u.lamps}<div class="muted">家堂 ${u.halls}（不可查看）</div></td>
      <td class="num">${u.reported || '<span class="muted">—</span>'}</td>
      <td>${u.muted ? `<span class="pill muted-pill">禁言中</span><div class="muted">${esc(when(u.muted.at))}</div><div class="muted">${esc(u.muted.reason)}</div>` : '<span class="pill public">正常</span>'}</td>
      <td><div class="row">
        ${u.muted ? `<button type="button" class="secondary" data-unmute="${esc(u.id)}">解除禁言</button>` : `<button type="button" class="secondary" data-mute="${esc(u.id)}" data-label="${esc(u.name)}">禁言</button>`}
        <button type="button" class="secondary" data-orders="${esc(u.id)}">看訂單</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="7" class="muted">找不到帳號</td></tr>';
  $('modlog').textContent = log.log.map((l) => `${when(l.at)}  ${LOG[l.action] || l.action}  ${l.target}${l.reason ? `  ｜${l.reason}` : ''}`).join('\n') || '還沒有操作';
}

document.addEventListener('click', async (e) => {
  const d = e.target.dataset;
  try {
    if (d.hide) {
      const reason = prompt('下架原因（留在操作記錄裡，按「取消」則不下架）：');
      if (reason === null) return;
      await call('POST', `/api/admin/content/${d.hide}/hide`, { reason });
      await Promise.all([loadContent(), loadUsers()]);
    } else if (d.restore) {
      await call('POST', `/api/admin/content/${d.restore}/restore`);
      await Promise.all([loadContent(), loadUsers()]);
    } else if (d.mute) {
      const reason = prompt(`禁言：${d.label}\n這個帳號不能再掛祈願牌、燈上不能寫字。請填原因（按「取消」則不禁言）：`);
      if (reason === null) return;
      const hideAll = confirm('同時把這個帳號目前公開的祈願牌與燈上的字全部下架嗎？\n「確定」= 全部下架；「取消」= 只禁言。');
      await call('POST', `/api/admin/users/${d.mute}/mute`, { reason, hideAll });
      await Promise.all([loadContent(), loadUsers()]);
    } else if (d.unmute) {
      await call('POST', `/api/admin/users/${d.unmute}/unmute`);
      await loadUsers();
    } else if (d.user) {
      $('users-q').value = d.user; await loadUsers(); $('users').scrollIntoView({ block: 'center' });
    } else if (d.orders) {
      $('orders-user').value = d.orders; $('orders-status').value = ''; await loadOrders(); $('orders').scrollIntoView({ block: 'center' });
    }
  } catch (err) { fail('操作')(err); }
});
$('content-refresh').onclick = () => loadContent().catch(fail('查詢'));
$('content-kind').onchange = $('content-filter').onchange = $('content-refresh').onclick;
$('users-refresh').onclick = () => loadUsers().catch(fail('查詢'));

// ---- 訂單與退款 ----
const ORDER_STATUS = { pending: '未付款', paid: '已付款', refunded: '已退款' };
const SIGN = { TWD: 'NT$', USD: 'US$' };
const money = (amount, cur) => `${SIGN[cur] || `${cur} `}${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: amount % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (ms) => (ms ? new Date(ms).toLocaleString('zh-TW', { hour12: false }) : '');
const PROVIDER_NOTE = {
  sandbox: '目前是沙盒通道：沒有真實金流，退款只改帳、收回道具。',
  stripe: '目前是 Stripe 通道：按「退款」會把整筆金額退回原付款方式，無法撤銷。',
};

async function loadOrders() {
  const q = new URLSearchParams();
  if ($('orders-status').value) q.set('status', $('orders-status').value);
  if ($('orders-user').value.trim()) q.set('user', $('orders-user').value.trim());
  const d = await call('GET', `/api/admin/orders?${q}`);
  $('orders-note').textContent = `${PROVIDER_NOTE[d.provider] || '目前沒有開啟支付通道（未設定 PAYMENTS）：只能查看，不能退款。'}已用掉的道具不會追回；功德不受退款影響。`;
  const sum = (rows, status) => rows.filter((r) => r.status === status);
  const line = (rows) => (rows.length ? rows.map((r) => `${money(r.amount, r.currency)}（${r.n} 筆）`).join('、') : '—');
  $('orders-stats').innerHTML = [['近 24 小時收款', sum(d.summary.day, 'paid')], ['近 24 小時退款', sum(d.summary.day, 'refunded')], ['近 30 天收款', sum(d.summary.month, 'paid')], ['近 30 天退款', sum(d.summary.month, 'refunded')]]
    .map(([label, rows]) => `<div class="stat"><span class="muted">${label}</span><b style="font-size:18px">${esc(line(rows))}</b></div>`).join('');
  $('orders').innerHTML = d.orders.length ? d.orders.map((o) => `
    <tr>
      <td class="num">${esc(when(o.createdAt))}</td>
      <td><code>${esc(o.id)}</code>${o.providerRef ? `<div><code>${esc(o.provider)} · ${esc(o.providerRef)}</code></div>` : `<div><code>${esc(o.provider)}</code></div>`}</td>
      <td>${esc(o.userName || '—')}<div><code>${esc(o.userId)}</code></div></td>
      <td>${esc(o.name)}</td>
      <td class="num">${esc(money(o.amount, o.currency))}</td>
      <td><span class="pill ${esc(o.status)}">${ORDER_STATUS[o.status] || esc(o.status)}</span>${o.refundedAt ? `<div class="muted">${esc(when(o.refundedAt))}</div>` : ''}${o.refundReason ? `<div class="muted">${esc(o.refundReason)}</div>` : ''}</td>
      <td>${o.status === 'paid' && d.provider === o.provider ? `<button type="button" class="secondary" data-refund="${esc(o.id)}" data-label="${esc(`${o.name} ${money(o.amount, o.currency)}`)}">退款</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="muted">沒有符合的訂單</td></tr>';
}

async function load() {
  const [stats, apps, scenes, cfg] = await Promise.all([
    call('GET', '/api/admin/stats'), call('GET', '/api/admin/applications'), call('GET', '/api/admin/scenes'), call('GET', '/api/config'),
  ]);
  $('region').textContent = `部署地區：${cfg.region}${cfg.ritualsAllowed ? '' : '（文化參訪模式）'}`;
  $('stats').innerHTML = `<div class="stat"><span class="muted">全平台在線</span><b>${stats.online}</b></div>` +
    stats.temples.map((t) => `<div class="stat"><span class="muted">${esc(t.id)} · ${t.rooms} 個房間</span><b>${t.online}</b><span class="muted">今日香火 ${t.incense}</span></div>`).join('') +
    (stats.festival ? `<div class="stat"><span class="muted">清明雲祭掃 · ${stats.festival.phase === 'open' ? '進行中' : `預熱（${stats.festival.inDays} 天後）`}${stats.festival.preview ? ' · 預覽' : ''}</span><b>${stats.festival.stats?.halls ?? 0} 個家堂</b><span class="muted">${stats.festival.stats?.tablets ?? 0} 位先人被祭掃</span></div>` : '');

  $('apps').innerHTML = apps.length ? apps.map((a) => `
    <tr>
      <td><b>${esc(a.name)}</b><div class="muted">${esc(a.applicant)} · ${esc(a.contact)}</div><div class="muted">${esc(a.intro)}</div></td>
      <td>${ORG[a.orgType] || esc(a.orgType)}<div class="muted">${TIER[a.tier] || esc(a.tier)}</div></td>
      <td>${esc(a.sceneId)}</td>
      <td>${a.certificateRef ? esc(a.certificateRef) : '<span class="muted">—</span>'}</td>
      <td><span class="pill ${a.status}">${STATUS[a.status]}</span>${a.templeSlug ? `<div class="muted"><a href="/t/${esc(a.templeSlug)}" style="color:var(--gold)">/t/${esc(a.templeSlug)}</a></div>` : ''}${a.reviewNote ? `<div class="muted">${esc(a.reviewNote)}</div>` : ''}</td>
      <td>${a.status === 'pending' ? `<div class="row">
        <input aria-label="分寺網址代號" placeholder="網址代號 (英數)" data-slug="${a.id}" size="12">
        <button type="button" data-approve="${a.id}">通過</button>
        <button type="button" class="secondary" data-reject="${a.id}">駁回</button></div>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted">目前沒有申請</td></tr>';

  $('scenes').innerHTML = scenes.scenes.map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.name['zh-Hant'])}</td><td>${esc(s.culture)}</td>
    <td>${s.regions.map(esc).join(', ')}</td><td>${s.complianceModes.map(esc).join(', ')}</td><td>${s.seats}</td><td>${esc(s.license)}</td></tr>`).join('');
  $('rejected').textContent = Object.keys(scenes.rejected).length ? `被拒收的場景包：\n${JSON.stringify(scenes.rejected, null, 2)}` : '';
  $('scene-select').innerHTML = scenes.scenes.map((s) => `<option value="${esc(s.id)}">${esc(s.name['zh-Hant'])}</option>`).join('');
  await Promise.all([loadOrders(), loadContent(), loadUsers()]);
}

document.addEventListener('click', async (e) => {
  const id = e.target.dataset.refund;
  if (!id) return;
  const reason = prompt(`退款：${e.target.dataset.label}\n整筆退回，無法撤銷。請填退款原因（留在帳上，按「取消」則不退）：`);
  if (reason === null) return;
  e.target.disabled = true;
  try { await call('POST', `/api/admin/orders/${id}/refund`, { reason }); await loadOrders(); }
  catch (err) { e.target.disabled = false; alert(`退款失敗：${err.data?.error || err.message}`); }
});
$('orders-refresh').onclick = () => loadOrders().catch((err) => alert(`查詢失敗：${err.data?.error || err.message}`));
$('orders-status').onchange = $('orders-refresh').onclick;

document.addEventListener('click', async (e) => {
  const ap = e.target.dataset.approve, rj = e.target.dataset.reject;
  if (!ap && !rj) return;
  try {
    if (ap) await call('POST', `/api/admin/applications/${ap}/decision`, { approve: true, slug: document.querySelector(`[data-slug="${ap}"]`).value });
    else await call('POST', `/api/admin/applications/${rj}/decision`, { approve: false, note: prompt('駁回原因（會通知申請人）') || '' });
    await load();
  } catch (err) { alert(`操作失敗：${err.data?.error || err.message}`); }
});

$('reload').onclick = async () => { await call('POST', '/api/admin/scenes/reload'); await load(); };

$('apply-form').onsubmit = async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const out = await call('POST', '/api/temples/apply', body);
    $('apply-msg').textContent = `已送出（${out.id}）`; e.target.reset(); await load();
  } catch (err) { $('apply-msg').textContent = `未通過：${(err.data?.issues || [err.data?.error]).join('、')}`; }
};

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  token = $('token').value.trim();
  try { await load(); sessionStorage.setItem('simiao.admin', token); $('login').hidden = true; $('app').hidden = false; }
  catch (err) { $('login-msg').textContent = err.status === 401 ? '令牌不正確，或伺服器未設定 ADMIN_TOKEN' : '無法連線'; }
};

if (token) load().then(() => { $('login').hidden = true; $('app').hidden = false; }).catch(() => {});
