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
use oristudio_cp_detect::native_inference::{self, Heads, IMAGE_SIZE, NativeSession};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Instant;

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

/// What inference hands a worker: the rectified image and the model's heads,
/// owned, so the worker can borrow them into a `DenseOutputs` of its own.
struct Job {
    source: PathBuf,
    stem: String,
    width: u32,
    height: u32,
    rect_report: serde_json::Value,
    rgba: Vec<u8>,
    heads: Heads,
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

        let decoded = native_inference::decode_bounded(&job.rgba, &job.heads, budget, max_edges);
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
                    "compiler_seconds": report.pointer("/quality_report/compiler_report/timings/compiler_seconds"),
                    "exact_solve_seconds": report.pointer("/quality_report/compiler_report/timings/exact_solve_seconds"),
                    "evidence_extraction_seconds": report.pointer("/quality_report/compiler_report/timings/evidence_extraction_seconds"),
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
                        "pleats": exact.pointer("/movement_report/polish/pleat_runs/adopted"),
                        "pleat_runs": exact.pointer("/movement_report/polish/pleat_runs/runs").and_then(|runs| runs.as_array()).map(|runs| runs.len()),
                        "pleat_spread_before": exact.pointer("/movement_report/polish/pleat_runs/spread_before"),
                        "pleat_spread_after": exact.pointer("/movement_report/polish/pleat_runs/spread_after"),
                        "pleat_detail": exact.pointer("/movement_report/polish/pleat_runs"),
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
    let mut session =
        NativeSession::open(&args.model, &cache_dir).unwrap_or_else(|e| panic!("session: {e}"));
    let provider = session.provider;
    eprintln!(
        "[detect_folder] session on {provider} in {:.1}s",
        started.elapsed().as_secs_f64()
    );

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
        let rectified = match native_inference::rectify(loaded.as_raw(), width, height) {
            Ok(r) => r,
            Err(e) => {
                write_json(
                    &json_path,
                    &serde_json::json!({"source": path, "stem": stem, "error": e}),
                );
                continue;
            }
        };
        let rect_report = rectified.report.clone();
        let (heads, inference_ms) = match session.infer(&rectified.rgba) {
            Ok(v) => v,
            Err(e) => {
                write_json(
                    &json_path,
                    &serde_json::json!({"source": path, "stem": stem, "rectification": rect_report, "error": e}),
                );
                continue;
            }
        };
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
