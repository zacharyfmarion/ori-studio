use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use image::ImageReader;
use oristudio_cp_compiler::candidate_graph::{CandidateCreaseSpanKind, CandidateGraph};
use oristudio_cp_compiler::selection::{
    SelectionOptions, SelectionSpanKind, select_candidate_graph_beam_from_ir,
};
use oristudio_cp_compiler::{
    AssignmentLabel, ExactSolveInput, ExactSolveOptions, ExactSolvedGraphStatus, Point2,
    SelectedGraph, solve_exact,
};
use oristudio_cp_detect::raster_candidate_generation::{
    RasterCandidateGenerationContext, RasterCandidateGenerationDiagnostics,
    RasterCandidateGenerationOptions, RasterCandidateGenerationStrategyName,
    RasterCarrierV1Options, generate_raster_candidate_graph,
};
use oristudio_cp_detect::raster_evidence::{
    RasterEvidence, RasterEvidenceConfig, extract_raster_evidence_from_rgba,
};
use oristudio_cp_eval::{
    CandidateCoverageAggregate, CandidateCoverageOptions, CandidateCoverageReport,
    CoverageCandidate, CoverageCandidateSet, CoverageCarrier, CoverageDenseEvidence,
    CoverageRootCause, EvalAssignment, EvalEdge, EvalGraph, EvalPoint, candidate_coverage_metrics,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SCHEMA: &str = "oristudio/cp-detect-raster-candidate-coverage-benchmark/v1";
const DEFAULT_PACK_MANIFEST: &str =
    "artifacts/cp-detect-correctness/packs/clean-1024-s15/manifest.json";

#[derive(Debug, Deserialize)]
struct CorrectnessPackManifest {
    schema: Option<String>,
    #[serde(default)]
    tier: Option<String>,
    #[serde(default)]
    profiles: Vec<String>,
    samples: Vec<CorrectnessPackSample>,
}

#[derive(Debug, Deserialize)]
struct CorrectnessPackSample {
    id: String,
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    profile: Option<String>,
    image_size: u32,
    input_png: String,
    gt_graph: String,
}

#[derive(Debug, Deserialize)]
struct GroundTruthGraph {
    vertices_px: Vec<[f64; 2]>,
    edges_vertices: Vec<[usize; 2]>,
    #[serde(default)]
    edges_assignment_labels: Vec<Value>,
    #[serde(default)]
    edges_assignment: Vec<Value>,
}

impl GroundTruthGraph {
    fn eval_graph(&self) -> EvalGraph {
        let assignments = if self.edges_assignment_labels.is_empty() {
            &self.edges_assignment
        } else {
            &self.edges_assignment_labels
        };
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
                    assignments
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

#[derive(Debug)]
struct Args {
    pack_manifest: PathBuf,
    out: PathBuf,
    strategy: RasterCandidateGenerationStrategyName,
    limit: Option<usize>,
    line_threshold: Option<f32>,
    include_boundary_edges: bool,
    skip_exact_solve: bool,
    exact_patience: Option<usize>,
    carrier_options: RasterCarrierV1Options,
    coverage_options: CandidateCoverageOptions,
}

#[derive(Debug, Serialize)]
struct BenchmarkSummary {
    schema: &'static str,
    generated_by: &'static str,
    generated_at_unix: u64,
    git_commit: Option<String>,
    pack_manifest: String,
    pack_schema: Option<String>,
    tier: Option<String>,
    profiles: Vec<String>,
    config: BenchmarkConfig,
    sample_count: usize,
    total_seconds: f64,
    raster_diagnostics: RasterDiagnosticAggregate,
    strategy_diagnostics: StrategyDiagnosticAggregate,
    exact_solve: ExactSolveAggregate,
    aggregate: CandidateCoverageAggregate,
    top_root_causes: Vec<RootCauseCount>,
    worst_samples: Vec<WorstSample>,
}

#[derive(Debug, Serialize)]
struct BenchmarkConfig {
    strategy: String,
    raster_evidence: RasterEvidenceConfig,
    raster_carrier_v1: RasterCarrierV1Options,
    include_boundary_edges: bool,
    exact_solve_enabled: bool,
    exact_patience: Option<usize>,
    coverage_options: CandidateCoverageOptions,
}

#[derive(Debug, Serialize)]
struct RootCauseCount {
    root_cause: CoverageRootCause,
    count: usize,
}

#[derive(Debug, Serialize)]
struct WorstSample {
    id: String,
    source_id: Option<String>,
    family: Option<String>,
    profile: Option<String>,
    evaluated_edges: usize,
    adapter_any: usize,
    selected_any: usize,
    missed_by_adapter: usize,
    missed_by_selection: usize,
    top_root_causes: Vec<RootCauseCount>,
}

#[derive(Debug, Serialize)]
struct SampleRow {
    id: String,
    source_id: Option<String>,
    family: Option<String>,
    profile: Option<String>,
    raster_report: oristudio_cp_detect::raster_evidence::RasterEvidenceReport,
    candidate_graph_report: oristudio_cp_compiler::candidate_graph::CandidateGraphReport,
    strategy_diagnostics: StrategyDiagnostics,
    exact_solve: SampleExactSolve,
    report: CandidateCoverageReport,
    timings: SampleTimings,
}

#[derive(Debug, Clone, Serialize)]
struct RasterGtEdgeDiagnostics {
    gt_length_px: f64,
    raster_line_mean: f64,
    raster_line_hit_fraction: f64,
    nearest_graph_vertex_a_px: Option<f64>,
    nearest_graph_vertex_b_px: Option<f64>,
    graph_vertices_near_gt_line: usize,
    graph_vertices_between_gt_endpoints: usize,
    relaxed_line_like_spans: usize,
    relaxed_endpoint_close_spans: usize,
    best_relaxed_span_id: Option<usize>,
    best_relaxed_span_endpoint_distance_px: Option<f64>,
    best_relaxed_span_angle_delta_degrees: Option<f64>,
    best_relaxed_span_line_distance_px: Option<f64>,
    best_relaxed_span_overlap_fraction: Option<f64>,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct RasterDiagnosticAggregate {
    foreground_pixels: usize,
    connected_components: usize,
    hough_segments: usize,
    line_primitives: usize,
    carrier_hypotheses: usize,
    vertices_from_intersections: usize,
    vertices_from_boundary_contacts: usize,
    vertices_from_endpoints: usize,
}

impl RasterDiagnosticAggregate {
    fn add(
        &mut self,
        evidence: &RasterEvidence,
        diagnostics: &RasterCandidateGenerationDiagnostics,
    ) {
        self.foreground_pixels += evidence.report.foreground_pixels;
        self.connected_components += evidence.report.connected_components;
        if let Some(carrier) = diagnostics.raster_carrier_v1.as_ref() {
            self.hough_segments += carrier.hough_segments;
            self.line_primitives += carrier.line_primitives;
            self.carrier_hypotheses += carrier.carrier_hypotheses.len();
            self.vertices_from_intersections += carrier.vertices_from_intersections;
            self.vertices_from_boundary_contacts += carrier.vertices_from_boundary_contacts;
            self.vertices_from_endpoints += carrier.vertices_from_endpoints;
        }
    }
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct StrategyDiagnosticAggregate {
    candidate_normalized_pass_through_spans: usize,
    selected_normalized_pass_through_spans: usize,
    candidate_collapsed_vertices: usize,
    selected_collapsed_vertices: usize,
    selected_weak_spans: usize,
}

impl StrategyDiagnosticAggregate {
    fn add(&mut self, sample: StrategyDiagnostics) {
        self.candidate_normalized_pass_through_spans +=
            sample.candidate_normalized_pass_through_spans;
        self.selected_normalized_pass_through_spans +=
            sample.selected_normalized_pass_through_spans;
        self.candidate_collapsed_vertices += sample.candidate_collapsed_vertices;
        self.selected_collapsed_vertices += sample.selected_collapsed_vertices;
        self.selected_weak_spans += sample.selected_weak_spans;
    }
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct StrategyDiagnostics {
    candidate_normalized_pass_through_spans: usize,
    selected_normalized_pass_through_spans: usize,
    candidate_collapsed_vertices: usize,
    selected_collapsed_vertices: usize,
    selected_weak_spans: usize,
}

impl StrategyDiagnostics {
    fn from_graph_selection(
        graph: &CandidateGraph,
        selection: &oristudio_cp_compiler::selection::CandidateSelection,
    ) -> Self {
        Self {
            candidate_normalized_pass_through_spans: graph
                .crease_candidates
                .iter()
                .filter(|span| span.kind == CandidateCreaseSpanKind::NormalizedPassThroughSpan)
                .count(),
            selected_normalized_pass_through_spans: selection
                .selected_spans
                .iter()
                .filter(|span| span.kind == SelectionSpanKind::NormalizedPassThroughSpan)
                .count(),
            candidate_collapsed_vertices: graph
                .crease_candidates
                .iter()
                .map(|span| span.collapsed_vertex_ids.len())
                .sum(),
            selected_collapsed_vertices: selection
                .selected_spans
                .iter()
                .map(|span| span.collapsed_vertex_ids.len())
                .sum(),
            selected_weak_spans: selection.report.weak_edges_promoted,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct ExactSolveAggregate {
    enabled: bool,
    solved: usize,
    ambiguous: usize,
    failed: usize,
    skipped: usize,
    total_seconds: f64,
}

impl ExactSolveAggregate {
    fn add(&mut self, sample: SampleExactSolve) {
        self.enabled |= sample.enabled;
        self.total_seconds += sample.seconds;
        match sample.status.as_deref() {
            Some("solved") => self.solved += 1,
            Some("ambiguous") => self.ambiguous += 1,
            Some("failed") => self.failed += 1,
            _ => self.skipped += 1,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize)]
struct SampleExactSolve {
    enabled: bool,
    status: Option<String>,
    seconds: f64,
    selected_spans: usize,
    selected_vertices: usize,
    exact_edges: usize,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct SampleTimings {
    read_image_seconds: f64,
    raster_evidence_seconds: f64,
    strategy_generation_seconds: f64,
    selection_seconds: f64,
    exact_solve_seconds: f64,
    metrics_seconds: f64,
    total_seconds: f64,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let started = Instant::now();
    let pack_path = args.pack_manifest.canonicalize()?;
    let pack_root = pack_path.parent().unwrap_or_else(|| Path::new("."));
    let manifest: CorrectnessPackManifest = serde_json::from_str(&fs::read_to_string(&pack_path)?)?;
    fs::create_dir_all(&args.out)?;

    let mut aggregate = CandidateCoverageAggregate::default();
    let mut raster_diagnostics = RasterDiagnosticAggregate::default();
    let mut strategy_diagnostics = StrategyDiagnosticAggregate::default();
    let mut exact_solve = ExactSolveAggregate::default();
    let per_sample_path = args.out.join("per_sample.jsonl");
    let per_gt_edge_path = args.out.join("per_gt_edge.jsonl");
    let mut per_sample = fs::File::create(&per_sample_path)?;
    let mut per_gt_edge = fs::File::create(&per_gt_edge_path)?;
    let mut sample_rows = Vec::new();

    for sample in manifest
        .samples
        .iter()
        .take(args.limit.unwrap_or(usize::MAX))
    {
        let sample_started = Instant::now();
        let read_image_started = Instant::now();
        let image_path = resolve_path(pack_root, &sample.input_png);
        let image = ImageReader::open(&image_path)?.decode()?.to_rgba8();
        let (width, height) = image.dimensions();
        let rgba = image.into_raw();
        let read_image_seconds = read_image_started.elapsed().as_secs_f64();

        let evidence_started = Instant::now();
        let evidence_config = evidence_config(sample.image_size, args.line_threshold);
        let evidence = extract_raster_evidence_from_rgba(&rgba, width, height, evidence_config)?;
        let raster_evidence_seconds = evidence_started.elapsed().as_secs_f64();

        let generation_started = Instant::now();
        let generation = generate_raster_candidate_graph(
            RasterCandidateGenerationContext {
                evidence: &evidence,
            },
            RasterCandidateGenerationOptions {
                strategy: args.strategy,
                raster_carrier_v1: args.carrier_options,
            },
        )?;
        let strategy_generation_seconds = generation_started.elapsed().as_secs_f64();
        raster_diagnostics.add(&evidence, &generation.diagnostics);
        let candidate_graph = generation.candidate_graph;

        let selection_started = Instant::now();
        let selection = select_candidate_graph_beam_from_ir(
            &candidate_graph,
            SelectionOptions::default(),
            Default::default(),
        );
        let selected_ids = selection
            .selected_spans
            .iter()
            .map(|span| span.id)
            .collect::<BTreeSet<_>>();
        let sample_strategy_diagnostics =
            StrategyDiagnostics::from_graph_selection(&candidate_graph, &selection);
        strategy_diagnostics.add(sample_strategy_diagnostics);
        let selection_seconds = selection_started.elapsed().as_secs_f64();

        let exact_started = Instant::now();
        let sample_exact = if args.skip_exact_solve {
            SampleExactSolve {
                enabled: false,
                status: None,
                seconds: 0.0,
                selected_spans: selection.selected_spans.len(),
                selected_vertices: 0,
                exact_edges: 0,
            }
        } else {
            let selected_span_ids = selection
                .selected_spans
                .iter()
                .map(|span| span.id)
                .collect::<Vec<_>>();
            let selected_graph =
                SelectedGraph::from_selected_span_ids(&candidate_graph, selected_span_ids);
            let exact_input =
                ExactSolveInput::from_candidate_selection(&candidate_graph, &selected_graph);
            let mut exact_options = ExactSolveOptions::default();
            if let Some(patience) = args.exact_patience {
                exact_options.patience = patience;
            }
            let exact = solve_exact(&exact_input, exact_options);
            SampleExactSolve {
                enabled: true,
                status: Some(exact_status_label(exact.status).to_owned()),
                seconds: exact_started.elapsed().as_secs_f64(),
                selected_spans: exact_input.selected_spans.len(),
                selected_vertices: exact_input.vertices.len(),
                exact_edges: exact.edges_exact.len(),
            }
        };
        let exact_solve_seconds = exact_started.elapsed().as_secs_f64();
        exact_solve.add(sample_exact.clone());

        let metrics_started = Instant::now();
        let gt = read_ground_truth(pack_root, sample)?;
        let gt_graph = gt.eval_graph();
        let raster_support = raster_evidence_for_gt(&gt_graph, &evidence);
        let empty_high = CoverageCandidateSet::empty("no_dense_high");
        let empty_low = CoverageCandidateSet::empty("no_dense_low");
        let adapter_set = candidate_set_from_graph(
            "raster_adapter",
            &candidate_graph,
            &selected_ids,
            false,
            sample.image_size,
        );
        let selected_set = candidate_set_from_graph(
            "raster_selected",
            &candidate_graph,
            &selected_ids,
            true,
            sample.image_size,
        );
        let report = candidate_coverage_metrics(
            &gt_graph,
            &raster_support,
            &empty_high,
            &empty_low,
            &adapter_set,
            &selected_set,
            args.coverage_options,
        );
        let metrics_seconds = metrics_started.elapsed().as_secs_f64();
        aggregate.add(&report);

        let row = SampleRow {
            id: sample.id.clone(),
            source_id: sample.source_id.clone(),
            family: sample.family.clone(),
            profile: sample.profile.clone(),
            raster_report: evidence.report.clone(),
            candidate_graph_report: candidate_graph.report.clone(),
            strategy_diagnostics: sample_strategy_diagnostics,
            exact_solve: sample_exact,
            timings: SampleTimings {
                read_image_seconds,
                raster_evidence_seconds,
                strategy_generation_seconds,
                selection_seconds,
                exact_solve_seconds,
                metrics_seconds,
                total_seconds: sample_started.elapsed().as_secs_f64(),
            },
            report,
        };
        serde_json::to_writer(&mut per_sample, &row)?;
        writeln!(per_sample)?;
        for edge in &row.report.per_gt_edge {
            let diagnostics = raster_gt_edge_diagnostics(
                &gt_graph,
                edge,
                &candidate_graph,
                &evidence,
                sample.image_size,
                args.coverage_options,
            );
            serde_json::to_writer(
                &mut per_gt_edge,
                &serde_json::json!({
                    "sample_id": row.id,
                    "source_id": row.source_id,
                    "family": row.family,
                    "profile": row.profile,
                    "edge": edge,
                    "raster_diagnostics": diagnostics,
                }),
            )?;
            writeln!(per_gt_edge)?;
        }
        sample_rows.push(row);
    }

    aggregate.finalize();
    let top_root_causes = sorted_root_causes(&aggregate.summary.root_causes);
    let worst_samples = worst_samples(&sample_rows);
    let summary = BenchmarkSummary {
        schema: SCHEMA,
        generated_by: "compare_raster_candidate_coverage",
        generated_at_unix: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
        git_commit: git_commit(),
        pack_manifest: pack_path.display().to_string(),
        pack_schema: manifest.schema,
        tier: manifest.tier,
        profiles: manifest.profiles,
        config: BenchmarkConfig {
            strategy: args.strategy.id().to_owned(),
            raster_evidence: evidence_config(
                sample_rows
                    .first()
                    .and_then(|_| manifest.samples.first().map(|sample| sample.image_size))
                    .unwrap_or(crate_default_image_size()),
                args.line_threshold,
            ),
            raster_carrier_v1: args.carrier_options,
            include_boundary_edges: args.include_boundary_edges,
            exact_solve_enabled: !args.skip_exact_solve,
            exact_patience: args.exact_patience,
            coverage_options: args.coverage_options,
        },
        sample_count: sample_rows.len(),
        total_seconds: started.elapsed().as_secs_f64(),
        raster_diagnostics,
        strategy_diagnostics,
        exact_solve,
        aggregate,
        top_root_causes,
        worst_samples,
    };

    fs::write(
        args.out.join("summary.json"),
        serde_json::to_string_pretty(&summary)? + "\n",
    )?;
    fs::write(args.out.join("summary.md"), markdown_summary(&summary))?;
    Ok(())
}

fn evidence_config(image_size: u32, line_threshold: Option<f32>) -> RasterEvidenceConfig {
    RasterEvidenceConfig {
        image_size,
        line_threshold: line_threshold.unwrap_or(RasterEvidenceConfig::default().line_threshold),
        ..RasterEvidenceConfig::default()
    }
}

fn crate_default_image_size() -> u32 {
    oristudio_cp_detect::DEFAULT_IMAGE_SIZE
}

fn candidate_set_from_graph(
    name: &str,
    graph: &CandidateGraph,
    selected_ids: &BTreeSet<usize>,
    selected_only: bool,
    image_size: u32,
) -> CoverageCandidateSet {
    let vertices = graph
        .vertices
        .iter()
        .map(|vertex| EvalPoint::from(normalized_to_px(vertex.point, image_size)))
        .collect::<Vec<_>>();
    let mut carriers = Vec::new();
    let mut candidates = Vec::new();
    for span in &graph.crease_candidates {
        let selected = selected_ids.contains(&span.id);
        if selected_only && !selected {
            continue;
        }
        let Some(a) = graph
            .vertices
            .get(span.vertices[0])
            .map(|vertex| vertex.point)
        else {
            continue;
        };
        let Some(b) = graph
            .vertices
            .get(span.vertices[1])
            .map(|vertex| vertex.point)
        else {
            continue;
        };
        let endpoints = [
            EvalPoint::from(normalized_to_px(a, image_size)),
            EvalPoint::from(normalized_to_px(b, image_size)),
        ];
        let source_kind = format!("{:?}", span.source_kind);
        candidates.push(CoverageCandidate {
            id: span.id.to_string(),
            endpoints,
            assignment: eval_assignment(span.assignment_evidence.observed_label),
            selected,
            source_kind: source_kind.clone(),
            line_support: span.line_support_mean,
        });
        carriers.push(CoverageCarrier {
            id: span.id.to_string(),
            endpoints: [
                EvalPoint::from(normalized_to_px(
                    point_on_carrier(
                        span.carrier.normal,
                        span.carrier.direction,
                        span.carrier.rho,
                        span.t_interval[0],
                    ),
                    image_size,
                )),
                EvalPoint::from(normalized_to_px(
                    point_on_carrier(
                        span.carrier.normal,
                        span.carrier.direction,
                        span.carrier.rho,
                        span.t_interval[1],
                    ),
                    image_size,
                )),
            ],
            source_kind,
        });
    }
    CoverageCandidateSet {
        name: name.to_owned(),
        vertices,
        carriers,
        candidates,
    }
}

fn raster_evidence_for_gt(
    ground_truth: &EvalGraph,
    evidence: &RasterEvidence,
) -> Vec<CoverageDenseEvidence> {
    ground_truth
        .edges
        .iter()
        .map(|edge| {
            let Some(a) = ground_truth.vertices.get(edge.vertices[0]).copied() else {
                return CoverageDenseEvidence::default();
            };
            let Some(b) = ground_truth.vertices.get(edge.vertices[1]).copied() else {
                return CoverageDenseEvidence::default();
            };
            raster_evidence_for_segment([a, b], evidence)
        })
        .collect()
}

fn raster_evidence_for_segment(
    segment: [EvalPoint; 2],
    evidence: &RasterEvidence,
) -> CoverageDenseEvidence {
    let points = sample_segment_points(segment, 1.0);
    if points.is_empty() {
        return CoverageDenseEvidence::default();
    }
    let mut line_min = f64::INFINITY;
    let mut line_max = 0.0_f64;
    let mut line_sum = 0.0;
    let mut hits = 0usize;
    let mut count = 0usize;
    for point in points {
        let Some(idx) = pixel_index(point, evidence.image_size as usize) else {
            continue;
        };
        let line = evidence.line_probability[idx] as f64;
        line_min = line_min.min(line);
        line_max = line_max.max(line);
        line_sum += line;
        hits += usize::from(evidence.line_mask[idx] > 0);
        count += 1;
    }
    if count == 0 {
        return CoverageDenseEvidence::default();
    }
    let line_mean = line_sum / count as f64;
    let hit_fraction = hits as f64 / count as f64;
    CoverageDenseEvidence {
        available: true,
        line_min,
        line_mean,
        line_max,
        line_hit_fraction: hit_fraction,
        non_crease_mean: (1.0 - line_mean).clamp(0.0, 1.0),
        non_crease_max: (1.0 - hit_fraction).clamp(0.0, 1.0),
    }
}

fn read_ground_truth(
    pack_root: &Path,
    sample: &CorrectnessPackSample,
) -> Result<GroundTruthGraph, Box<dyn std::error::Error>> {
    let path = resolve_path(pack_root, &sample.gt_graph);
    Ok(serde_json::from_str(&fs::read_to_string(&path)?)?)
}

fn raster_gt_edge_diagnostics(
    graph: &EvalGraph,
    edge: &oristudio_cp_eval::GtEdgeCoverageRecord,
    candidate_graph: &CandidateGraph,
    evidence: &RasterEvidence,
    image_size: u32,
    coverage_options: CandidateCoverageOptions,
) -> Option<RasterGtEdgeDiagnostics> {
    let gt_segment = gt_edge_segment(graph, edge.vertices)?;
    let raster = raster_evidence_for_segment(gt_segment, evidence);
    let gt_length_px = eval_segment_length(gt_segment);
    let graph_vertices = candidate_graph
        .vertices
        .iter()
        .map(|vertex| EvalPoint::from(normalized_to_px(vertex.point, image_size)))
        .collect::<Vec<_>>();
    let nearest_graph_vertex_a_px = nearest_eval_distance(&graph_vertices, gt_segment[0]);
    let nearest_graph_vertex_b_px = nearest_eval_distance(&graph_vertices, gt_segment[1]);

    let direction = eval_unit_direction(gt_segment);
    let mut line_vertices = graph_vertices
        .iter()
        .enumerate()
        .filter_map(|(index, point)| {
            let t = eval_dot(eval_sub(*point, gt_segment[0]), direction);
            let distance = eval_point_line_distance(*point, gt_segment);
            let near_line = distance <= coverage_options.carrier_distance_tolerance;
            let near_interval = t >= -coverage_options.segment_distance_tolerance
                && t <= gt_length_px + coverage_options.segment_distance_tolerance;
            (near_line && near_interval).then_some((index, t, distance, *point))
        })
        .collect::<Vec<_>>();
    line_vertices.sort_by(|left, right| left.1.total_cmp(&right.1));
    let graph_vertices_near_gt_line = line_vertices.len();
    let graph_vertices_between_gt_endpoints = line_vertices
        .iter()
        .filter(|(_, t, _, _)| *t >= 0.0 && *t <= gt_length_px)
        .count();

    let mut relaxed_line_like_spans = 0usize;
    let mut relaxed_endpoint_close_spans = 0usize;
    let mut best_relaxed: Option<(usize, f64, f64, f64, f64)> = None;
    for span in &candidate_graph.crease_candidates {
        if span.assignment_label() == AssignmentLabel::Boundary {
            continue;
        }
        let Some(a) = candidate_graph
            .vertices
            .get(span.vertices[0])
            .map(|vertex| EvalPoint::from(normalized_to_px(vertex.point, image_size)))
        else {
            continue;
        };
        let Some(b) = candidate_graph
            .vertices
            .get(span.vertices[1])
            .map(|vertex| EvalPoint::from(normalized_to_px(vertex.point, image_size)))
        else {
            continue;
        };
        let endpoints = [a, b];
        if eval_segment_length(endpoints) <= 1e-9 {
            continue;
        }
        let angle_delta = eval_angle_delta_degrees(endpoints, gt_segment);
        let line_distance = eval_point_line_distance(gt_segment[0], endpoints)
            .max(eval_point_line_distance(gt_segment[1], endpoints));
        let overlap = eval_interval_overlap_fraction(endpoints, gt_segment);
        let endpoint_distance = eval_symmetric_endpoint_distance(endpoints, gt_segment);
        let relaxed_line_like = angle_delta <= (coverage_options.angle_tolerance_degrees * 2.0)
            && line_distance <= (coverage_options.segment_distance_tolerance * 2.0)
            && overlap > 0.0;
        if !relaxed_line_like {
            continue;
        }
        relaxed_line_like_spans += 1;
        relaxed_endpoint_close_spans +=
            usize::from(endpoint_distance <= coverage_options.relaxed_vertex_tolerance);
        if best_relaxed
            .as_ref()
            .is_none_or(|(_, best_distance, _, _, _)| endpoint_distance < *best_distance)
        {
            best_relaxed = Some((
                span.id,
                endpoint_distance,
                angle_delta,
                line_distance,
                overlap,
            ));
        }
    }
    let (
        best_relaxed_span_id,
        best_relaxed_span_endpoint_distance_px,
        best_relaxed_span_angle_delta_degrees,
        best_relaxed_span_line_distance_px,
        best_relaxed_span_overlap_fraction,
    ) = match best_relaxed {
        Some((id, endpoint_distance, angle_delta, line_distance, overlap)) => (
            Some(id),
            Some(endpoint_distance),
            Some(angle_delta),
            Some(line_distance),
            Some(overlap),
        ),
        None => (None, None, None, None, None),
    };

    Some(RasterGtEdgeDiagnostics {
        gt_length_px,
        raster_line_mean: raster.line_mean,
        raster_line_hit_fraction: raster.line_hit_fraction,
        nearest_graph_vertex_a_px,
        nearest_graph_vertex_b_px,
        graph_vertices_near_gt_line,
        graph_vertices_between_gt_endpoints,
        relaxed_line_like_spans,
        relaxed_endpoint_close_spans,
        best_relaxed_span_id,
        best_relaxed_span_endpoint_distance_px,
        best_relaxed_span_angle_delta_degrees,
        best_relaxed_span_line_distance_px,
        best_relaxed_span_overlap_fraction,
    })
}

fn gt_edge_segment(graph: &EvalGraph, vertices: [usize; 2]) -> Option<[EvalPoint; 2]> {
    Some([
        *graph.vertices.get(vertices[0])?,
        *graph.vertices.get(vertices[1])?,
    ])
}

fn resolve_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn point_on_carrier(normal: Point2, direction: Point2, rho: f64, t: f64) -> Point2 {
    Point2::new(
        normal.x * rho + direction.x * t,
        normal.y * rho + direction.y * t,
    )
}

fn normalized_to_px(point: Point2, image_size: u32) -> [f64; 2] {
    let inset = 32.0;
    let span = image_size as f64 - inset * 2.0;
    [inset + point.x * span, inset + point.y * span]
}

fn sample_segment_points(segment: [EvalPoint; 2], step: f64) -> Vec<EvalPoint> {
    let length = ((segment[1].x - segment[0].x).powi(2) + (segment[1].y - segment[0].y).powi(2))
        .sqrt()
        .max(1.0);
    let steps = (length / step.max(1.0)).ceil().max(1.0) as usize;
    (0..=steps)
        .map(|index| {
            let t = index as f64 / steps as f64;
            EvalPoint::new(
                segment[0].x + (segment[1].x - segment[0].x) * t,
                segment[0].y + (segment[1].y - segment[0].y) * t,
            )
        })
        .collect()
}

fn pixel_index(point: EvalPoint, size: usize) -> Option<usize> {
    let x = point.x.round() as isize;
    let y = point.y.round() as isize;
    if x < 0 || y < 0 || x >= size as isize || y >= size as isize {
        return None;
    }
    Some(y as usize * size + x as usize)
}

fn nearest_eval_distance(points: &[EvalPoint], target: EvalPoint) -> Option<f64> {
    points
        .iter()
        .map(|point| eval_distance(*point, target))
        .min_by(|left, right| left.total_cmp(right))
}

fn eval_symmetric_endpoint_distance(left: [EvalPoint; 2], right: [EvalPoint; 2]) -> f64 {
    let same = eval_distance(left[0], right[0]).max(eval_distance(left[1], right[1]));
    let flipped = eval_distance(left[0], right[1]).max(eval_distance(left[1], right[0]));
    same.min(flipped)
}

fn eval_angle_delta_degrees(left: [EvalPoint; 2], right: [EvalPoint; 2]) -> f64 {
    let left_angle = (left[1].y - left[0].y).atan2(left[1].x - left[0].x);
    let right_angle = (right[1].y - right[0].y).atan2(right[1].x - right[0].x);
    let diff = (left_angle - right_angle)
        .abs()
        .rem_euclid(std::f64::consts::PI);
    diff.min(std::f64::consts::PI - diff).to_degrees()
}

fn eval_interval_overlap_fraction(candidate: [EvalPoint; 2], gt: [EvalPoint; 2]) -> f64 {
    let gt_len = eval_segment_length(gt);
    if gt_len <= 1e-9 {
        return 0.0;
    }
    let [mut min_t, mut max_t] = eval_projected_interval(candidate, gt);
    min_t = min_t.clamp(0.0, gt_len);
    max_t = max_t.clamp(0.0, gt_len);
    ((max_t - min_t).max(0.0) / gt_len).clamp(0.0, 1.0)
}

fn eval_projected_interval(candidate: [EvalPoint; 2], gt: [EvalPoint; 2]) -> [f64; 2] {
    let direction = eval_unit_direction(gt);
    let t0 = eval_dot(eval_sub(candidate[0], gt[0]), direction);
    let t1 = eval_dot(eval_sub(candidate[1], gt[0]), direction);
    [t0.min(t1), t0.max(t1)]
}

fn eval_point_line_distance(point: EvalPoint, line: [EvalPoint; 2]) -> f64 {
    let len = eval_segment_length(line);
    if len <= 1e-9 {
        return eval_distance(point, line[0]);
    }
    let area2 = ((line[1].x - line[0].x) * (line[0].y - point.y)
        - (line[0].x - point.x) * (line[1].y - line[0].y))
        .abs();
    area2 / len
}

fn eval_segment_length(segment: [EvalPoint; 2]) -> f64 {
    eval_distance(segment[0], segment[1])
}

fn eval_unit_direction(segment: [EvalPoint; 2]) -> EvalPoint {
    let len = eval_segment_length(segment).max(1e-12);
    EvalPoint {
        x: (segment[1].x - segment[0].x) / len,
        y: (segment[1].y - segment[0].y) / len,
    }
}

fn eval_sub(left: EvalPoint, right: EvalPoint) -> EvalPoint {
    EvalPoint {
        x: left.x - right.x,
        y: left.y - right.y,
    }
}

fn eval_dot(left: EvalPoint, right: EvalPoint) -> f64 {
    left.x * right.x + left.y * right.y
}

fn eval_distance(left: EvalPoint, right: EvalPoint) -> f64 {
    ((left.x - right.x).powi(2) + (left.y - right.y).powi(2)).sqrt()
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

fn exact_status_label(status: ExactSolvedGraphStatus) -> &'static str {
    match status {
        ExactSolvedGraphStatus::Solved => "solved",
        ExactSolvedGraphStatus::Ambiguous => "ambiguous",
        ExactSolvedGraphStatus::Failed => "failed",
    }
}

fn sorted_root_causes(map: &BTreeMap<CoverageRootCause, usize>) -> Vec<RootCauseCount> {
    let mut values = map
        .iter()
        .map(|(root_cause, count)| RootCauseCount {
            root_cause: *root_cause,
            count: *count,
        })
        .collect::<Vec<_>>();
    values.sort_by_key(|value| std::cmp::Reverse(value.count));
    values
}

fn worst_samples(rows: &[SampleRow]) -> Vec<WorstSample> {
    let mut values = rows
        .iter()
        .map(|row| {
            let evaluated = row.report.summary.gt_edges_evaluated;
            WorstSample {
                id: row.id.clone(),
                source_id: row.source_id.clone(),
                family: row.family.clone(),
                profile: row.profile.clone(),
                evaluated_edges: evaluated,
                adapter_any: row.report.summary.adapter_any,
                selected_any: row.report.summary.selected_any,
                missed_by_adapter: evaluated.saturating_sub(row.report.summary.adapter_any),
                missed_by_selection: evaluated.saturating_sub(row.report.summary.selected_any),
                top_root_causes: sorted_root_causes(&row.report.summary.root_causes)
                    .into_iter()
                    .take(5)
                    .collect(),
            }
        })
        .collect::<Vec<_>>();
    values.sort_by(|left, right| {
        right
            .missed_by_selection
            .cmp(&left.missed_by_selection)
            .then_with(|| right.missed_by_adapter.cmp(&left.missed_by_adapter))
    });
    values.truncate(10);
    values
}

fn markdown_summary(summary: &BenchmarkSummary) -> String {
    let evaluated = summary.aggregate.summary.gt_edges_evaluated.max(1);
    let pct = |value: usize| format!("{:.1}%", value as f64 * 100.0 / evaluated as f64);
    let mut out = String::new();
    out.push_str("# Raster Candidate Coverage Benchmark\n\n");
    out.push_str(&format!("- Strategy: `{}`\n", summary.config.strategy));
    out.push_str(&format!("- Samples: `{}`\n", summary.sample_count));
    out.push_str(&format!(
        "- Evaluated GT edges: `{}`\n",
        summary.aggregate.summary.gt_edges_evaluated
    ));
    out.push_str(&format!(
        "- Candidate oracle recall: `{:.4}` ({})\n",
        summary.aggregate.summary.candidate_oracle_recall,
        pct(summary.aggregate.summary.adapter_any)
    ));
    out.push_str(&format!(
        "- Beam selected recall: `{:.4}` ({})\n",
        summary.aggregate.summary.selected_recall,
        pct(summary.aggregate.summary.selected_any)
    ));
    out.push_str(&format!(
        "- Selected assignment matches: `{}` ({})\n",
        summary.aggregate.summary.selected_assignment_match,
        pct(summary.aggregate.summary.selected_assignment_match)
    ));
    out.push_str(&format!(
        "- Raster-supported GT edges: `{}` ({})\n",
        summary.aggregate.summary.dense_supported,
        pct(summary.aggregate.summary.dense_supported)
    ));
    out.push_str(&format!(
        "- Total seconds: `{:.3}`\n\n",
        summary.total_seconds
    ));
    out.push_str("## Raster Diagnostics\n\n");
    out.push_str(&format!(
        "- Foreground pixels: `{}`\n",
        summary.raster_diagnostics.foreground_pixels
    ));
    out.push_str(&format!(
        "- Connected components: `{}`\n",
        summary.raster_diagnostics.connected_components
    ));
    out.push_str(&format!(
        "- Hough segments: `{}`\n",
        summary.raster_diagnostics.hough_segments
    ));
    out.push_str(&format!(
        "- Line primitives: `{}`\n",
        summary.raster_diagnostics.line_primitives
    ));
    out.push_str(&format!(
        "- Carrier hypotheses: `{}`\n",
        summary.raster_diagnostics.carrier_hypotheses
    ));
    out.push_str(&format!(
        "- Intersection vertices: `{}`\n",
        summary.raster_diagnostics.vertices_from_intersections
    ));
    out.push_str(&format!(
        "- Boundary-contact vertices: `{}`\n",
        summary.raster_diagnostics.vertices_from_boundary_contacts
    ));
    out.push_str(&format!(
        "- Endpoint vertices: `{}`\n\n",
        summary.raster_diagnostics.vertices_from_endpoints
    ));
    out.push_str("## Exact Solve\n\n");
    out.push_str(&format!("- Enabled: `{}`\n", summary.exact_solve.enabled));
    out.push_str(&format!(
        "- Solved/Ambiguous/Failed/Skipped: `{}/{}/{}/{}`\n",
        summary.exact_solve.solved,
        summary.exact_solve.ambiguous,
        summary.exact_solve.failed,
        summary.exact_solve.skipped
    ));
    out.push_str(&format!(
        "- Exact solve seconds: `{:.3}`\n\n",
        summary.exact_solve.total_seconds
    ));
    out.push_str("## Root Causes\n\n");
    for item in &summary.top_root_causes {
        out.push_str(&format!(
            "- `{:?}`: `{}` ({})\n",
            item.root_cause,
            item.count,
            pct(item.count)
        ));
    }
    out.push_str("\n## Worst Samples\n\n");
    for sample in &summary.worst_samples {
        out.push_str(&format!(
            "- `{}`: selected `{}/{}`, adapter `{}/{}`\n",
            sample.id,
            sample.selected_any,
            sample.evaluated_edges,
            sample.adapter_any,
            sample.evaluated_edges
        ));
    }
    out
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

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut pack_manifest = None;
        let mut out = None;
        let mut strategy = RasterCandidateGenerationStrategyName::RasterCarrierV1;
        let mut limit = None;
        let mut line_threshold = None;
        let mut include_boundary_edges = false;
        let mut skip_exact_solve = false;
        let mut exact_patience = None;
        let mut carrier_options = RasterCarrierV1Options::default();

        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--pack" | "--manifest" => {
                    pack_manifest = Some(PathBuf::from(required_value(&mut iter, &arg)?));
                }
                "--out" => {
                    out = Some(PathBuf::from(required_value(&mut iter, &arg)?));
                }
                "--strategy" => {
                    strategy = required_value(&mut iter, &arg)?.parse()?;
                }
                "--limit" => {
                    limit = Some(required_value(&mut iter, &arg)?.parse()?);
                }
                "--line-threshold" => {
                    line_threshold = Some(required_value(&mut iter, &arg)?.parse()?);
                }
                "--include-boundary-edges" => {
                    include_boundary_edges = true;
                }
                "--skip-exact-solve" => {
                    skip_exact_solve = true;
                }
                "--exact-patience" => {
                    exact_patience = Some(required_value(&mut iter, &arg)?.parse()?);
                }
                "--hough-vote-threshold" => {
                    carrier_options.hough_vote_threshold =
                        required_value(&mut iter, &arg)?.parse()?;
                }
                "--min-line-primitive-support" => {
                    carrier_options.min_line_primitive_support =
                        required_value(&mut iter, &arg)?.parse()?;
                }
                "--vertex-merge-radius-px" => {
                    carrier_options.vertex_merge_radius_px =
                        required_value(&mut iter, &arg)?.parse()?;
                }
                "--min-vertex-support" => {
                    carrier_options.min_vertex_support =
                        required_value(&mut iter, &arg)?.parse()?;
                }
                "--min-span-line-support" => {
                    carrier_options.min_span_line_support =
                        required_value(&mut iter, &arg)?.parse()?;
                }
                "--min-span-hit-fraction" => {
                    carrier_options.min_span_hit_fraction =
                        required_value(&mut iter, &arg)?.parse()?;
                }
                "--max-carriers" => {
                    carrier_options.max_carriers = required_value(&mut iter, &arg)?.parse()?;
                }
                "--max-total-spans" => {
                    carrier_options.max_total_spans = required_value(&mut iter, &arg)?.parse()?;
                }
                "--max-skip-vertices" => {
                    carrier_options.max_skip_vertices = required_value(&mut iter, &arg)?.parse()?;
                }
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument {other:?}").into()),
            }
        }
        let mut coverage_options = CandidateCoverageOptions {
            include_boundary_edges,
            ..CandidateCoverageOptions::default()
        };
        coverage_options.dense_support_threshold =
            f64::from(line_threshold.unwrap_or(RasterEvidenceConfig::default().line_threshold));

        Ok(Self {
            pack_manifest: pack_manifest.unwrap_or_else(|| PathBuf::from(DEFAULT_PACK_MANIFEST)),
            out: out.ok_or("--out is required")?,
            strategy,
            limit,
            line_threshold,
            include_boundary_edges,
            skip_exact_solve,
            exact_patience,
            carrier_options,
            coverage_options,
        })
    }
}

fn required_value(
    iter: &mut impl Iterator<Item = String>,
    arg: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    iter.next()
        .ok_or_else(|| format!("{arg} requires a value").into())
}

fn print_usage() {
    eprintln!(
        "compare_raster_candidate_coverage --out PATH [--pack PATH] [--strategy raster-carrier-v1] [--limit N] [--skip-exact-solve]"
    );
}
