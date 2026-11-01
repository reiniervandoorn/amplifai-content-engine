// What things cost. Two different prices live here:
//   1. What a shop pays AmplifAI: a price per order, per quality level (tier). Shops only ever see this.
//   2. What AmplifAI pays Anthropic: per token and per web search. Only AmplifAI sees this.

// Anthropic list prices in USD (per million tokens; web search per 1,000 searches).
export const MODELS = {
  'claude-haiku-5-5':  { label: 'Claude Haiku 5.5',  input: 0.10, output: 0.50 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', input: 2.00, output: 10.00 },
  'claude-opus-5-5':   { label: 'Claude Opus 5.5',   input: 4.00, output: 20.00 },
  'claude-fable-5-1':  { label: 'Claude Fable 5.1',  input: 10.00, output: 50.00 },
};
export const SEARCH_PER_1000 = 10;
export const EUR_PER_USD = Number(process.env.EUR_PER_USD) || 0.92;

// The three quality levels. AmplifAI may rename them, pick their model and set their price.
export const TIER_IDS = ['basis', 'plus', 'premium'];
export const DEFAULT_TIERS = {
  basis:   { name: 'Basis',   model: 'claude-sonnet-5-5', pricePerOrder: 0.05, blurb: 'Heldere, onderbouwde gidsen voor elk product' },
  plus:    { name: 'Plus',    model: 'claude-opus-5-5',   pricePerOrder: 0.10, blurb: 'Rijkere verhalen en scherpere tips' },
  premium: { name: 'Premium', model: 'claude-fable-5-1',  pricePerOrder: 0.13, blurb: 'Het diepste onderzoek en de beste teksten' },
};

// Tokens one product typically uses, before real usage is known (two languages; more languages, more output).
const TYPICAL = { research: { input: 45000, output: 7000, searches: 6 }, write: { input: 9000, output: 11000 } };

export const usd = (model, u) => {
  const m = MODELS[model] || MODELS['claude-opus-5-5'];
  return ((u.input || 0) * m.input + (u.output || 0) * m.output) / 1e6 + (u.searches || 0) * SEARCH_PER_1000 / 1000;
};
export const eur = n => Math.round(n * EUR_PER_USD * 10000) / 10000;

// Estimated cost to write one product's guide with a model. Uses the average of real products
// written with that model once there are a few, and the typical numbers until then.
export function perProduct(model, samples = [], languages = 2) {
  const real = samples.filter(s => s.model === model && s.complete);
  if (real.length >= 3) {
    const avg = real.reduce((a, s) => a + s.usd, 0) / real.length;
    return { usd: avg, eur: eur(avg), basedOn: real.length };
  }
  const scale = Math.max(1, languages / 2);
  const est = usd(model, TYPICAL.research) + usd(model, { input: TYPICAL.write.input, output: TYPICAL.write.output * scale });
  return { usd: est, eur: eur(est), basedOn: 0 };
}
