// The HTTP API (v1). createEngine() returns a plain (req, res) handler, so it runs on its own
// (server.js) or mounts inside another Node server: app.use('/content', engine.handler).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { catalog, product as readProduct, normalizeUrl, slugOf } from './crawl.js';
import * as realAi from './ai.js';
import * as mockAi from './mock-ai.js';
import { schemas, kindOf, getPath, setPath, ICONS } from './ai.js';
import { FIELDS, LANGUAGES, defaultPlatform, checkPatch, applyPatch, checkPolicy, checkTiers, checkBudget, resolve, describe, SettingsError } from './settings.js';
import { MODELS, DEFAULT_TIERS, TIER_IDS, EUR_PER_USD, usd, eur, perProduct } from './pricing.js';
import { checkGuide, repairWish } from './quality.js';
import { identify, canAccount, mustAdmin, HttpError, newKey, hash, previewToken, checkPreviewToken } from './auth.js';
import { document, render } from './formats.js';
import { Jobs } from './jobs.js';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

// what in a product's catalog entry matters for its guide; when this changes, the guide is rewritten
const pageHash = pg => pg ? crypto.createHash('sha1').update(JSON.stringify([pg.name, pg.brand, pg.description, pg.variants, pg.properties])).digest('hex').slice(0, 16) : null;

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const now = () => new Date().toISOString();
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'shop';

// Test mode swaps Claude for fixed templates (mock-ai.js): every flow works, without a key or cost.
// AmplifAI switches between test and live in the studio; aiMode only sets where a new install starts.
export function createEngine({ store, adminKey, toolKey, toolTestKey, previewSecret, previewUrl = '', staticDir = '', corsOrigins = '*', basePath = '', aiMode = 'claude', concurrency, scheduler = true }) {
  const jobs = new Jobs({ concurrency: concurrency || 2 });
  const startMode = aiMode === 'mock' ? 'test' : 'live';
  const mode = async () => (await store.get('platform', 'main'))?.ai?.mode || startMode;
  // the made-up test stores always use the sample texts: their brands do not exist, so research would find nothing.
  // Shops made with the tool's test key do too: building the tool never costs anything.
  const ai = async a => a?.sample || a?.sandbox || (await mode()) !== 'live' ? mockAi : liveAi;
  // the key AmplifAI entered in the studio is kept on the server, never sent back
  const loadKey = async () => realAi.setApiKey((await store.get('secrets', 'anthropic'))?.key || null);
  const ready = loadKey();

  /* ── data helpers ── */
  // stored base merged over the built-in one, so settings added in a later version show up
  const platform = async () => {
    const d = defaultPlatform(), s = await store.get('platform', 'main');
    const out = s ? { ...d, ...s, defaults: { ...d.defaults, ...s.defaults }, policy: { ...d.policy, ...s.policy }, rules: s.rules || d.rules, tiers: { ...d.tiers, ...(s.tiers || {}) } } : d;
    out.ai = { mode: s?.ai?.mode || startMode };
    out.budget = { ...d.budget, ...(s?.budget || {}) };
    return out;
  };

  /* ── spending limits: live mode stops before it goes over AmplifAI's budget ──
     Every call to Claude asks first (day, month, this guide) and records its cost afterwards, per day.
     Jobs run inside jobCost, so a call knows which guide it belongs to. */
  const jobCost = new AsyncLocalStorage();
  const today = () => new Date().toISOString().slice(0, 10);
  const spentUsd = async prefix => (await store.list('spend', prefix)).reduce((n, d) => n + (d.usd || 0), 0);
  async function spending() {
    const pf = await platform(), day = await spentUsd(today()), month = await spentUsd(today().slice(0, 7));
    return { ...pf.budget, todayEUR: eur(day), monthSpentEUR: eur(month), dayLeftEUR: Math.max(0, eur(pf.budget.dayEUR / EUR_PER_USD - day)), monthLeftEUR: Math.max(0, eur(pf.budget.monthEUR / EUR_PER_USD - month)) };
  }
  const euro = n => '€' + n.toFixed(2).replace('.', ',');
  class BudgetError extends HttpError { constructor(msg) { super(402, msg); this.code = 'budget' } }
  async function mayspend(job) {
    if ((await mode()) !== 'live') throw new BudgetError('Gestopt: de engine staat in testmodus');
    const b = await spending();
    if (b.todayEUR >= b.dayEUR) throw new BudgetError(`Dagbudget bereikt (${euro(b.dayEUR)}). Morgen gaat het verder, of verhoog het onder "AI en kosten".`);
    if (b.monthSpentEUR >= b.monthEUR) throw new BudgetError(`Maandbudget bereikt (${euro(b.monthEUR)}). Verhoog het onder "AI en kosten" om verder te gaan.`);
    if (job && eur(job.usd) >= b.guideEUR) throw new BudgetError(`Deze gids kostte meer dan ${euro(b.guideEUR)} en is gestopt. Verhoog de grens per gids onder "AI en kosten" als dit klopt.`);
  }
  async function record(job, u) {
    const cost = usd(u.model, u);
    job.usd += cost;
    await locked('spend', async () => {
      const d = (await store.get('spend', today())) || { usd: 0, calls: 0 };
      d.usd += cost; d.calls++;
      await store.put('spend', today(), d);
    });
  }
  const meter = () => { const job = jobCost.getStore() || { usd: 0 }; return { before: () => mayspend(job), after: u => record(job, u) } };
  const liveAi = {
    ...realAi,
    research: (page, s, o = {}) => realAi.research(page, s, { ...o, meter: meter() }),
    writeGuide: o => realAi.writeGuide({ ...o, meter: meter() }),
    rewriteItem: o => realAi.rewriteItem({ ...o, meter: meter() }),
  };
  const qaSummary = (g, eff) => { const q = checkGuide(g, eff); return { ok: q.ok, errors: q.errors, warnings: q.warnings, at: q.checkedAt } };
  const publicTiers = pf => TIER_IDS.map(id => ({ id, name: pf.tiers[id].name, pricePerOrder: pf.tiers[id].pricePerOrder, blurb: pf.tiers[id].blurb }));
  async function account(id) { const a = await store.get('accounts', id); if (!a) throw new HttpError(404, 'Shop niet gevonden'); return a }
  async function product(acc, pid) { const p = await store.get('products', `${acc}~${pid}`); if (!p) throw new HttpError(404, 'Product niet gevonden'); return p }
  const saveProduct = p => store.put('products', `${p.accountId}~${p.id}`, { ...p, updatedAt: now() });
  // usage in tokens and searches, and what it cost AmplifAI in dollars
  const addUsage = (o, u) => {
    if (!u) return;
    o.usage = o.usage || { input: 0, output: 0, searches: 0, usd: 0 };
    for (const k of ['input', 'output', 'searches']) o.usage[k] += u[k] || 0;
    o.usage.usd = (o.usage.usd || 0) + (u.model ? usd(u.model, u) : 0);
  };
  const publicAccount = (a, who) => {
    const { webhookSecret, ...rest } = a;
    return who?.role === 'admin' || who?.accountId === a.id ? { ...rest, webhookSecret } : rest;
  };
  async function settingsFor(a, p) { return resolve(await platform(), a, p) }

  // Update one settings layer. Shops are held to the policy; AmplifAI is not, and its values are marked
  // so a later policy change does not drop them.
  async function patchLayer(obj, patch, who, a) {
    const pf = await platform();
    const admin = who.role === 'admin';
    const checked = checkPatch(patch, { policy: resolve(pf, a, null).policy, admin });
    obj.settings = applyPatch(obj.settings, checked);
    obj.settingsBy = { ...(obj.settingsBy || {}) };
    for (const [k, v] of Object.entries(checked)) if (v === null) delete obj.settingsBy[k]; else obj.settingsBy[k] = admin ? 'admin' : 'account';
  }

  async function ensurePage(a, p, say) {
    if (!p.page) { say?.('Productpagina lezen…'); p.page = await readProduct(p.url); return p }
    // the catalog gave the basics but little text: read the page too, and keep the basics if that fails
    if (!a.sample && !p.page.fetched && (p.page.description || '').length < 80) {
      say?.('Productpagina lezen…');
      try { const full = await readProduct(p.url); p.page = { ...p.page, ...Object.fromEntries(Object.entries(full).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))), fetched: true } }
      catch { p.page.fetched = true }
    }
    return p;
  }
  async function doResearch(a, p, say, force) {
    await ensurePage(a, p, say);
    if (p.research && !force) return p;
    const s = (await settingsFor(a, p)).effective;
    say('Bronnen zoeken bij merk en fabrikant…');
    const r = await (await ai(a)).research(p.page, s, { onProgress: say });
    addUsage(p, r.usage); addUsage(a, r.usage);
    delete r.usage;
    r.at = now();
    p.research = r;
    // shops without structured data: the research read brand and price from the page text
    p.page.brand ||= r.product?.brand || null;
    p.page.price ||= r.product?.price || null;
    p.status = p.guide ? p.status : 'researched';
    return p;
  }
  // Jobs re-read the product before saving, so edits made while a job ran are not thrown away.
  async function runOnProduct(accId, pid, fn) {
    const a = await account(accId), p = await product(accId, pid);
    const before = { ...(a.usage || {}) };
    await fn(a, p);
    await saveProduct(p);
    // add this job's usage to the shop, one job at a time, keeping edits made meanwhile
    await locked('acc:' + accId, async () => {
      const fresh = await account(accId);
      fresh.usage = fresh.usage || { input: 0, output: 0, searches: 0, usd: 0 };
      for (const k of ['input', 'output', 'searches', 'usd']) fresh.usage[k] = (fresh.usage[k] || 0) + (a.usage?.[k] || 0) - (before[k] || 0);
      await store.put('accounts', fresh.id, fresh);
    });
  }
  // shop saves go through the same queue as usage updates, and keep the latest usage
  const saveAccount = a => locked('acc:' + a.id, async () => {
    const fresh = await store.get('accounts', a.id);
    if (fresh?.usage) a.usage = fresh.usage;
    await store.put('accounts', a.id, a);
  });
  const locks = new Map();
  function locked(key, fn) {
    const run = (locks.get(key) || Promise.resolve()).catch(() => { }).then(fn);
    locks.set(key, run);
    run.finally(() => { if (locks.get(key) === run) locks.delete(key) }).catch(() => { });
    return run;
  }

  /* ── notifications: the AmplifAI tool hears when a guide is ready, live, changed or gone ── */
  async function emit(event, a, x, extra = {}) {
    const pf = await store.get('platform', 'main');
    const targets = [pf?.webhook?.url && { url: pf.webhook.url, secret: pf.webhook.secret }, a.webhookUrl && { url: a.webhookUrl, secret: a.webhookSecret }].filter(Boolean);
    if (!targets.length) return;
    const body = JSON.stringify({ event, at: now(), shop: a.id, product: x.url, productId: x.id, ...extra });
    for (const t of targets) (async () => {
      const sig = crypto.createHmac('sha256', t.secret || '').update(body).digest('hex');
      for (let i = 0; i < 3; i++) {
        try { const r = await fetch(t.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-amplifai-signature': 'sha256=' + sig }, body, signal: AbortSignal.timeout(10000) }); if (r.ok) return } catch { }
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      }
    })();
  }

  /* ── routes ── */
  const R = [];
  const route = (method, pattern, auth, fn) => {
    const keys = [], re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$');
    R.push({ method, re, keys, auth, fn });
  };

  route('GET', '/v1/health', 'none', async () => { await ready; const m = await mode(); return { ok: true, mode: m, aiMode: m === 'test' ? 'mock' : 'claude', ai: m === 'test' || realAi.hasKey() } });
  route('GET', '/v1/meta', 'none', async () => ({ mode: await mode(), aiMode: (await mode()) === 'test' ? 'mock' : 'claude', fields: describe(null, { admin: true }), languages: LANGUAGES, icons: ICONS, formats: ['guide', 'flat', 'markdown'] }));
  // Test mode on your own computer only: hand the studio the admin key, so logging in is one click.
  route('GET', '/v1/dev/login', 'none', async ({ req }) => {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
    if (!local || process.env.DEV_LOGIN === 'off') throw new HttpError(404, 'Alleen op je eigen computer');
    return { adminKey };
  });
  route('GET', '/v1/me', 'any', async ({ who }) => who.role !== 'account' ? { role: who.role } : { role: 'account', account: publicAccount(await account(who.accountId), who) });

  /* platform: AmplifAI's base */
  route('GET', '/v1/platform', 'admin', async () => ({ ...(await platform()), fields: describe(null, { admin: true }) }));
  route('PATCH', '/v1/platform', 'admin', async ({ body }) => {
    const pf = await platform();
    if (body.defaults) {
      const d = checkPatch(body.defaults, { policy: null, admin: true });
      for (const [k, v] of Object.entries(d)) pf.defaults[k] = v === null ? structuredClone(FIELDS[k].default) : v;
    }
    if (body.policy) pf.policy = { ...pf.policy, ...checkPolicy(body.policy) };
    if (body.tiers) pf.tiers = { ...pf.tiers, ...checkTiers(body.tiers) };
    if (body.budget) pf.budget = { ...pf.budget, ...checkBudget(body.budget) };
    if (body.refresh !== undefined) { if (!['weekly', 'monthly', 'off'].includes(body.refresh)) throw new HttpError(422, 'refresh: weekly, monthly of off'); pf.refresh = body.refresh }
    if (body.webhookUrl !== undefined) pf.webhook = body.webhookUrl ? { url: new URL(body.webhookUrl).href, secret: pf.webhook?.secret || newKey('whsec_') } : null;
    if (body.rules) {
      if (!Array.isArray(body.rules) || body.rules.some(r => typeof r !== 'string' || !r.trim())) throw new HttpError(422, 'rules: lijst met zinnen');
      pf.rules = body.rules.map(r => r.trim());
    }
    pf.updatedAt = now();
    await store.put('platform', 'main', pf);
    return { ...pf, fields: describe(null, { admin: true }) };
  });

  /* AmplifAI: test or live, the Anthropic key, and what everything costs */
  async function aiStatus() {
    await ready;
    const sec = await store.get('secrets', 'anthropic');
    return { mode: await mode(), budget: await spending(), hasKey: realAi.hasKey(), keyHint: sec?.key ? sec.key.slice(0, 10) + '…' + sec.key.slice(-4) : null, fromEnv: !sec?.key && !!process.env.ANTHROPIC_API_KEY, checkedAt: sec?.checkedAt || null };
  }
  route('GET', '/v1/admin/ai', 'admin', aiStatus);
  route('GET', '/v1/admin/budget', 'admin', spending);
  // emergency stop: back to test mode, nothing waiting starts; a guide being written stops at its next call to Claude
  route('POST', '/v1/admin/stop', 'admin', async () => {
    const pf = (await store.get('platform', 'main')) || defaultPlatform();
    pf.ai = { mode: 'test' }; pf.updatedAt = now();
    await store.put('platform', 'main', pf);
    return { mode: 'test', ...jobs.cancel(null) };
  });
  route('PUT', '/v1/admin/ai', 'admin', async ({ body }) => {
    if (body.key !== undefined) {
      if (body.key === null) await store.del('secrets', 'anthropic');
      else {
        const k = String(body.key).trim();
        if (!/^sk-ant-/.test(k)) throw new HttpError(422, 'Dit lijkt geen Anthropic-sleutel (begint met sk-ant-)');
        try { await realAi.testKey(k) } catch (e) { throw new HttpError(422, 'Anthropic accepteert deze sleutel niet: ' + (e.status === 401 ? 'ongeldige sleutel' : e.message)) }
        await store.put('secrets', 'anthropic', { key: k, checkedAt: now() });
      }
      await loadKey();
    }
    if (body.mode !== undefined) {
      if (!['test', 'live'].includes(body.mode)) throw new HttpError(422, 'mode: test of live');
      if (body.mode === 'live' && !realAi.hasKey()) throw new HttpError(409, 'Voer eerst een Anthropic-sleutel in');
      const pf = (await store.get('platform', 'main')) || defaultPlatform();
      pf.ai = { mode: body.mode }; pf.updatedAt = now();
      await store.put('platform', 'main', pf);
    }
    return aiStatus();
  });
  route('GET', '/v1/admin/costs', 'admin', async () => {
    const pf = await platform(), products = await store.list('products'), accounts = await store.list('accounts');
    const samples = products.map(x => x.lastRun).filter(Boolean);
    const tiers = TIER_IDS.map(id => {
      const t = pf.tiers[id], est = perProduct(t.model, samples);
      return { id, ...t, modelLabel: MODELS[t.model]?.label, perProductEUR: est.eur, basedOn: est.basedOn,
        breakEvenOrders: t.pricePerOrder > 0 ? Math.ceil(est.eur / t.pricePerOrder) : null };
    });
    const shops = accounts.map(a => {
      const mine = products.filter(x => x.accountId === a.id), tier = resolve(pf, a, null).effective.tier;
      const est = perProduct(pf.tiers[tier].model, samples);
      return { id: a.id, name: a.name, tier, products: mine.length, guides: mine.filter(x => x.guide).length, live: mine.filter(x => x.published).length,
        spentEUR: eur(a.usage?.usd || 0), perProductEUR: est.eur };
    });
    return { eurPerUsd: EUR_PER_USD, mode: await mode(), refresh: pf.refresh, budget: await spending(), tiers, shops, totalEUR: eur(accounts.reduce((n, a) => n + (a.usage?.usd || 0), 0)),
      models: Object.entries(MODELS).map(([id, m]) => ({ id, ...m })), searchPer1000: 10 };
  });
  route('GET', '/v1/tiers', 'any', async () => publicTiers(await platform()));

  /* ── the AmplifAI tool: make a guide, read it, approve it ──
     The tool owns each shop's toggles and sends them along; the engine keeps the guides current. */
  const shopOf = async (sh, who, create) => {
    const id = slug(typeof sh === 'string' ? sh : sh?.id || '');
    if (!id || id === 'shop') throw new HttpError(422, 'shop.id is verplicht');
    let a = await store.get('accounts', id);
    if (!a && create) {
      a = { id, name: String(sh.name || id).slice(0, 80), shopUrl: sh.url ? normalizeUrl(sh.url).origin : null, createdAt: now(), settings: {}, settingsBy: {}, policy: {},
        autoPublish: false, publicKey: newKey('pk_'), webhookUrl: null, webhookSecret: newKey('whsec_'), usage: { input: 0, output: 0, searches: 0 }, createdBy: who.role, via: 'tool-api', ...(who.sandbox && { sandbox: true }) };
      await store.put('accounts', id, a);
    }
    if (!a) throw new HttpError(404, 'Shop niet gevonden: ' + id);
    sandboxCheck(who, a);
    if (sh?.name && sh.name !== a.name) { a.name = String(sh.name).slice(0, 80); await saveAccount(a) }
    return a;
  };
  // the test key only reaches shops it made itself and the made-up test stores
  const sandboxCheck = (who, a) => { if (who?.sandbox && !a.sandbox && !a.sample) throw new HttpError(403, 'De testsleutel kan alleen bij testshops; gebruik de echte toolsleutel') };
  // a product is a URL, or what the tool already knows about it: {url, name, brand, price, description, image, ...}
  const pageFrom = o => typeof o === 'string' || !o?.name ? null : {
    url: normalizeUrl(o.url).href, name: String(o.name), brand: o.brand || null, price: o.price || null, category: o.category || null,
    description: o.description || '', pageText: o.description || '', variants: Array.isArray(o.variants) ? o.variants.map(String) : [],
    properties: Array.isArray(o.properties) ? o.properties.map(String) : [], image: o.image || null, sku: o.sku || null, gtin: o.gtin || null };
  const statusOf = x => jobs.busy(x.accountId, x.id) ? 'writing' : x.removedAt ? 'removed' : x.lastError ? 'failed' : x.published ? 'live' : x.held ? 'waiting' : x.guide ? 'ready' : 'new';
  route('POST', '/v1/guides', 'tool', async ({ body, who }) => {
    const a = await shopOf(body.shop, who, true);
    await aiReady(a);
    const given = [...(body.products || []), ...(body.product ? [body.product] : [])];
    if (!given.length || given.length > 500) throw new HttpError(422, 'Geef 1 tot 500 producten (product of products)');
    if (given.some(o => !(typeof o === 'string' ? o : o?.url))) throw new HttpError(422, 'Elk product is een url, of een object met url');
    // the shop's toggles from the tool, held to AmplifAI's limits
    const checked = body.settings ? checkPatch(body.settings, { policy: (await settingsFor(a, null)).policy, admin: false }) : null;
    const out = [];
    for (const o of given) {
      const pg = pageFrom(o), url = normalizeUrl(typeof o === 'string' ? o : o.url).href;
      const x = await ensureProduct(a, url, pg && { page: pg });
      // the tool sent product data that differs from what the guide was written from: rewrite it
      const changed = !!(pg && x.guide && pageHash(pg) !== x.sourceHash);
      if (pg && (pageHash(pg) !== x.sourceHash || x.pageFrom !== 'tool')) { x.page = pg; x.sourceHash = pageHash(pg); x.pageFrom = 'tool'; if (changed) x.research = null; await saveProduct(x) }
      if (checked) { x.settings = Object.fromEntries(Object.entries(checked).filter(([, v]) => v !== null)); x.settingsBy = Object.fromEntries(Object.keys(x.settings).map(k => [k, 'tool'])); await saveProduct(x) }
      if (jobs.busy(a.id, x.id)) { out.push({ product: url, productId: x.id, status: 'writing' }); continue }
      if (x.guide && !body.regenerate && !changed) { out.push({ product: url, productId: x.id, status: statusOf(x) }); continue }
      if (x.lastError) { x.lastError = null; await saveProduct(x) }
      const j = startJob('generate', a, x.id, generate(a, x.id, null, who, { publish: body.approve === 'auto' })).body;
      out.push({ product: url, productId: x.id, status: 'writing', job: j.id });
    }
    return { $status: 202, body: { shop: a.id, guides: out } };
  });
  route('GET', '/v1/guides', 'tool', async ({ q, who }) => {
    const a = await shopOf(q.shop, who);
    if (!q.product) return (await store.list('products', a.id + '~')).map(x => ({ product: x.url, productId: x.id, name: x.page?.name || null, status: statusOf(x), qa: x.qa || null, version: x.published?.version || null, updatedAt: x.updatedAt }));
    const x = await store.get('products', `${a.id}~${q.product.includes('/') ? slugOf(normalizeUrl(q.product).href) : q.product}`);
    if (!x) throw new HttpError(404, 'Product niet gevonden');
    const eff = (await settingsFor(a, x)).effective;
    const doc = q.version === 'published' ? x.published?.document : x.guide && document(a, x, eff);
    return { product: x.url, productId: x.id, status: statusOf(x), qa: x.guide ? checkGuide(x.guide, eff) : null, version: x.published?.version || null, updatedAt: x.updatedAt, error: x.lastError || null,
      guide: doc ? (q.format && q.format !== 'guide' ? render(doc, q.format, q.lang).body : doc) : null };
  });
  // the toggles a shop may change, with the options AmplifAI allows and the default for each: the tool builds its settings screen from this
  route('GET', '/v1/guides/options', 'tool', async () => {
    const pf = await platform(), policy = resolve(pf, { settings: {}, policy: {} }, null).policy;
    const fields = Object.entries(describe(policy, { admin: false })).filter(([, f]) => f.editable && !f.adminOnly);
    return { tiers: publicTiers(pf), languages: LANGUAGES, settings: Object.fromEntries(fields.map(([k, f]) => [k, { ...f, default: pf.defaults[k] }])) };
  });
  route('POST', '/v1/guides/approve', 'tool', async ({ body, who }) => {
    const a = await shopOf(body.shop, who), urls = [...(body.products || []), ...(body.product ? [body.product] : [])];
    const out = [];
    for (const u of urls) {
      const x = await store.get('products', `${a.id}~${u.includes('/') ? slugOf(normalizeUrl(u).href) : u}`);
      if (!x?.guide) { out.push({ product: u, status: 'not-ready' }); continue }
      const eff = (await settingsFor(a, x)).effective;
      if (!passes(x, eff) && !body.force) { out.push({ product: x.url, status: 'waiting', reason: 'quality' }); continue }
      publishNow(a, x, eff); x.held = false; await saveProduct(x); emit('guide.published', a, x, { version: x.published.version });
      out.push({ product: x.url, status: 'live', version: x.published.version });
    }
    return { guides: out };
  });
  route('POST', '/v1/guides/remove', 'tool', async ({ body, who }) => {
    const a = await shopOf(body.shop, who), x = await store.get('products', `${a.id}~${String(body.product).includes('/') ? slugOf(normalizeUrl(body.product).href) : body.product}`);
    if (!x) throw new HttpError(404, 'Product niet gevonden');
    x.published = null; x.status = x.guide ? 'draft' : x.status; await saveProduct(x); emit('guide.removed', a, x);
    return { removed: true };
  });
  route('GET', '/v1/admin/connection', 'admin', async () => {
    const pf = await store.get('platform', 'main');
    return { toolKey, toolTestKey: toolTestKey || null, webhook: pf?.webhook || null };
  });

  /* accounts: one per shop */
  route('GET', '/v1/accounts', 'admin', async ({ who }) => (await store.list('accounts')).map(a => publicAccount(a, who)));
  route('POST', '/v1/accounts', 'admin', async ({ body, who }) => {
    if (!body.name) throw new HttpError(422, 'name is verplicht');
    let id = body.id ? slug(body.id) : slug(body.name);
    if (await store.get('accounts', id)) { if (body.id) throw new HttpError(409, 'Deze id bestaat al'); id += '-' + Math.random().toString(36).slice(2, 6) }
    const a = { id, name: String(body.name).slice(0, 80), shopUrl: body.shopUrl ? normalizeUrl(body.shopUrl).origin : null, createdAt: now(),
      settings: {}, settingsBy: {}, policy: {}, studioMode: body.studioMode === 'expert' ? 'expert' : 'simple', autoPublish: body.autoPublish !== false, publicKey: newKey('pk_'), webhookUrl: null, webhookSecret: newKey('whsec_'), usage: { input: 0, output: 0, searches: 0 }, ...(body.bench && { bench: true }) };
    if (body.settings) await patchLayer(a, body.settings, who, a);
    if (body.policy) a.policy = checkPolicy(body.policy);
    const secret = newKey('sk_');
    await store.put('keys', hash(secret), { accountId: id, hash: hash(secret), createdAt: now() });
    a.secretKeyHint = secret.slice(0, 7) + '…' + secret.slice(-4);
    await store.put('accounts', id, a);
    return { $status: 201, body: { account: publicAccount(a, who), secretKey: secret } };
  });
  route('GET', '/v1/accounts/:acc', 'account', async ({ p, who }) => publicAccount(await account(p.acc), who));
  route('PATCH', '/v1/accounts/:acc', 'account', async ({ p, body, who }) => {
    const a = await account(p.acc);
    if (body.name != null) a.name = String(body.name).slice(0, 80);
    if (body.shopUrl !== undefined) a.shopUrl = body.shopUrl ? normalizeUrl(body.shopUrl).origin : null;
    if (body.webhookUrl !== undefined) a.webhookUrl = body.webhookUrl ? new URL(body.webhookUrl).href : null;
    if (body.studioMode !== undefined) { if (!['simple', 'expert'].includes(body.studioMode)) throw new HttpError(422, 'studioMode: simple of expert'); a.studioMode = body.studioMode }
    if (body.autoPublish !== undefined) a.autoPublish = !!body.autoPublish;
    if (body.settings) await patchLayer(a, body.settings, who, a);
    if (body.policy) { mustAdmin(who); a.policy = { ...a.policy, ...checkPolicy(body.policy) } }
    await saveAccount(a);
    return publicAccount(a, who);
  });
  route('DELETE', '/v1/accounts/:acc', 'admin', async ({ p }) => {
    for (const x of await store.list('products', p.acc + '~')) await store.del('products', `${p.acc}~${x.id}`);
    await store.del('catalogs', p.acc); await store.del('accounts', p.acc);
    return { deleted: true };
  });
  // New secret key: the old one stops working. New public key: widgets must be updated.
  route('POST', '/v1/accounts/:acc/keys', 'account', async ({ p, body }) => {
    const a = await account(p.acc);
    if (body.type === 'public') { a.publicKey = newKey('pk_'); await saveAccount(a); return { publicKey: a.publicKey } }
    for (const k of await store.list('keys')) if (k.accountId === a.id) await store.del('keys', k.hash);
    const secret = newKey('sk_');
    await store.put('keys', hash(secret), { accountId: a.id, hash: hash(secret), createdAt: now() });
    a.secretKeyHint = secret.slice(0, 7) + '…' + secret.slice(-4);
    await saveAccount(a);
    return { secretKey: secret };
  });
  route('GET', '/v1/accounts/:acc/settings', 'account', async ({ p, who }) => {
    const a = await account(p.acc), pf = await platform(), r = resolve(pf, a, null);
    return { ...r, layer: a.settings, fields: describe(r.policy, { admin: who.role === 'admin' }), tiers: publicTiers(pf) };
  });

  /* catalog */
  route('GET', '/v1/accounts/:acc/catalog', 'account', async ({ p }) => (await store.get('catalogs', p.acc)) || { products: [] });
  route('POST', '/v1/accounts/:acc/catalog', 'account', async ({ p, body }) => {
    const a = await account(p.acc), url = body.url || a.shopUrl;
    if (!url) throw new HttpError(422, 'Geef een url, of zet shopUrl op de shop');
    // the made-up sample shop does not exist online: its catalog is the one the seed stored
    const stored = await store.get('catalogs', a.id);
    if (a.sample && stored && (!body.url || normalizeUrl(body.url).origin === a.shopUrl)) return stored;
    const c = await catalog(url);
    if (!a.shopUrl) a.shopUrl = new URL(c.products[0]?.url || normalizeUrl(url).href).origin;
    a.domain ||= c.shop.domain; a.accent ||= c.shop.accent;
    await saveAccount(a);
    await store.put('catalogs', a.id, c);
    return c;
  });

  /* products */
  const summary = p => ({ id: p.id, url: p.url, name: p.page?.name || null, brand: p.page?.brand || null, image: p.page?.image || null,
    status: p.status, published: p.published ? { version: p.published.version, at: p.published.at } : null, updatedAt: p.updatedAt,
    busy: jobs.busy(p.accountId, p.id)?.status || null, error: p.lastError || null, hasGuide: !!p.guide, removed: !!p.removedAt, qa: p.qa ? { ok: p.qa.ok, errors: p.qa.errors } : null });
  route('GET', '/v1/accounts/:acc/products', 'account', async ({ p }) => (await store.list('products', p.acc + '~')).map(summary));
  route('POST', '/v1/accounts/:acc/products', 'account', async ({ p, body }) => {
    const a = await account(p.acc), url = normalizeUrl(body.url).href;
    const x = await ensureProduct(a, url);
    if (!x.page) { await ensurePage(a, x); await saveProduct(x) }
    return { $status: 201, body: await full(a, x) };
  });
  async function ensureProduct(a, url, fromCatalog) {
    const id = slugOf(url);
    let x = await store.get('products', `${a.id}~${id}`);
    if (x) return x;
    const c = fromCatalog || (await store.get('catalogs', a.id))?.products?.find(p => p.url === url);
    x = { id, accountId: a.id, url, createdAt: now(), status: 'new', settings: {}, settingsBy: {}, locked: [], removed: [], page: c?.page || null, sourceHash: pageHash(c?.page), research: null, guide: null, published: null };
    await saveProduct(x);
    return x;
  }
  async function full(a, x) {
    const r = await settingsFor(a, x);
    return { ...x, published: x.published ? { version: x.published.version, at: x.published.at } : null, effectiveSettings: r.effective, settingsFrom: r.from, warnings: r.warnings,
      qa: x.guide ? checkGuide(x.guide, r.effective) : null };
  }
  route('GET', '/v1/accounts/:acc/products/:pid', 'account', async ({ p }) => full(await account(p.acc), await product(p.acc, p.pid)));
  route('PATCH', '/v1/accounts/:acc/products/:pid', 'account', async ({ p, body, who }) => {
    const a = await account(p.acc), x = await product(p.acc, p.pid);
    if (body.settings) await patchLayer(x, body.settings, who, a);
    if (body.locked) { if (!Array.isArray(body.locked)) throw new HttpError(422, 'locked: lijst met paden'); x.locked = [...new Set(body.locked.map(String))] }
    if (body.removed) x.removed = body.removed.map(String).slice(0, 100);
    if (body.factsOn && x.research) for (const f of x.research.facts) f.on = body.factsOn.includes(f.id);
    if (body.guide) {
      const v = schemas((await settingsFor(a, x)).effective.languages).Guide.safeParse(body.guide);
      if (!v.success) throw new HttpError(422, 'guide past niet in het formaat: ' + v.error.issues[0]?.path.join('.') + ' ' + v.error.issues[0]?.message);
      x.guide = v.data; x.status = 'draft';
      x.qa = qaSummary(x.guide, (await settingsFor(a, x)).effective);
    }
    await saveProduct(x);
    return full(a, x);
  });
  route('DELETE', '/v1/accounts/:acc/products/:pid', 'account', async ({ p }) => { await product(p.acc, p.pid); await store.del('products', `${p.acc}~${p.pid}`); return { deleted: true } });

  /* jobs: research, generate, rewrite one item, batch */
  // live mode without a key would only start jobs that fail: say so straight away
  async function aiReady(a) {
    await ready;
    if (a?.sample || a?.sandbox || (await mode()) !== 'live') return;
    if (!realAi.hasKey()) throw new HttpError(409, 'Live-modus staat aan, maar er is geen Anthropic-sleutel. Voer de sleutel in of zet de engine in testmodus.');
    await mayspend();
  }
  function startJob(type, a, pid, fn) {
    const busy = jobs.busy(a.id, pid);
    if (busy) throw new HttpError(409, `Er loopt al een taak voor dit product (${busy.id})`);
    const webhook = a.webhookUrl ? { url: a.webhookUrl, secret: a.webhookSecret } : null;
    const friendly = say => fn(say).catch(async e => {
      const msg = explain(e)[1].error;
      try { const x = await product(a.id, pid); x.lastError = msg; await saveProduct(x); emit('guide.failed', a, x, { error: msg }) } catch { }
      throw new Error(msg);
    });
    return { $status: 202, body: jobs.start({ type, accountId: a.id, productId: pid, webhook }, say => jobCost.run({ usd: 0 }, () => friendly(say))) };
  }
  // automatic go-live only for guides that pass the AmplifAI quality check; the rest waits for the shop
  const passes = (x, settings) => !!x.guide && checkGuide(x.guide, settings).ok;
  function autoPublish(a, x, settings) {
    if (passes(x, settings)) { publishNow(a, x, settings); x.held = false; return true }
    x.held = true; return false;
  }
  function publishNow(a, x, settings) {
    x.published = { version: (x.published?.version || 0) + 1, at: now(), document: document(a, x, settings) };
    x.status = 'published';
  }
  const generate = (a, pid, settings, who, { publish = false } = {}) => async say => {
    await runOnProduct(a.id, pid, async (A, x) => {
      if (settings) await patchLayer(x, settings, who, A);
      const startUsd = x.usage?.usd || 0, researched = !x.research;
      await doResearch(A, x, say);
      const r = await settingsFor(A, x);
      say(`Gids schrijven (${r.effective.languages.join(', ')})…`);
      const AI = await ai(A);
      const { guide, usage } = await AI.writeGuide({ page: x.page, research: x.research, shop: { name: A.name, domain: A.domain }, settings: r.effective, rules: r.rules, current: x.guide, locked: x.locked, removed: x.removed });
      addUsage(x, usage); addUsage(A, usage);
      x.guide = guide; x.status = 'draft'; x.lastError = null;
      const test = AI === mockAi;
      x.generatedWith = { settings: r.effective, at: now(), ...(test && { mock: true }) };
      // hold the guide against the AmplifAI rules; in live mode, rewrite what breaks them (once)
      let qa = checkGuide(x.guide, r.effective);
      if (!test && qa.errors) {
        const byItem = new Map();
        for (const i of qa.issues) if (i.level === 'error' && !x.locked.includes(i.item) && getPath(x.guide, i.item) != null && kindOf(i.item) in schemas(r.effective.languages).item) byItem.set(i.item, [...(byItem.get(i.item) || []), i]);
        for (const [item, list] of [...byItem].slice(0, 6)) {
          say('Kwaliteitscheck: ' + list[0].msg.toLowerCase() + '…');
          try {
            const fixed = await AI.rewriteItem({ page: x.page, research: x.research, shop: { name: A.name, domain: A.domain }, settings: r.effective, rules: r.rules, current: x.guide, path: item, wish: repairWish(list) });
            addUsage(x, fixed.usage); addUsage(A, fixed.usage);
            setPath(x.guide, item, fixed.item);
          } catch { }
        }
        qa = checkGuide(x.guide, r.effective);
      }
      x.qa = { ok: qa.ok, errors: qa.errors, warnings: qa.warnings, at: qa.checkedAt };
      // what this product cost from start to finish: the basis for AmplifAI's cost estimates
      if (!test && researched) x.lastRun = { model: r.effective.model, usd: (x.usage?.usd || 0) - startUsd, complete: true, at: now() };
      if (publish && !autoPublish(A, x, r.effective)) say('Wacht op de shop: wijkt af van de richtlijnen');
      emit(x.published && publish ? 'guide.published' : 'guide.ready', A, x, { qa: x.qa, version: x.published?.version || null, held: !!x.held });
    });
  };
  route('POST', '/v1/accounts/:acc/products/:pid/research', 'account', async ({ p, body }) => {
    const a = await account(p.acc); await aiReady(a);
    await product(p.acc, p.pid);
    return startJob('research', a, p.pid, say => runOnProduct(a.id, p.pid, (A, x) => doResearch(A, x, say, body.force !== false)));
  });
  route('POST', '/v1/accounts/:acc/products/:pid/generate', 'account', async ({ p, body, who }) => {
    const a = await account(p.acc); await aiReady(a);
    await product(p.acc, p.pid);
    if (body.settings) checkPatch(body.settings, { policy: (await settingsFor(a, null)).policy, admin: who.role === 'admin' }); // fail now, not in the job
    return startJob('generate', a, p.pid, generate(a, p.pid, body.settings, who));
  });
  route('POST', '/v1/accounts/:acc/products/:pid/items/:path/rewrite', 'account', async ({ p, body }) => {
    const a = await account(p.acc); await aiReady(a);
    const x = await product(p.acc, p.pid);
    if (!x.guide) throw new HttpError(409, 'Genereer eerst een gids');
    if (getPath(x.guide, p.path) == null) throw new HttpError(404, 'Onderdeel niet gevonden: ' + p.path);
    if (x.locked.includes(p.path)) throw new HttpError(409, 'Dit onderdeel is vastgezet; maak het eerst los');
    return startJob('rewrite', a, p.pid, say => runOnProduct(a.id, p.pid, async (A, y) => {
      say('Onderdeel herschrijven…');
      const r = await settingsFor(A, y);
      const { item, usage } = await (await ai(A)).rewriteItem({ page: y.page, research: y.research, shop: { name: A.name, domain: A.domain }, settings: r.effective, rules: r.rules, current: y.guide, path: p.path, wish: body.wish });
      addUsage(y, usage); addUsage(A, usage);
      setPath(y.guide, p.path, item); y.status = 'draft';
      y.qa = qaSummary(y.guide, r.effective);
    }));
  });
  route('POST', '/v1/accounts/:acc/batch', 'account', async ({ p, body, who }) => {
    const a = await account(p.acc); await aiReady(a);
    const urls = [...(body.urls || []).map(u => normalizeUrl(u).href)], ids = [...(body.productIds || [])];
    if (urls.length + ids.length === 0 || urls.length + ids.length > 200) throw new HttpError(422, 'Geef 1 tot 200 urls of productIds');
    for (const u of urls) {
      const id = slugOf(u);
      if (!(await store.get('products', `${a.id}~${id}`))) await saveProduct({ id, accountId: a.id, url: u, createdAt: now(), status: 'new', settings: {}, settingsBy: {}, locked: [], removed: [], page: null, research: null, guide: null, published: null });
      ids.push(id);
    }
    const out = [];
    for (const id of [...new Set(ids)]) {
      try { out.push((startJob('generate', a, id, generate(a, id, null, who))).body) } catch (e) { out.push({ productId: id, error: e.message }) }
    }
    return { $status: 202, body: { jobs: out } };
  });
  route('GET', '/v1/jobs/:id', 'any', async ({ p, who }) => {
    const j = jobs.get(p.id);
    if (!j) throw new HttpError(404, 'Taak niet gevonden (of de server is herstart)');
    canAccount(who, j.accountId);
    return j;
  });
  route('GET', '/v1/accounts/:acc/jobs', 'account', async ({ p }) => jobs.list(p.acc));

  /* hand edits on one item */
  route('PUT', '/v1/accounts/:acc/products/:pid/items/:path', 'account', async ({ p, body }) => {
    const a = await account(p.acc), x = await product(p.acc, p.pid);
    if (!x.guide || getPath(x.guide, p.path) == null) throw new HttpError(404, 'Onderdeel niet gevonden: ' + p.path);
    const schema = schemas((await settingsFor(a, x)).effective.languages).item[kindOf(p.path)];
    const v = schema.safeParse(body.value);
    if (!v.success) throw new HttpError(422, 'value past niet: ' + v.error.issues[0]?.path.join('.') + ' ' + v.error.issues[0]?.message);
    setPath(x.guide, p.path, v.data);
    x.qa = qaSummary(x.guide, (await settingsFor(a, x)).effective);
    if (body.lock !== false && !x.locked.includes(p.path)) x.locked.push(p.path);
    x.status = 'draft';
    await saveProduct(x);
    return full(a, x);
  });
  // Removing shifts later items up, so locks on them move along.
  route('DELETE', '/v1/accounts/:acc/products/:pid/items/:path', 'account', async ({ p }) => {
    const a = await account(p.acc), x = await product(p.acc, p.pid);
    const ks = p.path.split('.'), i = Number(ks.pop()), base = ks.join('.'), arr = x.guide && getPath(x.guide, base);
    if (!Array.isArray(arr) || !Number.isInteger(i) || !arr[i]) throw new HttpError(404, 'Alleen items in een lijst kunnen weg: ' + p.path);
    if (['answerTips', 'q.options'].includes(base)) throw new HttpError(409, 'Antwoorden en hun tips horen bij elkaar; herschrijf de vraag in plaats daarvan');
    if (arr.length <= 1) throw new HttpError(409, 'Het laatste item van een lijst blijft staan');
    const [gone] = arr.splice(i, 1);
    const label = Object.values(gone.title || gone.lead || {})[0];
    if (label) x.removed = [...x.removed, label].slice(-100);
    x.locked = x.locked.flatMap(l => { if (!l.startsWith(base + '.')) return [l]; const j = Number(l.slice(base.length + 1)); return j === i ? [] : [j > i ? `${base}.${j - 1}` : l] });
    x.status = 'draft';
    await saveProduct(x);
    return full(a, x);
  });

  /* publish: a frozen copy for widgets; editing the draft afterwards does not change what customers see */
  route('POST', '/v1/accounts/:acc/products/:pid/publish', 'account', async ({ p, body }) => {
    const a = await account(p.acc), x = await product(p.acc, p.pid);
    if (!x.guide) throw new HttpError(409, 'Nog geen gids om te publiceren');
    const eff = (await settingsFor(a, x)).effective;
    // a guide that breaks an AmplifAI rule goes live only when the shop says so explicitly
    if (!passes(x, eff) && !body.force) throw Object.assign(new HttpError(409, 'Deze gids wijkt af van de AmplifAI-richtlijnen. Pas hem aan, of zet hem bewust toch live.'), { code: 'quality' });
    publishNow(a, x, eff); x.held = false;
    await saveProduct(x);
    emit('guide.published', a, x, { version: x.published.version });
    return { version: x.published.version, at: x.published.at };
  });
  // every product with a draft that is not live yet (or changed since)
  route('POST', '/v1/accounts/:acc/publish-all', 'account', async ({ p }) => {
    const a = await account(p.acc);
    let n = 0, held = 0;
    for (const x of await store.list('products', a.id + '~')) {
      if (!x.guide || x.removedAt || jobs.busy(a.id, x.id) || (x.published && new Date(x.updatedAt) <= new Date(x.published.at))) continue;
      if (autoPublish(a, x, (await settingsFor(a, x)).effective)) n++; else held++;
      await saveProduct(x);
    }
    return { published: n, held };
  });

  /* autopilot: every product in the catalog, written (and optionally published) in one go */
  async function autopilotStatus(a) {
    const all = await store.list('products', a.id + '~'), L = all.filter(x => !x.removedAt), c = { removed: all.length - L.length, held: 0, total: L.length, waiting: 0, working: 0, ready: 0, live: 0, failed: 0, todo: 0 };
    for (const x of L) {
      const j = jobs.busy(a.id, x.id);
      if (j) c[j.status === 'running' ? 'working' : 'waiting']++;
      else if (x.lastError) c.failed++;
      else if (x.published) c.live++;
      else if (x.guide && x.qa && !x.qa.ok) c.held++;
      else if (x.guide) c.ready++;
      else c.todo++;
    }
    const cat = await store.get('catalogs', a.id), have = new Set(all.map(x => x.url));
    const inCatalog = cat?.products?.length || 0, notAdded = (cat?.products || []).filter(x => !have.has(x.url)).length;
    // the most common reason products failed, so the studio can say what went wrong
    const reasons = {};
    for (const x of L) if (x.lastError && !jobs.busy(a.id, x.id)) { const k = x.lastError.replace(/https?:\/\/\S+/g, '…'); reasons[k] = (reasons[k] || 0) + 1 }
    const topError = Object.entries(reasons).sort((p, q) => q[1] - p[1])[0]?.[0] || null;
    return { ...c, inCatalog, notAdded, topError, lastSync: a.lastSync || null, sync: a.syncResult || null, running: c.waiting + c.working > 0, startedAt: a.autopilot?.startedAt || null, publish: a.autoPublish !== false };
  }
  /* keeping guides current: new products get a guide, removed ones go offline, changed ones are rewritten */
  async function syncAccount(a, who = { role: 'admin' }) {
    const result = { at: now(), added: 0, removed: 0, changed: 0, returned: 0, error: null };
    try {
      if (!a.shopUrl) throw new Error('Geen webshop-adres');
      const stored = await store.get('catalogs', a.id);
      const cat = a.sample && stored ? stored : await catalog(a.shopUrl);
      await store.put('catalogs', a.id, cat);
      const all = await store.list('products', a.id + '~'), byUrl = new Map(all.map(x => [x.url, x])), inCat = new Map(cat.products.map(c => [c.url, c]));
      const live = a.sample || (await mode()) === 'test' || realAi.hasKey(), autoPub = a.autoPublish !== false;
      // shops the AmplifAI tool made: the tool says which products get a guide and sends new product data itself,
      // so the check only rewrites guides whose catalog page changed, and never adds or removes products.
      // New catalog products only get a guide on their own when the shop asked for its whole catalog.
      const toolShop = a.via === 'tool-api' || a.createdBy === 'tool', addNew = !toolShop && !!a.autopilot?.all;
      const write = async x => { if (live && !jobs.busy(a.id, x.id)) startJob('generate', a, x.id, generate(a, x.id, null, who, { publish: autoPub || !!x.published })) };
      if (all.length && addNew) for (const c of cat.products) if (!byUrl.has(c.url)) { await write(await ensureProduct(a, c.url, c)); result.added++ }
      for (const x of all) {
        const c = inCat.get(x.url);
        if (toolShop && (!c || x.removedAt || x.pageFrom === 'tool')) continue;
        if (!c && !x.removedAt) { x.removedAt = now(); x.wasLive = !!x.published; x.published = null; x.status = 'removed'; await saveProduct(x); emit('guide.removed', a, x); result.removed++; continue }
        if (c && x.removedAt) { delete x.removedAt; x.status = x.guide ? 'draft' : 'new'; if (x.guide && (x.wasLive || autoPub)) autoPublish(a, x, (await settingsFor(a, x)).effective); await saveProduct(x); result.returned++; continue }
        const h = pageHash(c?.page);
        if (c?.page && x.sourceHash && h !== x.sourceHash && x.guide) {
          x.page = { ...c.page }; x.sourceHash = h; x.research = null; await saveProduct(x); await write(x); result.changed++;
        }
      }
    } catch (e) { result.error = e.message }
    const fresh = await account(a.id); fresh.lastSync = result.at; fresh.syncResult = result; await saveAccount(fresh);
    return result;
  }
  route('POST', '/v1/accounts/:acc/sync', 'account', async ({ p, who }) => syncAccount(await account(p.acc), who));
  // a shop's own system can say exactly what changed, without waiting for the next check
  route('POST', '/v1/accounts/:acc/products/events', 'account', async ({ p, body, who }) => {
    const a = await account(p.acc), out = { added: 0, removed: 0 };
    for (const u of body.added || []) { const x = await ensureProduct(a, normalizeUrl(u).href); if (!x.guide && !jobs.busy(a.id, x.id)) { await aiReady(a); startJob('generate', a, x.id, generate(a, x.id, null, who, { publish: a.autoPublish !== false })) } out.added++ }
    for (const u of body.removed || []) { const x = await store.get('products', `${a.id}~${slugOf(normalizeUrl(u).href)}`); if (x && !x.removedAt) { x.removedAt = now(); x.wasLive = !!x.published; x.published = null; x.status = 'removed'; await saveProduct(x); out.removed++ } }
    return out;
  });
  // every quarter of an hour: which shops are due for their weekly or monthly check
  if (scheduler) {
    const DAY = 864e5;
    const t = setInterval(async () => {
      try {
        const pf = await platform();
        if (pf.refresh === 'off') return;
        const every = pf.refresh === 'monthly' ? 30 * DAY : 7 * DAY;
        for (const a of await store.list('accounts')) {
          if (!a.shopUrl || (a.lastSync && Date.now() - new Date(a.lastSync) < every)) continue;
          if (!(await store.list('products', a.id + '~')).length) continue;
          await syncAccount(a);
        }
      } catch { }
    }, 15 * 60e3);
    t.unref?.();
  }

  route('GET', '/v1/accounts/:acc/autopilot', 'account', async ({ p }) => autopilotStatus(await account(p.acc)));
  route('POST', '/v1/accounts/:acc/autopilot/stop', 'account', async ({ p }) => { await account(p.acc); return jobs.cancel(p.acc) });
  route('POST', '/v1/accounts/:acc/autopilot', 'account', async ({ p, body, who }) => {
    const a = await account(p.acc); await aiReady(a);
    if (body.settings) { await patchLayer(a, body.settings, who, a) }
    if (body.publish !== undefined) a.autoPublish = !!body.publish;
    const autoPub = a.autoPublish !== false;
    if (body.url) a.shopUrl = normalizeUrl(body.url).origin;
    let cat = await store.get('catalogs', a.id);
    if (body.url || body.refreshCatalog || !cat) {
      if (!a.shopUrl) throw new HttpError(422, 'Geef het adres van je webshop');
      const stored = cat;
      cat = a.sample && stored ? stored : await catalog(a.shopUrl);
      a.domain ||= cat.shop.domain; a.accent ||= cat.shop.accent;
      await store.put('catalogs', a.id, cat);
    }
    // limit = how many new guides to start; products that already have one do not count
    const max = Number(body.limit) || Infinity;
    const list = body.productIds?.length ? cat.products.filter(x => body.productIds.includes(x.id) || body.productIds.includes(slugOf(x.url))) : cat.products;
    let started = 0;
    for (const c of list) {
      if (started >= max) break;
      const x = await ensureProduct(a, c.url, c);
      if (jobs.busy(a.id, x.id)) continue;
      if (x.guide && !body.regenerate) {
        if (autoPub && !x.published) { autoPublish(a, x, (await settingsFor(a, x)).effective); await saveProduct(x) }
        continue;
      }
      if (x.lastError) { x.lastError = null; await saveProduct(x) }
      startJob('generate', a, x.id, generate(a, x.id, null, who, { publish: autoPub }));
      started++;
    }
    a.autopilot = { startedAt: now(), publish: autoPub, count: list.length, all: !body.productIds?.length && !body.limit };
    await saveAccount(a);
    return { $status: 202, body: { started, inCatalog: cat.products.length, considered: list.length, ...(await autopilotStatus(a)) } };
  });
  route('DELETE', '/v1/accounts/:acc/products/:pid/publish', 'account', async ({ p }) => {
    const x = await product(p.acc, p.pid); x.published = null; x.status = x.guide ? 'draft' : x.status; await saveProduct(x); return { unpublished: true };
  });
  route('GET', '/v1/accounts/:acc/products/:pid/export', 'account', async ({ p, q }) => {
    const a = await account(p.acc), x = await product(p.acc, p.pid);
    const doc = q.version === 'published' ? x.published?.document : x.guide && document(a, x, (await settingsFor(a, x)).effective);
    if (!doc) throw new HttpError(404, q.version === 'published' ? 'Niet gepubliceerd' : 'Nog geen gids');
    return { raw: render(doc, q.format, q.lang) };
  });
  route('POST', '/v1/accounts/:acc/products/:pid/preview', 'account', async ({ p, req }) => {
    const a = await account(p.acc); await product(p.acc, p.pid);
    const token = previewToken(previewSecret, a.id, p.pid);
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}${basePath}`;
    const fill = s => s.replaceAll('{engine}', encodeURIComponent(origin)).replaceAll('{publicKey}', a.publicKey).replaceAll('{productId}', encodeURIComponent(p.pid)).replaceAll('{token}', token);
    // without PREVIEW_URL the engine's own preview page shows the guide as the customer sees it
    const own = `${origin}/guide-preview?${new URLSearchParams({ engine: origin, pk: a.publicKey, product: p.pid, preview: token, c: 'eng', embed: '1' })}`;
    return { token, url: previewUrl ? fill(previewUrl) : own, expiresInMinutes: 30 };
  });

  /* public: what widgets on the shop's site read. Only the public key, only published guides (or a signed draft preview). */
  async function byPublicKey(key) {
    if (!/^pk_/.test(key || '')) throw new HttpError(401, 'key (pk_…) ontbreekt');
    const a = (await store.list('accounts')).find(x => x.publicKey === key);
    if (!a) throw new HttpError(401, 'Onbekende publieke sleutel');
    return a;
  }
  route('GET', '/v1/public/guide', 'none', async ({ q }) => {
    const a = await byPublicKey(q.key);
    // a product is found by its id or by its URL (what a thank-you page usually knows)
    let x = null;
    if (q.product?.includes('/')) {
      const url = normalizeUrl(q.product).href, norm = u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '');
      x = await store.get('products', `${a.id}~${slugOf(url)}`) || (await store.list('products', a.id + '~')).find(y => norm(y.url) === norm(url));
    } else if (q.product) x = await store.get('products', `${a.id}~${q.product}`);
    if (!x) throw new HttpError(404, 'Product niet gevonden');
    let doc = x.published?.document;
    if (q.preview) {
      if (!checkPreviewToken(previewSecret, q.preview, a.id, x.id)) throw new HttpError(401, 'Voorbeeldlink verlopen');
      doc = x.guide && document(a, x, (await settingsFor(a, x)).effective);
    }
    if (!doc) throw new HttpError(404, 'Voor dit product is nog geen gids gepubliceerd');
    return { raw: render(doc, q.format, q.lang), cache: q.preview ? 'no-store' : 'public, max-age=60' };
  });
  route('GET', '/v1/public/products', 'none', async ({ q }) => {
    const a = await byPublicKey(q.key);
    return (await store.list('products', a.id + '~')).filter(x => x.published).map(x => ({ id: x.id, url: x.url, version: x.published.version }));
  });

  /* ── http plumbing ── */
  const STATIC = {
    '/studio': ['studio/index.html', 'text/html; charset=utf-8'],
    '/guide-preview': ['studio/guide-preview.html', 'text/html; charset=utf-8'],
    '/hoe-het-werkt': ['studio/how.html', 'text/html; charset=utf-8'],
    '/clients/js/amplifai-content.js': ['clients/js/amplifai-content.js', 'text/javascript; charset=utf-8'],
    '/openapi.yaml': ['openapi.yaml', 'application/yaml; charset=utf-8'],
  };
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

  function cors(req, res) {
    const origin = req.headers.origin;
    const allow = corsOrigins === '*' ? '*' : corsOrigins.split(',').map(s => s.trim()).includes(origin) ? origin : null;
    if (allow) { res.setHeader('access-control-allow-origin', allow); res.setHeader('vary', 'origin') }
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  const send = (res, status, body, type = 'application/json; charset=utf-8', cache = 'no-store') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': cache });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  async function readBody(req) {
    let s = '';
    for await (const c of req) { s += c; if (s.length > 2e6) throw new HttpError(413, 'Te groot verzoek') }
    if (!s) return {};
    try { return JSON.parse(s) } catch { throw new HttpError(400, 'Body is geen geldige JSON') }
  }
  function explain(e) {
    if (e instanceof HttpError || e instanceof SettingsError || e.status) return [e.status || 400, { error: e.message, ...(e.key && { field: e.key }), ...(e.code && { code: e.code }) }];
    if (e instanceof Anthropic.AuthenticationError) return [502, { error: 'API-sleutel van Anthropic ongeldig (ANTHROPIC_API_KEY)' }];
    if (/API key|apiKey|authToken/i.test(e?.message || '')) return [503, { error: 'Geen ANTHROPIC_API_KEY ingesteld op de server' }];
    console.error(e);
    return [500, { error: e?.message || 'Interne fout' }];
  }

  async function handler(req, res) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    const u = new URL(req.url, 'http://x');
    let pathname = u.pathname;
    if (basePath && pathname.startsWith(basePath)) pathname = pathname.slice(basePath.length) || '/';
    try {
      if (req.method === 'GET' && (STATIC[pathname] || pathname === '/')) {
        const [f, type] = STATIC[pathname] || STATIC['/studio'];
        return send(res, 200, await fs.readFile(path.join(ROOT, f)), type);
      }
      if (req.method === 'GET' && staticDir && pathname.startsWith('/files/')) {
        const f = path.normalize(path.join(staticDir, decodeURIComponent(pathname.slice(7))));
        if (!f.startsWith(path.resolve(staticDir))) throw new HttpError(403, 'Nee');
        return send(res, 200, await fs.readFile(f), TYPES[path.extname(f)] || 'application/octet-stream');
      }
      for (const r of R) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.re);
        if (!m) continue;
        const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const who = r.auth === 'none' ? null : await identify(req, { store, adminKey, toolKey, toolTestKey });
        if (r.auth === 'any' && !who) throw new HttpError(401, 'API-sleutel ontbreekt (Authorization: Bearer …)');
        if (r.auth === 'admin') mustAdmin(who);
        if (r.auth === 'tool') { if (!who) throw new HttpError(401, 'API-sleutel ontbreekt (Authorization: Bearer …)'); if (!['admin', 'tool'].includes(who.role)) throw new HttpError(403, 'Alleen voor de AmplifAI-tool') }
        if (r.auth === 'account') { canAccount(who, p.acc); if (who.sandbox) sandboxCheck(who, await account(p.acc)) }
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const out = await r.fn({ p, q: Object.fromEntries(u.searchParams), body, who, req });
        if (out?.raw) return send(res, 200, out.raw.type.startsWith('application/json') ? JSON.stringify(out.raw.body) : out.raw.body, out.raw.type, out.cache || 'no-store');
        if (out?.$status) return send(res, out.$status, out.body);
        return send(res, 200, out);
      }
      throw new HttpError(404, 'Onbekend adres: ' + req.method + ' ' + pathname);
    } catch (e) {
      if (e.code === 'ENOENT') return send(res, 404, { error: 'Niet gevonden' });
      const [status, body] = explain(e);
      if (!res.headersSent) send(res, status, body); else res.end();
    }
  }

  return { handler, jobs };
}
