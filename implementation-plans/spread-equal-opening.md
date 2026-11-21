# Equal opening: one Amount for every model in Perspective 3D

## Goal

Make a Default spread's Amount open models by a similar amount in a Diagram
step's Perspective 3D presentation, without changing any picture that is
already saved.

Today Amount multiplies the spread solver's own heights, and Perspective 3D
doubles that. The solver sizes those heights by the deepest stack and stops
enlarging them at the first steep triangle. So at 100% a two-face fold's
layers part by 40° (its leaves end up 46° apart) while an 86-deep model (bodo)
barely parts: across 463 cpoogle designs, 100% opens neighbouring layers
anywhere from 1.8° to 52° (median 12.4°), measured as `atan(4 · opening)`.
Zach, 2026-11-20: "doesn't allow for much separation with complex models but
is HUGE for small simple models".

## Approach

**Measure, once per solve.** `spreadOpening` (`packages/layer-spread`) reads
three numbers from a solution at amount 1:

- `opening`: over every pair of neighbouring layers in every overlap cell, how
  fast the two part (`|∇h_upper − ∇h_lower|` at the cell's centroid), averaged
  by cell area. Tilt a whole stack shares does not count. Plain tilt was tried
  first and rejected: Lotus's petals tilt together without parting, so tilt
  flattened it.
- `steep`: the area-weighted 99th percentile of `|∇h|` over triangles.
- `reach`: the largest `|h|` over the diagonal of the flat paper's box.

**Gain.** `k = tan(12.4°) / (4 · opening)`, so at 100% (a stored amount of 2,
doubled) neighbouring layers open 12.4° on average — the corpus median, which
keeps a typical design as it is today. Two limits hold a gain back, and
neither ever takes a model below version 1:

- The steepest 1% of the paper stays within 65° at 100%.
- No point rises above half the paper's diagonal at 100% (`HIGHEST_AT_FULL`).
  Height is slope times lever arm, so a deep strip-shaped stack can open by
  slope alone and still rise past the Perspective eye, which stands about two
  diagonals away (review E27: a 40-layer accordion went behind the eye in View
  Top).

A solve that opens nothing keeps 1; no gain passes 20. On the corpus as
shipped: k p10 0.46, p50 1.00, p90 2.09, max 6.93; bodo 10.8, two-face fold
0.26, Lotus 0.80. The limits hold back 39 of 463 designs (29 by steepness, 10
by height; 20 never binds), which open 3.3° to 12.3° at 100% instead of 12.4°.
At 100% the highest point is a median 0.19 of the diagonal (0.5 at most), and
the steepest 1% a median 40° (65° at most). The measure costs a median 0.17 ms
per solve (26 ms at worst) and is cached per solution.

These numbers and what `spreadOpening` measures define version 2 as saved
files draw it: recalibrating them is version 3, and version 2 keeps them.

**Version pinning.** `ConnectedSpread.version` already pins the scale policy.

- Version 1 keeps Perspective's doubling exactly. Every spread in every saved
  file is version 1, and every path that draws a step (live pose, capture,
  Refresh Picture, export) passes the step's own spread through the one
  mapping in `foldedFlatScene.ts`, so no saved step changes.
- Version 2 is equal opening. It differs only in Perspective 3D.

**Where version 2 is written.** Only where it shows, so older builds lock as few
steps as possible:

- A Default spread shown in Perspective 3D for the first time: a step with no
  presentation switched to it. A Diagram presentation is kept from Perspective
  so switching back is reversible (`presentation.ts`), so a step that has one
  comes back at its own version — a version 1 picture as it was saved, with its
  Update. Diagram asked of a step never shown in Perspective writes no
  presentation, so "has a presentation" keeps meaning "has been shown there".
- A Default spread started fresh while the step is in Perspective 3D (Spread
  Layers turned on, or Default chosen).
- The Update action below.

Everything else keeps the version it has: a remembered pose restored by Show
as, a layer order the dialog applied (which keeps the presentation too). A
render that loses its presentation entirely — Reset Pose, a spread whose
layers can't be taken (`spreadFailedRender`) — goes back to version 1
(`spreadOutOfPerspective`); versions draw alike there, and showing it in
Perspective again makes it version 2 again. New pictures start from the start
rule at version 1 (`spreadStartsAmong`); Fold, Edit and export never show
Perspective and never write version 2. A step switched from Perspective to
Diagram keeps version 2, so older builds keep it locked.

**Update.** A version 1 step in Perspective 3D shows a notice with an Update
button, in Pose's Step pane only (the Pages inspector has no open Pose). It
converts the step to version 2 at `amount / k`, which draws the same picture,
capped at 100%: only pictures that opened past the new 100% (the two-face fold)
come down. `k` is measured from the open Pose's own solve; a Fold step's pane
reads the solve the open detail shares (`useFoldSpreadView`'s `solved`). One
undo step, counted as the pose action `spread_equal_opening`. The step's marks
stay in step with an Update that keeps the picture, though rounding the amount
can change the stored scene's key (`equalOpeningKept`); an Update that came
down to 100% says the picture changed.

**No-stretch shift.** The shift holds at a drawn amount of 1
(`SHIFT_HOLD_AMOUNT`), so with k > 1 the hold comes sooner (bodo 2.3% on the
slider) and lifted paper stretches past it at high amounts, as version 1 did
past 25%: bodo's steepest 1% is 54° at 100% (about 1.7× its length). A hold by
slope instead of drawn amount is a possible follow-up.

**Older builds.** A shipped reader treats any connected version other than 1
as a newer build's: a Diagram step shows its saved picture, locked, and is
written back as it came; a Fold step or Edit figure carries it.

## Affected Areas

- `packages/layer-spread/src/opening.ts`, `types.ts`: the measure, `version: 1 | 2`.
- `apps/web/src/layer-spread/equalOpening.ts`: gain, the Perspective height
  scale by version, the version 2 rules and the Update conversion.
- `apps/web/src/cp-workspace/folded/foldedFlatScene.ts`: the Perspective mapping.
- `apps/web/src/cp-workspace/folded/layerSpreadSettings.ts`: reader, the
  `spread-equal-opening` edit, `spreadOutOfPerspective`, start rule at version 1.
- `apps/web/src/diagram/capture/linkedPose.ts`, `diagram/fold/foldStepActions.ts`,
  `diagram/document/diagramDocument.ts`: where version 2 is written and taken back.
- `apps/web/src/diagram/capture/useDiagramLinkedPose.ts`,
  `diagram/fold/useDiagramFoldStepPose.ts`, `diagram/fold/useFoldSpreadView.ts`,
  `components/diagram/DiagramStepPose.tsx`,
  `components/diagram/SpreadEqualOpeningNotice.tsx`: the Update action.
- `apps/web/src/diagram/annotate/annotationCarry.ts`: marks after an Update.
- Analytics: pose action `spread_equal_opening`.
- i18n: two strings in `panels`.
- CI: `npm run test:layer-spread`, which nothing ran before.

## Checklist

- [x] `spreadOpening` with unit tests (opening of a hinge, shared tilt ignored, area weights, steep percentile, bent faces, reach)
- [x] `version: 1 | 2`; reader accepts 2, a newer version stays a newer build's
- [x] Gain with calibration, steepness and height limits and degenerate tests; literal goldens; Perspective mapping by version (version 1 byte-identical)
- [x] Version 2 on first entry into Perspective and fresh starts there, in linked and Fold steps; back to version 1 without a presentation; start rule at version 1
- [x] Update notice and action in both pose hooks, analytics, i18n for 8 locales
- [x] Review of PR #616 (seven reviewers, three verifiers per finding): 23 findings confirmed and fixed
- [x] Relevant vitest, typecheck, lint, i18n check; the package's tests in CI
- [x] Browser: the example file's saved Perspective steps unchanged; Update keeps the picture; a new switch opens bodo visibly

## Verification (2026-11-20)

- `spreadOpening` matches the corpus harness to 8 significant digits on bodo,
  the two-face fold, Lotus and Styracosaurus, so the calibration carries over.
- Tests:
  - The measure: `packages/layer-spread/tests/opening.test.ts`, now in CI.
  - The gain, limits, goldens, cache and version rules: `equalOpening.test.ts`.
  - The Perspective drawing by version: `posedScene.test.ts`.
  - The file format and start rule: `layerSpreadSettings.test.ts`.
  - Linked poses: `linkedPose.test.ts`, covering first entry, the round trip
    through Diagram, layer order, Reset and remembered poses.
  - Fold poses: `foldStepPose.test.ts`, covering `presentDiagramFoldStep`,
    `setDiagramFoldPresentation` and Reset.
  - Failed spreads: `captureSpreadFailed.test.ts`.
  - The linked Update end to end, with Undo: `useDiagramLinkedPose.test.tsx`.
  - The Fold step pane's Update from the shared solve, and the notice in Pose
    only: `useDiagramFoldStepPose.test.tsx`, `useFoldSpreadView.test.tsx`.
  - Marks after an Update: `annotationCarry.test.ts`.
  - The Update hook and notice: `useEqualOpeningUpdate.test.tsx`,
    `DiagramStepPanel.test.tsx`.
- Browser, Zach's `separation_bug_example.osf`:
  - Both saved steps open as version 1 and draw as before, with the notice.
  - Update on bodo keeps the picture (Amount 100% → 9%; no point moves more
    than 0.001 px on a 1000 px picture in the Node harness), and 100% then
    separates its layers.
  - Update on the two-face fold brings it down to the new 100%.
  - Undo restores version 1. No console errors.
