# Default camera spread in production

## Goal

Ship the validated camera-based spread as **Default**, first in the spread choices
and enabled for newly created folded-flat Diagram poses. Retain Affine and Depth
as explicit alternatives. In its 3D projection modes, offer the simulator/folded
3D camera experience: orbit, roll, Set upright, named views, pan, zoom and reset,
using shared controls and camera state rather than another implementation.

This plan is the production follow-up to `camera-spread.md` and
`camera-spread-partial-visibility.md`, incorporating Zach's 2026-10-23 request.
Implemented on `codex/camera-spread`. The research explorer
and its accepted appearance are the visual reference, including thin lines,
Retina antialiasing, local back-facing reversal and protection of known stacks.

## Approach

### 1. Product behavior and defaults

- Spread choices read **Default**, **Affine**, **Depth**, in that order. Store
  the new kind as `camera`; `Default` is its translated UI label, not a serialized
  alias whose meaning changes with future defaults.
- A new folded-flat pose starts with Spread layers on and Default selected.
  Starting a new spread without a remembered explicit choice also uses Default.
  Restoring a remembered pose, duplicating a step, refreshing, reopening and
  undoing preserve the authored choice, including Off, Affine and Depth.
- For a genuinely new Default pose, inherit settings from the nearest earlier
  **camera** spread, otherwise use the defaults below. Do not let an earlier
  legacy Affine/Depth pose silently replace the new default. Explicitly choosing
  a legacy kind retains its existing same-kind starting-settings behavior.
  Encode this distinction in `spreadStartsFor` and the capture entry points;
  do not implement it by changing the file reader's treatment of missing data.
- Initial settings match the accepted explorer: amount **6%**, direction **247°**,
  Diagram projection, inclination **45°**, unit zoom and centered framing.
  These are one shared constant, not copied into UI, readers and capture code.
  The supported amount range is **0–50%**; it bounds total added depth relative
  to model size, not a gap per layer. Keep the existing restrained bending fit.
- Default exposes Amount and continuous Direction, with Diagram, 3D orthographic
  and 3D perspective projection choices. Direction/inclination describe the
  Diagram projection; in 3D any angle readouts derive from the shared camera.
  The model itself is the primary 3D orbit control.
- At zero amount, Diagram uses the exact original flat drawing. Zero in a 3D
  mode still permits orbiting the flattened paper. Thus a camera spread at zero
  is a valid saved value and is distinct from Spread layers being off.
- Known layer order is protected in every production projection. Reverse it
  using each deformed surface's facing; use depth for unrelated overlapping
  surfaces. Raw depth and the bending mesh remain research diagnostics.
- Existing `.osf`/Diagram files keep their appearance. Missing `spread` still
  means Off; old records without `kind` still mean Depth. No bulk migration
  applies Default to saved pictures, and no file-open recapture is triggered.

### 2. Reuse the existing camera and viewport

The reusable pieces already exist:

| Existing piece | Production use |
| --- | --- |
| `simulator/SimulatorViewport.tsx` | Common canvas input, wheel zoom, pointer capture, resize, bitmap presentation and view-cube mounting. Already used by Diagram's 3D Pose view. |
| `lib/simulatorOrbit.ts` | Orbit/roll math, zoom limits/curve, `setUprightView`, named viewpoints and `withRollAbsorbed`. |
| `packages/origami-simulator/src/webgl/camera.ts` | Shared view matrix, orientation and camera uniforms; consumed by GPU and CPU render paths. |
| `simulator/viewCube/SimulatorViewCube.tsx` and `viewCubeTween.ts` | Named views, roll ring, interrupted snaps and reduced-motion handling. |
| `components/diagram/DiagramPose3dView.tsx` / `DiagramPoseStage.tsx` | Pose stage composition, annotation ghost, live-view registration and persisted-camera adapter. |
| `diagram/actions/diagramLinkedPoseActions.ts` | Existing Set Upright, reset, rotation and view verbs. |
| `cp-workspace/folded/useFolded3dMeshRuntime.ts` | Example of a static mesh using the shared worker client and bitmap transport without running a simulator. |

Choose the sharing boundary from the code, not the existing name. A viewport
that is genuinely renderer-independent belongs under a neutral name such as
`Viewport3d`; simulator-only solver, frame and tool behavior belongs in a
`SimulatorViewport` adapter. If the render lifecycles differ substantially,
share the camera controller and appropriate presentation components instead of
forcing them through one component with flags. Do not merely rename a
simulator-shaped interface or add compatibility aliases indefinitely.

Use a small `DiagramPoseCameraSpreadView` adapter with its own static rendering
runtime. Keep shared input and view-cube behavior where the boundary is sound;
the specialized layer-protected renderer remains a separate render backend.
Do not feed the lift into the ordinary mesh renderer and lose its visibility
rules. Do not synthesize simulator steps, strain or fold-percent state just to
reuse the viewport.

Where viewport behavior is currently embedded in the component, extract a
renderer-independent camera controller/hook beside `lib/simulatorOrbit.ts` and
have the existing viewport consume it first. It owns gestures and camera verbs,
with begin/preview/commit/cancel callbacks for document-owned views. Reuse it
from folded-figure input routing as needed. A second copy of
`useCameraSpreadOrbit` must not become the production control path.

**Pan is an addition to the shared system.** `SimulatorOrbitView`, package
`OrbitView` and `FoldedFigureCamera` currently have no pan field; the viewport's
touch handler explicitly zooms without panning. Moving a folded window on the CP
canvas is object placement, not camera pan. Add optional view-plane pan with
zero as the legacy default. Define it in normalized, aspect-correct camera units,
not CSS or device pixels, so it survives resize and Retina changes. One shared
conversion must drive GPU projection, CPU projection, picking, capture framing
and exports. Panning moves the framing without changing the orbit pivot.

Use a single gesture policy across the participating 3D views:

Pan ships for simulated views too: the Simulate workspace, inline simulations,
and Diagram's simulated poses, on both GPU and canvas-2D paths. It is not a
camera-spread-only feature.

- Primary drag orbits; Shift-drag rolls, retaining the current convention.
- Add middle-button drag and an explicit Pan mode for camera panning. These
  apply inside an active viewport, without stealing CP-canvas/window-placement
  gestures or simulator tool presses. Route through the existing tool/gesture
  arbitration rather than a competing pointer listener.
- Wheel/pinch zoom uses the shared range and curve. Two-finger centroid movement
  pans and pinch distance zooms through the existing touch arbiter. Define wheel
  ownership once so events do not also move the containing page or CP canvas.
- Reuse Set upright: take the current screen-up direction as the model's +Y
  without jumping the picture. Preserve the existing basis conventions; this
  is not a new coordinate-system swap or a separate Y-up checkbox.
- Reuse the view cube and named views, including roll. Offer Fit/recenter and
  reset through shared verbs. Preserve existing surfaces' documented reset
  policies; the new pose resets to its initial camera, zoom and zero pan.
- Keyboard actions go through `keyboard/` and the active surface executor,
  including when focus is in portalled UI. Do not attach panel key listeners.

Register the active Diagram view with its existing pose controller. Scope all
camera state per view/session; avoid extending the global simulator registry
into a singleton that couples several open Diagram poses or folded windows.
Keep panel components as composition sites and controls in CSS modules.

### 3. Persist a camera spread without competing camera representations

Extend `LayerSpreadOptions` with `CameraSpreadOptions` and carry it through
`DiagramLayerSpread`. Store amount and projection, the Diagram direction and
inclination, and a shared persisted 3D camera (orientation, yaw/pitch, zoom, pan).
Keep mode-specific settings so toggling Diagram/3D does not lose a chosen pose.
Use one authoritative 3D camera; do not separately persist research azimuth,
inclination and roll as a second 3D orientation. Absorb roll into orientation at
persistence boundaries with `withRollAbsorbed`, as other poses already do.

Add a pure adapter between the lift's XY/Z basis and the existing simulator
basis. Test forward/back colour, handedness, eye direction, roll and Set upright.
The shared camera has historical reflection conventions; copying angles or
"correcting" that basis here would mirror existing models. On the first switch
from Diagram to 3D, derive a matching view from the projection frame. Subsequent
switches restore the remembered 3D camera. Document the composition with existing
`rotationDeg` and side/turn-over so page-plane rotation is applied once, and
spread direction continues to use its intended frame.

Update defaults, equality, clamps, starting/remembered poses, field requests,
slide requests and analytics discriminated unions exhaustively. In particular,
today several non-Depth branches assume Affine and `readSpread` rejects zero.
Do not add `camera` to the enum while leaving those implicit branches intact.

Extend strict file-field allowlists and camera readers/writers, including pan
where cameras appear in Diagram and folded figures. Validate finite values,
positive zoom, supported projections and complete valid orientations. Preserve
the file system's unknown/newer-record handling: an older build must preserve
an unsupported camera-spread record as newer content instead of misreading it
as Affine or dropping fields. Add old/new round-trip fixtures and use the existing
format-version policy for any required capability/version change.

### 4. Promote rendering, caching and preparation

Promote the renderer and occlusion implementation out of `devtools/` into the
folded presentation modules. Both the explorer and production should import the
same implementation so future fixes are tested in the shipping path.

Keep the current shared-vertex lift, panel-stiffness penalty and authoritative
partial-order visibility. This is a diagram deformation, not a new physical fold
solver. A nonlinear shell/contact solver is a possible later project, not a
prerequisite for this integration; the older research recommendation is not the
scope of this implementation. Do not claim the lifted mesh is intersection-free.

Build a static camera-spread runtime using the existing reference-counted worker
client/session conventions and bitmap presentation. Add an isolated rendering
session/backend rather than expanding solver-shaped `useSimulatorRuntime` with
camera-spread conditionals. Share worker lifetime, scheduling, resource caps and
transferable-buffer ownership where appropriate. Account for the protected
renderer's framebuffer/sample requirements explicitly; merely attaching it to
a shared MSAA context could reintroduce the boundary clipping bug.

Cache immutable topology, triangulation, lift, plans and stack relations by
source revision, region, fold solution and side as appropriate. The current
WeakMap caches are local to one object graph and cannot alone identify repeated
worker messages. Invalidate on geometry/solution changes; style, camera and amount
changes reuse prepared geometry. Camera changes rebuild only view-dependent
projection/coverage data. Move expensive preparation off the UI thread, coalesce
camera updates and accept only the newest revision/request. Release bitmaps,
textures and buffers on replacement/unmount/context loss, with bounded eviction.

Use product `PaperStyle`, Diagram style and pen roles rather than prototype yellow,
gray and hard-coded widths. Follow `poseLineWeight.ts` so stage size and captured
picture agree. Keep CSS stroke weight independent of render resolution and carry
Retina-aware supersampling into the worker. Display DPR and render sample scale
must be separate values; do not multiply pen weight by both. Resolve protected
samples consistently before downsampling, including auxiliary ink and silhouettes.

Handle unavailable WebGL2, context loss, unsupported topology, excessive resource
requirements and cancellation as typed runtime outcomes. Keep the last valid
picture visible with the normal retry/error state; never silently switch to raw
depth or a different spread. CPU capture and exports need the same visibility
policy, even when no live GPU view can be mounted.

### 5. Make saved pictures, exports and annotations agree

This is a release prerequisite, not a cleanup after changing the default.

The current vector projector rejects more than 2,000 triangles and masking over
50,000 fragments. Those are research limits, and the GPU gallery does not prove
production captures work. Replace the all-pairs work with projected spatial
candidates and reusable overlap data, with explicit time/memory budgets, rather
than simply deleting the caps. Produce `PaperScene` with the same protected
relationships, local reversal and unrelated depth ordering as the live renderer.
Clip auxiliary lines against the same geometry. Capture in a worker after a
settled gesture; exports wait for the exact committed generation.

Keep native scene/vector output for SVG/PDF and stored Diagram pictures. If a
capture cannot complete within the supported limits, retain the last saved pose
and report the failure; do not save a screenshot or an incomplete scene as an
unannounced substitute. The agreed corpus, including crane and the largest
prepared models, must pass this path before Default is enabled.

Preserve source face IDs and source triangle/paper coordinates through clipping
and BSP splitting. Diagram currently assumes spread faces retain one whole
outline (`capturePaperFaces.ts`, `annotationCarry.ts`, `zoomImprint.ts`). The
camera lift bends and subdivides faces, so whole-face mean-value weights and
selecting one ring per face are insufficient. Add a piecewise mapping based on
stable source triangles and barycentric coordinates, with perspective-correct
projection and inverse mapping. Keep the unoccluded source mapping separately
from visible fragments, so an anchor does not jump to a covering face when its
own face becomes hidden. Preserve existing annotation visibility semantics.

Integrate this map with annotation carry, zoom frames/insets, x-ray/hidden-face
operations, pose ghosts and refresh. Test anchors across layer changes, camera
rotation, amount changes and reopen; handle a changed fold topology through the
existing stale/unavailable-anchor policy rather than inventing a new location.

Use a stable capture/viewport frame through orbit, pan and zoom. Do not auto-fit
the projected bounds after each move, which would undo pan/zoom. Distinguish
camera framing from resizing/placing the picture on the Diagram page. Audit
`paperScale`: preserve the established scale for exact-flat/Diagram captures
where justified, and use the existing unscaled/fitted treatment for perspective
views rather than pretending they have one physical paper scale.

### 6. Connect Pose, UI and history; switch the default last

Extend the pose action catalog/controller and binding hooks; keep behavior out of
the panels. Reuse `DiagramSpreadRows` for the mode, amount and Diagram controls,
and `DiagramPoseStage`/the shared viewport for 3D interaction. Make Affine-specific
help/credit conditional on Affine. Use the existing compact fields, segmented
controls, view actions and styles; do not copy the research sidebar.

One drag produces one undo entry. During a gesture, preview the newest camera or
amount without recapturing or rebuilding the solver on every event. Commit the
matching picture and settings atomically after release/rest. Handle pointer
cancel, Escape, undo mid-gesture, mode/step changes, closing Pose and errors using
the existing controller contracts. Stale worker replies must not overwrite a
newer camera, layer solution, source or style. Set upright, cube snaps, pan and
zoom must participate in the same history/capture lifecycle.

Extend `trackDiagramPicturePosed` and its typed spread properties through the
central analytics layer: kind `camera`, projection enums and bucketed amount.
Capture gestures at commit, not every frame; do not send camera coordinates,
geometry, model names or paths. Reuse existing command instrumentation where it
already covers the action. Add translations and accessible names/value text for
the Default choice, direction, projection, pan and any new shared camera verbs.

Enable Default for new poses only after capture/export, history, file and visual
checks pass together. This integration must not alter Oriedita/Flat-Folder fold
solutions or redefine the separate actual Folded 3D / Simulated render modes.

## Affected Areas

Paths below are relative to the repository root.

| Area | Main files/directories |
| --- | --- |
| Spread geometry and visibility | `apps/web/src/cp-workspace/folded/foldedLayerSpread.ts`, `foldedFlatScene.ts`, `cameraSpread*.ts`; promote `apps/web/src/devtools/camera-spread/cameraRenderer.ts` and `cameraOcclusion.ts` |
| Camera math and state | `apps/web/src/lib/simulatorOrbit.ts`, `cp-workspace/folded/folded3dCamera.ts`, `folded3dWindow.ts`; `packages/origami-simulator/src/webgl/camera.ts` and downstream projection/picking consumers |
| Shared interaction/presentation | `apps/web/src/simulator/SimulatorViewport.tsx`, `simulator/viewCube/`, `lib/gestures/`, `keyboard/`, folded-figure orbit routing |
| Render lifecycle | `apps/web/src/simulator/simulatorSession.ts`, `store/workspaceStore/simulatorRuntime.ts`, `workers/simulatorWorker.ts`, static-runtime adapter beside the folded modules |
| Stored Diagram state | `apps/web/src/diagram/document/diagramDocument.ts`, `diagramFile.ts`, existing camera serialization in workspace files |
| Pose and capture | `apps/web/src/diagram/capture/{captureSession,captureFolded,linkedPose,poseController,stepCaptureActions,useDiagramLinkedPose}.ts` |
| Pose UI | `apps/web/src/components/diagram/{DiagramSpreadRows,DiagramPose3dView,DiagramPoseStage}.tsx`, a small camera-spread view adapter and adjacent CSS modules |
| Anchors, framing and exports | `apps/web/src/diagram/capture/capturePaperFaces.ts`, `diagram/annotate/annotationCarry.ts`, `diagram/zoom/`, `diagram/pictures/`, shared `lib/paper/` exporters |
| Instrumentation and review | `apps/web/src/analytics/{events,trackDiagram}.ts`, translations, `scripts/camera-spread/`, focused tests and ignored local corpus artifacts |

## Checklist

### Stage 1 — Common camera behavior

- [x] Specify and test the basis adapter and persisted camera/pan representation.
- [x] Extract shared camera gesture/transaction behavior without changing existing views.
- [x] Add pan once; connect orbit, roll, Set upright, view cube, wheel/touch zoom,
  reset and Fit through the shared controller and action routing.
- [x] Verify simulator tools, CP object placement, inline windows and existing
  3D poses retain their gesture ownership and reset behavior.

### Stage 2 — Data and production render runtime

- [x] Add `camera` to the spread union and explicit branches; implement defaults,
  strict reads/writes, equality, zero amount, remembered poses and inheritance.
- [x] Promote the approved renderer, worker preparation and cached visibility.
- [x] Integrate the static worker session with cancellation, coalescing, bounded
  resources, context recovery and a retained valid picture on failure.
- [x] Apply shared paper styles/line weight and display-aware antialiasing.

### Stage 3 — Capture, exports and anchors

- [x] Implement scalable vector clipping/capture with matching layer semantics.
- [x] Carry stable face/triangle/paper mappings through splits and projections.
- [x] Update annotations, zoom/insets, ghosts, x-ray behavior and capture frames.
- [x] Prove preview/stored-scene/SVG/PDF/PNG agreement and successful reopening.

### Stage 4 — Pose integration and Default activation

- [x] Add the production controls and view adapter with shared 3D interactions.
- [x] Complete atomic gesture commits, undo/redo, refresh and stale-reply handling.
- [x] Add translated labels and enum/bucketed analytics at the existing chokepoints.
- [x] Set choice order to Default/Affine/Depth and Default on for new poses;
  preserve existing saved/remembered/duplicated choices.

### Stage 5 — Release validation

- [x] Test current regressions: crane left/right unrelated overlaps, frog back
  faces/near-side view, LDM auxiliary straightness, woven patches and buried ink.
- [x] Test exact zero, off vs zero-3D, full orbit/roll/pole crossing, Set upright
  without a view jump, named views, pan/zoom, resize and nonzero pan under clipping.
- [x] Test complete gesture/keyboard/touch lifecycle and one undo per gesture,
  including cube animation interruption and step/source changes during capture.
- [x] Test old-file fidelity, new-file round trips, newer-field preservation,
  inheritance/remembered modes, all three projections and viewport framing.
- [x] Add production compositor tests at DPR 1 and 2; compare
  line weights/colours and clipped edges with stored scenes and exports.
- [x] Run all 33 prepared corpus examples through production preparation and
  vector capture/storage. Export/reopen the ten-model review in SVG/PNG and test
  the real PDF writer with all three projections. Keep private files untracked.
- [x] Recreate the ten-model/seven-view review against the accepted explorer,
  now including saved/reopened pictures and vector output. Keep the review local.
- [x] Measure completed bitmap RPC and compositor presentation latency, preparation,
  capture and available JS heap on standard/Retina Chromium and WebKit. Target 30 fps for frog, LDM and
  crane orbit on the reference machine; separately report the 4,722-face case.
  UI remains responsive during preparation/capture and cancellation. CPU submit
  timing alone is not evidence that this target passed.
- [x] Run simulator/package camera tests, affected Diagram/capture/file/anchor
  tests, web lint, typecheck, i18n checks and production build. Exercise the shared browser views on Chromium/WebKit; native Tauri smoke testing
  is deferred because no host code changes. Rust/oracle checks are required only if engine semantics
  are actually changed; this plan does not require such a change.
- [x] Review production screenshots, performance limits and capture failures
  before enabling the new default. No silent raw-depth, raster-only or legacy
  spread fallback is accepted as successful Default output.

### Stage 6 — Performance optimization after functional integration

- [x] Record a reproducible production baseline for amount dragging, orbit,
  pan/zoom, projection switches and initial preparation on frog, LDM, crane and
  the largest prepared model, at DPR 1 and 2.
- [x] Profile input-to-present latency, frame cadence, main-thread work, worker
  queues, allocation/GC, coverage-index rebuilds, GPU time where available,
  capture time and peak resources. Keep CPU submission and completed-frame
  measurements distinct.
- [x] Optimize measured bottlenecks: coalesce obsolete requests, reuse prepared
  geometry and typed buffers, cache view-independent relationships, avoid
  React/store updates per pointer move, and decouple live rendering from settled
  vector capture. Do not trade away layer protection, thin ink or antialiasing.
- [x] Re-run the same benchmark and correctness/visual cases; record before/after
  median and tail latency with hardware/browser/settings. Investigate regressions
  in simulator pan and concurrent views as well as Default spread.
- [x] Include the performance findings and remaining limits in the handoff.

The stages are suitable review boundaries, but the user-facing default switch
ships only with the complete persistence, capture and control behavior above.


## Implementation results — 2026-10-23

### Sharing decisions

- `lib/viewport3dCamera.ts`, `viewport3d/useCameraMotion.ts`, `ViewCube` and
  `ViewportNavigation` own camera math, gestures, animation and navigation.
  Diagram's static 3D and Default views use `Viewport3d`. `SimulatorViewport`
  remains a separate adapter because it owns simulation frames, picking and
  Pin/Pull tools. Both use the shared camera behavior; no dummy simulation
  contracts were introduced. The new Pan tool also works in simulated poses
  and inline simulations, with CPU/GPU projection and picking sharing pan units.
- Live rendering and vector capture use separate, reference-counted workers.
  The UI coalesces input once per animation frame and keeps one render request
  in flight, replacing queued requests with the newest input. Capture runs after
  a settled gesture and commits the picture/settings atomically. Saved camera
  fields exclude transient roll; roll is absorbed into orientation.
- Live sessions retain two GL contexts at most; the capture worker retains three
  prepared models. Framebuffers are bounded to 48 million pixels and the device
  limit. Vector clipping has 30-million-operation and 250,000-fragment budgets.
  Capture failures keep the last valid picture. No silent raster/raw-depth fallback.
- Vector compaction and capture framing live in `diagram/capture/`; the folded
  geometry modules do not import Diagram storage precision. Source face/triangle
  mappings remain separate from the clipped drawing for anchors and x-ray.
- Default honors production paper colors, auxiliary visibility, pen weights and
  supersampling. The renderer is intentionally unlit. Known stack relations
  reverse by local facing; unrelated surfaces use depth. Exact-boundary crease
  ink survives vector depth clipping, matching the exposed side of a GPU stroke;
  authored layer protection still covers shared boundaries.

### Validation evidence

- Full web suite: **1,007 test files / 13,984 tests passed**, with 2 files and
  16 tests skipped by their existing conditions. The final focused export,
  annotation, scheduling and boundary-ink regressions also pass (53 tests).
- Simulator package: **394 tests passed**, 1 existing skip.
- Typecheck, lint, i18n extraction/check and production build are run for this
  change. All eight target locales have the new labels and pan hints translated.
- All **33** prepared corpus scenes capture and retain their full anchor maps.
  Ten models × seven views have live bitmap, saved/reopened vector, SVG and PNG
  comparisons at DPR 1 and 2 under the ignored `artifacts/camera-spread/production/`.
  The original accepted before/after review remains beside it.
- **32 WebGL pixel cases per DPR** cover unrelated depth, face-ID permutation,
  inverted stacks, underside reversal, auxiliary ink and pan. The compositor
  antialiasing check detects blended line pixels at DPR 1 and 2.
- Real browser checks on the built-in Crane diagram cover Default activation,
  legacy Affine preservation, projection switching, orbit, pan, Set Upright,
  undo/redo and an existing simulated step's pan/undo. Pure input tests cover
  pointer cancellation, history interruptions and readonly behavior; the full
  suite exercises shared touch/tool arbitration. No native Tauri session or
  physical multitouch device was exercised in this pass.
- The real PDF WASM writer successfully exports all three Default projections
  as vectors with no embedded image. Example output is kept with the local review.
- Rust/oracle/desktop-shell checks are skipped: no engine semantics, Rust or
  native host code changed. The normal web build rebuilds the WASM dependencies.

### Post-integration performance pass

Reference machine: Apple M1 Max (32-core GPU), macOS 26.6.2; Chromium 148 via
ANGLE Metal, plus Playwright WebKit. The reproducible script is
`scripts/camera-spread/benchmark-production.mjs`. Each combination warms five
frames and measures 24 for amount, orbit, pan, zoom and projection switches.
The benchmark separates the completed bitmap RPC from two animation frames of
compositor presentation. It does **not** mistake command-submission time for GPU
completion, or claim a hardware input-to-photon measurement. WebKit's two-frame
floor is about 33 ms here; Chromium's is about 17 ms.

Orbit presentation latency in milliseconds (median / p95):

| Model | DPR | Chromium before | Chromium after | WebKit after |
| --- | ---: | ---: | ---: | ---: |
| Frog, 76 faces | 1 | 16.7 / 16.8 | 16.7 / 17.9 | 33 / 34 |
| LDM, 151 faces | 1 | 16.6 / 17.8 | 16.6 / 18.2 | 33 / 34 |
| Crane, 921 faces | 1 | 36.5 / 73.5 | 16.7 / 25.6 | 33 / 34 |
| Tokyo Skytree, 4,722 faces | 1 | 367.1 / 681.2 | 193.5 / 339.2 | 167 / 333 |
| Frog | 2 | 16.6 / 16.8 | 16.7 / 16.8 | 33 / 34 |
| LDM | 2 | 16.6 / 17.3 | 16.6 / 18.1 | 33 / 34 |
| Crane | 2 | 33.2 / 50.1 | 16.7 / 18.0 | 33 / 34 |
| Tokyo Skytree | 2 | 194.5 / 258.5 | 124.2 / 183.1 | 116 / 209 |

The measured bottleneck was redundant candidate coverage in the fragment shader,
particularly thin triangles spanning large tile bounding boxes. A conservative
triangle/tile intersection test removes empty candidates, while reusing typed
buffers/bins avoids repeated allocation. Debug mesh line quads now use a separate
buffer and are not submitted when hidden. Uniform locations/GPU limits are cached.
Preparation caches and the separate prewarmed capture worker keep slider/orbit
input independent of vector clipping.

Crane's worst p95 across the five interactions fell from **73.5 to 25.6 ms** at
DPR 1 and **63.7 to 18.0 ms** at DPR 2. Frog/LDM stay near the compositor floor.
Cold preparation is about 0.22 s for frog, 0.73 s for LDM, 2.9 s for Crane and
15.5 s for Tokyo Skytree. The largest model remains outside the 30-fps target:
its p95 orbit is 183–339 ms in Chromium and 209–333 ms in WebKit. Some amount
changes are slower still. Its cold vector capture was roughly 30 s when measured
alone; export is off-thread and bounded, not instantaneous. The drawing is still
an approximate connected lift and may physically intersect beneath visibility
clipping.

Raw benchmark JSON, per-model capture/storage sizes and screenshots stay in
ignored artifacts. Available main-page JS heap samples are recorded, but exclude
worker/GPU allocations and are not presented as peak total memory. Native GPU
memory instrumentation and physical touch-device testing remain follow-ups.

## Real project regression pass (2026-10-23)

The prepared model corpus did not exercise reopening complete diagram projects.
The user's Bodo step 190 reports no layer order despite a previously saved folded
picture, and Set Upright needs verification through real pose controls. Treat the
prior readiness assessment as incomplete until these workflows pass.

- [x] Reproduce Bodo step 190 from the original OSF using the production sheet selection and fold path; identify the first divergence from its saved result.
- [x] Reproduce and repair Upright/Set Upright in Diagram and 3D, including rotated poses, camera persistence and subsequent orbit.
- [x] Audit real OSF projects from the supplied diagrams directory; keep inputs and generated reports ignored.
- [x] Exercise Default, legacy spread, front/back, all projections, pan/zoom, undo/redo, switching steps, save/reopen and exports through the production UI.
- [x] Add regression coverage for observed failures, then rerun affected lint/typecheck/tests/build and interaction performance checks.
- [x] Record concrete results and remaining limitations; update the existing draft PR.

### Confirmed regressions and fixes

- Bodo step 190 was failing **before** the spread renderer, at `Step2 /
  NotAttempted`. Our folded-image graph discarded subfaces after an Euler
  diagnostic; Oriedita keeps them and proceeds. The original coordinates now
  produce the same complete layer hierarchy as the Oriedita oracle. Source-paper
  and FOLD-export validation stay strict. A generic regression and an optional
  external fixture test cover the distinction. The external fixture records
  coordinate bits because native decimal parsing can hide this numerical case.
- Default's shared viewport did not include the independent page rotation when
  establishing screen-up. The viewport adapter now absorbs that rotation on
  entry and removes it before storage/capture. Set Upright keeps the image,
  pan and zoom fixed, and a later horizontal orbit uses the visible vertical.
  Tests cover 15°, 90°, 180° and 315°, plus the actual component's Set Upright,
  camera commit, subsequent orbit, undo and page-rotation update.
- The real 411 MB Bodo project (205 steps) opened through the production store,
  step 190 rendered with Default and perspective, and saving/reopening through
  the actual project writer/reader preserved the complete diagram exactly.
  Original corpus files were never saved over. The browser test uses a separate
  localhost origin to avoid replacing the user's working document.

### Real project coverage

The supplied directory contains 15 OSF files. Twelve have saved diagrams,
containing 371 folded-flat steps (190 in Bodo); all resolve and solve using the
production sheet resolver and rebuilt WASM. Heart step 17 already has a stale
source fingerprint and also solves. Three OSF files contain no saved diagram
and are reported separately, not counted as folded-step successes. Bodo's other
15 steps are not saved folded-flat sources and are not counted in the fold audit.
The audit additionally replays saved layer-order selections, including Crane's
choices through 13; generated reports and coordinate fixtures stay ignored.

### Zero-spread capture regression found during visual review

At zero, the camera capture returned the old whole-face flat paint stream with
hidden faces enabled, then fed it to the triangle compactor. That compactor
moves visible ink after fills, which is valid only for already-clipped geometry;
on a whole-face stream it exposed buried ink. The zero Diagram path now uses
the normal hidden-face policy and preserves its original painter order. A
capture regression checks geometry, hidden ink and item order. The six real
zero cases were recaptured and reopened after the correction, and Bodo's zero
picture was compared against the original OSF's saved picture.

### Final validation

- Rust workspace: **2,361 passed**, 7 existing ignored tests; format and workspace
  clippy completed. All **30 Oriedita folding oracle** tests passed, including
  Bodo step 190's complete hierarchy at the exact browser-decoded coordinates.
- Web suite: **1,008 files / 13,989 tests passed**, 2 files / 16 existing skips.
  After the final zero-capture correction, **48 focused tests passed**, including
  camera capture, the actual viewport component, camera math and the real PDF
  writer. Web lint and typecheck passed again.
- WASM was rebuilt through the normal scripts. The final Vite production build
  and the explicit landing prerender both passed (37 prerendered files). The
  final bundle reused those freshly rebuilt bridges rather than rebuilding
  them a third time.
- **371/371** real folded steps solved; the other 14 OSF audits were repeated
  with saved layer-order selections (all passed), while Bodo's 190 sources all
  use case 1. Six representative real scenes (Bodo 190/205, Crane, Heart,
  Chipmunk and Nazgul) passed **36 capture/storage/reopen cases**. All 36 export
  through the actual PDF WASM writer as vectors, with no raster images.
- UI checks on complete Bodo and Crane projects cover legacy Affine/Depth,
  Default, zero, all projections, front/back, 315° page rotation, Set Upright,
  orbit, pan/zoom, undo/redo, step changes and save/reopen. Crane's simulated
  step 5 also passes pan and Set Upright; its edited project saves/reopens
  exactly and exports from the production PDF dialog.
- Native shell smoke and TreeMaker C++ parity were not repeated: neither host
  code nor TreeMaker behavior changed. The changed Oriedita behavior has its
  own native oracle, workspace tests, rebuilt-WASM corpus audit and browser
  coverage. Physical touch-device and peak GPU-memory checks remain the earlier
  documented follow-ups.

The local review is `/src/generated/camera-spread/real-files/captures/index.html`
and includes the 36-page vector PDF. Full raw inputs, screenshots, reports and
exports remain ignored, and the user's original project files are untouched.

### Real-file interaction timing

The actual render worker was measured at 800 × 640 CSS pixels, DPR 1 and 2,
with five warm frames and 24 measured frames for amount, orbit, pan, zoom and
projection changes. Bodo steps 190/205, the real Crane and Heart projects and
Nazgul all completed their bitmap updates at **2–9 ms p95**. Presentation was
usually **17–19 ms p95**. An initial Bodo 205 run overlapped the UI PDF export
and reached 39–48 ms for three presentation samples; an isolated repeat returned
**17–18 ms p95** for every interaction at both DPRs, with bitmap completion
**4–9 ms p95**. These include two animation frames, not input-to-photon timing.

Cold worker preparation is **7.5 s for Bodo 190** and **11.3 s for Bodo 205**,
versus **0.1–0.8 s** for the other three real models. Dense vector capture can
still take seconds to tens of seconds off-thread. The live camera stays usable
while a settled picture is captured. This is a documented remaining latency
limit, not a claim that initial preparation or every corpus model is immediate.

## Follow-up: References, Pose entry, and fish stroke parity

- [x] Reproduce missing precreasing plans in the Diagram browser and compare main.
- [x] Keep the saved picture visible during Pose preparation; remove redundant work and retain bounded reusable geometry.
- [x] Use fish_view.osf to align settled Pose rendering with Pages without changing the saved geometry or visibility.
- [x] Add targeted lifecycle/rendering regressions and measure cold and repeated Pose entry.
- [x] Verify real References → Diagram, fish Pose/Pages, camera gestures, and save/reopen; run affected web checks.


### Findings and corrections

The References planner and picker have no branch-specific behavioral difference
from main. The real browser reproduction completed 211 folds, but the packed
plan was missing: its lazy `fflate` import returned HTTP 504 (Outdated Optimize
Dep). Research SSR runners and the live app shared Vite's dependency cache.
The app now has a separate cache, also isolated by dev-server port and from
Vitest. Both running app origins now serve the compressor with HTTP 200.
On the real fish file, a regenerated plan appears in the Diagram picker; adding
its first card creates a linked References step with its six annotations.
Already discarded plans need regenerating once after a reload.

Pose keeps the saved vector picture visible while the interactive surface
prepares and displays it again when an edit settles. That is the same picture
used by Pages: the GPU's per-fragment clipping of expanded line ribbons no
longer changes the resting pen width. During an active edit the fast GPU view
still provides feedback until vector capture finishes. Its framing now includes
the same paper margin, avoiding a size jump when the vector returns.

Opening a camera pose no longer builds an unused flat vector picture or eagerly
prepares both workers. Immutable folded scenes are cached by document identity,
crease selection, side, layer solution and engine epoch (three scenes per live
document). Render/capture backends retain their existing two-scene LRU for at
most 30 idle seconds, then terminate. Kernel handles still close with their
sessions. Reopening a kernel for a subsequent edit reuses the identical scene
object and worker geometry key.

The lift's matrix coefficients are packed once and its repeated products use
allocation-free loops with the same accumulation order, tolerances and iteration
limits. All geometry, heights and non-timing diagnostics have identical SHA-256
hashes before and after on Bodo 190/205, Crane, Heart, Nazgul and fish. In the
final isolated Node run, solver times were 1,381 / 1,898 ms for the two Bodo
steps, 35 ms Crane, 19 ms Heart, 167 ms Nazgul and 331 ms fish; preparation adds
roughly 2–389 ms. These are CPU solver timings, not full browser capture times.

### Follow-up validation

- Actual fish UI: Diagram and perspective, pan, orbit after Set Upright,
  return to Pages, original 225°/19.5%/220°/28° settings, and exact save/reopen.
  The original input is untouched. Screenshots and timing data remain ignored.
- Instrumented Pose entry: initial saved-picture DOM at 133 ms and ready live
  viewport at 862 ms; immediate repeat at 52 ms / 67 ms. No sampled frame had
  neither picture nor ready viewport. The bitmap canvas is hidden at rest and
  the vector image is fully decoded. These measurements are DOM/RAF checks,
  not input-to-photon measurements; the full test suite was running concurrently.
- Focused cache, lifecycle, controller, camera and component tests: 108 passed.
  New regressions cover engine-epoch invalidation, bounded cache eviction,
  worker idle expiry/reentry, saved-picture handoff and opening without a
  recapture/history mutation.
- Web lint/typecheck and production bundle pass; the explicit postbuild writes
  all 37 prerendered files. No engine source changed in this follow-up, so the
  existing rebuilt WASM was reused. Native/Rust/oracle checks were not repeated.
- Final full web run: 1,007 files / 13,992 tests passed, 2 files / 16 existing
  skips. Two unrelated timing checks failed under concurrent build load (the
  Settings shortcut test's 5-second limit and the page-packing 32-ms budget).
  Both files then passed in isolation: **80/80 tests**, with no changes to
  those tests or their implementation. Every test in the final suite is thus
  covered by a passing run; the parallel full run itself was not wholly green.

Cold geometry and dense vector capture are still not instantaneous. This pass
removes the blank flash and repeated preparation, and improves the unchanged
solver; it does not claim a physical non-intersection guarantee or constant
latency on arbitrary models.
