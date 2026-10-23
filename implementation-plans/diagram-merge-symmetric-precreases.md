# Merge symmetric precreases into one Diagram step; drop Fold's Steps tab

## Goal

Two owner requests for the Fold launch (PR #475):

- **(A) Merge symmetric precreases.** Books draw a precrease and its mirror
  image as one step ("fold and unfold on both sides"); Fold records them as
  two — a precrease and a Repeat of it, or two precreases that mirror each
  other. Importing into the Diagram (the From Fold… browser and Fold's Send
  steps to Diagram) gets an option, on by default and remembered per user, that
  makes each such run one Diagram step: the picture before the first step,
  every merged step's crease marks and fold-and-unfold arrows, no "Repeat on
  the right" callout, one generated instruction, one number.
- **(B) Remove Fold's Steps tab.** Its cards looked like the Diagram's steps
  and are not; Fold keeps one view, the fold on screen under the strip.

## Approach

### What merges (`diagram/fold/foldPrecreaseMerge.ts`)

Only precreases (`op.kind === 'precrease'`, whole line, segment or pinch):
they leave the folded form as it was, so every crease belongs on the one
"before" picture. Nothing that moves paper is ever merged.

1. **Precrease(s) + Repeat.** A run of precreases immediately followed by a
   Repeat whose source range is exactly that run (`source.first`..`last`, the
   Repeat folding from the run's last step) and whose every entry is a
   precrease: the run and the Repeat are one step. Document-only: the Repeat
   verified its mirror when it was prepared.
2. **Mirrored pair.** Two consecutive precreases where the second is the
   first mirrored across a verified symmetry axis of the state before them:
   Repeat's own geometry, not a second test (`mirroredStepAxis`). The axes
   tried are the one or two reflections that take the first step's newest
   crease line onto the second's, kept only where each step's creases,
   reflected, lie along the other's — a cheap filter, so a run of grid
   precreases costs next to nothing — and each is then checked as Repeat
   checks the axis it is given (`verifiedSymmetry`) and as a prepared Repeat
   checks each mirrored step (`verifyMaterial`), over the scenes the session
   already holds. Greedy left to right, a step in one group only, Repeat
   groups first.

The browser draws a group as one card ("Steps 3–4", the last state's picture,
the merged sentence), so the card list is the Diagram steps Add makes. The
toggle sits in the browser's bar beside Open Fold, disabled (and saying so)
when the sequence has nothing to merge. Send steps to Diagram (the path) uses
the same remembered setting; Send step (one step) sends that step alone.

### The merged step

- Picture: the state before the first step (`moment: 'before'`).
- Marks: each merged step's line and arrow (`foldStepMarks`), all on that
  picture — a precrease's from its own `stepAction`, a Repeat's entries' from
  `action` on the states they fold from — carried into the first state's view
  frame. A Repeat in a merged step brings no callout.
- Thumbnail: the last state's crease pattern; the crease pattern shown draws
  every merged step's creases as the instruction.
- Instruction: the originals' sentences (every merged step but the mirror),
  then "Do this on both sides." — one key taking the sentences whole, as a
  partial precrease's extent sentence does. Stored as the source's `sentence`,
  so it stays editable and a refresh follows it while it is unedited.

### The source names a range

`DiagramFoldStepSource` gains `through?: string`: the last Fold step the
picture draws, when it draws more than one. `step` stays the first, so a
single step reads exactly as before. `path` is the last step's `fh1` (which
covers every step above it, so a change to either step makes the link stale);
`state` is the `fs1` of the state before the first. A range is always
`before`. The reader takes `through` as a known field (a file with a field it
does not know still carries the step locked); a range that is not one (same
id, `after`, empty) does not read. The project reader version is unchanged.

Every consumer reads the range through the source: link status (the last step
must fold from the first, its replay landed), Refresh / Refresh all, Flip
creases and every pose (the capture request carries `through`), the pose
drag's inputs, the carry of marks between captures, Open in Fold (the last
step: the state the instruction leaves), and "In diagram" on the browser's
cards.

### Preference and analytics

`settingsStore.diagramFoldMergePrecreases`, stored under
`diagram-fold-merge-precreases`, absent = on (the `diagramReferencesMarks`
pattern: no event of its own). `fold step sent to diagram` gains
`merge_precreases` (`on`/`off`) and `merged` (`none`/`some`), documented in
`docs/analytics.md`.

### (B) Steps tab

Delete `fold/sequence/foldViewMode.ts`, `components/fold/steps/FoldStepsGrid.*`,
`fold/sequence/foldGridEntries.*`, the header's tabs, the panel's view switch,
the `fold view switched` event and its docs row, and every `setFoldView('fold')`
caller's line. The shared `components/ui/steps/` grid stays (the Diagram and
References use it). Strings go through `i18n:extract`.

## Affected Areas

- `apps/web/src/diagram/fold/` — merge detection, capture of a range, link
  status, pull targets and cards, browser hook, send.
- `apps/web/src/fold/repeat/repeatVerification.ts` — the mirrored-step check
  over Repeat's own functions.
- `apps/web/src/diagram/document/diagramDocument.ts`, `diagramFile.ts` — the
  range source.
- `apps/web/src/diagram/annotate/annotationCarry.ts` — same link, same range.
- `apps/web/src/components/diagram/DiagramFoldBrowser.tsx` (+ module) — the
  toggle and the merged card.
- `apps/web/src/store/settingsStore.ts`, `lib/storage.ts` — the preference.
- `apps/web/src/analytics/`, `docs/analytics.md`.
- (B) `components/fold/FoldHeader.tsx`, `components/panels/FoldPanel.tsx`,
  `fold/sequence/foldViewMode.ts`, `components/fold/steps/FoldStepsGrid.*`,
  `fold/sequence/foldGridEntries.*`, callers of `setFoldView`.
- i18n catalogs (8 locales).

## Checklist

- [x] (B) Remove the Steps tab, its view state, grid, entries, event, strings
- [x] (B) Tests and docs updated; ratchet checked (no global block went: the
      grid's styles were a module)
- [x] (A) Range source: type, reader, `storedFoldStepSource`, round-trip tests
- [x] (A) Mirrored-step check over Repeat's geometry, with wasm tests
- [x] (A) Merge groups (pure) + verification (session), with tests
- [x] (A) Capture of a range: picture, marks, thumbnail, sentence
      (`foldRunCapture.ts`; a Repeat's later steps are drawn on the states
      the steps before them land, landed on the way and let go)
- [x] (A) Link status, refresh, Open in Fold, pose, carry for a range
- [x] (A) Browser cards merged, toggle, preference; Send steps uses it
- [x] (A) Analytics property + docs
- [x] i18n extract, translate 8 locales, stamp, check
- [x] Lint, typecheck, relevant vitest
- [x] Browser check: merge on/off via the browser and Send steps; save and
      reopen (the save picker stubbed, the file opened by a synthetic drop);
      Fold without the Steps tab, light/dark, desktop/phone —
      `artifacts/fold-launch/merge-precreases/`

## Notes

- A Repeat is prepared on the state before it, by fingerprint; Front up /
  Back up mirrors that state, so the Repeat no longer folds until it is
  rebuilt, and a merged step drawn from it reads **missing** meanwhile, as a
  single step linked to that Repeat does. A mirrored pair goes **stale** and
  refreshes as one run.
- Send step to Diagram (one step) sends that step alone, whatever the
  option: merging it with the step before would send a step not on screen.
