use crate::constraints::{
    ConstraintDiagnosticOptions, ConstraintDiagnostics, diagnose_constraints,
};
use crate::{AssignmentLabel, CandidateProgram, EdgeSelection, Provenance};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AssignmentSolverOptions {
    pub lock_confidence_threshold: f64,
    pub max_variables: usize,
    pub ambiguity_epsilon: f64,
}

impl Default for AssignmentSolverOptions {
    fn default() -> Self {
        Self {
            lock_confidence_threshold: 0.8,
            max_variables: 20,
            ambiguity_epsilon: 1e-9,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssignmentSolveResult {
    pub program: CandidateProgram,
    pub diagnostics: ConstraintDiagnostics,
    pub solved: bool,
    pub ambiguous: bool,
    pub exhausted_budget: bool,
    pub cost: f64,
    pub decisions: Vec<AssignmentDecision>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssignmentDecision {
    pub edge_id: usize,
    pub from: AssignmentLabel,
    pub to: AssignmentLabel,
    pub confidence: f64,
    pub provenance: Provenance,
}

#[derive(Debug, Clone)]
struct AssignmentVariable {
    edge_index: usize,
    edge_id: usize,
    original: AssignmentLabel,
    confidence: f64,
}

#[derive(Debug, Clone)]
struct AssignmentState {
    labels: Vec<AssignmentLabel>,
    cost: f64,
}

pub fn solve_assignments(
    program: &CandidateProgram,
    options: AssignmentSolverOptions,
) -> AssignmentSolveResult {
    let variables = assignment_variables(program, options);
    let base_diagnostics = diagnose_constraints(program, ConstraintDiagnosticOptions::default());
    if variables.len() > options.max_variables {
        return AssignmentSolveResult {
            program: program.clone(),
            diagnostics: base_diagnostics,
            solved: false,
            ambiguous: true,
            exhausted_budget: true,
            cost: f64::INFINITY,
            decisions: variables
                .iter()
                .map(|variable| AssignmentDecision {
                    edge_id: variable.edge_id,
                    from: variable.original,
                    to: variable.original,
                    confidence: variable.confidence,
                    provenance: Provenance::AssignmentAmbiguous,
                })
                .collect(),
        };
    }

    if variables.is_empty() {
        let cost = assignment_cost(program, &base_diagnostics, &variables);
        return AssignmentSolveResult {
            program: program.clone(),
            diagnostics: base_diagnostics.clone(),
            solved: assignment_error_count(&base_diagnostics) == 0,
            ambiguous: false,
            exhausted_budget: false,
            cost,
            decisions: locked_assignment_decisions(program, options),
        };
    }

    let mut states = Vec::new();
    enumerate_assignments(
        program,
        &variables,
        0,
        &mut vec![AssignmentLabel::Unknown; variables.len()],
        &mut states,
    );
    states.sort_by(|left, right| left.cost.total_cmp(&right.cost));
    let Some(best) = states.first().cloned() else {
        return AssignmentSolveResult {
            program: program.clone(),
            diagnostics: base_diagnostics,
            solved: false,
            ambiguous: true,
            exhausted_budget: false,
            cost: f64::INFINITY,
            decisions: Vec::new(),
        };
    };
    let equivalent_best = states
        .iter()
        .filter(|state| (state.cost - best.cost).abs() <= options.ambiguity_epsilon)
        .count();
    let ambiguous = equivalent_best > 1;
    if ambiguous {
        return AssignmentSolveResult {
            program: program.clone(),
            diagnostics: base_diagnostics,
            solved: false,
            ambiguous: true,
            exhausted_budget: false,
            cost: best.cost,
            decisions: variables
                .iter()
                .map(|variable| AssignmentDecision {
                    edge_id: variable.edge_id,
                    from: variable.original,
                    to: variable.original,
                    confidence: variable.confidence,
                    provenance: Provenance::AssignmentAmbiguous,
                })
                .collect(),
        };
    }

    let mut solved_program = program.clone();
    let decisions = apply_assignment_state(&mut solved_program, &variables, &best.labels);
    let diagnostics = diagnose_constraints(&solved_program, ConstraintDiagnosticOptions::default());
    AssignmentSolveResult {
        program: solved_program,
        diagnostics: diagnostics.clone(),
        solved: assignment_error_count(&diagnostics) == 0,
        ambiguous: false,
        exhausted_budget: false,
        cost: best.cost,
        decisions,
    }
}

fn assignment_variables(
    program: &CandidateProgram,
    options: AssignmentSolverOptions,
) -> Vec<AssignmentVariable> {
    program
        .edges
        .iter()
        .enumerate()
        .filter(|(_, edge)| edge.selection == EdgeSelection::Selected)
        .filter(|(_, edge)| {
            !matches!(
                edge.assignment.label,
                AssignmentLabel::Boundary | AssignmentLabel::Flat
            )
        })
        .filter(|(_, edge)| {
            edge.assignment.label == AssignmentLabel::Unknown
                || edge.assignment.confidence < options.lock_confidence_threshold
        })
        .map(|(edge_index, edge)| AssignmentVariable {
            edge_index,
            edge_id: edge.id,
            original: edge.assignment.label,
            confidence: edge.assignment.confidence,
        })
        .collect()
}

fn enumerate_assignments(
    program: &CandidateProgram,
    variables: &[AssignmentVariable],
    index: usize,
    labels: &mut Vec<AssignmentLabel>,
    states: &mut Vec<AssignmentState>,
) {
    if index == variables.len() {
        let mut candidate = program.clone();
        for (variable, label) in variables.iter().zip(labels.iter().copied()) {
            candidate.edges[variable.edge_index].assignment.label = label;
        }
        let diagnostics = diagnose_constraints(&candidate, ConstraintDiagnosticOptions::default());
        let cost = assignment_cost(&candidate, &diagnostics, variables);
        states.push(AssignmentState {
            labels: labels.clone(),
            cost,
        });
        return;
    }

    let variable = &variables[index];
    let choices = match variable.original {
        AssignmentLabel::Mountain => [AssignmentLabel::Mountain, AssignmentLabel::Valley],
        AssignmentLabel::Valley => [AssignmentLabel::Valley, AssignmentLabel::Mountain],
        AssignmentLabel::Unknown => [AssignmentLabel::Mountain, AssignmentLabel::Valley],
        _ => [AssignmentLabel::Mountain, AssignmentLabel::Valley],
    };
    for choice in choices {
        labels[index] = choice;
        enumerate_assignments(program, variables, index + 1, labels, states);
    }
}

fn assignment_cost(
    program: &CandidateProgram,
    diagnostics: &ConstraintDiagnostics,
    variables: &[AssignmentVariable],
) -> f64 {
    let mut cost = assignment_error_count(diagnostics) as f64 * 1000.0;
    for variable in variables {
        let label = program.edges[variable.edge_index].assignment.label;
        match variable.original {
            AssignmentLabel::Unknown => cost += 1.0,
            AssignmentLabel::Mountain | AssignmentLabel::Valley if label != variable.original => {
                cost += 1.0 + variable.confidence.clamp(0.0, 1.0) * 10.0;
            }
            _ => {}
        }
    }
    cost
}

fn assignment_error_count(diagnostics: &ConstraintDiagnostics) -> usize {
    diagnostics.summary.maekawa_assignment_failure + diagnostics.summary.little_big_little_failure
}

fn apply_assignment_state(
    program: &mut CandidateProgram,
    variables: &[AssignmentVariable],
    labels: &[AssignmentLabel],
) -> Vec<AssignmentDecision> {
    let mut decisions = Vec::new();
    for (variable, label) in variables.iter().zip(labels.iter().copied()) {
        let edge = &mut program.edges[variable.edge_index];
        let provenance = match variable.original {
            AssignmentLabel::Unknown => Provenance::AssignmentInferred,
            AssignmentLabel::Mountain | AssignmentLabel::Valley if label != variable.original => {
                Provenance::AssignmentFlipped
            }
            _ => Provenance::AssignmentObserved,
        };
        edge.assignment.label = label;
        edge.assignment.confidence = match provenance {
            Provenance::AssignmentInferred => 0.5,
            Provenance::AssignmentFlipped => edge.assignment.confidence.min(0.5),
            _ => edge.assignment.confidence,
        };
        edge.provenance.push(provenance);
        decisions.push(AssignmentDecision {
            edge_id: variable.edge_id,
            from: variable.original,
            to: label,
            confidence: variable.confidence,
            provenance,
        });
    }
    decisions
}

fn locked_assignment_decisions(
    program: &CandidateProgram,
    options: AssignmentSolverOptions,
) -> Vec<AssignmentDecision> {
    program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected)
        .filter(|edge| {
            matches!(
                edge.assignment.label,
                AssignmentLabel::Mountain | AssignmentLabel::Valley
            ) && edge.assignment.confidence >= options.lock_confidence_threshold
        })
        .map(|edge| AssignmentDecision {
            edge_id: edge.id,
            from: edge.assignment.label,
            to: edge.assignment.label,
            confidence: edge.assignment.confidence,
            provenance: Provenance::AssignmentObserved,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arrangement::SquareSide;
    use crate::{
        AssignmentCandidate, CandidateCarrier, CandidateEdge, CandidateVertex, CarrierFamily,
        EvidenceSource, Point2, VertexKind,
    };

    #[test]
    fn maekawa_satisfiable_component_solves_unknown_without_geometry_changes() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0),
            (90.0, AssignmentLabel::Mountain, 1.0),
            (180.0, AssignmentLabel::Valley, 1.0),
            (270.0, AssignmentLabel::Unknown, 0.0),
        ]);

        let result = solve_assignments(&program, AssignmentSolverOptions::default());

        assert!(result.solved);
        assert!(!result.ambiguous);
        assert_eq!(
            result.program.edges[3].assignment.label,
            AssignmentLabel::Mountain
        );
        assert_eq!(
            result.decisions[0].provenance,
            Provenance::AssignmentInferred
        );
        assert_eq!(result.program.vertices, program.vertices);
    }

    #[test]
    fn high_confidence_labels_are_respected() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0),
            (90.0, AssignmentLabel::Mountain, 1.0),
            (180.0, AssignmentLabel::Mountain, 1.0),
            (270.0, AssignmentLabel::Valley, 1.0),
        ]);

        let result = solve_assignments(&program, AssignmentSolverOptions::default());

        assert!(result.solved);
        assert!(result.decisions.iter().all(|decision| {
            decision.from == decision.to && decision.provenance == Provenance::AssignmentObserved
        }));
    }

    #[test]
    fn low_confidence_wrong_label_is_flipped() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0),
            (90.0, AssignmentLabel::Mountain, 1.0),
            (180.0, AssignmentLabel::Valley, 0.2),
            (270.0, AssignmentLabel::Valley, 1.0),
        ]);

        let result = solve_assignments(&program, AssignmentSolverOptions::default());

        assert!(result.solved);
        assert!(result.decisions.iter().any(|decision| {
            decision.edge_id == 2
                && decision.from == AssignmentLabel::Valley
                && decision.to == AssignmentLabel::Mountain
                && decision.provenance == Provenance::AssignmentFlipped
        }));
    }

    #[test]
    fn multiple_equivalent_assignments_are_marked_ambiguous() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Unknown, 0.0),
            (90.0, AssignmentLabel::Unknown, 0.0),
            (180.0, AssignmentLabel::Unknown, 0.0),
            (270.0, AssignmentLabel::Unknown, 0.0),
        ]);

        let result = solve_assignments(&program, AssignmentSolverOptions::default());

        assert!(result.ambiguous);
        assert!(!result.solved);
        assert_eq!(
            result.program.edges[0].assignment.label,
            AssignmentLabel::Unknown
        );
        assert!(
            result
                .decisions
                .iter()
                .all(|decision| decision.provenance == Provenance::AssignmentAmbiguous)
        );
    }

    fn centered_star(rays: &[(f64, AssignmentLabel, f64)]) -> CandidateProgram {
        let center = Point2::new(0.5, 0.5);
        let mut vertices = vec![vertex(0, center, VertexKind::Interior)];
        let mut edges = Vec::new();
        let mut carriers = Vec::new();
        for (angle, assignment, confidence) in rays {
            let endpoint = boundary_endpoint(center, *angle);
            let target = upsert_boundary_vertex(&mut vertices, endpoint);
            add_segment(
                &vertices,
                &mut edges,
                &mut carriers,
                [0, target],
                *assignment,
                *confidence,
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
        let radians = angle_degrees.to_radians();
        let direction = Point2::new(radians.cos(), radians.sin());
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
        if let Some(index) = vertices.iter().position(|vertex| {
            ((vertex.position.x - point.x).powi(2) + (vertex.position.y - point.y).powi(2)).sqrt()
                <= 1e-9
        }) {
            return index;
        }
        let id = vertices.len();
        vertices.push(vertex(
            id,
            point,
            if is_corner(point) {
                VertexKind::Corner
            } else {
                VertexKind::Boundary
            },
        ));
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
        confidence: f64,
    ) {
        let start = vertices[segment_vertices[0]].position;
        let end = vertices[segment_vertices[1]].position;
        let normal = line_normal(start, end);
        let id = edges.len();
        let source = if assignment == AssignmentLabel::Boundary {
            EvidenceSource::Border
        } else {
            EvidenceSource::ObservedStrong
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
            visual_support: 1.0,
            dashed_support: 0.0,
            non_crease_penalty: 0.0,
            source,
            provenance: vec![Provenance::LegacyDecoder],
        });
        edges.push(CandidateEdge {
            id,
            carrier_id: id,
            vertices: segment_vertices,
            assignment: AssignmentCandidate {
                label: assignment,
                confidence,
                margin: 1.0,
            },
            line_support: 1.0,
            style_support: 0.0,
            selection: EdgeSelection::Selected,
            source,
            provenance: vec![Provenance::LegacyDecoder],
        });
    }

    fn point_on_side(point: Point2, side: SquareSide) -> bool {
        let epsilon = 1e-9;
        match side {
            SquareSide::Top => point.y.abs() <= epsilon,
            SquareSide::Right => (point.x - 1.0).abs() <= epsilon,
            SquareSide::Bottom => (point.y - 1.0).abs() <= epsilon,
            SquareSide::Left => point.x.abs() <= epsilon,
        }
    }

    fn side_coordinate(point: Point2, side: SquareSide) -> f64 {
        match side {
            SquareSide::Top | SquareSide::Bottom => point.x,
            SquareSide::Right | SquareSide::Left => point.y,
        }
    }

    fn is_corner(point: Point2) -> bool {
        let on_vertical = point.x.abs() <= 1e-9 || (point.x - 1.0).abs() <= 1e-9;
        let on_horizontal = point.y.abs() <= 1e-9 || (point.y - 1.0).abs() <= 1e-9;
        on_vertical && on_horizontal
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
        } else {
            CarrierFamily::Free
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
