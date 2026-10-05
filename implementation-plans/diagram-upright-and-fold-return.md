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
`annotate/derivedReturn.ts` (new), `annotate/canvasInk.ts` (new),
`annotate/annotationActions.ts`, `annotate/applyAnnotationEdit.ts`,
`annotate/annotationPrimitives.tsx`, `cp-workspace/references/stepDiagramGeometry.ts`
(`pathArrowGeometry`), `references/diagram/DiagramPrimitives.tsx`,
`markReach.ts`, `annotate/annotationHit.ts`, `annotate/useAnnotateCanvas.ts`,
`components/diagram/DiagramAnnotateCanvas.tsx` (the hairline),
`lib/cubicBezier.ts` (a cubic fit), `analytics/`, `docs/analytics.md`.

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
- [x] The return's nodes: model, file, drawing, Edit Path (derived until edited), moves, Reset; tests.
  - As built: the return Edit Path shows is the one the arrow is drawn
    with. An arc never shaped is drawn with its own return arc
    (`returnStroke`), not a path's, so its return nodes are that arc exactly
    (`arcReturn`, one cubic: the return turns a quarter); a path's are fitted
    to `pathReturn` (`derivedReturn`): a piece per outgoing segment, a corner
    node where the drawing cuts a loop out (a turn over 20°), then the piece
    that strays most halved until every one is within a tenth of an ink.
    Measured: a 60° arc's path return 0.06 ink off with no halving; the test
    S needs eight return nodes from the tip, one a corner. A first fit with one cubic per
    segment and no corners was a full ink off on that S.
  - The tip is a corner in the run, so dragging a handle on one side of it
    never swings the other's. Only the tip, and the return's one node past
    it, cannot be deleted; the return's end can, once there is a node before
    it. Each half counts against `MAX_PATH_NODES` on its own, as the file
    holds them (a run cleaned as one would have cut the return short).
  - Flip Arc and Flip mirror the return with the path, Flip about the middle
    of both; a straight path with a return off its chord still flips.
  - The Edit Path hairline runs through the shown nodes, out and back.
  - `diagram arrow return shaped` counts a return first made its own, by the
    gesture, at the same chokepoint as `diagram arrow shaped`.
- [x] Browser: a fold-and-unfold arrow shaped by both halves; before/after.
  - `artifacts/diagram-second-pass/p17f.mjs` (an arc: before, 3 nodes and a
    drag on the return that does nothing; after, 4 nodes on the drawn
    strokes and the drag bends the return alone) and `p18g.mjs` (a shaped
    S: 9 nodes on the drawn line, the return's end dragged with the path
    unchanged, the tip moved with the return starting from it).
  - Not changed, noted: an arc's first edit on its outgoing half still
    switches its return from the arc's own to the path's (`pathReturn`),
    which ends a little elsewhere beside the tail. That was so before; an
    edit to the return first keeps the arc's return where it was drawn.
