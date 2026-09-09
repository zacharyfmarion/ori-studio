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
them a rotated paper verified by eye.**
