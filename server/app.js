// Composition root: wires store, domain services, HTTP and realtime together.
import http from 'node:http';
import { config as defaultConfig } from './config.js';
import { JsonStore } from './store/jsonStore.js';
import { SceneRegistry } from './domain/scenes.js';
import { TempleService } from './domain/temples.js';
import { UserService } from './domain/users.js';
import { FortuneService } from './domain/fortune.js';
import { OfferingService } from './domain/offerings.js';
import { LampService, LAMP_KINDS } from './domain/lamps.js';
import { DailyLines } from './domain/almanac.js';
import { CopyTexts, CopyService, ZenRooms } from './domain/copying.js';
import { AncestorService } from './domain/ancestors.js';
import { AccountService } from './domain/accounts.js';
import { PushService } from './domain/push.js';
import { ShopService } from './domain/shop.js';
import { providerFor } from './domain/payments.js';
import { Festivals } from './domain/festival.js';
import { ModerationService } from './domain/moderation.js';
import { JsonLedger, PgLedger } from './store/ledger.js';
import { record } from './domain/practice.js';
import { effectiveMode, actionAllowed } from './domain/compliance.js';
import { Lobby } from './realtime/lobby.js';
import { attachWebSocket } from './realtime/ws.js';
import { createHandler, sendJson } from './http.js';

export function createApp(overrides = {}) {
  // `store` / `cluster` are injected by index.js when DATABASE_URL / REDIS_URL are set (store/open.js)
  const { store: givenStore, cluster = null, ...rest } = overrides;
  const config = { ...defaultConfig, ...rest, room: { ...defaultConfig.room, ...rest.room } };
  const store = givenStore || new JsonStore(config.dataDir);
  const scenes = new SceneRegistry(config.scenesDir).load();
  const ctx = { config, store, scenes, cluster };
  ctx.users = new UserService({ store, locale: config.regionPolicy.locale });
  ctx.templesSvc = new TempleService({ store, scenes, regionPolicy: config.regionPolicy, region: config.region });
  ctx.fortune = new FortuneService({ contentDir: config.contentDir, store, tz: config.regionPolicy.tz });
  ctx.offerings = new OfferingService({ store, tz: config.regionPolicy.tz, hotline: config.regionPolicy.hotline, shard: cluster ? config.instanceId : '' });
  ctx.lamps = new LampService({ store, hotline: config.regionPolicy.hotline });
  ctx.lampKinds = LAMP_KINDS;
  ctx.festivals = new Festivals({ contentDir: config.contentDir, tz: config.regionPolicy.tz, preview: config.festivalPreview || '' });
  ctx.ancestors = new AncestorService({ store, tz: config.regionPolicy.tz, hotline: config.regionPolicy.hotline, festivals: ctx.festivals });
  ctx.accounts = new AccountService({ store, users: ctx.users, publicOrigin: config.publicOrigin || '' });
  ctx.daily = new DailyLines(config.contentDir);
  ctx.modeOf = (temple, scene) => effectiveMode({ regionPolicy: config.regionPolicy, scene, temple });
  ctx.actionAllowed = actionAllowed;
  ctx.creditMerit = (user, action) => {
    const r = record(user.practice, action, { tz: config.regionPolicy.tz });
    if (r.counted) ctx.users.save(user);
    return r;
  };
  ctx.push = new PushService({
    store, users: ctx.users, ancestors: ctx.ancestors, daily: ctx.daily, tz: config.regionPolicy.tz, locale: config.regionPolicy.locale,
    mode: config.regionPolicy.ritualsAllowed ? 'ritual' : 'cultural', subject: config.push?.subject || 'https://github.com/svtrobot/simiao', keys: config.push?.keys || null,
  });
  // 付費道具：帳本在 PostgreSQL 模式下走事務（store/ledger.js），不走文檔同步
  ctx.ledger = store.pg ? new PgLedger(store.pg) : new JsonLedger(store);
  ctx.shop = new ShopService({
    contentDir: config.contentDir, users: ctx.users, ledger: ctx.ledger, provider: providerFor(config), region: config.region, regionPolicy: config.regionPolicy,
    effects: {
      lampExtend: (user, target, days) => { if (ctx.lamps.extend(target?.lampId, days)) ctx.lobby.bumpLamps(ctx.store.get('lamps', target.lampId).templeId); },
      tabletPermanent: (user, target, on) => ctx.ancestors.setPermanent(target?.tabletId, on),
    },
  });
  ctx.ancestors.useItem = (user, item, n) => ctx.shop.use(user, item, n);
  ctx.lobby = new Lobby(ctx);
  ctx.moderation = new ModerationService({ store, tz: config.regionPolicy.tz, onChange: (kind, doc) => { if (kind === 'lamp') ctx.lobby.bumpLamps(doc.templeId); } });
  if (cluster) {
    cluster.start(() => ctx.lobby.presence());
    // a lamp lit through another instance: refresh this instance's rooms too
    store.onRemote?.((col, id, doc) => { if (col === 'lamps' && doc?.templeId) ctx.lobby.bumpLamps(doc.templeId); });
  }
  ctx.copy = new CopyService({ texts: new CopyTexts(config.contentDir), users: ctx.users, tz: config.regionPolicy.tz });
  ctx.zen = new ZenRooms({ users: ctx.users, tz: config.regionPolicy.tz, isSeatedElsewhere: (id) => ctx.lobby.isSeated(id) });

  const server = http.createServer(createHandler(ctx));
  const sockets = new Set();
  attachWebSocket(server, '/ws', config.ws, (ws, req, url) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    const user = ctx.users.byToken(url.searchParams.get('token'));
    if (!user) return ws.close(4401, 'session_required');
    const temple = ctx.templesSvc.get(url.searchParams.get('temple') || 'main');
    if (!temple || temple.status !== 'live') return ws.close(4404, 'temple_not_found');
    ctx.lobby.join(ws, user, temple);
  });

  const close = async () => {
    ctx.lobby.dispose();
    for (const ws of sockets) ws.close(1001, 'server shutting down');
    await cluster?.stop();
    await store.close();
    await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
  };

  return { server, ctx, config, close, sendJson };
}
