// 游客即可进入（设计文档 2.1）：首次访问发一个匿名令牌，法名自动分配。
// 账号绑定（手机 / Google / Apple / LINE）在 P1 接入，届时令牌并入正式账号。
import crypto from 'node:crypto';
import { newId, HttpError } from './util.js';
import { dharmaName } from './names.js';
import { blankPractice, visit, appearance, rankFor } from './practice.js';

const MOODS = new Set(['anxious', 'tired', 'missing', 'seeking', 'browsing']);
const tokenKey = (t) => crypto.createHash('sha256').update(t).digest('base64url');

export class UserService {
  constructor({ store, locale }) { this.store = store; this.locale = locale; }

  /** Restore a session or create a guest. Returns { token, user }. */
  session(token) {
    if (token) {
      const ref = this.store.get('tokens', tokenKey(token));
      const user = ref && this.store.get('users', ref.userId);
      if (user) {
        const v = visit(user.practice);
        this.store.put('users', user.id, user);
        return { token, user, returned: v };
      }
    }
    const id = newId(9);
    const fresh = newId(24);
    const user = { id, name: dharmaName(this.locale), createdAt: Date.now(), mood: null, practice: blankPractice() };
    visit(user.practice);
    this.store.put('users', id, user);
    this.store.put('tokens', tokenKey(fresh), { userId: id, createdAt: Date.now() });
    return { token: fresh, user, returned: { repaired: false, gapDays: 0 } };
  }

  byToken(token) {
    if (!token) return null;
    const ref = this.store.get('tokens', tokenKey(token));
    return ref ? this.store.get('users', ref.userId) : null;
  }

  require(token) {
    const u = this.byToken(token);
    if (!u) throw new HttpError(401, 'session_required');
    return u;
  }

  setMood(user, mood) {
    if (!MOODS.has(mood)) throw new HttpError(422, 'invalid_mood');
    user.mood = mood;
    this.store.put('users', user.id, user);
  }

  save(user) { this.store.put('users', user.id, user); }

  publicView(user) {
    const p = user.practice;
    return {
      id: user.id, name: user.name, mood: user.mood,
      merit: p.merit, minutes: Math.floor(p.minutes), streak: p.streak,
      rank: rankFor(p.minutes).id, look: appearance(user.id, p), firstSeen: user.createdAt,
    };
  }
}
