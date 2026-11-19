# Fold-angle ink on crease-pattern thumbnails

## Goal

Every small drawing of a crease pattern outside Edit's canvas draws a crease
that folds short of 180° the way Edit's canvas does — faded in the default
`opacity` mode, hue-shifted in `color` — so a 3D pattern can be told from a
flat one at a glance (Zach, 2026-11-19: "so I can actually see which crease
patterns are 3D — in the diagram workspace, simulation sidebar, etc.").

Today every one of them draws a 90° crease at full ink, exactly like a full
fold:

- the Diagram's pattern picker ("Choose a pattern"), a linked step card's
  corner, the Step pane's Pattern row, the References browser's cards, and
  Fold's Import CP picker — all `PatternThumbnail` (a 2D canvas);
- the Simulate rail and the References rail — `SheetGrid` (SVG);
- the Layer order dialog's crease-pattern pane — `cpPatternStrokes`, which
  builds Edit's own strokes but never passes the fold-angle style;
- the Export dialog's per-pattern thumbnails (`cpThumbnailSvg`), which take
  the export's palette but none of its fold-angle encoding.

A pattern with no non-180° crease must draw exactly as before.

## Approach

### One encoding

`foldAngleInk` (`cp-workspace/foldAngle/foldAngleRamp.ts`) stays the only
place the ramp is written. The export already turns a CSS ink into a stroke
colour and an opacity through it (`creaseExport.ts`'s `encode`); that step
moves into the ramp module as `foldAngleCssInks`, and the export, the canvas
painter and the SVG cards all call it. A crease whose ink cannot be parsed
still fades (its opacity is the opacity mode's), so no surface can fall back
to drawing it as a full fold.

### Carry the angle through the thumbnail

`SheetStroke` — the one stroke type every thumbnail is built from — gains an
optional `foldDegrees` (|ρ| in degrees, below 180), set only on a crease that
folds short of a full fold, so a classic pattern builds the same strokes,
field for field. Each source fills it from what it reads:

- a document snapshot's line (`linesSheetThumbnail`): `fold_magnitude`;
- the compact transport (`referencesSheets.sheetThumbnail`): `segFoldMagnitude`;
- a FOLD (`segmentSheet`, `foldCpSummary`): `edges_foldAngle`, through the
  export's existing rule for FOLD edges (only `M`/`V`, ±180 with an epsilon),
  which moves to `lib/foldAngle.ts` with `isClassicFoldAngle` so both read
  one definition. `segmentEdges` carries it on each `SegmentEdge`, so the
  Simulate rail's fallback and the Export dialog's thumbnails read the same
  edges.

Fold states (`foldStateFrame`) fold flat by construction and carry no angle.

### Stored thumbnails

A Diagram step keeps the thumbnail it was linked with. `foldDegrees` is
written only on a partial crease, so a file with no 3D pattern is written
byte for byte as before. `readSheetThumbnail` takes it (finite, 0 ≤ it < 180,
anything else is damage), and `isNewerSheetThumbnail` names it. An older
build reads such a thumbnail at full ink and carries the step whole, as it
does any field it has no name for. A thumbnail stored before this change has
no angle and keeps drawing at full ink until the step is linked again — there
is nothing in it to read one from.

### The user's display mode

Both painters read the View panel's choice (`oristudioCpViewport.foldAngleDisplay`)
through one hook, `useFoldAngleDisplay`, and the theme's anchor off the element
they draw in, as Edit's canvas does. The Layer order dialog takes the mode
from its host's look, beside the line style it already takes from Edit's view
(the dialog is store-free by design). The Export dialog's thumbnails follow
the dialog's own Fold angle style, since they preview the exported image.

The rails' `SheetGrid` is a known shared block (`sheet-card`,
`implementation-plans/scoped-css.md`), so no rule is added to it: the one
line that is shaded carries its computed ink and opacity on the element, as
the canvas painter sets them per stroke. Every other line still takes its
ink from the stylesheet.

### Out of scope

Pictures printed on a Diagram page — a step shown as a crease pattern
(`creasePatternScene`) and the title block's pattern — draw in the paper
style's diagram pens. Whether a printed diagram should mark a 3D crease is a
design question, left for Zach. The References workspace's own view draws a
precrease plan in the paper style, for the same reason.

## Affected Areas

- `apps/web/src/lib/foldAngle.ts`, `lib/creaseExport.ts`, `lib/creaseExportFold.ts`
- `apps/web/src/cp-workspace/foldAngle/foldAngleRamp.ts`, `useFoldAngleDisplay.ts`
- `apps/web/src/cp-workspace/sheets/` (thumbnail type, sources, painters, inks)
- `apps/web/src/cp-workspace/references/referencesSheets.ts`
- `apps/web/src/fold/io/foldImportFiles.ts`
- `apps/web/src/components/ui/PatternThumbnail.tsx`
- `apps/web/src/cp-workspace/adapters/cpPatternStrokes.ts`, the Layer order
  look and its hosts, Fold's crease-pattern pane

## Checklist

- [x] Shared CSS-ink encoder in `foldAngleRamp.ts`; export uses it
- [x] FOLD-edge and magnitude helpers in `lib/foldAngle.ts`
- [x] `SheetStroke.foldDegrees`: fit, store, read, newer
- [x] Sources fill it: snapshot lines, transport, FOLD segments, FOLD text
- [x] `PatternThumbnail` / `paintSheetThumbnail` draw it
- [x] `SheetGrid` draws it
- [x] The Export dialog's pattern thumbnails (`cpThumbnailSvg`) shade it in
      the dialog's own Fold angle style, as the exported image does
- [x] Layer order and Fold crease-pattern panes pass the fold-angle style
- [x] Unit tests (encoder, helpers, thumbnail round trip, both painters)
- [x] Browser: before/after of the Diagram pattern picker and the Simulate rail with a real 3D file
- [ ] Lint, typecheck, relevant vitest files; draft PR
