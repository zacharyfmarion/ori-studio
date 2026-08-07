# CP editor navigation: Figma-parity pan and zoom

## Goal

Give the **crease pattern editor canvas** Figma's navigation model: scroll and
two-finger drag **pan**, Cmd/Ctrl+scroll and pinch **zoom**, drag-pans show a
grab cursor. Make the pinch noticeably faster than it is today. A setting
restores the current behaviour, where any wheel or two-finger drag zooms.

Scope is [CreasePatternWebglCanvas.tsx](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx)
and the overlay that forwards wheels into it. The tree editor, BP packing pane,
and Design pane already pan on two-finger drag and are **out of scope**; so is
the simulator, whose camera has no translation term to pan.

## Approach

### What is wrong today

The canvas has one wheel handler
([CreasePatternWebglCanvas.tsx:2876](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:2876))
that zooms on every event with no modifier check:

```ts
zoomUserCameraAt(cam, viewportOf(ratio), cx, cy, Math.pow(1.0015, -e.deltaY));
```

Two consequences, and the second is the reason the pinch feels dead:

- Two-finger drag zooms, because a trackpad scroll is an ordinary `wheel` event.
- A pinch takes the **same curve as a mouse wheel**. A mouse notch is
  `deltaY ≈ 100` → `1.0015^100 ≈ 1.16`, a sensible 16% per notch. A pinch step
  is `deltaY ≈ 2–4` → `1.0015^3 ≈ 1.0045`, **0.45% per event**. The canvas has
  never had a pinch path; the gesture has been running on the wheel constant.

That per-notch 16% is close to upstream Oriedita, whose `getScaleForZoomBy` uses
`zoomBase = 1 + zoomSpeed/10` — ×1.1 per notch at the default speed
([CameraModel.java:49](third_party/oriedita/oriedita-data/src/main/java/oriedita/editor/databinding/CameraModel.java:49)).
So the wheel curve is right and should not move; only the pinch needs its own.

Separately, the grab cursor is wired to the hand tool **only**
([CreasePatternWebglCanvas.tsx:3213](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3213)):
`style={panToolActive ? { cursor: panDragging ? 'grabbing' : 'grab' } : undefined}`.
Middle-button pan and Cmd+drag pan already work but show no cursor feedback at
all.

### Target model

| Input | `pan` (new default) | `zoom` (classic) |
| --- | --- | --- |
| Scroll wheel / two-finger drag | Pan by (`deltaX`, `deltaY`) | Zoom at pointer |
| Shift+scroll | Pan horizontally | Zoom at pointer |
| Cmd/Ctrl+scroll | Zoom at pointer | Zoom at pointer |
| Pinch (browser reports it as ctrl+wheel) | Zoom at pointer, fast curve | Zoom at pointer, fast curve |
| Middle-button drag | Pan — exists, gains a cursor | unchanged |
| Cmd+drag | Pan — exists, gains a cursor | unchanged |
| Hand tool drag | Pan — unchanged | unchanged |

No space+drag pan: `Space` is already bound to a tool in this editor, and Figma
parity does not justify taking a key that is doing real work. The hand tool,
middle button, and Cmd+drag are the drag-pan affordances.

Pinch and the accel key zoom in **both** modes, so the setting only changes what
an unmodified scroll does.

Two modifier asymmetries that are deliberate and should not be "fixed" later:

- The **wheel zoom** modifier is Cmd *or* Ctrl (the platform accel, matching
  Figma and the browser's own zoom).
- The **drag pan** modifier stays `metaKey` only. That is upstream's rule
  verbatim (`Canvas.java:267` maps `isMetaDown()` to BUTTON2), and Ctrl+drag is
  already taken by crease-colour inversion (`useCpLineColorInversion`), which
  upstream binds on every platform.

Ctrl+*wheel* and Ctrl+*drag* are different gestures, so they do not collide.

### Mouse wheel — why it is affected too

`WheelEvent` has `deltaX/Y/Z` and `deltaMode`, and nothing identifying the
device. A two-finger trackpad scroll and a mouse wheel notch arrive as the same
event shape, so "plain scroll pans" necessarily applies to the mouse wheel too.
This is what Figma does, and the mitigations are the same ones Figma relies on:
Cmd/Ctrl+scroll zooms, and here the setting reverts wholesale.

Device-guessing heuristics are explicitly **out of scope**. Delta magnitude
fails on free-spinning/high-resolution mice, which emit small fractional deltas
like a trackpad; `deltaX` presence fails on tilt-wheel mice; the
`wheelDelta === -3 × deltaY` trick is non-standard, Chrome-only, and already
inconsistent across Windows precision-touchpad drivers. Each fails on a real
device class, and the failure mode is a viewport that behaves differently
depending on which mouse is plugged in.

### Where the wheel logic goes

The canvas is a large imperative component with no unit tests, so the decision
belongs in a pure module: `apps/web/src/lib/wheelGesture.ts` (in `src/lib/`
because it has no CP-workspace dependency).

```ts
export type WheelGesturePreference = 'pan' | 'zoom';

export type WheelGesture =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number };

export function resolveWheelGesture(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  preference: WheelGesturePreference
): WheelGesture;
```

It owns three things:

1. **`deltaMode` normalisation.** Firefox reports `DOM_DELTA_LINE`, and the
   current handler treats the number as pixels — so a Firefox notch is ~16× too
   small. Normalise line → 16px, page → 800px. (Pre-existing bug, fixed here
   because the module is its natural home.)
2. **Modifier routing**, per the table above — including shift+scroll mapping
   `deltaY` onto `dx` so a wheel-only mouse can pan horizontally.
3. **The zoom curve**, `factor = exp(-normalizedDeltaY * sensitivity)`, with the
   normalised delta clamped so one coarse event cannot jump several octaves.

Anchoring stays at the call site — the canvas already has `zoomUserCameraAt`.

Two sensitivities, because the two input streams have different delta scales:

| Constant | Applies to | Now | Proposed |
| --- | --- | --- | --- |
| `WHEEL_ZOOM_SENSITIVITY` | plain scroll in `zoom` mode, and Cmd/Ctrl+scroll | `ln(1.0015) ≈ 0.0015` | unchanged |
| `PINCH_ZOOM_SENSITIVITY` | pinch (ctrl+wheel from the gesture, not the key) | — (ran on the wheel constant) | **`0.022`** |

`0.022` is 2× the `0.011` the tree and BP panes have used for pinch since they
got a dedicated handler, and ~15× the effective rate on this canvas today. It is
a feel judgement, not a measured one — budget one tuning pass, cheap now that it
is a single exported constant.

One wrinkle, and the clamp is what resolves it: a browser-synthesised pinch and
a real Ctrl+scroll are the *same event* on Windows, so they cannot take
different sensitivities there. Setting `MAX_ZOOM_EXPONENT` to
`WHEEL_ZOOM_SENSITIVITY * 100` — one mouse notch — makes the collision
harmless rather than merely tolerable: a coarse Ctrl+scroll saturates the clamp
and lands on x1.16, the per-notch step the canvas has always had, while a
fine-grained pinch (single-digit deltas) stays well under it and keeps the fast
curve. No device sniffing, and no need for the two constants to be close.

### Cursor rules

A pure helper beside the canvas — `cp-workspace/cpCanvasCursor.ts`, unit-tested —
maps state to a cursor, so the JSX stops carrying the logic inline:

| State | Cursor |
| --- | --- |
| Any pan drag in progress (hand tool, middle button, Cmd+drag) | `grabbing` |
| Hand tool active, not dragging | `grab` |
| Pan modifier held, hovering the canvas | `grab` |
| Scroll/two-finger pan | unchanged — Figma does not change the cursor for wheel pans |
| Otherwise | the tool's own cursor / default |

Implementation notes:

- Broaden the existing `panDragging` state so it is set wherever `panning = true`
  is set, not just for the hand tool. The release path at
  [CreasePatternWebglCanvas.tsx:2865](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:2865)
  already clears every gesture flag in one place and needs no change.
- That means one React re-render at pan-gesture start and one at end, for
  middle-button and Cmd+drag as well as the hand tool. **Verify against the
  known footgun**: a state update on pointerdown that reflows the pane mid-
  gesture silently drops the gesture (the signature is a `mousedown` target that
  differs from the `pointerdown` target, and no `click`). The hand tool already
  does exactly this and is fine, so the shape is proven — but confirm a
  middle-click press-release does not disturb an in-flight tool.
- The held-modifier `grab` should subscribe through `keyboard/heldModifiers.ts`
  and derive a boolean, the way `useCpLineColorInversion` already does, so a
  modifier press does not re-render the canvas unless the answer changed.
- The Cmd-held affordance is macOS-meaningful only, since the drag pan modifier
  is `metaKey`. That is correct, not an oversight.

### The setting

- `settingsStore`: `cpWheelGesture: WheelGesturePreference`, default `'pan'`,
  with `setCpWheelGesture`.
- Persisted via `lib/storage.ts` — add `cpWheelGesture: 'cp-wheel-gesture'` to
  `STORAGE_KEYS`, read through a small `readString`-backed parser that falls
  back to `'pan'` on anything unrecognised.
- Settings → **Workspace** tab, new "Crease pattern canvas" section above
  "Layout". Two radios rather than a checkbox, because it names two behaviours:
  - *Scroll pans, pinch zooms* (default)
  - *Scroll zooms* (classic)

  plus a one-line hint that pinch and Cmd/Ctrl+scroll zoom either way.

`classic` must be **exactly** today's behaviour: plain scroll zooms on the
unchanged wheel curve. The cursor work and the drag-pan affordances apply in
both modes — they are fixes, not part of the preference.

The canvas reads the preference through the existing `liveRef` pattern it uses
for live props, so changing it takes effect without remounting the canvas or
tearing down the WebGL context.

### Upstream divergence, stated

Oriedita's canvas wheel zooms
([Canvas.java:534](third_party/oriedita/oriedita-ui/src/main/java/oriedita/editor/Canvas.java:534)),
so `pan` as the default is a **deliberate divergence** from upstream, not a
port. The `zoom` setting is the parity mode. Worth noting in the PR that
upstream also scopes its wheel preference to this canvas alone
(`ApplicationModel.mouseWheelMovesCreasePattern`) and exposes zoom speed as a
user preference (`zoomSpeed`), so both a canvas-scoped toggle and a tunable
speed have precedent.

### Canvas changes

**The wheel handler.** Replace the unconditional zoom with a
`resolveWheelGesture` dispatch: `zoom` → the existing `zoomUserCameraAt(...)`;
`pan` → `panUserCamera(cam, -dx * ratio, -dy * ratio)`.

Two things to get right, both verified in the browser:

- **Sign.** `panUserCamera` takes a *drag* delta and subtracts it from the centre
  ([camera.ts:194](apps/web/src/cp-workspace/renderer/camera.ts:194)), so the
  scroll delta must be negated for content to follow the fingers. Check both
  axes.
- **Rotation.** The camera supports rotation and `panUserCamera` goes through
  `deviceDeltaToUser`, so the pan follows the rotated axes. Verify at a non-zero
  rotation that a vertical two-finger drag still moves the paper vertically on
  screen.

**`CanvasObjectOverlay`** — a latent bug this change would expose. The wheel it
re-dispatches to the sibling canvas
([CanvasObjectOverlay.tsx:341](apps/web/src/cp-workspace/CanvasObjectOverlay.tsx:341))
copies `deltaX/deltaY/deltaMode/clientX/clientY` but **not the modifiers**, so a
pinch or Cmd+scroll over a folded figure or reference image would arrive
stripped and pan instead of zoom. Forward `ctrlKey`, `metaKey`, and `shiftKey`.

## Affected Areas

- `apps/web/src/lib/wheelGesture.ts` (new) + test
- `apps/web/src/cp-workspace/cpCanvasCursor.ts` (new) + test
- `apps/web/src/lib/storage.ts` — one `STORAGE_KEYS` entry
- `apps/web/src/store/settingsStore.ts` — preference + setter
- `apps/web/src/components/SettingsModal.tsx` — new section on the Workspace tab
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — wheel dispatch,
  broadened `panDragging`, cursor
- `apps/web/src/cp-workspace/CanvasObjectOverlay.tsx` — forward modifiers
- `apps/web/public/locales/*/dialogs.json` — 8 locales + generated `en`

## Open decisions

- **Analytics.** The other Workspace-tab toggles are not individually
  instrumented, and this is a preference rather than a feature.
  Recommendation: **no new event**. Revisit only to measure how many users
  revert to classic.
- **Pinch sensitivity `0.022`.** A feel call. If one tuning pass does not settle
  it, upstream's `zoomSpeed` precedent suggests promoting it to a slider rather
  than arguing about a constant.

## Checklist

- [x] `lib/wheelGesture.ts`: `resolveWheelGesture`, both sensitivity constants,
      `deltaMode` normalisation, delta clamping, shift→horizontal mapping
- [x] `wheelGesture.test.ts`: modifier routing under both preferences,
      line/page `deltaMode` normalisation, shift+scroll pans horizontally,
      factor monotonic in `deltaY` and clamped, zero delta is a no-op
- [x] `cp-workspace/cpCanvasCursor.ts` + test covering every row of the cursor
      table
- [x] `STORAGE_KEYS.cpWheelGesture` + parser with `'pan'` fallback
- [x] `settingsStore` preference, setter, persistence; extend
      `settingsStore.test.ts`
- [x] Settings → Workspace "Crease pattern canvas" radios, inline English
      defaults
- [x] `SettingsModal.test.tsx`: radios reflect and update the store
- [x] Canvas wheel dispatch through the resolver, preference read via `liveRef`
- [x] `panDragging` set for every pan trigger; cursor driven by the helper
- [x] `CanvasObjectOverlay` forwards `ctrlKey`/`metaKey`/`shiftKey`; extend
      `CanvasObjectOverlay.test.tsx`
- [x] `npm run i18n:extract`, translate 8 locales, `npm run i18n:stamp`,
      `npm run i18n:check`
- [x] `npx tsc --noEmit` (from `apps/web`) and `npx vitest run` — the npm
      typecheck script regenerates the tracked wasm bindings, which this branch
      must not touch

Verified in the running app by driving synthetic events against the live canvas
and reading the camera back out of `cpOverlayViewStore`:

- [x] Scroll pans 1:1 — a 150px scroll moves the camera exactly 150px, right
      sign, right axis; `deltaX` pans horizontally; shift+scroll maps vertical
      onto horizontal
- [x] Plain scroll does not zoom in `pan` mode (scale ratio exactly 1.0)
- [x] Cmd+scroll zooms x1.16 per notch; a single pinch step (`deltaY` 4) is now
      worth ~9.6%, against 0.6% before
- [x] Classic mode reproduces the historical curve bit-for-bit (x1.1617 for
      `deltaY` -100, i.e. `1.0015^100`)
- [x] Preference persists to `oristudio:cp-wheel-gesture`
- [x] Cursor: `grabbing` for middle-button and Cmd+drag, `grab` while Cmd is
      held with no press, and back to none on release/keyup — no latching
- [x] Settings section renders and the radios drive the store; no console errors

Left for a real trackpad (Zach):

- [ ] Pinch *feel* at `0.022` on hardware — the one number that synthetic events
      cannot judge
- [ ] Two-finger drag under a rotated camera (the pan follows the rotated axes
      via `deviceDeltaToUser`; unit maths says it is right, worth one look)
- [ ] Pinch and Cmd+scroll over a folded figure / reference image, through the
      overlay's forwarding path
- [ ] A middle-click press-release does not disturb an in-flight tool
