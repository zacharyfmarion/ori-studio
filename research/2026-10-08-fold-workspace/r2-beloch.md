# Beloch deep-read: what a production Fold engine should take from it

## Summary

Beloch (github.com/tophcodes/beloch, MIT, commit `88bfcce` from 2026-10-05) is the closest prior art to the Fold workspace. Its kernel already uses most of the round-1 hypotheses:

- **State.** The state is convex faces in paper coordinates, joined by hinges whose angle is 0 or ±π. There is one root face with a base isometry. Every face isometry is derived by a breadth-first walk from the root, and a closure check runs on every hinge.
- **Letters.** Mountain/valley letters are derived from the state and never stored.
- **One validating constructor.** Every operation builds a candidate state and passes it through a single constructor, `Fold_state.make`, which runs all the validity checks.
- **One primitive.** Every operation is a reflection of "blocks" of faces across one table line, each block with a placement: `top`, `bottom`, `over T` or `under T`.

Where Beloch differs from our design:

- **Layer order is a total rank, not pairwise.** The kernel stores one ordering of all faces, not a pairwise relation. So cyclic layerings such as the square twist cannot be represented (issue #3).
- **Arithmetic is exact (FLINT `qqbar`), and that costs a lot.** The crane takes 2.0 s natively after heavy optimisation (373 s before it) and 112 s in the browser bundle, against the playground's 8 s budget.
- **The model is not finished.** The operations section of the formal model is a draft. The lemma that a top/bottom fold crosses nothing (`lem-fold-closed`) has a pending proof. The kernel catches any violation after the fact rather than proving it cannot happen.

New evidence from this spike:

1. **Beloch's committed FOLD fixtures are all valid flat states according to the vendored Flat-Folder solver.** That is 105 non-trivial frames from 56 distinct files, 1,701 face-pair orders, and 0 conflicts. The 311 crease pairs whose letters could be checked all agree with the orders. A negative control (flipping one seeded order at a time) was caught 721 out of 731 times. These files can serve as golden fixtures today, with no OCaml build.
2. **The claim that a simple fold never needs to update moving–moving face-order triples holds on every Beloch `fold` step: 47 of 47.** It fails for reverse folds: 21 of 25 moving–moving pairs flip sign, because pairs that sit on opposite sides of the opening keep their absolute order.

The Beloch clone and all spike code are under `artifacts/fold-spike/` (gitignored). No tracked file was changed.

---

## What I ran

All scripts are throwaway Node ESM files that import the vendored Flat-Folder modules from `third_party/flat-folder/src`. Node is v26.8.1 and needed no workarounds.

**`artifacts/fold-spike/beloch-oracle/verify-beloch-fold.mjs`** checks one Beloch FOLD file against Flat-Folder, frame by frame:

1. Pull each face's table polygon back to paper coordinates through `beloch:faces_matrix`.
2. Let Flat-Folder build its own arrangement: faces, folded coordinates, cells, variables and constraints.
3. Map Flat-Folder's faces to Beloch's by paper centroid.
4. Seed every variable from Beloch's `faceOrders`, using Flat-Folder's own face-order semantics (`conversion.js` `edges_Ff_2_FO`).
5. Run `SOLVER.initial_assignment`.

It also checks four other things:

- Beloch's table coordinates match Flat-Folder's folded coordinates up to one global isometry.
- Each face's flipped flag matches Beloch's face-up flag.
- The orders implied by the letters (`BA0`) agree with the seed.
- Negative control: flipping one seeded variable at a time is detected.

Results (`all-results.jsonl`):

- 163 frames in 56 distinct fixture files. 58 were skipped because they are flat (fewer than 2 faces).
- **105 of 105 checked frames passed.** 0 conflicts, 0 unmapped faces, 0 unseeded variables.
- Maximum geometric disagreement was 1.6e-15. That is the crane: 60 faces, 770 pairs, 0.10 s wall time including Flat-Folder's constraint setup.
- 311 letter checks, 0 disagreements.
- 721 of 731 single-variable flips were detected. The 10 misses are 2–3-face frames from old fixtures that lack `edges_faces`. There the only variable has no letter information and no taco constraint, so nothing can catch the flip.

**`triple-invariance.mjs`** matches each face in frame k+1 to its parent in frame k, then compares the FOLD triple sign before and after, grouped by verb and motion:

| verb | pair class | triple unchanged | triple flipped |
|---|---|---|---|
| fold | both moved, same reflection | 47 | 0 |
| fold | both stationary | 125 | 0 |
| reverse | both stationary | 231 | 0 |
| reverse | both moved, same reflection | 4 | 21 |
| flip | both moved | 2 | 0 |

A few fixtures have no program file beside them, so their verb is unknown. The 3 unchanged / 3 flipped moving–moving pairs in that bucket all come from fixtures named `reverse-*`.

What this does not show: Beloch's `fold_blocks` builds the moving block by reversing it, so the 47/47 is consistency, not independent proof. No multi-frame fixture contains a `flatten` step, so fans are untested here.

---

## 1. State, flaps, refinement, validity

**Model.** The formal model (`spec/MODEL.md`) is reviewed in §1–4. §5 (operations) is a draft, and §6 (programs) is "to be written" (`spec/MODEL.md:32-40`).

- **The state is a triple** of faces, folding map and layer relation (`MODEL.md:92-116`):
  - convex faces that tile the sheet;
  - one plane isometry per face, agreeing on shared edges;
  - an antisymmetric ±1 relation on ordered pairs of faces that overlap in the interior. +1 means "above", Demaine's sign, which is the opposite of Akitaya's (`:124-129`).
- **One value per face pair** is justified because two convex faces overlap in one convex region that contains no crease.
- **Hinges** are either flat (angle 0, same isometry) or folded (±π, the neighbour's isometry composed with the reflection across the hinge line). `lem-hinge-cases` (`:171-183`) proves those are the only two cases.

**Refinement.** Splitting a face into two convex faces with a flat hinge, copying the isometry and the relation, gives the same state (`:243-250`). Two refinements always have a common refinement (`:252-272`). So `mark` (scoring a crease without folding) is the identity on states.

**Flap.** A flap is a maximal set of faces connected by flat hinges (`:279-287`). It is invariant under refinement, so the language addresses flaps, never faces. ADR 0017 explains why: precrease-grained faces caused `#(...)` selection failures on a still-flat sheet, and a stale point-position bug.

**Validity conditions** (`:342-421`):

- **Order:** transitivity on regions where three faces overlap.
- **Taco-tortilla:** a face covering a neighbourhood of a folded hinge's image lies on the same side of both faces of that taco.
- **Taco-taco:** two tacos whose creases coincide on the table must not interleave.
- **Hinge closure.**
- **Connectivity.**

Necessity and sufficiency are cited to Hull §6.5 (Prop. 6.13); physical realizability to Demaine Thm 11.6.2 (`:428-446`). The face-to-point ordering equivalence (`lem-face-points`) has a pending proof (`:456-471`).

**Kernel.** `spec/KERNEL.md` and `packages/core/lib/fold_state.ml`:

- **Single choke point.** `t` is abstract and `make` is the only constructor (`KERNEL.md:50-56`).
- **What `make` checks** (`fold_state.ml:258-368`):
  - structural sanity: indices, rank is a permutation, angle in {0, ±1}, non-degenerate lines;
  - connectivity, through the walk in `derive_isos` (`:123-147`);
  - each hinge is a positive-length shared edge, with its two faces in opposite closed half-planes (`:157-195`);
  - cycle closure: every hinge must satisfy `iso(fb) = iso(fa) ∘ motion` (`:282-288`);
  - taco-tortilla: for each folded hinge and each face c ranked strictly between its two faces, fail if the hinge's table segment crosses the interior of c (`:305-317`);
  - taco-taco: for each pair of folded hinges with collinear, overlapping table segments, fail if the rank-betweenness parity differs (`:320-332`);
  - a third, "flat-hinge" taco-tortilla variant: a folded hinge collinear with a flat hinge whose faces sit inside the taco's mouth. It was added after a "ghost" state in the two-ear fish base (`:333-355`).
- **Total rank instead of λ.** No transitivity check and no tortilla-tortilla check are needed, because the order is a single ranking that can't contain a cycle. The cost is the cyclic-layering ceiling (`KERNEL.md:77-90`). That section links "issue #83", but GitHub #83 is now an unrelated docs issue. The real issues are **#3** (cyclic layerings) and **#72** (store a pairwise relation).
- **Refinement is not quotiented.** A `mark` adds faces, and states are compared by geometry (`KERNEL.md:71-75`).
- **Cost** (my reading of the code; nothing measured):
  - `derive_isos` is O(N·H): every face popped from the queue scans every hinge.
  - taco-tortilla is O(H·N) segment-versus-polygon tests.
  - taco-taco is O(H²), done twice (folded×folded and folded×flat).
  - every emitted frame computes overlap for all N² face pairs. Issue #41 measured this at about 21% of the crane's native profile.
- **Possible over-strictness I noticed (not verified):** the taco-taco check does not require the four faces to actually overlap near the shared segment (`:325-330`). Two tacos on the same line that open to opposite sides would be rejected whenever the rank happens to interleave them. Flat-Folder's cell-based constraints don't have this problem.

## 2. Reflection of blocks, fold closure, unfold, flip, side selection

**Block reflection** (`def-reflection`, `MODEL.md:1073-1106`):

- First score the axis ℓ, so every face lies on one side.
- A block is a set of faces on side H plus a placement: top, bottom, over T, or under T, where T is a set of stationary faces.
- Moving faces get ρ∘f. Within a block, the order of each pair is swapped. Stationary pairs keep their order.
- A block face against a stationary face: top means above, bottom means below. `over T` means above, unless the stationary face lies above every face of T it overlaps.
- Two blocks are ordered by their placements; pairs the placements can't order are outside the domain.
- The candidate is accepted only if it passes the validity checks.

**Hinge toggle** (`lem-toggle`, `:1127-1142`). A hinge on ℓ between a moving face and a stationary face toggles: flat becomes folded, folded becomes flat. A hinge off ℓ between a moving and a stationary face makes the folding map discontinuous (a tear).

**`def-fold`** (`:1150-1173`):

- Inputs: line, side H, optional depth flap δ, placement.
- The moving set M is the least set of candidates (faces in H) that contains δ's faces in H — or every candidate if there is no δ — and is closed under two rules:
  - **hinge closure:** a candidate joined to M by any hinge not lying on ℓ joins M;
  - **outward closure:** for top, any candidate lying above a member of M joins; for bottom, below. For `under T`, a candidate joins if it is above a member of M and below every face of T it overlaps; `over T` is the mirror. ADR 0052 added this bounded closure.
- The crease a fold scores is only the hinges on ℓ between M and stationary faces.

**Kernel version of the fold:**

- `default_scope` / `select_scope` (`fold_state.ml:1581-1714`) work on *parent* faces that have a piece on the moving side.
- "Outer" is tested between the pieces on the moving side only (`:1599-1601`).
- They add a **cohesion** rule: any candidate in the same flap (connected through flat hinges, anywhere in the state) also moves (`:1665`). That is broader than the model's off-axis hinge closure. For a U-shaped flap it forces both arms to fold together.
- `fold_blocks` (`:881-1063`):
  - cuts only the block's parents; stationary faces that cross ℓ are not scored;
  - adds one new folded hinge per cut parent;
  - toggles carried hinges that lie on the axis with exactly one moving side (`:966-1003`);
  - rebuilds the rank: stationary faces keep their order, each block's movers are reversed and spliced in at the placement (`:1006-1043`);
  - picks a stationary child as the new root, so the base stays put (`:1044-1060`).

**Top/bottom simple folds and the "hinge wraps a stationary layer" worry.** `rem-simple-fold` (`:1255-1267`) says outward closure is the condition that the 180° rotation imposes. It explicitly does *not* claim that a valid end state is reachable by rigid rotation. `lem-fold-closed` (`:1269-1281`) — hinge closure implies the other three conditions — has a pending proof.

In the kernel, a validation failure on a default fold is treated as an internal bug, not a user error (`fold_state.mli`, construction-ops note; `Fold_state.fold` calls `fail_of_violation`). A search of the issues for "pierce" found no report of a default fold failing; the only hit was #203, which is about placed folds.

The repo also shows the outward-closure rule is load-bearing. `test_fold_blocks_bottom_pierces` (`tests/test_fold_state.ml:1532-1542`) moves only the top layer with a `bottom` placement — not outward-closed — and taco-tortilla rejects it.

**`def-unfold`** (`:1283-1299`, ADR 0053):

- Its axis must be an existing crease. All the paper may lie on one side of it.
- The moving set is chosen by:
  - `moving p up|down`: grow outward from p's flap;
  - `up to`: a deeper flap to grow from;
  - `toward p` alone: the layer that stays, grown inward; everything else on that side moves.
- It reflects one block top or bottom.
- It is defined only if every hinge on the axis between moving and staying faces is folded, and at least one exists. All of those open (`cor-unfold-opens`).
- `fold` refuses a line only when all the paper is on one side (`action.ml:29-35`).

**`flip`.** The state becomes (ρ∘f, λ reversed); letters are unchanged and every face changes up/down (`MODEL.md:1333-1352`). The kernel reflects across the footprint's vertical centre line, absorbs it into the base, reverses the face array and reverses the rank (`fold_state.ml:1285-1315`).

**Which side moves** (`def-selection`, `MODEL.md:645-716`; ADR 0031):

- `toward x` names the side that **stays**; `moving x` names the side that folds over. If both are given and contradict, the fold fails.
- With neither, the side is the one that alone carries out the construction; if both sides do, the side of the first object in the first alignment.
- The kernel falls back to the error "this fold needs `moving .p`" (`action.ml:53-57`).
- By ADR 0036, `moving` names a side only. It does not narrow the layers.

## 3. Reverse fold

`def-reverse` (`MODEL.md:1364-1385`, ADR 0043, which supersedes 0042):

- **Tip.** The anchor's faces beyond the axis, closed under hinges of any angle whose table segment reaches past the axis (kernel: `resolve.ml:1062-1104`).
- **Opening.** A cut between two neighbouring tip layers in the rank order where every hinge crossing the cut is folded, all of them lie on one table line (the "spine"), and at least one reaches past the axis (`fold_state.ml:1145-1175`). Candidates are found by scanning the tip's rank, so there are at most (tip layers − 1).
- **Bodies.** The stationary faces each block is hinged to along the axis. In the kernel, these are the block parents the axis cuts (`:1177-1179`).
  - Both bodies must be non-empty.
  - In the model they must be "separated"; the kernel instead requires that the bodies' rank ranges do not overlap at all, which is stricter (`KERNEL.md:399-403`).
- **Placements.**
  - Inside: lower block `over` the top of its body, upper block `under` the bottom of its body.
  - Outside: lower block `bottom`, upper block `top`.
  - Both blocks are reflected in one `fold_blocks` call (`:1203-1211`). Doing them one after the other would tear the paper.
- **Letters** (`cor-reverse-letters`, `MODEL.md:1466-1486`). Hinges across the opening flip their letter; other tip hinges keep theirs; the new axis hinges read the spine's old letter for inside and the opposite for outside.
- **Ambiguity.**
  - Openings that give identical relations count as one state. The kernel then keeps the one minimising the summed rank distance of the new axis hinges (`fold_state.ml:1229-1261`).
  - More than one distinct state is an error that suggests a letter item per opening, such as `(--e & .q valley)`. The square folded twice the same way has two openings (`spec/BELOCH-WRITES.md`, "the tip opens at 2 places"). The crane's neck, tail and head have one each (ADR 0043).
- **Spec says fan, kernel says blocks.** The spec describes a reverse as a fan at the point where the axis meets the spine, which may be off the paper or at infinity (ADR 0041). The kernel still folds it by openings and blocks; moving it onto the fan path is issue #137 (open).
- My triple test above confirms that cross-block pairs keep their absolute order (21 of 25 flips). **A reverse fold does need triple updates.**

## 4. Flatten / fan

**`def-flatten`** (`MODEL.md:1488-1566`; ADRs 0037, 0040, 0041, 0044, 0048):

- **Vertex and anchor.** A vertex O on the projective table; an anchor flap, which defaults to the topmost flap under O, or the one `on` names.
- **Rays and closure.**
  - Even ray count: the composed reflections must be the identity (Kawasaki).
  - Odd ray count: the composition is a reflection, and each half-line of its axis that falls in a gap is an "emergent" ray candidate.
  - Closure applies only where the anchor surrounds O on the paper.
- **Stayer.** One sector, named with `staying` points. The kernel requires exactly one sector to contain all of them.
- **Tip.** Pieces outside the stayer's sector that are joined to the anchor through hinges between candidate pieces. Separate flaps stay put.
- **Motion of each piece** (ADR 0044, Hull Def 6.5). It is the product of reflections across the "changing" hinges on a paper path from the stayer.
  - A flat ray hinge always changes (folds).
  - A folded ray hinge may keep or open (open = squash).
  - Another crease lying on a ray may keep, turn or open.
  - A combination counts only if every path gives the same motion.
- **Selection** among candidates: letters, `over` constraints, then `toward`.

**Kernel enumeration** (`KERNEL.md:279-380`; `collapse.ml`). Every candidate is checked by `make`. The nesting is:

```
segment combinations
  × candidate fans (one per emergent-ray choice)
    × admissible stayer sectors
      × Maekawa-consistent letter patterns
        × 2^h keep/change choices (h = optional hinges)   — "the work doubles with each" (KERNEL.md:175-185)
          × every linear extension of the stacking units   — linear_extensions, collapse.ml:182-215
```

- Results are deduplicated by stacking signature (`:1069-1081`).
- A realization survives only if every face stays inside the convex hull of the previous state (`collapse.ml:1085-1126`, ADR 0046). This is a disambiguation heuristic, not a validity rule. Without it, six corpus programs stop as ambiguous.
- `toward` still runs three convention stages: material toward the point, fewest mountains, material on top. Issue #99 (open) plans to replace them with "fail and suggest".
- There are 20 numbered checks, each with its exact message and hint (`KERNEL.md:206-266`).

**Named manoeuvres as fans:**

- **Preliminary base:** one 6-ray flatten (`tests/cases/bases/preliminary.bel`). Six rays admit 18 flat letter assignments (issue #52 comment).
- **Squash:** a fan that opens the spine. For one flap of the preliminary base it is an 8-ray fan and reports 14 layer orders (#52). Built on a folded base in `collapse/flatten-squash-on-folded-base.bel`. The short form `squash (--h onto --ac)` (ADR 0038) is not built yet (#115).
- **Rabbit ear:** a 3-ray flatten with an emergent ray (`collapse/flatten-rabbit-ear-*.bel`).
- **Swivel:** `bases/swivel-rabbit.bel`, where the emergent ray can't be constructed by any axiom.
- **Petal:** needs fans at several vertices at once (rung 5) and is unsupported. The crane does it as two reverses and a fold.

**Limits:**

- One vertex only (#231: two vertices joined by a crease fails with "crease ends inside the sheet").
- No way to widen a fan to separate flaps (ADR 0037, #161).
- A spine with both ends inside the paper is unresolved (ADR 0038).
- Scoring is narrower than the model (`KERNEL.md:143-153`).
- Faces in the stayer's sector that the tip hangs from rank as one block, so the tip can't land between them (`:196-198`).
- The emergent ray is derived even where the anchor doesn't surround the vertex (#174).
- Duplicate realizations sometimes slip through dedup (#8).
- Known failing cases (`scripts/known-failures.txt`, #11): `bel_assert 3`, `flatten 1`.

## 5. Letters, crease provenance, FOLD export

**Letters.** `def-letter` (`MODEL.md:1051-1057`): of the two faces on a folded hinge, the face-up one (orientation-preserving isometry) decides it. Valley if the face-up face is below, mountain if above. The kernel's `mv` (`fold_state.ml:399-402`) does exactly that.

- `cor-fold-letters` (`:1229-1240`): a top-placed fold makes valleys on layers that were face-up and mountains on face-down layers. So letters alternate through the stack, as round 1 hypothesised.
- Placed (tuck) folds have no fixed rule (`:1242-1244`).
- The mountain/valley intent on a `mark` is stored only as an annotation (`mintent`).

**Provenance:**

- Each write mints one crease id. A reverse gives both halves one id. `into --l` adds material to an existing crease.
- FOLD `beloch:edges` records, per crease edge, the index into `beloch:statements`, the span, the axiom or verb, source names and the name (`spec/FOLD.md`).
- Lesson recorded in `notes/antipatterns.md`: join on a statement index; a frame counter or source line is not a unique key.

**FOLD export** (`spec/FOLD.md`):

- Frame 0 is the crease pattern in paper coordinates, with `edges_foldAngle` taken from the final state.
- `file_frames` holds one `foldedForm` frame per write: table coordinates, derived `edges_assignment`, `faceOrders` (sign relative to the second face's normal, `fold_emit.ml:232-249`), and `beloch:faces_matrix`.
- `--trace` adds every candidate with `removed_by` and a full candidate frame (reverse openings with spine, halves and bodies; flatten states with rays, emergent ray and stayer). That is ideal input for an "ambiguity picker" UI.
- Coordinates are written at full double precision (bird base: `0.7928932188134524` = (3−√2)/2).

## 6. Default fold scope: what changed and why

1. **Before 2026-07-20 the default moved every layer on the anchor's side.** An ear fold swept up about half the model. Narrowing it hit a catch-22: the tip you would grab lies on a crease shared by two flaps, and `#[...]` "straddles the fold axis". The fix proposed a prefix-to-anchor default: the outside-contiguous layers down to and including the anchor's flap (`notes/2026-07-20-default-fold-scope.md`).
2. **ADR 0031 (2026-09-27):** `moving` names both the side and the flap that moves.
3. **ADR 0036 (2026-09-29) reversed this back to every layer on the moving side.** `moving` names a side only; `up to` narrows. Reasons:
   - A folder presses a crease through the whole stack.
   - The book-fold corner bisector needed two helper points per fold.
   - `mark` and `fold` should read an axis the same way.
   - Consequence: programs that relied on narrowing gained `up to`. The test `fold/ear-default-scope.bel` now expects 13 faces.
4. **ADR 0037:** fans move only their tip. Otherwise squashing one flap of the preliminary base squashes front and back together, which the kernel accepts silently with 24 layer orders.
5. **ADR 0040:** a fan's default anchor is the topmost flap; `on` picks another.
6. **ADR 0048:** `staying` names a sector by points. The rectangle waterbomb on one layer versus both layers can only be told apart that way.
7. **ADR 0052:** placed folds take the layers between the depth and the target (jumping frog step 13 had failed with "would pierce layer 11").
8. **ADR 0053:** `unfold` exists (frog step 8, bird step 14).

**Still unsupported by any rule:** turning a flap that stands between two others (#208, flapping bird step 14).

Pattern worth noting: about 18 ADRs in roughly 5 days, with two outright reversals (0031→0036 and 0042→0043).

## 7. Exactness

**The history:**

- **ADR 0008:** rationals via zarith. f64+ε was rejected *a priori* — fuzziness and accumulated error — not after a measured trial.
- **ADR 0010:** a nested tower of square roots (archived).
- **ADR 0012:** real-algebraic numbers as isolating intervals plus resultants. Cubics from axiom 7 force it (the irreducible case).
- **ADR 0013:** FLINT 3.6 `qqbar` for irrational values. A pure-OCaml fast path handles a single extension field of degree ≤ 3, later ≤ 4.

**Why they rejected floats.** `notes/ideas.md`, "Approx mode?": origami is dense in engineered coincidences, so floats would give "silently wrong topology". The note recommends a float interval filter over the exact kernel instead.

**Performance:**

- README benchmark: 0.13–0.24 s for 10–30-statement programs (fish base, rabbit ear, swivel, cube root).
- Crane, before PR #38: 373 s through step 16.
- Crane, after PRs #38/#39 (LLL precision ladder, cached field embeddings, degree-4 generators): **2.01 s native through step 17**, and **112 s in the browser bundle** under bun, against an 8 s budget (`packages/runtime/eval/src/index.ts:27-28`).
- In the browser, 77–78% of time is in `ml_z_gcd`: big-integer rational arithmetic in JavaScript (PR #39).
- Stacked cubics: `stacked:6` takes 6.6 s; `stacked:7` "WALLS" (`packages/core/bench/README.md`).
- Effect of the trade-off: the README says the browser playground cannot evaluate the crane yet.

**What I measured against this.** In my run, Flat-Folder in f64 reproduced Beloch's exact geometry for all 105 frames to within 1.6e-15 (60 faces maximum). Scale beyond that is untested.

## 8. Sinks, tucks, crimps, pleats, swivels

- **Sinks:** not implemented.
  - The "primitive ladder" (`notes/2026-09-25-primitive-ladder.md`) classifies a sink as rung 5: several vertices, one existing crease turns. Fisher writes it as four reverse creases plus a ring of new ones.
  - ADR 0050 counts a sink as "flat in, flat out, 3D in the hands", computed as states, not motions.
  - No issue tracks sinks; there are no tests or rejected designs.
  - Nothing on unsink, open versus closed sinks, or swivels as a primitive beyond the odd-ray fan.
- **Tucks:** placed folds `under` / `over` (`fold/tuck-under.bel`, `tuck-over.bel`, `tuck-pierce.bel`, samurai-helmet step 7).
- **Pleats and crimps:** the ladder note says they need no primitive — a pleat is two simple folds, a crimp two reverse folds, so at most a `def`. The jumping-frog draft (PR #204) folds its pleats from plain folds.
- **Swivel:** `bases/swivel-rabbit.bel`.

## 9. Tests and example programs usable as fixtures (all MIT)

**Programs.** 185 `.bel` cases under `packages/core/tests/cases/`. Assertions are written as `; assert`: face count, step count, point positions in table or paper coordinates, crease letters, and `expect error`. There are no layer-order assertions.

| folder | files | of which `expect error` |
|---|---|---|
| bases | 7 | 0 |
| collapse | 31 | 12 |
| fold | 40 | 8 |
| reverse | 7 | 2 |
| unfold | 5 | 1 |
| select | 34 | 10 |
| sheet | 29 | 21 |
| construct | 17 | 4 |
| mark | 9 | 3 |
| meet | 5 | 2 |
| inspect | 1 | 0 |

Ones worth porting first:

- `bases/`: preliminary (6 faces), preliminary-reverse (6 faces; `--bd` mountain, `--h`/`--v` valley), bird-base (14 faces; all corners at (1,1); checked against Ida's O₈ in `notes/2026-09-12-bird-base-oracle.md`), bird-base-petal (16), fish-base (12), kite, swivel-rabbit.
- `collapse/flatten-waterbomb-{top-layer, both-layers, rays-on-top-layer, emergent-on-top-layer}.bel` (7 or 12 faces, on a 2:1 rectangle).
- `flatten-squash-on-folded-base.bel` (12 faces) and the `rabbit-ear-*` variants.
- `reverse/`: inside/outside two-layer, outside parallel axis, bird-base.
- `fold/`: `tuck-*`, `up-to-hinged-layer.bel`, `crane-leg-narrowing.bel`.
- `unfold/` (5).

**Models in `examples/`:**

- crane: 16 writes, 60 faces, Ida Fig. 7.19, checked in `notes/2026-09-25-crane-oracle.md`
- cicada: 10 folds, 38 faces
- penguin: 14 faces
- samurai helmet: 18 faces
- Drafts on branches: traditional frog (PR #210), flapping bird (#209, to step 13), jumping frog (#204, to step 16).

**FOLD fixtures.** 56 distinct files under `packages/render-2d/*/test/fixtures`, `packages/runtime/*/test/fixtures` and `packages/www/src/lib/fixtures`. Highlights: `crane.fold`, `bird-base.fold` (8 frames), `bird-base-petal.fold` (10), `inside-reverse.fold` / `outside-reverse.fold` (5 each), `shrink.fold` (16 faces, 120 pairs), and `trace-*.fold`, which carry candidate traces.

- All passed Flat-Folder verification.
- Caveats:
  - They are renderer fixtures and some are stale (`beloch 0.3.0-dev` / `0.4.0`).
  - Older ones lack `edges_faces`.
  - Our face indices will differ, so compare up to refinement by matching faces on paper centroid, as `verify-beloch-fold.mjs` does.
- The constructions must be hand-translated into our line, side and depth inputs.

## 10. Feasibility as a differential oracle

- **Native build.** Needs OCaml with dune, menhir, sedlex, zarith and yojson, plus FLINT 3.6.0 (the flake overrides nixpkgs' 3.5), GMP and MPFR. The supported route is Nix: `nix run github:tophcodes/beloch -- fold program.bel` prints the FOLD JSON; `--trace` adds candidates.
  - On this machine: no nix, opam, ocaml or dune. Homebrew has gmp and mpfr but not flint. Nothing was installed.
  - Cost: a system-wide Nix install (or opam plus brew flint); then about 2 s per crane-sized program.
- **Browser bundle, no toolchain.** Committed build artifacts under `packages/www/public/beloch/`: `beloch-eval.js` (478,981 B, js_of_ocaml) and `qqbar-wasm.js` (6,032,829 B, FLINT compiled to wasm).
  - The entry is a global `belochFoldString(src)` returning `{ok, fold}` JSON (`packages/eval-web/beloch_web.ml`).
  - A Node harness — load both as classic scripts, then set `globalThis.__beloch_qqbar_wasm = await QqbarWasm()` — looks feasible from the loader contract (`packages/eval-web/qqbar_shim.js`).
  - I did **not** execute this third-party compiled code.
  - Risks: the bundle is rebuilt by hand and may lag `main` (PRs #38/#39 note manual rebuilds), and it is slow (crane 112 s).
- **Zero-build route, recommended now.** Use the committed FOLD fixtures plus the `.bel` assertions as goldens, and run Flat-Folder as the independent validity check on our own outputs, with the verifier above.

## 11. Known bugs, limits, maturity

**Signals:**

- Repo created 2026-09-21; history migrated from `beloch-archive`. 2 stars, 75 open issues, last push 2026-10-06.
- Much of the code and docs is authored by Claude sessions; programs carry `@author "Claude (Anthropic)"`.
- Model §5 is a draft and §6 is unwritten. Two lemmas have pending proofs: `lem-fold-closed` and `lem-face-points`.

**Open issues and ceilings, by number:**

| issue | what |
|---|---|
| #3 / #72 | cyclic layering (rank ceiling) |
| #11 | known failing cases |
| #8 | duplicate flatten realizations |
| #99 | flatten selection still by convention |
| #137 | reverse not yet on the fan path |
| #115 | `squash` short form not built |
| #161 | fan order against flaps outside its anchor |
| #174 | emergent ray derived where it shouldn't be |
| #208 | flap standing between two others |
| #231 | two-vertex collapse |
| #41 / #73 | overlap recomputed for all pairs every frame |
| #171 | no property tests of the state invariants |

Plus the documented kernel ceilings in `KERNEL.md:143-153`, `:196-198` and `:399-403`.

## Kamigami (github.com/jaygohel109/fold-origami, MIT)

Created 2026-10-07 (the same day as this report), 0 stars, 433-line `src/engine.js` plus a 1,004-line UI.

**How it works:**

- Each facet stores its own transform T and a real-valued global `layer` key — a total order (`engine.js:29-35`, `126-129`).
- The moving set is: centroid side, plus top or bottom N layers or N layers under the tap, plus adjacency closure across edges not on the line (`:132-146`). There is no outward closure for seeded subsets.
- Inside/outside reverse **and open sinks** use one code path: split the moving layers into an upper and lower half by distinct layer count (`:180-206`). That is a heuristic, not an opening analysis.
- Squash finds the spine as the longest edge joining the upper and lower halves off the hinge (`:215-276`).
- Petal is two inside reverses plus a valley fold, guarded by a 2e-3 symmetry tolerance (`:339-368`).
- The README says "no collision checking". The tests print numbers and assert nothing.

**What Beloch lacks and Kamigami has (UX ideas only, no engine ideas):**

- per-facet rotation "steps" for animating each fold, and `chain` to compose them (`:150-163`, `:320-337`);
- "pull out" a hidden flap: pick the inner layer with the smallest moving set that drags no outer layer (`:278-293`);
- tap-to-seed plus a layer-count control; 3D bends at any angle;
- tutorials that snap a drawn line to the intended line within 8° and 0.1 (`app.js:341-347`).

---

## What we should adopt, adapt, or avoid

**Adopt:**

1. **State shape.** Hinge graph in paper coordinates, one root plus a base isometry, and isometries derived by walking the graph, with a closure check on every hinge (`derive_isos` plus the `Hinge_not_closed` check). This kills tears and stale isometries by construction — the bug list in `notes/2026-07-15-folded-state-invariants-review.md`.
2. **One validating constructor.** Every operation (fold, reverse, fan, unfold, flip, mark) returns a candidate that goes through it, and on failure it returns a typed violation, not a crash.
3. **Letters derived** from face-up plus order, intent stored separately; write FOLD `faceOrders` with the second face's normal as the reference.
4. **Block reflection as the single motion primitive**, with top/bottom/over/under placements. Fold = 1 block, reverse = 2 blocks reflected together, unfold = 1 block with the toggle lemma, flip = global.
5. **Moving-set rules:**
   - all layers on the clicked side by default;
   - a depth seed ("up to" = our "top k at a point") with outward closure plus off-axis hinge closure;
   - placed folds bounded by the target;
   - a fan moves only its tip.
6. **Reverse-fold openings** read from the tip's layer order, with inside/outside mapped to placements, states deduplicated by relation, and the user asked to choose when ambiguous.
7. **Fan motions along paper paths** with keep / turn / open per hinge, Kawasaki only where the paper surrounds the vertex, and the stayer chosen by sector.
8. **Trace-style candidate frames** for an ambiguity picker, and per-edge statement provenance for history and diagrams.
9. **The fixtures:** the 56 FOLD files, the `.bel` corpus, the Ida-checked bird base and crane — plus Flat-Folder verification in our CI.

**Adapt:**

1. **Pairwise λ instead of a rank.** It supports cyclic layerings. The simple-fold update rules hold on Beloch's data: 47/47 moving–moving pairs and 125 stationary pairs unchanged. Reverse folds and fans must recompute cross-block pairs (21/25 flipped).
2. **Validity checks on a pairwise relation.** Use Flat-Folder-style cell constraints so taco-taco requires the faces to actually overlap. Beloch's rank-betweenness version may over-reject.
3. **f64 instead of exact arithmetic.** Beloch's concern about coincidences is real. Keep our single relative tolerance, the per-edge-parameter vertex creation and snapping, and possibly their idea of exact predicates behind a float filter. But exact algebra is ruled out by their own browser numbers: 112 s for the crane against an 8 s budget.
4. **Language selectors become gestures:**
   - `moving` / `toward` → click the side;
   - `up to` → pick a layer in a stack inspector;
   - `over` / `under` → pick a target flap;
   - letters for reverse ambiguity → pick an opening;
   - `staying` → hold a sector.
   Prefer showing candidates over errors.
5. **Fan stacking search.** Replace Beloch's brute-force enumeration (rankings × letter patterns × 2^h) with constraint propagation to complete a partial order, as Flat-Folder already does. Treat the convex-hull bound (ADR 0046) as a ranking heuristic, never as validity.

**Avoid:**

1. A stored total rank (Beloch #3).
2. FLINT or exact algebra in an interactive browser path.
3. Resolving ambiguity by convention ("fewest mountains", toward-centroid). Beloch itself is retiring this (#99).
4. One control that sets both side and depth. Beloch reversed that coupling (ADR 0031 → 0036). The prefix-to-anchor default was also tried and reverted (07-20 note → ADR 0036).
5. Cohesion through stationary paper (the kernel's flap-cluster closure), unless a real model needs it.
6. Kamigami's half-split reverse/sink heuristics and its lack of validity checks.

## Open questions

1. **Can an outward-closed, hinge-closed top/bottom fold ever fail the validity checks?** Beloch has no proof (`lem-fold-closed` is pending) and no recorded counterexample. Its kernel would flag one as an internal bug. We need our own proof or a randomized fuzz using Flat-Folder as the judge — the generated-program fuzzing Beloch's open issue #171 proposes.
2. **Cohesion for U-shaped flaps.** Beloch's kernel cohesion (a whole flap moves together, even through stationary paper) differs from its model (off-axis hinges only). Which matches a folder's hand?
3. **Fans and reverses on a pairwise relation.** What is the update rule for a fan's moving pieces, and should fans be checked by completing with Flat-Folder rather than enumerating?
4. **A flap standing between two others** (#208), multi-vertex collapses (#231, petal, sink): neither Beloch nor Kamigami has a model for these. They need fans at several vertices with keep/turn/open choices.
5. **Oracle choice.** Is it worth running Beloch's committed browser bundle under Node as a live differential oracle? It needs an explicit decision to execute third-party code, and it can be stale and slow. The alternative is to stay with FOLD goldens plus Flat-Folder.

**Files** (all gitignored):
- `artifacts/fold-spike/beloch/` — Beloch clone
- `artifacts/fold-spike/kamigami/` — Kamigami source
- `artifacts/fold-spike/beloch-oracle/verify-beloch-fold.mjs`
- `artifacts/fold-spike/beloch-oracle/triple-invariance.mjs`
- `artifacts/fold-spike/beloch-oracle/all-results.jsonl`
- `artifacts/fold-spike/beloch-src/issues.tsv` — issue list
- `artifacts/fold-spike/beloch-src/tree.txt` — repo tree
