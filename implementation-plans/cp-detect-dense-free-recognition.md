# CP Detect Dense-Free Recognition Experiment

Status: Proposed implementation plan, June 18, 2026.

## Goal

Measure how good crease-pattern recognition can get when the candidate graph is
seeded without model dense outputs.

Strict dense-free means the runtime must not read or synthesize any of the
current model heads:

- `line_logits`
- `junction_logits`
- `boundary_contact_logits`
- `assignment_logits`
- `non_crease_logits`
- `line_style_logits`
- optional dense heads such as `angle`, `junction_offset`,
  `vertex_type_logits`, `boundary_side_logits`, `boundary_offset`, and
  `boundary_coord`

Allowed inputs for the first experiment:

- rectified RGB/RGBA image pixels;
- known target image size and unit-square frame geometry;
- crop/rectification report when available;
- existing compiler `CandidateGraph`, beam selection, exact solve, report, and
  benchmark infrastructure.

This is not intended to replace `junction-first-v1` immediately. The first goal
is to produce a clean comparison that answers:

```text
rectified image -> raster evidence -> CandidateGraph -> selection -> exact solve
```

versus the current dense path:

```text
rectified image -> model dense heads -> CandidateGraph -> selection -> exact solve
```

## Approach

### Experiment Boundary

Add a separate raster evidence path instead of overloading the existing
`CandidateGenerationContext`, which currently assumes `DenseOutputs`.

Initial shape:

```text
oristudio-cp-detect
  raster_evidence.rs
  raster_candidate_generation/
    mod.rs
    carrier_v1.rs
    junction_pair_v1.rs   # only after carrier_v1 gives a useful signal
```

Keep dense and dense-free strategy names separate:

- current dense strategies stay under `candidate_generation`;
- dense-free strategies live under a new raster-specific strategy boundary;
- both paths emit the same compiler `CandidateGraph`.

That keeps benchmark comparisons honest and avoids candidate-source soup.

### Raster Evidence

Create `RasterEvidence` from rectified pixels:

- luma map and color-normalized RGB map;
- deterministic ink/line probability map from adaptive thresholding and local
  contrast;
- binary line mask for Hough/skeleton extraction;
- optional orientation map from Sobel or structure-tensor gradients;
- color/style hints for assignment, kept separate from topology quality;
- extraction report with thresholds, foreground density, connected components,
  and timing.

The first implementation should use the existing `image` and `imageproc`
dependencies plus the existing OpenCV-compatible `HoughLinesP` Rust port. Avoid
adding a new native dependency until the image-only baseline proves it needs
one.

### Candidate Strategy 1: `raster-carrier-v1`

Start with a carrier-first image-only baseline:

1. Read `input_png` from a correctness benchmark pack.
2. Normalize the image and extract an ink/line mask.
3. Run Hough segment extraction on the mask.
4. Merge nearby collinear segments into carrier hypotheses.
5. Build candidate vertices from:
   - locked square corners;
   - carrier intersections;
   - carrier/border contacts;
   - strong segment endpoints, marked lower confidence;
   - clustered duplicates.
6. For each carrier, sort incident vertices and emit adjacent candidate spans.
7. Score spans using raster support along the segment rather than dense line and
   non-crease support.
8. Generate deterministic locked border spans.
9. Emit a coherent `CandidateGraph` with provenance and conflict semantics.

For the first benchmark, assignment can be `Unknown` unless a simple color
heuristic is reliable. Topology quality should be measured separately from
assignment quality.

### Candidate Strategy 2: `raster-junction-pair-v1`

Only add this if `raster-carrier-v1` shows that raster vertex proposals are
usable but carrier gating misses true creases.

This strategy mirrors the dense `junction-first-v1` idea, but all support comes
from raster evidence:

```text
raster vertices -> plausible vertex pairs -> raster segment scoring -> CandidateGraph
```

The scorer should be written as deterministic features first:

- line-mask hit fraction;
- luma/contrast support;
- gap count and longest unsupported run;
- nearby competing vertices along the segment;
- carrier agreement as a bonus, not a hard gate.

### Assignment Track

Do not let assignment obscure topology conclusions.

Run metrics in three tiers:

- topology-only, assignments ignored;
- simple raster assignment heuristic from color and dashed/gapped style;
- existing dense assignment baseline, only as a diagnostic ceiling, not part of
  the strict dense-free result.

If topology is promising but assignments are weak, a later sparse or
non-dense assignment classifier can be planned separately.

### Oracle/Ablation Ladders

Add diagnostic modes that are not product candidates but explain failure modes:

- raster support with GT vertices;
- raster carriers with GT vertices;
- raster vertices with GT edge adjacency;
- GT vertices plus raster assignment heuristic;
- current dense `junction-first-v1` on the same pack for comparison.

These modes answer whether the bottleneck is image masking, carrier extraction,
vertex proposal, edge proposal, selection, or assignment.

### Benchmarking

Reuse correctness benchmark packs because they already include both
`input_png` and `gt_graph`.

Add a native benchmark runner such as:

```bash
target/release/compare_raster_candidate_coverage \
  --pack artifacts/cp-detect-correctness/packs/clean-1024-s15/manifest.json \
  --strategy raster-carrier-v1 \
  --out artifacts/cp-detect-correctness/reports/<date>-raster-carrier-v1
```

This runner should mirror `compare_candidate_coverage`, but read pack manifests
instead of dense-cache manifests.

Required outputs:

- `summary.json`
- `summary.md`
- `per_sample.jsonl`
- `per_gt_edge.jsonl`
- optional contact sheet with raster mask, carriers, vertices, candidates, and
  selected graph overlays

Required comparisons:

- `raster-carrier-v1`
- `raster-junction-pair-v1` if implemented
- current dense `junction-first-v1`
- current dense legacy strategy if still useful as a historical baseline

Primary metrics:

- candidate oracle recall;
- selected recall;
- edge precision/recall/F1;
- border precision/recall/F1;
- selected graph structural validity;
- strict topology/isomorphism score where available;
- runtime per sample;
- candidate count and conflict count.

Root-cause buckets should include:

- line missing from raster mask;
- carrier missing;
- endpoint/intersection missing;
- boundary contact missing;
- pair rejected by raster support;
- candidate emitted but rejected by selection;
- assignment unavailable or mismatched.

### Inspector And Product Wiring

Defer product default wiring until benchmarks justify it.

Useful inspector work after the native benchmark exists:

- add a raster evidence mode to the architecture inspector;
- show luma, line mask, connected components, carriers, vertices, candidates,
  and selected graph;
- let the strategy selector choose dense or raster paths explicitly;
- label dense-free runs so screenshots and reports cannot be mistaken for dense
  model runs.

Product integration should stay behind an explicit debug option until the
dense-free path has stable benchmark results on clean and smoke tiers.

### Optional Sparse-Model Follow-Up

If the user intent is "no dense heads" rather than "no model at all", a later
follow-up can train a sparse predictor:

```text
rectified image -> sparse vertices/edges or edge-pair probabilities -> CandidateGraph
```

That should be planned only after the strict image-only baseline shows where
the deterministic path fails. Possible sparse outputs:

- vertex set predictions;
- direct edge-pair probabilities over proposed vertices;
- assignment predictions per emitted span.

Avoid starting with a graph neural network or set-prediction model until the
raster baseline has identified whether vertex proposal, edge proposal, or
assignment is the real blocker.

## Affected Areas

- `crates/oristudio-cp-detect`
  - new raster evidence module;
  - new raster candidate-generation strategy boundary;
  - native image-pack benchmark runner;
  - focused unit tests for masks, carrier merging, intersections, border
    contacts, span scoring, and graph emission.
- `crates/oristudio-cp-compiler`
  - ideally unchanged, because both dense and raster paths emit
    `CandidateGraph`;
  - only adjust if raster provenance or conflict kinds require a small IR
    extension.
- `crates/oristudio-cp-eval`
  - root-cause buckets and dense-free evidence diagnostics;
  - assignment-optional topology metrics if not already sufficient.
- `apps/cp-detect-architecture-inspector`
  - later visualization for raster evidence and dense-free strategy reports.
- `apps/web` and `crates/oristudio-cp-detect-wasm`
  - later debug/runtime entrypoint for image-only recognition, after native
    benchmark signal.
- `scripts/cp-detect`
  - helper scripts for running pack-level dense-free benchmarks and generating
    contact sheets.

## Checklist

- [x] Define `RasterEvidence`, extraction config, and report schema.
- [x] Add deterministic image mask extraction from rectified PNG/RGBA input.
- [x] Add `raster-carrier-v1` strategy that emits `CandidateGraph`.
- [x] Add unit tests for raster masks, Hough carrier grouping, intersections,
      border contacts, locked borders, and adjacent-span emission.
- [ ] Add `compare_raster_candidate_coverage` over correctness pack manifests.
- [ ] Run `clean-1024-s15` against `raster-carrier-v1` and current dense
      `junction-first-v1`.
- [ ] Add root-cause diagnostics for raster-specific misses.
- [ ] Add oracle/ablation modes with GT vertices and GT carrier/adjacency
      hints.
- [ ] Decide whether `raster-junction-pair-v1` is warranted.
- [ ] If warranted, implement and benchmark `raster-junction-pair-v1`.
- [ ] Evaluate topology and assignment separately on clean and smoke tiers.
- [ ] Add architecture-inspector visualization once benchmark reports are
      actionable.
- [ ] Decide whether to pursue a sparse non-dense model based on the raster
      bottleneck analysis.
