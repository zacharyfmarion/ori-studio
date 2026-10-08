# Fold workspace research: axiom constructions and step modelling that already exist

## Summary

- **The axioms already exist in three places, and only one is worth building on.** `crates/oristudio-precrease/src/construct.rs` has all seven Huzita–Justin–Hatori constructors. It is original MIT/Apache code with a polished cubic solver, and it is checked against ReferenceFinder by `tools/precrease-rf-crosscheck`.
  - The Oriedita port (`crates/oristudio-cp/src/operations/construction.rs`) has O1, O3, O4, O5 and O7. They are drawing tools that produce segments ending on a destination the user picks. There is no O2 or O6, and no line algebra a solver could reuse.
  - ReferenceFinder (`third_party/reference-finder/src/core/class/refLine/*`) has all seven. It is GPL C++ with legibility rules enforced inside the constructors, and a non-reentrant O6. Use it only as an oracle.
- **The precrease geometry has no idea of layers.** Every validity filter asks a rectangle `Sheet` (`sheet.rs:13-17`), and `Sheet::clip_parameters` returns one interval, so it assumes a convex sheet (`sheet.rs:154-179`). The solving algebra itself depends on no frame. Applying the axioms to a folded form is a refactor of the filters, not of the maths.
- **The precrease step model is an inverse planner's output.** It answers "which crease line comes next, how is it sighted, which face is up". The state behind it is a set of infinite lines and their crossings, `(L, P)` (`state.rs:1-8`). It has no folded state, no layer selection and no operation kind.
  - The reusable ideas are typed references (`Ref`), certified constructions (`Witness` + `Construction`), `who_moves`, the split between physical crease and geometric line (`marks::Creased`), the full-crease-or-pinch extent (`Extent`), face-relative mountain/valley naming (`Direction`/`Side`), twins and "ways".
  - The scheduler, the stuck search, the grid, the quality judge and the replay are planner-only.
- **The card rendering is flat-sheet only.** It covers a rectangle, lines, arcs, a fold-and-unfold arrow, the turn-over glyph and lettered marks.
  - Several pieces carry over directly: the arrow geometry (a verbatim port of `RefDgmr::CalcArrow`), the pens and ink, the symbol layer, the fold playback transport, and the `PaperScene` painter.
  - For folded forms, the Diagram workspace already has the right container, a `PaperScene` picture with paper faces, plus valley-arrow and mountain-arrow annotations. A Fold step should probably emit that rather than extend `StepDiagramPrimitive`.
- **Exactness in precrease rests on four things.** There is one tolerance (`TOL = 1e-6` of the sheet). Every construction is re-checked by running the forward constructor again. Lookups use tolerance-aware indexes and never hash exact coordinates. Marks need crossings of at least 20°.
  - The lattice probe and snap tell which lattice a crease pattern lies on; they do no exact arithmetic.
  - For a Fold workspace, the recommendation is the same discipline plus storing each fold as a construction graph that is recomputed from the start. Exact arithmetic is not practical: O5 and O6 grow the number field without bound.

## Axiom inventory

"PC" = `crates/oristudio-precrease/src/construct.rs`. "OC" = `crates/oristudio-cp/src/operations/construction.rs`. "RF" = `third_party/reference-finder/src/core/class/refLine/`. Everything in this table is VERIFIED unless marked.

| Axiom | precrease (Rust) | Oriedita port (Rust) | ReferenceFinder (C++) | Solutions | Degenerate handling |
|---|---|---|---|---|---|
| **O1** crease through p, q | `o1` PC:157; `Line::from_points` line.rs:53 | `DrawCreaseFree` → `draw_crease_segment` OC:69 (lib.rs:957-959): a segment between two points | `RefLine_C2P_C2P` refLineC2PC2P.cpp:18-34 | 1 | PC: p≈q (closer than TOL) gives none. RF: refuses a skinny flap (line 31). |
| **O2** p onto q | `o2` PC:163; `Line::perpendicular_bisector` line.rs:146 | **none**: no perpendicular-bisector mode in `MouseMode.java` (INFERRED from the full mode list) | `RefLine_P2P` refLineP2P.cpp:18-50 | 1 | PC: p≈q gives none. RF: refused unless one point is on an edge (visibility, lines 33-41), plus the skinny flap. |
| **O3** m₁ onto m₂ | `o3` PC:185-222; overlap test `folded_overlap` PC:172-183 | `SquareBisector` (lib.rs:997-999) → `square_bisector_from_points_to_destination` OC:966, `_from_lines_` OC:993, `_parallel_indicator` OC:1024 | `RefLine_L2L` refLineL2L.cpp:21-91 | 2 bisectors, or 1 midline when parallel | PC: coincident lines give none. Each root must reflect m₁ onto m₂ **and** land in-paper material of m₁ on in-paper material of m₂ (more than TOL). OC: only the bisector through the incenter, ending on a user-picked segment; refused when that segment is parallel. RF: parallel lines give root 0 only; the paper interior must overlap the line (line 56); visibility rule. |
| **O4** through p, ⟂ m | `o4` PC:224-235 | `PerpendicularDraw` (lib.rs:1013-1015) → `perpendicular_projection` OC:605, `perpendicular_indicator` OC:627 (needs p inside the segment's span, OC:632), `_to_destination` OC:664 | `RefLine_L2L_C2P` refLineL2LC2P.cpp:18-43 | 1 | PC and RF: the foot of p on m must be on the paper. |
| **O5** through pivot, p onto m₁ | `o5` PC:237-271 | `Axiom5` (lib.rs:1669-1671, dispatch lib.rs:2978) → `axiom5_indicators` OC:686-748; tangent case OC:1575; pivot inside the segment OC:1679 | `RefLine_P2L_C2P` refLineP2LC2P.cpp:18-80 | ≤ 2 | PC: p on m₁ gives none (trivial Haga). h² < −TOL² gives none. Tangent (h < TOL) gives 1. The landing point must be on the sheet and differ from p, and the pivot is re-checked on the fold. **A pivot on m₁ is allowed on purpose** (predicates.rs:369-374, "how the bird base's eight corner creases are made"). RF: **refuses p or the pivot on l₁** (line 34), and drops root 1 when b < EPS. OC: refuses pivot≈target, refuses when both lie on the target segment, gives none when the pivot is farther from the line than the radius. |
| **O6** p₁ onto m₁ and p₂ onto m₂ | `o6` PC:371-422; `real_roots` PC:276-312; `cubic_roots` PC:339-369 | **none** | `RefLine_P2L_P2L` refLineP2LP2L.cpp:41-258 | ≤ 3 | PC: rejects p₁∈m₁, p₂∈m₂, p₁≈p₂, m₁≈m₂. Falls back to quadratic or linear when the leading coefficient is small (relative 1e-12). Six Newton polishes, then both alignments re-checked at TOL with landings on the sheet, and duplicate lines dropped. RF: closed-form Cardano with no polish. Order is decided by an absolute `EPS = 1e-12` (global/global.h:15). Roots 1 and 2 reuse **static** state left by the root-0 call (lines 18-27, 171-197), so it is not reentrant. The double-root branch uses `pow(R, 1./3)` (line 155), which is NaN for R < 0 (INFERRED bug, only reached when \|D\| < 1e-12). |
| **O7** ⟂ m₂, p onto m₁ | `o7` PC:424-445 | `Axiom7` (lib.rs:1677-1679) → `axiom7_indicator` OC:791-823, `_to_destination` OC:841 | `RefLine_L2L_P2L` refLineL2LP2L.cpp:18-80 | 1 | PC: p∈m₁ gives none. A fold parallel to m₁ (\|k\| ≤ TOL) gives none. The crossing with m₂ and the landing point must both be on the sheet. RF: the header comment names the lines the other way round from the code (fold ⟂ l₂ at line 30, p onto l₁ at line 35). The TS sentence builder calls out the slot reversal (`referencesStepSentences.ts:17-21`). |

Cross-cutting facts (VERIFIED):

- **precrease.**
  - `Construction::lines` drops every root that does not cross the sheet by more than TOL (PC:126-138).
  - `certify` keeps the root closest to a target within TOL (PC:142-154).
  - There is one tolerance, `TOL = 1e-6` in unit-sheet units and radians. It is derived from Oriedita's `Epsilon::POINT = 2.5e-4` on the 400-unit paper (tol.rs:1-17).
  - The derivation is written from the axiom definitions with filters derived from one rule, "a fold must align in-paper material" (PC:4-14). That is licence tier 2 in lib.rs:43-58.
- **Oriedita port.**
  - Its constructions are purple "indicators" extended until they hit existing lines (`full_extend_until_hit`). The committed crease is a segment ending on a destination the user picks.
  - It works with a family of epsilons: `UNKNOWN_1EN7` = 1e-9 model units, and `HIGH` with a 1e-10 zero comparison (`geometry/epsilon.rs:8-29`).
  - It is oracle-tested (descriptor table, lib.rs:1669-1679), but it is a CP drawing tool, not a fold-line solver.
- **ReferenceFinder.**
  - Inputs are `RefMark`/`RefLine` objects; the derived classes are `RefMark_Intersection` and the `RefLine_*` family.
  - Constructors enforce visibility (`sVisibilityMatters = true`, global.cpp:58) and the skinny flap. Marks need `sMinAngleSine = 0.342` (global.cpp:53). The search is bounded by `sMaxRank = 6` and `sMaxLines = 500000` (global.cpp:28-29).

Other Oriedita tools that matter to Fold (VERIFIED they exist, INFERRED that they are relevant):

- `Inward` (incenter rays, OC:946): this is the rabbit-ear geometry.
- `SymmetricDraw` (OC:855) and `mirror_selected_lines` (OC:536): reflecting creases across a fold.
- `make_vertex_flat_foldable_candidates` (OC:248) and `foldable_line_input_*` (OC:296-371): Kawasaki completion at a vertex.

## Step model

**What precrease models (VERIFIED).**

- **Construction layer.**
  - `Construction` is an enum of O1..O7 with concrete inputs (PC:59-74).
  - `Root { line, root }` holds one solution of a construction (PC:79-82).
  - `Certificate { root, err, line }` records a construction that reproduces a target (PC:86-91).
- **Reference layer.**
  - `Ref` (predicates.rs:55-60) is `Edge {id, side}`, `Corner {id, corner}`, `Line {id}` or `Point {id}`. The ids index the `(L, P)` state.
  - `Witness` (predicates.rs:96-121) carries the axiom, `inputs: Vec<Ref>` in the axiom's own order, `root`, `who_moves` (indices of the inputs that move), the legibility flags `hard`, `visible` and `skinny`, `ease`, and `err`.
  - `who_moves_and_visible` (predicates.rs:286-357) decides per axiom which input moves. It prefers an input on the boundary, and for O6 it uses which side of the fold each point is on.
- **What is physically on the paper.**
  - `marks::Creased` (marks.rs:60) records, per line, the creased runs and the pinches separately, plus the "pinchable" spots.
  - `mark_exists` (marks.rs:328) needs two physical creases crossing squarely. The module doc states the distinction: "Two chords meeting is not two creases meeting" (marks.rs:1-20).
- **Instruction layer.**
  - `Step` (sequence.rs:231-382) has `kind` (Cp, Aux, Press or Grid), `line` and `segment`, and `extent`, which is `Extent::Full` or `Pinches{spans}` (pinch.rs:34-39). It also has `witnesses` and `chosen`.
  - Direction fields are `direction` (Mountain, Valley or Unassigned, resolved once per line by majority of creased length, direction.rs:1-35), `direction_share`, and `side` (Front or Back; a change between steps is a turn-over).
  - Physical fields are `press` (`StepPress {at, point, sighted_from}`, sequence.rs:171-181), `pressed_on` and `made` (crease beyond what the pattern asks), `marks_exist` and `missing_marks`.
  - Presentation and accuracy fields are `also` (the mirror witness), `twin` (the symmetric pair shown as one card), `ways` (`Way`, sequence.rs:213-228: alternative constructions that leave the same paper), `exact` and `approximation`.
- **Fold-and-unfold is implicit.** Every step is an alignment fold made as a valley from the face that is up, then released (direction.rs:1-10; D22 in `implementation-plans/reference-finder-integration.md:1330-1348`). O1 is the only axiom without a forced side.
- **Ordering.** The closure folds in rounds that do not depend on order (closure.rs:1-47, Knaster–Tarski argument). `order.rs` builds a baseline of direction clusters and sweeps (order.rs:1-30), with `order::Placed` as its bookkeeping (order.rs:96-160). `search`, `construction` and `rollout` accept a reorder only if a physical replay (`quality::replay`) says it is better.

**Could a Fold step reuse or generalise this? (INFERRED)** Partly. Precrease is *inverse*: given a crease pattern, it plans the lines and picks witnesses. Fold is *forward*: the user authors a state transition on a folded form. Here is what generalises.

1. **A construction as the definition of the fold line.** Store `{axiom, inputs: [FoldRef], root}` and not just the line. The same certify-to-nearest-root idea (PC:142-154) then re-derives the line when an earlier step changes, and the arrow knows what moves (`who_moves`).
2. **Typed references.** `Ref` grows into references on the folded form:
   - a vertex (with the set of CP vertices stacked there),
   - a raw edge, a folded edge (a hinge on the silhouette), or a crease visible on the top layer,
   - each tagged with its source faces and visibility.
   They must be identified by CP provenance, not by folded coordinates.
3. **Extent and press.** A fold-and-unfold step, a pinch and a "reinforce" are the same `Full | Pinches` and `Press` idea.
4. **Face-relative mountain/valley.** `Side::direction` and `Direction::flipped` (direction.rs:55-100) apply unchanged. A valley seen from the back is a mountain.
5. **Twins and ways.** "Repeat on the other side" and alternative constructions.

What precrease lacks, and Fold needs, is a `FoldedState` input and output: faces, per-face isometries and layer order. Fold also needs four things a precrease step has no slot for:
- an **operation kind** (valley, mountain, fold-and-unfold, pinch, inside or outside reverse, sink, squash, petal, rabbit ear, crimp, pleat, swivel, unfold, turn over, rotate);
- a **layer selection** (all layers, the top k, a named flap, or a set of faces);
- a **stays-folded flag**;
- the **crease-pattern change**, meaning new crease segments per face with their mountain/valley assignment.

A sketch (INFERRED):

```
FoldStep { op: OpKind, line: LineSpec /* Axiom{axiom, inputs: Vec<FoldRef>, root} | Existing{edge} | Free{Line} */,
           layers: LayerSelection, keep_folded: bool, extent: Extent }
```

The planner-only parts should not be generalised: `Target`/`cp_line_ids`, `unlocks`, rounds and hoisting, grid steps, `judge.rs` (lever and reach precision heuristics), `quality.rs`, `drive.rs`, and the stuck search.

## Card rendering

**Pipeline (VERIFIED).**

1. A `PrecreaseStep` goes through `plannerStepDiagram` (`apps/web/src/cp-workspace/references/diagram/plannerDiagram.ts:995`). It works in a `DiagramFrame` (`diagram/diagramFrames.ts`), which is a similarity map, so the same rules draw both the unit-square card and the canvas (diagramFrames.ts header).
2. The output is a `StepDiagramModel {sheet: DiagramSheet, primitives}` (`referenceFinderDiagramToPrimitives.ts:108-113`). The primitive kinds are `sheet` (width and height), `line` with a style, `arc`, `fold-arrow` (outgoing arc only), `turn-over`, `region`, `point` and `label` (ibid. 56-107).
3. That model is drawn three ways:
   - as SVG on a card (`StepDiagram.tsx`, `diagram/DiagramPrimitives.tsx` with `diagramShapes`, line 312);
   - on the big view, split by `diagramToScene.ts` (lines to the GPU, symbols to the DOM, header lines 1-12);
   - for export, as a `PaperScene` via `diagramToPaperScene.ts:130`, painted by `lib/paper/paperSvg.ts`.
4. The arrow is `foldArrowArc`, a port of `RefDgmr::CalcArrow` (`stepDiagramGeometry.ts:455-466`). The precrease round trip is `foldAndUnfoldArrow` / `returnStroke` (stepDiagramGeometry.ts:548-625). Input letters come from `diagram/inputLetters.ts`; pens and ink from `diagram/diagramInk.ts` and `diagramColors.ts`.
5. Animation:
   - `diagram/foldMotion.ts` decides which flap swings, reading the same arrow so the two never disagree (header lines 1-20). `FoldMotionKind` is `'cp' | 'aux' | 'press'` (line 98).
   - `fold/foldSurface.ts` is a single flap with a bend radius.
   - `fold/foldPoseGeometry.ts` projects 3D paper top-down into the renderer's `setFolded` channel.
   - `fold/foldPlayback.ts` and `foldTransport.ts` drive a clock-free `FoldPose {flap, angle, press}`.
6. The fold-animation plan names the seams kept for this work: the renderer input is "3D paper, top-down, with depth"; `FoldMotion` is per-step data; the surface is one function of `(s, u)` applied per layer (`implementation-plans/precrease-fold-animation.md:321-338`).

**Diagram workspace (PR #436 @ 31e1d6d84, VERIFIED via `git show`).**

- `DiagramStepSource` is `upload | cp | references-step` (`apps/web/src/diagram/document/diagramDocument.ts:478`).
- `DiagramPicture` includes `step-diagram` (a `StepDiagramModel` in the unit frame, lines 565-572) and `scene` (a `PaperScene` JSON plus an optional `paperFaces` for flat folds, lines 508-551).
- Annotations include `valley-arrow`, `mountain-arrow`, `fold-unfold-arrow` and `pleat-arrow` (lines 596+).
- The References card is pulled in through `diagram/references/referencesBrowserPlans.ts`, which imports the References modules directly.

**What a Fold workspace could reuse (INFERRED).**

- **As is:** the arrow arc and arrowhead geometry (`foldArrowArc`, `arrowheadAt`, `arcPathData`), the projector (`createDiagramProjector`), the pens and ink, the `diagramShapes` symbol drawing, `labelLayout`, the playback transport, and the `PaperScene` painter.
- **Not as is, because these assume a flat sheet:**
  - `DiagramSheet` is a rectangle (stepDiagramGeometry.ts:22-39).
  - `sheetPolygon` takes two frame edges (plannerDiagram.ts:456-461).
  - The flap comes from clipping one convex sheet polygon (`clipPolygonToSide`, plannerDiagram.ts:467).
  - The fold arrow always has a return stroke.
  - `StepDiagramPrimitive` has no faces or layers.
  - The DOM layer does accept an arbitrary paper `outline` (DiagramPrimitives.tsx:162-190), but `diagramToScene` documents that outline as convex.
- **Recommendation:** render the folded form as a `PaperScene` of faces in painter's order with line roles (`packages/origami-simulator/src/paperScene.ts:61-180`). Overlay the step's symbols as markup. Add a `fold-step` `DiagramStepSource` that stores the step record and emits a `scene` picture plus arrow annotations. Keep-folded arrows (valley, mountain) are new symbol kinds; the Diagram workspace's annotation set already names them.

## Exactness

How precrease keeps constructions "exact enough" (VERIFIED):

1. **One epsilon.** `TOL = 1e-6` (tol.rs:17) is used for every comparison, index and dedupe. The doc blames the prototype's false negatives on mixing 1e-7 and 1e-6 (tol.rs:12-15).
2. **Line equality is decided when two lines are compared.** The identification `(n, d) ~ (−n, −d)` is settled at that point and never by snapping components (line.rs:1-8, 170-182). `LineIndex` is an angle-bucket index over π that wraps at the seam (line.rs:224-309), and `PointGrid` uses a cell of 8·TOL (state.rs:41, pointgrid.rs:48).
3. **No step without a certificate.** Every witness re-runs the forward constructor and needs a residual of at most TOL (PC:142-154; predicates.rs:1-8). O6 roots are Newton-polished and then re-checked (PC:291-308, 404-412).
4. **A conditioning floor.** Two lines create a mark only at |sin θ| ≥ 0.342 (constants.rs:5-9; state.rs:1-28), so each intersection amplifies error by at most about 3×.
5. **Exactness follows from the inputs.** `Step.exact` is false if any input is approximate, or is a mark with fewer than two exact creases through it (sequence.rs:21-30, 334-340). Approximations are reported and never used as references (plan, lines 45-48).
6. **Input probe and snap.** `exactness.rs` and `lattice.rs` sort a crease pattern into Exact, Snappable or OffLattice against angle families (multiples of π/8 and π/12, rational slopes) and offset rings (ℚ, ℤ[√2], ℤ[√3]), with `SNAP_RADIUS = 2e-3` (lattice.rs:1-40, tol.rs:22). This is a recogniser over f64; there is no exact arithmetic type (`LatticeOffset` holds `p`, `q`, `denominator` and an f64 `value`, lattice.rs:253-260).

What this means for a Fold workspace (INFERRED):

- Folding produces "origami numbers": the field generated by intersections of conics, which includes the roots of the O6 cubic ([Alperin, arXiv math/9912039](https://arxiv.org/pdf/math/9912039)). O5 adds square roots and O6 adds cube roots, so exact arithmetic would need towers of algebraic extensions that keep growing. That is not practical as the main representation.
- Use precrease's approach instead:
  - Use f64 with the shared TOL.
  - Store each fold as its construction (the input references plus a root) and recompute from the start rather than updating coordinates step by step.
  - Compute each face's isometry fresh from the crease pattern (by traversing the faces) rather than composing one reflection per step.
  - Snap new crease preimages onto existing crease-pattern vertices and edges within TOL, so a fold through a stacked corner does not leave sliver faces.
  - Keep the lattice probe as an optional "this state is exact in ℤ[√2]" readout, not as a snap applied to user-authored folds.
- TOL is 6.25e-7 of the sheet rounded up, so it agrees with how the CP kernel decides that two lines are the same.

## Axioms on folded forms

**Can they apply? Yes, in principle (INFERRED, from the maths).** A flat-folded state maps each face f into one plane by an isometry `T_f`. Visible vertices, raw edges, folded edges and visible creases are all images under some `T_f`. The axioms are statements about Euclidean points and lines, which isometries preserve. So the solving in `o1`..`o7` and `real_roots` applies unchanged to coordinates in the folded plane.

What has to change:

1. **The validity region.**
   - Today every filter asks `Sheet` (a rectangle): `contains` (sheet.rs:78), `clip_parameters` (one interval, convex, sheet.rs:154-179) and `crosses` (sheet.rs:189).
   - O3's overlap test assumes one interval per line (PC:172-183).
   - The folded silhouette is a union of face polygons and is often non-convex. The filters need a `Paper` trait whose clip can return several intervals.
   - The solvers are private and take `&Sheet` (PC:157-445). Two options: make them generic over the trait, or expose an unfiltered `solve()` and let callers filter.
2. **"Aligns in-paper material" depends on which layers move.**
   - On a flat sheet either half can move. On a folded form, the moving input must lie on a face the layer selection moves, and its image must land on the target's material. That target is usually on a layer that stays still, or is visible across the silhouette.
   - So filtering happens after the fold operation picks its moving faces, which ties the axiom layer to the folding engine.
   - `who_moves` (predicates.rs:286-357) becomes "which input is on a moving face". It is no longer a guess about legibility.
3. **Visibility.** Precrease's `visible` means "on the sheet boundary" (predicates.rs:265-273). On a folded form, a reference can be sighted when it is on the silhouette or on the top layer as seen from the viewer's side. That needs the layer order.
4. **Extracting references.**
   - Stacked layers make many images coincide. Corners stack, and edges of different layers lie on top of each other.
   - References must be deduplicated within TOL, each carrying all its sources. `PointGrid` and `LineIndex` already do exactly this.
   - Input references must name crease-pattern provenance, meaning faces, vertices and edges, so a step's inputs survive later steps. The catch is that the CP kernel renumbers edges when it splits them.
5. **Extent of the result.** The constructed fold line ℓ lives in the folded plane. The crease it adds on each moving face is `T_f⁻¹(ℓ ∩ T_f(f))`, a segment per face rather than a chord across the sheet. Its mountain or valley follows from the operation and the face's orientation.
6. **A coordinate frame.** Precrease's unit frame is y-up with the long side 1, reflected relative to Oriedita's y-down model space (frame.rs:1-16). Fold should pick one frame on purpose; adopting precrease's lets it reuse `Line` and `TOL` directly.

## Reuse assessment

**Depend on directly.** All of these are pure Rust, MIT/Apache, with no planner state; precrease depends only on serde, serde_json and thiserror (Cargo.toml):
- `oristudio-precrease::line::{Line, LineIndex}`
- `tol::TOL`
- `pointgrid::PointGrid`
- `construct::{real_roots, line_residual, Construction, Root}`
- `direction::{Direction, Side}`

Before depending on `construct`, separate the solver from `Sheet`. Two ways to do it:
- Better: extract `line`, `tol`, `pointgrid` and the axiom solvers into a small shared crate that precrease and Fold both use. This keeps one implementation and one tolerance, and the RF cross-check harness keeps guarding it.
- Simpler: add a `Paper` trait inside precrease.

Either way it is a change to the precrease crate, so you need to decide on it (see open questions).

**Copy the idea:**
- `Ref` and `Witness` as a stored construction with `who_moves`, plus certify-to-nearest-root when recomputing;
- `Creased`: physical crease runs and pinches kept apart from geometric lines;
- `Extent` and the press idea;
- face-relative mountain/valley naming;
- twins and ways;
- the 20° conditioning floor for marks;
- the "no step without a certificate" rule.

**Reuse on the web side:**
- the arrow and arrowhead geometry, projector, pens and ink, and symbol layer;
- `foldPlayback`, `foldTransport` and `FoldPose`, extended per layer through the seams in precrease-fold-animation.md;
- the `PaperScene` painter;
- the Diagram workspace's `scene` picture and arrow annotations, through a new step source.

**Leave:**
- precrease's closure, candidates, stuck search, `order/*`, judge, quality, grid, planner, drive, the `Sequence`/`Step` wire format, and the exactness snap of input crease patterns;
- the Oriedita construction ops' maths (segments, destination-driven, no O2 or O6). Their step-by-step input flow (pick inputs, show candidate lines, choose a root) is still a good interaction reference.
- ReferenceFinder's C++ (GPL, legibility enforced, non-reentrant O6). Keep it as an oracle only.

## Open questions / risks

1. **Changing a crate you own.** Lifting the solver out of `Sheet`, whether by extracting a crate or adding a trait, changes `Construction::lines` and `certify`, which `predicates`, `candidates` and `closure` call. This needs your go-ahead, and the RF cross-check has to stay green.
2. **Where filtering happens.** The axioms' validity on a folded form depends on the layer selection. The API has to choose between "solve, then the fold operation filters" and "the solver asks the folded state". The first keeps the axioms pure.
3. **Non-convex silhouettes.** `Sheet::clip`, the O3 overlap test and the convex-outline assumption in `diagramToScene` all break. Rendering clips are probably fine (SVG clip paths take any polygon); the geometry filters are not.
4. **Stable reference identity.** Inputs stored by folded coordinates are fragile, and CP edge ids change when a fold splits faces. A provenance scheme is needed: face lineage plus CP vertex ids.
5. **Root identity under perturbation.** Precrease's `root` is just an enumeration index (sorted roots of s for O6, PC:399; sign order for O5). Recomputing after an upstream edit can swap roots. Store the resulting line too and pick the nearest root.
6. **Tolerance at scale.** Folded forms create heavy stacking of coincident vertices. The 1e-6 TOL agrees with the kernel, but snapping creases to existing vertices is required to avoid sliver faces in long sequences. This has not been measured.
7. **Mismatches between implementations.**
   - On O5 with the pivot on the landing line, precrease constructs it and RF refuses (refLineP2LC2P.cpp:34). This matters if RF is used as an oracle for Fold.
   - RF's O6 double-root branch has the `pow(R, 1/3)` NaN path.
8. **Licensing discipline.** Any fold axiom code must stay derived from the definitions (tier 2); transcribing RF code would make it GPL (lib.rs:43-58).
9. **Scope history.** A fold-through-layers planner, `treemaker-sequence`, was removed as "a folding-sequence research attempt that did not work out" (commit 9505e1600, PR #326). The References plan lists fold-through-layers and folded previews as out of scope (`reference-finder-integration.md:33-36`, 981-987). Fold is forward simulation, not inverse planning, but the plan should say why it will not repeat that attempt.
10. **Integrating with Diagram.** PR #436 is frozen at 31e1d6d84, and `DiagramStepSource`/`DiagramPicture` are closed unions. A `fold-step` source needs its own PR stacked on #436, and unknown sources lock the step (diagramDocument.ts:474-478).

Sources: [Lang, Huzita–Justin Axioms](https://langorigami.com/article/huzita-justin-axioms/) · [Alperin, A Mathematical Theory of Origami Numbers and Constructions (arXiv math/9912039)](https://arxiv.org/pdf/math/9912039) · [Alperin & Lang, One-, Two-, and Multi-Fold Origami Axioms (Origami 4 chapter)](https://www.taylorfrancis.com/books/9780429106613/chapters/10.1201/b10653-39) · [Huzita–Hatori axioms (Wikipedia)](https://www.wikipedia.com/wiki/Beloch_fold)
