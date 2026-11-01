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

// How research works. Only AmplifAI changes these, in code; the tool cannot send them.
export const RESEARCH = {
  maxSearches: 8,
  maxFetches: 6,
  effort: 'high',
  blockedDomains: ['consumentenbond.nl', 'tweakers.net', 'kieskeurig.nl', 'beslist.nl', 'trustpilot.com', 'kiyoh.com', 'reddit.com', 'youtube.com',
    'rtings.com', 'runrepeat.com', 'which.co.uk', 'consumerreports.org', 'amazon.com', 'amazon.nl', 'bol.com'],
};

// The product rules from AmplifAI. They go into every writing prompt; the tool cannot change them.
// src/quality.js checks the written content against the same rules.
export const RULES = [
  'Give first, then ask. Never sell: no product pushes, no "buy", no discounts, no links. A required part may be named as help, never as a pitch.',
  'Tips are phrased as help ("a fan makes a big difference"), not commands. The feel is "the tip you wish you had been given".',
  'Never discourage returns or exchanges. Never promise or mention a delivery date or day.',
  'Use only what the order and the customer\'s answers can tell. Do not invent the customer\'s gender, name, goals or relationships.',
  'Every factual claim (numbers, history, specs, studies, how the product works) must rest on the given facts, cited by id in src. Do not add facts that are not in the list. Practical how-to advice may have an empty src.',
  'No independent tests, reviews or ratings, ever.',
];

// What AmplifAI sets in the admin page.
export const defaultPlatform = () => ({
  levels: structuredClone(DEFAULT_LEVELS),
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

export function checkValue(key, v) {
  const f = FIELDS[key];
  if (!f) throw new SettingsError(`Onbekende instelling: ${key}`, key);
  switch (f.type) {
    case 'enum': if (!f.options.includes(v)) throw new SettingsError(`${key}: kies uit ${f.options.join(', ')}`, key); return v;
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < f.min || n > f.max) throw new SettingsError(`${key}: een geheel getal van ${f.min} tot ${f.max}`, key);
      return n;
    }
    case 'text': if (typeof v !== 'string' || v.length > f.max) throw new SettingsError(`${key}: tekst van maximaal ${f.max} tekens`, key); return v.trim();
    case 'list': {
      if (!Array.isArray(v) || v.length < (f.min || 0) || v.some(x => !f.options.includes(x)) || new Set(v).size !== v.length)
        throw new SettingsError(`${key}: kies uit ${f.options.join(', ')}`, key);
      return v;
    }
  }
}

// The settings for one request: the tool's values, checked, over the defaults; plus the model the
// quality level stands for and the research settings.
export function resolve(given, platform) {
  if (given != null && (typeof given !== 'object' || Array.isArray(given))) throw new SettingsError('settings moet een object zijn');
  const s = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, structuredClone(f.default)]));
  for (const [k, v] of Object.entries(given || {})) if (v !== null && v !== undefined) s[k] = checkValue(k, v);
  const levels = { ...DEFAULT_LEVELS, ...(platform?.levels || {}) };
  return { ...s, model: (levels[s.quality] || levels.basis).model, ...RESEARCH };
}

// The settings as the tool sends them back: without the model and research internals.
export const publicSettings = s => Object.fromEntries(Object.keys(FIELDS).map(k => [k, s[k]]));

// What the tool needs to draw its settings screen.
export const describe = () => Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, {
  type: f.type, label: f.label, ...(f.help && { help: f.help }), default: f.default,
  ...(f.options && { options: f.options }), ...(f.min != null && { min: f.min }), ...(f.max != null && { max: f.max }),
}]));
