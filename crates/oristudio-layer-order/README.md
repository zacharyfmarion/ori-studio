# oristudio-layer-order

Layer order for flat folded states, shared by the Fold engine and its oracle
tests: the pairwise order on overlapping faces, the overlay of convex face
images into cells, the layer-order constraint problem, and one checker that
names faces.

- `view`: the input, face images in folded coordinates (with which side is
  up) and the creases between faces, folded or flat.
- `order`: the order in absolute terms (`above` = nearer the viewer at +z),
  cyclic relations allowed, undetermined pairs kept and reported; FOLD
  `faceOrders` and Oriedita conversions.
- `overlay`: the overlapping pairs, and convex cells, each in a fixed set of
  faces, wider than the tolerance; transitivity comes from them. Each cell
  belongs to the face with the least id covering it and is built from that
  face and the faces it overlaps alone, so `Overlay::rebuild` keeps the cells
  of every face that neither was touched nor overlaps a touched face.
- `problem`: variables (overlapping pairs) and taco-taco, taco-tortilla and
  tortilla-tortilla constraints per variable, in Flat-Folder's tuple form, built
  in full or over the faces an operation touched (`ConstraintProblem::rebuild`,
  overlay included).
- `check`: missing, undetermined and extra pairs, cycles within a cell, the
  three constraint families, letters against the order, hinge orientations
  and overlaps the tolerance cannot decide; in full or scoped to the faces an
  operation touched.

The constraint families are re-derived from Akitaya, Demaine & Ku, "Computing
Flat-Folded States" (OSME 2024); no code is ported from Flat-Folder or
Oriedita.

## Tests

`cargo test -p oristudio-layer-order` runs the unit tests, the hand-built
conventions (`tests/conventions.rs`), a handful of the Fold spike's states
committed under `tests/fixtures/`, and a property test (`tests/incremental.rs`)
that folds random sheets and holds every incremental rebuild, problem and
overlay, to a build from scratch, bit for bit. Its larger campaign is ignored
by default:

```sh
cargo test -p oristudio-layer-order --release --test incremental -- --ignored --nocapture
```

The spike's whole corpus, with a third judge's verdicts on single-pair flips
and on Flat-Folder's and Oriedita's solutions, is not committed; point the
corpus test at it:

```sh
ORISTUDIO_FOLD_SPIKE_SOLVER=…/artifacts/fold-spike/reuse/solver \
ORISTUDIO_FOLD_SPIKE_CORPORA=corpus-v2,corpus-mu0,corpus-big,corpus \
    cargo test -p oristudio-layer-order --release --test corpus -- --nocapture
```

On 2026-10-08 that was 4,184 states with no failure and 266 judged states with
no disagreement.

Original work under `MIT OR Apache-2.0`. See
`implementation-plans/fold-workspace.md` (D8).
