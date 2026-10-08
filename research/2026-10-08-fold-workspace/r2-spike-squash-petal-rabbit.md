# Compound-fold spike: squash, petal, rabbit ear (plus a swivel-type vertex)

Everything lives in `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced/artifacts/fold-spike/compound/squash-petal-rabbit/` (gitignored). Paths below are relative to that folder. The core spike is imported read-only, no tracked file changed (`git status` is clean), and there are no dependencies. Runs on Node 26.8.1.

- `node cases.mjs` (about 1.4 s) rebuilds `results/cases.json`, `results/summary.txt`, 21 FOLD files in `results/`, and 100 SVGs plus `renders/index.html` (the contact sheet).
- `node campaign.mjs --seqs 1000 --seed 7` rebuilds `results/campaign.json`.

## Summary

- **All three target bases came out right, checked against references.**
  - Two squashes (diagonal route) give the **preliminary base**. Its folded creases match Beloch's `side-preliminary-1.fold` exactly (under a reflection of the square, no letter swap).
  - Two petal folds on top of that give the **bird base**. Its folded creases match Beloch's `bird-base-petal.fold` exactly (same reflection, no swap).
  - Each final state passed the Flat-Folder (FF) verifier and the independent checker. FF, solving from the crease pattern (CP) plus letters, finds exactly 1 state for each.
- **The case-1 recipe in the task is wrong.** "Square folded in half twice, squash the top flap into a triangle" gives the **waterbomb base**, not the preliminary base: diagonals V, one midline M, the other midline flat. Compared against the preliminary fixture it correctly fails (1 segment missing, 1 extra). The preliminary base needs the diagonal route: fold diagonally twice, squash into a square.
- **Recommended construction: (b), CP diff plus seeded Flat-Folder completion.** Both constructions use the same geometry: score the faces, change hinges, derive isometries by BFS from the stayer. They differ in how the operation is specified and how the order is found.
  - In (b), completion takes ≤ 2 ms per op typically and 20.4 ms at most on these states (≤ 24 faces). Carried pairs alone leave 1–9 valid orders.
  - Adding a **direction seed** (moving pieces above the stationary layers they overlap, i.e. valley) made every squash and petal unique.
  - The rabbit ear needs one more input: which ray is the ridge. Giving the letters of the creases in the anchor layer makes **every** operation unique (22 of 22 ops).
- **(a), the fan with hinge enumeration, is ambiguous and its stacking search blows up.**
  - Rays at a vertex do not say which existing hinges change. The squash rays close in 4 hinge interpretations (5 to 10 valid flat states); the petal segments close in 4 of 1,024 (12 to 24 states). In each case exactly one is the intended move.
  - Block-placement stacking found the target in 15 of 15 runs, and it was always the "all blocks on top" placement. But at 5 moving blocks (the petal) the space is 13.8M and 39.1M combinations: capped at 50k, it found only 2 of 4 and 3 of 9 of FF's states.
- **Theory check on the squash: a single shared table axis is not general.**
  - The two layers crease on one table line only when the spine lands on the hinge line. For any other target, the flipping layer's crease mirrors the lower layer's about the bisector of hinge and spine (derivation in the squash section).
  - With one shared axis, the residual is 0.342 at a 200° target. With per-layer axes it closes at 2.5e-16 and verifies.
  - Beloch ADR 0038 says the two creases are one table line. In these measurements that holds only for the symmetric squash.
- **Random squash campaign:** 3,000 attempts on 1,000 random folded states; 678 met the macro's preconditions.
  - Every squash of a free flap (attached to the rest only along the hinge line) closed: 491 of 491, symmetric and asymmetric.
  - Every free, uncovered flap verified and was unique under the direction seed: 416 of 416.
  - All 157 failures to close had the flap attached somewhere off the hinge line.
  - 59 squashes closed but had no flat completion. In all 59 the new CP is flat-foldable from scratch (4 to 52 states), but not while keeping the other layers' order: the flap is covered, so the move is blocked.
- **New gate required:** a residual check is not enough to call geometry valid. One accepted state failed verification because a folded edge's two faces had the same orientation. Production needs a hinge-consistency check (folded edge ⇔ opposite orientations), now `lib.mjs:574`. Spike bugs found on the way are listed under Failure modes.

## Method (both constructions)

The shared lower layer (`lib.mjs`) has four steps:

1. **Score.** Split chosen faces along a line, segment, or fan rays (`scoreLine` :173, `scoreSegment` :193, `scoreFan` :213). Pieces are rebuilt in sheet coordinates (`rebuild` :72): vertices snap within tol, T-junctions are fixed, edges inherit their assignment, and new chords are `F` tagged `fresh`.
2. **Change hinges.** `setHinges` :281 folds (`F`→`X`) or unfolds (`M/V`→`F`), then re-derives every isometry by core BFS from a stayer face.
3. **Gate.** Residual ≤ tol and `hingeInconsistency` = 0.
4. **Carry order.** `carryOrder` :323 keeps the old order of each overlapping pair whose two faces share a motion: kept if the motion is a rotation, reversed if it is a reflection. This generalises the core's "moving–moving FOLD orders need no update" to "same-motion pairs need no update".

The two constructions then differ:

- **(b) CP diff plus seeded completion.** Macros in `ops.mjs` compute the diff. `ffComplete` :368 seeds FF with the carried pairs (optionally with letters or a direction seed, :556), propagates, solves and counts the solutions. Variants measured on every op:
  - **b0**: carried pairs only.
  - **top / bottom**: plus the direction seed.
  - **letters(anchor)**: plus the letters of the new creases in the anchor layer.
  - **letters(all)**: plus the letters of every new crease.
- **(a) Beloch-style fan** (`fan.mjs:61`). This is my implementation, not Beloch's code.
  - Scores the tip faces along the fan's segments or rays. Fresh chords always fold, as in Beloch's "a ray names its crease in every layer of the tip".
  - Tries keep/change for every existing hinge on a fan line that touches the tip, and keeps the combinations that pass the gate.
  - For each, groups faces into blocks by motion and enumerates placements per moving block (top, bottom, over T, under T) times block permutations (`placements` :163).
  - It differs from Beloch in two ways: Beloch ranks per-(wedge, motion) units by linear extension, and its flatten is single-vertex. Segments let the fan cover the two-vertex petal.
- **Verification** for every chosen state:
  - core `verify` with `solve:true`;
  - core `indepCheck`;
  - FF solving from the CP plus letters;
  - negative controls: every ordered pair flipped once (332 flips over 21 states; all rejected by both FF and indep).
- **Target matching across constructions** uses a face-index-free signature, `canonSig` (`lib.mjs:603`).

## Squash

**Operational definition** (`ops.mjs:25`):

- **Inputs:**
  - a point *p* on the flap: the top two faces there are P (upper) and Q (lower);
  - an optional spine target *t* (default: the hinge line, i.e. the symmetric squash);
  - valley or mountain (the direction seed).
- **Derived:**
  - spine *s*: the folded P–Q edge;
  - vertex O: the end of the spine where P hinges to a face outside the flap;
  - hinge direction *h*;
  - flap wedge D = angle(h→s), |D| < 180°;
  - μ = angle(h→t)/D.
- **Preconditions:** a two-face flap with a folded spine, and a hinge at one end of the spine. For a guaranteed flat result the flap must be free (attached only along the h line) and uncovered (campaign below).
- **CP change:**
  - Q creases along h + (1+μ)D/2, the bisector of s and t;
  - P creases along h + (1−μ)D/2;
  - the spine unfolds;
  - P's hinge on h toggles (unfold if folded, fold if flat).
  - The two creases fall on one table line only when μ = 0.
- **Why:** with the spine flat, P′ shares Q′'s motion R_cQ composed with R_s. P_stat moves by R_h. The P crease between them must therefore be the reflection R_h ∘ R_cQ ∘ R_s, whose line sits at angle h + (s−t)/2.
- **Measured motions** (1a front), 4 motion blocks:
  - Q′: reflection across the axis;
  - P′: rotation about O;
  - P_stat: reflection across h;
  - everything else: identity.
  - This matches the motions in Beloch ADR 0044's table (reflection, a 45° rotation, reflection across the axis).
- **Order rule:** carry, then direction seed `top`, then FF.

**Results:**

| op | changes | b0 | top | letters(anchor) | (a) fan: closing combos / valid states | target placement |
|---|---|---|---|---|---|---|
| 1a front (midline square) | 2 fold, 2 unfold | 1 | 1 | 1 (1 crease) | 4 of 8 / 5 | all-top |
| 1a back (after turn-over) | 3 fold, 1 unfold | **3** | 1 | 1 (2) | 4 of 8 / 10 | all-top |
| 1b front (diagonal triangle) | 2 / 2 | 1 | 1 | 1 (1) | 4 of 8 / 5 | all-top |
| 1b back | 3 / 1 | **3** | 1 | 1 (2) | 4 of 8 / 10 | all-top |
| 1a asymmetric, per-layer axes (t = 200°) | 2 / 2 | 1 | 1 | 1 | – | – |
| 1a asymmetric, one shared axis | does not close, residual 0.342 | | | | | |
| 1a, lower layer flips instead | closes; FF taco-tortilla conflict, 0 states | | | | | |

- **Fan interpretations of the rays c, h, s.** There are 3 optional hinges (P's and Q's on h, plus the spine), so 8 combinations. Four of them close:
  1. Fresh chords only: a simple fold of the flap tip (2 states).
  2. Both layers' h-hinges unfold (2 states).
  3. Spine plus Q's hinge: FF taco-tortilla conflict, no state.
  4. Spine plus P's hinge: the squash.
- **Why the back squash has 3 completions.** Its moving pieces land on layers that moved in the first squash. The two non-intended completions are valid flat states with different letters (one diagonal half M), and FF finds a unique state for each one. The direction seed removes them.
- **Sensitivity of the shared-axis squash** (`campaign.json` `perturb`):
  - With the axis rotated δ off the bisector, the residual is ≈ 2δ: 0.020 at δ = 1e-2, 2.0e-4 at δ = 1e-4.
  - For δ ≤ 1e-6 vertex snapping absorbs it (residual 2.2e-16).
  - With per-layer axes every δ closes (≤ 5.6e-16). So a UI must derive the axes from (flap, target); a free-drawn line will not do.
- **Random campaign:** see the summary; categories are in `results/campaign.json`.
  - For flaps with a valid completion, carried pairs alone gave 1 state in 339 cases, 2 in 115, 3 in 6, 4 in 2.
  - The direction seed never gave more than 1. It gave exactly 1 for all 416 free, uncovered flaps, and none for 17 of the 21 covered free flaps that still verified (those need a mixed placement).
  - Completion p50 1.1 ms, p95 2.9 ms (three FF runs per attempt).

## Petal

**Operational definition** (`ops.mjs:110`):

- **Inputs:**
  - the flap (one point per side);
  - the ends PL and PR of H, on the flap's closed edges;
  - the open corner Bo, where the kite creases meet;
  - valley or mountain.
- **Precondition:** the kite creases (top two layers) and H (all layers) are precreased; here with core `foldAndUnfold`.
- **CP change (8 hinges):**
  - fold H in the top layer (2 segments);
  - fold the 4 kite segments in the top two layers;
  - unfold the 2 closed-edge hinges between layers 1 and 2, from PL and PR outward.
  - In Beloch's bird base those edge segments are also `F`, which is consistent.
- **Motions** (6 blocks measured):
  - petal: R_H;
  - top-layer side pieces: R_H ∘ R_kite;
  - second-layer side pieces: R_kite;
  - everything else: identity.
  - At PL the three lines H, the kite crease and the closed edge meet, so the three-reflection product is a single reflection: the second layer creases on the same kite line.

**Results:**

| op | b0 | top | letters(anchor 4) | (a) fan: closing combos / states | placement search |
|---|---|---|---|---|---|
| petal front | 4 | 1 | 1 | 4 of 1,024 / 12 | space 13,824,000, capped at 50,001; found 2 of 4; target all-top |
| petal back | 9 | 1 | 1 | 4 of 1,024 / 24 | space 39,137,280, capped; found 3 of 9; target all-top |

- **What the fan's closing interpretations are:** the left kite fold alone, the right alone, both, and the petal. Gating is strong: 1,024 combinations reduce to 4.
- **Cost:** about 50 ms for hinge enumeration plus FF. Placements dominate (331–429 ms).
- **Beloch comparison:** the petal is a fan at two vertices joined by H. Beloch's flatten is single-vertex, and its two-vertex collapse (issue #231) is still open.

## Rabbit ear

**Operational definition** (`ops.mjs:192`; emergent rays at :159):

- **Inputs:**
  - the triangle (folded corners), giving the incenter I and three bisector rays;
  - the emergent ray, one Kawasaki candidate per gap, at most 3;
  - the layers;
  - the stayer point;
  - valley or mountain;
  - and the ridge (the letter of one ear ray).
- **CP change:** 4 new creases through the chosen layers. No existing hinge lies on a ray in these cases, so the fan has 0 optional hinges and (a) and (b) share the same single geometry.
- **Closure:** an emergent ray that runs into a hinge to stationary paper does not close. Measured:
  - top layer only, toward the spine: residual 0.586;
  - flat square, across the flat diagonal: 0.586 (consistent with Beloch's stayer convention, which excludes it);
  - kite flap, toward its hinge: 0.332.

**Results:**

| op | b0 | top | bottom | letters(anchor) | FF states from CP plus letters |
|---|---|---|---|---|---|
| 2-layer triangle, both layers, emergent 180° / 270° | 4 / 4 | 2 / 2 | 2 / 2 | 1 / 1 | **3** / **3** |
| 2-layer triangle, both layers, emergent 45° | 6 | 1 | 1 | 1 | 1 |
| top layer only, 180° / 270° | 4 / 4 | 2 / 2 | 0 / 0 | 1 / 1 | 1 / 1 |
| flat square (Beloch's incenter ear), 270° / 0° | 4 / 4 | 2 / 2 | 2 / 2 | 1 / 1 | 1 / 1 |
| fish base ear 1, ear 2 (ear 2 on the folded state) | 4, 4 | 2, 2 | 2, 2 | 1, 1 | 1, 1 |
| kite flap, 135° / 45° | 4 / 4 | 2 / 2 | 0 / 0 | 1 / 1 | 1 / 1 |

- **Ambiguity under the direction seed:** the two "top" states differ only in which ear ray is the ridge. In the top layer: sol0 has (−135° V, 180° M), sol1 has (−135° M, 180° V).
- **Store the order:** for both layers with the leg emergents, CP plus letters still has 3 states.
- **Fish base:** its final creases are recorded in `cases.json` (`3d-fish-final`). There is no Beloch FOLD fixture for it, so it was compared by structure only: verified, degree-4 vertices at the incenters.

## Swivel (partial)

Only a free 4-ray vertex on a flat sheet was tested (the analogue of Beloch's `swivel-rabbit.bel`): O = (0.5, 0.3), rays toward (1, 0.6), (0, 0.6) and down the spine.

- There are 3 emergent candidates (90°, 208°, 332°) and all close.
- Carried pairs give 6, 4 and 4 states; the top seed 1; letters 1.
- A classic swivel on folded paper was not tested.

## Mapping to engine primitives

1. **`score(faces, line | segment | fan)`** is a pure CP edit; geometry does not change.
2. **`hingeDiff(edges → fold | unfold)`** is the CP diff.
3. **`derive(stayer)`** does the BFS, then the gate (residual ≤ tol and hinge consistency).
4. **`order`** = carry(same motion) ∪ seeds (direction, placement, letters), completed by FF to a solution set, with letters derived from the order.
5. **Operation macros** compile user input into (scores, diff, stayer, seeds):
   - **Simple fold** (core): one line, closure U, direction seed.
   - **Squash:** one vertex, a chord per layer, spine unfold plus P's h-hinge toggle.
   - **Petal:** two vertices over precreases, 8 hinge changes.
   - **Rabbit ear and swivel:** one interior vertex with 4 rays.

"Reflect blocks with placements" maps onto this as follows: its blocks are the motion groups, and its placements are a seed vocabulary for choosing among FF's solutions, not a solver. The fan with hinge enumeration fits as an interpretation search behind a free "collapse" tool.

## Verification table

| op | closes (residual) | FF / indep on chosen | FF from CP plus letters | negative controls (FF, indep) | reference |
|---|---|---|---|---|---|
| 1a front, 1a back | 2.2e-16, 0 | ok / ok | 1, 1 | 7/7, 12/12 | 1a final: waterbomb pattern, match |
| 1a asymmetric per-layer | 2.5e-16 | ok / ok | 1 | 10/10 | – |
| 1b front, 1b back | 4.4e-16, 6.7e-16 | ok / ok | 1, 1 | 7/7, 12/12 | Beloch `side-preliminary-1.fold`, match |
| petal front, back | 6.9e-16, 1.2e-15 | ok / ok | 1, 1 | 42/42, 68/68 | Beloch `bird-base-petal.fold`, match |
| rabbit ears 3a–3e (11 closing ops) | ≤ 1.7e-15 | ok / ok | 1, or 3 for 3a at 180°/270° | 6–28 each, all rejected | – |
| swivel vertex (3 ops) | ≤ 1.7e-15 | ok / ok | 1 | 6/6 each | – |

Every FF arrangement on a chosen state built first time (0 eps retries).

## Ambiguities and user inputs

- **Squash:** flap, target (default: the hinge line), direction.
  - Without the macro's rule there are 4 hinge interpretations.
  - Flipping the lower layer instead was invalid in the one case tried (1a front).
  - Covered flaps need a placement other than top.
- **Petal:** flap, H (or PL and PR), direction.
  - The precreases must exist, or the macro must score H in the top layer only.
- **Rabbit ear:** triangle or vertex, emergent ray (up to 3), layers, stayer, direction, ridge.
  - Both layers versus top layer is a real choice. By ADR 0037's text (not run), Beloch's tip rule would take only the top layer, because the two layers join only along the spine, inside the stayer's wedge.
- **All operations:** letters on the anchor layer's new creases made the state unique in 22 of 22 ops. A UI can show the alternatives FF finds and let the user cycle through them.

## Failure modes

- **Spike bugs (fixed and rerun):**
  - Taking the vector-sum bisector of s and t: it flips when the angle exceeds 180°, giving 19 false failures to close. Fixed with signed wedge angles (`ops.mjs:50`).
  - Losing the `fresh` tag across chained rebuilds.
  - Choosing a flap piece as the stayer: the frame moved, which made the direction seed meaningless.
  - In the fan path, the stayer child not matching the stayer point.
- **Theory and preconditions:**
  - A shared axis for an asymmetric squash does not close.
  - Extra attachments: all 157 failures to close in the campaign.
  - Covered flaps: 59 blocked moves.
  - An emergent ray crossing a hinge does not close.
- **Engine:**
  - Without the hinge-consistency gate, an inconsistent state reaches the verifier.
  - Block-placement search does not scale.
- **Not exercised here:** the core's FF arrangement-eps problem (clean coordinates, no retries).

## Recommendations

- **Build (b).** Macros emit a CP diff, geometry comes from BFS behind the residual-plus-consistency gate, and order comes from carry, then seeds, then FF. Return the solution count, and offer the alternatives when it is above 1.
- **Represent creases per layer.** Have the squash macro compute P's crease from Q's and the target, rather than taking one table line.
- **Defaults:** the direction seed (valley = top). For the rabbit ear, also ask for the ridge or a letter.
- **Keep the fan enumeration as an assistant** for ambiguity detection and free collapse. It is cheap: 8 combinations in milliseconds, 1,024 in about 50 ms.
- **Do not search placements.** Keep them as UI vocabulary.
- **Check preconditions up front** (free flap, uncovered flap) and explain refusals. Store the order.

## Open questions

- Thick flaps (more than 2 layers), and identifying a flap as a closure rather than "top two faces at p". Precondition failures made up 2,322 of 3,000 random attempts, mostly for that reason.
- A petal without precreases.
- Swivels on folded paper; sinks.
- How FF completion scales on large models. The core measured FF verify at up to 33 s on about 380 faces.
- Whether Beloch's tip rule and a top-k pick agree in general.
- A proof that free, uncovered flaps always squash. The evidence is 416 of 416, not a proof.

One core documentation slip: core `README.md` imports `indepCheck` from `index.mjs`, but `index.mjs` does not export it (import it from `indep.mjs`).
