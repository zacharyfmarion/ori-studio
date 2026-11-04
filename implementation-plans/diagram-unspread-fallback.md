# A Diagram step keeps its picture when its layers can't be spread

## Goal

A Diagram step folded flat starts with its layers spread by Default
(`DEFAULT_LAYER_SPREAD`, the connected spread), which needs a solve. When that
solve fails — over a resource limit ("Spread resource limit exceeded: overlap
regions"), out of time, the worker gone — or its clip does, the whole capture
fails today: "The picture couldn’t be captured", and no folded step can be
added for that model at all.

Instead, the step is captured anyway with its layers unspread — Spread layers
off — and says so. The user can turn Spread layers on again to retry; a retry
that fails again leaves it off and says so again.

One exception keeps today's behaviour: a verb that edits the spread a step
already has — its kind (Affine → Default), a value, its presentation or that
view's camera — leaves the step as it was when the new spread can't be made,
rather than throwing away a spread that works.

## Approach

One shared stage, `connectedFlatPicture` in
`diagram/capture/captureFolded.ts`: a Default spread's solve and clip, or
`unspread` with the cause when its layers could not be spread. Every capture
path that spreads a flat fold by Default goes through it, and on `unspread`
draws the fold unspread and stores its render without `spread` and
`presentation` (`withoutSpread`) — or, for a spread edit (`keepSpread`),
rethrows the cause, so the capture fails as it did before:

1. A linked pattern's one-shot capture (`captureStep`, with or without a
   layer order) — Link, Relink, Refresh, Show as, Duplicate as.
2. A Fold step's capture (`captureFoldStep`) — Refresh, Show as, poses, and a
   pull from Fold (`pullFoldTargets`).
3. A step open in Pose (`captureSession.flatPicture` → `poseLinkedStep`) —
   Show as, Spread layers on, any flat pose but a spread edit. The session
   forgets a failed solve, so turning Spread layers on again solves again.

Each outcome carries `unspread`, and the action layer says it once:
"Its layers couldn’t be spread, so the step shows them unspread. Turn on
Spread layers to try again." A pull from Fold counts them, as it counts the
steps it left out. `diagram picture captured` gains the outcome
`spread_failed`, so we can see how often Default fails on real models.

## Affected Areas

- `apps/web/src/diagram/capture/captureFolded.ts`
- `apps/web/src/diagram/capture/captureSession.ts`, `linkedPose.ts`,
  `poseController.ts`, `stepCaptureActions.ts`
- `apps/web/src/diagram/fold/foldStepCapture.ts`, `foldPull.ts`,
  `foldStepActions.ts`, `foldBrowserActions.ts`
- `apps/web/src/store/workspaceStore/diagramCapture.ts`,
  `diagramFoldCapture.ts`
- `apps/web/src/analytics/events.ts`, `docs/analytics.md`
- i18n catalogs for the new toasts

## Known limit

Spread layers turned on starts from the nearest earlier step's spread, else
Default. A model Default can never solve therefore stays off when it is turned
on again; reaching Affine or Depth for it means turning it on in a step whose
earlier steps use that kind. Offering the kinds while it is off is a separate
design question.

## Checklist

- [x] `connectedFlatPicture` + `withoutSpread`, used by `captureFlatPicture`
- [x] `captureStep` stores the unspread render and reports `unspread`
- [x] `captureFoldStep` and `pullFoldTargets` fall back and report it
- [x] Pose session/linked pose fall back; a failed solve is retried
- [x] Spread edits (`keepSpread`) leave the step as it was
- [x] Outcomes carry `unspread`; toasts and analytics say it
- [x] Unit tests for each path
- [x] i18n extract + translations
- [x] lint, typecheck, relevant tests
- [x] Browser check with a model whose spread fails (a 500-pleat accordion
      hits "overlap regions"; a 5-pleat one still spreads)
