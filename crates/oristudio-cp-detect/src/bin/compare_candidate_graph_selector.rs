use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use oristudio_cp_compiler::selection::{SelectionOptions, select_candidate_graph_beam_from_ir};
use oristudio_cp_compiler::{CandidateProgram, LegacyCandidateAdapter};
use oristudio_cp_detect::decode::{DecodeConfig, DenseOutputs, decode_dense_outputs};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct DenseCacheManifest {
    pack: Option<String>,
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

#[derive(Debug)]
struct Args {
    manifest: PathBuf,
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
struct SelectorComparisonReport {
    schema: &'static str,
    generated_by: &'static str,
    manifest: String,
    pack: Option<String>,
    sample_count: usize,
    total_seconds: f64,
    aggregate: SelectorComparisonAggregate,
    samples: Vec<SelectorComparisonSample>,
}

#[derive(Debug, Default, Serialize)]
struct SelectorComparisonAggregate {
    legacy_edges: usize,
    legacy_candidate_spans: usize,
    selected_spans: usize,
    selected_atomic_provenance: usize,
    dropped_legacy_spans: usize,
    weak_candidate_spans: usize,
    conflicts: usize,
}

#[derive(Debug, Serialize)]
struct SelectorComparisonSample {
    id: String,
    profile: Option<String>,
    legacy_edges: usize,
    legacy_candidate_spans: usize,
    selected_spans: usize,
    selected_atomic_provenance: usize,
    dropped_legacy_spans: usize,
    weak_candidate_spans: usize,
    conflicts: usize,
    seconds: f64,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let manifest_path = args.manifest.canonicalize()?;
    let manifest_root = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let manifest: DenseCacheManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let started = Instant::now();
    let mut samples = Vec::new();
    let mut aggregate = SelectorComparisonAggregate::default();

    for sample in manifest
        .samples
        .iter()
        .take(args.limit.unwrap_or(usize::MAX))
    {
        let sample_started = Instant::now();
        let line_logits =
            read_f32_file(&resolve_path(manifest_root, &sample.line_logits_f32_path))?;
        let junction_logits = read_f32_file(&resolve_path(
            manifest_root,
            &sample.junction_logits_f32_path,
        ))?;
        let assignment_logits = read_f32_file(&resolve_path(
            manifest_root,
            &sample.assignment_logits_f32_path,
        ))?;
        let non_crease_logits = read_f32_file(&resolve_path(
            manifest_root,
            &sample.non_crease_logits_f32_path,
        ))?;
        let line_style_logits = read_f32_file(&resolve_path(
            manifest_root,
            &sample.line_style_logits_f32_path,
        ))?;
        let boundary_contact_logits = read_f32_file(&resolve_path(
            manifest_root,
            &sample.boundary_contact_logits_f32_path,
        ))?;

        let legacy = decode_dense_outputs(
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
        )?;
        let fold: serde_json::Value = serde_json::from_str(&legacy.fold_json)?;
        let program = CandidateProgram::from_fold_value(&fold)?;
        let graph = LegacyCandidateAdapter::from_program(&program);
        let selection = select_candidate_graph_beam_from_ir(
            &graph,
            SelectionOptions::default(),
            Default::default(),
        );
        let selected_span_ids = selection
            .selected_spans
            .iter()
            .map(|span| span.id)
            .collect::<std::collections::BTreeSet<_>>();
        let legacy_candidate_ids = graph
            .crease_candidates
            .iter()
            .filter(|span| {
                span.source_kind == oristudio_cp_compiler::CandidateCreaseSourceKind::LegacySelected
                    || span.source_kind
                        == oristudio_cp_compiler::CandidateCreaseSourceKind::BorderGenerated
            })
            .map(|span| span.id)
            .collect::<Vec<_>>();
        let dropped_legacy_spans = legacy_candidate_ids
            .iter()
            .filter(|id| !selected_span_ids.contains(id))
            .count();
        let weak_candidate_spans = graph.report.legacy_low_threshold_spans;
        let row = SelectorComparisonSample {
            id: sample.id.clone(),
            profile: sample.profile.clone(),
            legacy_edges: program.edges.len(),
            legacy_candidate_spans: graph.report.crease_candidates,
            selected_spans: selection.report.selected_spans,
            selected_atomic_provenance: selection.selected_edge_ids.len(),
            dropped_legacy_spans,
            weak_candidate_spans,
            conflicts: graph.report.conflicts,
            seconds: sample_started.elapsed().as_secs_f64(),
        };
        aggregate.legacy_edges += row.legacy_edges;
        aggregate.legacy_candidate_spans += row.legacy_candidate_spans;
        aggregate.selected_spans += row.selected_spans;
        aggregate.selected_atomic_provenance += row.selected_atomic_provenance;
        aggregate.dropped_legacy_spans += row.dropped_legacy_spans;
        aggregate.weak_candidate_spans += row.weak_candidate_spans;
        aggregate.conflicts += row.conflicts;
        samples.push(row);
    }

    let report = SelectorComparisonReport {
        schema: "oristudio/cp-detect-candidate-graph-selector-comparison/v1",
        generated_by: "compare_candidate_graph_selector",
        manifest: manifest_path.display().to_string(),
        pack: manifest.pack,
        sample_count: samples.len(),
        total_seconds: started.elapsed().as_secs_f64(),
        aggregate,
        samples,
    };
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut manifest = None;
        let mut limit = None;
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--manifest" => {
                    manifest = Some(PathBuf::from(required_value(&mut iter, "--manifest")?))
                }
                "--limit" => limit = Some(required_value(&mut iter, "--limit")?.parse()?),
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}").into()),
            }
        }
        Ok(Self {
            manifest: manifest.ok_or("--manifest is required")?,
            limit,
        })
    }
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

fn required_value(
    iter: &mut impl Iterator<Item = String>,
    name: &'static str,
) -> Result<String, Box<dyn std::error::Error>> {
    iter.next()
        .ok_or_else(|| format!("{name} requires a value").into())
}

fn print_usage() {
    println!("compare_candidate_graph_selector --manifest PATH [--limit N]");
}
