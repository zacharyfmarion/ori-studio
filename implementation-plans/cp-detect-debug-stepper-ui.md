# CP Detect Debug Stepper UI Plan

## Goal

Add an optional debug mode to the existing "Detect CP from Image" upload modal
so a developer can upload a crease-pattern image, crop/rectify it, run the same
browser model and compiler pipeline used by the product, and inspect each stage
visually.

The debug UI should answer:

```text
What did this step receive?
What did it emit?
Why did it make that decision?
What changed from the previous step?
Which stage introduced the visible error?
```

This is a developer/debugging surface, not the default user flow. The ordinary
upload -> crop -> detect -> import path should remain clean.

## Existing Shape

Current relevant files:

```text
apps/web/src/components/CpDetectImportModal.tsx
apps/web/src/components/CpDetectImportModal.css
apps/web/src/workers/cpDetectWorker.ts
apps/web/src/engine/cpDetectTypes.ts
crates/oristudio-cp-detect-wasm/src/lib.rs
crates/oristudio-cp-detect/src/decode.rs
crates/oristudio-cp-compiler/src/border.rs
```

Existing worker capabilities:

```text
autoRectifyImage(image)
manualRectifyImage(image, quad)
runDenseInference(rectifiedImage)
detectRectifiedFold(rectifiedImage)
ablateRectifiedFold(rectifiedImage)
```

`ablateRectifiedFold` already gives the right first hook for compiler stage
comparison, but the debug UI needs richer intermediate artifacts than FOLD-only
ablation stages.

## Non-Negotiables

- Debug output must use the real browser pipeline: browser image decode,
  WASM rectifier, ONNX Runtime Web inference, WASM/Rust decoder/compiler.
- Do not use mocks or Python-only diagnostics in the app UI.
- The model is required. No fake fallback state.
- Normal detection remains the default. Debug mode is opt-in.
- Debug artifacts must be generated from the same rectified image and dense
  logits as final detection.
- Avoid stale or duplicated conceptual docs. This file is the product/UI plan;
  `constraint-aware-cp-compiler.md` remains the compiler architecture plan.
- Do not store huge logits in React state. Keep dense tensors inside the worker
  and return compact raster/overlay/debug summaries.
- Keep visual rendering pleasant: anti-aliased thin lines, stable aspect ratios,
  predictable pan/zoom, and no text overlays obscuring the CP.

## UI Overview

Add a debug toggle in the modal after a source image is loaded:

```text
[ Crop ] [ Review ] [ Debug ]
```

Suggested layout for `Debug`:

```text
┌───────────────────────────────────────────────────────────────┐
│ Detect CP from Image                                [close]    │
├──────────────┬───────────────────────────────┬────────────────┤
│ Stepper      │ Visual canvas                 │ Inspector      │
│              │                               │                │
│ 1 Source     │ CP image / graph / heatmap    │ Summary        │
│ 2 Crop       │ with overlay toggles          │ Metrics        │
│ 3 Model      │                               │ Warnings       │
│ 4 Evidence   │                               │ Raw details    │
│ 5 Legacy     │                               │                │
│ 6 Compiler   │                               │                │
│ 7 Export     │                               │                │
└──────────────┴───────────────────────────────┴────────────────┘
```

Controls:

- Stepper list on the left with status icons and counts.
- Main visual pane with pan/zoom, fit, and 1:1 controls.
- Overlay toolbar above visual pane:
  - source image
  - rectified image
  - line probability
  - junctions
  - boundary contacts
  - carriers
  - vertices
  - selected edges
  - rejected/weak edges
  - border
  - M/V assignments
  - diff from previous stage
- Inspector on the right:
  - step explanation
  - input/output counts
  - warnings/repair actions
  - compiler report snippet
  - timing
  - copy/export debug JSON button

## Step Model

Use stable step ids so screenshots, bug reports, and benchmark artifacts can
refer to the same stage names.

### 1. Source Image

Purpose:

Show the original upload and basic image metadata.

Visuals:

- Original bitmap.
- Optional detected crop quad overlay.

Inspector:

- filename
- source dimensions
- decoded MIME/type when known

### 2. Crop / Rectification

Purpose:

Show how the arbitrary image became the square model input.

Visuals:

- source image with editable crop quad
- rectified 1024x1024 image
- crop confidence and warnings

Inspector:

- source quad
- target size
- rectifier mode: auto/manual
- warning list

### 3. Model Input

Purpose:

Make clear what the neural network actually saw.

Visuals:

- exact tensor input image after rectification/preprocessing
- optional RGB channel preview if useful later

Inspector:

- model manifest id
- image size
- threshold
- backend/runtime

### 4. Model Evidence Heads

Purpose:

Expose the raw visual evidence before graph decoding.

Visuals:

- line probability heatmap
- effective line probability heatmap
- non-crease heatmap
- junction heatmap
- boundary-contact heatmap
- assignment argmax map
- line-style argmax map

Inspector:

- output tensor names/dims
- threshold used
- foreground pixel count
- warnings if any tensor is missing/unexpected

Implementation note:

The worker should render heatmaps in the worker or WASM and return compact
`ImageBitmap`-compatible data or PNG/object URLs. Do not transfer every dense
tensor back to React for every UI interaction.

### 5. Legacy Decode / Seed Graph

Purpose:

Show the graph produced by the legacy threshold/vectorization path, which is
currently also the compiler seed.

Substeps:

```text
5a binary/effective mask
5b Hough carriers
5c junction/boundary vertices
5d interior edges
5e legacy deterministic border
5f planar cleanup / final legacy graph
```

Visuals:

- carriers as faint infinite/long lines
- selected finite edges as M/V/B colored segments
- vertices as small anti-aliased points
- boundary contacts highlighted
- optional edge support coloring

Inspector:

- carrier count
- vertex count
- edge count
- border edge count
- repair actions
- decode warnings

Required backend work:

The Rust/WASM API needs a debug decode function that serializes existing stage
snapshots from `oristudio-cp-detect`. Some of these types already exist in Rust
(`DecodeStageSnapshot`, `DecodeVertexStageSnapshot`, `DecodeEdgeStageSnapshot`,
etc.); expose them through a debug-only worker method rather than re-deriving
them in TypeScript.

### 6. Compiler Stages

Purpose:

Show how the constraint-aware compiler transforms the seed graph.

Initial stages:

```text
candidate_seed
locked_border
exactized_seed
locked_border_exactized
topology_current        opt-in slow stage
topology_locked_border  opt-in slow stage
assignment stages       opt-in slow stage
```

Important current interpretation:

- `candidate_seed` should match legacy on current smoke data.
- `locked_border` should match legacy when legacy already emitted a clean border
  cycle.
- exactization currently regresses metrics, so this UI should make vertex
  motion and edge changes highly visible.
- topology and assignment stages can be slow and should be run only when the
  user asks for slow compiler diagnostics.

Visuals:

- graph for the selected compiler stage
- diff from previous stage:
  - added edges
  - removed/rejected edges
  - moved vertices
  - assignment flips
  - border changes
- constraint diagnostics as selectable markers

Inspector:

- compiler summary
- border report
- exactization report
- topology accepted/rejected moves
- assignment decisions if run
- verification classifications

### 7. FOLD Export / Import Preview

Purpose:

Show exactly what would be imported into Ori Studio.

Visuals:

- final exported FOLD graph
- optional side-by-side with current Ori Studio rendering after import

Inspector:

- FOLD vertex/edge counts
- decoder backend
- final warnings
- import repair commands run after import
- CAMV/check/flat-folder result, when available

## Data Contract

Add a debug worker API:

```ts
debugDetectRectifiedFold(
  image: ImageData,
  options: CpDetectDebugRunOptions
): Promise<CpDetectDebugRun>
```

Suggested TypeScript shape:

```ts
interface CpDetectDebugRunOptions extends CpDetectWorkerRunOptions {
  includeDenseHeadPreviews?: boolean;
  includeLegacySnapshots?: boolean;
  includeCompilerAblation?: boolean;
  includeSlowCompilerStages?: boolean;
}

interface CpDetectDebugRun {
  schema: 'oristudio/cp-detect-debug-run/v1';
  manifest: CpDetectModelManifest;
  imageSize: number;
  threshold: number;
  finalDetection: CpDetectFoldResult;
  steps: CpDetectDebugStep[];
  timings: CpDetectDebugTiming[];
}

interface CpDetectDebugStep {
  id: string;
  title: string;
  group: 'source' | 'rectifier' | 'model' | 'legacy' | 'compiler' | 'export';
  explanation: string;
  status: 'ok' | 'warning' | 'failed' | 'skipped';
  artifacts: CpDetectDebugArtifact[];
  summary: Record<string, unknown>;
  warnings?: CpDetectDecodeWarning[];
  report?: unknown;
}

interface CpDetectDebugArtifact {
  id: string;
  label: string;
  kind: 'image' | 'heatmap' | 'fold' | 'graph' | 'diff' | 'json';
  payload: unknown;
}
```

Graph artifact shape:

```ts
interface CpDetectDebugGraph {
  vertices: [number, number][];
  edges: [number, number][];
  assignments: string[];
  edgeSupport?: number[];
  edgeSource?: string[];
  edgeProvenance?: string[][];
  vertexSource?: string[];
}
```

Diff artifact shape:

```ts
interface CpDetectDebugGraphDiff {
  baseStageId: string;
  compareStageId: string;
  addedEdges: number[];
  removedEdges: number[];
  changedAssignments: number[];
  movedVertices: Array<{
    vertex: number;
    from: [number, number];
    to: [number, number];
    distancePx: number;
  }>;
}
```

## Rendering

Build reusable debug render components rather than stuffing more logic into
`CpDetectImportModal.tsx`:

```text
apps/web/src/components/cp-detect-debug/
  CpDetectDebugPanel.tsx
  CpDetectDebugStepper.tsx
  CpDetectDebugCanvas.tsx
  CpDetectDebugInspector.tsx
  cpDetectDebugRender.ts
```

Rendering requirements:

- Use SVG for graph overlays so edges remain sharp.
- Use canvas only for raster images/heatmaps.
- Keep graph stroke widths viewport-aware but not chunky.
- Use the same assignment colors as the existing FOLD preview.
- Use a distinct diff palette:
  - added: purple
  - removed: amber/orange
  - changed assignment: cyan highlight
  - moved vertex: small vector arrow
- Provide hover hit targets for edges/vertices without visually thickening the
  actual line.
- Show tooltips with edge id, assignment, support, source, and provenance.

## Performance Plan

Default debug run:

```text
rectification artifacts
model head previews
legacy snapshots
candidate_seed
locked_border
exactized_seed
locked_border_exactized
final detection
```

Slow stages require explicit user action:

```text
[Run topology diagnostics]
[Run assignment diagnostics]
```

Why:

The current native benchmark showed topology replay can take about `51s` for a
single dense Rabbit Ear sample even with assignment solving skipped. The UI
must not surprise the user with that cost.

## Implementation Phases

### Phase 1: Debug Data API

Add TypeScript types and worker method for a debug run.

Rust/WASM work:

- expose compact debug snapshots from decode/compiler
- include existing ablation stages
- add heatmap preview generation or compact heatmap arrays
- include per-stage timing

Acceptance:

- Unit tests for debug payload schema.
- Worker can run a debug pass on a rectified image.
- Normal `detectRectifiedFold` behavior unchanged.

### Phase 2: Debug Panel Shell

Add a `Debug` tab/segmented control inside `CpDetectImportModal`.

Acceptance:

- User can upload image, adjust crop, run detection, and switch to Debug.
- Empty/debug loading states are clear.
- Debug mode does not clutter normal flow.

### Phase 3: Stepper + Inspector

Render the step list and metadata inspector.

Acceptance:

- Every step has a short explanation.
- Counts/warnings/reports are visible.
- Slow stages are shown as skipped until explicitly run.

### Phase 4: Visual Artifacts

Render raster images, heatmaps, graph overlays, and FOLD previews.

Acceptance:

- Source, rectified, line heatmap, junction heatmap, legacy graph, and compiler
  stages are inspectable.
- Lines are anti-aliased and visually comparable to the nicer input rendering.
- Pan/zoom/fit work consistently.

### Phase 5: Diff Views

Add graph diffs between adjacent stages and arbitrary selected stages.

Acceptance:

- User can compare `legacy -> locked_border`.
- User can compare `locked_border -> exactized_seed`.
- Vertex motion is visible with distance in pixels.
- Edge additions/removals are stable under small endpoint tolerance.

### Phase 6: Slow Diagnostics

Add explicit buttons for topology and assignment diagnostics.

Acceptance:

- Slow stages do not run by default.
- UI shows a clear progress state and cancellation note.
- Stage timings are recorded.

### Phase 7: Import Verification Hooks

After import, optionally display Ori Studio repair/CAMV/check/flat-folder
results in the debug panel.

Acceptance:

- The imported final graph can be compared with pre-import FOLD export.
- CAMV/check failures are linked back to graph vertices/edges when possible.

## Testing

Unit tests:

- Type/schema helpers for debug payloads.
- Graph diff matching with endpoint tolerance.
- Heatmap color mapping.
- Step id ordering.

Worker/browser tests:

- Debug worker method returns required steps for a smoke image.
- Slow stages are skipped by default.
- Normal detection/import remains unchanged.

Manual tests:

- `simple.osf` / screenshot-style examples.
- A clean synthetic CP.
- A dashed CP.
- A watermark/text CP.
- A CP where exactization visibly moves vertices.
- The known CPOogle duck example.

Benchmark loop:

- Use existing dense-cache/native ablation artifacts to validate stage metrics.
- Confirm browser debug artifacts agree with cached native stage ids/counts on a
  small pack before trusting the UI.

## Open Decisions

- Whether heatmaps should be returned as raw small arrays or pre-rendered image
  payloads from the worker.
- Whether debug mode should be behind a visible toggle, a dev setting, or a
  query param.
- How much CAMV/check/flat-folder data can be mapped back to source graph ids.
- Whether topology diagnostics need cancellation support or only a warning.

