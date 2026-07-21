#!/usr/bin/env bash
# Used as RUSTC_WORKSPACE_WRAPPER so a single `cargo test` also runs Clippy.
#
# Cargo applies RUSTC_WORKSPACE_WRAPPER to workspace crates only (dependencies
# go through RUSTC_WRAPPER, i.e. sccache). Compiling the workspace with
# clippy-driver instead of rustc lints and builds it in one pass, so we avoid a
# separate `cargo clippy` compile of every workspace crate.
#
# `-D warnings` is appended here (not via RUSTFLAGS) so it is scoped to
# workspace crates only, matching `cargo clippy -- -D warnings`. Dependencies
# are never subject to it.
set -euo pipefail
exec "$(rustc --print sysroot)/bin/clippy-driver" "$@" -D warnings
