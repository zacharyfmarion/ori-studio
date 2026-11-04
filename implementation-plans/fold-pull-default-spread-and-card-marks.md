# Fold steps pulled into the Diagram: default spread, and marks on the browser's cards

## Goal

Two owner requests (2026-11-03) about steps taken from Fold into the Diagram:

1. **Every pulled step starts spread.** A step whose state Fold shows spread
   keeps Fold's spread, as now. A step Fold shows unspread — no setting, the
   sequence's default off, or its own spread turned off — comes in at the
   Diagram's default spread (`DEFAULT_LAYER_SPREAD`) instead of flat. This
   covers both ways in: the Diagram's From Fold… browser and Fold's Send to
   Diagram.
2. **The From Fold… browser shows each step's marks.** Its cards show Fold's
   strip pictures today: the folded state, with no fold line or arrow. Each card
   should show the step it would become, with its lines, arrows and circles, as
   the References browser's cards already do.

## Approach

- **One rule for the render.** `foldPullRender` (`diagram/fold/foldPull.ts`)
  gives the spread Fold shows the state with (`foldStateSpread`), else
  `DEFAULT_LAYER_SPREAD`. The pull, the browser's cards and their tests all
  read the render from this one function.
- **A spread that cannot be drawn is not a lost step.** Before this change,
  most pulls had no spread to fail. Now every pull depends on the connected
  spread: preparing it, solving it, and clipping its picture within budget.
  `captureFoldTarget` captures a target in its render. When the spread throws,
  or the picture comes back over budget, it captures the target again without
  the spread and says so (`flattened`). The pull counts those steps and names
  them in a toast. The spread's error is reported (`reportError`) because it is
  swallowed on purpose.
- **A card is the step it would become.** The card's picture is the same
  capture the pull makes (`captureFoldTarget` with the card's render), turned
  into the same step a pull makes (`sentStep`, taken out of
  `pullReferencesSteps`). It is painted the way a Diagram card paints a step
  (`useStepPictureUrl`): the diagram's pens on white paper, its marks drawn
  over the picture and dotted under a flap. So the preview cannot drift from
  what Add produces.
- **Previews are captured lazily and kept** (`diagram/fold/foldPullPreviews.ts`).
  - A preview is keyed by the step's path digest (`fh1`), the moment, a merged
    run's end and the render.
  - It is asked for only by cards near the view, one capture at a time, in the
    order cards asked. A card scrolled away before its turn is passed over.
  - At most a few dozen are kept, so reopening the browser is instant.
- Turn cards and Finished show their state the same way, with no marks, so
  every card in the browser shares one look.

## Affected Areas

- `apps/web/src/diagram/fold/foldPull.ts`: render rule, capture with
  fallback, sent-step helper
- `apps/web/src/diagram/fold/foldPullPreviews.ts` and
  `useFoldPullPreview.ts` (new): preview queue, cache and hook
- `apps/web/src/diagram/fold/foldBrowserActions.ts`: toast for steps added
  unspread
- `apps/web/src/diagram/document/diagramDocument.ts`: `sentStep` taken out of
  `pullReferencesSteps`
- `apps/web/src/components/diagram/DiagramFoldBrowser.tsx` and
  `DiagramFoldPicture.tsx` (+ module CSS): the card shows the preview
- `apps/web/public/locales/*/toasts.json`: the new toast
- Tests beside each

## Checklist

- [x] `foldPullRender` defaults to `DEFAULT_LAYER_SPREAD`; tests updated
- [x] `captureFoldTarget` falls back to unspread; the pull counts and toasts it
- [x] `sentStep` extracted and shared by the pull and the preview
- [x] Preview queue and cache with unit tests
- [x] Browser cards show the preview; component test updated
- [x] i18n: extract, translate for 8 locales, stamp, check
- [x] lint, typecheck, relevant vitest
- [x] Browser check: a real Fold sequence, cards show arrows and spread, Add
      matches the cards

## Findings

- Over the real bridge (`diagramFoldLink.wasm.test.ts`), a card's capture and
  the step Add makes have the same render, the same picture digest and the
  same marks.
- In the browser, on a kite base with Fold spreads on two steps, every added
  step matched its card's picture digest and marks. Steps Fold shows unspread
  came in at 7%, and steps Fold spreads kept 50% and 30%.
- Cost of the default spread, on the corpus's traditional frog (63 steps):
  - One capture of a dense late step takes 110–230 ms spread, against
    15–35 ms unspread. The connected spread's preparation and solve are most
    of it.
  - Sending the whole path (49 steps and 12 turns) took 3.7 s, with every step
    spread and 121 marks lifted. Of the browser's 61 cards, only the 30 near
    the view were captured.
- Not done here: reusing a card's capture when Add is pressed. Add captures
  every step again, so a previewed pull pays twice. Reuse would need the
  marks given new ids.
- Found while checking the frog, and fixed in its own commit: a connected
  spread misdrew a crease piece whose crease runs on past its face.
  - `connectedDrawing` (`layer-spread/connectedScene.ts`) kept such a piece's
    `whole` crease unplaced, in the material scene's units rather than the
    picture's, and the painter's erosion pulled the line's ends onto it.
  - A flat sheet with two crossing precreases drew its cross as four skewed
    spokes. The default spread would have put that on most imported steps.
  - Such a piece is now eroded on its own ends. A regression test
    (`connectedScene.test.ts`) fails without the fix.
  - The same drawing serves Edit's and Fold's spread views, so they get the
    fix too.
