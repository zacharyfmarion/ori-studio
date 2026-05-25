//! `wasm-bindgen` wrapper around `oristudio-cp-detect`.

use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct JsErrorEnvelope {
    code: &'static str,
    message: String,
}

#[wasm_bindgen]
pub fn cp_detect_package_info() -> Result<JsValue, JsValue> {
    to_js_value(&oristudio_cp_detect::package_info())
}

#[wasm_bindgen]
pub fn cp_detect_parse_model_manifest(text: &str) -> Result<JsValue, JsValue> {
    let manifest =
        oristudio_cp_detect::parse_model_manifest_json(text).map_err(to_js_config_error)?;
    to_js_value(&manifest)
}

#[wasm_bindgen]
pub fn cp_detect_parse_oracle_fixture_manifest(text: &str) -> Result<JsValue, JsValue> {
    let manifest = oristudio_cp_detect::parse_oracle_fixture_manifest_json(text)
        .map_err(to_js_config_error)?;
    to_js_value(&manifest)
}

fn to_js_config_error(error: oristudio_cp_detect::DetectConfigError) -> JsValue {
    let code = match error {
        oristudio_cp_detect::DetectConfigError::Json(_) => "invalid_json",
        oristudio_cp_detect::DetectConfigError::UnsupportedSchema { .. } => "unsupported_schema",
        oristudio_cp_detect::DetectConfigError::InvalidField(_) => "invalid_field",
    };
    js_error(code, error.to_string())
}

fn to_js_value(value: &impl Serialize) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    value
        .serialize(&serializer)
        .map_err(|error| js_error("js_value", error.to_string()))
}

fn js_error(code: &'static str, message: String) -> JsValue {
    let fallback = message.clone();
    to_js_value(&JsErrorEnvelope { code, message })
        .unwrap_or_else(|_| JsValue::from_str(fallback.as_str()))
}
