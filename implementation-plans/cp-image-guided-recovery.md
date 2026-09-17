# Recover reference geometry with source-image evidence

## Goal

Convert as many image-disambiguatable misses as possible into complete reference
matches, including AUX, beyond S093's 287/421 at 1e-9 and 278/421 at 1e-12 paper
width. Keep the actual browser solve within 25 seconds and preserve existing
matches, pins, topology, assignments, and old desktop compatibility.

## Approach

Freeze the merged baseline. Audit the prior ink-scoring diagnostic, then test
source-only line fitting, constrained candidate generation, and image-based
selection. Proposals never read reference coordinates. Use the unchanged full
421-case selection and ten defective controls for final before/after evaluation;
keep previously observed splits explicit. Measure fitting/scoring overhead as
part of the shared browser budget. Retain rejected experiments and failures.
No real-pattern training, model publication, merge, or external GPU resources
are needed initially. Private Alligator remains excluded.

## Affected Areas

- Original compiler exact recovery and candidate selection.
- Shared browser/native image evidence transport, if experiments justify it.
- Research tools, synthetic regressions, experiment notes and frozen artifacts.

## Checklist

- [x] Freeze merged baseline and audit remaining image-supported misses.
- [x] Evaluate source-only fitting and constrained candidate generation.
- [x] Evaluate answer selection, including cases where ink favors the wrong answer.
- [x] Validate independent Oriedita Java2D renders across stroke widths, vertex
      sizes, antialiasing, line styles and resolutions; preserve failed cases.
- [x] Implement a general improvement with synthetic regression coverage.
- [x] Replay the full exact-reference gate and measure actual browser timing.
- [x] Validate, archive evidence and open a draft PR without merging.

Draft PR: https://github.com/zacharyfmarion/ori-studio/pull/396
Local app: http://127.0.0.1:5176/welcome
