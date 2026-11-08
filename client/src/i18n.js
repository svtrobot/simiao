// UI strings. 首发台湾与海外华人：默认繁体；大陆部署 (REGION=cn) 用简体。
const T = {
  'zh-Hant': {
    'intro.line': '戴上耳機，慢慢吸一口氣。', 'intro.enter': '進入山門', 'intro.loading': '山門正在打開…', 'intro.noWebgl': '這台裝置無法顯示 3D 畫面，請換一個瀏覽器試試。',
    'mood.q': '今天的心情是？', 'mood.anxious': '有點焦慮', 'mood.tired': '很疲憊', 'mood.missing': '想念某人', 'mood.seeking': '有所求', 'mood.browsing': '只是看看',
    'act.gassho': '合掌', 'act.bow': '問訊', 'act.incense': '上香', 'act.fortune': '求籤', 'act.muyu': '木魚', 'act.beads': '念珠', 'act.sit': '靜坐', 'act.wish': '祈願',
    'online': (n) => `此刻 ${n} 人與你同在`, 'incense': (n) => `今日香火 ${n.toLocaleString()} 炷`,
    'hint.first': '先去香爐前，上一炷香吧', 'hint.walk': '點地面行走，拖曳轉動視角', 'hint.walking': '慢慢走過去…',
    'incense.hold': '長按點燃三炷清香', 'incense.light': '點香', 'incense.lit': '香已點燃，雙手舉香齊眉', 'incense.done': '三炷清香已插入香爐', 'incense.limit': '今日三炷清香已上完，明天再來',
    'fortune.title': '求籤', 'fortune.shake': '搖籤', 'fortune.shaking': '心裡默念想問的事，慢慢搖…', 'fortune.motion': '可以輕輕搖動手機',
    'fortune.drawn': (n) => `第 ${n} 籤落下。擲筊請示是否為這一籤。`, 'fortune.jiao': '擲筊請示',
    'jiao.sheng': '聖筊：一正一反，神明應允。', 'jiao.xiao': '笑筊：兩面皆平，再想想所問之事，重新搖籤。', 'jiao.yin': '陰筊：兩面皆凸，換個問法，重新搖籤。',
    'fortune.gentle': '三次請示，依古例取這一籤。', 'fortune.limit': '今天已求過籤了。這是今天的籤：', 'fortune.fineprint': '籤文僅供心意參考，不作任何靈驗承諾。', 'fortune.share': '存成圖片',
    'lot.no': (n) => `第 ${n} 籤`,
    'muyu.title': '敲木魚', 'muyu.sub': '每十聲記一分功德', 'beads.title': '撥念珠', 'beads.sub': (r) => `一圈 108 顆 · 已圓滿 ${r} 圈`,
    'sit.find': '走向蒲團…', 'sit.stand': '起身', 'sit.in': '吸氣', 'sit.out': '呼氣', 'sit.time': (m, s) => `已靜坐 ${m} 分 ${String(s).padStart(2, '0')} 秒`, 'sit.full': '殿內蒲團已滿，請稍候',
    'wish.title': '祈願牌', 'wish.label': '寫下你的心願（60 字以內）', 'wish.anon': '匿名掛上', 'wish.hang': '掛上祈願牌', 'wish.done': '祈願牌已掛上', 'wish.private': '這份心願我們替你好好收著，不公開懸掛。',
    'wish.support': (h) => `如果你正經歷很難熬的時刻，可以撥打${h.name} ${h.phone}，有人願意陪你說說話。`, 'wish.rejoice': '隨喜', 'wish.someone': '某位居士',
    'wish.rejected': '這段文字無法掛上（請勿留聯絡方式或連結）',
    'greet.gassho': '合掌', 'greet.bow': '頂禮', 'greet.rejoice': '隨喜', 'greet.wellwish': '願你安好',
    'greet.recv': (n, k) => `${n} 向你${{ gassho: '合掌', bow: '頂禮', rejoice: '隨喜', wellwish: '說：願你安好' }[k]}`,
    'merit.gain': (g) => `功德 +${g}`, 'rank.up': (r) => `修行精進：${r}`,
    'rank.novice': '初來居士', 'rank.resident': '常住居士', 'rank.guardian': '護法', 'rank.novice_monk': '小沙彌', 'rank.zen': '禪子',
    'stage.raw': '素坯', 'stage.bisque': '素燒', 'stage.glaze': '施釉', 'stage.kiln': '窯變', 'stage.kintsugi': '金繕',
    'me.title': '我的修行', 'me.name': '法名', 'me.rank': '階位', 'me.stage': '泥生', 'me.merit': '功德', 'me.minutes': '修行時長', 'me.streak': '連續參拜', 'me.gold': '金繕線',
    'me.note': '功德來自靜坐、禮拜與善念，買不到，也不必和誰比。', 'me.mins': (m) => `${m} 分鐘`, 'me.days': (d) => `${d} 天`,
    'returned': '好久不見。泥生身上的細裂，已用金線補好了。', 'shadow': '此前來過的人',
    'mode.cultural': '此處為文化參訪模式',
    'err.net': '連線中斷，正在重新連接…', 'err.generic': '出了點小狀況，請稍後再試',
    'ui.close': '關閉', 'label.certified': '認證寺院', 'label.culture_space': '文化空間', 'label.culture': '文化空間', 'label.memorial': '紀念館', 'label.tourism': '文旅', 'label.family': '家族祠堂',
  },
};

// 简体：只覆盖与繁体不同的文本
T['zh-Hans'] = {
  ...T['zh-Hant'],
  'intro.line': '戴上耳机，慢慢吸一口气。', 'intro.enter': '进入山门', 'intro.loading': '山门正在打开…', 'intro.noWebgl': '这台设备无法显示 3D 画面，请换一个浏览器试试。',
  'mood.q': '今天的心情是？', 'mood.anxious': '有点焦虑', 'mood.tired': '很疲惫', 'mood.missing': '想念某人', 'mood.seeking': '有所求', 'mood.browsing': '只是看看',
  'act.bow': '问讯', 'act.incense': '上香', 'act.fortune': '求签', 'act.muyu': '木鱼', 'act.beads': '念珠', 'act.sit': '静坐', 'act.wish': '祈愿',
  'online': (n) => `此刻 ${n} 人与你同在`, 'incense': (n) => `今日香火 ${n.toLocaleString()} 炷`,
  'hint.first': '先去静坐片刻吧', 'hint.walk': '点地面行走，拖拽转动视角', 'hint.walking': '慢慢走过去…',
  'sit.find': '走向蒲团…', 'sit.stand': '起身', 'sit.in': '吸气', 'sit.out': '呼气', 'sit.time': (m, s) => `已静坐 ${m} 分 ${String(s).padStart(2, '0')} 秒`, 'sit.full': '殿内蒲团已满，请稍候',
  'wish.title': '祈福牌', 'wish.label': '写下你的心愿（60 字以内）', 'wish.anon': '匿名挂上', 'wish.hang': '挂上祈福牌', 'wish.done': '祈福牌已挂上', 'wish.private': '这份心愿我们替你好好收着，不公开悬挂。',
  'wish.support': (h) => `如果你正经历很难熬的时刻，可以拨打${h.name} ${h.phone}，有人愿意陪你说说话。`, 'wish.rejoice': '随喜', 'wish.someone': '某位游客',
  'wish.rejected': '这段文字无法挂上（请勿留联系方式或链接）',
  'greet.bow': '顶礼', 'greet.rejoice': '随喜', 'greet.wellwish': '愿你安好',
  'greet.recv': (n, k) => `${n} 向你${{ gassho: '合掌', bow: '顶礼', rejoice: '随喜', wellwish: '说：愿你安好' }[k]}`,
  'merit.gain': (g) => `功德 +${g}`, 'rank.up': (r) => `修行精进：${r}`,
  'rank.novice': '初来居士', 'rank.resident': '常住居士', 'rank.guardian': '护法', 'rank.novice_monk': '小沙弥', 'rank.zen': '禅子',
  'stage.bisque': '素烧', 'stage.kiln': '窑变', 'stage.kintsugi': '金缮',
  'me.title': '我的修行', 'me.minutes': '修行时长', 'me.streak': '连续到访', 'me.gold': '金缮线', 'me.note': '功德来自静坐与善念，买不到，也不必和谁比。', 'me.mins': (m) => `${m} 分钟`,
  'returned': '好久不见。泥生身上的细裂，已用金线补好了。', 'shadow': '此前来过的人', 'mode.cultural': '此处为文化参访模式',
  'err.net': '连接中断，正在重新连接…', 'err.generic': '出了点小状况，请稍后再试', 'ui.close': '关闭',
};

let locale = 'zh-Hant';
export function setLocale(l) { if (T[l]) { locale = l; document.documentElement.lang = l; } }
export function getLocale() { return locale; }
export function t(key, ...args) {
  const v = T[locale][key] ?? T['zh-Hant'][key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}
export function localName(nameObj) {
  if (!nameObj) return '';
  return nameObj[locale] || nameObj['zh-Hant'] || Object.values(nameObj)[0];
}
