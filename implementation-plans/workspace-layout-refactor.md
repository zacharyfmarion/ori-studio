# Workspace Layout Refactor

## Goal

Refactor the web app from one shared Dockview route into three first-class
workspaces exposed in a left rail:

- Design
- Edit
- Simulate

The rail should use icon-only buttons with tooltips that show the full
workspace names. The architecture should keep workspace navigation separate
from document kind, editing surface, undo ownership, and saved project format.

## Approach

### Core model

Add a small workspace model instead of treating Dockview panel IDs as the app
navigation layer.

- Add `WorkspaceId = 'design' | 'edit' | 'simulate'`.
- Add a `WORKSPACE_DEFINITIONS` registry with id, label, tooltip, icon,
  command id, default layout builder, and optional empty-state behavior.
- Add `activeWorkspace` to layout or UI state. Do not extend
  `DocumentMode` with `simulate`; `DocumentMode` should keep meaning
  `tree | crease-pattern`.
- Keep `activeEditingSurface` as the undo, clipboard, and selection ownership
  signal. Entering Design should set it to `tree`. Entering Edit should set it
  to `crease-pattern` when an editable CP document exists. Entering Simulate
  should not invent a new editing surface.
- Treat `view.creasePattern` and `view.simulator` as compatibility aliases
  during the migration, but introduce workspace-facing commands such as
  `view.edit` and `view.simulate` if the menu and shortcut layer need labels
  that match the new rail.

This keeps generated TreeMaker CPs clean: after Build CP, the loaded document
can still be a tree document while the active workspace becomes Edit.

### Workspace pane ownership

Default pane assignments should be:

| Workspace | Primary pane | Side panes | Notes |
| --- | --- | --- | --- |
| Design | `design` | `inspector`, `conditions`, `diagnostics` | Tree drawing, paper, symmetry, constraints, optimization, and build status live here. |
| Edit | `crease-pattern` | None by default | CP viewing and editable CP tools live here. Generated CPs from tree documents belong here too. CAMV and CP command errors should stay in the CP surface, not in `DiagnosticsPanel`. |
| Simulate | `simulator` | `sequence` | 3D folding, fold artifact refresh, and folding sequence planning live here. |

Pane refactors:

- Make `InspectorPanel` Design-only. Remove CP/imported-CP selection and
  diagnostic inspection from this panel rather than carrying it into Edit or
  Simulate.
- Make `DiagnosticsPanel` Design-only. Remove CP diagnostics from this panel;
  CAMV and other CP command errors should continue to be surfaced in the CP
  pane/HUD or future CP-specific UI.
- Keep `ConditionsPanel` Design-only and remove its imported-CP empty state
  from the default workspace layout.
- Move `SequencePanel` into the Simulate workspace default layout. Its
  "Simulate step" action should activate the Simulate workspace, not just a
  Dockview panel ID.
- Keep the existing CP tool rail inside the Edit workspace. The new global
  workspace rail should sit outside Dockview, so the two rails have distinct
  responsibilities.

### Layout persistence

Replace the single global Dockview layout with per-workspace layout state.

- Store layouts under versioned keys such as
  `treemaker-web-layout:design`, `treemaker-web-layout:edit`, and
  `treemaker-web-layout:simulate`.
- Bump the layout version and intentionally discard the old one-route layout.
- `resetLayout()` should reset the active workspace by default and accept an
  optional workspace id for tests and settings.
- Save the current workspace layout before switching workspaces, then load the
  saved layout for the destination workspace or apply that workspace default.
- If switching workspaces remounts panes, lift important UI-only view state
  that should survive navigation into existing stores before relying on the
  new behavior. CP viewport state already has store support; design layer and
  simulator view settings should be audited.

Implementation note: the first pass keeps CP viewport state in the existing
store-backed CP viewport state. Design layer toggles and simulator camera/view
settings remain pane-local transient controls and can reset when their
workspace is remounted.

The native `.osf` project schema does not need a new document kind for this
change. If restoring the last workspace on reopen is desired, store
`activeWorkspace` inside existing `workspace.viewState` instead of changing
`workspace.activeMode`.

### App shell

Refactor `App.tsx` into a shell with stable regions:

- Top toolbar: global file, help, settings, and workspace-specific primary
  actions.
- Left workspace rail: Design, Edit, Simulate.
- Main workbench: the active workspace Dockview layout.
- Modals and toasts remain global.

Rail behavior:

- Use lucide icons rather than custom SVG. Candidate icons:
  `DraftingCompass` for Design, `PenTool` or `PencilRuler` for Edit, and
  `Box` or `Cuboid` for Simulate.
- Buttons are icon-only, fixed-size, keyboard focusable, and use the existing
  Radix tooltip wrapper with right-side tooltips: "Design workspace",
  "Edit workspace", and "Simulate workspace".
- Workspace buttons should always be visible. Prefer allowing navigation to an
  empty workspace with a clear next action over hiding one of the three main
  modes.
- Active styling should match the screenshot direction: quiet rail, clear
  active button, no large text labels in the rail.

### Command and workflow updates

- Route rail clicks through the same command dispatcher used by menus and
  shortcuts.
- Update View menu labels to match the workspace model while keeping aliases
  long enough to avoid a brittle migration.
- Update Build CP to activate the Edit workspace after success.
- Update Open/Create flows:
  - New tree project opens Design.
  - New or imported editable CP opens Edit.
  - Imported/generated CP artifacts open Edit.
  - Simulate remains available as a workspace with an empty state until fold
    artifacts exist.
- Update `NextDocumentAction` and any hard-coded `activatePanel(...)` calls to
  use workspace navigation where the intent is mode switching.
- Keep desktop Tauri menu IDs flowing through the same dispatcher; update the
  Rust native menu labels only after the web command layer is ready.

### Technical debt to avoid

- Do not gate Edit workspace UI on `documentMode === 'crease-pattern'`.
  Generated CP editing can happen while the source document remains a tree.
- Do not duplicate browser and desktop navigation paths.
- Do not make Simulate a document mode unless a future saved document type
  genuinely owns simulation data.
- Do not leave context-only panes globally visible by default. If a pane is not
  useful in a workspace, omit it from that workspace default layout.
- Do not reuse Design's inspector or diagnostics panels as catch-all sidebars
  for Edit or Simulate. Context-specific CP and simulation status should live
  in those primary surfaces or in explicitly named future panels.
- Do not encode workspace behavior in CSS selectors or panel titles. Use the
  workspace registry and command dispatcher.

## Affected Areas

- `apps/web/src/App.tsx`
- `apps/web/src/App.css`
- `apps/web/src/store/layoutStore.ts`
- `apps/web/src/store/layoutStore.test.ts`
- `apps/web/src/commands/menuActions.ts`
- `apps/web/src/commands/menuActions.test.ts`
- `apps/web/src/menus/menuDefinition.ts`
- `apps/tauri/src-tauri/src/menu.rs`
- `apps/web/src/components/panels/PanelComponents.tsx`
- `apps/web/src/components/panels/InspectorPanel.tsx`
- `apps/web/src/components/panels/DiagnosticsPanel.tsx`
- `apps/web/src/components/panels/ConditionsPanel.tsx`
- `apps/web/src/components/panels/SequencePanel.tsx`
- `apps/web/src/components/panels/NextDocumentAction.tsx`
- `apps/web/src/components/HelpModal.tsx`
- `apps/web/src/lib/workspaceCapabilities.ts`
- `apps/web/src/lib/nativeProjectFile.ts` if restoring the active workspace is
  added to project view state

## Checklist

- [x] Add workspace registry types and three workspace definitions.
- [x] Add active workspace state, per-workspace layout persistence, and layout
      reset behavior.
- [x] Refactor `App.tsx` into toolbar, workspace rail, and workbench regions.
- [x] Add the left workspace rail with icon buttons and right-side tooltips.
- [x] Apply Design, Edit, and Simulate default Dockview layouts.
- [x] Remove CP/imported-CP functionality from Inspector and keep it
      Design-only.
- [x] Remove CP diagnostics from Diagnostics and keep it Design-only.
- [x] Move Conditions to Design-only defaults.
- [x] Move Sequence to Simulate defaults and update step simulation navigation.
- [x] Update menu actions, View menu labels, Tauri menu labels, and hard-coded
      panel activations to use workspace navigation.
- [x] Audit pane remount behavior and lift any view state that must survive
      workspace switches.
- [x] Update Help copy to refer to workspaces instead of global panes.
- [x] Add unit tests for workspace definitions, layout persistence, command
      routing, and generated-CP Edit workspace inspection.
- [x] Run `npm run lint:web`, `npm run typecheck:web`, and `npm run test:web`.
