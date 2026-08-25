# Isolation when two unknown creases are collinear

## Goal

Stop `solve_k` discarding correct, isolated answers at the commonest vertex in
origami: a degree-4 vertex whose two undecided creases are the two halves of one
straight line.

Today it finds both answers, marks them non-isolated, returns `Underdetermined`,
and propagation declines. The direction hints that would settle the choice never
run, because `forced_answer` only tie-breaks on `Branching`.

Reported against `test_files/non-flat/solve/failure_case_flat.osf`: a square with
both diagonals creased, one diagonal decided (−180 / +180), the other two halves
undecided and hinted Mountain. Clicking the centre vertex does nothing.

## What is measured, and what is not

Everything in this section was run against the shipped kernel. It is separated
from the analysis below on purpose — a previous pass on this vertex asserted a
one-parameter family three times from a hand-rolled residual that turned out to
be computing `|rho_1 + rho_2|`, ignoring both the known angles and the sector
geometry. Nothing here comes from a re-implementation of the closure condition.

**The solution set is two points.** Sweeping both unknowns over
`[-180, 180]` at 45-degree steps with `checks_spatial::vertex_closure_residual`,
the only zeros are `(-180, -180)` and `(+180, +180)`. Stepping off `(-180, -180)`
along the diagonal gives residual `2 * offset` — 0.5 degrees off is 1.0, 5
degrees off is 10.0. That is a linear response around an isolated root.

**The Jacobian rows are identical, at every angle.**

```
at (-180.0,-180.0) residual   0.000 rank 1  q=(+1.0000,-0.0000,+0.0000,+0.0000)
      d/d0 of vector part = [-0.353553, +0.353553, +0.000000]
      d/d1 of vector part = [-0.353553, +0.353553, +0.000000]
at ( -90.0, -90.0) residual 180.000 rank 1  q=(-0.0000,-0.7071,+0.7071,+0.0000)
at (   0.0,   0.0) residual 360.000 rank 1  q=(-1.0000,+0.0000,+0.0000,+0.0000)
```

Not merely dependent rows — the same vector. `crease_quat` builds its axis as
`(cos theta, sin theta, 0)`, and the two unknowns sit at bearings −45 and 135,
so their axes are antiparallel. Rank is 1 at ±180 and equally at −90, −45 and 0,
so **the collinearity causes it, not the full fold**.

**`w` is what separates the branches.** Along the diagonal the closure quaternion
runs `(+1,0,0,0)` → `(0,-0.707,+0.707,0)` → `(-1,0,0,0)`. The scalar part carries
the closed/not-closed distinction, and `closure_with` discards it:

```rust
fn closure_with(fan: &SolveFan, unknowns: &[usize], angles: &[f64]) -> [f64; 3] {
    let (_, x, y, z) = closure_product(&vertex.creases);   // w dropped
    [x, y, z]
}
```

**Not in question.** `quat_residual` returning `[0, 2*pi]` rather than folding to
`[0, pi]` is deliberate and documented: `q = -1` must read as `2*pi`, "or every
Maekawa violation reads as a perfect closure". Do not touch it.

**Not established.** Whether a collinear pair is *ever* a genuine family. The
existing docs say it always is; this vertex says it is not. One vertex does not
settle the general case, which is what Phase 1 is for.

## The defect

`solve_k` derives isolation from the rank of a Jacobian taken on the vector part
alone:

```rust
let rank = rank_at(fan, unknowns, &snapped);
...
isolated: rank == unknowns.len(),
```

Near `q = +1` the vector part *is* the closure condition to first order, which is
why the damped least-squares solve works and why both correct answers are found.
But the same Jacobian is then reused as a **uniqueness** test, and there it has a
blind spot: when the unknowns are collinear the vector-part sensitivities
coincide, so rank < k regardless of whether the root is isolated. The branches
separate in `w`, which the Jacobian cannot see.

Then `isolated_count < solutions.len()` makes the verdict `Underdetermined`, and
the answers are thrown away.

Full rank still soundly implies isolation. It is the converse that does not hold,
and the converse is what the code relies on.

## Approach

Test isolation on something that can see `w`, without touching the residual, the
solver, or the k >= 4 refusal — all of which are correct.

The candidate that fits what is measured: a root is isolated when the residual
**rises in every direction around it**. That is directly checkable, needs no
Jacobian, and is exactly what the fine sweep did by hand. Rank stays as the cheap
first answer; the probe runs only when rank says non-isolated, so the common path
does not pay for it.

Rejected before writing, and why:

- **Include `w` as a fourth Jacobian row.** The natural move, and wrong: at
  `q = +1` the derivative of `w` is zero by construction (`w = cos(rho/2)` is at
  its maximum), so the row is zeros at exactly the solutions that matter. This is
  worth confirming numerically in Phase 1 rather than trusting the algebra.
- **Special-case collinear pairs.** Treats the symptom. The blind spot is the
  vector-part Jacobian's, and collinearity is one way to reach it, not the only
  one — `vertex_dof` names mid-crease points as another.
- **Restrict flat patterns to ±180.** What the first analysis proposed. It would
  make this vertex work and is the wrong fix: the answers are already found, and
  a whole flat-pattern mode to work around a uniqueness test is a large feature
  paying for a small bug.

## Affected Areas

- `crates/oristudio-cp/src/solve_k.rs` — `rank_at` / `isolated`, the module doc's
  "Why the arity is not the test" section, `solve_parallel_pair`'s doc.
- `crates/oristudio-cp/src/checks_spatial.rs` — `vertex_dof`, if it shares the
  inference.
- `implementation-plans/fold-angle-propagation.md` — the k=2 measurements are
  broken out by "collinear" as a category assumed to be a family.
- Nothing in the web app: the verdict change surfaces through machinery that
  already exists.

## Checklist

### Phase 1 — establish the general case before changing anything

- [ ] Is a collinear pair ever a genuine family? Sweep the residual around the
      reported solutions on every collinear k=2 vertex in the Tier A corpus and
      the 563 scraped `.cp` files, and classify each as isolated-roots or
      continuous. The answer decides whether this is a fix or a special case.
- [ ] Confirm the `w`-row derivative really is zero at `q = +1`, numerically, so
      the rejection above is measured rather than argued.
- [ ] Count the population: how many k <= 2 vertices across both corpora are
      currently `Underdetermined` with a rank-deficient Jacobian *and* an
      isolated root. That is the size of what this recovers.

### Phase 2 — the isolation test

- [ ] Directional residual probe, gated behind `rank < k` so the common path is
      unchanged.
- [ ] Choose the probe radius and step from Phase 1's sweep rather than by feel,
      and record why in the code.
- [ ] `solve_parallel_pair` samples a line it believes is the solution set. If
      Phase 1 says otherwise, its sampling is still a fine way to seed refinement
      — but its doc has to stop claiming the line *is* the answer.
- [ ] A test built from the reported vertex: two collinear unknowns, both
      answers found, verdict `Branching` rather than `Underdetermined`. Prove it
      discriminates by reverting the probe.

### Phase 3 — measure the blast radius

- [ ] Re-run the k-cap correctness sweep from `DEFAULT_MAX_COMMIT_K`'s doc
      (1,600 runs, 200 scraped patterns) before and after. A verdict change turns
      declines into commits, so the error rate is the number that matters and
      `Determined` at k=2 is already only locally isolated.
- [ ] `cargo test --workspace`, oracle parity, and the web suite. Rebuild the
      wasm bridge — a kernel-only change leaves the JS glue identical, so every
      check passes over a stale artifact otherwise.
- [ ] Confirm the reported file now solves end to end in a browser, with the
      Mountain hints selecting `(-180, -180)`.

### Phase 4 — the wording

- [ ] Correct every place that infers "not isolated" from "rank deficient". See
      the list in Affected Areas; the claims are load-bearing and repeated.
