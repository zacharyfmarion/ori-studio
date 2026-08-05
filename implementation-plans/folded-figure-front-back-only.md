# Folded figure: front and back only

## Goal

A folded figure is a piece of paper, and the only views the product offers are
the two you get by turning it over. Remove the `Both` and `Transparent` overlay
states from every place the UI lets someone choose how a folded figure is shown,
so a view can never be picked that the canvas will not draw.

The kernel keeps all four states, and a file that arrives carrying an overlay
state still renders exactly as saved — this is a change to what the product
offers, not to what it can represent.

## Approach

Give the offered sides one home instead of three near-copies:

- `apps/web/src/lib/foldedFigureSides.ts` exports `FOLDED_FIGURE_SIDES` and the
  `FoldedFigureSide` type (`Front0 | Back1`), narrowed from the kernel's
  `OristudioCpFoldedFigureState`. It lives in `lib/` because all three consumers
  — the CP panel, the export dialog, and the share modal — must reach it, and
  `lib/` is the layer with no CP-workspace dependency.
- The CP panel's "Side" segmented control and the export dialog's "Side" control
  both build from that constant. Their label helpers narrow to
  `FoldedFigureSide`, so the switches become exhaustive and a re-added state
  fails to compile rather than falling through a `default`.
- `CreaseExportFoldedFigureSettings.side` narrows to `FoldedFigureSide`, making
  "an export cannot request an overlay view" a type-level fact rather than a
  UI-only omission.
- `ShareLinkModal`'s local `ShareFoldedSide` was already this exact type; it
  becomes the shared one.

A figure loaded with an overlay state leaves neither segment marked current
until a side is chosen — the same behaviour the folded-figure display-style
choice already documents for a style outside its quick list.

## Affected Areas

- `apps/web/src/lib/foldedFigureSides.ts` (new)
- `apps/web/src/lib/creaseExport.ts`
- `apps/web/src/components/panels/CreasePatternPanel.tsx`
- `apps/web/src/components/CreaseExportDialog.tsx`
- `apps/web/src/cp-workspace/folded/foldedFigureState.ts` (typing + stale comments)
- `apps/web/src/cp-workspace/folded/foldedFigureActions.ts` (stale comment)
- `apps/web/src/cp-workspace/share/ShareLinkModal.tsx`
- `apps/web/public/locales/*/panels.json`, `dialogs.json` (orphaned keys)

## Checklist

- [x] Add `foldedFigureSides.ts` with the offered sides and its guard
- [x] Point the CP panel's Side control at it and narrow its label helpers
- [x] Point the export dialog's Side control at it and narrow `side`
- [x] Reuse the shared type in `ShareLinkModal`
- [x] Update the comments that describe Side as a four-way control
- [x] Drop the orphaned `Both` / `Transparent` strings from all 9 locales
- [x] Tests: the panel and export dialog offer exactly Front and Back
- [x] `npm run i18n:check`, lint, typecheck, web unit tests
