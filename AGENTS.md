# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

**Ori Studio** is a workspace for origami design and analysis: a React/Tauri
frontend over a family of Rust and WebAssembly engines. The GitHub repository is
`zacharyfmarion/ori-studio`; some local clones and internal package names still
carry the older `treemaker-rs` / `@treemaker/*` naming, which is historical and
does **not** mean the product is TreeMaker.

The product is built largely from ports of existing community origami tools,
each of which is a distinct upstream with its own parity obligations:

- **Oriedita** — the crease-pattern editing kernel, and the bulk of the app's
  functionality (`crates/oristudio-cp*`).
- **TreeMaker 5.0.1** (Robert J. Lang) — turns a tree structure into a crease
  pattern (`crates/treemaker-*`). One tool within the app, not the app.
- **Box Pleating Studio** — box-pleating design kernel (`crates/oristudio-bp*`).
- **Flat-Folder** (Jason S. Ku) — flat-foldability and layer ordering
  (`crates/treemaker-flatfold`).

Original functionality is built on top of the ports — reference images beside
crease patterns, crease-pattern detection from images, the origami simulator,
folding-sequence research — but compatibility with the upstream tools and their
file formats is a priority.

When naming things in new code and docs, use **Ori Studio** for the product, and
an upstream's name only when referring to that specific tool, port, or vendored
source.

The top-level `README.md` is user-facing. Keep architecture notes, porting
discipline, implementation plans, and agent workflow details in developer docs
instead of turning the README into an engineering index.

## Repository layout

```text
crates/
  # Oriedita-derived crease-pattern editing (the core of the app)
  oristudio-cp/                   # Oriedita-compatible CP editing kernel
  oristudio-cp-wasm/              # wasm-bindgen bridge for the CP kernel
  oristudio-cp-compiler/          # Constraint-aware CP compiler core
  # Crease-pattern detection from images
  oristudio-cp-detect/            # Detection core types + oracle fixture plumbing
  oristudio-cp-detect-wasm/       # wasm-bindgen bridge for browser detection
  oristudio-cp-detect-inspector/  # Local API server for inspecting detect stages
  oristudio-cp-eval/              # Evaluation metrics for detection + compiler benchmarks
  # Box Pleating Studio port
  oristudio-bp/                   # BP-compatible headless kernel
  oristudio-bp-wasm/              # wasm-bindgen bridge for the BP kernel
  # TreeMaker 5.0.1 port
  treemaker-core/                 # Engine, file I/O, optimizers, geometry, CP generation
  treemaker-cli/                  # Headless command-line interface
  treemaker-wasm/                 # wasm-bindgen bridge for browser and Node
  # Shared / research
  treemaker-fold/                 # Generic FOLD data structures and geometry helpers
  treemaker-flatfold/             # Flat-foldability and layer-order solver (Flat-Folder port)
  treemaker-sequence/             # Folding-sequence planner primitives (research)
  oracle-tests/                   # Parity + fixture tests against every vendored oracle
apps/
  web/                            # React + Vite shared web frontend
  tauri/                          # Tauri v2 desktop shell wrapping apps/web
  cp-detect-architecture-inspector/  # Dev tool for CP-detection model architecture
packages/
  origami-simulator/              # TS origami simulator (port of Ghassaei's Origami Simulator)
tests/
  fixtures/                       # Shared model fixtures
  corpus/                         # External corpus harness notes; no private corpus files
tools/
  oracle/                         # C++ TreeMaker oracle build support
  oriedita-oracle/                # Oriedita (Java) parity oracle
  bp-studio-oracle/               # Box Pleating Studio parity oracle
  flat-folder-oracle/             # Flat-Folder parity oracle
third_party/
  oriedita/                       # Vendored Oriedita reference source
  treemaker-5.0.1/                # Vendored TreeMaker reference source
  box-pleating-studio/            # Vendored Box Pleating Studio reference source
  flat-folder/                    # Vendored Flat-Folder reference source
scripts/                          # Release, worktree setup, CP-detect tooling
research/                         # Investigation write-ups
implementation-plans/             # Per-feature plans (see "Implementation plans")
```

Note the `oristudio-*` / `treemaker-*` crate split is by **upstream lineage**,
not by importance: `treemaker-*` crates are the TreeMaker port plus some shared
FOLD/geometry code that predates the rename.

## Key architectural rules

### Porting discipline

Each ported subsystem has its own upstream, and that upstream — not our own
prior behavior — is the canonical behavioral reference:

| Subsystem | Vendored reference | Oracle |
| --- | --- | --- |
| CP editing (`oristudio-cp*`) | `third_party/oriedita` | `tools/oriedita-oracle` |
| TreeMaker (`treemaker-*`) | `third_party/treemaker-5.0.1` | `tools/oracle` (C++) |
| Box pleating (`oristudio-bp*`) | `third_party/box-pleating-studio` | `tools/bp-studio-oracle` |
| Flat folding (`treemaker-flatfold`) | `third_party/flat-folder` | `tools/flat-folder-oracle` |

General rules, which apply to every port:

- Read the upstream implementation before changing ported behavior. If a vendored
  reference is missing for something you are porting, vendor it first.
- Do not substitute simpler or approximate algorithms for upstream behavior. If
  an operation has not been ported, return an explicit unsupported-operation
  error (e.g. `TreeError::UnsupportedOperation`) instead of inventing a nearby
  result.
- Preserve documented upstream quirks when they are required for parity.
- Do not edit vendored upstream source except for clearly scoped oracle build
  maintenance.
- Real-world user corpus files are not committed. Use the external corpus
  harness before making broad compatibility claims.

TreeMaker-specific: public parity targets TreeMaker 5.0.1's distributable ALM
optimizer. CFSQP and RFSQP remain out of scope unless compatible redistributable
sources and license terms are available.

Read `PORTING.md` before changing parser, serializer, optimizer, feasibility,
or crease-pattern behavior.

### Rust

- The workspace uses Rust 2024 and `rustfmt` defaults.
- Library code should propagate typed errors. Avoid `unwrap()`, `expect()`, and
  `panic!()` outside tests or deliberately unreachable internal invariants.
- Keep public APIs centered on each crate's primary engine surface (the `Tree`
  surface in `treemaker-core`, the document/kernel surface in `oristudio-cp` and
  `oristudio-bp`) unless a lower-level abstraction is clearly required by the
  GUI, CLI, or wasm bridge.
- Add tests near the changed behavior: inline unit tests for small engine logic,
  crate integration tests for public flows, oracle tests for parity-sensitive
  behavior, and fixtures when new file-format cases are needed.

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

### Panel components

Panels under `apps/web/src/components/panels/` are **composition sites**: they
choose which surfaces mount and wire them together. They are not where behavior
accumulates. `max-lines` is enforced on them — see below for what that does and
does not mean.

Before adding state, a ref, an effect, a memo, or an event listener to a panel,
place it:

| What you are adding | Where it goes |
| --- | --- |
| A keyboard shortcut, of any kind | `apps/web/src/keyboard/` — register it in the shortcut registry, implement it in the surface's executor. Never a `keydown` listener on the panel container. |
| The set of verbs a thing offers (toolbar + context menu + menu bar) | A React-free, store-free action catalog returning plain descriptors, next to that thing's modules. `cp-workspace/folded/foldedFigureActions.ts` is the reference implementation. |
| Store bindings for those verbs, or state and derived data for one concern | A `use*` hook beside that concern's modules — `cp-workspace/<concern>/use*.ts`. `hooks/useViewportSurface.ts` is the shape to copy. A `useMemo` whose body is a bag of store callbacks belongs here, not in the panel. |
| Pure geometry or model logic | That concern's module, with unit tests. |
| Presentation | A child component. |

CP-specific modules live under `cp-workspace/<concern>/`. `src/lib/` is for code
with no CP-workspace dependency, reusable by another surface.

Three rules follow from this, and past bugs came from breaking the first two:

- **No panel behavior may depend on where DOM focus is.** A container-scoped
  `keydown` listener goes dead the moment a text editor, floating toolbar, or
  portalled menu takes focus, and portalled content it never sees at all. The fix
  is never to hand focus back manually — route the key through the shortcut
  runtime, which is focus-independent.
- **One predicate per question.** `isShortcutEditingTarget` in
  `keyboard/shortcutDispatcher.ts` is the canonical "does this target own its
  keystrokes" test. Do not write a near-copy in a component.
- **Extracting logic is not enough.** If the extraction leaves a deps-memo and a
  descriptor-to-UI adapter behind in the panel, the panel did not get smaller.
  Take the binding with it.

If a change genuinely fits no row above, the panel is missing an abstraction. Say
so in the PR rather than adding another effect. See
`implementation-plans/crease-pattern-panel-decomposition.md`.

#### The line cap is a prompt, not a ceiling

`max-lines` exists because this panel went from 7.6k lines to 2.8k and back to
3.8k within a week, and nothing made that visible while it happened. The number
is a proxy — it is there to force a decision at the moment of growth, not to be
optimized.

So when it fires, **two answers are legitimate**, and it is the author's call
which applies:

- Move the behavior to where the table above says it belongs.
- Raise the cap in `apps/web/eslint.config.js` and say why in the PR. A feature
  that genuinely belongs in a panel is a real thing.

What is **not** legitimate is making the count go down without making the code
better. Each of these is worse than a raised cap, and reviewers should say so:

- Splitting a file along no conceptual seam (`FooPanelParts.tsx`).
- Extracting a hook that needs a dozen arguments and returns twenty fields. If
  the interface is worse than the inlining, leave it inlined and explain — see
  the Phase 4 note in the decomposition plan, which was stopped for exactly this.
- Deleting comments to fit. Comments and blank lines are not counted, so this
  never helps anyway.
- Moving code out of `components/panels/` only to escape the rule.

The signal worth acting on is a panel growing *because behavior keeps landing
there*, which is what the table above is for. A panel that is long because it
composes a genuinely large surface is fine.

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

# WASM bridge — build through the npm scripts, which pin the target and out-dir
npm --workspace @treemaker/web run build:oristudio-cp-wasm
npm --workspace @treemaker/web run build:oristudio-bp-wasm
npm --workspace @treemaker/web run build:treemaker-wasm
npm --workspace @treemaker/web run build:oristudio-cp-detect-wasm
wasm-pack test --node crates/treemaker-wasm
```

Choose the smallest validation set that covers the files you changed, and
report any skipped checks with the reason.

**Every wasm artifact under `apps/web/src/generated/` is a build output, and
none of them are tracked.** Everything that ships rebuilds them from the Rust
source first: both CI jobs, both deploy workflows, and Tauri's
`beforeBuildCommand` all install `wasm-pack` and run `build:wasm`, and the
`predev` / `pretypecheck` / `pretest` / `prebuild` hooks do the same for any
local npm entry point. So a kernel change reaches the browser through the
build, not through a committed binary.

What this costs you locally: a bare `npx tsc --noEmit` or `npx vitest` skips
those hooks, and the `.js`/`.d.ts` glue is unchanged by a body-only kernel edit
— so lint, typecheck and vitest all pass over a stale `.wasm` and say nothing.
After changing `crates/oristudio-cp*` or `crates/oristudio-bp*`, rebuild the
matching bridge before you trust anything you see in the browser:

```bash
npm --workspace @treemaker/web run build:oristudio-cp-wasm
```

(CP and BP were tracked until they weren't: they predated CI building wasm, and
the tracked copies then sat there stale with nothing to catch it. The history is
in `implementation-plans/angle-restricted-endpoint-snap.md`.)

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

- `web-client`: first asserts nothing under `apps/web/src/generated/` is tracked
  (see the wasm note above — a committed artifact passes every other check in
  this job), then installs Rust and Node, installs `wasm-pack`, builds the
  simulator and all four wasm bridges, and runs web lint, i18n check, typecheck,
  and unit tests (the latter with `--ignore-scripts`, so they do not rebuild what
  the dedicated step just built).
- `native-oracle`: installs Tauri Linux dependencies, runs Rust format, clippy,
  workspace tests, builds the C++ oracle, and runs oracle parity tests.

Match local validation to the affected CI surface before opening a pull request.

## Common patterns

### Engine parity work

1. Identify which upstream owns the behavior (see the porting-discipline table)
   and read that implementation in `third_party/`.
2. Add or update focused fixtures when file I/O is involved.
3. Add Rust tests that describe the expected behavior.
4. Run that subsystem's oracle when the change affects model semantics.
5. Update `PORTING.md` if the supported parity surface changes.

### GUI work

1. Check `WEB_ROADMAP.md` and `PRODUCT_ROADMAP.md` for the intended product
   direction.
2. Keep browser and Tauri parity in mind from the start.
3. Prefer shared command, runtime, store, and file-service patterns.
4. Avoid pushing product behavior into the Tauri shell unless it is truly native
   shell behavior.
5. Instrument it (see Analytics below): a new user-facing feature, tool, export
   format, dialog, or notable flow should ship with the analytics event that lets
   us tell whether it gets used.

### Analytics

Ori Studio has PostHog product analytics; the browser and desktop builds share
the same renderer code, so one implementation covers both. All of it lives in
the central analytics layer (`apps/web/src/analytics/`) — never call
`posthog.capture` directly.

Treat instrumentation as part of "done" for user-facing work. When you add a
feature, tool, export format, panel, dialog, or a notable action, add a
corresponding event so we can measure adoption. Two paths exist and you should
know which applies:

- Most menu / keyboard / command-palette actions are already captured
  automatically at the `handleMenuAction` chokepoint
  (`apps/web/src/commands/menuActions.ts`). If your action dispatches through a
  `MENU_ACTION_ID`, it is covered — do **not** add a second hand-placed event for
  the same thing.
- Add a hand-placed `track(...)` event only for high-signal moments the
  chokepoint can't express, or when you want structured properties (a build
  completing, an export by `format`, a funnel step, a bucketed count).

Follow the taxonomy and privacy contract in
`implementation-plans/posthog-analytics.md` and `docs/analytics.md`: lowercase
space-separated event names, `snake_case` properties, and **only enums and
bucketed numbers** as property values. Never send raw user content — text-tool
text, filenames or paths, geometry / coordinates / measured values, node/edge
data, or image data. Analytics must be a no-op when the user has opted out;
never gate product behavior on it.

### CP detector eval work

The `create-pattern-detector` ML repo owns deterministic dataset selection for
the native box-pleat eval. This repo owns product-side browser ONNX,
Rust/WASM, and post-processing evals over that selected set. Before changing
box-pleat detector behavior, read
`scripts/cp-detect/README.md#box-pleat-native-eval` and use the ignored
`artifacts/cp-detect-correctness/` tree for generated packs, dense caches, and
reports.

CP detector model assets under `apps/web/public/models/cp-detector-*` are
intentionally gitignored. The tracked source of truth for the current product
model is `scripts/cp-detect/current-model.json`; do not duplicate the model ID,
SHA, checkpoint path, or versioned asset directory in new docs or scripts. For a
fresh worktree, copy the ignored directories named there from the canonical
checkout or re-export from the ML checkpoint named there. Then run
`node scripts/cp-detect/check-local-model-assets.mjs`; it reads the pointer file
and fails if the stable local model is missing or stale.

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

### Worktree paths

Agents often run inside a git worktree whose working directory is nested under
`.claude/worktrees/<name>/`. That worktree is the checkout you must edit. The
main checkout sits at the parent path (the repo root, whatever the local clone
directory is named) and is a separate, writable checkout on its own branch — so
an absolute path anchored to the main
root points at a real file and edits there succeed silently, landing your work
on the wrong branch instead of failing loudly.

Before editing in a worktree session, run `git rev-parse --show-toplevel` once
and treat that as the only path prefix. Build every Read/Edit/Write path from
it (or pass paths relative to the shell cwd, which already points at the
worktree). Never assemble an absolute path from a remembered repo root. Watch
for the tell: if search tools return worktree-relative paths but you feed
absolute ones, the two roots can diverge — that is exactly where changes leak
into the main checkout.

### Worktree setup

A fresh worktree is **not** ready to build, typecheck, or run the web tooling.
Two things it lacks that the primary checkout has:

1. **`node_modules`** — npm never populates a worktree; each one needs its own
   install. Without it, `tsc` cannot resolve packages (`react-i18next`,
   `react-router-dom`, …) and the i18n scripts fail with cryptic errors.
2. **The generated artifacts** under `apps/web/src/generated/` — all four wasm
   bridges and the generated TS. None of them are tracked, so a new worktree
   starts without them and typecheck/build fail.

Bootstrap both in one step from the worktree root:

```bash
scripts/setup-worktree.sh
```

On APFS (the macOS default) it does **not** run a fresh `npm install` — that
would burn ~490MB per worktree. Instead it clones the primary's `node_modules`
with copy-on-write (`cp -c`): the worktree gets real, fully-functional
directories that share disk blocks with the primary, so the whole bootstrap
costs a few MB of actual disk and runs in a second. npm's internal workspace
links are relative, so a clone resolves to the worktree's own packages. On
non-APFS filesystems it falls back to `npm install`. It then copies the
generated artifacts from the primary checkout.

Do **not** symlink `node_modules` from the primary — npm workspace bin
resolution breaks under symlinks (`npx i18next` fails), so the i18n tooling
(`i18n:extract` / `i18n:check`) won't run. Clone or install into the worktree
instead.

The clone source must be current, so the script runs `npm install` in the
primary first (idempotent — a fast no-op when already up to date) to catch the
stale case where the primary's `node_modules` predates a dependency change.

Caveats:
- If your branch itself adds/removes deps, run `npm install` in the worktree
  after bootstrap — starting from the clone it only fetches the delta.
- The copy step assumes the primary's wasm bridges are already built (see WASM
  bridge above); if `setup-worktree.sh` reports 0 files copied, build them there
  and re-run.

## Pull requests

Unless the user explicitly says otherwise, open pull requests against `main`.
Default to draft PRs for agent-created changes.

For end-to-end implementation requests such as `/create <prompt>`, "build this
feature end-to-end", or "take this from plan to PR", use the repo-local
`create-feature` skill under `.agents/skills/create-feature/`. That workflow
owns planning, implementation, validation selection, draft PR creation, and PR
handoff notes.

For checking whether an upstream has moved into code we depend on, use the
repo-local `upstream-drift` skill under `.agents/skills/upstream-drift/`. It
triages new upstream commits into port-or-skip buckets, writes a sync plan and
opens an issue when porting is needed, and advances the pointer in
`upstream-sync.json` either way. It never ports code and never edits vendored
source. Run it for one upstream at a time, roughly monthly.
