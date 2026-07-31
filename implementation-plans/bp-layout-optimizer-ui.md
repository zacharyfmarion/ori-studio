# Box-Pleat Layout Optimizer UI

## Goal

Give the box-pleat design a **header-toolbar Optimize button** — the same slot in
`WorkspaceShell`'s toolbar that TreeMaker's `Optimize Scale` occupies, not a
panel-local control — plus a matching **Design ▸ Optimize Layout…** menu entry
that appears when a BP design is active. Both open a dialog with the
layout-optimizer options, run the optimizer with live progress, and apply the
result to the active BP project — **as a single undoable step, so one undo
restores the pre-optimize layout exactly.**

### Divergence policy

Default to Box Pleating Studio's behavior and wording
(`third_party/box-pleating-studio/src/app/vue/modals/optimizer.vue`,
`src/locale/en.json` → `plugin.optimizer`, `src/app/services/settingService.ts`
→ `tools.Optimizer`). Where this plan diverges it says so explicitly and why.
The complete list of divergences is:

| Divergence | Why |
| --- | --- |
| No "Show result in a new tab" (`openNew`) | Explicit product decision. We have no BP project tabs, so upstream's behavior has nowhere to land. Always replaces in place; undo is the recovery path. |
| No "Skip" button | Not a choice — our kernel has no cooperative interrupt, only worker termination. Recorded as `status: 'planned'` on `bp.optimize.skip`. |
| No "⚡ Multiple-processing activated" line | Our Rust `solve` is single-threaded; upstream's `dist_mp` build is not. Nothing true to display. |

Everything else — labels, defaults, control ranges, which stages show progress,
what the run destroys — follows upstream.

## Background: the backend already exists

This is a **frontend-only** feature. Everything below the UI is already built and
tested; the gap is that nothing calls it.

| Layer | State |
| --- | --- |
| Rust kernel (`crates/oristudio-bp/src/optimizer.rs`, 2.7k lines) | Faithful port of BP Studio's C++/NLopt optimizer — SLSQP pack, basin-hopping, AreaTree candidate generation, greedy integer fitting, rect + diagonal sheets |
| Parity harness (`crates/oristudio-bp/tests/optimizer_oracle.rs`) | 400+ differential cases against the vendored WASM optimizer |
| WASM exports (`crates/oristudio-bp-wasm/src/lib.rs`) | `bp_optimizer_request`, `bp_optimizer_solve_report_with_progress`, `bp_optimizer_template` |
| Dedicated worker (`apps/web/src/workers/oristudioBpOptimizerWorker.ts`) | Comlink-wrapped, own worker so it can be terminated to cancel |
| Runtime round-trip (`apps/web/src/store/workspaceStore/oristudioBpRuntime.ts:494` `optimizeOristudioBpLayout`) | Builds the request, solves with progress, validates the packing, then either replaces the project in place or opens the result as a new one |
| Progress mapping (`optimizerProgressFromEvent`, same file) | Kernel events → `OristudioBpOptimizerProgress` with stage, label, current/total |
| Cancel (`cancelActiveOristudioBpOptimizer`) | Terminates the worker and surfaces `optimization_cancelled` |
| Types (`apps/web/src/engine/oristudioBpTypes.ts`) | `OristudioBpOptimizerOptions`, `…Progress`, `…Stage`, `…Event` |

`optimizeOristudioBpLayout` has **zero callers**. There is no store action, no
dialog, and no button. That is the whole of this plan.

## Approach

### Phase 1 — capability, toolbar button, and Design menu entry

`optimize.*` capabilities are deliberately hidden in BP contexts
(`workspaceCapabilities.ts:909`), so BP needs its own id rather than reusing
`optimize.scale`. One capability drives both surfaces.

1. Add `'bp.optimize.layout'` to `WorkspaceCapabilityId` in
   `apps/web/src/lib/workspaceCapabilities.ts`.
2. Add `boxPleatTreeEdgeCount: number` to `WorkspaceCapabilityInput`, sourced in
   `useWorkspaceCapabilities.ts` from
   `oristudioBpDocument?.snapshot.tree.edges.length ?? 0`. This is the gate BP
   Studio uses and matches the catalog's existing `disabledReason: 'Add BP tree
   edges before optimizing'`.
3. Compute the capability: **visible** whenever a BP design is active
   (`isBpContext` — both the `bp-tree` and `bp-packing` editing contexts, since
   the toolbar and menu bar are global chrome, not pane-local); **enabled** when
   `hasBoxPleatDocument && boxPleatTreeEdgeCount > 0 && !isBusy` and no optimizer
   run is in flight. Hide it in every non-BP context, next to the existing
   `cp.*` / `optimize.*` masking.
4. **Toolbar button** — `Toolbar()` in
   `apps/web/src/components/WorkspaceShell.tsx`, inside the existing
   `isBpContext` branch and **before** "Send to Edit". `Optimize` is the
   authoring step and `Send to Edit` the hand-off, mirroring TreeMaker's
   `Optimize Scale` → `Send to Edit` pair in the same slot. Use `Sparkles` at
   `size={14}`, `variant="primary"`, and demote "Send to Edit" to `secondary`
   while `bp.optimize.layout` is enabled, matching how `optimizeScale`/`buildCp`
   already trade primacy.
5. **Design menu entry** — add `bp.optimize.layout` to the existing Design menu
   in `apps/web/src/menus/menuDefinition.ts`, above the `optimize.*` group.
   Today that menu is `optimize.scale/edges/strain` + `cp.build`, and the BP
   mask hides all four, so `MenuBar`'s `menuHasVisibleItems` filter drops the
   whole Design menu in a BP design. Adding this item is what brings it back,
   with exactly one entry — no new menu, no new machinery. Label
   `Optimize Layout…` (ellipsis: it opens a dialog).
6. Register the id in `apps/web/src/commands/menuActions.ts` (`MenuActionId`
   union + dispatcher case) so both surfaces go through `handleMenuAction` —
   that is the app's single command path, and the toolbar button should use it
   too rather than calling the store directly.
7. Both surfaces only **open the dialog**; neither runs the optimizer directly.
8. No keyboard shortcut in this pass. Upstream has none, and if one is added
   later it goes in `apps/web/src/keyboard/` via the shortcut registry — never a
   local listener.

### Phase 2 — options state and the dialog

Option state is **session/tool state, not document state.** Note that
`OristudioBpDocumentState.optimizer` already exists as a mirror of BP Studio's
per-project optimizer state and is only ever the default from
`defaultOptimizerState()`. Do not repurpose it — it belongs to the snapshot
mapper's parity surface. Put the UI's options in a small dedicated store so they
persist across documents, the way BP Studio's `Settings.tools.Optimizer` does.

1. New `apps/web/src/store/bpOptimizerUiStore.ts` (Zustand), holding:
   - `isOpen`, `open()`, `close()`
   - `options: OristudioBpOptimizerOptions` plus `setOptions(partial)`
   - `running`, `progress: OristudioBpOptimizerProgress | null`, `error: string | null`
2. Persist only the options through `apps/web/src/lib/storage.ts` — add
   `bpOptimizer: 'bp-optimizer'` to `STORAGE_KEYS` and use the existing typed
   helpers. Never hand-roll `localStorage`.
3. New `apps/web/src/components/BpOptimizerModal.tsx`, mounted in `App.tsx`
   beside `SelectByIndexModal` / `CpDetectImportModal`. Follow the
   `SelectByIndexModal` conventions exactly: `role="dialog"`, `aria-modal`,
   `.simple-modal` / `__document` / `__header` / `__body` / `__footer` classes,
   backdrop `onMouseDown` close, capture-phase Escape listener, `IconButton`
   close in the header.
4. Controls, mapping one-to-one onto `OristudioBpOptimizerOptions`:

   Labels are upstream's verbatim (`src/locale/en.json` → `plugin.optimizer`),
   including the ones my earlier draft paraphrased:

   | Label (upstream wording) | Type | Field | Default | Notes |
   | --- | --- | --- | --- | --- |
   | *Options* (group label) | — | — | — | Row label, matching upstream's layout |
   | Keep widths and heights of flaps | `Toggle` | `useDimension` | `true` | |
   | *Layout method* | `Select` | `layoutMode` | `'view'` | Options: **Use current layout as reference** / **Try random layouts** |
   | Try variations of the current layouts | `Toggle` | `useBasinHopping` | `false` | Only when `layoutMode === 'view'` |
   | Number of layouts to try: | number input, 1–100, step 1 | `randomCandidateCount` | `1` | Only when `layoutMode === 'random'` |

   Defaults are upstream's from `settingService.ts` → `tools.Optimizer`
   (`layout: "view"`, `useDimension: true`, `useBH: false`, `random: 1`) — **not**
   the values in the screenshot, which are that user's persisted state. Keeping
   upstream's defaults also happens to put first-run users on the cheap path
   (see R1).

   Keep the 1–100 range. It is upstream's, and the answer to slow runs is
   progress and Abort, not a narrower control.

   `openNew` is always `false` — no toggle, not persisted. `seed` stays out of
   the UI: pass `null` so the run randomizes, and keep the field settable from
   tests.
5. Dialog title **Optimize layout**. Footer: **Close** (ghost) and **Run!**
   (primary, `Play` icon) while idle; while running the body becomes the
   progress area, the run button reads **Running...** and is disabled, and the
   destructive slot becomes **Abort**. As upstream does, the dialog stays open
   for the duration of the run and closes itself on success.

### Phase 3 — the run action, as one undoable step

BP undo is **snapshot-based**: `historySlice.navigateBpHistory` restores a whole
previous project from a serialized `.bps` string
(`BpHistorySnapshot = { bps, selection }`), deliberately in preference to the
ported engine command-history, "which mis-restores structural adds". That is
exactly the mechanism this feature needs — the optimizer rewrites the sheet
size, every flap position, and clears stretches, and a `.bps` snapshot captures
all of it.

1. Add `optimizeOristudioBpLayout(options)` to
   `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts`, running it
   **through the existing `runBpTreeMutation` flow** rather than hand-rolling the
   history bookkeeping. That helper already does the three things that make
   undo correct:
   - captures `exportOristudioBpProjectAsBps()` **before** the operation runs,
   - pushes exactly one entry on success (`recordSnapshot`),
   - clears `pendingHistory` on failure so a failed run leaves no entry.

   Label the entry "Optimized BP layout" so undo reads *"Undid Optimized BP
   layout"*.
2. Pass an `onProgress` callback that writes into the optimizer UI store (see R3
   — coalesce it).
3. `activeSurface: 'packing'` on the returned document — the result is a packing,
   so the workspace should land there (and `BpEditorPanel`'s "Run Optimize Layout
   or materialize a packing…" empty state resolves itself).
4. Treat `optimization_cancelled` as a non-error and **not** as a mutation:
   no history entry, no toast, document untouched. `runBpTreeMutation`'s catch
   path currently sets `oristudioBpError` — cancel must bypass that.
5. Wire `Abort` to `cancelActiveOristudioBpOptimizer()`.
6. Hold `oristudioBpBusy` for the entire run and confirm the BP tree/packing
   panels refuse edits while it is set — a tree edit mid-run would be silently
   overwritten by the result, and the already-captured snapshot would undo past
   it (R4).

### Phase 4 — progress display

`OristudioBpOptimizerProgress` already carries `stage`, `label`, `current`,
`total`, `canSkip`, `canCancel`, `message`.

1. There is no determinate progress-bar primitive in `components/ui/` — add a
   minimal one (or inline it in the modal with `theme.css` rules alongside
   `.simple-modal`). Do not reuse `.sequence-planning-progress`; that one is
   indeterminate.
2. Render `label` + `current`/`total` when `total` is non-null, indeterminate
   otherwise. `candidate-generation` and `integral-grid-fitting` are the two
   stages with real denominators.
3. Ignore `canSkip` for now (always false in practice) and do not render a Skip
   button until the kernel gains a cooperative interrupt.

### Phase 5 — i18n and tests

1. All new strings inline as `t('<ns>:<key>', 'English default')` — `common` for
   the toolbar button, `dialogs` for the modal. Then `npm run i18n:extract`,
   translate the new keys for all 8 locales, `npm run i18n:stamp`,
   `npm run i18n:check`.
2. Tests:
   - `workspaceCapabilities.test.ts` — `bp.optimize.layout` visible only in BP
     contexts, disabled with no tree edges / while busy.
   - New `BpOptimizerModal.test.tsx` — conditional rendering of the
     basin-hopping toggle vs. the candidate-count input, and that `Run!`
     dispatches the current options.
   - BP slice test — the undo contract, explicitly: success installs the
     document and pushes exactly one history entry whose snapshot is the
     **pre-optimize** `.bps`; undo restores the original sheet size, flap
     positions, and stretches; cancel and error leave the document untouched
     and push nothing.
3. `oristudioBpCommands.ts`: flip `bp.optimize.skip` /
   `bp.optimize.applyResult` / `bp.optimize.openResultAsNew` statuses only if
   this work actually lands them; otherwise leave them `planned`.

## Affected Areas

- `apps/web/src/lib/workspaceCapabilities.ts` — new `bp.optimize.layout` capability, new input field, BP-context masking
- `apps/web/src/store/workspaceStore/useWorkspaceCapabilities.ts` — feed BP tree edge count
- `apps/web/src/components/WorkspaceShell.tsx` — header-toolbar button in the BP branch
- `apps/web/src/menus/menuDefinition.ts` — Design menu entry
- `apps/web/src/commands/menuActions.ts` — `MenuActionId` + dispatcher case
- `apps/web/src/store/bpOptimizerUiStore.ts` — **new**, dialog + options state
- `apps/web/src/lib/storage.ts` — new persisted key
- `apps/web/src/components/BpOptimizerModal.tsx` — **new**
- `apps/web/src/App.tsx` — mount the modal
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` — run/cancel action
- `apps/web/src/store/workspaceStore/types.ts` — slice signature
- `apps/web/src/styles/theme.css` — progress bar rules
- `apps/web/public/locales/*/{common,dialogs}.json` — generated + translations
- Tests as listed in Phase 5

No Rust, WASM, or Tauri changes. No vendored source changes.

## Risks and mitigations

### R1 — Random mode is slow, and the slow setting is the good setting

Measured with the real Rust kernel, **native release build**, synthetic random
trees, on this machine:

| case | time | resulting grid |
| --- | --- | --- |
| 10 flaps, view, no variations | 13 ms | 78 |
| 24 flaps, view, no variations | 210 ms | 152 |
| 24 flaps, view + variations | 929 ms | 152 |
| 16 flaps, random ×6 | 731 ms | 86 |
| 16 flaps, random ×20 | 2.8 s | 62 |
| 16 flaps, random ×50 | 6.9 s | 62 |
| 16 flaps, random ×100 | 13.3 s | 66 |

Two things fall out. Cost is roughly linear in the candidate count and steep in
flap count. And **quality improves sharply with the count** (16 flaps: grid 86
at ×6 → 62 at ×20), so users are pushed toward exactly the expensive end.

Worse in the browser than the table suggests, for two independent reasons: it
runs as WASM, and our `solve` is **single-threaded**, where BP Studio's shipping
build fans candidates out across cores with OpenMP. BP Studio's responsiveness at
×100 is not a fair expectation for us.

Mitigations, within the divergence policy — **do not narrow the 1–100 range**;
that is upstream's control and shrinking it to hide a performance gap is exactly
the kind of quiet divergence to avoid.

- Upstream's defaults already put first-run users on the cheap path
  (`view`, no variations, count 1 — 13 ms at 10 flaps). The expensive setting is
  opt-in, which is most of the mitigation.
- Progress must render from the first event, and Abort must stay enabled
  throughout.
- Measure the WASM multiplier during the browser check so we know what we ship.
  If it is bad enough to warrant a warning above some count, treat that as a
  deliberate, documented addition — not a silent cap.
- The real fix is rayon + wasm threads in the kernel, closing the gap to
  upstream's `dist_mp` build. Out of scope here; worth its own plan if random
  mode becomes the common path.

### R2 — Every run pays worker + WASM instantiation

`solveOptimizerRequestWithProgress` terminates and recreates the optimizer worker
at the start of every solve, and terminates it again in `finally`. So each run
re-instantiates the WASM module. For a 13 ms view-mode solve the fixed cost
plausibly dominates the actual work.

- Measure the instantiation cost. If material, keep the worker warm and terminate
  only on cancel. Low-risk change — termination is the cancel mechanism, nothing
  else depends on the churn.

### R3 — Progress event flood can starve the main thread

The kernel emits one `cont` event per basin-hopping iteration per candidate.
Random ×50 at 50 iterations is on the order of 2,500 events, each a Comlink
`proxy()` call — one `postMessage` plus a store write plus a React render — and
they arrive exactly when the user most wants a responsive Abort button.

- Coalesce in the runtime's `onProgress` before it reaches the store: latest-wins,
  flushed on a rAF or ~100 ms timer. Build this in from the start rather than
  after a jank report.

### R4 — Three specific ways the undo contract breaks

The mechanism is sound (whole-project `.bps` snapshot), but:

- **Snapshot captured after the solve** would make undo restore the *optimized*
  state. `runBpTreeMutation` captures before the operation — use it, don't
  reimplement it.
- **Cancel or error pushing an entry** would leave a no-op undo step. The helper
  clears `pendingHistory` on throw; cancel additionally must not set
  `oristudioBpError`.
- **An edit during a long run** would be clobbered by the result, and the
  pre-captured snapshot would undo past it. Hold `oristudioBpBusy` for the whole
  run and verify the BP panels actually honor it — a 13-second window is more
  than enough time for a user to drag a vertex.

All three are covered by the Phase 5 slice tests; write them first.

### R5 — Optimize silently destroys stretches

`write_to_template` clears `design.layout.stretches` and forces
`mode = Layout`, faithfully to upstream's `writeToTemplate`. A user who has
hand-tuned stretch patterns loses them with no warning.

**Decided: no warning, matching upstream.** Undo restores them — they are in the
`.bps` snapshot — and that is the recovery path. Adding a confirmation would be a
divergence, so it stays out unless we later decide to make it one deliberately.
Worth a line in the release notes.

### R6 — The result can place a flap past the sheet edge

Upstream sizes a rectangular sheet from **anchor coordinates only**, ignoring
flap width/height (`Rect::output`), and our port preserves that;
`validate_optimizer_packing` correspondingly only checks anchors. With "Keep
widths and heights of flaps" on — the default — a dimensioned flap can overhang.
Reproduced against the vendored WASM: a 12×9 flap anchored at (0,4) with a
reported sheet of 4.

- **Do not "fix" the kernel.** It is covered by 400+ oracle parity cases and this
  is upstream behavior. Treat it as a display concern at most.
- Tell QA about it up front so it does not get filed as a UI regression.

### R7 — We are missing upstream's minimum-size clamp

Upstream clamps the result through `grid.$fixDimension` before applying it
(`MIN_DIAG_SIZE = 6`, `MIN_RECT_SIZE = 4`; see `checkOptimizerResult` in
`src/client/plugins/optimizer/index.ts`). Our `check_optimizer_result` validates
finiteness, integrality, and the 8192 ceiling but **has no floor clamp**, while
the kernel's own floor is `MIN_SHEET_SIZE = 4` — under the app's diagonal
minimum of 6.

This is a **missing port, not a divergence to preserve**: adding the clamp moves
us toward upstream. Do it in the store action (frontend), exactly where upstream
does it, so kernel oracle parity is untouched. Add a small-diagonal-design test.

### R8 — Capability masking regression

Adding a `WorkspaceCapabilityId` means touching the per-context mask lists; it is
easy to leak the button into Edit or Simulate.

- Assert per-context visibility in `workspaceCapabilities.test.ts`.

### R9 — Modal keystrokes reaching tool shortcuts

`isShortcutEditingTarget` covers `input`/`textarea`/`select`/contenteditable, so
the candidate-count field is safe. The `Toggle` and Radix `Select` trigger are
**buttons**, so a keystroke while one has focus falls through to the shortcut
dispatcher.

- Verify against the active BP scope stack; if a chord does leak, gate the
  dispatcher on modal-open state. Do **not** write a near-copy of
  `isShortcutEditingTarget` in the modal — AGENTS.md calls that out by name.

### R10 — i18n gate

CI fails on English strings without translations for all 8 locales. Phase 5 is
not optional and is not a follow-up PR.

## Checklist

- [ ] Phase 1: `bp.optimize.layout` capability, BP tree edge count input, context masking
- [ ] Phase 1: header-toolbar button in the BP branch of `WorkspaceShell.Toolbar`
- [ ] Phase 1: Design menu entry + `menuActions` dispatch; confirm the Design menu reappears in BP and stays hidden elsewhere
- [ ] Phase 2: `bpOptimizerUiStore` with persisted options via `lib/storage.ts`
- [ ] Phase 2: `BpOptimizerModal` with upstream's labels, defaults, and 1–100 range, mounted in `App.tsx`
- [ ] Phase 3: run action via `runBpTreeMutation`, one history entry, cancel is a no-op
- [ ] Phase 3: `oristudioBpBusy` blocks BP edits for the whole run (R4)
- [ ] Phase 4: determinate progress bar, stage labels, coalesced progress (R3)
- [ ] R7: port upstream's `$fixDimension` minimum-size clamp into the store action
- [ ] Phase 5: i18n extract / translate / stamp / check
- [ ] Phase 5: capability, menu-visibility, modal, and undo-contract tests
- [ ] Validation: `npx tsc --noEmit`, `npm --workspace @treemaker/web exec -- vitest run`, `npm run lint:web`, `npm run i18n:check`
- [ ] Browser check: optimize end to end in `view` and `random` modes, rect and diagonal sheets, then undo and confirm the original layout returns
- [ ] Browser check: measure a real WASM run at counts 1 and 20 so we know the shipped cost (R1)

## Open questions

None blocking. Settled during planning:

- **Placement** — header toolbar (the `Optimize Scale` slot) plus a Design menu
  entry, both visible whenever a BP design is active. Not panel-local.
- **Open result as a new project** — dropped; see the divergence table.
- **Warn before discarding stretches** — no, matching upstream (R5).

## References

- Upstream modal: `third_party/box-pleating-studio/src/app/vue/modals/optimizer.vue`
- Upstream algorithm notes: `third_party/box-pleating-studio/src/client/plugins/optimizer/src/README.md`
- Upstream progress protocol: `optProgress.vue` + the JSON-line events printed by the C++ kernel
