# Landing Page Performance (PageSpeed)

## Goal

Make `https://oristudio.dev/` (which lands on `/welcome`) fast on PageSpeed
Insights, desktop and mobile, without changing what the landing does. Then make
sure it cannot quietly get slow again.

This replaces Phase 4 of `seo-discoverability.md`. That phase predicted the main
problem, the bundle, but did not have the measurements below. Three of the
causes it did not know about are as large as the bundle.

### Measured 2026-09-23 against production

Measured with Lighthouse 13.5.0, the engine PageSpeed runs, using the same
presets (`--preset=desktop` and the default mobile preset). The saved PSI report
could not be opened from the agent session: the keyless PSI API has a quota of
0. So these numbers are a local reproduction. PSI's lab machines are slower than
the M-series Mac these ran on (benchmarkIndex ≈ 2,900), so **PSI's TBT will be
higher than the figures here**. Scores vary a lot between runs, as the three
desktop runs show.

|                      | Desktop (3 runs)   | Mobile (2 runs) |
| -------------------- | ------------------ | --------------- |
| Performance          | 70 / 86 / 87       | 49 / 48         |
| FCP                  | 1.3–1.5 s          | 7.1 s           |
| LCP                  | 1.5–2.1 s          | 8.3 s           |
| TBT                  | 40–340 ms          | 390–420 ms      |
| CLS                  | 0                  | 0.002           |
| Speed Index          | 1.3–1.6 s          | 7.1 s           |
| Accessibility        | 97                 | 96              |
| Best practices / SEO | 100 / 100          | 100 / 100       |
| Bytes on first view  | 4.3 MB             | 5.2 MB          |

### What is actually wrong

1. **Nothing paints until the whole app has run.** The prerendered landing
   (`#seo-content`) is deleted before first paint by an inline script
   (`src/seo/prerenderHtml.ts:75`). That was deliberate: someone who turned off
   "Show welcome on startup" lands on `/` and must not see the marketing page
   flash before the editor. The cost is that every visitor gets a blank
   background until the entry chunk has downloaded and evaluated and React has
   rendered.
   - Observed: first paint at 202 ms is background only. FCP = LCP = 575 ms,
     which is *after* DOMContentLoaded (472 ms).
   - Lighthouse's simulation (Lantern) therefore charges the whole bundle to
     FCP and LCP, which is how mobile reaches 7.1 s and 8.3 s.
   - The LCP element is the start screen's `<h1>` ("Start a new origami
     workspace"). The prerender does not contain it: `StaticLanding` renders
     only `WelcomeLanding` and the footer.
   - That copy is also why the flash looked broken, which is why the inline
     removal was added. With JS disabled, today's copy differs from the page
     React renders in **82% of pixels on desktop and 81% on a phone**
     (Playwright screenshots, ImageMagick `compare -fuzz 2%`). It starts at
     "What it is" with no start screen above it, and it paints in `theme.css`'s
     palette rather than One Dark (item 7).
2. **The landing downloads the entire app.** It is one entry chunk of 3.76 MB,
   1,116 KB brotli, and no route is lazy. It grew from the 988 KB brotli that
   `seo-discoverability.md` recorded on 2026-08-20. The composition below comes
   from sourcemap attribution of a local `PROFILE=1` build. That build keeps
   function names, which makes it about 7% larger; its CSS hash is identical to
   production.
   - **Workspace code, about two thirds.** Roughly 1.74 MB of `src` plus 0.88 MB
     from npm (dockview, lexical, regl, radix and others).
   - **Sentry, 521 KB (13%).** About 200 KB of that is Replay, Feedback and
     replay-canvas, which `initializeSentry` never enables. They ship because
     `main.tsx:54` passes the whole `import * as Sentry` namespace as an object.
     That makes every export reachable, so tree-shaking cannot remove any.
   - **posthog-js, 239 KB (6%).**
   - **What the landing needs, about 0.5 MB raw.** React, react-router, i18next
     and zustand come to about 383 KB. Landing, site, start-screen and routing
     code is about 106 KB. Add a few icons.
   - **Lighthouse's view.** "Reduce unused JavaScript" reports 839 KiB and
     estimates −700 ms on FCP and LCP (desktop). Evaluating the chunk takes
     250–940 ms of main-thread time per desktop run. Those long tasks are the
     TBT.
3. **The landing boots both editors.** `App.tsx:68` calls `initEngine()` on every
   route. It has to, because the start actions are disabled until the engine is
   ready (`StartScreen.tsx:35-36`).
   - So every landing visit spawns the CP and TreeMaker workers and fetches
     1.3 MB + 0.38 MB of wasm (brotli). On mobile that competes with first paint
     for bandwidth.
   - The earlier plan said "the wasm bridges are already isolated in workers".
     That is true of the *bundle*, but not of the *load*.
4. **Screenshots are 3456 px wide, and all of them load on first view.**
   - They are displayed at 424–1,118 CSS px.
   - `loading="lazy"` is set, but every dark screenshot is requested on first
     view: 6 on desktop (1.35 MB) and all 9 on mobile (2.24 MB). PSI's "Improve
     image delivery" puts the waste at 1,268 KiB.
   - Re-encoded with `cwebp -q 85`, all nine come to 381 KB at 1280 w and 188 KB
     at 800 w.
5. **Smaller items.**
   - Boot fetches ten locale namespaces (55 KB brotli), even for English, whose
     inline defaults are already the source of truth.
   - The render-blocking stylesheet is 42 KB brotli, and 38 KB of it is unused
     on the landing. The reason is that `styles/theme.css` (312 KB of source)
     holds the whole app's styles.
   - Third-party requests land in the load window: PostHog (`config.js`,
     `/flags`, `dead-clicks-autocapture.js`, `web-vitals.js`), the Cloudflare
     Web Analytics beacon, and the GitHub releases API.
   - Content-hashed `/assets/*` files are served with `max-age=14400` (4 hours).
6. **Accessibility 97 has one cause.** `color-contrast` fails on
   `.start-action__description`, which uses `--text-secondary`. In One Dark that
   is #828997 on the #2c3039 card, a ratio of 3.75:1. It needs 4.5:1.
7. **A trap for any static-first fix.** The `:root` palette in `theme.css` is not
   the One Dark preset that `applyTheme` installs at boot. For example,
   `--text-secondary` is #aeb9bf there and #828997 in One Dark; `--bg-primary` is
   #101417 and #282c34. A light-OS visitor gets Atom One Light instead. So any
   paint made before JS runs, using today's CSS, would visibly change palette
   when the app boots. `<meta name="theme-color">` carries the same stale
   #101417.

### Non-goals

- **Field data and INP inside the editor.** If the report's "real users" section
  has data, it covers the whole origin, including `/edit` sessions, and a failing
  INP there is a separate plan. This one is the lab test of the landing.
- **Hydration.** See Step 3 for why swapping is the better trade here.

## Approach

There are five steps. Each one can ship and be measured on its own. The order is
chosen for impact per unit of effort and for dependencies:

- Step 2 makes the live start screen look the same before and after the engine
  is ready, which Step 3's static copy needs.
- Step 2's on-demand engine gateway is also the seam that Step 4 splits along.

### Step 1 — Quick wins

- **Tree-shake Sentry.** Build the `SentryClientLike` object from *named* imports
  (`init`, `captureException`, and so on) instead of passing the namespace. This
  should remove about 200 KB raw from the entry; confirm it by re-running the
  attribution. Nothing changes at runtime, because Replay and Feedback were never
  enabled.
- **Responsive screenshots.**
  - Add `apps/web/scripts/gen-landing-images.sh`, the same kind of script as
    `gen-pwa-icons.sh`. It emits `<name>-<theme>-<w>.webp` at 640, 960, 1280,
    1920 and 2560 w, and the variants are committed as the icons are.
  - `LandingFigure` gets a `srcSet` with `w` descriptors, plus `sizes` for each
    layout (split, stacked, carousel).
  - Check the thin crease lines at q85 on the smallest widths. The existing
    comment chose q92 at full size for exactly that reason.
- **Contrast.** Choose the description colour (for example
  `color-mix(in srgb, var(--text-secondary) 50%, var(--text-primary))`) and add a
  unit test that asserts ≥ 4.5:1 for every one of the 23 presets. One Dark is only
  the preset Lighthouse happened to measure.
- **Cache hashed assets.** Add `/assets/*  Cache-Control: public,
  max-age=31536000, immutable` to `public/_headers`. The `/*` rule still applies
  COOP and COEP. The service worker already covers repeat visits, so this is
  small.
- **Remove Cloudflare Web Analytics (decided 2026-09-23).**
  - Nobody in the repo added it. Cloudflare injects it at the edge (the
    `data-cf-beacon` token is `8e18…d216`), so removing it is a dashboard
    toggle on the Pages project or the Web Analytics site.
  - The injection only happens for browser user agents, so a plain `curl` never
    shows the script. Check with a browser UA.
  - PostHog already measures everything the beacon measured. The project's
    remote config has `capturePerformance.web_vitals: true` and
    `network_timing: true`, and pageviews are captured on history change.
  - The beacon also ignores the in-app analytics opt-out, which AGENTS.md's
    privacy contract does not allow.
  - Cloudflare's own request analytics come from edge logs, not the beacon, so
    they stay.
  - Removing it drops `beacon.min.js` and the `/cdn-cgi/rum` POST.

Expected: accessibility reaches 100. Image bytes on first view drop from 1.35 MB
to about 0.2 MB on desktop, and from 2.24 MB to about 0.2–0.4 MB on mobile. The
entry loses about 200 KB raw.

### Step 2 — Don't boot the editor on the landing

- **Where the boot starts.**
  - On the welcome route and the site pages, the boot starts on *intent*:
    pointerenter, focus or touchstart on a start action, or a file dragged into
    the page.
  - Failing that, it starts on idle after `load`, so a visitor who reads for ten
    seconds still clicks into a warm engine.
  - Workspace and share routes boot on mount, as they do today.
  - Desktop keeps booting at startup. There is no network cost there, and CP is
    native.
- **Start actions are enabled immediately.** A click waits for the engine, and
  the pending state belongs to the card that was clicked. "Preparing the
  editor…" moves from the page status to that card. The error path is unchanged.
  A welcome-page file drop waits for the boot in the same way.
- **Re-read `pwa/sw.ts` invariants 5–6.** "The kernels ride along with
  `initEngine`" will no longer be true of a landing visit. The warm set already
  names the kernels explicitly, so offline behaviour should not change. Update
  the comment.

Expected: about 1.7 MB of brotli wasm and two worker spawns leave the landing's
load window. Before any other step, total bytes on desktop fall from 4.3 MB to
about 2.6 MB. The main-thread effect is small, since wasm compiles in the
workers. The bandwidth effect on mobile is large.

### Step 3 — Paint the prerendered page

**The gate: the static paint must be pixel-identical to the rendered page, or
this step does not ship.** The flash it replaces looked broken because it was a
different page (item 1). A copy that is only *close* would bring that back.
Steps 1, 2 and 4 stand on their own without this one.

- **Keep the copy only for visitors it is guaranteed to match.** The inline
  pre-paint script decides per visitor. For anyone it cannot guarantee, it
  removes the copy, which is exactly today's behaviour. So the worst case is
  never worse than now.
- **Enforce it with a test.**
  - A Playwright script against the built `dist` screenshots two states: the
    first paint (entry chunk blocked, inline scripts allowed) and the page at
    React's first commit. It requires zero differing pixels.
  - The start figure's canvas is masked. It is empty in both states until the GL
    module loads at idle.
  - The matrix is Chromium and WebKit × desktop and phone × dark and light, plus
    a non-English system locale and a desktop-app (Tauri) case. Both of those
    must show the copy removed.
  - It runs after the build, the way `seo-smoke.mjs` does. The same comparison
    measured today's copy as 82% different.
- **Every known source of difference needs a pre-paint answer.**

  | Differs today because | Pre-paint answer |
  | --- | --- |
  | The prerender has no start screen | Prerender the whole route (below) |
  | `theme.css` `:root` is neither One Dark nor Atom One Light | Generated default-theme CSS, and a replay of a saved preset |
  | The live language is the stored preference or the system locale; the static page is in the URL's locale | The guard removes the copy when they differ. The guard's resolution is generated from the module that `resolveInitialLanguage` uses and tested against it, never hand-copied |
  | The download button's label depends on the OS (macOS / Windows / Linux / none) | The inline script sets `data-os` on `<html>`. The prerender emits every label and CSS shows one |
  | The desktop app serves the same `index.html` but has no footer and no download button | The guard removes the copy under Tauri |
  | Phone surface (`data-surface`) | Evaluate the same `PHONE_MEDIA_QUERY` inline, or express it in CSS |
  | The "Show welcome on startup" checkbox | Checked by default; the guard removes the copy when it is stored `false` |
  | Start actions are disabled while the engine loads | Step 2 enables them at once, so this step depends on Step 2 |

- **Prerender the whole welcome page.** `StaticLanding` renders `StartScreen`
  (status `ready`, default toggle), `WelcomeLanding` and `SiteFooter`. They sit
  inside the live wrapper markup, `div.app-layout.app-layout--start >
  main.welcome-page`, so the page lays out and scrolls exactly as the live route
  does.
  - `DesktopDownloadButton` already gates its platform probe on
    `typeof window`.
  - `StartFigure` renders only an empty `<canvas>` when there is no JS. A canvas
    is not an LCP candidate, so the `<h1>` remains the LCP element.
- **Guard the removal instead of always removing.** The inline script removes
  the copy in two cases:
  - This load will not show the page. That means `/` with
    `oristudio:show-welcome-on-startup` present and not `'true'`, which mirrors
    `readBoolean`. It is the case the current comment exists for.
  - A match cannot be guaranteed: the language or Tauri rows of the table above.
  - Wrap the storage read in try/catch.
  - Build the key from `storageKey(STORAGE_KEYS.showWelcomeOnStartup)` at build
    time, so it cannot drift.
  - `/welcome`, the locale landings and the content pages never remove the copy.
- **Paint the right palette before JS.**
  - Generate the default-theme CSS from the preset JSON: One Dark goes on
    `:root`, and Atom One Light goes under
    `@media (prefers-color-scheme: light)`. A first visit then paints in the
    palette the app will boot into. The generator should also fix
    `<meta name="theme-color">`.
  - For a saved preset that is not a default, `applyTheme` writes the resolved
    variables to storage. A few lines of inline `<head>` script apply them
    before paint.
  - `LandingFigure` has to choose the same light/dark variant before and after
    boot.
- **Swap instead of stacking.** The route that replaces the copy removes
  `#seo-content` in a `useLayoutEffect` on its first commit (`WelcomeRoute`,
  `SitePageRoute`) and carries over the scroll offset. It should not happen in
  `main.tsx` before `createRoot`, which is today's blank window. It also should
  not happen on the root's first commit, because the index loader's `/` →
  `/welcome` redirect means that commit can be empty.
  - Because the two renders are the same components, the swap is visually a
    no-op.
  - New nodes are not "shifted" nodes, so CLS is unaffected.
  - An identical node painted later is not a *larger* LCP candidate, so LCP
    stays at the static paint. That only holds if the two renders really are
    identical, so verify it with a trace.
- **Why swap instead of `hydrateRoot`.** The live welcome route reads persisted
  state on its first render: the theme, the phone surface, the welcome toggle,
  the i18n language, and `useId` ids that depend on the surrounding tree.
  Hydration would need every one of those to be deterministic across the
  build/boot boundary, and any mismatch makes React discard the server markup
  anyway. A same-frame swap gets the same paint without that coupling.

Expected: FCP and LCP stop depending on the size of the JS. Lantern should put
them close to HTML + CSS, around 0.5 s on desktop and 1.5–2 s on mobile. Treat
those as targets to measure, not results. One caveat: on a very fast network the
module can arrive and start evaluating before the first frame, and a long
evaluation then delays the paint. Step 4 is what makes that window short.

### Step 4 — Split the bundle

- **Restructure the router.**
  - The web root gets a thin layout.
  - `App` becomes a lazy layout route (react-router's route `lazy`) that wraps
    `WorkspaceShell` and the share routes. It owns the engine, the modals,
    Toaster, the global keyboard, the native menu, the update check, URL sync and
    the discard guard.
  - The welcome route and site pages sit outside it.
  - Assign each thing `App` does today to the root or to the workspace. The ones
    that need a decision are `useWindowTitle`, `useAppOpenedEvent`, the site-page
    keyboard exemption and `UpdateCard`.
  - Desktop prefetches the workspace chunk at startup, so Tauri launches are not
    slower.
- **WelcomeRoute without the store.**
  - The three actions and the file drop go through the gateway from Step 2. It
    `import()`s the store and shell chunk, and prefetches on the same intent and
    idle triggers.
  - Check what `useSettingsStore` and `useThemeStore` pull in, since the theme
    store brings all 23 preset JSON files.
- **Guard every new `import()`.** Pages answers a deleted chunk with `index.html`,
  which fails on MIME type (see `lazy-import-breaks-after-deploy`). Use one
  helper: on a chunk-load failure, reload once, with a `sessionStorage` flag to
  prevent loops. `RouteErrorElement` offers a reload for route `lazy` failures.
- **Service worker.** The lazy chunks are already in `manifest.assets`. Add the
  workspace chunk or chunks to the warm set, so an offline launch into `/edit`
  never needs a chunk the landing did not fetch. This is the same failure class
  as invariant 4. Verify with `scripts/webkit-pwa-check.mjs`.
- **Analytics and monitoring stay eager.** Sentry stays eager so it still
  catches crashes during boot, trimmed as in Step 1. PostHog stays eager too
  (see Deferred).
- **Take the workspace's CSS off the landing.** This is smaller than it first
  looked. None of the landing's styles are in `theme.css`: they are in `App.css`
  (the start screen) and in the co-located `WelcomeLanding.css` and `site.css`.
  - The eager set becomes `index.css`, the tokens block from the top of
    `theme.css`, the start-screen part of `App.css` moved into its own file next
    to `StartScreen`, and the landing and site files.
  - Everything else in `theme.css` and `App.css` is imported by the lazy shell,
    in its current relative order. Vite emits a stylesheet per chunk.
  - Splitting across chunks changes load order. Add a check that no selector is
    defined on both sides of the split, so no override can silently flip.
  - How CSS should be organized in general is a separate decision. This step is
    the minimal cut and does not depend on it.
- **i18n.**
  - English makes no catalog requests, since inline defaults are the source and
    the prerender already relies on that. Check first that no key lacks an
    inline default (for example `cpVocab`).
  - Other locales request the landing namespaces first and the rest with the
    workspace chunk.

Expected: the landing entry falls from 1,116 KB to roughly 150–200 KB brotli.
TBT then comes from React rendering the landing, not from evaluating 3.7 MB of
modules. Record the before and after numbers from the attribution script.

### Step 5 — Keep it from regressing

- **A CI budget.** Enforce a limit on the landing's initial JS + CSS in brotli
  bytes, computed from `dist/index.html` and the Vite manifest's static import
  graph. This is deterministic, unlike Lighthouse. Nothing noticed the entry grow
  13% in a month.
- **`scripts/lighthouse.mjs` for local use.** It runs desktop and mobile N times
  each against production or `vite preview` and prints medians. This is how the
  numbers above were produced. Keep it out of CI, because it is too noisy to gate
  on.
- Point `seo-discoverability.md` Phase 4 here.

### Deferred

- **Lazy PostHog (punted 2026-09-23).** Load it with `import('posthog-js')`
  after first paint, behind `analytics/`, with a queue for `track()`. That takes
  239 KB raw off the landing. The cost is that autocapture cannot see clicks
  made before it loads. Revisit once Step 4 has measured what is left.
  - When this comes back: the project has no feature flags
    (`hasFeatureFlags: false` in the remote config), so `advanced_disable_flags`
    can drop the `/flags` request.
  - Keep `web-vitals.js`. Once the Cloudflare beacon is gone, it is the only
    real-user Core Web Vitals source.

## Affected Areas

- `apps/web/src/main.tsx`: Sentry named imports; the pre-render removal moves
  out.
- `apps/web/src/monitoring/`: the client object built from named imports (and the
  `bootstrap.ts` comment that says the namespace is passed).
- `apps/web/src/components/landing/LandingFigure.tsx` and `WelcomeLanding.css`:
  `srcSet` and `sizes`.
- `apps/web/scripts/gen-landing-images.sh` (new) and `apps/web/public/landing/`:
  the variants.
- `apps/web/src/App.css`: contrast.
- `apps/web/src/themes/` tests: preset-wide contrast test.
- `apps/web/public/_headers`: caching for hashed assets.
- `apps/web/src/App.tsx`, `routing/appRouter.tsx`, `routing/WelcomeRoute.tsx`,
  `components/StartScreen.tsx`, and a new gateway module: engine boot on intent
  and the lazy shell.
- `apps/web/src/seo/StaticLanding.tsx`, `seo/prerenderHtml.ts`,
  `seo/prerenderEntry.tsx`, `scripts/prerender-landing.mjs` and
  `site/SitePageRoute.tsx`: static first paint, the guard and the swap.
- `apps/web/src/themes/applyTheme.ts`, generated default-theme CSS and
  `index.html`: palette before paint.
- `apps/web/src/styles/theme.css`, `App.css` and a new `StartScreen.css`: the
  eager/lazy CSS cut.
- A new Playwright script under `apps/web/scripts/`: the static-paint identity
  gate.
- `apps/web/src/i18n/index.ts`: English without fetches, and namespace split.
- `apps/web/src/pwa/sw.ts` and `vite.config.ts` (`serviceWorkerManifest`): warm
  set for lazy chunks.
- `.github/workflows/` and `scripts/`: the budget.

## Checklist

### Step 1 — Quick wins

- [x] Sentry client object from named imports; re-run the attribution and record
      the entry size before and after. Sentry went from 521 KB to 97 KB. The entry
      (`PROFILE=1` build) went from 4.01 MB to 3.58 MB raw, and from 1,006 KB to
      890 KB at brotli q11.
- [x] `gen-landing-images.sh`, committed variants, `srcSet` and `sizes` on
      `LandingFigure`; check the fine lines at the smallest widths. The widths are
      640/960/1280/1920, with the 3456px master as the top candidate (a 2560w tier
      would have added 2.5 MB to the repo for no visible gain). At 640w the lines
      hold up (35.7 dB PSNR against the master downscaled); `-sharp_yuv` keeps the
      crease colours.
- [x] Description contrast fix, plus a contrast test across all presets. The fix
      is `color-mix(… --text-secondary 20%, --text-primary)`: every preset passes
      AA except the two Solarized ones, whose own body text is below AA there, so
      the test holds them to 3:1. Reverting to `--text-secondary` fails 15 presets.
- [x] `/assets/*` immutable cache header
- [ ] Disable Cloudflare Web Analytics in the dashboard; confirm
      `cloudflareinsights` is gone from a fetch of `/` with a browser UA

### Step 2 — Engine boot on intent

- [ ] Boot on intent or idle on welcome and site routes; boot on mount on
      workspace and share routes; boot at startup on desktop
- [ ] Start actions enabled at once, with a per-card pending state; drop waits
      for the boot
- [ ] Update the `sw.ts` invariant 6 comment

### Step 3 — Static first paint

- [ ] **Gate first:** the Playwright identity check (Chromium + WebKit ×
      desktop + phone × dark + light, zero differing pixels, figure canvas
      masked; the non-English and Tauri cases show the copy removed), run after
      the build
- [ ] Prerender `StartScreen` inside the live wrapper markup
- [ ] Guarded removal (the welcome preference, language, Tauri); the language
      resolution generated from the same module as `resolveInitialLanguage`;
      mutation-check it in `prerenderHtml.test`
- [ ] `data-os` on `<html>`, with every download label prerendered and one shown
      by CSS
- [ ] Generated default-theme CSS; inline saved-preset replay; fix `theme-color`
- [ ] Remove `#seo-content` in the replacing route's `useLayoutEffect`; carry
      over scroll
- [ ] Trace: no CLS at the swap, and LCP stays at the static paint

### Step 4 — Split

- [ ] Thin root layout; lazy `App` shell; each `App` concern assigned to root or
      workspace
- [ ] `WelcomeRoute` free of the workspace store; prefetch on intent
- [ ] One guarded `import()` helper with reload-once
- [ ] Workspace chunks in the SW warm set; `webkit-pwa-check` passes
- [ ] Workspace CSS lazy (tokens, start screen, landing and site eager); check
      that no selector is split across the cut; visual check of every workspace
- [ ] English without catalog fetches; namespace split for other locales

### Step 5 — Guardrails

- [ ] Landing budget in CI
- [ ] `scripts/lighthouse.mjs` (medians, desktop and mobile)
- [ ] `seo-discoverability.md` Phase 4 points here

### Validation (every step)

- [ ] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [ ] `npm run build:web` (a plain build, so the prerender runs); read
      `dist/index.html` by hand
- [ ] `npm run check:desktop`; launch the Tauri app for Steps 2 and 4
- [ ] Lighthouse desktop and mobile medians against the deploy; record them here
