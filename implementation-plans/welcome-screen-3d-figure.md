# Welcome-screen 3D folded figure

Replace the static crease-pattern PNG on the start screen with a live, slowly
rotating, drag-orbitable 3D render of the folded penguin — frozen geometry, no
solver at runtime, theme-reactive colours.

## Goal

The `/welcome` start screen currently shows `public/start/crease-pattern-preview.png`
inside a 320px square frame (`StartScreen.tsx:54-63`, `App.css:83-93`). Replace it
with the **folded 3D form** of the second (bottom) crease pattern in
`penguin_other_angles.osf`, subject to five constraints the request set:

1. **Actually 3D.** Real geometry with depth-tested faces, not a pre-baked image
   sequence or a video.
2. **Live rotation**, plus drag-to-orbit that turns the figure **about its
   vertical axis only** — yaw free, pitch effectively locked. Not a trackball.
3. **Not folded live.** The fold is computed once, offline, and committed as a
   static asset. No solver, no worker, no wasm on this route.
4. **Theme-reactive colours.** Paper and crease inks follow the app's theme
   tokens and update when the theme flips.
5. **Cheap, and not an architectural event.** It is a nice-to-have; it must not
   earn a subsystem.

**Verdict: feasible, and it is not a bad idea.** Every expensive part already
exists and is tested. The measurements below were taken by folding the real
model headlessly before this plan was written — see *Evidence*.

## Evidence

Measured, not estimated — by folding the real model and looking at real frames.

**The crease pattern stays out of the repository.** The bottom pattern of
`penguin_other_angles.osf` (120 vertices / 246 edges / 127 faces, `y ∈ [300, 700]`
— the region the file's own inline simulation is anchored to,
`sourceBounds.minY = 300`) is a third party's design. The generator therefore
reads the `.osf` from the **external** non-flat corpus, exactly as
`crates/oristudio-cp/tests/non_flat_corpus.rs` does, and **only the folded mesh
is committed**. See *Phase 0* — a copy of this CP is currently tracked as
`tests/fixtures/fold-angle-3d/penguin_freeform.fold` and has to come out first.

| Quantity | Measured |
| --- | --- |
| Exact folded state (`Fold3dSession`, solution 1 of 8) | **127 faces, 21 planes, 90 cells, 246 creases, 0 undetermined** |
| Frozen asset (`Folded3dRenderModel` + pose) | **90.8 KiB** raw, **16 KiB** gzip, **10.7 KiB** brotli |
| Lazy chunk it is drawn by | **16.2 KiB** (5.5 KiB gzip), and `MeshRenderer` is **not** in the entry chunk |
| Frame cost | one uniform change and one `drawElements` pair; no per-frame upload |

**The geometry is the kernel's exact fold, not a simulation of one.** The first
draft of this plan used the origami simulator relaxed to 100%, and that was
wrong: it settles a spring model *near* the target, so creases soften and the
paper never quite closes. `oristudio-cp`'s `Fold3dSession` — what the `G` key
runs — answers the same question exactly, and its `Folded3dRenderModel` is what
every other folded figure in the app is drawn from. Shipping anything else would
have made the start screen the one place showing a different answer.

**Two findings changed the design**, both from looking at real frames:

- A full 360° yaw sweep passes through angles where the form presents nearly
  edge-on and reads as a sliver. The auto-rotation is therefore a bounded eased
  sweep around a chosen pose, not a spin.
- At 320px, 246 creases in mountain-red and valley-blue read as noise over the
  form. The figure draws them in **mono** — one theme-derived ink — so the shape
  speaks. Colour stays the default where it is information (the Simulate
  workspace); here it is not.
- **Which way is up cannot be derived.** Settled with the tuner
  (`apps/web/start-figure-tuner.html`): drag, Bake, and it prints the
  `--orient` triple. The shipped figure is `--orient 3.1236,-0.35,1.5708
  --yaw 0 --pitch 0 --sweep 0.5`. `folded3dMesh` hands back the figure in
  the paper's frame, where the paper normal is vertical — right for an editor
  figure being looked down at, wrong for a hero that should stand. Three
  Three automatic guesses at the upright axis all failed against the eye: the
  principal axis (the model is a 110x106x52 slab with no dominant elongation),
  the most-protruding vertex, and a screen-aspect search over orientations. The
  mirror plane *is* computable (normal on the renderer's Y, 1.9% reflection
  mismatch), but it does not say which end is the head. So the orientation is a
  `--orient` argument chosen by eye and recorded, not something the script
  infers.

## Approach

### Why no new renderer is needed

`MeshRenderer` (`packages/origami-simulator/src/webgl/meshRenderer.ts`) already
draws a folded mesh **straight from a position texture** with a depth buffer,
two-tone paper, flat lighting, and a mountain/valley crease pass. It reads every
vertex via `texelFetch` on `u_originalPosition + u_lastPosition`, so a mesh whose
geometry never moves is written once and thereafter costs *a uniform change and
a draw*. `FoldedMeshSource` (`apps/web/src/simulator/foldedMeshSource.ts`) is
that exact pattern already in production for CP folded figures, including the
`packFolded3dPositionTexture` helper (`cp-workspace/folded/folded3dMesh.ts:518`)
and the zero-filled `u_lastPosition` / `u_lastVelocity` companions `bindCommon`
requires.

`FoldedMeshSource` takes an `OffscreenCanvas` because it lives in the worker.
`GlCore.create` is typed `HTMLCanvasElement | OffscreenCanvas`
(`glCore.ts:81`), so the same construction works on the main thread against a
plain `<canvas>`. That is the whole trick: **the welcome figure is a
`FoldedMeshSource` on the main thread with a static texture.**

And the geometry side is shared too: `folded3dMesh` (`cp-workspace/folded/`)
turns a `Folded3dRenderModel` into positions, a `MeshTopology` and a radius —
the triangulation, the layer displacement and the crease assignments an in-app
folded figure already gets. The start figure calls it rather than carrying a
private format, so the two are the same picture and not two that resemble each
other.

Everything else is already shared and already correct:

- `cameraUniforms(view, center, radius, w, h)` + `fitExtent` (`webgl/camera.ts`)
  — the same framing the simulator and the canvas-2D fallback use.
- `resolveSimulatorPaint(getComputedStyle(canvas), settings, surface)`
  (`simulator/simulatorPalette.ts:236`) — the **one** place a simulator colour is
  decided, reading `--sim-paper-front` / `--sim-paper-back` / `--text-primary`
  / `--bg-canvas`. This is the whole of requirement 4.
- `SIMULATOR_ORBIT_SENSITIVITY` and `normalizeAngle` (`lib/simulatorOrbit.ts`) —
  so a drag here feels like a drag on an inline simulation.
- The `creaseWidthReferenceEdge` / `creaseWidthShrinkExponent` surface options
  (`simulatorPalette.ts:31-42`) exist precisely for "a small object on someone
  else's canvas", which is what a 320px figure is.

Net new code is the asset, a generator script, a ~60-line pure orbit module, and
a ~150-line component. No new dependency, no new worker, no new store slice, no
kernel change.

### Phase 0 — Get the penguin CP out of the repository

**Blocking, and independent of everything below.** `tests/fixtures/fold-angle-3d/`
tracks two files derived from `plant/penguin_other_angles.osf` — a third party's
design — and its README asserts (wrongly) that every file there was authored by
the repository owner:

| File | Size | Source | |
| --- | --- | --- | --- |
| `penguin_freeform.fold` | 12.8 KB | `plant/penguin_other_angles.osf --component 0` | remove |
| `penguin_disconnected.fold` | 23.6 KB | `plant/penguin_other_angles.osf` | remove |
| `rabbit_unclosed.fold` | 9.2 KB | `plant/rabbit.osf` | remove — same `plant/` source |

**Decided:** all three come out. `rabbit_unclosed` is derived from the same
`plant/` folder of the external corpus, so it carries the same provenance
problem whatever the README claims.

They are load-bearing. Removing them is not a `git rm`:

- `verify_fold_fixtures.rs` — pins every column of all three rows.
- `folding3d.rs` — `penguin_freeform` is a named row; `penguin_disconnected` is
  the `DisconnectedFaceGraph` case; `rabbit_unclosed` is the closure-refusal case
  and the 70.53° cross-check.
- `folding3d_census.rs`, `folding3d_order.rs`, `folding3d_boundary.rs`,
  `folding3d_interchange.rs` — `penguin_freeform` is the multi-solution fixture
  (`MULTI_SOLUTION`, 8 solutions), the 457-pair census row, and the >100-face
  interchange case.
- `non_flat_corpus.rs::DERIVATIONS` — three rows re-derive them from the corpus.
- `src/folding3d/{placement,order,admit}.rs` and `src/folding3d.rs` — doc
  comments quoting their measurements; `placement.rs:1386` names a path.

The README argues each is irreplaceable: `penguin_freeform` is "the only clean
model in existence, committed or not, whose fold angles are genuinely free-form",
and `penguin_disconnected` the only naturally-authored clean-yet-unplaceable
negative. That is the real cost, and it is a coverage cost, not a mechanical one.

**Decided:** the orphaned assertions are **gated behind the external corpus**,
not deleted and not replaced with authored fixtures. The target already exists
and is well disciplined — `non_flat_corpus.rs` reaches external material through
`ORISTUDIO_NON_FLAT_CORPUS_DIR` with loud `SKIPPED:` reporting and an
`ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1` escalation for CI or a release check. So
the work is:

1. Delete the three `.fold` files.
2. Move every assertion that named them into the corpus-gated path, keyed on the
   source `.osf` rather than a committed derivative. The three
   `DERIVATIONS` rows go away with the files they re-derived.
3. Rewrite the README: the provenance and licence sections (which currently
   assert owner authorship for all nine files — that is the error being fixed),
   the fixture table, and the "what may be committed here" rule, which needs a
   test that catches this class of mistake rather than a paragraph asking people
   to be careful.
4. Rewrite the doc comments in `src/folding3d*.rs` that quote these models'
   measurements, so no shipped comment cites a number nobody can reproduce from a
   committed file.

Accept, and record in the README, that CI no longer covers the free-form-angle
positive, the disconnected negative, or the closure refusal. Authoring
replacements is worth a follow-up issue, not a blocker on this.

Everything below assumes this has happened, and depends on it in one place only:
the generator reads the `.osf` from the external corpus, never from `tests/`.

### Phase 1 — Choose the hero angle

The generator emits a contact sheet (yaw × pitch grid, depth-buffered, themed
colours) to the scratchpad. Pick from it:

- `heroYaw`, `heroPitch` — the resting orientation.
- `sweepRadians` — half-width of the auto-rotation, and the yaw band that reads
  well on both sides of the hero angle.

The file's own saved inline-simulation view is `yaw 0.785, pitch −0.955, zoom 1.4`
— a reasonable starting candidate, but it was chosen for a square inline window,
not a 320px hero frame, so confirm it against the sheet rather than adopting it.

This is a **decision, not an implementation step**, and every later phase depends
on it. It is cheap to redo — rerunning the generator with different angles costs
7 seconds.

### Phase 2 — Freeze the geometry

`scripts/generate-start-figure.mjs` is a pipeline, not a solver. It extracts the
pattern (reusing `osf-fold-projection.mjs`'s `readFoldDocument`, so component and
document selection cannot drift between two readers), hands it to the kernel, and
stores what comes back:

```sh
node scripts/generate-start-figure.mjs \
  --source "$CORPUS/plant/penguin_other_angles.osf" --component 0 \
  --yaw 1.55 --pitch -0.7 --sweep 0.45
```

The fold itself is `cargo run -p oristudio-cp --release --example
fold3d_render_model -- --source … --solution N`, which is the existing "one
command that emits a render model", extended to take an arbitrary pattern rather
than only its fixture set. `--solution` matters: a folded state can have several
layer orderings and this design has eight.

Reusability is the point — swapping the figure for a different design is the same
command with a different `--source` and `--out`, then one constant moved in
`startFigureAsset.ts`. Nothing in the app knows which model it is drawing.

Notes that matter:

- **This is the rendered result, not the crease pattern.** Folded coordinates,
  face rings, cell stacks and crease endpoints — nothing a CP viewer can open.
  The one honest caveat: the model carries the same edge graph with signed fold
  angles, so somebody determined could unfold it. If that needs closing off, the
  answer is a bare triangle soup, at the cost of all the linework.
- **`public/`, not a bundle import.** The asset is fetched, so it stays out of
  the JS chunk and a missing or malformed file degrades to the static image
  rather than failing the build.
- **A frozen artefact, not a build output.** CI does not regenerate it — the
  input is not available to CI at all, and the geometry is meant to be fixed. It
  is committed exactly as `og-default.png` is.

### Phase 3 — The orbit state machine (pure, tested)

`apps/web/src/components/start/startFigureOrbit.ts` — no React, no GL, no DOM:

```ts
export interface StartFigureOrbitState { yaw: number; pitch: number; mode: 'auto' | 'dragging' | 'resuming' }
export function advanceStartFigureOrbit(state, elapsedMs, config): StartFigureOrbitState
export function dragStartFigureOrbit(state, dx, dy, config): StartFigureOrbitState
```

Behaviour:

- **Auto:** an eased oscillation `heroYaw ± sweepRadians` (a sine, so it slows and
  reverses at the extremes rather than snapping). Not a 360° spin — see *Evidence*.
- **Drag:** yaw from horizontal movement at `SIMULATOR_ORBIT_SENSITIVITY`, imported
  from `lib/simulatorOrbit.ts` rather than re-declared. Pitch takes vertical
  movement but is **clamped to a narrow band** around `heroPitch` (start at
  ±0.25 rad), which is what "rotate around the sides, not in all directions"
  means in practice — it stays a turntable while still feeling alive.
- **Resume:** after release, hold, then ease back to the auto sweep from wherever
  the user left it (no snap).
- **Reduced motion:** `config.reducedMotion` freezes the auto sweep at the hero
  angle. Drag still works — the user asking for it is not motion they did not ask
  for.

This is where the unit tests go, because it is the only part with behaviour and
the only part testable without a GL context.

### Phase 4 — The figure component

`apps/web/src/components/start/StartFigure.tsx`, plus
`startFigureMesh.ts` for the GL lifetime (create / resize / draw / dispose).

Lifecycle:

1. Render the existing PNG immediately, as today. It is the first paint and the
   permanent fallback.
2. On mount, in `requestIdleCallback` (falling back to a timeout), **dynamically
   `import()`** the mesh module and fetch the asset. Deferring matters twice:
   `MeshRenderer` today only reaches the CP-workspace chunk, so a static import
   would move it into the welcome route's critical path; and the welcome screen
   is on screen precisely while the wasm engine is instantiating
   (`status === 'loading_engine'`), which is the worst moment to compete for the
   main thread.
3. `GlCore.create(canvas)` → three textures → `new MeshRenderer(core, topology)`.
   On any failure — no WebGL2, no `EXT_color_buffer_float` (which `GlCore`'s
   constructor throws on, `glCore.ts:65`), asset fetch failed — leave the PNG up
   and stop. Two states, not three; no canvas-2D third path for a decorative
   element.
4. `requestAnimationFrame` loop: advance the orbit, `cameraUniforms(...)`,
   `mesh.render(camera, renderSettings, null)`. One draw call pair per frame over
   189 triangles.
5. Stop the loop when the document is hidden, when the canvas leaves the viewport
   (`IntersectionObserver`), and on unmount. Dispose the context on unmount —
   the welcome route is entered and left repeatedly via File › New.
6. Handle `webglcontextlost` by falling back to the PNG rather than drawing a
   frozen or empty frame.

Colours: resolve once with `resolveSimulatorPaint(getComputedStyle(canvas), …)`
and re-resolve on theme change, copying the `MutationObserver` on
`document.documentElement` with `attributeFilter: ['class', 'data-theme']` that
`SimulatorViewport.tsx:405-419` already uses for exactly this. Hold the resolved
paint in a ref; never call `getComputedStyle` inside the frame loop.

Sizing: a `ResizeObserver` sets `canvas.width/height` to CSS size × DPR and
invalidates the cached camera. Never read `getBoundingClientRect` per frame — the
comment at `canvas2dFrame.ts:128-133` records why that was a real cost.

Pointer handling: `setPointerCapture` on down, `touch-action: none` on the canvas
so a vertical drag on mobile still scrolls the page rather than fighting it.
Reuse `foldedFigureOrbitGesture.ts`'s conventions if they fit; do not duplicate
its store wiring.

### Phase 5 — Wiring and polish

- `StartScreen.tsx` swaps the `<img>` for `<StartFigure />`, keeping the
  `aria-hidden="true"` wrapper. It stays decorative, so **no new i18n strings and
  no `i18n:extract` run** — confirm this rather than assuming it.
- `App.css`: the existing `.start-screen__preview-frame` (320px / 240px small)
  is the right size and stays. Add `cursor: grab` / `:active { cursor: grabbing }`
  and `touch-action: none` on the canvas.
- Analytics: one hand-placed `track` when the 3D path **declines** to start, with
  an enum `reason` (`'no-webgl2' | 'asset-failed' | 'context-lost'`). That is a
  genuine low-cardinality signal — how many users' machines cannot run any of the
  simulator's GPU paths — and it is not expressible at the `handleMenuAction`
  chokepoint. No event for the success case: a decorative element rendering is
  not a funnel step, and firing on every cold start would be noise.

### Phase 6 — Validation

Self-checkable, run before handoff:

```bash
npm run lint:web && npm run typecheck:web && npm run test:web
cargo test -p oristudio-cp          # Phase 0 touched its fixtures and tests
ORISTUDIO_NON_FLAT_CORPUS_DIR=… ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1 \
  cargo test -p oristudio-cp --test non_flat_corpus
ORISTUDIO_NON_FLAT_CORPUS_DIR=… node scripts/generate-start-figure.mjs   # byte-identical rerun
```

`npm run build:web` too, since a new `public/` asset and a dynamic import chunk
both affect the bundle — check that `MeshRenderer` did **not** land in the entry
chunk. Also `git grep -i penguin` over the tree: Phase 0 is only done when no
tracked file holds that geometry and no doc comment quotes a measurement that can
no longer be reproduced from a committed file.

Not self-checkable, and left as a browser checklist: the automated browser pane
runs at `visibilityState: hidden` with zero `requestAnimationFrame`, so the
animation itself cannot be verified there.

## Affected Areas

| Area | Change |
| --- | --- |
| `tests/fixtures/fold-angle-3d/penguin_*.fold` | **Deleted** (Phase 0), plus `rabbit_unclosed.fold` if it shares the provenance. |
| `tests/fixtures/fold-angle-3d/README.md` | Rewrite the provenance, licence and fixture-table sections around what is left. |
| `crates/oristudio-cp/tests/folding3d*.rs`, `verify_fold_fixtures.rs`, `non_flat_corpus.rs` | Re-home or drop every assertion on the removed fixtures. |
| `crates/oristudio-cp/src/folding3d*.rs` | Doc comments quoting the removed models' measurements. |
| `scripts/generate-start-figure.mjs` | **New.** Folds the **external** `.osf`, writes the asset + a contact sheet. |
| `apps/web/public/start/penguin-figure.json` | **New**, ~7 KiB. Frozen geometry. |
| `apps/web/public/start/crease-pattern-preview.png` | Unchanged — demoted to fallback. |
| `apps/web/src/components/start/StartFigure.tsx` | **New.** Canvas + GL lifecycle + pointer + theme. |
| `apps/web/src/components/start/startFigureMesh.ts` | **New.** Dynamically imported GL setup/draw/dispose. |
| `apps/web/src/components/start/startFigureOrbit.ts` | **New.** Pure orbit/auto-sweep state, unit-tested. |
| `apps/web/src/components/StartScreen.tsx` | Swap `<img>` for `<StartFigure />`. |
| `apps/web/src/App.css` | Cursor, `touch-action`, canvas sizing inside the existing frame. |
| `apps/web/src/analytics/` | One event name for the fallback reason. |
| `packages/origami-simulator` | **No change.** Everything needed is already exported. |
| wasm bridges, Tauri shell | **No change.** |

## Risks and open decisions

0. **Phase 0 costs real test coverage — accepted, not avoided.** The three
   fixtures carry roles the README argues nothing else can fill: the only
   free-form-angle positive, the only naturally-authored disconnected negative,
   the only closure refusal. Gating them behind `ORISTUDIO_NON_FLAT_CORPUS_DIR`
   means CI stops checking them, which is exactly the failure mode that file's
   header was written to prevent. A licensing decision overrides a testing one —
   the right order — but it must be recorded in the README rather than absorbed
   silently, and a follow-up issue should track authoring replacements.
1. **Readability across yaw** — measured and real: some yaw angles present the
   model nearly edge-on. Phase 1 exists to pick a hero angle and a bounded sweep
   that avoids them. If no window reads well, the honest fallbacks are a smaller
   sweep, a different pitch, or a slower rate — not a 360° spin.
2. **A second main-thread WebGL2 context.** The CP canvas is the other, and the
   two are never co-mounted (different routes). It is disposed on unmount. Worth
   naming because it is the only genuinely architectural line this crosses.
3. **Startup contention.** The figure initialises while the wasm engine loads.
   Mitigated by the idle deferral in Phase 4; if a startup regression shows up,
   gate initialisation on `engineReady` instead.
4. **Bundle drift.** The dynamic import keeps `MeshRenderer` out of the entry
   chunk *if* nothing else pulls it in. Verify in Phase 6 rather than trusting it.
5. **The asset is hand-regenerated.** Same contract as `og-default.png`. If the
   fixture or `prepareFoldModel` ever changes, the asset silently keeps the old
   geometry — acceptable, since it is a decoration, and the integrity test still
   catches corruption. Do not add it to CI.

## Checklist

- [x] Phase 0 — scope settled: remove all three `plant/`-derived fixtures; gate the orphaned assertions behind the external corpus
- [x] Phase 0 — delete `penguin_freeform.fold`, `penguin_disconnected.fold`, `rabbit_unclosed.fold`
- [x] Phase 0 — move every assertion that named them behind `ORISTUDIO_NON_FLAT_CORPUS_DIR`; drop their `DERIVATIONS` rows
- [x] Phase 0 — rewrite the doc comments in `src/folding3d*.rs` that quote their measurements
- [x] Phase 0 — rewrite the fixture README: provenance, licence, table, and the commit rule (with a test, not a paragraph)
- [x] Phase 0 — record the lost CI coverage in the README; open a follow-up issue for authored replacements
- [x] Phase 0 — `cargo test -p oristudio-cp` green; `git grep -i penguin` clean of tracked geometry
- [x] Phase 1 — generate the contact sheet; choose `heroYaw`, `heroPitch`, `sweepRadians`
- [x] Phase 2 — `scripts/generate-start-figure.mjs`, reading the external corpus, refusing loudly without it
- [x] Phase 2 — commit `apps/web/public/start/penguin-figure.json`
- [x] Phase 2 — asset shape check (`parseStartFigureAsset`) — deliberately shallow: the kernel's `Folded3dRenderModel::validate` already re-derived every offset and face id before the file was written, and `folded3dMesh` re-reads the arrays on the way to the GPU. What this catches is a file that is not the asset at all
- [x] Phase 3 — `startFigureOrbit.ts` with auto-sweep, clamped drag, resume, reduced-motion
- [x] Phase 3 — unit tests for each of those four behaviours
- [x] Phase 4 — `startFigureMesh.ts`: create / resize / draw / dispose, context-loss handling
- [x] Phase 4 — `StartFigure.tsx`: idle-deferred dynamic import, PNG fallback, rAF loop gated on visibility + intersection
- [x] Phase 4 — theme `MutationObserver`, paint held in a ref, no `getComputedStyle` per frame
- [x] Phase 4 — pointer capture, `touch-action: none`, yaw-dominant drag
- [x] Phase 5 — `StartScreen.tsx` swap; confirm no new i18n strings
- [x] Phase 5 — CSS: cursor, touch-action, DPR sizing in the existing 320px frame
- [x] Phase 5 — fallback analytics event with enum `reason`
- [x] Phase 6 — `lint:web`, `typecheck:web`, `test:web`, `build:web`; confirm `MeshRenderer` is not in the entry chunk
- [x] Phase 6 — `MeshRenderer` confirmed absent from the entry chunk (`startFigureMesh-*.js`, 16.2 KiB, holds the shaders)
- [x] Phase 6 — theme reactivity verified live: moving `--sim-paper-front` / `--text-primary` and tripping `data-theme` recolours the figure
- [ ] Phase 6 — browser checklist handed over (below)

### Browser checklist (author-verified)

- [ ] Figure appears on `/welcome` and rotates smoothly; no jank while the engine loads
- [ ] Drag turns it about its vertical axis; vertical drag barely tilts it
- [ ] Auto-rotation resumes after release without snapping
- [ ] Theme toggle recolours paper and creases immediately
- [ ] Leaving and re-entering `/welcome` (File › New) does not leak a context or degrade
- [ ] Backgrounding the tab stops the loop (no CPU burn)
- [ ] "Reduce motion" freezes the sweep but leaves drag working
- [ ] Desktop (Tauri/WKWebView) renders it, or falls back cleanly to the PNG
