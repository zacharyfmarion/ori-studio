use crate::{CandidateCarrier, CandidateProgram, Point2};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SquareSide {
    Top,
    Right,
    Bottom,
    Left,
}

impl SquareSide {
    pub const fn all() -> [Self; 4] {
        [Self::Top, Self::Right, Self::Bottom, Self::Left]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementPoint {
    pub id: String,
    pub point: Point2,
    pub side: SquareSide,
    pub side_coordinate: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_vertex_id: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_carrier_id: Option<usize>,
    pub kind: ArrangementPointKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArrangementPointKind {
    Corner,
    ExistingBoundaryVertex,
    CarrierContact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArrangementBorderEdge {
    pub side: SquareSide,
    pub vertices: [String; 2],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CarrierIntersection {
    pub carriers: [usize; 2],
    pub point: Point2,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SquareArrangement {
    pub points_by_side: BTreeMap<SquareSide, Vec<ArrangementPoint>>,
    pub border_edges: Vec<ArrangementBorderEdge>,
    pub carrier_intersections: Vec<CarrierIntersection>,
}

impl SquareArrangement {
    pub fn summary(&self) -> SquareArrangementSummary {
        let boundary_points = self.points_by_side.values().map(Vec::len).sum();
        SquareArrangementSummary {
            boundary_points,
            border_edges: self.border_edges.len(),
            carrier_intersections: self.carrier_intersections.len(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SquareArrangementSummary {
    pub boundary_points: usize,
    pub border_edges: usize,
    pub carrier_intersections: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ArrangementOptions {
    pub epsilon: f64,
}

impl Default for ArrangementOptions {
    fn default() -> Self {
        Self { epsilon: 1e-9 }
    }
}

pub fn build_square_arrangement(
    program: &CandidateProgram,
    options: ArrangementOptions,
) -> SquareArrangement {
    let mut points_by_side = BTreeMap::<SquareSide, Vec<ArrangementPoint>>::new();
    for side in SquareSide::all() {
        points_by_side.insert(side, Vec::new());
    }

    add_corners(&mut points_by_side);
    for vertex in &program.vertices {
        if let Some(side) = side_for_point(vertex.position, options.epsilon) {
            push_dedup(
                points_by_side.get_mut(&side).expect("side bucket"),
                ArrangementPoint {
                    id: format!("v{}", vertex.id),
                    point: snap_point_to_side(vertex.position, side),
                    side,
                    side_coordinate: side_coordinate(vertex.position, side),
                    source_vertex_id: Some(vertex.id),
                    source_carrier_id: None,
                    kind: if is_corner(vertex.position, options.epsilon) {
                        ArrangementPointKind::Corner
                    } else {
                        ArrangementPointKind::ExistingBoundaryVertex
                    },
                },
                options.epsilon,
            );
        }
    }

    for carrier in &program.carriers {
        for (side, point) in carrier_square_contacts(carrier, options.epsilon) {
            push_dedup(
                points_by_side.get_mut(&side).expect("side bucket"),
                ArrangementPoint {
                    id: format!("c{}_{side:?}", carrier.id),
                    point,
                    side,
                    side_coordinate: side_coordinate(point, side),
                    source_vertex_id: None,
                    source_carrier_id: Some(carrier.id),
                    kind: ArrangementPointKind::CarrierContact,
                },
                options.epsilon,
            );
        }
    }

    for side in SquareSide::all() {
        let points = points_by_side.get_mut(&side).expect("side bucket");
        points.sort_by(|left, right| loop_coordinate(left).total_cmp(&loop_coordinate(right)));
    }

    let border_edges = border_edges(&points_by_side);
    let carrier_intersections = carrier_intersections(&program.carriers, options.epsilon);

    SquareArrangement {
        points_by_side,
        border_edges,
        carrier_intersections,
    }
}

fn add_corners(points_by_side: &mut BTreeMap<SquareSide, Vec<ArrangementPoint>>) {
    for (id, point, sides) in [
        (
            "corner_tl",
            Point2::new(0.0, 0.0),
            [SquareSide::Top, SquareSide::Left],
        ),
        (
            "corner_tr",
            Point2::new(1.0, 0.0),
            [SquareSide::Top, SquareSide::Right],
        ),
        (
            "corner_br",
            Point2::new(1.0, 1.0),
            [SquareSide::Right, SquareSide::Bottom],
        ),
        (
            "corner_bl",
            Point2::new(0.0, 1.0),
            [SquareSide::Bottom, SquareSide::Left],
        ),
    ] {
        for side in sides {
            points_by_side
                .get_mut(&side)
                .expect("side bucket")
                .push(ArrangementPoint {
                    id: id.to_owned(),
                    point,
                    side,
                    side_coordinate: side_coordinate(point, side),
                    source_vertex_id: None,
                    source_carrier_id: None,
                    kind: ArrangementPointKind::Corner,
                });
        }
    }
}

fn push_dedup(points: &mut Vec<ArrangementPoint>, candidate: ArrangementPoint, epsilon: f64) {
    if let Some(existing) = points
        .iter_mut()
        .find(|point| (point.side_coordinate - candidate.side_coordinate).abs() <= epsilon)
    {
        if should_replace(existing.kind, candidate.kind) {
            *existing = candidate;
        }
        return;
    }
    points.push(candidate);
}

fn should_replace(existing: ArrangementPointKind, candidate: ArrangementPointKind) -> bool {
    rank(candidate) > rank(existing)
}

fn rank(kind: ArrangementPointKind) -> u8 {
    match kind {
        ArrangementPointKind::CarrierContact => 0,
        ArrangementPointKind::ExistingBoundaryVertex => 1,
        ArrangementPointKind::Corner => 2,
    }
}

fn side_for_point(point: Point2, epsilon: f64) -> Option<SquareSide> {
    if near(point.y, 0.0, epsilon) {
        Some(SquareSide::Top)
    } else if near(point.x, 1.0, epsilon) {
        Some(SquareSide::Right)
    } else if near(point.y, 1.0, epsilon) {
        Some(SquareSide::Bottom)
    } else if near(point.x, 0.0, epsilon) {
        Some(SquareSide::Left)
    } else {
        None
    }
}

fn side_coordinate(point: Point2, side: SquareSide) -> f64 {
    match side {
        SquareSide::Top | SquareSide::Bottom => point.x.clamp(0.0, 1.0),
        SquareSide::Right | SquareSide::Left => point.y.clamp(0.0, 1.0),
    }
}

fn loop_coordinate(point: &ArrangementPoint) -> f64 {
    match point.side {
        SquareSide::Top | SquareSide::Right => point.side_coordinate,
        SquareSide::Bottom | SquareSide::Left => 1.0 - point.side_coordinate,
    }
}

fn snap_point_to_side(point: Point2, side: SquareSide) -> Point2 {
    match side {
        SquareSide::Top => Point2::new(point.x.clamp(0.0, 1.0), 0.0),
        SquareSide::Right => Point2::new(1.0, point.y.clamp(0.0, 1.0)),
        SquareSide::Bottom => Point2::new(point.x.clamp(0.0, 1.0), 1.0),
        SquareSide::Left => Point2::new(0.0, point.y.clamp(0.0, 1.0)),
    }
}

fn is_corner(point: Point2, epsilon: f64) -> bool {
    (near(point.x, 0.0, epsilon) || near(point.x, 1.0, epsilon))
        && (near(point.y, 0.0, epsilon) || near(point.y, 1.0, epsilon))
}

fn carrier_square_contacts(carrier: &CandidateCarrier, epsilon: f64) -> Vec<(SquareSide, Point2)> {
    let mut contacts = Vec::new();
    let nx = carrier.normal.x;
    let ny = carrier.normal.y;
    let rho = carrier.rho;

    if ny.abs() > epsilon {
        let y = rho / ny;
        if within_unit(y, epsilon) {
            contacts.push((SquareSide::Left, Point2::new(0.0, y.clamp(0.0, 1.0))));
        }
        let y = (rho - nx) / ny;
        if within_unit(y, epsilon) {
            contacts.push((SquareSide::Right, Point2::new(1.0, y.clamp(0.0, 1.0))));
        }
    }
    if nx.abs() > epsilon {
        let x = rho / nx;
        if within_unit(x, epsilon) {
            contacts.push((SquareSide::Top, Point2::new(x.clamp(0.0, 1.0), 0.0)));
        }
        let x = (rho - ny) / nx;
        if within_unit(x, epsilon) {
            contacts.push((SquareSide::Bottom, Point2::new(x.clamp(0.0, 1.0), 1.0)));
        }
    }

    contacts.sort_by(|left, right| {
        left.0.cmp(&right.0).then_with(|| {
            side_coordinate(left.1, left.0).total_cmp(&side_coordinate(right.1, right.0))
        })
    });
    contacts.dedup_by(|left, right| {
        left.0 == right.0
            && (side_coordinate(left.1, left.0) - side_coordinate(right.1, right.0)).abs()
                <= epsilon
    });
    contacts
}

fn border_edges(
    points_by_side: &BTreeMap<SquareSide, Vec<ArrangementPoint>>,
) -> Vec<ArrangementBorderEdge> {
    let mut edges = Vec::new();
    for side in SquareSide::all() {
        let Some(points) = points_by_side.get(&side) else {
            continue;
        };
        for window in points.windows(2) {
            edges.push(ArrangementBorderEdge {
                side,
                vertices: [window[0].id.clone(), window[1].id.clone()],
            });
        }
    }
    edges
}

fn carrier_intersections(carriers: &[CandidateCarrier], epsilon: f64) -> Vec<CarrierIntersection> {
    let mut intersections = Vec::new();
    for (left_index, left) in carriers.iter().enumerate() {
        for right in carriers.iter().skip(left_index + 1) {
            let det = left.normal.x * right.normal.y - left.normal.y * right.normal.x;
            if det.abs() <= epsilon {
                continue;
            }
            let x = (left.rho * right.normal.y - right.rho * left.normal.y) / det;
            let y = (left.normal.x * right.rho - right.normal.x * left.rho) / det;
            if within_unit(x, epsilon) && within_unit(y, epsilon) {
                intersections.push(CarrierIntersection {
                    carriers: [left.id, right.id],
                    point: Point2::new(x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)),
                });
            }
        }
    }
    intersections
}

fn within_unit(value: f64, epsilon: f64) -> bool {
    value >= -epsilon && value <= 1.0 + epsilon
}

fn near(value: f64, target: f64, epsilon: f64) -> bool {
    (value - target).abs() <= epsilon
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AssignmentCandidate, AssignmentLabel, CandidateEdge, CandidateVertex, CarrierFamily,
        EdgeSelection, EvidenceSource, Provenance, VertexKind,
    };

    #[test]
    fn empty_program_yields_exact_square_border() {
        let arrangement =
            build_square_arrangement(&empty_program(Vec::new(), Vec::new()), Default::default());

        assert_eq!(arrangement.summary().boundary_points, 8);
        assert_eq!(arrangement.border_edges.len(), 4);
        assert_eq!(
            arrangement.border_edges[0].vertices,
            ["corner_tl", "corner_tr"]
        );
        assert_eq!(
            arrangement.border_edges[1].vertices,
            ["corner_tr", "corner_br"]
        );
        assert_eq!(
            arrangement.border_edges[2].vertices,
            ["corner_br", "corner_bl"]
        );
        assert_eq!(
            arrangement.border_edges[3].vertices,
            ["corner_bl", "corner_tl"]
        );
    }

    #[test]
    fn boundary_vertices_are_side_sorted_without_duplicating_corners() {
        let vertices = vec![
            vertex(0, 0.0, 0.0),
            vertex(1, 0.75, 0.0),
            vertex(2, 0.25, 0.0),
            vertex(3, 1.0, 0.5),
        ];
        let arrangement =
            build_square_arrangement(&empty_program(vertices, Vec::new()), Default::default());
        let top = &arrangement.points_by_side[&SquareSide::Top];
        let top_ids: Vec<&str> = top.iter().map(|point| point.id.as_str()).collect();

        assert_eq!(top_ids, vec!["corner_tl", "v2", "v1", "corner_tr"]);
        assert_eq!(top[0].kind, ArrangementPointKind::Corner);
        assert_eq!(top[0].source_vertex_id, None);
    }

    #[test]
    fn carrier_crossing_square_creates_two_boundary_contacts() {
        let carrier = CandidateCarrier {
            id: 7,
            family: CarrierFamily::Vertical,
            normal: Point2::new(1.0, 0.0),
            rho: 0.5,
            support_interval: [0.0, 1.0],
            visual_support: 1.0,
            dashed_support: 0.0,
            non_crease_penalty: 0.0,
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::LegacyDecoder],
        };
        let arrangement = build_square_arrangement(
            &empty_program(Vec::new(), vec![carrier]),
            Default::default(),
        );

        let top = &arrangement.points_by_side[&SquareSide::Top];
        let bottom = &arrangement.points_by_side[&SquareSide::Bottom];
        assert!(top.iter().any(|point| point.source_carrier_id == Some(7)));
        assert!(
            bottom
                .iter()
                .any(|point| point.source_carrier_id == Some(7))
        );
    }

    #[test]
    fn carrier_intersections_inside_square_are_reported() {
        let vertical = carrier(1, Point2::new(1.0, 0.0), 0.5);
        let horizontal = carrier(2, Point2::new(0.0, 1.0), 0.25);
        let arrangement = build_square_arrangement(
            &empty_program(Vec::new(), vec![vertical, horizontal]),
            Default::default(),
        );

        assert_eq!(arrangement.carrier_intersections.len(), 1);
        assert_eq!(
            arrangement.carrier_intersections[0].point,
            Point2::new(0.5, 0.25)
        );
    }

    fn empty_program(
        vertices: Vec<CandidateVertex>,
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

    fn vertex(id: usize, x: f64, y: f64) -> CandidateVertex {
        CandidateVertex {
            id,
            position: Point2::new(x, y),
            kind: VertexKind::Boundary,
            support: 1.0,
            boundary_side: None,
            incident_carriers: Vec::new(),
            provenance: vec![Provenance::LegacyDecoder],
        }
    }

    fn carrier(id: usize, normal: Point2, rho: f64) -> CandidateCarrier {
        CandidateCarrier {
            id,
            family: CarrierFamily::Free,
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

    #[allow(dead_code)]
    fn edge(id: usize, vertices: [usize; 2]) -> CandidateEdge {
        CandidateEdge {
            id,
            carrier_id: id,
            vertices,
            assignment: AssignmentCandidate {
                label: AssignmentLabel::Boundary,
                confidence: 1.0,
                margin: 0.0,
            },
            line_support: 1.0,
            style_support: 0.0,
            selection: EdgeSelection::Selected,
            source: EvidenceSource::Border,
            provenance: vec![Provenance::BorderPrior],
        }
    }
}
