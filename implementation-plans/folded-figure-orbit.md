# Orbiting a 3D folded figure

## Goal

A 3D folded figure can be turned by dragging it, with the interaction the inline
simulator already has: **a press focuses it, and a drag on a focused figure
orbits**; press outside to blur, and move / scale / rotate come back.

An unfocused figure drags normally, and the press that starts that drag is also
the press that focuses — the body only goes inert for the *next* press. So the
first drag moves and the one after it turns, with no separate focusing click.

Today a 3D figure has exactly two views — the camera it was folded at, and
**Other side** — because a drag over a folded figure already means *move*. That
made the feature unreviewable: with no way to turn the model you cannot tell a
correct fold from a wrong one, which is how it was reported.

This is the limitation named in
[`3d-folded-state.md`](3d-folded-state.md)'s "What remains" as a conscious merge
call. This plan makes the call: copy the inline simulator, because the user has
already learned that interaction in this app.

## Approach

Almost all of it exists. The camera, the orbit math, the gesture-exemption
mechanism and the persistence are all shipped; what is missing is a **focus**
concept for folded figures and the gesture that rides it.

### 1. The camera is already the simulator's camera

[`FoldedFigureCamera`](../apps/web/src/cp-workspace/folded/foldedFigure3dProjection.ts#L92)
is `{ yaw, pitch, zoom }` and its own docs say the verbs and signs are "the same
two verbs, and the same signs, as the simulator's orbit".
[`SimulatorOrbitView`](../apps/web/src/lib/simulatorOrbit.ts#L1) is the same
three fields.

So the orbit math is not written here. `nextSimulatorOrbitView(view, drag, point)`
is called with the figure's camera, and `SIMULATOR_ORBIT_SENSITIVITY` is shared —
a figure and a simulation must turn by the same amount for the same drag, or the
"it behaves like the simulator" claim is false in the only way a user can feel.

The two types stay distinct rather than being unified: they are the same shape by
convergence, not by contract, and a `zoom` that means "model units per world
unit" in one and "viewport fit" in the other should not be made to look
interchangeable. The adapter is two lines and lives in the projection module.

### 2. Focus is a store concept, mirroring inline simulations

```ts
oristudioCpFocusedFoldedFigureId: string | null
focusOristudioCpFoldedFigure: (id: string | null) => void
```

Mirrors `oristudioCpFocusedInlineSimulationId` /
`focusOristudioCpInlineSimulation` exactly, so there is one shape to learn.

Two rules that keep the concept honest:

- **Only a 3D figure can hold focus.** A flat figure has nothing to orbit, so
  the setter refuses it rather than admitting a state that means nothing. Focus
  is therefore never a thing the user can reach and find inert.
- **Focus is exclusive with an inline simulation's focus.** Both claim canvas
  drags; two focused things would fight over the same press. Focusing either
  blurs the other, in the store, not in two components.

Focus follows a press, unconditionally, exactly as it does for an inline
simulation. **There is no second-press rule** — an earlier draft of this plan had
one, on the theory that the first press had to be protected for moving, and it
was wrong twice over: it made turning the model take two clicks, and the
protection was unnecessary because the overlay keeps the in-flight drag anyway.
The body goes inert for the next press, not this one.

### 3. The inert body already exists

[`CanvasObjectOverlay`](../apps/web/src/cp-workspace/CanvasObjectOverlay.tsx#L389)
already takes `inertBodyIds` and drops `pointerEvents` on the body polygon while
leaving the handles live — written for exactly this problem, for inline
simulations. `useFoldedFigures` grows the same memo
[`useInlineSimulations.ts:96`](../apps/web/src/cp-workspace/inlineSimulation/useInlineSimulations.ts#L96)
has, and `CreasePatternPanel` passes it through.

**No overlay change.** A focused figure can still be resized and rotated by its
handles, which is the behaviour a simulation window already has.

### 4. The one genuine difference: the press falls through to the canvas

An inline simulation is a DOM element, so with the overlay body inert the press
lands on the simulation's own canvas and its viewport component handles it. A
folded figure is **drawn into the shared WebGL canvas** and has no element of its
own, so the press falls through to the crease-pattern canvas instead.

`CreasePatternWebglCanvas`'s pointer seam
([`:2552`](../apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx#L2552)) must
therefore claim it. Its own comment already anticipates the shape of this:

> Folded figures are grabbed through the canvas-object overlay now, which sits
> above this canvas and takes the press first.

That stops being true for a focused figure, which is the whole mechanism.

Per the panel/canvas discipline in `AGENTS.md`, **the behaviour does not go in
the canvas component**. It goes in a React-free, store-free module beside the
concern:

```ts
// apps/web/src/cp-workspace/folded/foldedFigureOrbitGesture.ts
export function foldedFigureOrbitClaimsPress(
  focusedId: string | null,
  figureId: string,
  box: AnnotationBox | null,
  point: Vec2
): boolean;

export function beginFoldedFigureOrbit(
  camera: FoldedFigureCamera,
  point: SimulatorOrbitPoint
): SimulatorOrbitDrag;

export function advanceFoldedFigureOrbit(
  camera: FoldedFigureCamera,
  drag: SimulatorOrbitDrag,
  point: SimulatorOrbitPoint
): FoldedFigureCamera;

export function foldedFigureOrbitChanged(
  before: FoldedFigureCamera,
  after: FoldedFigureCamera
): boolean;
```

Pure functions over a camera and two points, unit-tested without a DOM. The
canvas adds one branch to the existing `if / else if` chain, above the tool
branches and below the right/middle-button ones, reading the focused id from the
`liveRef` snapshot it already keeps.

**Built and measured.** `foldedFigureOrbitChanged` is the fourth function and was
not in the first draft of this plan: a zero-distance drag does *not* return the
camera it started on through the shared orbit. `normalizeAngle` round-trips
`((v + PI) % 2PI + 2PI) % 2PI - PI` and loses a ULP on an angle already in range,
so a plain click on a focused figure moved it ~1e-17, re-projected, and would
have taken an undo entry. `advanceFoldedFigureOrbit` guards the zero-delta case
exactly rather than with a tolerance — the drift accumulates across a drag that
keeps returning to its anchor, which a tolerance would only hide.

Hit-testing reuses `boxContainsModelPoint` against the figure's own transformable
box — the same box `foldedFigureAsTransformable` hands the overlay, so the region
that orbits is exactly the region that was made inert. The point is in **user**
space, which is where a folded figure's box lives; the canvas already has
`clientToUser`. A press inside a focused figure orbits; a press outside it blurs
and behaves normally.

### 5. What persists, and when

The inline simulator is explicit that it got this wrong, at
[`inlineSimulation.ts:49`](../apps/web/src/cp-workspace/inlineSimulation/inlineSimulation.ts#L49):
live orbit is held by the viewport component and the write-back "is still
missing", so a reopened window shows where it was *opened*, not where it was
turned.

**Do not copy that.** A folded figure already has `setOristudioCpFolded3dCamera`
and its camera already round-trips through `.osf`, so the write-back is a call,
not a feature.

- **During the drag**, the camera is written to the store per move. The figure is
  re-projected from it, so there is nowhere else for the live value to live —
  unlike the simulator, there is no long-lived viewport component holding it.
- **Undo takes one entry, on release.** Not per frame. Same rule as the
  fold-angle slider drag, and for the same reason.

Re-projection cost is the thing to watch, and it is measured in Phase 3 below
rather than assumed: the projector runs a BSP, and `BSP_ITEM_BUDGET` is 50,000.
If a large figure cannot re-project inside a frame, the fallback is to re-project
from a decimated model during the drag and once at full fidelity on release —
but that is a real complication and is not built speculatively.

### 6. Discoverability

Orbit is invisible if a focused figure looks like a selected one. Three things,
all cheap:

- A distinct focused outline, and `cursor: grab` / `grabbing` over the body.
- The figure's floating toolbar gains a **Reset view** verb next to **Other
  side**, which is also the escape hatch from a camera the user has lost.
- **Other side** stays. With orbit it becomes a shortcut rather than the only
  way, and it is still the fastest way to answer "is this mirrored".

### 7. Scroll is not claimed

`FoldedFigureCamera.zoom` exists, and zooming a focused figure on scroll is
tempting. It is refused: scroll pans the crease-pattern canvas (shipped in
`trackpad-pan-and-zoom-gestures.md`), and taking it back over part of the canvas
would make panning conditional on what is underneath. The figure's own scale
handles already size it.

## Affected Areas

- `apps/web/src/cp-workspace/folded/foldedFigureOrbitGesture.ts` (new)
- `apps/web/src/cp-workspace/folded/foldedFigureOrbitGesture.test.ts` (new)
- `apps/web/src/cp-workspace/folded/foldedFigure3dProjection.ts` — the two-line
  adapter between `FoldedFigureCamera` and `SimulatorOrbitView`
- `apps/web/src/cp-workspace/folded/useFoldedFigures.ts` — focus binding,
  `inertBodyIds`, the orbit commit
- `apps/web/src/cp-workspace/folded/foldedFigureActions.ts` — **Reset view**
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — one branch in the
  existing pointer chain, plus the cursor
- `apps/web/src/cp-workspace/CanvasObjectOverlay.tsx` — focused outline only
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — focus state
  and its exclusivity with inline-simulation focus
- `apps/web/src/store/workspaceStore/types.ts`
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — pass `inertBodyIds`
- `docs/analytics.md` + `apps/web/src/analytics/events.ts`
- `apps/web/public/locales/*/panels.json` — **Reset view**

## Non-goals

- Orbiting a **flat** folded figure. It has no third dimension; the request is
  meaningless and the focus setter refuses it.
- Orbiting from the keyboard. Worth having, not part of this.
- Unifying `FoldedFigureCamera` with `SimulatorOrbitView`. Same shape, different
  contracts; see §1.
- Zoom on scroll (§7).
- Fixing the inline simulator's own missing orbit write-back. Named here because
  this plan deliberately diverges from it, but it is a separate change.

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | A drag meant to *move* the figure orbits it instead, or vice versa | The body goes inert only for the press *after* the one that focused, so the focusing press still moves. Matching the inline simulator exactly is what keeps this predictable |
| R2 | Re-projecting per pointermove drops frames on a large figure | Measured in Phase 3 against the largest corpus figure before any optimisation is written. Decimate-during-drag only if measurement demands it |
| R3 | Two focused things fight over one press | Focus is exclusive in the store, not negotiated between components |
| R4 | Orbit undiscoverable, so the feature ships unused | §6 — focused outline, grab cursor, Reset view in the toolbar |
| R5 | Per-move camera writes flood undo | One entry on release, like the fold-angle slider |
| R6 | A canvas `pointerdown` branch is added and the panel grows behaviour | The decision is three pure functions in a module with unit tests; the canvas gets a call, not logic |
| R7 | Orbit sensitivity drifts from the simulator's | `SIMULATOR_ORBIT_SENSITIVITY` is imported, not copied. A test asserts the same drag turns both by the same angle |

## Checklist

### Phase 1 — Focus
- [x] `oristudioCpFocusedFoldedFigureId` + `focusOristudioCpFoldedFigure`, refusing
      a flat figure, exclusive with inline-simulation focus
- [x] Blur when the figure is deleted, refolded, or its document replaced
- [x] Store tests for each rule, including the exclusivity both ways
- [x] `inertBodyIds` from `useFoldedFigures`, passed through the panel
- [x] Press-to-focus wired, matching the inline simulator. The in-flight drag is
      unaffected, so an unfocused figure still moves on the press that focuses it

### Phase 2 — The gesture
- [x] `foldedFigureOrbitGesture.ts` — three pure functions, no DOM, no store
- [x] Unit tests including the shared-sensitivity assertion (R7) and a drag that
      starts inside and leaves the figure's bounds
- [x] One branch in `CreasePatternWebglCanvas`'s pointer chain
- [x] Camera written per move; one undo entry on release
- [x] `cursor: grab` / `grabbing` over a focused body

### Phase 3 — Cost
- [x] Measured. `plant_penguin.osf`, 103 faces and the largest real figure to
      hand: **5.47 ms per re-projection**, a 183 fps ceiling. `spikes_small`
      (25 faces) is 3.63 ms. Both are inside a 16.7 ms frame with room to spare
- [x] **Not decimated**, because the measurement did not demand it. The forcing
      result fired the other way
- [ ] Re-measure in a **production** build with DevTools closed before trusting
      the margin on a much larger figure — this number is from bare node, where
      the canvas is not also painting, and a dev build has misled twice in this
      repo

### Phase 4 — Surfacing
- [x] Focused outline distinct from selected, in both themes
- [x] **Reset view** in the folded-figure action catalog, context menu and menu bar
- [x] `folded figure orbited { }` analytics, no angles or coordinates —
      `docs/analytics.md` updated
- [x] i18n for **Reset view** across all eight locales; `npm run i18n:check`

### Validation
- [x] `npx tsc --noEmit`, `npx vitest run`, `npx eslint .` from `apps/web`
- [x] `npm run i18n:check`
- [x] No Rust change expected — if one appears, rebuild the tracked wasm
- [ ] Browser checklist appended to `3d-folded-state.md`: press once (moves),
      press again (focuses), drag (orbits), press outside (blurs and moves
      again), handles still resize while focused, Reset view returns the fold
      camera, Other side still flips
