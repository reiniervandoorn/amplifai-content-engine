// Who is calling. Three kinds of key:
//   admin   (ADMIN_API_KEY)   AmplifAI itself: everything, all shops, the base settings.
//   tool    (TOOL_API_KEY)    the AmplifAI tool's server: make and read guides for any shop, within AmplifAI's limits.
//   test    (TOOL_TEST_KEY)   the same calls, but always with test texts: free, for building and testing the tool.
//   secret  (sk_…, per shop)  the shop's own tools and studio: its settings, products and guides.
//   public  (pk_…, per shop)  widgets on the shop's site: read published guides only.
import crypto from 'node:crypto';

export const newKey = prefix => prefix + crypto.randomBytes(24).toString('base64url');
export const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status } }

export async function identify(req, { store, adminKey, toolKey, toolTestKey }) {
  const h = req.headers.authorization || '';
  const key = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!key) return null;
  if (adminKey && same(hash(key), hash(adminKey))) return { role: 'admin' };
  if (toolKey && same(hash(key), hash(toolKey))) return { role: 'tool' };
  if (toolTestKey && same(hash(key), hash(toolTestKey))) return { role: 'tool', sandbox: true };
  if (key.startsWith('sk_')) {
    const idx = await store.get('keys', hash(key));
    if (idx) return { role: 'account', accountId: idx.accountId };
  }
  throw new HttpError(401, 'Onbekende of ingetrokken API-sleutel');
}

export function canAccount(who, accountId) {
  if (!who) throw new HttpError(401, 'API-sleutel ontbreekt (Authorization: Bearer …)');
  if (who.role === 'admin' || who.role === 'tool' || who.accountId === accountId) return;
  throw new HttpError(403, 'Geen toegang tot deze shop');
}
export function mustAdmin(who) {
  if (!who) throw new HttpError(401, 'API-sleutel ontbreekt (Authorization: Bearer …)');
  if (who.role !== 'admin') throw new HttpError(403, 'Alleen voor AmplifAI');
}

// Short-lived signed link so an iframe can preview a draft without holding a secret key.
export function previewToken(secret, accountId, productId, ttlMs = 30 * 60e3) {
  const exp = Date.now() + ttlMs, body = `${accountId}.${productId}.${exp}`;
  return Buffer.from(body).toString('base64url') + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
export function checkPreviewToken(secret, token, accountId, productId) {
  const [b, sig] = String(token || '').split('.');
  if (!b || !sig) return false;
  const body = Buffer.from(b, 'base64url').toString();
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const [a, p, exp] = body.split('.');
  return same(sig, want) && a === accountId && p === productId && Number(exp) > Date.now();
}
