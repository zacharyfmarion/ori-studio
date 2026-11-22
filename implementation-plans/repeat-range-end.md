# Repeat: a range with a start and an end

## Goal

Repeat's range has a last step as well as a first, so a run of steps can be
repeated again after the step on screen, not only the run that ends there.
Repeating one flap's steps radially across several axes works: fold a flap
in steps 1–3, Repeat steps 1–3 across one axis, then Repeat steps 1–3 again
across another, and again across a third.

## Approach

Today the range is "the chosen first step through the step on screen", and
the repeat is added after the step on screen. The new range is "the chosen
first step through the chosen last step"; the repeat is still added after the
step on screen. The last step defaults to the step on screen, so a Repeat
taken up without choosing an end behaves exactly as before.

### What already holds

- The preparation (`repeatPreparation.ts`) already separates the source
  (each source step's before and after states) from the target (the repeat's
  parent, `request.parent`). It verifies each mirrored step against the
  source step it mirrors (`verifyMaterial`), never against the range's end,
  so a target that is not the range's end needs no new geometry.
- The axes are found on the state before the range (`baseline`), unchanged.
- The saved op already stores `source: { first, last, revision }`, with
  `revision` the digest of `last`'s path, which the Step pane reads to say the
  source changed. Until now `last` was always the repeat's parent; it is now
  the range's last step. No format change, no version bump: a file saved
  before reads as it did, and a file saved after reads in an older build (its
  `last` is just another step id).
- Diagram's precrease merge (`foldPrecreaseMerge.ts`) merges a Repeat only
  when its run is the one just before it; a Repeat whose range ends earlier
  is drawn as its own step, which is right: the run is not beside it.

### Changes

- `foldToolState`: `repeatLast` beside `repeatFirst` (null for the step on
  screen), let go each time the tool is taken up; a rebuild reads it from the
  saved op's `source.last`.
- `repeatRange`: takes the chosen last step; offers as ends the steps from the
  range's first through the step on screen that can be repeated; a chosen end
  before the chosen start falls back to the step on screen.
- `useFoldRepeatTool`: the source steps run first through last; the request's
  `source.last` and `revision` are the range's last step's; the preparation's
  context key includes the last step; commit checks both ends.
- Window: an **End with** row under **Start with**; the summary no longer says
  "through the current step"; the first instruction says the repeat is added
  after the step on screen.
- Step strip: the cards lit are the range's, first through last.
- Sentences: a Repeat whose range ends before the step it is added after is
  no "previous" operations. Fold says which steps it folds again ("Repeat
  steps 1–3 on the other side.", or "Repeat 2 earlier operations…" when an
  end is an unnumbered turn); the Diagram, whose numbers are its own, says
  the plain "Repeat on the other side." A stored step reads this off its own
  parent (`foldNodeSentenceStep`), so Diagram captures need no new context.
- Analytics: `range_end` (`current`/`earlier`) on a repeat's `fold step added`.

## Affected Areas

- `apps/web/src/fold/repeat/` — range, tool hook, window.
- `apps/web/src/fold/tools/foldToolState.ts` — `repeatLast`.
- `apps/web/src/fold/tools/foldToolWindow.ts`,
  `apps/web/src/components/fold/FoldToolWindow.tsx` — the End with row.
- `apps/web/src/fold/sequence/useFoldStepStrip.ts` — the lit range.
- `apps/web/src/analytics/trackFold.ts`, `docs/analytics.md`.
- `apps/web/src/fold/stepSentence.ts`, `fold/sequence/foldSentenceStep.ts`,
  `fold/sequence/useFoldSequenceView.ts`, `diagram/fold/foldDiagramSentence.ts`.
- Locales: the changed summary and instruction, the new row label, the new
  sentences.

## Checklist

- [x] Engine proof: a range ending before the repeat's parent prepares and
      replays (radial repeat of one corner fold across three axes)
- [x] `repeatLast` in the tool state, reset on take-up, read on rebuild
- [x] `repeatRange` with a chosen end, and its tests
- [x] Tool hook: source steps, request, context key, commit check
- [x] Window: End with row, summary and instruction words, tests
- [x] Step strip lights first through last
- [x] Analytics property and docs
- [x] Translations for 8 locales, `i18n:check`
- [x] Lint, typecheck, relevant tests
- [x] Sentences for a range that ends earlier, Fold and Diagram, with tests
- [x] Browser proof: radial repeat across several axes (precrease + corner fold, repeated across the vertical, diagonal and horizontal axes; Update from source steps reopens with its range end)
