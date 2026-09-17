# Compact synthetic-only recognition: September 16 results

The candidate reduces missing/extra edges by **4.09× across the combined
development and holdout corpus**, and by **2.39× on the reserved internal
holdout**. It recovers 75 additional graphs exactly. The holdout result falls
short of the 3–5× target, and perfect large-pattern recovery remains unsolved.
The model was published to the web app on 2026-09-16 after code deployment
and the E031/E032 fixes. Earlier measurements below retain their original
evaluation scope; the chronological notebook records final rollout checks.

The subsequent [solver-only investigation](../cp-solver/results.md) now reaches
all supported clean repaired graphs and all correctly recognized graphs within
25 seconds in the browser. It leaves this detector comparison unchanged and
reports geometric solving separately from original-reference recovery.

## Matched recognition comparison

The latest `curated_benchmark` supplies the baseline. Its truth-size recognition
cap was removed for six otherwise-skipped cases, using the same old model and
a 60-second cutoff. The old model still times out on Skytree after receiving
the same spatial-index optimization as the candidate. Missing predictions
count as empty graphs; they are never excluded from the comparison.

The corpus contains 558 images, 545 with topology truth. The frozen split is
445 development / 113 holdout images, with 433 / 112 topology truths.
Identical normalized graph fingerprints stay together. Previous product
research used this corpus, so the holdout is internal rather than externally
unseen. Candidate settings were frozen before holdout inference. E020 later
repeated inference solely to verify a performance optimization: every one of
the 558 graphs has identical coordinates, edges, and assignments.

Recognition uses the existing unrounded strict graph comparison at 4 pixels
in a normalized 1024-pixel paper frame. "Exact" means no missing or extra
edges/vertices under that correspondence. It does not mean exact foldability.
Error reduction refers specifically to missing plus extra edges, not to
runtime, all failure types, or a multiplication of F1.

| Split | Cases | Exact graphs, old → new | Exact with assignments, old → new | Edge errors, old → new | Reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development | 433 | 282 → 339 | 278 → 330 | 31,708 → 6,766 | 4.69× |
| Internal holdout | 112 | 74 → 92 | 74 → 91 | 5,675 → 2,372 | 2.39× |
| Combined | 545 | 356 → 431 | 352 → 421 | 37,383 → 9,138 | 4.09× |

Macro edge F1 is 0.96602 → 0.98007 combined and 0.96413 → 0.97117 on holdout.
Combined wrong assignments increase from 983 to 1,366 as more giant-case
edges become recoverable; holdout wrong assignments decrease from 123 to 73.
Exact-with-assignment counts improve, but raw assignment errors must not be
hidden behind the topology result.

| Combined stratum | Cases | Exact graphs, old → new | Edge errors, old → new |
| --- | ---: | ---: | ---: |
| Rendered `cpoogle` | 484 | 338 → 412 | 34,191 → 7,317 |
| Curated with topology truth | 61 | 18 → 19 | 3,192 → 1,821 |
| Small: fewer than 200 creases | 242 | 201 → 216 | 1,702 → 1,283 |
| Medium: 200–799 | 219 | 129 → 162 | 4,723 → 3,018 |
| Large: 800–1,999 | 60 | 25 → 43 | 3,295 → 1,513 |
| Giant: at least 2,000 | 24 | 1 → 10 | 27,663 → 3,324 |

Complexity uses non-boundary, non-AUX truth creases only for reporting. Inference
never reads this count: resolution selection uses detected vertices. The five
giant holdout cases improve from 2,503 to 322 edge errors (7.77×), with exact
graphs increasing from one to three. Five examples do not establish a general
perfect-large-pattern claim.

## Exact solved recovery

Using the latest harness's bounded solve policy—25 seconds, and lattice-only
above 1,500 spans—strict accepted recovery at 2 pixels improves as follows.

| Split | Truths | Strict recovery, old → new |
| --- | ---: | ---: |
| Development | 418 | 274 → 293 |
| Holdout | 108 | 67 → 77 |
| Combined | 526 | 341 → 370 |

The matched replay contains four truth-only cases that the original whole-run
summary did not score (522 versus 526); both methods here use all 526. Solved
missing/extra edges decrease from 42,982 to 14,170. This endpoint improves less
than recognition: accurate topology does not guarantee coordinates satisfying
exact folding constraints. Dwarf has all 2,327 recognized edges and assignments
correct at 4 pixels but still times out during a 25-second full solve. Neither
pixel-scale changes nor direction projection fixed that.

## Browser behavior and performance

Measured in Chromium 148 on Apple M1 Max, ONNX Runtime WASM with four threads.
The browser exposed the WebGPU API but returned no usable adapter; these
measurements do not require GPU inference. Timings include automatic crop,
model loading, adaptive inference, graph decoding, and AUX extraction. They
exclude later exact solving. These are observed runs, not a cross-device SLA.

| Source | Recognition time | Observation |
| --- | ---: | --- |
| Greater bird | 3.24 s | 853 physical edges plus 52 retained F/AUX segments |
| Dwarf | 14.60 s | All 2,327 edges and assignments match at 4 px |
| Skytree | 23.61 s | 9,311 output edges; formerly 72.36 s with the same weights |

Skytree's browser graph is identical before and after the spatial index. Native
decoding on that case drops from 32.55 to 6.86 seconds. A previous compact-model
browser run on Hand took 28.26 seconds but had only about 0.81 edge F1; speed
does not make it a successful parse.

**The existing modal still runs its subsequent exact solve without a deadline.**
These recognition measurements therefore do not establish a one-minute bound
for the entire import flow. Crowded residual errors and exact solving are the
largest unresolved requirements.

## What changed

- A 386,565-parameter, stride-one network predicts physical junctions,
  subpixel offsets, physical-crease evidence, and a separate AUX plane.
  The ONNX file is about 1.55 MB. Identity and hashes are in `candidate.json`.
- Synthetic targets use geometric pixel centers and supervise offsets around
  junctions, addressing the sparse border supervision found in recent research.
  Inference and training share a fixed 32-pixel paper inset.
- 512-pixel tiles own disjoint interiors with 64-pixel context halos. More than
  700 detected vertices triggers 2048-pixel inference from the original source.
- Source color determines M/V assignments after geometry selection. Cyan is
  excluded from that decision. Monochrome ink remains unknown when its polarity
  cannot be inferred from color.
- Learned AUX evidence plus cyan source support is fitted into straight
  segments and retained as F, including through the exact-solve attachment.
  AUX shares drawing-graph vertices at every recovered crossing and endpoint.
  Flat-fold constraints use the reduced physical graph; solved and partial
  previews restore connected references. Import cleanup preserves the junctions.
- Cached graph scoring and a conservative intermediate-vertex spatial index
  remove redundant work while preserving selection and geometric predicates.
- Browser and desktop use the shared compact inference path; desktop exact
  solving remains native. Legacy model manifests remain supported.

Training used 5,148 generated training geometries and 457 generated validation
geometries, deduplicated across rotations/reflections. No real patterns were
used for weights, targets, or pseudo-labels. Render augmentation includes
Oriedita cyan `(100,200,200)`, saturated and dark cyan, AUX hatching/fans,
monochrome ink, editor grids, varied widths, blur/resampling, and dark styles.
The final training checkpoint was selected by synthetic validation only.

Synthetic validation: vertex F1 0.9701, boundary recall 0.9368, physical-crease
IoU 0.9196, AUX IoU 0.8775. The benchmark lacks trustworthy real AUX ground
truth; the 52 bird segments are a retention demonstration, not an AUX accuracy
score. Rust, WASM, and preview tests verify that AUX is F rather than V.

## Remaining failures and promotion decision

- Curated improvements are uneven. Simple Bear regresses from F1 1.0 to 0.7481,
  Frog from 1.0 to 0.9067, and Bat from 0.8796 to 0.7961. Their results remain
  in all tables. Rendered patterns account for most exact-recovery gains.
- Non-square paper conflicts with the square rectifier/graph assumptions.
  Spider's hexagon and Rabbit expose this limitation.
- Aliased dense short edges, junction localization, and M/V evidence can still
  fail, particularly on Hand and crowded giant patterns.
- Gray AUX cannot reliably be distinguished from gray physical creases by the
  adopted cyan gate. Monochrome physical geometry is supported, but semantics
  from indistinguishable styles remain unresolved.
- AUX vectorization has no real benchmark truth, and the full import's exact
  solver does not meet a demonstrated one-minute bound on all large patterns.

Keep this as a research preview until these tradeoffs are accepted or improved.
The stable model pointer and published registry are unchanged. Follow-up work
should prioritize non-square paper, independent curated images, and scalable
geometric fitting. Tuning on this now-observed holdout would require reporting
that exposure and obtaining a new independent test set.

## Validation and evidence

- Full Rust workspace tests; focused compiler/detector/WASM clippy; Rust format.
- Detector exhaustive spatial-index predicate parity and 558-case graph parity.
- WASM Node tests, including retained AUX through exact solving.
- Full web suite: 500 files, 6,259 tests, followed by all 56 modal tests after
  adding the AUX preview assertion. Node 26 required
  `NODE_OPTIONS=--no-experimental-webstorage` for jsdom's storage implementation.
- Web lint, TypeScript, production build with WASM hooks and landing prerender;
  desktop compile check; four synthetic-data/training checks.
- ONNX export matches the recorded hash and PyTorch within 8.35e-6 absolute
  output error; actual app-worker tests cover original-source adaptive tiling.

No vendored port behavior changed; external port oracles were not rerun for
this original detector work. WebGPU execution and other hardware/browser
combinations were not validated here. Private per-case evidence remains in
`artifacts/cp-recognition/`, with reproduction instructions beside the tools.

## Follow-up: bounded exact solving (E027)

Recognition weights and the recognition tables above remain unchanged. An
opt-in partial-grid fallback improves exact solving while preserving every
previously accepted ordinary solve. It holds only well-supported grid points,
leaves off-grid vertices free, and rechecks a proposed solution against the
original coordinates and movement budget. Manual exact solving is unchanged.

| Exact recovery at 2 px, including assignments | Previous candidate | E027 |
| --- | ---: | ---: |
| Development | 293/418 | 307/418 |
| Previously observed holdout | 77/108 | 83/108 |
| Combined | 370/526 | 390/526 |

There are 20 gains and 0 recovery regressions across these 526 cases. The replay's
solve allowance is 35 s rather than the earlier 25 s, so these are results of the
new algorithm **and** its budget policy. Accepted ordinary solves remain
unchanged; large inputs retain the existing lattice-first policy. Compared
with the original product baseline, strict recoveries rise from 341 to 390.
The post-solve edge-error total is 14,011 versus 42,982 originally (3.07× lower).
This follow-up began after the original holdout was observed and is not a new
blind holdout claim.

In the actual browser worker and fused solver, Dwarf completes in 14.16 s
(12.88 s recognition, 1.15 s solve), matching all 2,327 edges and assignments at 2 px.
Maximum normalized vertex error is about 7.1e-9 px. Compact automatic import now
allocates the remainder of 60 s after recognition to solving. This is a
cooperative runtime budget, not a guarantee on every device or a promise that
every returned graph is correct.

Skytree's isolated stress run recognizes in 19.80 s and rejects a forced solve
in another 20.00 s. The normal modal stops at recognition because the graph still
has combinatorial defects. A preceding concurrent stress run exited 137 and
produced no result; it is recorded in the notebook. No perfect Skytree recovery
is claimed. The earlier curated and non-square limitations remain.

E021–E026 also tested diagnostic truth substitutions, larger image sampling,
synthetic annotation training, wider capacity, and direction/grid precision.
None changed the selected weights. E023 improved annotation validation but
reduced real development exact graphs 339 → 323; E024 failed the clean-accuracy
gate. Negative results and their source/configuration snapshots are retained.
