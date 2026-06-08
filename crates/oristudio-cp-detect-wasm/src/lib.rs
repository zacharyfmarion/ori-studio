//! `wasm-bindgen` wrapper around `oristudio-cp-detect`.

use serde::Serialize;
use std::sync::Once;
use wasm_bindgen::prelude::*;

static PANIC_HOOK: Once = Once::new();

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
    install_panic_hook();
    to_js_value(&oristudio_cp_detect::package_info())
}

#[wasm_bindgen]
pub fn cp_detect_parse_model_manifest(text: &str) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let manifest =
        oristudio_cp_detect::parse_model_manifest_json(text).map_err(to_js_config_error)?;
    to_js_value(&manifest)
}

#[wasm_bindgen]
pub fn cp_detect_parse_oracle_fixture_manifest(text: &str) -> Result<JsValue, JsValue> {
    install_panic_hook();
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
    install_panic_hook();
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
    install_panic_hook();
    let quad: oristudio_cp_detect::rectify::Quad = serde_json::from_str(quad_json)
        .map_err(|error| js_error("invalid_json", error.to_string()))?;
    let result =
        oristudio_cp_detect::rectify::manual_rectify_rgba(rgba, width, height, image_size, quad)
            .map_err(to_js_rectification_error)?;
    wasm_rectified_image(result)
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
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
    install_panic_hook();
    decode_dense_outputs_with_backend(
        line_logits,
        junction_logits,
        assignment_logits,
        non_crease_logits,
        line_style_logits,
        boundary_contact_logits,
        image_size,
        threshold,
        oristudio_cp_detect::decode::DecoderBackend::LegacyV2,
    )
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn cp_detect_decode_dense_outputs_with_backend(
    line_logits: &[f32],
    junction_logits: &[f32],
    assignment_logits: &[f32],
    non_crease_logits: &[f32],
    line_style_logits: &[f32],
    boundary_contact_logits: &[f32],
    image_size: u32,
    threshold: f32,
    decoder_backend: &str,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let backend = parse_decoder_backend(decoder_backend)?;
    decode_dense_outputs_with_backend(
        line_logits,
        junction_logits,
        assignment_logits,
        non_crease_logits,
        line_style_logits,
        boundary_contact_logits,
        image_size,
        threshold,
        backend,
    )
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn cp_detect_ablate_dense_outputs(
    line_logits: &[f32],
    junction_logits: &[f32],
    assignment_logits: &[f32],
    non_crease_logits: &[f32],
    line_style_logits: &[f32],
    boundary_contact_logits: &[f32],
    image_size: u32,
    threshold: f32,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let result = oristudio_cp_detect::decode::ablate_dense_outputs(
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
    to_js_value(&result)
}

#[allow(clippy::too_many_arguments)]
fn decode_dense_outputs_with_backend(
    line_logits: &[f32],
    junction_logits: &[f32],
    assignment_logits: &[f32],
    non_crease_logits: &[f32],
    line_style_logits: &[f32],
    boundary_contact_logits: &[f32],
    image_size: u32,
    threshold: f32,
    decoder_backend: oristudio_cp_detect::decode::DecoderBackend,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let decoded = oristudio_cp_detect::decode::decode_dense_outputs_with_backend(
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
        decoder_backend,
    )
    .map_err(to_js_decode_error)?;
    to_js_value_via_json(&decoded)
}

fn install_panic_hook() {
    PANIC_HOOK.call_once(console_error_panic_hook::set_once);
}

fn parse_decoder_backend(
    value: &str,
) -> Result<oristudio_cp_detect::decode::DecoderBackend, JsValue> {
    match value {
        "legacy-v2" | "legacy_v2" | "legacy_v2_decoder" => {
            Ok(oristudio_cp_detect::decode::DecoderBackend::LegacyV2)
        }
        "constraint-compiler-v1" | "constraint_compiler_v1" => {
            Ok(oristudio_cp_detect::decode::DecoderBackend::ConstraintCompilerV1)
        }
        "constraint-compiler-v2" | "constraint_compiler_v2" => {
            Ok(oristudio_cp_detect::decode::DecoderBackend::ConstraintCompilerV2)
        }
        "legacy-candidate-exact-solve-v1" | "legacy_candidate_exact_solve_v1" => {
            Ok(oristudio_cp_detect::decode::DecoderBackend::LegacyCandidateExactSolveV1)
        }
        other => Err(js_error(
            "invalid_decoder_backend",
            format!("unsupported decoder backend {other:?}"),
        )),
    }
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
        oristudio_cp_detect::decode::DecodeError::BufferLength { .. } => "buffer_length",
        oristudio_cp_detect::decode::DecodeError::Hough(_) => "hough",
        oristudio_cp_detect::decode::DecodeError::Json(_) => "invalid_json",
        oristudio_cp_detect::decode::DecodeError::Compiler(_) => "compiler",
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

fn to_js_value_via_json(value: &impl Serialize) -> Result<JsValue, JsValue> {
    let text =
        serde_json::to_string(value).map_err(|error| js_error("js_value", error.to_string()))?;
    js_sys::JSON::parse(&text).map_err(|error| {
        js_error(
            "js_value",
            format!("failed to parse serialized JSON result: {error:?}"),
        )
    })
}

fn js_error(code: &'static str, message: String) -> JsValue {
    let fallback = message.clone();
    to_js_value(&JsErrorEnvelope { code, message })
        .unwrap_or_else(|_| JsValue::from_str(fallback.as_str()))
}
