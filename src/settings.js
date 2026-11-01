import { DEFAULT_LEVELS, LEVEL_IDS, MODELS } from './pricing.js';

// The settings a request can carry. The AmplifAI tool owns them (shops pick them there) and sends
// them with every request; the engine checks each value and fills in a default for what is missing.

export const LANGUAGES = { nl: 'Nederlands', en: 'English', de: 'Deutsch', fr: 'Français' };

// Every setting the tool may send.
export const FIELDS = {
  languages:   { type: 'list', options: Object.keys(LANGUAGES), min: 1, default: ['nl', 'en'], label: 'Talen', help: 'De eerste taal wordt eerst en het zorgvuldigst geschreven.' },
  quality:     { type: 'enum', options: LEVEL_IDS, default: 'basis', label: 'Kwaliteit', help: 'Bepaalt het model, en daarmee de kosten per product.' },
  tone:        { type: 'enum', options: ['warm', 'neutral', 'expert', 'playful'], default: 'warm', label: 'Toon' },
  formality:   { type: 'enum', options: ['informal', 'formal'], default: 'informal', label: 'Aanspreekvorm', help: 'je/du/tu of u/Sie/vous' },
  length:      { type: 'enum', options: ['standard', 'short'], default: 'standard', label: 'Lengte', help: 'Kort: kortere zinnen, minder uitleg.' },
  tipCount:    { type: 'int', min: 2, max: 4, default: 3, label: 'Tips per ervaringsniveau' },
  answerCount: { type: 'int', min: 3, max: 4, default: 4, label: 'Antwoorden op de vraag' },
  expectCount: { type: 'int', min: 2, max: 3, default: 2, label: 'Wat is normaal' },
  emailItems:  { type: 'int', min: 2, max: 4, default: 3, label: 'Punten per e-mail' },
  style:       { type: 'text', max: 400, default: '', label: 'Stijlwens van de shop', help: 'Alleen stijl; kan de vaste regels niet veranderen.' },
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
export const INSTRUCTIONS = {
  factsMin:      { type: 'int', min: 5, max: 40, default: 18, group: 'research', label: 'Feiten verzamelen, minimaal' },
  factsMax:      { type: 'int', min: 8, max: 60, default: 30, group: 'research', label: 'Feiten verzamelen, maximaal' },
  questionIdeas: { type: 'int', min: 1, max: 5, default: 3, group: 'research', label: 'Vraag-ideeën uit het onderzoek' },
  maxSearches:   { type: 'int', min: 0, max: 15, default: 8, group: 'research', label: 'Zoekopdrachten per product', help: 'Meer zoeken kost meer, maar vindt meer bronnen.' },
  maxFetches:    { type: 'int', min: 0, max: 10, default: 6, group: 'research', label: 'Pagina’s lezen per product' },
  blockedDomains: { type: 'textlist', max: 200, group: 'research', label: 'Geblokkeerde bronnen', help: 'Eén domein per regel. Tests, reviews, fora en andere winkels.',
    default: ['consumentenbond.nl', 'tweakers.net', 'kieskeurig.nl', 'beslist.nl', 'trustpilot.com', 'kiyoh.com', 'reddit.com', 'youtube.com',
      'rtings.com', 'runrepeat.com', 'which.co.uk', 'consumerreports.org', 'amazon.com', 'amazon.nl', 'bol.com'] },
  specialCount:  { type: 'int', min: 1, max: 4, default: 2, group: 'writing', label: 'Punten bij "bijzonder aan dit product"' },
  careCount:     { type: 'int', min: 1, max: 5, default: 3, group: 'writing', label: 'Punten bij onderhoud' },
  headlineWords: { type: 'int', min: 4, max: 12, default: 8, group: 'writing', label: 'Kopregel, maximaal aantal woorden' },
  effort:        { type: 'enum', options: ['low', 'medium', 'high', 'xhigh'], default: 'high', group: 'writing', label: 'Denkniveau bij schrijven', help: 'Hoger is zorgvuldiger, maar trager en duurder.' },
  extra:         { type: 'text', max: 2000, default: '', group: 'writing', label: 'Extra instructie voor het schrijven', help: 'Geldt voor alle producten, bovenop de regels. Bijvoorbeeld: "Begin tips nooit met Zorg dat".' },
  rules:         { type: 'textlist', max: 30, default: RULES, group: 'rules', label: 'Vaste regels', help: 'Eén regel per regel, in het Engels. Gaan in elke schrijfopdracht mee.' },
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
    case 'text': if (typeof v !== 'string' || v.length > f.max) throw new SettingsError(`${key}: tekst van maximaal ${f.max} tekens`, key); return v.trim();
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
  return { ...instructions, ...s, model: (levels[s.quality] || levels.basis).model };
}

// The settings as the tool sends them back: without the model and research internals.
export const publicSettings = s => Object.fromEntries(Object.keys(FIELDS).map(k => [k, s[k]]));

// What a screen needs to draw a form for one table of fields: the tool's settings, or AmplifAI's instructions.
export const describe = (defaults = {}, table = FIELDS) => Object.fromEntries(Object.entries(table).map(([k, f]) => [k, {
  type: f.type, label: f.label, ...(f.help && { help: f.help }), ...(f.group && { group: f.group }), default: defaults[k] ?? f.default,
  ...(f.options && { options: f.options }), ...(f.min != null && { min: f.min }), ...(f.max != null && { max: f.max }),
}]));
