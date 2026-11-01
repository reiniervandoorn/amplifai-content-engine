// The AmplifAI quality check. Every guide is held against the product rules before anyone sees it.
// "error" breaks a rule (selling, a delivery promise, a number without a source, wrong form of address);
// "warn" is a matter of polish (too long, a repeated tip). In live mode errors are rewritten automatically.

const SELL = /\b(koop|kopen|bestel nu|nu bestellen|korting|kortingscode|aanbieding|actieprijs|in de uitverkoop|buy now|buy|order now|discount|coupon|on sale|special offer|kauf|rabatt|achetez|promo)\b/i;
const DELIVERY = /\b(morgen in huis|morgen bezorgd|vandaag verzonden|binnen \d+ (werk)?dagen|uiterlijk (maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)|arrives? (on|by|tomorrow)|delivered (by|tomorrow|on)|within \d+ (business )?days)\b/i;
const RETURNS = /\b(niet (terug|retour)sturen|retourneren (kost|is lastig)|houd hem maar|don'?t return|avoid returning|no returns)\b/i;
const NUMBER = /\b(1[89]\d{2}|20\d{2})\b|\d+([.,]\d+)?\s?(%|procent|percent|km|mm|cm|kg|g\b|gram|watt|w\b|°c|graden|uur|hours?|minuten|minutes|jaar|years|keer|times)/i;
const FORMAL_IN_INFORMAL = /\b(u|uw)\b/;          // nl, case-sensitive: "U" starts sentences too, so only lower case
const INFORMAL_IN_FORMAL = /\b(je|jij|jou|jouw|Je|Jij|Jouw)\b/;

const LIMITS = { title: 60, hook: 70, lead: 90, story: 300, text: 260, line: 160 };

// every { lang: text } object in the guide, with the path to the item it belongs to
function* texts(node, langs, path = '', item = '') {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node) && langs.every(l => typeof node[l] === 'string')) { yield { path, item, t: node }; return }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'src') continue;
    const p = path ? `${path}.${k}` : k;
    const it = item || itemPath(p);
    yield* texts(v, langs, p, it);
  }
}
// the editable item a text belongs to: "tips.new.0.title" → "tips.new.0"
function itemPath(p) {
  const k = p.split('.');
  if (['tips'].includes(k[0]) && k.length >= 3) return k.slice(0, 3).join('.');
  if (['expect', 'answerTips'].includes(k[0]) && k.length >= 2) return k.slice(0, 2).join('.');
  if (['shipped', 'delivered'].includes(k[0]) && k[1] === 'items' && k.length >= 3) return k.slice(0, 3).join('.');
  return k[0];
}
const srcOf = (g, item) => item.split('.').reduce((x, k) => x?.[k], g)?.src;

export function checkGuide(g, s) {
  if (!g) return { ok: false, issues: [], checkedAt: new Date().toISOString() };
  const langs = s.languages, issues = [];
  const add = (item, level, code, msg) => { if (!issues.some(i => i.item === item && i.code === code)) issues.push({ item, level, code, msg }) };

  for (const { path, item, t } of texts(g, langs)) {
    for (const l of langs) {
      const v = t[l] || '';
      if (!v.trim() && !/note$/.test(path)) add(item, 'error', 'missing', `Tekst ontbreekt (${l.toUpperCase()})`);
      if (SELL.test(v)) add(item, 'error', 'sell', 'Klinkt als verkopen; de gids verkoopt nooit');
      if (DELIVERY.test(v)) add(item, 'error', 'delivery', 'Belooft een bezorgmoment');
      if (RETURNS.test(v)) add(item, 'error', 'returns', 'Ontmoedigt retourneren');
      if (l === 'nl' && s.formality === 'formal' && INFORMAL_IN_FORMAL.test(v)) add(item, 'error', 'form', 'Gebruikt je/jouw terwijl de shop u/uw wil');
      if (l === 'nl' && s.formality !== 'formal' && FORMAL_IN_INFORMAL.test(v)) add(item, 'error', 'form', 'Gebruikt u/uw terwijl de shop je/jouw wil');
    }
    const v = t[langs[0]] || '', last = path.split('.').pop();
    const lim = path === 'hook' ? LIMITS.hook : path === 'title' ? LIMITS.title : path === 'story.text' ? LIMITS.story : last === 'lead' || last === 'title' || last === 'h' ? LIMITS.lead : /lines/.test(path) ? LIMITS.line : LIMITS.text;
    if (v.length > lim) add(item, 'warn', 'long', `Te lang (${v.length} tekens, richtlijn ${lim})`);
    if (path === 'hook' && v.split(/\s+/).length > 8) add(item, 'warn', 'hook', 'Openingszin langer dan 8 woorden');
    // numbers and years need a source, except in the customer-facing labels
    if (NUMBER.test(v) && !/(label|note|title$|^lq|^card|^short)/.test(path)) {
      const src = srcOf(g, item);
      if (Array.isArray(src) && !src.length && !/^(tips|answerTips|shipped|delivered)/.test(item)) add(item, 'error', 'source', 'Bevat een getal zonder bron');
    }
  }

  // structure: counts follow the settings, answers and their tips belong together
  if (g.expect?.length !== s.expectCount) add('expect', 'warn', 'count', `${g.expect?.length} verwachtingen, ingesteld op ${s.expectCount}`);
  for (const lv of ['new', 'reg', 'pro']) if ((g.tips?.[lv]?.length || 0) < s.tipCount) add('tips', 'warn', 'count', `Minder tips dan ingesteld bij ${lv}`);
  const vs = (g.q?.options || []).map(o => o.v);
  if (vs.length !== s.answerCount) add('q', 'warn', 'count', `${vs.length} antwoorden, ingesteld op ${s.answerCount}`);
  for (const v of vs) if (!g.answerTips?.some(a => a.v === v)) add('answerTips', 'error', 'answer', `Geen tip voor antwoord "${v}"`);
  const titles = new Map();
  for (const lv of ['new', 'reg', 'pro']) (g.tips?.[lv] || []).forEach((t, i) => {
    const k = (t.title?.[langs[0]] || '').toLowerCase().trim();
    if (titles.has(k)) add(`tips.${lv}.${i}`, 'warn', 'repeat', `Zelfde tip als ${titles.get(k)}`); else titles.set(k, `tips.${lv}.${i}`);
  });

  const errors = issues.filter(i => i.level === 'error').length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues, checkedAt: new Date().toISOString() };
}

// what to tell the writer when it rewrites an item that failed the check
export const repairWish = list => 'Fix these problems: ' + list.map(i => ({
  sell: 'it sounds like selling; give help, never push a purchase', delivery: 'it promises a delivery time; remove that',
  returns: 'it discourages returns; never do that', form: 'use the form of address the shop chose, consistently',
  source: 'it states a number without a source; cite a fact id or drop the number', missing: 'a language is missing',
  long: 'it is too long; make it shorter', hook: 'the hook must be 8 words or fewer', answer: 'every answer needs its own tip',
}[i.code] || i.msg)).join('; ') + '.';
