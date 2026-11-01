// Small client for the AmplifAI content engine, for the AmplifAI tool's server. Node 18+ (uses fetch).
//
//   import { ContentEngine } from './amplifai-content.js';
//   const ce = new ContentEngine({ baseUrl: 'http://localhost:4317', key: 'tk_test_…' });
//   const job = await ce.write({ product: { name, description, sku }, brand, settings: { toneOfVoice } });
//   const done = await ce.waitFor(job);              // done.result is what the tool stores
//   done.result.guides.nl.ordered                    // the tool's GuideContent, for save_guide_content
//   const rev = await ce.waitFor(await ce.revise(done.result, 'ordered.tips.1', 'Korter graag'));
//
// Keep the key on the server: never send it to a browser.

export class ContentEngineError extends Error {
  constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.body = body; this.field = body?.field; this.code = body?.code }
}

export class ContentEngine {
  constructor({ baseUrl, key, fetch: f } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.key = key;
    this.fetch = f || globalThis.fetch.bind(globalThis);
  }

  async request(method, path, body) {
    const r = await this.fetch(this.baseUrl + path, {
      method,
      headers: { ...(this.key && { authorization: 'Bearer ' + this.key }), ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = r.headers.get('content-type') || '';
    const data = type.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new ContentEngineError(r.status, typeof data === 'string' ? { error: data } : data);
    return data;
  }

  // the settings the tool can offer shops, the quality levels and the pieces of content
  options() { return this.request('GET', '/v1/options') }
  // { product, shop?, brand?, settings?, reference?, callbackUrl?, wait? } → a job
  write(req) { return this.request('POST', '/v1/content', req) }
  // result: what an earlier job returned (with the tool's current texts); piece: e.g. "ordered.questions.0"; wish: the shop's words
  revise(result, piece, wish, extra = {}) { return this.request('POST', '/v1/content/revise', { content: result, piece, wish, ...extra }) }
  // the AmplifAI rules, held against content the shop edited by hand
  check(result) { return this.request('POST', '/v1/content/check', { content: result }) }
  job(id, lang) { return this.request('GET', `/v1/content/${encodeURIComponent(id)}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`) }

  // Poll until the job is done; throws with the engine's reason when it failed.
  async waitFor(jobOrId, { interval = 2000, timeout = 10 * 60e3 } = {}) {
    const id = typeof jobOrId === 'string' ? jobOrId : jobOrId.id;
    const end = Date.now() + timeout;
    for (; ;) {
      const j = typeof jobOrId === 'object' && !['queued', 'working'].includes(jobOrId.status) ? jobOrId : await this.job(id);
      if (j.status === 'done') return j;
      if (j.status === 'failed' || j.status === 'cancelled') throw Object.assign(new ContentEngineError(422, { error: j.error, code: j.code }), { job: j });
      if (Date.now() > end) throw new Error('Wachten op taak duurde te lang: ' + id);
      jobOrId = id;
      await new Promise(r => setTimeout(r, interval));
    }
  }
}
