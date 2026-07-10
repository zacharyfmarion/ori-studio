# oristudio-bp

`oristudio-bp` is the Rust port of Box Pleating Studio's non-UI functionality.
It owns the headless model/session layer used by the Ori Studio browser and
desktop Box Pleat workflow.

Implemented surface:

- BP Studio project DTOs, historical migrations, `.bps` JSON, and `.bpz`
  workspace archives.
- Direct BP Studio TreeMaker v5 import.
- Session/update commands for BP tree authoring, flap/rivers/sheet edits,
  stretch repository completion, config/pattern navigation, device movement,
  undo/redo, and stale-state tracking.
- Layout geometry, graphics primitives, invalid-junction diagnostics, packing
  validation, BP crease-pattern generation, and CP/FOLD export.
- A Rust/WASM SLSQP-style optimizer path with request/result validation and
  deterministic oracle fixtures.
- Typed `Unsupported`/`UpstreamGap` status for BP Studio TODO paths that should
  not be approximated.

The frontend uses `crates/oristudio-bp-wasm` through a browser worker. Public UI
code should treat the worker snapshots as the contract and avoid constructing
low-level BP internals by hand.

Optimizer parity is validity-based rather than coordinate-identity-based:
valid Rust packings may differ from BP Studio's exact placement as long as the
request-aware validator accepts the result. Exact coordinate parity remains an
oracle/debug aid, not the user-facing success criterion.

Useful checks:

```sh
cargo test -p oristudio-bp
wasm-pack test --node crates/oristudio-bp-wasm
npm run test:bp-ui-regression
```

The implementation roadmap lives in:

- `implementation-plans/box-pleating-studio-rust-port.md`
- `implementation-plans/box-pleating-studio-source-map.md`
- `implementation-plans/box-pleating-studio-ui-integration.md`
- `implementation-plans/box-pleating-studio-ui-source-map.md`
