# SEO and search discoverability

## Goal

Make Ori Studio findable in Google — both by its own name and by the queries its
audience actually types ("online crease pattern editor", "origami crease pattern
software", "box pleating design tool", "flat foldability checker"). Today it is
findable by neither.

### What is actually wrong (measured 2026-08-20 against the live deploy)

1. **Every URL serves the same 1,159-byte shell.** `/`, `/welcome`, `/edit`,
   `/robots.txt` and `/sitemap.xml` all return an identical `index.html` whose
   body is an empty `<div id="root">`. A crawler that does not execute JS sees
   one `<title>` and one `<meta name="description">` for the entire site, and
   zero body text.
2. **`/robots.txt` and `/sitemap.xml` do not exist.** Both answer `200
   text/html` because of the SPA fallback documented in `public/_headers`. A
   status-code check cannot tell this from success — the same trap already
   recorded for the share-link smoke test.
3. **The site is effectively unindexed.** A quoted search for
   `"oristudio.pages.dev"` returns nothing for this site. The category query
   returns Oriedita, FoldLab, Origami Simulator, ORIPA and Box Pleating Studio —
   every peer tool except this one.
4. **The canonical points at a URL that redirects.** `index.html` declares
   `canonical → https://oristudio.pages.dev/`, but `/` client-redirects to
   `/welcome` via `startupRedirect` in `routing/appRouter.tsx`. The canonical URL
   and the URL that holds the content disagree.
5. **~1 MB of JS before first paint.** The main chunk is 3.27 MB raw / 988 KB
   brotli, plus 220 KB CSS (35 KB brotli), with no route-level splitting. Google
   indexes mobile-first — a throttled mobile render is the render it scores, and
   the landing page pulls the whole editor to show text and screenshots.
6. **The host is `*.pages.dev`** — a shared domain on the Public Suffix List,
   carrying no brand of its own.
7. **The name is contested.** `oristudio.app` is an active business — "ORI Studio
   · Digital Product & App Studio" — and `ori.studio` is a graphic design
   practice. Both are established, both are commercial, and both are closer to
   the everyday meaning of "studio" than we are. This does not block anything,
   but it does change the target: the bare query *"Ori Studio"* is a fight
   against two incumbents in an adjacent field. The winnable queries are
   *"ori studio origami"*, *"origami crease pattern editor"*, *"oriedita
   online"*, *"box pleating studio online"* — where the incumbents are not
   competing at all. Plan the titles, the JSON-LD and the domain around
   disambiguation rather than around the bare name.

The landing *copy* is not the problem. `components/landing/WelcomeLanding.tsx`
already says "crease pattern", "box pleating", "circle packing", "flat-foldable",
"Oriedita", "TreeMaker", "Box Pleating Studio", ".cp / .fold / .ori". None of it
reaches a crawler. This was called out as future work when the landing page
shipped — see the closing note in `welcome-landing-page.md`.

### Non-goal

This plan cannot promise a ranking, and any plan that does is lying. What it can
do is remove every reason Google currently *cannot* rank the site, and put
measurement in place so the next decision is made on data. Phase 5 (off-page) is
not code and is likely to matter as much as everything before it.

## Approach

Six phases, ordered so each one is worth shipping alone. Phases 1–2 are the ones
that change the situation from "invisible" to "indexable"; everything after is
compounding.

### Phase 1 — Be crawlable, and be measurable

Small, mechanical, unblocks everything else.

- **`public/robots.txt`.** A real file in `public/` wins over the SPA fallback,
  so adding it is the whole fix. Allow everything, point at the sitemap.
- **`sitemap.xml`.** List `/` only. Generating it in the post-build script
  (Phase 2) is preferable to a static file, so the origin lives in one place.
- **Canonical.** Consolidate on `/`. Prerender the landing there (Phase 2) and
  emit `canonical → /` on `/welcome` as well, so the duplicate folds into the
  stronger URL. This needs **no router change** — `/welcome` keeps working
  exactly as it does now.
- **`noindex` the app surfaces.** `/edit`, `/design` and `/simulate` are empty
  shells with nothing to rank; leaving them indexable invites Google to pick one
  as the site's representative page. Add `<meta name="robots" content="noindex">`
  to those routes' HTML.
- **`noindex` on `/s/*`.** A judgment call worth making deliberately: share
  pages have real per-share titles and OG cards, but no text — they are a canvas.
  Thin pages at volume are a liability, and OG cards work whether or not a page
  is indexed, so social sharing loses nothing. Reversible later if long-tail
  crease-pattern queries turn out to be worth chasing.
- **Google Search Console + Bing Webmaster Tools.** Verify via DNS or the
  `public/` verification file. This is how the rest of the plan gets graded, and
  its URL Inspection tool shows exactly what Googlebot rendered — the only
  direct read on whether Phase 2 worked.
- **`scripts/seo-smoke.mjs`,** run after deploy alongside `share-smoke.mjs`.
  Assert on **content**, never status: `/robots.txt` must be `text/plain` and
  must not contain `<!doctype`, `/sitemap.xml` must be XML, `/` must contain the
  landing's `<h1>` text. Every one of these returns a cheerful 200 while broken.

### Phase 2 — Get real HTML to the crawler

The core of the work: prerender the landing content into `dist/index.html` and
`dist/welcome/index.html` at build time.

**Why prerender rather than rewrite at runtime.** `functions/s/[[shareId]].ts`
already proves the runtime-rewrite approach works in this codebase, and it is the
right tool there because a share's metadata is only known per request. The
landing is the same bytes for everyone — pay for it once at build, get a
cacheable static asset, and keep it out of the Functions budget.

**Why prerender rather than trusting Google's renderer.** Google does execute
JS, so in principle the current SPA is indexable. In practice rendering is queued
separately from crawling, it is budgeted, and this page asks it to parse ~1 MB of
JS under COEP before a single word appears. Prerendering removes the dependency
on that pass entirely, and fixes every non-Google crawler at the same time.

**Mechanism.**

- `apps/web/scripts/prerender-landing.mjs`, a post-build step in the same shape
  as `scripts/verify-analytics-build.mjs`.
- Render the **existing** `Landing*` components with `renderToStaticMarkup` via a
  small `src/seo/StaticLanding.tsx` composition. Same components as the live page
  means the crawler HTML and the React HTML cannot drift — the same discipline
  `_lib/cpShareHtml.ts` follows by importing `shareCardText` rather than
  restating it.
- Inject the markup into a `<div id="seo-content">` **sibling** of `#root`, and
  remove it in `main.tsx` before `createRoot`. No hydration, no mismatch warning,
  no duplicated content after boot. This is not cloaking: the words are identical
  to what the user sees, and it is removed only because React re-renders the same
  thing.
- Reuse `_lib/cpShareHtml.ts`'s `setMetaTag` / `setDocumentTitle` helpers rather
  than writing a second HTML rewriter. They already handle this exact
  `index.html`, attribute order and all.

**Three constraints found while checking prerender-safety:**

- `LandingFigure` reads `import.meta.env.BASE_URL`, so the prerender must run
  through Vite's SSR pipeline (`vite build --ssr` for a prerender entry, or
  `ssrLoadModule`), not raw Node.
- `LandingFigure` also picks its screenshot from the theme store. The prerender
  must pick one — light — and it barely matters for SEO, where the `alt` text is
  the indexable part.
- The `t()` calls need a synchronous English bundle. English defaults are inline,
  so an i18next instance initialised from `public/locales/en/landing.json` covers
  it. `i18n:check` already guarantees those are in sync with source.

**Also in this phase:**

- Per-route `<title>` and `<meta name="description">`. "Ori Studio" alone is a
  wasted title on the one page that can rank — something like *"Ori Studio —
  free online origami crease pattern editor and folding simulator"*.
- `twitter:card` / `twitter:image` on the landing. The share route sets these per
  share; the site root does not set them at all.
- **`SoftwareApplication` JSON-LD** on the landing: `name`, `description`,
  `applicationCategory`, `operatingSystem: "Web"`, `offers` at price 0, `sameAs`
  → GitHub and Discord. This is the strongest available signal for "there is a
  free web app called Ori Studio", which is precisely what a branded query needs
  in order to resolve to an entity.
- The OG image is 1000×525. The 1.91:1 ratio is right; 1200×630 is the size every
  platform actually asks for. Cheap to regenerate.

#### How the prerender is wired in

**It is a `postbuild` hook in `apps/web/package.json`, not a workflow step.**

```json
"postbuild": "node scripts/prerender-landing.mjs"
```

This is the same call the repo already makes for wasm with `prebuild`, and for
the same reason. If the prerender lived only in `deploy-web.yml`, then a local
`npm run build:web` would produce a `dist` that differs from the deployed one —
and the first sign of a broken prerender would be a silent deploy. That is
precisely the rot AGENTS.md documents for `apps/web/src/generated/`: an artifact
that is a *build output* has to be produced by the build.

A `postbuild` hook is picked up by all four consumers with no further wiring:

| Consumer | How it gets there |
| --- | --- |
| Prod deploy | `deploy-web.yml` → `npm run build:web` |
| PR preview | `deploy-pr-preview.yml` → `npm run build:web` |
| Desktop | `tauri.conf.json` `beforeBuildCommand` → `scripts/build-frontend.mjs` → `npm run build` |
| Local | `npm run build:web` |

Four consequences, all of which need a decision rather than a discovery:

1. **The desktop build gets prerendered HTML too.** Harmless — `main.tsx` drops
   `#seo-content` before `createRoot`, and the memory router never requests
   `dist/welcome/index.html`. A few KB of dead markup in the bundle is not worth
   a conditional. Leave it, and say so in the script's header comment.
2. **`--ignore-scripts` silently skips it.** CI passes that flag to the typecheck
   and test steps, which build no `dist`, so it does not matter there — but
   `npm run build:web --ignore-scripts` would produce an un-prerendered bundle
   with no error. Same footgun class as the stale-wasm one; worth a line in
   AGENTS.md next to the existing wasm note.
3. **CI never builds `dist`.** The `web-client` job lints, i18n-checks,
   typechecks and tests — it does not run `build:web`. So nothing today would
   fail a PR that broke the prerender. Rather than adding a full `vite build` to
   every PR, cover it the way the share feature is already covered: a **vitest
   test** that renders `StaticLanding` to markup and asserts each landing section
   heading is present (cheap, runs in `test:web`, catches "throws" and "renders
   nothing"), plus **`seo-smoke.mjs`** after deploy for the served bytes. That is
   the `cpShare.test.ts` + `share-smoke.mjs` pairing, applied here.
4. **PR previews must not be indexed.** They are public URLs serving the same
   prerendered marketing copy as production — duplicate content on a crawlable
   host. Have the prerender script emit `robots.txt` with `Disallow: /` unless
   `ORI_SITE_ENV=production`, and set that variable **only** in
   `deploy-web.yml`. Absence means disallow, matching the "absence = disabled"
   firewall the PostHog and Sentry config already use. The canonical always
   points at the production origin, which is a second, independent guard.

The script itself must fail the build if the injection did not happen. A
prerender that quietly writes the original HTML back is indistinguishable from
success at every later step — the same reasoning behind the existence check in
`build-frontend.mjs` and the assertion in `verify-analytics-build.mjs`.

### Phase 3 — Custom domain

The highest-ceiling item in the plan, and the only one that needs a purchase
decision rather than a commit.

`pages.dev` is a shared host on the Public Suffix List: it carries no brand, and
a project subdomain on it is a weak entity signal for exactly the query this plan
is trying to win. Moving *after* accumulating inbound links costs a redirect and
a re-index, so this belongs **before** Phase 5, not after.

**Availability and price, checked 2026-08-20** (RDAP for availability, Cloudflare
Registrar for price — at-cost, no markup, free WHOIS privacy, and the account is
already there):

| Domain | Status | Reg / renew |
| --- | --- | --- |
| `oristudio.org` | **available** | $8.50 / $11.20 |
| `oristudio.dev` | **available** | $12.20 |
| `oristudio.tools` | available | $28.20 |
| `oristudio.studio` | available | $31.20 |
| `oristudio.design` | available | $45.20 |
| `oristudio.io` | available | $50.00 |
| `oristudio.art` | available | not sold by Cloudflare |
| `creasepattern.org` / `.app` | available | $8.50 / $14.20 |
| `oristudio.com` | taken, does not resolve | — |
| `oristudio.app` | taken — **the ORI Studio app agency** | — |
| `ori.studio` | taken — a graphic design practice | — |
| `oristudio.net` | taken, "Coming Soon" placeholder | — |
| `origami.studio`, `creasepattern.com` | taken | — |

**Chosen and registered: `oristudio.dev`** ($12.20/yr, Cloudflare Registrar,
registered 2026-09-01). Finding 7 above is why the TLD matters more than usual
here: the two entities already holding this name are commercial design studios
sitting on `.app` and `.studio`, so those two were the ones to avoid. `.dev`
reads as software rather than as a design practice, which is the separation the
branded query needs.

Google treats all these gTLDs identically for ranking — there is no `.com`
bonus. The choice was entirely memorability and disambiguation.

**Wrangler cannot attach it.** There is no `wrangler pages domain` command —
`wrangler pages` exposes only `dev`, `functions`, `project` (list/create/delete),
`deployment`, `deploy`, `secret` and `download`. Attaching a custom domain to a
Pages project is a dashboard or REST-API action, so this one step is Zach's:

> Cloudflare dashboard → Workers & Pages → **oristudio** → Custom domains →
> *Set up a custom domain* → `oristudio.dev`.

The zone is already in the same account (`oristudio.dev` resolves to
`aryanna.ns.cloudflare.com` / `david.ns.cloudflare.com` and currently has no
A/CNAME), so Pages provisions the DNS record and the certificate itself. Note
also that the OAuth token wrangler holds is scoped `zone (read)` — it could not
write a DNS record even via the API, which matters again for the Search Console
TXT record in Phase 1.

Work once bought: add it in Pages, keep `oristudio.pages.dev` serving a 301, and
audit every place the origin is written down — `index.html` (canonical +
`og:url`), the generated sitemap, `functions/_lib/cpShare.ts`
(`shareUrl`/`thumbnailUrl` build absolute URLs), `scripts/share-smoke.mjs`,
`deploy-web.yml`'s `--alias`, `README.md`'s badge and link. Re-verify in Search
Console under the new property and run the Change of Address tool.

### Phase 4 — Make the landing fast

988 KB brotli of JS before first paint, on a page whose whole job is text and
screenshots. Core Web Vitals are a real ranking input and this is the render
Google scores.

- **Route-level code splitting.** `React.lazy` the workspace shell in
  `appRouter.tsx` so `/welcome` loads the landing and nothing else. Dockview,
  Lexical, three.js and the simulator have no business on the marketing page.
  This is the whole phase, more or less — the wasm bridges are already isolated
  in workers and are not in the main chunk.
- Explicit `width`/`height` on the landing figures (CLS), `loading="lazy"` below
  the fold, `fetchpriority="high"` on the LCP image.
- Measure with Lighthouse against the **deployed** build. A local dev measurement
  proves nothing here.

### Phase 5 — Off-page (not code, and probably decisive)

Google ranks pages that other pages link to. A site with no inbound links does
not rank for a competitive query no matter how clean its HTML is. In rough order
of value:

- **`oriedita/awesome-origami`** — a PR adding Ori Studio. Topically exact, and
  its readership *is* the audience. Single highest-value link available.
- **The GitHub repo.** Set the description, set the website field to the app URL,
  and add topics (`origami`, `crease-pattern`, `treemaker`, `box-pleating`,
  `oriedita`, `fold`). `github.com/topics/origami` is itself indexed and ranks.
- **Communities**: r/origami, the origami Discords, Origami-L, BOS and
  OrigamiUSA. Announce honestly, once, with a link.
- **Lean on the ports.** "Oriedita in the browser", "Box Pleating Studio online",
  "TreeMaker for the web" are queries with existing demand and no good answer.
  The compatibility section already makes this claim truthfully; the titles and
  descriptions from Phase 2 should let those queries find it.

### Phase 6 — Optional: localized landing pages

`public/locales/` already carries eight translated locales including the
`landing` namespace, so prerendering `/{lng}/` variants with `hreflang` is mostly
plumbing — and Japanese origami search volume is not small.

Deliberately last, and genuinely optional: done wrong this produces thin
duplicate pages and is a net negative. Only start it once Phases 1–5 have landed
and Search Console shows the English page indexed and ranking for something.

## Affected Areas

**New**

- `apps/web/public/robots.txt`
- `apps/web/scripts/prerender-landing.mjs` (+ test)
- `apps/web/src/seo/` — `StaticLanding.tsx`, JSON-LD builder, per-route meta helper
- `scripts/seo-smoke.mjs` (+ test, alongside `scripts/share-smoke.mjs`)

**Changed**

- `apps/web/index.html` — canonical, Twitter card tags, `#seo-content` container
- `apps/web/src/main.tsx` — drop `#seo-content` before `createRoot`
- `apps/web/src/routing/appRouter.tsx` — lazy workspace shell (Phase 4)
- `apps/web/src/components/landing/LandingFigure.tsx` — intrinsic size, loading hints
- `apps/web/package.json` — `postbuild` prerender hook
- `.github/workflows/deploy-web.yml` — `ORI_SITE_ENV=production`; run `seo-smoke.mjs`
- `.github/workflows/deploy-pr-preview.yml` — run `seo-smoke.mjs` in preview mode
- `AGENTS.md` — a line beside the existing wasm note: `--ignore-scripts` skips the
  prerender too
- `apps/web/functions/_lib/cpShare.ts` — `noindex` on share pages; origin (Phase 3)
- `apps/web/public/og-default.png` — regenerate at 1200×630
- `README.md`, `apps/web/wrangler.toml` — domain (Phase 3)

**Deliberately unchanged**

- `apps/web/public/_headers` — do **not** add `404.html`. The warning there is
  load-bearing: Pages would serve it instead of `index.html` for unmatched paths
  and break every share link.
- `crates/**` — no engine or parity surface is involved in any of this.

## Checklist

### Phase 1 — Crawlable and measurable

- [x] Add `apps/web/public/robots.txt` (allow all, `Sitemap:` line)
- [x] Add `sitemap.xml` listing `/` only — static; folds into the prerender script in Phase 2
- [x] Point the canonical at `/` (and `og:image` / `twitter:*`, which the root had never set)
- [x] `scripts/seo-smoke.mjs` asserting on content type and body, not status
- [x] Wire the smoke script into `deploy-web.yml`
- [ ] `noindex` on `/edit`, `/design`, `/simulate` — needs per-route metadata, so Phase 2
- [ ] Decide and apply `noindex` on `/s/*`
- [ ] Verify the property in Google Search Console; submit the sitemap *(needs Zach)*
- [ ] Verify in Bing Webmaster Tools *(needs Zach)*

### Phase 2 — Real HTML for crawlers

- [ ] `src/seo/StaticLanding.tsx` composing the existing `Landing*` components
- [ ] `scripts/prerender-landing.mjs` via Vite SSR, reusing `cpShareHtml` helpers
- [ ] Inject `#seo-content`; remove it in `main.tsx` before `createRoot`
- [ ] Prerender both `dist/index.html` and `dist/welcome/index.html`
- [ ] Landing `<title>` and description written for the target query
- [ ] `twitter:card` / `twitter:image` on the landing
- [ ] `SoftwareApplication` JSON-LD, validated in the Rich Results Test
- [ ] Regenerate `og-default.png` at 1200×630
- [ ] Wire it up: `postbuild` hook in `apps/web/package.json`
- [ ] Script fails the build when injection did not happen
- [ ] `ORI_SITE_ENV=production` in `deploy-web.yml`; `Disallow: /` robots.txt otherwise
- [ ] Test: prerendered HTML contains each landing section heading (vitest, PR gate)
- [ ] Test: booting the app removes `#seo-content` exactly once
- [ ] Note the `--ignore-scripts` interaction in AGENTS.md
- [ ] Confirm via Search Console URL Inspection that Googlebot sees the copy

### Phase 3 — Custom domain

- [x] Register `oristudio.dev` (Cloudflare Registrar, 2026-09-01)
- [x] Update canonical, `og:url`, `og:image`, `twitter:*`, `robots.txt`, `sitemap.xml`, `README.md`
- [x] Confirm `cpShare.ts` needs no change — `shareUrl`/`thumbnailUrl` take the origin
      from `new URL(request.url).origin`, so share links follow whatever host serves them
- [ ] **Attach `oristudio.dev` to the `oristudio` Pages project** *(needs Zach — dashboard
      only; wrangler has no `pages domain` command)*
- [ ] Merge this branch **after** the domain is attached — until then the canonical points
      at a host that does not resolve
- [ ] 301 `oristudio.pages.dev` → `oristudio.dev` (Pages redirect rule)
- [ ] Switch `deploy-web.yml`'s `--alias` to `https://oristudio.dev` once it resolves —
      left on `pages.dev` for now so the deploy does not fail against a dead host
- [ ] Re-verify in Search Console; run the Change of Address tool

### Phase 4 — Performance

- [ ] Lazy-load the workspace shell so `/welcome` does not pull the editor
- [ ] Measure the landing chunk before and after; record both numbers
- [ ] Intrinsic `width`/`height` on landing figures; lazy below the fold
- [ ] Lighthouse mobile against the deployed build; record LCP/CLS/INP

### Phase 5 — Off-page

- [ ] PR to `oriedita/awesome-origami`
- [ ] GitHub repo description, website field, topics
- [ ] Announce in r/origami and the origami Discords
- [ ] Origami-L / BOS / OrigamiUSA where appropriate

### Phase 6 — Localized pages (only after 1–5 land)

- [ ] Decide whether Search Console data justifies it
- [ ] Prerender `/{lng}/` for the eight existing locales
- [ ] `hreflang` + `x-default`; add the alternates to the sitemap

### Validation

- [ ] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [ ] `npm run build:web`, then confirm the prerendered HTML in `dist/` by hand
- [ ] `npm run test:scripts` for the new `scripts/*.test.mjs`
- [ ] `npm run typecheck:functions` if `functions/` is touched — **it is not in
      CI**, so it has to be run by hand
- [ ] Re-run the Phase 1 measurements against the deploy and record the deltas
