import { DEFAULT_TIERS, TIER_IDS, MODELS } from './pricing.js';

// Settings in three layers: AmplifAI sets the base (defaults + policy), the shop sets its own defaults,
// and each product can override again. The policy decides which settings a shop may change, and to what.

export const LANGUAGES = { nl: 'Nederlands', en: 'English', de: 'Deutsch', fr: 'Français' };

// Every setting the engine understands. `customer: false` means only AmplifAI can ever change it.
export const FIELDS = {
  languages:   { type: 'list', options: Object.keys(LANGUAGES), min: 1, default: ['nl', 'en'], label: 'Talen', help: 'De eerste taal wordt eerst en het zorgvuldigst geschreven.' },
  tier:        { type: 'enum', options: TIER_IDS, default: 'basis', label: 'Kwaliteit', help: 'Bepaalt het model en de prijs per bestelling.' },
  tone:        { type: 'enum', options: ['warm', 'neutral', 'expert', 'playful'], default: 'warm', label: 'Toon' },
  formality:   { type: 'enum', options: ['informal', 'formal'], default: 'informal', label: 'Aanspreekvorm', help: 'je/du/tu of u/Sie/vous' },
  length:      { type: 'enum', options: ['standard', 'short'], default: 'standard', label: 'Lengte', help: 'Kort = één scherm, geen vragen' },
  tipCount:    { type: 'int', min: 2, max: 4, default: 3, label: 'Tips per niveau' },
  answerCount: { type: 'int', min: 3, max: 4, default: 4, label: 'Antwoorden per vraag' },
  expectCount: { type: 'int', min: 2, max: 3, default: 2, label: 'Verwachtingen' },
  momentItems: { type: 'int', min: 2, max: 4, default: 3, label: 'Punten per e-mail' },
  emails:      { type: 'bool', default: true, label: 'Inhoud voor verzend- en bezorgmail' },
  extra:       { type: 'text', max: 400, default: '', label: 'Extra stijlwens', help: 'Alleen stijl; kan de vaste regels niet veranderen.' },
  maxSearches: { type: 'int', min: 0, max: 15, default: 8, label: 'Zoekopdrachten per product', customer: false },
  maxFetches:  { type: 'int', min: 0, max: 10, default: 6, label: 'Pagina’s lezen per product', customer: false },
  blockedDomains: { type: 'textlist', max: 200, label: 'Geblokkeerde bronnen', customer: false,
    default: ['consumentenbond.nl', 'tweakers.net', 'kieskeurig.nl', 'beslist.nl', 'trustpilot.com', 'kiyoh.com', 'reddit.com', 'youtube.com',
      'rtings.com', 'runrepeat.com', 'which.co.uk', 'consumerreports.org', 'amazon.com', 'amazon.nl', 'bol.com'] },
  effort:      { type: 'enum', options: ['low', 'medium', 'high', 'xhigh'], default: 'high', label: 'Denkniveau bij schrijven', customer: false },
};

// The product rules from AmplifAI. They go into every writing prompt; shops cannot change them.
export const DEFAULT_RULES = [
  'Give first, then ask. Never sell: no product pushes, no "buy", no discounts, no links. A required part may be named as help, never as a pitch.',
  'Tips are phrased as help ("a fan makes a big difference"), not commands. The feel is "the tip you wish you had been given".',
  'Never discourage returns or exchanges. Never promise or mention a delivery date or day.',
  'Use only what the order and the customer\'s answers can tell. Do not invent the customer\'s gender, name, goals or relationships.',
  'Every factual claim (numbers, history, specs, studies, how the product works) must rest on the given facts, cited by id in src. Do not add facts that are not in the list. Practical how-to advice may have an empty src.',
  'No independent tests, reviews or ratings, ever.',
];

export const defaultPlatform = () => ({
  defaults: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, structuredClone(f.default)])),
  // per setting: may the shop change it, and within which bounds
  policy: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, { editable: f.customer !== false }])),
  rules: [...DEFAULT_RULES],
  tiers: structuredClone(DEFAULT_TIERS),
  refresh: 'weekly',       // how often every shop's catalog is checked: weekly, monthly or off
  // hard limits on what live mode may spend at Anthropic, in euro; the engine stops before going over
  budget: { dayEUR: 5, monthEUR: 25, guideEUR: 2 },
});

export function checkBudget(b) {
  const out = {};
  for (const k of ['dayEUR', 'monthEUR', 'guideEUR']) {
    if (b?.[k] === undefined) continue;
    const n = Number(b[k]);
    if (!(n >= 0 && n <= 100000)) throw new SettingsError(`budget.${k}: een bedrag in euro`);
    out[k] = Math.round(n * 100) / 100;
  }
  return out;
}

export function checkTiers(tiers) {
  const out = {};
  for (const id of TIER_IDS) {
    const t = tiers?.[id];
    if (!t) continue;
    if (!MODELS[t.model]) throw new SettingsError(`tiers.${id}.model: kies uit ${Object.keys(MODELS).join(', ')}`);
    const price = Number(t.pricePerOrder);
    if (!(price >= 0 && price <= 5)) throw new SettingsError(`tiers.${id}.pricePerOrder: een bedrag in euro`);
    out[id] = { name: String(t.name || id).slice(0, 30), model: t.model, pricePerOrder: Math.round(price * 100) / 100, blurb: String(t.blurb || '').slice(0, 80) };
  }
  return out;
}

/* ── validation ── */
export class SettingsError extends Error { constructor(msg, key) { super(msg); this.key = key; this.status = 422 } }

// The bounds a value must sit in: the field's own, narrowed by the policy.
function bounds(key, policy) {
  const f = FIELDS[key], p = policy?.[key] || {};
  return {
    options: p.options?.length ? f.options?.filter(o => p.options.includes(o)) : f.options,
    min: Math.max(f.min ?? -Infinity, p.min ?? -Infinity),
    max: Math.min(f.max ?? Infinity, p.max ?? Infinity),
  };
}

export function checkValue(key, v, policy) {
  const f = FIELDS[key];
  if (!f) throw new SettingsError(`Onbekende instelling: ${key}`, key);
  const b = bounds(key, policy);
  switch (f.type) {
    case 'enum': if (!b.options.includes(v)) throw new SettingsError(`${key}: kies uit ${b.options.join(', ')}`, key); return v;
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < b.min || n > b.max) throw new SettingsError(`${key}: een geheel getal van ${b.min} tot ${b.max}`, key);
      return n;
    }
    case 'bool': if (typeof v !== 'boolean') throw new SettingsError(`${key}: true of false`, key); return v;
    case 'text': if (typeof v !== 'string' || v.length > f.max) throw new SettingsError(`${key}: tekst van maximaal ${f.max} tekens`, key); return v.trim();
    case 'list': {
      if (!Array.isArray(v) || v.length < (f.min || 0) || v.some(x => !b.options.includes(x)) || new Set(v).size !== v.length)
        throw new SettingsError(`${key}: kies uit ${b.options.join(', ')}`, key);
      return v;
    }
    case 'textlist': {
      if (!Array.isArray(v) || v.length > f.max || v.some(x => typeof x !== 'string')) throw new SettingsError(`${key}: lijst met tekst`, key);
      return v.map(x => x.trim().toLowerCase()).filter(Boolean);
    }
  }
}

// Check a patch from one layer. Shops may only touch editable settings; AmplifAI may touch anything.
// `null` removes a value from the layer, so the layer below shows through again.
export function checkPatch(patch, { policy, admin }) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SettingsError('settings moet een object zijn');
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!FIELDS[k]) throw new SettingsError(`Onbekende instelling: ${k}`, k);
    if (!admin && !policy[k]?.editable) throw Object.assign(new SettingsError(`${k} is vastgezet door AmplifAI`, k), { status: 403 });
    out[k] = v === null ? null : checkValue(k, v, admin ? null : policy);
  }
  return out;
}
export const applyPatch = (layer, patch) => {
  const out = { ...(layer || {}) };
  for (const [k, v] of Object.entries(patch)) if (v === null) delete out[k]; else out[k] = v;
  return out;
};

export function checkPolicy(policy) {
  const out = {};
  for (const [k, p] of Object.entries(policy || {})) {
    const f = FIELDS[k];
    if (!f) throw new SettingsError(`Onbekende instelling in policy: ${k}`, k);
    if (p.editable && f.customer === false) throw new SettingsError(`${k} kan alleen AmplifAI aanpassen`, k);
    const q = { editable: !!p.editable };
    if (p.options) { if (!Array.isArray(p.options) || p.options.some(o => !f.options?.includes(o))) throw new SettingsError(`policy.${k}.options ongeldig`, k); q.options = p.options }
    if (p.min != null) q.min = Number(p.min);
    if (p.max != null) q.max = Number(p.max);
    out[k] = q;
  }
  return out;
}

/* ── resolution ── */

// The policy a shop works under: AmplifAI's, optionally overridden for this one shop (e.g. a plan).
export const policyFor = (platform, account) => {
  const out = structuredClone(platform.policy);
  for (const [k, p] of Object.entries(account?.policy || {})) out[k] = { ...out[k], ...p };
  return out;
};

// Walk the layers. A shop value that no longer fits the policy (AmplifAI tightened it later) is skipped,
// and reported, rather than breaking generation.
export function resolve(platform, account, product) {
  const policy = policyFor(platform, account);
  const effective = {}, from = {}, warnings = [];
  for (const k of Object.keys(FIELDS)) {
    effective[k] = platform.defaults[k] ?? structuredClone(FIELDS[k].default); from[k] = 'platform';
    for (const [layer, vals, setBy] of [['account', account?.settings, account?.settingsBy], ['product', product?.settings, product?.settingsBy]]) {
      if (!vals || !(k in vals)) continue;
      const byAdmin = setBy?.[k] === 'admin';
      if (!byAdmin) {
        if (!policy[k]?.editable) { warnings.push(`${layer}.${k} genegeerd: vastgezet door AmplifAI`); continue }
        try { checkValue(k, vals[k], policy) } catch (e) { warnings.push(`${layer}.${k} genegeerd: ${e.message}`); continue }
      }
      effective[k] = vals[k]; from[k] = layer;
    }
  }
  // the quality level decides the model
  const tiers = { ...DEFAULT_TIERS, ...(platform.tiers || {}) };
  effective.model = (tiers[effective.tier] || tiers.basis).model;
  return { effective, from, policy, warnings, rules: platform.rules };
}

// What a UI needs to draw the settings form for one role.
export function describe(policy, { admin }) {
  return Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => {
    const b = bounds(k, admin ? null : policy);
    return [k, { type: f.type, label: f.label, help: f.help, editable: admin || !!policy[k]?.editable, ...(f.customer === false && { adminOnly: true }),
      ...(f.options && { options: b.options }), ...(f.min != null && { min: b.min }), ...(f.max != null && { max: f.type === 'int' ? b.max : f.max }) }];
  }));
}
