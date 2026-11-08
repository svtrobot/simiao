// Simulate N pilgrims in one temple: walk, sit, greet, offer incense.
// Reports rooms used, average downstream bandwidth per client and tick sizes.
// Usage: node tools/loadtest.mjs [url=http://localhost:8787] [clients=200] [seconds=20] [walkers=0.3]
// walkers = share of pilgrims walking around; the rest sit and meditate (the normal state of a hall).
const base = process.argv[2] || 'http://localhost:8787';
const N = Number(process.argv[3] || 200);
const SECONDS = Number(process.argv[4] || 20);
const WALKERS = Number(process.argv[5] ?? 0.3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = [];
let bytes = 0, ticks = 0, tickBytes = 0;

async function pilgrim(i) {
  const s = await (await fetch(`${base}/api/session`, { method: 'POST', body: '{}' })).json();
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?temple=main&token=${s.token}`);
  const c = { ws, room: null, x: 0, z: 12 };
  ws.onmessage = (e) => {
    bytes += e.data.length;
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') c.room = m.room.id;
    if (m.t === 'tick') { ticks++; tickBytes += e.data.length; }
  };
  await new Promise((r) => { ws.onopen = r; });
  clients.push(c);
  const walker = i < N * WALKERS;
  if (!walker) setTimeout(() => ws.send(JSON.stringify({ t: 'sit', seat: `seat-${Math.floor(i / 10) % 10}-${i % 10}` })), 200);
  const plan = setInterval(() => {
    if (!walker) { if (Math.random() < 0.01) ws.send(JSON.stringify({ t: 'rit', k: 'bow' })); return; }
    const r = Math.random();
    if (r < 0.7) { c.x += (Math.random() - 0.5) * 0.6; c.z -= Math.random() * 0.4; ws.send(JSON.stringify({ t: 'mv', x: c.x, z: c.z, ry: 3.1 })); }
    else if (r < 0.75) ws.send(JSON.stringify({ t: 'sit', seat: `seat-${Math.floor(Math.random() * 10)}-${Math.floor(Math.random() * 10)}` }));
    else if (r < 0.78) ws.send(JSON.stringify({ t: 'rit', k: 'incense' }));
    else if (r < 0.8) ws.send(JSON.stringify({ t: 'act', a: 'pray' }));
  }, 250 + (i % 7) * 30);
  c.stop = () => { clearInterval(plan); ws.close(); };
}

const t0 = Date.now();
for (let i = 0; i < N; i++) { await pilgrim(i); if (i % 50 === 49) await sleep(50); }
console.log(`${N} clients connected in ${Date.now() - t0} ms`);
bytes = 0; ticks = 0; tickBytes = 0;
await sleep(SECONDS * 1000);
const rooms = new Set(clients.map((c) => c.room));
console.log(`rooms: ${rooms.size}`);
console.log(`avg downstream per client: ${(bytes / N / SECONDS / 1024).toFixed(2)} KB/s (budget ≤ 2 KB/s, design doc 6.3)`);
console.log(`avg tick message: ${(tickBytes / Math.max(1, ticks)).toFixed(0)} bytes`);
for (const c of clients) c.stop();
await sleep(300);
process.exit(0);
