# Diagram SVG export: a file per page

## Goal

The Diagram's SVG export writes every page on one sheet, in printed spreads
(`diagram-workspace.md`, D11 *Amended, one SVG*). People who finish a diagram
in Affinity want each page on its own, to edit it there and make their own PDF
(Zach, 2026-11-02: "I wanna be able to export each page kind of like the PDF
version, because people want to edit each page individually in Affinity and
then export it as a PDF … make this the default option and then have an option
to do it the way it currently does it").

So the SVG export gains a choice, **Pages** (the default) or **Spreads** (the
sheet as it is today).

## Approach

- **Settings.** `DiagramExportSettings` gains `svg: 'pages' | 'spreads'`,
  default `'pages'`, read by the normaliser like `pdf`. A stored setting from
  before has none, so it opens on Pages: the new default for everyone.
- **The files.** A new pure module, `diagram/export/diagramPageFiles.ts`,
  turns the prepared pages into one file each: the page the Pages view and the
  PDF preview show (`PreparedDiagramPages.compose`), a document of its own in
  pt, its text live, each face it sets embedded and cut to that page's
  characters. Named `<title>-page-N`, zero-padded to the page count's width as
  step files are.
  - **No white ground.** The sheet draws a white page under each page to mark
    it out on the sheet; a page file is the page, as the PDF writer is handed
    it, with none. An editor's own page shows through, and nothing under the
    drawing is picked up by a drag on the paper.
- **The save.** Several pages go out as one ZIP through `savePaperExportZip`
  (as step files do), named `<title>.zip`; a diagram of one page is saved as
  `<title>.svg` alone, not a ZIP of one.
- **The dialog.**
  - The SVG card's line becomes "Every page, to edit in a drawing app.", with
    a vector icon; the spreads' open book moves to the Spreads card.
  - Under it, a Pages / Spreads row of option cards, as the PDF's At home /
    Print shop: Pages with the Pages view's icon ("Each page in its own
    file."), Spreads with the open book ("Facing pages side by side, on one
    sheet."). First page shows in the page setup only for Spreads.
  - Pages previews as the PDF does: a page at a time, the pager walking pages,
    the caption "210 × 297 mm · 4 files · ZIP" (or "1 page" alone). The button
    is "Export SVGs as ZIP" (or "Export SVG"); the footer names `Crane.zip`
    (or `Crane.svg`).
- **Analytics.** `diagram exported` keeps `format: 'svg'` for both and gains
  `svg_layout` (`pages`/`spreads`), documented in `docs/analytics.md`.

## Affected Areas

- `apps/web/src/diagram/export/diagramExportSettings.ts` (+ test)
- `apps/web/src/diagram/export/diagramPageFiles.ts` (new, + test)
- `apps/web/src/diagram/export/useDiagramExport.ts`
- `apps/web/src/components/diagram/DiagramExportOptions.tsx`
- `apps/web/src/components/diagram/DiagramExportModal.tsx` (+ test)
- `apps/web/src/analytics/trackDiagram.ts`, `analytics/events.ts`,
  `docs/analytics.md`
- `apps/web/public/locales/*/dialogs.json` and `.hashes.json`
- `implementation-plans/diagram-workspace.md` (D11 amendment)

## Checklist

- [x] `svg` setting, default Pages, normalised
- [x] `diagramPageFiles` with tests
- [x] Export hook: Pages preview, pager, ZIP or single SVG save
- [x] Dialog: SVG card copy and icon, Pages / Spreads row, First page for Spreads only
- [x] Analytics `svg_layout` + docs
- [x] i18n extract, 8 locales translated, stamp, check
- [x] Modal tests for Pages (ZIP and one page) and Spreads
- [x] Lint, typecheck, relevant vitest
- [x] Browser check of the dialog and of a saved ZIP's pages
- [x] D11 amendment in `diagram-workspace.md`
