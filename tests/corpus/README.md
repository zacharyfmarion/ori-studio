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

The harness intentionally does not claim solved folded-geometry persistence for
`.ori` or `.orh`, because the Oriedita save formats preserve folded model
preferences, not the full solved folded figure list. Generated solved snapshots
are covered by the `.osf` project tests and Oriedita folded render oracle tests.

Last public micro-corpus run on June 24, 2026:

```text
scanned=4 cp=1 fold=1 ori=1 orh=1 folded_form_frames=1 fold_files_with_frames=1 ori_metadata_keys=1 orh_folded_color_sections=1
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
