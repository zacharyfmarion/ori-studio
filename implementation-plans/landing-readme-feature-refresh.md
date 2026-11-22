# Landing and README feature refresh

## Goal

Bring the landing page (`/welcome`, prerendered as `/`) and the top-level
`README.md` up to date with what Ori Studio does today. Both stop at the
editor, the design methods and the simulator; since then the app has gained
the **Fold** workspace (0.7.0) and the **Diagram** workspace (0.6.0), and the
diagrams people make with them are the clearest picture of the product.

## Approach

- Landing: add two sections after Simulate, in the order the work happens —
  design, draw, simulate, fold step by step, diagram.
  - **Fold** (`landing-fold`, `split`): one screenshot of the Fold workspace
    mid-sequence.
  - **Diagram** (`landing-diagram`, carousel): three finished diagrams made in
    the app (crane, boat, box), each slide naming what the workspace does.
  - Reword the opening lead so it covers the whole path, ending at diagrams.
  - Reuse `LandingSection`, `LandingFigure` and `LandingSwipeCarousel` as they
    are; no new CSS.
- Screenshots: 3456px masters (1728×972 CSS px at 2×) in both themes, captured
  with headless Chromium against the dev server, then the commands in
  `apps/web/scripts/gen-landing-images.sh` for the responsive widths, run on
  the new masters only so the existing variants stay byte-identical.
- Analytics: extend `LandingSectionId` and `LandingFeatureId` with the new
  section and slide ids, so the existing hand-placed events report them.
- i18n: new and reworded `landing:` keys translated in all eight locales.
- README: a short tour of the workspaces, each with its landing screenshot in
  a `<picture>` that follows GitHub's light or dark theme, keeping engineering
  detail where it already is. The download line now lists every platform the
  releases ship.
- Not advertised on the landing, as before: CP detection from images.

## Affected Areas

- `apps/web/src/components/landing/WelcomeLanding.tsx` and its test
- `apps/web/src/analytics/events.ts`
- `apps/web/public/landing/` (new figures and variants)
- `apps/web/public/locales/*/landing.json` and `.hashes.json`
- `README.md` (reuses the landing screenshots; no new images)

## Checklist

- [x] Capture Fold and Diagram screenshots in light and dark
- [x] Generate responsive variants
- [x] Add the Fold and Diagram sections and reword the opening lead
- [x] Extend the landing analytics enums
- [x] Update `WelcomeLanding.test.tsx`
- [x] Translate the new keys in all eight locales; `i18n:check` passes
- [x] Rewrite the README feature overview with images
- [x] Verify the landing in the browser: light, dark, phone width
- [x] Lint, typecheck, landing tests; draft PR
- [x] Recapture the nine older figures in today's UI from the projects they
      were made from (two simple test patterns rebuilt line for line)
- [x] Replace the annotations slide with a zoomed-in crane step, retitled
      "All the annotations you need"
