// The AmplifAI quality check. All content is held against these checks before the tool gets it.
// "error" breaks a rule (selling, a delivery promise, a number without a source, wrong form of address);
// "warn" is a matter of polish (too long, a repeated tip). In live mode errors are rewritten automatically.
// AmplifAI sets each check to error, warn or off, and edits the word lists and lengths, on the admin page.

// Every check, what it looks for, and how serious it is by default.
export const CHECKS = {
  missing:  { level: 'error', label: 'Tekst ontbreekt', about: 'Een tekst is leeg in een van de talen (een reactie op een antwoord mag in alle talen leeg zijn).' },
  sell:     { level: 'error', label: 'Verkopen', about: 'Een woord uit de lijst "klinkt als verkopen". De gids verkoopt nooit.' },
  delivery: { level: 'error', label: 'Bezorgbelofte', about: 'Een woord uit de lijst "belooft een bezorgmoment".' },
  returns:  { level: 'error', label: 'Retour ontmoedigen', about: 'Een woord uit de lijst "ontmoedigt retourneren".' },
  form:     { level: 'error', label: 'Aanspreekvorm', about: 'Nederlands: je/jouw terwijl de shop u wil, of u/uw terwijl de shop je wil.' },
  source:   { level: 'error', label: 'Getal zonder bron', about: 'Een getal, jaartal, maat of percentage in een intro of reactie die geen bron noemt. Tips mogen zonder bron.' },
  fit:      { level: 'error', label: 'Past niet in de tool', about: 'Buiten de grenzen van de gids-editor: intro tot 2000 tekens, 1 tot 5 tips van elk tot 1000, tot 3 vragen van tot 300, 2 tot 5 antwoorden van tot 200, reactie tot 500.' },
  flow:     { level: 'error', label: 'Vraagvolgorde', about: 'Een antwoord springt terug of naar een onbekende vraag, of twee vragen of antwoorden hebben dezelfde id.' },
  long:     { level: 'warn', label: 'Te lang', about: 'Een tekst is langer dan de richtlijn (zie lengtes).' },
  count:    { level: 'warn', label: 'Aantal klopt niet', about: 'Er zijn meer of minder tips, vragen of antwoorden dan de instellingen vragen.' },
  repeat:   { level: 'warn', label: 'Herhaalde tip', about: 'Dezelfde tip staat twee keer, in hetzelfde of een ander moment.' },
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


const MOMENTS = ['ordered', 'in_transit', 'delivered'];
// the tool's guide editor refuses anything outside these (guideLimits in the tool)
const TOOL = { intro: 2000, tip: 1000, question: 300, label: 200, reply: 500, tips: [1, 5], questions: [0, 3], answers: [2, 5] };

// every { lang: text } object in the content, with the path to the piece it belongs to
function* texts(node, langs, path = '') {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node) && langs.every(l => typeof node[l] === 'string')) { yield { path, piece: pieceOf(path), t: node }; return }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'src' || k === 'id' || k === 'next') continue;
    yield* texts(v, langs, path ? `${path}.${k}` : k);
  }
}
// the piece a text belongs to, the same paths a change can be asked for:
// "ordered.tips.0.text" → "ordered.tips.0", "ordered.questions.1.answers.2.reply" → "ordered.questions.1.answers.2"
export function pieceOf(p) {
  const k = p.split('.');
  if (k[1] === 'intro') return k.slice(0, 2).join('.');
  if (k[1] === 'tips') return k.slice(0, 3).join('.');
  if (k[1] === 'questions') return k[3] === 'answers' ? k.slice(0, 5).join('.') : k.slice(0, 3).join('.');
  return k[0];
}
const at = (c, piece) => piece.split('.').reduce((x, k) => x?.[k], c);
// tips are practical advice: a number in a tip may go without a source
const ADVICE = /^\w+\.tips\./;

// c is the content as the engine keeps it: per moment intro { text, src }, tips [{ text, src }],
// questions [{ id, question, answers: [{ id, label, reply, next, src }] }], every text as { nl, en, … }.
export function checkContent(c, s) {
  const level = code => s.checks?.[code] || CHECKS[code]?.level || 'warn';
  if (!c || typeof c !== 'object') return { ok: false, errors: 1, warnings: 0, issues: [{ piece: '', level: 'error', code: 'missing', message: 'Geen inhoud' }] };
  const langs = s.languages, issues = [];
  const add = (piece, code, message) => {
    const lv = level(code);
    if (lv !== 'off' && !issues.some(i => i.piece === piece && i.code === code)) issues.push({ piece, level: lv, code, message });
  };
  const SELL = wordsPattern(s.sellWords || SELL_WORDS), DELIVERY = wordsPattern(s.deliveryWords || DELIVERY_WORDS), RETURNS = wordsPattern(s.returnsWords || RETURNS_WORDS);
  const guide = { intro: s.maxIntro || 400, tip: s.maxTip || 280, question: s.maxQuestion || 120, label: s.maxAnswer || 60, reply: s.maxReply || 240 };
  const kindOfText = path => { const last = path.split('.').pop(); return last === 'text' ? (path.split('.')[1] === 'intro' ? 'intro' : 'tip') : last };

  for (const { path, piece, t } of texts(c, langs)) {
    const kind = kindOfText(path), empty = langs.filter(l => !(t[l] || '').trim());
    if (empty.length && !(kind === 'reply' && empty.length === langs.length)) add(piece, 'missing', `Tekst ontbreekt (${empty.map(l => l.toUpperCase()).join(', ')})`);
    for (const l of langs) {
      const v = t[l] || '';
      const hit = re => re && v.match(re)?.[0];
      if (hit(SELL)) add(piece, 'sell', `Klinkt als verkopen ("${hit(SELL)}"); de gids verkoopt nooit`);
      if (hit(DELIVERY)) add(piece, 'delivery', `Belooft een bezorgmoment ("${hit(DELIVERY)}")`);
      if (hit(RETURNS)) add(piece, 'returns', `Ontmoedigt retourneren ("${hit(RETURNS)}")`);
      if (l === 'nl' && s.formality === 'formal' && INFORMAL_IN_FORMAL.test(v)) add(piece, 'form', 'Gebruikt je/jouw terwijl de shop u/uw wil');
      if (l === 'nl' && s.formality !== 'formal' && FORMAL_IN_INFORMAL.test(v)) add(piece, 'form', 'Gebruikt u/uw terwijl de shop je/jouw wil');
      if (v.length > TOOL[kind]) add(piece, 'fit', `${v.length} tekens (${l.toUpperCase()}); de tool staat er ${TOOL[kind]} toe`);
    }
    const v = t[langs[0]] || '';
    if (v.length > guide[kind]) add(piece, 'long', `Te lang (${v.length} tekens, richtlijn ${guide[kind]})`);
    // numbers and years need a source, except in tips, questions and answer labels
    if (NUMBER.test(v) && (kind === 'intro' || kind === 'reply') && !ADVICE.test(piece)) {
      const src = at(c, piece)?.src;
      if (Array.isArray(src) && !src.length) add(piece, 'source', 'Bevat een getal zonder bron');
    }
  }

  const seen = new Map();
  for (const m of MOMENTS) {
    const g = c[m];
    if (!g) { add(m, 'missing', 'Deze gids ontbreekt'); continue }
    const tips = g.tips || [], qs = g.questions || [];
    if (tips.length < TOOL.tips[0] || tips.length > TOOL.tips[1]) add(`${m}`, 'fit', `${tips.length} tips; de tool staat 1 tot 5 toe`);
    if (qs.length > TOOL.questions[1]) add(`${m}`, 'fit', `${qs.length} vragen; de tool staat er hoogstens 3 toe`);
    if (tips.length !== s.tipCount) add(`${m}`, 'count', `${tips.length} tips, ingesteld op ${s.tipCount}`);
    if (qs.length !== s.questionCount) add(`${m}`, 'count', `${qs.length} vragen, ingesteld op ${s.questionCount}`);
    const ids = new Set();
    qs.forEach((q, i) => {
      const n = q.answers?.length || 0;
      if (n < TOOL.answers[0] || n > TOOL.answers[1]) add(`${m}.questions.${i}`, 'fit', `${n} antwoorden; de tool staat 2 tot 5 toe`);
      else if (n !== s.answerCount) add(`${m}.questions.${i}`, 'count', `${n} antwoorden, ingesteld op ${s.answerCount}`);
      for (const id of [q.id, ...(q.answers || []).map(a => a.id)]) { if (!id || ids.has(id)) add(`${m}.questions.${i}`, 'flow', 'Dubbele of lege id'); ids.add(id) }
      (q.answers || []).forEach((a, j) => {
        if (a.next === 'next' || a.next === 'end') return;
        const target = qs.findIndex(x => x.id === a.next);
        if (target <= i) add(`${m}.questions.${i}.answers.${j}`, 'flow', 'Leidt naar een eerdere of onbekende vraag');
      });
    });
    tips.forEach((t, i) => {
      const k = (t.text?.[langs[0]] || '').toLowerCase().trim();
      if (!k) return;
      if (seen.has(k)) add(`${m}.tips.${i}`, 'repeat', `Zelfde tip als ${seen.get(k)}`); else seen.set(k, `${m}.tips.${i}`);
    });
  }

  const errors = issues.filter(i => i.level === 'error').length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues };
}

// what to tell the writer when it rewrites an item that failed the check
export const repairWish = list => 'Fix these problems: ' + list.map(i => ({
  sell: 'it sounds like selling (' + i.message + '); give help, never push a purchase', delivery: 'it promises a delivery time; remove that',
  returns: 'it discourages returns; never do that', form: 'use the form of address the shop chose, consistently',
  source: 'it states a number without a source; cite a fact id or drop the number', missing: 'a language is missing',
  long: 'it is too long; make it shorter', fit: 'it is longer than the tool allows; make it clearly shorter', flow: 'an answer may only lead to a later question',
}[i.code] || i.message)).join('; ') + '.';
