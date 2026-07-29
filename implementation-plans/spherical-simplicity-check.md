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
transversality of a meeting ->  |n₁ × n₂| / (|n₁||n₂|)
```

Adjacent arcs share an endpoint by construction and are skipped.

**A meeting only counts when it is transverse.** A tangential meeting is two
layers of paper lying against each other, which is legal and is what a crease at
±180 produces by construction — see Q6. This is the part the first draft of this
plan got wrong.

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

### Q6 — a crease at exactly ±180 breaks the criterion, and the fix is transversality

**The gap this study found, and the one that would have shipped a wrong check.**

`vertex_regime` sends a vertex to the spatial path if **any** crease is
non-classic. So a vertex with three ±180 creases and one at 90° — a box with
flat-folded flaps, which the kernel's own comments call the expected case —
lands here.

At `rho = ±180` the link curve's interior angle is 0: the curve **doubles back on
itself**. It is non-injective by construction, so "is this curve simple" answers
*no* on a perfectly legal configuration. Two layers of paper lying against each
other is what flat folding *is*.

Measured on a degree-5 fan with creases progressively pinned at ±180: 0 flats →
Simple, 1 flat → Simple, 2 flats → **SelfIntersects**. A false positive.

The fix is to split contacts by **transversality** — the sine of the angle
between the two great circles where the arcs meet:

- **transverse** (real angle) → the surfaces cross → paper through paper
- **tangential** (collinear arcs) → the surfaces coincide over a region → layers
  touching, which is legal

That is not a heuristic; it is the difference between a transverse and a
tangential intersection of two surfaces. And it is computationally clean —
5,146 crossings sampled across degrees 5–7 with 0–4 pinned creases:

| transversality | count |
| --- | --- |
| < 1e-12 | 1520 |
| 1e-12 .. 1e-9 | **0** |
| 1e-9 .. 1e-6 | **0** |
| 1e-6 .. 1e-3 | 4 |
| 1e-3 .. 0.1 | 99 |
| > 0.1 | 3523 |

Bimodal with an **empty gap spanning four orders of magnitude**. Any threshold in
1e-12 .. 1e-6 works; 1e-9 sits in the middle of the gap. No tuning required —
the same conclusion Q4 reached about the in-arc slack.

### Q7 — validation on canonical origami: zero false positives

Random closed fans self-intersect often (12% at degree 5 rising to 39% at degree
7, and higher with creases pinned flat). **That is not evidence of false
positives** — it is the methodological trap in this whole exercise. Closure is
necessary but nowhere near sufficient for a sensible design, so most of the
closure variety *is* garbage, and finding it is the check working.

The validation that counts is known-valid vertices swept along their folding
paths:

| vertex | sectors | fold states 5°–179° |
| --- | --- | --- |
| Miura deg-4 (a=60) | 60/120/60/120 | clean |
| Miura deg-4 (a=75) | 75/105/75/105 | clean |
| box-pleat deg-4 | 90/90/90/90 | clean |
| box-pleat deg-4 | 45/135/45/135 | clean |
| waterbomb deg-6 | 90/45/45/90/45/45 | clean |
| regular deg-6 | 60×6 | clean |
| regular deg-8 | 45×8 | clean |

**63 known-valid configurations, zero transverse crossings, zero tangential
contacts.** No false positive anywhere on the folding path, including at 179°.

Realistic *mixed* vertices — canonical sectors with one crease pinned at ±180 —
came out clean in 7 of 8 cases, including `box-pleat [180, -89, 180, 89]`. The
eighth (a waterbomb with crease 1 pinned) flags two transverse crossings.

**That one is unadjudicated**, and it is the honest residual risk: the solver
found *some* closed completion, not a designed one, and I have no independent way
to say whether it is physically valid. It is not evidence of a false positive; it
is an absence of evidence either way.

### Q8 — the flat-limit oracle plan was ill-posed

This document proposed validating against Oriedita's LBL by taking a
BLB-violating vertex and perturbing it just off flat.

**That cannot be done, and not because of the solver.** Warm-starting from the
exact flat solution (residual 3.1e-14) and walking down, no closed configuration
exists at 180−ε for ε from 0.001° to 10°. A BLB-violating assignment closes
*only* at the flat state.

Which is a better outcome than the test I wanted: the configuration the check
would have to catch near flat **does not exist**, so it never has to. My earlier
"the solver wouldn't converge" diagnosis was wrong — the family is empty.

Near-flat validation comes from Q9 instead.

### Q9 — near-flat detection does work

Taking a Q5 fan known to self-intersect and continuing it toward flat with a
warm start at every step, closure held (residual 8.5e-12) and the verdict stayed
**SelfIntersects all the way to max|rho| = 179.999°**, with zero degenerate
skips. Detection does not thin out as the flat boundary is approached.

### Verdict

Build it — with **transversality filtering, which was not in the original
design**. Without it the check false-positives on any vertex carrying a fully
folded crease, which is a common and legal configuration.

With it: correct primitive, construction pinned by a physical invariant, benign
numerics with no tuned tolerances anywhere, no false positive across 63
known-valid configurations, and detection that holds to 179.999°.

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
- [x] Q6 — **transversality filter**, without which any vertex carrying a fully
      folded crease false-positives
- [x] Q7 — zero false positives across 63 known-valid canonical configurations
- [x] Q8 — the LBL-perturbation oracle is impossible, and does not need to exist
- [x] Q9 — near-flat detection holds to 179.999 degrees
- [ ] Adjudicate a flagged *mixed* vertex (canonical sectors, one crease at 180).
      No independent way to say whether the flagged case is physically valid
- [ ] Polygon builder sharing the closure chain, not a second implementation
- [ ] Arc-arc intersection with explicit degenerate handling
- [ ] **Transverse-only contact counting**, threshold 1e-9 (mid-gap)
- [ ] Test: a vertex with a crease at exactly 180 does not false-positive
- [ ] Test: the canonical vertices stay clean across their folding paths
- [ ] Simplicity test, adjacency-skipping, O(n²)
- [x] ~~Near-flat policy~~ — not needed; Q4/Q9 show no thinning of detection
- [ ] Indeterminate fans report nothing, same as closure
- [ ] Diagnostic kind, message, glyph, 8 locales
- [ ] Oracle suite green with no fixture edits

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | ~~Near-flat numerical instability~~ | **RETIRED by the spike.** Conditioning thins smoothly as `sin(180-\|rho\|)` with no cliff, and the verdict is identical for slack from 0 to 1e-6. No tuned tolerance needed. The only failure is exact flat, which dispatch already routes to LBL |
| R2 | No external oracle at all — **the LBL-perturbation plan turned out impossible (Q8)** | Replaced by canonical-vertex sweeps: seven real origami vertices across their folding paths, which is a stronger test than a single perturbed fixture. State the limit: a flagged *mixed* vertex still cannot be adjudicated |
| R6 | Random-fan sampling read as a false-positive rate | It is not one. Most of the closure variety is genuinely invalid, so a high rate is the check working. Only known-valid fixtures measure false positives |
| R3 | Wrong composition convention yields a plausible but wrong polygon | The arc-length invariant catches it, and is spike step 1 |
| R4 | Scope creep into global self-intersection | Vertex-local only. Two distant parts of the sheet colliding is a different problem and stays out — the same line Phase 6 drew |
| R5 | A second traversal drifts from `closure_product` | **Unavoidable — the spike showed the two compose in opposite directions**, so the polygon cannot ride the closure chain. Mitigate with the arc-length invariant as a test, which is what caught the error in the first place |

## Non-goals

- Global self-intersection between distant parts of the sheet.
- Reachability: a configuration can be simple yet unreachable from flat without
  passing through self-intersection. That is a path question, not a state one.
- Layer ordering for non-flat states.
