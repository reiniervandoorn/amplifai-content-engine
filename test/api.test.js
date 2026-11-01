// End-to-end tests of the API, without Anthropic: keys, writing, revising, checking, callbacks, spending limits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createEngine } from '../src/app.js';
import { FileStore } from '../src/store.js';
import { ContentEngine } from '../clients/js/amplifai-content.js';

let dir, server, base, admin, tool, testTool;

// an engine on a free port; the caller closes it
async function boot(opts = {}) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-'));
  const store = new FileStore(d);
  for (const [col, id, v] of opts.seed || []) await store.put(col, id, v);
  const engine = createEngine({ store, adminKey: 'ak_t', toolKey: 'tk_t', toolTestKey: 'tk_test_t', aiMode: 'mock', readPages: false, ...opts.engine });
  const srv = http.createServer(engine.handler);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  return { dir: d, store, engine, srv, base: b, client: key => new ContentEngine({ baseUrl: b, key }), close: async () => { srv.close(); await fs.rm(d, { recursive: true, force: true }) } };
}

before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const e = await boot();
  ({ dir, srv: server, base } = e);
  admin = e.client('ak_t'); tool = e.client('tk_t'); testTool = e.client('tk_test_t');
});
after(async () => { server.close(); await fs.rm(dir, { recursive: true, force: true }) });

const rejects = async (p, status, field) => { await assert.rejects(p, e => { assert.equal(e.status, status, e.message); if (field) assert.equal(e.field, field); return true }) };
const helm = (extra = {}) => ({
  url: 'https://fietsshop.test/products/helm-aero', name: 'Velo Aero Fietshelm', brand: 'Velo', price: '€89,95',
  description: 'Lichte fietshelm met 18 ventilatieopeningen, een draaiwiel achterop voor de pasvorm en een afneembaar achterlicht. Weegt 260 gram.', ...extra,
});
const write = async (who, body = {}) => who.waitFor(await who.write({ product: helm(), shop: { name: 'Fietsshop Jansen', url: 'fietsshop.test' }, wait: true, ...body }), { interval: 50 });

test('keys: the tool and its test key reach the content calls, only AmplifAI reaches the admin calls', async () => {
  assert.equal((await new ContentEngine({ baseUrl: base }).request('GET', '/v1/health')).ok, true);
  await rejects(new ContentEngine({ baseUrl: base }).options(), 401);
  await rejects(new ContentEngine({ baseUrl: base, key: 'tk_nope' }).options(), 401);
  await rejects(tool.request('GET', '/v1/admin/status'), 403);
  await rejects(testTool.request('POST', '/v1/admin/stop'), 403);
  const st = await admin.request('GET', '/v1/admin/status');
  assert.deepEqual([st.mode, st.keys.tool, st.keys.test], ['test', 'tk_t', 'tk_test_t']);
  assert.match(st.keys.callbackSecret, /^whsec_/);
});

test('options: what the tool needs to build its settings screen, without models', async () => {
  const o = await testTool.options();
  assert.equal(o.formatVersion, 2);
  assert.deepEqual(o.settings.tone.options, ['warm', 'neutral', 'expert', 'playful']);
  assert.deepEqual(o.settings.languages.default, ['nl', 'en']);
  assert.deepEqual(o.qualities.map(q => q.id), ['basis', 'plus', 'premium']);
  assert.ok(o.qualities.every(q => q.estimatedCostEUR > 0));
  assert.ok(o.pieces.some(p => p.path === 'question.options.N'));
  assert.ok(!JSON.stringify(o).includes('claude-') && !('maxSearches' in o.settings));
});

test('write: the content comes back whole, in every language, with sources and a passed quality check', async () => {
  const job = await write(testTool, { settings: { languages: ['nl', 'en', 'de'], formality: 'formal', tipCount: 2, answerCount: 3 }, reference: 'order-42' });
  assert.equal(job.status, 'done');
  assert.equal(job.reference, 'order-42');
  const r = job.result, c = r.content;
  assert.equal(r.formatVersion, 2);
  assert.equal(r.test, true);
  assert.equal(r.costEUR, 0);
  assert.deepEqual(r.languages, ['nl', 'en', 'de']);
  assert.equal(r.settings.formality, 'formal');
  assert.ok(!('model' in r.settings));
  assert.equal(r.product.name, 'Velo Aero Fietshelm');
  assert.deepEqual(r.shop, { name: 'Fietsshop Jansen', url: 'https://fietsshop.test/' });
  assert.deepEqual(Object.keys(c), ['shortName', 'intro', 'story', 'special', 'expect', 'fact', 'care', 'experience', 'question', 'tips', 'whileYouWait', 'firstMinutes']);
  assert.ok(['nl', 'en', 'de'].every(l => typeof c.story.text[l] === 'string' && c.story.text[l]));
  assert.match(c.intro.title.nl, /^Uw nieuwe/);
  assert.equal(c.tips.new.length, 2);
  assert.equal(c.question.options.length, 3);
  assert.ok(c.question.options.every(o => o.key && o.tip.title.nl && o.result.lines.length === 2));
  // every cited fact is in the sources, with where it came from
  const ids = new Set(r.sources.map(s => s.id));
  assert.ok(c.story.src.every(id => ids.has(id)) && r.sources.some(s => s.used));
  assert.ok(r.sources.every(s => s.url && s.claim));
  assert.equal(r.quality.ok, true, JSON.stringify(r.quality.issues));
  // one language, plain strings
  const nl = await testTool.job(job.id, 'nl');
  assert.equal(typeof nl.result.content.story.text, 'string');
  await rejects(testTool.job(job.id, 'fr'), 400);
});

test('write: bad input is refused with the field, before anything starts', async () => {
  await rejects(testTool.write({ product: { name: 'Geen url' } }), 422, 'product.url');
  await rejects(testTool.write({ product: helm({ url: 'ftp://x' }) }), 422, 'product.url');
  await rejects(testTool.write({ product: helm(), settings: { tone: 'boos' } }), 422, 'tone');
  await rejects(testTool.write({ product: helm(), settings: { tipCount: 9 } }), 422, 'tipCount');
  await rejects(testTool.write({ product: helm(), settings: { maxSearches: 15 } }), 422, 'maxSearches');
  await rejects(testTool.write({ product: helm(), callbackUrl: 'niet-een-adres' }), 422, 'callbackUrl');
  await rejects(testTool.request('POST', '/v1/content', [1, 2]), 400);
  await rejects(testTool.job('job_bestaatniet'), 404);
});

test('revise: one piece changes with the shop\'s wish, the rest stays, answer keys are kept', async () => {
  const first = (await write(testTool)).result;
  let job = await testTool.waitFor(await testTool.revise(first, 'story', 'Noem dat Velo uit Utrecht komt', { wait: true }));
  const r = job.result;
  assert.equal(job.kind, 'revise');
  assert.deepEqual(r.revised, { piece: 'story', wish: 'Noem dat Velo uit Utrecht komt' });
  assert.notDeepEqual(r.content.story, first.content.story);
  assert.deepEqual(r.content.tips, first.content.tips);
  assert.deepEqual(r.content.intro, first.content.intro);
  // the wish is the shop's word about its own product, and may be cited as such
  const w = r.sources.find(s => s.id === 'w1');
  assert.equal(w.claim, 'Noem dat Velo uit Utrecht komt');
  assert.ok(r.content.story.src.includes('w1'));
  // a second revision builds on the first: its wish gets the next id, and earlier facts stay available
  job = await testTool.waitFor(await testTool.revise(r, 'question', '', { wait: true }));
  assert.deepEqual(job.result.content.question.options.map(o => o.key), first.content.question.options.map(o => o.key));
  assert.ok(job.result.sources.some(s => s.id === 'w1'));
  job = await testTool.waitFor(await testTool.revise(job.result, 'question.options.1', 'Korter', { wait: true }));
  assert.equal(job.result.content.question.options[1].key, first.content.question.options[1].key);
  // the tone or form of address may change on a revision; the languages may not
  job = await testTool.waitFor(await testTool.revise(first, 'intro', '', { wait: true, settings: { formality: 'formal' } }));
  assert.match(job.result.content.intro.title.nl, /^Uw/);
  await rejects(testTool.revise(first, 'intro', '', { settings: { languages: ['nl'] } }), 422, 'settings.languages');
  await rejects(testTool.revise(first, 'tips.new.9', 'x'), 422, 'piece');
  await rejects(testTool.revise(first, 'sources', 'x'), 422, 'piece');
  await rejects(testTool.revise({ ...first, formatVersion: 1 }, 'story', 'x'), 422, 'content');
  await rejects(testTool.revise({ ...first, content: { ...first.content, story: 'kapot' } }, 'story', 'x'), 422, 'content');
});

test('check: the AmplifAI rules, held against text the shop edited by hand', async () => {
  const r = (await write(testTool)).result;
  assert.equal((await testTool.check(r)).ok, true);
  const edited = structuredClone(r);
  edited.content.tips.new[0].text.nl = 'Koop er meteen een tweede bij met 10% korting!';
  edited.content.story.text.nl = 'Sinds 1987 maakt Velo helmen. Wilt u er een?';
  edited.content.story.src = [];
  const q = await testTool.check(edited);
  assert.equal(q.ok, false);
  const codes = q.issues.map(i => `${i.piece}:${i.code}`);
  assert.ok(codes.includes('tips.new.0:sell'), codes.join());
  assert.ok(codes.includes('story:source'), codes.join());
  assert.ok(codes.includes('story:form'), codes.join());
});

test('jobs: without wait the answer comes at once; a callback brings the result, signed', async () => {
  const heard = [];
  const hook = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { heard.push({ body: b, sig: req.headers['x-amplifai-signature'] }); res.end('ok') }) });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));
  try {
    const j = await testTool.write({ product: helm(), callbackUrl: `http://127.0.0.1:${hook.address().port}/engine` });
    assert.ok(['queued', 'working'].includes(j.status));
    const done = await testTool.waitFor(j, { interval: 50 });
    for (let i = 0; i < 40 && !heard.length; i++) await new Promise(r => setTimeout(r, 25));
    assert.equal(heard.length, 1);
    const body = JSON.parse(heard[0].body);
    assert.equal(body.event, 'content.done');
    assert.deepEqual(body.job.result.content, done.result.content);
    const secret = (await admin.request('GET', '/v1/admin/status')).keys.callbackSecret;
    assert.equal(heard[0].sig, 'sha256=' + crypto.createHmac('sha256', secret).update(heard[0].body).digest('hex'));
  } finally { hook.close() }
});

test('jobs survive a restart as stored results, and running ones are marked failed', async () => {
  const e = await boot({ seed: [['jobs', 'job_old', { id: 'job_old', status: 'working', createdAt: new Date().toISOString() }],
    ['jobs', 'job_ancient', { id: 'job_ancient', status: 'done', createdAt: '2020-01-01T00:00:00.000Z' }]] });
  try {
    const c = e.client('tk_test_t');
    const j = await c.job('job_old');
    assert.equal(j.status, 'failed');
    assert.match(j.error, /herstart/);
    await rejects(c.job('job_ancient'), 404);
  } finally { await e.close() }
});

test('admin: quality levels pick a model; live needs a key', async () => {
  await rejects(admin.request('PATCH', '/v1/admin/settings', { levels: { basis: { model: 'gpt-9' } } }), 422);
  const st = await admin.request('PATCH', '/v1/admin/settings', { levels: { basis: { model: 'claude-haiku-5-5' } } });
  assert.equal(st.levels.find(l => l.id === 'basis').model, 'claude-haiku-5-5');
  assert.ok((await testTool.options()).qualities[0].estimatedCostEUR < 0.1);
  await rejects(admin.request('PUT', '/v1/admin/ai', { mode: 'live' }), 409);
  await rejects(admin.request('PUT', '/v1/admin/ai', { key: 'geen-sleutel' }), 422);
});

test('spending limits stop live mode before it goes over, the emergency stop works, and the test key never costs anything', async () => {
  // a stand-in for Anthropic that bills a lot for every call: 600,000 output tokens on Sonnet is about €5,50
  let calls = 0;
  const fake = http.createServer((req, res) => {
    calls++;
    req.resume();
    const text = 'Done.\n```json\n' + JSON.stringify({ product: { brand: 'Velo', name: 'Helm' }, facts: [{ category: 'special', claim: 'Has a dial.', url: 'https://fietsshop.test/products/helm-aero', snippet: 'dial' }], question_ideas: [] }) + '\n```';
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
  const e = await boot({ seed: [['secrets', 'anthropic', { key: 'sk-ant-fake' }], ['platform', 'main', { mode: 'live' }]] });
  const adm = e.client('ak_t'), live = e.client('tk_t'), sandbox = e.client('tk_test_t');
  const run = async who => (await who.waitFor(await who.write({ product: helm(), wait: true }), { interval: 50 }).catch(err => err.job));
  try {
    let budget = (await adm.request('GET', '/v1/admin/status')).budget;
    assert.deepEqual([budget.dayEUR, budget.monthEUR, budget.productEUR, budget.todayEUR], [5, 25, 2, 0]);

    // 1 · day limit: the first call goes over it, so the next call is refused and the job stops
    let j = await run(live);
    assert.equal(j.status, 'failed');
    assert.equal(j.code, 'budget');
    assert.match(j.error, /Dagbudget bereikt/);
    assert.equal(calls, 1);
    budget = (await adm.request('GET', '/v1/admin/status')).budget;
    assert.ok(budget.todayEUR > 5 && budget.todayEUR < 6, String(budget.todayEUR));
    // and new work is refused straight away, before anything is spent
    await rejects(live.write({ product: helm() }), 402);
    assert.equal(calls, 1);

    // 2 · per-product limit: with room for the day, one product still may not cost more than its limit
    await rejects(adm.request('PATCH', '/v1/admin/settings', { budget: { productEUR: -1 } }), 422);
    await adm.request('PATCH', '/v1/admin/settings', { budget: { dayEUR: 100, monthEUR: 100, productEUR: 1 } });
    j = await run(live);
    assert.match(j.error, /kostte meer dan €1,00/);
    assert.equal(calls, 2);
    assert.ok((await adm.request('GET', '/v1/admin/status')).budget.monthSpentEUR > 10);

    // 3 · the test key: same calls, always test texts, never a call to Anthropic, even in live mode
    j = await run(sandbox);
    assert.equal(j.status, 'done');
    assert.equal(j.result.test, true);
    assert.equal(calls, 2);

    // 4 · emergency stop: back to test mode, and the tool key gets test texts too
    const stop = await adm.request('POST', '/v1/admin/stop');
    assert.equal(stop.mode, 'test');
    j = await run(live);
    assert.equal(j.status, 'done');
    assert.equal(j.result.test, true);
    assert.equal(calls, 2);
    // the admin page's recent list shows what happened
    const recent = (await adm.request('GET', '/v1/admin/status')).recent;
    assert.equal(recent.filter(r => r.status === 'failed').length, 2);
  } finally {
    fake.close(); await e.close();
    if (oldBase === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = oldBase;
  }
});
