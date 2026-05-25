//! `wasm-bindgen` wrapper around `oristudio-cp-detect`.

use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmRectifiedImage {
    rgba: Vec<u8>,
    report_json: String,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl WasmRectifiedImage {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    #[wasm_bindgen(js_name = reportJson)]
    pub fn report_json(&self) -> String {
        self.report_json.clone()
    }

    pub fn rgba(&self) -> Vec<u8> {
        self.rgba.clone()
    }
}

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

#[wasm_bindgen]
pub fn cp_detect_auto_rectify_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    image_size: u32,
) -> Result<WasmRectifiedImage, JsValue> {
    let result = oristudio_cp_detect::rectify::auto_rectify_rgba(rgba, width, height, image_size)
        .map_err(to_js_rectification_error)?;
    wasm_rectified_image(result)
}

#[wasm_bindgen]
pub fn cp_detect_manual_rectify_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    image_size: u32,
    quad_json: &str,
) -> Result<WasmRectifiedImage, JsValue> {
    let quad: oristudio_cp_detect::rectify::Quad = serde_json::from_str(quad_json)
        .map_err(|error| js_error("invalid_json", error.to_string()))?;
    let result =
        oristudio_cp_detect::rectify::manual_rectify_rgba(rgba, width, height, image_size, quad)
            .map_err(to_js_rectification_error)?;
    wasm_rectified_image(result)
}

#[wasm_bindgen]
pub fn cp_detect_decode_dense_outputs(
    line_logits: &[f32],
    junction_logits: &[f32],
    assignment_logits: &[f32],
    non_crease_logits: &[f32],
    line_style_logits: &[f32],
    boundary_contact_logits: &[f32],
    image_size: u32,
    threshold: f32,
) -> Result<JsValue, JsValue> {
    let decoded = oristudio_cp_detect::decode::decode_dense_outputs(
        oristudio_cp_detect::decode::DenseOutputs {
            line_logits,
            junction_logits,
            assignment_logits,
            non_crease_logits,
            line_style_logits,
            boundary_contact_logits,
        },
        oristudio_cp_detect::decode::DecodeConfig {
            image_size,
            threshold,
            ..oristudio_cp_detect::decode::DecodeConfig::default()
        },
    )
    .map_err(to_js_decode_error)?;
    to_js_value(&decoded)
}

fn to_js_config_error(error: oristudio_cp_detect::DetectConfigError) -> JsValue {
    let code = match error {
        oristudio_cp_detect::DetectConfigError::Json(_) => "invalid_json",
        oristudio_cp_detect::DetectConfigError::UnsupportedSchema { .. } => "unsupported_schema",
        oristudio_cp_detect::DetectConfigError::InvalidField(_) => "invalid_field",
    };
    js_error(code, error.to_string())
}

fn to_js_rectification_error(error: oristudio_cp_detect::rectify::RectificationError) -> JsValue {
    let code = match error {
        oristudio_cp_detect::rectify::RectificationError::InvalidDimensions { .. } => {
            "invalid_dimensions"
        }
        oristudio_cp_detect::rectify::RectificationError::RgbaLengthMismatch { .. } => {
            "rgba_length_mismatch"
        }
        oristudio_cp_detect::rectify::RectificationError::InvalidQuad(_) => "invalid_quad",
        oristudio_cp_detect::rectify::RectificationError::SingularHomography => {
            "singular_homography"
        }
    };
    js_error(code, error.to_string())
}

fn to_js_decode_error(error: oristudio_cp_detect::decode::DecodeError) -> JsValue {
    let code = match error {
        oristudio_cp_detect::decode::DecodeError::InvalidImageSize(_) => "invalid_image_size",
        oristudio_cp_detect::decode::DecodeError::TensorLength { .. } => "tensor_length",
        oristudio_cp_detect::decode::DecodeError::Json(_) => "invalid_json",
    };
    js_error(code, error.to_string())
}

fn wasm_rectified_image(
    result: oristudio_cp_detect::rectify::RectifiedRgbaImage,
) -> Result<WasmRectifiedImage, JsValue> {
    let report_json = serde_json::to_string(&result.report)
        .map_err(|error| js_error("js_value", error.to_string()))?;
    Ok(WasmRectifiedImage {
        rgba: result.rgba,
        report_json,
        width: result.width,
        height: result.height,
    })
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
