# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

`treemaker-rs` is a Rust, WebAssembly, web, and Tauri port of the engine inside
Robert J. Lang's TreeMaker 5.0.1. TreeMaker turns a tree structure into an
origami crease pattern. The repository currently owns both the engine port and
the shared GUI that exercises it.

The top-level `README.md` is user-facing. Keep architecture notes, porting
discipline, implementation plans, and agent workflow details in developer docs
instead of turning the README into an engineering index.

## Repository layout

```text
crates/
  treemaker-core/   # Rust engine, file I/O, optimizers, geometry, CP generation
  treemaker-cli/    # Headless command-line interface
  treemaker-wasm/   # wasm-bindgen bridge for browser and Node workflows
  oracle-tests/     # C++ oracle parity and fixture tests
apps/
  web/              # React + Vite shared web frontend
  tauri/            # Tauri v2 desktop shell wrapping apps/web
tests/
  fixtures/         # Shared TreeMaker model fixtures
  corpus/           # External corpus harness notes; no private corpus files
tools/
  oracle/           # C++ TreeMaker oracle build support
third_party/
  treemaker-5.0.1/  # Vendored upstream TreeMaker reference source
```

## Key architectural rules

### Porting discipline

- The canonical behavioral reference is `third_party/treemaker-5.0.1`.
- Do not substitute simpler or approximate algorithms for TreeMaker behavior.
  If a TreeMaker operation has not been ported, return
  `TreeError::UnsupportedOperation` instead of inventing a nearby result.
- Preserve documented C++ quirks when they are required for parity.
- Public parity targets TreeMaker 5.0.1's distributable ALM optimizer. CFSQP
  and RFSQP remain out of scope unless compatible redistributable sources and
  license terms are available.
- Real-world user corpus files are not committed. Use the external corpus
  harness before making broad compatibility claims.

Read `PORTING.md` before changing parser, serializer, optimizer, feasibility,
or crease-pattern behavior.

### Rust

- The workspace uses Rust 2024 and `rustfmt` defaults.
- Library code should propagate typed errors. Avoid `unwrap()`, `expect()`, and
  `panic!()` outside tests or deliberately unreachable internal invariants.
- Keep public APIs centered on the `Tree` engine surface unless a lower-level
  abstraction is clearly required by the GUI, CLI, or wasm bridge.
- Add tests near the changed behavior: inline unit tests for small engine logic,
  crate integration tests for public flows, oracle tests for parity-sensitive
  behavior, and fixtures when new file-format cases are needed.
- Do not edit vendored upstream source except for clearly scoped oracle build
  maintenance.

### Web and Tauri

- `apps/web` is the shared React frontend for browser and desktop.
- `apps/tauri` should stay a thin native shell. Tauri owns native menus,
  dialogs, window metadata, capabilities, and desktop packaging; product logic
  should remain in shared frontend or engine code.
- Runtime-specific behavior should flow through platform helpers and shared
  command dispatch rather than duplicated browser and desktop implementations.
- Keep the UI aligned with the roadmap direction: modern pane-based design tool,
  compact controls, quiet inspector panels, and the visual language used by
  Cascade and OpenSCAD Studio.
- Use existing UI primitives, theme tokens, Zustand store slices, and command
  patterns before adding new ones.

## Build commands

```bash
# Rust workspace
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# C++ oracle parity
tools/oracle/build_oracle.sh
TREEMAKER_CPP_ORACLE=tools/oracle/build/treemaker-oracle cargo test -p oracle-tests --test cpp_oracle

# Web client
npm ci
npm run lint:web
npm run typecheck:web
npm run test:web
npm run build:web

# Desktop shell
npm run check:desktop
npm run dev:desktop

# WASM bridge
wasm-pack build crates/treemaker-wasm --target bundler
wasm-pack test --node crates/treemaker-wasm
```

Choose the smallest validation set that covers the files you changed, and
report any skipped checks with the reason.

## Testing

- Rust engine changes generally need `cargo test --workspace`; optimizer,
  file-format, feasibility, and geometry changes often also need oracle parity.
- WASM bridge changes need wasm build coverage and, when behavior changes,
  `wasm-pack test --node crates/treemaker-wasm`.
- Web UI changes need lint, typecheck, and unit tests. Run `npm run build:web`
  when generated wasm bindings, bundling, routing, or production-only behavior
  may be affected.
- Desktop shell changes need `npm run check:desktop`; run the Tauri dev app when
  menu, dialog, filesystem, or window behavior changes.
- Docs-only and workflow-only changes can usually be validated with
  `git diff --check`.

## CI

GitHub Actions runs two main jobs:

- `web-client`: installs Rust and Node, installs `wasm-pack`, runs web lint,
  typecheck, and unit tests.
- `native-oracle`: installs Tauri Linux dependencies, runs Rust format, clippy,
  workspace tests, builds the C++ oracle, and runs oracle parity tests.

Match local validation to the affected CI surface before opening a pull request.

## Common patterns

### Engine parity work

1. Read the corresponding upstream TreeMaker C++ implementation.
2. Add or update focused fixtures when file I/O is involved.
3. Add Rust tests that describe the expected behavior.
4. Run oracle parity when the change affects model semantics.
5. Update `PORTING.md` if the supported parity surface changes.

### GUI work

1. Check `WEB_ROADMAP.md` and `PRODUCT_ROADMAP.md` for the intended product
   direction.
2. Keep browser and Tauri parity in mind from the start.
3. Prefer shared command, runtime, store, and file-service patterns.
4. Avoid pushing product behavior into the Tauri shell unless it is truly native
   shell behavior.

### CP detector eval work

The `create-pattern-detector` ML repo owns deterministic dataset selection for
the native box-pleat eval. This repo owns product-side browser ONNX,
Rust/WASM, and post-processing evals over that selected set. Before changing
box-pleat detector behavior, read
`scripts/cp-detect/README.md#box-pleat-native-eval` and use the ignored
`artifacts/cp-detect-correctness/` tree for generated packs, dense caches, and
reports.

CP detector model assets under `apps/web/public/models/cp-detector-*` are
intentionally gitignored. The current stable product model is the V3 tess15
weighted export in the local `cp-detector-v3` directory, with ONNX SHA-256
`b425cfd6caecde93caa92f0e8952040f5bada0345c5387a222d1fb915e283742`, and the
versioned local copy is `cp-detector-v3-tess15-weighted-20260619`. For a fresh
worktree, copy those ignored directories from the canonical checkout at
`/Users/zacharymarion/Documents/code/tree-maker-rust` or re-export from the
canonical ML checkpoint documented in
`create-pattern-detector/artifacts/checkpoints/runpod-v3-no-guide-grid-close-pair-dense-edges-tess15-weighted-4090.json`.
Then run `node scripts/cp-detect/check-local-model-assets.mjs`; it fails if the
stable local model is missing or stale.

### Release work

Release notes and package workflow details live in `RELEASE.md`. Keep release
changes explicit and validate both Rust and npm surfaces when versions or
artifacts change.

## Implementation plans

When starting a non-trivial feature, refactor, or multi-step architecture
change, create a Markdown plan file in `implementation-plans/` such as
`implementation-plans/save-open-workflow.md`.

Use this format:

- `# <Title>`
- `## Goal`
- `## Approach`
- `## Affected Areas`
- `## Checklist`

Keep the checklist current with `- [x]` as work completes. Do not create a plan
for narrow maintenance such as formatting cleanup, typo fixes, docs-only edits,
or CI-only adjustments unless the user explicitly asks for one.

## Parallel agents

Multiple AI agents may be working on this repository at the same time. If you
encounter unexpected changes, new files, or errors that you did not introduce,
ignore unrelated changes and move on. Do not delete, revert, or fix another
agent's work unless the user explicitly asks you to work in that area.

## Pull requests

Unless the user explicitly says otherwise, open pull requests against `main`.
Default to draft PRs for agent-created changes.

For end-to-end implementation requests such as `/create <prompt>`, "build this
feature end-to-end", or "take this from plan to PR", use the repo-local
`create-feature` skill under `.agents/skills/create-feature/`. That workflow
owns planning, implementation, validation selection, draft PR creation, and PR
handoff notes.
