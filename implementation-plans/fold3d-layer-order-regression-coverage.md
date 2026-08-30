# Layer-order regression coverage: owned fixtures in CI, external corpus in the worktree

## Goal

Two things that are separated by **rights**, not by convenience:

1. The non-flat models we own become **committed fixtures with CI coverage**, so the
   3D layer-order path stops being the only subsystem in this repo with no
   automated breadth at all.
2. The external corpus — third-party models we cannot redistribute — becomes
   **reachable automatically in a fresh worktree** instead of depending on an
   environment variable nobody remembers to set.

## Why now

Three facts, all measured during the investigation in
[`research/2026-08-fold3d-layer-order-investigation.md`](../research/2026-08-fold3d-layer-order-investigation.md):

- **The corpus sat unused for the entire investigation.**
  `ORISTUDIO_NON_FLAT_CORPUS_DIR` was unset, the harness skipped loudly and
  correctly, and nobody noticed — while six files were tuned against by hand. When
  it was finally pointed at the 108 files already on disk it produced the decisive
  result in one run: **22 of 27 admitted models ordered before, 27 of 28 after**,
  zero regressions, failure set a strict subset with `airplane.fold` the only
  holdout either way. That is the check that separates "fixed the examples" from
  "fixed the bug", and it was one `export` away the whole time.
- **Nothing sweeps `starting_face_id` on the 3D path.** The only sweeps in the
  suite are `[1, 0]` inside the *flat* oracle tests. Every single defect found in
  this investigation violated starting-face invariance, and no test checks it.
- **The oracles do not cover what we changed.** `oriedita_folding_oracle` 29/29 and
  `oriedita_render_oracle` 13/13 pin the **flat** path. Non-180 fold angles are Ori
  Studio native, so `folding3d/` has no oracle and never will. Committed fixtures
  plus property tests are the *only* possible coverage for that code.

## Approach

### Part 1 — commit the models we own

Rights are **confirmed by the owner** for the nine files below: the six from
`test_files/non-flat/fold_issues/`, the two under `test_files/non-flat/personal/`,
and `community_made/540-level-0.osf` — the last named explicitly, which is why it
is here despite its directory. Everything else in `community_made/`,
`origami-simulator-corpus/` and `plant/` stays external regardless of usefulness.
The README still records per-file provenance, so the claim stays auditable.

Fixtures split into **two categories that must not be conflated**, because only
one of them proves anything about the work just done.

**Regression fixtures — measured to FAIL at `HEAD` and pass now.** These pin the
defects fixed in this investigation.

| fixture | why it earns a slot |
| --- | --- |
| `full_iguana_non_flat_failing.fold` | the 113 s case; 1,213 faces, 4 planes, the largest thing that exercises the order solve |
| `full_iguana_flat_working.fold` | its flat twin — the only cross-path A/B we have, and what proved the 70× was in the instance rather than the algorithm |
| `cant_fold.fold` | 3 planes, moderate coupling, the case that proved verdicts were starting-face dependent |
| `failed_layer_ordering.fold` | the original false negative |
| `stick_on_a_floor.fold` | coupling-dominated: 2,256 couplings and 2,304 SharedSlot seeds from one 230-crease coincident group. Nothing else has this shape |

**Breadth fixtures — measured to pass at `HEAD` *and* now.** They do not pin any
fix. They are still worth committing: they are cheap, they cover shapes the
regression set does not, and they guard against a *future* break. They must never
be cited as evidence that this session's changes were correct.

| fixture | measured | why it earns a slot |
| --- | --- | --- |
| `successful_layer_ordering.fold` | 21/21 both | the near-twin control that made the twin diff meaningful |
| `stacked_rectangles.fold` | 16/16 both, 1 ms | **every crease is ±90, zero flat folds** — a shape nothing else in the set has, and 16 faces so it sweeps instantly |
| `non-flat-harder_final.fold` | 16/16 both, 7 ms | mid-size, already in the external roster |
| `540-level-0.fold` | 16/16 both, 2 ms | community-authored, explicitly permitted; different provenance from the rest |

I checked these three against `HEAD` specifically because this plan demands it of
new tests, and the same rule applies to fixtures: **a fixture that never failed
does not validate a fix.** All three fold at `HEAD` exactly as they do now.

**Size is not a blocker, because two existing conventions already handle it.**

- `.osf` → `.fold` via `scripts/osf-fold-projection.mjs`, measured on all three
  `.osf` inputs: stick-on-a-floor **868,742 → 59,894**, non-flat-harder_final
  **281,901 → 10,107**, 540-level-0 **280,864 → 6,200**. That script's own doc
  states every fixture under `tests/fixtures/fold-angle-3d/` is derived this way,
  so this is the established path, not a new one.
- Minified JSON: `tests/fixtures/fold-angle-3d/spikes_large.fold` is byte-identical
  to its own minification, so committed fixtures are *already* stored minified.
  There is no `.prettierignore` and no prettier JSON glob that would re-expand
  them — but verify that before committing, since a formatter silently inflating a
  generated asset has bitten this repo before.

Net for all nine: **2.2 MB as-is → ~370 KB.** `tests/fixtures/` is currently
4.1 MB. `stacked_rectangles.fold` alone is 2,246 bytes minified.

Home: `tests/fixtures/fold-angle-3d/` already exists for exactly this and carries a
19 KB README. Either extend it or add a `layer-order/` subdirectory — the README
convention matters more than the directory.

**Not committable, and worth naming so nobody re-litigates it.** The two Naoki
Terao models — `hex pleated pangolin` and `hex head 2` — stay in the private
corpus. They are the best out-of-sample evidence in the investigation (the
pangolin went 372 ms to 42 ms with no regression, and `hex head 2` is the one
model whose `NoLayerOrder` appears to be *true*), and none of that can be pinned
by a committed test. That is an argument for Part 4, not for committing them.

**Provenance file.** `tests/corpus/README.md` states the rule ("not committed
unless their authors explicitly permit redistribution"). Whatever lands needs a
per-file provenance note naming the author and the permission, so the rights claim
is auditable later rather than remembered.

Known provenance:

| fixture | author | permission |
| --- | --- | --- |
| `540-level-0` | [hayashi-stl](https://github.com/hayashi-stl) — an Ori Studio contributor (PR #308) | granted by the repo owner |
| the other eight | repo owner, authored for debugging | own work |

### Part 2 — what the tests assert

Three tiers, cheapest first. Only the second and third are new ideas; the first is
what a normal fixture test would do anyway.

**(a) Outcome roster.** Expected verdict per fixture at the default starting face,
plus faces / variables / components / undetermined. Catches gross regressions and
is nearly free. Model it on `corpus_ordering_reports_every_model`, which already
produces exactly this table for the external corpus — the committed version is the
same harness over a different source.

**(b) Starting-face invariance — the property test this investigation was missing.**
For each fixture, sweep `starting_face_id` and assert **the verdict is constant**.
The layer ordering exists as a property of the folded state; the starting face only
selects which face the placement walk pins, so a face-dependent verdict is always a
solver defect. Every bug found here violated it, and it is the single cheapest
gate against the whole class.

**(b2) Necessity, which nothing checks and which this investigation needed.**
Three fixes were written, measured as load-bearing, and later found to be dead
weight once a fourth landed — two of them were also misreadings of a deliberate
upstream mechanism. Nothing surfaced that; it took a hand-built ablation matrix
run specifically because someone asked. Worth considering a documented ablation
procedure rather than a test: for each opt-in divergence from an upstream port,
record the model that justifies it, and fail review if that model no longer needs
it. A test cannot express this, but a checklist item in the porting docs can.

**(c) Rotation equivariance — the categorical one.**
Apply a random rotation to the placement, re-derive the constraint set, and assert
it is unchanged. This tests the actual invariant — *constraint emission is a
function of the folded geometry up to rigid motion* — rather than a downstream
consequence of breaking it. It needs one fixture and generates unlimited cases, and
it is the only test that would catch the **standing hazard**: `canonical_direction`
still fixes a line's sign by scanning world components against a `1e-12` bar, and
`frame_for` still seeds its perpendicular from the most-perpendicular world axis.
The `extents_overlap` fix removed the consequence we measured; it did not make the
frame choice intrinsic.

**Runtime budget.** Measured worst case is 663 ms per starting face on
`full_iguana`; a full 21-face sweep is ~14 s. Options, in order of preference:
sample starting faces on the two large fixtures and sweep the small ones fully; or
accept ~30 s total, which is in line with the oracle steps already in that job
(10–25 s each). Do **not** assert wall-clock times — a timing-ratio test already
reds this repo's Rust job on unrelated PRs.

### Part 3 — CI

Add to the existing `native-oracle` job, which already runs the Rust suites. No new
environment is needed, because these fixtures are committed — that is the entire
point of Part 1. The `ORACLE_REQUIRED` guard pattern applies only if something is
ever gated on the *external* corpus, which it should not be.

### Part 4 — the external corpus in a fresh worktree

The problem is concrete: the path is machine-local, `scripts/setup-worktree.sh`
cannot export into the caller's shell, and the consequence of that gap was a whole
investigation run without breadth coverage.

**Proposal.** `setup-worktree.sh` looks for the corpus at a small list of
conventional locations, and on finding one writes `tests/corpus/local.env`
(gitignored) containing the export line, then prints it. The corpus harness reads
that file as a **fallback** when the environment variable is unset. That makes it
work for a human running `cargo test` and for an agent, with no shell setup either
way.

The harness keeps its loud-skip behaviour exactly as it is: `SKIPPED:` blocks
naming what was not checked, `corpus_coverage_is_stated` always running, and
`ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1` turning skips into failures. Those four
mechanisms are well designed and are not the problem — the problem is that nothing
ever set the variable.

**If a test reading a config file is unwelcome**, the fallback is for the script to
print the export line and AGENTS.md to document it. That is weaker, and it is
precisely what failed this time, so it should be a deliberate choice rather than a
default.

**Also fix, separately:** `corpus_census_reports_every_model` asserts the corpus
holds 55 distinct model names and the directory now has 93, so it fails on
population rather than behaviour. That assertion is doing real work — it stops
every ratio below it being quoted against a shifting denominator — so it wants
updating, not deleting.

## Affected Areas

- `tests/fixtures/fold-angle-3d/` (or a new `layer-order/` sibling) — six committed
  fixtures plus provenance in the README
- `crates/oristudio-cp/tests/` — a new committed-fixture roster test, the
  starting-face invariance test, and the rotation-equivariance test. The roster
  test should share its shape with `non_flat_corpus.rs`'s existing table rather
  than growing a second one
- `crates/oristudio-cp/tests/non_flat_corpus.rs` — the `local.env` fallback and the
  55 → 93 roster correction
- `scripts/setup-worktree.sh` — corpus detection and `local.env`
- `.gitignore` — `tests/corpus/local.env`
- `.github/workflows/ci.yml` — the new tests in `native-oracle`
- `AGENTS.md` / `tests/corpus/README.md` — document the split: owned fixtures are
  committed and gate CI; third-party breadth is external and local-only

## Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | We commit a model we do not actually have the rights to | The open decision above is a hard gate. Per-file provenance in the README, not a blanket claim |
| R2 | A formatter re-expands the minified fixtures, or a future one starts touching `.fold` | Verify no prettier JSON glob covers them before landing; the repo has already been bitten by a formatter inflating a generated asset |
| R3 | The 21-face sweeps make CI slow enough that someone deletes them | Sample the large fixtures; keep total under ~30 s; never assert wall-clock |
| R4 | The rotation test is flaky on floating point | Compare the constraint set structurally (sorted face tuples), not coordinates, and use a fixed set of rotations rather than a random seed per run |
| R5 | The committed fixtures become the only thing anyone runs, and the external corpus goes dormant again | That is what Part 4 exists for. It is also why `ORISTUDIO_NON_FLAT_CORPUS_REQUIRED` should be part of a release check, not just available |

## Checklist

### Part 0 — the rights decision
- [x] Rights confirmed by the owner for all nine
- [ ] Record per-file provenance (author + permission) in the README
- [ ] Anything not on the list stays external

### Part 1 — fixtures
- [ ] Project the three `.osf` inputs to `.fold` via `scripts/osf-fold-projection.mjs`
- [ ] Verify no formatter glob covers `.fold`; confirm the minified form survives a full `npm run format` / `cargo fmt` cycle
- [ ] Commit the nine, labelled regression vs breadth, with provenance in the README

### Part 2 — tests
- [ ] Outcome roster over the committed fixtures, sharing shape with `corpus_ordering_reports_every_model`
- [ ] Starting-face invariance: verdict constant across starting faces
- [ ] Rotation equivariance: constraint set unchanged under a rigid rotation of the placement
- [ ] Confirm each of the three fails against `HEAD` — a regression test that never failed is not yet a test

### Part 3 — CI
- [ ] Wire into `native-oracle`; measure the added wall-clock and record it

### Part 4 — the corpus
- [ ] `setup-worktree.sh` detects the corpus and writes `tests/corpus/local.env`
- [ ] Harness falls back to `local.env` when the env var is unset
- [ ] `.gitignore` the file; document the split in `AGENTS.md` and `tests/corpus/README.md`
- [ ] Correct the 55 → 93 roster assertion

### Validation
- [ ] `cargo test -p oristudio-cp --release`
- [ ] `ORIEDITA_GEOMETRY_ORACLE=… cargo test … --test oriedita_folding_oracle --test oriedita_render_oracle` — verify it ran (~15 s) rather than skipped (0.00 s)
- [ ] `ORISTUDIO_NON_FLAT_CORPUS_DIR=… ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1 cargo test -p oristudio-cp --test non_flat_corpus`
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`
