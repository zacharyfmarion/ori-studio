use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{EvalAssignment, EvalBoundaryRole, EvalEdge, EvalGraph, EvalPoint};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct StrictTopologyOptions {
    pub vertex_tolerance: f64,
    pub split_merge_tolerance: f64,
    pub compare_assignments: bool,
}

impl Default for StrictTopologyOptions {
    fn default() -> Self {
        Self {
            vertex_tolerance: 2.0,
            split_merge_tolerance: 2.0,
            compare_assignments: true,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct StrictTopologyMetrics {
    pub vertex_tolerance: f64,
    pub split_merge_tolerance: f64,
    pub exact_topology: bool,
    pub exact_topology_and_assignment: bool,
    pub vertices: VertexMatchMetrics,
    pub edges: EdgeMatchMetrics,
    pub assignments: AssignmentMatchMetrics,
    pub missing_edges: Vec<EdgeDiagnostic>,
    pub extra_edges: Vec<EdgeDiagnostic>,
    pub wrong_assignments: Vec<AssignmentMismatchDiagnostic>,
    pub split_edges: Vec<SplitEdgeDiagnostic>,
    pub merged_edges: Vec<MergedEdgeDiagnostic>,
}

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct VertexMatchMetrics {
    pub gt_vertices: usize,
    pub predicted_vertices: usize,
    pub matched_vertices: usize,
    pub unmatched_gt_vertices: usize,
    pub unmatched_predicted_vertices: usize,
    pub precision: f64,
    pub recall: f64,
    pub f1: f64,
    pub mean_error: f64,
    pub max_error: f64,
}

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct EdgeMatchMetrics {
    pub gt_edges: usize,
    pub predicted_edges: usize,
    pub matched_edges: usize,
    pub missing_edges: usize,
    pub extra_edges: usize,
    pub precision: f64,
    pub recall: f64,
    pub f1: f64,
}

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct AssignmentMatchMetrics {
    pub checked_edges: usize,
    pub correct_edges: usize,
    pub wrong_edges: usize,
    pub accuracy: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeDiagnostic {
    pub edge_index: usize,
    pub vertices: [usize; 2],
    pub assignment: EvalAssignment,
    pub boundary_role: EvalBoundaryRole,
    pub mapped_gt_vertices: Option<[usize; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignmentMismatchDiagnostic {
    pub gt_edge_index: usize,
    pub predicted_edge_index: usize,
    pub vertices: [usize; 2],
    pub gt_assignment: EvalAssignment,
    pub predicted_assignment: EvalAssignment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitEdgeDiagnostic {
    pub gt_edge_index: usize,
    pub gt_vertices: [usize; 2],
    pub predicted_edge_indices: Vec<usize>,
    pub intermediate_predicted_vertices: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedEdgeDiagnostic {
    pub predicted_edge_index: usize,
    pub predicted_vertices: [usize; 2],
    pub gt_edge_indices: Vec<usize>,
    pub intermediate_gt_vertices: Vec<usize>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct StrictTopologyAggregate {
    pub samples: usize,
    pub exact_topology_samples: usize,
    pub exact_topology_and_assignment_samples: usize,
    pub vertices: VertexMatchMetrics,
    pub edges: EdgeMatchMetrics,
    pub assignments: AssignmentMatchMetrics,
    pub split_edges: usize,
    pub merged_edges: usize,
    #[serde(skip)]
    vertex_error_sum: f64,
}

impl StrictTopologyAggregate {
    pub fn add(&mut self, metrics: &StrictTopologyMetrics) {
        self.samples += 1;
        self.exact_topology_samples += usize::from(metrics.exact_topology);
        self.exact_topology_and_assignment_samples +=
            usize::from(metrics.exact_topology_and_assignment);

        self.vertices.gt_vertices += metrics.vertices.gt_vertices;
        self.vertices.predicted_vertices += metrics.vertices.predicted_vertices;
        self.vertices.matched_vertices += metrics.vertices.matched_vertices;
        self.vertices.unmatched_gt_vertices += metrics.vertices.unmatched_gt_vertices;
        self.vertices.unmatched_predicted_vertices += metrics.vertices.unmatched_predicted_vertices;
        self.vertex_error_sum +=
            metrics.vertices.mean_error * metrics.vertices.matched_vertices as f64;
        self.vertices.max_error = self.vertices.max_error.max(metrics.vertices.max_error);

        self.edges.gt_edges += metrics.edges.gt_edges;
        self.edges.predicted_edges += metrics.edges.predicted_edges;
        self.edges.matched_edges += metrics.edges.matched_edges;
        self.edges.missing_edges += metrics.edges.missing_edges;
        self.edges.extra_edges += metrics.edges.extra_edges;

        self.assignments.checked_edges += metrics.assignments.checked_edges;
        self.assignments.correct_edges += metrics.assignments.correct_edges;
        self.assignments.wrong_edges += metrics.assignments.wrong_edges;

        self.split_edges += metrics.split_edges.len();
        self.merged_edges += metrics.merged_edges.len();
        self.finalize();
    }

    pub fn finalize(&mut self) {
        self.vertices.precision = ratio(
            self.vertices.matched_vertices,
            self.vertices.predicted_vertices,
        );
        self.vertices.recall = ratio(self.vertices.matched_vertices, self.vertices.gt_vertices);
        self.vertices.f1 = f1(self.vertices.precision, self.vertices.recall);
        if self.vertices.matched_vertices > 0 {
            self.vertices.mean_error =
                self.vertex_error_sum / self.vertices.matched_vertices as f64;
        } else {
            self.vertices.mean_error = 0.0;
        }

        self.edges.precision = ratio(self.edges.matched_edges, self.edges.predicted_edges);
        self.edges.recall = ratio(self.edges.matched_edges, self.edges.gt_edges);
        self.edges.f1 = f1(self.edges.precision, self.edges.recall);
        self.assignments.accuracy = ratio(
            self.assignments.correct_edges,
            self.assignments.checked_edges,
        );
    }
}

pub fn strict_topology_metrics(
    predicted: &EvalGraph,
    ground_truth: &EvalGraph,
    options: StrictTopologyOptions,
) -> StrictTopologyMetrics {
    // Compare planar-normalized graphs so a straight crease split at a shared
    // junction (most visibly the paper border, which ground truth keeps
    // corner-to-corner while the detector splits it at every boundary-contact
    // point) is not counted as a topology difference. A split point present in
    // only one graph is not shared, so it still surfaces as a genuine vertex/edge
    // difference.
    let predicted = &canonicalize_segmentation(predicted, options.split_merge_tolerance);
    let ground_truth = &canonicalize_segmentation(ground_truth, options.split_merge_tolerance);
    let matching = match_vertices(
        &predicted.vertices,
        &ground_truth.vertices,
        options.vertex_tolerance,
    );
    let vertices = vertex_metrics(predicted, ground_truth, &matching);
    let edge_match = match_edges(
        predicted,
        ground_truth,
        &matching,
        options.compare_assignments,
    );
    let split_edges = split_edge_diagnostics(
        predicted,
        ground_truth,
        &edge_match.missing_edges,
        &edge_match.extra_edges,
        options.split_merge_tolerance,
    );
    let merged_edges = merged_edge_diagnostics(
        predicted,
        ground_truth,
        &edge_match.missing_edges,
        &edge_match.extra_edges,
        &matching,
        options.split_merge_tolerance,
    );
    let exact_topology = vertices.unmatched_gt_vertices == 0
        && vertices.unmatched_predicted_vertices == 0
        && edge_match.edges.missing_edges == 0
        && edge_match.edges.extra_edges == 0;
    let exact_topology_and_assignment =
        exact_topology && (!options.compare_assignments || edge_match.assignments.wrong_edges == 0);

    StrictTopologyMetrics {
        vertex_tolerance: options.vertex_tolerance,
        split_merge_tolerance: options.split_merge_tolerance,
        exact_topology,
        exact_topology_and_assignment,
        vertices,
        edges: edge_match.edges,
        assignments: edge_match.assignments,
        missing_edges: edge_match.missing_edges,
        extra_edges: edge_match.extra_edges,
        wrong_assignments: edge_match.wrong_assignments,
        split_edges,
        merged_edges,
    }
}

#[derive(Debug)]
struct VertexMatching {
    gt_to_pred: Vec<Option<usize>>,
    pred_to_gt: Vec<Option<usize>>,
    distances: Vec<f64>,
}

fn match_vertices(
    predicted: &[EvalPoint],
    ground_truth: &[EvalPoint],
    tolerance: f64,
) -> VertexMatching {
    let mut candidates = vec![Vec::<(usize, f64)>::new(); ground_truth.len()];
    for (gt_index, gt) in ground_truth.iter().enumerate() {
        for (pred_index, pred) in predicted.iter().enumerate() {
            let distance = point_distance(*gt, *pred);
            if distance <= tolerance {
                candidates[gt_index].push((pred_index, distance));
            }
        }
        candidates[gt_index].sort_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| left.0.cmp(&right.0))
        });
    }

    let mut order = (0..ground_truth.len()).collect::<Vec<_>>();
    order.sort_by_key(|gt_index| candidates[*gt_index].len());
    let mut pred_to_gt = vec![None; predicted.len()];
    for gt_index in order {
        let mut seen_pred = vec![false; predicted.len()];
        augment_match(gt_index, &candidates, &mut pred_to_gt, &mut seen_pred);
    }

    let mut gt_to_pred = vec![None; ground_truth.len()];
    for (pred_index, gt_index) in pred_to_gt.iter().enumerate() {
        if let Some(gt_index) = gt_index {
            gt_to_pred[*gt_index] = Some(pred_index);
        }
    }
    let distances = gt_to_pred
        .iter()
        .enumerate()
        .filter_map(|(gt_index, pred_index)| {
            pred_index
                .map(|pred_index| point_distance(ground_truth[gt_index], predicted[pred_index]))
        })
        .collect();

    VertexMatching {
        gt_to_pred,
        pred_to_gt,
        distances,
    }
}

fn augment_match(
    gt_index: usize,
    candidates: &[Vec<(usize, f64)>],
    pred_to_gt: &mut [Option<usize>],
    seen_pred: &mut [bool],
) -> bool {
    for (pred_index, _) in &candidates[gt_index] {
        if seen_pred[*pred_index] {
            continue;
        }
        seen_pred[*pred_index] = true;
        if pred_to_gt[*pred_index].is_none()
            || augment_match(
                pred_to_gt[*pred_index].unwrap(),
                candidates,
                pred_to_gt,
                seen_pred,
            )
        {
            pred_to_gt[*pred_index] = Some(gt_index);
            return true;
        }
    }
    false
}

fn vertex_metrics(
    predicted: &EvalGraph,
    ground_truth: &EvalGraph,
    matching: &VertexMatching,
) -> VertexMatchMetrics {
    let matched_vertices = matching
        .gt_to_pred
        .iter()
        .filter(|item| item.is_some())
        .count();
    let mean_error = if matching.distances.is_empty() {
        0.0
    } else {
        matching.distances.iter().sum::<f64>() / matching.distances.len() as f64
    };
    let max_error = matching.distances.iter().copied().fold(0.0, f64::max);
    let precision = ratio(matched_vertices, predicted.vertices.len());
    let recall = ratio(matched_vertices, ground_truth.vertices.len());
    VertexMatchMetrics {
        gt_vertices: ground_truth.vertices.len(),
        predicted_vertices: predicted.vertices.len(),
        matched_vertices,
        unmatched_gt_vertices: ground_truth.vertices.len().saturating_sub(matched_vertices),
        unmatched_predicted_vertices: predicted.vertices.len().saturating_sub(matched_vertices),
        precision,
        recall,
        f1: f1(precision, recall),
        mean_error,
        max_error,
    }
}

struct EdgeMatch {
    edges: EdgeMatchMetrics,
    assignments: AssignmentMatchMetrics,
    missing_edges: Vec<EdgeDiagnostic>,
    extra_edges: Vec<EdgeDiagnostic>,
    wrong_assignments: Vec<AssignmentMismatchDiagnostic>,
}

fn match_edges(
    predicted: &EvalGraph,
    ground_truth: &EvalGraph,
    matching: &VertexMatching,
    compare_assignments: bool,
) -> EdgeMatch {
    let mut gt_by_key = BTreeMap::<[usize; 2], Vec<usize>>::new();
    for (gt_index, edge) in ground_truth.edges.iter().enumerate() {
        gt_by_key
            .entry(canonical_edge(edge.vertices))
            .or_default()
            .push(gt_index);
    }

    let mut matched_gt = vec![false; ground_truth.edges.len()];
    let mut matched_edges = 0;
    let mut extra_edges = Vec::new();
    let mut wrong_assignments = Vec::new();
    let mut assignments = AssignmentMatchMetrics::default();

    for (pred_index, pred_edge) in predicted.edges.iter().enumerate() {
        let mapped_gt_vertices = mapped_predicted_edge(pred_edge, matching);
        let Some(mapped_vertices) = mapped_gt_vertices else {
            extra_edges.push(edge_diagnostic(pred_index, pred_edge, None));
            continue;
        };
        let key = canonical_edge(mapped_vertices);
        let Some(gt_indices) = gt_by_key.get(&key) else {
            extra_edges.push(edge_diagnostic(pred_index, pred_edge, Some(key)));
            continue;
        };
        let Some(gt_index) = gt_indices.iter().copied().find(|index| !matched_gt[*index]) else {
            extra_edges.push(edge_diagnostic(pred_index, pred_edge, Some(key)));
            continue;
        };
        matched_gt[gt_index] = true;
        matched_edges += 1;
        if compare_assignments {
            assignments.checked_edges += 1;
            let gt_edge = &ground_truth.edges[gt_index];
            if pred_edge.assignment == gt_edge.assignment {
                assignments.correct_edges += 1;
            } else {
                assignments.wrong_edges += 1;
                wrong_assignments.push(AssignmentMismatchDiagnostic {
                    gt_edge_index: gt_index,
                    predicted_edge_index: pred_index,
                    vertices: key,
                    gt_assignment: gt_edge.assignment,
                    predicted_assignment: pred_edge.assignment,
                });
            }
        }
    }

    let missing_edges = ground_truth
        .edges
        .iter()
        .enumerate()
        .filter(|(index, _)| !matched_gt[*index])
        .map(|(index, edge)| edge_diagnostic(index, edge, None))
        .collect::<Vec<_>>();
    let precision = ratio(matched_edges, predicted.edges.len());
    let recall = ratio(matched_edges, ground_truth.edges.len());
    assignments.accuracy = ratio(assignments.correct_edges, assignments.checked_edges);
    EdgeMatch {
        edges: EdgeMatchMetrics {
            gt_edges: ground_truth.edges.len(),
            predicted_edges: predicted.edges.len(),
            matched_edges,
            missing_edges: missing_edges.len(),
            extra_edges: extra_edges.len(),
            precision,
            recall,
            f1: f1(precision, recall),
        },
        assignments,
        missing_edges,
        extra_edges,
        wrong_assignments,
    }
}

fn mapped_predicted_edge(edge: &EvalEdge, matching: &VertexMatching) -> Option<[usize; 2]> {
    let a = matching
        .pred_to_gt
        .get(edge.vertices[0])
        .copied()
        .flatten()?;
    let b = matching
        .pred_to_gt
        .get(edge.vertices[1])
        .copied()
        .flatten()?;
    (a != b).then_some([a, b])
}

fn edge_diagnostic(
    edge_index: usize,
    edge: &EvalEdge,
    mapped_gt_vertices: Option<[usize; 2]>,
) -> EdgeDiagnostic {
    EdgeDiagnostic {
        edge_index,
        vertices: edge.vertices,
        assignment: edge.assignment,
        boundary_role: edge.boundary_role,
        mapped_gt_vertices: mapped_gt_vertices.map(canonical_edge),
    }
}

fn split_edge_diagnostics(
    predicted: &EvalGraph,
    ground_truth: &EvalGraph,
    missing_edges: &[EdgeDiagnostic],
    extra_edges: &[EdgeDiagnostic],
    tolerance: f64,
) -> Vec<SplitEdgeDiagnostic> {
    let mut diagnostics = Vec::new();
    for missing in missing_edges {
        let Some(gt_edge) = ground_truth.edges.get(missing.edge_index) else {
            continue;
        };
        let Some(a) = ground_truth.vertices.get(gt_edge.vertices[0]).copied() else {
            continue;
        };
        let Some(b) = ground_truth.vertices.get(gt_edge.vertices[1]).copied() else {
            continue;
        };
        let mut predicted_edge_indices = Vec::new();
        let mut intermediate_vertices = Vec::new();
        let mut touches_start = false;
        let mut touches_end = false;
        for extra in extra_edges {
            let Some(edge) = predicted.edges.get(extra.edge_index) else {
                continue;
            };
            let Some(p0) = predicted.vertices.get(edge.vertices[0]).copied() else {
                continue;
            };
            let Some(p1) = predicted.vertices.get(edge.vertices[1]).copied() else {
                continue;
            };
            if !point_on_segment(p0, a, b, tolerance) || !point_on_segment(p1, a, b, tolerance) {
                continue;
            }
            predicted_edge_indices.push(extra.edge_index);
            for vertex_id in edge.vertices {
                let point = predicted.vertices[vertex_id];
                if point_distance(point, a) <= tolerance {
                    touches_start = true;
                } else if point_distance(point, b) <= tolerance {
                    touches_end = true;
                } else if !intermediate_vertices.contains(&vertex_id) {
                    intermediate_vertices.push(vertex_id);
                }
            }
        }
        if predicted_edge_indices.len() >= 2 && touches_start && touches_end {
            diagnostics.push(SplitEdgeDiagnostic {
                gt_edge_index: missing.edge_index,
                gt_vertices: gt_edge.vertices,
                predicted_edge_indices,
                intermediate_predicted_vertices: intermediate_vertices,
            });
        }
    }
    diagnostics
}

fn merged_edge_diagnostics(
    predicted: &EvalGraph,
    ground_truth: &EvalGraph,
    missing_edges: &[EdgeDiagnostic],
    extra_edges: &[EdgeDiagnostic],
    matching: &VertexMatching,
    tolerance: f64,
) -> Vec<MergedEdgeDiagnostic> {
    let mut diagnostics = Vec::new();
    for extra in extra_edges {
        let Some(pred_edge) = predicted.edges.get(extra.edge_index) else {
            continue;
        };
        let Some(mapped_vertices) = mapped_predicted_edge(pred_edge, matching) else {
            continue;
        };
        let Some(a) = predicted.vertices.get(pred_edge.vertices[0]).copied() else {
            continue;
        };
        let Some(b) = predicted.vertices.get(pred_edge.vertices[1]).copied() else {
            continue;
        };
        let mut gt_edge_indices = Vec::new();
        for missing in missing_edges {
            let Some(gt_edge) = ground_truth.edges.get(missing.edge_index) else {
                continue;
            };
            let Some(g0) = ground_truth.vertices.get(gt_edge.vertices[0]).copied() else {
                continue;
            };
            let Some(g1) = ground_truth.vertices.get(gt_edge.vertices[1]).copied() else {
                continue;
            };
            if point_on_segment(g0, a, b, tolerance) && point_on_segment(g1, a, b, tolerance) {
                gt_edge_indices.push(missing.edge_index);
            }
        }
        if gt_edge_indices.len() < 2 {
            continue;
        }
        let mut intermediate_gt_vertices = Vec::new();
        for (gt_vertex_id, point) in ground_truth.vertices.iter().enumerate() {
            if mapped_vertices.contains(&gt_vertex_id) {
                continue;
            }
            if point_on_segment(*point, a, b, tolerance) {
                intermediate_gt_vertices.push(gt_vertex_id);
            }
        }
        diagnostics.push(MergedEdgeDiagnostic {
            predicted_edge_index: extra.edge_index,
            predicted_vertices: pred_edge.vertices,
            gt_edge_indices,
            intermediate_gt_vertices,
        });
    }
    diagnostics
}

fn canonical_edge(edge: [usize; 2]) -> [usize; 2] {
    if edge[0] <= edge[1] {
        edge
    } else {
        [edge[1], edge[0]]
    }
}

fn point_on_segment(point: EvalPoint, a: EvalPoint, b: EvalPoint, tolerance: f64) -> bool {
    let ab = [b.x - a.x, b.y - a.y];
    let ap = [point.x - a.x, point.y - a.y];
    let length_sq = ab[0] * ab[0] + ab[1] * ab[1];
    if length_sq <= f64::EPSILON {
        return point_distance(point, a) <= tolerance;
    }
    let t = (ap[0] * ab[0] + ap[1] * ab[1]) / length_sq;
    let slack = tolerance / length_sq.sqrt().max(tolerance);
    if t < -slack || t > 1.0 + slack {
        return false;
    }
    let projected = EvalPoint {
        x: a.x + t * ab[0],
        y: a.y + t * ab[1],
    };
    point_distance(point, projected) <= tolerance
}

fn point_distance(left: EvalPoint, right: EvalPoint) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
}

/// If `point` lies on the interior of segment `a`->`b` (within `tolerance`
/// perpendicular distance and strictly between the endpoints, leaving a
/// tolerance-sized margin), return its parameter `t` in (0, 1) along the segment.
fn interior_param_on_segment(
    point: EvalPoint,
    a: EvalPoint,
    b: EvalPoint,
    tolerance: f64,
) -> Option<f64> {
    let ab = [b.x - a.x, b.y - a.y];
    let length_sq = ab[0] * ab[0] + ab[1] * ab[1];
    if length_sq <= f64::EPSILON {
        return None;
    }
    let length = length_sq.sqrt();
    let ap = [point.x - a.x, point.y - a.y];
    let t = (ap[0] * ab[0] + ap[1] * ab[1]) / length_sq;
    let margin = (tolerance / length).min(0.5);
    if t <= margin || t >= 1.0 - margin {
        return None;
    }
    let projected = EvalPoint {
        x: a.x + t * ab[0],
        y: a.y + t * ab[1],
    };
    if point_distance(point, projected) <= tolerance {
        Some(t)
    } else {
        None
    }
}

/// Normalize a graph to its planar segmentation: every edge is subdivided at any
/// vertex of the *same* graph lying on its interior. Crease-pattern producers
/// disagree on whether a straight crease that passes through a junction is stored
/// as one edge or as the collinear segments either side of it; canonicalizing
/// both graphs the same way before matching makes the topology comparison reflect
/// real structural differences instead of this representation choice.
fn canonicalize_segmentation(graph: &EvalGraph, tolerance: f64) -> EvalGraph {
    let mut edges: Vec<EvalEdge> = Vec::with_capacity(graph.edges.len());
    let mut seen: BTreeSet<[usize; 2]> = BTreeSet::new();
    for edge in &graph.edges {
        let [start, end] = edge.vertices;
        let (Some(a), Some(b)) = (
            graph.vertices.get(start).copied(),
            graph.vertices.get(end).copied(),
        ) else {
            push_unique_edge(&mut edges, &mut seen, edge.clone());
            continue;
        };
        let mut interior: Vec<(usize, f64)> = Vec::new();
        for (index, vertex) in graph.vertices.iter().enumerate() {
            if index == start || index == end {
                continue;
            }
            if let Some(t) = interior_param_on_segment(*vertex, a, b, tolerance) {
                interior.push((index, t));
            }
        }
        if interior.is_empty() {
            push_unique_edge(&mut edges, &mut seen, edge.clone());
            continue;
        }
        interior.sort_by(|left, right| left.1.total_cmp(&right.1));
        let mut chain = Vec::with_capacity(interior.len() + 2);
        chain.push(start);
        chain.extend(interior.iter().map(|(index, _)| *index));
        chain.push(end);
        for window in chain.windows(2) {
            let mut segment = edge.clone();
            segment.vertices = [window[0], window[1]];
            push_unique_edge(&mut edges, &mut seen, segment);
        }
    }
    let split = EvalGraph::new(graph.vertices.clone(), edges);
    dissolve_collinear_degree_two(&split, tolerance)
}

/// The merge counterpart to the split pass in [`canonicalize_segmentation`]:
/// collapse a degree-2 vertex whose two incident edges are collinear and share an
/// assignment and boundary role. Such a vertex is a redundant split point on an
/// otherwise straight crease — most often an interior node one producer leaves on
/// the paper border that the other dissolves — and carries no foldability meaning,
/// so removing it lets the two halves merge into the single segment the other graph
/// stores. Iterating collapses whole collinear chains; genuine junctions
/// (degree != 2) and assignment changes are left intact, so real structural
/// differences still surface as vertex/edge mismatches.
fn dissolve_collinear_degree_two(graph: &EvalGraph, tolerance: f64) -> EvalGraph {
    let vertices = graph.vertices.clone();
    let mut edges = graph.edges.clone();
    let mut dissolved = vec![false; vertices.len()];
    loop {
        let mut incident: Vec<Vec<usize>> = vec![Vec::new(); vertices.len()];
        for (edge_index, edge) in edges.iter().enumerate() {
            incident[edge.vertices[0]].push(edge_index);
            incident[edge.vertices[1]].push(edge_index);
        }
        let mut collapse: Option<(usize, usize, Option<EvalEdge>)> = None;
        for (vertex, inc) in incident.iter().enumerate() {
            if inc.len() != 2 {
                continue;
            }
            let (first, second) = (inc[0], inc[1]);
            let edge_a = &edges[first];
            let edge_b = &edges[second];
            if edge_a.assignment != edge_b.assignment
                || edge_a.boundary_role != edge_b.boundary_role
            {
                continue;
            }
            let left = other_endpoint(edge_a, vertex);
            let right = other_endpoint(edge_b, vertex);
            if left == right {
                // The two edges share both endpoints; collapsing would self-loop.
                continue;
            }
            if interior_param_on_segment(
                vertices[vertex],
                vertices[left],
                vertices[right],
                tolerance,
            )
            .is_none()
            {
                // Not collinear within tolerance: a genuine corner, keep it.
                continue;
            }
            let already_present = edges.iter().enumerate().any(|(edge_index, edge)| {
                edge_index != first
                    && edge_index != second
                    && canonical_edge(edge.vertices) == canonical_edge([left, right])
            });
            let merged = if already_present {
                None
            } else {
                let mut merged = edge_a.clone();
                merged.vertices = [left, right];
                merged.source_id = None;
                Some(merged)
            };
            collapse = Some((first, second, merged));
            dissolved[vertex] = true;
            break;
        }
        let Some((first, second, merged)) = collapse else {
            break;
        };
        let mut next = Vec::with_capacity(edges.len());
        for (edge_index, edge) in edges.iter().enumerate() {
            if edge_index == first || edge_index == second {
                continue;
            }
            next.push(edge.clone());
        }
        if let Some(edge) = merged {
            next.push(edge);
        }
        edges = next;
    }
    if !dissolved.iter().any(|&flag| flag) {
        return EvalGraph::new(vertices, edges);
    }
    // Drop the dissolved (now edge-less) vertices and remap surviving edge indices.
    let mut remap = vec![usize::MAX; vertices.len()];
    let mut compact_vertices = Vec::with_capacity(vertices.len());
    for (index, point) in vertices.iter().enumerate() {
        if dissolved[index] {
            continue;
        }
        remap[index] = compact_vertices.len();
        compact_vertices.push(*point);
    }
    let compact_edges = edges
        .into_iter()
        .filter_map(|mut edge| {
            let a = remap[edge.vertices[0]];
            let b = remap[edge.vertices[1]];
            if a == usize::MAX || b == usize::MAX || a == b {
                return None;
            }
            edge.vertices = [a, b];
            Some(edge)
        })
        .collect();
    EvalGraph::new(compact_vertices, compact_edges)
}

fn other_endpoint(edge: &EvalEdge, vertex: usize) -> usize {
    if edge.vertices[0] == vertex {
        edge.vertices[1]
    } else {
        edge.vertices[0]
    }
}

fn push_unique_edge(edges: &mut Vec<EvalEdge>, seen: &mut BTreeSet<[usize; 2]>, edge: EvalEdge) {
    if edge.vertices[0] == edge.vertices[1] {
        return;
    }
    if seen.insert(canonical_edge(edge.vertices)) {
        edges.push(edge);
    }
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        numerator as f64 / denominator as f64
    }
}

fn f1(precision: f64, recall: f64) -> f64 {
    if precision + recall == 0.0 {
        0.0
    } else {
        2.0 * precision * recall / (precision + recall)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(x: f64, y: f64) -> EvalPoint {
        EvalPoint::new(x, y)
    }

    fn edge(a: usize, b: usize, assignment: EvalAssignment) -> EvalEdge {
        EvalEdge::new([a, b], assignment)
    }

    #[test]
    fn identical_graph_is_exact_topology_and_assignment() {
        let graph = EvalGraph::new(
            vec![p(0.0, 0.0), p(1.0, 0.0), p(0.0, 1.0)],
            vec![
                edge(0, 1, EvalAssignment::Boundary),
                edge(0, 2, EvalAssignment::Mountain),
            ],
        );

        let metrics = strict_topology_metrics(&graph, &graph, StrictTopologyOptions::default());

        assert!(metrics.exact_topology);
        assert!(metrics.exact_topology_and_assignment);
        assert_eq!(metrics.vertices.matched_vertices, 3);
        assert_eq!(metrics.edges.matched_edges, 2);
        assert_eq!(metrics.assignments.accuracy, 1.0);
    }

    #[test]
    fn vertex_order_does_not_matter_when_coordinates_and_edges_match() {
        let gt = EvalGraph::new(
            vec![p(0.0, 0.0), p(1.0, 0.0), p(0.0, 1.0)],
            vec![
                edge(0, 1, EvalAssignment::Boundary),
                edge(0, 2, EvalAssignment::Mountain),
            ],
        );
        let predicted = EvalGraph::new(
            vec![p(0.0, 1.0), p(0.0, 0.0), p(1.0, 0.0)],
            vec![
                edge(1, 2, EvalAssignment::Boundary),
                edge(1, 0, EvalAssignment::Mountain),
            ],
        );

        let metrics = strict_topology_metrics(&predicted, &gt, StrictTopologyOptions::default());

        assert!(metrics.exact_topology_and_assignment);
        assert_eq!(metrics.vertices.matched_vertices, 3);
        assert_eq!(metrics.edges.matched_edges, 2);
    }

    #[test]
    fn jittered_vertices_match_inside_tolerance() {
        let gt = EvalGraph::new(
            vec![p(0.0, 0.0), p(10.0, 0.0)],
            vec![edge(0, 1, EvalAssignment::Valley)],
        );
        let pred = EvalGraph::new(
            vec![p(0.4, 0.1), p(9.7, -0.2)],
            vec![edge(0, 1, EvalAssignment::Valley)],
        );

        let metrics = strict_topology_metrics(
            &pred,
            &gt,
            StrictTopologyOptions {
                vertex_tolerance: 0.5,
                split_merge_tolerance: 0.5,
                compare_assignments: true,
            },
        );

        assert!(metrics.exact_topology_and_assignment);
        assert!(metrics.vertices.max_error > 0.0);
        assert_eq!(metrics.edges.missing_edges, 0);
    }

    #[test]
    fn extra_and_missing_edges_are_counted_after_vertex_mapping() {
        // Pixel-scale triangle so the 2px default tolerance cannot treat the
        // right-angle corner as collinear with the hypotenuse (a genuine
        // topology difference: GT has the hypotenuse, pred has the left side).
        let gt = EvalGraph::new(
            vec![p(0.0, 0.0), p(100.0, 0.0), p(0.0, 100.0)],
            vec![
                edge(0, 1, EvalAssignment::Mountain),
                edge(1, 2, EvalAssignment::Valley),
            ],
        );
        let pred = EvalGraph::new(
            gt.vertices.clone(),
            vec![
                edge(0, 1, EvalAssignment::Mountain),
                edge(0, 2, EvalAssignment::Valley),
            ],
        );

        let metrics = strict_topology_metrics(&pred, &gt, StrictTopologyOptions::default());

        assert!(!metrics.exact_topology);
        assert_eq!(metrics.edges.matched_edges, 1);
        assert_eq!(metrics.missing_edges.len(), 1);
        assert_eq!(metrics.extra_edges.len(), 1);
        assert_eq!(metrics.missing_edges[0].vertices, [1, 2]);
        assert_eq!(metrics.extra_edges[0].mapped_gt_vertices, Some([0, 2]));
    }

    #[test]
    fn wrong_assignments_are_reported_on_strict_edge_matches() {
        let gt = EvalGraph::new(
            vec![p(0.0, 0.0), p(1.0, 0.0)],
            vec![edge(0, 1, EvalAssignment::Mountain)],
        );
        let pred = EvalGraph::new(
            gt.vertices.clone(),
            vec![edge(0, 1, EvalAssignment::Valley)],
        );

        let metrics = strict_topology_metrics(&pred, &gt, StrictTopologyOptions::default());

        assert!(metrics.exact_topology);
        assert!(!metrics.exact_topology_and_assignment);
        assert_eq!(metrics.assignments.checked_edges, 1);
        assert_eq!(metrics.assignments.wrong_edges, 1);
        assert_eq!(
            metrics.wrong_assignments[0].gt_assignment,
            EvalAssignment::Mountain
        );
    }

    #[test]
    fn collinear_split_at_shared_vertex_is_exact() {
        // A straight crease (0,0)->(100,0) that ground truth keeps whole but the
        // prediction splits at the shared junction (50,0) where a perpendicular
        // crease meets it — the paper-border representation case. Both graphs hold
        // the junction, so after planar canonicalization the topology is identical.
        let gt = EvalGraph::new(
            vec![p(0.0, 0.0), p(100.0, 0.0), p(50.0, 0.0), p(50.0, 50.0)],
            vec![
                edge(0, 1, EvalAssignment::Boundary),
                edge(2, 3, EvalAssignment::Mountain),
            ],
        );
        let pred = EvalGraph::new(
            gt.vertices.clone(),
            vec![
                edge(0, 2, EvalAssignment::Boundary),
                edge(2, 1, EvalAssignment::Boundary),
                edge(2, 3, EvalAssignment::Mountain),
            ],
        );

        let metrics = strict_topology_metrics(
            &pred,
            &gt,
            StrictTopologyOptions {
                vertex_tolerance: 0.5,
                split_merge_tolerance: 1.0,
                compare_assignments: true,
            },
        );

        assert!(metrics.exact_topology_and_assignment);
        assert_eq!(metrics.missing_edges.len(), 0);
        assert_eq!(metrics.extra_edges.len(), 0);
    }

    #[test]
    fn degree_two_collinear_same_assignment_fragmentation_is_exact() {
        // A straight Valley crease that the prediction splits at a degree-2
        // collinear point with the same assignment on both halves. The split point
        // is foldably meaningless, so dissolving it makes the two graphs identical.
        let gt = EvalGraph::new(
            vec![p(0.0, 0.0), p(10.0, 0.0)],
            vec![edge(0, 1, EvalAssignment::Valley)],
        );
        let pred = EvalGraph::new(
            vec![p(0.0, 0.0), p(5.0, 0.0), p(10.0, 0.0)],
            vec![
                edge(0, 1, EvalAssignment::Valley),
                edge(1, 2, EvalAssignment::Valley),
            ],
        );

        let metrics = strict_topology_metrics(
            &pred,
            &gt,
            StrictTopologyOptions {
                vertex_tolerance: 0.1,
                split_merge_tolerance: 0.1,
                compare_assignments: true,
            },
        );

        assert!(metrics.exact_topology_and_assignment);
        assert_eq!(metrics.missing_edges.len(), 0);
        assert_eq!(metrics.extra_edges.len(), 0);
        assert_eq!(metrics.vertices.unmatched_predicted_vertices, 0);
    }

    #[test]
    fn split_gt_edge_diagnostic_identifies_degree_two_fragmentation() {
        // The split point carries a different assignment on each half, so it is a
        // genuine difference (an assignment change mid-crease) that is NOT dissolved
        // and still surfaces via the split-edge diagnostic.
        let gt = EvalGraph::new(
            vec![p(0.0, 0.0), p(10.0, 0.0)],
            vec![edge(0, 1, EvalAssignment::Valley)],
        );
        let pred = EvalGraph::new(
            vec![p(0.0, 0.0), p(5.0, 0.0), p(10.0, 0.0)],
            vec![
                edge(0, 1, EvalAssignment::Valley),
                edge(1, 2, EvalAssignment::Mountain),
            ],
        );

        let metrics = strict_topology_metrics(
            &pred,
            &gt,
            StrictTopologyOptions {
                vertex_tolerance: 0.1,
                split_merge_tolerance: 0.1,
                compare_assignments: true,
            },
        );

        assert_eq!(metrics.edges.matched_edges, 0);
        assert_eq!(metrics.missing_edges.len(), 1);
        assert_eq!(metrics.extra_edges.len(), 2);
        assert_eq!(metrics.split_edges.len(), 1);
        assert_eq!(
            metrics.split_edges[0].intermediate_predicted_vertices,
            vec![1]
        );
    }

    #[test]
    fn merged_pred_edge_diagnostic_identifies_skipped_gt_junction() {
        // Ground truth changes assignment at the intermediate vertex (Valley then
        // Mountain), so the vertex is a real junction that is not dissolved and the
        // prediction genuinely skips it.
        let gt = EvalGraph::new(
            vec![p(0.0, 0.0), p(5.0, 0.0), p(10.0, 0.0)],
            vec![
                edge(0, 1, EvalAssignment::Valley),
                edge(1, 2, EvalAssignment::Mountain),
            ],
        );
        let pred = EvalGraph::new(
            vec![p(0.0, 0.0), p(10.0, 0.0)],
            vec![edge(0, 1, EvalAssignment::Valley)],
        );

        let metrics = strict_topology_metrics(
            &pred,
            &gt,
            StrictTopologyOptions {
                vertex_tolerance: 0.1,
                split_merge_tolerance: 0.1,
                compare_assignments: true,
            },
        );

        assert_eq!(metrics.vertices.unmatched_gt_vertices, 1);
        assert_eq!(metrics.merged_edges.len(), 1);
        assert_eq!(metrics.merged_edges[0].intermediate_gt_vertices, vec![1]);
    }

    #[test]
    fn aggregate_accumulates_exact_rates_and_counts() {
        let graph = EvalGraph::new(
            vec![p(0.0, 0.0), p(1.0, 0.0)],
            vec![edge(0, 1, EvalAssignment::Boundary)],
        );
        let exact = strict_topology_metrics(&graph, &graph, StrictTopologyOptions::default());
        let missing = strict_topology_metrics(
            &EvalGraph::new(graph.vertices.clone(), vec![]),
            &graph,
            StrictTopologyOptions::default(),
        );
        let mut aggregate = StrictTopologyAggregate::default();

        aggregate.add(&exact);
        aggregate.add(&missing);

        assert_eq!(aggregate.samples, 2);
        assert_eq!(aggregate.exact_topology_samples, 1);
        assert_eq!(aggregate.edges.gt_edges, 2);
        assert_eq!(aggregate.edges.matched_edges, 1);
        assert_eq!(aggregate.edges.recall, 0.5);
    }
}
