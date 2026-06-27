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
- `apps/web/src/workers/cpDetectWorker.ts`
- `scripts/cp-detect/run-vertex-refiner-debug-pack.mjs`
- `scripts/cp-detect/analyze-vertex-refiner-crop-geometry.py`
- `scripts/cp-detect/README.md`

## Checklist

- [x] Save reusable clean-15 V3 debug payloads with proposals, raw predictions,
      merged vertices, and runtime.
- [x] Add crop-geometry analysis for direct V3 merged-vertex precision/recall.
- [x] Root-cause the first duplicate class: paper-corner contacts split by
      side-strict boundary merging.
- [x] Add corner-aware boundary merge behavior.
- [x] Re-run direct merged-vertex metrics and record the delta.
- [ ] Analyze remaining false positives after corner-aware merge.
- [ ] Iterate on support/overlap filtering if false positives remain clustered
      in high-overlap regions.
- [ ] Re-run product-path clean-15 metrics after the direct merged-vertex
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
