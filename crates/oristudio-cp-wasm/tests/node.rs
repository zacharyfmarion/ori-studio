use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn loads_cp_and_exports_document() {
    let handle = oristudio_cp_wasm::load_cp("1 0 0 1 0\n3 0 0 0 1\n", "sample")
        .expect("cp import should succeed");
    let summary = oristudio_cp_wasm::document_summary(handle).expect("summary should serialize");
    let summary: serde_json::Value =
        serde_wasm_bindgen::from_value(summary).expect("summary should deserialize");

    assert_eq!(summary["title"], "sample");
    assert_eq!(summary["line_segments"], 2);
    assert_eq!(summary["can_save_as_cp"], true);

    let exported = oristudio_cp_wasm::export_cp(handle).expect("cp export should succeed");
    assert!(exported.contains("1 0.0 0.0 1.0 0.0"));
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}

#[wasm_bindgen_test]
fn command_dispatch_returns_typed_not_implemented_error() {
    let handle =
        oristudio_cp_wasm::load_cp("1 0 0 1 0\n", "sample").expect("cp import should succeed");
    let error = oristudio_cp_wasm::execute_cp_command(
        handle,
        serde_wasm_bindgen::to_value("FoldingEstimate").expect("operation id should serialize"),
        serde_wasm_bindgen::to_value(&serde_json::json!({})).expect("payload should serialize"),
    )
    .expect_err("ported registry entries without command dispatch should return typed errors");
    let error: serde_json::Value =
        serde_wasm_bindgen::from_value(error).expect("error should deserialize");

    assert_eq!(error["code"], "not_implemented");
    assert!(
        error["message"]
            .as_str()
            .is_some_and(|message| message.contains("FoldingEstimate"))
    );
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}

#[wasm_bindgen_test]
fn folded_figure_session_exports_fold_and_followup_commands() {
    let handle = oristudio_cp_wasm::load_document(
        serde_wasm_bindgen::to_value(&foldable_square_document()).expect("document serializes"),
    )
    .expect("document load should succeed");

    let result = oristudio_cp_wasm::folded_figure_fold(
        handle,
        1,
        serde_wasm_bindgen::to_value("Order5").expect("order serializes"),
        JsValue::UNDEFINED,
    )
    .expect("folded figure should fold");
    let result: serde_json::Value =
        serde_wasm_bindgen::from_value(result).expect("fold result deserializes");
    let folded_handle = result["handle"].as_u64().expect("folded figure handle") as u32;

    assert_eq!(result["snapshot"]["display_style"], "Paper5");
    assert_eq!(result["snapshot"]["model"]["front_color"]["red"], 255);
    assert_eq!(
        result["snapshot"]["wireframe"]["faces"]
            .as_array()
            .expect("wireframe faces")
            .len(),
        2
    );

    let snapshot = oristudio_cp_wasm::folded_figure_snapshot(folded_handle)
        .expect("folded figure snapshot should serialize");
    let snapshot: serde_json::Value =
        serde_wasm_bindgen::from_value(snapshot).expect("snapshot deserializes");
    assert_eq!(snapshot["display_style"], "Paper5");

    let render_snapshot = oristudio_cp_wasm::folded_figure_render_snapshot(
        folded_handle,
        serde_wasm_bindgen::to_value("Paper5").expect("display style serializes"),
        serde_wasm_bindgen::to_value(&oristudio_cp::folding::FoldedFigureRenderOptions {
            display_mark: true,
            selected: true,
            display_numbers: true,
            index: 2,
            ..oristudio_cp::folding::FoldedFigureRenderOptions::default()
        })
        .expect("render options serialize"),
    )
    .expect("folded render snapshot should serialize");
    let render_snapshot: serde_json::Value =
        serde_wasm_bindgen::from_value(render_snapshot).expect("render snapshot deserializes");
    assert_eq!(render_snapshot["pass"], "paper-front-full");
    assert!(
        render_snapshot["primitives"]
            .as_array()
            .expect("render primitives")
            .iter()
            .any(|primitive| primitive["kind"] == "fill_polygon")
    );

    let updated_model = oristudio_cp::folding::FoldedFigureModel {
        state: oristudio_cp::folding::FoldedFigureState::Back1,
        display_shadows: true,
        transparent_transparency: 64,
        transparency_color: true,
        ..oristudio_cp::folding::FoldedFigureModel::default()
    };
    let updated = oristudio_cp_wasm::folded_figure_set_model(
        folded_handle,
        serde_wasm_bindgen::to_value(&updated_model).expect("model serializes"),
    )
    .expect("folded figure model should update");
    let updated: serde_json::Value =
        serde_wasm_bindgen::from_value(updated).expect("updated snapshot deserializes");
    assert_eq!(updated["model"]["state"], "Back1");
    assert_eq!(updated["model"]["display_shadows"], true);
    assert_eq!(updated["model"]["transparent_transparency"], 64);

    let back_render = oristudio_cp_wasm::folded_figure_render_snapshot(
        folded_handle,
        serde_wasm_bindgen::to_value("Paper5").expect("display style serializes"),
        JsValue::UNDEFINED,
    )
    .expect("updated folded render snapshot should serialize");
    let back_render: serde_json::Value =
        serde_wasm_bindgen::from_value(back_render).expect("back render snapshot deserializes");
    assert_eq!(back_render["pass"], "paper-back-full");

    let duplicate = oristudio_cp_wasm::folded_figure_duplicate(folded_handle)
        .expect("folded figure should duplicate");
    let duplicate: serde_json::Value =
        serde_wasm_bindgen::from_value(duplicate).expect("duplicate deserializes");
    let duplicate_handle = duplicate["handle"].as_u64().expect("duplicate handle") as u32;
    assert_ne!(duplicate_handle, folded_handle);
    assert_eq!(duplicate["snapshot"]["model"]["state"], "Back1");

    let specific = oristudio_cp_wasm::folded_figure_fold_to_case(
        folded_handle,
        3,
        serde_wasm_bindgen::to_value("Order5").expect("order serializes"),
    )
    .expect("fold-to-case should run");
    let specific: serde_json::Value =
        serde_wasm_bindgen::from_value(specific).expect("fold-to-case deserializes");
    assert_eq!(specific["snapshot"]["display_style"], "Paper5");
    assert_eq!(specific["discovered_case_numbers"], serde_json::json!([1]));

    let another = oristudio_cp_wasm::folded_figure_fold_another(folded_handle)
        .expect("fold another should run");
    let another: serde_json::Value =
        serde_wasm_bindgen::from_value(another).expect("fold another deserializes");
    assert_eq!(another["display_style"], "Paper5");

    oristudio_cp_wasm::free_folded_figure(folded_handle).expect("folded handle should free");
    oristudio_cp_wasm::free_folded_figure(duplicate_handle)
        .expect("duplicate folded handle should free");
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}

#[wasm_bindgen_test]
fn command_dispatch_accepts_resolved_line_payloads() {
    let handle = oristudio_cp_wasm::load_cp("2 0 0 1 0\n3 0 0 0 1\n", "sample")
        .expect("cp import should succeed");
    let result = oristudio_cp_wasm::execute_cp_command(
        handle,
        serde_wasm_bindgen::to_value("CreaseMakeMountain").expect("operation id should serialize"),
        serde_wasm_bindgen::to_value(&oristudio_cp::CreasePatternCommandPayload {
            line_ids: vec![1, 2],
            ..oristudio_cp::CreasePatternCommandPayload::default()
        })
        .expect("payload should serialize"),
    )
    .expect("selected line command should execute");
    let result: serde_json::Value =
        serde_wasm_bindgen::from_value(result).expect("result should deserialize");
    let exported = oristudio_cp_wasm::export_cp(handle).expect("cp export should succeed");

    assert_eq!(result["operation"], "CreaseMakeMountain");
    assert!(exported.lines().all(|line| line.starts_with("3 ")));
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}

fn foldable_square_document() -> oristudio_cp::CreasePatternDocument {
    oristudio_cp::CreasePatternDocument {
        title: Some("foldable square".to_owned()),
        crease_pattern: oristudio_cp::CreasePatternModel {
            line_segments: vec![
                segment(
                    0.0,
                    0.0,
                    1.0,
                    0.0,
                    oristudio_cp::geometry::LineColor::Black0,
                ),
                segment(
                    1.0,
                    0.0,
                    1.0,
                    1.0,
                    oristudio_cp::geometry::LineColor::Black0,
                ),
                segment(
                    1.0,
                    1.0,
                    0.0,
                    1.0,
                    oristudio_cp::geometry::LineColor::Black0,
                ),
                segment(
                    0.0,
                    1.0,
                    0.0,
                    0.0,
                    oristudio_cp::geometry::LineColor::Black0,
                ),
                segment(0.0, 0.0, 1.0, 1.0, oristudio_cp::geometry::LineColor::Red1),
            ],
            ..oristudio_cp::CreasePatternModel::default()
        },
        operation_frame: Default::default(),
        metadata: Default::default(),
    }
}

fn segment(
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    color: oristudio_cp::geometry::LineColor,
) -> oristudio_cp::geometry::LineSegment {
    oristudio_cp::geometry::LineSegment::with_color(
        oristudio_cp::geometry::Point::new(ax, ay),
        oristudio_cp::geometry::Point::new(bx, by),
        color,
    )
}

#[wasm_bindgen_test]
fn command_dispatch_accepts_active_line_color_payloads() {
    let handle = oristudio_cp_wasm::load_cp("1 0 0 1 0\n3 0 0 0 1\n", "sample")
        .expect("cp import should succeed");
    let result = oristudio_cp_wasm::execute_cp_command(
        handle,
        serde_wasm_bindgen::to_value("CreaseSetLineColor").expect("operation id should serialize"),
        serde_wasm_bindgen::to_value(&oristudio_cp::CreasePatternCommandPayload {
            line_ids: vec![1, 2],
            line_color: Some(oristudio_cp::geometry::LineColor::Purple8),
            ..oristudio_cp::CreasePatternCommandPayload::default()
        })
        .expect("payload should serialize"),
    )
    .expect("selected line color command should execute");
    let result: serde_json::Value =
        serde_wasm_bindgen::from_value(result).expect("result should deserialize");
    let snapshot = oristudio_cp_wasm::document_snapshot(handle).expect("snapshot should serialize");
    let snapshot: serde_json::Value =
        serde_wasm_bindgen::from_value(snapshot).expect("snapshot should deserialize");

    assert_eq!(result["operation"], "CreaseSetLineColor");
    assert_eq!(
        snapshot["crease_pattern"]["line_segments"][0]["color"],
        "Purple8"
    );
    assert_eq!(
        snapshot["crease_pattern"]["line_segments"][1]["color"],
        "Purple8"
    );
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}

#[wasm_bindgen_test]
fn inserts_and_replaces_clipboard_line_segments() {
    let handle =
        oristudio_cp_wasm::load_cp("1 0 0 1 0\n", "sample").expect("cp import should succeed");
    let inserted = oristudio_cp_wasm::insert_line_segments(
        handle,
        serde_wasm_bindgen::to_value(&vec![oristudio_cp::geometry::LineSegment::with_color(
            oristudio_cp::geometry::Point::new(2.0, 0.0),
            oristudio_cp::geometry::Point::new(3.0, 0.0),
            oristudio_cp::geometry::LineColor::Blue2,
        )])
        .expect("line segments should serialize"),
    )
    .expect("insert should succeed");
    let snapshot = oristudio_cp_wasm::document_snapshot(handle).expect("snapshot should serialize");
    let snapshot: serde_json::Value =
        serde_wasm_bindgen::from_value(snapshot).expect("snapshot should deserialize");

    assert_eq!(inserted, 1);
    assert_eq!(
        snapshot["crease_pattern"]["line_segments"][1]["selected"],
        serde_json::json!(2)
    );

    let replaced = oristudio_cp_wasm::replace_line_segments(
        handle,
        serde_wasm_bindgen::to_value(&vec![2_usize]).expect("line ids should serialize"),
        serde_wasm_bindgen::to_value(&vec![oristudio_cp::geometry::LineSegment::with_color(
            oristudio_cp::geometry::Point::new(4.0, 0.0),
            oristudio_cp::geometry::Point::new(5.0, 0.0),
            oristudio_cp::geometry::LineColor::Red1,
        )])
        .expect("line segments should serialize"),
    )
    .expect("replace should succeed");
    let exported = oristudio_cp_wasm::export_cp(handle).expect("cp export should succeed");

    assert_eq!(replaced, 1);
    assert!(exported.contains("3 4.0 0.0 5.0 0.0"));
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}

#[wasm_bindgen_test]
fn command_dispatch_accepts_resolved_point_payloads() {
    let handle =
        oristudio_cp_wasm::load_cp("1 0 0 1 0\n", "sample").expect("cp import should succeed");
    let result = oristudio_cp_wasm::execute_cp_command(
        handle,
        serde_wasm_bindgen::to_value("CreaseCopy").expect("operation id should serialize"),
        serde_wasm_bindgen::to_value(&oristudio_cp::CreasePatternCommandPayload {
            line_ids: vec![1],
            points: vec![
                oristudio_cp::geometry::Point::new(0.0, 0.0),
                oristudio_cp::geometry::Point::new(0.0, 2.0),
            ],
            ..oristudio_cp::CreasePatternCommandPayload::default()
        })
        .expect("payload should serialize"),
    )
    .expect("selected line transform command should execute");
    let result: serde_json::Value =
        serde_wasm_bindgen::from_value(result).expect("result should deserialize");
    let exported = oristudio_cp_wasm::export_cp(handle).expect("cp export should succeed");

    assert_eq!(result["operation"], "CreaseCopy");
    assert!(exported.contains("1 0.0 2.0 1.0 2.0"));
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}

#[wasm_bindgen_test]
fn command_dispatch_accepts_drag_delete_point_payloads() {
    let handle = oristudio_cp_wasm::load_cp("1 0 0 10 0\n2 5 -5 5 5\n3 0 1 10 1\n", "sample")
        .expect("cp import should succeed");
    let result = oristudio_cp_wasm::execute_cp_command(
        handle,
        serde_wasm_bindgen::to_value("CreaseDeleteIntersecting")
            .expect("operation id should serialize"),
        serde_wasm_bindgen::to_value(&oristudio_cp::CreasePatternCommandPayload {
            points: vec![
                oristudio_cp::geometry::Point::new(2.0, 0.0),
                oristudio_cp::geometry::Point::new(8.0, 0.0),
            ],
            ..oristudio_cp::CreasePatternCommandPayload::default()
        })
        .expect("payload should serialize"),
    )
    .expect("drag-delete command should execute");
    let result: serde_json::Value =
        serde_wasm_bindgen::from_value(result).expect("result should deserialize");
    let exported = oristudio_cp_wasm::export_cp(handle).expect("cp export should succeed");

    assert_eq!(result["operation"], "CreaseDeleteIntersecting");
    assert_eq!(exported.lines().count(), 1);
    assert!(exported.lines().all(|line| line.starts_with("3 ")));
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}

#[wasm_bindgen_test]
fn command_dispatch_accepts_intersecting_selection_point_payloads() {
    let handle = oristudio_cp_wasm::load_cp("1 0 0 10 0\n2 5 -5 5 5\n3 0 1 10 1\n", "sample")
        .expect("cp import should succeed");
    let result = oristudio_cp_wasm::execute_cp_command(
        handle,
        serde_wasm_bindgen::to_value("SelectLineIntersecting")
            .expect("operation id should serialize"),
        serde_wasm_bindgen::to_value(&oristudio_cp::CreasePatternCommandPayload {
            points: vec![
                oristudio_cp::geometry::Point::new(2.0, 0.0),
                oristudio_cp::geometry::Point::new(8.0, 0.0),
            ],
            ..oristudio_cp::CreasePatternCommandPayload::default()
        })
        .expect("payload should serialize"),
    )
    .expect("intersecting-line selection command should execute");
    let result: serde_json::Value =
        serde_wasm_bindgen::from_value(result).expect("result should deserialize");
    let snapshot = oristudio_cp_wasm::document_snapshot(handle).expect("snapshot should serialize");
    let snapshot: serde_json::Value =
        serde_wasm_bindgen::from_value(snapshot).expect("snapshot should deserialize");
    let selected = snapshot["crease_pattern"]["line_segments"]
        .as_array()
        .expect("line segments should be an array")
        .iter()
        .map(|line| line["selected"].as_i64())
        .collect::<Vec<_>>();

    assert_eq!(result["operation"], "SelectLineIntersecting");
    assert_eq!(selected, vec![Some(2), Some(2), Some(0)]);
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}

#[wasm_bindgen_test]
fn command_dispatch_accepts_fix_inaccurate_line_payloads() {
    let handle = oristudio_cp_wasm::load_cp("1 0.1954 0 10 0\n", "sample")
        .expect("cp import should succeed");
    let result = oristudio_cp_wasm::execute_cp_command(
        handle,
        serde_wasm_bindgen::to_value("FixInaccurate").expect("operation id should serialize"),
        serde_wasm_bindgen::to_value(&oristudio_cp::CreasePatternCommandPayload {
            line_ids: vec![1],
            ..oristudio_cp::CreasePatternCommandPayload::default()
        })
        .expect("payload should serialize"),
    )
    .expect("fix inaccurate command should execute");
    let result: serde_json::Value =
        serde_wasm_bindgen::from_value(result).expect("result should deserialize");
    let exported = oristudio_cp_wasm::export_cp(handle).expect("cp export should succeed");

    assert_eq!(result["operation"], "FixInaccurate");
    assert!(exported.contains("0.1953125"));
    oristudio_cp_wasm::free_document(handle).expect("document handle should free");
}
