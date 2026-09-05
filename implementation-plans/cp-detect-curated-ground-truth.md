# CP-detect curated ground truth

## Goal

Hold the image → topology → solved-pattern pipeline to a known state, so a
change to the detector, the decoder, the repair flow or the exact solver cannot
silently make a pattern that used to come out right come out wrong. The
existing benchmarks score the pipeline on *rendered* crease patterns with the
source FOLD as truth. This set scores it on the *real* inputs users give the
detect dialog — scans, screenshots, photographed diagrams — with truth that a
person established by hand in the editor.

The patterns are other designers' work, so the set never enters the repository
and never runs in CI. What is committed is the harness and a scorecard of
metrics per case, which is the "current state" a change is measured against.
This is the same split `tests/corpus/README.md` uses for the TreeMaker and
Oriedita corpora.

## Approach

### One case

```text
$CP_DETECT_CURATED_CORPUS_DIR/
  <slug>/
    source.<ext>     the exact file given to the detect dialog, original bytes
                     and format: source.png, source.jpg, source.webp
    detected.fold    what the detector produced, exported on accepting it
    topology.fold    the corrected pattern before solving: the decoder's truth,
                     and the solver's ground-truth input
    truth.fold       the solved pattern: the solver's truth
    work.osf         optional: the editor document, for re-opening and refining
```

No metadata file. Everything a metadata file would say is derived, so nothing
has to be typed and nothing can go stale:

| Fact | Derived from |
| --- | --- |
| Case status: todo, topology only, solved | which files exist, and the check below |
| `solved` | `truth.fold` passes the editor's foldability check, run by the harness |
| Failure tags: missed junction, spurious crease, wrong assignment, split or merged crease | `detected.fold` diffed against `topology.fold` with `strict_topology` |
| Family (box-pleat, 22.5°, mixed), paper shape, crease count | the geometry of `topology.fold` |
| Curation commit | the harness records its own build; the scaffold records the model and commit that produced `detected.fold` |

Three patterns, because the pipeline has two stages and each needs its own
reference. Repair fixes topology and assignments without moving vertices; the
solve then moves them, by up to its 1% budget. Scoring the decoder against
solved positions would count that movement as decoder error, so the decoder
is scored against `topology.fold`. And `topology.fold` is exactly the input
the solver is meant to turn into `truth.fold`, so the solver can be judged on
correct topology whether or not the detector reached it on this case.
`detected.fold` is what the model did at curation time: diffing it against
`topology.fold` yields the failure tags without hand-labelling, and shows
when a later model has changed the starting point.

### Scaffolding

A scaffold pass creates every case folder from a source directory: copies the
image in as `source.<ext>` and writes `detected.fold` from the native pipeline
(`detect_folder`), plus a `README.md` index listing each case's crease count
and detection outcome so the tractable cases are easy to pick out. The first
pass over `real/` made 107 cases, 103 with a detected pattern.

### Producing the truth, per case

1. In the web app (or desktop), detect from the source image with the default
   settings, and accept. Keep the image as given, uncropped and unconverted:
   rectification is part of what is under test.
2. Review & Fix, then repair by hand until the topology is what the design
   has: every junction, every crease, every assignment. Fix the detection in
   place rather than redrawing, so the pattern stays in the frame the detector
   placed it in. Add nothing that is not a crease: no aux lines, no marks.
   File ▸ Export FOLD… to `topology.fold` **before** solving.
3. Solve, then export to `truth.fold` whether or not the check came up clean;
   the harness reads `solved` off the file. Save the document as `work.osf`
   if it is worth coming back to.

Do not "improve" the design: truth is the pattern as the designer drew it,
including any asymmetry or unevenness that is really there. The pleat-spacing
pin exists because designs are drawn even; a design that is not is truth too.

### Frames

The decoder emits the pattern in the paper's unit frame; the editor holds it
at the document's paper size; `truth.fold` comes out in document units. The
harness normalises both sides by the boundary (`B`) edges' bounding box before
comparing, so the boundary must be present and complete in `truth.fold`. A
rectangular paper is mapped to the same square the product maps it to.

### What the harness measures, per case

The harness is a native binary in the detect crate (behind the
`native-inference` feature, next to `detect_folder`, sharing its ONNX session
and rectification): the product pipeline as shipped, on the real image, with
the same defaults the dialog uses. For each case:

| Measure | Source |
| --- | --- |
| Rectified, paper found | `auto_rectify` report |
| Decoder: strict topology vs `topology.fold` at 4 px of 1024: vertex and edge precision/recall, exact topology, missing/extra/split/merged edges | `oristudio-cp-eval::strict_topology` |
| Assignment accuracy on matched edges | same |
| Model drift: the same comparison of today's decode against `detected.fold` | same |
| Solve outcome: accepted / ambiguous / rejected / timed out, and the reasons | the solve report |
| End to end `recovered`: accepted **and** the solved fold reproduces `truth.fold` topology and assignment at 2 px | as `compare_exact_solve_benchmark` defines it |
| Solver on correct topology: the solve run from `topology.fold` reaches `truth.fold` at 2 px; needs no model, so it is the cheap gate after any compiler change | `exact_solve_input_from_fold`, the product path |
| Position error of the solved state vs a solved truth: mean and max, px | vertex matching |
| Foldability of the solved state: Kawasaki, angle violations, big-little-big | the solve report |
| Pleat runs found and held, and the spacing spread after | the pleat round's report |
| Wall clock: inference, decode, solve | timers |

Aggregates: exact topology n/N, recovered n/N, accepted-but-wrong, not
accepted, mean edge F1, and the distribution of failure tags among the cases
that did not recover. The binary refuses to run from a stale build the way the
benchmark does, and writes `per_case.jsonl` and `summary.json`.

### The baseline, and the rule for changing it

`tests/corpus/cp-detect-curated-baseline.json` is committed: per-case outcome
buckets and the aggregates, with the commit and date they were measured at.
Case slugs and numbers only; nothing from the images or patterns.

- `--compare tests/corpus/cp-detect-curated-baseline.json` prints every case
  that changed bucket, both directions, so a regression cannot hide inside a
  net gain.
- Before merging a change under `crates/oristudio-cp-detect*`,
  `crates/oristudio-cp-compiler`, or the detect and repair surfaces in
  `apps/web`, run the harness and paste the comparison into the PR.
- A change that moves a case is landed with the baseline updated in the same
  PR and the flip explained. A flip downward needs a reason a reviewer would
  accept, not a promise.
- `tests/corpus/README.md` records the last run, as it does for the other
  corpora.

### Choosing cases

Ten to twenty cases gate regressions; thirty or more support tuning. Cover:

- Box-pleated designs with pleats (the frog), 22.5° designs (Markhor, Bali
  myna), and at least two mixed ones.
- The size envelope the dialog says it handles well, small to medium, plus
  two or three large ones as topology-only cases so growth is
  visible.
- Every input kind: scan, screenshot, photo.
- Two or three cases the pipeline currently gets wrong, with the truth it
  should reach. Those are the targets; they will read as "not recovered" in
  the baseline until they are fixed, which is the point.

### What the first curation pass taught (2026-09-04)

74 cases were curated from the real set: 44 with an exact truth, 17 with a
repaired topology whose solve did not reach the truth, 13 skipped as too
complex. Three things the harness has to read correctly, learned from them:

- **Aux lines are exported as `F` edges and must be ignored.** 23 cases carry
  them. Counted as creases they make a dozen exact truths look unfoldable, with
  odd-degree vertices where an aux line ends.
- **A truth with fewer creases than its topology is the solve merging
  detector-split stubs**, which is expected (11 cases); a truth with *more* is
  repair that continued after the topology export (6 cases), and the topology
  should be re-exported.
- **Match vertices by geometry, never by index**, for the same reason.

First baseline, solver-only gate with the carrier round: 50 of the 61
repaired topologies solve, 37 of the 44 exact truths are reproduced within a
pixel, and 7 of the 17 the editor could not solve now solve. Three findings
worth their own cases: `crocodile`, an already-exact topology the solve makes
worse and then refuses; `helioprion` and `helmeted-hornbill`, accepted answers
that are exact but 43 px and 21 px from the truth.

## Affected Areas

- `crates/oristudio-cp-detect/src/bin/curated_benchmark.rs` (new, feature
  `native-inference`), with the session and rectification shared with
  `examples/detect_folder.rs` through a small module.
- `crates/oristudio-cp-compiler/examples/curated_solve.rs` (new): the
  solver-only gate, `topology.fold` → `truth.fold`, no model needed.
- `crates/oristudio-cp-eval` — reuse of `strict_topology`; a frame normaliser
  for FOLD-to-FOLD comparison if one does not already exist.
- `tests/corpus/README.md` and `tests/corpus/cp-detect-curated-baseline.json`.
- `scripts/cp-detect/README.md` — a section pointing at the above.

## Checklist

- [x] Case format agreed: files only, metadata derived
- [x] Scaffold `real_benchmark/` from `real/` (107 cases, 103 with `detected.fold`)
- [x] Curate the first cases: 74 done, 44 with an exact truth
- [ ] Harness: load a case, rectify, infer, decode, solve with dialog defaults
- [ ] Harness: normalise frames and score strict topology, recovery, position error
- [ ] Solver-only gate over `topology.fold` → `truth.fold` in the compiler crate
- [ ] Harness: `per_case.jsonl`, `summary.json`, `--compare`, provenance guard
- [ ] First baseline committed with the run recorded in `tests/corpus/README.md`
- [ ] README section and the PR rule written down
