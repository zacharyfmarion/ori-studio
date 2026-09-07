#!/usr/bin/env bash
#
# Put our patched linuxdeploy GTK plugin where tauri-bundler will find it.
#
# `prepare_tools` in tauri-bundler downloads each AppImage tool **only when the
# file is absent** from its tools directory:
#
#     let gtk = tools_path.join("linuxdeploy-plugin-gtk.sh");
#     if !gtk.exists() { download(...) }
#
# so writing ours there first is the whole mechanism — there is no config knob
# that names a plugin. `bundle.useLocalToolsDir` (set for Linux only, in
# apps/tauri/src-tauri/tauri.linux.conf.json) is what makes that directory
# `<cargo target dir>/.tauri` instead of the machine-global user cache, so this
# never leaks a patched plugin into someone's other Tauri projects.
#
# Run before `tauri build` on any Linux leg. Idempotent.
#
#     scripts/appimage/install-appimage-tools.sh [tools-parent-dir]
#
# See implementation-plans/appimage-host-glib.md.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Mirrors the bundler: cargo metadata's `target_directory`, then `.tauri`. The
# argument is for tests; CARGO_TARGET_DIR is for anyone who has moved it.
target_dir="${1:-${CARGO_TARGET_DIR:-$repo_root/target}}"
tools_dir="$target_dir/.tauri"

plugin="$repo_root/scripts/appimage/linuxdeploy-plugin-gtk.sh"
if [ ! -f "$plugin" ]; then
  echo "error: $plugin is missing" >&2
  exit 1
fi

mkdir -p "$tools_dir"
cp "$plugin" "$tools_dir/linuxdeploy-plugin-gtk.sh"
chmod +x "$tools_dir/linuxdeploy-plugin-gtk.sh"

echo "installed patched linuxdeploy-plugin-gtk.sh into $tools_dir"
