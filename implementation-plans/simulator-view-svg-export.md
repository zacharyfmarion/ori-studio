# Simulator view SVG export

## Goal

Export the **current camera view of the folded 3-D model** as a vector image,
from both places a simulation is shown:

- the inline simulation window on the Edit canvas (an export dropdown on its
  floating toolbar), and
- the Simulate workspace panel (an export control in its toolbar).

This is the "Simulation module" ask in `oristudio feedback.pdf`: *"take all the
rendered polygons, apply a projection matrix based on the camera angle, and
estimate the z ordering based on projection distance from the camera. This would
be a huge deal for diagramming 3d steps."*

Explicitly **not** in the File > Export menu. That menu exports the *document*;
this exports *what one viewport is currently showing*, so it belongs to the
viewport — the same reasoning that put folded-figure export on the figure's own
toolbar rather than in the file menu (`foldedFigureExport.ts`).

Non-goals: layer-order correctness beyond a depth sort (that is Flat-Folder's
job — see the PDF's closing note), animation/frame sequences, hidden-line mode
(see below), and any change to the solver.

## Approach

### The shape of this feature: a second renderer, not a fourth consumer

The first draft of this plan had the exporter gathering positions from the
worker, the camera from `SimulatorViewport`'s private ref, and the palette from
the DOM — three reach-arounds at click time. That was wrong. The worker's
`GpuRenderState` **already holds all three**, because it is the thing that
draws:

```ts
interface GpuRenderState {
  solver: WebglSolver;                              // positions
  view: OrbitView; width: number; height: number;   // camera
  settings: RenderSettings;                         // colours, faces/edges/lighting, x-ray, strain
  center: [number, number, number]; radius: number; // the fitted framing
}
```

`SimulatorViewport` owns the orbit *gesture* and mirrors its result into the
worker on every move (`setCamera`); `toRenderSettings` reads the theme from CSS
and mirrors it in (`setRenderSettings`). Both already funnel to the renderer.
And `renderGpu` already assembles exactly the tuple an exporter needs:

```ts
const camera = cameraUniforms(state.view, state.center, state.radius, width, height);
state.solver.render(camera, state.settings);
```

So SVG export is a **sibling of that call**, in the same place, from the same
state:

```
state.solver.render(camera, settings)                 → pixels
renderMeshToSvg(positions, topology, camera, settings) → string
```

Everything below follows from that. The main thread gains no knowledge of
geometry, cameras, or palettes; it asks the worker for a string and saves it.

### 1. Projection — mirror the shader, do not invent one

`packages/origami-simulator/src/webgl/meshRenderer.ts` defines the projection on
screen; `camera.ts` computes its uniforms. The exporter must reproduce it, not
approximate it, or the SVG will not be the view the user composed.

Add to `camera.ts` a CPU mirror of the vertex shader:

```ts
export interface ProjectedVertex { x: number; y: number; depth: number; sx: number; sy: number }
export function projectVertices(
  positions: Float32Array,
  camera: CameraUniforms,
  options?: { perspective?: boolean }
): ProjectedVertex[]
```

with, per vertex (identical to `FACE_VERT`):

```
d      = position - center
yawX   =  cosYaw*d.x + sinYaw*d.z
yawZ   = -sinYaw*d.x + cosYaw*d.z
x      = yawX
y      = cosPitch*yawZ - sinPitch*d.y
depth  = sinPitch*yawZ + cosPitch*d.y
persp  = camDist / max(camDist - depth, 0.001)
sx     = width/2  + x*persp*scale      // NDC → pixel
sy     = height/2 - y*persp*scale
```

`(x, y, depth)` is the pre-perspective view position the shader calls `v_view`,
and is what normals and lighting are computed from; `(sx, sy)` is the pixel
position. Larger `depth` is **nearer the eye** (the shader writes
`z = -depth/depthRange` under a `LEQUAL` test), so painter's order is ascending
`depth`.

`perspective: false` reproduces the canvas-2D fallback renderer, which is
orthographic — see §4.

This belongs in the package because it is the one JS statement of the shader's
math, and `tests/camera.test.ts` + `bench/gpuParity.bench.ts` are already where
CPU and GPU are kept in agreement.

### 2. The SVG renderer — `packages/origami-simulator/src/svgRenderer.ts`

A pure function beside `webgl/meshRenderer.ts`, taking the same inputs that
renderer takes:

```ts
export function renderMeshToSvg(
  positions: Float32Array,
  topology: MeshTopology,        // the same one MeshRenderer is built from
  camera: CameraUniforms,
  settings: RenderSettings,
  options?: {
    perspective?: boolean;
    strain?: Float32Array | null;  // per-vertex rgb, for colorMode 'strain'
    background?: boolean;
  }
): { svg: string; width: number; height: number }
```

No DOM, no theme, no palette parsing: `RenderSettings` already carries the
colours (normalised 0..1, converted to hex here), `showFaces`, `showEdges`,
`lighting`, `faceAlpha`, `colorMode` and `strainClip`. Fully unit-testable in
the package's own vitest.

Algorithm:

1. Project every vertex (§1).
2. Build one draw list and sort it once by depth, ascending:
   - **faces** — one entry per triangle, depth = mean of its three vertices.
     Skip triangles that are non-finite or have ~zero screen area (a zero-area
     triangle is the known NaN signature — see `prepareFoldModel`'s guard).
   - **creases** — one entry per edge whose assignment code is `B`/`M`/`V`,
     depth = the **max depth of its adjacent triangles**, plus a small bias so
     it lands just after the nearer face it lies on. Facet edges and unassigned
     are skipped, matching `buildEdgeQuads`. Emitting once per edge rather than
     once per adjacent face halves the element count and still occludes
     correctly.
3. Emit in that order. Painter's algorithm *is* the occlusion model — a nearer
   polygon paints over a farther one's creases — which is why creases interleave
   with faces rather than forming a separate pass.
4. Face fill, matching `FACE_FRAG`:
   - two-tone by screen winding (the CPU counterpart of `gl_FrontFacing`),
   - flat lighting as `clamp(0.74 + diffuse*0.3 + n.z*0.04, 0.68, 1.08)` from
     the projected triangle's geometric normal,
   - `colorMode: 'strain'` fills with the mean of the three vertices' strain
     colours (flat per triangle; a per-vertex gradient is not worth a `<defs>`
     entry per face),
   - `faceAlpha < 1` (x-ray) → `fill-opacity`, which the painter's list
     reproduces for free since there is no depth write to disable.
5. Crease stroke colour by assignment code, width `creaseWidthPx` — the same
   device-pixel width the GPU ribbon uses.

Coordinates are the camera's own pixel space, with the `viewBox` cropped to the
tight bounds of everything drawn plus a small padding. That keeps the camera
exactly as composed (angle *and* zoom) while dropping the panel's empty
margins, which is what a diagram wants, and needs no invented scale constant.

`showHiddenLines` is deliberately **out of scope**: it is a `SimulatorSettings`
field that only the canvas-2D fallback implements, and the GPU renderer — what
the user is looking at — has no hidden-line mode. Matching `RenderSettings`
exactly is what makes the SVG match the screen by construction.

Reuse the package's own string helpers; escape nothing but the `aria-label`
(there is no user text in the body).

### 3. Worker surface

One new method on `simulatorSession.ts`:

```ts
exportSvg(options?: { token?: SimulatorSessionToken }): string | null
```

It reads the session's own view state, builds `CameraUniforms` the way
`renderGpu` does, reads positions (and `readColors` when `colorMode` is
`strain`), and calls `renderMeshToSvg`. `sessionFor(token)` rather than
`requireSession()`, so an inline window that has lost focus gets `null` instead
of another window's geometry.

`useSimulatorRuntime` exposes it as `exportSvg(): Promise<string | null>`,
keeping the token private, as it does for every other call.

Note `exportGeometry` stays exactly as it is — that serves STL/OBJ, which wants
raw geometry rather than a rendered view. The two are different exports and
should not be merged.

### 4. Make the session know how it is being viewed

`setCamera` and `setRenderSettings` both early-return when `!active.gpuRender`,
so on the canvas-2D path the worker never learns the camera or the settings. That
path is not exotic: a fold profile (segment / sequence-step simulation) forces
it even on a GPU machine.

Move `view` / `width` / `height` / `settings` off `GpuRenderState` and onto
`Session`, and let those two methods record them unconditionally, skipping only
the *redraw* when there is no `gpuRender`. A session knowing how it is being
looked at should not depend on which renderer happens to be attached — and it is
what lets `exportSvg` work on both paths from one code path.

The fallback renderer is orthographic, so pass `perspective: Boolean(gpuRender)`
to keep the SVG faithful to that machine's own screen.

### 5. UI

**Shared control** — `apps/web/src/simulator/SimulatorExportMenu.tsx`: a
`Download` `IconButton` opening a Radix `DropdownMenu` with SVG / PNG (PNG via
`svgToPng` from `lib/creaseExport.ts`, matching `FOLDED_FIGURE_EXPORT_FORMATS`).
Both surfaces mount the same component, which is what keeps them from drifting;
with two verbs and no context-menu or menu-bar surface, a React-free action
catalog (as `foldedFigureActions.ts` uses) would be more interface than the
thing it describes. If those surfaces ever want these verbs, that is the moment
to promote it.

**Save** — `apps/web/src/simulator/useSimulatorViewExport.ts`: takes the runtime
and a suggested name, returns `exportView(format)`. Its whole body is: ask the
runtime for the SVG string, rasterize if PNG, hand it to
`FileService.saveTextFile` / `saveBinaryFile` as `exportOristudioCpFoldedFigure`
does.

**Inline simulation window.** Add the menu to `InlineSimulationInspector.tsx`,
beside `ColorModeMenu` — whose own doc comment already anticipates "the export
control beside it".

The inspector cannot export directly: the runtime lives in
`InlineSimulationLayer`'s per-window component. Route it through
`inlineSimulation/inlineSimulationRuntime.ts`, the module that already exists for
the unserializable half of a window:

```ts
registerInlineSimulationExporter(id, (format) => Promise<boolean>): () => void
exportInlineSimulation(id, format): Promise<boolean>
```

The focused window registers its `exportView` in an effect; the inspector calls
`exportInlineSimulation`. This deliberately does not grow `CreasePatternPanel` —
per AGENTS.md the panel is a composition site.

**Simulate workspace.** The same menu in `SimulatorPanel.tsx`'s `panel-toolbar`,
right-aligned: one hook call and one element.

### 6. i18n

New strings in the `panels:` namespace, authored inline. Then
`npm run i18n:extract`, translate the new keys for all 8 locales,
`npm run i18n:stamp`, `npm run i18n:check`.

### Known limitation to state in the PR

A mean-depth painter's sort cannot order interpenetrating or mutually
overlapping triangles correctly, and a folded origami model is mostly stacked,
near-coplanar layers — so some exports will show a layer in the wrong order
where the GPU's per-pixel depth test gets it right. This is inherent to
projecting to flat vector polygons and is what the PDF describes ("*estimate*
the z ordering"). Worth measuring on a few real models before deciding whether a
per-face split (BSP) is ever warranted; it is not in this scope.

### Out of scope, found while planning: duplicated view wiring

`SimulatorPanel` and `InlineSimulationLayer`'s window each hand-assemble the same
runtime↔viewport pairing, and it has already drifted three ways:

- `READOUT_INTERVAL_MS = 66` is declared independently in both files
  (`SimulatorPanel.tsx:56`, `InlineSimulationLayer.tsx:56`);
- `viewportRef.current?.setModel(...)` is called by the panel and never by the
  window;
- `pushCamera` is passed straight through by the panel and wrapped in an
  empty-deps `useCallback` with an eslint-disable by the window.

There is no object for "a simulation view" — a solver session paired with the
surface showing it — so each surface re-derives one. A `useSimulatorView` hook
returning `{ runtime, viewportProps }` (spread straight into
`<SimulatorViewport>`) would give the frame→viewport hop and the readout throttle
one home. It touches the 60 fps frame path in both surfaces, so it wants its own
behaviour-preserving commit rather than riding along here.

## Affected Areas

| File | Change |
| --- | --- |
| `packages/origami-simulator/src/webgl/camera.ts` | `projectVertices` — CPU mirror of the vertex shader |
| `packages/origami-simulator/src/svgRenderer.ts` | **new** — `renderMeshToSvg`, sibling of `MeshRenderer` |
| `packages/origami-simulator/src/index.ts` | export both |
| `packages/origami-simulator/tests/camera.test.ts` | projection tests |
| `packages/origami-simulator/tests/svgRenderer.test.ts` | **new** |
| `apps/web/src/simulator/simulatorSession.ts` | view state onto `Session`; `exportSvg(token)` |
| `apps/web/src/simulator/simulatorSession.test.ts` | export on both render paths, stale token → null |
| `apps/web/src/simulator/useSimulatorRuntime.ts` | `exportSvg()` |
| `apps/web/src/simulator/useSimulatorViewExport.ts` | **new** — rasterize + save |
| `apps/web/src/simulator/SimulatorExportMenu.tsx` | **new** — shared dropdown |
| `apps/web/src/cp-workspace/inlineSimulation/inlineSimulationRuntime.ts` | exporter registry |
| `apps/web/src/cp-workspace/InlineSimulationLayer.tsx` | register the focused window's exporter |
| `apps/web/src/cp-workspace/InlineSimulationInspector.tsx` | the export dropdown |
| `apps/web/src/components/panels/SimulatorPanel.tsx` | the export dropdown |
| `apps/web/src/components/panels/SimulatorPanel.test.tsx` | export control present + wired |
| `apps/web/public/locales/*` | new `panels:` keys, 8 locales |

Untouched, deliberately: `SimulatorViewport` (no new handle methods — the worker
already has the camera), `canvas2dFrame.ts` (no palette extraction — colours come
from `RenderSettings`), and `exportGeometry` (STL/OBJ wants geometry, not a view).

## Checklist

- [x] `projectVertices` in `camera.ts`, with tests covering the perspective
      divide, the NDC→pixel mapping, `perspective: false`, and depth sign
- [x] Session records `view` / `width` / `height` / `settings` on both render
      paths; redraw still skipped without `gpuRender`
- [x] `renderMeshToSvg`: draw list, depth sort, faces, creases, x-ray, strain,
      degenerate-geometry guard, content-fit `viewBox`
- [x] `svgRenderer.test.ts`: deterministic SVG for a known two-triangle fold —
      document order follows depth, facet edges excluded, M/V/B stroke colours,
      `showFaces`/`showEdges`/`faceAlpha` respected, zero-area triangles
      dropped, no `NaN` in any emitted coordinate
- [x] `exportSvg` on the worker + runtime; stale token yields null
- [x] `useSimulatorViewExport` + `SimulatorExportMenu`
- [x] Inline: exporter registry, registration in `InlineSimulationLayer`,
      dropdown in `InlineSimulationInspector`
- [x] Simulate workspace: dropdown in `SimulatorPanel`'s toolbar
- [x] i18n: extract, translate 8 locales, stamp, check
- [ ] Verify the exported SVG against a screenshot of the same view on a real
      model (a bird base, and something dense like a box-pleated tessellation) —
      in particular that the two-tone winding constant is not inverted, since
      `gl_FrontFacing` and the CPU winding rule are only *expected* to agree
- [x] Validation: package build + vitest (164 pass), `npx tsc --noEmit`,
      web vitest (1409 pass), `npm run lint:web`, `npm run i18n:check`.
      Note `i18n:stamp` is only a workspace script — `npm --workspace
      @treemaker/web run i18n:stamp`, not `npm run i18n:stamp`

### Fidelity, after testing against real models

The first export was a depth sort, which the plan above assumed would do. It did
not, and each of these came out of comparing an export against the GPU view that
produced it rather than from reasoning about the code.

- [x] Winding read where `gl_FrontFacing` reads it — after the perspective warp,
      not in view space. Accounted for 1-7% of faces showing the wrong side
- [x] BSP in place of the sort. Interpenetrating faces and cyclic overlaps have
      no correct order at any precision, so cut the geometry until one exists:
      wrongly-ordered area fell from 0.97% to 0.002-0.034%
- [x] Cut in screen space carrying view depth, not in view space. The vertex
      shader's perspective is a per-vertex warp rather than a projective divide,
      so a straight segment in view space is not straight on screen and every
      cut visibly bent a crease
- [x] Creases biased toward the eye by the edge shader's own bias, so the nearer
      of the two faces a crease separates stops clipping it down the middle
- [x] Ink is not split by a plane it only grazes, and pieces shorter than a
      stroke width are dropped. Sub-2px crease pieces, which round caps drew as
      blobs beside the line, went from 48/41/42 across three views to none
- [x] Hidden pieces left out. A painter's order says what covers what, not what
      survives, so a fifth of the polygons were buried under other geometry:
      745/779/734 fell to 596/622/547, documents 18-23% smaller, with a pixel
      diff against the uncut drawing of 0.09% at a median delta of 2/255 and no
      differing cluster larger than edge speckle
- [x] A face drawn as one shape rather than as the pieces the pipeline made of
      it. 126 source faces reached the exporter as 254 triangles (only 28 were
      triangles to begin with) and left as 535 polygons, so an editor saw four
      shapes per face. Triangulation records its diagonals as facet edges, which
      is already how the renderer knows not to draw a crease there, so the
      grouping is a fact about the mesh rather than a coplanarity tolerance.
      Merging runs that are adjacent in the order — the only ones where nothing
      is drawn between — took 535/552/498 to 369/376/342, documents ~20% smaller.
      Pixel diff 0.27-0.49% at a median delta of 1/255, no solid differing
      cluster, only seven pixels in a page differing by 15 or more, and every one
      of those moves *toward* the saturated colour: they are interior seams
      disappearing, which is the artifact the face seam stroke exists to mask

### Why merging stops where it does

One polygon per crease-bounded region would be ~126 on that model, against the
369 we emit. Going further was built and measured, and then reverted; this is
what it found, so that it is not investigated twice.

Of the 430 remaining adjacencies, 144 have a crease drawn along them and 31 are
occlusion boundaries between clearly different colours — 175 that *should* stay
separate. The other 255 are the opportunity, and split in two:

- **135 have identical fill and no crease.** Blocked only by draw order. Merging
  regardless of order gives 243 polygons, so this is the whole prize.
- **98 have no crease and fills within 6/255** — two faces at very slightly
  different angles, which flat shading gives near-identical but unequal shades.
  Merging them means choosing one shade and diverging from the GPU view.

Reordering to capture the first group was implemented, with a separating-axis
test for whether anything drawn between two pieces would be painted over. It
reached 360 of a possible 243. Isolating the blockers: creases account for
360 -> 269 and faces for 269 -> 243, so creases are three quarters of it.

That is structural rather than a missing optimisation. A crease lies *on* the
face it separates and must draw over it, while the BSP scatters that face's
pieces to either side of it in the order. Merging the pieces forward paints over
the crease; merging them backward puts the face under creases belonging to
nearer layers. Neither is sound without knowing which crease belongs to which
region, which the draw list does not carry.

So ~150 lines and a SAT test bought 369 -> 360, and were reverted. Getting to one
polygon per region needs a different shape of solution — a real planar
arrangement of the drawing, or per-crease visibility so faces and creases can be
separated into two passes — not a better merge rule.
