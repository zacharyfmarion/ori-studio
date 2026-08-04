# Crease-Pattern Share Links (server-stored, with preview cards)

## Goal

Replace the fragment-carried share link (`/s#<payload>`) with a short, server-stored
link (`/s/<id>`) that unfurls into a real preview card on Discord, Twitter/X, Slack, and
iMessage.

The crease pattern still travels as the **compressed codec payload** from
`implementation-plans/cp-url-compression.md` — the Worker stores that string verbatim and
never learns what a crease pattern is. The preview image is rendered client-side from the
**same options the export-image modal already offers**, so the card is a picture the sharer
chose rather than a screenshot we guessed at.

Two problems go away:

- **Link length.** The shipped stage-1 codec measures p50 838 chars, p90 2,628, max 23,675
  over the 563-document corpus. 92 of 563 documents (16%) exceed the 2,000-char threshold
  where chat clients and mail wrapping start truncating. At `/s/<8 chars>` every document
  fits, including the 23,675-char worst case, and `SHARE_LENGTH_WARNING` can be deleted.
- **No preview.** OG crawlers do not execute JS, so a fragment payload can never produce a
  card. This is the reason the scheme has to be server-backed at all.

### Non-goals for v1

Explicitly deferred, with the record shape left open where it costs nothing:

- **Remix / attribution.** No `forkedFrom`, no share banner. openscad-studio's growth loop.
- **`?mode=` layout presets.** Shared links land in Edit; there is nothing to choose.
- **Desktop deep links.** `apps/web/src/routing/appRouter.tsx:89` uses `createMemoryRouter`
  on Tauri — the desktop shell has no address bar. Share *creation* is gated off there for
  v1 alongside the web-only flag.
- **Deleting or editing a share.** See "Retention and privacy".
- **Sharing anything but a crease pattern.** No reference images, annotations, saved
  simulations, or `.osf` session state — the existing scope note already says this.

---

## Approach

### URL scheme: a path segment, not a fragment

```
https://oristudio.pages.dev/s/a3bK9xmQ
```

`implementation-plans/cp-url-compression.md` stage 4 sketched `#s=<id>`. **That is obsolete
and the reason matters**: a fragment is never sent to the server (RFC 3986 §3.5), so the
Worker cannot see the id, cannot look up the title, and cannot emit an `og:image`. The
privacy argument that motivated the fragment — the payload never lands in an access log —
does not transfer to an opaque 8-character id, which has to reach the server to be resolved
at all.

`/s#<payload>` keeps decoding forever. It is one branch in `ShareRoute`, and links already
in the wild must not break.

### What the Worker stores

The codec output, verbatim. No `CompressionStream`, no `DecompressionStream`, no base64
round-trip in the Worker — that is a third of openscad-studio's `functions/_lib/share.ts`
deleted, and it means the Worker has no opinion about crease patterns and no way to
corrupt one.

```ts
interface CpShareRecord {
  id: string;              // 8 chars, [a-zA-Z0-9]
  payload: string;         // base64url codec output, stored as-is
  title: string;           // ≤100 chars
  author: string | null;   // ≤60 chars, optional
  createdAt: string;       // ISO 8601
  creaseCount: number;     // for the card description
  thumbnailUploadTokenHash: string | null;  // SHA-256; write-once gate
}
```

`author` is free text supplied by the sharer — a display name, a handle, whatever they
type. It is not an identity claim and nothing verifies it. It appears in two places: drawn
into the preview card, and in the `og:description` (`"A crease pattern by {author} · {n}
creases"`, falling back to the creases alone when absent).

Deliberately **not** stored: `thumbnailKey`. See "Cost model" — deriving it costs a second
KV write per share, and it is derivable for free.

### Endpoints

All under `apps/web/functions/`, mirroring openscad-studio's layout.

| Route | Behaviour |
|---|---|
| `POST /api/cp` | Validate payload shape + size, rate-limit, mint an id, write KV, return `{ id, url, thumbnailUploadToken }`. |
| `GET /api/cp/[id]` | Return the record. Used by the retry path and by nothing on the happy path — see below. |
| `PUT /api/cp/[id]/thumbnail` | One-time bearer token (only the SHA-256 is stored), `R2.head` gates re-upload with 409, writes `thumbnails/{id}.png`. |
| `GET|HEAD /api/cp/[id]/thumbnail` | Serve from R2. **On miss, serve the default card bytes** with `max-age=60` so the cache recovers once the real one lands; the real one is served `immutable`. |
| `GET /s/[[shareId]]` | Read the record, inject OG tags into `index.html`, **and inline the payload**. |

The fallback-on-miss in the thumbnail GET is what lets the OG function emit
`og:image` unconditionally and `twitter:card: summary_large_image` unconditionally, with no
knowledge of whether an upload happened. Serving bytes rather than redirecting because
crawler redirect-following is inconsistent.

### The `/s/[[shareId]]` function does two jobs, and the second one is the whole design

It already reads the record to write the meta tags. So it inlines the payload into the HTML
it is returning:

```html
<script type="application/json" id="shared-cp">{"id":"a3bK9xmQ","payload":"…","title":"Bird base"}</script>
```

This collapses three separate problems into one change:

1. **Halves the read cost.** No `GET /api/cp/{id}` on the happy path — 2 KV reads per click
   becomes 1. See "Cost model".
2. **Deletes the load jank.** The crease pattern is present at first paint with zero
   fetches, so there is no blank-canvas flash and none of openscad-studio's
   `shareEntryStore` phase machine (`idle → fetching → applying → rendering → ready`) is
   needed. That machine exists purely to paper over a network round-trip we now do not make.
3. **Keeps the provisioning seam intact.** The inlined payload is read at module scope in
   `main.tsx` into `window.__SHARED_CP`, and from there it is exactly the same string the
   fragment path already produces — so `ShareRoute` and `ensureEditCreasePattern` do not
   care which way it arrived.

Max payload is 24 KB and it gzips in transit. The HTML is per-share and uncacheable across
shares regardless, because the OG tags already differ.

`GET /api/cp/[id]` still exists as the retry path (KV is eventually consistent; see "Sharp
edges") and because a JSON endpoint is the right shape for anything that comes later.

### Preserve COOP/COEP on the Function response

`apps/web/public/_headers` sets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` globally, and the wasm engine needs that
cross-origin isolation. **Cloudflare Pages does not apply `_headers` to Function
responses.** Without an explicit re-set in `functions/s/[[shareId]].ts`, shared links become
the one entry path where the engine is broken. openscad-studio sets both explicitly at
`apps/web/functions/s/[[shareId]].ts:169`.

### The deploy change that will otherwise silently no-op

`.github/workflows/deploy-web.yml:53` runs `npx wrangler@4 pages deploy apps/web/dist` **from
the repo root**. Wrangler discovers `functions/` relative to its working directory, so the
Functions would not upload, every endpoint would 404, and the deploy would report success.
openscad-studio hit exactly this and fixed it with `working-directory: apps/web` +
`pages deploy dist`.

### Opening a short link

`ShareRoute` keeps its shape — capture intent, redirect to Edit, provision on the Edit
surface. `apps/web/src/routing/ShareRoute.tsx:11` states the rule and the
`web-startup-provisioning-architecture` note repeats it: never provision in a route.

Because the payload is inlined, `/s/<id>` needs no fetch and no loading state — it reads
`window.__SHARED_CP`, stashes the payload, and redirects, identical to the fragment path.
`pendingSharedCpPayload` stays a `string | null`; no tagged union, no widening.

The retry path (inline payload absent — an eventual-consistency miss, or a hand-typed URL)
is the only asynchronous case, and it lands in `ensureEditCreasePattern`'s in-flight guard
beside `openSharedCpPayload`, whose error handling already does the right thing: toast the
typed error, seed a blank canvas, clear the pending payload so a failing decode is not
retried on the next mount. A 404 becomes one more code in `toastMessages.ts` beside
`share_link_invalid` / `share_link_too_new`.

### Preview image UX

A live 1200×630 card preview and **five controls**. Not the export dialog's full option set
— the card is a social preview, not a deliverable, and every control that does not visibly
change it is a decision the sharer should not have to make.

```
┌─────────────────────────────────────────────┐
│  🔗 Share crease pattern                 ✕  │
│  ┌───────────────────────────────────────┐  │
│  │                                       │  │
│  │        [ 1200×630 live preview ]      │  │
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│  Title   [ Bird base                     ]  │
│  Author  [ Zachary Marion       optional ]  │
│                                             │
│  Folded figure          [ ○ off  ● on ]     │
│    Side       [ Front | Back ]              │
│    Front      [ ███ #ffff32 ]               │
│    Back       [ ███ #e9e9e9 ]               │
│                                             │
│  [        Create Share Link             ]   │
│  ───────────── after ─────────────          │
│  [ oristudio.pages.dev/s/a3bK9xmQ ]  📋     │
│  Anyone with this link can view it.         │
└─────────────────────────────────────────────┘
```

**Title and author are card content, not controls.** They are rendered *into* the image,
and they map onto the caption block `composeCreaseExportSvg` already lays out:
`caption.title = title` (52px) and `caption.subtitle = author ? "by {author}" : ""` (30px).
`caption.description` stays empty. So no new text-rendering primitive is needed — this is
exactly the title/subtitle pair the layout was built for.

**Everything else uses `DEFAULT_CREASE_EXPORT_OPTIONS`** — line style, line width, point
size, unassigned creases, background, and `theme: 'light'` (already the export default, and
correct for a social card). Not exposed, not persisted, not in the record.

**Four controls, all folded-figure:** on/off, side, front colour, back colour.
`OristudioCpFoldedFigureState` also has `Both2` and `Transparent3`, and the export dialog
offers `foldCase` (which layer-ordering solution) — none are exposed here. Share pins
`foldCase: 1`.

Two consequences for the build:

- **No `CreaseExportOptionsForm` extraction.** The share modal's four controls do not match
  the export dialog's folded section (2-way side vs 4-way, no fold case), so a shared
  presentational component would be a worse interface than two small forms. AGENTS.md's rule
  against extractions whose interface is worse than the inlining applies directly.
- **`useFoldedFigurePreview` *is* worth extracting.** The async kernel fold, its cache, its
  cancellation, and its error handling (`CreaseExportDialog.tsx:187-233`) are identical for
  both dialogs and are state, not presentation — the row in AGENTS.md's panel table that
  says state and derived data for one concern goes in a `use*` hook beside that concern.

Because options are chosen *before* creation, the immutable-thumbnail property costs nothing
— there is no "I want to change the preview afterwards" tension. A different card means a
different link.

**Remember the author name** across shares via `lib/storage.ts` (`readString`/`writeString`
with a new `STORAGE_KEYS.shareAuthor` entry) — retyping your own name on every share is
friction with no purpose. Per the storage-layer rule, it goes through the key registry, not
a raw `localStorage` call.

**One genuinely new render piece:** `svgToPngCard()` beside `svgToPng`
(`apps/web/src/lib/creaseExport.ts:730`). Compose at natural aspect, then fit-and-centre onto
a fixed 1200×630 canvas filled with `palette.canvas`. openscad-studio shipped without this
and got **90×54** thumbnails, because they rasterized at the SVG's intrinsic size
(`implementation-plans/share-2d-thumbnail-improvement.md`). ~30 lines to not repeat.

### Entry points

Mirror Export exactly, so Share is not reachable from fewer places than its sibling verb:

- `CpSelectionToolbar` — the existing share button, scoped to the selected segment.
- Wherever the export dialog is reachable for the whole document — the codec takes any FOLD
  frame, so `segmentId: null` is free and the dialog's pattern picker already handles it.

---

## Cost model

**Every Cloudflare figure below was verified against the live docs on 2026-08-03.** Sources
are linked at the end of this section. Re-check before Phase A only if significant time has
passed.

Four verified facts changed the design from the first draft:

1. **The Workers rate-limiting binding is GA and free-plan eligible — but Cloudflare Pages
   cannot use it.** An earlier draft of this plan claimed it as a shipped baseline and put
   the free creation ceiling at 1,000 shares/day. That was wrong: the binding was verified,
   its availability *on Pages* was not. The supported Pages Functions bindings are `vars`,
   `d1_databases`, `durable_objects`, `hyperdrive`, `kv_namespaces`, `queues.producers`,
   `r2_buckets`, `vectorize`, `services`, `analytics_engine_datasets` and `ai` —
   `ratelimits` is not among them. So rate limiting is a KV counter, share creation costs
   **2 KV writes**, and the free ceiling is **500 shares/day**. Two ways to recover the
   other 500, both deferred and neither urgent at realistic volume: a WAF rate-limiting rule
   (zero KV cost, and it rejects before the Function is even invoked) once there is a custom
   domain to attach one to, or moving off Pages to Workers Static Assets.
2. **Exceeding a free-plan KV limit is a hard failure, not an overage charge**: *"If you
   exceed any one of these limits, further operations of that type will fail with an
   error."* Sharing breaks until 00:00 UTC rather than quietly costing money. That needs a
   real error path, not just a monitoring alert.
3. **Reads of non-existent keys are billed**: *"all operations incur charges, including
   fetches for non-existent keys that return a null or HTTP 404."* So `/s/<garbage>` burns
   read quota. Validating the id shape *before* touching KV is a free defence.
4. **The Workers Free plan allows 10 ms of CPU time per invocation.** Our `/s/<id>` function
   does a KV read (I/O, not CPU) plus meta-tag rewriting and payload inlining over
   `index.html` (string work, CPU). Expected to be comfortably under, but it is a real
   ceiling and Phase A should measure it rather than assume.

### What we store, derived not guessed

Stage 1 measured **13.91 bits/crease** over **329,254 creases in 563 documents**:

```
329,254 creases × 13.91 bits ÷ 8    =  572,490 bytes total
                         ÷ 563 docs =  1,017 bytes/doc  (compressed binary, mean)
                        × 4/3       =  1,356 chars/doc  (base64url, what we store)
```

Cross-check: mean 1,356 against the measured p50 of 838 is a 1.6× mean/median ratio, the
right shape for that skew. Plus ~250 bytes of JSON record overhead (id, title, ISO
timestamp, 64-char token hash, crease count):

| | mean | p90 | max measured |
|---|---|---|---|
| KV record | **~1.6 KB** | ~2.9 KB | ~24 KB |
| R2 thumbnail | **~80 KB** *(estimated)* | — | 512 KB cap |

**The thumbnail is 50–200× larger than the crease pattern it depicts.** The payload is free;
the image is the entire storage story. The 80 KB is the one input estimated rather than
derived — 1200×630 PNG of 6-colour line art from `canvas.toBlob` — and it is measurable the
moment `svgToPngCard` exists. Sensitivity:

| PNG mean | thumbnails in 10 GB |
|---|---|
| 40 KB | 250,000 |
| 80 KB | 125,000 |
| 150 KB | 67,000 |
| 300 KB | 33,000 |

(Decimal GB throughout, matching how Cloudflare bills storage.)

### What each action costs

| Action | Functions | KV writes | KV reads | R2 Class A | R2 Class B |
|---|---|---|---|---|---|
| Create a share | 2 | **1** | 1 | 1 | 1 |
| **Click** a share link | **1** | 0 | **1** | 0 | 0 |
| 10,000 people *see* a Discord embed | ~1 | 0 | ~1 | 0 | ~1 |
| Load the 919 KB wasm + JS bundle | **0** | 0 | 0 | 0 | 0 |

Three facts drive everything:

1. **Static assets are free and unlimited on Pages, on every plan.** Only Function
   invocations count. The app being heavy costs nothing.
2. **Views are not reads.** Discord's crawler fetches once and re-hosts the image through
   its own CDN; Twitter/X and Facebook cache the card; iMessage, Signal and WhatsApp build
   the preview on the *sender's* device. Ten thousand people seeing the embed is ~1 fetch.
   Only *clicks* cost reads. The browser never fetches `og:image` on a real visit.
3. **Reads never trigger writes.** The rate-limit counter increments on `POST` only. A link
   going viral cannot touch the write ceiling at all — only *creating* shares consumes
   writes. The two walls are fully decoupled.

### How the design minimizes cost

Four choices, each removing a per-share or per-click operation:

| Choice | Saves | Effect |
|---|---|---|
| **Store the codec payload verbatim** | — | Record is 1.6 KB instead of the multi-KB `.cp`/`.fold` text openscad-studio compresses server-side. ~650k shares fit in the 1 GB free KV tier. |
| **Inline the payload into the `/s/<id>` HTML** | 1 KV read + 1 Function invocation **per click** | Halves the read cost, doubling the click ceiling to ~100,000/day. Also deletes the load jank and the entire phase-machine that would otherwise be needed. |
| **Don't store `thumbnailKey`; fall back in the thumbnail GET** | 1 KV write **per share** | openscad-studio writes the record a second time after upload. Serving a default card on R2 miss makes thumbnail existence both underivable and unneeded. 3 writes → 2. |
| ~~Rate-limit binding instead of a KV counter~~ | *(unavailable)* | Would have been 2 writes → 1 and a 1,000/day ceiling, but `ratelimits` is not a Pages Functions binding. The KV counter stays, and with it the second write. |

Combined, the two that shipped take the free creation ceiling from **~330 to 500
shares/day** and the free click ceiling from **~50,000 to ~100,000/day**, against the
openscad-studio shape, while removing code rather than adding it.

The rate limiter is worth its write. It is 30/hour per hashed IP, which no legitimate user
reaches, and it stops a buggy client loop or a naive script from burning the daily budget.
It is emphatically **not** a defence against a determined attacker — IPs are cheap, and KV's
own eventual consistency means the counter undercounts across colos. What actually bounds
damage is the free plan's hard daily write ceiling and the 64 KB payload cap.

### Free-tier ceilings

| Resource | Free allowance | Our rate | **Ceiling** |
|---|---|---|---|
| KV writes | 1,000/day | 1/share | **1,000 shares/day** ← *first rate wall* |
| KV reads | 100,000/day | 1/click + 1/share | ~100,000 clicks/day |
| Functions | 100,000 req/day | 1/click + 2/share | ~100,000 clicks/day |
| R2 Class A | 1M/month | 1/share | ~33,000 shares/day |
| R2 Class B | 10M/month | ~1/unfurl | unreachable |
| KV storage | 1 GB | 1.6 KB/share | ~625,000 shares *cumulative* |
| **R2 storage** | **10 GB-month** | ~80 KB/share | **~125,000 shares *cumulative*** ← *first wall overall* |

Two kinds of wall, reached very differently:

- **Rate**: 1,000 new shares/day, or ~100,000 clicks/day. Crossing either means Workers
  Paid, **$5/month** — and on the free plan, crossing a KV limit **fails hard** rather than
  billing, so this needs a real user-facing error state, not just an alert.
- **Cumulative**: ~125,000 thumbnails. Storage accrues forever and never resets.

Time to the R2 wall, by creation rate: **20/day → ~17 years. 100/day → ~3.4 years.
1,000/day → ~4 months.**

**The rate-limit binding flipped which bill arrives first.** At 1 KV write per share the
full 1,000 shares/day is sustainable *on the free Workers plan*, so the first thing ever
paid for is **R2 storage** — and only after ~125,000 cumulative shares.

### What it would actually cost

| Scenario | Consumption after 1 year | Monthly cost |
|---|---|---|
| **20 shares/day, 200 clicks/day** (realistic) | 20 KV writes/day (2% of free), 220 reads/day (0.2%), 0.58 GB R2 (5.8%), 11.7 MB KV (1.2%) | **$0**, and ~17 years to the first R2 dollar |
| **1,000 shares/day, 10,000 clicks/day** (at the free write ceiling) | 1,000 KV writes/day (exactly at the cap), 11,000 reads/day (11%), 12,000 Functions/day (12%), 29.2 GB R2 → 19.2 GB billable, 0.58 GB KV | **~$0.29** — **Workers is still free**; R2 storage is the only bill, crossing 10 GB at ~day 125 |
| **3,000 shares/day, 30,000 clicks/day** (implausibly successful) | 91k writes/month vs 1M included, 1.0M reads/month vs 10M, 1.1M Functions/month vs 10M, 87.6 GB R2 → 77.6 billable, 1.75 GB KV → 0.75 billable | **~$6.54** ($5 Workers Paid + $1.16 R2 + $0.38 KV) |

**R2 storage is the first thing you ever pay for, and it is cents.** The $5/month Workers
Paid plan only arrives above 1,000 shares/day — and even then, the total stays under $7.
Popularity is close to free: 100,000 clicks in a day off one post is
front-page-of-Hacker-News territory, and the read side realistically never binds.

One prerequisite confirmed: **R2 requires a valid payment method on file to enable the
subscription**, even though usage inside the free tier shows as a $0.00 line item. Still to
confirm in Phase 0: whether **KV free limits are already partly consumed** by anything else
on the account, since they are per-account.

### Abuse

The rate limit is a speed bump, not a defence — IPs are cheap, and the binding's counters
are per-colo, so a distributed attacker gets one bucket per location.

**Write-side.** What actually bounds damage is the free plan's own 1,000 writes/day: at a
**64 KB payload cap** (2.7× the largest real CP, 24 KB), a fully saturated attack stores
64 MB/day and would take ~16 days to fill 1 GB of KV. On Workers Paid that ceiling
disappears, which is the real argument for keeping the payload cap tight rather than
generous.

**Read-side, and this one is easy to miss.** Cloudflare bills *"fetches for non-existent
keys that return a null or HTTP 404."* So 100,000 requests to `/s/<garbage>` exhausts the
day's entire free read quota, and — because free-plan overage fails hard rather than billing
— **every real share link stops resolving until 00:00 UTC.** The defence is free: **validate
the id against `/^[a-zA-Z0-9]{8}$/` before touching KV**, which rejects almost all garbage
at zero cost. Worth doing in `POST` and both `GET`s.

The mitigation beyond that is monitoring and the ability to wipe a namespace, not
prevention. Do not build a CAPTCHA for v1.

### Sources

Verified 2026-08-03:
[KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) ·
[KV limits](https://developers.cloudflare.com/kv/platform/limits/) ·
[How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/) ·
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) ·
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) ·
[Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/) ·
[Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) ·
[Rate Limiting GA announcement](https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/) ·
[Cloudflare billing FAQ](https://developers.cloudflare.com/billing/understand/faq/)

---

## Retention and privacy

**Cloudflare has no retention policy.** KV keeps a key forever unless `expirationTtl` is
passed *at write time*; R2 keeps an object forever unless a lifecycle rule is configured.
Cloudflare will hold this indefinitely and bill for it. Retention is entirely our decision,
and those two mechanisms are the only ways to enforce one.

**Decision: the payload is permanent; the preview image expires after 1 year.**

| | Store | Retention | Mechanism |
|---|---|---|---|
| Crease pattern payload | KV | **Indefinite** | no `expirationTtl` |
| Preview thumbnail | R2 | **1 year** | bucket lifecycle rule |

The two are not the same kind of thing. **The payload is the artifact; the image is
packaging.** A crease pattern is worth opening in five years. The card that made someone
click in 2026 is not — unfurls happen at the moment a link is posted, and after that the PNG
is 98% of the bytes doing ~0% of the work. Giving them the same retention was an accident of
symmetry, not a decision.

**What expiry actually changes: a cumulative wall becomes a steady state.** Without a
lifecycle rule, R2 grows forever and cost is a function of *time*. With one, storage
converges to `rate × retention × size` and stops — cost becomes a function of *rate* alone.
The free tier holds ~125,000 thumbnails at any moment, so the condition is
`rate × retention_days ≤ 125,000`:

| Retention | Max rate that stays free forever | Cost at 1,000/day (free-plan max) |
|---|---|---|
| 90 days | 1,389/day | **$0** (7.2 GB steady) |
| 180 days | 694/day | $0.07/mo (14.4 GB) |
| **1 year** | **342/day** | **$0.29/mo** (29.2 GB) |
| 2 years | 171/day | $0.73/mo (58.4 GB) |
| never | — | unbounded |

At ≤90 days the two limits interlock and R2 becomes *provably* free: the KV write ceiling
caps creation at 1,000/day, and 1,000 × 90 × 80 KB = 7.2 GB never reaches the 10 GB tier.

**But this is not a money decision** — at 6 months and maxed-out free-plan creation it is
seven cents. Expiry buys two things worth more than the money: a **bounded liability**
(storage is a constant we chose, not a number that grows while we aren't looking) and
**self-cleaning abuse** (junk thumbnails evaporate; KV records would not, but they are 1.6 KB
and TTLing them would kill links, which is the thing being protected).

**The real cost of expiry, stated honestly:** a re-share of an expired link gets the generic
card, and — worse — if a platform's own image cache expires and it re-fetches, an *existing*
Discord message's embed can silently degrade from the real card to the default. Regenerating
on demand would avoid this, but the renderer is browser canvas + wasm; a Worker cannot run
it and Cloudflare's Browser Rendering is paid. Considered and rejected.

**Why 1 year and not 90 days**, given 90 is provably free: **shortening retention later is
trivial, lengthening it is impossible** — expired objects are gone. Start long, measure, and
tighten if the measured PNG size argues for it. One year comfortably covers the window in
which a link is actively circulating, and costs $0.29/month only in a scenario that also
requires maxing out free-plan creation every day for a year.

Sequenced with the Phase B measurement: if the real PNG lands nearer 30 KB than 80 KB, the
tier holds ~333,000 concurrent thumbnails and even 2 years is free at 456/day.

What must be written down and surfaced in the modal:

> Anyone with this link can view it. Links cannot be deleted or changed. Don't share
> anything you wouldn't publish.

Plus, wherever the retention is documented: the crease pattern is kept indefinitely; the
preview image may stop appearing after a year, which does not affect opening the link.

**No personal data is stored at all.** openscad-studio's rate-limit key is
`ratelimit:{ip}:{hour}` — a raw IP address in KV. Moving to the platform rate-limiting
binding removes that record entirely rather than hashing it, so "we store nothing about
anyone" is literally true and not merely mitigated.

---

## Sharp edges

**KV is eventually consistent, and the docs are specific about it.** A write "may take up to
60 seconds to propagate" to all 300+ locations, because writes go to central stores and
locations serve from a cache with a TTL (default `cacheTtl` 60s). Reads *from the location
that wrote* are immediate; reads from anywhere else are not. Two consequences:

- The id-collision check on create is theatre — a read may not observe a concurrent write.
  What protects us is entropy: 62⁸ = 2.18×10¹⁴, so at a million shares the birthday
  probability of *any* collision is ~0.2%. Keep the check (it is one read, and it catches the
  common case) but do not treat it as a guarantee.
- **A freshly created link pasted to someone on another continent can 404 for up to a
  minute** — this is documented behaviour, not a fluke. openscad-studio does not handle it.
  Fix: on a 404 for a well-formed id, retry with backoff for ~60s before showing the error
  state.

**Free-plan KV limits fail hard.** *"If you exceed any one of these limits, further
operations of that type will fail with an error"*, and they reset at 00:00 UTC. So a
write-quota exhaustion is not a surprise invoice, it is share creation being broken for the
rest of the day — and a read-quota exhaustion breaks *opening* every existing link. Both need
a distinct, honest error message rather than the generic failure toast.

**Workers Free allows 10 ms of CPU time per invocation.** The `/s/<id>` function's KV read is
I/O (not counted), but the meta-tag rewriting and payload inlining are string work over
`index.html`. Expected to be well under, but measure it in Phase A rather than assume —
especially with a 24 KB payload inlined.

**`index.html` has no `og:image` and no twitter tags** (`apps/web/index.html:12-18`). The
meta-rewriting function appends missing tags before `</head>`, so it works either way, but
adding placeholders makes the regex path deterministic and the default card correct for the
non-share pages too.

**SPA fallback through the Function.** `functions/s/[[shareId]].ts` calls `context.next()`,
which resolves to `index.html` via Pages' single-page-app handling. `apps/web/public/_redirects`
is empty and `/edit` works today, so the fallback is already in effect — but confirm it
during Phase A rather than assuming.

---

## Affected Areas

**New — Worker (`apps/web/functions/`)**

- `_lib/cpShare.ts` — `Env`, `CpShareRecord`, `json`, id/token generation, id-shape
  validation, KV read/write. No compression, and no KV rate-limit counter — rate limiting is
  the platform binding.
- `api/cp.ts` — `POST`
- `api/cp/[id].ts` — `GET`
- `api/cp/[id]/thumbnail.ts` — `GET` / `HEAD` / `PUT`
- `s/[[shareId]].ts` — OG injection + payload inlining + COOP/COEP
- `apps/web/wrangler.toml` — `SHARE_KV`, `SHARE_R2` bindings (production + preview)
- `apps/web/public/og-default.png` — 1200×630 fallback card

**New — frontend**

- `apps/web/src/cp-workspace/share/cpShareService.ts` — fetch client, `ShareRequestError`
- `apps/web/src/cp-workspace/share/useCpShare.ts` — store bindings for the modal
- `apps/web/src/cp-workspace/folded/useFoldedFigurePreview.ts` — the async fold + cache +
  cancellation extracted from `CreaseExportDialog.tsx:187-233`, shared by both dialogs

**Modified**

- `.github/workflows/deploy-web.yml` — `working-directory: apps/web`
- `apps/web/index.html` — `og:image`, twitter tag placeholders
- `apps/web/src/main.tsx` — read the inlined `#shared-cp` blob into `window.__SHARED_CP`
- `apps/web/src/routing/appRouter.tsx` — add `path: 's/:shareId'`
- `apps/web/src/routing/ShareRoute.tsx` — id branch alongside the fragment branch
- `apps/web/src/routing/paths.ts` — `shareLinkPath(id)`
- `apps/web/src/lib/shareLink.ts` — `buildShortShareUrl`; delete `SHARE_LENGTH_WARNING` /
  `isShareLinkLong` once nothing reads them
- `apps/web/src/lib/creaseExport.ts` — `svgToPngCard()`
- `apps/web/src/components/CreaseExportDialog.tsx` — consume `useFoldedFigurePreview`
- `apps/web/src/cp-workspace/share/ShareLinkModal.tsx` — becomes the real share dialog
  (preview, title, author, four folded-figure controls)
- `apps/web/src/lib/storage.ts` — `STORAGE_KEYS.shareAuthor`
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — `shareOristudioCpSegment`
  posts instead of building a fragment URL
- `apps/web/src/store/workspaceStore/types.ts` — `OristudioCpShareLink` loses `long`
- `apps/web/src/lib/toastMessages.ts` — share-not-found, share-create-failed, rate-limited,
  **quota-exhausted** (the free-plan hard-failure case)
- `apps/web/package.json` — `share:dev` (wrangler pages dev with local KV/R2 emulation)

---

## Checklist

### Phase 0 — decisions before any storage exists

- [x] Verify every Cloudflare free-tier and paid figure against the live docs (2026-08-03).
      All confirmed exactly; sources linked in "Cost model". Three findings changed the
      design: the rate-limit binding is GA and free-plan eligible (2 writes → 1), free-plan
      overage **fails hard** rather than billing, and **null reads are billed**.
- [x] Confirm R2's free tier applies but **requires a valid payment method on file** to
      enable the subscription; in-tier usage shows as a $0.00 line item.
- [x] Confirm the rate-limiting binding is GA (Sept 2025), available on Workers Free, and
      that Pages Functions requests count against Workers quotas. Write count recorded as
      1/share throughout.
- [ ] Confirm whether the account is already on Workers Paid, and whether KV free limits are
      already partly consumed — they are **per account**, not per project.
- [ ] Write the retention/privacy note into the modal copy and into `README.md`.
- [ ] Freeze the payload cap at **64 KB** and record the reasoning (2.7× the largest
      measured CP; bounds abuse damage under Workers Paid).
- [ ] Decide the copy for the two quota-exhaustion states — creation broken until 00:00 UTC,
      and existing links failing to open — since neither is a normal error.

### Phase A — infrastructure and Worker

- [ ] Create the `SHARE_KV` namespace and `share-thumbnails` R2 bucket (production +
      preview).
- [x] `apps/web/wrangler.toml` with both bindings.
- [x] **Fix `deploy-web.yml` to run wrangler from `apps/web`** and verify the Functions
      actually upload — a wrong CWD 404s every endpoint while reporting success.
- [x] `_lib/cpShare.ts` — no KV rate-limit counter; the **platform rate-limiting binding**
      replaces it. No raw IP is ever stored.
- [x] **Reject ids failing `/^[a-zA-Z0-9]{8}$/` before any KV access**, on every route.
      Null reads are billed, so this is the read-side abuse defence and it is free.
- [x] `POST /api/cp`, `GET /api/cp/[id]`, `PUT|GET|HEAD /api/cp/[id]/thumbnail`.
- [x] Thumbnail GET falls back to `og-default.png` bytes with `max-age=60`; real thumbnails
      served `immutable`.
- [x] `GET /s/[[shareId]]` — OG tags (`og:description` includes `author` when present),
      payload inlining, **explicit COOP/COEP**.
- [ ] Verify COOP/COEP survive on the `/s/<id>` response and the wasm engine still boots.
- [ ] **Measure the `/s/<id>` function's CPU time with a 24 KB payload inlined** against the
      free plan's 10 ms/invocation ceiling.
- [ ] Confirm Pages' SPA fallback resolves `context.next()` to `index.html` for `/s/<id>`.
- [x] `share:dev` script: `wrangler pages dev dist --kv SHARE_KV --r2 SHARE_R2 --persist-to`,
      plus `VITE_SHARE_API_URL` so the vite dev server targets it.
- [x] Worker unit tests: payload validation, size cap, id-shape rejection, rate limiting,
      token hashing, one-time upload gate, meta-tag rewriting, author in `og:description`.

### Phase B — the preview image

- [x] `svgToPngCard()` in `creaseExport.ts` — fit-and-centre onto a fixed 1200×630 canvas
      filled with `palette.canvas`.
- [x] Unit tests: output is exactly 1200×630; aspect preserved; a tiny intrinsic SVG still
      produces a full-size card; invalid input fails cleanly.
- [ ] **Measure the real PNG size distribution** across the corpus and replace the estimated
      80 KB in "Cost model" with a measured mean and p90. If the mean exceeds ~150 KB,
      reconsider card dimensions before shipping.
- [ ] Confirm a dense CP stays under the 512 KB cap; skip the thumbnail rather than failing
      the share if it does not.

### Phase C — the share modal

- [ ] Extract `useFoldedFigurePreview` from `CreaseExportDialog` with no behaviour change;
      existing export tests stay green. **Do not** extract a shared options *form* — the
      share modal's controls are a different set.
- [ ] `ShareLinkModal`: live 1200×630 card preview, title, optional author, and exactly four
      folded-figure controls (on/off, Front|Back, front colour, back colour). Everything else
      comes from `DEFAULT_CREASE_EXPORT_OPTIONS`; `foldCase` is pinned to 1.
- [ ] Title → `caption.title`, author → `caption.subtitle` as `"by {author}"`;
      `caption.description` stays empty. Both also go into the record.
- [ ] Persist the author name via `lib/storage.ts` (`STORAGE_KEYS.shareAuthor`) and pre-fill
      it on the next share.
- [ ] `cpShareService.ts` with typed `ShareRequestError` carrying status.
- [ ] Create → POST → show link → PUT thumbnail fire-and-forget; every thumbnail failure is
      a `console.warn` and never blocks the link.
- [ ] Copy button with copied state; clipboard failure selects the text (existing behaviour).
- [ ] Retention/privacy note replaces the long-link warning.
- [ ] Gate the entry points on a `__SHARE_ENABLED` flag (prod, or explicit dev opt-in) so
      local and preview builds cannot write to production.
- [ ] Share reachable wherever Export is, including whole-document (`segmentId: null`).
- [ ] i18n for every new string across all 8 locales; `npm run i18n:check` passing.

### Phase D — opening a link

- [ ] `path: 's/:shareId'` in the router; `ShareRoute` handles id and fragment.
- [ ] `main.tsx` reads the inlined `#shared-cp` blob at module scope.
- [ ] Retry path via `GET /api/cp/[id]` when the inline blob is absent, with **backoff on
      404 for ~60s** to absorb KV eventual consistency.
- [ ] New toast messages for not-found / create-failed / rate-limited.
- [ ] Verify `/s#<payload>` links still open — the regression that would strand every link
      already shared.

### Phase E — verification

- [ ] End-to-end in the browser: create a share, open it in a fresh profile, confirm the CP
      matches and the URL is clean.
- [ ] Card unfurls correctly in the Twitter/X card validator, the Facebook sharing debugger,
      Discord, and iMessage.
- [ ] Second thumbnail upload for the same id is rejected with 409.
- [ ] `npm run lint:web`, `npx tsc --noEmit`, `npm run test:web`, `npm run build:web`.
- [ ] Mark `implementation-plans/cp-url-compression.md` stage 4 as superseded by this plan,
      and record that the fragment-key scheme was rejected because crawlers cannot see a
      fragment.
- [ ] Record the measured PNG size and the corrected cost tables in the PR body.
