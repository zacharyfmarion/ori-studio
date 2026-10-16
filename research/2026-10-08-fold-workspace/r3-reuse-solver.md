**Root for repo-relative paths:** `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced`

# Layer-order solver and validator: Oriedita's folded figure vs Flat-Folder vs an engine-native checker

## Answer to Zach's question

Both tools solve the same problem: given a crease pattern, which face lies above which wherever they overlap. They model it differently.

- **Oriedita** works one stack at a time. It looks at each spot where faces pile up and tries orderings of that pile.
- **Flat-Folder** works one face pair at a time. Each overlapping pair is a yes/no question, and it uses rules of the form "if this pair goes one way, that pair must go the other way" to fill in answers.

I ran both on 2,752 Fold states. Both turned out to be ported tools with real defects, and they fail in different places:

- **Oriedita** never produced a wrong order. But it misses valid orders (on 1.8% of states), sometimes says there is no solution when there is one, and its search sometimes hangs for minutes.
- **Flat-Folder** finds every order when its geometry step is right, but that step is wrong on about 7% of states. Separately, a constraint-building step that changes with face numbering can let it output an invalid order.

The plan's D9 still holds, with numbers behind it and three refinements:

- Fold checks each state with its own code.
- For compound folds that need a search, Fold reuses only Flat-Folder's search part, feeding it constraints that Fold builds itself.
- Neither ported pipeline runs at Fold runtime.

What Fold and Edit should share is the representation (the face order, the constraint set and one checker), not the search.

---

## 1. The difference, precisely

| | Oriedita folded figure (`crates/oristudio-cp`) | Flat-Folder port (`crates/treemaker-flatfold`) |
|---|---|---|
| **State** | A dense face×face table of above/below (`folding.rs:5202`, `:5216`). Plus "subfaces" (the cells where folded faces overlap, each with its stack of faces) and two kinds of equivalence condition (triple and quadruple). VERIFIED (read). | One yes/no variable per overlapping face pair (key type `Vec<u16>`, `constraints.rs:7`). Plus per-variable lists of taco-taco, taco-tortilla and tortilla-tortilla constraints. Transitivity is derived lazily from its cell map (`constraints.rs:718`; upstream `solver.js:115`). VERIFIED (read). |
| **Search** | Tries orderings of each subface's stack, digit by digit. An incremental transitive-closure step ("AEA") prunes; a swapper reorders subfaces at dead ends (`permutation.rs:660`). The flat path has no iteration budget (`permutation.rs:608`). VERIFIED (read). | Seed, then unit propagation over implication tables (`constraints.rs:542`). Then the remaining variables split into independent components, and a DFS with propagation runs per component (`:613`, `:975`). VERIFIED (read). |
| **Is "no solution" a proof?** | No. The three upstream search defects stay in the flat path as faithful ports (research `2026-08-fold3d-layer-order-investigation.md` Round 38). The oracle pins this search stage by stage (`tests/oriedita_folding_oracle.rs`, 29 tests, including `combination_generator_sweep` at `:576`). Measured below: incomplete, false NoSolutions, stalls. VERIFIED (ran). | The DFS is exhaustive over the constraint set it is given, so "no solution" is a proof relative to that set. But the set comes from an arrangement whose ε is chosen by a heuristic (`conversion.rs:451`), with no validation. Measured below: wrong on 6.9% of states, plus one constraint-building defect that depends on face numbering. VERIFIED (ran). |
| **Seeding** | M/V letters only: the initial hierarchy comes from line colour and face parity (`folding.rs:4843`). Any crease that is not `Red1` is treated as a valley. `U` creases are removed before folding (`line_color.rs:75`). Upstream `CustomConstraint` (top/bottom faces at a point) is **not ported** (PORTING.md:440-447). The flat path has no public way to inject pair orders. VERIFIED (read). | M/V letters via `initial_assignments` (`constraints.rs:506`), which is `pub(crate)`. The public `solve_flat_fold` (`lib.rs:166`) has no caller seeding. Unassigned (`U`) creases are allowed. VERIFIED (read). |
| **Enumeration** | Forward only, one complete solution per "Another solution". Can produce duplicates. "Back" is implemented as restart and replay. VERIFIED (read and ran). | Solution sets per component; the total count is the product. The public API returns only the first solution plus counts (`constraints.rs:1059`). VERIFIED (read). |
| **Precreases (F edges)** | Only folding colours go in (`is_folding_line`), so faces merge across F. It cannot represent different orders for two pieces of a face across a precrease. VERIFIED (ran: the r117-s05 control). | F edges are native: crossing one keeps the face's side (`conversion.rs` projection). VERIFIED (read and ran). |
| **Tolerance** | At least seven absolute ε constants on a 400-unit sheet in the fold graph, folding and arrangement code. Vertex images are averaged (`fold_graph.rs:314`). VERIFIED (read). | One ε per document from a halving heuristic. Faces are re-sorted by area (`conversion.rs:1143`), and that changes the folded frame. VERIFIED (read and ran). |
| **Where it runs today** | Edit's folded figure (`oristudio-cp-wasm/src/lib.rs:279-434`, `session.rs:913`). Its scene feeds the canvas, export and the Diagram. The 3D path reuses its enumerator (`folding3d/order.rs:606`). VERIFIED (read). | **No shipped web runtime caller.** `treemaker-wasm` `flat_fold_artifacts` (`lib.rs:123`) is referenced only by a test mock (`store.test.ts:606`). CP detection turns it off (`oristudio-cp-detect/src/decode.rs:749,910,1401,1674`). Used by the CLI (`treemaker-cli/src/main.rs:145`), compiler verify (`oristudio-cp-compiler/src/verify.rs:175`) and as a test oracle. VERIFIED (grep). |
| **Porting obligations** | Oriedita's Java oracle pins every stage. Changing the search is a deliberate divergence; the 3D path did that behind a gate. Additive public functions are allowed. | The JS oracle (`tools/flat-folder-oracle`, `oracle-tests/flat_folder_*`) pins normalize, constraints and solve, including the ε heuristic. Additive entry points are allowed; adding validate-and-retry to the arrangement would be a divergence. |

## 2. Experiment

**What was run.** A scratch crate at `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced/artifacts/fold-spike/reuse/solver/`. It has its own workspace and path dependencies on `oristudio-cp`, `treemaker-flatfold` and `treemaker-fold`, and runs in release mode with 5 workers on a loaded 10-core Mac.

**Corpora:**

| Corpus | States | What it is |
|---|---|---|
| Main | 1,685 | 1,559 random spike states with μ=1e-3 and ≤96 faces (776 have F edges); 21 squash/petal/rabbit-ear outputs; 105 frames from Beloch's fixtures, crane included |
| Tolerance stress | 1,044 | Random states with μ=0 |
| Large | 23 | 97–396 faces |

**How answers were compared.** Each solver's answer was converted to FOLD triples on our faces. Faces were matched by ring for Flat-Folder and by centroid for Oriedita; 0 faces failed to map in any corpus.

**Oriedita's frame convention, calibrated.** Oriedita's "upper face" is the one toward the viewer of the starting face's front. Under that convention our order verified on 1,685 of 1,685 states; under the opposite convention 1,667 states were contradicted. VERIFIED.

**Third judge.** The spike's arrangement-free checker (`indep.mjs`) re-checked every solution on 266 states (`judge.mjs`). That covered all the problem states plus a control sample.

### Results on the main corpus (1,685 states, all valid by construction)

| Check | Flat-Folder (Rust) | Oriedita |
|---|---|---|
| (a) Solve from CP + letters | 1,667 solved; **18 failures** (12 invalid_input, 6 assignment_conflict). All 18 had a wrong arrangement. | 1,680 solved; **5 false NoSolutions** (60–96 faces) |
| (b) Enumerate. Is the real (history) order among the solutions? | All solutions found when the arrangement is right. 1 miss caused by the arrangement. | **Missing in 23 complete enumerations.** With the 5 false NoSolutions, that is 28 states where Edit's ‹ n of m › cannot show the real order. |
| (b) Solution sets, on the 1,482 states where both enumerated completely and Flat-Folder's arrangement was right | 6,895 solutions | 6,555 solutions; fewer than Flat-Folder in 26 states (1.8%), more in 1 |
| (b) Third judge, 202 states | **11 states had invalid outputs** (transitivity, taco-taco, letter violations) | **0 invalid outputs**, but missed **1,144 of 5,691** valid solutions |
| (b) Other | In 4 states its "unique" answer was wrong | 14 states with duplicate cases; one state took **44.5 s** to wrongly conclude there was no other solution |
| (c) Verify our complete order, seeded | 1,665 verified, **8 false conflicts** (all arrangement). Single-pair flip detected 1,649 of 1,655; the 6 missed flips are genuinely valid (judge). | 1,685 of 1,685 verified. Flip detected 1,660 of 1,667: the same 6 valid flips, plus 1 flip across an F edge that Oriedita cannot represent. |
| (c') Complete from half of our pairs | Without letters: 1,070 unique, 599 with 2–63 completions, ours always among them. With letters: 1,549 unique. | With letters: 1,568 unique; **ours missing twice** |
| Beloch frames (105, crane included) | All clean, counts agree | All clean, counts agree |

All rows above are VERIFIED (ran).

### Tolerance-stress corpus (μ=0, 1,044 states)

- Flat-Folder failed to solve 8 states, falsely conflicted on 5, and had a wrong arrangement on 50 (4.8%).
- Oriedita failed its subface arrangement once ("no subfaces", so NotAttempted), and fell short of Flat-Folder's count in 19 of 864 complete enumerations.
- **Four states' "find another" did not finish in ≥8 minutes.** Their first solutions took 8–89 ms.

VERIFIED.

### Large corpus (97–396 faces)

- Oriedita's first solution **stalled for over 10 minutes on one valid 300-face state** (`corpus-big/random/r045-s17.fold`).
- It also had 1 NotAttempted and 1 false NoSolutions.
- Flat-Folder had 2 failures.

VERIFIED.

### Timing

Times are p50, per state, measured under contention:

| Faces | Flat-Folder solve | Oriedita first solution | Flat-Folder seeded verify | Oriedita seeded verify |
|---|---|---|---|---|
| 33–64 | 18 ms | 4.2 ms | 11 ms | 3.8 ms |
| 65–128 | 95 ms | 13 ms | 45 ms | 11 ms |
| 129–250 | 1.7 s | 0.12 s | 1.1 s | 0.07 s |
| 251–400 | 4.9 s | 0.21 s | 2.7 s | 0.12 s |

**Flat-Folder's cost at scale is propagation, not geometry.** At 251–400 faces the seeded verify spends 23 ms on the arrangement, 61 ms on constraints and **2,464 ms on seed and propagate**. VERIFIED (phase timers in the copy).

### Two defects pinned to a cause

1. **Flat-Folder's arrangement depends on face numbering.** Changing the numbering changes face 0, and so changes the folded frame the arrangement is built in.
   - The JS verifier needed ε retries after re-sorting faces on r069-s07, r139-s09 and r134-s07 (`frame-probe.mjs`). The Rust port has no retry.
2. **Flat-Folder drops taco-taco constraints depending on face numbering, with a validated arrangement.**
   - Minimal repro: `corpus-v2/random/r271-s03.fold`, 8 faces.
   - Under our face numbering: 1 state. Under area-sorted numbering: 2 states, and the extra one violates taco-taco.
   - The arrangement is identical in both (18 cells, 22 points, 28 variables, 0 retries), but the taco-taco quadruples drop from 8 to 5. All three missing ones involve crease (0,1) (`r271-probe.mjs`; upstream `conversion.js:603` `ExE_fill_BT`).
   - The repo's own JS oracle reproduces the 2 states, so this is **upstream behaviour, not a port bug**.
   - It is in constraint generation, so caller-built constraints would bypass it.

VERIFIED.

### What needed new entry points

- **Flat-Folder:** no seeding is possible through the public API. I prototyped `solve_seeded` in a scratch copy, in about 170 lines built only from the port's existing private stages (`ffx/src/constraints.rs`, bottom; `ffx/src/lib.rs`).
- **Oriedita:** seeded verification can be composed from public pieces:
  - `initial_hierarchy_from_segments` with our relations appended;
  - then `validate_initial_hierarchy`, `configure_subfaces_from_segments`, `equivalence_condition_candidates_from_segments`;
  - then `WorkerOverlapEnumerator::from_subfaces` and `possible_overlapping_search`.

  This skips the shipped path's removeMode AEA closure: `close_hierarchy_with_removal` is `pub(crate)` (`folding.rs:5340`; the shipped path calls it at `:3257`). A faithful seeded path needs one additive public function beside `overlap_enumerator_from_segments` (`:3221`).

## 3. Candidates

### C1 — Runtime validator (`State::make`)

- **What exists:** both ported pipelines re-derive everything from the CP.
- **Fold needs:** a local, incremental check that never refuses a valid fold and names the faces involved.
- **Options:**
  - Flat-Folder: 0.5% false refusals, and 2.7 s at 300 faces.
  - Oriedita: requires every crease lettered, merges faces across precreases, and is not a proof.
  - **Engine-native checker:** build the four constraint families from Fold's own convex face images.
- **Recommendation:** engine-native, as D9 already says. The evidence is above.
- **Risk:** a new implementation. Mitigated by using both ported solvers and the JS oracle as test oracles (C5).
- **Status:** VERIFIED for the ported options; the native checker itself is INFERRED from the spike's JS checker, which agreed on 300 of 300 valid and 284 of 284 corrupted states.

### C2 — Completion solver for squash, petal and rabbit ear

- **What exists:** Flat-Folder's search part — `ImplicationMaps`, `propagate_initial_assignments`, `variable_groups`, `guess_vars` (`constraints.rs:542-1057`). Upstream already draws this boundary: `solver.js` is a separate module from `conversion.js`.
- **Recommendation:** reuse Flat-Folder's search through one additive entry point, as D9 says, with three refinements from this run:
  1. Accept caller-built variables, constraint tables **and transitivity triples**. Flat-Folder derives transitivity from its own cells (`unpack_constraints`, `solver.js:115`), so that dispatch needs one new source. That touches a ported inner loop and must stay bit-identical for the existing path.
  2. Treat carried pairs as fixed and **propagate only from free variables**. Re-propagating 25k seeded pairs cost about 2.5 s.
  3. Port `error_faces` (`solver.js:267`) so refusals name faces.
- **Oriedita for completion: rejected.**
  - It cannot take unlettered new creases, which squash and petal produce. It would have to enumerate letterings.
  - It cannot represent orders across precreases.
  - It has no pair-seeding seam.
  - It missed the true completion in 2 cases.
- **Cost:** about 300–500 lines in `treemaker-flatfold`, with the existing oracle tests as the gate.
- **Risk:** medium (it is a hot loop).
- **Status:** VERIFIED for seeded completion on Flat-Folder's own arrangement; INFERRED for caller-built constraints.

### C3 — "Import CP" / CP jump in Fold

- **Options:**
  - **Edit's Oriedita flow:** the user is already familiar with it, but it misses valid orders on 1.8% of states, has false NoSolutions, and can stall.
  - **Fold-native import plus Flat-Folder's search (C2):** complete, with choices per component.
- **Recommendation:** Fold-native.
- **Status:** INFERRED; it depends on C2.

### C4 — "Start from Edit's ‹ n of m ›" bridge (Phase 6)

- **What exists:** the chosen Oriedita solution is already exposed (`FoldingEstimate.overlap.hierarchy` plus `face_position_wireframe_from_segments`). The harness converts it to Fold faces with 0 unmapped faces on 2,752 states.
- **Recommendation:** reuse as-is through the shared order type (C5). It needs no change to `oristudio-cp`; a wasm export is still needed.
- **Status:** VERIFIED (the mapping).

### C5 — Shared abstraction (the convergence question)

- **Recommendation:** a small **original** crate that holds what Fold and Edit both need:
  - the face-order type (pairs ↔ FOLD `faceOrders`, plus the Oriedita convention conversion above);
  - the constraint problem (variables plus the four families plus fixed pairs);
  - one checker that names faces.
- **Adapters:** Fold geometry → problem; Oriedita solution → order (public API only); problem → Flat-Folder search (C2).
- **Used by:** Fold's `State::make`, the C4 bridge, and oracle tests (this harness, promoted). Optionally, a debug or test-time check on Edit's outputs; Oriedita produced 0 invalid orders here, so this would be a cheap regression gate.
- **Cost:** marginal, because Fold needs the checker anyway.
- **Status:** INFERRED.

### C6 — Make Edit's folded figure use Flat-Folder, or Fold use Oriedita?

- **Recommendation: no, in either direction.**
  - Edit → Flat-Folder breaks the Oriedita oracle parity.
  - Fold → Oriedita adopts a search that measurably misses valid orders and needs every crease lettered.
- **Possible later step (Ori Studio native):** an opt-in "complete enumeration" in Edit that feeds Oriedita's own subfaces and conditions into Flat-Folder's search. It is INFERRED that Oriedita's triple and quadruple conditions map onto taco-tortilla and taco-taco; that is not checked.

### C7 — Test oracles

- **Change:** replace "Oriedita must reach `Solved`" with Oriedita **seeded** verification. The first would have produced false failures on 5 of 1,685 states, plus stalls.
- **Keep:** Flat-Folder JS with validate-and-retry, and the arrangement-free checker.
- **Status:** VERIFIED.

## Recommendations, ranked

1. **Check Fold states with Fold's own code** in the shared crate (C1, C5). Neither ported pipeline runs at Fold runtime. The measured problems: Flat-Folder falsely refuses 0.5% and needs about 2.5 s to verify at 300 faces; Oriedita cannot represent precreased pieces and needs every crease lettered.
2. **Add the additive `treemaker-flatfold` entry point** (C2) with:
   - caller-built constraints and transitivity triples;
   - carried pairs fixed without re-propagation;
   - a port of `error_faces`.

   Use it for compound-fold completion and for Import CP (C3).
3. **Share the representation, not the search.**
   - One order type, one problem type, one checker.
   - Adapters for Fold, for the Edit ‹ n of m › bridge (C4, already working in the harness), and for the oracles.
   - Keep two searches: Oriedita for Edit (parity) and Flat-Folder's search part for Fold.
4. **Oracles in `oracle-tests`:**
   - Oriedita seeded verification. Add one public function on top of the existing seeded-search code so it runs the removeMode closure.
   - Flat-Folder JS with retry.
   - Beloch's frames.
   - The 8-face `r271-s03` repro.
5. **Record the findings** in research and PORTING.md:
   - Flat-Folder's taco-taco loss that depends on face numbering (upstream; JS reproduces it);
   - Oriedita flat-path incompleteness, false NoSolutions and stalls on Fold states. These also affect Edit's ‹ n of m › today.

## Open questions

1. Is Oriedita parity sacred for Edit's ‹ n of m ›, given that it missed the real order on 1.7% of states and can stall? This decides whether a Flat-Folder-backed "complete" mode for Edit (C6) is worth a PR.
2. Should the D9 entry point take transitivity as explicit triples (simplest, a small change to a ported loop) or as a synthetic cell cover (no loop change, but Fold has to build cells)?
3. Should the propagation cost (2.5 s at 300 faces) be fixed in the port, which is allowed if output is identical, or avoided only by local seeding? Real models measured so far are much smaller (the crane is 60 faces).
4. Should validate-and-retry be added to the Flat-Folder port for its other users (CLI, compiler verify), as a documented divergence? That is separate from Fold.

**Caveats:**
- Timings were measured under contention.
- The Oriedita seeded path is a composition of public pieces, not the shipped path.
- The Flat-Folder entry point was prototyped on Flat-Folder's own arrangement; the caller-built-constraint variant is untested.
- Apart from the Beloch frames, the states are random, not real models.

**Scratch files** (all under `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced/artifacts/fold-spike/reuse/solver/`):
- Harness: `src/main.rs`
- Prototype entry point: `ffx/src/constraints.rs`, `ffx/src/lib.rs`
- Corpus generator: `gen-corpus.mjs`
- Third judge: `judge.mjs`, with output in `judge-results.json`
- Probes: `parity-probe.mjs`, `frame-probe.mjs`, `r271-probe.mjs`
- Summary script: `summarize.mjs`
- Results: `results3-{random,compound,beloch}.jsonl`, `results4-mu0-all.jsonl`, `results5-big.jsonl.partial`, `results6-big.jsonl`

No tracked files were modified.
