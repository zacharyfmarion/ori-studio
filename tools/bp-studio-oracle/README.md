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
array of edits applied in order:

| edit | meaning |
| --- | --- |
| `{ "op": "moveFlap", "id", "x", "y" }` | drag a flap |
| `{ "op": "completeStretch", "id" }` | what selecting a stretch does |
| `{ "op": "switchConfig", "id", "to" }` | pick another configuration |
| `{ "op": "switchPattern", "id", "to" }` | pick another pattern |

Output is canonical (sorted-key) JSON so it diffs cleanly against the Rust
snapshot, and includes a `stretches` map of per-stretch config/pattern counts
and indices so selection state can be diffed and not just drawn geometry. It
must be run with Bun so the vendored TypeScript Core resolves via the sibling
`tsconfig.json`.

Two things about this harness are load-bearing, and it got both wrong until
2026-08-13 — during which it reproduced, inside the oracle, the very staleness
it was supposed to detect:

- **Edits send `stretches: []`.** The client sends
  `design.$prototype.layout.stretches`, and `$resetPrototype()` empties that
  after every core response, so an edit carries no prototype. Sending the
  design's stretches keeps feeding the loaded repository back in, which pins
  every stretch to its stored configuration.
- **No re-init before printing.** A fresh `DesignController.init` recomputes
  every stretch from scratch, overwriting exactly the state an edit sequence
  exists to expose.

The Rust side of the same comparison is the `layout_graphics_dump` example,
which prints `project_graphics_snapshot` for a `.bps` or JDesign file:

```sh
cargo run -p oristudio-bp --example layout_graphics_dump -- <design.bps>
```

Run both over one file to localize a packing-pane divergence to a tag — a flap
(`f<id>`), a river (`re<a>,<b>`), or a stretch device (`s<flaps>.<index>`). Note
the two disagree harmlessly in two places: contour rings may start at a
different vertex of the same cycle, and the oracle emits an empty `root` entry.

## Stretch file-form oracle

`stretch-file-form.ts` applies the same edit vocabulary and then emits the
design the way upstream writes it to a `.bps` — the ground truth for
`BpProjectSession::project_for_file`. Upstream's file serialization is
`Project.toJSON()` with no `session` flag, so it drops `history`, `state`, and
every stretch's `repo`, keeping `{id, configuration, pattern}`.

```sh
bun tools/bp-studio-oracle/stretch-file-form.ts <design.json> [edits.json] > saved.json
bun tools/bp-studio-oracle/layout-graphics.ts saved.json
```

**Run the reload as a separate process.** `DesignController.init` does not clear
`State.$stretches`, so a second `init` in one process reuses the previous
`Stretch` object and its repository — you measure the state you were trying to
leave behind rather than the state the file restores. This produced a wrong
answer once already; the two-command form above is the fix.

See `crates/oristudio-bp/tests/stretch_file_prototype.rs` for the Rust side, and
`implementation-plans/bp-stretch-repository-invalidation.md` for why the file
form matters (a stored `repo` freezes the configuration set; a
`configuration` + `pattern` prototype does not).

Keep Node/pnpm available for upstream Mocha and build-tool compatibility.
Oracle-gated Rust tests should remain optional and skip cleanly when
`BP_STUDIO_ORACLE` is not configured.

`optimizer-solve` runs the pinned single-thread BP Studio optimizer artifact
from `lib/optimizer/dist` by default and returns the bridge-shaped optimizer
data, raw result vector, decoded result, logs, and progress events. Use
`--artifact debug` to run the debug artifact instead. The command defaults to
seed `0`; pass `--seed <uint>` for other deterministic oracle cases.
