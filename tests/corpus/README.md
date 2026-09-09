# External Corpus Testing

Real-user TreeMaker documents are intentionally not committed here unless their
authors explicitly permit redistribution. Keep large/private corpora outside the
repository and point the harness at those paths.

Useful commands:

```sh
cargo run -p treemaker-cli -- corpus /path/to/private/corpus --format json
cargo run -p treemaker-cli -- corpus /path/to/private/corpus --oracle tools/oracle/build/treemaker-oracle
TREEMAKER_CORPUS_DIR=/path/to/private/corpus TREEMAKER_CPP_ORACLE=tools/oracle/build/treemaker-oracle cargo test -p oracle-tests --test corpus -- --nocapture
```

The corpus command recursively scans `.tmd`, `.tmd4`, and `.tmd5` files,
deduplicates them by SHA-256, parses with the Rust engine, round-trips through
canonical v5 output, and optionally compares C++ oracle summaries.

## Oriedita Folded-Document Corpus Testing

The Oriedita folded-document harness scans `.cp`, `.fold`, `.ori`, and `.orh`
files. It always runs the checked-in public micro-corpus under
`tests/fixtures/oriedita`, and it can also scan a private corpus path.

Useful commands:

```sh
cargo test -p oristudio-cp --test oriedita_folded_document_corpus -- --nocapture
ORIEDITA_FOLDED_CORPUS_DIR=/path/to/private/oriedita-corpus \
  cargo test -p oristudio-cp --test oriedita_folded_document_corpus -- --nocapture
ORIEDITA_NATIVE_IO_ORACLE=tools/oriedita-oracle/build/oriedita-native-io-oracle \
  ORIEDITA_IO_ORACLE=tools/oriedita-oracle/build/oriedita-geometry-oracle \
  cargo test -p oristudio-cp --test oriedita_folded_document_corpus -- --nocapture
```

The harness validates the supported folded-document surface:

- `.fold` files parse and reserialize without dropping `file_frames`,
  `foldedForm` frames, `faceOrders`, frame parent/inherit metadata, or unknown
  extension fields represented by the preserving FOLD model.
- `.ori` files parse with Oriedita's open-anyway version behavior, reserialize
  as the supported save version, and preserve unknown Oriedita metadata such as
  folded model preference objects.
- `.orh` files parse, reserialize, and preserve Oriedita's legacy
  `<oriagarizu>` folded-view front/back/line color metadata.
- When the relevant oracle env vars are set, `.ori` and `.orh` imports are
  checked against Oriedita summaries. FOLD files with embedded `file_frames` are
  counted as oracle-unsupported because the pinned Oriedita `fold` dependency
  rejects `file_frames`; Rust preservation remains covered by the round-trip
  check.

The harness intentionally does not claim solved folded-geometry persistence for
`.ori` or `.orh`, because the Oriedita save formats preserve folded model
preferences, not the full solved folded figure list. Generated solved snapshots
are covered by the `.osf` project tests and Oriedita folded render oracle tests.

Last public micro-corpus run on June 30, 2026 with native and legacy Oriedita
IO oracles enabled:

```text
Oriedita folded-document corpus: scanned=4 imported=4 exported=4 roundtripped=4 failures=0
  cp: scanned=1 imported=1 exported=1 roundtripped=1 failed=0
  fold: scanned=1 imported=1 exported=1 roundtripped=1 failed=0
  ori: scanned=1 imported=1 exported=1 roundtripped=1 failed=0
  orh: scanned=1 imported=1 exported=1 roundtripped=1 failed=0
  fold_frames total=2 foldedForm=1 files_with_frames=1 max_depth=2 extra_keys=1 oriedita_extension_keys=1 frame_parent=1 frame_inherit=1 faceOrders=1
  ori_metadata keys=1 camera=0 canvas=0 foldedFigure=1 application=0 unknown=0 preserved_only=0 nested_model_keys=5 missing_versions_opened=0 unknown_versions_opened=0
  orh folded_color_files=1 folded_color_sections=3
  oracle checked=2 mismatches=0 unavailable=0 unsupported=1
```

Last external `origami-designer` corpus run on July 6, 2026 with native and
legacy Oriedita IO oracles enabled:

```text
Oriedita folded-document corpus: scanned=30 imported=30 exported=30 roundtripped=30 failures=0
  cp: scanned=4 imported=4 exported=4 roundtripped=4 failed=0
  fold: scanned=14 imported=14 exported=14 roundtripped=14 failed=0
  ori: scanned=11 imported=11 exported=11 roundtripped=11 failed=0
  orh: scanned=1 imported=1 exported=1 roundtripped=1 failed=0
  fold_frames total=15 foldedForm=1 files_with_frames=1 max_depth=2 extra_keys=18 oriedita_extension_keys=8 frame_parent=1 frame_inherit=1 faceOrders=2
  ori_metadata keys=41 camera=10 canvas=10 foldedFigure=11 application=10 unknown=0 preserved_only=30 nested_model_keys=345 missing_versions_opened=0 unknown_versions_opened=0
  orh folded_color_files=1 folded_color_sections=3
  oracle checked=25 mismatches=0 unavailable=0 unsupported=1
```

## Flat-Folder Corpus Testing

The Flat-Folder port uses Jason Ku's JavaScript implementation vendored at
`third_party/flat-folder` as the oracle. The wrapper lives at
`tools/flat-folder-oracle/oracle.mjs`.

Useful commands:

```sh
cargo run -p treemaker-cli -- flatfold tests/fixtures/flat-folder/kabuto.fold --limit 10 --format json
FLATFOLDER_ORACLE=tools/flat-folder-oracle/oracle.mjs cargo test -p oracle-tests --test flat_folder_oracle
FLATFOLDER_CORPUS_DIR=/Users/zacharymarion/Documents/datasets/create-pattern-detector/synthetic/cp_training_mix_v1/folds \
  FLATFOLDER_ORACLE=tools/flat-folder-oracle/oracle.mjs \
  cargo test -p oracle-tests --test flat_folder_corpus -- --nocapture
```

If `FLATFOLDER_CORPUS_DIR` is unset, the corpus test uses the local
`cp_training_mix_v1/folds` path above when it exists. The scanner follows
symlinks, keeps the symlink path as the case ID, and deduplicates by target
content SHA-256.

`FLATFOLDER_SOLVE_LIMIT` accepts `all`, `1`, `10`, `100`, or `1000`; the default
is `10`. `FLATFOLDER_CORPUS_MAX_CASES` can cap a local diagnostic run while
still scanning and reporting total corpus size. Full uncapped corpus validation
is intentionally opt-in and can take a long time because every unique case is
also solved by the JavaScript oracle.

The corpus harness fails on Rust/JavaScript status mismatches, constraint count
mismatches, component-size or solution-count mismatches, and first-solution
`faceOrders` hash mismatches.

## FOLD Frame-Shape Corpus Testing

`file_frames` makes a FOLD document a tree of frames, and the importer has to
pick the one carrying the crease pattern. The checked-in shapes live in
`tests/fixtures/fold-frames` (see its README) and always run:

```sh
cargo test -p oristudio-cp --test fold_frame_corpus
```

To measure the importer against a larger third-party corpus — which is *not*
committed, for the usual reason plus a licence one, both noted in that README —
point the opt-in scan at a local checkout:

```sh
FOLD_FRAME_CORPUS_DIR=/path/to/fold/files \
  cargo test -p oristudio-cp --test fold_frame_corpus -- --nocapture
```

The scan reports per-file import results and a total rather than asserting: a
real corpus deliberately contains invalid documents (abstract graphs, edge-less
frames), so a nonzero failure count is information rather than a regression. The
committed fixtures are the gate.

## Non-Flat Corpus Testing (3D fold angles)

Crease patterns whose creases carry non-180° fold angles are what the computed
3D folded state reads, and there is almost none of it in the wild — every
`.fold` in the largest public collection carries only `0` and `±180`. The
material that does exist is a mix of the repo owner's own Ori Studio designs and
third-party patterns, so it lives outside git for the usual reason plus a
licence one.

The **committed** subset — the owner's own designs, nine files — is
`tests/fixtures/fold-angle-3d/` (see its README for the rule on what may go
there, and the recorded verdict of each). It always runs and it is the gate:

```sh
cargo test -p oristudio-cp --test verify_fold_fixtures
```

The **external** corpus adds breadth plus the one asset that cannot be committed
at all — the Mooser's Train 0%/100% pair, the only ground-truth folded state
within reach:

```sh
ORISTUDIO_NON_FLAT_CORPUS_DIR=/path/to/non-flat \
  cargo test -p oristudio-cp --test non_flat_corpus -- --nocapture
```

It scans `.fold` files and reads `.osf` projects directly (from
`workspace.documents[0].creasePattern.foldProjection`), recursively.

### Skipping is loud here, deliberately

`grep -rn ORIEDITA .github/workflows/` returns nothing, and roughly 62 Oriedita
parity tests print "skipping … is not set" and **pass** in every CI run because
of it. Green there means nothing was checked and nothing says so. This harness
is built so that cannot happen:

- The load-bearing assertions are on committed fixtures and need no environment.
  Nothing behind the variable is the only coverage of anything.
- Every skip prints a greppable `SKIPPED:` block naming the test, the variable
  and what was not checked. `corpus_coverage_is_stated` always runs and prints
  the whole roster.
- `ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1` turns every skip into a failure, which
  is the form CI or a release check can demand. A failing test's output is never
  captured, so the message is visible without `--nocapture`.
- A variable that points at a missing directory, or at one holding no `.fold` or
  `.osf`, **fails** rather than skipping. "The variable is set" and "the
  variable points at the corpus" are different claims and only the second buys
  coverage.

The scan itself reports rather than gates: much of the corpus is converted from
Origami Simulator SVGs whose fold angles are relaxation targets rather than
solved states, so closure failures there are a fact about the input. The
landmark test is what proves the harness is reading the corpus at all.

### Reproducing the 3D measurements

The census, the placement loop gap and the parallel-plane separation spectrum —
the three numbers the 3D-fold plan's decisions rest on — come out of one command:

```sh
cargo run -p oristudio-cp --release --example fold3d_census -- \
    tests/fixtures/fold-angle-3d
ORISTUDIO_NON_FLAT_CORPUS_DIR=/path/to/non-flat \
  cargo run -p oristudio-cp --release --example fold3d_census -- --corpus
```

Add `--csv` for machine-readable rows, `--flatcheck` to compare the placement
against the shipped flat folder on all-classic documents, `--sweep` for the
census under a plane-tolerance sweep, and `--selftest` for the polygon-overlap
primitive.

## CP-detect curated corpus

Real inputs to the detect dialog with truth a person established in the editor
(`curated/`), and native crease patterns rendered the way the editor exports
them and filtered to the ones that fold flat (`cpoogle/`); other designers'
patterns, so the corpus stays outside the repository. Point the harness at it
with `CP_DETECT_CURATED_CORPUS_DIR` and compare against the committed
scorecard, `cp-detect-curated-baseline.json` in this directory. Usage and the
scoring are in `scripts/cp-detect/README.md`, the case format in
`implementation-plans/cp-detect-curated-ground-truth.md` and the rendered
group in `implementation-plans/cp-detect-rendered-corpus.md`.

Last curated run on September 9, 2026 at the commit that put the solve on
a work budget (`--budget-work`, below), on top of the junction lever — the
junction peak floor at 0.25 with the weak-peak guards in
`crates/oristudio-cp-detect/src/candidate_generation/junction_carrier_v1.rs`
— the strict `recovered`, the paper-quad fix in the auto-rectifier
(`crates/oristudio-cp-detect/src/rectify.rs`) and the boundary-contact
re-localisation with its real-image hardening
(`crates/oristudio-cp-detect/src/candidate_generation/contact_relocalize.rs`),
with the model `scripts/cp-detect/current-model.json` named at that commit,
on an Apple Silicon Mac with CoreML, 608 s on 8 workers with nothing else
running. 558 cases in two
```text
curated benchmark: 558 cases | decoder exact 346 of 539 (mean edge F1 0.966) | end to end recovered 332 | gate reproduced 441 | 608s
  curated: decoder exact 18 of 61 (mean edge F1 0.944); end to end recovered 18, accepted wrong 16, not accepted 6; gate reproduced 34, close 3, off 2, not solved 10, skipped 1, solved without a truth 11
  cpoogle: decoder exact 328 of 478 (mean edge F1 0.969); end to end recovered 314, accepted wrong 120, not accepted 42, skipped 6; gate reproduced 407, close 14, off 3, not solved 12, error 13, skipped 35
```

`recovered` is strict since September 9, 2026: accepted **and** the strict
topology metric at 2 px finds the truth's vertices, creases and assignments
in the solved answer. The vertex-correspondence verdict it replaces (every
paired vertex within 2 px, no junction unpaired) read 339 on this same run,
32 rendered cases and 3 real images of them accepted on a different crease
set or with wrong assignments; the numbers below from before that date are
in the old verdict where they say `recovered`.

Against the September 5 baseline (decoder exact 274, recovered 317): the
re-localisation of boundary contacts onto the crease's ink centreline moved 42
rendered cases (40 from near, two from off) and one real image to an exact
decode and 27 rendered cases from accepted-wrong to a strict, topology-exact
convergence, and gave back five. Four are the solver landing on another
exact configuration — wind-dragon, e-e-by-birb, nazgul-8-1 and
velociraptor, each with the same or an exact recognised topology whose
vertices moved under 1.2 px and a solve 2 px away across a sliding group,
the noise described below — and on reza-squirrel-1 a correct merge of a
doubled contact makes selection keep three auxiliary-line creases the
baseline had left out, so the solve is refused. Four real images (halibut,
markhor, volant-penguin, reza-squirrel-1) read `near` instead of `exact` at
the decoder and zebra-naoki-terao `off` instead of `near`, all with their
solved answer unchanged: their truths are the detection fixed up by eye and
carry the contact head's own positions, which the change moves by 2–3 px on
shallow creases. For contact placement this group is a regression test
against main's output, not a truth; the check that can judge it reads the
ink (`scripts/cp-detect/contact_ink_referee.py`, in
`scripts/cp-detect/README.md`), and on the real images the corrected
contacts sit 0.24 px from the crease's centreline against the head's 0.95.
The mechanism and the measurements are in
`implementation-plans/cp-detect-boundary-contact-decode.md`.

The paper-quad fix then took the nine real images whose auto-rectified
frame had one edge 3–7% out (the panel finder had ranked the true paper
first and preferred a larger box one edge wider; two more were the
full-frame shortcuts swallowing a 1.5–2.5% inset) from a decoder edge F1 of
0.01–0.24 to 0.82–1.00: common-wildebeest to an exact decode and a strict
convergence, ubu to a convergence, roadrunner to `recovered`, turkey-vulture
to `near`, the rest to ordinary detection cases. The curated group's mean
decoder edge F1 went 0.818 → 0.943 and its `recovered` 18 → 21, with no
rendered case touched; the diagnosis and the two forms of the rule the
rendered group rejected are in
`implementation-plans/cp-detect-rectify-paper-quad.md`.

The junction lever then took the decoder from 314 to 346 exact (29 near →
exact, 3 off → exact, 2 off → near, none the other way) and strict
`recovered` from 306 to 332: 29 conversions, cordyceps-ant among them,
against three losses. pegasus-naoki-terao's caption text under the paper
now yields two junction peaks and its solve ends ambiguous; squid and
tabby-cat have recognised graphs unchanged to the vertex and solves that
land elsewhere (ambiguous, and a different exact configuration 22 creases
apart) — the free-slide noise below, set off by the sub-pixel shift the
lower vote threshold gives every junction's centroid. The sweeps that chose
the guards are in `implementation-plans/cp-detect-junction-weak-peaks.md`.

The solve runs on a work budget, not a clock, since September 9, 2026:
5·10⁸ vertex²·checks by default (`--budget-work`), the 25 s the old clock
allowed at the corpus's median rate, so the same input stops at the same
place on any machine under any load. The clock had made the verdicts follow
the load — a contended run turned pseudoscorpion's 6 s solve into `failed`
where the same input solves and is recovered alone. The wall time still
follows the load (the same code ran in 568 s alone and 918 s beside a wasm
build), so run alone when the seconds matter, and read a slowdown against
`detection.inference_ms`, the same work every run. The product's own solve
has no deadline (it toasts a long solve and offers Stop), so a solve the
harness ends `ambiguous` at the budget may finish for a user.

The 13 gate errors are the solver's input builder refusing a paper it does
not support (7 non-square, 5 not a four-corner quadrilateral, 1 degenerate
edge). Seven of the rendered group's `not solved` gates are one solver
target: an already-exact pattern refused as `kawasaki_regressed_from_bar`
with its answer 0.0 px from the truth, the crocodile finding of the curated
group, now with seven reproductions.
