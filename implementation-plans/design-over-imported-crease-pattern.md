# Designing over an imported crease pattern

## Goal

Opening a crease-pattern file and then starting a Circle-packed design should
produce a working tree design. Today it produces a dead surface: the Design pane
shows "`<file>` is an imported crease pattern without an editable tree", the
Conditions pane shows its sibling message, and every tree edit is rejected with
"Imported crease patterns are read-only".

## Approach

`importedCreasePattern` is a **workspace**-level field — it says the always-live
Edit canvas is showing a read-only import. Four consumers read it as if it were a
statement about the **design** being authored:

| Site | What it does today |
| --- | --- |
| `DesignPanel.tsx:906` | Replaces the tree canvas with an empty state |
| `ConditionsPanel.tsx:74` | Replaces the conditions pane with an empty state |
| `editingSlice.ts:44` `rejectReadOnly()` | Rejects every tree edit (7 call sites) |
| `conditionSlice.ts:34` `rejectReadOnly()` | Rejects every condition edit (2 call sites) |

That reading was true when a workspace held one document: importing a CP put a
*derived, read-only* `TreeProject` into the store, and these guards stopped the
user editing a tree that was really a projection of the import.

Design tabs removed that state. Every path that sets `importedCreasePattern`
(`loadCreasePattern`, `restoreNativeCreasePatternProject`, `loadText`) now also
calls `discardAllDesigns()`, which resets the strip to a single **chooser** tab —
so a bare crease pattern establishes no design at all, and the derived project is
never installed. The only way to reach these guards now is the way the bug
reports: the user deliberately created a TreeMaker design, whose tree is real and
whose edits belong to it.

So the fix is to delete the four checks. The state they guard against is
unrepresentable, and `DesignPanel`'s mount condition already carries the real
signal — it renders only for a tab whose `kind` is `'treemaker'`, which by
construction holds a tree (see `DesignTabContent`).

`preserveEditCanvas` in `chooseDesignMethod` is left as is: keeping the imported
CP alive on the Edit canvas while a design is authored beside it is the intended
behaviour, and is exactly what these guards were misreading.

Not in scope, and left alone deliberately:

- `workspaceCapabilities.hasCreasePattern` counts an imported CP. It feeds
  export gating and the Build/Rebuild label, both of which read reasonably for a
  workspace that does hold a crease pattern; changing it moves menu enablement
  across surfaces this bug does not touch.
- `creasePatternSlice.hasFoldArtifactSource()` returns `false` for an imported
  CP, but only when the kernel refused the file (`oristudioCpDocument` is null),
  which is a load-failure path rather than this flow.

## Affected Areas

- `apps/web/src/components/panels/DesignPanel.tsx`
- `apps/web/src/components/panels/ConditionsPanel.tsx`
- `apps/web/src/store/workspaceStore/slices/editingSlice.ts`
- `apps/web/src/store/workspaceStore/slices/conditionSlice.ts`
- `apps/web/public/locales/*/panels.json` (three now-unused keys)
- `apps/web/src/store/workspaceStore/store.test.ts` (regression coverage)

## Checklist

- [x] Confirm every `importedCreasePattern` writer also resets the design tabs
- [x] Remove the `DesignPanel` imported-CP empty state and its dead imports
- [x] Remove the `ConditionsPanel` imported-CP empty state and its dead imports
- [x] Remove `rejectReadOnly()` from `editingSlice`
- [x] Remove `rejectReadOnly()` from `conditionSlice`
- [x] Drop the orphaned i18n keys and re-run `i18n:extract` / `i18n:stamp`
- [x] Add a store test: imported CP + Circle-packed design accepts tree edits
- [x] `npm run lint:web`, `typecheck:web`, `test:web`, `i18n:check`
- [x] Verify the flow in the browser
