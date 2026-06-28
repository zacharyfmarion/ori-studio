# Vertex Refiner V3 Merge Iterations

## Goal

Make global V3 vertex merging as close to perfect as possible under the
assumption that each window can detect every junction it sees. The practical
target is that overlapping crop predictions collapse into one CP vertex when
they represent the same physical junction, while preserving genuinely distinct
nearby vertices.

## Approach

- Use saved V3 debug payloads, not final FOLD output, as the source of truth for
  merge-quality iteration.
- Measure direct GT-vs-merged-vertex precision, recall, and F1 after each merge
  change.
- Separate duplicate/split predictions from true hallucinations by checking
  distance to GT and distance to already-matched predictions.
- Prefer post-processing fixes before retraining when raw window predictions
  already contain enough evidence to identify duplicates.
- Commit useful checkpoints as merge behavior improves.

## Affected Areas

- `apps/web/src/lib/vertexRefinerPipeline.ts`
- `apps/web/src/lib/vertexRefinerPipeline.test.ts`
- `apps/web/src/engine/cpDetectTypes.ts`
- `apps/web/src/workers/cpDetectWorker.ts`
- `scripts/cp-detect/run-vertex-refiner-debug-pack.mjs`
- `scripts/cp-detect/analyze-vertex-refiner-crop-geometry.py`
- `scripts/cp-detect/remerge-vertex-refiner-debug.ts`
- `scripts/cp-detect/simulate-perfect-vertex-refiner-merge.ts`
- `scripts/cp-detect/current-vertex-refiner.json`
- `scripts/cp-detect/evaluate-correctness-pair.py`
- `scripts/cp-detect/README.md`

## Checklist

- [x] Save reusable clean-15 V3 debug payloads with proposals, raw predictions,
      merged vertices, and runtime.
- [x] Add crop-geometry analysis for direct V3 merged-vertex precision/recall.
- [x] Root-cause the first duplicate class: paper-corner contacts split by
      side-strict boundary merging.
- [x] Add corner-aware boundary merge behavior.
- [x] Re-run direct merged-vertex metrics and record the delta.
- [x] Analyze remaining false positives after corner-aware merge.
- [x] Iterate on support/overlap filtering if false positives remain clustered
      in high-overlap regions.
- [x] Add metrics-only analysis mode so merge sweeps do not spend time
      rendering overlays.
- [x] Add a perfect-local merge simulation that feeds GT vertices through the
      real crop layout to isolate merge behavior from model recall.
- [x] Try same-crop conflict splitting as an opt-in merge strategy.
- [x] Re-run product-path clean-15 metrics after the direct merged-vertex
      metrics are close to saturated.

## Iteration Log

### Baseline: Deterministic Full-Coverage Merge

- Code state: deterministic full-coverage proposal layout, side-strict boundary
  merge, `minSupport = 1`.
- Debug run:
  `artifacts/cp-detect-correctness/runs/clean-1024-s15/vertex-refiner-v3-fullcoverage-debug`.
- Analysis report:
  `artifacts/cp-detect-correctness/reports/clean-1024-s15/vertex-refiner-v3-crop-geometry`.
- Direct merged-vertex metrics at 5px:
  - Precision: `0.9269`
  - Recall: `0.9310`
  - F1: `0.9289`
- Finding:
  - GT misses are not worse near crop-edge intersections.
  - False positives are worse near crop-edge intersections.
  - Many near-intersection false positives are duplicates very close to GT and
    to an already matched prediction.
- Root cause for exact duplicates:
  - `clusterDistance` returns `Infinity` for boundary contacts on different
    sides, even when they are the same physical paper-corner vertex.

### Iteration 1: Corner-Aware Cross-Side Boundary Merge

- Code change:
  - Boundary contacts with different sides may now merge when their physical
    Euclidean distance is within the boundary merge radius. Same-side boundary
    contacts still use side-axis distance.
  - This targets paper-corner splits such as top/left or top/right contacts
    without relaxing ordinary boundary contacts across the full frame.
- Replay run:
  `artifacts/cp-detect-correctness/runs/clean-1024-s15/vertex-refiner-v3-merge-iter1-corner-aware`.
- Analysis report:
  `artifacts/cp-detect-correctness/reports/clean-1024-s15/vertex-refiner-v3-merge-iter1-corner-aware`.
- Direct merged-vertex metrics at 5px:
  - Precision: `0.9469` (`+0.0200`)
  - Recall: `0.9295` (`-0.0015`)
  - F1: `0.9381` (`+0.0092`)
  - Pred vertices: `1337` (`-31`)
  - False positives: `71` (`-29`)
- Remaining issue:
  - Boundary precision improved but is still weaker than interior precision:
    boundary `0.8986`, interior `0.9709`.
  - Near crop-edge-intersection false-positive rate fell from `0.1587` to
    `0.0929`, but remains above far false-positive rate `0.0381`.

### Iteration 2: Boundary Merge Radius Sweep

- Code path:
  - Replayed the saved raw window predictions through product merging with
    boundary merge radii `3`, `4`, `5`, `6`, and `8`.
  - Interior merge radius stayed at `3`.
- Best tradeoff in this pass:
  - Boundary radius `5`.
  - Precision: `0.9700`
  - Recall: `0.9266`
  - F1: `0.9478`
  - Pred vertices: `1301`
  - Matched GT vertices: `1262`
- Finding:
  - The extra boundary radius removes side-split and near-duplicate boundary
    predictions that survived corner-aware merging.
  - Pushing beyond `5` starts to lose more boundary recall without improving F1.

### Iteration 3: Support Fraction + Full Radius Sweep

- Code change:
  - Add `min_support_fraction` to the product manifest, worker options, debug
    runner, ONNX export manifest, and merge function.
  - The default is `0.25`, meaning a merged vertex must be detected by at least
    one quarter of the crops that cover its merged position.
  - Add `--skip-overlays` to the crop-geometry analyzer so broad merge sweeps
    can run without rasterizing full visual reports.
- Grid:
  - Interior radius: `3`, `4`, `5`, `6`.
  - Boundary radius: `2`, `3`, `4`, `5`, `6`, `8`.
  - Support fraction: `0`, `0.15`, `0.2`, `0.25`, `0.33`, `0.5`.
- Best F1 setting:
  - Interior merge radius: `5`
  - Boundary merge radius: `5`
  - Min support fraction: `0.25`
- Metrics:
  - Precision: `0.9821`
  - Recall: `0.9258`
  - F1: `0.9531`
  - Pred vertices: `1284`
  - Matched GT vertices: `1261`
- Compared with iteration 1:
  - False positives drop from `71` to `23`.
  - Matched GT vertices drop from `1266` to `1261`.
  - Crop-edge-intersection false-positive rate is no longer elevated:
    near-4px `0.0179`, far `0.0179`.
- Recall caveat:
  - Of the seven baseline-matched GT vertices that iteration 3 no longer
    matches, six are boundary/corner or near-boundary cases with another GT
    vertex within roughly `0.02px` to `3.4px`; the remaining one is an interior
    point near the paper edge.
  - Among all iteration-3 GT misses, `50 / 101` are within `8px` of another GT
    vertex. This means direct GT recall is partly measuring near-coincident
    graph topology rather than only physical rendered junction recovery.

### Iteration 4: Perfect-Local Merge Simulation

- Code change:
  - Add `simulate-perfect-vertex-refiner-merge.ts`, which synthesizes one raw
    vertex prediction for every GT vertex in every crop that contains it, then
    runs the product merge.
- Current product merge defaults on perfect-local inputs:
  - Precision: `1.0000`
  - Recall: `0.9780`
  - F1: `0.9889`
  - Pred vertices: `1332`
- Interpretation:
  - The merge is duplicate-free under perfect local evidence.
  - The remaining recall loss is caused by near-coincident GT vertices being
    intentionally collapsed by the `5px` radius, not by missing crop coverage.
  - Smaller radii recover more GT duplicates in the perfect simulation
    (`r=3`, `b=2` gives `0.9952` F1), but actual model precision is worse
    because real window predictions have several-pixel jitter and duplicate
    peaks.

### Iteration 5: Same-Crop Conflict Split

- Hypothesis:
  - If one crop emits two nearby peaks, that is evidence for two distinct local
    vertices. Split merged clusters that contain same-crop conflicts, and only
    keep split children with stronger overlap support.
- Perfect-local result:
  - Precision: `1.0000`
  - Recall: `1.0000`
  - F1: `1.0000`
- Actual model replay result with split enabled:
  - Precision: `0.9627`
  - Recall: `0.9273`
  - F1: `0.9447`
  - Pred vertices: `1312`
- Decision:
  - Keep same-crop conflict splitting as an explicit experimental option.
  - Do not enable it by default yet. The current model sometimes emits duplicate
    same-crop peaks for one physical junction, so the splitter restores false
    positives faster than it restores true near-coincident vertices.
  - Product defaults remain iteration 3: interior radius `5`, boundary radius
    `5`, min support fraction `0.25`, conflict splitting off.

### Iteration 6: Product-Path Confirmation

- Code change:
  - Make `evaluate-correctness-pair.py` map normalized product FOLD
    coordinates through each sample's paper frame from `render_metadata`.
  - Before this fix, the evaluator multiplied product coordinates by the full
    image extent and shifted clean renders by the `32px` paper margin.
- Product run:
  - `artifacts/cp-detect-correctness/runs/clean-1024-s15/product-v3-merge-default-confirm`.
  - V3 product vertex counts match the direct merged-vertex counts, except for
    a couple of one-vertex graph repair differences.
- Frame-aware product comparison against the existing dense product run:
  - Dense product vertex F1: `0.9885`
  - Dense product edge F1: `0.9634`
  - V3 product vertex F1: `0.9501`
  - V3 product edge F1: `0.8868`
- Interpretation:
  - The merge duplicate problem is largely fixed in direct vertex space.
  - End-to-end V3 is now limited by local missed/off-target vertex predictions
    and by downstream graph construction sensitivity to those misses, not by
    overlap-window duplicate merging.
