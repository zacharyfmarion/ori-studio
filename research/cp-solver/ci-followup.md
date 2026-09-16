# Native CI follow-up — September 16, 2026

PR #387 run `35155597248`, native job `104994238940`, failed after
24m55s. The actual failure was `angle_restricted_5_matches_oriedita_oracle`:
Java emitted an `hsperfdata` lock warning on stdout before the five correct
geometry records. Rust and Java geometry agreed; the extra protocol line made
the strict comparison fail.

Both oracle launchers now disable unused JVM performance counters with
`-XX:-UsePerfData`. A regression test deliberately enables the same performance
logging channel and requires stdout to contain only the oracle result. It failed
against the old launcher and passed after rebuilding. The geometry cache key
already includes the launcher build script.

The long runtime was a separate issue. Unoptimized precrease planner test
binaries consumed about 15 minutes of the failed CI run. A package-specific
test profile now uses optimization level 2, retaining debug assertions,
overflow checks, fixtures, and assertions. An isolated representative test
dropped from 110.849s to 15.053s locally. The complete precrease test run passed
268 tests (two existing ignored tests), with 73.77s summed test-binary time.
The replacement GitHub run `35159117254` then passed all three CI jobs. Its
native job took **11m42s**, versus 24m55s for the failed run. Clippy plus workspace
tests took 8m22s, versus 21m54s previously; Oriedita parity passed in 73s.

Validation: all seven configured Oriedita parity/guard suites passed (118 tests),
the native IO launcher rebuilt and its IO suite passed with both geometry and
native IO variables configured, CP test-target clippy passed, and Rust format,
shell syntax, and diff checks passed. No application, release profile, solver,
or upstream geometry behavior changed. Generated launchers with local absolute
paths are not part of the commit.

Evidence lives in ignored `artifacts/cp-solver/ci-fix-387/`. The PR remains
unmerged; the user's explicit go-ahead is required for a merge.
