//! Native CP detection: the model on disk, ONNX Runtime on this machine's own
//! hardware, and the exact solver with a Stop.
//!
//! The web runs detection in a wasm worker — ONNX Runtime Web with WebGPU or
//! wasm threads, the solver in wasm. Desktop has a machine to use: this module
//! is the same `CpDetectWorkerApi` surface the worker offers, implemented over
//! Tauri commands, with the model read from the app data directory (where the
//! page's model store put it) and inference on CoreML, DirectML or all cores.
//! Rectification stays in the worker on every surface: it is fast, and the
//! pixels are already there.
//!
//! Measured on an M-series Mac with the current 45 MB model: CPU on all cores
//! 1.8 s per image, CoreML 0.45 s after a one-time 17 s compile that the model
//! cache directory keeps.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use oristudio_cp::session::EngineError;
use oristudio_cp_compiler::{
    ExactSolveInput, ExactSolveOptionsWithExemptions, ExactSolvedGraphStatus,
    parse_exact_solve_request, with_cancellation,
};
use oristudio_cp_detect::decode::{self, DecodeConfig, DecoderBackend, DenseOutputs};
use oristudio_cp_detect::evidence_extract::JunctionEvidenceSource;
use oristudio_cp_detect::source_image_evidence::{
    SourceImageLineEvidenceOptions, line_probability_from_rgba,
};
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct NativeSession {
    model_id: String,
    provider: &'static str,
    session_create_ms: f64,
    session: ort::session::Session,
}

#[derive(Default)]
pub struct DetectState {
    session: Mutex<Option<NativeSession>>,
    /// The Stop of each live solve, by the run id the web's registry minted.
    cancels: Mutex<HashMap<u32, Arc<AtomicBool>>>,
}

pub type DetectStateHandle = Arc<DetectState>;

pub fn new_state() -> DetectStateHandle {
    DetectStateHandle::default()
}

fn error(code: &'static str, message: impl Into<String>) -> EngineError {
    EngineError::new(code, message)
}

// ---------------------------------------------------------------------------
// Model files
// ---------------------------------------------------------------------------

/// One installed model, as the page's model store lists it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledModel {
    pub id: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub installed_at: String,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, EngineError> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| error("app_data_dir", e.to_string()))?;
    Ok(data.join("models").join("cp-detector"))
}

/// A model id is a file name: nothing that could climb out of the directory.
fn checked_id(id: &str) -> Result<&str, EngineError> {
    let ok = !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        && !id.starts_with('.');
    if ok {
        Ok(id)
    } else {
        Err(error("bad_model_id", format!("not a model id: {id:?}")))
    }
}

fn model_dir(app: &AppHandle, id: &str) -> Result<PathBuf, EngineError> {
    Ok(models_dir(app)?.join(checked_id(id)?))
}

fn read_meta(dir: &Path) -> Option<InstalledModel> {
    let meta = std::fs::read_to_string(dir.join("meta.json")).ok()?;
    let parsed: InstalledModel = serde_json::from_str(&meta).ok()?;
    dir.join("model.onnx").is_file().then_some(parsed)
}

#[tauri::command]
pub fn cp_detect_model_dir(app: AppHandle) -> Result<String, EngineError> {
    Ok(models_dir(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn cp_detect_model_list(app: AppHandle) -> Result<Vec<InstalledModel>, EngineError> {
    let dir = models_dir(&app)?;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut models: Vec<InstalledModel> = entries
        .flatten()
        .filter_map(|entry| read_meta(&entry.path()))
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

#[tauri::command]
pub fn cp_detect_model_path(app: AppHandle, id: String) -> Result<Option<String>, EngineError> {
    let dir = model_dir(&app, &id)?;
    Ok(read_meta(&dir).map(|_| dir.join("model.onnx").to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn cp_detect_model_remove(
    app: AppHandle,
    id: String,
    state: State<'_, DetectStateHandle>,
) -> Result<bool, EngineError> {
    let dir = model_dir(&app, &id)?;
    if !dir.is_dir() {
        return Ok(false);
    }
    // A session built from this model must not outlive its file.
    if let Ok(mut slot) = state.session.lock()
        && slot.as_ref().is_some_and(|live| live.model_id == id)
    {
        *slot = None;
    }
    std::fs::remove_dir_all(&dir).map_err(|e| error("model_remove", e.to_string()))?;
    Ok(true)
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, EngineError> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| error("missing_header", format!("request has no {name} header")))
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], EngineError> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.as_slice()),
        InvokeBody::Json(_) => Err(error("raw_body", "expected a binary request body")),
    }
}

/// Store a model the page downloaded and verified. The bytes cross the IPC as a
/// raw body, never as JSON; the id and sha travel as headers. Written to a
/// `.part` file and renamed, so an interrupted store leaves no half model
/// behind that `model_list` would report as installed.
#[tauri::command]
pub fn cp_detect_model_store(
    app: AppHandle,
    request: Request<'_>,
) -> Result<InstalledModel, EngineError> {
    let id = header(&request, "x-model-id")?.to_owned();
    let sha256 = header(&request, "x-model-sha256")?.to_owned();
    let bytes = raw_body(&request)?;
    let dir = model_dir(&app, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| error("model_store", e.to_string()))?;
    let part = dir.join("model.onnx.part");
    std::fs::write(&part, bytes).map_err(|e| error("model_store", e.to_string()))?;
    std::fs::rename(&part, dir.join("model.onnx"))
        .map_err(|e| error("model_store", e.to_string()))?;
    let meta = InstalledModel {
        id,
        size_bytes: bytes.len() as u64,
        sha256,
        installed_at: now_iso(),
    };
    std::fs::write(
        dir.join("meta.json"),
        serde_json::to_vec_pretty(&meta).map_err(|e| error("model_store", e.to_string()))?,
    )
    .map_err(|e| error("model_store", e.to_string()))?;
    Ok(meta)
}

fn now_iso() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Civil date from the epoch, good enough for "installed on"; no clock
    // crate for one string.
    let days = seconds / 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        (seconds % 86_400) / 3600,
        (seconds % 3600) / 60,
        seconds % 60
    )
}

/// Howard Hinnant's days-to-civil, for a timestamp without a dependency.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

/// What the page asks a recognition for — the manifest's inference block and
/// the run options the worker would have taken.
#[derive(Debug, Clone, Deserialize)]
pub struct RecognizeOptions {
    pub model_id: String,
    pub image_size: u32,
    pub threshold: f32,
    #[serde(default)]
    pub junction_offset_radius_px: Option<f32>,
    pub decoder_backend: String,
    #[serde(default = "default_junction_source")]
    pub junction_source: String,
    #[serde(default)]
    pub recognize_only: bool,
    #[serde(default)]
    pub exact_solve_timeout_seconds: Option<f64>,
}

fn default_junction_source() -> String {
    "dense-model".to_owned()
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeRuntimeInfo {
    pub active_execution_provider: &'static str,
    pub session_create_ms: f64,
    pub preprocess_ms: f64,
    pub model_run_ms: f64,
    pub output_collect_ms: f64,
    pub total_inference_ms: f64,
    pub decode_ms: f64,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecognizeResponse {
    pub fold_json: String,
    pub report: decode::DecodeReport,
    pub runtime: NativeRuntimeInfo,
}

fn parse_decoder_backend(value: &str) -> Result<DecoderBackend, EngineError> {
    match value {
        "legacy-v2" | "legacy_v2" | "legacy_v2_decoder" => Ok(DecoderBackend::LegacyV2),
        "constraint-compiler-v1" | "constraint_compiler_v1" => {
            Ok(DecoderBackend::ConstraintCompilerV1)
        }
        "constraint-compiler-v2" | "constraint_compiler_v2" => {
            Ok(DecoderBackend::ConstraintCompilerV2)
        }
        "legacy-candidate-exact-solve-v1" | "legacy_candidate_exact_solve_v1" => {
            Ok(DecoderBackend::LegacyCandidateExactSolveV1)
        }
        other => Err(error(
            "invalid_decoder_backend",
            format!("unknown decoder backend {other:?}"),
        )),
    }
}

fn parse_junction_source(value: &str) -> Result<JunctionEvidenceSource, EngineError> {
    match value {
        "dense-model" | "model" | "dense_model" | "vertex-refiner-v3" | "vertex_refiner_v3" => {
            Ok(JunctionEvidenceSource::Model)
        }
        "line-arrangement" | "line_arrangement" => Ok(JunctionEvidenceSource::LineArrangement),
        other => Err(error(
            "invalid_junction_source",
            format!("unknown junction source {other:?}"),
        )),
    }
}

/// RGB, planar, 0..1 — the manifest's `rgb_chw_float32_0_1`, the same as the
/// worker's `preprocessCpDetectImage`.
fn preprocess(rgba: &[u8], size: usize) -> Vec<f32> {
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

fn build_session(
    model_path: &Path,
    cache_dir: &Path,
) -> Result<(&'static str, ort::session::Session), EngineError> {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    #[cfg(target_os = "macos")]
    {
        use ort::ep::ExecutionProvider;
        if ort::ep::CoreML::default().is_available().unwrap_or(false) {
            let _ = std::fs::create_dir_all(cache_dir);
            match coreml_session(model_path, cache_dir) {
                Ok(session) => return Ok(("coreml", session)),
                Err(reason) => {
                    eprintln!("[cp-detect] CoreML session refused, using the CPU: {reason}")
                }
            }
        }
    }
    let _ = cache_dir;
    cpu_session(model_path, cores)
        .map(|session| ("cpu", session))
        .map_err(|e| error("onnx_session", e.to_string()))
}

#[cfg(target_os = "macos")]
fn coreml_session(model_path: &Path, cache_dir: &Path) -> ort::Result<ort::session::Session> {
    let _ = cache_dir;
    let session = ort::session::Session::builder()?
        .with_execution_providers([
            ort::ep::CoreML::default()
                .with_model_cache_dir(cache_dir.to_string_lossy().into_owned())
                .build(),
            ort::ep::CPU::default().build(),
        ])?
        .commit_from_file(model_path)?;
    Ok(session)
}

fn cpu_session(model_path: &Path, cores: usize) -> ort::Result<ort::session::Session> {
    let session = ort::session::Session::builder()?
        .with_execution_providers([ort::ep::CPU::default().build()])?
        .with_intra_threads(cores)?
        .commit_from_file(model_path)?;
    Ok(session)
}

fn ensure_session<'a>(
    slot: &'a mut Option<NativeSession>,
    app: &AppHandle,
    model_id: &str,
) -> Result<&'a mut NativeSession, EngineError> {
    if slot.as_ref().is_none_or(|live| live.model_id != model_id) {
        let dir = model_dir(app, model_id)?;
        let model_path = dir.join("model.onnx");
        if read_meta(&dir).is_none() {
            return Err(error(
                "model_not_installed",
                format!("model {model_id} is not installed"),
            ));
        }
        let cache_dir = models_dir(app)?.join("coreml-cache").join(model_id);
        let started = Instant::now();
        let (provider, session) = build_session(&model_path, &cache_dir)?;
        *slot = Some(NativeSession {
            model_id: model_id.to_owned(),
            provider,
            session_create_ms: started.elapsed().as_secs_f64() * 1000.0,
            session,
        });
    }
    slot.as_mut()
        .ok_or_else(|| error("onnx_session", "no session"))
}

fn output_named(
    outputs: &ort::session::SessionOutputs<'_>,
    name: &str,
) -> Result<Option<Vec<f32>>, EngineError> {
    let Some(value) = outputs.get(name) else {
        return Ok(None);
    };
    let (_, data) = value
        .try_extract_tensor::<f32>()
        .map_err(|e| error("onnx_output", format!("{name}: {e}")))?;
    Ok(Some(data.to_vec()))
}

fn required<'a>(
    map: &'a HashMap<&'static str, Vec<f32>>,
    name: &'static str,
) -> Result<&'a [f32], EngineError> {
    map.get(name)
        .map(Vec::as_slice)
        .ok_or_else(|| error("onnx_output", format!("model has no {name} output")))
}

const OUTPUT_NAMES: [&str; 12] = [
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

fn recognize(
    state: &DetectState,
    app: &AppHandle,
    rgba: &[u8],
    width: u32,
    height: u32,
    options: &RecognizeOptions,
) -> Result<RecognizeResponse, EngineError> {
    let size = options.image_size;
    if width != size || height != size {
        return Err(error(
            "image_size",
            format!("recognition needs a rectified {size}x{size} image, got {width}x{height}"),
        ));
    }
    if rgba.len() != (size as usize) * (size as usize) * 4 {
        return Err(error(
            "image_size",
            "RGBA length does not match the image size",
        ));
    }
    let backend = parse_decoder_backend(&options.decoder_backend)?;
    let junction_source = parse_junction_source(&options.junction_source)?;

    let total_started = Instant::now();
    let mut slot = state
        .session
        .lock()
        .map_err(|_| error("engine_poisoned", "detector session is unavailable"))?;
    let live = ensure_session(&mut slot, app, &options.model_id)?;

    let started = Instant::now();
    let input = preprocess(rgba, size as usize);
    let preprocess_ms = started.elapsed().as_secs_f64() * 1000.0;

    let started = Instant::now();
    let n = size as usize;
    let tensor = ort::value::Tensor::from_array(([1usize, 3, n, n], input))
        .map_err(|e| error("onnx_input", e.to_string()))?;
    let input_name = live
        .session
        .inputs()
        .first()
        .map(|outlet| outlet.name().to_owned())
        .ok_or_else(|| error("onnx_input", "model has no inputs"))?;
    let outputs = live
        .session
        .run(ort::inputs![input_name.as_str() => tensor.view()])
        .map_err(|e| error("onnx_run", e.to_string()))?;
    let model_run_ms = started.elapsed().as_secs_f64() * 1000.0;

    let started = Instant::now();
    let mut collected: HashMap<&'static str, Vec<f32>> = HashMap::new();
    for name in OUTPUT_NAMES {
        if let Some(data) = output_named(&outputs, name)? {
            collected.insert(name, data);
        }
    }
    drop(outputs);
    let output_collect_ms = started.elapsed().as_secs_f64() * 1000.0;
    let total_inference_ms = total_started.elapsed().as_secs_f64() * 1000.0;

    let started = Instant::now();
    let line_probability = line_probability_from_rgba(
        rgba,
        width,
        height,
        SourceImageLineEvidenceOptions::default(),
    )
    .map_err(|e| error("source_image_line_evidence", e.to_string()))?;
    let dense = DenseOutputs::from_legacy_heads(
        required(&collected, "line_logits")?,
        required(&collected, "junction_logits")?,
        required(&collected, "assignment_logits")?,
        required(&collected, "non_crease_logits")?,
        required(&collected, "line_style_logits")?,
        required(&collected, "boundary_contact_logits")?,
    )
    .with_angle(collected.get("angle").map(Vec::as_slice))
    .with_junction_offset(collected.get("junction_offset").map(Vec::as_slice))
    .with_vertex_type_logits(collected.get("vertex_type_logits").map(Vec::as_slice))
    .with_boundary_side_logits(collected.get("boundary_side_logits").map(Vec::as_slice))
    .with_boundary_offset(collected.get("boundary_offset").map(Vec::as_slice))
    .with_boundary_coord(collected.get("boundary_coord").map(Vec::as_slice))
    .with_line_probability_override(Some(&line_probability));
    let decoded =
        decode::decode_dense_outputs_with_backend_junction_source_and_refined_vertices_in_regions(
            dense,
            DecodeConfig {
                image_size: size,
                threshold: options.threshold,
                junction_offset_cluster_radius_px: options.junction_offset_radius_px.unwrap_or(0.0),
                exact_solve_timeout_seconds: options
                    .exact_solve_timeout_seconds
                    .unwrap_or(DecodeConfig::default().exact_solve_timeout_seconds),
                recognize_only: options.recognize_only,
                ..DecodeConfig::default()
            },
            backend,
            junction_source,
            None,
            None,
        )
        .map_err(|e| error("decode", e.to_string()))?;
    let decode_ms = started.elapsed().as_secs_f64() * 1000.0;

    Ok(RecognizeResponse {
        fold_json: decoded.fold_json,
        report: decoded.report,
        runtime: NativeRuntimeInfo {
            active_execution_provider: live.provider,
            session_create_ms: live.session_create_ms,
            preprocess_ms,
            model_run_ms,
            output_collect_ms,
            total_inference_ms,
            decode_ms,
            model_id: live.model_id.clone(),
        },
    })
}

/// Recognize a rectified image: raw RGBA in the body, `x-width`, `x-height`
/// and `x-options` (JSON, [`RecognizeOptions`]) in the headers.
#[tauri::command]
pub async fn cp_detect_recognize(
    app: AppHandle,
    state: State<'_, DetectStateHandle>,
    request: Request<'_>,
) -> Result<RecognizeResponse, EngineError> {
    let width: u32 = header(&request, "x-width")?
        .parse()
        .map_err(|_| error("bad_header", "x-width is not a number"))?;
    let height: u32 = header(&request, "x-height")?
        .parse()
        .map_err(|_| error("bad_header", "x-height is not a number"))?;
    let options: RecognizeOptions = serde_json::from_str(header(&request, "x-options")?)
        .map_err(|e| error("bad_options", e.to_string()))?;
    let rgba = raw_body(&request)?.to_vec();
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        recognize(&state, &app, &rgba, width, height, &options)
    })
    .await
    .map_err(|_| error("engine_task", "recognition task did not complete"))?
}

// ---------------------------------------------------------------------------
// The exact solve, with a Stop
// ---------------------------------------------------------------------------

/// Tauri renames only a command's own arguments to snake_case; a struct
/// argument keeps the page's spelling, so this one declares it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveArgs {
    pub input_json: String,
    #[serde(default)]
    pub options_json: String,
    pub run_id: u32,
}

const SOLVE_EXACT_FOLD_SCHEMA: &str = "oristudio/cp-detect/solve-exact-fold-v1";
const EXACT_SOLVE_INPUT_FROM_FOLD_SCHEMA: &str =
    "oristudio/cp-detect/exact-solve-input-from-fold-v1";

fn parse_request(
    args: &SolveArgs,
) -> Result<(ExactSolveInput, ExactSolveOptionsWithExemptions), EngineError> {
    parse_exact_solve_request(&args.input_json, &args.options_json).map_err(|message| {
        let code = if message.starts_with("exempt_vertex_ids names") {
            "unknown_exempt_vertex_id"
        } else {
            "invalid_exact_solve_options"
        };
        error(code, message)
    })
}

/// Run `solve` under a Stop registered for `run_id`. A solve that was stopped
/// comes back `Failed` with `cancelled: true` in its movement report, which is
/// how the page tells a Stop from a rejection.
async fn solve_under_stop<T: Send + 'static>(
    state: State<'_, DetectStateHandle>,
    run_id: u32,
    solve: impl FnOnce(&Arc<AtomicBool>) -> T + Send + 'static,
) -> Result<T, EngineError> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut cancels) = state.cancels.lock() {
        cancels.insert(run_id, Arc::clone(&flag));
    }
    let shared = Arc::clone(state.inner());
    let worker_flag = Arc::clone(&flag);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        with_cancellation(Arc::clone(&worker_flag), || solve(&worker_flag))
    })
    .await
    .map_err(|_| error("engine_task", "solve task did not complete"));
    if let Ok(mut cancels) = shared.cancels.lock() {
        cancels.remove(&run_id);
    }
    outcome
}

fn mark_cancelled(solved: &mut oristudio_cp_compiler::ExactSolvedGraph, flag: &AtomicBool) {
    if flag.load(Ordering::Relaxed) {
        solved.status = ExactSolvedGraphStatus::Failed;
        if let serde_json::Value::Object(map) = &mut solved.movement_report {
            map.insert("cancelled".to_owned(), serde_json::Value::Bool(true));
        }
    }
}

#[tauri::command]
pub async fn cp_detect_solve_exact(
    state: State<'_, DetectStateHandle>,
    args: SolveArgs,
) -> Result<serde_json::Value, EngineError> {
    let (input, options) = parse_request(&args)?;
    solve_under_stop(state, args.run_id, move |flag| {
        let mut solved = oristudio_cp_compiler::solve_exact_with_exemptions(&input, &options);
        mark_cancelled(&mut solved, flag);
        serde_json::to_value(&solved).map_err(|e| error("json", e.to_string()))
    })
    .await?
}

#[tauri::command]
pub async fn cp_detect_solve_exact_to_fold(
    state: State<'_, DetectStateHandle>,
    args: SolveArgs,
) -> Result<serde_json::Value, EngineError> {
    let (input, options) = parse_request(&args)?;
    solve_under_stop(state, args.run_id, move |flag| {
        let mut solved = oristudio_cp_compiler::solve_exact_with_exemptions(&input, &options);
        mark_cancelled(&mut solved, flag);
        let document = oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document(
            &input, &solved,
        )
        .map_err(|e| error("exact_export", e.to_string()))?;
        Ok(serde_json::json!({
            "schema": SOLVE_EXACT_FOLD_SCHEMA,
            "solved": serde_json::to_value(&solved).map_err(|e| error("json", e.to_string()))?,
            "fold": serde_json::to_value(&document).map_err(|e| error("json", e.to_string()))?,
        }))
    })
    .await?
}

#[tauri::command]
pub fn cp_detect_solve_cancel(state: State<'_, DetectStateHandle>, run_id: u32) -> bool {
    state
        .cancels
        .lock()
        .ok()
        .and_then(|cancels| {
            cancels
                .get(&run_id)
                .map(|flag| flag.store(true, Ordering::Relaxed))
        })
        .is_some()
}

#[tauri::command]
pub fn cp_detect_exact_solve_input_from_fold(
    fold_json: String,
) -> Result<serde_json::Value, EngineError> {
    let fold: treemaker_fold::FoldDocument =
        serde_json::from_str(&fold_json).map_err(|e| error("invalid_fold", e.to_string()))?;
    let (input, transform) = oristudio_cp_compiler::exact_solve_input_from_fold(&fold)
        .map_err(|reason| error("unsupported_pattern", reason))?;
    Ok(serde_json::json!({
        "schema": EXACT_SOLVE_INPUT_FROM_FOLD_SCHEMA,
        "input": serde_json::to_value(&input).map_err(|e| error("json", e.to_string()))?,
        "transform": serde_json::to_value(transform).map_err(|e| error("json", e.to_string()))?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_ids_are_file_names_and_nothing_else() {
        assert!(checked_id("runpod-v5-bp_search225.step12000").is_ok());
        assert!(checked_id("../escape").is_err());
        assert!(checked_id(".hidden").is_err());
        assert!(checked_id("").is_err());
        assert!(checked_id("with/slash").is_err());
    }

    #[test]
    fn preprocess_is_planar_rgb_in_unit_range() {
        let rgba = [
            255u8, 0, 128, 255, 0, 255, 64, 255, 10, 20, 30, 255, 40, 50, 60, 255,
        ];
        let tensor = preprocess(&rgba, 2);
        assert_eq!(tensor.len(), 12);
        assert!((tensor[0] - 1.0).abs() < 1e-6);
        assert!((tensor[5] - 1.0).abs() < 1e-6, "green plane, second pixel");
        assert!(
            (tensor[8] - 128.0 / 255.0).abs() < 1e-6,
            "blue plane of the first pixel"
        );
    }

    #[test]
    fn civil_dates_come_out_right() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_698), (2026, 9, 2));
    }
}
