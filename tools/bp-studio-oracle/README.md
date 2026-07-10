# Box Pleating Studio Oracle

This directory contains the staged oracle harness for the Box Pleating Studio
Rust port.

The oracle reads the pinned upstream snapshot vendored at
`third_party/box-pleating-studio`. Initial commands verify the vendored
baseline and generate the source-map/parity matrix used by
`implementation-plans/box-pleating-studio-rust-port.md`. Later stages should
extend this harness with fixture, command-trace, optimizer, and random-tree
packing commands.

Commands:

```sh
node tools/bp-studio-oracle/oracle.mjs version
node tools/bp-studio-oracle/oracle.mjs source-map
node tools/bp-studio-oracle/oracle.mjs source-map --format markdown
node tools/bp-studio-oracle/oracle.mjs optimizer-solve tests/fixtures/bp-studio/optimizer.one-flap.request.json --seed 0
```

Use Bun for custom oracle commands when possible:

```sh
bun tools/bp-studio-oracle/oracle.mjs version
```

Keep Node/pnpm available for upstream Mocha and build-tool compatibility.
Oracle-gated Rust tests should remain optional and skip cleanly when
`BP_STUDIO_ORACLE` is not configured.

`optimizer-solve` runs the pinned single-thread BP Studio optimizer artifact
from `lib/optimizer/dist` by default and returns the bridge-shaped optimizer
data, raw result vector, decoded result, logs, and progress events. Use
`--artifact debug` to run the debug artifact instead. The command defaults to
seed `0`; pass `--seed <uint>` for other deterministic oracle cases.
