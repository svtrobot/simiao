// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close, fragmentation).
// Zero dependencies so the prototype runs anywhere `node` runs. The room layer only
// uses `send()`, `close()` and the 'message' / 'close' events, so swapping this for
// `ws` or Colyseus transport later does not touch game logic.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
const MAX_BUFFERED = 1 << 20; // drop clients that cannot keep up (1 MB queued)

export function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

export function encodeFrame(opcode, payload = Buffer.alloc(0), mask = false) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2); header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  if (!mask) return Buffer.concat([header, payload]);
  header[1] |= 0x80;
  const key = crypto.randomBytes(4);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
  return Buffer.concat([header, key, body]);
}

/** Incremental frame parser. Returns parsed frames and keeps leftovers. */
export class FrameParser {
  constructor(maxPayload) { this.buf = Buffer.alloc(0); this.max = maxPayload; }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (rsv) throw new WsError(1002, 'RSV bits set');
      if (len === 126) {
        if (b.length < 4) break;
        len = b.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (b.length < 10) break;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.max)) throw new WsError(1009, 'Frame too large');
        len = Number(big); off = 10;
      }
      if (len > this.max) throw new WsError(1009, 'Frame too large');
      if (!masked) throw new WsError(1002, 'Client frames must be masked');
      if (b.length < off + 4 + len) break;
      const key = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
      this.buf = b.subarray(off + 4 + len);
      frames.push({ fin, opcode, payload });
    }
    return frames;
  }
}

class WsError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}

export class WsConnection extends EventEmitter {
  constructor(socket, req, opts) {
    super();
    this.socket = socket;
    this.req = req;
    this.open = true;
    this.parser = new FrameParser(opts.maxPayload);
    this.fragments = null;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._finish(1006, 'socket closed'));
    socket.on('error', () => this._finish(1006, 'socket error'));
    this.pingTimer = setInterval(() => {
      if (!this.alive) return this.terminate();
      this.alive = false;
      this._write(OP.PING);
    }, opts.pingMs);
    this.pingTimer.unref?.();
  }

  _onData(chunk) {
    let frames;
    try { frames = this.parser.push(chunk); } catch (e) { return this.close(e.code || 1002, e.message); }
    for (const f of frames) {
      if (f.opcode >= 0x8) { this._control(f); continue; }
      if (f.opcode === OP.CONT) {
        if (!this.fragments) return this.close(1002, 'Unexpected continuation');
        this.fragments.parts.push(f.payload);
        this.fragments.size += f.payload.length;
        if (this.fragments.size > this.parser.max) return this.close(1009, 'Message too large');
        if (f.fin) {
          const { opcode, parts } = this.fragments; this.fragments = null;
          this._deliver(opcode, Buffer.concat(parts));
        }
      } else if (!f.fin) {
        this.fragments = { opcode: f.opcode, parts: [f.payload], size: f.payload.length };
      } else {
        this._deliver(f.opcode, f.payload);
      }
    }
  }

  _control(f) {
    this.alive = true;
    if (f.opcode === OP.PING) this._write(OP.PONG, f.payload);
    else if (f.opcode === OP.CLOSE) {
      const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005;
      this.close(code === 1005 ? 1000 : code);
    }
  }

  _deliver(opcode, payload) {
    this.alive = true;
    if (opcode === OP.TEXT) this.emit('message', payload.toString('utf8'));
    else if (opcode === OP.BIN) this.emit('message', payload);
  }

  _write(opcode, payload) {
    if (!this.open || this.socket.destroyed) return false;
    if (this.socket.writableLength > MAX_BUFFERED) { this.terminate(); return false; }
    this.socket.write(encodeFrame(opcode, payload));
    return true;
  }

  /** A frame already encoded by encodeFrame — one encoding shared by every member of a room. */
  sendFrame(frame) {
    if (!this.open || this.socket.destroyed) return false;
    if (this.socket.writableLength > MAX_BUFFERED) { this.terminate(); return false; }
    this.socket.write(frame);
    return true;
  }

  send(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    return this._write(Buffer.isBuffer(data) ? OP.BIN : OP.TEXT, buf);
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(String(reason).slice(0, 120), 'utf8');
    const p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code, 0); r.copy(p, 2);
    this._write(OP.CLOSE, p);
    this._finish(code, reason);
    setTimeout(() => this.socket.destroy(), 200).unref?.();
  }

  terminate() { this._finish(1006, 'terminated'); this.socket.destroy(); }

  _finish(code, reason) {
    if (!this.open) return;
    this.open = false;
    clearInterval(this.pingTimer);
    this.emit('close', code, reason);
  }
}

/** Attach to an http.Server. `onConnection(ws, req, url)` decides what to do. */
export function attachWebSocket(server, path, opts, onConnection) {
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    const upgrade = (req.headers.upgrade || '').toLowerCase();
    if (url.pathname !== path || upgrade !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '', '',
    ].join('\r\n'));
    const ws = new WsConnection(socket, req, opts);
    onConnection(ws, req, url);
  });
}
