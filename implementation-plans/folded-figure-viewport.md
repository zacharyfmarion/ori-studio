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
export function folded3dMesh(model: OristudioCpFolded3dRenderModel): {
  positions: Float32Array;   // packed for the position texture
  topology: MeshTopology;    // faceIndices, edgeIndices, edgeAssignments, textureDim
};
```

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
| R2 | Undetermined cells have no order to displace by | They keep the translucent treatment they have now, and are excluded from displacement — the honest answer either way |
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
- [ ] `folded3dMesh.ts`: positions, topology, edge assignments
- [ ] Displacement by `stack index × ε`, ε from `modelRadius`; undetermined cells
      excluded
- [ ] Triangulate in the plane's own `(u, v)` frame, matching `folded3dBspItems`
- [ ] Tests against the committed render-model fixtures, including `strip_coupled`
      (coupled planes) and `pinwheel_cyclic` (a cyclic order, which must not be
      sorted)
- [ ] Golden: on-screen layer order matches the kernel's `cell_stack`

### Phase 3 — The window
- [ ] Generalise the simulation window to a rendered viewport; one shared context,
      one cap constant, grow-only + capped + quantised buffer, `createImageBitmap`
      crop with the Y-flip
- [ ] Folded figure as a fourth canvas-object kind
- [ ] Position and scale by `transform`; test that no layout property is written
      per frame
- [ ] Border and clipping from the window
- [ ] Verify the context budget with tens of figures open

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
