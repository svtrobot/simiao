import crypto from 'node:crypto';

/** YYYY-MM-DD in the given IANA time zone (daily quotas reset at local midnight). */
export function dayKey(tz, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now));
}

export function hourIn(tz, now = Date.now()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date(now))) % 24;
}

export const newId = (n = 12) => crypto.randomBytes(n).toString('base64url');
export const randInt = (n) => crypto.randomInt(n);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Stable 32-bit hash, used for per-user procedural details (fingerprint, glaze noise). */
export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class HttpError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
