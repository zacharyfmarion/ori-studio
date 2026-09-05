# Desktop Download Links

## Goal

The desktop app has shipped — `v0.4.0` is armed on GitHub Releases with signed
macOS DMGs, a Windows installer and Linux packages — and the website still says
it does not exist. Nothing in the web app offers a download, the landing page's
own test *enforces* that absence, and three separate strings promise "nothing to
install" as though the browser were the only way to run this.

Put a real download in front of the people already using the web app, and make
the copy tell the truth: the browser build needs nothing, **and** there is a
desktop app.

Concretely:

- A download control in the start screen's header, on the landing page's "Get
  started" band, and as a small icon at the right of the workspace toolbar.
- Every link resolves to the **actual asset** for the visitor's platform, not a
  generic "go to GitHub and figure it out" page.
- None of it appears in the desktop app itself.
- The stale "nothing to install" copy is rewritten, in source, in the SEO
  metadata, and in the structured data.

## Approach

### Where the URLs come from

Asset names embed the version (`Ori.Studio_0.4.0_aarch64.dmg`), so no static URL
can name one. Three options were weighed:

1. **Link to `/releases/latest`.** Always correct, zero maintenance, but hands
   the visitor a page of 13 files and asks them to pick.
2. **Derive names from `APP_VERSION`.** Free, and wrong: the web app deploys on
   every merge, so between `release.sh prepare` merging and the tagged build
   finishing, `package.json` names a version that has no release. That window
   ships 404s, silently.
3. **Read the release's real asset list from the GitHub API.** Exact URLs, the
   version to label the button with, and legs that did not build simply do not
   appear — `v0.4.0` has no `linux-arm64` assets, and a derived name would have
   offered one anyway.

(3), with (1) as the fallback: the anchors render pointing at
`/releases/latest` from the first paint and are *upgraded* to the direct asset
once the fetch resolves. A rate-limited, offline, or blocked fetch therefore
costs the version label and one extra click — never a dead button — and the
prerendered landing markup has a working link in it with no JavaScript at all.

The response is cached in `localStorage` through the existing storage layer for
a day, so a returning visitor spends no request. GitHub's unauthenticated limit
is 60/hour **per client IP**, which one visitor cannot reach.

### Platform detection

`platform/runtime.ts` already answers Apple/Windows/mobile from the same probe
shape, so this extends it rather than starting a second detector. macOS
architecture is deliberately *not* guessed: a WKWebView on Apple Silicon reports
`Intel Mac OS X` like every other Mac, and there is no synchronous signal that
separates them — so both Mac builds are offered explicitly, Apple Silicon first.

A phone gets no recommendation (there is nothing to install), but keeps the menu,
so someone browsing on a phone can still see the app exists.

### Surfaces

One presentational component, `DesktopDownloadButton`, wearing the existing
`ui-split-button` and `context-menu` skins: a primary anchor for the recommended
build, and a caret opening every build for every platform. The workspace toolbar
uses the same data through a plain `MenuIconButton`, since a toolbar icon has no
room for a label.

All of it is gated on `isWebRuntime()`. The desktop app must not advertise itself
to itself.

## Affected Areas

- `apps/web/src/platform/desktopDownload.ts` (new) — builds, matching, detection.
- `apps/web/src/platform/desktopRelease.ts` (new) — fetch, cache, and the
  shared in-flight request.
- `apps/web/src/platform/useDesktopDownloads.ts` (new) — what the controls read.
- `apps/web/src/components/download/` (new) — the button and the toolbar menu.
- `apps/web/src/components/StartScreen.tsx` — header row with the download.
- `apps/web/src/components/WorkspaceShell.tsx` — the toolbar icon.
- `apps/web/src/components/landing/WelcomeLanding.tsx` — the "Get started" band,
  the "What it is" lead, and the stale JSDoc.
- `apps/web/src/components/HelpModal.tsx` — a download line in About.
- `apps/web/src/analytics/events.ts` — `LandingCta`, a `desktop download started`
  event, and the stale comment claiming there is no download.
- `apps/web/src/lib/storage.ts` — one cache key.
- `apps/web/src/seo/siteMeta.ts`, `apps/web/index.html`, `apps/web/src/seo/jsonLd.ts`
  — description and `operatingSystem`.
- `implementation-plans/welcome-landing-page.md` — the "no desktop download"
  claim.
- Tests: the landing's download guard is inverted; new unit tests for matching,
  detection and the cache.
- 8 target locales for every new string.

## Checklist

- [x] Read the release workflow and a live release to learn the real asset names
- [x] Confirm `latest.json` cannot serve this (updater artifacts, not installers)
- [x] `platform/desktopDownload.ts` + tests
- [x] `platform/desktopRelease.ts` + `useDesktopDownloads.ts` + tests
- [x] `DesktopDownloadButton` and the toolbar menu
- [x] Start screen header
- [x] Workspace toolbar icon
- [x] Landing "Get started" band + lead copy
- [x] About dialog line
- [x] Analytics: `LandingCta`, `desktop download started`
- [x] SEO copy: `siteMeta.ts`, `index.html`, `jsonLd.ts`
- [x] Invert the landing test guard; add coverage for the new CTA
- [x] `i18n:extract`, translate 8 locales, `i18n:stamp`, `i18n:check`
- [x] lint, typecheck, unit tests, `build:web`
- [x] Verify in the browser (fetch under COEP, menu, links)
- [x] Draft PR — https://github.com/zacharyfmarion/ori-studio/pull/350
