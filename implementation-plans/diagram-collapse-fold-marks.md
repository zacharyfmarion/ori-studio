# Diagram: a collapse's folds as marks

## Goal

A Fold step that imports a crease pattern — Import CP, or a collapse linked to
the project's CP (`cp-jump`) — shows its mountain and valley folds when it is
pulled into the Diagram, as editable line marks on the folded picture, the way
a rabbit ear or a petal fold shows every crease it folds. Today the card shows
only the state before the step, every crease a plain existing crease, and the
words "Collapse."

## Approach

- The engine names no line or arrow for an import (`stepAction` is null), so
  the capture made no marks for it. The Diagram already reads "every crease a
  step folds" off the states either side of a step (`stepFoldedCreases`, used
  for rabbit ears, petals, squashes and swivels): each crease folded in the
  state it lands that was not folded the same way before, placed where the
  state before puts it, in the letter the viewer sees, only where the viewer
  sees it, collinear stretches joined.
- A collapse's picture is exactly that, with no arrow: add one entry to the
  mark plan (`foldStepMarkAction`) that places an engine picture as before, and
  for a `cp-jump` with no engine picture draws the creases it folds. The
  capture (`readFoldStepCapture`) calls it, so first capture, refresh, re-pose
  (`useDiagramFoldStepPose`) and the spread view all get the same marks.
- Marks go through the existing `foldStepMarks` path: `valley-line` /
  `mountain-line` annotations tagged `imported: 'untouched'`, so they are
  editable, a refresh brings the step's own again, and the lines-under-marks
  rule hides the existing crease each mark lies along.
- Precreases the collapse leaves flat stay existing creases; creases the state
  before already folded the same way are not repeated.
- Cost: a collapse reads every crease of the pattern against every face of the
  state before it. From a sheet precreased into a 32×32 grid (1,024 faces), a
  1,211-fold corpus pattern took 828 ms on the main thread. The crease reader
  now boxes the state's faces and stacks once and tests a point or a stretch
  only against those it can touch: 204 ms, output identical on 8 corpus cases
  (4 patterns, plain and precreased). From a plain sheet it is 8–65 ms.

## Affected Areas

- `apps/web/src/diagram/fold/foldStepMarkPlan.ts` — `foldStepMarkAction`, the
  collapse's action.
- `apps/web/src/diagram/fold/foldStepCapture.ts` — use it.
- `apps/web/src/diagram/fold/foldStepPicture.ts` — docs.
- Tests: `foldStepMarkPlan.test.ts` (unit), `foldStepMarks.wasm.test.ts`
  (real engine: a collapse from a plain sheet and from a precreased one).

## Checklist

- [x] `foldStepMarkAction` + collapse action in the mark plan
- [x] Capture uses it for the step before a collapse
- [x] Unit tests
- [x] Wasm tests over a real import
- [x] Timing on a large corpus CP
- [x] Browser check: before/after of a pulled collapse card
- [ ] Lint, typecheck, relevant tests; draft PR
