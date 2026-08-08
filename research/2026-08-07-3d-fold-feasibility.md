# A 3D analogue of Oriedita's Fold — feasibility

**Date:** 2026-08-07
**Question:** Oriedita's **Fold** command takes a flat-foldable 2D crease
pattern and computes its folded form — the 2D silhouette plus a **layer
ordering** of the stacked facets. Can we do the same for a "3D pattern": press
Fold on a crease pattern that does not fold flat and get back a rendered 3D
model *with* layer ordering, **computed rather than physically simulated**?

**Verdict:** **Yes, under stated preconditions — and the ordering half is the
part that is already mostly built.** Given per-crease fold angles, 3D placement
is *determined* (a linear-time BFS over the dual graph, no solver, no search),
and layer-ordering variables live only on coplanar-overlapping faces, so
Oriedita's existing permutation search runs on them essentially verbatim. Three
things bound the feature, and only one of them is an algorithm problem:

1. **The fold angles are not in the crease pattern**, and for the dominant class
   of real files they are not recoverable *even in principle*. This is the hard
   ceiling; §1c.
2. **The folded state is well-defined iff `loop_gap < dist_tol < min plane
   separation`** — a computable side condition with 4–6 measured decades of
   headroom, not the ill-posedness a previous pass concluded. §2c.
3. On a **simply-connected** sheet the global consistency check the whole design
   was being built around is an *algebraic consequence* of the per-vertex check
   the repo already ships. It only earns its keep on **multiply-connected**
   paper — where it is the *only* thing that works. §2b.

The cheapest useful increment is not "a 3D folder." It is **correct coplanar
ordering for the SVG exporter that already ships**, whose single documented
limitation is exactly this (§3d) — and which needs no fold angles at all.

> Confidence discipline as in the 2026-07-05 report: every headline is a
> measurement from a named artifact or a `file:line` read. Derivations are
> labelled **[derived]**; things I could not check are labelled
> **[unverified]**. §7 lists what was *not* established. §5 lists claims this
> session **refuted**, including several the investigation initially asserted.
>
> Numbered spikes (`gap_topology2.py`, `judge_tol.py`, `fold3d.py`,
> `run_sweep.py`, `gap_leastsq2.py`) were throwaway NumPy scripts in a session
> scratchpad, named here for the record rather than committed. The one
> reproducible-from-the-repo measurement is §4.2, which is
> `./target/release/treemaker flatfold tests/fixtures/flat-folder/kabuto.fold
> --format json`.
>
> **§8, "Corrections since publication", was added after the Phase 0 spikes ran.**
> The body below is left as published. Read §8 before relying on §1b, §2b, §2c,
> §3a, §4.1 or §5.2, and read
> [`implementation-plans/3d-folded-state.md`](../implementation-plans/3d-folded-state.md)
> — the live document — before building anything.

---

## TL;DR

1. **Placement from angles is determined and cheap.** Walk the dual-graph
   spanning tree the flat folder already builds
   ([`face_positions`](crates/oristudio-cp/src/fold_graph.rs#L126)) and compose a
   rigid rotation per crease instead of the 2D mirror at
   [`fold_graph.rs:389`](crates/oristudio-cp/src/fold_graph.rs#L389). Linear
   time, no solver. **[derived, and independently implemented by prior art —
   §3e]**
2. **The layer-ordering engine is already geometry-free and already public.**
   [`possible_overlap_search_for_subfaces`](crates/oristudio-cp/src/folding/permutation.rs#L260)
   takes `&[SubFace]`, an `InitialHierarchy` of index pairs and
   `EquivalenceCondition{a,b,c,d}` — **no `Point`, no polygon, no plane**. It can
   be called on one coplanar cluster today with zero changes to `oristudio-cp`.
   **[measured — read the signature and the types]**
3. **Exactly one stage of the port is flat-only in *substance* rather than
   merely 2D:**
   [`initial_hierarchy_from_graph`](crates/oristudio-cp/src/folding.rs#L3985)
   aborts when adjacent faces share BFS-depth parity and reads above/below from
   `LineColor::Red1` — both encode "every crease is a 180° flip." It must be
   replaced, not generalised. Everything else is 2D by signature only.
4. **The "the answer isn't determined" scare is a tolerance artefact, not
   ill-posedness.** Sweeping the coplanarity tolerance rather than fixing it:
   every unstable and every wrong cell sits **strictly below the measured loop
   gap**; above it, all 16 BFS roots agree with ground truth at per-crease errors
   up to 100× the shipped bar. Headroom 4–6 decades. §2c. **[measured,
   `judge_tol.py`]**
5. **On a disk, the global loop check is redundant.** Driving fold angles onto
   *per-vertex closure only*, the worst non-tree loop gap falls to **0–3e-8 rad**
   in 11 of 12 trials (the 12th is the trial where the solver did not converge).
   The repo already says so —
   [`non-180-fold-angles.md:666`](implementation-plans/non-180-fold-angles.md#L666).
   §2b. **[measured, `gap_topology2.py` T1]**
6. **On an annulus it is the only thing that works.** A paper ring has **zero
   interior vertices**, so per-vertex closure passes *vacuously for any angles* —
   [`checks_spatial`](crates/oristudio-cp/src/checks_spatial.rs#L175) reports
   clean while the measured loop gap reaches **2.891 rad (166°)**. §2b.
   **[measured, T2]**
7. **A cyclic panel order is legal**, and two proposed designs would have
   rejected it. He & Guest name the classical **square twist**, with panel order
   `a > b > c > d > a`. Any "assert the order is acyclic before rendering" gate
   is wrong, and a topological sort of `faceOrders` is not always defined. §5.4.
   **[measured — verbatim quote, `rigid_origami_I.txt:405`]**
8. **Real models do not decompose.** First measurement on a named traditional
   model (Kabuto, flat): **117 ordering variables in components `[81, 18, 18]`**
   — the largest is **69%** of all variables — and **transitivity is 420 of 529
   constraints (79%)**. Any cost argument resting on small independent clusters
   should be re-checked against this. §4.2. **[measured,
   `treemaker flatfold`]**
9. **The inputs do not exist.** Of nine ingress paths, three carry fold angles
   and all three are Ori Studio's own. Exactly **2 of 33 tracked `.fold` files**
   carry a non-classic angle, and **both are hand-authored fixtures for the
   fold-angle feature itself**. §1c. **[measured]**

---

## 1. What is determined by the crease pattern, and what is not

This is the section that bounds the whole feature, so it comes first.

### 1a. Determined: the 3D placement, given fold angles

A crease pattern plus a fold angle on every crease determines the position of
every facet, up to a global rigid motion. Root the dual graph anywhere, walk the
spanning tree, and compose one rotation of `π − ρ` about each crease axis taken
in *unfolded* paper coordinates. No optimisation, no search, no iteration.

The repo already builds that spanning tree
([`face_positions`](crates/oristudio-cp/src/fold_graph.rs#L126)) and already
walks it ([`fold_movement`](crates/oristudio-cp/src/fold_graph.rs#L381)). The
single line that is flat is `find_line_symmetry_point` at `:389`, a 2D mirror.
Swap in a rotation and the loop structure is correct 3D placement.

Two things that swap is *not*:

- **A mirror is direction-agnostic and involutive; a rotation needs a signed
  angle.** The magnitude lives on `LineSegment.fold_magnitude`, not on
  `GraphLine` ([`fold_graph.rs:8`](crates/oristudio-cp/src/fold_graph.rs#L8) is
  begin/end/color only), and the traversal sign has to be derived from which side
  of the crease the child face lies on. **[measured — read both types]**
- **Do not reuse the vertex averaging** at
  [`fold_graph.rs:104`](crates/oristudio-cp/src/fold_graph.rs#L104), which sets a
  folded vertex to the mean of its images across incident faces (verbatim from
  Oriedita `WireFrame_Worker.java:101-109`). In 2D a mirror maps the plane to
  itself unconditionally, so residual stays in-plane and is re-absorbed when the
  arrangement is rebuilt at
  [`folding.rs:1307`](crates/oristudio-cp/src/folding.rs#L1307). In 3D the same
  residual becomes *out-of-plane displacement*, and averaging is precisely the
  operation that destroys the evidence of the violation. **[derived]**

### 1b. Determined: where layer ordering is even *defined*

Layer order is only defined where paper coincides with paper. For a
piecewise-linear folded state, any 2-dimensional coincidence region must be
coplanar — two distinct planes meet in a line, which has zero area. So the
ordering **variables** are exactly the coplanar-overlap regions, and they
partition by plane.

This is the structural reason the 3D problem is *smaller* than the flat one per
instance: a flat folding is the degenerate case where **one** cluster contains
every face. Measured on synthetic families: a 24-facet accordion at ±180 gives
one cluster of 24 and 253–276 ordering pairs; the same pattern at ±90/±135/±170
gives **24 singleton clusters and 0 ordering pairs**. A Miura 4×4 gives largest
cluster 2–3 and 0 ordering pairs. **[measured, `fold3d.py`]**

**But the variables partitioning does not make the problem partition** — see
§5.1, which is one of this session's refutations.

### 1c. **Not** determined, even in principle: the fold angles themselves

This is the ceiling on the feature and it should be stated without hedging.

**Nine ingress paths; three carry angles, all three ours.** **[measured]**

| Ingress | Carries a fold angle? | Evidence |
| --- | --- | --- |
| `.cp` | **No** — exactly 5 tokens/line, 4 assignment codes | [`io/cp.rs:17`](crates/oristudio-cp/src/io/cp.rs#L17); 563 scraped files, **329,254 lines, zero exceptions** |
| `.ori` / `.orh` / `.dxf` / `.obj` | **No** | [`io/ori.rs:303`](crates/oristudio-cp/src/io/ori.rs#L303) writes 7 fields, no magnitude |
| TreeMaker output | **No** — ±180 manufactured from assignment | [`treemaker-core/src/lib.rs:1205`](crates/treemaker-core/src/lib.rs#L1205) |
| Box Pleating Studio | **No** | no `fold_magnitude` anywhere in `oristudio-bp` |
| CP detection | **No** — assignment head only | [`cp-detect/src/lib.rs:114`](crates/oristudio-cp-detect/src/lib.rs#L114) |
| FOLD import / `.osf` / share link | **Yes** | [`io/fold.rs:162`](crates/oristudio-cp/src/io/fold.rs#L162), [`share/v1.rs:638`](crates/oristudio-cp/src/share/v1.rs#L638) |

**Inside the repo it is barely better.** Of 33 tracked `.fold` files, exactly **2**
carry a non-classic angle, and both are fixtures written for the fold-angle
feature: `tests/fixtures/fold-angle/valid-waterbomb-vertex.fold` and
`self-intersecting-vertex.fold`. **[measured — scanned every tracked `.fold`]**

**And for the dominant class, the 3D form is not a function of the crease
pattern at all.** A 563-file corpus of real scraped patterns is 99.9%
Kawasaki-satisfying at 128,067 interior vertices, and 659 of 660 filenames name
animals and characters. Lang states the consequence directly:

> representational origami rarely shows every crease in the finished form …
> there can also be quite substantial manipulations of the base that are **not
> reflected in the crease pattern**
> — *Crease Patterns for Folders*, langorigami.com

That is not a hard problem. It is an **ill-posed** one: the target is not a
function of the input, so no algorithm recovers it, and the flat Fold already
gives the only computable answer for those files — the flat base.

**Two corrections to how that measurement was originally framed** (§5.5): the
corpus is real *topology and design vocabulary* but not real *coordinates* below
~1e-4°, and Kawasaki-passing does not distinguish flat-intent from 3D-intent
(every canonical 3D tessellation scores 100%). And the corpus measures **import**,
whereas the fold-angle feature's own stated primary workflow is **transcription**
— "the user folds a model by hand, then draws the crease pattern for it. They
already know the angles"
([`non-180-fold-angles.md:264`](implementation-plans/non-180-fold-angles.md#L264)).
A number derived entirely from downloaded files cannot bound a workflow whose
primary path is typing.

### 1d. Not determined without extra data: the orientation of each layer stack

FOLD `faceOrders` `[f, g, s]` is signed **relative to `g`'s normal**, and two
layers joined across a 180° crease have opposite paper normals. He & Guest make
the general statement: for a non-orientable folded surface you divide it into
orientable pieces and assign a unified orientation, and

> The information of how `g(M)` is divided into orientable pieces **should be
> included in the description of the order function.**
> — *On Rigid Origami I*, Definition 3

So the orientation is **data the result must carry**, not something each plane
can derive locally. Flat folding never had to define this: a single plane fixes
+z globally. **[measured — verbatim from `rigid_origami_I.txt:88-110`]**

---

## 2. Preconditions

A 3D Fold is feasible under exactly these, and each is checkable.

### 2a. Fold angles present, and a connected face graph

Angles are already shipped: `FoldMagnitude` is a `u32` at 1e-7° resolution on
`LineSegment` ([`geometry/line_segment.rs:61`](crates/oristudio-cp/src/geometry/line_segment.rs#L61)),
persisted through `.osf` and share links
([`share/v1.rs:638`](crates/oristudio-cp/src/share/v1.rs#L638)). The flat folder
**never reads them**: `grep -c fold_magnitude` over `folding.rs` and
`fold_graph.rs` returns 0 and 0. The only assignment signal it uses is
`line.color == LineColor::Red1`. **[measured]**

Connectivity is an unstated precondition of the *existing* pipeline, and our port
diverges from upstream on it. Oriedita hangs on a disconnected face graph
(`while (remaining_facesTotal > 0)` with an empty frontier); our port breaks out
at [`fold_graph.rs:164`](crates/oristudio-cp/src/fold_graph.rs#L164), leaving
unreached faces at position 0 with `associated_line: None`, so `fold_movement`
returns the **unfolded** point. In 2D the parity gate may catch it by luck; in 3D
it is a silent wrong answer. This should become a typed error regardless of
whether a 3D fold ships. **[measured]**

### 2b. Simply-connected paper — or an explicit loop check

This is the precondition nobody in the investigation asked about, and the repo
already answers it:

> Local vertex closure is sufficient for a consistent folded state **on a
> simply-connected sheet**
> — [`non-180-fold-angles.md:666`](implementation-plans/non-180-fold-angles.md#L666)

with the matching risk note at `:870` ("the local-implies-global result for
simply-connected sheets is the justification") and the matching **unchecked**
Phase 8 item at `:854`: *"Loop checks for non-simply-connected patterns."*

**T1 — measured.** Jittered quad-grid disks; fold angles driven by Gauss-Newton
onto *per-vertex closure only* (the residual function never mentions a non-tree
edge). 11 of 12 trials converged, and in all 11 the worst non-tree loop gap fell
to **0 to 2.98e-8 rad** — the solver's own finite-difference floor. The single
O(1) row (`disk 4×4 seed1`, loop gap 7.8e-2) is exactly the row where GN failed
to converge (`|r| = 1.8e-1`). Structurally, #independent dual loops == #interior
vertices in every case. **[measured, `gap_topology2.py`]**

So on a disk the loop gap is an **algebraic consequence** of the check
[`checks_spatial.rs:175`](crates/oristudio-cp/src/checks_spatial.rs#L175)
already ships — not an independent condition.

**T2 — measured, and this is the counterexample class nobody named.** A square
paper **ring** (annulus, 4 radial creases) has **zero interior vertices**, so
per-vertex closure is satisfied *vacuously for any angles*: `checks_spatial`
reports 0.000e+00 and every proposed admission gate passes.

| ring fold angles | worst vertex closure | worst loop gap |
| --- | --- | --- |
| (90, 90, 90, 90) | 0.000e+00 | **2.094 rad** |
| (120, −120, 120, −120) | 0.000e+00 | **2.891 rad (166°)** |
| (30, −30, 30, −30) | 0.000e+00 | 2.681e-01 |
| (180, 180, 180, 180) | 0.000e+00 | 4.215e-08 |

The all-180 row is the control: the pattern is fine, the *angles* are what fail.
So the loop check is redundant on the dominant case and load-bearing on the case
Phase 8 already has open. **[measured, `gap_topology2.py` T2]**

**[unverified]** Whether a user can actually draw an annulus in the Ori Studio
UI. If they cannot, T2 is a correctness argument rather than a live bug.

### 2c. `loop_gap < dist_tol < min plane separation`

A previous pass concluded the folded state "is not well-defined at the shipped
1e-6° bar," measuring 3–4 distinct cluster/ordering answers across 16 BFS roots
on a Miura 4×4. Re-running that experiment while **sweeping** the coplanarity
tolerance rather than fixing it at 1e-6 changes the reading completely:

```
 eps(deg)   loop gap |   1e-8    1e-7    1e-6    1e-5    1e-4    1e-3    1e-2
    0e+00   1.87e-13 |   1/12    1/12    1/12    1/12    1/12    1/12    1/12
    1e-07   1.99e-06 |   1/0  *  3/0  *  2/12 *  1/12    1/12    1/12    1/12
    1e-06   1.69e-05 |   1/0  *  1/0  *  4/0  *  2/12 *  1/12    1/12    1/12
    1e-05   1.26e-04 |   1/0  *  1/0  *  1/0  *  2/0  *  1/12 *  1/12    1/12
    1e-04   1.16e-03 |   1/0  *  1/0  *  1/0  *  1/0  *  2/0  *  2/10 *  1/12
```

cell = distinct answers over 16 roots / ordering pairs in the modal answer;
`*` = `dist_tol` is **below** the measured loop gap. Ground truth at exact
closure is 8 clusters `(3,3,3,3,1,1,1,1)` and 12 ordering pairs.

**Every instability and every wrong answer in that table is starred. Not one
exception.** Above the loop gap all 16 roots agree, and agree with ground truth,
at per-crease errors up to 100× the shipped bar. **[measured, `judge_tol.py`]**

So the correct statement is a **computable side condition**, not
ill-posedness: the folded state's combinatorial structure is well-defined iff
`loop_gap < dist_tol < min genuine plane separation`, and `loop_gap` is one
linear-time pass over the non-tree dual edges. Measured window on Miura 4×4 and
6×6 at 20/60/150°: ratio **7.1e3 to 3.5e6**, i.e. **4–6 decades of headroom**.

The window closes exactly where separation → 0, i.e. near 180°, since separation
is `L·sin(180−ρ)`. That is the regime a **flat snap** eliminates by construction:
a 180° rotation about a line in a plane maps that plane to itself *exactly*.
Snapping is not an optimisation — the constraint *type* is discontinuous there
(unary wall-forcing below 180°, binary taco-tortilla at 180°), so an unsnapped
near-flat crease would make the 3D command disagree with the shipped 2D Fold on
a nominally flat document.

**[unverified]** The window measurement is on generic 3D folds with cluster size
≤ 3. On the real population — a flat base shaped in 3D — the window's *upper*
bound is the separation between distinct flat stacks, which I did not measure and
which could be far tighter.

---

## 3. What is already built

### 3a. The whole combinatorial engine, and it is plane-agnostic

| Piece | Status | Where |
| --- | --- | --- |
| Permutation search over per-SubFace stackings | **Public, geometry-free** | [`permutation.rs:260`](crates/oristudio-cp/src/folding/permutation.rs#L260) |
| Italiano dynamic transitive closure | **Done** (private) | [`folding.rs:4432`](crates/oristudio-cp/src/folding.rs#L4432), `folding/additional_estimation.rs` |
| Triple (taco-tortilla) / quadruple (taco-taco) conditions | **Done**, 2D predicates | [`folding.rs:4034`](crates/oristudio-cp/src/folding.rs#L4034) |
| Arrangement + SubFace decomposition | **Done**, 2D signature | [`folding.rs:1388`](crates/oristudio-cp/src/folding.rs#L1388) |
| Dual-graph spanning tree | **Done** | [`fold_graph.rs:126`](crates/oristudio-cp/src/fold_graph.rs#L126) |
| Per-vertex 3D closure (quaternion) + DOF | **Done, shipped** | [`checks_spatial.rs:175`](crates/oristudio-cp/src/checks_spatial.rs#L175), `:566` |
| Per-crease fold angles | **Done, shipped** | [`line_segment.rs:61`](crates/oristudio-cp/src/geometry/line_segment.rs#L61) |
| FOLD 3D coords + spec-key `faceOrders` | **Done, tested** | [`treemaker-fold/src/lib.rs:166`](crates/treemaker-fold/src/lib.rs#L166), `:184` |
| Flat-Folder port (taco/tortilla/transitivity) | **Done**, flat-only entry | `crates/treemaker-flatfold/` |
| Per-cluster **3D** hierarchy seeding | **Missing** | — |
| Global 3D placement | **Missing** | — |

The top row is the load-bearing one. The search takes `&[SubFace{face_ids}]`, an
`InitialHierarchy` of `(upper_face, lower_face)` index pairs, and
`EquivalenceCondition{a,b,c,d}` — every field `pub`, every type pure indices, no
`Point` anywhere. **It could be invoked on one coplanar cluster's faces today.**
**[measured — read the signature and all three types]**

**Two seams to respect.** (i) The conditions are **role-typed**, not index sets:
a triple is *(crossing face; the two faces of one crease, ordered by the initial
hierarchy)*, a quadruple is *(crease 1's two faces; crease 2's two faces)*, and
permuting the roles silently changes the verdict rather than erroring. (ii)
`set_guide_map` rebuilds an `O(faces_total²)` dense table **per subface**
([`folding.rs:4322`](crates/oristudio-cp/src/folding.rs#L4322)), so a per-cluster
caller must renumber face ids **locally** or the decomposition's entire
performance argument inverts.

### 3b. What must be replaced, not generalised

Exactly one stage. `initial_hierarchy_from_graph`
([`folding.rs:3985`](crates/oristudio-cp/src/folding.rs#L3985)) returns
`SameParityAdjacentFaces` when two faces across a crease share BFS-depth parity,
then reads above/below as:

```rust
let first_same_orientation = first_position % 2 == 1;
let first_above_second = if line.color == LineColor::Red1 { … } else { … };
```

Both encode "every crease is a 180° flip." The parity abort is Maekawa's
even-degree corollary — correct in the flat regime, meaningless in 3D — and it
disappears together with the parity seed it belongs to. The replacement is the
sign of each face's transported normal against the cluster normal, plus M/V for
in-plane 180° creases. **[measured]**

### 3c. `treemaker-flatfold` is **not** reusable per cluster as it stands

Its only public entries (`analyze_flat_fold`, `solve_flat_fold`,
[`lib.rs:149`](crates/treemaker-flatfold/src/lib.rs#L149)) recompute the folded
projection themselves from CP coordinates, and `normalize_document` explicitly
does `normalized.edges_fold_angle.clear()`
([`conversion.rs:101`](crates/treemaker-flatfold/src/conversion.rs#L101)).
`build_constraint_state` is `pub(crate)` and `Point = [f64; 2]`. Worse, its
choice table assumes **both** faces of an overlapped edge lie in the plane — a
3D "wall" edge has 2 faces but only 1 in-plane, so `check_overlap` returns 0 for
the other and the table falls through to a *wrong* constraint rather than
skipping. It needs a new entry point taking pre-projected cluster faces plus an
in-plane flag. **[measured]**

### 3d. The renderer and exporter — including the product justification

The 3D viewer already exists (`packages/origami-simulator`), already renders
`foldedForm` FOLD, and already parses `faceOrders` into its geometry type
([`geometry.ts:98`](packages/origami-simulator/src/geometry.ts#L98)) — and then
ignores it.

More importantly, **the feature's own product justification is already written
down and already shipped minus this one piece.** The SVG exporter
([`svgRenderer.ts`](packages/origami-simulator/src/svgRenderer.ts), wired at
[`simulatorSession.ts:834`](apps/web/src/simulator/simulatorSession.ts#L834))
exists because of a user request:

> take all the rendered polygons, apply a projection matrix based on the camera
> angle, and estimate the z ordering based on projection distance from the
> camera. **This would be a huge deal for diagramming 3d steps.**
> — `oristudio feedback.pdf`, quoted at
> [`simulator-view-svg-export.md:12`](implementation-plans/simulator-view-svg-export.md#L12)

and its declared non-goal is *"layer-order correctness beyond a depth sort (that
is Flat-Folder's job)"* (`:22`). `svgRenderer.ts:6` calls the painter's sort
*"the one real difference and the one documented limitation."*

**That limitation is exactly what a 3D layer ordering supplies.** And critically,
`buildBsp`'s `sortCoplanar` is a stable sort on `kind` only
([`bsp.ts:277`](packages/origami-simulator/src/bsp.ts#L277)), so exactly-coplanar
faces emit in **caller input order** — meaning a correct ordering makes the
exporter correct *by construction*, at the cost of one sort. Measured: 0
inversions in 4560 ordered pairs at 96 stacked layers when input is in layer
order. **[measured]**

Two live defects in the same area, worth fixing independent of this question:
the current caller feeds faces in **mesh-index order**, which misorders coplanar
stacks whenever the solver converges tighter than the BSP's ~3e-7 floor (reachable
today at the shipped crease-stiffness slider maximum); and
[`foldedExport.ts:76`](apps/web/src/lib/foldedExport.ts#L76) writes a `foldedForm`
frame and then `delete folded.face_orders`.

### 3e. Prior art: it exists, it is unpublished, and it is not an oracle

Robby Kraft's **Rabbit Ear** ships `layer3D` (npm 0.9.4, GPL-3.0). It does
exactly the architecture above: BFS rigid transforms → coplanar-overlap clusters
→ flat solver per cluster → FOLD `faceOrders`. Measured on Mooser's Train (484
faces, 10 distinct fold angles): **224 ms, 1721 faceOrders**. That is strong
evidence the architecture works and scales.

It is **not** a correctness oracle, and I verified the defect in the shipped
source. In `constraints3D.js`, non-flat edges are `delete`d from `clusters_graph`
(lines 54–62) *before* `getOverlapFacesWith3DEdge` reads that same graph (line
83) to find the edge-vs-face "wall" constraints. The precise scope matters:
`constraints3DEdges` runs **before** the mutation, so the edge–edge 3D
constraints are fine; it is specifically the **wall** class that always returns
empty. Measured by the investigation: 677 constraints found pre-deletion, **0**
post, on Mooser's Train. **[measured — read `/tmp/renpm/package/module/layer/constraints3D.js`
and `constraints3DEdges.js:15-27`]**

Licensing: GPL-3.0 is compatible with the product whole (GPL-2.0-**or-later**,
`NOTICE:4-7`, TreeMaker's own notice confirms "or any later version"), but **not**
with `oristudio-cp`, `treemaker-flatfold` or `packages/origami-simulator`, which
are deliberately MIT/Apache. The constraint is architectural, not legal.

---

## 4. What is genuinely hard, ranked

### 4.1 The input supply — hardest, and not an algorithm problem

Ranked first because it decides whether any of the rest is worth building. §1c.
The mitigation is a measurement, not code: **the punt branch already exists** at
[`creasePatternSlice.ts:1615`](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts#L1615)
and is purely syntactic ("does any selected crease carry a non-180 angle …
needs no solver and no topology"). One analytics event there buys the number
nobody has.

Note also that the repo **already ships two fold-angle solvers** the provenance
analysis missed by looking only at file formats:
[`solve_spatial.rs`](crates/oristudio-cp/src/solve_spatial.rs) (unknown-crease
insertion, the Foldable Line tool) and
[`solve_fold_angles.rs`](crates/oristudio-cp/src/solve_fold_angles.rs) with
`apps/web/src/cp-workspace/foldAngleSolve/`. Its plan reports it answers on
25–38% of freely-angled vertices where the flat tool finds nothing. So
"inference is a dead end" was overstated — locally, assisted angle determination
already works.

### 4.2 Constraint components do not decompose by plane, and are large

Two independent results.

**Cross-plane coupling.** Two creases whose folded images coincide couple an
ordering variable in plane P to one in plane Q. Measured counterexample: a 1×4
strip at (−90, +180, +90) — "fold in half, then bend the doubled stack 90°",
the most ordinary move in origami — yields 4 per-cluster order combinations of
which only **2** admit an embedded thickened realisation, stable across layer
thickness 0.2 → 0.001. Per-cluster solving would return a definite answer and be
wrong half the time, silently. §5.1.

**Component size on a real model.** First such measurement, on traditional
**Kabuto** (`tests/fixtures/flat-folder/kabuto.fold`, 18 faces, flat), via the
repo's own solver:

| | |
| --- | --- |
| ordering variables | 117 |
| **constraint components** | **[81, 18, 18]** — largest is **69%** of all variables |
| taco-taco / taco-tortilla / tortilla-tortilla | 21 / 88 / 0 |
| **transitivity** | **420 of 529 constraints (79%)** |
| solution counts per component | [1, 3, 3] → 9 states |
| emitted `faceOrders` | 117 triples over 18 faces, **acyclic** (checked) |

**[measured — `./target/release/treemaker flatfold … --format json`, re-run and
verified this session]**

The lesson: the solving unit is the **connected component of the constraint
graph**, it can span every plane in the model, and on a real model it is most of
the problem. Transitivity dominating at 79% also confirms it is not bookkeeping
(§5.3).

Also observed and **not** diagnosed: `bird_base.fold` — a molecule that *ships in
the app* ([`crates/oristudio-cp/resources/default-molecules/`](crates/oristudio-cp/resources/default-molecules/bird_base.fold))
— fails the repo's own flat-folder with *"unsatisfied component: component 1 has
no valid assignments."* Worth a look independent of this question.

### 4.3 The 3D constraints that have no flat analogue

- **The wall rule.** A crease carrying paper out of plane P acts as a wall
  standing on its crease line; an in-plane face whose *interior* the line crosses
  must be ordered away from it. This is a **unary** fix — the far face has left
  the plane and has no variable — which `EquivalenceCondition` (an equality
  between two order variables) cannot express. Good news: it needs no new type.
  It is a `HierarchyRelation{upper_face, lower_face}` written straight into the
  matrix, exactly how the M/V seed already works, and the Italiano closure then
  propagates it. **[derived]**
- **It is strictly stronger than the flat taco-tortilla, and discontinuous at
  180°.** Measured sweep: ρ = 30/90/150/179/179.999 → `FORCED (one-sided wall)`;
  ρ = 180 → `taco-tortilla`. At 180° the "g above both" branch reopens. So the
  exactly-flat state has strictly *more* valid layerings than any ε-perturbed
  neighbour — the opposite sign from "3D is easier." **[measured, `run_sweep.py`]**
- **Transversal interpenetration** is a failure mode the 2D Fold does not have,
  and no layer order repairs it. The detector is `straddles_a AND straddles_b`
  on **triangulated** faces (the OR form calls a wall standing on a floor a
  crossing), plus a crease-in-face-interior two-sided check that the pairwise
  test provably cannot see. It is **sound but not complete** — a state can pass
  it and still admit no valid order — so it must be paired with the solver and
  never shipped as a standalone validity gate. §5.2.

### 4.4 Tolerance is a policy, not a number

Near-180 plane separation is `L·sin(180−ρ)`, and within-CP crease-length range on
real CPs is p50 24× / p90 79× / max 221×, so one *distance* tolerance implies a
critical fold angle varying two-plus decades inside one document. Relative
epsilons fix scale sensitivity (12/32 adversarial cases flip on coordinate scale
alone; 2/32 with relative) but not jitter (16/32 non-deterministic at 1e-9
either way). Three dimensionally separated tolerances are required: **angular in
radians** (from the composed dual-path rotation, which is scale-free and
lever-arm-free), **offset relative to paper span** with an explicit path-length
term, and **overlap in length**. Rabbit Ear gets this wrong in a way that would
bite us specifically: `makeEpsilon` feeds a length-scaled epsilon into a
dimensionless normal-parallelism test, so at our native 400-unit coordinate space
creases 4–16° from flat are silently classified coplanar. **[measured]**

### 4.5 The facewise model, and the acyclicity trap

One `faceOrders` bit per face pair is a **reduction**, and ADK's proof of it is
scoped to *flat* foldings of *face-convex* crease patterns. Neither
`treemaker-flatfold` nor `oristudio-cp` checks convexity or triangulates (`grep
-rn convex` over flatfold: nothing). He & Guest supply the direction we need for
3D — *"in rigid origami pairs of points on stacked panels have the same order
function"* — but **not** sufficiency. So the honest output is a
**certified-consistent** face order, not a certified-embeddable folded state.

And the reduction has a trap two proposed designs walked into: see §5.4.

---

## 5. Refuted claims

A research doc that hides its own corrections is worthless. These were asserted
during the investigation and are wrong.

**5.1 "Different planes share no ordering variables, therefore the problem
decomposes per plane."** The premise is true and trivial; the conclusion is
false. Taco/tortilla constraints are generated by pairs of overlapping **edges**
([`constraints.rs:316`](crates/treemaker-flatfold/src/constraints.rs#L316)), and
nothing in that derivation requires the four faces to be mutually coplanar. In
3D two creases can have coincident folded images while their faces occupy
different planes. Measured counterexample in §4.2. **Union-find on the resulting
equalities does not restore decomposition — it renames the coupling** (measured:
all classes span planes; per-plane counting overshot 384 vs 16 on a nested-sheet
case). The correct unit is the constraint graph's connected component. The
relation is also an equality only **up to a computed orientation sign** (§1d), so
plain union-find would silently emit reversed stacks.

**5.2 "`C1 ∨ C2 ∨ C3` is exactly the self-crossing predicate."** It is sound but
**not complete**. Counterexample: a boundary vertex in a face's interior whose
cone has a sector above the plane, a sector *in* the plane, and a sector below.
Both transition rays lie in the plane, neither is a two-sided crease pair, the
predicate returns clean — yet the up-wall and the down-wall force contradictory
unary orders, so no layer order exists. Caught only by the solver going UNSAT.
This is why the verdict must be **three-way** (crossing / no valid order /
folded), not two-way.

**5.3 "Oriedita's constraint set is exactly {taco-tortilla, taco-taco}."** It
also has direct M/V pairwise seeding, per-SubFace transitive closure, and a
user-supplied `CustomConstraint` family (`HierarchyList.java:29-31`) that fixes a
SubFace's top/bottom face to a set — a non-equality constraint kind that already
exists. And **transitivity is a crossing condition, not bookkeeping**: ADK state
the taco-taco condition alone does not forbid all crossings and transitivity
forbids the rest. Measured corroboration in §4.2: transitivity is 79% of
Kabuto's constraint mass. A design built on pairwise arm classification plus a
transversality test would emit cyclic orders on any three-face stack.

**5.4 "Assert the layer relation is a strict total order — antisymmetric AND
acyclic — before rendering."** **A cyclic panel order is legal.** He & Guest:

> if just describing the order of a creased paper by the stacking order of
> panels, it may not be a well-defined order. An example is the **classical
> square twist**, where the ordering of some panels a, b, c, d are
> `a > b > c > d > a`.
> — *On Rigid Origami I*, Remark 4

All four panels of a square twist are coplanar and overlap-connected, so they land
in **one cluster** — the "per cluster" qualifier does not save the assertion. Two
proposed designs would have rejected a valid, foldable, ubiquitous pattern, and
the associated graft ("feed the BSP a topological sort of `faceOrders`") is
undefined on a cyclic relation. What *is* required is antisymmetry and
determinacy — every intra-SubFace pair decided — because the renderers fail
silently and differently on a tie: Oriedita paints the cell with face 0's back
colour; our `subface_top_stack`
([`folding.rs:3875`](crates/oristudio-cp/src/folding.rs#L3875)) drops the hole and
returns a short stack whose caller falls back to an arbitrary `face_ids.first()`.
**[measured — verbatim quote; Kabuto's emitted order is in fact acyclic, so this
is not universal, which is precisely the point]**

**5.5 "The corpus's 99.96% Kawasaki rate means these patterns are designed to
fold flat."** Two problems. (i) Every canonical **3D**-display tessellation —
Miura at three shift parameters, square twist, degree-6 waterbomb — scores
**100.00%** on the same test, so Kawasaki carries no information on the
flat-intent question. (ii) The corpus's coordinates are three lossy transforms
downstream of the designers' files; measured at the source, on-lattice rates are
94.4% of creases at 1e-9° rather than 76.6%, so any statistic finer than ~1e-4°
measures the converter. The *conclusion* (representational origami dominates)
survives on the filename and Lang evidence; the geometry number does not support
it.

**5.6 "The `.ori` exporter silently discards fold angles."** The codec omission
is real and deliberate (the divergence budget at
[`non-180-fold-angles.md:255`](implementation-plans/non-180-fold-angles.md#L255)
allocates **none** to the Oriedita codecs), but the loss is **blocked, not
silent**: `guardExportLoss('ori')` at
[`projectSlice.ts:2612`](apps/web/src/store/workspaceStore/slices/projectSlice.ts#L2612)
refuses the export. The residual gap is narrow — the in-place *Save* path at
`:1645` does not call the guard — and is **[unverified]** as reachable.

**5.7 "Oriedita's same-parity gate blocks generic 3D crease patterns."** The
graph-theoretic equivalence holds (gate fires ⟺ odd-degree interior vertex,
378/378 on random patterns), but the scope is backwards. Degree-4 and degree-6
vertices — every interior vertex of Miura, eggbox, Yoshimura and every
rigid-foldable quad mesh — **pass** the gate and get a silently wrong flat
answer. And a developable degree-3 vertex cannot fold at all (`cos A₁ = −1`
identically; the repo says so at `checks_spatial.rs:837`). The gate is not a
separate obstacle: it disappears with the parity seed it belongs to.

---

## 6. Recommended shape, and what to refuse

**Build, in this order.**

1. **Instrument the existing punt branch.** One analytics event at
   `creasePatternSlice.ts:1615` with a bucketed non-classic-crease count. An
   afternoon; it buys the one number that decides everything else (§4.1).
2. **Correct coplanar ordering for the SVG exporter that already ships.** This
   is the actual product ask (§3d), it repairs a self-documented limitation, and
   — decisively — **it needs no fold angles at all**, because every simulator
   session already produces a 3D folded form
   ([`foldedExport.ts:54`](apps/web/src/lib/foldedExport.ts#L54)). Ordering an
   already-folded state sidesteps §4.1 entirely.
3. **3D placement plus a closure verdict**, with the loop gap as a first-class,
   displayed, *gating* number (§2c) and a flat snap (§2c) before anything else
   runs. This is provable, cheap, and novel: Oriedita silently averages
   inconsistent vertex images, the physics simulator always converges to
   *something*, and Rabbit Ear returns an empty ordering with no error.
4. **Per-cluster ordering**, reusing the search verbatim with locally renumbered
   face ids, a normal-sign initial hierarchy replacing `initial_hierarchy_from_graph`,
   and wall seeds written as `HierarchyRelation`s.
5. **Cross-component parity** last, because it has no reference implementation
   anywhere (§3e) and no measurement of component sizes on 3D models.

**Refuse.**

- **A 3D Fold on angle-free crease patterns.** Not hard — ill-posed (§1c). The
  flat Fold already gives the only computable answer.
- **Fold angles read back from the physics simulator.** It is mass-spring with
  finite `faceStiffness` ([`types.ts:66`](packages/origami-simulator/src/types.ts#L66)),
  so no two faces are ever exactly coplanar — it would destroy the very condition
  the ordering decomposition needs in order to exist.
- **Any acyclicity assertion** (§5.4).
- **Copying Rabbit Ear.** Right architecture, wrong crate licence, and its wall
  constraint is unreachable (§3e).
- **Any silent tie-break.** If a cluster's order is undetermined, say so, per
  cluster, with the marginal pairs named.

---

## 7. What was NOT established

- **The global least-squares remedy to root-dependence is unverified.** I tried
  to show a global placement solve removes the BFS-root dependence and my
  formulation was **degenerate**: with only crease-agreement residuals the
  *unfolded* state is an exact solution, so it "converged" to 4e-13 on a state
  that does not close at all (`gap_leastsq2.py`). Report it as an untested
  hypothesis. This is the highest-value remaining experiment — it decides whether
  §2c needs a refusal gate or just a better placement algorithm.
- **Constraint-component sizes on a genuinely 3D model.** §4.2 is measured on a
  *flat* model. The whole "3D is generically easier" thesis rests on small
  per-plane ply and has only ever been measured on synthetic accordions and
  Miuras.
- **Whether an annulus is reachable in the UI** (§2b).
- **Rabbit Ear on multiply-connected or cyclic-order patterns.** Never run.
- **Geometric Folding Algorithms §11.4 itself.** Every statement about the
  general (non-flat) noncrossing conditions is second-hand via Akitaya–Demaine–Ku
  (who reproduce only the flat specialisation) and He & Guest (who cite §11.4
  without restating it).
- **`bird_base.fold` failing our own flat-folder** (§4.2). Observed, not
  diagnosed.
- **The tolerance window on real models.** §2c's 4–6 decades is measured on Miura
  only; the upper bound on a flat-base-shaped-in-3D model is unmeasured and could
  be much tighter.
- **PostHog was not authorised in this session**, so no statement here is backed
  by product telemetry. Every population claim is from file scans.

---

## 8. Corrections since publication

Added 2026-08-07, after the Phase 0 spikes of
[`implementation-plans/3d-folded-state.md`](../implementation-plans/3d-folded-state.md)
were run. The body above is left as published; this section says where it is now
wrong or incomplete. Every correction below is a measurement, and the plan is the
live document — read it, not this, for what to build.

### 8.1 §3a's table understates what is already shipped

Three things landed on `main` between 2026-07-29 and 2026-08-03, four to nine
days before this doc was written, and it names none of them.

- **Local spherical simplicity is DONE and shipped.** `vertex_link_polygon`
  ([`checks_spatial.rs:232`](../crates/oristudio-cp/src/checks_spatial.rs#L232)),
  `LinkVerdict` (`:258`, with `self_intersects()` at `:302`) and
  `vertex_link_verdict` (`:327`) are all public. `dispatched_camv` (`:1048`)
  routes them; `spatial_closure_diagnostics`
  ([`lib.rs:3039-3054`](../crates/oristudio-cp/src/lib.rs#L3039)) emits
  `kind: "SpatialSelfIntersection"` with `rule: Some("SelfIntersection")`; the
  literal is in the tracked `.wasm`; the copy is at
  `apps/web/src/cp-workspace/diagnostics/foldabilityMessages.ts:171-176` and is
  translated in all eight locales. `crates/oristudio-cp/tests/spherical_simplicity.rs`
  is 614 lines. So `non-180-fold-angles.md:853`'s Phase 8 item 1 is unchecked but
  complete; only `:854`'s loop-check item is genuinely open. §5.2's "the verdict
  must be three-way" reads as a requirement for an arm that already exists — for
  the **local** case. The *transversal* (face-vs-face) crossing of §4.3 and the
  UNSAT case are still unbuilt, and that is what a third verdict arm actually
  costs.
- **The §5 three-unknown solver is DONE**, with both roots surfaced as a branch
  choice. `crates/oristudio-cp/src/solve_fold_angles.rs`,
  `OperationId::VertexSolveFoldAngles`, `candidate_index` on the command, and
  `apps/web/src/cp-workspace/foldAngleSolve/`. §4.1's note that "the repo already
  ships two fold-angle solvers" is right and understated: `non-180`'s Phase 7
  items 1 and 2 are both done, item 2 subsumed by item 1 (the §5 solver takes any
  chosen triple from a fan of any degree).
- **Two corpus tools exist.** `crates/oristudio-cp/examples/fold_corpus_scan.rs`
  grades a directory of `.fold` files under `dispatched_camv` and diffs two
  directories; `crates/oristudio-cp/tests/verify_fold_fixtures.rs` pins the two
  shipped fold-angle fixtures. `scripts/svg-to-fold.mjs` and
  `scripts/fetch-non-flat-corpus.sh` convert and regenerate the Ghassaei corpus.

### 8.2 TL;DR item 9 — "the inputs do not exist" — is half right

The tracked-file measurement stands and was re-verified: `git ls-files '*.fold'`
returns 33, and exactly 2 carry a non-classic angle. **But admissible multi-face
3D-angled material exists outside git, and it has now been measured.** The repo
owner's non-flat corpus holds 11 models he authored in Ori Studio (nine `.osf`
carrying real `fold_magnitude` values, plus `spikes_better.fold` and
`test_export.fold`) and 10 curated third-party models regenerable by the
committed fetch script. Under `fold_corpus_scan`: `known-good/` is **0 flat / 0
closure / 0 self-int / 0 link-crossing on all ten**; six of the nine `.osf`
report nothing; **19% of the 36 published Ghassaei-derived patterns pass** (the
other 28 fail on closure, because their fold angles are relaxation targets rather
than solved states). So §4.1's ranking of input supply as the hardest problem
survives on the **product** axis and is retired on the **fixture** axis.

### 8.3 §2b is right, and the reason its consequence fails is not topology

T1 and T2 both reproduced on real authored data through the shipped kernel, not
just in NumPy: the loop gap is 8.2e-14 rad over 2,146 dual cycles on
`origamisimulator` and 5.1e-14 over 1,183 on `helloworld`, and O(1) radians on
exactly the models `dispatched_camv` flags. T2's 2.094 rad for (90,90,90,90) was
reproduced to 1e-15 by an independent composition.

§2b's `[unverified]` — *"whether a user can actually draw an annulus in the Ori
Studio UI"* — is now answered, and the answer is worse than "yes".

- Drawing a ring is trivially reachable: `Black0` is a **primary** palette entry
  (`apps/web/src/lib/oristudioCpPalette.ts:16`), and border-enclosed interior
  regions are a product concept the app actively asks for
  (`apps/web/src/cp-workspace/inlineSimulation/resolveSimulationRegion.ts`).
- `calculate_faces` **does** fill the hole, so the object folded is simply
  connected — that half of the "unreachable" argument is true.
- What fails is the inference. `is_interior_vertex`
  ([`checks_spatial.rs:642-648`](../crates/oristudio-cp/src/checks_spatial.rs#L642))
  returns false for every vertex touching a `Black0` line, so after the fill the
  hub vertices are genuinely interior and the check still declines them. Measured
  on a drawn 200×200 annulus: 5 faces, Euler gate passes, **0 flat / 0 closure /
  0 spatial vertices examined at all**, loop gap 1.571 rad filled and 2.094 rad
  with the hole deleted.
- It is not hypothetical. `known-good/byu solar driven.fold` — in a directory
  whose README says every model there reports nothing — carries a closed hexagon
  of six `B` edges inside the sheet, reports 0 flat / 0 closure / worst interior
  residual 2.575e-12°, and places with a loop gap of 1.445 rad. FOLD `C` (cut)
  also maps to `Black0` (`model/mod.rs:508`), so kirigami arrives the same way.
- Across 63 corpus files: `interior_borders > 0` **iff** `blind_cycles > 0`, no
  exceptions.

So the correct framing is **closure-check coverage**, not paper topology, and the
loop gap has to **gate** rather than be reported.

### 8.4 §2c's window holds; its upper bound does not

`loop_gap < dist_tol < min plane separation` measured on real corpus models has
**7.6 decades of headroom in the worst case, 10.8 excluding one hand-rounded toy
fixture** — better than the synthetic 4–6 reported here. §7's open item "the
tolerance window on real models" is therefore partly closed.

But `min plane separation` cannot be the upper bound: it is `+inf` on 6 of 16
folding models (no two parallel distinct planes, certifying nothing), and on
`airplane` it is 1.45e-8 relative, where it is measuring the file's 6-decimal
coordinate rounding. What *is* usable is a spectrum-gap test — the separation
spectrum is cleanly bimodal on 15 of 16 folding models with an empty band six
decades wide, and only fills in on models that already fail closure.

### 8.5 §1a's placement walk is confirmed, with one trap it does not mention

The convention is settled and reproduces the shipped spherical-link check:

> `M_child = M_parent ∘ Rot_paper(line, ρ)` — right-compose, axis in paper
> coordinates along the **child** face's own winding, ρ the signed FOLD angle.

Agreement with `vertex_link_polygon` is 2.8e-17 to 5.0e-16 across four fans of
degree 3–6, against 1.5e-2 to 1.9 for each of negated-ρ, left-compose and
parent-axis. End to end on Mooser's Train: rms 1.76e-3 × span correct, 7.3e-2
negated, 1.43 left-compose.

**The trap:** `FoldGraph::faces` are guaranteed **clockwise** in y-up paper
coordinates, the exact mirror of the FOLD convention above.
`should_add_face` ([`fold_graph.rs:285-299`](../crates/oristudio-cp/src/fold_graph.rs#L285))
admits a face only when `Polygon::calculate_area`
([`geometry/polygon.rs:207-221`](../crates/oristudio-cp/src/geometry/polygon.rs#L207)) —
the **negated** shoelace — is positive. One global reversal is required and its
direction is known.

Two further notes on §1a: the doc writes `π − ρ` using ρ as the *dihedral* angle,
which is supplementary to the kernel's `crease_fold_angle`; the kernel's is the
one that matters and applying it directly is settled. And `import_fold_document`
silently drops z ([`io/fold.rs:297-312`](../crates/oristudio-cp/src/io/fold.rs#L297)),
so any `foldedForm` file read through it is folded from its xy shadow.

### 8.6 §1b's cluster measurement is right and its implication was over-read

"A 24-facet accordion at ±180 gives one cluster of 24 … the same pattern at
±90/±135/±170 gives 24 singleton clusters and 0 ordering pairs" reproduces. What
it does **not** license is the reading the plan briefly adopted — that a document
with no ±180 crease has no coplanar overlap.

- **The theorem:** `census ≥ (number of creases at exactly ±180)`. Held on 18 of
  18 admitted corpus models, tight on `waterbombBase` (4 = 4), computable without
  any placement.
- **The converse is false.** A 5-panel strip creased at +90° four times — a paper
  tube with a glue flap — has zero full folds and measures **census 1 on a
  non-adjacent pair**. Nine panels → 6; seven at +120° → 5; the 4-panel open box
  → 0. The accordion and Miura families in §1b are all *strips that do not wrap
  onto themselves*, which is exactly where the two conditions coincide.

Measured over the corpus: census 0 on 4 of 18 admitted models (2, 5, 6 and 6
faces), true median 81.5, mean 1,419, max 12,736; no admitted model above 8 faces
measured zero. And the fraction of faces sitting in a plane with at least one
overlap is **1.00 on 12 of the 14** non-zero models. So "render honestly
undetermined" is not a smaller feature — it is a picture with nothing opaque in
it, and layer ordering is not optional.

### 8.7 §4.2's Kabuto number is now confirmed by a second implementation

117 ordering variables, components `[81, 18, 18]`. An independent coplanar-overlap
census over 3D-placed faces counts **117 overlapping pairs** on the same file, and
the same comparison gives 15/15 on `treemaker-triad-base` and 3/3 on
`accordion-book-fold` (both under `tests/fixtures/folding-sequence/fold/`). Two
implementations, one number.

`bird_base.fold` failing the repo's own flat-folder (§4.2, §7) is still not
diagnosed.

### 8.8 §7 items that are now closed, and one that is not

- **"Constraint-component sizes on a genuinely 3D model"** — the corpus supplies
  the material and the census supplies per-model pair counts, but the
  *component* decomposition on a 3D model has still not been run. Partly open.
- **"Whether an annulus is reachable in the UI"** — closed; see §8.3.
- **"The tolerance window on real models"** — closed for the lower bound; see
  §8.4.
- **"The global least-squares remedy to root-dependence"** — still unverified, and
  now less urgent: placement is path-independent to 1.5e-15 across all BFS roots
  on a genuine rigid state, and O(1) only on models that already fail closure. The
  question was whether §2c needs a refusal gate or a better algorithm; the measured
  answer so far is that admissible input needs neither.

### 8.9 One thing that looked like a ground truth and is not

`MoosersTrainRigid-Gardner.fold` and its `_ 100PercentFolded` sibling are the
same mesh at two states, with the vertex correspondence built in — but **both are
mass-spring relaxation outputs, not rigid folded states**. The 0% file is not
planar (max 0.0142 off its best-fit plane against a shortest edge of 0.0119) and
the two states are not isometric (edge lengths drift up to 1.15%). Its declared
angles reproduce its measured dihedrals to p50 0.018° / max 0.42°, which makes it
a ≥0.5° smoke oracle — five to six decades coarser than the 1e-6° closure bar, and
coarser than the placement walk's own internal tear on that input. Derive no
tolerance from it.

The SVG-derived `origami-simulator-corpus/fold/MoosersTrainRigid-Gardner.fold` is
**not** the corresponding crease pattern: it is a different discretisation with 68
extra subdivision vertices and no faces.
