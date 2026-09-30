# Dialog title i18n

## Goal

Stop the app's dialogs from speaking English in the eight other locales. The
native file dialogs (every Save/Import/Export title in the desktop app), the
crease-pattern export modal's heading and button, and several confirmation and
number dialogs are still built from bare English literals in store and command
code, so the i18n extractor never sees them and `i18n:check` passes while they
ship untranslated.

## Approach

Route each string through `i18n.t('dialogs:<key>', 'English default')`, the
pattern `projectSlice.ts` already uses for the export-loss and close-design
dialogs, then extract, translate all 8 locales with each catalog's established
terms, stamp, and check.

- **Native file dialog titles** get a `fileDialog.*` group, one key per title.
  The segment export's file-format title (`Export {{format}}`) interpolates the
  format name, which stays verbatim in every locale.
- **"Discard unsaved changes?"** is asked from four places with the same title
  and the same Discard button, so those two strings share one key each
  (`discardChanges.title`, `discardChanges.confirm`); each site keeps its own
  message, because each asks a different question. The already-translated close
  and update guards keep their own keys.
- **The crease-pattern export modal** gets `export.dialogTitle` for its heading
  (`export.title` is the caption's Title field). Its callers stop passing an
  English `confirmLabel`: the dialog already defaults the button to the
  translated `export.confirm`, and the caller's literal was overriding it.
- **Confirm / number dialogs** (`legacyOrh`, `replaceEditedCp`, `splitEdge`,
  `setEdgeLength`, `scaleEdgeLengths`) translate title, message or field label,
  and buttons together, so no dialog renders half-translated. The number
  dialog's close button reuses `common.closeNamed`, as the other dialog types
  already do.

Out of scope: File ▸ Open's title (`Open Ori Studio Project or Crease Pattern`)
is translated by the still-open #412, which moves it into `lib/fileFormats.ts`;
touching it here would collide with that branch.

## Affected Areas

- `apps/web/src/store/workspaceStore/slices/projectSlice.ts`
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts`
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts`
- `apps/web/src/routing/useWelcomeDiscardGuard.ts`
- `apps/web/src/commands/menuActions.ts`
- `apps/web/src/simulator/simulatorViewExport.ts`
- `apps/web/src/components/CommandDialogModal.tsx`
- `apps/web/public/locales/*/dialogs.json`, `apps/web/public/locales/.hashes.json`

## Checklist

- [x] Native file dialog titles routed through `i18n.t`
- [x] Discard-changes dialogs share title and button keys
- [x] Legacy ORH, Replace Edited CP, and the three edge number dialogs translated
- [x] Crease export modal heading translated; English `confirmLabel` overrides removed
- [x] Number dialog close button uses `common.closeNamed`
- [x] `i18n:extract` → translate 8 locales → `i18n:stamp` → `i18n:check`
- [x] Unrelated catalog churn from extract (NBSP escapes) reverted
- [x] lint / typecheck / full web vitest suite
