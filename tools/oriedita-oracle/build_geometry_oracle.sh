#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
oracle_root="$repo_root/tools/oriedita-oracle"
source_root="${ORIEDITA_SOURCE:-$repo_root/third_party/oriedita}"
origami_source="$source_root/origami/src/main/java"
common_source="$source_root/oriedita-common/src/main/java"
data_source="$source_root/oriedita-data/src/main/java"
ui_source="$source_root/oriedita-ui/src/main/java"
build_root="$oracle_root/build"
classes_root="$build_root/classes"

if [[ ! -d "$origami_source" ]]; then
  echo "Oriedita source not found at $origami_source" >&2
  echo "Set ORIEDITA_SOURCE to the pinned Oriedita checkout." >&2
  exit 1
fi
if [[ ! -d "$common_source" || ! -d "$data_source" ]]; then
  echo "Oriedita data/common source not found under $source_root" >&2
  echo "Set ORIEDITA_SOURCE to the pinned Oriedita checkout." >&2
  exit 1
fi
if [[ ! -d "$ui_source" ]]; then
  echo "Oriedita UI source not found under $source_root" >&2
  echo "Set ORIEDITA_SOURCE to the pinned Oriedita checkout." >&2
  exit 1
fi

rm -rf "$classes_root"
mkdir -p "$classes_root"

javac \
  -d "$classes_root" \
  -sourcepath "$oracle_root/stubs:$oracle_root/src:$origami_source:$common_source:$data_source:$ui_source" \
  "$origami_source/origami/Epsilon.java" \
  "$origami_source/origami/crease_pattern/CustomLineTypes.java" \
  "$origami_source/origami/crease_pattern/element/Point.java" \
  "$origami_source/origami/crease_pattern/element/LineColor.java" \
  "$origami_source/origami/crease_pattern/element/LineSegment.java" \
  "$origami_source/origami/crease_pattern/element/StraightLine.java" \
  "$origami_source/origami/crease_pattern/element/Circle.java" \
  "$origami_source/origami/crease_pattern/element/Line.java" \
  "$origami_source/origami/crease_pattern/element/Point_p.java" \
  "$origami_source/origami/crease_pattern/element/Polygon.java" \
  "$origami_source/origami/crease_pattern/element/Rectangle.java" \
  "$origami_source/origami/crease_pattern/FoldingException.java" \
  "$origami_source/origami/crease_pattern/OritaCalc.java" \
  "$origami_source/origami/crease_pattern/PointSet.java" \
  "$origami_source/origami/crease_pattern/LineSegmentSet.java" \
  "$origami_source/origami/crease_pattern/FoldLineSet.java" \
  "$origami_source/origami/crease_pattern/worker/WireFrame_Worker.java" \
  "$origami_source/origami/crease_pattern/worker/foldlineset/BranchTrim.java" \
  "$origami_source/origami/crease_pattern/worker/foldlineset/Fix1.java" \
  "$origami_source/origami/crease_pattern/worker/foldlineset/Fix2.java" \
  "$origami_source/origami/crease_pattern/worker/linesegmentset/IntersectDivide.java" \
  "$origami_source/origami/data/save/LineSegmentSave.java" \
  "$origami_source/origami/data/save/PointSave.java" \
  "$origami_source/origami/data/ListArray.java" \
  "$origami_source"/origami/data/quadTree/*.java \
  "$origami_source"/origami/data/quadTree/adapter/*.java \
  "$origami_source"/origami/data/quadTree/collector/*.java \
  "$origami_source"/origami/data/quadTree/comparator/*.java \
  "$origami_source/origami/folding/element/Face.java" \
  "$origami_source/origami/folding/util/AverageCoordinates.java" \
  "$common_source/oriedita/editor/AbstractModel.java" \
  "$common_source/oriedita/editor/Foldable.java" \
  "$common_source/oriedita/editor/canvas/LineStyle.java" \
  "$common_source/oriedita/editor/drawing/tools/Camera.java" \
  "$common_source/oriedita/editor/text/Text.java" \
  "$common_source/oriedita/editor/tools/StringOp.java" \
  "$data_source/oriedita/editor/Colors.java" \
  "$data_source/oriedita/editor/databinding/GridModel.java" \
  "$data_source/oriedita/editor/folded_figure/FoldedFigure_01.java" \
  "$data_source/oriedita/editor/canvas/OperationFrame.java" \
  "$data_source/oriedita/editor/save/TextSave.java" \
  "$data_source/oriedita/editor/save/Save.java" \
  "$data_source/oriedita/editor/save/BaseSave.java" \
  "$data_source/oriedita/editor/save/SaveV1_0.java" \
  "$data_source/oriedita/editor/save/SaveV1_1.java" \
  "$data_source/oriedita/editor/save/SaveProvider.java" \
  "$data_source/oriedita/editor/export/api/FileImporter.java" \
  "$data_source/oriedita/editor/export/api/FileExporter.java" \
  "$data_source/oriedita/editor/export/OrhImporter.java" \
  "$data_source/oriedita/editor/export/OrhExporter.java" \
  "$data_source/oriedita/editor/export/ObjImporter.java" \
  "$data_source/oriedita/editor/export/DxfExporter.java" \
  "$ui_source/oriedita/editor/drawing/tools/DrawingUtil.java" \
  "$ui_source/oriedita/editor/drawing/WireFrame_Worker_Drawer.java" \
  "$ui_source/oriedita/editor/drawing/FoldedFigure_Worker_Drawer.java" \
  "$ui_source/oriedita/editor/drawing/FoldedFigure_Drawer.java" \
  "$oracle_root/src/RecordingGraphics2D.java" \
  "$oracle_root/src/OrieditaGeometryOracle.java"

cp "$source_root/oriedita/src/main/resources/fixData_22_5.bin" "$classes_root/fixData_22_5.bin"

cat > "$build_root/oriedita-geometry-oracle" <<EOF
#!/usr/bin/env bash
set -euo pipefail
java -cp "$classes_root" OrieditaGeometryOracle "\$@"
EOF
chmod +x "$build_root/oriedita-geometry-oracle"
cp "$build_root/oriedita-geometry-oracle" "$build_root/oriedita-oracle"

echo "$build_root/oriedita-geometry-oracle"
