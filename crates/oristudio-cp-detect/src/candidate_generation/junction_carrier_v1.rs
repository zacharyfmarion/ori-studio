use std::collections::BTreeMap;

use super::{
    JunctionCarrierDiagnosticCarrier, JunctionCarrierV1Diagnostics,
    JunctionCarrierV1StrategyOptions,
};
use crate::evidence_extract::{
    BoundarySide as EvidenceBoundarySide, CompilerEvidence, DenseOutputRefs,
    EvidenceExtractionConfig, EvidenceExtractionError, LinePrimitive, extract_compiler_evidence,
};
use crate::legacy_decode::{DecodeConfig, DecodeError, DenseOutputs};
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

const SYNTHETIC_RENDER_INSET_PX: f64 = 32.0;

pub fn generate_candidate_graph_with_diagnostics(
    outputs: DenseOutputs<'_>,
    config: &DecodeConfig,
    options: JunctionCarrierV1StrategyOptions,
) -> Result<(CandidateGraph, JunctionCarrierV1Diagnostics), DecodeError> {
    let evidence =
        extract_compiler_evidence(dense_output_refs(outputs), evidence_config(config, options))
            .map_err(evidence_error_to_decode_error)?;
    Ok(graph_from_evidence(&evidence, config, options))
}

pub(super) fn dense_output_refs(outputs: DenseOutputs<'_>) -> DenseOutputRefs<'_> {
    DenseOutputRefs::from_legacy_heads(
        outputs.line_logits,
        outputs.junction_logits,
        outputs.assignment_logits,
        outputs.non_crease_logits,
        outputs.line_style_logits,
        outputs.boundary_contact_logits,
    )
    .with_line_probability_override(outputs.line_probability_override)
    .with_angle(outputs.angle)
    .with_junction_offset(outputs.junction_offset)
    .with_vertex_type_logits(outputs.vertex_type_logits)
    .with_boundary_side_logits(outputs.boundary_side_logits)
    .with_boundary_offset(outputs.boundary_offset)
    .with_boundary_coord(outputs.boundary_coord)
}

pub(super) fn evidence_config(
    config: &DecodeConfig,
    options: JunctionCarrierV1StrategyOptions,
) -> EvidenceExtractionConfig {
    EvidenceExtractionConfig {
        image_size: config.image_size,
        line_threshold: (config.threshold * 0.45).clamp(0.14, config.threshold),
        strong_line_support: options.strong_span_line_support as f32,
        min_line_length_px: config.hough_min_segment_length_px.max(12.0),
        edge_sample_step_px: config.edge_sample_step_px.max(1.0),
        assignment_min_confidence: config.assignment_min_confidence,
        hough_vote_threshold: ((config.hough_vote_threshold as f32 * 0.60).round() as u32)
            .max(1)
            .min(config.hough_vote_threshold.max(1)),
        hough_min_segment_length_px: config.hough_min_segment_length_px.max(12.0),
        hough_max_segment_gap_px: config.hough_max_segment_gap_px.max(4.0),
        max_line_primitives: config.max_line_hypotheses.max(1200),
        // Uncapped: keep every above-threshold junction/contact peak. The old
        // top-500-by-probability truncation dropped real detections on dense CPs
        // (correctness over performance; span-generation cost is the tradeoff).
        max_junction_primitives: usize::MAX,
        max_boundary_contact_primitives: usize::MAX,
        primitive_nms_radius_px: (options.vertex_merge_radius_px * 0.55).max(2.0) as f32,
        junction_offset_cluster_radius_px: options.junction_offset_cluster_radius_px as f32,
        junction_evidence_source: options.junction_evidence_source,
    }
}

pub(super) fn evidence_error_to_decode_error(error: EvidenceExtractionError) -> DecodeError {
    match error {
        EvidenceExtractionError::InvalidImageSize(size) => DecodeError::InvalidImageSize(size),
        EvidenceExtractionError::TensorLength {
            name,
            expected,
            actual,
        } => DecodeError::TensorLength {
            name,
            expected,
            actual,
        },
        EvidenceExtractionError::Hough(error) => DecodeError::Hough(error),
    }
}

fn graph_from_evidence(
    evidence: &CompilerEvidence,
    config: &DecodeConfig,
    options: JunctionCarrierV1StrategyOptions,
) -> (CandidateGraph, JunctionCarrierV1Diagnostics) {
    let mut vertices = build_vertices(evidence, config.image_size, options);
    let corner_ids = [0, 1, 2, 3];
    let boundary = boundary_model(&vertices, corner_ids);
    let carriers = carrier_hypotheses(evidence, config.image_size, options);
    let mut spans = Vec::new();
    add_locked_border_spans(&vertices, &boundary, &mut spans);
    add_carrier_pair_spans(
        &vertices,
        &carriers,
        evidence,
        config.image_size,
        options,
        &mut spans,
    );
    assign_span_ids(&mut spans);
    let mut graph = CandidateGraph {
        schema: "oristudio/cp-compiler/candidate-graph-v1".to_owned(),
        coordinate_space: "unit_square".to_owned(),
        image_size: Some(config.image_size),
        vertices: {
            assign_vertex_ids(&mut vertices);
            vertices
        },
        crease_candidates: spans,
        boundary,
        conflicts: Vec::new(),
        alternatives: Vec::new(),
        cost_model: CostModel::default(),
        provenance: CandidateGraphProvenance {
            source_adapter: CandidateSourceAdapter::ArrangementV2,
            source_ids: Vec::new(),
            notes: vec![
                "junction-carrier-v1 dense evidence strategy; no legacy decoded graph input"
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
    let diagnostics =
        junction_carrier_diagnostics(evidence, &graph, &carriers, config.image_size, options);
    (graph, diagnostics)
}

fn junction_carrier_diagnostics(
    evidence: &CompilerEvidence,
    graph: &CandidateGraph,
    carriers: &[CarrierHypothesis],
    image_size: u32,
    options: JunctionCarrierV1StrategyOptions,
) -> JunctionCarrierV1Diagnostics {
    JunctionCarrierV1Diagnostics {
        line_primitives: evidence.line_primitives.len(),
        carrier_hypotheses: carriers
            .iter()
            .map(|carrier| JunctionCarrierDiagnosticCarrier {
                id: carrier.id,
                normal: carrier.normal,
                direction: carrier.direction,
                rho: carrier.rho,
                t_interval: carrier.t_interval,
                support: carrier.support,
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
            .collect(),
    }
}

fn carrier_incident_vertex_count(
    vertices: &[CandidateVertex],
    carrier: &CarrierHypothesis,
    image_size: u32,
    options: JunctionCarrierV1StrategyOptions,
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

pub(super) fn build_vertices(
    evidence: &CompilerEvidence,
    image_size: u32,
    options: JunctionCarrierV1StrategyOptions,
) -> Vec<CandidateVertex> {
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
    let merge_tol = options.vertex_merge_radius_px / unit_scale(image_size);

    let mut contacts = evidence.boundary_contact_primitives.clone();
    contacts.sort_by(|left, right| right.support.total_cmp(&left.support));
    for contact in contacts {
        let point = boundary_contact_unit_point(contact.side, contact.side_coordinate);
        if nearest_vertex_distance(&vertices, point) <= merge_tol {
            continue;
        }
        vertices.push(vertex(
            vertices.len(),
            point,
            CandidateVertexKind::BoundaryContact,
            contact.support as f64,
            CandidateVertexMovementPolicy::BoundaryOnly,
            Some(map_boundary_side(contact.side)),
        ));
    }

    let mut junctions = evidence.junction_primitives.clone();
    junctions.sort_by(|left, right| right.support.total_cmp(&left.support));
    for junction in junctions {
        let point = unit_from_px(junction.point, image_size);
        if near_unit_boundary(point, merge_tol) {
            continue;
        }
        if let Some(existing) = nearest_mergeable_vertex(&vertices, point, merge_tol) {
            if vertices[existing].kind == CandidateVertexKind::InteriorJunction
                && junction.support as f64 > vertices[existing].support
            {
                vertices[existing].point = point;
                vertices[existing].support = junction.support as f64;
            }
            continue;
        }
        vertices.push(vertex(
            vertices.len(),
            point,
            CandidateVertexKind::InteriorJunction,
            junction.support as f64,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
    }

    let mut endpoint_vertices = 0usize;
    for primitive in &evidence.line_primitives {
        if endpoint_vertices >= options.max_line_endpoint_vertices {
            break;
        }
        for endpoint in [primitive.p0, primitive.p1] {
            if endpoint_vertices >= options.max_line_endpoint_vertices {
                break;
            }
            let point = unit_from_px(endpoint, image_size);
            if nearest_vertex_distance(&vertices, point) <= merge_tol {
                continue;
            }
            if snap_to_boundary_if_near(point, merge_tol * 1.5).is_some() {
                continue;
            }
            vertices.push(vertex(
                vertices.len(),
                point,
                CandidateVertexKind::LineEndpoint,
                primitive.support as f64,
                CandidateVertexMovementPolicy::Movable,
                None,
            ));
            endpoint_vertices += 1;
        }
    }
    assign_vertex_ids(&mut vertices);
    vertices
}

/// Build the candidate vertex set from an explicit list of unit-square points
/// (e.g. ground-truth junctions for a perfect-junction oracle benchmark). The
/// four paper corners are always emitted as locked corner vertices at indices
/// 0..4; supplied points that coincide with a corner are dropped, points on a
/// single border side become locked-to-side boundary contacts, and the rest
/// become movable interior junctions. Unlike [`build_vertices`], supplied
/// interior points are never merged together, so genuinely close vertex pairs
/// are preserved verbatim.
pub(super) fn vertices_from_unit_points(points: &[Point2]) -> Vec<CandidateVertex> {
    const BOUNDARY_EPS: f64 = 1e-6;
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
    for &point in points {
        let on_left = point.x <= BOUNDARY_EPS;
        let on_right = point.x >= 1.0 - BOUNDARY_EPS;
        let on_top = point.y <= BOUNDARY_EPS;
        let on_bottom = point.y >= 1.0 - BOUNDARY_EPS;
        let horizontal_border = on_left || on_right;
        let vertical_border = on_top || on_bottom;
        if horizontal_border && vertical_border {
            // Paper corner: already emitted as a locked corner vertex.
            continue;
        }
        let id = vertices.len();
        if horizontal_border || vertical_border {
            let side = if on_top {
                BoundarySide::Top
            } else if on_bottom {
                BoundarySide::Bottom
            } else if on_left {
                BoundarySide::Left
            } else {
                BoundarySide::Right
            };
            let snapped = match side {
                BoundarySide::Top => Point2::new(point.x, 0.0),
                BoundarySide::Bottom => Point2::new(point.x, 1.0),
                BoundarySide::Left => Point2::new(0.0, point.y),
                BoundarySide::Right => Point2::new(1.0, point.y),
            };
            vertices.push(vertex(
                id,
                snapped,
                CandidateVertexKind::BoundaryContact,
                1.0,
                CandidateVertexMovementPolicy::BoundaryOnly,
                Some(side),
            ));
        } else {
            vertices.push(vertex(
                id,
                point,
                CandidateVertexKind::InteriorJunction,
                1.0,
                CandidateVertexMovementPolicy::Movable,
                None,
            ));
        }
    }
    vertices
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

pub(super) fn assign_vertex_ids(vertices: &mut [CandidateVertex]) {
    for (id, vertex) in vertices.iter_mut().enumerate() {
        vertex.id = id;
    }
}

fn nearest_vertex_distance(vertices: &[CandidateVertex], point: Point2) -> f64 {
    vertices
        .iter()
        .map(|vertex| distance(vertex.point, point))
        .fold(f64::INFINITY, f64::min)
}

fn nearest_mergeable_vertex(
    vertices: &[CandidateVertex],
    point: Point2,
    merge_tol: f64,
) -> Option<usize> {
    vertices
        .iter()
        .filter(|vertex| vertex.kind == CandidateVertexKind::InteriorJunction)
        .map(|vertex| (vertex.id, distance(vertex.point, point)))
        .filter(|(_, distance)| *distance <= merge_tol)
        .min_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(id, _)| id)
}

fn near_unit_boundary(point: Point2, tolerance: f64) -> bool {
    point.x <= tolerance
        || point.y <= tolerance
        || point.x >= 1.0 - tolerance
        || point.y >= 1.0 - tolerance
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

fn boundary_contact_unit_point(side: EvidenceBoundarySide, coordinate: f32) -> Point2 {
    let coordinate = coordinate.clamp(0.0, 1.0) as f64;
    match side {
        EvidenceBoundarySide::Top => Point2::new(coordinate, 0.0),
        EvidenceBoundarySide::Right => Point2::new(1.0, coordinate),
        EvidenceBoundarySide::Bottom => Point2::new(coordinate, 1.0),
        EvidenceBoundarySide::Left => Point2::new(0.0, coordinate),
    }
}

fn map_boundary_side(side: EvidenceBoundarySide) -> BoundarySide {
    match side {
        EvidenceBoundarySide::Top => BoundarySide::Top,
        EvidenceBoundarySide::Right => BoundarySide::Right,
        EvidenceBoundarySide::Bottom => BoundarySide::Bottom,
        EvidenceBoundarySide::Left => BoundarySide::Left,
    }
}

#[derive(Debug, Clone)]
struct CarrierHypothesis {
    id: usize,
    normal: Point2,
    direction: Point2,
    rho: f64,
    t_interval: [f64; 2],
    support: f64,
}

fn carrier_hypotheses(
    evidence: &CompilerEvidence,
    image_size: u32,
    options: JunctionCarrierV1StrategyOptions,
) -> Vec<CarrierHypothesis> {
    let mut groups = Vec::<CarrierGroup>::new();
    let angle_tol = options.carrier_angle_tolerance_degrees.to_radians();
    let rho_tol = options.carrier_rho_tolerance_px / unit_scale(image_size);
    for (id, primitive) in evidence.line_primitives.iter().enumerate() {
        if let Some(line) = LineGeometry::from_primitive(primitive, image_size) {
            if let Some(group) = groups.iter_mut().find(|group| {
                angle_delta(group.angle, line.angle) <= angle_tol
                    && (group.rho - line.rho).abs() <= rho_tol
            }) {
                group.add(id, line, primitive);
            } else {
                groups.push(CarrierGroup::new(id, line, primitive));
            }
        }
    }
    groups.sort_by(|left, right| right.rank().total_cmp(&left.rank()));
    groups
        .into_iter()
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
    fn from_primitive(primitive: &LinePrimitive, image_size: u32) -> Option<Self> {
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
    fn new(id: usize, line: LineGeometry, primitive: &LinePrimitive) -> Self {
        let weight = line.length.max(1e-6);
        Self {
            normal_sum: Point2::new(line.normal.x * weight, line.normal.y * weight),
            direction_sum: Point2::new(line.direction.x * weight, line.direction.y * weight),
            rho_sum: line.rho * weight,
            weight_sum: weight,
            support_sum: primitive.support as f64 * weight,
            t_min: line.t_interval[0],
            t_max: line.t_interval[1],
            angle: line.angle,
            rho: line.rho,
            source_ids: vec![id],
        }
    }

    fn add(&mut self, id: usize, line: LineGeometry, primitive: &LinePrimitive) {
        let weight = line.length.max(1e-6);
        self.normal_sum.x += line.normal.x * weight;
        self.normal_sum.y += line.normal.y * weight;
        self.direction_sum.x += line.direction.x * weight;
        self.direction_sum.y += line.direction.y * weight;
        self.rho_sum += line.rho * weight;
        self.support_sum += primitive.support as f64 * weight;
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
        }
    }
}

fn add_carrier_pair_spans(
    vertices: &[CandidateVertex],
    carriers: &[CarrierHypothesis],
    evidence: &CompilerEvidence,
    image_size: u32,
    options: JunctionCarrierV1StrategyOptions,
    spans: &mut Vec<CandidateCreaseSpan>,
) {
    let distance_tol = options.vertex_carrier_distance_px / unit_scale(image_size);
    let extent_padding = options.carrier_extent_padding_px / unit_scale(image_size);
    let min_length = options.min_span_length_px / unit_scale(image_size);
    for carrier in carriers {
        if spans.len() >= options.max_total_spans {
            break;
        }
        let mut incident = vertices
            .iter()
            .filter_map(|vertex| {
                let line_distance = point_line_distance(vertex.point, carrier);
                if line_distance > distance_tol {
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
            for j in (i + 1)..incident.len().min(i + options.max_skip_vertices + 2) {
                if carrier_spans >= options.max_spans_per_carrier
                    || spans.len() >= options.max_total_spans
                {
                    break;
                }
                let a_id = incident[i].1;
                let b_id = incident[j].1;
                let a = vertices[a_id].point;
                let b = vertices[b_id].point;
                if distance(a, b) < min_length {
                    continue;
                }
                let stats = sample_span_stats(a, b, evidence, image_size, options);
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

#[derive(Debug, Clone, Copy)]
pub(super) struct SpanStats {
    pub(super) line_min: f64,
    pub(super) line_mean: f64,
    pub(super) line_max: f64,
    pub(super) non_crease_mean: f64,
    pub(super) style_support: f64,
    pub(super) assignment: AssignmentEvidence,
}

pub(super) fn sample_span_stats(
    a: Point2,
    b: Point2,
    evidence: &CompilerEvidence,
    image_size: u32,
    options: JunctionCarrierV1StrategyOptions,
) -> SpanStats {
    let a_px = px_from_unit(a, image_size);
    let b_px = px_from_unit(b, image_size);
    let points = sample_points(a_px, b_px, 4.0);
    let mut line_min = f64::INFINITY;
    let mut line_max = 0.0_f64;
    let mut line_sum = 0.0;
    let mut non_crease_sum = 0.0;
    let mut style_sums = [0.0_f64; 4];
    let mut assignment_sums = [0.0_f64; 4];
    let mut count = 0usize;
    let size = image_size as usize;
    for point in points {
        let Some(idx) = pixel_index(point, size) else {
            continue;
        };
        let line = evidence.dense.line_probability[idx] as f64;
        line_min = line_min.min(line);
        line_max = line_max.max(line);
        line_sum += line;
        non_crease_sum += evidence.dense.non_crease_probability[idx] as f64;
        for channel in 0..4 {
            assignment_sums[channel] +=
                evidence.dense.assignment_probability[idx * 4 + channel] as f64;
            style_sums[channel] += evidence.dense.line_style_probability[idx * 4 + channel] as f64;
        }
        count += 1;
    }
    if count == 0 {
        return SpanStats {
            line_min: 0.0,
            line_mean: 0.0,
            line_max: 0.0,
            non_crease_mean: 1.0,
            style_support: 0.0,
            assignment: unknown_assignment(),
        };
    }
    let inv = 1.0 / count as f64;
    let assignment = assignment_from_sums(assignment_sums, options);
    SpanStats {
        line_min: line_min.min(line_sum * inv).clamp(0.0, 1.0),
        line_mean: (line_sum * inv).clamp(0.0, 1.0),
        line_max: line_max.clamp(0.0, 1.0),
        non_crease_mean: (non_crease_sum * inv).clamp(0.0, 1.0),
        style_support: ((style_sums[1] + style_sums[2]) * inv).clamp(0.0, 1.0),
        assignment,
    }
}

fn span_supported(stats: SpanStats, options: JunctionCarrierV1StrategyOptions) -> bool {
    stats.line_mean >= options.min_span_line_support
        && (stats.line_min >= options.min_span_line_min_support
            || stats.line_mean >= options.strong_span_line_support)
        && stats.non_crease_mean <= 0.72
}

fn span_from_pair(
    id: usize,
    vertices: [usize; 2],
    carrier: &CarrierHypothesis,
    stats: SpanStats,
    vertex_gap: usize,
    options: JunctionCarrierV1StrategyOptions,
) -> CandidateCreaseSpan {
    let t0 = 0.0;
    let t1 = 1.0;
    let strong = stats.line_mean >= options.strong_span_line_support;
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
        t_interval: [t0, t1],
        assignment_evidence: stats.assignment,
        presence_probability: stats.line_mean.clamp(0.05, 0.97),
        line_support_min: stats.line_min,
        line_support_mean: stats.line_mean,
        line_support_max: stats.line_max,
        style_support: stats.style_support,
        non_crease_support: stats.non_crease_mean,
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
            "junction-carrier-v1 vertex-pair span from carrier support {:.3}",
            carrier.support
        )],
    }
}

fn assignment_from_sums(
    sums: [f64; 4],
    _options: JunctionCarrierV1StrategyOptions,
) -> AssignmentEvidence {
    let total = sums.iter().sum::<f64>();
    if total <= 1e-9 {
        return unknown_assignment();
    }
    let probabilities = sums.map(|value| value / total);
    let mut order = [0usize, 1, 2, 3];
    order.sort_by(|left, right| probabilities[*right].total_cmp(&probabilities[*left]));
    let best = order[0];
    let second = order[1];
    let confidence = probabilities[best];
    let margin = confidence - probabilities[second];
    let label = if confidence >= 0.60 && margin >= 0.12 {
        match best {
            0 => AssignmentLabel::Mountain,
            1 => AssignmentLabel::Valley,
            2 => AssignmentLabel::Boundary,
            _ => AssignmentLabel::Unknown,
        }
    } else {
        AssignmentLabel::Unknown
    };
    AssignmentEvidence {
        mountain: probabilities[0].max(0.01),
        valley: probabilities[1].max(0.01),
        boundary: probabilities[2].max(0.01),
        auxiliary: probabilities[3].max(0.01),
        unknown: if label == AssignmentLabel::Unknown {
            0.75
        } else {
            0.05
        },
        observed_label: label,
        source: AssignmentEvidenceSource::ModelAssignmentHead,
        confidence,
        margin,
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

pub(super) fn add_locked_border_spans(
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
                reasons: vec!["junction-carrier-v1 deterministic square border".to_owned()],
            });
        }
    }
}

pub(super) fn boundary_model(vertices: &[CandidateVertex], corners: [usize; 4]) -> BoundaryModel {
    let sides = vec![
        side_model(vertices, BoundarySide::Top, [corners[0], corners[1]]),
        side_model(vertices, BoundarySide::Right, [corners[1], corners[2]]),
        side_model(vertices, BoundarySide::Bottom, [corners[2], corners[3]]),
        side_model(vertices, BoundarySide::Left, [corners[3], corners[0]]),
    ];
    BoundaryModel {
        corners,
        sides,
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

fn side_sort_key(side: BoundarySide, point: Point2) -> f64 {
    match side {
        BoundarySide::Top | BoundarySide::Bottom => point.x,
        BoundarySide::Right | BoundarySide::Left => point.y,
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
            reason: "duplicate candidate spans share effective endpoints".to_owned(),
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
                        reason: "same-carrier span alternatives overlap".to_owned(),
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

pub(super) fn graph_report(graph: &CandidateGraph) -> CandidateGraphReport {
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

pub(super) fn assign_span_ids(spans: &mut [CandidateCreaseSpan]) {
    for (id, span) in spans.iter_mut().enumerate() {
        span.id = id;
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct SpanKey {
    a: (i64, i64),
    b: (i64, i64),
}

pub(super) fn span_endpoint_key(
    graph: &CandidateGraph,
    endpoints: [usize; 2],
    tolerance: f64,
) -> SpanKey {
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

pub(super) fn unit_from_px(point: [f32; 2], image_size: u32) -> Point2 {
    let span = unit_scale(image_size);
    Point2::new(
        ((point[0] as f64 - SYNTHETIC_RENDER_INSET_PX) / span).clamp(0.0, 1.0),
        ((point[1] as f64 - SYNTHETIC_RENDER_INSET_PX) / span).clamp(0.0, 1.0),
    )
}

pub(super) fn px_from_unit(point: Point2, image_size: u32) -> [f32; 2] {
    let span = unit_scale(image_size);
    [
        (SYNTHETIC_RENDER_INSET_PX + point.x * span) as f32,
        (SYNTHETIC_RENDER_INSET_PX + point.y * span) as f32,
    ]
}

pub(super) fn unit_scale(image_size: u32) -> f64 {
    (image_size as f64 - SYNTHETIC_RENDER_INSET_PX * 2.0).max(1.0)
}

pub(super) fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

pub(super) fn normalized(vector: Point2) -> Option<Point2> {
    let length = (vector.x * vector.x + vector.y * vector.y).sqrt();
    (length > 1e-9).then(|| Point2::new(vector.x / length, vector.y / length))
}

pub(super) fn project(point: Point2, direction: Point2) -> f64 {
    point.x * direction.x + point.y * direction.y
}

fn point_line_distance(point: Point2, carrier: &CarrierHypothesis) -> f64 {
    (point.x * carrier.normal.x + point.y * carrier.normal.y - carrier.rho).abs()
}

fn angle_delta(left: f64, right: f64) -> f64 {
    let diff = (left - right).abs().rem_euclid(std::f64::consts::PI);
    diff.min(std::f64::consts::PI - diff)
}

pub(super) fn sample_points(a: [f32; 2], b: [f32; 2], step_px: f32) -> Vec<[f32; 2]> {
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

pub(super) fn pixel_index(point: [f32; 2], size: usize) -> Option<usize> {
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
    use crate::evidence_extract::{
        AssignmentEvidence as PrimitiveAssignment, LineStyleEvidence, PrimitiveSource,
    };

    #[test]
    fn clusters_nearby_interior_vertices() {
        let evidence = CompilerEvidence {
            image_size: 128,
            dense: empty_dense(128),
            line_primitives: Vec::new(),
            junction_primitives: vec![
                crate::evidence_extract::JunctionPrimitive {
                    point: [64.0, 64.0],
                    support: 0.9,
                    source: PrimitiveSource::ObservedStrong,
                },
                crate::evidence_extract::JunctionPrimitive {
                    point: [66.0, 64.0],
                    support: 0.8,
                    source: PrimitiveSource::ObservedStrong,
                },
            ],
            boundary_contact_primitives: Vec::new(),
            report: dummy_report(128),
        };
        let vertices = build_vertices(
            &evidence,
            128,
            JunctionCarrierV1StrategyOptions {
                max_line_endpoint_vertices: 8,
                ..JunctionCarrierV1StrategyOptions::default()
            },
        );
        assert_eq!(
            vertices
                .iter()
                .filter(|vertex| vertex.kind == CandidateVertexKind::InteriorJunction)
                .count(),
            1
        );
    }

    #[test]
    fn groups_collinear_line_primitives() {
        let evidence = CompilerEvidence {
            image_size: 128,
            dense: empty_dense(128),
            line_primitives: vec![
                primitive_line([32.0, 64.0], [96.0, 64.0], 0.9),
                primitive_line([40.0, 65.0], [90.0, 65.0], 0.8),
            ],
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
            report: dummy_report(128),
        };
        let carriers =
            carrier_hypotheses(&evidence, 128, JunctionCarrierV1StrategyOptions::default());
        assert_eq!(carriers.len(), 1);
        assert!(carriers[0].support > 0.8);
    }

    #[test]
    fn adds_line_endpoint_vertices_when_junction_head_misses_endpoint() {
        let evidence = CompilerEvidence {
            image_size: 128,
            dense: empty_dense(128),
            line_primitives: vec![primitive_line([48.0, 64.0], [80.0, 64.0], 0.9)],
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
            report: dummy_report(128),
        };
        let vertices = build_vertices(
            &evidence,
            128,
            JunctionCarrierV1StrategyOptions {
                max_line_endpoint_vertices: 8,
                ..JunctionCarrierV1StrategyOptions::default()
            },
        );
        assert_eq!(
            vertices
                .iter()
                .filter(|vertex| vertex.kind == CandidateVertexKind::LineEndpoint)
                .count(),
            2
        );
    }

    #[test]
    fn creates_supported_vertex_pair_span() {
        let mut evidence = CompilerEvidence {
            image_size: 128,
            dense: empty_dense(128),
            line_primitives: vec![primitive_line([32.0, 64.0], [96.0, 64.0], 0.9)],
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
            report: dummy_report(128),
        };
        for x in 32..=96 {
            let idx = 64 * 128 + x;
            evidence.dense.line_probability[idx] = 0.95;
            evidence.dense.assignment_probability[idx * 4] = 0.9;
            evidence.dense.assignment_probability[idx * 4 + 1] = 0.05;
            evidence.dense.assignment_probability[idx * 4 + 2] = 0.03;
            evidence.dense.assignment_probability[idx * 4 + 3] = 0.02;
        }
        let vertices = vec![
            vertex(
                0,
                unit_from_px([32.0, 64.0], 128),
                CandidateVertexKind::InteriorJunction,
                0.9,
                CandidateVertexMovementPolicy::Movable,
                None,
            ),
            vertex(
                1,
                unit_from_px([96.0, 64.0], 128),
                CandidateVertexKind::InteriorJunction,
                0.9,
                CandidateVertexMovementPolicy::Movable,
                None,
            ),
        ];
        let carriers =
            carrier_hypotheses(&evidence, 128, JunctionCarrierV1StrategyOptions::default());
        let mut spans = Vec::new();
        add_carrier_pair_spans(
            &vertices,
            &carriers,
            &evidence,
            128,
            JunctionCarrierV1StrategyOptions::default(),
            &mut spans,
        );
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].vertices, [0, 1]);
        assert_eq!(
            spans[0].assignment_evidence.observed_label,
            AssignmentLabel::Mountain
        );
    }

    #[test]
    fn conflicts_overlapping_same_carrier_alternatives() {
        let vertices = vec![
            vertex(
                0,
                Point2::new(0.0, 0.5),
                CandidateVertexKind::InteriorJunction,
                1.0,
                CandidateVertexMovementPolicy::Movable,
                None,
            ),
            vertex(
                1,
                Point2::new(0.5, 0.5),
                CandidateVertexKind::InteriorJunction,
                1.0,
                CandidateVertexMovementPolicy::Movable,
                None,
            ),
            vertex(
                2,
                Point2::new(1.0, 0.5),
                CandidateVertexKind::InteriorJunction,
                1.0,
                CandidateVertexMovementPolicy::Movable,
                None,
            ),
        ];
        let carrier = CarrierHypothesis {
            id: 7,
            normal: Point2::new(0.0, 1.0),
            direction: Point2::new(1.0, 0.0),
            rho: 0.5,
            t_interval: [0.0, 1.0],
            support: 0.9,
        };
        let stats = SpanStats {
            line_min: 0.9,
            line_mean: 0.9,
            line_max: 0.9,
            non_crease_mean: 0.0,
            style_support: 0.0,
            assignment: unknown_assignment(),
        };
        let graph = CandidateGraph {
            schema: "test".to_owned(),
            coordinate_space: "unit_square".to_owned(),
            image_size: Some(128),
            vertices,
            crease_candidates: vec![
                span_from_pair(
                    0,
                    [0, 2],
                    &carrier,
                    stats,
                    2,
                    JunctionCarrierV1StrategyOptions::default(),
                ),
                span_from_pair(
                    1,
                    [0, 1],
                    &carrier,
                    stats,
                    1,
                    JunctionCarrierV1StrategyOptions::default(),
                ),
            ],
            boundary: BoundaryModel {
                corners: [0, 0, 0, 0],
                sides: Vec::new(),
                generated_border_span_ids: Vec::new(),
                reconstruction_policy: BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts,
            },
            conflicts: Vec::new(),
            alternatives: Vec::new(),
            cost_model: CostModel::default(),
            provenance: CandidateGraphProvenance {
                source_adapter: CandidateSourceAdapter::ArrangementV2,
                source_ids: Vec::new(),
                notes: Vec::new(),
            },
            report: CandidateGraphReport {
                vertices: 3,
                crease_candidates: 2,
                locked_border_spans: 0,
                legacy_selected_spans: 0,
                legacy_low_threshold_spans: 0,
                arrangement_observed_spans: 1,
                arrangement_shared_spans: 1,
                conflicts: 0,
            },
        };
        let conflicts = generate_conflicts(&graph);
        assert!(
            conflicts
                .iter()
                .any(|conflict| conflict.kind == CandidateConflictKind::SharedCarrierAlternative)
        );
    }

    fn empty_dense(size: usize) -> crate::evidence_extract::DenseEvidence {
        let pixels = size * size;
        crate::evidence_extract::DenseEvidence {
            line_probability: vec![0.0; pixels],
            non_crease_probability: vec![0.0; pixels],
            junction_probability: vec![0.0; pixels],
            boundary_contact_probability: vec![0.0; pixels],
            assignment_probability: vec![0.25; pixels * 4],
            line_style_probability: vec![0.25; pixels * 4],
        }
    }

    fn primitive_line(p0: [f32; 2], p1: [f32; 2], support: f32) -> LinePrimitive {
        LinePrimitive {
            p0,
            p1,
            theta: 0.0,
            rho: 0.0,
            support,
            votes: 64,
            assignment: PrimitiveAssignment {
                label: 0,
                confidence: 0.9,
                margin: 0.8,
                probabilities: [0.9, 0.05, 0.03, 0.02],
            },
            style: LineStyleEvidence {
                probabilities: [0.95, 0.02, 0.02, 0.01],
                dashed_or_gapped_support: 0.02,
            },
            source: PrimitiveSource::ObservedStrong,
        }
    }

    fn dummy_report(size: u32) -> crate::evidence_extract::EvidenceExtractionReport {
        crate::evidence_extract::EvidenceExtractionReport {
            schema: "test".to_owned(),
            legacy_dependency: false,
            image_size: size,
            extraction_seconds: 0.0,
            line_pixels_above_threshold: 0,
            hough_segments: 0,
            line_primitives: 0,
            strong_line_primitives: 0,
            weak_line_primitives: 0,
            junction_primitives: 0,
            boundary_contact_primitives: 0,
        }
    }
}
