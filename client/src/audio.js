// 声音是这类产品 50% 的体验（3.1）。P0 全部用 Web Audio 合成，零下载；
// 实地录音（寺院钟声、木鱼、签筒）到位后替换 sample() 的来源即可。
let ctx = null, master = null, verb = null, ambience = null;

function impulse(seconds = 3.2, decay = 2.6) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

export function unlockAudio() {
  if (ctx) { ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  verb = ctx.createConvolver(); verb.buffer = impulse();
  const wet = ctx.createGain(); wet.gain.value = 0.35;
  verb.connect(wet).connect(master);
  return ctx;
}

function out(dry = 1) {
  const g = ctx.createGain(); g.gain.value = dry;
  g.connect(master); g.connect(verb);
  return g;
}

/** Temple bell: inharmonic partials with long decay. */
export function bell(volume = 0.5) {
  if (!ctx) return;
  const t = ctx.currentTime, dst = out(volume);
  const base = 110;
  for (const [ratio, amp, dec] of [[0.5, 0.5, 9], [1, 1, 7], [1.183, 0.6, 6], [1.506, 0.45, 5], [2, 0.3, 4], [2.74, 0.2, 3], [3.76, 0.12, 2]]) {
    const o = ctx.createOscillator(); o.frequency.value = base * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp * 0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g).connect(dst); o.start(t); o.stop(t + dec);
  }
}

/** Wooden fish: short hollow knock. */
export function muyu(volume = 0.7) {
  if (!ctx) return;
  const t = ctx.currentTime, dst = out(volume);
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(380, t + 0.08);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g).connect(dst); o.start(t); o.stop(t + 0.25);
  noise(t, 0.03, 1800, 0.25, dst);
}

/** 泥生的招牌音：陶碰陶的清脆“哚”。 */
export function clay(volume = 0.4, pitch = 1) {
  if (!ctx) return;
  const t = ctx.currentTime, dst = out(volume);
  for (const [f, a] of [[1240 * pitch, 0.5], [2650 * pitch, 0.25], [3900 * pitch, 0.12]]) {
    const o = ctx.createOscillator(); o.frequency.value = f;
    const g = ctx.createGain(); g.gain.setValueAtTime(a * 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(dst); o.start(t); o.stop(t + 0.4);
  }
  noise(t, 0.015, 3000, 0.2, dst);
}

export function bead(volume = 0.3) { clay(volume, 1.6 + Math.random() * 0.1); }

export function sticks(volume = 0.4) {
  if (!ctx) return;
  const t = ctx.currentTime, dst = out(volume);
  for (let i = 0; i < 4; i++) noise(t + i * 0.035 + Math.random() * 0.02, 0.02, 2400 + Math.random() * 1200, 0.3, dst);
}

export function crackle(volume = 0.15) {
  if (!ctx) return;
  const t = ctx.currentTime, dst = out(volume);
  for (let i = 0; i < 10; i++) noise(t + Math.random() * 0.8, 0.01, 4000, 0.4 * Math.random(), dst);
}

function noise(t, dur, freq, amp, dst) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  const g = ctx.createGain(); g.gain.value = amp;
  s.connect(f).connect(g).connect(dst); s.start(t);
}

/** Mountain wind + far birds: looped filtered noise, very quiet. */
export function startAmbience() {
  if (!ctx || ambience) return;
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.995 + (Math.random() * 2 - 1) * 0.05; d[i] = last; }
  }
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 6);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lg = ctx.createGain(); lg.gain.value = 250;
  lfo.connect(lg).connect(f.frequency); lfo.start();
  s.connect(f).connect(g).connect(master); s.start();
  ambience = { s, g };
}

/** Fade the ambience to `level` (0–1 of its normal loudness) over `seconds` — quieter in the 禪房. */
export function setAmbience(level, seconds = 3) {
  if (!ctx || !ambience) return;
  const g = ambience.g.gain, now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(level, now + seconds);
}
