# BP Sheet Width/Height Inputs

## Goal

Make the Width and Height fields in the BP packing pane's sheet-size popover
actually resize the sheet, and make a dimension the engine refuses visibly
revert instead of leaving the rejected number sitting in the field.

## Approach

Two defects, one root cause each.

### 1. The second edit reverts the first

`setOristudioBpLayoutSheet(gridType, width, height)` is an *absolute* "set both
dimensions" call, and each input reassembles the dimension it does not own from
the `sheet` prop captured at render:

```tsx
onCommit={(w) => setSheet(sheet.kind, w, sheet.height)}   // width field
onCommit={(h) => setSheet(sheet.kind, sheet.width, h)}    // height field
```

Edit width, then height before React has re-rendered with the new width, and
the height commit sends the *stale* width alongside — so the engine applies the
new height and puts the old width back. Reproduced in the browser: typing 20
into Width then 30 into Height issues `('rectangular', 20, 52)` followed by
`('rectangular', 28, 30)` and lands on 28x30. The width edit is silently undone.

Box Pleating Studio does not have this problem because it has no combined
setter: `rectangularGrid.ts` exposes independent `set width` / `set height`
accessors, and `rectangular.vue` binds each field to its own property, so a
write only ever names the dimension it changes.

Port that shape. Make the dimensions optional all the way down — `None`/`null`
means "leave this dimension as the live sheet has it" — so the resolution
happens in the engine session, which is the only place that is authoritative
and is already serialised by the worker queue. Resolving on the JS side would
still race: `runBpTreeMutation` awaits a `.bps` export before it calls the
engine, so a second call's view of the document can be older than the first
call's result.

Every dimension the fields do not own then travels as `null`, and two edits in
flight compose instead of clobbering.

### 2. A refused dimension looks accepted

The engine declines a resize below `MIN_RECT_SIZE` (4) / `MIN_DIAG_SIZE` (6),
and declines a shrink the flaps no longer fit. Both come back as success with
the sheet unchanged. The input clamps to a minimum of 1, so 1-3 are refused
outright, and because `value` never changes the `useEffect` that syncs the
draft never re-runs — the field keeps displaying the rejected number.

Upstream's `number.vue`/`input.ts` snap the draft back to the model on blur and
flag the field while the two disagree. Adopt the snap-back: clamp to the real
per-kind minimum, and resync the draft from the authoritative value once the
commit settles, so a refused edit reverts in front of the user.

Keep committing on Enter/blur rather than upstream's per-keystroke write: our
model write is an async worker round-trip that records an undo entry, so
per-keystroke would spam both.

## Affected Areas

- `crates/oristudio-bp/src/engine/project_session.rs` — `update_layout_sheet`
  takes `Option<f64>` dimensions and resolves `None` against the live grid.
- `crates/oristudio-bp-wasm/src/lib.rs` — `bp_update_layout_sheet` passes
  optional dimensions through.
- `apps/web/src/generated/oristudio-bp-wasm/` — rebuilt bridge (tracked).
- `apps/web/src/workers/oristudioBpWorker.ts`,
  `apps/web/src/store/workspaceStore/oristudioBpRuntime.ts`,
  `.../slices/oristudioBpSlice.ts`, `.../types.ts` — `number | null` dimensions.
- `apps/web/src/lib/bpSheetSize.ts` — per-kind minimum helper.
- `apps/web/src/components/panels/BpPackingPanel.tsx` — each field commits only
  its own dimension; draft resyncs after a commit settles.

## Checklist

- [x] Reproduce the clobber and the silent rejection in the running app
- [x] Read the upstream grid setters and sheet panel
- [x] Engine: optional dimensions resolved against the live sheet
- [x] Rust tests for one-dimension-at-a-time resize and refusal
- [x] wasm bridge + node test
- [x] Web: thread `number | null` through worker, runtime, store
- [x] Web: each input commits only its own dimension
- [x] Web: real minimums + draft resync on refusal
- [x] Web unit tests
- [x] Rebuild the generated bridge
- [x] Validation: cargo fmt/clippy/test, web lint/typecheck/test
- [x] Browser verification
- [x] Draft PR — https://github.com/zacharyfmarion/ori-studio/pull/228
