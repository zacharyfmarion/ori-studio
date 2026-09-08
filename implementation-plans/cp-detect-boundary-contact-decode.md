# CP-detect: boundary-contact decode

## Goal

Raise strict convergence on the curated benchmark by fixing the single largest
decoder defect: creases that meet the paper edge are dropped because their
border endpoint gets no candidate vertex, or gets one 4–12 px off, or gets two.
Measured in `research/2026-09-07-cp-detect-curated-funnel-bottleneck.md`:
145 of the 174 rendered near cases have a missing border-reaching crease, it is
the only defect in 87 of them, and 78% of the 1,033 lost border creases die at
the contact vertex (40% displaced or doubled, 31% under the 0.50 threshold,
7% no peak). Real images show the same shape.

The target is the decode, not the model: the contact heatmap fires on most of
these, and the junction path already has the offset-vote decode that contacts
never received.

## Approach

1. **Diagnose from the dumped maps.** For every lost border crease in the pool
   replay, compare where the raw contact heatmap peaks along the edge with
   where `boundary_contact_primitive` put the candidate. A peak at the truth
   with a displaced primitive is a decode defect (offset, side, NMS, merge);
   a displaced peak is the head. Read the `boundary_offset`, `boundary_coord`
   and `boundary_side_logits` heads' meaning from the detector repo, since the
   decode clamps the offset to ±0.5 px and never reads `boundary_coord`.
2. **Re-localise contacts from the ink** in junction-first, after span
   proposal: for each boundary contact with a proposed span to an interior
   vertex, fit the crease's ink centreline along that span (samples clear of
   the border stroke) and intersect it with the paper edge; combine several
   spans by ink mass; then merge contacts that now coincide (the doubled
   class), and recompute the touched spans. Keep the contact threshold and
   the new radii behind `JunctionFirstV1StrategyOptions` so the dump tool and
   the benchmark can sweep them; defaults are the measured best.
3. **Validate at the decoder stage** with `dump_candidate_pool` + the strict
   metric on the 169 near cases (both groups), then the full
   `curated_benchmark` with `--compare` against the baseline, scored strictly
   as well (accepted and topology-exact on `pipeline.fold`). No regression
   accepted without a reason.
4. Land with the baseline scorecard updated and the flips explained; the wasm
   bridge picks the change up on the next build.

## Affected Areas

- `crates/oristudio-cp-detect/src/evidence_extract.rs` — contact primitives,
  their threshold, localisation and clustering.
- `crates/oristudio-cp-detect/src/candidate_generation/junction_carrier_v1.rs`
  — `evidence_config`, `build_vertices` (contact merge against existing
  vertices).
- `crates/oristudio-cp-detect/examples/dump_candidate_pool.rs` — sweep hooks
  for the new settings.
- `tests/corpus/cp-detect-curated-baseline.json`, `tests/corpus/README.md`.

## What the diagnosis found (2026-09-08)

Per truth contact point (a boundary vertex with a crease, corners excluded),
over the 169 replayed near cases:

| class | renders (5,578 points) | real images (1,205) |
| --- | --- | --- |
| candidate within 2 px | 86.9% | 86.9% |
| displaced 2–8 px (median 2.6 px) | 8.3% | 10.3% |
| no candidate, raw peak 0.25–0.50 | 1.8% | 1.2% |
| no candidate, raw peak 0.10–0.25 | 0.9% | 0.2% |
| doubled (two candidates within 8 px) | 1.1% | 0.7% |
| no candidate, no peak ≥ 0.10 | 0.6% | 0.2% |

The displaced candidates sit exactly where the raw heatmap peaks (445 of
465 within 1 px), so the decode is faithful and the head is off. The offset
is **systematic**: signed along the edge in the direction the crease leans,
and a function of the crease's angle to the edge — mean +3.1 px (72% over
2 px) at 15–30°, +1.3 px at 30–60°, +0.07 px at 75–90°. That is the geometry
of two strokes meeting: the head fires where the crease ink touches the border
ink, not where the centrelines cross. Two shallow creases meeting at one
contact therefore give two peaks ~5 px apart, which is the doubled class.

Contact-only near cases (no other defect): 82 of 169. Of the 50 not
converged and not capped, the displaced-only ones end `solved` with contacts
still 2–5 px off (the solver's 1 px boundary prior keeps them there) and the
gate reproduces 13 of those 17 designs from exact coordinates, so a correct
contact position converts them. The sub-threshold ones are mostly the giants'
21 px grid stubs; a 0.25 threshold raises contact recall 94.2% → 96.0% for
+29 spurious peaks over 5,595 contacts. The `boundary_coord` and
`boundary_offset` heads are plumbed into the evidence but never read.

## Decoder-stage measurements

Replayed on the 169 near cases (both groups, under 1,500 creases) with
`dump_candidate_pool`, selection scored with the strict metric against
`topology.fold`:

| configuration | near → exact | fewer / more defects | missing edges | extra edges | contacts within 2 px |
| --- | --- | --- | --- | --- | --- |
| baseline (no re-localisation, threshold 0.50) | — | — | 1,652 | 913 | 86.9% |
| first fit (window mean, mass-weighted consensus) | 38 | 54 / 27 | 1,557 | 770 | 92.3% |
| first fit, threshold 0.30 | 40 | 74 / 22 | 1,351 | 778 | |

The first fit's regressions were real: in proboscis-monkey and
poison-dart-frog, contacts sitting on the truth were dragged 3–8 px by a
neighbouring stroke inside the ±4 px window, and disagreeing multi-span
estimates were resolved by ink mass. Hardened: the cross-profile centroid is
taken over the stroke nearest the span's line only (local maxima as modes),
a fit whose residual exceeds 0.8 px is refused, estimates that disagree by
more than 3 px refuse the move, and the allowed shift is angle-aware
(1.5 px + 3 px / tan(angle), capped at 8 px), so a perpendicular contact
cannot move more than 1.5 px.

| configuration | near → exact | fewer / more defects | missing edges | extra edges | contacts within 2 px |
| --- | --- | --- | --- | --- | --- |
| hardened fit, threshold 0.50 | 40 | 56 / 10 | 1,459 | 700 | 93.4% |
| hardened fit, threshold 0.30 | 43 | 80 / 10 | 1,228 | 688 | |
| + crowded guard, merge 1.5 px only after a move, threshold 0.50 | 33 | 50 / 12 | 1,472 | 727 | |
| + crowded guard, merge 3.0 px only after a move, threshold 0.50 | 41 | 57 / 12 | 1,452 | 697 | |
| **+ fused-blob, slope and half-bias guards (shipped)** | **41** | **57 / 10** | **1,444** | **692** | |

The 1.5 px merge gave back seven V cases whose two corrected contacts land
1.7–2.5 px apart (each fit is good to about a pixel); 3 px merges them, and
with the "one moved" rule and the crowded guard the two real contacts of
reza-squirrel-1 stay apart.

Threshold 0.30 dominates on every aggregate at the decoder stage (it rescues
the giants' 21 px stubs: maid 70 → 28 defects, alice 78 → 58), but the full
run showed its cost: on a real scan (reza-dreamworks-1) and a tiny render
(hirasawa) the extra peaks landed 5–6 px beside an existing contact or a
corner, their spans broke the solve, and two conversions were lost. The floor
stays at 0.50 in this change; the threshold remains a sweep hook and a
follow-up with a spurious-contact guard.
The ten remaining regressions are almost all curated cases with shallow
(30–33°) single-crease contacts that sat 0.0–0.1 px from "truth" before the
correction. A real scan cannot agree with an independent truth to a tenth of
a pixel: the curation protocol fixes the detection in place and the solve
holds contacts within a 1 px prior, so the curated truths inherit the head's
contact positions and cannot judge contact placement at this scale. The
rendered group's truths are the designs themselves. The end-to-end run is
therefore read with a truth-free check beside it: how far the solver has to
slide each contact from where recognition put it (`contact_slide.py`), which
must fall if the corrected positions are closer to the fold geometry.

## Full-run findings and the second hardening (2026-09-08)

The first full curated run (re-localisation + floor 0.30) moved the rendered
group from 265 to 291 strict conversions (decoder exact 256 → 297) and the
truth-free solver slide from a median of 0.53 px to 0.37 px (contacts slid
over 2 px: 5.1% → 1.6%), and the real-image group from 17 to 15. The losses
had three causes, each read from the recognised contacts against truth:

- **A merge of two real contacts.** reza-squirrel-1 has two contacts 10.7 px
  apart on its left side whose thick, converging strokes overlap inside the
  fit window; both fits were pulled toward the middle and the pair merged,
  the solve then failed. Fix: a sample whose profile holds a second stroke
  comparable to the nearest one is *crowded*, more than three crowded samples
  refuse the fit, and contacts merge only within 1.5 px and only when the
  re-localisation moved at least one of them.
- **Threshold false positives** (above).
- **A merge that is right and a truth that is not.** reza-squirrel-1's two
  contacts 10.7 px apart on the left edge are the head's two ink corners of a
  thick V: a faithful replay of the fit shows the up-right crease's centreline
  crossing the edge at 148.1 px and the down-right one at 150.1, every guard
  passing. The truth kept both corners because the lines there are auxiliary
  (`F`) edges nobody solves through. The merge itself is harmless; what breaks
  the solve is that the spans rebuilt from the corrected contact sample that
  aux ink well enough for selection to keep three aux-line creases the
  baseline had left out, and Kawasaki fails at their junctions. Aux ink on
  real scans is a pre-existing gap the change exposes on this one case.

Three further guards came out of chasing that case before its cause was
clear, and they stay because each closes a real hole at no cost on the
sweep (41 exact either way, 8 fewer missing edges): a sample whose stroke
support is 1.6× wider than the crease's typical width is two thick strokes
fused into one blob and counts as crowded; a centroid track that slopes more
than 0.08 px per pixel is a neighbouring crease converging onto the span
and its estimate is refused; and the near and far halves of the track must
agree on the fitted line within 0.5 px, so a bend near the edge refuses the
fit.
- **Solver free slides.** tabby-cat, wind-dragon and tiger-ziliang keep an
  exact or improved decoder and a reproduced gate, but the solve from the
  corrected start lands 2–5 px away on a sliding group of vertices. The same
  designs already flip between builds of one solver (the penguin and the bat);
  this is the solver prior, not the contact fix.

## Checklist

- [x] Diagnosis: raw-peak vs primitive position for the displaced / doubled /
      sub-threshold classes (the head carries an angle-dependent bias; see above)
- [x] Boundary head semantics confirmed: `boundary_offset` and `boundary_coord`
      are supervised on the single contact pixel only (`v2_boundary_targets.py`),
      and `boundary_coord` read at the peak is 12.6 px off in median — unusable
- [x] Centreline-intersection correction prototyped on the dumped ink maps:
      with the crease direction from the interior endpoint and ink samples kept
      clear of the border stroke, contacts over 2 px off fall 11.1% → 2.8%,
      p90 2.1 → 1.2 px (15–30°: median 3.3 → 1.4 px). A blind ray search
      fails because the line map carries the border stroke at full strength
- [x] `candidate_generation/contact_relocalize.rs`: centreline fit per incident
      span, merge of coinciding contacts (corners as fixed representatives),
      incident spans rebuilt; `contact_relocalize` / `contact_merge_px` /
      `boundary_contact_threshold` on `JunctionFirstV1StrategyOptions`, the
      threshold threaded to `EvidenceExtractionConfig`; six unit tests
- [x] Decoder-stage sweep on the 169 near cases (strict metric): 43 near → exact,
      none lost; threshold floor set to 0.30
- [x] Full curated benchmark, `--compare`, strict convergence both groups:
      decoder exact 274 → 312, harness recovered 317 → 338, gate 441 unchanged;
      strict convergence renders 265 → 291, real images 17 → 16; solver slide at
      contacts (renders) median 0.53 → 0.37 px, over 2 px 5.1% → 1.6%
- [x] Baseline scorecard and README updated, flips explained
