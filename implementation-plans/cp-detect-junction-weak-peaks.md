# CP-detect: junctions from weak peaks

## Goal

Recover the junctions the decoder misses at short crossing creases without
the regression tail the August junction re-tune carried. After the
boundary-contact and paper-quad levers, 136 rendered cases are still `near`
at the decoder; 70 of them miss a junction (181 in all), and 126 of those
junctions sit on a crease the decoder already draws through the point. The
junction head fires there, below the 0.40 peak floor.

## Approach

Measured first on the 137 current near cases with `dump_candidate_pool`
and the strict metric (2026-09-09):

| change | near → exact | cases better / worse |
| --- | --- | --- |
| contact threshold 0.50 → 0.30 | 3 | 32 / 6 |
| junction peak floor 0.40 → 0.25 | 28 | 43 / 28 |
| vertex merge radius 3 → 5 px | 1 | 7 / 26 |
| floor 0.25 and merge 5 px (the August re-tune) | 31 | 51 / 26 |

The gain is the floor; the merge radius is the harmful half (it merges real
close pairs, missing edges 1,499 → 1,666). The floor's own tail is spurious
junctions: on the regressions, the new selected spans hang on peaks of
support 0.26–0.32 sitting 3.6–6.6 px from a real junction the decoder
already has at 0.8–0.95 — the same junction firing twice, the second time
beyond the 3 px vertex merge radius, and the spans between the pair are
3–6 px stubs.

1. **Admit peaks down to 0.25**, and give a peak under the old floor a wider
   merge radius (`weak_junction_merge_radius_px`): strongest first, a weak
   peak within that radius of a vertex already placed is absorbed. Strong
   peaks keep the 3 px radius, so close pairs of real junctions survive.
2. **Sweep the weak radius** (6, 8, 10 px) at the decoder stage against the
   floor alone and against today's decoder: conversions kept, regressions
   removed.
3. **Full curated benchmark** with the harness's strict `recovered`, scored
   strictly, flips explained; before/after crops of what improved and what
   got worse.

### The sweeps (2026-09-09, 137 near cases, decoder stage)

| configuration (floor 0.25 throughout) | near → exact | better / worse | missing | extra |
| --- | --- | --- | --- | --- |
| floor alone | 28 | 43 / 28 | 1,402 | 911 |
| weak merge 6 px | 30 | 47 / 7 | 1,323 | 745 |
| weak merge 8 px | 30 | 42 / 5 | 1,342 | 737 |
| weak merge 10 px | 30 | 42 / 4 | 1,339 | 737 |
| weak merge 8 + border exclusion 6 px, every peak | 31 | 44 / 17 | 1,397 | 696 |
| weak merge 8 + border exclusion 8 px, every peak | 31 | 42 / 23 | 1,482 | 704 |
| **weak merge 8 + border exclusion 6 px, peaks under 0.50** | **29** | **41 / 4** | **1,312** | **688** |

The weak merge removes 21 of the floor's 28 regressions at the cost of two
conversions whose missed junction is a real close pair with a weak member
(fox-girl, rhino-beetle: a 0.27–0.35 peak 3.3–4.4 px from a 0.76–0.95 one,
both real). The one blow-up left, cat-in-grass (14 → 82 defects), was three
peaks at 0.26–0.45 sitting 3 px inside the bottom edge — creases meeting
the border, which the contact head owns, that the lower vote threshold had
pulled just past the 3 px border skip. A border exclusion for every peak
costs 17 regressions: 22 real junctions in these cases sit within 6 px of
the edge, every one of them firing at 0.49 or more, while the border
firings sit at 0.26–0.50. So the exclusion applies to peaks under 0.50, and
takes one conversion back (horse-1-1, inari-statue's junction at 0.4x near
the edge) for the blow-up.

## Affected Areas

- `crates/oristudio-cp-detect/src/evidence_extract.rs` — the peak floor.
- `crates/oristudio-cp-detect/src/candidate_generation/junction_carrier_v1.rs`
  — `build_vertices`, the weak merge.
- `crates/oristudio-cp-detect/src/candidate_generation/mod.rs` — the option.
- `crates/oristudio-cp-detect/examples/dump_candidate_pool.rs` — `WEAK_MERGE_PX`.
- `tests/corpus/cp-detect-curated-baseline.json`, `tests/corpus/README.md`.

## Checklist

- [x] Sweeps that separate the floor from the merge radius
- [x] Regression mechanism read from the dumps (a junction firing twice)
- [x] Weak-peak merge radius and weak-peak border exclusion implemented,
      unit-tested, swept (table above)
- [x] Product defaults set (floor 0.25, weak merge 8 px, border 6 px under
      0.50); the crate's tests (110) and clippy pass
- [x] Full curated benchmark against the strict scorecard, run alone:
      decoder exact 314 → 346 (none the other way), strict `recovered`
      306 → 332 (29 gained, 3 lost: pegasus's caption text, two solver flips
      on an unchanged graph); no time cost (compiler 396 → 321 s and exact
      solve 63 → 57 s on sixteen cases run one at a time); scorecard and
      README updated
- [x] Before/after crops of the cases that changed (decoder stage, one site
      per case; ten conversions and the four regressions)
