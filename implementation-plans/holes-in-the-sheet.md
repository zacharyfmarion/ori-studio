# Holes in the sheet

## Goal

Fold a crease pattern whose paper has a hole in it. Today the arrangement traces
the hole as a **paper face**, so its border segments become face-to-face joins
and the flat folder aborts with `SameParityAdjacentFaces` — naming an unrelated
crease — while the 3D folder refuses with `InteriorCut`.

Research and measurements: `research/2026-08-31-holes-in-the-folding-pipeline.md`.
The reported file is flat-foldable with exactly one valid layer ordering; the
refusal is a false negative.

## Approach

One filter, at one site. `FoldGraph::calculate_faces` drops the faces that are
holes rather than paper, **after** the Euler gate (the gate's `F − E + V == 1`
only balances because the hole is counted) and before the line/face border index
is built. Everything downstream — the face-position walk, the parity seed, the
subface arrangement, the permutation search, the renderer, and the whole 3D
pipeline — then reads a hole-free face set with no further change.

The rule is Flat-Folder's, already ported in this repo at
`crates/treemaker-flatfold/src/conversion.rs:75-88` from
`third_party/flat-folder/src/io.js:277`: **a face whose every edge is a boundary
edge is a hole.** One clause is added, because `Black0` is a palette colour here
and not the FOLD `B` assignment it is upstream: **every one of those edges must
also have a face on the other side.** A hole is enclosed; the halves of a square
split by an interior black line each carry outer-boundary edges, and upstream's
unclaused rule deletes both.

3D needs no change of its own. `InteriorCut` is driven by
`interior_border_segments_in`, which counts traced faces per `Black0` edge; once
the hole face is gone its edges have one, and the refusal stops firing on a clean
hole while still firing on a genuine cut. `LoopNotClosed` — documented as
"defence in depth" because it is implied by per-vertex closure *on simply
connected paper* — is what carries correctness on an annulus, and it already
measures the hole cycle.

## Affected Areas

- `crates/oristudio-cp/src/fold_graph.rs` — the filter.
- `crates/oristudio-cp/src/folding3d/placement.rs` — one test asserts
  "four sectors plus the filled hole" and updates with the behaviour.
- `crates/oristudio-cp/tests/` — new coverage for the filter, the flat fold of a
  holed sheet, and the 3D placement/refusal pair on an annulus.
- `crates/oristudio-cp/src/folding.rs` + `session.rs` — the cleared-faces no-op
  and the hole-aware wording for a parity abort.

## Outcome

Verified in the browser on the reported file: it opens, `Cmd+A` + `G` folds it,
and the folded figure draws with one layer ordering and no error. The `.osf`
itself carries a stranded `status: 'error'` folded-figure entry from when the
bug fired — the persistence half of Phase 4, in the wild.

Two things stay refused, and correctly: a hole no crease reaches (the paper face
is then annular, which a vertex ring cannot describe — the Euler gate refuses it,
and lifting that needs a multi-ring face representation), and fold angles that
genuinely do not close around the hole cycle (`LoopNotClosed`).

## Checklist

- [x] Phase 1 — hole filter in `calculate_faces`, with unit tests
- [x] Phase 2 — flat + 3D integration coverage on holed sheets
- [x] Phase 3 — name the failure: interior-cut parity abort, cleared-faces no-op
- [x] Phase 4 — frontend: stop stranding a failed folded figure
- [x] Phase 5 — validate (fmt, clippy, workspace tests, web checks) and run the app
