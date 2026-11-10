// Runtime configuration. Everything region-specific is a parameter (design doc 6.4 / 6.5):
// a mainland deployment is a new environment with REGION=cn, not a code fork.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const REGIONS = {
  tw: { tz: 'Asia/Taipei', locale: 'zh-Hant', ritualsAllowed: true, selfServiceTemples: true,
        hotline: { name: '衛福部安心專線', phone: '1925' } },
  overseas: { tz: 'UTC', locale: 'zh-Hant', ritualsAllowed: true, selfServiceTemples: true,
        hotline: { name: '當地心理援助熱線', phone: 'https://findahelpline.com' } },
  // 《互联网宗教信息服务管理办法》第17、18条：大陆版只开文化游览/冥想/祭扫，不开个人“开庙”
  cn: { tz: 'Asia/Shanghai', locale: 'zh-Hans', ritualsAllowed: false, selfServiceTemples: false,
        hotline: { name: '全国心理援助热线', phone: '400-161-9995' } },
};

const region = (env.REGION || 'tw').toLowerCase();
if (!REGIONS[region]) throw new Error(`Unknown REGION "${region}" (use tw | overseas | cn)`);

export const config = {
  root: ROOT,
  port: Number(env.PORT || 8787),
  host: env.HOST || '0.0.0.0',
  region,
  regionPolicy: REGIONS[region],
  dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
  clientDir: path.join(ROOT, 'client'),
  adminDir: path.join(ROOT, 'admin'),
  scenesDir: path.join(ROOT, 'scenes'),
  contentDir: path.join(ROOT, 'content'),
  adminToken: env.ADMIN_TOKEN || '',
  // Web Push (提醒): VAPID contact, and optionally a fixed key pair (JSON {jwk, publicKey}) for several instances.
  push: {
    subject: env.PUSH_SUBJECT || (env.PUBLIC_ORIGIN || '').replace(/\/$/, '') || 'https://github.com/svtrobot/simiao',
    keys: env.VAPID_KEYS ? JSON.parse(env.VAPID_KEYS) : null,
    enabled: env.PUSH !== 'off',
  },
  // https://your.domain — passkeys are bound to this origin. Unset: the request's own Host is used.
  publicOrigin: (env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
  room: {
    capacity: Number(env.ROOM_CAPACITY || 100),
    tickHz: Number(env.TICK_HZ || 10),
    statsBroadcastMs: 5000,
    idleKickMs: 30 * 60 * 1000,
  },
  ws: { maxPayload: 16 * 1024, pingMs: 20000 },
};

export { REGIONS };
