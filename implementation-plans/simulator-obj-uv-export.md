# Simulator OBJ export with unfolded-sheet UVs

## Goal

Add **OBJ** to the **Export view** modal in the Simulate tab and to the same
modal opened from an inline simulation. Export the captured folded mesh with
texture coordinates tied to its unfolded sheet, so a user can import it into
Blender, assign an image texture, and render it without unwrapping it themselves.

Status: implemented and validated, 2026-10-10. Native save-dialog interaction remains a manual check (see validation results).

The screenshot motivates a textured 3D model, not a texture of the camera view.
The first version exports one `.obj` containing mesh geometry and UVs. Materials,
texture images, MTL/ZIP bundles, paper thickness, separate front/back UV islands,
animation, and additional 3D formats are outside this change.

## Approach

### 1. Build on the existing export paths

The relevant code already provides most of the plumbing:

- `useSimulatorExport.ts` opens the shared `PaperExportModal` for both simulator
  surfaces through `simulatorExportTarget.ts`.
- `useSimulatorRuntime.beginExport()` asks the worker to freeze a session-specific
  frame. `simulatorSession.ts` holds its positions, topology, and camera until
  release. SVG/PNG export already uses this frozen frame.
- `PreparedOrigamiModel.originalPositions` and `OrigamiModel.originalPositions`
  retain the initial sheet in exactly the prepared mesh's vertex order. The
  latter is centered and uniformly scaled to the solver's unit-radius space.
- `lib/foldedExport.ts::foldedObj` already writes OBJ for the separate File-menu
  export, but writes only `v` and bare `f` records. Its current `FoldedMesh`
  input has no UVs. Reuse this serializer rather than creating another OBJ writer.
- The live `exportGeometry()` API reads the most recently loaded session and
  does not freeze a dialog's frame. It is unsuitable for the two modal entry
  points, especially with multiple inline simulations open.

Read references before implementation:

- `third_party/origami-simulator/js/saveSTL.js::saveOBJ` already derives UVs from
  the flat sheet, using one scale for both axes and `f vertex/texture` indices.
  Follow that mapping; do not edit the vendored source.
- `packages/origami-simulator/src/geometry.ts::normalizePoint` documents Ori
  Studio's different basis: a 2D point becomes `[x, 0, -y]`. Account for this
  existing sign when checking texture orientation.
- `PORTING.md`'s Origami Simulator section and
  `implementation-plans/paper-export-dialog.md` describe the preparation and
  frozen-frame contracts that this change must preserve.
- The [original Wavefront OBJ specification](https://www.martinreddy.net/gfx/3d/OBJ.spec)
  defines `vt u v`, one-based vertex/texture indices, and face winding. These
  records can describe UVs without a material file; this feature leaves assigning
  the user's texture to Blender.

### 2. Define the UV and geometry contract

For a valid flat sheet in the simulator's XZ plane, use the prepared rest
coordinates, never the folded positions or projected scene:

```text
width  = maxX - minX
height = maxZ - minZ
span   = max(width, height)
u[i]   = (restX[i] - minX) / span
v[i]   = (restZ[i] - minZ) / span
```

This matches upstream's aspect-preserving normalization. A square fills the UV
square; a 2:1 sheet occupies a 1 by 0.5 rectangle, anchored at the UV origin.
Normalize once over the simulated sheet/segment, not independently per face or
connected component. Holes remain holes, and disconnected pieces retain their
relative placement. UV space is a square texture canvas; it does not stretch
the shorter dimension to fill that canvas.

Ori Studio has already negated the source's vertical coordinate in its sheet
lift. Do not add an unexamined `1 - v` conversion. Pin the orientation with an
asymmetric, corner-labelled texture and a real Blender import.

Required invariants:

- One UV pair per prepared mesh vertex; every face corner references that
  vertex's corresponding texture coordinate. Use the final prepared topology,
  including any added vertices or renumbering. Do not match vertices back to the
  original document by array index or by equality of vertex counts.
- UVs stay identical as a model folds, settles, is pulled, or the camera moves.
  Points touching in the folded result remain distinct when they are different
  points on the sheet. Never weld by folded position.
- Export every triangle of the captured simulation, including occluded faces.
  Visibility, X-ray, edge display, image cropping, and page settings cannot
  remove or transform the OBJ's geometry.
- Preserve the existing OBJ coordinate convention and solver-space scale.
  Export actual 3D positions without camera rotation, perspective, or reflection.
  The existing image size in millimetres is not a mesh scale. Physical size and
  axis-conversion controls are deferred.
- Preserve triangle winding. Start with a single zero-thickness sheet and
  explicit flat shading (`s off`); omit vertex normals and let the importer
  derive facet normals. Do not duplicate reversed faces to simulate two-sided
  materials. Test which side is the front in Blender.

Validate finite positions/UVs, complete array lengths, index bounds, a nonempty
triangle mesh, and a nonzero two-dimensional sheet extent. Check flatness with
a scale-relative tolerance. A genuinely nonplanar initial model, or a flat
model supplied in an unsupported plane, must report that sheet UVs are
unavailable rather than silently projecting it and calling that an unwrap.
Keep SVG/PNG available for such a capture. Already folded poses restored onto a
valid flat rest mesh remain supported.

### 3. Extend the existing frozen snapshot

Add a pure, tested UV builder beside the folded-mesh serializer. At snapshot
creation, derive and retain the UVs (or a structured unavailable reason) from
`active.model.originalPositions`, alongside copied positions, stable triangle
indices, and captured fold percent. This is a single on-demand readback, not
extra per-frame traffic or a second solver run.

Add an OBJ operation keyed by snapshot ID, exposed through
`SimulatorExportSnapshot`. Have it call the shared `foldedObj` serializer in the
worker and return the text, avoiding a large stringify on the UI thread. Extend
the serializer with a validated UV-bearing input/option; the modal path must
require it and emit `vt` plus `f a/a b/b c/c` for every triangle. Keep existing
geometry-only callers compatible and regression-tested. Aligning the separate
File-menu export with the new capability can follow separately; it is not a
third entry point to add to this task.

Positions, indices, UVs, and metadata must all belong to the same capture. A
later simulation tick, pin/pull action, settings change, or another window
loading cannot alter it. Never transfer/detach buffers owned by the solver or
snapshot. Follow the current lifetime rules: closing/replacing the dialog
releases the snapshot, and a disposed/evicted session makes it unavailable.
Expired snapshots must fail visibly without falling back to another session.

### 4. Add a mesh capability to the shared modal

Extend `PaperExportTarget` with an optional OBJ capability, implemented by
`simulatorExportTarget`. The capability reports availability and produces the
captured OBJ; the generic dialog does not reach into simulator stores or choose
a session itself. Keep behavior in the export hooks/modules, not in
`SimulatorPanel` or the crease-pattern panel.

For both simulator entry points:

- Offer **SVG / PNG / OBJ** in the existing format picker. Targets without a
  mesh capability (folded figures and References steps) retain SVG/PNG.
- In OBJ mode, show a short explanation: “3D mesh with UV coordinates from
  the unfolded paper, ready for texturing in your 3D software.” Show a
  specific reason and disable saving when valid sheet UVs are unavailable.
- Hide image-only style, page size, margin, background, DPI, and hidden-face
  controls. Switching back restores their draft values.
- Reuse a preview of the frozen pose as a visual reference, labelled as such;
  the OBJ includes the complete mesh. Suppress image dimensions, raster-size
  limits, and hidden-face counts in this mode. An empty edge-only image preview
  or an image-rendering error must not block an otherwise valid OBJ export.
  A new interactive 3D preview is unnecessary for the first version.
- Save through `FileService.saveTextFile`, with the existing filename sanitizer,
  `.obj` extension, and **Export OBJ** button. Preserve busy state, cancellation,
  retry after failure, return focus, and protection against a late save closing
  a newer dialog.

Distinguish image formats from the expanded dialog-format union in types.
Currently several branches assume “anything other than SVG is PNG.” Keep
`savePaperExport`, PNG rasterization, and image ZIP helpers typed to SVG/PNG,
and dispatch OBJ explicitly before entering those paths. Update draft, preview,
settings, and analytics format handling together.

Remember OBJ only for the existing `simulation` settings bucket shared by both
surfaces, and only after a successful save. Preserve prior SVG/PNG preferences
and their page settings. Validate remembered/explicit formats against each
target's capabilities, including old persisted data, invalid values, and an
OBJ preference used with a capture that cannot provide UVs.

### 5. Styling, localization, and analytics

Compose existing controls and `ExportModalFrame`. Put new presentation in
components with adjacent CSS modules. The `export-modal` block and select
overrides are shared (see `implementation-plans/scoped-css.md`): if the chosen
layout requires adding a shared rule or moving that block, ask whether to do
the migration in this PR or separately, as `AGENTS.md` requires. Do not stretch
an existing rule or add a parent override to avoid that decision. If styling a
one-owner block, migrate its complete block first and verify computed-style
equivalence in the browser. The implementation reuses existing controls and hint markup without changing styles or adding styling classes, so no CSS migration was needed.

Add translated labels, hints, and error messages through the existing i18n
workflow. Extend the centralized export funnel to recognize `format: 'obj'`
and distinguish `simulator` from `inline-simulation`. Make the successful-save
payload a format-discriminated shape: image-only properties are omitted for
OBJ rather than reporting fictitious DPI, style, or hidden-face choices.
Retain open/dismiss/failure tracking and the file service's existing event;
do not add another event for the same save. Test opt-out behavior and send only
approved enums/buckets, never geometry, UVs, model names, or paths.

### 6. Validation and acceptance

Automated coverage should establish behavior, not just compare a long string:

1. **UV/serializer tests:** square and rectangular sheets; translated/scaled
   inputs; asymmetric orientation; triangulated and refined meshes; holes and
   disconnected pieces; folded vertices coinciding without being welded;
   invalid/nonfinite/mismatched data and nonplanar rest geometry. Parse the
   output to verify all face vertex/UV indices resolve. Compare the UV math
   against the small vendored upstream algorithm for supported flat inputs.
2. **Snapshot tests:** CPU and GPU readback paths produce matching semantics;
   UVs are invariant across folding while positions change; exports of an open
   dialog stay fixed; two different inline sessions cannot cross; released,
   evicted, and stale snapshot IDs fail; copied buffers remain usable.
3. **UI/save tests:** both entry points offer OBJ and export their own capture;
   image targets do not; hidden image options cannot affect the mesh; format
   switching and saved preferences work; OBJ never invokes rasterization or
   image ZIP code; cancellation/failure/success and analytics remain correct.
4. **Blender acceptance:** import exports from both surfaces, at flat, partial,
   and fully folded poses. Apply an asymmetric numbered checker texture and
   inspect the UV editor. Confirm the expected sheet layout, orientation,
   continuity across shared creases, complete hidden geometry, face winding,
   and aspect ratio. Record Blender version and import-axis settings, and verify
   that the camera does not affect exported coordinates. Note existing solver
   intersections/strain separately from export defects.
5. **Platform smoke test:** download in the browser; save/cancel/retry through
   the native dialog in Tauri. Include multiple inline windows, an exported
   segment, and the CPU fallback. Confirm existing SVG/PNG previews and saves.

For implementation, bootstrap a fresh worktree with `scripts/setup-worktree.sh`
when needed. Run `npm run lint:web`, `npm run typecheck:web`,
`npm run test:web`, `npm run i18n:check`, and `npm run build:web` (the worker
bundle changes). Use `scripts/dev-server.sh start` for browser checks and
`npm run dev:desktop` for the native save smoke test. Run simulator package
tests/build only if that package changes, and `npm run check:desktop` if shell
code changes. No Rust engine or oracle changes are expected; report skipped
checks with that reason. Validate documentation with `git diff --check`.

Done when a textured OBJ from either export modal imports into Blender with the
captured folded geometry and a usable, stable sheet UV layout, and existing
image exports keep their behavior.

## Affected Areas

| Area | Expected changes |
| --- | --- |
| `apps/web/src/lib/foldedExport.ts` and tests | Extend the existing OBJ serializer; add a pure sheet-UV helper and semantic fixtures. |
| `apps/web/src/simulator/simulatorSession.ts` and tests | Capture UV/topology/metadata; serialize by snapshot ID; validate lifetime and session isolation. |
| `apps/web/src/simulator/useSimulatorRuntime.ts` and tests | Expose snapshot OBJ capability and availability. |
| `apps/web/src/simulator/simulatorExportTarget.ts` and export tests | Advertise mesh export for both simulator surfaces. |
| `apps/web/src/paperExport/` | Target capability, format dispatch, saving, preview readiness, and session state. |
| `apps/web/src/components/paperExport/` | Format-aware options/preview and localized copy; CSS modules where needed. |
| `apps/web/src/lib/paperExportSettings.ts`, settings/UI stores, and tests | Simulation-only OBJ preference, normalization, and capability validation. |
| `apps/web/src/analytics/` and `docs/analytics.md` | Format-aware funnel payloads, privacy, and regression tests. |
| `apps/web/src/cp-workspace/inlineSimulation/inlineSimulationExport.test.ts` | Correct target routing and parity with the Simulate modal. |
| `PORTING.md` | Document the UV-export addition and its supported plane/basis if the supported export surface changes. |

## Checklist

- [x] Inspect both export entry points, existing OBJ serialization, rest coordinates, and upstream UV export.
- [x] Define the UV mapping, snapshot ownership, scope, and Blender acceptance criteria.
- [x] Implement and test the UV builder and shared OBJ serializer extension.
- [x] Extend worker/runtime snapshots with validated OBJ export capability.
- [x] Wire format selection, preview, save handling, and settings for both modals.
- [x] Add localization and format-aware analytics; apply the CSS ownership rules.
- [x] Pass semantic, lifecycle, routing, settings, and existing image-export regression tests.
- [x] Verify textured exports in Blender and browser downloads from both surfaces.
- [ ] Manually verify native save/cancel/retry through the macOS file picker.
- [x] Run affected checks and record results and any remaining limitations.


### Validation results — 2026-10-10

- `npm run lint:web`: passed.
- `npm run typecheck:web`: rebuilt the simulator and all four WASM bridges;
  the final `npm run typecheck:web --ignore-scripts` passed.
- `NODE_OPTIONS=--no-experimental-webstorage npm run test:web --ignore-scripts`:
  **9,211 passed, 13 skipped**, across 707 files (705 passed, two skipped).
  The Node 26 flag avoids its experimental `localStorage` masking the test DOM's
  storage. Generated artifacts were rebuilt before the suite.
- `npm run i18n:check`: passed; all eight target locales contain the new copy.
- `npm run build:web`: passed, including simulator/worker bundles, WASM builds,
  and landing prerender. `git diff --check`: passed.
- Real Chromium downloads from the standalone and inline simulator modals at
  0%, 55%, and 100% fold: six OBJ files, changing positions and stable UVs within
  each surface. The inline fixture is built from a selected paper segment.
  The two preparation paths reorder vertices differently; UV indices correctly
  follow each prepared topology.
- Blender **5.0.1**, OBJ importer **forward -Z / up Y**: all six files import
  with four vertices, two triangles, and one UV layer. Assertions verify every
  face corner's UV, original winding, flat shading, and world-space positions
  after the import axis conversion. Rendered with Blender's asymmetric numbered
  color grid: texture continuity across the crease and orientation agree at all
  three poses. The preserved winding has its front facing Blender -Z in the
  flat fixture; viewing the back mirrors the texture, as expected for one sheet.
  “100%” is the simulator's full target angle (120° in this fixture), not a claim
  that every model is geometrically flat-folded.
- CPU snapshot tests cover frozen positions, UV invariance, independent sessions,
  expiration and release. Browser smoke exercises GPU readback. Broader cases
  (rectangular sheets, tiny scale, disconnected pieces, coincident folded points,
  invalid/nonplanar rest meshes) are covered by focused semantic tests.
- Tauri development build compiled and opened this worktree's renderer. Its native
  Open dialog displayed, but the automation could not reliably activate the path
  picker, so native save/cancel/retry was **not verified interactively**. The
  common save service's cancellation, failure/retry, and late-dialog replacement
  behavior is covered by automated tests. No native shell code changed.
- Rust engine/oracle tests, `check:desktop`, and simulator package tests were not
  rerun as separate suites because their source did not change. Their build
  coverage comes from the production web and Tauri development builds above.
- Validation scripts, screenshots, downloaded OBJs, Blender renders, and import
  assertions are retained locally in ignored `artifacts/obj-uv-validation/`.

The first version deliberately exports a single mesh with sheet UVs. Assign
textures/materials after importing; MTL files, paper thickness, separate front
and back texture islands, and arbitrary-plane rest meshes remain out of scope.
