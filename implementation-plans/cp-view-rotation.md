# CP Viewport Rotation

## Goal

Let the crease-pattern viewport rotate, so a designer can work along a
pattern's diagonals with the paper turned — the "3 / 4 rotate left/right" keys
in Brandon Wong's Oriedita layout, and the last blocked item from
[`cp-editor-keybind-adoption.md`](cp-editor-keybind-adoption.md).

Deliverable: rotate CCW/CW buttons in the viewport toolbar, `3` / `4` bound to
them, a reset affordance, and correct pan / zoom / selection / overlay behaviour
at any angle.

## What already works (verified, not assumed)

An audit of every camera consumer found the pipeline is **structurally
rotation-ready**. `ViewTransform` is a full `{origin, ex, ey}` basis, not a
scale + offset, and almost everything consumes it generally:

- **Every shader** projects via `dev = origin + model.x*ex + model.y*ey`
  (`strokeProgram.ts:27-41`, `pointProgram.ts:39-46`, `wedgeProgram.ts:29-37`,
  `imageProgram.ts:34-50`, `fillProgram.ts:23`). Stroke widths derive their
  normal *after* projection, so screen-space width and dash pitch stay exact
  under rotation. **No shader changes.**
- **Picking** goes through `unprojectDevicePoint` (a true 2×2 inverse), and
  `LineHitIndex` is pure model space with no camera involvement.
- **Pixel→model tolerances** all route through `viewTransformScale`, which is
  `sqrt(|ex|·|ey|)` — rotation-invariant. ~20 call sites inherit that.
- **Every DOM overlay** (`CpTextAnnotationLayer`, `CanvasObjectOverlay`,
  `useCanvasObjectAnchor`, `annotationTransform`) already uses the full affine
  and its inverse. `screenAngle()` even derives text angle by projecting a unit
  vector, so it picks up camera rotation for free.
- **The grid** is generated as model-space lines and drawn through the camera,
  and `visibleGridBounds` already unprojects all four canvas corners — correct
  (if slightly over-generous) for a rotated view.

There is even precedent: `OrieditaCamera.cameraAngle` can already put a rotation
into the `model` affine when a native Oriedita camera is present
(`orieditaCamera.ts:82-112`), which is *why* the overlay layer was written
affine-generally.

## Architecture

**One source of truth.** `UserCamera` gains `rotation` (radians, CCW on screen).
`userCameraToView` is the only place that turns it into a basis; a single
private `deviceDeltaToUser` helper is the only place that inverts it. No other
module touches `sin`/`cos` for the view.

```
device = viewportCentre + R(θ) · (model − centre) · zoom

ex = zoom · [ cos θ, sin θ ]
ey = zoom · [ −sin θ, cos θ ]
origin = viewportCentre − (centre.x·ex + centre.y·ey)
```

`rotation` is **required, not optional**. That is deliberate: two sites assign a
whole new camera object (`CreasePatternWebglCanvas.tsx:2505` focus-diagnostic,
`:2523` fit). With an optional field those would silently reset rotation to 0;
required makes them compile errors that must be answered.

**State ownership** matches zoom/centre exactly: rotation lives in the canvas's
`cameraRef`, is not persisted to `.osf` or localStorage, and resets when
`framingKey` changes (new document). No store or file-format change.

## The one real fork: what does a drag-box select mean when rotated?

A screen-aligned marquee is a *rotated* rectangle in model space. The two
disagree, and today three things assume they don't:

- `boxSelect` (`CreasePatternWebglCanvas.tsx:1322-1348`) unprojects two opposite
  screen corners and min/max's them into a model AABB.
- `textBoxFromDrag` (`textAnnotation.ts:198-211`) does the same for text boxes.
- **`onEraseBox` and every `drag-box` tool send two model points into the Rust
  kernel**, which interprets them as an axis-aligned box (Oriedita semantics).
  A rotated box is *inexpressible* in that contract.

Two options:

- **(A) The box is axis-aligned in MODEL space; the marquee is drawn rotated.**
  The drag's two corners are model-space box corners, exactly as today. Requires
  **zero kernel changes**, keeps every drag-box tool working, and is
  what-you-see-is-what-you-select because the marquee is drawn to match.
- (B) Keep the marquee screen-aligned and make selection an oriented box.
  Requires an OBB path in TS *and* a new kernel contract for every drag-box
  tool — inventing kernel semantics, which `AGENTS.md` porting discipline warns
  against.

**Chosen: (A).** It is the only option that keeps the kernel contract intact,
and it makes the visual and the selection agree. Note this is *better* than
upstream Oriedita, which computes selection in object space while drawing a
screen-aligned rectangle — i.e. upstream has exactly the mismatch (A) removes.

Consequence: the marquee div is positioned at the projected drag-start corner
and rotated with `transform: rotate(θ)` / `transform-origin: 0 0`, sized by the
projected model extents. Since view rotation is rigid (no shear/anisotropy), a
plain CSS rotate renders the model rect exactly.

`textBoxFromDrag` then needs no change: the box stays model-axis-aligned with
`rotation: 0`, so the created text renders rotated on screen, matching its
marquee.

## Approach

### Phase 1 — Camera math (pure, fully unit-testable)
`apps/web/src/cp-workspace/renderer/camera.ts`:
1. Add `rotation: number` to `UserCamera` (required).
2. `userCameraToView` — emit the rotated basis above.
3. Private `deviceDeltaToUser(cam, dx, dy)` applying `R(−θ)/zoom`; use it in
   both `panUserCamera` and `zoomUserCameraAt` so the inverse lives once.
4. `fitUserCamera(bounds, viewport, padding, rotation)` — rotate the bounds'
   four corners into camera space, fit that extent, and return a camera carrying
   the requested rotation. (At 45° the naive AABB fit is off by up to √2.)
5. `seedUserCamera` — it is production-dead (only `camera.ts` + its test
   reference it) and is the codebase's only `ex[0]`/`ey[1]`-as-scale site.
   **Delete it** rather than maintain a rotation-correct version of dead code.

### Phase 2 — Canvas wiring
`apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx`:
1. Fix the two whole-object camera assignments (`:2505`, `:2523`) to preserve
   `cameraRef.current.rotation` (compile errors from Phase 1 point at both).
2. Pin the stroke-width reference `fitZoom` (`:1157-1160`) to an **unrotated**
   fit, so stroke weight doesn't drift as the view turns.
3. New `CameraCommand` kinds `rotate-by` (signed radians) and `rotate-reset`,
   applied in the existing command effect.
4. Marquee: rotate it per option (A) above.
5. `boxSelect` needs no math change under (A) — but add a comment recording why,
   since "unproject two corners → AABB" now looks suspicious.
6. Report rotation upward (alongside `onZoomPercentChange`) so the toolbar can
   show/reset the angle.

### Phase 3 — Controls, keybinds, i18n
1. Two `IconButton`s (`RotateCcw` / `RotateCw`) in `ViewportToolbar`, beside Pan,
   rendered only when the surface supplies the handlers (same optional-prop
   pattern the Pan button uses, so BP panels are unaffected).
2. A third button appears **only when rotation ≠ 0**, labelled with the current
   angle (e.g. `15°`); clicking resets to 0. Compact, self-describing, and it
   avoids overloading Fit — a user who deliberately rotated should not have
   rotation silently cleared by an unrelated framing command.
3. Step: **15°** per press. Divides 90/180/360 evenly and suits 15/30/45°
   systems. (Oriedita uses its angle-system step, default 11.25°, which does not
   divide 90 — a worse default here.)
4. `viewport.rotateCcw` → `3`, `viewport.rotateCw` → `4`, matching the adopted
   layout; `viewport.resetRotation` with no default chord.
5. New i18n keys for all 8 locales; tooltips carry their chords like Pan/Fold.

## Affected Areas

- `renderer/camera.ts` — rotation term, rotated pan/zoom/fit, delete `seedUserCamera`
- `renderer/camera.test.ts` — rotation cases (see Validation)
- `CreasePatternWebglCanvas.tsx` — camera assignments, fitZoom pin, rotate commands, marquee, rotation reporting
- `components/panels/ViewportToolbar.tsx` — rotate + reset buttons
- `components/panels/CreasePatternPanel.tsx` — rotation state, command plumbing, executor cases
- `keyboard/shortcuts.ts` + `shortcutRegistry.test.ts` — `3` / `4` / reset
- `styles/theme.css` — marquee `transform-origin`
- i18n catalogs — rotate/reset strings ×8 locales

Explicitly **not** touched: shaders, `LineHitIndex`, `annotationTransform`, the
overlay components, the grid generator, the Rust kernel, the `.osf` format.

## Edge cases & risks

- *Whole-object camera assignment drops rotation* — the sneakiest bug here.
  Mitigated by making the field required so both sites fail to compile.
- *Angle drift over many presses* — accumulating `±15°` in radians drifts.
  Normalise to `(−π, π]` and snap near-zero to exactly 0 so the reset button
  reliably disappears.
- *Zoom-to-cursor under rotation* — the highest-value invariant to test: the
  model point under the cursor must stay fixed at any θ. Property test over
  several angles.
- *Pan direction under rotation* — content must follow the cursor, not veer off
  at θ. Same test treatment.
- *Fit at 45°* — naive AABB fit overshoots by up to √2; covered by rotating
  bounds into camera space, with a test at 45° asserting all four content
  corners land inside the viewport.
- *Stroke width drift while rotating* — addressed by pinning `fitZoom`
  unrotated; verify visually that line weight is stable through a full turn.
- *Grid over-generation* — a rotated view's corner-unprojected AABB is up to 2×
  the needed area at 45°, on top of the existing 0.3 margin. Correct but heavier;
  measure, and only tighten if it shows up in a profile.
- *Marker glyph orientation* — SDF markers (triangle/square/cross) stay upright
  on screen while the pattern rotates. That is the defensible default for
  screen-space annotation glyphs (and what leaving them alone gives), but it is
  a deliberate call, not an oversight.
- *Text/image objects* — their own `rotation` composes with the view's; the
  shift-snap on the image rotate handle snaps to *model*-frame multiples, which
  stays correct under a rotated view.
- *`3`/`4` conflicts* — both are currently free bare keys (verified against the
  registry), and the guard test will fail if that changes.

## Validation

Tool-checkable (self-verified):
- `camera.test.ts` gains: rotated basis shape; project/unproject round-trip
  across a sweep of angles; pan-follows-cursor at θ; zoom-anchor-invariant at θ;
  rotated fit containment at 45°; angle normalisation.
- `npx tsc --noEmit`, `npm run lint:web`, `npm run test:web`, `npm run i18n:check`.
- Shortcut registry guard test extended for `3`/`4`.

Browser (self-verified via the preview, then handed over):
- Rotate CCW/CW: content, grid, images, and text all turn together; no drift.
- Pan at 45° follows the cursor; wheel zoom still anchors under the cursor.
- Marquee visually matches what gets selected while rotated.
- Text/image selection handles sit on the rotated object.
- Reset button appears only when rotated and returns to exactly 0°.
- Stroke weight stable through a full rotation.

## Checklist

- [x] Phase 1: `rotation` on `UserCamera`; rotated `userCameraToView`
- [x] Phase 1: `deviceDeltaToUser` + rotated `panUserCamera` / `zoomUserCameraAt`
- [x] Phase 1: rotation-aware `fitUserCamera`; delete dead `seedUserCamera`
- [x] Phase 1: camera unit tests incl. angle sweep + 45° fit
- [x] Phase 2: preserve rotation at both whole-object assignments; pin `fitZoom`
- [x] Phase 2: `rotate-by` / `rotate-reset` commands; rotated marquee
- [x] Phase 3: toolbar buttons + conditional reset; `3` / `4` binds
- [x] Phase 3: i18n ×8; registry guard updated
- [x] tsc / lint / tests / i18n green; browser checks passed
- [x] Plan + keybind-adoption plan updated (rotate no longer blocked)

## Outcome

Landed as designed. Two findings worth recording:

- **`dragBoxTool` already previewed its rectangle as model-space segments**
  (`tools/dragBoxTool.ts` `boxEdges`), drawn through the view transform. So the
  box tools' outline rotated correctly before any change, and option (A) made
  the DOM marquee agree with them rather than diverge. That is corroboration for
  the choice, not just a rationalisation of it.
- The required `rotation` field caught the focus-diagnostic whole-object
  assignment at compile time, exactly as intended. The `fit` site compiled
  regardless (it goes through `fitUserCamera`) and had to be fixed by
  inspection — worth remembering that a required field only catches *literal*
  construction, not construction via a defaulting helper.

Verified in the browser at 45°: content and grid rotate together; a horizontal
pan drag moved content +200px with zero vertical drift (the un-rotation is
exact); the marquee reported `rotate(0.785398rad)` with extents 296.985 x 42.426,
matching `R(-45°)·(240,180)` = (297.0, -42.43); reset returned the view to
square and removed the readout.

Not done, deliberately: SDF marker glyphs (triangle/square/cross) stay upright
on screen rather than turning with the pattern. They are screen-space annotation
glyphs, so upright is the defensible default; revisit only if it reads wrong in
practice.
