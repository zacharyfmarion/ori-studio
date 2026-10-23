//! The io calls across the wasm boundary (`wasm-pack test --node`): a file's
//! bytes and the document's shapes in, plain objects out, the `cp-jump` op a
//! pick returns applied like any stored step, Edit's folded figure as the
//! kernel's paper scene object, and a caller's mistakes thrown as
//! `{ code, message }`. `tests/io.rs` covers the behaviour natively.

#![cfg(target_arch = "wasm32")]

use oristudio_cp::folding::{FoldedFigureModel, folded_figure_paper_scene_from_segments};
use serde::Serialize;
use serde_json::{Value, json};
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

use oristudio_fold_wasm::FoldEngine;

const PRELIMINARY: &str =
    include_str!("../../../tests/fixtures/fold-samples/preliminary-base.fold");

/// A JSON value as the plain JS object the app sends.
fn js(value: Value) -> JsValue {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .expect("plain object")
}

fn json_of(value: JsValue) -> Value {
    serde_wasm_bindgen::from_value(value).expect("json-compatible value")
}

fn handle(value: &Value, key: &str) -> u32 {
    value[key].as_u64().expect("a handle") as u32
}

fn square(engine: &mut FoldEngine) -> u32 {
    let made = json_of(
        engine
            .sheet(js(json!({ "shape": { "kind": "square" } })))
            .expect("sheet"),
    );
    handle(&made, "state")
}

fn keys(engine: &FoldEngine, state: u32) -> Vec<String> {
    let mut keys = engine.canonical_keys(state).expect("keys");
    keys.sort();
    keys
}

#[wasm_bindgen_test]
fn a_sample_opens_and_its_pick_is_a_step_the_engine_replays() {
    let mut engine = FoldEngine::new();
    let opened = json_of(
        engine
            .import_cp(
                js(json!({ "format": "fold", "sample": true })),
                PRELIMINARY.as_bytes(),
                js(json!({ "kind": "empty", "startSide": "front" })),
                JsValue::UNDEFINED,
            )
            .expect("open"),
    );
    assert_eq!(opened["status"], "ok", "{opened}");
    assert_eq!(opened["paper"], json!({ "kind": "square" }));
    assert_eq!(opened["count"], json!({ "orders": 1, "exact": true }));
    assert_eq!(opened["components"], json!([]));
    assert_eq!(opened["summary"]["precreases"].as_f64(), Some(2.0));
    assert_eq!(engine.live_imports(), 1);

    let picked = json_of(
        engine
            .import_pick(handle(&opened, "import"), &[])
            .expect("pick"),
    );
    assert_eq!(picked["status"], "ok", "{picked}");
    assert_eq!(picked["op"]["kind"], "cp-jump");
    assert_eq!(picked["op"]["origin"], "sample");
    assert!(picked["op"]["cpJson"].is_string() && picked["op"]["orderJson"].is_string());
    assert_eq!(picked["summary"]["faces"].as_f64(), Some(8.0));
    let state = handle(&picked, "state");

    // The document stores the op; a replay lands it from the sheet.
    let sheet = square(&mut engine);
    let replayed = json_of(
        engine
            .apply(sheet, js(picked["op"].clone()), JsValue::UNDEFINED)
            .expect("apply"),
    );
    assert_eq!(replayed["status"], "ok", "{replayed}");
    assert_eq!(replayed["report"], Value::Null);
    assert_eq!(
        keys(&engine, handle(&replayed, "state")),
        keys(&engine, state)
    );

    assert_eq!(engine.release_imports(&[handle(&opened, "import"), 99]), 1);
    assert_eq!(engine.live_imports(), 0);
}

#[wasm_bindgen_test]
fn send_to_edit_and_import_cp_give_the_state_back_and_a_path_exports() {
    let mut engine = FoldEngine::new();
    let sheet = square(&mut engine);
    let book = json_of(
        engine
            .apply(
                sheet,
                js(json!({
                    "kind": "valley",
                    "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
                    "moving": [0.75, 0.5], "seed": { "scope": "all" }
                })),
                JsValue::UNDEFINED,
            )
            .expect("book"),
    );
    let book = handle(&book, "state");
    let text = engine
        .send_to_edit(book, Some("Book".to_string()))
        .expect("text");
    assert!(text.contains("\"Book\""));

    let opened = json_of(
        engine
            .import_cp(
                js(json!({ "format": "fold" })),
                text.as_bytes(),
                js(json!({ "kind": "after", "state": book })),
                js(json!({ "maxNodes": 1000 })),
            )
            .expect("open"),
    );
    assert_eq!(opened["paper"], Value::Null);
    let picked = json_of(
        engine
            .import_pick(handle(&opened, "import"), &[])
            .expect("pick"),
    );
    assert_eq!(keys(&engine, handle(&picked, "state")), keys(&engine, book));

    let exported = json_of(engine.export_fold(&[sheet, book], None).expect("export"));
    assert_eq!(exported["status"], "ok");
    let fold: Value =
        serde_json::from_str(exported["text"].as_str().unwrap_or_default()).expect("FOLD");
    assert_eq!(fold["file_frames"].as_array().map(Vec::len), Some(2));

    engine.clear();
    assert_eq!((engine.live(), engine.live_imports()), (0, 0));
}

#[wasm_bindgen_test]
fn edits_folded_figure_crosses_as_the_kernels_scene_object() {
    // The book fold's crease pattern sent to Edit, and folded by the kernel
    // as Edit folds it.
    let mut engine = FoldEngine::new();
    let sheet = square(&mut engine);
    let book = handle(
        &json_of(
            engine
                .apply(
                    sheet,
                    js(json!({
                        "kind": "valley",
                        "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
                        "moving": [0.75, 0.5], "seed": { "scope": "all" }
                    })),
                    JsValue::UNDEFINED,
                )
                .expect("book"),
        ),
        "state",
    );
    let text = engine.send_to_edit(book, None).expect("text");
    let model = oristudio_cp::io::fold::import_fold_json(&text).expect("the kernel reads it");
    let folding: Vec<_> = model
        .line_segments
        .into_iter()
        .filter(|s| s.color.is_folding_line())
        .collect();
    let scene =
        folded_figure_paper_scene_from_segments(&folding, &[], 1, &FoldedFigureModel::default())
            .expect("fold")
            .expect("a figure");
    let scene = scene
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .expect("scene object");

    let landed = json_of(
        engine
            .import_edit_folded_figure(
                scene,
                js(json!({ "kind": "after", "state": book })),
                JsValue::NULL,
            )
            .expect("figure"),
    );
    assert_eq!(landed["status"], "ok", "{landed}");
    assert_eq!(landed["op"]["origin"], "edit_folded_figure");
    assert_eq!(keys(&engine, handle(&landed, "state")), keys(&engine, book));
}

#[wasm_bindgen_test]
fn refusals_are_values_and_mistakes_are_thrown() {
    let mut engine = FoldEngine::new();
    let sheet = square(&mut engine);
    let after = js(json!({ "kind": "after", "state": sheet }));
    let cp = || js(json!({ "format": "cp" }));
    let refused = json_of(
        engine
            .import_cp(cp(), b"1 2 3", after.clone(), JsValue::UNDEFINED)
            .expect("a refusal is a value"),
    );
    assert_eq!(refused["status"], "refused");
    assert_eq!(
        refused["refusal"],
        json!({ "code": "import_unreadable", "format": "cp" })
    );
    assert_eq!(engine.live_imports(), 0);

    let code = |error: JsValue| json_of(error)["code"].clone();
    let thrown = engine
        .import_cp(
            js(json!({ "format": "svg" })),
            b"",
            after.clone(),
            JsValue::UNDEFINED,
        )
        .expect_err("no such format");
    assert_eq!(code(thrown), "invalid_input");
    let thrown = engine
        .import_cp(js(json!("cp")), b"", after.clone(), JsValue::UNDEFINED)
        .expect_err("the file is an object");
    assert_eq!(code(thrown), "invalid_input");
    let thrown = engine
        .import_cp(cp(), b"", after, js(json!("lots")))
        .expect_err("limits are an object");
    assert_eq!(code(thrown), "invalid_input");
    let thrown = engine
        .import_cp(
            cp(),
            b"",
            js(json!({ "kind": "after", "state": sheet + 9 })),
            JsValue::UNDEFINED,
        )
        .expect_err("no such state");
    assert_eq!(code(thrown), "unknown_state");
    assert_eq!(
        code(engine.import_pick(7, &[]).expect_err("no such import")),
        "unknown_import"
    );
    assert_eq!(
        code(
            engine
                .send_to_edit(sheet + 9, None)
                .expect_err("no such state")
        ),
        "unknown_state"
    );
    assert_eq!(
        code(engine.export_fold(&[], None).expect_err("an empty path")),
        "invalid_input"
    );
}
