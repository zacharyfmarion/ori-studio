# BP Empty-Space Shading

## Goal

Show, in the Box Pleating editor's packing view, which paper is not taken up by
any flap or river — the paper the design is wasting — as a subtle shading behind
the geometry, with a Layers toggle to turn it off.

## Approach

### What "empty space" is

The engine already computes, for every tree node, the region of paper that node
occupies: `LayoutGraphicsSnapshot.nodeGraphics[i].data.contours`, a list of
`{ outer, inner[] }` rings. A leaf node's contour is its flap's region; an
internal node's contour is its river band (outer ring with the child subtree
punched out as a hole). These are the contours the packing view already strokes
as the hinge layer, so shading their complement marks exactly the paper no flap
or river claims.

Empty space is therefore `sheet − ⋃ node contours`, and no new geometry has to be
derived — only inverted.

### Why an SVG mask, not one even-odd path

Two facts from probing the engine (`project_graphics_snapshot` on hand-built
designs) rule out the cheaper renderings:

- Contours are **not** always rectilinear. Once a stretch has a pattern, gadget
  boundaries are merged into the node contour, which then carries edges of
  arbitrary slope (e.g. `(8,4) → (7,5.33)`). So no axis-aligned-only shortcut.
- Contours from different nodes **do** overlap when the layout is invalid — the
  overlap is what makes it invalid. A single `fill-rule: evenodd` path over the
  sheet plus every ring would cancel in that overlap and paint the *most*
  covered paper as empty, which is exactly backwards. Winding-rule fills fail the
  same way.

A luminance `<mask>` is idempotent under overlap: black painted twice is still
black. So the mask is white over the sheet, and each node contour is painted
black as its own `<path fill-rule="evenodd">` — even-odd *within* one node's
rings is exact, because a node's own contours are disjoint and properly nested
(the engine's `Stacking` guarantees it). Nothing needs a polygon-boolean library,
and nothing needs the engine to change.

### Shape of the change

- `OristudioBpPackingView` gains `coverage: OristudioBpCoverageRegion[]`, mapped
  in `oristudioBpSnapshotMapper` straight off `nodeGraphics[].data.contours`.
  Same wire data the hinge polylines already come from, kept as regions instead
  of being flattened into unrelated polylines.
- `bpPackingCoveragePath` in `lib/bpPackingViewport.ts` turns one region into an
  SVG path `d` in screen space, reusing the existing sheet transform.
- `BpPackingEmptySpaceLayer` renders its own `<mask>` and the shaded sheet shape.
  It is presentation only; the panel mounts it.
- New `emptySpace` key in `BP_PACKING_VIEW_LAYER_KEYS`, default on, listed in the
  packing Layers menu next to the other view toggles. It is a settings-only key
  like `outsidePaper` — it gates no engine layer id, so `isBpPackingLayerVisible`
  is untouched.
- Shading renders above the paper and below the grid, so the grid, creases, and
  flaps all stay legible on top of it.
- With no coverage data at all (a stale packing, or a document whose layout has
  not been computed), nothing is shaded — an unknown layout is not evidence of
  empty paper.

## Affected Areas

- `apps/web/src/engine/oristudioBpTypes.ts`
- `apps/web/src/engine/oristudioBpSnapshotMapper.ts`
- `apps/web/src/lib/bpPackingViewport.ts`
- `apps/web/src/lib/oristudioBpViewportSettings.ts`
- `apps/web/src/components/panels/BpPackingEmptySpaceLayer.tsx` (new)
- `apps/web/src/components/panels/BpPackingPanel.tsx`
- `apps/web/src/styles/theme.css`
- `apps/web/public/locales/*/panels.json`

## Checklist

- [x] Confirm what the engine already emits for flap/river coverage
- [x] Confirm contours can be non-rectilinear and can overlap
- [x] Write the plan
- [x] Carry node contours through the snapshot mapper as coverage regions
- [x] Add the coverage → SVG path helper with unit tests
- [x] Add the `emptySpace` view layer key, default on
- [x] Render the mask-based shading layer in the packing panel
- [x] Style it as a subtle, theme-adaptive tint
- [x] Localize the new layer label for all 8 locales
- [x] Web lint, typecheck, unit tests, i18n check
- [x] Verify in the browser
- [x] Open a draft PR
