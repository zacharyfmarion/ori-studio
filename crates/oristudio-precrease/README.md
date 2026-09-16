# oristudio-precrease

Geometry for Ori Studio's precrease planner (the References workspace): the
part of the planner that has to exist before any folding step is computed.

- `frame` — one rectangular sheet in Oriedita model space (y-down) and the maps
  to the planner's unit rectangle (y-up, lower-left origin, longer side = 1) and
  to ReferenceFinder's `(w, h)` rectangle.
- `line` — canonical infinite lines `n · p = d` with a unit normal, tolerance
  equality that resolves the `(n, d) ~ (−n, −d)` identification at compare time,
  and a quantised hash key.
- `merge` — collinear segments of a crease pattern become one line.
- `outline` / `components` — border creases are chained into loops; a loop that
  is a rectangle in any orientation becomes a sheet frame, and every crease is
  assigned to the sheet that contains it. Non-rectangular loops are refused.
- `exactness` — the residual probe that classifies a component as `exact`,
  `snappable` (planned on a snapped copy) or `off_lattice`, and the snap itself.

`analyze(segments, colors, paper_fallback)` runs the whole pipeline and returns
a serde-friendly `SheetAnalysis`. The planner proper (closure, certificates,
stuck search) lands in later phases of
`implementation-plans/reference-finder-integration.md`.

The crate is original work under `MIT OR Apache-2.0`: it depends on nothing in
the TreeMaker port and ports no code from ReferenceFinder. The header of
`src/lib.rs` states exactly what is adopted from ReferenceFinder and how.
