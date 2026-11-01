# Building the AmplifAI tool on the content engine

This is for whoever builds the AmplifAI tool. It covers what the engine does, how to run it on your own computer for free, and the calls the tool makes. The full reference is [README.md](README.md) and [openapi.yaml](openapi.yaml).

## Who does what

- **The AmplifAI tool** is everything a shop sees: signing up, the dashboard, the toggles (tone, je/u, quality level, languages, length), approving guides, billing, and showing the guide to customers on the thank-you page and in the emails.
- **The content engine** is the kitchen. The tool orders a guide; the engine reads the product, researches it with sources, writes it in every language, checks it against the AmplifAI rules, stores it and keeps it current. It never talks to shops or customers.

The tool talks to the engine over HTTP with one key. Shops never see the engine.

## Run it on your computer (free, about two minutes)

Needs Node 20 or newer.

```bash
cd content-engine
npm install
npm run seed        # four made-up test stores with products
npm run test-mode   # starts on http://localhost:4317
```

Then:

- **Console:** http://localhost:4317/studio. Click *Inloggen* (one click on your own computer). This is AmplifAI's own screen: a test bench, the shops, the connection, AI and costs, rules.
- **Your key:** the console, under *Koppeling met de tool*, shows two keys. They are also in `data/tool-test-key.txt` and `data/tool-key.txt`.
  - **Test key** (`tk_test_…`): use this while building. It always writes test texts and never costs anything, even if someone switches the engine to live. It can only reach test shops (the ones it creates and the four made-up stores).
  - **Tool key** (`tk_…`): the real one, for production. Keep it on the tool's server, never in a browser.
- **Explainer:** http://localhost:4317/hoe-het-werkt is a plain-language page about how the engine works.

In test mode, research and writing are swapped for fixed templates. Everything else is real: reading shops, jobs, settings and limits, the quality check, approving, notifications. The texts have the right shape, languages, form of address and counts, so you can build every screen against them.

## The calls

All calls send `Authorization: Bearer <key>` and JSON. `ENGINE=http://localhost:4317`.

### 0. Which toggles may a shop change?

```bash
curl $ENGINE/v1/guides/options -H "Authorization: Bearer $KEY"
```

This returns:
- the quality levels with their price per order (Basis €0,05, Plus €0,10, Premium €0,13; AmplifAI can change these)
- every toggle a shop may change, with the options AmplifAI allows and the default for each

Build the tool's settings screen from this, so the engine and the tool can never disagree. AmplifAI can narrow the options in the console, for example "shops may only pick warm or neutral". The shop never sees which Claude model is behind a quality level.

### 1. Make a guide

```bash
curl -X POST $ENGINE/v1/guides -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "shop": {"id": "fietsshop-jansen", "name": "Fietsshop Jansen", "url": "https://fietsshopjansen.nl"},
  "products": [{
    "url": "https://fietsshopjansen.nl/products/helm-aero",
    "name": "Aero Fietshelm", "brand": "Velo", "price": "€89,95",
    "description": "Lichte fietshelm met 18 ventilatieopeningen, een draaiwiel achterop voor de pasvorm en een afneembaar achterlicht. Weegt 260 gram.",
    "image": "https://…/helm.jpg"
  }],
  "settings": {"tone": "warm", "formality": "informal", "tier": "basis", "languages": ["nl", "en"]},
  "approve": "review"
}'
```

```json
{"shop":"fietsshop-jansen","guides":[{"product":"https://fietsshopjansen.nl/products/helm-aero","productId":"fietsshopjansen-nl-products-helm-aero","status":"writing","job":"job_pMVzBF6tRQEs"}]}
```

- **shop:** the first call for a new `shop.id` creates the shop. Use your own stable id for the shop.
- **products:** up to 500 per call.
  - A product is either a URL or an object with what the tool already knows (from Shopify, say).
  - Send the object when you can: the engine then reads less from the shop, which is faster and more reliable.
  - If you send changed data for a product later, its guide is rewritten automatically. Sending the same data again does nothing.
- **settings:** the shop's toggles. They're checked against AmplifAI's limits. A setting the shop may not change gives `403`; a value outside the limits gives `422` with `field`.
- **approve:**
  - `"review"`: the shop approves each guide in the tool.
  - `"auto"`: a guide goes live as soon as it passes the quality check. A guide that doesn't pass waits for the shop.
- **regenerate:** `true` rewrites a guide that already exists. Without it, a product that already has a guide just returns its status, so calling twice is safe.
- **Shop products:** the engine never adds products to a shop by itself. The tool decides which products get a guide.

Writing takes about one to three minutes per product in live mode, and a second in test mode.

### 2. Read it

```bash
# all guides of a shop, with status
curl "$ENGINE/v1/guides?shop=fietsshop-jansen" -H "Authorization: Bearer $KEY"

# one guide (product = URL or productId)
curl "$ENGINE/v1/guides?shop=fietsshop-jansen&product=https://fietsshopjansen.nl/products/helm-aero" -H "Authorization: Bearer $KEY"

# one language, every text a plain string (easiest for emails and the thank-you page)
curl "$ENGINE/v1/guides?shop=fietsshop-jansen&product=…&format=flat&lang=nl" -H "Authorization: Bearer $KEY"

# only what is live (what customers should see)
curl "$ENGINE/v1/guides?shop=fietsshop-jansen&product=…&version=published&format=flat&lang=nl" -H "Authorization: Bearer $KEY"
```

```json
{"product":"https://fietsshopjansen.nl/products/helm-aero","productId":"fietsshopjansen-nl-products-helm-aero",
 "status":"ready","qa":{"ok":true,"errors":0,"warnings":1,"issues":[{"item":"hook","level":"warn","code":"hook","msg":"Openingszin langer dan 8 woorden"}]},
 "version":null,"updatedAt":"…","error":null,
 "guide":{"formatVersion":1,"shop":{…},"product":{"name":"Aero Fietshelm","brand":"Velo","price":"€89,95","image":null},
          "settings":{"tone":"warm","formality":"informal","length":"standard"},"guide":{…},"sources":[{"id":"f1","url":"…","title":"…","claim":"…"}]}}
```

| status | meaning | the tool shows |
|---|---|---|
| `writing` | the engine is working on it | a spinner |
| `ready` | written and passes the AmplifAI rules | "ready to check", with an approve button |
| `waiting` | written, but breaks a rule (`qa.issues` says which) | "needs a look"; approving needs `force` |
| `live` | approved; customers see it (`version` counts up) | live |
| `failed` | something went wrong (`error` says what, in Dutch) | the reason, with a retry |
| `removed` | the product is gone from the shop | offline |
| `new` | known, no guide yet | nothing yet |

**What's in a guide** (`guide.guide`, matching the three moments in the demo):

| field | what it is |
|---|---|
| `title`, `card`, `hook` | the thank-you card |
| `story` | the brand story |
| `expect` | what is normal in the first days |
| `fact` | one striking fact |
| `lq` | the experience question (new, regular, pro) |
| `q` | the question whose answers change the tips |
| `tips` | tips per experience level |
| `answerTips` | a tip per answer |
| `shipped` | content for the shipping email |
| `delivered` | content for the delivery email |

Every factual item cites its sources by id in `src`; `sources` lists them. In the default format every text is `{ "nl": "…", "en": "…" }`, and `format=flat&lang=nl` gives plain strings. `index.html` in the demo folder shows how each part is used on screen.

### 3. Approve

```bash
curl -X POST $ENGINE/v1/guides/approve -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"shop":"fietsshop-jansen","products":["https://fietsshopjansen.nl/products/helm-aero"]}'
# {"guides":[{"product":"https://fietsshopjansen.nl/products/helm-aero","status":"live","version":1}]}
```

- **A guide that breaks a rule** comes back as `"status":"waiting","reason":"quality"`. Add `"force": true` only when the shop deliberately approves it anyway.
- **Taking a guide offline:** `POST /v1/guides/remove {"shop","product"}`.

### Notifications (so the tool doesn't have to keep asking)

Set the tool's address in the console under *Koppeling met de tool*. The engine then POSTs:

```json
{"event":"guide.ready","at":"…","shop":"fietsshop-jansen","product":"https://…/helm-aero","productId":"…","qa":{…},"version":null,"held":false}
```

| event | when |
|---|---|
| `guide.ready` | written, ready to check |
| `guide.published` | live |
| `guide.failed` | something went wrong (`error`) |
| `guide.removed` | the product disappeared from the shop |

Check that a notification really came from the engine. The secret is shown in the console under *Koppeling met de tool*.

```js
import crypto from 'node:crypto';
const ok = req.headers['x-amplifai-signature'] === 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
```

Each notification is retried up to three times. Then read the guide with call 2.

### Showing the guide to customers

The simplest way: the tool's server reads `version=published&format=flat&lang=…` when the thank-you page or an email is rendered, and caches it for a minute. Customers never talk to the engine. (There is also a public read with a per-shop public key, `GET /v1/public/guide?key=pk_…&product=…`, if a widget ever needs to fetch it directly.)

## Errors

Errors are `{"error": "…"}` with a fitting status, sometimes with `field` or `code`. The messages are in Dutch and can be shown to AmplifAI staff as they are.

| status | meaning |
|---|---|
| 401 / 403 | wrong key; a setting the shop may not change; the test key on a real shop |
| 404 | unknown shop or product |
| 409 | live mode without an Anthropic key |
| 402 + `code: "budget"` | a spending limit is reached (see below) |
| 422 | invalid input; `field` says which |

## Costs and safety

**Free:**
- test mode
- the test key
- the four made-up stores
- reading shops and products

**Costs money:** only live mode, when Claude researches and writes. That's roughly:
- €0,30 per guide on Basis (Sonnet)
- €0,60 on Plus (Opus)
- €1,40 on Premium (Fable)

These numbers are estimates until there are real runs. The console then shows real averages.

**Hard limits**, set in the console under *AI en kosten*:
- per day, default €5
- per month, default €25
- per guide, default €2

Every call to Claude checks them first. When a limit is reached, new requests get `402` and a running guide stops with a clear reason, whoever asked for it.

**Noodstop (emergency stop):** switches everything back to test mode at once.

Also set a monthly spend limit on the Anthropic key itself, in the Anthropic Console. That brake works even if the engine has a bug.

A guide is written once and only rewritten when the product changes, so a shop's price per order and AmplifAI's cost per guide are separate. The engine doesn't know about orders. **Counting opened guides and billing the shop is the tool's job.**

## Going live

1. **Host the engine** somewhere the tool's server can reach it, behind HTTPS (not decided yet). For more than a handful of shops, replace the file store with a database; it's five calls, see README *Storage*.
2. **Set the keys** as environment variables: `ADMIN_API_KEY`, `TOOL_API_KEY`, `TOOL_TEST_KEY`, `PREVIEW_SECRET`, `HOST`, `CORS_ORIGINS`.
3. **Add the Anthropic key** in the console under *AI en kosten*, and set the limits.
4. **Try live** in the console's test bench under *Echte webshop*:
   1. Fetch a real shop (free).
   2. Pick one product. The bar shows what it will cost before you click.
5. **Switch the tool** from the test key to the real tool key.

## Still to decide together

- Where the engine runs (hosting and database).
- Who counts opened guides and bills them. The engine doesn't see orders, so this probably belongs to the tool.
- Whether a shop may press "rewrite everything" for a whole shop. In live mode that costs per product.
