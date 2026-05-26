use crate::opencv_hough_lines_p::{HoughLinesPConfig, HoughSegment, hough_lines_p_opencv_cpu};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodeConfig {
    pub image_size: u32,
    pub threshold: f32,
    #[serde(default = "default_min_edge_support")]
    pub min_edge_support: f32,
    #[serde(default = "default_min_edge_length_px")]
    pub min_edge_length_px: f32,
    #[serde(default = "default_edge_sample_step_px")]
    pub edge_sample_step_px: f32,
    #[serde(default = "default_edge_sample_width_px")]
    pub edge_sample_width_px: usize,
    #[serde(default = "default_dashed_support_weight")]
    pub dashed_support_weight: f32,
    #[serde(default = "default_gapped_style_support_weight")]
    pub gapped_style_support_weight: f32,
    #[serde(default = "default_gapped_style_min_confidence")]
    pub gapped_style_min_confidence: f32,
    #[serde(default = "default_gapped_style_line_floor")]
    pub gapped_style_line_floor: f32,
    #[serde(default = "default_assignment_min_confidence")]
    pub assignment_min_confidence: f32,
    #[serde(default = "default_vertex_merge_px")]
    pub vertex_merge_px: f32,
    #[serde(default = "default_line_vertex_distance_px")]
    pub line_vertex_distance_px: f32,
    #[serde(default = "default_hough_vote_threshold")]
    pub hough_vote_threshold: u32,
    #[serde(default = "default_hough_suppression_radius")]
    pub hough_suppression_radius: u32,
    #[serde(default = "default_hough_line_distance_px")]
    pub hough_line_distance_px: f32,
    #[serde(default = "default_hough_min_segment_length_px")]
    pub hough_min_segment_length_px: f32,
    #[serde(default = "default_hough_max_segment_gap_px")]
    pub hough_max_segment_gap_px: f32,
    #[serde(default = "default_carrier_extent_padding_px")]
    pub carrier_extent_padding_px: f32,
    #[serde(default = "default_carrier_merge_angle_degrees")]
    pub carrier_merge_angle_degrees: f32,
    #[serde(default = "default_carrier_merge_rho_px")]
    pub carrier_merge_rho_px: f32,
    #[serde(default = "default_max_line_hypotheses")]
    pub max_line_hypotheses: usize,
    #[serde(default = "default_max_intersection_lines")]
    pub max_intersection_lines: usize,
    #[serde(default = "default_junction_snap_px")]
    pub junction_snap_px: f32,
    #[serde(default = "default_planar_cleanup")]
    pub planar_cleanup: bool,
    #[serde(default = "default_planar_cleanup_max_edges")]
    pub planar_cleanup_max_edges: usize,
    #[serde(default = "default_planar_split_vertex_distance_px")]
    pub planar_split_vertex_distance_px: f32,
    #[serde(default = "default_planar_crossing_support_tie")]
    pub planar_crossing_support_tie: f32,
}

impl Default for DecodeConfig {
    fn default() -> DecodeConfig {
        DecodeConfig {
            image_size: 1024,
            threshold: 0.65,
            min_edge_support: default_min_edge_support(),
            min_edge_length_px: default_min_edge_length_px(),
            edge_sample_step_px: default_edge_sample_step_px(),
            edge_sample_width_px: default_edge_sample_width_px(),
            dashed_support_weight: default_dashed_support_weight(),
            gapped_style_support_weight: default_gapped_style_support_weight(),
            gapped_style_min_confidence: default_gapped_style_min_confidence(),
            gapped_style_line_floor: default_gapped_style_line_floor(),
            assignment_min_confidence: default_assignment_min_confidence(),
            vertex_merge_px: default_vertex_merge_px(),
            line_vertex_distance_px: default_line_vertex_distance_px(),
            hough_vote_threshold: default_hough_vote_threshold(),
            hough_suppression_radius: default_hough_suppression_radius(),
            hough_line_distance_px: default_hough_line_distance_px(),
            hough_min_segment_length_px: default_hough_min_segment_length_px(),
            hough_max_segment_gap_px: default_hough_max_segment_gap_px(),
            carrier_extent_padding_px: default_carrier_extent_padding_px(),
            carrier_merge_angle_degrees: default_carrier_merge_angle_degrees(),
            carrier_merge_rho_px: default_carrier_merge_rho_px(),
            max_line_hypotheses: default_max_line_hypotheses(),
            max_intersection_lines: default_max_intersection_lines(),
            junction_snap_px: default_junction_snap_px(),
            planar_cleanup: default_planar_cleanup(),
            planar_cleanup_max_edges: default_planar_cleanup_max_edges(),
            planar_split_vertex_distance_px: default_planar_split_vertex_distance_px(),
            planar_crossing_support_tie: default_planar_crossing_support_tie(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct DenseOutputs<'a> {
    pub line_logits: &'a [f32],
    pub junction_logits: &'a [f32],
    pub assignment_logits: &'a [f32],
    pub non_crease_logits: &'a [f32],
    pub line_style_logits: &'a [f32],
    pub boundary_contact_logits: &'a [f32],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodedFold {
    pub fold_json: String,
    pub report: DecodeReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodeReport {
    pub status: String,
    pub image_size: u32,
    pub threshold: f32,
    pub line_count: usize,
    pub carrier_count: usize,
    pub vertex_count: usize,
    pub edge_count: usize,
    pub border_edge_count: usize,
    pub interior_edge_count: usize,
    pub warnings: Vec<DecodeWarning>,
    pub repair_actions: Vec<RepairAction>,
    pub quality_report: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodeWarning {
    pub code: String,
    pub message: String,
    pub severity: String,
    #[serde(default)]
    pub edge_indices: Vec<usize>,
    #[serde(default)]
    pub vertex_indices: Vec<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepairAction {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub edge_indices: Vec<usize>,
    #[serde(default)]
    pub vertex_indices: Vec<usize>,
    #[serde(default)]
    pub details: Value,
}

#[derive(Debug, thiserror::Error)]
pub enum DecodeError {
    #[error("invalid image size: {0}")]
    InvalidImageSize(u32),
    #[error("{name} length mismatch: expected {expected}, got {actual}")]
    TensorLength {
        name: &'static str,
        expected: usize,
        actual: usize,
    },
    #[error("{name} byte length mismatch: expected {expected}, got {actual}")]
    BufferLength {
        name: &'static str,
        expected: usize,
        actual: usize,
    },
    #[error("OpenCV-compatible HoughLinesP failed: {0}")]
    Hough(#[from] crate::opencv_hough_lines_p::HoughError),
    #[error("failed to serialize FOLD JSON: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Point {
    x: f32,
    y: f32,
}

#[derive(Debug, Clone)]
struct Line {
    theta: f32,
    rho: f32,
    p0: Point,
    p1: Point,
    direction: Point,
    t_min: f32,
    t_max: f32,
    support: f32,
    votes: usize,
}

#[derive(Debug, Clone)]
struct SegmentLineCandidate {
    p0: [f64; 2],
    p1: [f64; 2],
    theta: f64,
    rho: f64,
    length: f64,
}

#[derive(Debug, Clone)]
struct Edge {
    a: usize,
    b: usize,
    assignment: u8,
    support: f32,
}

#[derive(Debug, Clone)]
struct AttributedEdge {
    edge: Edge,
    confidence: f32,
    margin: f32,
    source: AssignmentSource,
    probabilities: [f32; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssignmentSource {
    Observed,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodeStageSnapshot {
    pub image_size: u32,
    pub raw_segments: Vec<StageHoughSegment>,
    pub raw_lines: Vec<StageLine>,
    pub carriers: Vec<StageCarrier>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct StageHoughSegment {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageLine {
    pub p0: [f32; 2],
    pub p1: [f32; 2],
    pub theta: f32,
    pub rho: f32,
    pub support: f32,
    pub votes: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageCarrier {
    pub line: StageLine,
    pub p0: [f32; 2],
    pub p1: [f32; 2],
    pub t_min: f32,
    pub t_max: f32,
    pub direction: [f32; 2],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodeVertexStageSnapshot {
    pub line_stage: DecodeStageSnapshot,
    pub intersections: Vec<[f32; 2]>,
    pub junctions: Vec<[f32; 2]>,
    pub boundary_contacts: Vec<[f32; 2]>,
    pub candidate_vertices: Vec<StageVertex>,
    pub merged_vertices: Vec<StageVertex>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageVertex {
    pub point: [f32; 2],
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodeEdgeStageSnapshot {
    pub vertex_stage: DecodeVertexStageSnapshot,
    pub initial_interior_edges: Vec<StageEdge>,
    pub vertices_after_drop: Vec<StageVertex>,
    pub used_boundary: Vec<usize>,
    pub interior_edges: Vec<StageEdge>,
    pub border_edges: Vec<StageEdge>,
    pub combined_edges: Vec<StageEdge>,
    pub cleanup_edges: Vec<StageEdge>,
    pub final_vertices: Vec<StageVertex>,
    pub final_edges: Vec<StageEdge>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageEdge {
    pub vertices: [usize; 2],
    pub support: f32,
    pub assignment: u8,
}

pub fn decode_stage_snapshot_from_line_mask(
    line_mask: &[u8],
    image_size: u32,
    mut config: DecodeConfig,
) -> Result<DecodeStageSnapshot, DecodeError> {
    let size = image_size as usize;
    if size < 8 {
        return Err(DecodeError::InvalidImageSize(image_size));
    }
    require_byte_len("line_mask", line_mask, size * size)?;
    config.image_size = image_size;
    let (snapshot, _) = line_stage_from_mask(line_mask, image_size, &config)?;
    Ok(snapshot)
}

pub fn decode_vertex_stage_snapshot_from_maps(
    line_mask: &[u8],
    junction_heatmap: &[f32],
    boundary_contact_heatmap: Option<&[f32]>,
    image_size: u32,
    mut config: DecodeConfig,
) -> Result<DecodeVertexStageSnapshot, DecodeError> {
    let size = image_size as usize;
    if size < 8 {
        return Err(DecodeError::InvalidImageSize(image_size));
    }
    let pixels = size * size;
    require_byte_len("line_mask", line_mask, pixels)?;
    require_len("junction_heatmap", junction_heatmap, pixels)?;
    if let Some(boundary_contact_heatmap) = boundary_contact_heatmap {
        require_len("boundary_contact_heatmap", boundary_contact_heatmap, pixels)?;
    }
    config.image_size = image_size;
    let (line_stage, carriers) = line_stage_from_mask(line_mask, image_size, &config)?;
    let vertex_stage = vertex_stage_from_maps(
        junction_heatmap,
        boundary_contact_heatmap,
        line_mask,
        &carriers,
        &config,
    );
    Ok(DecodeVertexStageSnapshot {
        line_stage,
        intersections: vertex_stage
            .intersections
            .iter()
            .copied()
            .map(point_array)
            .collect(),
        junctions: vertex_stage
            .junctions
            .iter()
            .copied()
            .map(point_array)
            .collect(),
        boundary_contacts: vertex_stage
            .boundary_contacts
            .iter()
            .copied()
            .map(point_array)
            .collect(),
        candidate_vertices: stage_vertices(
            &vertex_stage.candidate_vertices,
            &vertex_stage.candidate_meta,
        ),
        merged_vertices: stage_vertices(&vertex_stage.merged_vertices, &vertex_stage.merged_meta),
    })
}

pub fn decode_edge_stage_snapshot_from_maps(
    line_mask: &[u8],
    effective_line_prob: &[f32],
    junction_heatmap: &[f32],
    boundary_contact_heatmap: Option<&[f32]>,
    assignment_labels: Option<&[u8]>,
    line_style_prob: Option<&[f32]>,
    image_size: u32,
    mut config: DecodeConfig,
) -> Result<DecodeEdgeStageSnapshot, DecodeError> {
    let size = image_size as usize;
    if size < 8 {
        return Err(DecodeError::InvalidImageSize(image_size));
    }
    let pixels = size * size;
    require_byte_len("line_mask", line_mask, pixels)?;
    require_len("effective_line_prob", effective_line_prob, pixels)?;
    require_len("junction_heatmap", junction_heatmap, pixels)?;
    if let Some(boundary_contact_heatmap) = boundary_contact_heatmap {
        require_len("boundary_contact_heatmap", boundary_contact_heatmap, pixels)?;
    }
    if let Some(assignment_labels) = assignment_labels {
        require_byte_len("assignment_labels", assignment_labels, pixels)?;
    }
    if let Some(line_style_prob) = line_style_prob {
        require_len("line_style_prob", line_style_prob, pixels * 4)?;
    }
    config.image_size = image_size;
    let (line_stage, carriers) = line_stage_from_mask(line_mask, image_size, &config)?;
    let raw_vertex_stage = vertex_stage_from_maps(
        junction_heatmap,
        boundary_contact_heatmap,
        line_mask,
        &carriers,
        &config,
    );
    let initial_vertices = raw_vertex_stage.merged_vertices.clone();
    let initial_meta = raw_vertex_stage.merged_meta.clone();
    let initial_interior_edges = interior_edges(
        &initial_vertices,
        &carriers,
        effective_line_prob,
        line_style_prob,
        assignment_labels,
        &config,
    );
    let (vertices_after_drop, mut interior_edges, used_boundary) = drop_unused_non_border_vertices(
        initial_vertices,
        initial_interior_edges.clone(),
        size,
        &config,
    );
    let refreshed_support = support_for_edges(
        &vertices_after_drop,
        &interior_edges,
        effective_line_prob,
        line_style_prob,
        &config,
    );
    for (edge, support) in interior_edges.iter_mut().zip(refreshed_support.into_iter()) {
        edge.support = support;
    }
    for edge in &mut interior_edges {
        edge.assignment = vote_assignment(
            vertices_after_drop[edge.a],
            vertices_after_drop[edge.b],
            assignment_labels,
            &config,
            3,
        );
    }
    let border_edges = border_chain(
        &vertices_after_drop,
        &used_boundary,
        size,
        effective_line_prob,
        &config,
    );
    let mut combined_edges = Vec::new();
    combined_edges.extend(interior_edges.iter().cloned());
    combined_edges.extend(border_edges.iter().cloned());
    dedupe_edges(&mut combined_edges);
    let cleanup_edges = if config.planar_cleanup {
        planar_cleanup(&vertices_after_drop, combined_edges.clone(), &config)
    } else {
        combined_edges.clone()
    };
    let (final_vertices, final_edges) = drop_unused_vertices_keep_corners(
        vertices_after_drop.clone(),
        cleanup_edges.clone(),
        size,
        config.vertex_merge_px,
    );
    Ok(DecodeEdgeStageSnapshot {
        vertex_stage: DecodeVertexStageSnapshot {
            line_stage,
            intersections: raw_vertex_stage
                .intersections
                .iter()
                .copied()
                .map(point_array)
                .collect(),
            junctions: raw_vertex_stage
                .junctions
                .iter()
                .copied()
                .map(point_array)
                .collect(),
            boundary_contacts: raw_vertex_stage
                .boundary_contacts
                .iter()
                .copied()
                .map(point_array)
                .collect(),
            candidate_vertices: stage_vertices(
                &raw_vertex_stage.candidate_vertices,
                &raw_vertex_stage.candidate_meta,
            ),
            merged_vertices: stage_vertices(&raw_vertex_stage.merged_vertices, &initial_meta),
        },
        initial_interior_edges: stage_edges(&initial_interior_edges),
        vertices_after_drop: stage_vertices(
            &vertices_after_drop,
            &refresh_vertex_meta(&vertices_after_drop, size, config.vertex_merge_px),
        ),
        used_boundary,
        interior_edges: stage_edges(&interior_edges),
        border_edges: stage_edges(&border_edges),
        combined_edges: stage_edges(&combined_edges),
        cleanup_edges: stage_edges(&cleanup_edges),
        final_vertices: stage_vertices(
            &final_vertices,
            &refresh_vertex_meta(&final_vertices, size, config.vertex_merge_px),
        ),
        final_edges: stage_edges(&final_edges),
    })
}

impl From<HoughSegment> for StageHoughSegment {
    fn from(segment: HoughSegment) -> Self {
        StageHoughSegment {
            x1: segment.x1,
            y1: segment.y1,
            x2: segment.x2,
            y2: segment.y2,
        }
    }
}

impl From<&Line> for StageLine {
    fn from(line: &Line) -> Self {
        StageLine {
            p0: point_array(line.p0),
            p1: point_array(line.p1),
            theta: line.theta,
            rho: line.rho,
            support: line.support,
            votes: line.votes,
        }
    }
}

impl From<&Line> for StageCarrier {
    fn from(line: &Line) -> Self {
        StageCarrier {
            line: StageLine::from(line),
            p0: point_array(line.p0),
            p1: point_array(line.p1),
            t_min: line.t_min,
            t_max: line.t_max,
            direction: point_array(line.direction),
        }
    }
}

fn point_array(point: Point) -> [f32; 2] {
    [point.x, point.y]
}

struct VertexStage {
    intersections: Vec<Point>,
    junctions: Vec<Point>,
    boundary_contacts: Vec<Point>,
    candidate_vertices: Vec<Point>,
    candidate_meta: Vec<String>,
    merged_vertices: Vec<Point>,
    merged_meta: Vec<String>,
}

fn stage_vertices(points: &[Point], meta: &[String]) -> Vec<StageVertex> {
    points
        .iter()
        .zip(meta.iter())
        .map(|(point, kind)| StageVertex {
            point: point_array(*point),
            kind: kind.clone(),
        })
        .collect()
}

fn stage_edges(edges: &[Edge]) -> Vec<StageEdge> {
    edges
        .iter()
        .map(|edge| StageEdge {
            vertices: [edge.a, edge.b],
            support: edge.support,
            assignment: edge.assignment,
        })
        .collect()
}

fn line_stage_from_mask(
    line_mask: &[u8],
    image_size: u32,
    config: &DecodeConfig,
) -> Result<(DecodeStageSnapshot, Vec<Line>), DecodeError> {
    let size = image_size as usize;
    let segments = hough_lines_p_opencv_cpu(
        line_mask,
        size,
        size,
        &HoughLinesPConfig {
            rho: 1.0,
            theta: std::f32::consts::PI / 720.0,
            threshold: config.hough_vote_threshold.max(1) as i32,
            min_line_length: config.hough_min_segment_length_px as f64,
            max_line_gap: config.hough_max_segment_gap_px as f64,
            lines_max: i32::MAX,
        },
    )?;
    let segments = limit_hough_segments(segments, 12_000);
    let raw_lines = merge_hough_segments_into_raw_lines(&segments, config);
    let carriers = carriers_from_raw_lines(&raw_lines, size, config);
    Ok((
        DecodeStageSnapshot {
            image_size,
            raw_segments: segments
                .iter()
                .copied()
                .map(StageHoughSegment::from)
                .collect(),
            raw_lines: raw_lines.iter().map(StageLine::from).collect(),
            carriers: carriers.iter().map(StageCarrier::from).collect(),
        },
        carriers,
    ))
}

pub fn decode_dense_outputs(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
) -> Result<DecodedFold, DecodeError> {
    let size = config.image_size as usize;
    if size < 8 {
        return Err(DecodeError::InvalidImageSize(config.image_size));
    }
    let pixels = size * size;
    require_len("line_logits", outputs.line_logits, pixels)?;
    require_len("junction_logits", outputs.junction_logits, pixels)?;
    require_len("non_crease_logits", outputs.non_crease_logits, pixels)?;
    require_len(
        "boundary_contact_logits",
        outputs.boundary_contact_logits,
        pixels,
    )?;
    require_len("assignment_logits", outputs.assignment_logits, pixels * 4)?;
    require_len("line_style_logits", outputs.line_style_logits, pixels * 4)?;

    let line_prob = sigmoid_map(outputs.line_logits);
    let effective = effective_line_prob(outputs, &config);
    let (mask, _) = hough_mask(&effective, &config);
    let lines = hough_lines(&effective, &config);
    let carriers: Vec<Line> = lines
        .iter()
        .filter(|line| !line_is_frame_border(line, size))
        .cloned()
        .collect();

    let junction_heatmap = sigmoid_map(outputs.junction_logits);
    let boundary_contact_heatmap = sigmoid_map(outputs.boundary_contact_logits);
    let vertex_stage = vertex_stage_from_maps(
        &junction_heatmap,
        Some(&boundary_contact_heatmap),
        &mask,
        &carriers,
        &config,
    );
    let vertices = vertex_stage.merged_vertices;
    let line_style_prob = line_style_prob_from_logits(outputs.line_style_logits, size);
    let assignment_labels = assignment_labels_from_logits(
        outputs.line_logits,
        outputs.assignment_logits,
        size,
        config.threshold,
    );

    let interior_edges = interior_edges(
        &vertices,
        &carriers,
        &effective,
        Some(&line_style_prob),
        Some(&assignment_labels),
        &config,
    );
    let (vertices, mut interior_edges, used_boundary) =
        drop_unused_non_border_vertices(vertices, interior_edges, size, &config);
    let interior_support_refresh = support_for_edges(
        &vertices,
        &interior_edges,
        &effective,
        Some(&line_style_prob),
        &config,
    );
    for (edge, support) in interior_edges
        .iter_mut()
        .zip(interior_support_refresh.into_iter())
    {
        edge.support = support;
    }
    for edge in &mut interior_edges {
        edge.assignment = vote_assignment(
            vertices[edge.a],
            vertices[edge.b],
            Some(&assignment_labels),
            &config,
            3,
        );
    }
    let mut border_edges = border_chain(&vertices, &used_boundary, size, &effective, &config);
    let mut edges = Vec::new();
    edges.append(&mut interior_edges);
    edges.append(&mut border_edges);
    dedupe_edges(&mut edges);
    if config.planar_cleanup {
        edges = planar_cleanup(&vertices, edges, &config);
    }

    let (mut vertices, edges) =
        drop_unused_vertices_keep_corners(vertices, edges, size, config.vertex_merge_px);
    let mut attributed_edges = attribute_edges_from_logits(
        &vertices,
        &edges,
        outputs.assignment_logits,
        &line_prob,
        &config,
    );
    let repair_actions =
        conservative_repair(&mut vertices, &mut attributed_edges, &line_prob, &config);
    let border_edge_count = attributed_edges
        .iter()
        .filter(|edge| edge.edge.assignment == 2)
        .count();
    let interior_edge_count = attributed_edges.len().saturating_sub(border_edge_count);
    let structural_validity = structural_validity(&vertices, &attributed_edges);
    let warnings = build_quality_warnings(&vertices, &attributed_edges, &structural_validity, size);
    let status = quality_status(
        &warnings,
        &structural_validity,
        &repair_actions,
        attributed_edges.len(),
    );
    let quality_report = quality_report_value(
        status,
        &warnings,
        &structural_validity,
        &repair_actions,
        &vertices,
        &attributed_edges,
    );
    let fold = fold_value(
        &vertices,
        &attributed_edges,
        size,
        &config,
        status,
        &warnings,
        &repair_actions,
        &quality_report,
    );
    Ok(DecodedFold {
        fold_json: serde_json::to_string_pretty(&fold)?,
        report: DecodeReport {
            status: status.to_owned(),
            image_size: config.image_size,
            threshold: config.threshold,
            line_count: lines.len(),
            carrier_count: carriers.len(),
            vertex_count: vertices.len(),
            edge_count: attributed_edges.len(),
            border_edge_count,
            interior_edge_count,
            warnings,
            repair_actions,
            quality_report,
        },
    })
}

fn require_len(name: &'static str, values: &[f32], expected: usize) -> Result<(), DecodeError> {
    if values.len() != expected {
        return Err(DecodeError::TensorLength {
            name,
            expected,
            actual: values.len(),
        });
    }
    Ok(())
}

fn require_byte_len(name: &'static str, values: &[u8], expected: usize) -> Result<(), DecodeError> {
    if values.len() != expected {
        return Err(DecodeError::BufferLength {
            name,
            expected,
            actual: values.len(),
        });
    }
    Ok(())
}

fn effective_line_prob(outputs: DenseOutputs<'_>, config: &DecodeConfig) -> Vec<f32> {
    outputs
        .line_logits
        .iter()
        .zip(outputs.non_crease_logits.iter())
        .map(|(line, non_crease)| {
            let mut prob = sigmoid(*line);
            let non_crease_prob = sigmoid(*non_crease);
            if non_crease_prob >= 0.65 && prob < 0.85 {
                prob *= 0.15;
            }
            if prob < config.threshold * 0.25 {
                0.0
            } else {
                prob
            }
        })
        .collect()
}

fn sigmoid_map(values: &[f32]) -> Vec<f32> {
    values.iter().map(|value| sigmoid(*value)).collect()
}

fn line_style_prob_from_logits(line_style_logits: &[f32], size: usize) -> Vec<f32> {
    let pixels = size * size;
    let mut prob = vec![0.0; pixels * 4];
    for idx in 0..pixels {
        let mut max_value = f32::NEG_INFINITY;
        for channel in 0..4 {
            max_value = max_value.max(line_style_logits[channel * pixels + idx]);
        }
        let mut denom = 0.0;
        for channel in 0..4 {
            denom += (line_style_logits[channel * pixels + idx] - max_value).exp();
        }
        if denom <= 0.0 {
            continue;
        }
        for channel in 0..4 {
            prob[idx * 4 + channel] =
                (line_style_logits[channel * pixels + idx] - max_value).exp() / denom;
        }
    }
    prob
}

fn assignment_labels_from_logits(
    line_logits: &[f32],
    assignment_logits: &[f32],
    size: usize,
    line_threshold: f32,
) -> Vec<u8> {
    let pixels = size * size;
    let mut labels = vec![0u8; pixels];
    for idx in 0..pixels {
        if sigmoid(line_logits[idx]) < line_threshold {
            continue;
        }
        labels[idx] = argmax_channel(assignment_logits, 4, idx, pixels) as u8 + 1;
    }
    labels
}

fn hough_lines(line_prob: &[f32], config: &DecodeConfig) -> Vec<Line> {
    let size = config.image_size as usize;
    let (mask, foreground_count) = hough_mask(line_prob, config);
    if foreground_count == 0 {
        return Vec::new();
    }
    let Ok(segments) = hough_lines_p_opencv_cpu(
        &mask,
        size,
        size,
        &HoughLinesPConfig {
            rho: 1.0,
            theta: std::f32::consts::PI / 720.0,
            threshold: config.hough_vote_threshold.max(1) as i32,
            min_line_length: config.hough_min_segment_length_px as f64,
            max_line_gap: config.hough_max_segment_gap_px as f64,
            lines_max: i32::MAX,
        },
    ) else {
        return Vec::new();
    };
    let segments = limit_hough_segments(segments, 12_000);
    merge_hough_segments_into_carriers(&segments, size, config)
}

fn hough_mask(line_prob: &[f32], config: &DecodeConfig) -> (Vec<u8>, usize) {
    let size = config.image_size as usize;
    let mut mask = vec![0u8; size * size];
    let mut foreground_count = 0usize;
    for y in 0..size {
        for x in 0..size {
            let idx = y * size + x;
            let score = line_prob[idx];
            if score < config.threshold {
                continue;
            }
            mask[idx] = 255;
            foreground_count += 1;
        }
    }
    (mask, foreground_count)
}

fn limit_hough_segments(mut segments: Vec<HoughSegment>, max_segments: usize) -> Vec<HoughSegment> {
    if segments.len() <= max_segments {
        return segments;
    }
    segments.sort_by(|left, right| {
        hough_segment_length_sq(*right)
            .partial_cmp(&hough_segment_length_sq(*left))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    segments.truncate(max_segments);
    segments
}

fn hough_segment_length_sq(segment: HoughSegment) -> f32 {
    let dx = (segment.x2 - segment.x1) as f32;
    let dy = (segment.y2 - segment.y1) as f32;
    dx * dx + dy * dy
}

fn merge_hough_segments_into_carriers(
    segments: &[HoughSegment],
    size: usize,
    config: &DecodeConfig,
) -> Vec<Line> {
    let raw_lines = merge_hough_segments_into_raw_lines(segments, config);
    carriers_from_raw_lines(&raw_lines, size, config)
}

fn merge_hough_segments_into_raw_lines(
    segments: &[HoughSegment],
    config: &DecodeConfig,
) -> Vec<Line> {
    let mut groups: Vec<Vec<SegmentLineCandidate>> = Vec::new();
    let angle_tol = f64::from(config.carrier_merge_angle_degrees).to_radians();
    for segment in segments {
        let Some(line) = candidate_from_hough_segment(*segment, config) else {
            continue;
        };
        if let Some(group) = groups.iter_mut().find(|group| {
            let first = &group[0];
            angle_distance_f64(first.theta, line.theta) <= angle_tol
                && (first.rho - line.rho).abs() <= f64::from(config.carrier_merge_rho_px)
        }) {
            group.push(line);
        } else {
            groups.push(vec![line]);
        }
    }

    let mut raw_lines = Vec::new();
    for group in groups {
        if let Some(line) = merged_hough_group(&group) {
            raw_lines.push(line);
        }
    }
    raw_lines.sort_by(|left, right| right.support.total_cmp(&left.support));
    raw_lines.truncate(config.max_line_hypotheses);
    raw_lines
}

fn carriers_from_raw_lines(raw_lines: &[Line], size: usize, config: &DecodeConfig) -> Vec<Line> {
    let mut carriers = Vec::new();
    for line in raw_lines.iter().take(config.max_line_hypotheses) {
        if line_is_frame_border(line, size) {
            continue;
        }
        if let Some(carrier) =
            clip_and_pad_carrier(line.clone(), size, config.carrier_extent_padding_px, config)
        {
            if !segment_is_frame_border(carrier.p0, carrier.p1, size) {
                carriers.push(carrier);
            }
        }
    }
    carriers
}

fn candidate_from_hough_segment(
    segment: HoughSegment,
    config: &DecodeConfig,
) -> Option<SegmentLineCandidate> {
    let p0 = [f64::from(segment.x1), f64::from(segment.y1)];
    let p1 = [f64::from(segment.x2), f64::from(segment.y2)];
    let dx = p1[0] - p0[0];
    let dy = p1[1] - p0[1];
    let length = (dx * dx + dy * dy).sqrt();
    if length < f64::from(config.min_edge_length_px) {
        return None;
    }
    let theta = dy.atan2(dx).rem_euclid(std::f64::consts::PI);
    let normal = [-theta.sin(), theta.cos()];
    Some(SegmentLineCandidate {
        theta,
        rho: p0[0] * normal[0] + p0[1] * normal[1],
        p0,
        p1,
        length,
    })
}

fn merged_hough_group(group: &[SegmentLineCandidate]) -> Option<Line> {
    let support_sum = group.iter().map(|line| line.length).sum::<f64>();
    if support_sum <= 0.0 {
        return None;
    }
    let theta = weighted_bidirectional_angle_f64(
        group.iter().map(|line| line.theta),
        group.iter().map(|line| line.length),
    );
    let rho = group.iter().map(|line| line.rho * line.length).sum::<f64>() / support_sum;
    let direction64 = [theta.cos(), theta.sin()];
    let normal64 = [-theta.sin(), theta.cos()];
    let mut endpoints = Vec::with_capacity(group.len() * 2);
    for line in group {
        endpoints.push(line.p0);
        endpoints.push(line.p1);
    }
    let ts: Vec<f64> = endpoints
        .iter()
        .map(|point| point[0] * direction64[0] + point[1] * direction64[1])
        .collect();
    let t_min = ts.iter().copied().fold(f64::INFINITY, f64::min);
    let t_max = ts.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let center = [
        direction64[0] * ((t_min + t_max) / 2.0),
        direction64[1] * ((t_min + t_max) / 2.0),
    ];
    let center_normal = center[0] * normal64[0] + center[1] * normal64[1];
    let signed_center = [
        center[0] + normal64[0] * (rho - center_normal),
        center[1] + normal64[1] * (rho - center_normal),
    ];
    let center_t = signed_center[0] * direction64[0] + signed_center[1] * direction64[1];
    let p0 = [
        signed_center[0] + direction64[0] * (t_min - center_t),
        signed_center[1] + direction64[1] * (t_min - center_t),
    ];
    let p1 = [
        signed_center[0] + direction64[0] * (t_max - center_t),
        signed_center[1] + direction64[1] * (t_max - center_t),
    ];
    let theta = theta as f32;
    let rho = rho as f32;
    let direction = Point {
        x: theta.cos(),
        y: theta.sin(),
    };
    Some(Line {
        theta,
        rho,
        p0: Point {
            x: p0[0] as f32,
            y: p0[1] as f32,
        },
        p1: Point {
            x: p1[0] as f32,
            y: p1[1] as f32,
        },
        direction,
        t_min: t_min as f32,
        t_max: t_max as f32,
        support: support_sum as f32,
        votes: group.len(),
    })
}

fn clip_and_pad_carrier(
    line: Line,
    size: usize,
    padding: f32,
    config: &DecodeConfig,
) -> Option<Line> {
    let (_, _, square_t_min, square_t_max) = clip_line_to_frame(&line, size, config)?;
    let t_min = (line.t_min - padding).max(square_t_min);
    let t_max = (line.t_max + padding).min(square_t_max);
    if t_max - t_min < config.min_edge_length_px {
        return None;
    }
    let normal = line_normal(line.theta);
    Some(Line {
        p0: add_points(
            scale_point(line.direction, t_min),
            scale_point(normal, line.rho),
        ),
        p1: add_points(
            scale_point(line.direction, t_max),
            scale_point(normal, line.rho),
        ),
        t_min,
        t_max,
        ..line
    })
}

fn weighted_bidirectional_angle_f64(
    angles: impl Iterator<Item = f64>,
    weights: impl Iterator<Item = f64>,
) -> f64 {
    let mut x = 0.0;
    let mut y = 0.0;
    for (angle, weight) in angles.zip(weights) {
        x += (2.0 * angle).cos() * weight;
        y += (2.0 * angle).sin() * weight;
    }
    (0.5 * y.atan2(x)).rem_euclid(std::f64::consts::PI)
}

fn clip_line_to_frame(
    line: &Line,
    size: usize,
    config: &DecodeConfig,
) -> Option<(Point, Point, f32, f32)> {
    let max = (size - 1) as f32;
    let frame_epsilon = 1.0;
    let mut points = Vec::new();
    let delta = Point {
        x: line.p1.x - line.p0.x,
        y: line.p1.y - line.p0.y,
    };
    if delta.x.abs() > 1e-6 {
        for x in [0.0, max] {
            let t = (x - line.p0.x) / delta.x;
            let y = line.p0.y + t * delta.y;
            if (-frame_epsilon..=max + frame_epsilon).contains(&y) {
                points.push(snap_to_frame(
                    Point { x, y },
                    size,
                    config.vertex_merge_px + frame_epsilon,
                ));
            }
        }
    }
    if delta.y.abs() > 1e-6 {
        for y in [0.0, max] {
            let t = (y - line.p0.y) / delta.y;
            let x = line.p0.x + t * delta.x;
            if (-frame_epsilon..=max + frame_epsilon).contains(&x) {
                points.push(snap_to_frame(
                    Point { x, y },
                    size,
                    config.vertex_merge_px + frame_epsilon,
                ));
            }
        }
    }
    dedupe_points(&mut points, 1.0);
    if points.len() < 2 {
        return None;
    }
    points.sort_by(|a, b| project(*a, line.direction).total_cmp(&project(*b, line.direction)));
    let first = *points.first()?;
    let last = *points.last()?;
    let t_min = project(first, line.direction).min(project(last, line.direction));
    let t_max = project(first, line.direction).max(project(last, line.direction));
    Some((first, last, t_min, t_max))
}

fn line_normal(theta: f32) -> Point {
    Point {
        x: -theta.sin(),
        y: theta.cos(),
    }
}

fn add_points(left: Point, right: Point) -> Point {
    Point {
        x: left.x + right.x,
        y: left.y + right.y,
    }
}

fn scale_point(point: Point, scale: f32) -> Point {
    Point {
        x: point.x * scale,
        y: point.y * scale,
    }
}

fn vertex_stage_from_maps(
    junction_heatmap: &[f32],
    boundary_contact_heatmap: Option<&[f32]>,
    line_mask: &[u8],
    carriers: &[Line],
    config: &DecodeConfig,
) -> VertexStage {
    let size = config.image_size as usize;
    let mut candidate_vertices = Vec::new();
    let mut candidate_meta = Vec::new();

    for corner in square_corners(size) {
        candidate_vertices.push(corner);
        candidate_meta.push("corner".to_owned());
    }

    let boundary_contacts = boundary_contact_heatmap
        .map(|heatmap| boundary_contact_points(heatmap, size))
        .unwrap_or_default();
    for point in &boundary_contacts {
        candidate_vertices.push(*point);
        candidate_meta.push("boundary_contact".to_owned());
    }

    let intersections = carrier_intersections(carriers, config);
    let junctions = junction_points(junction_heatmap, line_mask, config);
    for point in &junctions {
        if carriers
            .iter()
            .any(|line| point_on_finite_line(*point, line, config.line_vertex_distance_px))
        {
            candidate_vertices.push(snap_junction_to_intersection(
                *point,
                &intersections,
                config,
            ));
            candidate_meta.push("junction".to_owned());
        }
    }

    for carrier in carriers {
        for endpoint in [carrier.p0, carrier.p1] {
            if point_on_frame(endpoint, size, config.vertex_merge_px + 1.0) {
                candidate_vertices.push(snap_to_frame(
                    endpoint,
                    size,
                    config.vertex_merge_px + 1.0,
                ));
                candidate_meta.push("boundary_contact".to_owned());
            }
        }
    }

    let merged_vertices = merge_vertices(&candidate_vertices, size, config.vertex_merge_px);
    let merged_meta = refresh_vertex_meta(&merged_vertices, size, config.vertex_merge_px);
    VertexStage {
        intersections,
        junctions,
        boundary_contacts,
        candidate_vertices,
        candidate_meta,
        merged_vertices,
        merged_meta,
    }
}

fn boundary_contact_points(heatmap: &[f32], size: usize) -> Vec<Point> {
    let max = (size - 1) as f32;
    let band = (size as f32 * 0.04).max(4.0) as usize;
    let radius = 4usize;
    let mut points = Vec::new();
    for side in 0..4 {
        let mut candidates = Vec::new();
        for y in 0..size {
            for x in 0..size {
                let in_band = match side {
                    0 => y <= band,
                    1 => x + band >= size - 1,
                    2 => y + band >= size - 1,
                    _ => x <= band,
                };
                if !in_band {
                    continue;
                }
                let idx = y * size + x;
                let score = heatmap[idx];
                if score < 0.25 || !local_max_scalar(heatmap, size, x, y, radius, score) {
                    continue;
                }
                let point = match side {
                    0 => Point {
                        x: x as f32,
                        y: 0.0,
                    },
                    1 => Point {
                        x: max,
                        y: y as f32,
                    },
                    2 => Point {
                        x: x as f32,
                        y: max,
                    },
                    _ => Point {
                        x: 0.0,
                        y: y as f32,
                    },
                };
                candidates.push((score, point));
            }
        }
        candidates.sort_by(|a, b| b.0.total_cmp(&a.0));
        for (_, point) in candidates {
            if points.iter().any(|other| distance(*other, point) <= 8.0) {
                continue;
            }
            points.push(point);
        }
    }
    points
}

fn junction_points(heatmap: &[f32], line_mask: &[u8], config: &DecodeConfig) -> Vec<Point> {
    let size = config.image_size as usize;
    let mut candidates = Vec::new();
    for y in 1..size - 1 {
        for x in 1..size - 1 {
            let idx = y * size + x;
            if line_mask[idx] == 0 {
                continue;
            }
            let score = heatmap[idx];
            if score < 0.20 || !local_max_scalar(heatmap, size, x, y, 2, score) {
                continue;
            }
            let point = Point {
                x: x as f32,
                y: y as f32,
            };
            candidates.push((score, point));
        }
    }
    candidates.sort_by(|a, b| b.0.total_cmp(&a.0));
    candidates.into_iter().map(|(_, point)| point).collect()
}

fn carrier_intersections(carriers: &[Line], config: &DecodeConfig) -> Vec<Point> {
    let size = config.image_size as usize;
    let max_lines = carriers.len().min(config.max_intersection_lines);
    let mut intersections = Vec::new();
    for i in 0..max_lines {
        for j in i + 1..max_lines {
            let Some(point) = line_intersection(&carriers[i], &carriers[j]) else {
                continue;
            };
            if !point_in_frame(point, size, 1.0) {
                continue;
            }
            if !point_on_finite_line(point, &carriers[i], config.vertex_merge_px)
                || !point_on_finite_line(point, &carriers[j], config.vertex_merge_px)
            {
                continue;
            }
            intersections.push(point);
        }
    }
    intersections
}

fn line_intersection(first: &Line, second: &Line) -> Option<Point> {
    let p = first.p0;
    let r = Point {
        x: first.p1.x - first.p0.x,
        y: first.p1.y - first.p0.y,
    };
    let q = second.p0;
    let s = Point {
        x: second.p1.x - second.p0.x,
        y: second.p1.y - second.p0.y,
    };
    let denom = r.x * s.y - r.y * s.x;
    if denom.abs() < 1e-6 {
        return None;
    }
    let qp = Point {
        x: q.x - p.x,
        y: q.y - p.y,
    };
    let t = (qp.x * s.y - qp.y * s.x) / denom;
    Some(Point {
        x: p.x + t * r.x,
        y: p.y + t * r.y,
    })
}

fn snap_junction_to_intersection(
    point: Point,
    intersections: &[Point],
    config: &DecodeConfig,
) -> Point {
    let mut best = None;
    for intersection in intersections {
        let item_distance = distance(point, *intersection);
        if item_distance > config.junction_snap_px {
            continue;
        }
        match best {
            None => best = Some((*intersection, item_distance)),
            Some((_, best_distance)) if item_distance < best_distance => {
                best = Some((*intersection, item_distance))
            }
            _ => {}
        }
    }
    best.map(|(intersection, _)| intersection).unwrap_or(point)
}

fn local_max_scalar(
    values: &[f32],
    size: usize,
    x: usize,
    y: usize,
    radius: usize,
    score: f32,
) -> bool {
    let x0 = x.saturating_sub(radius);
    let y0 = y.saturating_sub(radius);
    let x1 = (x + radius).min(size - 1);
    let y1 = (y + radius).min(size - 1);
    for yy in y0..=y1 {
        for xx in x0..=x1 {
            if values[yy * size + xx] > score {
                return false;
            }
        }
    }
    true
}

fn interior_edges(
    vertices: &[Point],
    carriers: &[Line],
    line_prob: &[f32],
    line_style_prob: Option<&[f32]>,
    assignment_labels: Option<&[u8]>,
    config: &DecodeConfig,
) -> Vec<Edge> {
    let mut edge_map: Vec<Edge> = Vec::new();
    for carrier in carriers {
        let mut on_line = Vec::new();
        for (idx, vertex) in vertices.iter().enumerate() {
            let projection = project(*vertex, carrier.direction);
            if point_line_distance(*vertex, carrier) <= config.line_vertex_distance_px
                && projection >= carrier.t_min - config.vertex_merge_px
                && projection <= carrier.t_max + config.vertex_merge_px
            {
                on_line.push((idx, project(*vertex, carrier.direction)));
            }
        }
        if on_line.len() < 2 {
            continue;
        }
        on_line.sort_by(|a, b| a.1.total_cmp(&b.1));
        for pair in on_line.windows(2) {
            let a = pair[0].0;
            let b = pair[1].0;
            if distance(vertices[a], vertices[b]) < config.min_edge_length_px {
                continue;
            }
            let support =
                segment_support(vertices[a], vertices[b], line_prob, line_style_prob, config);
            if support < config.min_edge_support {
                continue;
            }
            let next = Edge {
                a,
                b,
                assignment: vote_assignment(vertices[a], vertices[b], assignment_labels, config, 3),
                support,
            };
            let key = (a.min(b), a.max(b));
            if let Some(existing) = edge_map
                .iter_mut()
                .find(|edge| edge.a.min(edge.b) == key.0 && edge.a.max(edge.b) == key.1)
            {
                if support > existing.support {
                    *existing = Edge {
                        a: key.0,
                        b: key.1,
                        ..next
                    };
                }
            } else {
                edge_map.push(Edge {
                    a: key.0,
                    b: key.1,
                    ..next
                });
            }
        }
    }
    edge_map
}

fn segment_support(
    a: Point,
    b: Point,
    line_prob: &[f32],
    line_style_prob: Option<&[f32]>,
    config: &DecodeConfig,
) -> f32 {
    let size = config.image_size as usize;
    let pixels = size * size;
    let length = distance(a, b);
    if length <= 1e-6 {
        return 0.0;
    }
    let samples = sample_segment_points(a, b, config.edge_sample_step_px);
    if samples.is_empty() {
        return 0.0;
    }
    let dx = (b.x - a.x) / length;
    let dy = (b.y - a.y) / length;
    let px = -dy;
    let py = dx;
    let half_width = (config.edge_sample_width_px / 2) as isize;
    let mut hits = 0usize;
    let mut prob_sum = 0.0;
    let mut gapped_sum = 0.0;
    for sample in &samples {
        let mut best = 0.0_f32;
        let mut best_gapped = 0.0_f32;
        for offset in -half_width..=half_width {
            let x = round_ties_even(sample.x + px * offset as f32);
            let y = round_ties_even(sample.y + py * offset as f32);
            if x < 0 || y < 0 || x >= size as isize || y >= size as isize {
                continue;
            }
            let idx = y as usize * size + x as usize;
            best = best.max(line_prob[idx]);
            if let Some(line_style_prob) = line_style_prob {
                if line_style_prob.len() == pixels * 4 {
                    best_gapped = best_gapped.max(line_style_prob[idx * 4 + 1]);
                }
            }
        }
        if best >= config.threshold {
            hits += 1;
        }
        prob_sum += best;
        gapped_sum += best_gapped;
    }
    let count = samples.len();
    let hit_fraction = hits as f32 / count as f32;
    let mean_prob = prob_sum / count as f32;
    let gapped = gapped_sum / count as f32;
    let gapped_support = if line_style_prob.is_some()
        && mean_prob >= config.gapped_style_line_floor
        && gapped >= config.gapped_style_min_confidence
    {
        gapped * config.gapped_style_support_weight
    } else {
        0.0
    };
    hit_fraction
        .max(mean_prob * config.dashed_support_weight)
        .max(gapped_support)
}

fn vote_assignment(
    a: Point,
    b: Point,
    assignment_labels: Option<&[u8]>,
    config: &DecodeConfig,
    default: u8,
) -> u8 {
    let Some(assignment_labels) = assignment_labels else {
        return default;
    };
    let size = config.image_size as usize;
    let mut points = sample_segment_points(a, b, config.edge_sample_step_px);
    if points.len() > 6 {
        let trim = (points.len() / 10).max(1);
        points = points[trim..points.len() - trim].to_vec();
    }
    let mut counts = [0usize; 4];
    for point in points {
        let x = round_ties_even(point.x);
        let y = round_ties_even(point.y);
        if x < 0 || y < 0 || x >= size as isize || y >= size as isize {
            continue;
        }
        let idx = y as usize * size + x as usize;
        let label = assignment_labels[idx];
        if label == 0 {
            continue;
        }
        counts[(label - 1) as usize] += 1;
    }
    let total: usize = counts.iter().sum();
    if total == 0 {
        return default;
    }
    let mut best_label = 0usize;
    let mut best_count = counts[0];
    for (label, count) in counts.iter().copied().enumerate().skip(1) {
        if count > best_count {
            best_label = label;
            best_count = count;
        }
    }
    if best_count as f32 / total as f32 >= config.assignment_min_confidence {
        best_label as u8
    } else {
        default
    }
}

fn border_chain(
    vertices: &[Point],
    used_boundary: &[usize],
    size: usize,
    line_prob: &[f32],
    config: &DecodeConfig,
) -> Vec<Edge> {
    let mut edges = Vec::new();
    let mut seen = Vec::<(usize, usize)>::new();
    for side in 0..4 {
        let mut indices: Vec<usize> = vertices
            .iter()
            .enumerate()
            .filter_map(|(idx, point)| {
                if !(is_corner(*point, size, config.vertex_merge_px)
                    || used_boundary.contains(&idx))
                {
                    return None;
                }
                point_on_side(*point, side, size, config.vertex_merge_px + 1.0).then_some(idx)
            })
            .collect();
        indices.sort_by(|left, right| {
            side_position(vertices[*left], side).total_cmp(&side_position(vertices[*right], side))
        });
        indices.dedup();
        for pair in indices.windows(2) {
            let a = pair[0];
            let b = pair[1];
            if a == b {
                continue;
            }
            let key = (a.min(b), a.max(b));
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            edges.push(Edge {
                a,
                b,
                assignment: 2,
                support: segment_support(vertices[a], vertices[b], line_prob, None, config)
                    .max(0.99),
            });
        }
    }
    edges
}

fn drop_unused_non_border_vertices(
    vertices: Vec<Point>,
    edges: Vec<Edge>,
    size: usize,
    config: &DecodeConfig,
) -> (Vec<Point>, Vec<Edge>, Vec<usize>) {
    if vertices.is_empty() {
        return (vertices, edges, Vec::new());
    }
    let mut keep = vec![false; vertices.len()];
    for (idx, point) in vertices.iter().enumerate() {
        if is_corner(*point, size, config.vertex_merge_px) {
            keep[idx] = true;
        }
    }
    for edge in &edges {
        keep[edge.a] = true;
        keep[edge.b] = true;
    }
    let mut remap = vec![usize::MAX; vertices.len()];
    let mut next_vertices = Vec::new();
    for (idx, point) in vertices.iter().copied().enumerate() {
        if keep[idx] {
            remap[idx] = next_vertices.len();
            next_vertices.push(point);
        }
    }
    let next_edges: Vec<Edge> = edges
        .into_iter()
        .filter_map(|edge| {
            let a = remap[edge.a];
            let b = remap[edge.b];
            (a != usize::MAX && b != usize::MAX && a != b).then_some(Edge { a, b, ..edge })
        })
        .collect();
    let mut used_boundary = Vec::new();
    for edge in &next_edges {
        for idx in [edge.a, edge.b] {
            if point_on_frame(next_vertices[idx], size, config.vertex_merge_px + 1.0)
                && !is_corner(next_vertices[idx], size, config.vertex_merge_px)
            {
                used_boundary.push(idx);
            }
        }
    }
    used_boundary.sort_unstable();
    used_boundary.dedup();
    (next_vertices, next_edges, used_boundary)
}

fn support_for_edges(
    vertices: &[Point],
    edges: &[Edge],
    line_prob: &[f32],
    line_style_prob: Option<&[f32]>,
    config: &DecodeConfig,
) -> Vec<f32> {
    edges
        .iter()
        .map(|edge| {
            segment_support(
                vertices[edge.a],
                vertices[edge.b],
                line_prob,
                line_style_prob,
                config,
            )
        })
        .collect()
}

fn dedupe_edges(edges: &mut Vec<Edge>) {
    let mut out: Vec<Edge> = Vec::new();
    for edge in edges.drain(..) {
        let a = edge.a.min(edge.b);
        let b = edge.a.max(edge.b);
        if a == b {
            continue;
        }
        if let Some(existing) = out
            .iter_mut()
            .find(|item| item.a.min(item.b) == a && item.a.max(item.b) == b)
        {
            if edge.assignment == 2 || edge.support > existing.support {
                *existing = Edge { a, b, ..edge };
            }
        } else {
            out.push(Edge { a, b, ..edge });
        }
    }
    *edges = out;
}

fn dedupe_edges_by_support(edges: &mut Vec<Edge>) {
    let mut out: Vec<Edge> = Vec::new();
    for edge in edges.drain(..) {
        let a = edge.a.min(edge.b);
        let b = edge.a.max(edge.b);
        if a == b {
            continue;
        }
        if let Some(existing) = out
            .iter_mut()
            .find(|item| item.a.min(item.b) == a && item.a.max(item.b) == b)
        {
            if edge.support > existing.support {
                *existing = Edge { a, b, ..edge };
            }
        } else {
            out.push(Edge { a, b, ..edge });
        }
    }
    *edges = out;
}

fn planar_cleanup(vertices: &[Point], mut edges: Vec<Edge>, config: &DecodeConfig) -> Vec<Edge> {
    if edges.len() <= 1 || vertices.len() < 3 || edges.len() > config.planar_cleanup_max_edges {
        return edges;
    }
    edges = split_edges_at_intermediate_vertices(vertices, &edges, config);
    dedupe_edges_by_support(&mut edges);
    remove_crossing_edges(vertices, edges, config)
}

fn split_edges_at_intermediate_vertices(
    vertices: &[Point],
    edges: &[Edge],
    config: &DecodeConfig,
) -> Vec<Edge> {
    let mut out = Vec::new();
    for edge in edges {
        let sequence = vertices_on_segment(vertices, edge.a, edge.b, config);
        for pair in sequence.windows(2) {
            let a = pair[0];
            let b = pair[1];
            if a == b || distance(vertices[a], vertices[b]) < config.min_edge_length_px {
                continue;
            }
            out.push(Edge {
                a: a.min(b),
                b: a.max(b),
                assignment: edge.assignment,
                support: edge.support,
            });
        }
    }
    out
}

fn vertices_on_segment(
    vertices: &[Point],
    a: usize,
    b: usize,
    config: &DecodeConfig,
) -> Vec<usize> {
    let start = vertices[a];
    let end = vertices[b];
    let length = distance(start, end);
    if length <= 1e-6 {
        return vec![a, b];
    }
    let direction = Point {
        x: (end.x - start.x) / length,
        y: (end.y - start.y) / length,
    };
    let mut intermediate = Vec::new();
    for (idx, point) in vertices.iter().enumerate() {
        if idx == a || idx == b {
            continue;
        }
        let rel = Point {
            x: point.x - start.x,
            y: point.y - start.y,
        };
        let projection = rel.x * direction.x + rel.y * direction.y;
        if projection <= config.min_edge_length_px
            || projection >= length - config.min_edge_length_px
        {
            continue;
        }
        let perp = (rel.x * direction.y - rel.y * direction.x).abs();
        if perp <= config.planar_split_vertex_distance_px {
            intermediate.push((idx, projection));
        }
    }
    intermediate.sort_by(|left, right| left.1.total_cmp(&right.1));
    let mut sequence = Vec::with_capacity(intermediate.len() + 2);
    sequence.push(a);
    sequence.extend(intermediate.into_iter().map(|(idx, _)| idx));
    sequence.push(b);
    sequence
}

fn remove_crossing_edges(vertices: &[Point], edges: Vec<Edge>, config: &DecodeConfig) -> Vec<Edge> {
    if edges.len() <= 1 {
        return edges;
    }
    let mut keep = vec![true; edges.len()];
    let bboxes: Vec<(Point, Point)> = edges
        .iter()
        .map(|edge| edge_bbox(vertices[edge.a], vertices[edge.b]))
        .collect();
    for i in 0..edges.len() {
        if !keep[i] {
            continue;
        }
        for j in i + 1..edges.len() {
            if !keep[j] || !bbox_intersects(bboxes[i], bboxes[j]) {
                continue;
            }
            let edge_a = &edges[i];
            let edge_b = &edges[j];
            if [edge_a.a, edge_a.b]
                .iter()
                .any(|idx| *idx == edge_b.a || *idx == edge_b.b)
            {
                continue;
            }
            if !proper_segments_intersect(
                vertices[edge_a.a],
                vertices[edge_a.b],
                vertices[edge_b.a],
                vertices[edge_b.b],
            ) {
                continue;
            }
            let loser = crossing_loser(vertices, &edges, i, j, config);
            keep[loser] = false;
            if loser == i {
                break;
            }
        }
    }
    edges
        .into_iter()
        .enumerate()
        .filter_map(|(idx, edge)| keep[idx].then_some(edge))
        .collect()
}

fn edge_bbox(a: Point, b: Point) -> (Point, Point) {
    (
        Point {
            x: a.x.min(b.x),
            y: a.y.min(b.y),
        },
        Point {
            x: a.x.max(b.x),
            y: a.y.max(b.y),
        },
    )
}

fn bbox_intersects(first: (Point, Point), second: (Point, Point)) -> bool {
    !(first.1.x < second.0.x
        || second.1.x < first.0.x
        || first.1.y < second.0.y
        || second.1.y < first.0.y)
}

fn proper_segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool {
    let eps = 1e-6;
    let o1 = orient(a, b, c);
    let o2 = orient(a, b, d);
    let o3 = orient(c, d, a);
    let o4 = orient(c, d, b);
    if o1.abs() < eps || o2.abs() < eps || o3.abs() < eps || o4.abs() < eps {
        return false;
    }
    (o1 > 0.0) != (o2 > 0.0) && (o3 > 0.0) != (o4 > 0.0)
}

fn orient(a: Point, b: Point, c: Point) -> f32 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

fn crossing_loser(
    vertices: &[Point],
    edges: &[Edge],
    a: usize,
    b: usize,
    config: &DecodeConfig,
) -> usize {
    let support_delta = edges[a].support - edges[b].support;
    if support_delta.abs() > config.planar_crossing_support_tie {
        return if support_delta > 0.0 { b } else { a };
    }
    let len_a = distance(vertices[edges[a].a], vertices[edges[a].b]);
    let len_b = distance(vertices[edges[b].a], vertices[edges[b].b]);
    if len_a >= len_b { a } else { b }
}

fn drop_unused_vertices_keep_corners(
    vertices: Vec<Point>,
    edges: Vec<Edge>,
    _size: usize,
    _tol: f32,
) -> (Vec<Point>, Vec<Edge>) {
    let mut keep = vec![false; vertices.len()];
    for edge in &edges {
        keep[edge.a] = true;
        keep[edge.b] = true;
    }
    let mut remap = vec![usize::MAX; vertices.len()];
    let mut next_vertices = Vec::new();
    for (idx, point) in vertices.iter().copied().enumerate() {
        if keep[idx] {
            remap[idx] = next_vertices.len();
            next_vertices.push(point);
        }
    }
    let next_edges = edges
        .into_iter()
        .filter_map(|edge| {
            let a = remap[edge.a];
            let b = remap[edge.b];
            (a != usize::MAX && b != usize::MAX && a != b).then_some(Edge { a, b, ..edge })
        })
        .collect();
    (next_vertices, next_edges)
}

fn attribute_edges_from_logits(
    vertices: &[Point],
    edges: &[Edge],
    assignment_logits: &[f32],
    line_prob: &[f32],
    config: &DecodeConfig,
) -> Vec<AttributedEdge> {
    let size = config.image_size as usize;
    edges
        .iter()
        .enumerate()
        .map(|(edge_idx, edge)| {
            let p0 = vertices[edge.a];
            let p1 = vertices[edge.b];
            let points = trim_endpoint_samples(sample_segment_points(p0, p1, 1.0), 0.10, 4);
            let (probabilities, support, count) =
                pool_assignment_probabilities(assignment_logits, &points, p0, p1, line_prob, size);
            if count == 0 {
                return AttributedEdge {
                    edge: Edge {
                        assignment: 3,
                        support: edges.get(edge_idx).map(|item| item.support).unwrap_or(0.0),
                        ..edge.clone()
                    },
                    confidence: 0.0,
                    margin: 0.0,
                    source: AssignmentSource::Unknown,
                    probabilities: [0.0, 0.0, 0.0, 1.0],
                };
            }

            let mut order = [0usize, 1, 2, 3];
            order.sort_by(|left, right| probabilities[*right].total_cmp(&probabilities[*left]));
            let top = order[0];
            let second = order[1];
            let confidence = probabilities[top];
            let margin = (probabilities[top] - probabilities[second]).max(0.0);
            let observed = confidence >= 0.60 && margin >= 0.12;
            AttributedEdge {
                edge: Edge {
                    assignment: if observed { top as u8 } else { 3 },
                    support,
                    ..edge.clone()
                },
                confidence,
                margin,
                source: if observed {
                    AssignmentSource::Observed
                } else {
                    AssignmentSource::Unknown
                },
                probabilities,
            }
        })
        .collect()
}

fn trim_endpoint_samples(
    mut points: Vec<Point>,
    trim_fraction: f32,
    min_samples: usize,
) -> Vec<Point> {
    if points.len() <= min_samples {
        return points;
    }
    let trim = ((points.len() as f32 * trim_fraction.max(0.0)).floor() as usize)
        .min((points.len() - min_samples) / 2);
    if trim == 0 {
        return points;
    }
    points.drain(points.len() - trim..);
    points.drain(..trim);
    points
}

fn pool_assignment_probabilities(
    assignment_logits: &[f32],
    points: &[Point],
    p0: Point,
    p1: Point,
    line_prob: &[f32],
    size: usize,
) -> ([f32; 4], f32, usize) {
    if points.is_empty() {
        return ([0.0; 4], 0.0, 0);
    }
    let length = distance(p0, p1);
    if length <= 1e-6 {
        return ([0.0; 4], 0.0, 0);
    }
    let pixels = size * size;
    let px = -(p1.y - p0.y) / length;
    let py = (p1.x - p0.x) / length;
    let mut weighted = [0.0_f64; 4];
    let mut total_weight = 0.0_f64;
    let mut support_sum = 0.0_f64;
    let mut count = 0usize;
    for point in points {
        for offset in -1..=1 {
            let x = round_ties_even(point.x + px * offset as f32);
            let y = round_ties_even(point.y + py * offset as f32);
            if x < 0 || y < 0 || x >= size as isize || y >= size as isize {
                continue;
            }
            let idx = y as usize * size + x as usize;
            let line_weight = line_prob[idx].clamp(0.0, 1.0);
            let weight = line_weight.max(0.05);
            let probabilities = assignment_probability_at(assignment_logits, idx, pixels);
            for channel in 0..4 {
                weighted[channel] += f64::from(probabilities[channel] * weight);
            }
            total_weight += f64::from(weight);
            support_sum += f64::from(line_weight);
            count += 1;
        }
    }
    if total_weight <= 0.0 {
        return ([0.0; 4], 0.0, 0);
    }
    let mut pooled = [0.0_f32; 4];
    let mut pooled_sum = 0.0_f32;
    for channel in 0..4 {
        pooled[channel] = (weighted[channel] / total_weight) as f32;
        pooled_sum += pooled[channel];
    }
    if pooled_sum > 1e-8 {
        for value in &mut pooled {
            *value /= pooled_sum;
        }
    }
    let support = if count == 0 {
        0.0
    } else {
        (support_sum / count as f64) as f32
    };
    (pooled, support, count)
}

fn assignment_probability_at(assignment_logits: &[f32], idx: usize, pixels: usize) -> [f32; 4] {
    let mut max_value = f32::NEG_INFINITY;
    for channel in 0..4 {
        max_value = max_value.max(assignment_logits[channel * pixels + idx]);
    }
    let mut denom = 0.0;
    let mut exp = [0.0; 4];
    for channel in 0..4 {
        exp[channel] = (assignment_logits[channel * pixels + idx] - max_value).exp();
        denom += exp[channel];
    }
    if denom <= 1e-8 {
        return [0.0, 0.0, 0.0, 1.0];
    }
    [
        exp[0] / denom,
        exp[1] / denom,
        exp[2] / denom,
        exp[3] / denom,
    ]
}

fn conservative_repair(
    vertices: &mut Vec<Point>,
    edges: &mut Vec<AttributedEdge>,
    line_prob: &[f32],
    config: &DecodeConfig,
) -> Vec<RepairAction> {
    let mut actions = Vec::new();
    actions.extend(remove_zero_length_and_duplicate_edges(vertices, edges));
    actions.extend(drop_weak_edges_and_unused_vertices(
        vertices, edges, config, 0.35,
    ));
    if let Some(action) = canonicalize_square_border(vertices, edges, line_prob, config) {
        actions.push(action);
    }
    if let Some(action) = reconstruct_square_border_chain(vertices, edges, line_prob, config) {
        actions.push(action);
    }
    actions.extend(downgrade_low_confidence_mv(edges, 0.55, 0.08));
    actions
}

fn remove_zero_length_and_duplicate_edges(
    vertices: &[Point],
    edges: &mut Vec<AttributedEdge>,
) -> Vec<RepairAction> {
    let mut keep_by_key: Vec<((usize, usize), usize)> = Vec::new();
    let mut keep = vec![true; edges.len()];
    let mut removed_zero = Vec::new();
    let mut removed_duplicate = Vec::new();
    for (edge_idx, attributed) in edges.iter().enumerate() {
        let v1 = attributed.edge.a;
        let v2 = attributed.edge.b;
        if v1 == v2 || distance(vertices[v1], vertices[v2]) < 1.0 {
            keep[edge_idx] = false;
            removed_zero.push(edge_idx);
            continue;
        }
        let key = (v1.min(v2), v1.max(v2));
        if let Some((_, previous)) = keep_by_key
            .iter_mut()
            .find(|(item_key, _)| *item_key == key)
        {
            if attributed.edge.support > edges[*previous].edge.support {
                keep[*previous] = false;
                removed_duplicate.push(*previous);
                *previous = edge_idx;
            } else {
                keep[edge_idx] = false;
                removed_duplicate.push(edge_idx);
            }
        } else {
            keep_by_key.push((key, edge_idx));
        }
    }
    filter_attributed_edges(edges, &keep);
    let mut actions = Vec::new();
    if !removed_zero.is_empty() {
        actions.push(RepairAction {
            code: "remove_zero_length_edges".to_owned(),
            message: "Removed zero-length or near-zero-length edges.".to_owned(),
            edge_indices: removed_zero,
            vertex_indices: Vec::new(),
            details: json!({}),
        });
    }
    if !removed_duplicate.is_empty() {
        actions.push(RepairAction {
            code: "remove_duplicate_edges".to_owned(),
            message: "Removed duplicate edges, keeping the strongest supported copy.".to_owned(),
            edge_indices: removed_duplicate,
            vertex_indices: Vec::new(),
            details: json!({}),
        });
    }
    actions
}

fn drop_weak_edges_and_unused_vertices(
    vertices: &mut Vec<Point>,
    edges: &mut Vec<AttributedEdge>,
    config: &DecodeConfig,
    threshold: f32,
) -> Vec<RepairAction> {
    let weak: Vec<usize> = edges
        .iter()
        .enumerate()
        .filter_map(|(idx, edge)| (edge.edge.support < threshold).then_some(idx))
        .collect();
    let keep: Vec<bool> = edges
        .iter()
        .map(|edge| edge.edge.support >= threshold)
        .collect();
    filter_attributed_edges(edges, &keep);
    drop_unused_attributed_vertices(vertices, edges, config);
    if weak.is_empty() {
        Vec::new()
    } else {
        vec![RepairAction {
            code: "drop_weak_edges".to_owned(),
            message:
                "Dropped edges whose line support was below the conservative repair threshold."
                    .to_owned(),
            edge_indices: weak,
            vertex_indices: Vec::new(),
            details: json!({ "threshold": threshold }),
        }]
    }
}

fn filter_attributed_edges(edges: &mut Vec<AttributedEdge>, keep: &[bool]) {
    let mut index = 0usize;
    edges.retain(|_| {
        let item_keep = keep.get(index).copied().unwrap_or(false);
        index += 1;
        item_keep
    });
}

fn drop_unused_attributed_vertices(
    vertices: &mut Vec<Point>,
    edges: &mut Vec<AttributedEdge>,
    config: &DecodeConfig,
) {
    if edges.is_empty() {
        vertices.clear();
        return;
    }
    let mut used: Vec<usize> = edges
        .iter()
        .flat_map(|edge| [edge.edge.a, edge.edge.b])
        .collect();
    used.sort_unstable();
    used.dedup();
    let mut remap = vec![usize::MAX; vertices.len()];
    let next_vertices: Vec<Point> = used
        .iter()
        .enumerate()
        .map(|(new_idx, old_idx)| {
            remap[*old_idx] = new_idx;
            vertices[*old_idx]
        })
        .collect();
    for attributed in edges {
        attributed.edge.a = remap[attributed.edge.a];
        attributed.edge.b = remap[attributed.edge.b];
    }
    *vertices = next_vertices;
    let _ = config;
}

fn downgrade_low_confidence_mv(
    edges: &mut [AttributedEdge],
    confidence: f32,
    margin: f32,
) -> Vec<RepairAction> {
    let mut low = Vec::new();
    for (edge_idx, attributed) in edges.iter_mut().enumerate() {
        if !matches!(attributed.edge.assignment, 0 | 1) {
            continue;
        }
        if attributed.confidence < confidence || attributed.margin < margin {
            attributed.edge.assignment = 3;
            attributed.source = AssignmentSource::Unknown;
            low.push(edge_idx);
        }
    }
    if low.is_empty() {
        Vec::new()
    } else {
        vec![RepairAction {
            code: "downgrade_low_confidence_mv".to_owned(),
            message: "Downgraded low-confidence M/V labels to unassigned.".to_owned(),
            edge_indices: low,
            vertex_indices: Vec::new(),
            details: json!({
                "confidence_threshold": confidence,
                "margin_threshold": margin,
            }),
        }]
    }
}

#[derive(Debug, Clone, Copy)]
struct BorderFrame {
    left: f32,
    right: f32,
    top: f32,
    bottom: f32,
}

fn canonicalize_square_border(
    vertices: &[Point],
    edges: &mut [AttributedEdge],
    _line_prob: &[f32],
    config: &DecodeConfig,
) -> Option<RepairAction> {
    if vertices.len() < 4 || edges.is_empty() {
        return None;
    }
    let Some(frame) = infer_border_frame(vertices, config.image_size as usize) else {
        return None;
    };
    let side = (frame.right - frame.left).max(frame.bottom - frame.top);
    let tolerance = effective_border_tolerance(side);
    let snapped_vertices = snap_vertices_to_frame(vertices, frame, tolerance);
    let side_vertices = side_vertices(&snapped_vertices, frame, tolerance);
    let eligible_sides = side_vertices
        .values()
        .into_iter()
        .filter(|indices| indices.len() >= 2)
        .count();
    if eligible_sides < 3 {
        return None;
    }
    let mut forced_edges = Vec::new();
    for (side_name, indices) in &side_vertices {
        if indices.len() < 2 {
            continue;
        }
        let side_length = match side_name {
            "top" | "bottom" => (frame.right - frame.left).max(1.0),
            _ => (frame.bottom - frame.top).max(1.0),
        };
        for (edge_idx, attributed) in edges.iter_mut().enumerate() {
            let Some(position_a) = indices.iter().position(|idx| *idx == attributed.edge.a) else {
                continue;
            };
            let Some(position_b) = indices.iter().position(|idx| *idx == attributed.edge.b) else {
                continue;
            };
            if position_a == position_b {
                continue;
            }
            if !should_treat_as_border_edge(attributed, vertices, side_length) {
                continue;
            }
            attributed.edge.assignment = 2;
            attributed.confidence = attributed.confidence.max(attributed.edge.support);
            attributed.margin = attributed.margin.max(attributed.edge.support);
            attributed.source = AssignmentSource::Observed;
            attributed.probabilities = assignment_probability_row(2, attributed.confidence);
            forced_edges.push(edge_idx);
        }
    }
    forced_edges.sort_unstable();
    forced_edges.dedup();
    if forced_edges.is_empty() {
        None
    } else {
        let forced_edge_count = forced_edges.len();
        Some(RepairAction {
            code: "canonicalize_square_border".to_owned(),
            message: "Forced inferred square-border edges to B.".to_owned(),
            edge_indices: forced_edges,
            vertex_indices: Vec::new(),
            details: json!({
                "snapped_vertices": 0,
                "forced_border_edges": forced_edge_count,
                "removed_redundant_edges": 0,
                "added_border_edges": 0,
                "side_vertex_counts": {
                    "top": side_vertices.top.len(),
                    "right": side_vertices.right.len(),
                    "bottom": side_vertices.bottom.len(),
                    "left": side_vertices.left.len(),
                },
                "max_drift_px": 0.0,
                "snap_rejected_for_drift": 0,
                "tolerance_px": tolerance,
                "geometry_reverted": false,
            }),
        })
    }
}

fn reconstruct_square_border_chain(
    vertices: &mut Vec<Point>,
    edges: &mut Vec<AttributedEdge>,
    line_prob: &[f32],
    config: &DecodeConfig,
) -> Option<RepairAction> {
    if vertices.len() < 4 || edges.is_empty() {
        return None;
    }
    let size = config.image_size as usize;
    let frame = infer_border_frame_for_reconstruction(vertices, edges, size)?;
    let side = (frame.right - frame.left).max(frame.bottom - frame.top);
    let tolerance = border_chain_tolerance(side);
    let snapped_all = snap_vertices_to_frame(vertices, frame, tolerance);
    let seed_side_vertices = side_vertices(&snapped_all, frame, tolerance);
    let eligible_sides = seed_side_vertices
        .values()
        .into_iter()
        .filter(|indices| indices.len() >= 2)
        .count();
    if eligible_sides < 3 {
        return None;
    }

    let max_snap_drift_px = 6.0;
    let mut next_vertices = vertices.clone();
    let mut selected = vec![false; next_vertices.len()];
    let mut snap_rejected_for_drift = 0usize;
    for indices in seed_side_vertices.values() {
        for idx in indices {
            let drift = distance(snapped_all[*idx], vertices[*idx]);
            if drift > max_snap_drift_px {
                snap_rejected_for_drift += 1;
                continue;
            }
            next_vertices[*idx] = snapped_all[*idx];
            selected[*idx] = true;
        }
    }

    let mut added_corner_vertices = 0usize;
    let mut corner_vertices = Vec::<(&'static str, usize)>::new();
    for (name, corner) in frame_corners(frame) {
        let nearest = next_vertices
            .iter()
            .enumerate()
            .map(|(idx, point)| (idx, distance(*point, corner)))
            .min_by(|left, right| left.1.total_cmp(&right.1));
        if let Some((idx, nearest_distance)) = nearest {
            if nearest_distance <= max_snap_drift_px {
                next_vertices[idx] = corner;
                selected[idx] = true;
                corner_vertices.push((name, idx));
                continue;
            }
        }
        let idx = next_vertices.len();
        next_vertices.push(corner);
        selected.push(true);
        corner_vertices.push((name, idx));
        added_corner_vertices += 1;
    }

    let selected_by_side =
        selected_border_vertices_by_side(&next_vertices, &selected, frame, tolerance, config);
    if selected_by_side
        .values()
        .into_iter()
        .any(|indices| indices.len() < 2)
    {
        return None;
    }
    let chain_edges = border_chain_edges_from_sides(&selected_by_side);
    if chain_edges.len() < 4 {
        return None;
    }

    let frame_edge_indices: Vec<usize> = edges
        .iter()
        .enumerate()
        .filter_map(|(idx, edge)| {
            edge_lies_on_any_frame_side(&next_vertices, edge.edge.a, edge.edge.b, frame, tolerance)
                .then_some(idx)
        })
        .collect();
    let existing_b_indices: Vec<usize> = edges
        .iter()
        .enumerate()
        .filter_map(|(idx, edge)| (edge.edge.assignment == 2).then_some(idx))
        .collect();
    if existing_b_indices.len() >= 4 {
        let frame_b_count = existing_b_indices
            .iter()
            .filter(|idx| frame_edge_indices.contains(idx))
            .count();
        let frame_b_fraction = frame_b_count as f32 / existing_b_indices.len() as f32;
        if frame_b_fraction < 0.60 {
            return None;
        }
        let max_chain_edges = 2.0 * existing_b_indices.len() as f32 + 4.0;
        if chain_edges.len() as f32 > max_chain_edges {
            return None;
        }
    }

    let mut remove = vec![false; edges.len()];
    for idx in &frame_edge_indices {
        remove[*idx] = true;
    }
    let mut downgraded_off_frame_b = Vec::new();
    for (idx, edge) in edges.iter_mut().enumerate() {
        if remove[idx] {
            continue;
        }
        if edge.edge.assignment == 2 {
            edge.edge.assignment = 3;
            edge.confidence = edge.confidence.min(0.5);
            edge.margin = edge.margin.min(0.0);
            edge.source = AssignmentSource::Unknown;
            edge.probabilities = assignment_probability_row(3, 1.0);
            downgraded_off_frame_b.push(idx);
        }
    }

    let snapped_existing: Vec<usize> = selected
        .iter()
        .enumerate()
        .filter_map(|(idx, is_selected)| {
            (*is_selected
                && idx < vertices.len()
                && distance(next_vertices[idx], vertices[idx]) > 1e-4)
                .then_some(idx)
        })
        .collect();
    let removed_frame_edges = remove.iter().filter(|item| **item).count();
    let changed = !snapped_existing.is_empty()
        || removed_frame_edges > 0
        || !downgraded_off_frame_b.is_empty()
        || added_corner_vertices > 0
        || !chain_edges.is_empty();
    if !changed {
        return None;
    }

    let max_drift = snapped_existing
        .iter()
        .map(|idx| distance(next_vertices[*idx], vertices[*idx]))
        .fold(0.0_f32, f32::max);

    *vertices = next_vertices;
    filter_attributed_edges_by_remove(edges, &remove);
    for (a, b) in &chain_edges {
        let support =
            segment_support(vertices[*a], vertices[*b], line_prob, None, config).max(0.70);
        edges.push(AttributedEdge {
            edge: Edge {
                a: *a,
                b: *b,
                assignment: 2,
                support,
            },
            confidence: 1.0,
            margin: 1.0,
            source: AssignmentSource::Observed,
            probabilities: assignment_probability_row(2, 1.0),
        });
    }
    remove_zero_length_and_duplicate_edges(vertices, edges);
    drop_unused_attributed_vertices(vertices, edges, config);

    Some(RepairAction {
        code: "reconstruct_square_border_chain".to_owned(),
        message: "Rebuilt the inferred square border as a clean B chain.".to_owned(),
        edge_indices: Vec::new(),
        vertex_indices: snapped_existing,
        details: json!({
            "added_border_edges": chain_edges.len(),
            "removed_frame_edges": removed_frame_edges,
            "downgraded_off_frame_b_edges": downgraded_off_frame_b.len(),
            "added_corner_vertices": added_corner_vertices,
            "corner_vertices": corner_vertices
                .into_iter()
                .map(|(name, idx)| json!({ "name": name, "vertex": idx }))
                .collect::<Vec<Value>>(),
            "side_vertex_counts": {
                "top": selected_by_side.top.len(),
                "right": selected_by_side.right.len(),
                "bottom": selected_by_side.bottom.len(),
                "left": selected_by_side.left.len(),
            },
            "max_drift_px": max_drift,
            "snap_rejected_for_drift": snap_rejected_for_drift,
            "tolerance_px": tolerance,
        }),
    })
}

fn filter_attributed_edges_by_remove(edges: &mut Vec<AttributedEdge>, remove: &[bool]) {
    let mut index = 0usize;
    edges.retain(|_| {
        let keep = !remove.get(index).copied().unwrap_or(false);
        index += 1;
        keep
    });
}

fn infer_border_frame_for_reconstruction(
    vertices: &[Point],
    edges: &[AttributedEdge],
    size: usize,
) -> Option<BorderFrame> {
    let border_points: Vec<Point> = edges
        .iter()
        .filter(|edge| edge.edge.assignment == 2)
        .flat_map(|edge| [vertices[edge.edge.a], vertices[edge.edge.b]])
        .collect();
    if border_points.len() >= 4 {
        if let Some(frame) = infer_border_frame(&border_points, size) {
            return Some(frame);
        }
    }
    infer_border_frame(vertices, size)
}

fn border_chain_tolerance(side_length: f32) -> f32 {
    10.0_f32.min((0.01 * side_length).max(1.0))
}

fn frame_corners(frame: BorderFrame) -> [(&'static str, Point); 4] {
    [
        (
            "top_left",
            Point {
                x: frame.left,
                y: frame.top,
            },
        ),
        (
            "top_right",
            Point {
                x: frame.right,
                y: frame.top,
            },
        ),
        (
            "bottom_right",
            Point {
                x: frame.right,
                y: frame.bottom,
            },
        ),
        (
            "bottom_left",
            Point {
                x: frame.left,
                y: frame.bottom,
            },
        ),
    ]
}

fn selected_border_vertices_by_side(
    vertices: &[Point],
    selected: &[bool],
    frame: BorderFrame,
    tolerance: f32,
    config: &DecodeConfig,
) -> BTreeSideVertices {
    let side_vertices = side_vertices(vertices, frame, tolerance);
    BTreeSideVertices {
        top: unique_selected_side_vertices(
            &side_vertices.top,
            vertices,
            selected,
            "top",
            config.min_edge_length_px,
        ),
        right: unique_selected_side_vertices(
            &side_vertices.right,
            vertices,
            selected,
            "right",
            config.min_edge_length_px,
        ),
        bottom: unique_selected_side_vertices(
            &side_vertices.bottom,
            vertices,
            selected,
            "bottom",
            config.min_edge_length_px,
        ),
        left: unique_selected_side_vertices(
            &side_vertices.left,
            vertices,
            selected,
            "left",
            config.min_edge_length_px,
        ),
    }
}

fn unique_selected_side_vertices(
    indices: &[usize],
    vertices: &[Point],
    selected: &[bool],
    side: &str,
    min_spacing_px: f32,
) -> Vec<usize> {
    let mut ordered: Vec<usize> = indices
        .iter()
        .copied()
        .filter(|idx| selected.get(*idx).copied().unwrap_or(false))
        .collect();
    ordered.sort_by(|left, right| {
        side_position_by_name(vertices[*left], side)
            .total_cmp(&side_position_by_name(vertices[*right], side))
            .then_with(|| left.cmp(right))
    });
    let mut unique = Vec::new();
    for idx in ordered {
        if let Some(previous) = unique.last() {
            let spacing = (side_position_by_name(vertices[idx], side)
                - side_position_by_name(vertices[*previous], side))
            .abs();
            if spacing < min_spacing_px {
                continue;
            }
        }
        unique.push(idx);
    }
    unique
}

fn border_chain_edges_from_sides(sides: &BTreeSideVertices) -> Vec<(usize, usize)> {
    let mut edges = Vec::new();
    let mut seen = Vec::<(usize, usize)>::new();
    for indices in [&sides.top, &sides.right, &sides.bottom, &sides.left] {
        for pair in indices.windows(2) {
            let a = pair[0];
            let b = pair[1];
            if a == b {
                continue;
            }
            let key = (a.min(b), a.max(b));
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            edges.push((a, b));
        }
    }
    edges
}

fn edge_lies_on_any_frame_side(
    vertices: &[Point],
    a: usize,
    b: usize,
    frame: BorderFrame,
    tolerance: f32,
) -> bool {
    ["top", "right", "bottom", "left"]
        .iter()
        .any(|side| edge_lies_on_frame_side(vertices, a, b, frame, side, tolerance))
}

fn edge_lies_on_frame_side(
    vertices: &[Point],
    a: usize,
    b: usize,
    frame: BorderFrame,
    side: &str,
    tolerance: f32,
) -> bool {
    vertex_on_frame_side(vertices[a], frame, side, tolerance)
        && vertex_on_frame_side(vertices[b], frame, side, tolerance)
}

fn vertex_on_frame_side(vertex: Point, frame: BorderFrame, side: &str, tolerance: f32) -> bool {
    match side {
        "top" => {
            frame.left - tolerance <= vertex.x
                && vertex.x <= frame.right + tolerance
                && (vertex.y - frame.top).abs() <= tolerance
        }
        "right" => {
            frame.top - tolerance <= vertex.y
                && vertex.y <= frame.bottom + tolerance
                && (vertex.x - frame.right).abs() <= tolerance
        }
        "bottom" => {
            frame.left - tolerance <= vertex.x
                && vertex.x <= frame.right + tolerance
                && (vertex.y - frame.bottom).abs() <= tolerance
        }
        _ => {
            frame.top - tolerance <= vertex.y
                && vertex.y <= frame.bottom + tolerance
                && (vertex.x - frame.left).abs() <= tolerance
        }
    }
}

fn side_position_by_name(vertex: Point, side: &str) -> f32 {
    if side == "top" || side == "bottom" {
        vertex.x
    } else {
        vertex.y
    }
}

fn infer_border_frame(vertices: &[Point], size: usize) -> Option<BorderFrame> {
    if vertices.is_empty() {
        return None;
    }
    let mut left = f32::INFINITY;
    let mut right = f32::NEG_INFINITY;
    let mut top = f32::INFINITY;
    let mut bottom = f32::NEG_INFINITY;
    for vertex in vertices {
        left = left.min(vertex.x);
        right = right.max(vertex.x);
        top = top.min(vertex.y);
        bottom = bottom.max(vertex.y);
    }
    let mut width = right - left;
    let mut height = bottom - top;
    if width <= 1.0 || height <= 1.0 {
        return None;
    }
    let max_side = width.max(height);
    let tolerance = effective_border_tolerance(max_side);
    let aspect_delta = (width - height).abs();
    let aspect_limit = (4.0 * tolerance).min(tolerance.max(0.08 * max_side));
    if aspect_delta <= aspect_limit {
        let side = 0.5 * (width + height);
        let cx = 0.5 * (left + right);
        let cy = 0.5 * (top + bottom);
        left = cx - 0.5 * side;
        right = cx + 0.5 * side;
        top = cy - 0.5 * side;
        bottom = cy + 0.5 * side;
        width = right - left;
        height = bottom - top;
    }
    if size > 1 {
        let max = (size - 1) as f32;
        left = left.clamp(0.0, max);
        right = right.clamp(0.0, max);
        top = top.clamp(0.0, max);
        bottom = bottom.clamp(0.0, max);
    }
    if width <= 1.0 || height <= 1.0 {
        return None;
    }
    Some(BorderFrame {
        left,
        right,
        top,
        bottom,
    })
}

fn effective_border_tolerance(side_length: f32) -> f32 {
    6.0_f32.min((0.02 * side_length).max(1.0))
}

fn snap_vertices_to_frame(vertices: &[Point], frame: BorderFrame, tolerance: f32) -> Vec<Point> {
    vertices
        .iter()
        .map(|vertex| {
            let within_x =
                frame.left - tolerance <= vertex.x && vertex.x <= frame.right + tolerance;
            let within_y =
                frame.top - tolerance <= vertex.y && vertex.y <= frame.bottom + tolerance;
            let mut x = vertex.x;
            let mut y = vertex.y;
            let mut x_candidates = Vec::new();
            if within_y && (vertex.x - frame.left).abs() <= tolerance {
                x_candidates.push(((vertex.x - frame.left).abs(), frame.left));
            }
            if within_y && (vertex.x - frame.right).abs() <= tolerance {
                x_candidates.push(((vertex.x - frame.right).abs(), frame.right));
            }
            let mut y_candidates = Vec::new();
            if within_x && (vertex.y - frame.top).abs() <= tolerance {
                y_candidates.push(((vertex.y - frame.top).abs(), frame.top));
            }
            if within_x && (vertex.y - frame.bottom).abs() <= tolerance {
                y_candidates.push(((vertex.y - frame.bottom).abs(), frame.bottom));
            }
            if let Some((_, value)) = x_candidates
                .into_iter()
                .min_by(|left, right| left.0.total_cmp(&right.0))
            {
                x = value;
            }
            if let Some((_, value)) = y_candidates
                .into_iter()
                .min_by(|left, right| left.0.total_cmp(&right.0))
            {
                y = value;
            }
            Point { x, y }
        })
        .collect()
}

fn side_vertices(vertices: &[Point], frame: BorderFrame, tolerance: f32) -> BTreeSideVertices {
    let mut sides = BTreeSideVertices::default();
    for (idx, vertex) in vertices.iter().enumerate() {
        let within_x = frame.left - tolerance <= vertex.x && vertex.x <= frame.right + tolerance;
        let within_y = frame.top - tolerance <= vertex.y && vertex.y <= frame.bottom + tolerance;
        if within_x && (vertex.y - frame.top).abs() <= tolerance {
            sides.top.push(idx);
        }
        if within_y && (vertex.x - frame.right).abs() <= tolerance {
            sides.right.push(idx);
        }
        if within_x && (vertex.y - frame.bottom).abs() <= tolerance {
            sides.bottom.push(idx);
        }
        if within_y && (vertex.x - frame.left).abs() <= tolerance {
            sides.left.push(idx);
        }
    }
    sides
        .top
        .sort_by(|left, right| vertices[*left].x.total_cmp(&vertices[*right].x));
    sides
        .bottom
        .sort_by(|left, right| vertices[*left].x.total_cmp(&vertices[*right].x));
    sides
        .left
        .sort_by(|left, right| vertices[*left].y.total_cmp(&vertices[*right].y));
    sides
        .right
        .sort_by(|left, right| vertices[*left].y.total_cmp(&vertices[*right].y));
    sides
}

#[derive(Default)]
struct BTreeSideVertices {
    top: Vec<usize>,
    right: Vec<usize>,
    bottom: Vec<usize>,
    left: Vec<usize>,
}

impl BTreeSideVertices {
    fn values(&self) -> [&[usize]; 4] {
        [&self.top, &self.right, &self.bottom, &self.left]
    }
}

impl<'a> IntoIterator for &'a BTreeSideVertices {
    type Item = (&'static str, &'a Vec<usize>);
    type IntoIter = std::array::IntoIter<Self::Item, 4>;

    fn into_iter(self) -> Self::IntoIter {
        [
            ("top", &self.top),
            ("right", &self.right),
            ("bottom", &self.bottom),
            ("left", &self.left),
        ]
        .into_iter()
    }
}

fn should_treat_as_border_edge(
    edge: &AttributedEdge,
    vertices: &[Point],
    side_length: f32,
) -> bool {
    if edge.edge.assignment == 2 {
        return true;
    }
    let length = distance(vertices[edge.edge.a], vertices[edge.edge.b]);
    if length / side_length.max(1.0) < 0.12 {
        return false;
    }
    edge.probabilities[2] >= 0.45
}

fn assignment_probability_row(assignment: usize, confidence: f32) -> [f32; 4] {
    let mut probabilities = [0.0; 4];
    probabilities[assignment] = confidence;
    probabilities[3] = probabilities[3].max(1.0 - confidence);
    probabilities
}

#[derive(Debug, Clone, Serialize)]
struct StructuralValidity {
    parseable_fold: bool,
    no_duplicate_edges: bool,
    no_zero_length_edges: bool,
    no_illegal_crossings: bool,
    complete_border_when_present: bool,
    errors: Vec<String>,
    valid: bool,
}

fn structural_validity(vertices: &[Point], edges: &[AttributedEdge]) -> StructuralValidity {
    let mut errors = Vec::new();
    let mut keys = Vec::new();
    for edge in edges {
        keys.push((edge.edge.a.min(edge.edge.b), edge.edge.a.max(edge.edge.b)));
    }
    let mut sorted_keys = keys.clone();
    sorted_keys.sort_unstable();
    sorted_keys.dedup();
    let no_duplicate_edges = sorted_keys.len() == keys.len();
    if !no_duplicate_edges {
        errors.push("duplicate edges found".to_owned());
    }

    let no_zero_length_edges = edges.iter().all(|edge| {
        edge.edge.a != edge.edge.b && distance(vertices[edge.edge.a], vertices[edge.edge.b]) >= 1e-6
    });
    if !no_zero_length_edges {
        errors.push("zero-length edge found".to_owned());
    }

    let no_illegal_crossings = no_illegal_crossings(vertices, edges);
    if !no_illegal_crossings {
        errors.push("illegal crossing found".to_owned());
    }

    let border_count = edges
        .iter()
        .filter(|edge| edge.edge.assignment == 2)
        .count();
    let complete_border_when_present = border_count == 0 || border_count >= 4;
    if !complete_border_when_present {
        errors.push("fewer than four border edges".to_owned());
    }

    let parseable_fold = edges.iter().all(|edge| {
        edge.edge.a < vertices.len()
            && edge.edge.b < vertices.len()
            && edge.edge.assignment <= 3
            && edge.edge.a != edge.edge.b
    });
    if !parseable_fold {
        errors.push("parseable_fold: invalid edge reference or assignment".to_owned());
    }
    let valid = parseable_fold
        && no_duplicate_edges
        && no_zero_length_edges
        && no_illegal_crossings
        && complete_border_when_present;
    StructuralValidity {
        parseable_fold,
        no_duplicate_edges,
        no_zero_length_edges,
        no_illegal_crossings,
        complete_border_when_present,
        errors,
        valid,
    }
}

fn no_illegal_crossings(vertices: &[Point], edges: &[AttributedEdge]) -> bool {
    for i in 0..edges.len() {
        let a = &edges[i].edge;
        for b in edges.iter().skip(i + 1).map(|edge| &edge.edge) {
            if [a.a, a.b].iter().any(|idx| *idx == b.a || *idx == b.b) {
                continue;
            }
            if proper_segments_intersect(vertices[a.a], vertices[a.b], vertices[b.a], vertices[b.b])
            {
                return false;
            }
        }
    }
    true
}

fn build_quality_warnings(
    vertices: &[Point],
    edges: &[AttributedEdge],
    structural: &StructuralValidity,
    size: usize,
) -> Vec<DecodeWarning> {
    let mut warnings = Vec::new();
    warnings.extend(structural_warnings(edges, structural));
    warnings.extend(square_compile_gate_warnings(vertices, edges, size));
    warnings.extend(support_and_envelope_warnings(vertices, edges));
    warnings.extend(assignment_warnings(edges));
    warnings.extend(origami_constraint_warnings(vertices, edges));
    warnings
}

fn structural_warnings(
    edges: &[AttributedEdge],
    structural: &StructuralValidity,
) -> Vec<DecodeWarning> {
    let mut warnings = Vec::new();
    if edges.is_empty() {
        warnings.push(warning(
            "empty_graph",
            "No edges were detected in the graph.",
            "error",
        ));
    }
    if !structural.parseable_fold {
        let mut item = warning(
            "unparseable_fold",
            "The predicted graph cannot be parsed as a FOLD graph.",
            "error",
        );
        item.details = Some(json!({ "errors": structural.errors }));
        warnings.push(item);
    }
    if !structural.no_duplicate_edges {
        warnings.push(warning(
            "duplicate_edges",
            "Duplicate edges remain in the graph.",
            "error",
        ));
    }
    if !structural.no_zero_length_edges {
        warnings.push(warning(
            "zero_length_edges",
            "Zero-length edges remain in the graph.",
            "error",
        ));
    }
    if !structural.no_illegal_crossings {
        warnings.push(warning(
            "illegal_crossings",
            "Edges cross away from graph vertices.",
            "error",
        ));
    }
    let border_count = edges
        .iter()
        .filter(|edge| edge.edge.assignment == 2)
        .count();
    if border_count < 4 {
        let mut item = warning(
            "incomplete_border",
            "Fewer than four square border edges were recovered.",
            "warning",
        );
        item.details = Some(json!({ "border_edge_count": border_count }));
        warnings.push(item);
    }
    warnings
}

fn square_compile_gate_warnings(
    vertices: &[Point],
    edges: &[AttributedEdge],
    _size: usize,
) -> Vec<DecodeWarning> {
    if vertices.is_empty() {
        return Vec::new();
    }
    let border_indices: Vec<usize> = edges
        .iter()
        .enumerate()
        .filter_map(|(idx, edge)| (edge.edge.assignment == 2).then_some(idx))
        .collect();
    if border_indices.is_empty() {
        return vec![warning(
            "missing_square_border",
            "No deterministic square border cycle is present.",
            "warning",
        )];
    }
    let Some((left, top, right, bottom)) = square_gate_frame(vertices, edges, &border_indices)
    else {
        return Vec::new();
    };
    let width = right - left;
    let height = bottom - top;
    let side_length = width.max(height).max(1.0);
    let boundary_tol = 3.0_f32.max(0.01 * side_length);
    let corner_tol = boundary_tol;
    let mut warnings = Vec::new();
    let aspect_error = (width - height).abs() / side_length;
    if aspect_error > 0.03 {
        let mut item = warning(
            "non_square_border_frame",
            "The inferred border frame is rectangular rather than square.",
            "warning",
        );
        item.details = Some(json!({
            "width_px": width,
            "height_px": height,
            "aspect_error": aspect_error,
            "tolerance": 0.03,
        }));
        warnings.push(item);
    }

    let corners = [
        ("top_left", Point { x: left, y: top }),
        ("top_right", Point { x: right, y: top }),
        (
            "bottom_right",
            Point {
                x: right,
                y: bottom,
            },
        ),
        ("bottom_left", Point { x: left, y: bottom }),
    ];
    let missing_corners: Vec<&str> = corners
        .iter()
        .filter_map(|(name, corner)| {
            (!has_vertex_near(vertices, *corner, corner_tol)).then_some(*name)
        })
        .collect();
    if !missing_corners.is_empty() {
        let mut item = warning(
            "missing_square_corners",
            "One or more square frame corners are not represented as graph vertices.",
            "warning",
        );
        item.details = Some(json!({ "corners": missing_corners, "tolerance_px": corner_tol }));
        warnings.push(item);
    }

    let mut border_degrees = vec![0usize; vertices.len()];
    let mut non_border_incident = vec![false; vertices.len()];
    let mut border_vertices = Vec::new();
    let mut border_adjacency = vec![Vec::<usize>::new(); vertices.len()];
    let mut non_square_edges = Vec::new();
    for (edge_idx, attributed) in edges.iter().enumerate() {
        let edge = &attributed.edge;
        if edge.assignment == 2 {
            border_degrees[edge.a] += 1;
            border_degrees[edge.b] += 1;
            border_vertices.push(edge.a);
            border_vertices.push(edge.b);
            border_adjacency[edge.a].push(edge.b);
            border_adjacency[edge.b].push(edge.a);
            if common_frame_side(
                vertices[edge.a],
                vertices[edge.b],
                (left, top, right, bottom),
                boundary_tol,
            )
            .is_none()
            {
                non_square_edges.push(edge_idx);
            }
        } else {
            non_border_incident[edge.a] = true;
            non_border_incident[edge.b] = true;
        }
    }
    border_vertices.sort_unstable();
    border_vertices.dedup();
    if !non_square_edges.is_empty() {
        let mut item = warning(
            "non_square_border_edges",
            "Some border-labeled edges are not axis-aligned frame-side segments.",
            "warning",
        );
        item.edge_indices = non_square_edges;
        item.details = Some(json!({ "tolerance_px": boundary_tol }));
        warnings.push(item);
    }
    if !border_vertices.is_empty() {
        let bad_degree_vertices: Vec<usize> = border_vertices
            .iter()
            .copied()
            .filter(|idx| border_degrees[*idx] != 2)
            .collect();
        let disconnected = !border_vertices_are_connected(&border_vertices, &border_adjacency);
        if !bad_degree_vertices.is_empty() || disconnected {
            let mut item = warning(
                "invalid_border_cycle",
                "Border edges do not form one closed square boundary cycle.",
                "warning",
            );
            item.vertex_indices = bad_degree_vertices.clone();
            item.details = Some(json!({
                "disconnected": disconnected,
                "bad_degree_vertices": bad_degree_vertices,
            }));
            warnings.push(item);
        }
    }
    let unsplit_contacts: Vec<usize> = vertices
        .iter()
        .enumerate()
        .filter_map(|(idx, point)| {
            (non_border_incident[idx]
                && point_on_gate_frame(*point, (left, top, right, bottom), boundary_tol)
                && border_degrees[idx] < 2)
                .then_some(idx)
        })
        .collect();
    if !unsplit_contacts.is_empty() {
        let mut item = warning(
            "boundary_contact_not_split",
            "A crease reaches the square boundary without splitting the border cycle at that contact.",
            "warning",
        );
        item.vertex_indices = unsplit_contacts;
        item.details = Some(json!({ "tolerance_px": boundary_tol }));
        warnings.push(item);
    }
    warnings
}

fn support_and_envelope_warnings(
    vertices: &[Point],
    edges: &[AttributedEdge],
) -> Vec<DecodeWarning> {
    let mut warnings = Vec::new();
    let weak: Vec<usize> = edges
        .iter()
        .enumerate()
        .filter_map(|(idx, edge)| (edge.edge.support < 0.40).then_some(idx))
        .collect();
    if !weak.is_empty() {
        let mut item = warning(
            "weak_edges",
            "Some edges have weak line-evidence support.",
            "warning",
        );
        item.edge_indices = weak;
        item.details = Some(json!({ "threshold": 0.40 }));
        warnings.push(item);
    }
    let lengths: Vec<f32> = edges
        .iter()
        .map(|edge| distance(vertices[edge.edge.a], vertices[edge.edge.b]))
        .collect();
    let short: Vec<usize> = lengths
        .iter()
        .enumerate()
        .filter_map(|(idx, length)| (*length < 8.0).then_some(idx))
        .collect();
    if !short.is_empty() {
        let min_length = short
            .iter()
            .map(|idx| lengths[*idx])
            .fold(f32::INFINITY, f32::min);
        let mut item = warning(
            "very_short_edges",
            "Some predicted edges are shorter than the Phase 3 V1 readable-geometry envelope.",
            "warning",
        );
        item.edge_indices = short;
        item.details = Some(json!({ "threshold_px": 8.0, "min_length_px": min_length }));
        warnings.push(item);
    }
    let crowded = crowded_vertices(vertices, 8.0);
    if !crowded.is_empty() {
        let mut item = warning(
            "crowded_junctions",
            "Some junctions are closer than the Phase 3 V1 readable-geometry envelope.",
            "warning",
        );
        item.vertex_indices = crowded.clone();
        item.details = Some(json!({ "threshold_px": 8.0 }));
        warnings.push(item);
    }
    let short_fraction = if edges.is_empty() {
        0.0
    } else {
        lengths.iter().filter(|length| **length < 8.0).count() as f32 / edges.len() as f32
    };
    let crowded_fraction = if vertices.is_empty() {
        0.0
    } else {
        crowded.len() as f32 / vertices.len() as f32
    };
    if edges.len() >= 450
        || vertices.len() >= 350
        || short_fraction >= 0.18
        || crowded_fraction >= 0.18
    {
        let mut item = warning(
            "dense_geometry",
            "The predicted graph is dense enough that it may be outside the Phase 3 V1 1024px readable-geometry envelope.",
            "warning",
        );
        item.details = Some(json!({
            "edge_count": edges.len(),
            "vertex_count": vertices.len(),
            "edge_count_threshold": 450,
            "vertex_count_threshold": 350,
            "short_edge_count": lengths.iter().filter(|length| **length < 8.0).count(),
            "short_edge_fraction": short_fraction,
            "short_edge_fraction_threshold": 0.18,
            "crowded_vertex_count": crowded.len(),
            "crowded_vertex_fraction": crowded_fraction,
            "crowded_vertex_fraction_threshold": 0.18,
        }));
        warnings.push(item);
    }
    warnings
}

fn assignment_warnings(edges: &[AttributedEdge]) -> Vec<DecodeWarning> {
    let mut low = Vec::new();
    let mut unknown = Vec::new();
    for (idx, edge) in edges.iter().enumerate() {
        if edge.source == AssignmentSource::Unknown {
            unknown.push(idx);
        }
        if edge.confidence < 0.60 || edge.margin < 0.12 {
            low.push(idx);
        }
    }
    let mut warnings = Vec::new();
    if !low.is_empty() {
        let mut item = warning(
            "low_confidence_assignments",
            "Some edge assignments have low confidence or a small class margin.",
            "warning",
        );
        item.edge_indices = low;
        item.details = Some(json!({
            "confidence_threshold": 0.60,
            "margin_threshold": 0.12,
        }));
        warnings.push(item);
    }
    if !unknown.is_empty() {
        let mut item = warning(
            "unknown_assignments",
            "Some edge assignments are visually ambiguous and remain unassigned.",
            "warning",
        );
        item.edge_indices = unknown;
        warnings.push(item);
    }
    warnings
}

fn origami_constraint_warnings(vertices: &[Point], edges: &[AttributedEdge]) -> Vec<DecodeWarning> {
    let adjacency = edge_adjacency(vertices.len(), edges);
    let mut odd_vertices = Vec::new();
    let mut kawasaki_violations = Vec::new();
    let mut maekawa_violations = Vec::new();
    let mut residuals = serde_json::Map::new();
    for (vertex_idx, incident_all) in adjacency.iter().enumerate() {
        if incident_all.is_empty()
            || incident_all
                .iter()
                .any(|idx| edges[*idx].edge.assignment == 2)
        {
            continue;
        }
        let incident: Vec<usize> = incident_all
            .iter()
            .copied()
            .filter(|idx| edges[*idx].edge.assignment != 2)
            .collect();
        if incident.is_empty() {
            continue;
        }
        if incident.len() % 2 != 0 {
            odd_vertices.push(vertex_idx);
        }
        if incident.len() >= 4 && incident.len() % 2 == 0 {
            let residual = kawasaki_residual(vertices, edges, vertex_idx, &incident);
            if residual > 0.12 {
                kawasaki_violations.push(vertex_idx);
                residuals.insert(vertex_idx.to_string(), json!(residual));
            }
        }
        if incident
            .iter()
            .all(|idx| matches!(edges[*idx].edge.assignment, 0 | 1))
        {
            let m_count = incident
                .iter()
                .filter(|idx| edges[**idx].edge.assignment == 0)
                .count();
            let v_count = incident
                .iter()
                .filter(|idx| edges[**idx].edge.assignment == 1)
                .count();
            if (m_count as isize - v_count as isize).abs() != 2 {
                maekawa_violations.push(vertex_idx);
            }
        }
    }
    let mut warnings = Vec::new();
    if !odd_vertices.is_empty() {
        let mut item = warning(
            "even_degree_failures",
            "Interior vertices with crease evidence should have even degree.",
            "warning",
        );
        item.vertex_indices = odd_vertices;
        warnings.push(item);
    }
    if !kawasaki_violations.is_empty() {
        let mut item = warning(
            "kawasaki_residuals",
            "Interior vertex sector angles violate the Kawasaki tolerance.",
            "warning",
        );
        item.vertex_indices = kawasaki_violations;
        item.details = Some(json!({ "tolerance_radians": 0.12, "residuals": residuals }));
        warnings.push(item);
    }
    if !maekawa_violations.is_empty() {
        let mut item = warning(
            "maekawa_failures",
            "Fully observed M/V assignments violate Maekawa's theorem.",
            "warning",
        );
        item.vertex_indices = maekawa_violations;
        warnings.push(item);
    }
    warnings
}

fn quality_status(
    warnings: &[DecodeWarning],
    structural: &StructuralValidity,
    repair_actions: &[RepairAction],
    edge_count: usize,
) -> &'static str {
    let codes: std::collections::BTreeSet<&str> = warnings
        .iter()
        .map(|warning| warning.code.as_str())
        .collect();
    let failed = [
        "empty_graph",
        "unparseable_fold",
        "duplicate_edges",
        "zero_length_edges",
        "illegal_crossings",
    ];
    let outside = [
        "incomplete_border",
        "missing_square_border",
        "missing_square_corners",
        "non_square_border_frame",
        "non_square_border_edges",
        "invalid_border_cycle",
        "boundary_contact_not_split",
        "very_short_edges",
        "crowded_junctions",
        "weak_edges",
        "dense_geometry",
    ];
    let ambiguous = [
        "low_confidence_assignments",
        "unknown_assignments",
        "even_degree_failures",
        "kawasaki_residuals",
        "maekawa_failures",
    ];
    if edge_count == 0
        || !structural.parseable_fold
        || failed.iter().any(|code| codes.contains(code))
    {
        "failed"
    } else if outside.iter().any(|code| codes.contains(code)) {
        "outside_v1_envelope"
    } else if ambiguous.iter().any(|code| codes.contains(code)) {
        "ambiguous"
    } else if !repair_actions.is_empty() {
        "repaired"
    } else {
        "valid"
    }
}

fn quality_report_value(
    status: &str,
    warnings: &[DecodeWarning],
    structural: &StructuralValidity,
    repair_actions: &[RepairAction],
    vertices: &[Point],
    edges: &[AttributedEdge],
) -> Value {
    json!({
        "status": status,
        "warnings": warnings,
        "structural_validity": structural,
        "repair_actions": repair_actions,
        "summary": {
            "vertices": vertices.len(),
            "edges": edges.len(),
            "assignment_counts": assignment_counts(edges),
            "observed_edges": edges.iter().filter(|edge| edge.source == AssignmentSource::Observed).count(),
            "unknown_edges": edges.iter().filter(|edge| edge.source == AssignmentSource::Unknown).count(),
            "inferred_edges": 0,
            "mean_edge_support": mean_f32(edges.iter().map(|edge| edge.edge.support)),
            "mean_assignment_confidence": mean_f32(edges.iter().map(|edge| edge.confidence)),
        }
    })
}

fn warning(code: &str, message: &str, severity: &str) -> DecodeWarning {
    DecodeWarning {
        code: code.to_owned(),
        message: message.to_owned(),
        severity: severity.to_owned(),
        edge_indices: Vec::new(),
        vertex_indices: Vec::new(),
        details: Some(json!({})),
    }
}

fn fold_value(
    vertices: &[Point],
    edges: &[AttributedEdge],
    size: usize,
    config: &DecodeConfig,
    status: &str,
    warnings: &[DecodeWarning],
    repair_actions: &[RepairAction],
    quality_report: &Value,
) -> Value {
    let max = (size - 1).max(1) as f32;
    let vertices_coords: Vec<[f32; 2]> = vertices
        .iter()
        .map(|point| {
            [
                (point.x / max).clamp(0.0, 1.0),
                (point.y / max).clamp(0.0, 1.0),
            ]
        })
        .collect();
    let edges_vertices: Vec<[usize; 2]> = edges
        .iter()
        .map(|edge| [edge.edge.a, edge.edge.b])
        .collect();
    let edges_assignment: Vec<&'static str> = edges
        .iter()
        .map(|edge| match edge.edge.assignment {
            0 => "M",
            1 => "V",
            2 => "B",
            _ => "U",
        })
        .collect();
    let edge_support: Vec<f32> = edges.iter().map(|edge| edge.edge.support).collect();
    let assignment_confidence: Vec<f32> = edges.iter().map(|edge| edge.confidence).collect();
    let assignment_margin: Vec<f32> = edges.iter().map(|edge| edge.margin).collect();
    let assignment_source: Vec<&'static str> = edges
        .iter()
        .map(|edge| match edge.source {
            AssignmentSource::Observed => "observed",
            AssignmentSource::Unknown => "unknown",
        })
        .collect();
    let assignment_probabilities: Vec<[f32; 4]> =
        edges.iter().map(|edge| edge.probabilities).collect();
    json!({
        "file_spec": 1.1,
        "file_creator": "cp-detector cp-detect",
        "file_classes": ["singleModel"],
        "frame_classes": ["creasePattern"],
        "vertices_coords": vertices_coords,
        "edges_vertices": edges_vertices,
        "edges_assignment": edges_assignment,
        "cp_detector": {
            "schema": "cp-detector/cp-detect/v1",
            "status": status,
            "edge_support": edge_support,
            "assignment_confidence": assignment_confidence,
            "assignment_margin": assignment_margin,
            "assignment_source": assignment_source,
            "repair_actions": repair_actions,
            "assignment_probabilities": assignment_probabilities,
            "warnings": warnings,
            "summary": quality_report.get("summary").cloned().unwrap_or_else(|| json!({})),
            "structural_validity": quality_report
                .get("structural_validity")
                .cloned()
                .unwrap_or_else(|| json!({})),
            "image_size": config.image_size,
            "threshold": config.threshold,
        },
    })
}

fn square_gate_frame(
    vertices: &[Point],
    edges: &[AttributedEdge],
    border_indices: &[usize],
) -> Option<(f32, f32, f32, f32)> {
    let mut border_vertices = Vec::new();
    for edge_idx in border_indices {
        let edge = &edges[*edge_idx].edge;
        border_vertices.push(edge.a);
        border_vertices.push(edge.b);
    }
    border_vertices.sort_unstable();
    border_vertices.dedup();
    if border_vertices.is_empty() {
        return None;
    }
    let mut left = f32::INFINITY;
    let mut right = f32::NEG_INFINITY;
    let mut top = f32::INFINITY;
    let mut bottom = f32::NEG_INFINITY;
    for idx in border_vertices {
        let point = vertices[idx];
        left = left.min(point.x);
        right = right.max(point.x);
        top = top.min(point.y);
        bottom = bottom.max(point.y);
    }
    if right - left <= 1e-6 || bottom - top <= 1e-6 {
        None
    } else {
        Some((left, top, right, bottom))
    }
}

fn has_vertex_near(vertices: &[Point], point: Point, tolerance: f32) -> bool {
    vertices
        .iter()
        .any(|vertex| distance(*vertex, point) <= tolerance)
}

fn point_on_gate_frame(point: Point, frame: (f32, f32, f32, f32), tolerance: f32) -> bool {
    let (left, top, right, bottom) = frame;
    (point.x - left).abs() <= tolerance
        || (point.y - top).abs() <= tolerance
        || (point.x - right).abs() <= tolerance
        || (point.y - bottom).abs() <= tolerance
}

fn point_on_gate_side(
    point: Point,
    side: &str,
    frame: (f32, f32, f32, f32),
    tolerance: f32,
) -> bool {
    let (left, top, right, bottom) = frame;
    match side {
        "top" => {
            (point.y - top).abs() <= tolerance
                && left - tolerance <= point.x
                && point.x <= right + tolerance
        }
        "right" => {
            (point.x - right).abs() <= tolerance
                && top - tolerance <= point.y
                && point.y <= bottom + tolerance
        }
        "bottom" => {
            (point.y - bottom).abs() <= tolerance
                && left - tolerance <= point.x
                && point.x <= right + tolerance
        }
        "left" => {
            (point.x - left).abs() <= tolerance
                && top - tolerance <= point.y
                && point.y <= bottom + tolerance
        }
        _ => false,
    }
}

fn common_frame_side(
    p0: Point,
    p1: Point,
    frame: (f32, f32, f32, f32),
    tolerance: f32,
) -> Option<&'static str> {
    ["top", "right", "bottom", "left"].into_iter().find(|side| {
        point_on_gate_side(p0, side, frame, tolerance)
            && point_on_gate_side(p1, side, frame, tolerance)
    })
}

fn border_vertices_are_connected(border_vertices: &[usize], adjacency: &[Vec<usize>]) -> bool {
    if border_vertices.is_empty() {
        return false;
    }
    let border: std::collections::BTreeSet<usize> = border_vertices.iter().copied().collect();
    let mut seen = std::collections::BTreeSet::new();
    let mut stack = vec![border_vertices[0]];
    seen.insert(border_vertices[0]);
    while let Some(current) = stack.pop() {
        for neighbor in adjacency.get(current).into_iter().flatten() {
            if !border.contains(neighbor) || seen.contains(neighbor) {
                continue;
            }
            seen.insert(*neighbor);
            stack.push(*neighbor);
        }
    }
    seen == border
}

fn crowded_vertices(vertices: &[Point], threshold: f32) -> Vec<usize> {
    let mut crowded = std::collections::BTreeSet::new();
    for i in 0..vertices.len() {
        for j in i + 1..vertices.len() {
            if distance(vertices[i], vertices[j]) < threshold {
                crowded.insert(i);
                crowded.insert(j);
            }
        }
    }
    crowded.into_iter().collect()
}

fn edge_adjacency(vertex_count: usize, edges: &[AttributedEdge]) -> Vec<Vec<usize>> {
    let mut adjacency = vec![Vec::new(); vertex_count];
    for (edge_idx, edge) in edges.iter().enumerate() {
        adjacency[edge.edge.a].push(edge_idx);
        adjacency[edge.edge.b].push(edge_idx);
    }
    adjacency
}

fn kawasaki_residual(
    vertices: &[Point],
    edges: &[AttributedEdge],
    vertex_idx: usize,
    incident: &[usize],
) -> f32 {
    let center = vertices[vertex_idx];
    let mut angles = Vec::new();
    for edge_idx in incident {
        let edge = &edges[*edge_idx].edge;
        let other = if edge.a == vertex_idx { edge.b } else { edge.a };
        let vector = Point {
            x: vertices[other].x - center.x,
            y: vertices[other].y - center.y,
        };
        if (vector.x * vector.x + vector.y * vector.y).sqrt() <= 1e-6 {
            continue;
        }
        angles.push(vector.y.atan2(vector.x).rem_euclid(std::f32::consts::TAU));
    }
    if angles.len() < 4 || angles.len() % 2 != 0 {
        return 0.0;
    }
    angles.sort_by(|left, right| left.total_cmp(right));
    let mut sectors = Vec::with_capacity(angles.len());
    for idx in 0..angles.len() {
        let next = if idx + 1 == angles.len() {
            angles[0] + std::f32::consts::TAU
        } else {
            angles[idx + 1]
        };
        sectors.push(next - angles[idx]);
    }
    let even: f32 = sectors.iter().step_by(2).sum();
    let odd: f32 = sectors.iter().skip(1).step_by(2).sum();
    let residual = (even - odd).abs();
    residual.min((std::f32::consts::TAU - residual).abs())
}

fn assignment_counts(edges: &[AttributedEdge]) -> Value {
    json!({
        "M": edges.iter().filter(|edge| edge.edge.assignment == 0).count(),
        "V": edges.iter().filter(|edge| edge.edge.assignment == 1).count(),
        "B": edges.iter().filter(|edge| edge.edge.assignment == 2).count(),
        "U": edges.iter().filter(|edge| edge.edge.assignment == 3).count(),
    })
}

fn mean_f32(values: impl Iterator<Item = f32>) -> f32 {
    let mut count = 0usize;
    let mut sum = 0.0f32;
    for value in values {
        count += 1;
        sum += value;
    }
    if count == 0 { 0.0 } else { sum / count as f32 }
}

fn square_corners(size: usize) -> Vec<Point> {
    let max = (size - 1) as f32;
    vec![
        Point { x: 0.0, y: 0.0 },
        Point { x: max, y: 0.0 },
        Point { x: max, y: max },
        Point { x: 0.0, y: max },
    ]
}

fn merge_vertices(vertices: &[Point], size: usize, tol: f32) -> Vec<Point> {
    let mut used = vec![false; vertices.len()];
    let mut merged = Vec::new();
    for (idx, point) in vertices.iter().enumerate() {
        if used[idx] {
            continue;
        }
        let mut sum = Point { x: 0.0, y: 0.0 };
        let mut count = 0.0;
        for (other_idx, other) in vertices.iter().enumerate() {
            if used[other_idx] || distance(*point, *other) > tol {
                continue;
            }
            used[other_idx] = true;
            sum.x += other.x;
            sum.y += other.y;
            count += 1.0;
        }
        merged.push(snap_to_frame(
            Point {
                x: sum.x / count,
                y: sum.y / count,
            },
            size,
            tol,
        ));
    }
    merged
}

fn refresh_vertex_meta(vertices: &[Point], size: usize, vertex_merge_px: f32) -> Vec<String> {
    vertices
        .iter()
        .map(|vertex| {
            if is_corner(*vertex, size, vertex_merge_px) {
                "corner".to_owned()
            } else if point_on_frame(*vertex, size, vertex_merge_px + 1.0) {
                "boundary_contact".to_owned()
            } else {
                "junction".to_owned()
            }
        })
        .collect()
}

fn dedupe_points(points: &mut Vec<Point>, tol: f32) {
    let mut out = Vec::new();
    for point in points.drain(..) {
        if !out.iter().any(|other| distance(*other, point) <= tol) {
            out.push(point);
        }
    }
    *points = out;
}

fn line_is_frame_border(line: &Line, size: usize) -> bool {
    segment_is_frame_border(line.p0, line.p1, size)
}

fn segment_is_frame_border(a: Point, b: Point, size: usize) -> bool {
    let max = (size - 1) as f32;
    let tol = 4.0;
    (a.y.abs() <= tol && b.y.abs() <= tol)
        || ((a.y - max).abs() <= tol && (b.y - max).abs() <= tol)
        || (a.x.abs() <= tol && b.x.abs() <= tol)
        || ((a.x - max).abs() <= tol && (b.x - max).abs() <= tol)
}

fn point_on_frame(point: Point, size: usize, tol: f32) -> bool {
    let max = (size - 1) as f32;
    point.x.abs() <= tol
        || point.y.abs() <= tol
        || (point.x - max).abs() <= tol
        || (point.y - max).abs() <= tol
}

fn point_in_frame(point: Point, size: usize, tol: f32) -> bool {
    let max = (size - 1) as f32;
    point.x >= -tol && point.y >= -tol && point.x <= max + tol && point.y <= max + tol
}

fn point_on_side(point: Point, side: usize, size: usize, tol: f32) -> bool {
    let max = (size - 1) as f32;
    match side {
        0 => point.y.abs() <= tol,
        1 => (point.x - max).abs() <= tol,
        2 => (point.y - max).abs() <= tol,
        _ => point.x.abs() <= tol,
    }
}

fn side_position(point: Point, side: usize) -> f32 {
    if side == 0 || side == 2 {
        point.x
    } else {
        point.y
    }
}

fn is_corner(point: Point, size: usize, tol: f32) -> bool {
    square_corners(size)
        .into_iter()
        .any(|corner| distance(point, corner) <= tol)
}

fn snap_to_frame(point: Point, size: usize, tol: f32) -> Point {
    let max = (size - 1) as f32;
    let mut x = point.x.clamp(0.0, max);
    let mut y = point.y.clamp(0.0, max);
    if x <= tol {
        x = 0.0;
    } else if (x - max).abs() <= tol {
        x = max;
    }
    if y <= tol {
        y = 0.0;
    } else if (y - max).abs() <= tol {
        y = max;
    }
    Point { x, y }
}

fn point_line_distance(point: Point, line: &Line) -> f32 {
    let direction = Point {
        x: line.p1.x - line.p0.x,
        y: line.p1.y - line.p0.y,
    };
    let length = (direction.x * direction.x + direction.y * direction.y).sqrt();
    if length <= 1e-6 {
        return distance(point, line.p0);
    }
    let delta = Point {
        x: point.x - line.p0.x,
        y: point.y - line.p0.y,
    };
    ((direction.x * delta.y - direction.y * delta.x) / length).abs()
}

fn point_on_finite_line(point: Point, line: &Line, tol: f32) -> bool {
    if point_line_distance(point, line) > tol {
        return false;
    }
    let t = project(point, line.direction);
    t >= line.t_min - tol && t <= line.t_max + tol
}

fn project(point: Point, direction: Point) -> f32 {
    point.x * direction.x + point.y * direction.y
}

fn distance(a: Point, b: Point) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}

fn sample_segment_points(a: Point, b: Point, step: f32) -> Vec<Point> {
    let length = distance(a, b);
    if length <= 1e-6 {
        return Vec::new();
    }
    let count = ((length / step.max(1e-3)).ceil() as usize + 1).max(2);
    let denom = (count - 1) as f32;
    (0..count)
        .map(|idx| {
            let t = idx as f32 / denom;
            Point {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
            }
        })
        .collect()
}

fn round_ties_even(value: f32) -> isize {
    let floor = value.floor();
    let fraction = value - floor;
    if (fraction - 0.5).abs() <= 1e-6 {
        let floor_int = floor as isize;
        if floor_int % 2 == 0 {
            floor_int
        } else {
            floor_int + 1
        }
    } else {
        value.round() as isize
    }
}

fn angle_distance_f64(a: f64, b: f64) -> f64 {
    let mut d = (a - b).abs() % std::f64::consts::PI;
    if d > std::f64::consts::PI / 2.0 {
        d = std::f64::consts::PI - d;
    }
    d
}

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

fn argmax_channel(values: &[f32], channels: usize, pixel_idx: usize, pixels: usize) -> usize {
    let mut best = 0usize;
    let mut best_value = f32::NEG_INFINITY;
    for channel in 0..channels {
        let value = values[channel * pixels + pixel_idx];
        if value > best_value {
            best_value = value;
            best = channel;
        }
    }
    best
}

fn default_min_edge_support() -> f32 {
    0.45
}

fn default_min_edge_length_px() -> f32 {
    3.0
}

fn default_edge_sample_step_px() -> f32 {
    1.0
}

fn default_edge_sample_width_px() -> usize {
    3
}

fn default_dashed_support_weight() -> f32 {
    0.35
}

fn default_gapped_style_support_weight() -> f32 {
    0.55
}

fn default_gapped_style_min_confidence() -> f32 {
    0.55
}

fn default_gapped_style_line_floor() -> f32 {
    0.12
}

fn default_assignment_min_confidence() -> f32 {
    0.75
}

fn default_vertex_merge_px() -> f32 {
    2.0
}

fn default_line_vertex_distance_px() -> f32 {
    4.0 * 1024.0 / 768.0
}

fn default_hough_vote_threshold() -> u32 {
    10
}

fn default_hough_suppression_radius() -> u32 {
    4
}

fn default_hough_line_distance_px() -> f32 {
    3.0
}

fn default_hough_min_segment_length_px() -> f32 {
    6.0
}

fn default_hough_max_segment_gap_px() -> f32 {
    4.0
}

fn default_carrier_extent_padding_px() -> f32 {
    24.0
}

fn default_carrier_merge_angle_degrees() -> f32 {
    2.5
}

fn default_carrier_merge_rho_px() -> f32 {
    3.0
}

fn default_max_line_hypotheses() -> usize {
    240
}

fn default_max_intersection_lines() -> usize {
    180
}

fn default_junction_snap_px() -> f32 {
    4.5
}

fn default_planar_cleanup() -> bool {
    true
}

fn default_planar_cleanup_max_edges() -> usize {
    2500
}

fn default_planar_split_vertex_distance_px() -> f32 {
    2.0
}

fn default_planar_crossing_support_tie() -> f32 {
    1e-4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_square_cross_into_fold_json() {
        let size = 64usize;
        let pixels = size * size;
        let mut line_logits = vec![-8.0; pixels];
        let mut junction_logits = vec![-8.0; pixels];
        let non_crease_logits = vec![-8.0; pixels];
        let mut assignment_logits = vec![-4.0; pixels * 4];
        let line_style_logits = vec![-4.0; pixels * 4];
        let mut boundary_contact_logits = vec![-8.0; pixels];

        draw_prob_line(&mut line_logits, size, (32, 0), (32, 63), 8.0);
        draw_prob_line(&mut line_logits, size, (0, 32), (63, 32), 8.0);
        draw_prob_line(&mut line_logits, size, (0, 0), (63, 0), 8.0);
        draw_prob_line(&mut line_logits, size, (63, 0), (63, 63), 8.0);
        draw_prob_line(&mut line_logits, size, (0, 63), (63, 63), 8.0);
        draw_prob_line(&mut line_logits, size, (0, 0), (0, 63), 8.0);
        junction_logits[32 * size + 32] = 8.0;
        boundary_contact_logits[32] = 8.0;
        boundary_contact_logits[63 * size + 32] = 8.0;
        boundary_contact_logits[32 * size] = 8.0;
        boundary_contact_logits[32 * size + 63] = 8.0;
        for y in 0..size {
            let idx = y * size + 32;
            assignment_logits[idx] = 8.0;
        }
        for x in 0..size {
            let idx = 32 * size + x;
            assignment_logits[pixels + idx] = 8.0;
        }
        for x in 0..size {
            assignment_logits[2 * pixels + x] = 8.0;
            assignment_logits[2 * pixels + (size - 1) * size + x] = 8.0;
        }
        for y in 0..size {
            assignment_logits[2 * pixels + y * size] = 8.0;
            assignment_logits[2 * pixels + y * size + size - 1] = 8.0;
        }

        let decoded = decode_dense_outputs(
            DenseOutputs {
                line_logits: &line_logits,
                junction_logits: &junction_logits,
                assignment_logits: &assignment_logits,
                non_crease_logits: &non_crease_logits,
                line_style_logits: &line_style_logits,
                boundary_contact_logits: &boundary_contact_logits,
            },
            DecodeConfig {
                image_size: size as u32,
                threshold: 0.65,
                carrier_extent_padding_px: size as f32,
                ..DecodeConfig::default()
            },
        )
        .expect("decode should succeed");
        let fold: Value = serde_json::from_str(&decoded.fold_json).expect("fold JSON");

        assert_eq!(fold["file_classes"][0], "singleModel");
        assert!(
            decoded.report.border_edge_count >= 4,
            "{:?}",
            decoded.report
        );
        assert!(
            decoded.report.interior_edge_count >= 4,
            "{:?}",
            decoded.report
        );
        assert_eq!(
            fold["edges_vertices"].as_array().unwrap().len(),
            decoded.report.edge_count
        );
    }

    #[test]
    fn assignment_vote_recovers_valley_segment() {
        let size = 32usize;
        let pixels = size * size;
        let mut assignment_labels = vec![0u8; pixels];
        for x in 2..30 {
            let idx = 16 * size + x;
            assignment_labels[idx] = 2;
        }

        let assignment = vote_assignment(
            Point { x: 2.0, y: 16.0 },
            Point { x: 29.0, y: 16.0 },
            Some(&assignment_labels),
            &DecodeConfig {
                image_size: size as u32,
                threshold: 0.65,
                ..DecodeConfig::default()
            },
            3,
        );

        assert_eq!(assignment, 1);
    }

    #[test]
    fn reconstruct_square_border_chain_rebuilds_missing_corner_frame() {
        let size = 64usize;
        let config = DecodeConfig {
            image_size: size as u32,
            min_edge_length_px: 2.0,
            ..DecodeConfig::default()
        };
        let line_prob = vec![0.0; size * size];
        let mut vertices = vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 30.0, y: 0.0 },
            Point { x: 0.0, y: 32.0 },
            Point { x: 0.0, y: 63.0 },
            Point { x: 32.0, y: 63.0 },
            Point { x: 63.0, y: 63.0 },
            Point { x: 63.0, y: 32.0 },
            Point { x: 30.0, y: 30.0 },
        ];
        let mut edges = vec![
            attributed_edge(0, 1, 3),
            attributed_edge(0, 2, 2),
            attributed_edge(2, 3, 2),
            attributed_edge(3, 4, 2),
            attributed_edge(4, 5, 2),
            attributed_edge(5, 6, 2),
            attributed_edge(7, 1, 2),
        ];

        let action =
            reconstruct_square_border_chain(&mut vertices, &mut edges, &line_prob, &config)
                .expect("frame should be reconstructed");

        assert_eq!(action.details["added_corner_vertices"], json!(1));
        assert!(
            vertices
                .iter()
                .any(|vertex| distance(*vertex, Point { x: 63.0, y: 0.0 }) < 1e-4),
            "top-right corner should be synthesized"
        );
        let frame = infer_border_frame(&vertices, size).expect("frame after repair");
        let tolerance =
            border_chain_tolerance((frame.right - frame.left).max(frame.bottom - frame.top));
        let frame_edges: Vec<&AttributedEdge> = edges
            .iter()
            .filter(|edge| {
                edge_lies_on_any_frame_side(&vertices, edge.edge.a, edge.edge.b, frame, tolerance)
            })
            .collect();
        assert!(
            frame_edges.len() >= 8,
            "expected split square frame, got {} edges",
            frame_edges.len()
        );
        assert!(
            frame_edges
                .iter()
                .all(|edge| edge.edge.assignment == 2 && edge.source == AssignmentSource::Observed),
            "all reconstructed frame edges should be observed B"
        );
        assert!(
            edges.iter().any(|edge| !edge_lies_on_any_frame_side(
                &vertices,
                edge.edge.a,
                edge.edge.b,
                frame,
                tolerance
            ) && edge.edge.assignment == 3),
            "off-frame border labels should be downgraded to U"
        );
        assert!(
            !edges.iter().any(|edge| edge.edge.assignment == 3
                && edge_lies_on_any_frame_side(
                    &vertices,
                    edge.edge.a,
                    edge.edge.b,
                    frame,
                    tolerance
                )),
            "frame edges should not remain U after reconstruction"
        );
    }

    fn attributed_edge(a: usize, b: usize, assignment: u8) -> AttributedEdge {
        AttributedEdge {
            edge: Edge {
                a,
                b,
                assignment,
                support: 0.9,
            },
            confidence: 0.9,
            margin: 0.9,
            source: if assignment == 3 {
                AssignmentSource::Unknown
            } else {
                AssignmentSource::Observed
            },
            probabilities: assignment_probability_row(assignment as usize, 0.9),
        }
    }

    fn draw_prob_line(
        logits: &mut [f32],
        size: usize,
        start: (usize, usize),
        end: (usize, usize),
        value: f32,
    ) {
        let dx = end.0 as isize - start.0 as isize;
        let dy = end.1 as isize - start.1 as isize;
        let steps = dx.abs().max(dy.abs()).max(1);
        for step in 0..=steps {
            let x = start.0 as isize + dx * step / steps;
            let y = start.1 as isize + dy * step / steps;
            for oy in -1..=1 {
                for ox in -1..=1 {
                    let px = x + ox;
                    let py = y + oy;
                    if px < 0 || py < 0 || px >= size as isize || py >= size as isize {
                        continue;
                    }
                    logits[py as usize * size + px as usize] = value;
                }
            }
        }
    }
}
