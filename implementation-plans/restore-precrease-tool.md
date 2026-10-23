# Restore the separate Precrease tool

## Goal

Restore separate Valley, Mountain and Precrease tools, replacing the temporary
Fold and unfold switch. Preserve current icons, other Fold improvements and
saved native sequences.

## Approach

Restore the tool catalog, P shortcut, shared menus and preview-kind control.
Keep Precrease's own direction and Whole line / Segment / Pinch extent.
Refusal fixes select Precrease again. Saved operations and file formats stay
unchanged. Validate UI selection, direction, partial extents and fresh replay.

The concurrent private model investigation and its evidence stay exclusively
in the Git-excluded private model directory. Any confirmed general engine fix
will receive independent public regression cases without book geometry.

## Affected Areas

- Fold tool state, catalogs, preview builder, window, shortcuts and menus.
- Existing UI/state/WASM tests and translations.

## Checklist

- [x] Restore separate Precrease entry points and state.
- [x] Restore direction and extent controls and refusal actions.
- [x] Validate tests, typecheck, lint and browser behavior.
- [x] Verify existing native precreases need no migration.

## Validation

- Restored rail and compact picker, menu/context actions, P shortcut, previews,
  and Whole line / Segment / Pinch controls. Mountain petal refusal shortcuts
  preserve direction when selecting Precrease.
- 1,316 web tests across 160 affected suites pass against the rebuilt Fold WASM.
- Typecheck and i18n check pass; lint has no errors (existing TanStack warning).
- Browser: P selects Precrease, a committed crease keeps the sheet flat, and V
  returns to Valley with no fold-and-unfold switch. Existing native precreases
  replay without any schema or file migration.
