# Ori Studio

[![CI](https://github.com/zacharyfmarion/ori-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/zacharyfmarion/ori-studio/actions/workflows/ci.yml)
[![Web](https://img.shields.io/badge/Web-oristudio.pages.dev-brightgreen.svg)](https://oristudio.pages.dev/)
[![Latest Release](https://img.shields.io/github/v/release/zacharyfmarion/ori-studio?display_name=tag)](https://github.com/zacharyfmarion/ori-studio/releases)
[![treemaker-core on crates.io](https://img.shields.io/crates/v/treemaker-core.svg)](https://crates.io/crates/treemaker-core)
[![treemaker-core docs](https://docs.rs/treemaker-core/badge.svg)](https://docs.rs/treemaker-core)

Ori Studio aims to be the ultimate workspace for origami design and analysis. It
combines a modern web and desktop interface with a family of Rust and WebAssembly
engines, and it leans heavily on ports of existing origami tools created by the
community. Robert J. Lang's TreeMaker 5.0.1 is the parity reference for turning a
tree structure into a crease pattern; the Edit workspace is a Rust port of
Oriedita; box-pleated authoring is a Rust port of Box Pleating Studio; and the
Simulate workspace folds bases in 3D with a port of Origami Simulator.

The app is organized around three workspaces that share a single pane-based
surface across browser and desktop:

- **Design** — draw and edit a tree, set paper size, symmetry, and conditions,
  run optimization passes, and build a crease pattern from the optimized tree.
- **Edit** — a full Oriedita-compatible crease-pattern editor with drawing tools,
  snapping, mountain/valley and crease-role coloring, foldability diagnostics,
  repairs, and import/export.
- **Simulate** — an interactive 3D fold of the built or imported crease pattern.

Try the hosted app at [oristudio.pages.dev](https://oristudio.pages.dev/).
Signed Apple Silicon DMGs are published from local notarized builds on
[GitHub Releases](https://github.com/zacharyfmarion/ori-studio/releases).

## Applications

- `apps/web`: the shared React and Vite frontend used by the browser app and the
  Tauri shell.
- `apps/tauri`: the Tauri v2 desktop wrapper for native menus, dialogs, window
  metadata, and packaging.
- `apps/cp-detect-architecture-inspector`: a local debug UI for inspecting the
  crease-pattern detection and compiler pipeline stage by stage.

## Exposed Packages and Crates

### TreeMaker engine crates (crates.io)

- [`treemaker-core`](https://docs.rs/treemaker-core): the native Rust engine API
  for TreeMaker model files, optimization, feasibility checks, crease-pattern
  generation, FOLD conversion, and simulation preparation.
- [`treemaker-cli`](https://crates.io/crates/treemaker-cli): the `treemaker`
  command-line tool for inspecting, checking, optimizing, and exporting models.
- [`treemaker-wasm`](https://docs.rs/treemaker-wasm): `wasm-bindgen` bindings
  that expose the engine to browser and Node workflows.
- [`treemaker-fold`](https://docs.rs/treemaker-fold): generic FOLD data
  structures and geometry helpers for origami applications.
- [`treemaker-flatfold`](https://docs.rs/treemaker-flatfold): flat-foldability
  and layer-order solving for FOLD crease patterns.
- `treemaker-sequence`: research planner primitives for deriving origami
  folding sequences from FOLD crease patterns.

The main TreeMaker engine entry point is
[`Tree`](https://docs.rs/treemaker-core/latest/treemaker_core/struct.Tree.html).

### Ori Studio workspace crates

These crates power the Edit, box-pleating, and detection workflows and live in
the workspace alongside the TreeMaker engine.

- `oristudio-cp`: the Oriedita-compatible crease-pattern editing kernel.
- `oristudio-cp-wasm`: `wasm-bindgen` bindings for the crease-pattern kernel.
- `oristudio-cp-compiler`: the constraint-aware crease-pattern compiler core.
- `oristudio-bp`: the Box Pleating Studio-compatible headless kernel.
- `oristudio-bp-wasm`: `wasm-bindgen` bindings for the box-pleating kernel.
- `oristudio-cp-detect`: browser crease-pattern detection core types and oracle
  fixture plumbing.
- `oristudio-cp-detect-wasm`: `wasm-bindgen` bindings for browser crease-pattern
  detection.
- `oristudio-cp-eval`: crease-pattern evaluation metrics for detection and
  compiler benchmarks.
- `oristudio-cp-detect-inspector`: a local Rust API server backing the detection
  inspector app.

### npm workspace packages

- `@treemaker/web`: the private workspace package for the shared Ori Studio web
  app.
- `@treemaker/tauri`: the private workspace package for the desktop shell.
- `@treemaker/origami-simulator`: the private workspace package that adapts
  Origami Simulator-style folding utilities for FOLD inputs.
- `@treemaker/cp-detect-architecture-inspector`: the private workspace package
  for the crease-pattern detection inspector.

## Engine Capability

The TreeMaker engine supports the TreeMaker 5.0.1 model engine surface:

- Read TreeMaker v3, v4, and v5 files.
- Write canonical v5 files and export v4 files.
- Read and write native `.osf` Ori Studio project files.
- Inspect summaries and crease-pattern status.
- Run the ALM scale, edge-strain, and strain optimizers.
- Build polygons, vertices, creases, facets, fold directions, and facet order.
- Use the engine from native Rust, a CLI, or WebAssembly.

The parity baseline is the public TreeMaker 5.0.1 source with its distributable
ALM optimizer. CFSQP and RFSQP are not included because the public TreeMaker
5.0.1 source does not include redistributable source for those optimizer
backends.

## Getting Started

Install dependencies:

```sh
npm ci
```

Run the web app:

```sh
npm run dev:web
```

Run the desktop app:

```sh
npm run dev:desktop
```

Use the Rust API:

```sh
cargo add treemaker-core
```

Install the command-line tool:

```sh
cargo install treemaker-cli
```

Use the WebAssembly bindings:

```toml
treemaker-wasm = "0.1"
```

## Confidence

The engine is tested against a C++ oracle built from the vendored TreeMaker
5.0.1 source. CI checks the Rust workspace, web client, generated WebAssembly
bindings used by the web client, and oracle parity suite. An external corpus
harness is available for private/user `.tmd`, `.tmd4`, and `.tmd5` collections,
but no real-user corpus files are committed to this repository.

## Development

Useful local checks:

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run lint:web
npm run typecheck:web
npm run test:web
wasm-pack build crates/treemaker-wasm --target bundler
wasm-pack test --node crates/treemaker-wasm
```

Roadmaps live in [`WEB_ROADMAP.md`](WEB_ROADMAP.md) and
[`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md). Release steps live in
[`RELEASE.md`](RELEASE.md). Porting notes live in [`PORTING.md`](PORTING.md).

## Acknowledgements

Ori Studio builds directly on origami tools created by the community:

- [Robert J. Lang and TreeMaker 5.0.1](https://langorigami.com/article/treemaker/)
  — the original model code and behavior are the canonical reference for the
  Rust, WebAssembly, and desktop port.
- [Mu-Tsun Tsai and Box Pleating Studio](https://github.com/bp-studio/box-pleating-studio)
  — the box-pleated authoring method is a Rust and WebAssembly port of Box
  Pleating Studio.
- [Oriedita](https://github.com/oriedita/oriedita) — the crease-pattern editor is
  a Rust and WebAssembly port of the Oriedita editor (itself a fork of Orihime),
  including its foldability diagnostics, repairs, and file formats.
- [Amanda Ghassaei and Origami Simulator](https://github.com/amandaghassaei/OrigamiSimulator)
  — the Simulate workspace folds bases into an interactive 3D model using a
  TypeScript port of Origami Simulator.

## License

This project is `GPL-2.0-or-later` because it includes a direct Rust port of
TreeMaker's GPL model code. See [`LICENSING.md`](LICENSING.md) for the full
licensing guide, including optimizer backend notes and dependency inventory.
