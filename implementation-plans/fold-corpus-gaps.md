# Fold: three gaps from recreating tutorials

## Goal

A study that recreated a set of published tutorials in the Fold workspace
found three gaps that a small, local change closes:

1. **Petal fold on a doubled flap.** On a squashed flap, as in the frog base,
   the flap's top ply ends at a raw edge and the ply under it runs on to its
   own corner. The petal fold uses one kite line per side for both plies, so
   it either refuses the paper past the top ply's corner (`past_corner`) or,
   over the usual precreases, folds a kite that is not flat at H's ends and
   fails with `residual`.
2. **The edge-onto-line swivel's `swivel_fold_wide` refusal is a dead end.**
   The form builds only the branch where the edge's layer turns once; the
   other branch is exactly what the Swivel tool's "Valley and mountain" mode
   folds. The notice should say so and offer the switch.
3. **Open sink with staying paper in a pocket.** The open sink anchors each
   tip face directly against its own piece, and copies that piece's order onto
   the tip. When staying layers lie on the piece inside the pocket, no order
   is left (`no_order`), though the sink folds.

## Approach

1. In `compound/petal.rs`, each ply gets its own kite line at each end of H.
   At an end, with `a` the angle between H and the closed edge below it, the
   creases there are flat (Kawasaki, the closed edge below the end unfolding)
   exactly when the top ply's kite and the second ply's kite make angles with
   the closed edge that add up to `a`. So a ply's kite is its own flat
   precrease from the end, or the Kawasaki partner of the other ply's; with
   neither precreased (H by two points), both are the bisector, as before.
   Each candidate pair is checked per ply: the kites meet below H, and no
   paper of that ply lies past its own corner. The first pair that passes is
   folded, preferring precreased kites; none passing is the first candidate's
   petal refusal, never `residual`. The compile turns each ply about its own
   kite. The analysis keeps `kites`/`corner` as the top ply's (what the
   preview lights) and adds the second ply's.
2. In the web app, the `swivel_fold_wide` refusal's notice says the fold
   needs the layer to crease twice and offers switching the Swivel tool to
   Valley and mountain, through the fix-verb mechanism the other vertex
   refusals use.
3. In `compound/sink.rs`/`compound/mod.rs`, the open sink keeps anchoring
   each tip face directly on its piece whenever an order allows it, so no
   landing it finds today changes. When staying paper lies inside a pocket
   (unmarked paper past the piece, short of the next point layer's paper)
   and that strict anchor leaves no order, each tip face is seeded only past
   its piece and short of the next layer, and the completion places it among
   that paper. Forcing every tip face past the pocket paper, as first
   proposed, is wrong for the real case: one layer's tip rides over the flap
   while the tip of the layer on the pocket's other side stays on its own
   piece.

## Affected Areas

- `crates/oristudio-fold/src/compound/petal.rs`, its tests
  (`tests/petal.rs`, `tests/vertex/cases.rs`); the wasm bridge's petal
  analysis and `apps/web/src/fold/engine/foldEngineSquashWire.ts`.
- `apps/web/src/fold/tools/vertex/vertexRefusal.ts` and the swivel tool's
  refusal handling, i18n catalogs, tests near it.
- `crates/oristudio-fold/src/compound/sink.rs`, `compound/mod.rs`, tests
  under `tests/sink*`.

## Checklist

- [x] Petal: per-ply kites, per-ply corner check, per-ply turns; precreased
      kites that are not flat refuse as a petal refusal.
- [x] Petal tests: the frog base built by operations (preliminary base,
      squash one flap, petal it) lands with the expected outline and sides; a
      request that does not fit still refuses; every existing petal test
      passes.
- [x] Petal preview (`petalGeometry.ts`) checked against the new analysis:
      it lights `ends` + `corner`, the top layer's kite, which is what lifts;
      the second layer's kite is new optional analysis fields.
- [ ] Swivel notice offers Valley and mountain; tests; i18n check.
- [x] Open sink anchor past staying paper in the pocket; synthetic
      regression test (a hem folded into the preliminary base's front
      pocket); every existing sink test and the sink/vertex oracles pass.
- [ ] Acceptance on the study's cases (outside the repo), with before and
      after renders.
- [ ] fmt, clippy, crate tests, wasm build, web tests near the change,
      typecheck, lint.
