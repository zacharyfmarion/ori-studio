# View-aligned drag box

## Goal

Make everything you create by pointing at the CP canvas come out **upright on
screen**, at any view rotation:

- Rubber-band box gestures — erase (right-drag and the Erase tool), box
  select/unselect, toggle M/V, and the ambient marquee — track the viewport's
  axes rather than the model's.
- Every canvas object is born upright and parked in a row that reads as a row on
  screen: text boxes (click and drag), reference images (drop and Insert),
  folded figures, and inline-simulation windows.
- **The view is part of the document.** Save and reopen puts you back at the
  rotation, zoom, and centre you left, so nothing you created upright comes back
  tilted.

Today all of these are axis-aligned in *model* space, so once you rotate the view
(as you must to draw at 22.5° angles) the erase box is drawn and applied at an
angle to the screen — you cannot sweep an upright region, you sweep a diamond —
and anything you add lands tilted by the view angle.

The persistence half is what makes the rest coherent. Hex pleating is worked at a
rotated canvas as a matter of course, for the whole life of the design; the view
is not a transient way of looking at the document, it is how that document is
authored. If reopening a file snapped back to square, every object created
upright would come back tilted and the fix would be half a fix.

Success looks like: at any view rotation, press-drag paints an upright rectangle
on screen and erases/selects exactly what it covers; anything you add sits square
to the screen you added it on; and closing and reopening the file gives you back
exactly the canvas you left.

## Background: the earlier decision, and the two premises that were wrong

[cp-view-rotation.md](cp-view-rotation.md#the-one-real-fork-what-does-a-drag-box-select-mean-when-rotated)
deliberately chose the model-aligned box (its "option A") over the
viewport-aligned box ("option B"). That decision rested on two claims. Both are
false, which is why this plan reverses it rather than re-litigating a trade-off.

**Claim 1 — "A rotated box is *inexpressible* in the kernel contract."**

It is already expressible. [lib.rs:3639](crates/oristudio-cp/src/lib.rs:3639):

```rust
fn required_selection_polygon(command: &CreasePatternCommand) -> Result<Polygon> {
    let points = required_points_at_least(command, 2)?;
    if points.len() == 2 {
        return Ok(rectangle_polygon(points[0], points[1]));
    }
    Ok(Polygon::new(points))
}
```

Two points mean "AABB from this diagonal"; three or more mean "this polygon,
verbatim". Every box operation the user can reach goes through this one function
— `LineSegmentDelete` ([lib.rs:1531](crates/oristudio-cp/src/lib.rs:1531)),
`CreaseSelect` ([:1610](crates/oristudio-cp/src/lib.rs:1610)), `CreaseUnselect`
([:1619](crates/oristudio-cp/src/lib.rs:1619)), `CreaseToggleMv`
([:1682](crates/oristudio-cp/src/lib.rs:1682)) — and the predicates behind it
(`Polygon::totu_boundary_inside_line_segment`,
`totu_boundary_inside_circle`,
[polygon.rs:145-169](crates/oristudio-cp/src/geometry/polygon.rs:145)) are
general-polygon code, not rectangle code.

The N-point branch is not theoretical: `SelectLasso`, `SelectPolygon`,
`UnselectLasso` and `UnselectPolygon` are `drag-path` tools that already ship
many-point polygons down this exact path in production. **The kernel needs no
change at all.**

**Claim 2 — "this is *better* than upstream Oriedita, which computes selection
in object space while drawing a screen-aligned rectangle."**

Upstream does the opposite of that.
`BoxSelectStepNode.runDragAction`
(`third_party/oriedita/.../handler/step/BoxSelectStepNode.java`) builds the four
corners as an axis-aligned rectangle in **TV (screen) space**, then maps each one
through `camera.TV2object()`:

```java
Point p19_2 = new Point(selectionStart.getX(), mousePos.getY());
Point p19_4 = new Point(mousePos.getX(), selectionStart.getY());

Point p19_a = camera.TV2object(selectionStart);
Point p19_b = camera.TV2object(p19_2);
Point p19_c = camera.TV2object(mousePos);
Point p19_d = camera.TV2object(p19_4);
```

`Camera.TV2object` applies `cos_rad`/`sin_rad` and `camera_mirror`, so those four
model-space corners are a *rotated* quadrilateral. `getBox()` returns them as a
`Rectangle extends Polygon` with all four corners, and `drawPreview` strokes the
same four unprojected segments. Upstream's marquee and upstream's selection are
both screen-aligned, and they agree with each other.

So the viewport-aligned box is the **parity** behaviour, and the model-aligned
box is our divergence. That settles it under `AGENTS.md` porting discipline: this
is adopting upstream's construction, not inventing kernel semantics.

## Approach

One idea, applied everywhere a rectangle is born from a pointer: **build it in
view space and map it back, instead of min/max-ing two model points.** Phases 1–6
do that for the selection/erase box (plus generalising our own JS hit-tests from
AABB to convex quad); Phases 7–9 do it for the objects the canvas creates, which
all already have the `rotation` field the fix needs.

Phase 10 — persisting the camera — is **independent of the rest and can land
first**. It is the smallest standalone win here and it is what stops Phases 7–9
from being undone by a reopen.

### Phase 1 — Pure corner construction

New `apps/web/src/cp-workspace/tools/viewAlignedBox.ts`:

```ts
export type BoxCorners = readonly [ModelPoint, ModelPoint, ModelPoint, ModelPoint];

/**
 * The four model-space corners of the rectangle that is axis-aligned *on screen*
 * and spans `a`–`b` diagonally, in perimeter order. Mirrors Oriedita's
 * `BoxSelectStepNode.runDragAction`: form the rect in view space, map each corner
 * back through the inverse view transform.
 *
 * `view === null` falls back to the model-axis-aligned corners (today's box).
 */
export function viewAlignedBoxCorners(
  a: ModelPoint,
  b: ModelPoint,
  view: ViewTransform | null
): BoxCorners;

/** The four edges of a corner quad, in perimeter order. */
export function boxCornerEdges(corners: BoxCorners): ToolPreviewSegment[];
```

Implementation is `projectModelPoint` both diagonal corners, take the two mixed
corners in device space, `unprojectDevicePoint` all four
([renderer/camera.ts:240-265](apps/web/src/cp-workspace/renderer/camera.ts:240)).
Use Oriedita's corner order (`a`, `(a.x, b.y)`, `b`, `(b.x, a.y)` in view space)
so the vertex sequence handed to the kernel matches upstream's `Rectangle`.

`unprojectDevicePoint` returns `null` on a degenerate basis — fall back to the
model-aligned corners in that case rather than dropping the gesture.

Unit tests: identity view reproduces today's `boxEdges` output; a 45° view
produces a quad whose edges are ±45° in model space and whose corners round-trip
to an upright device-space rect; a mirrored view still yields perimeter order; a
flat (zero-height) drag yields four collinear points, not a crash.

### Phase 2 — Convex-quad hit tests

New `apps/web/src/cp-workspace/picking/convexQuad.ts`, generalising the two
predicates in
[picking/lineHitIndex.ts:139-184](apps/web/src/cp-workspace/picking/lineHitIndex.ts:139):

- `pointInConvexQuad(p, quad)` — sign-consistent edge cross products, on-edge
  counts as inside.
- `segmentIntersectsConvexQuad(a, b, quad)` — the same Liang–Barsky clip the AABB
  version uses, against the quad's four inward half-planes instead of four axis
  half-planes. Keeps the existing *crossing* ("touch") marquee semantic exactly.
- `circleRingIntersectsConvexQuad(cx, cy, r, quad)` — near distance is
  `min` over edges of `distanceToSegment` (0 when the centre is inside), far
  distance is `max` over the four corners; ring hits iff `near <= r <= far`. Same
  formulation as the AABB version, so ring semantics are unchanged.

Reuse `distanceToSegment` from `lineHitIndex.ts`. Keep the `Aabb` *type* — it has
many other users (`cpFoldedToScene`, `placeBesideCp`, `inlineSimulation`) — but
`segmentIntersectsAabb` / `circleRingIntersectsAabb` fall out of production use
here; delete them and their tests once nothing imports them.

Unit tests mirror `lineHitIndex.test.ts`'s cases at rotation 0 (so the
generalisation is provably a superset), plus rotated-quad cases: a segment that
the model AABB would catch but the rotated quad must not, and vice versa.

### Phase 3 — Engine: commit four corners

[tools/types.ts:13-30](apps/web/src/cp-workspace/tools/types.ts:13) — add to
`ToolInput`:

```ts
/**
 * The live model→device transform, so a box tool can build a rectangle that is
 * axis-aligned on screen (Oriedita's `BoxSelectStepNode` builds its box in view
 * space and unprojects the corners). Absent → the box is model-axis-aligned and
 * commits two diagonal corners, which is what the operation frame needs.
 */
viewTransform?: ViewTransform | null;
```

This follows the precedent already set by `tolerance`, which is likewise a
surface-computed, camera-dependent value handed to a pure engine.

[tools/dragBoxTool.ts](apps/web/src/cp-workspace/tools/dragBoxTool.ts):

- `DragBoxState` keeps `start` as-is.
- `move` previews `boxCornerEdges(viewAlignedBoxCorners(start, point, view))`
  instead of the current model-space `boxEdges`.
- `up` commits **four** corners when a view transform is present, and the current
  **two** diagonal corners when it is not. The zero-length guard stays on the two
  diagonal points (`start` vs cursor), unchanged.

Existing `dragBoxTool.test.ts` cases pass a view-less input, so they keep
asserting today's behaviour verbatim; add parallel rotated cases.

### Phase 4 — Surface wiring

[CreasePatternWebglCanvas.tsx](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx):

1. Add a small `currentView()` helper inside the pointer effect —
   `modelViewFromCamera(cam, viewportOf(dpr()), liveRef.current.modelToSvg)` is
   already recomputed inline in `modelToleranceOf` (`:1550`) and `updateMarquee`
   (`:1639`); this is now needed in four places.
2. `feedTool` (`:1753`) and `feedErase` (`:2480`) pass `viewTransform:
   currentView()` on every `down`/`move`/`up`.
3. Replace `dragModelBox` (`:1618-1628`) with `dragBoxCorners(clientX, clientY)`
   returning `BoxCorners` via `viewAlignedBoxCorners`. Replace the docblock at
   `:1608-1617` — it asserts the now-disproven "cannot be expressed in that
   contract" — with a pointer to upstream's `BoxSelectStepNode`.
4. `boxSelect` (`:1660-1679`) switches to the Phase 2 quad predicates.
5. `updateMarquee` (`:1630-1659`) **gets simpler**: the box is upright on screen,
   so it is a plain unrotated CSS rect from the client-space press/cursor pair.
   The project-origin-and-two-edge-vectors math and the `rotate()` transform both
   go away (~20 lines). `transform-origin: 0 0` in
   [theme.css:2421](apps/web/src/styles/theme.css:2421) becomes inert; drop it.

### Phase 5 — The operation-frame carve-out

`OperationFrameCreate` is the one `drag-box` operation that must **not** get four
corners. Its kernel handler
([lib.rs:2372](crates/oristudio-cp/src/lib.rs:2372)) reads `points[0]` as the
press, the middle points as intermediate drags, and `points.last()` as the
release — hand it four perimeter corners and the frame spans an *edge* instead of
the diagonal.

- Add `isModelAlignedBoxOperation(operationId)` to
  [tools/predicates.ts](apps/web/src/cp-workspace/tools/predicates.ts:56), beside
  the existing `isRestrictedDrawOperation` / `isLineEraseClickTool` family, and
  cover it in `predicates.test.ts`.
- The panel passes it down as `activeToolModelAlignedBox`, matching how
  `activeToolRequireSnap` and `activeToolClickAction` already reach the canvas.
- When set, the surface passes `viewTransform: null` — the engine's fallback path
  is byte-for-byte today's behaviour, so the frame is provably unchanged.

Note for the record: upstream's operation frame is *also* screen-space
(`MouseHandlerOperationFrameCreate` stores `frame.getP1()` in TV coords and only
calls `TV2object` to draw), so our port already diverges there under rotation. It
is `placement: 'hidden-ui-only'` and unwired, so fixing that is out of scope —
worth its own plan if the frame is ever surfaced.

### Phase 6 — Kernel characterisation tests

No kernel change, but the four-corner path for these operations is currently
unexercised. Add to `crates/oristudio-cp/tests/`:

- A four-corner axis-aligned polygon selects/erases exactly what the two-point
  form does (equivalence, both windings).
- A 45°-rotated quad erases the creases inside it and leaves the ones a
  same-diagonal model AABB would have caught.
- A degenerate (collinear) four-corner polygon behaves like the flat two-point
  box — a straight drag still erases what it sweeps.

### Phase 7 — Upright text boxes

Nothing in the render or transform path needs teaching: `AnnotationBox` already
carries `rotation`
([annotationTransform.ts:63-68](apps/web/src/cp-workspace/annotations/annotationTransform.ts:63)),
`CpTextAnnotationLayer` already projects it through `screenAngle` into a CSS
`rotate()`
([CpTextAnnotationLayer.tsx:23-28](apps/web/src/cp-workspace/CpTextAnnotationLayer.tsx:23)),
and hit-testing (`annotationAtModelPoint`,
[annotation.ts:57-75](apps/web/src/cp-workspace/annotations/annotation.ts:57)),
resize, and `.osf` round-trip all honour it. The only defect is that both
creation paths hard-code rotation 0.

**Shared helper.** Add to `annotationTransform.ts`:

```ts
/**
 * The object-space rotation whose local +x axis points along screen +x — i.e.
 * what to store on a box so it renders upright under this view.
 *
 * Derived by mapping a CSS +x step back through the inverse affine, so it stays
 * exact under a flipped or non-conformal basis rather than assuming the view is
 * a pure rotation.
 */
export function uprightRotationForView(view: CpOverlayView): number;
```

Implementation: `overlayCssDeltaToModel(view, { x: 1, y: 0 })`, then
`Math.atan2(d.y, d.x)`; return `0` when the basis is degenerate. Tests: identity
view → 0; a 45° view → −45° (and `screenAngle` of that result → 0); a flipped
view still round-trips to a zero screen angle.

**Drag-created text** reuses the Phase 1 corners rather than re-deriving a box
from two points, so what gets created is provably the rectangle the marquee drew:

- `onTextCreateBox` ([CreasePatternWebglCanvas.tsx:560](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:560),
  called at [:2758](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:2758))
  takes `BoxCorners` instead of `(start, end)`. The canvas already computes them
  for the marquee in Phase 4.
- Replace `textBoxFromDrag`
  ([textAnnotation.ts:198-211](apps/web/src/cp-workspace/annotations/textAnnotation.ts:198))
  with `textBoxFromDragCorners(corners, minExtent)`: `center` is the mean of the
  four corners, `width`/`height` are the two edge lengths, `rotation` is
  `atan2` of the first edge. The existing "too small → return null so the caller
  falls back to a click-created box" contract is unchanged, now measured along
  the box's own axes.
- `createTextBoxFromDrag`
  ([useCpAnnotations.ts:318](apps/web/src/cp-workspace/annotations/useCpAnnotations.ts:318))
  passes the resulting `rotation` into `createTextAnnotation`, which already
  accepts it ([textAnnotation.ts:161,180](apps/web/src/cp-workspace/annotations/textAnnotation.ts:161)).

**Click-created text**: `createTextAt`
([useCpAnnotations.ts:281](apps/web/src/cp-workspace/annotations/useCpAnnotations.ts:281))
adds `rotation: uprightRotationForView(overlayView)`. Its width already goes
through `overlayCssPerModel`, which is rotation-invariant, so sizing needs no
change.

Port the existing `textBoxFromDrag` tests onto the corner form (they should read
identically at rotation 0) and add a 45° case.

### Phase 8 — Upright reference images

`addImageFromFile`
([useCpAnnotations.ts:156-198](apps/web/src/cp-workspace/annotations/useCpAnnotations.ts:156))
is the single creation path — the viewport drop handler and the Insert-image
button both call it. It resolves `center` from a client point via
`overlayCssToModel` and sizes from `overlayCssPerModel`, both of which are
already rotation-correct. The one missing field is rotation:

```ts
createCpImage({ …, rotation: uprightRotationForView(overlayView) })
```

`createCpImage` already accepts it
([cpImage.ts:91,109](apps/web/src/cp-workspace/images/cpImage.ts:91)), the WebGL
image program already draws it
([reglRenderer.ts:139](apps/web/src/cp-workspace/renderer/reglRenderer.ts:139)),
and `validateCpImage` already round-trips it through `.osf`
([cpImage.ts:169](apps/web/src/cp-workspace/images/cpImage.ts:169)). Guard the
`overlayView === null` case to 0, as the surrounding code already does for
centre and extent.

### Phase 9 — Upright folded figures and inline simulations

These are the other two members of the class, and they need one thing more than
text and images: they are not dropped at a cursor, they are *packed* into a row
beside the crease pattern by `firstFreeSlotBeside`
([placeBesideCp.ts:40](apps/web/src/cp-workspace/canvasObjects/placeBesideCp.ts:40)).
So orientation alone is not enough — under a 45° view, "to the right of the CP,
top-aligned" in model space marches diagonally down-screen, and a row of folded
figures reads as a staircase.

Both halves are needed:

**Orientation.** `placeFoldedFigureBesideCp`
([cpFoldedToScene.ts:606-633](apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts:606))
returns `rotation: 0`; `createInlineSimulation`
([inlineSimulation.ts:138-178](apps/web/src/cp-workspace/inlineSimulation/inlineSimulation.ts:138))
builds `box: { …, rotation: 0 }`. Both become
`uprightRotationForView(view)`. Both fields are already honoured downstream —
`foldedFigureUserAabb` takes the AABB over rotated corners, and `boxAabb` does
the same for simulation windows.

**Packing space.** Do the packing in view space and map the resulting slot back.
`firstFreeSlotBeside` already documents itself as "deliberately unit-agnostic …
as long as one caller stays in one space", so this is working *within* its
contract, not bending it: the callers change which space they hand it, the
function is untouched.

Each caller uses its own matching overlay view — the canvas already publishes
both, as `CpOverlayViews.model` and `.user`
([cpOverlayViewStore.ts:29-34](apps/web/src/cp-workspace/cpOverlayViewStore.ts:29))
— because folded figures work in SVG user coordinates and inline simulations in
CP model coordinates.

Give each placement function an **optional** `view` parameter; `null` keeps
today's model-space packing verbatim, so headless callers, tests, and any
non-canvas path are unaffected and the change is opt-in at the call site.

One pleasant consequence: once objects are created upright, their view-space
AABBs are *exact* rather than inflated over rotated corners, so packing gets
tighter than it is today. Objects created under a different earlier view still
inflate, which only ever costs extra spacing.

### Phase 10 — Persist and restore the view (independent; can land first)

This is the hex-pleating requirement: you rotate the canvas, work rotated for the
life of the design, save, reopen, and find the canvas as you left it. Rotation
alone does not satisfy "looks the same" — **persist zoom and centre with it.**

Confirmed against a real file: a `.osf` saved from a rotated canvas
(`schemaVersion: 6`) writes a `viewState` of `creaseColorMode`, `selection`,
`viewport`, `foldedFigures`, `activeFoldedFigureId` and nothing else, with
`viewport` holding only display toggles (grid, snap, line style, widths).
`workspace.viewState` is `{}`. **The camera is not written, not merely not
read** — so this needs a serializer change, not just a loader change, and a
read-only fix would look plausible and do nothing.

**`.osf`.** `viewState` currently carries `creaseColorMode`, `selection`,
`viewport` (display options — grid, snap, widths; *not* a camera),
`foldedFigures`, `activeFoldedFigureId`
([nativeProjectFile.ts:108-115](apps/web/src/lib/nativeProjectFile.ts:108)). Add a
`camera?: { centerX, centerY, zoom, rotation }` beside them and bump
`NATIVE_PROJECT_SCHEMA_VERSION` 6 → 7
([nativeProjectFile.ts:37](apps/web/src/lib/nativeProjectFile.ts:37)), widening
the accepted-version union and its validator
([:304-316](apps/web/src/lib/nativeProjectFile.ts:304)). Absent → today's
auto-fit, exactly as `images`, `textAnnotations`, and `inlineSimulations` each
handled their own "absent in older files" migration. `minimumReaderSchemaVersion`
stays 1: an older reader that ignores the camera still opens the file correctly,
it just re-fits.

**`.ori` — this is parity, not invention.** Oriedita persists its crease-pattern
camera, and we already carry it: `oriedita:ori:creasePatternCamera` with
`cameraZoomX` and `cameraAngle` is in the *preserved* set
([orieditaNativeMetadata.ts:27,41](apps/web/src/lib/orieditaNativeMetadata.ts:27))
— round-tripped on save, never restored as a view. Oriedita itself reloads it, so
restoring it is matching upstream.

Two details that will bite:

- `cameraAngle` is in **degrees** (`camera_rad = camera_angle * do2rad`,
  `Camera.java:125`); our rotation is radians. And `TV2object` composes rotation
  in the screen→object direction where `userCameraToView` composes object→screen,
  so **the sign is probably flipped** — verify against a fixture saved from
  Oriedita at a known angle rather than reasoning it out.
- Add a *separate* `creasePatternCameraFromOrieditaMetadata()` reader. Do **not**
  extend `savedCreasePatternView`
  ([:187](apps/web/src/lib/orieditaNativeMetadata.ts:187)) — it carries an
  explicit "Reading two scalars is not the same as restoring the camera as a
  transform; do not grow this into one", and its job (un-biasing a folded
  figure's saved scale/rotation) is a different question that happens to read the
  same two numbers.

**That un-biasing stays correct, and restoring the camera quietly fixes it.**
This looks like a conflict and is not. A folded figure's stored model rotation is
`saved_rotation − A`. Today `A` is not restored, so it renders on screen at
`saved_rotation − A` — *not* what its author saw. Restore `A` and it renders at
`saved_rotation`, which is. The compensation is model-space and unaffected;
restoring the camera makes it come out right on screen for the first time.

**Wiring.** The real risk is the auto-fit. The `framingKey` effect re-fits on
every new document
([CreasePatternWebglCanvas.tsx:1299](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1299)),
and `cp-view-rotation.md` explicitly resets rotation there. A restored camera has
to win for that load without disabling auto-fit for documents that have none.
Prefer an explicit "this document supplied a camera" input over racing the
effect; see [cp-camera-imperative-handle.md](cp-camera-imperative-handle.md),
whose whole thesis is that camera *actions* do not belong in effects keyed on
re-derived objects. If that refactor lands first, this becomes a handle call.

**Not included:** localStorage. The file is the source of truth for a document's
view; a fresh session with no file should still fit.

### Deliberately not included

- **Shift+rotate snapping.** `IMAGE_ROTATION_SNAP_RADIANS` is 15°, applied in
  *object* space ([CanvasObjectOverlay.tsx:291](apps/web/src/cp-workspace/CanvasObjectOverlay.tsx:291)).
  An object created upright under a 22.5° view will therefore snap *off* upright
  on the first Shift-rotate. Whether that snap should become view-relative (nice
  angles on screen) or stay object-relative (nice angles on paper) is a real
  question with its own answer; flagging it rather than changing it here.

## Affected Areas

| Area | Change |
| --- | --- |
| `apps/web/src/cp-workspace/tools/viewAlignedBox.ts` | **new** — corner construction + edges |
| `apps/web/src/cp-workspace/picking/convexQuad.ts` | **new** — point/segment/circle-ring vs convex quad |
| `apps/web/src/cp-workspace/tools/types.ts` | `ToolInput.viewTransform` |
| `apps/web/src/cp-workspace/tools/dragBoxTool.ts` | view-aligned preview; four-corner commit |
| `apps/web/src/cp-workspace/tools/predicates.ts` | `isModelAlignedBoxOperation` |
| `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` | `dragBoxCorners`, `boxSelect`, simplified `updateMarquee`, view on tool/erase inputs, `onTextCreateBox` takes corners |
| `apps/web/src/cp-workspace/picking/lineHitIndex.ts` | drop the two now-unused AABB predicates (keep `Aabb`) |
| `apps/web/src/components/panels/CreasePatternPanel.tsx` | one new `activeTool*` prop |
| `apps/web/src/styles/theme.css` | drop the marquee's `transform-origin` |
| `apps/web/src/cp-workspace/annotations/annotationTransform.ts` | `uprightRotationForView` |
| `apps/web/src/cp-workspace/annotations/textAnnotation.ts` | `textBoxFromDrag` → `textBoxFromDragCorners` |
| `apps/web/src/cp-workspace/annotations/useCpAnnotations.ts` | rotation on click-text, drag-text, and image creation |
| `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` | folded figures: upright rotation, optional view-space packing |
| `apps/web/src/cp-workspace/inlineSimulation/inlineSimulation.ts` | simulation windows: same two changes |
| `apps/web/src/lib/nativeProjectFile.ts` | `viewState.camera`; schema v7 + validator |
| `apps/web/src/lib/orieditaNativeMetadata.ts` | new `creasePatternCameraFromOrieditaMetadata` reader |
| `apps/web/src/components/panels/CreasePatternPanel.tsx` | supply the saved camera on load; pass overlay views to placement |
| `crates/oristudio-cp/tests/` | four-corner polygon characterisation tests |
| `implementation-plans/cp-view-rotation.md` | append a correction: option (A) superseded, and rotation is now persisted |

No kernel source change. No wasm rebuild — the payload already carries
`points: Point[]` of arbitrary length
([oristudioCpTypes.ts:463](apps/web/src/engine/oristudioCpTypes.ts:463)), and the
existing lasso tools already exercise it. Object `rotation` needs no format work
either — it is already written and validated for text, images, folded figures,
and simulation windows. The only format change is Phase 10's camera.

## Risks and open questions

- **Winding.** `Polygon::inside` is ray-crossing parity and
  `totu_boundary_inside_*` iterate edges, so both are winding-independent. Only
  *perimeter* order matters (corners must not be given in diagonal order). The
  Phase 6 both-windings test pins this.
- **Degenerate drags.** A perfectly straight drag yields a zero-area quad. This
  is not new — `rectangle_polygon` produces an equally degenerate polygon for a
  flat two-point box today, and `dragBoxTool.test.ts` already has a case
  asserting flat boxes commit. Pinned again in Phases 1 and 6.
- **Non-rigid view transforms.** The corner construction goes through
  `project`/`unproject` rather than assuming an orthonormal basis, so it stays
  exact under mirror and any invertible transform. The simplified marquee *does*
  assume the on-screen box is upright, which it is by construction.
- **`OperationFrameCreate` under rotation** remains divergent from upstream.
  Deliberate, documented, hidden UI.
- **Objects are anchored to the paper; the view is what brings them back.** A
  text box created upright under a 45° view stores `rotation ≈ −45°` — the object
  keeps the orientation you gave it in document space, as in any design tool.
  What makes that read correctly on reopen is Phase 10 restoring the view. So
  **Phases 7–9 without Phase 10 are a regression on reload**: objects would come
  back tilted where today they come back square. If the two are split across
  PRs, land Phase 10 first.
- **Auto-fit vs. a restored camera** is the sharpest wiring risk in Phase 10 —
  see that phase. A restored camera that loses a race with the `framingKey`
  re-fit fails *silently* (you just get a fitted view), so it needs a test that
  asserts the camera after a load with a saved camera, not only a visual check.
- **Mirrored views.** `uprightRotationForView` gets the +x axis right under a
  flip, but a flip is not undoable by a rotation, so text under a mirrored view
  still reads mirrored. Pre-existing, unchanged by this work.
- **Older readers.** A schema-7 file opened by an older build ignores
  `viewState.camera` and re-fits. Acceptable, and why
  `minimumReaderSchemaVersion` stays 1 — the geometry is fully readable.

## Validation

Per [AGENTS.md](AGENTS.md), smallest set that covers the change:

```bash
npx tsc --noEmit -p apps/web && npx vitest run --root apps/web
```

```bash
cargo test -p oristudio-cp
```

Run `npm run lint:web`. `npm run build:web` is not needed (no generated bindings
or bundling change). Rust format/clippy only if the test files are added.

Browser checklist (owner: Zach):

1. Rotate the view to 45°; right-drag an erase box across a cluster of creases.
   The box paints upright on screen and erases exactly what it covers.
2. Same at 22.5° and at a negative angle; and with the view mirrored if reachable.
3. Erase tool (left-drag), box Select, box Unselect, Toggle M/V: all upright.
4. Ambient marquee (Select tool, drag on empty space) upright and consistent with
   what ends up selected, including circles.
5. Rotation 0: every one of the above is indistinguishable from before.
6. A straight horizontal and a straight vertical drag still erase/select.
7. At 45°: Text tool click-create — the editor and the committed box are upright.
8. At 45°: Text tool press-drag — the created box matches the marquee exactly
   (same rectangle, same orientation), and typing reads upright.
9. At 45°: drop an image file on the canvas, and insert one via the button —
   both land upright and centred where dropped/at view centre.
10. Select a rotated-on-create text box and an image: move, resize from a corner,
    and rotate handles all behave (they already work in object space, so this is
    a regression check, not new behaviour).
11. At 45°: fold a region to a folded figure, then fold a second — both upright,
    and the two read as a row across the screen, not a diagonal staircase.
12. At 45°: open two inline simulation windows — same check.
13. **The round trip.** At 45°, with text, an image, a folded figure and a
    simulation window placed: save `.osf`, close, reopen. The canvas comes back
    at 45° with the same zoom and centre, and every object sits exactly where and
    how it did. This is the acceptance test for the whole change.
14. Open a pre-schema-7 `.osf`: no camera, auto-fits as before, nothing throws.
15. Open an `.ori` saved from Oriedita at a known rotation: the view comes up at
    that rotation (this is the sign/degree check), and any folded figure in it
    lands where Oriedita showed it.

## Checklist

- [ ] Phase 1: `viewAlignedBox.ts` + unit tests (identity, 45°, mirror, flat)
- [ ] Phase 2: `convexQuad.ts` + unit tests; retire the AABB predicates
- [ ] Phase 3: `ToolInput.viewTransform`; `dragBoxTool` four-corner commit + tests
- [ ] Phase 4: canvas wiring; `boxSelect` on quads; simplified marquee
- [ ] Phase 5: `isModelAlignedBoxOperation` + prop; operation frame unchanged
- [ ] Phase 6: kernel four-corner characterisation tests
- [ ] Phase 7: `uprightRotationForView` + tests; `textBoxFromDragCorners`;
      `onTextCreateBox` takes corners; click- and drag-created text upright
- [ ] Phase 8: images upright on drop and on insert
- [ ] Phase 9: folded figures + inline simulations upright; optional view-space
      packing with a model-space default; row reads as a row at 45°
- [ ] Phase 10: `.osf` `viewState.camera` + schema v7 + migration test
- [ ] Phase 10: `.ori` camera reader (degrees → radians, sign verified against a
      real Oriedita fixture); `savedCreasePatternView` left alone
- [ ] Phase 10: restored camera beats the `framingKey` auto-fit, with a test that
      asserts the camera after load (silent failure mode)
- [ ] tsc / lint / web tests / `cargo test -p oristudio-cp` green
- [ ] `cp-view-rotation.md` correction appended
- [ ] Browser checklist passed, including the round trip (item 13)
