# ReferenceFinder: score each basis line once, with its paper clip precomputed

## Goal

A ReferenceFinder line query costs ~63 ms at rank 6 (this machine, worker,
`worstCase: 1`), and the precrease planner asks about every remaining line of a
component in one batch, twice. On a fully off-lattice pattern (glaucus, 332
lines) that is 54 s of the run's 30 s budget before the first approximation is
even folded. The cost is not the scan — a point query over the same 600k-entry
database takes 5 ms — it is what happens per element: `FindBestLines` runs
`partial_sort_copy` over every basis line with `CompareRankAndError`, whose
`operator()` calls `DistanceTo(target)` on **both** operands of **every**
comparison, and with `worstCase: 1` each `DistanceTo` clips both lines to the
paper (`ClipLine`: four edge intersections, enclosure tests, a
parameterisation) before taking four endpoint distances — re-clipping the
constant target every time, through 600k heap objects, with nothing cached.

Make the line query cost what the point query costs, with **bit-identical
answers**, and carry the change as a documented local patch to the vendored
core rather than upstreaming it: upstream's app shows one solution per query and
does not feel this.

## Approach

Three changes inside the search, none of which alters a result:

1. **Clip each basis line once per database.** The paper never changes after
   the build, so the endpoints where a line leaves it are a property of the
   database. A side table parallel to `sBasisLines` (built lazily on the first
   query, rebuilt if the container's size changes) holds them; the `RefLine`
   layout, the binary database format and the IndexedDB cache are untouched.
2. **Clip the target once per query**, not per comparison.
3. **Score every reference once per query** into a scratch array and run the
   same `partial_sort_copy`, over the same sequence, with a comparator that
   reads the cached distance and a cached `GetRank()` (which upstream computes
   recursively on demand) but applies the identical rank-within-good-enough
   rule. Marks get the same score-once treatment through one shared template.

The worst-case distance arithmetic is extracted into one static helper that
both `RefLine::DistanceTo` (still used to print `err`) and the cached scoring
call, so there is a single expression to be identical to. wasm has no fused
multiply-add, so the same expression yields the same doubles.

The oracle (`tools/reference-finder-oracle`) already compares full solution
lists between our build and upstream's committed artifact; it grows a list of
search settings (`worstCase` 0 and 1, `count` 1 and 5, both `goodEnoughError`
values the app uses), many more line targets — off-lattice ones like glaucus's,
near-parallel-to-an-edge ones, one through a corner — and a per-module timing
line, so the same run that proves identity measures the speedup.

Documentation of the exception: `third_party/reference-finder/README.treemaker.md`
("Local changes"), `upstream-sync.json` (a `local_patches` note the
`upstream-drift` skill reads before re-vendoring), `LICENSING.md`
(the shipped GPL binary is now built from modified source, which the repo
carries), and AGENTS.md's vendored-source rule names the exception.

## Affected Areas

- `third_party/reference-finder/src/core/ReferenceFinder.cpp` — the two
  `FindBest*` functions and the caches.
- `third_party/reference-finder/src/core/class/refLine/refLine.{h,cpp}` — the
  worst-case distance helper.
- `tools/reference-finder-oracle/{equiv.mjs,queries.json,README.md}`.
- `third_party/reference-finder/README.treemaker.md`, `upstream-sync.json`,
  `LICENSING.md`, `AGENTS.md`,
  `.agents/skills/upstream-drift/references/reference-finder.md`.

## Checklist

- [x] Worst-case distance helper on `RefLine`; `DistanceTo` calls it.
- [x] Per-database line clips and ranks, per-query scores; `FindBestLines` and
      `FindBestMarks` score once and partial-sort by cached score.
- [x] Oracle: multiple search settings, more line targets, timing per module;
      run against upstream's artifact — identical (140 queries, 476 solutions).
- [x] Measured in the browser worker: exact-client line query 65 → 5 ms,
      approximate-client 62 → 3 ms; glaucus's whole-pattern RF phase 54 s → 5.8 s
      (the run then reaches 25 folds / 9 CP lines in its 30 s instead of 6 / 1).
- [x] Patch documented in README.treemaker.md, upstream-sync.json,
      LICENSING.md, AGENTS.md, the upstream-drift reference, the build script.

## Done alongside, in the same PR

- The sequence run has **no time ceiling** any more (`totalBudgetMs` 0): it
  lasts as long as the pattern needs and Stop is the way out. Stop had never
  reached a plan run — `requestReferencesStop` killed the Find tab's window
  worker, which the plan does not use, so "Cancelling…" held until the plan
  ended by itself; each run now registers its own stop (`beginReferencesRun`).
- The strip's last card is worded by the run's stop reason (`planEndingCard`):
  finished, stopped at your request, incomplete, the point cap, out of time.
- The progress counter derives from what is left rather than from the
  closure's own folds, so a run advancing through the search reads as one.

- **The search stops deepening once an approximation is on the paper**
  (`Planner::stuck_search`). With the ceiling gone, a 332-line off-lattice
  pattern still took ~4 s per line: every search after the first
  approximation ran to its cap. Per-event summaries showed why — the depth-1
  sweep of the root set (≤ 400 candidates) exhausts in 0.15–1 s and unlocks a
  target, then the search deepens into pairs looking for a set that
  *completes* the closure, which cannot exist once the pattern has needed an
  approximation, and is cut at 4 s on 16 of 18 events. The deepened search
  returns the same target. So in that regime the planner searches depth 1
  whatever depth the driver asks for, and does not promote a small root set
  to depth 3. Gated on the planner's own approximation count, so a pattern
  that never approximates — every exact and snappable design — is untouched.

  Measured on glaucus (patched RF, shared query cache, error cap 1e-2), the
  alternatives, each run to completion:

  | after the first approximation | time | hubs approximated directly | hub err max | hubs a typical line depends on p50 / max |
  | --- | --- | --- | --- | --- |
  | status quo (depth 2→3, 4 s cap) | 65 lines in 187 s ≈ 15–20 min | 1 | 8e-5 | 1 / 1 |
  | never search, approximate the next-best line | 24 s | 44 | 5.4e-3 | 24 / 43 |
  | depth 1, 300 ms, else approximate at once | 84 s, 1 line unsolved | 24 | 5.4e-3 | 8 / 24 |
  | depth 1, 300 ms, else the rules | 63 s | 18 | 5.4e-3 | 9 / 17 |
  | depth 1, 1 s, else the rules | 100 s | 13 | 5.4e-3 | 8 / 13 |
  | **depth 1, 4 s cap, else the rules** (this) | **125 s** | **2** | **1.0e-4** | **2 / 2** |

  A shorter cap is not the lever: every search it cuts short spends the
  next-best approximation, and those get worse as they go. Skipping the
  exact-ReferenceFinder ask after a failed search lost a line.

  Corpus (browser driver, no ceiling, the 42 curated and every 8th `cpoogle`
  design's `truth.fold`): 102 of 102 plannable designs complete, median 2.5 s,
  slowest 91 s (earwig, 21 exact-regime searches); two designs approximated
  one line each. The truths are exactly constructible almost without
  exception, so the regime is exercised by hand-drawn and detector-output
  patterns rather than by curated truths — see the PR for the
  `detected.fold` pass.

- **The plan stops rather than approximate more lines than a sequence can
  carry** (`PlanAction::Stop { TooManyApproximations }`). D made glaucus
  finish, in 125 s, as a 648-card plan with 316 reference creases — complete
  and unusable, and the reader waited minutes to learn so. The rule is in
  `drive.rs`, at the two places the plan would approximate: if the closure's
  remaining lines exceed `PlannerOptions::approximate_lines_cap` (24, or a
  tenth of the pattern's lines when that is larger; 0 disables it), the plan
  stops with the sequence it has — every exact avenue is exhausted before
  the first approximation, so nothing exact is lost. The cap does not count
  lines that go exact *after* an approximation, only what is left when the
  next one is asked for, so a design that needs one or two hubs and then
  folds the rest exactly still gets its plan. On that stop the driver skips
  the closest-construction pass over the findings (it is minutes on
  hundreds of lines, describing folds the plan will not make).

  Surfaces: the warning modal opens with "Planning failed …" wording
  (`useReferencesApproximationWarning` → `reason: 'too_many'`), and the
  strip's ending card says how many creases were made and why it stopped.
  The findings rail lists nothing for such a sheet — its findings were never
  searched for a closest construction, and the modal has already said why.
  A plan with no folds at all now still ends on its ending card
  (`referencesViewSteps`), and the plan strip's empty copy no longer borrows
  Find's. Analytics: `references approximation warning shown` gains
  `reason`, `folding steps refused` gains `too_many_approximations`, both on
  the References dashboard.

  Glaucus in the browser: stops in 5.8 s (closure, one stuck search, the
  exact ReferenceFinder batch), 0 of 332 creases, modal up.

## Out of scope

- The approximate fallback ends the whole plan when its three best candidates
  fail to fold (hex-tiger's topology: 1 of 193); it should try further
  candidates, or leave that line as a finding and go on.
- The presentation pass on detector-scale sequences: uninterruptible, and
  minutes at 2,000 cards.
- A way to continue a stopped run rather than recompute from the start.
- A numeric error bound propagated through steps sighted from approximations.
- Landmarks first for off-lattice designs: a plan of several hundred cards
  whose construction chains run 30–200 deep is complete, not usable; a folder
  locates the vertices and connects them.
