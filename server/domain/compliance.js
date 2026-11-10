// 合规与心理安全（设计文档 6.5 合规模式开关、8.1–8.4）。
// 不是法律意见；规则集中在这里，方便各市场律师审阅后调整。

/** Actions that are religious ritual. In 'cultural' mode they are hidden and rejected server-side. */
export const RITUAL_ACTIONS = new Set(['incense', 'fortune', 'muyu', 'bead', 'bow', 'prostrate', 'burn']);
export const CULTURAL_ACTIONS = new Set(['walk', 'sit', 'meditate', 'greet', 'wish', 'rejoice', 'lamp', 'memorial']);

export function effectiveMode({ regionPolicy, scene, temple }) {
  if (!regionPolicy.ritualsAllowed) return 'cultural';
  if (!scene.complianceModes.includes('ritual')) return 'cultural';
  return temple.mode === 'cultural' ? 'cultural' : 'ritual';
}

export function actionAllowed(mode, action) {
  if (CULTURAL_ACTIONS.has(action)) return true;
  return mode === 'ritual' && RITUAL_ACTIONS.has(action);
}

// Names that claim to be a religious venue need a registration certificate (5.4).
const VENUE_WORDS = /(寺|廟|庙|宮|宫|觀|观|庵|祠|神社|神宮|神宫|教堂|道院|精舍|禪院|禅院)/;
export function claimsReligiousVenue(name) { return VENUE_WORDS.test(name); }

// 恐吓式 / 灵验承诺式营销（5.4、七章定价红线）
const BANNED_MARKETING = [/消災|消灾/, /改命/, /保證靈驗|保证灵验|包靈|包灵/, /不供.{0,4}(有災|有灾|倒楣|倒霉)/, /功德充值/, /轉運|转运/];
export function marketingViolations(text) {
  return BANNED_MARKETING.filter((re) => re.test(text)).map((re) => re.source);
}

// 用户心理安全（8.4）：识别到自伤念头时，回应里温和附上热线。关键词宁宽勿漏。
const CRISIS = /(自殺|自杀|輕生|轻生|想死|不想活|結束生命|结束生命|活不下去|割腕|跳樓|跳楼|燒炭|烧炭|安眠藥.{0,4}(全部|一次)|kill myself|suicide)/i;
export function crisisSignal(text) { return CRISIS.test(text); }

// UGC 基础过滤（机审第一层；人审与外部审核 API 在 P1 接入）
const BLOCK = [/https?:\/\//i, /www\./i, /加.{0,2}(line|賴|微信|wechat|vx)/i, /\b\d{8,}\b/];
export function ugcRejectReason(text) {
  if (!text || !text.trim()) return 'empty';
  if (BLOCK.some((re) => re.test(text))) return 'contact_or_link';
  if (marketingViolations(text).length) return 'marketing';
  return null;
}
