# Box Pleating Studio in the Design Workspace

## Goal

Re-home the Box Pleating Studio (BP) integration onto Ori Studio's current
three-workspace architecture (`design | edit | simulate`) that landed on `main`
after this branch was opened. BP becomes a **design method inside the Design
workspace**, not a separate app mode or a hijack of existing panes.

The user-facing model:

- The Design workspace opens on a **NUX chooser** in the `design` pane:
  **Circle-packed** vs **Box-pleated**. Picking one initializes that design
  method and materializes the matching Design layout.
- **Circle-packed** is the existing TreeMaker workflow
  (`workflowTarget: 'treemaker'`): tree authoring → optimize → build CP.
- **Box-pleated** is the BP workflow (`workflowTarget: 'box-pleat'`): a
  **side-by-side split** of the BP tree editor (`design` pane) and the BP
  packing editor (`bp-editor` pane), plus BP-aware Inspector/Diagnostics.
- A generated BP crease pattern is handed to the **Edit** workspace through the
  normal CP document pipeline, exactly like TreeMaker's Build CP.
- BP does **not** get its own workspace-rail button; it lives inside Design.

## Scope And Strategy

### Keep: the Rust port

The vast majority of the branch's value is a faithful headless port of Box
Pleating Studio's backend into Rust. That work is retained as-is and rebased
onto `main`:

- `crates/oristudio-bp` — engine/session, tree, layout (contours, joiner,
  pattern, generators, trace), optimizer, geometry (`math/`, `sweep/`,
  `data/`), and I/O (`bps`, `bpz`, `cp`, `fold_export`, `treemaker_import`,
  `migrations`).
- `crates/oristudio-bp-wasm` — browser bindings.
- `third_party/box-pleating-studio` vendored snapshot and
  `tools/bp-studio-oracle` oracle harness.
- `implementation-plans/box-pleating-studio-rust-port.md` — the port contract.

These are additive to `main` and should rebase with minimal conflict. Their
Rust/WASM tests are the acceptance bar and must stay green.

### Rewrite: the frontend integration

The branch's web integration predates the workspace refactor and edits exactly
the files `main` rewrote (`layoutStore.ts`, `App.tsx`, `InspectorPanel`,
`DiagnosticsPanel`, `menuActions`, `menuDefinition`, `HelpModal`). Rather than
merge it line-by-line, treat the existing BP frontend as a **reference
implementation** and rewrite it fresh against the workspace architecture.

Reference (do not carry forward verbatim; re-derive against current `main`):

- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts`
- `apps/web/src/store/workspaceStore/oristudioBpRuntime.ts`
- `apps/web/src/workers/oristudioBpWorker.ts`,
  `oristudioBpOptimizerWorker.ts`
- `apps/web/src/components/panels/BpPackingPanel.tsx`, `BpTreePanel.tsx`,
  `BpEditorPanel.tsx`
- `apps/web/src/engine/oristudioBpSnapshotMapper.ts`, `oristudioBpTypes.ts`
- `apps/web/src/lib/oristudioBp*.ts` (commands, export, selection, viewport
  settings, packing/tree viewport helpers)
- The branch's uncommitted pane-separation working tree.

Explicitly discard on rewrite:

- The branch's single-route `layoutStore.ts` changes and
  `ensureRequiredLayoutPanels` (obsolete under per-workspace layouts).
- The BP recent-projects system (`RECENTS_STORAGE_KEY`, `rememberRecent`) —
  `main` removed web recent-projects and localStorage autosave.
- Any `activatePanel('files')` routing — the `files` panel no longer exists.
- The `crease-pattern` BP active surface and any mapping of BP view state onto
  `documentMode` — CP belongs to the Edit workspace.

### Current `main` architecture (the target)

- Three workspaces defined in `apps/web/src/workspaces/workspaces.ts`
  (`WORKSPACE_DEFINITIONS`, `WORKSPACE_BY_PANEL_ID`, `workspaceForPanelId`,
  `workspaceForCommandId`).
- Per-workspace Dockview layouts in `apps/web/src/store/layoutStore.ts`
  (`applyDesignLayout` / `applyEditLayout` / `applySimulateLayout`), keyed
  `treemaker-web-layout:<workspace>` at `LAYOUT_VERSION = 12`.
- `activateWorkspace(id)` saves the current layout, clears Dockview, and
  restores/rebuilds the destination. `activatePanel(id)` resolves the owning
  workspace via `workspaceForPanelId` and switches first.
- `documentMode` stays `tree | crease-pattern`; `activeWorkspace` is separate
  UI state; `activeEditingSurface` remains the undo/clipboard/selection owner.
- Inspector and Diagnostics are Design-only with CP content removed.
- A global `StartScreen` overlay offers Create CP / Open file / Create design
  before any document exists.

## Product Contract

Pane ownership after this change:

| Workspace | Circle-packed (TreeMaker) | Box-pleated (BP) |
| --- | --- | --- |
| Design (no doc) | Chooser NUX in `design` pane | Chooser NUX in `design` pane |
| Design (active) | `design` (tree) + inspector/conditions/diagnostics | `design` (BP tree) + `bp-editor` (packing) + BP inspector/diagnostics |
| Edit | Generated/opened CP | BP-generated CP (same pipeline) |
| Simulate | Folded simulation | Folded simulation (when artifacts exist) |

Rules:

- The design method is chosen once (NUX or Open/Import) and drives which Design
  layout is materialized. BP and TreeMaker never share a Design layout.
- CP editing is always the Edit workspace. BP never renders CP inside Design.
- BP-owned editing surfaces are `tree` and `packing` only.
- Unfinished handoffs stay explicit (`Not implemented`/`Upstream-gap`), never
  faked.

## Affected Areas

- `apps/web/src/workspaces/workspaces.ts` — register `bp-editor` under the
  `design` workspace.
- `apps/web/src/store/layoutStore.ts` — workflow-aware `applyDesignLayout`,
  layout re-materialization on method change, `LAYOUT_VERSION` bump.
- `apps/web/src/components/panels/PanelComponents.tsx` — register
  `BpEditorPanel`.
- `apps/web/src/components/panels/DesignPanel.tsx` — NUX chooser empty state;
  render BP tree authoring for BP docs.
- `apps/web/src/components/panels/BpEditorPanel.tsx`,
  `BpPackingPanel.tsx`, `BpTreePanel.tsx` — rewritten BP surfaces.
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` (+ runtime,
  workers, types, snapshot mapper) — rewritten against workspace navigation.
- `apps/web/src/components/panels/InspectorPanel.tsx`,
  `DiagnosticsPanel.tsx` — BP sections inside the Design-only panels.
- `apps/web/src/lib/oristudioBpCommands.ts`,
  `apps/web/src/commands/menuActions.ts`,
  `apps/web/src/menus/menuDefinition.ts`,
  `apps/web/src/lib/workspaceCapabilities.ts`,
  `apps/tauri/src-tauri/src/menu.rs` — command/menu/shortcut/capability routing.
- `apps/web/src/components/StartScreen.tsx` — Create-design path leads to the
  Design chooser (or forks into the two methods).
- `scripts/bp-ui-regression.mjs`, `tests/fixtures/bp-ui/` — regression coverage
  for the new surfaces.
- `implementation-plans/box-pleating-studio-pane-separation.md`,
  `box-pleating-studio-ui-integration.md` — mark superseded by this plan.

## Checklist

### Phase 0: Rebase Engine, Reset Frontend

- [x] Rebase `crates/oristudio-bp` and `crates/oristudio-bp-wasm` (plus
      `third_party/box-pleating-studio`, `tools/bp-studio-oracle`) onto `main`.
- [x] Resolve `Cargo.toml` workspace-member conflicts; keep Rust + wasm tests
      green. (260 oristudio-bp tests pass; `preserve_order` scoped to the BP
      crate; pre-rehome state preserved on branch `bp-port-reference`.)
- [x] Take no frontend BP files onto the rebased branch except as reference;
      start the web integration from `main`'s workspace baseline.
- [x] Confirm `main`'s web app still builds/lints/tests before adding BP UI.

Exit gate:

- The BP Rust/WASM crates build and pass their tests on top of current `main`
  with the web app untouched.

### Phase 1: Workspace And Layout Plumbing

- [x] Keep `workflowTarget: 'treemaker' | 'box-pleat'`; surface user labels
      "Circle-packed" / "Box-pleated" without renaming the internal ids.
      (Added `workflowTarget` to `ProjectSliceState` + `setWorkflowTarget`.)
- [x] Register `'bp-editor'` in `panelComponents` and in
      `WORKSPACE_BY_PANEL_ID` → `'design'`.
- [x] Make `applyDesignLayout` workflow-aware: TreeMaker → current layout; BP →
      `design` + `bp-editor` split, with inspector/diagnostics.
- [x] Re-materialize the Design layout when the active design method changes
      (`setWorkflowTarget` → `rematerializeWorkspace('design')`) without
      disturbing Edit/Simulate layouts.
- [x] Bump `LAYOUT_VERSION` (12 → 13); design layout persisted per method via
      a `design:box-pleat` scope so the two variants don't clobber.
- [x] Layout-store tests: BP Design default, TreeMaker Design default,
      method-scoped persistence, re-materialization, inactive no-op.

Exit gate:

- A BP project shows the tree + packing split in Design; a TreeMaker project is
  unchanged; switching methods rebuilds only the Design layout.
  (Verified at the unit level; visual verification deferred to Phase 2 when the
  NUX can create a BP project and the panes have real content.)

### Phase 2: Design NUX Chooser

- [ ] `DesignPanel` renders the Circle-packed / Box-pleated chooser when the
      Design workspace has no active design document.
- [ ] Circle-packed → existing create-design flow (`treemaker`).
- [ ] Box-pleated → `createOristudioBpProject` (`box-pleat`).
- [ ] Entering the Design workspace with no document shows the chooser rather
      than a blank tree.
- [ ] Decide/keep the global `StartScreen` "Create a design" action routing to
      the Design workspace chooser (sketch places the chooser in the design
      pane; StartScreen may keep a single "Create a design" entry).
- [ ] Tests: chooser renders on empty Design; each option initializes the
      correct `workflowTarget` and layout.

Exit gate:

- Opening the app to an empty Design workspace presents the two-method chooser,
  and each choice lands in the right layout.

### Phase 3: BP Tree Authoring In The Design Pane

- [ ] Rewrite `BpTreePanel` fresh (reference the branch version) as the BP
      `design`-pane content.
- [ ] `DesignPanel` renders `BpTreePanel` for active BP docs; preserves the
      TreeMaker tree editor for `treemaker`.
- [ ] Wire BP tree selection, add/split/merge/delete, edge-length editing, and
      tree→packing dual navigation.
- [ ] Tests: BP tree editor renders in Design; TreeMaker path unaffected.

Exit gate:

- BP tree drawing is the Box-pleated entry surface, matching TreeMaker muscle
  memory.

### Phase 4: BP Editor Packing Pane

- [ ] Rewrite `BpEditorPanel` + `BpPackingPanel` fresh; mount as the
      `bp-editor` pane.
- [ ] Empty states: no BP project, and BP project without materialized packing.
- [ ] Preserve manual flap drag, river edits, conflicts, stretch/pattern/device
      controls, layer toggles, zoom/pan, and linked selection with the tree.
- [ ] Optimizer results activate/refresh `bp-editor`; valid-but-different
      packings are not flagged as errors.
- [ ] Tests: BP Editor rendering, empty states, optimizer activation.

Exit gate:

- Users place flaps and inspect conflicts in `bp-editor` while the tree stays
  editable beside it.

### Phase 5: BP Store, Runtime, And Workers

- [ ] Rewrite `oristudioBpSlice` against workspace navigation
      (`activateWorkspace`/`activatePanel`), no recents, no `documentMode`
      coupling beyond `tree`.
- [ ] Rewrite `oristudioBpRuntime` + BP worker + optimizer worker bindings
      against the rebased wasm crate.
- [ ] Narrow `OristudioBpEditingSurface` to `tree | packing`.
- [ ] Keep BP history separate from CP history; preserve BP undo/redo.
- [ ] Tests: slice actions, worker round-trips, undo/redo isolation.

Exit gate:

- BP state is driven only by BP-owned surfaces and workspace navigation.

### Phase 6: Commands, Menus, Shortcuts, Capabilities

- [ ] `bp.view.tree` → activate Design + BP tree intent.
- [ ] `bp.view.packing` → activate Design + focus `bp-editor`.
- [ ] `bp.view.creasePattern` → generate/open BP CP in the Edit workspace.
- [ ] Relabel "Packing" → "BP Editor"; update tooltips/disabled reasons.
- [ ] Update web menus, command palette metadata, shortcuts, and Tauri native
      menus; capability-gate by workspace/method, not CP active state.
- [ ] Tests: pane/workspace activation, disabled states, not-implemented paths.

Exit gate:

- Every BP command lands the user in the workspace/pane that owns the action.

### Phase 7: Generated BP CP Handoff To Edit

- [ ] `openOristudioBpCreasePattern` builds a real `oristudioCpDocument` via the
      CP runtime (export → load → CheckCamv), sets lineage, and activates the
      Edit workspace through `activatePanel('crease-pattern')`.
- [ ] Preserve BP→CP source mapping where the backend exposes it; mark missing
      source-map/edit-conversion data explicitly.
- [ ] Mark generated BP CP artifacts stale after tree/packing/stretch/device
      edits.
- [ ] Tests: generate-to-Edit, stale state, export, unsupported conversion.

Exit gate:

- BP-generated CPs enter the Edit workspace on the same pipeline as other CPs.

### Phase 8: Inspector And Diagnostics BP Sections

- [ ] Add BP tree inspector sections active when Design has BP focus.
- [ ] Add BP packing inspector sections active when `bp-editor` has focus.
- [ ] Route BP conflict/optimizer/export diagnostics into the Design-only
      Diagnostics panel without resurrecting CP content there.
- [ ] Cross-surface selection highlighting (tree leaf ↔ flap, river ↔ edge).
- [ ] Tests: inspector sections and diagnostics selection routing.

Exit gate:

- Inspector/Diagnostics explain BP selections within the Design workspace only.

### Phase 9: Persistence, Open, And Import

- [ ] BP file open/save (`.bps`, `.bpz`) and export (`.cp`, `.fold`) route
      through the current file service and land in the correct workspace.
- [ ] Opening/importing a BP project sets `box-pleat` and materializes the BP
      Design layout; opening a CP/OSF stays on existing behavior.
- [ ] BP examples/catalog entry available from the chooser or File menu.
- [ ] Tests: open/save/export round-trips and workspace landing.

Exit gate:

- BP projects persist and reopen into the Box-pleated Design layout.

### Phase 10: Regression Harness And Verification

- [ ] Update `scripts/bp-ui-regression.mjs` + `tests/fixtures/bp-ui/` for:
      chooser, BP tree+packing split, optimize activates `bp-editor`, generate
      CP lands in Edit without disturbing Design.
- [ ] Verify desktop/tablet/mobile Design layouts have no overlapping controls.
- [ ] Run `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`,
      production web build, and BP Rust/WASM tests.
- [ ] `git diff --check`.

Exit gate:

- The Circle-packed/Box-pleated model holds across realistic workflows and all
  suites pass.

## Supersedes

- `implementation-plans/box-pleating-studio-pane-separation.md` — its
  three-pane goal is realized by the workspace split; its layout/command
  mechanics assumed the old single-route app and are replaced here.
- The surface-routing assumptions in
  `implementation-plans/box-pleating-studio-ui-integration.md`. The BP feature
  surface it defines still applies; the Rust port contract in
  `box-pleating-studio-rust-port.md` is unchanged.
