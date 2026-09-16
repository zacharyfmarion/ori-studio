# Cmd+drag always pans the crease pattern

## Goal

A Meta-modified drag (and every other gesture that pans — the middle button and
the hand tool) must pan the crease pattern **wherever it starts**, including on
top of a canvas object. Today it only pans over the objects you can see the
pattern through; on everything else the press still selects, moves, resizes,
rotates or orbits.

Upstream makes pan unclaimable by design (`Canvas.java`'s handler `Feature` enum
has no BUTTON_2, so every tool declines it), and the canvas' own cursor already
promises this: `cpCanvasCursor` ranks `panModifierHeld` above the folded-figure
orbit and above a crease hover. The press pipeline does not agree with it, so
the cursor says `grab` in places where the drag does something else.

Where the gesture is wrong today, all in the CP viewport:

| Surface | Meta+drag does | Should do |
| --- | --- | --- |
| Reference image / text / suppression-region body | pans | pans (already right) |
| Folded-figure and inline-simulation body | **moves the object** | pans |
| Resize handle (any object) | **resizes** | pans |
| Rotate handle (any object) | **rotates** | pans |
| Focused 3D folded figure, on the canvas | **orbits** | pans |
| Suppression-region chip bar | **moves the region** | pans |

The middle button and the hand tool are wrong in the same places for the same
reason, and are fixed by the same change.

Out of scope: the interior of a *focused* inline simulation window, which owns
its pointer the way an open text editor owns its keystrokes.

## Approach

The rule already exists as a pure function — `surfaceClaimsPress` — but it
answers one boolean for two different questions ("is this a pan?" and "is a
crease under here?"), and only the bodies that yield to creases ever ask it.
Every other layer either short-circuits before the question or never asks.

1. **Split the verdict.** Rename `picking/surfaceClaimsPress.ts` to
   `picking/surfacePressClaim.ts` and return
   `CpSurfaceClaim = 'pan' | 'crease' | null` instead of a boolean. `'pan'` is
   the press no layer may claim; `'crease'` is the press only a body you can see
   the pattern through yields. The hit test becomes a thunk, so the pan verdict
   — which never reads it — stops paying for it.
2. **One question, asked by every layer.** `CpSurfacePressHandle.claimsPress`
   becomes `pressClaim` and returns that verdict. The canvas-object overlay's
   body handler yields on `'pan'` whatever the object is, and on `'crease'` only
   when the object yields; the resize and rotate handlers yield on `'pan'` and
   keep everything else, since handles are chrome that outranks the creases
   under them. The region chip asks the same handle, which is the only channel
   it has — it is portalled out of the viewport entirely.
3. **Fix the canvas' own precedence.** Move the `metaKey || panToolActive`
   branch of `onPointerDown` above the folded-figure orbit branch, so the press
   order matches the cursor order that already ships.
4. **Say so in the cursor.** The overlay shows `grab` on bodies and handles
   while a pan press is armed, from `usePanModifierHeld()` plus a new
   cursor-only `panToolActive` prop — no hit test, and nothing that can change
   where a press is routed.

## Affected Areas

- `apps/web/src/cp-workspace/picking/surfacePressClaim.ts` (renamed from
  `surfaceClaimsPress.ts`) and its test
- `apps/web/src/cp-workspace/picking/cpSurfacePressRegistry.ts`
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — the registration
  and the `onPointerDown` branch order
- `apps/web/src/cp-workspace/CanvasObjectOverlay.tsx` — body, resize and rotate
  handlers, and the body/handle cursors
- `apps/web/src/cp-workspace/regions/useCpRegionChipDrag.ts`
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — passes
  `panToolActive` to the overlay
- Tests: `surfacePressClaim.test.ts`, `CanvasObjectOverlay.test.tsx`,
  `CreasePatternWebglCanvas.press.test.tsx`, a new
  `useCpRegionChipDrag.test.tsx`

## Checklist

- [x] Reproduce in the browser and establish which surfaces are actually wrong
- [x] Split the verdict in the pure rule module and rename it
- [x] Route `'pan'` through the registry handle
- [x] Overlay: bodies of every object kind yield a pan press
- [x] Overlay: resize and rotate handles yield a pan press
- [x] Canvas: pan outranks the folded-figure orbit
- [x] Region chip: a pan press goes to the surface
- [x] Cursor says `grab` on bodies and handles while a pan press is armed
- [x] Unit tests for each surface above
- [x] `npm run lint:web`, `typecheck:web`, `test:web`
- [x] Browser verification: image and text bodies, resize and rotate handles,
      the middle button on a handle (which used to do nothing), and the cursor
      flipping to `grab` on Meta down and back on Meta up
- [ ] Browser verification of a folded figure and an inline simulation — not
      done. Neither `Fold (G)` nor the folded-models panel produced a figure on
      the fixtures tried, so the opaque-body row rests on its unit test plus the
      handle rows, which take the same `'pan'` branch through the same registry.
- [x] Draft PR
