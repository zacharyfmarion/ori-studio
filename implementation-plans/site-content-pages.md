# Site content pages

## Goal

Give Ori Studio more than one indexable URL.

Today the site is one page. `oristudio.dev/sitemap.xml` lists a single entry, by
design: every route serves the same `dist/index.html` under `canonical → /`,
which is what `seo-discoverability.md` Phase 1 chose in order to consolidate
ranking. That decision was right for a site with one thing to say, and it is now
the constraint.

Two things follow from having only one URL, and only the first is about search:

1. **No sitelinks.** The sub-link list under a competitor's result — Oriedita's
   Download / Getting Started / Orihime / FAQ — is drawn from indexed pages.
   `oriedita.github.io/sitemap.xml` lists 8 URLs. Sitelinks are algorithmic, so
   more pages is **necessary but not sufficient**; this plan cannot promise them.
2. **No long-tail surface.** "ori studio download", "oriedita online", "how to
   get started with ori studio" have nowhere to land. The SEO plan named
   "oriedita online" as a query with existing demand and no good answer. That is
   the part this plan can actually bank on.

Four new pages: `/getting-started`, `/download`, `/oriedita`, `/faq`. Five URLs
with `/`.

### Non-goals

**Localized URLs.** Page bodies are translated across all eight locales, but each
page prerenders to one English URL. `hreflang` variants remain Phase 6 of
`seo-discoverability.md`, deliberately last.

**`/box-pleating` and `/treemaker`.** Considered and dropped for now (2026-09-13).
The SEO plan names "box pleating studio online" and "treemaker for the web" as
queries with demand and no answer, so they are the obvious next two — but each
is a page's worth of prose in eight locales, and the registry below makes adding
one later a matter of writing it, not of plumbing. Revisit once the first four
are indexed and Search Console shows what they rank for.

## Approach

The prerender already does the hard part. `prerender-landing.mjs` renders a React
tree to static HTML through Vite SSR and writes `dist/welcome/index.html` as a
real directory index — Pages serves it in preference to the SPA fallback, which
is why `/welcome` 308s to `/welcome/`. Writing `dist/download/index.html` is that
same call in a loop.

What does not exist is everything that makes *more than one* page coherent.

### The four failures this has to design against

Each of these ships a 200 with well-formed HTML and says nothing.

**1. There is no per-page metadata, and the canonical is hardcoded.**
`index.html` carries one `<title>`, one `<meta name="description">` and
`<link rel="canonical" href="https://oristudio.dev/">`. Emit six pages carrying
that canonical and Google is told all six *are* the homepage; it consolidates
them straight back into `/` and the docs site is invisible. **This is the
central trap and the reason the metadata registry comes before any page.**

**2. A prerendered file is not a route.** Pages serves `/download/index.html`, so
the crawler is satisfied — then React boots, the router matches nothing, and
`{ path: '*', loader: startupRedirect }` bounces the reader to `/welcome`. The
page renders and vanishes. Every prerendered path needs a real route.

**3. `useWindowTitle` will clobber every one of these titles.** It titles the
window after the open project, which on a content route is the blank one the
store holds. That is exactly the "Ori Studio: Untitled" defect
(`seo-discoverability.md` Phase 2a), and the `landing` flag added there fixes one
path. It has to generalize, or six pages each index as `Untitled - Ori Studio`.

**4. Prose is user-facing text, so `i18n:check` owns it.** Every string needs an
inline English default plus eight translations, enforced in CI. Chosen
deliberately (the alternative was Markdown outside `t()`), so the cost is real
and the plan sequences around it: **each page ships with its own translations**,
never a batch at the end.

### Design

**One registry, and everything reads from it.** `src/site/sitePages.ts` exports
an ordered list of `{ path, title, description, Component }`. The router builds
routes from it, the prerender iterates it, the sitemap is generated from it, and
`useWindowTitle` looks a path up in it. A page added in one place cannot be
half-added — which is failure 2 and 3 closed structurally rather than by
remembering.

The landing is an entry in this list, at `/`. It is not a special case; it is the
page that happens to also write `dist/index.html` and `dist/welcome/index.html`.

**Titles and descriptions are English constants, not `t()` calls.** The bodies
are localized; these two fields are not. Two reasons. `SITE_TITLE` is already a
constant, so this is consistent rather than novel; and a localized `document.title`
would mean the runtime writes a *different* title over the prerendered one, which
is the shape of the bug in Phase 2a even when the strings happen to agree for an
English crawler. Revisit alongside `hreflang`, where localized titles belong.

**One HTML rewriter, shared.** `functions/_lib/cpShareHtml.ts` already has
`setMetaTag` and `setDocumentTitle` doing exactly this string surgery, and the SEO
plan called for reusing them rather than writing a second one. Extract to
`src/seo/htmlMeta.ts` — a leaf, importable from the build script and the Worker —
and have both call it. Writing a second rewriter is how the two drift.

**A real nav, in the prerendered markup.** Sitelinks are chosen from pages Google
can find and label. Pages that exist but are linked from nothing are pages Google
has little reason to surface, so a header or footer linking all five with
descriptive anchor text is load-bearing for the goal, not decoration.

**Content routes are web-only.** The same `dist` ships inside Tauri on a memory
router, where a Download page is nonsense and Help already exists. The router
builds these routes only when `getRuntimeSurface() !== 'desktop'`.

### Adjacent, and worth doing at the same time

`seo-discoverability.md` Phase 4 — `React.lazy` the workspace shell — is
unstarted, and every one of these pages currently pulls ~1 MB of editor to show
text. It is not on this plan's critical path, but a docs site is the point at
which it stops being theoretical.

## Affected Areas

**New**

- `apps/web/src/site/sitePages.ts` — the registry
- `apps/web/src/site/SiteLayout.tsx`, `SiteNav.tsx` — shared chrome and the nav
- `apps/web/src/site/pages/` — one component per page
- `apps/web/src/seo/htmlMeta.ts` — the shared `<head>` rewriter
- `apps/web/public/locales/<lng>/site.json` — new namespace, eight locales

**Changed**

- `apps/web/scripts/prerender-landing.mjs` — iterate the registry; rewrite title,
  description, canonical and `og:url` per page
- `apps/web/src/seo/siteMeta.ts` — `SITEMAP_PATHS` derived from the registry
- `apps/web/src/routing/appRouter.tsx` — routes from the registry, web-only
- `apps/web/src/routing/paths.ts` — `isLandingPath` generalizes to a registry lookup
- `apps/web/src/platform/windowTitle.ts` — `landing: boolean` becomes
  `pageTitle?: string`, which the registry supplies
- `apps/web/functions/_lib/cpShareHtml.ts` — call the extracted rewriter
- `scripts/seo-smoke.mjs` — assert each page's served copy and canonical

**Deliberately unchanged**

- `apps/web/public/_headers` — still no `404.html`; the SPA fallback is what every
  share link depends on
- `canonical → /` on the *app* routes (`/edit`, `/design`, `/simulate`). Those are
  shells with nothing to rank and consolidating them was correct

## Checklist

### Phase 1 — Infrastructure, proven with one page

Nothing here is visible; all of it is what makes page two onward safe.

- [x] `src/site/sitePages.ts` with the landing and `/download/` — data only; the
      components are keyed by id in `sitePageContent.tsx`, whose `Record` type is
      what refuses a page with nothing behind it
- [x] Extract `src/seo/htmlMeta.ts` from `cpShareHtml.ts`; both call it
- [x] Prerender iterates the registry, writing per-page title/description/canonical/
      `og:url` — the assembly moved into `src/seo/prerenderHtml.ts` so it is testable
      without a Vite server; the script only loads the template and writes files
- [x] `SITEMAP_PATHS` derived from the registry (and out of `siteMeta.ts`, which has
      to stay a leaf for the share Worker)
- [x] Routes built from the registry, skipped on desktop
- [x] `windowTitle` takes `pageTitle`; `useWindowTitle` resolves it from the registry.
      `isLandingPath` retired — the registry answers the question it asked
- [x] `SiteHeader` + `SiteNav` + `SiteFooter`; the footer on the landing too (in
      `WelcomeRoute` and `StaticLanding` both — `WelcomeLanding` stays a pure block
      of copy with no router dependency), because a crawler on the homepage has to
      find the other pages from *somewhere*
- [x] Tests, one per failure above:
      canonical of `/download/` is `/download/` and **not** `/` (mutation-checked);
      every registry path resolves to a route, with and without its slash, and
      none on desktop; `useWindowTitle` yields each page's title;
      every entry has a unique path, a title ≤ 60 chars, and a description
- [x] `/download/` content + `site.json` across eight locales; `i18n:check` passes
- [x] `site page viewed` event, from the route component
- [x] `seo-smoke.mjs` asserts `/download/` carries its own canonical and not the
      homepage's — the one assertion the landing's checks cannot make

**Learned building it.** The content path is `/download/` *with* the slash, in the
registry and everywhere else. The prerender writes `dist/download/index.html`,
and Pages 308s `/download` to `/download/` for a directory index — so the slash
form is the URL that returns 200, and the one a canonical must name. (`vite
preview` does not redirect; it serves the bare form from the SPA fallback and lets
React render the page, which is fine for a person and is why the smoke test asks
for the slash.) React-router matches both, and `sitePageForPath` normalises.

### Phase 2 — The remaining three

One PR each, so translation lands with its page. `/download` goes first in
Phase 1 not because it matters most but because it is the shortest — a handful
of links and platform notes — which makes it the cheapest page to prove the
plumbing on before the prose-heavy ones commit eight locales' worth of text to
that plumbing.

- [ ] `/oriedita` — "Oriedita in your browser". Folds in
      `docs/coming-from-oriedita.md`, which is already written
- [ ] `/getting-started` — the longest page here; write it after the pattern is
      settled by the two above
- [ ] `/faq` — from questions actually asked in Discord and issues, not invented

### Phase 3 — Measure

- [ ] `seo-smoke.mjs` covers every page after deploy
- [ ] Submit the new sitemap in Search Console *(needs Zach)*
- [ ] Record which pages get indexed, and whether sitelinks appear *(needs Zach)*
