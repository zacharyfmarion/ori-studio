# Diagram: Upright, any angle, and a fold-and-unfold arrow's return

## Goal

Zach, 2026-10-05.

1. Step 22 of the crane (the finished crane, a flat fold) could not be turned
   upright: "it feels like ideally I could input in 0-360 degrees … I
   basically want the axis of symmetry to be upright." The crane is a 22.5°
   design: its mirror axis is upright at 157.5°, between the 15° stops of
   Rotate Left / Right, and the Rotation field rounds what is typed to whole
   degrees. Agreed: an **Upright** verb, and the field taking any angle.
2. "When I select the fold and unfold arrow, I can only edit the first half of
   it as a path … I should be able to edit both parts of it." The return is
   drawn from the outgoing stroke (`pathReturn`), so Edit Path has nothing of
   it to hold.

## Approach

### Upright and any angle

- **Any angle.** The Step pane's Rotation field keeps what is typed to a tenth
  of a degree (its arrows still step 15°, as Rotate Left / Right do). The
  file already reads any angle (`normalizeDegrees`), so nothing else changes.
- **Upright**, a flat fold's pose verb, on Pose's toolbar: it turns the picture so one of the fold's mirror axes is
  vertical. Each axis stands two ways, half a turn apart: a press takes the
  one nearest the turn the step has, and a press on an upright turn takes the
  same axis the other way up.
- **Measured on the fold, not the drawing.** The capture session holds the
  kernel's folded faces before any turn or spread (`hold.read`); the axes are
  the lines through the outline's centroid that map its corners and edge
  midpoints onto themselves (`mirrorAxes`, pure). A spread is not symmetric
  (the affine one pulls layers toward the sheet), so measured on the drawing
  the crane's axis is off by 0.4°; on the fold it is exact.
- **Held until known.** The controller reports a flat fold's axes with each
  pose (as it reports its layer orders); Upright is on until then, and held,
  saying why, once a fold is known to have none. A press on a fold not yet
  folded in this session folds it first, as every verb does.
- Not for a crease pattern (a sheet has no up) or a 3D or simulated step (no
  turn in the page there today).
- Counted as a pose verb: `diagram picture posed` gains `upright`.

### A fold-and-unfold arrow's return

- **A path of its own.** A shaped fold-and-unfold arrow may carry `back`: the
  return's nodes after the tip, the tip being the outgoing path's last node,
  whose `out` handle starts the return. Drawn, the return is that path,
  stopped short for its head; without `back` it is derived as now.
- **Edit Path shows both halves**: the outgoing path's nodes, then the
  return's, as one run through the tip. Until the return is edited its nodes
  are the derived return's, fitted with one cubic for each outgoing segment;
  the first edit of a return node or the tip's `out` handle writes them as
  `back`. An edit of the outgoing half leaves a derived return derived.
- **The tip and the return's end are ends**: not deleted, and no corner or
  smooth (the tip is where it turns back).
- Everything that moves a path moves `back` with it: a drag of the whole
  arrow, a paste, a carry with the picture, a flip; the file reads and writes
  it; Reset Shape drops it.

## Affected Areas

Upright: `diagram/capture/mirrorAxes.ts` (new), `captureSession.ts`,
`linkedPose.ts`, `poseController.ts`, `useDiagramLinkedPose.ts`,
`actions/diagramLinkedPoseActions.ts`, `components/diagram/DiagramStepPose.tsx`,
the Pose toolbar, `analytics/`, `docs/analytics.md`, the catalogs.

Return: `document/diagramDocument.ts`, `document/diagramFile.ts`,
`annotate/annotationModel.ts`, `annotate/annotationPath.ts`,
`annotate/annotationPrimitives.tsx`, `cp-workspace/references/stepDiagramGeometry.ts`
(`pathArrowGeometry`), `references/diagram/DiagramPrimitives.tsx`,
`markReach.ts`, `annotate/annotationHit.ts`, `annotate/useAnnotateCanvas.ts`,
`lib/cubicBezier.ts` (a cubic fit).

## Checklist

- [x] Rotation field to a tenth of a degree; tests.
- [x] `mirrorAxes` and `uprightTurn`, pure, with tests (one axis, several, none, noise).
- [x] Session, verb, controller report, catalog action, analytics, i18n; tests.
- [x] Browser on the crane's step 22: Upright to 157.5°, again to 337.5°, 157.5 typed; before/after.
  - As built: Upright is on Pose's toolbar only, not beside the Rotation
    field: Zach's pass on the Step pane in Pose made the pose verbs "the
    toolbar's alone", and its test holds the pane to that. The fold's axes
    are measured on its faces' corners and the points a third of the way
    along each edge, not their middles: a square creased along one diagonal
    has symmetric corners and middles (the diagonal's middle is the centre)
    but no mirror axis.
- [ ] The return's nodes: model, file, drawing, Edit Path (derived until edited), moves, Reset; tests.
- [ ] Browser: a fold-and-unfold arrow shaped by both halves; before/after.
