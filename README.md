# AmplifAI content engine

Writes the content for AmplifAI product guides. The AmplifAI tool sends one product and the shop's settings; the engine reads the product page, researches the brand, writes every piece of content in every language with a source for each fact, checks it against the AmplifAI rules and hands it back. The tool stores the content, shows it to the shop, asks for changes and arranges it into the guide.

The engine keeps no shops, products or guides. A result is kept for 7 days so the tool can pick it up.

**Building the tool?** Start with [HANDOVER.md](HANDOVER.md). The exact shapes are in [openapi.yaml](openapi.yaml).

## The calls

| call | what it does |
|---|---|
| `GET /v1/options` | the settings the tool can send (options, limits, defaults), the quality levels with estimated cost, the pieces of content |
| `POST /v1/content` | write the content for one product; answers with a job |
| `POST /v1/content/revise` | rewrite one piece, with the shop's wish; answers with a job |
| `POST /v1/content/check` | hold content against the AmplifAI rules, e.g. after a hand edit; free and instant |
| `GET /v1/content/{id}` | the job and, when done, its result; `?lang=nl` for plain strings |
| `GET /v1/health` | up, and test or live |

AmplifAI only (admin key): `GET /v1/admin/status`, `PUT /v1/admin/ai` (Anthropic key, test or live), `PATCH /v1/admin/settings` (limits, model per level), `POST /v1/admin/stop` (emergency stop). The admin page at `/admin` uses these.

## Run it

```bash
cd content-engine
npm install
npm run test-mode         # free: test texts, no Anthropic key needed
npm start                 # starts in live mode; add the Anthropic key on the admin page or in .env
npm test                  # the API tests (no Anthropic key needed)
```

The admin page is at `http://localhost:4317/admin`. On your own computer it logs in by itself (`/v1/dev/login` only answers local requests). Elsewhere, log in with the admin key: the first start prints it and stores it in `data/admin-key.txt`, unless `ADMIN_API_KEY` is set.

### Test mode

Research and writing are replaced by fixed templates (`src/mock-ai.js`). Everything else runs for real: reading the product page, settings, jobs, the quality check, revisions, callbacks. The texts are placeholders in the right shape, languages, form of address, tone and counts. Dutch and English are written out; German and French reuse the English text with a `[DE]`/`[FR]` tag. Nothing is sent to Anthropic.

- The **test key** (`TOOL_TEST_KEY`) always gets test texts, even when the engine is live. The tool builds against it.
- AmplifAI switches the engine between test and live on the admin page, without a restart.

## How it works

1. **Product:** what the tool sent. When the name or a description of at least 200 characters is missing, the engine reads the product page (structured data first, then the page text; `src/crawl.js`), honouring robots.txt.
2. **Research** (`src/ai.js`): Claude searches the brand's and manufacturer's own sites and collects facts, each with the URL it came from. Facts whose URL Claude did not actually see are dropped. Independent tests, reviews, forums and other shops are not allowed as sources (`RESEARCH.blockedDomains` in `src/settings.js`).
3. **Writing:** one structured call writes every piece in every language, citing facts by id. The fixed AmplifAI rules (`RULES` in `src/settings.js`) go into every prompt; the shop's style wish cannot override them.
4. **Quality check** (`src/quality.js`): selling language, delivery promises, discouraging returns, numbers without a source, the wrong form of address, missing languages, length, repeated tips, answers without a tip. In live mode pieces that break a rule are rewritten once.
5. **Revision:** the tool sends the whole result back with a piece and a wish. The wish is added as a fact (`w1`, …) so what the shop says about its own product can be cited; the rest of the content and all earlier facts stay.

The quality level (`basis`, `plus`, `premium`) picks the Claude model: by default Sonnet 5.5, Opus 5.5 and Fable 5.1. AmplifAI can change the model per level on the admin page. Pricing for shops is the tool's business.

## Costs and spending limits

Only live mode costs money. A product costs roughly €0,30 on Basis, €0,60 on Plus and €1,40 on Premium; a revision a fraction of that. The estimates become real averages after three runs per model.

- **Hard limits** per day, per month and per product (defaults €5, €25, €2), set on the admin page. Every call to Claude checks them first and records its cost afterwards, so a limit stops the engine before the next call. New requests get `402` with `code: "budget"`; a running job fails with the reason.
- **Emergency stop** (`POST /v1/admin/stop`, *Noodstop* on the admin page): back to test mode, waiting jobs cancelled, running ones stop at their next call to Claude.
- **Second brake:** set a monthly spend limit on the Anthropic key in the Anthropic Console. It does not depend on this server.
- The engine never writes on its own. Content is only written when the tool asks.

## Mount it inside another server

```js
import { createEngine } from '@amplifai/content-engine';
import { FileStore } from '@amplifai/content-engine/store';

const engine = createEngine({
  store: new FileStore('./content-data'),   // or your own store, see "Storage"
  adminKey: process.env.ADMIN_API_KEY,
  toolKey: process.env.TOOL_API_KEY,
  toolTestKey: process.env.TOOL_TEST_KEY,
  basePath: '/content',                     // when mounted under a path
});
app.use('/content', engine.handler);        // Express, Fastify (via middie), or node:http
```

## Storage

The engine uses four calls: `get(collection, id)`, `put(collection, id, value)`, `del(collection, id)`, `list(collection, prefix)`. `FileStore` keeps JSON files in `data/`. Collections:

- `jobs`: jobs and their results, deleted after `KEEP_DAYS`
- `spend`: Anthropic costs per day
- `runs`: the cost of each live product, for the estimates
- `platform`: test or live, limits, model per level
- `secrets`: the Anthropic key entered on the admin page, and the callback secret

For production a database works the same way: one table with `collection`, `id`, `json`.

## Environment

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Can also be entered on the admin page |
| `AI_MODE` | `claude` | `mock`: a new install starts in test mode (after that, the admin page decides) |
| `ADMIN_API_KEY` | generated into `data/admin-key.txt` | AmplifAI's key |
| `TOOL_API_KEY` | generated into `data/tool-key.txt` | The AmplifAI tool's key |
| `TOOL_TEST_KEY` | generated into `data/tool-test-key.txt` | The tool's free test key |
| `PORT`, `HOST` | `4317`, `127.0.0.1` | Set `HOST=0.0.0.0` to listen publicly (behind HTTPS) |
| `DATA_DIR` | `data` | File store location |
| `CONCURRENCY` | `2` | Jobs that run at the same time; the rest wait in line |
| `KEEP_DAYS` | `7` | How long results stay readable |
| `CORS_ORIGINS` | `*` | Comma-separated list to restrict browser access to the admin page's calls |
| `EUR_PER_USD` | `0.92` | Rate used to show Anthropic costs in euros |
| `DEV_LOGIN` | on | `off` turns off the one-click login for local requests |
| `CRAWL_GAP_MS` | `700` | Pause between requests to the same shop |

## Before production

- Run behind HTTPS and set `HOST`, `ADMIN_API_KEY`, `TOOL_API_KEY`, `TOOL_TEST_KEY` and `CORS_ORIGINS` explicitly.
- Jobs run in-process. A restart marks running jobs as failed; the tool asks again. For many products at once, move them to a queue.
- There is no rate limiting yet; put it in front (proxy) or add it per key.
- Set the spending limits, and a spend limit in the Anthropic Console, before switching to live.
