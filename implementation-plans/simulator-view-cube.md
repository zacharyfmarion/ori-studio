# Simulator View Cube

## Goal

Put a view cube in the bottom-left of the Simulate workspace's viewport, so a
folded model can be turned to a named viewpoint by clicking rather than by
dragging until it looks right.

Behaviour follows the cube in OpenSCAD Studio's 3D viewer, which is drei's
`GizmoViewcube` inside a `GizmoHelper` (`apps/ui/src/components/ThreeViewer.tsx`,
`alignment="bottom-left" margin={[80, 80]}`):

- A cube, labelled on each face, that continuously shows the model's current
  orientation.
- Hovering a face highlights it; clicking animates the camera to look from that
  direction at a constant angular rate.
- drei also has 12 edge and 8 corner hotspots, invisible until hovered, which
  snap to the diagonal views. Those come second here — see the checklist.

Deliverable for phase 1: six labelled, hoverable, clickable faces, an animated
snap, and correct behaviour after **Set upright** and at every angle.

Scope decision (asked and answered): **the Simulate workspace viewport only.**
Three surfaces share `SimulatorViewport`, and the other two are deliberately out:
inline simulation windows render at 64–200px, where an 80px cube would cover a
third of the window; 3D folded-figure windows are `interactive={false}` and their
camera is *document* state that undo reaches, so a cube there means writing back
through the store. Both are their own change.

## Approach

### The cube cannot be drawn into the simulator canvas

In GPU mode the worker owns that canvas — control was transferred, and the main
thread cannot draw into it. On the other two surfaces the canvas holds a
`bitmaprenderer` context, which cannot take a 2D or WebGL context at all. So the
cube is a **DOM overlay**, a sibling of the canvas, and this is not a preference:
it is the only place it can live.

Drawing it in the worker's GL was considered and rejected — it would put a piece
of chrome inside the render pipeline, and it would be cropped out of every
exported view along with the rest of the frame.

### Where it mounts

`SimulatorViewport` gains an opt-in `viewCube?: boolean` prop and renders
`<>{canvas}{cube}</>` — a **fragment**, so no wrapper box is introduced and the
canvas's own layout is untouched on all three surfaces. The cube is
`position: absolute`, which makes the caller's container its anchor;
`.simulator-panel__body` is already `position: relative` (theme.css:3253), so the
Simulate panel needs no CSS change to host it. The prop's doc comment states that
contract.

It goes inside the viewport rather than beside it in the panel because the
viewport is what owns `viewRef` and `pushView`. Every path that moves the
camera — drag, wheel, `resetView`, `setUpright`, `setView`, `zoomBy` — already
funnels through `pushView`, so one line there keeps the cube in step with all of
them, and the panel stays a composition site with four added lines.

### Keeping it in step, without a render per frame

`pushView` runs on every pointermove of an orbit. The cube must therefore be
updated **imperatively**, exactly as solver frames are: the viewport holds a
`viewCubeRef` and calls `viewCubeRef.current?.setView(viewRef.current)`, which
writes one `style.transform` and nothing else. No React state, no re-render, and
in particular **no layout read** — `deviceSize()` already forces a layout per
orbit frame and is timed for it (`simulatorPerfProbe`); the cube must not add a
second.

### The matrix, which is the load-bearing part

The renderer's view transform is `viewRotation(yaw, pitch, orient)`, row-major,
`view = M · (world − centre)` (`packages/origami-simulator/src/webgl/camera.ts`).
Two properties of it decide the whole design:

1. **Row 2 is the eye direction.** That is what makes "click a face" invertible.
2. **Its determinant is −1 at every angle.** The picture is a mirror of the true
   view; the lift cancels it for the model (`normalizePoint` sends FOLD `(x, y)`
   to `(x, 0, −y)`, `toSimBasis` does the same for a folded figure). A cube fed
   raw sim-space corners through `M` would come out with **mirror-reversed
   labels**.

The fix is to define the cube in its own right-handed space `V` and compose:

```
V basis (columns of B, in sim space):   right = simX,  up = simZ,  out = simY
                                        det(B) = −1

physical(R, U, N)  =  M · B · v            det(M · B) = +1   ← unmirrored
CSS transform      =  D · M · B · D        D = diag(1, −1, 1)
```

`D` is the ordinary CSS↔maths y-flip on both sides. `D · M · B · D` is a
**proper rotation** — verified orthonormal to 4e-16 with det exactly +1 at the
default view, the poles, and with a non-identity `orient`. That is the whole
point of picking `B` this way: the cube becomes an ordinary CSS 3D cube, so the
browser's own backface culling, hit testing and text rendering are all correct
with nothing hand-rolled. `matrix3d` is column-major, so the 3×3 uploads as
`matrix3d(m0,m3,m6,0, m1,m4,m7,0, m2,m5,m8,0, 0,0,0,1)`.

No CSS `perspective`: drei renders its gizmo through an `OrthographicCamera`, so
an orthographic cube is the matching look as well as the simpler one.

### Face labels

`V`'s axes are the user's own frame. At `(yaw 0, pitch 0)` the transform reduces
to `screen_x = FOLD x`, `screen_y = −FOLD y` — so **looking from Top shows the
fold oriented exactly as the crease-pattern canvas draws it**, which is both the
right label and a sharp browser check.

| Sim axis | Is | Label |
| --- | --- | --- |
| `+Y` | paper front normal (the lit face) | Top |
| `−Y` | paper back | Bottom |
| `+X` | FOLD `+x`, the CP's right edge | Right |
| `−X` | FOLD `−x`, the CP's left edge | Left |
| `−Z` | FOLD `+y`, the CP's bottom edge — the near edge at the default view | Front |
| `+Z` | FOLD `−y`, the CP's top edge | Back |

Derived, not guessed, but still to be confirmed in the browser. Note this differs
from OpenSCAD Studio's own remap (`['Front','Back','Top','Bottom','Left','Right']`
over three.js's `[+X,−X,+Y,−Y,+Z,−Z]`), which is an OpenSCAD-coordinates choice
and not one to copy.

### Click → camera

Inverting row 2 for `(yaw, pitch)`, given a target sim-space eye direction `n`:

```
t     = orient · n                       (identity when no upright is set)
hyp   = hypot(t.x, t.z)
pitch = atan2(−hyp, t.y)
yaw   = hyp < ε ? keep current : atan2(t.x, −t.z)
```

**The sign of `hyp` is load-bearing.** `(−pitch, yaw + π)` yields the same eye
direction with the up row negated — the model upside down. Taking `−hyp` selects
`pitch ∈ [−π, 0]`, the branch the existing `DEFAULT_SIMULATOR_VIEW` (−0.955) and
`UPRIGHT_PITCH` (−π/2) already live on, and puts screen-up at world `+Y` for all
four side views. Verified: it round-trips the default view to exactly
`(π/4, −0.955)`, and reproduces every axis direction to 4e-16 including with a
non-identity `orient`.

`zoom` and `orient` are carried through untouched, so the cube stays useful after
**Set upright** — it then shows the paper's axes tilted against the screen, which
is the honest picture, and clicking Top still returns to the paper's normal.

This lands in `lib/simulatorOrbit.ts` as `simulatorViewLookingFrom(view, n)`,
beside `setUprightView`, which is its exact counterpart (both pick camera angles
from a constraint). It needs a 3-line row-major mat3×vec3 helper; keeping that
local to `apps/web` rather than exporting one from the simulator package avoids
rebuilding `packages/origami-simulator` for it.

### The snap animation

drei tweens at a constant `2π` rad/s. Match it: duration =
`angleBetween(current, target) / 2π` seconds, clamped to 120–500ms, eased, with
yaw lerped along the shortest path (`normalizeAngle` of the delta) and pitch
lerped directly. Angle-lerp rather than slerp — for a 6-face snap the paths are
visually indistinguishable and one of them needs no quaternions.

The tween drives `viewRef` through `pushView` on rAF, so the fold, the readouts
and the cube all move together for free. It must be **cancelled** by anything
else that moves the camera. Rather than adding a cancel call to five sites, route
the existing mutations (`resetView`, `setUpright`, `setView`, `zoomBy`, the drag
handler, the wheel handler) through one private `applyView(next)` that cancels
first — a contained refactor of code that already exists.

`prefers-reduced-motion: reduce` skips the tween and jumps.

## Affected Areas

| File | Change |
| --- | --- |
| `apps/web/src/lib/simulatorOrbit.ts` | `simulatorViewLookingFrom`, beside `setUprightView` |
| `apps/web/src/lib/simulatorOrbit.test.ts` | Inversion tests, including the branch and `orient` |
| `apps/web/src/simulator/viewCube/viewCubeGeometry.ts` | **new** — face table, `B`, `viewCubeMatrix3d(view)` |
| `apps/web/src/simulator/viewCube/viewCubeGeometry.test.ts` | **new** |
| `apps/web/src/simulator/viewCube/viewCubeTween.ts` | **new** — pure duration/interpolation |
| `apps/web/src/simulator/viewCube/viewCubeTween.test.ts` | **new** |
| `apps/web/src/simulator/viewCube/SimulatorViewCube.tsx` | **new** — 6 faces, imperative `setView` handle |
| `apps/web/src/simulator/viewCube/SimulatorViewCube.test.tsx` | **new** |
| `apps/web/src/simulator/SimulatorViewport.tsx` | `viewCube` prop, cube ref, `applyView`, one call in `pushView` |
| `apps/web/src/components/panels/SimulatorPanel.tsx` | Pass `viewCube` |
| `apps/web/src/styles/theme.css` | `.simulator-view-cube*` — sizing, faces, hover, reduced motion |
| `apps/web/src/analytics/events.ts` | `simulatorViewCubeSnapped: 'simulator view cube snapped'` |
| `apps/web/src/lib/simulatorSettings.ts` | `showViewCube: boolean` (phase 4) |
| `apps/web/src/components/panels/SimulatorViewControlsPanel.tsx` | Toggle row (phase 4) |

Untouched on purpose: `packages/origami-simulator` (no engine change — the cube
consumes `viewRotation`, it does not extend it), the worker protocol, the export
path, and the two window surfaces on the Edit canvas.

### Risks

- **Handedness.** The one thing that can be silently wrong and still look
  plausible. Pinned by a unit test asserting `det = +1` and orthonormality of
  the CSS matrix, and by the browser check that Top matches the CP canvas.
- **Per-frame cost.** One `style.transform` write during orbit. If a profile
  shows it, the transform can move to a CSS custom property. Do not let the cube
  read layout.
- **Theme colours.** Use chrome tokens, not `--accent-primary` for the idle face
  (it reads as selection) and not `--border-strong`, which maps to
  `border.active` and looks permanently focused. Accent belongs on hover only.
- **`viewSettings` churn (phase 4).** `showViewCube` living on `SimulatorSettings`
  means toggling it changes the object identity `refreshPaint` watches, causing
  one wasted palette resolve and settings push. Harmless; noted so it is not
  mistaken for a bug later.

## Checklist

### Phase 1 — camera maths

- [ ] `simulatorViewLookingFrom(view, direction)` in `lib/simulatorOrbit.ts`
- [ ] Tests: each of the 6 axis directions round-trips through
      `viewRotation(...)` row 2 to < 1e-12; the default view recovers
      `(π/4, −0.955)`; screen-up is world `+Y` for the four side views; yaw is
      kept at the poles; `zoom` and `orient` survive; a non-identity `orient`
      still lands the eye on the requested sim-space axis

### Phase 2 — the cube

- [ ] `viewCubeGeometry.ts`: the 6-face table (normal, label key, CSS face
      transform) and `viewCubeMatrix3d(view)`
- [ ] Tests: the CSS matrix is orthonormal with det +1 at the default view, both
      poles, and with a non-identity `orient`; the default view's matrix pinned
- [ ] `SimulatorViewCube.tsx`: 6 face divs in a `preserve-3d` container, an
      imperative `setView` handle, hover state, `onSnap(direction)`
- [ ] `viewCubeTween.ts` + tests: duration from the angle, clamped; shortest-path
      yaw interpolation; endpoints exact
- [ ] Component test: clicking Top calls `onSnap` with `(0, 1, 0)`; hover marks
      the face; the container carries a `matrix3d`
- [ ] CSS in `theme.css`: 76px cube, bottom-left, ~14px inset, theme tokens,
      `pointer-events` only on the cube itself, reduced-motion branch
- [ ] i18n: six face labels under `panels:simulator.viewCube.*`, plus an
      `aria-label` for the cube and one per face

### Phase 3 — wiring

- [ ] `applyView` in `SimulatorViewport`, with every existing mutation routed
      through it and the tween cancelled there
- [ ] `viewCube` prop, cube ref, `pushView` update; `SimulatorPanel` opts in
- [ ] `SimulatorPanel.test.tsx`: the cube renders in the Simulate panel;
      `InlineSimulationLayer` and `Folded3dWindowLayer` do not get one
- [ ] Analytics: `simulator view cube snapped`, property `face` as an enum of the
      six labels (no coordinates — see the privacy contract)
- [ ] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`,
      `npm --workspace @treemaker/web run i18n:check`

### Phase 4 — optional: a settings toggle

- [ ] `showViewCube: boolean` on `SimulatorSettings`, defaulting to `true`
      (`normalizeSimulatorSettings` already backfills defaults, so stored
      settings are safe)
- [ ] Toggle row in `SimulatorViewControlsPanel`, in the same section as Faces /
      Crease lines / Lighting

### Phase 5 — edges and corners, for full drei parity

- [ ] 12 edge and 8 corner hotspots, invisible until hovered, snapping to their
      diagonal directions — `simulatorViewLookingFrom` already handles any unit
      direction, so this is DOM and CSS only
- [ ] The corner at `(1, 1, −1)` reproduces `DEFAULT_SIMULATOR_VIEW` exactly

### Browser pass (Zach)

Everything above is tool-verifiable and does not wait on this. What to look at:

1. Open a fold in the Simulate workspace. The cube sits bottom-left and turns
   with the model as you drag.
2. Click **Top**. The fold should be oriented **exactly as the crease-pattern
   canvas draws it** — same left/right, same up/down. This is the handedness
   check; a mirrored result means `B` is wrong.
3. Read the labels at several angles. Any face reading backwards means the
   determinant sign is wrong.
4. Click each of the six faces. The model should turn the short way and land
   upright, never upside down.
5. Press **Set upright** on a standing model, then use the cube. It should tilt
   with the paper's axes, and Top should still return to the paper's normal.
6. Double-click the canvas (reset) mid-snap — the animation should stop, not
   fight the reset.
7. Both themes; and confirm the cube does not appear on the inline simulation or
   folded-figure windows on the Edit canvas.
