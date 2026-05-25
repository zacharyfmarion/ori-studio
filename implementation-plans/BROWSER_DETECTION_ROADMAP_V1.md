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
The model artifact can be ignored locally at first. A later release phase will
host the ONNX model and manifest as versioned downloadable assets.

## Architecture

- Use `onnxruntime-web` for the neural network runtime.
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

- [ ] Add `onnxruntime-web` to the web package.
- [ ] Add a Comlink worker:
  `apps/web/src/workers/cpDetectWorker.ts`.
- [ ] Load model URL and manifest URL from local app config with sensible dev
  defaults.
- [ ] Match Python preprocessing exactly:
  - RGB image input
  - `1024 x 1024`
  - CHW float32 tensor
  - values normalized by `/ 255`
- [ ] Return typed arrays for CPLineNet-V2 outputs:
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
- [ ] Add worker tests with mocked ONNX output so web behavior does not require
  the large model artifact.
- [ ] Commit Phase 2.

### Phase 3: Crop and Rectification V1

- [ ] Port the Python square rectifier behavior needed for browser V1:
  - border quad detection
  - density crop fallback
  - confidence and warning metadata
  - square warp to `1024 x 1024`
- [ ] Add manual crop/quad override as a first-class API path.
- [ ] Do not hallucinate unrecoverable missing borders. Low-confidence or
  incomplete source borders should produce explicit warnings.
- [ ] Add preview outputs:
  - original image dimensions
  - detected quad
  - rectified image
  - rectification warnings
- [ ] Add Rust and WASM tests for crop metadata, homography sanity, and manual
  override behavior.
- [ ] Commit Phase 3.

### Phase 4: Square Topology Decoder Port

- [ ] Port the detector-side evidence conversion:
  - sigmoid/softmax output conversion
  - assignment label raster
  - V2 auxiliary evidence maps
- [ ] Port `SquareTopologyDecoder` behavior:
  - hard square boundary prior
  - carrier extraction
  - boundary-contact vertices
  - deterministic border-chain construction
  - interior edge support scoring
  - dashed/gapped support hook
  - non-crease suppression
- [ ] Port assignment attribution, conservative repair, and quality report
  warnings needed by V2 compile gates.
- [ ] Export minimal FOLD JSON plus detector metadata.
- [ ] Compare Rust/WASM outputs against Python oracle fixtures with explicit
  tolerances for floating-point differences.
- [ ] Commit Phase 4.

### Phase 5: oristudio-cp Repair and Diagnostics

- [ ] Load detector FOLD output through existing `oristudio-cp-wasm`.
- [ ] If enabled by options, run:
  - `Fix1`
  - `Fix2`
- [ ] Run diagnostics:
  - `Check1`
  - `Check2`
  - `Check3`
  - `Check4`
  - `CheckCamv`
- [ ] Run `FlatFoldableCheck` against the detected square boundary when the
  existing command payload can represent the boundary loop.
- [ ] Preserve detector warnings and oristudio-cp diagnostics together in the
  result payload.
- [ ] Verify the final document can be exported as `.fold` and `.cp`.
- [ ] Commit Phase 5.

### Phase 6: Web UI

- [ ] Add a menu or empty-state action: `Detect CP from Image`.
- [ ] Add browser and Tauri-compatible image file open support for PNG/JPEG.
- [ ] Add a compact staged import UI:
  1. Upload
  2. Crop
  3. Detect
  4. Review
  5. Import
- [ ] On the crop step, show auto-detected quad handles and allow manual
  adjustment.
- [ ] On the review step, default to a clean input/output view. Make overlays
  opt-in:
  - crop quad
  - line confidence
  - boundary contacts
  - detector warnings
  - oristudio-cp diagnostics
- [ ] Import the final document into normal crease-pattern mode.
- [ ] Add focused component and store tests.
- [ ] Commit Phase 6.

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

- [ ] `cargo fmt --check`
- [ ] `cargo test -p oristudio-cp-detect`
- [ ] `wasm-pack test --node crates/oristudio-cp-detect-wasm`
- [ ] `npm run typecheck:web`
- [ ] `npm run test:web`
- [ ] `npm run build:web`
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
