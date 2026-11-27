//! Stateless bridge, loaded only in the dedicated spread worker.
//!
//! A call that fails rejects with `{ code, message }`, as the engine bridges
//! do. The code names the solve's own `SpreadError`, so the worker can tell a
//! model past the solve's resource limits (`spread_limit`), a refusal by
//! design, from geometry the solve found inconsistent (`spread_invalid`) or a
//! solve that failed (`spread_solve`). `spread_input` and `spread_output` are
//! the bridge's own: a value that did not read or did not write.
use oristudio_layer_spread::SpreadError;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct JsErrorEnvelope {
    code: &'static str,
    message: String,
}

/// The code a solve's failure is rejected with.
fn spread_error_code(error: &SpreadError) -> &'static str {
    match error {
        SpreadError::Invalid(_) => "spread_invalid",
        SpreadError::Limit(_) => "spread_limit",
        SpreadError::Solve(_) => "spread_solve",
    }
}

fn js_error(code: &'static str, message: String) -> JsValue {
    let fallback = message.clone();
    JsErrorEnvelope { code, message }
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap_or_else(|_| JsValue::from_str(&fallback))
}

fn spread_error(error: SpreadError) -> JsValue {
    js_error(spread_error_code(&error), error.to_string())
}

#[wasm_bindgen]
pub fn solve_spatial_spread(value: JsValue) -> Result<JsValue, JsValue> {
    let input: oristudio_layer_spread::spatial::Input = serde_wasm_bindgen::from_value(value)
        .map_err(|error| js_error("spread_input", error.to_string()))?;
    let solution = oristudio_layer_spread::spatial::solve(&input).map_err(spread_error)?;
    serde_wasm_bindgen::to_value(&solution)
        .map_err(|error| js_error("spread_output", error.to_string()))
}

#[wasm_bindgen]
pub fn solve_layer_spread(input: JsValue) -> Result<JsValue, JsValue> {
    let input = serde_wasm_bindgen::from_value(input)
        .map_err(|error| js_error("spread_input", format!("Invalid spread input: {error}")))?;
    let result = oristudio_layer_spread::solve(&input).map_err(spread_error)?;
    result
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| js_error("spread_output", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_resource_limit_is_named_apart_from_every_other_failure() {
        assert_eq!(
            spread_error_code(&SpreadError::Limit("overlap regions")),
            "spread_limit"
        );
        assert_eq!(
            spread_error_code(&SpreadError::Invalid("coordinates or face rings".into())),
            "spread_invalid"
        );
        assert_eq!(
            spread_error_code(&SpreadError::Solve("non-finite heights".into())),
            "spread_solve"
        );
    }
}
