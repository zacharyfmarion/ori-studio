# Spherical simplicity — local self-intersection at a non-flat vertex

## Goal

Tell the user when a vertex's fold angles make the paper pass through itself at
that vertex. Closure already says the angles *agree*; nothing yet says the
result is *physically reachable*.

## Why this belongs on the non-180 branch

Before this branch every vertex was flat, and every flat vertex ran Oriedita's
little-big-little check. Local self-intersection was covered everywhere.

This branch introduces a class of vertex — non-flat — that gets the closure
condition and **no self-intersection check at all**.

That is a coverage regression against the very object the branch adds, which is
the same argument that made Phase 6 a merge blocker rather than a follow-up.

**The plan's original justification for deferring this was wrong, and the
correction is the reason this is being written.** It claimed the check "leans on
the simulator the way `G` leans on the flat folder for taco-tortilla". The
simulator does not do that. `packages/origami-simulator` is Ghassaei's mass-spring
model — axial, crease and face stiffness, and no intersection test of any kind.
Paper passes through paper and the render looks fine. So nothing downstream
catches this today.

## The condition

Put a small sphere around a vertex. The creases pierce it at n points; the
sectors between them become great-circle arcs. Folding moves those points around
the sphere, but **arc lengths are preserved** — paper does not stretch — so the
folded vertex link is a closed spherical polygon whose side lengths are exactly
the planar sector angles.

- **Closure** — the polygon closes. Already checked.
- **Simplicity** — the polygon does not cross itself. Not checked.

The paper is locally embedded near the vertex exactly when its link is simple, so
these are two independent questions and Phase 6 answers only the first.

### The flat limit is the degenerate case

At `rho = ±180` every point of the polygon lies on one great circle. Every arc
overlaps every other; "simple" stops being a meaningful predicate and the
question becomes the combinatorial one about how sectors nest — which is exactly
what little-big-little is, and why the flat case needs its own algorithm.

`vertex_regime` already dispatches exactly-flat vertices to Oriedita's port, so
the degenerate case never reaches this code. The worry was the *approach* to it —
at 179° the arcs are nearly coincident and the intersection normals near zero.
Q4 measured that and it turned out benign: conditioning thins smoothly with no
cliff, and the verdict does not depend on tolerance.

## What already exists

Almost all of it, which is what makes this cheap:

| Need | Where it is |
| --- | --- |
| Fan extraction, angularly ordered | `VertexFan` |
| Determinacy gating (unassigned crease, unsplit T-junction) | `Indeterminate` — the hard part, done |
| Flat vs spatial dispatch | `vertex_regime` / `dispatched_camv` |
| The rotation chain | `closure_product` — same quaternion helpers, but **not** the same composition order; see Q1 |
| Presentation-layer threshold, diagnostics plumbing | `spatial_closure_diagnostics` |

So this adds a test, not a subsystem.

## Cost

Per vertex: `n(n-3)/2` arc-pair tests, each a few cross and dot products.

Against what is already paid on every spatial vertex — `vertex_dof` runs `n+1`
closure products, O(n²) quaternion multiplies, plus Gaussian elimination — this
is the **same order**, roughly a doubling. Spatial vertices are only those
touching a non-classic crease, a small fraction of a typical pattern.

## Approach

### The test

```text
great circle through a, b   ->  normal  n = a × b
two circles meet at         ->  ±(n₁ × n₂)
p is within arc (a,b)       ->  (a × p)·n ≥ 0  and  (p × b)·n ≥ 0
```

Adjacent arcs share an endpoint by construction and are skipped. Degenerate
inputs — coincident or antipodal circles, zero-length arcs — need explicit
handling rather than falling out.

### Getting the convention right by invariant, not by algebra

The polygon's vertices come from walking the same per-crease quaternions, but
*which* composition order is easy to get subtly wrong, and a wrong one still
produces a plausible-looking polygon. It did: see Q1.

So the construction is validated against a property rather than a derivation:

> **The arc length between consecutive folded crease directions must equal the
> planar sector angle between them, for every sector, at every fold angle.**

Paper does not stretch. If the arc lengths come out right the construction is
right; if they do not, the convention is wrong. This settled the question
empirically instead of by reasoning about quaternion ordering — and it caught a
real error. **The fan must be asymmetric**: a symmetric one passes under both
conventions.

### The oracle problem, and a way around it

Every other check on this branch was validated against something external —
Oriedita's `Check4`, Wong's equations, the C++ oracle. Oriedita does not do
spherical simplicity, so there is nothing to port against.

**But the flat limit is an oracle.** Take a vertex Oriedita's LBL flags, perturb
it just off flat, and the spherical test must flag it too; take a clean one and
it must stay clean. That turns Oriedita's existing LBL implementation into a
reference for the near-flat regime — which is both the hardest regime
numerically and the one with an answer we already trust.

It does not validate the far-from-flat regime. Nothing does, so those cases get
fixtures — Q5 produced concrete self-intersecting fans to seed them.

## Spike findings (complete)

All five questions ran. One changed the plan, one nearly cancelled it, and the
rest confirmed the approach cheaply.

### Q1 — the plan's construction was wrong, and the invariant caught it

This document originally said the polygon's vertices are
`closure_product`'s partial products. **They are not.** `closure_product`
left-multiplies (`R_i = q_i * R_{i-1}`, giving Wong's `q_n···q_1`), and the
sector frames compose the other way.

The arc-length invariant separates them unambiguously — but only on an
**asymmetric** fan. The first attempt used a symmetric degree-4 vertex and both
conventions passed at 1e-14, which would have shipped a coin flip:

| fan | left `q·R` | right `R·q` |
| --- | --- | --- |
| deg-4 symmetric | 2.5e-14 | 2.5e-14 |
| deg-4 asymmetric | **8.8e0** | 1.0e-13 |
| deg-5 asymmetric, drive 120° | **7.4e1** | 2.5e-14 |
| deg-5 asymmetric, drive 170° | **8.1e1** | 2.5e-14 |
| deg-6 asymmetric | **5.4e1** | 1.0e-13 |

(max |arc length − planar sector angle|, degrees)

So the construction is `R_i = R_{i-1} * q_i`, and the polygon needs **its own
walk** rather than a hook into the closure chain. Cheap either way, but R5's
"one chain" mitigation is not available as written.

A second prediction confirms it physically: at full fold the link must collapse
onto a single great circle, since the paper is flat. Measured out-of-plane
component **1.9e-16**.

### Q2 — the crossing primitive is correct

Synthetic spherical polygons with known answers: square → Simple, bowtie →
SelfIntersects, pentagon → Simple, pentagram → SelfIntersects. 4/4.

### Q3 — agrees with Oriedita, and refuses rather than guesses at flat

Against `find_flat_foldability_violation` on a degree-4 fan with sectors
20/100/160/80:

- **BLB-respecting** (Oriedita: no violation) — Simple at every fold angle
  tested from 150° to 179°. No false positives.
- **BLB-violating** (Oriedita: `LittleBigLittle`) — at exactly flat the test
  returns **Degenerate**, conditioning 3.6e-15. That is the wanted behaviour:
  it declines rather than inventing an answer, and dispatch sends the vertex to
  Oriedita's LBL anyway.

**Gap, stated plainly:** the violating case could not be tested at
*near*-flat, because the spike's coordinate-descent solver would not converge
there. So "does it detect a violation at 179°" is unanswered. This is a harness
limitation, not a finding about the check — the product never solves anything,
it evaluates angles the user supplied — but it does mean near-flat detection is
unvalidated and needs a fixture built during implementation.

### Q4 — conditioning degrades predictably, and slack does not matter

Sweeping a degree-4 fan along its folding path, conditioning tracks
`sin(180° − |ρ|)` almost exactly:

| 180−ρ | 90° | 30° | 10° | 5° | 2° | 1° |
| --- | --- | --- | --- | --- | --- | --- |
| conditioning | 1.00 | 0.87 | 0.17 | 0.087 | 0.035 | 0.018 |

There is no cliff — it thins smoothly toward the flat singularity. And the
verdict is **identical for in-arc slack of 0, 1e-12, 1e-9 and 1e-6** across the
band, so this does not need a tuned tolerance, which removes the risk that
motivated the spike (R1).

Across 1,400 sampled fans (Q5) with near-flat states excluded, `Degenerate` was
returned **zero times**. The degenerate guard only fires at the flat singularity
that dispatch already routes elsewhere.

### Q5 — the check is not vacuous, and degree matters

The question worth asking before building anything: among **closed** non-flat
fans, does self-intersection actually occur, or does closure already imply it?

Random sector angles, solved to closure, near-flat states rejected:

| degree | closed samples | Simple | SelfIntersects |
| --- | --- | --- | --- |
| 4 | 271 | 271 | **0** |
| 5 | 345 | 330 | 15 (4.3%) |
| 6 | 390 | 376 | 14 (3.6%) |
| 7 | 394 | 343 | 51 (13%) |

So it is real, and it grows with degree. Concrete fixtures fell out of this and
should be lifted into the implementation's tests, e.g.

```text
theta = [0, 77.7, 153.0, 229.3, 310.2]   rho = [143.2, -145.1, 139.4, 107.7, 70.2]
```

**Degree 4 never self-intersected in 271 closed samples.** That is worth
knowing — degree-4 is the common case — but it is evidence, not proof, and the
sample is biased: the solver fails on some fans and the survivors may be the
better-conditioned ones. Do not turn it into a fast path that skips degree-4.

### Verdict

Build it. The primitive is correct, the construction is pinned by a physical
invariant, the near-flat numerics turned out benign rather than delicate, and
the check catches real configurations that nothing else in the app catches.

## Affected Areas

- `crates/oristudio-cp/src/checks_spatial.rs` — the polygon and the test
- `crates/oristudio-cp/src/lib.rs` — a diagnostic kind beside `SpatialClosure`
- `apps/web/src/cp-workspace/diagnostics/` — message and glyph for the new kind
- `apps/web/public/locales/*` — 8 locales

## Checklist

- [x] Spike 1 — construction validated by the arc-length invariant, on an
      **asymmetric** fan (a symmetric one does not discriminate)
- [x] Spike 2 — primitive correct on synthetic polygons, 4/4
- [x] Spike 3 — agrees with Oriedita on the clean case; declines at exactly flat
- [x] Spike 4 — conditioning tracks `sin(180-|rho|)`, no cliff, slack-insensitive
- [x] Spike 5 — self-intersection is reachable (0% at degree 4, 4-13% at 5-7)
- [ ] Near-flat detection of a *violating* fan — unvalidated, needs a fixture
- [ ] Polygon builder sharing the closure chain, not a second implementation
- [ ] Arc-arc intersection with explicit degenerate handling
- [ ] Simplicity test, adjacency-skipping, O(n²)
- [ ] Near-flat policy: refuse rather than guess, if the spike says so
- [ ] Indeterminate fans report nothing, same as closure
- [ ] Diagnostic kind, message, glyph, 8 locales
- [ ] Oracle suite green with no fixture edits

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | ~~Near-flat numerical instability~~ | **RETIRED by the spike.** Conditioning thins smoothly as `sin(180-\|rho\|)` with no cliff, and the verdict is identical for slack from 0 to 1e-6. No tuned tolerance needed. The only failure is exact flat, which dispatch already routes to LBL |
| R2 | No external oracle for the far-from-flat regime | Flat-limit agreement with Oriedita LBL covers the near-flat end; the rest gets hand-argued fixtures. State the limit rather than implying full coverage |
| R3 | Wrong composition convention yields a plausible but wrong polygon | The arc-length invariant catches it, and is spike step 1 |
| R4 | Scope creep into global self-intersection | Vertex-local only. Two distant parts of the sheet colliding is a different problem and stays out — the same line Phase 6 drew |
| R5 | A second traversal drifts from `closure_product` | **Unavoidable — the spike showed the two compose in opposite directions**, so the polygon cannot ride the closure chain. Mitigate with the arc-length invariant as a test, which is what caught the error in the first place |

## Non-goals

- Global self-intersection between distant parts of the sheet.
- Reachability: a configuration can be simple yet unreachable from flat without
  passing through self-intersection. That is a path question, not a state one.
- Layer ordering for non-flat states.
