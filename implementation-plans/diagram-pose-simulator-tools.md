# Diagram: the simulator's tools in Pose

**Status: planned 2026-10-06. Phase 0 (merging main and the 0% guard) is
built; nothing else is. Decisions D1–D5 are decided (Zach, 2026-10-06).** This follows Phase 8d of
`implementation-plans/diagram-workspace.md` (Simulated in Pose, D19). It
builds on main's Pin tool (#437, `implementation-plans/simulator-tool-rail-and-pins.md`)
and Pull tool (#438, `implementation-plans/simulator-pull-tool.md`), and both
of those plans scope their tools to the Simulate workspace only.

Conventions:
- Paths are under `apps/web/src/` unless they say otherwise.
- "(main)" means a line on origin/main a96961959.
- "(HEAD)" means a line on this branch at 26d57661f, read with `git show HEAD:`.
  Other agents' uncommitted edits in `diagram/**` may have shifted some of these.
- *(inferred)* marks a claim read from code but never run.

## Goal

Zach, 2026-10-06: "There have been some changes to the simulator code since
this PR was opened. Would you mind reviewing what's on Main? Ideally we would
have access to the same tools like in the pose view for simulator that the
simulator workspace has. would you mind like planning that out and thinking
carefully about you know the right architecture for that?"

So:

1. Review what main changed in the simulator since #436 last took main, and
   bring it in.
2. Give Pose, for a step shown as Simulated, the Simulate workspace's tools:
   - Orbit, Pin and Pull;
   - Clear pins and Spring back;
   - Select through all layers;
   - the tool window and its notices;
   - the keys (O, P, U, Escape);
   - per D4, the context menu.

   There is one implementation and two hosts. A tool behaves and looks the
   same in both, and a later change to a tool reaches both.
3. A simulated step's picture belongs to the step, and so does the mesh it
   was drawn from (D1). Leaving Pose and coming back, undo and redo, Pose
   Again, and a Refresh in new light must all give back the picture the author
   made: the captured mesh, not the model solved again at the same fold %, and
   for a step shaped by those tools, not the unpinned, unposed model.
4. Simulate is unchanged, and we prove it.

Not part of this: Simulate's options pane (render, paper, material, solver),
Export view, the readouts, the segments sidebar and the CPU fallback. The
"Tool by tool" table below explains each.

## What changed on main

**Where the branch stands.**
- #436 forked at 03b5716a1 (#427, 2 Oct).
- It has taken main twice:
  - 6cc337da7 (3 Oct), bringing #430–#432;
  - 25d9ba02b (4 Oct), bringing #435 and #437: the tool window kit, the
    simulator tool rail, Pin, and the phone Tools pill.
- The merge-base is 558a54445 (#437).

So the branch already has Orbit, Pin, the rail and the tool window. The
Diagram just does not use them.

**Main has merged one PR since: #438, the Pull tool** (merge a96961959, 6 Oct).
That is 13 commits across 90 files, +4698/−197, all TypeScript, with no Rust or
wasm.

| Commit | Layer | Effect |
| --- | --- | --- |
| 4e8b80cfb, ce5fa06ef, 2230b25a1 | plan | Adds `simulator-pull-tool.md`, built and measured. Its scope is Simulate only (l.21). Out of scope: poses in `.osf`, poses surviving a reload, and Pull in inline windows (l.500–510). |
| 336fb0995 | engine | Adds `packages/origami-simulator/src/pull.ts`: grip a point, draw it toward a cursor ray, and keep the shape as a pose. `SolverBackend` gains `beginPull`, `movePull`, `endPull(keep \| cancel)`, `releasePose`, `posed` and `pulling` on both backends. The reference backend keeps a pose with `keepShape` (`referenceSolver.ts` l.570). The WebGL backend uses `writeRestAngles` (l.350), `keepInPlaneShape` (l.359) and `setPose` (l.392). |
| 8f005a537 | engine | Adds `bench:pull` on real models and sets the pose's length tolerance to 0.1. |
| a215ad8ad | engine | Posed paper gets its own compiled force program, so the unposed solve stays bit-identical. |
| 4aa797cc6, a4079d61f | worker, runtime | The worker gains pull and pose calls (`simulatorSession.ts` l.1374–1441). **Any fold-target change or reset ends a pose**: `setFoldPercent` (l.1443) and `reset` (l.1480) both call `endPose` (l.2259). Frames carry `posed` (a kept pull), `poseEnded` (`fold`, `reset` or `request`) and `framingHeld`. The runtime gets a coalesced pull lane (`useSimulatorRuntime.ts` l.844–930). |
| 4d5b196a8 | runtime | `endPull` names the model it was pressed on. |
| 2f1a1f3b6 | worker, viewport | A pose keeps the camera where the pull left it. `holdFraming` (l.2275) starts at a press (l.1396) and stays after a kept pull (l.1425). |
| 593608814 | UI | The Pull tool itself: <ul><li>the catalog entry (key U, `tools/catalog.ts` l.64–78);</li><li>`engines/pullGesture.ts`;</li><li>`useSimulatorPull.ts`, which is store-free;</li><li>Spring back;</li><li>a "Pin faces first" state in the tool window;</li><li>a Pull badge on the rail while posed;</li><li>`.clear` renamed to `.action` in `SimulatorToolWindow.module.css`;</li><li>`simulator.tool.pull` (U) and `simulator.pull.springBack` (unbound).</li></ul> |
| 6ac8c05bd | analytics | Adds `simulator model pulled`, `simulator pull refused` and `simulator pose released {source}`. |
| 63cbfae06 | i18n | Pull strings in the eight other catalogs. |

**What it does to today's Pose: nothing visible** *(inferred)*. Pose passes no
tools, so its runtime never pulls, and `endPose` on a fold change does nothing
when nothing is posed. Main still keeps every tool in Simulate. Inline windows
and folded figures decline the tool verbs: `runSimulatorShortcut` returns false
without `handlers.tools` (`useSimulatorShortcuts.ts` l.140–165, main).

**Merging it.** `git merge-tree --write-tree HEAD origin/main` (tree 8b1bb54e)
reports three textual conflicts, all small:

- **`public/locales/.hashes.json`.** It is generated. Take either side, then
  run `i18n:stamp`.
- **`simulator/SimulatorToolWindow.module.css`.** The branch moved `.heading`
  and `.instructions` into `components/ui/tools/ToolHintInstructions`
  (63a33b65b), and main renamed `.clear` to `.action`.
  - Keep main's `.action`, with its comment, and keep `.notice`.
  - Drop `.heading` and `.instructions`.
  - The auto-merged `SimulatorToolWindow.tsx` uses only `.section`, `.action`
    and `.notice`. `liveSelectors.test.ts` will catch a miss.
- **`simulator/useSimulatorRuntime.ts`.** The conflict is in the imports only
  (~l.28–39). Take the union: the branch's still-scene types plus main's pull
  types.

These files changed on both sides and merged without conflict, so read them
anyway:
- `simulatorSession.ts` and its test;
- `keyboard/shortcuts.ts` and `i18n/shortcutLabels.ts`;
- `analytics/events.ts`, `analytics/index.ts` and `docs/analytics.md`;
- `SimulatorToolWindow.tsx`;
- 27 locale JSONs.

**The interaction git cannot see.** The branch's worker `sessionScene`
(`simulatorSession.ts` l.1569–1590, HEAD) draws `originalPositions` whenever
`foldPercent === 0`. After #438 a sheet at 0% is not always flat:
- it may be posed;
- pins set at 40% hold their faces where they were through a scrub back to 0.

The fix is the guard `foldPercent === 0 && !backend.posed && !pinnedNodes`.
(`pinnedNodes` is a `Uint8Array`, or null when nothing is pinned.) No Diagram
path can reach this until Pose has tools, but it gets fixed with the merge, with
tests.

**One shared key.** U is now both `simulator.tool.pull` and
`diagram.toolFoldUnfoldArrow` (`keyboard/shortcuts.ts` l.605, HEAD). They are in
different scopes, and Annotate unmounts the Pose stage, so the two are never
live at the same time. The keyboard tests run anyway.

## Approach

### The shape of it

Main's tools are already layered, so a second host is mostly wiring:

1. **A pure core**, `simulator/tools/*`. It holds:
   - the catalog;
   - the descriptors in `actions.ts`: `simulatorToolButtons`,
     `simulatorToolWindow`, `simulatorToolMenuVerbs` and
     `simulatorCanvasLabels`;
   - press routing, the gesture engines, intents and pin sets.

   It knows nothing of React or the store, and this plan leaves it unchanged.
2. **One binding hook**, `useSimulatorTools`, together with the store-free
   `useSimulatorPull`. This is the only place a tool has effects. Its runtime
   is injected; its one tie to Simulate is `useWorkspaceStore` (all main):
   - it reads the store at l.177–179;
   - `pinsOf` (l.130–136) calls `getState()` synchronously, so a queued pick
     sees the pins as they are now;
   - it writes at l.265, 304 and 363 (`setSimulatorPins`), l.355
     (`setSimulatorActiveTool`) and l.371 (`setSimulatorToolOption`).
3. **Presentational surfaces** fed by those descriptors: `SimulatorToolRail`,
   `SimulatorToolWindow` (a `ToolHintWindow` that takes a `container`),
   `SimulatorToolsTrigger` and `simulatorMenuItems`.
4. **The viewport and the runtime**, neither tied to a host.
   - `SimulatorViewport` takes tools only through `toolInput` and `highlights`.
   - The runtime's pick, pin and pull calls work for any session, including
     the bitmap-present session Pose runs. *(inferred: `renderGpu` sets
     `view.drawn` in every present mode (l.2196, main), and `pickFaces` needs
     only `gpuRender` and `view.drawn`. No bitmap surface has ever run them.)*

The plan does three things with that:
- it cuts the one tie, with a state port;
- Pose mounts the same binding and the same surfaces;
- it adds what the Diagram needs and Simulate does not: a shape that is stored
  and can be restored.

**The hard part is not the wiring.** Two things depend on the path the paper
took:
- A pin holds a node *where it is when pinned* (`SolverBackend.setFixedNodes`,
  main).
- A kept pull's pose is made from the positions at the moment of let-go.

Today a simulated step stores only `{foldPercent, view}`. Without a stored
shape, every reload, undo, Pose Again and Refresh rebuilds an unpinned,
unposed model. Worse, the first orbit after reopening Pose silently writes over
the posed picture, because `wantsRest` compares only fold % and camera
(`poseController.ts` l.427–431, HEAD). Even a step no tool touched is solved
again to its fold % on every open, so a later solver change, or the GPU's
rounding, can show a mesh its picture was not drawn from. Hence D1: every
simulated step stores its mesh.

The work comes in three layers:

- **Shared, landing on main (D5):**
  - a tool-state port;
  - a `surface` property on the tool events;
  - a framing option;
  - an engine and worker that can read a shape and restore it.
- **The Diagram's model (#436):** `render.shape` on every simulated step, plus
  capture and Refresh that carry it.
- **Pose (#436):**
  - a tool state per step;
  - a hand hook beside `useDiagramSimulatedPose`;
  - the surfaces, placed by Zach's rules.

### The seam: tool state as a port

A new types-only file, `simulator/tools/toolState.ts`:

```ts
export type SimulatorToolSurface = 'simulate' | 'diagram-pose';

/** What a host keeps for the tools. Reads are synchronous: a queued pick reads the pins as they are now. */
export interface SimulatorToolState<Scope> {
  subscribe(listener: () => void): () => void;
  /** Stable between changes (useSyncExternalStore). */
  getSnapshot(): { activeToolId: SimulatorToolId; options: SimulatorToolOptions };
  /** Stable identity between changes. */
  getPins(scope: Scope): PinSet;
  setPins(scope: Scope, faces: PinSet): void;
  setActiveTool(id: SimulatorToolId): void;
  setOption(id: SimulatorToolOptionId, value: boolean): void;
}

/** What the hand did to the paper, reported once the worker has answered, never on the gesture. */
export type SimulatorHandChange =
  | { kind: 'pins'; faces: PinSet }
  | { kind: 'pull-kept' }
  | { kind: 'spring-back' }
  | { kind: 'pose-ended'; why: SimulatorPoseEnd };
```

**The binding.** `useSimulatorTools.ts` keeps its body. That body becomes
`useSimulatorToolBinding<Scope>`, which takes the existing options plus
`{ state, scope, surface, onHandChange? }`.
- It reads through the port: `useSyncExternalStore` for the snapshot and for
  the bound scope's pins, and `state.getPins` wherever `pinsOf` read the store.
- `BoundModel` pairs the model with the `scope` that was current when the model
  arrived, as it pairs `(revision, sourceKey)` today.
- The body stays in the same file, so the diff is the store reads and nothing
  else, and blame survives.

**Simulate's wrapper keeps its exact signature.** `useSimulatorTools(options)`
calls the binding with:
- `SIMULATE_TOOL_STATE`, from a new `simulator/simulateToolState.ts`: the
  workspace slice behind the port. It keeps the revision-wipe behaviour of
  `simulatorPinsFor` and `setSimulatorPins` (`simulatorSlice.ts` l.32–39 and
  76–80, main);
- scope `{revision, sourceKey}`;
- surface `'simulate'`.

So `useSimulatorTools.test.tsx`, which drives the real store, passes
**unmodified**, and that is the proof Simulate did not change. One new test
drives the binding through a fake port.

**`onHandChange` fires only after the worker has answered:**
- `setPinnedFaces` resolved, carrying the faces;
- `endPull('keep')` resolved;
- `releasePose` resolved;
- a frame's `poseEnded`.

`useSimulatorPull` gains the callback for the last three. A refused pick, or
one that is rolled back, never fires it.

**Two small shared helpers**, so neither host copies Simulate's wiring by hand
(`SimulatorPanel.tsx` l.242–264, main):
- `simulatorToolsRuntime(runtime)`: the eight runtime fields the tools call;
- `viewportToolHooks(viewportRef)`: `pickDrawn`, `drawnCamera` and
  `cancelGesture`.

Each host then makes three calls: the binding, `useSimulatorToolActions`, and
`simulatorCanvasLabels`.

**Analytics.** Every `trackSimulatorTools` event gains `surface`: ten events,
the picker's included. This lands **with** the seam, before any Diagram session
forwards frames to `observeFrame`. Otherwise `simulator solver recovered` and
`simulator pinned fold moved` would start counting Pose as Simulate.

### What a step stores

One field on the simulated render (`diagram/document/diagramDocument.ts`
l.146–152, HEAD), optional only because older steps lack it:

```ts
render: { mode: 'simulated'; foldPercent; view; shape?: DiagramSimulatedShape }

interface DiagramSimulatedShape {
  /** Minted when the hand last changed the paper, or by the first capture of paper it never touched; adopted on restore. What a rest is compared by. */
  id: string;
  /** The region's flat sheet this shape belongs to (`simulatorSheetKey`). */
  sheet: string;
  /** Each pinned face as a point inside it on the flat sheet, relative to the sheet's corner. Empty when nothing is pinned. */
  pins: readonly (readonly [number, number])[];
  /** A kept pull holds: Spring Back applies. */
  posed: boolean;
  /** Versioned base64: Float32 node positions (×3), then crease angles, in the sheet's canonical order. */
  state: string;
}
```

**Present on every simulated step this build captures** (D1): pinned, pulled
or untouched. An untouched step stores the mesh it was captured from, with no
pins and `posed: false`, so reopening Pose shows exactly that mesh instead of
solving to the fold % again. A step is *shaped by hand* when its shape has pins
or is posed; "shaped" means that in the rest of this plan.

**An older simulated step has no shape.** One saved before this build keeps
re-simulating to its fold %, as today, until it is next captured: a rest in
Pose, a Refresh, or Show as. Opening Pose does not backfill it, silently or
otherwise. *Decided* (Zach, 2026-10-07: "please just go with your recommended
answers for everything").
- Opening Pose writes nothing today (Phase 0 checked it). A backfill would make
  opening an undo step and a changed file, for a picture that did not change.
- The mesh a backfill stored would be a fresh solve, not the one the picture
  was drawn from: it would record the very drift this decision is for.

**It stores positions and crease angles, not gestures.**
- A pull depends on its path. Main's plan notes that cancel restores rest
  angles, not positions.
- Pins replayed from flat give a different shape from pins set mid-fold.
- Crease angles are stored as well as positions. Both backends unwrap θ against
  its last value with a ±5 rad threshold, starting from `thetaInit = 0`
  (`referenceSolver.ts` l.378–397; `passes.ts` ~l.128–133; WebGL keeps θ in
  `u_lastTheta`). *(inferred: a restore that recomputed θ from positions alone
  could put a crease folded near 180° on the wrong side, and the fold target or
  Spring Back would then drive it the long way round.)*

**It is keyed by the flat sheet, not by numbering.** The Diagram's rule is
"Links are geometric, never ids" (`diagram-workspace.md` l.77).
- The worker orders the nodes canonically by their flat position relative to
  the sheet's lower-left corner, quantised to a millionth of the sheet's size,
  as `relativeCreaseFingerprint` does.
- It orders creases by their canonical pair of end nodes.
- `sheet` digests that order, the triangles, and each crease's target angle.

Equal keys mean node *i* is the same node in both. As a result:
- a step that follows its moved sheet (`followedScope`, `captureCreases.ts`
  l.206) keeps its shape;
- a renumbered region still restores;
- any change to the region's creases or triangulation drops the shape instead
  of scrambling it.

Each pin is stored as a point: the centroid of one of the face's triangles.
That point is strictly inside even a non-convex face, and on restore it is
resolved back to a face by point-in-triangle.

**Size.** 12 bytes per node plus 4 per crease, times 4/3 for base64, plus the
id, the sheet key and any pins. *(Estimated from mesh counts, not measured.)*
- **Per step.** The crane's whole sheet (186 vertices and 396 edges in
  `artifacts/diagram-phase4/crane.osf`) is about 5 KB. A large region is tens
  of KB: 2,000 nodes and 6,000 creases make 64 KB. The writer refuses a shape
  over 1 MB, around 30,000 nodes. The picture beside it is bounded by
  `SCENE_JSON_MAX_BYTES` (4 MB, `diagramFile.ts` l.448, HEAD).
- **Per file.** Zach's crane diagram has one simulated step in 20 (step 5, a
  small segment whose stored scene is 4.6 KB), so its shape is well under
  1 KB on a 2.49 MB file: under 0.05%.
- **The budget is the whole file's, as the enlarged steps' faces are** (Z11,
  `diagram-revision-2.md`). With every simulated step captured with its shape,
  the `.osf` grows by at most 1%, the shapes as the file writes them. There is
  no cap per step beyond the writer's 1 MB.
  - `state` is one string, never a JSON array: the project file is
    pretty-printed (`serializeNativeProjectFile`), a number to a line.
  - It is weighed on Zach's diagrams, which are not committed, the way 16c's
    `artifacts/revision-2/16c/writer/budget.mjs` weighs faces: every simulated
    step recaptured, the file saved by the app.
  - If a diagram breaks the 1%, the budget is not raised: the numbers go to
    Zach. The lever then is lossless (deflate before base64), never fewer bits,
    which would give up the exact mesh this is for.

**File format.** `CP_RENDER_FIELDS.simulated` (`diagramFile.ts` l.444, HEAD),
`readCpRender`'s validation and the writer all change together. An older build
reads every simulated step this build writes as a newer build's locked step
(3fc2e4f36). That is fine while #436 is unreleased. A file without shapes
still reads, its simulated steps as older ones (above).

**Lifecycle.**
- One rest is still one "Adjust pose" undo step. A pin edit or a pull is
  committed with the rest that follows it.
- Reset Pose keeps a shape rather than dropping it: a fresh, unshaped one at
  the reset fold % (0%, the flat sheet), with a new id. In Pose the session
  follows through `restoreShape`, which lets go of the pins and the pose.
  `isDefaultRender` (`diagramLinkedPoseActions.ts` l.405–413, HEAD) no longer
  asks for the shape to be absent; it asks for no pins and no pose.
- Showing the step another way and coming back recaptures its shape.
  `renderToShowAs` (`diagramDocument.ts` l.376–389) keeps only the camera and
  rebuilds at 0%, and that headless capture stores the flat sheet's shape. The
  pins and the pose are let go.
- Duplicate as Simulated captures its own, the same way. A plain duplicate of
  a simulated step copies its render, shape included.
- Back to Flat keeps the pins, because the worker keeps the fixed-node mask
  through a reset. It ends a pose.

**Not stored:**
- the tool in hand;
- Select through all layers, which is a device preference;
- notices;
- material. Pose keeps `DEFAULT_SIMULATOR_SETTINGS`
  (`useDiagramSimulatedPose.ts` l.61, HEAD). A pull's result depends on the
  material, which is one more reason to keep it fixed;
- the pin tint, which captures never carry.

### The engine and worker: read a shape, restore it

All of this is our own addition, like Pull, with no upstream parity to keep.

**Engine** (`packages/origami-simulator`). Both backends gain
`SolverBackend.readShape(into)` and `writeShape(shape, keep)`. `writeShape`:
1. writes positions, and the Verlet history with them;
2. zeroes velocities (`arrestDynamics`);
3. writes θ: channel 0 of `u_lastTheta` on WebGL, or the reference solver's last
   θ;
4. recomputes normals;
5. if `keep`, runs the existing keep path: `keepShape` on the reference
   backend; `writeRestAngles`, then `keepInPlaneShape`, then `setPose(true)` on
   WebGL.

Tests, on both backends:
- a restored shape holds still: the maximum displacement over N steps stays
  under ε, with and without `keep`;
- a 100% bird base round-trips with every crease on the side it started;
- Spring Back after a restore goes the short way round;
- `bench:pull` is unchanged.

**Worker** (`simulator/simulatorSession.ts`):
- **A load option `framing: 'anchor' | 'shape'`**, defaulting to `'anchor'`,
  which is today's behaviour. Under `'shape'`:
  - pins never anchor the framing (no `anchorFraming`; l.1327, main);
  - a press still holds the framing (l.1396);
  - letting go releases the hold even when the pose is kept (l.1425).

  A test checks that `'anchor'` frames stay byte-identical.
- **A load option `shape`**, applied before the first frame. When its sheet
  key does not match, the session folds from flat, as it does today, and the
  load says `'mismatch'`.
- **`restoreShape(token, {foldPercent, shape | null})`, one atomic call:**
  1. End any pose quietly, with a new `poseEnded: 'restore'` that no analytics
     counts.
  2. Set the fold target.
  3. With a shape: write it, resolve its pin points to faces, and fix those
     faces. With `null`: release the pins, reset and refold. This is the free
     path, for an undo back to an older step with no shape, so it does not
     keep the orientation the pins left behind.

  It answers `{pins: faceIds, posed}`, `'mismatch'` or `null`.
- **`sessionScene` returns `{scene, shape}` from one call**, so the picture and
  its record come from the same moment. It also gets the 0% guard above, and
  the shape follows it: at 0% with nothing pinned or posed, the shape is the
  flat sheet's, so an untouched 0% in Pose stores what the headless 0% stores.
  - While a pull is in hand it answers `pulling` instead, and the rest
    re-arms.
  - With `settleSteps` (Pose closing) it cancels the grip first, so 20,000
    settle steps never run toward a cursor.
- **`shapeScene(fold, shape, options)`**, the headless sibling of `flatScene`
  (l.1555, HEAD): it redraws the step's region in new light without opening
  Pose.

**Runtime** (`useSimulatorRuntime`):
- `initialShape`, read at load the way `solverOptions.foldPercent` is, so a
  reload after eviction restores the last captured shape;
- `restoreShape`;
- `stillScene` answering `{scene, shape}`.

### Capture: when a rest is new

- **The hand's identity is an id minted on the main thread.** A new id is
  minted when the hand changes (`onHandChange`), or when the fold target moves
  while something is pinned or posed. When a stored shape is restored, the id
  is adopted from `render.shape.id`.
  - It is not a content hash. It is known before the scene is drawn, which
    matters because `wantsRest` decides whether to draw at all, and it never
    jitters with solver noise.
  - A session opened on an older step, with no shape, has no id until its
    first capture, which mints one. So opening it compares equal and writes
    nothing.
- **Comparing rests.** `SimulatedRest` (`poseController.ts` l.172, HEAD) gains
  `hand: string | null`. `wantsRest` (l.427) and `sameSimulatedPose` (l.677)
  also compare it with `render.shape?.id ?? null`.
- **Capturing: every capture stores a shape.**
  - `StillScene` (`captureFolded.ts` ~l.157, HEAD) answers `{scene, shape}`.
  - `captureSimulated` puts the shape in the render it returns, with the rest's
    `hand` as its id. So every path that captures a simulated picture writes
    one: Pose's rest, and the headless 0% of Show as, Duplicate as and Reset.
  - `flatStill` answers the flat sheet's shape: flat positions, every θ zero,
    no pins, not posed. It needs no solve.
  - A new `shapeStill` beside it redraws a step from its stored shape,
    headless.
  - **`readShape` runs on every capture in Pose**, not only a shaped step's.
    `sessionScene` already reads the positions back to draw, so what it adds
    is θ's readback, the canonical reorder and the encoding, once per rest.
    The simulator PR (Phase 3) is measuring that cost.
- **Refresh** (`linkStatus.needsPose`, l.48, HEAD).
  - Any step with a shape and a current link redraws headless in new light
    through `shapeStill`, at any fold %. Its shape is kept as it is, id and
    all; only the picture changes. Above 0% that no longer needs Pose.
  - An older step with no shape needs Pose above 0%, as today.
  - A stale one needs Pose, and there the sheet key decides whether the shape
    survives.

### Pose's binding

- **`diagram/capture/poseToolState.ts`** (new, pure):
  `createPoseToolState()` returns a `SimulatorToolState<{stepId}>`.
  - The tool in hand is Pose's own and starts on Orbit. There is one per
    mounted step, because the view is keyed by `step.id`.
  - Options delegate to the workspace's `simulatorToolOptions`.
  - Pins are Pose's own, seeded by the restore.
- **`diagram/capture/useDiagramSimulatedHand.ts`** (new). It sits beside
  `useDiagramSimulatedPose`, which is already 516 lines. It:
  - owns the hand id;
  - restores on every open: when the stored shape's sheet key matches, the
    session starts from it, and the hand adopts its id and its pins;
  - on a mismatch, lets the session fold from flat with a notice (for a
    shaped step, that its pins and pose were let go; for an unshaped one, that
    it was folded again from flat), and sends
    `diagram simulated shape dropped`. The hand still adopts the stored id,
    so opening writes nothing, and the next capture replaces the shape.
    *(inferred: a changed pattern also makes the step out of date, so its
    first rest recaptures it through `needsRecapture`, as Pose Again does
    today.)*
  - ignores the `pins` acknowledgement that equals the set it seeded;
  - turns `onHandChange` into a new id plus the existing `moved()`.
- **`useDiagramSimulatedPose`** (HEAD):
  - the runtime (l.293–301) gets `framing: 'shape'`, and `initialShape`, the
    step's stored shape, on every open;
  - `handleFrame` (l.280–291) forwards frames to `tools.observeFrame`;
  - one `useSimulatorToolBinding` call, with `surface: 'diagram-pose'`;
  - `useSimulatorShortcuts` (l.481–496) gets `tools: tools.shortcuts`;
  - undo-follow (l.340–365) calls `restoreShape` instead of `setFoldPercent`
    whenever the fold % or the shape differs: with the render's shape, or
    `null`, the free path, for an older render with none.

  The close-capture effect stays declared before the runtime (l.265–278), so
  its scene is requested before the model goes away.

### How Pose presents the tools

Zach's rules apply: Pose's verbs live on Pose's toolbar, the Step pane holds
fields, and the look stays quiet and compact. Tools are pointer modes, and the
Diagram already puts modes on a rail beside the canvas: Annotate's
`DiagramAnnotateRail`, as Simulate and Edit do. The recommended layout (D2)
follows; a mock of the options comes before Phase 7.

- **Stage** (`DiagramPoseStage` gains a `rail` slot and a `hint` prop).
  - Simulate's `SimulatorToolRail` (Orbit, Pin, Pull, with its badges) runs down
    the left edge, where Annotate's rail sits.
  - `SimulatorToolWindow` is anchored to the stage. It shows:
    - the instructions;
    - Select through all layers;
    - Pull's "Pin faces" prompt;
    - the strained and recovered notices.
  - The hint and the aria label follow the tool (`simulatorCanvasLabels`).
    "Double-click to reset" shows only under Orbit, as in Simulate.
- **Pose bar** (`DiagramLinkedPoseControls`): Show | transport |
  **Clear Pins, Spring Back** | Reset Pose.
  - Clear Pins and Spring Back change the picture, so they are Pose verbs.
  - They are always there for a simulated step. When there is nothing to act
    on, they are refused with a hint, the Diagram's convention
    (`diagramLinkedPoseActions.ts` l.164–172, HEAD).
  - They come from a new React-free `diagram/actions/diagramSimulatedHandActions.ts`.
    The same module drops those two sections (`pins` and `pose`) from the tool
    window, and drops the window entirely when nothing is left in it.
- **Phone:** no rail. `SimulatorToolsTrigger` (the Tools pill and its sheet)
  comes first on the Pose bar.
- **Context menu** (D4): Simulate's rows, from `simulatorMenuItems` with
  `settings: null`, on `useContextMenuController('diagram-pose')`.
- **Step pane** (D4): for a shaped step, a read-only line such as
  "Pinned: 3 faces · Pulled by hand". It has no verbs.

### Tool by tool

| Simulate workspace | In Pose? | Where | Stored or transient |
| --- | --- | --- | --- |
| Orbit (O, the resting tool): drag orbits, Shift-drag rolls, wheel zooms, double-click resets | Yes. It is already Pose's only drag behaviour; roll is still absorbed into `orient` | Rail, first. Pose opens on it | Transient. The camera goes into `render.view`, as now |
| Pin (P): a box pins the faces in it, Shift-box adds, a click takes the front face, Shift-click toggles; on touch, a tap toggles | Yes | Rail | Stored: pins as sheet points in `render.shape`, with the positions they hold |
| Pull (U): drag against the pins; letting go keeps the pose; Esc cancels; refused with no pins | Yes | Rail | Stored: `posed` plus positions and crease angles |
| Spring back | Yes | Pose bar, refused with a hint while not posed; also the context menu | Its effect is stored at the next rest |
| Clear pins | Yes | Pose bar, refused with a hint while nothing is pinned; also the context menu | Its effect is stored at the next rest |
| Select through all layers | Yes | Tool window | A device preference shared with Simulate. Not step data |
| Tool window: instructions, Pin-faces prompt, notices | Yes, without Clear and Spring back | Anchored to the stage; collapses together with Simulate's window | Transient |
| Strained and recovered notices | Yes | Tool window | Transient |
| Navigation under any tool: middle-drag or Cmd-drag, Shift roll, wheel | Yes, from the viewport | Stage | The camera is stored, as now |
| Escape ladder | Yes: gesture, then Orbit, then the Diagram's own Escape | Keys | Transient |
| Phone Tools pill and sheet | Yes, on a phone | First on the Pose bar | Transient |
| Context menu | D4 | Stage | No |
| Transport: Restart, Play/Pause, Step, slider, %, and their keys | Already in Pose (Back to Flat, Play, Fold a Step, slider) | Pose bar | Fold %, stored as now |
| View cube | Already in Pose | Stage | The camera |
| F, C, L (faces, crease lines, lighting) | No. They stay claimed and do nothing, as today | | The diagram's style owns the look |
| Set upright | Not in v1 (D4) | Later, as Pose's Upright verb applied to `view.orient` | |
| Export view… | No | | The Diagram exports pages and steps |
| Render: X-ray, Strain colour, Faces, Crease lines, Lighting, View cube toggle | No | | The picture is drawn in the diagram's style. A screen-only aid would make the view differ from the picture |
| Paper colours, crease pens | No | | `diagramPaperStyle` owns them |
| Material (Stretch, Crease, Facet, Face, Damping) and Solver (Stability, Play speed) | No | | Fixed to `DEFAULT_SIMULATOR_SETTINGS`. Pull results depend on them |
| Readouts: vertices and triangles, step, strain, GPU/CPU | No | | The strained notice carries the one an author can act on |
| Restart that rebuilds after an error | No | | Pose's restart is a rewind plus a view reset |
| Segments sidebar | No | | A step's region is its source; Relink changes it |
| Canvas-2D (CPU) fallback | No | | Pose stays GPU-only. With no GPU (`no-gpu`) it shows the stored picture, and the tools inherit that limit |

### Keys

While Pose's simulator holds the keyboard:
- O, P and U pick the tools.
- Escape cancels a gesture first, then returns to Orbit, then falls through to
  the Diagram's Escape, which closes the detail.
- Space, the arrows, Home/0, R and +/- work as they do today.
- F, C and L do nothing, as today.
- Clear pins, Spring back and Select through all layers stay unbound, as in
  Simulate.

Workspaces never mount together: `activateWorkspace` clears Dockview before
loading the next layout (`store/layoutStore.ts` l.626, HEAD). So Simulate's
executor and Pose's never compete for the single executor slot *(inferred)*.

### Analytics

- **`surface: 'simulate' | 'diagram-pose'`** on the ten `trackSimulatorTools`
  events, landing with the seam.
- **A `'pose-toolbar'` source** on `SimulatorPinsClearSource` and
  `SimulatorPoseReleaseSource`.
- **`hand: 'none' | 'pinned' | 'posed'`** on `diagram picture posed` for a
  simulated step.
- **New: `diagram simulated shape dropped {reason, hand}`**, where the reason
  is `pattern-changed` or `model-changed`, and `hand` is the stored shape's
  (`'none'` for an unshaped one).
- **`'diagram-pose'` as a context-menu surface.**
- **A restore must not log `simulator pose released`.** That is why it ends the
  pose with `'restore'`.
- Update `analytics/events.ts`, `docs/analytics.md`, and the PostHog insights
  that filter Simulate's tool events. Old data has no `surface`; read a missing
  one as `'simulate'`.

### i18n

**Reused:** `panels:simulator.tools.*` (rail, window and labels),
`toasts:simulatorPins.*`, `toasts:simulatorPull.failed`, and the shortcut labels
in `tools.json`.

**New, in all 9 catalogs:**
- Pose-bar labels in the bar's Title Case: Clear Pins, Spring Back.
- Their refusal hints:
  - "Nothing is pinned";
  - "The paper isn't posed".
- The Step pane line.
- The dropped-shape toasts: "Its pins and pose were let go: the pattern
  changed", and for an unshaped step, "Folded again from flat: the pattern
  changed".

Then run `i18n:extract`, `i18n:stamp` and `i18n:check`.

## Decisions for Zach

Numbered so picks can be pasted back.

**D1. Should a step shaped by hand keep its shape? DECIDED: A, on every simulated step** (Zach, 2026-10-06: "As long as it's not really expensive to do, I agree with A." Then, asked whether every simulated step should save its shape, or only the ones pinned or pulled: "I think every one". So every simulated step stores `render.shape`, with empty pins and `posed: false` when untouched, and reopening Pose shows exactly the captured mesh rather than solving to the fold % again, whatever a later solver or the GPU's rounding would make of it. The cost is a few KB a step under a whole-file budget: see What a step stores.)
- **A.** Store it in `render.shape`: pins as points on the sheet, positions and
  crease angles, and whether it is posed. Reopening, undo, Pose Again and
  Refresh in new light all give the same picture. A changed pattern drops the
  shape, with a notice. The engine and worker need a restore.
- **B.** Capture only. The picture is the record. Reopening starts from the
  fold, marked "Shaped by hand", and the first move recaptures without the
  shape.
- **C.** Pins only, stored as points, with no Pull in Pose. Pins are replayed
  at the fold %.
- **Recommendation: A.** Even pins alone change the picture, because they hold
  faces where they were when pinned, and a pull depends on its path. Under B, a
  pose is lost to the first orbit, an undo or a change of light; guarding
  against that would make the step untouchable. C leaves out the tool that
  poses a diagram step: "pin a crane's body, pull one wing down", in main's own
  plan. The engine cost is small, because both backends already build a pose
  from the current positions.

**D2. Where do the tools sit in Pose? DECIDED: A** (Zach, 2026-10-06: "yep A"; no mock needed.)
- **A.** Simulate's rail (Orbit, Pin, Pull) down the stage's left edge, where
  Annotate's rail sits, with the Tools pill on a phone. Clear Pins and Spring
  Back go on the Pose bar, refused with a hint when they don't apply. The tool
  window keeps the instructions, Select through all layers, the Pin-faces prompt
  and the notices.
- **B.** An Orbit | Pin | Pull group on the Pose bar, with Clear Pins and Spring
  Back beside it, and the window kept for instructions.
- **C.** Simulate's layout exactly: the rail, with Clear pins and Spring back
  inside the tool window and nothing new on the bar.
- **Recommendation: A.**
  - Tools are modes, and modes sit on a rail everywhere else: in Annotate in
    this same detail, in Simulate, and in Edit.
  - Clear and Spring Back change the picture, so by your rule they belong on
    Pose's bar.
  - B makes a bar that already holds Show, the transport and Reset wrap on a
    phone. C hides picture-changing verbs inside a hint that collapses.
  - The rail is Simulate's own `SimulatorToolRail`, not the Diagram's
    `ui/ToolRail`, because these are the same tools the Simulator workspace
    has. Three tools also have nothing to group under that rail's headers.
  - The cost of A is two icons on the phone bar.

**D3. How should Pose's live view frame a pinned or pulled model? DECIDED: A** (Zach, 2026-10-06.)
- **A.** Frame it the way its capture does, on the shape. Pins never anchor the
  camera. Framing holds only while a pull is in hand, then eases to fit.
- **B.** Frame it the way Simulate does: anchored to the pins and held after a
  pull. The capture then has to follow the live framing.
- **Recommendation: A.** In Pose the view is the picture, and the annotation
  ghost (`simulatedCaptureFrame`) assumes that. B would change D19's capture
  and break the promise that a 0% capture in Pose is the headless 0% picture.
  The cost of A is a short ease after you let go of a pull. Simulate keeps its
  behaviour, because framing is an option per session.

**D4. Which other parts of Simulate does Pose get? DECIDED: A, plus the tool hint window** (Zach, 2026-10-06: "A, it should also get the like tool hint stuff in the bottom right, 'cause that's where like the pen tools render." Pose shows Simulate's tool window — instructions, notices, the Pin-faces prompt — in the shared tool hint window at the bottom right, where the Diagram's other tools put theirs.)
- **A.** Three things now:
  - the context menu: Simulate's rows, without the View submenu;
  - a read-only Step pane line for a shaped step, "Pinned: 3 faces · Pulled by
    hand";
  - Set upright later, as Pose's Upright verb.

  No render, material or solver settings, and no Export view.
- **B.** The rail and the bar only: no context menu and no Step pane line.
- **C.** A, plus X-ray and strain colour as screen-only aids.
- **Recommendation: A.**
  - The menu reuses registry ids and existing strings, and keeps right-click
    the same as in Simulate.
  - The Step pane line tells you why Reset or Show as would change more than
    the camera.
  - Render and material settings would make the picture depend on preferences
    the step does not store, which is why Pose fixes
    `DEFAULT_SIMULATOR_SETTINGS`.

**D5. Where does the shared work land? DECIDED: A** (Zach, 2026-10-06: "This PR is already huge, I'd rather have an agent work in isolation on the simulation stuff." PRs 1 and 2 are built in their own worktree off main.)
- **A.** Two small PRs to main first, then merge main into #436 and build the
  Diagram part there:
  1. the tool-state port, `surface` on the tool events, and the framing option;
  2. reading and restoring a shape in the engine and worker.
- **B.** The port on main; the shape API in #436.
- **C.** Everything in #436.
- **Recommendation: A.**
  - These are main's busy files: #437 and #438 both rewrote
    `useSimulatorTools.ts`, `simulatorSession.ts` and the backends.
  - Since the merge-base the branch has not touched `useSimulatorTools`,
    `tools/*` or the backends, so merging back stays clean.
  - Simulate gets its proof, and the `surface` property, in a review of its own.
  - The cost: the shape API sits unused on main until #436 lands. It is tested
    on its own terms, and it is also what "a pose surviving a reload" in
    Simulate would need later.

## Alternatives considered

- **One embeddable "simulator surface"**: runtime, transport, menu and tools in
  one controller, with Simulate and Pose as hosts. Not chosen.
  - It rewrites Simulate's 786-line panel to get tools into Pose.
  - Its host adapter would carry about a dozen knobs.
  - It moves the runtime out of Pose's hook, which breaks the order of the
    closing capture.
  - Admitting tools by declared effect is speculative.

  Two of its ideas are kept: storing θ, and the atomic restore.
- **A Pose-only copy of the tool logic**, about 240 lines. Not chosen. The pin
  rollback, the pick queue and the binding to a model that has since been
  replaced are async ordering that must not fork.
- **A Diagram component rendering the same tool descriptors as buttons on the
  bar.** Not chosen: it is a second presentation of one tool set. If D2 picks
  B, `SimulatorToolRail` gains an orientation instead.
- **Sharing Simulate's store slice.** Not chosen.
  - `setSimulatorPins` wipes every other source when the revision changes.
  - Picking Pin in a step would change Simulate's tool in hand.
- **Pins as face ids, guarded by vertex count or the crease fingerprint.** Not
  chosen. Ids are not stable (D3's rule), and a same-count reordered model would
  scramble rather than drop.
- **A content hash of the positions as the rest's identity.** Not chosen: it is
  unknown before the scene is drawn, and it jitters with solver noise.
- **A bundling `useSimulatorToolHost` hook.** Not needed. With the two helpers
  each host is three calls, and a bundling hook would take the whole runtime
  and the viewport ref to save nothing.
- **A shape only on steps the hand touched**, this plan's first draft. Not
  chosen (D1): an untouched step would be solved again to its fold % on every
  open, so a solver change or GPU rounding could move a picture nobody
  touched, and only Pose could refresh it above 0%.
- **Keeping pins across a pattern change**, by re-resolving their points on the
  new model. Not proposed: re-applied pins at the stored fold % do not give the
  picture, and a stale step is posed again anyway.

## Risks

- **Restore fidelity.** On WebGL, θ lives in a texture and positions carry
  Verlet history; a mistake shows as a restored pose that creeps. Mitigation:
  the engine tests on both backends come first, and nothing depends on them
  until they pass.
- **Every simulated step rides on the restore** (D1), not only shaped ones, so
  a restore bug would show on every reopen. Mitigation: a mismatch or a failed
  restore falls back to folding from flat, as today, with the notice; and the
  older-file path, which never restores, stays tested.
- **File growth.** Every simulated step grows by its shape. Mitigation: the
  whole-file 1% budget, weighed on Zach's diagrams before the writer lands.
- **Bitmap-present picks and pulls have never run** on a shipped surface *(inferred to work)*.
  Pose is the first. Mitigation: a browser check in Phase 6, through the keys,
  before any UI exists.
- **Ties in the canonical order.** Two nodes can share one flat point (a slit).
  Mitigation: break the tie by their triangles' centroids, with a test. When
  the order is still ambiguous, the key says so and the shape drops.
- **The ease after a pull (D3 A).** It is a visible settle that Simulate does
  not have. Mitigation: look at it in the browser.
- **The shared GL context.** The pin tint is set per session on the
  `OffscreenCanvas` that Edit's inline windows and the 3D Pose view share.
  Mitigation: check it never leaks into another session's frame or into a
  capture.
- **Eviction.** A hand change not yet captured lives only in the worker until
  the next rest, roughly 0.5–4 s. A reload in that window restores the last
  captured shape.
- **Undo granularity.** A pin edit that changes nothing visible still commits
  "Adjust pose" at the next rest, because the step's data changed. Mitigation:
  confirm this with Zach while building.
- **Escape and O/P/U.** Escape now leaves Pin or Pull before it leaves Pose.
  Mitigation: keyboard tests.
- **Analytics continuity.** Simulate's tool events gain a property, so check the
  dashboards that filter them.
- **File format.** The reader, writer and validation must land together.
- **Concurrent edits.** Other agents have uncommitted changes in
  `DiagramPoseSimulatedView.tsx`, `DiagramPoseStage.tsx`,
  `DiagramPose3dView.tsx`, `DiagramStepDetail.tsx` and `diagram/**` (enlarged
  steps). The merge and Phase 7 wait for their commits. No `git stash`: the
  stash is shared across worktrees.
- **Growth.** `useDiagramSimulatedPose` and `DiagramStepDetail` are already
  large. Behaviour goes into the hand hook and into pure modules; `max-lines`
  binds only `components/panels/**`.

## Affected Areas

**Shared, on main (D5):**
- `simulator/tools/toolState.ts` (new);
- `simulator/simulateToolState.ts` (new);
- `simulator/useSimulatorTools.ts`: the binding, the wrapper and the two
  helpers;
- `simulator/useSimulatorPull.ts`: hand changes;
- `components/panels/SimulatorPanel.tsx`: the helpers only;
- `analytics/trackSimulatorTools.ts`, `analytics/events.ts`,
  `analytics/index.ts`, `docs/analytics.md`;
- `simulator/simulatorSession.ts`: framing, `restoreShape`, the canonical sheet
  order and `simulatorSheetKey`;
- `simulator/useSimulatorRuntime.ts`;
- `packages/origami-simulator/src/solverBackend.ts`, `referenceSolver.ts` and
  `webgl/webglSolver.ts`, with their tests;
- `implementation-plans/simulator-tool-rail-and-pins.md` (~l.25–27, ~l.706) and
  `simulator-pull-tool.md` (l.21, l.505–508): scope notes pointing here.

**The Diagram's model (#436):**
- `diagram/document/diagramDocument.ts` and `diagramFile.ts`;
- `diagram/capture/poseController.ts`, `captureFolded.ts`, `linkedPose.ts` and
  `linkStatus.ts`;
- `diagram/actions/diagramLinkedPoseActions.ts` (`isDefaultRender`);
- `simulator/simulatorSession.ts`: `sessionScene`, `shapeScene` and the 0%
  guard;
- `store/workspaceStore/diagramCapture.ts`: the headless shape;
- `analytics/trackDiagram.ts`.

**Pose (#436):**
- `diagram/capture/poseToolState.ts` (new) and `useDiagramSimulatedHand.ts`
  (new);
- `diagram/capture/useDiagramSimulatedPose.ts`;
- `diagram/actions/diagramSimulatedHandActions.ts` (new);
- `components/diagram/DiagramPoseSimulatedView.tsx`, `DiagramPoseStage.tsx` and
  its module, and `DiagramStepPose.tsx` (D4);
- `keyboard/` tests;
- the 9 catalogs;
- `implementation-plans/diagram-workspace.md` (D19, Phase 8d).

## Checklist

Every phase gets:
- tests near what changed;
- analytics and i18n for what it adds;
- a browser before and after, with a confidence level for each fix;
- the dev-server link;
- a gate: green checks and evidence shared before the next phase.

Vitest runs in the web workspace under Node 22.

### Phase 0: merge main (#438) into #436

- [x] Wait until the enlarged-steps agents have committed: `git status` must be
  clean under `diagram/**` and `components/diagram/**`. No `git stash`.
  *As built:* clean; the merge started on eb36424b4.
- [ ] Before shots: **not taken.** The merge had already been started when
  this phase ran, so there was no pre-merge build to shoot. The after shots
  compare against what the crane's file holds instead: its step 5 picture
  (Simulated, 75.2%) was captured before the merge, and the undo walk below
  returns to that exact picture key.
- [x] `git -C <worktree> merge origin/main`: merge 2d7eb24f2.
  - `.hashes.json`: took this branch's side, then `i18n:stamp`. It stamped
    120 hashes, main's 15 Pull keys × 8 locales, and nothing else. Every hash
    in the result equals one side's, so no stale translation was marked fresh.
    Every key either side added or changed is present in all 9 catalogs.
  - `SimulatorToolWindow.module.css`: as planned. Kept main's `.action` and
    its comment and `.notice`, and dropped `.heading` and `.instructions`;
    the merged `SimulatorToolWindow.tsx` uses `ToolHintInstructions` and
    `.action`.
  - `useSimulatorRuntime.ts`: the union of the imports. The rest auto-merged:
    the branch's `stillScene` and main's pull lane (`beginPull`, `movePull`,
    `endPull` and `releasePose`) are both on the runtime.
  - The files that merged cleanly on both sides: typecheck, lint and the
    simulator, inline-simulation, diagram, keyboard and analytics suites
    passed before the commit, with the simulator package rebuilt
    (`build:simulator`; its `dist` is what the web app imports). No semantic
    conflict beyond the one below.
  - The commit kept git's message (`--no-edit`), not the planned subject.
- [x] A commit of its own: the `sessionScene` 0% guard, 4d8e0cafd.
  - It is the guard planned:
    `foldPercent === 0 && !backend.posed && !pinnedNodes` draws the flat
    sheet. Anything else reads the solver, settling it first when asked.
    `backend.posed` is true from a pull's press, so a pull still in the hand
    is covered too.
  - Both new tests failed before the guard, at their "not the flat sheet"
    assertion:
    - a sheet pinned at 40% (two far faces), then scrubbed to 0. With the
      pins cleared, it is `flatScene`'s picture again.
    - a pull kept at 0%, with its pins and then with them cleared, so
      `posed` alone is tested. After Spring back, it is `flatScene`'s
      picture again.
  - Plain 0% stays covered by the existing "same flat sheet with no session
    and from a session at 0%" test.
  - Not changed: the headless paths (`flatStill`, `DiagramStepPicture`,
    `isDefaultRender`). They read 0% as flat by design until a step stores a
    shape (Phase 5).
- [x] Checks: `lint:web`, `tsc --noEmit`, `i18n:check`, the whole web vitest
  suite (860 files, 11,453 passed, 13 skipped), the origami-simulator package (383 passed, 1 skipped)
  and its typecheck, and a production `vite build`. That build skipped `prebuild`'s wasm rebuild and the landing prerender: nothing Rust, wasm or landing changed. Nothing Rust or wasm changed on main.
- [x] After shots, `artifacts/diagram-second-pass/p29.mjs` →
  `artifacts/diagram-second-pass/29/`. Headless Chromium, SwiftShader GPU,
  against the :5291 dev server.
  - The crane's step 5 (Simulated, 75.2%):
    - Opening Pose wrote nothing.
    - The slider at 40% made one "Adjust pose" capture (~4.4 s), and so did
      0%.
    - Done kept 0%.
    - A headless Refresh at 0% gave a byte-identical `sceneJson` to Pose's 0%
      capture, so it added no undo step.
    - Undo walked 40% → 75.2%, back to the file's own picture key. Redo
      walked 40% → 0%.
    - No page or console errors.
  - Simulate, on the crane's pattern 10 (24 faces) at 60%:
    - P took Pin, and a box pinned 13 faces.
    - U took Pull, and a drag pulled the free flap (70k px changed). Letting
      go kept it, and Spring back appeared.
    - The frame 150 ms after letting go and the frame 3 s later look the same.
      They differ by 8k antialiased pixels, the sub-pixel settle
      `simulator-pull-tool.md` records.
    - Escape went to Orbit with the pose kept. The rail badged Pull, and
      Orbit's window offered Spring back.
    - Spring back cleared the pose and the badge.
    - U and Escape switched Pull and Orbit.
- [ ] Gate: push to the PR branch, never to main. Ready; Zach pushes.

### Phase 1: decisions and the mock

- [ ] Zach answers D1–D5. Record each answer here.
- [ ] Mock for D2: `artifacts/pose-simulator-tools/placement.html`
  (gitignored), showing A, B and C at 1280 and 375 px, light and dark, pinned
  and posed.
- [ ] Add Phase 8e to `diagram-workspace.md`, linking this plan.

### Phase 2: the tool-state port, on main (PR 1)

- [ ] Branch from main. Build:
  - `toolState.ts` and `simulateToolState.ts`;
  - `useSimulatorToolBinding`, with `useSimulatorTools` keeping its signature;
  - `onHandChange` in the binding and `useSimulatorPull`;
  - `simulatorToolsRuntime` and `viewportToolHooks`, adopted by
    `SimulatorPanel`.
- [ ] The framing option on the worker load, defaulting to `'anchor'`.
- [ ] Analytics: `surface` on the ten events, sent as `'simulate'` from
  Simulate. Update `docs/analytics.md`.
- [ ] Tests:
  - `useSimulatorTools.test.tsx` **unmodified** and green.
  - Binding tests through a fake port:
    - two quick picks;
    - a rejected set rolls back and reports no hand change;
    - the source changes before the model lands;
    - a hand change is reported after the worker answers.
  - Tests for the adapter.
  - `'anchor'` frames byte-identical; `'shape'` behaviour.
- [ ] Browser, before and after in Simulate:
  - Orbit;
  - Pin by box, Shift-box, click and Shift-click, and a touch tap at 375 px;
  - Pull and Spring back;
  - the tool window, the phone pill, the context menu and the keys;
  - pins after a segment switch.

  PostHog shows `surface: 'simulate'`.
- [ ] Amend the two simulator plans' scope lines. Gate: the PR to main is merged.

### Phase 3: read and restore a shape, on main (PR 2)

- [ ] Engine: `readShape` and `writeShape` on both backends, with the tests
  listed in Approach, and `bench:pull` unchanged. Measure `readShape`'s cost,
  which every capture in Pose now pays (D1), on the crane and a large region.
- [ ] Worker:
  - the canonical sheet order and `simulatorSheetKey`;
  - the `shape` load option and the atomic `restoreShape`;
  - `poseEnded: 'restore'`, ignored by analytics;
  - the runtime's `initialShape` and `restoreShape`.
- [ ] Tests:
  - a mismatch answers `'mismatch'`;
  - a moved sheet keeps its key;
  - a renumbered region restores;
  - a slit's tie is broken.
- [ ] Browser: there is nothing new to see. A before and after of Pull in
  Simulate shows nothing moved. Gate: the PR is merged.

### Phase 4: merge main into #436 again

- [ ] Merge, which should be clean. Re-run Phase 0's checks and the Diagram's
  before and after.

### Phase 5: the model, the file and capture (#436)

- [ ] `DiagramSimulatedShape` and `render.shape`, written on every simulated
  capture.
  - `CP_RENDER_FIELDS`.
  - `readCpRender` validation: the base64 length must be nodes × 12 + creases
    × 4; the id a string; the points finite; `posed` a boolean.
  - The writer's 1 MB cap.
  - Tests:
    - a round trip, shaped and unshaped;
    - an unshaped step round-trips its exact mesh: the same `state` bytes, and
      the same picture from `shapeStill`;
    - an older file with no shapes still opens, and its simulated steps read
      as before;
    - an older build reading the step as locked;
    - a refusal over 1 MB.
- [ ] The budget: a test beside `zoom/paperFacesBudget.test.ts` that a shape
  adds only its compact string to a file written as the app writes one; then
  every simulated step recaptured on Zach's diagrams, weighed against the 1%.
  A breach goes to Zach.
- [ ] Reset keeps a fresh flat shape; `isDefaultRender` asks for no pins and no
  pose; Show as and back, and Duplicate as Simulated, capture their own; a
  plain duplicate copies its shape. Tests.
- [ ] Capture and Refresh:
  - `sessionScene` returns `{scene, shape}`, with the 0% guard covering both;
  - `flatStill` answers the flat shape; `shapeScene`, `shapeStill` and
    `StillScene`;
  - `captureSimulated`;
  - `SimulatedRest.hand`, with `wantsRest` and `sameSimulatedPose` comparing
    it;
  - `needsPose`, and Refresh in new light, keeping the shape;
  - tests in `poseController`, `linkedPose` and `linkStatus`, including a
    headless Refresh at 0% that adds no undo step, as Phase 0 saw.
- [ ] Analytics: `hand` on `diagram picture posed`, and
  `diagram simulated shape dropped`.
- [ ] Browser:
  - an older step without a shape opens and re-simulates as before, and
    writes nothing;
  - once captured, it reopens to the same mesh, and refreshes headless in new
    light above 0%;
  - a fixture document with a shaped step refreshes headless in new light.

### Phase 6: Pose's binding (#436)

- [ ] Build `poseToolState`, `useDiagramSimulatedHand` and the wiring in
  `useDiagramSimulatedPose`.
- [ ] Hook tests with a fake runtime:
  - a rest follows only an acknowledged hand change;
  - reopening adopts the stored id and causes no capture;
  - reopening an unshaped step restores its stored mesh, not a fresh solve;
  - opening an older step with no shape re-simulates and causes no capture;
  - undo-follow makes one `restoreShape` call;
  - an undo to an older render with no shape takes the free path;
  - there is no rest while a pull is in hand;
  - closing cancels the grip;
  - a mismatch folds from flat with its notice, shaped and unshaped, and
    writes nothing on open.
- [ ] Keyboard tests:
  - O, P and U pick tools while Pose's simulator holds the keyboard;
  - Escape goes gesture, then Orbit, then closes the detail;
  - Annotate's O, P and U are unchanged.
- [ ] Browser, early, through the keys alone, because bitmap-present picks and
  pulls have never run:
  - P, then a box pin, then U, then pull a bird base's flap and let go;
  - Done, then reopen: the same shape, with the ghost aligned;
  - an untouched step at 75%, Done, then reopen: the same mesh, and no
    capture.
- [ ] i18n for the toasts. Gate.

### Phase 7: Pose's UI (#436)

Starts once the D2 mock is approved and the other agents' Pose-stage edits
have landed.

- [ ] `diagramSimulatedHandActions.ts`, with tests:
  - the refusal hints;
  - the window without its `pins` and `pose` sections;
  - no window when nothing is left in it.
- [ ] Wiring:
  - `DiagramPoseStage` gets its `rail` slot and `hint`;
  - `DiagramPoseSimulatedView` gets `toolInput`, `highlights`, the rail, the
    window (with the stage as its container) and the bar verbs;
  - the phone trigger;
  - the context menu (D4);
  - the Step pane line (D4).
- [ ] Constraints:
  - CSS modules only, with nothing added to global sheets;
  - tests find elements by role, name or data attribute only.
- [ ] Analytics: the `'pose-toolbar'` sources and the `'diagram-pose'`
  context-menu surface.
- [ ] i18n: the bar labels, the hints and the Step pane line in all 9 catalogs,
  then `i18n:extract`, `stamp` and `check`.
- [ ] Browser, before and after:
  - pin, fold and pull on the crane;
  - Clear Pins and Spring Back, both while refused and while they apply;
  - Back to Flat and scrubbing end a pose and keep the pins;
  - undo and redo across a pull;
  - Reset Pose;
  - a light change refreshes a shaped step, and an untouched one above 0%,
    headless;
  - a pattern edit drops the shape and marks the step out of date;
  - a phone at 375 px with the pill and sheet;
  - light and dark;
  - Simulate unchanged.
- [ ] Gate.

### Phase 8: verify and record

- [ ] PostHog shows events with `surface: 'diagram-pose'`, and `hand` on
  `diagram picture posed`.
- [ ] Update D19 and the Phase 8d notes in `diagram-workspace.md`. Tick this
  checklist, with as-built notes.
- [ ] Hand-off notes for #436, with the dev-server URL.
