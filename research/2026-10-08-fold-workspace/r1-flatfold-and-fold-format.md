# Flat-Folder port (`treemaker-flatfold`), FOLD structures and oracle: research for the Fold workspace

## Summary

- **What it is.** `crates/treemaker-flatfold` is a close, stage-by-stage port of Jason Ku's Flat-Folder. Given a crease pattern (CP), it finds all flat-folded layer orders for that CP's M/V assignment. It works with a Boolean variable per overlapping face pair, constraint types taco-taco, taco-tortilla, tortilla-tortilla and transitivity, unit propagation from M/V creases, and per-component backtracking. Parity with the vendored JS is checked by `crates/oracle-tests` (VERIFIED). Its algorithm has not changed since commit 7c9e059ef (2026-06-10).
- **The public API only covers "solve this CP from scratch".** It has no input for fixed or known face orders. It cannot check a given layer order. It returns only the **first** solution's `face_orders`, with no handle to pick another one. It always roots the fold at face 0, after re-sorting faces by area. It has no injectable epsilon. Internally, every piece needed for "fix the previous orders, solve only the new ambiguity" exists: seed the variable vector and propagate. I showed this works with the vendored JS modules (see "Fixed-variable solving").
- **It is not used by the shipped app at runtime.** The in-app folded figure, and so the Diagram workspace, uses the Oriedita-derived `oristudio-cp` folding engine. Flat-Folder serves as an independent cross-check in tests, as the CLI `treemaker flatfold`, and as a verifier in the CP-detect compiler. The product export path turns that verifier off. A `treemaker-wasm` export exists but nothing in `apps/web` calls it.
- **Measured: the CP alone does not determine a sequential fold's state.** On 200 sampled outputs of Rabbit Ear's `flatFold` programs (sequences of Huzita-Justin axiom folds), 199 solve. **193 of 200 have more than one valid layer order.** So the Fold workspace must store the layer order as state and must not re-derive it from the CP.
- **Recommendation.** Use `treemaker-flatfold` as the **per-step verifier and ambiguity resolver** behind a new lower-level entry point. That entry point would take explicit faces, folded coordinates, the flip vector and a set of fixed pair orders. It would return conflict faces, all solutions per component and a selection API. Do not use it for the per-step layer-order computation itself: simple folds have a closed-form new order. Also do not rely on its adaptive-epsilon arrangement in an engine that owns its own topology.

## API

Everything public is in `crates/treemaker-flatfold/src/lib.rs` (VERIFIED):

| Item | Location | Notes |
|---|---|---|
| `FlatFoldError` {InvalidInput, PrecisionFailure, AssignmentConflict, UnsatisfiedComponent, Unimplemented} | `lib.rs:20-32` | Errors are strings only: no faces or variables to point at in the UI. |
| `PaperSide` {Front, Back}, `SolutionLimit` {All, Count(n)} (default 10) | `lib.rs:34-51` | The limit applies **per component**. |
| `EpsilonPolicy::FlatFolderDefault`, the only variant | `lib.rs:53-57` | There is no way to pass an epsilon. |
| `AnalyzeOptions`, `SolveOptions { starting_face, solution_limit }` | `lib.rs:64-86` | Any `starting_face` other than 0 returns `Unimplemented` (`lib.rs:167-171`). |
| `NormalizedFold { document, vertex_vertices }` | `lib.rs:88-92` | No map from normalized face index back to input face index. |
| `Analysis { normalized, folded_vertices, faces_flip, overlap }` | `lib.rs:94-101` | |
| `OverlapGraph` (points, segments, cells, `cells_faces`, `faces_cells`, …) | `lib.rs:103-113` | |
| `SolveResult { constraints, component_sizes, solution_counts, states, face_orders }` | `lib.rs:115-124` | `face_orders` is the **first solution only**. `states` is a decimal product with no "truncated by the limit" flag. |
| `normalize_fold`, `analyze_flat_fold`, `solve_flat_fold` | `lib.rs:142,149,166` | |
| `infer_edge_assignments_from_face_orders` | `lib.rs:190-224` | Gives `U` creases an M/V from orders: orientation < 0 means M. |

The constraint machinery (`ConstraintState`, `build_constraint_state`, `solve_constraint_state`) is `pub(crate)` (`constraints.rs:30,70,147`) (VERIFIED).

## Representation

**Pipeline** (VERIFIED, mirroring the vendored JS, `third_party/flat-folder/src/compute.js:28-169`):

1. **Normalize** (`conversion.rs:13-110`):
   - When `faces_vertices` is given, faces are **re-sorted by area, largest first** (`:28`, `sort_faces` `:1143`). This matches JS `M.sort_faces`. The vertex and edge indices keep their meaning, with edge endpoints sorted so a<b (`:433`).
   - When faces are absent, it rebuilds the planar arrangement from lines with the epsilon search (`:31-49`), which **re-indexes vertices**.
   - Orientation quirks:
     - If face 0 has negative area, it flips M/V and reverses the faces (`:61-65`).
     - The flip rules differ between the lines path and the faces path (`:52-71`).
     - `Back` uses `flip_y = 1 - y`, which assumes a unit sheet (`:1181`, from upstream `io.js:253`).
   - Faces whose every edge is a boundary edge are dropped as holes (`:75-90`).
   - An edge with one face is forced to `B` (`:91-95`).
   - `edges_foldAngle` is cleared (`:101`).
2. **Project** (`project_normalized`, `:112-232`): a BFS from **face 0**, which keeps its CP position. It flips across `M`, `V` **and `U`** edges; `F`, `B`, `C` and `J` keep the side (`:193-200`). The queue is ordered by edge length, longest first, to limit error accumulation (`:201-215`). The output is `folded_vertices` plus `faces_flip`.
3. **Overlap graph** (`:234-276`): the folded edges are re-arranged with the **same adaptive-epsilon sweep** (`:249`). Cells are the faces of that arrangement. `cells_faces` is found by a BFS that toggles faces across segments (`:278-396`).
4. **Variables, called BF** (`constraints.rs:202-284`):
   - There is one variable per unordered pair of faces that properly overlap.
   - The key is `Vec<u16>` (`:7`), packing 15-bit or 31-bit integers like JS's UTF-16 strings (`math.rs:113-145`).
   - Values: `0` means unknown, `1` means "lower index over higher", `2` means the reverse (`third_party/flat-folder/src/constraints.js:2-5`).
   - "Over" is Flat-Folder's internal frame. The emitted FOLD triple is `[f1, f2, faces_flip[f2] ? 1 : -1]` (`constraints.rs:1091-1095`, JS `conversion.js:783-787`).
   - On `simple-valley.fold` this produced `[[0,1,1]]`. That is consistent with the FOLD rule "+1: f is on the side g's normal points to" when y is up and the viewer is at +z (VERIFIED by running it; the sign reading is INFERRED).
5. **Constraints** (VERIFIED):
   - Edge-edge overlaps go through a 3-bit choice table (`constraints.rs:316-372`, JS `conversion.js:603-651`) and produce taco-taco (6 pairs), taco-tortilla (2 pairs) or tortilla-tortilla (2 pairs). The pair maps are at `:757-776`.
   - Edge-face overlaps produce taco-tortilla, or tortilla-tortilla when the edge's two faces don't overlap (`:374-421`).
   - **Transitivity is never stored.** It is recomputed lazily for each `(f1,f2)` from shared cells (`:718-755`). It is pruned by "CC": for each face c, the connected components of faces linked by taco-tortilla constraints that have c as the tortilla (`:459-504`, JS `conversion.js:705-769`). The pruning is sound because a taco-tortilla chain puts f1 on the same side of f2 and f3, so no 3-cycle is possible (INFERRED from the valid-state tables).
   - Rust-only deviation: edge-edge pairs whose four faces are not distinct are skipped, to cope with sliver faces (`:342-350`). It came from the 7c9e059ef robustness commit; upstream only carries a comment.
6. **Implication tables** (`:778-904`): every 3ⁿ tuple for n ∈ {6, 2, 2, 3} is enumerated and classified as Conflict, Alive, Dead or Implied. The valid states are at `:1132-1141`, identical to JS `constraints.js:24-32`. Lookups use a `String` key per `infer` call, an allocation hot spot.
7. **Solve**:
   - `initial_assignments` turns each M/V crease into an order for its two adjacent faces (`:506-539`), using `faces_flip` of the lower-index face.
   - `propagate_initial_assignments` propagates level by level (`:542-610`).
   - `variable_groups` prepends the propagated set as "group 0", then adds the free groups in **ascending size** (`:613-685`).
   - `guess_vars` is a DFS per group: try 1, then 2, propagate each guess, and collect up to `limit` bit-encoded solutions (`:975-1057`).
   - The groups are independent, so the state count is the product of the per-group counts (`:1099-1103`).
   - The 3D research doc's §8.10 already notes that `[81,18,18]` for Kabuto is "propagated set plus two free groups", not three components.

## Fixed-variable solving

**There is no public support** (VERIFIED):

- M/V creases are the only way to fix variables (`initial_assignments`).
- An input `faceOrders` is carried through `document.clone()` but never read (grep: `face_orders` appears only in the output path).
- Only the first solution is materialized (`first_solution_face_orders`, `constraints.rs:1059-1097`). `group_solutions` is dropped.
- On conflict the Rust port reports only a string. Upstream records parent pointers `BP` and returns the **faces involved in the conflict** (`solver.js:194-240`, `error_faces` `:267-301`), which the GUI highlights (`gui.js:538`). That part was not ported.

**How upstream lets the user pick states.** It does not fix variables. The worker keeps `GA`, the enumerated solutions per group (up to the limit). The GUI's "Component" dropdown and numeric state input set `Gi[c]` (`gui.js:236-272`). That calls `Gi_2_CD_FO(Gi)` (`compute.js:161-169`), which rebuilds the per-cell stacks `CD` and `FO` from `BF_GB_GA_GI_2_edges` (`conversion.js:771-782`, `789-796`). The selection is an index into a DFS-ordered list. That index is stable only for the same input and has no semantic meaning.

**Feasibility of real fixing.** It is straightforward, because the solver is "seed, propagate, then search what is left". I checked this with the vendored modules from an inline `node --input-type=module` script that wrote no files:

- Seeding **all** variables from a candidate order and running `SOLVER.initial_assignment` correctly accepted Flat-Folder's own solution (0 conflicts) on 5/5 corpus files.
- It rejected random face permutations, and the same data read as `layers_face`, with `CONFLICT` on 5/5.

So "check a specific layer order" means: seed every pair and propagate. "Keep the previous step's orders and solve only the new ambiguity" means: seed the known pairs, propagate, then `variable_groups` and `guess_vars` over what is left.

The check is complete when every variable is assigned. Each constraint is touched through at least one of its variables, and pruned transitivity triples are implied by the taco-tortilla constraints (INFERRED).

The Rust change needed would be:

- a `fixed_orders: &[(usize, usize)]` input merged into `initial_assignments` (`constraints.rs:113-123`);
- a port of `BP` and `error_faces`;
- `group_solutions` returned in `SolveResult`, plus a `select(Gi) -> (CD, FO)` function.

**Measured caveat about the payoff.** On a 240-face corpus file, `--limit 1` took 1535 ms and `--limit 10` took 1592 ms. Of 13,137 variables, M/V propagation alone fixed 12,494. The cost sits in building the arrangement, the constraints and the propagation, not in the search. So fixing previous orders makes the answer *correct and unique*, but not much *faster*, unless the build stage is made incremental.

## Usage in app

All VERIFIED by grep and read.

- **`treemaker-wasm::flat_fold_artifacts`** (`crates/treemaker-wasm/src/lib.rs:123-193`) solves the CP and builds a `FoldedBaseSnapshot`. Its `layer_order_from_face_orders` (`:425-444`) is a score heuristic that **ignores the orientation sign**. The web worker imports only `fold_artifacts` (`apps/web/src/workers/treemakerWorker.ts:7,104`). `flatFoldArtifacts` appears only as a stale mock in `store/workspaceStore/store.test.ts:606`.
- **CP-detect compiler.** `verify::run_flat_folder` (`crates/oristudio-cp-compiler/src/verify.rs:210-234`) runs by default (`:22-29`). The product export path disables it (`crates/oristudio-cp-detect/src/decode.rs:1397-1402`). The default options are used in `compiler_from_program_with_context` (`decode.rs:1267-1275`) and in benchmark binaries.
- **CLI:** `treemaker flatfold` (`crates/treemaker-cli/src/main.rs:139-160`).
- **Tests and oracle:**
  - `crates/oracle-tests/tests/flat_folder_oracle.rs`: normalization, projection, overlap and solve parity on kabuto and bad_twist. It needs `FLATFOLDER_ORACLE`, and cells are matched by polygon because their order differs.
  - `flat_folder_corpus.rs`: an external corpus.
  - `flat_folder_controls.rs`: the six `tests/fixtures/folding-sequence/fold` controls, run unconditionally.
  - `oristudio-cp/tests/folding3d_census.rs:750-790` uses it as an independent oracle for the 3D census's variable count.
  - `oristudio-cp/tests/folding.rs:1605-1640` cross-checks a holed sheet.
- **Relation to Oriedita.** There are two separate solvers.
  - The **canonical in-app engine is Oriedita-derived** `oristudio-cp` folding: `folding.rs` plus `folding/`, about 10k lines, SubFace hierarchy and estimation. It is exposed as `folded_figure_*` (`crates/oristudio-cp-wasm/src/lib.rs:279-440`). The Diagram workspace captures from it (`31e1d6d84:apps/web/src/diagram/capture/captureSession.ts:84-131`: flat hold, `nextSolution`, `turnOver`).
  - Flat-Folder is the **independent oracle**.
  - Oriedita's `CustomConstraint` exists in the port but appears only in render options and render paths (`folding.rs:430-466`, `:2676-4108`), not as a solver input (INFERRED from grep).
- **Prior internal attempt.** A removed `treemaker-sequence` crate, "a folding-sequence research attempt that did not work out" (commit 9505e1600), was built on `solve_flat_fold`. It went CP → sequence, the reverse planning problem, not forward folding. Its `SequenceState { document, face_orders, folded_vertices, provenance, … }` is a useful shape reference. Get it with `git show 9505e1600^:crates/treemaker-sequence/src/lib.rs`, around line 1005.

## FOLD support

**`treemaker-fold` `FoldDocument`** (`crates/treemaker-fold/src/lib.rs:140-194`) (VERIFIED):

- File and frame metadata as typed fields: `file_spec`, `file_creator`, `file_author`, `file_title`, `frame_title`, `frame_parent`, `frame_inherit`, `frame_classes`.
- `vertices_coords` as `Vec<Vec<f64>>`, so 2D or 3D.
- `edges_vertices`, `edges_assignment` (B/M/V/F/U/C/J), `edges_foldAngle`, `edges_faces`, `faces_vertices`, `faces_edges`.
- **`faceOrders`**, also accepting the alias `face_orders`.
- Recursive **`file_frames`**.
- Everything else is kept in a flattened `extra`. That includes `file_classes`, `frame_attributes`, `edgeOrders`, `vertices_vertices` and `frame_unit`.

There is no frame-inheritance resolver and no typed `file_classes` field. Round-tripping of a multi-frame file with a `foldedForm` child is tested (`lib.rs:908-975`).

**Folded-state import and export today:**

- `oristudio-cp` writes 3D `foldedForm` frames (`crates/oristudio-cp/src/folding3d/interchange.rs:113-186`). It uses `frame_parent: 0` and **`frame_inherit: false`**, because the fold uses its own indexing. It also writes `frame_attributes: ["3D"]` and an `oristudio:folded3d` marker. `faceOrders` is signed against g's placed normal (`:329-379`).
- On import, folded frames score below crease-pattern frames and are preserved verbatim (`crates/oristudio-cp/src/io/fold.rs:53-118`).
- Nothing in the repo writes or reads `file_classes: ["diagrams"]` or `["animation"]` (grep).
- Upstream Flat-Folder exports a flat folded state as a CP plus a `faceOrders` frame (`io.js:7-27`, with the comment "TODO: remove implied face orders?"). The Rust port has no writer.

**The FOLD 1.2 spec** (https://github.com/edemaine/fold/blob/main/doc/spec.md, fetched):

- `file_classes` includes `"diagrams"`: "A sequence of frames representing folding steps".
- `frame_classes` include `creasePattern` and `foldedForm`.
- `faceOrders [f,g,s]`: +1 means f lies on the side g's normal points to. **Omitting a triple means s = 0.**
- `frame_inherit` copies parent properties that are not overridden.

**A step sequence in FOLD** (INFERRED design):

- `file_classes: ["diagrams"]`, frame 0 = the **final** CP (`creasePattern`, all creases).
- One `foldedForm` frame per step with `frame_parent: 0`, `frame_inherit: true`, overriding only `vertices_coords` (folded 2D), `edges_assignment` (that step's M/V, with not-yet-made or unfolded creases set to `F`), `edges_foldAngle` and `faceOrders`.

This works because faces of the final CP refine every earlier face. Faces that were one face at step k are adjacent across `F` creases and do not overlap, so they create no variables. Flat-Folder already models `F` creases correctly as tortillas (choice-table cases 1-3, `constraints.rs:356-359`).

The same encoding is also a free **solver input** per step: final topology, the step's assignment and the step's orders as fixed variables. The cost is that every frame carries the final face count. The in-memory engine should therefore keep per-step topology with face provenance and project onto the final topology only on export.

## Tolerances

- **Upstream, and the port, use an adaptive epsilon** (`conversion.rs:451-492`, matching `conversion.js:7-28`):
  - Take d as the shortest line length.
  - Try ε = d/2ⁱ for i = 3…27. Pick the largest ε at which the vertex and edge counts repeat 3 times in a row.
  - Return `PrecisionFailure` when the search finds nothing (`:250-254`).
- The README's "ε = L/300" (`README.md:31`) is stale: `M.EPS = 300` is used only for GUI drawing (`gui.js:83`).
- `FLOAT_EPS = 1e-16` is absolute (`math.rs:3`).
- The same search builds the **folded** overlap graph. The tolerance therefore depends on the shortest folded segment and changes from step to step.
- `tests/miura_tolerance.rs` pins tolerance of 1e-5 relative noise. The cliff was measured near 1e-4.

**Implications for sequential folding** (INFERRED, with measured symptoms):

1. Each step adds short segments, so ε shrinks. Reflection error (~1e-15 relative) stays well below it.
2. The real risk is near-coincidences, for example a fold line passing close to an existing vertex. ε then either merges things that are truly distinct or leaves slivers. That shows up as `InvalidInput: constraint references a non-overlapping face pair`. **This happened on 1 of 200 Rabbit Ear corpus files, and upstream JS fails the same file** (oracle status `oracle-error`). So parity holds and the robustness hole is upstream's. The Rust sliver guard (`constraints.rs:342-350`) is the same class of symptom.
3. Separately: 4 of 4 sampled TreeMaker-synthetic CPs, which have no faces in the file, failed with `PrecisionFailure` (not diagnosed).

The Fold engine should own topology itself: one documented tolerance, and new vertices snapped to existing ones at fold time. It should then call Flat-Folder with explicit faces, so no re-arrangement happens, and with folded coordinates it computed itself. Ideally the overlap graph would use the engine's own fixed epsilon, which needs a new `EpsilonPolicy`.

Convexity is a precondition of the face-pair model, per the 3D research §4.5. It holds by construction: straight folds on a convex sheet always split convex faces into convex faces (INFERRED). Holes or non-convex sheets would break that.

## Perf

Measured with the main checkout's `target/release/treemaker`, built 2026-06-10 16:19, after the last algorithm commit at 15:46. Runs were read-only, and the times include process start and JSON output.

| Input | Faces | Variables | Transitivity | Time |
|---|---|---|---|---|
| Kabuto | 18 | 117 | 420 | under 10 ms |
| Rabbit Ear corpus, 200-file sample | — | — | — | p50 36 ms, p90 168 ms |
| One corpus file, Rust (limit 10) | 202 | 9,033 | 260k | 0.69 s |
| Same file, JS oracle under node | 202 | 9,033 | 260k | 1.59 s |
| Largest file in the sample | 240 | 13,137 | 431k | 1.5 s |

Transitivity grows roughly cubically. The Rust port is a direct transliteration: `BTreeMap` with `Vec<u16>` keys, a `String` built per implication lookup, and lazy transitivity rebuilding `BTreeSet`s on every visit (`constraints.rs:718-755`). There is plenty of room to optimize. Upstream's parallel worker paths (`worker.js`, `parallel.js`) were not ported. Wasm was not measured.

This is fine to verify a committed step. It is too slow to run on every mouse move for models with hundreds of faces.

## Reuse assessment

| Role | Verdict |
|---|---|
| **Per-step verifier** (is this folded state, meaning CP + step assignment + orders, non-crossing?) | **Yes. Best fit.** The model is exactly right for flat V1, it is independent of the Oriedita engine, and it is oracle-backed. It needs: an entry point taking explicit faces, folded coords and flips; fixed-order seeding; conflict faces (`error_faces` port); and a returned face-index map. |
| **Ambiguity resolver** for complex folds (reverse, sink, squash) | **Yes.** Fix the orders the operation template determines, solve only the free components, then expose the per-component solutions (upstream's `GA` plus `Gi` model) so the UI can offer choices. Truncation must be reported. |
| **Layer-order engine for simple folds** | **No.** Valley or mountain through the top k layers gives a closed-form new order: moved pairs reverse, moved-over-stationary is fixed, stationary pairs are unchanged. Use Flat-Folder only to check it. Re-solving from the CP is wrong anyway: 193 of 200 sequentially folded CPs have several valid states. |
| **Renderer** | Not ported. Upstream's cell stacks (`CF_edges_2_CD`), segment draw types and visible regions (`conversion.js:789-881`) are JS only. Diagram consumes Oriedita `PaperScene`s, so the Fold workspace probably needs a mapping from cells to SubFace-like stacks (INFERRED). |
| **FOLD I/O** | `treemaker-fold` already round-trips everything a `diagrams` file needs. Missing: frame-inheritance resolution, typed `file_classes` and `frame_attributes`, and a flat `foldedForm` writer. |

Parity discipline (AGENTS.md) applies: any new entry point must keep the existing stages bit-for-bit. The fixed-variable path should be a new function, validated by also seeding the oracle's `initial_assignment`, as done above.

## Open questions / risks

1. **The orientation convention is easy to get wrong.** Several conventions interact: face 0 is the root and is chosen by area; Front/Back flips differ between the lines path and the faces path; `flip_y` is `1 - y`; Flat-Folder's internal "over" differs from FOLD's sign rule. `treemaker-wasm`'s `layer_order_from_face_orders` already ignores the sign. Pin it with golden single-fold tests (valley and mountain, front and back), not with reasoning.
2. **Face re-indexing.** `sort_faces` permutes faces and no map is returned. Any stored orders must be keyed by stable face identity (provenance) and translated on every call.
3. **The Rabbit Ear corpus is not a ready-made oracle.** In 5 of 5 checked files, `faces_layer` is a valid non-crossing stacking. But under either global orientation it disagrees with the file's own `edges_assignment` on 14 to 92 of the M/V-implied pairs. The cause (a generator bug or a convention mismatch) is not diagnosed. Do not use it as ground truth without investigating.
4. **`bird_base` and `frog_base` "failures"** (an open item in `research/2026-08-07-3d-fold-feasibility.md` §4.2/§8.7) are **correct rejections**. `default-molecules/bird_base.fold` has all 12 edges marked `M`. After the one-face edges become boundary, its centre vertex has four mountain creases, which breaks Maekawa (VERIFIED from the data). These files are molecule templates, not foldable sheets. `dove_base.fold` and `fish_base.fold` lack `vertices_coords` at the root.
5. **Robustness:** upstream fails on some near-degenerate states (1 of 200 sampled). We need to decide on engine-owned snapping and a fixed-epsilon policy before relying on Flat-Folder per step. That would be a deliberate local addition beyond upstream parity.
6. **Cost:** build and propagation dominate, so fixing variables does not make it faster. Interactive previews need the closed-form path. Verification on commit may need an optimized or incremental build at 200 or more faces.
7. **Undecided product and engine choice:** do Fold-workspace pictures for Diagram come from Flat-Folder (which needs a renderer or a SubFace mapping) or from the Oriedita engine (which has no fixed-order input today)? Two solvers that disagree on one state would be a support burden. Their variable counts already agree on the fixtures, but their solution sets have not been compared.
8. **Truncation:** `states` is a lower bound when any component hits the limit. A disambiguation UI must say "at least N".
