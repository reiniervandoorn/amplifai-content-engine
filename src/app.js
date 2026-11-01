// The HTTP API (v1). The AmplifAI tool sends a product and its settings; the engine researches the product,
// writes the content for its guide, checks it against the AmplifAI rules and hands it back. The tool keeps
// the content, shows it to the shop and arranges it into the guide. The engine forgets it after a few days.
// createEngine() returns a plain (req, res) handler, so it runs on its own (server.js) or inside another server.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { product as readProduct, normalizeUrl } from './crawl.js';
import * as realAi from './ai.js';
import * as mockAi from './mock-ai.js';
import { schemas, kindOf, getPath, setPath, ICONS } from './ai.js';
import { LANGUAGES, RULES, defaultPlatform, checkBudget, checkLevels, resolve, publicSettings, describe, SettingsError } from './settings.js';
import { MODELS, LEVEL_IDS, EUR_PER_USD, usd, eur, perProduct } from './pricing.js';
import { checkContent, repairWish } from './quality.js';
import { identify, HttpError, newKey } from './auth.js';
import { flat } from './formats.js';
import { Jobs } from './jobs.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const now = () => new Date().toISOString();
export const FORMAT_VERSION = 2;

// The pieces of content, for the tool's documentation and screens. The path is what a revision asks for.
export const PIECES = [
  ['shortName', 'Korte productnaam'],
  ['intro', 'Titel, kopregel en een uitnodiging om de gids te openen'],
  ['story', 'Het merkverhaal'],
  ['special.N', 'Wat dit product bijzonder maakt'],
  ['expect.N', 'Wat normaal is in de eerste dagen'],
  ['fact', 'Eén opvallend feit'],
  ['care.N', 'Onderhoud: schoonmaken, bewaren, levensduur'],
  ['experience', 'De ervaringsvraag, met een tekst per niveau'],
  ['question', 'De vraag waarvan het antwoord de tips verandert'],
  ['question.options.N', 'Eén antwoord: het resultaat en de tip die erbij hoort'],
  ['tips.new.N / tips.regular.N / tips.expert.N', 'Tips per ervaringsniveau'],
  ['whileYouWait / whileYouWait.items.N', 'Voor de verzendmail: wat je alvast kunt doen'],
  ['firstMinutes / firstMinutes.items.N', 'Voor de bezorgmail: de eerste minuten'],
].map(([path, label]) => ({ path, label }));

// Test mode swaps Claude for fixed templates (mock-ai.js): every call works, without a key or cost.
// AmplifAI switches between test and live in the admin page; aiMode only sets where a new install starts.
export function createEngine({ store, adminKey, toolKey, toolTestKey, corsOrigins = '*', basePath = '', aiMode = 'claude',
  concurrency = 2, keepDays = 7, waitMs = 90000, readPages = true }) {
  const startMode = aiMode === 'mock' ? 'test' : 'live';
  const platform = async () => {
    const d = defaultPlatform(), s = await store.get('platform', 'main');
    return { ...d, ...s, mode: s?.mode || startMode, levels: { ...d.levels, ...(s?.levels || {}) }, budget: { ...d.budget, ...(s?.budget || {}) } };
  };
  const savePlatform = async patch => { const pf = { ...((await store.get('platform', 'main')) || {}), ...patch, updatedAt: now() }; await store.put('platform', 'main', pf); return pf };
  const mode = async () => (await platform()).mode;
  // the test key always gets test texts, whatever the mode: building the tool never costs anything
  const isTest = async who => !!who?.test || (await mode()) !== 'live';
  // the key AmplifAI entered in the admin page is kept on the server, never sent back
  const loadKey = async () => realAi.setApiKey((await store.get('secrets', 'anthropic'))?.key || null);
  // callbacks are signed with this secret, made once
  const callbackSecret = async () => (await store.get('secrets', 'callback'))?.secret || (await store.put('secrets', 'callback', { secret: newKey('whsec_') })).secret;

  /* ── jobs: kept in memory while they run, and stored so the tool can read the result for keepDays ── */
  const jobs = new Jobs({ concurrency, onChange: job => saveJob(job) });
  const saveJob = job => store.put('jobs', job.id, job).catch(e => console.error('Taak niet opgeslagen:', e.message));
  const ready = (async () => {
    await loadKey();
    // a restart forgets running jobs: say so, rather than leave them "working" forever
    const cutoff = Date.now() - keepDays * 864e5;
    for (const j of await store.list('jobs')) {
      if (!(Date.parse(j.createdAt) >= cutoff)) await store.del('jobs', j.id);
      else if (j.status === 'queued' || j.status === 'working') await store.put('jobs', j.id, { ...j, status: 'failed', error: 'De engine is herstart terwijl deze taak liep. Vraag het opnieuw aan.', finishedAt: now() });
    }
    for (const r of await store.list('research')) if (!(Date.parse(r.at) >= cutoff)) await store.del('research', r.key);
  })();
  async function readJob(id) {
    await ready;
    const j = jobs.get(id) || await store.get('jobs', id);
    if (!j) throw new HttpError(404, 'Taak niet gevonden (of ouder dan ' + keepDays + ' dagen)');
    return j;
  }
  const publicJob = j => ({ ...j });

  /* ── spending limits: live mode stops before it goes over AmplifAI's budget ──
     Every call to Claude asks first (day, month, this product) and records its cost afterwards, per day.
     Jobs run inside jobCost, so a call knows which job it belongs to. */
  const jobCost = new AsyncLocalStorage();
  const today = () => new Date().toISOString().slice(0, 10);
  const spentUsd = async prefix => (await store.list('spend', prefix)).reduce((n, d) => n + (d.usd || 0), 0);
  async function spending() {
    const { budget } = await platform(), day = await spentUsd(today()), month = await spentUsd(today().slice(0, 7));
    return { ...budget, todayEUR: eur(day), monthSpentEUR: eur(month),
      dayLeftEUR: Math.max(0, eur(budget.dayEUR / EUR_PER_USD - day)), monthLeftEUR: Math.max(0, eur(budget.monthEUR / EUR_PER_USD - month)) };
  }
  const euro = n => '€' + n.toFixed(2).replace('.', ',');
  async function mayspend(job) {
    if ((await mode()) !== 'live') throw new HttpError(402, 'Gestopt: de engine staat in testmodus', 'budget');
    const b = await spending();
    if (b.todayEUR >= b.dayEUR) throw new HttpError(402, `Dagbudget bereikt (${euro(b.dayEUR)}). Morgen gaat het verder, of verhoog het op de beheerpagina.`, 'budget');
    if (b.monthSpentEUR >= b.monthEUR) throw new HttpError(402, `Maandbudget bereikt (${euro(b.monthEUR)}). Verhoog het op de beheerpagina om verder te gaan.`, 'budget');
    if (job && eur(job.usd) >= b.productEUR) throw new HttpError(402, `Dit product kostte meer dan ${euro(b.productEUR)} en is gestopt. Verhoog de grens per product op de beheerpagina als dit klopt.`, 'budget');
  }
  const locks = new Map();
  function locked(key, fn) {
    const run = (locks.get(key) || Promise.resolve()).catch(() => { }).then(fn);
    locks.set(key, run);
    run.finally(() => { if (locks.get(key) === run) locks.delete(key) }).catch(() => { });
    return run;
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
    research: (page, s, o = {}) => realAi.research(page, s, { ...o, meter: meter() }),
    write: o => realAi.write({ ...o, meter: meter() }),
    revise: o => realAi.revise({ ...o, meter: meter() }),
  };
  const ai = async who => (await isTest(who)) ? mockAi : liveAi;
  // live mode without a key, or over budget, would only start jobs that fail: say so straight away
  async function aiReady(who) {
    await ready;
    if (await isTest(who)) return;
    if (!realAi.hasKey()) throw new HttpError(409, 'Live-modus staat aan, maar er is geen Anthropic-sleutel. Voer de sleutel in op de beheerpagina of zet de engine in testmodus.');
    await mayspend();
  }

  /* ── callbacks: the tool hears when a job is finished ── */
  async function callback(url, job) {
    const body = JSON.stringify({ event: `content.${job.status}`, at: now(), job: publicJob(job) });
    const sig = crypto.createHmac('sha256', await callbackSecret()).update(body).digest('hex');
    for (let i = 0; i < 3; i++) {
      try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-amplifai-signature': 'sha256=' + sig }, body, signal: AbortSignal.timeout(10000) }); if (r.ok) return } catch { }
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  const checkUrl = (u, field) => {
    if (u == null || u === '') return null;
    try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) throw 0; return x.href } catch { throw new SettingsError(`${field}: een http(s)-adres`, field) }
  };

  // Start a job for the tool, then answer at once (202) or, with wait, when it is done (up to waitMs).
  async function run(who, kind, body, fn) {
    const cb = checkUrl(body.callbackUrl, 'callbackUrl');
    const reference = body.reference == null ? null : String(body.reference).slice(0, 200);
    const job = jobs.start({ kind, reference, test: await isTest(who) }, say => jobCost.run({ usd: 0 }, async () => {
      try { return await fn(say) } catch (e) { throw Object.assign(new Error(explain(e)[1].error), e.code && { code: e.code }) }
    }));
    if (cb) jobs.done.get(job.id).then(() => callback(cb, job));
    if (body.wait) await jobs.wait(job.id, Number(body.wait) > 1 ? Math.min(waitMs, Number(body.wait) * 1000) : waitMs);
    const finished = !['queued', 'working'].includes(job.status);
    return { $status: finished ? 200 : 202, body: publicJob(job) };
  }

  /* ── the product: what the tool sent, filled in from the product page where that says more ── */
  const str = (v, max) => v == null || v === '' ? null : String(v).slice(0, max);
  const list = (v, max, n) => Array.isArray(v) ? v.map(x => String(x).slice(0, max)).filter(Boolean).slice(0, n) : [];
  function productFrom(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new SettingsError('product moet een object zijn, met minstens url', 'product');
    if (!p.url) throw new SettingsError('product.url is verplicht: de pagina van het product in de webshop', 'product.url');
    let url;
    try { if (/^[a-z][a-z0-9+.-]*:/i.test(p.url) && !/^https?:/i.test(p.url)) throw 0; url = normalizeUrl(p.url).href } catch { throw new SettingsError('product.url: een http(s)-adres', 'product.url') }
    return { url, name: str(p.name, 300), brand: str(p.brand, 120), category: str(p.category, 120), price: str(p.price, 40), image: str(p.image, 1000),
      description: str(p.description, 8000) || '', properties: list(p.specs, 300, 40), variants: list(p.variants, 120, 30), sku: str(p.sku, 80), gtin: str(p.gtin, 40) };
  }
  async function fillFromPage(page, say) {
    if (!readPages || (page.name && page.description.length >= 200)) return page;
    say('Productpagina lezen…');
    try {
      const full = await readProduct(page.url);
      const out = { ...page };
      const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
      for (const [k, v] of Object.entries(full)) if (!empty(v) && empty(out[k])) out[k] = v;
      return out;
    } catch (e) {
      if (!page.name) throw new HttpError(422, `De productpagina is niet te lezen (${e.message}). Stuur product.name en product.description mee.`);
      return page;
    }
  }
  // Research is the costly half and does not depend on tone, form of address or languages, so in live mode
  // it is kept for keepDays and reused: a new tone, or a second try after a failure, only pays for writing.
  async function researchFor(AI, page, settings, say) {
    const key = crypto.createHash('sha256').update(JSON.stringify([settings.model, page.url, page.name, page.brand, page.description, page.properties])).digest('hex').slice(0, 32);
    const live = AI !== mockAi;
    const kept = live && await store.get('research', key);
    if (kept && Date.now() - Date.parse(kept.at) < keepDays * 864e5) { say('Bronnen van eerder onderzoek gebruikt (gratis)'); return kept.research }
    say('Bronnen zoeken bij merk en fabrikant…');
    const found = await AI.research(page, settings, { onProgress: say });
    const research = { product: found.product, facts: found.facts.map(({ on, ...f }) => f), questionIdeas: found.questionIdeas };
    if (live) await store.put('research', key, { key, at: now(), research });
    return research;
  }
  const shopFrom = s => ({ name: str(s?.name, 120), url: s?.url ? checkUrl(/^https?:/i.test(s.url) ? s.url : 'https://' + s.url, 'shop.url') : null });

  // which sources the content cites
  function cited(content) {
    const ids = new Set();
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.src)) n.src.forEach(id => ids.add(id));
      Object.values(n).forEach(walk);
    })(content);
    return ids;
  }
  // every fact stays, so a later revision can still use it; a shop's wish that ended up uncited is dropped
  const sourcesFor = (facts, content) => {
    const u = cited(content);
    return facts.filter(f => !f.id.startsWith('w') || u.has(f.id)).map(({ id, category, claim, url, title }) => ({ id, category, claim, url, title, used: u.has(id) }));
  };

  // Live mode: rewrite the pieces that break a rule, once each.
  async function repair(AI, content, base, settings, say) {
    const qa = checkContent(content, settings);
    if (AI === mockAi || !qa.errors) return qa;
    const { piece } = schemas(settings.languages), byPiece = new Map();
    for (const i of qa.issues) if (i.level === 'error' && piece[kindOf(i.piece)] && getPath(content, i.piece) != null) byPiece.set(i.piece, [...(byPiece.get(i.piece) || []), i]);
    for (const [path, issues] of [...byPiece].slice(0, 6)) {
      say('Kwaliteitscheck: ' + issues[0].message.toLowerCase() + '…');
      try { setPath(content, path, (await AI.revise({ ...base, settings, rules: RULES, current: content, path, wish: repairWish(issues) })).piece) }
      catch (e) { if (e.code === 'budget') throw e }
    }
    return checkContent(content, settings);
  }

  const resultOf = ({ test, settings, page, shop, research, facts, content, quality, costUsd, extra }) => ({
    formatVersion: FORMAT_VERSION,
    test,
    languages: settings.languages,
    settings: publicSettings(settings),
    product: { url: page.url, name: page.name, brand: page.brand || null, category: page.category || null, price: page.price || null, image: page.image || null, variants: page.variants || [] },
    shop,
    content,
    sources: sourcesFor(facts, content),
    quality,
    costEUR: eur(costUsd),
    // what the engine needs again for a revision; the tool sends it back unchanged
    research: { product: research.product || {}, questionIdeas: research.questionIdeas || [] },
    createdAt: now(),
    ...extra,
  });

  /* ── routes ── */
  const R = [];
  const route = (method, pattern, auth, fn) => R.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), keys: [...pattern.matchAll(/:(\w+)/g)].map(m => m[1]), auth, fn });

  route('GET', '/v1/health', 'none', async () => { await ready; const m = await mode(); return { ok: true, mode: m, ai: m === 'test' || realAi.hasKey() } });
  // On your own computer only: hand the admin page the admin key, so logging in is one click.
  route('GET', '/v1/dev/login', 'none', async ({ req }) => {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
    if (!local || process.env.DEV_LOGIN === 'off') throw new HttpError(404, 'Alleen op je eigen computer');
    return { adminKey };
  });

  // What the tool needs to build its settings screen, and the pieces it can expect back.
  route('GET', '/v1/options', 'tool', async () => {
    const pf = await platform(), runs = await store.list('runs');
    return {
      formatVersion: FORMAT_VERSION,
      settings: describe(),
      languages: LANGUAGES,
      qualities: LEVEL_IDS.map(id => ({ id, name: pf.levels[id].name, blurb: pf.levels[id].blurb, estimatedCostEUR: Math.round(perProduct(pf.levels[id].model, runs).eur * 100) / 100 })),
      pieces: PIECES,
      icons: ICONS,
    };
  });

  // Write the content for one product.
  route('POST', '/v1/content', 'tool', async ({ body, who }) => {
    const settings = resolve(body.settings, await platform());
    const given = productFrom(body.product), shop = shopFrom(body.shop);
    await aiReady(who);
    return run(who, 'write', body, async say => {
      const AI = await ai(who), test = AI === mockAi;
      const page = await fillFromPage(given, say);
      const research = await researchFor(AI, page, settings, say);
      say(`Teksten schrijven (${settings.languages.join(', ')})…`);
      const { content } = await AI.write({ page, research, shop, settings, rules: RULES });
      const quality = await repair(AI, content, { page, research, shop }, settings, say);
      const costUsd = jobCost.getStore().usd;
      // what one product cost from start to finish: the basis for the cost estimates
      if (!test) await store.put('runs', crypto.randomUUID(), { model: settings.model, usd: costUsd, at: now() });
      return resultOf({ test, settings, page, shop, research, facts: research.facts, content, quality, costUsd });
    });
  });

  // A result the tool sends back, checked, so a revision starts from something whole.
  function readResult(r) {
    if (!r || typeof r !== 'object' || r.formatVersion !== FORMAT_VERSION || !r.content || !Array.isArray(r.sources) || !r.product?.url)
      throw new SettingsError(`content: stuur het hele resultaat terug zoals de engine het gaf (formatVersion ${FORMAT_VERSION})`, 'content');
    const settings = resolve(r.settings, null);
    const parsed = schemas(settings.languages).Content.safeParse(r.content);
    if (!parsed.success) throw new SettingsError('content: de inhoud heeft niet de verwachte vorm (' + parsed.error.issues[0]?.path.join('.') + ')', 'content');
    return { settings, content: parsed.data };
  }

  // Rewrite one piece, with the shop's wish.
  route('POST', '/v1/content/revise', 'tool', async ({ body, who }) => {
    const r = body.content;
    const { content } = readResult(r);
    // the level, tone or form of address may have changed since the content was written
    const settings = resolve({ ...r.settings, ...(body.settings || {}) }, await platform());
    if (settings.languages.join() !== r.languages.join()) throw new SettingsError('settings.languages: een revisie houdt dezelfde talen; schrijf de inhoud opnieuw voor andere talen', 'settings.languages');
    const piecePath = String(body.piece || '');
    if (!kindOf(piecePath) || getPath(content, piecePath) == null) throw new SettingsError(`piece: onbekend onderdeel "${piecePath}". Zie GET /v1/options voor de onderdelen.`, 'piece');
    const wish = body.wish == null ? '' : String(body.wish).trim();
    if (wish.length > 600) throw new SettingsError('wish: maximaal 600 tekens', 'wish');
    await aiReady(who);
    return run(who, 'revise', body, async say => {
      const AI = await ai(who), test = AI === mockAi;
      const facts = r.sources.map(({ id, category, claim, url, title }) => ({ id: String(id), category, claim: String(claim || ''), url, title }));
      // what the shop says about its own product may be cited, as the shop's word
      if (wish) facts.push({ id: 'w' + (facts.filter(f => f.id.startsWith('w')).length + 1), category: 'shop', claim: wish, url: r.product.url, title: 'Wens van de shop' });
      const page = { ...r.product, properties: [] };
      const research = { ...(r.research || {}), facts };
      say(`Onderdeel ${piecePath} herschrijven…`);
      const { piece } = await AI.revise({ page, research, shop: r.shop, settings, rules: RULES, current: content, path: piecePath, wish });
      setPath(content, piecePath, piece);
      const quality = await repair(AI, content, { page, research, shop: r.shop }, settings, say);
      return resultOf({ test, settings, page, shop: r.shop || null, research, facts, content, quality, costUsd: jobCost.getStore().usd,
        extra: { revised: { piece: piecePath, wish: wish || null } } });
    });
  });

  // Check content against the AmplifAI rules, e.g. after the shop edited a text by hand. Free and instant.
  route('POST', '/v1/content/check', 'tool', async ({ body }) => {
    const { settings, content } = readResult(body.content);
    return checkContent(content, settings);
  });

  route('GET', '/v1/content/:id', 'tool', async ({ p, q }) => {
    const j = publicJob(await readJob(p.id));
    if (q.lang && j.result) j.result = flat(j.result, q.lang);
    return j;
  });

  /* ── AmplifAI: test or live, the Anthropic key, limits, costs ── */
  async function status() {
    await ready;
    const pf = await platform(), sec = await store.get('secrets', 'anthropic'), runs = await store.list('runs');
    const recent = (await store.list('jobs')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
      .map(j => ({ id: j.id, kind: j.kind, status: j.status, test: j.test, reference: j.reference, product: j.result?.product?.name || null, costEUR: j.result?.costEUR ?? null, error: j.error, createdAt: j.createdAt }));
    return {
      mode: pf.mode, hasKey: realAi.hasKey(), keyHint: sec?.key ? sec.key.slice(0, 10) + '…' + sec.key.slice(-4) : null, fromEnv: !sec?.key && !!process.env.ANTHROPIC_API_KEY,
      budget: await spending(),
      levels: LEVEL_IDS.map(id => { const est = perProduct(pf.levels[id].model, runs); return { id, ...pf.levels[id], modelLabel: MODELS[pf.levels[id].model]?.label, perProductEUR: est.eur, basedOn: est.basedOn } }),
      models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })),
      keys: { tool: toolKey || null, test: toolTestKey || null, callbackSecret: await callbackSecret() },
      totalEUR: eur(await spentUsd('')),
      recent,
    };
  }
  route('GET', '/v1/admin/status', 'admin', status);
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
      await savePlatform({ mode: body.mode });
    }
    return status();
  });
  route('PATCH', '/v1/admin/settings', 'admin', async ({ body }) => {
    const pf = await platform();
    await savePlatform({
      ...(body.budget && { budget: { ...pf.budget, ...checkBudget(body.budget) } }),
      ...(body.levels && { levels: { ...pf.levels, ...checkLevels(body.levels) } }),
    });
    return status();
  });
  // emergency stop: back to test mode, nothing waiting starts; a job being written stops at its next call to Claude
  route('POST', '/v1/admin/stop', 'admin', async () => { await savePlatform({ mode: 'test' }); return { mode: 'test', ...jobs.cancelAll() } });

  /* ── http plumbing ── */
  const STATIC = {
    '/admin': ['admin/index.html', 'text/html; charset=utf-8'],
    '/openapi.yaml': ['openapi.yaml', 'application/yaml; charset=utf-8'],
    '/clients/js/amplifai-content.js': ['clients/js/amplifai-content.js', 'text/javascript; charset=utf-8'],
  };
  function cors(req, res) {
    const origin = req.headers.origin;
    const allow = corsOrigins === '*' ? '*' : corsOrigins.split(',').map(s => s.trim()).includes(origin) ? origin : null;
    if (allow) { res.setHeader('access-control-allow-origin', allow); res.setHeader('vary', 'origin') }
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, OPTIONS');
  }
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  async function readBody(req) {
    let s = '';
    for await (const c of req) { s += c; if (s.length > 2e6) throw new HttpError(413, 'Te groot verzoek') }
    if (!s) return {};
    let b;
    try { b = JSON.parse(s) } catch { throw new HttpError(400, 'Body is geen geldige JSON') }
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Body moet een JSON-object zijn');
    return b;
  }
  function explain(e) {
    if (e instanceof HttpError || e instanceof SettingsError || e.status) return [e.status || 400, { error: e.message, ...(e.key && { field: e.key }), ...(e.code && { code: e.code }) }];
    if (e instanceof Anthropic.AuthenticationError) return [502, { error: 'Anthropic accepteert de API-sleutel niet. Controleer hem op de beheerpagina.' }];
    if (e instanceof Anthropic.RateLimitError) return [503, { error: 'Anthropic is even te druk (rate limit). Probeer het over een minuut opnieuw.' }];
    if (e instanceof Anthropic.APIError) return [502, { error: `Anthropic weigerde het verzoek (${e.status ?? 'geen verbinding'}): ${e.error?.error?.message || e.message}` }];
    if (/API key|apiKey|authToken/i.test(e?.message || '')) return [503, { error: 'Geen Anthropic-sleutel ingesteld op de server' }];
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
      if (req.method === 'GET' && pathname === '/') { res.writeHead(302, { location: basePath + '/admin' }); return res.end() }
      if (req.method === 'GET' && STATIC[pathname]) {
        const [f, type] = STATIC[pathname];
        return send(res, 200, await fs.readFile(path.join(ROOT, f)), type);
      }
      for (const r of R) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.re);
        if (!m) continue;
        const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const who = r.auth === 'none' ? null : identify(req, { adminKey, toolKey, toolTestKey });
        if (r.auth !== 'none' && !who) throw new HttpError(401, 'API-sleutel ontbreekt (Authorization: Bearer …)');
        if (r.auth === 'admin' && who.role !== 'admin') throw new HttpError(403, 'Alleen voor AmplifAI (admin-sleutel)');
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const out = await r.fn({ p, q: Object.fromEntries(u.searchParams), body, who, req });
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

  return { handler, jobs, ready };
}
