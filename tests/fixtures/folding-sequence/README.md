# Flat-foldable FOLD controls

`fold/*.fold` are six small hand-authored, flat-foldable FOLD crease patterns.
Each carries the `creasePattern` frame class, explicit `faces_vertices`, and an
assignment for every edge, so they load and solve without any repair step. They
are deliberately tiny (2 to 8 faces) and are used as controls where a
known-good answer matters more than realism:

- `crates/oristudio-cp` folding3d tests (`src/folding3d/placement.rs`,
  `tests/folding3d_census.rs`, `tests/folding3d_order.rs`) place them in 3D and
  compare overlap censuses and layer orders against known counts.
- `crates/oracle-tests/tests/flat_folder_controls.rs` parses every file, runs
  `treemaker_flatfold::solve_flat_fold` on it, and checks that each normalized
  face has a flip flag, an overlap graph is produced, and at least one folded
  state is reported. This runs unconditionally, with no external oracle.

## Files

- `simple-valley`: one horizontal valley fold across a square; two faces.
- `accordion-book-fold`: two parallel folds (one valley, one mountain) forming
  three strips.
- `kite-rabbit-ear-local`: four creases meeting at one interior vertex.
- `squash-local`: an eight-sector pattern around one interior vertex.
- `treemaker-triad-base`: a small TreeMaker-style three-flap base.
- `simultaneous-collapse-unsupported`: a valid flat-fold target whose creases
  must all be folded together; the name is historical.

When adding a control, keep it flat-foldable and small, give every edge an
assignment, and update the expected count in `flat_folder_controls.rs`; the
folding3d tests pin per-file counts and need their own entries.
