# Crease selection precedence over reference images

## Goal

A press on a crease selects the crease, even when a reference image sits under
it. Today a reference image swallows every press inside its bounding box, so the
core tracing workflow — drop a photo of a crease pattern behind the canvas and
draw over it — cannot select, erase, marquee or pan anywhere the image covers.

Two properties, stated as the rule the surface should obey:

1. **Reference images paint behind the creases.** Already true; this plan only
   pins it so it cannot regress.
2. **Pick order follows paint order.** Anything the surface paints *over* an
   object wins that object's press. Reference images are the only canvas-object
   kind painted behind the creases, so they are the only kind that yields.

## Root cause

Not a z-order bug and not a hit-test bug. The crease hit test never runs at all,
because the press is delivered to a different element.

The CP viewport stacks two absolutely-positioned siblings:

| Layer | Element | z-index |
| --- | --- | --- |
| WebGL surface (grid, images, creases, points, folded figures) | `canvas.cp-webgl-layer` | 5 |
| Text annotations / folded-figure windows / inline simulations | DOM layers | 7 |
| Canvas-object chrome (selection outline + resize/rotate handles) | `svg.cp-annotation-overlay` | 8 |

`CanvasObjectOverlay` draws one full-box `<polygon>` per canvas object —
reference images included — with `pointer-events: auto`
([CanvasObjectOverlay.tsx:534](../apps/web/src/cp-workspace/CanvasObjectOverlay.tsx:534)).
The polygon is the topmost element over the image's whole box, so the browser
routes the press there. `handleBodyDown` then calls `claimSurfacePress`, which
does `stopPropagation()` + `preventDefault()` + `setPointerCapture()`
([CanvasObjectOverlay.tsx:122](../apps/web/src/cp-workspace/CanvasObjectOverlay.tsx:122))
and selects the image.

The canvas's own picking lives in a **native listener bound on the canvas
element** (`canvas.addEventListener('pointerdown', onPointerDown)`,
[CreasePatternWebglCanvas.tsx:3523](../apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3523)).
The overlay is a *sibling*, not an ancestor, so an event dispatched to the
polygon never reaches that listener under any propagation rule. `hitTest`
([CreasePatternWebglCanvas.tsx:1890](../apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1890))
is never called. Nothing in `CanvasObjectOverlay` consults crease geometry, so
there is no precedence rule to be wrong — the question is never asked.

### Measured

Dev build, default document, one reference image centred on model `(0, 200)`,
one crease inserted at model `y = 260` running from `x = -260` to `x = 260`, so
the *same crease* passes both inside and outside the image's box. Synthetic
primary-button press at each point, routed through `document.elementsFromPoint`
(the browser's own hit test):

| Press point | Topmost element | Canvas saw the press | Crease selected | Image selected |
| --- | --- | --- | --- | --- |
| On the crease, **outside** the image box | `CANVAS.cp-webgl-layer` | yes | `[6]` | none |
| Same crease, **inside** the image box | `polygon` (overlay) | **no** | `[]` | the image |

Render order is already correct and is not part of the defect —
`reglRenderer.render` draws grid → **images** → creases → points → folded
figures ([reglRenderer.ts:300](../apps/web/src/cp-workspace/renderer/reglRenderer.ts:300)).
The image layer is, however, the one band `reglRendererLayerOrder.test.ts` does
not pin.

### Everything this same defect breaks

All of these are one bug — a press inside an unlocked image's box never reaches
the canvas — and all of them are fixed by the same change:

- Clicking a crease over an image selects the image instead.
- Right-click erase, and the crease context menu, over an image.
- Middle-button pan and `Meta`+drag pan started over an image.
- A marquee box-select started over an image.
- Canvas hover feedback (snap ring, previews) freezes while the pointer is over
  an image.

Two things already work and must keep working, because they mark the boundary of
the change:

- **Drawing tools are unaffected.** `annotationsInteractive` is false while a
  tool is `phase === 'active'`
  ([CreasePatternPanel.tsx:1142](../apps/web/src/components/panels/CreasePatternPanel.tsx:1142)),
  which sets the polygon to `pointer-events: none`. So the bug only bites in
  select mode and under `CreaseSelect`.
- **Locking an image** already sets `pointer-events: none`, which is the current
  (undiscoverable) workaround.

## Approach

Ask the surface first, and hand the press over when it says yes.

### 1. Say which kinds paint behind the creases

Add one field to `TransformableCanvasObject`
([canvasObjects/transformableObject.ts](../apps/web/src/cp-workspace/canvasObjects/transformableObject.ts)):

```ts
/**
 * Whether the surface's own geometry paints over this object. Pick order has to
 * match paint order, so an object the creases are drawn on top of must yield its
 * press to them; one drawn on top of the creases keeps it.
 */
paintedBehindCreases: boolean;
```

`annotationAsTransformable` sets it from `annotation.kind === 'image'`. Text
boxes (DOM layer, z-index 7), folded figures and inline simulations (drawn after
the creases, [reglRenderer.ts:326](../apps/web/src/cp-workspace/renderer/reglRenderer.ts:326))
all set `false` and behave exactly as today. Deriving it from the kind rather
than hard-coding `kind === 'image'` in the overlay is what keeps the overlay
kind-agnostic, which is its stated contract.

### 2. One pure rule for "does the surface own this press"

New leaf module `cp-workspace/picking/surfaceClaimsPress.ts`, in the shape of
`tools/pointerRelease.ts` — a pure function over a snapshot, unit tested, so the
rule lives in exactly one place:

```ts
export function surfaceClaimsPress(input: {
  button: number;
  metaKey: boolean;
  panToolActive: boolean;
  /** What the canvas' own hit test found at this point, if anything. */
  hit: CpSelectHit | null;
}): boolean;
```

True when the press is the right button (erase / crease context menu), the
middle button (pan), `Meta`+drag or the hand tool (pan), or when the canvas hit
test found a line, point or circle. The hit radius is the canvas's own
(`cpHitRadiusModel`, floor `CP_LINE_HIT_MIN_CSS = 8`), so precedence and picking
cannot disagree about what counts as "on a crease".

### 3. Publish a press entry point from the canvas

New module `cp-workspace/picking/cpSurfacePressRegistry.ts`, in the shape of
[`cpCameraRegistry`](../apps/web/src/cp-workspace/renderer/cpCameraRegistry.ts)
— the existing idiom for "the canvas publishes an imperative handle that code
with no props path needs":

```ts
export interface CpSurfacePressHandle {
  claimsPress(event: PointerEvent): boolean;
  /** Run the canvas' own press pipeline for an event delivered elsewhere. */
  press(event: PointerEvent): void;
}
export function registerCpSurfacePress(handle: CpSurfacePressHandle): () => void;
export function cpSurfacePress(): CpSurfacePressHandle | null;
```

The canvas registers alongside its camera
([CreasePatternWebglCanvas.tsx:3807](../apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3807)).
`claimsPress` composes `surfaceClaimsPress` with the existing `hitTest` and
`liveRef.current.panToolActive`; `press` is the existing `onPointerDown`, which
needs no change — it closes over `canvas` rather than reading `currentTarget`.

A registry rather than a prop because the alternative is threading a new
imperative handle up through the canvas and back down through the 3.4k-line
panel, which the panel guidance in `AGENTS.md` exists to prevent. When nothing
is registered (no CP panel, WebGL unavailable) `claimsPress` is never asked and
behaviour is exactly as today.

### 4. Overlay: decline and hand over

In `handleBodyDown`, `onContextMenu` and `onDoubleClick`, for an object with
`paintedBehindCreases`, consult the registry **before** `claimSurfacePress` —
before the arbiter sees a `down` from origin `'overlay'`, so only one layer ever
reports the contact:

```ts
if (object.paintedBehindCreases) {
  const surface = cpSurfacePress();
  if (surface?.claimsPress(event.nativeEvent)) {
    surface.press(event.nativeEvent);
    return;                       // no stopPropagation, no capture, no selection
  }
}
```

Capture transfers correctly: the overlay never captures on the decline path, and
`onPointerDown` ends with `canvas.setPointerCapture(e.pointerId)` on the real,
active pointer — which overrides the implicit touch/pen capture on the polygon —
so every later `pointermove` / `pointerup` is delivered to the canvas that now
owns the gesture. This is verified behaviour, not an assumption: the canvas
captured the real pointer id in the measurement above.

Passing `event.nativeEvent` rather than re-dispatching a synthetic
`PointerEvent` matters — the canvas calls `preventDefault()` on it, which does
nothing on a synthesised copy.

**Handles are untouched.** Resize and rotate handles are chrome: small,
deliberate, drawn on top, and they must keep beating creases or a selected image
over a dense pattern could not be sized at all. That is the same body-vs-handle
split `inertBodyIds` already draws.

## Performance

The change is confined to the `pointerdown` path. **Nothing in it touches
`render()`, geometry upload, or any per-frame work**, so there is no steady-state
cost and no cost at all in a document with no reference images (every other kind
has `paintedBehindCreases: false`, and with no image there is no polygon to press
in the first place).

The one thing it adds is a `hitTest` — i.e. a `LineHitIndex.query` — on presses
that land inside an image box. That is the same query the canvas already runs on
every press that lands on it today, so it is not a new cost class; it is an
existing cost now paid in the case that currently short-circuits. A claimed press
runs two queries rather than one (`claimsPress`, then `onPointerDown`'s own),
which is still once per click.

Measured in the dev build (Chromium), with the tolerance **derived from the zoom
by the real radius law** rather than chosen — that distinction turned out to
matter, see below:

| creases | fit zoom (1.75×) | 0.25× | 0.1× (far out) |
| --- | --- | --- | --- |
| 5,000 | 2.4 µs | 11.2 µs | 53.7 µs |
| 20,000 | 11.2 µs | 61.6 µs | 193 µs |
| 50,000 | 29.7 µs | 87.1 µs | 496 µs |

Tens of microseconds at any working zoom, and under a millisecond in the worst
case that can actually occur. `LineHitIndex.query` does have a
`cellsToScan > this.all.length → linearQuery` fallback
([lineHitIndex.ts:89](../apps/web/src/cp-workspace/picking/lineHitIndex.ts:89))
that scans every segment, but reaching it needs a tolerance far larger than the
radius law produces: `cpHitRadiusModel` derives the tolerance from the zoom, so
even at 0.1× on a 400-unit sheet it is ~54 model units.

> **Correction.** The first draft of this plan reported 1,850 µs and cut the
> hover work below on the strength of it. That figure came from pairing 50,000
> segments with a 400-model-unit tolerance — the entire span of the sheet, which
> no zoom produces. Benchmark the input the code actually receives, not a
> plausible-looking one.

The budget is therefore comfortable for `pointerdown`, and comfortable for one
call per animation frame. What it does not support is a call per *pointer
sample*: a high-rate pointer reports several times per frame, so hover work
coalesces onto `requestAnimationFrame` rather than running per event.

## Affected Areas

- `apps/web/src/cp-workspace/canvasObjects/transformableObject.ts` — new field,
  set per kind.
- `apps/web/src/cp-workspace/picking/surfaceClaimsPress.ts` — new pure rule.
- `apps/web/src/cp-workspace/picking/cpSurfacePressRegistry.ts` — new registry.
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — register the press
  handle; no change to `onPointerDown` itself.
- `apps/web/src/cp-workspace/CanvasObjectOverlay.tsx` — decline + hand over on
  body press, context menu and double-click.
- `apps/web/src/cp-workspace/folded/useFoldedFigures.ts`,
  `inlineSimulation/useInlineSimulations.ts` — set the new field to `false`.
- Tests: see Testing below.

No Rust, no wasm, no kernel change — this is entirely web-side pointer routing.

## Decided against: a move handle for the selected image

A crease claims a band of `CP_LINE_HIT_MIN_CSS = 8` CSS px either side of
itself, and that floor is in *screen* pixels
([snapRadius.ts:93](../apps/web/src/cp-workspace/snapRadius.ts:93)), so the band
does not grow when you zoom in while the on-screen spacing between creases does.
Any two creases more than ~16 CSS px apart leave interior the image still owns,
and zooming in always opens more of it. The affordance is self-correcting, so
the plain body drag is the move affordance and no extra chrome is warranted.

Also rejected: re-enabling the body once the image is selected. It reinstates
the reported bug in the state where the user is most likely to be clicking
creases — right after placing the image.

## The cursor over an image

`cursor: move` on the body is a promise that a drag here moves the object, so it
has to answer the same question the press does. It did not: after the press
routing landed, the body still read `move` while hovering directly over a crease,
which is the one thing a press there would *not* do.

The body now probes the surface on hover, for `paintedBehindCreases` objects
only, and shows the canvas' own cursor where the press would go to the canvas
instead. Two things keep that affordable and stable:

- **Coalesced to one probe per animation frame.** The probe is a hit test and a
  high-rate pointer reports several times per frame; the numbers in Performance
  are per frame, not per sample.
- **React state, not an imperative `style.cursor` write.** The overlay
  re-renders on every camera frame and re-applies the polygon's inline style, so
  a direct write is silently reverted the next time the view moves. The state
  only changes when the answer flips — crossing onto or off a crease — so the
  extra renders are a handful per second at most.

The canvas' cursor is mirrored rather than guessed: it is the layer that would
take the press, it already resolves this correctly (`grab` while a pan modifier
is held, nothing in plain select mode), and reading its inline style is a
property read rather than a layout one.

No hover *preview* is forwarded, and none is missing. Every hover branch in the
canvas' `onPointerMove` requires a non-null `activeToolInputMode`, and in every
mode where the overlay is interactive that mode is null: either no tool is
active, or the tool is `CreaseSelect`, whose `line-click-mutate` input model has
no engine and resolves to idle. Whenever a tool *does* hover,
`annotationsInteractive` is already false and the polygon is already
`pointer-events: none`, so hover already passes through.

## Testing

There is no e2e harness for this app (the only Playwright config in the tree
belongs to vendored Box Pleating Studio), so everything below is vitest + jsdom
plus one scripted browser check. Organised by the way this can break, because a
test that does not map to a failure mode is not protecting anything.

### F1 — the overlay stops asking

The likeliest regression: someone edits `handleBodyDown` and the registry check
goes away, or moves below `claimSurfacePress`. Extend
`CanvasObjectOverlay.test.tsx`, which already renders the real component against
a stub camera and a real `cpSurfaceGestures`. With a stub press handle:

- `paintedBehindCreases` object, surface **claims** → `onSelect` not called,
  no pointer capture taken, **no contact reported to `cpSurfaceGestures`**, and
  `press` called exactly once with the native event.
- Same object, surface **declines** → selects and starts the move drag, byte for
  byte as today.
- Object **without** the flag → `claimsPress` never called at all. This is the
  guard that text boxes, folded figures and inline simulations are untouched.
- Resize/rotate handles take their press even while the surface claims.
- `onContextMenu` and `onDoubleClick` follow the same rule as the body press.

The arbiter assertion is the subtle one and deserves its own case: a decline path
that still reported a contact would leave the arbiter believing a finger is down,
which is the failure `contactRef` already exists to prevent — every later single
touch looks like the second finger of a pinch and the canvas stops drawing.

### F2 — the canvas stops registering

`CreasePatternWebglCanvas.tsx` has **no test file today**, and this is exactly the
class of gap where deleting one wiring line leaves every other test green. Add
`CreasePatternWebglCanvas.press.test.tsx`: mock `regl` the way
`reglRendererLayerOrder.test.ts` already does, stub `ResizeObserver` (the only
jsdom-hostile API at mount — [line 1778](../apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1778);
`devicePixelRatio` already falls back to 1), mount with a couple of
`lineSegments`, and assert:

- `cpSurfacePress()` is non-null after mount and null after unmount.
- `claimsPress` is **true** at a point on a supplied crease and **false** in
  empty space.

That second assertion is doing double duty — it is also the guard for F5.

### F3 — a kind gets the wrong flag

Unit-test the three adapters in `transformableObject.test.ts`: image → `true`,
text → `false`, folded figure → `false`, inline simulation → `false`. Cheap, and
it is what a *new* canvas-object kind trips over, since the field is required and
`tsc` will refuse a kind that omits it.

### F4 — paint order changes under the rule

The whole premise is "pick order follows paint order". Pin the premise: extend
`reglRendererLayerOrder.test.ts` to assert `images` draws before `creases`. That
file already logs draw order and already pins the folded band; the image layer is
the one band it does not currently assert, which is how this could silently
invert.

### F5 — the two radii drift apart

The nastiest possible bug here, and the one no obvious test catches: if
`claimsPress` computed its own tolerance instead of reusing `hitTest`'s, a ring
would open around every crease where the surface declines but the canvas would
not have picked anything either — clicks inside an image that do nothing at all.

Guard it **by construction**: `claimsPress` must call the same `hitTest` closure
`onPointerDown` calls, never a reimplementation, and `surfaceClaimsPress` must
take the resulting `CpSelectHit | null` rather than coordinates and a radius.
Then F2's "true on a crease, false in empty space" assertion exercises the real
radius end to end.

### F6 — pure-rule drift

`surfaceClaimsPress.test.ts`: the truth table — right button, middle button,
`Meta`, hand tool, each hit kind, and empty space (the only input that returns
false). Low regression value on its own, high value as documentation of the rule.

### Manual browser check

Re-run the A/B from "Measured" — same crease, one press inside the image box and
one outside, asserting `elementsFromPoint`, whether the canvas listener fired,
and what ended up selected. Then, over a dense pattern, by hand: erase, pan,
marquee, drag-move from a gap, resize, rotate — on mouse **and on touch**, since
the capture hand-over is the part jsdom cannot exercise.

### Not covered, and worth knowing

Panel wiring — that the panel keeps passing the flagged objects through — has no
test and is not worth building a harness for. Mitigate by keeping the panel's
share of this to prop pass-through, with all behaviour in the modules above.

## Checklist

- [x] Pin the image layer below the creases in `reglRendererLayerOrder.test.ts`
      (the one band it did not previously assert), so property 1 cannot regress.
- [x] Add `yieldsPressToCreases` to `TransformableCanvasObject` and set it in all
      three adapters. (Shipped as `paintedBehindCreases` and renamed when text
      joined: that name was the *reason* for one kind rather than the rule, and
      is a plain lie on text, which is painted above the creases.)
- [x] Extend it to text boxes. Not for the image's reason — a text box's bounds
      are simply far larger than its ink, so most of the box is pattern the user
      is looking straight at.
- [x] Add `surfaceClaimsPress` taking a `CpSelectHit | null` (never coordinates
      and a radius — see F5), with the F6 truth-table test.
- [x] Add `cpSurfacePressRegistry`; register from the canvas beside the camera.
      `claimsPress` calls the same `hitTest` closure `onPointerDown` uses.
- [x] Decline + hand over in `handleBodyDown`, with the F1 cases in
      `CanvasObjectOverlay.test.tsx`.
- [x] Extend the same rule to `onContextMenu` and `onDoubleClick`.
- [x] Add `CreasePatternWebglCanvas.press.test.tsx` for F2 — registered on
      mount, cleared on unmount, `claimsPress` true on a crease and false in
      empty space.
- [x] Document what `claimsPress` costs in the registry's module doc, and the
      rule that follows: one call per press or per frame, never per sample.
- [x] Make the body cursor answer the same question as the press — probed on
      hover, coalesced to one hit test per frame.
- [x] Give the canvas a `pointer` cursor over anything selectable, ranked below
      every pan and orbit affordance.
- [x] Have the overlay **ask** the canvas for that cursor rather than mirror
      `canvas.style.cursor`. Mirroring is circular — the canvas only resolves
      that style while it is receiving the hover, and it never receives one over
      an image, because this overlay is intercepting exactly those events.
- [x] Validate: `npm run lint:web`, `npm run typecheck:web`, `npm run i18n:check`
      and the full web suite (5003 tests). Every seam mutation-checked: cutting
      the canvas registration fails all four F2 cases; stubbing its hit test
      fails exactly the two asserting on crease proximity; making the overlay
      never consult the surface fails four F1 cases; restoring the stale cursor
      mirror fails four more.
- [x] Browser-verified by the author, who found two defects this pass had missed:
      the hover cursor never appeared at all, and then appeared everywhere except
      over an image. Both are fixed and both now have tests that fail against the
      shipped bug.

      Worth recording how they were found, because three rounds of re-reading the
      code found nothing — every link was individually correct. What located them
      was reading runtime values out of the React fiber in a real browser
      (`activeToolInputMode` was `'drag-box'`, not `null`; `rafScheduled` was 0).
      The agent could not reproduce either: the in-app browser pane had no
      viewport and suspends `requestAnimationFrame`, which the probe depends on.

## Notes for whoever picks this up

- Regression risk concentrates on **touch**, not mouse: the hand-over relies on
  `canvas.setPointerCapture` overriding the implicit capture the browser gives
  the polygon on a touch/pen `pointerdown`. Verify a pinch anchored with one
  finger on an image, which is exactly the case `cpSurfaceGestures`' contact
  bookkeeping exists for.
- The touch arbiter must see **one** `down` per press. The decline path returns
  before `claimSurfacePress`, so the contact is reported by the canvas with
  origin `'canvas'` and never by the overlay — do not move the registry check
  below the claim.
- Panel wiring is the untested seam here (`App.tsx` wiring has no coverage), so
  keep the panel's part of this to prop pass-through and put the behaviour in the
  modules above.
- One behavioural consequence to be deliberate about: a marquee can no longer be
  *started* on empty space inside an image box — that press moves the image, and
  it has to, or an image over a sparse pattern could not be moved at all. Start
  the marquee outside the image and drag in. Call it out in the PR rather than
  letting it be discovered.
- **The canvas has no "no tool armed" state.** It rests with Box Select armed, so
  `activeToolInputMode` is `'drag-box'` and gating anything on `=== null` is dead
  code — that is exactly how the hover cursor shipped doing nothing. What the
  region-select family shares is the click action `'select'`. A canvas test
  fixture that says `null` describes a state the product is never in.

## Shipped as

[PR #321](https://github.com/zacharyfmarion/ori-studio/pull/321).
