# Reconciling the WebGL-migration branch with `main`

Plan for merging `claude/peaceful-volhard-208bfc` (WebGL CP-canvas migration + compact
geometry transport + CAMV-defer fix) into `main`. Written after a **trial merge** (aborted)
so the conflict surface below is measured, not guessed.

## Situation

- Branch is **120 commits ahead** of `main`, **73 commits behind**. Fork point (merge-base):
  `d6f47996`.
- **Branch theme:** the entire SVG→WebGL crease-pattern canvas migration (Phases 0–8; Phase 9
  dropped), plus the compact geometry transport and the CAMV-defer felt-latency fix. Net diff
  vs merge-base: ~108 files, huge deletions (the SVG surface is gone).
- **`main` theme (the 73 commits):** Box-Pleating (BP) Studio work (undo/redo, `.bps`
  interchange, Design NUX), "Send to Edit", multi-doc `.osf` save — and, most importantly, the
  **active-editing-context refactor** that *removed the `documentMode` / `activeEditingSurface`
  store axes* (commit `c549d9b9`, "Phase 6 (5c)"). `main` does **not** contain any of the WebGL
  migration.

**The headline:** git-level conflicts are small (5 files). The real work is a **semantic**
mismatch — the branch still uses store axes `main` deleted (**180 references across 25 files**).
Those don't show up as merge conflicts (they live in files `main` didn't touch), but they break
`tsc` after the merge. Budget accordingly: the conflicts are an afternoon; the axis migration is
the bulk.

## Strategy

**Merge `main` into the branch** (`git merge main`), not rebase. Rebasing 120 commits would
replay the same conflicts dozens of times; a single merge commit resolves each once and preserves
the branch history. Then fix the semantic breakage using `tsc` + the test suites as the worklist,
and gate on the full CI checks. Keep `main`'s BP work verbatim (it's orthogonal to the CP canvas);
keep the branch's SVG deletion (WebGL is the surface now).

Do the reconciliation on a throwaway integration branch off the feature branch first
(`git switch -c reconcile/webgl-main && git merge main`) so an ugly attempt is disposable.

## Textual conflicts (5 files, from the trial merge)

1. **`store/workspaceStore/useWorkspaceCapabilities.ts`** (1 hunk) — HEAD side empty; `main`
   added `oristudioCpSelectedVertexCount` and `hasDeletableBpSelection` to the capability object.
   → **Keep `hasDeletableBpSelection`** (BP, orthogonal). **Drop `oristudioCpSelectedVertexCount`**
   — the branch removed vertex selection entirely. Confirm no remaining reader of the vertex count.

2. **`store/workspaceStore/slices/projectSlice.ts`** (1 hunk) — HEAD builds capabilities inline
   with the removed axes (`documentMode`, `activeEditingSurface`, per-surface history counts);
   `main` replaced it with `selectWorkspaceCapabilities(get())` (single context-aware builder).
   → **Take `main`'s `selectWorkspaceCapabilities(get())`.** Verify that builder already threads
   the CP selection counts the branch needs (`oristudioCpSelectedLine/Point/CircleCount`); if any
   are missing, add them to the shared builder rather than reintroducing the inline copy.

3. **`store/workspaceStore/slices/historySlice.ts`** (1 hunk) — `main` added BP undo/redo
   (`navigateBpHistory`) and its own `refreshAlwaysOnCamvDiagnostics` helper, and wrapped
   `createHistorySlice` in a closure. HEAD changed CP history (deferred CAMV; snapshots now
   decoded from the compact transport). → **Take `main`'s closure + BP undo/redo verbatim**, then
   re-apply the branch's CP-history changes inside it. **Deduplicate `refreshAlwaysOnCamvDiagnostics`:**
   the branch also defines it in `projectSlice.ts`; converge on one definition and keep the
   branch's **deferred** CAMV semantics for CP edits (the CAMV-defer fix, commit `91147f91`).

4. **`components/panels/CreasePatternPanel.tsx`** (2 hunks):
   - Hunk ~885: HEAD selects `currentTheme` + `setActiveEditingSurface`; `main` selects
     `selection` + `select`. → **Keep both real hooks** (`currentTheme`, and `main`'s
     `selection`/`select` if the panel uses them); **drop `setActiveEditingSurface`** (removed
     axis — see the axis migration below for what replaces its call sites).
   - Hunk ~1623: HEAD's WebGL `resolveEditableDrawModelPoint`; `main`'s SVG
     `handleSelectionMovePointerDown` / `handleSelectionResizePointerDown`. The SVG selection
     handlers **pre-date the fork** (present on merge-base and main, unchanged by main) and the
     branch **intentionally deleted them** with the SVG surface. → **Take HEAD** (the branch's
     WebGL code); nothing to port from main here.

5. **`components/panels/CreasePatternPanel.test.tsx`** (modify/delete) — branch **deleted** this
   test file (rebuilt tests around the pure WebGL modules); `main` modified it (Phase 6 5c edits).
   → **Keep it deleted.** Check whether `main`'s modifications added coverage worth preserving; if
   so, re-express it against the branch's new test modules, not the old file.

## The dominant work: migrate off the removed store axes

`main`'s `c549d9b9` deleted `documentMode`, `activeEditingSurface`, and `setActiveEditingSurface`,
replacing them with a **derived** `activeEditingContext: EditingContext` (computed from
`activePanelId` + design state via `resolveEditingContext` in `apps/web/src/workspaces/editingContext.ts`).
The branch references the old axes **180× across 25 files**. After the textual merge, `tsc` will
flag every one — that list *is* the worklist.

**Mapping (follow `c549d9b9` — it migrated main's own readers the same way):**
- Reads: `activeEditingSurface === 'crease-pattern'` → `activeEditingContext === 'crease-pattern'`;
  `activeEditingSurface === 'tree'` → `activeEditingContext === 'treemaker-tree'`; other surfaces
  → their context value in the `EditingContext` union. `documentMode` reads → `activeEditingContext`
  (or `importedCreasePattern` for a CP-presence check, per the commit message).
- Writes: there is no setter. `setActiveEditingSurface('crease-pattern')` → set **`activePanelId`**
  to the corresponding panel so the context *derives* correctly (load/create actions in `c549d9b9`
  show the pattern). Every branch call site that *set* the surface must instead route the panel.

The 25 files (branch refs): `App.tsx`, `commands/menuActions.ts`, panels
(`CreasePatternPanel`, `ConditionsPanel`, `DesignPanel`), `keyboard/shortcutRuntime.ts`,
`lib/appKeyboard.ts`, `lib/workspaceCapabilities.ts`, and store slices (`capabilities`,
`clipboardSlice`, `conditionSlice`, `creasePatternSlice`, `editingSlice`, `historySlice`,
`projectSlice`, `types`, `useWorkspaceCapabilities`). Work file-by-file off the `tsc` errors;
`c549d9b9` is the reference diff for each analogous reader.

## Other semantic items

- **BP Studio (undo/redo, capabilities, `.bps`, Design NUX):** entirely `main`'s; **keep as-is**.
  The branch never touched BP. Watch only the shared seams (history slice, capabilities, menu).
- **Vertex selection:** the branch removed it app-wide; drop main's re-references
  (`oristudioCpSelectedVertexCount`, any `toggleOristudioCpVertexSelection`).
- **CAMV:** keep the branch's **deferred** recompute (`91147f91`) for CP edits; reconcile the
  duplicate `refreshAlwaysOnCamvDiagnostics` (see conflict #3). Document-load paths still refresh
  it eagerly.
- **Compact transport:** self-contained (new files + the runtime fetch swap); no expected
  interaction with main. `apps/web/src/generated/**` (wasm) is force-tracked — after merge, rebuild
  wasm once (`npm run build:wasm`) and commit the deterministic output if it differs.

## Execution order

1. `git switch -c reconcile/webgl-main` off the feature branch; `git merge main`.
2. Resolve the **5 textual conflicts** per above.
3. `cd apps/web && npx tsc --noEmit` → this enumerates the ~180 axis breakages. Migrate them
   file-by-file to `activeEditingContext` / `activePanelId` (reference: `c549d9b9`). Re-run `tsc`
   to convergence.
4. `npx eslint` the touched files; `npx vitest run` — fix fallout (esp. store/panel/capabilities/
   history tests; some assert the old axes and must move to context).
5. Rust: `git merge` should auto-merge `Cargo.lock` cleanly; run `cargo fmt --check`,
   `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.
6. Rebuild wasm (`npm run build:wasm`), commit any deterministic regen.
7. Full green gate = CI parity: `tsc`, `eslint`, `vitest` (web) + `fmt`/`clippy`/`test` (rust).
8. **Browser verification (the part tools can't cover):** on a merged build — CP editor draw/
   select/move/undo/redo still work; **BP Studio** (undo/redo, Send to Edit, `.bps`) still works;
   panel/context switching (Design ↔ Edit ↔ Simulate) routes correctly now that the branch is on
   `activeEditingContext`.

## Risks

- **Axis migration is broad but mechanical** — the risk is a *missed* reader that compiles but
  behaves wrong (e.g. a context comparison with the wrong union value). Mitigate by diffing each
  migrated site against the analogous one in `c549d9b9`, and by the browser context-switching pass.
- **History slice is the densest seam** — BP undo/redo (main) and CP deferred-CAMV + compact
  snapshots (branch) both live there. Resolve carefully; test undo/redo on both CP and BP.
- **Hidden auto-merges** — 12 both-touched files auto-merged; skim them (esp. `capabilities.ts`,
  `creasePatternSlice.ts`, `types.ts`) for silently-wrong combinations before trusting `tsc`.
- **Scope** — this is a large PR reconciled against a heavily-advanced main. If review proves
  unwieldy, a fallback is to land the compact-transport + CAMV-defer fix as a **small standalone
  PR** first (they're nearly self-contained), shrinking the big PR — but that too must sit on
  main's post-`c549d9b9` architecture.

## Rollback

The reconciliation lives on `reconcile/webgl-main`; if it goes sideways, delete it and retry. The
feature branch is untouched until the reconciliation is green and reviewed.
