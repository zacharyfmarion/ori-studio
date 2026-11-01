# Shared live spread rendering and Fold picking performance

## Goal

Make Default spread responsive in the Fold workspace by removing repeated picking preparation and sharing the worker-backed live paper renderer with Diagram Pose. Preserve the accepted geometry, global layer ordering, line visibility and editing behavior.

**Keep the existing line-width difference:** Fold uses screen-sized pens; Diagram Pose uses picture/page scaling. Preserve each surface's paper style, zoom, framing and camera controls. This is a performance and ownership refactor, not a new rendering policy or solver change.

Status: implemented and validated; remaining performance limits are recorded below. Geometry, the solver and global layer ordering are unchanged. Fold and Diagram retain their own line-width policies.

## Approach

### Evidence collected before implementation

Baseline revision: `79d48da5cced17489149df535b5dd22c7e49cc09`, 2026-10-31.

The profile uses Bodo steps 147, 168 and 204 from the supplied external book, plus Cpoogle Horse and Ant. Their already ordered CP paper scenes were imported through the real Fold engine's `importEditFoldedFigure` entry point, then queried for the actual Fold scene and landmarks. Source preparation and the height solve ran once before the interaction measurements. These are Fold-engine scenes, not the Diagram scenes relabeled as Fold inputs.

The browser harness invokes the same synchronous pipeline as `useFoldPaneSpread`, `useFoldCanvasPaint` and `FoldPane`: spread map → complete picking index → paper scene → stroke/fill geometry → GPU buffer upload → draw submission. It uses the production functions and spread drawing program, a fixed 800 × 600 drawing buffer, and Fold's existing pixel-per-point rule. Hardware: Apple M1 Max; in-app Chromium 155, ten reported logical processors. Display DPR is 2, but this controlled drawing buffer uses DPR 1. Three warmups precede 20 changing-reveal samples per model. The initial frame is recorded separately. Picking substage timings use a generated copy with timers at block boundaries, checked against the production source hash; no product source is instrumented.

Warm medians, milliseconds:

| Model | Faces | Complete update | Picking | Unchanged CP portion¹ | Spread map + paper scene | Geometry | Upload | Draw submission |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bodo 147 | 785 | 137.2 | 116.4 | 100.4 | 3.8 | 7.6 | 7.0 | 2.6 |
| Bodo 168 | 820 | 149.2 | 128.0 | 108.7 | 3.6 | 6.6 | 7.8 | 3.2 |
| Bodo 204 | 940 | 193.6 | 167.0 | 141.5 | 6.9 | 7.6 | 8.4 | 3.2 |
| Horse | 272 | 22.3 | 13.6 | 10.9 | 1.3 | 2.0 | 3.0 | 2.4 |
| Ant | 208 | 15.9 | 8.8 | 6.0 | 1.3 | 1.5 | 2.5 | 1.9 |

¹ The unchanged-CP breakdown is a separate eight-sample timing run, not an extra cost to add to Picking. Column medians need not sum to the median of the total. Bodo complete-update p95s were 147.2, 161.5 and 208.9 ms.

Findings:

- Picking consumes about 85–86% of the measured Bodo update. `useFoldPaneSpread` calls `foldPickIndex` whenever the map changes, rebuilding **both** panes.
- The CP rebuild calls `sheetToScene` twice per crease. `sheetFaceAt` repeatedly constructs face outlines and scans them using `insideConvex`. Bodo 204 has 1,757 creases and 940 faces. These associations are independent of spread.
- A separate Node/V8 sampled CPU profile of 30 warmed Bodo-204 picking rebuilds attributes 4.77 s of 5.62 s inside `foldPickIndex` to `sheetFaceAt` and its callees, about 85%. This corroborates the browser stage timing; Node sampling is not a browser frame-rate measurement.
- Folded-pane target construction still costs approximately 15–21 ms in the browser breakdown. It searches sheet faces and calls `faceWeights`, which scans the triangle table to find the owning face's triangle. Those material associations and barycentric weights also remain unchanged during reveal/amount gestures.
- The duplicate spread-map projection itself costs only about 1–3 ms. Sharing it is useful for consistency, but it is not the primary cause of the lag.
- Geometry preparation, buffer updates and draw submission remain roughly another 20–27 ms on Bodo. Moving only the drawing into a worker would leave the dominant picking stall on the main thread.
- Height solving is absent from this warm loop. This work does not call for a different optimizer, smaller crossing penalty or approximate geometry.

A local counterfactual removes only the CP rebuild and reuses its previous index. The full-pipeline experiment reduces Bodo median updates to roughly 49, 50 and 64 ms; remaining picking costs roughly 21, 23 and 29 ms. Serialized index data matches the original at the checked poses. This is evidence for the cache boundary, **not a shipped optimization or a complete equivalence proof**. Separate alternating baseline/cached runs also check changing amounts and reveal directions. That picking-only harness measured substantially slower original rebuilds (362–520 ms) versus 18–26 ms cached; repeating with equivalence serialization outside the loop reproduced the difference. The reason for the absolute timing difference between harnesses is not established. Both isolate the same removable CP work; do not convert their ratios into an end-to-end frame-rate claim. Reconcile absolute timings against the full-workspace trace before implementation acceptance.

Limits of this profile:

- In-app Chromium on this Mac, not a full React/store/thumbnail trace or a Canary/Tauri acceptance run. CPU timings include draw submission, not GPU/compositor completion or input-to-visible-frame latency.
- The externally imported states preserve the supplied layer order; this is not a measurement of the user's exact selected Rotate card and viewport.
- Lotus was attempted but the current Fold import rejected its sheet with `import_shape_unsupported`; it is excluded, not counted as a fast result. This is five usable cases, not an all-Cpoogle benchmark.
- Cold import, scene/landmark queries, source preparation and solving are recorded separately in the local manifest. They are excluded from the warm table. Prior Pose startup measurements are in `pose-startup-readiness.md` and are not Fold interaction timings.

Local evidence, all under ignored `artifacts/fold-spread-profile/`:

- `prepare.mjs`, `manifest.json`, per-model scene/landmark/prepared inputs.
- `index.html`, `profile.ts`, `baseline.json`, `cached-cp.json`: full production pipeline and CP-cache experiment.
- `make-probe.mjs`, `source-hash.json`, generated picking probes: timing instrumentation and isolated cache experiment.
- `paired.html`, `paired.ts`, `paired.json`, `paired-outside-checks.json`: alternating original/cached picking calls over varied amounts/directions, including a repeat with equivalence serialization outside the measured loop.
- `cpu.mjs`, `bodo-204-picking.cpuprofile`, `cpu-summary.json`: sampled CPU attribution.

Reproduction in this checkout: run `node artifacts/fold-spread-profile/prepare.mjs` and `node artifacts/fold-spread-profile/make-probe.mjs`, open the local `index.html` through Vite's `@fs` URL and click Profile Fold spread. The prepared input script consumes the earlier ignored `artifacts/global-spread-perf/` scene captures of the external corpus. Run `cpu.mjs` separately, never concurrently with browser timings. No private OSF/CP/model data or generated WASM goes into git.

### 1. Separate static picking preparation from a displayed spread

Implement this first because the profile identifies it as the largest cost.

- Introduce a Fold-owned immutable prepared picking model keyed by **scene, landmarks and mark data**, not spread, camera or style. It holds the existing CP index, subfaces, transforms and source/provenance descriptors. Reuse the CP index by identity across all spread updates.
- Precompute each folded target's material binding once: owning face, triangle IDs and barycentric weights. Preserve the current face tie-break, landmark priority, duplicate-target handling, segment endpoint correspondence, visible intervals and crease-mark provenance. Do not introduce a different visibility or snapping policy.
- Keep sheet-space associations separate from projected coordinates. A spread update interpolates bound targets from the displayed vertices and rebuilds only the folded spatial lookup. The CP lookup and sheet-to-face searches never run on this path.
- Perform the expensive initial association work in a **Fold-owned preparation worker**, using plain serializable descriptors. Keep this outside the numerical solver and outside React render. The main thread may construct cheap lookup wrappers from the result; measure that materialization separately. Do not structured-clone class instances and assume their methods survived.
- Avoid calculating the base index and the spread index independently during startup. One preparation supplies both. The non-spread and legacy Affine/Depth paths reuse the same static CP data; keep their existing projection behavior.
- Hold preparation by model lifetime, release on replacement/unmount, and discard stale generations. Avoid a new unbounded cache across every step. Current-model references and existing model ownership should bound retention.

### 2. Generalize the existing worker renderer behind host adapters

Use `layer-spread/render.worker.ts` and `useSpreadRenderer` as the starting point, not a parallel Fold renderer.

- Extract a common live-render controller/protocol that owns the worker, one in-flight frame, one replaceable pending request, resource disposal, context failure and timeout handling. Model/source changes have a generation; requested and completed frames have monotonically increasing IDs. Superseded frames never queue up or become visible after navigation.
- Separate **geometry parameters** (prepared source, spread, placement, presentation, visible ink/style) from **viewport parameters** (camera transform, dimensions, DPR, stroke pixel scale). Pan/zoom/resize reuse uploaded geometry. Model, amount/reveal and relevant style changes invalidate only their own dependencies.
- Add a Fold adapter for its y-up scene, display offset, viewport camera, precrease display and per-face ink overrides. Keep Fold tools and document/store bindings in Fold modules. The shared renderer should consume serializable geometry/ink/frame descriptions, not import Fold stores or panels.
- Keep the Diagram adapter's existing `spreadFrame`, perspective camera, side handling and idle vector capture. The vector capture/Pages path remains separate from the live renderer and keeps the current global visibility policy.
- Preserve widths explicitly: Fold passes `ptToDevicePx(1, ratio)`; Diagram passes its current picture-scaled `frame.scale / pagePtPerPx(...)`. Neither adapter silently adopts the other's scaling, default paper style, fit behavior or camera controls.
- Projection should produce the paper drawing and the vertex positions needed for picking once. Return a compact position buffer for a **new geometry revision**, not on every camera-only frame. Retain double precision where required for picking equivalence; benchmark transfer/materialization costs rather than assuming they are free.

### 3. Compose worker paper with Fold interaction and keep them synchronized

- Keep `useCpSurface` as Fold's camera/input owner and keep the existing tool/hover/selection/annotation overlays. Put the worker's paper bitmap in a dedicated presentation layer beneath the tool overlays; retain the CP pane's renderer. The overlay surface must support transparent clearing through an explicit surface option, not parent CSS overriding its internals.
- First prototype this composition on the measured Bodo cases. Compare its bitmap presentation/compositing cost at 1× and Retina dimensions with the current main-thread draw submission. Do not assume moving the draw to a worker reduces GPU cost.
- Apply bitmap, projected picking coordinates and the corresponding camera frame as one committed displayed revision. Tool hit testing and overlays refer to **what is displayed**, not a newer requested spread. During continuous reveal the previous matching revision remains usable until its replacement is ready.
- On pan/zoom, synchronize the displayed paper and overlay transform. Do not temporarily CSS-scale Fold's bitmap in a way that changes its non-scaling line weights. Keep the requested camera responsive while publishing a coherent presented frame.
- Preserve Fold's current switch to unspread paper once a tool begins picking/previewing. Clear stale worker frames on that transition. Test import-order previews, turned/landed states, refusal face colors, located creases and sheet marks, not only resting paper.
- Keep the pane-local startup spinner until the first usable paper/picking pair exists. No wait cursor, app-wide input blocker, repeated loading overlay during gestures, or silent click against mismatched geometry. Navigation/cancel stays responsive. Worker failure must release loading and use the established fallback; do not restore a long synchronous Default-spread rebuild as an unnoticed fallback.
- Keep card capture debounced and lower priority as it is now. Ensure active-view changes cannot be delayed by obsolete thumbnail work.

### 4. Profile and validate each stage before proceeding

1. Record the full Fold workspace baseline on the supplied fish: main-view reveal, inspector reveal pad, amount slider, spread toggle, zoom and step changes. Include React/store work and thumbnail activity, which the isolated harness excludes. Use Chrome Canary when using an external browser. Save trace and input-to-presented-frame measurements locally.
2. Land static-index reuse/precomputed bindings independently; repeat the same workload. Count CP index builds, material face/triangle searches, solve requests and prepared-source requests. Amount/reveal must not increase any model-preparation counter.
3. Move the common rendering host to the worker; repeat the same workload and split worker CPU time, message/transfer cost, bitmap presentation and main-thread picking/overlay time. Test rapid input with a deliberately slow worker to prove requests coalesce.
4. Broaden correctness to representative Cpoogle models and the saved regression files. Keep comparisons against the same implementation revision, scene, style, camera and DPR. A whole-corpus performance claim requires a whole-corpus run; the current five-case profile cannot support one.

Acceptance targets on the same local benchmark device (targets, not current results):

- Zero CP-index rebuilds and zero face/triangle-association searches during warm reveal/amount updates; no extra numerical solves during any view gesture.
- Warm main-thread interaction work p95 under 8 ms on Bodo, with no spread-induced main-thread tasks over 50 ms after preparation. Measure presentation and folded-lookup reconstruction, not just message dispatch.
- Input-to-presented-frame p95 under 50 ms at 800 × 600 on the measured Bodo states. Record realistic Retina viewport results separately; revise the architecture if presentation becomes the new bottleneck rather than hiding it with loading UI.
- Picking and drawing always share a committed revision. Capture/solver/renderer cancellation and failure cannot revive an old step or leave an overlay permanently blocking input.
- Repeated model/step switches release obsolete workers, buffers, bitmaps and pick preparations; retained memory plateaus. Keep the existing 32 MiB height-solution cache policy.
- Preserve face/fill/line visibility and per-surface width/erode/dash/cap behavior. Compare geometry and visible line intervals exactly where deterministic; allow only documented raster anti-aliasing tolerance in screenshot comparisons. Check front/back, cyclic stacking, large spread and near-zero spread.
- Verify picking equivalence for point, line, midpoint, crease-mark and free-point cases; hovered targets, stored sheet coordinates and tool actions must agree. Include large deformations and front/back/rotation rather than checking only serialized index structure.

## Affected Areas

- `apps/web/src/fold/canvas/foldPicking.ts`, `foldPaneSpreadMap.ts`, `useFoldPaneSpread.ts`, `useFoldStateView.ts`: static preparation, reusable material bindings and displayed-frame picking.
- New focused preparation/worker modules beside Fold picking; keep behavior out of panel components.
- `apps/web/src/layer-spread/renderProtocol.ts`, `render.worker.ts`, `useSpreadRenderer.ts`, `connectedScene.ts`: shared controller, projection results and host-independent frame contract.
- `apps/web/src/components/fold/canvas/FoldPane.tsx`, `FoldCanvas.tsx`, and adjacent hooks/components: worker paper presentation plus existing interaction overlays.
- `apps/web/src/cp-workspace/surface/useCpSurface.ts` and renderer surface options: explicit overlay composition and committed-frame camera plumbing.
- `apps/web/src/components/diagram/DiagramSpreadView.tsx`: adapter migration with existing rendering, idle-capture and width behavior retained.
- Focused tests next to picking, renderer lifecycle, Fold surface and Diagram Pose; local benchmark artifacts remain ignored.

## Checklist

- [x] Trace the current Fold and Diagram paths and identify differences.
- [x] Build genuine Fold-engine inputs from Bodo and comparison models.
- [x] Profile warm pipeline stages and separate the picking sub-stages.
- [x] Confirm the hot function with a sampled CPU profile.
- [x] Test static CP-index reuse in an ignored counterfactual and compare returned data.
- [x] Record scope, evidence, limitations and unchanged line-width semantics.
- [x] Capture full-workspace interaction traces before implementation.
- [x] Extract static picking preparation and reuse the CP index.
- [x] Precompute material bindings and make initial preparation asynchronous/cancellable.
- [x] Reprofile picking before changing renderer ownership.
- [x] Extract the shared worker controller/protocol and host adapters.
- [x] Compose Fold paper and tool overlays with atomic displayed-frame/picking updates.
- [x] Verify cancellation, stale frames, failure handling, context loss and explicit worker/bitmap disposal in lifecycle tests.
- [ ] Measure retained-memory plateau over prolonged real-browser model switching (not established by the lifecycle tests).
- [x] Check geometry, line visibility, widths and picking against the baseline; verify Rotate/Fit in IAB and Canary.
- [x] Benchmark Bodo plus representative Cpoogle models, including realistic Retina viewports.
- [x] Run full web lint, TypeScript, 435 tests across 68 focused picking/renderer/Fold/Diagram suites, and the production build with fresh WASM and landing prerender. Rust/oracle/native suites are unnecessary: no engine or shell behavior changed.
- [x] Complete Canary/full-app review and record measured acceptance results and remaining limits.

### Implementation and measured results

- Fold prepares CP picking and material bindings in a short-lived worker, then reuses them. The rendering worker updates only the folded targets and the spread drawing. GPU geometry remains resident for camera-only frames.
- Fold and Diagram share `useBitmapRenderer` and `createSpreadBitmapRenderer`. Hosts retain placement, style and camera semantics. The controller has one in-flight request and one replaceable pending request, generation/ID checks, timeouts, and late-bitmap disposal.
- The Fold paper bitmap, target positions and displayed camera publish together. Tool overlays use that displayed camera; hits are withheld while a requested camera differs. Picking/previewing a fold still returns to unspread paper.
- Presentation-only document edits no longer replay the Fold sequence. The full-workspace trace found cached replay still taking up to about 100 ms per spread change. Operation, paper, topology, choices, load and drift-expectation changes still replay; failure/retry behavior remains.
- Rotate and import-order previews now supply the same scene to the worker and flat painter. Fit uses the actual bounds delivered with the spread bitmap. A new preview does not refit against temporary flat bounds while its worker is preparing.
- Startup is pane-local, with the normal cursor. Worker failure clears the loading state and reports unavailable rather than synchronously rebuilding Default spread on the main thread. Spread can be disabled or changed through the inspector. There is no new cross-model cache; weak references and current-source ownership bound the added state. The height cache remains unchanged.

Final isolated production-function benchmark, same five input scenes/style/reveal sequence and 800 × 600 CSS viewport, 3 warmups + 20 samples. Request-to-bitmap figures include worker delivery and main presentation but exclude React/store work. Baseline includes the old synchronous picking/drawing pipeline, excluding GPU completion. These are different timing boundaries, so their ratio is not a frame-rate claim.

| Model | Original main-thread pipeline median | Worker bitmap median / p95 at 1× | Main pick hydration + bitmap presentation p95 | Worker median / p95 at 2× |
| --- | ---: | ---: | ---: | ---: |
| Bodo 147 | 137.2 ms | 26.3 / 34.0 ms | 0.24 ms | 25.8 / 28.4 ms |
| Bodo 168 | 149.2 ms | 26.7 / 30.2 ms | 0.21 ms | 26.2 / 30.8 ms |
| Bodo 204 | 193.6 ms | 35.9 / 53.3 ms | 0.16 ms | 28.8 / 35.0 ms |
| Horse | 22.3 ms | 13.2 / 17.1 ms | 0.08 ms | 16.3 / 19.6 ms |
| Ant | 15.9 ms | 10.3 / 12.9 ms | 0.08 ms | 58.2 / 92.6 ms |

The 2× run shows substantial case/run variance (especially Ant); it is not uniformly faster or guaranteed under 50 ms. Both resolutions match the original painter exactly at the checked pose: zero differing RGBA channels in all five cases. Maximum target-coordinate error is below 2.3e-16 sheet units. The worker returns original precision for picking; this is not an approximate geometry shortcut.

The full-workspace development-app trace improved store-change→two-animation-frames from median 65.2 ms / max 153.3 ms to median 21.8 ms / max 54.6 ms after replay elimination. This is not final bitmap latency. A separate final full-app run measured store-change→bitmap median 91.6 ms / p95 108.2 ms at the actual workspace viewport, with 50–74 ms long tasks. This run uses one imported Bodo state, not the full 205-step book. A native Chrome Canary CPU trace attributes substantial remaining development-build cost to React debug `createTask` / console tasks under `startUpdateTimerByLane`, triggered by store notifications. Instrumented Fold component bodies and overlay drawing do not account for that overhead.

The same 20-change workload in a production bundle measured store-change→bitmap median **44.1 ms / p95 52.6 ms**, with **no >50 ms main-thread long tasks** observed. Store updates themselves were below 0.9 ms; the double-animation-frame metric was median 7.6 ms / p95 9.6 ms. This uses the actual Fold workspace on one imported Bodo state at the test viewport, not the full 205-step book. The production-vs-development difference confirms that the development server overstates shipping interaction cost; it does not erase remaining worker/transfer/GPU latency. The strict under-50-ms target is **not universally met**. Do not describe this as an all-Cpoogle benchmark or a complete production performance certification.

Evidence additionally saved under ignored `artifacts/fold-spread-profile/`: `worker-final-1x.json`, `worker-final-2x.json`, `full-app-before-replay-skip.json`, `full-app-final.json`, `full-app-microtasks.json`, `full-app-components.json`, `full-app-surface.json`, `full-app-presented.json`, `full-app-effects.json`, `full-app-pane.json`, `full-app-production.json`, `canary-main-trace.json.gz`. The production harness bundles the real app and workers with Vite production settings; its loader/profiler remains ignored. All timers/probes in production source were removed. No corpus inputs are tracked.

Chrome Canary review: loaded the real imported Bodo engine state, switched Affine → Default and observed Preparing pose until paper was ready; tested quarter/eighth-turn previews, cancellation and Fit. At the quarter turn Fit framed the actual spread form at 200% on that viewport. IAB independently verified the rotated bitmap, matching preview thumbnail and Fit. Startup keeps the normal cursor. Browser screenshots/traces remain local, and no user-owned tabs or source files were altered.

### Main integration and Fold default (2026-10-31)

Fold's Default spread now starts and resets to 7% (stored multiplier 0.14). Diagram retains 25%, and existing saved/inherited values remain unchanged. New Fold documents, enabling spread without a prior setting, switching to Default and the CP import preview share the Fold default.

The merge with `main` retains its new `PaperPane` composition and `StackHitIndex`. The shared pane exposes a host-owned external paper layer with the same presented-camera contract, gesture interception and local readiness state; Fold supplies the worker adapter. Picking reuses the new stack index alongside its prepared CP data. Diagram's new recorded layer-order capture/editor paths use connected capture, preserve readiness and cancellation guards, and release their solution cursor on disposal.

Validation: focused default/controls/shared-pane tests pass. Full merged-tree checks and browser smoke review are recorded in the PR handoff.

Merged-main validation found and fixed two shared-pane integration gaps: an
async paper layer now requests its first frame when it becomes ready, and
camera-sized overlays keep the sizing of the worker frame being displayed.
Reopening a Diagram pose also restores its saved layer order before preparing
connected spread. The shared loading surface lives under `components/paper`,
so Fold does not depend on Diagram components.

Local validation after integration: 17,828 passing web tests across 1,383
passing files (plus the subsequent first-frame regression: 11 passing
PaperPane tests), full lint, typecheck, translation check, production build
and landing prerender. Node 26 locally needs
`NODE_OPTIONS=--no-experimental-webstorage` for jsdom; CI uses Node 22.
Canary verified the 7% Fold default and Amount reset on the real imported Bodo
fixture. Final CI status is recorded in the PR.
