# Export Grid Lines

## Goal

Let people draw the document's grid into an exported crease-pattern image, from
both surfaces that compose one: the Export Image dialog (SVG and PNG) and the
Share crease pattern modal's link-preview card.

Requested for tessellations — a grid makes twist sizes and the spacing between
them readable straight off the image — and useful for box-pleated designs for
the same reason.

## Approach

The grid is Oriedita's, and it already has one generator
(`getOrieditaGridLines` / `orieditaGridLinesForModelBounds` in
`lib/creasePatternViewport.ts`) that the live canvas draws from. The export
reuses it rather than re-deriving a lattice, so an exported grid is the grid the
editor shows.

Two facts the drawing code needs that `CreaseExportOptions` cannot express:

- the document's `OristudioCpGridMetadata` (size, angle, axis scales, interval,
  diagonals) — the exported `FoldDocument` does not carry it, and
- where the document's coordinates sit in that fold's space, because an imported
  fold is rescaled into the unit square (`cpModelToFoldTransform`).

Both are resolved content, so they ride in `CreaseExportContent` as one
`CreaseExportGridSource`, alongside the folded-figure snapshot that already works
this way. `CreaseExportOptions.showGrid` is the declarative half.

The grid is generated over the drawn crease pattern's own bounds — mapped back
into model space through the inverse transform — and then **clipped to the sheet
outline**, not to its bounding box. A lattice comes out in whole cells so it
always overhangs, and paper is not necessarily rectangular: on a hexagon a box
clip leaves ruling floating in the corners with nothing under it. The outline is
every edge used by exactly one face, chained into closed loops and emitted as one
even-odd path, which is the union of the faces — so disjoint patterns each get
their own loop and a hole is excluded. Derived from the faces rather than from
`B` assignments, which say what a crease *is*: a document may draw an edge crease
across the middle of a sheet.

It is drawn through `visibleOrieditaGridMetadata`, the existing helper for "a
viewport that is *showing* the grid", so a document whose grid state is `Hidden`
still exports a grid when asked rather than leaving a dead toggle.

Painting order inside the artwork: facet backgrounds, grid, creases, points —
the grid sits on the paper and under every crease.

Both modals get a `Show grid` toggle, disabled with a hint when the export has no
grid to draw (a TreeMaker design has no kernel document).

## Affected Areas

- `apps/web/src/lib/creaseExport.ts` — `showGrid` option, `CreaseExportGridSource`
  content, palette grid colours, grid SVG body.
- `apps/web/src/store/commandDialogStore.ts` — the dialog carries the grid source.
- `apps/web/src/components/CreaseExportDialog.tsx` — Appearance toggle; resolves
  the grid into the returned content.
- `apps/web/src/cp-workspace/share/ShareLinkModal.tsx` — same toggle on the card.
- `apps/web/src/store/workspaceStore/types.ts` — share draft carries the grid source.
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — resolve the grid
  source for both export entry points and for the share draft.
- `apps/web/public/locales/*` — new dialog strings in all 9 locales.

## Checklist

- [x] Grid source type, option, palette colours, and drawing in `creaseExport.ts`
- [x] Unit tests for grid drawing, gating, and placement
- [x] Export dialog toggle + resolved content
- [x] Share modal toggle
- [x] Store wiring for both export entry points and the share draft
- [x] i18n extract, translate 8 locales, stamp, check
- [x] lint / typecheck / web unit tests
- [ ] Draft PR
