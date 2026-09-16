# References: find a reference, or read the sequence

## Goal

The References workspace does two jobs and leads with the expensive one. It
plans the whole precrease sequence on arrival, and it answers "how do I get
this point or crease?" only for what the current step has already folded —
so a crease made late in the sequence can be asked about only from the last
card. Its landing state on an empty pattern is scaffolding: an empty
filmstrip with two arrows, two actions written as prose, a settings column
for a plan that does not exist. Zach (2026-09-15):

> a lot of people will want instead of an entire folding sequence, like just
> a way to ask, like how do I get a specific point or line? … maybe it makes
> more sense to have … a state where it's like, hey, would you like to find
> arbitrary reference points or compute the precreasing sequence.

And the empty state "feels a bit weird". Both on a phone as much as on a
desktop.

## Approach

### A persistent mode, not a one-time question

A chooser is a modal you answer once and cannot find again, and on a phone a
full-screen dead end. So the choice is a segmented control at the top of the
pane, `Find a reference` | `Folding sequence`, and it also decides what the
canvas draws. Workspace view state (`referencesView.mode`), not a setting:
it is where the reader is, like the active step. The workspace **lands in
Find**, and a new document lands there again.

- **Find.** The whole pattern at full strength, every vertex and crease
  tappable, no filmstrip. A tap runs ReferenceFinder for that target on a
  blank sheet, which is today's targeted flow: the candidate's steps become
  the carousel, the paper shows the outline and the picked crease, and the
  target controls carry the way out. Nothing is planned in this mode.
- **Sequence.** What exists today, planned on demand: switching to Sequence
  runs the planner if the (revision, sheet) has not been attempted, with the
  same loop guard `useReferencesAutoPlan` already has. The plan is cached per
  pattern, so switching back and forth is free. The sheet shows only what
  has been creased so far, as it always did — drawing the creases still to
  come as ghosts was tried and Zach undid it: "you only want to see the
  creases up to the point that have actually been creased"; the whole
  pattern is Find's, where every crease can be pointed at. One thing does
  change: a tap on a crease the build-up has made **jumps to the card that
  made it**, and a tap on a vertex to the step that completed it. "Which
  step made this?" is a different question from "how do I get this from
  scratch?", and each mode answers one.

Leaving Find clears the pick (a target belongs to Find); entering Find keeps
the plan (a plan belongs to the pattern).

### Empty states that say what is true

- **A sheet with no creases** (the border only, which is what a new
  document is): "This sheet has no creases yet. Draw the pattern in Edit,
  then come back." with a button to Edit. No hint to tap anything, no plan
  attempted.
- **No filmstrip until there are cards.** Its slot holds one line — the lead
  — which is the mode's hint in Find, "Working out the folding sequence…"
  while planning, and a `Plan the folding sequence` button when a plan was
  stopped or failed and there is nothing to read.
- The settings pane is unchanged: on touch it is already the drawer behind
  the Settings pill, and on a desktop a dock pane is not in the way.

### Phone

The layout store already undocks the side panes under a coarse pointer and
`useReferencesPhoneFlow` shows the list and the detail one at a time, so the
phone detail is a single column: toolbar (Back, then the mode switch on a row
of its own), the lead or the carousel with its sentence, the sheet. What the
touch surface gains:

- **Fat targets.** The hit floors (`CP_LINE_HIT_MIN_CSS` 8, `CP_POINT_HIT_MIN_CSS`
  6) are pointer-precision minimums; under a coarse pointer they become
  finger-sized. The mark under the finger shows on touch-down and follows
  it, so the reader sees what a release will pick.
- **The carousel snaps.** Scroll-snap on the strip in the phone block, one
  card centred at a time.
- Pinch-zoom on the sheet already exists (`pinchTransform`).

## Affected Areas

- `store/workspaceStore/types.ts`, `slices/referencesSlice.ts` —
  `ReferencesView.mode`.
- `cp-workspace/references/referencesMode.ts` (new, pure: what each surface
  shows per mode), `useReferencesMode.ts` (new: binding, reset on a new
  document, analytics), `referencesStepIndex.ts` (new, pure: crease or vertex
  → the view step that makes it), `ReferencesModeSwitch.tsx`,
  `ReferencesLead.tsx` (new, presentation).
- `referencesCreaseVisibility.ts` — unchanged in the end: the ghosts were
  undone.
- `useReferencesAutoPlan.ts` — `wanted`.
- `ReferencesCpView.tsx`, `cp-workspace/snapRadius.ts` — coarse-pointer hit
  floors, the mark under the finger.
- `components/panels/ReferencesPanel.tsx` — composition only.
- `styles/theme.css` — the lead, the switch in the toolbar, the phone rows,
  scroll-snap.
- `analytics/events.ts`, `docs/analytics.md` — `references mode changed`,
  `references step jumped`.
- Locales (8) for the new strings; tests beside each module.

## Checklist

- [x] `referencesView.mode`, default `find`; reset on a new document.
- [x] Mode switch in the toolbar; leaving Find clears the pick.
- [x] Find: whole sheet, all pickable, no filmstrip, the lead's hint.
- [x] Sequence: planned on demand; tap-to-jump on the creases made so far
      (ghosts of the rest tried and undone); the lead while planning and
      when nothing is read.
- [x] Empty sheet: the message and the way to Edit; no plan attempted.
- [x] Phone: switch on its own row, coarse hit floors, the mark under the
      finger, carousel snap.
- [x] Analytics events and docs; locales; unit tests; the panel's hook-order
      test through the mode transitions.
- [ ] Zach tries it on a desktop and a phone.

## What landed (2026-09-15)

Verified in the pane on markhor: the workspace lands in Find with the hint
where the strip was and nothing running; a tap on the sheet's centre picks
the vertex and the target controls and its strip appear; switching to
Sequence clears the pick, says "Working out the folding sequence…" in the
lead and plans (163 lines in about ten seconds), then the cards; a tap on
a crease the build-up has made jumps the strip to its card; back to Find
the sheet is whole again, and back to Sequence the plan is there at once.
The mode switch is the header, drawn as the Design workspace's tabs, and
the "References" title is gone. On the phone viewport the list opens the detail with Back
on the first toolbar row and the switch full-width on the second (44 px
options), the strip is the cards alone with scroll-snap, and touch taps
jump to the making step (cards 48, 112 and 2 from three spots).

**A Find card is a ReferenceFinder diagram, not a step** (2026-09-15, from
the sheet centre of a square with both diagonals: "steps 2 and 3 are
exactly the same. Same with 4 and 5, 6 and 7, and 8 and 9"). The core's
`steps` has an entry per reference, folds and marks alike, but it draws one
diagram per fold and puts the mark that fold is for in the same picture
(`refBase.cpp` `DrawDiagram`), so a card per step borrowed every fold's
picture twice. `referencesCandidateSteps.candidateViewSteps` now groups the
steps as the core draws them — a fold with the mark right after it, unless
that mark is the last step, which keeps its standalone diagram; a mark made
before any fold or the second of two in a row reads with the next fold,
whose diagram is the first to draw it — and the card's sentence names
everything its picture introduces, the pinch note last. The runner-up went
from ten cards to six, every picture distinct, and a fixture sweep asserts
one card per diagram for every captured solution.

**Approximate answers are listed only when asked for.** The same runner-up
was a rank-6 construction landing 0.00024 off the centre, pinching a
"corner" a quarter of a thousandth from the real one ("6 and 7 appear to be
establishing a reference point for the corner of the paper, which does not
need a reference point... its the corner"). The core keeps one reference per
position, so for a target it constructs exactly the candidates after the
exact one are always such near misses; `goodEnoughError` only changes their
order. "Include approximate solutions" promised exact-only answers and did
not filter, so now (`referencesShownCandidates`) with it off an inexact
candidate is listed only when nothing exact exists, and with it on every
candidate is, in the core's order. The target row's count also said "9
folds" for that answer — it counted steps, marks included — and now says
the extractor's `foldCount`, 5.

Verified in the pane on the debugging square: the centre with the setting
off is "Solution 1 of 1", exact, three cards (the two diagonals, then the
mark); with it on, "Solution 2 of 5" is six cards with six pictures, each
fold's card naming its mark before the pinch note and the final mark on its
own.
