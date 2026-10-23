# Beloch Fixtures

FOLD files from [Beloch](https://github.com/tophcodes/beloch), Christopher
Mühl's language for describing origami (MIT; `LICENSE.md` beside this file),
copied unchanged from commit `88bfccedc80caae1303833a101b180a316ae6a93`
(2026-10-05). Beloch is reference only for Ori Studio's Fold workspace: none of
its code is ported or run here (`implementation-plans/fold-workspace.md`,
Phase 0; `research/2026-10-08-fold-workspace/r2-beloch.md`).

Each file is a folding sequence. `file_creator` says what wrote it: Beloch
0.4.0 for 46, 0.3.0-dev for 9, and `join-edge.fold` is written by hand. Every
frame is a flat folded state: faces in
table coordinates, each face's paper-to-table matrix in
`beloch:faces_matrix` (`[a, b, c, d, tx, ty]`: `x' = a x + b y + tx`,
`y' = c x + d y + ty`), the layer order as FOLD `faceOrders`, and in newer
files the creases' faces and letters (`edges_faces`, `edges_assignment`).

These are the 56 distinct fixture files Beloch commits with a frame of two
faces or more: 105 such frames and 1,701 face-pair orders. The research spike
checked every one with the vendored Flat-Folder solver and found no conflict.
`crates/oracle-tests/tests/beloch_frames.rs` checks them with
`oristudio-layer-order`'s checker, with a single-pair-flip negative control.

Upstream paths, under `packages/`:

| Files | Upstream directory |
| --- | --- |
| `bird-base-petal`, `bird-base`, `bisect-a`, `crane`, `cube-root`, `fold-quarter-faces`, `fold-quarter`, `folded-chord`, `join-edge`, `label-twice`, `mark-overlay-regression`, `marks-demo`, `orient-axis`, `orient-point`, `orient-points`, `orient-trailing`, `reverse-scar`, `side-along`, `side-close`, `side-cupboard-swapped`, `side-cupboard`, `side-named`, `side-preliminary-1`, `side-preliminary-2`, `side-preliminary-3`, `side-reverse`, `stages-ax5-ambiguous`, `stages-ax5-heading`, `stages-ax5-kite`, `stages-ax5-toward-edge`, `stages-ax6-moving`, `stages-ax6-off-paper`, `stages-ax6-subject`, `stages-ax7-heading`, `trace-boundary`, `trace-flatten`, `trace-reverse`, `trace-triangle-ambiguous`, `trace-triangle-toward`, `trace-tuck`, `x-midpoint` | `render-2d/render-svg/test/fixtures/` |
| `between`, `book-twice-said`, `book-twice`, `inside-reverse`, `kite`, `mountain`, `outside-reverse`, `rotate`, `shrink`, `top-layer`, `turn-over-split`, `turn-over` | `render-2d/yr/test/fixtures/` |
| `bindings` | `runtime/editor/test/fixtures/` |
| `constructions` | `runtime/render-dom/test/fixtures/` |
| `def-diagonals` | `www/src/lib/fixtures/` |

Several files are committed upstream in more than one package. The copies are
identical except `fold-quarter.fold`: the one in `www/src/lib/fixtures/` lacks
the `beloch:statements` key, so the `render-2d` copy is the one here.
`fold-occlude.fold` and `square.fold` are left out; all their frames are flat.
