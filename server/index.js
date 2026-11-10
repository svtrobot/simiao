import { createApp } from './app.js';

const app = createApp();
const { config, server, ctx } = app;

server.listen(config.port, config.host, () => {
  const scenes = [...ctx.scenes.scenes.keys()].join(', ') || '(none)';
  console.log(`云上寺 server · region=${config.region} · http://localhost:${config.port}`);
  console.log(`  scenes: ${scenes}`);
  if (!config.adminToken) console.log('  admin API disabled (set ADMIN_TOKEN to enable /admin)');
});

// 提醒: check every minute whose local 08:00 / 20:00 / 22:00 it is (single instance; a job queue in P1 infra)
if (config.push?.enabled !== false) {
  setInterval(() => { ctx.push.tick().catch((e) => console.error('[push]', e.message)); }, 60_000).unref();
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
