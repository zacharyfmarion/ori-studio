use crate::{CandidateCarrier, CandidateProgram, CarrierFamily, Point2, VertexKind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ExactizeOptions {
    pub border_tolerance: f64,
    pub angle_tolerance_degrees: f64,
    pub max_vertex_move: f64,
    pub projection_bounds_padding: f64,
}

impl Default for ExactizeOptions {
    fn default() -> Self {
        Self {
            border_tolerance: 0.025,
            angle_tolerance_degrees: 2.0,
            max_vertex_move: 0.05,
            projection_bounds_padding: 0.05,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExactizedProgram {
    pub program: CandidateProgram,
    pub report: ExactizeReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExactizeReport {
    pub vertices_moved: usize,
    pub degenerate_edges: usize,
    pub max_vertex_move: f64,
    pub mean_vertex_move: f64,
    pub snapped_border_carriers: usize,
    pub snapped_axis_carriers: usize,
    pub snapped_diagonal_carriers: usize,
}

pub fn exactize_program(program: &CandidateProgram, options: ExactizeOptions) -> ExactizedProgram {
    let mut exact = program.clone();
    let mut snapped_border_carriers = 0usize;
    let mut snapped_axis_carriers = 0usize;
    let mut snapped_diagonal_carriers = 0usize;

    for carrier in &mut exact.carriers {
        match snap_carrier(carrier, options) {
            CarrierSnap::Border => snapped_border_carriers += 1,
            CarrierSnap::Axis => snapped_axis_carriers += 1,
            CarrierSnap::Diagonal => snapped_diagonal_carriers += 1,
            CarrierSnap::None => {}
        }
    }

    let carrier_by_id = exact
        .carriers
        .iter()
        .map(|carrier| (carrier.id, carrier.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut movements = Vec::new();
    let mut vertices_moved = 0usize;
    for vertex in &mut exact.vertices {
        let old = vertex.position;
        let lines = vertex
            .incident_carriers
            .iter()
            .filter_map(|id| carrier_by_id.get(id))
            .collect::<Vec<_>>();
        let projected = project_vertex(vertex.position, vertex.kind, &lines, options);
        let movement = distance(old, projected);
        if movement > 1e-9 {
            vertices_moved += 1;
        }
        vertex.position = projected;
        movements.push(movement);
    }
    let degenerate_edges = exact
        .edges
        .iter()
        .filter(|edge| {
            let Some(a) = exact.vertices.get(edge.vertices[0]) else {
                return false;
            };
            let Some(b) = exact.vertices.get(edge.vertices[1]) else {
                return false;
            };
            distance(a.position, b.position) <= 1e-9
        })
        .count();

    ExactizedProgram {
        program: exact,
        report: ExactizeReport {
            vertices_moved,
            degenerate_edges,
            max_vertex_move: movements.iter().copied().fold(0.0, f64::max),
            mean_vertex_move: if movements.is_empty() {
                0.0
            } else {
                movements.iter().sum::<f64>() / movements.len() as f64
            },
            snapped_border_carriers,
            snapped_axis_carriers,
            snapped_diagonal_carriers,
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CarrierSnap {
    None,
    Border,
    Axis,
    Diagonal,
}

fn snap_carrier(carrier: &mut CandidateCarrier, options: ExactizeOptions) -> CarrierSnap {
    canonicalize_carrier(carrier);
    if carrier.family == CarrierFamily::Border {
        if snap_border_carrier(carrier, options.border_tolerance) {
            return CarrierSnap::Border;
        }
    }
    if snap_axis_carrier(carrier, options.angle_tolerance_degrees.to_radians()) {
        return CarrierSnap::Axis;
    }
    if snap_diagonal_carrier(carrier, options.angle_tolerance_degrees.to_radians()) {
        return CarrierSnap::Diagonal;
    }
    CarrierSnap::None
}

fn canonicalize_carrier(carrier: &mut CandidateCarrier) {
    let norm = (carrier.normal.x * carrier.normal.x + carrier.normal.y * carrier.normal.y)
        .sqrt()
        .max(1e-12);
    carrier.normal.x /= norm;
    carrier.normal.y /= norm;
    carrier.rho /= norm;
    if carrier.normal.x < -1e-12 || (carrier.normal.x.abs() <= 1e-12 && carrier.normal.y < -1e-12) {
        carrier.normal.x = -carrier.normal.x;
        carrier.normal.y = -carrier.normal.y;
        carrier.rho = -carrier.rho;
    }
}

fn snap_border_carrier(carrier: &mut CandidateCarrier, tolerance: f64) -> bool {
    if carrier.normal.x.abs() >= carrier.normal.y.abs() {
        let x = carrier.rho / carrier.normal.x.max(1e-12);
        if (x - 0.0).abs() <= tolerance {
            carrier.normal = Point2::new(1.0, 0.0);
            carrier.rho = 0.0;
            return true;
        }
        if (x - 1.0).abs() <= tolerance {
            carrier.normal = Point2::new(1.0, 0.0);
            carrier.rho = 1.0;
            return true;
        }
    } else {
        let y = carrier.rho / carrier.normal.y.max(1e-12);
        if (y - 0.0).abs() <= tolerance {
            carrier.normal = Point2::new(0.0, 1.0);
            carrier.rho = 0.0;
            return true;
        }
        if (y - 1.0).abs() <= tolerance {
            carrier.normal = Point2::new(0.0, 1.0);
            carrier.rho = 1.0;
            return true;
        }
    }
    false
}

fn snap_axis_carrier(carrier: &mut CandidateCarrier, angle_tolerance: f64) -> bool {
    let sin_tol = angle_tolerance.sin().abs();
    if carrier.normal.x.abs() <= sin_tol {
        let y = carrier.rho / carrier.normal.y.max(1e-12);
        carrier.normal = Point2::new(0.0, 1.0);
        carrier.rho = y;
        carrier.family = CarrierFamily::Horizontal;
        true
    } else if carrier.normal.y.abs() <= sin_tol {
        let x = carrier.rho / carrier.normal.x.max(1e-12);
        carrier.normal = Point2::new(1.0, 0.0);
        carrier.rho = x;
        carrier.family = CarrierFamily::Vertical;
        true
    } else {
        false
    }
}

fn snap_diagonal_carrier(carrier: &mut CandidateCarrier, angle_tolerance: f64) -> bool {
    let diagonal = std::f64::consts::FRAC_1_SQRT_2;
    if (carrier.normal.x.abs() - diagonal).abs() > angle_tolerance
        || (carrier.normal.y.abs() - diagonal).abs() > angle_tolerance
    {
        return false;
    }
    if carrier.normal.x * carrier.normal.y >= 0.0 {
        let rho =
            carrier.rho / ((carrier.normal.x + carrier.normal.y) / (2.0 * diagonal)).max(1e-12);
        carrier.normal = Point2::new(diagonal, diagonal);
        carrier.rho = rho;
        carrier.family = CarrierFamily::DiagonalNegative;
    } else {
        let rho =
            carrier.rho / ((carrier.normal.x - carrier.normal.y) / (2.0 * diagonal)).max(1e-12);
        carrier.normal = Point2::new(diagonal, -diagonal);
        carrier.rho = rho;
        carrier.family = CarrierFamily::DiagonalPositive;
    }
    true
}

fn project_vertex(
    point: Point2,
    kind: VertexKind,
    carriers: &[&CandidateCarrier],
    options: ExactizeOptions,
) -> Point2 {
    if kind == VertexKind::Corner {
        return Point2::new(round_unit(point.x), round_unit(point.y));
    }
    let fallback = snap_boundary_if_needed(point, kind);
    if carriers.len() >= 2 {
        if let Some(projected) = solve_lines_least_squares(carriers) {
            let projected = snap_boundary_if_needed(projected, kind);
            if projection_is_safe(point, projected, options) {
                return projected;
            }
        }
    }
    if carriers.len() == 1 {
        let projected = project_to_line(point, carriers[0]);
        let projected = snap_boundary_if_needed(projected, kind);
        if projection_is_safe(point, projected, options) {
            return projected;
        }
    }
    fallback
}

fn solve_lines_least_squares(carriers: &[&CandidateCarrier]) -> Option<Point2> {
    let mut a00 = 0.0;
    let mut a01 = 0.0;
    let mut a11 = 0.0;
    let mut b0 = 0.0;
    let mut b1 = 0.0;
    for carrier in carriers {
        let nx = carrier.normal.x;
        let ny = carrier.normal.y;
        a00 += nx * nx;
        a01 += nx * ny;
        a11 += ny * ny;
        b0 += nx * carrier.rho;
        b1 += ny * carrier.rho;
    }
    let det = a00 * a11 - a01 * a01;
    if det.abs() < 1e-12 {
        return None;
    }
    Some(Point2::new(
        (b0 * a11 - b1 * a01) / det,
        (a00 * b1 - a01 * b0) / det,
    ))
}

fn project_to_line(point: Point2, carrier: &CandidateCarrier) -> Point2 {
    let distance = carrier.normal.x * point.x + carrier.normal.y * point.y - carrier.rho;
    Point2::new(
        point.x - distance * carrier.normal.x,
        point.y - distance * carrier.normal.y,
    )
}

fn projection_is_safe(original: Point2, projected: Point2, options: ExactizeOptions) -> bool {
    if !projected.x.is_finite() || !projected.y.is_finite() {
        return false;
    }
    let padding = options.projection_bounds_padding.max(0.0);
    if projected.x < -padding
        || projected.x > 1.0 + padding
        || projected.y < -padding
        || projected.y > 1.0 + padding
    {
        return false;
    }
    distance(original, projected) <= options.max_vertex_move.max(0.0)
}

fn snap_boundary_if_needed(point: Point2, kind: VertexKind) -> Point2 {
    if kind == VertexKind::Boundary || kind == VertexKind::Corner {
        Point2::new(snap_if_unit(point.x), snap_if_unit(point.y))
    } else {
        point
    }
}

fn round_unit(value: f64) -> f64 {
    if value < 0.5 { 0.0 } else { 1.0 }
}

fn snap_if_unit(value: f64) -> f64 {
    if (value - 0.0).abs() <= 0.025 {
        0.0
    } else if (value - 1.0).abs() <= 0.025 {
        1.0
    } else {
        value
    }
}

fn distance(left: Point2, right: Point2) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AssignmentCandidate, AssignmentLabel, CandidateEdge, EdgeSelection, EvidenceSource,
        Provenance,
    };

    #[test]
    fn noisy_square_border_projects_to_exact_unit_square() {
        let program = program_with_vertices_and_carriers(
            vec![
                vertex(0, -0.003, 0.004, VertexKind::Corner, vec![0, 3]),
                vertex(1, 1.006, -0.002, VertexKind::Corner, vec![0, 1]),
                vertex(2, 1.004, 1.005, VertexKind::Corner, vec![1, 2]),
                vertex(3, -0.005, 1.003, VertexKind::Corner, vec![2, 3]),
            ],
            vec![
                border_carrier(0, Point2::new(0.0, 1.0), 0.004),
                border_carrier(1, Point2::new(1.0, 0.0), 1.004),
                border_carrier(2, Point2::new(0.0, 1.0), 1.003),
                border_carrier(3, Point2::new(1.0, 0.0), -0.003),
            ],
        );

        let exact = exactize_program(&program, Default::default());
        let points: Vec<Point2> = exact
            .program
            .vertices
            .iter()
            .map(|vertex| vertex.position)
            .collect();

        assert_eq!(
            points,
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(1.0, 0.0),
                Point2::new(1.0, 1.0),
                Point2::new(0.0, 1.0),
            ]
        );
        assert_eq!(exact.report.snapped_border_carriers, 4);
        assert_eq!(exact.report.vertices_moved, 4);
    }

    #[test]
    fn noisy_axis_carriers_project_intersection() {
        let program = program_with_vertices_and_carriers(
            vec![vertex(0, 0.497, 0.251, VertexKind::Interior, vec![0, 1])],
            vec![
                carrier(0, CarrierFamily::Vertical, Point2::new(0.9999, 0.002), 0.5),
                carrier(
                    1,
                    CarrierFamily::Horizontal,
                    Point2::new(0.001, 0.9999),
                    0.25,
                ),
            ],
        );

        let exact = exactize_program(&program, Default::default());
        assert_close(exact.program.vertices[0].position.x, 0.50005, 1e-5);
        assert_close(exact.program.vertices[0].position.y, 0.250025, 1e-5);
        assert_eq!(exact.report.snapped_axis_carriers, 2);
    }

    #[test]
    fn ill_conditioned_projection_keeps_original_vertex() {
        let original = Point2::new(0.03025, 0.66862);
        let n0 = normalized(Point2::new(1.0, 0.1));
        let n1 = normalized(Point2::new(1.0, 0.100001));
        let program = program_with_vertices_and_carriers(
            vec![vertex(
                0,
                original.x,
                original.y,
                VertexKind::Interior,
                vec![0, 1],
            )],
            vec![
                carrier(
                    0,
                    CarrierFamily::Free,
                    n0,
                    n0.x * original.x + n0.y * original.y,
                ),
                carrier(
                    1,
                    CarrierFamily::Free,
                    n1,
                    n1.x * original.x + n1.y * original.y + 0.01,
                ),
            ],
        );

        let exact = exactize_program(&program, Default::default());
        assert_close(exact.program.vertices[0].position.x, original.x, 1e-12);
        assert_close(exact.program.vertices[0].position.y, original.y, 1e-12);
        assert_eq!(exact.report.vertices_moved, 0);
    }

    #[test]
    fn noisy_diagonal_carriers_snap_to_common_diagonal_family() {
        let diagonal = std::f64::consts::FRAC_1_SQRT_2;
        let program = program_with_vertices_and_carriers(
            vec![vertex(0, 0.5, 0.5, VertexKind::Interior, vec![0])],
            vec![carrier(
                0,
                CarrierFamily::Free,
                Point2::new(diagonal + 0.001, -diagonal + 0.001),
                0.0,
            )],
        );

        let exact = exactize_program(&program, Default::default());
        assert_eq!(
            exact.program.carriers[0].family,
            CarrierFamily::DiagonalPositive
        );
        assert_eq!(exact.report.snapped_diagonal_carriers, 1);
    }

    #[test]
    fn degenerate_edges_are_reported_without_changing_topology() {
        let mut program = program_with_vertices_and_carriers(
            vec![
                vertex(0, 0.5, 0.5, VertexKind::Interior, Vec::new()),
                vertex(1, 0.5, 0.5, VertexKind::Interior, Vec::new()),
            ],
            Vec::new(),
        );
        program.edges.push(edge(0, [0, 1]));

        let exact = exactize_program(&program, Default::default());
        assert_eq!(exact.report.degenerate_edges, 1);
        assert_eq!(exact.program.edges.len(), 1);
    }

    fn program_with_vertices_and_carriers(
        vertices: Vec<crate::CandidateVertex>,
        carriers: Vec<CandidateCarrier>,
    ) -> CandidateProgram {
        CandidateProgram {
            coordinate_space: "fold_normalized".to_owned(),
            image_size: None,
            carriers,
            vertices,
            edges: Vec::new(),
        }
    }

    fn vertex(
        id: usize,
        x: f64,
        y: f64,
        kind: VertexKind,
        incident_carriers: Vec<usize>,
    ) -> crate::CandidateVertex {
        crate::CandidateVertex {
            id,
            position: Point2::new(x, y),
            kind,
            support: 1.0,
            boundary_side: None,
            incident_carriers,
            provenance: vec![Provenance::LegacyDecoder],
        }
    }

    fn carrier(id: usize, family: CarrierFamily, normal: Point2, rho: f64) -> CandidateCarrier {
        CandidateCarrier {
            id,
            family,
            normal,
            rho,
            support_interval: [0.0, 1.0],
            visual_support: 1.0,
            dashed_support: 0.0,
            non_crease_penalty: 0.0,
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::LegacyDecoder],
        }
    }

    fn border_carrier(id: usize, normal: Point2, rho: f64) -> CandidateCarrier {
        carrier(id, CarrierFamily::Border, normal, rho)
    }

    fn normalized(point: Point2) -> Point2 {
        let norm = (point.x * point.x + point.y * point.y).sqrt();
        Point2::new(point.x / norm, point.y / norm)
    }

    fn assert_close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "expected {actual} to be within {tolerance} of {expected}"
        );
    }

    #[allow(dead_code)]
    fn edge(id: usize, vertices: [usize; 2]) -> CandidateEdge {
        CandidateEdge {
            id,
            carrier_id: id,
            vertices,
            assignment: AssignmentCandidate {
                label: AssignmentLabel::Mountain,
                confidence: 1.0,
                margin: 0.0,
            },
            line_support: 1.0,
            style_support: 0.0,
            selection: EdgeSelection::Selected,
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::LegacyDecoder],
        }
    }
}
