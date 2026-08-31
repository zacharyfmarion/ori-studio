use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

use treemaker_wasm::{
    apply_edit, build_crease_pattern, cp_status_report, export_v4, flat_fold_artifacts, free_tree,
    load_tmd, new_design, optimize_scale, save_tmd5, tree_design, tree_snapshot, tree_summary,
};

const FIXTURE_1: &str = include_str!("../testdata/tmModelTester_1.tmd5");

#[wasm_bindgen_test]
fn load_optimize_build_save_and_free() {
    let handle = load_tmd(FIXTURE_1).expect("load fixture");

    let summary = json(tree_summary(handle).expect("summary"));
    assert_eq!(summary["nodes"], 4);
    assert_eq!(summary["is_feasible"], true);

    let report = json(optimize_scale(handle).expect("optimize scale"));
    assert_eq!(report["kind"], "scale");
    assert_eq!(report["converged"], true);
    free_tree(handle).expect("free optimized handle");

    let build_handle = load_tmd(FIXTURE_1).expect("reload fixture");
    let built = json(build_crease_pattern(build_handle).expect("build cp"));
    assert_eq!(built["vertices"], 4);
    assert_eq!(built["creases"], 6);
    assert_eq!(built["facets"], 3);
    let report = json(cp_status_report(build_handle).expect("cp status report"));
    assert_eq!(report["status"], "polys_multiple_ibps");
    assert_eq!(report["bad_polys"][0], 1);

    let saved = save_tmd5(build_handle).expect("save tmd5");
    assert!(saved.starts_with("tree\n5.0\n"));
    let v4 = export_v4(build_handle).expect("export v4");
    assert!(v4.replace('\r', "\n").starts_with("tree\n4.0\n"));

    free_tree(build_handle).expect("free handle");
    let err = tree_summary(build_handle).expect_err("freed handle should error");
    assert_js_error(&err, "invalid_handle", "invalid TreeHandle");
}

#[wasm_bindgen_test]
fn parse_errors_are_structured() {
    let err = load_tmd("not-a-tree").expect_err("invalid input should fail");
    assert_js_error(&err, "parse", "expected tag");
}

#[wasm_bindgen_test]
fn editable_design_api_returns_snapshots() {
    let handle = new_design(JsValue::NULL).expect("new design");
    let first = json(
        apply_edit(
            handle,
            edit(
                "add_node",
                serde_json::json!({
                    "loc": { "x": 0.5, "y": 0.5 },
                    "label": "root"
                }),
            ),
        )
        .expect("add root"),
    );
    assert_eq!(first["created_node"], 1);

    for (x, y) in [(0.2, 0.2), (0.8, 0.2), (0.5, 0.85)] {
        apply_edit(
            handle,
            edit(
                "add_node",
                serde_json::json!({
                    "loc": { "x": x, "y": y },
                    "connect_to": 1,
                    "edge_length": 1.0
                }),
            ),
        )
        .expect("add connected node");
    }

    let snapshot = json(tree_snapshot(handle).expect("snapshot"));
    assert_eq!(snapshot["summary"]["nodes"], 4);
    assert_eq!(snapshot["summary"]["edges"], 3);
    assert_eq!(snapshot["summary"]["paths"], 6);
    assert_eq!(snapshot["nodes"].as_array().expect("nodes").len(), 4);

    let report = json(optimize_scale(handle).expect("optimize editable design"));
    assert_eq!(report["is_feasible"], true);
    build_crease_pattern(handle).expect("build editable design cp");
    let built = json(tree_snapshot(handle).expect("built editable snapshot"));
    assert!(
        !built["creases"]
            .as_array()
            .expect("built creases")
            .is_empty(),
        "{built:?}"
    );
    assert!(
        !built["facets"].as_array().expect("built facets").is_empty(),
        "{built:?}"
    );

    let design = json(tree_design(handle).expect("design"));
    assert_eq!(design["nodes"].as_array().expect("design nodes").len(), 4);

    let err = apply_edit(
        handle,
        edit(
            "add_edge",
            serde_json::json!({
                "node1": 2,
                "node2": 3
            }),
        ),
    )
    .expect_err("cycle should be rejected");
    assert_js_error(&err, "invalid_operation", "tree topology");
    free_tree(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn flat_folder_artifacts_returns_imported_folded_base() {
    let fold = serde_json::json!({
        "file_spec": 1.2,
        "frame_classes": ["creasePattern"],
        "vertices_coords": [[0, 0], [1, 0], [1, 1], [0, 1]],
        "edges_vertices": [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
        "edges_assignment": ["B", "B", "B", "B", "M"],
        "edges_foldAngle": [null, null, null, null, -180],
        "faces_vertices": [[0, 1, 2], [0, 2, 3]]
    });
    let options = serde_wasm_bindgen::to_value(&serde_json::json!({
        "solution_limit": 1
    }))
    .expect("options");

    let artifacts =
        json(flat_fold_artifacts(&fold.to_string(), options).expect("flat-folder artifacts"));

    assert_eq!(
        artifacts["fold"]["faces_vertices"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        artifacts["folded_base"]["facets"]
            .as_array()
            .expect("folded facets")
            .len(),
        2
    );
    assert!(artifacts["fold"]["face_orders"].is_array());
    assert!(artifacts["simulation_model"].is_object());
}

#[wasm_bindgen_test]
fn flat_folder_artifacts_infers_simulator_only_assignments() {
    let fold = serde_json::json!({
        "file_spec": 1.2,
        "frame_classes": ["creasePattern"],
        "vertices_coords": [[0, 0], [1, 0], [1, 1], [0, 1]],
        "edges_vertices": [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
        "edges_assignment": ["B", "B", "B", "B", "U"],
        "edges_foldAngle": [null, null, null, null, null],
        "faces_vertices": [[0, 1, 2], [0, 2, 3]]
    });
    let options = serde_wasm_bindgen::to_value(&serde_json::json!({
        "solution_limit": 1
    }))
    .expect("options");

    let artifacts =
        json(flat_fold_artifacts(&fold.to_string(), options).expect("flat-folder artifacts"));
    let canonical_assignment = artifacts["fold"]["edges_assignment"][4]
        .as_str()
        .expect("canonical assignment");
    let simulation_assignment = artifacts["simulation_model"]["fold"]["edges_assignment"][4]
        .as_str()
        .expect("simulation assignment");
    let simulation_angle = artifacts["simulation_model"]["fold"]["edges_foldAngle"][4]
        .as_f64()
        .expect("simulation fold angle");

    assert_eq!(canonical_assignment, "U");
    assert!(matches!(simulation_assignment, "M" | "V"));
    assert_eq!(
        simulation_angle,
        if simulation_assignment == "M" {
            -180.0
        } else {
            180.0
        }
    );
    assert!(
        !artifacts["simulation_model"]["crease_params"]
            .as_array()
            .expect("crease params")
            .is_empty()
    );
}

fn json(value: JsValue) -> Value {
    serde_wasm_bindgen::from_value(value).expect("json value")
}

fn assert_js_error(value: &JsValue, code: &str, message_fragment: &str) {
    let error = json(value.clone());
    assert_eq!(error["code"], code);
    assert!(
        error["message"]
            .as_str()
            .expect("error message")
            .contains(message_fragment),
        "{error:?}"
    );
}

fn edit(kind: &str, mut value: serde_json::Value) -> JsValue {
    value["type"] = serde_json::Value::String(kind.to_string());
    serde_wasm_bindgen::to_value(&value).expect("edit value")
}
