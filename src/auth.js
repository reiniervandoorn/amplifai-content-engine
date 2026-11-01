// Who is calling. Three keys:
//   admin  (ADMIN_API_KEY)   AmplifAI itself: the admin page, the Anthropic key, limits, costs; and every content call.
//   tool   (TOOL_API_KEY)    the AmplifAI tool's server: write, revise and check content.
//   test   (TOOL_TEST_KEY)   the same calls, but always with test texts: free, for building and testing the tool.
import crypto from 'node:crypto';

export const newKey = prefix => prefix + crypto.randomBytes(24).toString('base64url');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; if (code) this.code = code } }

export function identify(req, { adminKey, toolKey, toolTestKey }) {
  const h = req.headers.authorization || '';
  const key = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!key) return null;
  if (adminKey && same(hash(key), hash(adminKey))) return { role: 'admin' };
  if (toolKey && same(hash(key), hash(toolKey))) return { role: 'tool' };
  if (toolTestKey && same(hash(key), hash(toolTestKey))) return { role: 'tool', test: true };
  throw new HttpError(401, 'Onbekende API-sleutel');
}
