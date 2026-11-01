# Building the AmplifAI tool on the content engine

This is for whoever builds the AmplifAI tool. It covers what the engine does, how to run it on your own computer for free, and the calls the tool makes. The exact request and response shapes are in [openapi.yaml](openapi.yaml); [README.md](README.md) covers running and hosting.

## Who does what

- **The AmplifAI tool** is everything a shop sees:
  - signing up, the dashboard and the toggles (tone, je/u, quality level, languages)
  - storing the content and showing it to the shop owner
  - letting the owner ask for changes or edit texts
  - arranging the content into the guide on the thank-you page and in the emails
  - billing
- **The content engine** only makes the content. The tool sends one product with the shop's settings. The engine:
  1. reads the product page and researches the brand
  2. writes every piece of content, in every language, with a source for every fact
  3. checks it against the AmplifAI rules
  4. hands it back

The engine keeps no shops, no products and no guides. It keeps a result for 7 days so the tool can pick it up; after that only the tool has it.

```
tool ── POST /v1/content (product + settings) ──▶ engine: research, write, check
tool ◀──────────── the content (JSON) ──────────── engine
tool: stores it, shows it to the shop, builds the guide
shop wants a change ─▶ tool ── POST /v1/content/revise (content + piece + wish) ──▶ engine
```

## Run it on your computer (free, about two minutes)

Needs Node 20 or newer.

```bash
cd content-engine
npm install
npm run test-mode   # starts on http://localhost:4317
```

- **Admin page:** http://localhost:4317/admin opens by itself on your own computer. It is AmplifAI's own screen:
  - test or live, the Anthropic key, spending limits and the emergency stop
  - which Claude model is behind each quality level
  - the general instructions (*Instructies*): how many facts to collect, how many points per piece, the fixed rules, an extra instruction, and the defaults for shops
  - the keys for the tool
  - a **Proberen** box that makes the same call the tool makes, and shows the result with a **Wijzig** (change) button on every piece
- **Your key:** the admin page shows both keys under *Koppeling met de tool*. They are also in `data/tool-test-key.txt` and `data/tool-key.txt`.
  - **Test key** (`tk_test_…`): use this while building. It always writes test texts and never costs anything, even when the engine is live.
  - **Tool key** (`tk_…`): the real one, for production. Keep it on the tool's server, never in a browser.

In test mode the research and writing are swapped for fixed templates. Everything else is real: reading the product page, settings, the quality check, revisions, callbacks. The test texts have the right shape, languages, form of address and counts, so you can build every screen against them.

## The calls

All calls send `Authorization: Bearer <key>` and JSON. `ENGINE=http://localhost:4317`.

### 0. What can a shop choose?

```bash
curl $ENGINE/v1/options -H "Authorization: Bearer $KEY"
```

This returns:
- `settings`: every toggle the tool can send, with its options, limits and default
- `qualities`: the three quality levels (Basis, Plus, Premium), with AmplifAI's estimated cost per product
- `pieces`: the pieces of content, and the path you use to ask for a change to one
- `languages` and `icons`

Build the tool's settings screen from this, so the engine and the tool can never disagree. The defaults are the ones AmplifAI set on the admin page; how research and writing work for every product (number of facts, the fixed rules, an extra instruction) is AmplifAI's too, and the tool cannot send it. Which toggles a shop may touch, and what it pays, is up to the tool. The tool never sees which Claude model is behind a level.

### 1. Write the content for a product

```bash
curl -X POST $ENGINE/v1/content -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "product": {
    "url": "https://fietsshopjansen.nl/products/helm-aero",
    "name": "Aero Fietshelm", "brand": "Velo", "price": "€89,95",
    "description": "Lichte fietshelm met 18 ventilatieopeningen, een draaiwiel achterop voor de pasvorm en een afneembaar achterlicht. Weegt 260 gram.",
    "specs": ["Gewicht: 260 g"], "variants": ["S/M", "L/XL"], "image": "https://…/helm.jpg"
  },
  "shop": {"name": "Fietsshop Jansen", "url": "https://fietsshopjansen.nl"},
  "settings": {"tone": "warm", "formality": "informal", "quality": "basis", "languages": ["nl", "en"]},
  "reference": "product-8812",
  "callbackUrl": "https://tool.amplifai.nl/hooks/engine"
}'
```

The answer comes at once, with a job:

```json
{"id":"job_oPJBX3Q9sZce","kind":"write","reference":"product-8812","test":true,"status":"queued","progress":[],"result":null,…}
```

- **product:** `url` is required. Send everything else you know (from Shopify, say). Whatever is missing, the engine reads from the product page.
- **settings:** the shop's toggles. Missing ones get the default. A value outside the limits gives `422` with `field`.
- **reference:** your own id, for example the product id. It comes back on the job.
- **Getting the result:** pick one of these.
  - `callbackUrl`: the engine POSTs the finished job there.
  - Poll `GET /v1/content/{id}` until the status is `done` or `failed`.
  - Add `"wait": true` and the request only answers when the job is done (up to 90 seconds). Handy in test mode and for revisions.

Writing takes about one to three minutes per product in live mode, and about a second in test mode. The engine works on two products at a time and queues the rest.

### 2. The result

```bash
curl $ENGINE/v1/content/job_oPJBX3Q9sZce -H "Authorization: Bearer $KEY"
```

| status | meaning |
|---|---|
| `queued` | waiting for its turn |
| `working` | busy; `progress` says what with |
| `done` | `result` holds the content |
| `failed` | `error` says why, in Dutch; `code: "budget"` when a spending limit stopped it |
| `cancelled` | AmplifAI pressed the emergency stop before it started |

`result` is what the tool stores. Keep it whole: a revision needs it back.

```json
{
  "formatVersion": 2,
  "test": true,
  "languages": ["nl", "en"],
  "settings": {"languages": ["nl","en"], "quality": "basis", "tone": "warm", "formality": "informal", "length": "standard", "tipCount": 3, "answerCount": 4, "expectCount": 2, "emailItems": 3, "style": ""},
  "product": {"url": "https://fietsshopjansen.nl/products/helm-aero", "name": "Aero Fietshelm", "brand": "Velo", "price": "€89,95", …},
  "shop": {"name": "Fietsshop Jansen", "url": "https://fietsshopjansen.nl/"},
  "content": {
    "intro": {"title": {"nl": "Jouw nieuwe Aero Fietshelm", "en": "Your new Aero Fietshelm"},
              "headline": {"nl": "Dit wordt een fijne eerste week.", "en": "This will be a good first week."},
              "teaser": {"headline": {"nl": "Haal alles uit jouw Aero Fietshelm", …}, "line": {…}}},
    "story": {"text": {"nl": "…", "en": "…"}, "src": ["f1"]},
    …
  },
  "sources": [{"id": "f1", "category": "brand", "claim": "Aero Fietshelm is made by Velo.", "url": "https://…", "title": "Productpagina", "used": true}, …],
  "quality": {"ok": true, "errors": 0, "warnings": 0, "issues": []},
  "costEUR": 0,
  "research": {…},
  "createdAt": "…"
}
```

- Every text is `{"nl": "…", "en": "…"}`. With `?lang=nl` on the GET, every text is a plain string instead (easier for a preview; store the full version).
- Every fact cites its sources by id in `src`. `sources` lists them all; `used` says whether the content cites it.
- `research` is what the engine needs again for a revision. Send it back unchanged.
- `quality.issues` names the piece, the rule and a message in Dutch, so the tool can show "needs a look" next to the right text.

**The pieces of content.** The tool decides where each goes in the guide. The demo (`index.html` in the demo folder) shows one way.

| piece | what it is | path for a change |
|---|---|---|
| `shortName` | short product name | `shortName` |
| `intro` | title, one-line headline, and a teaser that invites the customer to open the guide | `intro` |
| `story` | the brand story | `story` |
| `special` | 2 things that make this product special | `special.0` |
| `expect` | what is normal in the first days | `expect.0` |
| `fact` | one striking "did you know" | `fact` |
| `care` | cleaning, storing, lifespan | `care.0` |
| `experience` | the experience question, with a caption for new, regular and expert | `experience` |
| `question` | the question whose answer changes the tips. Each option has a `result` (shown after picking) and the `tip` it unlocks | `question`, `question.options.0` |
| `tips` | tips per level: `new`, `regular`, `expert` | `tips.new.0` |
| `whileYouWait` | for the shipping email | `whileYouWait`, `whileYouWait.items.0` |
| `firstMinutes` | for the delivery email | `firstMinutes`, `firstMinutes.items.0` |

Items also carry an `icon` suggestion from a fixed list. Ignore it if the tool's design does not use icons.

### 3. The shop asks for a change

```bash
curl -X POST $ENGINE/v1/content/revise -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "content": <the whole result you stored>,
  "piece": "tips.new.1",
  "wish": "Korter, en noem dat hij waterdicht is",
  "wait": true
}'
```

- The engine rewrites only that piece. The answer is a job like before, and its `result` is the whole content with the change in it. Store that instead of the old one.
- **wish:** the owner's words, up to 600 characters. Without a wish the piece is simply written differently.
  - What the owner says about their own product may be used as a fact. It is cited as source `w1`, `w2`, … with the title "Wens van de shop".
  - The AmplifAI rules always win: a wish to sell or promise a delivery date is not followed.
- **settings** (optional): new tone, form of address or quality level for this rewrite. The languages stay the same; for other languages, write the content again.
- `result.revised` says which piece changed and with which wish.
- Asking for `question` keeps the answer keys, so tips that hang on an answer stay connected.

### 4. The shop edits a text by hand

```bash
curl -X POST $ENGINE/v1/content/check -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"content": <the result with the edited text>}'
# {"ok":false,"errors":1,"warnings":0,"issues":[{"piece":"tips.new.0","level":"error","code":"sell","message":"Klinkt als verkopen; de gids verkoopt nooit"}]}
```

The check is free and instant. The tool decides what to do with it, for example warn the owner before saving.

### Callbacks

With `callbackUrl` the engine POSTs this when a job is finished, and retries up to three times:

```json
{"event": "content.done", "at": "…", "job": {"id": "job_…", "reference": "product-8812", "status": "done", "result": {…}}}
```

The event is `content.done`, `content.failed` or `content.cancelled`. Check that it really came from the engine; the secret is on the admin page under *Koppeling met de tool*:

```js
import crypto from 'node:crypto';
const ok = req.headers['x-amplifai-signature'] === 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
```

### A small client

`clients/js/amplifai-content.js` wraps these calls for a Node server:

```js
import { ContentEngine } from './clients/js/amplifai-content.js';
const ce = new ContentEngine({ baseUrl: process.env.ENGINE_URL, key: process.env.ENGINE_KEY });
const done = await ce.waitFor(await ce.write({ product, settings, reference: product.id }));
save(done.result);
const changed = await ce.waitFor(await ce.revise(done.result, 'story', 'Noem dat ze uit Utrecht komen'));
```

## Errors

Errors are `{"error": "…"}` with a fitting status, sometimes with `field` or `code`. The messages are in Dutch and can be shown to AmplifAI staff as they are.

| status | meaning |
|---|---|
| 400 | the body is not a JSON object |
| 401 / 403 | missing or wrong key; an admin call with a tool key |
| 404 | unknown job, or older than 7 days |
| 409 | live mode without an Anthropic key |
| 402 + `code: "budget"` | a spending limit is reached (see below) |
| 422 | invalid input; `field` says which |

## Costs and safety

**Free:**
- test mode
- the test key, always
- reading product pages
- the check

**Costs money:** only live mode, when Claude researches and writes. Roughly, per product:
- Basis (Sonnet): €0,30
- Plus (Opus): €0,60
- Premium (Fable): €1,40

Writing a product again with the same product data (another tone, a retry) reuses the research for 7 days and costs about a third. A revision costs a fraction of that. The estimates become real averages once there are runs; `GET /v1/options` always gives the current one.

**Hard limits**, set on the admin page:
- per day, default €5
- per month, default €25
- per product, default €2

Every call to Claude checks them first. When a limit is reached, new requests get `402` and a running job stops with a clear reason.

**Noodstop (emergency stop):** on the admin page. It switches everything back to test mode at once and cancels what is waiting.

Also set a monthly spend limit on the Anthropic key itself, in the Anthropic Console. That brake works even if the engine has a bug.

**Writing once:** the engine writes content when the tool asks, never by itself. The tool decides when a product needs new content, for example when its description changes. The shop's price per order and AmplifAI's cost per product are separate: counting opened guides and billing the shop is the tool's job.

## Going live

1. **Host the engine** somewhere the tool's server can reach it, behind HTTPS (not decided yet). It only needs a disk for `data/` (results for 7 days, spending, the Anthropic key).
2. **Set the keys** as environment variables: `ADMIN_API_KEY`, `TOOL_API_KEY`, `TOOL_TEST_KEY`, `HOST`, `CORS_ORIGINS`.
3. **Add the Anthropic key** on the admin page, and set the limits.
4. **Try live** on the admin page under *Proberen*: untick "Gratis testteksten" and write one product. The cost shows before you click.
5. **Switch the tool** from the test key to the real tool key.

## Still to decide together

- Where the engine runs.
- How the tool shows changes to the shop: a wish box per piece, editing by hand, or both.
- When the tool asks for new content: when the product changes, when the shop changes its settings, or only on request.
