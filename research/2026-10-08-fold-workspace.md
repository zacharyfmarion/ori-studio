# A Fold workspace: folding a sheet the way a person does

**Date:** 2026-10-08
**Question:** Can Ori Studio offer a workspace where you start from a flat
sheet, crease it with the Huzita–Justin axioms, and then fold the *folded*
form along a line through any number of layers — getting back, at every step,
the crease pattern that fold made and the flat folded form it leaves — built so
that reverse folds, squashes, petals, rabbit ears and sinks can follow?

**Verdict:** **Yes, and the core is smaller and better-founded than it looks.**

- **A plain valley or mountain fold has an exact, closed-form result.** The new
  crease pattern, the new face positions and the new layer order all follow
  from the previous state, the fold line, the side that moves, the direction,
  and the layers picked. No solver, no search.
  - Spike evidence: 52,937 randomly generated folds were checked independently
    by Flat-Folder and by a second, arrangement-free checker. No failure was
    attributable to the fold rule. 1,497 of those folds wrapped a hinge around
    layers that stay put (6,123 wrapped hinge edges, up to 133 layers deep) —
    the case [r1-theory.md](2026-10-08-fold-workspace/r1-theory.md) §2.3
    worried the rule might miss.
- **Every compound fold the spikes tried fits one pipeline:** score creases,
  change hinges, re-derive face positions from the crease pattern, carry the
  layer order of every pair that is stationary or inside one block the
  operation declares, seed the pairs between blocks by the operation's own
  rule, and let a constraint solver complete and check the rest. The solver
  sees the order *carried forward*, never a fresh guess.
  - The squash, petal and rabbit ear rebuilt the preliminary base and the bird
    base. Their folded creases matched Beloch's committed fixtures exactly.
  - Open and closed sinks are a block-placement rule on top of the plain-fold
    geometry. No surveyed tool validates sinks; this one did, with sharp
    preconditions.
- **The layer order is state and must be stored.** The crease pattern does not
  determine it. Given only its own crease pattern and letters, Flat-Folder found
  a unique layer order for just 46.7% of the spike's states.
- **Floating point is fine with two policies on top of one tolerance:** snap
  fold lines exactly through nearby landmarks (never moving a vertex to the
  other side), and refuse features thinner than about a paper thickness (10⁻³
  of the sheet). Exact algebraic arithmetic is the alternative that the closest
  prior art chose. It cost the crane 112 s in a browser.

What is **not** established:

- a proof of the plain-fold rule (the evidence is large but random);
- behaviour above about 400 faces;
- compound folds on real sequences beyond the preliminary and bird bases (a crane
  neck, a bird's-leg crimp);
- that the motions of compound folds are physically performable (validity checks
  the end state only);
- that completing over constraints Fold builds itself avoids Flat-Folder's two
  measured defects (that entry point is specified, not built; §7.1);
- the image–image sliver guard (defined, not run; §6);
- real-model performance in Rust.

> **Confidence discipline**, as in the
> [2026-08-07 report](2026-08-07-3d-fold-feasibility.md): every headline is a
> measurement from a named spike file, a `file:line` read, or a cited source.
> Derivations are labelled **[derived]**; things not checked are labelled
> **[unverified]**. §13 lists the claims this investigation **refuted**,
> including several it started out holding, and the corrections an adversarial
> review made to this document.
>
> The spikes are throwaway Node and Rust scripts under `artifacts/fold-spike/`
> (gitignored), named here for the record and not committed. The reports
> written from them, and the codebase and prior-art reports before them, are
> committed in [`2026-10-08-fold-workspace/`](2026-10-08-fold-workspace/README.md);
> where a report and this document disagree, this document wins. The production
> plan is [`implementation-plans/fold-workspace.md`](../implementation-plans/fold-workspace.md).
> Do not port spike code; it answers questions, it is not a starting point.

---

## TL;DR

1. **State = crease pattern + convex faces + a pairwise layer order.** Face
   positions are *derived* from the crease pattern by walking from a root face
   that keeps its previous position; nothing is ever re-folded from old folded
   coordinates. Mountain/valley letters are derived from the order. (§3)
2. **A plain fold is closed-form** (§4):
   - the moving set is the closure of the picked layers under paper adjacency
     across edges that reach the moving side (never across the fold line
     itself), plus "anything above a moving layer on the moving side must move
     too" (below, for a mountain fold);
   - the new order is: stationary pairs unchanged, moving pairs reversed,
     moving-over-stationary on top (valley) or underneath (mountain).

   Fold-and-unfold, refolding a precrease, unfolding a flap and turning the
   model over are the same operation or a trivial one.
3. **Compound folds are one pipeline with a solver at the end** (§5). Plain
   folds never need the solver; every compound fold does, and so does Import
   CP (a V0 step), completing from the imported crease pattern's letters.
   - **Reverse folds, crimps and tucks** fix the pairs their blocks determine
     and complete the rest. That is unique in about 99% of cases; a per-pair
     rule alone is wrong in 1–9%.
   - **Sinks** are a block-placement rule on the plain-fold geometry.
   - **Squash and petal** need a direction seed.
   - **The rabbit ear** also needs the user to pick which ray is the ridge.
4. **The engine must own its geometry and constraints** (§6–7). Flat-Folder's
   arrangement step built a wrong arrangement for 7.2% of spike states. The
   independent checker, which works on face pairs directly, agreed with
   Flat-Folder wherever Flat-Folder could build its arrangement. Flat-Folder's
   arrangement and the Oriedita pipeline become test oracles; only
   Flat-Folder's *search* runs at runtime, fed constraints Fold builds. Edit's
   3D layer order (`folding3d`) is not reused either (§7.2).
5. **The axioms already exist** (§8). `oristudio-precrease/src/construct.rs`
   has all seven, with a polished cubic for O6, but its filters assume a flat
   rectangle. They need lifting out of `Sheet`.
6. **Rendering and animation mostly exist** (§9). The kernel scene shape
   (`faces` + `subfaces[].faces_top_to_bottom`) already drives Edit's 3D
   figure, the Diagram and export; the per-face `points` and `sheet_points`
   Fold also wants are schema 3, which exists only on PR #436. A plain fold
   animates as two rigid groups.
   Reverse folds have **no** rigid motion that does not first unfold the vertex
   flat **[derived]**, so they animate visually, with exact endpoints.
7. **The Diagram can link Fold steps without re-running them** (§11), through a
   new `fold-step` source that stores a superset of the kernel scene. Fold is
   built on a branch from #436's head (plan decision C), so this need not wait
   for #436 to merge.

---

## 1. What Fold is, and what it is not

**Fold** is a fifth authoring workspace: a sheet, a list of steps, and a
folded form you act on directly. Each step is a fold a person could make.

| | Fold (new) | Edit's folded figure | Simulate | References |
|---|---|---|---|---|
| Input | A sequence of human folds | A whole crease pattern | A whole crease pattern | A crease pattern |
| Direction | Forward: steps → crease pattern | Crease pattern → one folded state | Crease pattern → physics | Crease pattern → precrease steps |
| Layer order | Determined by the history | Searched; any valid one (‹ n of m ›) | Not modelled (no collisions) | Not modelled (one sheet) |
| Flat only | Yes (non-flat is a non-goal) | Yes (plus a 3D route) | No | Yes |

It is not the removed `treemaker-sequence` crate. That crate tried to *plan* a
sequence backwards from a crease pattern (commit 9505e1600, "a
folding-sequence research attempt that did not work out"). Planning is the
expensive direction:

- ORIZU's unfolding search produced a 22,665-node step graph and took about
  1,780 s on one example.
- Deciding simple-fold sequences is strongly NP-complete even on 45° square
  paper (§2.1).

Fold never searches for a sequence. It applies the one the user makes and
checks each step.

## 2. Prior art

### 2.1 Theory

- **Axioms.**
  - Alperin & Lang (*Origami⁴*, 2009) prove the seven Huzita–Justin operations
    are every way to fix one fold line by aligning points and lines.
  - Solution counts: O1, O2 and O4 exactly 1; O3 1 or 2; O5 0–2; O6 0–3 (a
    cubic); O7 0 or 1.
  - O2, O3, O5, O6 and O7 move a feature onto another, so on a folded form they
    also say which side moves. O1 and O4 do not.
  - Lang adds a realizability rule for O6: only roots where both moving points
    lie on the same side of the fold line can be folded.
- **Simple folds** — Akitaya, Demaine & Ku, "Simple Folding is Really Hard"
  (JIP 25, 2017). This is the formal model V0 implements. A simple fold of a
  flat folding (Σ, f, λ) is fixed by a directed axis and a folded region U. It
  must meet seven conditions ([r1-theory.md](2026-10-08-fold-workspace/r1-theory.md)
  §2.2):
  - U is bounded by the paper edge and the axis' preimage.
  - U reflects.
  - Old creases are kept.
  - Nothing outside U changes.
  - U's internal order reverses.
  - Before the fold, U is entirely above (or below) what it is stacked with,
    according to the side of the axis.
  - After the fold, the same holds on the landing side.

  The one-, some- and all-layers models only limit how many layers fold at each
  point of the axis (Arkin et al., "When Can You Fold a Map?", CGTA 2004).
- **Layer order validity** — Akitaya, Demaine & Ku, "Computing Flat-Folded
  States", OSME 2024.
  - For convex faces, a facewise order on overlapping pairs is equivalent to
    the pointwise definition.
  - Validity is antisymmetry, transitivity, taco-taco, taco-tortilla and
    tortilla-tortilla.
  - Checking a given order is O(n³).
  - This is exactly Flat-Folder's model, already ported in
    `crates/treemaker-flatfold`.
  - Orders can be cyclic (the square twist), so **no global z-index exists in
    general** (FOLD spec, `faceOrders`).
- **Reachability is hard; checking a step is not.**
  - Simple-foldability is strongly NP-complete for orthogonal polygons and for
    45° square paper (ADK 2017).
  - General flat-foldability is NP-hard (Bern–Hayes 1996, corrected in "Box
    Pleating is Hard", 2015).
  - Every valid flat state is reachable by *some* continuous motion (Demaine,
    Devadoss, Mitchell & O'Rourke, CCCG 2004), but that says nothing about
    whether a named manoeuvre performs it.
  - **[derived]** So the engine should check each step's end state, not decide
    whether a motion is possible.

### 2.2 Software

| System | Folded-state model | Which layers move | Compound folds | Arithmetic | Licence |
|---|---|---|---|---|---|
| **Beloch** (Mühl, 2026, OCaml) | Convex faces + isometries + a stored **total rank** | Side + optional depth, hinge and outward closure; placements top / bottom / over T / under T | Reverse (two blocks), fan (squash, rabbit ear, swivel), unfold, flip; no petal, no sinks | Exact (FLINT `qqbar`) | MIT |
| Rabbit Ear (Kraft) | Crease pattern + derived spanning-tree folding | All layers only | None | f64 | GPL-3.0 |
| Eos / Orikoto (Ida et al.) | Faces, adjacency, superposition graph | Faces + `Handles`, `InsertFace` | Cut → simple folds → glue | Numeric; Gröbner proofs | Closed |
| Miyazaki et al. 1996 | Face-cell tree, a stack per plane | Picked + connected + overlapping on the rotating side | Symmetric tuck only | f64 | Paper |
| ORIZU (Akitaya, Mitani et al.) | Crease-pattern graph, backwards | n/a: generates sequences | Reverse, squash, petal | f64 | Paper |
| Origami Editor 3D | 3D polygons, **no layer order** | All, or one connected component | None | f64 | GPL-3.0 |
| Orimath | One global stack | All, or front-most | None | f64 | No licence file |
| Kamigami (2026-10-07) | Per-facet transform + a real-valued layer key | Top/bottom N + adjacency, no outward closure | Heuristic reverse, sink, squash, petal; "no collision checking" | f64 | MIT |

Sources and details are in [r1-software.md](2026-10-08-fold-workspace/r1-software.md)
and, for Beloch, [r2-beloch.md](2026-10-08-fold-workspace/r2-beloch.md). Points
worth carrying into the design:

- **Beloch is the closest prior art, and is two weeks old.**
  - Its state, its one validating constructor (`Fold_state.make`), its
    block-reflection primitive and its derived letters all match what this
    research arrived at independently.
  - It stores a total rank, which cannot hold cyclic orders (its issues #3 and
    #72).
  - Its default fold scope was reversed twice in a week: ADR 0031 → ADR 0036
    went back to "every layer on the moving side, narrow with `up to`". Lesson:
    keep the side and the depth as **two separate controls**.
  - It spent 18 ADRs in about five days learning which inputs each manoeuvre
    needs, which is useful prior art for the UI.
  - **Its 56 committed FOLD fixtures (105 non-trivial frames, 1,701 pair
    orders, crane included) all pass Flat-Folder with 0 conflicts**
    (`artifacts/fold-spike/beloch-oracle/`). Their letters agree with their
    orders in 311 of 311 checks. They can serve as goldens with no OCaml build.
- **No surveyed tool validates sinks.** Kamigami's "open sink" is a half-split
  heuristic with no validity check.
- **Rabbit Ear's `faceOrders` update can leave pairs unordered.** A moving face
  that wasn't split, landing on a face it never overlapped, gets no relation.
  It is not an oracle.
- **Orimath has the best gesture-to-axiom mapping surveyed** (drag point to
  point = O2, line to line = O3, and so on). That is a reference for the UI
  designer, not for the engine.

## 3. The state model

**[spike-confirmed]** A state is:

- **Crease pattern.**
  - Vertices in sheet coordinates.
  - Edges marked B (border), M, V or F, where F is a crease that is currently
    unfolded. An F edge keeps the letter it had when it was last folded, and the
    step that made it.
- **Faces.** Convex vertex rings, counter-clockwise in sheet coordinates. Each
  face records the face it was split from (its lineage).
  - Every crease a straight fold makes is a full chord of the face it crosses,
    so splitting keeps faces convex.
  - The faces of the *folded*-crease arrangement are also convex: at a
    flat-foldable interior vertex every sector is under π, because the
    alternating sector sums equal π **[derived;
    [r1-theory.md](2026-10-08-fold-workspace/r1-theory.md) §3]**.
- **Face isometries T_f.** One per face, derived by a breadth-first walk from a
  root face over the crease pattern: cross an M/V edge and reflect across its
  sheet line; cross an F edge and stay put.
  - The root keeps its previous isometry, so stationary paper never moves and
    error does not accumulate step to step.
  - The isometries are checked, not averaged. Every vertex's images through its
    incident faces must agree within tolerance. Oriedita's `folded_points`
    averages them instead (`crates/oristudio-cp/src/fold_graph.rs:314`), which
    hides an inconsistent state.
- **Layer order.** An antisymmetric ±1 relation on face pairs whose images
  overlap with positive area.
- **View.** A turn-over and a rotation, applied for display. They change what
  "toward the viewer" means for the next fold.
  - The *model frame* is the folded frame the root-carried isometries give,
    before the view. Stored axiom roots live in it; every other input
    (free-line points, seeds, axiom references) is stored as sheet points and
    mapped into it through its face's isometry (§10). A
    valley or mountain the user gives is resolved against the view on the
    path (turn-over and rotate are steps).
  - The core spike instead composed turn-over into the root isometry
    (`core/state.mjs:143-154`), so its lines and `above` are viewer-frame.
    The two agree on every state, but not on what a stored line means, so
    production keeps the view outside the model frame.

### 3.1 Conventions

Pinned by `artifacts/fold-spike/core/test-golden.mjs` (79 checks, 0 failures):

| Convention | Rule |
|---|---|
| Frame | The viewer is at +z. `det T_f = +1` means the face shows its front. |
| `above(f, g)` | Absolute: f is nearer the viewer where they overlap. |
| Valley / mountain fold | Valley: the moving part rotates toward the viewer and lands **on top**. Mountain: it rotates away and lands **underneath**. |
| Letters (derived) | A folded crease is **V iff its front-up face lies below** (Flat-Folder `solver.js:181-192`; Beloch `def-letter`). So through several layers a fold's new creases alternate V/M with each layer's flip. Letters are **front-relative**, tied to the paper, not the view: on a sheet started back-up, the first fold the viewer makes as a valley stores an M. Stored and exported letters (FOLD, `.cp`, Send to Edit) stay front-relative. |
| FOLD export | `[f, g, s]` with s = +1 iff `above(f, g) == frontUp(g)`. Matches Flat-Folder's own `edges_Ff_2_FO`. |
| Turn over | Reflect the view; seen by the viewer every `above` inverts; letters are unchanged. |

In the FOLD convention, **pairs that both move in a plain fold never change
their triple.** The core spike's "0 changes in 12,306,950 checks" is a
**[derived]** bookkeeping identity: it restates the rule the spike applied
(`test-random.mjs:107-116`), and the evidence for those states is that
Flat-Folder validated them. The independent check is Beloch's fixtures, built
by other code: 47 of 47 moving pairs keep their triple **[spike-confirmed]**.

The rule holds inside a **block** — a set of faces the operation declares to
move as one stack — not for any two faces that happen to share an isometry. On
Beloch's reverse-fold fixtures, all 25 tip pairs move by the same reflection,
yet 21 flip their FOLD sign (`beloch-oracle/triple-invariance.mjs`, which sees
isometries, not blocks). The 4 that keep it are same-block pairs; the 21 that
flip are cross-block. §5.2's campaign gives the split by block: same-block
triples unchanged in 1,076 of 1,076, cross-block flipped in 1,528 of 1,528. So
the pipeline carries order by declared block (§5.1 step 6) and seeds the pairs
between blocks by each operation's rule (step 7).

### 3.2 Why the order is stored, not re-derived

| Evidence | Valid layer orders for one crease pattern |
|---|---|
| Spike states, given their own crease pattern and letters | Unique for only 19,608 of 42,020 (46.7%) |
| Rabbit Ear `flatFold` corpus sample | More than one for 193 of 200 |
| `tests/fixtures/flat-folder/kabuto.fold` | 9 (`crates/treemaker-flatfold/src/lib.rs:512-522`) |
| A closed sink on an open point (sink spike) | 29 |

Physically the order is determined by the history. Re-solving from the crease
pattern would let a valid-but-wrong order appear between two steps, and an
animation would visibly pop. This is the same reason the Diagram stores pictures
and never re-folds on open (`diagram-workspace.md` D2/D4).

### 3.3 Validity

A state is valid when all of these hold:

- the isometries agree on every shared edge (residual ≤ tol);
- every folded edge joins faces of opposite orientation (**hinge
  consistency**). The squash spike needed this as a separate gate: one state
  with a near-zero residual still had a folded edge between same-orientation
  faces;
- the order is complete on overlapping pairs and satisfies the five constraint
  families of §2.1;
- every letter matches the order.

## 4. The plain fold (V0)

### 4.1 Inputs

- **The fold line ℓ**, in the current model frame (§3: the folded frame
  before the view). It comes from an axiom construction, an existing crease or
  edge, or a free line snapped to landmarks.
- **The moving side.** O2/O3/O5/O6/O7 imply it; O1, O4 and free lines need a
  pick.
- **The direction:** valley or mountain, as seen by the viewer.
- **The seed:**
  - all layers on the moving side; or
  - the top k layers at a point (bottom k for mountain); or
  - explicit faces (a tap on a flap).

### 4.2 Algorithm

As built in `artifacts/fold-spike/core/fold.mjs` (report:
[r2-spike-core.md](2026-10-08-fold-workspace/r2-spike-core.md)); the
production plan re-implements it from this text.

0. **Snap ℓ** exactly through every vertex image within tol of it. With two or
   more clusters, use the line through the two farthest. A vertex left between
   1e-9 and tol off the snapped line is refused as ambiguous: 12 times in 27k
   attempts.
   - **A snap may not change any vertex's class.** Classify every vertex
     against both ℓ and the snapped line, with the same tol/μ bands. If any
     vertex changes side, or is a near miss against either line, treat it as
     a near miss: offer the landmark line, otherwise refuse and name the
     vertex.
   - The spike did not check this, and the two-farthest rule has no bound on
     rotation. With two clusters about 1e-4 apart it turned ℓ by 0.86° and
     shifted it by 6.07e-3 (residual probe, μ = 0,
     `core/results/residual-probe.json`); elsewhere the largest snap angle
     was about 5e-8.
1. **Classify each vertex once**, from its canonical image: left of ℓ, right of
   ℓ, or on it (tol = 1e-6 of the sheet). Refuse a near miss, tol < |d| < μ.
2. **Pieces.** Each face whose image crosses ℓ has a moving-side piece (its
   image clipped to the half-plane) and a stationary-side piece.
3. **Seed**, from §4.1.
4. **Closure U.** A breadth-first search from the seed:
   - (i) **adjacency** across a crease-pattern edge with at least one endpoint
     classified on the moving side. An edge with both endpoints on ℓ is a
     hinge, not adjacency; an edge entirely on the stationary side, or
     touching ℓ at one end only, connects nothing that moves
     (`fold.mjs:138-148`);
   - (ii) **overlap**: a moving-side piece that overlaps a member of U by more
     than tol, and lies above it (valley) or below it (mountain), joins U.

   If everything ends up moving, nothing stays put and the op is refused. The
   remedy is a narrower seed (a flap, or the top layer), not turning over.
5. **Split** only the faces whose moving piece is in U.
   - Each crossed crease-pattern edge gets exactly one new vertex, at its sheet
     parameter t. Neighbouring faces therefore cannot disagree about where it
     is.
   - Each ring splits at exactly two transitions; anything else is refused.
     That never happened.
6. **New crease pattern.**
   - Chords are new folded creases.
   - Edges on ℓ between a moving and a stationary face **toggle**: F becomes
     folded (a refold, keeping the remembered letter for the diagram), and
     folded becomes F (an unfold).
7. **Isometries.** Re-derive them by breadth-first search from a stationary
   root that keeps its old isometry. Check them against the prediction
   R_ℓ ∘ T_old for moving faces and T_old for stationary ones.
8. **Order.**
   - Same-class children of an old overlapping pair keep the old order if
     stationary, and take the reversed order if moving.
   - Each newly overlapping moving × stationary pair takes the placement: moving
     on top (valley) or underneath (mountain).
9. **Letters**, derived from the order. Old letters must not change: "letter
   drift" occurred 0 times.

- **Fold-and-unfold** (a precrease) is this fold, then the same line folded
  back with the moved faces as the seed. It restores the geometry to 2.3e-11
  and leaves F creases that remember their letter.
- **Unfold a flap** is a fold along an existing bend with the flap as the
  seed. The hinge on ℓ is not adjacency (step 4 (i)), so only the flap moves,
  and its hinge toggles to F (`core/test-golden.mjs` G10).
- **Turn over** reflects the view.

### 4.3 Evidence

`artifacts/fold-spike/core/results/`. Two independent judges were used:

- **Flat-Folder:** seed every variable from our order, propagate, and require
  zero conflicts. In addition:
  - letters must reproduce;
  - our pairs must equal Flat-Folder's variables;
  - for states with ≤ 96 faces, our order must be among the solutions found
    from scratch.
- **`indep.mjs`:** the five constraint families computed directly from convex
  face images, with no arrangement.

Calibration: the judges agree on 300 of 300 valid states and 284 of 284
corrupted ones. Flat-Folder rejected all 189 single-pair corruptions.

| Campaign | Sequences | Applied ops | Hard failures | Cause |
|---|---|---|---|---|
| main (snap, μ = 0) | 2,060 | 18,342 | 3 | Sub-tolerance slivers |
| seed 2 | 1,030 | 9,198 | 1 | Sliver |
| residual probe | 600 | 5,219 | 1 | Sliver |
| long (≤ 2,147 faces, 25 steps on average) | 12 | 301 | 0 | |
| **hinge-wrap, targeted** | 600 | 2,445 | **0** | 1,497 folds with a wrap (6,123 wrapped hinge edges), up to 133 layers deep |
| no line snapping | 500 | 4,373 | 1 | Sliver; residual reached 7.1e-3 in a smoke run |
| μ = 1e-3, seeds 4 and 5 | 1,000 | 8,700 | **0** | |
| μ = 1e-4 | 500 | 4,359 | 0 hard, 3 sub-tol | |

- Across the 52,937 ops, 51,741 crease edges were unfolded (M/V to F) and
  6,407 refolded (F to a letter). These are edge counts, not op counts.
- New-crease letters alternate per layer exactly: 0 mismatches in 327,046
  chords.

**What this does not show:**

- It is not a proof. Beloch's `lem-fold-closed`, the same claim, also has a
  pending proof. The worry in [r1-theory.md](2026-10-08-fold-workspace/r1-theory.md)
  §2.3 — a stationary layer crossing ℓ between a moving piece and its hinge
  partner, so the new crease wraps through it — was hunted directly: 1,497
  folds wrapped a hinge around stationary layers, and none was invalid.
  **[derived]** sketch: such a layer must meet ℓ only along a raw edge or inside
  a nested taco, or the previous state was already invalid, or closure rule (ii)
  moves it.
- Random lines through landmarks are not real diagrams. The classics (kite
  base, a flap unfold, a top-layer corner after two folds, a precrease through
  4 layers then refold, a tuck) all verify. Real sequences are the plan's
  Phase 2 test corpus (classic sequences as fixtures, performance recorded
  against them).

### 4.4 Tucks: a placement, not a rule

Inserting the moving block over or under a named layer T (Beloch's
`over/under T`; Eos' `InsertFace`) is the same pipeline with a different
placement. **Only 220 of 391 random tucks (56%) were valid**, and both judges
agreed on all 391. A tuck is therefore an offer that the validator accepts or
refuses, not a deterministic rule. Beloch's ADR 0052 adds a bounded closure:
the layers between the depth and the target move too.

### 4.5 What the user picks, and why the engine should preview U

The closure can move more than was picked. "Fold the top layer" moves anything
that lies on that layer on the moving side, and everything hinged to it on the
moving side. Beloch learned this the hard way:

- An ear fold swept up about half the model under its first default.
- Narrowing the default hit a catch-22: the tip you grab sits on a crease that
  two flaps share.

**[derived]** The engine should return U and its distinct depth choices (the
closures of top-1, top-2, …, with duplicates removed) as data, so the UI can
preview what will move before the user commits. Shimanuki et al.'s
cross-section test (MVA 2002) is a cheap way to list feasible insertion depths
for tucks.

## 5. Compound folds: one pipeline

### 5.1 The pipeline

**[spike-confirmed for reverse folds, crimps, tucks, squash, petal, rabbit ear,
the swivel vertex and sinks, each spike with its own block rule; the uniform
block declaration in steps 1 and 6 is derived]**

1. **Macro.** The operation and its inputs compile to:
   - *scores*: a line, segment or fan of rays, through chosen layers;
   - a *hinge diff*: fold, unfold or toggle specific creases;
   - a *stayer* face;
   - *blocks*: a partition of the moving faces into sets that move as one
     stack, each with its motion;
   - *seeds*: a direction, a placement, a pocket, or letters.
2. **Score.** Split the chosen faces, with one new vertex per crossed edge and
   snapping.
3. **Change hinges.**
4. **Derive** the isometries from the stayer.
5. **Gate:** residual ≤ tol, hinge consistency, minimum feature.
6. **Carry** the order of every overlapping pair whose two faces are both
   stationary or in the same declared block: keep it under the block's
   rotation, reverse it under its reflection. Pairs in different blocks are
   never carried, even when their end isometries are equal (§3.1). The blocks:
   - plain fold: U is one block;
   - reverse fold, crimp, tuck: the opening's blocks (T1, T2, or per flap);
   - squash, petal, rabbit ear, swivel: the motion classes (`motionBlocks`);
   - open sink: one block per layer; closed sink: two.
7. **Seed** with the operation's fixed pairs, including the cross-block pairs
   it decides:
   - a placement for plain folds and sinks;
   - for reverse folds, crimps and tucks, each block against its own body, and
     cross-block pairs *kept* in absolute terms (the setting behind §5.2's
     uniqueness figures, `crossBlock: "keep"`);
   - for sinks, cross-block tip pairs from the per-face anchors and placement
     (`sink.mjs` `placeBlocks`), or from letters;
   - a direction seed for squash and petal;
   - a chosen ridge or letters for the rabbit ear.
8. **Complete** the remaining pairs with propagation and search. Seeds are
   propagated; carried pairs are not re-propagated (§7.1). Zero solutions is a
   refusal that names the conflicting faces. One is the result. More than one
   is offered to the user, and the choice is stored in the step as data, never
   as an index (§10).
9. **Derive letters** from the order, and **validate**.

A plain fold is the case where steps 6 and 7 decide every pair, so step 8 has
nothing to do.

Two other designs were measured against this one and lost:

- **Beloch-style fan with hinge enumeration.**
  - The rays at a vertex do not say which existing hinges change. The squash's
    rays close in 4 interpretations (5–10 valid states); the petal's in 4 of
    1,024 (12–24 states). Exactly one of each is the intended move.
  - Its stacking search does not scale: 13.8M and 39.1M placement combinations
    for the petal. Capped at 50k, it found 2 of 4 and 3 of 9 of Flat-Folder's
    states.
  - Keep it only as an *assistant* for a future free "collapse" tool.
- **Re-solving from the crease pattern.** Rejected by §3.2.

### 5.2 Reverse folds, crimps, tucks

`artifacts/fold-spike/compound/reverse-crimp-tuck/b/`. Every number is from
seeded, rerunnable campaigns: 4,453 reverse ops, 2,929 crimp ops and 1,970
tucks on random states of 1–4 folds (≤ 60 faces), plus 55 named cases. The two
verifiers agree on 29,917 of 29,918 campaign states (17,220 reverse, 10,728
crimp, 1,970 tuck) and on all 55 named cases; the exception is the image–image
sliver described below. Details: [r2-spike-reverse-crimp-tuck.md](2026-10-08-fold-workspace/r2-spike-reverse-crimp-tuck.md).

**The geometry and the crease pattern are a plain fold's.**

- A reverse fold reflects every piece of the *tip* across ℓ. The tip is the
  pieces on the swing side, closed under hinges of any letter that lie off ℓ.
- Its crease pattern is exactly that of a plain fold of the whole tip.
- Only the letters and the order differ.

**What the user gives:**

- ℓ, the tip side and an anchor;
- the **kind**, inside or outside;
- an **opening**, only if more than one is admissible.

An opening splits the tip into a lower block T1 and an upper block T2:

- no T1 piece lies above an overlapping T2 piece;
- every hinge across the split is folded and lies on one spine line;
- each block is hinged on ℓ to its own stationary *body*.

25% of random ops had 2–5 admissible openings.

**Letters, exactly (0 mismatches in 8,819 valid states, and 23,426 of 23,426
chord checks):**

- spine creases across the opening flip M↔V;
- every other tip crease keeps its letter;
- a new chord where the spine crosses ℓ takes the body-side spine letter for
  inside, and the opposite for outside.

**Order: fixed pairs plus completion, not a rule.**

The fixed pairs are:

- stationary pairs, unchanged;
- pairs in the same block, reversed;
- pairs in different blocks, *kept* in absolute terms;
- each block against its own body: inside lands T1 just over B1 and T2 just
  under B2; outside does the reverse.

For layers outside a block's own body, a per-pair placement rule decides
instead. Two were tried: Beloch's (`def-reverse`: inside places T1 over B1 and
T2 under B2; outside places T1 at the bottom and T2 on top), and the spike's
body-relative outside variant (T1 under B1, T2 over B2). Per-pair placement:

- creates cycles: 84 cases with the body-relative outside rule, 1 with
  Beloch's inside rule, none with Beloch's outside rule;
- decides wrongly when a layer overlaps no face of T.

Validity of each approach, where a state of that kind exists:

| Operation | Per-pair rule valid | Fixed pairs + completion: unique |
|---|---|---|
| Inside reverse (Beloch's rule) | 98.9% | 99.4% |
| Outside reverse, Beloch (T1 bottom, T2 top) | 98.0% | 99.3% |
| Outside reverse, body-relative (spike) | 96.2% | 99.3% |
| Inside crimp | 99.0% | 99.0% |
| Outside crimp (body-relative rule) | 96.7% | 98.9% |
| Tuck ("immediately under T") | 91.0% | 99.1% |

The crimp campaign used the body-relative outside rule; Beloch defines no
crimp.

So **every compound fold, reverse folds included, ends at the completion
solver**. The remaining ~1% are genuine alternatives, mostly 2–3 states, and
must be offered as choices.

**In FOLD terms:**

- same-block triples never change (1,076 of 1,076);
- cross-block triples always flip (1,528 of 1,528).

**The kind is usually forced by geometry.**

- On a 2-layer flap with a generic line, exactly one of inside and outside is
  valid. Across random ops, both are valid in only 2.1% of non-perpendicular
  ops, against 62.6% when ℓ is perpendicular to the spine.
- **[derived]** The UI can pre-select the feasible kind and offer the other only
  when it too is valid.

**Where Beloch's definitions fall short:**

- **One opening per tip.** This cannot express reversing two stacked flaps, each
  opening at its own layers, which is what a folder does. Per-flap openings
  (four blocks) verified (case 2b).
- **The outside rule.** "T1 at the bottom, T2 on top" wraps unrelated layers when
  the flap is part of a larger stack (case 2c). The body-relative rule fails
  elsewhere. Completion covers both.
- **Crimps.** A crimp is not two valid reverse folds. In 4.5% (inside) and 5.6%
  (outside) of valid crimps, the first reverse alone is invalid. A crimp is
  **one operation**, verified only at its end:
  - the strip between the lines moves by ρ1;
  - the tip moves by ρ1∘ρ2.

  By definition a crimp is same-kind on both lines (`crimp.mjs`). Mixed pairs
  are not always invalid: as one op they are valid in 8.4% (inside then
  outside, 224 of 2,682) and 13.5% (outside then inside, 361 of 2,682) of
  random ops, though all six mixed named cases on the 6-face triangle fail. In
  574 of the 585 valid mixed states the first reverse alone is valid, so the
  engine offers only same-kind crimps as one op and leaves a mixed pair to two
  reverse folds, giving up the other 11.
- **Tucks.**
  - They need Beloch's bounded closure (ADR 0052), and the strict reading of
    "immediately under T".
  - The loose reading is ambiguous in 26% of feasible cases.
  - Only 40% of the layers a plain fold would land on are feasible targets, so
    the engine should list feasible targets rather than let any be picked.

**A pleat is two plain folds.** No primitive is needed.

**A new numerics case.** One reflected vertex landed 1.6e-4 inside another
layer's face, with an area of 3e-8, and Flat-Folder's arrangement missed it. The
minimum-feature rule must also cover **image–image** near-coincidences after the
move, not only vertex–line distances. §6 defines that guard.

**Costs** (mean):

| Faces | Reverse op | Arrangement | Completion |
|---|---|---|---|
| 33–64 | 2.9 ms | 11 ms | 10 ms |
| 129–256 | 15.6 ms | 78 ms | 518 ms |

- Enumerating openings is O(2^|tip|); the spike capped the tip at 18 faces.
- Production needs local completion (only the cells the moved faces cover) and a
  smarter opening scan.

**Still untested:** a real sequence beyond the preliminary base (no crane neck,
no bird's-leg crimp), and Beloch's "reverse = fan at ℓ ∩ spine" equivalence.

From the sink spike: a closed sink is an inside reverse fold of the whole point,
with the pocket's two bounding creases as spines. It verified.

### 5.3 Squash, petal, rabbit ear

`artifacts/fold-spike/compound/squash-petal-rabbit/`; report:
[r2-spike-squash-petal-rabbit.md](2026-10-08-fold-workspace/r2-spike-squash-petal-rabbit.md).

| Operation | User inputs | Mechanism | Unique? (evidence) |
|---|---|---|---|
| **Squash** | Flap (a point), spine target (default: the hinge line), direction | Q creases along the bisector of spine and target; P along h + (1−μ)D/2; spine unfolds; P's hinge toggles | Carried pairs alone: 1–3 states. With the direction seed: **1 in every case**, including 416 of 416 free, uncovered random flaps |
| **Petal** | Flap, the horizontal line H (or its ends), direction; kite creases and H precreased | 8 hinge changes; 6 motion blocks; at the corner, three reflections compose to one | Carried: 4 (front) and 9 (back). Direction seed: **1** |
| **Rabbit ear** | Triangle or vertex, emergent ray (≤ 3 Kawasaki candidates), layers, stayer, direction, **ridge** | 4 new creases through the chosen layers | Direction seed: 2 (they differ by which ray is the ridge). Ridge or anchor-layer letters: **1** |
| **Swivel** (free vertex only) | Vertex, rays, emergent ray | As rabbit ear | Direction seed: 1 |

Reference results, both verified by Flat-Folder and the independent checker:

- Two squashes along the diagonal route give the **preliminary base**. It matches
  Beloch's `side-preliminary-1.fold` exactly, up to a reflection of the square.
- Two petal folds then give the **bird base**, matching `bird-base-petal.fold`.

Findings that change the design:

- **The squash's two layers do not crease on one shared line** unless the spine
  lands on the hinge line (μ = 0). With one shared axis, an asymmetric squash
  leaves a residual of 0.342. With per-layer axes it closes to 2.5e-16. Beloch's
  ADR 0038 states the shared line; it holds only in the symmetric case. **So
  creases must be computed per layer from (flap, target), never taken from a
  free-drawn line.**
- **Preconditions matter more than rules.**
  - In a random campaign, all 157 squashes that failed to close had the flap
    attached somewhere off the hinge line.
  - 59 closed but had no flat completion, because another layer covered the
    flap.
  - The engine should check "free and uncovered" first and explain a refusal.
- **"Square folded in half twice, then squash" gives the waterbomb base, not
  the preliminary base.** The task brief had this wrong; the spike caught it
  against the fixture.

### 5.4 Sinks

`artifacts/fold-spike/compound/sinks/`; report:
[r2-spike-sinks.md](2026-10-08-fold-workspace/r2-spike-sinks.md). Starting
states are the preliminary and waterbomb bases, imported from their crease
patterns (see §5.5).

- **Sink geometry is forced.** Each tip piece hinges on the sink line to its own
  stationary piece, so its isometry is R_ℓ ∘ T_old: the plain-fold geometry of
  the whole point. Only the letters and the order are open.
- **The crease change plus the pinned outside orders, without letters, is not
  enough.** Flat-Folder finds 11 valid completions at every depth where the tip
  stays inside (f < 0.5) on the preliminary base:
  - 1 open sink;
  - 2 closed sinks (front and back pocket);
  - 2 twisted closed sinks;
  - 4 open-on-one-half mixes;
  - 2 plain folds of the whole point.
- **With letters, the state is determined.** Each completion has its own
  letters, and given them Flat-Folder finds exactly one state (11 of 11).
- **Open and closed sinks differ in the crease pattern**, not only in the order:

  | | Ring creases | Inner folded creases | Order rule (same block-placement primitive) |
  |---|---|---|---|
  | **Open sink** | All take the exterior letter (8 of 8 M) | All 6 flip | Each layer is its own block, placed against its own stationary half on the pocket side ("inverted nest") |
  | **Closed sink** | 6 M and 2 V | Only the 2 pocket seams flip | Two blocks, reversed, placed into the chosen pocket: an inside reverse of the whole point |

  Both rules equal a Flat-Folder completion exactly and admit exactly one state.
- **Preconditions** (all measured):

  | Condition | What happens when it fails |
  |---|---|
  | The point is closed: its outline, apart from ℓ, is folded creases | Open point: 644 completions; a given crease pattern still admits 29 |
  | The outline has one letter (one exterior side) | Fan point: no open sink; 7 valid pockets |
  | **For an open sink, ℓ is exactly perpendicular to the point's axis** | Any tilt from 0.001° to 44° kills the open sink. Closed sinks survive tilt |

  **Depth is not a precondition.** A deep sink (f ≥ 0.5 on the preliminary
  base, the tip poking out) is still valid. Without letters the completions
  rise from 11 to 220, but the open and closed rules still give valid states,
  each the only one given its letters and the pinned outside orders
  (`prelim-sweep.json`, f = 0.5–0.8). Given its crease pattern alone, a deep
  closed sink admits 4 states at f = 0.6 and the open sink still 1
  (`summary.json`). That matters for Import CP (§5.5), not for sinking.
- **Unsink is deterministic.** One completion from each of the three sunk states.
  It restores the inner letters (6 of 6) and the parents' order (24 of 24).
- **A precreased ring remembers the wrong letters.** Its fold-and-unfold leaves
  VMVMMVMV; the open sink needs MMMMMMMM. A sink must overwrite remembered
  precrease letters.
- **Anchors must be per face, not per block.** A single anchor per block left 16
  pairs undecided. The solver still completed them correctly.

### 5.5 Starting from a crease pattern

The sink spike's importer (`importcp.mjs`) builds a state from a crease pattern
plus one of its solved layer orders:

- faces by a half-edge walk;
- isometries by the same breadth-first walk;
- the order from Flat-Folder's completion, seeded with the crease pattern's
  letters.

It recovered both bases with no hand-written faces. The letters admit exactly 1
order per base; without them each admits 18 (`chk-import-noletters.mjs`). This
is the natural "start this sequence from a base" feature, and later "start from
this Edit crease pattern".

In the product (plan D16), Import CP completes through Fold's own entry point
(§7.1), seeded with the imported crease pattern's M/V letters; U creases stay
unknown. Its full order is stored with faces keyed by interior sheet points
(§10). It does not use Edit's ‹ Layer order n of m ›, which can miss the real
order (28 states, §7.1); that feeds only the separate "start from Edit's
folded figure" bridge.

**V0 imports square and rectangle sequences only.** The imported sheet is found
by precrease's `outline.rs`, which recovers rectangles and refuses anything else
(`NonRectangular`). It moves unchanged into `oristudio-geometry` in the plan's
Phase 1a; polygon sequences cannot import until it is generalised.

## 6. Numerics

**Floating point, not exact arithmetic.**

- Beloch chose exact real-algebraic numbers. That costs the crane **2.0 s native
  after heavy optimisation (373 s before), and 112 s in the browser bundle**
  against its playground's 8 s budget.
- Its ADR 0008 rejected f64 *a priori*, without a measured trial.
- Measured here: Flat-Folder in f64 matched Beloch's exported (f64-rounded)
  geometry for all 105 fixture frames to within 5.4e-13 (worst:
  `cube-root.fold`, an O6 cube-root construction). The crane is within 1.6e-15.

The f64 policy the spikes validated (all but the image–image guard, which no
spike ran):

| Policy | Why (evidence) |
|---|---|
| One tolerance, tol = 1e-6 of the sheet, for classification, snapping and overlap | Same as `oristudio-precrease/src/tol.rs:17`, so the axioms and the engine agree |
| **Line snapping:** move ℓ exactly through vertex images within tol, only if no vertex changes class against ℓ and the snapped line (§4.2 step 0) | Without it, a vertex δ ≤ tol off ℓ turns into a chord whose direction is off by about δ/len. A residual reached 7.1e-3. Unchecked, the snap once turned ℓ by 0.86° |
| **Minimum feature μ = 1e-3 of the sheet:** refuse near misses (tol < d < μ), edges shorter than μ, and pieces thinner than μ/2 | μ = 0: 5 hard failures in 35.5k ops. μ = 1e-4: 3 sub-tol events in 4.4k. μ = 1e-3: 0 in 8.7k. Physically, 1e-3 of a 15 cm sheet is 0.15 mm — about a paper thickness, so no real fold is lost **[derived]** |
| **Image–image guard [derived]:** after the move, for each pair of face images whose relative isometry changed (moving × stationary, and cross-block pairs whose motions differ), refuse with `sliver` when tol < overlap penetration < μ; optionally, also a vertex image within (tol, μ) of an edge of a face it overlaps | Catches both measured slivers the μ checks above miss: the reverse-fold vertex 1.6e-4 inside another face (§5.2) and the 0.001°-tilted closed sink (≈ 7.4e-6). The penetration is already computed to classify overlaps. No spike implemented it; it needs a campaign run with the guard on |
| One new vertex per crossed crease-pattern edge, by sheet parameter | Neighbouring faces cannot disagree; endpoint snapping never needed to fire |
| Isometries from the crease pattern, root carried | Error grows with tree depth, not step count. Main campaign: 18,235 of 18,342 residuals < 1e-12; max 3.7e-7, and ≤ 5.7e-12 with μ = 1e-3 |
| Residual **and** hinge-consistency gate | The residual alone admitted an inconsistent state (squash spike) |
| Store each step's construction, not only its line | Re-derive from inputs, certify to the nearest root, the way precrease does (`construct.rs:142-154`) |

**The overlap sliver.** A near-symmetric sink line tilted 0.001° makes overlaps
about 7e-6 wide. The face and vertex–line checks miss it, but it is a vertex
image (the reflected apex) within (tol, μ) of an edge image in an overlapping
layer, so the image–image guard catches it **[derived]**. Its remedy is a
different ℓ, not a snap through a vertex. The refusal names the vertex and the
face, and when the step's construction leaves one constraint free it offers the
exact line that puts the vertex on the edge's line (O5 if ℓ was pinned through
a point, O7 if pinned perpendicular to a line); for a sink, the exact symmetric
line. Exact predicates over float inputs (the `robust` crate), or exact
arithmetic, remain the later options if real sequences defeat the guard.

## 7. Validation and the completion solver

- **Flat-Folder's arrangement step is unreliable on thin features.**
  - It chooses ε by a heuristic (`third_party/flat-folder/src/conversion.js:7`;
    Rust `crates/treemaker-flatfold/src/conversion.rs:452-488`), which built a
    wrong arrangement for 3,240 of 45,273 spike states (7.2%).
  - Validating each arrangement and retrying at a finer ε rescued all but 2;
    the independent checker passes both.
  - The Rust port carries the same heuristic.
- **The engine must therefore own its geometry and constraint generation.**
  - It computes overlapping pairs, folded edges and the five constraint families
    from its own convex face images, with its one tolerance.
  - The arrangement-free checker (`indep.mjs`) agrees with Flat-Folder wherever
    Flat-Folder can build its arrangement.
- **Incremental.** An operation knows which faces it touched, so it checks only
  the constraints involving them. Full checks are for tests and a debug command.
- **Completion** (compound folds and Import CP; never plain folds) is unit
  propagation over the same constraint tables plus search over the remaining
  components. Flat-Folder's solver is exactly this
  (`crates/treemaker-flatfold/src/constraints.rs:506-609`, `975-1057`), but
  `pub(crate)` and fed by its own arrangement.
  - Spike costs at 16–32 faces: 1–42 ms.
  - The plan specifies a new entry point in `treemaker-flatfold` that takes
    from the caller the variables, the constraint buckets, the cell incidence
    and fixed assignments tagged *carried* or *seed*, keeping the existing
    stages bit-for-bit (porting discipline), rather than a second solver
    (§7.1).
- **Oracles in tests:**
  - Flat-Folder JS (`tools/flat-folder-oracle`), with arrangement validation and
    retry;
  - Oriedita *seeded* verification of our complete order, folding colours only.
    The spike's `or_seeded` (`reuse/solver/src/main.rs`) composes public
    stages: `initial_hierarchy_from_segments` with our pair relations appended,
    `validate_initial_hierarchy`, `configure_subfaces_from_segments` with
    `equivalence_condition_candidates_from_segments`, then
    `WorkerOverlapEnumerator::from_subfaces`. It accepted 1,685 of 1,685 valid
    states (§7.1). It skips the shipped path's closure step
    (`close_hierarchy_with_removal` is `pub(crate)`), so a faithful oracle
    needs one additive public function. The unseeded
    `folding_estimate_from_segments` → `Solved` is **not** an oracle: it gave 5
    false "no solutions" and stalled;
  - Beloch's 56 FOLD fixtures.

  `NoSolutions` from the Oriedita search is not a proof (three upstream search
  defects remain; [`2026-08-fold3d-layer-order-investigation.md`](2026-08-fold3d-layer-order-investigation.md)
  Round 38), so the engine never refuses a fold on its word.

### 7.1 Oriedita's folded figure vs Flat-Folder, measured

The question "why not Oriedita's solver, the one Edit already uses?" was
answered by running both on 2,752 Fold states (`artifacts/fold-spike/reuse/solver/`;
report: [r3-reuse-solver.md](2026-10-08-fold-workspace/r3-reuse-solver.md)):

- 1,559 random states (μ = 1e-3, ≤ 96 faces, 776 with precreases);
- 21 squash, petal and rabbit-ear outputs;
- 105 Beloch frames, crane included;
- 1,044 tolerance-stress states (μ = 0);
- 23 large states (97–396 faces).

Every state is valid by construction. Each solver's answer was mapped back onto
our faces (0 unmapped).

**They model the same problem differently.**

| | Oriedita (Edit's folded figure) | Flat-Folder |
|---|---|---|
| Representation | Dense face × face table, plus "subfaces" (overlap cells with stacks) and triple/quadruple conditions | One yes/no variable per overlapping face pair, plus constraint tables |
| Search | Tries orderings of each cell's stack; a closure step prunes; a swapper reorders at dead ends | Unit propagation, then a DFS per independent component |
| "No solution" | Not a proof: three upstream search defects are ported faithfully | A proof, relative to the constraints it built |
| Seeding | No entry point takes pairs, but they can be seeded by composing public stages (the spike's `or_seeded`) | Letters only through the public API; seeding is `pub(crate)` |
| Precreases | Faces merge across F, so two pieces of a face cannot differ in order | Native: F keeps the side |
| Used today | Edit's folded figure, which feeds the canvas, export and Diagram; Edit's 3D figure reuses its search (§7.2) | Not at runtime: CLI, compiler verify, tests |

**Measured on the 1,685-state main corpus** (Beloch frames are clean for both):

| | Flat-Folder (Rust) | Oriedita |
|---|---|---|
| Solve from crease pattern + letters | 18 failures, all from a wrong arrangement | 5 false "no solutions" (60–96 faces) |
| Is the real order among its solutions? | Always, when its arrangement is right (1 miss) | Missing in 23 complete enumerations: 28 states where Edit's ‹ n of m › cannot show the real order |
| Valid solutions found (third judge, 202 states where both enumerated completely) | 11 states had *invalid* outputs; **missed 62 valid solutions Oriedita found**, in 5 states: 2 of the invalid-output states, 2 traced to its arrangement, 1 unexplained (r069-s07) | 0 invalid outputs, but **missed 1,144 of 5,691 valid solutions** |
| Verify our complete order, seeded | 8 false conflicts (arrangement) | 1,685 of 1,685 |
| Stalls | None | "Find another" did not finish in ≥ 8 minutes on 4 stress states; a first solution stalled over 10 minutes on one valid 300-face state |
| Seeded verify at 251–400 faces | 2.7 s (2.46 s of it propagation) | 0.12 s |

**Two defects were pinned to a cause:**

1. **Flat-Folder's arrangement depends on face numbering.** Face 0 sets the
   folded frame the arrangement is built in.
2. **Flat-Folder drops taco-taco constraints depending on face numbering**, even
   on a validated arrangement.
   - In an 8-face repro (`corpus-v2/random/r271-s03.fold`), it finds 1 state
     under our numbering and 2 under area-sorted numbering, and the extra one
     is invalid.
   - The repo's JS oracle reproduces it, so it is upstream behaviour
     (`conversion.js:603` `ExE_fill_BT`).
   - It sits in constraint generation, so constraints built by the caller
     should avoid it **[derived]**.

**One miss is not attributed.** On r069-s07 Flat-Folder found 4 of the 5 valid
orders, with a matching arrangement and the real order verified. Until it is
re-solved through Fold-built constraints and traced to constraint generation
(bypassed) or to the search (a third defect), Flat-Folder's ‹ n of m › is a
count of what it found, not a proven total.

**Conclusion.**

- Neither ported pipeline should run at Fold's runtime.
- Oriedita is the safer *verifier*: seeded, it accepted every valid state.
  But it cannot represent precreased pieces, needs every crease lettered (squash
  and petal leave new creases unlettered), and misses valid orders. So it is an
  oracle, not Fold's solver.
- Flat-Folder's *search* is the right completion engine, fed constraints Fold
  builds itself. That this avoids both of its defects is **[derived]**: the
  defects sit in arrangement and constraint generation, which Fold replaces,
  but no completion over caller-built constraints has run. Every §5 completion
  used Flat-Folder's own constraint generation (`ffBuild`). The entry point
  the plan specifies (D8):
  - the caller passes the variables, the constraint buckets per variable, the
    cell incidence (`faces_cells` / `cells_faces`) and fixed assignments
    tagged *carried* or *seed*;
  - transitivity stays derived inside the search from the caller's cells, as
    `transitivity_constraints` does today. No explicit triple lists: on deep
    stacks they grow cubically;
  - the convex overlay that produces the cells lives in the shared
    `oristudio-layer-order` crate, so the checker, the search and the display
    `subfaces` (§9) agree;
  - carried pairs are not re-propagated (re-propagating cost 2.5 s at 300
    faces); seeds are, with everything they imply. **[derived]** A constraint
    whose pairs are all carried lies among stationary faces or inside one
    block, whose motion preserves it; the checker that validates every state
    (§3.3) stays the backstop;
  - a node or time budget returns "budget exceeded";
  - a port of upstream `error_faces`, which needs parent tracking the port
    does not have yet.

  The prototype (`ffx` `solve_seeded`, about 210 lines) was built from the
  port's private stages over Flat-Folder's *own* arrangement; it seeds,
  re-propagates every fixed pair and has no `error_faces`. The caller-built
  interface above was not built.
- **What Fold and Edit should share is the representation** — the face-order
  type, the constraint problem and one checker — not the search. Edit shares
  it at test time only: its runtime keeps Oriedita (flat, for parity) and
  `folding3d` (3D, §7.2).
- Edit's own ‹ n of m › missing the real order on about 1.7% of these states
  is a separate finding, for the owner.

### 7.2 `folding3d`'s native layer order (Edit's 3D figure)

The repo already has an original, geometry-derived layer-order builder:
`crates/oristudio-cp/src/folding3d/{census,cells,constraints,order}.rs`, about
3.4k lines marked "Ori Studio native", behind Edit's 3D figure. It takes an
overlap census and covering-set cells from geometry, derives taco-taco and
taco-tortilla constraints from chord interleaving (`constraints.rs:1-30`), and
solves per constraint component.

It is not a third model beside §7.1's two. It is a native *constraint builder*
over Oriedita's representation and search: it emits Oriedita `SubFace`s and
equivalence conditions and solves each component with
`WorkerOverlapEnumerator` (`order.rs:56-61`). On a flat document it reproduces
Oriedita's flat answer by test (`tests/folding3d_order.rs:409`). So §7.1's
search findings apply to it.

**Not reused by Fold**, and `oristudio-layer-order` does not replace it:

- its cross-plane couplings and 3D wall rules are outside Fold's flat scope;
- its search is Oriedita's, which misses valid orders and can stall (§7.1);
- it admits only folding-colour creases, so faces merge across precreases
  (`aux_lines.rs:1-8`);
- it builds each figure from scratch, not incrementally.

**What the new crate takes from it:**

- an order that may be cyclic, with undecided pairs reported, never
  tie-broken (`order.rs:23-28`);
- a per-component ‹ n of m › whose first press advances the largest component
  (`order.rs:44-52`);
- `ContradictorySeeds`: two rules that demand opposite orders for one pair are
  refused, naming both, instead of keeping the first (`order.rs:100-110`).

## 8. Axioms on the flat sheet and on folded forms

- **`crates/oristudio-precrease/src/construct.rs` already implements O1–O7.**
  - It is original MIT/Apache code with filters derived from "a fold must align
    in-paper material".
  - O6 solves the cubic in closed form, polishes with Newton and re-checks.
  - It is cross-checked against ReferenceFinder by
    `tools/precrease-rf-crosscheck`.
- **What has to change:** every validity filter asks a rectangular `Sheet`
  (`sheet.rs:78`, `:154-179`, `:189`). A folded silhouette is a union of
  convex faces, often non-convex, and alignment must land on actual material.
  - **[derived]** The solvers lift out cleanly into a small shared crate
    (`line`, `tol`, `pointgrid`, `construct`), with the filters made generic
    over a `Paper` trait.
  - That changes a crate the References planner depends on. The owner
    agreed to the shared crate (§14; plan D9); it is gated on a green
    ReferenceFinder cross-check and the precrease `dump_closure` baselines.
- **References on a folded form** are images of crease-pattern vertices and
  edges, stacked and deduplicated within tol (`PointGrid`, `LineIndex` already
  do this).
  - Each must carry its *provenance*: sheet vertex ids and face lineage, so a
    step's inputs survive later steps.
  - Their *visibility* depends on the layer order.
- **Divide-line marks** are reference annotations outside the state (plan D6).
  - A mark goes on the top visible layer at the pick. It is visible to the
    descendants of the node where it was made, and is excluded from `fh1` and
    `fs1` (§10).
  - An axiom input made on a mark stores the resolved sheet point. The mark id
    is kept only for provenance and the step's sentence, so removing a mark
    cannot break a step.
- **Who moves.** On a flat sheet either half may move. On a folded form, the
  moving feature must be on a face the fold moves, so axiom candidates are
  filtered after the moving set is known.
- **The Oriedita construction ops** (`operations/construction.rs`) are drawing
  tools, with no O2 or O6. Their pick-inputs → candidates → choose-root flow is
  a good interaction model (`cp-workspace/tools/inputModelRegistry.ts:26-79`).
- **ReferenceFinder** is GPL C++ with a non-reentrant O6 and a NaN path in its
  double-root branch (`refLineP2LP2L.cpp:155`). It is an oracle only.

## 9. Rendering, picking and animation

- **The scene contract already exists**, in two versions. The kernel's
  `OristudioCpFoldedPaperScene` (`faces[]`, `subfaces[].faces_top_to_bottom`,
  `aux_lines`) is schema 1 on `main` (`crates/oristudio-cp/src/folding.rs:669-705`).
  Schema 3, which adds per-face `points` and `sheet_points`, exists only on PR
  #436 (`31e1d6d84`). It feeds:
  - export, through `foldedFlatPaperScene` → `PaperScene` → `paperSceneToSvg`;
  - the Diagram's pictures, spreads, `paperFaces` and mirror axes;
  - the canvas, through `foldedSceneLocalGeometry` → `setFolded`. That is the
    route Edit's *3D* figure takes.

  Edit's *flat* folded figure is drawn on screen from the kernel's render
  snapshot instead, deliberately, for Oriedita parity. So no on-screen surface
  uses the flat-scene route today. That corrects an earlier version of this
  section.

  **The Fold engine should emit a superset of that shape per state.** Every
  existing consumer then works unchanged, and Fold adds per-face transforms and
  the crease list beside it. Fold is based on #436 (plan decision C), so it
  emits schema 3 directly, `points` and `sheet_points` included; only the
  Fold-only fields live in a Fold-owned type that extends the kernel's (plan
  D12).
- **Measured** (`artifacts/fold-spike/reuse/painting/`;
  [r3-reuse-rendering-paper.md](2026-10-08-fold-workspace/r3-reuse-rendering-paper.md)):
  spike states written in that shape went unchanged through the app's own
  `foldedFlatPaperScene`, `paperSceneToSvg` and `foldedSceneLocalGeometry`.
  - **Draw order:** on 7 small, acyclic states, at 21,106 sample points, the
    scene put Fold's top face on top **at every point**. Woven (cyclic)
    states, which need patches, were not exercised.
  - **Ink, SVG only:** precreases came out in the aux pen and this step's
    creases in the diagram-crease pens (the crease-pattern pane checked under
    the Default preset only).
  - **Ink, canvas: not measured, and different today.**
    `foldedSceneLocalGeometry` re-applies the `folded-3d` policy, which draws
    every fold and diagram crease in the edge pen, and the folded channel draws
    no dashes (`apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts:645-662`).
    Canvas-to-export ink parity needs the plan's Phase 5 policy parameter and
    dash slots.
- **The one real cost: Fold must compute `subfaces`.** These are the overlap
  cells of its convex face images, with full stacks. The painter needs them for
  four things:
  - which faces are hidden;
  - draw order;
  - patches for woven components;
  - the Diagram's spreads and layer covers.

  A 40-line convex overlay sufficed in the spike, but it ran only on states of
  up to 8 faces. In production it is the shared overlay in
  `oristudio-layer-order` that also gives the completion search its cells
  (§7.1).
- **Canvas.** Build Fold's panes on a `useCpSurface` hook extracted from
  `ReferencesCpView` (plan D13), which already drives the `CpRenderer` seam
  (`ReferencesCpView.tsx:111-125`). Do not copy that view's roughly 430 lines
  of surface glue a third time (§14), and do not add a mode to
  `CreasePatternWebglCanvas.tsx`: 4,320 lines and three module singletons.
- **Picking:**
  - the topmost face and the stack under the cursor come from a
    point-in-polygon test over `subfaces[].polygon`;
  - snap targets are landmarks the engine emits with provenance (§8),
    hit-tested with `LineHitIndex` and `cpHitRadiusModel`;
  - neither existing snapper is reused. The Diagram's `pictureSnapTarget`
    (`31e1d6d84:apps/web/src/diagram/annotate/pictureSnap.ts`) recovers points
    from a picture and returns only a position and a kind; Edit's
    `nearestCpSnapTarget` is tied to Oriedita parity.
- **Animating a plain fold.**
  - It is exactly two rigid groups: the stationary layers stay in the plane;
    the moving layers rotate ±t·π about ℓ, each group keeping its own stack.
  - **[derived]** With two planes, an eye-point painter's rule is exact, so no
    depth epsilon is needed. Drawn top-down, that rule draws the moving group
    in its before-order until it passes edge-on (90°) and reversed after, since
    the viewer then sees its underside.
  - The endpoints are the real states, and the after-state's order is the
    composed order, with moving pairs reversed. With the reversal past 90°
    the last frame cannot pop; a frame-continuity test at θ → 180° pins it.
- **Two routes to animate.**
  - Top-down projection on `setFolded`, the References precrease route
    (`references/fold/foldPoseGeometry.ts`).
  - A posed mesh on the 3D window path (`folded3dMesh` → `FoldedMeshSource`),
    which the Diagram already reuses for 3D poses.
- **Rejected for animation:**
  - re-running `Fold3dSession` per frame: it re-solves the order and snaps near
    180°;
  - the origami simulator: no collisions, flat rest state, no API to seed it,
    and fold profiles force the CPU solver.
- **Reverse folds have no rigid path.** **[derived;
  [r1-folding3d-sim-animation.md](2026-10-08-fold-workspace/r1-folding3d-sim-animation.md)]**
  At the vertex where the axis meets the spine (sectors θ, π−θ, π−θ, θ), the
  mirror-symmetric rigid branches are the straight fold and the reverse-fold
  branch. They meet only at the flat, unfolded vertex.
  - A rigidly correct reverse fold must open the vertex flat and refold, which
    is the diagrams' "precrease, unfold, refold".
  - So compound steps animate *visually* in legs (spread, move, close) with
    exact endpoints, as the precrease animation already "stretches the truth"
    (`foldSurface.ts:14-24`).
  - The architecture therefore needs a per-operation `StepMotion` with rigid and
    visual kinds.

## 10. Persistence, history and replay

- **The steps are the source of truth.** Each step stores:
  - its operation;
  - the inputs as the user gave them, never face ids; axiom roots as lines in
    the parent node's model frame (§3), everything else as sheet points:
    - a free line as two sheet points on ℓ, at least μ apart;
    - axiom construction references and the side;
    - the direction as given, resolved against the view on the path;
    - a depth seed as a sheet point, mapped to the folded form through its
      face's isometry, with k counted from the side the direction implies;
    - flap seeds as sheet points;
  - every choice it resolved, stored as a result, never as an index or an
    `fs1` digest:
    - the axiom root as its resulting line;
    - the reverse-fold opening;
    - the sink pocket, geometrically;
    - a completion as the assignments of the pair variables that seeds and
      propagation left free;
    - Import CP's full order.

    Faces in a stored choice are keyed by interior sheet-point witnesses.
- **States are derived and cached in memory**, keyed by `FOLD_ENGINE_VERSION`
  and `fh1` as two fields. Replay is deterministic.
  - `fh1` = keyDigest(canonical paper + {op, choices} for each node along the
    path): the path's identity. Marks (§8) and notes are not in it.
  - `fs1` is a fingerprint of the canonical state, independent of face
    numbering. It alone decides drift (a step's `expect`) and a Diagram link's
    staleness (§11). An engine bump alone never marks anything stale.
- **Sheet points survive replay** because every later face is a subset of an
  earlier one (folding only adds creases). Face ids do not survive: they are
  renumbered, and Flat-Folder even re-sorts faces by area.
- **A step whose replay fails** — a construction root vanishes, or a stored
  completion no longer resolves to exactly one state — is marked broken,
  together with every step after it. Nothing is guessed. A step that resolves
  but whose `fs1` differs from its `expect` is *changed*, not broken. An
  unknown operation from a newer build locks itself and the steps after it.
- **Project file.** A project holds an array of sequences, one shown for now
  (plan D7), each with its own `formatVersion`. It lives under a first-class
  `workspace.foldSequences` key behind project reader version 10 (§13,
  decision A); #436 takes reader 9 for the Diagram.
- **Undo** snapshots the sequence document (`snapshotHistory.ts`). Engine
  results are cached by `fh1`, so undo recomputes nothing.

## 11. The Diagram

From [r1-diagram-integration.md](2026-10-08-fold-workspace/r1-diagram-integration.md),
with paths at `31e1d6d84`:

- **A new step source, `fold-step`.** Not a new scope inside `cp`: `cp` means "a
  region of the Edit crease pattern" across about 30 files. It stores:
  - the sequence and step ids;
  - before or after;
  - an `fs1:` fingerprint of the canonical state, which alone decides whether
    the link is current or stale (§10);
  - an `fh1:` digest of the path, which guards against an id that now names a
    different path;
  - the engine version, for diagnostics only: a bump alone never marks the
    link stale;
  - an action summary;
  - the shared `render` pose.

  The picture stays a `scene` with its `paperFaces`.
- **The engine contract.** Per state, a superset of the kernel scene: per-face
  transforms, the crease list with `madeAt`, and optional face lineage. Per
  step, a `FoldActionGeometry`:
  - the fold line clipped to the silhouette, with visible and hidden spans;
  - the moving faces;
  - a grip point and its image, for the arrow;
  - push or pleat geometry for compound folds.

  The Diagram then generates its existing annotation kinds (`valley-arrow`,
  `mountain-arrow`, `fold-unfold-arrow`, `push-arrow`, `pleat-arrow`,
  `valley-line`, `mountain-line`, `hidden-line`) without re-running anything.
- **Layer order is not a choice there.** There is no ‹ Layer order n of m › on a
  Fold step.
- **Sequencing.** PR #436 is frozen; further Diagram features are their own PRs
  based on it. Fold is built in parallel on a branch from #436's head
  (`568e02a60`, plan decision C), so the Diagram link need not wait for the
  merge; conflicts are resolved when #436 lands on `main`.

## 12. Performance

Measured in the spike (Node 26, Apple Silicon; [r2-spike-core.md](2026-10-08-fold-workspace/r2-spike-core.md)):

| Faces | Fold op (mean) | Flat-Folder full verify | Independent checker |
|---|---|---|---|
| ≤ 8 | 0.06 ms | 0.4 ms | < 1 ms |
| 33–64 | 1.2 ms | 206 ms | 10–30 ms |
| 129–256 | 9.1 ms | 1.5 s | 0.24–0.4 s |
| 379 | 28 ms | 31 s | 1.4 s |
| 1,906 | 972 ms (order rebuild 915 ms; 1.24M pairs) | — | — |

The fold-op times up to 256 faces are means over the main campaign. The 379
and 1,906 rows are single `perf.mjs` folds, counted by faces after the fold,
with the verifies run on that output state.

- Real models are far smaller than random all-layer folds. Beloch's crane is 60
  faces at step 17. Even so, the order is O(F²) in the worst case.
- **[derived]** The plan's mitigations:
  - incremental order updates that touch only split and moved faces;
  - a bounding-volume index for overlap queries;
  - local, incremental validation;
  - optionally, keying the order on *facets* (faces of the folded-crease
    arrangement, Beloch's "flaps") so dense precrease grids add no pairs.

  Rust should also be several times faster than this JavaScript **[unverified]**.
- **Preview cost is only partly measured.** The fold op alone (split, carry and
  place the order, residual) is about 1 ms at 64 faces and 9 ms at 256 in
  JavaScript. A full preview of the landed state also needs the state's
  validation, the `subfaces` overlay (run only up to 8 faces), the
  crease-pattern diff and the landed thumbnail, all unmeasured
  **[unverified]**. Compound previews also need completion (518 ms mean at
  129–256 faces, §5.2), so they belong on an explicit pick, not a pointer move.

## 13. Refuted claims, risks and open questions

**Refuted or qualified during this investigation:**

1. "One tolerance is enough." It also needs exact line snapping and a minimum
   feature μ, and μ = 1e-4 was not enough.
2. "Flat-Folder verification is turnkey." Its arrangement is wrong for about 7%
   of states unless validated and retried.
3. "A tuck is a deterministic placement." 56% of random tucks were valid.
4. "Moving–moving triples never need updating." True only inside one declared
   block. On Beloch's reverse-fold fixtures 21 of 25 tip pairs that share one
   reflection flip their FOLD sign — the cross-block ones (§3.1).
5. "A squash creases both layers on one line." Only when symmetric.
6. "Folded in half twice, then squash, is the preliminary base." It is the
   waterbomb base.
7. "The crease change plus pinned orders determines a sink." Not without
   letters: 11 completions.
8. "Reusing a precreased ring's letters gives a sink." It gives a plain fold.
9. "Reverse folds are a block-placement rule." Beloch's per-pair rules are
   wrong in about 1.1% of inside and 2.0% of outside reverse folds, and 9% of
   tucks; the over/under-T rule decides vacuous pairs, and the body-relative
   outside variant tried here creates cycles (84 cases). Fixed pairs plus
   completion fixes this (99.3–99.4% unique).
10. "One opening per tip" (Beloch). It cannot express reversing stacked flaps,
    each at its own layers.
11. "A crimp is two reverse folds." The first alone is invalid in about 5% of
    valid crimps, so a crimp is one operation.
12. "μ on vertex–line distances covers the numerics." A reflected vertex can land
    1.6e-4 inside another layer, and a 0.001° tilt leaves a 7e-6 sliver, so
    image–image near-coincidences need their own guard (§6, **[derived]**).

**Corrected after the adversarial review** (claims an earlier draft of this
document made):

13. "Faces that share a motion keep their relation." Equal end isometries do
    not make one block; carrying by them turns a reverse fold into a plain
    fold (§3.1, §5.1).
14. "Snapping is a sub-tolerance adjustment." Unchecked, it turned ℓ by 0.86°;
    a snap may not change any vertex's class (§4.2).
15. "6,123 folds wrapped a hinge." 1,497 did; 6,123 is the count of wrapped
    hinge edges (§4.3).
16. "Import CP picks 1 of 18 orders." 18 is the count without letters; the
    letters admit exactly 1 (§5.5).
17. "Mixed crimps are never valid." As one op they are valid in 8.4–13.5% of
    random ops; a crimp is same-kind by definition (§5.2).
18. "Sink depth is a precondition." Deep sinks stay valid; only the count of
    completions without letters rises (§5.4).
19. "The seeded prototype (about 210 lines) is the entry point Fold needs, and avoids both
    defects." It ran over Flat-Folder's own arrangement and re-propagated its
    seeds; the bypass is derived (§7.1).
20. "Flat-Folder finds every valid order when its arrangement is right." It
    missed 62 that Oriedita found, in 5 states, one unexplained (§7.1).
21. "Oriedita must reach `Solved`" as a test oracle. Only seeded verification is
    an oracle (§7).
22. "Kernel scene schema 3 is the contract on `main`." It exists only on PR
    #436 (§9).
23. "A plain fold previews per pointer move in 1–9 ms." Only the fold op was
    timed (§12).

**Risks:**

- **No proof of the plain-fold rule.** It is consistent with 52,937 checked
  folds, which is strong evidence but not a proof. The engine validates
  every step anyway, so a counterexample would surface as a refusal, not as
  corrupt state.
- **Compound-fold preconditions** are measured on bases with ≤ 32 faces. Thick
  flaps, 3+ stacks, multi-vertex collapses and double sinks are untested.
- **Motion is not validated.** A valid end state may not be reachable by the
  named manoeuvre.
- **Completion over caller-built constraints is unbuilt.** The bypass of
  Flat-Folder's defects and a trustworthy ‹ n of m › total both rest on it, and
  r069-s07 is unexplained (§7.1).
- **Interaction with Diagram work in flight.** Both edit the same seams:
  workspace unions, the project reader version, the keyboard scope precedence,
  the folded scene schema (`folding.rs`, `oristudioCpTypes.ts`),
  `paperStyleResolve.ts`, and `foldedFlatScene.ts`, whose `foldedFlatPaperScene`
  #436 refactors.

**Decided with the owner (2026-10-08)** (plan: "Settled with the owner"):

1. One fold sequence per project, or several? An array of sequences, one shown
   for now (plan D7).
2. The default fold scope? All layers on the moving side, narrowed by picking
   flaps, with a preview of what moves.
3. Lifting the axiom solvers out of `oristudio-precrease`? Agreed: a shared
   geometry crate (plan D9), gated on the precrease baselines and the
   ReferenceFinder cross-check.
4. Near misses below μ? Snap to an offered landmark, otherwise refuse and name
   the vertex.
5. Cache derived states in the file, or replay? Replay on open, cache in
   memory.
6. Before/after semantics of a Diagram step? Decided at the Diagram link.

Also decided the same day (plan decisions A–C; the evidence is in §14):

- **A.** `foldSequences` is a first-class `workspace.foldSequences` key behind
  project reader version 10, not the file-level `extensions` bag. That bag is a
  forward-compatibility carry-through, untyped and never read as a feature.
- **B.** Shared CSS-block moves, and every behaviour-preserving extraction, land
  as pre-work PRs ahead of the Fold feature PRs.
- **C.** Fold branches off #436's current head and is built in parallel;
  conflicts are fixed when #436 merges.

## 14. Reuse audit: what to share, what to own

The owner asked where reusing or abstracting existing work beats writing Fold
its own, "even if it would be harder / take longer". Five audits answered it
with probes: [r3-reuse-geometry-cp-io.md](2026-10-08-fold-workspace/r3-reuse-geometry-cp-io.md),
[r3-reuse-rendering-paper.md](2026-10-08-fold-workspace/r3-reuse-rendering-paper.md),
[r3-reuse-ui-design-system.md](2026-10-08-fold-workspace/r3-reuse-ui-design-system.md),
[r3-reuse-steps-documents.md](2026-10-08-fold-workspace/r3-reuse-steps-documents.md)
and [r3-reuse-solver.md](2026-10-08-fold-workspace/r3-reuse-solver.md) (§7.1).
The plan's "Reuse map" turns these into decisions; the summary is here, and
the full evidence is in those reports.

**Shared geometry crate (agreed).** A `Paper` trait can replace the rectangular
`Sheet` in the O1–O7 filters with **no change to precrease's output**:

- 600,000 random constructions on three sheet shapes, 586,300 roots, **0 bit
  mismatches** (`artifacts/fold-spike/reuse/geometry/`, `reuse-geometry-probe`).
- A union-of-convex-faces paper implements the same trait. On a square folded in
  half it filters out roots whose alignment does not land on material, as
  intended.
- Gates: `dump_closure` sha256 baselines (the probe measured hash prefixes on
  three fixtures; full hashes for every precrease fixture, with and without
  `--plan`, are the plan's Phase 1a first commit); the ReferenceFinder
  cross-check; the precrease and wasm tests. The probe tested the `Paper`-trait
  filters on a generic copy, so the baselines, not the probe, are the evidence
  for the move itself.
- Convex-polygon primitives (clip, ε-aware half-plane split, SAT penetration,
  point-in-convex) get one owner, a `convex` module in the shared crate, ported
  from the spike. The overlay that builds cells from them lives in
  `oristudio-layer-order` (§7).
- The Oriedita construction ops do **not** move. They are parity code with their
  own epsilon table.
- Precrease's `outline.rs` moves too, unchanged and still rectangle-only, so
  Import CP can find the imported sheet without depending on the planner crate
  (§5.5).

**The CP kernel is a lossless boundary, not Fold's state.**

- The kernel model cannot be Fold's state. It has:
  - no stable edge ids (renumbered on delete) and no faces;
  - no place for a flat crease that remembers its letter, except U + a hint;
  - no `madeAt`;
  - Oriedita's coordinates and tolerances.
- But a one-way conversion in Rust round-trips through the kernel's own FOLD
  writer and reader with 0 coordinate drift, colours and hints kept, and the
  folding colours fold to **Solved** (`kernel_roundtrip`).
- μ = 10⁻³ of the sheet is 1,600× the kernel's vertex weld, so the kernel never
  merges Fold vertices.
- That one function serves three jobs: Send to Edit (through the existing
  `importAddOristudioCpText` chokepoint four workspaces already use), `.cp` /
  `.ori` / `.orh` export, and the Oriedita oracle. The crease-pattern pane does
  not need it: it paints and hit-tests Fold's own geometry, in the pane's frame
  and with provenance.
- `oristudio-fold-wasm` enables the `kernel` feature by default, and its wasm
  size is measured with and without it. If that cost is large, the browser
  jobs route through the existing CP worker instead.

**Painting** (§9): one system already exists:

- `PaperStyle`, plus the per-surface `PAPER_STYLE_POLICIES`;
- `paperFaceFill` / `penForRole`, shared by the SVG and WebGL painters.

Fold should be one more consumer.

- **The WebGL surface glue** already has a copy that Fold would make a third:
  about 430 lines of `ReferencesCpView` that duplicate the Edit canvas. Hence
  the `useCpSurface` extraction (§9).
- **The Front/Back colour rows are not copies of one thing.** The folded
  figure's and inline simulation's rows (`foldedFigureProperties`,
  `inlineSimulationProperties`) pin a value on one object as an undoable
  document edit, and already share `cp-workspace/paper/paperStyleFields.ts`.
  Simulate's pane writes the app's display style as a preference, through
  `simulator/useSimulatorPaperStyle`. Fold's Paper tab is the second kind. It
  binds to the display style through a generalised version of that binding
  (its own analytics source, and only the fields its rows own, so its reset
  cannot clobber pens it does not show), and shares Simulate's Front/Back rows.
  The per-object catalogs stay as they are.

The design's "colour side / white side" has no meaning in the style: the presets
disagree about which face is coloured. It is the sequence's starting side, and
letters stay front-relative whichever side starts up (§3.1).

**Documents.**

- The Diagram half-built a lenient-reader kit: `NEWER`, `hasNewerKey`, carrying
  unknown entries verbatim, id dedup, read-only on a newer version.
- `function isRecord` is copied in 13 files on `main` and 20 on #436.
- A step *model* should not be shared. The three differ in kind:
  - the Diagram's list is reordered freely;
  - Fold's tree is append-only;
  - References' plan is derived.
- The file-level `extensions` bag has been carried unchanged by every release
  since v0.2.0. It would have been a no-refusal home for `foldSequences`, but it
  is untyped and contradicts the house rule in `superset-features.md`. The owner
  chose a first-class key behind reader version 10 instead (decision A, §13).
- Embedding an imported crease pattern as a compact string costs about a third
  of nested arrays (kabuto: 722 B against 2,686 B).

**UI.**

- Every element of the design maps to an existing component as it is, or with
  one prop, except:
  - the cross-section layer picker. Its rows must be display layers (faces
    joined across F creases, so a precrease does not split one layer into
    two), and they are only partially ordered along ℓ, since no global z
    exists (§2.1);
  - the two-canvas split;
  - a danger tone with actions on `Notice`.
- Several primitives exist only on the frozen Diagram PR: `ui/ToolRail`,
  `ToolHintInstructions`, `Notice`, `useModalDialog`. Fold is based on #436, so
  they are available (decision C, §13). The
  conditional-scope keyboard pattern is not among them: it is on `main` with
  two users (simulator, references), and #436 adds a third.
- References' step filmstrip fits the design almost exactly (its "ways" are the
  design's branch "1/2") but sits in a **shared CSS block**. Moving it is a
  pre-work PR (AGENTS.md; decision B, §13). The other two candidates need no
  block move:
  - the Steps grid comes from #436's CSS-module `DiagramStepsGrid`, not
    `SheetGrid`;
  - Edit's candidate window is generalised in TypeScript only.

**Beloch's role.** Reference and test material only. No code was ported, and
the engine differs where the spikes measured Beloch's choices to be wrong or
limited:

- a pairwise order, not a total rank;
- f64 with snapping, not exact algebra;
- completion, not per-pair placement rules;
- per-flap openings;
- a crimp as one operation.

Its MIT FOLD fixtures (all valid under Flat-Folder) are usable as goldens, with
attribution.

---

## Appendix: spike inventory

All under `artifacts/fold-spike/` (gitignored, local to this worktree).

| Folder | What | Run |
|---|---|---|
| `core/` | State model, plain fold, Flat-Folder verifier, independent checker, torture campaigns, classics with SVG renders | `node artifacts/fold-spike/core/test-golden.mjs`, `test-random.mjs`, `test-wrap.mjs`; `renders/index.html` |
| `beloch-oracle/` | Beloch fixtures checked by Flat-Folder; triple-invariance by verb | `verify-beloch-fold.mjs`, `triple-invariance.mjs` |
| `compound/squash-petal-rabbit/` | Squash, petal, rabbit ear and swivel; fan vs crease-diff comparison; random squash campaign | `node …/cases.mjs`; `campaign.mjs --seqs 1000 --seed 7` |
| `compound/sinks/` | Crease-pattern importer; open, closed and unsink; completions census | see its `README.md`; `renders/index.html` |
| `compound/reverse-crimp-tuck/b/` | Reverse folds (per-flap openings), crimps as one op, tucks with bounded closure; rule vs completion campaigns | `node …/b/cases.mjs`; `campaign-reverse.mjs --n 1500 --seed 1`; `campaign-crimp.mjs`, `campaign-tuck.mjs`; `renders/index.html` |
| `reuse/solver/` | Oriedita vs Flat-Folder on 2,752 Fold states; seeded-completion prototype over Flat-Folder's own arrangement (`ffx/`); third-judge script | `cargo run --release --manifest-path artifacts/fold-spike/reuse/solver/Cargo.toml`; `summarize.mjs` |
| `reuse/geometry/` | `Paper` trait probe (600k constructions bit-identical); kernel round trip | `cargo run --release --manifest-path artifacts/fold-spike/reuse/geometry/Cargo.toml --bin reuse-geometry-probe` (and `--bin kernel_roundtrip`) |
| `reuse/painting/` | Fold states through the app's own painters | vitest with Node 22, config `artifacts/fold-spike/reuse/painting/vitest.config.mjs` |
| `reuse/step-model/` | Size of embedded crease patterns in the pretty-printed `.osf` | `node artifacts/fold-spike/reuse/step-model/embed-size.mjs` |

The reports behind this document — round 1 (codebase readers and prior-art
surveys), round 2 (the spikes above and the Beloch deep-read) and round 3 (the
reuse audits) — are committed beside it in
[`2026-10-08-fold-workspace/`](2026-10-08-fold-workspace/README.md); its README
lists each file and what it covers. They are working notes kept as written;
where one disagrees with this document, this document wins.
