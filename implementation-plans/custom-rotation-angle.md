# Custom Rotation Angle

## Goal

Let a rotation in the Diagram workspace name any angle, not only the three
fractions of a turn it offers today (1/8, 1/4, 1/2). A user asked to print
"135°" in the rotate glyph between two steps. Both places a rotation lives
take it: a turn between steps (D22) and a rotate mark kept on a step's
picture.

## Approach

- **Data model.** `DiagramRotation` becomes a union: a preset
  `{ amount: 'eighth' | 'quarter' | 'half'; direction }` or an angle of the
  author's own `{ degrees; direction }`. `degrees` is finite, 0 < degrees <
  360, at most one decimal. Presets are written exactly as before, so a file
  with no custom angle saves byte for byte as v0.6.2 writes it.
- **File.** `readRotation` reads both shapes. Both keys at once is malformed
  (dropped); `degrees` ≥ 360 is a newer build's (carried, locked); a
  non-number, ≤ 0 or non-finite `degrees` is malformed. v0.6.x has no name for
  `degrees`, so it carries such a mark or turn verbatim and locked — the
  reader's own rule for a key it does not know — rather than dropping it. No
  format version bump: no field added to the diagram has ever bumped it.
- **One label.** `rotateAmountLabel` beside the glyph's `ROTATE_FRACTION`
  prints a preset's fraction or an angle's degrees with a degree sign
  ("135°", "22.5°"). The glyph, the turn's name and card words, and the
  context menu's extra row all read it. The rotate primitive carries either
  `amount` or `degrees`; References only ever emits `amount`, and its stored
  model format is unchanged (its reader still refuses `degrees`).
- **Fit.** A label longer than a fraction is set smaller so it stays between
  the arcs (a code constant, applied to every file).
- **Controls.** One shared `DiagramRotationControls` (Amount segmented with a
  fourth segment, Custom; an Angle number row while custom; Direction) used by
  the turn's Step pane and the Layers inspector of a rotate mark.
- **Menu.** A custom turn's context menu shows one extra checked radio row
  labelled with its angle after the three presets.
- **Analytics.** No event fires when a rotation's amount changes today, so one
  minimal event, `diagram rotation customized`, says a custom angle was chosen
  and on what (`target`: `turn` | `mark`). Never the angle.
- **Room for four Amounts.** At the Step pane's default width (280px at 1280,
  1440 and 1600px windows) the turn pane inset its rows a second time, so the
  segmented control had 144px and all four labels were cut ("1.."). Its rows
  now run the pane's width, as a step's Step pane's and the Layers pane's do
  (168px): every locale's four Amounts read whole, with short words for Custom
  where the long one did not fit (es "Otro", fr "Autre", pt-BR "Outro", ko
  "직접"). Direction's "Counterclockwise" was already cut there and still is.

## Affected Areas

- `apps/web/src/diagram/document/diagramDocument.ts` — the type, `sameTurn`.
- `apps/web/src/diagram/document/diagramFile.ts` — read and write.
- `apps/web/src/diagram/document/diagramRotation.ts` (new) — the range and
  the one way each change to a rotation is made.
- `apps/web/src/diagram/annotate/annotationModel.ts` — a mirror keeps the angle.
- `apps/web/src/cp-workspace/references/stepDiagramGeometry.ts`,
  `referenceFinderDiagramToPrimitives.ts`, `diagram/DiagramPrimitives.tsx` —
  the primitive and the label.
- `apps/web/src/diagram/annotate/annotationPrimitives.tsx` — mark to primitive.
- `apps/web/src/diagram/actions/diagramTurnActions.ts` — words and menu.
- `apps/web/src/components/diagram/DiagramRotationControls.tsx` (new),
  `DiagramTurnPane.tsx` and its module, `DiagramLayers.tsx`,
  `ui/fieldRows/NumberRow.tsx` (passes `minChars` through).
- `apps/web/src/analytics/` and `docs/analytics.md` — the new event.
- `apps/web/public/locales/*/panels.json`, `apps/web/src/i18n` hashes.

## Checklist

- [x] Union type, helpers, equality
- [x] File reader and writer, with compatibility tests
- [x] Shared label function, primitive, glyph fit
- [x] Turn words and context menu row
- [x] Shared rotation controls in the Step pane and Layers inspector
- [x] Turn pane rows at the pane's width, so four Amounts fit
- [x] Analytics event and docs row
- [x] i18n extract, translations, stamp, check
- [x] Unit and component tests; typecheck, lint
- [x] Browser check: glyph, card, Pages view, controls (light and dark), menu, save and reopen, PDF

## Merged with the Fold launch (2026-10-21)

The Fold launch branch had its own exact angle: the shared `TurnRotation`
(`lib/steps/turn.ts`) gained `{ amount: 'degrees', degrees, direction }`, normalised
to at most 180° and never a preset's angle, for Fold's Rotate tool and pulled
Fold turns. The merge keeps one in-memory type, that one, and this plan's
behaviour on top of it:

- A Diagram angle is `TurnRotation`'s `amount: 'degrees'` form, kept as typed: 270°
  clockwise stays so and 90° stays an angle (`diagramRotation.ts`). Only Fold's
  Rotate tool, file and wire normalise; a Diagram turn never goes back to Fold.
- The Diagram file still writes `{ degrees, direction }`, as this plan shipped
  it. It also reads the launch build's `amount: 'degrees'` spelling. An angle is
  read to a millionth (a pulled Fold angle) rather than a tenth; finer, or a
  whole turn or more, is a newer build's. Preset plus angle, or none above 0,
  is dropped.
- Words, glyph text and the menu row come from the shared `lib/steps/turnWords.ts`
  and `turnRotationGlyphText`; the glyph keeps this plan's `rotateLabelScale` fit.
  The menu row is `rotate-custom`. The Step pane and Layers pane use
  `DiagramRotationControls`, which replaced the launch's extra angle segment.
