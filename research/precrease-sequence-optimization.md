# Physically replayed precrease sequence refinement

## Scope and independent assessment

This work starts at `5855e070`, the References workspace merge, and evaluates
flat-sheet precreasing: every operation begins and ends unfolded. It changes
Ori Studio's original planner, not a ported engine or ReferenceFinder.

The supplied review correctly identifies the separation between geometric
closure, provisional ordering, and the actual witness/repair transition. A
ranking model plugged into closure's batch would not control the final sequence.
It also correctly identifies historical state as essential: later instructions
can amend earlier witnesses and attach pinches to earlier folds. A set of folded
lines is not sufficient to replay such a prefix.

Three qualifications matter:

1. The useful guarantee is conditional on a **fixed closure**. Wall-clock
   search limits, auxiliary choices, and approximation fallback can change which
   targets are reached. Our experiment compares two schedules of the same
   closure, rather than independently solving a pattern twice and attributing
   every difference to scheduling.
2. `measure_ends` was useful diagnostic infrastructure, but not a sufficient
   acceptance test. Its phantom count trusted `marks_exist`; its physical replay
   treated auxiliary pinches as whole chords, and its reach measure did not
   include all attached marks. The new evaluator reconstructs emitted extents
   and measures the union of all crease outside the pattern.
3. Neither of the cited learning papers establishes an advantage for origami.
   [Ross and Bagnell](https://arxiv.org/abs/1406.5979) support cost-sensitive
   interactive imitation learning; [Khodeir, Agro, and Shkurti](https://arxiv.org/abs/2111.13144)
   demonstrate learned search priorities for task and motion planning. They
   motivate a possible later ranker, not training before measuring a teacher.

No model was trained, no credentials were accessed, and no RunPod resources were
created, used, or deleted. The current gains do not justify training expense.

## A concrete correctness defect

The physical replay found two press cards in the curated Markhor plan whose
chosen alignments used hypothetical pinchable marks, rather than marks actually
made by preceding instructions. The normal fold transition materializes these
pinches; `press_witness` did not. Its inexpensive candidate was therefore an
instruction whose prerequisite never appeared in the output.

The press picker now restricts itself to physically present marks. Retroactive
witness replacement receives the same restriction: it cannot silently acquire
new prerequisites on other earlier folds. A replacement also preserves the
previous crease extent, because intervening instructions may already consume
that material. These are correctness fixes before optimization, not improvements
obtained by changing the objective.

The original Markhor plan had 118 folds and three press instructions. Its two
missing-reference press warnings become zero with the corrected picker, without
adding a fold or press. The exact private `markhor_feedback.fold` used by the
older optional feedback test was not found; the curated Markhor input is a
different regression resource and is not represented as a substitute for that
human-feedback test.

## Implementation

`order::Schedule` owns the complete execution prefix: paper coverage, face,
placed instructions, line-to-fold lookup, and the before/after paper snapshots.
Its `place` transition is shared by the baseline and every proposed schedule.
Immutable historical paper snapshots use `Rc`, so branching shares history
without allowing a branch to mutate another branch's past.

The baseline transition extraction was checked against the saved original
Markhor textual output and the native test suite before behavior changes.
The refinement has three parts:

- Re-evaluate crease extents against the **completed** prefix. A pinch attached
  retroactively to an earlier fold may now offer a nearer stopping reference.
- Try bounded promotions and delays of nearby CP folds, prioritizing extra
  crease, preparatory marks, physical crossings, and compatible sheet faces.
- Try exchanging adjacent whole face blocks. A single-fold improvement cannot
  cross the plateau where moving only one member saves no turnover, but moving
  its block does. This permits useful changes across closure sweeps.

A proposal is executed through the actual witness picker, historical repairs,
and twin rules. It is then replayed in full, after all retroactive amendments
and the final auxiliary pinch pass. Geometry provides a conservative eligibility
prefilter; it never certifies a physical reference by itself.

At most 64 proposals are considered in production, under a separate 1,500 ms
refinement budget. The complete incumbent is always retained; interruption
between transitions discards an incomplete rollout. One transition or replay
may finish slightly beyond the deadline. At most 17 checkpoints are retained.
`sequence_budget_ms: 0` disables refinement for comparisons. With a frozen clock
and a fixed trial limit, proposal order and results are deterministic; a live
wall-clock cutoff can stop at different incumbents on different machines.

## Acceptance rule

`quality::evaluate` is shared by production selection and the benchmark. It
never creates hypothetical pinchable marks and never trusts `marks_exist`.
It includes grid extents, auxiliary pinches, press instructions, CP extents,
and attached marks. Overlapping crease intervals count once in extra length.

An accepted candidate must have the same fold coverage and no increase in:

- Missing or duplicated folds, uncovered target spans, or wrong forced faces.
- Unavailable references. A failure on a new folded-line identity is rejected
  even if another missing reference was repaired.
- Targets inheriting approximation, compared by target identity rather than
  only an aggregate count; reversed weak-majority folds are also protected.
- Pinches exceeding the existing accuracy limit, or unknown pinch precision.
- Invisible, impractical, or imprecise instructions, or unknown CP precision.
- Unfindable ends, preparatory presses, extra marks, extra crease length,
  turnovers, or cards.

At least one substantive quality/work measure must improve. Card grouping by
itself is not a win. Continuous alignment-error sums are reported as diagnostics,
not optimized: their value depends on the chosen anchor and they do not model
both simultaneously displayed mirror alignments. Missing measurements are
explicitly counted rather than treated as zero error.

This is a conservative Pareto rule. It deliberately rejects tradeoffs that
would require an unvalidated exchange rate between a turnover, a pinch, a
harder alignment, and a length of unwanted crease. It is a **relative** safeguard,
not a claim that an imperfect incumbent or every accepted plan is fully correct.
The evaluator reuses the deterministic geometry predicates, so it is not an
independent physical oracle or a proof of all folding feasibility.

## Experiments retained and rejected

The development pilots compared fixed local relocations, dynamic scheduling
using the actual transition, whole face blocks, and final extent tightening.

- Dynamic within-block greedy selection found no accepted improvement on the
  11 committed fixture patterns plus curated Markhor. It was removed.
- Simple deletion of attached marks/presses found no gain on the Markhor and
  bat pilot. It was removed.
- Deeper local search (128 proposals, before the production cap) reduced
  Markhor's extra marks from 19 to 18 and extra crease from 3.5463 to 3.3193
  normalized sheet sides, but required roughly 22 seconds in that pilot.
- Whole face blocks reduced Markhor's turnovers from eight to six without
  increasing marks or the protected difficulty categories.
- Extent tightening saved a small amount of crease on earwig in milliseconds.
- A more elaborate predicted-reference-length priority did not improve the
  Markhor/earwig pilot under the same 1.5 second budget; it was removed.

These pilots establish some useful deterministic search freedom. They do not
yet establish that a learned ranker would recover enough additional benefit to
justify deployment complexity. No training/validation split or ML comparison is
claimed. Markhor influenced development and is not a held-out demonstration.

## Reproducing the comparison

```sh
cargo run --release -p oristudio-precrease --example compare_schedules -- \
  --trials 64 --budget-ms 1500 "$ORI_PRECREASE_CORPUS" > comparison.jsonl

# Fixed proposal budget, without a search wall-clock cutoff:
cargo run --release -p oristudio-precrease --example compare_schedules -- \
  --trials 64 --budget-ms 0 tests/fixtures/precrease > fixtures.jsonl
```

A directory holding `truth.fold` contributes only that file: its detection,
topology and `work.osf` copies are not independent designs. Missing input files
fail. Refused sheets and files with no components are reported explicitly.
Each JSONL record includes coverage/status, both quality vectors, and separate
planning, baseline-ordering, and refinement timings. No corpus geometry is
committed. The native benchmark omits the browser's ReferenceFinder fallback;
its partial plans and defect totals are **not** product completion rates or
proven bounds on the shipping driver.

The baseline for the final comparison includes the press correctness fixes;
only sequence refinement differs between columns. Corpus results are recorded
below, with per-input hashes and quality vectors in the accompanying JSON report.

## Corpus results (2026-09-16)

The final run covers 59 curated inputs: 43 complete native plans, 15 partial
native plans, and one refused sheet. Both scheduling policies use the same
closure for each of the 58 paired components. Refinement improved **26/58**;
32 retained their baseline quality. No protected metric increased on any paired
component, and no new target acquired approximation or an unavailable reference.

| Measure across paired components | Baseline with correctness fixes | Refined |
| --- | ---: | ---: |
| Emitted folds (excluding the unchanged grid block) | 4,077 | 4,077 |
| Missing / duplicate folds / uncovered targets / wrong forced faces | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Extra marks | 1,133 | 1,123 |
| Extra crease, normalized sheet lengths | 635.3538 | 633.0438 |
| Turnovers | 373 | 353 |
| Separate presses | 315 | 314 |
| Unavailable-reference instructions | 32 | 31 |
| Invisible instructions | 143 | 141 |
| Imprecise instructions | 147 | 146 |
| Unknown CP precision | 188 | 188 |

The aggregate gains are modest: 0.9% fewer extra marks, 0.36% less unwanted
crease, and 5.4% fewer turnovers. They are concentrated in individual designs:

| Design | Concrete change in this run |
| --- | --- |
| Markhor | Eight turnovers to six; same 19 marks and crease length |
| Frog (Naoki Terao) | Six marks to four, three presses to two, six turnovers to four |
| Salamander (Naoki Terao) | Eight marks to six; extra crease 1.5283 to 1.0671 |
| Leek | Eleven marks to ten; five turnovers to three |
| Weedy sea dragon | 25 marks to 23 |

Refinement took a median 1,501 ms, 95th percentile 1,510 ms, and maximum
1,515 ms on this macOS arm64 development host. This is **additional** to closure
and baseline ordering; the budget is per sequence emission. These are observed
latencies on an ordinary development machine, not an isolated performance study.

An earlier run while other validation was active improved 22/58 components,
saving seven marks and twelve turnovers; Markhor kept eight turnovers in that
run. Native closure also has wall-clock limits (42 complete versus 43 in the
final run). Thus neither these exact aggregates nor a particular improvement is
promised on every machine. The same-closure comparison and incumbent acceptance
rule hold independently of how far the budget gets.

The [machine-readable report](precrease-sequence-results.json) includes every
component, unchanged and refused cases, input SHA-256 receipts, remaining-target
counts, all quality vectors, and separate phase timings. It contains no corpus
geometry or absolute local paths. The remaining defects above are deliberately
visible; “no regression” does not mean “every instruction certified.”

## Validation

- `cargo fmt --check` and `git diff --check`.
- `cargo clippy --workspace --all-targets -- -D warnings` (the repository's
  existing unknown `clippy::chunks_exact_to_as_chunks` lint warns on the pinned
  Rust toolchain).
- `cargo test --workspace`: 2,145 reported passes, seven explicitly ignored
  tests. The last measurement guard and interruption test were then covered by
  the affected release suite: 265 reported passes, including 195 unit tests and
  the 48-pattern physical-replay property test.
- `wasm-pack test --node --release crates/oristudio-precrease-wasm`: 11 passes.
- Web lint and typecheck. Full web suite: 548 files / 6,882 tests passed.
  After the final guard change, the References suite was rerun against rebuilt
  WASM: 42 files / 557 tests passed.
- `npm run build:web`, including normal WASM hooks and landing prerender.
- Browser smoke test: create a pattern with the base generator, open References,
  generate the sequence and navigate the rendered fold cards; no console errors.
  The in-app browser's file chooser did not open for the fixture import, so this
  smoke test used the in-app generator rather than claiming that import worked.

Web tests used `NODE_OPTIONS=--no-experimental-webstorage` because the local
Node 26 experimental storage implementation conflicts with jsdom. The test and
typecheck commands skipped redundant npm hooks only after rebuilding the affected
WASM and refreshing the worktree's other generated dependencies. Production
builds retained all hooks.

The optional private Markhor feedback test returns early without its external
file; its reported pass is **not** evidence that its folding assertions ran.
The release suite ran the two precrease performance tests that debug mode
ignores. The unrelated ignored oracle/detector tests were not enabled. Dedicated
upstream oracle parity and a native desktop UI run were not necessary: this
change touches original precrease planning and shared renderer types, not
ported semantics or the Tauri shell.

## Remaining research

A publishable user-effort claim needs blinded physical folding comparisons,
more design families, and a calibrated difficulty measure. Our counts are useful
engineering evidence, not a human study, an optimality proof, or a finished
research paper. The conservative objective may miss worthwhile tradeoffs.
Existing unresolved references in some native-only plans remain visible in the
report; hiding them or labeling all plans certified would be wrong.

If longer search becomes a worthwhile teacher, generate action-value labels
from full counterfactual continuations, split by original design family, and
compare a small ranker with these deterministic proposals at equal end-to-end
latency. Report feature extraction cost and missing-value coverage. Do not learn
geometry or train merely to imitate the incumbent order.

Partially folded states are outside this model. They will require explicit
material coordinates, layer stacks, accessible faces, contact constraints,
and transitions that move material. A flat-sheet `Creased` set plus a face bit
cannot express a fold through two layers. Neither monotone reference availability
nor these cached prefixes should be reused as if they established that behavior.
