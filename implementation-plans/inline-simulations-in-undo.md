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

### Phase 2 — rebuild the fold on restore, do not retain it

Restoring a deleted window needs its fold back. Rebuild it; do not hold it.

- `removeOristudioCpInlineSimulation` keeps clearing the source, as it does now.
- Restoring a window rebuilds its fold the way **`hydrateOristudioCpInlineSimulations`
  does on file load** — `buildSegmentFold` against the window's own
  `sourceBoundary`, with no `set` of provenance. That last part is the whole
  reason to copy hydrate rather than `refreshOristudioCpInlineSimulation`, which
  re-baselines `sourceFingerprint` and would quietly mark a stale window fresh.
- Artifacts come from the add path's strategy (`get().foldArtifacts ?? await
  ensureFoldArtifacts()`), not hydrate's unconditional `refreshFoldArtifacts()`.
  Hydrate refreshes because a file load leaves artifacts in the importer's
  coordinate space; mid-session they are already in the kernel's, so the warm
  cache is both correct and free.
- `foldPercents` is a number per window id — keep it across a delete so the
  window comes back where its fold was, matching what focus loss already
  guarantees (`foldIsNotDocumentState.test.ts` > "remembers where the fold was").

**This reverses the first version of this plan, which proposed reference-counting
the folds against the history stacks** (mirroring `retainFoldedFigureHandles` for
wasm handles). The shape is right and the precedent is real, but measuring the
resource killed it — see "Memory and performance" below. Rebuilding costs a
`buildSegmentFold` on undo against warm artifacts; retaining costs up to tens of
MB of dead folds.

**Never clear on delete** was also rejected: same memory profile as retaining,
without even a bound.

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

## Memory and performance

### The descriptors are free; the folds are not

A window descriptor is small JSON, and the slice `.map()`s over an immutable
list, so an unchanged window is the *same object* in every history entry — the
structural sharing that already bounds folded-figure memory applies unchanged.
Adding `inlineSimulations` to the entry costs one array reference per entry.

The fold is a different object entirely. Measured heap for a triangulated segment
`FoldDocument` (arrays of `[x, y]` arrays, one JS object per coordinate pair):

| Segment size | Per fold |
| --- | --- |
| 500 vertices (~1.5k edges, ~1k faces) | **243 KB** |
| 2,000 vertices (~6k edges, ~4k faces) | **727 KB** |
| 8,000 vertices (~24k edges, ~16k faces) | **2.9 MB** |

With `MAX_CP_HISTORY = 100`, retaining a fold per undoable deleted window is
100 × those figures in the worst case — ~70 MB for medium regions, ~290 MB for
large ones, all of it dead weight for windows the user deleted. Rebuilding
instead makes the retained cost zero and the restore cost one `buildSegmentFold`
over already-computed artifacts.

The one case where rebuilding is not free: artifacts cold (right after a load, or
after an edit invalidated them), where `ensureFoldArtifacts` is the ~1s
segmentation. Undo would block for that. Worth a check during implementation on
whether it is reachable in practice — deleting a window does not invalidate
artifacts, so the common delete-then-undo path should be warm.

### Phase 4 does not add per-frame work

`commitGesture` fires on pointerup, not per move, so a window drag pushes one
entry per gesture — the same as annotations and folded figures today.

Phase 1's `dirty: true` in `updateOristudioCpInlineSimulation` *does* run per
pointermove, but the same `set` already writes the whole simulations array, and
the added field is a boolean that is already `true` after the first move, so no
subscriber re-renders for it.

### A pre-existing cost this plan does not cause but sits next to

`onUpdate` fires on every pointermove ([CanvasObjectOverlay.tsx:265](apps/web/src/cp-workspace/CanvasObjectOverlay.tsx:265)),
so dragging a window rebuilds `oristudioCpInlineSimulations` per frame, which
invalidates the `staleIds` memo in `useInlineSimulations`, which calls
`isInlineSimulationStale` per window — and that walks **every line segment in the
document** ([foldedFigureStaleness.ts:144](apps/web/src/cp-workspace/folded/foldedFigureStaleness.ts:144)).

So moving a window over a 50k-edge CP with three windows open is ~150k crease
visits per frame. This is the same failure the fold-percentage work fixed
(`foldIsNotDocumentState`, 901ms of a 7.2s profile) — that fix took the *fold
percentage* out of the descriptor, but a box drag still rewrites the descriptor
at pointer rate.

Out of scope here, and worth its own look: the memo could be keyed on the
windows' provenance fields rather than the whole array, so a box change stops
invalidating it.

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

- [x] Phase 1: add/update/remove/refresh set `dirty`, with tests that a moved
      and a deleted window make the project dirty
- [x] Phase 2: `restoreOristudioCpInlineSimulationSources` rebuilds via a
      builder factored out of hydrate (no provenance re-baseline); tests that
      delete-then-undo restores the fold and its position, that a stale window is
      still stale after the round trip, and that the cache is reused
- [x] Phase 2: cold artifacts on undo **are** reachable — a file load leaves the
      cache in the importer's unit space, so a delete-then-undo straight
      afterwards resolves nothing. Handled with the same detection
      `addOristudioCpInlineSimulation` already uses: try warm, and recompute when
      nothing resolved. Caught by a test failing, not by review
- [x] Phase 3: `inlineSimulations` on the history entry, captured by every
      producer (both `cpHistoryEntry` builders and `pushOverlayHistoryEntry`)
      and restored in all four undo/redo branches, plus a
      `recordInlineSimulationHistory` action beside the other two overlay
      layers'. Missing-field rule tested; restore verified to fail when the
      helper is stubbed out
- [ ] Phase 4: add, delete, gesture and refresh push entries; scrub/play/focus
      demonstrably do not
- [ ] Retire the three stale "session-only" comments
- [ ] `npx tsc --noEmit`, `npm run lint:web`, web unit tests
- [ ] Browser check: delete → undo → redo; move → undo; open → undo; window
      arrangement survives save/reopen and prompts on discard
