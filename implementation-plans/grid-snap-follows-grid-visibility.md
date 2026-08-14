# Grid snapping follows the Grid toggle

## Goal

With the Grid switched off in CP view controls, Angle Restricted Line still
lands its endpoint on grid points, and the snap ring still rings them. Make a
hidden grid stop being a snap candidate — for the kernel-resolved endpoint and
for the canvas ring alike.

### Why it happens

Three snap sites read the Grid toggle as *"don't force the grid to `Full`"*
rather than *"the grid is off"*, and fall back to the document's persisted
`grid.base_state`:

| site | file |
| --- | --- |
| kernel policy for Angle Restricted Line | `cpKernelSnapCandidates`, `creasePatternViewport.ts:382` |
| generic canvas snapper | `nearestCpSnapTarget`, `creasePatternViewport.ts:810` |
| draw-point snapper (the ring, and every draw tool's anchor) | `nearestOrieditaDrawPointTarget`, `creasePatternViewport.ts:862` |

That fallback is never `Hidden` in practice. `base_state` defaults to
`WithinPaper` for a new document (`crates/oristudio-cp/src/model/mod.rs:422`),
and **no UI writes it** — `CpViewControlsPanel` exposes `gridVisible` and a
single Snapping switch, nothing that reaches the document's grid state. So the
branch taken when the grid is hidden is the branch that keeps snapping.

Verified by driving the three functions directly on a default document with
Grid off and Snapping on:

```
kernel policy      { grid: 'WithinPaper', vertices: true }
draw-point target  { kind: 'grid', point: { x: 0, y: 0 }, distance: 3.61 }
generic target     { kind: 'grid', point: { x: 0, y: 0 }, distance: 3.61 }
```

The kernel is not at fault and needs no change. `closest_point_like_worker`
(`operations/construction.rs:1787`) returns before touching the grid on
`GridState::Hidden`, and it is the only CP-side caller of
`closest_grid_point` — it was simply never told the grid was off.

Two things follow from that, and both are worth knowing before touching this:

- **The bug is one policy expressed three times.** Fixing only the kernel arm
  would still leave the ring drawn on a grid point the endpoint no longer uses
  — the same two-snappers-one-gesture split that
  `angle-restricted-endpoint-snap.md` was written to close. The three sites move
  together or the bug just changes shape.
- **Where a document came from currently changes the gesture.** A FOLD import
  sets `base_state = Hidden` (`io/fold.rs:507`), so the identical drag on an
  imported CP already behaves the way this plan wants, while a
  document created in Ori Studio does not.

## Approach

### 1. One rule, and it is upstream's

Oriedita has no separate visibility boolean: `Grid` carries a single tri-state,
and `CreasePattern_Worker.getClosestPoint` searches grid points whenever that
state is not `HIDDEN`. Ori Studio split display from document state and only
ever wired the *additive* half — `visibleOrieditaGridMetadata` promotes a shown
grid to `Full`; nothing demoted a hidden one.

Restore the tie, stated as the invariant a user can see:

> **You can snap to exactly the grid points you can see.**

```ts
grid: options.snapToGrid && options.gridVisible ? 'Full' : 'Hidden'
```

The `Full` on the visible side is not new — it is what the renderer already
forces through `visibleOrieditaGridMetadata` (`CreasePatternPanel.tsx:993`,
`CreasePatternWebglCanvas.tsx:1571`), so a shown grid keeps snapping everywhere
it is drawn. What changes is the hidden side, which stops consulting the
document.

### 2. One predicate, so the three sites cannot drift again

They ask the same question and should call the same function. The two canvas
snappers want grid *metadata* to hand `closestOrieditaGridPoint`; the kernel arm
wants a `GridState` string. One helper serves both by answering with the grid
itself:

```ts
/** The grid a snap may land on, or `null` when the grid is not a candidate. */
export function snappableOrieditaGrid(
  grid: OristudioCpGridMetadata,
  options: OristudioCpViewportOptions
): OristudioCpGridMetadata | null {
  if (!options.snapToGrid || !options.gridVisible) return null;
  return visibleOrieditaGridMetadata(grid);
}
```

Each site then reads as its own question: the snappers take their grid from the
helper instead of rebuilding it, and `cpKernelSnapCandidates` translates the
same answer into the payload's vocabulary.

`cpGridStatePayload` loses its only caller and goes. The `Full` it used to
produce becomes a named `VISIBLE_GRID_STATE` shared with
`visibleOrieditaGridMetadata`, so the state a shown grid *renders* at and the
state it *snaps* at cannot be changed apart.

### 3. Non-goal: a grid you cannot see but can still snap to

Tying the two is the ask and it is upstream's behaviour, so this plan ties them.
If an invisible snapping grid is ever wanted it needs its own control — the
Snapping switch currently sets `snapToGrid`/`snapToVertices`/`snapToLines`
together, so there is no per-candidate surface to hang it on. Out of scope here.

## Affected Areas

- `apps/web/src/lib/creasePatternViewport.ts` — `snappableOrieditaGrid`; the
  three sites call it; `cpGridStatePayload` deleted
- `apps/web/src/lib/creasePatternViewport.test.ts` — the kernel-policy block
  asserted the fallback *as the specification*
  (`'falls back to the document grid state when the grid is hidden from view'`,
  and the unknown-state case beside it); both rewritten
- No Rust, no wasm rebuild. `GridState::Hidden` already suppresses the kernel
  search, with coverage at `crates/oristudio-cp/tests/model.rs:311`.
- No `PORTING.md` change. The parity surface it documents — `SnapCandidates`
  threaded into the port of `getClosestPoint`, omission reproducing upstream —
  is untouched; only the frontend's derivation of the policy moves, and it moves
  *toward* upstream.

## Checklist

- [x] Add `snappableOrieditaGrid`; route `cpKernelSnapCandidates`,
      `nearestCpSnapTarget`, and `nearestOrieditaDrawPointTarget` through it
- [x] Delete `cpGridStatePayload`; name the shared `VISIBLE_GRID_STATE`
- [x] Rewrite the two tests that encode the fallback: a hidden grid yields
      `Hidden` whatever `base_state` says (`WithinPaper`, `Full`, `Hidden`,
      unrecognised, nonsense), and both canvas snappers return no grid target
      with the Grid toggle off
- [x] Keep the visible-grid cases green — a shown grid still snaps at `Full`,
      and Snapping off still drops the grid however it is displayed
- [x] Confirm the new tests are load-bearing: all three fail against the old
      policy, restored before committing
- [x] `npm run typecheck:web`, `npm run lint:web`, `npm run test:web`
      (3961 passed), `npm run i18n:check`
- [ ] Browser check: Grid off, Snapping on, draw an Angle Restricted crease near
      a lattice point — no ring on it, endpoint on the bare projection. Grid
      back on — ring and endpoint both on the grid point, as before.
