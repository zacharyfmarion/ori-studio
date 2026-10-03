# Pattern identity: a pattern is its creases, not its place

## Goal

Moving a crease pattern on the canvas changes no crease, so nothing that
points at the pattern should stop matching. Today every link remembers *where*
its pattern was:

- a Diagram step finds its sheet by its rim at its exact canvas position (to
  1e-6), so a move reads **Pattern missing**; and its fingerprint hashes
  absolute coordinates, so even a found sheet would read **Out of date**;
- an Edit folded figure (and an inline simulation window) keeps a box on the
  canvas, so a move reads **stale**, and Refold folds whatever sits in the old
  box;
- a References plan is keyed by its sheet's absolute box and origin and by
  each crease's position and *line number*, so a move replans the sheet, and
  moving one sheet can invalidate others.

The rule this plan establishes, decided with Zach on 2026-10-03:

> A pattern is its creases relative to its own outline. A link stops matching
> only when a crease changes. A move is not a change; a rotation or a flip is.

This PR applies it to the **Diagram** (its file format has not shipped, so it
has to be right before it does). Edit's folded figures and simulation windows,
and the References plan cache, follow in their own PRs on `main`; each keeps
its own versioned format, so each moves on its own schedule.

## Approach

Two questions, answered separately.

**Did the creases change?** A **relative fingerprint** (`rc1:`) over a set of
lines: each endpoint taken relative to the set's own lower-left corner (the
minimum x and y over its endpoints), rounded to 2^-20 of the set's size, the
two endpoints of a line in a canonical order, plus each line's colour, custom
colour and fold magnitude. Sorted and digested with `keyDigest`, as `cs1:` is.
A translation changes none of it — the rounding absorbs the floating-point
noise a drag leaves — while any crease that moves relative to the others, any
recolour and any change of angle does. The step is a power of two, not 1e-6:
a pattern's coordinates are dyadic fractions of its size, and a decimal step
put the odd multiples of 1/128 exactly on a rounding boundary, where a drag's
noise picked the side (found in review: a quarter of all drags of a
128-division grid changed the fingerprint). Being taken from the lines alone,
not from the segmentation's traced rim, it does not depend on how the rim was
traced.

**Which sheet is it?** In order:

1. The sheet still at its **old position** (the existing absolute rim match):
   unchanged, or edited there and so out of date. Its own place wins over an
   identical copy elsewhere — a sheet edited beside an untouched duplicate of
   it is out of date, not silently the duplicate.
2. Otherwise a sheet of the same outline **shape** (the existing ring
   comparison — corners, any start, either winding — after taking each ring
   relative to its own lower-left corner) whose creases have the remembered
   relative fingerprint: **moved, unchanged**. Several (identical sheets): the
   one nearest to where it was; they draw the same picture.
3. Otherwise **missing**. A sheet that moved *and* changed cannot be told from
   one deleted beside another of its shape, so it is not guessed at:
   regionReference's rule that a link never silently re-points at another
   pattern stands. Relink picks it again. (A first version also took "the only
   sheet of that shape"; review showed it re-pointed a step whose sheet was
   deleted at an unrelated one, so it went.)

A rotation or a flip changes the outline's shape (a rectangle) or the creases
relative to it (a square), so it reads out of date, or missing; it is never
mistaken for the same pattern — unless it maps the creases onto themselves (a
square with only its diagonals, turned a half), when nothing a picture shows
has changed, and it reads current.

**Persisted.** Each Diagram link keeps what it kept (its rim at the position it
was taken, and a fingerprint), and the fingerprint now names its algorithm:
`rc1:` relative. Every fingerprint is read by its prefix. A `cs1:` value (a
Diagram file saved in this branch before this change) is compared the old way,
absolute, and is never used to recognise a moved sheet; its next capture
writes `rc1:`. Nothing is migrated. Line ids could later be added as a hint
ahead of step 1 without changing any of this.

**Following a move.** A capture (Refresh, Show as, a Pose verb) of a step found
somewhere else re-anchors its link to where its sheet is now, so Open in Edit
and Open in References go to the sheet, not to its old place. Link status
never writes: it is derived on every render, as today.

## Affected Areas

- `apps/web/src/cp-workspace/regions/regionIdentity.ts` (new, shared): the
  relative fingerprint, the shape comparison, and the resolver. No Diagram
  dependency, so Edit and References can adopt it.
- `apps/web/src/diagram/capture/captureCreases.ts`: `chooseStepCreases` takes
  what the step remembers (`KnownCreases`) and resolves through the new rule;
  fingerprints become `rc1:`; a stored `cs1:` is compared the old way.
- `linkStatus.ts`, `captureFolded.ts`, `poseController.ts`,
  `stepCaptureActions.ts`, `captureQueue.ts`, `diagramCapture.ts`: pass the
  remembered creases; re-anchor on capture.
- `useDiagramPatternSheets.ts`, `useDiagramSimulatedPose.ts`,
  `referencesStepActions.ts`, Open in Edit: find the sheet where it is now.
- The References browser's Replace (the held Phase 9 review finding): open on
  the step's sheet as it is now when its plan id is no longer listed.

Not in this PR: `foldedFigureStaleness.ts` / folded figures, inline simulation
windows, the References plan cache key (`referencesPlanCache.ts`).

## Checklist

- [x] `regionIdentity.ts`: `relativeCreaseFingerprint`, `boundariesMatchMoved`,
  `resolveMovedRegion`, with unit tests: a translation (with last-bit noise)
  keeps the fingerprint; a moved crease, a recolour, an angle and a rotation
  change it; the resolver's five cases, identical sheets, and a deleted sheet.
- [x] The Diagram resolves through it: `chooseStepCreases(…, known)`,
  `rc1:` fingerprints, `cs1:` compared absolutely; link status cached per
  remembered fingerprint.
- [x] Captures pass what the step remembers and re-anchor a moved link
  (`followedScope`, in `captureStep` and Pose's `linkedSource`).
- [x] Open in Edit, Open in References, the pattern picker's selected sheet and
  Simulated Pose find the sheet where it is now (`stepSheet`, `stepSheetNow`).
- [x] Replace from References… opens on the step's sheet when its plan id is
  gone (held review finding): `sheetPattern`, by the step's sheet as it is now.
- [x] Tests: link status and capture over a translated two-square pattern —
  whole pattern moved (current), moved and edited beside a square of its shape
  (missing), edited in place (stale), an absolute fingerprint compared the old
  way; Open in Edit and Open in References after a move.
- [x] Browser, before the review's fixes (`artifacts/pattern-identity/move.mjs`, `crane-50.osf`: 50 steps
  on 11 identical 400 × 400 sheets, every step re-captured first), the same
  script before and after:

  | | before | after |
  | --- | --- | --- |
  | every line dragged by (137.3, −42.1) | 50 Pattern missing | 50 current |
  | dragged back by hand | 48 Out of date | 50 current |
  | a crease of one sheet recoloured in place | — | that sheet's 5 steps Out of date |
  | the recolour undone | — | 50 current |

  Every step found its own sheet among eleven of one shape, by its creases.
  `move-{before,after}-*.png` beside the script.
  - A step saved before this change keeps a `cs1:` fingerprint, which cannot
    recognise a moved sheet: moved among sheets of its shape it reads missing
    until it is captured again (Show as, Relink, or Refresh once edited). Only
    Diagram files saved in this branch hold one.
- [x] Review, and its fixes committed. Four reviewers (the module, the
  Diagram's use of it, compatibility, the tests), each finding put to a
  skeptic: 15 confirmed, 9 distinct; 1 refuted. Fixed:
  - The rounding step: 2^-20, not 1e-6 (above). A test over a 128-division
    grid off the origin, with deltas that really perturb the relative
    coordinates (asserted), fails on the old step and passes on the new.
  - "The only sheet of its shape" went: it re-pointed a step whose sheet was
    deleted at another of that shape. And the in-place sheet now wins over an
    unchanged identical copy elsewhere.
  - A Pose turn of a moved crease-pattern step carried no annotations: the
    capture re-anchors the scope, which the carry compared as JSON. A crease
    pattern is drawn about its paper's centre, so a moved outline of the same
    shape is the same picture (`sameRegion` in `annotationCarry.ts`); a folded
    picture sits where its sheet sits and keeps the strict test.
  - A step that keeps a `cs1:` fingerprint: Pose keys its live 3D view by it
    while it matches (the view never showed), and a Pose capture keeps it while
    it matches over the same lines, so a turn carries its annotations; Show
    as, Refresh and Relink write `rc1:`.
  - Replace from References… falls back to the step's stored rim when the
    segmentation is not worked out yet.
  - Tests that could not fail: the in-place scope test (now a stale id hint a
    re-anchor would replace), the nearest-of-identical test (nearest listed
    first, middle and last); a Pose verb on a moved step, the carry test, a
    deleted-sheet test and the Replace sheet fallback added.
- [x] Follow-ups written up for `main`, as task chips with self-contained
  briefs: Edit folded figures and simulation windows (their figure follows its
  pattern, and Refold folds it where it is — Zach to confirm both first, a
  documented deviation from Oriedita's box re-select; the figures' stored line
  numbers re-derived), and the References plan cache key (frame size and a
  relative crease fingerprint, `ps2:`; the plans' crease numbers re-mapped by
  geometry on restore; plans mapped through the live frame everywhere).
