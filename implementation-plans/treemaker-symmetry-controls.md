# TreeMaker Symmetry Controls

## Goal

Simplify the tree-design symmetry controls in the Design viewport toolbar so that
symmetry is a single on/off toggle, its configuration lives behind a separate
options button, and the axis number fields are actually styled.

Three concrete problems with the control as it shipped:

1. `.symmetry-menu__field` has no CSS rule at all, so the Angle/X/Y number
   inputs render as unstyled native controls (huge white boxes) inside a dark
   popover.
2. The popover asks the user to reason about three toggles — *Enable symmetry*,
   *Show axis*, *Mirror nodes* — that in practice are one decision. There is no
   useful state where symmetry is enabled but the axis is hidden, or where the
   axis is drawn but node edits do not mirror.
3. The one control that is a mode toggle (symmetry on/off) is buried two clicks
   deep, while the configuration a user touches once per document (preset, axis
   angle and position) is on the top level of the same popover.

## Approach

Split the single `DesignSymmetryMenuButton` into two toolbar controls, matching
the shape Box Pleating Studio uses for mirror-draw and the shape `BpTreePanel`
already uses in this repo:

- **Symmetry toggle** — a labelled pill that turns symmetry on and off. On means
  the project carries a symmetry line, the axis is drawn, and node edits mirror.
  Off clears all three.
- **Symmetry options** — an icon button opening a popover that holds only the
  preset grid (Book / Diag / flip) and the axis fields (Angle / X / Y).

### One source of truth for "symmetry is on"

Today symmetry-on is spread across three pieces of state that can disagree:
`project.hasSymmetry` (document state), `toolMode === 'symmetry'` (mirror
editing), and `layers.symmetry` (axis visibility). Loading a `.tmd5` with
symmetry set, for example, restores `hasSymmetry` but resets `toolMode` to
`select`, so the axis draws while node edits silently do not mirror.

Collapse mirror editing onto the document fact: `mirrorMode` derives from
`project.hasSymmetry`. `ToolMode`'s `'symmetry'` member becomes dead and is
removed rather than left as a second, drifting source of truth for the same
question. `layers.symmetry` stays a view-layer override in the Layers menu
alongside Paths/Circles/Labels, and enabling symmetry force-shows it, exactly as
the current code already does.

### Styling

Add the missing `.symmetry-menu__field` rule next to the sibling
`.bp-sheet-menu__input` rule that already styles the equivalent BP control, so
the two popovers agree: label on the left, tabular-numeral input on the right,
themed border and focus ring, and no native number spinners.

## Affected Areas

- `apps/web/src/components/panels/DesignPanel.tsx` — split the symmetry menu
  button into a toggle plus an options popover; derive `mirrorMode` from
  `project.hasSymmetry`; drop the `setToolMode` wiring.
- `apps/web/src/styles/theme.css` — add `.symmetry-menu__field` and its input
  styling; style the new options button.
- `apps/web/src/lib/sampleProject.ts` — drop `'symmetry'` from `ToolMode`.
- `apps/web/src/components/panels/DesignPanel.test.tsx` — cover the new toggle
  and options split.
- `apps/web/public/locales/*/panels.json` — retire the removed strings, add the
  new ones, translate for all eight locales.

## Checklist

- [x] Read the existing symmetry control, its store wiring, and the BP tree
      panel's mirror-draw button
- [x] Write this plan
- [x] Add the missing `.symmetry-menu__field` CSS and style the options button
- [x] Split the toolbar control into a Symmetry toggle and a Symmetry options
      popover
- [x] Derive `mirrorMode` from `project.hasSymmetry` and remove the dead
      `ToolMode` member
- [x] Update `DesignPanel.test.tsx` for the new control shape
- [x] Run `npm run i18n:extract`, translate the eight locales, `npm run i18n:stamp`
- [x] Validate: `i18n:check`, lint, typecheck, web unit tests
- [x] Open a draft PR against `main`
