# BP Sheet `+` / `−` Step the Grid Size

## Goal

In the BP Editor, the `+` / `−` toolbar buttons should add or remove **one grid
unit in each sheet dimension** — the same edit as typing one more (or one fewer)
into both sheet-size inputs. Nothing on the sheet is rescaled, so `+` leaves the
flaps smaller relative to the paper.

They previously ran subdivide / un-subdivide, which doubled or halved the sheet
*and* applied a matching scale transform to flap anchors, flap sizes, and tree
edge lengths, so the design looked identical and only the grid got finer.

Subdivide and un-subdivide themselves stay: they are a faithful port of Box
Pleating Studio's `sheet.ts:subdivide` and remain available through the engine,
the wasm bridge, and the store. They are simply no longer on a button.

## Approach

This is a UI change only — no engine, wasm, or store change is needed, because
the operation the buttons now perform is one the sheet-size inputs already do.

- The buttons call the existing `setOristudioBpLayoutSheet(kind, w ± 1, h ± 1)`
  action, the same path the width/height inputs use.
- Add `lib/bpSheetSize.ts` with the one predicate the UI needs
  (`bpSteppedSheetSize`), mirroring the engine's size bounds and its
  translation-only fit rule, and move the sheet-size constants there from
  `BpPackingPanel`. It also gates on *both* dimensions being able to take the
  step: the engine resizes each independently and keeps whichever took, which is
  right for the inputs but would leave the grid lopsided from a single button.
- Retitle the buttons ("Increase / Decrease Grid Size") and translate the two new
  keys for all 8 locales.
- Mark the `bp.layout.subdivide` / `unsubdivide` command-catalog entries
  `hidden-ui-only` — still ported, no longer surfaced — and add
  `bp.layout.growSheet` / `shrinkSheet` for the buttons.

## Affected Areas

- `apps/web/src/lib/bpSheetSize.ts` (new) + test
- `apps/web/src/components/panels/BpPackingPanel.tsx`
- `apps/web/src/lib/oristudioBpCommands.ts`
- `apps/web/public/locales/*/panels.json`

## Checklist

- [x] Add `bpSheetSize.ts` + unit tests
- [x] Point the buttons at the sheet-size action with a ±1 step
- [x] Wire the panel's enabled/disabled guards to the new predicate
- [x] Retitle the buttons and translate the new keys for all 8 locales
- [x] Mark the subdivide commands `hidden-ui-only` and add the new ones
- [x] Run web validation
- [ ] Update the draft PR and watch CI
