// What instances need to know about each other at runtime (docs/CLUSTER.md), kept in Redis:
//   presence  each instance writes its own per-temple online / room counts and recent sitters every
//             2 s with a short expiry, so a crashed instance simply disappears from the totals
//   leader    a short-lived lock, so jobs like the push reminder tick run on one instance only
// Rooms themselves stay inside one instance: a full hall is 100 people, and which instance hosts a
// room does not matter to anyone in it.
const BEAT_MS = 2000;
const TTL_SEC = 8;

export class Cluster {
  constructor({ redis, instance, ns = 'simiao' }) {
    Object.assign(this, { redis, instance, ns });
    this.others = new Map(); // templeId → { online, rooms, sitters: [] } summed over the other instances
    this.instances = 1;
    this.timer = null;
  }

  /** @param snapshot () → { [templeId]: { online, rooms, sitters } } for this instance */
  start(snapshot) {
    const beat = async () => {
      try {
        await this.redis.command('SET', `${this.ns}:presence:${this.instance}`, JSON.stringify(snapshot()), 'EX', TTL_SEC);
        const keys = await this.redis.command('KEYS', `${this.ns}:presence:*`);
        const mine = `${this.ns}:presence:${this.instance}`;
        const rest = keys.filter((k) => k !== mine);
        const vals = rest.length ? await this.redis.command('MGET', ...rest) : [];
        const sum = new Map();
        for (const raw of vals) {
          if (!raw) continue;
          let snap; try { snap = JSON.parse(raw); } catch { continue; }
          for (const [id, t] of Object.entries(snap)) {
            const s = sum.get(id) || { online: 0, rooms: 0, sitters: [] };
            s.online += t.online || 0; s.rooms += t.rooms || 0; s.sitters.push(...(t.sitters || []));
            sum.set(id, s);
          }
        }
        this.others = sum; this.instances = rest.length + 1;
      } catch { /* Redis briefly away: keep the last totals */ }
    };
    this.timer = setInterval(beat, BEAT_MS);
    this.timer.unref?.();
    return beat();
  }

  online(templeId) { return this.others.get(templeId)?.online || 0; }
  rooms(templeId) { return this.others.get(templeId)?.rooms || 0; }
  sitters(templeId) { return this.others.get(templeId)?.sitters || []; }
  totalOnlineElsewhere() { let n = 0; for (const t of this.others.values()) n += t.online; return n; }

  /** True on the one instance that gets to run `job` for the next `ttlSec` seconds. */
  async leader(job, ttlSec) {
    try { return (await this.redis.command('SET', `${this.ns}:lock:${job}`, this.instance, 'NX', 'EX', ttlSec)) === 'OK'; } catch { return false; }
  }

  async stop() {
    clearInterval(this.timer);
    try { await this.redis.command('DEL', `${this.ns}:presence:${this.instance}`); } catch { /* expires by itself */ }
    await this.redis.close();
  }
}
