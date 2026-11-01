// The AmplifAI quality check. All content is held against these checks before the tool gets it.
// "error" breaks a rule (selling, a delivery promise, a number without a source, wrong form of address);
// "warn" is a matter of polish (too long, a repeated tip). In live mode errors are rewritten automatically.
// AmplifAI sets each check to error, warn or off, and edits the word lists and lengths, on the admin page.

// Every check, what it looks for, and how serious it is by default.
export const CHECKS = {
  missing:  { level: 'error', label: 'Tekst ontbreekt', about: 'Een tekst is leeg in een van de talen.' },
  sell:     { level: 'error', label: 'Verkopen', about: 'Een woord uit de lijst "klinkt als verkopen". De gids verkoopt nooit.' },
  delivery: { level: 'error', label: 'Bezorgbelofte', about: 'Een woord uit de lijst "belooft een bezorgmoment".' },
  returns:  { level: 'error', label: 'Retour ontmoedigen', about: 'Een woord uit de lijst "ontmoedigt retourneren".' },
  form:     { level: 'error', label: 'Aanspreekvorm', about: 'Nederlands: je/jouw terwijl de shop u wil, of u/uw terwijl de shop je wil.' },
  source:   { level: 'error', label: 'Getal zonder bron', about: 'Een getal, jaartal, maat of percentage in een tekst die geen bron noemt. Praktische tips mogen zonder bron.' },
  answer:   { level: 'error', label: 'Antwoord zonder tip', about: 'Een antwoord op de vraag heeft geen tip.' },
  keys:     { level: 'error', label: 'Dubbel antwoord', about: 'Twee antwoorden hebben dezelfde key.' },
  long:     { level: 'warn', label: 'Te lang', about: 'Een tekst is langer dan de richtlijn (zie lengtes).' },
  headline: { level: 'warn', label: 'Kopregel te lang', about: 'De kopregel heeft meer woorden dan ingesteld bij Schrijven.' },
  count:    { level: 'warn', label: 'Aantal klopt niet', about: 'Er zijn meer of minder punten dan de instellingen vragen.' },
  repeat:   { level: 'warn', label: 'Herhaalde tip', about: 'Twee tips of onderhoudspunten hebben dezelfde titel.' },
};
export const SELL_WORDS = ['koop', 'kopen', 'bestel nu', 'nu bestellen', 'korting', 'kortingscode', 'aanbieding', 'actieprijs', 'in de uitverkoop',
  'buy now', 'buy', 'order now', 'discount', 'coupon', 'on sale', 'special offer', 'kauf', 'rabatt', 'achetez', 'promo'];
export const DELIVERY_WORDS = ['morgen in huis', 'morgen bezorgd', 'vandaag verzonden', 'binnen # dagen', 'binnen # werkdagen',
  'uiterlijk maandag', 'uiterlijk dinsdag', 'uiterlijk woensdag', 'uiterlijk donderdag', 'uiterlijk vrijdag', 'uiterlijk zaterdag', 'uiterlijk zondag',
  'arrives on', 'arrives by', 'arrives tomorrow', 'arrive on', 'arrive by', 'arrive tomorrow', 'delivered by', 'delivered tomorrow', 'delivered on',
  'within # days', 'within # business days'];
export const RETURNS_WORDS = ['niet terugsturen', 'niet retoursturen', 'retourneren kost', 'retourneren is lastig', 'houd hem maar', "don't return", 'dont return', 'avoid returning', 'no returns'];

// a word list as one pattern: whole words, # for a number, any apostrophe
const patterns = new Map();
function wordsPattern(list) {
  const k = list.join('\n');
  if (!patterns.has(k)) {
    const parts = list.map(w => w.trim()).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/#/g, '\\d+').replace(/'/g, "['’]?").replace(/\s+/g, '\\s+'));
    patterns.set(k, parts.length ? new RegExp(`(?<![\\p{L}\\d])(${parts.join('|')})(?![\\p{L}\\d])`, 'iu') : null);
  }
  return patterns.get(k);
}

const NUMBER = /\b(1[89]\d{2}|20\d{2})\b|\d+([.,]\d+)?\s?(%|procent|percent|km|mm|cm|kg|g\b|gram|watt|w\b|°c|graden|uur|hours?|minuten|minutes|jaar|years|keer|times)/i;
const FORMAL_IN_INFORMAL = /\b(u|uw)\b/;          // nl, case-sensitive: "U" starts sentences too, so only lower case
const INFORMAL_IN_FORMAL = /\b(je|jij|jou|jouw|Je|Jij|Jouw)\b/;


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
  const level = code => s.checks?.[code] || CHECKS[code].level;
  if (!c || typeof c !== 'object') return { ok: false, errors: 1, warnings: 0, issues: [{ piece: '', level: 'error', code: 'missing', message: 'Geen inhoud' }] };
  const langs = s.languages, issues = [];
  const add = (piece, code, message) => {
    const lv = level(code);
    if (lv !== 'off' && !issues.some(i => i.piece === piece && i.code === code)) issues.push({ piece, level: lv, code, message });
  };
  const SELL = wordsPattern(s.sellWords || SELL_WORDS), DELIVERY = wordsPattern(s.deliveryWords || DELIVERY_WORDS), RETURNS = wordsPattern(s.returnsWords || RETURNS_WORDS);
  const max = { headline: s.maxHeadline || 70, title: s.maxTitle || 60, lead: s.maxLead || 90, story: s.maxStory || 300, text: s.maxText || 260, line: s.maxLine || 160 };

  for (const { path, piece, t } of texts(c, langs)) {
    for (const l of langs) {
      const v = t[l] || '';
      if (!v.trim() && !/note$/.test(path)) add(piece, 'missing', `Tekst ontbreekt (${l.toUpperCase()})`);
      const hit = re => re && v.match(re)?.[0];
      if (hit(SELL)) add(piece, 'sell', `Klinkt als verkopen ("${hit(SELL)}"); de gids verkoopt nooit`);
      if (hit(DELIVERY)) add(piece, 'delivery', `Belooft een bezorgmoment ("${hit(DELIVERY)}")`);
      if (hit(RETURNS)) add(piece, 'returns', `Ontmoedigt retourneren ("${hit(RETURNS)}")`);
      if (l === 'nl' && s.formality === 'formal' && INFORMAL_IN_FORMAL.test(v)) add(piece, 'form', 'Gebruikt je/jouw terwijl de shop u/uw wil');
      if (l === 'nl' && s.formality !== 'formal' && FORMAL_IN_INFORMAL.test(v)) add(piece, 'form', 'Gebruikt u/uw terwijl de shop je/jouw wil');
    }
    const v = t[langs[0]] || '', last = path.split('.').pop();
    const lim = path === 'intro.headline' ? max.headline : path === 'intro.title' ? max.title : path === 'story.text' ? max.story
      : ['lead', 'title', 'headline'].includes(last) ? max.lead : /lines/.test(path) ? max.line : max.text;
    if (v.length > lim) add(piece, 'long', `Te lang (${v.length} tekens, richtlijn ${lim})`);
    const words = s.headlineWords || 8;
    if (path === 'intro.headline' && v.split(/\s+/).length > words) add(piece, 'headline', `Kopregel langer dan ${words} woorden`);
    // numbers and years need a source, except in short labels
    if (NUMBER.test(v) && !/(label|note|eyebrow|^experience|^intro|^shortName)/.test(path)) {
      const src = srcOf(c, piece);
      if (Array.isArray(src) && !src.length && !ADVICE.test(piece)) add(piece, 'source', 'Bevat een getal zonder bron');
    }
  }

  // structure: counts follow the settings, every answer has its tip
  if (s.specialCount && c.special?.length !== s.specialCount) add('special', 'count', `${c.special?.length || 0} punten bij "bijzonder", ingesteld op ${s.specialCount}`);
  if (s.careCount && c.care?.length !== s.careCount) add('care', 'count', `${c.care?.length || 0} punten bij onderhoud, ingesteld op ${s.careCount}`);
  if (c.expect?.length !== s.expectCount) add('expect', 'count', `${c.expect?.length || 0} punten bij "wat is normaal", ingesteld op ${s.expectCount}`);
  for (const lv of ['new', 'regular', 'expert']) if ((c.tips?.[lv]?.length || 0) < s.tipCount) add('tips', 'count', `Minder tips dan ingesteld bij ${lv}`);
  const opts = c.question?.options || [];
  if (opts.length !== s.answerCount) add('question', 'count', `${opts.length} antwoorden, ingesteld op ${s.answerCount}`);
  opts.forEach((o, i) => { if (!o.tip) add(`question.options.${i}`, 'answer', `Geen tip bij antwoord "${o.key}"`) });
  if (new Set(opts.map(o => o.key)).size !== opts.length) add('question', 'keys', 'Twee antwoorden hebben dezelfde key');
  const titles = new Map();
  const seen = (piece, t) => {
    const k = (t?.[langs[0]] || '').toLowerCase().trim();
    if (!k) return;
    if (titles.has(k)) add(piece, 'repeat', `Zelfde tip als ${titles.get(k)}`); else titles.set(k, piece);
  };
  (c.care || []).forEach((t, i) => seen(`care.${i}`, t.title));
  for (const lv of ['new', 'regular', 'expert']) (c.tips?.[lv] || []).forEach((t, i) => seen(`tips.${lv}.${i}`, t.title));

  const errors = issues.filter(i => i.level === 'error').length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues };
}

// what to tell the writer when it rewrites an item that failed the check
export const repairWish = list => 'Fix these problems: ' + list.map(i => ({
  sell: 'it sounds like selling (' + i.message + '); give help, never push a purchase', delivery: 'it promises a delivery time; remove that',
  returns: 'it discourages returns; never do that', form: 'use the form of address the shop chose, consistently',
  source: 'it states a number without a source; cite a fact id or drop the number', missing: 'a language is missing',
  long: 'it is too long; make it shorter', headline: 'the headline is too long; make it shorter', answer: 'every answer needs its own tip',
}[i.code] || i.message)).join('; ') + '.';
