# A 3D folded figure as a rendered viewport

## Goal

Four separate complaints about the 3D folded figure turn out to be one:

1. Orbiting stutters; it needs to hold 60 fps.
2. Zoom, with a visible border and clipping, the way an inline simulation has.
3. Lighting and shading like the inline simulator's.
4. A reopened figure is inert — it cannot be turned at all.

The first three are asking for the thing an inline simulation already is: **a
GPU-rendered viewport in its own window**. So this replaces the 3D figure's
render path with the simulator's mesh renderer, hosted in a canvas-object window
that joins the existing shared-canvas architecture. Orbit becomes a camera
uniform; border and clipping come from the DOM; lighting comes from the shader.

The fourth is separate and cheap, and is fixed here too (§6).

**The flat folded figure does not change.** Not its renderer, not its output, not
how it is drawn. It stays exactly as it is today.

## Why the current path cannot get there

`projectFolded3dModel` runs on **every orbit frame**: `earcut` over every cell
ring, a BSP build over every item, `findVisiblePieces` — a software rasteriser at
4 samples per unit — then `coplanarRuns`, and finally `cpFoldedToScene`
re-triangulates the whole primitive stream, because its cache is keyed on
snapshot identity and each re-projection makes a new snapshot.

Two of those are avoidable by caching (the BSP is built in world space with
`edgeInk: 0`, so one tree serves any viewpoint) and the rest are not. It is the
wrong shape for a per-frame path, and tuning it would still leave no clipping, no
border, and the flat shading it has now.

## The crux: a z-buffer that can draw coplanar layers

The obvious objection to rendering with the mesh renderer is that **a depth
buffer cannot draw a flat stack**. Its layers are exactly coplanar — same z — so
they z-fight. That is why ORIPA keeps an overlap matrix, and why this repo grew a
painter-index depth attribute instead. The simulator escapes it only because it
is mass-spring and its layers are never exactly coincident.

We have something ORIPA does not: **the kernel computes the layer order.** So
displace each face along its plane's normal by `stack index × ε` when building
the mesh. The z-buffer then resolves the stack correctly, and depth, lighting and
60 fps all come with it.

`ε` scales with model size (a fraction of `modelRadius`) rather than being
absolute, so it behaves the same on a 40-unit box and a 400-unit sheet. It is a
real behavioural change — exact painter order becomes epsilon-separated layers,
which can shimmer at extreme zoom — and the number is expected to be tuned once
seen. **Cells whose order is undetermined get no displacement**; they keep the
translucent treatment they have now, which is still the honest answer.

Two bounds hold ε in place, and both were worked out against the shipped
uniforms rather than guessed:

- *Below*, the depth buffer must resolve one gap. `depthRange = 2r` and the
  shader writes `ndcZ = −depth/depthRange`, so the model occupies **half** the
  buffer: a world gap `d` is `d/(4r)` of it. At `2e-4·r` that is 839 units of a
  24-bit buffer.
- *Above*, the edge pass biases creases toward the viewer by a fixed `−0.0008`
  NDC, which is `1.6e-3·r` of world depth. A stack spanning more than that
  swallows its own top layer's creases, so the total span is capped at half of
  it and ε shrinks past 5 layers.

The committed fixtures reach 5 layers, but the external non-flat corpus reaches
**14** (`plant_penguin.osf`), with `cross`, `helloworld` and `origamisimulator`
at 10 — so the cap is the normal case, not the exotic one. At 14 the gap is 258
units of a 24-bit buffer and **1.01 of a 16-bit one**. A 16-bit default
framebuffer is legal WebGL2, so §3 must query `gl.getParameter(gl.DEPTH_BITS)`
with the default framebuffer bound (it reports the *bound* one, and 0 for the
solver's depthless FBOs) and fail loudly rather than as unexplained shimmer.

## Approach

### 1. Camera out of the store descriptor — first, and independently valuable

`setOristudioCpFolded3dCamera` writes to the store on **every pointermove** of an
orbit. That produces a new `oristudioCpFoldedFigures` array, which invalidates
`staleFoldedFigureIds`, `foldedFigureObjects` and `canvasObjects`, and re-renders
the crease-pattern panel.

This is Cause 2 of [`inline-simulation-performance.md`](inline-simulation-performance.md)
exactly — a per-frame transport field sharing an object with provenance — which
cost 901 ms of main-thread time and produced the visible stutters there. The
architecture already has the seam: `inlineSimulationRuntime.ts` is a side table
outside the store, and its own doc states the rule this breaks.

So the live camera moves to a side table keyed by figure id, and the store keeps
only what would be written to disk. The stored camera is written **once, on
release**, which is also where the single undo entry already lands.

Worth doing even if the rest of this plan were abandoned.

Two details the sketch above did not settle, decided while building it:

- The side table carries the **projected picture beside the camera**, not the
  camera alone. Phase 1 still draws through the CPU projector, and the
  projection has to happen somewhere; the pointer-move handler is where it
  happens today, and moving it into a render pass would put `earcut` plus a BSP
  build inside React's commit. The `snapshot` field goes away when the mesh
  takes over the live path (§3-4); the camera is the part that is transport.
- The re-projection itself moved out of `creasePatternSlice` into
  `folded/folded3dReproject.ts`, because the store path (release) and the orbit
  path (per move) must produce the *same* picture or the figure jumps when the
  drag ends. One module rather than two copies.

The frame reaches the canvas through `useFolded3dOrbitFigures`, subscribed in
`CreasePatternWebglCanvas` rather than in the panel — waking the panel to deliver
it would hand back exactly the memo invalidation this removes. The canvas's
single `scene` memo was split into three (`strokeGeometry`, `pointGeometry`,
`foldedGeometry`) and uploaded through the renderer's existing per-channel
setters, because merged it rebuilt every crease in the document on every orbit
frame; `CpRenderer.setScene` had no other caller and is gone.

### 2. The mesh

A new module turns the kernel's `OristudioCpFolded3dRenderModel` into what
`MeshRenderer` takes:

```ts
// apps/web/src/cp-workspace/folded/folded3dMesh.ts
export function folded3dMesh(model: OristudioCpFolded3dRenderModel):
  | { kind: 'mesh'; mesh: Folded3dMesh }
  | { kind: 'too-large'; vertexCount: number; limit: number };
```

Two refinements the sketch above did not have, decided while building it:

- `positions` comes back **tight** (3 floats per vertex, renderer basis,
  centroid-relative), with a separate `packFolded3dPositionTexture(positions,
  dim)` for the RGBA texture layout. Tight-first because that same array is what
  `projectVertices` takes — the shader's maintained CPU mirror, so the tests are
  the shader's own arithmetic — and what `renderMeshToSvg` takes, which is §6's
  vector export and R7's "both derive from the same render model" for free.
- Too large is a **result**, not a throw. A figure that cannot be meshed must
  still draw, and the caller already has that path: the stored `renderSnapshot`.

Three things it must get right:

- **The displacement** (above), per face, from `cell_stack`.
- **Triangulation** of each cell ring, in the plane's own `(u, v)` frame — never
  a locally re-derived one, because a different tangent gives a different
  chirality and every stack read off the projected winding comes out reversed.
  `folded3dBspItems` already does this and is the reference.
- **Edge assignments**, from `edge_attr`'s `kind` plus `edge_fold_degrees`' sign,
  so mountains and valleys read distinctly — the same codes the simulator uses.

`MeshRenderer` reads vertices from a **position texture** the solver normally
writes. A folded figure has no solver, so the positions are packed once into a
texture of the same layout at build time and never touched again. That is the
whole reason this is cheap: after upload, a frame is a uniform change and a draw.

### 3. The window

A fourth canvas-object kind, alongside reference images, text and inline
simulations. `TransformableCanvasObject` is already the shared contract and
`foldedFigureAsTransformable` is already a 12-line adapter.

Everything below is **reuse of the inline-simulation architecture**, not new
work, and each item is there because that plan measured what happens without it:

- **One shared WebGL context in the worker.** Browsers cap contexts at four per
  worker; this is not incidental.
- **A grow-only, capped *and* quantised drawing buffer**, each window drawn into
  its own `gl.viewport` and cropped out with `createImageBitmap`. Capping without
  quantising still reallocates every frame; quantising without capping walks into
  a silent driver clamp where `createImageBitmap` returns transparent and, being
  grow-only, never recovers. Quantise the **canvas**, never the viewport —
  per-axis quantisation broke aspect ratio by 98%.
- **Position and scale by CSS `transform`, never `left/top/width/height`.** At
  twenty windows this was *the* bottleneck: no thread saturated, 206 frames
  dropped, because layout writes woke every canvas's `ResizeObserver`, which
  asked for a fresh render — 640 bitmaps a second. A transform provably does not
  change the layout box.
- **Re-render on settle**, bounded by the existing unsettled-upscale cap so a
  slow continuous zoom cannot stay soft indefinitely.
- **One constant for the cap.** Two constants held equal by a comment is how
  windows silently evict each other.

**A folded figure is cheaper than a simulation**, and the plan should exploit it:
a simulation needs a live *solver session*, which is what the residency cap is
for. A folded figure needs only a *mesh* — uploaded once, drawn per frame. Tens
of figures is a memory question, not a session one, and the session cap does not
apply.

It is not *free*, though, and Phase 3 found the cost: a `MeshRenderer` links two
programs in its constructor and each figure holds three RGBA32F textures at its
own texture dimension. So the meshes get their own registry with its own cap
(`MAX_LIVE_FOLDED_MESHES`), and that second constant is safe precisely where a
second *window* constant would not be: evicting a session destroys the fold
position the user scrubbed to, so the UI has to refuse past the cap, whereas a
mesh is derived entirely from a render model the main thread still holds. There
is nothing for a second number to be held equal to — the failure the
inline-simulation plan records is not reachable here.

Border and clipping come from the window being a DOM element with a
`borderRadius` and `overflow`, exactly as the inline simulation's does.

### 4. Zoom

Wired to behave exactly as an inline simulation's, including settle-based
re-render at the new scale. Note there are two scales and they stay distinct: the
**camera** zoom (the model gets bigger inside a fixed window) and the window's
own size (the canvas handles, `FoldedFigurePlacement`). Scroll is the camera, the
handles are the window — the same split the inline simulation has.

### 5. Export — match the simulator

The 3D figure gets the simulator's export story: raster from the window, and
vector through the simulator's own `svgRenderer` + BSP path, which exists.

So `foldedFigure3dProjection.ts` **stays, as an export-only path**. It is no
longer on the per-frame path, which is what it was never suited to; it remains
the thing that can produce a correct back-to-front vector drawing without a depth
buffer, which is precisely what SVG needs.

### 6. Rehydrating a reopened figure

A reopened 3D figure is not blank — it draws its stored `renderSnapshot`, a
correct picture. What it lacks is the render model, which is deliberately not
persisted (~235 KB of packed arrays per figure, into pretty-printed JSON). So the
job is not "load something", it is "make an existing picture live".

`foldedFigureStaleness` already answers whether the crease pattern still matches,
and that splits the behaviour cleanly:

- **Not stale** — rehydrate in the background, after first paint, on idle, one
  figure at a time. Nothing changes visually, because the refold reproduces the
  same picture. Start-up is untouched because it is off the critical path. A
  press before it is ready rehydrates that figure on demand with a pending state.
- **Stale** — leave it alone. Refolding would silently change what you are
  looking at. Today's behaviour stands: the stored picture, plus the **Refold**
  verb that already exists.

Nothing ever changes under the user without a press, and app start pays nothing.

## Affected Areas

- `apps/web/src/cp-workspace/folded/folded3dMesh.ts` (new) + tests
- `apps/web/src/cp-workspace/folded/folded3dRuntime.ts` (new) — the camera side
  table, mirroring `inlineSimulationRuntime.ts`
- `apps/web/src/cp-workspace/folded/folded3dReproject.ts` (new) — the 3D
  projection, lifted out of the store slice so the orbit path shares it
- `apps/web/src/cp-workspace/folded/useFolded3dOrbitFigures.ts` (new) — the
  drawing path's subscription to the side table
- `apps/web/src/cp-workspace/folded/useFoldedFigures.ts` — orbit writes the side
  table; the store write moves to release
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — creases, points and
  folded figures memoized and uploaded apart
- `apps/web/src/cp-workspace/renderer/` — `setScene` removed; the per-channel
  setters are the only upload path
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — camera out
  of the descriptor; rehydrate action
- The inline-simulation window layer and worker session — generalised from "a
  simulation" to "a rendered viewport", so both kinds share one canvas, one cap
  and one crop path
- `apps/web/src/cp-workspace/CanvasObjectOverlay.tsx` — a fourth kind
- `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` — stops receiving 3D
  figures; flat unchanged
- `packages/origami-simulator/src/webgl/meshRenderer.ts` — read only, if possible
- `docs/analytics.md`, `PORTING.md` (the render path moves; the seam note updates)

## Non-goals

- **The flat folded figure.** Unchanged, in every respect.
- **The orbit up-axis / reorientation.** Its own PR, deliberately after this —
  it is a shared orbit concern and is easier once both surfaces render the same
  way.
- **Cast shadows.** The simulator's look is diffuse shading
  (`max(0, dot(n, lightDir))`, clamped), not a light and a ground plane. This
  matches that.
- **Persisting the render model.**
- **Removing `foldedFigure3dProjection.ts`.** It becomes the export path (§5).

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | ε displacement shimmers, or is visible as separation at high zoom | Scales with `modelRadius`; a single constant, expected to be tuned on sight. Golden test that layer *order* on screen matches the kernel's at several zooms |
| R2 | Undetermined cells have no order to displace by | Excluded from displacement, and emitted last so they can be drawn separately. **Keeping the translucent treatment is not free** — `faceAlpha` is one uniform and `render` unconditionally clears, so a second pass needs an additive change to `meshRenderer.ts`. Open at the §2/§3 boundary; see below |
| R3 | Tens of windows re-introduce the layout/ResizeObserver storm | `transform` only, and a test that a camera frame writes no layout-affecting property. This is the failure that survived every other fix in the inline-sim work |
| R4 | The shared drawing buffer blanks under a driver clamp | Cap **and** quantise, both; the inline-sim plan records what each alone fails to prevent |
| R5 | Rehydrating on load costs start-up time | Off the critical path, post-paint, idle, one at a time, and only for non-stale figures. Measure app start before and after |
| R6 | Two render paths for one figure kind drift | The projector's only remaining caller is export; a test asserts no live path reaches it |
| R7 | Vector export quality regresses because the mesh and the projector disagree | Both derive from the same render model; a test folds one fixture and asserts the exported SVG's face count matches the mesh's |
| R8 | The flat figure is disturbed | It does not share the new path. Its existing golden tests are the gate |

## Checklist

### Phase 1 — Camera out of the store (independent, ships alone)
- [x] `folded3dRuntime.ts` side table; live camera leaves the descriptor
- [x] Orbit writes the side table per move, the store once on release
- [x] Invariant test: an orbit frame does not invalidate a document-derived memo
      (`folded/orbitIsNotDocumentState.test.tsx`, which asserts the figures array
      identity, the derived memos' identity, and the surface's render count —
      and a companion case proving the frame still reaches the drawing path, so
      the first cannot pass for an orbit that does nothing)
- [x] Re-measure the panel render count during a drag: the count is now asserted
      rather than measured by hand — twenty orbit moves produce **zero**
      re-renders of the binding layer, where each one previously produced one.
      Frame timing itself still needs the production-build browser pass in §4

### Phase 2 — The mesh
- [x] `folded3dMesh.ts`: positions, topology, edge assignments. The decode
      helpers both it and the projector need moved to `folded3dModelReader.ts`
      first, so `modelRadius` is *the same number* the figure's frame is sized
      from rather than a second copy of the formula
- [x] Displacement by `stack index × ε`, ε from `modelRadius`; undetermined cells
      excluded and emitted last, with the split point reported
- [x] Triangulate in the plane's own `(u, v)` frame, matching `folded3dBspItems`
- [x] Tests against the committed render-model fixtures, including `strip_coupled`
      (coupled planes) and `pinwheel_cyclic` (a cyclic order, which must not be
      sorted)
- [x] Golden: on-screen layer order matches the kernel's `cell_stack`, at five
      cameras, plus the stronger statement that it matches the layer the CPU
      projector already draws (R6 stated as an assertion)
- [x] Winding: every triangle is coloured the side the projector colours it.
      Verified numerically, not reasoned — the view transform has determinant
      −1, so a normal pointing *at* the eye is drawn **back**-facing

The drawable unit is a **(cell, stack slot) pair**, not a face. A per-face scalar
height would be exactly a topological sort of the face partial order, which
`pinwheel_cyclic` makes impossible; per-cell displacement needs no global order,
so a cyclic model works by construction. Substituting a per-face height fails 24
of the 87 tests, including the cyclic one.

One consequence worth writing down before §3 draws anything: the folded figure's
front/back convention is the **opposite** of an inline simulation's on the same
physical surface. The simulator lifts FOLD faces with `[x, 0, y]`, itself a
determinant −1 map, which puts its right-hand normals on the paper's FOLD-front;
the folded figure must match `foldedFigure3dProjection.ts`, which is the flat/3D
parity non-negotiable. Both viewports on screen at once will disagree about which
tone is "front", and that is by choice.

### Phase 3 — The window
- [x] Generalise the simulation window to a rendered viewport; one shared context,
      one cap constant, grow-only + capped + quantised buffer, `createImageBitmap`
      crop with the Y-flip. The seam is one line: `renderGpu`'s parameter widens
      from `WebglSolver` to `{ drawingBufferSize; render }`, which `WebglSolver`
      already satisfies. Everything below it is reused unchanged
- [x] Folded figure as a fourth canvas-object kind — `Folded3dWindowLayer`, from
      the same `TransformableCanvasObject` box the overlay already consumes
- [x] Position and scale by `transform`; `Folded3dWindowLayer.test.tsx` asserts
      that a camera frame leaves every layout-affecting property byte-identical
      while the transform changes, for a pan and for a zoom
- [x] Border and clipping from the window (`.cp-folded-figure-window`)
- [ ] Verify the context budget with tens of figures open — needs a browser

Five things Phase 3 settled that the plan did not, each because the code forced
the question:

- **R2 is resolved by option (b)**, the one Phase 2 recommended: two strictly
  additive options on `MeshRenderer.render` — `clear` and `faceRange` — so the
  cells the solver could not order draw in a second, translucent pass. Every
  existing caller passes nothing and issues a byte-identical command stream, and
  a test asserts exactly that. Without it the one corpus model that has
  undetermined cells (`airplane.fold`, 33 of 37) is 89% z-fighting.
- **The mesh camera is orthographic**, applied inside `FoldedMeshSource` so the
  simulation keeps its perspective. `folded3dFrameRadius`'s guarantee — a
  bounding sphere images to the same circle at every orientation, so the frame
  never changes under orbit — is *only* true orthographically; under the
  simulator's one-point perspective a near point grows 45% and the model escapes
  its own frame.
- **The window cancels `fitExtent`'s padding** (`folded3dFrameFillZoom`). A
  figure's frame is already exactly the model's size, so leaving the viewport's
  8%-a-side padding in would draw every existing 3D figure ~16% smaller in the
  same box — a visible change nobody asked for. Derived from `fitExtent` rather
  than from its constant.
- **The window takes no pointer events.** The press rules are therefore
  unchanged rather than re-implemented: the shared overlay still owns selection
  and transform, and the crease-pattern canvas still owns the orbit. Moving the
  gesture into the window is §4's decision, not a side effect of §3.
- **3D figures now stack above text and images, and above flat figures.** They
  left the WebGL scene (z 5) for a DOM layer (z 7) while flat figures stay in
  the scene — forced by the move and by "the flat figure does not change", and
  user-visible where two figures overlap.

One condition decides all three places a windowed figure is treated specially —
`canWindowFolded3dFigure`: it is 3D, WebGL2 is available, its render model is
still in memory, it has a `frameRadius`, and it is inside the vertex budget. The
layer mounts exactly these, the canvas stops drawing exactly these, and the
orbit gesture stops re-projecting exactly these. Anything else keeps today's
path in full. The `frameRadius` condition is not incidental: without a frame the
box is the last projection's bounds, which change every orbit frame — harmless
as scene chrome, a per-frame layout write as a window.

### Phase 4 — Camera and interaction
- [ ] Orbit drives the mesh camera; the CPU projection leaves the live path
- [ ] Zoom exactly as the inline simulation's, settle-based re-render
- [ ] Focus, blur and the press rules unchanged from today
- [ ] Frame time measured with 1, 10 and 30 figures, in a **production** build
      with DevTools closed — a dev build has misled twice in this repo

### Phase 5 — Rehydrate
- [ ] Background rehydrate for non-stale figures, post-paint, idle, one at a time
- [ ] On-demand rehydrate when a figure is pressed first, with a pending state
- [ ] Stale figures untouched; **Refold** stays the explicit path
- [ ] App-start timing before and after

### Phase 6 — Export and cleanup
- [ ] Raster export from the window; vector through the simulator's SVG path
- [ ] `foldedFigure3dProjection.ts` reachable only from export; test that asserts it
- [ ] `PORTING.md` updated: the 3D render path moved, the flat one did not
- [ ] Analytics for orbit and zoom, enums and bucketed numbers only

### Validation
- [ ] `npx tsc --noEmit`, `npx vitest run`, `npx eslint .`
- [ ] `npm run i18n:check`, `npm run check:desktop`, `npm run build:web`
      (restore `apps/web/dist/.gitkeep`)
- [ ] `cargo test --workspace` — expected to be a no-op; no kernel change is
      planned
- [ ] Browser checklist: orbit at 60 fps with tens of figures, zoom, border and
      clipping, lighting, reopen-and-turn, flat figures visually unchanged
