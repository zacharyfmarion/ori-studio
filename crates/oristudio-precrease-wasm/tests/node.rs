use serde::Serialize;
use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

use oristudio_precrease_wasm::{model_to_rf, precrease_tolerances, rf_to_model, sheet_frames};

/// A returned JS value as JSON. Integer-valued numbers come back as integers,
/// so numeric assertions go through [`num`] rather than `Value` equality.
fn json(value: JsValue) -> Value {
    serde_wasm_bindgen::from_value(value).expect("json-compatible value")
}

fn envelope(error: JsValue) -> Value {
    serde_wasm_bindgen::from_value(error).expect("error envelope")
}

fn num(value: &Value) -> f64 {
    value
        .as_f64()
        .unwrap_or_else(|| panic!("expected a number, got {value}"))
}

fn assert_close(value: &Value, expected: f64) {
    let actual = num(value);
    assert!(
        (actual - expected).abs() < 1e-12,
        "expected {expected}, got {actual}"
    );
}

/// A plain JS object (not a `Map`) from a serde value, the shape the app
/// hands back after reading it off `SheetAnalysis`.
fn plain_object(value: &impl Serialize) -> JsValue {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .expect("plain object")
}

/// A 400-unit square (model space, y-down) with one crease from the
/// on-screen bottom-left corner up to (100, 300).
fn square_with_crease() -> (Vec<f64>, Vec<i32>) {
    let segments = vec![
        0.0, 0.0, 400.0, 0.0, //
        400.0, 0.0, 400.0, 400.0, //
        400.0, 400.0, 0.0, 400.0, //
        0.0, 400.0, 0.0, 0.0, //
        0.0, 400.0, 100.0, 300.0,
    ];
    let colors = vec![0, 0, 0, 0, 1];
    (segments, colors)
}

#[wasm_bindgen_test]
fn sheet_frames_returns_frames_lines_and_exactness() {
    let (segments, colors) = square_with_crease();
    let analysis = json(sheet_frames(&segments, &colors, None).expect("analysis"));
    assert_close(&analysis["segment_count"], 5.0);
    assert_close(&analysis["tol"], 1e-6);
    let components = analysis["components"].as_array().expect("components");
    assert_eq!(components.len(), 1);
    let c = &components[0];
    assert_close(&c["frame"]["origin"][0], 0.0);
    assert_close(&c["frame"]["origin"][1], 400.0);
    assert_close(&c["frame"]["y_axis"][0], 0.0);
    assert_close(&c["frame"]["y_axis"][1], -1.0);
    assert_close(&c["rf_rect"]["width"], 1.0);
    assert_close(&c["affines"]["model_to_unit"][5], 1.0);
    assert_eq!(c["merged_lines"].as_array().expect("lines").len(), 1);
    assert_close(&c["merged_lines"][0]["segment_indices"][0], 4.0);
    assert_eq!(c["exactness"]["class"], "exact");
    assert_close(&c["exactness"]["snapped"]["max_displacement_unit"], 0.0);
    assert_close(&c["unit_segments"][0][2], 0.25);
    assert_close(&c["unit_segments"][0][3], 0.25);
    assert!(c["refused"].is_null());
    assert!(
        analysis["unassigned_segments"]
            .as_array()
            .expect("array")
            .is_empty()
    );
}

#[wasm_bindgen_test]
fn model_and_rf_round_trip_through_a_component_frame() {
    let (segments, colors) = square_with_crease();
    let analysis = sheet_frames(&segments, &colors, None).expect("analysis");
    let frame = js_sys::Reflect::get(
        &js_sys::Reflect::get(
            &js_sys::Reflect::get(&analysis, &JsValue::from_str("components")).expect("components"),
            &JsValue::from_f64(0.0),
        )
        .expect("component"),
        &JsValue::from_str("frame"),
    )
    .expect("frame");
    let rf = model_to_rf(frame.clone(), 100.0, 300.0).expect("model_to_rf");
    assert!((rf[0] - 0.25).abs() < 1e-12 && (rf[1] - 0.25).abs() < 1e-12);
    let back = rf_to_model(frame, rf[0], rf[1]).expect("rf_to_model");
    assert!((back[0] - 100.0).abs() < 1e-9 && (back[1] - 300.0).abs() < 1e-9);
}

#[wasm_bindgen_test]
fn fallback_paper_is_used_without_border_creases() {
    let segments = vec![-200.0, 200.0, 200.0, -200.0];
    let colors = vec![1];
    let paper: Box<[f64]> = vec![-200.0, -200.0, 200.0, 200.0].into_boxed_slice();
    let analysis = json(sheet_frames(&segments, &colors, Some(paper)).expect("analysis"));
    assert_eq!(analysis["warnings"][0]["kind"], "no_border_fallback");
    assert_eq!(analysis["components"][0]["is_fallback"], true);

    let error = envelope(sheet_frames(&segments, &colors, None).expect_err("no sheet"));
    assert_eq!(error["code"], "no_sheet");
}

#[wasm_bindgen_test]
fn invalid_inputs_come_back_as_error_envelopes() {
    let error = envelope(sheet_frames(&[0.0, 0.0, f64::NAN, 1.0], &[1], None).expect_err("nan"));
    assert_eq!(error["code"], "invalid_input");
    assert!(
        error["message"]
            .as_str()
            .expect("message")
            .contains("not finite")
    );

    let error = envelope(sheet_frames(&[0.0, 0.0, 1.0], &[1], None).expect_err("odd length"));
    assert_eq!(error["code"], "invalid_input");

    let short: Box<[f64]> = vec![0.0, 1.0].into_boxed_slice();
    let error =
        envelope(sheet_frames(&[0.0, 0.0, 1.0, 1.0], &[1], Some(short)).expect_err("short"));
    assert_eq!(error["code"], "invalid_input");

    let frame = plain_object(&serde_json::json!({
        "origin": [0.0, 0.0], "x_axis": [1.0, 0.0], "y_axis": [0.0, -1.0],
        "width": 1.0, "height": 1.0
    }));
    let error = envelope(model_to_rf(frame.clone(), f64::INFINITY, 0.0).expect_err("inf"));
    assert_eq!(error["code"], "invalid_input");
    let error = envelope(model_to_rf(JsValue::from_str("nope"), 0.0, 0.0).expect_err("junk"));
    assert_eq!(error["code"], "invalid_frame");
    // A frame object whose fields are not finite is refused too.
    let bad = plain_object(&serde_json::json!({
        "origin": [0.0, 0.0], "x_axis": [0.0, 0.0], "y_axis": [0.0, 0.0],
        "width": 1.0, "height": 1.0
    }));
    let error = envelope(model_to_rf(bad, 0.5, 0.5).expect_err("zero axis"));
    assert_eq!(error["code"], "invalid_frame");
    let ok = model_to_rf(frame, 0.5, 0.5).expect("point");
    assert_eq!(ok.len(), 2);
    assert!((ok[0] - 0.5).abs() < 1e-12 && (ok[1] + 0.5).abs() < 1e-12);
}

#[wasm_bindgen_test]
fn tolerances_are_exported() {
    let t = json(precrease_tolerances().expect("tolerances"));
    assert_close(&t["tol"], 1e-6);
    assert_close(&t["snap_radius"], 2e-3);
}
