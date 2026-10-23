# Repeat: the axis on the paper, and repeat behind

## Goal

Repeat's symmetry axis is a line on the paper, named by where it runs on the
crease pattern, shown on both panes, hovered to preview and clicked to pick,
or drawn with the usual line modes on either pane. Repeat works out from the
folded state at the range's start whether the mirror keeps the layer order
("Repeat on the other side") or reverses it ("Repeat behind"), and repeating
behind works: a crane's back petal fold from its front one.

## Approach

### Root cause (confirmed on `crane_new.osf`)

Before the kite precreases, the sheet diagonal that takes the front flap to
the back one has a model map that is the **identity**, with every layer pair
reversed: the 3D symmetry is the mirror through the paper's plane.
`verifiedSymmetry` read the model map and required a 2D reflection
(`reflectionLine`), so it refused the diagonal before the layer-order check
(which only allowed kept orders) was reached. The "Vertical axis" it offered
is the other diagonal, which mirrors the front flap onto itself.

A 2D reflection with the layer order reversed is a half-turn about a line in
the paper's plane: it takes the paper's front to its back, so every mirrored
crease would change its letter on the paper. The coordinator's invariant
(same assignment on the paper) refuses that, so the accepted symmetries are:

| Model map | Layer order | Side |
| --- | --- | --- |
| reflection | kept | same (as today) |
| identity or half-turn | reversed | behind |

Both keep each crease's mountain/valley on the paper; only viewer-relative
words flip behind.

### The invariant, per repeated step

For every repeated step (`verifyMaterial`): its new creases are the source
step's reflected through the sheet axis, each with the same assignment on the
paper; the moved paper lands in the mirrored pose; and the layer order among
the mirrored faces is the source's, kept on the same side and reversed behind
(times the views' turn-over). Anything else is refused.

### Mirroring by matching

Mirror the geometric inputs (sheet points, model vectors and roots through the
frame), then try the viewer-relative variants — direction, and behind, a
reverse fold's or crimp's opening by its lower block — and keep the variant
whose result passes the invariant. None passes: refused with the predicted
variant's reason. Two pass with different results: refused as ambiguous.
Explicit rules remain only where matching cannot decide: turn and rotate (they
move no paper), a pleat and a swivel by its valley and mountain whose letters
would have to trade places (refused behind with their own reasons).

### Saved form

`FoldRepeatOp.side?: 'behind'`, written only behind; a file without it reads as
today. The saved steps are already mirrored, so replay never recomputes it.

### UI

Axes drawn on both panes (sheet line on the crease pattern, its image on the
folded pane), hovered to preview, clicked to pick, named by where they run on
the crease pattern. Drawing an axis uses the line modes (Existing crease, the
axioms, Free line with snap) through the shared locating machinery; on the
crease pattern the line is the sheet line, on the folded pane it is read on
the top layer under it.

## Affected Areas

- `apps/web/src/fold/repeat/` — geometry, verification, mirroring,
  preparation, words, window, canvas, tool hook.
- `apps/web/src/fold/document/` — `side` on the Repeat op.
- `apps/web/src/fold/stepSentence.ts`, `diagram/fold/foldDiagramSentence.ts`.
- Canvas: `fold/canvas/useFoldCanvasVerbs.ts`, `components/fold/canvas/FoldCanvas.tsx`.
- Analytics: `analytics/trackFold.ts`, `docs/analytics.md`; locales.

## Checklist

- [x] Confirm the root cause on the user's model
- [x] Accept behind symmetries (identity/half-turn, reversed) and carry the side
- [x] Invariant with side; mirroring by matching; explicit refusals
- [x] A crease on the axis turns by the source's fold-angle change (squash beside the axis)
- [x] `side` on the saved op, read and written
- [x] Words: axis names, window, step and Diagram sentences, 8 locales
- [x] Axes on both panes, hover preview, click pick
- [x] Draw an axis with the line modes on either pane
- [x] Analytics properties and docs
- [x] Proof: crane_new and petal-fold, engine vs by hand
- [x] Regression fixture `tests/fixtures/fold-regressions/repeat-behind-diagonal.osf`
- [x] Fixture fingerprints: every saved step replays to its stored fingerprint
      (435 steps, 47 Repeats; only crane.osf's 4 later steps and
      layer_order_choice.osf's swivel differ, as before)
- [x] Browser proof, screenshots (`artifacts/repeat-axis/`), saved .osf
      (`artifacts/repeat-behind.osf`, `artifacts/crane-new-repeat-behind.osf`)

- [x] Offer only axes that land: every listed axis prepared up front, one at a
      time (`repeatPrepared`); the remembered axis while it lands, else the
      first that lands; a refused one disabled in the list with its reason,
      drawn dimmest on the panes and never under the pointer. Measured in Node:
      crane_new 1–15 ms per axis, plantient_dragon (87 faces) 12–14 ms per axis.

### Notes

- Diagram's merge of mirrored precreases (`mirroredStepAxis`) stays same-side
  only: a front and a back precrease are still two Diagram steps.
- The Repeat tool's name is now "Repeat" (rail, menus, window title); the
  commit and the sentences say "on the other side" or "behind".
