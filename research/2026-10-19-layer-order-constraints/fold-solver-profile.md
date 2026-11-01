# Fold solver profile: how fast the Layer order dialog can be

Measured 2026-10-19, 14:37–15:36, on a snapshot of `codex/heart-layer-order`
at `50d94c4bb`: the Fold workspace's complete layer-order solver, driven the
way the Layer order dialog would drive it (open, choose, background count).
Spec context: [product-spec.md](product-spec.md) §6.9 targets "a first answer
within about a second" and "each change answered within about 200 ms"; the
solver is described in [engines.md](engines.md) §4.

## Headline

| | iguana-c0 (850 faces, 120,825 pairs) | small set and real models (8–80 faces) |
|---|---|---|
| Import (CP → faces, view, overlay, constraints) | **44 ms** | 0.06–1.1 ms |
| Open: letters' propagation and a first order (`per_component = 1`) | **12.95 s** | 0.02–8.1 ms |
| Choose check ("on top here" through `complete_with`) | **≥ 13 s each**; a sweep of 45 had not finished after 24 min | medians 0.16–7.5 ms |
| Choices the forced pairs reject at once (one set lookup) | 99.4% of (cell, face) alternatives | 82–100% |
| Background count (1,000 per component, 200,000 nodes) | 17.1 s, "1,000+" (one run, contended) | 0.01–8.7 ms |
| Oriedita's first order on the same CP (earlier probe, re-run) | 0.55 s | ≤ 10 ms; refuses Crane and Heart |
| **Prototype** open (data structures fixed) | **1.41 s** native, **1.90 s** in wasm (node) | 0.04–2.6 ms |
| **Prototype** check, "on top here" (session + search order) | **13 of 13 answered, median 0.35 s, max 0.62 s** | 3–84 µs |
| **Prototype** check, "A above B" (8 random flips) | in the open's order all 8, median 0.45 s, max 5.5 s; with the picked faces first, 3 of 8 get no answer in 10 s | 3–84 µs |
| **Prototype** background count | 3.1 s, "1,000+" | — |

All Measured, release builds; how, in Setup. In short:

- **Small and real models are already fine.** Everything up to 80 faces
  answers in under 10 ms, far inside the targets, before any change.
- **The iguana is not, and most of the gap is overhead.** The open takes 13 s,
  24× Oriedita's first order, and every check redoes the whole open; 75% of
  that is work that does not change between checks. A handful of mechanical
  data-structure changes made the open 9.2× faster with identical results on
  every fixture.
- **The rest is the search, and it is fragile.** Flat-Folder's search
  backtracks chronologically in a fixed variable order over one component of
  65,851 pairs. In the open's order, 9 of the 13 choosable "on top" picks got
  no answer in 10 s (one none in 300 s); searching the picked faces' pairs
  first answered all 13 in 0.34–0.62 s. But that order lost 3 of 8 "A above
  B" flips that the first order answers, and naive restarts between the two
  still left 2 of the 21 picks unanswered after 10 s. No fixed order is safe;
  clause learning is what would make checks dependable (Inferred).

## Setup

- **Machine.** Apple M1 Max, 10 cores, 64 GB, macOS (Darwin 25.6.0). Other
  builds kept the load average at 14–37 for most of the session (5 for the
  final iguana run). The probe is single-threaded; `/usr/bin/time -l` on the
  first iguana run showed 13.04 s user for 13.67 s real. Probes sometimes ran
  side by side: `v1`'s open took 13.25 s alone and 12.66–13.08 s with one
  other probe running, so one neighbour made little difference; between 15:10
  and 15:23 up to four ran at once and slowed checks up to 2×. Numbers from
  that period are marked "contended" and were repeated uncontended where they
  matter. Each timing is the median of 3 runs unless noted.
- **Code.** `git archive 50d94c4bb` into the session scratchpad,
  `fold-solver-spike/src`. Nothing there is committed. Outputs and the
  binaries of each stage are kept in `fold-solver-spike/out/`.
- **Probe.** `crates/oristudio-fold/examples/solver_profile.rs` in the
  snapshot, plus spike-only phase timers (`treemaker_flatfold::prof`) around
  `complete_in` and `complete_layer_order`:

  ```sh
  CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=$SPIKE/target cargo build --release \
    --manifest-path $SPIKE/src/Cargo.toml -p oristudio-fold --example solver_profile
  [FF_FOCUS_FIRST=1] $SPIKE/target/release/examples/solver_profile <fixture> \
    [all=1] [picks=40] [pair_picks=8] [session=1] [check_deadline_s=10] [enum=1]
  ```

  Stages: `v1` is the commit (plus timers); `v2` and `v3` change data
  structures; `v4`–`v7` add the per-check deadline, pick filters, the
  `FF_FOCUS_FIRST` order and `FF_PORTFOLIO` restarts (same solver as `v3`
  otherwise). The session prototype is `CompletionSession` in the snapshot's
  `treemaker-flatfold/src/completion.rs`.
- **Loading.** `.cp` through `oristudio_cp::io::cp::import_cp_str`, `.fold`
  through `import_fold_file_document_json`, then the wasm bridge's
  `input_of_model` (copied), then `ImportedPattern::new(.., Empty { Front })`,
  which is the app's Import CP path.
- **Operations.**
  - *Open*: `ImportedPattern::complete(per_component = 1, max_nodes =
    200,000)`.
  - *Check*: `complete_with(fixed)` with the same limits. "On top here" puts
    face X above every other face of a cell (spec §6.4), one seed per pair.
    Every (cell, face other than the current top) is classified first, and a
    pick a forced pair contradicts is the instant class. The solver then runs
    on the rest: all 13 on the iguana, 40 random ones elsewhere, plus 1–4
    rejected ones to show the solver's cost without the pre-check. "A above
    B" flips one pair the letters leave open against the current order.
  - *Background count*: `complete(CompletionLimits::default())`, 1,000 per
    component and 200,000 nodes.

## 1. Sizes and baseline timings (`v1`, the commit as it is)

| Fixture | Faces | Pairs | Cells | Max ply | Forced by letters | Free components (pairs : orders) | Import | Open | Check, median (n) | Background count |
|---|---|---|---|---|---|---|---|---|---|---|
| `precrease/iguana-c0.fold` | 850 | 120,825 | 17 | 250 | 45.5% | one, 65,851 : ≥ 1,000 | 44 ms | **12.95 s** | ≥ 13 s, §2 | 17.1 s, "1,000+" (contended) |
| `flat-folder/kabuto.fold` | 18 | 117 | 23 | 12 | 69.2% | 18:3, 18:3 | 0.18 ms | 0.61 ms | 0.47 ms (40) | 0.56 ms, 9 orders |
| `oriedita/solution_sample_1.cp` | 21 | 76 | 31 | 5 | 78.9% | 4:2 ×4 | 0.27 ms | 0.21 ms | 0.16 ms (40) | 0.19 ms, 16 |
| Oriedita `colorconstrainttest.cp` | 12 | 66 | 6 | 12 | 66.7% | 22:22 | 0.13 ms | 0.28 ms | 0.23 ms (40) | 0.54 ms, 22 |
| `folding-sequence/fold/squash-local.fold` | 8 | 28 | 1 | 8 | 71.4% | 8:3 | 0.06 ms | 0.10 ms | none choosable | 0.10 ms, 3 |
| `origami-simulator/…/iguana-split-crease.fold` | refused by Import CP: `import_shape_unsupported` (the border is not a square or rectangle) | | | | | | | | | |
| Real: Cicada, final CP | 44 | 509 | 162 | 22 | 81.5% | 36:2, 58:26 | 0.83 ms | 4.49 ms | 4.17 ms (40) | 6.07 ms, 52 |
| Real: Crane | 80 | 1,184 | 50 | 28 | 93.7% | 75:5 | 1.07 ms | 8.14 ms | 7.51 ms (40) | 8.65 ms, 5 |
| Real: Heart | 52 | 282 | 17 | 12 | 80.9% | 4:2, 4:2, 10:3, 10:3, 26:8 | 0.46 ms | 1.07 ms | 1.00 ms (40) | 1.20 ms, 288 |
| Real: Swan | 24 | 212 | 14 | 16 | 85.4% | 31:21 | 0.26 ms | 1.01 ms | 0.89 ms (40) | 1.33 ms, 21 |
| Real: Box | 32 | 8 | 24 | 2 | 100% | none | 0.21 ms | 0.02 ms | none choosable | 0.01 ms, 1 |

Measured. The iguana's import splits into the constraint problem's build,
40 ms (`ConstraintProblem::build`, of which the overlay is 5.3 ms), and the
arrangement, faces and view before it, ~4 ms. Peak memory of the first iguana
run: 170 MB resident (`/usr/bin/time -l`).

**Real models.** The named investigations (Crow, Camellia Chicken, Crab,
Devilish Heart) exist only as `.osf` fold sequences; no step stores its
crease pattern, so getting one means replaying the sequence through the
engine, which was not done here. The crease patterns that do exist as files,
`research/2026-10-13-origami-fold-trials/interchange-exports/*.fold` (their
top-level frame is the final crease pattern), all import and are in the
table. None is large: the iguana is the only large case measured.

**Check classes on small models.** Every sampled pick the forced pairs do not
reject is feasible: no propagation conflict and no search conflict in 280
"on top" picks (7 fixtures × 40) and 320 "A above B" flips (8 × 40, run with
`v2`/`v3`, whose answers match `v1`'s). So the conflict classes' latency could
not be measured on these models. A rejected pick costs one set lookup (under
1 µs); handed to the solver instead it costs 0–4.4 ms, because
`fixed_assignments` refuses a seed that contradicts a letter before any
propagation.

| Fixture | (cell, face) alternatives | rejected by a forced pair | cells with a choosable alternative |
|---|---|---|---|
| iguana-c0 | 2,233 | 2,220 (99.4%), each by a letter directly | 13 of 17 |
| kabuto | 154 | 140 (90.9%) | 14 of 23 |
| solution_sample_1 | 79 | 75 (94.9%) | 4 of 31 |
| colorconstrainttest | 34 | 28 (82.4%) | 4 of 6 |
| squash-local | 7 | 7 (100%) | 0 of 1 |
| Cicada / Crane / Heart / Swan / Box | 1,537 / 666 / 101 / 114 / 8 | 91.0 / 99.1 / 92.1 / 94.7 / 100% | 130 / 6 / 8 / 5 / 0 |

## 2. The iguana in detail

### Where the open's 13 s go (`v1`; Measured with phase timers)

| Phase | Time | Share | Work |
|---|---|---|---|
| Copy the problem into the search's form (`complete_in`) | 36 ms | 0.3% | |
| Validate and encode (`SearchInput::new`) | 210 ms | 1.6% | B-tree sets of every (face, cell) incidence; every pair in every cell checked to be a variable |
| Propagate the 1,621 letters | 2,541 ms | 19.6% | 54,974 pair visits; 13,968,352 transitivity triples derived |
| Split the rest into components (`variable_groups`) | 6,895 ms | 53.2% | 65,851 pairs; 16,731,248 transitivity triples derived again |
| Search: a first order and one past it | 3,058 ms | 23.6% | 55 nodes, one component |
| Map back, assemble a `LayerOrder` | 12 ms | 0.1% | |
| **Open** | **12.95 s** | | runs 12.66 / 12.95 / 13.08 s |

The macOS sampler agrees: of 11,238 samples in `complete_in`, the split had
54%, the search 24%, the propagation 21%.

**Transitivity is nearly all of the work.** A visit to a pair derives about
254 transitivity triples from the cells it shares, against about 5 taco-taco
and 1 taco-tortilla constraints from its buckets (Measured counts). So about
98% of each propagation step is transitivity, and its cost grows with ply
(Inferred).

**What the profile blames** (`v1`, `sample`, top of stack):

- 30% `malloc`/`free`. `unpack_constraints` builds a `Vec<Vec<usize>>` per
  pair and family, one `Vec` per constraint; `pairs_for_type` and `infer`
  return fresh `Vec`s; every `math::decode` allocates; and
  `transitivity_constraints` allocates and zeroes a face-sized mark vector and
  clones a cell list on every call.
- 18% the transitivity filter: up to four `BTreeMap` lookups per triple into
  the taco-tortilla components.
- 29% in `variable_groups` itself, mostly its `BTreeSet<usize>` of seen pairs,
  probed three times per triple.
- 14% `infer`, mostly `PairIndex::get`'s binary search.

### What a check re-does (Measured)

`ImportedPattern::complete_with(fixed)` adds the letters back and calls
`complete`, which rebuilds everything in the table above: the copy, the
validation, the letters' propagation, the split, and a search of every
component. Only the import is reused.

- On the open's own numbers, the parts that are the same for every check are
  **9.68 s of 12.95 s, 75%**.
- A check's search is also slower than the open's. The `v1` sweep over the 13
  choosable picks (3 runs each) had not finished after 24 minutes of CPU when
  it was stopped, so the mean check took more than 32 s; a 10 s sample of it
  was 100% in the search.
- With `per_component = 1` the API still searches for a second order, to
  report truncation. For a component whose order is unique but not forced,
  that proof searches the whole tree.

## 3. The prototype (Measured unless marked)

### Data structures (`v2`, `v3`): the open, 12.95 s → 1.41 s

| Stage | Open | Letters' propagation | Split | Search | Validate |
|---|---|---|---|---|---|
| `v1`: the commit | 12.95 s | 2.54 s | 6.90 s | 3.06 s | 0.21 s |
| `v2`: no allocation per constraint (fixed-size tuples in a reused buffer; array pair lists and implications), a `Vec<bool>` instead of the split's `BTreeSet`, a dense face × face table for the taco-tortilla components, reused marks in transitivity | 4.57–4.85 s | 1.16–1.48 s | 1.74–1.88 s | 1.18–1.28 s | 0.20–0.34 s |
| `v3`: a dense face × face → pair table instead of `PairIndex`'s binary search (2.9 MB at 850 faces) | **1.41 s** (1.41 / 1.41 / 1.43; later runs of the same solver 1.39–1.58 s) | 0.31 s | 0.52 s | 0.37 s | 0.17 s |

- **Same answers.** On every fixture, `v2` and `v3` give the same forced pairs,
  components, counts and node counts as `v1`; every order the prototype
  returned below passes the independent checker
  (`oristudio_layer_order::check_problem`).
- After `v2` the profile had moved to `infer` (51%), which is where
  `PairIndex::get` is inlined; `v3` removed that.
- Small models gain about 2× (kabuto's open 0.61 → 0.24 ms, Crane's 8.1 →
  2.6 ms).
- Background count: "1,000+" in 3.1 s (2,044 nodes), against 17.1 s for
  `v1`; one run each, both with another probe running.
- Stopping at the first solution (`FF_FIRST_ONLY=1`, a limit of 1 instead of
  1 + 1) saved nothing on the open: 54 nodes instead of 55, 0.38 s of search
  either way.

### A session (the `CompletionSession` prototype): checks without the rebuild

`treemaker_flatfold::CompletionSession` (spike) keeps the validated tables,
the letters' propagation and the open's component order. A check propagates
only its own new seeds from that state, then searches every open pair at once
with a limit of 1: no split and no "+1". A seed against a pair the open
already forced is refused before any work.

| Iguana check (uncontended) | Propagate the new seeds | Search | Total |
|---|---|---|---|
| Session open (validate, propagate letters, split once for the order, first order) | 0.31 s | 0.37 s | **1.30 s** |
| Feasible "on top", open's order (`v4`) | | | **0.61 s** (0.61–0.62) |
| Feasible "on top", same solver through `complete_with` (`v5`, contended) | | | 1.9–2.8 s |
| "On top", searching the picked faces' pairs first (`v6`, 13 picks) | 13 ms (2,382 pair visits) | 0.33 s (26 nodes) | **0.35 s** median, 0.62 s max |
| "A above B" flips, picked faces' pairs first (`v6`, 8 flips) | 15 ms | 0.36 s | 4 in 0.35–0.37 s, 1 in 5.6 s (0.37 s warm), 3 no answer in 10 s |

Small and real models: session checks take **3–84 µs** (kabuto 11 µs,
solution_sample_1 3 µs, Cicada 84 µs, Crane 50 µs), against 0.1–7.5 ms for
`complete_with`, all feasible, all valid.

### The search order decides whether a check answers at all

| Search order | "On top" picks answered (13) | "A above B" flips answered (8) |
|---|---|---|
| The open's component order (BFS from the first open pair) | 4 (141 → 21 in two cells, 0 → 14, 143 → 34), in 0.61 s; the other 9 (153 → 94, 145 → 46 and 149 → 70 in two cells each, 2 → 106, 147 → 58, 151 → 82) got no answer in 10 s (184–722 nodes); 153 → 94 none in 300 s (10,380 nodes) | all 8, median 0.45 s, max 5.5 s (contended) |
| Pairs among the picked faces first, then pairs touching them, then the rest | **all 13, in 0.34–0.62 s** | 4 in 0.35–0.37 s, 1 in 5.6 s, 3 got no answer in 10 s |
| Restarts alternating the two orders, node budgets 64, 64, 128, 128, … (`v7`, load average up to 43) | all 13, median 0.36 s, max 0.63 s | 6, median 0.49 s, max 4.2 s; 2 got no answer in 10 s (9 attempts) |

So every one of the 21 sampled picks was answered by one of the two orders,
the slowest in 5.5 s, and at least 18 within 0.62 s (Measured per pick).
Neither order alone is dependable, and naive restarts between them answered
19 of 21 within 10 s, not all (Measured). Chronological backtracking with
a fixed order thrashes when an early guess far from the new seeds is wrong:
each of the hundreds or thousands of nodes re-propagates thousands of pairs
(15–55 ms a node), and the search cannot learn why it failed (Inferred, from node counts
and the sampler, which put 100% of those runs in `guess_vars`).

**Warm start.** Preferring the previous order's value at each guess did not
change the time, but it changed which order came back. On 9 of the 13 "on
top" picks the cold search (picked faces first) returned an order 11,252–
12,060 pairs away from the one shown, and the warm search one 2,522 pairs
away; on the other 4 it was no better (2,522 or 25,932 either way) or slightly
worse (2,910 against 2,522). Measured, `v6`. That is the "changes as little
as possible" preview of spec §6.5, nearly for free.

## 4. Optimisation opportunities, ranked for the dialog

1. **Fix the data structures in propagation and search.** *Measured: 9.2× on
   the iguana's open (12.95 → 1.41 s), about 2× on small models, identical
   results.* This is `v2` + `v3`. A production version would keep the encoded
   `Vec<u16>` keys out of the hot loop altogether (pairs as `[u32; 2]`,
   buckets as flat arrays) and switch the 2.9 MB dense tables to a hash map
   above some face count (at 3,000 faces they would be 36 MB each).
2. **Make the search dependable: the picked faces first, then learning.**
   *Measured problem and partial remedy; Inferred for the rest.* On the iguana
   the order alone decides between 0.35 s and no answer in 300 s.
   - Searching the new seeds' pairs first (a sort, a few lines) took every
     "on top" pick from 4 of 13 answered to 13 of 13, in 0.34–0.62 s. Measured.
   - It is not enough on its own: it lost 3 of 8 "A above B" flips that the
     open's order answers, and restarts alternating the two orders with
     doubling node budgets still left 2 of the 21 picks unanswered after 10 s.
     Measured.
   - The robust remedy is conflict-directed backjumping or clause learning:
     the problem is SAT (pair orders as variables, taco and transitivity
     constraints as clauses, the latter generated lazily), and learning is
     the standard answer to this thrashing. Inferred; not prototyped.
   - Until then the dialog needs its budget and a "not decided yet" state on
     large models, which §6.9 already allows.
3. **A session API for the dialog.** *Measured: removes about 1.0 s of the
   optimized solver's check on the iguana (validation 0.17 s, the letters'
   propagation 0.31 s, the split 0.52 s, the copy 0.03 s, from `v3`'s open),
   and 9.7 s of `v1`'s; small models go from 0.1–7.5 ms to 3–84 µs.* The
   iguana's propagation of a check's own seeds is then 13–15 ms (2,400–3,000
   pair visits), so what remains is the search. It also gives the dialog the forced
   pairs for greying out and the instant refusal of a seed against one.
   Caveat: a conflict then traces back only to the session's forced pairs,
   not to the letters behind them; keeping the open's parent pointers would
   restore Flat-Folder's `error_faces`.
4. **Make transitivity cheaper for deep stacks.** *Inferred: several-fold on
   the remaining 0.33 s of search per check.* About 98% of the constraint
   checks are transitivity triples, ~254 per pair visit on the iguana,
   rederived from the cells every time. A per-cell order kept as bit sets
   (faces above and below each face; 4 words at ply 250) would update in
   O(ply / 64) per assignment. The triples the taco-tortilla components drop
   are implied anyway, so enforcing them changes no answer, but it changes
   which constraint a conflict names (a parity question for `error_faces`).
   This is the lever for 200 ms on the iguana.
5. **Prefer the previous order in the search.** *Measured: no time cost; on 9
   of 13 picks the returned order differs from the shown one in 2,522 pairs
   instead of 11,000–12,000.* A product gain for the preview, not a speed-up.
6. **Smaller items, all Measured.** Validate once when the problem is built
   (0.17–0.21 s per call on the iguana); do not split into components for a
   single order (0.46–0.52 s with `v3`, 6.9 s with `v1`; one search over all
   open pairs is complete, the split only serves counting); skip the "+1"
   outside the background count (no gain at the open, a full-tree search
   for a unique-but-unforced component). The import is not worth touching
   (44 ms, 0.3% of the open).

## 5. In the browser (Measured in node; Inferred for a worker)

The `oristudio-fold-wasm` bridge, built from the snapshot with the `v3`
solver (`wasm-pack build --release --target nodejs`), driven by
`fold-solver-spike/wasm-bench.cjs`. It times `FoldEngine.import_cp` with
`perComponent: 1`: load, import, open and serializing the response.

| Fixture | wasm in node 26 | native `v3`, load + import + open |
|---|---|---|
| iguana-c0 | 1.90 s (2.24 / 1.90 / 1.89) | ~1.45–1.6 s |
| Crane | 10.6 ms | ~6 ms |
| Cicada | 8.4 ms | ~5 ms |
| kabuto | 2.2 ms | ~1 ms |

So wasm costs about 1.2–1.3× native where the solver dominates, and
1.6–1.9× on small models, where loading and the JS boundary dominate (the
native column adds single runs of the load). A browser worker
runs the same engine as node, so the factor should carry over (Inferred). The
session was not exposed through wasm, so its checks were not timed there;
at 1.3× an iguana "on top" check would take about 0.45 s in a worker
(Inferred). `v1` was not built for wasm; at the same factor its open would
take about 17 s (Inferred).

## 6. Oriedita

Re-run with the earlier probe (`artifacts/layer-order-probe`, built unchanged
into the scratchpad with `--locked`; its time covers the wireframe, the
subfaces and the first solution, `FoldingEstimateSession` at Order 5):

| Fixture | Oriedita, first order | Fold, open (`v1` → prototype) |
|---|---|---|
| iguana-c0 | **0.55 s** (0.66 / 0.55 / 0.55; 0.51 s in [engines.md](engines.md) §5) | 12.95 s → 1.41 s |
| kabuto, solution_sample_1, colorconstrainttest, squash-local, Swan | under 5 ms (printed as 0.00 s) | 0.02–1 ms |
| Cicada | ~10 ms (printed as 0.01 s) | 4.5 → 1.8 ms |
| Crane, Heart | refused: `SameParityAdjacentFaces` while building the hierarchy | 8.1 → 2.6 ms; 1.1 → 0.45 ms |

Against Oriedita's 0.55 s, the Fold solver's open is 24× slower as committed
and 2.6× slower with item 1, while also giving the forced pairs, the
component structure and a complete search.

## 7. Not measured

- Crow, Camellia Chicken, Crab, Devilish Heart (no stored crease pattern, §1)
  and `iguana-split-crease.fold` (refused by Import CP).
- Conflict classes (propagation or search conflicts): none occurred among the
  sampled picks on any fixture, so their latency is unknown. On the iguana,
  every pick that the forced pairs left open turned out feasible.
- A real browser worker; the session in wasm; `v1` in wasm.
- Oriedita's time to a *constrained* order: the comparison above is its first
  order only.
- Memory of a production session: the probe's session run peaked at 311 MB
  resident, but it holds the import, two copies of the problem and several
  orders at once.
- Clause learning and bit-set transitivity: items 2 and 4 propose them; only
  the search orders and naive restarts were prototyped.
