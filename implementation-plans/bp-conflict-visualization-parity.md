# BP Conflict (Invalid Junction) Visualization Parity

## Goal

Make the BP editor's invalid-junction ("conflict") rendering match Box Pleating
Studio: a solid red, semi-transparent **arc region** — the intersection of the
two flaps' rounded-rect clearance shapes — drawn on top of the flaps and clipped
to the sheet, with the narrow-shape stroke widening rule so slivers stay visible.

Today the panel draws each conflict path as an SVG `<polygon>` built from the
arc points with their arcs **discarded**. Most conflict paths are two-point
lens shapes, so a 2-point `<polygon>` degenerates to a **straight line** — the
"weird lines" the user sees. Everything needed to draw it correctly is already
in the snapshot and unused.

## Background: how BP Studio does it

Reference files in `third_party/box-pleating-studio`:

- `src/core/design/layout/junction/invalidJunction.ts` — `$getPolygon()` returns
  `ArcPolygon` = `ArcPath[]`, each path a list of `{x, y, arc?, r?}`. `arc` is
  the **tangent anchor** (canvas `arcTo` control point), `r` the radius.
- `src/core/design/tasks/invalidJunction.ts` — emits/removes junctions by
  `"a,b"` tag as the layout updates.
- `src/client/project/components/layout/junction.ts` — the renderer. Per path:
  - `narrowness = dist(p1.arc, p2.arc) / dist(p1, p2)`, and `NaN` when
    `path.length > 2` (so only 2-arc lens shapes are ever stroked).
  - `narrowness < 0.4` → `lineStyle({ width: min(2 / narrowness, maxWidth),
    join: "bevel", color })`; otherwise `lineStyle(0)` (fill only).
  - `maxWidth = ProjectService.scale` = **pixels per model unit**.
  - Fill = `style.junction.color` (`RED = 0xff0000` by default), then
    `moveTo` / `arcTo(p.arc.x, p.arc.y, p.x, p.y, p.r)` / `lineTo`, closing with
    an `arcTo` back to `path[0]` when that point carries an arc.
- `src/client/services/styleService.ts` — `junction.alpha = 0.6` (dark) /
  `0.4` (light); `junction.color = RED`.
- `src/client/svg/index.ts` — the SVG export confirms the exact CSS:
  `.junction{stroke:RED;stroke-width:0;fill:RED;vector-effect:non-scaling-stroke;
  opacity:0.6;stroke-linejoin:bevel}` with a per-path `style="stroke-width:W"`
  override. `vector-effect: non-scaling-stroke` proves **W is in screen pixels**,
  so the `min(2/narrowness, scale)` clamp means "never wider than one grid unit".
  `SvgGraphics.arcTo` emits `A r,r,0,0,1,x,y` — always small-arc, sweep 1, in
  BP's `scale(s, -s)` (y-up) space.
- `src/client/shared/layers.ts` — `Layer.junction` sits **above** shade / edge /
  hinge / ridge / axis-parallels and **below** dot / vertex / label, and is
  `clipped: true` (clipped to the sheet). BP's flaps live in the shade/hinge
  layers, i.e. **under** the junction.

Our Rust port is already faithful: `InvalidJunction::get_polygon` in
`crates/oristudio-bp/src/layout.rs` runs the same two `rr_intersection` calls,
and `crates/oristudio-bp/src/sweep/rr_intersection.rs` produces the same
`{point, arc: anchor, radius}` triples. The snapshot
(`crates/oristudio-bp/src/io/cp.rs`, `InvalidJunctionSnapshot`) ships them as
`polygon: ArcPolygonData`. **No engine change is needed.**

## Gaps to close (all web-side)

1. **Arcs discarded.** `packingInvalidJunction`
   ([oristudioBpSnapshotMapper.ts:346](apps/web/src/engine/oristudioBpSnapshotMapper.ts:346))
   flattens arc points to plain points; the panel
   ([BpPackingPanel.tsx:1755](apps/web/src/components/panels/BpPackingPanel.tsx:1755))
   renders `junction.polygons` as `<polygon>`. `arcPolygons` is carried on the
   type and never read anywhere. Two-point paths render as bare line segments.
2. **Wrong `narrowness`.** The field named `narrowness` in the snapshot is
   `InvalidJunction::distance_after_flap_radii()` (the overlap distance), *not*
   BP's per-path narrowness ratio. It is only used to build the message string.
   BP's narrowness is a **per-path, draw-time** quantity and must be computed
   client-side from the arc anchors.
3. **Stroke rule missing.** `.bp-packing-conflict` always strokes 2px
   ([theme.css:5454](apps/web/src/styles/theme.css:5454)); BP strokes only when
   `narrowness < 0.4`, at `min(2/narrowness, pxPerUnit)` px.
4. **Fill too faint.** Ours is `--status-danger` at 20% (32% selected); BP is
   solid red at 0.6 opacity in dark mode.
5. **Z-order inverted.** Conflicts render *before* the flaps group
   (BpPackingPanel.tsx:1737 vs :1767) and `.bp-packing-flap` fill is **opaque**,
   so the lens is occluded exactly where it matters. BP draws junctions above.
6. **No sheet clipping.** BP clips the junction layer to the sheet; the panel
   has no `clipPath` at all.
7. **Bounds under-estimate.** `bpPackingViewport.ts:420` fits world bounds using
   the straight point list, ignoring arc bulge.
8. **Interactivity divergence.** BP junctions are non-interactive. Ours are
   `role="button"` + focusable + hover cursor, and the selected state changes
   stroke width — which will fight the narrowness stroke rule. Conflict
   selection is a deliberate product extension (issues list ↔ canvas linking, see
   `oristudioBpSelection.ts`) and should be **kept**, but expressed without
   corrupting the parity visual.

## Approach

Keep the engine untouched. Add an arc-aware SVG path builder, render one
compound `<path>` per conflict with a per-subpath stroke width, restack and clip
the layer, and restyle to BP's palette. Keep our selection affordance on a
separate invisible hit path.

Coordinate note: `bpPackingPointToSvg` bakes BP's `scale(s, -s)` into each
point, so the y axis is flipped relative to BP's space. BP always emits sweep
flag `1`; under a y-flip the equivalent flag is `0`. Rather than hard-coding
either, derive the flag from the sign of the cross product
`(A - P0) × (P1 - A)` computed **in SVG space** — that is correct regardless of
flip and of arc orientation. Large-arc flag stays `0`: rounded-rect corner arcs
are at most a quarter turn and the sweep only subdivides them. The radius must
be scaled by `pxPerUnit` (`bpPackingUnitToSvg`).

## Affected Areas

- `apps/web/src/lib/bpPackingViewport.ts` — new arc-path → SVG `d` helper,
  per-path narrowness helper, arc-aware world bounds.
- `apps/web/src/components/panels/BpPackingPanel.tsx` — conflict layer rendering,
  z-order, sheet clip.
- `apps/web/src/engine/oristudioBpSnapshotMapper.ts` /
  `apps/web/src/engine/oristudioBpTypes.ts` — rename the misleading
  `narrowness`, drop the dead flattened `polygon`/`polygons` (or keep one for
  hit-testing only).
- `apps/web/src/styles/theme.css` — `.bp-packing-conflict*` rules.
- Tests: `bpPackingViewport.test.ts`, `oristudioBpSnapshotMapper.test.ts`,
  panel tests.

## Checklist

### Phase 1 — data plumbing

- [x] Rename the snapshot field on the web side: `narrowness` → `overlap`
      (`OristudioBpInvalidJunction`), since it is
      `distance_after_flap_radii()`. Update the message string and
      `oristudioBpSnapshotMapper.test.ts`. Leave the wasm JSON key alone (or
      rename it in `io/cp.rs` too and update the TS wasm type in the same pass).
- [x] Promote `arcPolygons` to the primary geometry (`paths: BpArcPath[]`).
      Remove the unused singular `polygon`; keep a flattened
      `polygons` only if hit-testing needs it, otherwise delete it.

### Phase 2 — arc → SVG path

- [x] Add `bpArcPathToSvgPath(path, sheet, paperRect)` to
      `bpPackingViewport.ts`: map every point through `bpPackingPointToSvg`,
      emit `M`, then per point `A r*unit,r*unit,0,0,<sweep> x,y` when `arc`/`r`
      are present and `L x,y` otherwise, then the closing segment (arc if
      `path[0].arc` exists, else `Z`).
- [x] Derive `<sweep>` from the SVG-space cross product of
      `(anchor - prev) × (curr - anchor)`; guard degenerate/zero-length cases by
      falling back to `L`.
- [x] Add `bpArcPathNarrowness(path)`: `dist(p0.arc, p1.arc) / dist(p0, p1)`,
      returning `null` when `path.length !== 2` or either arc is missing
      (BP's `NaN` case — no stroke).
- [x] Unit tests: a two-arc lens produces two `A` commands and closes; a
      polyline path produces `L` commands; narrowness is `null` for >2 points;
      sweep flag flips when the sheet mapping flips y.

### Phase 3 — render the conflict layer

- [x] Replace the `<polygon>` map with one `<path>` per subpath, `d` from the
      new helper, `strokeWidth = narrowness !== null && narrowness < 0.4
      ? Math.min(2 / narrowness, unit) : 0` (px; keep
      `vector-effect: non-scaling-stroke` so this stays screen-space).
- [x] Move the conflicts group **after** the flaps/rivers groups and before
      dots/labels, matching `Layer.junction`.
- [x] Add a sheet `clipPath` and apply it to the conflicts group.
- [x] Keep selection: render the visual path with `pointer-events: none` and add
      a sibling transparent path (same `d`) carrying `data-bp-select`,
      `role="button"`, `tabIndex`, and the aria-label. Selected/focused state
      changes **opacity/filter**, never the parity stroke width.

### Phase 4 — styling

- [x] `.bp-packing-conflict { fill: <red>; stroke: <red>; stroke-width: 0;
      stroke-linejoin: bevel; vector-effect: non-scaling-stroke; }` with group
      `opacity: 0.6` dark / `0.4` light. Decide red source: BP's literal
      `#ff0000` vs our `--status-danger` (`#e06c75`) — recommend a dedicated
      `--bp-junction` token defaulting to the theme danger hue so the packing
      canvas stays visually consistent, and note the deviation here.
- [x] Selected conflict: raise opacity (e.g. 0.6 → 0.85) instead of thickening.

### Phase 5 — bounds and follow-ups

- [x] Make `bpPackingWorldBounds` include arc bulge (inflate each arc segment's
      endpoints by its radius, or sample the arc) so a conflict is never
      clipped out of "fit to content".
- [ ] Optional (separate visual gap, same family): BP's flap clearance is a thin
      solid rounded rect in the hinge color with no fill
      (`flap.ts#$drawCircle`); ours is dashed with a 13% tint
      (`.bp-packing-flap-clearance`). Decide whether to converge.

### Phase 6 — validation

- [ ] `cd apps/web && npx tsc --noEmit` (avoid `npm run typecheck:web`, which
      regenerates tracked wasm artifacts).
- [ ] `npm run lint:web`, `npm run test:web`.
- [ ] Browser check: two flaps too close on a dark theme — the lens is a filled
      red arc region above the flap rectangles, clipped at the sheet edge; a
      near-degenerate sliver still reads as a visible red stroke; clicking it
      still selects the conflict in the issues list.
