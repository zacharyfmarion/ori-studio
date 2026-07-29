# Inline simulation on the Edit canvas — feasibility

**Date:** 2026-07-26
**Question:** Add a "Simulate inline" action to the crease-pattern selection
toolbar that spawns a draggable/resizable window *on the Edit canvas*, running
the existing origami simulator, with orbit-on-drag and play/pause/scrub keyboard
control when focused.

**Verdict:** Feasible. Most of the hard parts are already built, and **nothing
here is a hard blocker** — see §6a. But it is not a small feature and it is
**not** simply "mount `SimulatorPanel` in a box": four things in the current
architecture defeat the naive version. Three are pure engineering investment with
no unknowns. The fourth (GPU context budget) has a hard, measured ceiling that
picks the architecture for you, and carries the one genuine open question
(WKWebView), so it should be settled before any UI work starts.

---

## 1. What already exists (the good news)

The feature decomposes into five capabilities, four of which are already in-tree.

| Capability | Status | Where |
| --- | --- | --- |
| Draggable / resizable / rotatable canvas objects | **Done, generic** | [CanvasObjectOverlay.tsx](apps/web/src/cp-workspace/CanvasObjectOverlay.tsx) |
| Per-object floating toolbar glued to the camera | **Done, generic** | [FloatingToolbar.tsx](apps/web/src/components/ui/FloatingToolbar.tsx), [useCanvasObjectAnchor.ts](apps/web/src/cp-workspace/canvasObjects/useCanvasObjectAnchor.ts) |
| DOM layer positioned in model space, live per camera frame | **Done** | [CpTextAnnotationLayer.tsx](apps/web/src/cp-workspace/CpTextAnnotationLayer.tsx), [cpOverlayViewStore.ts](apps/web/src/cp-workspace/cpOverlayViewStore.ts) |
| A selection → single-segment → simulate action | **Done** | [CpSelectionToolbar.tsx:184](apps/web/src/cp-workspace/CpSelectionToolbar.tsx#L184) |
| GPU solver + GPU renderer, off-thread, orbit-cheap | **Done** | [webglSolver.ts](packages/origami-simulator/src/webgl/webglSolver.ts), [simulatorSession.ts](apps/web/src/simulator/simulatorSession.ts) |
| **Multiple concurrent simulator instances** | **Not supported** | — |

The interaction contract you'd need is already abstract:
[`TransformableCanvasObject`](apps/web/src/cp-workspace/canvasObjects/transformableObject.ts)
is explicitly "a rotated box plus an aspect-lock policy" that the overlay
consumes, with kind-specific behaviour supplied as optional callbacks. Reference
images, text boxes, and folded figures already ride it *without sharing a data
model*. A simulation window is a fourth kind, and the overlay would not need to
change — `foldedFigureAsTransformable` is a 12-line adapter and a sim window's
would look the same.

The `Simulate` button in the selection toolbar already resolves a selection to
exactly one border-enclosed segment and hands off a `segmentId`
([`simulateOristudioCpSegment`](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts#L708)).
Today it switches workspaces; inline mode would instead create an object. The
selection→segment resolution is reusable verbatim.

Rendering-wise, the simulator's GPU path is already exactly the right shape: the
worker owns the canvas via `transferControlToOffscreen`, draws straight from the
position texture, and orbit is one `setCamera` message plus a redraw with **no
solver work and no readback**. Dragging to rotate an inline window is therefore
intrinsically cheap regardless of model size — that part needs no new work.

---

## 2. Constraint 1 — the WebGL context budget (measured; this is the big one)

Every `WebglSolver` creates its own WebGL2 context bound to one canvas
([`GlCore.create`](packages/origami-simulator/src/webgl/glCore.ts#L63)). N
simulation windows means N contexts. Browsers cap this hard and evict silently.

I measured it in this app's own Chromium (Electron 42 / Chrome 148, macOS,
Apple Silicon):

| Configuration | Result |
| --- | --- |
| Main-thread contexts, created up to 40 | **16 alive**; 24 `webglcontextlost` fired; **oldest evicted first** |
| One worker, 16 OffscreenCanvas contexts | **4 alive**; the 5th add evicts the 1st |
| 11 workers × 1 context each | **11/11 alive**, main-thread editor context untouched |

Three consequences:

1. **A single simulator worker can host at most 4 GPU simulations.** The cap is
   per-worker, not per-process.
2. **Going past it fails silently.** The 5th window doesn't error — it kills the
   1st window's context. There is **zero `webglcontextlost` handling anywhere in
   this repo** (`grep -rn "webglcontextlost\|loseContext"` → no hits in
   `apps/web/src` or `packages/origami-simulator/src`). Today that's fine because
   the app holds ~2 contexts; with inline sims it becomes a silent-corruption
   bug: an evicted context leaves a frozen or blank window with no console error.
3. **Worker-per-window scales fine on context count** but costs a thread and a
   full module instance each.

There is also a **latent leak that gets much worse** with this feature:
[`webglRenderSupported()`](apps/web/src/simulator/useSimulatorRuntime.ts#L54)
creates a probe `webgl2` context on every runtime load and never calls
`loseContext()`. With one panel that's harmless; with a window per segment it is
a per-window context allocation racing the cap.

### The architecture this points at

Rather than N contexts, use **one WebGL2 context in one worker, rendering each
window's frame in turn and fanning out via `transferToImageBitmap()`** into
per-window canvases holding a `bitmaprenderer` context (which is *not* a WebGL
context and costs nothing against the cap).

I prototyped this and it works:

```
12 windows @ 200px, one shared worker WebGL2 context, 30 passes
worker CPU per full 12-window fan-out pass: 0.13 ms
worker context lost: false
main-thread editor context: alive, 0 loss events
```

Caveat on that number: the prototype draws a single triangle, so 0.13 ms is the
cost of *the fan-out mechanism* (render → `transferToImageBitmap` → transfer →
`transferFromImageBitmap`), not of a real mesh render. What it establishes is
that the mechanism itself is essentially free — which was the open question. The
real per-window cost stays whatever `MeshRenderer.render` costs today.

This also cleanly solves the multi-session problem below, because it forces the
worker to own a *map* of sessions anyway.

**Unverified and important:** these numbers are Chromium. Tauri on macOS uses
WKWebView, and on Linux WebKitGTK. Both need their own measurement for (a) the
per-worker context cap and (b) `OffscreenCanvas` + `bitmaprenderer` support in a
worker. The existing plan already flags Tauri WKWebView verification of the GPU
path as **not yet done** ([origami-simulator-performance.md
checklist](implementation-plans/origami-simulator-performance.md), Phase 2b: "Verify
on the Tauri WKWebView explicitly (in progress)"). Inline simulation would be
building on an unverified foundation there.

---

## 3. Constraint 2 — the simulator worker is a hard singleton

This is the single largest code change the feature requires.

[`simulatorSession.ts`](apps/web/src/simulator/simulatorSession.ts) keeps
**module-level state**:

```ts
let session: Session | null = null;          // line 174
let renderCanvas: OffscreenCanvas | null = null;  // line 181
```

Every API method calls `requireSession()`, which reads that one variable.
`attachCanvas()` stores one canvas — with an explicit comment that "a canvas can
only be transferred a single time, so it is held here and reused across model
reloads". `load()` disposes the previous session. And
[`getSimulatorClient()`](apps/web/src/store/workspaceStore/simulatorRuntime.ts)
returns a process-wide singleton worker.

So today: **one model, one canvas, one camera, one clock, one set of perf
counters.** A second inline window would silently destroy the first.

The refactor is mechanical but touches everything: `session` → `Map<sessionId,
Session>`, every method takes a `sessionId`, `attachCanvas` becomes
`createSession(id, canvas)`, and the module-level `perf` counters become
per-session (or stay global but get labelled). `SimulationClock` and
`WebglSolver` are already per-instance and need no change —
`ReferenceSolver` likewise. The blast radius is confined to
`simulatorSession.ts`, `simulatorRuntime.ts`, `useSimulatorRuntime.ts`, and
`SimulatorPanel`'s call sites.

Related, and worth fixing regardless: **`releaseSimulatorWorker()` is never
called in production.** `grep` finds it only in its own definition and in a test
mock. Its own doc comment says a closed panel "should not keep it resident" —
but nothing closes it. With inline windows that becomes a real leak: each window
retains a prepared model, solver state, and a pile of float textures until the
tab dies.

### Concurrency, if they share a worker

Even with a multi-session worker, note that
[`useSimulatorRuntime`](apps/web/src/simulator/useSimulatorRuntime.ts#L251)
drives ticks from a **main-thread rAF, one in-flight tick at a time**
(`inFlightRef`). N windows on one worker means N rAF loops issuing comlink calls
that **serialise on the worker's single event loop**. With `GPU_STEPS_PER_TICK =
80`, four playing windows each get roughly a quarter of the tick rate — the fold
animates ~4× slower, not 4× jerkier. That's arguably acceptable (and the
convergence check means idle windows cost nothing —
`SimulationClock.runFrame` returns immediately when converged, and
`useSimulatorRuntime`'s loop skips entirely when `convergedRef && !playing`).
But it should be a deliberate decision, and a single shared tick driver in the
worker would be better than N racing rAF loops.

---

## 4. Constraint 3 — keyboard focus

The simulator's keyboard controls are a **`window`-level bubble-phase listener**
([SimulatorPanel.tsx:709](apps/web/src/components/panels/SimulatorPanel.tsx#L709))
with no focus scoping. The design doc says why:

> "The panel only mounts in the Simulate workspace, so a window listener is
> already scoped to when the simulator is on screen — no global workspace check
> needed."
> — [implementation-plans/simulator-keyboard-controls.md](implementation-plans/simulator-keyboard-controls.md)

That assumption is exactly what inline simulation invalidates. The collisions
are concrete, not hypothetical:

| Key | Simulator wants | Already bound in Edit |
| --- | --- | --- |
| `Space` | play / pause | **Space-to-pan the CP canvas** ([CreasePatternPanel.tsx:3329](apps/web/src/components/panels/CreasePatternPanel.tsx#L3329)) |
| `F` | toggle faces | `foldAction` — Fold |
| `C` | toggle crease lines | `senbun_henkan2Action` |
| `R` | replay from flat | `symmetricDrawAction` — Mirror Line |
| `L` | toggle lighting | `drawCreaseFreeAction` — the Line tool |
| `Escape` | — | `haltAction`, plus deselect in the overlay |
| `Delete` | — | deletes the selected canvas object |

(Source: `ORIEDITA_DEFAULTS` in [shortcuts.ts:54](apps/web/src/keyboard/shortcuts.ts#L54).)

Ordering makes it worse: the app's dispatcher is installed on `document` in the
**capture** phase ([appKeyboard.ts:49](apps/web/src/lib/appKeyboard.ts#L49)), so
CP shortcuts fire first and the simulator's window listener sees an already-handled
event.

The good news is the right mechanism already exists. `shortcutDispatcher`
resolves against a **scope stack** (`['crease-pattern', 'global']`), and
`ShortcutScope` is a small union. The correct fix is to add an
`'inline-simulation'` scope pushed onto the front of the stack while a sim window
is focused, register the simulator bindings as real `ShortcutDefinition`s, and
**delete the ad-hoc `window` listener** — which also fixes the existing (latent)
problem that the Simulate workspace's bindings bypass the user's shortcut
overrides entirely.

That in turn requires a real focus model for canvas objects, which does not exist
today. Annotations have *selection* (`selectedCanvasObjectId`) but not *keyboard
focus* — there is no focusable element, no tab order, no focus ring. For "click
inside it, then keys drive it" you need a focusable wrapper per window
(`tabIndex={0}`) and to decide what happens on blur.

---

## 5. Constraint 4 — the FOLD-artifact pipeline is document-global (and still main-thread)

Getting from "these selected creases" to "a `FoldDocument` the solver can eat"
goes through
[`computeFoldArtifacts`](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts#L265):

```
exportOristudioCpDocumentAsFold()   // worker (kernel)
  → foldArtifactsFromFold()          // MAIN THREAD
      → prepareSimulationFold()      // MAIN THREAD: earcut triangulation,
                                     //   winding normalisation, crease params
```

`segmentationFoldArtifactsFromFold` carries a comment saying this "costs
**seconds** on large documents"
([creasePatternImport.ts:178](apps/web/src/lib/creasePatternImport.ts#L178)).
**That comment is stale.** Both quadratic hot spots on this path have since been
removed:

- `e5313d8c` — O(1) edge lookup in `prepareFoldModel` (was O(E²))
- `118bd294` — sweep for crease intersections in `inferTopology` instead of
  testing every pair

The comment was written in `6c44d3de`, which lands *between* those two, so it
describes a cost that no longer holds. The structural fact that remains true is
that the work runs **on the main thread** (and the simulator worker then runs
`prepareFoldModel` again on the result) — but the magnitude is now unmeasured and
probably small. **Measure it before treating it as a cost at all.**

Two implications for inline sims:

- **A main-thread stall on window creation is a smaller risk than assumed**, but
  is still worth confirming: on the Edit canvas, next to the thing you're
  drawing, even a few hundred ms reads worse than it does when it is framed as
  "entering the simulator". Moving `prepareSimulationFold` into a worker is
  optional polish, not a prerequisite.
- **Superseded (2026-07-27):** the revision-based staleness proposed below is
  replaced by the bounds + fingerprint mechanism merged for folded figures
  (`lib/foldedFigureStaleness.ts`). A revision counter is store-local and so
  meaningless across a save/load; the provenance pair is absolute. See
  "Staleness" in
  [implementation-plans/inline-simulation-windows.md](../implementation-plans/inline-simulation-windows.md).
- **The artifacts are document-scoped and revision-invalidated.** `foldArtifacts`
  is a single store field keyed by `foldArtifactRevision`. Every crease edit
  marks it stale. So: what happens to open inline windows when you edit the CP?
  Options are (a) freeze them on their captured fold, (b) recompute and reload —
  which re-pays the seconds-long cost per edit, (c) mark them stale with a
  refresh affordance. **(a) or (c) is the only sane default**; (b) would make the
  editor unusable. This is a product decision that has to be made up front
  because it determines whether a window stores a fold snapshot or a reference.
- Sub-segment extraction (`resolveCpSegments` + `buildSegmentFold`) is already
  cheap and cached, so per-window scoping is not itself a cost.

---

## 6. Performance: what it actually costs per window

### Solver

The committed CPU baselines ([bench/baseline.json](packages/origami-simulator/bench/baseline.json),
`ReferenceSolver`, Node, Apple Silicon):

| fixture | vertices | ms/step (CPU) |
| --- | --- | --- |
| miura-16×16 | 289 | 1.10 |
| miura-32×32 | 1,089 | 4.72 |
| miura-56×56 | 3,249 | 14.53 |
| miura-80×80 | 6,561 | 32.00 |

**The CPU backend is unusable for inline simulation at any realistic size** —
one window at 1k vertices would eat a whole frame. This matters because the CPU
path is not just a no-WebGL2 fallback: it's also the path taken for **fold
profiles** (segment/sequence-step simulation), per
[`createBackend`](apps/web/src/simulator/simulatorSession.ts#L245). So inline
windows must be restricted to the uniform-fold GPU path, or be explicitly
degraded when they aren't.

For the GPU backend I could not find committed throughput numbers. The
performance plan's own checklist says so plainly: *"Stretch gate: 10k vertices at
200+ steps/frame, 60fps — **not formally measured**"*. There's a parity gate
(1.79e-7 vs the reference solver) and a qualitative user verification
("hilariously better"), but no per-step timing. **Before committing to N
windows, measure GPU ms/step and ms/render at the sizes real CPs hit.** The
existing `simPerf` instrumentation
([`getPerfStats`](apps/web/src/simulator/simulatorSession.ts#L496), enabled via
`localStorage['oristudio:sim-perf'] = '1'`) already reports exactly this and is
the cheapest way to get the number.

### Readback stalls scale with window count

Each tick calls `backend.maxVelocity()`, which does a **synchronous
`readPixels`** on the velocity texture
([webglSolver.ts:235](packages/origami-simulator/src/webgl/webglSolver.ts#L235))
— a full GPU pipeline stall, once per tick per session. This is already known
and deferred: *"Async diagnostics reduction (`fenceSync` + PBO) — currently a
sync readback per frame in the worker"*. With one panel it's amortised. With N
sessions in one worker it's N stalls per frame, serialised. **This is likely to
be the actual bottleneck for multi-window playback**, more than the solve itself,
and it's the one deferred item the feature genuinely promotes to blocking.

### Memory

Each session holds a prepared triangulated model plus ~20 float textures. The
`releaseSimulatorWorker` comment estimates "tens of megabytes" for a large CP.
Multiplying that by window count is a real WKWebView memory-exhaustion risk (the
desktop shell has already hit that class of failure once, opening a 47 MB `.osf`).
Sessions need a hard cap and an eviction/pause policy.

### Camera and resize are cheap

Orbit is one comlink message; `setCamera` triggers a redraw only. Resize goes
through `ResizeObserver` → `pushView()` → drawing-buffer resize in the worker.
Both are already model-size-independent. **Dragging and resizing an inline window
is not a performance concern.** Worth noting the drawing buffer is currently
floored at 360×360 device px in `deviceSize()` — small inline windows would
over-render unless that floor is relaxed.

---

## 6a. Hard blocker, or investment?

**None of the four are hard blockers.** Nothing here says "the browser won't let
you do this". Classified honestly:

| Constraint | Kind | Why |
| --- | --- | --- |
| Worker singleton | **Pure investment** | Mechanical `session` → `Map`. Contained to 4 files. Zero unknowns, zero research. |
| Keyboard / focus | **Pure investment** | The scope-stack mechanism already exists; only the canvas-object focus model is new, and it's small. |
| Fold pipeline | **Mostly a product decision** | The cost objection is now largely retracted (§5). What remains is "what happens to open windows on CP edit", which is a design call, not an engineering one. |
| WebGL context budget | **Investment + one real unknown** | Two independently-measured architectures work in Chromium. The unknown is WKWebView. |

The context budget is the only one with a genuine unknown in it, and even that
is bounded: if the shared-context fan-out doesn't work on WKWebView,
worker-per-window is the fallback (measured 11/11 alive), and if *that* fails,
capping at 3 concurrent windows works everywhere. So the question isn't "can
this ship" but "which of three known-good shapes do we pick" — and the WKWebView
measurement that answers it is maybe an hour of work.

The thing closest to an actual constraint is not on the original list: the
**synchronous per-tick `readPixels`** in `maxVelocity()` (§6). It bounds how many
windows can *play at once*, and it is pre-existing deferred work
(`fenceSync` + PBO) that this feature promotes from "nice" to "load-bearing".
Even it has a free mitigation: **only one window plays at a time**, which is
probably the better UX anyway — the others hold their settled fold, which costs
nothing because a converged clock spends no budget.

So: this is a real chunk of architectural work — call it the multi-session
refactor plus a render-path change plus a focus model — but it is *investment*,
not a wall. And the multi-session refactor and the context-loss handling are both
things worth doing on their own merits.

## 6b. Maintainability cost to the core simulator

This is a nice-to-have, so the question that matters is: how much harder does it
make the *core* simulator to maintain? Answer: **much less than §3 implied, if
two constraints are adopted.**

### The two facts that collapse the complexity

1. **The panel and inline windows can never coexist.** `activateWorkspace` calls
   `dockviewApi.clear()` ([layoutStore.ts:237](apps/web/src/store/layoutStore.ts#L237)),
   so switching workspaces destroys and rebuilds every panel. `simulator` lives
   in `simulate`, `crease-pattern` in `edit`. The worker is therefore **only ever
   serving one surface kind at a time**.
2. **Only one window plays at a time** (adopted). A converged clock spends no
   budget and `useSimulatorRuntime`'s loop skips entirely when
   `convergedRef && !playing` — so an idle window costs literally nothing. And an
   idle window that only ever needs to *redisplay* its last frame doesn't need
   live GL state at all; it needs a bitmap.

Together these mean **the worker does not become multi-session.** It stays
single-session, exactly as today, and becomes *swappable* instead. That deletes
the largest item from §3.

### What actually changes

| Change | Where | Size / risk |
| --- | --- | --- |
| Render output forks: draw to an internal `OffscreenCanvas` + `transferToImageBitmap()` instead of the transferred canvas | `renderGpu()` in `simulatorSession.ts` | **~1 function.** Solver, camera, settings, `MeshRenderer` all unchanged — the fork is at the last step of the pipeline, not a parallel implementation |
| Session handoff token, so a deposed window's in-flight `tick()` can't land on its successor | `simulatorSession.ts` + `useSimulatorRuntime.ts` | **Small but real.** This is the one genuinely new correctness surface (async/generation bugs). Needs tests |
| Revive `PreparedModelCache` so switching the live window is cheap | `lib/preparedModelCache.ts` | **Free** — it already exists and is currently dead code (referenced only by its own test) |
| Extract a presentational `SimulatorViewport` | new, from `SimulatorPanel.tsx` | **Net reduction** in core complexity |
| New canvas-object kind + DOM layer | `cp-workspace/` | **Additive**, follows three existing precedents, touches no simulator code |

Note what is *not* on this list: no session `Map`, no N tick loops, no N
readbacks, no context-budget management, no per-window settings model, no second
copy of the CPU rasterizer.

### The three real risks, ranked

**1. `SimulatorPanel.tsx` is 2,003 lines with 15 store subscriptions.** Roughly
800 of those lines (`drawFrame` and the `rasterize*` / `triangle*` / `drawEdge*`
helpers, ~L1117–2003) are the **canvas-2D software fallback rasterizer**, which
an inline window would never touch. The remaining ~930-line component mixes store
derivation, fold-source resolution, segment/sequence scoping, effects, orbit
handlers, and the entire controls UI.

It cannot be reused inline as-is. **The failure mode to design against is someone
copy-pasting the viewport half**, leaving two divergent implementations of orbit,
resize, theme-reobservation and render-settings plumbing. That is the thing that
would genuinely make the core worse. The mitigation is to do the extraction
*first*, as its own change, and let both surfaces consume it — at which point the
Simulate panel gets smaller, not bigger.

**2. Persistence is a permanent tax.** If inline windows go into `.osf`, that's a
schema v5 bump, a migration, round-trip tests, and forward-compat obligations
**forever**, for a nice-to-have. Strongly recommend **session-only, not
persisted, for v1** — the window is a scratch tool, not document content. This
single decision is worth more than any code-level simplification here.

**3. Scope creep drags in the complex half of the simulator.** Fold profiles,
sequence-step simulation, and the no-WebGL2 fallback all route to
`ReferenceSolver` ([`createBackend`](apps/web/src/simulator/simulatorSession.ts#L245))
and to the 800-line 2D rasterizer. Admitting any of them inline roughly doubles
the surface. **Draw the line at "GPU, uniform fold, one segment"**; anything else
shows "open in the Simulate workspace". The inline path then stays small
permanently, because the boundary is enforced by the backend ladder that already
exists.

### One honest counterweight

The fan-out change touches a path that currently works and is user-verified
("performance hilariously better"). The main panel would go from compositing a
transferred canvas directly to allocating and transferring a bitmap per frame. My
measurement (§2) used 200 px canvases; a full-pane panel bitmap is far larger and
**I did not measure that case**. Two options:

- Convert both surfaces to fan-out (one path, but re-verify the panel's perf), or
- Keep the panel on `transferControlToOffscreen` and give only inline windows the
  fan-out. Since the fork is one function at the output stage, this is cheap —
  and since the two surfaces never coexist, there's no runtime interaction
  between them to reason about.

Recommend measuring first and defaulting to the second if there is any regression.

### Bottom line

With "one plays at a time" and "not persisted", the cost to the core is
approximately: **one new function in the worker, one session-handoff token, and
one component extraction that leaves the Simulate panel smaller than it is
today.** The rest of the feature lives in `cp-workspace/` alongside images, text
and folded figures, and does not touch the simulator engine at all. Two of the
prerequisites (`webglcontextlost` handling, actually calling
`releaseSimulatorWorker`) are latent bugs worth fixing regardless.

## 7. Recommended architecture

*(Revised after adopting "one window plays at a time" — see §6b. The earlier
multi-session proposal is superseded.)*

1. **Keep the worker single-session; make it swappable.** One live session
   serves whichever window is focused; the rest hold their last frame. Add a
   session-handoff token so a deposed window's in-flight `tick()` is dropped.
   Revive `PreparedModelCache` so handoff is cheap.
2. **One shared WebGL2 context; fan out via `transferToImageBitmap`** into
   per-window `bitmaprenderer` canvases. Sidesteps the measured per-worker cap of
   4 entirely and keeps the main-thread editor context safe. Keep the Simulate
   panel on `transferControlToOffscreen` unless measurement says otherwise (§6b).
3. **Freeze and live are the same code path** — an idle window is simply one that
   stops receiving bitmaps. No separate "paused" rendering mode to maintain.
4. **Add `webglcontextlost` handling** to `GlCore` and the CP renderer. This is
   worth doing whether or not the feature ships.
5. **New canvas-object kind**, adapted to `TransformableCanvasObject`, rendered
   on a DOM layer between the text layer (z 7) and the selection overlay (z 8),
   modelled directly on `CpTextAnnotationLayer` (per-frame camera subscription,
   panel untouched).
6. **Per-window controls via `FloatingToolbar`**, exactly as `CpImageInspector`
   does — play/pause/scrub/reset live on the pill, not on a global toolbar.
7. **Keyboard via the scope stack**, not a window listener. New
   `'inline-simulation'` scope + a focusable wrapper. Retire the
   `SimulatorPanel` window listener at the same time.
8. **Freeze the fold snapshot per window** by default; mark stale on CP edit with
   an explicit refresh. Do not auto-recompute.

## 8. Scope estimate

*(Revised per §6b.)*

| Work | Size |
| --- | --- |
| Extract presentational `SimulatorViewport` from the panel | Medium — do this **first**, standalone |
| Bitmap fan-out output path + session handoff token | Small–medium — prototyped; the token needs tests |
| Context-loss handling | Small |
| Canvas-object kind + DOM layer + adapter | Small — the patterns exist |
| Floating per-window controls | Small |
| Keyboard scope + focus model | Medium — focus model is genuinely new |
| Fold-artifact scoping / staleness policy | Medium — product decisions first |
| Move `prepareSimulationFold` off the main thread | Optional — measure first |
| Persistence (`.osf` schema v5) if windows survive save | Medium — optional |
| i18n for all new strings (8 locales) | Small but mandatory |

Persistence is a genuine fork in the road. `.osf` is at schema v4 and
`NativeCreasePatternDocumentV1` persists `images` and `textAnnotations`
explicitly. If a sim window is "an object on the canvas" like an image, users
will expect it to survive save — which means a v5 bump plus deciding whether the
*fold snapshot* is persisted (large) or recomputed on load (slow). If it's
session-only ephemeral UI, none of that applies. **Decide this before modelling
the object**, because it determines whether it lives in the annotation array or
in view state.

## 9. Open questions to settle first

1. **WKWebView / WebKitGTK:** per-worker context cap, and `OffscreenCanvas` +
   `bitmaprenderer` in a worker. Blocks the architecture choice, and the existing
   GPU path is *itself* still unverified there.
2. **GPU ms/step and ms/render at real CP sizes.** Never measured. Determines
   the concurrent-window cap.
3. **Does an inline window persist in `.osf`?** Determines the data model.
4. **What happens on CP edit?** Freeze / stale / recompute.
5. **Is fold-profile (sequence-step) simulation in scope inline?** If yes, the
   CPU backend comes with it and the perf story changes completely. Recommend
   **no** for v1.

---

## Appendix: measurement method

Context-cap numbers were measured in this session's browser
(`Chrome/148.0.7778.280 Electron/42.7.0`, macOS, Apple Silicon) with three
standalone probe pages served over localhost:

- N main-thread `webgl2` contexts → count `isContextLost()` after a settle tick.
- One worker, N `transferControlToOffscreen` canvases, audited after each add.
- N workers × 1 context each, audited after each add.
- One worker with a single `OffscreenCanvas` WebGL2 context rendering 12 distinct
  frames per pass, each `transferToImageBitmap()`'d into a visible canvas with a
  `bitmaprenderer` context; 30 passes, timing the worker-side loop.

Solver timings are the committed `bench/baseline.json` (CPU `ReferenceSolver`,
Node) and the measured table in
[implementation-plans/origami-simulator-performance.md](implementation-plans/origami-simulator-performance.md).
No GPU-backend timings exist in-tree.
