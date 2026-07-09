# Import (Add) and Export Submenu

## Goal

Bring Oriedita's File ▸ "Import (Add)" behavior to Ori Studio: merge a chosen
crease pattern into the currently loaded editable crease pattern without
disturbing existing geometry, matching Oriedita's exact placement and line
division. Also tidy the File menu by collapsing the eight individual export
entries into a single "Export" submenu.

## Approach

Port Oriedita `CreasePattern_Worker.setSave_for_reading_tuika` (invoked by
`ImportAddAction`) into the Rust CP kernel, then wire it through the wasm bridge,
the CP worker, the runtime, the workspace store, capabilities, and the shared
menu.

Import (add) semantics (faithful to the reference):

- The import's folding line segments and circles are shifted by
  `addx = existing.getMaxX() + 100 - import.getMinX()` and
  `addy = existing.getMaxY() - import.getMaxY()` (bounds taken over line-segment
  endpoints, `0.0` when empty), so the import sits to the right of the current
  pattern with the two top edges aligned.
- The shifted lines are appended and divided against the existing lines with
  `divideLineSegmentWithNewLines`, then everything is unselected.
- Auxiliary lines, loose points, and text are dropped, matching Oriedita's
  `FoldLineSet.setSave`, which only carries folding line segments and circles.

Import (add) targets the active editable crease pattern and is gated on one
being loaded (same `canEditCp` rule the CP edit commands use). Supported inputs
match Open's crease-pattern set: `.cp`, `.fold`, `.ori`, `.orh`. The merge is a
CP history entry, so undo reverts it.

The Export submenu is a pure menu-definition change; menu item text is sourced
from capability labels (unchanged), so the command palette still shows the full
"Export …" names.

## Affected Areas

- `crates/oristudio-cp/src/operations/arrangement.rs` — `import_add` + bounds
  helpers + unit tests.
- `crates/oristudio-cp-wasm/src/lib.rs` — `import_add(handle, imported_handle)`
  wasm export.
- `apps/web/src/generated/oristudio-cp-wasm/*` — regenerated bindings.
- `apps/web/src/workers/oristudioCpWorker.ts` — `importAdd` worker method.
- `apps/web/src/store/workspaceStore/oristudioCpRuntime.ts` —
  `importAddOristudioCpDocumentFromText` (load throwaway doc, merge, free).
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` +
  `types.ts` — `importAddCreasePattern` store action.
- `apps/web/src/lib/workspaceCapabilities.ts` — `file.importAdd` capability.
- `apps/web/src/commands/menuActions.ts` + `apps/web/src/platform/fileService.ts`
  — `file.importAdd` action id, command, and dispatch.
- `apps/web/src/menus/menuDefinition.ts` — Import (Add) item + Export submenu.
- Tests: `menuActions.test.ts`, `store.test.ts`.

## Checklist

- [x] Port `import_add` into the Rust CP kernel with unit tests.
- [x] Expose `import_add` through the wasm bridge and regenerate bindings.
- [x] Add the worker + runtime import-add path (throwaway document, then free).
- [x] Add the `importAddCreasePattern` store action with capability gating,
      file-format guard, and undo history entry.
- [x] Add the `file.importAdd` capability, menu action id, and dispatch.
- [x] Add File ▸ Import (Add) and collapse exports into File ▸ Export.
- [x] Update/extend tests (menu dispatch + store behavior).
- [x] Validate: cargo fmt/clippy/test (oristudio-cp, wasm), web lint/typecheck/test.
- [x] Verify File menu in the browser preview.
