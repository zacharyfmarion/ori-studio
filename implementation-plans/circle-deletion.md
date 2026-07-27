# Circle Deletion

## Goal

Make circles deletable in Ori Studio. Today they can be drawn, recolored, and
selected, but nothing in the app removes one: the only code path in the repo
that removes a circle is the zero-radius pruner in
`operations/circle.rs::organize_circle`, which structurally refuses any circle
with `r >= 1e-7`.

Two deliverables:

1. **Port Oriedita's eraser behavior faithfully** — right-click / right-drag on
   the crease pattern erases circles alongside creases.
2. **Add selection-based deletion** as an Ori Studio addition — Delete/Backspace
   removes selected circles. Oriedita has no circle selection at all (its
   `Circle` has no `selected` flag), so this is additive UX on a surface the
   upstream does not have, not a parity divergence.

## Upstream reference

Read before touching the kernel. All paths under `third_party/oriedita/`.

| Behavior | Upstream |
| --- | --- |
| The only delete primitive | `FoldLineSet.deleteCircle` — `origami/.../FoldLineSet.java:1100` |
| The only delete tool | `MouseHandlerLineSegmentDelete` — `oriedita/.../handler/MouseHandlerLineSegmentDelete.java:45-150` |
| Circles included only in `BOTH_4` | same file, `:67-70` (box), `:104-118` (click) |
| Line-vs-circle tie-break | same file, `:109` — line wins ties |
| `organizeCircles` + `record` after delete | same file, `:124-130`, `:139-145` |
| Right-click forces `BOTH_4` | `oriedita-ui/.../Canvas.java:329-341`; restore on release `:514-521` |
| Ring-in-box predicate | `Polygon.totu_boundary_inside_circle` — `origami/.../element/Polygon.java:183` |
| Nearest-circle pick | `FoldLineSet.closestCircleInRange:2050` + `closest_circle_search_reverse_order:1177` |

Key upstream facts that shape the design:

- Circle deletion lives in the **existing eraser mouse mode**
  (`LINE_SEGMENT_DELETE_3`), not a dedicated tool. So **no new `OperationId` is
  needed** — `LineSegmentDelete` is the correct operation for both paths, and
  `circle_ids` already rides the generic payload
  (`crates/oristudio-cp/src/lib.rs:101-103`), so the wasm bridge needs no work
  beyond what already exists.
- Circles are erased only in `BOTH_4`, the mode with no line-type filter. The
  four filtered modes never touch circles.
- Deleting circles is always followed by `organizeCircles()` then `record()`.

## Approach

### Parity mapping for the line-type filter

Ori Studio's eraser carries `custom_line_type` (`CustomLineType::Any` when
absent) where Oriedita carries `FoldLineAdditionalInputMode`. The mapping:

| Oriedita mode | Ori Studio `custom_line_type` | Deletes circles |
| --- | --- | --- |
| `BOTH_4` (right-click) | absent / `Any` | yes |
| `POLY_LINE_0` | `MountainAndValley` | no |
| `BLACK_LINE_2` | `Edge` | no |
| `AUX_LIVE_LINE_3` | `Aux` | no |

So the kernel rule is: **delete circles only when the filter is `Any`.** The
right-click eraser already sends no `custom_line_type`
(`CreasePatternPanel.tsx:3533-3541`), so it lands on `Any` for free.

One consequence worth stating: the eraser *tool* also defaults to an `Any`
filter, so selecting the eraser and clicking a ring will delete it, where
Oriedita requires a right-click. That is a superset of upstream, and it follows
directly from `Any` being the honest mapping of `BOTH_4`. Preferable to
inventing a fifth filter value that only exists to gate circles.

### Phase 1 — Kernel primitive

`crates/oristudio-cp/src/operations/circle.rs`:

- Add `delete_circle(model, index) -> bool` and
  `delete_circles_for_indices(model, indices) -> usize`, mirroring the
  clone-then-find-then-remove shape of
  `arrangement::delete_line_segments_for_indices` (`arrangement.rs:698`) so that
  index shifting during a multi-delete behaves identically. Document them as
  `FoldLineSet.deleteCircle`.

### Phase 2 — Kernel hit-testing

Both geometry primitives already exist, faithfully ported — this phase is
wrappers, not new math:

- `Polygon::totu_boundary_inside_circle` — `geometry/polygon.rs:145`
- `orita_calc::distance_circumference` — `geometry/orita_calc.rs:651`

In `crates/oristudio-cp/src/operations/selection.rs` (currently zero circle
references):

- `circle_indices_in_box(model, polygon) -> Vec<usize>`, filtering on
  `totu_boundary_inside_circle`, alongside the existing
  `line_indices_in_box:47`.
- `closest_circle_in_range(model, point, selection_distance) -> Option<usize>`,
  porting `closestCircleInRange`: pick one candidate via the reverse-order search
  (single pass minimizing over both center distance and `|center distance − r|`,
  using `>=` so later circles win ties → last-drawn priority), then range-check
  that candidate.

  **Correction to the original research note:** I described the single-candidate
  range check as an observable quirk that could miss a nearby ring. It cannot. A
  test written to demonstrate the miss failed, and the reason is structural:
  `minr` is a true global minimum over all 2N metric values and `minrid` owns
  that minimum, so the picked circle's own metric *is* the global min, and the
  range check tests exactly the two metrics it was minimized over. If any circle
  is in range, the picked one is too. The port keeps the upstream shape; the doc
  comment and `closest_circle_in_range_cannot_miss_an_in_range_ring` record why
  it is lossless rather than asserting a quirk that does not exist.

### Phase 3 — Wire the eraser dispatch

`crates/oristudio-cp/src/lib.rs:1461-1488` (`OperationId::LineSegmentDelete`):

- Resolve circles in parallel with lines. Box path (`line_ids` empty) uses
  `circle_indices_in_box` against the same polygon; click path uses
  `optional_circle_indices` (`lib.rs:3294`).
- Gate on `matches!(line_type, CustomLineType::Any)`.
- Call `operations::circle::organize` following upstream's *asymmetry*, which the
  original research note glossed over: `deleteInsideBox`
  (`MouseHandlerLineSegmentDelete.java:126`) organizes **unconditionally**, so a
  boxed crease deletion prunes zero-radius circles the crease was holding in
  place even when no circle was boxed; `deleteSingleLineOrCircle` (`:142`)
  organizes **only when it actually removed a circle**. Mirror both.
- Fold the circle count into the returned `usize` so the command reports a
  mutation and the caller doesn't treat a circle-only delete as a no-op.

### Phase 4 — Frontend: right-click eraser

- `CreasePatternWebglCanvas.tsx:2273` and `:2290` both drop non-line hits
  (`if (hit && hit.kind === 'line')`), so a right-click on a ring is a silent
  no-op even though `hitTest:1291` identifies it correctly. Add an
  `onEraseCircle(id)` callback and route `hit.kind === 'circle'` to it.
- `CreasePatternPanel.tsx:3539` — add the `onEraseCircle` prop dispatching
  `LineSegmentDelete` with `{ circle_ids: [id] }`.
- The box path needs **no frontend change**: `onEraseBox:3533` already sends
  `{ line_ids: [], points }` and lets the kernel resolve the box, so Phase 3
  covers it. Keeping the polygon predicate kernel-side is also what keeps it
  parity-testable.

**Deliberate divergence to note:** `hitTest:1277-1295` is priority-ordered
(point → line → circle, first within tolerance wins), whereas Oriedita compares
actual distances and lets the line win only on ties
(`MouseHandlerLineSegmentDelete.java:109`). These differ only when both are
within tolerance *and* the ring is strictly nearer than the crease. Matching
exactly would mean plumbing a distance out of `hitIndex.query`, which returns
only an id. Keep priority order — it already agrees with Oriedita's tie-break
direction — and document it. Cheap to revisit if it feels wrong in the hand.

### Phase 5 — Frontend: selection delete (additive)

Circles already land in `oristudioCpSelection.circles` from both click
(`CreasePatternWebglCanvas.tsx:1288-1293`) and box
(`:1334` via `lineHitIndex.ts:170-183`). Three guards drop them:

- `commands/menuActions.ts:462-472` (`edit.delete`) reads only
  `selection.lines` + points and early-returns when both are empty. Read
  `selection.circles`, include it in the early-return condition, and dispatch
  `LineSegmentDelete` with `circle_ids`. Reuse the existing single dispatch when
  lines and circles are selected together — one command, one history entry.
- `lib/workspaceCapabilities.ts:375` omits `hasSelectedCpCircles` from the
  `edit.delete` predicate, though it is already computed at `:168` and used for
  `cp.changeCircleColor` at `:756-761`. Add it.
- `cp-workspace/CpSelectionToolbar.tsx:104` gates entirely on
  `selection.lines.length > 0`, so a circles-only selection surfaces no toolbar.
  Extend the gate and add a delete action.

Leave `cp.deleteSelectedLines` (`menuActions.ts:637-643`) line-only — its label
says lines and `edit.delete` is the general path.

Undo needs no work: history stores whole-document snapshots
(`projectSlice.ts:1676`, `:1733`).

## Affected Areas

- `crates/oristudio-cp/src/operations/circle.rs` — delete primitives
- `crates/oristudio-cp/src/operations/selection.rs` — circle hit-testing
- `crates/oristudio-cp/src/lib.rs` — `LineSegmentDelete` dispatch
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — erase-hit routing
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — `onEraseCircle`
- `apps/web/src/commands/menuActions.ts` — `edit.delete`
- `apps/web/src/lib/workspaceCapabilities.ts` — delete capability
- `apps/web/src/cp-workspace/CpSelectionToolbar.tsx` — circles-only selection
- `crates/oristudio-cp/tests/circle_operations.rs`,
  `tests/selection_operations.rs` — kernel tests
- No wasm bridge change (`circle_ids` already flows; no new `OperationId`)
- No `oristudioCpCommands.ts` catalog change (reusing `LineSegmentDelete`)

## Validation

- `cargo test -p oristudio-cp` for kernel work; `cargo fmt --check` and
  `cargo clippy --workspace --all-targets -- -D warnings` before handoff.
- `cd apps/web && npx tsc --noEmit` for typecheck — avoids the nondeterministic
  regeneration of tracked `apps/web/src/generated/**` that `npm run
  typecheck:web` triggers.
- `npm run lint:web`, `npm run test:web`.
- Oracle parity is **not** required: this adds a delete path over already-ported
  geometry predicates rather than changing ported model semantics. If
  `closest_circle_in_range` proves worth pinning, add a case to
  `tests/oriedita_operations_oracle.rs`.

Browser checklist for Zach (not tool-verifiable):

- Right-click a circle ring → it disappears; right-click near a crease that
  overlaps a ring → the crease goes, not the circle.
- Right-drag a box over circles and creases → both erased.
- Eraser tool with the filter set to a specific line type → circles survive.
- Box-select circles only → Delete removes them; selection toolbar appears.
- Undo restores deleted circles.

## Checklist

- [x] Phase 1 — `delete_circle` / `delete_circles_for_indices` in `operations/circle.rs`
- [x] Phase 2 — `circle_indices_in_box` + `closest_circle_in_range` in `operations/selection.rs`, losslessness documented
- [x] Phase 3 — `LineSegmentDelete` dispatch resolves circles, gates on `CustomLineType::Any`, calls `organize`, counts deletions
- [x] Kernel tests: click delete, box delete, filter suppresses circles, organize-after-delete asymmetry, hit-test losslessness
- [ ] Phase 4 — `onEraseCircle` wired through canvas + panel; circle hits no longer dropped
- [ ] Phase 5 — `edit.delete`, capability predicate, selection toolbar handle circles
- [ ] Web tests for the selection-delete path
- [ ] `cargo fmt` / `clippy` / `cargo test -p oristudio-cp` / `tsc --noEmit` / `lint:web` / `test:web`
- [ ] Browser checklist confirmed
