//! Adjacency-constrained junction-first candidate generation.
//!
//! A crease pattern is a planar line arrangement: edges exist exactly between
//! consecutive collinear vertices. This strategy proposes a span for a vertex
//! pair only when no third candidate vertex lies on the connecting segment, so
//! skip-spans and merged edges are impossible by construction instead of being
//! delegated to selection. No Hough carrier is required for edge proposal; the
//! carrier is the analytic line through the two endpoints.

use std::collections::BTreeMap;

use super::JunctionFirstV1StrategyOptions;
use super::junction_carrier_v1::{
    SpanStats, add_locked_border_spans, assign_span_ids, assign_vertex_ids, boundary_model,
    build_vertices, dense_output_refs, distance, evidence_config, evidence_error_to_decode_error,
    graph_report, normalized, pixel_index, project, px_from_unit, sample_span_stats,
    span_endpoint_key, unit_scale,
};
use super::{CandidateGenerationStrategyName, JunctionCarrierV1StrategyOptions};
use crate::evidence_extract::{CompilerEvidence, extract_compiler_evidence};
use crate::legacy_decode::{DecodeConfig, DecodeError, DenseOutputs};
use oristudio_cp_compiler::candidate_graph::{
    CandidateCarrierGeometry, CandidateCreaseBoundaryRole, CandidateCreaseSpan,
    CandidateCreaseSpanKind, CandidateGraph, CandidateGraphReport, CandidateVertex,
};
use oristudio_cp_compiler::{
    CandidateConflict, CandidateConflictKind, CandidateCreaseSourceKind, CandidateGraphProvenance,
    CandidateSelectionPolicy, CandidateSourceAdapter, CostModel, Point2,
};

pub(super) fn generate_candidate_graph(
    outputs: DenseOutputs<'_>,
    config: &DecodeConfig,
    options: JunctionFirstV1StrategyOptions,
) -> Result<CandidateGraph, DecodeError> {
    let carrier_options = carrier_equivalent_options(options);
    let evidence = extract_compiler_evidence(
        dense_output_refs(outputs),
        evidence_config(config, carrier_options),
    )
    .map_err(evidence_error_to_decode_error)?;
    Ok(graph_from_evidence(&evidence, config, options))
}

/// The vertex builder and segment sampler are shared with `junction-carrier-v1`
/// and take its options struct; only the fields used by those helpers matter.
fn carrier_equivalent_options(
    options: JunctionFirstV1StrategyOptions,
) -> JunctionCarrierV1StrategyOptions {
    JunctionCarrierV1StrategyOptions {
        vertex_merge_radius_px: options.vertex_merge_radius_px,
        strong_span_line_support: options.strong_span_line_support,
        max_line_endpoint_vertices: 0,
        ..JunctionCarrierV1StrategyOptions::default()
    }
}

fn graph_from_evidence(
    evidence: &CompilerEvidence,
    config: &DecodeConfig,
    options: JunctionFirstV1StrategyOptions,
) -> CandidateGraph {
    let carrier_options = carrier_equivalent_options(options);
    let mut vertices = build_vertices(evidence, config.image_size, carrier_options);
    assign_vertex_ids(&mut vertices);
    let boundary = boundary_model(&vertices, [0, 1, 2, 3]);
    let mut spans = Vec::new();
    add_locked_border_spans(&vertices, &boundary, &mut spans);
    add_adjacent_pair_spans(&vertices, evidence, config.image_size, options, &mut spans);
    assign_span_ids(&mut spans);
    let mut graph = CandidateGraph {
        schema: "oristudio/cp-compiler/candidate-graph-v1".to_owned(),
        coordinate_space: "unit_square".to_owned(),
        image_size: Some(config.image_size),
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
                "junction-first-v1 adjacency-constrained dense strategy; no Hough carrier gate"
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
    graph.conflicts = generate_conflicts(&graph, config.image_size, options);
    graph.alternatives = graph.conflicts.clone();
    graph.report = graph_report(&graph);
    graph
}

fn add_adjacent_pair_spans(
    vertices: &[CandidateVertex],
    evidence: &CompilerEvidence,
    image_size: u32,
    options: JunctionFirstV1StrategyOptions,
    spans: &mut Vec<CandidateCreaseSpan>,
) {
    let scale = unit_scale(image_size);
    let min_length = options.min_span_length_px / scale;
    let corridor = options.intermediate_corridor_px / scale;
    let endpoint_margin = options.endpoint_margin_px / scale;
    for i in 0..vertices.len() {
        for j in (i + 1)..vertices.len() {
            let a = vertices[i].point;
            let b = vertices[j].point;
            if distance(a, b) < min_length {
                continue;
            }
            if border_aligned_pair(a, b) {
                continue;
            }
            if !preflight_line_support(a, b, evidence, image_size, options) {
                continue;
            }
            if has_intermediate_vertex(vertices, i, j, corridor, endpoint_margin) {
                continue;
            }
            let stats = sample_span_stats(a, b, evidence, image_size, carrier_equivalent_options(options));
            if !pair_supported(stats, options) {
                continue;
            }
            spans.push(span_from_adjacent_pair(
                spans.len(),
                [i, j],
                a,
                b,
                stats,
                options,
            ));
        }
    }
}

/// Both endpoints lie on the same paper border line. Those links are owned by
/// the deterministic locked border spans; proposing them here would only create
/// duplicates against locked geometry.
fn border_aligned_pair(a: Point2, b: Point2) -> bool {
    const EPS: f64 = 1e-9;
    (a.x.abs() <= EPS && b.x.abs() <= EPS)
        || ((1.0 - a.x).abs() <= EPS && (1.0 - b.x).abs() <= EPS)
        || (a.y.abs() <= EPS && b.y.abs() <= EPS)
        || ((1.0 - a.y).abs() <= EPS && (1.0 - b.y).abs() <= EPS)
}

fn preflight_line_support(
    a: Point2,
    b: Point2,
    evidence: &CompilerEvidence,
    image_size: u32,
    options: JunctionFirstV1StrategyOptions,
) -> bool {
    let size = image_size as usize;
    let a_px = px_from_unit(a, image_size);
    let b_px = px_from_unit(b, image_size);
    let mut best = 0.0_f64;
    for t in [0.25_f32, 0.5, 0.75] {
        let point = [
            a_px[0] + (b_px[0] - a_px[0]) * t,
            a_px[1] + (b_px[1] - a_px[1]) * t,
        ];
        if let Some(idx) = pixel_index(point, size) {
            best = best.max(evidence.dense.line_probability[idx] as f64);
        }
    }
    best >= options.preflight_min_line_support
}

fn has_intermediate_vertex(
    vertices: &[CandidateVertex],
    a_id: usize,
    b_id: usize,
    corridor: f64,
    endpoint_margin: f64,
) -> bool {
    let a = vertices[a_id].point;
    let b = vertices[b_id].point;
    let length = distance(a, b);
    let Some(direction) = normalized(Point2::new(b.x - a.x, b.y - a.y)) else {
        return false;
    };
    let t_a = project(a, direction);
    for (id, vertex) in vertices.iter().enumerate() {
        if id == a_id || id == b_id {
            continue;
        }
        let t = project(vertex.point, direction) - t_a;
        if t <= endpoint_margin || t >= length - endpoint_margin {
            continue;
        }
        let on_line = Point2::new(a.x + direction.x * t, a.y + direction.y * t);
        if distance(vertex.point, on_line) <= corridor {
            return true;
        }
    }
    false
}

fn pair_supported(stats: SpanStats, options: JunctionFirstV1StrategyOptions) -> bool {
    stats.line_mean >= options.min_span_line_support
        && (stats.line_min >= options.min_span_line_min_support
            || stats.line_mean >= options.strong_span_line_support)
        && stats.non_crease_mean <= options.max_non_crease_support
}

fn span_from_adjacent_pair(
    id: usize,
    vertices: [usize; 2],
    a: Point2,
    b: Point2,
    stats: SpanStats,
    options: JunctionFirstV1StrategyOptions,
) -> CandidateCreaseSpan {
    let direction =
        normalized(Point2::new(b.x - a.x, b.y - a.y)).unwrap_or(Point2::new(1.0, 0.0));
    let mut normal = Point2::new(-direction.y, direction.x);
    let mut rho = normal.x * a.x + normal.y * a.y;
    if rho < 0.0 {
        normal = Point2::new(-normal.x, -normal.y);
        rho = -rho;
    }
    let t0 = project(a, direction);
    let t1 = project(b, direction);
    let strong = stats.line_mean >= options.strong_span_line_support;
    CandidateCreaseSpan {
        id,
        kind: CandidateCreaseSpanKind::ObservedCarrierSpan,
        vertices,
        carrier: CandidateCarrierGeometry {
            normal,
            direction,
            rho,
        },
        t_interval: [t0.min(t1), t0.max(t1)],
        assignment_evidence: stats.assignment,
        presence_probability: stats.line_mean.clamp(0.05, 0.97),
        line_support_min: stats.line_min,
        line_support_mean: stats.line_mean,
        line_support_max: stats.line_max,
        style_support: stats.style_support,
        non_crease_support: stats.non_crease_mean,
        source_kind: CandidateCreaseSourceKind::ArrangementObserved,
        selection_policy: if strong {
            CandidateSelectionPolicy::StrongOptional
        } else {
            CandidateSelectionPolicy::WeakOptional
        },
        boundary_role: CandidateCreaseBoundaryRole::None,
        source_edge_ids: Vec::new(),
        source_atomic_edge_ids: Vec::new(),
        source_carrier_ids: Vec::new(),
        replaced_span_ids: Vec::new(),
        replaced_atomic_edge_ids: Vec::new(),
        collapsed_vertex_ids: Vec::new(),
        provenance: Vec::new(),
        reasons: vec![format!(
            "junction-first-v1 adjacent collinear pair (line mean {:.3})",
            stats.line_mean
        )],
    }
}

fn generate_conflicts(
    graph: &CandidateGraph,
    image_size: u32,
    options: JunctionFirstV1StrategyOptions,
) -> Vec<CandidateConflict> {
    let mut conflicts = Vec::new();

    let mut by_key = BTreeMap::<_, Vec<usize>>::new();
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

    let scale = unit_scale(image_size);
    let endpoint_margin = options.endpoint_margin_px / scale;
    let collinear_distance = options.collinear_conflict_distance_px / scale;
    let collinear_angle = options.collinear_conflict_angle_degrees.to_radians();
    let optional = graph
        .crease_candidates
        .iter()
        .filter(|span| span.selection_policy != CandidateSelectionPolicy::Locked)
        .collect::<Vec<_>>();
    for i in 0..optional.len() {
        for j in (i + 1)..optional.len() {
            let left = optional[i];
            let right = optional[j];
            if left.vertices[0] == right.vertices[0]
                || left.vertices[0] == right.vertices[1]
                || left.vertices[1] == right.vertices[0]
                || left.vertices[1] == right.vertices[1]
            {
                continue;
            }
            if segments_cross_interior(graph, left, right, endpoint_margin) {
                conflicts.push(CandidateConflict {
                    id: conflicts.len(),
                    kind: CandidateConflictKind::UnsupportedCrossing,
                    candidate_ids: vec![left.id, right.id],
                    hard: true,
                    reason: "candidate spans cross without a shared vertex".to_owned(),
                });
            } else if collinear_overlap(
                graph,
                left,
                right,
                collinear_angle,
                collinear_distance,
            ) {
                conflicts.push(CandidateConflict {
                    id: conflicts.len(),
                    kind: CandidateConflictKind::SharedCarrierAlternative,
                    candidate_ids: vec![left.id, right.id],
                    hard: true,
                    reason: "near-collinear candidate spans overlap".to_owned(),
                });
            }
        }
    }
    conflicts
}

fn span_segment(graph: &CandidateGraph, span: &CandidateCreaseSpan) -> (Point2, Point2) {
    (
        graph.vertices[span.vertices[0]].point,
        graph.vertices[span.vertices[1]].point,
    )
}

fn segments_cross_interior(
    graph: &CandidateGraph,
    left: &CandidateCreaseSpan,
    right: &CandidateCreaseSpan,
    endpoint_margin: f64,
) -> bool {
    let (p, p2) = span_segment(graph, left);
    let (q, q2) = span_segment(graph, right);
    let r = Point2::new(p2.x - p.x, p2.y - p.y);
    let s = Point2::new(q2.x - q.x, q2.y - q.y);
    let denominator = r.x * s.y - r.y * s.x;
    if denominator.abs() < 1e-12 {
        return false;
    }
    let qp = Point2::new(q.x - p.x, q.y - p.y);
    let t = (qp.x * s.y - qp.y * s.x) / denominator;
    let u = (qp.x * r.y - qp.y * r.x) / denominator;
    let left_length = (r.x * r.x + r.y * r.y).sqrt();
    let right_length = (s.x * s.x + s.y * s.y).sqrt();
    if left_length < 1e-12 || right_length < 1e-12 {
        return false;
    }
    let t_margin = (endpoint_margin / left_length).min(0.49);
    let u_margin = (endpoint_margin / right_length).min(0.49);
    t > t_margin && t < 1.0 - t_margin && u > u_margin && u < 1.0 - u_margin
}

fn collinear_overlap(
    graph: &CandidateGraph,
    left: &CandidateCreaseSpan,
    right: &CandidateCreaseSpan,
    angle_tolerance: f64,
    distance_tolerance: f64,
) -> bool {
    let angle_left = left.carrier.direction.y.atan2(left.carrier.direction.x);
    let angle_right = right.carrier.direction.y.atan2(right.carrier.direction.x);
    let diff = (angle_left - angle_right)
        .abs()
        .rem_euclid(std::f64::consts::PI);
    if diff.min(std::f64::consts::PI - diff) > angle_tolerance {
        return false;
    }
    let (q, q2) = span_segment(graph, right);
    let line_distance = |point: Point2| {
        (point.x * left.carrier.normal.x + point.y * left.carrier.normal.y - left.carrier.rho)
            .abs()
    };
    if line_distance(q) > distance_tolerance || line_distance(q2) > distance_tolerance {
        return false;
    }
    let (p, p2) = span_segment(graph, left);
    let direction = left.carrier.direction;
    let left_interval = sorted_pair(project(p, direction), project(p2, direction));
    let right_interval = sorted_pair(project(q, direction), project(q2, direction));
    let overlap = left_interval.1.min(right_interval.1) - left_interval.0.max(right_interval.0);
    overlap > 1e-6
}

fn sorted_pair(a: f64, b: f64) -> (f64, f64) {
    (a.min(b), a.max(b))
}

// Keep the strategy name referenced so the module's purpose is greppable from
// the registry side as well.
#[allow(dead_code)]
const STRATEGY: CandidateGenerationStrategyName = CandidateGenerationStrategyName::JunctionFirstV1;

#[cfg(test)]
mod tests {
    use super::super::junction_carrier_v1::unit_from_px;
    use super::*;
    use crate::evidence_extract::{DenseEvidence, EvidenceExtractionReport};
    use oristudio_cp_compiler::candidate_graph::{
        BoundaryModel, BoundaryReconstructionPolicy, CandidateVertexMovementPolicy,
    };
    use oristudio_cp_compiler::CandidateVertexKind;

    const SIZE: u32 = 128;

    fn test_vertex(id: usize, point: Point2) -> CandidateVertex {
        CandidateVertex {
            id,
            point,
            kind: CandidateVertexKind::InteriorJunction,
            support: 0.9,
            movement_policy: CandidateVertexMovementPolicy::Movable,
            boundary_side: None,
            source_vertex_ids: vec![id],
            source_carrier_ids: Vec::new(),
            source_adapter: CandidateSourceAdapter::ArrangementV2,
            provenance: Vec::new(),
        }
    }

    fn empty_evidence() -> CompilerEvidence {
        let pixels = (SIZE as usize) * (SIZE as usize);
        CompilerEvidence {
            image_size: SIZE,
            dense: DenseEvidence {
                line_probability: vec![0.0; pixels],
                non_crease_probability: vec![0.0; pixels],
                junction_probability: vec![0.0; pixels],
                boundary_contact_probability: vec![0.0; pixels],
                assignment_probability: vec![0.25; pixels * 4],
                line_style_probability: vec![0.25; pixels * 4],
            },
            line_primitives: Vec::new(),
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
            report: EvidenceExtractionReport {
                schema: "test".to_owned(),
                legacy_dependency: false,
                image_size: SIZE,
                extraction_seconds: 0.0,
                line_pixels_above_threshold: 0,
                hough_segments: 0,
                line_primitives: 0,
                strong_line_primitives: 0,
                weak_line_primitives: 0,
                junction_primitives: 0,
                boundary_contact_primitives: 0,
            },
        }
    }

    fn paint_horizontal_line(evidence: &mut CompilerEvidence, y: usize, x0: usize, x1: usize) {
        for x in x0..=x1 {
            let idx = y * SIZE as usize + x;
            evidence.dense.line_probability[idx] = 0.95;
            evidence.dense.assignment_probability[idx * 4] = 0.9;
            evidence.dense.assignment_probability[idx * 4 + 1] = 0.05;
            evidence.dense.assignment_probability[idx * 4 + 2] = 0.03;
            evidence.dense.assignment_probability[idx * 4 + 3] = 0.02;
        }
    }

    fn collinear_vertices() -> Vec<CandidateVertex> {
        vec![
            test_vertex(0, unit_from_px([40.0, 64.0], SIZE)),
            test_vertex(1, unit_from_px([64.0, 64.0], SIZE)),
            test_vertex(2, unit_from_px([88.0, 64.0], SIZE)),
        ]
    }

    #[test]
    fn adjacency_constraint_blocks_skip_spans() {
        let mut evidence = empty_evidence();
        paint_horizontal_line(&mut evidence, 64, 40, 88);
        let vertices = collinear_vertices();
        let mut spans = Vec::new();
        add_adjacent_pair_spans(
            &vertices,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
            &mut spans,
        );
        let pairs = spans.iter().map(|span| span.vertices).collect::<Vec<_>>();
        assert!(pairs.contains(&[0, 1]), "adjacent pair 0-1 expected");
        assert!(pairs.contains(&[1, 2]), "adjacent pair 1-2 expected");
        assert!(
            !pairs.contains(&[0, 2]),
            "skip span 0-2 must be blocked by the intermediate vertex"
        );
        assert!(spans.iter().all(|span| span.source_carrier_ids.is_empty()));
    }

    #[test]
    fn dark_segment_rejects_pair() {
        let evidence = empty_evidence();
        let vertices = vec![
            test_vertex(0, unit_from_px([40.0, 64.0], SIZE)),
            test_vertex(1, unit_from_px([88.0, 64.0], SIZE)),
        ];
        let mut spans = Vec::new();
        add_adjacent_pair_spans(
            &vertices,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
            &mut spans,
        );
        assert!(spans.is_empty());
    }

    #[test]
    fn high_non_crease_rejects_pair() {
        let mut evidence = empty_evidence();
        paint_horizontal_line(&mut evidence, 64, 40, 88);
        for x in 40..=88 {
            evidence.dense.non_crease_probability[64 * SIZE as usize + x] = 0.95;
        }
        let vertices = vec![
            test_vertex(0, unit_from_px([40.0, 64.0], SIZE)),
            test_vertex(1, unit_from_px([88.0, 64.0], SIZE)),
        ];
        let mut spans = Vec::new();
        add_adjacent_pair_spans(
            &vertices,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
            &mut spans,
        );
        assert!(spans.is_empty());
    }

    fn graph_with_spans(
        vertices: Vec<CandidateVertex>,
        spans: Vec<CandidateCreaseSpan>,
    ) -> CandidateGraph {
        CandidateGraph {
            schema: "test".to_owned(),
            coordinate_space: "unit_square".to_owned(),
            image_size: Some(SIZE),
            vertices,
            crease_candidates: spans,
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
                vertices: 0,
                crease_candidates: 0,
                locked_border_spans: 0,
                legacy_selected_spans: 0,
                legacy_low_threshold_spans: 0,
                arrangement_observed_spans: 0,
                arrangement_shared_spans: 0,
                conflicts: 0,
            },
        }
    }

    fn test_span(id: usize, vertices: [usize; 2], a: Point2, b: Point2) -> CandidateCreaseSpan {
        let stats = SpanStats {
            line_min: 0.9,
            line_mean: 0.9,
            line_max: 0.9,
            non_crease_mean: 0.0,
            style_support: 0.0,
            assignment: oristudio_cp_compiler::AssignmentEvidence {
                mountain: 0.25,
                valley: 0.25,
                boundary: 0.25,
                auxiliary: 0.25,
                unknown: 0.8,
                observed_label: oristudio_cp_compiler::AssignmentLabel::Unknown,
                source: oristudio_cp_compiler::AssignmentEvidenceSource::Unknown,
                confidence: 0.0,
                margin: 0.0,
            },
        };
        span_from_adjacent_pair(
            id,
            vertices,
            a,
            b,
            stats,
            JunctionFirstV1StrategyOptions::default(),
        )
    }

    #[test]
    fn crossing_spans_get_hard_conflict() {
        let vertices = vec![
            test_vertex(0, Point2::new(0.2, 0.2)),
            test_vertex(1, Point2::new(0.8, 0.8)),
            test_vertex(2, Point2::new(0.2, 0.8)),
            test_vertex(3, Point2::new(0.8, 0.2)),
        ];
        let spans = vec![
            test_span(0, [0, 1], vertices[0].point, vertices[1].point),
            test_span(1, [2, 3], vertices[2].point, vertices[3].point),
        ];
        let graph = graph_with_spans(vertices, spans);
        let conflicts =
            generate_conflicts(&graph, SIZE, JunctionFirstV1StrategyOptions::default());
        assert!(
            conflicts
                .iter()
                .any(|conflict| conflict.kind == CandidateConflictKind::UnsupportedCrossing
                    && conflict.hard),
            "crossing spans must produce a hard UnsupportedCrossing conflict"
        );
    }

    #[test]
    fn spans_sharing_a_vertex_do_not_conflict_as_crossing() {
        let vertices = vec![
            test_vertex(0, Point2::new(0.2, 0.2)),
            test_vertex(1, Point2::new(0.8, 0.8)),
            test_vertex(2, Point2::new(0.8, 0.2)),
        ];
        let spans = vec![
            test_span(0, [0, 1], vertices[0].point, vertices[1].point),
            test_span(1, [0, 2], vertices[0].point, vertices[2].point),
        ];
        let graph = graph_with_spans(vertices, spans);
        let conflicts =
            generate_conflicts(&graph, SIZE, JunctionFirstV1StrategyOptions::default());
        assert!(
            conflicts
                .iter()
                .all(|conflict| conflict.kind != CandidateConflictKind::UnsupportedCrossing)
        );
    }

    #[test]
    fn near_collinear_overlapping_spans_conflict() {
        let vertices = vec![
            test_vertex(0, Point2::new(0.2, 0.5)),
            test_vertex(1, Point2::new(0.8, 0.5)),
            test_vertex(2, Point2::new(0.3, 0.5005)),
            test_vertex(3, Point2::new(0.7, 0.5005)),
        ];
        let spans = vec![
            test_span(0, [0, 1], vertices[0].point, vertices[1].point),
            test_span(1, [2, 3], vertices[2].point, vertices[3].point),
        ];
        let graph = graph_with_spans(vertices, spans);
        let conflicts =
            generate_conflicts(&graph, SIZE, JunctionFirstV1StrategyOptions::default());
        assert!(
            conflicts
                .iter()
                .any(|conflict| conflict.kind
                    == CandidateConflictKind::SharedCarrierAlternative
                    && conflict.hard),
            "near-collinear overlapping spans must produce a hard conflict"
        );
    }

    #[test]
    fn border_aligned_pairs_are_skipped() {
        let mut evidence = empty_evidence();
        // Bright pixels along the rendered top border (y = inset = 32).
        paint_horizontal_line(&mut evidence, 32, 32, 96);
        let vertices = vec![
            test_vertex(0, Point2::new(0.25, 0.0)),
            test_vertex(1, Point2::new(0.75, 0.0)),
        ];
        let mut spans = Vec::new();
        add_adjacent_pair_spans(
            &vertices,
            &evidence,
            SIZE,
            JunctionFirstV1StrategyOptions::default(),
            &mut spans,
        );
        assert!(spans.is_empty(), "border-aligned pair must be left to locked border spans");
    }
}
