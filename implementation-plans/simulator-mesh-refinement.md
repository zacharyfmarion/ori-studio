# Simulator Mesh Refinement

## Goal

Make simulation quality a property of the *pattern*, not of how it was drawn.

Two invariants, and today we hold neither by construction:

1. Splitting a crease into collinear segments must not change the simulation.
   The redundant-vertex merge gives us this by canonicalising the crease graph
   before triangulation.
2. The canonical mesh must be good enough to simulate. This is the open half.
   Our triangulator picks diagonals among the vertices a face already has, so a
   face's mesh quality is dictated by its ring — and after canonicalisation the
   ring is exactly as coarse as the pattern really is.

Measured on a 24-generation iguana CP after canonicalisation: 3972 vertices,
6519 faces, **worst triangle angle 0.82 degrees**, 352 triangles under 5 degrees.
The solver's crease force divides by the adjacent triangle's height from the
crease edge, so a sliver hands the explicit integrator a force far larger than
its timestep assumed, and the fold either converges slowly or not at all.

Before canonicalisation the same file measured 2.04 degrees and 341 slivers —
better, but only because the CP happened to contain split creases whose extra
vertices acted as accidental mesh resolution. That is the drawing style leaking
into the physics, which is the thing invariant 1 exists to stop. The honest
baseline is the canonical mesh, and it needs refinement rather than luck.

## Approach

Add a quality-driven refinement pass after canonicalisation and before (or as
part of) triangulation, so the mesh is refined for geometry rather than for
history.

**What refinement may and may not touch.** Crease geometry is the physics and
must not move: no vertex may be repositioned, and no crease may change its fold
angle or its endpoints. Two operations are safe:

- **Interior Steiner points.** New vertices strictly inside a face. They carry no
  assignment, belong to no crease, and only give the triangulator anchors.
- **Splitting an edge at a point on it.** Geometrically identical paper; a split
  crease is two collinear halves with the same fold angle, which is precisely the
  configuration invariant 1 declares equivalent. Needed because a triangle
  touching a long unsplit boundary edge cannot be well-shaped no matter what the
  interior looks like.

**Ordering matters, and is load-bearing.** Canonicalise first, refine second. The
app prepares twice (`prepareSimulationFold` runs `prepareFoldModel` around a
winding pass and a fold-angle flip), so the second pass will re-merge whatever
splits the first pass introduced and then re-refine them identically. That is
stable, but only in this order — refine-then-merge would fight itself.

**Algorithm.** Ruppert-style constrained Delaunay refinement is the standard fit:
repeatedly split the segment or insert the circumcentre of the worst triangle
until every triangle clears a minimum-angle target. Upstream's curved-folding
path reaches for the same class of tool (`cdt2d` plus an orthogonality-driven
swap loop, `curvedFolding.js`); its FOLD path has nothing, which is why upstream
tells the user to lower the timestep by hand instead.

**The real cost is degrees of freedom.** Every added vertex is three more
unknowns in the solver, and these patterns already run to thousands. Refinement
must therefore be bounded rather than run to a fixed quality target: refine worst
triangle first, stop at a quality threshold *or* a vertex budget, whichever binds
first. A 20-degree floor on a well-conditioned pattern should add almost nothing;
on the iguana it will add real vertices, and whether that pays for itself is a
measurement, not a guess.

## Affected Areas

- `packages/origami-simulator/src/prepare.ts` — the refinement pass and its
  ordering against `removeRedundantVertices` and `triangulateFold`
- `packages/origami-simulator/src/types.ts` — quality target and vertex budget in
  `PrepareFoldOptions`
- `packages/origami-simulator/tests/corpus.test.ts` — quality assertions over the
  private corpus, alongside the existing invariant checks
- `crates/treemaker-fold/src/lib.rs` — mirror only if the Rust path needs parity;
  it has no quality triangulator today either

## Measured, before building the real thing

A first attempt — subdivide the ring edges of thin faces so the flip pass has
anchors, budgeted at +25% vertices — was implemented and **reverted**. On 42 real
patterns:

| | naive subdivision |
| --- | --- |
| vertices | +24.4% (budget-bound) |
| triangles under 5 degrees | -13.4% |
| triangles under 20 degrees | **+4.4%** |
| worst angle | better on 5, **worse on 22**, unchanged on 15 |
| 200 solver steps | **+25-40%** wall clock |

Splitting a shared edge changes the ring of the face on the other side too, and
without a triangulator that re-optimises globally the neighbour often comes out
worse than it started. Paying a quarter of the vertex count for that is not a
trade worth making.

Two measurements from the same session that should shape the real attempt:

- **The slivers are ours, not the design's.** On the iguana fixture the crease
  pattern's own faces have a worst corner of 8.13 degrees and *zero* corners
  under 5. The prepared mesh has a worst angle of 0.82 degrees and 352 triangles
  under 5. Nothing about the pattern forces this.
- **They come from thin faces, not bad corners.** Choosing each quad's diagonal
  by max-min-angle instead of by length changed 1 pattern out of 42 — for most
  quads the two rules already agree. A 100x1 quad has four 90-degree corners and
  no good triangulation at either diagonal, which is the shape that has to be
  fixed, and it cannot be fixed without new vertices.

So refinement is still the answer, but it has to be a real constrained Delaunay
refinement that re-triangulates affected neighbours as it inserts, not a
subdivision pass bolted in front of earcut.

## Checklist

- [ ] Baseline the corpus: min angle, sub-5-degree count, vertex count, and
      solver settle time per pattern, so "better" is measurable
- [ ] Decide the quality metric — minimum angle is the one the crease force's
      moment arm actually depends on
- [ ] Implement interior Steiner insertion for the worst triangle first
- [ ] Implement constrained edge splitting, preserving assignment and fold angle
      on both halves
- [ ] Bound the pass by quality target and vertex budget; expose both as options
- [ ] Verify the canonicalise-then-refine order is stable across the app's double
      prepare (same mesh in, same mesh out)
- [ ] Re-run the corpus: quality up, and record what it cost in vertices and in
      wall-clock settle time
- [ ] Golden traces: expect movement, and re-bless only with the diff understood
- [ ] Decide from the numbers whether refinement is on by default, or a setting
