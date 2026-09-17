# Source-image-guided exact recovery notebook

## Protocol

Follow-up to merged PR #389, starting from main commit 8b0d9584. The previous
S093 actual-browser baseline is 287/421 at 1e-9 and 278/421 at 1e-12, complete
graph including AUX, literal equality 0/421. All 421 clean cases finish within
25 seconds; ten assignment-defect controls remain unsolved. The previous ink
study compared S070 outputs, so its 99 favorable cases must be updated against
S093 before claiming how many remain. References are evaluation-only and never
enter proposals. Previously observed development/holdout labels remain honest.

## S095 — Baseline and experiment setup

Freeze the current compiler executable and selected WASM, record hashes, and
inspect the remaining cases before selecting a general source-only method.
No training, model publication, RunPod resources, or merge. Preserve the two
unrelated dirty oracle launcher files already present in this worktree.

S095 confirms that two of the original 99 favorable S070 misses are recovered
in S093 (Ant and Honeybee), leaving 97 from that group. The frozen baseline
compiler was rebuilt from the merged source rather than trusting the last
research executable in target/.

## S096 — Source-only line-fit starting points

On all 286 clean benchmark inputs with at most 150 vertices, robust line-center
fitting followed by the unchanged solver gains 17 references and loses three,
at both 1e-9 and 1e-12. All source fitting is independent of reference geometry.
This is a candidate-generation result: changing observations still requires
rejudgment against the original request before any product adoption.

Image selection distinguishes the two larger regressions: both have weaker ink
overlap and worse fitted-line residuals than the baseline. Reef Stonefish is a
small regression with a near-tie ink advantage (1.07e-5) and fitted squared-error
improvement (5.35e-5 px²), motivating an uncertainty-aware acceptance margin.
These measurements are diagnostic, not yet a selected product threshold.
The image-score command wrote all per-case and aggregate outputs, then its final
console-summary serialization rejected a NumPy integer; the integer conversion
is corrected without changing the scores.

## S097 — Larger source-fit candidates

Run the remaining 135 clean cases, including fitting time in each candidate's
25-second budget. This exploratory run overlaps the image-scoring analysis;
final timing must be replayed in the browser without competing work.

## S098 — Fitting around the accepted answer

Starting the fitter around the S093 answer instead of recognition produces
16 gains and four losses on the same 286-case pilot. It does not add a gain
beyond S096 and loses Reindeer, so this seed is not preferable by itself.

## S099–S100 — Fit within supported straight-line relationships

S099 parameterizes the baseline's exact angle-family relationships, fits the
remaining freedoms to source strokes, and then calls the ordinary solver. The
first version reports only two gains and 86 losses, but inspection identifies
a prototype bug: dense arithmetic changes locked paper corners by ~1e-18.
The solver correctly rejects subsequent construction proposals because the
request's literal pins disagree with its canonical corners. Do not interpret
those failures as evidence against constrained image fitting or weaken the
product's pin checks. Preserve S099 and explicitly restore hard coordinates in
S100, then rerun with otherwise identical settings.

S097 completes: 11 additional gains and four losses on the 135 larger cases
(84→91 at 1e-9). Together S096+S097 generate 28 gains and seven losses before
image-based selection. All four larger regressions have worse ink and fitted
line scores. Hand's nominal precision gain has essentially tied image evidence;
do not force the selector to recover a change the raster cannot distinguish.
The fitted-line scorer initially indexed exported, compacted vertices, which
fails when an exported graph omits a merged vertex. It now uses the solved
original-index vertex array for line residuals; ink uses the exported graph.

S100 (hard corners restored) yields 16 gains/four losses on the small pilot,
adding no gain beyond ordinary source-only fitting. More complex constrained
fitting is not justified by this result alone.

## S101–S103 — Observation precision versus construction simplicity

The current construction objective assumes detector-scale uncertainty. Test
100× stronger observation weights after the source fit (joint 8→800;
nonlinear 2→200), consistent with moving from roughly pixel-scale to subpixel
observations. S101 gains 29 and loses four on the 286-case pilot (203→228).
S102 replays that setting on the remaining 135 cases.

S103 tries another 10× increase (8000/2000). It gains 23 and loses 12 on the
small pilot (203→214). Ball Python and Health Bar are new candidates, but
stronger observation fidelity alone is not a better final selector. These
weights are frozen experimental binaries, not the intended no-image default.
The working recovery.rs constants are temporary and must return to 8/2 for
requests without image evidence before shipping.

A portable Rust source-line measurement path is being implemented and checked
against the Python prototype. It stores derived line observations and proposed
starting coordinates as optional input evidence; old inputs omit the field.
There is no change to model weights or assets. The two-coordinate fit reduces
to independent 2×2 systems per vertex, avoiding a browser SciPy dependency.

## S104 — Bounded Rust image recovery

Restore no-image observation weights to 8/2. Try source-fit alternatives with
weights 800, 8, 8000 under one shared deadline, retaining only a meaningful
image-fit improvement that passes validation against the original request.
Explicit pins, original movement limits, graph structure and assignments remain
hard checks. Eagle's Rust/Python fitted points agree within 6.88e-8 paper width;
Rust fitting takes 0.037s and the bounded solve 0.123s in the first native probe.
The full 421-case replay is running. These are preliminary native measurements.

## S105 — Independent Oriedita rendering gate

The user correctly asks for evaluation beyond Ori Studio's rendering. Much of
the existing real benchmark uses native CP files rendered by Ori Studio, so
original-image gains alone cannot establish renderer robustness.

Freeze 36 cases by baseline recovery/ink-diagnostic strata and size, with
deterministic hash selection independent of S096–S104 outcomes. Render ten
settings using the actual vendored Oriedita `DrawingUtil`, `Camera` and `Colors`
through Java2D: thin strokes, small/medium/large markers, thick strokes,
antialiasing off, 2048 resolution, dashed color style, black/gray, and dark mode.
Preserve the upstream draw order and default stroke normalization. No vendored
source edits and no Ori Studio rasterization. Oriedita casts line endpoints to
integer pixels, an important additional source of subpixel uncertainty.

First isolate source scoring/candidate recovery using the same frozen recognized
graph across styles. Reference coordinates enter the renderer and separate
evaluator only. They never enter fitting, candidate generation or answer
selection. This paired test does not claim end-to-end recognition robustness;
that requires a separate recognition replay. Previously inspected benchmark
cases remain evaluation data, not a newly blind holdout. No training.

S105 interim audit, first 19 completed cases across all ten settings: the
baseline recovers ten. Most color settings gain one and lose three; high
resolution gains two and loses two; black/gray generates no color evidence and
preserves ten. The failing color cases replace existing exact sqrt(2)
constructions with arbitrary subpixel coordinates. They fit Oriedita's
integer-rounded ink more closely but are geometrically less correct. This is a
real renderer-sensitivity failure, not evidence to weaken the reference metric.

## S106–S107 — Portable measurements and construction-preserving selection

S106 reduces fitter memory by measuring one color field at a time, ports the
source-only border recentering, rejects stale assignment evidence, and adds
synthetic tests for precise recovery, pins, invalid evidence and old JSON inputs.
The worker can attach compact evidence while preserving opaque AUX attachments.
Region solving remeasures its current rebuilt graph against its owned image,
using the known paper and image transforms; missing images retain ordinary
solving. Measurement time is deducted from the region's shared 25s budget.

S107 addresses the Oriedita failure with a structural rule: image evidence can
choose between precise constructions, but cannot erase an existing recognized
construction in favor of an unconstrained coordinate to fit pixel rounding.
It uses the existing generated rational/sqrt(2)/sqrt(3) construction catalog;
there is no renderer identity test or reference-derived coordinate lookup.
Full original-image and Oriedita replays are running. Native exploratory runs
overlap independent work, so final browser timings still require an isolated run.

S104 completes at 323/421 (42 gains, six losses) at 1e-9 and 311/421
(39 gains, six losses) at 1e-12. Literal equality remains zero. These results
motivate the stricter selection work; they are not an acceptable release gate.

## S108–S109 — Quantization uncertainty and construction description cost

S107 rejects the larger Oriedita shifts that erase a recognizable construction.
Bear still changes to a different recognizable construction on a tiny score
advantage. S108 adds a line-correlated pixel-quantization uncertainty margin:
zero fitted scatter must not imply infinitely precise source geometry. A
counterfactual filter of S104 retains 21/42 gains and one/six losses, showing
that applying this conservatively to every comparison discards useful evidence.

S109 therefore distinguishes two reasons to prefer a candidate. Better ink
plus a strictly simpler exact construction can agree on an answer; an equally
complex or more complex alternative must clear the quantization margin. The
description cost comes from the existing generated construction catalog, not
CP-specific coordinate templates. Existing constructed coordinates must still
remain constructed. A 48-case diagnostic replays S104's changed cases; this
selection is explicitly outcome-based and cannot replace the final full gate.

S110 exercises the complete browser recognition path on six independently
hash-selected members of the frozen 36-case Oriedita set across all ten styles.
Use the known generated paper frame to isolate recognition from automatic
cropping. Recognition topology uses its historical geometric association
tolerance; this experiment must not be reported as exact solved convergence.
The paired solver gate remains separate and uses the 1e-9/1e-12 full graph audit.

S107's completed original-image replay reaches 329/421 at 1e-9 (43 gains,
one loss) and 318/421 at 1e-12 (41 gains, one loss). Dorcus titanus is the
remaining loss: a 0.193-pixel move improves line error by only 0.000178 px².
It retains recognizable coordinates but selects the wrong construction.
This is why construction preservation alone is insufficient.

S109's outcome-selected 48-case replay yields 26 gains and no losses at 1e-9,
and 25 gains and no losses at 1e-12. It deliberately gives up some attractive
but weakly supported subpixel changes. This pilot is not a full-set result.

S110 completes all 60 recognition runs. Physical topology/assignment succeeds
on 6/6 thin, small-marker and high-resolution images, 5/6 aliased-thin, and 4/6
dark images. Including AUX gives 5/6, 5/6, 6/6, 4/6 and 4/6 respectively.
Medium markers, thick/large markers, aliased markers, dashed COLOR_AND_SHAPE
and BLACK_WHITE each give 0/6. The unchanged recognizer has a substantial
style-robustness gap; the new source evidence does not modify recognized FOLD
geometry. These are topology measurements at the historical association
tolerance, not exact solved-coordinate recoveries. No images were used for
training. Preserve these failures for future synthetic-render training work.

## S111 — Full candidate validation

Use S109 selection with an absolute endpoint-displacement bound in the
quantization margin. This conservatively covers line-angle error as well as
line-offset error. Freeze native binaries and the rebuilt browser WASM. Run
all 360 paired Oriedita source tests, then the full 421 clean graphs and ten
defective controls in actual browser workers, including source decoding,
measurement and solver startup in the shared 25-second budget.

Local validation so far: 2,227 Rust workspace tests pass (seven ignored), four
source-fitting tests pass including a new neutral-border regression, changed
crate clippy passes, and the normal production web build including WASM and
landing prerender succeeds. Full web tests pass 7,000/7,001; an unrelated
wall-clock simulator test exceeds 120 ms under concurrent research/build load
and is being rechecked separately without changing its assertion.

That simulator file passes all 37 tests on its separate rerun. Halberd Knight's
fresh recognition and solve preserve all 1,664 vertices, 3,662 edges and every
solved coordinate from S093 literally; the prior grid verification therefore
still holds. There is no reference CP for it. Under concurrent native research
load recognition takes 15.28s and solving 24.71s; do not use this as an isolated
timing comparison to S093.

## S112 — Preserve original measurements through the document workflow

The saved-reference pilot exposed a product/data-fidelity gap. The same 48-case
diagnostic gives only ten gains with zero losses when measured from Review &
Fix's rectified JPEG underlay, versus 26 gains from the original source. The
underlay is a visual reference, not a lossless source for precise measurement.

Keep the compact original line observations already attached to detection's
opaque solve input. At region solve time, remeasure the current graph and reuse
original observations only where geometry and assignment still match the
original stroke. Match in the reference image's coordinate frame, not by old
vertex ids. New split junctions may reuse the carrier; moved/recolored strokes
and stale original observations may not. Rotation, reflection and scale are
explicit transforms. Rescale measurement uncertainty conservatively. Existing
documents without these optional observations retain the JPEG measurement path.
No new model assets, image payloads or mandatory document fields are introduced.

Synthetic tests cover saved precision, changed geometry/assignments, stale
observations, rotated coordinates and a new split vertex. The browser harness
now distinguishes original pixels, legacy JPEG-only regions, and fresh regions
with preserved original observations. All use the same exact solver and strict
reference audit. Run the final full browser gate through the region helper;
preparing its saved underlay is import work, while decoding, remeasurement,
matching, solver startup and solving count against the 25-second solve budget.

S112's saved-reference pilot restores 27 gains with no losses at 1e-9. S111's
completed 421-case original-image native replay gives 316/421 (29 gains, zero
losses) at 1e-9. However, its Oriedita sweep still loses BB by Xiao Dai under
three settings (aliased markers, thick markers, dark). Do not declare that
selector renderer-robust simply because the ordinary benchmark has no losses.

## S113 — Construction confidence and document resolution

Tighten the uncertainty exemption: lower description cost alone can replace
one known construction with a different, wrong one. Require that the candidate
also turns previously free coordinates into recognized constructions. Other
comparisons must clear the pixel-quantization margin. Preserve the old trials.

The actual rebuilt-document Knight check uncovered a second product gap that
the direct-input solver benchmark does not exercise. Rebuilding its recognized
FOLD drops `image_size: 2048`. With `None`, the solver takes a different
document proposal path and returns a locally valid answer with 70 changed
vertices, up to 0.001753 paper width from the previously verified result. This
happens identically with image recovery disabled, so it predates this change.
Restoring only the resolution produces the verified geometry within 1.2e-16
in 7.71s native; no confidence, topology or assignment copying is required.

Carry the detector's resolution through the same reference-frame transform,
including when an older saved input has no image observations. Add a synthetic
resolution/rotation/scale test. Expand the browser harness with a genuine FOLD
rebuild and a no-image baseline mode. Keep that product-path comparison separate
from S093's direct-input 287/421 benchmark, rather than silently changing the
benchmark definition. The stricter selector also gets a synthetic regression
where a simpler fraction has too little pixel evidence to replace an existing
fraction. All six recovery and seven source-measurement tests pass.

The S113 construction-count restriction does not fix BB: all coordinates are
already recognized before and after, and the wrong answer is more complex.
Its image advantage clears the independent-line uncertainty margin. Remove
this unhelpful extra restriction rather than preserving it on speculation.

## S114 — Account for raster phase, without moving the answer

Oriedita's integer endpoint rounding creates a shared subpixel offset in the
colored strokes even with the right paper frame. On BB the inferred per-axis
offset is about 0.29 pixels for aliased markers and 0.47–0.50 for thick/dark
styles. A mean-zero, independent-line error model mistakes that shared offset
for evidence to move crease coordinates.

Fit a bounded half-pixel translation when evaluating the image likelihood only.
The weighted two-variable quadratic is solved exactly inside its box by checking
the interior and four edges. The output geometry, pins, paper frame and reference
audit do not receive this translation. Compute the uncertainty comparison after
removing the fitted phase. Keep S111's construction-preservation and description
cost policy; no renderer name or setting is consulted.

A source-only counterfactual changes BB's wrong-answer advantage from
0.00608/0.01497/0.01220 px² to 0.00163/0.00123/-0.00097 for aliased markers,
dark and thick markers. These no longer clear the uncertainty margin. All 29
S111 original-image recoveries still prefer their reference-matching answer
after phase adjustment, before applying the remaining selection checks. These
are diagnostics, not new recoveries. Add a synthetic test showing that a shared
half-pixel phase changes image scoring without changing any graph coordinates,
and that a full pixel of disagreement cannot be explained away.

S114's targeted BB gate now preserves the reference at both 1e-9 and 1e-12 in
all ten actual Oriedita settings, including the three previous regressions.
The actual rebuilt-document Halberd Knight replay preserves all 1,664 vertices
and 3,662 edges/assignments, with literal zero coordinate difference from the
previously verified S093 answer. Measurement takes 0.469 s and the solve flow
24.700 s. This case has no ground truth; this checks the prior grid verification,
not an invented reference match.

Final full runs use frozen S114 binaries and WASM. Original-image native,
360-render native, and paired actual saved-region browser replays run concurrently
on this M1 Max; each runner is sequential internally. No build runs during the
browser measurements. Browser region timing includes graph rebuilding, saved
image decoding, measurement/remapping, worker startup, solving and export, after
recognition/import preparation. Candidate and baseline share the same JPEG
underlay and FOLD rebuild; baseline omits the new image evidence and resolution
inheritance. Separately retain S093 direct-input comparison to avoid confusing
a product round-trip defect with image-scoring gains.

## S115 — New Oriedita render confirmation

Freeze S114 application source and binaries before selecting this gate. Exclude
all 36 earlier renderer cases, then deterministic-hash select 12 others, balanced
small/large and prior recovered/ink-miss/other-miss strata. Test four new settings:
0.5px hairlines; 2.5px strokes with 1px markers; 1.25px strokes with 4px markers;
and aliased 1536px images with 1px strokes and 2px markers. These are unseen
render combinations for the selected code, not unseen real-pattern identities.
No selector change may be justified as validation against this gate if its
outcomes have already been used for tuning. Preserve all results either way.

Retrospective candidate coverage: the union of S096–S103 (excluding the invalid
S099 pin experiment) contains a reference answer for 37 of the 97 remaining
ink-favorable cases. This is an evaluation-only union across incompatible
prototype candidates, not a selectable solver or a theoretical ceiling. For
the other 60, better answer scoring alone cannot recover an answer these
experiments never generated.

S114 original-image native validation completes all 421 clean cases within 25s
(maximum 24.4986s). Complete graph including AUX improves from 287 to **319**
at 1e-9 (32 gains, zero losses), and 278 to **308** at 1e-12 (30 gains, zero
losses). Literal equality remains 0. This converts 28 of the 97 remaining
previously ink-favorable cases. Raster-phase handling retains all S111 gains
and adds Arabian Oryx 2.5, Cat by Gen Hagiwara, and Panda by Obelisk. Browser
and independent-render confirmation remain separate pending gates.

The full actual-region no-image baseline completes with 289/421 at 1e-9 and
280/421 at 1e-12. Relative to S093 direct inputs, it gains seven cases and loses
five (the exact loss identities differ at 1e-12). This is a pre-existing input
round-trip difference, not an image-recovery result. The paired candidate must
be compared against this baseline as well as the original direct-input gate.

Compatibility smoke: the frozen pre-change S095 native solver accepts a new
rebuilt input containing both optional image evidence and the remapping report,
ignores those unknown fields, and solves Black Panther in 0.164s. This checks
the old parser/solver binary, not an unperformed old-desktop GUI test. The
unchanged model registry and old bundled application code remain untouched.

S114 actual saved-region browser replay completes: **318/421 at 1e-9** versus
289 before (29 gains, zero losses), and **307/421 at 1e-12** versus 280 before
(27 gains, zero losses). All 421 clean cases complete within 25s; maximum
24.7098s, median 1.0797s, p95 24.1564s. All ten defective controls remain
ambiguous/failed. Compared with the separate S093 direct-input baseline, this
path has 31 gains and zero losses at 1e-9; at 1e-12 it still has the pre-existing
Octopus round-trip precision miss. Do not conflate that with a new regression
against the paired region baseline. It recovers 25 of the 97 ink-favorable
cases; four were already correct in the region baseline, giving 21 additional
recoveries in that subgroup on the actual region path.

The full 360-render S114 Oriedita gate preserves every previously correct result
at both exact tolerances. At 1e-9, each style starts at 18/36; black/gray stays
at 18, aliased markers and high resolution reach 23, and the other seven styles
reach 22. All 360 complete under 25s. This is a fixed-graph solving result, not
an end-to-end recognition claim.

S115's 48 new confirmation renders also preserve every baseline exact result
at both tolerances and complete under 6.163s. They add no recoveries: all four
styles remain 6/12. Preserve that null result; it supports preservation on these
settings, not a generalization claim about additional recovery. No application
code changed after the confirmation selection.

S114 direct-input actual-browser replay confirms the native totals exactly:
**319/421 at 1e-9**, **308/421 at 1e-12**, literal equality zero. The 32/30 gains
respectively have zero regressions. All 421 clean cases finish under 25s, all
ten defective controls remain ambiguous/failed, and the recovered-case sets
match the native gate. This is the comparison to S093's 287/278 headline.

Final deterministic validation: 2,233 Rust tests pass (seven ignored), all 7,001
web tests in 560 files pass with two workers, affected-crate Clippy passes,
web lint/typecheck pass, and the normal production build rebuilds WASM and
prerenders the landing page successfully. The earlier full-web timing failure
is retained; the final full run passes without modifying the simulator test.
No additional upstream oracle is run because no ported kernel/parser behavior
changed. Application fingerprints still match the frozen S114 source.
