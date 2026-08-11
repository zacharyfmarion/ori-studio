# BP Flap Hover and Selection Shade

## Goal

Give a flap in the BP packing pane the same hover and selection treatment a
river already has: nothing until the pointer is over it, a light accent wash
while hovered, a stronger wash once selected, and an accent-recoloured outline
that says "this one is selected" without changing the flap's shape.

Today a flap has no hover state at all, and selecting one swaps its paper fill
for an opaque accent fill *and* thickens its outline from 2.2 to 3 — so a
selected flap reads as a different, slightly larger object rather than the same
flap, highlighted. That is the "weird" part, and it is also a deviation from
upstream.

## Approach

Box Pleating Studio settles what the treatment should be, because a flap and a
river are the same mechanism there. Both build a `_shade` Graphics on
`Layer.shade`, fill it from the node's contours, make it the hit target
(`$setupHit(this._shade)`), and set only its alpha — `style.shade.alpha` (0.3)
when selected, `style.shade.hover` (0.15) when hovered, 0 otherwise
(`client/project/components/layout/flap.ts`, `river.ts`). Neither one's outline
gains width when selected; upstream never touches `style.hinge.width` for state.

Our river port already mirrors that: `BpPackingRiverBandLayer` draws the band as
both the shade and the hit region, and CSS moves its fill between transparent,
9% accent (hovered) and 18% accent (selected). The selected river's contour also
recolours to the accent with a glow, via `.bp-packing-primitive--selected`.

So the flap change is to reuse the parts that already exist rather than invent a
second scheme:

- The flap's invisible click target (`.bp-packing-flap-hit`) is already the
  right region — the flap's footprint grown by its radius, which is what
  upstream fills for the shade — and it is already one element per flap, on top
  of the stack. Make *it* the shade, matching upstream where the shade and the
  hit are one object, and rename it to `.bp-packing-flap-shade` so the name
  stops claiming it is invisible.
- Hover is CSS on that element, for the reason the river layer gives: a React
  hover state would re-render the pane on every pointer move.
- Drop the separate `.bp-packing-selection-shade` rect. Its 18% wash is now the
  shade's selected state; keeping both would double to ~33%.
- Reduce `.bp-packing-flap--selected` to what a selected river's contour does —
  accent stroke plus the same glow — and drop the fill swap and the width jump.
- Clip the shade group to the sheet. The wash it replaces was clipped (it was
  inside the flap's clipped group), the click target was not, and upstream
  clips `Layer.shade`; leaving it unclipped would start leaking the wash past
  the paper edge. `outsidePaper` lifts the crop as it does everywhere else.

The one deliberate simplification: the shade is the flap's footprint rounded
rect rather than the engine's contour rings. For a box-pleat flap those are the
same shape, which is why the click target was already built from it; a flap
whose contour is trimmed by a stretch pattern gets a wash a little wider than
its paper. Mirroring the river layer exactly (a coverage-contour band per flap)
is the follow-up if that ever shows.

## Affected Areas

- `apps/web/src/components/panels/BpPackingPanel.tsx` — the flap shade group
  and the removed per-flap selection-shade rect.
- `apps/web/src/styles/theme.css` — flap shade hover/selected fills, the
  reduced selected-flap outline, the deleted `.bp-packing-selection-shade`, and
  one canonical comment for the shade alphas that the river band now points at.
- `apps/web/src/components/panels/BpPackingPanel.test.tsx` — class renames plus
  coverage for the new states.

## Checklist

- [x] Read the upstream flap and river controls and the shade style
- [x] Write the plan
- [x] Make the flap's hit target its shade, with hover and selected fills
- [x] Reduce the selected-flap outline to the accent recolour a river gets
- [x] Remove the separate selection-shade rect
- [x] Clip the shade group to the sheet, honouring `outsidePaper`
- [x] Update and extend the panel tests
- [x] Validate: web lint, typecheck, unit tests
- [x] Open a draft PR against `main`
