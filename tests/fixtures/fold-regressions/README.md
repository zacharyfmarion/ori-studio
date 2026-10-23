# Fold regressions

One small Ori Studio project per bug fixed in the Fold workspace for its
launch (2026-10-21). Each is the shortest fold sequence that showed its bug,
built from scratch: every op written by hand, each axiom's root and each
step's fingerprint the engine's, saved as the app saves a project. None is a
user's model. Every step's `note` says what it folds.

`apps/web/src/fold/document/foldRegressions.wasm.test.ts` opens each file as
the app reads a project, replays every step to its stored fingerprint, and
asserts the fixed behaviour on the replayed states.
`apps/web/src/fold/canvas/foldRegressionFlows.wasm.test.tsx` makes the ghost
precrease through the tools, clicks and all.

- `ghost-precrease.osf`: a precrease of a flap's corner where the corner lies
  on the corner of the layer under it, which shows past the flap. Clicked on
  the folded pane, the corner took the lower layer's sheet point, the first
  the engine lists there, and the precrease was refused as "The point would
  stay put". Fixed by 0d4470484: the folded pane takes the point on the
  paper on top. With it, f187366ad marks on the crease pattern the point a
  click would take, before the click, and 8f0f4488e has the refusal offer
  "Use the point on the moving flap" when that lands.
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
