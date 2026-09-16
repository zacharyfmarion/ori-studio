# Precrease construction search

## Goal

Pursue at least 20% fewer unnecessary marks or less unnecessary crease, with
fewer difficult instructions, against the merged sequence-refinement baseline.
Required target coverage and accuracy must not be traded away. Operations begin
and end unfolded. Report failure to reach the target honestly if the tested
search directions exhaust their useful gains.

## Approach

Attribute physical work to its source; freeze a prospective development/evaluation
split and compare alternatives on the same inputs. Explore joint witness and
extent choices, replacement/deletion of auxiliary construction chains, and a
frontier allowing effort tradeoffs while retaining strict correctness gates.
Compare longer baseline search with the expanded action space. Build a slower
offline teacher before deciding whether a learned action/value ranker has useful
labels and can improve latency. Validate the complete emitted instructions,
including retroactive commitments and auxiliary extent changes.

The previous corpus was already used for baseline research; a prospective split
does not retroactively make it unseen. Keep tuning off the new evaluation split.
Use fixed search-work caps for quality comparisons and report timings separately.
No user corpus geometry is committed. RunPod resources, if needed, must be newly
created for this task, individually recorded, and terminated after use. Do not
read, use, stop, or delete another agent's resources.

## Affected Areas

- Original Rust precrease planner: execution choices, physical replay, search.
- Native offline comparison tools and deterministic synthetic regressions.
- WASM and References integration if a winning policy is shipped.
- Research reports, evaluation selection, reproducibility and limitations.

## Checklist

- [x] Inspect merged baseline and identify fixed-construction limitations.
- [x] Freeze evaluation protocol and attribute remaining physical work.
- [x] Explore joint alignment, crease extent and order choices.
- [x] Explore replacement and removal of auxiliary construction chains.
- [x] Evaluate bounded effort tradeoffs and multiple promising plans.
- [x] Compare the offline teacher to deeper baseline search.
- [x] Train and evaluate a small ranker if the teacher warrants it; otherwise document why.
- [x] Evaluate untouched prospective cases and the 20% target, including difficulty.
- [x] Ship justified improvements and run native/WASM/web validation.
- [x] Publish results, update the draft PR and provide a local preview.

## Outcome

The fixed production policy met the target on the 21 reserved evaluation cases:
extra marks 413 → 323 (−21.8%), difficult instructions 91 → 87 (−4.4%), extra
crease length −4.6%. No protected metric regressed. Complete native cases alone
also pass: marks −24.7%, difficulty −5.2%. Cards increase 1.1% on evaluation.
The continuous heuristic error sum increases 4.1% while fewer instructions exceed
its threshold; the report states that tradeoff explicitly.

The interactive policy uses witness/extent replacement and dependent mark cleanup.
The longer order/frontier search remains an offline experiment. Grid alternatives
were evaluated but not enabled because reduced crease can cost more instructions
and difficulty. No training, credentials or RunPod resources were used. See
`research/precrease-construction-search.md` and its JSON receipts.

## Validation record

- Focused regressions cover necessary auxiliaries, whole-chain replacement,
  retained mirror marks and invalidated symmetric pairs.
- Random finite-span patterns cover construction refinement and bounded rollouts.
- Rust release suite and full workspace debug suite passed.
- Workspace clippy and formatting passed. Clippy emits the pre-existing unknown
  `clippy::chunks_exact_to_as_chunks` configuration warning on this local toolchain.
- Rebuilt precrease WASM; all 11 Node WASM tests passed.
- Web lint/typecheck and production build passed; all 6,882 web tests passed
  using CI's Node 22. The system Node 26 run failed in existing localStorage tests.
- Browser smoke test: generated a built-in pattern, planned its sequence, opened
  a folding card and inspected its diagram with the rebuilt WASM.
- No parser, upstream port, desktop-shell or public bridge signature changed;
  separate oracle/desktop-shell validation is not needed for this original planner.
- Exact private Markhor feedback file unavailable; its optional test is not
  counted as physical validation of that file.

## Handoff

Draft PR: https://github.com/zacharyfmarion/ori-studio/pull/385 (base `main`).
Local preview: http://localhost:5246/references, served by `scripts/dev-server.sh`.
The browser preview contains a generated test pattern and its folding cards.
Stopped algorithm experiments after meeting the prospective evaluation target.
