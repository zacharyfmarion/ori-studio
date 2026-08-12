use crate::{AssignmentLabel, CandidateProgram, EdgeSelection, Point2, VertexKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ConstraintDiagnosticOptions {
    pub tiny_residual_degrees: f64,
    pub small_residual_degrees: f64,
    pub angle_epsilon_degrees: f64,
}

impl Default for ConstraintDiagnosticOptions {
    fn default() -> Self {
        Self {
            tiny_residual_degrees: 0.25,
            small_residual_degrees: 2.0,
            angle_epsilon_degrees: 1e-4,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConstraintDiagnostics {
    pub summary: ConstraintDiagnosticSummary,
    pub vertices: Vec<VertexConstraintDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConstraintDiagnosticSummary {
    pub clean: usize,
    pub tiny_numeric_residual: usize,
    pub small_geometry_residual: usize,
    pub hard_kawasaki_failure: usize,
    pub odd_degree_topology_failure: usize,
    pub maekawa_assignment_failure: usize,
    pub big_little_big_failure: usize,
    pub boundary_topology_failure: usize,
    pub global_flatfolder_failure: usize,
    pub hard_error_count: usize,
    pub max_kawasaki_residual_degrees: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VertexConstraintDiagnostic {
    pub vertex_id: usize,
    pub position: Point2,
    pub kind: VertexKind,
    pub degree: usize,
    pub boundary_edge_count: usize,
    pub mountain_count: usize,
    pub valley_count: usize,
    pub unknown_count: usize,
    pub ray_angles_degrees: Vec<f64>,
    pub sector_angles_degrees: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kawasaki_residual_degrees: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maekawa_residual: Option<usize>,
    pub big_little_big: BigLittleBigStatus,
    pub severity: ConstraintSeverity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BigLittleBigStatus {
    NotEvaluated,
    Clean,
    Ambiguous,
    Violation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConstraintSeverity {
    Clean,
    TinyNumericResidual,
    SmallGeometryResidual,
    HardKawasakiFailure,
    OddDegreeTopologyFailure,
    MaekawaAssignmentFailure,
    BigLittleBigFailure,
    BoundaryTopologyFailure,
    GlobalFlatfolderFailure,
}

#[derive(Debug, Clone)]
struct IncidentRay {
    angle_degrees: f64,
    assignment: AssignmentLabel,
}

pub fn diagnose_constraints(
    program: &CandidateProgram,
    options: ConstraintDiagnosticOptions,
) -> ConstraintDiagnostics {
    let mut incident = vec![Vec::<IncidentRay>::new(); program.vertices.len()];
    let mut boundary_edge_count = vec![0usize; program.vertices.len()];

    for edge in &program.edges {
        if edge.selection != EdgeSelection::Selected {
            continue;
        }
        let [a, b] = edge.vertices;
        let Some(vertex_a) = program.vertices.get(a) else {
            continue;
        };
        let Some(vertex_b) = program.vertices.get(b) else {
            continue;
        };
        if edge.assignment.label == AssignmentLabel::Boundary {
            boundary_edge_count[a] += 1;
            boundary_edge_count[b] += 1;
            continue;
        }
        if edge.assignment.label == AssignmentLabel::Flat {
            continue;
        }
        incident[a].push(IncidentRay {
            angle_degrees: angle_degrees(vertex_a.position, vertex_b.position),
            assignment: edge.assignment.label,
        });
        incident[b].push(IncidentRay {
            angle_degrees: angle_degrees(vertex_b.position, vertex_a.position),
            assignment: edge.assignment.label,
        });
    }

    let vertices = program
        .vertices
        .iter()
        .enumerate()
        .map(|(index, vertex)| {
            let mut rays = incident[index].clone();
            rays.sort_by(|left, right| left.angle_degrees.total_cmp(&right.angle_degrees));
            let degree = rays.len();
            let sector_angles = sector_angles(&rays);
            let kawasaki_residual = kawasaki_residual(&sector_angles);
            let mountain_count = rays
                .iter()
                .filter(|ray| ray.assignment == AssignmentLabel::Mountain)
                .count();
            let valley_count = rays
                .iter()
                .filter(|ray| ray.assignment == AssignmentLabel::Valley)
                .count();
            let unknown_count = rays
                .iter()
                .filter(|ray| ray.assignment == AssignmentLabel::Unknown)
                .count();
            let maekawa_residual =
                maekawa_residual(mountain_count, valley_count, unknown_count, degree);
            let big_little_big =
                big_little_big_status(&rays, &sector_angles, options.angle_epsilon_degrees);
            let severity = classify_severity(
                vertex.kind,
                boundary_edge_count[index],
                degree,
                kawasaki_residual,
                maekawa_residual,
                big_little_big,
                options,
            );
            VertexConstraintDiagnostic {
                vertex_id: vertex.id,
                position: vertex.position,
                kind: vertex.kind,
                degree,
                boundary_edge_count: boundary_edge_count[index],
                mountain_count,
                valley_count,
                unknown_count,
                ray_angles_degrees: rays
                    .iter()
                    .map(|ray| round_degrees(ray.angle_degrees))
                    .collect(),
                sector_angles_degrees: sector_angles.into_iter().map(round_degrees).collect(),
                kawasaki_residual_degrees: kawasaki_residual.map(round_degrees),
                maekawa_residual,
                big_little_big,
                severity,
            }
        })
        .collect::<Vec<_>>();

    ConstraintDiagnostics {
        summary: ConstraintDiagnosticSummary::from_vertices(&vertices),
        vertices,
    }
}

impl ConstraintDiagnosticSummary {
    fn from_vertices(vertices: &[VertexConstraintDiagnostic]) -> Self {
        let mut summary = Self {
            clean: 0,
            tiny_numeric_residual: 0,
            small_geometry_residual: 0,
            hard_kawasaki_failure: 0,
            odd_degree_topology_failure: 0,
            maekawa_assignment_failure: 0,
            big_little_big_failure: 0,
            boundary_topology_failure: 0,
            global_flatfolder_failure: 0,
            hard_error_count: 0,
            max_kawasaki_residual_degrees: 0.0,
        };
        for vertex in vertices {
            match vertex.severity {
                ConstraintSeverity::Clean => summary.clean += 1,
                ConstraintSeverity::TinyNumericResidual => summary.tiny_numeric_residual += 1,
                ConstraintSeverity::SmallGeometryResidual => summary.small_geometry_residual += 1,
                ConstraintSeverity::HardKawasakiFailure => summary.hard_kawasaki_failure += 1,
                ConstraintSeverity::OddDegreeTopologyFailure => {
                    summary.odd_degree_topology_failure += 1
                }
                ConstraintSeverity::MaekawaAssignmentFailure => {
                    summary.maekawa_assignment_failure += 1
                }
                ConstraintSeverity::BigLittleBigFailure => summary.big_little_big_failure += 1,
                ConstraintSeverity::BoundaryTopologyFailure => {
                    summary.boundary_topology_failure += 1
                }
                ConstraintSeverity::GlobalFlatfolderFailure => {
                    summary.global_flatfolder_failure += 1
                }
            }
            if is_hard(vertex.severity) {
                summary.hard_error_count += 1;
            }
            if let Some(residual) = vertex.kawasaki_residual_degrees {
                summary.max_kawasaki_residual_degrees =
                    summary.max_kawasaki_residual_degrees.max(residual);
            }
        }
        summary
    }
}

fn classify_severity(
    kind: VertexKind,
    boundary_edges: usize,
    degree: usize,
    kawasaki_residual: Option<f64>,
    maekawa_residual: Option<usize>,
    big_little_big: BigLittleBigStatus,
    options: ConstraintDiagnosticOptions,
) -> ConstraintSeverity {
    if kind != VertexKind::Interior {
        return if boundary_edges == 2 {
            ConstraintSeverity::Clean
        } else {
            ConstraintSeverity::BoundaryTopologyFailure
        };
    }
    if degree == 0 {
        return ConstraintSeverity::Clean;
    }
    if degree % 2 == 1 {
        return ConstraintSeverity::OddDegreeTopologyFailure;
    }
    if kawasaki_residual.is_some_and(|residual| residual > options.small_residual_degrees) {
        return ConstraintSeverity::HardKawasakiFailure;
    }
    if maekawa_residual.is_some_and(|residual| residual > 0) {
        return ConstraintSeverity::MaekawaAssignmentFailure;
    }
    if big_little_big == BigLittleBigStatus::Violation {
        return ConstraintSeverity::BigLittleBigFailure;
    }
    if kawasaki_residual.is_some_and(|residual| residual > options.tiny_residual_degrees) {
        return ConstraintSeverity::SmallGeometryResidual;
    }
    if kawasaki_residual.is_some_and(|residual| residual > options.angle_epsilon_degrees) {
        return ConstraintSeverity::TinyNumericResidual;
    }
    ConstraintSeverity::Clean
}

fn is_hard(severity: ConstraintSeverity) -> bool {
    matches!(
        severity,
        ConstraintSeverity::HardKawasakiFailure
            | ConstraintSeverity::OddDegreeTopologyFailure
            | ConstraintSeverity::MaekawaAssignmentFailure
            | ConstraintSeverity::BigLittleBigFailure
            | ConstraintSeverity::BoundaryTopologyFailure
            | ConstraintSeverity::GlobalFlatfolderFailure
    )
}

fn angle_degrees(origin: Point2, target: Point2) -> f64 {
    let mut angle = (target.y - origin.y)
        .atan2(target.x - origin.x)
        .to_degrees();
    if angle < 0.0 {
        angle += 360.0;
    }
    angle
}

fn sector_angles(rays: &[IncidentRay]) -> Vec<f64> {
    if rays.len() < 2 {
        return Vec::new();
    }
    let mut sectors = Vec::with_capacity(rays.len());
    for index in 0..rays.len() {
        let next = (index + 1) % rays.len();
        sectors.push((rays[next].angle_degrees - rays[index].angle_degrees).rem_euclid(360.0));
    }
    sectors
}

fn kawasaki_residual(sectors: &[f64]) -> Option<f64> {
    if sectors.len() < 2 || sectors.len() % 2 == 1 {
        return None;
    }
    let odd_sum = sectors.iter().step_by(2).sum::<f64>();
    let even_sum = sectors.iter().skip(1).step_by(2).sum::<f64>();
    Some((odd_sum - even_sum).abs())
}

fn maekawa_residual(
    mountain_count: usize,
    valley_count: usize,
    unknown_count: usize,
    degree: usize,
) -> Option<usize> {
    if degree == 0 || unknown_count > 0 {
        return None;
    }
    Some(mountain_count.abs_diff(valley_count).abs_diff(2))
}

fn big_little_big_status(
    rays: &[IncidentRay],
    sectors: &[f64],
    epsilon: f64,
) -> BigLittleBigStatus {
    if rays.len() < 4 || sectors.len() != rays.len() {
        return BigLittleBigStatus::NotEvaluated;
    }
    if rays
        .iter()
        .any(|ray| ray.assignment == AssignmentLabel::Unknown)
    {
        return BigLittleBigStatus::Ambiguous;
    }
    let min_sector = sectors.iter().copied().fold(f64::INFINITY, f64::min);
    let all_equal = sectors
        .iter()
        .all(|sector| (*sector - min_sector).abs() <= epsilon);
    if all_equal {
        return BigLittleBigStatus::Clean;
    }
    for (index, sector) in sectors.iter().enumerate() {
        if (*sector - min_sector).abs() > epsilon {
            continue;
        }
        let next = (index + 1) % rays.len();
        if rays[index].assignment == rays[next].assignment {
            return BigLittleBigStatus::Violation;
        }
    }
    BigLittleBigStatus::Clean
}

fn round_degrees(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AssignmentCandidate, CandidateEdge, CandidateVertex, EdgeSelection, EvidenceSource,
        Provenance,
    };

    #[test]
    fn valid_four_crease_vertex_is_clean() {
        let program = star(&[
            (0.0, AssignmentLabel::Mountain),
            (90.0, AssignmentLabel::Mountain),
            (180.0, AssignmentLabel::Mountain),
            (270.0, AssignmentLabel::Valley),
        ]);

        let diagnostics = diagnose_constraints(&program, Default::default());
        let center = &diagnostics.vertices[0];

        assert_eq!(center.degree, 4);
        assert_eq!(center.kawasaki_residual_degrees, Some(0.0));
        assert_eq!(center.maekawa_residual, Some(0));
        assert_eq!(center.severity, ConstraintSeverity::Clean);
    }

    #[test]
    fn degree_three_vertex_is_topology_failure() {
        let program = star(&[
            (0.0, AssignmentLabel::Mountain),
            (120.0, AssignmentLabel::Valley),
            (240.0, AssignmentLabel::Mountain),
        ]);

        let diagnostics = diagnose_constraints(&program, Default::default());
        assert_eq!(
            diagnostics.vertices[0].severity,
            ConstraintSeverity::OddDegreeTopologyFailure
        );
    }

    #[test]
    fn tiny_angle_residual_is_not_hard() {
        let program = star(&[
            (0.0, AssignmentLabel::Mountain),
            (90.0, AssignmentLabel::Mountain),
            (180.0, AssignmentLabel::Mountain),
            (270.1, AssignmentLabel::Valley),
        ]);

        let diagnostics = diagnose_constraints(&program, Default::default());
        let center = &diagnostics.vertices[0];

        assert_eq!(center.severity, ConstraintSeverity::TinyNumericResidual);
        assert_eq!(center.kawasaki_residual_degrees, Some(0.2));
    }

    #[test]
    fn large_kawasaki_residual_is_hard_geometry_failure() {
        let program = star(&[
            (0.0, AssignmentLabel::Mountain),
            (60.0, AssignmentLabel::Mountain),
            (180.0, AssignmentLabel::Mountain),
            (270.0, AssignmentLabel::Valley),
        ]);

        let diagnostics = diagnose_constraints(&program, Default::default());
        assert_eq!(
            diagnostics.vertices[0].severity,
            ConstraintSeverity::HardKawasakiFailure
        );
    }

    #[test]
    fn wrong_mv_count_is_assignment_failure_not_geometry_failure() {
        let program = star(&[
            (0.0, AssignmentLabel::Mountain),
            (90.0, AssignmentLabel::Valley),
            (180.0, AssignmentLabel::Mountain),
            (270.0, AssignmentLabel::Valley),
        ]);

        let diagnostics = diagnose_constraints(&program, Default::default());
        let center = &diagnostics.vertices[0];

        assert_eq!(center.kawasaki_residual_degrees, Some(0.0));
        assert_eq!(center.maekawa_residual, Some(2));
        assert_eq!(
            center.severity,
            ConstraintSeverity::MaekawaAssignmentFailure
        );
    }

    #[test]
    fn big_little_big_min_sector_with_same_labels_is_reported() {
        let program = star(&[
            (0.0, AssignmentLabel::Mountain),
            (30.0, AssignmentLabel::Mountain),
            (180.0, AssignmentLabel::Valley),
            (330.0, AssignmentLabel::Mountain),
        ]);

        let diagnostics = diagnose_constraints(&program, Default::default());
        let center = &diagnostics.vertices[0];

        assert_eq!(center.kawasaki_residual_degrees, Some(0.0));
        assert_eq!(center.big_little_big, BigLittleBigStatus::Violation);
        assert_eq!(center.severity, ConstraintSeverity::BigLittleBigFailure);
    }

    #[test]
    fn boundary_contact_with_two_border_edges_does_not_need_interior_flat_foldability() {
        let program = CandidateProgram {
            coordinate_space: "unit_test".to_owned(),
            image_size: None,
            carriers: Vec::new(),
            vertices: vec![
                CandidateVertex {
                    id: 0,
                    position: Point2::new(0.5, 0.5),
                    kind: VertexKind::Interior,
                    support: 1.0,
                    boundary_side: None,
                    incident_carriers: Vec::new(),
                    provenance: vec![Provenance::LegacyDecoder],
                },
                CandidateVertex {
                    id: 1,
                    position: Point2::new(1.0, 0.5),
                    kind: VertexKind::Boundary,
                    support: 1.0,
                    boundary_side: Some("right".to_owned()),
                    incident_carriers: Vec::new(),
                    provenance: vec![Provenance::LegacyDecoder],
                },
                CandidateVertex {
                    id: 2,
                    position: Point2::new(1.0, 0.0),
                    kind: VertexKind::Corner,
                    support: 1.0,
                    boundary_side: Some("right".to_owned()),
                    incident_carriers: Vec::new(),
                    provenance: vec![Provenance::LegacyDecoder],
                },
                CandidateVertex {
                    id: 3,
                    position: Point2::new(1.0, 1.0),
                    kind: VertexKind::Corner,
                    support: 1.0,
                    boundary_side: Some("right".to_owned()),
                    incident_carriers: Vec::new(),
                    provenance: vec![Provenance::LegacyDecoder],
                },
            ],
            edges: vec![
                edge(0, [2, 1], AssignmentLabel::Boundary),
                edge(1, [1, 3], AssignmentLabel::Boundary),
                edge(2, [0, 1], AssignmentLabel::Mountain),
            ],
        };

        let diagnostics = diagnose_constraints(&program, Default::default());

        assert_eq!(diagnostics.vertices[1].boundary_edge_count, 2);
        assert_eq!(diagnostics.vertices[1].severity, ConstraintSeverity::Clean);
    }

    fn star(rays: &[(f64, AssignmentLabel)]) -> CandidateProgram {
        let mut vertices = vec![CandidateVertex {
            id: 0,
            position: Point2::new(0.0, 0.0),
            kind: VertexKind::Interior,
            support: 1.0,
            boundary_side: None,
            incident_carriers: Vec::new(),
            provenance: vec![Provenance::LegacyDecoder],
        }];
        let mut edges = Vec::new();
        for (index, (angle, assignment)) in rays.iter().enumerate() {
            let radians = angle.to_radians();
            let vertex_id = index + 1;
            vertices.push(CandidateVertex {
                id: vertex_id,
                position: Point2::new(radians.cos(), radians.sin()),
                kind: VertexKind::Interior,
                support: 1.0,
                boundary_side: None,
                incident_carriers: Vec::new(),
                provenance: vec![Provenance::LegacyDecoder],
            });
            edges.push(CandidateEdge {
                id: index,
                carrier_id: index,
                vertices: [0, vertex_id],
                assignment: AssignmentCandidate {
                    label: *assignment,
                    confidence: 1.0,
                    margin: 1.0,
                },
                line_support: 1.0,
                style_support: 0.0,
                selection: EdgeSelection::Selected,
                source: EvidenceSource::ObservedStrong,
                provenance: vec![Provenance::LegacyDecoder],
            });
        }
        CandidateProgram {
            coordinate_space: "unit_test".to_owned(),
            image_size: None,
            carriers: Vec::new(),
            vertices,
            edges,
        }
    }

    fn edge(id: usize, vertices: [usize; 2], label: AssignmentLabel) -> CandidateEdge {
        CandidateEdge {
            id,
            carrier_id: id,
            vertices,
            assignment: AssignmentCandidate {
                label,
                confidence: 1.0,
                margin: 1.0,
            },
            line_support: 1.0,
            style_support: 0.0,
            selection: EdgeSelection::Selected,
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::LegacyDecoder],
        }
    }
}
