# CP Detect V3 Crop Inspector Stage

## Goal

Add a dedicated CP detector stage-inspector view for the V3 vertex-refiner crop pass.

The inspector should let us upload or run a crease-pattern image, view the exact crop squares used by the V3 junction refiner, click any crop, and inspect:

- the crop geometry in paper/image coordinates;
- the crop-local input signals the model actually sees;
- the crop-local model output heads;
- raw prediction vertices produced by that crop;
- merged/global vertices that survived deduplication;
- the relationship between raw crop predictions and merged vertices.

This stage is for debugging product integration and model failure modes. It should make it obvious whether a miss is caused by proposal coverage, crop framing, model output, boundary handling, or merge/post-processing.

## Approach

### Stage Shape

Add a new upload-mode stage, tentatively named `Stage 0b: V3 crop refiner`, between current raw dense outputs and graph construction.

The existing `Stage 0: raw dense outputs` should continue to show global dense maps and high-level V3 overlays. The new crop stage should focus on one V3 crop at a time while still showing all crop squares on the global CP image.

The first implementation target is uploaded images, because the browser upload flow already runs the V3 refiner locally and has access to image tensors, crop tensors, model outputs, raw vertices, and merged vertices. Cached/server-backed examples can be added after the upload path proves useful.

### Data Flow

Do not serialize every crop tensor and every output tensor into the stage bundle. That would be unnecessarily large:

- up to roughly 256 crops;
- 96x96 pixels per crop;
- 11 input channels;
- multiple dense model output heads.

Instead, keep a compact summary in the returned inspector bundle and keep the heavy tensors in the upload worker, keyed by a run id. The React UI should request details lazily when the user selects a crop.

The upload bundle should include:

- `run_id`;
- V3 manifest id;
- crop size;
- proposal centers and provenance;
- raw prediction vertex summaries;
- merged vertex summaries;
- raw-to-merged membership/debug mapping;
- counts and runtime;
- enough metadata to render crop boxes immediately.

The worker-side crop detail endpoint should return, for one selected crop:

- crop box global bounds;
- crop center and proposal provenance;
- input-channel image maps;
- output-head image maps;
- raw vertices decoded from that crop;
- merged vertices supported by that crop;
- raw-to-merged cluster ids;
- per-vertex local and global coordinates.

### Crop Signals To Show

Show the signals the V3 model actually receives, not speculative preprocessing.

Input maps:

- source grayscale;
- source ink probability;
- source distance-to-ink;
- source orientation `cos(2theta)`;
- source orientation `sin(2theta)`;
- signed distance to frame;
- frame edge mask;
- inside-paper mask;
- boundary-contact prior;
- crop x-coordinate channel;
- crop y-coordinate channel.

Output maps:

- vertex heatmap;
- boundary-contact heatmap;
- offset `dx`;
- offset `dy`;
- offset magnitude;
- vertex-kind class view, with a selector for class score;
- degree class view, with a selector for class score;
- boundary-side class view, with a selector for class score;
- incident-ray output summarized as 36 bins, with optional per-bin map view.

The first pass can render the class heads as selected-channel heatmaps plus a small class-score table at selected raw vertices. It does not need to show all class channels at once.

### Crop Selection UX

The crop stage should have three working areas:

- global CP view;
- selected-crop signal viewer;
- selected-crop vertex/debug panel.

Global CP view:

- draw the rectified/canonical CP image;
- overlay every V3 crop square as a thin line;
- highlight the selected crop;
- show raw and merged vertices with toggleable layers;
- clicking inside a crop selects it;
- if multiple crops overlap, choose the crop whose center is nearest the click;
- if no crop contains the click, choose the nearest crop center within a small tolerance.

Selected-crop signal viewer:

- show the source crop and each input/output map in a grid;
- keep pixel alignment exact so local vertex coordinates can be overlaid;
- allow toggling raw prediction vertices and merged vertices on top of any map;
- use small dots/crosses that do not obscure the vertex itself.

Vertex/debug panel:

- show crop index, center, provenance, boundary/interior proposal type, and crop bounds;
- list raw predictions from this crop with score, kind, degree, boundary side, ray bins, local coordinates, and global coordinates;
- list merged vertices supported by this crop;
- show cluster membership so duplicate/overlap behavior is understandable.

### Merge Debugging

The current raw and merged vertex lists are not enough to explain why duplicates survived or why predictions disappeared. Add explicit merge-debug data.

The V3 merge implementation should expose:

- stable raw prediction ids;
- stable merged vertex ids;
- `raw_to_merged` mapping;
- cluster members for each merged vertex;
- merge reason or threshold class where practical;
- whether each raw prediction was suppressed, merged, or retained.

This is important because the inspector should support the product-level goal:

> If an individual junction is correctly detected in every crop that sees it, the CP-level merged vertex should be correct exactly once.

### Stage Integration

Update the architecture inspector types and UI to include `stage0b`.

Expected affected code:

- `apps/cp-detect-architecture-inspector/src/types.ts`
- `apps/cp-detect-architecture-inspector/src/App.tsx`
- `apps/cp-detect-architecture-inspector/src/api.ts`
- `apps/cp-detect-architecture-inspector/src/uploadWorker.ts`
- `apps/cp-detect-architecture-inspector/src/uploadRuntime.ts`
- `apps/cp-detect-architecture-inspector/src/styles.css`
- `apps/web/src/lib/vertexRefinerPipeline.ts`
- `apps/web/src/lib/vertexRefinerInference.ts`
- `apps/web/src/workers/cpDetectWorker.ts`
- `apps/web/src/engine/cpDetectTypes.ts`

The Rust inspector stage builder can remain focused on compact stage JSON unless it is simpler to add a placeholder stage entry there. The browser worker should own crop tensor retention and lazy crop-detail extraction because those tensors already live in browser-side V3 inference.

### Performance Constraints

- Do not eagerly ship all crop maps to the UI.
- Keep only one selected crop detail payload in React state at a time.
- Cache a small number of recently selected crop details if navigation feels slow.
- Release worker-side debug tensors when a new upload run starts or the worker is disposed.
- Keep crop map payloads 96x96 unless the model crop size changes.

### Validation

Use a small, deterministic validation loop:

- upload a known clean CP;
- confirm the stage appears when V3 is enabled;
- confirm clicking global crop squares selects the expected crop;
- confirm crop-local maps align with the source crop;
- confirm raw vertices from a selected crop line up on crop maps;
- confirm merged vertices on the global view match the product output;
- confirm boundary crops are centered on the paper-frame line, not the image border;
- confirm turning V3 off hides or disables the crop stage clearly.

Automated checks:

- unit tests for crop hit-testing;
- unit tests for crop-detail map extraction shape/range;
- unit tests for raw-to-merged mapping;
- typecheck/build for the architecture inspector;
- existing CP detector product tests touched by V3 type changes.

## Affected Areas

- Architecture inspector upload flow and stage navigation.
- V3 vertex-refiner browser pipeline debug return shape.
- Worker-side inference/debug cache.
- Crop-map visualization components and styling.
- Vertex merge debug metadata.
- Product-side CP detector types shared with the inspector.

## Checklist

- [x] Phase 1: Define the `stage0b` data contract.
- [x] Phase 1: Add run id and compact V3 crop summary to upload inspector bundles.
- [x] Phase 1: Add explicit raw-to-merged debug ids and cluster membership to V3 merge output.
- [x] Phase 2: Extend the V3 pipeline with an opt-in debug mode that retains source features, crop tensors, output tensors, proposals, raw vertices, and merged vertices in worker memory.
- [x] Phase 2: Add a lazy worker API for `getVertexRefinerCropDebug(runId, cropIndex)`.
- [x] Phase 2: Convert selected crop tensors into compact `MapPayload`-style heatmaps.
- [x] Phase 3: Add the `Stage 0b: V3 crop refiner` option to the architecture inspector stage selector.
- [x] Phase 3: Build the global crop overlay view with click selection and selected-crop highlighting.
- [x] Phase 3: Add layer toggles for crop squares, raw vertices, merged vertices, and boundary/frame overlays.
- [x] Phase 4: Build selected-crop input signal grid.
- [x] Phase 4: Build selected-crop output-head grid.
- [x] Phase 4: Add vertex overlays to crop maps without obscuring small failures.
- [x] Phase 5: Build selected-crop metadata, raw vertex, merged vertex, and cluster-membership panels.
- [x] Phase 5: Add vertex hover/selection linking between tables, crop maps, and global view.
- [x] Phase 6: Add focused merge-debug unit coverage and validate crop-detail contracts through the inspector build.
- [x] Phase 6: Validate the inspector dev server starts and serves the app.
- [x] Phase 7: Defer cached/server-backed crop debug packs until the upload workflow proves insufficient.
- [x] Stability follow-up: Serialize worker-local ONNX session creation and `session.run` calls so dense WebGPU inference and V3 WebGPU inference cannot compile or dispatch concurrently during uploaded-image runs.
- [x] UX follow-up: Make V3 crop rectangles clickable across their full square area, not only on the crop center or stroke.
- [x] Proposal-layout experiment: Tested using the interior stride for boundary proposals instead of half-stride boundary oversampling; clean-15 metrics regressed slightly, so the product layout was reverted to the prior denser boundary coverage.
