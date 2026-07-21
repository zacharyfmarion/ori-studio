#!/usr/bin/env bash
#
# setup-worktree.sh — bootstrap a git worktree so it can build, typecheck, and
# run the i18n tooling.
#
# Two things a fresh worktree lacks that the primary checkout has:
#   1. node_modules — npm never populates a worktree.
#   2. The .gitignore'd generated artifacts under apps/web/src/generated/
#      (the wasm bridges and generated TS). These are build outputs, not tracked
#      in git, so a new worktree starts without them and typecheck/build fail.
#
# For (1) we do NOT run a fresh `npm install` per worktree — that would burn
# ~490MB of disk each time. Instead, on APFS (the macOS default) we clone the
# primary's node_modules with copy-on-write (`cp -c`): the worktree gets real,
# fully-functional directories that share disk blocks with the primary until
# modified, so ~490MB of node_modules costs a few MB of actual disk and copies
# in a second. npm's internal workspace links are relative, so a clone resolves
# them to the worktree's own packages. On non-APFS filesystems we fall back to a
# normal `npm install`.
#
# Before cloning it runs `npm install` in the primary so the clone source is
# current with the lockfile (idempotent — a fast no-op when already up to date).
# If your branch itself adds/removes dependencies, run `npm install` in the
# worktree afterward — starting from the clone it only fetches the delta.
#
# Safe to run from any worktree, including the primary (where it just installs).
#
# Usage:  scripts/setup-worktree.sh
#
set -euo pipefail

# --- locate this worktree and the primary checkout -------------------------
repo_root="$(git rev-parse --show-toplevel)"

# --git-common-dir points at the shared .git of the primary checkout; it may be
# returned relative to the worktree, so resolve it to an absolute path.
common_dir="$(git rev-parse --git-common-dir)"
case "$common_dir" in
  /*) : ;;
  *)  common_dir="$repo_root/$common_dir" ;;
esac
primary_root="$(cd "$(dirname "$common_dir")" && pwd)"

echo "==> Worktree: $repo_root"
echo "==> Primary:  $primary_root"

# --- primary checkout: just install, nothing to clone ----------------------
if [ "$repo_root" = "$primary_root" ]; then
  echo "==> This is the primary checkout; running npm install…"
  ( cd "$repo_root" && npm install )
  echo "==> Done."
  exit 0
fi

# --- ensure the primary's node_modules is current with the lockfile --------
# We clone from the primary, so its install must be up to date first. Always run
# `npm install` there (not just when node_modules is missing): it is idempotent
# and fast — a no-op reconcile against the lockfile when already current — and
# it catches the stale case (node_modules present but predating a dependency
# change), which a plain existence check would miss.
echo "==> Ensuring the primary's node_modules is up to date…"
( cd "$primary_root" && npm install )

# --- 1. populate node_modules (clone on APFS, else install) ----------------
supports_clonefile() {
  local p="$1/.clone-probe.$$" q="$1/.clone-probe2.$$" ok=1
  if : > "$p" 2>/dev/null && cp -c "$p" "$q" 2>/dev/null; then ok=0; fi
  rm -f "$p" "$q" 2>/dev/null || true
  return $ok
}

if supports_clonefile "$repo_root"; then
  echo "==> Cloning node_modules via copy-on-write (cheap, shares disk blocks)…"
  cloned=0
  while IFS= read -r nm; do
    rel="${nm#"$primary_root"/}"
    dst="$repo_root/$rel"
    if [ -e "$dst" ]; then
      echo "    skip $rel (already present)"
      continue
    fi
    mkdir -p "$(dirname "$dst")"
    cp -cRp "$nm" "$dst"
    echo "    cloned $rel"
    cloned=$((cloned + 1))
  done < <(find "$primary_root" -type d -name .claude -prune -o \
                 -type d -name node_modules -prune -print)
  echo "==> Cloned $cloned node_modules tree(s)."
else
  echo "==> Filesystem has no copy-on-write clone; running npm install…"
  ( cd "$repo_root" && npm install )
fi

# --- 2. copy .gitignore'd build artifacts from the primary -----------------
# The web app and its tests consume build outputs that live OUTSIDE node_modules
# and are .gitignore'd, so neither the clone nor `npm install`'s workspace build
# step provides them in a fresh worktree:
#   - apps/web/src/generated/       wasm bridges + generated TS
#   - packages/*/dist/              built workspace libraries (e.g.
#                                   @treemaker/origami-simulator, whose
#                                   package.json main is ./dist/index.js —
#                                   without it Vite/vitest can't resolve it)
# Mirror both from the primary (which builds them).
echo "==> Copying generated + built-library artifacts from the primary…"
copied=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  src="$primary_root/$rel"
  dst="$repo_root/$rel"
  [ -e "$src" ] || continue
  mkdir -p "$(dirname "$dst")"
  cp -cp "$src" "$dst" 2>/dev/null || cp -p "$src" "$dst"
  copied=$((copied + 1))
done < <(git -C "$primary_root" ls-files --others --ignored --exclude-standard \
           -- apps/web/src/generated ':(glob)packages/*/dist/**')
echo "==> Copied $copied build artifact(s)."
if [ "$copied" -eq 0 ]; then
  echo "    WARNING: no build artifacts found in the primary checkout."
  echo "    Build the wasm bridges and workspace packages there first"
  echo "    (see AGENTS.md → WASM bridge), then re-run this script."
fi

echo "==> Worktree ready. Verify with:  cd apps/web && npm run i18n:check"
