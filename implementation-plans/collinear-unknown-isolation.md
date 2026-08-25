# Isolation when two unknown creases are collinear

## Goal

Stop `solve_k` discarding correct answers at the commonest vertex in origami: a
degree-4 vertex whose two undecided creases are the two halves of one straight
line.

It found both answers, called them a family, returned `Underdetermined`, and
propagation declined. The direction hints that would settle the choice never ran,
because `forced_answer` only tie-breaks on `Branching`.

Reported against a square with both diagonals creased, one diagonal decided
(−180 / +180) and the other two halves undecided and hinted Mountain. Clicking
the centre vertex did nothing.

## What is true, and how the first two accounts of it were wrong

The mechanism is not what it first looked like, twice, and both wrong turns came
from a probe rather than from reasoning. Recording them because the shape of the
mistake is the useful part.

**The rank deficiency is real and correct.** Two collinear unknowns have
antiparallel rotation axes, so `closure_jacobian`'s two rows are the *same
vector* — at ±180 and equally at −90, −45 and 0. `solve_parallel_pair` is right
that the solution set is a line, and the residual really is **exactly zero**
along `(-0.707, +0.707)` out of `(-180, -180)`, at every radius sampled.

**But the line is unreachable.** Every member of it except the endpoint needs an
angle past ±180, and `with_signed_fold_angle` refuses those — "a caller offering
one has a bug". Splitting the same probe by domain says it plainly:

```text
radius  0.1: in-domain dirs  9 min   0.100000 | out-of-domain min   0.000000
radius  0.5: in-domain dirs  9 min   0.500000 | out-of-domain min   0.000000
radius  5.0: in-domain dirs  9 min   5.000000 | out-of-domain min   0.000000
```

Nine of thirty-two directions stay storable, and the residual climbs at the full
probe radius in all nine. So the reachable answers are two points, the user has a
mountain/valley choice, and `Underdetermined` was the wrong word for it.

**Two earlier accounts, both wrong, both from a bad probe:**

1. *"There is a one-parameter family, so committing ±180 would be guessing."*
   From a hand-rolled residual that was computing `|rho_1 + rho_2|` — it ignored
   the known angles and the sector geometry entirely.
2. *"The solution set is two isolated points, so the docs are wrong."* From a
   harness built on `with_signed_fold_angle`, which **no-ops outside ±180**, so
   probing to −180.5 silently left that crease unassigned and returned a
   meaningless residual.

The lesson that generalises: a probe that drives fold angles through the public
setter cannot sample past ±180, and any question about behaviour *at* the full
fold is a question about exactly that boundary. Use `residual_degrees_of`, which
does not clamp.

## The defect

```rust
isolated: rank == unknowns.len(),
```

Rank measures flatness on the unconstrained reals. Isolation, for this purpose,
is a question about the answers a document can hold. The two differ exactly when
a flat direction leaves ±180, which is the collinear case, which is everywhere.

## Approach

Keep rank as the cheap first answer — full rank still implies isolation, so the
probe only runs when the rank is deficient, and at k = 1 the rank is 1 whenever
the answer is real, so the live check never pays for it.

When the rank is deficient, ask whether the residual climbs in every direction
**that stays inside ±180**. Directions leaving the range are skipped rather than
counted as flat; a solution with no representable neighbours at all is left
declined, since untested must not read as isolated.

Rejected, and why:

- **Add `w` as a fourth Jacobian row.** The obvious move. Measured: at a closed
  vertex `w = cos(rho/2)` is at its maximum, so `dw/drho = [0.000000000,
  0.000000000]` — zeros at exactly the solutions that matter.
- **Restrict flat patterns to ±180.** An earlier proposal. It would fix this
  vertex, and it is a whole feature paying for a uniqueness test.
- **Trust collinearity.** A collinear pair whose knowns are `(0, 0)` is a
  *genuine* reachable family — an uncreased sheet with one straight line folds by
  any angle, all storable. It must keep declining, and it does.

## Affected Areas

- `crates/oristudio-cp/src/solve_k.rs` — `is_isolated`, `flatness_directions`,
  the module doc, `solve_parallel_pair`'s doc, `DEFAULT_MAX_COMMIT_K`'s numbers.
- `crates/oristudio-cp/src/checks_spatial.rs` — `vertex_dof` counts the same
  unconstrained freedom and now says so.
- `implementation-plans/fold-angle-propagation.md` — two k=2 measurements read a
  rank as a family.

## Checklist

- [x] **Phase 1 — is a rank-deficient answer ever a reachable family?** Yes, and
      rarely. Sweeping the storable directions: **681 of 751** such k=2 vertices
      on `known-good` and **906 of 1,038** on the 563 scraped `.cp` files climb
      in every reachable direction. Roughly 88% were answers being discarded; the
      rest are real families.
- [x] Confirm the `w`-row rejection numerically rather than by algebra.
- [x] **Phase 2 — the isolation test.** `is_isolated`, gated behind `rank < k`,
      three radii, bar scaling with the radius, out-of-range directions skipped.
- [x] Radius and bar chosen from the sweep: an isolated root climbs at roughly
      the probe radius, so a fixed bar rejects everything at 0.1 degrees. A tenth
      of the radius separates the populations by an order of magnitude, with a
      floor so the smallest radius cannot be answered by storage noise.
- [x] Regression tests, both directions, both mutation-proven:
      `a_family_that_leaves_the_storable_range_is_not_a_choice_the_user_has` and
      `a_family_that_stays_in_range_still_declines`.
- [x] **Phase 3 — blast radius.** k <= 1 unchanged at 9,123 commits / 8 wrong,
      confirming the probe never runs on the live path. k <= 2 moves 9,182 → 9,203
      commits and 29 → 33 errors: **19% of what the recovery adds is wrong**,
      against 80% for an outright guess. Recorded at `DEFAULT_MAX_COMMIT_K`.
- [x] **Phase 4 — the wording**, including the two accounts above that were
      committed before being checked.

### Open

- [ ] The reported `.osf` end to end in a browser, with the Mountain hints
      selecting `(-180, -180)`. The kernel path is covered; the UI path is not.
- [ ] Re-census the k=2 exception breakdown in `fold-angle-propagation.md`. Its
      collinear / ±90 / "genuinely rank-1" buckets were classified by rank, so
      the "none is a solver miss" line understates by however many of those 88%
      fall inside it.
- [ ] The 19% marginal error rate deserves its own look. A recovered
      `Determined` is a single answer the solver believes unique; four of
      twenty-one were not the original, which suggests the solution set was
      incomplete rather than the isolation call being wrong.
