# BP Conflict: Make a Hairline Overlap Visible Again

## Goal

A flap overlap that is only a hair too close — the common case, since it is
what one grid step of error produces — must show the same red indicator in the
packing pane that Box Pleating Studio shows. Today the engine reports it, the
pane paints it, and nothing reaches the eye: the region is drawn thinner than
the flap outlines painted on top of it.

Reference file: `tests/fixtures/bp-studio/stretched-flap-hairline-overlap.bps`
(flap 6 at (5,5) r=4 against the left end of stretched flap 5 at (13,9) r=5:
√80 ≈ 8.944 apart on a tree distance of 9, an overlap of 0.056 units).

## Root cause

The kernel is faithful: `create_junction` yields an `InvalidJunction` and its
two-arc lens polygon is byte-identical to upstream's. The loss is in the pane,
where four same-day commits from 2026-07-22 (`9c4ff55b2`, `d152640cc`,
`2f34f1676`, `158d4782f`) walked the conflict drawing away from
`client/project/components/layout/junction.ts` to answer a report that "the
conflict sits outside the flap":

1. The layer paints **under** the flap group. A lens's two boundary arcs *are*
   the two flaps' outlines, so `.bp-packing-flap-clearance` sits exactly on the
   region and eats it from both sides.
2. Upstream widens a narrow lens by `min(2 / narrowness, oneCellPx)` — for this
   file an ~18 px bar. Ours was replaced by a 2.5 px floor
   (`MIN_CONFLICT_VISIBLE_PX`), clipped to the flaps' union, so it can never
   grow past the outlines covering it.
3. `vector-effect: non-scaling-stroke` does not hold on this canvas. The camera
   is a CSS `transform: scale()` on the react-zoom-pan-pinch wrapper *outside*
   the `<svg>`, and the property only counters transforms inside the outermost
   SVG (measured: a 1 px non-scaling line under `scale(4)` hit-tests 4 px wide).
   Every "screen px" width in the pane is really SVG units × zoom, so the floor
   is ~1.2 px at the fit zoom and the outlines grow with the lens — zooming in
   never separates them (visible red ≈ 0.48 SVG units × zoom at 55% alpha).
4. The only textual cue says the opposite: the Diagnostics entry reads
   "overlap by 0" because the mapper labels the engine's river gap
   (`d − r_a − r_b`) as the overlap.

## Approach

Return to upstream's junction drawing, one deviation per commit so any one can
be reverted alone if testing disagrees (see `upstream-parity-over-our-additions`):

- **Engine:** `InvalidJunction` also carries the true overlap — the tree
  distance minus the gap between the two flap rectangles
  (`hypot(max(sx,0), max(sy,0))` from the same `sx`/`sy` upstream's
  `createJunction` computes). Exported as `overlap` beside the existing
  `narrowness`; the message reports it.
- **Stroke rule:** restore `bpArcPathNarrowness` and upstream's
  `narrowness < 0.4 → min(2 / narrowness, pxPerCell)`. The width is converted
  to SVG units by dividing by the camera scale, the way `BpFlapResizeHandles`
  already sizes in screen pixels; `non-scaling-stroke` comes off the rule since
  it never applied. `bpArcPathThickness` and the floor go.
- **Clip:** clip the layer to the sheet only, as `Layer.junction` is
  (`clipped: true`); the flap-union clip is removed. The stroke may again paint
  a few pixels past the flap circle — that is what BP Studio draws.
- **Order:** paint the layer above the rivers, creases, flaps, shades and
  gadgets — `Layer.junction` sits above hinge/ridge/axis-parallels. Dots and
  labels stay inside the per-flap group, so they end up under the junction
  rather than over it as upstream has them; at 0.6 alpha they read through.
  Layer alpha 0.6 dark / 0.4 light, from `styleService.junction`.

What parity costs, stated up front: on `minimal_repro_circle_issue.osf` (the
file behind the July commits) the lens has narrowness 0.385, so it is stroked
5.2 px again and ~2.6 px of red extends past the circle, as in BP Studio; and
overlapping junctions over red ridges are red on red, as in BP Studio.

Out of scope, flagged separately: the other `non-scaling-stroke` rules in the
pane (`.bp-packing-flap-clearance`, `.bp-packing-flap-handle`,
`.bp-packing-flap-resize-outline`) have the same defect and grow with zoom; and
the manual-packing validator's false "violates distance" error for stretched
flaps (task chip filed).

## Affected Areas

- `crates/oristudio-bp/src/layout.rs` — `InvalidJunction::overlap`.
- `crates/oristudio-bp/src/io/cp.rs` — `InvalidJunctionSnapshot.overlap`.
- `crates/oristudio-bp/tests/engine.rs` — fixture test for the hairline case.
- `tests/fixtures/bp-studio/stretched-flap-hairline-overlap.bps` — new fixture.
- `apps/web/src/engine/oristudioBpTypes.ts`, `oristudioBpSnapshotMapper.ts` +
  test — wire `overlap`, fix the message.
- `apps/web/src/lib/bpPackingViewport.ts` + test — `bpArcPathNarrowness` back,
  `bpArcPathThickness` gone.
- `apps/web/src/components/panels/BpPackingPanel.tsx` + test — stroke rule,
  clip, layer order.
- `apps/web/src/styles/theme.css` — `.bp-packing-conflict*` rules.

## Checklist

- [x] Engine: `InvalidJunction` carries `overlap`; snapshot exports it; test on
      the fixture asserts `overlap ≈ 9 − √80` and one junction `5,6`.
- [x] Web types + mapper: `overlap` from the wire, message reports it; mapper
      test updated.
- [x] Stroke rule restored in SVG units; `bpArcPathNarrowness` back with tests;
      thickness helper and floor removed; CSS rule loses `non-scaling-stroke`.
- [x] Flap-union clip removed; sheet clip kept; tests updated.
- [x] Conflict layer painted above the geometry; alpha 0.6 / 0.4; tests updated.
- [x] Validation: `cargo test -p oristudio-bp`, `cargo clippy`, `cargo fmt`,
      `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`; wasm
      rebuilt and the fixture checked in the browser at fit zoom and zoomed in.
- [ ] Draft PR against `main`.
