# Contributing to Ori Studio

Thanks for your interest in Ori Studio — a workspace for designing and analyzing
origami, built on Rust/WebAssembly engines and a shared web + desktop frontend.
Contributions are welcome, whether that's testing, filing a good bug report, or
writing code.

## Ways to contribute

You don't need to write code to help.

- **Test it and report what breaks.** The fastest way to help right now. File a
  [bug report](https://github.com/zacharyfmarion/ori-studio/issues/new/choose)
  or drop it in the [Discord](https://discord.gg/9q836Wq6Q8) `#feedback` forum.
  A screenshot or a sample `.ori` file makes almost every report actionable.
- **Suggest a feature.** Open a
  [feature request](https://github.com/zacharyfmarion/ori-studio/issues/new/choose).
  Describe what you're trying to *do* — the underlying goal matters more than a
  specific solution.
- **Fold something and show it off.** Post in the Discord `#showcase` channel.
- **Write code.** The rest of this guide is for you.

For questions and general discussion, the [Discord](https://discord.gg/9q836Wq6Q8)
is faster than a GitHub issue. What's planned, in progress, and shipped lives on
the [public roadmap](https://github.com/users/zacharyfmarion/projects/1).

## Before you start on code

- **For anything non-trivial, open an issue first** (or comment on an existing
  one) so we can agree on the approach before you invest time. Small, obvious
  fixes can go straight to a PR.
- **This is a port.** Much of the engine is a faithful port of existing origami
  tools — [Oriedita](https://oriedita.github.io/),
  [TreeMaker](https://langorigami.com/article/treemaker/), and
  [Box Pleating Studio](https://bpstudio.abstreamace.com/). If you're touching
  parser, serializer, optimizer, feasibility, geometry, or crease-pattern
  behavior, **read [`PORTING.md`](PORTING.md) first.** We match the reference
  implementation's behavior rather than substituting a simpler algorithm.
- **[`AGENTS.md`](AGENTS.md) is the deep engineering guide** — repository layout,
  architectural rules, per-area testing expectations, and common patterns. It's
  written for AI agents but applies to everyone. Read it before a substantial
  change.

## Development setup

Prerequisites:

- **Rust** (2024 edition, stable toolchain) with `rustfmt` and `clippy`
- **Node.js 22** (see the version in use; `npm ci` for a clean install)
- **[`wasm-pack`](https://rustwasm.github.io/wasm-pack/)** for the WebAssembly bridge
- For the desktop app: the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

Install and run:

```sh
npm ci             # install web/desktop dependencies
npm run dev:web    # run the web app
npm run dev:desktop  # run the Tauri desktop app
```

See the [README](README.md#getting-started) for using the published crates and CLI.

## Making a change

1. **Fork** the repo and create a branch off `main`.
2. Make your change, keeping it focused — one logical change per PR.
3. **Add tests** near the behavior you changed: inline unit tests for small
   engine logic, crate integration tests for public flows, oracle parity tests
   for parity-sensitive behavior, and fixtures for new file-format cases.
4. **Run the checks that cover what you touched** (see below).
5. Open a pull request against `main`.

### Running checks

Run the smallest set that covers your change, and mention anything you skipped
and why. CI runs the full set regardless.

Rust engine:

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Web frontend:

```sh
npm run lint:web
npm run typecheck:web
npm run test:web
npm run build:web        # when wasm bindings, bundling, or routing may be affected
```

Desktop shell:

```sh
npm run check:desktop
```

WASM bridge:

```sh
wasm-pack build crates/treemaker-wasm --target bundler
wasm-pack test --node crates/treemaker-wasm
```

Parity-sensitive engine work (optimizer, file format, feasibility, geometry)
should also run the C++ oracle parity tests — see [`AGENTS.md`](AGENTS.md#build-commands).

## Coding standards

- **Rust:** 2024 edition, `rustfmt` defaults. Library code propagates typed
  errors — avoid `unwrap()`, `expect()`, and `panic!()` outside tests or
  genuinely unreachable invariants. If a TreeMaker operation isn't ported yet,
  return `TreeError::UnsupportedOperation` rather than inventing a nearby result.
- **Web / Tauri:** keep the Tauri shell thin (native menus, dialogs, packaging);
  product logic belongs in shared frontend or engine code. Reuse existing UI
  primitives, theme tokens, and store slices before adding new ones.
- **Commits:** clear, present-tense messages explaining the *why*. Keep unrelated
  changes out of the same PR.

## Pull requests

- Target `main`. Draft PRs are welcome while work is in progress.
- Describe what changed and why, and note which checks you ran.
- Make sure CI passes. Two jobs run: `web-client` (web lint, typecheck, tests)
  and `native-oracle` (Rust format, clippy, workspace tests, and C++ oracle
  parity). Match your local validation to the surface you changed.
- A maintainer will review. Expect some back-and-forth on parity-sensitive
  changes — matching the reference implementation is the priority.

## Licensing

Ori Studio is licensed under **GPL-2.0-or-later** because it includes a direct
Rust port of TreeMaker's GPL model code. By contributing, you agree that your
contributions are licensed under the same terms. See
[`LICENSING.md`](LICENSING.md) for the full licensing guide, including optimizer
backend notes and the dependency inventory. Do not add dependencies or vendored
code whose license is incompatible with GPL-2.0-or-later.

## Code of conduct

Be respectful and constructive. This is a small community built around a shared
love of origami and the tools that make it — assume good faith, keep discussion
civil, and help newcomers. Harassment or hostility isn't welcome.

---

Not sure where to start or whether an idea fits? Ask in the
[Discord](https://discord.gg/9q836Wq6Q8) — happy to point you at something.
