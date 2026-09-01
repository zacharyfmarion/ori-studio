# Orientation-Invariant Flat Foldability

Make `CheckCamv` report the same violations for the same crease pattern
regardless of which way up it is drawn — without changing Oriedita's algorithm,
and without losing the oracle.

## Goal

The flat-foldability check is not orientation-invariant. On
`worked_but_has_errors.osf` — a box-pleat straight out of CP detection's exact
solve — the six **bit-exact** coordinate transforms give different answers:

| transform | violations |
| --- | --- |
| as saved | 3 |
| rotated 90° `(x,y) → (-y,x)` | 3 |
| rotated 180° | **2** |
| rotated 270° | 3 |
| mirrored in x | **2** |
| transposed `(x,y) → (y,x)` | **5** |

These transforms only permute and negate coordinates, so not a single bit of
geometry changes. Union of reported sites across the six: **7**. Intersection:
**0** — not one reported violation survives every orientation.

Every one is a false positive. Measured with a well-conditioned angle, the worst
interior vertex in that file carries a Kawasaki residual of **1.6e-7°** against
the 1e-6° bar, and all 48 interior vertices are under it. Snapping the pattern
onto its lattice (`fix_inaccurate_for_indices`) takes all six orientations to 0.

Two consequences we are already paying for:

- **A solved detection ships with errors on it.** This is where the file came
  from. The user solved, the modal offered a bare "Add", and three markers
  appeared. See `staged-recognize-and-solve.md` for the surrounding flow.
- **The bar does not mean what it says.** `Epsilon::FLAT` is a fixed 1e-6°, but
  the measurement it gates has a noise floor that ranges from 0 to ~1.2e-6°
  depending on the fan's orientation and how far off-lattice it sits. A residual
  small enough to guarantee passing does not exist.

The goal is that the six transforms agree, the check stays exact on exact input,
and `check4` keeps its `OracleTested` descriptor honestly.

## Why this is arithmetic, not algorithm

Kawasaki is a condition on **directions**. Whether a vertex folds flat depends on
the angles between its creases and nothing else — not their lengths, not where
the vertex sits, not the pattern's rotation. The algorithm Oriedita implements is
correct. What is not invariant is the arithmetic used to evaluate it.

Crease length enters only through the *measurement*: a direction is inferred from
two points, so a positional error `δ` becomes an angular error `δ/L`. That makes
**short** creases the sensitive ones. It is worth stating because the intuition
runs the other way — a fixed angular error displaces a long crease's far endpoint
further — and that is a true statement about geometric consequence, not about
whether the vertex folds.

So this plan changes no decision the algorithm makes. It changes two arithmetic
choices inside it, both of which are identities in exact arithmetic.

## Approach

### The defect is one subtraction, and it accounts for 99.68% of the error

`find_flat_foldability_violation_inside` (`checks.rs:849`) runs the crimp
reduction: find the minimal sector, collapse a minimal pair whose flanking
creases differ in M/V, shrink the working range, repeat. The shrink is
`checks.rs:946`:

```rust
max_angle -= 2.0 * min_angle;
```

It subtracts twice the **global minimum** sector. The geometry, however, removes
twice the sector that was actually **collapsed** — `temp_angle`, computed eleven
lines above at `:929`. Those are the same number in exact arithmetic, and the tie
test at `:930` is what nominally asserts it:

```rust
if (temp_angle - min_angle).abs() < Epsilon::FLAT {
```

But that window is 1e-6 **degrees**. On the measured vertex four sectors lie
within 8.2e-7 of each other —

```
44.999999831402384  44.999999881412240  45.000000220057835  45.000000651070960
```

— so up to four different pairs qualify, and *which one gets collapsed depends on
the sort order, which depends on orientation*. The scan starts from `SortingBox`
index 1, the ray with the smallest absolute bearing, so rotating the pattern
rotates the starting point and changes the choice.

Decomposing the surviving vertex's final `|max_angle - 2·temp_angle|` of
1.733773e-6:

| source | contribution | share |
| --- | --- | --- |
| real ray geometry | 5.583956e-9 | 0.32% |
| the `2·min_angle` substitution | 1.728189e-6 | **99.68%** |
| the final doubling of `temp_angle` | 2.8e-14 | ~0% |

**The fix is to subtract the sector that was collapsed:**

```rust
max_angle -= 2.0 * temp_angle;
```

This is not a tolerance change and not an approximation. It makes the final
residual equal the Kawasaki alternating sum, which **any legal merge preserves
exactly**: replacing `s(k-1), s(k), s(k+1)` with `s(k-1) - s(k) + s(k+1)` leaves
`Σ(-1)ⁱ αᵢ` unchanged. So the verdict stops depending on which pair was chosen —
provably, not empirically.

Measured on the target vertex, all six transforms, sector form:

```
5.583956e-9  5.583956e-9  5.583985e-9  5.583985e-9  5.583956e-9  5.583956e-9
spread 2.9e-14
```

— even though the reduction genuinely took different paths (round-1 shift
0/0/1/2/1/0, collapsed sector varying across three distinct values).

### An accurate sector is the other half, and it is not optional

Exact subtraction alone is necessary but insufficient. With the stock `acos`
primitive still supplying bearings it leaves three *other* vertices flipping:

| variant | violations across the six transforms |
| --- | --- |
| stock (`acos` bearings, `2·min_angle`) | `[3, 3, 2, 3, 2, 5]` |
| `atan2` bearings only | `[1, 3, 1, 0, 2, 2]` |
| sectors only | `[1, 3, 1, 0, 2, 2]` |
| exact subtraction + `acos` bearings | `[0, 3, 0, 3, 0, 3]` |
| **exact subtraction + `atan2` bearings** | `[0, 0, 0, 0, 0, 0]` |
| **exact subtraction + sectors** | `[0, 0, 0, 0, 0, 0]` |

`orita_calc::angle` is `acos(x/length)` (`geometry/orita_calc.rs:43-67`), a
statement-for-statement transcription of `OritaCalc.java:71-97`. It is
ill-conditioned as its argument approaches ±1 — a **near-horizontal** ray — with
`d(θ)/dc = -1/sin θ`. Measured over 200k random rays per band: error 9.9e-7° at
bearing ≈0°, 9.1e-7° at ≈180°, and 2.8e-14° at 45° and 90°.

**Take the sector route.** Feed the reduction sector angles computed between
consecutive rays,

```
cross = ux·vy − uy·vx      dot = ux·vx + uy·vy
sector = atan2(cross, dot)          normalized into [0, 360)
```

and leave the `SortingBox` ordering, the starting ray, the cyclic scan and every
`Epsilon::FLAT` exactly as they are. Three reasons over patching the primitive:

- `orita_calc::angle` has **19 call sites outside CAMV** — `fold_graph.rs:519`,
  `io/fold.rs:495`, seven in `operations/construction.rs`, three in
  `operations/circle.rs`, `operations/measure.rs:12`, two in
  `operations/transform.rs` — and `tests/geometry.rs:55` pins the primitive
  itself. Changing it makes every one of those a divergence.
- `cross` and `dot` are **rotation-invariant scalars**. Under an exact 90°
  rotation they are bit-identical: `(a,b),(c,d) → (−b,a),(−d,c)` gives
  `cross' = (−b)(c) − (a)(−d) = ad − bc` — the same two products with signs
  rearranged — and `dot' = bd + ac`.
- In sector mode `acos` survives only as an **ordering key**, and its worst
  observed failure is benign there: under rot90 a ray whose true bearing is
  359.999999962665° is reported as `-0.0` and sorted first. That is a cyclic
  rotation of the fan, not a reordering — and exact subtraction has already made
  the starting point irrelevant.

The reduction consumes weights only through *differences*, so substituting a
sector for a difference-of-bearings changes no mathematical quantity. Verified:
the sector prototype reproduces the bearing reduction **bit-for-bit** under
`atan2` on all six transforms and across the corpus, including the site lists and
a `BigLittleBig` verdict.

### Three things measurement killed, recorded so they are not re-proposed

- **Do not split `Epsilon::FLAT` into separate distance and angle constants.**
  Upstream overloads it identically: `Epsilon.java:21,39` defines it once, and it
  serves as a distance (`Check4.java:78,80`), an intersection tolerance
  (`Check4.java:154`) and an angle in degrees (`Check4.java:228,289,390,400,411,
  467`) — 21 call sites. Our merge is faithful parity, not a porting defect.
  There is also a live coupling: `Epsilon::UNKNOWN_1EN4` is numerically identical
  to `FLAT`, and `point_line_map` (`checks.rs:1198`) groups vertices with the
  former while the fan builder admits rays with the latter. Splitting one without
  holding the other at 1e-6 silently drops rays from fans and changes vertex
  degrees.
- **The "Oriedita never enters the band" hypothesis is false.** It is contradicted
  by upstream's own T-junction splitter, its trig-based angle-system drawing, its
  non-axis-exact default grid, and its committed save fixtures. Upstream also
  ships a manual **Fix Inaccurate Lines** tool that snaps creases and then calls
  `check4()` on the next line — `MouseHandlerCreaseFixInaccurate.java:260` — which
  reads less like a coincidence than like upstream's own mitigation for exactly
  this. It is also, note, the same tool whose port clears this file 3 → 0.
- **The sector reformulation alone fixes nothing.** `sector+atan2` gives
  `[1, 3, 1, 0, 2, 2]`, bit-identical to `bearing+atan2`. Sectors buy accuracy;
  the subtraction is the lever. Ship them together or not at all.

### The divergence, and how the oracle survives

The Oriedita operations oracle is **a hard gate in CI**, not a dormant one.
`.github/workflows/ci.yml:287-310` builds the Java oracle from the vendored
snapshot and sets `ORACLE_REQUIRED=…,ORIEDITA_OPERATIONS_ORACLE,…`, whose own
comment reads *"turns a missing variable into a failure instead of a silent
skip."* Landing this without an upstream-exact path reds `native-oracle` on the
first push.

Copy the precedent at `folding.rs:423-429`:

```rust
pub enum CamvAngleArithmetic {
    /// Sector angles from ray pairs; orientation-invariant.
    #[default]
    Refined,
    /// The upstream arithmetic reproduced verbatim, for oracle parity.
    OrieditaExact,
}
```

Threaded as a plain `Copy` parameter into `find_flat_foldability_violation`,
matched at the two leaf sites, with `check4(model)` and `check_camv_task(model)`
keeping their current signatures and defaulting to `Refined`. Add
`check4_with(model, arithmetic)`, and have the three oracle tests pass
`OrieditaExact` explicitly with an inline comment saying why. The double
statement — entry-point doc comment plus test comment — is what stopped the
shadow-geometry divergence from being lost.

`PORTING.md` entry follows the "Bounded lengthen extensions" shape
(`PORTING.md:166-183`), which is the closest precedent in kind: it also diverges
because upstream's numerics are ill-conditioned, and it also states the effective
tolerance drifting with a length.

## Measurements

All on `worked_but_has_errors.osf` (135 segments, 48 interior vertices) unless
noted, through the real `check4` on the real model, with the six bit-exact
transforms.

**Invariance.** `[identity, rot90, rot180, rot270, mirror-x, transpose]`, and the
count of sites stable across all six:

| variant | counts | union | stable |
| --- | --- | --- | --- |
| stock | `[3,3,2,3,2,5]` | 7 | **0** |
| `atan2` bearings | `[1,3,1,0,2,2]` | 4 | 0 |
| sectors | `[1,3,1,0,2,2]` | 4 | 0 |
| exact subtraction, `acos` | `[0,3,0,3,0,3]` | 3 | 0 |
| **exact + sectors** | `[0,0,0,0,0,0]` | 0 | — |
| **exact + `atan2`** | `[0,0,0,0,0,0]` | 0 | — |

**Detection is sharpened, not blunted.** A constructed genuine violation —
degree-4, sectors `(90+δ)/(90−δ)/90/90`, colours R/R/B/R so Maekawa passes —
flagged per transform:

| δ | stock | exact + sectors |
| --- | --- | --- |
| ≤ 5e-7 | clean 6/6 | clean 6/6 |
| **7e-7** | **flagged 3/6** | **flagged 6/6** |
| ≥ 1e-6 | flagged 6/6 | flagged 6/6 |

At δ=7e-7 the true alternating sum is 1.4e-6°, over the bar — stock misses it in
half the orientations. Coarse controls agree in every mode: `100/80/90/90` →
`Angles`; `90/90/90/90` → clean; degree-6 `61/59/60/60/60/60` → `Angles`.
Big-little-big is preserved: `20/100/160/80` same-colour-flanked → `BigLittleBig`
6/6 in both.

**Behaviour-preserving on the real corpus.** 56 local `.osf` files up to 15,950
segments, each through all six transforms in each mode. The fixed checker differs
from stock on **exactly one file** — the one where stock is provably reporting
false positives — and stock is non-invariant on exactly that same file. Spot
checks unchanged: `layout_could_not_by_drawn.osf` 13,292 segs `[422 ×6]`,
`perf_test.osf` 15,950 segs `[389 ×6]`, `Moon-Jaewoong-Tortoise.osf` `[93 ×6]`,
`crane.osf` `[19 ×6]`.

**Suites green in every variant.** `oristudio-cp` 996 passed;
`check_diagnostics` + `checks_spatial` + `oriedita_operations_oracle` 99 passed;
`oristudio-cp-compiler` 147 passed.

**Confluence.** A faithful transcription of `Check4.findFlatfoldabilityViolationInside`
run over every cyclic start: 1,846,832 vertices exhaustively over degree 4/6/8 on
the 22.5° lattice with every M/V assignment, plus 200,000 randomized tie-rich
vertices — **zero** divergent verdicts. The first crimp *site* differed across
orientations on 6.9% of tie-rich vertices while the verdict differed on none.

**Cost.** No regression; summed single-shot `check4` over the corpus 59.63 ms
stock vs 44.15 ms sectors. Read as "no regression", not as a speedup — single
shot, not repeated runs.

## Affected Areas

- `crates/oristudio-cp/src/checks.rs` — the sector computation feeding
  `SortingBox` (`:313`, `:315`), the subtraction at `:946`, the
  `CamvAngleArithmetic` parameter, and `check4_with`.
- `crates/oristudio-cp/src/checks.rs:1371` — the Check3 twin of the same
  subtraction, inside `extended_fushimi_decide_inside`. Same defect, its own
  oracle test (`check3_matches_oriedita_foldlineset_oracle`). See Non-goals.
- `crates/oristudio-cp/tests/oriedita_operations_oracle.rs` — three tests pass
  `OrieditaExact`.
- `PORTING.md` — a new entry under Oriedita's "Deliberate divergences".
- `crates/oristudio-cp/src/lib.rs` — the `Check4` operation descriptor's
  `OracleTested` claim stays true via the Exact variant; check the doc comment
  still reads correctly.

Not touched: `orita_calc::angle`, `Epsilon::FLAT` and every constant beside it,
`checks_spatial`, the algorithm's control flow, and the eight other Kawasaki
residual implementations across the workspace.

## Checklist

- [ ] Build the Oriedita oracle locally (`tools/oriedita-oracle/build_geometry_oracle.sh`)
      and confirm `check4_matches_oriedita_foldlineset_oracle` actually runs
      rather than silently skipping. **Do this first** — every parity claim below
      is unverified against Java until it does.
- [ ] `CamvAngleArithmetic` enum + `check4_with`, defaulting to `Refined`, with
      `check4`/`check_camv_task` signatures unchanged.
- [ ] Sector angles from ray pairs under `Refined`; upstream bearings under
      `OrieditaExact`.
- [ ] `max_angle -= 2.0 * temp_angle` under `Refined`; `2.0 * min_angle` under
      `OrieditaExact`.
- [ ] Three oracle tests pass `OrieditaExact` with an inline comment each.
- [ ] Test: six-transform invariance on `worked_but_has_errors.osf`, asserting 0
      in every orientation.
- [ ] Test: the δ=7e-7 sensitivity case asserting `Angles` in all six
      orientations. **This is the one that fails on today's code (3/6)** — it is
      the regression test that would have caught this.
- [ ] Test: `20/100/160/80` same-colour-flanked `BigLittleBig` in all six
      orientations.
- [ ] Decide Check3 (`:1371`) — fix or document. Leaving it is two
      implementations of one condition that disagree.
- [ ] `PORTING.md` entry in the "Bounded lengthen extensions" shape.
- [ ] `cargo test --workspace`, plus `native-oracle`'s Oriedita step locally.

## Risks and mitigations

- **The Java oracle has not run against this.** No jar exists in this worktree
  and `ORIEDITA_OPERATIONS_ORACLE` was unset, so the parity test silently
  returned. Every parity claim rests on four committed fixtures plus 996 passing
  tests, **none of which discriminate between the variants** — all five agree on
  every fixture. Build the oracle before landing; it is the first checklist item
  for that reason.
- **The tie window is not closed, only made harmless for `Angles`.**
  `|temp_angle − min_angle| < Epsilon::FLAT` still admits several candidate
  minimal pairs, so *which* pair collapses stays orientation-dependent. Exact
  subtraction makes the `Angles` residual path-independent; it does **not** make
  the `BigLittleBig` marker set path-independent — 37% of LBL verdicts vary with
  rotation in the transcription study, and `stock+atan2` produced a spurious
  `BigLittleBig` at rot90 from exactly this. It did not recur under the fixed
  version anywhere in the corpus, but nothing rules it out.
- **Only bit-exact transforms were tested.** Nothing here says anything about
  invariance under an arbitrary rotation, which is what a user actually does when
  they rotate a pattern. That case additionally perturbs coordinates off-lattice,
  so it is a different measurement.
- **The corpus is 56 local files from one machine**, not the external harness, and
  only one exercises the near-lattice regime where any of this matters. The
  invariance claim on that file is partly degenerate — 0 in every orientation is
  trivially invariant. The non-degenerate evidence is the δ=7e-7 case, which is
  synthetic.
- **`fold_exactize.rs:44` asserts `camv_violations_before > 0`.** It is safe by
  three orders of magnitude — TreeMaker CPs miss Kawasaki by ~1e-3°, not ~1e-6° —
  but it is the assertion whose direction this change works against, so it is
  worth watching rather than assuming.

## Non-goals

- **Changing the bar.** `Epsilon::FLAT` stays 1e-6°, undivided. A distance-valued
  residual ("how far must this vertex move to close") is scale-consistent where an
  angular bar is not, and was prototyped — but it is a *different predicate*, the
  oracle cannot gate it, and it solves a problem this plan removes.
- **Changing `orita_calc::angle`.** Nineteen call sites outside CAMV, one test
  pinning the primitive, and the measured gain over sectors is zero.
- **Converging the nine Kawasaki residual implementations.** They exist across
  `oristudio-cp`, `oristudio-cp-compiler` and `oristudio-cp-detect` in four
  styles, and `dispatched_camv` today orders one vertex's fan by `acos` and its
  neighbour's by `atan2` (`checks_spatial.rs:692`). Real, and separate.
- **Making detection land on the lattice.** Complementary and independently
  worthwhile — an exact pattern passes any of these variants — but it does not
  make the check invariant, which is what this plan is for.
