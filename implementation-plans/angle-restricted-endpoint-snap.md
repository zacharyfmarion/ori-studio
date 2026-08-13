# Snap the Angle Restricted Line endpoint to grid points

## Goal

Angle Restricted Line (`DrawCreaseAngleRestricted5`) draws a snap ring at a grid
point and then commits the crease somewhere else. Make the endpoint honour grid
points as upstream does, make the ring tell the truth about where the endpoint
will land, and put Ori Studio's Snapping toggle in charge of both.

### Why it happens

The endpoint is resolved kernel-side by
`snap_to_close_point_in_active_angle_system`, whose close-point search
(`closest_model_point`) contains **crease endpoints and circle centres only**.
Upstream's `CreasePattern_Worker.getClosestPoint` also searches
`Grid.closestGridPoint` whenever the grid state is not `HIDDEN`
(`CreasePattern_Worker_Impl.java:625-648`). So vertices snap and grid points
never do — verified through the real command path: with the reporter's setup
(grid size 8, divider 8, anchor `(0,0)`, release at `(52,47)` beside the grid
point `(50,50)` which lies exactly on the 45° ray) the committed crease ends at
`(49.5, 49.5)`.

The frontend can't paper over it. It hands this tool the **raw** cursor on
purpose — the kernel picks the angle-system ray from the cursor direction
(upstream `syuusei_point_A_37`), so a pre-snapped cursor would choose a
different ray — and the point that needs snapping is the *projection*, which
only the kernel knows. See `angle-drag-shared-engine.md` for that contract.

The ring, meanwhile, comes from the frontend's own `resolveDrawPoint`, which
does know about grid points. Two snappers, one gesture, no agreement.

`tools/oriedita-oracle` reimplements `snapToClosePointInActiveAngleSystem` over
a bare `FoldLineSet` (`OrieditaGeometryOracle.java:4110`), so the parity oracle
inherited the same blind spot and reports `OracleTested` on the broken
behaviour. Extending it is part of this plan.

## Approach

### 1. Port `Grid.closestGridPoint` to the kernel

`GridMetadata` already carries every field the search needs; only the maths is
missing (Rust's grid code today is I/O only). Port `Grid.calculateGrid` →
`Grid.closestGridPoint` faithfully, including three upstream behaviours that
look like bugs and are not:

- `resetGrid`'s promotion of `WITHIN_PAPER` → `FULL` when the cell is not the
  unit square (non-unit axis lengths, or an angle other than 90°).
- the `distance_min` window starting at `diagonal_max`, so a candidate farther
  than the cell's long diagonal is not a candidate at all;
- the `new Point()` fallback when the scan finds nothing, which returns the
  **origin** `(0,0)` rather than a sentinel.

### 2. State the snap policy in the payload

Oriedita's only gate is grid visibility; Ori Studio has a Snapping toggle
(`CpViewControlsPanel.tsx:89`, one switch writing `snapToGrid` /
`snapToVertices` / `snapToLines`) that the kernel currently cannot see — the
payload carries no snap flags at all. Today that already shows: with Snapping
off, the anchor obeys the toggle and the endpoint still snaps to vertices.

One optional field carries the *effective* policy, and the frontend collapses
its toggles into it:

```rust
pub snap_candidates: Option<model::SnapCandidates>,   // { grid: GridState, vertices: bool }
```

| viewport | `grid` |
| --- | --- |
| `!snapToGrid` | `Hidden` |
| `snapToGrid && gridVisible` | `Full` |
| `snapToGrid && !gridVisible` | the document's `base_state` |

which is exactly what `nearestOrieditaDrawPointTarget` already does through
`visibleOrieditaGridMetadata` — so the ring and the endpoint are finally
derived from one policy. Absent = upstream (vertices always, grid per the
document), which keeps oracle tests and headless callers unchanged.

Scoped deliberately to the *snapping* use. `foldable_line_draw_operation_mode`
keeps the ungated `closest_model_point`: its closest-point call is hit-testing
("which vertex did you click"), not snapping, and gating it would make Foldable
Line Draw stop recognising vertices whenever Snapping is off. The ray-vs-crease
intersection inside `snap_to_active_angle_system` stays ungated for the same
reason — it is the tool's construction geometry, and upstream always does it.

### 3. Let the ring report the kernel's answer

`snap_to_close_point_in_active_angle_system` returns whether it actually landed
on a close point, and the preview publishes that endpoint through
`preview.points`. The canvas then rings **the kernel's endpoint** while a drag
is live, and keeps ringing `resolveDrawPoint`'s target before an anchor exists —
each phase ringed by whichever snapper owns the point at that moment. A ring
that lags the cursor by a frame is correct here: it is in lockstep with the
preview line it belongs to.

### 4. Teach the oracle about the grid

Add `grid-closest-point` (the pure `Grid.closestGridPoint`) and
`foldline-angle-restricted5-grid` (the full `getClosestPoint` path, grid
included) to the oracle harness, driving the **real** `Grid` class from the
vendored source. The existing `foldline-angle-restricted5` command stays as is.

## Affected Areas

- `crates/oristudio-cp/src/model/mod.rs` — grid basis + `closest_grid_point`,
  `SnapCandidates`
- `crates/oristudio-cp/src/operations/construction.rs` —
  `closest_point_like_worker`, snap result carries `snapped`
- `crates/oristudio-cp/src/lib.rs` — payload field, resolver, execute + preview
  arms
- `apps/web/src/lib/creasePatternViewport.ts` — `cpKernelSnapCandidates`
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — payload default
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — ring source
- `apps/web/src/engine/oristudioCpTypes.ts` — payload type
- `tools/oriedita-oracle/src/OrieditaGeometryOracle.java` + oracle tests
- `apps/web/src/generated/oristudio-cp-wasm/` — rebuilt, force-added

## Checklist

- [x] Port `Grid.calculateGrid` / `closestGridPoint` onto `GridMetadata`, with
      unit tests over base states, cell shapes, and the two fallbacks
- [x] `SnapCandidates` + `closest_point_like_worker`; snap result reports
      whether it landed on a close point
- [x] Payload field + resolver defaulting to the document's grid state
- [x] Execute and preview arms use it; preview publishes the snapped endpoint
- [x] Frontend: `cpKernelSnapCandidates`, payload default, ring from the kernel
- [x] Rust integration tests: grid snap, off-ray rejection, out-of-range
      rejection, both toggles off, upstream default
- [x] Oracle: `grid-closest-point` + `foldline-angle-restricted5-grid`, parity
      tests over the same edge cases
- [x] `cargo fmt` / `clippy` / `cargo test --workspace`; `npx tsc --noEmit`,
      `npx vitest run`, `npx eslint` on changed files, `npm run build:web`
- [x] Rebuild + `git add -f` the tracked CP wasm; verified in Node and in the
      browser that the shipped artifact snaps
- [ ] Browser check: draw with Snapping on — the endpoint lands on the ringed
      grid point; with Snapping off — no ring, endpoint on the bare projection

## Implementation notes

- **`SnapPolicy` exists because of an arity lint, and earns its place anyway.**
  Adding candidates pushed `draw_crease_angle_restricted_5` to eight arguments.
  Rather than the crate's first `#[allow(clippy::too_many_arguments)]`, the reach
  (`selection_distance`) and the candidates travel together as the one thing they
  describe: how a snap searches. `snap_to_active_angle_system` keeps a bare
  distance — it intersects the nearest crease rather than searching candidates,
  so it has no policy to carry.
- **Lattice points carry `cos`/`sin` dust, and so does upstream.** A 90-degree
  cell's `b` vector is `(50·cos(-π/2), …)`, not `(0, …)`, so the grid point beside
  `(50, 50)` is `50.00000000000001`. The oracle returns the same digits — this is
  parity, not error — and every assertion compares with a tolerance.
- **The oracle wrapper scripts hardcode an absolute path.** Rebuilding in a
  worktree rewrites them to that worktree, so they are deliberately restored to
  `HEAD` and only the `.class` output is committed. Running the parity tests
  locally from a worktree therefore needs a wrapper bound to *this* checkout's
  classes; pointing `ORIEDITA_*_ORACLE` at the tracked wrapper silently runs the
  primary checkout's stale oracle, which fails the two new tests with a usage
  error. CI rebuilds both from source and is unaffected.
- **The reported gesture cannot be verified in the automated browser pane.** It
  suspends `requestAnimationFrame`, so the WebGL canvas never sizes and
  `clientToModel` returns null before any command is built. What was verified
  there instead: the app's own modules plus the rebuilt wasm, driven directly —
  policy mapping, previewed endpoint, published ring point, committed crease.
