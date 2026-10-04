# Simulator Tool Rail and Pinned Faces

## Goal

Let the user pin regions of a simulated figure so they hold their place in 3D
while every other region keeps folding and unfolding under the Fold control
(slider, play, arrow keys).

- **A tool rail.** One icon wide, at the left of the Simulate viewport. Its first
  two tools are **Orbit** (today's drag behaviour, and the resting tool) and
  **Pin**. The rail renders from a tool catalog, so later tools are entries, not
  layout work.
- **Pin.** Select faces on the 3D figure. A pinned face stays exactly where it
  was when it was pinned. Gestures follow Edit's Box Select: drag a box, click
  one face, Shift adds. Cmd+drag (and middle drag) still orbits.
- **A "Select through all layers" toggle.** It decides whether a box reaches
  hidden layers.
- **The same bottom-right tool window as Edit.** `CpToolHintWindow` moves to
  `components/ui/tools/` so both workspaces mount it. In Simulate it shows the
  active tool's instructions, the through-layers toggle, the pin count and Clear.
- **The same phone Tools pill and sheet as Edit**, extracted into the same folder.
- **Analytics and error handling** designed in from the start (see their
  sections below).

Scope: the Simulate workspace. Inline simulation windows and folded 3D windows
share `SimulatorViewport` and keep orbit-only input, the same split the view
cube made (`simulator-view-cube.md`).

This is the interaction design that `simulator-options-panel.md` Phase 4b
("anchors + gravity — still needs an interaction design (how a vertex gets
pinned)") was waiting for.

### Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | Which faces a box picks | **Through all layers (default):** every face whose projected centre is inside the box. **Off:** faces with any visible part inside the box. A click always picks the frontmost face under the cursor. The toggle is persisted. |
| 2 | How closely to follow Box Select | Parity: a plain drag or click replaces the pin set, Shift adds, and clicking empty space clears. **Exception: Escape never clears pins.** It cancels an in-flight box, then returns to Orbit. On touch, a box adds and a tap toggles; there is no modifier to choose with, and a stray tap must not drop the set. |
| 3 | Restart with pins | Keep the pins, held on the flat sheet. Restart rewinds every vertex, pinned ones included, and the pins hold wherever they are. No special case. |
| 4 | Rail contents | Orbit + Pin as a radio pair. `O`, `P` and Escape move between them. |
| 5 | Phones | As in Edit: no rail. A **Tools** pill opens a sheet listing the tools. The pill, the sheet and its rows are extracted from Edit's phone picker so both workspaces share them (see "Phone: the Tools pill and sheet"). |

Why a click ignores the toggle: a click through all layers is "touches the
box" shrunk to a point. It would pick every face that passes under the cursor,
including big faces centred somewhere else, which is the failure decision 1
avoids. Blender's X-ray mode makes the same split: box-select goes through,
click-select picks the nearest.

## Feasibility

### The solver already has the mechanism; it is switched off

Upstream Origami Simulator has a per-node fixed flag. `Node.setFixed` →
`updateFixed()` writes `mass[4*i+1]` and re-uploads `u_mass`
(`third_party/origami-simulator/js/dynamic/dynamicSolver.js:453-458`). Its
position shaders hold a fixed node's last position, and its velocity shaders
write zero. Upstream only uses it for its drag-a-vertex gesture
(`js/3dUI.js:57-68`). `js/model.js:255-257` holds commented-out code that fixes
face 0's three vertices, which is literally "pin a face". Upstream has no pin
UI.

Our port:

- **GPU (`WebglSolver`).** The flag survived. `u_mass.y` is already read by:
  - `POSITION_CALC` (`webgl/passes.ts:449`)
  - the shared `FORCE_SHADER_MAIN` (`:222`)
  - `VELOCITY_CALC_VERLET` (`:427`)

  But `webgl/packing.ts:167` hard-codes `mass[i * 4 + 1] = 0; // nothing fixed`,
  and nothing re-uploads the texture. A setter is `packed.mass[i*4+1] = …` plus
  `gl.updateTexture('u_mass', packed.mass)` (`webgl/glCore.ts:248`).
- **A latent Verlet bug.** `FORCE_SHADER_MAIN`'s fixed branch writes
  `vec4(0.0)`. That is right as an Euler *velocity*. But `POSITION_CALC_VERLET`
  shares the same main, so under Verlet a fixed node's *displacement* becomes 0
  and it snaps to its flat rest position every step. Upstream's Verlet writes
  `lastPosition`. Verlet is not exposed, but fixing it restores parity.
- **CPU (`ReferenceSolver`).** No fixed concept. It needs the same branch in
  `velocityCalc`/`positionCalc` and in the Verlet pair. It backs fold profiles
  (segment and sequence-step simulation) and the canvas-2D fallback, so it is not
  optional.
- **Nothing in the package recentres positions**, because upstream's
  `centerTexture` was not ported. The *camera* does recentre; see below.

### Measured

A spike patched upstream's semantics onto `ReferenceSolver`: zero a fixed node's
velocity each step, so its position holds. It drove the fold the way the app
does, about 300 steps per 1% of fold, then a settle. Models went through the
app's own `foldArtifactsFromFold` preparation. Spike code lives in the session
scratchpad and is reference only.

| Scenario | Pinned vertices moved | Free creases, pinned vs unpinned | Peak strain | Guard fired |
| --- | --- | --- | --- | --- |
| Kabuto folded to 100%, two adjacent faces pinned, then 60 → 30 → 0 → 100% | 0, exactly | Mean error 15.3° vs 13.8° at 60%; 19.6° vs 17.6° at 30%; 0.00° vs 0.00° at 0%; 0.01° vs 0.00° back at 100% | 0.064 (unpinned 0.064) | none |
| Waterbomb base, one face pinned on the flat sheet, folded 0 → 100% | 0 | 45.0° vs 45.0° at 100% (this fixture cannot reach its ±150° targets either way) | 0.036 (0.033) | none |
| Over-constrained: kabuto at 100%, the two faces farthest apart pinned, unfolded to 0% | 0 | Cannot unfold, as expected | 0.226 (the blow-up guard is at 3) | none; stays finite |

Holding is exact by construction. The free part reaches the shape it reaches
unpinned. Even a pin set that contradicts the fold stays stable.

Picking cost, CPU, Node, with a 1600×1200 drawing buffer (an 800×600 viewport
at 2×):

| Rule | lamprey segment (982 triangles, folded 90%) | Miura 80×80 (12,800 triangles) |
| --- | --- | --- |
| Centre inside, whole view | 0.3 ms | 1.1 ms |
| Visible inside, one sample per CSS pixel, whole view | 9.9 ms | 6.1 ms |
| Frontmost face at a point | 0.02 ms | 0.13 ms |

Sampling coarser than one per CSS pixel misses visible slivers. A 256×256 cap
found 434 of the 808 faces that full resolution finds on lamprey, so the
visible rule samples per CSS pixel. Add the position readback, which happens
once per gesture on the GPU path.

### Three things the spike found that the plan has to handle

1. **Some pinned simulations never go idle.** The clock calls a model settled
   when its max velocity is under `1e-5` for three ticks (`simulationClock.ts:134`
   and `:191`). Kabuto pinned at 0% plateaus at `1.26e-5` forever.
   - The slowest node's position is bit-identical across 60k steps. Its
     velocity is real but cannot move it: `v·dt` (5.9e-8) is under half a
     float32 ulp at a displacement of about 1.0 (ulp 1.19e-7, so ulp/dt = 2.5e-5
     is the smallest velocity one step can express).
   - Unpinned, the same model returns near its rest pose (displacement 0.05) and
     plateaus at `3.9e-7`. Pins hold paper far from rest, which is what raises
     the floor.
   - Unfixed, a pinned model would keep the worker stepping indefinitely.
   - Pinned runs also take longer to first dip under ε: waterbomb 16,900 steps
     vs 2,300; kabuto to 30%, 34,500 vs 13,000.

   **Fix** (ours; the clock is not upstream code): a tick also counts as settled
   when max velocity is bit-identical to the previous tick's and below a ceiling
   (start at `1e-3`). A stuck node reports a constant velocity, while a model
   still converging reports a falling one. Measure on the GPU before trusting it
   there.
2. **The camera undoes pinning on screen.** `framingFollow.ts` eases the camera
   toward the model's centroid, so a pinned face still slides as the rest folds.
   The spike tried freezing the camera instead, and that crops the sheet as it
   unfolds.

   **Rule:** while anything is pinned, centre on the pinned region's centroid,
   which is fixed in world space, and let only the radius follow. The pinned
   region then never moves across the screen; it only scales as the model's
   extent changes.

   **Corrected while building:** centring *on* the centroid slid the region to
   the middle of the view at the first measure after pinning (165px on the bird
   base). The centre is the centroid plus an offset taken when the pins are set
   (`anchorFraming`), so pinning moves nothing and the region holds its place
   (under 1px through the same fold, on both renderers).
3. **Edit's box rule does not survive the third dimension.** On the folded
   kabuto, one box over the top half picks all 18 of 18 faces under "touches the
   box", 7 under "centre inside", 0 under "fully inside" and 3 under "visible
   inside". That comparison produced decision 1.

## Approach

### Architecture

Everything a tool does goes through one binding hook, which is the only place
with side effects. Below it everything is pure; above it everything only renders.

```
SimulatorPanel                         composition only
 ├─ SimulatorToolRail ─┐
 ├─ SimulatorViewport ─┼─ props from ─ useSimulatorTools ──► runtime (worker calls)
 ├─ SimulatorToolWindow┘                │  (the only side effects: store, worker,
 └─ context menu, shortcuts ────────────┘   analytics, toasts, reportError)
                                        │
          pure, React-free, store-free  ▼
   simulator/tools/catalog.ts        the tool definitions
   simulator/tools/actions.ts        verbs → descriptors for rail, window, menu, keys
   simulator/tools/pressRoute.ts     navigation precedence over every tool
   simulator/tools/engines/*.ts      gesture reducers (the CP engine shape)
   simulator/tools/intents.ts        what a finished gesture asks for
   simulator/tools/pinSet.ts         replace / add / toggle / clear
   simulator/tools/cursor.ts         tool + modifiers + gesture → CSS cursor
                                        │
   worker: simulatorSession            capabilities, not tools: pickFaces, setPinnedFaces
   packages/origami-simulator          fixed nodes, picking, overlay pass, clock
```

Dependency rules:

- `simulator/tools/*` imports neither React nor the store. Everything there is
  unit-tested by feeding inputs.
- The worker knows nothing about tools. It exposes queries (pick) and state
  (pins), each validated and token-checked.
- The viewport owns gesture *mechanics*: pointer capture, the click threshold,
  drawing the marquee. It asks `pressRoute` what a press is and hands finished
  gestures to the hook as intents. It knows no tool by name.
- Navigation comes before tools. `pressRoute` gives right button → context menu
  and middle or Meta → orbit (plus Shift → roll), so no tool can claim them. This
  is the rule Edit enforces for panning (`cmd-drag-always-pans.md`).

**The tool contract** (`simulator/tools/types.ts`), as built:

```ts
type SimulatorToolId = 'orbit' | 'pin';
/** One list of input modes, with a total Record of routes (registry.ts's shape). */
type SimulatorInputMode = 'orbit' | 'pick-faces';

interface SimulatorToolDefinition {
  id: SimulatorToolId;
  icon: SimulatorToolIcon;          // a string union; the rail maps it to lucide
  shortcut: SimulatorShortcutId;
  input: SimulatorInputMode;
  cursor: 'grab' | 'crosshair';
  /** The window's sections, without text; null means nothing to say. */
  window(view: SimulatorToolsView): SimulatorToolWindowSections | null;
}

/** The CP engine shape (cp-workspace/tools/types.ts), over CSS-pixel input. */
interface SimulatorGestureEngine<S> {
  readonly initialState: S;
  reduce(state: S, input: SimulatorPointerInput): {
    state: S;
    preview: { marquee: CssRect } | null;
    gesture: SimulatorGesture | null;   // a box or a click, meaning nothing yet
  };
}

/** intents.ts gives a gesture its meaning under the tool's options. */
type SimulatorIntent = {
  kind: 'pick-faces';
  gesture: 'box' | 'click' | 'tap';
  region: SimulatorPickRegion;      // CSS px
  reach: 'all-layers' | 'visible' | 'front';
  mode: PinMode;                    // replace | add | toggle
  surface: CssSize;                 // the canvas's CSS size at release
};
```

Labels are not in the catalog. The i18n extractor sees only literal `t()`
keys, so the definitions carry ids and `actions.ts` resolves every string with a
literal call, the way `foldedFigureActions.ts` and `shortcutLabels.ts` do. A
replacing pick that finds nothing empties the set by itself (`replace` with
`[]`), so no separate "clear if empty" mode is needed.

Edit's tools carry three overlapping mode lists (`ToolInputMode`,
`ActiveToolMode`, `CpInputModel`). The simulator keeps one.

**Adding a tool:**

1. Add a definition to `catalog.ts`: icon, label, shortcut, input mode, cursor,
   window model.
2. If it needs a new gesture, add an input mode and a pure engine with tests.
   The `Record<SimulatorInputMode, Engine>` makes every router branch a
   typecheck error until it is handled.
3. If it needs a new effect, add an intent kind and its branch in the hook's
   exhaustive executor.
4. If it needs data the worker has, add a session capability. It must be
   token-checked, validate its input, and return `null` when the session is
   stale.
5. Add the shortcut id and label, i18n strings, the analytics `tool` enum value,
   and tests.

The obvious next tool is upstream's vertex drag (`3dUI.js`). It is a `drag-vertex`
input mode, a `drag-vertex` intent, and a session capability that fixes one
node and moves it, all on the same `u_mass` flag this work turns on.

**State.** The existing simulator slice (`slices/simulatorSlice.ts`) gains
`simulatorActiveToolId`, `simulatorPins` and `simulatorToolOptions` — an
existing slice rather than a new one, per AGENTS.md. It lives in the store, not
the panel, so a workspace switch keeps both, the way
`oristudioCpActiveToolId` survives a remount. Pins are memory-only: not in
`.osf`, not in undo, cleared on reload. They are stored per source for one fold
revision (`{ revision, bySource }`), so a write against a new revision drops
the old revision's sets in one step. Tool options persist through
`lib/storage.ts` with per-key validation (`simulatorToolOptions.ts`). Today
that is `{ pinThroughLayers: boolean }`, default `true`.

**Model and source are bound together** (found while building). A segment
switch changes the source key at once and the runtime's model only when the new
load lands, so the hook pairs each model with the source current when it
arrived. Without that, the new segment's face ids would be sent to the old
model for the length of a load. A gesture is bound to the model it was made
over, and a pick answered after that model was replaced is dropped.

### Gestures

| Input | Orbit tool | Pin tool |
| --- | --- | --- |
| Drag | orbit | box. Replace the pin set with: every face whose centre is inside (through layers), or every face visible inside (toggle off) |
| Shift+drag | roll | box, adding to the pin set |
| Click a face | — | pin set becomes the frontmost face under the cursor |
| Shift+click a face | — | toggle that face |
| Click empty space | — | clear the pin set |
| Cmd/Meta+drag, middle drag | orbit (Cmd+Shift rolls) | orbit (Cmd+Shift rolls) |
| Right click | context menu | context menu |
| Wheel / pinch | zoom | zoom |
| Escape | — | cancel an in-flight box, otherwise switch to Orbit; never clears pins |
| Touch: one finger | orbit | box adds; tap toggles; tap on empty space does nothing |
| Touch: second finger | — | aborts the box |

- **Meta, not Ctrl, is the navigate modifier**, matching Edit
  (`CreasePatternWebglCanvas.tsx:3325-3347`; Ctrl inverts crease colours there).
- **Button filter.** Today any button orbits (`SimulatorViewport.tsx:768` never
  reads `event.button`); routing adds a filter for both tools.
- **Click vs drag.** A release within `CLICK_MOVE_THRESHOLD` (4 CSS px) is a
  click, as in Edit.
- **Empty gestures clear.** A plain box or click that finds no faces empties the
  set, as Box Select empties a selection. Shift, and every touch gesture, never
  empty it.
- **Marquee.** A DOM overlay, sibling of the canvas: accent border, 14% accent
  fill, its own module. It has to be DOM, because in GPU mode the worker owns the
  canvas. The selection applies on release; there is no live preview.
- **Touch.** Edit's touch arbiter (`cp-workspace/gestures/cpTouchArbiter.ts`)
  is pure. It moves to `src/lib/gestures/` in its own commit (re-exported for
  CP), and the simulator viewport uses it. Today a second finger silently
  replaces the first (`SimulatorViewport.tsx:768-772`). Two-finger orbit is a
  follow-up; on touch you orbit by switching to Orbit.
- **Cursor.** A pure `simulatorCanvasCursor(state)` sets it inline, Edit's
  precedent (`cpCanvasCursor.ts`; applied inline at
  `CreasePatternWebglCanvas.tsx:4312`). The order is:
  1. `grabbing` while orbiting;
  2. `grab` while Meta is held (`usePanModifierHeld`);
  3. the tool's own cursor.

  Inline, so the global `.simulator-canvas` block is not touched.

### What a pin is

- **Unit: a crease-pattern face.** The solver only sees triangles, but
  triangulation diagonals keep their `edges_facet` marks.
  `sourceFaceGroups(meshTopologyFor(prepared))` (`coplanarRuns.ts:50`) joins the
  triangles back into source faces, and its group ids are deterministic per
  prepared model.
  - Triangulation adds no vertices, so pinning a face fixes its ring vertices.
  - A vertex is fixed if any face around it is pinned.
  - A crease with all four of its nodes fixed is frozen at its current angle.
- **Pose: wherever the face is when it is pinned.** That is upstream's
  semantics. Setting the flag freezes the node in place, so no positions are
  stored.
- **Restart and Jump to flat** rewind every vertex to the flat sheet. Both
  backends' `reset()` zero displacement and leave the flag alone, and the pins
  hold there (decision 3).
- **Lifetime.**
  - Keyed by `simulationSourceKey` (`SimulatorPanel.tsx:163`), so switching
    segments and back keeps them.
  - Dropped when the fold revision changes, because the faces may no longer
    exist.
  - Re-sent to a reloaded session the way the camera is (the load effect in
    `useSimulatorRuntime.ts`).
  - An unhealthy Restart rebuilds the fold artifacts. If that bumps the
    revision, the pins go with it, which is right for a session that broke.
- **Model identity.** A pin request names the model its face ids were read
  against (`setPinnedFaces(faces, forModel)`). The runtime drops a request for
  any other model before it reaches the worker, and the worker answers null for
  a superseded session token, so a segment switch racing a pin edit cannot pin
  the wrong faces. (Built this way rather than as a `modelKey`: the runtime does
  not key its loads, and the session token already names the model.)

### Engine (`packages/origami-simulator`)

1. **Fixed nodes.** `SolverBackend.setFixedNodes(mask: Uint8Array | null)`.
   - `WebglSolver` writes `mass[i*4+1]` and re-uploads `u_mass`.
   - `ReferenceSolver` keeps the mask and skips integration for fixed nodes in
     both integrators.
   - A mask whose length is not `vertexCount` throws a typed error, since that is
     a bug.
   - The fake backend in `tests/simulationClock.test.ts` gains the method.
2. **Verlet fix.** `POSITION_CALC_VERLET`'s fixed branch outputs `lastPosition`,
   as upstream's does.
3. **Strain at a fixed node.** The GPU reports 0 (its early return zeroes the
   alpha channel); the CPU computes it from positions. Make them agree, so strain
   colour means the same thing on both backends.
4. **Picking.** Pure functions beside `webgl/camera.ts`:
   - `facesWithCentreIn(rect)`
   - `facesVisibleIn(rect)`: a CPU depth buffer over the rect, one sample per CSS
     pixel; later triangles win ties, matching the GPU's `LEQUAL`
   - `frontmostFaceAt(point)`

   All three project with `projectVertices`, which is the shader's own matrix,
   reflection included (`simulator-view-is-a-reflection`). They take the
   `perspective` flag because the canvas-2D fallback is orthographic. Coincident
   layers in a flat-folded model are ambiguous under the visible rule, just as the
   display z-fights between them; the through-layers rule has no such
   ambiguity.
5. **Overlay.** `MeshRenderer` gains a pass that draws only the pinned
   triangles, from their own element buffer:
   - an accent tint;
   - `LEQUAL` with a polygon offset;
   - an option on the draw call that export paths never set.
6. **Clock.**
   - Add the stagnation rule to `runFrame` and `runToConvergence`.
   - A pin change must `invalidate()` the clock, or a settled model ignores it.
   - `guardBlowup` reports what it did (`'reset' | 'arrest' | null`) on the
     tick, so the app can say so (see Error handling).

### Worker and runtime (`apps/web/src/simulator`)

- **`simulatorSession`.**
  - `pickFaces(query, token)` reads positions back once and picks with the exact
    camera the last frame drew with. `renderGpu` records that camera; it is
    already built there, through `cameraUniforms`. `beginExportSnapshot`
    (`:1315`) already does this readback-plus-camera assembly.
  - `setPinnedFaces({ modelKey, faces }, token)`:
    - validates ids against the session's face groups;
    - computes the node mask and the overlay triangles;
    - invalidates the clock and redraws;
    - returns a bitmap, like `setRenderSettings`.
  - Unknown ids are dropped and reported once (see Error handling).
- **Canvas-2D fallback.** That path frames on the main thread, so it picks on
  the main thread, from the frame `canvas2dFrame.ts` drew, through the same pure
  functions. Its unused `highlights.faces` (`canvas2dFrame.ts:54`) draws the
  pins. The runtime hides which path answered.
- **Framing.** `followFraming` takes an optional anchor, the pinned centroid,
  computed once per pin change. `followFit` (`simulatorSession.ts:1974`) and
  `canvas2dFrame` both pass it.
- **`useSimulatorRuntime`** gains:
  - `pickFaces(query)` and `setPinnedFaces(faces)`, with the same token
    semantics as `setCamera`;
  - one serial queue, so picks resolve in gesture order and the newest pin set
    wins;
  - the last pin set re-sent after each `load`.
- **Coordinates.** The viewport sends CSS pixels plus both sizes. A pure
  `cssRectToBuffer` converts with the same width and height `pushCamera` sends;
  that is `deviceSize()`, which is not always CSS × DPR (a minimum size applies).
  It gets a test, because that difference is the classic way a pick lands
  somewhere else.

### The shared tool window

**Move, no behaviour change, first commit of the UI phase.**

- These files move to `components/ui/tools/` without their `Cp`/`CP_` prefixes. All of
  them are generic in code: no element ids, no store, no `cpOverlayViewStore`.
  `FloatingToolbar` set this precedent.
  - `CpToolHintWindow.tsx` and its `.module.css` → `ToolHintWindow`
  - `toolHintPlacement.ts`
  - `useCpToolHintAnchor.ts` → `useToolHintAnchor`
  - `useCpToolHintCollapsed.ts` → `useToolHintCollapsed`
  - their tests
- `restingTool.ts` stays in `cp-workspace/toolHint/`.
- The collapse preference takes its storage key as a prop:
  - Edit passes `STORAGE_KEYS.cpToolHintCollapsed`, so stored choices survive.
  - Simulate gets `simulatorToolHintCollapsed`.
- The window's CSS module has one owner, so no global CSS moves and the
  stylesheet ratchet is unchanged.
- Verify that Edit's window is pixel- and placement-identical before and after.

**What the move does not touch.**

- The window's *content* in Edit, `CpContextToolPanel`, stays as it is.
- Its `cp-context-panel__*` rules are a shared global block
  (`scoped-css.md:174`), so Simulate must not wear them.
- `SimulatorToolWindow.tsx` builds its content from `components/ui/fieldRows`
  (`ToggleRow`, which the Settings pane already uses) and `Button`, with a small
  module of its own.

**What it shows.** The active tool's `window()` model, one renderer, no
per-tool markup:

| Active tool | Window |
| --- | --- |
| Pin | Title "Pin"; meta "3 faces pinned", or "Instructions" while none are. Body: <ul><li>three short instructions (drag a box; Shift adds; Cmd-drag rotates)</li><li>"Select through all layers"</li><li>a count row with Clear</li><li>notices</li></ul> |
| Orbit, with pins | Title "Pins", meta "3 faces". Body: the count row with Clear, and notices. This is the analog of Edit's resting tool, whose window opens only when there is something to act on. |
| Orbit, no pins | none |

- Clear goes in the body, not `headerAction`: the header gutter is a fixed 58px,
  sized for English "Reset".
- **Placement** is unchanged. The Settings pane docks right at 260px, the same
  geometry as Edit's View pane, so the window overhangs that seam by 50px.
- On a coarse pointer there is no docked pane, and the existing clamp keeps the
  window inside the viewport.
- Simulate has no `[data-viewport-toolbar]`, so the window sits flush on the
  transport bar.
- **Mount it outside `.simulator-panel__body` in the React tree.** Portal events
  bubble through the React tree, and the window stops only `pointerdown` and
  `click`. Inside the body, a right-click on the window would open the
  simulator's context menu (`onContextMenu` at `SimulatorPanel.tsx:568`).
- **Space on a focused switch** runs the simulator's Space shortcut, not the
  switch, because `isShortcutEditingTarget` does not exempt `role="switch"`. The
  Settings pane's switches behave the same today; this work does not change it.
  The registered `simulator.pins.throughLayers` verb gives keyboard users a
  bindable route.

### Rail and layout

- `SimulatorToolRail.tsx` + module:
  - renders the catalog through `actions.ts`;
  - composes `IconButton` (`variant="toolbar"`, `isActive`,
    `tooltipSide="right"`), the same as the app's workspace rail. It needs no new
    primitive, and long-press touch labels come with it.
  - `role="toolbar"`, `aria-orientation="vertical"`, arrow-key roving;
  - the tooltip carries the shortcut (`shortcutLabelForAction`);
  - the Pin button shows a dot while pins exist, so pins aren't invisible from
    Orbit;
  - disabled until the simulation is `ready`.
- **Layout.** `SimulatorPanel.module.css` (new) holds a stage that fills
  `.simulator-panel__body` and splits it into `[rail | viewport]`, where the
  viewport cell is positioned.
  - The view cube and the loading overlay move into that cell in the markup, so
    they anchor to the viewport rather than sitting on the rail. The mock-up
    showed the cube overlapping the rail otherwise.
  - `.simulator-panel__body` is a shared global block (with `.design-panel__body`
    and `.cp-panel__body`), so it gets no new rules.
- **Phone.** No rail; see the next section. The rail and the Tools pill are both
  gated on `useIsPhoneLayout()`, one predicate, so exactly one of them renders.
  Edit hides its rail with a CSS media query instead
  (`CpToolRail.module.css:248-252`), because that rail is a heavy grid. Without
  the rail, the stage's `auto` column collapses to nothing.

### Phone: the Tools pill and sheet (shared with Edit)

Edit's phone tool surface has three parts:

- **`CpToolsTrigger`**: a "Tools" pill showing the active tool's glyph. It lives
  in the shell's touch-only `CanvasPillLane`, left of View.
- **`CpToolPickerSheet`**: a full-height dialog, portaled to `document.body`.
  - It has a header (title, close), a modes row (the Shift latch), then grouped
    rows.
  - Each row is `CpToolPickerRow`: star, glyph, name, one-line description.
  - Picking a tool closes the sheet.
- **`useCpToolsTrigger`**: open state, focus return, the capture-phase Escape
  listener with the canonical guards, and the guarded `cp tool picker opened`
  event.

Simulate gets the same pill and sheet with its own two rows.

**What is generic and what stays in Edit.**

- **Generic (moves to `components/ui/tools/`):**
  - **`ToolsTriggerButton`**: the pill, with a glyph slot and a label.
  - **`ToolPickerSheet`**: the dialog, backdrop, header, close button, focus,
    and an optional modes slot and body slot. It keeps the click-not-pointerdown
    dismissal and the reason it is written down.
  - **`ToolPickerRow`**: a leading slot (Edit's star goes there), a glyph slot,
    name, description, active state, availability and the reorder hooks.
  - **`useToolPickerSheet({ available, onOpened })`**: the hook, minus its gating
    and its event. It also closes the sheet when the trigger disappears (a
    rotation, a workspace switch).

  None of them has strings of its own; labels arrive as props, as the tool
  window's do. So Edit keeps its `tools:cpToolPicker.*` keys and nothing is
  re-translated.
- **Stays in Edit as the sheet's content:**
  - the catalog's groups, and the line-type segmented control;
  - Favorites, with reorder and the star;
  - the Shift latch;
  - CP glyphs;
  - `cpToolSurface.ts`, which publishes panel state to the shell-mounted pill.

  `CpToolsTrigger`, `CpToolPickerSheet` and `CpToolPickerRow` become thin
  adapters over the generic parts.

`ToolHintWindow` and its hooks (above) move into the same `components/ui/tools/`
folder. That folder becomes the tool UI kit: rail-free pieces any workspace with
tools composes.

**Why it gets its own PR.**

- `cp-tool-picker` is a listed shared CSS block (`scoped-css.md:177`). Four Edit
  components wear it, and two test files look elements up by its classes (28 and
  5 lookups).
- `.cp-tools-trigger` is in a shared selector list with `.canvas-pill` and
  `.view-drawer__trigger`.
- AGENTS.md: a shared block moves only in its own PR, which designs what its
  users get instead.

So the extraction is a preparatory PR that **changes nothing on screen in Edit**:

- the `cp-tool-picker*` rules move into the new components' modules;
- the star's rules go to a module for `CpToolFavoriteToggle`, and the line-type
  wrapper's to `CpToolPickerSheet`'s own module;
- the generic pill wears the existing `canvas-pill` look, and `.cp-tools-trigger`
  leaves the shared selector list (an in-place edit, no new rule);
- the 18px glyph box (`.cp-tools-trigger__glyph`) moves into the pill's module,
  while the Oriedita icon-font re-set inside it stays with Edit's adapter;
- the tests switch to roles, names and data attributes;
- the stylesheet ratchet goes down.

Proof: Edit's pill and sheet, at phone width in both themes, have identical
computed styles before and after, plus a screenshot pair.

Is it messy? Contained. The chrome was already generic in behaviour. The work
is mostly the CSS move and rewriting those test lookups, and Edit's adapters keep
every CP-specific piece where it is.

**Simulate's use of it.**

- `SimulatorToolsTrigger` renders in the simulator panel's toolbar, immediately
  before the `.panel-toolbar__pills` slot, so it sits left of the Settings pill.
  That mirrors "left of View" in Edit.
- It is gated on `useIsPhoneLayout()`. A tablet keeps the rail, as Edit's does.
- It does not need Edit's shell publisher. Simulate's pills live in its own
  toolbar, and the panel has the tools hook in hand.
- The pill shows the active tool's icon and "Tools". The sheet lists Orbit and
  Pin from the catalog, each with its one-line description, and a pick closes
  it.
- No modes row: touch pinning needs no latch (decision 2).
- The tool window, with the toggle, the pin count and Clear, still shows on a
  phone, as Edit's does. The sheet only switches tools.

### Keyboard

- New ids:
  - `simulator.tool.orbit` (`O`) and `simulator.tool.pin` (`P`), which are free
    in every scope;
  - `simulator.pins.clear` and `simulator.pins.throughLayers`, unbound by
    default; Clear loses poses, so it is not one stray key away;
  - `simulator.tool.exit` (Escape).

  Each gets a `shortcutLabels.ts` case and a branch in `runSimulatorShortcut`.
- **The simulator executor must learn to decline.** It always claims a chord
  today (`shortcutDispatcher.ts:194-197`), and inline windows register it too.
  An Escape bound in the simulator scope would then swallow `viewport.cancel` on
  the Edit canvas whenever an inline window held the keyboard.
  - A boolean return, the way the viewport executor already works; only an
    explicit `true` claims.
  - Surfaces without tools decline the tool verbs. Escape also declines when
    there is no gesture to cancel and no tool to leave. Every other verb claims,
    handler or not, as before.
  - **No `DECLINING_SIMULATOR_SHORTCUTS` set** (changed while building). That
    set feeds the conflict rules, and the `simulator` scope is conditional, which
    they already treat as transparent to every other scope. Within its own scope
    membership would be wrong: a declined chord moves to the next *scope*, never
    to a sibling, and the capture check reads membership as licence to stack a
    second binding on a chord only the first can answer.
  - This is its own commit, with tests, before any tool chord lands.

### Error handling

Rules this follows, from the repo:

- Never fail silently in the UI (`never-report-silence.md`).
- Cancellations and stale results are not errors.
- An expected "no answer" is an answer (`tools/toolUnavailable.ts`).
- A toast owns error text; a tool's window is not for errors
  (`oristudioCpToolState.ts:73-88`). It carries non-error notices in a
  `role="status"` line.
- `reportError` is for a failure deliberately swallowed and still wanted, with
  bounded tags only.
- "How often" questions are PostHog events.

The simulator reports nothing to Sentry today, and the error classes it already
handles keep their current paths. All handling lives in the hook's executor,
through one pure `classifySimulatorCallFailure(error)`:

| Situation | Treated as | User sees | Reported |
| --- | --- | --- | --- |
| A call resolves `null`: stale token, evicted session, model changed | expected | nothing; the gesture is a no-op and pins are re-sent after the reload | no |
| Pins sent for a different `modelKey` | expected race | nothing | no |
| A box or click picks no faces | an answer | without Shift it empties the set (Box Select parity); with Shift or on touch, nothing changes | analytics `outcome: empty` |
| The worker dies | existing path | the existing worker-death toast (`toastMessages.ts:108-112`) | existing; not double-reported |
| The graphics context is lost | existing `sessionFailure` | the existing panel overlay; pins stay in the slice and are re-sent after reload | existing |
| `pickFaces` rejects unexpectedly | bug | toast `toasts:simulatorPins.pickFailed` | `reportError(e, { surface: 'simulator:pick', tags: { backend } })` |
| `setPinnedFaces` rejects unexpectedly | bug | toast `toasts:simulatorPins.updateFailed`; the pin set rolls back to the last set the worker acknowledged, so the tint never lies | `reportError(e, { surface: 'simulator:pins', tags: { backend } })` |
| The worker drops unknown face ids | bug, contained | nothing (the rest of the set applies) | `reportError` once per session, `handled: true`, tag `reason: unknown_face` |
| The blow-up guard resets the solver while pinned | recovery | notice: "The simulation became unstable and restarted from flat. Pins now hold the flat sheet." | `simulator solver recovered` |
| Pins stretch the paper | an answer | notice: "Pinned faces are pulling against each other." Shown above a strain threshold calibrated on the corpus; the spike's over-constrained case peaked at 0.226, its normal runs at 0.064 | no |
| A pinned model that never settles | fixed at the source | — (the stagnation rule) | — |
| Pin tool before the simulation is ready | gated | the rail and the viewport's tool input are disabled until `ready` | no |

### Analytics

All events are hand-placed, because nothing here reaches `handleMenuAction` or
`cp tool used`.

- They fire from the hook's verbs and executor, once per completed gesture,
  never per pointer move.
- Typed wrappers live in `analytics/trackSimulatorTools.ts`, the
  `trackPaperExport.ts` pattern, with enum unions exported from `events.ts`.
- Tests use the array-capture mock (`useSimulatorPhoneFlow.test.tsx:14-20`).
- Values are enums and bucketed counts only: never face ids, coordinates or exact
  counts.
- Pin counts use their own ladder, `SIMULATOR_PIN_COUNT_BUCKETS = [0, 1, 5, 20, 100, 500]`.
  The shared `COUNT_BUCKETS` starts at 1, so it cannot tell an emptied set from
  one face.

| Event | Properties | Fires when |
| --- | --- | --- |
| `simulator tool selected` | `tool` (`orbit`/`pin`), `source` (`rail`/`picker`/`shortcut`/`escape`) | The active tool changes. Not on a re-click of the active tool. |
| `simulator tool picker opened` | none | The phone Tools sheet opens. Guarded against a double count, like `cp tool picker opened`, through the shared hook's `onOpened`. Did phone users find the pill? Edit's event keeps its name, because dashboards compare it across releases. |
| `simulator pins edited` | `gesture` (`box`/`click`/`tap`), `mode` (`replace`/`add`/`toggle`), `depth` (`all_layers`/`visible`/`front`), `outcome` (`changed`/`unchanged`/`empty`), `pinned_count_bucket` (size after) | A pin gesture completes. `empty` means it found no faces. A replace that found none still empties the set, and reads as `empty` with `<=0`. `depth` says whether the toggle is used. |
| `simulator pins cleared` | `source` (`tool_window`/`context_menu`/`shortcut`), `pinned_count_bucket` (size before) | An explicit Clear empties a non-empty set. Gestures that empty it are `pins edited`, so nothing is counted twice. |
| `simulator tool option changed` | `tool` (`pin`), `option` (`through_layers`), `value` (`on`/`off`), `source` (`tool_window`/`shortcut`) | A tool option changes. Generic, so a later tool's options need no new event. |
| `simulator pinned fold moved` | `direction` (`fold`/`unfold`), `pinned_count_bucket` | The fold target first moves after a pin edit, once per pin set. This is the feature's value question: do people fold and unfold around their pins? |
| `simulator solver recovered` | `action` (`reset`/`arrest`), `pinned` (`yes`/`no`) | The clock's guard acts, at most once per load per action. It also closes the existing gap where blow-ups were repaired silently. |

Each gets a row in `docs/analytics.md`. Four existing events are missing rows
today (`simulator view rolled`, `simulator view cube snapped`,
`cp suppression region created`, `model upright set`); that is separate drift,
not this change's to fix.

### i18n

New strings, extracted and translated into all eight locales, then stamped:

- `panels:simulator.tools.*`: rail aria label, tool names and one-line
  descriptions (the phone sheet shows them), window titles and meta,
  instructions, the toggle, Clear, notices
- `panels:simulator.tools.picker.*`: the phone pill's label, the sheet title, and
  the close label. The shared pieces take their strings as props, so Edit keeps
  its `tools:cpToolPicker.*` keys.
- `tools:simulator.*`: shortcut labels
- `toasts:simulatorPins.*`

The canvas aria label and title ("Drag to rotate…") depend on the tool.

### Out of scope, worth a later plan

- Vertex drag: upstream's `3dUI.js`, and the natural second tool (see "Adding a
  tool").
- Pins in `.osf`; pins in inline simulation windows.
- Gravity. `u_externalForces` exists and is all zeros.
- Hover pre-highlight, live box preview, two-finger orbit on touch.
- Making `isShortcutEditingTarget` let focused switches own Space. That changes
  the Settings pane too, so it is its own change.

## Affected Areas

- **`packages/origami-simulator`**
  - `solverBackend.ts`, `referenceSolver.ts`, `simulationClock.ts`
  - `webgl/webglSolver.ts`, `passes.ts`, `packing.ts`, `meshRenderer.ts`
  - a picking module beside `webgl/camera.ts`
  - `tests/*`; `bench/gpuParityHarness`, `gpuParity.bench.ts`, `gpuStability.bench.ts`
- **`apps/web/src/simulator`**
  - `simulatorSession.ts`, `useSimulatorRuntime.ts`, `framingFollow.ts`,
    `canvas2dFrame.ts`
  - `SimulatorViewport.tsx`, `useSimulatorShortcuts.ts`, `simulatorContextMenu.ts`
  - new: `tools/*`, `SimulatorToolRail.tsx` + module, `SimulatorToolWindow.tsx` +
    module, `SimulatorToolsTrigger.tsx`, the marquee + module
- **`apps/web/src/components`**
  - `panels/SimulatorPanel.tsx` (composition only) + new `SimulatorPanel.module.css`
  - new `ui/tools/`:
    - `ToolHintWindow` and its hooks, moved from `cp-workspace/toolHint/`
    - `ToolsTriggerButton`, `ToolPickerSheet`, `ToolPickerRow` and
      `useToolPickerSheet`, extracted from `cp-workspace/toolCatalog/`
- **`apps/web/src/cp-workspace/toolCatalog`**: `CpToolsTrigger`,
  `CpToolPickerSheet`, `CpToolPickerRow` (now adapters),
  `CpToolPickerFavorites`, `CpToolFavoriteToggle` (gains a module),
  `useCpToolsTrigger`, and their tests (lookups by role, not class)
- **Global CSS**: `apps/web/src/styles/theme.css` loses the `cp-tool-picker*`
  rules, and `.cp-tools-trigger` leaves the shared pill selector;
  `globalStylesheets.test.ts` ratchet goes down
  - `panels/CpContextToolPanel.tsx`: the import path, and its storage key passed
    in
- **`apps/web/src/lib`**: `gestures/` (the touch arbiter, moved), `storage.ts`
  (two keys)
- **Store**: `apps/web/src/store/workspaceStore/` (the `simulatorTools` slice)
- **Keyboard**: `apps/web/src/keyboard/shortcuts.ts`, `shortcutDispatcher.ts`,
  `shortcutRuntime.ts`; `apps/web/src/i18n/shortcutLabels.ts`
- **Analytics**: `apps/web/src/analytics/events.ts`, `trackSimulatorTools.ts`
  (new); `docs/analytics.md`
- **Locales**: `apps/web/public/locales/*/panels.json`, `tools.json`,
  `toasts.json`

## Checklist

Each step is its own commit; the moves change nothing on screen.

- [x] Feasibility: solver mechanism located (upstream and port); spike measured;
      three risks found (settling floor, camera, box rule); picking timed
- [x] Decisions 1–4 agreed (2026-10-03)
- [x] **Engine.** `setFixedNodes` on both backends; Verlet fixed-branch fix;
      strain parity at fixed nodes. Tests:
  - pinned nodes are bit-identical across a fold ramp;
  - golden traces are unchanged with no pins;
  - the GPU parity bench runs with a mask;
  - the stability sweep runs with an over-constrained set.
- [x] **Clock.** Stagnation rule; `invalidate` on pin change; the guard action
      reported on the tick. Tests: a constant-velocity fake backend settles, and
      a decaying one does not settle early.
- [x] **Picking.** The three pure functions, plus `cssRectToBuffer` (shipped as `scaleRect`). Tests on a
      hand-built two-layer fixture: the centre rule includes the hidden face, the
      visible rule excludes it, and a click hits the front.
- [x] **Overlay.** GPU overlay pass and canvas-2D highlights; exports verified
      free of the tint.
- [x] **Worker and runtime.** `pickFaces` and `setPinnedFaces` (validation,
      `modelKey`); last-drawn camera; framing anchor; serial queue; re-send after
      load; clear on revision change.
- [x] **Prep PR — tool UI kit, nothing on screen changes:**
  - the tool window → `components/ui/tools/`;
  - the phone pill, sheet, row and hook extracted beside it;
  - `cp-tool-picker*` CSS into modules, and the ratchet lowered;
  - Edit's tests moved to role, name and data-attribute lookups.

  Proof: Edit's window, pill and sheet show identical computed styles and
  screenshots before and after, at desktop and phone widths, in both themes.
- [x] **Move:** the touch arbiter → `src/lib/gestures/`.
- [x] **Keyboard:** the simulator executor can decline, with tests (an inline
      window passes Escape through).
- [x] **Tool core:** types, catalog, actions, `pressRoute` (total over input
      modes), engines, intents, `pinSet`, cursor. All pure; all unit-tested.
- [x] **Bindings:** the tool state in the simulator slice and its persisted
      options; `useSimulatorTools` with its executor and
      `classifySimulatorCallFailure`. Hook tests use a fake runtime: success,
      `null`, rejection with rollback, and ordering.
- [x] **UI:** stage layout, rail, viewport tool input and marquee, tool window
      content, context-menu row, shortcuts
- [x] **Phone:** `SimulatorToolsTrigger` left of the Settings pill, the sheet
      listing Orbit and Pin, the rail gone. Test: phone layout renders the pill
      and no rail; tablet the reverse.
- [ ] **Analytics:** events, typed wrappers with tests, `docs/analytics.md` rows
- [ ] **Errors:** toasts, `reportError` surfaces, notices (strain threshold
      calibrated on the corpus)
- [ ] **i18n:** eight locales, stamped, `i18n:check`
- [ ] **Browser verification** on a real crease pattern, on the GPU path and the
      canvas-2D fallback, in light and dark themes, with a coarse pointer and at
      phone width:
  - pin by box (both toggle states) and by click; scrub, play, Restart, unpin;
  - the pinned region does not move on screen;
  - the worker goes idle after settling with pins;
  - Edit's tool window, Tools pill and sheet are unchanged.
  - On a phone: the pill opens the sheet, a pick switches tools and closes it,
    Escape and a backdrop tap close it without touching the model.
- [ ] `npm run lint:web`, `typecheck:web`, `test:web`; package tests and benches;
      draft PR
