# Inline simulations in undo (and in the dirty flag)

## Goal

Deleting a simulation window and pressing undo brings it back, at the fold it
was showing. Opening, moving, resizing and rebuilding a window are undoable the
same way, and any of them marks the project as having unsaved changes.

## Root cause

Windows are **document state for saving and session state for everything else**,
and nothing reconciled the two when they became persistent.

`oristudioCpInlineSimulations` is written to and read from `.osf`
([projectSlice.ts:1249](apps/web/src/store/workspaceStore/slices/projectSlice.ts:1249),
[projectSlice.ts:1000](apps/web/src/store/workspaceStore/slices/projectSlice.ts:1000)).
It appears **nowhere** in the history slice: not in `OristudioCpHistoryEntry`
([types.ts:72](apps/web/src/store/workspaceStore/types.ts:72)), not in
`cpHistoryEntry`, not in either undo branch. So undo restores the document, the
selection, the annotations and the folded figures, and silently leaves the
windows exactly as they are.

That was a correct decision when it was made, and it is written down as one:

- `implementation-plans/inline-simulation-windows.md:401` — "Undo/redo **not
  applicable**: windows are session-only, so a move or resize is not a document
  edit and takes no history checkpoint."
- [CreasePatternPanel.tsx:1350](apps/web/src/components/panels/CreasePatternPanel.tsx:1350)
  says the same at the gesture handlers, which is why a window move takes no
  checkpoint.
- [inlineSimulationRuntime.ts:7](apps/web/src/cp-workspace/inlineSimulation/inlineSimulationRuntime.ts:7)
  still describes the descriptor as "exactly what would be written to disk **if
  these ever persist**".

Then `persist-inline-simulations.md` made them persist. It is a thorough plan —
it has a whole "Decisions and rejected alternatives" section — and it does not
mention undo, history, or the dirty flag once. The premise every one of those
comments rests on was invalidated, and nothing went back to them.

### The same gap costs unsaved work, not just undo

None of `addOristudioCpInlineSimulation`, `updateOristudioCpInlineSimulation`, or
`removeOristudioCpInlineSimulation`
([creasePatternSlice.ts:1127-1157](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1127))
sets `dirty`. Verified by driving the store directly: after a move and after a
delete, `dirty` is `false` both times.

`dirty` gates the discard prompt
([useWelcomeDiscardGuard.ts:18](apps/web/src/routing/useWelcomeDiscardGuard.ts:18)).
So: open a saved project, arrange five simulation windows, go back to the start
screen — no prompt, and the arrangement is gone. That is a live data-loss path
independent of undo, which is why it is Phase 1.

### What makes restoring a delete more than a field swap

A window is two halves. The descriptor is plain JSON in the store; the fold the
solver runs lives in a module side table keyed by window id, out of the store
deliberately (it is neither small nor serializable). `removeOristudioCpInlineSimulation`
calls `clearInlineSimulationSource(id)`, which drops both the fold and the fold
percentage.

So restoring the descriptor alone gives back a window that renders nothing. The
fold has to come back too — and it is still perfectly valid, because deleting a
window does not touch the crease pattern it was built from.

## Approach

Four phases. Phase 1 stands alone and fixes the data-loss path; Phases 2–4 build
the undo support and can stop after 3 if the appetite runs out.

### Phase 1 — a window change is a change

Set `dirty: true` in add, update and remove. Three lines, no design.

### Phase 2 — keep the fold alive as long as undo can reach the window

The reference-counting discipline already in the history slice for wasm handles
(`retainFoldedFigureHandles` / `releasedFrom` /
[historySlice.ts:98](apps/web/src/store/workspaceStore/slices/historySlice.ts:98))
is the same problem: an off-store resource whose lifetime is "as long as some
stack still refers to it". Give inline-simulation sources the same treatment.

- `removeOristudioCpInlineSimulation` stops calling `clearInlineSimulationSource`
  directly; a history entry that captures the window retains its source, an entry
  leaving a stack releases it, and the source is dropped when the count hits zero.
- `foldPercents` follows the same lifetime, so undoing a delete brings the window
  back where its fold was rather than snapped to flat — matching what focus loss
  already guarantees (`foldIsNotDocumentState.test.ts` > "remembers where the fold
  was").
- `clearAllInlineSimulationSources` on document replace stays the blunt reset it
  is; history is cleared there anyway.

Alternatives considered, both rejected:

- **Rebuild the fold on restore**, via a single-window hydrate. Correct-looking
  and wrong in the same direction `persist-inline-simulations.md` already warns
  about: the only existing single-window rebuild is
  `refreshOristudioCpInlineSimulation`, which re-baselines provenance — so
  undoing a delete would quietly mark a stale window fresh. A non-re-baselining
  variant is possible but means an async artifact recompute on every undo, to
  reproduce a fold that was never invalid.
- **Never clear on delete.** One leaked fold per deleted window per session.
  Cheap to write, and it is the shape the retain/release code exists to avoid.

### Phase 3 — windows join the history entry

Mirror the folded-figure plumbing exactly; there is no new mechanism here.

- `OristudioCpHistoryEntry` gains `inlineSimulations?: InlineSimulation[]`.
- A `restoredInlineSimulationState(entry)` helper alongside
  `restoredFoldedFigureState` ([historySlice.ts:84](apps/web/src/store/workspaceStore/slices/historySlice.ts:84)),
  carrying the same rule for the same reason: an entry written before windows
  joined the stack has no `inlineSimulations`, and restoring `undefined` over
  the live list would wipe the user's windows.
- `cpHistoryEntry` and both `cpHistoryEntry` builders (the history slice's and
  `projectSlice`'s) take the list.
- Undo/redo restore it in both branches. Windows never mutate the wasm document,
  so every window action is `overlayOnly` — the cheap branch, like folded figures.
- `oristudioCpFocusedInlineSimulationId` is *not* restored, matching
  `oristudioCpSelectedAnnotationId: null` on undo today: history restores content,
  not what was selected.

### Phase 4 — the actions that push an entry

| Action | Entry? | Why |
| --- | --- | --- |
| Open a window | yes | changes what `.osf` writes |
| Delete a window | yes | the reported bug |
| Move / resize / rotate | yes | drop the early return at [CreasePatternPanel.tsx:1350](apps/web/src/components/panels/CreasePatternPanel.tsx:1350) so windows use the same begin/commit gesture protocol as the other two canvas-object kinds |
| Rebuild region (refresh) | yes | rewrites provenance |
| Focus / blur | no | selection, not content |
| Scrub, play, replay | no | transport — `defecfa` pinned that a running fold is not a document edit, and putting it in history would be that regression by another route |
| Orbit | no | not written back to the descriptor at all ([inlineSimulation.ts:42-48](apps/web/src/cp-workspace/inlineSimulation/inlineSimulation.ts:42)) |

Labels follow the existing convention: "Add simulation window", "Delete
simulation window", and the gesture labels the overlay already produces for move
/ resize / rotate.

### Stale comments to retire

Each of these asserts the premise this plan removes, and each is why the gap was
invisible: `inline-simulation-windows.md:401`,
[CreasePatternPanel.tsx:1350](apps/web/src/components/panels/CreasePatternPanel.tsx:1350),
[inlineSimulationRuntime.ts:7](apps/web/src/cp-workspace/inlineSimulation/inlineSimulationRuntime.ts:7).

## Affected Areas

- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — dirty, and
  history pushes for add/remove/refresh
- `apps/web/src/store/workspaceStore/slices/historySlice.ts` — entry shape,
  restore helper, retain/release, both undo and redo branches
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — its own
  `cpHistoryEntry` builder
- `apps/web/src/store/workspaceStore/types.ts` — `OristudioCpHistoryEntry`
- `apps/web/src/cp-workspace/inlineSimulation/inlineSimulationRuntime.ts` —
  source reference counting
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — gesture checkpoints

Tests: `store.test.ts`, `foldIsNotDocumentState.test.ts`,
`inlineSimulation.test.ts`, and the `.osf` round-trip coverage in
`nativeProjectFile.test.ts`.

## Checklist

- [ ] Phase 1: add/update/remove set `dirty`, with a test that a moved window
      makes the project dirty
- [ ] Phase 2: sources and fold percentages are reference-counted by the history
      stacks; a test that deleting and undoing restores the fold position, and
      one that a source is actually freed once history can no longer reach it
- [ ] Phase 3: `inlineSimulations` on the history entry, restored in both undo
      and redo branches, with the missing-field rule tested (an old entry leaves
      live windows alone)
- [ ] Phase 4: add, delete, gesture and refresh push entries; scrub/play/focus
      demonstrably do not
- [ ] Retire the three stale "session-only" comments
- [ ] `npx tsc --noEmit`, `npm run lint:web`, web unit tests
- [ ] Browser check: delete → undo → redo; move → undo; open → undo; window
      arrangement survives save/reopen and prompts on discard
