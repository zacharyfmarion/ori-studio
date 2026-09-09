# Welcome shimmer grid

## Goal

Give the welcome screen a subtle equilateral-triangle grid with a slow shimmer.

## Approach

Use a decorative CSS mask tiled at a fixed equilateral aspect ratio. A quiet
base layer and a moving highlight share that mask, keeping the grid stationary.
Theme tokens supply the ink; an edge fade keeps the background unobtrusive.
Disable the shimmer for reduced motion and keep the decoration out of hit testing
and the accessibility tree. No new adoption event is needed for passive decoration.

## Affected Areas

- Shared `StartScreen` composition and its background styles.
- Existing welcome-screen tests and browser visual checks.

## Checklist

- [x] Inspect welcome layout, theme patterns, and checkout readiness.
- [x] Implement the grid and reduced-motion fallback.
- [x] Validate web lint, types, tests, and browser appearance/interaction.
- [ ] Open a draft PR against main and provide a local preview.

## Validation notes

Web lint, typecheck, and production build (including prerender) passed. The full
Node 22 unit run passed 5,889 tests with 12 timeouts; all 62 tests in those three
suites passed on a single-worker retry. Chromium checks covered both themes,
mobile layout, reduced motion, and opening a CP. WebKit verified decoration and
reduced motion; editor readiness timed out there. No new unit tests are needed
for CSS decoration. Rust/oracle/native checks were skipped because their behavior
is unchanged; standard web hooks rebuilt all WASM bridges.
