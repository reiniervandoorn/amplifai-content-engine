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
import * as mockAi from '../src/mock-ai.js';
import { guideContentSchema } from '../contracts/tool-guide-schema.mjs';

let dir, server, base, admin, tool, testTool, e0;

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
  const e = e0 = await boot();
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
  assert.equal(o.formatVersion, 3);
  assert.equal(o.settings.toneOfVoice.type, 'text');
  assert.deepEqual(o.settings.formality.options, ['auto', 'informal', 'formal']);
  assert.deepEqual(o.settings.languages.default, ['nl']);
  assert.deepEqual([o.settings.tipCount.max, o.settings.questionCount.max, o.settings.answerCount.min, o.settings.answerCount.max], [5, 3, 2, 5]);
  assert.deepEqual(o.qualities.map(q => q.id), ['basis', 'plus', 'premium']);
  assert.ok(o.qualities.every(q => q.estimatedCostEUR > 0));
  assert.deepEqual(o.moments.map(m => m.id), ['ordered', 'in_transit', 'delivered']);
  assert.ok(o.pieces.some(p => p.path === 'ordered.questions.N.answers.M'));
  assert.ok(!JSON.stringify(o).includes('claude-') && !('maxSearches' in o.settings));
});

const MOMENTS = ['ordered', 'in_transit', 'delivered'];
const ID = /^[0-9a-f-]{36}$/;

test('write: three guides per language, exactly in the tool\'s format, with sources and a passed quality check', async () => {
  const job = await write(testTool, {
    product: { name: 'Sencha Kyoto', sku: 'TEA-001', description: 'Japanse groene thee uit Kyoto. Zet met water van 70 graden, twee minuten. Zakje van 100 gram.' },
    shop: { name: 'Theehuis', url: 'theehuis.test' },
    brand: { story: 'Sinds 2009 halen wij thee rechtstreeks bij boeren.', audience: 'Thee-liefhebbers', usps: ['Rechtstreeks van de boer'], expertise: [{ title: 'Water', body: 'Zacht water geeft heldere thee.' }, { body: 'Uitgezet advies', enabled: false }] },
    settings: { languages: ['nl', 'en', 'de'], toneOfVoice: 'Write in a professional, polite and factual tone. Address the customer formally.', tipCount: 4, questionCount: 3, answerCount: 5 },
    reference: 'product-42',
  });
  assert.equal(job.status, 'done');
  assert.equal(job.reference, 'product-42');
  const r = job.result;
  assert.equal(r.formatVersion, 3);
  assert.equal(r.test, true);
  assert.equal(r.costEUR, 0);
  assert.deepEqual(r.languages, ['nl', 'en', 'de']);
  assert.equal(r.settings.formality, 'formal'); // "auto" read it from the tone of voice
  assert.ok(!('model' in r.settings));
  assert.deepEqual([r.product.name, r.product.url, r.product.sku], ['Sencha Kyoto', null, 'TEA-001']);
  assert.deepEqual(r.shop, { name: 'Theehuis', url: 'https://theehuis.test/', audience: 'Thee-liefhebbers' });
  assert.deepEqual(Object.keys(r.guides), ['nl', 'en', 'de']);
  for (const l of r.languages) for (const m of MOMENTS) {
    const g = r.guides[l][m];
    // the tool saves this as it is
    const ok = guideContentSchema.safeParse(g);
    assert.ok(ok.success, `${l}.${m}: ${JSON.stringify(ok.error?.issues?.[0])}`);
    assert.deepEqual([g.tips.length, g.questions.length], [4, 3]);
    assert.ok(g.questions.every(q => ID.test(q.id) && q.answers.length === 5 && q.answers.every(a => ID.test(a.id))));
  }
  // the same question has the same id in every language, and branching points at real later questions
  assert.equal(r.guides.nl.ordered.questions[1].id, r.guides.de.ordered.questions[1].id);
  assert.match(r.guides.nl.ordered.intro, /\bu\b/);
  // sources: the shop's own knowledge (s…), and facts from the product text without a page
  const shop = r.sources.filter(s => s.id.startsWith('s'));
  assert.deepEqual(shop.map(s => s.claim), ['Sinds 2009 halen wij thee rechtstreeks bij boeren.', 'Rechtstreeks van de boer', 'Water: Zacht water geeft heldere thee.']);
  assert.ok(shop.every(s => s.category === 'shop' && s.url === 'https://theehuis.test/'));
  assert.ok(r.sources.filter(s => s.id.startsWith('f')).every(s => s.url === null && s.title === 'Productgegevens van de shop'));
  const cited = Object.values(r.citations).flat();
  assert.ok(cited.length && cited.every(id => r.sources.some(s => s.id === id && s.used)));
  assert.ok(r.citations['ordered.intro'].includes('s1'));
  assert.equal(r.quality.ok, true, JSON.stringify(r.quality.issues));
  // one language
  const nl = await testTool.job(job.id, 'nl');
  assert.deepEqual(Object.keys(nl.result.guides), ['nl']);
  await rejects(testTool.job(job.id, 'fr'), 400);
});

test('write: bad input is refused with the field, before anything starts', async () => {
  await rejects(testTool.write({ product: { name: 'Alleen een naam' } }), 422, 'product.description');
  await rejects(testTool.write({ product: { description: 'Alleen tekst' } }), 422, 'product.name');
  await rejects(testTool.write({ product: helm({ url: 'ftp://x' }) }), 422, 'product.url');
  await rejects(testTool.write({ product: helm(), settings: { formality: 'boos' } }), 422, 'formality');
  await rejects(testTool.write({ product: helm(), settings: { tipCount: 6 } }), 422, 'tipCount');
  await rejects(testTool.write({ product: helm(), settings: { questionCount: 4 } }), 422, 'questionCount');
  await rejects(testTool.write({ product: helm(), settings: { answerCount: 1 } }), 422, 'answerCount');
  await rejects(testTool.write({ product: helm(), settings: { maxSearches: 15 } }), 422, 'maxSearches');
  await rejects(testTool.write({ product: helm(), brand: 'x' }), 422, 'brand');
  await rejects(testTool.write({ product: helm(), callbackUrl: 'niet-een-adres' }), 422, 'callbackUrl');
  await rejects(testTool.request('POST', '/v1/content', [1, 2]), 400);
  await rejects(testTool.job('job_bestaatniet'), 404);
});

test('revise: one piece changes with the shop\'s wish; ids, branching and the rest stay', async () => {
  const first = (await write(testTool, { settings: { languages: ['nl', 'en'] } })).result;
  const g0 = first.guides.nl.ordered;
  let job = await testTool.waitFor(await testTool.revise(first, 'ordered.intro', 'Noem dat ze uit Utrecht komen', { wait: true }));
  let r = job.result;
  assert.equal(job.kind, 'revise');
  assert.deepEqual(r.revised, { piece: 'ordered.intro', wish: 'Noem dat ze uit Utrecht komen' });
  assert.notEqual(r.guides.nl.ordered.intro, g0.intro);
  assert.deepEqual(r.guides.nl.ordered.questions, g0.questions);
  assert.deepEqual(r.guides.nl.delivered, first.guides.nl.delivered);
  // the wish is the shop's word about its own product, and may be cited as such
  assert.equal(r.sources.find(s => s.id === 'w1').claim, 'Noem dat ze uit Utrecht komen');
  assert.ok(r.citations['ordered.intro'].includes('w1'));
  // a question: same id, same answer ids, same branching
  job = await testTool.waitFor(await testTool.revise(r, 'ordered.questions.0', 'Vraag naar het moment van de dag', { wait: true }));
  const q0 = g0.questions[0], q1 = job.result.guides.nl.ordered.questions[0];
  assert.notEqual(q1.question, q0.question);
  assert.equal(q1.id, q0.id);
  assert.deepEqual(q1.answers.map(a => [a.id, a.next]), q0.answers.map(a => [a.id, a.next]));
  assert.ok(job.result.sources.some(s => s.id === 'w1'));
  // one answer, one tip, a whole moment
  job = await testTool.waitFor(await testTool.revise(job.result, 'ordered.questions.0.answers.1', 'Korter', { wait: true }));
  assert.equal(job.result.guides.nl.ordered.questions[0].answers[1].id, q0.answers[1].id);
  job = await testTool.waitFor(await testTool.revise(job.result, 'delivered.tips.2', '', { wait: true }));
  assert.notEqual(job.result.guides.nl.delivered.tips[2], first.guides.nl.delivered.tips[2]);
  job = await testTool.waitFor(await testTool.revise(job.result, 'in_transit', '', { wait: true }));
  for (const l of ['nl', 'en']) for (const m of MOMENTS) assert.ok(guideContentSchema.safeParse(job.result.guides[l][m]).success);
  assert.deepEqual(job.result.guides.nl.in_transit.questions.map(q => q.id), first.guides.nl.in_transit.questions.map(q => q.id));
  // a text the shop edited in the tool is kept when another piece is revised
  const edited = structuredClone(job.result);
  edited.guides.nl.ordered.tips[0] = 'Mijn eigen tip.';
  job = await testTool.waitFor(await testTool.revise(edited, 'ordered.tips.1', '', { wait: true }));
  assert.equal(job.result.guides.nl.ordered.tips[0], 'Mijn eigen tip.');
  // the form of address may change on a revision; the languages may not
  job = await testTool.waitFor(await testTool.revise(first, 'ordered.intro', '', { wait: true, settings: { formality: 'formal' } }));
  assert.equal(job.result.settings.formality, 'formal');
  await rejects(testTool.revise(first, 'ordered.intro', '', { settings: { languages: ['nl'] } }), 422, 'settings.languages');
  await rejects(testTool.revise(first, 'ordered.tips.9', 'x'), 422, 'piece');
  await rejects(testTool.revise(first, 'story', 'x'), 422, 'piece');
  await rejects(testTool.revise({ ...first, formatVersion: 2 }, 'ordered.intro', 'x'), 422, 'content');
  const broken = structuredClone(first);
  broken.guides.en.ordered.tips.pop();
  await rejects(testTool.revise(broken, 'ordered.intro', 'x'), 422, 'content');
});

test('check: the AmplifAI rules and the tool\'s limits, held against guides the shop edited', async () => {
  const r = (await write(testTool)).result;
  assert.equal((await testTool.check(r)).ok, true);
  const edited = structuredClone(r), g = edited.guides.nl;
  g.delivered.tips[0] = 'Koop er meteen een tweede bij met 10% korting!';
  g.ordered.intro = 'Sinds 1987 maakt Velo helmen. Wilt u er een?';
  delete edited.citations['ordered.intro'];
  g.in_transit.questions[0].answers[0].label = 'x'.repeat(250);
  g.ordered.questions[1].answers[0].next = g.ordered.questions[0].id;
  const q = await testTool.check(edited);
  assert.equal(q.ok, false);
  const codes = q.issues.map(i => `${i.piece}:${i.code}`);
  for (const want of ['delivered.tips.0:sell', 'ordered.intro:source', 'ordered.intro:form', 'in_transit.questions.0.answers.0:fit', 'ordered.questions.1.answers.0:flow'])
    assert.ok(codes.includes(want), `${want} in ${codes.join()}`);
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
    assert.deepEqual(body.job.result.guides, done.result.guides);
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

test('admin: quality levels, instructions, the quality check and the defaults for shops', async () => {
  await rejects(admin.request('PATCH', '/v1/admin/settings', { levels: { basis: { model: 'gpt-9' } } }), 422);
  const st = await admin.request('PATCH', '/v1/admin/settings', { levels: { basis: { model: 'claude-haiku-5-5' } } });
  assert.equal(st.levels.find(l => l.id === 'basis').model, 'claude-haiku-5-5');
  assert.ok((await testTool.options()).qualities[0].estimatedCostEUR < 0.1);
  await rejects(admin.request('PATCH', '/v1/admin/settings', { instructions: { factsMin: 50, factsMax: 20 } }), 422, 'factsMin');
  await rejects(admin.request('PATCH', '/v1/admin/settings', { instructions: { onbekend: 1 } }), 422, 'onbekend');
  await rejects(admin.request('PATCH', '/v1/admin/settings', { instructions: { rules: [] } }), 422, 'rules');
  await rejects(admin.request('PATCH', '/v1/admin/settings', { instructions: { momentOrdered: '  ' } }), 422, 'momentOrdered');
  await rejects(admin.request('PATCH', '/v1/admin/settings', { instructions: { checks: { sell: 'soms' } } }), 422, 'checks');
  await rejects(admin.request('PATCH', '/v1/admin/settings', { defaults: { tipCount: 9 } }), 422, 'tipCount');
  await rejects(tool.request('PATCH', '/v1/admin/settings', { instructions: { factsMin: 10 } }), 403);
  // defaults for shops apply to what the tool leaves out; the tool cannot send AmplifAI's instructions
  let s2 = await admin.request('PATCH', '/v1/admin/settings', { instructions: { blockedDomains: ['https://www.Reviews.test/page'] }, defaults: { tipCount: 2, questionCount: 1, formality: 'formal' } });
  assert.equal(s2.instructions.blockedDomains[0], 'www.reviews.test');
  assert.equal((await testTool.options()).settings.tipCount.default, 2);
  await rejects(testTool.write({ product: helm(), settings: { factsMin: 4 } }), 422, 'factsMin');
  const r = (await write(testTool)).result;
  assert.deepEqual([r.guides.nl.ordered.tips.length, r.guides.nl.delivered.questions.length, r.settings.formality], [2, 1, 'formal']);
  assert.equal(r.quality.ok, true, JSON.stringify(r.quality.issues));
  // the quality check: levels and word lists are AmplifAI's
  s2 = await admin.request('PATCH', '/v1/admin/settings', { instructions: { sellWords: [...s2.instructions.sellWords, 'gratis'], checks: { long: 'off', sell: 'warn' } } });
  assert.equal(s2.checks.fit.label, 'Past niet in de tool');
  const edited = structuredClone(r);
  edited.guides.nl.ordered.intro = 'Nu gratis erbij. ' + 'Lang. '.repeat(80);
  const q = await testTool.check(edited);
  assert.deepEqual(q.issues.map(i => `${i.code}:${i.level}`), ['sell:warn']);
  assert.equal(q.ok, true);
  // only what differs from the built-in default is stored
  assert.deepEqual(Object.keys((await e0.store.get('platform', 'main')).instructions).sort(), ['blockedDomains', 'checks', 'sellWords']);
  // the full instruction as Claude gets it, for chosen shop settings
  await admin.request('PATCH', '/v1/admin/settings', { instructions: { momentDelivered: 'Just delivered. Only the first five minutes.', pieceTips: '{tipCount} tips, each starting with a verb.' } });
  const pv = await admin.request('GET', '/v1/admin/prompt?' + new URLSearchParams({ toneOfVoice: 'Calm. Address the customer formally.', tipCount: 2, languages: 'nl' }));
  assert.ok(pv.writing.includes('- delivered: Just delivered. Only the first five minutes.'));
  assert.ok(pv.writing.includes('- tips: 2 tips, each starting with a verb.'));
  assert.ok(pv.writing.includes('Calm. Address the customer formally.') && pv.writing.includes('"u" and "uw"'));
  // the house style always applies, the shop's tone of voice comes on top
  assert.ok(pv.writing.indexOf('- House style (AmplifAI, always): Calm and clear') < pv.writing.indexOf('- Tone of voice (the shop'));
  assert.match(pv.research, /Aim for 18 to 30 facts/);
  await rejects(tool.request('GET', '/v1/admin/prompt'), 403);
  // instructions saved by an older version are ignored, not an error
  await e0.store.put('platform', 'main', { ...(await e0.store.get('platform', 'main')), instructions: { ...(await e0.store.get('platform', 'main')).instructions, toneWarm: 'oud', checks: { sell: 'warn', headline: 'off' } } });
  s2 = await admin.request('GET', '/v1/admin/status');
  assert.ok(!('toneWarm' in s2.instructions) && !('headline' in s2.instructions.checks) && s2.instructions.checks.sell === 'warn');
  // null puts back the built-in default
  s2 = await admin.request('PATCH', '/v1/admin/settings', { instructions: { blockedDomains: null, sellWords: null, checks: null, momentDelivered: null, pieceTips: null }, defaults: { tipCount: null, questionCount: null, formality: null } });
  assert.deepEqual((await e0.store.get('platform', 'main')).instructions, {});
  assert.deepEqual([s2.defaults.tipCount, s2.defaults.formality], [3, 'auto']);
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

test('live writing: Claude answers in JSON, a wrong answer is sent back once, research is reused for a new tone', async () => {
  // a stand-in for Anthropic: research answers with facts; writing first leaves out a piece, then gets it right
  const calls = { research: 0, write: 0 }, prompts = [];
  const page = { url: 'https://fietsshop.test/products/helm-aero', name: 'Velo Aero Fietshelm', brand: 'Velo', description: helm().description };
  const research = { product: { brand: 'Velo', name: 'Aero', short_name: 'Aero' }, facts: [{ category: 'brand', claim: 'Velo was founded in 1990.', url: page.url, snippet: 'since 1990' }], question_ideas: [] };
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', async () => {
      const body = JSON.parse(b), isResearch = /You research one product/.test(body.system);
      prompts.push(body.system);
      let text;
      if (isResearch) { calls.research++; text = '```json\n' + JSON.stringify(research) + '\n```' }
      else {
        calls.write++;
        const settings = { languages: ['nl'], formality: 'informal', tipCount: 3, questionCount: 2, answerCount: 3 };
        const { content } = await mockAi.write({ page, research: { product: research.product, facts: [{ id: 'f1', category: 'brand', claim: 'x', url: page.url }] }, settings });
        content.ordered.questions[1].answers[0].next = 0; // points back: the engine turns it into "next"
        if (calls.write === 1) delete content.delivered;
        text = 'Here it is.\n```json\n' + JSON.stringify(content) + '\n```';
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: 'msg', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 0 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2000 } });
      ev('message_stop', {});
      res.end();
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const oldBase = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  const e = await boot({ seed: [['secrets', 'anthropic', { key: 'sk-ant-fake' }], ['platform', 'main', { mode: 'live', instructions: { extra: 'Noem nooit de prijs.', rules: ['Rule one.', 'Rule two.'], factsMin: 7, factsMax: 9 } }]] });
  const live = e.client('tk_t');
  try {
    let j = await live.waitFor(await live.write({ product: helm(), wait: true }), { interval: 50 });
    assert.equal(j.result.test, false);
    assert.deepEqual(calls, { research: 1, write: 2 });
    for (const m of MOMENTS) assert.ok(guideContentSchema.safeParse(j.result.guides.nl[m]).success, m);
    assert.equal(j.result.guides.nl.ordered.questions[1].answers[0].next, 'next');
    assert.equal(j.result.guides.nl.ordered.questions[0].answers[1].next, 'end');
    assert.ok(j.result.costEUR > 0);
    assert.equal(j.result.sources[0].claim, 'Velo was founded in 1990.');
    // AmplifAI's instructions from the admin page go into the prompts
    assert.match(prompts[0], /Aim for 7 to 9 facts/);
    assert.ok(prompts[1].includes('- Rule one.\n- Rule two.') && prompts[1].includes('AmplifAI adds: Noem nooit de prijs.'));
    assert.ok(!prompts[1].includes('No independent tests'));
    // the shop picks another tone: the research is reused, only the writing is paid again
    j = await live.waitFor(await live.write({ product: helm(), settings: { toneOfVoice: 'Expert and precise.' }, wait: true }), { interval: 50 });
    assert.equal(j.status, 'done');
    assert.equal(calls.research, 1);
    assert.ok(j.progress.some(p => /eerder onderzoek/.test(p.msg)));
    // changed product data means new research
    await live.waitFor(await live.write({ product: helm({ description: helm().description + ' Nu ook in XL.' }), wait: true }), { interval: 50 });
    assert.equal(calls.research, 2);
  } finally {
    fake.close(); await e.close();
    if (oldBase === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = oldBase;
  }
});
