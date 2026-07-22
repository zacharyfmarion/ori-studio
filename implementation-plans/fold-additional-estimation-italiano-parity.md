# Fold Additional-Estimation Italiano Parity

## Goal

Bring Ori Studio's fold-estimation "additional estimation" to algorithmic parity
with Oriedita's `AdditionalEstimationAlgorithm` (AEA). The current Rust port
recomputes transitive closure from scratch on every pass — an `O(k^3)` per-subface
rescan (k up to ~250) repeated over ~16 passes, plus a re-scan of ~139k
equivalence conditions each pass. Oriedita instead:

1. Maintains a per-subface **incremental transitive closure** (Italiano
   algorithm) so a newly-inferred relation propagates in output-sensitive time
   via a change-list, never a full rescan.
2. Runs AEA **twice** during setup, the second time with **`removeMode`**, which
   deletes each equivalence condition once it has fired — shrinking the 139k-set
   to a small residual for the search stage.

Measured on `slow_fold_iguana.ori` (1774 segments, 850 faces): browser fold went
305s → 76s after switching the hierarchy table from `HashMap` to a dense matrix;
the remaining cost is this additional-estimation subsystem (native Order4 ≈ 10s,
Order5 ≈ 1.7s). Target: match Oriedita's ~4s.

## Approach

Port faithfully from `third_party/oriedita/origami/src/main/java/origami/folding/`:

- `algorithm/italiano/ItalianoAlgorithm.java` (+ `Restorable`, `Reactive`)
- `algorithm/AdditionalEstimationAlgorithm.java`
- `data/StackArray.java` (change-list), `data/listMatrix/PseudoListMatrix.java`
  (relation observers)
- `HierarchyList.java` (4-state get/set/isEmpty — our dense `HierarchyTable`
  already collapses EMPTY/UNKNOWN to `None`, which is sufficient for AEA)

New module `crates/oristudio-cp/src/folding/additional_estimation.rs`.

## Affected Areas

- `crates/oristudio-cp/src/folding.rs` — `HierarchyTable` gains a raw `set_above`;
  `overlap_enumerator_from_segments` / `additional_estimation_from_segments` drive
  the two-round removeMode AEA instead of `run_additional_estimation`; the reduced
  (post-removeMode) condition set is stored on the enumerator.
- `crates/oristudio-cp/src/folding/permutation.rs` — realtime estimation in the
  search uses the reduced condition set (Stage B: persistent AEA + save/restore).
- Safety net: `cargo test -p oristudio-cp` (28 `oriedita_folding_oracle` + 35
  `folding`) must stay green; add a golden regression on the iguana fold output.

## Checklist

- [x] Port `ItalianoClosure` (base + restorable + reactive change-list) with unit tests
- [x] Port change-list (folded into the closure) + `PseudoListMatrix` relation observers
- [x] Port `AdditionalEstimationAlgorithm` (run / fastRun / removeMode)
- [x] Route every `run_additional_estimation` call through the incremental AEA
- [x] Wire `removeMode` into `overlap_enumerator_from_segments` setup; reduced set flows to search
- [x] Green oracle + folding tests (373 pass, incl. 28 folding-oracle)
- [x] Measure native — **additional estimation 10s → 16ms**; all remaining cost is elsewhere
- [ ] (Stage B) persistent AEA + save/restore in the search loop (`initialize`/`restore` ready)

## Findings — remaining bottlenecks (native, `slow_fold_iguana.ori`)

After the AEA port, Order4 (~10s) breaks down as:

- **equivalence-condition generation ~6.0s** — our `equivalence_condition_candidates_from_parts`
  brute-forces `O(lines×faces)` (triple) and `O(lines²)` (quad). Oriedita's
  `setupEquivalenceConditions` / `setupUEquivalenceConditions` use a **QuadTree**
  spatial index (`qt.collect(RectangleCollector)`, `qt.getPotentialCollision`) so
  it only tests spatially-near candidates. **This is the next parity gap.**
- **`WorkerOverlapEnumerator::from_subfaces` ~4.4s** — `prioritize_subfaces` +
  per-subface `set_guide_map`; not linear in the (removeMode-pruned) condition
  count, needs its own profile.
- additional estimation now **16ms** (was the dominant O(k³) cost).

Next: port the QuadTree spatial index and use it in condition generation.
