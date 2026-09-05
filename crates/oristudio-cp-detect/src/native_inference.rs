//! The product's detection pipeline, natively: `auto_rectify_rgba`, ONNX
//! Runtime (CoreML on macOS, every core on the CPU elsewhere), then the fused
//! decode and exact solve the dialog runs. Shared by the batch tool
//! (`examples/detect_folder`) and the curated benchmark (`bin/curated_benchmark`),
//! and mirrors the desktop shell's session setup, so a number measured here is
//! a number the desktop app would produce.
//!
//! Behind the `native-inference` feature: it pulls in `ort`, which downloads a
//! runtime at build time and has no place in the wasm bridge.

use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use crate::decode::{self, DecodeConfig, DecoderBackend, DenseOutputs};
use crate::evidence_extract::JunctionEvidenceSource;
use crate::rectify::auto_rectify_rgba;
use crate::source_image_evidence::{SourceImageLineEvidenceOptions, line_probability_from_rgba};

/// The canvas the model reads, and the dialog's decode settings.
pub const IMAGE_SIZE: u32 = 1024;
pub const THRESHOLD: f32 = 0.65;
pub const JUNCTION_OFFSET_RADIUS_PX: f32 = 3.0;

/// The model's heads, by the names the dialog's manifest uses.
pub const OUTPUT_NAMES: [&str; 12] = [
    "line_logits",
    "angle",
    "junction_logits",
    "junction_offset",
    "assignment_logits",
    "non_crease_logits",
    "line_style_logits",
    "boundary_contact_logits",
    "vertex_type_logits",
    "boundary_side_logits",
    "boundary_offset",
    "boundary_coord",
];

/// One inference's heads, channel-major `f32` per head.
pub type Heads = HashMap<&'static str, Vec<f32>>;

/// An ONNX session opened the way the desktop shell opens one.
pub struct NativeSession {
    session: ort::session::Session,
    input_name: String,
    /// `coreml` or `cpu`.
    pub provider: &'static str,
}

impl NativeSession {
    /// CoreML with a model cache on macOS when it is available, every core on
    /// the CPU otherwise. The builder's error type carries the builder, so
    /// each variant is its own function and `?` does the conversion.
    pub fn open(model: &Path, cache_dir: &Path) -> Result<Self, String> {
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        #[cfg(target_os = "macos")]
        {
            use ort::ep::ExecutionProvider;
            if ort::ep::CoreML::default().is_available().unwrap_or(false) {
                let _ = std::fs::create_dir_all(cache_dir);
                match coreml_session(model, cache_dir) {
                    Ok(session) => return Self::wrap(session, "coreml"),
                    Err(reason) => {
                        eprintln!("[native-inference] CoreML refused, using the CPU: {reason}")
                    }
                }
            }
        }
        let _ = cache_dir;
        let session = cpu_session(model, cores).map_err(|e| format!("CPU session: {e}"))?;
        Self::wrap(session, "cpu")
    }

    fn wrap(session: ort::session::Session, provider: &'static str) -> Result<Self, String> {
        let input_name = session
            .inputs()
            .first()
            .map(|o| o.name().to_owned())
            .ok_or_else(|| "model has no input".to_owned())?;
        Ok(Self {
            session,
            input_name,
            provider,
        })
    }

    /// Run the model on a rectified `IMAGE_SIZE` square RGBA image.
    pub fn infer(&mut self, rgba: &[u8]) -> Result<(Heads, f64), String> {
        let started = Instant::now();
        let n = IMAGE_SIZE as usize;
        let input = preprocess(rgba, n);
        let tensor = ort::value::Tensor::from_array(([1usize, 3, n, n], input))
            .map_err(|e| format!("input tensor: {e}"))?;
        let outputs = self
            .session
            .run(ort::inputs![self.input_name.as_str() => tensor.view()])
            .map_err(|e| format!("onnx: {e}"))?;
        let mut heads: Heads = HashMap::new();
        for name in OUTPUT_NAMES {
            if let Some(value) = outputs.get(name)
                && let Ok((_, data)) = value.try_extract_tensor::<f32>()
            {
                heads.insert(name, data.to_vec());
            }
        }
        Ok((heads, started.elapsed().as_secs_f64() * 1000.0))
    }
}

#[cfg(target_os = "macos")]
fn coreml_session(model: &Path, cache_dir: &Path) -> ort::Result<ort::session::Session> {
    let session = ort::session::Session::builder()?
        .with_execution_providers([
            ort::ep::CoreML::default()
                .with_model_cache_dir(cache_dir.to_string_lossy().into_owned())
                .build(),
            ort::ep::CPU::default().build(),
        ])?
        .commit_from_file(model)?;
    Ok(session)
}

fn cpu_session(model: &Path, cores: usize) -> ort::Result<ort::session::Session> {
    let session = ort::session::Session::builder()?
        .with_execution_providers([ort::ep::CPU::default().build()])?
        .with_intra_threads(cores)?
        .commit_from_file(model)?;
    Ok(session)
}

/// RGBA bytes to the model's `[3, size, size]` tensor in `0..1`.
pub fn preprocess(rgba: &[u8], size: usize) -> Vec<f32> {
    let pixels = size * size;
    let mut tensor = vec![0.0f32; 3 * pixels];
    for pixel in 0..pixels {
        let base = pixel * 4;
        tensor[pixel] = f32::from(rgba[base]) / 255.0;
        tensor[pixels + pixel] = f32::from(rgba[base + 1]) / 255.0;
        tensor[2 * pixels + pixel] = f32::from(rgba[base + 2]) / 255.0;
    }
    tensor
}

/// A source image rectified onto the model's canvas, with the report the
/// dialog shows summarised as JSON.
pub struct Rectified {
    pub rgba: Vec<u8>,
    pub panel_detected: bool,
    pub report: serde_json::Value,
}

/// `auto_rectify_rgba` onto the `IMAGE_SIZE` canvas.
pub fn rectify(rgba: &[u8], width: u32, height: u32) -> Result<Rectified, String> {
    let rectified = auto_rectify_rgba(rgba, width, height, IMAGE_SIZE)
        .map_err(|e| format!("rectify: {e:?}"))?;
    let panel_detected = rectified.report.detected_source_quad.is_some();
    let report = serde_json::json!({
        "mode": rectified.report.mode,
        "confidence": rectified.report.confidence,
        "panel_detected": panel_detected,
        "warnings": rectified.report.warnings.iter().map(|w| w.code.clone()).collect::<Vec<_>>(),
    });
    Ok(Rectified {
        rgba: rectified.rgba,
        panel_detected,
        report,
    })
}

/// The dialog's decode: the fused candidate/exact-solve backend on the model's
/// heads plus the source image's own line evidence. `recognize_only` stops
/// before the compiler and the solve, which is how a pattern too large to
/// solve is recognised as such in under a second.
pub fn decode(
    rgba: &[u8],
    heads: &Heads,
    solve_budget_seconds: f64,
    recognize_only: bool,
) -> Result<decode::DecodedFold, String> {
    let required = |name: &'static str| -> Result<&[f32], String> {
        heads
            .get(name)
            .map(Vec::as_slice)
            .ok_or_else(|| format!("model has no {name} output"))
    };
    let line_probability = line_probability_from_rgba(
        rgba,
        IMAGE_SIZE,
        IMAGE_SIZE,
        SourceImageLineEvidenceOptions::default(),
    )
    .map_err(|e| e.to_string())?;
    let dense = DenseOutputs::from_legacy_heads(
        required("line_logits")?,
        required("junction_logits")?,
        required("assignment_logits")?,
        required("non_crease_logits")?,
        required("line_style_logits")?,
        required("boundary_contact_logits")?,
    )
    .with_angle(heads.get("angle").map(Vec::as_slice))
    .with_junction_offset(heads.get("junction_offset").map(Vec::as_slice))
    .with_vertex_type_logits(heads.get("vertex_type_logits").map(Vec::as_slice))
    .with_boundary_side_logits(heads.get("boundary_side_logits").map(Vec::as_slice))
    .with_boundary_offset(heads.get("boundary_offset").map(Vec::as_slice))
    .with_boundary_coord(heads.get("boundary_coord").map(Vec::as_slice))
    .with_line_probability_override(Some(&line_probability));
    decode::decode_dense_outputs_with_backend_junction_source_and_refined_vertices_in_regions(
        dense,
        DecodeConfig {
            image_size: IMAGE_SIZE,
            threshold: THRESHOLD,
            junction_offset_cluster_radius_px: JUNCTION_OFFSET_RADIUS_PX,
            exact_solve_timeout_seconds: solve_budget_seconds,
            recognize_only,
            ..DecodeConfig::default()
        },
        DecoderBackend::LegacyCandidateExactSolveV1,
        JunctionEvidenceSource::Model,
        None,
        None,
    )
    .map_err(|e| e.to_string())
}

/// Recognise first, and solve only when the recognised graph is within
/// `max_edges`: the fused backend's compiler stage has no budget of its own and
/// spends minutes on a thousand-edge pattern, which the solve budget cannot
/// bound. The error names the size so a report can say why a case was not
/// solved.
pub fn decode_bounded(
    rgba: &[u8],
    heads: &Heads,
    solve_budget_seconds: f64,
    max_edges: usize,
) -> Result<decode::DecodedFold, String> {
    let probe = decode(rgba, heads, solve_budget_seconds, true)?;
    let edges = serde_json::to_value(&probe.report)
        .ok()
        .and_then(|r| r.get("edge_count").and_then(|v| v.as_u64()))
        .unwrap_or(0) as usize;
    if edges > max_edges {
        return Err(format!(
            "too_large: {edges} edges recognized, over the {max_edges} edge cap; solve skipped"
        ));
    }
    decode(rgba, heads, solve_budget_seconds, false)
}
