use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use oristudio_cp_compiler::candidate_graph::CandidateGraph;
use oristudio_cp_compiler::selection::{SelectionOptions, select_candidate_graph_beam_from_ir};
use oristudio_cp_compiler::{AssignmentLabel, CandidateProgram, Point2};
use oristudio_cp_detect::candidate_generation::{
    CandidateGenerationContext, CandidateGenerationOptions, CandidateGenerationStrategyName,
    LegacyThresholdStrategyOptions, generate_candidate_graph,
};
use oristudio_cp_detect::decode::{DecodeConfig, DenseOutputs};
use oristudio_cp_eval::{
    CandidateCoverageAggregate, CandidateCoverageOptions, CandidateCoverageReport,
    CoverageCandidate, CoverageCandidateSet, CoverageCarrier, CoverageDenseEvidence,
    CoverageRootCause, EvalAssignment, EvalEdge, EvalGraph, EvalPoint, candidate_coverage_metrics,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SCHEMA: &str = "oristudio/cp-detect-candidate-coverage-benchmark/v1";
const DEFAULT_DENSE_MANIFEST: &str =
    "artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx/manifest.json";

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
    dense_manifest: PathBuf,
    out: PathBuf,
    strategy: CandidateGenerationStrategyName,
    threshold: Option<f32>,
    legacy_low_threshold: Option<f32>,
    limit: Option<usize>,
    options: CandidateCoverageOptions,
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
    aggregate: CandidateCoverageAggregate,
    top_root_causes: Vec<RootCauseCount>,
    worst_samples: Vec<WorstSample>,
}

#[derive(Debug, Serialize)]
struct BenchmarkConfig {
    strategy: String,
    threshold: Option<f32>,
    legacy_low_threshold: Option<f32>,
    legacy_threshold_options: LegacyThresholdBenchmarkOptions,
    options: CandidateCoverageOptions,
}

#[derive(Debug, Serialize)]
struct LegacyThresholdBenchmarkOptions {
    duplicate_endpoint_tolerance_px: f64,
    weak_endpoint_snap_radius_px: Option<f64>,
    weak_boundary_endpoint_snap_radius_px: Option<f64>,
    weak_carrier_incidence_tolerance_px: Option<f64>,
    weak_span_split_tolerance_px: Option<f64>,
    weak_min_split_length_px: Option<f64>,
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
    threshold: f32,
    low_threshold: f32,
    report: CandidateCoverageReport,
    timings: SampleTimings,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
struct SampleTimings {
    read_logits_seconds: f64,
    strategy_generation_seconds: f64,
    selection_seconds: f64,
    metrics_seconds: f64,
    total_seconds: f64,
}

struct SampleLogits {
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
        .with_angle(self.angle.as_deref())
        .with_junction_offset(self.junction_offset.as_deref())
        .with_vertex_type_logits(self.vertex_type_logits.as_deref())
        .with_boundary_side_logits(self.boundary_side_logits.as_deref())
        .with_boundary_offset(self.boundary_offset.as_deref())
        .with_boundary_coord(self.boundary_coord.as_deref())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let started = Instant::now();
    let manifest_path = args.dense_manifest.canonicalize()?;
    let manifest_root = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let manifest: DenseCacheManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    fs::create_dir_all(&args.out)?;

    let mut aggregate = CandidateCoverageAggregate::default();
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
        let threshold = args.threshold.unwrap_or(sample.threshold);
        let strategy_options =
            candidate_generation_options(args.strategy, args.legacy_low_threshold);

        let read_logits_started = Instant::now();
        let logits = read_sample_logits(manifest_root, sample)?;
        let read_logits_seconds = read_logits_started.elapsed().as_secs_f64();

        let generation_started = Instant::now();
        let generation = generate_candidate_graph(
            CandidateGenerationContext {
                outputs: logits.as_dense_outputs(),
                config: DecodeConfig {
                    image_size: sample.image_size,
                    threshold,
                    ..DecodeConfig::default()
                },
            },
            strategy_options,
        )?;
        let strategy_generation_seconds = generation_started.elapsed().as_secs_f64();
        let low_threshold = generation.low_threshold;
        let high_program = &generation.primary_program;
        let low_program = generation
            .weak_program
            .as_ref()
            .unwrap_or(&generation.primary_program);
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
        let selection_seconds = selection_started.elapsed().as_secs_f64();

        let metrics_started = Instant::now();
        let gt = read_ground_truth(manifest_root, manifest.pack.as_deref(), sample)?;
        let gt_graph = gt.eval_graph();
        let dense_evidence =
            dense_evidence_for_gt(&gt_graph, &logits, sample.image_size, threshold);
        let high_set = candidate_set_from_program("high_legacy", high_program, sample.image_size);
        let low_set = candidate_set_from_program("low_legacy", low_program, sample.image_size);
        let adapter_set = candidate_set_from_graph(
            "adapter",
            &candidate_graph,
            &selected_ids,
            false,
            sample.image_size,
        );
        let selected_set = candidate_set_from_graph(
            "selected",
            &candidate_graph,
            &selected_ids,
            true,
            sample.image_size,
        );
        let report = candidate_coverage_metrics(
            &gt_graph,
            &dense_evidence,
            &high_set,
            &low_set,
            &adapter_set,
            &selected_set,
            args.options,
        );
        let metrics_seconds = metrics_started.elapsed().as_secs_f64();
        aggregate.add(&report);

        let row = SampleRow {
            id: sample.id.clone(),
            source_id: sample.source_id.clone(),
            family: sample.family.clone(),
            profile: sample.profile.clone(),
            threshold,
            low_threshold,
            timings: SampleTimings {
                read_logits_seconds,
                strategy_generation_seconds,
                selection_seconds,
                metrics_seconds,
                total_seconds: sample_started.elapsed().as_secs_f64(),
            },
            report,
        };
        serde_json::to_writer(&mut per_sample, &row)?;
        writeln!(per_sample)?;
        for edge in &row.report.per_gt_edge {
            serde_json::to_writer(
                &mut per_gt_edge,
                &serde_json::json!({
                    "sample_id": row.id,
                    "source_id": row.source_id,
                    "family": row.family,
                    "profile": row.profile,
                    "edge": edge,
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
        generated_by: "compare_candidate_coverage",
        generated_at_unix: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
        git_commit: git_commit(),
        dense_manifest: manifest_path.display().to_string(),
        dense_schema: manifest.schema,
        pack: manifest.pack,
        config: BenchmarkConfig {
            strategy: args.strategy.to_string(),
            threshold: args.threshold,
            legacy_low_threshold: args.legacy_low_threshold,
            legacy_threshold_options: legacy_threshold_benchmark_options(
                legacy_threshold_strategy_options(args.legacy_low_threshold),
            ),
            options: args.options,
        },
        sample_count: sample_rows.len(),
        total_seconds: started.elapsed().as_secs_f64(),
        aggregate,
        top_root_causes,
        worst_samples,
    };
    fs::write(
        args.out.join("summary.json"),
        serde_json::to_string_pretty(&summary)?,
    )?;
    fs::write(args.out.join("README.md"), markdown_summary(&summary))?;
    println!("{}", args.out.display());
    Ok(())
}

fn candidate_set_from_program(
    name: &str,
    program: &CandidateProgram,
    image_size: u32,
) -> CoverageCandidateSet {
    let vertices = program
        .vertices
        .iter()
        .map(|vertex| EvalPoint::from(normalized_to_px(vertex.position, image_size)))
        .collect::<Vec<_>>();
    let carriers = program
        .carriers
        .iter()
        .map(|carrier| {
            let direction = Point2::new(carrier.normal.y, -carrier.normal.x);
            CoverageCarrier {
                id: carrier.id.to_string(),
                endpoints: [
                    EvalPoint::from(normalized_to_px(
                        point_on_carrier(
                            carrier.normal,
                            direction,
                            carrier.rho,
                            carrier.support_interval[0],
                        ),
                        image_size,
                    )),
                    EvalPoint::from(normalized_to_px(
                        point_on_carrier(
                            carrier.normal,
                            direction,
                            carrier.rho,
                            carrier.support_interval[1],
                        ),
                        image_size,
                    )),
                ],
                source_kind: format!("{:?}", carrier.source),
            }
        })
        .collect::<Vec<_>>();
    let candidates = program
        .edges
        .iter()
        .filter_map(|edge| {
            let a = program.vertices.get(edge.vertices[0])?.position;
            let b = program.vertices.get(edge.vertices[1])?.position;
            Some(CoverageCandidate {
                id: edge.id.to_string(),
                endpoints: [
                    EvalPoint::from(normalized_to_px(a, image_size)),
                    EvalPoint::from(normalized_to_px(b, image_size)),
                ],
                assignment: eval_assignment(edge.assignment.label),
                selected: matches!(
                    edge.selection,
                    oristudio_cp_compiler::EdgeSelection::Selected
                ),
                source_kind: format!("{:?}", edge.source),
                line_support: edge.line_support,
            })
        })
        .collect::<Vec<_>>();
    CoverageCandidateSet {
        name: name.to_owned(),
        vertices,
        carriers,
        candidates,
    }
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

fn dense_evidence_for_gt(
    ground_truth: &EvalGraph,
    logits: &SampleLogits,
    image_size: u32,
    threshold: f32,
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
            dense_evidence_for_segment([a, b], logits, image_size as usize, threshold)
        })
        .collect()
}

fn dense_evidence_for_segment(
    segment: [EvalPoint; 2],
    logits: &SampleLogits,
    image_size: usize,
    threshold: f32,
) -> CoverageDenseEvidence {
    let points = sample_segment_points(segment, 1.0);
    if points.is_empty() {
        return CoverageDenseEvidence::default();
    }
    let mut line_min = f64::INFINITY;
    let mut line_max = 0.0_f64;
    let mut line_sum = 0.0;
    let mut non_crease_sum = 0.0;
    let mut non_crease_max = 0.0_f64;
    let mut hits = 0usize;
    let mut count = 0usize;
    for point in points {
        let Some(idx) = pixel_index(point, image_size) else {
            continue;
        };
        let line = sigmoid(logits.line_logits[idx]);
        let non_crease = sigmoid(logits.non_crease_logits[idx]);
        let effective = if non_crease >= 0.65 && line < 0.85 {
            line * 0.15
        } else {
            line
        };
        line_min = line_min.min(effective);
        line_max = line_max.max(effective);
        line_sum += effective;
        non_crease_sum += non_crease;
        non_crease_max = non_crease_max.max(non_crease);
        hits += usize::from(effective >= f64::from(threshold));
        count += 1;
    }
    if count == 0 {
        return CoverageDenseEvidence::default();
    }
    CoverageDenseEvidence {
        available: true,
        line_min,
        line_mean: line_sum / count as f64,
        line_max,
        line_hit_fraction: hits as f64 / count as f64,
        non_crease_mean: non_crease_sum / count as f64,
        non_crease_max,
    }
}

fn read_sample_logits(
    root: &Path,
    sample: &DenseCacheSample,
) -> Result<SampleLogits, Box<dyn std::error::Error>> {
    Ok(SampleLogits {
        line_logits: read_f32_file(&resolve_path(root, &sample.line_logits_f32_path))?,
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

fn read_ground_truth(
    manifest_root: &Path,
    pack: Option<&str>,
    sample: &DenseCacheSample,
) -> Result<GroundTruthGraph, Box<dyn std::error::Error>> {
    let Some(path) = sample.gt_graph.as_deref() else {
        return Err(format!("sample {} has no gt_graph", sample.id).into());
    };
    let path = resolve_gt_path(manifest_root, pack, path);
    Ok(serde_json::from_str(&fs::read_to_string(&path)?)?)
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut dense_manifest = None;
        let mut out = None;
        let mut strategy = CandidateGenerationStrategyName::default();
        let mut threshold = None;
        let mut legacy_low_threshold = None;
        let mut limit = None;
        let mut options = CandidateCoverageOptions::default();
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--manifest" | "--dense-manifest" => {
                    dense_manifest = Some(PathBuf::from(required_value(&mut iter, &arg)?));
                }
                "--out" => out = Some(PathBuf::from(required_value(&mut iter, "--out")?)),
                "--strategy" => {
                    strategy = required_value(&mut iter, "--strategy")?.parse()?;
                }
                "--threshold" => {
                    threshold = Some(required_value(&mut iter, "--threshold")?.parse()?)
                }
                "--legacy-low-threshold" => {
                    legacy_low_threshold =
                        Some(required_value(&mut iter, "--legacy-low-threshold")?.parse()?);
                }
                "--limit" => limit = Some(required_value(&mut iter, "--limit")?.parse()?),
                "--vertex-tolerance-px" => {
                    options.vertex_tolerance =
                        required_value(&mut iter, "--vertex-tolerance-px")?.parse()?;
                }
                "--relaxed-vertex-tolerance-px" => {
                    options.relaxed_vertex_tolerance =
                        required_value(&mut iter, "--relaxed-vertex-tolerance-px")?.parse()?;
                }
                "--segment-distance-tolerance-px" => {
                    options.segment_distance_tolerance =
                        required_value(&mut iter, "--segment-distance-tolerance-px")?.parse()?;
                }
                "--angle-tolerance-degrees" => {
                    options.angle_tolerance_degrees =
                        required_value(&mut iter, "--angle-tolerance-degrees")?.parse()?;
                }
                "--carrier-distance-tolerance-px" => {
                    options.carrier_distance_tolerance =
                        required_value(&mut iter, "--carrier-distance-tolerance-px")?.parse()?;
                }
                "--min-interval-overlap" => {
                    options.min_interval_overlap =
                        required_value(&mut iter, "--min-interval-overlap")?.parse()?;
                }
                "--dense-support-threshold" => {
                    options.dense_support_threshold =
                        required_value(&mut iter, "--dense-support-threshold")?.parse()?;
                }
                "--include-boundary-edges" => options.include_boundary_edges = true,
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}").into()),
            }
        }
        Ok(Self {
            dense_manifest: dense_manifest.unwrap_or_else(|| PathBuf::from(DEFAULT_DENSE_MANIFEST)),
            out: out.ok_or("--out is required")?,
            strategy,
            threshold,
            legacy_low_threshold,
            limit,
            options,
        })
    }
}

fn required_value(
    iter: &mut impl Iterator<Item = String>,
    name: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    iter.next()
        .ok_or_else(|| format!("{name} requires a value").into())
}

fn print_usage() {
    eprintln!(
        "compare_candidate_coverage --out PATH [--strategy legacy-threshold] [--manifest PATH] [--limit N] [--threshold P] [--legacy-low-threshold P]"
    );
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

fn candidate_generation_options(
    strategy: CandidateGenerationStrategyName,
    legacy_low_threshold: Option<f32>,
) -> CandidateGenerationOptions {
    CandidateGenerationOptions {
        strategy,
        legacy_threshold: legacy_threshold_strategy_options(legacy_low_threshold),
    }
}

fn legacy_threshold_strategy_options(low_threshold: Option<f32>) -> LegacyThresholdStrategyOptions {
    LegacyThresholdStrategyOptions {
        low_threshold,
        duplicate_endpoint_tolerance_px: 3.0,
        weak_endpoint_snap_radius_px: Some(12.0),
        weak_boundary_endpoint_snap_radius_px: Some(10.0),
        weak_carrier_incidence_tolerance_px: Some(6.0),
        weak_span_split_tolerance_px: Some(4.0),
        weak_min_split_length_px: Some(3.0),
    }
}

fn legacy_threshold_benchmark_options(
    options: LegacyThresholdStrategyOptions,
) -> LegacyThresholdBenchmarkOptions {
    LegacyThresholdBenchmarkOptions {
        duplicate_endpoint_tolerance_px: options.duplicate_endpoint_tolerance_px,
        weak_endpoint_snap_radius_px: options.weak_endpoint_snap_radius_px,
        weak_boundary_endpoint_snap_radius_px: options.weak_boundary_endpoint_snap_radius_px,
        weak_carrier_incidence_tolerance_px: options.weak_carrier_incidence_tolerance_px,
        weak_span_split_tolerance_px: options.weak_span_split_tolerance_px,
        weak_min_split_length_px: options.weak_min_split_length_px,
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

fn sigmoid(value: f32) -> f64 {
    1.0 / (1.0 + f64::from(-value).exp())
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

fn sorted_root_causes(map: &BTreeMap<CoverageRootCause, usize>) -> Vec<RootCauseCount> {
    let mut values = map
        .iter()
        .map(|(root_cause, count)| RootCauseCount {
            root_cause: *root_cause,
            count: *count,
        })
        .collect::<Vec<_>>();
    values.sort_by(|left, right| right.count.cmp(&left.count));
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
    out.push_str("# Candidate Coverage Benchmark\n\n");
    out.push_str(&format!("- Strategy: `{}`\n", summary.config.strategy));
    out.push_str(&format!("- Samples: `{}`\n", summary.sample_count));
    out.push_str(&format!(
        "- Evaluated non-boundary GT edges: `{}`\n",
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
        "- Dense supported: `{}`\n",
        pct(summary.aggregate.summary.dense_supported)
    ));
    out.push_str(&format!(
        "- Low-threshold carrier available: `{}`\n",
        pct(summary.aggregate.summary.low_carrier_available)
    ));
    out.push_str(&format!(
        "- Adapter candidate available: `{}`\n\n",
        pct(summary.aggregate.summary.adapter_any)
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
