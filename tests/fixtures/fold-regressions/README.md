# Fold regressions

One small Ori Studio project per bug fixed in the Fold workspace for its
launch (2026-10-21). Each is the shortest fold sequence that showed its bug.
Most are built from scratch: every op written by hand, each axiom's root and
each step's fingerprint the engine's, saved as the app saves a project. A few
are bug reports folded in the app and saved from it, with a title and notes
added. None is a user's model. Every step's `note` says what it folds.

`apps/web/src/fold/document/foldRegressions.wasm.test.ts` opens each file as
the app reads a project, replays every step to its stored fingerprint, and
asserts the fixed behaviour on the replayed states.
`apps/web/src/fold/canvas/foldRegressionFlows.wasm.test.tsx` recreates the ghost
precrease and the folded-corner rabbit ear through the canvas tools.

- `ghost-precrease.osf`: a precrease of a flap's corner where the corner lies
  on the corner of the layer under it, which shows past the flap. Clicked on
  the folded pane, the corner took the lower layer's sheet point, the first
  the engine lists there, and the precrease was refused as "The point would
  stay put". Fixed by 0d4470484: the folded pane takes the point on the
  paper on top. With it, f187366ad marks on the crease pattern the point a
  click would take, before the click, and 8f0f4488e has the refusal offer
  "Use the point on the moving flap" when that lands.
- `rabbit-ear-folded-corner.osf` reproduces a rabbit ear on the top layer of a
  corner folded to the center of a precreased square. The tool used to hold
  the loose flap still and turn over the body. The canvas test picks the same
  triangle and hinge, then checks the four panels of the ear land above the
  backing and every uncut face keeps its position and facing.
- `tuck-target-layer.osf`: a mountain fold of a book's top corner tucked into
  its pocket against the back layer, a precrease lying on the fold line and
  splitting that layer. Refused (as "More flaps would move" from the tool,
  `tuck_infeasible` stored). Fixed by 35f40a740 (merge fa3934153), a tuck's
  target is its whole flat layer.
- `squash-covered.osf`: a squash of a triangle whose right corner is folded
  over the hinge. Refused as "The flap is covered". Fixed by d2fd94aab (merge
  ad3e65c0a): paper folded over the upper layer at the hinge rides with it.
- `squash-drawn-hinge.osf`: a squash about a precrease drawn as its hinge, so
  only the tip beyond it squashes. New with c43a92d18 (the engine's
  `Squash::hinge`), bdf246c7c (the step's `hinge`) and b6bde2278 (the tool's
  Hinge choice).
- `edge-crossing.osf`: a flap whose edge crosses the bottom edge and the
  folded edge of the triangle under it at slants, both in view. Neither
  crossing was a point to snap to. Fixed by 602b100b9 (merge 2e493821f): a
  crossing at a flap's edge is a point the viewer sees.
- `repeat-behind-diagonal.osf`: a preliminary base with the front flap's kite
  precreases and petal fold, repeated behind across the diagonal from the
  bottom left corner to the top right. Repeat never offered that diagonal: its
  model map is the identity with every layer pair reversed, and Repeat took
  only a 2D reflection that kept the layer order. It now carries a side and
  repeats behind (`apps/web/src/fold/repeat/repeatBehind.wasm.test.ts`).
- `repeat-big-side-pleat.osf`: a pleat parallel to the diagonal from the
  bottom left corner to the top right, mountain along y = x + 1/4 and valley
  along y = x + 0.15, then its Repeat across that diagonal. A pleat moves the
  side of its mountain that holds its valley: here the big side, across the
  axis. Repeat measured each mirrored step against the paper the source left
  in place, and the mirror of the paper this pleat moved is paper it moved
  too, so the mirrored pleat, the same one folded by hand, was refused
  (`repeat_material`). Fixed by measuring such a step again against paper
  the source moved all alike (`heldGauge` in
  `apps/web/src/fold/repeat/repeatVerification.ts`; more cases in
  `repeatHeldGauge.wasm.test.ts` beside it). Built by a script over the
  engine on 2026-10-25.
- `repeat-diagonal-precrease.osf`: a precrease along the diagonal y = x,
  folded in the app and saved as a bug report (2026-11-26). Repeated across
  the vertical or horizontal center line, its mirror is the other diagonal,
  which Repeat refused as "The spot the mirrored fold picks is not inside a
  layer on the moving side" (`witness_not_in_face`). A mirrored step names
  the layer it folds by the mirror of the source flap's witness, the middle
  of the half the precrease folded. That middle lies on the other diagonal,
  and the mirror takes the other diagonal onto the one just precreased: a
  crease, where no one layer lies. Fixed by taking, when the mirrored
  witness lands on a crease of the paper the mirror folds, the middle of the
  largest part of the mirrored half that one face holds (`mirroredWitness`
  in `apps/web/src/fold/repeat/repeatGeometry.ts`). A book fold repeated
  across a diagonal failed the same way (`repeat.wasm.test.ts`).
- `repeat-after-repeat.osf`: both diagonals precreased, the bottom right
  corner folded onto the center along x − y = 1/2, and that fold repeated
  across the diagonal y = x, to the top left corner. With the Repeat on
  screen, Repeat took the Repeat itself as its range, which it never
  mirrors (`repeat_unsupported`), so the corners left could not be folded
  alike. With no start chosen, a Repeat on screen now ranges over the steps
  it repeated (`repeatRange` in `apps/web/src/fold/repeat/repeatRange.ts`):
  here the corner fold, which lands again across either center line, the
  bottom left or the top right corner onto the center.
  `apps/web/src/fold/repeat/repeatAfterRepeat.wasm.test.ts` prepares both
  and refuses the diagonals; `useFoldRepeatTool.wasm.test.tsx` beside it
  folds the two corners left through the tool. Folded in the app on
  2026-11-26.
- `unfold-to-after-import.osf`: a diagonal precrease and a fold in half,
  then an Import CP of the half fold alone, which drops the diagonal; a fold
  in half the other way; and Unfold to step back to the import. The unfold
  rebuilt its creases from every state since the sheet, so the diagonal came
  back (two creases added) beside the one fold it opened. Fixed by 73fb0959e:
  a return's creases come from its target, or from the last import on its
  path when that is later, through the step it unfolds.
- `reverse-seed-segment.osf`: a strip folded in half along its length, then
  turned up at 45° into an L of two arms, each two layers joined along a
  folded edge; an inside reverse fold of the left arm's end along a free line
  drawn across that arm only. Extended, the line crosses the up arm's end
  too, and the tool's default seed was every layer on it: refused, as
  "Neither kind of reverse fold fits here", since the arms turn only as
  opposite kinds. A free or Axiom 1 line's default seed is now every layer on
  the stretch drawn between its picks (`reverseSegmentSeed`), and a reverse
  fold refused for its tip with more flaps offers the drawn ones when they
  land. `foldRegressions.wasm.test.ts` checks both seeds on the replayed
  state; `apps/web/src/fold/canvas/reverseSeedSegmentFlow.wasm.test.tsx`
  draws the free line and the Axiom 1 line through the tools. Built by a
  script over the engine on 2026-10-21.
- `swivel-at-flap-edge.osf`: a square folded in half, its bottom left corner
  folded up past the folded edge, so the flap's raw edge crosses the folded
  edge at (1/2, 3/8) and hides it below there; then a swivel by its valley
  and mountain, open, both Axiom 1 lines drawn from that crossing, the point
  the folded pane offers there. Refused, as "The lines do not meet on a
  folded edge": the engine measures the folded edge's visible part a probe
  inside its layers, so it started about 1e-4 above the crossing, and the
  swivel took only points within the tolerance of it. It now takes a point
  within half the minimum feature of a visible part's end, as the landmarks
  do for the crossing. `foldRegressions.wasm.test.ts` checks the pick, the
  meeting and the swivel's creases, their letters as seen and the flat
  vertex they make. Built by a script over the engine on 2026-10-25.
- `independent-sides-orders.osf` (KNOWN GAP, open): a square with two flaps
  folded in at the bottom left (the corner onto (5/8, 1/4), then that flap's
  point (1/4, 0) onto (9/16, 1/8)) and the same mirrored at the top right.
  Folding the bottom-right corner up along x - y = 9/16 lands across both
  sides, three ways each (under both of a side's flaps, between them, or on
  top): nine orders. The chooser builds its list from tuck recipes, each of
  which pins one side, so it lists six and never both sides between. A
  listing of every flat stacking (fold-launch/solved-orders) was reverted for
  the launch: it also offered stackings a fold cannot reach by moving.
  `apps/web/src/fold/orders/independentSidesOrders.wasm.test.ts` checks the six
  today and holds the nine as an expected failure until each side's reachable
  orders are combined. Built by a script over the engine on 2026-10-21.
