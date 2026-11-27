# Default spread: paper that does not stretch

## Goal

The Default (connected) spread lifts each material vertex to a solved height
and leaves its X/Y where the flat fold put it. A tilted face is therefore
longer in 3D than the paper it is made of: at 50% the median corpus model is
stretched 0.57%, and 2.2% at 100%. Requested on 2026-11-18: keep the sideways
reveal as it is, and move vertices in X/Y so the lifted paper keeps its size.

Out of scope: the height solve, the reveal, the layer-order correction, the
Affine and Depth spreads, and the separate 3D fold spread
(`spatial-vector-v1`).

## Approach

**The shift.** Keep the solved heights. For heights `h` above the side's
reference plane, a triangle with height gradient `g` is strain-free in 3D, to
second order, when its in-plane displacement `u` satisfies

```text
sym(grad u) = -1/2 * g (x) g
```

This is the membrane strain of a thin plate set to zero. Each triangle wants
to shorten by `|g|^2 / 2` along its slope; joined paper cannot always do that
everywhere, so `u` is the area-weighted least-squares fit over the shared
material vertices, with a small area-weighted anchor that removes the free
slide and turn. A flap hinged on a flat layer gets the exact second-order
answer: its tip moves `lift^2 / (2 * length)` toward the hinge.

The system matrix depends only on the triangulation, so it is assembled once
and solved for two right-hand sides, the front and the back reference plane.
It is symmetric positive definite; Jacobi-preconditioned conjugate gradients
solve it without a new dependency.

**Scaling with the amount.** Heights scale with the amount `m`, so the shift
scales with `m^2`. The solver returns the shift at amount 1 and the projection
multiplies it. No solve runs when the amount or the reveal changes.

**Held past the nominal opening.** The second-order form overshoots once
slopes are steep. Past amount 1 (50% on the slider) the shift stops growing.
Perspective 3D doubles the height multiplier before projection, so there the
hold is reached at 25% on the slider. That is a version 1 spread. A version 2
one (equal opening, `spread-equal-opening.md`) draws 2k times its stored amount,
so it reaches the hold at 25%/k on the slider: about 2.3% for bodo (k 10.8),
96% for the two-face fold (k 0.26), and never when k is under 1/4. Past the
hold, lifted paper stretches, as a version 1 spread does past 25%.

**No new recipe version.** `ConnectedSpread.version` stays 1 and no file
field is added. (This shift added none. Version 2 has since gone to equal
opening, so a shift gate would need the next free version or a field of its
own, never 2.) Reasons:

- A saved picture is a frozen scene. It does not redraw on open, so no saved
  picture changes until the user re-poses it.
- At the default 7% the largest shift on the median corpus model is 0.013% of
  the model's width.
- A new version or field makes every new flat picture a newer build's step in
  the shipped readers (`readLayerSpread` answers `NEWER` for a version it does
  not know), and leaves two geometry paths to maintain.

This follows the saved-document policy that look tweaks reach every file and
only layout needs consent. The cost: an existing step at a high amount draws
slightly differently the next time it is re-posed, and Fold's live pane does
so at once. If that proves wrong, gate `shiftedXY` on a new version (not 2,
which is equal opening's) and read both; the solver output would not change.

**Where it lives.**

| Owner | Change |
| --- | --- |
| `crates/oristudio-layer-spread` | New `inplane` module; `Solution.shifts` holds the front and back shift, flat `x, y` per vertex |
| `packages/layer-spread` | `SpreadSolution.shifts` (optional), `shiftScale`, `shiftedXY`; `diagramPositions` and `spatialPositions` use them |
| `apps/web/src/layer-spread` | `connectedDrawing` places vertices at the shifted X/Y; `validSolution` checks the shift; the solve cache counts its bytes |

`connectedDrawing` is the one place the app turns heights into positions, so
Fold, Diagram, Perspective 3D, picking, annotation carry, vector capture and
the raster fallback follow without their own change.

**A solve that cannot finish.** If the iteration does not converge, or
returns a value that is not finite or is larger than half the model, that
side's shift is empty and the spread draws as it did before.

## Evidence

Spike on the external cpoogle corpus, 442 of 484 models that fold and solve,
front side, default reveal. Nothing from the corpus is committed.

| Amount | 7% | 25% | 50% | 100% (held) |
| --- | --- | --- | --- | --- |
| Largest shift, share of width (median) | 0.013% | 0.17% | 0.66% | 0.66% |
| Paper stretch, median: before → after | 0.011 → 0.002% | 0.14 → 0.02% | 0.57 → 0.09% | 2.21 → 1.73% |
| Crossing area, share of paper, median | 10.52 → 10.52% | 10.52 → 10.49% | 10.52 → 10.34% | 10.52 → 10.34% |
| Models with paper drawn mirrored | 0 → 0 | 0 → 0 | 0 → 1 | 3 → 11 |

Without the hold, 46 models draw paper mirrored at 100%. The spike's solve
needed at most 1,020 iterations. The app's vector capture took the same time
with and without the shift on 24 models (14 to 1,474 faces), with 7–9% more
fragments.

## As built

- The shipped solver's front shift matches the spike's on all 442 corpus
  models, to within 0.0005% of each model's largest shift, and no side came
  back empty.
- Cost, measured by running the same wasm solver built with and without the
  shift, one after the other, on 73 corpus inputs including the four largest:
  a median of 1.3 ms added per solve, 36 ms at the 95th percentile, 73 ms at
  most, and 1.6% of the total solve time. The uncompressed wasm grows from
  444,226 to 459,955 bytes.
- Checked in the browser on a blintz at 25%, 50% and 100% in the Diagram
  presentation and at 25% in Perspective 3D, against the same view with the
  shift switched off: the four flaps now pull back from each other and show
  the layer underneath. The step picture saved by Done shows the same, so the
  vector capture follows.
- Not measured: live frame time in the browser, the back side on the corpus,
  and a physical touch device.

## Follow-ups (2026-11-18)

**Crease pieces drawn off their line.** With lower layers now showing through,
their precreases drew as stray lines running out of the paper. Not caused by
the shift: a crease that runs on into another face has ends no triangle of the
piece's own face holds, `connectedDrawing` then left the ink's `whole` in the
fold's own coordinates, and `erodeLine` snapped the piece's ends onto it. The
same code on `main` draws all four visible pieces of a cross-precreased sheet
off their line. A crease end outside the face is now placed on the piece's own
drawn line, at the piece's share of the crease, and a stale `whole` is never
kept. A picture captured before the fix keeps its lines until it is re-posed.

**Reveal can be none.** The pad kept a reveal at least 5% long because a
Default spread with no reveal drew the flat fold. The shift opens the paper
without one, so zero is a reveal like any other: the pad's centre snaps a
pointer to it, arrow keys step onto it, and saved zeros still read unchanged.

## Affected Areas

- `crates/oristudio-layer-spread/src/inplane.rs` (new), `lib.rs`, `qp.rs`,
  `tests/solve.rs`
- `packages/layer-spread/src/types.ts`, `projection.ts`,
  `tests/geometry.test.ts`
- `apps/web/src/layer-spread/connectedScene.ts`, `protocol.ts`,
  `spreadService.ts` and their tests
- `implementation-plans/connected-layer-spread.md` (pointer to this plan)

## Checklist

- [x] Solve the shift in the crate, for both reference planes, with tests.
- [x] Carry it through the wasm bridge and the shared types.
- [x] Apply it, with the hold, in the shared projection and the app's drawing.
- [x] Validate and account for it in the solve service.
- [x] Rust format, clippy and crate tests; package tests; web lint, typecheck
      and the spread suites.
- [x] Check before and after in the browser, in Diagram and Perspective 3D.
