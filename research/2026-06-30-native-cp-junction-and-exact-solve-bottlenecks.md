# Native-CP reconstruction: where it actually fails (junctions vs exact-solve)

**Date:** 2026-06-30
**Scope:** Diagnosing why native scraped crease patterns (`native-cp-v1`, 563 CPs:
easy 191 / medium 232 / hard 140) rarely reconstruct exactly, by porting the
shipped vertex refiner into a product-faithful benchmark and measuring each stage.
**Branch:** `claude/inspiring-morse-d6247b`.

> A note on confidence: this session repeatedly produced confident claims that the
> evidence later refuted (distribution shift; "statistically hopeless"; "8px is
> unresolvable"; "5px tolerance is sane"; "the gate is bypassed"; an "eval bug" that
> was a units error). Each was caught by *looking/measuring*, not reasoning from
> summary stats. Confidence levels below are deliberate; treat **inferred** items as
> hypotheses pending the named experiment.

---

## TL;DR

1. **The V3 vertex refiner does not help on native CPs** (and slightly hurts on the
   strict metric). It's competent but redundant with the full-res dense head. *(High)*
2. **The dominant junction failure is close pairs** (junctions within ~8px): detection
   drops from ~98% to ~55%. It is **not** resolution, threshold, or code — the dense
   heatmap is sharp; the model simply **under-fires on the second junction of a pair**.
   Most consistent with a **training/data gap** (no close-pair augmentation in the dense
   model). *(close-pair = High; "training gap" = Medium-High, inferred)*
3. **`exact-topology@2px` is the wrong headline metric.** It's all-or-nothing over
   hundreds of junctions (so even 96% recall → ~0% on hard), and it scores the *candidate
   graph*, ignoring whether the exact-solve actually reproduces the CP. *(High)*
4. **The exact-solve is a real, under-appreciated second bottleneck.** Even from a
   perfect (exact-topology, all vertices <2px) candidate, it (a) **times out** on big
   native CPs, and (b) **repositions a few vertices by ~1–2.6px** to satisfy
   foldability, landing on a *nearby but different* flat-foldable configuration that's
   2–3px off GT at a handful of vertices. *(Medium-High)*
5. **The two real levers** are (a) close-pair junction recall in the **dense** head
   (detector-repo training), and (b) **exact-solve** performance/convergence on native
   CPs. The refiner, threshold tuning, and topology-gate tolerance are **not** levers.

---

## 1. Context and what was built

The benchmark (`compare_exact_solve_benchmark`) measured only the dense head, not the
shipped `vertex-refiner-v3`. To make it product-faithful:

- **Ported the entire refiner geometry to shared Rust** (`crates/oristudio-cp-detect/src/refinement/`):
  feature extraction, dense-junction-region proposals, crop-tensor build, output decode,
  and merge. Validated **bit-exact to the product TS** (`vertexRefinerPipeline.ts`): all 9
  feature channels `maxAbsDiff = 0.0` on a real 1024px image.
- **Torch-MPS sidecar** (`scripts/cp-detect/infer-native-cp-refined-vertices.py`) +
  `refiner_cache` (plan/merge) + `--refined-vertices` in the benchmark — the refiner
  forward pass runs in PyTorch (like the dense cache), the geometry is the shared Rust.
  In-regions merge matches the product (`decode_…_with_refined_vertices_in_regions`).
- **`solve_recovered_original`** metric + configurable `--topology-gate-tolerance-px`.

The model forward passes (dense HRNet, refiner) are **not** in Rust — there is no Rust
ONNX runtime; they run in PyTorch (offline cache) or onnxruntime-web (browser). Rust is
the shared decode/compile.

---

## 2. The vertex refiner doesn't help on native CPs *(High confidence)*

Full 563-sample matrix (topology ceiling, `--skip-exact-solve`, strict 2px):

| bucket | P0 (dense head) exact-topology | refiner | oracle (GT verts) | edge-F1 P0→refiner |
|---|---|---|---|---|
| easy (191) | 64 (33.5%) | 59 (30.9%) | 134 (70.2%) | 0.958 → 0.955 |
| medium (232) | 25 (10.8%) | 10 (4.3%) | 56 (24.1%) | 0.971 → 0.966 |
| hard (140) | 3 (2.1%) | 2 (1.4%) | 16 (11.4%) | **0.743 → 0.845** |

- By exact-topology, the refiner is flat-to-worse everywhere.
- By edge-F1 (partial credit) it *helps on hard* (0.743→0.845, ~47% of the way to the
  GT-vertex ceiling of 0.959) — so it does real work in dense regions — but neutral on
  easy/medium where the dense head is already ~0.96.
- It is **not** an out-of-distribution failure (the native renders are crisp and
  in-distribution; the model fires cleanly on them — verified on contact sheets) and
  **not** a port bug (features bit-exact). It's that the refiner's junctions are **no
  more precise than the dense head's**, and at close pairs it's actually *worse*
  (4–6px gap: refiner 42% vs dense 67% detected). V3 re-detects at native crop
  resolution with no super-resolution and **dropped** the dense-junction input channels
  that V1/V2 fed it — so it has no structural way to beat the head.

---

## 3. The dominant junction failure: close pairs *(close-pair High; mechanism Medium-High)*

Dense-head per-junction recall is **high** (raw local-maxima vs GT):

| bucket | junc/CP | recall@2px | recall@5px | P(all junctions hit)=recall^N @2px |
|---|---|---|---|---|
| easy | 37 | 96–97% | 98% | 23–36% |
| medium | 98 | 97–98% | 99% | 5–15% |
| hard | 375 | 94–96% | 98% | **~0%** |

So junctions look "terrible in the benchmark" only because exact-topology multiplies a
96%-recall detector by itself hundreds of times. **The detector is good; the metric is
unforgiving.**

Where the misses concentrate — **close pairs** (hard bucket, detection rate vs distance
to nearest neighbouring GT junction, @2px):

| nearest-neighbour gap | 0–4px | 4–6px | 6–8px | 10–12px | 25+px |
|---|---|---|---|---|---|
| dense detection | 53% | 59% | 82% | 89% | 98% |

**Mechanism (this is the important part):** it is *not* resolution, threshold, or merging.
- The dense junction heatmap is **sharp** (sigmoid FWHM ≈ 2px; value drops to 5% of peak
  by 2px), and it renders two clean peaks when it fires (bimodal: 0% @<4px, 39% @4–6px,
  76% @6–8px).
- Of the missed close-pair junctions: **44% "absent"** (heatmap ≈ 0.06 at the junction —
  no evidence at all), 36% suppressed (a local max below 0.3, mostly <0.1), 19% merged.
- Lowering the junction threshold barely helps (hard recall plateaus at ~97% even at
  0.10) — so the misses are *absent*, not dim-below-threshold.
- Corroboration: the dense (cpline) model has **no close-pair augmentation** (only the
  refiner does); junction targets are σ≈1.5–3.3px Gaussians but outputs are sharp.

**Read:** the dense head is *capable* (sharp, two clean peaks when it commits) but
under-fires on the second junction of a close pair — best explained as a training/data
gap, fixable by close-pair-augmented retraining. **Inferred, not proven** — needs the
retraining experiment to quantify recoverable recall.

---

## 4. `exact-topology@2px` is the wrong yardstick *(High confidence)*

Two independent problems:
1. **All-or-nothing over hundreds of junctions.** Even a near-perfect detector scores
   ~0% on hard (0.95^375 ≈ 0). It makes a good system look broken.
2. **It scores the candidate graph, not the reconstruction.** With the exact-solve run
   and "recovered the original CP" measured strictly (solve accepted **and** solved fold
   matches GT topology+assignment within 2px):

   | | candidate exact-topology@2px | **solve-recovered@2px** |
   |---|---|---|
   | easy | 34% | ~30% |
   | medium | 11% | ~3–6% (timeout-dependent) |

   So exact-topology **over-counts** real success on medium (11% candidate → ~3–6%
   recovered). The honest metric is "did the exact-solve recover the original CP,"
   implemented as `solve_recovered_original` (per-sample bool + summary count).

A looser **recovery** tolerance (5px) is *not* the fix: at 5px the "recovered" folds have
individual vertices 2–4px off GT — genuinely different CPs, not a uniform convention
offset. The ~0.45px coordinate-convention offset (shared by dense head and refiner vs the
native GT) is already absorbed by 2px, so 2px is the right strict bar.

---

## 5. The exact-solve is a real second bottleneck *(Medium-High confidence)*

Of the 25 medium candidates that reach exact topology (gate working correctly), at a 25s
solve cap: **6 recover, 5 time out, 14 solve-but-drift.** Two distinct failure modes,
both verified by dumping folds and comparing in **pixel** space:

1. **Timeouts.** The solve takes a median ~9s, up to 25s, on 98-junction native CPs — it
   is *not* "instant on exact topology" (that was the clean-benchmark behaviour). A real
   slice never finishes in budget.
2. **Convergence drift.** Even from a perfect candidate (all vertices <2px, edge set
   identical to the solved fold), the solve **repositions vertices by ~1–2.6px** (mean
   ~0.6px) to satisfy flat-foldability, pushing 1–3 vertices from <2px to **2.0–2.8px**
   off GT. Example: `0.95px → 2.43px (moved 1.57px)`. These flipped vertices are
   **isolated** (nearest-neighbour gap 54–81px), *not* close pairs — so this is a general
   solver-precision effect. It is **not** missing/spurious edges (edge sets are
   byte-identical) and **not** the close-pair detection issue.

So even perfect junction detection within 2px does not guarantee recovery: the foldability
solve can land on a nearby valid configuration a few px off GT. This is why
`solve_recovered_original` sits below candidate-exact-topology.

---

## 6. What is NOT a lever (ruled out by measurement)

- **The vertex refiner** (§2) — competent but redundant; worse at close pairs.
- **Junction threshold** — recall plateaus (~97% on hard even at 0.10); the misses are
  absent, not dim. A drop to ~0.2 on hard is a small (~+1% recall / −0.5% precision)
  side win, not the fix. Default kept at 0.3.
- **Topology-gate tolerance** — loosening the solve gate from 2→4→6px runs more solves
  (25→42→44) but recovers the **same** 4 at strict 2px: the admitted near-miss
  candidates (junctions detected >2px off) don't solve back to GT. Default kept at 2px.

---

## 7. Recommended levers (prioritized)

1. **Retrain the dense junction head with close-pair emphasis** *(High that it's the
   lever; Medium on magnitude).* Oversample/augment close-pair configs and up-weight
   close-pair recall in the loss. The head is already sharp; it needs to learn to fire on
   *both* junctions. This is detector-repo (`create-pattern-detector`) training work, not
   this Rust port. Matches the existing "close-pair junction fix" plan.
2. **Improve the exact-solve on native CPs** *(Medium-High).* Two sub-levers: cut the
   timeout rate (the solve is slow on 98–375-junction CPs), and reduce convergence drift
   so it lands on GT's foldable config rather than a nearby one. Profile why it's slow /
   why it drifts before committing to an approach.
3. **Adopt `solve_recovered_original@strict` as the headline metric** *(done)*, and
   consider reporting per-junction recall / edge-F1 alongside it instead of leaning on
   all-or-nothing exact-topology.
4. **Downstream topology robustness** *(complementary)* — tolerate a few missing
   junctions so one miss in hundreds doesn't fail a whole CP.

---

## 8. Tooling delivered (this branch)

- `crates/oristudio-cp-detect/src/refinement/` — shared-Rust refiner geometry (15 unit
  tests; features bit-exact to product TS).
- `crates/oristudio-cp-detect/src/bin/refiner_cache.rs` — `plan` (crop tensors) / `merge`
  (decode→refined-vertex cache) / `dump-features` (TS-parity check).
- `scripts/cp-detect/infer-native-cp-refined-vertices.py` — Torch-MPS refiner sidecar.
- `scripts/cp-detect/run-native-cp-refiner-matrix.sh` — reproducible P0/refined/J matrix.
- `compare_exact_solve_benchmark`: `--refined-vertices`, `--topology-gate-tolerance-px`
  (default = strict), and the `solve_recovered_original` metric.
- Implementation plan: `implementation-plans/cp-detect-benchmark-product-parity.md`.

---

## 9. Open questions & caveats

- **Close-pair retrain magnitude is inferred** — needs the detector-repo experiment to
  quantify how much of the 44%-absent is recoverable.
- **Exact-solve drift** — whether it's the optimizer not finding the truly-nearest
  foldable config, or multiple foldable configs near the detected positions, is not
  pinned down. Worth a focused look before optimizing the solver.
- **Hard-bucket recovery is unmeasured** (solve too slow at a sane cap); expect timeouts
  to dominate there.
- **Coordinate-convention offset** (~0.45px diagonal) between native GT `vertices_px` and
  where both models place junctions is real (shared by dense head + refiner) but small;
  absorbed by the 2px tolerance. Worth understanding but not a lever.
- **Phase 2 (wire the product onto the shared Rust refiner via wasm) is unstarted.** The
  benchmark goal was met via the Torch path, and given §2 there's little product urgency.

---

## Appendix — key measurements

- Feature port parity: 9/9 channels `maxAbsDiff = 0.0` (real 1024px CP).
- Heatmap peak: half-max radius ~1px (FWHM ~2px); value/peak at r=2px ≈ 0.05.
- Refiner vs GT in regions (medium): precision 98.7% / recall 96.7% @5px; @2px 94/92;
  @1px 66/65. Over-production ×0.98 (not over-producing).
- Dense vs refiner residual vs GT: both share ~−0.45px diagonal bias (convention);
  refiner scatter ≈ dense scatter (no sharpening).
- Solve-recovery cross-tab (medium, 25s): 25 exact candidates → 6 recovered, 5 timeout,
  14 drift (solver moves 1–2.6px, flips isolated vertices to 2.0–2.8px off GT).
