#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
oracle_root="$repo_root/tools/oriedita-oracle"
source_root="${ORIEDITA_SOURCE:-$repo_root/third_party/oriedita}"
origami_source="$source_root/origami/src/main/java"
common_source="$source_root/oriedita-common/src/main/java"
data_source="$source_root/oriedita-data/src/main/java"
build_root="$oracle_root/build"
classes_root="$build_root/native-io-classes"
stubs_root="$build_root/native-io-stubs"

if [[ ! -d "$origami_source" || ! -d "$common_source" || ! -d "$data_source" ]]; then
  echo "Oriedita source not found under $source_root" >&2
  echo "Set ORIEDITA_SOURCE to the pinned Oriedita checkout." >&2
  exit 1
fi

find_cached_jar() {
  local group="$1"
  local artifact="$2"
  local version="$3"
  local group_path="${group//.//}"
  local jar=""

  if [[ -d "$HOME/.m2/repository/$group_path/$artifact" ]]; then
    jar="$(find "$HOME/.m2/repository/$group_path/$artifact" -name "$artifact-*.jar" -type f | sort -V | tail -n 1)"
  fi
  if [[ -z "$jar" && -d "$HOME/.gradle/caches/modules-2/files-2.1/$group/$artifact" ]]; then
    jar="$(find "$HOME/.gradle/caches/modules-2/files-2.1/$group/$artifact" -name "$artifact-*.jar" -type f | sort -V | tail -n 1)"
  fi
  if [[ -z "$jar" && "$(command -v mvn)" != "" ]]; then
    mvn -q dependency:get -Dartifact="$group:$artifact:$version" -Dtransitive=false
    if [[ -d "$HOME/.m2/repository/$group_path/$artifact" ]]; then
      jar="$(find "$HOME/.m2/repository/$group_path/$artifact" -name "$artifact-*.jar" -type f | sort -V | tail -n 1)"
    fi
  fi

  if [[ -z "$jar" ]]; then
    echo "Missing $group:$artifact:$version; install it with Maven or provide it in ~/.m2 or ~/.gradle caches." >&2
    exit 1
  fi

  echo "$jar"
}

jackson_version="2.13.3"
jackson_annotations="$(find_cached_jar com.fasterxml.jackson.core jackson-annotations "$jackson_version")"
jackson_core="$(find_cached_jar com.fasterxml.jackson.core jackson-core "$jackson_version")"
jackson_databind="$(find_cached_jar com.fasterxml.jackson.core jackson-databind "$jackson_version")"
classpath="$jackson_annotations:$jackson_core:$jackson_databind"

rm -rf "$classes_root"
mkdir -p "$classes_root"
rm -rf "$stubs_root"
mkdir -p "$stubs_root"
cp -R "$oracle_root/stubs/jakarta" "$stubs_root/"
cp -R "$oracle_root/stubs/org" "$stubs_root/"

javac \
  -d "$classes_root" \
  -cp "$classpath" \
  -sourcepath "$stubs_root:$oracle_root/src:$origami_source:$common_source:$data_source" \
  "$oracle_root/src/OrieditaNativeIoOracle.java"

cat > "$build_root/oriedita-native-io-oracle" <<EOF
#!/usr/bin/env bash
set -euo pipefail
java -cp "$classes_root:$classpath" OrieditaNativeIoOracle "\$@"
EOF
chmod +x "$build_root/oriedita-native-io-oracle"

echo "$build_root/oriedita-native-io-oracle"
