# How to represent a flat folded state for the Fold workspace

Tags: **[V]** means I read it in code or in a primary source. **[I]** means it is my own reasoning or inference. Repo paths are relative to the worktree. I made no repo changes.

## Summary

- **Store the crease pattern, not the folded form, as the source of truth.** Each state should hold:
  - the CP vertices in sheet coordinates;
  - the CP edges, marked B, M, V, F (precrease) or J (join);
  - convex faces with stable lineage ids;
  - a pairwise layer order over overlapping faces, using FOLD `faceOrders` semantics.

  The folded coordinates (one isometry per face) and the per-cell stacks are derived from that, are cheap to rebuild each step, and are never edited directly [I].
- **The layer order has to be carried forward from step to step. It cannot be recomputed from the CP.**
  - A fully M/V-assigned CP can have several valid orders. The repo's `kabuto.fold` fixture is all B/M/V (16 B, 11 M, 9 V) and Flat-Folder finds **9** states for it (`crates/treemaker-flatfold/src/lib.rs:512-522`) [V].
  - A full re-solve also costs too much per step. Today a fold can take from milliseconds to minutes (`git show 31e1d6d84:implementation-plans/diagram-workspace.md`, l.67) [V].
- **For a simple fold, the new layer order follows from the old order, the fold line, the direction and the moving set alone.** This is stated formally by Akitaya–Demaine–Ku and by Ida–Takahashi, both cited below [V].
- **One engine covers simple and compound folds.** Each operation:
  1. computes the new CP geometry and M/V;
  2. copies the orders it leaves untouched;
  3. seeds the orders it fixes itself;
  4. hands the remaining unknown face pairs to the repo's Flat-Folder port, whose constraint propagation runs from seeded assignments.

  Zero solutions means the fold is invalid. One means it is determined. Several means the user has to choose (a tuck depth, an open sink versus a closed one) [I]. The hook already exists at `constraints.rs:105-118` and `:506-609` [V].
- **Numerics: stay on f64 and avoid accumulated error.** Every tool I checked uses f64 with an epsilon (details below). Concretely:
  - rebuild folded coordinates from the CP each step;
  - create each new CP vertex once per edge, as a parameter along that edge;
  - use one scale-relative tolerance with snapping;
  - store each step as a symbolic construction;
  - check the result after every step and refuse with a typed error rather than average away a disagreement.

  Exact rationals are possible for O1/O2/O4/O7 but stop working at O3, O5, O6 and at 22.5° designs. They are not worth adding in V0 [I].
- **FOLD has no standard for describing fold operations.** It has `file_classes: ["diagrams"]` and a frame tree (`frame_parent` / `frame_inherit`), and nothing for operations [V]. Export each step as a CP frame plus a `foldedForm` child that inherits from it, and put operation metadata under an `ori:` namespace [I].

## Representation options

Notation: n = faces, p = ply (maximum stack thickness), m = cells of the folded arrangement (Flat-Folder gives m = O(n²) for well-bounded CPs [V]), P_M = pairs involving moved faces, k = new overlaps.

| Representation | Who uses it | Split by fold line | Moving set | Order update | Cost per fold | Pros | Cons |
|---|---|---|---|---|---|---|---|
| **(a) CP + per-face isometry + pairwise orders** (FOLD `faceOrders`) | FOLD spec; Flat-Folder's variables are face pairs; Rabbit Ear `foldGraph` | Split each face whose folded image crosses ℓ. New vertices come from the CP edge parameter | Flood fill over face adjacency, never across hinge edges on ℓ, plus "faces above me on the moving side" | Copy unaffected pairs. M–M triples are unchanged (see Order determinism). Add M–N pairs for new overlaps. Drop pairs that no longer overlap | O(n) split, O(n + P_M) moving set, O(P_M + \|M\| log n + k) orders with an AABB index, O(n) geometry rebuild. Local validation scales with constraints touching M; full check is O(min{n²p, n² + mp²}) | FOLD-native; same variables as the Flat-Folder solver; can represent cyclic orders; carries history; no arrangement to keep robust | Point queries ("top k layers here") need a derived stack; up to O(n²) pairs |
| **(a′) global layer index per face** | Rabbit Ear's older `flatFold` (`faces_layer`, `foldFacesLayer`); Miyazaki 1996 per-plane "pile"; Kamigami | Same as (a) | Same as (a) | Re-rank: N kept in order, then M reversed on top | O(n log n) | Trivial update | Cannot represent cyclic orders (the FOLD spec notes a square twist has them) or interleavings with no global order |
| **(b) ordered stack per overlap cell** | Oripa / Orihime / Oriedita, after Mitani 08 (per the Flat-Folder paper); repo `FoldedPaperSubface.faces_top_to_bottom` (`crates/oristudio-cp/src/folding.rs:730-737`) | Overlay ℓ on the folded-edge arrangement | Cells on the moving side; same closure as (a) | Splice: reversed moving stack placed on the destination stack | O((m + k) log m) overlay plus O(mp) splicing | Direct picking and rendering; a tuck is a splice at depth d | The arrangement must be rebuilt every fold and becomes fragile with near-collinear stacked edges (why Flat-Folder searches for an epsilon); each face pair is stored once per cell, so consistency is redundant |
| **(c) abstract origami** (faces, adjacency, superposition = cover relation) | Ida & Takahashi, Eos | "Divide all faces in C by ray r" | M = RefTransR(D, adjacency not on r ∪ superposition) | Def. 11 rules, then transitive reduction | Transitive reduction O(n³) worst case, as they state | Minimal storage; proofs (the over relation stays acyclic and above is a strict partial order, Prop. 19/22) | Acyclicity is proved only for their operations, so twists break it; transitive-reduction cost |
| **(d) graph rewriting** | Ida & Takahashi JSC 2010 (labelled hypergraph rules); EPTCS 2021 cut-fold-glue programs | As (c) | As (c) | As (c) | As (c) plus rule matching; implemented in Mathematica | A compound fold is a small program over primitive operations | Formalism and runtime are not usable as-is |

Evidence for the table:

- **FOLD spec** [V]: [spec.md](https://github.com/edemaine/fold/blob/main/doc/spec.md).
- **Flat-Folder paper (Akitaya, Demaine, Ku, OSME 2024)** [V]: [paper](https://erikdemaine.org/papers/FlatFolder_OSME2024/paper.pdf).
  - Theorem 1: for convex faces, a facewise order is equivalent to the pointwise definition.
  - Theorem 2: verification in O(min{n²p, n² + mp²}).
  - The number of bits of precision needed to compute the folded geometry is an open problem ("sum-of-square-roots").
- **Ida & Takahashi, JSC 45(4) 2010** [V]: [preprint](https://tsukuba.repo.nii.ac.jp/record/19261/files/JSC_45-4.pdf). Def. 11, Algorithms 2 and 3, §7.3.
- **Ida & Takahashi, ADG 2021** [V]: [arXiv:2201.00536](https://arxiv.org/abs/2201.00536). Face n splits into 2n and 2n+1. `InsideReverseFold := CutEdge; MountainFold[..., InsertFace->below]; ValleyFold; GlueEdges`.
- **Miyazaki et al. 1996** [V]: [paper](https://www.cs.upc.edu/~robert/teaching/origami/literatura/miyazaki.pdf).
  - A binary "face-cell tree" records face division.
  - Moved faces are the connectivity closure plus faces overlapping on the rotating side.
  - "Folding up" reverses the moving faces and piles them on the rest.
  - "Tucking in" exists only in a symmetric form.
- **Rabbit Ear** (GPLv3 per its `license` file and `package.json`) [V]:
  - [`foldGraph.js`](https://github.com/rabbit-ear/rabbit-ear/blob/main/src/graph/fold/foldGraph.js) splits in folded space, then rebuilds CP vertices with `recalculatePointAlongEdge`.
  - [`general.js`](https://github.com/rabbit-ear/rabbit-ear/blob/main/src/graph/fold/general.js), `updateFaceOrders`, assigns the new order from the winding of b and M/V.
  - [`flatFold.js`](https://github.com/rabbit-ear/rabbit-ear/blob/main/src/graph/fold/flatFold.js), `foldFacesLayer`, implements (a′).
- **Kamigami** (MIT) [V]: [repo](https://github.com/jaygohel109/fold-origami). It was created on 2026-10-07, has 0 stars, and its README says it has no closed sinks and no collision checking. Treat it as an unvetted example.

**Rabbit Ear pitfall** [I]: `getInvalidFaceOrders` only revisits pairs that involve newly split faces (`general.js:164-195`). A moving face that is not split, landing on a stationary face it never overlapped before, therefore gets no triple, which FOLD reads as unknown. Our update must query new M–N overlaps explicitly.

**Why (a) and not (a′), even for V0.** For simple folds, (a′) is actually sufficient [I]. Proof sketch: suppose a global order L exists. After a valley fold, the order [N in L order, then M in reverse L order] is consistent with every overlapping pair:
- N–N pairs are unchanged;
- M–M pairs are reversed in global terms, consistently;
- M lies above N wherever they overlap after the fold, and pairs that overlapped before the fold no longer overlap, because M has left that side.

By induction, any sequence of simple folds has a linear order. Twist-type folds do not (FOLD names the square twist as cyclic [V]), and they are on the roadmap. So store (a), and compute the rank vector only as a speed-up when it exists.

## FOLD sequences

What the spec provides [V, spec.md §File Metadata, §Multiple Frames, §faceOrders]:
- `file_classes` includes `"animation"` (a continuous folding motion) and `"diagrams"` (folding steps).
- `file_frames[i]` is frame i+1; frame 0 is the top-level dictionary.
- `frame_parent` organises frames into a tree, and the parent is described as the frame this one modifies.
- `frame_inherit: true` inherits every property the frame does not override. The spec's example is changing `vertices_coords` while keeping the parent's mesh.
- Multi-frame support is optional; software that lacks it uses the key frame.
- `faceOrders [f, g, s]`: s = +1 means f lies on the side g's normal points to. A missing triple means unknown. Faces should overlap in one connected region, which convex faces guarantee; otherwise subdivide them with `"J"` edges, which are "present only for modeling purposes".
- `edgeOrders` makes sense only in 2D (linkages), so it does not apply here.

No standard exists for operations, arrows or step semantics [V]. FOLD issue [#5](https://github.com/edemaine/fold/issues/5), "Multiple frames in viewer", says frames are only flipped through for now. Rabbit Ear's [`flattenFrame`](https://github.com/rabbit-ear/rabbit-ear/blob/main/src/fold/frames.js) resolves inheritance as a shallow key override, so arrays are replaced whole [V]. The repo already round-trips a CP frame with a `foldedForm` child (`frame_parent`, `frame_inherit`, `faceOrders`, `oriedita:folded_view`) at `crates/treemaker-fold/src/lib.rs:908-953`, and `FoldDocument` carries the frame fields (`lib.rs:140-192`) [V]. Nothing in the repo resolves inheritance yet [V, grep].

Two ways to export [I]:
1. **Per-step pair (recommended).**
   - Each step writes a `creasePattern` frame with that step's full mesh. Inheriting from the previous step does not help, because every fold adds vertices and edges.
   - Next to it goes a `foldedForm` child with `frame_inherit: true` that overrides `vertices_coords` (the folded coordinates) and `faceOrders`.
   - The file gets `file_classes: ["singleModel", "diagrams"]`.
2. **Superset mesh (compact, export-only).**
   - Build every frame on the final CP's arrangement.
   - Edges not yet creased in a given frame are `"J"`, which matches the spec's "treat as a single face" semantics.
   - Precreases are `"F"`. Each frame overrides only `edges_assignment`, `edges_foldAngle`, `vertices_coords` and `faceOrders`.

Put step metadata in `ori:`-namespaced fields: the operation kind, the construction references, the layer selection, the step id, and the precrease direction, which `"F"` loses. Keep our own step log as the internal format and treat FOLD as an export format.

## Numerical robustness

**What existing tools do** [V]: all f64 with an epsilon, none exact.

| Tool | Tolerance |
|---|---|
| Oriedita | a table of epsilons, e.g. `POINT` = 2.5e-4 in its 400-unit space (`crates/oristudio-cp/src/geometry/epsilon.rs`) |
| Repo precrease planner | `TOL = 1e-6` of the sheet, derived from Oriedita's `POINT` (`crates/oristudio-precrease/src/tol.rs:17`) |
| Flat-Folder | tries eps = d/2^i and keeps the first value at which the vertex and edge counts stay stable over 3 halvings (`crates/treemaker-flatfold/src/conversion.rs:451-491`); its face BFS visits long edges first (`:204-219`) |
| Rabbit Ear | `EPSILON = 1e-6` |
| Origami Editor 3D | 1e-8 plane tests (`Origami.java`, GPLv3) |
| Eos | numeric coordinates under rotation, with symbolic reflection relations (JSC §7.4) |

**Recommendations:**

1. **Rebuild folded coordinates from the CP every step.** Use a face spanning tree, as `fold_graph.rs:341-404, 891-906` and `conversion.rs:112-232` already do [V]. Never fold the previous folded coordinates again. Error per face then grows with tree depth, not with the number of steps [I].
2. **Check vertex agreement instead of averaging.** Oriedita averages each vertex's image over its incident faces (`fold_graph.rs:314-334`) [V], which hides inconsistencies. Measure the residual instead and raise a typed error when it exceeds the tolerance [I].
3. **Create each new CP vertex once per edge.** Intersect the edge's folded image with ℓ to get a parameter t, then place the vertex by interpolating t along the CP edge. This is Rabbit Ear's `recalculatePointAlongEdge` [V]. Splitting per face would let the two faces sharing an edge disagree about where the new vertex is [I].
4. **One tolerance, applied by snapping the construction.**
   - Decide "vertex lies on ℓ", "edge is collinear with ℓ" and "ℓ passes through an existing vertex" with one scale-relative tolerance; reuse `TOL`.
   - When a construction lands within tolerance of an existing point or line, move the construction onto it, so later steps refer to existing points instead of new near-copies.
   - Exact predicates on rounded inputs would faithfully report the near-misses that origami's designed coincidences produce, and create slivers. Snapping, or exact constructions, is what fixes this [I].
   - The `robust` crate (MIT/Apache) is worth using only for the predicates in the derived arrangement.
5. **Store each step symbolically.** Record the axiom, references to stable points and lines, and which root of a multi-valued axiom was chosen. Cache the numeric line. Reuse the precrease constructors, including O6, which solves the cubic in closed form, polishes with Newton, and certifies the result (`crates/oristudio-precrease/src/construct.rs:25-48, 274-371`) [V].
6. **Exact arithmetic is not for V0** [I].

| Option | Covers | Cost / problem |
|---|---|---|
| Rationals (`num-rational`, MIT/Apache) | Reflection across a line with rational coefficients stays rational, so O1, O2, O4, O7 and the folds themselves are closed | Per-fold work is O(n), so the bignum slowdown is affordable. O3 and O5 need √ and O6 needs ∛, which break it |
| Q(√2) / Q(√3) | 22.5° and 15° designs | Already used for classification in `precrease/src/lattice.rs:88-112` [V] |
| General origami numbers | Everything; Alperin: [arXiv math/9912039](https://arxiv.org/abs/math/9912039) | The `algebraics` crate is LGPL-2.1+ [V, crates.io]; the degree of the numbers grows with each irrational step |
| Lazy exact (CGAL Epeck style) | Everything, with the step log as the expression DAG | CGAL's manual says exactness costs "execution time and storage space" ([manual](https://doc.cgal.org/latest/Kernel_23/index.html)) [V]. A later option |

7. **Validate after every step.** Check the isometry residual, Kawasaki and Maekawa at affected vertices, and the local order constraints. Refuse with a typed error, never return an approximation (porting discipline).

## Motion validity

**Simple folds.** Akitaya, Demaine and Ku formalise a simple fold of a flat folding f₁ with layer order λ₁ by a directed line ℓ and a folded region U ⊊ P. Seven conditions must hold [V, [JIP PDF](https://scripts.mit.edu/~jasonku/pdf/SIMPLEFOLDS_JIP.pdf) §2; [J-STAGE](https://www.jstage.jst.go.jp/article/ipsjjip/25/0/25_580/_article)]:
1. U's boundary lies on the paper boundary or on the preimage of ℓ.
2. Every point of U is reflected across ℓ.
3. The old creases are kept.
4. Points outside U do not change.
5. The order inside U is exactly reversed.
6. **Before the fold**, U lies entirely above, or entirely below, the points of paper outside U that it overlaps, on each side of ℓ.
7. The same holds in the result.

The paper also defines one-layer, some-layers and all-layers models, plus "infinite" variants. V0 is the some-layers model.

V0 check [I]:
- **Moving set.** Take the seed (for example, the top k layers at point p) and close it under adjacency across non-ℓ edges and under "above me on the moving side" for a valley fold ("below" for a mountain fold). This is Eos's rule and Miyazaki's rule [V].
- **Hinge edges.** An existing folded crease lying on ℓ has its two faces on the same side, so it is not a hinge. Flat (F/J) edges on ℓ that separate M from N become new M or V creases, as in Rabbit Ear's `reassignCollinearEdges`. An existing folded crease separating M from N would have to unfold; that is an Unfold operation, not a Fold.
- **Condition (6).** Every N face that overlaps an M face on the moving side must lie below it. This is O(P_M). If the user picks exact faces and (6) fails, refuse with a message naming the face that blocks.
- **Condition (7) and the hinge.** Build the end state by the deterministic rule below, then check the facewise constraints that involve M or the new creases. Taco-taco and taco-tortilla along ℓ catch a stationary flap wrapped around the hinge.

Because U stays in the open half-space above the plane except at ℓ, (6) plus a valid end state should be enough [I]; the paper says (6) and (7) "ensure the paper does not intersect itself" [V].

**Compound folds.**
- Tachi: "Sink folds and some reverse folds are not possible to be executed without unfolding all crease lines" in a rigid model ([4OSME](https://origami.c.u-tokyo.ac.jp/~tachi/cg/SimulationOfRigidOrigami_tachi_4OSME.pdf)) [V].
- Deciding rigid foldability is NP-hard ([arXiv:1812.01160](https://arxiv.org/abs/1812.01160)) [V, abstract].
- Any well-behaved folded state can be reached continuously from the flat sheet if the paper may bend ([CCCG 2004](https://erikdemaine.org/papers/PaperReachability_CCCG2004/)) [V, abstract only].
- Ida's cut-fold-glue programs pass through cut, non-physical intermediate states, so they compute a result without proving the motion is possible [I].

Proposed V1 policy [I]: a compound fold is valid when its operation-specific preconditions hold (for example, "the target is a flap whose spine crosses ℓ") and its end state passes the constraint check. A motion check applies only to steps that break down into simple folds, for example a tuck as open, fold, close.

## Order determinism

- **Determined (simple fold with moving set M).**
  - Inside M, the order reverses. Inside N, nothing changes. Where M and N overlap after the fold, M lies above N for a valley fold and below for a mountain fold. This is Ida's Def. 11, cases 2.1 and 2.2, and Akitaya's conditions (5) to (7) [V].
  - In FOLD encoding, **M–M triples need no update** [I]: s is measured against g's normal, and the 180° rotation carries g's normal along with both faces.
  - Two halves of a split face get `[f₁, f₂, ±1]` from the new crease's M/V and the faces' winding, as Rabbit Ear does [V]. Descendants of a split face inherit their parent's pairs wherever they still overlap.
- **Determined given a parameter** [I]:
  - "Top k layers at p": determined once k is chosen.
  - Fold-and-unfold (precrease): the order does not change. Record the precrease direction.
  - Unfold of the last fold: determined.
- **Genuine user choice** [I]:
  - **Tuck or insert at a depth.** Ida's `InsertFace` and Miyazaki's "tucking in" are the precedents [V]. The valid choices are the depths at which no crease would cross another.
  - **Which layers of a multi-layer flap a reverse fold takes.**
  - **Open versus closed sink.** The same lines, but different assignments and orders.
  - **Which pocket a squash opens.**
  - **Which side moves**, and the direction.
- **General mechanism** [I]:
  1. Copy the orders of unaffected pairs.
  2. Seed the pairs the operation fixes.
  3. Mark the remaining affected pairs unknown.
  4. Run the Flat-Folder propagation and component solve, seeded through `initial_assignments` / `propagate_initial_assignments` (`crates/treemaker-flatfold/src/constraints.rs:105-118, 506-609`) [V].

  This needs a new entry point that accepts seeded face-pair orders. Today the solver builds from a whole document and refuses a custom `starting_face` (`lib.rs:166-170`) [V].

## Recommendation

1. **New MIT/Apache crate**, for example `oristudio-fold`, depending on `treemaker-fold` and `treemaker-flatfold`.
   - Borrow ideas only from Rabbit Ear and Origami Editor 3D; both are GPLv3 [V].
   - Flat-Folder and FOLD are MIT [V].
2. **`FoldState`:**
   - CP vertices in sheet coordinates;
   - edges with kind B / M / V / F (precrease, with its direction) / J, and the step that created each;
   - convex faces with lineage ids. Splitting by lines keeps faces convex, so Theorem 1 applies [I];
   - `PairOrders` over overlapping pairs only, in FOLD semantics;
   - derived and rebuilt each step: face isometries and flip flags, folded vertices, an overlap index, and lazy cell stacks emitted as a `FoldedPaperScene`-like structure (`folding.rs:669-737`) for the Diagram painter.
3. **`Step`:**
   - an `Operation` enum: `Crease(axiom construction)`, `Fold{line, side, dir, selection}`, `Unfold`, and later `ReverseFold`, `Sink`, `Squash`, …;
   - the user's choices;
   - a cached result with a fingerprint.

   Each compound operation is a function that produces new CP geometry and M/V, plus seeded orders, and then runs the shared local solve. Ida's programs are the template.
4. **Pipeline per fold:**
   1. snap the construction;
   2. compute the moving set;
   3. split the crossed edges once each, by parameter;
   4. assign the new creases;
   5. rebuild the isometries;
   6. update the orders (copy, flip rule, new overlaps through the index);
   7. check constraints locally;
   8. check residuals.
5. **Tests.** Fold sequences such as the waterbomb base and the bird base, compared step by step against `solve_flat_fold` on the final CP. The final order must be one of Flat-Folder's solutions.

## Open questions / risks

- **Cost of the local solve.** `treemaker-flatfold` builds the overlap graph and constraints for the whole document. Extracting a sub-document for the affected region is new work, and the Flat-Folder epsilon search is a precision-failure risk on stacks that have been folded many times [I].
- **Hinge-wrap sufficiency.** I argued, but did not prove, that condition (6) plus a valid end state rules out every collision for a simple fold. Tests are needed with flaps wrapped around ℓ [I].
- **Selection semantics.** "Top k layers" plus closure can quietly grow M across the model. The UI needs to preview M; that is a product decision.
- **Stable ids versus the Diagram plan's "links are geometric".** Lineage ids are stable only inside one Fold document. A step that is edited and replayed can renumber everything downstream; it needs re-anchoring by fingerprint [I].
- **Precision ceiling.** f64 plus snapping can still mis-identify coincidences in deep O6 or irrational sequences. The literature says outright that the number of precision bits needed is unknown [V].
- **Compound-fold catalogue.** Preconditions and order seeds for spread squash, petal, swivel and closed sink are unspecified. A closed sink may have no end state that a user would recognise without explicit seeding [I].
- **FOLD interop.** No external tool understands step semantics, and frame inheritance is optional, so an export may appear as a bare key frame in other software [V].
