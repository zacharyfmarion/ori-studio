//! `wasm-bindgen` wrapper around `oristudio-cp-detect`.

use serde::{Deserialize, Serialize};
use std::sync::Once;
use wasm_bindgen::prelude::*;

static PANIC_HOOK: Once = Once::new();

/// Canonical default junction source, exported so the browser reads the exact
/// value the Rust pipeline uses. Single source of truth:
/// `oristudio_cp_detect::defaults`. The generated TS constants
/// (`cpDetectDefaults.generated.ts`) are emitted from the same source, so the
/// two cannot silently diverge.
#[wasm_bindgen]
pub fn cp_detect_default_junction_source() -> String {
    oristudio_cp_detect::defaults::DEFAULT_JUNCTION_SOURCE.to_string()
}

/// Canonical default line-evidence source (see above).
#[wasm_bindgen]
pub fn cp_detect_default_line_evidence_source() -> String {
    oristudio_cp_detect::defaults::DEFAULT_LINE_EVIDENCE_SOURCE.to_string()
}

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
pub fn cp_detect_decode_dense_output_bundle(
    outputs: JsValue,
    image_size: u32,
    threshold: f32,
    decoder_backend: &str,
    junction_offset_radius_px: Option<f32>,
    exact_solve_timeout_seconds: Option<f64>,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let backend = parse_decoder_backend(decoder_backend)?;
    let outputs = JsDenseOutputBundle::from_js(&outputs)?;
    let decoded = oristudio_cp_detect::decode::decode_dense_outputs_with_backend(
        outputs.as_dense_outputs(),
        oristudio_cp_detect::decode::DecodeConfig {
            image_size,
            threshold,
            // From the model manifest's inference.junction_offset_radius_px:
            // radius-trained offset heads decode junctions via offset-vote
            // clustering; 0/undefined keeps legacy local-maxima decoding.
            junction_offset_cluster_radius_px: junction_offset_radius_px.unwrap_or(0.0),
            exact_solve_timeout_seconds: exact_solve_timeout_seconds.unwrap_or(
                oristudio_cp_detect::decode::DecodeConfig::default().exact_solve_timeout_seconds,
            ),
            ..oristudio_cp_detect::decode::DecodeConfig::default()
        },
        backend,
    )
    .map_err(to_js_decode_error)?;
    to_js_value_via_json(&decoded)
}

#[wasm_bindgen]
pub fn cp_detect_decode_dense_output_bundle_with_refined_vertices(
    outputs: JsValue,
    image_size: u32,
    threshold: f32,
    decoder_backend: &str,
    junction_offset_radius_px: Option<f32>,
    exact_solve_timeout_seconds: Option<f64>,
    refined_vertices_json: &str,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let backend = parse_decoder_backend(decoder_backend)?;
    let outputs = JsDenseOutputBundle::from_js(&outputs)?;
    let refined_payload = parse_refined_vertices_json(refined_vertices_json)?;
    let decoded =
        oristudio_cp_detect::decode::decode_dense_outputs_with_backend_and_refined_vertices(
            outputs.as_dense_outputs(),
            oristudio_cp_detect::decode::DecodeConfig {
                image_size,
                threshold,
                junction_offset_cluster_radius_px: junction_offset_radius_px.unwrap_or(0.0),
                exact_solve_timeout_seconds: exact_solve_timeout_seconds.unwrap_or(
                    oristudio_cp_detect::decode::DecodeConfig::default()
                        .exact_solve_timeout_seconds,
                ),
                ..oristudio_cp_detect::decode::DecodeConfig::default()
            },
            backend,
            refined_payload.vertices.as_deref(),
        )
        .map_err(to_js_decode_error)?;
    to_js_value_via_json(&decoded)
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn cp_detect_decode_dense_output_bundle_with_junction_source(
    outputs: JsValue,
    image_size: u32,
    threshold: f32,
    decoder_backend: &str,
    junction_offset_radius_px: Option<f32>,
    exact_solve_timeout_seconds: Option<f64>,
    junction_source: &str,
    refined_vertices_json: &str,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let backend = parse_decoder_backend(decoder_backend)?;
    let junction_evidence_source = parse_junction_evidence_source(junction_source)?;
    let outputs = JsDenseOutputBundle::from_js(&outputs)?;
    let refined_payload = parse_refined_vertices_json(refined_vertices_json)?;
    let decoded =
        oristudio_cp_detect::decode::decode_dense_outputs_with_backend_junction_source_and_refined_vertices_in_regions(
            outputs.as_dense_outputs(),
            oristudio_cp_detect::decode::DecodeConfig {
                image_size,
                threshold,
                junction_offset_cluster_radius_px: junction_offset_radius_px.unwrap_or(0.0),
                exact_solve_timeout_seconds: exact_solve_timeout_seconds.unwrap_or(
                    oristudio_cp_detect::decode::DecodeConfig::default()
                        .exact_solve_timeout_seconds,
                ),
                ..oristudio_cp_detect::decode::DecodeConfig::default()
            },
            backend,
            junction_evidence_source,
            refined_payload.vertices.as_deref(),
            refined_payload.regions.as_deref(),
        )
        .map_err(to_js_decode_error)?;
    to_js_value_via_json(&decoded)
}

/// The product decode path.
///
/// This is the only decode export the browser calls — `DEFAULT_LINE_EVIDENCE_SOURCE`
/// is `"source-image"` and `cpDetectWorker.ts` branches on that first — which is
/// why `recognize_only` is here and on none of the other three.
///
/// `recognize_only` is a trailing `Option<bool>`, so wasm-bindgen makes it an
/// omittable JS argument: every existing call site keeps its current meaning
/// (recognize *and* solve). Passing `true` stops after recognition and returns
/// the candidate crease pattern without spending up to 25 s solving topology the
/// user may be about to repair. The candidate self-identifies —
/// `cp_detector.source` is `"exact_solve_candidate"` rather than `"exact_solve"`.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn cp_detect_decode_dense_output_bundle_with_source_image_line_evidence(
    outputs: JsValue,
    image_size: u32,
    threshold: f32,
    decoder_backend: &str,
    junction_offset_radius_px: Option<f32>,
    exact_solve_timeout_seconds: Option<f64>,
    junction_source: &str,
    refined_vertices_json: &str,
    rgba: &[u8],
    width: u32,
    height: u32,
    recognize_only: Option<bool>,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    if width != image_size || height != image_size {
        return Err(js_error(
            "source_image_line_evidence",
            format!(
                "source image line evidence requires a rectified {image_size}x{image_size} image, got {width}x{height}"
            ),
        ));
    }
    let backend = parse_decoder_backend(decoder_backend)?;
    let junction_evidence_source = parse_junction_evidence_source(junction_source)?;
    let outputs = JsDenseOutputBundle::from_js(&outputs)?;
    let refined_payload = parse_refined_vertices_json(refined_vertices_json)?;
    let line_probability_override =
        oristudio_cp_detect::source_image_evidence::line_probability_from_rgba(
            rgba,
            width,
            height,
            oristudio_cp_detect::source_image_evidence::SourceImageLineEvidenceOptions::default(),
        )
        .map_err(|error| js_error("source_image_line_evidence", error.to_string()))?;
    let decoded =
        oristudio_cp_detect::decode::decode_dense_outputs_with_backend_junction_source_and_refined_vertices_in_regions(
            outputs
                .as_dense_outputs()
                .with_line_probability_override(Some(&line_probability_override)),
            oristudio_cp_detect::decode::DecodeConfig {
                image_size,
                threshold,
                junction_offset_cluster_radius_px: junction_offset_radius_px.unwrap_or(0.0),
                exact_solve_timeout_seconds: exact_solve_timeout_seconds.unwrap_or(
                    oristudio_cp_detect::decode::DecodeConfig::default()
                        .exact_solve_timeout_seconds,
                ),
                // Omitted from JS is `false`: recognize *and* solve, which is
                // what every caller got before this argument existed.
                recognize_only: recognize_only.unwrap_or(false),
                ..oristudio_cp_detect::decode::DecodeConfig::default()
            },
            backend,
            junction_evidence_source,
            refined_payload.vertices.as_deref(),
            refined_payload.regions.as_deref(),
        )
        .map_err(to_js_decode_error)?;
    to_js_value_via_json(&decoded)
}

/// Run the exact solver on an `ExactSolveInput`, returning the
/// `ExactSolvedGraph`.
///
/// This is the repair seam: `oristudio_cp_compiler::solve_exact` is a pure
/// function of its input, so the browser can take the `exact_solve_input`
/// emitted in a detection's `compiler_report`, edit the candidate topology by
/// hand, and hand it back here. No dense heads, no source image, no selection
/// state is involved.
///
/// `options_json` may be empty, `"null"`, or a partial object; any field it
/// omits keeps its `ExactSolveOptions::default()` value. An unrecognised field
/// name is an error rather than a silent no-op.
///
/// It may additionally carry `exempt_vertex_ids` — the ids of vertices the user
/// moved by hand, which are then excluded from the `max_vertex_movement` budget.
/// Without it a repaired vertex reads as a large drift and rejects the whole
/// solve, so this is what makes hand-repair reachable at all; see
/// [`oristudio_cp_compiler::ExactSolveOptionsWithExemptions`].
#[wasm_bindgen]
pub fn cp_detect_solve_exact(input_json: &str, options_json: &str) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let (input, options) = parse_exact_solve_request(input_json, options_json)?;
    let solved = oristudio_cp_compiler::solve_exact_with_exemptions(&input, &options);
    to_js_value_via_json(&solved)
}

/// Solve, then export the result as a FOLD document at the solved coordinates —
/// the same `export_exact_solved_to_fold_document` the detector's product path
/// uses, so the browser does not re-implement it.
///
/// Returns `{ schema, solved, fold }`: one solve serves both the FOLD geometry
/// and the `ExactSolvedGraph` status / movement report the repair UI reports
/// on. Solves run 0.36s (easy p50) to 25s (timeout cap), so this exists
/// specifically so a caller that needs both does not pay for two.
///
/// `options_json` takes the same shape as [`cp_detect_solve_exact`], including
/// `exempt_vertex_ids`.
#[wasm_bindgen]
pub fn cp_detect_solve_exact_to_fold(
    input_json: &str,
    options_json: &str,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let (input, options) = parse_exact_solve_request(input_json, options_json)?;
    let solved = oristudio_cp_compiler::solve_exact_with_exemptions(&input, &options);
    let document =
        oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document(&input, &solved)
            .map_err(to_js_compiler_error)?;

    let mut payload = serde_json::Map::new();
    payload.insert(
        "schema".to_owned(),
        serde_json::Value::String(SOLVE_EXACT_FOLD_SCHEMA.to_owned()),
    );
    payload.insert(
        "solved".to_owned(),
        serde_json::to_value(&solved).map_err(|error| js_error("js_value", error.to_string()))?,
    );
    payload.insert(
        "fold".to_owned(),
        serde_json::to_value(&document).map_err(|error| js_error("js_value", error.to_string()))?,
    );
    to_js_value_via_json(&serde_json::Value::Object(payload))
}

const SOLVE_EXACT_FOLD_SCHEMA: &str = "oristudio/cp-detect/solve-exact-fold-v1";

/// Rebuild an `ExactSolveInput` from a FOLD crease pattern — **the current
/// document's**, not the one detection attached at import.
///
/// A detection publishes its input once and the region carries it from then on.
/// Every hand repair after that — a degree-2 vertex merged, two corners joined,
/// a crease recoloured from valley to auxiliary — changes the document and not
/// the attachment, so a re-solve ran on geometry the user had already moved past
/// and reported blockers they had already fixed. This is the export that lets
/// the browser hand the solver what is actually on screen.
///
/// Takes a FOLD document as JSON — the browser gets one out of a scratch kernel
/// handle holding just the region's creases — and returns
/// `{ schema, input, transform }`. `transform` is the similarity onto the unit
/// square the solver works in; the caller inverts it to put the answer back in
/// document coordinates. That replaces guessing the frame and checking the guess
/// afterwards, and it is what makes a rotated pattern work.
///
/// Solving is deliberately **not** part of this: `cp_detect_solve_exact` already
/// runs in two stages with a shared budget, and folding the rebuild into it
/// would either duplicate that or spend the budget twice.
#[wasm_bindgen]
pub fn cp_detect_exact_solve_input_from_fold(fold_json: &str) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let fold: treemaker_fold::FoldDocument = serde_json::from_str(fold_json)
        .map_err(|error| js_error("invalid_fold", error.to_string()))?;
    let (input, transform) = oristudio_cp_compiler::exact_solve_input_from_fold(&fold)
        .map_err(|reason| js_error("unsupported_pattern", reason))?;

    let mut payload = serde_json::Map::new();
    payload.insert(
        "schema".to_owned(),
        serde_json::Value::String(EXACT_SOLVE_INPUT_FROM_FOLD_SCHEMA.to_owned()),
    );
    payload.insert(
        "input".to_owned(),
        serde_json::to_value(&input).map_err(|error| js_error("js_value", error.to_string()))?,
    );
    payload.insert(
        "transform".to_owned(),
        serde_json::to_value(transform).map_err(|error| js_error("js_value", error.to_string()))?,
    );
    to_js_value_via_json(&serde_json::Value::Object(payload))
}

const EXACT_SOLVE_INPUT_FROM_FOLD_SCHEMA: &str =
    "oristudio/cp-detect/exact-solve-input-from-fold-v1";

/// The shared front half of both solve exports: parse the input, parse the
/// options, and reject an exemption set that cannot do what it claims.
fn parse_exact_solve_request(
    input_json: &str,
    options_json: &str,
) -> Result<
    (
        oristudio_cp_compiler::ExactSolveInput,
        oristudio_cp_compiler::ExactSolveOptionsWithExemptions,
    ),
    JsValue,
> {
    // The parse lives in the compiler, shared with the desktop's native
    // commands; only the error envelope is this bridge's.
    oristudio_cp_compiler::parse_exact_solve_request(input_json, options_json).map_err(|message| {
        let code = if message.starts_with("exempt_vertex_ids names") {
            "unknown_exempt_vertex_id"
        } else {
            "invalid_exact_solve_options"
        };
        js_error(code, message)
    })
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
        oristudio_cp_detect::decode::DenseOutputs::from_legacy_heads(
            line_logits,
            junction_logits,
            assignment_logits,
            non_crease_logits,
            line_style_logits,
            boundary_contact_logits,
        ),
        oristudio_cp_detect::decode::DecodeConfig {
            image_size,
            threshold,
            ..oristudio_cp_detect::decode::DecodeConfig::default()
        },
    )
    .map_err(to_js_decode_error)?;
    to_js_value(&result)
}

#[wasm_bindgen]
pub fn cp_detect_build_inspector_stage_bundle(
    outputs: JsValue,
    options_json: &str,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let outputs = JsDenseOutputBundle::from_js(&outputs)?;
    let options: oristudio_cp_detect_inspector::UploadInspectorOptions =
        serde_json::from_str(options_json)
            .map_err(|error| js_error("invalid_json", error.to_string()))?;
    let bundle = oristudio_cp_detect_inspector::build_uploaded_stage_bundle(
        oristudio_cp_detect_inspector::DenseOutputsOwned {
            line_logits: outputs.line_logits,
            line_probability_override: None,
            angle: outputs.angle,
            junction_logits: outputs.junction_logits,
            junction_offset: outputs.junction_offset,
            assignment_logits: outputs.assignment_logits,
            non_crease_logits: outputs.non_crease_logits,
            line_style_logits: outputs.line_style_logits,
            vertex_type_logits: outputs.vertex_type_logits,
            boundary_contact_logits: outputs.boundary_contact_logits,
            boundary_side_logits: outputs.boundary_side_logits,
            boundary_offset: outputs.boundary_offset,
            boundary_coord: outputs.boundary_coord,
        },
        options,
    )
    .map_err(|error| js_error("inspector_stage_build", format!("{error:#}")))?;
    to_js_value_via_json(&bundle)
}

#[wasm_bindgen]
pub fn cp_detect_build_inspector_stage_bundle_with_source_image(
    outputs: JsValue,
    options_json: &str,
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let outputs = JsDenseOutputBundle::from_js(&outputs)?;
    let options: oristudio_cp_detect_inspector::UploadInspectorOptions =
        serde_json::from_str(options_json)
            .map_err(|error| js_error("invalid_json", error.to_string()))?;
    let bundle = oristudio_cp_detect_inspector::build_uploaded_stage_bundle_with_source_image(
        oristudio_cp_detect_inspector::DenseOutputsOwned {
            line_logits: outputs.line_logits,
            line_probability_override: None,
            angle: outputs.angle,
            junction_logits: outputs.junction_logits,
            junction_offset: outputs.junction_offset,
            assignment_logits: outputs.assignment_logits,
            non_crease_logits: outputs.non_crease_logits,
            line_style_logits: outputs.line_style_logits,
            vertex_type_logits: outputs.vertex_type_logits,
            boundary_contact_logits: outputs.boundary_contact_logits,
            boundary_side_logits: outputs.boundary_side_logits,
            boundary_offset: outputs.boundary_offset,
            boundary_coord: outputs.boundary_coord,
        },
        options,
        rgba,
        width,
        height,
    )
    .map_err(|error| js_error("inspector_stage_build", format!("{error:#}")))?;
    to_js_value_via_json(&bundle)
}

struct JsDenseOutputBundle {
    line_logits: Vec<f32>,
    angle: Option<Vec<f32>>,
    junction_logits: Vec<f32>,
    junction_offset: Option<Vec<f32>>,
    assignment_logits: Vec<f32>,
    non_crease_logits: Vec<f32>,
    line_style_logits: Vec<f32>,
    vertex_type_logits: Option<Vec<f32>>,
    boundary_contact_logits: Vec<f32>,
    boundary_side_logits: Option<Vec<f32>>,
    boundary_offset: Option<Vec<f32>>,
    boundary_coord: Option<Vec<f32>>,
}

impl JsDenseOutputBundle {
    fn from_js(value: &JsValue) -> Result<Self, JsValue> {
        Ok(Self {
            line_logits: required_f32_array(value, "line_logits")?,
            angle: optional_f32_array(value, "angle")?,
            junction_logits: required_f32_array(value, "junction_logits")?,
            junction_offset: optional_f32_array(value, "junction_offset")?,
            assignment_logits: required_f32_array(value, "assignment_logits")?,
            non_crease_logits: required_f32_array(value, "non_crease_logits")?,
            line_style_logits: required_f32_array(value, "line_style_logits")?,
            vertex_type_logits: optional_f32_array(value, "vertex_type_logits")?,
            boundary_contact_logits: required_f32_array(value, "boundary_contact_logits")?,
            boundary_side_logits: optional_f32_array(value, "boundary_side_logits")?,
            boundary_offset: optional_f32_array(value, "boundary_offset")?,
            boundary_coord: optional_f32_array(value, "boundary_coord")?,
        })
    }

    fn as_dense_outputs(&self) -> oristudio_cp_detect::decode::DenseOutputs<'_> {
        oristudio_cp_detect::decode::DenseOutputs::from_legacy_heads(
            &self.line_logits,
            &self.junction_logits,
            &self.assignment_logits,
            &self.non_crease_logits,
            &self.line_style_logits,
            &self.boundary_contact_logits,
        )
        .with_angle(self.angle.as_deref())
        .with_junction_offset(self.junction_offset.as_deref())
        .with_vertex_type_logits(self.vertex_type_logits.as_deref())
        .with_boundary_side_logits(self.boundary_side_logits.as_deref())
        .with_boundary_offset(self.boundary_offset.as_deref())
        .with_boundary_coord(self.boundary_coord.as_deref())
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum JsRefinedVertexPayload {
    Vertices(Vec<oristudio_cp_detect::decode::RefinedVertexPrimitive>),
    DebugPayload {
        merged_vertices: Vec<oristudio_cp_detect::decode::RefinedVertexPrimitive>,
        #[serde(default)]
        refinement_regions: Option<Vec<oristudio_cp_detect::decode::RefinedVertexRegion>>,
    },
}

struct JsParsedRefinedVertexPayload {
    vertices: Option<Vec<oristudio_cp_detect::decode::RefinedVertexPrimitive>>,
    regions: Option<Vec<oristudio_cp_detect::decode::RefinedVertexRegion>>,
}

fn parse_refined_vertices_json(text: &str) -> Result<JsParsedRefinedVertexPayload, JsValue> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(JsParsedRefinedVertexPayload {
            vertices: None,
            regions: None,
        });
    }
    let payload: JsRefinedVertexPayload = serde_json::from_str(trimmed)
        .map_err(|error| js_error("invalid_json", error.to_string()))?;
    Ok(match payload {
        JsRefinedVertexPayload::Vertices(vertices) => JsParsedRefinedVertexPayload {
            vertices: Some(vertices),
            regions: None,
        },
        JsRefinedVertexPayload::DebugPayload {
            merged_vertices,
            refinement_regions,
        } => JsParsedRefinedVertexPayload {
            vertices: Some(merged_vertices),
            regions: refinement_regions,
        },
    })
}

fn required_f32_array(object: &JsValue, name: &'static str) -> Result<Vec<f32>, JsValue> {
    optional_f32_array(object, name)?.ok_or_else(|| {
        js_error(
            "missing_dense_output",
            format!("missing dense output {name}"),
        )
    })
}

fn optional_f32_array(object: &JsValue, name: &'static str) -> Result<Option<Vec<f32>>, JsValue> {
    let value = js_sys::Reflect::get(object, &JsValue::from_str(name))
        .map_err(|_| js_error("invalid_dense_output", format!("could not read {name}")))?;
    if value.is_undefined() || value.is_null() {
        return Ok(None);
    }
    if !value.is_instance_of::<js_sys::Float32Array>() {
        return Err(js_error(
            "invalid_dense_output",
            format!("{name} must be a Float32Array"),
        ));
    }
    let array = js_sys::Float32Array::new(&value);
    let mut data = vec![0.0; array.length() as usize];
    array.copy_to(&mut data);
    Ok(Some(data))
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
        oristudio_cp_detect::decode::DenseOutputs::from_legacy_heads(
            line_logits,
            junction_logits,
            assignment_logits,
            non_crease_logits,
            line_style_logits,
            boundary_contact_logits,
        ),
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

fn parse_junction_evidence_source(
    value: &str,
) -> Result<oristudio_cp_detect::evidence_extract::JunctionEvidenceSource, JsValue> {
    match value {
        "dense-model" | "model" | "dense_model" => {
            Ok(oristudio_cp_detect::evidence_extract::JunctionEvidenceSource::Model)
        }
        "line-arrangement" | "line_arrangement" => {
            Ok(oristudio_cp_detect::evidence_extract::JunctionEvidenceSource::LineArrangement)
        }
        "vertex-refiner-v3" | "vertex_refiner_v3" => {
            Ok(oristudio_cp_detect::evidence_extract::JunctionEvidenceSource::Model)
        }
        other => Err(js_error(
            "invalid_junction_source",
            format!("unsupported junction source {other:?}"),
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

fn to_js_compiler_error(error: oristudio_cp_compiler::CompilerError) -> JsValue {
    let code = match error {
        oristudio_cp_compiler::CompilerError::Json(_) => "invalid_json",
        oristudio_cp_compiler::CompilerError::MissingField(_) => "missing_field",
        oristudio_cp_compiler::CompilerError::InvalidEntry { .. } => "invalid_entry",
        oristudio_cp_compiler::CompilerError::ExactExport(_) => "exact_export",
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

#[cfg(test)]
mod default_export_tests {
    //! wasm-parity guardrail (Rust side): the values the browser reads from the
    //! wasm bundle must be the canonical `oristudio_cp_detect::defaults`. Paired
    //! with the codegen (`emit-cp-detect-defaults-ts`) that emits the generated
    //! TS from the same source, this proves generated-TS == wasm-export by
    //! construction.
    #[test]
    fn exports_match_canonical_defaults() {
        assert_eq!(
            super::cp_detect_default_junction_source(),
            oristudio_cp_detect::defaults::DEFAULT_JUNCTION_SOURCE
        );
        assert_eq!(
            super::cp_detect_default_line_evidence_source(),
            oristudio_cp_detect::defaults::DEFAULT_LINE_EVIDENCE_SOURCE
        );
    }
}

#[cfg(test)]
mod exact_solve_options_tests {
    //! `JsValue` is unusable off-target, so these cover the parsing helper the
    //! solve exports share rather than the exports themselves.
    use oristudio_cp_compiler::exact_solve_options_from_json;
    use oristudio_cp_compiler::{ExactSolveOptions, ExactSolveOptionsWithExemptions};
    use std::collections::BTreeSet;

    fn defaults() -> ExactSolveOptionsWithExemptions {
        ExactSolveOptionsWithExemptions::from(ExactSolveOptions::default())
    }

    #[test]
    fn empty_and_null_options_fall_back_to_defaults() {
        assert_eq!(exact_solve_options_from_json(""), Ok(defaults()));
        assert_eq!(exact_solve_options_from_json("   "), Ok(defaults()));
        assert_eq!(exact_solve_options_from_json("null"), Ok(defaults()));
        assert_eq!(exact_solve_options_from_json("{}"), Ok(defaults()));
    }

    #[test]
    fn partial_options_override_only_the_named_fields() {
        let default = ExactSolveOptions::default();
        let parsed = exact_solve_options_from_json(
            r#"{"max_vertex_movement": 0.1, "timeout_seconds": 5.0}"#,
        )
        .expect("partial options");

        assert_eq!(parsed.options.max_vertex_movement, 0.1);
        assert_eq!(parsed.options.timeout_seconds, 5.0);
        // Everything else is inherited; the priors in particular must not be
        // silently reset, since they are what keeps the solver from drifting to
        // a nearby valid-but-wrong CP.
        assert_eq!(parsed.options.movement_sigma, default.movement_sigma);
        assert_eq!(
            parsed.options.boundary_movement_sigma,
            default.boundary_movement_sigma
        );
        assert_eq!(parsed.options.polish, default.polish);
        assert_eq!(parsed.options.linear_solver, default.linear_solver);
    }

    #[test]
    fn a_misspelled_option_is_an_error_rather_than_a_silent_no_op() {
        let error = exact_solve_options_from_json(r#"{"max_vertex_moovement": 0.1}"#)
            .expect_err("unknown option");
        assert!(error.contains("max_vertex_moovement"), "{error}");
    }

    #[test]
    fn non_object_options_are_rejected() {
        assert!(exact_solve_options_from_json("[]").is_err());
        assert!(exact_solve_options_from_json("7").is_err());
        assert!(exact_solve_options_from_json("{oops}").is_err());
    }

    #[test]
    fn exempt_vertex_ids_are_accepted_and_default_to_empty() {
        // Empty is what makes the widening invisible to callers that never ask
        // for it: `solve_exact_with_exemptions` with an empty set is
        // `solve_exact`.
        assert!(
            exact_solve_options_from_json(r#"{"polish": false}"#)
                .expect("options without exemptions")
                .exempt_vertex_ids
                .is_empty()
        );

        let parsed =
            exact_solve_options_from_json(r#"{"polish": false, "exempt_vertex_ids": [11, 3, 3]}"#)
                .expect("options with exemptions");
        assert_eq!(parsed.exempt_vertex_ids, BTreeSet::from([3, 11]));
        assert!(!parsed.options.polish);
        assert_eq!(
            parsed.options.max_vertex_movement,
            ExactSolveOptions::default().max_vertex_movement
        );
    }

    #[test]
    fn exempt_vertex_ids_alone_leaves_every_option_at_its_default() {
        let parsed = exact_solve_options_from_json(r#"{"exempt_vertex_ids": [7]}"#)
            .expect("exemptions only");
        assert_eq!(parsed.options, ExactSolveOptions::default());
        assert_eq!(parsed.exempt_vertex_ids, BTreeSet::from([7]));
    }

    #[test]
    fn a_fully_serialized_options_object_still_parses_unchanged() {
        // The parse now runs through `#[serde(flatten)]`, which buffers every
        // field as an untyped `Content` before typing it. This is the guard that
        // the detour costs nothing: a serialized `ExactSolveOptions` — every
        // field, every numeric shape — must come back equal to what went in.
        let options = ExactSolveOptions {
            max_vertex_movement: 0.25,
            patience: 7,
            polish: false,
            linear_solver: oristudio_cp_compiler::LinearSolver::Dense,
            ..ExactSolveOptions::default()
        };
        let text = serde_json::to_string(&options).expect("serialize options");

        let parsed = exact_solve_options_from_json(&text).expect("full options");
        assert_eq!(parsed.options, options);
        assert!(parsed.exempt_vertex_ids.is_empty());
    }

    #[test]
    fn an_integer_literal_still_reaches_a_float_field() {
        // JSON has one number type and `JSON.stringify(5.0)` is `"5"`, so the
        // browser routinely sends integers for `f64` knobs. Flattened
        // deserialization must not start rejecting them.
        let parsed = exact_solve_options_from_json(r#"{"timeout_seconds": 5, "patience": 12}"#)
            .expect("integer literals");
        assert_eq!(parsed.options.timeout_seconds, 5.0);
        assert_eq!(parsed.options.patience, 12);
    }

    #[test]
    fn a_misspelled_exemption_key_is_still_an_error() {
        let error = exact_solve_options_from_json(r#"{"exempt_vertex_id": [3]}"#)
            .expect_err("near-miss key");
        assert!(error.contains("exempt_vertex_id"), "{error}");
    }
}

#[cfg(test)]
mod exempt_vertex_id_tests {}
