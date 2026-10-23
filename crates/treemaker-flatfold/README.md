# treemaker-flatfold

`treemaker-flatfold` is a Rust port of Jason Ku's Flat-Folder algorithm for
computing flat-folded layer-order states from FOLD crease patterns.

The crate is intentionally independent from TreeMaker's GPL model engine. It
uses `treemaker-fold` for shared FOLD data structures and ports the Flat-Folder
pipeline stage by stage with JavaScript oracle parity tests.

Two entry points:

- `solve_flat_fold` runs the whole pipeline: normalize, fold, build the
  arrangement and its constraints, propagate the M/V letters, search.
- `complete_layer_order` runs only the propagation and search, over variables,
  constraint buckets and cells the caller built, with fixed orders tagged
  carried or seed. Its contract is in `PORTING.md` under "Flat-Folder".

Status: scaffolded port. Unported stages return typed `Unimplemented` errors
instead of degraded approximations.
