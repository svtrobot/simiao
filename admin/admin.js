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

async function load() {
  const [stats, apps, scenes, cfg] = await Promise.all([
    call('GET', '/api/admin/stats'), call('GET', '/api/admin/applications'), call('GET', '/api/admin/scenes'), call('GET', '/api/config'),
  ]);
  $('region').textContent = `部署地區：${cfg.region}${cfg.ritualsAllowed ? '' : '（文化參訪模式）'}`;
  $('stats').innerHTML = `<div class="stat"><span class="muted">全平台在線</span><b>${stats.online}</b></div>` +
    stats.temples.map((t) => `<div class="stat"><span class="muted">${esc(t.id)} · ${t.rooms} 個房間</span><b>${t.online}</b><span class="muted">今日香火 ${t.incense}</span></div>`).join('');

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
}

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
