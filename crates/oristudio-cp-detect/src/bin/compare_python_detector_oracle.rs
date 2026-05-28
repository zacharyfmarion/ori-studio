use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use oristudio_cp_detect::decode::{
    DecodeConfig, DecodeEdgeStageSnapshot, DecoderBackend, DenseOutputs, StageCarrier, StageEdge,
    StageHoughSegment, StageLine, StageVertex, decode_dense_outputs_with_backend,
    decode_edge_stage_snapshot_from_maps,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
struct OracleManifest {
    #[allow(dead_code)]
    schema: String,
    #[serde(default)]
    detector_checkpoint_id: Option<String>,
    config: OracleConfig,
    fixtures: Vec<OracleFixture>,
}

#[derive(Debug, Deserialize)]
struct OracleConfig {
    image_size: u32,
    threshold: f32,
}

#[derive(Debug, Deserialize)]
struct OracleFixture {
    id: String,
    #[serde(default)]
    profile: Option<String>,
    line_mask_pgm_path: String,
    raw_segments_path: String,
    #[serde(default)]
    raw_lines_path: Option<String>,
    carriers_path: String,
    junction_heatmap_f32_path: String,
    #[serde(default)]
    boundary_contact_heatmap_f32_path: Option<String>,
    effective_line_prob_f32_path: String,
    #[serde(default)]
    assignment_labels_pgm_path: Option<String>,
    #[serde(default)]
    line_style_prob_f32_path: Option<String>,
    line_logits_f32_path: String,
    junction_logits_f32_path: String,
    assignment_logits_f32_path: String,
    non_crease_logits_f32_path: String,
    line_style_logits_f32_path: String,
    boundary_contact_logits_f32_path: String,
    vertex_stage_path: String,
    edge_stage_path: String,
    final_stage_path: String,
    #[allow(dead_code)]
    fold_path: String,
    #[allow(dead_code)]
    report_path: String,
}

#[derive(Debug, Deserialize)]
struct PythonCarrier {
    #[allow(dead_code)]
    line: PythonLine,
    p0: Vec<f64>,
    p1: Vec<f64>,
    #[allow(dead_code)]
    t_min: f64,
    #[allow(dead_code)]
    t_max: f64,
    #[allow(dead_code)]
    direction: Vec<f64>,
}

#[derive(Debug, Deserialize)]
struct PythonLine {
    #[allow(dead_code)]
    p0: Vec<f64>,
    #[allow(dead_code)]
    p1: Vec<f64>,
    #[allow(dead_code)]
    theta: f64,
    #[allow(dead_code)]
    rho: f64,
    #[allow(dead_code)]
    support: f64,
    #[allow(dead_code)]
    votes: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct PythonVertexStage {
    intersections: Vec<Vec<f64>>,
    junctions: Vec<Vec<f64>>,
    boundary_contacts: Vec<Vec<f64>>,
    candidate_vertices: Vec<PythonStageVertex>,
    merged_vertices: Vec<PythonStageVertex>,
}

#[derive(Debug, Deserialize)]
struct PythonEdgeStage {
    initial_interior_edges: Vec<PythonStageEdge>,
    vertices_after_drop: Vec<PythonStageVertex>,
    used_boundary: Vec<usize>,
    interior_edges: Vec<PythonStageEdge>,
    border_edges: Vec<PythonStageEdge>,
    combined_edges: Vec<PythonStageEdge>,
    #[serde(default)]
    cleanup_edges: Vec<PythonStageEdge>,
    #[serde(default)]
    final_vertices: Vec<PythonStageVertex>,
    #[serde(default)]
    final_edges: Vec<PythonStageEdge>,
}

#[derive(Debug, Deserialize)]
struct PythonStageEdge {
    vertices: [usize; 2],
    support: f64,
    assignment: u8,
}

#[derive(Debug, Deserialize)]
struct PythonStageVertex {
    point: Vec<f64>,
    kind: String,
}

#[derive(Debug, Serialize)]
struct Report {
    schema: &'static str,
    oracle_manifest: String,
    detector_checkpoint_id: Option<String>,
    config: ReportConfig,
    aggregate: Aggregate,
    fixtures: Vec<FixtureReport>,
}

#[derive(Debug, Serialize)]
struct ReportConfig {
    image_size: u32,
    threshold: f32,
    carrier_tolerance_px: f64,
    decoder_backend: DecoderBackend,
}

#[derive(Debug, Default, Serialize)]
struct Aggregate {
    fixture_count: usize,
    raw_segment_exact_ordered_matches: usize,
    raw_line_ordered_geometry_matches: usize,
    carrier_ordered_geometry_matches: usize,
    candidate_vertex_ordered_matches: usize,
    merged_vertex_ordered_matches: usize,
    initial_interior_edge_ordered_matches: usize,
    vertices_after_drop_ordered_matches: usize,
    interior_edge_ordered_matches: usize,
    border_edge_ordered_matches: usize,
    combined_edge_ordered_matches: usize,
    cleanup_edge_ordered_matches: usize,
    final_vertex_ordered_matches: usize,
    final_edge_ordered_matches: usize,
    final_fold_matches: usize,
    final_report_matches: usize,
    first_divergence_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Serialize)]
struct FixtureReport {
    id: String,
    profile: Option<String>,
    first_divergence: String,
    stages: StageReports,
}

#[derive(Debug, Serialize)]
struct StageReports {
    raw_segments: RawSegmentStageReport,
    raw_lines: LineStageReport,
    carriers: CarrierStageReport,
    intersections: PointListStageReport,
    junctions: PointListStageReport,
    boundary_contacts: PointListStageReport,
    candidate_vertices: VertexStageReport,
    merged_vertices: VertexStageReport,
    initial_interior_edges: EdgeStageReport,
    vertices_after_drop: VertexStageReport,
    used_boundary: IndexListStageReport,
    interior_edges: EdgeStageReport,
    border_edges: EdgeStageReport,
    combined_edges: EdgeStageReport,
    cleanup_edges: EdgeStageReport,
    final_vertices: VertexStageReport,
    final_edges: EdgeStageReport,
    final_fold: FoldStageReport,
    final_report: ReportStageReport,
}

#[derive(Debug, Serialize)]
struct RawSegmentStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    exact_ordered: bool,
    exact_unordered: bool,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct CarrierStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    count_equal: bool,
    ordered_geometry_match: bool,
    max_endpoint_delta_px: Option<f64>,
    mean_endpoint_delta_px: Option<f64>,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct LineStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    count_equal: bool,
    ordered_geometry_match: bool,
    max_endpoint_delta_px: Option<f64>,
    mean_endpoint_delta_px: Option<f64>,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct PointListStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    count_equal: bool,
    ordered_geometry_match: bool,
    max_delta_px: Option<f64>,
    mean_delta_px: Option<f64>,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct VertexStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    count_equal: bool,
    ordered_match: bool,
    ordered_geometry_match: bool,
    max_delta_px: Option<f64>,
    mean_delta_px: Option<f64>,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct EdgeStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    count_equal: bool,
    ordered_match: bool,
    ordered_topology_match: bool,
    max_support_delta: Option<f64>,
    mean_support_delta: Option<f64>,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct IndexListStageReport {
    implemented: bool,
    python_count: usize,
    rust_count: usize,
    exact_ordered: bool,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct FoldStageReport {
    implemented: bool,
    python_vertices: usize,
    rust_vertices: usize,
    python_edges: usize,
    rust_edges: usize,
    vertices_exact: bool,
    edges_exact: bool,
    assignments_exact: bool,
    exact: bool,
    first_difference: Option<Value>,
}

#[derive(Debug, Serialize)]
struct ReportStageReport {
    implemented: bool,
    status_match: bool,
    warning_codes_match: bool,
    repair_action_codes_match: bool,
    exact: bool,
    python_status: Option<String>,
    rust_status: String,
    python_warning_codes: Vec<String>,
    rust_warning_codes: Vec<String>,
    python_repair_action_codes: Vec<String>,
    rust_repair_action_codes: Vec<String>,
    first_difference: Option<Value>,
}

#[derive(Debug)]
struct Args {
    manifest: PathBuf,
    out: Option<PathBuf>,
    carrier_tolerance_px: f64,
    decoder_backend: DecoderBackend,
    allow_mismatch: bool,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let manifest_path = args.manifest;
    let manifest_root = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let manifest: OracleManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let mut fixture_reports = Vec::new();

    for fixture in &manifest.fixtures {
        let (_, _, line_mask) =
            read_pgm(&resolve_path(manifest_root, &fixture.line_mask_pgm_path))?;
        let junction_heatmap = read_f32_map(&resolve_path(
            manifest_root,
            &fixture.junction_heatmap_f32_path,
        ))?;
        let boundary_contact_heatmap = fixture
            .boundary_contact_heatmap_f32_path
            .as_ref()
            .map(|path| read_f32_map(&resolve_path(manifest_root, path)))
            .transpose()?;
        let effective_line_prob = read_f32_map(&resolve_path(
            manifest_root,
            &fixture.effective_line_prob_f32_path,
        ))?;
        let assignment_labels = fixture
            .assignment_labels_pgm_path
            .as_ref()
            .map(|path| read_pgm(&resolve_path(manifest_root, path)).map(|(_, _, data)| data))
            .transpose()?;
        let line_style_prob = fixture
            .line_style_prob_f32_path
            .as_ref()
            .map(|path| read_f32_map(&resolve_path(manifest_root, path)))
            .transpose()?;
        let line_logits =
            read_f32_map(&resolve_path(manifest_root, &fixture.line_logits_f32_path))?;
        let junction_logits = read_f32_map(&resolve_path(
            manifest_root,
            &fixture.junction_logits_f32_path,
        ))?;
        let assignment_logits = read_f32_map(&resolve_path(
            manifest_root,
            &fixture.assignment_logits_f32_path,
        ))?;
        let non_crease_logits = read_f32_map(&resolve_path(
            manifest_root,
            &fixture.non_crease_logits_f32_path,
        ))?;
        let line_style_logits = read_f32_map(&resolve_path(
            manifest_root,
            &fixture.line_style_logits_f32_path,
        ))?;
        let boundary_contact_logits = read_f32_map(&resolve_path(
            manifest_root,
            &fixture.boundary_contact_logits_f32_path,
        ))?;
        let snapshot = decode_edge_stage_snapshot_from_maps(
            &line_mask,
            &effective_line_prob,
            &junction_heatmap,
            boundary_contact_heatmap.as_deref(),
            assignment_labels.as_deref(),
            line_style_prob.as_deref(),
            manifest.config.image_size,
            DecodeConfig {
                image_size: manifest.config.image_size,
                threshold: manifest.config.threshold,
                ..DecodeConfig::default()
            },
        )?;
        let python_segments =
            read_raw_segments(&resolve_path(manifest_root, &fixture.raw_segments_path))?;
        let python_raw_lines = fixture
            .raw_lines_path
            .as_ref()
            .map(|path| read_python_raw_lines(&resolve_path(manifest_root, path)))
            .transpose()?;
        let python_carriers =
            read_python_carriers(&resolve_path(manifest_root, &fixture.carriers_path))?;
        let python_vertex_stage =
            read_python_vertex_stage(&resolve_path(manifest_root, &fixture.vertex_stage_path))?;
        let python_edge_stage =
            read_python_edge_stage(&resolve_path(manifest_root, &fixture.edge_stage_path))?;
        let python_fold: Value = serde_json::from_str(&fs::read_to_string(resolve_path(
            manifest_root,
            &fixture.fold_path,
        ))?)?;
        let python_final_stage: Value = serde_json::from_str(&fs::read_to_string(resolve_path(
            manifest_root,
            &fixture.final_stage_path,
        ))?)?;
        let rust_decoded = decode_dense_outputs_with_backend(
            DenseOutputs {
                line_logits: &line_logits,
                junction_logits: &junction_logits,
                assignment_logits: &assignment_logits,
                non_crease_logits: &non_crease_logits,
                line_style_logits: &line_style_logits,
                boundary_contact_logits: &boundary_contact_logits,
            },
            DecodeConfig {
                image_size: manifest.config.image_size,
                threshold: manifest.config.threshold,
                ..DecodeConfig::default()
            },
            args.decoder_backend,
        )?;
        let rust_fold: Value = serde_json::from_str(&rust_decoded.fold_json)?;

        fixture_reports.push(compare_fixture(
            fixture,
            python_segments,
            python_raw_lines.unwrap_or_default(),
            python_carriers,
            python_vertex_stage,
            python_edge_stage,
            snapshot,
            python_fold,
            rust_fold,
            python_final_stage,
            serde_json::to_value(&rust_decoded.report)?,
            args.carrier_tolerance_px,
        ));
    }

    let aggregate = aggregate(&fixture_reports);
    let report = Report {
        schema: "oristudio/cp-detect-python-oracle-replay/v1",
        oracle_manifest: manifest_path.display().to_string(),
        detector_checkpoint_id: manifest.detector_checkpoint_id,
        config: ReportConfig {
            image_size: manifest.config.image_size,
            threshold: manifest.config.threshold,
            carrier_tolerance_px: args.carrier_tolerance_px,
            decoder_backend: args.decoder_backend,
        },
        aggregate,
        fixtures: fixture_reports,
    };

    if let Some(out) = args.out {
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&out, serde_json::to_string_pretty(&report)? + "\n")?;
        println!("wrote {}", out.display());
    }
    println!("{}", serde_json::to_string_pretty(&report.aggregate)?);
    if !args.allow_mismatch && !report.aggregate.first_divergence_counts.is_empty() {
        return Err("Rust detector replay diverged from Python oracle".into());
    }
    Ok(())
}

fn compare_fixture(
    fixture: &OracleFixture,
    python_segments: Vec<StageHoughSegment>,
    python_raw_lines: Vec<PythonLine>,
    python_carriers: Vec<PythonCarrier>,
    python_vertex_stage: PythonVertexStage,
    python_edge_stage: PythonEdgeStage,
    rust: DecodeEdgeStageSnapshot,
    python_fold: Value,
    rust_fold: Value,
    python_final_stage: Value,
    rust_report: Value,
    carrier_tolerance_px: f64,
) -> FixtureReport {
    let vertex_stage = &rust.vertex_stage;
    let raw_segment_report =
        compare_raw_segments(&python_segments, &vertex_stage.line_stage.raw_segments);
    let raw_lines_report = compare_raw_lines(
        &python_raw_lines,
        &vertex_stage.line_stage.raw_lines,
        carrier_tolerance_px,
    );
    let carrier_report = compare_carriers(
        &python_carriers,
        &vertex_stage.line_stage.carriers,
        carrier_tolerance_px,
    );
    let intersections_report = compare_point_list(
        &python_vertex_stage.intersections,
        &vertex_stage.intersections,
        carrier_tolerance_px,
    );
    let junctions_report = compare_point_list(
        &python_vertex_stage.junctions,
        &vertex_stage.junctions,
        carrier_tolerance_px,
    );
    let boundary_contacts_report = compare_point_list(
        &python_vertex_stage.boundary_contacts,
        &vertex_stage.boundary_contacts,
        carrier_tolerance_px,
    );
    let candidate_vertices_report = compare_vertices(
        &python_vertex_stage.candidate_vertices,
        &vertex_stage.candidate_vertices,
        carrier_tolerance_px,
    );
    let merged_vertices_report = compare_vertices(
        &python_vertex_stage.merged_vertices,
        &vertex_stage.merged_vertices,
        carrier_tolerance_px,
    );
    let initial_interior_edges_report = compare_edges(
        &python_edge_stage.initial_interior_edges,
        &rust.initial_interior_edges,
    );
    let vertices_after_drop_report = compare_vertices(
        &python_edge_stage.vertices_after_drop,
        &rust.vertices_after_drop,
        carrier_tolerance_px,
    );
    let used_boundary_report =
        compare_index_list(&python_edge_stage.used_boundary, &rust.used_boundary);
    let interior_edges_report =
        compare_edges(&python_edge_stage.interior_edges, &rust.interior_edges);
    let border_edges_report = compare_edges(&python_edge_stage.border_edges, &rust.border_edges);
    let combined_edges_report =
        compare_edges(&python_edge_stage.combined_edges, &rust.combined_edges);
    let cleanup_edges_report = compare_edges(&python_edge_stage.cleanup_edges, &rust.cleanup_edges);
    let final_vertices_report = compare_vertices(
        &python_edge_stage.final_vertices,
        &rust.final_vertices,
        carrier_tolerance_px,
    );
    let final_edges_report = compare_edges(&python_edge_stage.final_edges, &rust.final_edges);
    let final_fold_report = compare_fold(&python_fold, &rust_fold);
    let final_report_report = compare_report(&python_final_stage, &rust_report);
    let first_divergence = if !raw_segment_report.exact_ordered {
        "raw_segments"
    } else if !raw_lines_report.ordered_geometry_match {
        "raw_lines"
    } else if !carrier_report.ordered_geometry_match {
        "carriers"
    } else if !intersections_report.ordered_geometry_match {
        "intersections"
    } else if !junctions_report.ordered_geometry_match {
        "junctions"
    } else if !boundary_contacts_report.ordered_geometry_match {
        "boundary_contacts"
    } else if !candidate_vertices_report.ordered_match {
        "candidate_vertices"
    } else if !merged_vertices_report.ordered_match {
        "merged_vertices"
    } else if !initial_interior_edges_report.ordered_match {
        "initial_interior_edges"
    } else if !vertices_after_drop_report.ordered_match {
        "vertices_after_drop"
    } else if !used_boundary_report.exact_ordered {
        "used_boundary"
    } else if !interior_edges_report.ordered_match {
        "interior_edges"
    } else if !border_edges_report.ordered_match {
        "border_edges"
    } else if !combined_edges_report.ordered_match {
        "combined_edges"
    } else if !cleanup_edges_report.ordered_match {
        "cleanup_edges"
    } else if !final_vertices_report.ordered_match {
        "final_vertices"
    } else if !final_edges_report.ordered_match {
        "final_edges"
    } else if !final_fold_report.exact {
        "final_fold"
    } else if !final_report_report.exact {
        "final_report"
    } else {
        "none"
    }
    .to_owned();

    FixtureReport {
        id: fixture.id.clone(),
        profile: fixture.profile.clone(),
        first_divergence,
        stages: StageReports {
            raw_segments: raw_segment_report,
            raw_lines: raw_lines_report,
            carriers: carrier_report,
            intersections: intersections_report,
            junctions: junctions_report,
            boundary_contacts: boundary_contacts_report,
            candidate_vertices: candidate_vertices_report,
            merged_vertices: merged_vertices_report,
            initial_interior_edges: initial_interior_edges_report,
            vertices_after_drop: vertices_after_drop_report,
            used_boundary: used_boundary_report,
            interior_edges: interior_edges_report,
            border_edges: border_edges_report,
            combined_edges: combined_edges_report,
            cleanup_edges: cleanup_edges_report,
            final_vertices: final_vertices_report,
            final_edges: final_edges_report,
            final_fold: final_fold_report,
            final_report: final_report_report,
        },
    }
}

fn compare_raw_lines(
    python: &[PythonLine],
    rust: &[StageLine],
    tolerance_px: f64,
) -> LineStageReport {
    let mut deltas = Vec::new();
    let paired = python.len().min(rust.len());
    let mut first_difference = None;
    for index in 0..paired {
        let delta = line_endpoint_delta(&python[index], &rust[index]);
        deltas.push(delta);
        if delta > tolerance_px && first_difference.is_none() {
            first_difference = Some(json!({
                "index": index,
                "endpoint_delta_px": delta,
                "python": {
                    "p0": &python[index].p0,
                    "p1": &python[index].p1,
                    "theta": python[index].theta,
                    "rho": python[index].rho,
                    "support": python[index].support,
                    "votes": python[index].votes,
                },
                "rust": {
                    "p0": rust[index].p0,
                    "p1": rust[index].p1,
                    "theta": rust[index].theta,
                    "rho": rust[index].rho,
                    "support": rust[index].support,
                    "votes": rust[index].votes,
                },
            }));
        }
    }
    if python.len() != rust.len() && first_difference.is_none() {
        first_difference = Some(json!({
            "index": paired,
            "python": python.get(paired).map(|line| json!({
                "p0": &line.p0,
                "p1": &line.p1,
                "theta": line.theta,
                "rho": line.rho,
                "support": line.support,
                "votes": line.votes,
            })),
            "rust": rust.get(paired).map(|line| json!({
                "p0": line.p0,
                "p1": line.p1,
                "theta": line.theta,
                "rho": line.rho,
                "support": line.support,
                "votes": line.votes,
            })),
        }));
    }
    let max_endpoint_delta_px = deltas.iter().copied().reduce(f64::max);
    let mean_endpoint_delta_px = if deltas.is_empty() {
        None
    } else {
        Some(deltas.iter().sum::<f64>() / deltas.len() as f64)
    };
    let ordered_geometry_match =
        python.len() == rust.len() && deltas.iter().all(|delta| *delta <= tolerance_px);
    LineStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        count_equal: python.len() == rust.len(),
        ordered_geometry_match,
        max_endpoint_delta_px,
        mean_endpoint_delta_px,
        first_difference,
    }
}

fn compare_raw_segments(
    python: &[StageHoughSegment],
    rust: &[StageHoughSegment],
) -> RawSegmentStageReport {
    let exact_ordered = python == rust;
    let mut python_sorted = python.to_vec();
    python_sorted.sort();
    let mut rust_sorted = rust.to_vec();
    rust_sorted.sort();
    RawSegmentStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        exact_ordered,
        exact_unordered: python_sorted == rust_sorted,
        first_difference: first_segment_difference(python, rust),
    }
}

fn compare_carriers(
    python: &[PythonCarrier],
    rust: &[StageCarrier],
    tolerance_px: f64,
) -> CarrierStageReport {
    let mut deltas = Vec::new();
    let paired = python.len().min(rust.len());
    let mut first_difference = None;
    for index in 0..paired {
        let delta = carrier_endpoint_delta(&python[index], &rust[index]);
        deltas.push(delta);
        if delta > tolerance_px && first_difference.is_none() {
            first_difference = Some(json!({
                "index": index,
                "endpoint_delta_px": delta,
                "python": {
                    "p0": &python[index].p0,
                    "p1": &python[index].p1,
                },
                "rust": {
                    "p0": rust[index].p0,
                    "p1": rust[index].p1,
                },
            }));
        }
    }
    if python.len() != rust.len() && first_difference.is_none() {
        first_difference = Some(json!({
            "index": paired,
            "python": python.get(paired).map(|carrier| json!({
                "p0": &carrier.p0,
                "p1": &carrier.p1,
            })),
            "rust": rust.get(paired).map(|carrier| json!({
                "p0": carrier.p0,
                "p1": carrier.p1,
            })),
        }));
    }
    let max_endpoint_delta_px = deltas.iter().copied().reduce(f64::max);
    let mean_endpoint_delta_px = if deltas.is_empty() {
        None
    } else {
        Some(deltas.iter().sum::<f64>() / deltas.len() as f64)
    };
    let ordered_geometry_match =
        python.len() == rust.len() && deltas.iter().all(|delta| *delta <= tolerance_px);
    CarrierStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        count_equal: python.len() == rust.len(),
        ordered_geometry_match,
        max_endpoint_delta_px,
        mean_endpoint_delta_px,
        first_difference,
    }
}

fn compare_point_list(
    python: &[Vec<f64>],
    rust: &[[f32; 2]],
    tolerance_px: f64,
) -> PointListStageReport {
    let (deltas, first_difference) = point_list_deltas(
        python,
        rust,
        tolerance_px,
        |point| json!(point),
        |point| json!(point),
    );
    let max_delta_px = deltas.iter().copied().reduce(f64::max);
    let mean_delta_px = mean(&deltas);
    let ordered_geometry_match =
        python.len() == rust.len() && deltas.iter().all(|delta| *delta <= tolerance_px);
    PointListStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        count_equal: python.len() == rust.len(),
        ordered_geometry_match,
        max_delta_px,
        mean_delta_px,
        first_difference,
    }
}

fn compare_vertices(
    python: &[PythonStageVertex],
    rust: &[StageVertex],
    tolerance_px: f64,
) -> VertexStageReport {
    let paired = python.len().min(rust.len());
    let mut deltas = Vec::new();
    let mut first_difference = None;
    for index in 0..paired {
        let delta = point_distance(&python[index].point, rust[index].point);
        deltas.push(delta);
        if delta > tolerance_px && first_difference.is_none() {
            first_difference = Some(json!({
                "index": index,
                "delta_px": delta,
                "python": {
                    "point": &python[index].point,
                    "kind": &python[index].kind,
                },
                "rust": {
                    "point": rust[index].point,
                    "kind": &rust[index].kind,
                },
                "reason": "point_mismatch",
            }));
        }
    }
    if python.len() != rust.len() && first_difference.is_none() {
        first_difference = Some(json!({
            "index": paired,
            "python": python.get(paired).map(|vertex| json!({
                "point": &vertex.point,
                "kind": &vertex.kind,
            })),
            "rust": rust.get(paired).map(|vertex| json!({
                "point": vertex.point,
                "kind": &vertex.kind,
            })),
        }));
    }
    let mut kind_match = true;
    for index in 0..paired {
        if python[index].kind != rust[index].kind {
            kind_match = false;
            if first_difference.is_none() {
                first_difference = Some(json!({
                    "index": index,
                    "python": {
                        "point": &python[index].point,
                        "kind": &python[index].kind,
                    },
                    "rust": {
                        "point": rust[index].point,
                        "kind": &rust[index].kind,
                    },
                    "reason": "kind_mismatch",
                }));
            }
            break;
        }
    }
    let max_delta_px = deltas.iter().copied().reduce(f64::max);
    let mean_delta_px = mean(&deltas);
    let ordered_geometry_match =
        python.len() == rust.len() && deltas.iter().all(|delta| *delta <= tolerance_px);
    let ordered_match = ordered_geometry_match && kind_match;
    VertexStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        count_equal: python.len() == rust.len(),
        ordered_match,
        ordered_geometry_match,
        max_delta_px,
        mean_delta_px,
        first_difference,
    }
}

fn compare_edges(python: &[PythonStageEdge], rust: &[StageEdge]) -> EdgeStageReport {
    let paired = python.len().min(rust.len());
    let mut support_deltas = Vec::new();
    let mut first_difference = None;
    for index in 0..paired {
        let topology_match = python[index].vertices == rust[index].vertices
            && python[index].assignment == rust[index].assignment;
        let support_delta = (python[index].support - f64::from(rust[index].support)).abs();
        support_deltas.push(support_delta);
        if (!topology_match || support_delta > 1e-5) && first_difference.is_none() {
            first_difference = Some(json!({
                "index": index,
                "support_delta": support_delta,
                "python": {
                    "vertices": python[index].vertices,
                    "support": python[index].support,
                    "assignment": python[index].assignment,
                },
                "rust": {
                    "vertices": rust[index].vertices,
                    "support": rust[index].support,
                    "assignment": rust[index].assignment,
                },
            }));
        }
    }
    if python.len() != rust.len() && first_difference.is_none() {
        first_difference = Some(json!({
            "index": paired,
            "python": python.get(paired).map(|edge| json!({
                "vertices": edge.vertices,
                "support": edge.support,
                "assignment": edge.assignment,
            })),
            "rust": rust.get(paired).map(|edge| json!({
                "vertices": edge.vertices,
                "support": edge.support,
                "assignment": edge.assignment,
            })),
        }));
    }
    let ordered_topology_match = python.len() == rust.len()
        && python.iter().zip(rust.iter()).all(|(left, right)| {
            left.vertices == right.vertices && left.assignment == right.assignment
        });
    let ordered_match = ordered_topology_match && support_deltas.iter().all(|delta| *delta <= 1e-5);
    EdgeStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        count_equal: python.len() == rust.len(),
        ordered_match,
        ordered_topology_match,
        max_support_delta: support_deltas.iter().copied().reduce(f64::max),
        mean_support_delta: mean(&support_deltas),
        first_difference,
    }
}

fn compare_index_list(python: &[usize], rust: &[usize]) -> IndexListStageReport {
    let exact_ordered = python == rust;
    let paired = python.len().min(rust.len());
    let mut first_difference = None;
    for index in 0..paired {
        if python[index] != rust[index] {
            first_difference = Some(json!({
                "index": index,
                "python": python[index],
                "rust": rust[index],
            }));
            break;
        }
    }
    if python.len() != rust.len() && first_difference.is_none() {
        first_difference = Some(json!({
            "index": paired,
            "python": python.get(paired),
            "rust": rust.get(paired),
        }));
    }
    IndexListStageReport {
        implemented: true,
        python_count: python.len(),
        rust_count: rust.len(),
        exact_ordered,
        first_difference,
    }
}

fn compare_fold(python: &Value, rust: &Value) -> FoldStageReport {
    let python_vertices = python["vertices_coords"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let rust_vertices = rust["vertices_coords"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let python_edges = python["edges_vertices"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let rust_edges = rust["edges_vertices"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let python_assignments = python["edges_assignment"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let rust_assignments = rust["edges_assignment"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let (vertices_exact, vertex_difference) =
        compare_vertex_arrays(&python_vertices, &rust_vertices, 1e-6);
    let edges_exact = python_edges == rust_edges;
    let assignments_exact = python_assignments == rust_assignments;
    let first_difference = if !vertices_exact {
        vertex_difference
    } else if !edges_exact {
        Some(first_array_difference(
            "edges_vertices",
            &python_edges,
            &rust_edges,
        ))
    } else if !assignments_exact {
        Some(first_array_difference(
            "edges_assignment",
            &python_assignments,
            &rust_assignments,
        ))
    } else {
        None
    };
    FoldStageReport {
        implemented: true,
        python_vertices: python_vertices.len(),
        rust_vertices: rust_vertices.len(),
        python_edges: python_edges.len(),
        rust_edges: rust_edges.len(),
        vertices_exact,
        edges_exact,
        assignments_exact,
        exact: vertices_exact && edges_exact && assignments_exact,
        first_difference,
    }
}

fn compare_report(python_final_stage: &Value, rust_report: &Value) -> ReportStageReport {
    let python_quality = &python_final_stage["quality_report"];
    let python_status = python_quality["status"].as_str().map(str::to_owned);
    let rust_status = rust_report["status"].as_str().unwrap_or("").to_owned();
    let python_warning_codes = code_list(&python_quality["warnings"]);
    let rust_warning_codes = code_list(&rust_report["warnings"]);
    let python_repair_action_codes = code_list(&python_final_stage["repair"]["actions"]);
    let rust_repair_action_codes = code_list(&rust_report["repair_actions"]);
    let status_match = python_status.as_deref() == Some(rust_status.as_str());
    let warning_codes_match = python_warning_codes == rust_warning_codes;
    let repair_action_codes_match = python_repair_action_codes == rust_repair_action_codes;
    let first_difference = if !status_match {
        Some(json!({
            "field": "status",
            "python": python_status,
            "rust": rust_status,
        }))
    } else if !warning_codes_match {
        Some(json!({
            "field": "warning_codes",
            "python": python_warning_codes,
            "rust": rust_warning_codes,
        }))
    } else if !repair_action_codes_match {
        Some(json!({
            "field": "repair_action_codes",
            "python": python_repair_action_codes,
            "rust": rust_repair_action_codes,
        }))
    } else {
        None
    };
    ReportStageReport {
        implemented: true,
        status_match,
        warning_codes_match,
        repair_action_codes_match,
        exact: status_match && warning_codes_match && repair_action_codes_match,
        python_status,
        rust_status,
        python_warning_codes,
        rust_warning_codes,
        python_repair_action_codes,
        rust_repair_action_codes,
        first_difference,
    }
}

fn code_list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["code"].as_str().map(str::to_owned))
        .collect()
}

fn compare_vertex_arrays(
    python: &[Value],
    rust: &[Value],
    tolerance: f64,
) -> (bool, Option<Value>) {
    let paired = python.len().min(rust.len());
    for index in 0..paired {
        let Some(left) = value_pair(&python[index]) else {
            return (
                false,
                Some(
                    json!({"field": "vertices_coords", "index": index, "python": python[index], "rust": rust[index]}),
                ),
            );
        };
        let Some(right) = value_pair(&rust[index]) else {
            return (
                false,
                Some(
                    json!({"field": "vertices_coords", "index": index, "python": python[index], "rust": rust[index]}),
                ),
            );
        };
        let dx = left[0] - right[0];
        let dy = left[1] - right[1];
        let delta = (dx * dx + dy * dy).sqrt();
        if delta > tolerance {
            return (
                false,
                Some(json!({
                    "field": "vertices_coords",
                    "index": index,
                    "delta": delta,
                    "tolerance": tolerance,
                    "python": python[index],
                    "rust": rust[index],
                })),
            );
        }
    }
    if python.len() != rust.len() {
        return (
            false,
            Some(json!({
                "field": "vertices_coords",
                "index": paired,
                "python": python.get(paired),
                "rust": rust.get(paired),
            })),
        );
    }
    (true, None)
}

fn value_pair(value: &Value) -> Option<[f64; 2]> {
    let array = value.as_array()?;
    if array.len() != 2 {
        return None;
    }
    Some([array[0].as_f64()?, array[1].as_f64()?])
}

fn first_array_difference(name: &'static str, python: &[Value], rust: &[Value]) -> Value {
    let paired = python.len().min(rust.len());
    for index in 0..paired {
        if python[index] != rust[index] {
            return json!({
                "field": name,
                "index": index,
                "python": python[index],
                "rust": rust[index],
            });
        }
    }
    json!({
        "field": name,
        "index": paired,
        "python": python.get(paired),
        "rust": rust.get(paired),
    })
}

fn point_list_deltas(
    python: &[Vec<f64>],
    rust: &[[f32; 2]],
    tolerance_px: f64,
    python_json: impl Fn(&Vec<f64>) -> Value,
    rust_json: impl Fn(&[f32; 2]) -> Value,
) -> (Vec<f64>, Option<Value>) {
    let paired = python.len().min(rust.len());
    let mut deltas = Vec::new();
    let mut first_difference = None;
    for index in 0..paired {
        let delta = point_distance(&python[index], rust[index]);
        deltas.push(delta);
        if delta > tolerance_px && first_difference.is_none() {
            first_difference = Some(json!({
                "index": index,
                "delta_px": delta,
                "python": python_json(&python[index]),
                "rust": rust_json(&rust[index]),
            }));
        }
    }
    if python.len() != rust.len() && first_difference.is_none() {
        first_difference = Some(json!({
            "index": paired,
            "python": python.get(paired).map(&python_json),
            "rust": rust.get(paired).map(&rust_json),
        }));
    }
    (deltas, first_difference)
}

fn mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        None
    } else {
        Some(values.iter().sum::<f64>() / values.len() as f64)
    }
}

fn aggregate(fixtures: &[FixtureReport]) -> Aggregate {
    let mut aggregate = Aggregate {
        fixture_count: fixtures.len(),
        ..Aggregate::default()
    };
    for fixture in fixtures {
        if fixture.stages.raw_segments.exact_ordered {
            aggregate.raw_segment_exact_ordered_matches += 1;
        }
        if fixture.stages.raw_lines.ordered_geometry_match {
            aggregate.raw_line_ordered_geometry_matches += 1;
        }
        if fixture.stages.carriers.ordered_geometry_match {
            aggregate.carrier_ordered_geometry_matches += 1;
        }
        if fixture.stages.candidate_vertices.ordered_match {
            aggregate.candidate_vertex_ordered_matches += 1;
        }
        if fixture.stages.merged_vertices.ordered_match {
            aggregate.merged_vertex_ordered_matches += 1;
        }
        if fixture.stages.initial_interior_edges.ordered_match {
            aggregate.initial_interior_edge_ordered_matches += 1;
        }
        if fixture.stages.vertices_after_drop.ordered_match {
            aggregate.vertices_after_drop_ordered_matches += 1;
        }
        if fixture.stages.interior_edges.ordered_match {
            aggregate.interior_edge_ordered_matches += 1;
        }
        if fixture.stages.border_edges.ordered_match {
            aggregate.border_edge_ordered_matches += 1;
        }
        if fixture.stages.combined_edges.ordered_match {
            aggregate.combined_edge_ordered_matches += 1;
        }
        if fixture.stages.cleanup_edges.ordered_match {
            aggregate.cleanup_edge_ordered_matches += 1;
        }
        if fixture.stages.final_vertices.ordered_match {
            aggregate.final_vertex_ordered_matches += 1;
        }
        if fixture.stages.final_edges.ordered_match {
            aggregate.final_edge_ordered_matches += 1;
        }
        if fixture.stages.final_fold.exact {
            aggregate.final_fold_matches += 1;
        }
        if fixture.stages.final_report.exact {
            aggregate.final_report_matches += 1;
        }
        if fixture.first_divergence != "none" {
            *aggregate
                .first_divergence_counts
                .entry(fixture.first_divergence.clone())
                .or_insert(0) += 1;
        }
    }
    aggregate
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut manifest = None;
        let mut out = None;
        let mut carrier_tolerance_px = 1.0;
        let mut decoder_backend = DecoderBackend::LegacyV2;
        let mut allow_mismatch = false;
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--manifest" => {
                    manifest = Some(PathBuf::from(required_value(&mut iter, "--manifest")?))
                }
                "--out" => out = Some(PathBuf::from(required_value(&mut iter, "--out")?)),
                "--carrier-tolerance-px" => {
                    carrier_tolerance_px =
                        required_value(&mut iter, "--carrier-tolerance-px")?.parse()?;
                }
                "--decoder-backend" => {
                    decoder_backend =
                        parse_decoder_backend(&required_value(&mut iter, "--decoder-backend")?)?;
                }
                "--allow-mismatch" => allow_mismatch = true,
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}").into()),
            }
        }
        Ok(Self {
            manifest: manifest.ok_or("--manifest is required")?,
            out,
            carrier_tolerance_px,
            decoder_backend,
            allow_mismatch,
        })
    }
}

fn parse_decoder_backend(value: &str) -> Result<DecoderBackend, Box<dyn std::error::Error>> {
    match value {
        "legacy-v2" | "legacy_v2" | "legacy_v2_decoder" => Ok(DecoderBackend::LegacyV2),
        "constraint-compiler-v1" | "constraint_compiler_v1" => {
            Ok(DecoderBackend::ConstraintCompilerV1)
        }
        "constraint-compiler-v2" | "constraint_compiler_v2" => {
            Ok(DecoderBackend::ConstraintCompilerV2)
        }
        other => Err(format!("unsupported decoder backend: {other}").into()),
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
        "compare_python_detector_oracle --manifest PATH [--out PATH] \
         [--carrier-tolerance-px 1.0] [--decoder-backend legacy-v2] [--allow-mismatch]"
    );
}

fn resolve_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn read_raw_segments(path: &Path) -> Result<Vec<StageHoughSegment>, Box<dyn std::error::Error>> {
    let rows: Vec<[f64; 4]> = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(rows
        .into_iter()
        .map(|row| StageHoughSegment {
            x1: row[0].round() as i32,
            y1: row[1].round() as i32,
            x2: row[2].round() as i32,
            y2: row[3].round() as i32,
        })
        .collect())
}

fn read_python_raw_lines(path: &Path) -> Result<Vec<PythonLine>, Box<dyn std::error::Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn read_python_carriers(path: &Path) -> Result<Vec<PythonCarrier>, Box<dyn std::error::Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn read_python_vertex_stage(path: &Path) -> Result<PythonVertexStage, Box<dyn std::error::Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn read_python_edge_stage(path: &Path) -> Result<PythonEdgeStage, Box<dyn std::error::Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn read_f32_map(path: &Path) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    if bytes.len() % 4 != 0 {
        return Err(format!(
            "f32 map byte length must be divisible by 4 in {}: {}",
            path.display(),
            bytes.len()
        )
        .into());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn read_pgm(path: &Path) -> Result<(usize, usize, Vec<u8>), Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    let mut idx = 0usize;
    let magic = next_token(&bytes, &mut idx).ok_or("missing PGM magic")?;
    if magic != b"P5" {
        return Err(format!("unsupported PGM magic in {}: {:?}", path.display(), magic).into());
    }
    let width: usize =
        std::str::from_utf8(next_token(&bytes, &mut idx).ok_or("missing PGM width")?)?.parse()?;
    let height: usize =
        std::str::from_utf8(next_token(&bytes, &mut idx).ok_or("missing PGM height")?)?.parse()?;
    let max_value: usize =
        std::str::from_utf8(next_token(&bytes, &mut idx).ok_or("missing PGM max value")?)?
            .parse()?;
    if max_value != 255 {
        return Err(format!(
            "unsupported PGM max value in {}: {max_value}",
            path.display()
        )
        .into());
    }
    while idx < bytes.len() && bytes[idx].is_ascii_whitespace() {
        idx += 1;
    }
    let data = bytes[idx..].to_vec();
    if data.len() != width * height {
        return Err(format!(
            "PGM data length mismatch in {}: expected {}, got {}",
            path.display(),
            width * height,
            data.len()
        )
        .into());
    }
    Ok((width, height, data))
}

fn next_token<'a>(bytes: &'a [u8], idx: &mut usize) -> Option<&'a [u8]> {
    loop {
        while *idx < bytes.len() && bytes[*idx].is_ascii_whitespace() {
            *idx += 1;
        }
        if *idx < bytes.len() && bytes[*idx] == b'#' {
            while *idx < bytes.len() && bytes[*idx] != b'\n' {
                *idx += 1;
            }
            continue;
        }
        break;
    }
    if *idx >= bytes.len() {
        return None;
    }
    let start = *idx;
    while *idx < bytes.len() && !bytes[*idx].is_ascii_whitespace() {
        *idx += 1;
    }
    Some(&bytes[start..*idx])
}

fn first_segment_difference(
    python: &[StageHoughSegment],
    rust: &[StageHoughSegment],
) -> Option<Value> {
    let paired = python.len().min(rust.len());
    for index in 0..paired {
        if python[index] != rust[index] {
            return Some(json!({
                "index": index,
                "python": python[index],
                "rust": rust[index],
            }));
        }
    }
    if python.len() == rust.len() {
        None
    } else {
        Some(json!({
            "index": paired,
            "python": python.get(paired),
            "rust": rust.get(paired),
        }))
    }
}

fn carrier_endpoint_delta(python: &PythonCarrier, rust: &StageCarrier) -> f64 {
    let same = point_distance(&python.p0, rust.p0) + point_distance(&python.p1, rust.p1);
    let swapped = point_distance(&python.p0, rust.p1) + point_distance(&python.p1, rust.p0);
    same.min(swapped) / 2.0
}

fn line_endpoint_delta(python: &PythonLine, rust: &StageLine) -> f64 {
    let same = point_distance(&python.p0, rust.p0) + point_distance(&python.p1, rust.p1);
    let swapped = point_distance(&python.p0, rust.p1) + point_distance(&python.p1, rust.p0);
    same.min(swapped) / 2.0
}

fn point_distance(left: &[f64], right: [f32; 2]) -> f64 {
    if left.len() < 2 {
        return f64::INFINITY;
    }
    let dx = left[0] - f64::from(right[0]);
    let dy = left[1] - f64::from(right[1]);
    (dx * dx + dy * dy).sqrt()
}
