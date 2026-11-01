// Runs the engine on its own. To mount it inside another Node server, use createEngine() from ./app.js.
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine } from './app.js';
import { FileStore } from './store.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// .env next to package.json: ANTHROPIC_API_KEY, ADMIN_API_KEY, … (never committed)
if (existsSync(path.join(ROOT, '.env'))) {
  for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const env = process.env;
const DATA = path.resolve(ROOT, env.DATA_DIR || 'data');
mkdirSync(DATA, { recursive: true });

// Without ADMIN_API_KEY a key is made once and kept in the data folder, so local use just works.
function secretFile(name, prefix) {
  const f = path.join(DATA, name);
  if (!existsSync(f)) writeFileSync(f, prefix + crypto.randomBytes(24).toString('base64url'), { mode: 0o600 });
  return readFileSync(f, 'utf8').trim();
}
const adminKey = env.ADMIN_API_KEY || secretFile('admin-key.txt', 'ak_');
const toolKey = env.TOOL_API_KEY || secretFile('tool-key.txt', 'tk_');
const toolTestKey = env.TOOL_TEST_KEY || secretFile('tool-test-key.txt', 'tk_test_');

const engine = createEngine({
  store: new FileStore(DATA), adminKey, toolKey, toolTestKey,
  corsOrigins: env.CORS_ORIGINS || '*',
  aiMode: env.AI_MODE === 'mock' ? 'mock' : 'claude',
  concurrency: Number(env.CONCURRENCY) || 2,
  keepDays: Number(env.KEEP_DAYS) || 7,
});

const PORT = Number(env.PORT) || 4317, HOST = env.HOST || '127.0.0.1';
http.createServer(engine.handler).on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Poort ${PORT} is al in gebruik. Draait de engine al? Open dan gewoon http://localhost:${PORT}/admin
Of start een tweede op een andere poort: PORT=${PORT + 1} npm run test-mode`);
  process.exit(1);
}).listen(PORT, HOST, () => {
  console.log(`AmplifAI content engine
  API:      http://localhost:${PORT}/v1   (spec: /openapi.yaml)
  Beheer:   http://localhost:${PORT}/admin
  ${env.ADMIN_API_KEY ? 'Admin-sleutel: uit ADMIN_API_KEY' : `Admin-sleutel: ${adminKey}  (staat in ${path.relative(ROOT, DATA)}/admin-key.txt)`}
  Test of live, de Anthropic-sleutel, de grenzen en de kosten regel je op de beheerpagina.`);
});
