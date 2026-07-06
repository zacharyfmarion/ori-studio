use std::collections::{BTreeMap, BTreeSet};

use super::LegacyTopologyV2StrategyOptions;
use oristudio_cp_compiler::candidate_graph::{
    CandidateCreaseBoundaryRole, CandidateCreaseSpan, CandidateCreaseSpanKind, CandidateGraph,
};
use oristudio_cp_compiler::{
    AssignmentEvidence, AssignmentEvidenceSource, AssignmentLabel, BoundarySide, CandidateConflict,
    CandidateConflictKind, CandidateCreaseSourceKind, CandidateGraphReport,
    CandidateSelectionPolicy, CandidateVertexKind, Point2,
};

pub fn add_structural_topology_candidates(
    graph: &mut CandidateGraph,
    image_size: u32,
    options: LegacyTopologyV2StrategyOptions,
) {
    let base_span_ids = structural_base_span_ids(graph);
    if base_span_ids.len() < options.min_chain_spans {
        refresh_graph_metadata(graph);
        return;
    }

    let adjacency = span_adjacency(graph, &base_span_ids);
    let full_adjacency = span_adjacency(graph, &full_incident_span_ids(graph));
    let pass_through_vertices =
        pass_through_vertices(graph, &adjacency, &full_adjacency, image_size, options);
    let paths = structural_paths(graph, &adjacency, &pass_through_vertices, options);
    for path in paths {
        if let Some(span) = structural_span_from_path(graph, &path, options) {
            graph.crease_candidates.push(span);
        }
    }
    refresh_graph_metadata(graph);
}

fn structural_base_span_ids(graph: &CandidateGraph) -> BTreeSet<usize> {
    graph
        .crease_candidates
        .iter()
        .filter(|span| {
            span.selection_policy == CandidateSelectionPolicy::StrongOptional
                && span.boundary_role() == CandidateCreaseBoundaryRole::None
                && span.kind != CandidateCreaseSpanKind::NormalizedPassThroughSpan
        })
        .map(|span| span.id)
        .collect()
}

fn full_incident_span_ids(graph: &CandidateGraph) -> BTreeSet<usize> {
    graph
        .crease_candidates
        .iter()
        .filter(|span| {
            span.selection_policy != CandidateSelectionPolicy::Locked
                && span.boundary_role() == CandidateCreaseBoundaryRole::None
                && span.kind != CandidateCreaseSpanKind::NormalizedPassThroughSpan
        })
        .map(|span| span.id)
        .collect()
}

fn span_adjacency(
    graph: &CandidateGraph,
    span_ids: &BTreeSet<usize>,
) -> BTreeMap<usize, Vec<usize>> {
    let mut adjacency = BTreeMap::<usize, Vec<usize>>::new();
    for span_id in span_ids {
        let Some(span) = graph.crease_candidates.get(*span_id) else {
            continue;
        };
        for vertex_id in span.vertices {
            adjacency.entry(vertex_id).or_default().push(*span_id);
        }
    }
    adjacency
}

fn pass_through_vertices(
    graph: &CandidateGraph,
    adjacency: &BTreeMap<usize, Vec<usize>>,
    full_adjacency: &BTreeMap<usize, Vec<usize>>,
    image_size: u32,
    options: LegacyTopologyV2StrategyOptions,
) -> BTreeSet<usize> {
    adjacency
        .iter()
        .filter_map(|(vertex_id, span_ids)| {
            let vertex = graph.vertices.get(*vertex_id)?;
            if vertex.boundary_side.is_some()
                || matches!(
                    vertex.kind,
                    CandidateVertexKind::Corner | CandidateVertexKind::BoundaryContact
                )
            {
                return None;
            }
            if span_ids.len() != 2 {
                return None;
            }
            if full_adjacency
                .get(vertex_id)
                .is_none_or(|incident| incident.len() != 2)
            {
                return None;
            }
            are_collinear_through_vertex(
                graph,
                *vertex_id,
                span_ids[0],
                span_ids[1],
                image_size,
                options,
            )
            .then_some(*vertex_id)
        })
        .collect()
}

fn are_collinear_through_vertex(
    graph: &CandidateGraph,
    vertex_id: usize,
    left_span_id: usize,
    right_span_id: usize,
    image_size: u32,
    options: LegacyTopologyV2StrategyOptions,
) -> bool {
    let Some(vertex) = graph.vertices.get(vertex_id).map(|vertex| vertex.point) else {
        return false;
    };
    let Some(left_span) = graph.crease_candidates.get(left_span_id) else {
        return false;
    };
    let Some(right_span) = graph.crease_candidates.get(right_span_id) else {
        return false;
    };
    if !assignments_compatible(
        left_span.assignment_evidence.observed_label,
        right_span.assignment_evidence.observed_label,
    ) {
        return false;
    }
    let Some(left_other) = other_span_vertex(left_span, vertex_id)
        .and_then(|id| graph.vertices.get(id).map(|vertex| vertex.point))
    else {
        return false;
    };
    let Some(right_other) = other_span_vertex(right_span, vertex_id)
        .and_then(|id| graph.vertices.get(id).map(|vertex| vertex.point))
    else {
        return false;
    };
    let Some(left_dir) = normalized_vector(vertex, left_other) else {
        return false;
    };
    let Some(right_dir) = normalized_vector(vertex, right_other) else {
        return false;
    };
    let dot = (left_dir.x * right_dir.x + left_dir.y * right_dir.y).clamp(-1.0, 1.0);
    let angle_from_straight = (std::f64::consts::PI - dot.acos()).abs();
    if angle_from_straight > options.pass_through_angle_tolerance_degrees.to_radians() {
        return false;
    }
    let rho_tol = options.endpoint_rho_tolerance_px / image_size.max(1) as f64;
    let carrier_delta = (left_span.carrier.rho - right_span.carrier.rho).abs();
    carrier_delta <= rho_tol || point_line_distance(vertex, left_span) <= rho_tol
}

fn assignments_compatible(left: AssignmentLabel, right: AssignmentLabel) -> bool {
    left == right || left == AssignmentLabel::Unknown || right == AssignmentLabel::Unknown
}

fn other_span_vertex(span: &CandidateCreaseSpan, vertex_id: usize) -> Option<usize> {
    if span.vertices[0] == vertex_id {
        Some(span.vertices[1])
    } else if span.vertices[1] == vertex_id {
        Some(span.vertices[0])
    } else {
        None
    }
}

fn normalized_vector(from: Point2, to: Point2) -> Option<Point2> {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let length = (dx * dx + dy * dy).sqrt();
    (length > 1e-9).then(|| Point2::new(dx / length, dy / length))
}

fn point_line_distance(point: Point2, span: &CandidateCreaseSpan) -> f64 {
    (point.x * span.carrier.normal.x + point.y * span.carrier.normal.y - span.carrier.rho).abs()
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct StructuralPathKey(Vec<usize>);

#[derive(Debug, Clone)]
struct StructuralPath {
    vertices: Vec<usize>,
    span_ids: Vec<usize>,
}

fn structural_paths(
    graph: &CandidateGraph,
    adjacency: &BTreeMap<usize, Vec<usize>>,
    pass_through_vertices: &BTreeSet<usize>,
    options: LegacyTopologyV2StrategyOptions,
) -> Vec<StructuralPath> {
    let mut seen = BTreeSet::<StructuralPathKey>::new();
    let mut paths = Vec::new();
    for (start_vertex, span_ids) in adjacency {
        if pass_through_vertices.contains(start_vertex) {
            continue;
        }
        for span_id in span_ids {
            let Some(path) = walk_structural_path(
                graph,
                adjacency,
                pass_through_vertices,
                *start_vertex,
                *span_id,
            ) else {
                continue;
            };
            if path.span_ids.len() < options.min_chain_spans {
                continue;
            }
            let mut key_ids = path.span_ids.clone();
            key_ids.sort_unstable();
            if !seen.insert(StructuralPathKey(key_ids)) {
                continue;
            }
            paths.push(path);
        }
    }
    paths
}

fn walk_structural_path(
    graph: &CandidateGraph,
    adjacency: &BTreeMap<usize, Vec<usize>>,
    pass_through_vertices: &BTreeSet<usize>,
    start_vertex: usize,
    first_span: usize,
) -> Option<StructuralPath> {
    let mut vertices = vec![start_vertex];
    let mut span_ids = Vec::new();
    let mut current_vertex = start_vertex;
    let mut current_span = first_span;
    let mut visited = BTreeSet::new();
    loop {
        if !visited.insert(current_span) {
            return None;
        }
        span_ids.push(current_span);
        let span = graph.crease_candidates.get(current_span)?;
        let next_vertex = other_span_vertex(span, current_vertex)?;
        vertices.push(next_vertex);
        if !pass_through_vertices.contains(&next_vertex) {
            break;
        }
        let incident = adjacency.get(&next_vertex)?;
        if incident.len() != 2 {
            break;
        }
        let next_span = if incident[0] == current_span {
            incident[1]
        } else {
            incident[0]
        };
        current_vertex = next_vertex;
        current_span = next_span;
    }
    Some(StructuralPath { vertices, span_ids })
}

fn structural_span_from_path(
    graph: &CandidateGraph,
    path: &StructuralPath,
    options: LegacyTopologyV2StrategyOptions,
) -> Option<CandidateCreaseSpan> {
    let start = *path.vertices.first()?;
    let end = *path.vertices.last()?;
    if start == end || path.span_ids.len() < options.min_chain_spans {
        return None;
    }
    if graph.crease_candidates.iter().any(|span| {
        span.vertices == [start, end]
            || span.vertices == [end, start]
            || span.replaced_span_ids == path.span_ids
    }) {
        return None;
    }
    let start_point = graph.vertices.get(start)?.point;
    let end_point = graph.vertices.get(end)?.point;
    let direction = normalized_vector(start_point, end_point)?;
    let normal = Point2::new(-direction.y, direction.x);
    let rho = normal.x * start_point.x + normal.y * start_point.y;
    let t0 = project(start_point, direction);
    let t1 = project(end_point, direction);
    let path_spans = path
        .span_ids
        .iter()
        .filter_map(|span_id| graph.crease_candidates.get(*span_id))
        .collect::<Vec<_>>();
    if path_spans.len() != path.span_ids.len() {
        return None;
    }
    let support = weighted_support(&path_spans, graph);
    if support.mean < options.min_structural_mean_support {
        return None;
    }
    let all_legacy_selected = path_spans
        .iter()
        .all(|span| span.source_kind == CandidateCreaseSourceKind::LegacySelected);
    let source_kind = if all_legacy_selected {
        CandidateCreaseSourceKind::LegacySelected
    } else {
        CandidateCreaseSourceKind::LegacyLowThreshold
    };
    let mut source_edge_ids = path_spans
        .iter()
        .flat_map(|span| {
            span.source_edge_ids
                .iter()
                .copied()
                .chain(std::iter::once(span.id))
        })
        .collect::<Vec<_>>();
    source_edge_ids.sort_unstable();
    source_edge_ids.dedup();
    let mut source_carrier_ids = path_spans
        .iter()
        .flat_map(|span| span.source_carrier_ids.iter().copied())
        .collect::<Vec<_>>();
    source_carrier_ids.sort_unstable();
    source_carrier_ids.dedup();
    let collapsed_vertex_ids = path.vertices[1..path.vertices.len() - 1].to_vec();
    Some(CandidateCreaseSpan {
        id: graph.crease_candidates.len(),
        kind: CandidateCreaseSpanKind::NormalizedPassThroughSpan,
        vertices: [start, end],
        carrier: oristudio_cp_compiler::candidate_graph::CandidateCarrierGeometry {
            normal,
            direction,
            rho,
        },
        t_interval: [t0.min(t1), t0.max(t1)],
        assignment_evidence: aggregate_assignment(&path_spans),
        presence_probability: support.presence_probability,
        line_support_min: support.min,
        line_support_mean: support.mean,
        line_support_max: support.max,
        style_support: support.style,
        non_crease_support: support.non_crease,
        source_kind,
        selection_policy: CandidateSelectionPolicy::WeakOptional,
        boundary_role: CandidateCreaseBoundaryRole::None,
        source_edge_ids,
        source_atomic_edge_ids: path.span_ids.clone(),
        source_carrier_ids,
        replaced_span_ids: path.span_ids.clone(),
        replaced_atomic_edge_ids: path.span_ids.clone(),
        collapsed_vertex_ids,
        provenance: Vec::new(),
        reasons: vec![format!(
            "legacy-topology-v2 structural pass-through candidate replacing {} fragment(s)",
            path.span_ids.len()
        )],
    })
}

fn project(point: Point2, direction: Point2) -> f64 {
    point.x * direction.x + point.y * direction.y
}

#[derive(Debug, Clone, Copy)]
struct SupportStats {
    min: f64,
    mean: f64,
    max: f64,
    style: f64,
    non_crease: f64,
    presence_probability: f64,
}

fn weighted_support(spans: &[&CandidateCreaseSpan], graph: &CandidateGraph) -> SupportStats {
    let mut min = f64::INFINITY;
    let mut max = 0.0_f64;
    let mut support_sum = 0.0;
    let mut style_sum = 0.0;
    let mut non_crease_sum = 0.0;
    let mut probability_sum = 0.0;
    let mut total_length = 0.0;
    for span in spans {
        let length = span_length(span, graph).max(1e-9);
        min = min.min(span.line_support_min);
        max = max.max(span.line_support_max);
        support_sum += span.line_support_mean * length;
        style_sum += span.style_support * length;
        non_crease_sum += span.non_crease_support * length;
        probability_sum += span.presence_probability * length;
        total_length += length;
    }
    let total = total_length.max(1e-9);
    SupportStats {
        min: min.min(support_sum / total).clamp(0.0, 1.0),
        mean: (support_sum / total).clamp(0.0, 1.0),
        max: max.clamp(0.0, 1.0),
        style: (style_sum / total).clamp(0.0, 1.0),
        non_crease: (non_crease_sum / total).clamp(0.0, 1.0),
        presence_probability: (probability_sum / total).clamp(0.01, 0.97),
    }
}

fn span_length(span: &CandidateCreaseSpan, graph: &CandidateGraph) -> f64 {
    let Some(a) = graph
        .vertices
        .get(span.vertices[0])
        .map(|vertex| vertex.point)
    else {
        return 0.0;
    };
    let Some(b) = graph
        .vertices
        .get(span.vertices[1])
        .map(|vertex| vertex.point)
    else {
        return 0.0;
    };
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn aggregate_assignment(spans: &[&CandidateCreaseSpan]) -> AssignmentEvidence {
    let mut totals = [0.0_f64; 5];
    let mut best = spans
        .first()
        .map(|span| span.assignment_evidence)
        .unwrap_or(AssignmentEvidence {
            mountain: 0.01,
            valley: 0.01,
            boundary: 0.01,
            auxiliary: 0.01,
            unknown: 0.96,
            observed_label: AssignmentLabel::Unknown,
            source: AssignmentEvidenceSource::SpanAggregate,
            confidence: 0.0,
            margin: 0.0,
            ink_label: None,
        });
    for span in spans {
        let label = span.assignment_evidence.observed_label;
        let weight = span.assignment_evidence.confidence.max(0.05);
        totals[assignment_index(label)] += weight;
        if span.assignment_evidence.confidence > best.confidence {
            best = span.assignment_evidence;
        }
    }
    let label = totals
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(right.1))
        .map(|(index, _)| assignment_from_index(index))
        .unwrap_or(AssignmentLabel::Unknown);
    best.observed_label = label;
    best.source = AssignmentEvidenceSource::SpanAggregate;
    best
}

fn assignment_index(label: AssignmentLabel) -> usize {
    match label {
        AssignmentLabel::Mountain => 0,
        AssignmentLabel::Valley => 1,
        AssignmentLabel::Boundary => 2,
        AssignmentLabel::Flat => 3,
        AssignmentLabel::Unknown => 4,
    }
}

fn assignment_from_index(index: usize) -> AssignmentLabel {
    match index {
        0 => AssignmentLabel::Mountain,
        1 => AssignmentLabel::Valley,
        2 => AssignmentLabel::Boundary,
        3 => AssignmentLabel::Flat,
        _ => AssignmentLabel::Unknown,
    }
}

fn refresh_graph_metadata(graph: &mut CandidateGraph) {
    assign_span_ids(&mut graph.crease_candidates);
    graph.conflicts = generate_conflicts(graph);
    graph.alternatives = graph.conflicts.clone();
    graph.report = candidate_graph_report(graph);
}

fn assign_span_ids(spans: &mut [CandidateCreaseSpan]) {
    for (id, span) in spans.iter_mut().enumerate() {
        span.id = id;
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
    for span in &graph.crease_candidates {
        if span.replaced_span_ids.is_empty() && span.replaced_atomic_edge_ids.is_empty() {
            continue;
        }
        let mut ids = vec![span.id];
        ids.extend(span.replaced_span_ids.iter().copied());
        ids.extend(span.replaced_atomic_edge_ids.iter().copied());
        ids.sort_unstable();
        ids.dedup();
        if ids.len() > 1 {
            conflicts.push(CandidateConflict {
                id: conflicts.len(),
                kind: CandidateConflictKind::SpanReplacesFragments,
                candidate_ids: ids,
                hard: true,
                reason: "long candidate span replaces fragment chain".to_owned(),
            });
        }
    }
    conflicts
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct SpanKey {
    a: (i64, i64),
    b: (i64, i64),
}

fn span_endpoint_key(graph: &CandidateGraph, endpoints: [usize; 2], tolerance: f64) -> SpanKey {
    let scale = (1.0 / tolerance.max(1e-9)).round();
    let mut points = endpoints.map(|id| {
        let point = graph
            .vertices
            .get(id)
            .map(|vertex| vertex.point)
            .unwrap_or(Point2::new(0.0, 0.0));
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

fn candidate_graph_report(graph: &CandidateGraph) -> CandidateGraphReport {
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
        arrangement_observed_spans: 0,
        arrangement_shared_spans: 0,
        conflicts: graph.conflicts.len(),
    }
}

#[allow(dead_code)]
fn _boundary_side_order(side: BoundarySide) -> usize {
    match side {
        BoundarySide::Top => 0,
        BoundarySide::Right => 1,
        BoundarySide::Bottom => 2,
        BoundarySide::Left => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oristudio_cp_compiler::candidate_graph::{
        BoundaryModel, BoundaryReconstructionPolicy, BoundarySideModel, CandidateCarrierGeometry,
        CandidateGraphProvenance, CandidateVertex, CandidateVertexMovementPolicy,
    };
    use oristudio_cp_compiler::{CandidateSourceAdapter, CostModel};

    #[test]
    fn adds_structural_span_for_collinear_degree_two_chain() {
        let mut graph = simple_chain_graph();
        add_structural_topology_candidates(
            &mut graph,
            1000,
            LegacyTopologyV2StrategyOptions::default(),
        );
        let structural = graph
            .crease_candidates
            .iter()
            .find(|span| span.kind == CandidateCreaseSpanKind::NormalizedPassThroughSpan)
            .expect("structural span");
        assert_eq!(structural.vertices, [0, 3]);
        assert_eq!(
            structural.selection_policy,
            CandidateSelectionPolicy::WeakOptional
        );
        assert_eq!(structural.replaced_span_ids, vec![0, 1, 2]);
        assert_eq!(structural.collapsed_vertex_ids, vec![1, 2]);
        assert!(
            graph.crease_candidates[0..3]
                .iter()
                .all(|span| { span.selection_policy == CandidateSelectionPolicy::StrongOptional })
        );
        assert!(graph.conflicts.iter().any(|conflict| {
            conflict.kind == CandidateConflictKind::SpanReplacesFragments
                && conflict.candidate_ids.contains(&structural.id)
                && conflict.candidate_ids.contains(&0)
                && conflict.candidate_ids.contains(&1)
                && conflict.candidate_ids.contains(&2)
        }));
    }

    #[test]
    fn does_not_collapse_through_weak_branch_junction() {
        let mut graph = simple_chain_graph();
        graph.vertices.push(vertex(4, 0.3, 0.8));
        let mut branch = span(3, [1, 4]);
        branch.selection_policy = CandidateSelectionPolicy::WeakOptional;
        branch.carrier = CandidateCarrierGeometry {
            normal: Point2::new(1.0, 0.0),
            direction: Point2::new(0.0, 1.0),
            rho: 0.3,
        };
        graph.crease_candidates.push(branch);
        assign_span_ids(&mut graph.crease_candidates);

        add_structural_topology_candidates(
            &mut graph,
            1000,
            LegacyTopologyV2StrategyOptions::default(),
        );

        assert!(!graph.crease_candidates.iter().any(|span| {
            span.kind == CandidateCreaseSpanKind::NormalizedPassThroughSpan
                && span.vertices == [0, 3]
        }));
        assert_eq!(
            graph.crease_candidates[0].selection_policy,
            CandidateSelectionPolicy::StrongOptional
        );
    }

    fn simple_chain_graph() -> CandidateGraph {
        let vertices = vec![
            vertex(0, 0.1, 0.5),
            vertex(1, 0.3, 0.5),
            vertex(2, 0.6, 0.5),
            vertex(3, 0.9, 0.5),
        ];
        let mut spans = vec![span(0, [0, 1]), span(1, [1, 2]), span(2, [2, 3])];
        assign_span_ids(&mut spans);
        CandidateGraph {
            schema: "test".to_owned(),
            coordinate_space: "unit_square".to_owned(),
            image_size: Some(1000),
            vertices,
            crease_candidates: spans,
            boundary: BoundaryModel {
                corners: [0, 0, 0, 0],
                sides: vec![BoundarySideModel {
                    side: BoundarySide::Top,
                    corner_vertices: [0, 0],
                    contact_vertices: Vec::new(),
                }],
                generated_border_span_ids: Vec::new(),
                reconstruction_policy: BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts,
            },
            conflicts: Vec::new(),
            alternatives: Vec::new(),
            cost_model: CostModel::default(),
            provenance: CandidateGraphProvenance {
                source_adapter: CandidateSourceAdapter::Legacy,
                source_ids: Vec::new(),
                notes: Vec::new(),
            },
            report: CandidateGraphReport {
                vertices: 4,
                crease_candidates: 3,
                locked_border_spans: 0,
                legacy_selected_spans: 3,
                legacy_low_threshold_spans: 0,
                arrangement_observed_spans: 0,
                arrangement_shared_spans: 0,
                conflicts: 0,
            },
        }
    }

    fn vertex(id: usize, x: f64, y: f64) -> CandidateVertex {
        CandidateVertex {
            id,
            point: Point2::new(x, y),
            kind: CandidateVertexKind::InteriorJunction,
            support: 0.9,
            movement_policy: CandidateVertexMovementPolicy::Movable,
            boundary_side: None,
            source_vertex_ids: vec![id],
            source_carrier_ids: Vec::new(),
            source_adapter: CandidateSourceAdapter::Legacy,
            provenance: Vec::new(),
        }
    }

    fn span(id: usize, vertices: [usize; 2]) -> CandidateCreaseSpan {
        CandidateCreaseSpan {
            id,
            kind: CandidateCreaseSpanKind::AtomicInterval,
            vertices,
            carrier: CandidateCarrierGeometry {
                normal: Point2::new(0.0, 1.0),
                direction: Point2::new(1.0, 0.0),
                rho: 0.5,
            },
            t_interval: [0.0, 1.0],
            assignment_evidence: AssignmentEvidence {
                mountain: 0.9,
                valley: 0.03,
                boundary: 0.02,
                auxiliary: 0.02,
                unknown: 0.03,
                observed_label: AssignmentLabel::Mountain,
                source: AssignmentEvidenceSource::LegacyColor,
                confidence: 0.9,
                margin: 0.7,
                ink_label: None,
            },
            presence_probability: 0.94,
            line_support_min: 0.85,
            line_support_mean: 0.9,
            line_support_max: 0.95,
            style_support: 0.0,
            non_crease_support: 0.0,
            source_kind: CandidateCreaseSourceKind::LegacySelected,
            selection_policy: CandidateSelectionPolicy::StrongOptional,
            boundary_role: CandidateCreaseBoundaryRole::None,
            source_edge_ids: vec![id],
            source_atomic_edge_ids: vec![id],
            source_carrier_ids: vec![0],
            replaced_span_ids: Vec::new(),
            replaced_atomic_edge_ids: Vec::new(),
            collapsed_vertex_ids: Vec::new(),
            provenance: Vec::new(),
            reasons: Vec::new(),
        }
    }
}
