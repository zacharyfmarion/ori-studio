# Fold workspace: the theory a correct engine needs (research report)

Legend: **[V]** means I read it in the cited source or file. **[I]** means it is my own reasoning or derivation and no source states it. Code paths are relative to the worktree root.

## Summary

- **The axioms are complete and small.** Alperin and Lang prove that the seven Huzita–Justin operations are every possible way to fix one fold line by aligning points and lines [V]. Solution counts: O1, O2 and O4 give exactly 1; O3 gives 1 or 2; O5 gives 0–2; O6 gives 0–3 (a cubic); O7 gives 0 or 1. O1 and O4 fix the line from incidence alone. O2, O3, O5, O6 and O7 bring a moving feature onto a stationary one, so on a folded sheet they also need to know which layers move [I].
- **"Fold through some layers" already has a formal definition.** Akitaya, Demaine and Ku (JIP 2017) define a simple fold as an operation on a flat folding (Σ, f, λ): crease set Σ, isometry f, layer order λ. It is parameterized by a directed fold axis and a folded region U, with seven conditions [V]. The one-layer, some-layers and all-layers models only limit how many layers may fold at each point of the axis [V]. This is the right V0 model.
- **The user does not get to pick the moving layers freely.** U must be a union of connected pieces of the paper cut along the preimage of the fold line. On the moving side it must also be a top set (valley) or bottom set (mountain) of the stack [I, from conditions 1 and 6]. Once U is fixed, the new creases, their M/V and the new layer order are all determined [I]. The result still has to be validated, because conditions 1–7 do not rule out a hinge wrapping around a stationary layer [I].
- **Store layer order as pairwise orders between overlapping faces.** Validate them with the five constraint families from Akitaya, Demaine and Ku (2024): antisymmetry, transitivity, taco-taco, taco-tortilla and tortilla-tortilla. These are exactly what Flat-Folder uses, and Flat-Folder is already ported in `crates/treemaker-flatfold` [V]. Do not use one global z-index per face: the FOLD spec says face orders can have cycles, for example in a square twist [V].
- **Crease M/V follows from the folded state.** It is a function of one adjacent face's flip and the relative order of the two faces (`third_party/flat-folder/src/solver.js:181-192`) [V]. So a fold type does not need its own M/V rules. It only has to say which faces move, about which axes, and where they go in the stack; the crease pattern changes are then derived [I]. **This is the main architectural lever.**
- **Compound folds have no formal definitions in the literature I found.** Ida and Takahashi model squash, reverse, rabbit-ear and crimp folds as "cut a crease, do simple folds, glue it back" [V]. Akitaya's ORIZU models maneuvers as graph-rewriting rules on the crease pattern [V]. The signatures in §4 are mostly derived [I], and several need checking against fixtures.
- **Reachability is hard, so validate steps rather than search for sequences.** In 1D, flat-foldable ⇔ simple-foldable [V]. Map folding by simple folds takes linear time [V], but slight generalizations are strongly NP-complete [V]. General flat-foldability is NP-hard [V]. Checking a given layer order takes O(n³) [V]. Every valid flat state can be reached by some continuous motion [V].

## 1. Axioms

### 1.1 History and statements [V]

- Justin listed seven operations: "Résolution par le pliage de l'équation du troisième degré…", *L'Ouvert* 42 (1986), and Proc. 1st Int. Meeting of Origami Science & Technology (1989), pp. 251–261. These citations are from the reference lists in [Alperin–Lang](https://websites.math.leidenuniv.nl/edixhoven/talks/2017/2017_03_27origami_LiOdag/o4_multifold_axioms.pdf) and [Ida–Takahashi](https://arxiv.org/pdf/2201.00536).
- Huzita listed six in the same 1989 proceedings, pp. 143–158.
- Hatori rediscovered O7. The date is reported inconsistently: Alperin–Lang's text says 2001 (citing his 2002 web page), Lang's [constructions PDF](https://langorigami.com/wp-content/uploads/2015/09/origami_constructions.pdf) says 2003, and [Wikipedia](https://en.wikipedia.org/wiki/Huzita%E2%80%93Hatori_axioms) says 2001/2002.
- Alperin & Lang, "One-, Two-, and Multi-Fold Origami Axioms", *Origami⁴* (2009), pp. 371–393, describe their proof as "the first public complete proof" of completeness.

The statements, in Alperin–Lang's wording, paraphrased:
- **O1:** fold a line through p1 and p2.
- **O2:** fold p1 onto p2.
- **O3:** fold l1 onto l2.
- **O4:** fold perpendicular to l1 through p1.
- **O5:** fold p1 onto l1 with the fold passing through p2.
- **O6:** fold p1 onto l1 and p2 onto l2 at the same time.
- **O7:** fold p1 onto l1 with the fold perpendicular to l2.

### 1.2 Why the list is complete [V]

A fold line has two degrees of freedom. Alperin–Lang define five alignments:
- **A1:** F(P1)↔P2 (two equations)
- **A2:** F(L1)↔L2 (two equations)
- **A3:** F(L)↔L, a line folded onto itself (one equation)
- **A4:** F(P)↔L, a point folded onto a line (one equation; the same as folding the line onto the point)
- **A5:** the fold line passes through P (one equation; Justin wrote this as F(P)↔P)

A single two-equation alignment fixes the line: A1 is O2 and A2 is O3. Pairs of one-equation alignments give the rest: A5+A5 = O1, A3+A5 = O4, A4+A5 = O5, A4+A4 = O6 and A3+A4 = O7. A3+A3 is inconsistent when the lines cross and redundant when they are parallel.

They restrict alignments to ones that can be checked "on a finite region": parallelism is excluded. Lang's PDF adds that an alignment must be between a moving feature and a stationary one, or between a feature and the fold line.

### 1.3 Formulas and solution counts

Notation: a line is `{x : u·x = d}` with |u| = 1 (ReferenceFinder's `XYLine`). Reflection is `R(p) = p + 2(d − u·p)u` (Lang eq. 62; `refLineP2LP2L.cpp:207`). `rot90(a,b) = (−b,a)`.

| Op | Construction | # solutions | Degenerate cases | ReferenceFinder (GPLv2) |
|---|---|---|---|---|
| O1 | u = rot90(p2−p1)/‖·‖, d = u·p1 | 1 | p1 = p2 → infinitely many | `refLineC2PC2P.cpp` |
| O2 | u = (p2−p1)/‖·‖, d = u·(p1+p2)/2 | 1 | p1 = p2 | `refLineP2P.cpp:27-28` [V] |
| O3 | Lines cross: u ∝ u1 ± u2, d = u·(l1∩l2). Parallel: u = u1, d = ½(d1 + d2·u2·u1) | 2 if crossing, 1 if parallel | coincident lines → O4-like family | `refLineL2L.cpp:37-50` [V] |
| O4 | u = rot90(u1), d = u·p1 | 1 | none | `refLineL2LC2P.cpp:29-30` [V] |
| O5 | a = d1 − u1·p2; b² = ‖p2−p1‖² − a²; p1′ = p2 + a·u1 ± b·rot90(u1); fold = perpendicular bisector of p1p1′ (passes through p2). This is circle ∩ line. | 0 (b² < 0), 1 (b² = 0), 2 | p1 ∈ l1 (one root is the identity; RF rejects); p1 = p2 | `refLineP2LC2P.cpp:37-47` [V] |
| O6 | Common tangent of two parabolas (foci p_i, directrices l_i). Parametrize p1′ = d1·u1 + r·rot90(u1); requiring R(p2) ∈ l2 gives a cubic in r. | 0–3 | Leading coefficient vanishes → quadratic or linear (RF lines 95-103); p_i ∈ l_i or identical inputs rejected | `refLineP2LP2L.cpp:78-198` [V] |
| O7 | n = direction of l2; d = (d1 + 2(p1·n)(n·u1) − p1·u1) / (2·n·u1) | 1, or 0 if l1 ∥ l2 | p1 ∈ l1 → infinitely many | `refLineL2LP2L.cpp:32-38` [V] |

Lang derives the O6 locus as a cubic curve. Any line l2 meets it at most three times, and can miss it [V, constructions PDF pp. 46–48].

He also notes a physical-realizability restriction. He assumes the points move and the lines stay put. Then for each solution the two points must lie on the same side of the fold line, which holds everywhere on the curve except inside its loop. So **only the part of the curve outside the loop can be folded** [V].

ReferenceFinder encodes the same idea: it records "who moves" from a same-side test (`refLineP2LP2L.cpp:221-243`). With `sVisibilityMatters` set, it also requires the moving feature to be on the paper's edge, because hidden alignments can't be checked on opaque paper [V].

RF solves the cubic with Cardano's formula (lines 133-166) [V]. That is numerically fragile near double roots; a robust solver (trig form or companion matrix, then Newton polishing) is preferable [I].

### 1.4 Axioms on an already-folded sheet [I]

The available points and lines are the folded images of crease-pattern vertices and edges (and paper boundary). They are finite segments, so each alignment must land on the actual segment. RF checks this with `Encloses`.

Each candidate line becomes a simple fold (§2). For the alignment operations, the engine must then check that the moving feature (p1) lies in the moving region U and its target (l1) does not.

O1 and O4 do not depend on which side moves. Multi-fold operations are out of scope: there are 489 distinct two-fold "axioms" (203 without the virtual-point alignment), and n−2 simultaneous folds solve degree-n equations [V, Alperin–Lang §4–5].

## 2. Simple folds

### 2.1 Arkin et al., "When Can You Fold a Map?" (CGTA 29(1), 2004; [arXiv cs/0011026](https://arxiv.org/pdf/cs/0011026v2)) [V]

All three models are defined in §2:
- **One-layer:** the crease partitions the *unfolded* paper into two parts A and B. A rotates ±180° about the crease, if the paper does not cross itself. This makes a single crease.
- **All-layers:** partition the *folded state* by the crease and rotate all layers of one side. "This type of fold can never cause the paper to cross itself."
- **Some-layers:** rotate "some of the top [bottom] layers of A" by +180° [−180°], provided the paper does not cross itself.

M/V convention: a mountain brings the bottom sides of the two adjacent facets together; a valley brings the top sides together.

### 2.2 Formal definition: Akitaya, Demaine & Ku, "Simple Folding is Really Hard" (JIP 25, 2017; [PDF](https://scripts.mit.edu/~jasonku/pdf/SIMPLEFOLDS_JIP.pdf); also in [Ku's thesis](https://erikdemaine.org/theses/jku.pdf)) [V]

A **flat folding** (P, Σ, f, λ) is a flat-fold isometry plus a layer order λ on pairs of overlapping facets, satisfying Justin-style conditions.

A **simple folding** of (P, Σ1, f1, λ1) is a flat folding (P, Σ2, f2, λ2) parameterized by a directed axis ℓ and a folded region U ⊊ P, such that:
1. ∂U ⊂ ∂P ∪ f1⁻¹(ℓ ∩ f1(P)).
2. Every point of U reflects across ℓ.
3. Σ1 ⊊ Σ2: existing creases never unfold.
4. Everything outside U is unchanged, in both position and order.
5. The layer order inside U is exactly reversed.
6. Before the fold, U lies entirely above or below the non-U points stacked with it, according to the side of ℓ.
7. After the fold, the same holds on the landing side.

The paper's own gloss: (1)–(2) make the move an isometry, (4)–(5) keep the orders consistent, and (6)–(7) prevent self-intersection.

The models are defined through #(q), the number of layers folded at each point q on the axis. #⁺(q) is the number of foldable layers there.

| Model | Restriction |
|---|---|
| Some-layers | none |
| One-layer | #(q) ∈ {0, 1} |
| All-layers | #(q) ∈ {0, #⁺(q)} |
| Infinite some-layers | #(q) ≥ 1 |
| Infinite one-layer | #(q) = 1 |
| Infinite all-layers | #(q) = #⁺(q) |

The infinite all-layers model is "fold everything on one side of the line" (Table 2).

Demaine & O'Rourke's *GFAL* covers this in §11.4 (folded states of 2D paper), §12.1 (1D flat foldings) and §14.1 (simple folds) [V, [table of contents](https://gfalop.org/contents.pdf)].

### 2.3 Exactly which layers move [I]

Let C = P \ f⁻¹(ℓ). This is the paper cut along the preimage of the fold line in every layer.
- Each connected piece of C maps into one open half-plane of ℓ (continuity).
- By condition (1), U is a union of these pieces, plus preimage chords inside U, which get no crease.
- Two layers joined by a folded crease that crosses ℓ are in the *same* piece. They must move together; this is Akitaya's "reflection pair".
- Condition (6) makes U ∩ (moving side) a top set of the stack for a front fold (a bottom set for a back fold). So **U = closure(seed pieces) under "anything on the moving side stacked above a moving piece must also move."**
- "Fold the top k layers at point x" therefore means: take those k pieces as seeds and close upward. The closure can include more layers than the user picked.
- New creases are f⁻¹(ℓ) ∩ ∂U \ ∂P. Each one is a whole chord of a face, so convex faces stay convex.
- The new order λ2 is fully determined by (4), (5) and (7): pairs inside U are reversed, pairs outside U are kept, and every mixed overlapping pair has U on top (valley) or underneath (mountain).

Conditions 1–7 are not enough on their own. Suppose a stationary layer t crosses ℓ and lies between a moving piece m and its hinge partner s. After the fold, the m–s crease wraps through t. That breaks taco-tortilla in the result, but (6) and (7) still hold. The definition does require the result to be a valid flat folding, so **the engine must validate the output state.**

### 2.4 What a simple fold looks like in the crease pattern

Akitaya's seminar paper ([CSSeminar](https://www.cgg.cs.tsukuba.ac.jp/~akitaya/CSSeminarAkitaya.pdf)) [V]:
- A multi-layer valley or mountain step adds several creases.
- Creases that share a vertex form "reflection pairs": an existing crease bisects their angle, and the pair has opposite M/V.
- A chain of such pairs that runs edge-to-edge or forms a cycle is a "complete reflection path", and removing it keeps local flat-foldability.

The opposite M/V follows from the assignment rule: on face-down layers, the same physical valley appears as M [I]. Creases inside U keep their assignment, because both faces flip and their order reverses [I].

### 2.5 Precreases, refolds and unfolds [I]

ADK's Σ contains only folded creases, and (3) forbids unfolding. Product needs differ:
- A **precrease** (fold and unfold) leaves a crease that is currently unfolded but has an intended M/V.
- Folding along a flat precrease turns it from F into M or V.
- Rotating a flap about an existing *folded* hinge by 180° unfolds that crease. This is the inverse of a simple fold.

So the engine needs a crease history separate from the folded crease set.

## 3. Layer ordering

- **NP-hardness.** Bern & Hayes (SODA 1996) proved assigned and unassigned flat-foldability NP-hard. [Box Pleating is Hard](https://scripts.mit.edu/~jasonku/pdf/BOXPLEATINGHARD_JCDCGG2015.pdf) (Akitaya, Cheung, Demaine, Horiyama, Hull, Ku, Tachi, Uehara, 2015) reports "an error in their crossover gadget" for the assigned case. It re-proves hardness for box-pleated patterns and introduces the taco/tortilla terminology [V].
- **Pointwise vs facewise definitions.** [Computing Flat-Folded States](https://erikdemaine.org/papers/FlatFolder_OSME2024/paper.pdf) (Akitaya, Demaine & Ku, OSME 2024) [V]:
  - GFAL Ch. 11 defines λ pointwise; that is infinite and not usable by an algorithm.
  - For crease patterns with convex faces, the paper defines a **facewise** order Λij ∈ {±1} on overlapping face pairs. It must satisfy: antisymmetry; transitivity (Λij, Λjk, Λki not all equal); tortilla-tortilla (a face overlapping an unfolded crease cannot sit between that crease's two faces); taco-tortilla (the same for a folded crease); and taco-taco (two overlapping folded creases nest or stack: Λik + Λjk + Λil + Λjl ≡ 0 mod 4).
  - Theorem 1: the facewise and pointwise definitions are equivalent.
  - Verification takes O(min{n²p, n²+mp²}) = O(n³), where p is the ply.
  - All solutions can be found in O(n³ + Σ tᵢ³ 2^tᵢ) by splitting into independent components.
  - The number of folded states is at most 2^O(n²).
- **Flat-Folder** (MIT license) encodes exactly these constraints. The pair maps and valid-state tables are at `third_party/flat-folder/src/constraints.js:6-31`; M/V seeds the initial order at `solver.js:181-192` [V]. The Rust port has the same families (`crates/treemaker-flatfold/src/constraints.rs:10-14`) and the inverse direction, `infer_edge_assignments_from_face_orders` (`lib.rs:189-215`) [V]. Eppstein gives an FPT algorithm in ply and treewidth, as cited by ADK 2024 [V].
- **FOLD representation.** `faceOrders` entries are `[f, g, s]`, with s relative to *g's normal*, and the spec says orders "may have cycles (e.g., in a square twist)" [V, [spec](https://github.com/edemaine/fold/blob/main/doc/spec.md)]. Two existing libraries use a single integer layer per face instead, and that cannot represent cyclic orders: Rabbit Ear's `flatFold` (`foldFacesLayer`, GPLv3) and the new Kamigami (MIT; README says "no collision checking") [V].
- **Face convexity.** At a flat-foldable interior vertex, every sector angle is under π, because the alternating sums equal π. So on convex paper, the faces of the *folded-crease* arrangement are convex [I]. Unfolded precrease polylines can create reflex corners. The engine should therefore build faces from folded creases only, and keep F creases as an overlay (or triangulate) [I].

## 4. Classical fold types

The working principle: each fold type is a map (moving regions, axes, where they are inserted) → new state. M/V comes from the flip-and-order rule [I].

| Fold | Crease-pattern change | Moving layers | Order change | Sources / confidence |
|---|---|---|---|---|
| Valley / mountain (one, some or all layers) | Add the hinge chords on every hinge layer. M/V alternates with each layer's flip (reflection pairs). Creases inside U keep their M/V. | U from the closure in §2.3 | Reverse inside U; U goes above (valley) or below (mountain) everything it lands on | ADK conditions [V]; Akitaya [V]; M/V invariance [I] |
| Inside reverse | "Two radial mountain folds… and a reversal of the central fold on the affected end" | The tip region, as two groups (upper and lower half of the flap) rotating in opposite senses about the same ℓ | Both tip groups go *between* the two halves; each is reversed internally. Upper-vs-lower tip order is kept, which is why the spine flips. | [Wikibooks](https://en.wikibooks.org/wiki/Origami/Techniques/Practice) [V]; Ida–Takahashi: cut spine, `MountainFold[above, ray, InsertFace->below]`, `ValleyFold[below, …]`, glue [V]; order [I] |
| Outside reverse | Two radial valleys; spine reverses on the tip | Same as inside, opposite senses | Tip groups wrap *outside* the flap | Wikibooks, Ida–Takahashi [V]; order [I] |
| Crimp (inside / outside) | Two reverse-fold pairs; the spine flips between the two lines and is restored beyond | Middle and tip sections | Middle section nests inside (or outside) | Ida–Takahashi: split, pleat each piece, glue [V]; details [I] |
| Pleat | Two simple folds (M + V) along two lines | Run sequentially as simple folds | As two simple folds | Ida–Takahashi [V] |
| Squash | New creases on the flap layers (a mirror pair about the squash axis); the spine changes status inside the squashed region | Flap layers, rotating about different axes | Flap layers spread side by side over the base | Ida–Takahashi: cut spine, two valley folds, an O2 fold, glue [V]. **The exact M/V and F changes are unverified: my Maekawa check on the double-triangle → preliminary-base case did not close** [I] |
| Spread squash | A squash that spreads around a base vertex ("wide splat") | Several layers around a vertex | — | [Wikipedia Yoshizawa–Randlett](https://en.wikipedia.org/wiki/Yoshizawa%E2%80%93Randlett_system) [V]; structure [I] |
| Rabbit ear | A degree-4 vertex inside a triangle: bisectors plus one crease to the edge; 3 creases of one type and 1 of the other | Faces rotating about different axes through one point | The ear lies on top | Ida–Takahashi: a face pair plus three rays from one point [V]; CP [I] |
| Petal | "Equivalent to two side-by-side rabbit ears"; the top layer swings about a horizontal hinge | Top layer and its sides | Top layer flips up | Wikipedia [V]; rest [I] |
| Swivel | One region rotates about a vertex until a raised edge lands on a fixed edge; "loosely defined" | Region at a vertex | — | Wikibooks, Wikipedia [V] |
| Open sink | The sink polygon (preimage around the point) becomes new creases; creases inside reverse | The whole point region, spread open | Region inverted | Wikibooks "reversing creases" [V]; "all interior creases flip" [I] |
| Closed sink | Same new creases; only *some* interior creases flip (those joining the two halves) | The point region as a unit, without opening | Nested taco: the outer layers wrap the inner ones | Practitioner [blog](https://blog.giladnaor.com/2008/08/origami-tip-folding-closed-sink.html) (weak) [V]; analysis [I]; Kamigami does not support it [V] |
| Unsink / unfold | Inverse of the above; creases become F | — | — | [I] |

ORIZU (Akitaya, Mitani, Kanamori & Fukui; [SIGGRAPH 2013 poster](https://history.siggraph.org/wp-content/uploads/2023/01/2013-Poster-47-Akitaya_Generating-Folding-Sequences-from-Crease-Patterns-of-Flat-Foldable-Origami.pdf), seminar) [V]:
- Each maneuver is a rewriting rule r: S → S′ on the crease-pattern graph, and unfolding applies r⁻¹.
- With inside and outside reverse, squash and petal folds plus simple folds, it can fold "most of traditional models".
- Cost explodes: one of its three examples took about 1,780 s and produced a step graph of 22,665 nodes.

## 5. Reachability results

- **1D:** flat-foldable ⇔ one-layer simple-foldable ⇔ some-layers simple-foldable, decided in O(n) via crimps and end folds (Arkin Cor. 3.1, Thm 3.2) [V]. Infinite all-layers 1D is also O(n) ([Akitaya et al., GC 2020](https://erikdemaine.org/papers/InfiniteSimpleFolds_GC/)) [V].
- **2D, simple folds:**
  - Rectangular paper with orthogonal creases (map folding): linear time in all three models (Arkin Thm 5.1) [V].
  - Orthogonal polygon paper: weakly NP-complete (Arkin) [V], strengthened to strongly NP-complete for one-, some- and all-layers (ADK 2017 Thm 1) [V].
  - Square paper with 45° creases, assigned or unassigned: strongly NP-complete for some-layers and all-layers [V].
  - Even approximating the maximum number of simple folds (MaxFold) is hard [V].
  - Infinite all-layers: linear time for orthogonal patterns on orthogonal paper, but strongly NP-complete with partial assignment on a rectangle [V].
  - Mixed assignments are classified in [arXiv 2306.00702](https://arxiv.org/abs/2306.00702) [V].
- **Simple folds are strictly weaker than general flat folding.** The crane cannot be made by simple folds, and Arkin's Fig. 9 shows maps that fold flat but not by simple folds [V]. General m×n map flat-foldability is open; 2×n is polynomial (Morgan 2012, per [Wikipedia](https://en.wikipedia.org/wiki/Map_folding)) [V].
- **General flat-foldability:** NP-hard. Checking a given layer order is in P; for a whole crease pattern, NP membership is open because of precision (sums of square roots) (ADK 2024) [V].
- **Motions:** every "well-behaved" flat state can be reached from the unfolded sheet by a continuous motion ([Demaine, Devadoss, Mitchell, O'Rourke 2004](https://erikdemaine.org/papers/PaperReachability_CCCG2004/)) [V]. This guarantees the end state, not that one local step can be performed [I].
- **Reconfiguration:** moving between flat states is PSPACE-complete even in a toy "flaps and flips" model ([Eppstein 2024](https://arxiv.org/abs/2410.07666)) [V].
- **Sequence finding:** both known approaches are exponential search, Akitaya et al.'s "Unfolding simple folds from crease patterns" (Origami⁶, which allows paper intersection) and ORIZU [V]. I found no result on deciding whether a given *state with its layer order* is reachable by simple folds.

## 6. Implications for our engine

1. **State.** Store:
   - a crease graph whose creases are folded M, folded V, unfolded (precrease with intended M/V) or boundary;
   - faces built from folded creases (convex);
   - for each face, a rigid transform plus a flip bit;
   - a facewise order Λ on overlapping pairs, kept in global "toward the viewer" terms and converted to FOLD's g-normal convention only at input/output.

   The invariant after every step is ADK 2024 validity plus Kawasaki and Maekawa.
2. **Simple fold (V0).** Steps:
   1. Map ℓ into every face and split.
   2. Find the pieces of C.
   3. Close the seed set into U (top or bottom closure).
   4. Reflect U.
   5. Compute λ2 by rules (4), (5) and (7).
   6. Derive M/V from flips and order.
   7. Validate only the constraints that touch changed faces.
   8. On failure, report the blocking layer.

   The result is deterministic, with no search.
3. **Compound folds.** Use one of two constructors:
   - (a) Several regions reflected rigidly with explicit insertion positions. This fits reverse folds and crimps (one axis per region).
   - (b) A crease-pattern diff, then recomputing f by walking the face graph, then completing Λ with Flat-Folder-style propagation. Unchanged pairs stay fixed, and remaining ambiguity is resolved by the user or a deterministic rule. This fits squash, petal, rabbit ear and sinks. Ida–Takahashi's cut and glue is a third way to build these.

   Every compound fold ends at the same validator.
4. **Axioms** generate 0–3 candidate lines from folded-image features. Choosing a line then runs a simple fold; alignment operations additionally check moving/stationary membership. Edge-only visibility can be an option.
5. **Reuse and licenses.**
   - `treemaker-flatfold` (port of MIT-licensed Flat-Folder) is the validator and completer.
   - ReferenceFinder is GPLv2. The repo is GPL too (`LICENSE.txt`), but AGENTS.md treats ReferenceFinder as a black box, so re-derive its formulas (§1.3) rather than port the code.
   - Rabbit Ear (GPLv3) and Kamigami (MIT) are ideas only; neither does collision or validity checking with a layer order that allows cycles.
6. **Diagram steps** should record the fold type, ℓ, seeds, U, direction and the crease-pattern diff. The arrows and symbols can be derived from those [I].

## Open questions / risks

- **Unverified signatures.** The exact crease and assignment changes for squash, petal, rabbit ear, spread squash and closed sink are not confirmed by a primary source; my squash parity check failed. Each needs a fixture checked by physical folding or against Lang's *Origami Design Secrets* (not read).
- **A valid end state does not prove the motion.** Validation checks the end state, not the motion of a compound fold (closed sinks especially). A step could be valid but not doable by the named maneuver.
- **Non-unique orders.** Compound folds can admit several valid orders, so a deterministic tie-break or a user prompt is needed.
- **Precision.** O6 roots and repeated multi-layer splits accumulate floating-point error. ADK note the precision question is open in theory. Snap vertices per shared edge, not per face, and solve the cubic robustly.
- **Faces with unfolded creases.** Unfolded creases can make faces non-convex, which breaks the facewise equivalence unless faces are built from folded creases only.
- **UI semantics vs theory.** "Fold the inner layer" is not a simple fold; it implies temporary opening, which we would need to define.
- **Cost of validation.** O(n³) worst case; it must be incremental as face counts grow with multi-layer folds.
- **Cyclic orders.** No global z-index exists in general, so rendering must use per-cell stacks.
- **Date discrepancy.** O7 is attributed to Hatori with dates of 2001, 2002 and 2003 in different sources; the attribution text should say so.
