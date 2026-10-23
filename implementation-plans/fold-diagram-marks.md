# Fold steps in the Diagram: marks and words

## Goal

Owner feedback on the Fold launch (PR #475): a Fold step pulled into the
Diagram should look like a step of a published diagram. Its picture draws
every crease a rabbit ear folds, circles the ends of a partial crease and the
points a fold brings together, and places its arrow by the references the
step was made from. Its instruction names the fold's kind ("Valley fold",
"Fold and unfold", "Inside reverse fold") and never a letter, since the
Diagram's picture has none. A Repeat of several operations shows all of its
creases as its instruction, in Fold's crease-pattern pane and in the Diagram.

## Approach

- **Marks** (`diagram/fold/foldStepMarkPlan.ts`, pure): the engine's
  `FoldActionGeometry` stays the source. The Diagram places its arrow and
  adds circles from the stored op and the scenes either side of the step:
  - O1 segment: no arrow.
  - O2: both points circled, arrow from mover to target.
  - O3: a bisector's arrow halfway along the shorter edge; a parallel one
    from line to line; a segment's across the creased part.
  - Segment ends circled. A pinch's are not, because two circles would
    cover it.
  - Rabbit ear: every crease it folds, read off parent and child scenes,
    and the ear's tip swung to where it lands.

  Imported arrows bow the way that keeps more of the arrow on the paper,
  then the way that runs along fewer of the step's lines. Shared drawing in
  `lib/stepDiagram` is unchanged, so References draws exactly as before.
- **Words** (`diagram/fold/foldDiagramSentence.ts`): the Diagram's own
  variant of `foldStepSentence`, built from the same `FoldSentenceStep`.
  Fold's strip keeps its lettered sentences. A step's untouched instruction
  takes the new words on its next capture (`setFoldStepPicture`).
- **Repeat creases**: `FoldPaneCreaseOptions.since` is the step count of the
  state a step folds from. Every crease made after it is the step's own.
  Fold's pane reads it off the op (`foldOpSteps`), the step pages and the
  Diagram off the parent's summary.

## Affected Areas

- `apps/web/src/diagram/fold/` (capture, run capture, picture, pull, merge)
- `apps/web/src/fold/canvas/` (`foldPaneScenes`, `useFoldStateView`, `useFoldCanvasPaint`)
- `apps/web/src/fold/io/` (`foldStepPages`, `foldHandOffs`)
- `apps/web/public/locales/*/panels.json`

## Checklist

- [x] Terse Diagram instruction per kind, merged steps said once for both sides
- [x] Segment ends circled; O1 segment without an arrow
- [x] O2 points circled, arrow between them
- [x] O3 bisector halfway along the shorter edge; parallel from line to line
- [x] Rabbit ear: all four creases, the ear swung over
- [x] Arrows bowed over the paper
- [x] Repeat's every operation's creases: Fold pane, step pages, Diagram
- [x] Unit and real-engine tests; i18n in all locales
- [x] Before/after pictures (`artifacts/fold-launch/diagram-marks/compare/`)
