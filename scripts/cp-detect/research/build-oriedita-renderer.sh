#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
output="${1:?Usage: build-oriedita-renderer.sh OUTPUT_DIRECTORY}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
source_root="$repo_root/third_party/oriedita"
# Compile actual upstream geometry, rather than the oracle's geometry stubs.
javac -d "$output" \
  -sourcepath "$source_root/origami/src/main/java:$source_root/oriedita-common/src/main/java:$source_root/oriedita-data/src/main/java:$source_root/oriedita-ui/src/main/java:$repo_root/tools/oriedita-oracle/stubs" \
  "$repo_root/scripts/cp-detect/research/OrieditaCpRenderer.java"
