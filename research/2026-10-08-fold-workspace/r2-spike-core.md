# Core simple-fold spike: report

Everything is under `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced/artifacts/fold-spike/core/` (gitignored). Paths below are relative to that directory. No tracked file was changed (`git status` is clean). It runs on Node v26.8.1 with no dependencies.

## Summary

- **The closure/order rule held up.** Across 52,937 applied, independently verified ops, no failure is attributable to the fold rule. Every failure traced to one of four other causes: a spike bug (fixed), a numerics mechanism (fixed by line snapping), a Flat-Folder (FF) arrangement limitation, or tolerance-scale slivers.
  - 45,273 ops in 7 random campaigns (37,508 simple folds, 4,404 fold-and-unfolds, 3,361 turn-overs).
  - 5,219 ops in a residual probe.
  - 2,445 ops in a targeted hinge-wrap campaign.
- **The hinge-wrap worry did not show up.** The targeted campaign (`test-wrap.mjs`, `results/wrap.json`) produced 6,123 hinges that actually wrapped stationary layers, up to 133 layers deep. It also covered 2,085 unfolds and 1,158 refolds. Both verifiers reported 0 failures. This is strong evidence, not a proof.
- **Two verifiers agree.**
  - The FF verifier rejected every one of 189 single-pair corruptions in early runs.
  - The independent checker (`indep.mjs`) agrees with FF on 300/300 valid random states and 284/284 corrupted ones; 282 were rejected by both and 2 were legitimate free choices (`results/indep-calibration.json`).
  - Across the campaigns there are 0 cases where only `indep` failed. The FF-only failures are all sub-tolerance cases explained below.
- **Two numerics policies are required beyond "f64 + one tolerance":**
  - **Line snapping.** Move ℓ exactly through vertex images within tol of it. Without it, a vertex δ ≤ tol off ℓ gives a chord whose direction is wrong by about δ/|chord|. One sequence reached a residual of 7.1e-3.
  - **A minimum feature size μ.** Without it, near-miss lines create faces and overlaps thinner than tol. In 35.5k snap-only ops this caused 5 hard failures and 36 benign events. With μ = 1e-3: 0 in 8.7k ops. With μ = 1e-4: 3 benign events in 4.4k ops.
- **Flat-Folder's arrangement step is unreliable on thin features.**
  - Its eps heuristic (`third_party/flat-folder/src/conversion.js:7`, mirrored in the Rust port `crates/treemaker-flatfold/src/conversion.rs:452-488`) built a wrong arrangement for 3,240 of 45,273 states (7.2%).
  - I validate each arrangement and retry at a finer eps. That resolved all but 2 states, which FF could not verify at any eps; the independent checker passes both.
- **Other claims confirmed:**
  - FOLD `faceOrders` for moving–moving pairs never change: 0 changes in 12,306,950 checks.
  - New-crease letters follow the per-layer flip rule: 0 mismatches in 327,046 chords.
- **The order must be stored.** Given only the CP and its letters, FF found a unique layer order for just 19,608 of 42,020 solved states (46.7%).
- **Performance.**
  - A fold op takes 0.06 ms at ≤8 faces, 9 ms at 129–256 faces, and about 1 s at 1,906 faces.
  - At the large end the order map holds 1.24M pairs and rebuilding it is 94% of the cost.
  - FF verification is the expensive part: up to 33 s per state.

## Conventions (pinned by `test-golden.mjs`: 79 checks, 0 failures)

| Convention | Pinned by |
|---|---|
| Sheet `[0,w]×[0,h]` with the front facing +z; face rings CCW in sheet coords; the viewer is at +z | G1–G12 |
| `T[f]` maps sheet to folded frame; `det = +1` means front-up | G1, G3 |
| `above(f,g)` is absolute: true means f is closer to the viewer | G1, G2, G5, G6 |
| `valley` = the moving block rotates toward the viewer and lands on top; `mountain` = away, lands underneath | G1, G2 |
| A crease letter is derived: **V iff its front-up face lies below**. A valley seen from the back is M in the CP | G1–G4 |
| Through two layers the new chord alternates (V on the front-up layer, M on the face-down layer); the old crease keeps its letter | G5, G6 |
| Folding the top layer's corner after two folds gives an M chord, because that layer shows its back | G7 |
| Turn-over reflects the view across the bounding-box centre; every `above` inverts; letters are unchanged | G3, G4b |
| FOLD export `[f,g,s]`: s = +1 iff `above(f,g) == frontUp(g)`. Matches FF's own `edges_Ff_2_FO` output | G1–G7 |
| FF mapping: variable `[f1,f2]` has BA = 1 iff `above(f1,f2) == (det T[0] < 0)`; FF's folded frame = ours ∘ `T[0]⁻¹` | `verify.mjs` header, G-checks |
| Unfolding a flap that lies on top is a **valley** op, and its hinge becomes F carrying its letter | G10, classics |
| Fold-and-unfold leaves F creases that remember their letter; refold turns F into M/V | G8, G9 |

Negative controls (also in `test-golden.mjs`) confirm the verifier rejects corrupted states:
- flipping any one of the 6 pairs in G5 gives `seeded-conflict`;
- deleting an order gives `overlap-missing`;
- flipping a letter gives `letters`;
- adding an order on a non-overlapping pair gives `overlap-extra`.

## Algorithm as implemented (`fold.mjs`)

0. **Snap ℓ** (`snapLine`, fold.mjs:58). Collect the canonical vertex images within tol of ℓ and cluster them within tol.
   - One cluster: translate ℓ through it.
   - Two or more: use the line through the two farthest clusters, keeping the orientation.
   - Afterwards, if any vertex sits at 1e-9 < |d| ≤ tol, skip the op as `snap-ambiguous`. This happened 12 times in 27k main-campaign attempts.
1. **Classify each vertex once** (fold.mjs:99). Use its canonical image (from the incident face closest to the root): d = σ·sd(ℓ, p), giving class +1, −1, or 0 against tol = 1e-6·max(w,h).
   - Optional min-feature μ: skip as `near-miss` if tol < |d| < μ.
2. **Face sides.** `hasM` / `hasS` per face. The moving-side piece of a face is its image clipped to the moving half-plane (`clipHalfPlane`, geom.mjs:111; points within 1e-12 of the line count as on it).
3. **Seed** (fold.mjs:119). One of: all moving-side pieces; the top-k or bottom-k of the stack at a point; or explicit faces.
4. **Closure U** (fold.mjs:135). BFS from the seed using two rules:
   - (i) **Adjacency** across CP edges that are not on ℓ and have an endpoint of class +1.
   - (ii) **Overlap**: a moving-side piece p is added if its penetration with a piece in U is greater than tol and `above(p,q)` matches the direction (above for valley, below for mountain). For tucks, layers that end above/below the block are exempt.
   - If no face has a stationary part, skip as `all-moving`.
5. **Split** only faces with both `hasM` and `hasS` whose moving piece is in U (fold.mjs:199).
   - Each crossed CP edge gets one new vertex at the sheet parameter t = d_lo/(d_lo − d_hi).
   - Endpoint snapping cannot fire: t·len ≥ |d_lo| > tol, so it fired 0 times.
   - The ring splits at exactly two −1/+1 transitions, each through exactly one 0-vertex (fold.mjs:255); anything else is skipped as `degenerate-split`, which never occurred.
   - With μ > 0, also reject edges shorter than μ and pieces with area/diameter < μ/2.
6. **New CP.**
   - Split edges are halved and keep their assignment; chords are marked `X` (folded, letter pending).
   - Edges on ℓ that separate a moving and a stationary face toggle: F becomes X (refold, previous letter kept); M/V becomes F (unfold, letter kept) (fold.mjs:326).
   - Any other moving/stationary boundary would be a warning. It occurred 0 times, and no unsplit face ever received a new vertex. Both facts follow from rule (i).
7. **Geometry.** The root becomes the old root's stationary child (otherwise any stationary face) and keeps its old T. T is derived by BFS over the CP: crossing an M/V/X edge reflects across that edge's sheet line; crossing F does not. It is checked against the prediction R_ℓ∘T_old for moving faces and T_old for stationary ones.
8. **Order** (fold.mjs:352).
   - For every old overlapping pair, each pair of same-class children that overlaps (penetration > tol) keeps the old value if stationary and gets the reversed value if moving.
   - Each overlapping moving × stationary pair gets the placement rule: moving on top for valley, underneath for mountain, or over/under T for a tuck.
9. **Letters** (fold.mjs:382). Each folded edge is V iff its front-up face lies below; X edges receive their letter. Existing letters must not change; "letter drift" occurred 0 times.

- **Fold-and-unfold** (fold.mjs:410): fold, then `simpleFold(next, {line: info.line, side: −σ, dir, seed: faces(info.moving)})`.
- **Turn-over** (state.mjs:143).

## Verification method

**Flat-Folder (`verify.mjs`).** It feeds V, EV (each pair sorted), EA and FV directly into the FF conversion pipeline, bypassing `io.js:203`, which re-sorts faces. Checks run in this order:

- **Structure:** each ring edge exists in E; edge-face counts are correct; faces are convex and CCW; total area matches.
- **(d) Residual:** vertex images agree across incident faces within tol, and FF's own folded coordinates equal T₀∘ours.
- **Arrangement validation:** the cells must
  - cover each face exactly once,
  - have no boundary that doubles back on itself,
  - leave every vertex image unmoved within 1e-8,
  - keep every segment within tol of each edge it is assigned to,
  - not make the constraint builder throw.

  If any of these fail, rebuild with FF's `L_eps_2_V_EV_EL` at successively halved eps (up to 30 times).
- **(a)** FF's variables equal our ordered pairs.
- **(b)** Seed all variables from our order and run FF's `initial_assignment` (`solver.js:194`); there must be no conflict.
- Every cell's stack must be a strict total order.
- **(e)** FF's letter rule (`solver.js:181`) applied to our order must reproduce our letters.
- **(c)** Solve from CP + letters alone (lim 1000, for states with ≤96 faces) and require our order to be among the solutions. This ran on 42,020 states. Components that hit the cap without our order appearing are counted as inconclusive rather than failed: 269 states in the main campaign.

**Independent checker (`indep.mjs`).** It computes transitivity, taco-taco, taco-tortilla, tortilla-tortilla and the letter rule directly from our convex face images, with no arrangement. Calibration is described in the Summary.

## Results

| Campaign (options) | Seqs | Applied ops | Hard failures | Sub-tol events* | FF states needing eps retry |
|---|---|---|---|---|---|
| main (snap, μ=0) | 2,060 | 18,342 | 3 (sliver) | 21 | 1,314 |
| seed2 (snap, μ=0) | 1,030 | 9,198 | 1 (sliver) | 3 | 694 |
| residual probe (snap, μ=0, no solve) | 600 | 5,219 | 1 (sliver) | 9 | n/a |
| long (snap, partial seeds, ≤1500 faces; FF only ≤120 faces) | 12 | 301 (25.1 per seq, max 33; up to 2,147 faces) | 0 | 0 | — |
| wrap (targeted, snap, μ=0) | 600 | 2,445 | 0 | 3 | — |
| nosnap (μ=0) | 500 | 4,373 | 1 (sliver) | 3 | 289 |
| μ=1e-3, seed 4 | 500 | 4,339 | 0 | 0 | 300 |
| μ=1e-3, seed 5 | 500 | 4,361 | 0 (1 state FF cannot verify; indep OK) | 0 | 331 |
| μ=1e-4 | 500 | 4,359 | 0 | 3 | 284 |

\*A sub-tol event is a pair overlapping by ≤ tol that we left unordered, where FF can complete our order on that pair (`missingCompletable`). All 41 such events were completable.

**Skips** (main): `no-moving-side` 4,394; `all-moving` 4,138; `empty-seed` 283; `snap-ambiguous` 12.

**Other measurements:**
- Fold-and-unfold restores geometry to within 2.3e-11 (main), with 0 letter mismatches and 0 extra faces in the unfold step.
- 44,842 unfolds and 4,641 refolds occurred.
- Placement (tuck) generalisation: 220 of 391 random tucks (56%) were valid; FF and indep agreed on all 391.
- Classics (`renders/index.html`, `results/classics.json`): kite base, a flap unfold, top-layer corner after two folds, a 4-layer precrease then refold (letters remembered, or opposite when refolded the other way), and a tuck under the top layer all verify. A deliberately interleaved tuck is correctly rejected.

## Failures and root causes (minimal repros in `repros/`, replay with `node replay.mjs <file>`)

1. **Spike bug** (`clip-near-duplicate-false-separation.json`, 2 steps).
   - **Cause:** `clipHalfPlane` emitted a point 4.5e-17 from a vertex lying on ℓ. The SAT then used that zero-length edge's noise normal and reported penetration 0 instead of 2.09e-4. The closure missed a piece that had to move, producing a taco-tortilla conflict.
   - **Fix:** points within 1e-12 of the line count as on it, and the SAT skips edges shorter than 1e-12 (`test-numerics.mjs` §2).
2. **Numerics: near-ON vertex amplification.**
   - **Cause:** a vertex δ ≤ tol off ℓ is classified ON and becomes a chord endpoint. In `test-numerics.mjs` the chord-angle error measured 0.9·δ/s and the CP's Kawasaki defect 1.8·δ/s (s = triangle leg). At δ = 9e-7, s = 1e-4 that is 8e-3 rad, and FF fails for δ ≥ 1e-7.
   - **Fix:** snapping brings all of these back to fp level. In the first smoke run a residual of 7.1e-3 occurred.
3. **Flat-Folder limitation: arrangement eps heuristic.**
   - **Symptoms:** a coarse eps merged points, snapped a point onto an edge 4e-4 or 9e-5 away, or left overlapping collinear segments that cancel in the area total. Each produced false `overlap-extra` or conflict reports (repros `ff-coarse-eps-*`, `ff-overlapping-collinear-segments-2`).
   - **Handling:** validation plus finer-eps retry. Retry reasons in main: segment off its edge 985, cell coverage 160, vertex moved 108, boundary doubles back 52, exception 9.
   - **Unverifiable states:** 2 states fail at every eps. In `ff-unverifiable-thin-wedge.json` an inter-layer wedge of 2.9e-4 rad yields an off-edge segment at coarse eps and 95.5% cell coverage at fine eps; the other came from a 6.5e-6 near miss. `indep` passes both.
   - **Caveat:** retry counts were measured with a 1e-8 segment threshold; later relaxed to tol after seeing intersection errors of 1.6e-8 at 5.8e-4 rad. So the counts over-state how often a retry is needed.
4. **Tolerance problem: sub-tolerance slivers** (`subtol-sliver-*.json`).
   - **Cause:** a fold line passing 1e-6–1e-4 from a vertex image (or crossing two layers' edges 1.5e-6 apart) creates a face or an overlap of width 4e-8–7e-7. Our SAT (penetration > tol) treats it as touching; FF at fine eps sees an overlap.
   - **Effect:** 36 cases were benign and completable. 5 were hard failures, where a bent crease's two faces were left unordered, so its letter was undefined.
   - **Fix:** the min-feature policy validated above. A cheap invariant would also help: always order the two faces of a bent edge.

**No theory gap was found.** The hinge-wrap argument (any stationary layer X between hinge faces s and m must touch ℓ only along a raw edge or a nested taco, otherwise the previous state was invalid or rule (ii) moves X) is consistent with 6,123 observed wraps.

## Numerics

- **Tolerance:** tol = 1e-6·sheet, used for classification, snapping and SAT.
- **Snapping** fired on 12,082 ops in main (cluster counts: 1 → 4,536; 2 → 5,236; >2 → 2,310). Largest shift 7.3e-7; largest rotation 5.2e-8 rad.
- **Vertex snapping:** endpoint snaps 0; new vertices within tol of another CP vertex 0.
- **Residual histogram** over 18,342 main states, from a deterministic rerun with tracking:
  - <1e-12: 18,235
  - <1e-10: 85
  - <1e-8: 19
  - <1e-6: 3
  - max 3.74e-7

  FF's own spanning tree gives the same 3.7e-7, so this is a CP-level inconsistency, not a BFS-order effect. Hypothesised mechanism, not isolated: noise amplified through short creases or nearly parallel crossings, since main produced edges as short as 1.2e-7. With μ = 1e-3 the maximum residual was 3.1e-13 to 5.7e-12.

## Performance (Apple Silicon, Node 26)

| Faces | Fold op mean / p95 (main) | FF verify mean (p50) | indep |
|---|---|---|---|
| ≤8 | 0.06 / 0.13 ms | 0.39 ms | <1 ms |
| 33–64 | 1.15 / 2.22 ms | 206 ms (60) | ~10–30 ms |
| 65–128 | 3.45 / 6.97 ms | 731 ms (326) | ~70 ms |
| 129–256 | 9.1 / 17.2 ms | 1,455 ms (from-scratch solve skipped >96 faces) | ~240–400 ms |
| 379 | 57 ms | 31 s (no solve) | 1.4 s |
| 1,104 → 1,906 | 972 ms (order rebuild 915 ms; 1.24M pairs) | — | — |

## Claims

**Confirmed (within the taco/tortilla/transitivity validity model, f64, with snapping and μ):**
- State = CP + convex faces + pairwise order, with T derived by BFS from a root that keeps its isometry.
- The simple-fold closure and order rule, including the hinge-wrap case.
- Moving–moving FOLD triples need no update.
- Letters are derived from the order, using FF's rule.
- Letters alternate per layer flip.
- FF can verify a complete order by seeding, given arrangement validation.
- FF can complete a partial order (used for the 41 sub-tol events).
- Fold-and-unfold keeps the intended letter; refold and unfold behave as described.

**Refuted or qualified:**
- "One tolerance is enough": it also needs exact line snapping and μ ≫ tol (1e-4 is not enough; 1e-3 worked in 8.7k ops).
- "FF verification is turnkey": in about 7% of states its arrangement must be validated and retried, and occasionally it fails outright.
- The tuck placement is not a rule; only 56% of random tucks were valid.

**Untested:**
- Exact arithmetic (Beloch's approach).
- Compound folds, pinches, non-flat states.
- Correctness of the 269 capped components in check (c).
- The Rust FF port's behaviour on these inputs.
- A formal proof of the closure rule.

## Module API for compound-fold agents

`index.mjs` re-exports everything; `README.md` has the details.

```js
import { createSheet, simpleFold, foldAndUnfold, turnOver, getAbove, frontUp,
         verify, indepCheck, toFOLD, renderState, lineP, sideOf } from "./index.mjs";
const r = simpleFold(state, { line, side, dir: "valley"|"mountain",
  seed: {type:"all"} | {type:"point", p, k, from:"top"|"bottom"} | {type:"faces", faces},
  placement: {type:"over"|"under", face} }, { snap: true, minFeature: 1e-3 });
// r.skip | r.state, r.info.{moving, oldOf, line, U, unfolds, refolds, residual}
```

- States are immutable.
- `info.oldOf` and `info.moving` track faces across calls.
- Verify only the final state of a compound fold.

## Open questions

1. Which μ (and whether an angular minimum too) should the UI enforce through landmark snapping, versus moving to exact predicates?
2. Should the order be stored more compactly than O(F²) pairs (per-cell stacks or a transitive reduction), and updated incrementally for split and moving faces only?
3. Should the production validator be `indep`-style direct geometry instead of FF's eps arrangement, given that the Rust port carries the same heuristic?
4. Seed semantics in the UI: the closure can move more layers than the user picked, so the moving set U should be previewed.
5. What should replace the tuck placement for compound folds: Beloch's multi-block placements, or a smarter rule for keeping layers?
6. Should T be derived along the longest edges first (as FF does) to damp noise around short creases?
