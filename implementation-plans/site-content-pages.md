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

### Phase 2 — Localized pages, every locale the app ships

Pulled forward from `seo-discoverability.md` Phase 6, where it sat as "optional,
last" (2026-09-21). The case that moved it is China: nearly half the audience
is there, and Google does not exist there — search is Baidu, then Bing. Baidu's crawler is far weaker
at JavaScript than Google's — the safe assumption is that it reads the raw HTML
and nothing else — and the raw HTML is English:

```
$ curl -sS https://oristudio.dev/ | grep -oE '<html[^>]*>'
<html lang="en">
$ curl -sS https://oristudio.dev/ | grep -c "折纸"
0
```

A Chinese visitor *does* get a Chinese page — the app switches to zh-CN after
JS runs, from the browser language — but on the same URL and after the render
pass Baidu does not do. So for a Chinese query the site has an English page to
rank against Chinese content, and it does not. The content is not the gap: the
zh-CN catalogs already cover the landing, the site pages and the whole app.
The gap is that no URL *is* the Chinese page.

**Scope: all eight non-English locales, from the start.** The machinery is a
list — every code in `SUPPORTED_LOCALES` but `en` — so eight cost what one
costs, and the app already ships every one of these catalogs to its users; a
page is those same strings on a URL. The first draft of this phase said "zh-CN
first, the rest after a native read", which was a quality pass dressed up as a
gate: the read is worth doing, in audience order (zh-CN, then ja), and it does
not decide whether the URL exists.

**URLs.** A locale prefix on site pages only: `/zh-CN/`, `/zh-CN/download/`,
`/fr/`, `/fr/download/`, and so on — the app's own codes verbatim, so `zh-CN`
and `pt-BR` keep their region (which tells Baidu *simplified*, and a Brazilian
reader that this is theirs). The app routes (`/edit`, `/design`,
`/simulate`) take no prefix: nothing indexes them, and forcing their UI language
from the URL would regress every Chinese user who lands on `/edit` from a link.
The unprefixed site pages keep following the browser, as they do today: a
Chinese reader arriving at `/` from a community link still sees Chinese. The
crawlers all send English, so `/` renders English for them, and `hreflang` is
what sends a Chinese *searcher* to `/zh-CN/` instead.

**The route locale is an override, not a preference.** While on a `/zh-CN/*`
route the UI is zh-CN whatever the stored preference says; leaving to `/edit`
restores the preference. Visiting a Chinese page must not silently pin Chinese
for an English-system reader who followed a link out of curiosity.

**Titles and descriptions become `t()` calls** — the constants in the registry
were an explicit "revisit alongside `hreflang`", and this is that. Literal keys
in switch helpers beside `sitePageLabel`, English defaults inline, and a test
that the English default still equals `SITE_TITLE` (which `siteMeta.ts` keeps,
because it has to stay a leaf for the share Worker). This is safe *because* the
locale is in the URL: the runtime title on `/zh-CN/download/` and the
prerendered `<title>` there come from the same key with the same catalog
loaded. On the unprefixed URL a Chinese-browser human gets a Chinese tab over an
English `<title>`, which is the right tab for them and invisible to any crawler.

**Prerender per locale.** `renderPageMarkup(page, locale)`: the prerender's
i18n instance loads `public/locales/<locale>/*.json` for a non-English locale
and stays resourceless for English, so English keeps rendering the inline
defaults and cannot drift. Each localized file gets `<html lang="…">` (the
template hardcodes `en`; one more `htmlMeta` rewrite), the localized title and
description, a canonical to *itself* — a translation is a different page, not a
duplicate — `og:locale` in its `ll_CC` form, and the full `hreflang` set: all
nine languages plus `x-default → en`, on every one of the nine files. Baidu
ignores `hreflang` and reads `lang` and the words; Bing and Google use it.
Nine locales × the pages in the registry is the file count; today that is 18.

**Discovery is links, again.** A crawler finds `/fr/download/` by following a
link to it. The footer gains a language switch — every locale by its native
name, `nativeName` from `SUPPORTED_LOCALES`, each pointing at the same page in
that locale, on every page in every locale. Real anchors, not a `<select>`:
a crawler follows an `href` and cannot operate a control. `SiteNav` links stay
within the current locale; the masthead's "Open the app" goes to the
unprefixed `/edit`. The sitemap lists every locale's URL.

**What this cannot do.** Two things only Zach can:

- **Baidu Webmaster Tools** (百度站长平台) is where the sitemap is submitted and
  URLs pushed; registration has required a mainland phone number. Without it
  Baidu still crawls through links, slowly. **Bing Webmaster Tools** has no
  such friction and is already a checklist item.
- **A native read of each locale's copy**, in audience order — zh-CN, then ja —
  since it is the text a searcher judges the site by. The catalogs were
  machine-translated and have had no native review. The title and description
  matter most, and so does the vocabulary: the Chinese says 展开图 for crease
  pattern, and the community also says CP图 and 折痕图; which dominates is not a
  call to make from here. This does not gate the URLs: the app has been showing
  these strings all along.

- [x] `SITE_LOCALES` (every supported code but `en`), `sitePageForPath`
      returning `{ page, locale }`, `pagePath(page, locale)` everywhere a path is
      built
- [x] Route locale override (`useRouteLocale` under a `SiteLocaleRoute` per
      locale): `/<locale>/` renders the landing and `/<locale>/download/` the
      page, in that language, whatever the stored preference; restored on
      leaving. The URL sync and the discard guard now recognise a site page
      rather than two hardcoded paths — the localized landing renders the start
      screen, which sets the workspace on arrival and was bounced to `/design`
- [x] Titles/descriptions as literal-key `t()` helpers; English defaults asserted
      equal to the `siteMeta` constants; every locale's title asserted ≤ 60 and
      not the English one
- [x] Prerender with each locale's catalogs read from `public/locales` (English
      stays resourceless, so it cannot drift from the inline defaults); `lang`,
      canonical-to-self, `og:locale`, the full `hreflang` set with `x-default`;
      sitemap lists every locale — 18 files today
- [x] Footer language switch, every locale by native name, with `hreflang` and
      `lang` on each anchor; nav and masthead links locale-aware
- [x] Tests, one per failure, run over every locale (109 in the prerender suite
      alone): `/<locale>/download/` carries that locale's words and none of the
      English copy, the right `lang` (mutation-checked: 16 fail without it), a
      canonical to itself and not to the English page, a complete `hreflang` set
      naming all nine; every locale path resolves to a route and an unknown
      prefix does not; the window title there is the localized title; the
      override does not persist past the route
- [x] `seo-smoke.mjs` asserts `/zh-CN/` and `/ja/download/` carry their language
      and their own canonical on the real host

**Found by the window-title test, and worth more than the rest of the phase:**
`zh-CN` and `pt-BR` had never rendered. `nonExplicitSupportedLngs: true` in
`src/i18n/index.ts` — there since the i18n infrastructure landed — makes i18next
compare only the *language part* of a code against `supportedLngs`, and `zh` and
`pt` are not in a list that holds `zh-CN` and `pt-BR`. Both were rejected as
unsupported and resolved to English: a Chinese reader got an English app under
`<html lang="zh-CN">`. The six region-free locales never hit it, which is how a
full translation pass and a Japanese visual sweep both looked fine. The app's
own `normalizeLocale` already maps every browser code onto an exact supported
code, so the option was doing nothing but harm; it is `false` now, with a test
over every supported code. Confirmed in the browser before and after.
- [ ] Native review of the zh-CN copy, then ja *(needs speakers — not Zach's
      call to make alone either)*
- [ ] Bing Webmaster Tools: verify, submit the sitemap *(needs Zach)*
- [ ] Baidu Webmaster Tools, if an account is obtainable *(needs Zach)*

**Adjacent, found while looking, not in scope.** Discord is blocked in China,
so "Join the Discord" on the landing and in the footer is a dead link for half
the audience; the Chinese origami community is on Bilibili, QQ and WeChat, and
where to be is a product decision. Downloads come from github.com, which is
slow and unreliable from China; the release assets could be mirrored to the
Cloudflare R2 bucket the CP-detect models already publish to.

### Phase 3 — The remaining three English pages, each with its Chinese twin

One PR each, so translation lands with its page. `/download` went first in
Phase 1 not because it matters most but because it is the shortest — a handful
of links and platform notes — which makes it the cheapest page to prove the
plumbing on before the prose-heavy ones commit eight locales' worth of text to
that plumbing. From Phase 2 on, a page ships in English and zh-CN together.

- [ ] `/oriedita` — "Oriedita in your browser". Folds in
      `docs/coming-from-oriedita.md`, which is already written
- [ ] `/getting-started` — the longest page here; write it after the pattern is
      settled by the two above
- [ ] `/faq` — from questions actually asked in Discord and issues, not invented

### Phase 4 — Measure

- [ ] `seo-smoke.mjs` covers every page after deploy
- [ ] Submit the new sitemap in Search Console and Bing Webmaster Tools *(needs Zach)*
- [ ] Record which pages get indexed, and whether sitelinks appear *(needs Zach)*
- [ ] PostHog: referrers and search engines for country = CN, before and after —
      the number that says whether Chinese search became a channel *(needs the
      PostHog connector, or Zach)*
