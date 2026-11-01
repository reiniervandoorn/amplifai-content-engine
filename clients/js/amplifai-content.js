// Small client for the AmplifAI content engine. Works in browsers and Node 18+ (uses fetch).
//
//   import { ContentEngine } from './amplifai-content.js';
//   const ce = new ContentEngine({ baseUrl: 'https://content.amplifai.nl', key: 'sk_…' });
//   const p = await ce.addProduct('voorbeeldshop', 'https://shop.nl/products/x');
//   const job = await ce.generate('voorbeeldshop', p.id, { tone: 'expert' });
//   await ce.waitForJob(job.id);
//   await ce.publish('voorbeeldshop', p.id);
//
// In a browser on the shop's site, use only the public key (pk_…) with getPublishedGuide().

export class ContentEngineError extends Error {
  constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.body = body; this.field = body?.field }
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
  #a(acc) { return `/v1/accounts/${encodeURIComponent(acc)}` }
  #p(acc, pid) { return `${this.#a(acc)}/products/${encodeURIComponent(pid)}` }

  // who am I: { role: 'admin' } or { role: 'account', account }
  me() { return this.request('GET', '/v1/me') }
  meta() { return this.request('GET', '/v1/meta') }

  // AmplifAI only
  getPlatform() { return this.request('GET', '/v1/platform') }
  updatePlatform(patch) { return this.request('PATCH', '/v1/platform', patch) }
  listAccounts() { return this.request('GET', '/v1/accounts') }
  createAccount(data) { return this.request('POST', '/v1/accounts', data) }

  // one shop
  getAccount(acc) { return this.request('GET', this.#a(acc)) }
  updateAccount(acc, patch) { return this.request('PATCH', this.#a(acc), patch) }
  getSettings(acc) { return this.request('GET', `${this.#a(acc)}/settings`) }
  updateSettings(acc, settings) { return this.request('PATCH', this.#a(acc), { settings }) }
  rotateKey(acc, type = 'secret') { return this.request('POST', `${this.#a(acc)}/keys`, { type }) }
  readCatalog(acc, url) { return this.request('POST', `${this.#a(acc)}/catalog`, { url }) }
  getCatalog(acc) { return this.request('GET', `${this.#a(acc)}/catalog`) }

  // products and guides
  listProducts(acc) { return this.request('GET', `${this.#a(acc)}/products`) }
  addProduct(acc, url) { return this.request('POST', `${this.#a(acc)}/products`, { url }) }
  getProduct(acc, pid) { return this.request('GET', this.#p(acc, pid)) }
  updateProduct(acc, pid, patch) { return this.request('PATCH', this.#p(acc, pid), patch) }
  research(acc, pid, { force = true } = {}) { return this.request('POST', `${this.#p(acc, pid)}/research`, { force }) }
  generate(acc, pid, settings) { return this.request('POST', `${this.#p(acc, pid)}/generate`, settings ? { settings } : {}) }
  batch(acc, { urls, productIds }) { return this.request('POST', `${this.#a(acc)}/batch`, { urls, productIds }) }
  editItem(acc, pid, path, value, { lock = true } = {}) { return this.request('PUT', `${this.#p(acc, pid)}/items/${encodeURIComponent(path)}`, { value, lock }) }
  removeItem(acc, pid, path) { return this.request('DELETE', `${this.#p(acc, pid)}/items/${encodeURIComponent(path)}`) }
  rewriteItem(acc, pid, path, wish) { return this.request('POST', `${this.#p(acc, pid)}/items/${encodeURIComponent(path)}/rewrite`, { wish }) }
  publish(acc, pid) { return this.request('POST', `${this.#p(acc, pid)}/publish`) }
  unpublish(acc, pid) { return this.request('DELETE', `${this.#p(acc, pid)}/publish`) }
  preview(acc, pid) { return this.request('POST', `${this.#p(acc, pid)}/preview`) }
  exportGuide(acc, pid, { format = 'guide', lang, version = 'draft' } = {}) {
    const q = new URLSearchParams({ format, version, ...(lang && { lang }) });
    return this.request('GET', `${this.#p(acc, pid)}/export?${q}`);
  }

  // jobs
  getJob(id) { return this.request('GET', `/v1/jobs/${encodeURIComponent(id)}`) }
  async waitForJob(id, { interval = 2000, timeout = 10 * 60e3, onProgress } = {}) {
    const end = Date.now() + timeout;
    let seen = 0;
    for (;;) {
      const j = await this.getJob(id);
      for (const p of j.progress.slice(seen)) onProgress?.(p.msg);
      seen = j.progress.length;
      if (j.status === 'done') return j;
      if (j.status === 'failed' || j.status === 'cancelled') throw new ContentEngineError(j.status === 'failed' ? 500 : 409, { error: j.error || 'Gestopt', job: j });
      if (Date.now() > end) throw new ContentEngineError(408, { error: 'Taak duurt te lang', job: j });
      await new Promise(r => setTimeout(r, interval));
    }
  }

  // public: safe in the browser with a pk_ key
  getPublishedGuide(product, { format = 'guide', lang, preview } = {}) {
    const q = new URLSearchParams({ key: this.key, product, format, ...(lang && { lang }), ...(preview && { preview }) });
    return this.request('GET', `/v1/public/guide?${q}`);
  }
}
