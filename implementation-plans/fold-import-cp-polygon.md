# Import CP on polygon sheets

## Goal

Import CP (and so Collapse from CP) lands on every sheet the Fold workspace
starts from, not only squares and rectangles: a regular hexagon or pentagon,
any convex 3–8-gon. Today `import_cp` refuses `import_shape_unsupported`
whenever the pattern's border is not a rectangle (`{"source":"pattern"}`) or
the sequence's sheet is not an axis-aligned rectangle (`{"source":"sequence"}`),
so a sequence on a polygon sheet has no CP route at all.

Rectangles stay byte-identical: every existing import test and fixture passes
unchanged, except the assertions that encoded the polygon limit itself.

## Approach

The limit is all in `crates/oristudio-fold/src/import/placement.rs`: the map
from the input's coordinates onto the sheet is the outline code's rectangle
`Frame`, a quarter turn and a per-axis scale, and `recover` refuses whatever
that cannot express.

- Keep that path exactly as it is when the pattern's border is a rectangle and
  the sequence's sheet is an axis-aligned rectangle (or there is none).
- Every other case goes through a new outline path:
  - The pattern's corners (the border loop's, collinear vertices dropped) as
    the picture is drawn, y-up, counter-clockwise.
  - A border that is no sheet Fold folds (bends inward, a side too short) is
    still refused `import_shape_unsupported` with its corners
    (`UnsupportedShape::Pattern`). `UnsupportedShape::Sequence` goes: every
    sheet is a convex polygon, so every sequence's sheet can be matched.
  - An empty sequence adopts the pattern's polygon, normalised exactly as
    Import starting sheet (`starting_sheet`) does.
  - Fit: for each cyclic pairing of the pattern's corners with the sheet's,
    the least-squares similarity (turn, scale, shift; never a mirror, so the
    letters keep their meaning). It fits when every corner lands within `TOL`.
    Of the fits, the smallest turn (ties counter-clockwise), so a pattern drawn
    as the sheet lies is not turned. A pattern already in the sheet's frame
    (the state's own crease pattern) maps through exactly the identity.
  - No fit: `import_shape_mismatch`, as a new `OutlineMismatch` variant with
    both outlines' corners (the rectangle `ShapeMismatch` payload is
    unchanged; the web already words a mismatch without ratios).
  - Mapped points within `TOL` of a sheet corner land exactly on it.
- Bridge: an empty sequence's adopted paper may be a polygon
  (`AdoptedPaper::Polygon`), which the document already stores.
- Web: the adopted paper type gains the polygon; Edit's folded figure into an
  empty sequence adopts its outline as a polygon when it is not an
  axis-aligned rectangle (`foldShapeOfOutline`); an adopted polygon of more
  than 8 sides is refused locally (`sheet_sides`), as Import starting sheet
  does. The `import_shape_unsupported` words now say what it means: a border
  that is no convex sheet.

## Affected Areas

- `crates/oristudio-fold/src/import/placement.rs`, `import/mod.rs`
- `crates/oristudio-fold/tests/import.rs` (hexagon and pentagon tests),
  `tests/beloch_replay.rs` comments, `README.md`
- `crates/oristudio-fold-wasm/src/io/wire.rs`, `io/imports.rs`, `tests/io.rs`
- `apps/web/src/fold/engine/foldEngineIoWire.ts`,
  `apps/web/src/fold/io/foldImportFlow.ts`, `foldImportRefusal.ts`, locales

## Checklist

- [x] Outline path in `placement.rs`: fit, adopt, snap, inverse
- [x] Refusals: `OutlineMismatch`, `UnsupportedShape::Pattern` for non-convex,
      drop `UnsupportedShape::Sequence`
- [x] Rust tests: identity control on hexagon and pentagon after folds; a
      collapse after an unfolded precreased state; turned and scaled patterns;
      non-convex and mismatched borders refused
- [x] Bridge: adopted polygon paper; wasm io test updated
- [x] Web: adopted polygon type, `foldShapeOfOutline`, side cap, refusal words
      and translations
- [x] Rebuild the fold bridge; identity control on the real hexagon model
      (outside the repo), renders under `artifacts/fold-import-cp-polygon/`
- [x] fmt, clippy, tests; web typecheck, eslint, nearby vitest, i18n check
- [x] App gate: Import CP was disabled on a polygon sheet with steps
      (`foldActions`, workspace capabilities); removed with the inputs that
      only fed it
- [x] Browser: a hexagon `.fold` dropped on an empty sequence adopts the
      hexagon; a six-spoke collapse dropped after it lands the 60° wedge
- [ ] Draft PR

## Notes

- The least-squares fit is summed in the sheet's corner order, so a pattern
  whose corners are the sheet's (a state's own crease pattern) gets factor
  exactly `1 + 0i` and shift exactly `0`: every vertex comes back to the bit.
  Face images still differ from the original state's by rounding, since the
  import derives isometries anew from the creases (the rectangle round trip
  is the same).
- Send to Edit then Import CP on polygons: every vertex within the last bit,
  as on rectangles; the `fs1` keys quantise a sliver's centroid, so one key of
  the seeded polygon states lands a unit over. That test compares keys to a
  unit; the rectangle one is unchanged.
