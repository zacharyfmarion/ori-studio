# Oriedita-derived flat folded-figure pipeline (`crates/oristudio-cp`): research for a Fold workspace engine

## Summary

- **What it computes (VERIFIED).** The input is a crease-pattern arrangement: border lines (`Black0`), mountain (`Red1`) and valley (`Blue2`) creases, every crease a full ±180°, plus a starting face. From that the pipeline builds:
  - a face graph;
  - a breadth-first spanning tree over the dual graph. Each face's folded position is a chain of reflections back to the starting face, and the parity of its depth gives front/back.
  - a "subface" arrangement of the overlapping folded faces;
  - a seed of face-pair above/below relations taken from M/V;
  - "equivalence conditions": triples (taco-tortilla) and quadruples (taco-taco);
  - a closure pass (Oriedita's AEA, the "additional estimation" step);
  - a deterministic permutation search that lists valid layer orders one at a time, forward only.
- **Two gaps that matter most for Fold.**
  1. It has no notion of history. The first solution it returns is arbitrary with respect to how the paper was physically folded.
  2. It has no seeding API. The search *is* driven by an `InitialHierarchy`, though, so seeding is a small additive change (about 100 lines) inside the crate. Most of it can already be put together from public lower-level functions.
- **Verification (INFERRED from code).** No dedicated "check this layer order" entry point exists. Feeding a *complete* order in as the seed hierarchy makes the existing setup closure pass a sound verifier, provided a completeness check is added. Its cost is the cost of setting up a fold, which is dominated by O(n²) arrangement and condition generation.
- **Tolerances.** There are at least five different absolute tolerances (1e-8 … 2.5e-4 on a 400-unit sheet). The "parallel" test is scale-dependent, and sliver regions fall back to the origin. A Fold engine should own its geometry and topology and use this pipeline only as an oracle.
- **Oriedita folded-figure editing (VERIFIED).** Oriedita has no "fold through layers" operation. It has:
  - dragging folded-figure *vertices* (a distorted drawing; the crease pattern is unchanged);
  - changing the starting face;
  - "color" custom constraints that force which face is on top or bottom at a clicked point;
  - flipping the displayed side.

  The port marks all four handlers `Unsupported`.

## Data model

All of these are VERIFIED (read).

**Input.** `&[LineSegment]` with `LineColor` (`Black0` border, `Red1` = Mountain, `Blue2` = Valley; `geometry/line_segment.rs`, `FoldDirection::from_line_color`). Only folding colours are taken (`LineColor::is_folding_line`, `geometry/line_color.rs:75`).

A non-180 magnitude is refused on the flat path with `fold_needs_3d` (`session.rs:971`). So an unfolded precrease cannot be a 0° red or blue line. It has to be left out of the folded-crease set, either as an aux line or through `folded_figure_fold_selected` (`session.rs:929`, `:1333`).

`starting_face_id: i32` is 1-based. A value ≤ 0 means "the face containing the point (0,0)" (`fold_graph.rs:832` `resolve_starting_face`). There is no API that takes a starting face by point.

**`FoldGraph`** (`fold_graph.rs:15`, `pub(crate)`):
- `points`, `lines: Vec<GraphLine{begin,end,color}>`.
- `faces: Vec<Vec<usize>>`: point rings, rotated so the lowest point id comes first.
- `line_face_borders`.
- `from_segments` (`:260`) only interns endpoints. It does **not** split crossings, so the input must already be a planar arrangement.
- `from_sheet_segments` (`:252`) also drops hole faces (`:521`).

**`FacePositions`** (`fold_graph.rs:36`):
- `face_position` is the BFS depth, 1 for the start face. Odd means same orientation as the start face.
- `next_face` is the parent.
- `associated_line` is the crease to the parent.

**`FoldedWireframe`** (`folding.rs:60`): `points` holds folded coordinates, plus `lines`, `faces` and the BFS-tree arrays. **No per-face transform and no flat coordinates are stored.** Each flat vertex has one folded position, the average of its images over every face containing it (`fold_graph.rs:314` `folded_points`).

A face's transform is implicit: `fold_point` (`fold_graph.rs:891`) composes reflections across the flat-coordinate crease lines from the face up to the root (T_C = R_c1 ∘ R_c2 …).

**Subfaces:**
- `SubFace { face_ids }` and `SubFaceConfiguration { subfaces, reduced_subface_indices, face_id_count_max }` (`folding.rs:85-95`).
- A subface is a cell of the arrangement of folded segments, after `prepare_subface_segments` (`:1590`).
- Its `face_ids` are the faces whose folded polygon contains the cell's interior point (`configure_subfaces`, `:5067`).
- Reduced subfaces are the ones that are not subsets of another (`reduce_subface_set`, `:5508`).

**Layer order:**
- `InitialHierarchy { faces_total, relations: Vec<HierarchyRelation{upper_face, lower_face}> }` (`folding.rs:97-107`). Face ids are 0-based indices into `FoldGraph.faces`.
- "Upper" is in the frame of the starting face's front side.
- Internally this is the dense n×n `u8` `HierarchyTable` (`:5171`, private), with one cell per face pair. That is what makes tortilla-tortilla consistency automatic.
- `EquivalenceCondition {a,b,c,d}` / `EquivalenceConditionSet` (`:196-207`).

**Search state:**
- `WorkerOverlapEnumerator` (`folding/permutation.rs:465`).
- `WorkerOverlapSearch { found, hierarchy, priority, subface_total }` (`:67`).
- `FoldingEstimateSession` (`folding.rs:1406`) wraps the segments, the start face, a `FoldingEstimate` (`:1296`: step, `discovered_fold_cases`, `current_fold_case`, `overlap: Option<WorkerOverlapSearch>` at `:1311`, `contradiction`, `outcome: FoldOutcome` at `:1282`) and the enumerator.

**Outputs across the wire:**
- `FoldedFigureSnapshot` (`:364`) carries the wireframe, case counters and contradiction, but **not the hierarchy relations**.
- `FoldedFigureRenderSnapshot` contains Java2D-style primitives.
- `FoldedPaperScene` (`:669`) contains:
  - `FoldedPaperFace { outline: Vec<Point>, front_up, edges }` (`:697`). The outline is in *camera/screen* coordinates (`paper_scene_faces`, `:2924`), not model coordinates.
  - `FoldedPaperSubface { polygon, faces_top_to_bottom }` (`:730`), built by `subface_top_stack` (`:4704`).
- In Rust only, `session.estimate().overlap.hierarchy.relations` gives the solved face-pair relations.

**Wasm** (`crates/oristudio-cp-wasm/src/lib.rs:279-400`): `folded_figure_fold` / `_fold_selected` / `_fold_another` / `_fold_to_case` / `_paper_scene` / `_snapshot`. Every fold is keyed by a CP **document handle** plus a `run_id` for cancellation.

## Algorithms

Pipeline stages, in order (VERIFIED):

1. **Faces.** `calculate_faces` (`fold_graph.rs:406`) traces faces by always taking the turn with the smallest angle (`r_point`, `:735`). It then applies an Euler gate, `|F−E+V−1| ≤ 0.005·F` (`:459`), and drops holes.
2. **Spanning walk.** `face_positions` (`:341`) is a BFS that scans every face per frontier face, so O(F²). A disconnected dual graph gives `FoldGraphError::DisconnectedFaces`.
3. **Folded geometry.** `folded_points` uses reflection chains and averaging. The wireframe is built by `wireframe_from_graph` (`folding.rs:5043`).
4. **M/V seed.** `initial_hierarchy_from_graph` (`folding.rs:4814`). For each crease between faces f and g:
   - If they have the same parity, it returns `SameParityAdjacentFaces` (`:4834`). This is a 2-colourability check on the dual graph.
   - Otherwise, across a `Red1` crease the odd-parity (front-up) face goes above (`:4843`).
5. **Subfaces.** `prepare_subface_segments`: remove point-length segments, remove duplicates, `divide_intersections`, then clean up again. A second `FoldGraph` is built over the folded segments, then `configure_subfaces`.
6. **Conditions.** `equivalence_condition_candidates_from_parts` (`:4868`), pruned with a quadtree:
   - **Triple:** a face K whose folded polygon `convex_inside`s the folded crease of (B, D) gives the condition (K, B, K, D), "K is not between B and D" (taco-tortilla, `:4940`).
   - **Quadruple:** two creases whose folded segments overlap, `is_segment_overlapping`, and whose four faces all lie in some reduced subface (`:4984`) must not interleave (taco-taco).
7. **Setup closure.** `run_additional_estimation_remove` (`:3257`, `:5398`) runs Oriedita's Italiano incremental transitive closure per subface plus the triple and quadruple rules to a fixpoint (`folding/additional_estimation.rs:600`, `:639`). Conditions that fire are removed. On a large model this decided 99.69% of the order variables before search (`research/2026-08-fold3d-layer-order-investigation.md` Round 14, lines 960-1080).
8. **Search.** `WorkerOverlapEnumerator::from_subfaces` (`permutation.rs:555`):
   - `prioritize_subfaces` (`:326`) sets the valid prefix to the subfaces that still contribute undecided pairs.
   - `set_guide_map` (`:1262`) turns decided pairs into chain-permutation guides.
   - `possible_overlapping_search` (`:660`) loops over `inconsistent_subface_request` (`:1542`). Each subface's search checks:
     - order relations (`:1421`);
     - triples (`:1457`);
     - quadruples (`:1505`);
     - and, past 2000 permutations, hands over to `CombinationGenerator` (`:13`).
   - On a candidate, `run_final_additional_estimation` (`:787`) re-checks transitivity on every subface outside the prefix (`:892`) plus all conditions. A contradiction promotes a subface into the prefix.
9. **Enumeration.**
   - `folding_estimated(Order5)` gives the first solution (`folding.rs:1916`).
   - `Order6` / `fold_another` (`:2177`) give the next one, wrapping around through `restart` (`:2094`).
   - `folding_estimate_to_case` (`:2195`) seeks backwards by deterministic replay.
   - No solutions gives `FoldOutcome::NoSolutions`. A setup or search contradiction gives `FoldOutcome::Contradiction` plus the face pair.

**Performance (VERIFIED from plans and code):**
- Small fixture: 12 ms total.
- `slow_tiling_fold.osf`, 19,652 segments: Order2 1.25 s, Order3 2.27 s, Order4 22.9 s, of which condition generation is 19.3 s, or 85% (`implementation-plans/fold-cancellation.md:70-84`).
- `divide_intersections` is a dynamic O(n²) pair scan (`operations/arrangement.rs:31`); an N=80 grid takes 873 ms per call (`fold-cancellation.md:100-106`).
- `remove_line_segment_set_duplicates` is also O(n²) (`folding.rs:5559`).
- **Recomputation:** every stage rebuilds the graph from the segments. `FoldGraph::from_sheet_segments` runs about four times and `prepare_subface_segments` three times per `folded_figure_fold` (Step 3 `:1704`, Step 4 `:3221`, render inputs `session.rs:1001` → `folding.rs:2409`).
- `HierarchyTable` is F² bytes. The wasm path has a recorded out-of-memory on a large crease pattern (comment at `folding.rs:~1950`).

**Known pathologies (VERIFIED from research):**
- The search is not a decision procedure. Withholding the setup closure produced a witnessed flat-path false negative (Round 14).
- Three real upstream search defects remain in the shared flat search: the swapper reorders without resetting generators, unsound backjump, and resuming from a stale checkpoint. Fixes were written and then removed as unnecessary on the models tested (Round 38, lines 4410-4450). So `NoSolutions` is not a proof.
- Which solution comes first depends on face indexing and the starting face (INFERRED).
- Holes are now filtered (`research/2026-08-31-holes-in-the-folding-pipeline.md`, `fold_graph.rs:521`).
- The Euler gate admits broken arrangements above about 200 faces (`fold_graph.rs` doc at `:53`).
- The averaging in `folded_points` hides a vertex that is not flat-foldable. No error is raised in the fold path (INFERRED from `:314`). Kawasaki and Maekawa are only checked by `checks::check4` (`checks.rs:309`).

## Constraining / seeding

**Not available through `FoldingEstimateSession` or the wasm bridge (VERIFIED).** `overlap_enumerator_from_segments` (`folding.rs:3221`) always derives `initial` from M/V alone.

**Oriedita's own mechanism is partly ported but unwired (VERIFIED):**
- Upstream `CustomConstraint` (`third_party/oriedita/origami/.../folding/constraint/CustomConstraint.java`) pins which faces may be top or bottom of one subface.
- Upstream it is applied in `FoldedFigure_Configurator.java:147-165`, `SubFace.java:281-310`, `:449-455`, and boosted in `SubFacePriority.java:30`.
- The port's `ChainPermutationGenerator::set_top_indices` / `set_bottom_indices` (`permutation.rs:1739`, honoured in `fits_constraint` `:1967`) are oracle-tested (`tests/oriedita_folding_oracle.rs:283`), but nothing in `src/` calls them.
- `OrieditaCustomConstraint` (`folding.rs:448`) is used only to draw markers.
- This gives "top face here" steering, not a full layer-order seed.

**Composable from public API today (VERIFIED signatures; behaviour INFERRED):**
1. `initial_hierarchy_from_segments` (`:1723`) → append seed relations.
2. `validate_initial_hierarchy` (`:5197`). This step is required, because `HierarchyTable::from_initial` silently drops a contradicting duplicate (`let _ =` at `:5219`).
3. `configure_subfaces_from_segments` (`:1704`) + `equivalence_condition_candidates_from_segments` (`:1743`).
4. `WorkerOverlapEnumerator::from_subfaces(...)` → `possible_overlapping_search(true)`.

**Caveat:** this skips the setup closure. `close_hierarchy_with_removal` is `pub(crate)` (`:5340`), and Round 14 shows that skipping it risks false negatives and slowness. Faces are addressed by `FoldGraph` tracing index, which only works because tracing is deterministic for identical segment order. Map them by interior point (`face_position_wireframe_from_segments` gives flat rings).

**Proper fix (INFERRED, small and additive):**
- Add `overlap_enumerator_from_segments_seeded(segments, start, seeds)`. It resolves seeds keyed by *flat interior points* to face indices, validates them, merges them into `initial` *before* `run_additional_estimation_remove`, and is otherwise identical.
- Add a matching `FoldingEstimateSession` constructor and a starting-face-by-point parameter.
- A seed that cannot hold becomes the existing `FoldOutcome::Contradiction { upper, lower }`: a precise "this fold would push face X through face Y" diagnostic.
- With complete seeds, `prioritize_subfaces` gives `valid_count = 0` and the answer comes back in one iteration.

**What to seed with (INFERRED).** New faces are subsets of previous-step faces, because folding only adds creases, so parent faces can be mapped by point-in-polygon on the flat crease pattern. For a pair of new faces whose parents are both stationary, the old relation is inherited. For a pair whose parents both moved, it is reversed. A simple fold then determines every pair constructively, so no search is needed at all.

The seeded search earns its place for complex folds (sinks, reverse folds through chosen layers): seed every unaffected pair and let the search fill in the residual. Remember that "above" is relative to the starting face's orientation. If the anchor face changes between steps, the seeds must be re-expressed in the new frame.

## Verification

**What "valid" means here (VERIFIED):**
- parity, i.e. dual-graph 2-colourability (`:4834`);
- M/V taco seeds (`:4843`);
- taco-tortilla (triples);
- taco-taco (quadruples, only where all four faces share a reduced subface);
- transitivity per subface (Italiano closure; final pass `permutation.rs:892`);
- tortilla-tortilla, which holds implicitly because there is one global cell per face pair.

**Not checked:** that folded vertex images coincide (Kawasaki and closure). `folded_points` averages them instead.

**Checking a given order cheaply.** There is no direct API. A *complete* seeded hierarchy run through the setup closure detects any cycle or condition violation via `try_infer_above` / `ItalianoClosure::try_add` (`additional_estimation.rs:434-470`), INFERRED. The closure does not check that every overlapping pair is decided, so a verifier also needs a completeness pass: for each reduced subface, every face pair is set.

**Cost.** Equal to fold setup (graph, divide, subfaces, conditions). That is milliseconds below about 200 segments and seconds in the thousands, so it suits per-step test or debug verification, not per-pointer-move.

## Tolerances

**Constants** (`geometry/epsilon.rs`, VERIFIED). These are absolute values on Oriedita's 400-unit sheet (`lib.rs:43`):

| Use | Value |
| --- | --- |
| `FoldGraph` vertex weld (`POINT`); lowest index wins, no averaging (`fold_graph.rs:930`, `:971`) | 2.5e-4 |
| Segment intersection `rhit`/`rhei`; duplicate removal (`orita_calc.rs:159`, `folding.rs:5566`) | 1e-4 |
| `Polygon::inside` reports Border (`polygon.rs:172`) | 1e-4 |
| Overlap test (`orita_calc.rs:667`) | 1e-6 |
| Checks; arrangement insertion (`arrangement.rs:499`) | 1e-6 |
| Crease-graph component interning (`crease_graph.rs:63`) | 1e-8 |

**Pathologies (VERIFIED code, INFERRED consequence):**
- **Scale-dependent parallel test.** `StraightLine::from_coordinates` stores unnormalised coefficients (`straight_line.rs:52`). The parallel test `|a1·b2 − a2·b1| < r` (`orita_calc.rs:417`) therefore depends on the product of the two segment lengths, so short segments read as "parallel" at any angle.
- **Sliver subfaces.** `inside_point_find` (`polygon.rs:231`) returns `Point::origin()` when every candidate is within 1e-4 of the border. A sliver subface then gets the face list of whatever covers (0,0).
- **Mixed tolerances.** One point can be one vertex to the fold and two to the checks.

**For a sequence of folds adding irrational creases (INFERRED):**
- Floating-point drift from reflection chains is about 1e-13 per operation, which is harmless.
- The real risk is *distinct* features closer than about 1e-4 (e.g. 2⁻²⁰ subdivisions are ≈3.8e-4) being welded, and near-coincident folded edges producing slivers.
- Huzita–Justin axiom 6 produces cubic roots, so exact constructible-number arithmetic is not available in general.
- The engine should keep combinatorial identity for constructed points: each one is the intersection of known lines, snapped once under a single policy. Make decisions with robust predicates (orient2d), not epsilon welding.

## Oriedita folded-figure editing

All of this is VERIFIED. The port marks every handler below `Unsupported` (`lib.rs:1636-1667`).

- **`MODIFY_CALCULATED_SHAPE_101`** (`MouseHandlerModifyCalculatedShape.java`):
  - You drag a selected folded-figure vertex; `statePointMove` in `WireFrame_Worker_Drawer.java:211-255` moves only the folded point set.
  - MODE_1 re-runs the estimate on release. MODE_2 runs `folding_estimated_03` live and re-derives the stacks.
  - The crease pattern never changes. This is a drawing deformation, not a fold.
- **`CHANGE_STANDARD_FACE_103`:** picks the starting face by clicking the crease pattern, then resets to step 1.
- **`ADD_FOLDING_CONSTRAINT` (104)** (`MouseHandlerAddFoldingConstraints.java`):
  - A click on the folded view picks the faces under that point, split by parity. Left-click adds a `COLOR_BACK`/`COLOR_FRONT` constraint, or inverts an existing one; right-click removes it.
  - The constraint forces whether the visible face there is front-coloured or back-coloured, enforced in the search.
- **`MOVE_CALCULATED_SHAPE_102`, `FlipAction`, size/rotate/undo actions:** view only.
- **`AXIOM_5`/`AXIOM_7`:** these act on the crease pattern, not the folded figure. They are ported (`operations/construction.rs:686`, `:791`).
- There is **no** fold-through-layers operation, no fold-line input on the folded view, and no direct layer reordering.

## Reuse assessment

**Reusable as an oracle or verifier (recommended role):**
- Per step: fold the step's currently-folded creases (`folding_estimate_from_segments`) and require `Solved`.
- Compare the engine's per-vertex folded positions to `FoldedWireframe.points`, with the start face matched.
- Check the engine's order with a seeded, complete verification once that API exists.
- `checks::check4` covers local Maekawa, Kawasaki and big-little-big.
- `treemaker-flatfold` agreed with this solver on the holes case, so it is a second, independent oracle.

**Reusable as library code:**
- `CreasePatternModel` with `add_line_segment_like_worker` (`arrangement.rs:296`) as the per-step crease-pattern store, for `.cp` and FOLD export.
- The `FoldedPaperScene` *schema* for the painter and export, if model-coordinate variants are added.
- Geometry primitives: `Point`, `LineSegment`, `Polygon`, `find_line_symmetry_point` (`orita_calc.rs:509`), `Polygon::clip_segment` (`polygon.rs:291`). Use these for interop, but not for topological decisions.

**Not suitable as the Fold engine core:**
- It has no history, and its first solution is arbitrary.
- It recomputes everything from scratch, with no per-face transforms.
- Its tolerance soup and its averaging that hides errors.
- A layer order cannot be derived from the crease pattern alone: folding "through layers k..m" leaves the same crease pattern with several valid orders. The step model must carry the order explicitly.

**API additions needed:**
1. Seeded estimate or enumerator with point-keyed seeds and validation.
2. Starting face given by point.
3. `verify_layer_order` with a completeness check, returning the violated pair or condition.
4. A model-coordinate `FoldedState` export: per face, the flat ring, folded ring, orientation, 2×3 affine transform, and per-subface stacks plus relations.
5. Segment-based wasm entry points, without a document handle.
6. Optionally, porting `CustomConstraint` (upstream-faithful steering).
7. Optionally, caching the `FoldGraph` and subface graph across stages.

## Open questions / risks

- **`NoSolutions` is not proof.** Latent upstream search defects remain on the flat path, so the engine must never report "this fold is impossible" from the search alone.
- **Reachability.** Flat-foldable is not the same as reachable by the requested motion (closed sinks, reverse folds). A seeded search can return a valid but physically unreachable order. The fold-type modules must constrain this.
- **Frame consistency.** Relations are relative to the starting face. Anchor-face changes, a split anchor, or the user turning the model over all need an explicit convention.
- **Faces are identified by tracing index.** That index is not stable across edits, so point-keyed mapping is required. Points within 1e-4 of an edge can misclassify (`Polygon::inside` Border).
- **Slivers and the 2.5e-4 weld** on deep sequences: decide on one tolerance policy before writing code.
- **Taco-taco gating** requires all four faces in one reduced subface (`folding.rs:4984`). I believe this is complete for valid states but have not checked it against Flat-Folder's constraint set.
- **Cost.** Verification costs as much as setup (O(n²) arrangement). That is fine for tests and per-step checks, but too slow for interactive previews on models above about 1–2k segments.
