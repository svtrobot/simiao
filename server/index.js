import { createApp } from './app.js';
import { config as bootConfig } from './config.js';

// DATABASE_URL (+ REDIS_URL): PostgreSQL-backed, replicated store; otherwise JSON files (store/open.js)
let injected = {};
if (bootConfig.databaseUrl) {
  const { openCluster } = await import('./store/open.js');
  const { store, cluster, loaded } = await openCluster(bootConfig);
  injected = { store, cluster };
  console.log(`  store: PostgreSQL (${loaded} documents loaded)${cluster ? ' + Redis replication' : ', single instance'} · instance ${bootConfig.instanceId}`);
  // every instance must hand out the same push key: the first one to start creates it
  if (!bootConfig.push?.keys) {
    const { newVapidKeys } = await import('./domain/push.js');
    await store.ensure('meta', 'vapid', () => newVapidKeys());
  }
}
const app = createApp(injected);
const { config, server, ctx } = app;

server.listen(config.port, config.host, () => {
  const scenes = [...ctx.scenes.scenes.keys()].join(', ') || '(none)';
  console.log(`云上寺 server · region=${config.region} · http://localhost:${config.port}`);
  console.log(`  scenes: ${scenes}`);
  if (!config.adminToken) console.log('  admin API disabled (set ADMIN_TOKEN to enable /admin)');
});

// 提醒: check every minute whose local 08:00 / 20:00 / 22:00 it is.
// With several instances only the one holding the Redis lock runs the tick, so nobody is reminded twice.
if (config.push?.enabled !== false) {
  setInterval(async () => {
    try {
      if (ctx.cluster && !(await ctx.cluster.leader('push', 55))) return;
      await ctx.push.tick();
    } catch (e) { console.error('[push]', e.message); }
  }, 60_000).unref();
}

// METRICS_LOG=1: one line of load metrics every 30 s (docs/LOADTEST.md)
if (process.env.METRICS_LOG === '1') {
  const { metrics } = await import('./metrics.js');
  setInterval(() => console.log('[metrics]', JSON.stringify({ online: ctx.lobby.totalOnline(), ...metrics.snapshot({ reset: true }) })), 30_000).unref();
}

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${sig}: flushing data and closing…`);
    await app.close();
    process.exit(0);
  });
}
