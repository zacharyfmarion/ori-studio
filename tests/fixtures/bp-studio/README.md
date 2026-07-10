# Box Pleating Studio Fixtures

Fixtures in this directory seed the `oristudio-bp` parity work.

- `sample.tmd5`: upstream TreeMaker v5 import sample copied from the pinned Box
  Pleating Studio snapshot.
- `v04.session.sample.json`: historical BP Studio session sample for migration
  coverage.
- `valid-packing.sample.json`: compact BP project with a generated CP preview
  for browser/UI regression checks.
- `stretch-workflow.sample.json`: nonzero-dimension BP project with active
  stretch repositories for manual packing and interaction regression checks.
- `v07.troll.sample.json`: hard-limit migration/check sample.
- `optimizer-simple-request.json`: deterministic optimizer smoke request based
  on BP Studio's upstream optimizer spec.
- `random-tree-batch.json`: deterministic batch manifest for future random-tree
  packing oracle work.

The vendored upstream snapshot under `third_party/box-pleating-studio` remains
the behavioral source of truth. These copies make Rust and WASM tests
self-contained and keep fixture intent explicit.
