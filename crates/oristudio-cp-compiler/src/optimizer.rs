use crate::arrangement::SquareSide;
use crate::constraints::{
    ConstraintDiagnosticOptions, ConstraintDiagnostics, ConstraintSeverity, diagnose_constraints,
};
use crate::exactize::{ExactizeOptions, exactize_program};
use crate::repair::{
    RepairCandidate, RepairCandidateKind, RepairCandidateOptions, RepairTarget,
    generate_repair_candidates,
};
use crate::{
    AssignmentCandidate, AssignmentLabel, CandidateCarrier, CandidateEdge, CandidateProgram,
    CandidateVertex, CarrierFamily, EdgeSelection, EvidenceSource, Point2, Provenance, VertexKind,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TopologyOptimizerOptions {
    pub beam_width: usize,
    pub max_iterations: usize,
    pub candidates_per_state: usize,
    pub repair_options: RepairCandidateOptions,
    pub exactize_options: ExactizeOptions,
}

impl Default for TopologyOptimizerOptions {
    fn default() -> Self {
        Self {
            beam_width: 4,
            max_iterations: 3,
            candidates_per_state: 8,
            repair_options: RepairCandidateOptions::default(),
            exactize_options: ExactizeOptions::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopologyOptimizationResult {
    pub program: CandidateProgram,
    pub diagnostics: ConstraintDiagnostics,
    pub cost: TopologyCost,
    pub accepted_moves: Vec<TopologyMoveRecord>,
    pub rejected_moves: Vec<TopologyMoveRecord>,
    pub exhausted_budget: bool,
    pub ambiguous: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TopologyCost {
    pub total: f64,
    pub hard_errors: usize,
    pub max_kawasaki_residual_degrees: f64,
    pub inferred_edges: usize,
    pub selected_weak_edges: usize,
    pub rejected_observed_support: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopologyMoveRecord {
    pub candidate: RepairCandidate,
    pub before_cost: f64,
    pub after_cost: f64,
    pub accepted: bool,
    pub reason: String,
}

#[derive(Debug, Clone)]
struct SearchState {
    program: CandidateProgram,
    diagnostics: ConstraintDiagnostics,
    cost: TopologyCost,
    accepted_moves: Vec<TopologyMoveRecord>,
}

pub fn optimize_topology(
    program: &CandidateProgram,
    options: TopologyOptimizerOptions,
) -> TopologyOptimizationResult {
    let start_program = exactize_program(program, options.exactize_options).program;
    let start_diagnostics =
        diagnose_constraints(&start_program, ConstraintDiagnosticOptions::default());
    let start_cost = score_program(&start_program, &start_diagnostics, options.repair_options);
    let mut beam = vec![SearchState {
        program: start_program,
        diagnostics: start_diagnostics,
        cost: start_cost,
        accepted_moves: Vec::new(),
    }];
    let mut rejected_moves = Vec::new();

    if options.max_iterations == 0 {
        let best = beam.remove(0);
        return TopologyOptimizationResult {
            exhausted_budget: best.cost.hard_errors > 0,
            ambiguous: false,
            program: best.program,
            diagnostics: best.diagnostics,
            cost: best.cost,
            accepted_moves: best.accepted_moves,
            rejected_moves,
        };
    }

    let mut exhausted_budget = false;
    let mut ambiguous = false;
    for iteration in 0..options.max_iterations {
        beam.sort_by(|left, right| left.cost.total.total_cmp(&right.cost.total));
        if beam
            .first()
            .is_some_and(|state| state.cost.hard_errors == 0)
        {
            break;
        }

        let mut next_states = Vec::<SearchState>::new();
        for state in &beam {
            let mut candidates =
                generate_repair_candidates(&state.program, options.repair_options).candidates;
            candidates.truncate(options.candidates_per_state);
            if candidates.is_empty() {
                ambiguous = true;
            }
            for candidate in candidates {
                let Some(mut candidate_program) =
                    apply_repair_candidate(&state.program, &candidate)
                else {
                    rejected_moves.push(TopologyMoveRecord {
                        candidate,
                        before_cost: state.cost.total,
                        after_cost: state.cost.total,
                        accepted: false,
                        reason: "candidate could not be applied to this state".to_owned(),
                    });
                    continue;
                };
                candidate_program =
                    exactize_program(&candidate_program, options.exactize_options).program;
                let diagnostics = diagnose_constraints(
                    &candidate_program,
                    ConstraintDiagnosticOptions::default(),
                );
                let cost = score_program(&candidate_program, &diagnostics, options.repair_options);
                let record = TopologyMoveRecord {
                    candidate,
                    before_cost: state.cost.total,
                    after_cost: cost.total,
                    accepted: cost.total + 1e-9 < state.cost.total,
                    reason: if cost.total + 1e-9 < state.cost.total {
                        "move improves topology cost".to_owned()
                    } else {
                        "move does not improve topology cost".to_owned()
                    },
                };
                if record.accepted {
                    let mut accepted_moves = state.accepted_moves.clone();
                    accepted_moves.push(record);
                    next_states.push(SearchState {
                        program: candidate_program,
                        diagnostics,
                        cost,
                        accepted_moves,
                    });
                } else {
                    rejected_moves.push(record);
                }
            }
        }

        if next_states.is_empty() {
            ambiguous = true;
            break;
        }

        beam.extend(next_states);
        dedupe_states(&mut beam);
        beam.sort_by(|left, right| left.cost.total.total_cmp(&right.cost.total));
        beam.truncate(options.beam_width.max(1));

        if iteration + 1 == options.max_iterations
            && beam.first().is_some_and(|state| state.cost.hard_errors > 0)
        {
            exhausted_budget = true;
        }
    }

    beam.sort_by(|left, right| left.cost.total.total_cmp(&right.cost.total));
    let best = beam.remove(0);
    TopologyOptimizationResult {
        program: best.program,
        diagnostics: best.diagnostics,
        cost: best.cost,
        accepted_moves: best.accepted_moves,
        rejected_moves,
        exhausted_budget,
        ambiguous,
    }
}

pub fn score_program(
    program: &CandidateProgram,
    diagnostics: &ConstraintDiagnostics,
    repair_options: RepairCandidateOptions,
) -> TopologyCost {
    let inferred_edges = program
        .edges
        .iter()
        .filter(|edge| {
            edge.selection == EdgeSelection::Selected && edge.source == EvidenceSource::Inferred
        })
        .count();
    let selected_weak_edges = program
        .edges
        .iter()
        .filter(|edge| {
            edge.selection == EdgeSelection::Selected
                && !matches!(
                    edge.assignment.label,
                    AssignmentLabel::Boundary | AssignmentLabel::Flat
                )
                && edge.line_support < repair_options.weak_line_support_threshold
        })
        .count();
    let rejected_observed_support = program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Rejected)
        .filter(|edge| edge.source != EvidenceSource::Inferred)
        .map(|edge| edge.line_support.max(0.0))
        .sum::<f64>();
    let residual_cost = diagnostics
        .vertices
        .iter()
        .map(|vertex| vertex.kawasaki_residual_degrees.unwrap_or(0.0))
        .sum::<f64>();
    let severity_cost = diagnostics
        .vertices
        .iter()
        .map(|vertex| match vertex.severity {
            ConstraintSeverity::Clean => 0.0,
            ConstraintSeverity::TinyNumericResidual => 0.1,
            ConstraintSeverity::SmallGeometryResidual => 2.0,
            ConstraintSeverity::HardKawasakiFailure => 200.0,
            ConstraintSeverity::OddDegreeTopologyFailure => 200.0,
            ConstraintSeverity::MaekawaAssignmentFailure => 80.0,
            ConstraintSeverity::LittleBigLittleFailure => 60.0,
            ConstraintSeverity::BoundaryTopologyFailure => 300.0,
            ConstraintSeverity::GlobalFlatfolderFailure => 500.0,
        })
        .sum::<f64>();
    let evidence_cost = inferred_edges as f64 * 4.0
        + selected_weak_edges as f64 * 8.0
        + rejected_observed_support * 12.0;
    TopologyCost {
        total: severity_cost + residual_cost * 0.1 + evidence_cost,
        hard_errors: diagnostics.summary.hard_error_count,
        max_kawasaki_residual_degrees: diagnostics.summary.max_kawasaki_residual_degrees,
        inferred_edges,
        selected_weak_edges,
        rejected_observed_support,
    }
}

pub fn apply_repair_candidate(
    program: &CandidateProgram,
    candidate: &RepairCandidate,
) -> Option<CandidateProgram> {
    let mut next = program.clone();
    match &candidate.kind {
        RepairCandidateKind::AddMissingCrease {
            vertex_id, target, ..
        } => apply_add_missing_crease(&mut next, *vertex_id, target)?,
        RepairCandidateKind::DropWeakCrease { edge_id } => {
            let edge = next.edges.iter_mut().find(|edge| edge.id == *edge_id)?;
            edge.selection = EdgeSelection::Rejected;
            edge.provenance.push(Provenance::DeletedLowSupport);
        }
        RepairCandidateKind::MergeVertices { vertices } => {
            apply_merge_vertices(&mut next, vertices[0], vertices[1])?;
        }
        RepairCandidateKind::SplitAtCarrierIntersection { carriers, point } => {
            apply_split_at_carrier_intersection(&mut next, *carriers, *point)?;
        }
        RepairCandidateKind::ChangeAssignment { edge_id, to, .. } => {
            let edge = next.edges.iter_mut().find(|edge| edge.id == *edge_id)?;
            edge.assignment.label = *to;
            edge.assignment.confidence = edge.assignment.confidence.min(0.5);
            edge.provenance.push(Provenance::AssignmentFlipped);
        }
    }
    rebuild_incident_carriers(&mut next);
    Some(next)
}

fn apply_add_missing_crease(
    program: &mut CandidateProgram,
    vertex_id: usize,
    target: &RepairTarget,
) -> Option<()> {
    let origin_index = vertex_index_by_id(program, vertex_id)?;
    let target_index = match target {
        RepairTarget::ExistingVertex {
            vertex_id: target_id,
            ..
        } => vertex_index_by_id(program, *target_id)?,
        RepairTarget::BoundaryContact { side, point } => {
            let new_index = program.vertices.len();
            program.vertices.push(CandidateVertex {
                id: new_index,
                position: *point,
                kind: VertexKind::Boundary,
                support: 0.0,
                boundary_side: Some(side_name(*side).to_owned()),
                incident_carriers: Vec::new(),
                provenance: vec![Provenance::InferredByBoundaryContact],
            });
            split_boundary_edge_at(program, new_index, *side, *point);
            new_index
        }
    };
    if origin_index == target_index {
        return None;
    }
    let origin = program.vertices.get(origin_index)?.position;
    let target_point = program.vertices.get(target_index)?.position;
    if distance(origin, target_point) <= 1e-9 {
        return None;
    }
    let carrier_id = next_carrier_id(program);
    let edge_id = next_edge_id(program);
    let normal = line_normal(origin, target_point);
    let rho = normal.x * origin.x + normal.y * origin.y;
    let family = carrier_family(normal);
    program.carriers.push(CandidateCarrier {
        id: carrier_id,
        family,
        normal,
        rho,
        support_interval: [0.0, 1.0],
        visual_support: 0.0,
        dashed_support: 0.0,
        non_crease_penalty: 0.0,
        source: EvidenceSource::Inferred,
        provenance: vec![Provenance::InferredByKawasaki],
    });
    program.edges.push(CandidateEdge {
        id: edge_id,
        carrier_id,
        vertices: [origin_index, target_index],
        assignment: AssignmentCandidate {
            label: AssignmentLabel::Unknown,
            confidence: 0.0,
            margin: 0.0,
        },
        line_support: 0.0,
        style_support: 0.0,
        selection: EdgeSelection::Selected,
        source: EvidenceSource::Inferred,
        provenance: vec![Provenance::InferredByKawasaki],
    });
    Some(())
}

fn split_boundary_edge_at(
    program: &mut CandidateProgram,
    new_index: usize,
    side: SquareSide,
    point: Point2,
) -> bool {
    let next_split_edge_id = next_edge_id(program);
    for edge_index in 0..program.edges.len() {
        let edge = &program.edges[edge_index];
        if edge.selection != EdgeSelection::Selected
            || edge.assignment.label != AssignmentLabel::Boundary
        {
            continue;
        }
        let [a, b] = edge.vertices;
        let Some(start) = program.vertices.get(a).map(|vertex| vertex.position) else {
            continue;
        };
        let Some(end) = program.vertices.get(b).map(|vertex| vertex.position) else {
            continue;
        };
        if !point_on_side(start, side)
            || !point_on_side(end, side)
            || !point_lies_between(start, end, point)
        {
            continue;
        }
        program.edges[edge_index].selection = EdgeSelection::Rejected;
        let mut first = program.edges[edge_index].clone();
        first.id = next_split_edge_id;
        first.vertices = [a, new_index];
        first.selection = EdgeSelection::Selected;
        let mut second = program.edges[edge_index].clone();
        second.id = next_split_edge_id + 1;
        second.vertices = [new_index, b];
        second.selection = EdgeSelection::Selected;
        program.edges.push(first);
        program.edges.push(second);
        return true;
    }
    false
}

fn apply_merge_vertices(
    program: &mut CandidateProgram,
    left_id: usize,
    right_id: usize,
) -> Option<()> {
    let left_index = vertex_index_by_id(program, left_id)?;
    let right_index = vertex_index_by_id(program, right_id)?;
    if left_index == right_index {
        return None;
    }
    let left = program.vertices.get(left_index)?.position;
    let right = program.vertices.get(right_index)?.position;
    let merged = Point2::new((left.x + right.x) * 0.5, (left.y + right.y) * 0.5);
    program.vertices.get_mut(left_index)?.position = merged;
    program.vertices.get_mut(right_index)?.position = merged;
    for edge in &mut program.edges {
        for vertex in &mut edge.vertices {
            if *vertex == right_index {
                *vertex = left_index;
            }
        }
        if edge.vertices[0] == edge.vertices[1] {
            edge.selection = EdgeSelection::Rejected;
        }
    }
    Some(())
}

fn apply_split_at_carrier_intersection(
    program: &mut CandidateProgram,
    carriers: [usize; 2],
    point: Point2,
) -> Option<()> {
    let new_index = program.vertices.len();
    program.vertices.push(CandidateVertex {
        id: new_index,
        position: point,
        kind: VertexKind::Interior,
        support: 0.0,
        boundary_side: None,
        incident_carriers: carriers.to_vec(),
        provenance: vec![Provenance::InferredByEvenDegree],
    });
    let mut split_edges = Vec::new();
    let mut next_split_edge_id = next_edge_id(program);
    for edge in &mut program.edges {
        if edge.selection != EdgeSelection::Selected || !carriers.contains(&edge.carrier_id) {
            continue;
        }
        let [a, b] = edge.vertices;
        let Some(start) = program.vertices.get(a).map(|vertex| vertex.position) else {
            continue;
        };
        let Some(end) = program.vertices.get(b).map(|vertex| vertex.position) else {
            continue;
        };
        if !point_lies_between(start, end, point) {
            continue;
        }
        edge.selection = EdgeSelection::Rejected;
        edge.provenance.push(Provenance::InferredByEvenDegree);
        let mut first = edge.clone();
        first.id = next_split_edge_id;
        first.vertices = [a, new_index];
        first.selection = EdgeSelection::Selected;
        let mut second = edge.clone();
        second.id = next_split_edge_id + 1;
        second.vertices = [new_index, b];
        second.selection = EdgeSelection::Selected;
        split_edges.push(first);
        split_edges.push(second);
        next_split_edge_id += 2;
    }
    if split_edges.is_empty() {
        return None;
    }
    program.edges.extend(split_edges);
    Some(())
}

fn rebuild_incident_carriers(program: &mut CandidateProgram) {
    for vertex in &mut program.vertices {
        vertex.incident_carriers.clear();
    }
    let mut incident = BTreeMap::<usize, BTreeSet<usize>>::new();
    for edge in &program.edges {
        if edge.selection != EdgeSelection::Selected {
            continue;
        }
        for vertex in edge.vertices {
            incident.entry(vertex).or_default().insert(edge.carrier_id);
        }
    }
    for (index, vertex) in program.vertices.iter_mut().enumerate() {
        vertex.incident_carriers = incident
            .remove(&index)
            .map(|ids| ids.into_iter().collect())
            .unwrap_or_default();
    }
}

fn dedupe_states(states: &mut Vec<SearchState>) {
    let mut seen = BTreeSet::<String>::new();
    states.retain(|state| seen.insert(state_key(&state.program)));
}

fn state_key(program: &CandidateProgram) -> String {
    let mut edges = program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected)
        .map(|edge| {
            format!(
                "{}:{}-{}:{:?}",
                edge.id, edge.vertices[0], edge.vertices[1], edge.assignment.label
            )
        })
        .collect::<Vec<_>>();
    edges.sort();
    format!("v{}|{}", program.vertices.len(), edges.join("|"))
}

fn vertex_index_by_id(program: &CandidateProgram, id: usize) -> Option<usize> {
    program.vertices.iter().position(|vertex| vertex.id == id)
}

fn next_carrier_id(program: &CandidateProgram) -> usize {
    program
        .carriers
        .iter()
        .map(|carrier| carrier.id)
        .max()
        .map(|id| id + 1)
        .unwrap_or(0)
}

fn next_edge_id(program: &CandidateProgram) -> usize {
    program
        .edges
        .iter()
        .map(|edge| edge.id)
        .max()
        .map(|id| id + 1)
        .unwrap_or(0)
}

fn side_name(side: SquareSide) -> &'static str {
    match side {
        SquareSide::Top => "top",
        SquareSide::Right => "right",
        SquareSide::Bottom => "bottom",
        SquareSide::Left => "left",
    }
}

fn point_on_side(point: Point2, side: SquareSide) -> bool {
    let epsilon = 1e-6;
    match side {
        SquareSide::Top => point.y.abs() <= epsilon,
        SquareSide::Right => (point.x - 1.0).abs() <= epsilon,
        SquareSide::Bottom => (point.y - 1.0).abs() <= epsilon,
        SquareSide::Left => point.x.abs() <= epsilon,
    }
}

fn line_normal(start: Point2, end: Point2) -> Point2 {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = (dx * dx + dy * dy).sqrt().max(1e-12);
    Point2::new(-dy / length, dx / length)
}

fn carrier_family(normal: Point2) -> CarrierFamily {
    let axis_epsilon = 1e-6;
    if normal.x.abs() <= axis_epsilon {
        CarrierFamily::Horizontal
    } else if normal.y.abs() <= axis_epsilon {
        CarrierFamily::Vertical
    } else if (normal.x.abs() - normal.y.abs()).abs() <= axis_epsilon {
        if normal.x.signum() == normal.y.signum() {
            CarrierFamily::DiagonalNegative
        } else {
            CarrierFamily::DiagonalPositive
        }
    } else {
        CarrierFamily::Free
    }
}

fn point_lies_between(start: Point2, end: Point2, point: Point2) -> bool {
    let segment = Point2::new(end.x - start.x, end.y - start.y);
    let candidate = Point2::new(point.x - start.x, point.y - start.y);
    let length_squared = segment.x * segment.x + segment.y * segment.y;
    if length_squared <= 1e-12 {
        return false;
    }
    let t = (candidate.x * segment.x + candidate.y * segment.y) / length_squared;
    if !(1e-6..=1.0 - 1e-6).contains(&t) {
        return false;
    }
    let projected = Point2::new(start.x + segment.x * t, start.y + segment.y * t);
    distance(projected, point) <= 1e-4
}

fn distance(left: Point2, right: Point2) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_missing_crease_fixture_is_repaired() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (90.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (180.0, AssignmentLabel::Valley, 1.0, 1.0),
        ]);

        let result = optimize_topology(&program, TopologyOptimizerOptions::default());

        assert_eq!(result.cost.hard_errors, 0);
        assert!(result.accepted_moves.iter().any(|record| matches!(
            record.candidate.kind,
            RepairCandidateKind::AddMissingCrease { .. }
        )));
        assert!(
            result
                .program
                .edges
                .iter()
                .any(|edge| edge.source == EvidenceSource::Inferred)
        );
    }

    #[test]
    fn one_false_positive_fixture_deletes_weak_line() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (45.0, AssignmentLabel::Mountain, 0.1, 1.0),
            (90.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (180.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (270.0, AssignmentLabel::Valley, 1.0, 1.0),
        ]);

        let result = optimize_topology(&program, TopologyOptimizerOptions::default());

        assert_eq!(result.cost.hard_errors, 0);
        assert!(result.accepted_moves.iter().any(|record| matches!(
            record.candidate.kind,
            RepairCandidateKind::DropWeakCrease { edge_id: 1 }
        )));
        assert_eq!(
            result.program.edges[1].selection,
            EdgeSelection::Rejected,
            "weak false positive should be rejected"
        );
    }

    #[test]
    fn ambiguous_fixture_reports_without_inventing_geometry() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (70.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (180.0, AssignmentLabel::Valley, 1.0, 1.0),
            (250.0, AssignmentLabel::Valley, 1.0, 1.0),
        ]);

        let result = optimize_topology(&program, TopologyOptimizerOptions::default());

        assert!(result.ambiguous);
        assert!(result.cost.hard_errors > 0);
        assert!(
            result.accepted_moves.is_empty(),
            "strong but geometrically inconsistent evidence should not be rewritten by an arbitrary move"
        );
    }

    #[test]
    fn search_budget_exhaustion_is_reported_cleanly() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (90.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (180.0, AssignmentLabel::Valley, 1.0, 1.0),
        ]);
        let options = TopologyOptimizerOptions {
            max_iterations: 0,
            ..Default::default()
        };

        let result = optimize_topology(&program, options);

        assert!(result.exhausted_budget);
        assert!(result.accepted_moves.is_empty());
        assert_eq!(result.cost.hard_errors, 1);
    }

    fn centered_star(rays: &[(f64, AssignmentLabel, f64, f64)]) -> CandidateProgram {
        let center = Point2::new(0.5, 0.5);
        let mut vertices = vec![vertex(0, center, VertexKind::Interior)];
        let mut edges = Vec::new();
        let mut carriers = Vec::new();
        for (angle, assignment, support, assignment_confidence) in rays {
            let endpoint = boundary_endpoint(center, *angle);
            let target = upsert_boundary_vertex(&mut vertices, endpoint);
            add_segment(
                &vertices,
                &mut edges,
                &mut carriers,
                [0, target],
                *assignment,
                *support,
                *assignment_confidence,
            );
        }
        for corner in [
            Point2::new(0.0, 0.0),
            Point2::new(1.0, 0.0),
            Point2::new(1.0, 1.0),
            Point2::new(0.0, 1.0),
        ] {
            upsert_boundary_vertex(&mut vertices, corner);
        }
        add_border_edges(&vertices, &mut edges, &mut carriers);
        CandidateProgram {
            coordinate_space: "unit_test".to_owned(),
            image_size: None,
            carriers,
            vertices,
            edges,
        }
    }

    fn boundary_endpoint(origin: Point2, angle_degrees: f64) -> Point2 {
        let direction = unit_direction(angle_degrees);
        let mut hits = Vec::new();
        if direction.x.abs() > 1e-12 {
            for x in [0.0, 1.0] {
                let t = (x - origin.x) / direction.x;
                let y = origin.y + t * direction.y;
                if t > 1e-9 && (-1e-9..=1.0 + 1e-9).contains(&y) {
                    hits.push((t, Point2::new(x, y.clamp(0.0, 1.0))));
                }
            }
        }
        if direction.y.abs() > 1e-12 {
            for y in [0.0, 1.0] {
                let t = (y - origin.y) / direction.y;
                let x = origin.x + t * direction.x;
                if t > 1e-9 && (-1e-9..=1.0 + 1e-9).contains(&x) {
                    hits.push((t, Point2::new(x.clamp(0.0, 1.0), y)));
                }
            }
        }
        hits.sort_by(|left, right| left.0.total_cmp(&right.0));
        hits.first().map(|(_, point)| *point).unwrap_or(origin)
    }

    fn upsert_boundary_vertex(vertices: &mut Vec<CandidateVertex>, point: Point2) -> usize {
        if let Some(index) = vertices
            .iter()
            .position(|vertex| distance(vertex.position, point) <= 1e-9)
        {
            return index;
        }
        let id = vertices.len();
        vertices.push(CandidateVertex {
            id,
            position: point,
            kind: if is_corner(point) {
                VertexKind::Corner
            } else {
                VertexKind::Boundary
            },
            support: 1.0,
            boundary_side: Some(boundary_side_name(point).to_owned()),
            incident_carriers: Vec::new(),
            provenance: vec![Provenance::LegacyDecoder],
        });
        id
    }

    fn add_border_edges(
        vertices: &[CandidateVertex],
        edges: &mut Vec<CandidateEdge>,
        carriers: &mut Vec<CandidateCarrier>,
    ) {
        for side in SquareSide::all() {
            let mut side_vertices = vertices
                .iter()
                .enumerate()
                .filter(|(_, vertex)| point_on_side(vertex.position, side))
                .map(|(index, vertex)| (index, side_coordinate(vertex.position, side)))
                .collect::<Vec<_>>();
            side_vertices.sort_by(|left, right| left.1.total_cmp(&right.1));
            for pair in side_vertices.windows(2) {
                add_segment(
                    vertices,
                    edges,
                    carriers,
                    [pair[0].0, pair[1].0],
                    AssignmentLabel::Boundary,
                    1.0,
                    1.0,
                );
            }
        }
    }

    fn add_segment(
        vertices: &[CandidateVertex],
        edges: &mut Vec<CandidateEdge>,
        carriers: &mut Vec<CandidateCarrier>,
        segment_vertices: [usize; 2],
        assignment: AssignmentLabel,
        support: f64,
        assignment_confidence: f64,
    ) {
        let start = vertices[segment_vertices[0]].position;
        let end = vertices[segment_vertices[1]].position;
        let normal = line_normal(start, end);
        let id = edges.len();
        let source = if assignment == AssignmentLabel::Boundary {
            EvidenceSource::Border
        } else if support < 0.45 {
            EvidenceSource::ObservedWeak
        } else {
            EvidenceSource::ObservedStrong
        };
        let provenance = if assignment == AssignmentLabel::Boundary {
            vec![Provenance::BorderPrior]
        } else {
            vec![Provenance::LegacyDecoder]
        };
        carriers.push(CandidateCarrier {
            id,
            family: if assignment == AssignmentLabel::Boundary {
                CarrierFamily::Border
            } else {
                carrier_family(normal)
            },
            normal,
            rho: normal.x * start.x + normal.y * start.y,
            support_interval: [0.0, 1.0],
            visual_support: support,
            dashed_support: 0.0,
            non_crease_penalty: 0.0,
            source,
            provenance: provenance.clone(),
        });
        edges.push(CandidateEdge {
            id,
            carrier_id: id,
            vertices: segment_vertices,
            assignment: AssignmentCandidate {
                label: assignment,
                confidence: assignment_confidence,
                margin: 1.0,
            },
            line_support: support,
            style_support: 0.0,
            selection: EdgeSelection::Selected,
            source,
            provenance,
        });
    }

    fn unit_direction(angle_degrees: f64) -> Point2 {
        let radians = angle_degrees.to_radians();
        Point2::new(radians.cos(), radians.sin())
    }

    fn is_corner(point: Point2) -> bool {
        let on_vertical = point.x.abs() <= 1e-9 || (point.x - 1.0).abs() <= 1e-9;
        let on_horizontal = point.y.abs() <= 1e-9 || (point.y - 1.0).abs() <= 1e-9;
        on_vertical && on_horizontal
    }

    fn boundary_side_name(point: Point2) -> &'static str {
        if point.y.abs() <= 1e-9 {
            "top"
        } else if (point.x - 1.0).abs() <= 1e-9 {
            "right"
        } else if (point.y - 1.0).abs() <= 1e-9 {
            "bottom"
        } else {
            "left"
        }
    }

    fn side_coordinate(point: Point2, side: SquareSide) -> f64 {
        match side {
            SquareSide::Top | SquareSide::Bottom => point.x,
            SquareSide::Right | SquareSide::Left => point.y,
        }
    }

    fn vertex(id: usize, position: Point2, kind: VertexKind) -> CandidateVertex {
        CandidateVertex {
            id,
            position,
            kind,
            support: 1.0,
            boundary_side: None,
            incident_carriers: Vec::new(),
            provenance: vec![Provenance::LegacyDecoder],
        }
    }
}
