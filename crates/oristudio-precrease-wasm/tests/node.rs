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

// ---------------------------------------------------------------------------
// PrecreasePlanner: the handle the worker holds across chunks.
// ---------------------------------------------------------------------------

use oristudio_precrease_wasm::PrecreasePlanner;

/// A 400-unit square (model space, y-down) with the vertical creases at
/// `xs`, given as model x coordinates.
fn square_with_verticals(xs: &[f64]) -> (Vec<f64>, Vec<i32>) {
    let mut segments = vec![
        0.0, 0.0, 400.0, 0.0, //
        400.0, 0.0, 400.0, 400.0, //
        400.0, 400.0, 0.0, 400.0, //
        0.0, 400.0, 0.0, 0.0,
    ];
    let mut colors = vec![0, 0, 0, 0];
    for &x in xs {
        segments.extend_from_slice(&[x, 0.0, x, 400.0]);
        colors.push(1);
    }
    (segments, colors)
}

/// The error of a constructor that must fail. `PrecreasePlanner` is a
/// `wasm_bindgen` handle with no `Debug`, so `expect_err` cannot be used.
fn expect_refused(result: Result<PrecreasePlanner, JsValue>, what: &str) -> JsValue {
    match result {
        Ok(_) => panic!("expected {what} to be refused"),
        Err(error) => error,
    }
}

fn planner(xs: &[f64]) -> PrecreasePlanner {
    let (segments, colors) = square_with_verticals(xs);
    PrecreasePlanner::new(&segments, &colors, None, 0, "").expect("planner")
}

#[wasm_bindgen_test]
fn a_quarter_grid_closes_with_no_auxiliary_fold() {
    let mut p = planner(&[100.0, 200.0, 300.0]);
    let info = json(p.info().expect("info"));
    assert_eq!(info["status"], "partial_unsolved"); // nothing folded yet
    assert_eq!(info["exactness"]["class"], "exact");
    assert_eq!(info["refused"], false);
    assert_eq!(info["off_lattice"], false);
    assert_close(&info["targets"], 3.0);
    assert_close(&info["remaining"], 3.0);
    assert_close(&info["sheet"]["width"], 1.0);
    assert_close(&info["point_cap"], 600_000.0);

    let outcome = json(p.close(0.0).expect("close"));
    assert_close(&outcome["folded"], 3.0);
    assert_close(&outcome["remaining"], 0.0);
    assert_eq!(outcome["exhausted"], true);
    assert_eq!(outcome["budget_hit"], false);
    assert!(p.remaining().is_empty());
    assert!(p.line_keys().is_empty());

    let seq = json(p.sequence(false).expect("sequence"));
    assert_eq!(seq["status"], "complete");
    assert_close(&seq["totals"]["cp_lines"], 3.0);
    assert_close(&seq["totals"]["aux"], 0.0);
    assert_close(&seq["totals"]["folds"], 3.0);
    let steps = seq["steps"].as_array().expect("steps");
    assert_eq!(steps.len(), 3);
    assert_eq!(steps[0]["kind"], "cp");
    assert_eq!(steps[0]["extent"]["kind"], "full");
    assert!(
        !steps[0]["witnesses"]
            .as_array()
            .expect("witnesses")
            .is_empty()
    );
    // A second `close` on a finished planner is a no-op, not an error.
    let again = json(p.close(0.0).expect("close"));
    assert_close(&again["folded"], 0.0);
}

#[wasm_bindgen_test]
fn a_stuck_target_is_reported_then_solved_by_the_forward_search() {
    // x = ¾ is not constructible from the bare sheet; x = ½ unlocks it (O2
    // from the mark it makes onto the right-hand corner), so the search
    // settles at depth 1 with a single auxiliary fold.
    let mut p = planner(&[300.0]);
    let outcome = json(p.close(0.0).expect("close"));
    assert_close(&outcome["folded"], 0.0);
    assert_close(&outcome["remaining"], 1.0);
    assert_eq!(outcome["exhausted"], true);

    // Seven numbers for the one remaining line, and one key for it.
    let remaining = p.remaining();
    assert_eq!(remaining.len(), 7);
    assert!((remaining[0].abs() - 1.0).abs() < 1e-12, "{remaining:?}");
    assert!(remaining[1].abs() < 1e-12);
    assert!((remaining[2].abs() - 0.75).abs() < 1e-12);
    let segment = &remaining[3..7];
    assert!(
        (segment[0] - segment[2]).abs() < 1e-12,
        "a vertical segment"
    );
    assert!(
        ((segment[1] - segment[3]).abs() - 1.0).abs() < 1e-12,
        "full height"
    );
    let keys = p.line_keys();
    assert_eq!(keys.len(), 1);
    assert!(keys[0].parse::<u64>().is_ok(), "{keys:?}");

    // Scoring folds nothing: x = ½ is constructible and would unlock one CP
    // line (so `1 + 1`), x = 0.2 is not constructible at all (`0`).
    let scored = p.score(&[1.0, 0.0, 0.5, 1.0, 0.0, 0.2]).expect("score");
    assert_eq!(scored.as_ref(), &[2, 0]);
    assert_eq!(p.remaining().len(), 7, "score folded something");

    let summary = p.stuck_search(2, 0.0).expect("search");
    assert!(!summary.is_null());
    let summary = json(summary);
    assert_close(&summary["aux_folds"], 1.0);
    assert_close(&summary["depth_reached"], 1.0);
    assert_eq!(summary["complete"], true);
    assert_eq!(summary["exhausted"], true);
    assert_eq!(summary["aux"].as_array().expect("aux lines").len(), 1);
    assert!(p.remaining().is_empty());

    let seq = json(p.sequence(false).expect("sequence"));
    assert_eq!(seq["status"], "complete");
    assert_close(&seq["totals"]["cp_lines"], 1.0);
    assert_close(&seq["totals"]["aux"], 1.0);
    assert_close(&seq["totals"]["folds"], 2.0);
    assert_eq!(seq["certification"], "best_found_to_depth_1");
    let steps = seq["steps"].as_array().expect("steps");
    assert_eq!(steps.len(), 2);
    assert_eq!(steps[0]["kind"], "aux");
    assert!(!steps[0]["unlocks"].as_array().expect("unlocks").is_empty());
    assert_eq!(steps[1]["kind"], "cp");
    // A second search on a finished planner finds nothing.
    assert!(p.stuck_search(2, 0.0).expect("search").is_null());
}

#[wasm_bindgen_test]
fn folding_a_supplied_line_and_the_rf_frame_round_trip() {
    let mut p = planner(&[300.0]);
    p.close(0.0).expect("close");
    // A ReferenceFinder-supplied x = ½: folded as `rf_aux`, then the closure
    // picks up the CP line it unlocks.
    let outcomes = json(p.fold(&[1.0, 0.0, 0.5], &[2], 0.0).expect("fold"));
    assert_eq!(outcomes[0]["kind"], "folded");
    assert!(p.remaining().is_empty(), "x = ¾ should close now");
    let seq = json(p.sequence(false).expect("sequence"));
    assert_close(&seq["diagnostics"]["rf_lines_folded"], 1.0);
    assert_eq!(seq["steps"][0]["tag"], "rf_aux");

    // Folding it again is a no-op, not a second fold.
    let outcomes = json(p.fold(&[1.0, 0.0, 0.5], &[1], 0.0).expect("fold"));
    assert_eq!(outcomes[0]["kind"], "already_folded");
    // A line the state does not construct is refused, not folded.
    let outcomes = json(p.fold(&[1.0, 0.0, 0.2], &[1], 0.0).expect("fold"));
    assert_eq!(outcomes[0]["kind"], "not_constructible");
    // And one that misses the sheet.
    let outcomes = json(p.fold(&[1.0, 0.0, 2.0], &[1], 0.0).expect("fold"));
    assert_eq!(outcomes[0]["kind"], "off_sheet");

    // to_rf / from_rf round-trip a canonical triple through two points.
    let points = p.to_rf(&[1.0, 0.0, 0.25]).expect("to_rf");
    assert_eq!(points.len(), 4);
    assert!((points[0] - 0.25).abs() < 1e-12 && (points[2] - 0.25).abs() < 1e-12);
    let back = p.from_rf(&points).expect("from_rf");
    assert_eq!(back.len(), 3);
    assert!((back[0].abs() - 1.0).abs() < 1e-12 && (back[2].abs() - 0.25).abs() < 1e-12);
    // A line off the sheet comes back as NaNs, keeping the arrays parallel.
    let points = p.to_rf(&[1.0, 0.0, 5.0]).expect("to_rf");
    assert!(points.iter().all(|v| v.is_nan()));
}

#[wasm_bindgen_test]
fn explain_answers_for_a_folded_line_and_a_fresh_one() {
    let mut p = planner(&[200.0]);
    p.close(0.0).expect("close");
    let e = json(p.explain(&[1.0, 0.0, 0.5]).expect("explain"));
    assert_eq!(e["folded"], true);
    assert_eq!(e["is_target"], true);
    assert_eq!(e["tag"], "cp");
    assert!(!e["witnesses"].as_array().expect("witnesses").is_empty());
    assert!(e["chosen"].as_f64().is_some());

    let e = json(p.explain(&[1.0, 0.0, 0.25]).expect("explain"));
    assert_eq!(e["folded"], false);
    assert_eq!(e["is_target"], false);
    assert!(!e["witnesses"].as_array().expect("witnesses").is_empty());
    assert!(e["facts"]["landers_computed"].as_bool().expect("bool"));
}

#[wasm_bindgen_test]
fn a_non_rectangular_sheet_is_refused_and_its_methods_are_no_ops() {
    // A right triangle: a closed border loop that is not a rectangle.
    let segments = vec![
        0.0, 0.0, 400.0, 0.0, //
        400.0, 0.0, 0.0, 400.0, //
        0.0, 400.0, 0.0, 0.0,
    ];
    let colors = vec![0, 0, 0];
    let mut p = PrecreasePlanner::new(&segments, &colors, None, 0, "").expect("planner");
    let info = json(p.info().expect("info"));
    assert_eq!(info["status"], "refused_sheet");
    assert_eq!(info["refused"], true);
    assert!(info["sheet"].is_null());
    assert!(p.remaining().is_empty());
    let error = envelope(p.close(0.0).expect_err("refused"));
    assert_eq!(error["code"], "refused_sheet");
    let seq = json(p.sequence(false).expect("sequence"));
    assert_eq!(seq["status"], "refused_sheet");
    assert!(seq["steps"].as_array().expect("steps").is_empty());
}

#[wasm_bindgen_test]
fn planner_arguments_are_validated_at_the_boundary() {
    let (segments, colors) = square_with_verticals(&[200.0]);
    let error = envelope(expect_refused(
        PrecreasePlanner::new(&segments, &colors, None, 7, ""),
        "no component",
    ));
    assert_eq!(error["code"], "invalid_input");
    assert!(
        error["message"]
            .as_str()
            .expect("message")
            .contains("does not exist")
    );
    let error = envelope(expect_refused(
        PrecreasePlanner::new(&segments, &colors, None, 0, "{\"nope\": 1}"),
        "bad options",
    ));
    assert_eq!(error["code"], "invalid_input");
    // The options JSON really is applied.
    let mut p = PrecreasePlanner::new(&segments, &colors, None, 0, "{\"point_cap\": 12345}")
        .expect("planner");
    assert_close(&json(p.info().expect("info"))["point_cap"], 12345.0);

    let error = envelope(p.close(f64::NAN).expect_err("nan budget"));
    assert_eq!(error["code"], "invalid_input");
    let error = envelope(p.score(&[1.0, 0.0]).expect_err("short triple"));
    assert_eq!(error["code"], "invalid_input");
    let error = envelope(p.score(&[1.0, f64::NAN, 0.0]).expect_err("nan"));
    assert_eq!(error["code"], "invalid_input");
    let error = envelope(p.score(&[0.0, 0.0, 0.5]).expect_err("zero normal"));
    assert_eq!(error["code"], "invalid_input");
    let error = envelope(p.fold(&[1.0, 0.0, 0.5], &[9], 0.0).expect_err("bad tag"));
    assert_eq!(error["code"], "invalid_input");
    let error = envelope(p.fold(&[1.0, 0.0, 0.5], &[], 0.0).expect_err("tag count"));
    assert_eq!(error["code"], "invalid_input");
    let error = envelope(
        p.explain(&[1.0, 0.0, 0.5, 1.0, 0.0, 0.25])
            .expect_err("two lines"),
    );
    assert_eq!(error["code"], "invalid_input");
    let error = envelope(p.from_rf(&[0.0, 0.0, 0.0]).expect_err("not quadruples"));
    assert_eq!(error["code"], "invalid_input");
    let error = envelope(p.from_rf(&[0.5, 0.5, 0.5, 0.5]).expect_err("coincident"));
    assert_eq!(error["code"], "invalid_input");
}
