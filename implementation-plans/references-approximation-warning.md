# References: warn when a sequence contains approximated folds

## Goal

A precreasing sequence with an approximate step — a line folded by the closest
construction ReferenceFinder found rather than an exact one, or a step sighted
from such a line — says so on the card, and the summary strip counts them. That
is easy to read past. A crease pattern that came out of Detect CP from Image can
be a hair off its lattice everywhere, in which case every reference the sequence
builds is approximate and the folder should check the reference points against
the design before trusting them. Say so once, up front, in a modal the reader
has to dismiss.

## Approach

- **Decision, not presentation, in a hook.**
  `cp-workspace/references/useReferencesApproximationWarning.ts` watches the
  plan summary the store holds and opens the warning once per summary with
  `inexactSteps > 0` — keyed on the summary's identity, which every run
  replaces, so a plan with no approximations, the same plan re-rendered, or a
  dismissed warning never re-opens it, and a new plan with approximations does.
  Dismiss closes it; no plan closes it.
- **The dialog is a child component** using the existing `simple-modal` shell
  (`SelectByIndexModal` is the reference): `role="alertdialog"`, a title with the
  warning icon, the message, one "Got it" button; Escape and the backdrop
  dismiss. Copy: *"This sequence contains approximated folds. If this crease
  pattern came from Detect CP from Image, the detection may have converged on
  an inaccurate solution. Please verify that any reference points are
  correct."*
- **A second reason: the plan stopped rather than approximate.** When more
  lines are left without an exact construction than a sequence can carry as
  reference creases, the planner stops (`too_many_approximations`) before
  folding any of them, and the same modal opens with failure wording —
  *"Planning failed because a huge number of reference creases would be
  necessary to fold this pattern within error tolerances. If this crease
  pattern came from Detect CP from Image, …"* The hook reports `reason`
  (`inexact` / `too_many`) from the summary's `stopReason`; the dialog picks
  its title and message by it.
- **Mounted from `ReferencesPanel`** (a composition site: the hook call and the
  element, nothing else).
- **Analytics**: `references approximation warning shown`, fired from the
  dialog through a `use*Event` hook in `analytics/`, with
  `inexact_steps_bucket` and `exactness_class` — enums and buckets only.
- **i18n**: three keys under `dialogs:referencesApproximationWarning.*`,
  extracted, translated into the eight locales, stamped.

## Affected Areas

- `apps/web/src/cp-workspace/references/useReferencesApproximationWarning.ts`
  (+ test), `ReferencesApproximationWarningDialog.tsx` (+ test)
- `apps/web/src/analytics/useReferencesApproximationWarningEvent.ts` (+ test),
  `analytics/events.ts`
- `apps/web/src/components/panels/ReferencesPanel.tsx`
- `apps/web/public/locales/*/dialogs.json`, `.hashes.json`

## Checklist

- [x] Hook: opens once per plan summary with inexact steps; dismiss; tests.
- [x] Dialog: `simple-modal` shell, copy, Escape/backdrop; test.
- [x] Analytics event and hook, with a `createRoot`/`act` test.
- [x] Mounted in `ReferencesPanel`.
- [x] Locales extracted, translated, stamped; `i18n:check` passes.
- [x] Seen in the browser on glaucus (22 inexact steps → modal; Got it closes it
      and it stays closed), and not on an exact square (0 inexact steps).
- [x] Failure variant: hook `reason`, dialog copy, analytics `reason`; tests.
- [x] Seen in the browser on glaucus once the planner stops early: 5.8 s,
      0 of 332 creases, the "Planning failed" modal up; Got it closes it.
