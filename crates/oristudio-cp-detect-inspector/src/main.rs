use anyhow::{Context, Result, anyhow, bail};
use oristudio_cp_compiler::arrangement_v2::{
    ArrangementBoundaryContactPrimitive, ArrangementBoundarySide, ArrangementJunctionPrimitive,
    ArrangementLinePrimitive, ArrangementPaperFramePx, ArrangementV2Input, ArrangementV2Options,
    CandidateArrangement, build_candidate_arrangement,
};
use oristudio_cp_compiler::exact_probe::{
    ExactProbeOptions, ExactizabilityReport, probe_exactizability,
};
use oristudio_cp_compiler::selection::{
    CandidateSelection, SelectionDecision, SelectionOptions, select_candidate_graph,
    select_candidate_graph_beam_from_ir,
};
use oristudio_cp_compiler::{
    AssignmentCandidate, AssignmentLabel, CandidateGraph, EvidenceSource, ExactSolveInput,
    ExactSolvedGraph, Point2, SelectedGraph, solve_exact,
};
use oristudio_cp_detect::candidate_generation::{
    CandidateGenerationContext, CandidateGenerationOptions, CandidateGenerationStrategyName,
    LegacyThresholdStrategyOptions, default_low_threshold, generate_candidate_graph,
};
use oristudio_cp_detect::decode::{DecodeConfig, DenseOutputs, decode_dense_outputs};
use oristudio_cp_detect::evidence_extract::{
    AssignmentEvidence, BoundarySide, CompilerEvidence, DenseOutputRefs, EvidenceExtractionConfig,
    PrimitiveSource, extract_compiler_evidence,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8788;
const DEFAULT_DENSE_MANIFEST: &str = "artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx-v3-dense-edges-max700-probe-20260618/manifest.json";
const DEFAULT_DIST: &str = "apps/cp-detect-architecture-inspector/dist";
const DEFAULT_PUBLIC: &str = "apps/web/public";
const MAX_MAP_SIZE: usize = 512;

#[derive(Debug, Clone)]
struct Args {
    host: String,
    port: u16,
    dense_manifest: PathBuf,
    dist: PathBuf,
    public: PathBuf,
}

#[derive(Debug, Clone)]
struct AppState {
    manifest_path: PathBuf,
    manifest_root: PathBuf,
    pack_root: PathBuf,
    dist: PathBuf,
    public: PathBuf,
    manifest: DenseCacheManifest,
}

#[derive(Debug, Clone, Deserialize)]
struct DenseCacheManifest {
    schema: String,
    generated_at: Option<String>,
    pack: Option<String>,
    samples: Vec<DenseCacheSample>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct DenseCacheSample {
    id: String,
    source_id: Option<String>,
    profile: Option<String>,
    family: Option<String>,
    edge_count: Option<usize>,
    image_size: u32,
    threshold: f32,
    input_png: String,
    gt_fold: Option<String>,
    gt_graph: Option<String>,
    dims: BTreeMap<String, Vec<usize>>,
    angle_f32_path: Option<String>,
    junction_offset_f32_path: Option<String>,
    vertex_type_logits_f32_path: Option<String>,
    boundary_side_logits_f32_path: Option<String>,
    boundary_offset_f32_path: Option<String>,
    boundary_coord_f32_path: Option<String>,
    line_logits_f32_path: String,
    junction_logits_f32_path: String,
    assignment_logits_f32_path: String,
    non_crease_logits_f32_path: String,
    line_style_logits_f32_path: String,
    boundary_contact_logits_f32_path: String,
}

#[derive(Debug, Serialize)]
struct StageInfo {
    id: &'static str,
    label: &'static str,
    title: &'static str,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct ExamplesResponse {
    schema: &'static str,
    dense_schema: String,
    dense_manifest: String,
    generated_at: Option<String>,
    rows: Vec<ExampleRow>,
    counts: Value,
}

#[derive(Debug, Serialize)]
struct ExampleRow {
    id: String,
    source_id: Option<String>,
    family: Option<String>,
    profile: Option<String>,
    edge_count: Option<usize>,
    image_size: u32,
    threshold: f32,
    input_image_url: String,
}

#[derive(Debug, Serialize)]
struct Stage1Response {
    schema: &'static str,
    sample: ExampleRow,
    map_size: usize,
    config: EvidenceConfigSummary,
    report: Value,
    maps: Vec<MapPayload>,
    primitives: PrimitivePayload,
}

#[derive(Debug, Serialize)]
struct Stage2Response {
    schema: &'static str,
    sample: ExampleRow,
    map_size: usize,
    config: EvidenceConfigSummary,
    overlay_frame_px: OverlayFramePx,
    report: Value,
    maps: Vec<MapPayload>,
    primitives: PrimitivePayload,
    arrangement: CandidateArrangement,
}

#[derive(Debug, Serialize)]
struct Stage3Response {
    schema: &'static str,
    sample: ExampleRow,
    map_size: usize,
    config: EvidenceConfigSummary,
    overlay_frame_px: OverlayFramePx,
    report: Value,
    maps: Vec<MapPayload>,
    primitives: PrimitivePayload,
    arrangement: CandidateArrangement,
    selection: CandidateSelection,
}

#[derive(Debug, Serialize)]
struct Stage4Response {
    schema: &'static str,
    sample: ExampleRow,
    map_size: usize,
    config: EvidenceConfigSummary,
    overlay_frame_px: OverlayFramePx,
    report: Value,
    maps: Vec<MapPayload>,
    primitives: PrimitivePayload,
    arrangement: CandidateArrangement,
    selection: CandidateSelection,
    exactizability: ExactizabilityReport,
}

#[derive(Debug, Serialize)]
struct Stage5Response {
    schema: &'static str,
    sample: ExampleRow,
    map_size: usize,
    config: EvidenceConfigSummary,
    overlay_frame_px: OverlayFramePx,
    report: Value,
    maps: Vec<MapPayload>,
    primitives: PrimitivePayload,
    arrangement: CandidateArrangement,
    candidate_strategy: String,
    candidate_graph: CandidateGraph,
    selection: CandidateSelection,
    exactizability: ExactizabilityReport,
    ground_truth: Option<GroundTruthGraphPayload>,
    legacy_graph: Option<GroundTruthGraphPayload>,
}

#[derive(Debug, Serialize)]
struct Stage5bResponse {
    schema: &'static str,
    sample: ExampleRow,
    map_size: usize,
    config: EvidenceConfigSummary,
    overlay_frame_px: OverlayFramePx,
    report: Value,
    maps: Vec<MapPayload>,
    primitives: PrimitivePayload,
    arrangement: CandidateArrangement,
    candidate_strategy: String,
    candidate_graph: CandidateGraph,
    selection: CandidateSelection,
    exactizability: ExactizabilityReport,
    ground_truth: Option<GroundTruthGraphPayload>,
    legacy_graph: Option<GroundTruthGraphPayload>,
    decision_audit: CandidateDecisionAudit,
}

#[derive(Debug, Serialize)]
struct Stage6Response {
    schema: &'static str,
    sample: ExampleRow,
    map_size: usize,
    config: EvidenceConfigSummary,
    overlay_frame_px: OverlayFramePx,
    report: Value,
    maps: Vec<MapPayload>,
    primitives: PrimitivePayload,
    arrangement: CandidateArrangement,
    candidate_strategy: String,
    candidate_graph: CandidateGraph,
    selection: CandidateSelection,
    exactizability: ExactizabilityReport,
    exact_solve: ExactSolvedGraph,
    ground_truth: Option<GroundTruthGraphPayload>,
    legacy_graph: Option<GroundTruthGraphPayload>,
}

#[derive(Debug, Serialize)]
struct CandidateDecisionAudit {
    schema: &'static str,
    summary: CandidateDecisionAuditSummary,
    candidates: Vec<CandidateDecisionRecord>,
    gt_edges: Vec<GtEdgeAuditRecord>,
}

#[derive(Debug, Default, Serialize)]
struct CandidateDecisionAuditSummary {
    total_candidates: usize,
    selected: usize,
    available: usize,
    rejected: usize,
    conflicted_with_selected: usize,
    dominated_or_replaced: usize,
    locked: usize,
    gt_edges: usize,
    gt_edges_with_selected_match: usize,
    gt_edges_without_candidate: usize,
}

#[derive(Debug, Serialize)]
struct CandidateDecisionRecord {
    id: usize,
    kind: String,
    vertices: [usize; 2],
    endpoint_points: Option<[Point2; 2]>,
    assignment_label: String,
    boundary_role: String,
    source_kind: String,
    selection_policy: String,
    decision: String,
    reason_category: String,
    score: f64,
    score_breakdown: Option<oristudio_cp_compiler::selection::SelectionScoreBreakdown>,
    line_support_min: f64,
    line_support_mean: f64,
    line_support_max: f64,
    presence_probability: f64,
    conflicts: Vec<DecisionConflictRecord>,
    replaced_by: Vec<usize>,
    replaces: Vec<usize>,
    source_atomic_edge_ids: Vec<usize>,
    replaced_atomic_edge_ids: Vec<usize>,
    collapsed_vertex_ids: Vec<usize>,
    reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DecisionConflictRecord {
    id: usize,
    kind: String,
    candidate_ids: Vec<usize>,
    hard: bool,
    reason: String,
    touches_selected: bool,
}

#[derive(Debug, Serialize)]
struct GtEdgeAuditRecord {
    gt_edge_id: usize,
    vertices: [usize; 2],
    assignment_label: String,
    root_cause: String,
    best_candidate_ids: Vec<usize>,
    selected_candidate_ids: Vec<usize>,
    matches: Vec<GtCandidateMatchRecord>,
}

#[derive(Debug, Serialize)]
struct GtCandidateMatchRecord {
    candidate_id: usize,
    decision: String,
    reason_category: String,
    distance_px: f64,
    angle_delta_degrees: f64,
    selected: bool,
}

#[derive(Debug, Serialize)]
struct GroundTruthGraphPayload {
    image_size: u32,
    vertices_px: Vec<[f64; 2]>,
    edges_vertices: Vec<[usize; 2]>,
    edges_assignment_labels: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
struct OverlayFramePx {
    x_min: f64,
    y_min: f64,
    x_max: f64,
    y_max: f64,
}

#[derive(Debug, Serialize)]
struct EvidenceConfigSummary {
    image_size: u32,
    threshold: f32,
    line_threshold: f32,
    strong_line_support: f32,
    hough_vote_threshold: u32,
    max_line_primitives: usize,
    max_junction_primitives: usize,
    max_boundary_contact_primitives: usize,
}

#[derive(Debug, Serialize)]
struct MapPayload {
    id: &'static str,
    label: &'static str,
    width: usize,
    height: usize,
    min: f32,
    max: f32,
    values: Vec<u8>,
}

#[derive(Debug, Serialize)]
struct PrimitivePayload {
    line_primitives: Value,
    junction_primitives: Value,
    boundary_contact_primitives: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UploadInspectorOptions {
    pub id: Option<String>,
    pub source_id: Option<String>,
    pub filename: Option<String>,
    pub image_size: u32,
    pub threshold: f32,
    pub map_size: Option<usize>,
    pub input_image_url: Option<String>,
    pub model_manifest_id: Option<String>,
    pub rectification_report: Option<Value>,
    pub runtime: Option<Value>,
    pub candidate_strategy: Option<String>,
    pub legacy_low_threshold: Option<f32>,
    pub legacy_snap_radius_px: Option<f64>,
    pub offset_cluster_radius_px: Option<f64>,
}

fn main() -> Result<()> {
    let args = parse_args(std::env::args().skip(1))?;
    let state = Arc::new(load_state(&args)?);
    let listener = TcpListener::bind((args.host.as_str(), args.port))
        .with_context(|| format!("bind {}:{}", args.host, args.port))?;
    println!(
        "CP detection architecture inspector listening on http://{}:{}",
        args.host, args.port
    );
    println!("Dense cache: {}", state.manifest_path.display());
    for stream in listener.incoming() {
        let state = Arc::clone(&state);
        match stream {
            Ok(stream) => {
                thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, state) {
                        eprintln!("[cp-detect-inspector] {error:#}");
                    }
                });
            }
            Err(error) => eprintln!("[cp-detect-inspector] accept failed: {error}"),
        }
    }
    Ok(())
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<Args> {
    let mut result = Args {
        host: DEFAULT_HOST.to_owned(),
        port: DEFAULT_PORT,
        dense_manifest: PathBuf::from(DEFAULT_DENSE_MANIFEST),
        dist: PathBuf::from(DEFAULT_DIST),
        public: PathBuf::from(DEFAULT_PUBLIC),
    };
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        let value = match arg.as_str() {
            "--host" => {
                result.host = args.next().context("--host requires a value")?;
                continue;
            }
            "--port" => {
                result.port = args
                    .next()
                    .context("--port requires a value")?
                    .parse()
                    .context("invalid --port")?;
                continue;
            }
            "--dense-manifest" => &mut result.dense_manifest,
            "--dist" => &mut result.dist,
            "--public" => &mut result.public,
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other => bail!("unknown argument {other:?}"),
        };
        *value = PathBuf::from(args.next().context(format!("{arg} requires a value"))?);
    }
    Ok(result)
}

fn print_help() {
    println!(
        "Usage: oristudio-cp-detect-inspector [--host 127.0.0.1] [--port 8788] \\
         [--dense-manifest artifacts/.../manifest.json] [--dist apps/.../dist] \\
         [--public apps/web/public]"
    );
}

fn load_state(args: &Args) -> Result<AppState> {
    let manifest_path = args
        .dense_manifest
        .canonicalize()
        .unwrap_or_else(|_| args.dense_manifest.clone());
    let manifest_root = manifest_path
        .parent()
        .context("manifest should have a parent")?
        .to_path_buf();
    let manifest: DenseCacheManifest = if manifest_path.exists() {
        serde_json::from_str(
            &fs::read_to_string(&manifest_path)
                .with_context(|| format!("read {}", manifest_path.display()))?,
        )
        .with_context(|| format!("parse {}", manifest_path.display()))?
    } else {
        DenseCacheManifest {
            schema: "oristudio/cp-detect-architecture-inspector/empty-dense-cache/v1".to_owned(),
            generated_at: None,
            pack: None,
            samples: Vec::new(),
        }
    };
    let pack_root = manifest
        .pack
        .as_deref()
        .map(PathBuf::from)
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .filter(|path| path.exists())
        .unwrap_or_else(|| {
            PathBuf::from("artifacts/cp-detect-correctness/packs/smoke-1024-s3")
                .canonicalize()
                .unwrap_or_else(|_| manifest_root.clone())
        });
    Ok(AppState {
        manifest_path,
        manifest_root,
        pack_root,
        dist: args.dist.clone(),
        public: args.public.clone(),
        manifest,
    })
}

fn handle_connection(mut stream: TcpStream, state: Arc<AppState>) -> Result<()> {
    let request = read_request(&mut stream)?;
    let response = route_request(&request, &state);
    write_response(&mut stream, response)
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest> {
    let mut buffer = [0u8; 16384];
    let count = stream.read(&mut buffer)?;
    if count == 0 {
        bail!("empty request");
    }
    let text = String::from_utf8_lossy(&buffer[..count]);
    let mut lines = text.lines();
    let request_line = lines.next().context("missing request line")?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_owned();
    let target = parts.next().unwrap_or("/").to_owned();
    Ok(HttpRequest { method, target })
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    target: String,
}

#[derive(Debug)]
struct HttpResponse {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
}

fn route_request(request: &HttpRequest, state: &AppState) -> HttpResponse {
    if request.method != "GET" && request.method != "HEAD" {
        return error_response(405, "method not allowed");
    }
    let (path, query) = split_query(&request.target);
    let result = if path == "/api/stages" {
        json_response(&json!({
            "stages": [
                StageInfo {
                    id: "stage1",
                    label: "Stage 1",
                    title: "Dense evidence extraction",
                    status: "implemented"
                },
                StageInfo {
                    id: "stage2",
                    label: "Stage 2",
                    title: "Candidate planar graph arrangement",
                    status: "implemented"
                },
                StageInfo {
                    id: "stage3",
                    label: "Stage 3",
                    title: "Weighted candidate selection",
                    status: "implemented"
                },
                StageInfo {
                    id: "stage4",
                    label: "Stage 4",
                    title: "Local exactizability probes",
                    status: "implemented"
                },
                StageInfo {
                    id: "stage5",
                    label: "Stage 5",
                    title: "Exactizability-aware beam selection",
                    status: "implemented"
                },
                StageInfo {
                    id: "stage5b",
                    label: "Stage 5b",
                    title: "Candidate decision audit",
                    status: "implemented"
                },
                StageInfo {
                    id: "stage6",
                    label: "Stage 6",
                    title: "Full exact geometric solve",
                    status: "implemented"
                }
            ]
        }))
    } else if path == "/api/stage1/examples" {
        stage1_examples(state).and_then(|payload| json_response(&payload))
    } else if let Some(encoded_id) = path.strip_prefix("/api/stage1/examples/") {
        let sample_id = percent_decode(encoded_id);
        stage1_example(state, &sample_id, query).and_then(|payload| json_response(&payload))
    } else if path == "/api/stage2/examples" {
        stage2_examples(state).and_then(|payload| json_response(&payload))
    } else if let Some(encoded_id) = path.strip_prefix("/api/stage2/examples/") {
        let sample_id = percent_decode(encoded_id);
        stage2_example(state, &sample_id, query).and_then(|payload| json_response(&payload))
    } else if path == "/api/stage3/examples" {
        stage3_examples(state).and_then(|payload| json_response(&payload))
    } else if let Some(encoded_id) = path.strip_prefix("/api/stage3/examples/") {
        let sample_id = percent_decode(encoded_id);
        stage3_example(state, &sample_id, query).and_then(|payload| json_response(&payload))
    } else if path == "/api/stage4/examples" {
        stage4_examples(state).and_then(|payload| json_response(&payload))
    } else if let Some(encoded_id) = path.strip_prefix("/api/stage4/examples/") {
        let sample_id = percent_decode(encoded_id);
        stage4_example(state, &sample_id, query).and_then(|payload| json_response(&payload))
    } else if path == "/api/stage5/examples" {
        stage5_examples(state).and_then(|payload| json_response(&payload))
    } else if let Some(encoded_id) = path.strip_prefix("/api/stage5/examples/") {
        let sample_id = percent_decode(encoded_id);
        stage5_example(state, &sample_id, query).and_then(|payload| json_response(&payload))
    } else if path == "/api/stage5b/examples" {
        stage5b_examples(state).and_then(|payload| json_response(&payload))
    } else if let Some(encoded_id) = path.strip_prefix("/api/stage5b/examples/") {
        let sample_id = percent_decode(encoded_id);
        stage5b_example(state, &sample_id, query).and_then(|payload| json_response(&payload))
    } else if path == "/api/stage6/examples" {
        stage6_examples(state).and_then(|payload| json_response(&payload))
    } else if let Some(encoded_id) = path.strip_prefix("/api/stage6/examples/") {
        let sample_id = percent_decode(encoded_id);
        stage6_example(state, &sample_id, query).and_then(|payload| json_response(&payload))
    } else if let Some(encoded_id) = path.strip_prefix("/assets/input/") {
        let sample_id = percent_decode(encoded_id.trim_end_matches(".png"));
        serve_input_image(state, &sample_id)
    } else {
        serve_static(state, path)
    };
    match result {
        Ok(response) => {
            if request.method == "HEAD" {
                HttpResponse {
                    body: Vec::new(),
                    ..response
                }
            } else {
                response
            }
        }
        Err(error) => error_response(500, &format!("{error:#}")),
    }
}

fn split_query(target: &str) -> (&str, BTreeMap<String, String>) {
    let Some((path, query)) = target.split_once('?') else {
        return (target, BTreeMap::new());
    };
    let params = query
        .split('&')
        .filter(|item| !item.is_empty())
        .map(|item| {
            let (key, value) = item.split_once('=').unwrap_or((item, ""));
            (percent_decode(key), percent_decode(value))
        })
        .collect();
    (path, params)
}

fn stage1_examples(state: &AppState) -> Result<ExamplesResponse> {
    examples_response(
        state,
        "oristudio/cp-detect-architecture-inspector/stage1-index/v1",
    )
}

fn stage2_examples(state: &AppState) -> Result<ExamplesResponse> {
    examples_response(
        state,
        "oristudio/cp-detect-architecture-inspector/stage2-index/v1",
    )
}

fn stage3_examples(state: &AppState) -> Result<ExamplesResponse> {
    examples_response(
        state,
        "oristudio/cp-detect-architecture-inspector/stage3-index/v1",
    )
}

fn stage4_examples(state: &AppState) -> Result<ExamplesResponse> {
    examples_response(
        state,
        "oristudio/cp-detect-architecture-inspector/stage4-index/v1",
    )
}

fn stage5_examples(state: &AppState) -> Result<ExamplesResponse> {
    examples_response(
        state,
        "oristudio/cp-detect-architecture-inspector/stage5-index/v1",
    )
}

fn stage5b_examples(state: &AppState) -> Result<ExamplesResponse> {
    examples_response(
        state,
        "oristudio/cp-detect-architecture-inspector/stage5b-index/v1",
    )
}

fn stage6_examples(state: &AppState) -> Result<ExamplesResponse> {
    examples_response(
        state,
        "oristudio/cp-detect-architecture-inspector/stage6-index/v1",
    )
}

fn examples_response(state: &AppState, schema: &'static str) -> Result<ExamplesResponse> {
    let mut profiles = BTreeMap::<String, usize>::new();
    let mut families = BTreeMap::<String, usize>::new();
    let rows = state
        .manifest
        .samples
        .iter()
        .map(|sample| {
            if let Some(profile) = &sample.profile {
                *profiles.entry(profile.clone()).or_default() += 1;
            }
            if let Some(family) = &sample.family {
                *families.entry(family.clone()).or_default() += 1;
            }
            example_row(sample)
        })
        .collect();
    Ok(ExamplesResponse {
        schema,
        dense_schema: state.manifest.schema.clone(),
        dense_manifest: state.manifest_path.display().to_string(),
        generated_at: state.manifest.generated_at.clone(),
        rows,
        counts: json!({
            "profiles": profiles,
            "families": families,
            "samples": state.manifest.samples.len(),
        }),
    })
}

fn stage1_example(
    state: &AppState,
    sample_id: &str,
    query: BTreeMap<String, String>,
) -> Result<Stage1Response> {
    let sample = state
        .manifest
        .samples
        .iter()
        .find(|sample| sample.id == sample_id)
        .ok_or_else(|| anyhow!("unknown sample {sample_id:?}"))?;
    let threshold = query
        .get("threshold")
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(sample.threshold);
    let map_size = query
        .get("map_size")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(192)
        .clamp(16, MAX_MAP_SIZE);
    let outputs = read_dense_outputs(state, sample)?;
    let decode_config = DecodeConfig {
        image_size: sample.image_size,
        threshold,
        ..DecodeConfig::default()
    };
    let evidence_config = evidence_config_from_decode(&decode_config);
    let evidence = extract_compiler_evidence(outputs.as_dense_refs(), evidence_config)?;
    let maps = evidence_maps(&evidence, map_size)?;
    Ok(Stage1Response {
        schema: "oristudio/cp-detect-architecture-inspector/stage1/v1",
        sample: example_row(sample),
        map_size,
        config: EvidenceConfigSummary {
            image_size: evidence_config.image_size,
            threshold,
            line_threshold: evidence_config.line_threshold,
            strong_line_support: evidence_config.strong_line_support,
            hough_vote_threshold: evidence_config.hough_vote_threshold,
            max_line_primitives: evidence_config.max_line_primitives,
            max_junction_primitives: evidence_config.max_junction_primitives,
            max_boundary_contact_primitives: evidence_config.max_boundary_contact_primitives,
        },
        report: serde_json::to_value(evidence.report)?,
        maps,
        primitives: PrimitivePayload {
            line_primitives: serde_json::to_value(evidence.line_primitives)?,
            junction_primitives: serde_json::to_value(evidence.junction_primitives)?,
            boundary_contact_primitives: serde_json::to_value(
                evidence.boundary_contact_primitives,
            )?,
        },
    })
}

fn stage2_example(
    state: &AppState,
    sample_id: &str,
    query: BTreeMap<String, String>,
) -> Result<Stage2Response> {
    let sample = state
        .manifest
        .samples
        .iter()
        .find(|sample| sample.id == sample_id)
        .ok_or_else(|| anyhow!("unknown sample {sample_id:?}"))?;
    let threshold = query
        .get("threshold")
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(sample.threshold);
    let map_size = query
        .get("map_size")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(192)
        .clamp(16, MAX_MAP_SIZE);
    let outputs = read_dense_outputs(state, sample)?;
    let decode_config = DecodeConfig {
        image_size: sample.image_size,
        threshold,
        ..DecodeConfig::default()
    };
    let evidence_config = evidence_config_from_decode(&decode_config);
    let evidence = extract_compiler_evidence(outputs.as_dense_refs(), evidence_config)?;
    let maps = evidence_maps(&evidence, map_size)?;
    let overlay_frame_px = overlay_frame_for_sample(state, sample)?;
    let arrangement_input = arrangement_input_from_evidence(&evidence, Some(overlay_frame_px));
    let arrangement =
        build_candidate_arrangement(&arrangement_input, ArrangementV2Options::default());
    Ok(Stage2Response {
        schema: "oristudio/cp-detect-architecture-inspector/stage2/v1",
        sample: example_row(sample),
        map_size,
        config: EvidenceConfigSummary {
            image_size: evidence_config.image_size,
            threshold,
            line_threshold: evidence_config.line_threshold,
            strong_line_support: evidence_config.strong_line_support,
            hough_vote_threshold: evidence_config.hough_vote_threshold,
            max_line_primitives: evidence_config.max_line_primitives,
            max_junction_primitives: evidence_config.max_junction_primitives,
            max_boundary_contact_primitives: evidence_config.max_boundary_contact_primitives,
        },
        overlay_frame_px,
        report: serde_json::to_value(evidence.report)?,
        maps,
        primitives: PrimitivePayload {
            line_primitives: serde_json::to_value(&evidence.line_primitives)?,
            junction_primitives: serde_json::to_value(&evidence.junction_primitives)?,
            boundary_contact_primitives: serde_json::to_value(
                &evidence.boundary_contact_primitives,
            )?,
        },
        arrangement,
    })
}

fn stage3_example(
    state: &AppState,
    sample_id: &str,
    query: BTreeMap<String, String>,
) -> Result<Stage3Response> {
    let stage2 = stage2_example(state, sample_id, query)?;
    let selection = select_candidate_graph(&stage2.arrangement, SelectionOptions::default());
    Ok(Stage3Response {
        schema: "oristudio/cp-detect-architecture-inspector/stage3/v1",
        sample: stage2.sample,
        map_size: stage2.map_size,
        config: stage2.config,
        overlay_frame_px: stage2.overlay_frame_px,
        report: stage2.report,
        maps: stage2.maps,
        primitives: stage2.primitives,
        arrangement: stage2.arrangement,
        selection,
    })
}

fn stage4_example(
    state: &AppState,
    sample_id: &str,
    query: BTreeMap<String, String>,
) -> Result<Stage4Response> {
    let stage3 = stage3_example(state, sample_id, query)?;
    let exactizability = probe_exactizability(
        &stage3.arrangement,
        &stage3.selection,
        ExactProbeOptions::default(),
    );
    Ok(Stage4Response {
        schema: "oristudio/cp-detect-architecture-inspector/stage4/v1",
        sample: stage3.sample,
        map_size: stage3.map_size,
        config: stage3.config,
        overlay_frame_px: stage3.overlay_frame_px,
        report: stage3.report,
        maps: stage3.maps,
        primitives: stage3.primitives,
        arrangement: stage3.arrangement,
        selection: stage3.selection,
        exactizability,
    })
}

fn stage5_example(
    state: &AppState,
    sample_id: &str,
    query: BTreeMap<String, String>,
) -> Result<Stage5Response> {
    let sample = state
        .manifest
        .samples
        .iter()
        .find(|sample| sample.id == sample_id)
        .ok_or_else(|| anyhow!("unknown sample {sample_id:?}"))?;
    let candidate_strategy = candidate_strategy_from_query(&query)?;
    let legacy_low_threshold = query
        .get("legacy_low_threshold")
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or_else(|| {
            default_low_threshold(stage_threshold_from_query_or_sample(&query, sample))
        });
    let legacy_snap_radius_px = query
        .get("legacy_snap_radius_px")
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(DEFAULT_WEAK_ENDPOINT_SNAP_RADIUS_PX)
        .clamp(0.0, 128.0);
    // Offset-vote junction decoding for radius-trained models, e.g.
    // ?offset_cluster_radius_px=3 with the close-pair dense caches.
    let offset_cluster_radius_px = query
        .get("offset_cluster_radius_px")
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    let stage2 = stage2_example(state, sample_id, query)?;
    let exact_options = ExactProbeOptions::default();
    let outputs = read_dense_outputs(state, sample)?;
    let generation = generate_candidate_graph(
        CandidateGenerationContext {
            outputs: outputs.as_dense_outputs(),
            config: DecodeConfig {
                image_size: sample.image_size,
                threshold: stage2.config.threshold,
                ..DecodeConfig::default()
            },
        },
        {
            let mut generation_options = CandidateGenerationOptions {
                strategy: candidate_strategy,
                legacy_threshold: LegacyThresholdStrategyOptions {
                    low_threshold: Some(legacy_low_threshold),
                    weak_endpoint_snap_radius_px: Some(legacy_snap_radius_px),
                    weak_boundary_endpoint_snap_radius_px: Some(10.0),
                    weak_carrier_incidence_tolerance_px: Some(6.0),
                    weak_span_split_tolerance_px: Some(4.0),
                    weak_min_split_length_px: Some(3.0),
                    ..LegacyThresholdStrategyOptions::default()
                },
                ..CandidateGenerationOptions::default()
            };
            generation_options
                .junction_first_v1
                .junction_offset_cluster_radius_px = offset_cluster_radius_px;
            generation_options
        },
    )
    .with_context(|| {
        format!(
            "generate {} candidate graph for {}",
            candidate_strategy, sample.id
        )
    })?;
    let candidate_graph = generation.candidate_graph;
    let selection = select_candidate_graph_beam_from_ir(
        &candidate_graph,
        SelectionOptions::default(),
        exact_options,
    );
    let exactizability = probe_exactizability(&stage2.arrangement, &selection, exact_options);
    let ground_truth = read_ground_truth_graph(state, sample)?;
    let legacy_graph = read_legacy_graph(
        state,
        sample,
        stage2.config.threshold,
        stage2.overlay_frame_px,
    )?;
    Ok(Stage5Response {
        schema: "oristudio/cp-detect-architecture-inspector/stage5/v1",
        sample: stage2.sample,
        map_size: stage2.map_size,
        config: stage2.config,
        overlay_frame_px: stage2.overlay_frame_px,
        report: stage2.report,
        maps: stage2.maps,
        primitives: stage2.primitives,
        arrangement: stage2.arrangement,
        candidate_strategy: candidate_strategy.to_string(),
        candidate_graph,
        selection,
        exactizability,
        ground_truth,
        legacy_graph,
    })
}

fn stage5b_example(
    state: &AppState,
    sample_id: &str,
    query: BTreeMap<String, String>,
) -> Result<Stage5bResponse> {
    let stage5 = stage5_example(state, sample_id, query)?;
    let decision_audit = candidate_decision_audit(
        &stage5.candidate_graph,
        &stage5.selection,
        stage5.ground_truth.as_ref(),
        stage5.overlay_frame_px,
    );
    Ok(Stage5bResponse {
        schema: "oristudio/cp-detect-architecture-inspector/stage5b/v1",
        sample: stage5.sample,
        map_size: stage5.map_size,
        config: stage5.config,
        overlay_frame_px: stage5.overlay_frame_px,
        report: stage5.report,
        maps: stage5.maps,
        primitives: stage5.primitives,
        arrangement: stage5.arrangement,
        candidate_strategy: stage5.candidate_strategy,
        candidate_graph: stage5.candidate_graph,
        selection: stage5.selection,
        exactizability: stage5.exactizability,
        ground_truth: stage5.ground_truth,
        legacy_graph: stage5.legacy_graph,
        decision_audit,
    })
}

fn stage6_example(
    state: &AppState,
    sample_id: &str,
    query: BTreeMap<String, String>,
) -> Result<Stage6Response> {
    let stage5 = stage5_example(state, sample_id, query)?;
    let selected_graph = SelectedGraph::from_selected_span_ids(
        &stage5.candidate_graph,
        stage5
            .selection
            .selected_spans
            .iter()
            .map(|span| span.id)
            .collect(),
    );
    let exact_input =
        ExactSolveInput::from_candidate_selection(&stage5.candidate_graph, &selected_graph);
    let selection = selection_with_exact_roles(stage5.selection, &exact_input);
    let exact_solve = solve_exact(&exact_input, Default::default());
    Ok(Stage6Response {
        schema: "oristudio/cp-detect-architecture-inspector/stage6/v1",
        sample: stage5.sample,
        map_size: stage5.map_size,
        config: stage5.config,
        overlay_frame_px: stage5.overlay_frame_px,
        report: stage5.report,
        maps: stage5.maps,
        primitives: stage5.primitives,
        arrangement: stage5.arrangement,
        candidate_strategy: stage5.candidate_strategy,
        candidate_graph: stage5.candidate_graph,
        selection,
        exactizability: stage5.exactizability,
        exact_solve,
        ground_truth: stage5.ground_truth,
        legacy_graph: stage5.legacy_graph,
    })
}

pub fn build_uploaded_stage_bundle(
    outputs: DenseOutputsOwned,
    options: UploadInspectorOptions,
) -> Result<Value> {
    let image_size = options.image_size;
    let threshold = options.threshold;
    let map_size = options.map_size.unwrap_or(192).clamp(16, MAX_MAP_SIZE);
    let offset_cluster_radius_px = options.offset_cluster_radius_px.unwrap_or(0.0);
    let decode_config = DecodeConfig {
        image_size,
        threshold,
        junction_offset_cluster_radius_px: offset_cluster_radius_px as f32,
        ..DecodeConfig::default()
    };
    let evidence_config = evidence_config_from_decode(&decode_config);
    let evidence = extract_compiler_evidence(outputs.as_dense_refs(), evidence_config)?;
    let maps = evidence_maps(&evidence, map_size)?;
    let overlay_frame_px = default_overlay_frame(image_size);
    let sample = ExampleRow {
        id: options
            .id
            .clone()
            .unwrap_or_else(|| "uploaded-image".to_owned()),
        source_id: options.source_id.clone().or(options.filename.clone()),
        family: Some("uploaded".to_owned()),
        profile: Some("ad-hoc".to_owned()),
        edge_count: None,
        image_size,
        threshold,
        input_image_url: options.input_image_url.clone().unwrap_or_default(),
    };
    let config = EvidenceConfigSummary {
        image_size: evidence_config.image_size,
        threshold,
        line_threshold: evidence_config.line_threshold,
        strong_line_support: evidence_config.strong_line_support,
        hough_vote_threshold: evidence_config.hough_vote_threshold,
        max_line_primitives: evidence_config.max_line_primitives,
        max_junction_primitives: evidence_config.max_junction_primitives,
        max_boundary_contact_primitives: evidence_config.max_boundary_contact_primitives,
    };
    let report = serde_json::to_value(&evidence.report)?;
    let primitives = PrimitivePayload {
        line_primitives: serde_json::to_value(&evidence.line_primitives)?,
        junction_primitives: serde_json::to_value(&evidence.junction_primitives)?,
        boundary_contact_primitives: serde_json::to_value(&evidence.boundary_contact_primitives)?,
    };
    let stage0 = json!({
        "schema": "oristudio/cp-detect-architecture-inspector/stage0/v1",
        "sample": &sample,
        "map_size": map_size,
        "config": &config,
        "model_manifest_id": options.model_manifest_id,
        "rectification_report": options.rectification_report,
        "runtime": options.runtime,
        "input_image_url": &sample.input_image_url,
        "dense_outputs": dense_tensor_summaries(&outputs, image_size),
        "maps": &maps
    });
    let stage1 = json!({
        "schema": "oristudio/cp-detect-architecture-inspector/stage1/v1",
        "sample": &sample,
        "map_size": map_size,
        "config": &config,
        "report": &report,
        "maps": &maps,
        "primitives": &primitives
    });
    let arrangement_input = arrangement_input_from_evidence(&evidence, Some(overlay_frame_px));
    let arrangement =
        build_candidate_arrangement(&arrangement_input, ArrangementV2Options::default());
    let stage2 = json!({
        "schema": "oristudio/cp-detect-architecture-inspector/stage2/v1",
        "sample": &sample,
        "map_size": map_size,
        "config": &config,
        "overlay_frame_px": overlay_frame_px,
        "report": &report,
        "maps": &maps,
        "primitives": &primitives,
        "arrangement": &arrangement
    });
    let selection = select_candidate_graph(&arrangement, SelectionOptions::default());
    let stage3 = json!({
        "schema": "oristudio/cp-detect-architecture-inspector/stage3/v1",
        "sample": &sample,
        "map_size": map_size,
        "config": &config,
        "overlay_frame_px": overlay_frame_px,
        "report": &report,
        "maps": &maps,
        "primitives": &primitives,
        "arrangement": &arrangement,
        "selection": &selection
    });
    let exact_options = ExactProbeOptions::default();
    let exactizability = probe_exactizability(&arrangement, &selection, exact_options);
    let stage4 = json!({
        "schema": "oristudio/cp-detect-architecture-inspector/stage4/v1",
        "sample": &sample,
        "map_size": map_size,
        "config": &config,
        "overlay_frame_px": overlay_frame_px,
        "report": &report,
        "maps": &maps,
        "primitives": &primitives,
        "arrangement": &arrangement,
        "selection": &selection,
        "exactizability": &exactizability
    });
    let default_strategy = CandidateGenerationStrategyName::default();
    let strategy_text = options
        .candidate_strategy
        .as_deref()
        .unwrap_or_else(|| default_strategy.id());
    let candidate_strategy = strategy_text
        .parse::<CandidateGenerationStrategyName>()
        .with_context(|| format!("parse candidate generation strategy {strategy_text:?}"))?;
    let legacy_low_threshold = options
        .legacy_low_threshold
        .unwrap_or_else(|| default_low_threshold(threshold));
    let legacy_snap_radius_px = options
        .legacy_snap_radius_px
        .unwrap_or(DEFAULT_WEAK_ENDPOINT_SNAP_RADIUS_PX)
        .clamp(0.0, 128.0);
    let generation = generate_candidate_graph(
        CandidateGenerationContext {
            outputs: outputs.as_dense_outputs(),
            config: decode_config,
        },
        {
            let mut generation_options = CandidateGenerationOptions {
                strategy: candidate_strategy,
                legacy_threshold: LegacyThresholdStrategyOptions {
                    low_threshold: Some(legacy_low_threshold),
                    weak_endpoint_snap_radius_px: Some(legacy_snap_radius_px),
                    weak_boundary_endpoint_snap_radius_px: Some(10.0),
                    weak_carrier_incidence_tolerance_px: Some(6.0),
                    weak_span_split_tolerance_px: Some(4.0),
                    weak_min_split_length_px: Some(3.0),
                    ..LegacyThresholdStrategyOptions::default()
                },
                ..CandidateGenerationOptions::default()
            };
            generation_options
                .junction_first_v1
                .junction_offset_cluster_radius_px = offset_cluster_radius_px;
            generation_options
        },
    )
    .with_context(|| format!("generate {candidate_strategy} candidate graph for uploaded image"))?;
    let candidate_graph = generation.candidate_graph;
    let selection = select_candidate_graph_beam_from_ir(
        &candidate_graph,
        SelectionOptions::default(),
        exact_options,
    );
    let exactizability = probe_exactizability(&arrangement, &selection, exact_options);
    let legacy_graph = legacy_graph_from_dense_outputs(&outputs, image_size, threshold)?;
    let stage5 = json!({
        "schema": "oristudio/cp-detect-architecture-inspector/stage5/v1",
        "sample": &sample,
        "map_size": map_size,
        "config": &config,
        "overlay_frame_px": overlay_frame_px,
        "report": &report,
        "maps": &maps,
        "primitives": &primitives,
        "arrangement": &arrangement,
        "candidate_strategy": candidate_strategy.to_string(),
        "candidate_graph": &candidate_graph,
        "selection": &selection,
        "exactizability": &exactizability,
        "ground_truth": null,
        "legacy_graph": &legacy_graph
    });
    let decision_audit =
        candidate_decision_audit(&candidate_graph, &selection, None, overlay_frame_px);
    let stage5b = json!({
        "schema": "oristudio/cp-detect-architecture-inspector/stage5b/v1",
        "sample": &sample,
        "map_size": map_size,
        "config": &config,
        "overlay_frame_px": overlay_frame_px,
        "report": &report,
        "maps": &maps,
        "primitives": &primitives,
        "arrangement": &arrangement,
        "candidate_strategy": candidate_strategy.to_string(),
        "candidate_graph": &candidate_graph,
        "selection": &selection,
        "exactizability": &exactizability,
        "ground_truth": null,
        "legacy_graph": &legacy_graph,
        "decision_audit": &decision_audit
    });
    let selected_graph = SelectedGraph::from_selected_span_ids(
        &candidate_graph,
        selection
            .selected_spans
            .iter()
            .map(|span| span.id)
            .collect(),
    );
    let exact_input = ExactSolveInput::from_candidate_selection(&candidate_graph, &selected_graph);
    let selection = selection_with_exact_roles(selection, &exact_input);
    let exact_solve = solve_exact(&exact_input, Default::default());
    let stage6 = json!({
        "schema": "oristudio/cp-detect-architecture-inspector/stage6/v1",
        "sample": &sample,
        "map_size": map_size,
        "config": &config,
        "overlay_frame_px": overlay_frame_px,
        "report": &report,
        "maps": &maps,
        "primitives": &primitives,
        "arrangement": &arrangement,
        "candidate_strategy": candidate_strategy.to_string(),
        "candidate_graph": &candidate_graph,
        "selection": &selection,
        "exactizability": &exactizability,
        "exact_solve": &exact_solve,
        "ground_truth": null,
        "legacy_graph": &legacy_graph
    });
    Ok(json!({
        "schema": "oristudio/cp-detect-architecture-inspector/uploaded-run/v1",
        "source": "upload",
        "sample": sample,
        "active_stage": "stage6",
        "stage_order": ["stage0", "stage1", "stage2", "stage3", "stage4", "stage5", "stage5b", "stage6"],
        "stages": {
            "stage0": stage0,
            "stage1": stage1,
            "stage2": stage2,
            "stage3": stage3,
            "stage4": stage4,
            "stage5": stage5,
            "stage5b": stage5b,
            "stage6": stage6
        }
    }))
}

fn candidate_decision_audit(
    graph: &CandidateGraph,
    selection: &CandidateSelection,
    ground_truth: Option<&GroundTruthGraphPayload>,
    overlay_frame_px: OverlayFramePx,
) -> CandidateDecisionAudit {
    let selected_ids = selection
        .selected_spans
        .iter()
        .map(|span| span.id)
        .collect::<BTreeSet<_>>();
    let score_by_id = selection
        .edge_scores
        .iter()
        .map(|score| (score.edge_id, score))
        .collect::<BTreeMap<_, _>>();
    let conflicts_by_candidate = conflicts_by_candidate(graph, &selected_ids);
    let selected_candidate_spans = graph
        .crease_candidates
        .iter()
        .filter(|span| selected_ids.contains(&span.id))
        .collect::<Vec<_>>();

    let candidates = graph
        .crease_candidates
        .iter()
        .map(|span| {
            let score = score_by_id.get(&span.id).copied();
            let decision = score
                .map(|score| selection_decision_label(&score.decision))
                .unwrap_or("not_considered")
                .to_owned();
            let conflicts = conflicts_by_candidate
                .get(&span.id)
                .cloned()
                .unwrap_or_default();
            let replaced_by = selected_candidate_spans
                .iter()
                .filter(|selected| selected.id != span.id)
                .filter(|selected| {
                    selected.replaced_span_ids.contains(&span.id)
                        || selected.replaced_atomic_edge_ids.contains(&span.id)
                        || selected.source_atomic_edge_ids.contains(&span.id)
                })
                .map(|selected| selected.id)
                .collect::<Vec<_>>();
            let reason_category =
                reason_category(&decision, &conflicts, &replaced_by, &span.selection_policy);
            let mut reasons = span.reasons.clone();
            if let Some(score) = score {
                for reason in &score.reasons {
                    if !reasons.iter().any(|existing| existing == reason) {
                        reasons.push(reason.clone());
                    }
                }
            }
            CandidateDecisionRecord {
                id: span.id,
                kind: json_label(&span.kind),
                vertices: span.vertices,
                endpoint_points: candidate_endpoint_points(graph, span.vertices),
                assignment_label: json_label(&span.assignment_evidence.observed_label),
                boundary_role: json_label(&span.boundary_role()),
                source_kind: json_label(&span.source_kind),
                selection_policy: json_label(&span.selection_policy),
                decision,
                reason_category,
                score: score
                    .map(|score| score.total_score)
                    .unwrap_or_else(|| span.selection_score(graph)),
                score_breakdown: score.map(|score| score.breakdown.clone()),
                line_support_min: span.line_support_min,
                line_support_mean: span.line_support_mean,
                line_support_max: span.line_support_max,
                presence_probability: span.presence_probability,
                conflicts,
                replaced_by,
                replaces: span.replaced_span_ids.clone(),
                source_atomic_edge_ids: span.source_atomic_edge_ids.clone(),
                replaced_atomic_edge_ids: span.replaced_atomic_edge_ids.clone(),
                collapsed_vertex_ids: span.collapsed_vertex_ids.clone(),
                reasons,
            }
        })
        .collect::<Vec<_>>();

    let gt_edges = ground_truth
        .map(|ground_truth| gt_edge_audits(ground_truth, &candidates, overlay_frame_px))
        .unwrap_or_default();
    let mut summary = CandidateDecisionAuditSummary {
        total_candidates: candidates.len(),
        gt_edges: gt_edges.len(),
        ..Default::default()
    };
    for candidate in &candidates {
        match candidate.reason_category.as_str() {
            "selected" => summary.selected += 1,
            "available" => summary.available += 1,
            "conflict" => {
                summary.rejected += 1;
                summary.conflicted_with_selected += 1;
            }
            "dominated" => {
                summary.rejected += 1;
                summary.dominated_or_replaced += 1;
            }
            "locked" => {
                summary.selected += 1;
                summary.locked += 1;
            }
            _ => summary.rejected += 1,
        }
    }
    for edge in &gt_edges {
        if edge.selected_candidate_ids.is_empty() {
            summary.gt_edges_without_candidate +=
                usize::from(edge.root_cause == "no_candidate_carrier");
        } else {
            summary.gt_edges_with_selected_match += 1;
        }
    }

    CandidateDecisionAudit {
        schema: "oristudio/cp-detect-architecture-inspector/candidate-decision-audit/v1",
        summary,
        candidates,
        gt_edges,
    }
}

fn conflicts_by_candidate(
    graph: &CandidateGraph,
    selected_ids: &BTreeSet<usize>,
) -> BTreeMap<usize, Vec<DecisionConflictRecord>> {
    let mut by_candidate = BTreeMap::<usize, Vec<DecisionConflictRecord>>::new();
    for conflict in graph.conflicts.iter().chain(graph.alternatives.iter()) {
        let touches_selected = conflict
            .candidate_ids
            .iter()
            .any(|candidate_id| selected_ids.contains(candidate_id));
        for candidate_id in &conflict.candidate_ids {
            by_candidate
                .entry(*candidate_id)
                .or_default()
                .push(DecisionConflictRecord {
                    id: conflict.id,
                    kind: json_label(&conflict.kind),
                    candidate_ids: conflict.candidate_ids.clone(),
                    hard: conflict.hard,
                    reason: conflict.reason.clone(),
                    touches_selected,
                });
        }
    }
    by_candidate
}

fn selection_decision_label(decision: &SelectionDecision) -> &'static str {
    match decision {
        SelectionDecision::Selected => "selected",
        SelectionDecision::Rejected => "rejected",
        SelectionDecision::Undecided => "undecided",
    }
}

fn reason_category(
    decision: &str,
    conflicts: &[DecisionConflictRecord],
    replaced_by: &[usize],
    policy: &oristudio_cp_compiler::CandidateSelectionPolicy,
) -> String {
    if decision == "selected" {
        return if json_label(policy) == "locked" {
            "locked".to_owned()
        } else {
            "selected".to_owned()
        };
    }
    if !replaced_by.is_empty() {
        return "dominated".to_owned();
    }
    if conflicts
        .iter()
        .any(|conflict| conflict.hard && conflict.touches_selected)
    {
        return "conflict".to_owned();
    }
    if decision == "undecided" {
        return "available".to_owned();
    }
    if json_label(policy) == "discouraged" {
        return "policy".to_owned();
    }
    if decision == "not_considered" {
        return "not_considered".to_owned();
    }
    "cost".to_owned()
}

fn candidate_endpoint_points(graph: &CandidateGraph, vertices: [usize; 2]) -> Option<[Point2; 2]> {
    Some([
        graph.vertices.get(vertices[0])?.point,
        graph.vertices.get(vertices[1])?.point,
    ])
}

fn gt_edge_audits(
    ground_truth: &GroundTruthGraphPayload,
    candidates: &[CandidateDecisionRecord],
    overlay_frame_px: OverlayFramePx,
) -> Vec<GtEdgeAuditRecord> {
    ground_truth
        .edges_vertices
        .iter()
        .enumerate()
        .map(|(gt_edge_id, vertices)| {
            let gt_a = point_from_gt(ground_truth.vertices_px.get(vertices[0]).copied());
            let gt_b = point_from_gt(ground_truth.vertices_px.get(vertices[1]).copied());
            let mut matches = match (gt_a, gt_b) {
                (Some(gt_a), Some(gt_b)) => candidates
                    .iter()
                    .filter_map(|candidate| {
                        let [candidate_a, candidate_b] = candidate.endpoint_points?;
                        let candidate_a = point_to_overlay_frame(candidate_a, overlay_frame_px);
                        let candidate_b = point_to_overlay_frame(candidate_b, overlay_frame_px);
                        let distance =
                            symmetric_segment_distance(gt_a, gt_b, candidate_a, candidate_b);
                        let angle =
                            segment_angle_delta_degrees(gt_a, gt_b, candidate_a, candidate_b);
                        Some(GtCandidateMatchRecord {
                            candidate_id: candidate.id,
                            decision: candidate.decision.clone(),
                            reason_category: candidate.reason_category.clone(),
                            distance_px: distance,
                            angle_delta_degrees: angle,
                            selected: candidate.decision == "selected",
                        })
                    })
                    .collect::<Vec<_>>(),
                _ => Vec::new(),
            };
            matches.sort_by(|left, right| {
                gt_match_score(left)
                    .total_cmp(&gt_match_score(right))
                    .then_with(|| left.candidate_id.cmp(&right.candidate_id))
            });
            matches.truncate(8);
            let selected_candidate_ids = matches
                .iter()
                .filter(|candidate| {
                    candidate.selected
                        && candidate.distance_px <= 10.0
                        && candidate.angle_delta_degrees <= 10.0
                })
                .map(|candidate| candidate.candidate_id)
                .collect::<Vec<_>>();
            let best_candidate_ids = matches
                .iter()
                .take(4)
                .map(|candidate| candidate.candidate_id)
                .collect::<Vec<_>>();
            let root_cause = gt_root_cause(&matches, &selected_candidate_ids);
            GtEdgeAuditRecord {
                gt_edge_id,
                vertices: *vertices,
                assignment_label: ground_truth
                    .edges_assignment_labels
                    .get(gt_edge_id)
                    .cloned()
                    .unwrap_or_else(|| "U".to_owned()),
                root_cause,
                best_candidate_ids,
                selected_candidate_ids,
                matches,
            }
        })
        .collect()
}

fn gt_root_cause(matches: &[GtCandidateMatchRecord], selected_candidate_ids: &[usize]) -> String {
    if !selected_candidate_ids.is_empty() {
        return "selected".to_owned();
    }
    let Some(best) = matches.first() else {
        return "no_candidate_carrier".to_owned();
    };
    if best.distance_px > 18.0 || best.angle_delta_degrees > 16.0 {
        return "no_candidate_carrier".to_owned();
    }
    match best.reason_category.as_str() {
        "available" => "candidate_lost_by_score".to_owned(),
        "conflict" => "candidate_rejected_by_conflict".to_owned(),
        "dominated" => "candidate_dominated_or_replaced".to_owned(),
        "policy" => "candidate_rejected_by_policy".to_owned(),
        other => format!("candidate_{other}"),
    }
}

fn gt_match_score(candidate: &GtCandidateMatchRecord) -> f64 {
    candidate.distance_px + candidate.angle_delta_degrees * 0.65
}

fn point_from_gt(point: Option<[f64; 2]>) -> Option<Point2> {
    point.map(|[x, y]| Point2::new(x, y))
}

fn point_to_overlay_frame(point: Point2, frame: OverlayFramePx) -> Point2 {
    Point2::new(
        frame.x_min + point.x * (frame.x_max - frame.x_min),
        frame.y_min + point.y * (frame.y_max - frame.y_min),
    )
}

fn symmetric_segment_distance(a0: Point2, a1: Point2, b0: Point2, b1: Point2) -> f64 {
    let a_to_b = (point_segment_distance(a0, b0, b1) + point_segment_distance(a1, b0, b1)) * 0.5;
    let b_to_a = (point_segment_distance(b0, a0, a1) + point_segment_distance(b1, a0, a1)) * 0.5;
    let endpoint_direct = ((point_distance(a0, b0) + point_distance(a1, b1)) * 0.5)
        .min((point_distance(a0, b1) + point_distance(a1, b0)) * 0.5);
    a_to_b.min(b_to_a).min(endpoint_direct)
}

fn point_segment_distance(point: Point2, a: Point2, b: Point2) -> f64 {
    let ab_x = b.x - a.x;
    let ab_y = b.y - a.y;
    let denom = ab_x * ab_x + ab_y * ab_y;
    if denom <= 1e-9 {
        return point_distance(point, a);
    }
    let t = (((point.x - a.x) * ab_x + (point.y - a.y) * ab_y) / denom).clamp(0.0, 1.0);
    let projection = Point2::new(a.x + ab_x * t, a.y + ab_y * t);
    point_distance(point, projection)
}

fn point_distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn segment_angle_delta_degrees(a0: Point2, a1: Point2, b0: Point2, b1: Point2) -> f64 {
    let a = (a1.y - a0.y).atan2(a1.x - a0.x);
    let b = (b1.y - b0.y).atan2(b1.x - b0.x);
    let mut delta = (a - b).abs().rem_euclid(std::f64::consts::PI);
    if delta > std::f64::consts::FRAC_PI_2 {
        delta = std::f64::consts::PI - delta;
    }
    delta.to_degrees()
}

fn json_label<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".to_owned())
}

fn selection_with_exact_roles(
    mut selection: CandidateSelection,
    exact_input: &ExactSolveInput,
) -> CandidateSelection {
    let roles = exact_input
        .selected_spans
        .iter()
        .map(|span| (span.id, (span.boundary_role(), span.reasons.clone())))
        .collect::<BTreeMap<_, _>>();
    for span in &mut selection.selected_spans {
        let Some((boundary_role, reasons)) = roles.get(&span.id) else {
            continue;
        };
        span.boundary_role = *boundary_role;
        for reason in reasons {
            if !span.reasons.iter().any(|existing| existing == reason) {
                span.reasons.push(reason.clone());
            }
        }
    }
    selection
}

fn read_legacy_graph(
    state: &AppState,
    sample: &DenseCacheSample,
    threshold: f32,
    _overlay_frame_px: OverlayFramePx,
) -> Result<Option<GroundTruthGraphPayload>> {
    let outputs = read_dense_outputs(state, sample)?;
    let decoded = decode_dense_outputs(
        outputs.as_dense_outputs(),
        DecodeConfig {
            image_size: sample.image_size,
            threshold,
            ..DecodeConfig::default()
        },
    )
    .with_context(|| format!("decode legacy graph for {}", sample.id))?;
    let value: Value = serde_json::from_str(&decoded.fold_json)
        .with_context(|| format!("parse legacy FOLD for {}", sample.id))?;
    let vertices_coords = parse_point_array(
        value
            .get("vertices_coords")
            .ok_or_else(|| anyhow!("legacy FOLD for {} missing vertices_coords", sample.id))?,
    )?;
    let frame = default_overlay_frame(sample.image_size);
    let vertices_px = vertices_coords
        .into_iter()
        .map(|[x, y]| {
            [
                frame.x_min + x * (frame.x_max - frame.x_min),
                frame.y_min + y * (frame.y_max - frame.y_min),
            ]
        })
        .collect::<Vec<_>>();
    let edges_vertices = parse_usize_pair_array(
        value
            .get("edges_vertices")
            .ok_or_else(|| anyhow!("legacy FOLD for {} missing edges_vertices", sample.id))?,
    )?;
    let edges_assignment_labels = value
        .get("edges_assignment")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .map(|value| value.as_str().unwrap_or("U").to_owned())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec!["U".to_owned(); edges_vertices.len()]);
    Ok(Some(GroundTruthGraphPayload {
        image_size: sample.image_size,
        vertices_px,
        edges_vertices,
        edges_assignment_labels,
    }))
}

fn legacy_graph_from_dense_outputs(
    outputs: &DenseOutputsOwned,
    image_size: u32,
    threshold: f32,
) -> Result<Option<GroundTruthGraphPayload>> {
    let decoded = decode_dense_outputs(
        outputs.as_dense_outputs(),
        DecodeConfig {
            image_size,
            threshold,
            ..DecodeConfig::default()
        },
    )
    .context("decode legacy graph for uploaded image")?;
    let value: Value =
        serde_json::from_str(&decoded.fold_json).context("parse uploaded legacy FOLD")?;
    let vertices_coords = parse_point_array(
        value
            .get("vertices_coords")
            .ok_or_else(|| anyhow!("uploaded legacy FOLD missing vertices_coords"))?,
    )?;
    let frame = default_overlay_frame(image_size);
    let vertices_px = vertices_coords
        .into_iter()
        .map(|[x, y]| {
            [
                frame.x_min + x * (frame.x_max - frame.x_min),
                frame.y_min + y * (frame.y_max - frame.y_min),
            ]
        })
        .collect::<Vec<_>>();
    let edges_vertices = parse_usize_pair_array(
        value
            .get("edges_vertices")
            .ok_or_else(|| anyhow!("uploaded legacy FOLD missing edges_vertices"))?,
    )?;
    let edges_assignment_labels = value
        .get("edges_assignment")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .map(|value| value.as_str().unwrap_or("U").to_owned())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec!["U".to_owned(); edges_vertices.len()]);
    Ok(Some(GroundTruthGraphPayload {
        image_size,
        vertices_px,
        edges_vertices,
        edges_assignment_labels,
    }))
}

fn read_ground_truth_graph(
    state: &AppState,
    sample: &DenseCacheSample,
) -> Result<Option<GroundTruthGraphPayload>> {
    let Some(relative_path) = sample.gt_graph.as_deref() else {
        return Ok(None);
    };
    let path = resolve_pack_path(state, relative_path);
    if !path.exists() {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(
        &fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?,
    )
    .with_context(|| format!("parse {}", path.display()))?;
    let image_size = value
        .get("image_size")
        .and_then(Value::as_u64)
        .unwrap_or(sample.image_size as u64) as u32;
    let vertices_px = parse_point_array(
        value
            .get("vertices_px")
            .ok_or_else(|| anyhow!("{} missing vertices_px", path.display()))?,
    )?;
    let edges_vertices = parse_usize_pair_array(
        value
            .get("edges_vertices")
            .ok_or_else(|| anyhow!("{} missing edges_vertices", path.display()))?,
    )?;
    let edges_assignment_labels = value
        .get("edges_assignment_labels")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .map(|value| value.as_str().unwrap_or("U").to_owned())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec!["U".to_owned(); edges_vertices.len()]);
    Ok(Some(GroundTruthGraphPayload {
        image_size,
        vertices_px,
        edges_vertices,
        edges_assignment_labels,
    }))
}

fn resolve_pack_path(state: &AppState, relative_path: &str) -> PathBuf {
    let path = PathBuf::from(relative_path);
    if path.is_absolute() {
        return path;
    }
    let from_pack = state.pack_root.join(&path);
    if from_pack.exists() {
        return from_pack;
    }
    state.manifest_root.join(path)
}

fn parse_point_array(value: &Value) -> Result<Vec<[f64; 2]>> {
    let points = value
        .as_array()
        .ok_or_else(|| anyhow!("expected point array"))?;
    points
        .iter()
        .map(|point| {
            let coords = point.as_array().ok_or_else(|| anyhow!("expected point"))?;
            if coords.len() < 2 {
                bail!("expected 2D point");
            }
            Ok([
                coords[0].as_f64().context("point x should be numeric")?,
                coords[1].as_f64().context("point y should be numeric")?,
            ])
        })
        .collect()
}

fn parse_usize_pair_array(value: &Value) -> Result<Vec<[usize; 2]>> {
    let pairs = value
        .as_array()
        .ok_or_else(|| anyhow!("expected pair array"))?;
    pairs
        .iter()
        .map(|pair| {
            let values = pair.as_array().ok_or_else(|| anyhow!("expected pair"))?;
            if values.len() < 2 {
                bail!("expected pair");
            }
            Ok([
                values[0]
                    .as_u64()
                    .context("pair first value should be uint")? as usize,
                values[1]
                    .as_u64()
                    .context("pair second value should be uint")? as usize,
            ])
        })
        .collect()
}

fn example_row(sample: &DenseCacheSample) -> ExampleRow {
    ExampleRow {
        id: sample.id.clone(),
        source_id: sample.source_id.clone(),
        family: sample.family.clone(),
        profile: sample.profile.clone(),
        edge_count: sample.edge_count,
        image_size: sample.image_size,
        threshold: sample.threshold,
        input_image_url: format!("/assets/input/{}.png", sample.id),
    }
}

fn evidence_config_from_decode(config: &DecodeConfig) -> EvidenceExtractionConfig {
    EvidenceExtractionConfig {
        image_size: config.image_size,
        line_threshold: (config.threshold * 0.55).max(0.10).min(config.threshold),
        strong_line_support: config.min_edge_support,
        min_line_length_px: config.min_edge_length_px,
        edge_sample_step_px: config.edge_sample_step_px,
        assignment_min_confidence: config.assignment_min_confidence,
        hough_vote_threshold: ((config.hough_vote_threshold as f32 * 0.60).round() as u32)
            .max(1)
            .min(config.hough_vote_threshold.max(1)),
        hough_min_segment_length_px: config.hough_min_segment_length_px,
        hough_max_segment_gap_px: config.hough_max_segment_gap_px,
        max_line_primitives: config.max_line_hypotheses.max(360),
        max_junction_primitives: config.max_intersection_lines.max(240),
        max_boundary_contact_primitives: config.max_intersection_lines.max(240),
        primitive_nms_radius_px: config.junction_snap_px.max(2.0),
        junction_offset_cluster_radius_px: config.junction_offset_cluster_radius_px,
    }
}

fn candidate_strategy_from_query(
    query: &BTreeMap<String, String>,
) -> Result<CandidateGenerationStrategyName> {
    let default_strategy = CandidateGenerationStrategyName::default();
    let value = query
        .get("strategy")
        .or_else(|| query.get("candidate_strategy"))
        .or_else(|| query.get("candidate_source"))
        .map(String::as_str)
        .unwrap_or_else(|| default_strategy.id());
    value
        .parse::<CandidateGenerationStrategyName>()
        .with_context(|| format!("parse candidate generation strategy {value:?}"))
}

fn stage_threshold_from_query_or_sample(
    query: &BTreeMap<String, String>,
    sample: &DenseCacheSample,
) -> f32 {
    query
        .get("threshold")
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(sample.threshold)
}

const DEFAULT_WEAK_ENDPOINT_SNAP_RADIUS_PX: f64 = 12.0;

fn arrangement_input_from_evidence(
    evidence: &CompilerEvidence,
    overlay_frame_px: Option<OverlayFramePx>,
) -> ArrangementV2Input {
    ArrangementV2Input {
        image_size: evidence.image_size,
        paper_frame_px: overlay_frame_px.map(|frame| ArrangementPaperFramePx {
            x_min: frame.x_min,
            y_min: frame.y_min,
            x_max: frame.x_max,
            y_max: frame.y_max,
        }),
        line_primitives: evidence
            .line_primitives
            .iter()
            .enumerate()
            .map(|(id, primitive)| ArrangementLinePrimitive {
                id,
                p0: point_from_array(primitive.p0),
                p1: point_from_array(primitive.p1),
                support: primitive.support as f64,
                votes: primitive.votes,
                assignment: assignment_from_evidence(&primitive.assignment),
                style_support: primitive.style.dashed_or_gapped_support as f64,
                source: source_from_primitive(primitive.source),
            })
            .collect(),
        junction_primitives: evidence
            .junction_primitives
            .iter()
            .enumerate()
            .map(|(id, primitive)| ArrangementJunctionPrimitive {
                id,
                point: point_from_array(primitive.point),
                support: primitive.support as f64,
                source: source_from_primitive(primitive.source),
            })
            .collect(),
        boundary_contact_primitives: evidence
            .boundary_contact_primitives
            .iter()
            .enumerate()
            .map(|(id, primitive)| ArrangementBoundaryContactPrimitive {
                id,
                point: point_from_array(primitive.point),
                side: side_from_boundary(primitive.side),
                side_coordinate: primitive.side_coordinate as f64,
                support: primitive.support as f64,
                source: source_from_primitive(primitive.source),
            })
            .collect(),
    }
}

fn overlay_frame_for_sample(state: &AppState, sample: &DenseCacheSample) -> Result<OverlayFramePx> {
    let default = default_overlay_frame(sample.image_size);
    let Some(input_parent) = state
        .pack_root
        .join(&sample.input_png)
        .parent()
        .map(Path::to_path_buf)
    else {
        return Ok(default);
    };
    let metadata_path = input_parent.join("render_metadata.json");
    if !metadata_path.exists() {
        return Ok(default);
    }
    let metadata: Value = serde_json::from_str(
        &fs::read_to_string(&metadata_path)
            .with_context(|| format!("read {}", metadata_path.display()))?,
    )
    .with_context(|| format!("parse {}", metadata_path.display()))?;
    let Some(frame) = metadata
        .get("v2_boundary")
        .and_then(|value| value.get("frame"))
    else {
        return Ok(default);
    };
    let parsed = OverlayFramePx {
        x_min: frame
            .get("x_min")
            .and_then(Value::as_f64)
            .unwrap_or(default.x_min),
        y_min: frame
            .get("y_min")
            .and_then(Value::as_f64)
            .unwrap_or(default.y_min),
        x_max: frame
            .get("x_max")
            .and_then(Value::as_f64)
            .unwrap_or(default.x_max),
        y_max: frame
            .get("y_max")
            .and_then(Value::as_f64)
            .unwrap_or(default.y_max),
    };
    if parsed.x_max <= parsed.x_min || parsed.y_max <= parsed.y_min {
        return Ok(default);
    }
    Ok(parsed)
}

fn default_overlay_frame(image_size: u32) -> OverlayFramePx {
    let max = image_size.saturating_sub(1).max(1) as f64;
    OverlayFramePx {
        x_min: 0.0,
        y_min: 0.0,
        x_max: max,
        y_max: max,
    }
}

fn point_from_array(point: [f32; 2]) -> Point2 {
    Point2::new(point[0] as f64, point[1] as f64)
}

fn assignment_from_evidence(assignment: &AssignmentEvidence) -> AssignmentCandidate {
    AssignmentCandidate {
        label: match assignment.label {
            0 => AssignmentLabel::Mountain,
            1 => AssignmentLabel::Valley,
            2 => AssignmentLabel::Boundary,
            _ => AssignmentLabel::Unknown,
        },
        confidence: assignment.confidence as f64,
        margin: assignment.margin as f64,
    }
}

fn source_from_primitive(source: PrimitiveSource) -> EvidenceSource {
    match source {
        PrimitiveSource::ObservedStrong => EvidenceSource::ObservedStrong,
        PrimitiveSource::ObservedWeak => EvidenceSource::ObservedWeak,
    }
}

fn side_from_boundary(side: BoundarySide) -> ArrangementBoundarySide {
    match side {
        BoundarySide::Top => ArrangementBoundarySide::Top,
        BoundarySide::Right => ArrangementBoundarySide::Right,
        BoundarySide::Bottom => ArrangementBoundarySide::Bottom,
        BoundarySide::Left => ArrangementBoundarySide::Left,
    }
}

pub struct DenseOutputsOwned {
    pub line_logits: Vec<f32>,
    pub angle: Option<Vec<f32>>,
    pub junction_logits: Vec<f32>,
    pub junction_offset: Option<Vec<f32>>,
    pub assignment_logits: Vec<f32>,
    pub non_crease_logits: Vec<f32>,
    pub line_style_logits: Vec<f32>,
    pub vertex_type_logits: Option<Vec<f32>>,
    pub boundary_contact_logits: Vec<f32>,
    pub boundary_side_logits: Option<Vec<f32>>,
    pub boundary_offset: Option<Vec<f32>>,
    pub boundary_coord: Option<Vec<f32>>,
}

fn read_dense_outputs(state: &AppState, sample: &DenseCacheSample) -> Result<DenseOutputsOwned> {
    Ok(DenseOutputsOwned {
        line_logits: read_f32_file(&state.manifest_root.join(&sample.line_logits_f32_path))?,
        angle: read_optional_f32_file(&state.manifest_root, sample.angle_f32_path.as_deref())?,
        junction_logits: read_f32_file(
            &state.manifest_root.join(&sample.junction_logits_f32_path),
        )?,
        junction_offset: read_optional_f32_file(
            &state.manifest_root,
            sample.junction_offset_f32_path.as_deref(),
        )?,
        assignment_logits: read_f32_file(
            &state.manifest_root.join(&sample.assignment_logits_f32_path),
        )?,
        non_crease_logits: read_f32_file(
            &state.manifest_root.join(&sample.non_crease_logits_f32_path),
        )?,
        line_style_logits: read_f32_file(
            &state.manifest_root.join(&sample.line_style_logits_f32_path),
        )?,
        vertex_type_logits: read_optional_f32_file(
            &state.manifest_root,
            sample.vertex_type_logits_f32_path.as_deref(),
        )?,
        boundary_contact_logits: read_f32_file(
            &state
                .manifest_root
                .join(&sample.boundary_contact_logits_f32_path),
        )?,
        boundary_side_logits: read_optional_f32_file(
            &state.manifest_root,
            sample.boundary_side_logits_f32_path.as_deref(),
        )?,
        boundary_offset: read_optional_f32_file(
            &state.manifest_root,
            sample.boundary_offset_f32_path.as_deref(),
        )?,
        boundary_coord: read_optional_f32_file(
            &state.manifest_root,
            sample.boundary_coord_f32_path.as_deref(),
        )?,
    })
}

impl DenseOutputsOwned {
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

    fn as_dense_refs(&self) -> DenseOutputRefs<'_> {
        DenseOutputRefs::from_legacy_heads(
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

fn dense_tensor_summaries(outputs: &DenseOutputsOwned, image_size: u32) -> Vec<Value> {
    let pixel_count = image_size as usize * image_size as usize;
    let mut summaries = Vec::new();
    push_tensor_summary(
        &mut summaries,
        "line_logits",
        &outputs.line_logits,
        pixel_count,
        image_size,
    );
    push_optional_tensor_summary(
        &mut summaries,
        "angle",
        outputs.angle.as_deref(),
        pixel_count,
        image_size,
    );
    push_tensor_summary(
        &mut summaries,
        "junction_logits",
        &outputs.junction_logits,
        pixel_count,
        image_size,
    );
    push_optional_tensor_summary(
        &mut summaries,
        "junction_offset",
        outputs.junction_offset.as_deref(),
        pixel_count,
        image_size,
    );
    push_tensor_summary(
        &mut summaries,
        "assignment_logits",
        &outputs.assignment_logits,
        pixel_count,
        image_size,
    );
    push_tensor_summary(
        &mut summaries,
        "non_crease_logits",
        &outputs.non_crease_logits,
        pixel_count,
        image_size,
    );
    push_tensor_summary(
        &mut summaries,
        "line_style_logits",
        &outputs.line_style_logits,
        pixel_count,
        image_size,
    );
    push_optional_tensor_summary(
        &mut summaries,
        "vertex_type_logits",
        outputs.vertex_type_logits.as_deref(),
        pixel_count,
        image_size,
    );
    push_tensor_summary(
        &mut summaries,
        "boundary_contact_logits",
        &outputs.boundary_contact_logits,
        pixel_count,
        image_size,
    );
    push_optional_tensor_summary(
        &mut summaries,
        "boundary_side_logits",
        outputs.boundary_side_logits.as_deref(),
        pixel_count,
        image_size,
    );
    push_optional_tensor_summary(
        &mut summaries,
        "boundary_offset",
        outputs.boundary_offset.as_deref(),
        pixel_count,
        image_size,
    );
    push_optional_tensor_summary(
        &mut summaries,
        "boundary_coord",
        outputs.boundary_coord.as_deref(),
        pixel_count,
        image_size,
    );
    summaries
}

fn push_optional_tensor_summary(
    summaries: &mut Vec<Value>,
    id: &'static str,
    values: Option<&[f32]>,
    pixel_count: usize,
    image_size: u32,
) {
    if let Some(values) = values {
        push_tensor_summary(summaries, id, values, pixel_count, image_size);
    }
}

fn push_tensor_summary(
    summaries: &mut Vec<Value>,
    id: &'static str,
    values: &[f32],
    pixel_count: usize,
    image_size: u32,
) {
    let channels = values.len().checked_div(pixel_count).unwrap_or(0);
    let (min, max, mean) = tensor_stats(values);
    summaries.push(json!({
        "id": id,
        "length": values.len(),
        "dims": [1, channels, image_size, image_size],
        "channels": channels,
        "min": min,
        "max": max,
        "mean": mean
    }));
}

fn tensor_stats(values: &[f32]) -> (f32, f32, f32) {
    if values.is_empty() {
        return (0.0, 0.0, 0.0);
    }
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut sum = 0.0f64;
    for value in values {
        min = min.min(*value);
        max = max.max(*value);
        sum += *value as f64;
    }
    (min, max, (sum / values.len() as f64) as f32)
}

fn read_optional_f32_file(root: &Path, path: Option<&str>) -> Result<Option<Vec<f32>>> {
    path.map(|path| read_f32_file(&root.join(path))).transpose()
}

fn read_f32_file(path: &Path) -> Result<Vec<f32>> {
    let bytes = fs::read(path).with_context(|| format!("read {}", path.display()))?;
    if bytes.len() % 4 != 0 {
        bail!("{} has non-f32 byte length {}", path.display(), bytes.len());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn evidence_maps(evidence: &CompilerEvidence, map_size: usize) -> Result<Vec<MapPayload>> {
    let size = evidence.image_size as usize;
    let mut maps = vec![
        scalar_map(
            "line_probability",
            "line probability",
            &evidence.dense.line_probability,
            size,
            map_size,
        )?,
        scalar_map(
            "non_crease_probability",
            "non-crease probability",
            &evidence.dense.non_crease_probability,
            size,
            map_size,
        )?,
        scalar_map(
            "junction_probability",
            "junction probability",
            &evidence.dense.junction_probability,
            size,
            map_size,
        )?,
        scalar_map(
            "boundary_contact_probability",
            "boundary contact probability",
            &evidence.dense.boundary_contact_probability,
            size,
            map_size,
        )?,
    ];
    for (channel, (id, label)) in [
        ("assignment_mountain", "assignment mountain"),
        ("assignment_valley", "assignment valley"),
        ("assignment_boundary", "assignment boundary"),
        ("assignment_unknown", "assignment unknown"),
    ]
    .into_iter()
    .enumerate()
    {
        maps.push(channel_map(
            id,
            label,
            &evidence.dense.assignment_probability,
            size,
            4,
            channel,
            map_size,
        )?);
    }
    for (channel, (id, label)) in [
        ("line_style_0", "line style 0"),
        ("line_style_dashed", "line style dashed/gapped"),
        ("line_style_faint", "line style faint/gapped"),
        ("line_style_3", "line style 3"),
    ]
    .into_iter()
    .enumerate()
    {
        maps.push(channel_map(
            id,
            label,
            &evidence.dense.line_style_probability,
            size,
            4,
            channel,
            map_size,
        )?);
    }
    Ok(maps)
}

fn scalar_map(
    id: &'static str,
    label: &'static str,
    values: &[f32],
    size: usize,
    map_size: usize,
) -> Result<MapPayload> {
    if values.len() != size * size {
        bail!("{id} length mismatch");
    }
    downsample_map(id, label, size, map_size, |idx| values[idx])
}

fn channel_map(
    id: &'static str,
    label: &'static str,
    values: &[f32],
    size: usize,
    channels: usize,
    channel: usize,
    map_size: usize,
) -> Result<MapPayload> {
    if values.len() != size * size * channels {
        bail!("{id} length mismatch");
    }
    downsample_map(id, label, size, map_size, |idx| {
        values[idx * channels + channel]
    })
}

fn downsample_map(
    id: &'static str,
    label: &'static str,
    size: usize,
    map_size: usize,
    sample: impl Fn(usize) -> f32,
) -> Result<MapPayload> {
    let mut output = Vec::with_capacity(map_size * map_size);
    let mut min_value = f32::INFINITY;
    let mut max_value = f32::NEG_INFINITY;
    for out_y in 0..map_size {
        let y0 = out_y * size / map_size;
        let y1 = ((out_y + 1) * size / map_size).max(y0 + 1).min(size);
        for out_x in 0..map_size {
            let x0 = out_x * size / map_size;
            let x1 = ((out_x + 1) * size / map_size).max(x0 + 1).min(size);
            let mut pooled = 0.0f32;
            for y in y0..y1 {
                for x in x0..x1 {
                    pooled = pooled.max(sample(y * size + x).clamp(0.0, 1.0));
                }
            }
            min_value = min_value.min(pooled);
            max_value = max_value.max(pooled);
            output.push((pooled * 255.0).round().clamp(0.0, 255.0) as u8);
        }
    }
    Ok(MapPayload {
        id,
        label,
        width: map_size,
        height: map_size,
        min: min_value,
        max: max_value,
        values: output,
    })
}

fn serve_input_image(state: &AppState, sample_id: &str) -> Result<HttpResponse> {
    let sample = state
        .manifest
        .samples
        .iter()
        .find(|sample| sample.id == sample_id)
        .ok_or_else(|| anyhow!("unknown sample {sample_id:?}"))?;
    let path = state.pack_root.join(&sample.input_png);
    Ok(HttpResponse {
        status: 200,
        content_type: "image/png",
        body: fs::read(&path).with_context(|| format!("read {}", path.display()))?,
    })
}

fn serve_static(state: &AppState, path: &str) -> Result<HttpResponse> {
    let path = if path == "/" { "/index.html" } else { path };
    let relative = path.trim_start_matches('/');
    if relative.contains("..") {
        bail!("invalid static path");
    }
    let file_path = state.dist.join(relative);
    if file_path.exists() {
        let content_type = content_type_for_path(&file_path);
        return Ok(HttpResponse {
            status: 200,
            content_type,
            body: fs::read(&file_path)?,
        });
    }
    if path.starts_with("/models/") {
        let public_path = state.public.join(relative);
        if public_path.exists() {
            let content_type = content_type_for_path(&public_path);
            return Ok(HttpResponse {
                status: 200,
                content_type,
                body: fs::read(&public_path)?,
            });
        }
    }
    if path.starts_with("/models/") || path.starts_with("/assets/") {
        return Ok(error_response(
            404,
            &format!("static asset not found: {path}"),
        ));
    }
    if path == "/index.html" || !path.starts_with("/api/") {
        return Ok(HttpResponse {
            status: 200,
            content_type: "text/html; charset=utf-8",
            body: b"<!doctype html><meta charset=\"utf-8\"><title>CP Detection Architecture Inspector</title><body><h1>CP Detection Architecture Inspector</h1><p>Run the Vite app with <code>npm --workspace @treemaker/cp-detect-architecture-inspector run dev</code>.</p></body>".to_vec(),
        });
    }
    bail!("not found");
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "json" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn json_response(value: &impl Serialize) -> Result<HttpResponse> {
    Ok(HttpResponse {
        status: 200,
        content_type: "application/json; charset=utf-8",
        body: serde_json::to_vec(value)?,
    })
}

fn error_response(status: u16, message: &str) -> HttpResponse {
    HttpResponse {
        status,
        content_type: "application/json; charset=utf-8",
        body: serde_json::to_vec(&json!({ "error": message })).unwrap_or_default(),
    }
}

fn write_response(stream: &mut TcpStream, response: HttpResponse) -> Result<()> {
    let status_text = match response.status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nConnection: close\r\n\r\n",
        response.status,
        status_text,
        response.content_type,
        response.body.len()
    )?;
    stream.write_all(&response.body)?;
    Ok(())
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16)
        {
            out.push(hex);
            index += 3;
            continue;
        }
        out.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downsample_uses_max_pooling() {
        let values = [
            0.1, 0.2, 0.3, 0.4, //
            0.5, 0.9, 0.1, 0.2, //
            0.1, 0.2, 0.7, 0.8, //
            0.0, 0.1, 0.2, 0.6,
        ];
        let map = scalar_map("test", "test", &values, 4, 2).expect("map");
        assert_eq!(map.values, vec![230, 102, 51, 204]);
    }

    #[test]
    fn query_parser_percent_decodes_values() {
        let (path, query) = split_query("/api/stage1/examples/a%20b?threshold=0.4&map_size=64");
        assert_eq!(path, "/api/stage1/examples/a%20b");
        assert_eq!(query.get("threshold"), Some(&"0.4".to_owned()));
        assert_eq!(query.get("map_size"), Some(&"64".to_owned()));
    }
}
