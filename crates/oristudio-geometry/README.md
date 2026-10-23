# oristudio-geometry

Shared origami geometry for Ori Studio, used by the precrease planner
(`oristudio-precrease`) and the Fold engine (`oristudio-fold`):

- `tol` — the one tolerance, in unit-sheet units and radians, and its
  derivation from Oriedita's point epsilon.
- `line` / `pointgrid` — canonical infinite lines `n · p = d` with tolerance
  equality that resolves the `(n, d) ~ (−n, −d)` identification at compare
  time, and tolerance-aware line and point indexes.
- `frame` / `sheet` / `outline` — one rectangular sheet in Oriedita model space
  (y-down) and its maps to the unit rectangle (y-up, lower-left origin, longer
  side 1); the unit rectangle itself; border creases chained into loops, a
  loop that is a rectangle in any orientation becoming a frame.
- `paper` / `construct` — the seven Huzita–Justin constructions over a `Paper`
  (anything that can say whether a point is on it, where a line runs on it and
  whether a fold crosses it), their certificates, and the nearest root for
  replay.
- `convex` — convex-polygon primitives: orientation, clipping, half-plane
  splits, overlap.

All but `paper` and `convex` moved here from `oristudio-precrease`, which
re-exports them unchanged.

Original work under `MIT OR Apache-2.0`. The header of `src/construct.rs`
states how the constructions relate to ReferenceFinder. See
`implementation-plans/fold-workspace.md` (D9) for why these live together.
