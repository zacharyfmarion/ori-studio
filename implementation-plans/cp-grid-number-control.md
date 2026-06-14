# CP Grid Number Control

## Goal

Let users change the editable crease-pattern grid division count from the CP
viewport, matching Oriedita's grid-size behavior for box-pleated designs.

## Approach

- Use Oriedita's `GridModel` behavior as the reference: default grid size 8,
  persisted on the CP document grid metadata, and clamped to at least 1.
- Add a shared helper for normalizing grid-size input so rendering, snapping,
  store mutation, and UI tests agree.
- Add an undoable workspace action that updates the active editable CP document
  grid metadata and restores the worker-backed document handle.
- Place a compact numeric control next to the existing grid toggle in the CP
  viewport toolbar.
- Cover the helper, store mutation, undo behavior, and toolbar interaction with
  focused web tests.

## Affected Areas

- `apps/web/src/lib/creasePatternViewport.ts`
- `apps/web/src/store/workspaceStore/types.ts`
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts`
- `apps/web/src/components/panels/CreasePatternPanel.tsx`
- `apps/web/src/components/panels/CreasePatternPanel.test.tsx`
- `apps/web/src/store/workspaceStore/store.test.ts`
- `apps/web/src/styles/theme.css`

## Checklist

- [x] Add grid-size normalization and tests.
- [x] Add undoable editable-CP grid-size mutation.
- [x] Wire a compact CP toolbar grid-size control.
- [x] Validate with focused web tests.
- [x] Open a draft PR against `main`.
