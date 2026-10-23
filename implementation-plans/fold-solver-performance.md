# Fold solver performance for the Layer order dialog

## Goal

Make the Fold workspace's complete layer-order solver fast enough for the
planned Layer order dialog on large folded figures — interactive within
about a second, each check within about 200 ms — **without changing any
answer it gives**. The owner's bar: "make sure that all of this is safe
(e.g. doesn't produce incorrect results)". A faster solver that is wrong in
one case is worse than the slow one.

Sources: `research/2026-10-19-layer-order-constraints/fold-solver-profile.md`
(where the time goes, the spike, the ranked opportunities) and
`product-spec.md` (the dialog), in the `fold-layer-order-constraints`
worktree. Base: `claude/fold-workspace-launch-b42eba` at `ef1e1343e`, later
merged up to `8279dd9d6` (which added the stacking cap) and then to
`0a1ee4088`. Since `8279dd9d6` its only crate change is this branch's count
fix, cherry-picked (`06c6350d9`), so the merged `complete.rs` is this
branch's.

## Approach

`treemaker-flatfold` is the Flat-Folder port, so everything that touches
its routines is a performance-only change with identical output, proven
differentially; the session is an addition beside it.

1. **Data structures** (profile §4 item 1). Upstream's `BF`, `BT`, `BI` and
   `CC` as flat arrays (`tables.rs`): each variable's faces, its
   constraints by family in one buffer, a face × face table of variables
   and one of taco-tortilla components — dense up to `DENSE_FACE_LIMIT`
   (2,048 faces, 25 MB for both tables; the iguana takes 4.3 MB), hash maps
   above it (Import CP's cap is 4,096 faces, where dense tables would take
   100 MB). No allocation per constraint, inference or transitivity triple;
   transitivity marks reused; `Vec<bool>` for the split's seen set. Work
   that cannot change what upstream finds is skipped: the split does not
   infer a constraint that could join nothing, and the search's
   propagation does not filter or infer a transitivity triple whose other
   two pairs are open (every `x00` state of the family's table is alive).
2. **A session** (item 3): `treemaker_flatfold::CompletionSession`, wrapped
   by `oristudio_fold::CompletionSession` (face ids, `LayerOrder`s) and
   `ImportedPattern::session`, and exposed on the wasm bridge as
   `import_session` / `import_check` on a held import (the natural seam:
   Import CP already holds imports by handle; no web caller yet). The open
   propagates the letters once, keeping upstream's parent pointers, splits
   the rest as `get_components` does and finds a first order (the one
   `complete` lists first). A check refuses a seed against a forced pair
   before any work (tracing it to the letters), propagates the other seeds
   from the open's state with parents continuing the open's (so conflicts
   still give Flat-Folder's `error_faces`), and searches only the
   components the seeds reached, for one order, with no "+1".
3. **Search order** (item 2, partial): in a reached component, the pairs
   among the new seeds' faces first, then the open's order, each within
   `fast_nodes`; then exactly Flat-Folder's own split and search over what
   is left, within the caller's `max_nodes`, so a check decides whenever a
   fresh `complete` would within the same node budget. Past that the answer
   is `Undecided` — its own outcome, never "no order".
4. **Warm start** (item 5): a preferred order (the one on screen) supplies
   each guess's first value. Every steered search is followed by the same
   search in upstream's value order, so a preference never loses an answer
   the cold check finds; components nothing reached keep the preferred
   order without a search where it is the open's.

## Affected Areas

- `crates/treemaker-flatfold/src/{tables.rs, constraints.rs, completion.rs, session.rs, lib.rs}`
- `crates/oristudio-fold/src/{complete.rs, unordered.rs, import/mod.rs, lib.rs}`
- `crates/oristudio-fold-wasm/src/io/{imports.rs, wire.rs, bindings.rs}`,
  `tests/import_session.rs`, `Cargo.toml`
- `crates/oristudio-fold-wasm/examples/{solver_differential.rs, solver_session_check.rs}`
- `crates/oristudio-layer-order/src/problem.rs` (`MAX_STACKED_TRIPLES`
  4,000,000 → 12,000,000, owner's decision after the rework) and the tests
  and docs that pin it (`oristudio-fold/tests/import.rs`,
  `oristudio-fold-wasm/tests/stacking_corpus.rs` and `README.md`,
  `tests/corpus/README.md`, `apps/web/src/fold/engine/foldImportFaceCap.wasm.test.ts`)
- `crates/oristudio-fold/src/complete.rs`: `ChoiceCount` serializes a count
  past 2^53 − 1 as that bound, inexact (a pre-existing crash the corpus
  found)
- `PORTING.md` (Flat-Folder: performance-only divergences; the session)

## Checklist

- [x] Baseline worktree at `ef1e1343e` (`.claude/worktrees/fold-solver-baseline`)
- [x] Differential harness; baseline dumps of the fixtures and cpoogle
- [x] Flat tables, reused marks, `Vec<bool>` split, dense/hashed switch
- [x] Skip work that cannot change the answer (split, search propagation)
- [x] Session in `treemaker-flatfold`, `oristudio-fold`, the wasm bridge
- [x] Search order with node budgets and the exhaustive fallback; `Undecided`
- [x] Warm start that never loses a cold answer
- [x] Randomized session checks against the baseline, on fixtures and cpoogle
- [x] Existing gates: crate tests, clippy, fmt, ignored campaigns, Flat-Folder
      oracle and corpus, web fold tests
- [x] Merge the moved launch branch; post-merge differential against its head
- [x] Re-measure the stacking cap against the faster solver; raise it to
      12,000,000 (owner: "go with your gut"); fix the count overflow it exposed
- [x] PORTING.md note
- [x] Independent review (not refuted); its two hardening items fixed
- [ ] Owner: review; push and open the draft PR (the base branch is not pushed)

## Results

Measured 2026-10-19 on an Apple M1 Max (10 cores) shared with other agents;
`uptime` is recorded beside every timing (a load average of 4–7 means
quiet). "Before" is `ef1e1343e`, built from the same harness file in the
baseline worktree `.claude/worktrees/fold-solver-baseline`.

### Safety evidence

| Gate | Cases | Result |
|---|---|---|
| Differential, before vs after (`solver_differential dump`): forced pairs, components, orders (1 and 1,000 per component), counts, nodes, refusals, at 200,000 nodes | 10 fixtures + 484 cpoogle | **0 differences**; no budget hits; 471 cpoogle import, 13 refused alike |
| The same, committed build (cap 12M) | 494 | 0 differences; 8 refused by the new cap only, all over 12M triples (smallest 12,574,094) |
| Post-merge, launch head `8279dd9d6` vs this branch (both at the 4M cap) | 494 | 0 differences |
| Hashed tables (> 2,048 faces), after the hashing fix, before vs after | 4 | 0 differences |
| Session, randomized (`solver_session_check`): each question answered cold, warm (open's order preferred) and chained (previous fit preferred) vs `complete_with` from scratch on the old code | 384 questions on the fixtures; 4,700 on cpoogle; 50 re-run on the 5 hashed-path designs | 1,146 + 14,100 + 150 answers agree; **0 disagreements, 0 undecided where the old code decided**; 6 answers where the old code ran out of its 2,000 nodes (two iguana "on top" questions, 455 s and 659 s from scratch) all fit |
| Every order a check returns | 8,469 fits | passes `oristudio_layer_order::check_problem`, is complete and has every asked pair |
| Every "no" | 6,933 | the 6,786 forced, conflict and no-order answers each name faces they trace back to (9 of them, 3 questions × 3 modes, are search-level proofs); the other 147 are seeds that contradict each other, refused before any search as `complete_with` refuses them |
| Session open | every case | forced pairs and first order equal `complete`'s; the first order passes `check_problem` |
| In-crate randomized test | 6 problems (incl. carried pairs), both table forms | verdicts equal completing from scratch |
| Crate tests (`treemaker-flatfold`, `oristudio-layer-order`, `oristudio-fold`, `oristudio-fold-wasm`), clippy `-D warnings`, fmt | 63 test binaries | pass |
| `oristudio-fold` ignored campaigns, before vs after | 11 tests | same outcomes; digests equal (crimp `c333a2a950dfe349`, reverse `68c4fd44f24c05e7`, tuck `58d8da33d2288383`, random `7198e71a8331430d`); `random_campaign` and tuck's `the_spikes_campaign` fail identically (near-miss refusals) |
| Flat-Folder oracle: `flat_folder_oracle`, `flat_folder_verify`, `flat_folder_controls` | fixtures | pass |
| Flat-Folder corpus (`cp_training_mix_v1`, 4 shards) | 13,999 files checked | 8,394 of the 8,396 the JS oracle answers agree; the 2 others (taco-tortilla 591 vs 593, 2,871 vs 2,873) differ identically before the rework; the oracle throws on 5,603; one more file, left out of the shard, does not finish its arrangement in 20 min before or after (nor in the oracle in 60 s) |
| Web fold and worker tests (Node 22) through the rebuilt bridge | 165 files (1 skipped) | 1,203 pass, 5 skipped |
| The same after merging the launch branch at `4d54b4f90` (no engine changes), every test file matching `fold` | 315 files (1 skipped) | 2,994 pass, 5 skipped |
| The same after the review fixes and merging the launch branch at `0a1ee4088`, with the fold bridge rebuilt | 317 files (1 skipped) | 3,017 pass, 5 skipped |

The widened corpus also found a pre-existing crash: a design whose count
passes 2^53 (rat-skeleton, 1.9 million triples, 8.2 × 10¹⁷ orders, under
the old cap) threw on Import CP in the browser, because the bridge's
JSON-compatible serializer refuses such integers. `ChoiceCount` now sends
it as "at least 2^53 − 1"; the campaign digests are unchanged.

### Timings: the open and the count

Native, release, before and after alternated three times, medians, load 5:

| Fixture | Open (`complete`, 1 per component) | Count (1,000 per component) |
|---|---|---|
| iguana-c0 (850 faces, 120,825 pairs) | 11,040 → **1,043 ms** (10.6×) | 12,644 → 1,424 ms (8.9×) |
| crane | 7.68 → 2.59 ms | 7.37 → 1.96 ms |
| cicada | 4.57 → 1.85 ms | 5.31 → 1.54 ms |
| heart, swan, kabuto | 1.3–1.7 → 0.9–1.0 ms | 0.5–1.2 → 0.16–0.34 ms |
| colorconstrainttest, solution_sample_1, squash-local, box | 0.7–1.0 → 0.7–0.8 ms | 0.02–0.48 → 0.01–0.13 ms |

Small models' opens are mostly the per-call setup (problem copy, tables),
which does not change.

Through `oristudio-fold-wasm` in Node 22, `import_cp` whole, alternated,
medians of 3, load 4–6: the iguana's open 11.0 → **1.71 s**, its count
12.3 → 2.29 s; crane 13.5 → 8.6 ms, cicada 8.4 → 5.4 ms, the rest 0.9–5 ms
either way.

cpoogle, native, one run each (before: three processes in parallel at load
13–30; after: one at a time at load 30–220, so the after side is
pessimistic), 471 designs:

| | Before | After |
|---|---|---|
| Open, median / p95 / max | 45.8 ms / 3.57 s / 111.3 s | 11.3 ms / 0.74 s / 54.7 s |
| Count, median / p95 / max | 54.3 ms / 5.72 s / 269.8 s | 12.3 ms / 1.10 s / 160.8 s |
| Speed-up where before > 50 ms | | median 4.6× (1.3×–18.1×) |

Slowest ten opens after (before): hydra 54.7 s (69.9), mantis-shrimp
(Serova) 54.1 s (111.3), scutigera 43.9 s (102.0), hand 11-21-23 28.3 s
(46.0), anatomically-precise cockroach 10.1 s (26.7), camel-cricket 3.8 s
(14.6), xenomorph 2.7 s (23.8), skeleton-shrimp 2.5 s (19.7), medusa 2.3 s
(3.8), coconut-crab 2.0 2.3 s (7.1). The first eight are exactly the
designs the stacking cap (12M) now refuses before any search; medusa and
coconut-crab 2.0 are admitted. The four cpoogle models past the dense
limit (2,048 faces) were *slower* than before until the hashing fix; back
to back after it (load 6–13): hand 11-21-23 59.7 → 28.8 s, hydra 75.9 →
48.0 s, medusa 3.7 → 1.8 s, hand 9-30-21 1.27 → 0.60 s.

### Timings: the session

The iguana, native, load 5–7 (24 questions, three modes each):

| | Time |
|---|---|
| Session open (propagation, components, first order, 54 nodes) | 1.08 s |
| A check that fits | median 0.45 s; max 1.5 s with a preference, 3.1 s cold |
| A search-level "no order" proof | 0.67–0.70 s (the old code: 86.5 s) |
| A seed against a forced pair | 0–6 ms |
| The same question from scratch, old code | median 13.6 s; two ran out of 2,000 nodes after 455 and 659 s |

Through wasm in Node (load 4–6): session open 1.53 s, a check median
0.66 s, max 2.3 s. Small fixtures: session open 0.03–2.6 ms, checks 5–230
µs (median). cpoogle, native (contended): session open median 12 ms, p95
1.14 s; a cold answer median 0.08 ms, p95 5.7 ms (a fit: 0.31 ms, 14 ms),
against 13.5 ms and 1.95 s from scratch.

Warm start: with the previous fit preferred ("chained"), the pairs that
change from the order on screen fall on cpoogle from a mean of 115 (cold)
to 35, and on the iguana from a mean of 20,640 (median 23,021) to 7,156
(median 0). Preferring the open's order alone ("warm") helps little: 102
and 19,397.

The check target (about 200 ms) is met on every cpoogle design but the
deepest stacks; on the iguana a fitting check takes about 0.45 s natively,
0.66 s in wasm. What is left is the search's propagation, about 10–40 ms a
node on 250-layer stacks; the next lever is profile item 4 (per-cell bitset
transitivity), not node counts.

### The stacking cap

Re-measured with the faster solver and the cap lifted, through the bridge
in Node (`import_cp`, then `import_pick`, which lands the step as every
replay of its `cp-jump` does), best–worst of 3, load 8–25:

| Triples | Design | Replay, s | Open, s | Replay before, s |
|---|---|---|---|---|
| 1.9M | rat-skeleton | 0.39–0.49 | 2.3–2.4 | threw (count) |
| 4.01M | wasp | 1.17–1.21 | 2.8–3.0 | 3.2 |
| 4.46M | medusa | 2.39–2.69 | 2.5–3.1 | 3.3 |
| 6.21M | coconut-crab 2.0 | 2.22–2.29 | 2.3–2.4 | 5.6 |
| 9.24M | lucanus-bright | 2.03–2.11 | 5.5–5.6 | 6.2 |
| 10.23M | iguana-c0 (cold process) | 1.78–1.87 | 2.9–3.5 | 5.1 |
| 11.34M | sun-wukong | 1.90–1.95 | 2.0–2.2 | 7.0 |
| 12.57M | xenomorph | 3.63–3.82 | 7.0–7.8 | – |
| 12.85M | camel-cricket | 3.29–3.48 | 14.3–14.4 | – |
| 17.90M | skeleton-shrimp | 2.93–2.95 | 3.1–3.3 | – |
| 18.96M | anatomically-precise cockroach | 8.59–8.70 | 9.3–9.5 | – |

All 65 designs timed between 1M and 11.34M triples replay within 2.7 s (the
48 under 4M within 0.9 s; designs under 1M were not timed); natively (load
6) within 2.1 s. The first two past 12M take 3.3–3.8 s. So the cap is now **12,000,000**: of the 471
cpoogle designs that import, 463 are admitted (446 at 4M), and the iguana.
An admitted design can still take up to 5.6 s to *open* (lucanus-bright),
since the open also counts up to 1,000 orders per component.

### What changed, by crate

- `treemaker-flatfold`: `tables.rs` (flat `BF`/`BT`/`BI`/`CC`, scratch);
  `constraints.rs` (propagation with resumable parent pointers,
  `traced_faces`, the split's and the search's skips, `search` with a value
  order); `completion.rs` (validation into the tables); `session.rs`
  (`CompletionSession`, `CheckOptions`, `CheckOutcome`).
- `oristudio-fold`: `CompletionSession` over a whole problem by face ids
  (`open`, `forced_pairs`, `forced`, `forced_by`, `first_order`, `check`),
  `CheckLimits`, `Check`; `Unordered::session`, `ImportedPattern::session`;
  `ChoiceCount`'s serialization.
- `oristudio-fold-wasm`: `import_session` and `import_check` on a held
  import (no web caller yet); the two harness examples.
- `oristudio-layer-order`: the cap.

### Clause learning (not built)

- The open's propagation already keeps upstream's parent pointers (the
  constraint family, the visited variable, its index), which is an
  implication graph; the search's propagation (`propagate_assignment`)
  records no reasons, and would have to, cheaply, for conflict analysis.
- The constraints are small tables, not clauses (taco-taco: 16 of 64 states
  of six pairs; transitivity: 6 of 8 of three). A conflict's explanation is
  the current values of the conflicting constraint's other pairs, resolved
  back through each implied pair's reason; that gives sound nogoods over
  pair orders without enumerating the tables as clauses.
- Transitivity is derived on the fly from cells (about 254 triples per pair
  visit on the iguana); learned nogoods would sit beside it, and watching
  them needs no change to the triples.
- It must stay out of `complete_layer_order` and `solve_flat_fold`: learning
  changes node counts and the order in which orders are listed, which are
  upstream's.
- On these samples it would not change a verdict: every question the old
  code decided, the session decided within its fallback, and only 3 of
  5,084 questions needed a search-level proof (0.7 s on the iguana, where
  the old code took 86.5 s). Where the profile saw
  thrashing (one "on top" pick without an answer in 300 s), the session's
  per-component search with the seeds' pairs first answered it in under a
  second. Its value is worst-case latency, and per-node cost dominates
  today.

### Risks and decisions for the owner

- The stacking cap is raised to 12M as asked; triples are only a proxy
  (skeleton-shrimp at 17.9M replays faster than xenomorph at 12.6M).
- The count fix changes what crosses the bridge for counts past 2^53
  ("at least 9,007,199,254,740,991"); drop that commit if a different
  presentation is wanted, but then such designs crash Import CP.
- The two taco-tortilla count mismatches and the hanging arrangement in the
  synthetic corpus predate this work; they are Flat-Folder parity issues to
  look into separately.
- A check clones the open's state (about 4 MB on the iguana); the tables
  take up to 25 MB at 2,048 faces.
- Checks with a preference cost more where a component the seeds did not
  reach must be searched to confirm the preferred order.
- The wasm session binding has no web caller; its shape may change with
  the dialog's design.

## Independent review

An independent reviewer tried to refute "no answer changed" and could not:
**not refuted**. Its harness is on `review/fold-solver-perf` (`1af131d0c`,
`1258970a6`, under `tools/fold-solver-review/`), a crate built once against
this branch and once against the baseline. It covered about 280,000
session verdicts with 0 disagreements, 539 imports, 900 random fold
sequences, 44 runs past 2,048 faces (the hashed tables), and a brute force
written without the solver, checked against every session verdict.

It raised two hardening items, both fixed:

1. **The bucket contract** (`afb1276e7`). `VariableConstraints` says a
   constraint is listed in the bucket of every variable it reads (as
   upstream's `add_constraint` lists it), and the session's independent
   components rest on it, but validation only checked that a constraint
   reads the variable whose bucket holds it. On problems built to break
   the contract (`asym` mode: each constraint kept only in its last
   variable's bucket), a session said "fits" where completing from scratch
   said "no" 515 times, and the reverse 404 times, in 29,970 questions. No
   product path builds such a problem, but `CompletionSession` is public.
   `CompletionSession::open` now refuses it with `InvalidProblem`, naming
   the constraint and the variable that does not list it;
   `complete_layer_order` is unchanged and still runs upstream's procedure
   over the buckets as given. The review's smallest case (7 faces, two
   stacks, seed variable 3) is a unit test. The check sorts each family's
   listings, grouped by first face: about 21 ms on the iguana (553,056
   taco-taco listings), whose session open went from a median of 999 ms to
   1,023 ms (five alternated runs at load 4–5).
2. **A component past a `u16`** (`20729befe`). The dense taco-tortilla
   component table skipped a component number that did not fit its `u16`,
   which then read as "no component"; only reachable with the test-only
   unlimited dense setting and more than 65,535 faces. The table now goes
   dense only up to `u16::MAX` faces, whatever the limit, and the per-face
   rows (`u32`) keep every component past it; storing one past a `u16` is
   a debug assertion. A test builds 65,536 tacos around one face.

After both fixes:

| Gate | Result |
|---|---|
| fmt, clippy `-D warnings`, tests of `treemaker-flatfold`, `oristudio-layer-order`, `oristudio-fold`, `oristudio-fold-wasm` | pass (63 test binaries) |
| Differential against the baseline, the 10 fixtures and 100 cpoogle designs (every fifth, plus the four past 2,048 faces) | 0 differences; 2 refused by the 12M cap only, as before |
| Session checks against the baseline's answers, the same cases | 384 + 940 questions, 3,972 answers, 0 failures; every one of the 104 importable cases opened |
| The review's `asym` mode, built against this branch, 2,000 problems | every one refused at the open for a constraint missing from a bucket it reads (before: 999 opened, and 919 of their answers disagreed with completing from scratch) |
