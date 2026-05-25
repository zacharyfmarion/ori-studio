# Browser Detection Roadmap V1

## Goal

Add a browser-only crease-pattern detection workflow to Ori Studio:

```text
uploaded image
  -> auto crop and rectify to a square CP
  -> optional manual crop adjustment
  -> CPLineNet-V2 ONNX inference in the browser
  -> Rust/WASM square topology decoding
  -> FOLD JSON
  -> oristudio-cp repair and diagnostics
  -> editable Ori Studio crease-pattern document
```

The first implementation target is local app testing in an Ori Studio worktree.
The model artifact is ignored by git, but it is a hard runtime requirement for
the feature. Local testing must place a real ONNX model and manifest under
`apps/web/public/models/cp-detector-v2/`; missing model assets should produce a
clear blocking error, not a mock or degraded fallback. A later release phase
will host the ONNX model and manifest as versioned downloadable assets.

## Architecture

- Use `onnxruntime-web` for the neural network runtime.
- Browser V1 uses the plain WASM ONNX Runtime backend for predictable local
  testing. WebGPU remains a later performance optimization once the packaged
  path is stable.
- Use Rust/WASM for deterministic post-processing: crop metadata, dense
  evidence conversion, square topology decoding, quality gates, FOLD export,
  and detector diagnostics.
- Keep the Python `create-pattern-detector` pipeline as an oracle while porting.
  Python is not part of the browser runtime.
- Integrate the final FOLD through existing `oristudio-cp-wasm` APIs so detected
  CPs immediately benefit from Oriedita-compatible import, fixes, checks, and
  editing.
- Keep the Tauri shell thin. Product logic belongs in shared web/runtime code
  and Rust crates.

## Phases

### Phase 0: Worktree and Roadmap

- [x] Create a dedicated Ori Studio worktree and branch:
  `codex/cp-detect-browser-v1`.
- [x] Add this roadmap under `implementation-plans/`.
- [x] Commit this roadmap before implementation begins.

Commit rule: each later phase must end with a focused commit before the next
phase starts.

### Phase 1: Oracle Fixtures and Package Skeleton

- [x] Add `crates/oristudio-cp-detect` for detector core logic.
- [x] Add `crates/oristudio-cp-detect-wasm` for the wasm-bindgen bridge.
- [x] Add workspace entries and web build scripts, following the existing
  `oristudio-cp-wasm` pattern.
- [x] Add a local-only model directory convention:
  `apps/web/public/models/cp-detector-v2/`.
- [x] Add scripts/docs to export or place:
  - `model.onnx`
  - `manifest.json`
  - optional checksum file
- [x] Generate a small oracle fixture set from the Python pipeline:
  - input image
  - rectified image
  - crop metadata
  - dense-output metadata or saved intermediate arrays where practical
  - decoded FOLD
  - quality report
- [x] Add tests that load oracle fixture metadata and verify the Rust package
  can parse expected inputs and output schemas.
- [x] Commit Phase 1.

### Phase 2: ONNX Worker Inference

- [x] Add `onnxruntime-web` to the web package.
- [x] Add a Comlink worker:
  `apps/web/src/workers/cpDetectWorker.ts`.
- [x] Load model URL and manifest URL from local app config with sensible dev
  defaults.
- [x] Match Python preprocessing exactly:
  - RGB image input
  - `1024 x 1024`
  - CHW float32 tensor
  - values normalized by `/ 255`
- [x] Return typed arrays for CPLineNet-V2 outputs:
  - `line_logits`
  - `angle`
  - `junction_logits`
  - `assignment_logits`
  - `non_crease_logits`
  - `line_style_logits`
  - `boundary_contact_logits`
  - `vertex_type_logits`
  - `boundary_side_logits`
  - `boundary_offset`
  - `boundary_coord`
- [x] Add worker tests with mocked ONNX output so web behavior does not require
  the large model artifact.
- [x] Commit Phase 2.

Phase 2 note: tests may mock tensor IO, but the product runtime requires a real
model manifest and ONNX file.

### Phase 3: Crop and Rectification V1

- [x] Port the Python square rectifier behavior needed for browser V1:
  - full-frame square preservation
  - axis-aligned/projection panel detection
  - density crop fallback
  - confidence and warning metadata
  - square warp to `1024 x 1024`
- [x] Add manual crop/quad override as a first-class API path.
- [x] Do not hallucinate unrecoverable missing borders. Low-confidence or
  incomplete source borders should produce explicit warnings.
- [x] Add preview outputs:
  - original image dimensions
  - detected quad
  - rectified image
  - rectification warnings
- [x] Add Rust and WASM tests for crop metadata, homography sanity, and manual
  override behavior.
- [x] Commit Phase 3.

### Phase 4: Square Topology Decoder Port

- [x] Port the detector-side evidence conversion:
  - sigmoid/softmax output conversion
  - assignment label raster
  - V2 auxiliary evidence maps
- [x] Port `SquareTopologyDecoder` behavior:
  - hard square boundary prior
  - carrier extraction
  - boundary-contact vertices
  - deterministic border-chain construction
  - interior edge support scoring
  - dashed/gapped support hook
  - non-crease suppression
- [x] Port assignment attribution, conservative repair, and quality report
  warnings needed by V2 compile gates.
- [x] Export minimal FOLD JSON plus detector metadata.
- [ ] Compare Rust/WASM outputs against Python oracle fixtures with explicit
  tolerances for floating-point differences.
- [x] Commit Phase 4.

Phase 4 note: V1 browser decoding ports the square-specific behavior needed for
manual app testing. It does not yet aim for bit-for-bit parity with the Python
OpenCV Hough implementation; explicit oracle comparison remains before release.
The exposed contracts and tests cover the hard square boundary, carrier edges,
assignments, and WASM FOLD export path.

### Phase 5: oristudio-cp Repair and Diagnostics

- [x] Load detector FOLD output through existing `oristudio-cp-wasm`.
- [x] If enabled by options, run:
  - `Fix1`
  - `Fix2`
- [x] Run diagnostics:
  - `Check1`
  - `Check2`
  - `Check3`
  - `Check4`
  - `CheckCamv`
- [x] Run `FlatFoldableCheck` against the detected square boundary when the
  existing command payload can represent the boundary loop.
- [x] Preserve detector warnings in the detector FOLD metadata and show them in
  the import review UI before import.
- [ ] Add a unified post-import result payload that keeps detector warnings and
  oristudio-cp diagnostics together after the modal closes.
- [ ] Verify the final document can be exported as `.fold` and `.cp`.
- [ ] Commit Phase 5.

Phase 5 note: the current import flow runs `loadCreasePatternText`, then
best-effort `Fix1`, `Fix2`, `Check1` through `Check4`, and
`FlatFoldableCheck`. `CheckCamv` is refreshed by the existing always-on CP
diagnostics path during load and after mutating fixes.

### Phase 6: Web UI

- [x] Add a menu or empty-state action: `Detect CP from Image`.
- [x] Add browser and Tauri-compatible image file open support for PNG/JPEG.
- [x] Add a compact staged import UI:
  1. Upload
  2. Crop
  3. Detect
  4. Review
  5. Import
- [x] On the crop step, show auto-detected quad handles and allow manual
  adjustment.
- [x] On the review step, default to a clean input/output view.
- [ ] Add opt-in detection overlays:
  - crop quad
  - line confidence
  - boundary contacts
  - detector warnings
  - oristudio-cp diagnostics
- [x] Import the final document into normal crease-pattern mode.
- [x] Add focused menu, file-service, capability, and inference tests.
- [ ] Add focused component tests for the import modal.
- [ ] Commit Phase 6.

Phase 6 note: local browser validation has exercised the real flow with the
ignored local model asset:

```text
clean-smoke.input.png
  -> browser file upload
  -> auto rectification
  -> ONNX WASM inference
  -> square topology decode
  -> Ori Studio CP import
  -> Fix1/Fix2/check commands
```

The smoke run imported as an editable crease-pattern document. It still
reported CAMV and flat-folder diagnostics, which is a detector/decoder quality
signal rather than a browser packaging failure.

### Phase 7: Release Packaging

- [ ] Decide final artifact hosting:
  - GitHub release asset
  - CDN-backed release asset
  - other static hosting
- [ ] Add model manifest fields:
  - detector version
  - model URL
  - model SHA-256
  - ONNX opset/runtime requirements
  - input image size
  - threshold defaults
  - output tensor names
- [ ] Add runtime checksum validation when feasible.
- [ ] Document how to refresh the browser model artifact from the
  `create-pattern-detector` checkpoint.
- [ ] Commit Phase 7.

## Public API Shape

The worker-facing API should stabilize around this shape:

```ts
type CpDetectCropMode = 'auto' | 'manual';

interface CpDetectOptions {
  threshold?: number;
  cropMode: CpDetectCropMode;
  manualQuad?: CpDetectQuad;
  applyOristudioFixes?: boolean;
  runDiagnostics?: boolean;
}

interface CpDetectResult {
  status: 'valid' | 'repaired' | 'ambiguous' | 'outside_supported_envelope' | 'failed';
  foldJson: string | null;
  rectification: CpDetectRectificationReport;
  detectorReport: CpDetectQualityReport;
  oristudioCpReport?: CpDetectOrieditaReport;
  previews: CpDetectPreviewAssets;
}
```

Defaults:

- `threshold`: detector manifest default, currently expected to be `0.65`.
- `applyOristudioFixes`: `true`.
- `runDiagnostics`: `true`.
- `cropMode`: `auto` for the first pass, with manual override available before
  rerunning detection.

## Affected Areas

- Rust workspace configuration and new detector crates.
- Web package dependencies and WASM build scripts.
- Web worker/runtime layer.
- Workspace store import flow.
- File service image-open support.
- Crease-pattern UI panels and diagnostics panel.
- Local model artifact docs/scripts.

## Validation Checklist

- [x] `cargo fmt --check`
- [x] `cargo test -p oristudio-cp-detect`
- [x] `cargo check -p oristudio-cp-detect-wasm`
- [x] `wasm-pack test --node crates/oristudio-cp-detect-wasm`
- [x] `cd apps/web && npx tsc --noEmit`
- [x] focused web tests:
  `npx vitest run src/lib/cpDetectInference.test.ts src/platform/fileService.test.ts src/commands/menuActions.test.ts src/lib/workspaceCapabilities.test.ts`
- [x] `npm --workspace @treemaker/web run build`
- [x] Automated browser smoke test:
  `clean-smoke.input.png` upload, rectification, detection, import.
- [ ] Manual browser test with at least:
  - clean synthetic CP image
  - text/watermark CP image
  - dark-mode CP image
  - arbitrary larger screenshot/photo requiring crop
  - low-confidence crop case

## Open Constraints

- The ONNX model is large and should not be committed during local iteration.
- The browser runtime should remain fully local after assets are downloaded.
- V1 does not retrain the detector.
- V1 does not invent geometry for unrecoverable cropped/missing borders.
- V1 can expose warnings for ambiguous assignment or flat-foldability instead
  of silently repairing beyond the available evidence.
