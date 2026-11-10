// Chooses the data layer from the environment (docs/CLUSTER.md):
//   nothing set            → JsonStore in DATA_DIR (single instance, zero configuration)
//   DATABASE_URL           → PgStore (durable in PostgreSQL; still a single instance)
//   DATABASE_URL+REDIS_URL → PgStore replicated between instances, plus Cluster (presence, leader lock)
import { PgClient } from './pg.js';
import { RedisClient } from './redis.js';
import { PgStore } from './pgStore.js';
import { Cluster } from '../realtime/cluster.js';

export async function openCluster(config) {
  const ns = `simiao:${config.region}`; // one Redis can serve several regional deployments
  const pg = new PgClient(config.databaseUrl);
  let redis = null, sub = null, cluster = null;
  if (config.redisUrl) {
    redis = new RedisClient(config.redisUrl);
    sub = new RedisClient(config.redisUrl);
    await redis.connect();
    cluster = new Cluster({ redis: new RedisClient(config.redisUrl), instance: config.instanceId, ns });
  }
  const store = new PgStore({ pg, redis, sub, instance: config.instanceId, channel: `${ns}:docs` });
  const loaded = await store.ready();
  return { store, cluster, loaded };
}
