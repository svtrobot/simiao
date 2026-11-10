// Minimal Redis client (RESP2), zero dependencies: commands with replies in order, a dedicated
// subscriber connection for pub/sub, AUTH / SELECT from the URL, optional TLS (rediss://),
// and reconnect with backoff (subscriptions are restored; in-flight commands fail and the caller retries).
// Swap for `ioredis` if cluster / sentinel support is ever needed: the server only uses
// `command(...args)`, `subscribe(channel, fn)` and `close()`.
import net from 'node:net';
import tls from 'node:tls';

/** Incremental RESP2 parser. feed(chunk) → array of complete replies (Error instances for `-ERR`). */
export class RespParser {
  constructor() { this.buf = Buffer.alloc(0); }
  feed(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    for (;;) {
      const r = this._read(0);
      if (!r) break;
      out.push(r.value);
      this.buf = this.buf.subarray(r.next);
    }
    return out;
  }
  _line(pos) {
    const end = this.buf.indexOf('\r\n', pos);
    return end < 0 ? null : { text: this.buf.toString('utf8', pos + 1, end), next: end + 2 };
  }
  _read(pos) {
    if (pos >= this.buf.length) return null;
    const type = this.buf[pos];
    const line = this._line(pos);
    if (!line) return null;
    if (type === 43) return { value: line.text, next: line.next };                    // +
    if (type === 45) return { value: new Error(line.text), next: line.next };         // -
    if (type === 58) return { value: Number(line.text), next: line.next };            // :
    if (type === 36) {                                                                // $
      const len = Number(line.text);
      if (len < 0) return { value: null, next: line.next };
      if (this.buf.length < line.next + len + 2) return null;
      return { value: this.buf.toString('utf8', line.next, line.next + len), next: line.next + len + 2 };
    }
    if (type === 42) {                                                                // *
      const n = Number(line.text);
      if (n < 0) return { value: null, next: line.next };
      const arr = []; let p = line.next;
      for (let i = 0; i < n; i++) { const r = this._read(p); if (!r) return null; arr.push(r.value); p = r.next; }
      return { value: arr, next: p };
    }
    throw new Error(`redis: unexpected reply type ${String.fromCharCode(type)}`);
  }
}

export function encodeCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const a of args) { const s = typeof a === 'string' ? a : String(a); parts.push(`$${Buffer.byteLength(s)}\r\n${s}\r\n`); }
  return parts.join('');
}

export class RedisClient {
  /** @param url redis://[user:password@]host:6379[/db] or rediss:// for TLS */
  constructor(url) {
    const u = new URL(url);
    this.opts = {
      host: u.hostname, port: Number(u.port || 6379), tls: u.protocol === 'rediss:',
      user: decodeURIComponent(u.username || ''), password: decodeURIComponent(u.password || ''), db: Number(u.pathname.slice(1) || 0),
    };
    this.socket = null; this.connecting = null; this.pending = []; this.closed = false;
    this.subs = new Map(); // channel → handler (subscriber connections only)
    this.retry = 0;
  }

  connect() {
    if (this.socket) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const { host, port } = this.opts;
      const s = this.opts.tls ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host }) : net.connect({ host, port });
      const parser = new RespParser();
      s.setNoDelay(true);
      s.once(this.opts.tls ? 'secureConnect' : 'connect', async () => {
        this.socket = s; this.connecting = null; this.retry = 0;
        try {
          if (this.opts.password) await this._send(this.opts.user ? ['AUTH', this.opts.user, this.opts.password] : ['AUTH', this.opts.password]);
          if (this.opts.db) await this._send(['SELECT', this.opts.db]);
          for (const ch of this.subs.keys()) s.write(encodeCommand(['SUBSCRIBE', ch]));
          resolve();
        } catch (e) { reject(e); s.destroy(); }
      });
      s.on('data', (d) => {
        let replies;
        try { replies = parser.feed(d); } catch (e) { s.destroy(e); return; }
        for (const r of replies) this._onReply(r);
      });
      const down = (err) => {
        if (this.socket !== s && this.connecting === null) return;
        const wasConnecting = !this.socket;
        this.socket = null; this.connecting = null;
        for (const p of this.pending.splice(0)) p.reject(err || new Error('redis: connection closed'));
        if (wasConnecting) reject(err || new Error('redis: connection failed'));
        if (!this.closed && this.subs.size) this._reconnectLater();
      };
      s.on('error', down);
      s.on('close', () => down(null));
    });
    return this.connecting;
  }

  _reconnectLater() {
    const ms = Math.min(5000, 200 * 2 ** this.retry++);
    setTimeout(() => { if (!this.closed) this.connect().catch(() => this._reconnectLater()); }, ms).unref?.();
  }

  _onReply(r) {
    // pub/sub pushes: ['message', channel, payload] / ['subscribe', channel, count]
    if (Array.isArray(r) && this.subs.size && typeof r[0] === 'string') {
      if (r[0] === 'message') { try { this.subs.get(r[1])?.(r[2]); } catch (e) { console.error('[redis] subscriber failed:', e.message); } return; }
      if (r[0] === 'subscribe' || r[0] === 'unsubscribe') return;
    }
    const p = this.pending.shift();
    if (!p) return;
    if (r instanceof Error) p.reject(r); else p.resolve(r);
  }

  _send(args) {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(encodeCommand(args));
    });
  }

  /** command('SET', key, value, 'EX', 10) → reply */
  async command(...args) {
    if (this.closed) throw new Error('redis: client closed');
    await this.connect();
    return this._send(args);
  }

  /** Turn this connection into a subscriber. Use a separate RedisClient for commands. */
  async subscribe(channel, handler) {
    this.subs.set(channel, handler);
    await this.connect();
    if (this.socket) this.socket.write(encodeCommand(['SUBSCRIBE', channel]));
  }

  async close() {
    this.closed = true;
    const s = this.socket;
    this.socket = null;
    if (s) { s.removeAllListeners('close'); s.on('error', () => {}); s.end(); }
  }
}
