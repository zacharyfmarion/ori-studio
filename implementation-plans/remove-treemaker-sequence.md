# Remove treemaker-sequence

## Goal

Delete the `treemaker-sequence` crate and every surface built on it. It was a
folding-sequence research attempt that did not work out, and it is still wired
through the wasm bridge, the worker, the workspace store and a registered
`sequence` panel — so contributors read it as a working feature. Nothing in the
shipping UI can reach it: no code path adds the `sequence` panel to a dock, and
the simulator's only entry point into it is a toolbar group hard-coded to
`display: none`.

Removal is the whole vertical slice, not just the crate — leaving the TypeScript
half in place would preserve exactly the confusion this is meant to end.

## Approach

Delete from the bottom up so each layer's consumers are already gone:

1. **Rust** — drop the crate, its workspace member and workspace dependency, the
   `treemaker-wasm` dependency, and the three `sequence_*` wasm exports plus
   their private helpers. Regenerate `Cargo.lock`.
2. **Worker + types** — drop the three worker methods and the `Sequence*` type
   block in `engine/types.ts`.
3. **Store** — drop the five `sequence*` state fields, the two actions
   (`analyzeSequenceTarget`, `planFoldingSequence`), `setSequenceSimulationFocus`,
   the `SequenceSimulationFocus` union, and `FoldArtifactDependentState` (which
   is *entirely* those five fields, so `staleFoldArtifactResourceState` collapses
   to returning `FoldArtifactResourceState`).
4. **UI** — delete `SequencePanel`, `lib/sequenceSimulation.ts`, the panel
   registration and its `sequence` → `simulate` workspace/editing-context
   mappings.
5. **Simulator** — remove the `step` scope. With sequence gone, `simulatorMode`
   is always `"whole"`, so the hidden scope control, the step chips, the
   step-accuracy control and the step branches all become unreachable. Reduce
   `lib/simulatorRunConfig.ts` to the whole-model profile that the live simulator
   actually uses.
6. **Locales** — drop the `sequence` namespace from all nine `panels.json` files
   and the now-unused `simulator.*` step keys.
7. **Docs** — README, AGENTS.md, LICENSING.md, NOTICE, and the two
   implementation plans that reference the crate.

Explicitly **not** touched, despite matching a `sequence` grep:

- `cp-workspace/tools/stepSequenceTool.ts` / `sequenceSteps.ts` — Oriedita's
  click-sequence tool engine, unrelated.
- `selectedSegmentId` and `buildSegmentSimulationFold` — crease-pattern segment
  simulation is a separate live feature.
- `modelRequestSequence` / `foldedFigureRequestSequence` — request counters.

## Affected Areas

- `crates/treemaker-sequence/` (deleted), `crates/treemaker-wasm`, `Cargo.toml`,
  `Cargo.lock`
- `apps/web/src/workers/treemakerWorker.ts`, `apps/web/src/engine/types.ts`
- `apps/web/src/store/workspaceStore/` — `types.ts`, `engineRuntime.ts`,
  `foldArtifactResource.ts`, `slices/creasePatternSlice.ts`,
  `slices/projectSlice.ts`
- `apps/web/src/components/panels/` — `SequencePanel.tsx` (deleted),
  `PanelComponents.tsx`, `SimulatorPanel.tsx`
- `apps/web/src/lib/` — `sequenceSimulation.ts` (deleted), `simulatorRunConfig.ts`
- `apps/web/src/workspaces/` — `workspaces.ts`, `editingContext.ts`
- `apps/web/public/locales/*/panels.json`
- `README.md`, `AGENTS.md`, `LICENSING.md`, `NOTICE`, `implementation-plans/`

## Checklist

- [x] Delete the crate and clear the Rust dependency graph
- [x] Remove the three `sequence_*` wasm exports and helpers
- [x] Remove the worker methods and `Sequence*` engine types
- [x] Remove the store state, actions, and `FoldArtifactDependentState`
- [x] Delete `SequencePanel` and `sequenceSimulation`, unregister the panel
- [x] Collapse the simulator to whole-model scope
- [x] Drop the `sequence` locale namespace and dead simulator keys
- [x] Update docs
- [x] Validate: cargo fmt/clippy/test, web lint/typecheck/test/build, i18n check
- [x] Open draft PR
