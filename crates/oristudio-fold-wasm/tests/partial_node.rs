//! Partial precreases across the wasm boundary (`wasm-pack test --node`): a
//! precrease with an `extent` in the document's shape lands marks that come
//! back in plain objects, the default pinch length is a number, and a
//! malformed extent is a thrown `invalid_input` envelope. `tests/partial.rs`
//! covers the same natively.

#![cfg(target_arch = "wasm32")]

use serde::Serialize;
use serde_json::{Value, json};
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

use oristudio_fold_wasm::FoldEngine;

fn js(value: Value) -> JsValue {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .expect("plain object")
}

fn json_of(value: JsValue) -> Value {
    serde_wasm_bindgen::from_value(value).expect("json-compatible value")
}

fn square(engine: &mut FoldEngine) -> u32 {
    let made = json_of(
        engine
            .sheet(js(
                json!({ "shape": { "kind": "square" }, "startSide": "front" }),
            ))
            .expect("sheet"),
    );
    made["state"].as_u64().expect("handle") as u32
}

fn pinch(extent: Value) -> Value {
    json!({
        "kind": "precrease",
        "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
        "direction": "valley",
        "moving": [0.9, 0.5],
        "seed": { "scope": "all" },
        "extent": extent
    })
}

#[wasm_bindgen_test]
fn a_pinch_crosses_the_boundary_in_plain_objects() {
    let mut engine = FoldEngine::new();
    let sheet = square(&mut engine);
    let length = engine.default_pinch_length(sheet).expect("length");
    assert_eq!(length, 1.0 / 16.0);
    let applied = json_of(
        engine
            .apply(
                sheet,
                js(pinch(json!({
                    "kind": "pinch",
                    "at": { "kind": "point", "at": [0.5, 0.5] },
                    "length": length
                }))),
                JsValue::UNDEFINED,
            )
            .expect("apply"),
    );
    assert_eq!(applied["status"], "ok", "{applied}");
    assert_eq!(applied["summary"]["crease_marks"].as_f64(), Some(1.0));
    let state = applied["state"].as_u64().expect("handle") as u32;

    let scene = json_of(engine.scene(state).expect("scene"));
    let marks = scene["crease_marks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(marks.len(), 1);
    assert_eq!(marks[0]["letter"], "valley");
    assert_eq!(marks[0]["pieces"][0]["seen"], "valley");
    let keys = engine.canonical_keys(state).expect("keys");
    assert_eq!(keys.iter().filter(|k| k.starts_with("m:")).count(), 1);
    let summary = json_of(engine.step_summary(state).expect("step summary"));
    assert_eq!(
        summary["summary"]["diff"]["marks_added"].as_f64(),
        Some(1.0)
    );
    let landmarks = json_of(engine.landmarks(state, js(json!([]))).expect("landmarks"));
    assert_eq!(landmarks["crease_marks"].as_array().map(Vec::len), Some(1));

    // A refusal is a value.
    let refused = json_of(
        engine
            .apply(
                sheet,
                js(pinch(json!({
                    "kind": "pinch",
                    "at": { "kind": "point", "at": [1.5, 0.5] },
                    "length": length
                }))),
                JsValue::UNDEFINED,
            )
            .expect("apply"),
    );
    assert_eq!(refused["status"], "refused");
    assert_eq!(refused["refusal"]["code"], "extent_off_paper");
}

#[wasm_bindgen_test]
fn a_malformed_extent_is_thrown() {
    let mut engine = FoldEngine::new();
    let sheet = square(&mut engine);
    for extent in [
        json!({ "kind": "half", "at": { "kind": "point", "at": [0.5, 0.5] } }),
        json!({ "kind": "segment", "from": { "kind": "edge", "a": [0.0, 0.0], "b": [1.0, 0.0] }, "to": { "kind": "point", "at": [0.5, 0.5] } }),
    ] {
        let thrown = engine
            .apply(sheet, js(pinch(extent.clone())), JsValue::UNDEFINED)
            .err()
            .map(json_of);
        assert_eq!(
            thrown.as_ref().map(|e| e["code"].clone()),
            Some(json!("invalid_input")),
            "{extent}"
        );
    }
}
