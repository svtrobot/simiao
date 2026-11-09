// 黃曆面板（設計文檔 3.3、4.1）：農曆干支、節氣與節日、宜忌、黃道吉時、日籤、流年太歲、
// 填了生日之後的生肖 / 本命佛（儀式模式）/ 今日沖 / 生日。服務端給代碼，文字都在 i18n.js。
import { api } from './api.js';
import { t, getLocale } from './i18n.js';
import { $, toast, openPanel } from './ui.js';

const STEMS = '甲乙丙丁戊己庚辛壬癸', BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const gz = ([s, b]) => STEMS[s] + BRANCHES[b];
const zodiac = (i) => [...t('alm.zodiac')][i];
const DAY_NUM = '一二三四五六七八九十';
export function lunarDay(d) {
  if (d === 10) return '初十';
  if (d === 20) return '二十';
  if (d === 30) return '三十';
  const tens = ['初', '十', '廿'][Math.floor(d / 10)];
  return tens + DAY_NUM[(d % 10) - 1];
}
export const lunarMonth = (m, leap) => (leap ? t('alm.leap') : '') + t('alm.monthNames')[m - 1];
const seenKey = (date) => `simiao.alm.${date}`;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } } };

export function createAlmanac({ slug, templeName }) {
  let data = null;

  async function load() {
    data = await api('GET', `/api/temples/${slug}/almanac`);
    // chip: lunar date, plus a dot until today's page has been opened
    $('alm-chip-text').textContent = `${lunarMonth(data.lunar.month, data.lunar.leap)}${lunarDay(data.lunar.day)}`;
    $('alm-chip').classList.toggle('fresh', !store.get(seenKey(data.date)));
    $('alm-chip').hidden = false;
    return data;
  }

  function render() {
    const a = data;
    const [y, m, d] = a.date.split('-').map(Number);
    $('alm-solar').textContent = `${new Date(y, m - 1, d).toLocaleDateString(getLocale(), { month: 'long', day: 'numeric' })} ${t('alm.weekday', a.weekday)}`;
    $('alm-lunar').textContent = `${t('alm.year', gz(a.gz.year), zodiac(a.gz.year[1]))} ${lunarMonth(a.lunar.month, a.lunar.leap)}${lunarDay(a.lunar.day)}`;
    $('alm-gz').textContent = `${t('alm.gzLine', gz(a.gz.month), gz(a.gz.day))} · ${t('alm.dayOfficer', t('alm.officer')[a.officer])}`;
    const terms = t('alm.terms');
    $('alm-term').textContent = a.term !== null ? t('alm.termToday', terms[a.term]) : a.next ? t('alm.nextTerm', terms[a.next.term], a.next.days) : '';
    const fest = t('alm.festivals');
    $('alm-fest').replaceChildren(...a.festivals.filter((f) => fest[f]).map((f) => { const s = document.createElement('span'); s.className = 'alm-badge'; s.textContent = fest[f]; return s; }));

    if (a.daily) { $('alm-line').textContent = a.daily.text; $('alm-hint').textContent = a.daily.hint || ''; }
    $('alm-share').onclick = () => dailyImage(a);

    const items = t('alm.items');
    const tags = (list) => list.map((k) => { const s = document.createElement('span'); s.textContent = items[k]; return s; });
    $('alm-yi').replaceChildren(...tags(a.yi));
    $('alm-ji').replaceChildren(...tags(a.ji));

    // 十二時辰: 子 23–1 … the current one is outlined
    const nowBranch = Math.floor((new Date().getHours() + 1) / 2) % 12;
    $('alm-hours').replaceChildren(...a.hours.map((good, h) => {
      const li = document.createElement('li');
      li.className = `${good ? 'good' : ''}${h === nowBranch ? ' now' : ''}`;
      const from = (h * 2 + 23) % 24;
      li.innerHTML = `<b>${BRANCHES[h]}</b><small>${String(from).padStart(2, '0')}–${String((from + 2) % 24).padStart(2, '0')}</small>`;
      return li;
    }));

    const dir = t('alm.dir'), [colorName, colorHex] = t('alm.colors')[a.color];
    const facts = [
      [t('alm.wealth'), dir[a.wealth]],
      [t('alm.color'), `<i class="swatch" style="background:${colorHex}"></i>${colorName}`],
      ['', t('alm.clash', zodiac(a.clash.zodiac), dir[a.clash.sha])],
    ];
    $('alm-facts').innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    $('alm-taisui').textContent = t('alm.taisui', gz(a.gz.year), zodiac(a.taisui.branch));
    const kinds = t('alm.taisuiKinds');
    const order = ['zhi', 'chong', 'xing', 'hai', 'po']; // 值 沖 刑 害 破 — the usual reading order
    const affected = [...a.taisui.affected].sort((p, q) => order.indexOf(p.kind) - order.indexOf(q.kind));
    $('alm-taisui-list').textContent = `${affected.map((x) => `${kinds[x.kind]}：${zodiac(x.zodiac)}`).join(' · ')}。${t('alm.taisuiNote')}`;

    renderMine();
  }

  function renderMine() {
    const me = data.me;
    const box = $('alm-me');
    box.replaceChildren();
    $('alm-form').hidden = true;
    if (!me) return;
    const p = (cls, text) => { const el = document.createElement('p'); el.className = cls; el.textContent = text; box.append(el); return el; };
    if (me.streak > 1) p('fineprint', t('alm.streak', me.streak));
    if (!me.hasBirthday) { showForm(); return; }
    const z = zodiac(me.zodiac);
    if (me.birthdayToday) p('alm-bday', t('alm.birthdayToday'));
    p('alm-my', t('alm.myZodiac', z));
    if (me.guardian) {
      const [name, desc] = t('alm.guardians')[me.guardian];
      const card = document.createElement('div'); card.className = 'alm-guardian';
      card.innerHTML = '<small></small><b></b><span></span>';
      card.querySelector('small').textContent = t('alm.guardianTitle');
      card.querySelector('b').textContent = name;
      card.querySelector('span').textContent = desc;
      box.append(card);
    }
    p('panel-tip', me.taisui ? t('alm.taisuiMine', z, t('alm.taisuiKinds')[me.taisui]) : t('alm.taisuiNone', z));
    if (me.clashToday) p('panel-tip', t('alm.clashMine'));
    const row = document.createElement('div'); row.className = 'row';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn-ghost small'; edit.textContent = t('alm.edit');
    edit.onclick = showForm;
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn-ghost small'; clear.textContent = t('alm.clear');
    clear.onclick = async () => { try { await api('DELETE', '/api/me/birthday'); await load(); render(); } catch { toast(t('err.generic')); } };
    row.append(edit, clear); box.append(row);
  }

  function fillDays() {
    const lunar = $('alm-is-lunar').checked;
    const keep = $('alm-d').value;
    const max = lunar ? 30 : 31;
    $('alm-d').replaceChildren(...Array.from({ length: max }, (_, i) => new Option(lunar ? lunarDay(i + 1) : `${i + 1} 日`, String(i + 1))));
    if (keep && +keep <= max) $('alm-d').value = keep;
    const km = $('alm-m').value;
    $('alm-m').replaceChildren(...Array.from({ length: 12 }, (_, i) => new Option(lunar ? t('alm.monthNames')[i] : `${i + 1} 月`, String(i + 1))));
    if (km) $('alm-m').value = km;
    $('alm-leap-row').hidden = !lunar;
  }

  function showForm() {
    $('alm-form').hidden = false;
    $('alm-y').max = String(new Date().getFullYear());
    fillDays();
    $('alm-is-lunar').onchange = fillDays;
    $('alm-form').onsubmit = async (e) => {
      e.preventDefault();
      const date = `${$('alm-y').value}-${String($('alm-m').value).padStart(2, '0')}-${String($('alm-d').value).padStart(2, '0')}`;
      try {
        await api('POST', '/api/me/birthday', { date, lunar: $('alm-is-lunar').checked, leap: $('alm-is-leap').checked });
        await load(); render();
      } catch (err) { toast(err.body?.error === 'invalid_date' ? t('alm.badDate') : t('err.generic')); }
    };
  }

  /** 日籤圖：豎版，配今天的農曆日期。 */
  function dailyImage(a) {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 1920); grd.addColorStop(0, '#efe7da'); grd.addColorStop(1, '#ddd0bb');
    g.fillStyle = grd; g.fillRect(0, 0, 1080, 1920);
    g.strokeStyle = '#8a6a3a'; g.lineWidth = 4; g.strokeRect(70, 70, 940, 1780);
    g.textAlign = 'center'; g.fillStyle = '#7a2e22';
    g.font = '600 56px "Noto Serif TC","Songti TC",serif';
    g.fillText(`${lunarMonth(a.lunar.month, a.lunar.leap)}${lunarDay(a.lunar.day)}`, 540, 230);
    g.fillStyle = '#5a4a3a'; g.font = '400 36px "Noto Serif TC","Songti TC",serif';
    g.fillText(`${gz(a.gz.year)}年 · ${a.date.replace(/-/g, '.')}`, 540, 300);
    // the line, vertical, right to left
    g.fillStyle = '#2a201a'; g.font = '500 86px "Noto Serif TC","Songti TC",serif';
    const cols = a.daily.text.replace(/[，。、]/g, (p) => `${p}\n`).split('\n').filter(Boolean);
    cols.forEach((col, i) => [...col].forEach((ch, k) => g.fillText(ch, 540 + ((cols.length - 1) / 2 - i) * 140, 520 + k * 104)));
    g.fillStyle = '#5a4a3a'; g.font = '400 40px "Noto Sans TC",sans-serif';
    g.fillText(a.daily.hint || '', 540, 1560);
    g.fillStyle = '#8a7a66'; g.font = '400 34px "Noto Serif TC","Songti TC",serif';
    g.fillText(templeName, 540, 1760);
    const link = document.createElement('a'); link.download = `daily-${a.date}.png`; link.href = c.toDataURL('image/png'); link.click();
  }

  async function open() {
    // always refetch: the day may have turned (region time zone), and it's one small request
    try { await load(); } catch { toast(t('err.generic')); return; }
    render();
    store.set(seenKey(data.date), '1');
    $('alm-chip').classList.remove('fresh');
    openPanel('alm-panel');
  }

  $('alm-chip').onclick = open;
  return { load, open };
}
