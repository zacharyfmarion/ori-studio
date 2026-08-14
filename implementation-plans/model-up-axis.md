# Setting which way is up on a folded model

## Goal

Let the user turn a model until it looks upright, press one button, and have that
become the model's **up** — so that from then on dragging orbits *around* a
standing figure instead of tumbling it. The same button on both surfaces: an
inline simulation (and the Simulate workspace panel, which is the same
`SimulatorViewport`) and a 3D folded figure on the crease-pattern canvas.

## Why up is wrong today, and why no amount of dragging fixes it

Both surfaces are a **turntable about the paper's normal**, and that axis is
baked into the projection rather than chosen:

- A simulation lifts FOLD `(x, y)` to world `(x, 0, y)` (`geometry.ts`,
  `normalizePoint`), so the sheet lies in the XZ plane and world **Y** — the axis
  `toViewSpace` yaws about — is the paper normal.
- A folded figure maps kernel `(x, y, z)` to `(x, z, −y)` (`toSimBasis`, in both
  `foldedFigure3dProjection.ts` and `folded3dMesh.ts`), putting the paper normal
  on the same world Y.

For a flat or nearly-flat sheet that is exactly right: the normal *is* up, and
the turntable behaves. But a model that stands — a crane, a box, anything with a
vertical axis — has its own up lying **in** the paper plane, at some angle
nothing in the pipeline knows. Yaw then spins it about an axis through its
front, which reads as rolling, and pitch tilts about a screen axis that is not
its waist. That is the "up direction is wrong" feeling, and it is not
recoverable by dragging: yaw and pitch are 2 DOF and they only ever move the
*eye* on a sphere whose pole is fixed. Choosing a different pole is a third piece
of state that does not exist yet.

## Approach

Give each model an **orientation** `R`, applied to positions before the camera:

```
view = Pitch(p) · Yaw(y) · R · (world − centre)
```

Yaw then spins about `R⁻¹ · Y`, so setting `R` *is* setting the up axis. `R` is
identity by default, which reproduces today's behaviour exactly — every existing
figure, fixture and golden is unaffected until someone presses the button.

### What the button computes

Let `T = Pitch(p) · Yaw(y) · R` be the current total rotation. `projectViewPoint`
puts view **+Y** at the top of the screen, so the model direction currently drawn
straight up is `v = T⁻¹ · (0,1,0)`.

We want `v` to become the yaw axis (`R'·v = (0,1,0)`) **and** the picture not to
jump (`Pitch(p')·Yaw(y')·R' = T`). Substituting the second into the first leaves

```
Pitch(p') · Yaw(y') · (0,1,0) = (0,1,0)
```

`Yaw` fixes `(0,1,0)`, and `toViewSpace` sends `(0,1,0)` to `(0, −sin p, cos p)`,
so this forces **`p' = −π/2`**, with `y'` free. Take `y' = 0` and fold the rest
into the orientation:

```
p' = −π/2,   y' = 0,   R' = Pitch(−π/2)⁻¹ · T
```

`p' = −π/2` sounds like an extreme and is not: pitch here is measured from
looking straight *down* the up axis (`camera.test.ts` pins pitch 0 as exactly
that), so `−π/2` is the eye at the **horizon** — the ordinary side-on view of a
standing model. Dragging toward 0 rises to look down on it, toward `−π` drops to
look up at it. That is a normal turntable; it is only the parametrisation that
reads oddly.

### Where it is stored

A quaternion on the view (`{yaw, pitch, zoom, orient}`), `orient` optional and
absent meaning identity. Quaternion rather than Euler angles because it composes
and re-normalises cleanly under repeated presses; a `mat3` is what reaches the
shader.

### Prerequisite: unify the view transform onto a matrix

The first draft of this plan proposed threading a `u_orient` uniform through
every site that writes the view transform. Counting those sites is the argument
against doing it that way — **two** different things are duplicated:

| Duplicated | Copies |
| --- | --- |
| Yaw/pitch rotation | mesh vertex shader, edge `projectNdc`, edge `projectDepth` (a *partial* copy — skips `yawX`), and `toViewSpace` in TS |
| Perspective divide + NDC mapping | mesh vertex shader, edge `projectNdc`, and `projectViewPoint` in TS |

The code already says as much: `projectNdc` is commented "Same one-point
perspective as the face pass, so creases sit on their faces" — a note asking a
human to hold two things equal. `projectDepth` shows why that is fragile; it is
a hand-inlined subset that recomputes `yawZ` and skips `yawX`, which is the kind
of near-copy that goes stale with nothing failing.

So the orientation should **not** be a fourth parameter threaded through four
sites. Instead:

> Build the view rotation as a `mat3` on the CPU and upload it. The shader
> becomes `vec3 v = u_view * d;` — no trigonometry in GLSL at all.

This is not a repudiation of the existing design. `camera.ts` deliberately keeps
"the one JS statement of that math ... beside the uniforms it consumes, [which]
is what makes the two testable against each other", and that reasoning is right.
A matrix *strengthens* it: the trig ends up in exactly one language and the GPU
consumes its output, so the two cannot disagree — the mirror test stops being
load-bearing and becomes a formality.

What it buys:

- **The up-axis feature stops touching GLSL.** `R` composes into the matrix on
  the CPU (`u_view = Pitch · Yaw · R`), turning a five-site change into a
  one-site change. This is the main reason to do it first.
- **It removes a live sign trap.** `folded3dEyeDirection` is documented as "the
  third row of the view rotation" and then hand-derives it in trigonometry, with
  a warning that a wrong sign "draws the figure near-to-far". With a real matrix
  it is a row lookup and the trap is gone by construction.
- `projectDepth` becomes an honest row of the matrix rather than a re-derivation.

What it costs, stated plainly:

- **Last-bit differences.** `cosP*(cosY*dz)` reassociated to `(cosP*cosY)*dz` is
  not bit-identical. The folded projector's golden primitive stream may need a
  tolerance, and deciding that is part of the work rather than a footnote.
- GLSL is column-major, so the "third row" is not `u_view[2]` — either upload the
  transpose or index accordingly. Small, but exactly the kind of detail that
  silently inverts depth.

**This is its own PR, landed before the feature.** A pure refactor with no
user-visible change can be validated against the goldens on its own; bundled with
the feature, a golden diff could be caused by either, which is the worst position
to debug from.

The remaining GLSL duplication — the perspective/NDC mapping shared between the
mesh and edge shaders — is fixed the only way it can be across a language
boundary: one exported GLSL source constant concatenated into both programs.

### The folded projector, which looks like a blocker and is not

`foldedFigure3dProjection.ts` builds its BSP in **world** coordinates with
`edgeInk: 0`, deliberately so that one tree serves any viewpoint and only the
traversal is camera-dependent. An orientation is therefore just another camera
change: it moves `folded3dEyeDirection`, and `orthographicEye`, `directionToView`
(face shading) and the `upTowardEye` cell-stack choice all derive from that one
function. **The tree does not need rebuilding**, and `folded3dFrameRadius` is a
bounding *sphere*, so the figure's frame does not move either.

### Persistence and the existing verbs

- `nativeProjectFile.ts`'s `foldedFigureCamera` validator gains an optional
  `orient`; absent or malformed → identity, so every existing `.osf` opens
  exactly as it does today and no schema bump is forced.
- `antipodalCamera` / `foldedFigureOtherSideCamera` carry `orient` through
  untouched — "the other side" moves the eye, not the model's up.
- A folded figure's camera is document state, so the press takes one undo entry
  through the existing `beginFoldedFigureGesture` / `commitFoldedFigureGesture`.
- The vector projection is also the **export** path (`.osf` picture, SVG, PNG),
  so a figure with an upright set exports at that orientation. That is the
  intent, but it is a visible consequence worth stating.

### The button on each surface

- **Folded figure** — a new command in `foldedFigureActions.ts`, the React-free
  action catalog, beside the `reset-view` that already exists there. Per
  `AGENTS.md` that single entry is what makes it appear in the floating toolbar,
  the right-click menu and the menu bar without three registrations.
- **Simulation** — `SimulatorViewportHandle` gains `setUpright()`; the control
  goes in `SimulatorViewControlsPanel.tsx` beside its existing reset buttons.
  One implementation covers the inline window and the Simulate panel.
- Any keyboard shortcut is registered in `keyboard/`, never as a container
  `keydown` listener.

### Rejected alternatives

- **Add a roll angle.** The obvious cheaper idea, and it does not work: roll
  levels the picture but leaves the yaw pole where it was, so dragging still
  tumbles. It fixes the symptom in one frame and nothing after it.
- **Bake the rotation into the geometry.** Destroys the kernel's exact cell data,
  invalidates the BSP and the `cell_stack` order, and makes the stored figure
  lossy. The orientation belongs to the view.
- **Infer up automatically** (principal axis, largest face, gravity guess). Every
  rule is wrong on some model and there is no signal to tell the user why.

## Decisions

Settled before implementation:

1. **A simulation's upright persists.** It rides along with the simulation's
   saved settings rather than living and dying with the viewport, so a view
   someone set up to work in survives a reload — the same promise the folded
   figure's camera already makes. This is the one answer that adds plumbing the
   surface does not have today, so it is the first place to expect surprises.
2. **Upright is sticky across "Reset view".** An upright is a property of the
   model, not of the current look at it, so `reset-view` returns yaw, pitch and
   zoom and leaves the orientation alone. Clearing it is a **separate verb**,
   which the action catalog gets alongside the setter.
3. **Upright is the current screen-up, exactly.** No snapping to a nearest axis:
   the picture does not move at the moment of the press, which is what makes the
   button feel like it did what you asked. Snapping remains an easy addition
   later if the raw version turns out to be fiddly to aim.

## Affected Areas

- `packages/origami-simulator/src/webgl/camera.ts` — `CameraUniforms` carries the
  view `mat3`; `toViewSpace` / `projectViewPoint` consume it
- `packages/origami-simulator/src/webgl/meshRenderer.ts` — shaders take `u_view`
  and lose their trigonometry; shared GLSL constant for the projection
- `apps/web/src/lib/simulatorOrbit.ts` — `orient` on the shared view, the
  set-upright computation, quaternion helpers
- `apps/web/src/simulator/SimulatorViewport.tsx` — handle method, camera plumbing
- `apps/web/src/components/panels/SimulatorViewControlsPanel.tsx` — the control
- `apps/web/src/cp-workspace/folded/foldedFigure3dProjection.ts` — `orient` on
  `FoldedFigureCamera`, eye direction, `antipodalCamera`, defaults
- `apps/web/src/cp-workspace/folded/folded3dWindow.ts`,
  `folded3dMesh.ts`, `useFoldedFigures.ts` — carry it through
- `apps/web/src/cp-workspace/folded/foldedFigureActions.ts` (+ icons, menu items)
- `apps/web/src/lib/nativeProjectFile.ts` — validator
- `apps/web/src/keyboard/` — shortcut, if wanted
- i18n catalogs; `analytics/events.ts` if the action needs a hand-placed event

## Checklist

- [x] Settle the three decisions above

**PR 1 — unify the view transform (pure refactor, no user-visible change)**

- [ ] Build the view rotation as a `mat3` on the CPU; `cameraUniforms` returns it
- [ ] Shaders take `u_view` and drop their trigonometry; watch the column-major
      transpose on the depth row
- [ ] Share the perspective/NDC mapping between the mesh and edge programs as one
      GLSL source constant
- [ ] `folded3dEyeDirection` becomes a row lookup rather than a re-derivation
- [ ] Decide the golden-stream tolerance question and say so in the PR
- [ ] `camera.test.ts` / `meshRendererDraw.test.ts` still pin CPU↔GPU agreement

**PR 2 — the up axis**

- [ ] Quaternion helpers + the set-upright computation, unit-tested on their own
- [ ] `orient` composed into the view matrix on the CPU — no shader change
- [ ] `orient` on `FoldedFigureCamera`; eye direction, shading and cell-stack
      choice all derive from it; goldens unchanged at identity
- [ ] Set-upright on `SimulatorViewport` + the control in view controls
- [ ] A simulation's upright persists with its saved settings (decision 1 — the
      one surface that has no persistence for this today)
- [ ] Set-upright **and** clear-upright as `foldedFigureActions` commands;
      toolbar, context menu and menu bar all pick both up
- [ ] `reset-view` leaves the orientation alone (decision 2), pinned by a test
- [ ] `.osf` round-trip; an existing file with no `orient` opens identically
- [ ] Undo takes exactly one entry per press
- [ ] i18n: inline English, `i18n:extract`, 8 locales, `i18n:stamp`, `i18n:check`
- [ ] Analytics event (or confirm the `handleMenuAction` chokepoint covers it)
- [ ] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [ ] Browser: set upright on a standing model, confirm orbit turns around it
