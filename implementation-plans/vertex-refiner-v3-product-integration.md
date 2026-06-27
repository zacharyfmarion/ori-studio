# Vertex Refiner V3 Product Integration

## Goal

Quantify what the V3 frame-aware vertex refiner buys us over the current
CPLineNet dense junction path, then integrate it into the architecture
inspector and product runtime as the default junction source on this branch.

The outcome should be a product-ready junction-refinement path for rectified
light-mode rendered crease patterns:

```text
uploaded/source CP image
  -> rectification and known square frame
  -> dense CPLineNet inference, as today
  -> V3 source-only vertex-refiner proposals and crop inference
  -> global refined junction primitives
  -> candidate graph generation
  -> beam selection and exact solve
  -> inspector/product diagnostics
```

This branch should behave like a real product promotion candidate: the visible
import flow uses V3 by default, and we either merge that default after
end-to-end metrics and visual failure review, or keep the branch unmerged.

## Approach

- Treat the trained V3 checkpoint as a second model that runs after
  rectification on source-image/frame channels.
- Keep CPLineNet dense outputs as the existing line, assignment, boundary, and
  optional fallback evidence source.
- Add benchmarkable junction-source modes:
  - `dense-model`: current dense junction primitives.
  - `line-arrangement`: deterministic source-image/line-arrangement junctions.
  - `vertex-refiner-v3`: V3 proposal crops, crop-level decode, global merge.
  - `hybrid`: optional later union/fallback mode once the pure V3 path is
    measured.
- Reuse the architecture inspector as the product-debug surface: it should show
  proposal centers, crop predictions, global merge clusters, final refined
  junctions, candidate graph changes, and exact-solve outcome.
- Keep product integration staged but honest: this branch promotes V3 in the
  visible import flow while preserving dense-model fallback modes and benchmark
  switches for comparison.

## Affected Areas

- ML repo:
  `~/Documents/code/create-pattern-detector`
  - V3 checkpoint export to ONNX.
  - Vertex-refiner manifest/current-pointer metadata.
  - ONNX parity and threshold/merge sweeps.
  - Full-pattern comparison reports and failure visualizations.
- Product repo:
  `tree-maker-rust`
  - `scripts/cp-detect/current-model.json`
  - `apps/web/public/models/`
  - `apps/web/src/lib/cpDetectInference.ts`
  - `apps/cp-detect-architecture-inspector/src/uploadWorker.ts`
  - `apps/cp-detect-architecture-inspector/src/`
  - `crates/oristudio-cp-detect`
  - `crates/oristudio-cp-detect-wasm`
  - `crates/oristudio-cp-detect-inspector`
  - `scripts/cp-detect/`

## Checklist

### Phase 1: Baseline Inventory And Contracts

- [x] Record the selected V3 checkpoint and full-eval metrics in a product-side
      plan section.
- [x] Identify current product CPLineNet model pointer, dense output contract,
      and current junction decode parameters.
- [x] Identify current no-refiner comparison modes already present in Rust:
      `dense-model`, `line-arrangement`, source-image line evidence, and
      ground-truth junction-label ablations.
- [x] Define a stable V3 product manifest schema:
      model id, source checkpoint, ONNX SHA, input channel names, output names,
      crop size, proposal strategy, decode threshold, merge radii, and training
      profile.
- [x] Decide the product asset layout for V3, separate from the dense
      CPLineNet pointer.

Exit criteria:

- The repo has a single product-side document naming the exact V3 checkpoint,
  expected model asset paths, runtime input/output contract, and baseline modes.
- No product code path depends on undocumented checkpoint paths.

### Phase 2: Export And Local Model Validation

- [x] Add or update an export script for `VertexRefinerV3` ONNX.
- [x] Fix any stale `v1` naming in product-side vertex-refiner manifest helpers so V3
      metadata is explicit.
- [x] Export the fine-tuned V3 checkpoint:
      `checkpoints/runpod_vertex_refiner_v3_light_rendered_ft_20260626_4090/full/best.pt`.
- [x] Generate `manifest.json` and SHA metadata for the exported ONNX.
- [x] Run Python-vs-ONNX parity on representative V3 crops.
- [x] Copy or link the exported model into ignored product asset dirs:
      stable `apps/web/public/models/cp-vertex-refiner-v3` and versioned
      `apps/web/public/models/cp-vertex-refiner-v3-<model-id>`.
- [x] Add a product-side pointer file analogous to
      `scripts/cp-detect/current-model.json`.
- [x] Add a product-side asset checker for the V3 refiner pointer.

Exit criteria:

- Product repo can verify local V3 refiner assets without reading ML repo
  internals.
- ONNX output ordering and tensor shapes are covered by tests.

### Phase 3: Full-Pattern Comparison Harness

- [x] Build a comparison harness that runs the same samples through:
      current dense junctions, line-arrangement junctions, and V3 refined
      junctions.
- [x] Fix benchmark frame loading for V3: accept both legacy 4-point
      `v2_boundary.frame` metadata and the current `{x_min,y_min,x_max,y_max}`
      object schema, using the manifest `render_metadata` path when present.
- [x] Remove proximity-based boundary-contact promotion from V3 evaluation:
      near-frame interior vertices now remain interior unless V3 explicitly
      emits a boundary-contact signal.
- [ ] Report crop-level and global merged vertex metrics:
      precision, recall, F1, boundary-contact metrics, close-pair metrics,
      false positives on empty crops, and mean pixel error.
- [ ] Report graph metrics:
      candidate oracle recall, selected recall, assignment-correct selected
      spans, strict topology, exact-solve success, and runtime.
- [ ] Support sweeps for:
      refiner heatmap threshold, boundary threshold, proposal cap, crop overlap,
      merge radius, boundary merge radius, min support, and candidate strategy.
- [ ] Produce visual artifacts:
      V3 proposals, crop predictions, merged junctions, false positives, false
      negatives, and graph-diff overlays against the no-refiner path.

Exit criteria:

- We can answer, with reports and images, whether V3 improves the end-to-end
  graph pipeline versus no refiner on clean/native and scraped-rendered slices.
- Any regression is traceable to proposal coverage, crop model scoring, global
  merge, or graph candidate selection.

Progress:

- Extended `scripts/cp-detect/run-browser-correctness-fast.mjs` so the
  existing product-path browser runner can use `--junction-source
  dense-model`, `--junction-source line-arrangement`, or `--junction-source
  vertex-refiner-v3`, V3 manifest/model overrides, and hard-error or dense
  fallback behavior.
- Browser correctness run manifests and per-sample reports now record the
  junction source and V3 merged-vertex counts, making dense-vs-V3 runs
  comparable through the existing `evaluate-correctness-pair.py` flow.
- Root-caused the apparent zero-boundary-contact V3 product failure on clean
  sample `rabbit_ear_fold_program_v1-5wk0e-000354__clean__003`: the runner was
  not reading the object-shaped `v2_boundary.frame`, so V3 cropped against the
  full image frame `{0,0,1023,1023}` instead of the paper frame
  `{32,32,992,992}`. With the fixed frame loader, the same sample accepts
  `54` refined boundary-contact primitives and the final graph has `52`
  border edges.
- Added diagnostic artifacts for that sample under
  `artifacts/cp-detect-correctness/reports/clean-1024-s15/v3-boundary-crop-debug/rabbit_ear_fold_program_v1-5wk0e-000354__clean__003/`,
  including full-CP crop overlays and per-side boundary crop sheets.
- Remaining harness work is producing paired report/contact-sheet artifacts
  from real benchmark runs.

### Phase 4: Stage Inspector Data Path

- [x] Add a V3 refiner inference module in the browser worker or shared web
      runtime:
      load manifest, create ONNX session, build 11-channel `96 x 96` crops,
      batch inference, decode, and merge.
- [x] Keep the refiner runtime independent from CPLineNet dense junction
      outputs; use the rectified source image and known frame as mandatory
      inputs.
- [x] Add an inspector upload option for junction source:
      dense model, line arrangement, V3 refiner.
- [x] Extend uploaded inspector bundle metadata with V3 runtime stats and
      model id.
- [x] Extend WASM/Rust stage-bundle input to accept optional refined junction
      primitives or refined dense-like junction evidence.
- [x] Preserve the current dense-only path as the default while V3 is
      benchmarked.

Exit criteria:

- The architecture inspector can run uploaded images with V3 junctions without
  changing product defaults.
- Stage JSON includes enough V3 debug payload to reproduce or visualize the
  global merged junction set.

Progress:

- Product-side current pointer:
  `scripts/cp-detect/current-vertex-refiner.json`.
- Selected checkpoint:
  `~/Documents/code/create-pattern-detector/checkpoints/runpod_vertex_refiner_v3_light_rendered_ft_20260626_4090/full/best.pt`.
- Best local V3 crop eval:
  precision `0.9303836460375245`, recall `0.9178407646831317`,
  F1 `0.9240696445458086`, mean error `0.5553382461687462`.
- Exported stable browser asset:
  `apps/web/public/models/cp-vertex-refiner-v3/model.onnx`.
- ONNX SHA:
  `641605bde6fe5b6cb518bb6f77287e71e4505d6ac4861542fdec08e00b82cfca`.
- Implemented browser V3 manifest parsing, ONNX output collection, and
  mocked inference tests.
- Implemented inspector-worker V3 manifest/model/session verification and
  one-crop ONNX smoke inference.
- Implemented shared browser V3 source-frame preprocessing, crop tensor
  construction, sliding-window proposals, ONNX output decode, and global merge.
- Implemented an opt-in inspector upload V3 pass that runs in parallel with
  dense inference and stores proposals/raw predictions/merged vertices in
  Stage 0 debug metadata.
- Implemented first Stage 0 overlay markers for V3 proposal centers and merged
  vertices.
- Implemented uploaded-run metadata fields for `junction_source` and
  `vertex_refiner_manifest_id`; graph ingestion still uses dense junctions
  until refined junction primitives are threaded through Rust/WASM.
- Implemented uploaded-run V3 evidence override: when `junction_source` is
  `vertex-refiner-v3`, Stage 1 replaces dense junction/contact primitives with
  V3 merged vertices and Stage 5 `junction-first-v1` builds the candidate graph
  from that same refined evidence.
- Implemented the product decode/FOLD-export API that accepts refined vertices
  and feeds them through the same candidate generation, beam selection, exact
  solve, and FOLD export path as dense junctions.

### Phase 5: Stage Inspector Visualization

- [ ] Add visual layers for V3 proposal centers, accepted crop predictions,
      rejected crop predictions, merge clusters, and final refined junctions.
- [ ] Add side-by-side or toggleable graph diff for dense-model vs V3-refiner
      junction sources.
- [ ] Surface per-stage counts:
      proposals, crop predictions, merged vertices, boundary contacts, false
      positives on empty crops when GT exists, candidate spans, and selected
      spans.
- [ ] Add failure navigation for V3 false positives/false negatives.

Exit criteria:

- A user can inspect why V3 changed the graph on a sample without opening raw
  JSON or Python visualizations.

### Phase 6: Product Runtime Integration

- [x] Add V3 model loading to the shared CP detection runtime.
- [x] Add product configuration for junction source, initially hidden behind a
      developer/inspector flag.
- [x] Thread refined junction primitives into the product graph construction
      path used by uploaded/recognized CPs.
- [x] Ensure V3 runs after rectification and can run in parallel with dense
      CPLineNet inference when the runtime supports it.
- [x] Add graceful fallback to dense-model junctions if V3 assets are missing
      or inference fails.
- [x] Keep the source-only invariant: V3 must not require FOLD labels,
      CPLineNet junction heatmaps, or skeleton input at runtime.

Exit criteria:

- Product can run V3 on a rectified image locally.
- Product can fall back cleanly to the existing dense junction path.

Progress:

- Added `junctionSource: 'vertex-refiner-v3'` and
  `vertexRefinerFallback` to the shared CP detection worker options.
- Added product-worker V3 manifest/session/model verification and a hidden
  `verifyVertexRefinerAssets` worker API.
- Added product-worker V3 inference on rectified `ImageData` using the same
  source/frame channels and merged-vertex decoder as the architecture
  inspector.
- Added a WASM decode entry point that accepts V3 merged vertices as refined
  junction/contact evidence and routes them through the product
  `legacy_candidate_exact_solve_v1` backend.
- Refactored the core candidate exact-solve backend so the existing dense path
  and V3-refined path share candidate generation, beam selection, exact solve,
  FOLD export, and detector-report metadata.
- The visible import modal now calls the product worker with
  `junctionSource: 'vertex-refiner-v3'` and `vertexRefinerFallback: 'error'`,
  so the branch exercises V3 as the real default rather than hiding it behind
  an inspector-only option.
- Re-exported the V3 ONNX with dynamic batch axes and recorded
  `batch_size: 256` in the manifest. The previous export was fixed-batch-1 and
  made browser inference unusably slow for full-pattern proposal sets.

### Phase 7: Product Benchmarks And Promotion Gate

- [x] Root-cause and fix V3 boundary-contact integration before judging
      promotion metrics.
- [x] Re-run clean-1024-s15 with the corrected product V3 frame path.
- [ ] Run clean/native benchmark packs with dense-model, line-arrangement, V3,
      and any hybrid mode.
- [ ] Run accepted scraped-rendered image smoke tests through the inspector and
      product path.
- [ ] Compare exact-solve success, topology diagnostics, and runtime.
- [ ] Review visual failure sheets for false-positive graph damage.
- [ ] Decide whether V3 becomes default, remains opt-in, or needs another
      training/proposal/merge iteration.

Promotion criteria:

- V3 improves strict topology and exact-solve success or materially reduces
  junction-related failures on target rendered CPs.
- V3 does not introduce enough false vertices to degrade graph selection on
  clean/native CPs.
- Runtime is acceptable for browser usage, or batching/worker scheduling has a
  clear mitigation.

Progress:

- Root cause for the first product V3 run: the refiner was using the whole
  rectified bitmap as its frame. Dense CP evidence already normalizes boundary
  contacts against the paper frame (`target_quad` after rectification, or
  `render_metadata.v2_boundary.frame` in synthetic benchmark packs). V3 crops
  were therefore centered on the image edge instead of the paper edge when the
  CP was rendered with inset padding, and Rust recomputed boundary
  `side_coordinate` against the full bitmap.
- Frame fix:
  - Product import passes `rectified.report.target_quad` as
    `vertexRefinerFrame`.
  - Inspector upload derives `vertexRefinerFrame` from
    `rectification_report.target_quad` when the caller does not pass one.
- Browser correctness packs load `render_metadata.v2_boundary.frame` and pass
  it into the V3 product path.
- Browser V3 decode emits frame-relative `side_coordinate` for boundary
  contacts.
- Rust/WASM and inspector refined-vertex ingestion preserve that
  `side_coordinate` instead of re-normalizing against the full image.
- Product V3 run summaries now include the frame used by the refiner, so future
  benchmark reports can confirm whether a run used the paper frame or the full
  bitmap edge.
- Removed the temporary source-boundary proposal experiment from the active V3
  product path. The current measured proposal policy is again source/frame crop
  channels plus frame corners, regular boundary proposals, and interior sliding
  windows.
- Replaced the greedy interior proposal thinning with deterministic
  full-coverage interior layout. Boundary/corner crops are emitted first, then
  the remaining proposal budget is used for an evenly spaced interior grid. On
  the clean 1024 benchmark frame `{32,32,992,992}`, this produces `120`
  boundary/corner proposals plus an `11 x 11` interior grid, for `241` total
  crops under the `256` proposal cap.

- Ran clean-1024-s15 through the product browser/WASM path with
  `legacy_candidate_exact_solve_v1` for:
  - dense-model:
    `artifacts/cp-detect-correctness/runs/clean-1024-s15/product-dense`
  - line-arrangement:
    `artifacts/cp-detect-correctness/runs/clean-1024-s15/product-line-arrangement`
  - vertex-refiner-v3:
    `artifacts/cp-detect-correctness/runs/clean-1024-s15/product-v3`
- Scored line-arrangement and V3 against the dense product baseline using the
  GT evaluator:
  - `artifacts/cp-detect-correctness/reports/clean-1024-s15/product-line-vs-dense`
  - `artifacts/cp-detect-correctness/reports/clean-1024-s15/product-v3-vs-dense`
- Clean-15 aggregate relative to dense product baseline:
  - V3: vertex F1 `+0.0050`, edge F1 `-0.0008`, edge precision
    `+0.0008`, edge recall `-0.0019`, structural-validity rate `-0.2667`.
  - Line-arrangement: vertex F1 `-0.0032`, edge F1 `-0.0063`,
    structural-validity rate `-0.3333`.
- V3 runtime is now functional with dynamic-batch ONNX, but WebGPU inference is
  still around 20 seconds for 256 crops on the first clean sample. Runtime
  needs a proposal-cap/selection sweep or lower-cost proposal policy before
  product promotion.
- Main observed V3 product failure mode: boundary contacts are not being
  recovered. Clean-15 V3 outputs have only `4-5` border edges on every sample,
  while dense outputs have `12-53`. Sample reports show V3 refined evidence is
  currently accepted almost entirely as interior junctions, e.g. sample 000 had
  `130` accepted junction primitives and `0` accepted boundary contacts.
  This result is now considered invalid for promotion decisions because it came
  from the full-image-frame bug above.
- Corrected-frame rerun:
  - Run:
    `artifacts/cp-detect-correctness/runs/clean-1024-s15/product-v3-frame`
  - Comparison report:
    `artifacts/cp-detect-correctness/reports/clean-1024-s15/product-v3-frame-vs-dense`
  - Product FOLD output succeeded for all 15 samples.
  - Dense baseline product statuses: 5 valid, 10 repaired.
  - V3-frame product statuses: 12 valid, 3 repaired.
  - Evaluator structural-validity rate still regressed from `0.6667` dense to
    `0.2000` V3-frame.
  - Vertex F1 improved from `0.0201` dense to `0.0244` V3-frame (`+0.0044`),
    but edge F1 fell from `0.0072` to `0.0058` (`-0.0014`) and assignment
    accuracy fell from `0.9474` to `0.9167`.
  - Dense baseline border-edge count averaged `27.4` per sample; V3-frame
    averaged only `4.4` per sample.
  - The refined evidence report accepted `1212` V3 merged vertices total, but
    only `4` as boundary contacts and `1208` as interior junctions. This means
    the remaining blocker is not the paper-frame handoff; it is the
    full-pattern boundary-contact proposal/decode/model behavior.
- Deterministic full-coverage rerun:
  - Run:
    `artifacts/cp-detect-correctness/runs/clean-1024-s15/product-v3-fullcoverage-layout`
  - Comparison report:
    `artifacts/cp-detect-correctness/reports/clean-1024-s15-dense-vs-v3-fullcoverage-layout`
  - Product FOLD output succeeded for all 15 samples.
  - Relative to the previous V3 layout, vertex F1 improved from `0.0175` to
    `0.0179`, edge F1 improved from `0.0043` to `0.0050`, assignment accuracy
    improved from `0.8182` to `0.9231`, and structural-validity rate improved
    from `0.2667` to `0.3333`.
  - Relative to the dense baseline, deterministic-coverage V3 still trails:
    dense vertex F1 `0.0201` vs V3 `0.0179`, dense edge F1 `0.0072` vs V3
    `0.0050`, dense assignment accuracy `0.9474` vs V3 `0.9231`, and dense
    structural-validity rate `0.6667` vs V3 `0.3333`.
  - Interpretation: crop coverage was a real weakness in the previous V3
    proposal layout, but fixing coverage alone is not enough for promotion.
    The next blocker is likely merge/selection/graph integration quality and
    boundary-contact treatment, not missing interior crop coverage by itself.
- Added reusable V3 debug-analysis tooling:
  - `scripts/cp-detect/run-vertex-refiner-debug-pack.mjs` saves the actual
    proposal, raw crop prediction, and merged-vertex payloads for a correctness
    pack without running downstream graph construction.
  - `scripts/cp-detect/analyze-vertex-refiner-crop-geometry.py` matches GT
    vertices directly against V3 merged vertices and reports misses/false
    positives by crop coverage, best crop margin, crop-edge intersections,
    boundary/interior location, degree, and sample.
  - First clean-15 direct merged-vertex result:
    precision `0.9269`, recall `0.9310`, F1 `0.9289`.
  - Crop-edge intersections do not explain missed GT vertices: at 4px from a
    crop-edge intersection, near miss rate was `0.0637` vs far miss rate
    `0.0709`. They do explain false positives better: near false-positive rate
    was `0.1587` vs far false-positive rate `0.0381`.
  - Current analysis artifacts:
    `artifacts/cp-detect-correctness/reports/clean-1024-s15/vertex-refiner-v3-crop-geometry`.

### Phase 8: Documentation, Tests, And Handoff

- [x] Document the V3 model pointer, export command, asset check command, and
      inspector usage.
- [x] Add Rust tests for refined junction primitive ingestion and candidate
      generation behavior.
- [ ] Add TypeScript tests for V3 manifest parsing, asset checks, and worker
      option routing.
- [ ] Add deterministic benchmark report artifacts or instructions under
      `scripts/cp-detect/README.md`.
- [ ] Update this plan with final benchmark results and promotion decision.

Exit criteria:

- Subsequent agents can reproduce export, local asset setup, inspector
  comparison, and product benchmark runs without rediscovering the workflow.

## Open Questions

- Should the first product integration pass feed V3 as explicit junction
  primitives, or convert V3 predictions into dense-like junction probability and
  offset tensors so the existing Rust evidence extractor changes less?
- What proposal strategy should be default for product V3:
  overgenerated source/frame proposals, sliding windows, dense-line-supported
  candidates, or a hybrid?
- Do we need a second small refiner model for proposal scoring, or can decode
  threshold plus merge/min-support control false positives enough?
- Is the browser runtime fast enough with ONNX Runtime WebGPU/WASM for hundreds
  of `96 x 96` crops, or do we need staged/batched scheduling with progress?
- What is the right promotion metric: strict topology, exact-solve success,
  graph edit distance, or downstream folded-base correctness?
