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
   - The frame's border is drawn by `::after`, over the parts, so the field
     is exactly as tall as they are: 26px, and 44px under a coarse pointer,
     where theme.css makes every input 44px. A real border would make it 46.
   - The focus ring moves from the input to the frame (`:focus-within`).
   - A step past a bound fades its icon, not the whole button, so the
     divider stays put. A disabled field fades whole (0.55, as a switch
     does), where before only its two buttons did.
   - Under a coarse pointer the buttons and the number are 44px targets, so
     the field needs 132px. The pane rows' stepper cell
     (`.control-row__value--input`) had a fixed 112px and relied on the old
     boxes overflowing it to the right; the joined frame clips instead, so
     the cell's width became a floor (edited in place) and it takes the
     coarse column's 140px. The coarse comments say the new arithmetic.
   - The pen card's stepper grows to 44px under a coarse pointer. It was
     28px with its 44px buttons clipped to 28.
   - The bare variant (`steppers={false}`, no unit; only the grid-scale
     formula uses it) stays a plain input in `.control-row__input`.

3. **The field is as wide as its number** (asked for on review, 2026-10-03:
   a one-digit Grid size sat in 46px of input). The frame hugs its content,
   `width: fit-content`, and grows a digit at a time for a longer number.
   - A number input's own width follows `max`, not its value. An invisible
     copy of the draft sets the width, padded with zeros to `minChars`
     digits (default 2), and the input lies over it, absolutely positioned.
     This is exact in any font, and needs no `field-sizing: content`, which
     the WKWebView of older macOS lacks.
   - A number shorter than `minChars` is centred in its room; with a unit it
     sits against the unit instead (`data-unit`).
   - Under a coarse pointer the copy follows theme.css's 16px for inputs,
     and the number's room is still a 44px target.
   - A caller that wants a fixed width sets it on the root. The export
     dialog does, with `minChars={4}`, so its rows keep one width; the pen
     card's `variant="card"` fills its column.
   - The pane rows' stepper cell and Settings ▸ Workspace's field wrapper had
     fixed widths (112px floor, 132px) for the old three boxes. Both go (in
     place), so the field sits at the end of its row at its own width.
   - Pane rows: 83px for one or two digits (was 112), 91px for `90 °`, plus
     7.5px a digit. Phone: 132px for up to three digits, inside the 140px
     column; a longer number widens it.

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
- [x] Commit 2: joined frame, dividers, unit inside the field, focus ring on
      the frame, coarse sizing
- [x] Commit 2: tests for the unit's place and description, the label holding
      the unit and not the steps, and the disabled marker
- [x] Commit 2: before/after in the browser, both themes, desktop and coarse,
      every surface above (Playwright element shots at 2x), plus the label
      focusing the input from the unit and the padding, the focus ring, and
      stepping
- [x] Lint, typecheck, unit tests (full suite: 8,820 pass; one 3D fold
      parity test timed out under load and passes alone); draft PR
- [x] Commit 3: the field hugs its number (sizer, `minChars` default 2,
      `data-unit`), the fixed widths in the pane rows and Settings go; tests
      for the sizer and the unit flag
- [x] Commit 3: in the browser, widths measured at 1–7 digits on desktop and
      phone; real clicks on the unit, the padding and the digits focus the
      input; typing grows the field without scrolling the number; Escape
      reverts; every surface recaptured in both themes
