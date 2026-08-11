# 3D render-model fixtures

Kernel `Folded3dRenderModel` payloads, for `foldedFigure3dProjection.test.ts`.

The projector is a pure function of this payload, so its tests want the payload
and nothing else — no wasm, no store, no canvas. Nothing here is hand-written: a
stand-in would agree with the projector by construction and could not catch a
change in what the kernel emits.

## Regenerating

```sh
cargo run -p oristudio-cp --release --example fold3d_render_model -- \
    --out apps/web/src/cp-workspace/folded/__fixtures__
```

The example is the only producer. It reads the committed `.fold` fixtures
through the same importer the editor uses, and builds the two synthetic cases in
code — neither belongs in `tests/fixtures/fold-angle-3d/`, which is
owner-authored material only (see its README).

## What each one is for

| fixture | faces / planes / cells / edges | why it is here |
| --- | --- | --- |
| `hinge_90` | 2 / 2 / 2 / 5 | The golden. Small enough to read the whole primitive stream: two triangles at 90°, one cell each. Also the chirality case — it is asymmetric about y, so a mirrored projection produces a different vertex set rather than the same one. |
| `strip_coupled` | 4 / 2 / 2 / 13 | The 1×4 strip at (−90, +180, +90). Creases 1 and 3 land on one 3D line while their faces sit in two planes, so the ordering is a single coupled component and per-plane depth resolution is definite and wrong half the time. |
| `pinwheel` | 5 / 1 / 9 / 20 | A square centre with four arms folded flat back across it, at solution **1**. Nine cells, stacks up to three deep, one plane. |
| `pinwheel_cyclic` | 5 / 1 / 9 / 20 | The same fold at solution **5**, whose layer order is genuinely cyclic — `0 > 4 > 3 > 2 > 0`. The state no per-face scalar layer index can express, and the one a renderer that topologically sorts has to fail on. Paired with `pinwheel` it is also the "another solution changes the picture" case. |
| `box_90` | 11 / 4 / 9 / 23 | The smallest committed model that is a real 3D fold: four planes, real coplanar overlap, few enough faces to work out by hand. |
| `spikes_small` | 25 / 3 / 16 / 48 | Scale, still small: 16 creases at 90°, a non-trivial arrangement, 15 KB. |

Total 32 KB. The corpus's largest admitted model (`origamisimulator`, 2,637
faces) serializes to about 1.7 MB and is deliberately **not** committed; the
budget it informs is recorded in `BSP_ITEM_BUDGET`'s doc comment instead.
