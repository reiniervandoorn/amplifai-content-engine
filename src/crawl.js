// Reads one product page: structured data first, readable text second. No LLM here: only what the shop
// itself publishes, used to fill in what the tool did not send.
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (compatible; AmplifAI-ContentEngine/0.1; +https://amplifai.nl)';

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Geen URL opgegeven');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Alleen http(s) URL’s');
  u.hash = '';
  return u;
}

// Polite to every shop: requests to one host go one at a time with a short pause, and a
// "too many requests" (429) or "busy" (503) answer is retried after the wait the shop asks for.
const GAP_MS = Number(process.env.CRAWL_GAP_MS ?? 700);
const hosts = new Map();
function slot(host) {
  const prev = hosts.get(host) || Promise.resolve();
  let release;
  const mine = new Promise(r => { release = r });
  hosts.set(host, prev.then(() => mine));
  return prev.then(() => () => setTimeout(release, GAP_MS));
}
async function get(url, { accept = 'text/html,application/xhtml+xml', timeout = 15000 } = {}) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const done = await slot(host);
    let res;
    try { res = await fetch(url, { headers: { 'user-agent': UA, accept, 'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) }) }
    finally { done() }
    if ((res.status !== 429 && res.status !== 503) || attempt >= 4) return res;
    const after = Number(res.headers.get('retry-after'));
    await new Promise(r => setTimeout(r, Math.min(30000, (isFinite(after) && after > 0 ? after * 1000 : 2000 * 2 ** attempt))));
  }
}
async function getText(url, opts) {
  const res = await get(url, opts);
  if (!res.ok) throw new Error(`${res.status} bij ${url}`);
  return { text: await res.text(), url: res.url, type: res.headers.get('content-type') || '' };
}
async function getJson(url) {
  try {
    const res = await get(url, { accept: 'application/json' });
    if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) return null;
    return await res.json();
  } catch { return null }
}

/* ── robots.txt: honour Disallow rules for all user agents ── */
const robotsCache = new Map();
async function robots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const r = { disallow: [], allow: [] };
  try {
    const { text } = await getText(origin + '/robots.txt', { accept: 'text/plain' });
    let applies = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'user-agent') applies = v === '*';
      else if (applies && k === 'disallow' && v) r.disallow.push(v);
      else if (applies && k === 'allow' && v) r.allow.push(v);
    }
  } catch { /* no robots.txt: everything allowed */ }
  robotsCache.set(origin, r);
  return r;
}
const ruleMatch = (path, rule) => {
  const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(path);
};
export async function allowed(url) {
  const u = new URL(url), r = await robots(u.origin), p = u.pathname + u.search;
  const dis = r.disallow.filter(d => ruleMatch(p, d)).sort((a, b) => b.length - a.length)[0];
  if (!dis) return true;
  const al = r.allow.filter(a => ruleMatch(p, a)).sort((a, b) => b.length - a.length)[0];
  return !!al && al.length >= dis.length;
}

const money = (amount, cur) => {
  if (amount == null || amount === '') return null;
  const n = Number(amount);
  if (!isFinite(n)) return String(amount);
  const sym = { EUR: '€', USD: '$', GBP: '£' }[cur || 'EUR'] || (cur + ' ');
  return sym + n.toFixed(2).replace('.', ',');
};

/* ── one product page: structured data first, readable text second ── */
function jsonLdProducts($) {
  const found = [];
  const visit = n => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const t = [].concat(n['@type'] || []);
    if (t.includes('Product') || t.includes('ProductGroup')) found.push(n);
    if (n['@graph']) visit(n['@graph']);
  };
  $('script[type="application/ld+json"]').each((_, e) => {
    try { visit(JSON.parse($(e).contents().text())) } catch { }
  });
  return found;
}
const cleanImage = (src, base) => {
  if (!src) return null;
  const u = new URL(src, base);
  ['width', 'height', 'w', 'h'].forEach(k => u.searchParams.delete(k));
  return u.href;
};
const first = v => Array.isArray(v) ? v[0] : v;
const txt = v => typeof v === 'string' ? v : v?.name || null;

export async function product(url) {
  if (!(await allowed(url))) throw new Error('robots.txt van deze shop staat het lezen van deze pagina niet toe');
  const page = await getText(url);
  const $ = cheerio.load(page.text);
  const ld = jsonLdProducts($)[0] || {};
  const offer = first(ld.offers?.offers || ld.offers) || first(first(ld.hasVariant)?.offers) || {};
  const og = p => $(`meta[property="${p}"]`).attr('content') || null;
  const price = offer.price || offer.lowPrice || $('meta[property="product:price:amount"]').attr('content');
  const props = [].concat(ld.additionalProperty || []).map(p => p?.name && p?.value != null ? `${p.name}: ${p.value}` : null).filter(Boolean);

  // Shopify keeps the full description in /products/<handle>.json
  let bodyHtml = null;
  if (/\/products\/[^/]+\/?$/.test(new URL(page.url).pathname)) {
    const j = await getJson(page.url.replace(/\/$/, '') + '.json');
    bodyHtml = j?.product?.body_html || null;
  }

  $('script,style,noscript,svg,iframe,nav,footer,header,form,[aria-hidden="true"],.cookie,#cookie').remove();
  const main = $('main').length ? $('main') : $('body');
  const text = main.text().replace(/\s+/g, ' ').trim().slice(0, 24000);

  return {
    url: page.url,
    name: txt(ld.name) || og('og:title') || $('h1').first().text().trim(),
    brand: txt(first(ld.brand)) || og('product:brand'),
    category: txt(ld.category) || null,
    price: money(price, offer.priceCurrency || $('meta[property="product:price:currency"]').attr('content')),
    image: cleanImage((typeof first(ld.image) === 'string' ? first(ld.image) : first(ld.image)?.url) || og('og:image'), page.url),
    sku: ld.sku || null, gtin: ld.gtin13 || ld.gtin || ld.gtin8 || null, mpn: ld.mpn || null,
    description: (txt(ld.description) || og('og:description') || '').slice(0, 4000),
    descriptionHtml: bodyHtml ? cheerio.load(bodyHtml).text().replace(/\s+/g, ' ').trim().slice(0, 8000) : null,
    properties: props.slice(0, 40),
    variants: [].concat(ld.hasVariant || []).map(v => txt(v.name)).filter(Boolean).slice(0, 20),
    pageText: text,
  };
}
