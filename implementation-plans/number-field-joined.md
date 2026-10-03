# NumberField: one joined field, with the unit inside

## Goal

The stepper (`components/ui/NumberField.tsx`) draws as a single control. The −
and + sit flush against the number, with no gap between the three parts and no
rounded inner corners. A vertical line separates each button from the number.
A unit (`mm`, `dpi`, `°`, `%`) reads inside the field after the number, as a
read-only suffix, instead of sitting outside it next to the + button.

Requested 2026-10-02, with a screenshot of the Edit View pane's Grid size
stepper (`− [ 8 ] +`, three separate boxes).

## Approach

`NumberField`'s styles are global (`theme.css`), and three other screens
restyle them: the export dialog's rows, Settings ▸ Paper's pen cards, and the
tool card, which excludes the field's input by class. That makes it a shared
block, so it moves into a module in a PR of its own (`AGENTS.md`, "Migrate
what you touch"). This is that PR, in two commits.

1. **Move. Nothing on screen changes.** `NumberField.module.css` takes the
   whole block: the field, the input's floor and spinners, the step buttons and
   their states, the unit, and the coarse-pointer step sizes. The other
   screens' overrides become things `NumberField` offers:
   - Settings ▸ Paper's pen card restyled the field into one joined frame on
     the settings well, 28px tall, with a centred mono number. That becomes
     `variant="card"`.
   - The export dialog placed the field with `> .number-field`. `className`
     now lands on the field's root (for a bare input, that is the input), and
     the dialog passes its own class there.
   - The export dialog also gave the input a four-character floor. That
     becomes `minChars={4}`, written in `ch` like the rule it replaces.
   - The tool card's `input:not(.number-field__input)` becomes
     `input:not([data-number-field])`. The input carries the attribute so
     that a screen's own input rules can leave it alone.
   - Tests query roles, names and `data-direction`, not classes.
   - The ratchet comes down.

   Proof: computed styles of every field and its parts, snapshotted from
   class-free roots before and after, are identical. Checked in the Edit View
   pane (steppers, the `°` unit, the bare grid-scale fields), Settings
   (Workspace and Paper), the export dialog and the tool card, at desktop
   size and under a coarse pointer.

2. **Restyle.**
   - The field is one frame: the control's border, radius and ground, and
     `overflow: hidden`.
   - The step buttons lose their own borders, radii and grounds. Each draws a
     1px divider on the side facing the number.
   - The number and its unit share a `<label>` between the dividers. The
     input is borderless inside it, and the unit follows the number. Being a
     label, a click on the unit or the padding lands in the input.
     `NumberField` is never inside a label (`FieldRow`, the tool card and the
     pen card all keep it out of one), so the label does not nest.
   - The unit is linked to the input with `aria-describedby`, so a screen
     reader says it after the value.
   - The focus ring moves from the input to the frame (`:focus-within`).
   - A disabled step fades its icon, not the whole button, so the divider
     stays put.
   - Under a coarse pointer the buttons stay 44px targets, and the number is
     one too. The field is then 136px; `.control-row`'s coarse column, which
     was sized for the old 140px of boxes and gaps, follows it.
   - The bare variant (`steppers={false}`, no unit; only the grid-scale
     formula uses it) stays a plain input in `.control-row__input`.

## Affected Areas

- `apps/web/src/components/ui/NumberField.tsx`, `NumberField.module.css`
  (new), `NumberField.test.tsx`
- `apps/web/src/styles/theme.css`: the `.number-field*` block, the export
  dialog's and the pen card's overrides, the tool card's exclusion,
  `.control-row`'s coarse column, and the coarse step sizes
- `apps/web/src/styles/globalStylesheets.test.ts` (ratchet)
- `apps/web/src/components/settings/PaperPenCard.tsx` (`variant="card"`)
- `apps/web/src/components/paperExport/PaperExportOptions.tsx` (`className`,
  `minChars`)
- `apps/web/src/components/panels/CpPropertiesPanel.test.tsx` (step query)

## Checklist

- [x] Commit 1: move the block into `NumberField.module.css`; overrides
      become `variant`, `className` on the root, `minChars` and
      `data-number-field`; tests off module classes; lower the ratchet
- [x] Commit 1: prove the move in the browser (computed styles identical
      before and after, desktop and coarse). 56 fields: the View pane and
      its drawer (11 each), the tool card's Size, Settings ▸ Workspace and
      ▸ Paper (7 pen cards, desktop and phone), the export dialog's three
      (desktop and phone), and the phone export again in the light theme
- [ ] Commit 2: joined frame, dividers, unit inside the field, focus ring on
      the frame, coarse sizing
- [ ] Commit 2: tests for the unit's place and description, and the label
      focusing the input
- [ ] Commit 2: before/after in the browser, both themes, desktop and coarse,
      every surface above
- [ ] Lint, typecheck, unit tests; draft PR
