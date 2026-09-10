# CP-detect: papers that are not axis-aligned

## Goal

Let the auto-crop find a square paper that is **rotated** in the source image —
a crease pattern drawn as a diamond, or a photograph taken a few degrees off
square. Today `projection_candidates` builds quads only from vertical and
horizontal projection peaks, so a rotated paper's edges project onto nothing
and the finder falls back to whatever interior grid lines happen to be
axis-aligned.

The case that prompted this (`real/ikuno_origami/blackbuck-simplified`, a 45°
diamond beside a folded-model render) crops to a 75×112 box in the middle of
the CP — 1.7% of the image, `square_score` 0.32 — and the whole detection is
lost from there.

Rotation of a few degrees matters as much as 45°: a photographed CP is never
quite square, and `border_support_sides` samples with a radius of 2 px, so a
500 px side that is 1° off loses its support entirely.

## Approach

Two stages, so the cost stays near today's. The full quad search is
`O(clusters⁴)` scored quads; running it at every angle is not affordable, and
a 1-D projection per angle is.

1. **Find the angles worth searching.** Collect the edge pixels once, then
   sweep θ over (−45°, 45°] projecting those points onto `u(θ)` and `v(θ)`.
   A straight paper edge of length L lands its whole length in one bucket at
   the right angle and smears over `L·sin δ` buckets when δ off, so the peak
   height is a very sharp indicator. Score an angle by its two strongest
   well-separated peaks on each axis, take θ = 0 plus the best few distinct
   local maxima, and refine each of those to a quarter of a degree.
2. **Run the existing search at each chosen angle.** Generalize
   `axis_scores` to a projection onto an arbitrary axis (θ = 0 reproduces the
   per-column counts exactly) and `projection_candidates` to build the quad
   from the `u`/`v` cluster pairs. Everything downstream — `score_quad`,
   `border_support_sides`, `coverage_score`, `choose_panel`,
   `warp_source_quad`'s homography — is already quad-general and needs no
   change.
3. **Make `interior_edge_density` respect the quad.** It measures the
   axis-aligned bounding box today, which for a diamond is half outside the
   paper and, in the blackbuck case, contains the folded-model render. Inset
   in the quad's own parameter space and test membership; for an axis-aligned
   quad this is pixel-identical to the current loop, so no existing pick moves
   because of it.
4. **Keep the corner order a rotation, never a mirror.** Over the swept range
   the `u`/`v` corners already run clockwise from the panel's most top-left
   corner exactly as `Quad::frame` does, so this is an invariant to assert
   rather than code to write.
5. **Hold the axis-aligned corpus still.** Rotated candidates enter the same
   pool as everything else, which triples the exposure to a spurious "square"
   built from two unrelated creases. Diff the chosen quad over all 648 real
   images before and after; every change must be a genuinely rotated paper.

## Affected Areas

- `crates/oristudio-cp-detect/src/rectify.rs` — the projection axis, the
  angle sweep, `projection_candidates`, `interior_edge_density`, corner order.
- `crates/oristudio-cp-detect/examples/panel_candidates.rs` — print four
  corners and the angle; two opposite corners cannot describe a rotated quad.
- No web change: `CpDetectCropEditor` already edits a free four-corner quad,
  and `warp_source_quad` already warps one.

## Checklist

- [x] Baseline the chosen quad over the 648-image real corpus
- [x] Confirm the failure on `blackbuck-simplified` and its cause
- [x] Projection onto an arbitrary axis, identical to `axis_scores` at θ = 0
- [x] Angle sweep with refinement, and its unit tests
- [x] `projection_candidates` at a given angle; rotated quads in the pool
- [x] `interior_edge_density` inside the quad, identity when axis-aligned
- [x] Corner order asserted to keep `Quad::frame`'s winding
- [x] Two rules for rotated panels, from the corpus (below)
- [x] Unit tests: a 45° diamond, an 8° tilt, a diamond beside a distractor,
      a diamond creased inside an upright paper
- [x] Corpus diff: no axis-aligned pick moves; rotated papers now found
- [x] `cargo fmt` / `clippy` / `cargo test --workspace`
- [x] Rebuild the detect wasm bridge and check the browser crop step

## What the corpus said (2026-09-09)

Baselining the chosen quad over all 648 real images and re-running it after
each step. The first working version found the paper on **45** images that
had been cropped wrongly or not at all — and 40 of those were right on sight,
while 5 were rotated squares that beat a better upright reading. Both rules
below come from that split; neither metric separates it alone.

**A rotated panel must look like a paper, not merely like a square**
(`rotated_panel_is_credible`). Rotation offers ninety times the squares, so
the floor is on the two things a paper does:

| | ink share | weakest side |
| --- | --- | --- |
| `carnotaurus-v1`, `at-at` | 0.13, 0.18 | — |
| `two-headed-dragon-v2` | 0.32 | — |
| `calico-cat` | — | 0.15 |
| weakest true rotated paper | 0.44 (`dpa-sword-and-shield`) | 0.23 (`swallow-wing`) |

**A rotated square rivalling an upright one wins on ink, not on size**
(`prefer_rotated`). `armadillo-girdled-lizard`'s crease fragments form a
square 3% *larger* than the paper; a paper photographed 8° off square leaves
an upright box 3% *smaller* than itself. Area cannot separate those and
neither can border support — the fragments' weakest side is 0.53 against the
paper's 0.78, but the 8° box reads 0.38 and `lotus`'s octagon bbox 0.43. What
separates them is which square holds the pattern.

Final state: **608/648 identical to the baseline, 40 changed, every one of
them a rotated paper.**

## Landing on the paper, not near it (2026-09-09)

Counting a crop "right" by eye at thumbnail size was too coarse. `angry-cat`
passed that check while sitting 14–20 px inside two of the paper's four
edges, which distorts every angle and is fatal downstream. The honest measure
is already in the report: **a correctly found paper has all four sides at
1.000 border support**, and on the first version only 22 of 40 did.

Two causes, both now fixed, taking it to **38 of 40**:

1. **The refinement was reading a subsample.** Striding the raster samples a
   sublattice, and how much of a line it catches depends on that line's
   angle, so the support curve is lumpy at a scale that swamps the quarter
   degree being resolved: on `angry-cat` stride 4 makes 45.25° beat the true
   45.00° by 257 to 256. A quarter degree is enough to smear the paper's own
   edge across enough buckets that `top_clusters` drops it for a crease.
   Refinement is a dozen projections, not ninety, so it now reads every
   pixel.
2. **A run of buckets above the threshold is not one line.** Where a paper's
   edge runs alongside a band of creases parallel to it — at 45°, most of a
   crease pattern — they stay above the threshold together and the weighted
   centre of the whole run lands in the middle of the band. On `hawk` that
   is a run 132 buckets wide with the paper's edge at its far end, reported
   55 px inside. `Lines::PerPeak` reads one line per local maximum instead.

`PerPeak` is scoped to the rotated search deliberately. It is the better line
finder on any axis and the upright path has the same defect —
`samurai-v4`'s and `falcon-2-0`'s papers are inset today for exactly this
reason — but it turns 12 lines into 53–61, and `MAX_AXIS_CLUSTERS` then keeps
the tallest rather than the outermost, moving 22 upright crops. Keeping the
outermost two through the cap fixes those but costs more than it gains on the
rotated side (36/41 instead of 38/40, regressing `swallow` and
`crested-ibis`). **Fixing the upright path needs its own corpus review and is
not in this change.**

One case, `dpa-sword-and-shield`, loses the diamond it found before these
fixes and falls back to the upright crop `main` already gives it: `PerPeak`
finds enough lines there to starve the cap. Not a regression against `main`,
but not the improvement it briefly was.


## The curated benchmark, and the frame the truth is in (2026-09-09)

Re-run in full against `tests/corpus/cp-detect-curated-baseline.json`. Only
the cases whose crop changed differ — an unchanged quad gives a bit-identical
rectified image, so nothing else can move.

Three of the benchmark's 558 cases have a changed crop, and all three read
`decoder: off` at edge F1 ~0.00 both before and after. Fitting the pipeline's
graph onto each `topology.fold` under a similarity transform says why — and
says something different for each, which is why the fit has to be scored in
**both** directions. A one-sided recall of the pipeline's vertices against
the truth's is 1.000 for a partial detection that happens to sit on true
vertices, and that mistake was made here first:

| case | pipeline → truth | truth → pipeline | what it is |
| --- | --- | --- | --- |
| `mammoth-v2` | 0.975 | 0.921 | the same pattern, frame off by 18.43° |
| `swallow-swallow` | 1.000 | 0.942 | the same pattern, frame off by 45° |
| `rabbit` | 1.000 | **0.558** | 24 of 43 vertices — a partial detection |

`mammoth-v2` and `swallow-swallow` are the change working: their
`topology.fold` and `truth.fold` keep the paper as it was drawn — a diamond,
or a scan 18° off square — because until now the crop could not rectify one,
and the strict 4 px of 1024 comparison reads a pure rotation as total
failure. `scripts/cp-detect/upright-curated-paper.py` rotates those two cases'
truth rigidly about the paper's own centre, by the angle of the paper's own
boundary edges taken into (-45, 45]. Nothing is regenerated and nothing is
fitted to the detector: every crease, assignment, fold angle and face is the
curated one, and only the frame changes. Verified after the fact — the
residual rotation between pipeline and truth is 0.06° and 0.00°, so the
minimal-rotation rule and the crop's own corner naming agree without the
truth ever being fitted to the pipeline's answer.

`rabbit` is **not** rotated. Its paper is upright already, and it is not a
square: the curated boundary is a square with one corner cut off, which the
square-only pipeline cannot represent. Its 45° "frame difference" was an
artefact of the one-sided fit.

### What the corrected truth measures

Full 558-case run on top of `main` (baseline `ded3c562`, decoder exact 356),
re-recorded into `tests/corpus/cp-detect-curated-baseline.json`. Three cases
differ and nothing else does:

| case | edge F1 before | after |
| --- | --- | --- |
| `mammoth-v2` | 0.002 | **0.938** |
| `swallow-swallow` | 0.000 | **0.740** |
| `rabbit` (crop only, truth untouched) | 0.000 | **0.138** |

Mean edge F1 across the benchmark, 0.967 → **0.970**. The bucket counts do
not move: `decoder_bucket` calls anything under an edge F1 of 0.95 `off`, and
`mammoth-v2` lands at 0.938 — a hair short, on a decode that finds 448 of the
truth's 483 vertices. `gate` and `status` are untouched, and `end to end`
moves one case, `mammoth-v2` from `not_accepted` to `accepted_wrong`: with
the truth now in the right frame that is a real reading rather than an
artefact, and it says the solver accepts an answer that a 0.938 decode does
not make right.

So the crop change is worth about three points of edge F1 on the two cases
whose paper it can now find, and the benchmark's headline numbers are
unchanged because both land below the `near` threshold.
