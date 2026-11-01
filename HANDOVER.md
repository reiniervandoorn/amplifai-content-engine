# Connecting the AmplifAI tool to the content engine

This is for whoever builds the AmplifAI tool (juulvs/amplifai). It covers what the engine does, how to run it on your own computer for free, and the calls the tool makes. The exact request and response shapes are in [openapi.yaml](openapi.yaml); [README.md](README.md) covers running and hosting.

## Who does what

- **The AmplifAI tool** is everything a shop sees:
  - shops, products (import or scrape), brand knowledge, tone of voice and brand style
  - the guide editor, the statuses draft → approved → live, and the widget
  - billing
- **The content engine** is the "AI-generatie" and "AI-check met bronnen" (AI generation and AI check with sources) from the tool's setup guide. The tool sends one product with what it knows; the engine:
  1. researches the brand and the product
  2. writes the three guides (`ordered`, `in_transit`, `delivered`), in the tool's own guide format, with a source for every fact
  3. checks them against the AmplifAI rules and the guide editor's limits
  4. hands them back

The tool then saves each guide with `save_guide_content(product_id, moment, content)` as a draft, exactly as the editor does. The engine keeps no shops, products or guides; it keeps a result for 7 days so the tool can pick it up.

```
tool ── POST /v1/content (product + brand knowledge + settings) ──▶ engine: research, write, check
tool ◀──── guides[language][moment] in guideContentSchema + sources ── engine
tool: save_guide_content per moment (draft) → owner checks, edits, approves → live
owner wants a change ─▶ tool ── POST /v1/content/revise (result + piece + wish) ──▶ engine
owner edited by hand ─▶ tool ── POST /v1/content/check ──▶ engine (free, instant)
```

## Run it on your computer (free, about two minutes)

Needs Node 20 or newer.

```bash
git clone https://github.com/reiniervandoorn/amplifai-content-engine.git
cd amplifai-content-engine
npm install
npm run test-mode   # starts on http://localhost:4317
```

- **Admin page:** http://localhost:4317/admin opens by itself on your own computer. It is AmplifAI's own screen. Its **Proberen** (try it) box makes the same call the tool makes and shows the three guides; you can click **Wijzig** (change) on any piece.
- **Your key:** the admin page shows both keys under *Koppeling* (connection). They are also in `data/tool-test-key.txt` and `data/tool-key.txt`.
  - **Test key** (`tk_test_…`): use this while building. It always writes test texts and never costs anything, even when the engine is live.
  - **Tool key** (`tk_…`): the real one, for production. Put it in the tool's server env (next to `SUPABASE_SECRET_KEY`), never in the browser.

In test mode the research and writing are swapped for fixed templates. Everything else is real: settings, the quality check, ids, branching, revisions, callbacks. Test guides pass the tool's `guideContentSchema` like real ones; the engine's tests check that against a copy of the tool's schema (`contracts/tool-guide-schema.mjs`).

For the tool: the engine's `ANTHROPIC_API_KEY` lives in the engine. The tool needs `ENGINE_URL` and `ENGINE_KEY` instead.

## The calls

All calls send `Authorization: Bearer <key>` and JSON. `ENGINE=http://localhost:4317`.

### 0. What can a shop choose?

```bash
curl $ENGINE/v1/options -H "Authorization: Bearer $KEY"
```

Returns `settings` (each with its options, limits and default), `qualities` (Basis, Plus, Premium with AmplifAI's estimated cost per product), `moments` and `pieces` (the paths a revision can ask for). The defaults are the ones AmplifAI set on the admin page. How research and writing work for every product (the instructions, the rules, the quality check) is AmplifAI's too, and the tool cannot send it.

### 1. Write the guides for a product

```bash
curl -X POST $ENGINE/v1/content -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "product": {"name": "Sencha Kyoto", "sku": "TEA-001", "description": "Japanse groene thee uit Kyoto. Zet met water van 70 graden, twee minuten."},
  "shop": {"name": "Theehuis", "url": "https://theehuis.nl"},
  "brand": {
    "story": "Sinds 2009 halen wij thee rechtstreeks bij boeren.",
    "audience": "Thee-liefhebbers die willen leren",
    "usps": ["Rechtstreeks van de boer"],
    "expertise": [{"title": "Water", "body": "Zacht water geeft heldere thee.", "sourceId": "…", "enabled": true}],
    "sources": [{"id": "…", "label": "Zetadvies", "url": "https://theehuis.nl/zetten"}]
  },
  "settings": {"toneOfVoice": "Write like a friendly expert … address the customer informally …", "languages": ["nl"], "tipCount": 3, "questionCount": 2, "answerCount": 3},
  "reference": "<the tool's product id>",
  "callbackUrl": "https://<tool>/api/engine/callback"
}'
```

What maps from the tool:

| engine field | from the tool |
|---|---|
| `product.name`, `product.description`, `product.sku` | `products` (name, description, sku) |
| `product.url` | optional. When the tool has the product page, the engine reads it too. Without a URL, name and description are required |
| `shop.name`, `shop.url` | `shops` (name, url) |
| `brand.story`, `audience`, `usps` | `brand_about` |
| `brand.expertise[]` | `brand_expertise` (title, body, enabled, source_id as `sourceId`) |
| `brand.sources[]` | `brand_sources` (id, label, url): gives expertise its link |
| `settings.toneOfVoice` | `brand_profiles.tone_of_voice`, the preset text or the owner's own text, as it is. When it is null, send the tool's default preset text (`defaultTonePreset.instructions`) |
| `settings.formality` | optional: `auto` (default) reads it from the tone of voice ("address the customer formally" means u/uw), or `informal` / `formal` |
| `settings.tipCount`, `questionCount`, `answerCount` | per moment, within the editor's limits: 1–5 tips, 0–3 questions, 2–5 answers |
| `settings.languages` | `["nl"]` by default; `["nl","en"]` writes both with the same ids |

Brand notices (`brand_notices`) are temporary, so they don't belong in guides that are stored; show them in the widget instead.

The answer comes at once, with a job: `{"id": "job_…", "status": "queued", "reference": "…", "result": null, …}`. Get the result in one of three ways:
- `callbackUrl`: the engine POSTs the finished job there (see Callbacks).
- Poll `GET /v1/content/{id}` until the status is `done` or `failed`.
- Add `"wait": true` and the request answers when the job is done (up to 90 seconds).

Writing takes one to three minutes per product live, about a second in test mode. The engine works on two products at a time and queues the rest.

### 2. The result

| status | meaning |
|---|---|
| `queued` / `working` | busy; `progress` says what with |
| `done` | `result` holds the guides |
| `failed` | `error` says why, in Dutch; `code: "budget"` when a spending limit stopped it |
| `cancelled` | AmplifAI pressed the emergency stop before it started |

```json
{
  "formatVersion": 3,
  "test": true,
  "languages": ["nl"],
  "settings": {"languages": ["nl"], "quality": "basis", "toneOfVoice": "…", "formality": "informal", "length": "standard", "tipCount": 2, "questionCount": 1, "answerCount": 2},
  "product": {"url": null, "name": "Sencha Kyoto", "sku": "TEA-001", …},
  "guides": {
    "nl": {
      "ordered": {
        "intro": "Sencha Kyoto. …",
        "tips": ["Let op hoe het slijt. …", "Vraag het de shop. …"],
        "questions": [{
          "id": "169c0869-3f10-4aa8-b493-56bcf71de900",
          "question": "Hoe vaak ga je hem gebruiken?",
          "answers": [
            {"id": "e7229aca-…", "label": "Elke dag", "reply": "Bij dagelijks gebruik loont een vast onderhoudsmoment.", "next": "next"},
            {"id": "920768bb-…", "label": "Weet ik nog niet", "reply": "Begin met korte momenten en kijk wat bevalt.", "next": "next"}
          ]
        }]
      },
      "in_transit": {…},
      "delivered": {…}
    }
  },
  "citations": {"ordered.intro": ["s1", "f1"], "delivered.tips.0": ["f4"]},
  "sources": [
    {"id": "s1", "category": "shop", "claim": "Sinds 2009 halen wij thee rechtstreeks bij boeren.", "url": "https://theehuis.nl/", "title": "Verhaal van de shop", "used": true},
    {"id": "f1", "category": "brand", "claim": "…", "url": "https://…", "title": "…", "used": true}
  ],
  "quality": {"ok": true, "errors": 0, "warnings": 0, "issues": []},
  "costEUR": 0,
  "research": {…},
  "createdAt": "…"
}
```

- **`guides[language][moment]`** is exactly the tool's `GuideContent`: pass it to `save_guide_content(product_id, moment, content)`. Question and answer ids are UUIDs; `next` is `"next"`, `"end"` or the id of a later question. Replies are `null` when there is none.
- **`citations`** gives the sources per text: `"<moment>.intro"`, `"<moment>.tips.<n>"`, `"<moment>.questions.<n>.answers.<m>"`. Questions themselves carry no facts.
- **`sources`**: `f…` from research, `s…` from the shop's brand knowledge, `w…` from a shop's wish in a revision. `used` says whether a text cites it. Facts from the tool's own product text have `url: null` and the title "Productgegevens van de shop" (the shop's product data).
- **`quality.issues`** names the piece (same paths as `citations`, or a whole moment), the check and a message in Dutch, so the tool can show "needs a look" next to the right text. "Fits in the tool" is checked too, so `save_guide_content` won't refuse it.
- **Keep the whole result** (a `jsonb` column next to the guide is enough): a revision and a check need it back, with the tool's current texts in `guides`.
- `?lang=nl` on the GET returns only that language's guides.

### 3. The owner asks for a change

```bash
curl -X POST $ENGINE/v1/content/revise -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "content": <the stored result, with the current texts from the editor in guides>,
  "piece": "ordered.questions.0",
  "wish": "Vraag naar het moment van de dag",
  "wait": true
}'
```

| piece | rewrites | keeps |
|---|---|---|
| `ordered` | the whole guide for that moment | question and answer ids by position |
| `ordered.intro` | the intro | |
| `ordered.tips.1` | one tip | |
| `ordered.questions.0` | a question with its answers | the question id, answer ids, each answer's `next` |
| `ordered.questions.0.answers.2` | one answer and its reply | its id and `next` |

- The answer is a job; its `result` is the whole set with the change in it. Store it, and save the changed moment with `save_guide_content`. Texts the owner edited by hand stay as they are.
- **wish:** the owner's words, up to 600 characters. Without a wish the piece is written differently. What the owner says about their own product may be used as a fact (source `w1`, `w2`, …). The AmplifAI rules always win: a wish to sell or to promise a delivery date is not followed.
- **settings** (optional): another tone of voice, form of address or quality level for this rewrite. The languages stay the same.

### 4. The owner edits a text by hand

```bash
curl -X POST $ENGINE/v1/content/check -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"content": <the stored result, with the edited texts in guides>}'
# {"ok":false,"errors":1,"warnings":0,"issues":[{"piece":"delivered.tips.0","level":"error","code":"sell","message":"Klinkt als verkopen (\"korting\"); de gids verkoopt nooit"}]}
```

Free and instant. If the owner added or removed questions, give new ones a UUID (as the editor already does) and keep `citations` for the texts that stayed.

### Callbacks

With `callbackUrl` the engine POSTs when a job is finished (retried up to three times):

```json
{"event": "content.done", "at": "…", "job": {"id": "job_…", "reference": "<product id>", "status": "done", "result": {…}}}
```

The event is `content.done`, `content.failed` or `content.cancelled`. Check that it came from the engine; the secret is on the admin page under *Koppeling*:

```ts
import crypto from "node:crypto";
const ok = req.headers.get("x-amplifai-signature") === "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
```

### A small client

`clients/js/amplifai-content.js` wraps these calls (Node 18+, server side):

```js
import { ContentEngine } from './clients/js/amplifai-content.js';
const ce = new ContentEngine({ baseUrl: process.env.ENGINE_URL, key: process.env.ENGINE_KEY });
const done = await ce.waitFor(await ce.write({ product, shop, brand, settings, reference: product.id }));
for (const moment of ['ordered', 'in_transit', 'delivered']) await saveGuideContent(product.id, moment, done.result.guides.nl[moment]);
```

## Errors

Errors are `{"error": "…"}` with a fitting status, sometimes with `field` or `code`. The messages are in Dutch and can be shown to AmplifAI staff as they are.

| status | meaning |
|---|---|
| 400 | the body is not a JSON object |
| 401 / 403 | missing or wrong key; an admin call with a tool key |
| 404 | unknown job, or older than 7 days |
| 409 | live mode without an Anthropic key |
| 402 + `code: "budget"` | a spending limit is reached |
| 422 | invalid input; `field` says which |

## Costs and safety

**Free:** test mode, the test key (always), reading product pages, the check.

**Costs money:** only live mode, when Claude researches and writes. Roughly per product: Basis (Sonnet) €0,30, Plus (Opus) €0,60, Premium (Fable) €1,40. Writing the same product again within 7 days (another tone, a retry) reuses the research and costs about a third. A revision costs a fraction. `GET /v1/options` always gives the current estimate.

**Hard limits** on the admin page: per day (€5), per month (€25) and per product (€2). Every call to Claude checks them first; at a limit new requests get `402` and a running job stops with a clear reason. The **Noodstop** (emergency stop) puts everything back in test mode at once. Also set a monthly spend limit on the Anthropic key itself in the Anthropic Console.

The engine writes only when the tool asks. The tool decides when a product needs new guides, for example when its description changes. Counting opened guides and billing the shop is the tool's job.

## Going live

1. **Host the engine** where the tool's server can reach it, behind HTTPS. It needs a disk for `data/` (results for 7 days, spending, the Anthropic key).
2. **Set the keys** as environment variables: `ADMIN_API_KEY`, `TOOL_API_KEY`, `TOOL_TEST_KEY`, `HOST`, `CORS_ORIGINS`.
3. **Add the Anthropic key** on the admin page, and set the limits.
4. **Try live** on the admin page under *Proberen*: untick "Gratis testteksten" (free test texts) and write one product. The cost shows before you click.
5. **Switch the tool** from the test key to the real tool key.

## In the dashboard

The connection is built in juulvs/amplifai (branch `feature/content-engine`): `src/lib/content-engine.ts`, `src/features/guides/generation.ts` and the "Written by AI" panel on the product page. The engine's latest result per product lives in the table `guide_generations`. Live guides are never overwritten; a change with a wish lands in the editor unsaved. The dashboard's `docs/Setup-guide.md` describes it.

## Style

AmplifAI's house style (admin page, *Instructies* → *Toon*) always applies. The shop's tone of voice from the dashboard comes on top of it and cannot override it or the rules.

## Still to decide together

- Where the engine runs.
- When the tool asks for new guides beyond the owner's click: on import, or when a product changes.
- A callback from the engine to the dashboard, so finished work is saved while nobody has the page open.
