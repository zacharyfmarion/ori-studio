# Source-image-guided exact recovery

Follow-up to merged PR #389. Source-image evidence produces 32 additional
complete reference matches on the unchanged direct-input browser benchmark,
including 28 of the 97 remaining ink-favorable cases. No previous match is lost.
The actual saved-document workflow also improves without regressions against
its own paired baseline. Rejected experiments are in [the notebook](image-guided-recovery-log.md).

## Results

All counts include AUX and use the same 421 clean cases. “Solved” alone is not
a reference match: all 421 receive an accepted solve, while the table requires
the complete geometry and assignments to agree with the reference.

| Path and precision | Before | After | Gains / losses |
| --- | ---: | ---: | ---: |
| Direct recognition input, browser, 1e-9 paper width | 287 | **319** | +32 / 0 |
| Direct recognition input, browser, 1e-12 paper width | 278 | **308** | +30 / 0 |
| Saved document, browser, 1e-9 paper width | 289 | **318** | +29 / 0 |
| Saved document, browser, 1e-12 paper width | 280 | **307** | +27 / 0 |
| Literal coordinate equality, either path | 0 | 0 | 0 / 0 |

The native direct-input run independently matches 319/308. The original ink
study had 99 favorable misses; two were already recovered before this work.
The direct browser run converts 28 more. On the saved-document path, 25 of the
remaining 97 now match, versus four before: 21 additional subgroup recoveries.
These are separate input paths, not interchangeable counts.

All 421 clean cases complete within the shared 25-second browser budget, and all
ten assignment-defect controls remain ambiguous/failed. Saved-document timing
is median 1.080s, p95 24.156s, maximum 24.710s; its baseline median was 0.540s
and p95 9.678s. The extra accuracy costs additional search time, especially on
the slowest cases. Timing is measured on an M1 Max with concurrent sequential
benchmark runners and ordinary user applications; it is not a guarantee of
identical recovery on every slower device.

The actual rebuilt-document Halberd Knight check preserves all 1,664 vertices
and 3,662 edges/assignments and returns literally the same coordinates as the
previously grid-verified S093 answer in 24.700s. There is no ground truth for
that case; it is a regression check, not another reference recovery.

The [machine-readable summary](image-guided-recovery-summary.json) records
comparisons, timing, source hashes and validation. Frozen outputs remain outside
git in the external archive described below.

## What changed

The solver keeps its ordinary answer as a baseline. Measurements of nearby
stroke centers in the source image generate up to three alternative answers.
It keeps an alternative only when the image gives meaningful support and all
original geometry checks still pass. Image measurements do not create edges,
change mountain/valley/AUX assignments, override pins, or round the answer to
pixel coordinates. They help choose precise geometric constructions.

The scorer accounts for a shared displacement of at most half a source pixel
caused by drawing and pixel-center conventions. This adjustment applies only to
image scoring. Returned coordinates and the reference evaluator never receive
that displacement. Without it, some actual Oriedita drawings persuaded the
solver to move already-correct creases toward Java2D's rounded pixels.

Original line measurements survive the saved-document workflow as optional
numeric evidence. After a graph edit, an observation is reused only for a
matching unchanged stroke, including pieces split at new junctions; moved or
recolored strokes are measured again. The original recognition resolution also
survives rebuilding a FOLD graph. Dropping that resolution had caused a separate
Halberd Knight grid regression in the actual region Solve path.

## Evaluation contract

- Same frozen 421 clean graphs and ten assignment-defect controls. Full graph
  includes AUX. References are opened only by the evaluator.
- Report literal equality, 1e-12 and 1e-9 paper-width agreement separately. No
  visual pixel allowance is used for these recovery counts.
- Boundary-origin translation and a single paper-width scale establish units.
  No fitted rotation, anisotropic stretch, coordinate rounding or raster-phase
  adjustment is permitted in reference scoring.
- Distinguish direct recognition inputs from graphs rebuilt in the saved-region
  workflow. The latter receives a paired baseline, not a substituted denominator.
- Browser timing includes measurement and solve overhead within a shared 25s
  budget. Machine and concurrency context are recorded with the experiment.
- Dataset development/holdout labels are historical: these cases were previously
  observed. The Oriedita confirmation holds out new renders, not unseen designs.

## Rendering coverage and limits

The renderer calls vendored Oriedita `DrawingUtil`, `Camera` and `Colors` through
Java2D. It varies line width, vertex markers, antialiasing, resolution, dark mode,
and color/dash styles. It does not call Ori Studio's drawing code. S105/S114 use
36 patterns across ten settings. At 1e-9, every setting starts at 18/36: black/gray
stays at 18, aliased markers and high resolution reach 23, and the other seven
settings reach 22. No previous match is lost at either exact tolerance; all
360 solves complete under 25s.

S115 selects 12 different patterns and four new settings after freezing the
selected code. All 48 confirmation renders preserve the six previous matches
per setting at both tolerances, add no matches, and complete under 6.163s. This
null result supports preservation, not additional recovery. Across both gates,
408 Oriedita renders exercise 14 settings. The scorer does not inspect the
renderer identity or setting name.

The fixed-graph gate isolates the solver. A separate 60-image actual-recognition
check exposes existing detector gaps: large markers, thick strokes, black/gray
and some dashed styles can change topology before the solver sees it. This
change does not retrain the detector or claim those recognition failures are
fixed. The 2px association used by that older topology diagnostic is not the
exact-coordinate recovery metric above.

## Shipping and compatibility

This is a compiler, WASM and shared worker change; it needs no model release.
There are no model weights, registry changes, real-pattern training, GPU jobs or
RunPod resources. Older inputs omit the optional evidence and keep the existing
solver path. Older desktop builds continue using their bundled code and unchanged
model registry. Saved evidence is an optional field, not a required file-format
version. AUX remains part of the graph.

No private Alligator image or graph is included. No merge is authorized.

## Validation and remaining work

The selected code passes 2,233 Rust workspace tests (seven existing ignored
tests), all 7,001 web tests across 560 files, affected-crate Clippy, web lint and
typecheck, formatting, and the normal production build including regenerated
WASM and landing prerender. The first broad web run under heavy experiment load
hit an existing simulator wall-clock assertion; its focused file and the final
complete run pass without changing that assertion. No extra upstream oracle
run is needed because the ported editing kernels and their parsers/serializers
are unchanged. The old S095 solver binary also accepts an input carrying the new
optional evidence; no old-desktop GUI run is claimed.

This is not a theoretical ceiling. Earlier candidate-generation experiments
produce a reference answer for only 37 of the 97 remaining ink-favorable cases;
the selected direct path safely converts 28 of those. Scoring alone cannot
select a reference that the search never proposes. Some close alternatives also
remain indistinguishable at the raster's precision. The saved-document path
preserves original line observations, but rebuilding the graph can still change
which constructions are proposed and accepted. Its residual differences are
retained in `S114-raster-phase/region-difference-diagnostic.json`.

## Reproduce and inspect

The external archive is
`/Users/zacharymarion/Documents/datasets/create-pattern-detector/research/cp-image-recovery-2026-09-17/`.
It retains accepted and rejected trials, frozen executables, input/output hashes,
source snapshots, exact audits and per-case timing. Earlier frozen recognition
inputs and S093 outputs are in the sibling grid/reference-recovery archives.
Restore their `artifacts/` trees before replaying; the protocols record the
original absolute dataset paths and source hashes.

Build the application and WASM before starting a browser replay; do not rebuild
or allow a Vite reload in the middle of it. The selected executable pair is
`solver_research` and `source_line_probe` from the compiler and detector crates.
The research entry points are:

```bash
# Original source pixels, frozen recognized graphs, native solver.
python3 scripts/cp-detect/research/run_source_recovery_study.py \
  --out artifacts/cp-solver/NEW/original-native \
  --binary-dir artifacts/cp-solver/S114-raster-phase --refine-border

# Browser workers: direct inputs, or the actual saved-region rebuild and helper.
node scripts/cp-detect/research/run_browser_image_recovery.mjs \
  http://127.0.0.1:5176 artifacts/cp-solver/NEW/direct-browser
node scripts/cp-detect/research/run_browser_image_recovery.mjs \
  http://127.0.0.1:5176 artifacts/cp-solver/NEW/region-browser \
  --region-underlay --preserve-source --rebuild-graph

# Paired old region behavior: same rebuild and underlay, no new evidence.
node scripts/cp-detect/research/run_browser_image_recovery.mjs \
  http://127.0.0.1:5176 artifacts/cp-solver/NEW/region-baseline \
  --region-underlay --rebuild-graph --no-image

# Exact scoring is separate from every proposal/selection process.
python3 scripts/cp-detect/research/score_solver_study.py \
  artifacts/cp-solver/NEW/direct-browser --out artifacts/cp-solver/NEW/direct-browser/placed
python3 scripts/cp-detect/research/audit_exact_recovery.py \
  artifacts/cp-solver/NEW/direct-browser/placed \
  --out artifacts/cp-solver/NEW/direct-browser/audit --tolerances 0 1e-12 1e-9
python3 scripts/cp-detect/research/compare_image_recovery.py \
  artifacts/cp-solver/NEW/direct-browser --clean-only
```

For Oriedita, `prepare_oriedita_style_gate.py` builds the upstream Java renderer
and freezes the evaluation images. `--confirmation-from <earlier protocol>`
selects different cases and the four confirmation settings. Run those images
with `run_oriedita_style_gate.py`, then `score_oriedita_style_gate.py`. The
separate `run_oriedita_recognition_gate.mjs` and `score_rendered_recognition.py`
measure recognition topology; do not substitute their pixel association metric
for the exact-coordinate audit.
