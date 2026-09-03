# Holes in the folding pipeline — what it would take

**Date:** 2026-08-31
**Question:** A crease pattern whose paper is a square with a rectangular hole
cut out of it fails to fold, with `SameParityAdjacentFaces` ("two faces meet with
the same orientation across a crease"). What would it take to support holed —
multiply-connected — paper in the folding and layer-ordering code?

**Verdict:** **The example is flat-foldable and the refusal is a false
negative.** The pattern has exactly one valid layer ordering, confirmed
independently by both flat solvers in this repo. One fact explains the whole
failure: `FoldGraph::calculate_faces` traces the hole as a **paper face**, so the
hole's border segments become face-to-face joins and every consumer downstream
treats a rectangle of nothing as a facet.

The fix for that fact is a rule this repo has **already ported** —
[`conversion.rs:75-88`](crates/treemaker-flatfold/src/conversion.rs#L75) is
Flat-Folder's "remove holes" filter — applied at one more site, plus one added
clause the overloaded `Black0` colour makes necessary here (§2). With that rule
armed in `calculate_faces`, the example folds (`Solved`, 1 solution), a 3D fold
of an annulus places end to end, and **exactly one** test in the ~700-test
`oristudio-cp` suite fails — the one that asserts today's hole behaviour.

Three things bound the feature, and only the third is research:

1. **Flat is a bug, not a missing feature.** One filter in one function. §2.
2. **3D is a deliberate refusal that the repo already knows how to lift.**
   `Fold3dRefusal::InteriorCut` guards holes because the per-vertex closure check
   cannot see hole-boundary vertices — and `LoopNotClosed`, written as "defence
   in depth", is the check that covers exactly that gap. Measured working. §3.
3. **"Where is the paper" is not represented.** `Black0` means border *and* cut
   *and* join, and the derivation rules are only as good as that one colour. §5.

---

## 1. The example, measured

`hole_example.osf`: a 400×400 sheet with the rectangle `x ∈ [50,100]`,
`y ∈ [-50,50]` removed. Every crease is a classic ±180, so the fold routes to the
**flat** folder ([`foldRoute.ts:88`](apps/web/src/cp-workspace/folded/foldRoute.ts#L88)
sends a fold to the 3D door only when some scoped crease carries a non-180
magnitude). The 3D folder is not reachable from this file at all.

Through the shipped kernel:

| | value |
| --- | --- |
| segments / vertices | 83 / 49 |
| faces traced | **35** — 34 paper + the hole |
| Euler `F − E + V` | `35 − 83 + 49 = 1` → gate passes |
| `interior_border_segments` | **6** — every hole-boundary segment, named exactly |
| `CheckCamv` diagnostics | **`{}` — nothing at all** |
| flat fold | `fold_same_parity`, `SameParityAdjacentFaces { line: 17, first_face: 14, second_face: 16 }` |
| 3D fold (creases forced to 150°) | `Refused(InteriorCut { line: 76, point: (50, −25) })` |

The Euler gate passes *because* the hole is counted. For an annulus subdivision
`V − E + F_paper = 0`, so `F_paper + 1 − E + V = 1` — the hole is exactly the
face that makes the arithmetic come out right. Dropping holes must therefore
happen **after** the gate, never before.

### The parity abort is contamination, not a verdict — and it always fires

Over the 45 real crease adjacencies, with the hole face excluded, the dual graph
is **connected and bipartite — zero parity violations**. Include the hole and
four appear: edges 76 and 79 are the hole's own `B` segments, and edges 17 and 19
are ordinary valley creases whose faces the BFS reached *through* the hole and so
coloured wrong. The kernel reports the first one it reaches, which is one of the
two contaminated ones — so the error does not even point at the hole.

`initial_hierarchy_from_graph`
([`folding.rs:4298`](crates/oristudio-cp/src/folding.rs#L4298)) skips a line only
when `line_face_border` returns the same face twice. On a disk that is exactly
the paper edge. On an annulus the hole's border segments have two distinct traced
faces, so they are read as creases, and then
`first_position % 2 == second_position % 2` fires.

Two caveats on how far that generalises, both worth stating because each cuts a
different way.

**The gate is colour-blind, so a hole is not the only way to reach it.** It reads
`face_position` and nothing else; colour is consulted afterwards only to choose
stacking direction. It is Maekawa's even-degree corollary, and any odd cycle in
the dual graph trips it — an ordinary disk with an odd-degree interior vertex
included. So `SameParityAdjacentFaces` must never be *reported* as "you have a
hole"; it should be reported as a hole only when `interior_border_segments` is
also non-empty, which is what §2's error-message proposal does.

**Conversely, a hole that creases reach appears always to trip it, so *that* case
is a loud failure rather than a quiet wrong answer.** A hole is ringed by paper
faces that are pairwise adjacent around it, so `hole → face_i → face_{i+1} → hole`
is a 3-cycle whenever two or more faces surround it. Five topologies — including
a ring with 8 spokes chosen to make every hole-corner degree even, and a ring cut
so that every dual cycle through the hole is even — all abort. **[measured on
five constructions; the structural argument is not a proof]**

**But a hole no crease reaches fails silently, and that is worse.** With fewer
than two creases meeting the hole ring, the paper region is itself annular, the
Euler gate clears every face (§4), and `estimate_wireframe_from_segments` returns
`Ok(None)` — which `folded_figure_fold` passes through as **success**:

```
hole touched by no crease   wireframe: Ok(None)      FLAT FOLD: Ok, NotAttempted, 0 cases, Step1
control, hole deleted       wireframe: Some, 2 faces FLAT FOLD: Ok, Solved,       1 case,  Step5
```

Press Fold and get no error and no folded figure. The 3D path handles the same
input correctly, refusing with `FacesUnresolved`. Surfacing the cleared-faces
case as an error on the flat path is independent of hole support and worth doing
either way.

### Both flat solvers agree the pattern folds

| solver | faces used | result |
| --- | --- | --- |
| `oristudio-cp` (Oriedita port), hole face dropped | 34 | `Solved`, `discovered_fold_cases = 1`, *"There is no other solution."* |
| `treemaker-flatfold` (Flat-Folder port), as shipped | 35 → **34** | `component_sizes [509]`, `solution_counts [1]` |

`treemaker-flatfold` needed no patch. It already filters the hole, because
Flat-Folder does.

---

## 2. Flat: one filter, at one site

Upstream's rule is three lines
([`flat-folder/src/io.js:277`](third_party/flat-folder/src/io.js#L277)):

```js
[EF, FE] = X.EV_FV_2_EF_FE(EV, FV);     // remove holes
if (FV.length > 1) {
    FV = FV.filter((F, i) => !FE[i].every(e => (EA[e] == "B")));
}
if (FV.length != FE.length) {           // recompute face maps
    [EF, FE] = X.EV_FV_2_EF_FE(EV, FV);
}
```

**A face whose every edge is a boundary edge is a hole.** Ours is the faithful
port at [`conversion.rs:75-88`](crates/treemaker-flatfold/src/conversion.rs#L75),
including the recompute. Porting discipline therefore already has an answer here
— this is not an algorithm to invent.

### One clause has to be added, and it is not optional

The rule is safe upstream because Flat-Folder's input is FOLD, where `B` means
paper boundary *by definition* and an interior divider would be `F` or `U`. In
Ori Studio `Black0` is a primary palette colour users draw with freely, and the
rule has a measured false positive that is small and entirely realistic:

> **A plain square split in half by one interior `Black0` line.** Two faces, and
> *both* have every edge in `Black0`. Upstream's filter — guarded only by
> `FV.length > 1` — drops **both** and deletes the model. Today that document
> folds: `2 faces, 1 relation`.

The clause that fixes it is the repo's own `interior_border_segments` predicate
lifted from a segment to a ring: **every edge of the ring must also have a face
on the other side.** A hole is enclosed; the halves of a divided square each
carry outer-boundary edges with only one face. Measured across every shape I
could construct:

| document | upstream rule | + enclosed clause |
| --- | --- | --- |
| `hole_example.osf` | drop 1 (the hole) | **drop 1 (the hole)** |
| square ring, 4 radial creases | drop 1 | **drop 1** |
| square ring, 8 radial creases | drop 1 | **drop 1** |
| ring whose hole touches the fold line | drop 1 | **drop 1** |
| square split by one interior `Black0` line | drop 2 of 2 — **model deleted** | **drop 0** |
| all-`Black0` 5×5 grid | drop 25 of 25 | drop 9 (the interior cells) |
| creased grid + detached `Black0` square | n/a — refuses earlier | n/a |
| document with no border lines at all | drop 0 | **drop 0** |

The all-`Black0` grid is the one case still misread, and it is genuinely
ambiguous input: today the kernel folds it as one sheet and emits 40 layer
relations across border lines, which is not obviously the right answer either.

The site is `FoldGraph::calculate_faces`
([`fold_graph.rs:382`](crates/oristudio-cp/src/fold_graph.rs#L382)), immediately
after the Euler gate and before `line_face_borders_from_incidence`: drop the
all-border faces, rebuild the incidence map, rebuild the borders. Everything
downstream then reads a hole-free face set with no further change —
`face_positions`, `initial_hierarchy_from_graph`, `configure_subfaces`
(point-in-polygon, so an uncovered region is naturally empty), the permutation
search, and the renderer.

**Measured blast radius** (rule armed behind an env var, full
`cargo test -p oristudio-cp`): **one failure**, and it is
`a_drawn_ring_is_refused_at_the_join_the_closure_check_cannot_see`
([`placement.rs:1338`](crates/oristudio-cp/src/folding3d/placement.rs#L1338)),
whose assertion reads `graph.faces.len() == 5, "four sectors plus the filled
hole"`. That is the behaviour being changed, so the test is a deliberate update
rather than collateral. Everything else passes — including
`connected_grid_of_that_size_still_folds`, both `disconnected_face_graph_*`
tests, and all of `cancel.rs`.

(Without the enclosed clause it is three failures instead of one, all of them
`cancel.rs`'s all-`Black0` `grid(n)` fixture, where the bare upstream rule
removes every face and leaves nothing to cancel.)

Sizing: **small.** ~45 lines in `fold_graph.rs`, one test update, plus new tests.

### Also worth fixing, and cheaper still

`interior_border_segments` already names all six hole segments in this file, but
`dispatched_camv` only consults the spatial branch when the document carries a
non-classic crease — pinned deliberately by
`an_all_classic_annulus_reports_no_interior_border_through_the_dispatch`
([`checks_spatial.rs:689`](crates/oristudio-cp/tests/checks_spatial.rs#L689)), so
that an all-classic `CheckCamv` stays byte-identical to Oriedita's. The result is
that the user gets **no editor warning** and then a parity error naming an
unrelated crease.

Independently of any hole support: when the flat fold aborts with
`SameParityAdjacentFaces`, consult `interior_border_segments` and, if it is
non-empty, say *"there is a hole/cut in the sheet at (x, y)"* and point at it.
That is a strictly better error for the same failure, and it does not require
deciding anything about topology.

---

## 3. 3D: the guard is lifted by a check that already ships

The 3D folder does not fail on holes — it **refuses** them, on purpose:

> `InteriorCut` — *A border segment with paper on **both** sides: a cut, not a
> hinge. [`is_interior_vertex`] declines every vertex touching a border, so the
> closure check returns CLEAN having examined none of the geometry around one.*
> — [`folding3d.rs:251`](crates/oristudio-cp/src/folding3d.rs#L251)

The reason is coverage, not geometry: a vertex on a hole boundary has no closure
condition (the paper genuinely does not wrap around it), so per-vertex closure is
satisfied *vacuously* and certifies nothing. That is the right worry. The answer
to it is already in the file, one refusal down:

> `LoopNotClosed` — *The placement is not path-independent … **On simply
> connected paper this is implied by per-vertex closure**, so it is defence in
> depth rather than the common refusal.*
> — [`folding3d.rs:269`](crates/oristudio-cp/src/folding3d.rs#L269)

On an annulus the implication does not run, and the loop gap becomes the *only*
correctness check there is. `LoopGap::non_tree_edges` is documented as the first
Betti number of the dual graph — so the hole cycle is already one of the cycles
it measures. `research/2026-08-07-3d-fold-feasibility.md` §2b/§8.3 reached the
same conclusion from the other direction ("the correct framing is closure-check
coverage, not paper topology, and the loop gap has to **gate** rather than be
reported"), and it does gate today, at
[`admit.rs:212`](crates/oristudio-cp/src/folding3d/admit.rs#L212).

**Measured.** With hole faces dropped and the `InteriorCut` early return
bypassed, on synthetic annuli built so the dual graph has a cycle around the hole:

| sheet | shipped | experiment |
| --- | --- | --- |
| annulus, two crease segments on one axis (holonomy = identity) | `InteriorCut` | **`PLACED`**, verdict `Folded`, 2 planes, `non_tree_edges 1`, loop offset `0.000000` |
| same, axes offset by 20 (holonomy = translation) | `InteriorCut` | `LoopNotClosed { gap_offset: 28.28 }` |
| picture frame, 4 radial creases @ 90° | `InteriorCut` | `LoopNotClosed { gap_radians: 2.094 }` |
| picture frame, @ 120° | `InteriorCut` | `LoopNotClosed { gap_radians: 2.891 }` |
| picture frame, @ 150° | `InteriorCut` | `LoopNotClosed { gap_radians: 1.472 }` |
| user's file forced to 150° | `InteriorCut` | `VertexClosure` at (−150, −150), 16.8° |

The shipped gate gives the same answer to the valid sheet and the invalid one.
The experiment separates them, and the picture-frame numbers reproduce §2b's T2
table (2.094 rad at 90°) through the shipped kernel rather than NumPy. The whole
3D pipeline past admission — planes, cells, constraints, layer order, snapshot —
ran on multiply-connected paper without a change.

Sizing: **zero, given §2 — measured.** No change to `folding3d/` is needed at
all. `InteriorCut` is driven by `interior_border_segments_in`, which asks how many
*traced faces* carry each `Black0` edge; once the hole face is gone its edges have
one, so the refusal stops firing on a clean hole by itself. With the §2 filter
applied and `admit.rs` **untouched**, the valid annulus places (`PLACED`, verdict
`Folded`, `non_tree_edges 1`, loop offset `0.000000`) and the invalid one refuses
(`LoopNotClosed`). The whole 3D pipeline past admission — placement, planes,
cells, constraints, layer order, snapshot — runs on multiply-connected paper with
no 3D-specific work.

The refusal is not left dead: a `Black0` line that does *not* enclose a region
keeps two traced faces (the enclosed clause declines to drop either side), so a
genuine interior cut still reaches it.

---

## 4. What still refuses, and correctly

**A hole no crease reaches.** If nothing joins a hole boundary to the rest of the
sheet, the paper face is *itself* an annulus, which a `Vec<usize>` vertex ring
cannot describe. Measured: `FacesUnresolved` — the Euler gate rejects the
arrangement before anything else looks. Flat-Folder has the same limitation
(`V_EV_2_VV_FV` returns simple rings). Lifting it means a face representation
with an outer ring plus hole rings, which changes `faces: Vec<Vec<usize>>` and
every consumer of `folded_face_polygons`, `Polygon::inside`, the subface
arrangement, and the renderer. **Large, and not needed for the reported bug** —
the user's file has creases meeting the hole, so no face is annular.

**Genuinely non-closing angles.** `LoopNotClosed` is doing real work above, not
getting in the way.

---

## 5. The part that is actually hard

Ori Studio has no representation of *where the paper is*. `Black0` is one colour
carrying three meanings — `line_color_for_fold_assignment`
([`model/mod.rs:718`](crates/oristudio-cp/src/model/mod.rs#L718)) maps FOLD `B`,
`C` (cut) and `J` (join) all onto it, and it maps back out as `B` — so "sheet
boundary", "kirigami cut" and "decorative black line" are the same token. Every
derivation rule inherits that ambiguity. Three rules were measured against it:

- **Even-odd flood fill** from the unbounded face, toggling on `Black0`
  crossings. Correct on the example, but mislabels any pattern that uses `Black0`
  for anything else: on the all-black `grid(5)` it produced a checkerboard and
  the fold came back `DisconnectedFaces`; on a document with **no** border lines
  at all — very common — it removed 225 of 226 faces. A degree-2 well-posedness
  gate fixes the first and not the second. **Rejected.**
- **Flat-Folder's all-border-edges rule, as ported.** Degrades correctly on the
  no-border document and on the disconnected and Red/Blue grid fixtures, but
  deletes both halves of a square split by one interior `Black0` line.
- **The same rule with the enclosed clause** (§2). Every hole shape correct,
  the divided square correct, the no-border document correct; only the
  all-`Black0` grid still misread, and non-fatally. **Recommended.**

So the upstream rule, with one added clause, wins on evidence as well as on
porting discipline. It is still a heuristic over an overloaded colour, and the
durable fix is to stop overloading it: either a first-class sheet outline in the document model (outer
ring + hole rings, which would also settle the export-grid clip and the
simulation-region question), or a distinct role for cut/hole boundary — with the
`.cp`/Oriedita round-trip cost that a new colour implies. That decision is worth
making deliberately; it is not required to fix the reported bug.

---

## 6. Ordered

1. **Better error for the existing refusal** — consult `interior_border_segments`
   when the flat fold aborts with `SameParityAdjacentFaces`. *Trivial. No
   behaviour change.*
2. **Port the hole filter into `calculate_faces`**, after the Euler gate, with
   the enclosed clause of §2. Fixes the reported file; one existing test asserts
   the old behaviour and updates with it. *Small.*
3. **3D comes with step 2 — no separate work.** Measured: with the filter in
   `fold_graph.rs` and `folding3d/` untouched, a valid annulus places and an
   invalid one is refused by `LoopNotClosed`. Add the two synthetic annuli as
   fixtures — one that places, one that must refuse. *Tests only.*
   Worth stating plainly, because a review pass of this investigation concluded
   the opposite: the holonomy around a hole **is** checked today. `LoopNotClosed`
   fires at [`admit.rs:212`](crates/oristudio-cp/src/folding3d/admit.rs#L212) on
   every non-tree dual edge, the hole cycle included.
4. **Surface the cleared-faces no-op.** `estimate_wireframe_from_segments`
   returning `Ok(None)` reaches the user as a successful fold that produced
   nothing. Independent of holes; a hole with no crease on it is how you meet it.
   *Small.*
5. **Frontend follow-up.** The flat error path leaves a permanent `status:
   'error'` folded-figure entry, keeps it active, and discards the user's crease
   selection; it is serialised into the saved `.osf`. Not hole-specific — it
   affects every thrown flat-fold failure — but this bug is how you meet it.
   *Small.*
6. **Sheet-outline representation.** Only if holes become a real product
   direction. *Large; decide before starting.*
7. **Annular faces.** Multi-ring face representation. *Large; out of scope for
   this bug.*

## 7. Reproduction

The experiment is one patch to `calculate_faces` (drop all-border faces behind
`ORISTUDIO_DROP_HOLES=1`, plus one `filter` on the `InteriorCut` early return)
and three throwaway examples. Both are saved with this investigation; the patch
is ~40 lines and the probes use only public API. To re-run:

```bash
cargo run -q --release -p oristudio-cp --example hole_probe -- path/to/hole_example.osf
```
