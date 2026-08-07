# Box Pleating and ExplOri UI fixes

## Goal

A batch of small UI corrections across the Box Pleating attribution footer and
the ExplOri design surface, so both read as part of the same design system:

1. Drop the donate link from the Box Pleating attribution footer.
2. Send to Edit gets a send icon; the scan icon it had describes a different verb.
3. ExplOri result cards gain a hover state, matching the start screen's cards.
4. ExplOri results get a real empty state and a spinner while a search runs.
5. The match-quality pill matches the height of the icon buttons beside it.
6. The detail header sticks to the top of the pane and its rule spans the pane.
7. "Open in ExplOri" is built from the button primitive rather than hand-styled.

## Approach

- Footer: remove the donate anchor from the `bp` branch only and update the
  `panels:design.attributionBoxPleating` `<Trans>` key in all nine locales. The
  ExplOri donate link stays — the request was about Box Pleating Studio.
- Icon: `ScanLine` → `Send` at every Send to Edit call site (workspace toolbar,
  ExplOri detail header, ExplOri card quick-send). The `Edit CP` buttons in
  `DesignPanel` / `ConditionsPanel` keep `ScanLine`; they are a different action.
- Card hover: `.explori-result-card` picks up the `.start-action` hover
  treatment (accent-tinted border and fill), driven by `:hover`/`:focus-within`
  so keyboard focus on the card's open button reads the same as the pointer.
- States: add `searched` to `ExploriDesignState` so "not searched yet" and "no
  matches" are distinguishable, and render three states — spinner, empty, no
  matches — from one `ExploriResultsStatus` component.
- Quality pill: give `.explori-quality` the 28px height of a `sm` control so the
  detail header is one row of equal-height controls.
- Detail header: `position: sticky` with the pane's background, and negative
  inline margins equal to the pane's padding so its bottom rule is full-bleed.
- Link button: export the button `cva` from `Button.tsx` and add `ButtonLink`,
  an anchor wearing the same classes, so a link that acts as a button is not a
  second visual language. `.explori-detail__upstream` goes away.

## Affected Areas

- `apps/web/src/components/DesignAttributionFooter.tsx`
- `apps/web/src/components/WorkspaceShell.tsx`
- `apps/web/src/components/panels/ExploriResultsPanel.tsx`
- `apps/web/src/components/ui/Button.tsx`
- `apps/web/src/store/workspaceStore/designContent.ts`
- `apps/web/src/store/workspaceStore/slices/exploriSlice.ts`
- `apps/web/src/styles/theme.css`
- `apps/web/public/locales/*/panels.json`

## Checklist

- [x] Remove the donate link from the Box Pleating attribution footer
- [x] Swap the Send to Edit icon to a send icon at every call site
- [x] Add hover/focus states to ExplOri result cards
- [x] Add the searching spinner and empty/no-match states
- [x] Match the quality pill height to the icon buttons
- [x] Make the detail header sticky with a full-bleed rule
- [x] Rebuild "Open in ExplOri" from the button primitive
- [x] Update all locale catalogs and run `i18n:check`
- [x] Lint, typecheck, and unit tests
