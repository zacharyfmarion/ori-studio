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
    CandidateSelection, SelectionOptions, candidate_graph_from_arrangement_for_selection,
    select_candidate_graph, select_candidate_graph_beam_from_ir,
};
use oristudio_cp_compiler::{
    AssignmentCandidate, AssignmentLabel, CandidateGraph, CandidateProgram, EvidenceSource,
    LegacyCandidateAdapter, Point2,
};
use oristudio_cp_detect::decode::{DecodeConfig, DenseOutputs, decode_dense_outputs};
use oristudio_cp_detect::evidence_extract::{
    AssignmentEvidence, BoundarySide, CompilerEvidence, DenseOutputRefs, EvidenceExtractionConfig,
    PrimitiveSource, extract_compiler_evidence,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8788;
const DEFAULT_DENSE_MANIFEST: &str =
    "artifacts/cp-detect-correctness/dense-cache/smoke-1024-s3-browser-onnx/manifest.json";
const DEFAULT_DIST: &str = "apps/cp-detect-architecture-inspector/dist";
const MAX_MAP_SIZE: usize = 512;

#[derive(Debug, Clone)]
struct Args {
    host: String,
    port: u16,
    dense_manifest: PathBuf,
    dist: PathBuf,
}

#[derive(Debug, Clone)]
struct AppState {
    manifest_path: PathBuf,
    manifest_root: PathBuf,
    pack_root: PathBuf,
    dist: PathBuf,
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
    candidate_source: String,
    candidate_graph: CandidateGraph,
    selection: CandidateSelection,
    exactizability: ExactizabilityReport,
    ground_truth: Option<GroundTruthGraphPayload>,
    legacy_graph: Option<GroundTruthGraphPayload>,
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
         [--dense-manifest artifacts/.../manifest.json] [--dist apps/.../dist]"
    );
}

fn load_state(args: &Args) -> Result<AppState> {
    let manifest_path = args
        .dense_manifest
        .canonicalize()
        .with_context(|| format!("dense manifest {}", args.dense_manifest.display()))?;
    let manifest_root = manifest_path
        .parent()
        .context("manifest should have a parent")?
        .to_path_buf();
    let manifest: DenseCacheManifest = serde_json::from_str(
        &fs::read_to_string(&manifest_path)
            .with_context(|| format!("read {}", manifest_path.display()))?,
    )
    .with_context(|| format!("parse {}", manifest_path.display()))?;
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
        .filter_map(|item| {
            let (key, value) = item.split_once('=').unwrap_or((item, ""));
            Some((percent_decode(key), percent_decode(value)))
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
    let evidence = extract_compiler_evidence(
        DenseOutputRefs {
            line_logits: &outputs.line_logits,
            junction_logits: &outputs.junction_logits,
            assignment_logits: &outputs.assignment_logits,
            non_crease_logits: &outputs.non_crease_logits,
            line_style_logits: &outputs.line_style_logits,
            boundary_contact_logits: &outputs.boundary_contact_logits,
        },
        evidence_config,
    )?;
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
    let evidence = extract_compiler_evidence(
        DenseOutputRefs {
            line_logits: &outputs.line_logits,
            junction_logits: &outputs.junction_logits,
            assignment_logits: &outputs.assignment_logits,
            non_crease_logits: &outputs.non_crease_logits,
            line_style_logits: &outputs.line_style_logits,
            boundary_contact_logits: &outputs.boundary_contact_logits,
        },
        evidence_config,
    )?;
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
    let candidate_source = query
        .get("candidate_source")
        .cloned()
        .unwrap_or_else(|| "arrangement".to_owned());
    let stage2 = stage2_example(state, sample_id, query)?;
    let exact_options = ExactProbeOptions::default();
    let candidate_graph = match candidate_source.as_str() {
        "legacy" => {
            let program = read_legacy_candidate_program(state, sample, stage2.config.threshold)?;
            LegacyCandidateAdapter::from_program(&program)
        }
        "arrangement" | "" => candidate_graph_from_arrangement_for_selection(
            &stage2.arrangement,
            SelectionOptions::default(),
        ),
        other => bail!("unknown candidate_source {other:?}"),
    };
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
        candidate_source,
        candidate_graph,
        selection,
        exactizability,
        ground_truth,
        legacy_graph,
    })
}

fn read_legacy_candidate_program(
    state: &AppState,
    sample: &DenseCacheSample,
    threshold: f32,
) -> Result<CandidateProgram> {
    let outputs = read_dense_outputs(state, sample)?;
    let decoded = decode_dense_outputs(
        DenseOutputs {
            line_logits: &outputs.line_logits,
            junction_logits: &outputs.junction_logits,
            assignment_logits: &outputs.assignment_logits,
            non_crease_logits: &outputs.non_crease_logits,
            line_style_logits: &outputs.line_style_logits,
            boundary_contact_logits: &outputs.boundary_contact_logits,
        },
        DecodeConfig {
            image_size: sample.image_size,
            threshold,
            ..DecodeConfig::default()
        },
    )
    .with_context(|| format!("decode legacy candidate program for {}", sample.id))?;
    let value: Value = serde_json::from_str(&decoded.fold_json)
        .with_context(|| format!("parse legacy FOLD for {}", sample.id))?;
    CandidateProgram::from_fold_value(&value)
        .with_context(|| format!("convert legacy FOLD to candidate program for {}", sample.id))
}

fn read_legacy_graph(
    state: &AppState,
    sample: &DenseCacheSample,
    threshold: f32,
    _overlay_frame_px: OverlayFramePx,
) -> Result<Option<GroundTruthGraphPayload>> {
    let outputs = read_dense_outputs(state, sample)?;
    let decoded = decode_dense_outputs(
        DenseOutputs {
            line_logits: &outputs.line_logits,
            junction_logits: &outputs.junction_logits,
            assignment_logits: &outputs.assignment_logits,
            non_crease_logits: &outputs.non_crease_logits,
            line_style_logits: &outputs.line_style_logits,
            boundary_contact_logits: &outputs.boundary_contact_logits,
        },
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
    }
}

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

struct DenseOutputsOwned {
    line_logits: Vec<f32>,
    junction_logits: Vec<f32>,
    assignment_logits: Vec<f32>,
    non_crease_logits: Vec<f32>,
    line_style_logits: Vec<f32>,
    boundary_contact_logits: Vec<f32>,
}

fn read_dense_outputs(state: &AppState, sample: &DenseCacheSample) -> Result<DenseOutputsOwned> {
    Ok(DenseOutputsOwned {
        line_logits: read_f32_file(&state.manifest_root.join(&sample.line_logits_f32_path))?,
        junction_logits: read_f32_file(
            &state.manifest_root.join(&sample.junction_logits_f32_path),
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
        boundary_contact_logits: read_f32_file(
            &state
                .manifest_root
                .join(&sample.boundary_contact_logits_f32_path),
        )?,
    })
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
    let mut maps = Vec::new();
    maps.push(scalar_map(
        "line_probability",
        "line probability",
        &evidence.dense.line_probability,
        size,
        map_size,
    )?);
    maps.push(scalar_map(
        "non_crease_probability",
        "non-crease probability",
        &evidence.dense.non_crease_probability,
        size,
        map_size,
    )?);
    maps.push(scalar_map(
        "junction_probability",
        "junction probability",
        &evidence.dense.junction_probability,
        size,
        map_size,
    )?);
    maps.push(scalar_map(
        "boundary_contact_probability",
        "boundary contact probability",
        &evidence.dense.boundary_contact_probability,
        size,
        map_size,
    )?);
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
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "json" => "application/json; charset=utf-8",
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
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
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
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                out.push(hex);
                index += 3;
                continue;
            }
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
