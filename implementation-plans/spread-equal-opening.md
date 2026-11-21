# Equal opening: one Amount for every model in Perspective 3D

## Goal

Make a Default spread's Amount open every model by a similar amount in a
Diagram step's Perspective 3D presentation, without changing any picture that
is already saved.

Today Amount multiplies the spread solver's own heights, and Perspective 3D
doubles that. The solver sizes those heights by the deepest stack and stops
enlarging them at the first steep triangle. So 100% opens a two-face fold 46°
while an 86-deep model (bodo) barely parts: across 463 cpoogle designs, 100%
opens neighbouring layers anywhere from 1.8° to 52° (median 12.4°). Zach,
2026-11-20: "doesn't allow for much separation with complex models but is HUGE
for small simple models".

## Approach

**Measure, once per solve.** `spreadOpening` (`packages/layer-spread`) reads two
numbers from a solution at amount 1:

- `opening`: over every pair of neighbouring layers in every overlap cell, how
  fast the two part (`|∇h_upper − ∇h_lower|` at the cell's centroid), averaged
  by cell area. Tilt a whole stack shares does not count. Plain tilt was tried
  first and rejected: Lotus's petals tilt together without parting, so tilt
  flattened it.
- `steep`: the area-weighted 99th percentile of `|∇h|` over triangles.

**Gain.** `k = tan(12.4°) / (4 · opening)`, so at 100% (a stored amount of 2,
doubled) neighbouring layers open 12.4° on average on every model: the corpus
median, which keeps a typical design as it is today. Capped so the steepest
1% of the paper stays within 65° at 100% (31 of 463 corpus designs), but never
below 1, so the cap only limits a boost. A solve that opens nothing keeps 1.
Corpus k: p10 0.46, p50 1.00, p90 2.33; bodo 10.8, two-face fold 0.26, Lotus
0.80.

**Version pinning.** `ConnectedSpread.version` already pins the scale policy.

- Version 1 keeps Perspective's doubling exactly. Every spread in every saved
  file is version 1, and every path that draws a step (live pose, capture,
  Refresh Picture, export) passes the step's own spread through the one
  mapping in `foldedFlatScene.ts`, so no saved step changes.
- Version 2 is equal opening. It differs only in Perspective 3D.

**Where version 2 is written.** Only where it shows, so older builds lock as few
steps as possible:

- A Default spread switched into Perspective 3D.
- A Default spread started fresh while the step is in Perspective 3D (Spread
  Layers turned on, or Default chosen).
- The Update action below.

Everything else keeps the version it has. A remembered pose restored by Show
as keeps its own. New pictures start from the start rule at version 1
(`spreadStartsAmong`); Fold, Edit and export never show Perspective and never
write version 2.

**Update.** A version 1 step in Perspective 3D shows a notice with an Update
button. It converts the step to version 2 at `amount / k`, which draws the same
picture, capped at 100%: only pictures that opened past the new 100% (the
two-face fold) come down. One undo step, counted as the pose action
`spread_equal_opening`.

**Older builds.** A shipped reader treats any connected version other than 1
as a newer build's: a Diagram step shows its saved picture, locked, and is
written back as it came; a Fold step or Edit figure carries it.

## Affected Areas

- `packages/layer-spread/src/opening.ts`, `types.ts`: the measure, `version: 1 | 2`.
- `apps/web/src/layer-spread/equalOpening.ts`: gain, the Perspective height
  scale by version, the version 2 rules and the Update conversion.
- `apps/web/src/cp-workspace/folded/foldedFlatScene.ts`: the Perspective mapping.
- `apps/web/src/cp-workspace/folded/layerSpreadSettings.ts`: reader, the
  `spread-equal-opening` edit, start rule at version 1.
- `apps/web/src/diagram/capture/linkedPose.ts`, `diagram/fold/foldStepActions.ts`:
  version 2 on entering Perspective and on fresh starts there.
- `apps/web/src/diagram/capture/useDiagramLinkedPose.ts`,
  `diagram/fold/useDiagramFoldStepPose.ts`, `components/diagram/DiagramStepPose.tsx`,
  `components/diagram/SpreadEqualOpeningNotice.tsx`: the Update action.
- Analytics: pose action `spread_equal_opening`.
- i18n: two strings in `panels`.

## Checklist

- [x] `spreadOpening` with unit tests (opening of a hinge, shared tilt ignored, area weights, steep percentile)
- [x] `version: 1 | 2`; reader accepts 2, a newer version stays a newer build's
- [x] Gain with calibration, cap and degenerate tests; Perspective mapping by version (version 1 byte-identical)
- [x] Version 2 on entering Perspective and fresh starts there, in linked and Fold steps; start rule at version 1
- [x] Update notice and action in both pose hooks, analytics, i18n for 8 locales
- [x] Relevant vitest, typecheck, lint, i18n check
- [x] Browser: the example file's saved Perspective steps unchanged; Update keeps the picture; a new switch opens bodo visibly

## Verification (2026-11-20)

- `spreadOpening` matches the corpus harness to 8 significant digits on bodo,
  the two-face fold, Lotus and Styracosaurus, so the calibration carries over.
- Tests: the measure (`packages/layer-spread/tests/opening.test.ts`), the gain,
  cap and version rules (`equalOpening.test.ts`), the Perspective drawing by
  version (`posedScene.test.ts`), the file format and start rule
  (`layerSpreadSettings.test.ts`), linked and Fold step poses
  (`linkedPose.test.ts`, `foldStepPose.test.ts`), the Update hook and notice
  (`useEqualOpeningUpdate.test.tsx`, `DiagramStepPanel.test.tsx`).
- Browser, Zach's `separation_bug_example.osf`: both saved steps open as
  version 1 and draw as before, with the notice. Update on bodo keeps the
  picture (Amount 100% → 9%; no point moves more than 0.001 px on a 1000 px
  picture in the Node harness) and 100% then separates its layers. Update on
  the two-face fold brings it down to the new 100%. Undo restores version 1.
  Diagram → Perspective 3D writes version 2. No console errors.
