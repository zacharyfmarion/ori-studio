# Simulate patterns sidebar: the References look, and the References phone flow

## Goal

The Simulate workspace's "Patterns" rail draws each crease pattern as an inline
SVG string with its own palette — `--status-danger` mountains, dashed
`--accent-primary` valleys, a `--text-primary` border — with stroke widths in
viewBox units, so a 96-unit thumbnail stretched across a 200px card (or a phone)
comes out as thick orange lines with scaled dashes. The References workspace
draws the same list of the same patterns as classed `<line>` elements styled by
the crease tokens (`--fold-mountain`, `--fold-valley`, `--fold-unassigned`, a
`--text-tertiary` edge) at a non-scaling 1.1px, with an index chip and a crease
count under each card.

Two things to change, both to match References:

1. The cards: same thumbnail colouring and card chrome.
2. The phone: one screen at a time — the list of patterns first, a press on a
   card opening the simulator as a detail screen with a Back button — instead of
   a 200px rail beside a 175px simulator.

## Approach

Share rather than copy. The References card grid becomes a workspace-neutral
`SheetGrid` under a new `cp-workspace/sheets/` concern, and the References phone
flow's list/detail state becomes a generic `usePhoneListDetail` hook that both
workspaces wrap.

- **`cp-workspace/sheets/sheetThumbnail.ts`** — the thumbnail model
  (`SheetThumbnail`, strokes with a `border | mountain | valley | other` kind)
  and `fitSheetThumbnail`, the model-space → thumbnail-box fit both producers
  share. References feeds it `CpGeometryTransport` segments; Simulate feeds it a
  FOLD segment's edges (`segmentThumbnail` in `creasePatternSegmentation.ts`,
  beside the string renderer the export dialog keeps for its own palette).
- **`cp-workspace/sheets/SheetGrid.tsx`** — `ReferencesSheetGrid` moved and
  generalised: a `listbox` of `option` cards built from plain `SheetGridItem`s
  (id, thumbnail, crease count, refused). Classes renamed `.sheet-grid` /
  `.sheet-card…`; the base rules move *before* the phone media block so the
  phone rules can be unprefixed and serve both workspaces.
- **`hooks/usePhoneListDetail.ts`** — the screen choice stamped with the
  document revision, `openDetail`, `back`. `useReferencesPhoneFlow` keeps its
  API (and its exported pure predicates) on top of it; `useSimulatorPhoneFlow`
  is the Simulate wrapper: a list only when there is more than one pattern
  (the rail already hides itself for one), keyed on `foldArtifactRevision`.
- **`SimulatorSegmentsSidebar`** becomes presentation only — segments, the
  selected id and `onSelect` are props — so the panel can route a press through
  the flow, as `ReferencesSheetsSidebar` does.
- **`SimulatorPanel`** mounts the list or the detail on a phone, puts Back
  where the title was, and seats the touch Settings pill in its own toolbar
  (`trigger: 'slot'`, as References does) so the list screen carries no pill
  for a view that is not showing.
- Analytics: `simulator pattern opened`, phone-only, the References event's
  twin.
- i18n: the shared grid's strings move to `panels:sheets.*`; translations are
  carried over from the identical `references.sheets.*` strings.
- The size chip is worded by each rail (`SheetGridItem.size`), not counted by
  the card: References counts the document's lines, but a FOLD's edges are
  split at every crossing, so the same 9-line pattern would have read
  "9 creases" in one rail and "25 creases" in the other. Simulate says
  "12 faces" — what it folds, and the number its old title gave.

## Affected Areas

- `apps/web/src/cp-workspace/sheets/` (new): `sheetThumbnail.ts`,
  `SheetGrid.tsx`, tests.
- `apps/web/src/cp-workspace/references/`: `referencesSheets.ts`,
  `ReferencesSheetsSidebar.tsx`, `useReferencesPhoneFlow.ts` (+ tests);
  `ReferencesSheetGrid.tsx` removed.
- `apps/web/src/hooks/usePhoneListDetail.ts` (new, + test).
- `apps/web/src/simulator/useSimulatorPhoneFlow.ts` (new, + test).
- `apps/web/src/lib/creasePatternSegmentation.ts` (+ test).
- `apps/web/src/components/panels/SimulatorSegmentsPanel.tsx`,
  `SimulatorPanel.tsx`, `SimulatorPanel.test.tsx`, `ReferencesPanel.tsx`,
  `ReferencesPanel.test.tsx`.
- `apps/web/src/store/layoutStore.ts` (Simulate pill trigger),
  `components/WorkspaceViewDrawer.test.tsx`.
- `apps/web/src/styles/theme.css`, `apps/web/src/analytics/events.ts`,
  `docs/analytics.md`, `apps/web/public/locales/*`.

## Checklist

- [x] `sheetThumbnail.ts`: shared thumbnail model + fit, with tests.
- [x] `SheetGrid.tsx`: shared card grid; References sidebar builds its items.
- [x] `segmentThumbnail` for a FOLD segment, with a test.
- [x] `usePhoneListDetail` + `useReferencesPhoneFlow` on top of it; tests green.
- [x] `useSimulatorPhoneFlow`, with tests.
- [x] `SimulatorSegmentsSidebar` as presentation; `SimulatorPanel` phone flow,
      Back button, seated Settings pill.
- [x] Stylesheet: shared card rules, phone list rules for the Simulate rail.
- [x] Analytics event + doc entry.
- [x] i18n: new keys extracted, translated in all locales, stamped.
- [x] Validation: lint, typecheck, unit tests, i18n check; browser check at
      desktop and phone widths.

## Follow-up: the References rail, the other way round

Zach, on the first cut: the References rail should render as the Simulate
rail now does — one pattern per row — and "the bottom area of the left pane
in the references tab is useless".

- Both rails share one set of rules (`.segments-sidebar, .references-sidebar`
  in `theme.css`): 200px, header, then the cards filling the rest, one per
  row (`align-content: start`, or a tall rail stretches its rows into blank
  space under each card). The References rail was 260px with two columns and
  a 40% cap on the cards; both go.
- The bottom area held four hints — all already said by the lead under the
  toolbar ("Tap a vertex or crease…", "Working out the precreasing
  sequence…") — and diagnostics that are empty on a well-formed document:
  the frames analysis's warnings, the plan's "Lines with no exact fold" (with
  click-to-frame), "Sheets left out", and the output of *Crease Pattern ›
  Analyze references*. The hints are deleted (`referencesSidebarText` keeps
  only the warnings, `useReferencesTarget` no longer carries a hint). The
  diagnostics stay, but the notes box mounts only when one of them has
  something to say (`hasReferencesFindings`), capped at half the rail so the
  cards keep the larger half. On a clean document the rail is the cards alone.
- Not changed: the References rail still stays mounted for a single-sheet
  document, where Simulate's hides. Hiding it would leave the diagnostics with
  no home and would make the rail pop in when a plan reports a finding; if the
  single-sheet rail should go too, the notes need a home of their own first.

- [x] Shared rail rules, one column, no row stretch.
- [x] Notes only when there are any; hints deleted with their i18n keys.
- [x] Tests: `hasReferencesFindings`, the panel's phone list without notes,
      `referencesSidebarWarnings`.
