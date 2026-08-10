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

## Layout graphics oracle

`layout-graphics.ts` runs the headless BP Studio Core (`DesignController`) to
emit ground-truth layout graphics — per-flap contours and ridges — for a design
plus an optional sequence of manual edits. This is the oracle that the Rust
engine's `project_graphics_snapshot` / `move_flap` output must match (see the
oracle-parity tests `crates/oristudio-bp/tests/manual_flap_move.rs` and
`starter_seed.rs`).

```sh
bun tools/bp-studio-oracle/layout-graphics.ts <design.json> [edits.json]
```

`<design.json>` is a JDesign (`{ tree, layout }`); `[edits.json]` is an optional
array of `{ "op": "moveFlap", "id", "x", "y" }` applied in order. Output is
canonical (sorted-key) JSON so it diffs cleanly against the Rust snapshot. It
must be run with Bun so the vendored TypeScript Core resolves via the sibling
`tsconfig.json`.

The Rust side of the same comparison is the `layout_graphics_dump` example,
which prints `project_graphics_snapshot` for a `.bps` or JDesign file:

```sh
cargo run -p oristudio-bp --example layout_graphics_dump -- <design.bps>
```

Run both over one file to localize a packing-pane divergence to a tag — a flap
(`f<id>`), a river (`re<a>,<b>`), or a stretch device (`s<flaps>.<index>`). Note
the two disagree harmlessly in two places: contour rings may start at a
different vertex of the same cycle, and the oracle emits an empty `root` entry.

Keep Node/pnpm available for upstream Mocha and build-tool compatibility.
Oracle-gated Rust tests should remain optional and skip cleanly when
`BP_STUDIO_ORACLE` is not configured.

`optimizer-solve` runs the pinned single-thread BP Studio optimizer artifact
from `lib/optimizer/dist` by default and returns the bridge-shaped optimizer
data, raw result vector, decoded result, logs, and progress events. Use
`--artifact debug` to run the debug artifact instead. The command defaults to
seed `0`; pass `--seed <uint>` for other deterministic oracle cases.
