# Pose: turn a Default spread live

## Goal

Turning a linked step in Pose while its flat fold is spread by Default
(connected) — Rotate Left / Right on the toolbar, or the Step pane's Rotation
field — shows the new turn at once, with no "Preparing pose…" veil, and takes
the next turn while the step's picture is still being captured.

Today every turn is a blocking capture (`poseCaptureBlocksViewport`): the veil
covers Pose until the step's stored picture is recaptured, and the turn verbs
wait for that capture. On the large project from the report (step 168 of
`broken_bodo.osf`, 205 steps), one Rotate Right held the veil for ~0.85 s:
~50 ms choosing creases and projecting, ~410 ms clipping the vector picture in
the capture worker, ~365 ms storing and committing it. Nothing is folded,
canonicalized or solved again; the fold, its prepared spread and the solve are
all held. The live spread renderer already draws any turn from what it holds
(`posedSpreadScene(view, rotationDeg, …)`, ~0.2 s on that step), so only the
stored picture needs the capture, and it can run behind the view, as a reveal
drag's and an orbit's already do.

## Approach

- A Default spread's turn shows live (`turnsLive(render)`, beside the turn
  step in the pose action catalog). Rotate Left and Right stay live while a
  capture runs; every other verb still waits.
- `linkedPose.ts` gets one rule for where a turn verb leaves a pose
  (`turnedTo`), used by both the crease-pattern and flat branches and by the
  controller, so a run of presses accumulates from the turn shown rather than
  the turn stored.
- The pose controller gains `turn(request)`: on a live render it computes the
  target from the turn shown, tells its listener (`turn`), and captures
  `rotate-to` through the shared per-step queue (`queueStepPoseEdit`, key
  `turn`), in the background (`background: true` — no veil, the spread preview
  left up) and counted as the verb pressed (`trackedAs`). A newer turn replaces
  one waiting and drops one in flight, so a run of presses commits once, where
  it ends. The shown turn clears once its capture has landed or was dropped. On
  any other render it runs the verb as before. A detail closed with a turn
  pending captures it before letting the fold go, as a resting orbit is.
- `useDiagramLinkedPose` routes the turn verbs and `rotateTo` to
  `controller.turn`, and publishes the turn shown (`turn`).
- `DiagramStepDetail` draws the live spread at the turn shown;
  `DiagramSpreadView` uses the captured picture and the annotation ghost only
  while the turn shown is the captured one.
- The Step pane's Rotation field shows the turn shown and is held as the turn
  verbs are, not by any verb waiting.

Unchanged: crease patterns and other flat renders (no live view to draw a turn
before its picture lands), Upright, Reset, Turn Over, the Layer order dialog's
Rotate, and Fold-derived steps (their own pose path, `useDiagramFoldStepPose`).

## Affected Areas

- `apps/web/src/diagram/actions/diagramLinkedPoseActions.ts` (+ test)
- `apps/web/src/diagram/capture/linkedPose.ts`
- `apps/web/src/diagram/capture/poseController.ts` (+ test)
- `apps/web/src/diagram/capture/useDiagramLinkedPose.ts` (+ test)
- `apps/web/src/components/diagram/DiagramStepDetail.tsx`
- `apps/web/src/components/diagram/DiagramSpreadView.tsx` (+ test)
- `apps/web/src/components/diagram/DiagramStepPose.tsx`

## Checklist

- [x] `turnsLive` and live turn verbs in the action catalog, with tests
- [x] `turnedTo` in `linkedPose.ts`, used by both turn branches
- [x] `PoseController.turn`: shown turn, queued background capture, flush on dispose
- [x] Hook routes turns and publishes the turn shown
- [x] Spread view draws the shown turn; captured picture and ghost only when it matches
- [x] Step pane Rotation field follows the turn shown
- [x] Controller, hook and view tests
- [x] Verified in the browser on the reported project: no veil, turns accepted while capturing

## Verification

Step 168 of `broken_bodo.osf`, Default spread, reveal on, in the dev server:

- Before: one Rotate Right raised the veil for ~0.85 s, every press.
- After: no veil; the live view drew the turned spread 73–136 ms after the
  press while the picture was captured behind it (~0.8 s); three quick presses
  showed 45° at once and landed as one "Adjust pose" undo step at 45°; the
  Rotation field typed 200 and then + both landed; an undo while a turn was
  pending dropped it and the view followed the undone turn.
- The first turn after the detail is closed and reopened folds again in its
  background capture: the hook keeps the prepared live view across the new
  controller, whose session holds no fold yet. That predates this change; the
  fold no longer shows, but other verbs wait for it.
