# CP-detect: the box-pleat grid as a prior

## Goal

Convert the giant box-pleated designs, which are where the remaining
rendered losses concentrate and what complex-model folders bring. Of the
65 box-pleated renders in the curated benchmark, 31 have 1,000 creases or
more; 3 of those 31 are recovered, 16 are over the harness's edge cap and
23 are `near` at the decoder. Their losses are one class: 1,131 missing
creases over 49,078 (2.3%), 719 of them border-reaching — the grid line's
last cell, from the first interior grid line to the paper edge, where the
contact head fires weakly.

## What the evidence says (2026-09-09)

- **Box pleating is detectable at runtime.** The recognised graph's crease
  angles (≥ 95% at multiples of 45°) find the family with precision 0.88
  and recall 0.94 against the truth's; the grid N from the recognised
  vertices is exact in 53 of 61 detected cases, a multiple or divisor in 4;
  the ink alone gives it too (autocorrelation of the line map's row and
  column sums: 10 of 11 within one of the truth grid or a factor of two).
- **The lost border creases are seen, not missed.** On the box-pleat near
  cases, the line support along a lost border crease is 0.88 in median,
  the same as along a found one, and 100% of both are above 0.5. What
  differs is the contact head: peak 0.28 in median at the lost ones (60%
  over 0.25, 84% over 0.10, 1% over the 0.50 floor) against 0.89 at the
  found ones. 93% of the lost ones sit on a grid line.
- So a box-pleat design licenses a contact at every grid position on each
  side, admitted on weak head evidence (0.10) when the ink along the first
  cell inward says a crease is there (line support ≥ 0.5). Off the grid,
  nothing changes; on other families, nothing changes. The threshold sweep
  that lowered every contact to 0.30 gained three cases and broke two
  real-image solves with spurious near-corner contacts; the grid makes the
  same admission safe by restricting where it applies.

## Approach

1. **Detect the family and the grid** from the candidate graph after span
   proposal, as a `GridPrior` (`candidate_generation/grid_prior.rs`):
   - family: the fraction of proposed spans at least 12 px long that pass
     the line gate whose direction is within 5° of a multiple of 45°, at
     least 0.85 (hybrids with a few 22.5° creases pass; the completion's own
     gates never admit an off-grid crease);
   - grid: the coarsest size 4..200 whose chance-corrected fit of the
     interior junctions (1 px band) is within 0.02 of the best, at least 0.85
     — the raw fit is meaningless on fine grids, where a 1 px band either
     side of every line covers most of the edge by chance;
   - hold on the border: the same score for the contacts the head found,
     at least 0.8 (a 1.5 px band; the head's along-edge bias).
2. **Complete the border on the grid**: at every grid position on each side
   with no candidate vertex within max(cell/3, 3 px), for each of the three
   ways a crease leaves the edge on a grid (the grid line, either diagonal):
   the line evidence along the first cell must average 0.5, must be a
   **ridge** (0.15 above the same reading 3 px to either side along the
   edge — the solid ink of a dense pleat region is not), must reach a
   candidate vertex within 3 px of the ray between half a cell and four
   cells in, and the span to it must pass the adjacency gate. The contact
   head's peak is recorded but not required: a floor of 0.05 gave up a third
   of the true completions for nothing.
3. **Sweep on the box-pleat renders** (`dump_candidate_pool`, strict
   metric), then the full curated benchmark; no regression off the grid
   accepted.
4. Later, the same prior for compute: grid-snapped vertices and a
   grid-structured solve for the giants the compiler spends minutes on.

## What the prototype sweep found (2026-09-09, Python on the dumped pools)

- The pool's vertex coordinates are in 1024-px units of the unit square, not
  model pixels; the first grid fit measured noise.
- The raw grid fit picks a size near the top of the range on every design
  (a 2.5 px band at N = 160 catches 80% of random positions). The
  chance-corrected score with a 1 px band finds the truth's grid or a
  divisor of it on 48 of 52 cases; the divisors cost positions, never
  safety.
- The family vote fails on the densest giants (hydra 0.52, honeybee 0.62:
  cells of 3–4 px, the short-span bypass proposes every neighbour pair at
  every angle) — those are out of reach at 1024 px anyway.
- Without the ridge test, 29 spurious contacts on dwarf, basilisk-1-2 and
  mantis-shrimp (128-grids, 7.5 px cells: the line map is solid between
  strokes, the perpendicular stub reads 0.6–0.7 anywhere). Every one reads
  a ridge of 0.03 or less; the true completions 0.31 at p10, 0.49 median.
- The `pool/` dumps predate the contact re-localisation; on them droideka's
  contacts sat 1.6 px off the truth and a grid snap of existing contacts
  looked worth 42 fixes. Re-dumped, its contacts are within 0.4 px: the
  snap is not needed.

## What the Rust port added to the prototype

- The prior runs after the contact re-localisation, not before: the
  contacts' grid score read from the head's raw positions is far lower
  (almond 0.53 against 1.0 after), and a completed contact sits on its
  grid position, which on a render is the ink's.
- The chance-corrected grid score with a 1 px band; the contact floor at
  0.5 (0.8 excluded four giants whose crowded ink the re-localisation
  declines to read); the contact head's peak recorded but not required;
  the ridge at 0.15.
- The `pool/` dumps from the earliest sweeps predate the re-localisation;
  the A/B was re-dumped both ways at this commit (`GRID_PRIOR=0` in
  `dump_candidate_pool`).

## Affected Areas

- `crates/oristudio-cp-detect/src/candidate_generation/junction_first_v1.rs`
  — where the completion runs, after contact re-localisation.
- A new `candidate_generation/grid_prior.rs` — family and grid detection,
  border completion.
- `crates/oristudio-cp-detect/examples/dump_candidate_pool.rs` — sweep hooks.
- `tests/corpus/cp-detect-curated-baseline.json`, `tests/corpus/README.md`.

## Checklist

- [x] Family and grid classifier on the truth (65 box-pleat renders, grid
      found for all) and on the recognised graph (precision 0.88, recall 0.94)
- [x] Lost border creases measured against the ink and the contact head
- [x] Giants' dump: the same measurement on the 31 giants (the prototype
      sweep above ran on them)
- [x] `GridPrior` detection and border completion, unit-tested
- [x] Rust port swept on the box-pleat cases (A/B on the candidate pools,
      strict metric): 68 cases (tokyo-skytree is over the cap), 60 with a
      prior, 443 contacts completed and every one within 2 px of a truth
      contact; 8 cases near → exact, 0 lost, 24 with fewer defects, 0 with
      more; missing creases 7,391 → 6,305
- [x] Full curated benchmark (`2026-09-09-bp-grid-prior`): decoder exact
      346 → 356, strict `recovered` 332 → 337, nothing the other way;
      scorecard and README updated; before/after crops in the PR
- [ ] Later: the compute lever for the four exact decodes over the solve's
      crease cap, and the solver's first-stage rejection on wizard (an exact
      graph with an 8.6° Kawasaki error in its start)
