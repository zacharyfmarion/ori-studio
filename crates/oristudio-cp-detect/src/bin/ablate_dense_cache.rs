use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use oristudio_cp_detect::decode::{
    CompilerAblationOptions, DecodeConfig, DenseOutputs, ablate_dense_outputs_with_options,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct DenseCacheManifest {
    pack: String,
    #[serde(default)]
    manifest_url: Option<String>,
    #[serde(default)]
    model_url: Option<String>,
    samples: Vec<DenseCacheSample>,
}

#[derive(Debug, Deserialize)]
struct DenseCacheSample {
    id: String,
    #[serde(default)]
    profile: Option<String>,
    image_size: u32,
    threshold: f32,
    line_logits_f32_path: String,
    junction_logits_f32_path: String,
    assignment_logits_f32_path: String,
    non_crease_logits_f32_path: String,
    line_style_logits_f32_path: String,
    boundary_contact_logits_f32_path: String,
}

#[derive(Debug, Serialize)]
struct StageRunManifest {
    schema: &'static str,
    implementation: String,
    generated_by: &'static str,
    generated_at: String,
    pack: String,
    dense_cache: String,
    manifest_url: Option<String>,
    model_url: Option<String>,
    decoder_backend: &'static str,
    ablation_stage: String,
    sample_count: usize,
    ok_count: usize,
    total_seconds: f64,
    samples_per_second: f64,
    samples: Vec<RunSample>,
    browser_errors: Vec<String>,
}

#[derive(Debug, Serialize)]
struct RunSample {
    id: String,
    ok: bool,
    fold: String,
    report: String,
    status: String,
    vertices: usize,
    edges: usize,
    border_edges: usize,
}

#[derive(Debug, Serialize)]
struct AblationRunManifest {
    schema: &'static str,
    generated_by: &'static str,
    generated_at: String,
    pack: String,
    dense_cache: String,
    sample_count: usize,
    total_seconds: f64,
    samples_per_second: f64,
    stages: Vec<AblationStageRef>,
}

#[derive(Debug, Serialize)]
struct AblationStageRef {
    id: String,
    run_manifest: String,
    total_seconds: f64,
    samples_per_second: f64,
}

#[derive(Debug, Clone)]
struct StageTiming {
    total_seconds: f64,
    samples: usize,
}

#[derive(Debug)]
struct Args {
    cache: PathBuf,
    out: PathBuf,
    limit: Option<usize>,
    skip_topology: bool,
    skip_assignments: bool,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let started_at = Instant::now();
    let cache_path = args.cache.canonicalize()?;
    let cache_root = cache_path.parent().unwrap_or_else(|| Path::new("."));
    let cache: DenseCacheManifest = serde_json::from_str(&fs::read_to_string(&cache_path)?)?;
    fs::create_dir_all(&args.out)?;

    let mut stage_rows = BTreeMap::<String, Vec<RunSample>>::new();
    let mut stage_timings = BTreeMap::<String, StageTiming>::new();
    let mut stage_order = Vec::<String>::new();
    let mut sample_count = 0usize;

    for sample in cache.samples.iter().take(args.limit.unwrap_or(usize::MAX)) {
        let sample_started_at = Instant::now();
        let line_logits = read_f32_file(&resolve_path(cache_root, &sample.line_logits_f32_path))?;
        let junction_logits =
            read_f32_file(&resolve_path(cache_root, &sample.junction_logits_f32_path))?;
        let assignment_logits = read_f32_file(&resolve_path(
            cache_root,
            &sample.assignment_logits_f32_path,
        ))?;
        let non_crease_logits = read_f32_file(&resolve_path(
            cache_root,
            &sample.non_crease_logits_f32_path,
        ))?;
        let line_style_logits = read_f32_file(&resolve_path(
            cache_root,
            &sample.line_style_logits_f32_path,
        ))?;
        let boundary_contact_logits = read_f32_file(&resolve_path(
            cache_root,
            &sample.boundary_contact_logits_f32_path,
        ))?;

        let result = ablate_dense_outputs_with_options(
            DenseOutputs {
                line_logits: &line_logits,
                junction_logits: &junction_logits,
                assignment_logits: &assignment_logits,
                non_crease_logits: &non_crease_logits,
                line_style_logits: &line_style_logits,
                boundary_contact_logits: &boundary_contact_logits,
            },
            DecodeConfig {
                image_size: sample.image_size,
                threshold: sample.threshold,
                ..DecodeConfig::default()
            },
            CompilerAblationOptions {
                include_topology: !args.skip_topology,
                include_assignments: !args.skip_assignments,
            },
        )?;
        sample_count += 1;

        for stage in result.stages {
            if !stage_rows.contains_key(stage.id) {
                stage_order.push(stage.id.to_owned());
                stage_rows.insert(stage.id.to_owned(), Vec::new());
                fs::create_dir_all(args.out.join("stages").join(stage.id).join("predictions"))?;
                fs::create_dir_all(args.out.join("stages").join(stage.id).join("reports"))?;
            }
            let stage_dir = args.out.join("stages").join(stage.id);
            let fold_rel = format!("predictions/{}.fold", sample.id);
            let report_rel = format!("reports/{}.json", sample.id);
            fs::write(stage_dir.join(&fold_rel), normalize_json(&stage.fold_json)?)?;
            let mut report = serde_json::to_value(&stage.report)?;
            if let Some(object) = report.as_object_mut() {
                object.insert(
                    "schema".to_owned(),
                    Value::String("oristudio/cp-detect-correctness-sample-report/v1".to_owned()),
                );
                object.insert("sample_id".to_owned(), Value::String(sample.id.clone()));
                object.insert(
                    "ablation_stage".to_owned(),
                    Value::String(stage.id.to_owned()),
                );
                if let Some(profile) = &sample.profile {
                    object.insert("profile".to_owned(), Value::String(profile.clone()));
                }
            }
            fs::write(
                stage_dir.join(&report_rel),
                serde_json::to_string_pretty(&report)? + "\n",
            )?;
            let row = RunSample {
                id: sample.id.clone(),
                ok: true,
                fold: fold_rel,
                report: report_rel,
                status: stage.report.status.clone(),
                vertices: stage.report.vertex_count,
                edges: stage.report.edge_count,
                border_edges: stage.report.border_edge_count,
            };
            stage_rows.get_mut(stage.id).expect("stage rows").push(row);
        }
        let seconds = sample_started_at.elapsed().as_secs_f64();
        println!(
            "{}",
            serde_json::json!({
                "id": sample.id,
                "ok": true,
                "seconds": round_seconds(seconds),
            })
        );
    }

    let total_seconds = started_at.elapsed().as_secs_f64();
    let mut stage_refs = Vec::new();
    for stage_id in stage_order {
        let rows = stage_rows.remove(&stage_id).unwrap_or_default();
        let timing = stage_timings.remove(&stage_id).unwrap_or(StageTiming {
            total_seconds,
            samples: rows.len(),
        });
        let run_manifest = StageRunManifest {
            schema: "oristudio/cp-detect-correctness-run/v1",
            implementation: format!("native-rust-ablation-{stage_id}"),
            generated_by: "crates/oristudio-cp-detect/src/bin/ablate_dense_cache.rs",
            generated_at: now_timestamp(),
            pack: cache.pack.clone(),
            dense_cache: cache_path.display().to_string(),
            manifest_url: cache.manifest_url.clone(),
            model_url: cache.model_url.clone(),
            decoder_backend: "compiler-ablation-native",
            ablation_stage: stage_id.clone(),
            sample_count: rows.len(),
            ok_count: rows.iter().filter(|row| row.ok).count(),
            total_seconds: round_seconds(timing.total_seconds),
            samples_per_second: samples_per_second(timing.samples, timing.total_seconds),
            samples: rows,
            browser_errors: Vec::new(),
        };
        let stage_manifest_path = args
            .out
            .join("stages")
            .join(&stage_id)
            .join("run_manifest.json");
        fs::write(
            &stage_manifest_path,
            serde_json::to_string_pretty(&run_manifest)? + "\n",
        )?;
        stage_refs.push(AblationStageRef {
            id: stage_id.clone(),
            run_manifest: format!("stages/{stage_id}/run_manifest.json"),
            total_seconds: round_seconds(timing.total_seconds),
            samples_per_second: samples_per_second(timing.samples, timing.total_seconds),
        });
    }

    let manifest = AblationRunManifest {
        schema: "oristudio/cp-detect-native-ablation-run/v1",
        generated_by: "crates/oristudio-cp-detect/src/bin/ablate_dense_cache.rs",
        generated_at: now_timestamp(),
        pack: cache.pack,
        dense_cache: cache_path.display().to_string(),
        sample_count,
        total_seconds: round_seconds(total_seconds),
        samples_per_second: samples_per_second(sample_count, total_seconds),
        stages: stage_refs,
    };
    fs::write(
        args.out.join("ablation_manifest.json"),
        serde_json::to_string_pretty(&manifest)? + "\n",
    )?;
    println!("{}", serde_json::to_string_pretty(&manifest)?);
    Ok(())
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut cache = None;
        let mut out = None;
        let mut limit = None;
        let mut skip_topology = false;
        let mut skip_assignments = false;
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--cache" => cache = Some(PathBuf::from(required_value(&mut iter, "--cache")?)),
                "--out" => out = Some(PathBuf::from(required_value(&mut iter, "--out")?)),
                "--limit" => limit = Some(required_value(&mut iter, "--limit")?.parse()?),
                "--skip-topology" => {
                    skip_topology = true;
                    skip_assignments = true;
                }
                "--skip-assignments" => skip_assignments = true,
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}").into()),
            }
        }
        Ok(Self {
            cache: cache.ok_or("--cache is required")?,
            out: out.ok_or("--out is required")?,
            limit,
            skip_topology,
            skip_assignments,
        })
    }
}

fn required_value(
    iter: &mut impl Iterator<Item = String>,
    name: &'static str,
) -> Result<String, Box<dyn std::error::Error>> {
    iter.next()
        .ok_or_else(|| format!("{name} requires a value").into())
}

fn read_f32_file(path: &Path) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    if bytes.len() % 4 != 0 {
        return Err(format!("{} length is not divisible by 4", path.display()).into());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn resolve_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn normalize_json(json: &str) -> Result<String, serde_json::Error> {
    let value = serde_json::from_str::<Value>(json)?;
    Ok(serde_json::to_string_pretty(&value)? + "\n")
}

fn now_timestamp() -> String {
    // Keep this dependency-free; downstream tools only require a stable string.
    format!("{:?}", std::time::SystemTime::now())
}

fn round_seconds(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn samples_per_second(samples: usize, seconds: f64) -> f64 {
    if seconds <= 0.0 {
        0.0
    } else {
        round_seconds(samples as f64 / seconds)
    }
}

fn print_usage() {
    println!(
        "ablate_dense_cache --cache PATH --out DIR [--limit N] [--skip-topology] [--skip-assignments]"
    );
}
