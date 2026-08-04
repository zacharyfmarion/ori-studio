# Number Field Steppers

## Goal

Replace the native `type="number"` spinners in the CP view-controls pane with
explicit − / + buttons, and make stepping commit the value on the click instead
of leaving it in the field until Enter or a blur.

The reported symptom was on Line width and Point size: the spinner arrows are a
4px hit target in a 26px row, and pressing one appeared to do nothing, because
the panel's number input holds a draft and only commits it on blur. A spinner
click moved the draft and nothing else.

## Approach

Lift the panel-local `CommittedNumberInput` into a `ui/NumberField` primitive and
give it the stepper:

- Keep the draft — it is what stops a half-typed number from reaching the engine
  (clearing the field to retype `16` would otherwise send an empty value, and a
  grid resize per keystroke).
- The − / + buttons commit on the click. Arrow Up/Down on the field is routed
  through the same path, so the keyboard behaves the same way rather than
  falling back to the native step that only moved the draft.
- A step reads the number the field currently shows, so a typed-but-uncommitted
  number steps from where it was left.
- A button is disabled when the caller's clamp would put the step back where it
  started, which covers `min`/`max` and a `normalize` that rounds.
- Native spinners are off for every field, including the ones with no room for
  buttons (the grid scale formula puts three fields and two operators on a line;
  those pass `steppers={false}` and keep type-and-commit plus Arrow Up/Down).

Two fixes fell out of the move:

- Escape reverted the draft and blurred in the same handler, so the blur's commit
  read the number Escape had just discarded and wrote it back. The revert is now
  flushed before the blur.
- A commit that does not change the value is skipped, so a step at a bound does
  not round-trip grid size through the engine or write an undo entry.

## Affected Areas

- `apps/web/src/components/ui/NumberField.tsx` (new)
- `apps/web/src/components/panels/CpViewControlsPanel.tsx`
- `apps/web/src/styles/theme.css`
- `apps/web/public/locales/*/common.json` (`common:numberField.*`)

## Checklist

- [x] Extract `NumberField` with step buttons, suffix slot, and `steppers` opt-out
- [x] Point `NumberRow` and `GridScaleRow` at it and delete the panel-local input
- [x] Style the field group; hide the native spinners; align every stepper row
- [x] Add `common:numberField.increase` / `.decrease` and translate all 8 locales
- [x] Unit tests for the primitive and a panel test for the reported case
- [x] Verify in the browser: click, Arrow Up/Down, Escape, bound disabling
