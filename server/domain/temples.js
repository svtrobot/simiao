// 代理开庙 SaaS（设计文档第五章）：选模板 + 换皮肤 + 配道具，审核后上线。
import { newId, HttpError } from './util.js';
import { claimsReligiousVenue, marketingViolations } from './compliance.js';

export const TIERS = {
  starter:  { roomCapacity: 50,  halls: 1,  autoscale: false, share: 0.5 },
  standard: { roomCapacity: 100, halls: 3,  autoscale: true,  share: 0.7 },
  flagship: { roomCapacity: 100, halls: 99, autoscale: true,  share: 0.8 },
};
export const ORG_TYPES = new Set(['temple', 'memorial', 'tourism', 'culture', 'family']);

const OFFICIAL = {
  id: 'main', slug: 'main', type: 'official', orgType: 'temple', tier: 'flagship', certified: true,
  name: { 'zh-Hant': '雲上寺', 'zh-Hans': '云上寺' }, plaque: '雲上寺',
  sceneId: 'tw-main-hall', mode: 'ritual', visibility: 'public', status: 'live',
};

export class TempleService {
  constructor({ store, scenes, regionPolicy, region }) {
    this.store = store; this.scenes = scenes; this.policy = regionPolicy; this.region = region;
    if (!store.get('temples', OFFICIAL.id)) store.put('temples', OFFICIAL.id, { ...OFFICIAL, createdAt: Date.now() });
  }

  get(slug) { return this.store.get('temples', slug); }

  listPublic() {
    return this.store.list('temples', (t) => t.status === 'live' && t.visibility === 'public')
      .filter((t) => this.scenes.get(t.sceneId)?.regions.includes(this.region));
  }

  tier(t) { return TIERS[t.tier] || TIERS.starter; }

  apply(input) {
    if (!this.policy.selfServiceTemples) throw new HttpError(403, 'self_service_disabled_in_region');
    const a = {
      applicant: String(input.applicant || '').trim().slice(0, 40),
      contact: String(input.contact || '').trim().slice(0, 80),
      orgType: input.orgType,
      name: String(input.name || '').trim().slice(0, 24),
      sceneId: input.sceneId,
      tier: input.tier || 'starter',
      certificateRef: String(input.certificateRef || '').trim().slice(0, 200),
      intro: String(input.intro || '').trim().slice(0, 300),
    };
    const issues = [];
    if (!a.applicant || !a.contact) issues.push('applicant_and_contact_required');
    if (!ORG_TYPES.has(a.orgType)) issues.push('invalid_org_type');
    if (a.name.length < 2) issues.push('name_too_short');
    if (!TIERS[a.tier]) issues.push('invalid_tier');
    const scene = this.scenes.get(a.sceneId);
    if (!scene || !scene.regions.includes(this.region)) issues.push('scene_unavailable');
    // 自称“寺院 / 道观 / 神社”必须提供宗教活动场所登记证，否则只能以“文化空间”名义开设（5.4）
    if (claimsReligiousVenue(a.name) && !(a.orgType === 'temple' && a.certificateRef)) issues.push('venue_name_requires_certificate');
    if (marketingViolations(a.name + a.intro).length) issues.push('prohibited_marketing_language');
    if (issues.length) throw new HttpError(422, 'application_invalid', { issues });

    const id = newId(8);
    const doc = { id, ...a, status: 'pending', createdAt: Date.now(), reviewNote: '' };
    this.store.put('applications', id, doc);
    return { id, status: doc.status };
  }

  applications(status) {
    return this.store.list('applications', (x) => !status || x.status === status).sort((a, b) => b.createdAt - a.createdAt);
  }

  decide(id, { approve, note = '', slug }) {
    const app = this.store.get('applications', id);
    if (!app) throw new HttpError(404, 'not_found');
    if (app.status !== 'pending') throw new HttpError(409, 'already_decided');
    app.status = approve ? 'approved' : 'rejected';
    app.reviewNote = String(note).slice(0, 300);
    app.decidedAt = Date.now();
    let temple = null;
    if (approve) {
      const s = (slug || '').toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(s)) throw new HttpError(422, 'invalid_slug');
      if (this.store.get('temples', s)) throw new HttpError(409, 'slug_taken');
      const certified = app.orgType === 'temple' && !!app.certificateRef;
      temple = {
        id: s, slug: s, type: 'tenant', orgType: app.orgType, tier: app.tier, certified,
        // 未认证的机构只能以“文化空间”名义开设
        label: certified ? 'certified' : app.orgType === 'temple' ? 'culture_space' : app.orgType,
        name: { 'zh-Hant': app.name, 'zh-Hans': app.name }, plaque: app.name,
        sceneId: app.sceneId, mode: 'ritual', visibility: app.orgType === 'family' ? 'invite' : 'public',
        status: 'live', applicationId: id, createdAt: Date.now(),
      };
      this.store.put('temples', s, temple);
      app.templeSlug = s;
    }
    this.store.put('applications', id, app);
    return { application: app, temple };
  }
}
