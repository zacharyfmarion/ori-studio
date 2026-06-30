use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{ActiveState, Circle, LineColor, LineSegment, Point, RgbColor};
use oristudio_cp::io::{dxf, fold, obj, orh, ori};
use oristudio_cp::model::{CreasePatternModel, GridMetadata, GridState};
use std::path::{Path, PathBuf};
use std::process::Command;
use treemaker_fold::FoldDocument;

#[test]
fn orh_import_matches_oriedita_io_oracle() {
    let Some(oracle) = io_oracle() else {
        eprintln!("skipping Oriedita IO oracle test: ORIEDITA_IO_ORACLE is not set");
        return;
    };
    let input = "\
<タイトル>
タイトル,orh model
<線分集合>
番号,1
色,1
<tpp>0</tpp>
<tpp_color_R>10</tpp_color_R>
<tpp_color_G>20</tpp_color_G>
<tpp_color_B>30</tpp_color_B>
iactive,ACTIVE_BOTH_3
選択,2
座標,0.0,0.0,10.0,0.0
<円集合>
番号,1
中心と半径と色,5.0,5.0,2.0,3
<tpp>1</tpp>
<tpp_color_R>40</tpp_color_R>
<tpp_color_G>50</tpp_color_G>
<tpp_color_B>60</tpp_color_B>
<Kousi>
<i_kitei_jyoutai>2</i_kitei_jyoutai>
<nyuuryoku_kitei>12.6</nyuuryoku_kitei>
<memori_kankaku>6</memori_kankaku>
<a_to_heikouna_memori_iti>4</a_to_heikouna_memori_iti>
<b_to_heikouna_memori_iti>5</b_to_heikouna_memori_iti>
<d_kousi_x_a>2</d_kousi_x_a>
<d_kousi_x_b>1.5</d_kousi_x_b>
<d_kousi_x_c>4</d_kousi_x_c>
<d_kousi_y_a>1</d_kousi_y_a>
<d_kousi_y_b>0</d_kousi_y_b>
<d_kousi_y_c>1</d_kousi_y_c>
<d_kousi_kakudo>45</d_kousi_kakudo>
</Kousi>
";
    let path = write_temp("orh-oracle", ".orh", input.as_bytes());

    let oracle_summary = run_oracle(&oracle, &["orh-import-summary", path.to_str().unwrap()]);
    let document = orh::import_orh_str(input).expect("Rust ORH import should succeed");
    let rust_summary = document_summary(&document, Some(&document.crease_pattern.grid));

    let _ = std::fs::remove_file(path);
    assert_eq!(rust_summary, oracle_summary);
}

#[test]
fn orh_and_dxf_exports_match_oriedita_io_oracle() {
    let Some(oracle) = io_oracle() else {
        eprintln!("skipping Oriedita IO oracle test: ORIEDITA_IO_ORACLE is not set");
        return;
    };

    let document = oracle_fixture_document();
    assert_eq!(
        orh::export_orh_string(&document),
        run_oracle(&oracle, &["orh-export-fixture"])
    );
    assert_eq!(
        dxf::export_dxf_string(&document.crease_pattern),
        run_oracle(&oracle, &["dxf-export-fixture"])
    );
}

#[test]
fn obj_import_matches_oriedita_io_oracle() {
    let Some(oracle) = io_oracle() else {
        eprintln!("skipping Oriedita IO oracle test: ORIEDITA_IO_ORACLE is not set");
        return;
    };
    let input = "\
v 0 0 0
v 10 0 0
v 0 10 0
f 1 2 3
";
    let path = write_temp("obj-oracle", ".obj", input.as_bytes());

    let oracle_summary = run_oracle(&oracle, &["obj-import-summary", path.to_str().unwrap()]);
    let model = obj::import_obj_str(input).expect("Rust OBJ import should succeed");
    let rust_summary = model_summary(None, &model, None);

    let _ = std::fs::remove_file(path);
    assert_eq!(rust_summary, oracle_summary);
}

#[test]
fn ori_import_and_export_match_oriedita_native_io_oracle() {
    let Some(oracle) = native_io_oracle() else {
        eprintln!("skipping Oriedita native IO oracle test: ORIEDITA_NATIVE_IO_ORACLE is not set");
        return;
    };
    let input = r##"{
      "@version": "v1.1",
      "lineSegments": [{
        "a": "-200.0,-200.0",
        "b": "200.0,-200.0",
        "active": "ACTIVE_A_1",
        "color": "RED_1",
        "customized": 1,
        "customizedColor": "ff010203",
        "selected": 2
      }],
      "circles": [{
        "x": 25.0,
        "y": -50.0,
        "r": 12.5,
        "color": "CYAN_3",
        "customized": 1,
        "customizedColor": "ff64c8c8"
      }],
      "texts": [{"x": 1.0, "y": 2.0, "text": "note"}],
      "title": "_",
      "points": ["3.0,4.0"],
      "auxLineSegments": [{
        "a": "0.0,0.0",
        "b": "1.0,1.0",
        "active": "ACTIVE_BOTH_3",
        "color": "YELLOW_7",
        "customized": 0,
        "customizedColor": "ff64c8c8",
        "selected": 0
      }],
      "gridModel": {
        "intervalGridSize": 5,
        "gridSize": 16,
        "gridXA": 2.0,
        "gridXB": 1.0,
        "gridXC": 4.0,
        "gridYA": 1.0,
        "gridYB": 0.0,
        "gridYC": 1.0,
        "gridAngle": 45.0,
        "baseState": "FULL",
        "verticalScalePosition": 3,
        "horizontalScalePosition": 2,
        "drawDiagonalGridlines": true
      },
      "canvasModel": {"mouseMode": "DRAW_CREASE_FREE_1"}
    }"##;
    let input_path = write_temp("ori-native-oracle", ".ori", input.as_bytes());

    let oracle_summary = run_oracle(
        &oracle,
        &["ori-import-summary", input_path.to_str().unwrap()],
    );
    let document = ori::import_ori_json(input).expect("Rust ORI import should succeed");
    let rust_summary = document_summary(&document, Some(&document.crease_pattern.grid));
    assert_eq!(rust_summary, oracle_summary);

    let exported_document = oracle_fixture_document();
    let exported =
        ori::export_ori_json(&exported_document).expect("Rust ORI export should succeed");
    let export_path = write_temp("ori-native-export-oracle", ".ori", exported.as_bytes());
    let oracle_summary = run_oracle(
        &oracle,
        &["ori-import-summary", export_path.to_str().unwrap()],
    );
    let rust_summary = document_summary(
        &exported_document,
        Some(&exported_document.crease_pattern.grid),
    );

    let _ = std::fs::remove_file(input_path);
    let _ = std::fs::remove_file(export_path);
    assert_eq!(rust_summary, oracle_summary);
}

#[test]
fn fold_topology_matches_oriedita_wireframe_oracle() {
    let Some(oracle) = io_oracle() else {
        eprintln!("skipping Oriedita IO oracle test: ORIEDITA_IO_ORACLE is not set");
        return;
    };

    let cases = vec![
        vec![
            LineSegment::with_color(
                Point::new(0.0, -200.0),
                Point::new(-200.0, 0.0),
                LineColor::Red1,
            ),
            LineSegment::with_color(
                Point::new(-200.0, 0.0),
                Point::new(0.0, 200.0),
                LineColor::Red1,
            ),
            LineSegment::with_color(
                Point::new(0.0, 200.0),
                Point::new(200.0, 0.0),
                LineColor::Red1,
            ),
            LineSegment::with_color(
                Point::new(200.0, 0.0),
                Point::new(0.0, -200.0),
                LineColor::Red1,
            ),
        ],
        vec![
            LineSegment::with_color(
                Point::new(-200.0, -200.0),
                Point::new(-117.15728752538098, 0.0),
                LineColor::Blue2,
            ),
            LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(-117.15728752538098, 0.0),
                LineColor::Blue2,
            ),
            LineSegment::with_color(
                Point::new(-200.0, 200.0),
                Point::new(-117.15728752538098, 0.0),
                LineColor::Blue2,
            ),
            LineSegment::with_color(
                Point::new(-200.0, -200.0),
                Point::new(0.0, -117.15728752538098),
                LineColor::Blue2,
            ),
            LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(0.0, -117.15728752538098),
                LineColor::Blue2,
            ),
            LineSegment::with_color(
                Point::new(200.0, -200.0),
                Point::new(0.0, -117.15728752538098),
                LineColor::Blue2,
            ),
        ],
    ];

    for segments in cases {
        let mut model = CreasePatternModel::default();
        for segment in segments {
            model.add_line_segment(segment);
        }

        let mut args = vec![
            "fold-topology-summary".to_string(),
            model.line_segments.len().to_string(),
        ];
        push_segment_args(&mut args, &model.line_segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();
        let oracle_summary = run_oracle(&oracle, &oracle_args);
        let rust_summary = fold_topology_summary(&model);

        assert_eq!(rust_summary, oracle_summary);
    }
}

fn native_io_oracle() -> Option<PathBuf> {
    std::env::var("ORIEDITA_NATIVE_IO_ORACLE")
        .ok()
        .map(|oracle| resolve_oracle_path(&oracle))
}

fn io_oracle() -> Option<PathBuf> {
    std::env::var("ORIEDITA_IO_ORACLE")
        .or_else(|_| std::env::var("ORIEDITA_GEOMETRY_ORACLE"))
        .ok()
        .map(|oracle| resolve_oracle_path(&oracle))
}

fn resolve_oracle_path(oracle: &str) -> PathBuf {
    let path = PathBuf::from(oracle);
    if path.is_absolute() || path.exists() {
        return path;
    }

    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

fn run_oracle(oracle: &Path, args: &[&str]) -> String {
    let output = Command::new(oracle)
        .args(args)
        .output()
        .unwrap_or_else(|err| panic!("failed to run Oriedita IO oracle {oracle:?}: {err}"));

    assert!(
        output.status.success(),
        "Oriedita IO oracle failed with status {:?}: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );

    String::from_utf8(output.stdout).expect("oracle stdout should be valid UTF-8")
}

fn write_temp(prefix: &str, extension: &str, bytes: &[u8]) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "{prefix}-{}-{}{extension}",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    std::fs::write(&path, bytes).expect("write oracle fixture");
    path
}

fn oracle_fixture_document() -> CreasePatternDocument {
    let mut document = CreasePatternDocument {
        title: Some("oracle".to_string()),
        ..CreasePatternDocument::default()
    };
    document.crease_pattern.add_line_segment(
        LineSegment::with_color(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            LineColor::Blue2,
        )
        .with_customized_color(RgbColor::new(1, 2, 3)),
    );
    document
        .crease_pattern
        .add_circle(Circle::new(5.0, 5.0, 2.0, LineColor::Magenta5));
    document
        .crease_pattern
        .add_aux_line_segment(LineSegment::with_color(
            Point::new(1.0, 1.0),
            Point::new(2.0, 2.0),
            LineColor::Orange4,
        ));
    document.crease_pattern.grid.base_state = GridState::Hidden;
    document.crease_pattern.grid.set_grid_size(24);
    document
}

fn document_summary(document: &CreasePatternDocument, grid: Option<&GridMetadata>) -> String {
    model_summary(document.title.as_deref(), &document.crease_pattern, grid)
}

fn model_summary(
    title: Option<&str>,
    model: &CreasePatternModel,
    grid: Option<&GridMetadata>,
) -> String {
    let mut output = String::new();
    output.push_str(&format!("title|{}\n", title.unwrap_or_default()));
    output.push_str(&format!("lines|{}\n", model.line_segments.len()));
    for segment in &model.line_segments {
        push_segment(&mut output, "line", segment);
    }
    output.push_str(&format!("circles|{}\n", model.circles.len()));
    for circle in &model.circles {
        output.push_str(&format!(
            "circle|{}|{}|{}|{}|{}|{}|{}|{}\n",
            java_double_string(circle.x),
            java_double_string(circle.y),
            java_double_string(circle.r),
            circle.color.number(),
            circle.customized,
            circle.customized_color.red,
            circle.customized_color.green,
            circle.customized_color.blue
        ));
    }
    output.push_str(&format!("aux|{}\n", model.aux_line_segments.len()));
    for segment in &model.aux_line_segments {
        push_segment(&mut output, "auxline", segment);
    }
    if let Some(grid) = grid {
        output.push_str(&format!(
            "grid|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}\n",
            grid.interval_grid_size,
            grid.grid_size,
            java_double_string(grid.grid_xa),
            java_double_string(grid.grid_xb),
            java_double_string(grid.grid_xc),
            java_double_string(grid.grid_ya),
            java_double_string(grid.grid_yb),
            java_double_string(grid.grid_yc),
            java_double_string(grid.grid_angle),
            grid.base_state.state(),
            grid.vertical_scale_position,
            grid.horizontal_scale_position,
            grid.draw_diagonal_gridlines
        ));
    } else {
        output.push_str("grid|null\n");
    }
    output
}

fn push_segment(output: &mut String, prefix: &str, segment: &LineSegment) {
    output.push_str(&format!(
        "{prefix}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}\n",
        java_double_string(segment.a.x),
        java_double_string(segment.a.y),
        java_double_string(segment.b.x),
        java_double_string(segment.b.y),
        segment.color.number(),
        active_state_name(segment.active),
        segment.selected,
        segment.customized,
        segment.customized_color.red,
        segment.customized_color.green,
        segment.customized_color.blue
    ));
}

fn push_segment_args(args: &mut Vec<String>, segments: &[LineSegment]) {
    for segment in segments {
        args.push(segment.a.x.to_string());
        args.push(segment.a.y.to_string());
        args.push(segment.b.x.to_string());
        args.push(segment.b.y.to_string());
        args.push(segment.color.number().to_string());
    }
}

fn fold_topology_summary(model: &CreasePatternModel) -> String {
    let document = fold::export_fold_document(model, None);
    let mut output = String::new();
    output.push_str(&format!(
        "topology|{}|{}|{}|{}\n",
        document.vertices_coords.len(),
        document.edges_vertices.len(),
        document.faces_vertices.len(),
        !document.faces_vertices.is_empty()
    ));
    for (index, coords) in document.vertices_coords.iter().enumerate() {
        output.push_str(&format!(
            "vertex|{}|{}|{}\n",
            index,
            java_double_string(coords[0]),
            java_double_string(coords[1])
        ));
    }
    for (index, edge) in document.edges_vertices.iter().enumerate() {
        let color = topology_edge_color(model, index);
        output.push_str(&format!(
            "edge|{}|{}|{}|{}\n",
            index,
            edge[0],
            edge[1],
            color.number()
        ));
    }
    push_fold_faces(&mut output, &document);
    output
}

fn topology_edge_color(model: &CreasePatternModel, index: usize) -> LineColor {
    model
        .line_segments
        .get(index)
        .map(|segment| segment.color)
        .unwrap_or(LineColor::Black0)
}

fn push_fold_faces(output: &mut String, document: &FoldDocument) {
    for (index, face) in document.faces_vertices.iter().enumerate() {
        let points = face
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(",");
        output.push_str(&format!("face|{}|{}\n", index, points));

        let edges = document
            .faces_edges
            .get(index)
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(",");
        output.push_str(&format!("face_edges|{}|{}\n", index, edges));
    }
}

fn active_state_name(active: ActiveState) -> &'static str {
    match active {
        ActiveState::Inactive0 => "INACTIVE_0",
        ActiveState::ActiveA1 => "ACTIVE_A_1",
        ActiveState::ActiveB2 => "ACTIVE_B_2",
        ActiveState::ActiveBoth3 => "ACTIVE_BOTH_3",
    }
}

fn java_double_string(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}
