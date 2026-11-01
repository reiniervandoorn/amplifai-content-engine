// Creates the made-up demo shop "Kilometerwinkel" (running, cycling, triathlon): ten products,
// three with a finished and published guide, so every part can be tried without an Anthropic key.
// Run: npm run seed (again at any time: it resets this shop, nothing else).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStore } from '../src/store.js';
import { newKey, hash } from '../src/auth.js';
import { slugOf } from '../src/crawl.js';
import { document } from '../src/formats.js';
import { resolve, defaultPlatform } from '../src/settings.js';
import { SHOP, PAGES, GUIDES } from './sample-shop.js';
import { SHOPS } from './sample-shops.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = new FileStore(path.resolve(ROOT, process.env.DATA_DIR || 'data'));
const now = new Date().toISOString();
const id = 'kilometerwinkel';

// clear this shop (and the earlier sample shop) completely
for (const old of [id, 'voorbeeldshop']) {
  for (const p of await store.list('products', old + '~')) await store.del('products', `${old}~${p.id}`);
  for (const k of await store.list('keys')) if (k.accountId === old) await store.del('keys', k.hash);
  await store.del('catalogs', old);
  if (old !== id) await store.del('accounts', old);
}

const prev = await store.get('accounts', id);
const secret = newKey('sk_');
const account = {
  id, name: SHOP.name, shopUrl: 'https://' + SHOP.domain, domain: SHOP.domain, accent: SHOP.accent, createdAt: prev?.createdAt || now,
  settings: {}, settingsBy: {}, policy: {}, studioMode: 'simple', autoPublish: true,
  publicKey: prev?.publicKey || newKey('pk_'), webhookUrl: null, webhookSecret: prev?.webhookSecret || newKey('whsec_'),
  usage: { input: 0, output: 0, searches: 0 }, sample: true, secretKeyHint: secret.slice(0, 7) + '…' + secret.slice(-4),
};
await store.put('keys', hash(secret), { accountId: id, hash: hash(secret), createdAt: now });
await store.put('accounts', id, account);

const pf = (await store.get('platform', 'main')) || defaultPlatform();
await store.put('catalogs', id, {
  shop: SHOP, platform: 'sample', fetchedAt: now,
  products: PAGES.map(p => ({ id: slugOf(p.url), url: p.url, name: p.name, brand: p.brand, price: p.price, image: p.image, type: p.category, page: p })),
});
let live = 0;
for (const page of PAGES) {
  const g = GUIDES[page.url];
  if (!g) continue; // the other products wait in the catalog for "alles klaarzetten"
  const research = g && JSON.parse(JSON.stringify(g.research).replaceAll('voorbeeldshop.test', SHOP.domain));
  const x = { id: slugOf(page.url), accountId: id, url: page.url, createdAt: now, updatedAt: now, status: g ? 'published' : 'new', sample: true,
    settings: {}, settingsBy: {}, locked: [], removed: [], page, research: research || null, guide: g ? structuredClone(g.guide) : null, published: null };
  if (g) { x.published = { version: 1, at: now, document: document(account, x, resolve(pf, account, x).effective) }; live++ }
  await store.put('products', `${id}~${x.id}`, x);
}

// the other test stores: catalog only, no guides yet
for (const t of SHOPS) {
  for (const p of await store.list('products', t.id + '~')) await store.del('products', `${t.id}~${p.id}`);
  for (const k of await store.list('keys')) if (k.accountId === t.id) await store.del('keys', k.hash);
  const old = await store.get('accounts', t.id);
  await store.put('accounts', t.id, { id: t.id, name: t.name, shopUrl: 'https://' + t.domain, domain: t.domain, accent: t.accent, createdAt: old?.createdAt || now,
    settings: {}, settingsBy: {}, policy: {}, studioMode: 'simple', autoPublish: false, publicKey: old?.publicKey || newKey('pk_'), webhookUrl: null,
    webhookSecret: old?.webhookSecret || newKey('whsec_'), usage: { input: 0, output: 0, searches: 0 }, sample: true });
  await store.put('catalogs', t.id, { shop: { name: t.name, domain: t.domain, accent: t.accent }, platform: 'sample', fetchedAt: now,
    products: t.pages.map(p => ({ id: slugOf(p.url), url: p.url, name: p.name, brand: p.brand, price: p.price, image: p.image, type: p.category, page: p })) });
}

console.log(`Teststores klaar: ${SHOP.name} (${PAGES.length} producten, ${live} met een gids), ${SHOPS.map(t => `${t.name} (${t.pages.length})`).join(', ')}.`);
console.log(`${SHOP.name}:
  account:      ${id}
  geheime key:  ${secret}   (alleen nu zichtbaar)
  publieke key: ${account.publicKey}`);
