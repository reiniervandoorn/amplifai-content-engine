// Catalog discovery and product-page extraction. No LLM here: only what the shop itself publishes.
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (compatible; AmplifAI-ContentEngine/0.1; +https://amplifai.nl)';
const MAX_PRODUCTS = 2000;

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

/* ── robots.txt: honour Disallow rules for all user agents, and read the sitemaps it lists ── */
const robotsCache = new Map();
async function robots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const r = { disallow: [], allow: [], sitemaps: [] };
  try {
    const { text } = await getText(origin + '/robots.txt', { accept: 'text/plain' });
    let applies = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'user-agent') applies = v === '*';
      else if (k === 'sitemap') r.sitemaps.push(v);
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

/* ── shop identity: name, colour, logo ── */
function shopInfo($, url) {
  const u = new URL(url);
  const site = $('meta[property="og:site_name"]').attr('content');
  const title = ($('title').first().text() || '').split(/\s[|–—-]\s/).pop();
  const fromDomain = u.hostname.replace(/^www\./, '').split('.')[0].replace(/^./, c => c.toUpperCase());
  // bot walls and SEO titles make poor shop names; the domain is safer then
  let name = (site || title || '').trim();
  if (!name || name.length > 28 || /verification|just a moment|attention required|access denied|captcha/i.test(name)) name = fromDomain;
  const theme = $('meta[name="theme-color"]').attr('content');
  const icon = $('link[rel~="apple-touch-icon"]').attr('href') || $('link[rel~="icon"]').attr('href');
  return {
    name, domain: u.hostname.replace(/^www\./, ''),
    accent: usableAccent(theme),
    logo: icon ? new URL(icon, url).href : null,
  };
}

// a theme colour only counts when white text stays readable on it
function usableAccent(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const L = .2126 * r + .7152 * g + .0722 * b;
  return L > .02 && L < .3 ? hex : null;
}
const money = (amount, cur) => {
  if (amount == null || amount === '') return null;
  const n = Number(amount);
  if (!isFinite(n)) return String(amount);
  const sym = { EUR: '€', USD: '$', GBP: '£' }[cur || 'EUR'] || (cur + ' ');
  return sym + n.toFixed(2).replace('.', ',');
};

/* ── platform catalogs ── */
async function shopifyCatalog(origin) {
  const out = [];
  for (let page = 1; page <= 8 && out.length < MAX_PRODUCTS; page++) {
    const j = await getJson(`${origin}/products.json?limit=250&page=${page}`);
    if (!j || !Array.isArray(j.products)) return page === 1 ? null : out;
    if (!j.products.length) break;
    for (const p of j.products) {
      const url = `${origin}/products/${p.handle}`, desc = cheerio.load(p.body_html || '').text().replace(/\s+/g, ' ').trim();
      out.push({
        url, name: p.title, brand: p.vendor || null,
        price: null, // products.json has no currency; research reads it from the page
        image: p.images?.[0]?.src || null, type: p.product_type || null,
        // everything the engine needs, so the product page itself need not be fetched
        page: { url, name: p.title, brand: p.vendor || null, category: p.product_type || null, price: null, image: p.images?.[0]?.src || null,
          description: desc.slice(0, 4000), descriptionHtml: desc.slice(0, 8000), variants: (p.variants || []).map(v => v.title).filter(t => t && t !== 'Default Title').slice(0, 20),
          properties: (p.options || []).filter(o => o.name !== 'Title').map(o => `${o.name}: ${(o.values || []).join(', ')}`).slice(0, 10), pageText: desc.slice(0, 24000) },
      });
    }
  }
  return out;
}
async function wooCatalog(origin) {
  const out = [];
  for (let page = 1; page <= 20 && out.length < MAX_PRODUCTS; page++) {
    const j = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!Array.isArray(j)) return page === 1 ? null : out;
    if (!j.length) break;
    for (const p of j) {
      const name = cheerio.load(p.name || '').text(), desc = cheerio.load((p.description || '') + ' ' + (p.short_description || '')).text().replace(/\s+/g, ' ').trim();
      const price = p.prices?.price ? money(Number(p.prices.price) / 10 ** (p.prices.currency_minor_unit ?? 2), p.prices.currency_code) : null;
      out.push({
        url: p.permalink, name, brand: p.brands?.[0]?.name || null, price, image: p.images?.[0]?.src || null, type: p.categories?.[0]?.name || null,
        page: { url: p.permalink, name, brand: p.brands?.[0]?.name || null, category: p.categories?.[0]?.name || null, price, image: p.images?.[0]?.src || null,
          description: desc.slice(0, 4000), descriptionHtml: desc.slice(0, 8000), variants: [], properties: (p.attributes || []).map(a => `${a.name}: ${(a.terms || []).map(t => t.name).join(', ')}`).slice(0, 10), pageText: desc.slice(0, 24000) },
      });
    }
  }
  return out;
}

/* ── sitemap fallback: works for most other platforms ── */
const PRODUCTISH = /\/(products?|produkt|produit|p|artikel|item|shop)\/|[-/]p\d{3,}|\/\d{5,}|\.html$/i;
const NOT_PRODUCT = /\/(blog|news|nieuws|pages?|category|categorie|collections?|tag|brand|merken|klantenservice|service|account|cart|winkelwagen|checkout|search|zoeken)\b/i;

async function sitemapCatalog(origin) {
  const r = await robots(origin);
  const queue = [...new Set([...r.sitemaps, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])];
  const seen = new Set(), urls = [];
  while (queue.length && seen.size < 25 && urls.length < MAX_PRODUCTS * 2) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    let xml;
    try { xml = (await getText(sm, { accept: 'application/xml,text/xml' })).text } catch { continue }
    const $ = cheerio.load(xml, { xmlMode: true });
    const children = $('sitemapindex > sitemap > loc').map((_, e) => $(e).text().trim()).get();
    if (children.length) {
      // product sitemaps first
      children.sort((a, b) => (/product/i.test(b) ? 1 : 0) - (/product/i.test(a) ? 1 : 0));
      queue.unshift(...children.filter(c => /product/i.test(c)));
      queue.push(...children.filter(c => !/product/i.test(c)));
      continue;
    }
    const isProductMap = /product/i.test(sm);
    $('urlset > url').each((_, e) => {
      const loc = $(e).children('loc').text().trim();
      if (!loc) return;
      const path = new URL(loc, origin).pathname;
      if (path === '/' || NOT_PRODUCT.test(path)) return;
      if (!isProductMap && !PRODUCTISH.test(path)) return;
      const img = $(e).find('image\\:loc, loc').filter((i, x) => x.tagName !== 'loc').first().text().trim();
      urls.push({ url: loc, name: nameFromSlug(path), brand: null, price: null, image: img || null, type: null });
    });
  }
  return urls.slice(0, MAX_PRODUCTS);
}
function nameFromSlug(path) {
  const seg = decodeURIComponent(path.split('/').filter(Boolean).pop() || '').replace(/\.html?$/, '').replace(/[-_]+/g, ' ').replace(/\b\d{5,}\b/g, '').trim();
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

export async function catalog(input) {
  const u = normalizeUrl(input);
  const home = await getText(u.origin + '/').catch(() => getText(u.href));
  const $ = cheerio.load(home.text);
  const shop = shopInfo($, home.url);
  const origin = new URL(home.url).origin;
  let platform = 'sitemap', products = await shopifyCatalog(origin);
  if (products) platform = 'shopify';
  else if ((products = await wooCatalog(origin))) platform = 'woocommerce';
  else products = await sitemapCatalog(origin);
  // a pasted product URL always shows up, even when discovery missed it
  if (u.pathname !== '/' && !products.some(p => p.url.replace(/\/$/, '') === u.href.replace(/\/$/, ''))) {
    try { const p = await product(u.href); products.unshift({ url: p.url, name: p.name, brand: p.brand, price: p.price, image: p.image, type: p.category }) } catch { }
  }
  const dedup = new Map();
  for (const p of products) if (!dedup.has(p.url)) dedup.set(p.url, p);
  return { shop, platform, products: [...dedup.values()].map(p => ({ id: slugOf(p.url), ...p })), fetchedAt: new Date().toISOString() };
}

export const slugOf = url => {
  const u = new URL(url);
  return (u.hostname.replace(/^www\./, '') + u.pathname).toLowerCase().replace(/\.html?$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
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
