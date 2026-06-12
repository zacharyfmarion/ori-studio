# CP Detect Stage Inspector Upload Flow

## Goal

Add an uploaded-image mode to `apps/cp-detect-architecture-inspector` so a
developer can choose or drop an arbitrary crease-pattern image, run the same
browser/Tauri product detection path, and inspect each pipeline step from raw
dense model outputs through candidate generation, beam selection, exactizability
probes, and Stage 6 exact solve.

This is a debugging surface. The production "Detect CP from Image" modal should
keep its current clean upload -> crop -> detect -> import flow, while the
inspector gets a richer side channel for understanding what happened. Uploaded
runs usually have no ground truth, so GT overlays and GT root-cause panels must
be optional rather than assumed.

## Approach

### 1. Share the product upload and inference path

Extract the browser CP-detect runtime currently embedded in
`apps/web/src/components/CpDetectImportModal.tsx`,
`apps/web/src/workers/cpDetectWorker.ts`, and
`apps/web/src/lib/cpDetectInference.ts` into a small shared browser module that
both the product app and the inspector can consume.

The shared module should own:

- image file decoding into `ImageData`
- image-type validation and object URL lifetime helpers
- auto and manual rectification calls
- detector model manifest verification
- ONNX Runtime Web session setup with the existing WebGPU/WASM fallback logic
- dense inference for the rectified image
- production final decode with `legacy_candidate_exact_solve_v1`

The inspector should not copy this logic. It should invoke the same client path
used by production so model choice, image size, rectification behavior,
threshold defaults, runtime fallbacks, and final exact-solve export stay in
sync.

### 2. Promote inspector stage construction into reusable Rust/WASM code

Move the stage-building logic out of
`crates/oristudio-cp-detect-inspector/src/main.rs` into reusable Rust functions,
likely under an `oristudio_cp_detect::inspector` module or a small sibling
module in the inspector crate if crate boundaries make that cleaner.

Introduce a context type like:

```rust
InspectorStageInput {
    sample: InspectorSampleSummary,
    dense_outputs: DenseOutputsOwned,
    threshold: f32,
    overlay_frame_px: OverlayFramePx,
    gt_graph: Option<GroundTruthGraphPayload>,
    input_image_url: String,
}
```

Then expose focused builders:

- `build_stage0_raw_dense`
- `build_stage1_evidence`
- `build_stage2_arrangement`
- `build_stage3_selection`
- `build_stage4_exactizability`
- `build_stage5_beam_selection`
- `build_stage5b_decision_audit`
- `build_stage6_exact_solve`

The current server sample routes should call these builders after reading cached
dense tensors. A new WASM wrapper should call the same builders from the
browser worker using the dense outputs already produced by product inference.

### 3. Add an uploaded-run stage bundle

Add a worker API for the inspector, something along these lines:

```ts
runInspectorUpload(image: ImageData, options): Promise<InspectorRunBundle>
```

The worker should:

1. auto-rectify the uploaded source image, or accept a manually adjusted quad
2. run dense inference on the rectified image
3. build Stage 0 through Stage 6 payloads from that exact dense tensor bundle
4. return compact stage JSON, downsampled maps, runtime timings, and warnings

Keep full dense tensors inside the worker. React should receive only compact
debug payloads: tensor metadata, probability maps, primitives, candidate graph
snapshots, selection reports, exactizability reports, and exact-solve reports.

Stage 0 should make the raw model output explicit:

- tensor names and dimensions
- model manifest id
- active execution provider and timing
- rectified input preview
- raw head previews for line, junction, boundary contact, non-crease,
  assignment channels, line-style channels, and any v3 heads available from the
  manifest

Stage 1 can remain the compiler evidence extraction view, derived from the raw
dense heads.

### 4. Add Upload mode to the inspector UI

Keep the current cached-sample experience intact, but add a mode switch near
the sample panel:

```text
Samples | Upload
```

Upload mode should mirror the production modal flow:

- choose image button and drag/drop target
- auto crop detection
- source crop editor with draggable quad handles
- rectified 1024x1024 preview
- "Run Inspector" action
- progress states for model check, rectification, dense inference, stage build,
  and exact solve

After a run completes, the existing stage selector should drive the uploaded
bundle instead of fetching `/api/stage*/examples/:id`. The active run can appear
as a synthetic sample row using the uploaded filename and image size.

### 5. Make no-GT runs first-class

Uploaded images should set:

```ts
ground_truth: null
```

GT-dependent controls should disappear or become disabled with neutral copy:

- Stage 5 GT graph overlay
- Stage 5b GT edge audit list and GT root-cause metrics
- sample rows showing GT edge counts

Candidate-only diagnostics should still work:

- selected, locked, available, conflict, dominated, rejected candidates
- selected/weak spans
- exactizability probe issues
- exact-solve before/after residuals
- moved vertices and local theorem failures
- legacy baseline graph, when it can be decoded from the same dense outputs

The Stage 5b audit should be valid with zero GT edges; it should summarize
candidate decisions instead of pretending a root-cause comparison exists.

### 6. Keep server-backed samples working

The Rust inspector server should continue to serve cached dense-cache examples
for reproducible comparisons. It should benefit from the same refactored stage
builders, but it does not need to run ONNX inference.

The inspector app will then support two data sources:

- cached server sample: current `/api/stage*/examples/:id` routes
- ad hoc upload: browser worker returns an in-memory `InspectorRunBundle`

This avoids implementing large dense-tensor POST uploads in the hand-rolled
local HTTP server, while still allowing exact Rust stage logic to run in the
browser through WASM.

### 7. Export and reproduce debug runs

Add an "Export Bundle" action for uploaded runs after the core UI works. The
bundle should contain compact stage JSON, rectification report, model manifest
id, runtime timings, threshold/options, and optionally downsampled maps. Do not
include the full dense tensors by default.

A later follow-up can add "Load Bundle" so a bug report can be reopened without
rerunning ONNX.

## Affected Areas

- `apps/cp-detect-architecture-inspector/src/App.tsx`
- `apps/cp-detect-architecture-inspector/src/api.ts`
- `apps/cp-detect-architecture-inspector/src/types.ts`
- `apps/cp-detect-architecture-inspector/src/styles.css`
- `apps/cp-detect-architecture-inspector/package.json`
- `apps/web/src/components/CpDetectImportModal.tsx`
- `apps/web/src/workers/cpDetectWorker.ts`
- `apps/web/src/lib/cpDetectInference.ts`
- `apps/web/src/engine/cpDetectTypes.ts`
- `apps/web/src/store/workspaceStore/cpDetectRuntime.ts`
- `crates/oristudio-cp-detect-inspector/src/main.rs`
- `crates/oristudio-cp-detect-wasm/src/lib.rs`
- likely a new shared browser module/package for CP-detect runtime helpers
- likely a reusable Rust inspector-stage module for the stage builders

## Checklist

- [x] Decide the shared browser module location and move production inference
      helpers without changing product behavior.
- [x] Refactor Rust inspector stage construction into reusable builders covered
      by the existing cached-sample routes.
- [x] Add a WASM wrapper that builds compact inspector stage payloads from dense
      outputs already held by the browser worker.
- [x] Add worker API for uploaded inspector runs: rectify, infer, build stages,
      return `InspectorRunBundle`.
- [x] Add Stage 0 raw dense payload types and UI.
- [x] Add `Samples | Upload` mode and upload/crop/run controls to the inspector.
- [x] Route the existing stage viewer through either server fetches or the
      in-memory uploaded bundle.
- [x] Make GT overlays, GT counts, and Stage 5b GT audit sections optional for
      uploaded runs.
- [x] Add candidate-only Stage 5b summaries for no-GT uploads.
- [x] Keep upload crop/edit UI available before model loading and show clear
      empty/missing-asset states.
- [x] Serve product model assets and cross-origin isolation headers from the
      production inspector server.
- [x] Generate the local clean-15 benchmark pack and browser dense cache for
      the production inspector.
- [ ] Add focused unit tests for refactored Rust stage builders.
- [ ] Add web tests with a mocked CP-detect client for upload mode state
      transitions and no-GT rendering.
- [x] Validate with `cargo test -p oristudio-cp-detect-inspector`,
      `wasm-pack test --node crates/oristudio-cp-detect-wasm`,
      `npm run build:cp-detect-inspector`, and the smallest product-web checks
      covering the shared runtime extraction.
