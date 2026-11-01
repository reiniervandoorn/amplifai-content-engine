// The AmplifAI quality check. All content is held against the product rules before the tool gets it.
// "error" breaks a rule (selling, a delivery promise, a number without a source, wrong form of address);
// "warn" is a matter of polish (too long, a repeated tip). In live mode errors are rewritten automatically.
// Keep this in step with RULES in settings.js and the product rules in CLAUDE.md.

const SELL = /\b(koop|kopen|bestel nu|nu bestellen|korting|kortingscode|aanbieding|actieprijs|in de uitverkoop|buy now|buy|order now|discount|coupon|on sale|special offer|kauf|rabatt|achetez|promo)\b/i;
const DELIVERY = /\b(morgen in huis|morgen bezorgd|vandaag verzonden|binnen \d+ (werk)?dagen|uiterlijk (maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)|arrives? (on|by|tomorrow)|delivered (by|tomorrow|on)|within \d+ (business )?days)\b/i;
const RETURNS = /\b(niet (terug|retour)sturen|retourneren (kost|is lastig)|houd hem maar|don'?t return|avoid returning|no returns)\b/i;
const NUMBER = /\b(1[89]\d{2}|20\d{2})\b|\d+([.,]\d+)?\s?(%|procent|percent|km|mm|cm|kg|g\b|gram|watt|w\b|°c|graden|uur|hours?|minuten|minutes|jaar|years|keer|times)/i;
const FORMAL_IN_INFORMAL = /\b(u|uw)\b/;          // nl, case-sensitive: "U" starts sentences too, so only lower case
const INFORMAL_IN_FORMAL = /\b(je|jij|jou|jouw|Je|Jij|Jouw)\b/;

const LIMITS = { title: 60, headline: 70, lead: 90, story: 300, text: 260, line: 160 };

// every { lang: text } object in the content, with the path to the piece it belongs to
function* texts(node, langs, path = '') {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node) && langs.every(l => typeof node[l] === 'string')) { yield { path, piece: pieceOf(path), t: node }; return }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'src') continue;
    yield* texts(v, langs, path ? `${path}.${k}` : k);
  }
}
// the piece a text belongs to, the same paths a change can be asked for: "tips.new.0.title" → "tips.new.0"
export function pieceOf(p) {
  const k = p.split('.');
  if (k[0] === 'tips' && k.length >= 3) return k.slice(0, 3).join('.');
  if (k[0] === 'question' && k[1] === 'options' && k.length >= 3) return k.slice(0, 3).join('.');
  if (['special', 'care', 'expect'].includes(k[0]) && k.length >= 2) return k.slice(0, 2).join('.');
  if (['whileYouWait', 'firstMinutes'].includes(k[0]) && k[1] === 'items' && k.length >= 3) return k.slice(0, 3).join('.');
  return k[0];
}
const srcOf = (c, piece) => piece.split('.').reduce((x, k) => x?.[k], c)?.src;
// how-to advice may go without a source; a number in it still needs one
const ADVICE = /^(tips|care|whileYouWait|firstMinutes)\./;

export function checkContent(c, s) {
  if (!c || typeof c !== 'object') return { ok: false, errors: 1, warnings: 0, issues: [{ piece: '', level: 'error', code: 'missing', message: 'Geen inhoud' }] };
  const langs = s.languages, issues = [];
  const add = (piece, level, code, message) => { if (!issues.some(i => i.piece === piece && i.code === code)) issues.push({ piece, level, code, message }) };

  for (const { path, piece, t } of texts(c, langs)) {
    for (const l of langs) {
      const v = t[l] || '';
      if (!v.trim() && !/note$/.test(path)) add(piece, 'error', 'missing', `Tekst ontbreekt (${l.toUpperCase()})`);
      if (SELL.test(v)) add(piece, 'error', 'sell', 'Klinkt als verkopen; de gids verkoopt nooit');
      if (DELIVERY.test(v)) add(piece, 'error', 'delivery', 'Belooft een bezorgmoment');
      if (RETURNS.test(v)) add(piece, 'error', 'returns', 'Ontmoedigt retourneren');
      if (l === 'nl' && s.formality === 'formal' && INFORMAL_IN_FORMAL.test(v)) add(piece, 'error', 'form', 'Gebruikt je/jouw terwijl de shop u/uw wil');
      if (l === 'nl' && s.formality !== 'formal' && FORMAL_IN_INFORMAL.test(v)) add(piece, 'error', 'form', 'Gebruikt u/uw terwijl de shop je/jouw wil');
    }
    const v = t[langs[0]] || '', last = path.split('.').pop();
    const lim = path === 'intro.headline' ? LIMITS.headline : path === 'intro.title' ? LIMITS.title : path === 'story.text' ? LIMITS.story
      : ['lead', 'title', 'headline'].includes(last) ? LIMITS.lead : /lines/.test(path) ? LIMITS.line : LIMITS.text;
    if (v.length > lim) add(piece, 'warn', 'long', `Te lang (${v.length} tekens, richtlijn ${lim})`);
    if (path === 'intro.headline' && v.split(/\s+/).length > 8) add(piece, 'warn', 'headline', 'Kopregel langer dan 8 woorden');
    // numbers and years need a source, except in short labels
    if (NUMBER.test(v) && !/(label|note|eyebrow|^experience|^intro|^shortName)/.test(path)) {
      const src = srcOf(c, piece);
      if (Array.isArray(src) && !src.length && !ADVICE.test(piece)) add(piece, 'error', 'source', 'Bevat een getal zonder bron');
    }
  }

  // structure: counts follow the settings, every answer has its tip
  if (c.expect?.length !== s.expectCount) add('expect', 'warn', 'count', `${c.expect?.length || 0} punten bij "wat is normaal", ingesteld op ${s.expectCount}`);
  for (const lv of ['new', 'regular', 'expert']) if ((c.tips?.[lv]?.length || 0) < s.tipCount) add('tips', 'warn', 'count', `Minder tips dan ingesteld bij ${lv}`);
  const opts = c.question?.options || [];
  if (opts.length !== s.answerCount) add('question', 'warn', 'count', `${opts.length} antwoorden, ingesteld op ${s.answerCount}`);
  opts.forEach((o, i) => { if (!o.tip) add(`question.options.${i}`, 'error', 'answer', `Geen tip bij antwoord "${o.key}"`) });
  if (new Set(opts.map(o => o.key)).size !== opts.length) add('question', 'error', 'keys', 'Twee antwoorden hebben dezelfde key');
  const titles = new Map();
  const seen = (piece, t) => {
    const k = (t?.[langs[0]] || '').toLowerCase().trim();
    if (!k) return;
    if (titles.has(k)) add(piece, 'warn', 'repeat', `Zelfde tip als ${titles.get(k)}`); else titles.set(k, piece);
  };
  (c.care || []).forEach((t, i) => seen(`care.${i}`, t.title));
  for (const lv of ['new', 'regular', 'expert']) (c.tips?.[lv] || []).forEach((t, i) => seen(`tips.${lv}.${i}`, t.title));

  const errors = issues.filter(i => i.level === 'error').length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues };
}

// what to tell the writer when it rewrites an item that failed the check
export const repairWish = list => 'Fix these problems: ' + list.map(i => ({
  sell: 'it sounds like selling; give help, never push a purchase', delivery: 'it promises a delivery time; remove that',
  returns: 'it discourages returns; never do that', form: 'use the form of address the shop chose, consistently',
  source: 'it states a number without a source; cite a fact id or drop the number', missing: 'a language is missing',
  long: 'it is too long; make it shorter', headline: 'the headline must be 8 words or fewer', answer: 'every answer needs its own tip',
}[i.code] || i.message)).join('; ') + '.';
