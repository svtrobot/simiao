// HTTP: JSON API + static files. Kept framework-free; routes map 1:1 to the
// NestJS controllers planned in the design doc (6.1) when the backend is split out.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './domain/util.js';
import { almanac, personal, todayIn } from './domain/almanac.js';
import { metrics } from './metrics.js';

export const THREE_VERSION = '0.170.0';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
  '.splat': 'application/octet-stream', '.ply': 'application/octet-stream', '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self), accelerometer=(self), gyroscope=(self)',
};

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(data);
}

async function readJson(req, limit = 8 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'body_too_large');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
}

function serveStatic(res, baseDir, rel, { cache = 'no-cache' } = {}) {
  const safe = path.normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, '');
  if (safe.split(/[/\\]/).includes('..')) return false;
  let file = path.join(baseDir, safe);
  if (!file.startsWith(baseDir)) return false;
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const st = fs.statSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': cache, ...SECURITY_HEADERS,
    });
    fs.createReadStream(file).pipe(res);
    return true;
  } catch { return false; }
}

export function createHandler(ctx) {
  const { config, users, templesSvc, scenes, fortune, offerings, lobby } = ctx;
  const routes = [];
  const route = (method, pattern, fn) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, fn });
  };
  const token = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  const admin = (req) => {
    if (!config.adminToken || token(req) !== config.adminToken) throw new HttpError(401, 'admin_required');
  };
  const temple = (slug) => {
    const t = templesSvc.get(slug);
    if (!t || t.status !== 'live') throw new HttpError(404, 'temple_not_found');
    return t;
  };
  const ritualOk = (t, action) => {
    const scene = scenes.get(t.sceneId);
    const mode = ctx.modeOf(t, scene);
    if (!ctx.actionAllowed(mode, action, scene)) throw new HttpError(403, 'not_in_this_mode');
    return scene;
  };

  route('GET', '/api/health', () => ({ ok: true, region: config.region, online: lobby.totalOnline(), uptime: Math.round(process.uptime()) }));

  route('GET', '/api/config', () => ({
    region: config.region, locale: config.regionPolicy.locale, ritualsAllowed: config.regionPolicy.ritualsAllowed,
    selfServiceTemples: config.regionPolicy.selfServiceTemples, hotline: config.regionPolicy.hotline,
  }));

  route('POST', '/api/session', async (req) => {
    const body = await readJson(req);
    const s = users.session(body.token || token(req));
    if (body.mood) users.setMood(s.user, body.mood);
    return { token: s.token, user: users.publicView(s.user), returned: s.returned };
  });

  // ---- 保存修行：通行密鑰與恢復碼（2.1；docs/ACCOUNTS.md）----
  const acc = ctx.accounts;
  const ip = (req) => req.socket.remoteAddress || '';
  route('GET', '/api/account', (req) => acc.status(users.require(token(req))));
  route('POST', '/api/account/recovery', (req) => acc.createRecovery(users.require(token(req))));
  route('POST', '/api/account/restore', async (req) => acc.restore((await readJson(req)).code, ip(req)));
  route('POST', '/api/account/passkey/options', (req) => acc.registerOptions(users.require(token(req)), req));
  route('POST', '/api/account/passkey', async (req) => acc.register(users.require(token(req)), await readJson(req, 32 * 1024), req));
  route('POST', '/api/account/passkey/:id/remove', (req, p) => acc.removePasskey(users.require(token(req)), p.id));
  route('POST', '/api/account/login/options', (req) => acc.loginOptions(req));
  route('POST', '/api/account/login', async (req) => { const r = await readJson(req, 32 * 1024); acc.throttle(ip(req), Date.now()); return acc.login(r, req); });
  route('POST', '/api/account/signout', (req) => { users.require(token(req)); users.revokeToken(token(req)); return { ok: true }; });

  // ---- 提醒（Web Push，4.1）----
  route('GET', '/api/push', (req) => ctx.push.status(users.require(token(req))));
  route('POST', '/api/push/subscribe', async (req) => ctx.push.subscribe(users.require(token(req)), await readJson(req)));
  route('POST', '/api/push/prefs', async (req) => ctx.push.setPrefs(users.require(token(req)), await readJson(req)));
  route('POST', '/api/push/unsubscribe', async (req) => ctx.push.unsubscribe(users.require(token(req)), (await readJson(req)).endpoint));
  route('POST', '/api/push/test', (req) => ctx.push.test(users.require(token(req))));

  route('POST', '/api/me/mood', async (req) => {
    const u = users.require(token(req));
    users.setMood(u, (await readJson(req)).mood);
    return users.publicView(u);
  });

  route('GET', '/api/me', (req) => users.privateView(users.require(token(req))));

  route('GET', '/api/temples', () => templesSvc.listPublic().map((t) => ({
    slug: t.slug, name: t.name, type: t.type, label: t.label || null, certified: t.certified, sceneId: t.sceneId, culture: scenes.get(t.sceneId)?.culture || null,
    online: lobby.templeStats(t.id).online,
  })));

  route('GET', '/api/temples/:slug', (req, p) => {
    const t = temple(p.slug);
    const scene = scenes.get(t.sceneId);
    return {
      temple: { slug: t.slug, name: t.name, plaque: t.plaque, type: t.type, label: t.label || null, certified: t.certified, tier: t.tier },
      mode: ctx.modeOf(t, scene),
      scene,
      stats: lobby.templeStats(t.id),
    };
  });

  route('GET', '/api/scenes', () => scenes.forRegion(config.region).map((s) => scenes.summary(s)));

  // 御神籤: traditions without 擲筊 (manifest.fortune.jiao === false) reveal the drawn lot directly
  route('POST', '/api/temples/:slug/fortune/reveal', (req, p) => {
    const t = temple(p.slug); const scene = ritualOk(t, 'fortune');
    if (scene.fortune?.jiao !== false) throw new HttpError(409, 'jiao_required');
    return fortune.reveal(users.require(token(req)).id, t.id);
  });
  route('POST', '/api/temples/:slug/fortune/draw', (req, p) => {
    const t = temple(p.slug); ritualOk(t, 'fortune');
    return fortune.draw(users.require(token(req)).id, t.id);
  });
  route('POST', '/api/temples/:slug/fortune/jiao', (req, p) => {
    const t = temple(p.slug); ritualOk(t, 'fortune');
    return fortune.throwJiao(users.require(token(req)).id, t.id);
  });
  route('GET', '/api/temples/:slug/fortune/today', (req, p) => {
    const t = temple(p.slug);
    return { lot: fortune.today(users.require(token(req)).id, t.id) };
  });

  route('GET', '/api/temples/:slug/wishes', (req, p) => offerings.wall(temple(p.slug).id));
  route('POST', '/api/temples/:slug/wishes', async (req, p) => {
    const t = temple(p.slug);
    const u = users.require(token(req));
    const body = await readJson(req);
    const out = offerings.addWish(u, t.id, body);
    ctx.creditMerit(u, 'wish');
    return { wish: { id: out.wish.id, text: out.wish.text, visibility: out.wish.visibility }, support: out.support };
  });
  route('POST', '/api/wishes/:id/rejoice', (req, p) => {
    const u = users.require(token(req));
    const out = offerings.rejoice(u, p.id);
    if (!out.already) ctx.creditMerit(u, 'rejoice');
    return out;
  });

  // ---- 黃曆 / 日籤 / 本命佛（3.3、4.1）----
  route('GET', '/api/temples/:slug/almanac', (req, p, url) => {
    const t = temple(p.slug);
    const mode = ctx.modeOf(t, scenes.get(t.sceneId));
    const tz = config.regionPolicy.tz;
    const q = url.searchParams.get('date');
    const date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayIn(tz);
    const u = users.byToken(token(req));
    const alm = almanac(date, { tz, mode });
    return {
      ...alm, mode,
      daily: ctx.daily.pick(config.regionPolicy.locale, date, u?.id),
      me: u ? { ...personal(alm, u.birthday, { mode }), hasBirthday: !!u.birthday, streak: u.practice.streak } : null,
    };
  });
  route('POST', '/api/me/birthday', async (req) => {
    const u = users.require(token(req));
    return { birthday: users.setBirthday(u, await readJson(req)) };
  });
  route('DELETE', '/api/me/birthday', (req) => { users.clearBirthday(users.require(token(req))); return { birthday: null }; });

  // ---- 點燈 / 燈牆 / 祈福卡 ----
  route('GET', '/api/temples/:slug/lamps', (req, p) => {
    const t = temple(p.slug);
    const u = users.byToken(token(req));
    const mode = ctx.modeOf(t, scenes.get(t.sceneId));
    return {
      kinds: ctx.lampKinds[mode],
      lamps: ctx.lamps.active(t.id).map((l) => ({ ...ctx.lamps.publicView(l), mine: !!u && l.userId === u.id })),
      mine: u ? ctx.lamps.mine(u.id).filter((l) => l.templeId === t.id).map((l) => ctx.lamps.ownerView(l)) : [],
    };
  });
  route('POST', '/api/temples/:slug/lamps', async (req, p) => {
    const t = temple(p.slug); ritualOk(t, 'lamp');
    const u = users.require(token(req));
    const mode = ctx.modeOf(t, scenes.get(t.sceneId));
    const out = ctx.lamps.light(u, t.id, mode, await readJson(req));
    // only a lamp lit for someone else counts as merit (為他人祈福, 4.2)
    const merit = out.lamp.forOther ? ctx.creditMerit(u, 'lamp') : { counted: false };
    lobby.bumpLamps(t.id);
    return { lamp: out.lamp, support: out.support, merit: merit.counted ? merit.merit : 0, me: users.publicView(u) };
  });
  route('POST', '/api/lamps/:id/renew', (req, p) => ctx.lamps.renew(users.require(token(req)), p.id));
  route('GET', '/api/cards/:id', (req, p) => {
    const c = ctx.lamps.card(p.id);
    const t = templesSvc.get(c.templeId);
    if (!t || t.status !== 'live') throw new HttpError(404, 'not_found');
    return { ...c, temple: { slug: t.slug, name: t.name }, mode: ctx.modeOf(t, scenes.get(t.sceneId)) };
  });

  // ---- 禪房 / 抄經（2.2、2.3）----
  // 抄經 is a ritual in ritual mode; cultural mode only offers the secular 習字 text (COMPLIANCE.md).
  route('GET', '/api/temples/:slug/copy', (req, p) => {
    const t = temple(p.slug);
    const mode = ctx.modeOf(t, scenes.get(t.sceneId));
    return { mode, texts: ctx.copy.list(users.byToken(token(req)), mode, config.regionPolicy.locale) };
  });
  route('POST', '/api/temples/:slug/copy', async (req, p) => {
    const t = temple(p.slug);
    const u = users.require(token(req));
    const out = ctx.copy.write(u, await readJson(req), ctx.modeOf(t, scenes.get(t.sceneId)));
    return { ...out, me: users.publicView(u) };
  });
  route('POST', '/api/temples/:slug/copy/restart', async (req, p) => {
    temple(p.slug);
    return ctx.copy.restart(users.require(token(req)), (await readJson(req)).id);
  });
  route('POST', '/api/zen/start', (req) => ctx.zen.start(users.require(token(req))));
  route('POST', '/api/zen/beat', (req) => { const u = users.require(token(req)); return { ...ctx.zen.beat(u), me: users.publicView(u) }; });
  route('POST', '/api/zen/end', (req) => { const u = users.require(token(req)); return { ...ctx.zen.end(u), me: users.publicView(u) }; });

  // ---- 祖先堂（2.3、3.2）：私人家堂，只有家人看得到；燒紙只在儀式模式（COMPLIANCE.md）----
  const modeAt = (url) => { const t = temple(url.searchParams.get('t') || 'main'); return ctx.modeOf(t, scenes.get(t.sceneId)); };
  const anc = ctx.ancestors;
  const hallOut = (u, id, url) => anc.view(u, id, modeAt(url));
  const tabletOut = (u, hallId, tb) => anc.tabletView(tb, u, anc.hall(u, hallId));
  route('GET', '/api/ancestors', (req, p, url) => {
    const u = users.require(token(req));
    return { mode: modeAt(url), halls: anc.list(u), reminders: anc.reminders(u) };
  });
  route('POST', '/api/ancestors', async (req, p, url) => {
    const u = users.require(token(req));
    return hallOut(u, anc.create(u, await readJson(req)).id, url);
  });
  route('GET', '/api/ancestors/:id', (req, p, url) => hallOut(users.require(token(req)), p.id, url));
  route('POST', '/api/ancestors/:id/name', async (req, p) => anc.rename(users.require(token(req)), p.id, (await readJson(req)).name));
  route('POST', '/api/ancestors/:id/invite', (req, p) => anc.resetInvite(users.require(token(req)), p.id));
  route('POST', '/api/ancestors/:id/leave', async (req, p) => anc.removeMember(users.require(token(req)), p.id, (await readJson(req)).memberId));
  route('GET', '/api/invites/:code', (req, p) => anc.invitePreview(p.code));
  route('POST', '/api/invites/:code/join', (req, p) => anc.join(users.require(token(req)), p.code));
  route('POST', '/api/ancestors/:id/tablets', async (req, p) => {
    const u = users.require(token(req));
    return tabletOut(u, p.id, anc.addTablet(u, p.id, await readJson(req, 128 * 1024)));
  });
  route('POST', '/api/ancestors/:id/tablets/:tid', async (req, p) => {
    const u = users.require(token(req));
    return tabletOut(u, p.id, anc.editTablet(u, p.id, p.tid, await readJson(req, 128 * 1024)));
  });
  route('POST', '/api/ancestors/:id/tablets/:tid/remove', (req, p) => anc.removeTablet(users.require(token(req)), p.id, p.tid));
  route('GET', '/api/ancestors/:id/tablets/:tid/photo', (req, p) => anc.photo(users.require(token(req)), p.id, p.tid));
  route('POST', '/api/ancestors/:id/tablets/:tid/offer', async (req, p, url) => {
    const u = users.require(token(req));
    const out = anc.offer(u, p.id, p.tid, (await readJson(req)).kind, modeAt(url));
    const merit = out.first ? ctx.creditMerit(u, 'memorial') : { counted: false };
    return { tablet: tabletOut(u, p.id, out.tablet), already: out.already, merit: merit.counted ? merit.merit : 0, me: users.publicView(u) };
  });
  route('POST', '/api/ancestors/:id/tablets/:tid/note', async (req, p) => {
    const u = users.require(token(req));
    return anc.note(u, p.id, p.tid, (await readJson(req)).text);
  });
  route('POST', '/api/ancestors/:id/tablets/:tid/notes/:nid/remove', (req, p) => anc.removeNote(users.require(token(req)), p.id, p.tid, p.nid));
  route('POST', '/api/ancestors/:id/tablets/:tid/burn', async (req, p, url) => {
    const u = users.require(token(req));
    const out = anc.burn(u, p.id, p.tid, await readJson(req), modeAt(url));
    ctx.users.save(u); // rate bucket lives on the user
    return { counted: out.counted, burned: tabletOut(u, p.id, out.tablet).today.burned };
  });

  route('POST', '/api/temples/apply', async (req) => templesSvc.apply(await readJson(req)));

  // ---- admin (平台审核) ----
  route('GET', '/api/admin/applications', (req) => { admin(req); return templesSvc.applications(); });
  route('POST', '/api/admin/applications/:id/decision', async (req, p) => {
    admin(req);
    return templesSvc.decide(p.id, await readJson(req));
  });
  route('GET', '/api/admin/scenes', (req) => {
    admin(req);
    return { scenes: [...scenes.scenes.values()].map((s) => scenes.summary(s)), rejected: Object.fromEntries(scenes.errors) };
  });
  route('POST', '/api/admin/scenes/reload', (req) => { admin(req); scenes.load(); return { loaded: scenes.scenes.size, rejected: Object.fromEntries(scenes.errors) }; });
  route('GET', '/api/admin/stats', (req, p, url) => {
    admin(req);
    return {
      online: lobby.totalOnline(), temples: [...lobby.temples.entries()].map(([id]) => ({ id, ...lobby.templeStats(id) })),
      metrics: metrics.snapshot({ reset: url.searchParams.get('reset') === '1' }),
    };
  });

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    metrics.http();
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = url.pathname.match(r.re);
          if (!m) continue;
          const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          const out = await r.fn(req, params, url);
          return sendJson(res, 200, out);
        }
        throw new HttpError(404, 'not_found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
      if (url.pathname.startsWith('/scenes/')) {
        if (serveStatic(res, config.scenesDir, url.pathname.slice('/scenes/'.length), { cache: 'public, max-age=300' })) return;
      } else if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        if (serveStatic(res, config.adminDir, url.pathname.slice('/admin'.length) || '/')) return;
      } else if (serveStatic(res, config.clientDir, url.pathname, { cache: url.pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache' })) {
        return;
      } else if (url.pathname.startsWith('/vendor/three/')) {
        // Not vendored locally (run `npm run vendor:three` for self-hosting, required for mainland):
        // fall back to the public CDN with the exact pinned version.
        res.writeHead(302, { Location: `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/${url.pathname.slice('/vendor/three/'.length)}` });
        return res.end();
      } else if (!path.extname(url.pathname)) {
        // SPA routes like /t/main → index.html
        if (serveStatic(res, config.clientDir, '/index.html')) return;
      }
      throw new HttpError(404, 'not_found');
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, ...e.extra });
      console.error('[http]', req.method, url.pathname, e);
      return sendJson(res, 500, { error: 'internal' });
    }
  };
}
