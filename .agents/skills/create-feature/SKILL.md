---
name: create-feature
description: Use when the user asks to take a TreeMaker feature, bug fix, refactor, or workflow change from prompt to implementation, especially prompts like "/create a new feature", "build this feature end-to-end", "take this from plan to PR", or "own this change through validation and handoff". This skill is for repo-local delivery workflows that create and maintain implementation plans when appropriate, choose tests based on changed behavior, run deterministic validation, and open a draft PR against main.
---

# Create Feature

Use this skill when the user wants one agent to carry a repo change through
planning, execution, validation, and PR handoff.

## What This Skill Owns

- Create and maintain an implementation plan for non-trivial work.
- Inspect the checkout and make sure it is ready before editing.
- Implement the requested change directly unless a real product or architecture
  decision blocks progress.
- Add or update tests that match the changed behavior.
- Run the smallest deterministic validation set that covers the changes.
- Open a draft PR against `main`.
- Start the local app on an available port after the PR is ready when the
  change has a user-testable web UI surface.

## Required Reads

Before changing code, read the repo guides that apply:

1. `AGENTS.md`
2. `README.md`
3. `PORTING.md` when changing parser, serializer, optimizer, feasibility, or
   crease-pattern behavior
4. `WEB_ROADMAP.md` and `PRODUCT_ROADMAP.md` when changing the shared app
5. `.github/PULL_REQUEST_TEMPLATE.md` if it exists
6. Any relevant existing file under `implementation-plans/`

## Checkout Readiness

Do not create a worktree in this skill.

Instead:

1. Inspect checkout state with non-interactive Git commands.
2. If the repo is in a Git worktree, make sure that worktree is actually ready
   for development.
3. If the repo is in a normal checkout, continue in place.
4. If the checkout is detached at `main` or `origin/main`, create a branch named
   `codex/<concise-description>`.

Default readiness expectations:

- Run `npm ci` only when frontend dependencies are needed or missing.
- Ensure `wasm-pack` is available before wasm or web validation that builds wasm.
- Rust/Tauri tooling is only needed when the changed scope touches Rust,
  generated wasm bindings, or desktop behavior.

## Planning Contract

For non-trivial work, derive a concise slug from the task and create
`implementation-plans/<slug>.md`.

Use the repo's established plan format:

- `# <Title>`
- `## Goal`
- `## Approach`
- `## Affected Areas`
- `## Checklist`

Keep the checklist current while you work. Mark steps complete as soon as they
are actually done using `- [x]`.

Do not create an implementation plan for narrow housekeeping work such as
typo-only edits, formatting cleanup, docs-only edits, CI fixes, or other small
maintenance tasks.

## Execution Contract

After planning, implement directly. Escalate only when the repo and request do
not provide enough signal to choose the correct path responsibly.

Always:

- Read existing patterns before introducing new ones.
- Make the architecturally correct change for the job, even when that requires
  a larger implementation than a narrow patch.
- Preserve TreeMaker parity with the vendored C++ source.
- Avoid inventing new repo workflow conventions when an existing one can be
  extended.
- Keep product behavior in shared frontend or engine code rather than the Tauri
  shell unless the behavior is native shell behavior.
- Keep a running summary of what changed and why for the PR body.
- Surface the issue to the user only when the correct architectural path depends
  on a product decision, scope tradeoff, migration risk, or ownership boundary
  that cannot be inferred from the repo and request.

## Test Expectations

Choose tests based on the changed behavior:

- Add or update Rust tests for changed engine, CLI, wasm, or desktop logic.
- Add or update oracle tests when behavior must match TreeMaker 5.0.1.
- Add or update frontend unit tests for changed UI, store, command, runtime, or
  platform behavior.
- Add or update fixtures when parser or serializer coverage changes.
- If no new tests are needed, justify that in the PR notes.

## Validation Commands

Run the appropriate subset of these commands based on what changed. Do not run
heavy commands for areas the change does not touch unless a cross-cutting risk
justifies it.

### Formatting

Run whenever the change touches a Prettier-covered file — TypeScript, JSX, the
Node scripts, CSS, HTML, YAML, or hand-authored JSON. Markdown is excluded on
purpose; see `.prettierignore`.

```bash
npm run format:check
```

`npm run format` fixes. Format only the files your change already touches — a
diff that mixes reformatting into a behavior change is much harder to review.

### Docs and workflow

```bash
git diff --check
```

### Rust engine, CLI, wasm, or oracle

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

For parity-sensitive engine, optimizer, file-format, feasibility, or
crease-pattern changes, also run:

```bash
tools/oracle/build_oracle.sh
TREEMAKER_CPP_ORACLE=tools/oracle/build/treemaker-oracle cargo test -p oracle-tests --test cpp_oracle
```

### WASM bridge

```bash
wasm-pack build crates/treemaker-wasm --target bundler
wasm-pack test --node crates/treemaker-wasm
```

### Web client

```bash
npm run lint:web
npm run typecheck:web
npm run test:web
```

Run `npm run build:web` when generated wasm, bundling, production rendering, or
deployment behavior may be affected.

### Desktop shell

```bash
npm run check:desktop
```

Run `npm run dev:desktop` locally when menu, dialog, filesystem, window, or
desktop runtime behavior changes and needs interactive verification.

In final summaries and PR notes, report:

- Which validations ran
- Which validations were skipped
- Why each skipped validation was not necessary

## Pull Request Handoff

Unless the user asked otherwise, open a draft PR against `main`.

Before creating the PR:

1. Confirm the working tree contains only intended changes.
2. Fill `.github/PULL_REQUEST_TEMPLATE.md` if it exists; otherwise use a concise
   Markdown body with Summary, Validation, and Skipped Validation sections.
3. Include the implementation plan path in the PR notes when one was created.
4. Summarize tests added, validations run, and intentionally skipped checks.

Use:

```bash
gh pr create --draft --base main
```

If `gh` auth or GitHub access is unavailable, stop after local validation and
report the exact blocker.

## Local Testing Server

After the draft PR exists, start the web app for local testing when the change
touches the shared frontend or another user-testable browser surface, unless
the user explicitly asked not to. Prefer:

```bash
npm --workspace @treemaker/web run dev -- --host 127.0.0.1
```

Let Vite choose an available port; do not force `--strictPort`. If an existing
local server for this checkout is already running, reuse it when appropriate.
Keep the server session running and include the exact local URL in the final
handoff. If the app cannot be started, report the blocker and the command that
failed.

## Guardrails

- Do not create or switch worktrees from this skill.
- Do not skip the implementation plan for non-trivial work.
- Do not open the PR before required local validation succeeds.
- Do not target any base branch other than `main` unless the user explicitly
  says so.
- Do not use `unwrap()`, `expect()`, or `panic!()` in production library code
  when a typed error can be propagated.
- Do not put product behavior in Tauri-specific code unless it is actually a
  desktop shell concern.
