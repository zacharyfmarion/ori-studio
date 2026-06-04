use std::env;
use std::fs;
use std::ops::AddAssign;
use std::path::{Path, PathBuf};
use std::time::Instant;

use oristudio_cp_compiler::selection::{SelectionOptions, select_candidate_graph_beam_from_ir};
use oristudio_cp_compiler::{
    CandidateCreaseSourceKind, CandidateGraph, CandidateProgram, LegacyCandidateAdapter,
    LegacyCandidateAdapterOptions, Point2,
};
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
    #[serde(default)]
    gt_fold: Option<String>,
    #[serde(default)]
    gt_graph: Option<String>,
}

#[derive(Debug)]
struct Args {
    manifest: PathBuf,
    limit: Option<usize>,
    legacy_low_threshold: Option<f32>,
    match_tolerance_px: f64,
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
    selected_weak_spans: usize,
    legacy_metrics: SegmentMetrics,
    selected_metrics: SegmentMetrics,
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
    selected_weak_spans: usize,
    legacy_metrics: SegmentMetrics,
    selected_metrics: SegmentMetrics,
    seconds: f64,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct SegmentMetrics {
    precision: f64,
    recall: f64,
    f1: f64,
    true_positive: usize,
    false_positive: usize,
    false_negative: usize,
}

impl SegmentMetrics {
    fn finalize(&mut self) {
        self.precision = ratio(self.true_positive, self.true_positive + self.false_positive);
        self.recall = ratio(self.true_positive, self.true_positive + self.false_negative);
        self.f1 = if self.precision + self.recall > 0.0 {
            2.0 * self.precision * self.recall / (self.precision + self.recall)
        } else {
            0.0
        };
    }
}

impl AddAssign for SegmentMetrics {
    fn add_assign(&mut self, rhs: Self) {
        self.true_positive += rhs.true_positive;
        self.false_positive += rhs.false_positive;
        self.false_negative += rhs.false_negative;
        self.precision = 0.0;
        self.recall = 0.0;
        self.f1 = 0.0;
    }
}

#[derive(Debug, Deserialize)]
struct GroundTruthGraph {
    vertices_px: Vec<[f64; 2]>,
    edges_vertices: Vec<[usize; 2]>,
}

#[derive(Debug, Clone, Copy)]
struct SegmentPx {
    a: [f64; 2],
    b: [f64; 2],
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
        let low_threshold = args
            .legacy_low_threshold
            .unwrap_or_else(|| default_low_threshold(sample.threshold));
        let weak_program = if low_threshold < sample.threshold {
            let weak = decode_dense_outputs(
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
                    threshold: low_threshold,
                    ..DecodeConfig::default()
                },
            )?;
            let weak_fold: serde_json::Value = serde_json::from_str(&weak.fold_json)?;
            Some(CandidateProgram::from_fold_value(&weak_fold)?)
        } else {
            None
        };
        let graph = LegacyCandidateAdapter::from_programs(
            &program,
            weak_program.as_ref(),
            legacy_adapter_options(sample.image_size),
        );
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
        let selected_weak_spans = selection
            .selected_spans
            .iter()
            .filter(|span| {
                graph
                    .crease_candidates
                    .get(span.id)
                    .is_some_and(|candidate| {
                        candidate.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold
                    })
            })
            .count();
        let (legacy_metrics, selected_metrics) = if let Some(gt_fold) = &sample.gt_fold {
            let gt_path = resolve_gt_path(manifest_root, manifest.pack.as_deref(), gt_fold);
            let gt_fold: serde_json::Value = serde_json::from_str(&fs::read_to_string(gt_path)?)?;
            let gt_program = CandidateProgram::from_fold_value(&gt_fold)?;
            let gt_segments = program_segments(&gt_program, sample.image_size);
            (
                segment_metrics(
                    &program_segments(&program, sample.image_size),
                    &gt_segments,
                    args.match_tolerance_px,
                ),
                segment_metrics(
                    &selected_segments(&graph, &selected_span_ids, sample.image_size),
                    &gt_segments,
                    args.match_tolerance_px,
                ),
            )
        } else if let Some(gt_graph) = &sample.gt_graph {
            let gt_path = resolve_gt_path(manifest_root, manifest.pack.as_deref(), gt_graph);
            let gt: GroundTruthGraph = serde_json::from_str(&fs::read_to_string(gt_path)?)?;
            let gt_segments = gt_segments(&gt);
            (
                segment_metrics(
                    &program_segments(&program, sample.image_size),
                    &gt_segments,
                    args.match_tolerance_px,
                ),
                segment_metrics(
                    &selected_segments(&graph, &selected_span_ids, sample.image_size),
                    &gt_segments,
                    args.match_tolerance_px,
                ),
            )
        } else {
            (SegmentMetrics::default(), SegmentMetrics::default())
        };
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
            selected_weak_spans,
            legacy_metrics,
            selected_metrics,
            seconds: sample_started.elapsed().as_secs_f64(),
        };
        aggregate.legacy_edges += row.legacy_edges;
        aggregate.legacy_candidate_spans += row.legacy_candidate_spans;
        aggregate.selected_spans += row.selected_spans;
        aggregate.selected_atomic_provenance += row.selected_atomic_provenance;
        aggregate.dropped_legacy_spans += row.dropped_legacy_spans;
        aggregate.weak_candidate_spans += row.weak_candidate_spans;
        aggregate.conflicts += row.conflicts;
        aggregate.selected_weak_spans += row.selected_weak_spans;
        aggregate.legacy_metrics += row.legacy_metrics;
        aggregate.selected_metrics += row.selected_metrics;
        samples.push(row);
    }
    aggregate.legacy_metrics.finalize();
    aggregate.selected_metrics.finalize();

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
        let mut legacy_low_threshold = None;
        let mut match_tolerance_px = 12.0;
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--manifest" => {
                    manifest = Some(PathBuf::from(required_value(&mut iter, "--manifest")?))
                }
                "--limit" => limit = Some(required_value(&mut iter, "--limit")?.parse()?),
                "--legacy-low-threshold" => {
                    legacy_low_threshold =
                        Some(required_value(&mut iter, "--legacy-low-threshold")?.parse()?);
                }
                "--match-tolerance-px" => {
                    match_tolerance_px =
                        required_value(&mut iter, "--match-tolerance-px")?.parse()?;
                }
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
            legacy_low_threshold,
            match_tolerance_px,
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

fn resolve_gt_path(manifest_root: &Path, pack: Option<&str>, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return path;
    }
    if let Some(pack) = pack {
        let pack_path = PathBuf::from(pack);
        let pack_root = pack_path.parent().unwrap_or_else(|| Path::new("."));
        return pack_root.join(path);
    }
    manifest_root.join(path)
}

fn default_low_threshold(threshold: f32) -> f32 {
    (threshold * 0.55).max(0.10).min(threshold)
}

fn legacy_adapter_options(image_size: u32) -> LegacyCandidateAdapterOptions {
    LegacyCandidateAdapterOptions {
        duplicate_endpoint_tolerance: (3.0 / image_size.max(1) as f64).max(1e-6),
        ..LegacyCandidateAdapterOptions::default()
    }
}

fn normalized_to_px(point: Point2, image_size: u32) -> [f64; 2] {
    let inset = 32.0;
    let span = image_size as f64 - inset * 2.0;
    [inset + point.x * span, inset + point.y * span]
}

fn program_segments(program: &CandidateProgram, image_size: u32) -> Vec<SegmentPx> {
    program
        .edges
        .iter()
        .filter_map(|edge| {
            let a = program.vertices.get(edge.vertices[0])?.position;
            let b = program.vertices.get(edge.vertices[1])?.position;
            Some(SegmentPx {
                a: normalized_to_px(a, image_size),
                b: normalized_to_px(b, image_size),
            })
        })
        .collect()
}

fn selected_segments(
    graph: &CandidateGraph,
    selected_span_ids: &std::collections::BTreeSet<usize>,
    image_size: u32,
) -> Vec<SegmentPx> {
    selected_span_ids
        .iter()
        .filter_map(|span_id| {
            let span = graph.crease_candidates.get(*span_id)?;
            let a = graph.vertices.get(span.vertices[0])?.point;
            let b = graph.vertices.get(span.vertices[1])?.point;
            Some(SegmentPx {
                a: normalized_to_px(a, image_size),
                b: normalized_to_px(b, image_size),
            })
        })
        .collect()
}

fn gt_segments(gt: &GroundTruthGraph) -> Vec<SegmentPx> {
    gt.edges_vertices
        .iter()
        .filter_map(|edge| {
            let a = *gt.vertices_px.get(edge[0])?;
            let b = *gt.vertices_px.get(edge[1])?;
            Some(SegmentPx { a, b })
        })
        .collect()
}

fn segment_metrics(
    predicted: &[SegmentPx],
    ground_truth: &[SegmentPx],
    tolerance_px: f64,
) -> SegmentMetrics {
    let mut matched_gt = vec![false; ground_truth.len()];
    let mut true_positive = 0;
    let mut false_positive = 0;
    for predicted in predicted {
        let mut best = None;
        let mut best_distance = f64::INFINITY;
        for (index, gt) in ground_truth.iter().enumerate() {
            if matched_gt[index] {
                continue;
            }
            let distance = segment_endpoint_distance(*predicted, *gt);
            if distance < best_distance {
                best_distance = distance;
                best = Some(index);
            }
        }
        if best_distance <= tolerance_px {
            if let Some(index) = best {
                matched_gt[index] = true;
                true_positive += 1;
            }
        } else {
            false_positive += 1;
        }
    }
    let false_negative = ground_truth.len().saturating_sub(true_positive);
    let mut metrics = SegmentMetrics {
        precision: 0.0,
        recall: 0.0,
        f1: 0.0,
        true_positive,
        false_positive,
        false_negative,
    };
    metrics.finalize();
    metrics
}

fn segment_endpoint_distance(left: SegmentPx, right: SegmentPx) -> f64 {
    let same = point_distance(left.a, right.a).max(point_distance(left.b, right.b));
    let flipped = point_distance(left.a, right.b).max(point_distance(left.b, right.a));
    same.min(flipped)
}

fn point_distance(left: [f64; 2], right: [f64; 2]) -> f64 {
    let dx = left[0] - right[0];
    let dy = left[1] - right[1];
    (dx * dx + dy * dy).sqrt()
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        numerator as f64 / denominator as f64
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
    println!(
        "compare_candidate_graph_selector --manifest PATH [--limit N] [--legacy-low-threshold T] [--match-tolerance-px PX]"
    );
}
