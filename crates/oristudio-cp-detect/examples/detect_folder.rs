//! Detect and solve every PNG under the given paths with the product's own
//! pipeline, natively: `auto_rectify_rgba`, ONNX Runtime (CoreML on macOS, all
//! cores elsewhere), then the fused decode + exact-solve backend the dialog
//! runs. Inference stays on one thread with one session; decode and solve run
//! on worker threads behind a bounded channel, since a hard solve is the long
//! pole and the model is not.
//!
//! Per image, `<out>/<stem>.json` (rectification, the decode report, timings),
//! `<out>/<stem>.fold.json` (the solved FOLD as the dialog would add it) and
//! `<out>/<stem>.thumb.png` (the rectified image, small). A failure is a
//! `.json` with an `error`, never a stop.
//!
//!   cargo run --release -p oristudio-cp-detect --features native-inference \
//!     --example detect_folder -- --model <model.onnx> --out <dir> \
//!     [--budget 20] [--workers 4] [--limit N] <dir-or-png>...
use oristudio_cp_detect::decode::{self, DecodeConfig, DecoderBackend, DenseOutputs};
use oristudio_cp_detect::evidence_extract::JunctionEvidenceSource;
use oristudio_cp_detect::rectify::auto_rectify_rgba;
use oristudio_cp_detect::source_image_evidence::{
    SourceImageLineEvidenceOptions, line_probability_from_rgba,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Instant;

const IMAGE_SIZE: u32 = 1024;
const THRESHOLD: f32 = 0.65;
const JUNCTION_OFFSET_RADIUS_PX: f32 = 3.0;
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

struct Args {
    model: PathBuf,
    out: PathBuf,
    budget: f64,
    workers: usize,
    limit: Option<usize>,
    /// A recognized graph with more edges than this is not solved: the fused
    /// backend's compiler stage has no budget of its own and spends minutes on
    /// a thousand-edge pattern, which the solve budget cannot bound.
    max_edges: usize,
    inputs: Vec<PathBuf>,
}

fn parse_args() -> Args {
    let mut args = Args {
        model: PathBuf::new(),
        out: PathBuf::new(),
        budget: 20.0,
        workers: 4,
        limit: None,
        max_edges: 1500,
        inputs: Vec::new(),
    };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--model" => args.model = it.next().expect("--model <path>").into(),
            "--out" => args.out = it.next().expect("--out <dir>").into(),
            "--budget" => args.budget = it.next().expect("--budget <s>").parse().expect("budget"),
            "--workers" => {
                args.workers = it.next().expect("--workers <n>").parse().expect("workers")
            }
            "--limit" => args.limit = Some(it.next().expect("--limit <n>").parse().expect("limit")),
            "--max-edges" => {
                args.max_edges = it
                    .next()
                    .expect("--max-edges <n>")
                    .parse()
                    .expect("max-edges")
            }
            other => args.inputs.push(other.into()),
        }
    }
    assert!(args.model.is_file(), "--model must name an .onnx file");
    assert!(
        !args.inputs.is_empty(),
        "give at least one directory or .png"
    );
    args
}

fn collect_pngs(paths: &[PathBuf]) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        entries.sort();
        for path in entries {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                walk(&path, out);
            } else if path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("png"))
            {
                out.push(path);
            }
        }
    }
    let mut out = Vec::new();
    for p in paths {
        if p.is_dir() {
            walk(p, &mut out)
        } else {
            out.push(p.clone())
        }
    }
    out
}

/// Mirrors the desktop shell's `build_session`: CoreML with a model cache on
/// macOS, every core on the CPU otherwise. The builder's error type carries
/// the builder, so each variant is its own function and `?` does the conversion.
fn build_session(model: &Path, cache_dir: &Path) -> (&'static str, ort::session::Session) {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    #[cfg(target_os = "macos")]
    {
        use ort::ep::ExecutionProvider;
        if ort::ep::CoreML::default().is_available().unwrap_or(false) {
            let _ = std::fs::create_dir_all(cache_dir);
            match coreml_session(model, cache_dir) {
                Ok(session) => return ("coreml", session),
                Err(reason) => eprintln!("[detect_folder] CoreML refused, using the CPU: {reason}"),
            }
        }
    }
    let _ = cache_dir;
    ("cpu", cpu_session(model, cores).expect("CPU session"))
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

/// What inference hands a worker: the rectified image and the model's heads,
/// owned, so the worker can borrow them into a `DenseOutputs` of its own.
struct Job {
    source: PathBuf,
    stem: String,
    width: u32,
    height: u32,
    rect_report: serde_json::Value,
    rgba: Vec<u8>,
    heads: HashMap<&'static str, Vec<f32>>,
    inference_ms: f64,
    provider: &'static str,
}

fn write_json(path: &Path, value: &serde_json::Value) {
    if let Ok(text) = serde_json::to_string_pretty(value) {
        let _ = std::fs::write(path, text);
    }
}

fn thumbnail(rgba: &[u8], size: u32, out: &Path) {
    let Some(img) = image::RgbaImage::from_raw(size, size, rgba.to_vec()) else {
        return;
    };
    let small = image::imageops::resize(&img, 320, 320, image::imageops::FilterType::Triangle);
    let _ = small.save(out);
}

fn worker(rx: Arc<Mutex<mpsc::Receiver<Job>>>, out: PathBuf, budget: f64, max_edges: usize) {
    loop {
        let job = match rx.lock().expect("receiver").recv() {
            Ok(job) => job,
            Err(_) => return,
        };
        let started = Instant::now();
        let json_path = out.join(format!("{}.json", job.stem));
        thumbnail(
            &job.rgba,
            IMAGE_SIZE,
            &out.join(format!("{}.thumb.png", job.stem)),
        );

        let required = |name: &'static str| -> Result<&[f32], String> {
            job.heads
                .get(name)
                .map(Vec::as_slice)
                .ok_or_else(|| format!("model has no {name} output"))
        };
        // Decode twice on purpose: recognize-only first, which stops before the
        // compiler and the solve, so a pattern too large to solve in a batch is
        // recorded as such in under a second instead of after minutes.
        let decode_with = |recognize_only: bool| -> Result<decode::DecodedFold, String> {
            let line_probability = line_probability_from_rgba(
                &job.rgba,
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
            .with_angle(job.heads.get("angle").map(Vec::as_slice))
            .with_junction_offset(job.heads.get("junction_offset").map(Vec::as_slice))
            .with_vertex_type_logits(job.heads.get("vertex_type_logits").map(Vec::as_slice))
            .with_boundary_side_logits(job.heads.get("boundary_side_logits").map(Vec::as_slice))
            .with_boundary_offset(job.heads.get("boundary_offset").map(Vec::as_slice))
            .with_boundary_coord(job.heads.get("boundary_coord").map(Vec::as_slice))
            .with_line_probability_override(Some(&line_probability));
            decode::decode_dense_outputs_with_backend_junction_source_and_refined_vertices_in_regions(
                dense,
                DecodeConfig {
                    image_size: IMAGE_SIZE,
                    threshold: THRESHOLD,
                    junction_offset_cluster_radius_px: JUNCTION_OFFSET_RADIUS_PX,
                    exact_solve_timeout_seconds: budget,
                    recognize_only,
                    ..DecodeConfig::default()
                },
                DecoderBackend::LegacyCandidateExactSolveV1,
                JunctionEvidenceSource::Model,
                None,
                None,
            )
            .map_err(|e| e.to_string())
        };
        let decoded = decode_with(true).and_then(|probe| {
            let edges = serde_json::to_value(&probe.report)
                .ok()
                .and_then(|r| r.get("edge_count").and_then(|v| v.as_u64()))
                .unwrap_or(0) as usize;
            if edges > max_edges {
                Err(format!("too_large: {edges} edges recognized, over --max-edges {max_edges}; solve skipped"))
            } else {
                decode_with(false)
            }
        });
        let decode_ms = started.elapsed().as_secs_f64() * 1000.0;

        match decoded {
            Ok(decoded) => {
                let _ = std::fs::write(
                    out.join(format!("{}.fold.json", job.stem)),
                    &decoded.fold_json,
                );
                let report =
                    serde_json::to_value(&decoded.report).unwrap_or(serde_json::Value::Null);
                let exact = report
                    .pointer("/quality_report/compiler_report/exact_solve")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let summary = serde_json::json!({
                    "source": job.source, "stem": job.stem,
                    "original": {"width": job.width, "height": job.height},
                    "rectification": job.rect_report,
                    "provider": job.provider,
                    "inference_ms": job.inference_ms, "decode_solve_ms": decode_ms,
                    "vertex_count": report.get("vertex_count"), "edge_count": report.get("edge_count"),
                    "status": report.get("status"),
                    "exact_solve": {
                        "status": exact.get("status"),
                        "accepted": exact.pointer("/movement_report/accepted"),
                        "rejection_reasons": exact.pointer("/movement_report/rejection_reasons"),
                        "timed_out": exact.pointer("/movement_report/timed_out"),
                        "kawasaki_after": exact.pointer("/theorem_residual_report/after/max_kawasaki_residual_degrees"),
                        "camv_after": exact.pointer("/theorem_residual_report/after/camv_angle_violations"),
                        "blb_after": exact.pointer("/theorem_residual_report/after/big_little_big_violations"),
                        "polish": exact.pointer("/movement_report/polish/stop_reason"),
                        "pinned_family": exact.pointer("/movement_report/polish/pinned_family/adopted"),
                        "pinned_step": exact.pointer("/movement_report/polish/pinned_family/step_degrees"),
                    },
                    "warnings": report.get("warnings"),
                });
                write_json(&json_path, &summary);
                eprintln!(
                    "[ok] {} v={} e={} solve={} {:.1}s",
                    job.stem,
                    report
                        .get("vertex_count")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    report
                        .get("edge_count")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    exact.get("status").and_then(|v| v.as_str()).unwrap_or("-"),
                    decode_ms / 1000.0
                );
            }
            Err(error) => {
                write_json(
                    &json_path,
                    &serde_json::json!({
                        "source": job.source, "stem": job.stem, "rectification": job.rect_report,
                        "error": error, "inference_ms": job.inference_ms,
                    }),
                );
                eprintln!("[fail] {}: {}", job.stem, error);
            }
        }
    }
}

fn main() {
    let args = parse_args();
    std::fs::create_dir_all(&args.out).expect("out dir");
    let mut images = collect_pngs(&args.inputs);
    if let Some(limit) = args.limit {
        images.truncate(limit);
    }
    eprintln!(
        "[detect_folder] {} images, budget {}s, {} workers",
        images.len(),
        args.budget,
        args.workers
    );

    let cache_dir = args.out.join(".coreml-cache");
    let started = Instant::now();
    let (provider, mut session) = build_session(&args.model, &cache_dir);
    eprintln!(
        "[detect_folder] session on {provider} in {:.1}s",
        started.elapsed().as_secs_f64()
    );
    let input_name = session
        .inputs()
        .first()
        .map(|o| o.name().to_owned())
        .expect("model input");

    let (tx, rx) = mpsc::sync_channel::<Job>(2);
    let rx = Arc::new(Mutex::new(rx));
    let workers: Vec<_> = (0..args.workers.max(1))
        .map(|_| {
            let rx = Arc::clone(&rx);
            let out = args.out.clone();
            let budget = args.budget;
            let max_edges = args.max_edges;
            std::thread::spawn(move || worker(rx, out, budget, max_edges))
        })
        .collect();

    let total = images.len();
    for (index, path) in images.into_iter().enumerate() {
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("image")
            .to_owned();
        let json_path = args.out.join(format!("{stem}.json"));
        if json_path.exists() {
            continue; // resumable
        }
        let started = Instant::now();
        let loaded = match image::open(&path) {
            Ok(img) => img.to_rgba8(),
            Err(e) => {
                write_json(
                    &json_path,
                    &serde_json::json!({"source": path, "stem": stem, "error": format!("load: {e}")}),
                );
                continue;
            }
        };
        let (width, height) = loaded.dimensions();
        let rectified = match auto_rectify_rgba(loaded.as_raw(), width, height, IMAGE_SIZE) {
            Ok(r) => r,
            Err(e) => {
                write_json(
                    &json_path,
                    &serde_json::json!({"source": path, "stem": stem, "error": format!("rectify: {e:?}")}),
                );
                continue;
            }
        };
        let rect_report = serde_json::json!({
            "mode": rectified.report.mode, "confidence": rectified.report.confidence,
            "panel_detected": rectified.report.detected_source_quad.is_some(),
            "warnings": rectified.report.warnings.iter().map(|w| w.code.clone()).collect::<Vec<_>>(),
        });
        let n = IMAGE_SIZE as usize;
        let input = preprocess(&rectified.rgba, n);
        let tensor =
            ort::value::Tensor::from_array(([1usize, 3, n, n], input)).expect("input tensor");
        let outputs = match session.run(ort::inputs![input_name.as_str() => tensor.view()]) {
            Ok(o) => o,
            Err(e) => {
                write_json(
                    &json_path,
                    &serde_json::json!({"source": path, "stem": stem, "rectification": rect_report, "error": format!("onnx: {e}")}),
                );
                continue;
            }
        };
        let mut heads: HashMap<&'static str, Vec<f32>> = HashMap::new();
        for name in OUTPUT_NAMES {
            if let Some(value) = outputs.get(name)
                && let Ok((_, data)) = value.try_extract_tensor::<f32>()
            {
                heads.insert(name, data.to_vec());
            }
        }
        drop(outputs);
        let inference_ms = started.elapsed().as_secs_f64() * 1000.0;
        eprintln!(
            "[infer {}/{}] {} {:.0}ms",
            index + 1,
            total,
            stem,
            inference_ms
        );
        let job = Job {
            source: path,
            stem,
            width,
            height,
            rect_report,
            rgba: rectified.rgba,
            heads,
            inference_ms,
            provider,
        };
        if tx.send(job).is_err() {
            break;
        }
    }
    drop(tx);
    for w in workers {
        let _ = w.join();
    }
    eprintln!(
        "[detect_folder] done in {:.0}s",
        started.elapsed().as_secs_f64()
    );
}
