//! The crimp and the tuck across the wasm boundary (`wasm-pack test --node`):
//! their ops arrive as the document's plain objects, their analyses (the
//! compound question) and landings leave as plain objects, the landings'
//! reports tagged by family, and the tuck's target listing reads the page's
//! clock for its budget. `tests/crimp_tuck.rs` covers them natively.

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

fn book(engine: &mut FoldEngine) -> u32 {
    let made = json_of(
        engine
            .sheet(js(
                json!({ "shape": { "kind": "square" }, "startSide": "front" }),
            ))
            .expect("sheet"),
    );
    let sheet = made["state"].as_u64().expect("handle") as u32;
    let applied = json_of(
        engine
            .apply(
                sheet,
                js(json!({
                    "kind": "valley",
                    "line": { "via": "free", "through": [[0.5, 0.0], [0.5, 1.0]] },
                    "moving": [0.75, 0.5],
                    "seed": { "scope": "all" }
                })),
                JsValue::UNDEFINED,
            )
            .expect("apply"),
    );
    applied["state"].as_u64().expect("handle") as u32
}

#[wasm_bindgen_test]
fn a_tuck_lists_its_targets_and_lands_across_the_boundary() {
    let mut engine = FoldEngine::new();
    let book = book(&mut engine);
    let step = json!({
        "kind": "tuck",
        "line": { "via": "free", "through": [[0.0, 0.3], [0.3, 0.0]] },
        "direction": "valley",
        "seed": { "scope": "flaps", "at": [[0.05, 0.05]] },
        "target": [0.75, 0.5]
    });
    let analysed = json_of(
        engine
            .compound_analysis(book, js(step.clone()), JsValue::UNDEFINED)
            .expect("compound_analysis"),
    );
    assert_eq!(analysed["status"], "ok", "{analysed}");
    assert_eq!(analysed["family"], "tuck", "{analysed}");
    assert!(
        analysed["analysis"]["targets"]
            .as_array()
            .is_some_and(|t| t.iter().any(|t| t["feasible"] == json!(true))),
        "{analysed}"
    );
    let folded = json_of(
        engine
            .tuck(book, js(step.clone()), JsValue::NULL)
            .expect("tuck"),
    );
    assert_eq!(folded["status"], "ok", "{folded}");
    assert_eq!(folded["outcome"], "landed");
    assert_eq!(folded["compound"]["family"], "tuck", "{folded}");
    let replayed = json_of(
        engine
            .apply(book, js(step), JsValue::UNDEFINED)
            .expect("apply"),
    );
    assert_eq!(replayed["status"], "ok", "{replayed}");
    assert_eq!(replayed["summary"]["faces"], folded["summary"]["faces"]);
    // One report shape however the tuck landed.
    assert_eq!(replayed["compound"], folded["compound"]);
    // A caller's mistake throws the envelope.
    let thrown = engine
        .tuck(book, js(json!({ "kind": "tuck" })), JsValue::UNDEFINED)
        .err()
        .map(json_of)
        .unwrap_or_default();
    assert_eq!(thrown["code"], "invalid_input");
}
