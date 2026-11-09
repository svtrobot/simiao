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
import { record } from './domain/practice.js';
import { effectiveMode, actionAllowed } from './domain/compliance.js';
import { Lobby } from './realtime/lobby.js';
import { attachWebSocket } from './realtime/ws.js';
import { createHandler, sendJson } from './http.js';

export function createApp(overrides = {}) {
  const config = { ...defaultConfig, ...overrides, room: { ...defaultConfig.room, ...overrides.room } };
  const store = new JsonStore(config.dataDir);
  const scenes = new SceneRegistry(config.scenesDir).load();
  const ctx = { config, store, scenes };
  ctx.users = new UserService({ store, locale: config.regionPolicy.locale });
  ctx.templesSvc = new TempleService({ store, scenes, regionPolicy: config.regionPolicy, region: config.region });
  ctx.fortune = new FortuneService({ contentDir: config.contentDir, store, tz: config.regionPolicy.tz });
  ctx.offerings = new OfferingService({ store, tz: config.regionPolicy.tz, hotline: config.regionPolicy.hotline });
  ctx.lamps = new LampService({ store, hotline: config.regionPolicy.hotline });
  ctx.lampKinds = LAMP_KINDS;
  ctx.modeOf = (temple, scene) => effectiveMode({ regionPolicy: config.regionPolicy, scene, temple });
  ctx.actionAllowed = actionAllowed;
  ctx.creditMerit = (user, action) => {
    const r = record(user.practice, action, { tz: config.regionPolicy.tz });
    if (r.counted) ctx.users.save(user);
    return r;
  };
  ctx.lobby = new Lobby(ctx);

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

  const close = () => new Promise((resolve) => {
    ctx.lobby.dispose();
    for (const ws of sockets) ws.close(1001, 'server shutting down');
    store.flush();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });

  return { server, ctx, config, close, sendJson };
}
