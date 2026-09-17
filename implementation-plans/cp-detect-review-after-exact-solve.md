# Detect CP: Review & Fix after an exact solve

Offer the Review & Fix path — the recognized candidate in the Edit workspace,
with the rectified image behind it and the solver data attached — even when the
detect dialog's own solve came out exact.

## Goal

Today the staged flow (`implementation-plans/staged-recognize-and-solve.md`)
runs the solve itself whenever recognition flags nothing, and on an exact result
offers exactly one terminal button, **Add**. Review & Fix — the only way to pin
or move vertices before solving, and so the only way to *constrain* the solve —
is offered only when something went wrong: a flagged topology, a rejection, an
ambiguous acceptance, a timeout, or a stop.

That leaves a real gap. A solve guarantees a pattern that folds flat, not the
one the designer drew (the dialog says so itself), and the way to get the drawn
one is to pin the vertices that matter and solve again. A clean solve is the
state in which that is *most* worth doing, and it is the one state that hides
the door. The workaround — press Stop during a sub-second solve — is neither
discoverable nor reliable.

## Approach

- `availableImportModes` returns `{ primary: 'add', secondary: ['reviewAndFix'] }`
  for an exact solve, instead of `secondary: []`. Add stays primary: the solve
  succeeded and nothing about that changed.
- Review & Fix keeps its one meaning. It adds `recognition.foldJson` — the
  candidate **as recognized**, not the solved document — plus the underlay and
  the check-suppression region carrying the `ExactSolveInput`, exactly as it does
  after a failure. The user asked to change things *before* solving, and the
  region's Solve rebuilds its input from what is on screen, so the candidate is
  the right starting point and a second mode would be a second name for the
  same destination. No new `ImportMode`.
- The exact verdict gains a closing sentence that says what the second button
  is for, as a new i18n key (`cpDetectImport.verdict.exactReview`) rather than a
  reword, so the eight existing translations of `verdict.exact` stay valid.
- Analytics need no new event: the `handleMenuAction`-independent
  `cp detect imported` event already carries `mode` and `outcome` separately,
  so `mode: reviewAndFix` with `outcome: solved` is the new path, and
  `docs/analytics.md` names that reading.
- Nothing is offered while the solve runs. Stop → Review & Fix already covers
  "I know I want to steer it"; a button that adds an about-to-change pattern is
  the trap the staged flow was built to remove.

## Affected Areas

- `apps/web/src/components/CpDetectImportModal.tsx` — `availableImportModes`,
  the exact verdict sentence, the mode docstrings.
- `apps/web/src/components/CpDetectImportModal.test.tsx` — the clean-solve test
  and a new one for what Review & Fix adds after an exact solve.
- `apps/web/public/locales/*/dialogs.json` (+ `.hashes.json`) — one new key in
  nine catalogs.
- `docs/analytics.md` — the `cp detect imported` row.
- `implementation-plans/staged-recognize-and-solve.md` — the flow diagram.

## Checklist

- [x] Offer `reviewAndFix` as a secondary mode on an exact solve.
- [x] Explain it in the exact verdict, under a new key.
- [x] Tests: the clean-solve screen offers both; Review & Fix after a solve adds
      the candidate with the underlay and region, and reports
      `mode: reviewAndFix, outcome: solved`.
- [x] i18n: extract, translate the new key into all eight locales, stamp, check.
- [x] Docs: analytics row and the staged-flow diagram.
- [x] Validate: `npm run lint:web`, `npm run typecheck:web`, the modal's tests,
      `npm run i18n:check`.
