//! Dense-free candidate generation from raster evidence.
//!
//! This module intentionally mirrors the dense `candidate_generation` boundary
//! but consumes `RasterEvidence` instead of model heads. Strategies here must
//! emit a coherent compiler `CandidateGraph` and must not blend dense and
//! raster candidate sources implicitly.

use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

use oristudio_cp_compiler::candidate_graph::{
    BoundaryModel, BoundaryReconstructionPolicy, BoundarySideModel, CandidateCarrierGeometry,
    CandidateCreaseBoundaryRole, CandidateCreaseSpan, CandidateCreaseSpanKind, CandidateGraph,
    CandidateGraphReport, CandidateVertex, CandidateVertexMovementPolicy,
};
use oristudio_cp_compiler::{
    AssignmentEvidence, AssignmentEvidenceSource, AssignmentLabel, BoundarySide, CandidateConflict,
    CandidateConflictKind, CandidateCreaseSourceKind, CandidateGraphProvenance,
    CandidateSelectionPolicy, CandidateSourceAdapter, CandidateVertexKind, CostModel, Point2,
};
use serde::{Deserialize, Serialize};

use crate::opencv_hough_lines_p::{
    HoughError, HoughLinesPConfig, HoughSegment, hough_lines_p_opencv_cpu,
};
use crate::raster_evidence::RasterEvidence;

const RASTER_CARRIER_V1_STRATEGY_ID: &str = "raster-carrier-v1";
const SYNTHETIC_RENDER_INSET_PX: f64 = 32.0;
const GRAPH_SCHEMA: &str = "oristudio/cp-compiler/candidate-graph-v1";

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RasterCandidateGenerationStrategyName {
    #[default]
    RasterCarrierV1,
}

impl RasterCandidateGenerationStrategyName {
    pub const fn id(self) -> &'static str {
        match self {
            Self::RasterCarrierV1 => RASTER_CARRIER_V1_STRATEGY_ID,
        }
    }
}

impl fmt::Display for RasterCandidateGenerationStrategyName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.id())
    }
}

impl FromStr for RasterCandidateGenerationStrategyName {
    type Err = RasterCandidateGenerationStrategyParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            RASTER_CARRIER_V1_STRATEGY_ID | "raster_carrier_v1" => Ok(Self::RasterCarrierV1),
            other => Err(RasterCandidateGenerationStrategyParseError {
                value: other.to_owned(),
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown raster candidate generation strategy {value:?}")]
pub struct RasterCandidateGenerationStrategyParseError {
    pub value: String,
}

#[derive(Debug, Clone, Copy)]
pub struct RasterCandidateGenerationContext<'a> {
    pub evidence: &'a RasterEvidence,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RasterCandidateGenerationOptions {
    pub strategy: RasterCandidateGenerationStrategyName,
    pub raster_carrier_v1: RasterCarrierV1Options,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RasterCarrierV1Options {
    pub hough_vote_threshold: i32,
    pub hough_min_segment_length_px: f64,
    pub hough_max_segment_gap_px: f64,
    pub max_line_primitives: usize,
    pub min_line_primitive_support: f64,
    pub carrier_angle_tolerance_degrees: f64,
    pub carrier_rho_tolerance_px: f64,
    pub max_carriers: usize,
    pub carrier_extent_padding_px: f64,
    pub vertex_merge_radius_px: f64,
    pub vertex_carrier_distance_px: f64,
    pub min_vertex_support: f64,
    pub max_endpoint_vertices: usize,
    pub min_span_length_px: f64,
    pub min_span_line_support: f64,
    pub min_span_hit_fraction: f64,
    pub strong_span_line_support: f64,
    pub max_skip_vertices: usize,
    pub max_vertices_per_carrier: usize,
    pub max_spans_per_carrier: usize,
    pub max_total_spans: usize,
    pub edge_sample_step_px: f32,
}

impl Default for RasterCarrierV1Options {
    fn default() -> Self {
        Self {
            hough_vote_threshold: 12,
            hough_min_segment_length_px: 10.0,
            hough_max_segment_gap_px: 5.0,
            max_line_primitives: 1800,
            min_line_primitive_support: 0.30,
            carrier_angle_tolerance_degrees: 2.5,
            carrier_rho_tolerance_px: 5.0,
            max_carriers: 360,
            carrier_extent_padding_px: 10.0,
            vertex_merge_radius_px: 4.0,
            vertex_carrier_distance_px: 5.5,
            min_vertex_support: 0.16,
            max_endpoint_vertices: 400,
            min_span_length_px: 3.0,
            min_span_line_support: 0.32,
            min_span_hit_fraction: 0.34,
            strong_span_line_support: 0.55,
            max_skip_vertices: 0,
            max_vertices_per_carrier: 160,
            max_spans_per_carrier: 360,
            max_total_spans: 12000,
            edge_sample_step_px: 3.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RasterCandidateGenerationOutput {
    pub strategy: RasterCandidateGenerationStrategyName,
    pub candidate_graph: CandidateGraph,
    pub diagnostics: RasterCandidateGenerationDiagnostics,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RasterCandidateGenerationDiagnostics {
    pub raster_carrier_v1: Option<RasterCarrierV1Diagnostics>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RasterCarrierV1Diagnostics {
    pub hough_segments: usize,
    pub line_primitives: usize,
    pub carrier_hypotheses: Vec<RasterCarrierDiagnosticCarrier>,
    pub vertices_from_intersections: usize,
    pub vertices_from_boundary_contacts: usize,
    pub vertices_from_endpoints: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RasterCarrierDiagnosticCarrier {
    pub id: usize,
    pub normal: Point2,
    pub direction: Point2,
    pub rho: f64,
    pub t_interval: [f64; 2],
    pub support: f64,
    pub source_segments: usize,
    pub incident_vertices: usize,
    pub emitted_spans: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum RasterCandidateGenerationError {
    #[error("invalid raster image size: {0}")]
    InvalidImageSize(u32),
    #[error("OpenCV-compatible HoughLinesP failed: {0}")]
    Hough(#[from] HoughError),
}

pub fn generate_raster_candidate_graph(
    context: RasterCandidateGenerationContext<'_>,
    options: RasterCandidateGenerationOptions,
) -> Result<RasterCandidateGenerationOutput, RasterCandidateGenerationError> {
    match options.strategy {
        RasterCandidateGenerationStrategyName::RasterCarrierV1 => {
            let (candidate_graph, diagnostics) =
                raster_carrier_v1(context.evidence, options.raster_carrier_v1)?;
            Ok(RasterCandidateGenerationOutput {
                strategy: RasterCandidateGenerationStrategyName::RasterCarrierV1,
                candidate_graph,
                diagnostics: RasterCandidateGenerationDiagnostics {
                    raster_carrier_v1: Some(diagnostics),
                },
            })
        }
    }
}

fn raster_carrier_v1(
    evidence: &RasterEvidence,
    options: RasterCarrierV1Options,
) -> Result<(CandidateGraph, RasterCarrierV1Diagnostics), RasterCandidateGenerationError> {
    if evidence.image_size < 8 {
        return Err(RasterCandidateGenerationError::InvalidImageSize(
            evidence.image_size,
        ));
    }
    let line_primitives = raster_line_primitives(evidence, options)?;
    let carriers = carrier_hypotheses(&line_primitives, evidence.image_size, options);
    let (mut vertices, vertex_counts) =
        build_vertices(evidence, &line_primitives, &carriers, options);
    assign_vertex_ids(&mut vertices);
    let mut boundary = boundary_model(&vertices, [0, 1, 2, 3]);
    let mut spans = Vec::new();
    add_locked_border_spans(&vertices, &boundary, &mut spans);
    boundary.generated_border_span_ids = spans.iter().map(|span| span.id).collect();
    add_carrier_pair_spans(&vertices, &carriers, evidence, options, &mut spans);
    assign_span_ids(&mut spans);

    let mut graph = CandidateGraph {
        schema: GRAPH_SCHEMA.to_owned(),
        coordinate_space: "unit_square".to_owned(),
        image_size: Some(evidence.image_size),
        vertices,
        crease_candidates: spans,
        boundary,
        conflicts: Vec::new(),
        alternatives: Vec::new(),
        cost_model: CostModel::default(),
        provenance: CandidateGraphProvenance {
            source_adapter: CandidateSourceAdapter::ArrangementV2,
            source_ids: Vec::new(),
            notes: vec![
                "raster-carrier-v1 dense-free strategy; rectified pixels only, no model dense heads"
                    .to_owned(),
            ],
        },
        report: CandidateGraphReport {
            vertices: 0,
            crease_candidates: 0,
            locked_border_spans: 0,
            legacy_selected_spans: 0,
            legacy_low_threshold_spans: 0,
            arrangement_observed_spans: 0,
            arrangement_shared_spans: 0,
            conflicts: 0,
        },
    };
    graph.conflicts = generate_conflicts(&graph);
    graph.alternatives = graph.conflicts.clone();
    graph.report = graph_report(&graph);

    let diagnostics = RasterCarrierV1Diagnostics {
        hough_segments: line_primitives
            .iter()
            .map(|primitive| primitive.source_segments)
            .sum(),
        line_primitives: line_primitives.len(),
        carrier_hypotheses: carrier_diagnostics(&graph, &carriers, evidence.image_size, options),
        vertices_from_intersections: vertex_counts.intersections,
        vertices_from_boundary_contacts: vertex_counts.boundary_contacts,
        vertices_from_endpoints: vertex_counts.endpoints,
    };
    Ok((graph, diagnostics))
}

#[derive(Debug, Clone)]
struct RasterLinePrimitive {
    id: usize,
    p0: [f32; 2],
    p1: [f32; 2],
    support: f64,
    votes: usize,
    source_segments: usize,
}

fn raster_line_primitives(
    evidence: &RasterEvidence,
    options: RasterCarrierV1Options,
) -> Result<Vec<RasterLinePrimitive>, RasterCandidateGenerationError> {
    let size = evidence.image_size as usize;
    let segments = hough_lines_p_opencv_cpu(
        &evidence.line_mask,
        size,
        size,
        &HoughLinesPConfig {
            rho: 1.0,
            theta: std::f32::consts::PI / 720.0,
            threshold: options.hough_vote_threshold.max(1),
            min_line_length: options.hough_min_segment_length_px,
            max_line_gap: options.hough_max_segment_gap_px,
            lines_max: i32::MAX,
        },
    )?;
    let mut primitives = segments
        .iter()
        .enumerate()
        .filter_map(|(id, segment)| line_primitive_from_hough(id, segment, evidence, options))
        .collect::<Vec<_>>();
    primitives.sort_by(|left, right| {
        right
            .support
            .total_cmp(&left.support)
            .then_with(|| {
                segment_length_px(right.p0, right.p1)
                    .total_cmp(&segment_length_px(left.p0, left.p1))
            })
            .then_with(|| right.votes.cmp(&left.votes))
    });
    primitives.truncate(options.max_line_primitives);
    Ok(primitives)
}

fn line_primitive_from_hough(
    id: usize,
    segment: &HoughSegment,
    evidence: &RasterEvidence,
    options: RasterCarrierV1Options,
) -> Option<RasterLinePrimitive> {
    let p0 = [segment.x1 as f32, segment.y1 as f32];
    let p1 = [segment.x2 as f32, segment.y2 as f32];
    if segment_length_px(p0, p1) < options.hough_min_segment_length_px {
        return None;
    }
    let support = sample_scalar_along_segment(
        p0,
        p1,
        &evidence.line_probability,
        evidence.image_size as usize,
        options.edge_sample_step_px,
    ) as f64;
    if support < options.min_line_primitive_support {
        return None;
    }
    Some(RasterLinePrimitive {
        id,
        p0,
        p1,
        support,
        votes: segment_votes(segment),
        source_segments: 1,
    })
}

fn segment_votes(segment: &HoughSegment) -> usize {
    ((segment.x2 - segment.x1)
        .abs()
        .max((segment.y2 - segment.y1).abs())
        + 1)
    .max(1) as usize
}

#[derive(Debug, Clone)]
struct CarrierHypothesis {
    id: usize,
    normal: Point2,
    direction: Point2,
    rho: f64,
    t_interval: [f64; 2],
    support: f64,
    source_ids: Vec<usize>,
}

fn carrier_hypotheses(
    primitives: &[RasterLinePrimitive],
    image_size: u32,
    options: RasterCarrierV1Options,
) -> Vec<CarrierHypothesis> {
    let mut groups = Vec::<CarrierGroup>::new();
    let angle_tol = options.carrier_angle_tolerance_degrees.to_radians();
    let rho_tol = options.carrier_rho_tolerance_px / unit_scale(image_size);
    for primitive in primitives {
        let Some(line) = LineGeometry::from_primitive(primitive, image_size) else {
            continue;
        };
        if let Some(group) = groups.iter_mut().find(|group| {
            angle_delta(group.angle, line.angle) <= angle_tol
                && (group.rho - line.rho).abs() <= rho_tol
        }) {
            group.add(primitive.id, line, primitive);
        } else {
            groups.push(CarrierGroup::new(primitive.id, line, primitive));
        }
    }
    groups.sort_by(|left, right| right.rank().total_cmp(&left.rank()));
    groups
        .into_iter()
        .take(options.max_carriers)
        .enumerate()
        .map(|(id, group)| group.into_hypothesis(id))
        .collect()
}

#[derive(Debug, Clone, Copy)]
struct LineGeometry {
    normal: Point2,
    direction: Point2,
    rho: f64,
    angle: f64,
    t_interval: [f64; 2],
    length: f64,
}

impl LineGeometry {
    fn from_primitive(primitive: &RasterLinePrimitive, image_size: u32) -> Option<Self> {
        let p0 = unit_from_px(primitive.p0, image_size);
        let p1 = unit_from_px(primitive.p1, image_size);
        let mut direction = normalized(Point2::new(p1.x - p0.x, p1.y - p0.y))?;
        let mut angle = direction
            .y
            .atan2(direction.x)
            .rem_euclid(std::f64::consts::PI);
        if angle >= std::f64::consts::FRAC_PI_2 {
            direction = Point2::new(-direction.x, -direction.y);
            angle = direction
                .y
                .atan2(direction.x)
                .rem_euclid(std::f64::consts::PI);
        }
        let mut normal = Point2::new(-direction.y, direction.x);
        let mut rho = normal.x * p0.x + normal.y * p0.y;
        if rho < 0.0 {
            normal = Point2::new(-normal.x, -normal.y);
            rho = -rho;
        }
        let t0 = project(p0, direction);
        let t1 = project(p1, direction);
        Some(Self {
            normal,
            direction,
            rho,
            angle,
            t_interval: [t0.min(t1), t0.max(t1)],
            length: distance(p0, p1),
        })
    }
}

#[derive(Debug, Clone)]
struct CarrierGroup {
    normal_sum: Point2,
    direction_sum: Point2,
    rho_sum: f64,
    weight_sum: f64,
    support_sum: f64,
    t_min: f64,
    t_max: f64,
    angle: f64,
    rho: f64,
    source_ids: Vec<usize>,
}

impl CarrierGroup {
    fn new(id: usize, line: LineGeometry, primitive: &RasterLinePrimitive) -> Self {
        let weight = line.length.max(1e-6) * primitive.support.max(0.05);
        Self {
            normal_sum: Point2::new(line.normal.x * weight, line.normal.y * weight),
            direction_sum: Point2::new(line.direction.x * weight, line.direction.y * weight),
            rho_sum: line.rho * weight,
            weight_sum: weight,
            support_sum: primitive.support * weight,
            t_min: line.t_interval[0],
            t_max: line.t_interval[1],
            angle: line.angle,
            rho: line.rho,
            source_ids: vec![id],
        }
    }

    fn add(&mut self, id: usize, line: LineGeometry, primitive: &RasterLinePrimitive) {
        let weight = line.length.max(1e-6) * primitive.support.max(0.05);
        self.normal_sum.x += line.normal.x * weight;
        self.normal_sum.y += line.normal.y * weight;
        self.direction_sum.x += line.direction.x * weight;
        self.direction_sum.y += line.direction.y * weight;
        self.rho_sum += line.rho * weight;
        self.support_sum += primitive.support * weight;
        self.weight_sum += weight;
        self.t_min = self.t_min.min(line.t_interval[0]);
        self.t_max = self.t_max.max(line.t_interval[1]);
        self.rho = self.rho_sum / self.weight_sum.max(1e-9);
        if let Some(direction) = normalized(self.direction_sum) {
            self.angle = direction
                .y
                .atan2(direction.x)
                .rem_euclid(std::f64::consts::PI);
        }
        self.source_ids.push(id);
    }

    fn rank(&self) -> f64 {
        self.support_sum
    }

    fn into_hypothesis(self, id: usize) -> CarrierHypothesis {
        let direction = normalized(self.direction_sum).unwrap_or(Point2::new(1.0, 0.0));
        let normal = normalized(self.normal_sum).unwrap_or(Point2::new(0.0, 1.0));
        CarrierHypothesis {
            id,
            normal,
            direction,
            rho: self.rho_sum / self.weight_sum.max(1e-9),
            t_interval: [self.t_min, self.t_max],
            support: self.support_sum / self.weight_sum.max(1e-9),
            source_ids: self.source_ids,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct VertexBuildCounts {
    intersections: usize,
    boundary_contacts: usize,
    endpoints: usize,
}

fn build_vertices(
    evidence: &RasterEvidence,
    primitives: &[RasterLinePrimitive],
    carriers: &[CarrierHypothesis],
    options: RasterCarrierV1Options,
) -> (Vec<CandidateVertex>, VertexBuildCounts) {
    let mut vertices = vec![
        vertex(
            0,
            Point2::new(0.0, 0.0),
            CandidateVertexKind::Corner,
            1.0,
            CandidateVertexMovementPolicy::Locked,
            Some(BoundarySide::Top),
        ),
        vertex(
            1,
            Point2::new(1.0, 0.0),
            CandidateVertexKind::Corner,
            1.0,
            CandidateVertexMovementPolicy::Locked,
            Some(BoundarySide::Top),
        ),
        vertex(
            2,
            Point2::new(1.0, 1.0),
            CandidateVertexKind::Corner,
            1.0,
            CandidateVertexMovementPolicy::Locked,
            Some(BoundarySide::Bottom),
        ),
        vertex(
            3,
            Point2::new(0.0, 1.0),
            CandidateVertexKind::Corner,
            1.0,
            CandidateVertexMovementPolicy::Locked,
            Some(BoundarySide::Bottom),
        ),
    ];
    let mut counts = VertexBuildCounts::default();
    let merge_tol = options.vertex_merge_radius_px / unit_scale(evidence.image_size);

    for carrier in carriers {
        for (side, point) in carrier_boundary_contacts(carrier, evidence.image_size, options) {
            let support = point_support(point, evidence, 2).max(carrier.support * 0.5);
            if support < options.min_vertex_support {
                continue;
            }
            if push_vertex_merged(
                &mut vertices,
                point,
                CandidateVertexKind::BoundaryContact,
                support,
                CandidateVertexMovementPolicy::BoundaryOnly,
                Some(side),
                merge_tol,
            ) {
                counts.boundary_contacts += 1;
            }
        }
    }

    for i in 0..carriers.len() {
        for j in (i + 1)..carriers.len() {
            let Some(point) = carrier_intersection(&carriers[i], &carriers[j]) else {
                continue;
            };
            if !inside_unit_square(point, 1e-6) || near_unit_boundary(point, merge_tol) {
                continue;
            }
            let support = point_support(point, evidence, 2);
            if support < options.min_vertex_support {
                continue;
            }
            if push_vertex_merged(
                &mut vertices,
                point,
                CandidateVertexKind::CandidateIntersection,
                support,
                CandidateVertexMovementPolicy::Movable,
                None,
                merge_tol,
            ) {
                counts.intersections += 1;
            }
        }
    }

    let mut endpoint_candidates = primitives
        .iter()
        .flat_map(|primitive| {
            [
                (
                    unit_from_px(primitive.p0, evidence.image_size),
                    primitive.support,
                ),
                (
                    unit_from_px(primitive.p1, evidence.image_size),
                    primitive.support,
                ),
            ]
        })
        .collect::<Vec<_>>();
    endpoint_candidates.sort_by(|left, right| right.1.total_cmp(&left.1));
    for (point, support) in endpoint_candidates
        .into_iter()
        .take(options.max_endpoint_vertices)
    {
        if let Some((side, snapped)) = snap_to_boundary_if_near(point, merge_tol * 1.75) {
            if push_vertex_merged(
                &mut vertices,
                snapped,
                CandidateVertexKind::BoundaryContact,
                support,
                CandidateVertexMovementPolicy::BoundaryOnly,
                Some(side),
                merge_tol,
            ) {
                counts.boundary_contacts += 1;
            }
            continue;
        }
        if near_unit_boundary(point, merge_tol) {
            continue;
        }
        if push_vertex_merged(
            &mut vertices,
            point,
            CandidateVertexKind::LineEndpoint,
            support,
            CandidateVertexMovementPolicy::Movable,
            None,
            merge_tol,
        ) {
            counts.endpoints += 1;
        }
    }
    assign_vertex_ids(&mut vertices);
    (vertices, counts)
}

fn vertex(
    id: usize,
    point: Point2,
    kind: CandidateVertexKind,
    support: f64,
    movement_policy: CandidateVertexMovementPolicy,
    boundary_side: Option<BoundarySide>,
) -> CandidateVertex {
    CandidateVertex {
        id,
        point,
        kind,
        support,
        movement_policy,
        boundary_side,
        source_vertex_ids: vec![id],
        source_carrier_ids: Vec::new(),
        source_adapter: CandidateSourceAdapter::ArrangementV2,
        provenance: Vec::new(),
    }
}

fn push_vertex_merged(
    vertices: &mut Vec<CandidateVertex>,
    point: Point2,
    kind: CandidateVertexKind,
    support: f64,
    movement_policy: CandidateVertexMovementPolicy,
    boundary_side: Option<BoundarySide>,
    merge_tol: f64,
) -> bool {
    let mergeable = vertices
        .iter()
        .enumerate()
        .filter(|(_, vertex)| {
            merge_compatible(vertex.kind, kind, vertex.boundary_side, boundary_side)
        })
        .map(|(idx, vertex)| (idx, distance(vertex.point, point)))
        .filter(|(_, distance)| *distance <= merge_tol)
        .min_by(|left, right| left.1.total_cmp(&right.1));
    if let Some((idx, _)) = mergeable {
        if support > vertices[idx].support
            && vertices[idx].movement_policy != CandidateVertexMovementPolicy::Locked
        {
            vertices[idx].point = point;
            vertices[idx].support = support;
        }
        return false;
    }
    vertices.push(vertex(
        vertices.len(),
        point,
        kind,
        support,
        movement_policy,
        boundary_side,
    ));
    true
}

fn merge_compatible(
    existing_kind: CandidateVertexKind,
    new_kind: CandidateVertexKind,
    existing_side: Option<BoundarySide>,
    new_side: Option<BoundarySide>,
) -> bool {
    if matches!(existing_kind, CandidateVertexKind::Corner)
        || matches!(new_kind, CandidateVertexKind::Corner)
    {
        return true;
    }
    match (existing_side, new_side) {
        (Some(left), Some(right)) => left == right,
        (Some(_), None) | (None, Some(_)) => false,
        (None, None) => true,
    }
}

fn carrier_boundary_contacts(
    carrier: &CarrierHypothesis,
    image_size: u32,
    options: RasterCarrierV1Options,
) -> Vec<(BoundarySide, Point2)> {
    let mut contacts = Vec::new();
    for (side, point) in [
        (BoundarySide::Top, line_at_y(carrier, 0.0)),
        (BoundarySide::Bottom, line_at_y(carrier, 1.0)),
        (BoundarySide::Left, line_at_x(carrier, 0.0)),
        (BoundarySide::Right, line_at_x(carrier, 1.0)),
    ] {
        let Some(point) = point else {
            continue;
        };
        if !inside_unit_square(point, 1e-6)
            || !point_on_carrier_extent(point, carrier, image_size, options)
            || contacts
                .iter()
                .any(|(_, existing)| distance(*existing, point) <= 1e-8)
        {
            continue;
        }
        contacts.push((side, point));
    }
    contacts
}

fn line_at_y(carrier: &CarrierHypothesis, y: f64) -> Option<Point2> {
    if carrier.normal.x.abs() <= 1e-9 {
        return None;
    }
    Some(Point2::new(
        (carrier.rho - carrier.normal.y * y) / carrier.normal.x,
        y,
    ))
}

fn line_at_x(carrier: &CarrierHypothesis, x: f64) -> Option<Point2> {
    if carrier.normal.y.abs() <= 1e-9 {
        return None;
    }
    Some(Point2::new(
        x,
        (carrier.rho - carrier.normal.x * x) / carrier.normal.y,
    ))
}

fn carrier_intersection(left: &CarrierHypothesis, right: &CarrierHypothesis) -> Option<Point2> {
    let det = left.normal.x * right.normal.y - right.normal.x * left.normal.y;
    if det.abs() <= 1e-9 {
        return None;
    }
    Some(Point2::new(
        (left.rho * right.normal.y - right.rho * left.normal.y) / det,
        (left.normal.x * right.rho - right.normal.x * left.rho) / det,
    ))
}

fn point_on_carrier_extent(
    point: Point2,
    carrier: &CarrierHypothesis,
    image_size: u32,
    options: RasterCarrierV1Options,
) -> bool {
    let padding = options.carrier_extent_padding_px / unit_scale(image_size);
    let t = project(point, carrier.direction);
    t >= carrier.t_interval[0] - padding && t <= carrier.t_interval[1] + padding
}

fn point_support(point: Point2, evidence: &RasterEvidence, radius_px: isize) -> f64 {
    let px = px_from_unit(point, evidence.image_size);
    let size = evidence.image_size as isize;
    let cx = px[0].round() as isize;
    let cy = px[1].round() as isize;
    let mut best = 0.0f64;
    for y in (cy - radius_px)..=(cy + radius_px) {
        for x in (cx - radius_px)..=(cx + radius_px) {
            if x < 0 || y < 0 || x >= size || y >= size {
                continue;
            }
            let idx = y as usize * evidence.image_size as usize + x as usize;
            best = best.max(evidence.line_probability[idx] as f64);
        }
    }
    best
}

fn add_carrier_pair_spans(
    vertices: &[CandidateVertex],
    carriers: &[CarrierHypothesis],
    evidence: &RasterEvidence,
    options: RasterCarrierV1Options,
    spans: &mut Vec<CandidateCreaseSpan>,
) {
    let distance_tol = options.vertex_carrier_distance_px / unit_scale(evidence.image_size);
    let extent_padding = options.carrier_extent_padding_px / unit_scale(evidence.image_size);
    let min_length = options.min_span_length_px / unit_scale(evidence.image_size);
    for carrier in carriers {
        if spans.len() >= options.max_total_spans {
            break;
        }
        let mut incident = vertices
            .iter()
            .filter_map(|vertex| {
                if point_line_distance(vertex.point, carrier) > distance_tol {
                    return None;
                }
                let t = project(vertex.point, carrier.direction);
                if t < carrier.t_interval[0] - extent_padding
                    || t > carrier.t_interval[1] + extent_padding
                {
                    return None;
                }
                Some((t, vertex.id))
            })
            .collect::<Vec<_>>();
        incident.sort_by(|left, right| left.0.total_cmp(&right.0));
        incident.dedup_by_key(|(_, id)| *id);
        if incident.len() > options.max_vertices_per_carrier {
            incident.truncate(options.max_vertices_per_carrier);
        }
        let mut carrier_spans = 0usize;
        for i in 0..incident.len() {
            let max_j = (i + options.max_skip_vertices + 2).min(incident.len());
            for j in (i + 1)..max_j {
                if carrier_spans >= options.max_spans_per_carrier
                    || spans.len() >= options.max_total_spans
                {
                    break;
                }
                let a_id = incident[i].1;
                let b_id = incident[j].1;
                let a = vertices[a_id].point;
                let b = vertices[b_id].point;
                if distance(a, b) < min_length || border_aligned_pair(a, b) {
                    continue;
                }
                let stats = sample_span_stats(a, b, evidence, options);
                if !span_supported(stats, options) {
                    continue;
                }
                spans.push(span_from_pair(
                    spans.len(),
                    [a_id, b_id],
                    carrier,
                    stats,
                    j - i,
                    options,
                ));
                carrier_spans += 1;
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct RasterSpanStats {
    line_min: f64,
    line_mean: f64,
    line_max: f64,
    line_hit_fraction: f64,
}

fn sample_span_stats(
    a: Point2,
    b: Point2,
    evidence: &RasterEvidence,
    options: RasterCarrierV1Options,
) -> RasterSpanStats {
    let a_px = px_from_unit(a, evidence.image_size);
    let b_px = px_from_unit(b, evidence.image_size);
    let points = sample_points(a_px, b_px, options.edge_sample_step_px);
    let mut line_min = f64::INFINITY;
    let mut line_max = 0.0_f64;
    let mut line_sum = 0.0_f64;
    let mut hits = 0usize;
    let mut count = 0usize;
    let size = evidence.image_size as usize;
    for point in points {
        let Some(idx) = pixel_index(point, size) else {
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
        return RasterSpanStats {
            line_min: 0.0,
            line_mean: 0.0,
            line_max: 0.0,
            line_hit_fraction: 0.0,
        };
    }
    RasterSpanStats {
        line_min: line_min.min(line_sum / count as f64).clamp(0.0, 1.0),
        line_mean: (line_sum / count as f64).clamp(0.0, 1.0),
        line_max: line_max.clamp(0.0, 1.0),
        line_hit_fraction: hits as f64 / count as f64,
    }
}

fn span_supported(stats: RasterSpanStats, options: RasterCarrierV1Options) -> bool {
    stats.line_mean >= options.min_span_line_support
        || stats.line_hit_fraction >= options.min_span_hit_fraction
}

fn span_from_pair(
    id: usize,
    vertices: [usize; 2],
    carrier: &CarrierHypothesis,
    stats: RasterSpanStats,
    vertex_gap: usize,
    options: RasterCarrierV1Options,
) -> CandidateCreaseSpan {
    let strong = stats.line_mean >= options.strong_span_line_support
        || stats.line_hit_fraction >= (options.min_span_hit_fraction + 0.30).min(0.85);
    let presence = stats
        .line_mean
        .max(stats.line_hit_fraction * 0.82)
        .clamp(0.05, 0.97);
    CandidateCreaseSpan {
        id,
        kind: if vertex_gap <= 1 {
            CandidateCreaseSpanKind::ObservedCarrierSpan
        } else {
            CandidateCreaseSpanKind::SharedCarrierSpan
        },
        vertices,
        carrier: CandidateCarrierGeometry {
            normal: carrier.normal,
            direction: carrier.direction,
            rho: carrier.rho,
        },
        t_interval: [0.0, 1.0],
        assignment_evidence: unknown_assignment(),
        presence_probability: presence,
        line_support_min: stats.line_min,
        line_support_mean: stats.line_mean,
        line_support_max: stats.line_max,
        style_support: 0.0,
        non_crease_support: (1.0 - stats.line_hit_fraction).clamp(0.0, 1.0),
        source_kind: if vertex_gap <= 1 {
            CandidateCreaseSourceKind::ArrangementObserved
        } else {
            CandidateCreaseSourceKind::ArrangementShared
        },
        selection_policy: if strong {
            CandidateSelectionPolicy::StrongOptional
        } else {
            CandidateSelectionPolicy::WeakOptional
        },
        boundary_role: CandidateCreaseBoundaryRole::None,
        source_edge_ids: Vec::new(),
        source_atomic_edge_ids: Vec::new(),
        source_carrier_ids: vec![carrier.id],
        replaced_span_ids: Vec::new(),
        replaced_atomic_edge_ids: Vec::new(),
        collapsed_vertex_ids: Vec::new(),
        provenance: Vec::new(),
        reasons: vec![format!(
            "raster-carrier-v1 span from raster support {:.3}, hit fraction {:.3}",
            stats.line_mean, stats.line_hit_fraction
        )],
    }
}

fn unknown_assignment() -> AssignmentEvidence {
    AssignmentEvidence {
        mountain: 0.05,
        valley: 0.05,
        boundary: 0.05,
        auxiliary: 0.05,
        unknown: 0.80,
        observed_label: AssignmentLabel::Unknown,
        source: AssignmentEvidenceSource::Unknown,
        confidence: 0.0,
        margin: 0.0,
    }
}

fn add_locked_border_spans(
    vertices: &[CandidateVertex],
    boundary: &BoundaryModel,
    spans: &mut Vec<CandidateCreaseSpan>,
) {
    for side in &boundary.sides {
        let mut sequence = vec![side.corner_vertices[0]];
        sequence.extend(side.contact_vertices.iter().copied());
        sequence.push(side.corner_vertices[1]);
        sequence.sort_by(|left, right| {
            side_sort_key(side.side, vertices[*left].point)
                .total_cmp(&side_sort_key(side.side, vertices[*right].point))
        });
        for pair in sequence.windows(2) {
            if pair[0] == pair[1] {
                continue;
            }
            let a = vertices[pair[0]].point;
            let b = vertices[pair[1]].point;
            if distance(a, b) <= 1e-9 {
                continue;
            }
            let direction =
                normalized(Point2::new(b.x - a.x, b.y - a.y)).unwrap_or(Point2::new(1.0, 0.0));
            let normal = Point2::new(-direction.y, direction.x);
            let rho = normal.x * a.x + normal.y * a.y;
            spans.push(CandidateCreaseSpan {
                id: spans.len(),
                kind: CandidateCreaseSpanKind::BorderSpan,
                vertices: [pair[0], pair[1]],
                carrier: CandidateCarrierGeometry {
                    normal,
                    direction,
                    rho,
                },
                t_interval: [project(a, direction), project(b, direction)],
                assignment_evidence: AssignmentEvidence {
                    mountain: 0.01,
                    valley: 0.01,
                    boundary: 0.97,
                    auxiliary: 0.01,
                    unknown: 0.01,
                    observed_label: AssignmentLabel::Boundary,
                    source: AssignmentEvidenceSource::Inferred,
                    confidence: 1.0,
                    margin: 1.0,
                },
                presence_probability: 0.99,
                line_support_min: 1.0,
                line_support_mean: 1.0,
                line_support_max: 1.0,
                style_support: 0.0,
                non_crease_support: 0.0,
                source_kind: CandidateCreaseSourceKind::BorderGenerated,
                selection_policy: CandidateSelectionPolicy::Locked,
                boundary_role: CandidateCreaseBoundaryRole::PaperBoundary,
                source_edge_ids: Vec::new(),
                source_atomic_edge_ids: Vec::new(),
                source_carrier_ids: Vec::new(),
                replaced_span_ids: Vec::new(),
                replaced_atomic_edge_ids: Vec::new(),
                collapsed_vertex_ids: Vec::new(),
                provenance: Vec::new(),
                reasons: vec!["raster-carrier-v1 deterministic square border".to_owned()],
            });
        }
    }
}

fn boundary_model(vertices: &[CandidateVertex], corners: [usize; 4]) -> BoundaryModel {
    BoundaryModel {
        corners,
        sides: vec![
            side_model(vertices, BoundarySide::Top, [corners[0], corners[1]]),
            side_model(vertices, BoundarySide::Right, [corners[1], corners[2]]),
            side_model(vertices, BoundarySide::Bottom, [corners[2], corners[3]]),
            side_model(vertices, BoundarySide::Left, [corners[3], corners[0]]),
        ],
        generated_border_span_ids: Vec::new(),
        reconstruction_policy: BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts,
    }
}

fn side_model(
    vertices: &[CandidateVertex],
    side: BoundarySide,
    corner_vertices: [usize; 2],
) -> BoundarySideModel {
    let mut contact_vertices = vertices
        .iter()
        .filter(|vertex| {
            vertex.kind == CandidateVertexKind::BoundaryContact
                && vertex.boundary_side == Some(side)
        })
        .map(|vertex| vertex.id)
        .collect::<Vec<_>>();
    contact_vertices.sort_by(|left, right| {
        side_sort_key(side, vertices[*left].point)
            .total_cmp(&side_sort_key(side, vertices[*right].point))
    });
    BoundarySideModel {
        side,
        corner_vertices,
        contact_vertices,
    }
}

fn generate_conflicts(graph: &CandidateGraph) -> Vec<CandidateConflict> {
    let mut conflicts = Vec::new();
    let mut by_key = BTreeMap::<SpanKey, Vec<usize>>::new();
    for span in &graph.crease_candidates {
        by_key
            .entry(span_endpoint_key(graph, span.vertices, 1e-6))
            .or_default()
            .push(span.id);
    }
    for ids in by_key.values().filter(|ids| ids.len() > 1) {
        conflicts.push(CandidateConflict {
            id: conflicts.len(),
            kind: CandidateConflictKind::DuplicateSpan,
            candidate_ids: ids.clone(),
            hard: true,
            reason: "duplicate raster candidate spans share effective endpoints".to_owned(),
        });
    }

    let mut by_carrier = BTreeMap::<usize, Vec<&CandidateCreaseSpan>>::new();
    for span in &graph.crease_candidates {
        let Some(carrier_id) = span.source_carrier_ids.first().copied() else {
            continue;
        };
        by_carrier.entry(carrier_id).or_default().push(span);
    }
    for spans in by_carrier.values() {
        for i in 0..spans.len() {
            for j in (i + 1)..spans.len() {
                if spans_overlap_on_carrier(graph, spans[i], spans[j]) {
                    conflicts.push(CandidateConflict {
                        id: conflicts.len(),
                        kind: CandidateConflictKind::SharedCarrierAlternative,
                        candidate_ids: vec![spans[i].id, spans[j].id],
                        hard: true,
                        reason: "same-carrier raster span alternatives overlap".to_owned(),
                    });
                }
            }
        }
    }
    conflicts
}

fn spans_overlap_on_carrier(
    graph: &CandidateGraph,
    left: &CandidateCreaseSpan,
    right: &CandidateCreaseSpan,
) -> bool {
    if left.selection_policy == CandidateSelectionPolicy::Locked
        || right.selection_policy == CandidateSelectionPolicy::Locked
    {
        return false;
    }
    let left_interval = span_projection_interval(graph, left);
    let right_interval = span_projection_interval(graph, right);
    let overlap = left_interval[1].min(right_interval[1]) - left_interval[0].max(right_interval[0]);
    overlap > 1e-6
}

fn span_projection_interval(graph: &CandidateGraph, span: &CandidateCreaseSpan) -> [f64; 2] {
    let a = graph.vertices[span.vertices[0]].point;
    let b = graph.vertices[span.vertices[1]].point;
    let t0 = project(a, span.carrier.direction);
    let t1 = project(b, span.carrier.direction);
    [t0.min(t1), t0.max(t1)]
}

fn graph_report(graph: &CandidateGraph) -> CandidateGraphReport {
    CandidateGraphReport {
        vertices: graph.vertices.len(),
        crease_candidates: graph.crease_candidates.len(),
        locked_border_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.selection_policy == CandidateSelectionPolicy::Locked)
            .count(),
        legacy_selected_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::LegacySelected)
            .count(),
        legacy_low_threshold_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold)
            .count(),
        arrangement_observed_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::ArrangementObserved)
            .count(),
        arrangement_shared_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::ArrangementShared)
            .count(),
        conflicts: graph.conflicts.len(),
    }
}

fn carrier_diagnostics(
    graph: &CandidateGraph,
    carriers: &[CarrierHypothesis],
    image_size: u32,
    options: RasterCarrierV1Options,
) -> Vec<RasterCarrierDiagnosticCarrier> {
    carriers
        .iter()
        .map(|carrier| RasterCarrierDiagnosticCarrier {
            id: carrier.id,
            normal: carrier.normal,
            direction: carrier.direction,
            rho: carrier.rho,
            t_interval: carrier.t_interval,
            support: carrier.support,
            source_segments: carrier.source_ids.len(),
            incident_vertices: carrier_incident_vertex_count(
                &graph.vertices,
                carrier,
                image_size,
                options,
            ),
            emitted_spans: graph
                .crease_candidates
                .iter()
                .filter(|span| span.source_carrier_ids.contains(&carrier.id))
                .count(),
        })
        .collect()
}

fn carrier_incident_vertex_count(
    vertices: &[CandidateVertex],
    carrier: &CarrierHypothesis,
    image_size: u32,
    options: RasterCarrierV1Options,
) -> usize {
    let distance_tol = options.vertex_carrier_distance_px / unit_scale(image_size);
    let extent_padding = options.carrier_extent_padding_px / unit_scale(image_size);
    vertices
        .iter()
        .filter(|vertex| {
            if point_line_distance(vertex.point, carrier) > distance_tol {
                return false;
            }
            let t = project(vertex.point, carrier.direction);
            t >= carrier.t_interval[0] - extent_padding
                && t <= carrier.t_interval[1] + extent_padding
        })
        .count()
}

fn assign_vertex_ids(vertices: &mut [CandidateVertex]) {
    for (id, vertex) in vertices.iter_mut().enumerate() {
        vertex.id = id;
    }
}

fn assign_span_ids(spans: &mut [CandidateCreaseSpan]) {
    for (id, span) in spans.iter_mut().enumerate() {
        span.id = id;
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct SpanKey {
    a: (i64, i64),
    b: (i64, i64),
}

fn span_endpoint_key(graph: &CandidateGraph, endpoints: [usize; 2], tolerance: f64) -> SpanKey {
    let scale = (1.0 / tolerance.max(1e-9)).round();
    let mut points = endpoints.map(|id| {
        let point = graph.vertices[id].point;
        (
            (point.x * scale).round() as i64,
            (point.y * scale).round() as i64,
        )
    });
    points.sort_unstable();
    SpanKey {
        a: points[0],
        b: points[1],
    }
}

fn border_aligned_pair(a: Point2, b: Point2) -> bool {
    const EPS: f64 = 1e-9;
    (a.x.abs() <= EPS && b.x.abs() <= EPS)
        || ((1.0 - a.x).abs() <= EPS && (1.0 - b.x).abs() <= EPS)
        || (a.y.abs() <= EPS && b.y.abs() <= EPS)
        || ((1.0 - a.y).abs() <= EPS && (1.0 - b.y).abs() <= EPS)
}

fn side_sort_key(side: BoundarySide, point: Point2) -> f64 {
    match side {
        BoundarySide::Top | BoundarySide::Bottom => point.x,
        BoundarySide::Right | BoundarySide::Left => point.y,
    }
}

fn snap_to_boundary_if_near(point: Point2, tolerance: f64) -> Option<(BoundarySide, Point2)> {
    let distances = [
        (BoundarySide::Top, point.y.abs()),
        (BoundarySide::Right, (1.0 - point.x).abs()),
        (BoundarySide::Bottom, (1.0 - point.y).abs()),
        (BoundarySide::Left, point.x.abs()),
    ];
    let (side, distance) = distances
        .into_iter()
        .min_by(|left, right| left.1.total_cmp(&right.1))?;
    if distance > tolerance {
        return None;
    }
    let snapped = match side {
        BoundarySide::Top => Point2::new(point.x.clamp(0.0, 1.0), 0.0),
        BoundarySide::Right => Point2::new(1.0, point.y.clamp(0.0, 1.0)),
        BoundarySide::Bottom => Point2::new(point.x.clamp(0.0, 1.0), 1.0),
        BoundarySide::Left => Point2::new(0.0, point.y.clamp(0.0, 1.0)),
    };
    Some((side, snapped))
}

fn inside_unit_square(point: Point2, tolerance: f64) -> bool {
    point.x >= -tolerance
        && point.y >= -tolerance
        && point.x <= 1.0 + tolerance
        && point.y <= 1.0 + tolerance
}

fn near_unit_boundary(point: Point2, tolerance: f64) -> bool {
    point.x <= tolerance
        || point.y <= tolerance
        || point.x >= 1.0 - tolerance
        || point.y >= 1.0 - tolerance
}

fn unit_from_px(point: [f32; 2], image_size: u32) -> Point2 {
    let span = unit_scale(image_size);
    Point2::new(
        ((point[0] as f64 - SYNTHETIC_RENDER_INSET_PX) / span).clamp(0.0, 1.0),
        ((point[1] as f64 - SYNTHETIC_RENDER_INSET_PX) / span).clamp(0.0, 1.0),
    )
}

fn px_from_unit(point: Point2, image_size: u32) -> [f32; 2] {
    let span = unit_scale(image_size);
    [
        (SYNTHETIC_RENDER_INSET_PX + point.x * span) as f32,
        (SYNTHETIC_RENDER_INSET_PX + point.y * span) as f32,
    ]
}

fn unit_scale(image_size: u32) -> f64 {
    (image_size as f64 - SYNTHETIC_RENDER_INSET_PX * 2.0).max(1.0)
}

fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn normalized(vector: Point2) -> Option<Point2> {
    let length = (vector.x * vector.x + vector.y * vector.y).sqrt();
    (length > 1e-9).then(|| Point2::new(vector.x / length, vector.y / length))
}

fn project(point: Point2, direction: Point2) -> f64 {
    point.x * direction.x + point.y * direction.y
}

fn point_line_distance(point: Point2, carrier: &CarrierHypothesis) -> f64 {
    (point.x * carrier.normal.x + point.y * carrier.normal.y - carrier.rho).abs()
}

fn angle_delta(left: f64, right: f64) -> f64 {
    let diff = (left - right).abs().rem_euclid(std::f64::consts::PI);
    diff.min(std::f64::consts::PI - diff)
}

fn segment_length_px(a: [f32; 2], b: [f32; 2]) -> f64 {
    let dx = b[0] as f64 - a[0] as f64;
    let dy = b[1] as f64 - a[1] as f64;
    (dx * dx + dy * dy).sqrt()
}

fn sample_scalar_along_segment(
    p0: [f32; 2],
    p1: [f32; 2],
    values: &[f32],
    size: usize,
    step_px: f32,
) -> f32 {
    let points = sample_points(p0, p1, step_px);
    let mut sum = 0.0;
    let mut count = 0usize;
    for point in points {
        let Some(idx) = pixel_index(point, size) else {
            continue;
        };
        sum += values[idx];
        count += 1;
    }
    if count == 0 { 0.0 } else { sum / count as f32 }
}

fn sample_points(a: [f32; 2], b: [f32; 2], step_px: f32) -> Vec<[f32; 2]> {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let length = (dx * dx + dy * dy).sqrt().max(1.0);
    let steps = (length / step_px.max(1.0)).ceil().max(1.0) as usize;
    (0..=steps)
        .map(|step| {
            let t = step as f32 / steps as f32;
            [a[0] + dx * t, a[1] + dy * t]
        })
        .collect()
}

fn pixel_index(point: [f32; 2], size: usize) -> Option<usize> {
    let x = point[0].round() as isize;
    let y = point[1].round() as isize;
    if x < 0 || y < 0 || x >= size as isize || y >= size as isize {
        return None;
    }
    Some(y as usize * size + x as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster_evidence::{RasterEvidenceConfig, extract_raster_evidence_from_rgba};

    #[test]
    fn raster_carrier_strategy_emits_line_between_boundary_contacts() {
        let size = 128u32;
        let mut rgba = solid_rgba(size, [255, 255, 255, 255]);
        draw_line(&mut rgba, size, [32, 64], [96, 64], [0, 0, 0, 255]);
        let evidence = raster_evidence(&rgba, size);
        let output = generate_raster_candidate_graph(
            RasterCandidateGenerationContext {
                evidence: &evidence,
            },
            RasterCandidateGenerationOptions {
                strategy: RasterCandidateGenerationStrategyName::RasterCarrierV1,
                raster_carrier_v1: test_options(),
            },
        )
        .expect("raster candidate graph");

        assert!(output.candidate_graph.report.locked_border_spans >= 4);
        assert!(
            output
                .candidate_graph
                .vertices
                .iter()
                .any(|vertex| vertex.kind == CandidateVertexKind::BoundaryContact)
        );
        assert!(
            output
                .candidate_graph
                .crease_candidates
                .iter()
                .any(|span| span.source_kind == CandidateCreaseSourceKind::ArrangementObserved)
        );
    }

    #[test]
    fn raster_carrier_strategy_adds_intersection_vertex() {
        let size = 128u32;
        let mut rgba = solid_rgba(size, [255, 255, 255, 255]);
        draw_line(&mut rgba, size, [32, 64], [96, 64], [0, 0, 0, 255]);
        draw_line(&mut rgba, size, [64, 32], [64, 96], [0, 0, 0, 255]);
        let evidence = raster_evidence(&rgba, size);
        let output = generate_raster_candidate_graph(
            RasterCandidateGenerationContext {
                evidence: &evidence,
            },
            RasterCandidateGenerationOptions {
                strategy: RasterCandidateGenerationStrategyName::RasterCarrierV1,
                raster_carrier_v1: test_options(),
            },
        )
        .expect("raster candidate graph");

        assert!(
            output
                .candidate_graph
                .vertices
                .iter()
                .any(
                    |vertex| vertex.kind == CandidateVertexKind::CandidateIntersection
                        && distance(vertex.point, Point2::new(0.5, 0.5)) < 0.055
                )
        );
        assert!(
            output
                .diagnostics
                .raster_carrier_v1
                .as_ref()
                .is_some_and(|diagnostics| diagnostics.vertices_from_intersections >= 1)
        );
    }

    #[test]
    fn raster_strategy_preserves_locked_square_border_on_blank_image() {
        let size = 128u32;
        let rgba = solid_rgba(size, [255, 255, 255, 255]);
        let evidence = raster_evidence(&rgba, size);
        let output = generate_raster_candidate_graph(
            RasterCandidateGenerationContext {
                evidence: &evidence,
            },
            RasterCandidateGenerationOptions {
                strategy: RasterCandidateGenerationStrategyName::RasterCarrierV1,
                raster_carrier_v1: test_options(),
            },
        )
        .expect("raster candidate graph");

        assert_eq!(output.candidate_graph.vertices.len(), 4);
        assert_eq!(output.candidate_graph.report.locked_border_spans, 4);
        assert_eq!(output.candidate_graph.report.arrangement_observed_spans, 0);
    }

    fn raster_evidence(rgba: &[u8], size: u32) -> RasterEvidence {
        extract_raster_evidence_from_rgba(
            rgba,
            size,
            size,
            RasterEvidenceConfig {
                image_size: size,
                line_threshold: 0.20,
                ..RasterEvidenceConfig::default()
            },
        )
        .expect("raster evidence")
    }

    fn test_options() -> RasterCarrierV1Options {
        RasterCarrierV1Options {
            hough_vote_threshold: 8,
            hough_min_segment_length_px: 8.0,
            hough_max_segment_gap_px: 4.0,
            min_line_primitive_support: 0.20,
            min_vertex_support: 0.10,
            min_span_line_support: 0.20,
            min_span_hit_fraction: 0.20,
            vertex_carrier_distance_px: 6.0,
            carrier_extent_padding_px: 8.0,
            ..RasterCarrierV1Options::default()
        }
    }

    fn solid_rgba(size: u32, color: [u8; 4]) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(size as usize * size as usize * 4);
        for _ in 0..size as usize * size as usize {
            rgba.extend_from_slice(&color);
        }
        rgba
    }

    fn draw_line(rgba: &mut [u8], size: u32, from: [u32; 2], to: [u32; 2], color: [u8; 4]) {
        let dx = to[0] as i32 - from[0] as i32;
        let dy = to[1] as i32 - from[1] as i32;
        let steps = dx.abs().max(dy.abs()).max(1);
        for step in 0..=steps {
            let t = step as f32 / steps as f32;
            let x = (from[0] as f32 + dx as f32 * t).round() as i32;
            let y = (from[1] as f32 + dy as f32 * t).round() as i32;
            for oy in -1..=1 {
                for ox in -1..=1 {
                    set_rgba(rgba, size, x + ox, y + oy, color);
                }
            }
        }
    }

    fn set_rgba(rgba: &mut [u8], size: u32, x: i32, y: i32, color: [u8; 4]) {
        if x < 0 || y < 0 || x >= size as i32 || y >= size as i32 {
            return;
        }
        let idx = ((y as u32 * size + x as u32) * 4) as usize;
        rgba[idx..idx + 4].copy_from_slice(&color);
    }
}
