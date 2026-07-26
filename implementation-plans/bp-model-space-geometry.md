# BP Packing Geometry in Model Space

## Goal

Render the Box Pleating packing pane from geometry in **model (grid) coordinates**
under a single SVG transform, instead of converting every point to screen
coordinates by hand. This is how Box Pleating Studio's own SVG exporter works, and
adopting it makes its renderer portable to ours line by line rather than
reinterpreted.

The immediate motivation is a class of bug we have hit repeatedly, most recently
a conflict region drawn outside the flap circle it belongs to
(`test_files/minimal_repro_circle_issue.osf`). The engine's geometry for that
file is correct — the junction's vertices sit exactly on the flap circle — so the
divergence is introduced when we draw it.

## Why our port diverges

Box Pleating Studio renders to a canvas:

```ts
// project/components/layout/junction.ts
if (p.arc) target.arcTo(p.arc.x, p.arc.y, p.x, p.y, p.r!);
else target.lineTo(p.x, p.y);
```

Canvas `arcTo` takes two lines and a radius and fits the tangent arc. There is no
direction flag — direction falls out of the geometry. SVG's `A` command has no
such form: it requires `large-arc-flag` and `sweep-flag` to be *stated*. Every
arc we draw therefore needs a decision that canvas never forced anyone to make,
and reconstructing those decisions is where our renderer drifts from upstream.

Upstream already solved this, in a renderer we did not port:

```ts
// svg/svgGraphics.ts
public arcTo(x1, y1, x2, y2, radius) {
  this._path += `A${radius},${radius},0,0,1,${x2},${y2}`;
}
```

Constant flags — no per-arc reasoning. That works because their path data stays
in **model coordinates**, with the flip applied once as a transform on a wrapping
group:

```ts
// svg/index.ts
`<g transform="${getTransform(sheet, height)}">`   // translate(...) scale(s, -s)
```

The sweep flag is interpreted in the path's own coordinate system, so a constant
stays correct under the transform.

Our `bpPackingPointToSvg` **bakes the flip into every coordinate**
(`y: rect.y + rect.height - …`). Our path data is already mirrored, so upstream's
constant no longer holds, and `bpArcPathToSvgPath` derives a sweep instead. That
derivation is the divergence. It is also unnecessary: adopt their coordinate
convention and their code ports verbatim.

## Scope

Smaller than it first appears. The entire screen-space conversion surface is
**one component plus its lib**:

| Helper | Call sites outside the lib |
| --- | --- |
| `bpPackingPointToSvg` | 13 |
| `bpPackingRectToSvg` | 3 |
| `bpPackingUnitToSvg` | 3 |
| `bpPackingFlapClearanceRect` | 3 |
| `bpArcPathToSvgPath` | 2 |
| `bpPackingSvgToPoint` | 2 |
| `bpPackingPaperRect` | 2 |

All of them live in `apps/web/src/components/panels/BpPackingPanel.tsx`.

## Non-goals

- The BP **tree** pane (`bpTreeViewport.ts`) keeps its own conversion for now. It
  draws no arcs, so it has none of this class of bug; converting it is a
  follow-up if the convention proves out.
- No engine, `.bps`, or WASM changes. The engine's geometry is already correct in
  model space; this is a rendering change only.
- Not a redesign of the packing pane's layers or interaction. Output should be
  visually identical except where it is currently wrong.

## Approach

### Phase 1 — Establish the transform, prove it on one layer

- Add `bpPackingModelTransform(sheet, worldRect)` returning the
  `translate(...) scale(s, -s)` string, mirroring upstream's `getTransform`.
- Wrap a single leaf layer (the grid) in `<g transform=…>` and emit its geometry
  in model coordinates.
- Assert equivalence: for a set of sample points, the rendered position under the
  transform matches `bpPackingPointToSvg` to within a pixel. This is the safety
  net for every later phase — if it holds, the migration cannot move anything.

### Phase 2 — Port the arc renderer verbatim

- Replace `bpArcPathToSvgPath`'s derived sweep with upstream's constant, now that
  the path data is in model space where that constant is valid.
- Keep the existing arc tests; they should pass with expectations updated to the
  constant, and the near-collinear case becomes trivially satisfied.
- Add the `minimal_repro_circle_issue.osf` geometry as a fixture and assert the
  rendered region stays within the flap circle — the user-visible bug, expressed
  as a test. **Derive the expected numbers from the engine, not from our
  renderer** (see the probe below).

### Phase 3 — Migrate the remaining layers

Layer by layer, each verified against the Phase 1 equivalence check: flaps and
clearance circles, rivers, creases and primitives, devices and stretch gadgets,
conflicts, labels.

Labels need care: they must not be mirrored by the `scale(1, -1)`. Upstream
counter-flips each label (`svg/index.ts` wraps them in `scale(1 -1)`); do the
same rather than special-casing their coordinates.

### Phase 4 — Migrate input and hit geometry

The inverse path (`bpPackingSvgToPoint`, the marquee, drag targets) must land in
the same coordinate system. Prefer `getScreenCTM().inverse()` on the transformed
group over hand-inverting the transform, so forward and inverse can never drift.

Interaction is the riskiest part of this change: a previous attempt to alter
drag-adjacent geometry regressed marquee and multi-select
(`bp-studio-audit-fixes.md` item 6). Migrate input last, behind the equivalence
check, and exercise marquee, multi-select, flap drag and device drag before
landing.

### Phase 5 — Remove the screen-space helpers

Delete `bpPackingPointToSvg` / `bpPackingRectToSvg` / `bpPackingSvgToPoint` and
their per-call `paperRect` threading once nothing uses them. Leaving both
conventions alive is how the two definitions drift apart again.

## Verification

- `npx tsc --noEmit`, eslint, `npm run test:web`, `npm run i18n:check`, and the
  production web build.
- The equivalence check from Phase 1 kept green through every phase.
- Browser: the repro file renders its conflict inside the flap circle; flap and
  device drag, marquee, multi-select and click-cycling all still work.
- Compare against upstream directly where possible — `tools/bp-studio-oracle`
  already runs BP Studio's Core headlessly and is the natural place to diff
  rendered geometry rather than eyeballing it.

## Open question: the actual cause of the repro

**This plan does not yet claim to fix the reported bug** — it removes the reason
the bug is hard to reason about.

What is established: the engine's output for the repro is correct (junction
`a=5 b=7`, `distance_after_flap_radii = 1`, path 0's vertices exactly 1.0 from
flap 5's centre, so the region lies inside that circle). What is *not*
established: which part of our rendering moves it. The arc-direction change in
`fedce83d` was verified **not** to alter this case — the pre-change code renders
it identically — so the sweep flag is not the cause.

Remaining candidates, to test before or during Phase 2:

- the `large-arc-flag`, which we always emit as `0`;
- the endpoint convention — canvas `arcTo` ends at the *tangent point*, not at
  `to`, and upstream's SVG exporter approximates by ending at `to`;
- an off-by-one between an arc's radius/anchor and the vertex it is stored on.

A Rust probe that prints the engine's junction geometry for a given tree is in
the scratchpad (`repro_circle_issue.rs`); land it as a real test alongside the
Phase 2 fixture so the expected numbers are traceable to the engine.

## Checklist

- [ ] 1. `bpPackingModelTransform` + grid layer in model space + equivalence test.
- [ ] 2. Diagnose the repro against the candidates above; port the arc renderer
      verbatim; land the engine-derived fixture.
- [ ] 3. Migrate the remaining draw layers, labels counter-flipped.
- [ ] 4. Migrate input/hit geometry via `getScreenCTM().inverse()`; verify
      marquee, multi-select and both drag paths.
- [ ] 5. Delete the screen-space helpers.
- [ ] 6. Full validation + browser pass on the repro file.
