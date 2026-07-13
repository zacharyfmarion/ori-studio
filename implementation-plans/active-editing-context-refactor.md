# Active Editing Context — replace `documentMode` with the active view

## Goal

Make **the currently active view/panel the single source of truth** for which
menus show, how shortcuts route, which undo/redo stack fires, and which
toolbar/commands are enabled. Today this is spread across three tangled axes and
BP is shoehorned into `documentMode: 'tree'`, so BP undo/redo, delete, and the
menus are all wrong. Collapsing to one derived context fixes those as
*consequences*, not as separate patches.

This is foundational and there are **no users yet**: we do not preserve
backwards compatibility, do not keep the old fields "just in case," and rewrite
tests to the new model rather than adapting them.

## Current state (what we're replacing)

Three overlapping concepts kept in sync by hand:

| Concept | Lives in | Values | Drives |
|---|---|---|---|
| `activeWorkspace` | `layoutStore` | `design`/`edit`/`simulate` | Which Dockview panels mount (layout only) |
| `documentMode` + `activeEditingSurface` | `workspaceStore` | `tree`/`crease-pattern` | Menus, capabilities, history, shortcut scope |
| `workflowTarget` + `pendingDesignChoice` | `workspaceStore` | `treemaker`/`box-pleat` + nux | Design layout *variant* + which document exists |

Key breakages this causes:
- **BP == `documentMode: 'tree'`** ([oristudioBpSlice.ts:68](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts)), so every `documentMode === 'tree'` check treats box-pleat as TreeMaker — the Design menu and the "Optimize Scale"/"Build CP" toolbar buttons ([NextDocumentAction.tsx](../apps/web/src/components/panels/NextDocumentAction.tsx)) show TreeMaker actions for BP.
- **Capabilities are blind to BP** — [workspaceCapabilities.ts](../apps/web/src/lib/workspaceCapabilities.ts) has no BP inputs.
- **Undo/redo dispatches on `documentMode`/`activeEditingSurface`** ([historySlice.ts](../apps/web/src/store/workspaceStore/slices/historySlice.ts)) and never reaches the BP engine's own history (`undoProject`/`redoProject` in [oristudioBpRuntime.ts](../apps/web/src/store/workspaceStore/oristudioBpRuntime.ts) are dead code).
- **Workspace↔surface sync is imperative and lossy** — `view.edit` only sets the surface *if a CP already exists* ([menuActions.ts:552](../apps/web/src/commands/menuActions.ts)); otherwise the Edit canvas is empty.

## Resolved decisions (from the author)

1. **No global project-kind mode.** The context is *whatever view is active*. The
   Design workspace will eventually have **tabs** (a TreeMaker design and a BP
   design side by side), so the meaningful state is the active panel, not a
   global mode. `documentMode`/`activeEditingSurface`/`workflowTarget`-as-mode are
   deleted.
2. **Designs are producers.** "Build CP" / "Send to Edit" **merges** generated
   geometry into the always-present Edit CP document via the existing Import(Add)
   path. **Duplicates on re-run are acceptable for now** (no dedup/replace logic).
3. **Edit canvas is always live.** A blank editable CP document exists from
   startup so the Edit workspace is never empty. Optimize perf later only if it
   actually bites.
4. **Simulate is a read-only consumer context** (recommendation below).
5. **No backwards compatibility.** Rewrite tests, drop persisted-layout migration
   shims, delete legacy fields outright.

### Simulate recommendation

Treat `simulate` as a first-class context in the same model, but with an
**empty content-editing capability set**: its menu/commands are playback- and
sequence-oriented (play/step/reset, sequence planning), and content-editing
commands (delete, build, tree/CP edits) are hidden. Undo/redo is a **no-op** in
Simulate for now (there is no content mutation to undo; if sequence planning
later gains meaningful steps, scope an undo stack to *that*, not to the model).
Simulate consumes the fold artifacts produced by the Edit canvas — it is a
consumer, not an editor, and the context model should express that rather than
pretend it edits a document.

## Target model

**`EditingContext`** — derived from the active Dockview panel, the single value
every shell subsystem reads:

```ts
type EditingContext =
  | 'design-nux'      // method chooser, no document
  | 'treemaker-tree'  // circle-packed tree (legacy `project`, tree engine)
  | 'bp-tree'         // BP tree authoring (oristudioBpDocument, tree surface)
  | 'bp-packing'      // BP packing editor (oristudioBpDocument, layout surface)
  | 'crease-pattern'  // CP editor (oristudioCpDocument)
  | 'simulate';       // folding simulator (fold artifacts, read-only content)
```

Each context resolves to a small descriptor:

| Context | Document / engine | Undo domain | Menu set |
|---|---|---|---|
| `design-nux` | none | none | File only |
| `treemaker-tree` | `project` (tree wasm) | tree text checkpoints (`historyPast`) | TreeMaker tree edit + Optimize/Build |
| `bp-tree` | `oristudioBpDocument` (BP wasm) | BP engine (`undo/redoProject`) | BP tree edit (add/delete/length) + Send-to-Edit |
| `bp-packing` | `oristudioBpDocument` (BP wasm) | BP engine (`undo/redoProject`) | BP packing (stretch/device/sheet) + Send-to-Edit |
| `crease-pattern` | `oristudioCpDocument` | `oristudioCpHistory*` | CP edit + Import(Add) |
| `simulate` | fold artifacts | none | Playback / sequence |

Note `bp-tree` and `bp-packing` **share one document + one undo stack** but have
different view-scoped commands — this is exactly why the context is finer-grained
than "which document." Because BP tree and BP packing are already *separate
Dockview panels* (`design` vs `bp-editor`), the active panel distinguishes them
for free, and the current internal `setOristudioBpActiveSurface` bookkeeping
becomes redundant.

**How the active context is tracked:** one subscription to Dockview's
`onDidActivePanelChange` (in `App.tsx onReady`) maps panel id → context and
writes `activeEditingContext` into the store. This replaces the scattered
`setActiveShortcutViewportSurface` calls and the imperative
`setActiveEditingSurface` in `view.*` menu actions.

**`activeWorkspace` stays, but only as a layout grouping** (the rail's
Design/Edit/Simulate buttons + Dockview layout persistence scope). It no longer
drives shell behavior; behavior follows the active panel's context. The rail
buttons simply activate that workspace's primary panel, and the context follows.

## Phases

Each phase is independently landable and has an author-verifiable gate. Context
becomes the source of truth first; consumers migrate to it; legacy fields are
deleted last.

### Phase 1 — Context model + tracking (no behavior change)
- [ ] Define `EditingContext` + a `contextForPanelId(panelId)` map and a
      `contextDescriptor(context)` table (document/undo/menu-set metadata).
- [ ] Add `activeEditingContext` to the store, updated from a single
      `onDidActivePanelChange` subscription; seed it on layout mount.
- [ ] Leave `documentMode`/`activeEditingSurface` in place but **derive** them
      from context via a temporary shim so nothing else changes yet.
- **Gate:** focusing each panel (and switching rail workspaces) reports the
  correct `activeEditingContext` (inspect via the store); no visible behavior
  change.

### Phase 2 — History dispatch by context + BP snapshot history (fixes BP undo/redo)

**Why snapshot history (decision).** Wiring BP undo/redo to the ported engine
command-history surfaced two problems: (1) a correctness bug — redo of a
structural add (`add_leaf`/`split`) restores the edge but not the vertex *node*,
because `add_leaf` never records a vertex construct/destruct memento (undo works
because removals are recomputed; redo can't re-add), so a second redo errors
`missing BP tree vertex N`; and (2) coarse granularity — every session mutation
calls `history.flush()` = one step, so a compound frontend action (add-leaf =
`add_leaf` + reposition; length edit = `update_edge_length` + move-subtree)
produces two undo steps that can't auto-coalesce. Rather than chase memento gaps
in the ported command-history, **BP undo/redo will use a JS snapshot history**,
exactly like the CP editor already does (`oristudioCpHistoryPast/Future`):
snapshot the serializable BP project per user action; undo/redo restore a
snapshot. Restoring a full snapshot is always structurally correct, and we choose
the snapshot points, so one user action = one undo. The engine's internal
`undo/redoProject` become unused by the app.

- [x] **2a — Dispatch by context.** `undo`/`redo` switch on
      `activeEditingContext`: treemaker-tree → tree checkpoints; bp-* → BP
      history; crease-pattern → CP history; nux/simulate → no-op. (Done; the
      tree/CP paths are unchanged, BP is a new branch.)
- [ ] **2b — Generic snapshot-history primitive + BP adoption.**
  - Extract a small pure primitive `snapshotHistory<S>` (past/future arrays,
    `MAX_HISTORY`, clear-future-on-new-entry, push/undo/redo) so history is one
    data structure instead of N bespoke copies.
  - BP domain adapter: `capture()` = serialize the active BP project (wasm
    `project_for_export` / bps text); `restore(s)` = load it back into the engine
    handle and rebuild the document. Store `oristudioBpHistoryPast/Future`.
  - **Capture at the slice-action boundary, not per engine call.** Snapshot the
    previous project inside `runBpTreeMutation` (one snapshot per user action), so
    single-action mutations are one undo. Move compound flows into single slice
    actions so they capture once: fold the length-edit's subtree reposition (from
    `BpTreePanel.setEdgeLength`) into the `setOristudioBpTreeEdgeLength` slice
    action. Then add-leaf and length-edit are each exactly one undo.
  - Ignore the restored project's embedded engine history (we track undo in JS).
  - Per-action full serialize is fine at these tree sizes; optimize later only if
    it bites.
- [~] **2c — Migrate CP onto the same primitive (deferred fast-follow).** CP
      already snapshots the previous document per mutation (`cpHistoryEntry` +
      ~2 record sites in `projectSlice`) and restores in place — reshape its entry
      onto `SnapshotEntry<{document, selection}>` and route through
      `recordSnapshot`/`undoSnapshot`/`redoSnapshot`, keeping the CP-specific
      restore side effects (CAMV refresh, operation descriptors, fold-artifact
      staleness). Structurally identical; the strong CP suite guards it.
      **Deferred:** it's an internal refactor of a *working* system (BP, the pain
      point, is done), so it's split into its own focused change rather than
      landing at the tail of the context work. The primitive + BP adoption prove
      the vehicle; CP converges next.
- **Gate (author):** in a BP design, add node / move node / change length /
  (after Phase 4) delete node each undo **and redo** correctly in one step;
  TreeMaker and CP undo/redo still work (CP suite green); Simulate undo is inert.

**Deferred:** TreeMaker keeps its text-checkpoint history (pre-mutation `saveTmd5`
+ begin/commit, engine reload) for now — it is a genuinely different capture
model and folding it onto the primitive belongs with the documents-registry
cleanup (a non-goal here). The context dispatch already treats all three
uniformly, so this is purely an internal convergence left for later.

### Phase 3 — Capabilities, menus, shortcuts by context (fixes Design-menu + toolbar) ✅
- [x] Thread `activeEditingContext` into `WorkspaceCapabilityInput`, and make the
      Edit menu's undo/redo read the **BP** history count in a BP context (the
      TreeMaker/CP stacks are empty there). Done in both input builders
      (`capabilities.ts` + `useWorkspaceCapabilities.ts`) and the third inline copy
      in `projectSlice` was collapsed onto `selectWorkspaceCapabilities`.
- [x] Context-scope the menus via capability visibility: `maskCapabilitiesForContext`
      hides all `optimize.*`/`cp.*`, the TreeMaker tree-edit Edit submenus, and CP
      exports in a BP context; `MenuBar` drops top-level menus with no visible
      items, so the **Design** and **Crease Pattern** menus disappear in BP.
- [x] Gate `NextDocumentAction` (Optimize/Build) on capability visibility → hidden
      in BP.
- [~] Shortcut routing: TreeMaker shortcuts are **gated via capabilities**
      (`rejectDisabled` blocks the masked commands), and BP viewport shortcuts route
      by `activeViewportSurface`. A deeper `shortcutScopeStackForContext` migration
      wasn't needed for correctness and is deferred.
- **Gate (author):** verified live — in a BP design the menu bar shows only
  File/Edit/View/Help and no Optimize/Build toolbar; Edit▸Undo enables after a BP
  edit; TreeMaker (circle-packed) keeps its Design menu + toolbar; BP mask has a
  regression test; 465 web tests pass, lint + tsc clean.

### Phase 4 — Tree-authoring completeness (delete + friends)
- [ ] Expose `deleteOristudioBpTreeLeaf` (and `join/split/merge`, `rename`) as
      slice actions.
- [ ] Bind **Delete/Backspace** on a selected BP tree node (and `edit.delete`) to
      delete, routed through the context command set; same for TreeMaker.
- **Gate (author):** select a BP tree node, press Delete → node removed;
  undoable (Phase 2); works via Edit ▸ Delete too.

### Phase 5 — Always-live Edit canvas + Send-to-Canvas
- [ ] Create a blank editable `oristudioCpDocument` at startup so the Edit
      workspace is never empty.
- [ ] Reframe "Build CP" (TreeMaker) and add "Send to Edit" (BP, using
      `snapshot.creasePattern` — no legacy tree needed) as **producers that merge
      into the Edit CP** via the Import(Add) path. Duplicates OK.
- **Gate (author):** Edit workspace shows a live empty canvas before any design;
  building/sending from a circle-packed *and* a box-pleat design merges CP
  geometry into that canvas and focuses Edit.

### Phase 6 — Delete the legacy axes + split the polymorphic design panel
- [ ] Remove `documentMode`, `activeEditingSurface`, and `workflowTarget`-as-mode
      (keep design-kind only as a per-document attribute where genuinely needed).
- [ ] Split the polymorphic `design` panel into distinct panel components
      (`design-nux`, `design-treemaker`, `design-bp-tree`) so each has a static
      context — this is what makes future Design **tabs** trivial.
- [ ] Rewrite the ~40 tests keying off `documentMode`/`activeEditingSurface` to
      the context model. No compatibility shims remain.
- **Gate (author):** `rg documentMode|activeEditingSurface` returns nothing in
  `src/`; full suite green (engine, vitest, tsc, production build).

### Phase 7 — Simulate finalization + (optional) BP optimizer surface
- [ ] Finalize `simulate` as the read-only consumer context (menu set + inert
      undo).
- [ ] *(Optional, product-gated)* Surface the already-built
      `optimizeOristudioBpLayout` runtime behind a BP-context menu/toolbar entry
      with progress UI. Scope (replace-in-place vs open-new) is a separate
      decision.
- **Gate (author):** Simulate shows only playback/sequence commands; optimizer
  (if included) runs from the BP context and reports progress.

## Affected areas

- `apps/web/src/workspaces/` — `EditingContext`, `contextForPanelId`, descriptors.
- `apps/web/src/store/layoutStore.ts` + `App.tsx` — active-panel→context tracking;
  `activeWorkspace` demoted to layout-only.
- `apps/web/src/store/workspaceStore/**` — delete `documentMode`/
  `activeEditingSurface`/`workflowTarget`-as-mode; history dispatch; expose BP
  delete/undo/redo; blank-CP init; producer/merge build path.
- `apps/web/src/lib/workspaceCapabilities.ts` + `apps/web/src/menus/` +
  `apps/web/src/commands/menuActions.ts` — context-keyed capabilities/menus.
- `apps/web/src/keyboard/shortcutRuntime.ts` — context-derived scope stack.
- `apps/web/src/components/panels/` — split polymorphic `design` panel; toolbar
  gating; Delete-key binding.

## Non-goals

- Untangling the three parallel document stores (`project`,
  `oristudioCpDocument`, `oristudioBpDocument`) into a documents registry —
  separable; the context enum makes it easier later but this refactor doesn't
  require it.
- Building the Design-workspace **tabs** UI now — the model must *support* it
  (Phase 6 split), but the multi-tab UI is future work.
- Dedup/replace semantics for re-emitted CP geometry (duplicates OK for now).
- The BP optimizer UX beyond a minimal wiring (Phase 7 optional).
