# Merge symmetric fold steps on import; show the real steps in From Fold…

## Goal

Owner requests (2026-11-23), following `diagram-merge-symmetric-precreases.md`:

1. **Merge folds, not only precreases.** Consecutive Fold steps that move
   separate paper and are the same fold mirrored become one Diagram step, as a
   book draws them. In his `cube_star_ornament.osf`, that means the cupboard
   fold's two edges (steps 2–3), the four corners (7–10) and the two strips
   (11–12).
2. **Turned steps are offered, not merged.** Some steps are the same fold
   turned rather than mirrored. Steps 4–5 are an example, and so are 14–15:
   each pair is a half turn apart, and no mirror maps one onto the other. Such steps start as separate
   steps and can be joined in the modal.
3. **See and choose merges in From Fold….** A group that will merge shows as
   one merged card. Each group can be split, or merged again, in the modal.
4. **Cards show the Diagram step.** Each card shows the picture before the
   fold with its lines and arrows, instead of Fold's picture of the result.

## Approach

### When steps merge

Both tests must pass:

- **Independent.** Each step moves paper that no other step in the group
  touches, and lands it clear of theirs. The test: the region a step's paper
  covers, where it was plus where it lands, overlaps no other step's region.
  Then the steps fold the same in any order, and every one can be drawn on the
  picture before the first. Landing counts: two corners folded past the centre
  overlap once down, and the order decides which lies on top.
- **The same fold, mirrored or turned.** Each step after the first repeats an
  earlier step in the group. The paper it moves, where that paper lands, its
  layers and its creases are the earlier step's, mirrored across some line or
  turned about some point. This is Repeat's own move test, `verifyMaterial`,
  which precrease pairs already use through `mirroredStepAxis`. The rest of
  the paper need not be symmetric: two flaps folded alike are alike wherever
  they are.

How a step joins its group depends on the symmetry. A step related to the
group by a mirror joins it merged, while **Merge symmetric steps** is on. A
step related to it only by a turn joins it split: the modal offers to join it,
but it starts off.

Precreases keep merging as they do today. They move no paper, so they are
independent of everything.

Six changes to today's check. Each is confirmed on his file (see below):

1. **Any step kind**, not only precreases. `verifyMaterial` already compares
   any family's effect. A turn-over or rotation, a collapse, an unfold back to
   an earlier step, or a Repeat ends a group (`isMergeableStep`).
2. **Groups longer than two.** Step k joins a group when it is independent of
   every member and is the image of one of them. In 7–10, step 8 mirrors 7
   across the vertical centre, 9 mirrors 7 across a diagonal, and 10 mirrors 7
   across the horizontal centre.
3. **No symmetry of the whole paper.** Today's pair check also asks that the
   whole state before the pair be symmetric (`verifiedSymmetry`). Inside a
   group of folds that fails: after step 7, one corner is already down. It
   would also refuse part of a group joined on its own, such as 8–9. So each
   pair is measured on its own states instead. Independence makes this sound,
   because nothing earlier in the group moved the paper a step folds.
4. **Old creases don't count.** In 7–10, steps 7 and 9 fold along creases that
   steps 5 and 4 left in the paper, while 8 and 10 fold fresh paper. Repeat's
   crease test wants the same crease value under both lines, so it refuses 8
   and 10 against 7. The merge test compares fold angles instead: an old flat
   crease and fresh paper are both flat. This becomes an option on
   `verifyCreases`, and Repeat keeps the strict test.
5. **Axes come from the lines each step folds.** Today's search reads the
   creases with the newest `made_at`. A fold along an old crease makes no new
   crease. So after step 7 the search reads step 5's creases, and after step 9
   it reads step 8's. Instead, the candidate axes and turns come from the
   creases a step changed, whether it made them or refolded them.
6. **Turns.** Candidate turns take one step's first changed line onto one of
   the other's, end for end either way. The move test needed one fix to accept
   them: it used a reflection's own map as its inverse, which is right only for
   maps that undo themselves (a mirror, a half turn), and now uses the true
   inverse. Its retry against held paper (`heldGauge`) assumes an axis, so it
   stays for reflections. Repeat's behaviour is unchanged.

Some pleats fold by moving the larger side of the paper (see `heldGauge`).
Such a step reads as touching everything, so it never merges. Re-gauging it,
as Repeat does, is a later refinement if the corpus shows misses.

Where the pieces live:

- The move test is `stepRelation` in `repeatVerification.ts`. A cheap filter
  runs first, as today: a pair is checked only when each step's changed lines,
  mapped, lie along the other's.
- Independence and grouping are in `diagram/fold/foldStepMerge.ts`:
  `stepFootprint`, `foldStepGroups`, `runRelation`, `startingRuns` and
  `isMergeableStep`. It replaces the pair logic of `foldPrecreaseMerge.ts`
  once Phase 2 wires it in.
- The modal, Send steps to Diagram and the capture will all call it. Results
  will be cached by state fingerprints, as `foldPrecreaseMirrors.ts` caches
  pairs.

### What his file shows

This was a throwaway check, not committed; his file never becomes a fixture.
It replayed steps 1–12 of `cube_star_ornament.osf` through today's engine, and
every state matched the saved one. Results, pair by pair:

- **2–3:** today's pair check finds a mirror, and the steps are independent
  (shared area 0). Merged.
- **4–5:** today's check finds no mirror, but `verifyMaterial` accepts a half
  turn. Independent (shared area 0). Offered.
- **7–8, 8–9, 9–10:** today's check refuses all three. Each pair is
  independent (shared area 0). Merged.
- **11–12:** today's check finds a mirror, and the steps are independent
  (shared area 0). Merged.
- **14–15** (Fold's steps 15–16, after the collapse and the turn): no mirror,
  but a half turn, and independent (shared area 0). Offered.
- **3–4 (control):** shared area 0.25, so it never merges.

On the corners, checked against the paper after step 6:

- The paper is symmetric across all three axes.
- Step 9 passes Repeat's test against 7 as it stands.
- Steps 8 and 10 are refused only for creases (`repeat_creases`), and pass when
  creases are left out.
- 7 and 9 fold along `flat:mountain` creases; 8 and 10 fold fresh paper.
- Checked against the state after 7, as today's pair check does it, the paper
  is not symmetric.

Every pair among 7–10 has shared area 0, and so do 10 and 11. Being
independent doesn't make two steps merge: 10 and 11 are different folds.

### The Fold corpus

The rule ran over the private Fold corpus: 113 models, all replayed to their
last step, 2,985 steps in all (2026-11-23, on `d6fe8869c` plus Phase 1). The
harness and its review page stay out of the repository.

- **Groups found:** 470. Of these, 413 are pairs, 44 are groups of four
  (blintz corners), and a few are larger. The largest groups (5–9 steps) are
  all precrease runs: grids and radial lines.
- **How they start:** 465 start merged as mirror images. 5 are offered as
  turns: four in a six-pointed star (60° and 120° turns) and the arms of a
  pinwheel. No group mixes kinds of move.
- **Kinds of move:**
  - precreases in 201 groups and valley folds in 184;
  - inside reverse folds in 29;
  - swivels, mountain folds and unfolds in 14 each;
  - tucks in 7, squashes in 6, one rabbit ear.
- **Cost:** grouping takes 4.8 s over the whole corpus. The slowest model
  takes 1.3 s and the next 0.5 s, so Phase 2 caches results by state
  fingerprints and works them out off the first paint.
- **False positives:** the first 60 fold groups were checked by eye on a
  footprint sheet (each step's region over the state before it). Kite folds,
  blintz corners, squash pairs and two-flap folds all read as one book step,
  with no two regions overlapping. The precrease runs of 7–9 lines are the
  ones most likely to want splitting; the modal offers Split.

### Drawing a merged group

`foldRunCapture.ts` already draws a run as one step. It uses the picture
before the first step, carries each step's line and arrow into that picture's
frame (`actionSeenIn`), then onto its spread by the faces they lie on
(`marksCarriedOntoSpread`). That carry was safe because precreases move no
paper. For folds, independence makes it safe: a later step's paper is still
where the first picture shows it.

- `isMergeableRun` checks the document alone. It becomes the merge test, run
  on the scenes the capture already loads. The test accepts any group the rule
  finds, whether it started merged or was joined. If a run stops passing because
  its steps were edited, it reads as missing and keeps its stored picture, as a
  precrease run does today.
- `stepActions` takes any step's own `stepAction`, not only a precrease's. A
  Repeat's entries are drawn as they are today.
- Words: `foldDiagramMergedSentence` already says "Valley fold on both sides."
  for two folds. A group of more than two gives the count: "Valley fold in all
  four places."
- The stored source doesn't change. `through` already names a range, and link
  status, Refresh, Open in Fold, poses and the mark carry all read it. There is
  no reader version bump. An older build reads such a step's link as missing
  and keeps its picture.

### Cards show the Diagram step

Draft PR #586 already does this. Each card is captured the way Add captures it
(`captureFoldTarget` → `sentStep`) and painted like a Diagram card. Previews
are made lazily, one at a time as cards come into view, and cached.

The PR conflicts with main. Main has since landed parts of it separately: the
unspread fallback (74442273a, 1485453f6) and the crease-piece fix (d154eaf95).
What remains is the card previews and "every import starts spread". Bring the
PR up to date and land it first. A merged card's preview is the merged capture
(a `through` target), cached the same way.

### Merged and split cards in the modal

- **Merged.** One card, titled "Steps 7–10", with the merged step's picture
  and words. It is drawn as a small stack, with one or two card edges behind
  it, so it reads as several steps. **Split** sits in its header.
- **Split.** The group's steps appear as their own cards. A small **Join**
  button sits in the gap between neighbours that can merge, mirrored or
  turned. Joining one gap at a time also lets the user merge part of a group:
  7–8, then 9–10. The buttons show which steps can merge even while they are
  split, so steps 4–5 show one from the start.
- **The checkbox.** The bar's checkbox becomes **Merge symmetric steps**. It
  sets the starting state of mirrored groups and switches them all at once.
  Turned steps always start split. It is remembered under the same storage key
  as today. When nothing on the path mirrors, it is disabled and says why.
- **Starting state.** Each group starts as the diagram already has its steps
  (added merged, or one by one). Otherwise, mirrored steps start from the
  checkbox and turned steps start split.
- **How long choices last.** Choices last while the modal is open. Send steps
  to Diagram follows the checkbox, so it merges mirrors only.
- **Selection.** The selection follows its steps through a merge or split.
  Today any regroup resets it (`listKey` in `useFoldBrowser`).
- **Styling.** `stack` and `headerAction` are props on the shared pull card,
  styled in its module. The Join button goes in the Fold browser's module. No
  global CSS.
- **Mockup.** The owner approved the mockup of both states (2026-11-23). The
  build follows it: merged cards drawn as a stack with Split in the header, a
  round link button in the gap for Join, and the checkbox switching mirrored
  groups only.

### Analytics

`fold step sent to diagram` gains `merged_folds` (`none`/`some`) beside
`merged`. A new event, `diagram fold merge changed`, has `action`
(`split`/`join`) and `relation` (`mirror`/`turn`). It counts use of the
modal's controls, and whether people join turned steps, which tells us whether
turns should start merged later. Both are documented in `docs/analytics.md`.

## Affected Areas

- `apps/web/src/fold/repeat/repeatVerification.ts`:
  - the fold-angle option on the crease test
  - candidates from the creases a step changed (`changedCreases`)
  - the move test taking any isometry (true inverse; held-paper retry for
    reflections only)
  - `stepRelation`: mirror first, then turn
- `apps/web/src/diagram/fold/`:
  - `foldStepMerge.ts` (new). It replaces the pair logic in
    `foldPrecreaseMerge.ts`, `foldPrecreaseMirrors.ts` and
    `useFoldPrecreaseMerges.ts`.
  - `foldRunCapture.ts`, `foldDiagramSentence.ts`, `foldPull.ts`,
    `useFoldBrowser.ts`, `foldBrowserActions.ts`, `foldStepActions.ts`.
  - From #586: `foldPullPreviews.ts` and `useFoldPullPreview.ts`.
- `apps/web/src/components/diagram/`: `DiagramFoldBrowser.tsx` and its
  module; the shared pull card (`DiagramReferencesCard.tsx` and its module);
  `DiagramFoldCard.tsx` from #586.
- `apps/web/src/diagram/references/usePullSelection.ts`: keep the selection
  across a regroup.
- `apps/web/src/store/settingsStore.ts`: the label only, same key.
- `apps/web/src/analytics/` and `docs/analytics.md`.
- i18n catalogs (8 locales).

## Checklist

**Phase 0: cards show the step (#586).** This doesn't depend on Phase 1.

- [ ] Bring #586 up to date with main, keeping only what main lacks, and land it

**Phase 1: the rule**

- [x] Throwaway check of the rule on his file (results above)
- [x] Fold-angle option on `verifyCreases`; a wasm test shows Repeat's exact
      test refuses a corner folded across fresh paper and `angles` accepts it.
      Repeat's own suites pass unchanged
- [x] Candidates from the creases each step changed (made or refolded)
- [x] Turns through the move test (true inverse), in place of a separate turn
      test
- [x] `foldStepMerge.ts`: independence, group growth, `runRelation`,
      `startingRuns`, `isMergeableStep`. Unit tests
- [x] Wasm tests, synthetic (his file stays out of the repo), where steps
      merge: a cupboard fold, and four corners on a square creased so that two
      of them fold along old creases
- [x] Wasm test where steps are offered but not merged: a strip's two ends, a
      half turn apart
- [x] Wasm tests where steps don't merge: corners folded past the centre (each
      the other's image, yet one lands on the other), a turn-over between.
      Ends of a group by kind are unit-tested (`isMergeableStep`)
- [x] Wasm test: each merged group, folded in reverse order, lands the same
      paper in the same layer order
- [x] Run the rule over the Fold corpus and list every group (results above).
      Merged pictures come with Phase 2's capture; the review before the
      option is on by default happens then

**Phase 2: capture**

- [x] Run capture for folds (`foldRunCapture.ts`: a run is a Repeat run, or
      steps the scenes say repeat each other, checked again on capture so a
      stored run that stops qualifying reads missing), the count wording
      (`foldDiagramMergedSentence`), and link status and Refresh, which read
      the range through the capture
- [x] Session layer `foldStepMergeSession.ts` (replaces `foldPrecreaseMirrors.ts`
      and `useFoldPrecreaseMerges.ts`): scenes per landed step, grouping in
      slices off the main thread's way, a cache by state fingerprints that the
      capture shares
- [x] Send steps to Diagram uses the mirrored groups and Repeat runs
      (`foldPathMerges`); a real-bridge test sends the kite and gets its two
      flaps as one step, both lines and arrows, "Valley fold on both sides."

**Phase 3: the modal**

- [x] Mockup of merged and split cards, on his file's steps:
      https://claude.ai/artifact/3dmQfCFP1R9n5iJcSKUf9p
- [x] Owner's OK on the mockup (2026-11-23)
- [x] Merged card (stack edges, Split in the header), Join (mirrored and
      turned) on the card's edge, the checkbox (switches every mirror image
      and Repeat now, and is remembered), starting state (the reader's choice,
      else the diagram's, else the checkbox; turned copies apart), selection
      kept through a merge or split (`carryFoldSelection`). Layout is the pure
      `foldMergeLayout.ts`
- [x] Analytics (`merged_folds`, `diagram fold merge changed`); i18n
      (extract, translate 8 locales, stamp, check)

**Phase 4: checks**

- [x] Lint, typecheck, relevant vitest (488 files, 6103 tests: Diagram, Fold,
      analytics, styles, i18n), wasm tests
- [x] `npm run diagram-corpus`, before and after: diagram corpus: 0 of 420
      steps changed
- [x] Browser, on his file (dev server, synthetic drop): 2–3, 7–10 and 11–12
      open merged with their real Diagram steps on the cards; 4–5 and 14–15
      are offered with Join; Split on 7–10, then Join 7–8 and 9–10; Add of
      Steps 2–3 makes one Diagram step, both lines and arrows, "Valley fold on
      both sides.", its link up to date. Screenshots in the ignored
      `artifacts/fold-step-merge-check/`
- [x] Light theme and phone width (375px, coarse pointer), on his file. The
      phone found a fault: Split grew to the touch size, which cut a merged
      card's title to "Steps …" and made its header taller than the others',
      so a row's pictures no longer lined up. Now Split keeps its size, with a
      touch-sized hit area that reaches past it, and drops its word when its
      header is too narrow (a container query). Every header is 29px again
      and "Steps 11–12" fits
- [ ] Save and reopen in the browser (left to the range source's existing
      round-trip tests: the saved form of a merged step is unchanged)

## Open questions

- **Front and back.** "Repeat behind" is a mirror through the paper. Books
  draw it as one arrow plus a repeat-behind mark, not two arrows. Later.
- **Symmetric only as a whole.** A, B, then A′, B′ (two folds, then both
  mirrored) fails the step-by-step test. Later, if the corpus shows it.
