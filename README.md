# AmplifAI content engine

Turns a webshop URL into sourced product-guide content (brand story, what to expect, a question whose answers change the advice, tips per level, shipping and delivery email content) in one or more languages. It stands on its own: any tool can drive it over HTTP, or mount it inside its own Node server.

- **AmplifAI** sets the base: default settings, which settings a shop may change and within what limits, and the fixed product rules that go into every prompt.
- **A shop** adjusts within those limits: its own defaults, per-product overrides, hand edits, locks, removals, and which facts to use.
- **Other tools** read published guides with a public key, as JSON (all languages or one), or Markdown.

## How the AmplifAI tool uses the engine

The AmplifAI tool is what shops see and use; the engine is the kitchen behind it. The shop's toggles (tone, je/u, quality level, languages, length) live in the tool and travel with every request. The engine keeps the guides, keeps them current, and tells the tool when something changes. Three calls, with the tool key (`TOOL_API_KEY`, or `data/tool-key.txt`; shown in the console under *Koppeling met de tool*):

```bash
# 1. make (creates the shop on first use; "approve": "auto" puts guides live that pass the quality check)
curl -X POST $ENGINE/v1/guides -H "Authorization: Bearer $TOOL_KEY" -H "Content-Type: application/json" -d '{
  "shop": {"id": "fietsshop-jansen", "name": "Fietsshop Jansen", "url": "https://fietsshopjansen.nl"},
  "products": ["https://fietsshopjansen.nl/products/helm"],
  "settings": {"tone": "warm", "formality": "informal", "tier": "basis", "languages": ["nl", "en"]},
  "approve": "review"}'

# 2. read: status (writing, ready, waiting, live, failed, removed), quality check and the guide; format=flat&lang=nl for one language
curl "$ENGINE/v1/guides?shop=fietsshop-jansen&product=https://fietsshopjansen.nl/products/helm" -H "Authorization: Bearer $TOOL_KEY"

# 3. approve (puts it live); also /v1/guides/remove
curl -X POST $ENGINE/v1/guides/approve -H "Authorization: Bearer $TOOL_KEY" -d '{"shop":"fietsshop-jansen","product":"https://fietsshopjansen.nl/products/helm"}'
```

A product is a URL or an object with what the tool already knows (`{url, name, brand, price, description, image, variants}`); with an object the engine needs to read less from the shop, and when the tool later sends changed data, the guide is rewritten. The engine never adds products to a shop the tool made: the tool decides which products get a guide.

**Building the tool without costs**: use the test key (`TOOL_TEST_KEY`, or `data/tool-test-key.txt`; also in the console). It takes the same calls but always writes test texts, also when the engine is live, so it never costs anything. Shops it creates are marked `sandbox` and it cannot reach real shops. See [HANDOVER.md](HANDOVER.md) for a step-by-step guide for whoever builds the tool.

`GET /v1/guides?shop=…` without a product lists every guide of the shop. Set the tool's notification address in the console (or `PATCH /v1/platform {"webhookUrl"}`): the engine POSTs `guide.ready`, `guide.published`, `guide.failed` and `guide.removed`, signed with `X-AmplifAI-Signature` (HMAC-SHA256 of the body with the secret shown in the console). The tool key can make and read guides for any shop but cannot touch rules, costs, keys or AmplifAI's limits; the shop's toggles are held to those limits.

The console (`/studio`) is for AmplifAI only: a test bench (four made-up test stores; pick products, set the toggles as the tool would, make, then review or approve all), the shops the tool created (with the item-by-item editor), the connection, AI and costs, rules and limits, and a plain-language explainer that can be shared on its own at `/hoe-het-werkt`.

## Run it

```bash
cd content-engine
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY
npm run seed              # the made-up test stores: Kilometerwinkel (sport, 3 finished guides), Bonenbar (coffee), Thuiskok (kitchen), Klankhuis (sound and TV)
npm start
```

### Test mode: everything, without an Anthropic key

```bash
npm run test-mode         # same as AI_MODE=mock npm start
```

Every part runs for real (reading catalogs and product pages, jobs and progress, settings layers and limits, edit/lock/rewrite/remove, publishing, previews, public API, webhooks, batch). Only research and writing are replaced by fixed templates: the shop page is the only source, and the texts are placeholders in the right shape, languages, form of address, tone and counts. Dutch and English are written out; German and French reuse the English text with a `[DE]`/`[FR]` tag. On your own computer the studio login then has an "Inloggen als AmplifAI" button (the `/v1/dev/login` endpoint exists only in test mode and only answers local requests). The studio shows a "Testmodus" banner, and `GET /v1/health` reports `aiMode: "mock"`. Nothing is sent to Anthropic and nothing costs money.

The studio is at `http://localhost:4317/studio`. The first start prints an admin key (also stored in `data/admin-key.txt`) unless `ADMIN_API_KEY` is set. `npm test` runs the API tests (no Anthropic key needed).

## Test and live, keys and costs

AmplifAI switches between **test mode** (fixed sample texts, no costs) and **live** (Claude writes) in the studio under *AI en kosten*, without a restart (`PUT /v1/admin/ai { mode }`). The Anthropic key is entered there too (`PUT /v1/admin/ai { key }`): it is checked for free (listing models) before it is stored on the server, and never sent back. `ANTHROPIC_API_KEY` in `.env` also works. In live mode without a key, jobs are refused with a clear message instead of failing later.

Shops choose a **quality level** (`tier`: basis, plus, premium). AmplifAI sets each level's name, Claude model and **price per order** (defaults €0,05 / €0,10 / €0,13 on Sonnet 5.5 / Opus 5.5 / Fable 5.1) in `PATCH /v1/platform { tiers }`. Shops only ever see names and prices (`GET /v1/tiers`). AmplifAI sees what a guide costs at Anthropic per level (`GET /v1/admin/costs`): an estimate at first, replaced by the average of real products once there are three. Every product and shop records its exact usage in tokens, searches and dollars.

**Spending limits**: live mode has hard limits per day, per month and per guide (defaults €5, €25 and €2; `PATCH /v1/platform { budget }`, or *AI en kosten* in the console). Every call to Claude checks them first and records its cost afterwards, so a limit stops the engine before the next call, whatever asked for the guide (the tool, the console, the weekly check). New requests get `402` with `code: "budget"`; a guide that stops gets `status: failed` with the reason. `GET /v1/admin/budget` shows what was spent. The emergency stop (`POST /v1/admin/stop`, or *Noodstop* in the console) switches to test mode, cancels waiting work and stops running guides at their next call. As a second brake that does not depend on this server, set a monthly spend limit on the Anthropic key itself in the Anthropic Console. Test mode, the made-up test stores and the test key never cost anything.

**Keeping guides current**: every shop's catalog is checked weekly or monthly (`refresh` in the base settings). Products whose text changed are rewritten (locks kept) and removed products go offline. New catalog products only get a guide on their own in a shop that asked for its whole catalog (autopilot without a limit); in shops the tool made, the tool decides and the check never adds or removes products. A check without changes costs nothing. A shop can trigger it (`POST /v1/accounts/{acc}/sync`) or report changes directly (`POST /v1/accounts/{acc}/products/events { added, removed }`).

**Quality check**: every guide is checked against the AmplifAI rules (`src/quality.js`): selling language, delivery promises, discouraging returns, numbers without a source, the wrong form of address, missing languages, length, repeated tips, answers without a tip. In live mode, items that break a rule are rewritten automatically once. The result is on every product (`qa`).

## Two ways to work: simple and expert

Each shop has a studio mode (`studioMode`: `simple` by default, or `expert`), switchable in one click.

- **Simple**: one page. Enter the webshop, pick a style (friendly, businesslike, expert, playful; je or u), choose whether guides go live straight away, then one button sets up every product. After that: a progress bar, "put N guides live", "set up the remaining N", "look for new products", and per product a preview with live/offline and rewrite. This is `POST /v1/accounts/{acc}/autopilot` and `POST /v1/accounts/{acc}/publish-all` underneath; progress is `GET /v1/accounts/{acc}/autopilot`.
- **Expert**: every setting per shop and per product, item-by-item editing, locks, sources, exports, keys and webhooks.

`autopilot` takes `{ url?, settings?, publish?, regenerate?, refreshCatalog?, limit?, productIds? }`. It adds every catalog product, skips products that already have a guide unless `regenerate` is set, and puts guides live as they finish when the shop's `autoPublish` is on (the default). Shopify and WooCommerce catalogs already carry each product's text, so their product pages are only fetched when that text is thin. Requests to one shop go one at a time with a pause (`CRAWL_GAP_MS`, default 700) and back off when the shop answers 429 or 503.

## Mount it inside another server

```js
import { createEngine } from '@amplifai/content-engine';
import { FileStore } from '@amplifai/content-engine/store';

const engine = createEngine({
  store: new FileStore('./content-data'),   // or your own store, see "Storage"
  adminKey: process.env.ADMIN_API_KEY,
  previewSecret: process.env.PREVIEW_SECRET,
  basePath: '/content',                     // when mounted under a path
});
app.use('/content', engine.handler);        // Express, Fastify (via middie), or node:http
```

## Who can do what

| Key | Where it lives | Can |
|---|---|---|
| Admin (`ADMIN_API_KEY`) | AmplifAI only | Everything: base settings and rules, create shops, per-shop limits, any shop's content |
| Tool (`TOOL_API_KEY`) | The AmplifAI tool's server | Make, read, approve and remove guides for any shop, within AmplifAI's limits; no rules, costs or keys |
| Tool test (`TOOL_TEST_KEY`) | Wherever the tool is being built | The same calls, always with test texts and free; only test shops |
| Secret `sk_…` (per shop) | The shop's server or the studio | Its own settings (within limits), products, guides, publishing, keys, webhook |
| Public `pk_…` (per shop) | The shop's website | Read published guides only |

Send keys as `Authorization: Bearer <key>`. The public endpoints take `?key=pk_…` instead.

## Settings: three layers

`effective = AmplifAI defaults ← shop settings ← product settings`

| Setting | Values | Shop may change by default |
|---|---|---|
| `languages` | any of `nl`, `en`, `de`, `fr` (first is written first) | yes |
| `tone` | `warm`, `neutral`, `expert`, `playful` | yes |
| `formality` | `informal` (je/du/tu), `formal` (u/Sie/vous) | yes |
| `length` | `standard`, `short` (one screen, no questions) | yes |
| `tipCount` | 2–4 per level | yes |
| `answerCount` | 3–4 | yes |
| `expectCount` | 2–3 | yes |
| `momentItems` | 2–4 per email | yes |
| `emails` | true/false | yes |
| `extra` | free-text style wish, max 400 chars (style only; cannot override the rules) | yes |
| `maxSearches`, `maxFetches` | research limits | AmplifAI only |
| `blockedDomains` | sources never used (reviews, tests, marketplaces) | AmplifAI only |
| `model`, `effort` | Claude model and writing effort | AmplifAI only |

The **policy** (per setting: `editable`, and optionally `options`, `min`, `max`) decides what shops may do. AmplifAI sets it for everyone in `PATCH /v1/platform`, and can override it for one shop in `PATCH /v1/accounts/{id}` (`policy`). AmplifAI can also set a value for one shop that the shop itself cannot change. Sending `null` for a setting removes it from that layer, so the layer below shows through. If AmplifAI tightens the policy later, shop values that no longer fit are skipped and listed under `warnings`.

```bash
# AmplifAI: shops may pick only warm or neutral, and may not change the languages
curl -X PATCH $ENGINE/v1/platform -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"policy":{"tone":{"editable":true,"options":["warm","neutral"]},"languages":{"editable":false}}}'

# A shop: formal address for all its products
curl -X PATCH $ENGINE/v1/accounts/fietsshop -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
  -d '{"settings":{"formality":"formal"}}'
```

## The flow

1. `POST /v1/accounts` (admin) creates a shop and returns its secret key once.
2. `POST /v1/accounts/{acc}/catalog` reads the shop's products (Shopify, WooCommerce, or sitemaps; honours robots.txt).
3. `POST /v1/accounts/{acc}/products` adds a product by URL and reads its page.
4. `POST …/products/{pid}/generate` starts a job: research (web search, sourced facts only) and then writing. Poll `GET /v1/jobs/{id}`, or set a webhook. `POST /v1/accounts/{acc}/batch` does many products at once.
5. Adjust: `PATCH …/products/{pid}` (settings, `locked`, `factsOn`), `PUT …/items/{path}` (hand edit, locks it), `POST …/items/{path}/rewrite` (one item again, with an optional wish), `DELETE …/items/{path}` (remove a list item).
6. `POST …/products/{pid}/publish` freezes a version for customers. Editing the draft afterwards does not change what customers see until you publish again.
7. Widgets read it: `GET /v1/public/guide?key=pk_…&product={id or product URL}&format=flat&lang=nl`.

Item paths: `title`, `hook`, `story`, `card`, `fact`, `lq`, `q`, `expect.0`, `tips.new.0` (`new`/`reg`/`pro`), `answerTips.0`, `shipped.items.0`, `delivered.items.0`.

## Output formats

- `guide` (default): the full document, every text as `{ "nl": "…", "en": "…" }`, plus `sources` (id, url, title, claim). Items cite sources by id in `src`.
- `flat`: the same document in one language (`lang=`), every text a plain string. Easiest for email tools and templates.
- `markdown`: a readable page with numbered source links, for a CMS or docs.

`formatVersion` is in every document; it changes only on breaking changes.

## Webhooks

Set `webhookUrl` on the shop. When a job finishes, the engine POSTs `{ "event": "job.done" | "job.failed", "job": {…} }` with header `X-AmplifAI-Signature: sha256=<hex HMAC of the raw body with the shop's webhookSecret>`. Three attempts, 10 s timeout each.

## Previews

`POST …/products/{pid}/preview` returns a token valid for 30 minutes and a URL. By default that URL is the AmplifAI demo itself in embedded mode (`/guide-preview`, a copy of the demo kept current with `npm run sync-preview`): the guide exactly as the customer sees it. After an edit the studio tells the preview to refresh in place. Set `PREVIEW_URL` to use another page instead; the template may use `{engine}`, `{publicKey}`, `{productId}` and `{token}`, and the page reads the draft with `GET /v1/public/guide?key=…&product=…&preview={token}`.

## Embedding the studio

Open `/studio#key=sk_…&account=…&product=…` (the hash is read and removed from the address bar), or put the studio in an iframe and send the key with `postMessage({ type: 'amplifai:key', key, account })`. Prefer a short-lived or dedicated key when embedding.

## Storage

The engine uses five calls: `get(collection, id)`, `put(collection, id, value)`, `del(collection, id)`, `list(collection, prefix)`. `FileStore` keeps JSON files in `data/`. For production, implement the same interface on a database (one table with `collection`, `id`, `json` is enough). Collections: `platform`, `accounts`, `keys` (sha256 of secret keys), `catalogs`, `products` (id `{account}~{product}`), `spend` (Anthropic costs per day), `secrets` (the Anthropic key entered in the console). Jobs live in memory; a restart forgets running jobs, never saved content.

## Environment

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Needed for research and writing |
| `AI_MODE` | `claude` | `mock`: a new install starts in test mode (after that, the studio switch decides) |
| `EUR_PER_USD` | `0.92` | Rate used to show Anthropic costs in euros |
| `DEV_LOGIN` | on | `off` hides the one-click AmplifAI login for local requests |
| `ADMIN_API_KEY` | generated into `data/admin-key.txt` | AmplifAI's key |
| `TOOL_API_KEY` | generated into `data/tool-key.txt` | The AmplifAI tool's key |
| `TOOL_TEST_KEY` | generated into `data/tool-test-key.txt` | The tool's free test key |
| `PREVIEW_SECRET` | generated into `data/preview-secret.txt` | Signs preview tokens |
| `PORT`, `HOST` | `4317`, `127.0.0.1` | Set `HOST=0.0.0.0` to listen publicly (behind HTTPS) |
| `DATA_DIR` | `data` | File store location |
| `CORS_ORIGINS` | `*` | Comma-separated list to restrict browser access |
| `PREVIEW_URL` | – | Preview page template, see Previews |
| `STATIC_DIR` | – | Optional folder served at `/files/` (for a preview page) |
| `CRAWL_GAP_MS` | `700` | Pause between requests to the same shop |

## Before production

- Run behind HTTPS and set `HOST`, `ADMIN_API_KEY`, `PREVIEW_SECRET` and `CORS_ORIGINS` explicitly.
- Replace `FileStore` with a database store; add an index on public keys (the public endpoint looks shops up by key).
- Jobs run in-process with two at a time. For many shops, move them to a queue.
- There is no rate limiting yet; put it in front (proxy) or add it per key.
- Research and writing cost Anthropic API usage per product (shown per product and per shop as tokens and an estimate), held to the spending limits. Set the limits and a spend limit in the Anthropic Console before switching to live.

The full API is in [openapi.yaml](openapi.yaml). A small JS client is in [clients/js/amplifai-content.js](clients/js/amplifai-content.js).
