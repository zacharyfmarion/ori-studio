# Layer-order constraints: our engines

Research for the layer-order constraints feature (2026-10-19). This slice covers
where layer orders are computed today, and how a user constraint could enter
each engine. It is research only: nothing here was implemented.

- Base: this worktree at `fe8bd4e7a`. Fold branch: `claude/fold-workspace` at
  `aa736f95d` (unmerged). Paths are relative to the worktree root. A branch path
  is written `fold-workspace:path:line`.
- Evidence labels: **Verified** means read in code or confirmed by grep.
  **Measured** means run by the probe in §5. **Documented** means taken from
  internal docs and not re-checked. **Inferred** means reasoned, not tested.

## What each engine can do today

| Engine | Enumerates all orders? | Knows the count? | Exposes components? | Accepts seed relations? | Complete search? | Used in production |
|---|---|---|---|---|---|---|
| **Oriedita port, flat** (`crates/oristudio-cp/src/folding.rs`) | One at a time, forward only. A lazy odometer; it can be walked to the end. | No, only "found so far". | No. | No public seam; only M/V letters go in. Upstream has a top-face/colour `CustomConstraint`, which the port has not wired. | **No.** Upstream's search defects are kept as faithful ports: false "no solution", missed orders, stalls (Documented). | Yes: Edit's folded figure, Diagram flat captures, Pose "next solution", export. |
| **Oriedita port, 3D** (`folding3d/order.rs`) | An odometer over one enumerator per component, forward with wrap. | No, only a high-water mark. | Structural components, built before propagation and usually one dominant. It gives sizes, not states. | Internally, yes: geometric `Fold3dSeed`s, validated with rule and crease names. No user seam. | **No** ("not a decision procedure"). | Yes: Edit's 3D folded figures. |
| **Flat-Folder port, HEAD** (`crates/treemaker-flatfold`) | Every order per component, up to `SolutionLimit` (default **10**). | Yes: the product of per-component counts. It is exact when no component hits the limit. | Sizes and counts, with the forced group first. Per-component lists are computed, then discarded; only the first order is returned. | No. Only letters go in, and the state is `pub(crate)`. | Complete over its own constraints. Those constraints come from an arrangement with a heuristic ε, which was wrong on about 7% of random states (Documented). | **No runtime layer-order use.** Only the CLI, the compiler's verify, and tests use it; CP detection turns it off. |
| **Fold branch** (`complete_layer_order`, `oristudio-layer-order`, `oristudio-fold::complete`), unmerged | Every order per component. Lists are capped (1000 by default) with an exact truncation flag. | Yes: `count() → {orders, exact}`. | Yes: forced pairs, per-component order lists, and `order(choice)`. | **Yes.** Fixed pairs are tagged `Seed` (propagated) or `Carried` (assigned, not propagated). | Complete over its own constraints, which are arrangement-free (built from Fold's convex faces). | Not merged. On the branch it serves Fold's Import CP and compound folds. |

The evidence for every cell is in the sections below.

---

## 1. Oriedita port, flat (`oristudio-cp`)

### 1.1 The pipeline that produces a flat figure's layer order (Verified)

`FoldingEstimateSession::folding_estimated(order)` (`crates/oristudio-cp/src/folding.rs:1936-2072`)
climbs Oriedita's stage ladder. `EstimationOrder` (`folding.rs:216-271`) is
upstream's request level:

| Order | What it does | Where |
|---|---|---|
| 1 | Development view | `folding.rs:1995-2000` |
| 2 | Wireframe: fold graph, face positions, folded points | `estimate_wireframe_from_segments`, `folding.rs:1557-1576` |
| 3 | Subfaces (cells of the folded image) | `configure_subfaces_from_segments`, `folding.rs:1724-1739`; `configure_subfaces`, `:5093-5127` |
| 4 | Builds the enumerator | `overlap_enumerator_from_segments`, `folding.rs:3247-3300` (below) |
| 5 | First solution ("paper" view) | `run_folding_estimated_05`, `folding.rs:2153-2186` |
| 6 | Next solution ("Another solution") | same function, called again |
| 51 | Normalised to 5 | `folding.rs:242-248` |

Order 4 builds the enumerator in this sequence:

1. `FoldGraph::from_sheet_segments`.
2. `face_positions(starting_face_id)`.
3. `initial_hierarchy_from_graph` (`folding.rs:4840-4892`): one relation per
   crease between adjacent faces, from M/V and face parity. It errors with
   `SameParityAdjacentFaces`.
4. The folded wireframe, then the subface graph, then `configure_subfaces`. A
   subface is the set of faces whose folded polygon contains one interior point
   (`:5101-5113`), reduced by containment (`reduce_subface_set`, `:5534-5579`).
5. `equivalence_condition_candidates_from_parts`: triple and quadruple conditions.
6. `HierarchyTable::from_initial` (`:5237-5248`).
7. `run_additional_estimation_remove` (`:5424-5453`). This is Oriedita's
   setup-time AEA closure. It also prunes conditions.
8. `WorkerOverlapEnumerator::from_subfaces` (`crates/oristudio-cp/src/folding/permutation.rs:555-571`).
   Inside it, `prioritize_subfaces` (`permutation.rs:326-389`) picks the
   "valid" prefix of subfaces whose permutations are enumerated, and their
   order.

The search is `WorkerOverlapEnumerator::possible_overlapping_search` (`permutation.rs:660-770`).
It walks per-subface `ChainPermutationGenerator`s. Each generator is guided by
the pairs the hierarchy already decides (`set_guide_map`). Each candidate gets a
final AEA pass (`run_final_additional_estimation`, `:787-828`). A contradiction
there can promote a subface into the prefix (`:705-745`). The answer is
`WorkerOverlapSearch { found, hierarchy: InitialHierarchy, … }` (`permutation.rs:66-72`).
That hierarchy is the pairwise relation set the renderer draws: the top of each
subface stack is the face with the most "above" relations
(`visible_subface_face`, `folding.rs:4709-4750`).

### 1.2 How multiple solutions are enumerated (Verified)

- **Lazily, forward only.** Each Order 6 runs one more
  `possible_overlapping_search`, then `next(valid_count)` advances the odometer
  (`folding.rs:2163-2172`). Nothing retains past solutions; this is the
  "forward-only stream" of `implementation-plans/folded-figure-solution-navigation.md:35-45`.
- **The total is never known.** `discovered_fold_cases` is a high-water mark
  (`folding.rs:1319-1328`). `find_another_overlap_valid = overlap.found && next_subface > 0`
  (`:2172`). The user-facing text is "Number of found solutions = N", plus
  "There is no other solution" once exhausted (`:2176-2184`).
- **The names:**
  - **"Another solution"** is `fold_another` (`folding.rs:2197-2206`). It is
    Order 6, but wraps to case 1 at the end through `restart()`
    (`:2114-2150`). Both the wrap and `restart` are Ori Studio additions;
    upstream stops at the last solution.
  - **`foldToCase`** is `folding_estimate_to_case` (`:2215-2275`), upstream's
    `FoldingEstimateSpecificTask`: run forward until case N. We added
    backwards seeking, which restarts and replays.
  - **"Save 100"** is `folding_estimate_save_batch` (`:2280-2302`).
- **Determinism is the only thing that makes "case N" addressable.** It
  re-enumerates from the start (`folding.rs:2096-2113`).
- **Duplicates are possible.** The Fold branch's research found duplicate cases
  in 14 states (Documented, `fold-workspace:research/2026-10-08-fold-workspace/r3-reuse-solver.md:67`).
  On the fixtures in §5 the probe found **none** (Measured).

### 1.3 What the wasm bridge exposes, and what persists a choice (Verified)

**What it exposes:**

- `folded_figure_fold` and `folded_figure_fold_selected` (`crates/oristudio-cp-wasm/src/lib.rs:300-338`)
  take an `EstimationOrder`.
- `folded_figure_fold_another(handle, run_id)` (`lib.rs:393-397`).
- `folded_figure_fold_to_case(handle, objective, initial_order, run_id)` (`lib.rs:399-411`).
- `folded_figure_3d_fold_another` (`lib.rs:437-443`).
- The session layer is `crates/oristudio-cp/src/session.rs:944-1150`.
- The snapshot (`FoldedFigureSnapshot`, `folding.rs:363-390`) carries
  `discovered_fold_cases`, `current_fold_case`, `find_another_overlap_valid`,
  `contradiction` and its face polygons, and `outcome`.
- **There is no constraint input anywhere on the bridge.**
  `FoldedFigureRenderOptions::custom_constraints` (`folding.rs:421-467`) only
  draws upstream's constraint markers (`push_custom_constraint_primitives`,
  `:4128`).
- The web catalog lists upstream's `AddFoldingConstraint` /
  `addColorConstraintAction` as `notImplemented` (`apps/web/src/lib/oristudioCpCommands.ts:800`).

**What persists a choice: a case number.**

- **Diagram.** It stores `foldCase` ("Which layer-ordering solution, 1-based")
  in the step's render (`apps/web/src/diagram/document/diagramDocument.ts:236-247`).
  It replays with `runtime.foldToCase(handle, foldCase)` (`apps/web/src/diagram/capture/captureFolded.ts:472-476`).
- **Pose.** Its "next solution" verb steps the same session
  (`apps/web/src/diagram/capture/linkedPose.ts:202-220`, `captureSession.ts:110-112`).
- **Edit.** Figures carry `current_fold_case`.
- **3D.** Rehydrate replays by stepping and checks that
  `current_fold_case === targetSolution` (`apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:3329-3341`).
  There is deliberately no 3D `fold_to_case` (`:2670-2674`).
- **Consequence (Inferred, from `prioritize_subfaces` taking the hierarchy at
  `permutation.rs:326-335`).** Any added relation changes the valid prefix and
  the guide maps, so it renumbers every case. A stored `foldCase` does not
  survive adding a constraint.
- **Upstream.** It does not persist custom constraints either. No save or data
  class references `CustomConstraint` (Verified by grep over `third_party/oriedita`).

### 1.4 Upstream already has a user constraint (Verified)

Oriedita has an **Add folding constraint** mode
(`ActionRegistrationService.java:107`: `addColorConstraintAction` →
`MouseMode.ADD_FOLDING_CONSTRAINT`).

- **The handler.** `third_party/oriedita/oriedita/src/main/java/oriedita/editor/handler/MouseHandlerAddFoldingConstraints.java:45-117`.
  - The user clicks a point on the folded figure, front or back view.
  - The faces under the point are split by face-position parity.
  - It creates `CustomConstraint(FaceOrder.NORMAL|FLIPPED, top = one parity class, bottom = the other, pos, COLOR_BACK)`.
  - This reads as "the visible face here shows the back colour".
  - Clicking the marker again inverts it to `COLOR_FRONT`; right-click removes it.
- **The data model.** It is more general than the UI
  (`origami/folding/constraint/CustomConstraint.java:9-84`). "Some face in `top`
  lies above every face in `bottom`" (or below every bottom face, `FLIPPED`).
  `top ∪ bottom` must be exactly one subface's faces. `Type.CUSTOM` exists, so
  "this specific face is on top here" fits the model.
- **How the search honours it:**
  - The constraint attaches to the subface with exactly that face set
    (`FoldedFigure_Configurator.java:147-166, 191-211`). Two constraints on one
    subface merge (`:213-220`).
  - A constrained subface is never reduced away (`:245-248`).
  - It counts as new information, so it enters the enumerated prefix
    (`SubFacePriority.java:30-32`).
  - The generator is restricted with `setTopIndices` / `setBottomIndices`
    (`SubFace.java:448-455`).
  - The constraint takes part in the inconsistency check (`SubFace.java:281-319, 354-358`).
- **Port status.** `ChainPermutationGenerator` carries `set_top_indices` and
  `set_bottom_indices` and honours them (`permutation.rs:1739-1753, 1951-1987`).
  The Oriedita oracle covers that (`crates/oristudio-cp/tests/oriedita_folding_oracle.rs:283-286`).
  **None of the wiring is ported:** nothing calls the setters outside tests.
  `PORTING.md:441-447` records this.

### 1.5 The seam for a pair constraint ("face a above face b") (Verified, except where marked)

**The seam.** It is in `overlap_enumerator_from_segments`, between building
`initial` (`folding.rs:3263`) and `HierarchyTable::from_initial(&initial)`
(`:3278`). User relations appended there:

- go through the AEA closure (`:3283-3288`), so their consequences become
  **forced relations** for free. `configured_hierarchy` (`:3290`) is the closed
  table. It is not exposed today; the public `additional_estimation_from_segments`
  (`:1860-1902`) has no seed parameter.
- steer `prioritize_subfaces` and every subface's guide map, so the generator
  only emits permutations that agree with them.

**Face ids.** These are folded-wireframe face indices: the 0-based index into
`graph.faces`. The same space is used by `SubFace.face_ids`, the hierarchy, and
`FoldContradiction` (`folding.rs:1342-1350`). The modal would map a click on
either view to that id. A CP-side click maps through `face_position_wireframe_from_segments`,
whose topology is shared (`:1362-1364`).

**Pitfalls in the seam:**

- `HierarchyTable::from_initial` silently drops a contradicting relation
  (`let _ = table.infer_above(...)`, `folding.rs:5244-5246`). A user constraint
  that contradicts a crease's M/V would **vanish without an error** unless
  `validate_initial_hierarchy` runs first (`:5210-5234`). That function exists
  for exactly this reason on the 3D path.
- A relation between faces that share no subface is inert (Inferred: AEA and
  the search only read pairs inside subfaces and conditions). It should be
  refused, as the Fold branch does with `FixedNotOverlapping`.
- With an empty constraint list the code path must be byte-identical. The gate
  is `crates/oristudio-cp/tests/oriedita_folding_oracle.rs` (29 tests) plus the
  render oracle.

**What a contradiction looks like today:**

- **Setup.** AEA raises `AdditionalEstimationError::Contradiction { upper_face, lower_face }`
  (`folding.rs:1492-1507`). The session concludes at the transparent
  development with `FoldOutcome::Contradiction` and that face pair
  (`:2027-2031, 2080-2090`). The snapshot adds both faces' CP polygons
  (`:1365-1384`).
  - **There is no provenance.** It names the pair where inference broke, not
    which constraints caused it, so a user with five constraints cannot tell
    which to remove (Inferred from the types).
- **During the search.** If the constrained instance has no order, the result
  is `FoldOutcome::NoSolutions` (`:2047-2057`), with **no faces at all**.
- **The full error taxonomy:**
  - `FoldSetupError` {`FoldGraph`, `InitialHierarchy(SameParityAdjacentFaces)`, `Cancelled`} (`:132-141`).
  - `AdditionalEstimationError` {`Setup`, `Contradiction`, `Cancelled`}.
  - `WorkerOverlapSearchError` {`SubFace`, `AdditionalEstimation`, `Setup`,
    `FinalAdditionalEstimationRequired`, `Exhausted`, `Cancelled`} (`permutation.rs:243-263`).
  - `FoldingEstimateError` {`Setup`, `WorkerOverlap`, `Cancelled`} (`folding.rs:1392-1398`).
  - `FoldOutcome` {`NotAttempted`, `Solved`, `NoSolutions`, `Contradiction`} (`:1302-1313`).

### 1.6 Is the search complete? No.

- **Not a decision procedure (Documented).** "It prunes, and when it runs out
  of unpruned branches it reports that as coverage"
  (`research/2026-08-fold3d-layer-order-investigation.md:22-29`).
- **The defects stay in the flat path (Documented).** Three upstream search
  defects remain as faithful ports. The 3D fixes for them were removed once AEA
  made them unnecessary on the models available (`:4410-4458`).
- **The verdict is non-monotone (Documented).** Dropping one relation, which
  enlarges the feasible set, flipped SAT to UNSAT in **4.62%** of 15,096 trials
  when quadruple conditions were present (`:98-106`). That was measured in the
  3D configuration, on the shared `permutation.rs` code.
- **The flat path has a proven false negative (Documented).** It appears when
  AEA is withheld (`:1028-1043`).
- **Measured on random states by the Fold branch (Documented).** On 1,685
  states (`fold-workspace:research/2026-10-08-fold-workspace/r3-reuse-solver.md:59-88`):
  - 5 false NoSolutions.
  - The real order missing in 23 complete enumerations.
  - 1,144 of 5,691 judged-valid orders missed on 202 judged states.
  - The first solution stalled for over 10 minutes on a 300-face state.
  - Never an invalid order.
- **Implication for constraints (Inferred, not measured).** A seeded relation
  changes the prefix and the guide maps. With a non-monotone, incomplete
  search, "no order satisfies your constraints" **cannot be trusted as a proof**
  on this engine. A constraint could also make a reachable order unreachable,
  or a previously unreachable one reachable.
- **On the real fixtures in §5, the Oriedita count equals Flat-Folder's count
  on every fixture both finished (Measured).** The documented incompleteness
  shows up on random and large states, not on these small models.

## 2. 3D folded-state ordering (`oristudio-cp/src/folding3d/order.rs`), briefly

**Enumeration (Verified):**

- `Fold3dOrderEnumerator` (`order.rs:271-503`) runs one `WorkerOverlapEnumerator`
  per constraint component.
- Components come from a union-find over subfaces, conditions and couplings
  (`:719-756`). They are ordered largest first.
- Each component's enumerator turns on condition promotion and an iteration
  budget (`:601-624`).
- `advance` moves digit 0 (the largest component) first, and wraps
  (`:389-430`). Whether another solution exists is answered by a bounded dry run
  (`lookahead`, `:358-387`).

**Count (Verified):** none. "The total is a product nobody can know in advance",
and `discovered_cases` is a high-water mark (`:44-50, 244-249`).

**Components (Verified, and Documented):**

- `Fold3dOrdering` exposes `component_sizes`, `component_of`, `variables` and
  `undetermined` (`:224-250`).
- These components are structural, built before propagation. The module's own
  doc says the raw graph is "a single dominant component on most admitted
  models" (`:17-22`).
- The investigation found 28 → 1 components on the iguana once couplings are
  added (`research/2026-08-fold3d-layer-order-investigation.md:1098-1118`).
- They are not a "choose a state per component" structure.

**Seeds (Verified):**

- Geometric `Fold3dSeed { relation, kind: SeedKind, line }` (`folding3d/constraints.rs:110-131`)
  are routed to their component (`order.rs:826-834`).
- They are checked pairwise in `Builder::localise`, which reports
  `ContradictorySeeds` naming **both rules and both creases** (`:943-975`).
- Then `validate_initial_hierarchy` runs (`:989-1018`).
- A user relation would fit as one more `SeedKind` appended at `:826`, and
  would inherit the best conflict reporting in the codebase. Ids there are
  global 3D face ids (`OrderVariable.faces`, `:85-89`).

**Failure modes (Verified, and Documented):**

- `NoLayerOrder` when a component yields no first solution (`:534-540`). This
  is not a proof.
- `SearchExhausted` on budget (`:127-134`).
- A known bug: `search_error` writes face ids into the count fields of
  `NoLayerOrder` (`:648-657`; `research/2026-08-…:4498-4502`).

## 3. Flat-Folder port (`crates/treemaker-flatfold`), HEAD

**API (Verified):**

- `normalize_fold`, `analyze_flat_fold`, `solve_flat_fold(document, SolveOptions)`
  (`crates/treemaker-flatfold/src/lib.rs:142-187`).
- `SolveResult` (`lib.rs:115-124`) carries:
  - `component_sizes`, with index 0 the forced group;
  - `solution_counts`;
  - `states`, the product as a decimal string;
  - `face_orders` **for the first solution only** (`first_solution_face_orders`,
    `constraints.rs:1059-1097`).
- Per-component solution lists are built in `solve_constraint_state`
  (`constraints.rs:147-200`) and dropped.
- `SolutionLimit` defaults to **`Count(10)`** (`lib.rs:41-51`), so default counts
  saturate at 10. `treemaker-wasm` passes 10 unless told otherwise
  (`crates/treemaker-wasm/src/lib.rs:143`).
- A custom `starting_face` is `Unimplemented` (`lib.rs:167-171`).

**Components and states (Verified):**

- `variable_groups` (`constraints.rs:613-685`) splits the unassigned variables
  into independent components after propagation.
- `guess_vars` (`:975-1057`) is an exhaustive DFS with propagation per
  component. Upstream Flat-Folder's model is exactly "forced, then independent
  components with their own state lists".

**Fixed assignments (Verified):** none through the public API.

- `initial_assignments` (`constraints.rs:506-539`) takes M/V letters only.
- `ConstraintState` is `pub(crate)` (`:29-39`).
- **Conflicts are strings:** `AssignmentConflict(String)` from the initial
  propagation (`:584-597`) and `UnsatisfiedComponent(String)` (`:185-189`).
  Neither carries faces.

**Completeness (Documented):**

- It is "a proof relative to that set": exhaustive over the constraints it is
  given.
- But the set comes from an arrangement whose ε is chosen by a heuristic in a
  face-numbering-dependent frame. It was wrong on 6.9% of the Fold spike's
  states, and constraint generation drops taco-taco constraints in one case
  (`r271-s03`, upstream behaviour). Sources:
  `fold-workspace:research/2026-10-08-fold-workspace/r3-reuse-solver.md:33, 103-114`
  and `fold-workspace:PORTING.md:870-938`.

**Production use (Verified by grep):** none for layer ordering.

- `treemaker-wasm`'s `flat_fold_artifacts` (`crates/treemaker-wasm/src/lib.rs:123-170`)
  has no caller in `apps/web`, only a mock in `store.test.ts:653`.
- CP detection sets `run_flat_folder: false` (`crates/oristudio-cp-detect/src/decode.rs:749, 910, 1401, 1674`).
- It is used by `oristudio-cp-compiler` verify (`verify.rs:175, 222`), the CLI,
  the oracle tests, and as a dev-dependency of `oristudio-cp` for the 3D census
  test (`crates/oristudio-cp/Cargo.toml:45-49`).

## 4. The Fold workspace branch (`claude/fold-workspace`, unmerged)

### 4.1 What exists (Verified, by `git show`)

**`treemaker-flatfold::complete_layer_order`** is an additive entry point
(`fold-workspace:crates/treemaker-flatfold/src/completion.rs`, 1,113 lines; exported at `lib.rs`).

Input is `CompletionProblem` (`completion.rs:119-132`):

- `variables: [f, g]` with f < g.
- One `VariableConstraints` per variable: taco-taco `[A,B,C,D]`, taco-tortilla
  `[A,B,C]` and tortilla-tortilla `[A,B,C,D]`, in Flat-Folder's conventions.
- `faces_cells` / `cells_faces`. Transitivity is derived inside the search from
  these cells.
- `fixed: Vec<FixedAssignment { variable, order: FirstAbove|SecondAbove, kind: Seed|Carried }>`
  (`:85-102`).
  - **`Seed`** is "new information, propagated with everything it implies".
    This is the user-constraint kind.
  - **`Carried`** is assigned and never propagated.
  - A variable fixed both ways is refused as `InvalidProblem` (`fixed_orders`, `:456-482`).
- **Options:** a per-component `SolutionLimit`, and a `SearchBudget { max_nodes, deadline }`
  read through a caller-supplied clock, because wasm has no `Instant`
  (`:134-163`).

Output is `Completion` (`:253-258`):

- `Solved(CompletionSolution { forced: Vec<Option<PairOrder>>, components: Vec<ComponentSolutions { variables, solutions, truncated }>, nodes })`
  (`:165-228`). It provides `solution_counts()` and `states()`, a lower bound
  when truncated. `assignment(choice)` builds one full order from a pick per
  component.
- `Conflict(CompletionConflict { constraint: ConstraintKind, faces, error_faces })`
  (`:230-240`). `error_faces` is a port of upstream's `error_faces`: every face
  the conflict traces back to through the propagation.
- `UnsatisfiedComponent { component, faces }` (`:242-251`).
- `Err(BudgetExceeded { limit, nodes } | InvalidProblem)`.

**`flat_folder_completion_problem(analysis)`** (`:382-437`) exports Flat-Folder's
own problem with the letters as seeds. Tests can then seed upstream's
constraints with any order.

The contract and gate are in the branch's PORTING.md
(`fold-workspace:PORTING.md:940-1040`). `solve_flat_fold` output stayed identical
on 2,889 FOLD files plus 2,855 spike states (Documented).

**`oristudio-layer-order`** is an original, not ported, MIT/Apache crate
(`fold-workspace:crates/oristudio-layer-order/src/lib.rs:1-39`). It holds:

- `FoldedView`: convex face images and creases.
- `LayerOrder`: pairwise, cyclic allowed, undetermined pairs reported, with
  conversions to FOLD `faceOrders` and from Oriedita.
- `Overlay` (cells) and `ConstraintProblem`.
- `check`: one checker that names faces.

**`oristudio-fold::complete`** wraps the completion for Fold
(`fold-workspace:crates/oristudio-fold/src/complete.rs`):

- `FixedPair { upper, lower: FaceId, kind }` (`:63-69`).
- `CompletionLimits`: per component 1000 by default, `max_nodes` 200,000, and
  an optional deadline (`:93-133`).
- `CompletionRefusal`, with stable codes (`:153-213`): `ambiguous_overlap`,
  `fixed_not_overlapping`, `fixed_contradictory`,
  `conflict {family, faces, traced}`, `no_order {faces}`, `budget_exceeded`,
  `invalid_problem`.
- `Completions` (`:237-370`):
  - `count() → {orders, exact}`;
  - `forced_pairs()`;
  - `components()`, each with `pairs` and the list of `orders`;
  - `chosen_pairs(choice)` and `order(choice)`;
  - `picks(cap)`, the first N full choices;
  - `choice_of(order)`.
- `complete_around(focus)` (`:391-411`) searches only near the faces an
  operation touched.

**From a crease pattern to completions** goes through
`ImportedPattern` (`fold-workspace:crates/oristudio-fold/src/import/mod.rs`):

- It turns CP segments into a sheet (square or rectangle), convex faces and
  constraints (`:1-37`).
- `complete_with(fixed)` takes extra `FixedPair`s on top of the letters
  (`:516-527`).
- `oriedita_seeds(start, relations)` (`:553-610`) maps an Edit Oriedita order
  onto Fold faces by **interior points**, not ids.
- `from_oriedita` (`:612-635`) refuses when the order is not unique and reports
  the count.
- The wasm side exposes `import_cp` and `import_pick(import, choice)`
  (`fold-workspace:crates/oristudio-fold-wasm/src/io/bindings.rs:41-70`). An
  open import reports `count` and per-component `{orders, truncated}`
  (`io/imports.rs:93-140`).

**Persistence is by result, not by index.** `WitnessOrder` names each face by
an interior sheet point and stores FOLD `faceOrders` triples. In the code's
words: "choices are results, never indices or digests"
(`fold-workspace:crates/oristudio-fold/src/witness.rs:1-45`). A replay that no
longer resolves is `Broken {Witness | Completion | NotUnique | Gate}`.

### 4.2 The branch's solver findings (Documented, not re-run)

These come from `fold-workspace:research/2026-10-08-fold-workspace/r3-reuse-solver.md`,
which ran 2,752 states: random spike states, compound-fold outputs and Beloch's
frames.

**Oriedita "never produced a wrong order. But it misses valid orders"** (`:14`):

- Fewer solutions than Flat-Folder in 26 of 1,482 states (1.8%) (`:65`).
- 1,144 of 5,691 judged-valid orders missed (`:66`).
- 5 false NoSolutions, and 28 states where Edit's ‹ n of m › cannot show the
  real order (`:63-64`).
- Duplicates in 14 states, and stalls (`:67, 78, 84`).
- It cannot represent orders across precreases (`:36`).

**Flat-Folder "finds every order when its geometry step is right, but that step
is wrong on about 7% of states"** (`:15, 33`):

- 18 failures and 11 states with invalid outputs (`:63, 66`).
- ε depends on face numbering (`:105-106`).
- Taco-taco loss in `ExE_fill_BT` (`:107-112`).
- `r069-s07`: Flat-Folder finds 4 of 5 orders, and the missed one is caused by
  the arrangement, not the search (`fold-workspace:PORTING.md:913-938`).
- That caller-built constraints avoid both arrangement failures is marked
  **[derived]** (`fold-workspace:PORTING.md:1038-1040`), meaning inferred.

**Cost:** Flat-Folder's cost at scale is propagation. At 251–400 faces, about
2.5 s of a 2.7 s seeded verify (`r3-reuse-solver.md:94-101`). The branch then
reworked propagation for speed (`fold-workspace:PORTING.md:1012-1036`). That is
not measured here.

**The branch's own recommendation** (`r3-reuse-solver.md:203-206`): "Share the
representation, not the search". Keep Oriedita for Edit, for parity, and
Flat-Folder's search for Fold. It lists an opt-in Flat-Folder-backed "complete
enumeration" for Edit as a possible later step. Its open question 1 (`:218`)
asks whether Oriedita parity is sacred for Edit's ‹ n of m ›.

### 4.3 Is it a better home for a user-constraint API?

Functionally, yes. It already has every output the modal needs:

- seed relations in;
- forced relations, per-component choices, an honest count with a
  truncation flag, and conflicts that name traced faces out;
- a budget;
- persistence that survives renumbering.

The Oriedita port has none of these and would need four additive APIs to get
close.

The costs are in §6.

## 5. Measurement

**The probe.** It lives at `artifacts/layer-order-probe/` (gitignored), a
standalone crate that depends on HEAD's `oristudio-cp` and `treemaker-flatfold`.
The run uses the release build, one run per fixture, on a laptop that was
possibly loaded.

**Flat-Folder side.**

- `solve_flat_fold` with `SolutionLimit::Count(5000)` per component.
- "Forced" is Flat-Folder's group 0.
- Components are listed as variables:states.

**Oriedita side.**

- `FoldingEstimateSession`, starting face 1, walks every case through Order 6.
- It is capped at 60 s, enforced with a cancel watchdog.
- Each case is deduplicated by its sorted relation set.
- **The view signature** is computed for each distinct case, over all
  subfaces:
  - the front signature is each subface's top face;
  - the back signature is each subface's bottom face;
  - the colour signature is the parity of the top face's position.

| Fixture | Faces | Variables (pairs) | Forced | Free components (vars:states) | Flat-Folder states | Oriedita cases (distinct) | Distinct views: front / back / both | Cells whose top face varies |
|---|---|---|---|---|---|---|---|---|
| `tests/fixtures/flat-folder/kabuto.fold` | 18 | 117 | 69% | 18:3, 18:3 | **9** | 9 (9) | **9** / 1 / 9 | 14 of 22 |
| `tests/fixtures/oriedita/solution_sample_1.cp` | 21 | 76 | 79% | 4:2 ×4 | **16** | 16 (16) | **1** / 16 / 16 | 0 of 28 |
| `third_party/oriedita/…/colorconstrainttest.cp` (upstream's test resource) | 12 | 66 | 67% | 22:22 | **22** | 22 (22) | **12** (2 by colour) / 2 / 12 | 4 of 6 |
| `tests/fixtures/folding-sequence/fold/treemaker-triad-base.fold` | 6 | 15 | 73% | 4:2 | 2 | 2 (2) | 1 / 1 / 1 | 0 of 1 |
| `tests/fixtures/folding-sequence/fold/squash-local.fold` | 8 | 28 | 71% | 8:3 | 3 | 3 (3) | 1 / 1 / 1 | 0 of 1 |
| `third_party/oriedita/…/birdbase.cp` | 14 | 55 | 100% | none | 1 | 1 | 1 / 1 / 1 | 0 of 4 |
| `kite-rabbit-ear-local`, `accordion-book-fold`, `embedded_folded_form` | 4 / 3 / 2 | 6 / 3 / 1 | 100% | none | 1 each | 1 each | 1 | n/a |
| `tests/fixtures/precrease/iguana-c0.fold` (1,774 segments) | **850** | **120,825** | **46%** | **one component of 65,851 variables : ≥5,000 states** (cap hit, 55 s) | **≥5,000** | 104 found in 60 s, timed out. First found in 0.51 s; 0 duplicates. | 1 / 1 / 1 **over those 104** | 0 of 17 (max stack 250) |

**Not measurable:**

- `tests/fixtures/simulation/iguana_24.osf`: Oriedita traces no faces, and
  Flat-Folder reports "vertex 0 was not reached". Its CP has 1,363 `Black0`
  segments.
- `precrease/hex-14.fold`: an Oriedita contradiction, and a Flat-Folder
  precision failure.
- `grid6`, `divergence-1` and `x13_x38`: precrease fragments that are not
  flat-foldable as lettered.
- `spikes_large`: non-flat.
- The default-molecule `.fold` files: fragments.

All Measured. What the table shows:

- **Counts agree where both finished.** The Oriedita case count equals
  Flat-Folder's product on every fixture both completed. Both solvers count
  120,825 overlapping pairs on the iguana. These small real models show no
  misses and no duplicates.
- **Small models are small products of small components.** Components have 2 or
  3 states (kabuto 3×3, sample 2⁴), or there is one component of 22 states. A
  per-component chooser would be usable here.
- **The large model is one giant component.** The iguana-c0 has one free
  component of 65,851 variables with at least 5,000 states (the cap was hit). A
  per-component chooser is **not** usable there; the component structure
  carries no information. Flat-Folder took 55 s; Oriedita's first solution took
  0.51 s.
- **Many orders differ only in hidden layers:**

  | Fixture | Orders | Distinct views (front and back) |
  |---|---|---|
  | triad | 2 | 1 |
  | squash | 3 | 1 |
  | colorconstrainttest | 22 | 12 |
  | iguana-c0 (first 104 only) | 104 | 1 |

  - solution_sample_1's 16 orders are all **identical from the front** and all
    different from the back.
  - kabuto's 9 orders all differ from the front and are identical from the back.
  - So "which order" often has no answer the user can see, and grouping
    solutions by visible signature collapses most of the space on these
    fixtures.
- **Caveat: the iguana's 104 cases are a biased sample (Inferred).** They are
  the first 104 of an odometer that changes the last subface fastest. They say
  nothing about the visible variety of the other ≥4,896.

## 6. Where a shared API should live: options and trade-offs (not a decision)

**What all three consumers need:**

- Edit (Oriedita-port flat figures, and 3D).
- Diagram, for captured flat steps and Pose. It drives the same Oriedita
  session through `foldToCase` and `nextSolution`.
- The Fold workspace.

Each needs to send constraints in, and get back solutions, forced relations and
conflicts, with persistence that survives the constraints changing the
enumeration.

### Option A: constraints inside the Oriedita port

There are two parts:

- **A1. Port upstream's `CustomConstraint` faithfully** (§1.4). The UI is
  "click a spot on the folded figure: show the other colour here", and the
  model generalises to "this face on top here". This is not our addition but an
  unported upstream feature, so porting discipline requires a faithful port,
  gated by the Oriedita oracle. Today the oracle only covers the generator part.
- **A2. Add additive seeded pair relations at the `initial` seam** (§1.5). It
  needs `validate_initial_hierarchy`, an overlap check, and exposure of the
  AEA-closed table as "forced relations".

| | |
|---|---|
| **For** | Edit, Diagram and Pose already render from this engine, so no face bridge and no second renderer. 3D reuses the enumerator, and its seed machinery already names rules and creases on a conflict. First solution is fast (0.51 s on the 850-face iguana against Flat-Folder's 55 s). With no constraints, upstream behaviour is untouched by construction. |
| **Against** | No count, no components, forward only. Conflicts name one face pair with no provenance, or no faces at all (`NoSolutions`). The search is documented incomplete and non-monotone, so "your constraints have no solution" is not trustworthy. Stored `foldCase` numbers shift whenever constraints change. |

### Option B: the Fold branch's stack as the shared engine

The stack is `oristudio-layer-order`, plus `complete_layer_order`, plus
`oristudio-fold::complete` and `ImportedPattern`.

| | |
|---|---|
| **For** | Built for exactly this (§4.1): `Seed` pairs in; forced pairs, per-component choices, exact or lower-bound count, traced conflict faces, budget out. Persistence by witness points. It is complete over its constraints, and those constraints avoid Flat-Folder's ε arrangement, though that last point is [derived]. Fold already uses it, and the branch already maps an Edit order onto it (`oriedita_seeds`). |
| **Against** | Unmerged, and it lives behind Fold-engine types (`FoldedView`, `ImportedPattern` with a square or rectangle sheet). Edit and Diagram would need a face bridge, which exists but is point-based. They would also need an additive "render this externally supplied order" path in `oristudio-cp`, because the result does not come out of Edit's enumerator. Propagation dominates at scale: 55 s on HEAD's Flat-Folder to list 5,000 orders of the iguana; the branch's speed-ups are not measured. On large models the per-component lists are a single giant list, so the UI still needs a different handle, such as visible cells. Using it for Edit's ‹ n of m › would diverge from Oriedita parity, which the branch itself leaves as an open question. |

### Option C: split the representation from the searches

This follows the branch's own "share the representation, not the search".

- **Shared.** The vocabulary lives in `oristudio-layer-order`, Fold's original
  crate. It holds:
  - pair constraints, and top-face-at-a-point constraints;
  - the checker;
  - a witness-point persistence format;
  - the completion API for counts, forced relations, components and conflicts.
- **Edit keeps Oriedita's search for display and ‹ n of m ›.** It gains:
  - A1, ported for parity;
  - an additive seeded entry, A2, used to show the order the user picked, or to
    verify it. The branch measured Oriedita seeded verification at 1,685 of
    1,685 states (Documented).
- **The modal asks the shared completion for the analysis.**

| | |
|---|---|
| **For** | Each engine keeps its parity obligations. The modal gets honest counts and conflicts. A stored choice survives renumbering. |
| **Against** | Two engines can disagree about a fold. This is measured: Oriedita misses orders on 1.8% of random states. The bridge and the external-order rendering path are new code. It depends on merging the Fold branch first. |

### What porting discipline implies, whichever option

**Upstream's `CustomConstraint` is upstream behaviour.** If the product exposes
"colour at a point" or "face on top at a point", the Oriedita side must be a
faithful port:

- attach the constraint to a subface by its exact face set, and merge;
- keep constrained subfaces through the reduction;
- count it as new information in the priority;
- set `setTopIndices` and `setBottomIndices`;
- include it in the inconsistent-digit check.

It must be oracle-gated, never an approximation. Its absence is recorded at
`PORTING.md:441-447`.

**Pair constraints, counts, forced-relation reports, wrap and back navigation
are our additions.** They must be additive entry points.

- **Oriedita.** With no constraints, the flat path must stay byte-identical to
  today, gated by `oriedita_folding_oracle.rs` and the render oracle.
- **Flat-Folder.** `solve_flat_fold` must stay identical, gated by the
  flat-folder oracle and corpus tests. The branch already followed this
  discipline for `complete_layer_order`.
- **The PORTING.md entry for each says what diverges and why.** The precedents
  are `restart()` and wrap at `folding.rs:2110-2113, 2195-2196`.

**Do not "fix" the flat search's incompleteness inside the constraint feature.**
Any change to the search is a gated, documented divergence. R38's ablation
removed three such fixes as unnecessary (`research/2026-08-…:4410-4458`).

**Persist constraints and choices by result, not by case index.** Case numbers
are positions in an enumeration that every constraint reorders. The Fold branch
already states the rule ("choices are results, never indices or digests") and
has a format for it (`WitnessOrder`).

## Could not verify

- Whether Oriedita-port enumeration stays correct and terminates under seeded
  pair relations. Nothing in the repository seeds the flat search.
- Whether caller-built constraints really avoid Flat-Folder's arrangement
  failures. The branch marks this [derived].
- The branch's completion speed on large models. I measured HEAD's
  `solve_flat_fold`, not the branch's reworked propagation.
- The visible variety of the iguana's full solution space, beyond the first
  104 Oriedita cases.
- Whether Oriedita's triple and quadruple conditions map onto taco-tortilla
  and taco-taco constraints, which a Flat-Folder-backed Edit mode would need.
  The branch also marks this unchecked.
- `implementation-plans/folded-figure-solution-navigation.md:121` says
  `solution_sample_1.cp` has 15 solutions. Both solvers measure **16**. The
  plan's number is stale, or it counts differently.
