# BP stretch selection shades the gadget, not the flaps

## Goal

Selecting a stretch in the BP editor should mark the stretch itself — the
interior of its gadget parallelogram — instead of washing the two flaps it
stretches between.

Today `bpLinkedSelection` expands a stretch into the flaps and rivers it spans,
so selecting a stretch (or one of its devices) lights up both flaps' shades,
outlines and creases. Those flaps are often the two largest on the sheet, so the
wash covers most of the paper and says nothing about the small region the
selection is actually about.

## Approach

This is upstream's own division of labour, so the fix is parity rather than
invention:

- `client/project/components/layout/device.ts` — `_drawShade` fills the device's
  contour at `style.shade.alpha` when **the device or its stretch** is selected,
  and `style.shade.hover` when hovered. It is the same `Graphics` the device
  hit-tests on (`$setupHit(this._shade)`).
- `client/project/components/layout/flap.ts` and `river.ts` — both shade **only
  for themselves**. Neither reacts to a stretch.
- `client/project/components/layout/stretch.ts` — a `Stretch` "does not have its
  own graphics rendering"; its devices are what the user sees.

So:

1. `bpLinkedSelection`'s `addStretch` links the stretch's **devices** and nothing
   else. `addDevice` still links its stretch, which is how a device selection
   reaches its siblings.
2. The device contour's existing hit polygon becomes its shade, filled on hover
   and on selection at the alphas the flap shade and river band already use (9% /
   18% of the accent). One element for both jobs, as upstream has it.

`OristudioBpStretch.riverIds` is always empty out of the snapshot mapper, so the
river half of the old expansion was already dead.

What this deliberately drops: a stretch selection no longer highlights the two
leaves in the tree pane either (`useBpTreeEditorHost` reads the same linked
selection). Upstream has no such link, and the stretch navigator already names
the flaps ("Stretch E and F").

### The primitive renderer moves out

Step 2 needs the selection-shade layer flag inside the panel's `Primitive`
component, and those four lines tripped `max-lines` on `BpPackingPanel`. The
answer is not to shave four lines off the change — it is that the primitive
renderer was never panel work.

Everything about one engine graphic is one concern: the SVG each kind draws, the
id grammar that says which flap, river or device owns it (`f5:ridge:0`,
`re0,2:contour:0`, `s24,26.0:contour:0`), its label, its select token, and the
three predicates that decide whether the selection covers it. That is now
`components/panels/BpPackingPrimitive.tsx` — the same shape as its neighbour
`BpPackingRiverBandLayer`, and still under the panel cap itself. The panel
imports the component plus the four id helpers its own pointer handlers need; it
no longer knows the grammar.

The panel's counted lines go 2055 → 1851, so the `OVERSIZED_PANELS` entry goes
**down**.

## Affected Areas

- `apps/web/src/lib/oristudioBpSelection.ts`
- `apps/web/src/components/panels/BpPackingPrimitive.tsx` (new)
- `apps/web/src/components/panels/BpPackingPanel.tsx`
- `apps/web/src/styles/theme.css`
- `apps/web/eslint.config.js`
- `apps/web/src/lib/oristudioBpSelection.test.ts`
- `apps/web/src/components/panels/BpPackingPanel.test.tsx`

## Checklist

- [x] `addStretch` links devices only
- [x] Device contour shades on hover and selection
- [x] Selection-shade layer toggle gates the selected wash, not the hover one
- [x] Primitive renderer extracted to `BpPackingPrimitive`; panel cap lowered
- [x] Unit test: a stretch selection links devices, not flaps
- [x] Panel test: selecting a device shades its gadget and leaves the flaps unshaded
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`, `i18n:check`
- [x] Browser check on the Micrathena sample (idle / hover / selected, and the
      patternless stretch, which has no devices and still reveals its gap rects)
