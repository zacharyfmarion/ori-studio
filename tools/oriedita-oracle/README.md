# Oriedita Oracle

This directory contains the staged headless oracle harness for the Oriedita
port. It currently exposes geometry/model primitive commands, Stage 4
import/export commands for Oriedita's ORH, OBJ, and DXF paths, and Stage 5
arrangement commands for `IntersectDivide`, `FoldLineSet` insertion splitting,
delete-inside-line modes, and `BranchTrim`/`del_V` cleanup. Later stages should
extend the same pattern for documents, operations, checks, and folding
snapshots. The vertex cleanup commands include the same-color, color-changing,
single-pair, and all-vertex variants. The arrangement repair commands include
the legacy `Fix1`/`Fix2` workers. Color commands cover
`FoldLineSet.setColor(Collection, LineColor)`, make mountain/valley/edge/aux,
advance type, mountain/valley toggling, and overlapping-line MV alternation.
The crossing-line MV alternation handler is covered separately from the
overlapping-line variant because it uses intersection sorting from the drag
endpoint. Line-click coverage includes change-crease-type and the line-segment
portion of delete-line; circle and separate aux-line delete modes remain staged
separately. Measurement commands cover Oriedita's display length and
three-point angle handlers. Point-tool coverage includes `DRAW_POINT_14`'s
segment-splitting behavior after the target point and segment are resolved.
Construction coverage has started with free/restricted draw-crease line
insertion for fold-line and aux-line targets, plus symmetric drawing of
selected lines across a resolved axis. Circle coverage has started with
restricted, free, and three-point circle creation, separate circles, concentric
circle variants, inversion of circles/segments through circles, and
`OrganizeCircles` pruning after inputs have been resolved to model coordinates.
Circle custom-color coverage includes resolved circle targets and cyan
auxiliary-line targets, including Oriedita's value-based duplicate lookup.
Tangent-line coverage has started with point-circle and common two-circle
indicator generation. Generator coverage has started with regular polygon
creation from two resolved points and the polygon corner setting.
The first selection commands cover select/unselect all, index selection, box
selection via `lineSegmentsInside`, polygon selection via `select_Takakukei`,
line-overlap/intersection selection via `select_lX`, and
`selectProbablyConnected`. Selection-dependent type commands cover selected
line deletion, line-type replacement, and line-type deletion. Transform
commands cover FoldLineSet translation plus selected move/copy and four-point
selected move/copy. The lengthen groundwork includes
`OritaCalc.extendToIntersectionPoint_2`. Point-tool commands cover the
line-only portions of count-based and ratio-based segment division, including
the worker-style line insertion splitting used by the handlers.
Folded-render oracle coverage has started with a recording Java2D adapter that
captures the real `FoldedFigure_Drawer` output as deterministic primitive
records. The first scoped command is `folded-render-paper-front simple-square`;
later render commands should extend the same primitive schema instead of
reimplementing Oriedita drawing logic inside the oracle harness.

The oracle intentionally compiles against a pinned Oriedita source checkout
instead of reimplementing the behavior in Rust.

## Baseline

The native document interchange plan targets Oriedita commit
`9d39135ae232cc03be4ffaf74baa7ae2df970507`. Build oracle fixtures against that
checkout unless `implementation-plans/oriedita-source-map.md` and
`implementation-plans/oriedita-native-document-interchange.md` are updated in
the same change.

```bash
ORIEDITA_SOURCE=/private/tmp/oriedita-research tools/oriedita-oracle/build_geometry_oracle.sh
ORIEDITA_GEOMETRY_ORACLE=tools/oriedita-oracle/build/oriedita-geometry-oracle \
  cargo test -p oristudio-cp \
    --test oriedita_geometry_oracle \
    --test oriedita_model_oracle \
    --test oriedita_io_oracle \
    --test oriedita_operations_oracle
```

`ORIEDITA_IO_ORACLE` and `ORIEDITA_OPERATIONS_ORACLE` can also point at the
same built wrapper for scoped parity runs. If the oracle environment variables
are unset, the Rust oracle tests exit early so normal `cargo test -p
oristudio-cp` does not require Java.
