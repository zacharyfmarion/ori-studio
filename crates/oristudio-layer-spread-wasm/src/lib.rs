//! Stateless bridge, loaded only in the dedicated spread worker.
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn solve_layer_spread(input: JsValue) -> Result<JsValue, JsValue> {
    let input = serde_wasm_bindgen::from_value(input)
        .map_err(|error| JsValue::from_str(&format!("Invalid spread input: {error}")))?;
    let result = oristudio_layer_spread::solve(&input)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    result
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
