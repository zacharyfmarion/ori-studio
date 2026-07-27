# Inline Simulation Windows

## Goal

A "Simulate inline" action on the crease-pattern selection toolbar that creates a
draggable, resizable window **on the Edit canvas**, running the existing origami
simulator on the selected sub-pattern. Click into a window to focus it; drag to
orbit; play, pause and scrub from its own floating controls and from the keyboard
while focused.

Feasibility analysis, measurements, and the rejected multi-session architecture
are in
[research/2026-07-26-inline-simulation-feasibility.md](../research/2026-07-26-inline-simulation-feasibility.md).

### Adopted constraints

These are load-bearing — most of the plan's simplicity follows from them.

- **One window plays at a time.** Idle windows hold their last frame. A converged
  clock spends no budget and the runtime's rAF loop skips entirely when
  `convergedRef && !playing`, so an idle window costs nothing.
- **GPU, uniform fold, one segment only.** No fold profiles, no sequence-step
  simulation, no canvas-2D fallback inline — each of those routes to
  `ReferenceSolver` and the ~800-line software rasterizer, and admitting any of
  them roughly doubles the surface. They stay in the Simulate workspace.
- **Not persisted in v1.** A window is a scratch tool, not document content.
  Persistence is Phase 7 and is deliberately optional.

## Approach

### Data model — the rule that makes deferring persistence free

Split the model in two from day one and never let them merge:

```ts
// Plain, JSON-serializable descriptor. Lives in a store slice.
// This is exactly what Phase 7 would write to disk — nothing more.
interface InlineSimulation {
  id: string;
  box: AnnotationBox;       // center / width / height / rotation, model space
  z: number;
  view: OrbitView;          // yaw / pitch / zoom
  foldPercent: number;

  // Provenance. See "Staleness and identity".
  sourceBoundary: Point[][] | null;          // region rings — the durable identity
  sourceBounds: FoldedSourceBounds | null;   // prefilter + reselect key
  sourceFingerprint: string | null;          // foldable lines within bounds

  // Fast-path hint, valid only within one segmentation. NEVER the durable
  // reference: `segmentFoldDocument` sorts regions into reading order and
  // reassigns `id = index` on every recompute, so ids renumber whenever an edit
  // adds or removes a region (creasePatternSegmentation.ts:168-171).
  segmentIdHint: number | null;
}

// Runtime-only side table, keyed by id. Never serialized, never in the store.
interface InlineSimulationRuntime {
  fold: FoldDocument;       // the captured segment fold
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}
```

`AnnotationBox`, `OrbitView`, `Point[][]` and `FoldedSourceBounds` are all plain
data, so the descriptor is serializable by construction. **No `ImageBitmap`, no
worker handles, no callbacks, no `FoldDocument` in the descriptor.** If that rule
holds, Phase 7 is "write this array on save, read it on load, rebuild the side
table" — additive, not a refactor.

Two routes exist for Phase 7, both cheap:

- `NativeProjectBaseDocumentV1.extensions` is a per-document `Record<string,
  unknown>` round-tripped on save
  ([nativeProjectFile.ts:57](../apps/web/src/lib/nativeProjectFile.ts#L57), read
  back at L649/664) — so persistence can ship with **no schema bump** under an
  `inlineSimulations` key.
- Or a `schemaVersion: 5` field beside `images` / `textAnnotations`, matching how
  the other superset features landed.

Decide in Phase 7, not now.

### Staleness and identity

`lib/foldedFigureStaleness.ts` (merged in `c4dc8e92` / `0b3b1ea6`) already solves
staleness for folded figures. Inline simulations reuse that mechanism rather than
inventing a second answer, and add one layer that folded figures do not need.

#### The mechanism

Provenance is an axis-aligned bounding box of the source creases plus an
order-independent fingerprint of that crease set. Staleness is **derived on
demand**: reselect the foldable-coloured lines overlapping the box, fingerprint
them, compare. Nothing is stamped during an edit, so there is no invalidation
bookkeeping to get wrong.

Everything needed is already exported and already generic — `foldedSourceBounds`,
`segmentOverlapsBounds`, `reselectFoldableLineIds`, `cpLinesByIds`,
`foldedSourceFingerprint`. Only `isFoldedFigureStale` is figure-specific, so
inline simulations need **no refactor of that module**, just a sibling:

```ts
export function isInlineSimulationStale(
  document: OristudioCpDocumentSnapshot | null | undefined,
  sim: InlineSimulation
): boolean {
  if (!document) return false;
  if (sim.sourceBounds == null || sim.sourceFingerprint == null) return false;
  const ids = reselectFoldableLineIds(document, sim.sourceBounds);
  return foldedSourceFingerprint(cpLinesByIds(document, ids)) !== sim.sourceFingerprint;
}
```

Missing provenance reads as **not** stale — the same "we cannot tell, so stay
quiet" rule `isFoldedFigureStale` applies.

#### Recording provenance at create time

The fingerprint must be taken over the **reselected** set, not over the
originating `cpLineIds`:

```ts
const bounds = foldedSourceBounds(cpLinesByIds(document, cpLineIds));
const fingerprint = foldedSourceFingerprint(
  cpLinesByIds(document, reselectFoldableLineIds(document, bounds))
);
```

Fingerprinting `cpLineIds` directly compares two differently-derived sets, so
every window would be born stale. `foldedFigureStaleness.test.ts:65-72` shows the
correct shape. This is the single easiest bug to write here.

#### Identity — boundary rings, not the box, not ids

Refresh has to find the region again after an edit. Nothing id-shaped is durable:
`segmentId` renumbers on every recompute, and `cpLineIds` are indices into
`line_segments` that renumber whenever a crease is deleted.

An AABB is not sufficient either, specifically on the patterns this tool is for:

- A concave (L- or U-shaped) region's bbox can wholly contain a separate small
  region sitting in its notch.
- Nested/concentric regions — a frame around an inner square, routine in box
  pleating — have near-identical bboxes.
- A tessellation of repeated units gives many regions whose bboxes differ only by
  translation, so a "best match" can silently pick a neighbour.

So store `CpSegment.boundary` (already computed, `Point[][]`, outer ring plus
holes, plain JSON). On refresh: candidate segments are those whose bounds overlap
`sourceBounds`; the winner is the one whose boundary matches `sourceBoundary`.
Exact for nested, concave and repeated regions.

**No boundary match ⇒ say so.** The region genuinely stopped existing — merged,
split, or its rim stopped being all-border. Surface "region no longer exists" and
offer delete or re-pick. **Never fall back to a nearest match**; that is exactly
how a window ends up silently simulating something else.

This works because the spaces coincide. Per the coordinate note in
`creasePatternSelectionSegment.ts`: CP-model space, the exported fold and the
simulation-fold plane are the same 2D space (`normalizePoint([x,y]) = [x,0,y]`;
`flatPlaneAxes` reads back `(x,z) = (x,y)`; the round trip is the identity). So
`FoldedSourceBounds` and `SegmentBounds` are the same shape *and* the same space.

**This is the part of the design with no upstream to lean on**, so it needs its
own fixtures: an L-shaped region with a second region in its notch, a concentric
frame plus inner square, and a repeated tessellation unit.

#### Accepted false positive

Reselection is AABB overlap, so a crease crossing the bounding box while lying
outside a concave region's real boundary marks the window stale. It errs safe —
false *stale*, never false *fresh*. `pointInSegment` (already exported from
`creasePatternSegmentation`) would make containment exact against the rings and
remove it; worth doing if the noise proves annoying on non-convex patterns, but
see the porting caveat below.

#### What to share with folded figures, and what not to

The two features differ in what they need to *do* with a boundary, not in whether
one exists:

| | rings to tighten staleness? | rings to re-identify a region? |
| --- | --- | --- |
| Folded figure | would benefit | no — refold re-derives from the box |
| Inline simulation | yes | **yes** |

**Share the ring containment test; keep re-identification simulation-only.**
`pointInSegment` already exists; factoring a `pointInRings(rings, point)` out of
it serves both without either importing the other's concepts. Matching a stored
boundary against freshly computed segments stays in the simulation layer, because
only it asks that question.

Two caveats, both of which keep folded-figure changes **out of this plan**:

- Only one of three fold paths starts from a `CpSegment`.
  `foldOristudioCpDocument({ lineIds? })` is called from the selection toolbar
  with a resolved segment's `cpLineIds`, from *Fold model* with an arbitrary
  foldable selection, and with no ids to fold the whole document. The latter two
  would need rings traced from the folded crease set's inferred faces — plausibly
  via the same machinery as `traceBoundaryRings`
  ([creasePatternSegmentation.ts:240](../apps/web/src/lib/creasePatternSegmentation.ts#L240),
  currently module-private), but the required face data has **not** been verified
  to be available at that point. Open question, not a claim.
- *Storing* rings is additive and behaviour-neutral. *Using* them to narrow
  reselection is a deliberate deviation — the AABB reselect is Oriedita's actual
  algorithm (`GetBoundingBox.getBoundingBox` + `FoldLineSet.select`), so
  tightening it needs its own justification under `PORTING.md`. It would remove
  the concave false positive for both features, which is a real win, but as its
  own change with its own parity argument.

### Runtime architecture

The simulator worker stays **single-session and becomes swappable**, not
multi-session. One live session serves the focused window; every other window
holds its last rendered bitmap. Two facts make this sufficient:

- `activateWorkspace` calls `dockviewApi.clear()`
  ([layoutStore.ts:237](../apps/web/src/store/layoutStore.ts#L237)), so the
  Simulate panel and inline windows are never mounted at the same time.
- Only one window plays, and idle windows cost nothing.

Render output forks at the last step: `renderGpu()` draws to an internal
`OffscreenCanvas` and `transferToImageBitmap()`s out to a per-window
`bitmaprenderer` canvas — which is not a WebGL context and so does not count
against the measured per-worker cap of 4. Solver, camera, settings and
`MeshRenderer` are untouched; the fork is one function, not a parallel
implementation. Freezing a window is simply ceasing to send it bitmaps, so freeze
and live are the same code path.

## Affected Areas

- `packages/origami-simulator/src/webgl/glCore.ts` — context-loss handling
- `apps/web/src/simulator/simulatorSession.ts` — render output fork, session token
- `apps/web/src/simulator/useSimulatorRuntime.ts` — session token, probe leak
- `apps/web/src/store/workspaceStore/simulatorRuntime.ts` — worker release
- `apps/web/src/components/panels/SimulatorPanel.tsx` — viewport extraction
- `apps/web/src/simulator/SimulatorViewport.tsx` — new, shared
- `apps/web/src/cp-workspace/` — new object kind, DOM layer, floating controls
- `apps/web/src/keyboard/` — new `inline-simulation` scope
- `apps/web/src/lib/preparedModelCache.ts` — revived (currently dead code)
- `apps/web/src/lib/foldedFigureStaleness.ts` — **consumed unchanged**; only a new
  sibling `isInlineSimulationStale` is added
- `apps/web/src/lib/creasePatternSegmentation.ts` — factor `pointInRings` out of
  `pointInSegment`
- `apps/web/src/lib/delayedProgress.ts` — reused for the refresh toast
- `apps/web/src/lib/nativeProjectFile.ts` — **Phase 7 only**

## Checklist

### Phase 0 — Measure before committing (gates the architecture choice) — DONE

- [x] `__simCapabilityProbe()` dev hook
      ([capabilityProbe.ts](../apps/web/src/simulator/capabilityProbe.ts)) — runs
      in whatever webview hosts the app, so the Tauri case is measurable from
      inside rather than guessed at
- [x] Per-worker WebGL2 context cap + `bitmaprenderer` fan-out, measured **in the
      app** (Chrome 148 / Electron 42, macOS, Apple Silicon):

      workerContextCap        4      (eviction began at the 5th)
      workerFloatRenderTargets true
      fanOutSupported         true
      fanOutMsPerFrame        0.011  @ 512px

      Confirms the design: a context-per-window breaks at 5, and the shared-context
      fan-out needs exactly **one** context however many windows are open, at a
      per-frame cost indistinguishable from zero.
- [x] `prepareFoldModel` re-measured — the "costs seconds" comment **is stale**.
      `npm run bench:prepare` (new,
      [prepare.bench.ts](../packages/origami-simulator/bench/prepare.bench.ts)):

      miura-32x32     v=  1089  prepare  11.1ms
      miura-56x56     v=  3249  prepare   9.5ms
      miura-80x80     v=  6561  prepare  30.1ms
      miura-120x120   v= 14641  prepare 120.4ms
      boxpleat-48     v=  2401  prepare   5.5ms

      120ms at 14.6k vertices, not seconds. Creating a window will not hang the
      UI, so moving `prepareSimulationFold` off the main thread stays optional.
      The bench asserts a loose 2s ceiling so the old cliff cannot return.
- [ ] **Deferred, not blocking — WKWebView / WebKitGTK.** Cannot be driven from
      the browser tooling. Run `__simCapabilityProbe()` in `npm run dev:desktop`
      and paste the result here. Not a gate: the fan-out path needs one context,
      which is inside any plausible cap, and if `bitmaprenderer` is missing there
      the fallback is `transferControlToOffscreen` per window capped at 4.
- [ ] **Deferred, not blocking — GPU ms/step at real CP sizes.** Headless
      Chromium falls back to SwiftShader, so numbers from it would mislead. The
      in-app route is `localStorage['oristudio:sim-perf'] = '1'`. It does not gate
      the architecture: only one window plays at a time and the concurrent-window
      count is hard-capped regardless.
- [ ] **Dropped — full-pane fan-out cost.** Only relevant if the Simulate panel
      moves to fan-out, and the plan deliberately leaves it on
      `transferControlToOffscreen`.

### Phase 1 — Standalone fixes (ship independently; worth doing regardless)

- [ ] `webglcontextlost` / `webglcontextrestored` handling in `GlCore` and the CP
      regl renderer — currently **zero** handling anywhere in the repo
- [ ] Call `releaseSimulatorWorker()` when the Simulate workspace unmounts; it is
      never called in production today, so the worker and its model stay resident
- [ ] Dispose the probe context in `webglRenderSupported()`
      ([useSimulatorRuntime.ts:54](../apps/web/src/simulator/useSimulatorRuntime.ts#L54))
      — it leaks one context per runtime load

### Phase 2 — Extract the viewport (pure refactor, no behaviour change)

- [ ] Extract `SimulatorViewport`: canvas element, `useSimulatorRuntime` wiring,
      orbit/wheel handlers, `ResizeObserver`, theme `MutationObserver`,
      `toRenderSettings`. Presentational — **no store subscriptions**
- [ ] `SimulatorPanel` consumes it; the ~800-line canvas-2D rasterizer
      (`drawFrame` + `rasterize*` / `triangle*` / `drawEdge*`, ~L1117–2003) stays
      in the panel, since inline windows never use it
- [ ] Existing `SimulatorPanel.test.tsx` passes unchanged
- [ ] Exit gate: Simulate workspace visually and behaviourally identical. If this
      cannot be kept neutral, stop — that is the early signal the extraction is
      fighting the panel's store coupling

### Phase 3 — Worker: swappable session + bitmap output (still no UI)

- [ ] Session handoff token in `simulatorSession.ts`; `tick` / `settle` /
      `setCamera` drop work for a stale token so a deposed window's in-flight call
      cannot land on its successor
- [ ] `renderGpu()` output fork: internal `OffscreenCanvas` +
      `transferToImageBitmap()`, transferred to the caller
- [ ] Revive `PreparedModelCache` so switching the focused window is cheap
- [ ] Tests: two alternating sessions on one worker; assert no cross-talk and that
      stale ticks are dropped
- [ ] Exit gate: Simulate panel unchanged; a headless test drives two sessions

### Phase 4 — The inline window

- [ ] `InlineSimulation` descriptor + runtime side table; new store slice, **not**
      merged into `oristudioCpAnnotations`
- [ ] `inlineSimulationAsTransformable()` → `TransformableCanvasObject`
      (`space: 'model'`, `aspectLock: 'default-off'`), so `CanvasObjectOverlay`
      handles select/move/resize/rotate unchanged
- [ ] DOM layer of `bitmaprenderer` canvases, modelled on `CpTextAnnotationLayer`
      (per-frame camera subscription via `useCpOverlayViews`, panel untouched);
      z-index between the text layer (7) and the selection overlay (8)
- [ ] "Simulate inline" in `CpSelectionToolbar`, beside the existing Simulate
      action, reusing `resolveSelectedSegment` + `buildSegmentFold`
- [ ] Record provenance on create: `sourceBoundary` from the matched
      `CpSegment.boundary`, `sourceBounds` from the selection's lines,
      `sourceFingerprint` from the **reselected** set
- [ ] `pointInRings` factored out of `pointInSegment`
- [ ] Resolve a window to its segment by **boundary match**, bounds as prefilter
      only; `segmentIdHint` is a same-segmentation fast path
- [ ] No boundary match ⇒ "region no longer exists"; delete or re-pick. **Never
      fall back to a nearest match**
- [ ] Fixtures: L-shaped region with a second region in its notch, concentric
      frame + inner square, repeated tessellation unit
- [ ] Per-window `FloatingToolbar` controls (play/pause, scrub, reset view,
      delete), modelled on `CpImageInspector`
- [ ] Focus model: focusable wrapper per window, exactly one focused, blur
      releases the live session
- [ ] Hard cap on concurrent windows; over the cap, refuse politely

### Phase 5 — Keyboard

- [ ] Add `'inline-simulation'` to `ShortcutScope`, pushed to the front of the
      stack while a window is focused
- [ ] Register the simulator bindings as real `ShortcutDefinition`s — they
      currently bypass the dispatcher and the user's overrides entirely
- [ ] Delete the ad-hoc `window` keydown listener in `SimulatorPanel`
      ([L709](../apps/web/src/components/panels/SimulatorPanel.tsx#L709)); its
      design note assumes the panel only mounts in the Simulate workspace, which
      this feature invalidates
- [ ] Verify no regression against Edit's bindings: `Space` (space-to-pan), `F`
      (Fold), `C`, `R` (Mirror Line), `L` (Line tool), `Escape`, `Delete`

### Phase 6 — Behaviour polish

- [ ] `isInlineSimulationStale` + tests mirroring `foldedFigureStaleness.test.ts`
      (moved crease, recoloured crease, crease added outside the box,
      selection-only change ⇒ **not** stale), **plus** an aux-coloured crease
      added inside the region ⇒ **not** stale, locking in the decision below
- [ ] Compute stale ids in a `useMemo` keyed on
      `[inlineSimulations, oristudioCpDocument?.document]`, exactly as
      `staleFoldedFigureIds` does
      ([CreasePatternPanel.tsx:1418](../apps/web/src/components/panels/CreasePatternPanel.tsx#L1418))
      — derived, never stamped
- [ ] Match the folded-figure visual language: fade the window (cf.
      `.cp-generated-folded-figure--stale`, `opacity: 0.42`) plus an "Out of date"
      label, and a Refresh action on the window's floating toolbar
- [ ] Refresh re-derives the fold and reloads the session, keeping `box`, `view`
      and `foldPercent`. On failure, **keep the existing window and report** — the
      rule `0b3b1ea6` established for failed refolds. **Never auto-recompute on
      edit**
- [ ] Reuse `lib/delayedProgress.ts` for the refresh toast (nothing for 500 ms,
      then a minimum second on screen)
- [ ] `__inlineSimStaleDebug()` dev hook mirroring `__foldedStaleDebug()` — for the
      reason `c4dc8e92` gives: every "not stale" looks identical from outside,
      whether the cause is missing provenance, a region that no longer covers the
      edit, or a genuine match
- [ ] Empty / error / "GPU unavailable — open in Simulate" states
- [ ] i18n: extract → translate 8 locales → stamp → `i18n:check`
- [ ] Undo/redo: create / delete / move / resize go through the existing
      canvas-object gesture checkpoints

### Phase 7 — Persistence (deferred; only if wanted)

Nothing above depends on this. If the data-model rule held, this is additive.

- [ ] Decide: `document.extensions.inlineSimulations` (no schema bump) vs a
      `schemaVersion: 5` field beside `images` / `textAnnotations`
- [ ] Persist the provenance triple and rebuild the fold on load. This works only
      because the provenance is absolute rather than a store-local counter
- [ ] Files written before this load with null provenance ⇒ not stale
- [ ] Write/read + migration + round-trip tests; older files load as `[]`
- [ ] Forward-compat: unknown keys survive a round trip through an older build

## Decisions and rejected alternatives

Recorded so they are not re-litigated.

**Keep the foldable-colour filter (Black0 / Red1 / Blue2).** Aux-coloured creases
*do* reach the simulation mesh — `FoldGraph::from_model_for_export` exports every
segment with no colour filter
([fold_graph.rs:40](../crates/oristudio-cp/src/fold_graph.rs#L40)), aux colours map
to `Assignment::Flat`
([model/mod.rs:487](../crates/oristudio-cp/src/model/mod.rs#L487)),
`buildPlanarFaces` splits faces on all edges, and `prepareFoldModel` keeps those
`F` edges as facet creases carrying `panelStiffness`. But a flat crease across a
facet does not change the folded form; it changes only the mesh's discretization.
Segmentation walls exclusively on `'B'`
([creasePatternSegmentation.ts:143](../apps/web/src/lib/creasePatternSegmentation.ts#L143)),
so aux edits cannot split or merge regions either. Marking a window stale because
someone drew a construction line would be pure noise. **Same filter, same reason,
for both consumers.** The residual is a *simulator* issue — user-drawn aux lines
arguably should not become physical facet creases at all; if a dense aux grid ever
visibly perturbs a settle, the fix is to drop non-foldable colours in
`prepareSimulationFold`. Not measured, so not assumed to matter; file separately.

**Rejected: multi-session worker.** Superseded by "one plays at a time" plus the
fact that the Simulate panel and inline windows never coexist. See research §6b.

**Rejected: `foldArtifactRevision` for staleness.** A store-local counter is
meaningless across a save/load, so a persisted window would be permanently and
silently wrong about its own freshness.

**Rejected: `segmentId` or `cpLineIds` as durable identity.** Both renumber.

**Rejected: nearest-bounds fallback when no region matches.** Silently simulating
a different region is worse than reporting that the region is gone.
