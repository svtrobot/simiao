// Runtime metrics for load testing and operations (docs/LOADTEST.md).
// Cheap enough to leave on: counters, a few running maxima, and Node's own event-loop histogram.
import { monitorEventLoopDelay } from 'node:perf_hooks';

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

const blank = () => ({
  ticks: 0, tickMs: 0, tickMaxMs: 0,      // room ticks (all rooms)
  msgsIn: 0, msgsOut: 0, bytesOut: 0,     // WebSocket traffic
  flushes: 0, flushMs: 0, flushMaxMs: 0, flushBytes: 0, // store persistence
  http: 0,
});
let w = blank();
let since = Date.now();

export const metrics = {
  tick(ms) { w.ticks++; w.tickMs += ms; if (ms > w.tickMaxMs) w.tickMaxMs = ms; },
  in() { w.msgsIn++; },
  out(n, bytes) { w.msgsOut += n; w.bytesOut += bytes * n; },
  flush(ms, bytes) { w.flushes++; w.flushMs += ms; w.flushBytes += bytes; if (ms > w.flushMaxMs) w.flushMaxMs = ms; },
  http() { w.http++; },

  /** Snapshot of the window since the last reset (rates per second). */
  snapshot({ reset = false } = {}) {
    const secs = Math.max(0.001, (Date.now() - since) / 1000);
    const mem = process.memoryUsage();
    const out = {
      windowSec: +secs.toFixed(1),
      loopLagMs: { p50: +(loop.percentile(50) / 1e6).toFixed(1), p99: +(loop.percentile(99) / 1e6).toFixed(1), max: +(loop.max / 1e6).toFixed(1) },
      ticksPerSec: +(w.ticks / secs).toFixed(1), tickAvgMs: +(w.tickMs / Math.max(1, w.ticks)).toFixed(3), tickMaxMs: +w.tickMaxMs.toFixed(2),
      msgsInPerSec: Math.round(w.msgsIn / secs), msgsOutPerSec: Math.round(w.msgsOut / secs), kbOutPerSec: Math.round(w.bytesOut / secs / 1024),
      flushes: w.flushes, flushAvgMs: +(w.flushMs / Math.max(1, w.flushes)).toFixed(1), flushMaxMs: +w.flushMaxMs.toFixed(1), flushKBPerSec: Math.round(w.flushBytes / secs / 1024),
      httpPerSec: +(w.http / secs).toFixed(1),
      rssMB: Math.round(mem.rss / 1048576), heapMB: Math.round(mem.heapUsed / 1048576),
    };
    if (reset) { w = blank(); since = Date.now(); loop.reset(); }
    return out;
  },
};
