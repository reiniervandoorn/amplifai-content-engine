import { DEFAULT_LEVELS, LEVEL_IDS, MODELS } from './pricing.js';
import { CHECKS, SELL_WORDS, DELIVERY_WORDS, RETURNS_WORDS } from './quality.js';

// The settings a request can carry. The AmplifAI tool owns them (shops pick them there) and sends
// them with every request; the engine checks each value and fills in a default for what is missing.

export const LANGUAGES = { nl: 'Nederlands', en: 'English', de: 'Deutsch', fr: 'Français' };

// Every setting the tool may send. Counts are per moment (ordered, in transit, delivered) and stay
// within what the tool's guide editor allows: 1-5 tips, 0-3 questions, 2-5 answers per question.
export const FIELDS = {
  languages:     { type: 'list', options: Object.keys(LANGUAGES), min: 1, default: ['nl'], label: 'Talen', help: 'De eerste taal wordt eerst en het zorgvuldigst geschreven.' },
  quality:       { type: 'enum', options: LEVEL_IDS, default: 'basis', label: 'Kwaliteit', help: 'Bepaalt het model, en daarmee de kosten per product.' },
  toneOfVoice:   { type: 'text', max: 2000, default: '', label: 'Tone of voice', help: 'De tekst die de shop koos of schreef. Leeg: de standaardtoon van AmplifAI.' },
  formality:     { type: 'enum', options: ['auto', 'informal', 'formal'], default: 'auto', label: 'Aanspreekvorm', help: 'auto: volgt de tone of voice ("formally" of "u" betekent u), anders je.' },
  length:        { type: 'enum', options: ['standard', 'short'], default: 'standard', label: 'Lengte', help: 'Kort: kortere zinnen, minder uitleg.' },
  tipCount:      { type: 'int', min: 1, max: 5, default: 3, label: 'Tips per moment' },
  questionCount: { type: 'int', min: 0, max: 3, default: 2, label: 'Vragen per moment' },
  answerCount:   { type: 'int', min: 2, max: 5, default: 3, label: 'Antwoorden per vraag' },
};

// The general instructions: how research and writing work for every product. AmplifAI changes them on the
// admin page (Instructies); the tool cannot send them. The rules go into every writing prompt; src/quality.js
// checks the fixed ones, so a rule added here is followed by the writer but not checked automatically.
export const RULES = [
  'Give first, then ask. Never sell: no product pushes, no "buy", no discounts, no links. A required part may be named as help, never as a pitch.',
  'Tips are phrased as help ("a fan makes a big difference"), not commands. The feel is "the tip you wish you had been given".',
  'Never discourage returns or exchanges. Never promise or mention a delivery date or day.',
  'Use only what the order and the customer\'s answers can tell. Do not invent the customer\'s gender, name, goals or relationships.',
  'Every factual claim (numbers, history, specs, studies, how the product works) must rest on the given facts, cited by id in src. Do not add facts that are not in the list. Practical how-to advice may have an empty src.',
  'No independent tests, reviews or ratings, ever.',
];
// The texts of the instructions to Claude, as AmplifAI can edit them on the admin page. In English: that is
// what the models follow best. {name} is filled in from the settings, e.g. {tipCount} or {questionCount}.
const TEXTS = {
  researchBrief: { group: 'research', label: 'Opdracht voor het onderzoek', rows: 18, help: 'Welke soorten feiten Claude zoekt en welke bronnen mogen. Het antwoordformaat (JSON) voegt de engine zelf toe. Invulvelden: {factsMin}, {factsMax}, {questionIdeas}.',
    default: `You research one product for AmplifAI, a guide a webshop customer sees right after paying. Your job is to collect facts, not to write the texts.

Find facts in these categories:
- brand: the brand's story and history (founding, origin of the product name, milestones).
- special: what makes this exact product special (technology, design choices, specs that matter in use).
- first_use: unboxing, set-up, the first 5 minutes, what is normal in the first week (noises, smells, stiffness, break-in).
- care: cleaning, storage, maintenance, lifespan, when to replace.
- use: practical tips to get more out of it, for beginners and for experienced users.
- compat: what else the customer needs or must check (fit, sizes, compatibility, power, accessories that are required, not upsells).
- general: striking, well-documented facts about the activity or category (a number that makes people say "huh").

Allowed sources: the shop's own product page (given below), the manufacturer's or brand's own website, official manuals and support pages, standards bodies and government sites, peer-reviewed research, encyclopedic history pages.
Not allowed: independent tests, reviews, ratings, comparison sites, forums, social media, other retailers' marketing, affiliate blogs.

Every fact needs the exact URL of a page you actually saw in a search result or fetched, plus a short verbatim snippet from that page that supports it. Facts taken from the shop's page use the shop page URL. Leave out anything you cannot source. Prefer specific, checkable facts (years, numbers, named technologies) over vague claims. Write facts in English.

Also propose up to {questionIdeas} question ideas: short questions to the customer whose answer would genuinely change the advice (a goal, a use situation, a compatibility check). Base them on the product, not on assumptions about the customer.

Aim for {factsMin} to {factsMax} facts.` },

  writerIntro: { group: 'writing', label: 'Opdracht voor het schrijven', rows: 4, help: 'De eerste alinea van elke schrijfopdracht: wat de gids is en hoe hij moet voelen.',
    default: 'You write the content for an AmplifAI guide. The guide appears for a webshop\'s customer right after they pay, and follows the order through the shipping and delivery emails. For each of three moments you write one short guide: an intro, a few questions whose answers change what comes next, and tips. It feels like "the tip you wish you had been given".' },
  shortLength: { group: 'writing', label: 'Als de shop "kort" kiest', rows: 2, default: 'Use the shortest version of every piece: one sentence where two are allowed.' },
  houseStyle: { group: 'tone', label: 'Huisstijl van AmplifAI', rows: 4, help: 'Geldt altijd, voor elke shop. De tone of voice van de shop komt hier bovenop, maar kan de huisstijl en de regels niet veranderen.',
    default: 'Calm and clear, like the best shop assistant: they know everything about the brand and the product, and sell nothing. Short sentences, concrete and specific. No superlatives, no hype, no exclamation marks in a row. Every sentence helps the customer with this product.' },
  defaultTone: { group: 'tone', label: 'Standaardtoon', rows: 3, help: 'Als de tool geen tone of voice meestuurt. Shops kiezen hun eigen toon in de tool.',
    default: 'Warm and personal, like a knowledgeable friend behind the counter. Light, never gushing. Short, clear sentences.' },

  momentOrdered:   { group: 'moments', moment: 'ordered', label: 'Besteld (bedankpagina)', rows: 3, default: 'Right after checkout. Why this product fits and what to expect: open with the most surprising sourced brand or product fact, and ask what the customer will use it for or how experienced they are.' },
  momentInTransit: { group: 'moments', moment: 'in_transit', label: 'Onderweg (verzendmail)', rows: 3, default: 'While the parcel is on its way. What to prepare so the first use goes well: space, settings, things to read up on, and parts that are required (as help, never as a sale).' },
  momentDelivered: { group: 'moments', moment: 'delivered', label: 'Bezorgd (bezorgmail)', rows: 3, default: 'Just delivered. The first five minutes of use, what is normal in the first days (noises, smells, stiffness, break-in), and the most important care point.' },

  pieceIntro:     { group: 'pieces', label: 'Intro', rows: 2, default: '1 to 3 short sentences that open this moment\'s guide. It gives before it asks.' },
  pieceQuestions: { group: 'pieces', label: 'Vragen en antwoorden', rows: 5, default: '{questionCount} short questions, each with {answerCount} answers; the last answer may be "not sure" or "not right now". A question asks something whose answer genuinely changes the advice (a goal, a situation, experience, a compatibility check). An answer may have a reply: 1 or 2 sentences shown right after it is picked, with advice for exactly that answer. Each answer leads to the next question ("next"), to a later question (its index) or straight to the tips ("end"); only forward.' },
  pieceTips:      { group: 'pieces', label: 'Tips', rows: 2, default: '{tipCount} tips, each 1 or 2 sentences, phrased as help. Never repeat a tip between moments.' },
};

export const INSTRUCTIONS = {
  factsMin:      { type: 'int', min: 5, max: 40, default: 18, group: 'research', label: 'Feiten verzamelen, minimaal' },
  factsMax:      { type: 'int', min: 8, max: 60, default: 30, group: 'research', label: 'Feiten verzamelen, maximaal' },
  questionIdeas: { type: 'int', min: 1, max: 5, default: 3, group: 'research', label: 'Vraag-ideeën uit het onderzoek' },
  maxSearches:   { type: 'int', min: 0, max: 15, default: 8, group: 'research', label: 'Zoekopdrachten per product', help: 'Meer zoeken kost meer, maar vindt meer bronnen.' },
  maxFetches:    { type: 'int', min: 0, max: 10, default: 6, group: 'research', label: 'Pagina’s lezen per product' },
  blockedDomains: { type: 'textlist', max: 200, group: 'research', label: 'Geblokkeerde bronnen', help: 'Eén domein per regel. Tests, reviews, fora en andere winkels.',
    default: ['consumentenbond.nl', 'tweakers.net', 'kieskeurig.nl', 'beslist.nl', 'trustpilot.com', 'kiyoh.com', 'reddit.com', 'youtube.com',
      'rtings.com', 'runrepeat.com', 'which.co.uk', 'consumerreports.org', 'amazon.com', 'amazon.nl', 'bol.com'] },
  effort:        { type: 'enum', options: ['low', 'medium', 'high', 'xhigh'], default: 'high', group: 'writing', label: 'Denkniveau bij schrijven', help: 'Hoger is zorgvuldiger, maar trager en duurder.' },
  extra:         { type: 'text', max: 2000, default: '', group: 'writing', label: 'Extra instructie voor het schrijven', help: 'Geldt voor alle producten, bovenop de regels. Bijvoorbeeld: "Begin tips nooit met Zorg dat".' },
  rules:         { type: 'textlist', max: 30, default: RULES, group: 'rules', label: 'Regels in de schrijfopdracht', help: 'Eén regel per regel, in het Engels. Gaan in elke schrijfopdracht mee.' },
  ...Object.fromEntries(Object.entries(TEXTS).map(([k, f]) => [k, { type: 'text', max: 6000, ...f }])),
  // the quality check: per check error, warning or off; the word lists; the length guidelines
  checks:        { type: 'checks', default: Object.fromEntries(Object.entries(CHECKS).map(([k, c]) => [k, c.level])), group: 'check', label: 'Controles' },
  sellWords:     { type: 'textlist', max: 200, group: 'check', label: 'Woorden die klinken als verkopen', help: 'Eén woord of zinsdeel per regel, in elke taal.', default: SELL_WORDS },
  deliveryWords: { type: 'textlist', max: 200, group: 'check', label: 'Woorden die een bezorgmoment beloven', help: '# staat voor een getal, bijv. "binnen # dagen".', default: DELIVERY_WORDS },
  returnsWords:  { type: 'textlist', max: 200, group: 'check', label: 'Woorden die retourneren ontmoedigen', default: RETURNS_WORDS },
  maxIntro:      { type: 'int', min: 100, max: 2000, default: 400, group: 'check', label: 'Intro, tekens' },
  maxTip:        { type: 'int', min: 80, max: 1000, default: 280, group: 'check', label: 'Tip, tekens' },
  maxQuestion:   { type: 'int', min: 40, max: 300, default: 120, group: 'check', label: 'Vraag, tekens' },
  maxAnswer:     { type: 'int', min: 20, max: 200, default: 60, group: 'check', label: 'Antwoord, tekens' },
  maxReply:      { type: 'int', min: 60, max: 500, default: 240, group: 'check', label: 'Reactie op een antwoord, tekens' },
};

// What AmplifAI sets in the admin page.
export const defaultPlatform = () => ({
  levels: structuredClone(DEFAULT_LEVELS),
  // AmplifAI's general instructions, and the defaults for settings the tool leaves out
  instructions: Object.fromEntries(Object.entries(INSTRUCTIONS).map(([k, f]) => [k, structuredClone(f.default)])),
  defaults: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, structuredClone(f.default)])),
  // hard limits on what live mode may spend at Anthropic, in euro; the engine stops before going over
  budget: { dayEUR: 5, monthEUR: 25, productEUR: 2 },
});

export function checkBudget(b) {
  const out = {};
  for (const k of ['dayEUR', 'monthEUR', 'productEUR']) {
    if (b?.[k] === undefined) continue;
    const n = Number(b[k]);
    if (!(n >= 0 && n <= 100000)) throw new SettingsError(`budget.${k}: een bedrag in euro`, k);
    out[k] = Math.round(n * 100) / 100;
  }
  return out;
}

export function checkLevels(levels) {
  const out = {};
  for (const id of LEVEL_IDS) {
    const t = levels?.[id];
    if (!t) continue;
    if (!MODELS[t.model]) throw new SettingsError(`levels.${id}.model: kies uit ${Object.keys(MODELS).join(', ')}`);
    out[id] = { ...DEFAULT_LEVELS[id], model: t.model };
  }
  return out;
}

/* ── validation ── */
export class SettingsError extends Error { constructor(msg, key) { super(msg); this.key = key; this.status = 422 } }

export function checkValue(key, v, table = FIELDS) {
  const f = table[key];
  if (!f) throw new SettingsError(`Onbekende instelling: ${key}`, key);
  switch (f.type) {
    case 'enum': if (!f.options.includes(v)) throw new SettingsError(`${key}: kies uit ${f.options.join(', ')}`, key); return v;
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < f.min || n > f.max) throw new SettingsError(`${key}: een geheel getal van ${f.min} tot ${f.max}`, key);
      return n;
    }
    case 'text': if (typeof v !== 'string' || v.length > f.max) throw new SettingsError(`${key}: tekst van maximaal ${f.max} tekens`, key); if (f.group && f.group !== 'writing' && !v.trim()) throw new SettingsError(`${key}: mag niet leeg zijn`, key); return v.trim();
    case 'checks': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SettingsError(`${key}: per controle error, warn of off`, key);
      const out = { ...f.default };
      for (const [c, l] of Object.entries(v)) {
        if (!(c in f.default)) throw new SettingsError(`${key}: onbekende controle ${c}`, key);
        if (!['error', 'warn', 'off'].includes(l)) throw new SettingsError(`${key}.${c}: error, warn of off`, key);
        out[c] = l;
      }
      return out;
    }
    case 'textlist': {
      if (!Array.isArray(v) || v.length > f.max || v.some(x => typeof x !== 'string' || x.length > 1000)) throw new SettingsError(`${key}: een lijst met maximaal ${f.max} regels`, key);
      return v.map(x => x.trim()).filter(Boolean);
    }
    case 'list': {
      if (!Array.isArray(v) || v.length < (f.min || 0) || v.some(x => !f.options.includes(x)) || new Set(v).size !== v.length)
        throw new SettingsError(`${key}: kies uit ${f.options.join(', ')}`, key);
      return v;
    }
  }
}

// AmplifAI's instructions from the admin page. `null` for a field puts back the built-in default.
export function checkInstructions(patch, current) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SettingsError('instructions moet een object zijn');
  const out = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!INSTRUCTIONS[k]) throw new SettingsError(`Onbekende instructie: ${k}`, k);
    out[k] = v === null ? structuredClone(INSTRUCTIONS[k].default) : checkValue(k, v, INSTRUCTIONS);
  }
  if (out.blockedDomains) out.blockedDomains = out.blockedDomains.map(d => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  if (out.factsMin > out.factsMax) throw new SettingsError('factsMin: mag niet hoger zijn dan factsMax', 'factsMin');
  if (!out.rules.length) throw new SettingsError('rules: minstens één regel', 'rules');
  return out;
}
// The defaults for settings the tool leaves out, checked the same way as the tool's own values.
export function checkDefaults(patch, current) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SettingsError('defaults moet een object zijn');
  const out = { ...current };
  for (const [k, v] of Object.entries(patch)) out[k] = v === null ? structuredClone(FIELDS[k]?.default) : checkValue(k, v);
  return out;
}

// The settings for one request: the tool's values, checked, over AmplifAI's defaults; plus the model the
// quality level stands for and AmplifAI's general instructions.
export function resolve(given, platform) {
  if (given != null && (typeof given !== 'object' || Array.isArray(given))) throw new SettingsError('settings moet een object zijn');
  const d = defaultPlatform(), defaults = { ...d.defaults, ...(platform?.defaults || {}) }, instructions = { ...d.instructions, ...(platform?.instructions || {}) };
  const s = structuredClone(defaults);
  for (const [k, v] of Object.entries(given || {})) if (v !== null && v !== undefined) s[k] = checkValue(k, v);
  const levels = { ...DEFAULT_LEVELS, ...(platform?.levels || {}) };
  return { ...instructions, ...s, formality: formalityOf(s, instructions), model: (levels[s.quality] || levels.basis).model };
}

// "auto" reads the form of address from the tone of voice: the tool's presets say "address the customer formally".
function formalityOf(s, instructions) {
  if (s.formality !== 'auto') return s.formality;
  const tone = s.toneOfVoice || instructions.defaultTone || '';
  return /\b(formally|formal address|formeel|met u|vous|sie)\b/i.test(tone) && !/\binformal/i.test(tone) ? 'formal' : 'informal';
}

// The settings as the tool sends them back: without the model and research internals.
export const publicSettings = s => Object.fromEntries(Object.keys(FIELDS).map(k => [k, s[k]]));

// What a screen needs to draw a form for one table of fields: the tool's settings, or AmplifAI's instructions.
export const describe = (defaults = {}, table = FIELDS) => Object.fromEntries(Object.entries(table).map(([k, f]) => [k, {
  type: f.type, label: f.label, ...(f.help && { help: f.help }), ...(f.group && { group: f.group }), ...(f.rows && { rows: f.rows }), ...(f.moment && { moment: f.moment }), default: defaults[k] ?? f.default,
  ...(f.options && { options: f.options }), ...(f.min != null && { min: f.min }), ...(f.max != null && { max: f.max }),
}]));
