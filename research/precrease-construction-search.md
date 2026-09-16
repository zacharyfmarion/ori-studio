# Precrease construction search

## Question and independent assessment

The supplied review correctly located the main opportunity in physical execution:
which references exist, which alignment is presented, and how much of a line is
actually creased. Learning a priority inside geometric closure alone cannot choose
these things. The previous fixed-order search also had a restrictive acceptance
rule: it required an unchanged fold count, so an unnecessary auxiliary construction
could never disappear.

Experiments here support expanding construction choices before training a model.
Simply running the old reorder search longer produced much less improvement than
changing alignments and retiring their obsolete reference work. Most removable
work in the inspected cases was attached marking on pattern folds. It was not
the auxiliary-fold count itself.

## Implemented policy

The planner first runs the existing bounded ordering search, then searches the
completed physical construction. A proposal can replace the alignment, shorten
its crease to the required pattern and usable references, or remove a second
displayed alignment when the primary independently meets the existing visibility,
precision and practicality thresholds. It then attempts to remove the auxiliary
folds, presses and attached marks the old alignment consumed.

The replacement and its cleanup are evaluated together. This matters for an
auxiliary chain: once its final consumer disappears, the conservative pinch pass
temporarily treats the unused auxiliary as a full crease. Rejecting that temporary
cost prevents the search from discovering that the whole construction can vanish.
A synthetic regression exercises this case, alongside one where the auxiliary
really is necessary and must remain.

Each accepted result replays the final physical instructions, including both
displayed alignments, auxiliary pinch extents, and retroactively attached marks.
Required pattern coverage, availability, direction, exactness categories,
precision thresholds and difficulty cannot worsen under the evaluator. Presses
also require an earlier fold on their line. Changing either member of a symmetric
pair clears the old pairing proof and displays separate cards.

Among candidates passing those gates, the effort preference is:

```
marks / max(initial_marks, 1)
  + extra_length / max(initial_extra_length, 0.1)
  + 0.25 * turnovers / max(initial_turnovers, 1)
  + 0.25 * (folds + presses) / max(initial_folds + initial_presses, 1)
```

These are explicit preferences, not fitted human folding times. They permit a
work tradeoff while retaining the correctness and difficulty gates. The production
shortlist has 24 witnesses per fold, ranked by potential crease savings, retired
reference work, and local difficulty. Search uses at most 16,000 replay evaluations
and three passes. The existing `sequence_budget_ms` now defaults to 10,000 ms;
the ordering stage receives at most 1,500 ms of that shared budget. Zero still
disables refinement. A deadline returns the last complete accepted plan. Time
limits are cooperative: a candidate enumeration or replay can slightly overrun.

The old rule that a fold through two marks must crease between them is preserved.
Unfindable endpoints are not made free to manufacture a reduction in extra length.

## Protocol

The prospective [protocol](precrease-construction-protocol.json) assigns 38 designs
to development and 21 to evaluation, grouping known related variants. Input
SHA-256 receipts identify the external corpus files. These designs appeared in
earlier planner research; this split is prospective for this change, not a claim
that the corpus was never seen before. The production policy was fixed before
opening evaluation results.

Each comparison plans once and applies both policies to the same closure. Both
use the corrected final pinch pass: it now preserves reference marks needed by
the second displayed alignment and by repeated press instructions. This correctness
fix is applied to both sides of the comparison, not counted as optimizer savings.

The baseline is the merged 64-trial / 1,500-ms scheduling policy. The new result
uses the production ten-second shared budget, not an unlimited offline search.
The comparisons do not call ReferenceFinder. Partial native closures are reported
explicitly, and complete native cases are also summarized separately. Closure
planning still has its existing time limits, so reruns can construct different
closures under different machine load; within each pair the closure is identical.

Extra marks count presses, attached spans, and auxiliary pinch spans. Extra length
is the union of physical crease outside the target pattern, normalized to sheet
size; grid crease is included. Difficult instructions count the union of the
existing invisible, imprecise and impractical criteria, once per pattern fold.
Diagram-card counts and effort tradeoffs are reported separately.

## Results

The production policy meets the requested target on the reserved evaluation set.
Full receipts and per-design outcomes are in the
[development results](precrease-construction-development.json) and
[evaluation results](precrease-construction-evaluation.json).

| Measure | Development, 37 paired components | Evaluation, 21 paired components |
| --- | ---: | ---: |
| Extra marks | 689 → 529 (**−23.2%**) | 413 → 323 (**−21.8%**) |
| Extra crease length | 436.594 → 418.679 (−4.1%) | 191.789 → 182.999 (−4.6%) |
| Difficult instructions | 163 → 156 (−4.3%) | 91 → 87 (−4.4%) |
| Separate presses | 194 → 185 | 121 → 113 |
| Diagram cards | 2366 → 2397 (+1.3%) | 1295 → 1309 (+1.1%) |
| Unavailable-reference instructions | 18 → 14 | 12 → 9 |
| Protected metric regressions | 0 | 0 |

Development contains 27 complete, 10 partial and one refused input. Evaluation
contains 15 complete and six partial native inputs. Restricting evaluation to
the complete native cases still meets the target: marks 361 → 272 (**−24.7%**),
difficult instructions 77 → 73 (−5.2%). No folded target was dropped or uncovered.

Cleanup alone reduced evaluation marks from 413 to 401; alignment changes and
their dependent cleanup account for most of the remaining reduction to 323.
Auxiliary-fold counts stayed at 59 on evaluation: the real-corpus gain comes
primarily from reference marks, while full chain replacement is demonstrated by
the synthetic regression. Eleven evaluation designs have fewer marks, nine are
unchanged, and Water Boatmen trades two additional marks for shorter extra crease.
Thus 21.8% is an aggregate result, not a promise for every design.

Changed alignments sometimes invalidate a symmetric pair's presentation, causing
the small increase in cards without adding those physical folds. The sum of the
heuristic alignment errors rises 4.1% on evaluation, even though fewer instructions
fail its precision threshold. That continuous error measure is reported but is
not a protected constraint. These are real tradeoffs of the selected preference.

Median refinement time, including ordering, was 1.91 seconds in development and
2.90 seconds in evaluation on this macOS arm64 machine. Evaluation's maximum was
9.31 seconds; none of its construction searches hit the shared deadline. Three
development cases did, with a maximum 10.03 seconds. These are native timings;
WebAssembly tests and a browser interaction verify integration, not equivalent
browser latency or a browser-wide benchmark.

## Additional experiments

The [ablation receipts](precrease-construction-ablations.json) record the native
development experiments described here.

A slower teacher explores the full witness pool and up to 64,000 physical replay
evaluations. On Bali Myna it reduced 138 marks to 118, whereas 256 trials of the
old ordering search, capped at 60 seconds, left 138. The deeper old search produced
30 marks on Common Wildebeest versus 24 for construction search, and 18 on Markhor
versus 17. These are development ablations, not additional held-out results.

A separate offline frontier changes the order across arbitrary distances, requests
specific witness choices when still eligible, and executes the whole continuation.
In the final 60-second experiments, Bali Myna exhausted the deadline after 27
trials and Common Wildebeest completed 96 trials in 46 seconds; neither produced
a feasible accepted reorder. Markhor ran 69 trials, accepted 55 feasible
continuations and shortened extra crease from 3.331 to 3.314, retaining 18 marks.
This bounded experiment is not an exhaustive
search or a proof that order changes have no further value. It does not ship in
the interactive policy.

Turning off grid precreasing can dramatically reduce extra length, but often adds
many individual instructions or worsens difficulty and endpoint location. For
example, Turtle's extra length fell from 14.75 to 4.97 sheet units, while cards
rose from 23 to 47 and difficult instructions rose from zero to two. Grid replacement is therefore
not enabled by this change. The benchmark exposes grid alternatives for further
study; comparing different closures requires matching original target identities,
not their internal fold indices.

No model was trained and no RunPod resource was created or accessed. The useful
teacher operations are already executable locally. The longer order search did
not produce enough additional successful decisions to justify training a ranker
from it, and the small deterministic witness shortlist retained the development
gains. This is an evidence-based choice for this release, not a claim that ML
cannot improve the planner.

## Limits

This is an engineering benchmark, not a human folding study or a proof of optimality.
The evaluator protects relative quality; existing unavailable, poorly conditioned
or difficult baseline instructions can remain. Precision is a geometric heuristic,
and the secondary-alignment rule preserves the primary's thresholds, not a measured
joint error distribution. Average error can change within those thresholds.
Several validity guards protect counts rather than every individual defective
reference, and grid generation is inherited rather than independently certified.

The private Markhor feedback file is not present in this checkout; the optional
regression for that exact file is not evidence of a completed physical validation.
The curated Markhor design and synthetic geometric regressions are different tests.

All operations still begin and end unfolded. A future planner for partially folded
paper will need explicit layers, transforms and accessible references in its state.
The present search retains full instruction histories and paper snapshots, but
that does not yet model folding through several layers.

## Reproduction and validation

Build and run against an external corpus with the committed input receipts:

```sh
cargo build -p oristudio-precrease --release --example compare_constructions
python3 scripts/precrease/benchmark_constructions.py "$ORI_PRECREASE_CORPUS" \
  --split development --output artifacts/precrease-construction/development.json
python3 scripts/precrease/benchmark_constructions.py "$ORI_PRECREASE_CORPUS" \
  --split evaluation --output artifacts/precrease-construction/evaluation.json
```

`--mode teacher` uses the larger fixed work cap without a construction-search
deadline. `compare_constructions --deep-trials` and `--rollout-trials` run the
separate offline ablations. The script checks corpus hashes, flushes each result,
strips absolute input paths, and records source and executable receipts. No user
geometry is committed.

Validation results are recorded in the implementation plan and pull request.
