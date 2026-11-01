// End-to-end tests of the API, without Anthropic: settings layers, roles, editing, publishing, public reads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/app.js';
import { FileStore } from '../src/store.js';
import { ContentEngine } from '../clients/js/amplifai-content.js';

const sample = JSON.parse(readFileSync(new URL('../scripts/sample.json', import.meta.url)));
let dir, server, base, admin, shop, other, store, pub;

before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-'));
  store = new FileStore(dir);
  const engine = createEngine({ store, adminKey: 'ak_test', previewSecret: 'ps_test', previewUrl: '/files/demo.html?engine={engine}&pk={publicKey}&product={productId}&preview={token}' });
  server = http.createServer(engine.handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = new ContentEngine({ baseUrl: base, key: 'ak_test' });
});
after(async () => { server.close(); await fs.rm(dir, { recursive: true, force: true }) });

const rejects = async (p, status) => { await assert.rejects(p, e => { assert.equal(e.status, status, e.message); return true }) };

test('health and meta need no key', async () => {
  const ce = new ContentEngine({ baseUrl: base });
  assert.equal((await ce.request('GET', '/v1/health')).ok, true);
  assert.ok((await ce.meta()).fields.tone.options.includes('warm'));
  await rejects(ce.me(), 401);
});

test('AmplifAI creates shops; each shop sees only itself', async () => {
  const a = await admin.createAccount({ name: 'Fietsshop Test', shopUrl: 'fietsshop.test' });
  assert.match(a.secretKey, /^sk_/);
  shop = new ContentEngine({ baseUrl: base, key: a.secretKey });
  pub = a.account.publicKey;
  const b = await admin.createAccount({ name: 'Andere Shop' });
  other = new ContentEngine({ baseUrl: base, key: b.secretKey });
  assert.equal((await shop.me()).account.id, 'fietsshop-test');
  await rejects(shop.getAccount('andere-shop'), 403);
  await rejects(shop.getPlatform(), 403);
  await rejects(shop.listAccounts(), 403);
  await rejects(new ContentEngine({ baseUrl: base, key: 'sk_nope' }).me(), 401);
});

test('settings: AmplifAI base, shop overrides within the policy', async () => {
  let s = await shop.getSettings('fietsshop-test');
  assert.equal(s.effective.tone, 'warm');
  assert.equal(s.from.tone, 'platform');
  assert.equal(s.fields.maxSearches.editable, false);
  assert.equal(s.effective.tier, 'basis');
  assert.equal(s.effective.model, 'claude-sonnet-5-5');
  assert.equal(s.tiers.length, 3);
  assert.ok(s.tiers.every(t => t.pricePerOrder > 0 && !('model' in t)));

  await shop.updateSettings('fietsshop-test', { tone: 'expert', formality: 'formal' });
  s = await shop.getSettings('fietsshop-test');
  assert.equal(s.effective.tone, 'expert');
  assert.equal(s.from.tone, 'account');

  await rejects(shop.updateSettings('fietsshop-test', { maxSearches: 2 }), 403);
  await shop.updateSettings('fietsshop-test', { tier: 'premium' });
  assert.equal((await shop.getSettings('fietsshop-test')).effective.model, 'claude-fable-5-1');
  await rejects(shop.updateSettings('fietsshop-test', { tipCount: 9 }), 422);
  await rejects(shop.updateSettings('fietsshop-test', { nope: 1 }), 422);

  // AmplifAI narrows tone afterwards: the shop's "expert" no longer fits and falls back, with a warning
  await admin.updatePlatform({ policy: { tone: { editable: true, options: ['warm', 'neutral'] } }, defaults: { tone: 'neutral' } });
  s = await shop.getSettings('fietsshop-test');
  assert.equal(s.effective.tone, 'neutral');
  assert.ok(s.warnings.some(w => w.includes('tone')));
  assert.deepEqual(s.fields.tone.options, ['warm', 'neutral']);
  await rejects(shop.updateSettings('fietsshop-test', { tone: 'playful' }), 422);

  // AmplifAI may set a locked setting for one shop, and lock or open a setting for that shop only
  await admin.updateSettings('fietsshop-test', { maxSearches: 3 });
  await admin.updateAccount('fietsshop-test', { policy: { tipCount: { editable: false } } });
  s = await shop.getSettings('fietsshop-test');
  assert.equal(s.effective.maxSearches, 3);
  assert.equal(s.from.maxSearches, 'account');
  await rejects(shop.updateSettings('fietsshop-test', { tipCount: 2 }), 403);
  await rejects(shop.updateAccount('fietsshop-test', { policy: { tone: { editable: true } } }), 403);

  // null removes a value: the layer below shows through again
  await shop.updateSettings('fietsshop-test', { formality: null });
  assert.equal((await shop.getSettings('fietsshop-test')).from.formality, 'platform');
  await admin.updatePlatform({ policy: { tone: { editable: true } }, defaults: { tone: null } }); // reset
});

test('editing, locking, removing, publishing and public reads', async () => {
  const pid = 'p1';
  await store.put('products', `fietsshop-test~${pid}`, { id: pid, accountId: 'fietsshop-test', url: 'https://fietsshop.test/products/p1', status: 'draft',
    settings: {}, settingsBy: {}, locked: [], removed: [], page: sample.page, research: sample.research, guide: structuredClone(sample.guide) });

  // product layer on top of the shop layer
  let p = await shop.updateProduct('fietsshop-test', pid, { settings: { length: 'short' } });
  assert.equal(p.effectiveSettings.length, 'short');
  assert.equal(p.settingsFrom.length, 'product');

  p = await shop.editItem('fietsshop-test', pid, 'hook', { nl: 'Nieuwe kop.', en: 'New hook.' });
  assert.equal(p.guide.hook.nl, 'Nieuwe kop.');
  assert.ok(p.locked.includes('hook'));
  await rejects(shop.editItem('fietsshop-test', pid, 'hook', { nl: 'alleen nl' }), 422);
  await rejects(shop.rewriteItem('fietsshop-test', pid, 'hook'), 409); // locked

  await shop.updateProduct('fietsshop-test', pid, { locked: ['hook', 'tips.reg.2'] });
  p = await shop.removeItem('fietsshop-test', pid, 'tips.reg.0');
  assert.equal(p.guide.tips.reg.length, 2);
  assert.deepEqual(p.locked.sort(), ['hook', 'tips.reg.1']);
  await rejects(shop.removeItem('fietsshop-test', pid, 'answerTips.0'), 409);

  // nothing public before publishing
  const widget = new ContentEngine({ baseUrl: base, key: pub });
  await rejects(widget.getPublishedGuide(pid), 404);
  await rejects(new ContentEngine({ baseUrl: base, key: 'pk_wrong' }).getPublishedGuide(pid), 401);

  const v = await shop.publish('fietsshop-test', pid);
  assert.equal(v.version, 1);
  const doc = await widget.getPublishedGuide(pid);
  assert.equal(doc.guide.hook.nl, 'Nieuwe kop.');
  assert.deepEqual(doc.languages, ['nl', 'en']);
  assert.ok(doc.sources.every(s => s.url));
  assert.equal(typeof (await widget.getPublishedGuide('https://fietsshop.test/products/p1', { format: 'flat', lang: 'en' })).guide.hook, 'string');
  assert.match(await widget.getPublishedGuide(pid, { format: 'markdown', lang: 'nl' }), /^# /);
  await rejects(widget.getPublishedGuide(pid, { format: 'flat', lang: 'de' }), 400);

  // the published copy is frozen; the draft preview shows edits
  await shop.editItem('fietsshop-test', pid, 'hook', { nl: 'Concept.', en: 'Draft.' });
  assert.equal((await widget.getPublishedGuide(pid)).guide.hook.nl, 'Nieuwe kop.');
  const pv = await shop.preview('fietsshop-test', pid);
  assert.match(pv.url, /preview=/);
  assert.equal((await widget.getPublishedGuide(pid, { preview: pv.token })).guide.hook.nl, 'Concept.');
  await rejects(widget.getPublishedGuide(pid, { preview: pv.token + 'x' }), 401);

  // other shops cannot touch it
  await rejects(other.getProduct('fietsshop-test', pid), 403);

  await shop.unpublish('fietsshop-test', pid);
  await rejects(widget.getPublishedGuide(pid), 404);
});

test('live mode needs a key; test mode runs jobs, one per product', async () => {
  // live mode without a key: refused straight away, with a clear message
  await assert.rejects(shop.generate('fietsshop-test', 'p1', { tone: 'warm' }), e => e.status === 409 && /sleutel/.test(e.message));
  await rejects(shop.request('POST', '/v1/accounts/fietsshop-test/autopilot', {}), 409);
  assert.equal((await admin.request('GET', '/v1/admin/ai')).hasKey, false);
  await rejects(admin.request('PUT', '/v1/admin/ai', { key: 'not-a-key' }), 422);
  await rejects(shop.request('GET', '/v1/admin/ai'), 403);
  // test mode: jobs run, one at a time per product
  await admin.request('PUT', '/v1/admin/ai', { mode: 'test' });
  const job = await shop.generate('fietsshop-test', 'p1', { tone: 'warm' });
  assert.equal(job.type, 'generate');
  await rejects(shop.generate('fietsshop-test', 'p1'), 409);
  await shop.waitForJob(job.id, { interval: 100 });
  await rejects(other.getJob(job.id), 403);
  await rejects(shop.generate('fietsshop-test', 'p1', { maxSearches: 1 }), 403);
  await admin.request('PUT', '/v1/admin/ai', { mode: 'live' }).catch(() => {}); // no key: stays in test
});

test('rotating the secret key revokes the old one', async () => {
  const { secretKey } = await shop.rotateKey('fietsshop-test');
  await rejects(shop.me(), 401);
  shop = new ContentEngine({ baseUrl: base, key: secretKey });
  assert.equal((await shop.me()).account.id, 'fietsshop-test');
});

test('test mode: research, generate, rewrite and batch work without a key, and follow the settings', async () => {
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-mock-'));
  const store2 = new FileStore(dir2);
  const engine = createEngine({ store: store2, adminKey: 'ak_m', previewSecret: 'ps', aiMode: 'mock' });
  const srv = http.createServer(engine.handler);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const adm = new ContentEngine({ baseUrl: b, key: 'ak_m' });
    const { secretKey } = await adm.createAccount({ id: 'm', name: 'Mock' });
    const ce = new ContentEngine({ baseUrl: b, key: secretKey });
    await store2.put('products', 'm~x', { id: 'x', accountId: 'm', url: 'https://mock.test/products/x', status: 'new', settings: {}, settingsBy: {}, locked: [], removed: [],
      page: { url: 'https://mock.test/products/x', name: 'Testmerk Ketel 2', brand: 'Testmerk', price: '€49,95', description: 'Een fluitketel van roestvrij staal met een ergonomisch handvat voor alle warmtebronnen.' } });
    await ce.updateSettings('m', { languages: ['nl', 'en', 'de'], formality: 'formal', tipCount: 2, answerCount: 3 });

    await ce.waitForJob((await ce.generate('m', 'x')).id, { interval: 100 });
    let p = await ce.getProduct('m', 'x');
    assert.equal(p.status, 'draft');
    assert.deepEqual(Object.keys(p.guide.hook), ['nl', 'en', 'de']);
    assert.match(p.guide.title.nl, /^Uw /);              // formal
    assert.equal(p.guide.tips.reg.length, 2);
    assert.equal(p.guide.q.options.length, 3);
    assert.ok(p.research.facts.every(f => f.url === p.url));

    // locks survive a rewrite of the whole guide; one item can be rewritten on its own
    await ce.editItem('m', 'x', 'hook', { nl: 'Mijn kop.', en: 'My hook.', de: 'Mein Titel.' });
    const before = JSON.stringify(p.guide.tips.new[0]);
    await ce.waitForJob((await ce.rewriteItem('m', 'x', 'tips.new.0', 'korter')).id, { interval: 100 });
    p = await ce.getProduct('m', 'x');
    assert.notEqual(JSON.stringify(p.guide.tips.new[0]), before);
    await ce.waitForJob((await ce.generate('m', 'x', { tone: 'playful' })).id, { interval: 100 });
    p = await ce.getProduct('m', 'x');
    assert.equal(p.guide.hook.nl, 'Mijn kop.');
    assert.equal(p.effectiveSettings.tone, 'playful');

    const { jobs } = await ce.batch('m', { urls: [] , productIds: ['x'] });
    await ce.waitForJob(jobs[0].id, { interval: 100 });
    assert.equal((await ce.request('GET', '/v1/health')).aiMode, 'mock');
  } finally { srv.close(); await fs.rm(dir2, { recursive: true, force: true }) }
});

test('autopilot: every catalog product written in one call, live straight away or after review', async () => {
  const dir3 = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-auto-'));
  const store3 = new FileStore(dir3);
  const engine = createEngine({ store: store3, adminKey: 'ak_a', previewSecret: 'ps', aiMode: 'mock' });
  const srv = http.createServer(engine.handler);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const until = async (ce, fn) => { for (let i = 0; i < 100; i++) { const s = await ce.request('GET', '/v1/accounts/auto/autopilot'); if (fn(s)) return s; await new Promise(r => setTimeout(r, 100)) } throw new Error('timeout') };
  try {
    const adm = new ContentEngine({ baseUrl: b, key: 'ak_a' });
    const { secretKey, account } = await adm.createAccount({ id: 'auto', name: 'Auto' });
    assert.equal(account.studioMode, 'simple');
    const ce = new ContentEngine({ baseUrl: b, key: secretKey });
    // a stored catalog with page data, as the demo shop has (no network needed)
    const products = Array.from({ length: 5 }, (_, i) => ({ id: 'p' + i, url: `https://auto.test/products/p${i}`, name: 'Product ' + i,
      page: { url: `https://auto.test/products/p${i}`, name: 'Merk Product ' + i, brand: 'Merk', description: 'Een product met een lange beschrijving om feiten uit te halen voor de test.' } }));
    await store3.put('accounts', 'auto', { ...(await store3.get('accounts', 'auto')), sample: true, shopUrl: 'https://auto.test' });
    await store3.put('catalogs', 'auto', { shop: { name: 'Auto', domain: 'auto.test' }, platform: 'sample', products });

    // review first: guides are written but not live
    let r = await ce.request('POST', '/v1/accounts/auto/autopilot', { publish: false, settings: { tone: 'expert' }, limit: 3 });
    assert.equal(r.started, 3);
    let s = await until(ce, x => !x.running);
    assert.deepEqual([s.ready, s.live, s.notAdded, s.inCatalog], [3, 0, 2, 5]);
    assert.equal((await ce.getSettings('auto')).effective.tone, 'expert');
    assert.equal((await ce.request('POST', '/v1/accounts/auto/publish-all')).published, 3);

    // then the rest, live straight away; finished ones are not written again
    r = await ce.request('POST', '/v1/accounts/auto/autopilot', { publish: true });
    assert.equal(r.started, 2);
    s = await until(ce, x => !x.running);
    assert.deepEqual([s.live, s.total, s.notAdded, s.failed], [5, 5, 0, 0]);
    const widget = new ContentEngine({ baseUrl: b, key: account.publicKey });
    assert.equal((await widget.getPublishedGuide('https://auto.test/products/p4')).product.name, 'Merk Product 4');

    // regenerate: everything again, without losing a lock
    await ce.editItem('auto', 'auto-test-products-p0', 'hook', { nl: 'Vast.', en: 'Fixed.' });
    r = await ce.request('POST', '/v1/accounts/auto/autopilot', { regenerate: true });
    assert.equal(r.started, 5);
    await until(ce, x => !x.running);
    assert.equal((await ce.getProduct('auto', 'auto-test-products-p0')).guide.hook.nl, 'Vast.');

    // mode, preview page
    assert.equal((await ce.updateAccount('auto', { studioMode: 'expert' })).studioMode, 'expert');
    await rejects(ce.updateAccount('auto', { studioMode: 'x' }), 422);
    const pv = await ce.preview('auto', 'auto-test-products-p1');
    assert.match(pv.url, /\/guide-preview\?engine=.+&pk=pk_.+&product=auto-test-products-p1&preview=.+&embed=1/);
    const html = await (await fetch(b + '/guide-preview')).text();
    assert.match(html, /AmplifAI/);
    const list = await ce.listProducts('auto');
    assert.ok(list.every(p => p.hasGuide && p.busy === null && p.error === null));
  } finally { srv.close(); await fs.rm(dir3, { recursive: true, force: true }) }
});

test('guides stay current, the quality check catches rule breaks, and AmplifAI sees the costs', async () => {
  const dir4 = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-sync-'));
  const store4 = new FileStore(dir4);
  const engine = createEngine({ store: store4, adminKey: 'ak_s', previewSecret: 'ps', aiMode: 'mock', scheduler: false });
  const srv = http.createServer(engine.handler);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const adm = new ContentEngine({ baseUrl: b, key: 'ak_s' });
  const until = async (ce, fn) => { for (let i = 0; i < 100; i++) { const s = await ce.request('GET', '/v1/accounts/syn/autopilot'); if (fn(s)) return s; await new Promise(r => setTimeout(r, 100)) } throw new Error('timeout') };
  const prod = (i, desc = 'Een product met een lange beschrijving om feiten uit te halen voor deze test.') => ({ id: 'p' + i, url: `https://syn.test/products/p${i}`, name: 'P' + i, page: { url: `https://syn.test/products/p${i}`, name: 'Merk P' + i, brand: 'Merk', description: desc } });
  try {
    const { secretKey } = await adm.createAccount({ id: 'syn', name: 'Syn' });
    const ce = new ContentEngine({ baseUrl: b, key: secretKey });
    await store4.put('accounts', 'syn', { ...(await store4.get('accounts', 'syn')), sample: true, shopUrl: 'https://syn.test' });
    await store4.put('catalogs', 'syn', { shop: { name: 'Syn' }, platform: 'sample', products: [prod(1), prod(2), prod(3)] });
    await ce.request('POST', '/v1/accounts/syn/autopilot', {});
    await until(ce, x => !x.running);

    // the shop's assortment changes: p3 gone, p4 new, p1's text changed
    await store4.put('catalogs', 'syn', { shop: { name: 'Syn' }, platform: 'sample', products: [prod(1, 'Nieuwe, langere beschrijving van dit product met andere eigenschappen dan eerst.'), prod(2), prod(4)] });
    const r = await ce.request('POST', '/v1/accounts/syn/sync');
    assert.deepEqual([r.added, r.removed, r.changed, r.error], [1, 1, 1, null]);
    const s = await until(ce, x => !x.running);
    assert.deepEqual([s.live, s.removed, s.total], [3, 1, 3]);
    const widget = new ContentEngine({ baseUrl: b, key: (await ce.getAccount('syn')).publicKey });
    await rejects(widget.getPublishedGuide('https://syn.test/products/p3'), 404);
    assert.ok(await widget.getPublishedGuide('https://syn.test/products/p4'));
    // events from the shop's own system
    const ev = await ce.request('POST', '/v1/accounts/syn/products/events', { removed: ['https://syn.test/products/p2'] });
    assert.equal(ev.removed, 1);

    // quality check: a selling, unsourced, wrongly addressed text is caught
    const pid = 'syn-test-products-p1';
    let x = await ce.getProduct('syn', pid);
    assert.equal(x.qa.ok, true);
    await ce.editItem('syn', pid, 'story', { text: { nl: 'Koop nu met korting: sinds 1987 de beste. Morgen in huis bij u.', en: 'Buy now: since 1987 the best.' }, src: [] });
    x = await ce.getProduct('syn', pid);
    const codes = x.qa.issues.map(i => i.code).sort();
    for (const c of ['delivery', 'form', 'sell', 'source']) assert.ok(codes.includes(c), c);
    assert.equal(x.qa.ok, false);
    // go-live gate: a guide that breaks a rule is not published automatically, and by hand only on purpose
    await assert.rejects(ce.publish('syn', pid), e => e.status === 409 && e.body.code === 'quality');
    const all = await ce.request('POST', '/v1/accounts/syn/publish-all');
    assert.equal(all.held, 1);
    assert.equal((await ce.getProduct('syn', pid)).held, true);
    assert.equal((await ce.request('POST', `/v1/accounts/syn/products/${pid}/publish`, { force: true })).version > 0, true);

    // costs and quality levels: AmplifAI sees models and estimates, shops see prices only
    const costs = await adm.request('GET', '/v1/admin/costs');
    assert.deepEqual(costs.tiers.map(t => t.id), ['basis', 'plus', 'premium']);
    assert.ok(costs.tiers.every(t => t.perProductEUR > 0 && t.model));
    assert.ok(costs.tiers[2].perProductEUR > costs.tiers[0].perProductEUR);
    const tiers = await ce.request('GET', '/v1/tiers');
    assert.deepEqual(tiers.map(t => t.pricePerOrder), [0.05, 0.10, 0.13]);
    assert.deepEqual(costs.tiers.map(t => t.model), ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);
    assert.ok(tiers.every(t => !('model' in t)));
    await rejects(ce.request('GET', '/v1/admin/costs'), 403);
    await adm.updatePlatform({ tiers: { plus: { name: 'Plus', model: 'claude-opus-5-5', pricePerOrder: 0.11 } }, refresh: 'monthly' });
    assert.equal((await ce.request('GET', '/v1/tiers'))[1].pricePerOrder, 0.11);
    await rejects(adm.updatePlatform({ tiers: { plus: { model: 'gpt', pricePerOrder: 1 } } }), 422);
    // the demo shop keeps its sample texts, also in live mode without a key
    await store4.put('platform', 'main', { ...(await store4.get('platform', 'main')), ai: { mode: 'live' } });
    const j = await ce.generate('syn', 'syn-test-products-p4');
    await ce.waitForJob(j.id, { interval: 100 });
    assert.equal((await ce.getProduct('syn', 'syn-test-products-p4')).generatedWith.mock, true);
  } finally { srv.close(); await fs.rm(dir4, { recursive: true, force: true }) }
});

test('the AmplifAI tool: one call makes a guide with its toggles, it reads and approves it, and hears about changes', async () => {
  const dir5 = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-tool-'));
  const store5 = new FileStore(dir5);
  const engine = createEngine({ store: store5, adminKey: 'ak_t', toolKey: 'tk_t', previewSecret: 'ps', aiMode: 'mock', scheduler: false });
  const srv = http.createServer(engine.handler);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  // the tool's own server, receiving notifications
  const heard = [];
  const hook = http.createServer((req, res) => { let s = ''; req.on('data', c => s += c); req.on('end', () => { heard.push({ sig: req.headers['x-amplifai-signature'], ...JSON.parse(s) }); res.end('ok') }) });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));
  try {
    const adm = new ContentEngine({ baseUrl: b, key: 'ak_t' }), tool = new ContentEngine({ baseUrl: b, key: 'tk_t' });
    await adm.updatePlatform({ webhookUrl: `http://127.0.0.1:${hook.address().port}/hook` });
    assert.equal((await tool.me()).role, 'tool');
    await rejects(tool.updatePlatform({ refresh: 'off' }), 403);
    await rejects(tool.request('GET', '/v1/admin/costs'), 403);

    // 1 · make: the tool sends the shop, the product and the shop's toggles
    await store5.put('accounts', 'fietsenhuis', { id: 'fietsenhuis', name: 'Fietsenhuis', sample: true, settings: {}, settingsBy: {}, policy: {}, publicKey: 'pk_x', webhookSecret: 'w', usage: {} });
    await store5.put('catalogs', 'fietsenhuis', { shop: { name: 'Fietsenhuis' }, platform: 'sample', products: [{ url: 'https://fietsenhuis.test/products/helm', name: 'Helm', page: { url: 'https://fietsenhuis.test/products/helm', name: 'Merk Helm', brand: 'Merk', description: 'Een fietshelm met ventilatie en een draaiwiel achterop voor de pasvorm.' } }] });
    const r = await tool.request('POST', '/v1/guides', { shop: { id: 'fietsenhuis', name: 'Fietsenhuis' }, product: 'https://fietsenhuis.test/products/helm', settings: { tone: 'expert', formality: 'formal', tier: 'plus' }, approve: 'review' });
    assert.equal(r.guides[0].status, 'writing');
    await tool.waitForJob(r.guides[0].job, { interval: 100 });
    await rejects(tool.request('POST', '/v1/guides', { shop: 'fietsenhuis', product: 'https://fietsenhuis.test/products/helm', settings: { maxSearches: 1 } }), 403);

    // 2 · read: ready, written with the tool's toggles
    let g = await tool.request('GET', '/v1/guides?shop=fietsenhuis&product=' + encodeURIComponent('https://fietsenhuis.test/products/helm'));
    assert.equal(g.status, 'ready');
    assert.equal(g.guide.settings.tone, 'expert');
    assert.match(g.guide.guide.title.nl, /^Uw /);
    const flat = await tool.request('GET', '/v1/guides?shop=fietsenhuis&format=flat&lang=en&product=' + encodeURIComponent('https://fietsenhuis.test/products/helm'));
    assert.equal(typeof flat.guide.guide.hook, 'string');

    // 3 · approve: live, and visible to the public read
    const ap = await tool.request('POST', '/v1/guides/approve', { shop: 'fietsenhuis', product: 'https://fietsenhuis.test/products/helm' });
    assert.equal(ap.guides[0].status, 'live');
    assert.equal((await tool.request('GET', '/v1/guides?shop=fietsenhuis'))[0].status, 'live');

    // a new shop is created by the first call
    const r2 = await tool.request('POST', '/v1/guides', { shop: { id: 'nieuw', name: 'Nieuwe Shop', url: 'https://nieuw.test' }, products: [], settings: {} }).catch(e => e);
    assert.equal(r2.status, 422);
    assert.ok(await adm.getAccount('nieuw'));

    await new Promise(r => setTimeout(r, 300));
    const events = heard.map(h => h.event);
    assert.ok(events.includes('guide.ready') && events.includes('guide.published'), events.join(','));
    assert.ok(heard.every(h => /^sha256=/.test(h.sig) && h.shop === 'fietsenhuis'));
  } finally { srv.close(); hook.close(); await fs.rm(dir5, { recursive: true, force: true }) }
});

test('spending limits stop live mode before it goes over, the emergency stop works, and the test key never costs anything', async () => {
  // a stand-in for Anthropic that bills a lot for every call: 600,000 output tokens on Sonnet is about €5,50
  let calls = 0;
  const fake = http.createServer((req, res) => {
    calls++;
    req.resume();
    const text = 'Done.\n```json\n' + JSON.stringify({ product: { brand: 'Merk', name: 'Helm' }, facts: [{ category: 'special', claim: 'Has a dial.', url: 'https://kosten.test/products/helm', snippet: 'dial' }], question_ideas: [] }) + '\n```';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: { id: 'msg_' + calls, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 0 } } });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 600000 } });
    ev('message_stop', {});
    res.end();
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const oldBase = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  const dir6 = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-budget-'));
  const store6 = new FileStore(dir6);
  await store6.put('secrets', 'anthropic', { key: 'sk-ant-fake' });
  await store6.put('platform', 'main', { ai: { mode: 'live' } });
  const engine = createEngine({ store: store6, adminKey: 'ak_b', toolKey: 'tk_b', toolTestKey: 'tk_test_b', previewSecret: 'ps', scheduler: false });
  const srv = http.createServer(engine.handler);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const adm = new ContentEngine({ baseUrl: b, key: 'ak_b' }), tool = new ContentEngine({ baseUrl: b, key: 'tk_b' }), sandbox = new ContentEngine({ baseUrl: b, key: 'tk_test_b' });
  const helm = (slug, extra = '') => ({ url: `https://kosten.test/products/${slug}`, name: 'Merk Helm', brand: 'Merk', description: 'Een fietshelm met ventilatie en een draaiwiel achterop, zodat hij precies om je hoofd past.' + extra });
  const make = (who, slug, extra) => who.request('POST', '/v1/guides', { shop: { id: 'kosten', name: 'Kostenshop' }, product: helm(slug, extra), approve: 'review' });
  const read = (who, slug, shop = 'kosten') => who.request('GET', `/v1/guides?shop=${shop}&product=` + encodeURIComponent(`https://kosten.test/products/${slug}`));
  try {
    // the tool builds its settings screen from what shops may change; AmplifAI-only settings and models stay hidden
    const opts = await sandbox.request('GET', '/v1/guides/options');
    assert.deepEqual(opts.tiers.map(t => t.pricePerOrder), [0.05, 0.1, 0.13]);
    assert.ok(opts.settings.tone.options.includes('warm') && !('maxSearches' in opts.settings) && !JSON.stringify(opts).includes('claude-'));
    let budget = await adm.request('GET', '/v1/admin/budget');
    assert.deepEqual([budget.dayEUR, budget.monthEUR, budget.guideEUR, budget.todayEUR], [5, 25, 2, 0]);

    // 1 · day limit: the first call goes over it, so the next call is refused and the guide stops
    let r = await make(tool, 'helm');
    await tool.waitForJob(r.guides[0].job, { interval: 50 }).catch(() => {});
    let g = await read(tool, 'helm');
    assert.equal(g.status, 'failed');
    assert.match(g.error, /Dagbudget bereikt/);
    assert.equal(calls, 1);
    budget = await adm.request('GET', '/v1/admin/budget');
    assert.ok(budget.todayEUR > 5 && budget.todayEUR < 6, String(budget.todayEUR));
    // and new work is refused straight away, before anything is spent
    await rejects(make(tool, 'helm-2'), 402);
    assert.equal(calls, 1);

    // 2 · per-guide limit: with room for the day, one guide still may not cost more than its limit
    await rejects(adm.updatePlatform({ budget: { guideEUR: -1 } }), 422);
    await adm.updatePlatform({ budget: { dayEUR: 100, monthEUR: 100, guideEUR: 1 } });
    r = await make(tool, 'helm-3');
    await tool.waitForJob(r.guides[0].job, { interval: 50 }).catch(() => {});
    assert.match((await read(tool, 'helm-3')).error, /kostte meer dan €1,00/);
    assert.equal(calls, 2);
    assert.ok((await adm.request('GET', '/v1/admin/costs')).budget.monthSpentEUR > 10);

    // 3 · the test key: same calls, always test texts, never a call to Anthropic, and kept apart from real shops
    r = await make(sandbox, 'helm-t').catch(e => e);
    assert.equal(r.status, 403); // 'kosten' is a real shop
    const mk = (slug, extra) => sandbox.request('POST', '/v1/guides', { shop: { id: 'tool-test', name: 'Testwinkel' }, product: helm(slug, extra) });
    r = await mk('helm-t');
    await sandbox.waitForJob(r.guides[0].job, { interval: 50 });
    g = await read(sandbox, 'helm-t', 'tool-test');
    assert.equal(g.status, 'ready');
    assert.equal(g.guide.product.name, 'Merk Helm');
    assert.equal(calls, 2);
    assert.equal((await adm.getAccount('tool-test')).sandbox, true);
    await rejects(read(tool, 'helm-t', 'tool-test').then(() => sandbox.request('GET', '/v1/guides?shop=kosten')), 403);
    // same product data: nothing to do; changed product data: the guide is rewritten
    assert.equal((await mk('helm-t')).guides[0].status, 'ready');
    r = await mk('helm-t', ' Nu ook in maat XL.');
    assert.equal(r.guides[0].status, 'writing');
    await sandbox.waitForJob(r.guides[0].job, { interval: 50 });

    // 4 · emergency stop: back to test mode, nothing waiting starts
    const stop = await adm.request('POST', '/v1/admin/stop');
    assert.equal(stop.mode, 'test');
    assert.equal((await adm.request('GET', '/v1/admin/ai')).mode, 'test');
    r = await make(tool, 'helm-4');
    await tool.waitForJob(r.guides[0].job, { interval: 50 });
    assert.equal(calls, 2);
  } finally {
    srv.close(); fake.close(); await fs.rm(dir6, { recursive: true, force: true });
    if (oldBase === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = oldBase;
  }
});
