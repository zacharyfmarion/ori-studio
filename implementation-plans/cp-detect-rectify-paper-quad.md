# CP-detect: the paper quad on real images

## Goal

Stop the auto-rectification from handing the detector a paper frame with one
edge pushed out by 3–7%. Nine of the curated group's 25 decoder-`off` real
images are this, not detection failures: their recognised graph aligns with
the truth at 0.88–1.00 vertex recall under a homography whose shape is the
unit square with one edge moved 26–71 px (crocodile left, water-boatmen top,
turkey-vulture bottom, common-wildebeest right, roadrunner and
helmeted-hornbill top, swift-dragon top and bottom), or a uniform 16–21 px
margin for the two `full_frame_resize` cases (ubu, u-waluigi001). A one-sided
stretch of 4% distorts every angle, so the solve is refused or lands wrong
on a graph that is right. Lever 2 of
`research/2026-09-07-cp-detect-curated-funnel-bottleneck.md`.

## Approach

1. **Diagnose from the finder's own candidates.** `dump_candidate_pool` now
   writes the full `RectificationReport` per case (`<case>.rectify.json`):
   mode, the chosen quad, and every ranked panel candidate with its scores.
   For each of the nine, fit the homography from the recognised graph to the
   truth, map the paper corners through it, and read the true paper's edges
   in source pixels beside the chosen quad's and the losing candidates'.
   That says whether the true square was a candidate that lost (a scoring
   or selection rule), was never proposed (the projection clusters), or is
   not a bordered square at all (a margin the finder cannot see).
2. **Fix the rule the evidence names**, in `rectify.rs`, with a unit test
   per mechanism on a synthetic image, and keep the rendered group's frames
   exact (their paper sits at 32..992 with a drawn border).
3. **Validate** on the nine (decoder bucket and the solve), then the full
   `curated_benchmark` with `--compare`, scored strictly; no regression on
   the rendered group's rectification accepted.

## Affected Areas

- `crates/oristudio-cp-detect/src/rectify.rs` — panel candidates, scoring,
  `choose_panel`, the full-frame decision.
- `crates/oristudio-cp-detect/examples/dump_candidate_pool.rs` — the
  rectification report output.
- `tests/corpus/cp-detect-curated-baseline.json`, `tests/corpus/README.md`.

## What the diagnosis found (2026-09-08)

The finder's ranked candidates, per case, against the true paper from the
homography fit:

| case | image | true paper | ranked first | chosen | why |
| --- | --- | --- | --- | --- | --- |
| crocodile | 1026×1068 | x 69–985, y 125–1040 | the true paper, 0.986 | x 37–985 (0.968, square 0.94) | largest square ≥ 0.9 |
| water-boatmen | 1024×1078 | y 131–1046 | the true paper, 0.992 | y 87–1046 (square 0.92, top side 0.87) | same |
| turkey-vulture | 1010×1098 | y 143–1058 | the true paper, 0.977 | y 143–1087 (square 0.95) | same |
| common-wildebeest | 1480×1420 | x 45–1388 | the true paper, 0.985 | x 45–1424 (square 0.956) | same |
| roadrunner | 994×1078 | y 145–1058 | the true paper, 0.984 | y 101–1058 (square 0.92) | same |
| helmeted-hornbill | 1004×1082 | y 153–1063 | the true paper, 0.994 | y 106–1063 (square 0.92) | same |
| swift-dragon | 1018×1090 | y 151–1066 | the true paper, 0.986 | y 86–1011 (square 0.987, sides 0.51 / 0.63) | a same-size square shifted onto the title and a crease row |
| u-waluigi001 | 1566×1558 | 23–1542 | the true paper, 0.988 | the whole frame | `is_full_frame_panel` tolerance 2.5% (39 px) ate a 23 px inset |
| ubu | 1250×1250 | x 20–1219, y 25–1224 | the frame alone | the whole frame | `frame_candidate` fired on mean border support 0.25 from one dark edge (sides 0.01 / 1.0 / 0.01 / 0.0) |

In every warp case the true paper was the finder's first choice and lost to
`choose_panel`'s "largest bordered square with `square_score ≥ 0.9`": that
gate admits 6% off square, and a title, a legend, an aux line off the paper
or a page rule gives a box one edge wider that is bordered on every side.
Three rules changed:

- `choose_panel` keeps the largest bordered box (`square_score ≥ 0.9`)
  unless a *genuine* square (`≥ 0.985`, within a percent) fills at least
  85% of it — then the box is the paper plus one extension and the square is
  the paper. A square drawn well inside the box leaves the box in place (the
  turtle's shell, on a scan a little off square). Two genuine squares within
  2% in area are one paper seen twice, the second shifted onto a title or a
  crease row (swift-dragon's is 1.1% larger, water-boatmen's 0.4%); the one
  with the better-supported weakest side wins, from `border_sides`, now in
  every candidate's metrics.
- `frame_candidate` needs every side of the frame at least half on an edge,
  not a mean of 0.24.
- `is_full_frame_panel`'s tolerance is 0.5% (at least 3 px), not 2.5%.

Two earlier forms of the first rule failed on the renders, which is what the
rendered group is for. A gate on every side's border support (≥ 0.9) cost
two renders whose paper border is crossed by creases every few pixels and
reads 0.74–0.84 on that side (bat by bodo haag, lobster by jesse barr), so
the clean square inside them won. A 5% same-size band broken by confidence
cost nine: dense box-pleated renders have a full-support square anchored at
the paper's corner one or two grid cells inside its far edges (batmobile
48–957 against the paper's 48–976), 4% smaller and a shade more confident.
The final rule leaves every render on its 48–976 frame.

Re-run with the fix, all nine real cases take `detect_quad_warp` onto the
true paper; the two curated cases that used `full_frame_resize` without a
truth (matt-laboone-beetle, t-dex-mirablis) now warp onto a bordered square
inset 19 and 14 px. The first full run had the curated group's decoder mean
edge F1 go 0.818 → 0.943 and the nine cases' F1 from 0.01–0.24 to
0.82–1.00: common-wildebeest `exact` and recovered, roadrunner and ubu
recovered, turkey-vulture `near`, the rest `off` on ordinary detection
defects now that the frame is right.

## Checklist

- [x] Diagnosis on the nine cases: which candidate held the true paper and
      why the chosen one won
- [x] Fix in `rectify.rs` with unit tests
- [x] The nine cases re-run; full curated benchmark against the contact
      run: curated decoder exact 15 → 16, mean edge F1 0.818 → 0.943,
      recovered 18 → 21, strict convergence 16 → 18 (common-wildebeest,
      ubu); the rendered group unchanged (298 exact, 288 strict); no case
      lost. Scorecard and README updated
