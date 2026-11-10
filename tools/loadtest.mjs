// Load test: N pilgrims across worker threads, a realistic mix of sitting and walking.
// Measures what a person would feel (round-trip latency of a ping through the room), what the
// network carries (downstream per client) and, with an admin token, what the server spends
// (event-loop lag, tick time, store flushes, memory). See docs/LOADTEST.md.
//
//   node tools/loadtest.mjs --url http://localhost:8787 --clients 2000 --seconds 60 --admin <ADMIN_TOKEN>
//
// Options: --walkers 0.3 (share walking; the rest sit), --workers 8, --ramp 200 (connections / s),
//          --temple main
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (isMainThread) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const opts = {
    url: arg('url', process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:8787'),
    clients: Number(arg('clients', 200)), seconds: Number(arg('seconds', 30)),
    walkers: Number(arg('walkers', 0.3)), workers: Number(arg('workers', Math.min(8, Math.max(1, os.cpus().length >> 1)))),
    ramp: Number(arg('ramp', 200)), temple: arg('temple', 'main'), admin: arg('admin', ''),
  };
  const per = Math.ceil(opts.clients / opts.workers);
  const adminStats = async (reset) => {
    if (!opts.admin) return null;
    try { return await (await fetch(`${opts.url}/api/admin/stats${reset ? '?reset=1' : ''}`, { headers: { Authorization: `Bearer ${opts.admin}` } })).json(); } catch { return null; }
  };

  console.log(`load test: ${opts.clients} pilgrims, ${opts.workers} workers, ${Math.round(opts.walkers * 100)}% walking, ${opts.seconds}s steady → ${opts.url}`);
  const t0 = Date.now();
  const workers = [];
  const results = [];
  let connected = 0;
  await new Promise((resolveAll) => {
    let ready = 0;
    for (let w = 0; w < opts.workers; w++) {
      const n = Math.min(per, opts.clients - w * per);
      if (n <= 0) { ready++; continue; }
      const worker = new Worker(new URL(import.meta.url), { workerData: { ...opts, n, offset: w * per, ramp: opts.ramp / opts.workers } });
      worker.on('message', (m) => {
        if (m.t === 'connected') { connected += m.n; if (++ready === opts.workers) resolveAll(); }
        if (m.t === 'result') results.push(m);
      });
      worker.on('error', (e) => { console.error('worker error', e); ready++; });
      workers.push(worker);
    }
  });
  console.log(`${connected} connected in ${((Date.now() - t0) / 1000).toFixed(1)} s; measuring ${opts.seconds} s…`);
  await adminStats(true); // start the server's window now
  for (const w of workers) w.postMessage({ t: 'measure' });
  await sleep(opts.seconds * 1000);
  const server = await adminStats(false);
  for (const w of workers) w.postMessage({ t: 'stop' });
  while (results.length < workers.length) await sleep(100);

  const all = results.flatMap((r) => r.rtt).sort((a, b) => a - b);
  const pct = (p) => (all.length ? all[Math.min(all.length - 1, Math.floor(all.length * p))] : NaN);
  const sum = (k) => results.reduce((s, r) => s + r[k], 0);
  const rooms = new Set(results.flatMap((r) => r.rooms));
  console.log('\n— clients —');
  console.log(`connected ${connected} / ${opts.clients}, failed ${sum('failed')}, dropped during test ${sum('dropped')}, rooms ${rooms.size}`);
  const why = {}; for (const r of results) for (const [k, v] of Object.entries(r.reasons || {})) why[k] = (why[k] || 0) + v;
  if (Object.keys(why).length) console.log('failures:', JSON.stringify(why));
  console.log(`ping round trip ms: p50 ${pct(0.5)}  p95 ${pct(0.95)}  p99 ${pct(0.99)}  max ${all[all.length - 1] ?? NaN}  (${all.length} samples)`);
  console.log(`downstream per client: ${(sum('bytes') / connected / opts.seconds / 1024).toFixed(2)} KB/s (budget ≤ 2 KB/s, design 6.3)`);
  if (server) {
    const m = server.metrics;
    console.log('\n— server —');
    console.log(`online ${server.online}; event-loop lag ms p50 ${m.loopLagMs.p50} p99 ${m.loopLagMs.p99} max ${m.loopLagMs.max}`);
    console.log(`room ticks ${m.ticksPerSec}/s, avg ${m.tickAvgMs} ms, max ${m.tickMaxMs} ms; msgs in ${m.msgsInPerSec}/s, out ${m.msgsOutPerSec}/s (${m.kbOutPerSec} KB/s)`);
    console.log(`store flushes ${m.flushes}, avg ${m.flushAvgMs} ms, max ${m.flushMaxMs} ms, ${m.flushKBPerSec} KB/s written; memory rss ${m.rssMB} MB, heap ${m.heapMB} MB`);
  }
  console.log(JSON.stringify({ clients: opts.clients, connected, rtt: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) }, server: server?.metrics || null }));
  for (const w of workers) await w.terminate();
  process.exit(0);
} else {
  // ---------------------------------------------------------------- one worker: n pilgrims
  const { url, n, offset, walkers, ramp, temple } = workerData;
  const clients = [];
  let measuring = false, stopping = false, failed = 0, dropped = 0, bytes = 0;
  const reasons = {};
  const rtt = [];
  const rooms = new Set();

  async function pilgrim(i) {
    const s = await (await fetch(`${url}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ws = new WebSocket(`${url.replace('http', 'ws')}/ws?temple=${temple}&token=${s.token}`);
    const c = { ws, room: null, x: (Math.random() - 0.5) * 8, z: 6 + Math.random() * 6 };
    ws.onmessage = (e) => {
      if (measuring) bytes += e.data.length;
      if (e.data.startsWith('{"t":"pong"')) { const m = JSON.parse(e.data); if (measuring) rtt.push(Date.now() - m.c); return; }
      if (e.data.startsWith('{"t":"welcome"')) { c.room = JSON.parse(e.data).room.id; rooms.add(c.room); }
    };
    ws.onclose = () => { if (!stopping) dropped++; };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const walker = Math.random() < walkers;
    if (!walker) setTimeout(() => ws.send(JSON.stringify({ t: 'sit', seat: `seat-${Math.floor(Math.random() * 10)}-${Math.floor(Math.random() * 10)}` })), 300 + Math.random() * 2000);
    c.plan = setInterval(() => {
      if (ws.readyState !== 1) return;
      if (!walker) { if (Math.random() < 0.01) ws.send(JSON.stringify({ t: 'rit', k: 'bow' })); return; }
      const r = Math.random();
      if (r < 0.75) { c.x = Math.max(-12, Math.min(12, c.x + (Math.random() - 0.5) * 0.6)); c.z = Math.max(-10, Math.min(13, c.z - (Math.random() - 0.4) * 0.5)); ws.send(JSON.stringify({ t: 'mv', x: c.x, z: c.z, ry: 3.1 })); }
      else if (r < 0.77) ws.send(JSON.stringify({ t: 'rit', k: 'incense' }));
      else if (r < 0.8) ws.send(JSON.stringify({ t: 'act', a: 'pray' }));
      else if (r < 0.81) ws.send(JSON.stringify({ t: 'greet', k: 'gassho' }));
    }, 250 + Math.random() * 100);
    // latency probe, staggered
    c.probe = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: Date.now() })); }, 5000 + Math.random() * 1000);
    clients.push(c);
  }

  for (let i = 0; i < n; i++) {
    pilgrim(i).catch((e) => { failed++; const k = e?.cause?.code || e?.message || e?.type || 'error'; reasons[k] = (reasons[k] || 0) + 1; });
    await sleep(1000 / Math.max(1, ramp));
  }
  // wait for the last handshakes
  for (let k = 0; k < 100 && clients.length + failed < n; k++) await sleep(100);
  parentPort.postMessage({ t: 'connected', n: clients.length });
  parentPort.on('message', (m) => {
    if (m.t === 'measure') { measuring = true; bytes = 0; rtt.length = 0; dropped = 0; }
    if (m.t === 'stop') {
      stopping = true;
      for (const c of clients) { clearInterval(c.plan); clearInterval(c.probe); try { c.ws.close(); } catch { /* fine */ } }
      parentPort.postMessage({ t: 'result', rtt, bytes, failed, dropped, rooms: [...rooms], reasons });
    }
  });
}
