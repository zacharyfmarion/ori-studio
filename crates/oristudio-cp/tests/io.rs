use oristudio_cp::geometry::{Circle, LineColor, LineSegment, Point, RgbColor};
use oristudio_cp::io::{cp, dxf, fold, obj, orh, ori};
use oristudio_cp::model::{CreasePatternModel, GridState, TextElement};
use oristudio_cp::{
    CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument, OperationId,
    TextCommandAction, execute_command,
};

/// Full text pipeline: author annotations through the command layer (CreateAt +
/// Move, as the Text tool does), export to both interchange formats, re-import, and
/// assert the texts survive byte-for-byte — including a multi-line body. This is the
/// Oriedita-compatibility gate for text creation.
#[test]
fn text_command_pipeline_round_trips_through_ori_and_fold() {
    let mut document = CreasePatternDocument::default();

    let create = |point: Point, content: &str| {
        CreasePatternCommand::new(OperationId::Text).with_payload(CreasePatternCommandPayload {
            text_action: Some(TextCommandAction::CreateAt),
            points: vec![point],
            text_content: Some(content.to_string()),
            ..CreasePatternCommandPayload::default()
        })
    };

    execute_command(&mut document, create(Point::new(1.5, 2.5), "alpha"))
        .expect("create first text");
    execute_command(
        &mut document,
        create(Point::new(10.0, 20.0), "multi\nline\nnote"),
    )
    .expect("create multi-line text");

    // Move the first text via the command layer (delta = points[1] - points[0]).
    execute_command(
        &mut document,
        CreasePatternCommand::new(OperationId::Text).with_payload(CreasePatternCommandPayload {
            text_action: Some(TextCommandAction::Move),
            text_ids: vec![1],
            points: vec![Point::new(0.0, 0.0), Point::new(3.0, -1.0)],
            ..CreasePatternCommandPayload::default()
        }),
    )
    .expect("move first text");

    let expected = vec![
        TextElement::new(4.5, 1.5, "alpha"),
        TextElement::new(10.0, 20.0, "multi\nline\nnote"),
    ];
    assert_eq!(document.crease_pattern.texts, expected);

    // .ori round-trip.
    let ori_json = ori::export_ori_json(&document).expect("export ori");
    let from_ori = ori::import_ori_json(&ori_json).expect("import ori");
    assert_eq!(from_ori.crease_pattern.texts, expected);

    // FOLD round-trip (oriedita:texts_coords / texts_text extensions).
    let fold_json = fold::export_fold_file_document_json(&document).expect("export fold");
    let from_fold = fold::import_fold_file_document_json(&fold_json).expect("import fold");
    assert_eq!(from_fold.crease_pattern.texts, expected);
}

#[test]
fn cp_import_and_export_preserve_oriedita_assignment_numbers() {
    let input = "\
1 200.0 200.0 200.0 -200.0
3 200.0 200.0 0.0 0.0
2 0.0 0.0 -200.0 -200.0
4 1.5 2.25 3.5 4.75
";

    let model = cp::import_cp_str(input).expect("valid cp");
    assert_eq!(model.line_segments.len(), 4);
    assert_eq!(model.line_segments[0].color, LineColor::Black0);
    assert_eq!(model.line_segments[1].color, LineColor::Red1);
    assert_eq!(model.line_segments[2].color, LineColor::Blue2);
    assert_eq!(model.line_segments[3].color, LineColor::Cyan3);

    assert_eq!(cp::export_cp_string(&model), input);
}

#[test]
fn cp_export_collapses_extended_line_colors_to_auxiliary_code() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::None);
    model.add_line(
        Point::new(0.0, 1.0),
        Point::new(1.0, 1.0),
        LineColor::Purple8,
    );

    assert_eq!(
        cp::export_cp_string(&model),
        "4 0.0 0.0 1.0 0.0\n4 0.0 1.0 1.0 1.0\n"
    );
}

#[test]
fn fold_import_reads_edges_and_oriedita_extensions() {
    let input = r##"{
      "file_spec": 1.1,
      "vertices_coords": [[0, 0], [10, 0], [10, 10]],
      "edges_vertices": [[0, 1], [1, 2]],
      "edges_assignment": ["B", "M"],
      "oriedita:edges_colors": ["", "ffff33"],
      "oriedita:circles_coords": [[5, 5]],
      "oriedita:circles_radii": [2],
      "oriedita:circles_colors": ["3"],
      "oriedita:circles_custom_colors": ["64c8c8"],
      "oriedita:texts_coords": [[1, 2]],
      "oriedita:texts_text": ["note"],
      "oriedita:grid_size": 16,
      "oriedita:grid_style": 2
    }"##;

    let model = fold::import_fold_json(input).expect("valid fold");
    assert_eq!(model.line_segments.len(), 2);
    assert_eq!(model.line_segments[0].color, LineColor::Black0);
    assert_eq!(model.line_segments[1].color, LineColor::Red1);
    assert_eq!(model.line_segments[0].a, Point::new(-200.0, -200.0));
    assert_eq!(model.line_segments[0].b, Point::new(200.0, -200.0));
    assert_eq!(model.line_segments[1].a, Point::new(200.0, -200.0));
    assert_eq!(model.line_segments[1].b, Point::new(200.0, 200.0));
    assert_eq!(model.line_segments[1].customized, 1);
    assert_eq!(
        model.line_segments[1].customized_color,
        RgbColor::new(255, 255, 51)
    );
    assert_eq!(model.circles.len(), 1);
    assert_eq!(model.circles[0].color, LineColor::Cyan3);
    assert_eq!(
        model.circles[0].customized_color,
        RgbColor::new(100, 200, 200)
    );
    assert_eq!(model.circles[0].determine_center(), Point::new(5.0, 5.0));
    assert_eq!(model.texts[0].position(), Point::new(1.0, 2.0));
    assert_eq!(model.texts[0].text, "note");
    assert_eq!(model.grid.grid_size, 16);
    assert_eq!(model.grid.base_state, GridState::Full);
}

#[test]
fn fold_file_import_export_preserves_embedded_folded_form_frames() {
    let input = r#"{
      "file_spec": 1.2,
      "file_title": "embedded folded form",
      "frame_title": "crease pattern",
      "frame_classes": ["creasePattern"],
      "vertices_coords": [[0, 0], [1, 0]],
      "edges_vertices": [[0, 1]],
      "file_frames": [{
        "frame_title": "folded result",
        "frame_classes": ["foldedForm"],
        "frame_parent": 0,
        "frame_inherit": true,
        "vertices_coords": [[0, 0], [0.5, 0], [0, 0.5]],
        "edges_vertices": [[0, 1], [1, 2], [2, 0]],
        "faces_vertices": [[0, 1, 2]],
        "faceOrders": [[0, 0, -1]],
        "oriedita:folded_view": {"state": "FRONT_0"}
      }]
    }"#;

    let document = fold::import_fold_file_json(input).expect("valid fold file");
    let frames = fold::import_folded_frames(&document);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].frame_title.as_deref(), Some("folded result"));
    assert_eq!(frames[0].frame_classes, vec!["foldedForm"]);
    assert_eq!(frames[0].frame_parent, Some(0));
    assert_eq!(frames[0].frame_inherit, Some(true));

    let mut replaced = document.clone();
    fold::export_folded_frames(&mut replaced, document.file_frames.clone());
    let json = fold::export_fold_file_json(&replaced).expect("serializes");
    let exported: serde_json::Value = serde_json::from_str(&json).expect("json");

    assert_eq!(
        exported["file_frames"][0]["frame_classes"],
        serde_json::json!(["foldedForm"])
    );
    assert_eq!(
        exported["file_frames"][0]["faceOrders"],
        serde_json::json!([[0, 0, -1]])
    );
    assert_eq!(
        exported["file_frames"][0]["oriedita:folded_view"],
        serde_json::json!({"state": "FRONT_0"})
    );
}

#[test]
fn fold_file_document_import_export_preserves_frames_while_updating_root_cp() {
    let input = r#"{
      "file_spec": 1.2,
      "file_title": "source fold",
      "file_author": "folder",
      "frame_title": "crease pattern",
      "frame_classes": ["creasePattern"],
      "vertices_coords": [[0, 0], [1, 0]],
      "edges_vertices": [[0, 1]],
      "edges_assignment": ["M"],
      "rootCustom": {"kept": true},
      "file_frames": [{
        "frame_title": "folded result",
        "frame_classes": ["foldedForm"],
        "vertices_coords": [[0, 0], [1, 0], [0, 1]],
        "edges_vertices": [[0, 1], [1, 2], [2, 0]],
        "faces_vertices": [[0, 1, 2]],
        "faceOrders": [[0, 0, -1]]
      }]
    }"#;

    let mut document = fold::import_fold_file_document_json(input).expect("valid fold file");
    assert_eq!(document.title.as_deref(), Some("crease pattern"));
    assert!(document.metadata.contains_key(fold::FOLD_FILE_METADATA_KEY));
    document.crease_pattern.line_segments[0].color = LineColor::Blue2;

    let json = fold::export_fold_file_document_json(&document).expect("serializes");
    let exported: serde_json::Value = serde_json::from_str(&json).expect("json");

    assert_eq!(exported["file_author"], "folder");
    assert_eq!(exported["rootCustom"], serde_json::json!({"kept": true}));
    assert_eq!(exported["edges_assignment"][0], "V");
    assert_eq!(
        exported["file_frames"][0]["frame_classes"],
        serde_json::json!(["foldedForm"])
    );
    assert_eq!(
        exported["file_frames"][0]["faceOrders"],
        serde_json::json!([[0, 0, -1]])
    );
}

#[test]
fn fold_file_document_import_export_preserves_multiple_nested_frames_exactly() {
    let input = r#"{
      "file_spec": 1.2,
      "file_title": "nested source fold",
      "frame_title": "crease pattern",
      "frame_classes": ["creasePattern", "orieditaRoot"],
      "vertices_coords": [[0, 0], [0, 10], [10, 10]],
      "edges_vertices": [[0, 1], [1, 2]],
      "edges_assignment": ["M", "V"],
      "rootCustom": {"kept": true},
      "file_frames": [{
        "frame_title": "folded result front",
        "frame_classes": ["foldedForm"],
        "frame_parent": 0,
        "frame_inherit": true,
        "vertices_coords": [[0, 0], [1, 0], [0, 1]],
        "edges_vertices": [[0, 1], [1, 2], [2, 0]],
        "faces_vertices": [[0, 1, 2]],
        "faceOrders": [[0, 0, -1]],
        "oriedita:folded_view": {"state": "FRONT_0"},
        "file_frames": [{
          "frame_title": "nested annotation",
          "frame_classes": ["metadata"],
          "frame_parent": 1,
          "vertices_coords": [[2, 2], [3, 2]],
          "edges_vertices": [[0, 1]],
          "customNested": [{"keep": "me"}]
        }]
      }, {
        "frame_title": "folded result back",
        "frame_classes": ["foldedForm"],
        "frame_parent": 0,
        "frame_inherit": false,
        "vertices_coords": [[5, 5], [6, 5], [5, 6]],
        "edges_vertices": [[0, 1], [1, 2], [2, 0]],
        "faces_vertices": [[0, 1, 2]],
        "faceOrders": [[0, 0, 1]],
        "unknownArray": [1, {"two": 2}]
      }]
    }"#;
    let original = fold::import_fold_file_json(input).expect("valid fold file");

    let mut document = fold::import_fold_file_document_json(input).expect("valid fold file");
    document.crease_pattern.line_segments[0].color = LineColor::Blue2;
    document.crease_pattern.line_segments[1].color = LineColor::Red1;

    let json = fold::export_fold_file_document_json(&document).expect("serializes");
    let exported = fold::import_fold_file_json(&json).expect("exported fold file");
    let exported_value: serde_json::Value = serde_json::from_str(&json).expect("json");

    assert_eq!(exported.file_frames, original.file_frames);
    assert_eq!(
        exported.frame_classes,
        vec!["creasePattern".to_string(), "orieditaRoot".to_string()]
    );
    assert_eq!(
        exported_value["rootCustom"],
        serde_json::json!({"kept": true})
    );
    assert_eq!(
        exported_value["edges_assignment"],
        serde_json::json!(["V", "M"])
    );
}

/// The extension is the more expressive of the two encodings: all eight
/// auxiliary colours map to `F`, so `edges_assignment` alone would flatten
/// Purple8 to Cyan3. Where the two agree, the colour wins and that detail
/// survives.
#[test]
fn fold_import_prefers_oristudio_line_color_extension_over_assignment() {
    let input = r##"{
      "file_spec": 1.1,
      "vertices_coords": [[0, 0], [10, 0], [10, 10]],
      "edges_vertices": [[0, 1], [1, 2]],
      "edges_assignment": ["F", "U"],
      "oristudio:edges_line_colors": [8, -1]
    }"##;

    let model = fold::import_fold_json(input).expect("valid fold");

    assert_eq!(model.line_segments[0].color, LineColor::Purple8);
    assert_eq!(model.line_segments[1].color, LineColor::None);
}

/// A colour that contradicts `edges_assignment` is describing some other edge:
/// the pair is only ever written together, so they cannot legitimately disagree.
/// Preferring the extension unconditionally is how a rebuilt edge list twice
/// shipped crease patterns with borders turned into mountains and valleys, so a
/// conflicting entry loses to the standard field instead of silently winning.
#[test]
fn fold_import_falls_back_to_assignment_when_line_color_conflicts() {
    let input = r##"{
      "file_spec": 1.1,
      "vertices_coords": [[0, 0], [10, 0], [10, 10], [0, 10]],
      "edges_vertices": [[0, 1], [1, 2], [2, 3]],
      "edges_assignment": ["B", "M", "V"],
      "oristudio:edges_line_colors": [2, 0, 1]
    }"##;

    let model = fold::import_fold_json(input).expect("valid fold");

    assert_eq!(model.line_segments[0].color, LineColor::Black0);
    assert_eq!(model.line_segments[1].color, LineColor::Red1);
    assert_eq!(model.line_segments[2].color, LineColor::Blue2);
}

/// Guard the fallback's precondition: `assignment_for_edge` reports `Unassigned`
/// for an absent array, so cross-checking against it unconditionally would
/// discard every colour in a document that carries only the extension.
#[test]
fn fold_import_keeps_line_colors_when_assignments_are_absent() {
    let input = r##"{
      "file_spec": 1.1,
      "vertices_coords": [[0, 0], [10, 0], [10, 10]],
      "edges_vertices": [[0, 1], [1, 2]],
      "oristudio:edges_line_colors": [1, 8]
    }"##;

    let model = fold::import_fold_json(input).expect("valid fold");

    assert_eq!(model.line_segments[0].color, LineColor::Red1);
    assert_eq!(model.line_segments[1].color, LineColor::Purple8);
}

#[test]
fn fold_import_defaults_missing_oriedita_grid_style_to_hidden_like_oriedita() {
    let input = r#"{
      "file_spec": 1.1,
      "vertices_coords": [[0, 0], [10, 0]],
      "edges_vertices": [[0, 1]],
      "edges_assignment": ["B"]
    }"#;

    let model = fold::import_fold_json(input).expect("valid fold");

    assert_eq!(model.grid.grid_size, 8);
    assert_eq!(model.grid.base_state, GridState::Hidden);
}

#[test]
fn fold_export_round_trips_canonical_model_data() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(
        LineSegment::from_coordinates(-200.0, -200.0, 200.0, -200.0)
            .with_line_color(LineColor::Blue2)
            .with_customized_color(RgbColor::new(1, 2, 3)),
    );
    model.add_line(
        Point::new(-200.0, -200.0),
        Point::new(-200.0, 200.0),
        LineColor::Cyan3,
    );
    model.add_circle(
        Circle::new(5.0, 5.0, 2.0, LineColor::Magenta5)
            .with_customized_color(RgbColor::new(100, 200, 200)),
    );
    model.add_text(TextElement::new(3.0, 4.0, "hello"));
    model.grid.set_grid_size(12);
    model.grid.base_state = GridState::Hidden;

    let json = fold::export_fold_json(&model, Some("fold".to_string())).expect("serializes");
    let exported: serde_json::Value = serde_json::from_str(&json).expect("json");
    assert_eq!(
        exported["oristudio:edges_line_colors"],
        serde_json::json!([2, 3])
    );
    let imported = fold::import_fold_json(&json).expect("imports exported fold");

    assert_eq!(model.canonical(1.0e-9), imported.canonical(1.0e-9));
}

#[test]
fn fold_export_preserves_extended_line_color_metadata_with_standard_assignments() {
    let mut model = CreasePatternModel::default();
    model.add_line(
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Purple8,
    );
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::None);

    let json = fold::export_fold_json(&model, Some("colors".to_string())).expect("serializes");
    let exported: serde_json::Value = serde_json::from_str(&json).expect("json");

    assert_eq!(exported["edges_assignment"], serde_json::json!(["F", "U"]));
    assert_eq!(
        exported["oristudio:edges_line_colors"],
        serde_json::json!([8, -1])
    );

    let imported = fold::import_fold_json(&json).expect("imports exported fold");
    assert_eq!(imported.line_segments[0].color, LineColor::Purple8);
    assert_eq!(imported.line_segments[1].color, LineColor::None);
}

#[test]
fn fold_export_reconstructs_oriedita_face_topology() {
    let mut model = CreasePatternModel::default();
    for (a, b) in [
        (Point::new(0.0, -200.0), Point::new(-200.0, 0.0)),
        (Point::new(-200.0, 0.0), Point::new(0.0, 200.0)),
        (Point::new(0.0, 200.0), Point::new(200.0, 0.0)),
        (Point::new(200.0, 0.0), Point::new(0.0, -200.0)),
    ] {
        model.add_line(a, b, LineColor::Red1);
    }

    let document = fold::export_fold_document(&model, None);

    assert_eq!(document.file_spec, Some(1.1));
    assert_eq!(document.file_creator.as_deref(), Some("oriedita"));
    assert_eq!(
        document.vertices_coords,
        vec![
            vec![0.0, -200.0],
            vec![-200.0, 0.0],
            vec![0.0, 200.0],
            vec![200.0, 0.0],
        ]
    );
    assert_eq!(
        document.edges_vertices,
        vec![[0, 1], [1, 2], [2, 3], [3, 0]]
    );
    assert_eq!(document.faces_vertices, vec![vec![0, 1, 2, 3]]);
    assert_eq!(document.faces_edges, vec![vec![3, 0, 1, 2]]);
    assert_eq!(document.extra["oriedita:version"], "dev");
    assert!(!document.extra.contains_key("oriedita:circles_coords"));
    assert!(!document.extra.contains_key("oriedita:texts_coords"));
}

#[test]
fn fold_export_suppresses_faces_when_oriedita_euler_check_fails() {
    let mut model = CreasePatternModel::default();
    for (a, b) in [
        (
            Point::new(-200.0, -200.0),
            Point::new(-117.15728752538098, 0.0),
        ),
        (Point::new(0.0, 0.0), Point::new(-117.15728752538098, 0.0)),
        (
            Point::new(-200.0, 200.0),
            Point::new(-117.15728752538098, 0.0),
        ),
        (
            Point::new(-200.0, -200.0),
            Point::new(0.0, -117.15728752538098),
        ),
        (Point::new(0.0, 0.0), Point::new(0.0, -117.15728752538098)),
        (
            Point::new(200.0, -200.0),
            Point::new(0.0, -117.15728752538098),
        ),
    ] {
        model.add_line(a, b, LineColor::Blue2);
    }

    let document = fold::export_fold_document(&model, None);

    assert!(document.faces_vertices.is_empty());
    assert!(document.faces_edges.is_empty());
}

#[test]
fn dxf_export_uses_oriedita_layers_and_coordinate_transform() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);

    let output = dxf::export_dxf_string(&model);
    assert!(output.contains("MountainLine"));
    assert!(output.contains("\n  62\n1\n"));
    assert!(output.contains("\n  10\n604.0\n"));
    assert!(output.contains("\n  20\n604.0\n"));
}

#[test]
fn obj_import_matches_oriedita_face_edge_and_dummy_line_behavior() {
    let input = "\
v 0 0 0
v 10 0 0
v 0 10 0
f 1 2 3
";

    let model = obj::import_obj_str(input).expect("valid obj");
    assert_eq!(model.line_segments.len(), 4);
    assert_eq!(model.line_segments[0].color, LineColor::None);
    assert_eq!(model.line_segments[1].a, Point::new(0.0, 10.0));
    assert_eq!(model.line_segments[1].b, Point::new(0.0, 0.0));
}

#[test]
fn ori_import_reads_oriedita_save_json() {
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

    let document = ori::import_ori_json(input).expect("valid ori");
    let model = &document.crease_pattern;

    assert_eq!(document.title.as_deref(), Some("_"));
    assert_eq!(model.line_segments.len(), 1);
    assert_eq!(model.line_segments[0].color, LineColor::Red1);
    assert_eq!(
        model.line_segments[0].active,
        oristudio_cp::geometry::ActiveState::Inactive0
    );
    assert_eq!(model.line_segments[0].selected, 2);
    assert_eq!(
        model.line_segments[0].customized_color,
        RgbColor::new(1, 2, 3)
    );
    assert_eq!(model.circles[0].color, LineColor::Cyan3);
    assert_eq!(model.texts[0].text, "note");
    assert_eq!(model.points[0], Point::new(3.0, 4.0));
    assert_eq!(model.aux_line_segments[0].color, LineColor::Yellow7);
    assert_eq!(model.grid.interval_grid_size, 5);
    assert_eq!(model.grid.grid_size, 16);
    assert_eq!(model.grid.grid_angle, 45.0);
    assert_eq!(model.grid.base_state, GridState::Full);
    assert_eq!(
        ori::ori_metadata_field(&document, ori::ORI_CANVAS_MODEL_FIELD),
        Some(&serde_json::json!({"mouseMode": "DRAW_CREASE_FREE_1"}))
    );
}

#[test]
fn ori_import_preserves_editor_models_for_native_interchange() {
    let input = r##"{
      "@version": "v1.1",
      "lineSegments": [],
      "creasePatternCamera": {
        "cameraPositionX": 12.5,
        "cameraPositionY": -3.25,
        "cameraZoomX": 1.5,
        "extraCameraField": {"nested": true}
      },
      "canvasModel": {"mouseMode": "MOVE_CREASE_PATTERN_2"},
      "foldedFigureModel": {
        "frontColor": "ffcc0000",
        "backColor": "ff3366ff",
        "displayStyle": "PAPER_5",
        "foldedCases": 4,
        "foldedFigure": {
          "vertices": [[0, 0], [1, 0], [0, 1]],
          "faces": [[0, 1, 2]]
        },
        "unknownNestedModel": {"kept": ["yes"]}
      },
      "applicationModel": {"displayCpLines": true},
      "futureSaveModel": {"still": "lossless"}
    }"##;

    let document = ori::import_ori_json(input).expect("valid ori");
    let editor_models = ori::OrieditaEditorModels::from_document(&document);

    assert_eq!(
        editor_models.crease_pattern_camera,
        Some(serde_json::json!({
          "cameraPositionX": 12.5,
          "cameraPositionY": -3.25,
          "cameraZoomX": 1.5,
          "extraCameraField": {"nested": true}
        }))
    );
    assert_eq!(
        editor_models
            .folded_figure_model
            .as_ref()
            .and_then(|value| {
                value
                    .get("unknownNestedModel")
                    .and_then(|nested| nested.get("kept"))
            }),
        Some(&serde_json::json!(["yes"]))
    );
    assert_eq!(
        ori::ori_metadata_field(&document, "futureSaveModel"),
        Some(&serde_json::json!({"still": "lossless"}))
    );
    assert!(ori::is_ori_editor_model_field(
        ori::ORI_FOLDED_FIGURE_MODEL_FIELD
    ));
}

#[test]
fn ori_export_round_trips_canonical_model_data_and_metadata() {
    let mut document = CreasePatternDocument {
        title: Some("model".to_string()),
        ..CreasePatternDocument::default()
    };
    document.crease_pattern.add_line_segment(
        LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0)
            .with_line_color(LineColor::Blue2)
            .with_customized_color(RgbColor::new(10, 20, 30)),
    );
    document
        .crease_pattern
        .add_aux_line_segment(LineSegment::with_color(
            Point::new(1.0, 1.0),
            Point::new(2.0, 2.0),
            LineColor::Orange4,
        ));
    document
        .crease_pattern
        .add_circle(Circle::new(5.0, 5.0, 2.0, LineColor::Magenta5));
    document
        .crease_pattern
        .add_text(TextElement::new(3.0, 4.0, "hello"));
    document.crease_pattern.add_point(Point::new(-1.0, -2.0));
    document.crease_pattern.grid.base_state = GridState::Hidden;
    ori::set_ori_metadata_field(
        &mut document,
        ori::ORI_APPLICATION_MODEL_FIELD,
        serde_json::Value::Null,
    );

    let json = ori::export_ori_json(&document).expect("serializes ori");
    let exported: serde_json::Value = serde_json::from_str(&json).expect("json");

    assert_eq!(exported["@version"], "v1.1");
    assert_eq!(exported["lineSegments"][0]["color"], "BLUE_2");
    assert_eq!(exported["lineSegments"][0]["customizedColor"], "ff0a141e");
    assert!(exported.get("applicationModel").is_some());

    let imported = ori::import_ori_json(&json).expect("imports exported ori");
    assert_eq!(document.canonical(1.0e-9), imported.canonical(1.0e-9));
    assert_eq!(
        ori::ori_metadata_field(&imported, ori::ORI_APPLICATION_MODEL_FIELD),
        Some(&serde_json::Value::Null)
    );
}

#[test]
fn ori_editor_models_apply_replaces_only_known_editor_model_fields() {
    let mut document = CreasePatternDocument::default();
    ori::set_ori_metadata_field(
        &mut document,
        ori::ORI_CANVAS_MODEL_FIELD,
        serde_json::json!({"stale": true}),
    );
    ori::set_ori_metadata_field(
        &mut document,
        "futureSaveModel",
        serde_json::json!({"keep": true}),
    );

    ori::OrieditaEditorModels {
        crease_pattern_camera: Some(serde_json::json!({"cameraZoomX": 2.0})),
        canvas_model: None,
        folded_figure_model: Some(serde_json::json!({"foldedCases": 2})),
        application_model: Some(serde_json::Value::Null),
    }
    .apply_to_document(&mut document);

    assert_eq!(
        ori::ori_metadata_field(&document, ori::ORI_CREASE_PATTERN_CAMERA_FIELD),
        Some(&serde_json::json!({"cameraZoomX": 2.0}))
    );
    assert_eq!(
        ori::ori_metadata_field(&document, ori::ORI_FOLDED_FIGURE_MODEL_FIELD),
        Some(&serde_json::json!({"foldedCases": 2}))
    );
    assert_eq!(
        ori::ori_metadata_field(&document, ori::ORI_APPLICATION_MODEL_FIELD),
        Some(&serde_json::Value::Null)
    );
    assert!(ori::ori_metadata_field(&document, ori::ORI_CANVAS_MODEL_FIELD).is_none());
    assert_eq!(
        ori::ori_metadata_field(&document, "futureSaveModel"),
        Some(&serde_json::json!({"keep": true}))
    );
}

#[test]
fn ori_import_has_explicit_unknown_version_policy() {
    let input = r#"{"@version":"v99","lineSegments":[]}"#;

    assert!(ori::import_ori_json(input).is_err());
    assert!(ori::import_ori_json_with_unknown_version(input, true).is_ok());
}

#[test]
fn orh_import_matches_oriedita_legacy_quirks() {
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
<補助線分集合>
補助番号,1
補助色,4
補助座標,1.0,1.0,2.0,2.0
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

    let document = orh::import_orh_str(input).expect("valid orh");
    let model = &document.crease_pattern;

    assert_eq!(document.title.as_deref(), Some("orh model"));
    assert_eq!(model.line_segments.len(), 2);
    assert_eq!(model.line_segments[0].color, LineColor::Red1);
    assert_eq!(
        model.line_segments[0].active,
        oristudio_cp::geometry::ActiveState::ActiveBoth3
    );
    assert_eq!(model.line_segments[0].selected, 2);
    assert_eq!(model.line_segments[0].customized, 1);
    assert_eq!(
        model.line_segments[0].customized_color,
        RgbColor::new(10, 20, 30)
    );
    assert_eq!(model.line_segments[1], LineSegment::default());
    assert_eq!(model.circles.len(), 2);
    assert_eq!(model.circles[0].color, LineColor::Cyan3);
    assert_eq!(model.circles[0].customized, 1);
    assert_eq!(model.circles[0].customized_color, RgbColor::new(40, 50, 60));
    assert_eq!(model.circles[1], Circle::default());
    assert!(model.aux_line_segments.is_empty());
    assert_eq!(model.grid.base_state, GridState::WithinPaper);
    assert_eq!(model.grid.grid_size, 8);
    assert_eq!(model.grid.interval_grid_size, 4);
    assert_eq!(model.grid.determine_grid_x_length(), 1.0);
    assert_eq!(model.grid.grid_angle, 90.0);

    assert!(orh::import_orh_bytes(input.as_bytes()).is_ok());
}

#[test]
fn orh_export_writes_oriedita_sections_and_imports_back_with_quirks() {
    let mut document = CreasePatternDocument {
        title: Some("exported".to_string()),
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

    let output = orh::export_orh_string(&document);

    assert!(output.contains("<タイトル>"));
    assert!(output.contains("タイトル,exported"));
    assert!(output.contains("色,2"));
    assert!(output.contains("<tpp_color_R>1</tpp_color_R>"));
    assert!(output.contains("<補助線分集合>"));
    assert!(output.contains("補助色,4"));
    assert!(output.contains("<i_kitei_jyoutai>0</i_kitei_jyoutai>"));
    assert!(output.contains("<nyuuryoku_kitei>24</nyuuryoku_kitei>"));

    let imported = orh::import_orh_str(&output).expect("imports exported orh");
    assert_eq!(imported.title.as_deref(), Some("exported"));
    assert_eq!(imported.crease_pattern.line_segments.len(), 2);
    assert_eq!(
        imported.crease_pattern.line_segments[0].a,
        Point::new(0.0, 0.0)
    );
    assert_eq!(
        imported.crease_pattern.line_segments[0].color,
        LineColor::Blue2
    );
    assert_eq!(imported.crease_pattern.line_segments[0].customized, 1);
    assert_eq!(imported.crease_pattern.circles.len(), 2);
    assert!(imported.crease_pattern.aux_line_segments.is_empty());
}

#[test]
fn orh_import_export_preserves_folded_figure_color_metadata() {
    let input = "\
<タイトル>
タイトル,folded colors
<線分集合>
<円集合>
<oriagarizu>
<oriagarizu_F_color_R>12</oriagarizu_F_color_R>
<oriagarizu_F_color_G>34</oriagarizu_F_color_G>
<oriagarizu_F_color_B>56</oriagarizu_F_color_B>
<oriagarizu_B_color_R>78</oriagarizu_B_color_R>
<oriagarizu_B_color_G>90</oriagarizu_B_color_G>
<oriagarizu_B_color_B>123</oriagarizu_B_color_B>
<oriagarizu_L_color_R>5</oriagarizu_L_color_R>
<oriagarizu_L_color_G>6</oriagarizu_L_color_G>
<oriagarizu_L_color_B>7</oriagarizu_L_color_B>
</oriagarizu>
";

    let document = orh::import_orh_str(input).expect("valid orh folded colors");

    assert_eq!(
        document.metadata.get("oriedita:orh:oriagarizu_front_color"),
        Some(&serde_json::json!([12, 34, 56]))
    );
    assert_eq!(
        document.metadata.get("oriedita:orh:oriagarizu_back_color"),
        Some(&serde_json::json!([78, 90, 123]))
    );
    assert_eq!(
        document.metadata.get("oriedita:orh:oriagarizu_line_color"),
        Some(&serde_json::json!([5, 6, 7]))
    );

    let output = orh::export_orh_string(&document);
    assert!(output.contains("<oriagarizu_F_color_R>12</oriagarizu_F_color_R>"));
    assert!(output.contains("<oriagarizu_B_color_G>90</oriagarizu_B_color_G>"));
    assert!(output.contains("<oriagarizu_L_color_B>7</oriagarizu_L_color_B>"));

    let imported = orh::import_orh_str(&output).expect("reimports exported orh");
    assert_eq!(imported.metadata, document.metadata);
}
