use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::ops::AddAssign;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use oristudio_cp_compiler::candidate_graph::CandidateCreaseBoundaryRole;
use oristudio_cp_compiler::selection::{SelectionOptions, select_candidate_graph_beam_from_ir};
use oristudio_cp_compiler::verify::{GlobalVerificationOptions, verify_fold_json};
use oristudio_cp_compiler::{
    AssignmentLabel, CandidateGraph, CandidateProgram, ExactSolveInput, ExactSolveOptions,
    ExactSolvedGraph, ExactSolvedGraphStatus, LegacyCandidateAdapter,
    LegacyCandidateAdapterOptions, Point2, SelectedGraph, solve_exact,
};
use oristudio_cp_detect::candidate_generation::{
    CandidateGenerationContext, CandidateGenerationOptions, CandidateGenerationStrategyName,
    generate_candidate_graph, generate_junction_first_with_vertex_pixels,
};
use oristudio_cp_detect::decode::{DecodeConfig, DenseOutputs, decode_dense_outputs};
use oristudio_cp_detect::evidence_extract::JunctionEvidenceSource;
use oristudio_cp_detect::source_image_evidence::{
    SourceImageLineEvidenceOptions, line_probability_from_rgba,
};
use oristudio_cp_eval::{
    EvalAssignment, EvalBoundaryRole, EvalEdge, EvalGraph, EvalPoint, StrictTopologyAggregate,
    StrictTopologyMetrics, StrictTopologyOptions, strict_topology_metrics,
};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const SCHEMA: &str = "oristudio/cp-detect-exact-solve-comparison/v1";
/// Iteration-friendly exact-solve timeout for the benchmark binary. The product
/// path keeps `oristudio_cp_compiler::DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS`; here
/// we cap lower because a solve that has not converged in a few seconds on a
/// wrong topology essentially never flips to "solved", and the failed solves are
/// what dominated benchmark wall-clock.
const BENCHMARK_DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS: f64 = 3.0;
const DEFAULT_DENSE_MANIFEST: &str = "artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx-v3-tess15-weighted-probe-20260619/manifest.json";
const GT_JUNCTION_SIGMA_PX: f64 = 1.5;
const GT_JUNCTION_OFFSET_RADIUS_PX: f64 = 3.0;
const GT_BOUNDARY_CONTACT_SIGMA_PX: f64 = 1.0;
const GT_BACKGROUND_PROBABILITY: f32 = 0.0001;
const GT_PEAK_PROBABILITY: f32 = 0.9999;

#[derive(Debug, Deserialize)]
struct DenseCacheManifest {
    schema: Option<String>,
    pack: Option<String>,
    samples: Vec<DenseCacheSample>,
}

#[derive(Debug, Deserialize)]
struct DenseCacheSample {
    id: String,
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    profile: Option<String>,
    image_size: u32,
    threshold: f32,
    #[serde(default)]
    input_png: Option<String>,
    #[serde(default)]
    angle_f32_path: Option<String>,
    #[serde(default)]
    junction_offset_f32_path: Option<String>,
    #[serde(default)]
    vertex_type_logits_f32_path: Option<String>,
    #[serde(default)]
    boundary_side_logits_f32_path: Option<String>,
    #[serde(default)]
    boundary_offset_f32_path: Option<String>,
    #[serde(default)]
    boundary_coord_f32_path: Option<String>,
    line_logits_f32_path: String,
    junction_logits_f32_path: String,
    assignment_logits_f32_path: String,
    non_crease_logits_f32_path: String,
    line_style_logits_f32_path: String,
    boundary_contact_logits_f32_path: String,
    #[serde(default)]
    gt_graph: Option<String>,
}

#[derive(Debug)]
struct Args {
    dense_manifest: PathBuf,
    out: PathBuf,
    candidate_source: String,
    line_evidence_source: String,
    junction_evidence_source: JunctionEvidenceSource,
    gt_junction_labels: bool,
    gt_vertices: bool,
    threshold: Option<f32>,
    legacy_low_threshold: Option<f32>,
    exact_patience: Option<usize>,
    exact_solve_timeout_seconds: f64,
    limit: Option<usize>,
    match_tolerance_px: f64,
    strict_vertex_tolerance_px: f64,
    skip_flat_folder: bool,
    skip_exact_solve: bool,
    exact_solve_any_topology: bool,
    oracle_selection: bool,
    junction_first_merge_radius_px: Option<f64>,
    junction_first_corridor_px: Option<f64>,
    junction_first_endpoint_margin_px: Option<f64>,
    junction_first_min_span_px: Option<f64>,
    junction_first_offset_cluster_radius_px: Option<f64>,
    junction_first_short_span_bypass_px: Option<f64>,
    parity_repair: Option<bool>,
    dump_folds: bool,
}

#[derive(Debug, Serialize)]
struct BenchmarkSummary {
    schema: &'static str,
    generated_by: &'static str,
    generated_at_unix: u64,
    git_commit: Option<String>,
    dense_manifest: String,
    dense_schema: Option<String>,
    pack: Option<String>,
    config: BenchmarkConfig,
    sample_count: usize,
    total_seconds: f64,
    timing: BenchmarkTimingAggregate,
    implementations: BTreeMap<String, ImplementationAggregate>,
}

#[derive(Debug, Serialize)]
struct BenchmarkConfig {
    candidate_source: String,
    line_evidence_source: String,
    junction_evidence_source: String,
    gt_junction_labels: bool,
    threshold: Option<f32>,
    legacy_low_threshold: Option<f32>,
    exact_patience: Option<usize>,
    exact_solve_timeout_seconds: f64,
    match_tolerance_px: f64,
    strict_vertex_tolerance_px: f64,
    flat_folder_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
struct BenchmarkSample {
    id: String,
    source_id: Option<String>,
    family: Option<String>,
    profile: Option<String>,
    gt_edges: usize,
    legacy: OutputMetrics,
    selected: OutputMetrics,
    exact_solved: OutputMetrics,
    selection: SelectionSummary,
    exact_solve: ExactSolveSummary,
    attribution: FailureAttribution,
    timing: BenchmarkSampleTiming,
    seconds: f64,
}

/// Per-sample failure attribution against canonicalized GT. Splits the lost GT
/// creases into where they were lost in the pipeline so the aggregate ranks
/// levers (detector recall vs selection vs assignment), plus spurious output.
/// All counts are at the canonicalized strict-topology edge level.
#[derive(Debug, Clone, Copy, Serialize)]
struct FailureAttribution {
    gt_edges: usize,
    candidate_pool: usize,
    recovered: usize,
    /// GT creases with no candidate at all (candidate-generation / detector recall).
    detector_miss: usize,
    /// GT creases a candidate covered but beam selection dropped (selection scoring).
    selection_miss: usize,
    /// Selected edges matched to a GT crease but with the wrong M/V/B (assignment).
    assignment_wrong: usize,
    /// Selected edges with no GT match (spurious / hallucination).
    spurious: usize,
    /// Predicted vertices unmatched to any GT vertex (junction localization residue).
    unmatched_pred_vertices: usize,
    /// GT vertices unmatched by any prediction.
    unmatched_gt_vertices: usize,
    exact_topology: bool,
    exact_topology_and_assignment: bool,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct BenchmarkSampleTiming {
    read_logits_seconds: f64,
    legacy_decode_seconds: f64,
    weak_decode_seconds: f64,
    candidate_adapter_seconds: f64,
    selection_seconds: f64,
    exact_solve_seconds: f64,
    metrics_seconds: f64,
    total_seconds: f64,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct BenchmarkTimingAggregate {
    sample_total_seconds: f64,
    mean_sample_seconds: f64,
    max_sample_seconds: f64,
    read_logits_seconds: f64,
    legacy_decode_seconds: f64,
    weak_decode_seconds: f64,
    candidate_adapter_seconds: f64,
    selection_seconds: f64,
    exact_solve_seconds: f64,
    metrics_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
struct OutputMetrics {
    vertices: usize,
    edges: usize,
    edge_metrics: SegmentMetrics,
    border_metrics: SegmentMetrics,
    assignment_metrics: AssignmentMetrics,
    strict_topology: StrictTopologyMetrics,
    structural: StructuralMetrics,
    verification: VerificationMetrics,
}

#[derive(Debug, Default, Clone, Serialize)]
struct ImplementationAggregate {
    samples: usize,
    vertices: usize,
    edges: usize,
    edge_metrics: SegmentMetrics,
    border_metrics: SegmentMetrics,
    assignment_metrics: AssignmentMetrics,
    strict_topology: StrictTopologyAggregate,
    structural: StructuralAggregate,
    verification: VerificationAggregate,
    exact: ExactSolveAggregate,
}

#[derive(Debug, Clone, Serialize)]
struct SelectionSummary {
    candidate_spans: usize,
    selected_spans: usize,
    selected_weak_spans: usize,
    dropped_legacy_spans: usize,
    total_score: f64,
}

#[derive(Debug, Clone, Serialize)]
struct ExactSolveSummary {
    status: String,
    seconds: f64,
    accepted: Option<bool>,
    rejection_reasons: Vec<String>,
    initial_objective: Option<f64>,
    final_objective: Option<f64>,
    candidate_objective: Option<f64>,
    max_vertex_movement: Option<f64>,
    attempted_max_vertex_movement: Option<f64>,
    moved_vertices: usize,
    attempted_moved_vertices: usize,
    evaluations: Option<usize>,
    trace: ExactSolveTraceSummary,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct ExactSolveTraceSummary {
    parameter_count: Option<usize>,
    residual_count: Option<usize>,
    carrier_groups: Option<usize>,
    residual_vector_evaluations: Option<usize>,
    jacobian_calls: Option<usize>,
    finite_difference_columns: Option<usize>,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct ExactSolveAggregate {
    attempted: usize,
    solved: usize,
    ambiguous: usize,
    failed: usize,
    accepted: usize,
    rejected: usize,
    total_seconds: f64,
    max_vertex_movement: f64,
    attempted_max_vertex_movement: f64,
    moved_vertices: usize,
    attempted_moved_vertices: usize,
    evaluations: usize,
    residual_vector_evaluations: usize,
    jacobian_calls: usize,
    finite_difference_columns: usize,
    max_parameter_count: usize,
    max_residual_count: usize,
}

impl ExactSolveAggregate {
    fn add(&mut self, exact: &ExactSolveSummary) {
        self.attempted += 1;
        match exact.status.as_str() {
            "solved" => self.solved += 1,
            "ambiguous" => self.ambiguous += 1,
            _ => self.failed += 1,
        }
        if exact.accepted.unwrap_or(false) {
            self.accepted += 1;
        } else {
            self.rejected += 1;
        }
        self.total_seconds += exact.seconds;
        self.max_vertex_movement = self
            .max_vertex_movement
            .max(exact.max_vertex_movement.unwrap_or(0.0));
        self.attempted_max_vertex_movement = self
            .attempted_max_vertex_movement
            .max(exact.attempted_max_vertex_movement.unwrap_or(0.0));
        self.moved_vertices += exact.moved_vertices;
        self.attempted_moved_vertices += exact.attempted_moved_vertices;
        self.evaluations += exact.evaluations.unwrap_or(0);
        self.residual_vector_evaluations += exact.trace.residual_vector_evaluations.unwrap_or(0);
        self.jacobian_calls += exact.trace.jacobian_calls.unwrap_or(0);
        self.finite_difference_columns += exact.trace.finite_difference_columns.unwrap_or(0);
        self.max_parameter_count = self
            .max_parameter_count
            .max(exact.trace.parameter_count.unwrap_or(0));
        self.max_residual_count = self
            .max_residual_count
            .max(exact.trace.residual_count.unwrap_or(0));
    }
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

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct AssignmentMetrics {
    accuracy: f64,
    matched: usize,
    correct: usize,
    incorrect: usize,
}

impl AssignmentMetrics {
    fn finalize(&mut self) {
        self.accuracy = ratio(self.correct, self.matched);
    }
}

impl AddAssign for AssignmentMetrics {
    fn add_assign(&mut self, rhs: Self) {
        self.matched += rhs.matched;
        self.correct += rhs.correct;
        self.incorrect += rhs.incorrect;
        self.accuracy = 0.0;
    }
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct StructuralMetrics {
    interior_vertices: usize,
    degree_two_vertices: usize,
    odd_degree_vertices: usize,
    maekawa_failures: usize,
    eligible_kawasaki_vertices: usize,
    max_kawasaki_residual_degrees: f64,
    degenerate_edges: usize,
    unmodeled_crossings: usize,
    boundary_failures: usize,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct StructuralAggregate {
    interior_vertices: usize,
    degree_two_vertices: usize,
    odd_degree_vertices: usize,
    maekawa_failures: usize,
    eligible_kawasaki_vertices: usize,
    max_kawasaki_residual_degrees: f64,
    degenerate_edges: usize,
    unmodeled_crossings: usize,
    boundary_failures: usize,
}

impl StructuralAggregate {
    fn add(&mut self, metrics: StructuralMetrics) {
        self.interior_vertices += metrics.interior_vertices;
        self.degree_two_vertices += metrics.degree_two_vertices;
        self.odd_degree_vertices += metrics.odd_degree_vertices;
        self.maekawa_failures += metrics.maekawa_failures;
        self.eligible_kawasaki_vertices += metrics.eligible_kawasaki_vertices;
        self.max_kawasaki_residual_degrees = self
            .max_kawasaki_residual_degrees
            .max(metrics.max_kawasaki_residual_degrees);
        self.degenerate_edges += metrics.degenerate_edges;
        self.unmodeled_crossings += metrics.unmodeled_crossings;
        self.boundary_failures += metrics.boundary_failures;
    }
}

#[derive(Debug, Default, Clone, Serialize)]
struct VerificationMetrics {
    fold_valid: bool,
    fold_error: Option<String>,
    check1_segments: usize,
    check2_segments: usize,
    check3_markers: usize,
    camv_violations: usize,
    flat_folder_solved: bool,
    flat_folder_input_preprocess: Option<String>,
    flat_folder_input_cut_boundary_edges: usize,
    flat_folder_error_kind: Option<String>,
    flat_folder_error_message: Option<String>,
    classifications: Vec<String>,
}

#[derive(Debug, Default, Clone, Serialize)]
struct VerificationAggregate {
    fold_valid: usize,
    check1_segments: usize,
    check2_segments: usize,
    check3_markers: usize,
    camv_violations: usize,
    flat_folder_solved: usize,
    flat_folder_errors: BTreeMap<String, usize>,
    classifications: BTreeMap<String, usize>,
}

impl VerificationAggregate {
    fn add(&mut self, metrics: &VerificationMetrics) {
        if metrics.fold_valid {
            self.fold_valid += 1;
        }
        self.check1_segments += metrics.check1_segments;
        self.check2_segments += metrics.check2_segments;
        self.check3_markers += metrics.check3_markers;
        self.camv_violations += metrics.camv_violations;
        if metrics.flat_folder_solved {
            self.flat_folder_solved += 1;
        }
        if let Some(kind) = &metrics.flat_folder_error_kind {
            *self.flat_folder_errors.entry(kind.clone()).or_default() += 1;
        }
        for classification in &metrics.classifications {
            *self
                .classifications
                .entry(classification.clone())
                .or_default() += 1;
        }
    }
}

#[derive(Debug, Deserialize)]
struct GroundTruthGraph {
    image_size: Option<u32>,
    vertices_px: Vec<[f64; 2]>,
    edges_vertices: Vec<[usize; 2]>,
    #[serde(default)]
    edges_assignment_labels: Vec<Value>,
    #[serde(default)]
    edges_assignment: Vec<Value>,
}

#[derive(Debug, Clone)]
struct GraphDoc {
    vertices: Vec<Point2>,
    edges: Vec<[usize; 2]>,
    assignments: Vec<AssignmentLabel>,
    boundary_roles: Vec<CandidateCreaseBoundaryRole>,
    flat_folder_boundary_hint: Option<String>,
}

#[derive(Debug, Clone, Copy)]
struct SegmentPx {
    a: [f64; 2],
    b: [f64; 2],
    assignment: AssignmentLabel,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let strategy = if args.candidate_source == "legacy" {
        None
    } else {
        Some(
            args.candidate_source
                .parse::<CandidateGenerationStrategyName>()
                .map_err(|error| format!("unsupported candidate source: {error}"))?,
        )
    };

    let started = Instant::now();
    let manifest_path = args.dense_manifest.canonicalize()?;
    let manifest_root = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let manifest: DenseCacheManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    fs::create_dir_all(&args.out)?;

    let verify_options = GlobalVerificationOptions {
        run_flat_folder: !args.skip_flat_folder,
        flat_folder_solution_limit: 1,
        ..GlobalVerificationOptions::default()
    };
    // Samples are independent, so process them across the rayon thread pool and
    // fold the (sequential) aggregates afterward. `collect` into a Vec preserves
    // input order, so reports stay deterministic regardless of completion order.
    let limit = args.limit.unwrap_or(usize::MAX);
    let samples: Vec<&DenseCacheSample> = manifest.samples.iter().take(limit).collect();
    let rows = samples
        .par_iter()
        .map(|sample| {
            process_sample(
                sample,
                &args,
                strategy,
                manifest_root,
                manifest.pack.as_deref(),
                verify_options,
            )
            .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<BenchmarkSample>, String>>()?;

    let mut aggregates = BTreeMap::<String, ImplementationAggregate>::new();
    for row in &rows {
        add_output(&mut aggregates, "legacy", &row.legacy, None);
        add_output(&mut aggregates, "selected", &row.selected, None);
        add_output(
            &mut aggregates,
            "exact_solved",
            &row.exact_solved,
            Some(&row.exact_solve),
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn process_sample(
        sample: &DenseCacheSample,
        args: &Args,
        strategy: Option<CandidateGenerationStrategyName>,
        manifest_root: &Path,
        pack: Option<&str>,
        verify_options: GlobalVerificationOptions,
    ) -> Result<BenchmarkSample, Box<dyn std::error::Error>> {
        let sample_started = Instant::now();
        let gt = read_ground_truth(manifest_root, pack, sample)?;
        let threshold = args.threshold.unwrap_or(sample.threshold);
        let low_threshold = args
            .legacy_low_threshold
            .unwrap_or_else(|| default_low_threshold(threshold));
        let read_logits_started = Instant::now();
        let mut logits = read_sample_logits(manifest_root, sample)?;
        if args.line_evidence_source == "source-image" {
            logits.line_probability_override = Some(read_source_image_line_probability(
                manifest_root,
                pack,
                sample,
            )?);
        }
        if args.gt_junction_labels {
            apply_gt_junction_labels(&mut logits, &gt, sample.image_size)?;
        }
        let read_logits_seconds = read_logits_started.elapsed().as_secs_f64();

        let legacy_decode_started = Instant::now();
        let candidate_graph = match strategy {
            None => {
                let legacy_program = decode_program(sample, &logits, threshold)?;
                let weak_program = if low_threshold < threshold {
                    Some(decode_program(sample, &logits, low_threshold)?)
                } else {
                    None
                };
                LegacyCandidateAdapter::from_programs(
                    &legacy_program,
                    weak_program.as_ref(),
                    legacy_adapter_options(sample.image_size),
                )
            }
            Some(name) => {
                let mut generation_options = CandidateGenerationOptions {
                    strategy: name,
                    ..CandidateGenerationOptions::default()
                };
                generation_options
                    .junction_carrier_v1
                    .junction_evidence_source = args.junction_evidence_source;
                generation_options
                    .junction_first_v1
                    .junction_evidence_source = args.junction_evidence_source;
                if let Some(value) = args.junction_first_merge_radius_px {
                    generation_options.junction_first_v1.vertex_merge_radius_px = value;
                }
                if let Some(value) = args.junction_first_corridor_px {
                    generation_options
                        .junction_first_v1
                        .intermediate_corridor_px = value;
                }
                if let Some(value) = args.junction_first_endpoint_margin_px {
                    generation_options.junction_first_v1.endpoint_margin_px = value;
                }
                if let Some(value) = args.junction_first_min_span_px {
                    generation_options.junction_first_v1.min_span_length_px = value;
                }
                if let Some(value) = args.junction_first_offset_cluster_radius_px {
                    generation_options
                        .junction_first_v1
                        .junction_offset_cluster_radius_px = value;
                }
                if let Some(value) = args.junction_first_short_span_bypass_px {
                    generation_options.junction_first_v1.short_span_bypass_px = value;
                }
                let ctx = CandidateGenerationContext {
                    outputs: logits.as_dense_outputs(),
                    config: DecodeConfig {
                        image_size: sample.image_size,
                        threshold,
                        ..DecodeConfig::default()
                    },
                };
                if args.gt_vertices {
                    if name != CandidateGenerationStrategyName::JunctionFirstV1 {
                        return Err(format!(
                            "--oracle-vertices requires --candidate-source junction-first-v1 (got {name})"
                        )
                        .into());
                    }
                    // Perfect-junction oracle: replace decoded junctions with the
                    // exact GT vertices (no merge), keeping line evidence (model
                    // or source-image override) and the rest of junction-first.
                    generate_junction_first_with_vertex_pixels(
                        ctx,
                        generation_options.junction_first_v1,
                        &gt.vertices_px,
                    )?
                } else {
                    generate_candidate_graph(ctx, generation_options)?.candidate_graph
                }
            }
        };
        let legacy_decode_seconds = legacy_decode_started.elapsed().as_secs_f64();
        let weak_decode_seconds = 0.0;
        let candidate_adapter_seconds = 0.0;

        let selection_started = Instant::now();
        let mut selection_options = SelectionOptions::default();
        if let Some(parity_repair) = args.parity_repair {
            selection_options.parity_repair = parity_repair;
        }
        let selection = select_candidate_graph_beam_from_ir(
            &candidate_graph,
            selection_options,
            Default::default(),
        );
        let selection_seconds = selection_started.elapsed().as_secs_f64();
        let gt_segments = gt.segments();
        // Oracle selection replaces beam with the GT-optimal subset of the pool,
        // isolating beam scoring as a lever; beam still runs for its report.
        let selected_span_ids = if args.oracle_selection {
            oracle_selected_span_ids(
                &candidate_graph,
                &gt_segments,
                sample.image_size,
                args.strict_vertex_tolerance_px,
            )
        } else {
            selection
                .selected_spans
                .iter()
                .map(|span| span.id)
                .collect::<Vec<_>>()
        };
        let selected_span_set = selected_span_ids.iter().copied().collect::<BTreeSet<_>>();
        let selected_graph =
            SelectedGraph::from_selected_span_ids(&candidate_graph, selected_span_ids);
        let exact_input =
            ExactSolveInput::from_candidate_selection(&candidate_graph, &selected_graph);
        let gt_eval_graph = gt.eval_graph();
        // Topology gate: a wrong-topology graph cannot reconstruct the right CP,
        // so by default skip exact solve and mark it failed rather than letting
        // the solver flail toward (and sometimes "accept") a wrong reconstruction.
        // Pass --exact-solve-any-topology to attempt it regardless.
        let selected_topology = strict_topology_metrics(
            &GraphDoc::from_exact_input(&exact_input).eval_graph_px(sample.image_size),
            &gt_eval_graph,
            StrictTopologyOptions {
                vertex_tolerance: args.strict_vertex_tolerance_px,
                split_merge_tolerance: args.strict_vertex_tolerance_px,
                compare_assignments: true,
            },
        );
        let attribution = failure_attribution(
            &candidate_graph,
            &selected_topology,
            &gt_eval_graph,
            sample.image_size,
            args.strict_vertex_tolerance_px,
        );
        let skip_for_bad_topology = !args.skip_exact_solve
            && !args.exact_solve_any_topology
            && !selected_topology.exact_topology;
        eprintln!(
            "{}",
            serde_json::to_string(&json!({
                "id": sample.id,
                "event": "start_exact_solve",
                "selected_spans": exact_input.selected_spans.len(),
                "vertices": exact_input.vertices.len(),
            }))?
        );
        let exact_started = Instant::now();
        let exact_solved = if args.skip_exact_solve || skip_for_bad_topology {
            None
        } else {
            let mut exact_options = ExactSolveOptions::default();
            if let Some(patience) = args.exact_patience {
                exact_options.patience = patience;
            }
            exact_options.timeout_seconds = args.exact_solve_timeout_seconds;
            Some(solve_exact(&exact_input, exact_options))
        };
        let exact_seconds = exact_started.elapsed().as_secs_f64();
        eprintln!(
            "{}",
            serde_json::to_string(&json!({
                "id": sample.id,
                "event": "finish_exact_solve",
                "seconds": round3(exact_seconds),
                "status": exact_solved
                    .as_ref()
                    .map_or("skipped", |exact| exact_status_label(exact.status)),
            }))?
        );

        let metrics_started = Instant::now();
        let legacy_span_set = candidate_graph
            .crease_candidates
            .iter()
            .filter(|span| {
                matches!(
                    span.source_kind,
                    oristudio_cp_compiler::CandidateCreaseSourceKind::LegacySelected
                        | oristudio_cp_compiler::CandidateCreaseSourceKind::BorderGenerated
                )
            })
            .map(|span| span.id)
            .collect::<BTreeSet<_>>();
        let flat_folder_boundary_hint = flat_folder_boundary_hint_for_sample(sample);
        let legacy_graph = SelectedGraph::from_selected_span_ids(
            &candidate_graph,
            legacy_span_set.iter().copied().collect(),
        );
        let legacy_exact_input =
            ExactSolveInput::from_candidate_selection(&candidate_graph, &legacy_graph);
        let legacy_doc = GraphDoc::from_exact_input(&legacy_exact_input)
            .with_flat_folder_boundary_hint(flat_folder_boundary_hint.clone());
        let selected_doc = GraphDoc::from_exact_input(&exact_input)
            .with_flat_folder_boundary_hint(flat_folder_boundary_hint.clone());
        let exact_doc = exact_solved.as_ref().map(|exact| {
            GraphDoc::from_exact_solve(&exact_input, exact)
                .with_flat_folder_boundary_hint(flat_folder_boundary_hint.clone())
        });

        let legacy = output_metrics(
            &legacy_doc,
            &gt_segments,
            &gt_eval_graph,
            sample.image_size,
            args.match_tolerance_px,
            args.strict_vertex_tolerance_px,
            verify_options,
        )?;
        let selected = output_metrics(
            &selected_doc,
            &gt_segments,
            &gt_eval_graph,
            sample.image_size,
            args.match_tolerance_px,
            args.strict_vertex_tolerance_px,
            verify_options,
        )?;
        let exact_output = match &exact_doc {
            Some(doc) => output_metrics(
                doc,
                &gt_segments,
                &gt_eval_graph,
                sample.image_size,
                args.match_tolerance_px,
                args.strict_vertex_tolerance_px,
                verify_options,
            )?,
            None => selected.clone(),
        };
        let exact_summary = if skip_for_bad_topology {
            bad_topology_exact_solve_summary()
        } else {
            match &exact_solved {
                Some(exact) => exact_solve_summary(exact, exact_seconds),
                None => skipped_exact_solve_summary(),
            }
        };
        if args.dump_folds {
            if let Some(doc) = &exact_doc {
                let path = args.out.join(format!("{}.exact_solved.fold", sample.id));
                fs::write(&path, doc.to_fold_json()?)?;
            }
            let path = args.out.join(format!("{}.selected.fold", sample.id));
            fs::write(&path, selected_doc.to_fold_json()?)?;
        }
        let metrics_seconds = metrics_started.elapsed().as_secs_f64();
        let selected_weak_spans = candidate_graph
            .crease_candidates
            .iter()
            .filter(|candidate| {
                selected_span_set.contains(&candidate.id)
                    && candidate.source_kind
                        == oristudio_cp_compiler::CandidateCreaseSourceKind::LegacyLowThreshold
            })
            .count();
        let dropped_legacy_spans = candidate_graph
            .crease_candidates
            .iter()
            .filter(|span| {
                span.source_kind == oristudio_cp_compiler::CandidateCreaseSourceKind::LegacySelected
                    && !selected_span_set.contains(&span.id)
            })
            .count();

        let sample_seconds = sample_started.elapsed().as_secs_f64();
        let row = BenchmarkSample {
            id: sample.id.clone(),
            source_id: sample.source_id.clone(),
            family: sample.family.clone(),
            profile: sample.profile.clone(),
            gt_edges: gt_segments.len(),
            legacy,
            selected,
            exact_solved: exact_output,
            selection: SelectionSummary {
                candidate_spans: candidate_graph.crease_candidates.len(),
                selected_spans: selected_span_set.len(),
                selected_weak_spans,
                dropped_legacy_spans,
                total_score: round6(selection.report.total_score),
            },
            exact_solve: exact_summary,
            attribution,
            timing: BenchmarkSampleTiming {
                read_logits_seconds: round3(read_logits_seconds),
                legacy_decode_seconds: round3(legacy_decode_seconds),
                weak_decode_seconds: round3(weak_decode_seconds),
                candidate_adapter_seconds: round3(candidate_adapter_seconds),
                selection_seconds: round3(selection_seconds),
                exact_solve_seconds: round3(exact_seconds),
                metrics_seconds: round3(metrics_seconds),
                total_seconds: round3(sample_seconds),
            },
            seconds: round3(sample_seconds),
        };

        eprintln!(
            "{}",
            serde_json::to_string(&json!({
                "id": row.id,
                "seconds": row.seconds,
                "legacy_f1": row.legacy.edge_metrics.f1,
                "selected_f1": row.selected.edge_metrics.f1,
                "exact_f1": row.exact_solved.edge_metrics.f1,
                "exact_status": row.exact_solve.status,
            }))?
        );
        Ok(row)
    }

    for aggregate in aggregates.values_mut() {
        aggregate.edge_metrics.finalize();
        aggregate.border_metrics.finalize();
        aggregate.assignment_metrics.finalize();
        aggregate.strict_topology.finalize();
    }

    let summary = BenchmarkSummary {
        schema: SCHEMA,
        generated_by: "compare_exact_solve_benchmark",
        generated_at_unix: now_unix(),
        git_commit: git_commit(),
        dense_manifest: manifest_path.display().to_string(),
        dense_schema: manifest.schema,
        pack: manifest.pack,
        config: BenchmarkConfig {
            candidate_source: args.candidate_source,
            line_evidence_source: args.line_evidence_source,
            junction_evidence_source: junction_evidence_source_label(
                args.junction_evidence_source,
                args.gt_junction_labels,
            )
            .to_owned(),
            gt_junction_labels: args.gt_junction_labels,
            threshold: args.threshold,
            legacy_low_threshold: args.legacy_low_threshold,
            exact_patience: args.exact_patience,
            exact_solve_timeout_seconds: args.exact_solve_timeout_seconds,
            match_tolerance_px: args.match_tolerance_px,
            strict_vertex_tolerance_px: args.strict_vertex_tolerance_px,
            flat_folder_enabled: !args.skip_flat_folder,
        },
        sample_count: rows.len(),
        total_seconds: round3(started.elapsed().as_secs_f64()),
        timing: aggregate_timing(&rows),
        implementations: aggregates,
    };

    write_reports(&args.out, &summary, &rows)?;
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut dense_manifest = None;
        let mut out = None;
        let mut candidate_source = "legacy".to_owned();
        let mut line_evidence_source = "model".to_owned();
        let mut junction_evidence_source = JunctionEvidenceSource::Model;
        let mut gt_junction_labels = false;
        let mut gt_vertices = false;
        let mut threshold = None;
        let mut legacy_low_threshold = None;
        let mut exact_patience = None;
        let mut exact_solve_timeout_seconds = BENCHMARK_DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS;
        let mut limit = None;
        let mut match_tolerance_px = 12.0;
        let mut strict_vertex_tolerance_px = 2.0;
        let mut skip_flat_folder = false;
        let mut skip_exact_solve = false;
        let mut exact_solve_any_topology = false;
        let mut oracle_selection = false;
        let mut junction_first_merge_radius_px = None;
        let mut junction_first_corridor_px = None;
        let mut junction_first_endpoint_margin_px = None;
        let mut junction_first_min_span_px = None;
        let mut junction_first_offset_cluster_radius_px = None;
        let mut junction_first_short_span_bypass_px = None;
        let mut parity_repair = None;
        let mut dump_folds = false;
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--dense-manifest" | "--manifest" | "--cache" => {
                    dense_manifest = Some(PathBuf::from(required_value(&mut iter, &arg)?));
                }
                "--out" => out = Some(PathBuf::from(required_value(&mut iter, "--out")?)),
                "--candidate-source" => {
                    candidate_source = required_value(&mut iter, "--candidate-source")?
                }
                "--line-evidence-source" => {
                    line_evidence_source = required_value(&mut iter, "--line-evidence-source")?;
                    if !matches!(line_evidence_source.as_str(), "model" | "source-image") {
                        return Err(
                            "--line-evidence-source must be 'model' or 'source-image'".into()
                        );
                    }
                }
                "--junction-evidence-source" => {
                    let value = required_value(&mut iter, &arg)?;
                    if matches!(
                        value.as_str(),
                        "ground-truth" | "ground_truth" | "gt" | "gt-labels" | "gt_labels"
                    ) {
                        junction_evidence_source = JunctionEvidenceSource::Model;
                        gt_junction_labels = true;
                    } else {
                        junction_evidence_source = parse_junction_evidence_source(&value)?;
                    }
                }
                "--oracle-junction-labels" => gt_junction_labels = true,
                "--oracle-vertices" => gt_vertices = true,
                "--threshold" => {
                    threshold = Some(required_value(&mut iter, "--threshold")?.parse()?)
                }
                "--legacy-low-threshold" => {
                    legacy_low_threshold =
                        Some(required_value(&mut iter, "--legacy-low-threshold")?.parse()?);
                }
                "--exact-patience" => {
                    exact_patience = Some(required_value(&mut iter, "--exact-patience")?.parse()?);
                }
                "--exact-solve-timeout-seconds" => {
                    exact_solve_timeout_seconds = required_value(&mut iter, &arg)?.parse()?;
                }
                "--limit" => limit = Some(required_value(&mut iter, "--limit")?.parse()?),
                "--match-tolerance-px" => {
                    match_tolerance_px =
                        required_value(&mut iter, "--match-tolerance-px")?.parse()?;
                }
                "--strict-vertex-tolerance-px" => {
                    strict_vertex_tolerance_px =
                        required_value(&mut iter, "--strict-vertex-tolerance-px")?.parse()?;
                }
                "--skip-flat-folder" => skip_flat_folder = true,
                "--skip-exact-solve" => skip_exact_solve = true,
                "--exact-solve-any-topology" => exact_solve_any_topology = true,
                "--oracle-selection" => oracle_selection = true,
                "--junction-first-merge-radius-px" => {
                    junction_first_merge_radius_px =
                        Some(required_value(&mut iter, &arg)?.parse()?);
                }
                "--junction-first-corridor-px" => {
                    junction_first_corridor_px = Some(required_value(&mut iter, &arg)?.parse()?);
                }
                "--junction-first-endpoint-margin-px" => {
                    junction_first_endpoint_margin_px =
                        Some(required_value(&mut iter, &arg)?.parse()?);
                }
                "--junction-first-min-span-px" => {
                    junction_first_min_span_px = Some(required_value(&mut iter, &arg)?.parse()?);
                }
                "--junction-first-offset-cluster-radius-px" => {
                    junction_first_offset_cluster_radius_px =
                        Some(required_value(&mut iter, &arg)?.parse()?);
                }
                "--junction-first-short-span-bypass-px" => {
                    junction_first_short_span_bypass_px =
                        Some(required_value(&mut iter, &arg)?.parse()?);
                }
                "--parity-repair" => parity_repair = Some(true),
                "--no-parity-repair" => parity_repair = Some(false),
                "--dump-folds" => dump_folds = true,
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}").into()),
            }
        }
        let dense_manifest =
            dense_manifest.unwrap_or_else(|| PathBuf::from(DEFAULT_DENSE_MANIFEST));
        let out = out.ok_or("--out is required")?;
        Ok(Self {
            dense_manifest,
            out,
            candidate_source,
            line_evidence_source,
            junction_evidence_source,
            gt_junction_labels,
            gt_vertices,
            threshold,
            legacy_low_threshold,
            exact_patience,
            exact_solve_timeout_seconds,
            limit,
            match_tolerance_px,
            strict_vertex_tolerance_px,
            skip_flat_folder,
            skip_exact_solve,
            exact_solve_any_topology,
            oracle_selection,
            junction_first_merge_radius_px,
            junction_first_corridor_px,
            junction_first_endpoint_margin_px,
            junction_first_min_span_px,
            junction_first_offset_cluster_radius_px,
            junction_first_short_span_bypass_px,
            parity_repair,
            dump_folds,
        })
    }
}

struct SampleLogits {
    line_logits: Vec<f32>,
    line_probability_override: Option<Vec<f32>>,
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

impl SampleLogits {
    fn as_dense_outputs(&self) -> DenseOutputs<'_> {
        DenseOutputs::from_legacy_heads(
            &self.line_logits,
            &self.junction_logits,
            &self.assignment_logits,
            &self.non_crease_logits,
            &self.line_style_logits,
            &self.boundary_contact_logits,
        )
        .with_line_probability_override(self.line_probability_override.as_deref())
        .with_angle(self.angle.as_deref())
        .with_junction_offset(self.junction_offset.as_deref())
        .with_vertex_type_logits(self.vertex_type_logits.as_deref())
        .with_boundary_side_logits(self.boundary_side_logits.as_deref())
        .with_boundary_offset(self.boundary_offset.as_deref())
        .with_boundary_coord(self.boundary_coord.as_deref())
    }
}

fn read_sample_logits(
    root: &Path,
    sample: &DenseCacheSample,
) -> Result<SampleLogits, Box<dyn std::error::Error>> {
    Ok(SampleLogits {
        line_logits: read_f32_file(&resolve_path(root, &sample.line_logits_f32_path))?,
        line_probability_override: None,
        angle: read_optional_f32_file(root, sample.angle_f32_path.as_deref())?,
        junction_logits: read_f32_file(&resolve_path(root, &sample.junction_logits_f32_path))?,
        junction_offset: read_optional_f32_file(root, sample.junction_offset_f32_path.as_deref())?,
        assignment_logits: read_f32_file(&resolve_path(root, &sample.assignment_logits_f32_path))?,
        non_crease_logits: read_f32_file(&resolve_path(root, &sample.non_crease_logits_f32_path))?,
        line_style_logits: read_f32_file(&resolve_path(root, &sample.line_style_logits_f32_path))?,
        vertex_type_logits: read_optional_f32_file(
            root,
            sample.vertex_type_logits_f32_path.as_deref(),
        )?,
        boundary_contact_logits: read_f32_file(&resolve_path(
            root,
            &sample.boundary_contact_logits_f32_path,
        ))?,
        boundary_side_logits: read_optional_f32_file(
            root,
            sample.boundary_side_logits_f32_path.as_deref(),
        )?,
        boundary_offset: read_optional_f32_file(root, sample.boundary_offset_f32_path.as_deref())?,
        boundary_coord: read_optional_f32_file(root, sample.boundary_coord_f32_path.as_deref())?,
    })
}

fn read_source_image_line_probability(
    manifest_root: &Path,
    pack: Option<&str>,
    sample: &DenseCacheSample,
) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let Some(input_png) = sample.input_png.as_deref() else {
        return Err(format!(
            "sample {} has no input_png; source-image line evidence is unavailable",
            sample.id
        )
        .into());
    };
    let path = resolve_pack_path(manifest_root, pack, input_png);
    let image = image::ImageReader::open(&path)?.decode()?.into_rgba8();
    let (width, height) = image.dimensions();
    if width != sample.image_size || height != sample.image_size {
        return Err(format!(
            "sample {} input_png must be {}x{} for source-image line evidence, got {}x{} ({})",
            sample.id,
            sample.image_size,
            sample.image_size,
            width,
            height,
            path.display()
        )
        .into());
    }
    Ok(line_probability_from_rgba(
        image.as_raw(),
        width,
        height,
        SourceImageLineEvidenceOptions::default(),
    )?)
}

fn apply_gt_junction_labels(
    logits: &mut SampleLogits,
    gt: &GroundTruthGraph,
    image_size: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    let size = image_size as usize;
    let pixels = size
        .checked_mul(size)
        .ok_or("image size overflow while rendering GT junction labels")?;
    let mut junction_probability = vec![GT_BACKGROUND_PROBABILITY; pixels];
    let mut junction_offset = vec![0.0_f32; pixels * 2];
    let mut nearest_junction_distance_sq = vec![f64::INFINITY; pixels];
    let mut boundary_contact_probability = vec![GT_BACKGROUND_PROBABILITY; pixels];
    let mut boundary_offset = vec![0.0_f32; pixels * 2];

    for vertex in &gt.vertices_px {
        render_gaussian_probability(
            &mut junction_probability,
            size,
            *vertex,
            GT_JUNCTION_SIGMA_PX,
            GT_PEAK_PROBABILITY,
        );
        render_radius_normalized_offset(
            &mut junction_offset,
            &mut nearest_junction_distance_sq,
            size,
            *vertex,
            GT_JUNCTION_OFFSET_RADIUS_PX,
        );
        if gt_boundary_side_coordinate(*vertex, image_size).is_some() {
            render_gaussian_probability(
                &mut boundary_contact_probability,
                size,
                *vertex,
                GT_BOUNDARY_CONTACT_SIGMA_PX,
                GT_PEAK_PROBABILITY,
            );
            render_subpixel_offset(&mut boundary_offset, size, *vertex);
        }
    }

    logits.junction_logits = junction_probability
        .into_iter()
        .map(probability_to_logit)
        .collect();
    logits.junction_offset = Some(junction_offset);
    logits.boundary_contact_logits = boundary_contact_probability
        .into_iter()
        .map(probability_to_logit)
        .collect();
    logits.boundary_offset = Some(boundary_offset);
    logits.vertex_type_logits = None;
    Ok(())
}

fn render_gaussian_probability(
    probability: &mut [f32],
    size: usize,
    point: [f64; 2],
    sigma_px: f64,
    peak_probability: f32,
) {
    if size == 0 || sigma_px <= 0.0 {
        return;
    }
    let radius = (sigma_px * 3.0).ceil() as isize;
    let center_x = point[0].round() as isize;
    let center_y = point[1].round() as isize;
    let sigma_sq = sigma_px * sigma_px;
    for y in (center_y - radius)..=(center_y + radius) {
        if y < 0 || y >= size as isize {
            continue;
        }
        for x in (center_x - radius)..=(center_x + radius) {
            if x < 0 || x >= size as isize {
                continue;
            }
            let dx = x as f64 - point[0];
            let dy = y as f64 - point[1];
            let value =
                f64::from(peak_probability) * (-(dx * dx + dy * dy) / (2.0 * sigma_sq)).exp();
            let idx = y as usize * size + x as usize;
            probability[idx] = probability[idx].max(value as f32);
        }
    }
}

fn render_radius_normalized_offset(
    offset: &mut [f32],
    nearest_distance_sq: &mut [f64],
    size: usize,
    point: [f64; 2],
    radius_px: f64,
) {
    if size == 0 || radius_px <= 0.0 {
        return;
    }
    let pixels = size * size;
    if offset.len() < pixels * 2 || nearest_distance_sq.len() < pixels {
        return;
    }
    let radius = radius_px.ceil() as isize;
    let center_x = point[0].round() as isize;
    let center_y = point[1].round() as isize;
    let radius_sq = radius_px * radius_px;
    for y in (center_y - radius)..=(center_y + radius) {
        if y < 0 || y >= size as isize {
            continue;
        }
        for x in (center_x - radius)..=(center_x + radius) {
            if x < 0 || x >= size as isize {
                continue;
            }
            let dx = point[0] - x as f64;
            let dy = point[1] - y as f64;
            let distance_sq = dx * dx + dy * dy;
            if distance_sq > radius_sq {
                continue;
            }
            let idx = y as usize * size + x as usize;
            if distance_sq >= nearest_distance_sq[idx] {
                continue;
            }
            nearest_distance_sq[idx] = distance_sq;
            offset[idx] = (dx / radius_px).clamp(-1.0, 1.0) as f32;
            offset[pixels + idx] = (dy / radius_px).clamp(-1.0, 1.0) as f32;
        }
    }
}

fn render_subpixel_offset(offset: &mut [f32], size: usize, point: [f64; 2]) {
    if size == 0 {
        return;
    }
    let pixels = size * size;
    if offset.len() < pixels * 2 {
        return;
    }
    let x = point[0].round().clamp(0.0, size.saturating_sub(1) as f64) as usize;
    let y = point[1].round().clamp(0.0, size.saturating_sub(1) as f64) as usize;
    let idx = y * size + x;
    offset[idx] = (point[0] - x as f64).clamp(-0.5, 0.5) as f32;
    offset[pixels + idx] = (point[1] - y as f64).clamp(-0.5, 0.5) as f32;
}

fn gt_boundary_side_coordinate(point: [f64; 2], image_size: u32) -> Option<(usize, f64)> {
    let (frame_min, frame_max) = rendered_square_frame_px(image_size);
    let span = (frame_max - frame_min).max(1.0);
    let candidates = [
        (
            0usize,
            (point[1] - frame_min).abs(),
            (point[0] - frame_min) / span,
        ),
        (
            1usize,
            (point[0] - frame_max).abs(),
            (point[1] - frame_min) / span,
        ),
        (
            2usize,
            (point[1] - frame_max).abs(),
            (point[0] - frame_min) / span,
        ),
        (
            3usize,
            (point[0] - frame_min).abs(),
            (point[1] - frame_min) / span,
        ),
    ];
    let (side, distance, coordinate) = candidates
        .into_iter()
        .min_by(|left, right| left.1.total_cmp(&right.1))?;
    if distance <= 2.5 {
        Some((side, coordinate.clamp(0.0, 1.0)))
    } else {
        None
    }
}

fn rendered_square_frame_px(image_size: u32) -> (f64, f64) {
    let raw_max = image_size.saturating_sub(1) as f64;
    let inset = if image_size as f64 > 64.0 {
        32.0
    } else {
        raw_max * 0.25
    };
    let frame_max = (image_size as f64 - inset).clamp(inset, raw_max);
    (inset, frame_max)
}

fn probability_to_logit(probability: f32) -> f32 {
    let probability = probability.clamp(0.0001, 0.9999);
    (probability / (1.0 - probability)).ln()
}

fn decode_program(
    sample: &DenseCacheSample,
    logits: &SampleLogits,
    threshold: f32,
) -> Result<CandidateProgram, Box<dyn std::error::Error>> {
    let decoded = decode_dense_outputs(
        logits.as_dense_outputs(),
        DecodeConfig {
            image_size: sample.image_size,
            threshold,
            ..DecodeConfig::default()
        },
    )?;
    let value: Value = serde_json::from_str(&decoded.fold_json)?;
    Ok(CandidateProgram::from_fold_value(&value)?)
}

fn read_ground_truth(
    manifest_root: &Path,
    pack: Option<&str>,
    sample: &DenseCacheSample,
) -> Result<GroundTruthGraph, Box<dyn std::error::Error>> {
    let Some(path) = sample.gt_graph.as_deref() else {
        return Err(format!("sample {} has no gt_graph", sample.id).into());
    };
    let path = resolve_pack_path(manifest_root, pack, path);
    let mut gt: GroundTruthGraph = serde_json::from_str(&fs::read_to_string(&path)?)?;
    if gt.edges_assignment_labels.is_empty() && !gt.edges_assignment.is_empty() {
        gt.edges_assignment_labels = gt.edges_assignment.clone();
    }
    if gt.edges_assignment_labels.len() < gt.edges_vertices.len() {
        gt.edges_assignment_labels
            .resize(gt.edges_vertices.len(), Value::String("U".to_owned()));
    }
    Ok(gt)
}

impl GroundTruthGraph {
    fn segments(&self) -> Vec<SegmentPx> {
        let _image_size = self.image_size;
        self.edges_vertices
            .iter()
            .enumerate()
            .filter_map(|(index, edge)| {
                let a = *self.vertices_px.get(edge[0])?;
                let b = *self.vertices_px.get(edge[1])?;
                Some(SegmentPx {
                    a,
                    b,
                    assignment: self
                        .edges_assignment_labels
                        .get(index)
                        .map(parse_assignment_value)
                        .unwrap_or(AssignmentLabel::Unknown),
                })
            })
            .collect()
    }

    fn eval_graph(&self) -> EvalGraph {
        let vertices = self
            .vertices_px
            .iter()
            .copied()
            .map(EvalPoint::from)
            .collect::<Vec<_>>();
        let edges = self
            .edges_vertices
            .iter()
            .enumerate()
            .map(|(index, vertices)| {
                EvalEdge::new(
                    *vertices,
                    self.edges_assignment_labels
                        .get(index)
                        .map(parse_assignment_value)
                        .map(eval_assignment)
                        .unwrap_or(EvalAssignment::Unknown),
                )
            })
            .collect::<Vec<_>>();
        EvalGraph::new(vertices, edges)
    }
}

impl GraphDoc {
    fn from_exact_input(input: &ExactSolveInput) -> Self {
        Self {
            vertices: input.vertices.iter().map(|vertex| vertex.point).collect(),
            edges: input
                .selected_spans
                .iter()
                .map(|span| span.vertices)
                .collect(),
            assignments: input
                .selected_spans
                .iter()
                .map(|span| span.assignment_label())
                .collect(),
            boundary_roles: input
                .selected_spans
                .iter()
                .map(|span| span.boundary_role())
                .collect(),
            flat_folder_boundary_hint: None,
        }
    }

    fn from_exact_solve(input: &ExactSolveInput, exact: &ExactSolvedGraph) -> Self {
        Self {
            vertices: exact.vertices_exact.clone(),
            edges: exact.edges_exact.clone(),
            assignments: input
                .selected_spans
                .iter()
                .map(|span| span.assignment_label())
                .collect(),
            boundary_roles: input
                .selected_spans
                .iter()
                .map(|span| span.boundary_role())
                .collect(),
            flat_folder_boundary_hint: None,
        }
    }

    fn with_flat_folder_boundary_hint(mut self, hint: Option<String>) -> Self {
        self.flat_folder_boundary_hint = hint;
        self
    }

    fn segments_px(&self, image_size: u32) -> Vec<SegmentPx> {
        self.edges
            .iter()
            .enumerate()
            .filter_map(|(index, edge)| {
                let a = *self.vertices.get(edge[0])?;
                let b = *self.vertices.get(edge[1])?;
                Some(SegmentPx {
                    a: normalized_to_px(a, image_size),
                    b: normalized_to_px(b, image_size),
                    assignment: self
                        .assignments
                        .get(index)
                        .copied()
                        .unwrap_or(AssignmentLabel::Unknown),
                })
            })
            .collect()
    }

    fn eval_graph_px(&self, image_size: u32) -> EvalGraph {
        let vertices = self
            .vertices
            .iter()
            .copied()
            .map(|point| EvalPoint::from(normalized_to_px(point, image_size)))
            .collect::<Vec<_>>();
        let edges = self
            .edges
            .iter()
            .enumerate()
            .filter_map(|(index, vertices)| {
                if vertices[0] >= self.vertices.len() || vertices[1] >= self.vertices.len() {
                    return None;
                }
                Some(
                    EvalEdge::new(
                        *vertices,
                        self.assignments
                            .get(index)
                            .copied()
                            .map(eval_assignment)
                            .unwrap_or(EvalAssignment::Unknown),
                    )
                    .with_boundary_role(
                        self.boundary_roles
                            .get(index)
                            .copied()
                            .map(eval_boundary_role)
                            .unwrap_or_default(),
                    ),
                )
            })
            .collect::<Vec<_>>();
        EvalGraph::new(vertices, edges)
    }

    fn to_fold_json(&self) -> Result<String, serde_json::Error> {
        let mut used_vertices = self.edges.iter().flat_map(|edge| *edge).collect::<Vec<_>>();
        used_vertices.sort_unstable();
        used_vertices.dedup();
        let mut remap = vec![usize::MAX; self.vertices.len()];
        let vertices_coords = used_vertices
            .iter()
            .enumerate()
            .filter_map(|(new_id, old_id)| {
                remap[*old_id] = new_id;
                self.vertices
                    .get(*old_id)
                    .map(|point| vec![point.x, point.y])
            })
            .collect::<Vec<_>>();
        let edges_vertices = self
            .edges
            .iter()
            .filter_map(|edge| {
                let a = remap.get(edge[0]).copied().unwrap_or(usize::MAX);
                let b = remap.get(edge[1]).copied().unwrap_or(usize::MAX);
                (a != usize::MAX && b != usize::MAX).then_some([a, b])
            })
            .collect::<Vec<_>>();
        let edges_assignment = self
            .assignments
            .iter()
            .take(edges_vertices.len())
            .map(|assignment| assignment_code(*assignment))
            .collect::<Vec<_>>();
        let mut value = json!({
            "file_spec": 1.2,
            "file_creator": "oristudio-cp-detect exact solve benchmark",
            "vertices_coords": vertices_coords,
            "edges_vertices": edges_vertices,
            "edges_assignment": edges_assignment,
        });
        if let Some(hint) = &self.flat_folder_boundary_hint {
            value["cp_detector"] = json!({
                "flat_folder_boundary_hint": hint,
            });
        }
        serde_json::to_string_pretty(&value)
    }
}

fn flat_folder_boundary_hint_for_sample(sample: &DenseCacheSample) -> Option<String> {
    (sample.family.as_deref() == Some("treemaker-tree"))
        .then(|| "treemaker_useful_polygon".to_owned())
}

fn output_metrics(
    doc: &GraphDoc,
    gt_segments: &[SegmentPx],
    gt_graph: &EvalGraph,
    image_size: u32,
    tolerance_px: f64,
    strict_vertex_tolerance_px: f64,
    verify_options: GlobalVerificationOptions,
) -> Result<OutputMetrics, Box<dyn std::error::Error>> {
    let predicted_segments = doc.segments_px(image_size);
    let predicted_graph = doc.eval_graph_px(image_size);
    let edge_metrics = segment_metrics(&predicted_segments, gt_segments, tolerance_px);
    let border_metrics = segment_metrics(
        &filter_assignment(&predicted_segments, AssignmentLabel::Boundary),
        &filter_assignment(gt_segments, AssignmentLabel::Boundary),
        tolerance_px,
    );
    let assignment_metrics = assignment_metrics(&predicted_segments, gt_segments, tolerance_px);
    let strict_topology = strict_topology_metrics(
        &predicted_graph,
        gt_graph,
        StrictTopologyOptions {
            vertex_tolerance: strict_vertex_tolerance_px,
            split_merge_tolerance: strict_vertex_tolerance_px,
            compare_assignments: true,
        },
    );
    let structural = structural_metrics(doc);
    let verification = verification_metrics(&doc.to_fold_json()?, verify_options)?;
    Ok(OutputMetrics {
        vertices: doc.vertices.len(),
        edges: doc.edges.len(),
        edge_metrics,
        border_metrics,
        assignment_metrics,
        strict_topology,
        structural,
        verification,
    })
}

fn verification_metrics(
    fold_json: &str,
    options: GlobalVerificationOptions,
) -> Result<VerificationMetrics, Box<dyn std::error::Error>> {
    let report = verify_fold_json(fold_json, options)?;
    Ok(VerificationMetrics {
        fold_valid: report.fold_valid,
        fold_error: report.fold_error,
        check1_segments: report.oristudio.check1_segments,
        check2_segments: report.oristudio.check2_segments,
        check3_markers: report.oristudio.check3_markers,
        camv_violations: report.oristudio.camv_violations,
        flat_folder_solved: report.flat_folder.solved,
        flat_folder_input_preprocess: report.flat_folder.input_preprocess,
        flat_folder_input_cut_boundary_edges: report.flat_folder.input_cut_boundary_edges.len(),
        flat_folder_error_kind: report.flat_folder.error_kind,
        flat_folder_error_message: report.flat_folder.error_message,
        classifications: report
            .classifications
            .into_iter()
            .map(|classification| format!("{classification:?}"))
            .collect(),
    })
}

fn skipped_exact_solve_summary() -> ExactSolveSummary {
    ExactSolveSummary {
        status: "skipped".to_owned(),
        seconds: 0.0,
        accepted: None,
        rejection_reasons: Vec::new(),
        initial_objective: None,
        final_objective: None,
        candidate_objective: None,
        max_vertex_movement: None,
        attempted_max_vertex_movement: None,
        moved_vertices: 0,
        attempted_moved_vertices: 0,
        evaluations: None,
        trace: ExactSolveTraceSummary::default(),
    }
}

/// Exact-solve result for a sample whose selected topology does not match GT:
/// not attempted, reported as a failure (the reconstruction cannot be correct).
fn bad_topology_exact_solve_summary() -> ExactSolveSummary {
    ExactSolveSummary {
        status: "failed".to_owned(),
        seconds: 0.0,
        accepted: Some(false),
        rejection_reasons: vec!["topology_mismatch".to_owned()],
        initial_objective: None,
        final_objective: None,
        candidate_objective: None,
        max_vertex_movement: None,
        attempted_max_vertex_movement: None,
        moved_vertices: 0,
        attempted_moved_vertices: 0,
        evaluations: None,
        trace: ExactSolveTraceSummary::default(),
    }
}

fn exact_solve_summary(exact: &ExactSolvedGraph, seconds: f64) -> ExactSolveSummary {
    ExactSolveSummary {
        status: exact_status_label(exact.status).to_owned(),
        seconds: round3(seconds),
        accepted: exact
            .movement_report
            .get("accepted")
            .and_then(Value::as_bool),
        rejection_reasons: exact
            .movement_report
            .get("rejection_reasons")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        initial_objective: json_f64(&exact.movement_report, "initial_objective"),
        final_objective: json_f64(&exact.movement_report, "final_objective"),
        candidate_objective: json_f64(&exact.movement_report, "candidate_objective"),
        max_vertex_movement: json_f64(&exact.movement_report, "max_vertex_movement"),
        attempted_max_vertex_movement: json_f64(
            &exact.movement_report,
            "attempted_max_vertex_movement",
        ),
        moved_vertices: exact
            .movement_report
            .get("moved_vertices")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        attempted_moved_vertices: exact
            .movement_report
            .get("attempted_moved_vertices")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        evaluations: exact
            .movement_report
            .get("evaluations")
            .and_then(Value::as_u64)
            .map(|value| value as usize),
        trace: ExactSolveTraceSummary {
            parameter_count: json_usize_path(&exact.movement_report, &["trace", "parameter_count"]),
            residual_count: json_usize_path(&exact.movement_report, &["trace", "residual_count"]),
            carrier_groups: json_usize_path(&exact.movement_report, &["trace", "carrier_groups"]),
            residual_vector_evaluations: json_usize_path(
                &exact.movement_report,
                &["trace", "counters", "residual_vector_evaluations"],
            ),
            jacobian_calls: json_usize_path(
                &exact.movement_report,
                &["trace", "counters", "jacobian_calls"],
            ),
            finite_difference_columns: json_usize_path(
                &exact.movement_report,
                &["trace", "counters", "finite_difference_columns"],
            ),
        },
    }
}

fn exact_status_label(status: ExactSolvedGraphStatus) -> &'static str {
    match status {
        ExactSolvedGraphStatus::Solved => "solved",
        ExactSolvedGraphStatus::Ambiguous => "ambiguous",
        ExactSolvedGraphStatus::Failed => "failed",
    }
}

fn add_output(
    aggregates: &mut BTreeMap<String, ImplementationAggregate>,
    name: &str,
    metrics: &OutputMetrics,
    exact: Option<&ExactSolveSummary>,
) {
    let aggregate = aggregates.entry(name.to_owned()).or_default();
    aggregate.samples += 1;
    aggregate.vertices += metrics.vertices;
    aggregate.edges += metrics.edges;
    aggregate.edge_metrics += metrics.edge_metrics;
    aggregate.border_metrics += metrics.border_metrics;
    aggregate.assignment_metrics += metrics.assignment_metrics;
    aggregate.strict_topology.add(&metrics.strict_topology);
    aggregate.structural.add(metrics.structural);
    aggregate.verification.add(&metrics.verification);
    if let Some(exact) = exact {
        aggregate.exact.add(exact);
    }
}

fn aggregate_timing(rows: &[BenchmarkSample]) -> BenchmarkTimingAggregate {
    if rows.is_empty() {
        return BenchmarkTimingAggregate::default();
    }
    let mut aggregate = BenchmarkTimingAggregate::default();
    for row in rows {
        let timing = row.timing;
        aggregate.sample_total_seconds += timing.total_seconds;
        aggregate.max_sample_seconds = aggregate.max_sample_seconds.max(timing.total_seconds);
        aggregate.read_logits_seconds += timing.read_logits_seconds;
        aggregate.legacy_decode_seconds += timing.legacy_decode_seconds;
        aggregate.weak_decode_seconds += timing.weak_decode_seconds;
        aggregate.candidate_adapter_seconds += timing.candidate_adapter_seconds;
        aggregate.selection_seconds += timing.selection_seconds;
        aggregate.exact_solve_seconds += timing.exact_solve_seconds;
        aggregate.metrics_seconds += timing.metrics_seconds;
    }
    aggregate.sample_total_seconds = round3(aggregate.sample_total_seconds);
    aggregate.mean_sample_seconds = round3(aggregate.sample_total_seconds / rows.len() as f64);
    aggregate.max_sample_seconds = round3(aggregate.max_sample_seconds);
    aggregate.read_logits_seconds = round3(aggregate.read_logits_seconds);
    aggregate.legacy_decode_seconds = round3(aggregate.legacy_decode_seconds);
    aggregate.weak_decode_seconds = round3(aggregate.weak_decode_seconds);
    aggregate.candidate_adapter_seconds = round3(aggregate.candidate_adapter_seconds);
    aggregate.selection_seconds = round3(aggregate.selection_seconds);
    aggregate.exact_solve_seconds = round3(aggregate.exact_solve_seconds);
    aggregate.metrics_seconds = round3(aggregate.metrics_seconds);
    aggregate
}

fn segment_metrics(
    predicted: &[SegmentPx],
    ground_truth: &[SegmentPx],
    tolerance_px: f64,
) -> SegmentMetrics {
    let mut matched_gt = vec![false; ground_truth.len()];
    let mut metrics = SegmentMetrics::default();
    for predicted in predicted {
        let (best_index, best_distance) = best_match(predicted, ground_truth, &matched_gt);
        if best_distance <= tolerance_px {
            if let Some(index) = best_index {
                matched_gt[index] = true;
                metrics.true_positive += 1;
            }
        } else {
            metrics.false_positive += 1;
        }
    }
    metrics.false_negative = ground_truth.len().saturating_sub(metrics.true_positive);
    metrics.finalize();
    metrics
}

fn assignment_metrics(
    predicted: &[SegmentPx],
    ground_truth: &[SegmentPx],
    tolerance_px: f64,
) -> AssignmentMetrics {
    let mut matched_gt = vec![false; ground_truth.len()];
    let mut metrics = AssignmentMetrics::default();
    for predicted in predicted {
        let (best_index, best_distance) = best_match(predicted, ground_truth, &matched_gt);
        if best_distance <= tolerance_px
            && let Some(index) = best_index
        {
            matched_gt[index] = true;
            metrics.matched += 1;
            if predicted.assignment == ground_truth[index].assignment {
                metrics.correct += 1;
            } else {
                metrics.incorrect += 1;
            }
        }
    }
    metrics.finalize();
    metrics
}

fn best_match(
    predicted: &SegmentPx,
    ground_truth: &[SegmentPx],
    matched_gt: &[bool],
) -> (Option<usize>, f64) {
    let mut best = None;
    let mut best_distance = f64::INFINITY;
    for (index, gt) in ground_truth.iter().enumerate() {
        if matched_gt[index] {
            continue;
        }
        let distance = segment_endpoint_distance(*predicted, *gt);
        if distance < best_distance {
            best = Some(index);
            best_distance = distance;
        }
    }
    (best, best_distance)
}

fn filter_assignment(segments: &[SegmentPx], assignment: AssignmentLabel) -> Vec<SegmentPx> {
    segments
        .iter()
        .copied()
        .filter(|segment| segment.assignment == assignment)
        .collect()
}

fn structural_metrics(doc: &GraphDoc) -> StructuralMetrics {
    let mut incident = vec![Vec::<IncidentRay>::new(); doc.vertices.len()];
    let mut theorem_excluded_vertices = BTreeSet::<usize>::new();
    for (edge_index, edge) in doc.edges.iter().enumerate() {
        if doc
            .boundary_roles
            .get(edge_index)
            .copied()
            .unwrap_or(CandidateCreaseBoundaryRole::None)
            != CandidateCreaseBoundaryRole::None
        {
            theorem_excluded_vertices.insert(edge[0]);
            theorem_excluded_vertices.insert(edge[1]);
            continue;
        }
        let assignment = doc
            .assignments
            .get(edge_index)
            .copied()
            .unwrap_or(AssignmentLabel::Unknown);
        if matches!(
            assignment,
            AssignmentLabel::Boundary | AssignmentLabel::Flat
        ) {
            continue;
        }
        let Some(a) = doc.vertices.get(edge[0]).copied() else {
            continue;
        };
        let Some(b) = doc.vertices.get(edge[1]).copied() else {
            continue;
        };
        incident[edge[0]].push(IncidentRay {
            angle: angle_radians(a, b),
            assignment,
        });
        incident[edge[1]].push(IncidentRay {
            angle: angle_radians(b, a),
            assignment,
        });
    }

    let mut metrics = StructuralMetrics::default();
    for (vertex_id, point) in doc.vertices.iter().enumerate() {
        if is_boundary_point(*point) || theorem_excluded_vertices.contains(&vertex_id) {
            continue;
        }
        metrics.interior_vertices += 1;
        let mut rays = incident[vertex_id].clone();
        let degree = rays.len();
        if degree == 0 {
            continue;
        }
        if degree == 2 {
            metrics.degree_two_vertices += 1;
        }
        if degree % 2 == 1 {
            metrics.odd_degree_vertices += 1;
        }
        let mountain = rays
            .iter()
            .filter(|ray| ray.assignment == AssignmentLabel::Mountain)
            .count();
        let valley = rays
            .iter()
            .filter(|ray| ray.assignment == AssignmentLabel::Valley)
            .count();
        let unknown = rays
            .iter()
            .filter(|ray| ray.assignment == AssignmentLabel::Unknown)
            .count();
        if unknown == 0 && mountain.abs_diff(valley) != 2 {
            metrics.maekawa_failures += 1;
        }
        if degree >= 4 && degree.is_multiple_of(2) {
            rays.sort_by(|left, right| left.angle.total_cmp(&right.angle));
            metrics.eligible_kawasaki_vertices += 1;
            metrics.max_kawasaki_residual_degrees = metrics
                .max_kawasaki_residual_degrees
                .max(signed_kawasaki_residual_radians(&rays).abs().to_degrees());
        }
    }

    metrics.degenerate_edges = doc
        .edges
        .iter()
        .filter(|edge| {
            let Some(a) = doc.vertices.get(edge[0]).copied() else {
                return true;
            };
            let Some(b) = doc.vertices.get(edge[1]).copied() else {
                return true;
            };
            distance(a, b) < 1e-6
        })
        .count();
    metrics.unmodeled_crossings = crossing_count(doc);
    metrics.boundary_failures = boundary_failure_count(doc);
    metrics
}

#[derive(Debug, Clone, Copy)]
struct IncidentRay {
    angle: f64,
    assignment: AssignmentLabel,
}

fn crossing_count(doc: &GraphDoc) -> usize {
    let mut count = 0;
    for (left_index, left) in doc.edges.iter().enumerate() {
        for right in doc.edges.iter().skip(left_index + 1) {
            if shares_vertex(*left, *right) {
                continue;
            }
            let Some(a) = doc.vertices.get(left[0]).copied() else {
                continue;
            };
            let Some(b) = doc.vertices.get(left[1]).copied() else {
                continue;
            };
            let Some(c) = doc.vertices.get(right[0]).copied() else {
                continue;
            };
            let Some(d) = doc.vertices.get(right[1]).copied() else {
                continue;
            };
            if segments_intersect_strict(a, b, c, d) {
                count += 1;
            }
        }
    }
    count
}

fn boundary_failure_count(doc: &GraphDoc) -> usize {
    let outside_vertices = doc
        .vertices
        .iter()
        .filter(|point| {
            point.x < -1e-6 || point.x > 1.0 + 1e-6 || point.y < -1e-6 || point.y > 1.0 + 1e-6
        })
        .count();
    let boundary_edges_off_frame = doc
        .edges
        .iter()
        .enumerate()
        .filter(|(index, edge)| {
            doc.assignments.get(*index).copied() == Some(AssignmentLabel::Boundary)
                && edge.iter().any(|vertex_id| {
                    doc.vertices
                        .get(*vertex_id)
                        .is_none_or(|point| !is_boundary_point(*point))
                })
        })
        .count();
    outside_vertices + boundary_edges_off_frame
}

fn segments_intersect_strict(a: Point2, b: Point2, c: Point2, d: Point2) -> bool {
    let o1 = orient(a, b, c);
    let o2 = orient(a, b, d);
    let o3 = orient(c, d, a);
    let o4 = orient(c, d, b);
    o1.abs() > 1e-9
        && o2.abs() > 1e-9
        && o3.abs() > 1e-9
        && o4.abs() > 1e-9
        && (o1 > 0.0) != (o2 > 0.0)
        && (o3 > 0.0) != (o4 > 0.0)
}

fn orient(a: Point2, b: Point2, c: Point2) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

fn shares_vertex(left: [usize; 2], right: [usize; 2]) -> bool {
    left[0] == right[0] || left[0] == right[1] || left[1] == right[0] || left[1] == right[1]
}

fn signed_kawasaki_residual_radians(rays: &[IncidentRay]) -> f64 {
    let mut odd_sum = 0.0;
    let mut even_sum = 0.0;
    for index in 0..rays.len() {
        let next = (index + 1) % rays.len();
        let sector = (rays[next].angle - rays[index].angle).rem_euclid(std::f64::consts::TAU);
        if index % 2 == 0 {
            odd_sum += sector;
        } else {
            even_sum += sector;
        }
    }
    odd_sum - even_sum
}

fn write_reports(
    out: &Path,
    summary: &BenchmarkSummary,
    rows: &[BenchmarkSample],
) -> Result<(), Box<dyn std::error::Error>> {
    fs::write(
        out.join("summary.json"),
        serde_json::to_string_pretty(summary)? + "\n",
    )?;
    let mut per_sample = String::new();
    for row in rows {
        per_sample.push_str(&serde_json::to_string(row)?);
        per_sample.push('\n');
    }
    fs::write(out.join("per_sample.jsonl"), per_sample)?;
    let regressions = regression_lines(rows)?;
    fs::write(out.join("regressions.jsonl"), regressions)?;
    fs::write(out.join("summary.md"), summary_markdown(summary))?;
    fs::write(out.join("README.md"), report_readme(summary))?;
    Ok(())
}

fn regression_lines(rows: &[BenchmarkSample]) -> Result<String, serde_json::Error> {
    let mut lines = String::new();
    for row in rows {
        push_regression(
            &mut lines,
            &row.id,
            "selected_vs_legacy_edge_f1",
            row.legacy.edge_metrics.f1,
            row.selected.edge_metrics.f1,
        )?;
        push_regression(
            &mut lines,
            &row.id,
            "exact_vs_selected_edge_f1",
            row.selected.edge_metrics.f1,
            row.exact_solved.edge_metrics.f1,
        )?;
        push_regression(
            &mut lines,
            &row.id,
            "exact_vs_selected_border_f1",
            row.selected.border_metrics.f1,
            row.exact_solved.border_metrics.f1,
        )?;
        if row.exact_solved.verification.camv_violations > row.selected.verification.camv_violations
        {
            lines.push_str(&serde_json::to_string(&json!({
                "sample_id": row.id,
                "metric": "exact_vs_selected_camv_violations",
                "before": row.selected.verification.camv_violations,
                "after": row.exact_solved.verification.camv_violations,
            }))?);
            lines.push('\n');
        }
        if row.selected.verification.flat_folder_solved
            && !row.exact_solved.verification.flat_folder_solved
        {
            lines.push_str(&serde_json::to_string(&json!({
                "sample_id": row.id,
                "metric": "exact_vs_selected_flat_folder_solved",
                "before": true,
                "after": false,
                "error_kind": row.exact_solved.verification.flat_folder_error_kind,
            }))?);
            lines.push('\n');
        }
    }
    Ok(lines)
}

fn push_regression(
    lines: &mut String,
    sample_id: &str,
    metric: &str,
    before: f64,
    after: f64,
) -> Result<(), serde_json::Error> {
    if after + 0.001 < before {
        lines.push_str(&serde_json::to_string(&json!({
            "sample_id": sample_id,
            "metric": metric,
            "before": round6(before),
            "after": round6(after),
            "delta": round6(after - before),
        }))?);
        lines.push('\n');
    }
    Ok(())
}

fn summary_markdown(summary: &BenchmarkSummary) -> String {
    let mut out = String::new();
    out.push_str("# Exact Solve Comparison\n\n");
    out.push_str(&format!(
        "- Samples: {}\n- Total seconds: {:.3}\n- Dense manifest: `{}`\n- Git commit: `{}`\n\n",
        summary.sample_count,
        summary.total_seconds,
        summary.dense_manifest,
        summary.git_commit.as_deref().unwrap_or("unknown")
    ));
    out.push_str("| Implementation | Edge F1 | Strict edge F1 | Exact topology | Exact topology + assignments | Border F1 | Assignment Acc | CAMV | Flat-folder solved | Exact accepted | LM evals | Residual evals | Params | Residuals | Degree-2 | Odd | Max Kawasaki |\n");
    out.push_str(
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n",
    );
    for (name, aggregate) in &summary.implementations {
        out.push_str(&format!(
            "| {} | {:.4} | {:.4} | {}/{} | {}/{} | {:.4} | {:.4} | {} | {}/{} | {}/{} | {} | {} | {} | {} | {} | {} | {:.4} |\n",
            name,
            aggregate.edge_metrics.f1,
            aggregate.strict_topology.edges.f1,
            aggregate.strict_topology.exact_topology_samples,
            aggregate.strict_topology.samples,
            aggregate
                .strict_topology
                .exact_topology_and_assignment_samples,
            aggregate.strict_topology.samples,
            aggregate.border_metrics.f1,
            aggregate.assignment_metrics.accuracy,
            aggregate.verification.camv_violations,
            aggregate.verification.flat_folder_solved,
            aggregate.samples,
            aggregate.exact.accepted,
            aggregate.exact.attempted,
            aggregate.exact.evaluations,
            aggregate.exact.residual_vector_evaluations,
            aggregate.exact.max_parameter_count,
            aggregate.exact.max_residual_count,
            aggregate.structural.degree_two_vertices,
            aggregate.structural.odd_degree_vertices,
            aggregate.structural.max_kawasaki_residual_degrees,
        ));
    }
    out
}

fn report_readme(summary: &BenchmarkSummary) -> String {
    format!(
        "# {}\n\nGenerated by `compare_exact_solve_benchmark`.\n\nThis directory compares frozen legacy decode, Stage 5 selected graph, and Stage 6 exact-solved graph from the same dense cache.\n\nFiles:\n\n- `summary.json`: aggregate machine-readable metrics, including `strict_topology` from `oristudio-cp-eval`.\n- `summary.md`: human-readable aggregate table.\n- `per_sample.jsonl`: one full metrics record per sample.\n- `regressions.jsonl`: metric regressions detected by the benchmark.\n\nStrict topology is the tight graph-isomorphism-style metric: predicted vertices must match GT vertices within `strict_vertex_tolerance_px`, predicted endpoint pairs must exactly correspond to GT edges, and assignments must match on those strict edges.\n\nConfig:\n\n```json\n{}\n```\n",
        SCHEMA,
        serde_json::to_string_pretty(&summary.config).unwrap_or_else(|_| "{}".to_owned())
    )
}

fn required_value(
    iter: &mut impl Iterator<Item = String>,
    name: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    iter.next()
        .ok_or_else(|| format!("{name} requires a value").into())
}

fn parse_junction_evidence_source(
    value: &str,
) -> Result<JunctionEvidenceSource, Box<dyn std::error::Error>> {
    match value {
        "model" => Ok(JunctionEvidenceSource::Model),
        "line-arrangement" | "line_arrangement" => Ok(JunctionEvidenceSource::LineArrangement),
        _ => Err(
            "--junction-evidence-source must be 'model', 'line-arrangement', or 'ground-truth'"
                .into(),
        ),
    }
}

fn junction_evidence_source_label(
    source: JunctionEvidenceSource,
    gt_junction_labels: bool,
) -> &'static str {
    if gt_junction_labels {
        return "ground-truth";
    }
    match source {
        JunctionEvidenceSource::Model => "model",
        JunctionEvidenceSource::LineArrangement => "line-arrangement",
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

fn read_optional_f32_file(
    root: &Path,
    path: Option<&str>,
) -> Result<Option<Vec<f32>>, Box<dyn std::error::Error>> {
    path.map(|path| read_f32_file(&resolve_path(root, path)))
        .transpose()
}

fn resolve_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn resolve_pack_path(manifest_root: &Path, pack: Option<&str>, value: &str) -> PathBuf {
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

fn point_segment_distance(point: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let ab = [b[0] - a[0], b[1] - a[1]];
    let length_sq = ab[0] * ab[0] + ab[1] * ab[1];
    if length_sq <= f64::EPSILON {
        return point_distance(point, a);
    }
    let ap = [point[0] - a[0], point[1] - a[1]];
    let t = ((ap[0] * ab[0] + ap[1] * ab[1]) / length_sq).clamp(0.0, 1.0);
    point_distance(point, [a[0] + t * ab[0], a[1] + t * ab[1]])
}

/// Oracle selection: the GT-optimal subset of the *generated* candidate pool.
/// A candidate is kept iff its whole pixel span lies on GT creases (every sampled
/// point within `tolerance` of some GT segment), so it can contribute to exact
/// topology; spurious / off-line candidates are dropped. This isolates beam
/// scoring — residual failures are then missing candidates (recall) or geometry,
/// not selection. The exact solver / canonicalizing metric handle merge/split.
fn oracle_selected_span_ids(
    candidate_graph: &CandidateGraph,
    gt_segments: &[SegmentPx],
    image_size: u32,
    tolerance: f64,
) -> Vec<usize> {
    const SAMPLES: usize = 9;
    candidate_graph
        .crease_candidates
        .iter()
        .filter_map(|span| {
            let a = candidate_graph.vertices.get(span.vertices[0])?;
            let b = candidate_graph.vertices.get(span.vertices[1])?;
            let pa = normalized_to_px(a.point, image_size);
            let pb = normalized_to_px(b.point, image_size);
            let supported = (0..=SAMPLES).all(|i| {
                let t = i as f64 / SAMPLES as f64;
                let p = [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])];
                gt_segments
                    .iter()
                    .any(|seg| point_segment_distance(p, seg.a, seg.b) <= tolerance)
            });
            supported.then_some(span.id)
        })
        .collect()
}

fn distance(left: Point2, right: Point2) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
}

fn angle_radians(from: Point2, to: Point2) -> f64 {
    (to.y - from.y).atan2(to.x - from.x)
}

fn is_boundary_point(point: Point2) -> bool {
    point.x.abs() <= 1e-6
        || (point.x - 1.0).abs() <= 1e-6
        || point.y.abs() <= 1e-6
        || (point.y - 1.0).abs() <= 1e-6
}

fn parse_assignment(value: &str) -> AssignmentLabel {
    match value {
        "M" | "m" | "mountain" => AssignmentLabel::Mountain,
        "V" | "v" | "valley" => AssignmentLabel::Valley,
        "B" | "b" | "boundary" => AssignmentLabel::Boundary,
        "F" | "f" | "flat" => AssignmentLabel::Flat,
        _ => AssignmentLabel::Unknown,
    }
}

fn parse_assignment_value(value: &Value) -> AssignmentLabel {
    if let Some(label) = value.as_str() {
        return parse_assignment(label);
    }
    match value.as_i64() {
        Some(0) => AssignmentLabel::Mountain,
        Some(1) => AssignmentLabel::Valley,
        Some(2) => AssignmentLabel::Boundary,
        Some(3) => AssignmentLabel::Flat,
        _ => AssignmentLabel::Unknown,
    }
}

fn eval_assignment(label: AssignmentLabel) -> EvalAssignment {
    match label {
        AssignmentLabel::Mountain => EvalAssignment::Mountain,
        AssignmentLabel::Valley => EvalAssignment::Valley,
        AssignmentLabel::Boundary => EvalAssignment::Boundary,
        AssignmentLabel::Flat => EvalAssignment::Auxiliary,
        AssignmentLabel::Unknown => EvalAssignment::Unknown,
    }
}

fn eval_boundary_role(role: CandidateCreaseBoundaryRole) -> EvalBoundaryRole {
    match role {
        CandidateCreaseBoundaryRole::None => EvalBoundaryRole::None,
        CandidateCreaseBoundaryRole::PaperBoundary => EvalBoundaryRole::PaperBoundary,
        CandidateCreaseBoundaryRole::CutBoundary => EvalBoundaryRole::CutBoundary,
    }
}

/// Pixel-space `EvalGraph` over the whole candidate pool (every crease
/// candidate), for the candidate-recall diff: GT creases the pool does not cover
/// are detector misses, independent of what selection later keeps.
fn candidate_eval_graph(candidate_graph: &CandidateGraph, image_size: u32) -> EvalGraph {
    let vertices = candidate_graph
        .vertices
        .iter()
        .map(|vertex| EvalPoint::from(normalized_to_px(vertex.point, image_size)))
        .collect::<Vec<_>>();
    let edges = candidate_graph
        .crease_candidates
        .iter()
        .map(|span| {
            EvalEdge::new(
                span.vertices,
                eval_assignment(span.assignment_evidence.observed_label),
            )
            .with_boundary_role(eval_boundary_role(span.boundary_role))
        })
        .collect::<Vec<_>>();
    EvalGraph::new(vertices, edges)
}

/// Attribute lost GT creases to a pipeline stage by comparing the canonicalized
/// candidate-pool and selected-graph topologies against GT.
fn failure_attribution(
    candidate_graph: &CandidateGraph,
    selected_topology: &StrictTopologyMetrics,
    gt_eval_graph: &EvalGraph,
    image_size: u32,
    strict_vertex_tolerance_px: f64,
) -> FailureAttribution {
    let candidate_topology = strict_topology_metrics(
        &candidate_eval_graph(candidate_graph, image_size),
        gt_eval_graph,
        StrictTopologyOptions {
            vertex_tolerance: strict_vertex_tolerance_px,
            split_merge_tolerance: strict_vertex_tolerance_px,
            compare_assignments: true,
        },
    );
    let gt_edges = selected_topology.edges.gt_edges;
    let detector_miss = candidate_topology.edges.missing_edges;
    let selected_missing = selected_topology.edges.missing_edges;
    // A subset selection can only miss at least as many GT creases as the full
    // pool; the extra missing are creases the pool had but selection dropped.
    let selection_miss = selected_missing.saturating_sub(detector_miss);
    FailureAttribution {
        gt_edges,
        candidate_pool: candidate_graph.crease_candidates.len(),
        recovered: gt_edges.saturating_sub(selected_missing),
        detector_miss,
        selection_miss,
        assignment_wrong: selected_topology.assignments.wrong_edges,
        spurious: selected_topology.edges.extra_edges,
        unmatched_pred_vertices: selected_topology.vertices.unmatched_predicted_vertices,
        unmatched_gt_vertices: selected_topology.vertices.unmatched_gt_vertices,
        exact_topology: selected_topology.exact_topology,
        exact_topology_and_assignment: selected_topology.exact_topology_and_assignment,
    }
}

fn assignment_code(label: AssignmentLabel) -> &'static str {
    match label {
        AssignmentLabel::Mountain => "M",
        AssignmentLabel::Valley => "V",
        AssignmentLabel::Boundary => "B",
        AssignmentLabel::Flat => "F",
        AssignmentLabel::Unknown => "U",
    }
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        numerator as f64 / denominator as f64
    }
}

fn json_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn json_usize_path(value: &Value, path: &[&str]) -> Option<usize> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_u64().map(|value| value as usize)
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn git_commit() -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn round6(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

fn print_usage() {
    println!(
        "compare_exact_solve_benchmark --out DIR [--dense-manifest PATH] [--candidate-source legacy] [--line-evidence-source model|source-image] [--junction-evidence-source model|line-arrangement|ground-truth] [--oracle-junction-labels] [--oracle-vertices] [--threshold T] [--legacy-low-threshold T] [--exact-patience N] [--exact-solve-timeout-seconds S] [--limit N] [--match-tolerance-px PX] [--strict-vertex-tolerance-px PX] [--skip-flat-folder] [--skip-exact-solve] [--exact-solve-any-topology] [--oracle-selection]"
    );
    println!(
        "  exact solve is gated on correct topology by default (wrong topology cannot reconstruct the right CP, so it is skipped and marked failed); --exact-solve-any-topology attempts it regardless."
    );
    println!(
        "Samples run in parallel across the rayon thread pool. Exact-solve timeout defaults to {BENCHMARK_DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS}s (benchmark-only; product uses {}s). For fast topology iteration pass --skip-exact-solve.",
        oristudio_cp_compiler::DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn point_segment_distance_projects_and_clamps() {
        // Perpendicular foot inside the segment.
        let d = point_segment_distance([5.0, 3.0], [0.0, 0.0], [10.0, 0.0]);
        assert!((d - 3.0).abs() < 1e-9);
        // Beyond an endpoint clamps to that endpoint.
        let d = point_segment_distance([-4.0, 0.0], [0.0, 0.0], [10.0, 0.0]);
        assert!((d - 4.0).abs() < 1e-9);
        // Degenerate (zero-length) segment falls back to point distance.
        let d = point_segment_distance([3.0, 4.0], [0.0, 0.0], [0.0, 0.0]);
        assert!((d - 5.0).abs() < 1e-9);
    }
}
