# Native-CP reconstruction: where it actually fails (junctions vs exact-solve)

**Date:** 2026-06-30 (numbers re-verified same day — see §0)
**Scope:** Diagnosing why native scraped crease patterns (`native-cp-v1`, 563 CPs:
easy 191 / medium 232 / hard 140) rarely reconstruct exactly, by porting the
shipped vertex refiner into a product-faithful benchmark and measuring each stage.
**Branch:** `claude/inspiring-morse-d6247b`.

> A note on confidence: this session repeatedly produced confident claims that the
> evidence later refuted (distribution shift; "statistically hopeless"; "8px is
> unresolvable"; "5px tolerance is sane"; "the gate is bypassed"; an "eval bug" that
> was a units error; and — see §0 — a `solve_recovered = 0/563` that came from a
> **stale benchmark binary**). Each was caught by *looking/measuring*, not reasoning
> from summary stats. Confidence levels below are deliberate; treat **inferred** items
> as hypotheses pending the named experiment.

---

## 0. Verification status (re-run with a provenance-guarded binary)

Several numbers in the first draft of this report were produced by a **stale benchmark
binary** built in a different git worktree (each worktree has its own `target/`; a
hand-built `$MAIN/target/...` path ran old code). That binary predated the
GT-border **canonicalization** in `strict_topology_metrics`, so it counted the paper
border's redundant collinear segments as missing edges and **under-counted**
exact-topology and recovery. All benchmark-derived numbers below were re-run with the
current binary (`compare_exact_solve_benchmark` @ commit `5ca7c7f8`, which now embeds
its build commit and refuses to run if it ≠ working-tree HEAD — `--allow-stale` to
override). Config unless noted: `--candidate-source junction-first-v1
--line-evidence-source source-image --parity-repair`, strict 2px.

**What changed vs the original draft:**
- Candidate/exact-topology counts were **under-counts**; the real numbers are **higher**
  (e.g. easy P0 33.5%→**39.3%**, medium 10.8%→**14.2%**, hard 2.1%→**3.6%**). The bug
  made the system look *worse*, not better.
- **Oracle (GT-vertex) exact-topology reproduces exactly** (easy/med/hard = 134/56/16) —
  a clean consistency anchor.
- **The benchmark-derived conclusions hold** (often more strongly): the refiner still loses
  to the dense head in every bucket; the exact-solve is still a real second bottleneck; the
  gate tolerance is still not a lever; `solve_recovered@25s` for medium still = **6**. (One
  framing did change — see §3: "the detector is good per-junction even on hard" is wrong;
  hard recall is ~55%.)
- **One number could not be reproduced:** the original hard-bucket P0 *edge-F1* of 0.743.
  No current config (model/source-image × parity) gives more than ~0.606 — that figure
  was likely from a different/older binary or a mis-record. The refiner's hard-bucket
  *improvement* is unchanged (≈+0.15, ≈47% of the GT-vertex ceiling).

**§3 is binary-independent — but its numbers were independently re-derived and several did
NOT hold.** The §3 junction-recall / close-pair figures were computed in numpy **directly
on the dense cache**, never through `compare_exact_solve_benchmark`, so the stale binary
cannot have touched them. They were nonetheless re-derived from scratch (detector-faithful
peak extraction; see §3), and the absolute numbers turned out **optimistic**: hard
per-junction recall is ~**55%** at the operating threshold (0.65), not the first draft's
94–96%, and hard CPs are denser than stated (~691 degree-3 junctions/CP, not 375). The
close-pair *direction* (detection collapses as junctions get closer) is confirmed and is
**stronger**, but the absolute recall/detection numbers in §3 are corrected there.

---

## TL;DR

1. **The V3 vertex refiner does not help on native CPs** (and slightly hurts on the
   strict metric). It's competent but redundant with the full-res dense head. *(High)*
2. **The dominant junction failure is close pairs.** Detection falls off sharply as
   junctions get closer: at the detector's operating threshold (0.65, re-derived) an
   isolated junction (≥25px) is detected ~86% of the time, a <4px pair only ~4%. The model
   under-fires on the second junction of a pair. Whether this is a **training/data gap**
   (no close-pair augmentation in the dense model) or a **resolution limit** at 1024px is
   **not settled** — hard per-junction recall is only ~55%, low enough to be consistent
   with either. *(close-pair gap = High; mechanism = open)*
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

Full 563-sample matrix (topology ceiling, `--skip-exact-solve`, strict 2px),
**re-verified** with binary `5ca7c7f8`:

| bucket | P0 (dense head) exact-topo | refiner | oracle (GT verts) | edge-F1 P0→refiner (12px) | oracle edge-F1 |
|---|---|---|---|---|---|
| easy (191) | **75 (39.3%)** | 70 (36.6%) | 134 (70.2%) | 0.962 → 0.959 | 0.979 |
| medium (232) | **33 (14.2%)** | 14 (6.0%) | 56 (24.1%) | 0.970 → 0.965 | 0.982 |
| hard (140) | **5 (3.6%)** | 2 (1.4%) | 16 (11.4%) | **0.606 → 0.764** | 0.943 |

*(First-draft numbers were easy 64/59, medium 25/10, hard 3/2 — under-counts from the
stale binary; oracle 134/56/16 reproduces exactly.)*

- By exact-topology, the refiner is flat-to-worse **everywhere** (70<75, 14<33, 2<5).
- By edge-F1 (partial credit) it *helps on hard* (0.606→0.764, ~47% of the way to the
  GT-vertex ceiling of 0.943) — so it does real work in dense regions — but neutral on
  easy/medium where the dense head is already ~0.96.
- It is **not** an out-of-distribution failure (the native renders are crisp and
  in-distribution; the model fires cleanly on them — verified on contact sheets) and
  **not** a port bug (features bit-exact). It's that the refiner's junctions are **no
  more precise than the dense head's**, and at close pairs it's actually *worse*
  (first-draft: 4–6px gap refiner 42% vs dense 67% — a numpy in-regions comparison not
  re-derived in this pass; the dense close-pair rates in §3 are the re-verified ones). V3 re-detects at native crop
  resolution with no super-resolution and **dropped** the dense-junction input channels
  that V1/V2 fed it — so it has no structural way to beat the head.

> Caveat on the hard edge-F1 baseline: the original draft reported hard P0 edge-F1 = 0.743;
> it does **not** reproduce (all current configs give ~0.60). The relative refiner gain
> (+~0.15, ~47% of ceiling) is unchanged, but treat the absolute hard-P0 edge-F1 as 0.606.

---

## 3. The dominant junction failure: close pairs *(close-pair gap High; absolute numbers corrected)*

> **Re-derived independently (and the original §3 numbers did NOT reproduce).** This
> section was recomputed in numpy directly on the dense cache (`scripts/cp-detect/rederive-junction-recall.py`),
> replicating the detector's junction extraction exactly: `prob = sigmoid(junction_logits)`;
> local maxima with NMS radius 3px at the operating threshold **0.65**
> (`line_threshold.max(0.50)`); sub-pixel offset added; match to GT within 2px. GT
> "junctions" = interior (off the paper border) vertices of **degree ≥ 3** (degree-1
> endpoints and degree-2 collinear points are not junctions the head targets). The
> close-pair *direction* is confirmed and is **stronger** than the first draft; the
> *absolute* recall and detection numbers in the first draft were **optimistic** and are
> replaced below.

Dense-head per-junction recall, re-derived, at the detector's operating threshold (0.65):

| bucket | junc/CP (re-derived / 1st draft) | recall@2px @0.65 (re-derived / 1st draft) | recall @ lower thr |
|---|---|---|---|
| easy | 37 / 37 | **91.8%** / 96–97% | 98.6% @0.10 |
| medium | 115 / 98 | **90.5%** / 97–98% | — |
| hard | **691** / 375 | **55.0%** / 94–96% | 69.6% @0.30 |

Two corrections to the first draft:
1. **Recall was overstated, especially on hard.** At the operating threshold it is ~91%
   on easy/medium (not 96–98%) and **~55% on hard** (not 94–96%). Recall is
   threshold-dependent (easy 91.8% @0.65 → 98.6% @0.10), so the first draft's 96–97%
   reflected a *lower* threshold than the detector actually uses.
2. **Hard CPs are far denser than stated** — ~**691** degree-3 junctions/CP, not 375. Most
   hard junctions are *not* isolated (only ~23% have nearest neighbour ≥25px; ~43% are
   12–25px; ~34% are <12px), so close pairs are the *majority* on hard and recall collapses
   accordingly. The "detector is good per-junction even on hard, the metric is just
   unforgiving" framing holds for easy/medium but **not** for hard.

Where the misses concentrate — **close pairs** (detection rate vs distance to nearest
neighbouring GT junction, @2px), re-derived:

| nearest-neighbour gap | 0–4px | 4–6px | 6–8px | 8–10px | 10–12px | 12–25px | 25+px |
|---|---|---|---|---|---|---|---|
| hard @0.65 | **4.3%** | 6.8% | 15.7% | 19.7% | 46.1% | 65.2% | 85.7% |
| hard @0.30 | 13.6% | 22.9% | 39.6% | 35.2% | 67.0% | 79.5% | 96.0% |
| medium @0.65 | 38.3% | 29.9% | 62.4% | 84.4% | 87.5% | 91.9% | 91.1% |

*(First draft claimed hard 53/59/82/89/98% by gap — those do not reproduce; the gap
direction is the same but the close bins are far lower, and the isolated 25+px bin matches
the first draft only at the lower 0.30 threshold, 96% vs 98%.)*

**Mechanism — partly carried over, partly re-derivable.** The close-pair gap (detection
collapsing as junctions get closer) is robust and independently confirmed above. The
*finer* mechanism claims from the first draft — heatmap sharpness (FWHM ≈ 2px), and the
missed-junction breakdown (44% "absent" @≈0.06, 36% suppressed, 19% merged) — were from a
separate heatmap-profile analysis not re-run in this pass; treat them as **first-draft,
not re-verified**. The dense (cpline) model having **no close-pair augmentation** (only
the refiner does) is a fact about the training config, unchanged.

**Read:** close pairs are where junction detection fails, and the effect is large
(<4px pairs detected ~4% at the operating threshold). Whether this is a *capability* limit
(1024px can't resolve sub-4px pairs) or a *training* gap (no close-pair augmentation) is
**not settled** by these numbers — the first draft leaned "training gap (the head is sharp
and capable)", but the corrected, much-lower hard recall is also consistent with a partial
resolution limit at this image size. Needs the close-pair-augmented retraining experiment
(and/or a higher-resolution test) to separate the two.

---

## 4. `exact-topology@2px` is the wrong yardstick *(High confidence)*

Two independent problems:
1. **All-or-nothing over hundreds of junctions.** With ~691 junctions/CP on hard, even a
   95%-recall detector would score ~0% (0.95^691 ≈ 0) — and the actual hard recall is only
   ~55% (§3), so exact-topology is hopeless on hard regardless. It collapses a graded
   detector into a near-zero binary.
2. **It scores the candidate graph, not the reconstruction.** With the exact-solve run
   and "recovered the original CP" measured strictly (solve accepted **and** solved fold
   matches GT topology+assignment within 2px), **re-verified** (binary `5ca7c7f8`):

   | | candidate exact-topology@2px | **solve-recovered@2px** |
   |---|---|---|
   | easy | 39.3% | 31.4% (60/191) |
   | medium | 14.2% | 2.6% (6/232) @25s · 1.3% @10s |

   So exact-topology **over-counts** real success on medium (14% candidate → ~3%
   recovered). The honest metric is "did the exact-solve recover the original CP,"
   implemented as `solve_recovered_original` (per-sample bool + summary count). Full set,
   model line-evidence, 3s cap: **61/563** recovered (was 55 before the canonicalization
   change — the dissolve of degree-2 collinear nodes adds +6).

A looser **recovery** tolerance (5px) is *not* the fix: at 5px the "recovered" folds have
individual vertices 2–4px off GT — genuinely different CPs, not a uniform convention
offset. The ~0.45px coordinate-convention offset (shared by dense head and refiner vs the
native GT) is already absorbed by 2px, so 2px is the right strict bar.

---

## 5. The exact-solve is a real second bottleneck *(Medium-High confidence)*

Of the **33** medium candidates that reach exact topology (gate working correctly), at a
25s solve cap (re-verified): **6 recover, 6 time out, 21 solve-but-drift.** Two distinct
failure modes, both verified by dumping folds and comparing in **pixel** space:

1. **Timeouts.** The solve takes up to the 25s cap on 98-junction native CPs — it is
   *not* "instant on exact topology" (that was the clean-benchmark behaviour). A real
   slice never finishes in budget (and at a 10s cap, timeouts rise to 17/33 — recovery is
   cap-sensitive).
2. **Convergence drift.** Even from a perfect candidate (all vertices <2px, edge set
   identical to the solved fold), the solve **repositions vertices by ~1–2.6px** (mean
   ~0.6px) to satisfy flat-foldability, pushing 1–3 vertices from <2px to **2.0–2.8px**
   off GT. Example: `0.95px → 2.43px (moved 1.57px)`. These flipped vertices are
   **isolated** (nearest-neighbour gap 54–81px), *not* close pairs — so this is a general
   solver-precision effect. It is **not** missing/spurious edges (edge sets are
   byte-identical) and **not** the close-pair detection issue.

So even perfect junction detection within 2px does not guarantee recovery: the foldability
solve can land on a nearby valid configuration a few px off GT. This is why
`solve_recovered_original` sits well below candidate-exact-topology (medium: 6 recovered
of 33 exact candidates).

*(First-draft §5 read "25 candidates → 6 recover, 5 timeout, 14 drift" — the 25 was the
stale-binary under-count; the recovered count `6` reproduces exactly.)*

---

## 6. What is NOT a lever (ruled out by measurement)

- **The vertex refiner** (§2) — competent but redundant; worse at close pairs.
- **Junction threshold** — recall plateaus (~97% on hard even at 0.10); the misses are
  absent, not dim. A drop to ~0.2 on hard is a small (~+1% recall / −0.5% precision)
  side win, not the fix. Default kept at 0.3.
- **Topology-gate tolerance** — re-verified (medium, 25s cap): loosening the solve gate
  from 2→6px admits **more solves (33→52)** but recovers **~the same (6→7)**: the
  admitted near-miss candidates (junctions detected >2px off) don't solve back to GT.
  Default kept at 2px. *(First-draft "25→44 solves, recovers 4" — same pattern, stale
  under-counts.)*

---

## 7. Recommended levers (prioritized)

1. **Attack close-pair junction recall** *(High that it's the lever; mechanism open).*
   Close pairs are where detection collapses (§3). The first-draft framing was "the head is
   sharp and capable, so it's a training gap — oversample/augment close pairs"; that's still
   the cheapest thing to try (detector-repo `create-pattern-detector` work, matching the
   existing "close-pair junction fix" plan), **but** the corrected ~55% hard recall leaves
   open that part of it is a resolution limit at 1024px. Worth a quick higher-resolution
   probe alongside the close-pair-augmented retrain to see which dominates.
2. **Improve the exact-solve on native CPs** *(Medium-High).* Two sub-levers: cut the
   timeout rate (the solve is slow on 98–691-junction CPs), and reduce convergence drift
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
- `scripts/cp-detect/run-native-cp-refiner-matrix.sh` — reproducible P0/refined/J matrix
  (now `cargo build`s from its own worktree first — see the provenance guard below).
- `compare_exact_solve_benchmark`: `--refined-vertices`, `--topology-gate-tolerance-px`
  (default = strict), the `solve_recovered_original` metric, and a **build-provenance
  guard** (`build.rs` embeds the build commit; refuses to run when it ≠ working-tree HEAD,
  `--allow-stale` to override) that exists specifically because of the §0 stale-binary
  incident.
- `strict_topology_metrics` now **dissolves degree-2 collinear same-assignment vertices**
  (the merge counterpart to its split pass) so redundant border representations don't
  count as topology differences (+6 `solve_recovered` on the full set).
- Benchmark↔product parity: the benchmark defaults now match the product decode
  (`junction-first-v1` + `source-image`); see `crates/oristudio-cp-detect/src/defaults.rs`.
  (The former `implementation-plans/cp-detect-benchmark-product-parity.md` snapshot
  was removed as stale — it predated the vertex-refiner deprecation.)

---

## 9. Open questions & caveats

- **Close-pair mechanism is open** (§3) — training gap vs 1024px resolution limit is not
  separated; needs the close-pair-augmented retrain and/or a higher-res probe. The
  first-draft heatmap-profile sub-numbers (FWHM ≈ 2px; missed = 44% absent / 36% suppressed
  / 19% merged) were **not** re-derived in this pass — treat as first-draft.
- **Exact-solve drift** — whether it's the optimizer not finding the truly-nearest
  foldable config, or multiple foldable configs near the detected positions, is not
  pinned down. Worth a focused look before optimizing the solver.
- **Hard-bucket recovery is ~0 at a sane cap** — all 5 hard exact-topology candidates time
  out (25s); timeouts dominate there as expected.
- **§3 re-derived; absolute numbers were optimistic.** Hard recall ~55% (not 94–96%), hard
  junctions ~691/CP (not 375); close-pair direction confirmed and stronger. See §0/§3.
- **Hard P0 edge-F1 = 0.743 (first draft) is unreproducible** — see §0/§2; treat 0.606 as
  the verified value.
- **Coordinate-convention offset** (~0.45px diagonal) between native GT `vertices_px` and
  where both models place junctions is real (shared by dense head + refiner) but small;
  absorbed by the 2px tolerance.
- **Phase 2 (wire the product onto the shared Rust refiner via wasm) is unstarted.** The
  benchmark goal was met via the Torch path, and given §2 there's little product urgency.

---

## Appendix — key measurements

- Benchmark binary for all re-verified numbers: `compare_exact_solve_benchmark` @
  `5ca7c7f8` (provenance-checked); config `junction-first-v1 + source-image lines +
  parity`, strict 2px, unless noted.
- §2 matrix (re-verified): easy P0/refiner/oracle = 75/70/134; medium = 33/14/56; hard =
  5/2/16. Oracle reproduces the first-draft exactly.
- §5 cross-tab (medium, 25s): 33 exact candidates → 6 recovered, 6 timeout, 21 drift.
- §6 gate sweep (medium, 25s): gate 2px → 33 solves / 6 recovered; gate 6px → 52 solves /
  7 recovered.
- `solve_recovered_original` full set (model lines, 3s): 55 (pre-dissolve) → **61** (with
  the degree-2 collinear dissolve).
- Feature port parity: 9/9 channels `maxAbsDiff = 0.0` (real 1024px CP). *(numpy/Node)*
- Heatmap peak: half-max radius ~1px (FWHM ~2px); value/peak at r=2px ≈ 0.05. *(numpy)*
- Refiner vs GT in regions (medium): precision 98.7% / recall 96.7% @5px; @2px 94/92;
  @1px 66/65. Over-production ×0.98. *(numpy)*
- Dense vs refiner residual vs GT: both share ~−0.45px diagonal bias (convention);
  refiner scatter ≈ dense scatter (no sharpening). *(numpy)*
