# Dense-Region Vertex Refinement

## Goal

Experiment with using the V3 vertex refiner only in HRNet-dense junction regions
instead of running full-coverage crop refinement over the whole crease pattern.

The experiment should answer whether selective, mostly non-overlapping V3 crops
reduce duplicate/merge errors while preserving or improving product metrics.

## Approach

- Add a `dense-junction-regions` V3 proposal mode driven by HRNet junction
  logits.
- Select crop centers around dense clusters of HRNet junction peaks, with
  optional low-overlap / no-overlap behavior.
- Keep the existing full-coverage proposal mode as an explicit comparison
  baseline.
- Decode selective V3 as a hybrid evidence source: retain HRNet junction and
  boundary-contact evidence outside selected crop boxes, and replace evidence
  inside selected boxes with V3 merged vertices.
- Expose the mode through the browser worker, upload inspector, benchmark
  runner, and debug runner.
- Generate metrics and crop-layout visualizations comparing full coverage
  against dense-region refinement.
- Exclude border-touching dense-region crops for now; they made metrics worse,
  especially border F1. TODO: investigate why V3 border-region refinement
  regresses boundary contacts before re-enabling it.
- Promote the no-border dense-region mode as the product/inspector default:
  `threshold=0.35`, `minPeaks=3`, and `maxOverlapFraction=0`.

## Affected Areas

- `apps/web/src/lib/vertexRefinerPipeline.ts`
- `apps/web/src/workers/cpDetectWorker.ts`
- `apps/web/src/engine/cpDetectTypes.ts`
- `apps/cp-detect-architecture-inspector/src/uploadWorker.ts`
- `crates/oristudio-cp-detect/src/decode.rs`
- `crates/oristudio-cp-detect-wasm/src/lib.rs`
- `scripts/cp-detect/run-browser-correctness-fast.mjs`
- `scripts/cp-detect/run-vertex-refiner-debug-pack.mjs`
- CP detector benchmark/report artifacts under `artifacts/`

## Checklist

- [x] Add selective dense-region proposal generation with tests.
- [x] Add hybrid refined-region decode so non-dense HRNet vertices are preserved.
- [x] Wire proposal mode/options through product worker and inspector upload.
- [x] Wire benchmark/debug scripts to pass proposal mode/options.
- [x] Run focused validation.
- [x] Run clean-15 metrics comparing full coverage and dense-region mode.
- [x] Generate crop-layout visualizations for representative samples.
- [x] Exclude border-touching dense-region crops and rerun clean-15 metrics.
- [x] Wire product, architecture inspector, and benchmark/debug defaults to the
      no-border dense-region path.
