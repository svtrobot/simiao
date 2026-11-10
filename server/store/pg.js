// Minimal PostgreSQL client (wire protocol 3.0), zero dependencies — just what the document store
// needs: one connection, parameterised queries (extended protocol, text format), SCRAM-SHA-256 /
// MD5 / cleartext auth, optional TLS (sslmode=require | verify-full), automatic reconnect.
// Every value comes back as a string (or null); cast in SQL (`doc::text`) and parse in the caller.
// If this ever needs pooling, COPY or LISTEN, swap this file for the `pg` package: the surface the
// rest of the server uses is `query(sql, params) → { rows, count }` and `close()`.
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const cstr = (s) => Buffer.from(`${s}\0`, 'utf8');
const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const int16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const msg = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from(type), int32(body.length + 4), body]); };

/** RFC 5802 / 7677 client proof. Returns { final: client-final-message, serverSignature (base64) }. */
export function scramClientFinal(password, clientFirstBare, serverFirst) {
  const attrs = Object.fromEntries(serverFirst.split(',').map((kv) => [kv[0], kv.slice(2)]));
  const salted = crypto.pbkdf2Sync(Buffer.from(password.normalize('NFKC'), 'utf8'), Buffer.from(attrs.s, 'base64'), Number(attrs.i), 32, 'sha256');
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const clientKey = hmac(salted, 'Client Key');
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const withoutProof = `c=biws,r=${attrs.r}`;
  const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
  const sig = hmac(storedKey, authMessage);
  const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
  return { final: `${withoutProof},p=${proof.toString('base64')}`, serverSignature: hmac(hmac(salted, 'Server Key'), authMessage).toString('base64'), nonce: attrs.r };
}

export class PgError extends Error {
  constructor(fields) { super(fields.M || 'postgres error'); this.code = fields.C; this.detail = fields.D; this.severity = fields.S; }
}

export class PgClient {
  /** @param url postgres://user:password@host:5432/database?sslmode=require */
  constructor(url) {
    const u = new URL(url);
    this.opts = {
      host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username || 'postgres'),
      password: decodeURIComponent(u.password || ''), database: decodeURIComponent(u.pathname.slice(1) || u.username || 'postgres'),
      sslmode: u.searchParams.get('sslmode') || 'disable',
    };
    this.socket = null; this.ready = null; this.buf = Buffer.alloc(0);
    this.queue = []; this.current = null; this.closed = false;
  }

  /** Connect (once); later calls wait for the same handshake. A dropped connection reconnects on the next query. */
  connect() {
    if (this.ready) return this.ready;
    this.ready = this._connect().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  async _connect() {
    const { host, port, sslmode } = this.opts;
    let socket = await new Promise((resolve, reject) => {
      const s = net.connect({ host, port }, () => resolve(s));
      s.once('error', reject);
      s.setNoDelay(true);
    });
    if (sslmode !== 'disable') {
      socket.write(Buffer.concat([int32(8), int32(80877103)])); // SSLRequest
      const answer = await new Promise((resolve, reject) => { socket.once('data', (d) => resolve(String.fromCharCode(d[0]))); socket.once('error', reject); });
      if (answer !== 'S') throw new Error('postgres: server refused TLS');
      socket = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: sslmode === 'verify-full' }, () => resolve(t));
        t.once('error', reject);
      });
    }
    this.socket = socket; this.buf = Buffer.alloc(0);
    const handshake = new Promise((resolve, reject) => { this.handshake = { resolve, reject }; });
    socket.on('data', (d) => this._onData(d));
    socket.on('error', (e) => this._onClose(e));
    socket.on('close', () => this._onClose(new Error('postgres: connection closed')));
    const { user, database } = this.opts;
    const params = Buffer.concat([cstr('user'), cstr(user), cstr('database'), cstr(database), cstr('client_encoding'), cstr('UTF8'), cstr('application_name'), cstr('simiao'), Buffer.from([0])]);
    socket.write(Buffer.concat([int32(params.length + 8), int32(196608), params]));
    await handshake;
  }

  _onClose(err) {
    if (!this.socket) return;
    this.socket.removeAllListeners(); this.socket.destroy(); this.socket = null; this.ready = null;
    this.handshake?.reject(err); this.handshake = null;
    const failed = [this.current, ...this.queue].filter(Boolean);
    this.current = null; this.queue = [];
    for (const q of failed) q.reject(err);
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      this._onMessage(type, body);
    }
  }

  _fields(body) {
    const out = {};
    let i = 0;
    while (i < body.length && body[i] !== 0) {
      const end = body.indexOf(0, i + 1);
      out[String.fromCharCode(body[i])] = body.toString('utf8', i + 1, end);
      i = end + 1;
    }
    return out;
  }

  _onMessage(type, body) {
    const q = this.current;
    switch (type) {
      case 'R': return this._auth(body);
      case 'S': case 'K': case 'N': case 'A': case '1': case '2': case 'n': case 's': case 'I': return undefined;
      case 'T': {
        if (!q) return undefined;
        const n = body.readInt16BE(0); let i = 2; q.cols = [];
        for (let k = 0; k < n; k++) { const end = body.indexOf(0, i); q.cols.push(body.toString('utf8', i, end)); i = end + 19; }
        return undefined;
      }
      case 'D': {
        if (!q) return undefined;
        const n = body.readInt16BE(0); let i = 2; const row = {};
        for (let k = 0; k < n; k++) {
          const len = body.readInt32BE(i); i += 4;
          row[q.cols[k]] = len < 0 ? null : body.toString('utf8', i, i + len);
          if (len > 0) i += len;
        }
        q.rows.push(row);
        return undefined;
      }
      case 'C': { if (q) { const m = /(\d+)$/.exec(body.toString('utf8', 0, body.length - 1)); q.count = m ? Number(m[1]) : 0; } return undefined; }
      case 'E': {
        const err = new PgError(this._fields(body));
        if (this.handshake) { this.handshake.reject(err); this.handshake = null; return undefined; }
        if (q) q.error = err;
        return undefined;
      }
      case 'Z': {
        if (this.handshake) { this.handshake.resolve(); this.handshake = null; this._next(); return undefined; }
        if (q) { this.current = null; if (q.error) q.reject(q.error); else q.resolve({ rows: q.rows, count: q.count ?? q.rows.length }); }
        this._next();
        return undefined;
      }
      default: return undefined;
    }
  }

  _auth(body) {
    const code = body.readInt32BE(0);
    const { user, password } = this.opts;
    if (code === 0) return;
    if (code === 3) { this.socket.write(msg('p', cstr(password))); return; }
    if (code === 5) {
      const md5 = (x) => crypto.createHash('md5').update(x).digest('hex');
      this.socket.write(msg('p', cstr(`md5${md5(Buffer.concat([Buffer.from(md5(password + user)), body.subarray(4, 8)]))}`)));
      return;
    }
    if (code === 10) {
      if (!body.toString('utf8', 4).split('\0').includes('SCRAM-SHA-256')) { this._onClose(new Error('postgres: no supported SASL mechanism')); return; }
      this.scram = { bare: `n=,r=${crypto.randomBytes(18).toString('base64')}` };
      const first = Buffer.from(`n,,${this.scram.bare}`);
      this.socket.write(msg('p', cstr('SCRAM-SHA-256'), int32(first.length), first));
      return;
    }
    if (code === 11) {
      const r = scramClientFinal(password, this.scram.bare, body.toString('utf8', 4));
      if (!r.nonce.startsWith(this.scram.bare.slice(5))) { this._onClose(new Error('postgres: SCRAM nonce mismatch')); return; }
      this.scram.serverSignature = r.serverSignature;
      this.socket.write(msg('p', Buffer.from(r.final)));
      return;
    }
    if (code === 12) {
      if (body.toString('utf8', 4) !== `v=${this.scram.serverSignature}`) this._onClose(new Error('postgres: server signature mismatch'));
      return;
    }
    this._onClose(new Error(`postgres: unsupported auth method ${code}`));
  }

  _next() {
    if (this.current || !this.queue.length || !this.socket || this.handshake) return;
    const q = this.current = this.queue.shift();
    q.rows = []; q.cols = [];
    if (q.simple) { this.socket.write(msg('Q', cstr(q.sql))); return; }
    const params = q.params.map((p) => {
      if (p === null || p === undefined) return int32(-1);
      const b = Buffer.from(typeof p === 'string' ? p : String(p), 'utf8');
      return Buffer.concat([int32(b.length), b]);
    });
    this.socket.write(Buffer.concat([
      msg('P', cstr(''), cstr(q.sql), int16(0)),
      msg('B', cstr(''), cstr(''), int16(0), int16(params.length), ...params, int16(0)),
      msg('D', Buffer.from('P'), cstr('')),
      msg('E', cstr(''), int32(0)),
      msg('S'),
    ]));
  }

  /** Parameterised query ($1, $2 …; values are sent as text). */
  async query(sql, params = []) {
    if (this.closed) throw new Error('postgres: client closed');
    await this.connect();
    return new Promise((resolve, reject) => { this.queue.push({ sql, params, resolve, reject }); this._next(); });
  }

  /** Several statements separated by `;`, no parameters (schema setup). */
  async exec(sql) {
    if (this.closed) throw new Error('postgres: client closed');
    await this.connect();
    return new Promise((resolve, reject) => { this.queue.push({ sql, simple: true, resolve, reject }); this._next(); });
  }

  async close() {
    this.closed = true;
    if (!this.socket) return;
    try { this.socket.write(msg('X')); } catch { /* already gone */ }
    const s = this.socket;
    this.socket.removeAllListeners(); this.socket = null; this.ready = null;
    s.on('error', () => {});
    s.end();
  }
}
