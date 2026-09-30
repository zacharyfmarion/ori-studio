# Landing: "Start creating" on phones, and an honest download fallback

## Goal

On a phone, the landing page's "Get started" section offered "Download the desktop
app" — a build the device cannot run. Tapping it opened GitHub's releases page in a
new tab. PostHog showed that this one button produced 111 of the 114 `releases-page`
downloads from the landing page since 2026-09-13 (58 people), so the
fallback count read as "GitHub fetch failing" when it was mostly phones.

Replace the button on phones with "Start creating", which goes to `/edit`, and make
`desktop download started` say *why* a click fell back to the releases page.

## Approach

- `WelcomeLanding`'s Get-started section renders a router `Link` to `EDIT_PATH` on a
  phone surface (the same `useIsPhoneSurface` test the start screen uses to hide its
  corner download), and `DesktopDownloadButton` everywhere else. The prerender has
  no phone, so the crawlable copy keeps the download.
- New `LandingCta` value `start`, tracked through the existing `trackCta`.
- `desktop download started` gains `fallback_reason` on `releases-page` clicks only:
  `no_platform` (release known, but nothing to recommend for this device: a phone,
  tablet or unrecognized host) or `release_unresolved` (the GitHub lookup had not
  answered, or failed). Only `release_unresolved` means the fetch is failing.

## Affected Areas

- `apps/web/src/components/landing/WelcomeLanding.tsx` (+ test)
- `apps/web/src/components/download/DesktopDownloadButton.tsx`, `DesktopDownloadMenuItems.tsx` (+ tests)
- `apps/web/src/analytics/events.ts`, `trackDesktopDownload.ts`
- `docs/analytics.md`
- Locale catalogs for the new string

## Checklist

- [x] Phone CTA in the landing's Get-started section
- [x] `start` landing CTA event
- [x] `fallback_reason` on releases-page downloads
- [x] Tests
- [x] i18n extract, translate, stamp, check
- [x] Docs
- [x] Lint, typecheck, unit tests
- [x] Draft PR
