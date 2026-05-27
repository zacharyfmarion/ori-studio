use crate::arrangement::SquareSide;
use crate::constraints::{ConstraintDiagnosticOptions, ConstraintSeverity, diagnose_constraints};
use crate::{AssignmentLabel, CandidateProgram, EdgeSelection, Point2, Provenance};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RepairCandidateOptions {
    pub angle_tolerance_degrees: f64,
    pub vertex_target_distance: f64,
    pub weak_line_support_threshold: f64,
    pub low_assignment_confidence_threshold: f64,
    pub merge_distance: f64,
}

impl Default for RepairCandidateOptions {
    fn default() -> Self {
        Self {
            angle_tolerance_degrees: 2.0,
            vertex_target_distance: 0.04,
            weak_line_support_threshold: 0.45,
            low_assignment_confidence_threshold: 0.7,
            merge_distance: 0.01,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepairCandidateSet {
    pub candidates: Vec<RepairCandidate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepairCandidate {
    pub kind: RepairCandidateKind,
    pub score: f64,
    pub reason: String,
    pub provenance: Vec<Provenance>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum RepairCandidateKind {
    AddMissingCrease {
        vertex_id: usize,
        angle_degrees: f64,
        target: RepairTarget,
    },
    DropWeakCrease {
        edge_id: usize,
    },
    MergeVertices {
        vertices: [usize; 2],
    },
    SplitAtCarrierIntersection {
        carriers: [usize; 2],
        point: Point2,
    },
    ChangeAssignment {
        edge_id: usize,
        from: AssignmentLabel,
        to: AssignmentLabel,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "target")]
pub enum RepairTarget {
    ExistingVertex { vertex_id: usize, point: Point2 },
    BoundaryContact { side: SquareSide, point: Point2 },
}

#[derive(Debug, Clone)]
struct IncidentEdge {
    edge_id: usize,
    angle_degrees: f64,
    assignment: AssignmentLabel,
    line_support: f64,
    assignment_confidence: f64,
}

pub fn generate_repair_candidates(
    program: &CandidateProgram,
    options: RepairCandidateOptions,
) -> RepairCandidateSet {
    let diagnostics = diagnose_constraints(program, ConstraintDiagnosticOptions::default());
    let incident = incident_edges(program);
    let mut candidates = Vec::new();

    for diagnostic in &diagnostics.vertices {
        let vertex_id = diagnostic.vertex_id;
        let Some(vertex) = program
            .vertices
            .iter()
            .find(|vertex| vertex.id == vertex_id)
        else {
            continue;
        };
        let rays = incident.get(vertex_id).cloned().unwrap_or_default();
        match diagnostic.severity {
            ConstraintSeverity::OddDegreeTopologyFailure => {
                candidates.extend(missing_crease_candidates(
                    program,
                    vertex.position,
                    vertex_id,
                    &rays,
                    options,
                    "odd degree can be made even while satisfying Kawasaki",
                ));
            }
            ConstraintSeverity::HardKawasakiFailure => {
                candidates.extend(drop_weak_candidates(&rays, options));
                candidates.extend(split_intersection_candidates(program, options));
            }
            ConstraintSeverity::MaekawaAssignmentFailure => {
                candidates.extend(assignment_candidates(&rays, options));
            }
            _ => {}
        }
    }

    candidates.extend(global_weak_drop_candidates(program, options));
    candidates.extend(merge_vertex_candidates(program, options));
    dedupe_candidates(&mut candidates);
    candidates.sort_by(|left, right| right.score.total_cmp(&left.score));
    RepairCandidateSet { candidates }
}

fn incident_edges(program: &CandidateProgram) -> Vec<Vec<IncidentEdge>> {
    let mut incident = vec![Vec::new(); program.vertices.len()];
    for edge in &program.edges {
        if edge.selection != EdgeSelection::Selected {
            continue;
        }
        if matches!(
            edge.assignment.label,
            AssignmentLabel::Boundary | AssignmentLabel::Flat
        ) {
            continue;
        }
        let [a, b] = edge.vertices;
        let Some(vertex_a) = program.vertices.get(a) else {
            continue;
        };
        let Some(vertex_b) = program.vertices.get(b) else {
            continue;
        };
        incident[a].push(IncidentEdge {
            edge_id: edge.id,
            angle_degrees: angle_degrees(vertex_a.position, vertex_b.position),
            assignment: edge.assignment.label,
            line_support: edge.line_support,
            assignment_confidence: edge.assignment.confidence,
        });
        incident[b].push(IncidentEdge {
            edge_id: edge.id,
            angle_degrees: angle_degrees(vertex_b.position, vertex_a.position),
            assignment: edge.assignment.label,
            line_support: edge.line_support,
            assignment_confidence: edge.assignment.confidence,
        });
    }
    for edges in &mut incident {
        edges.sort_by(|left, right| left.angle_degrees.total_cmp(&right.angle_degrees));
    }
    incident
}

fn missing_crease_candidates(
    program: &CandidateProgram,
    origin: Point2,
    vertex_id: usize,
    rays: &[IncidentEdge],
    options: RepairCandidateOptions,
    reason: &str,
) -> Vec<RepairCandidate> {
    let mut candidates = Vec::new();
    if rays.len() < 3 {
        return candidates;
    }
    let sectors = sectors_from_angles(rays.iter().map(|ray| ray.angle_degrees).collect());
    for gap_index in 0..sectors.len() {
        let gap = sectors[gap_index];
        if gap <= options.angle_tolerance_degrees {
            continue;
        }
        let Some(offset) = kawasaki_balancing_offset(&sectors, gap_index) else {
            continue;
        };
        if offset <= options.angle_tolerance_degrees
            || offset >= gap - options.angle_tolerance_degrees
        {
            continue;
        }
        let angle = (rays[gap_index].angle_degrees + offset).rem_euclid(360.0);
        let target = target_for_ray(program, origin, vertex_id, angle, options);
        let length = target_distance(origin, &target);
        candidates.push(RepairCandidate {
            kind: RepairCandidateKind::AddMissingCrease {
                vertex_id,
                angle_degrees: round_degrees(angle),
                target,
            },
            score: 1.0 / (1.0 + length),
            reason: reason.to_owned(),
            provenance: vec![Provenance::InferredByKawasaki],
        });
    }
    candidates
}

fn kawasaki_balancing_offset(sectors: &[f64], gap_index: usize) -> Option<f64> {
    let gap = *sectors.get(gap_index)?;
    let residual_at_start = signed_residual_with_split(sectors, gap_index, 0.0)?;
    let residual_at_end = signed_residual_with_split(sectors, gap_index, gap)?;
    let denom = residual_at_end - residual_at_start;
    if denom.abs() < 1e-9 {
        return None;
    }
    let offset = -residual_at_start * gap / denom;
    (offset.is_finite() && offset >= 0.0 && offset <= gap).then_some(offset)
}

fn signed_residual_with_split(sectors: &[f64], gap_index: usize, offset: f64) -> Option<f64> {
    let gap = *sectors.get(gap_index)?;
    let mut next = Vec::with_capacity(sectors.len() + 1);
    for (index, sector) in sectors.iter().copied().enumerate() {
        if index == gap_index {
            next.push(offset);
            next.push(gap - offset);
        } else {
            next.push(sector);
        }
    }
    if next.len() % 2 == 1 {
        return None;
    }
    let even = next.iter().step_by(2).sum::<f64>();
    let odd = next.iter().skip(1).step_by(2).sum::<f64>();
    Some(even - odd)
}

fn sectors_from_angles(angles: Vec<f64>) -> Vec<f64> {
    if angles.len() < 2 {
        return Vec::new();
    }
    let mut sectors = Vec::with_capacity(angles.len());
    for index in 0..angles.len() {
        let next = (index + 1) % angles.len();
        sectors.push((angles[next] - angles[index]).rem_euclid(360.0));
    }
    sectors
}

fn target_for_ray(
    program: &CandidateProgram,
    origin: Point2,
    vertex_id: usize,
    angle_degrees: f64,
    options: RepairCandidateOptions,
) -> RepairTarget {
    if let Some((target_id, point)) =
        existing_vertex_target(program, origin, vertex_id, angle_degrees, options)
    {
        return RepairTarget::ExistingVertex {
            vertex_id: target_id,
            point,
        };
    }
    boundary_target(origin, angle_degrees).unwrap_or(RepairTarget::BoundaryContact {
        side: SquareSide::Top,
        point: origin,
    })
}

fn existing_vertex_target(
    program: &CandidateProgram,
    origin: Point2,
    vertex_id: usize,
    angle_degrees: f64,
    options: RepairCandidateOptions,
) -> Option<(usize, Point2)> {
    let direction = unit_direction(angle_degrees);
    program
        .vertices
        .iter()
        .filter(|vertex| vertex.id != vertex_id)
        .filter_map(|vertex| {
            let delta = Point2::new(vertex.position.x - origin.x, vertex.position.y - origin.y);
            let along = delta.x * direction.x + delta.y * direction.y;
            if along <= 0.0 {
                return None;
            }
            let perpendicular = (delta.x * direction.y - delta.y * direction.x).abs();
            (perpendicular <= options.vertex_target_distance).then_some((
                vertex.id,
                vertex.position,
                along,
            ))
        })
        .min_by(|left, right| left.2.total_cmp(&right.2))
        .map(|(id, point, _)| (id, point))
}

fn boundary_target(origin: Point2, angle_degrees: f64) -> Option<RepairTarget> {
    let direction = unit_direction(angle_degrees);
    let mut hits = Vec::new();
    if direction.x.abs() > 1e-12 {
        for (x, side) in [(0.0, SquareSide::Left), (1.0, SquareSide::Right)] {
            let t = (x - origin.x) / direction.x;
            let y = origin.y + t * direction.y;
            if t > 1e-9 && (-1e-9..=1.0 + 1e-9).contains(&y) {
                hits.push((t, side, Point2::new(x, y.clamp(0.0, 1.0))));
            }
        }
    }
    if direction.y.abs() > 1e-12 {
        for (y, side) in [(0.0, SquareSide::Top), (1.0, SquareSide::Bottom)] {
            let t = (y - origin.y) / direction.y;
            let x = origin.x + t * direction.x;
            if t > 1e-9 && (-1e-9..=1.0 + 1e-9).contains(&x) {
                hits.push((t, side, Point2::new(x.clamp(0.0, 1.0), y)));
            }
        }
    }
    hits.sort_by(|left, right| left.0.total_cmp(&right.0));
    hits.first()
        .map(|(_, side, point)| RepairTarget::BoundaryContact {
            side: *side,
            point: *point,
        })
}

fn drop_weak_candidates(
    rays: &[IncidentEdge],
    options: RepairCandidateOptions,
) -> Vec<RepairCandidate> {
    rays.iter()
        .filter(|ray| ray.line_support < options.weak_line_support_threshold)
        .map(|ray| RepairCandidate {
            kind: RepairCandidateKind::DropWeakCrease {
                edge_id: ray.edge_id,
            },
            score: 1.0 - ray.line_support.clamp(0.0, 1.0),
            reason: "weak line evidence participates in hard local geometry failure".to_owned(),
            provenance: vec![Provenance::DeletedLowSupport],
        })
        .collect()
}

fn global_weak_drop_candidates(
    program: &CandidateProgram,
    options: RepairCandidateOptions,
) -> Vec<RepairCandidate> {
    program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected)
        .filter(|edge| {
            !matches!(
                edge.assignment.label,
                AssignmentLabel::Boundary | AssignmentLabel::Flat
            )
        })
        .filter(|edge| edge.line_support < options.weak_line_support_threshold)
        .map(|edge| RepairCandidate {
            kind: RepairCandidateKind::DropWeakCrease { edge_id: edge.id },
            score: 1.0 - edge.line_support.clamp(0.0, 1.0),
            reason: "weak global line evidence".to_owned(),
            provenance: vec![Provenance::DeletedLowSupport],
        })
        .collect()
}

fn assignment_candidates(
    rays: &[IncidentEdge],
    options: RepairCandidateOptions,
) -> Vec<RepairCandidate> {
    rays.iter()
        .filter(|ray| {
            ray.assignment_confidence < options.low_assignment_confidence_threshold
                && matches!(
                    ray.assignment,
                    AssignmentLabel::Mountain | AssignmentLabel::Valley
                )
        })
        .map(|ray| RepairCandidate {
            kind: RepairCandidateKind::ChangeAssignment {
                edge_id: ray.edge_id,
                from: ray.assignment,
                to: opposite(ray.assignment),
            },
            score: 1.0 - ray.assignment_confidence.clamp(0.0, 1.0),
            reason: "low-confidence assignment participates in Maekawa failure".to_owned(),
            provenance: vec![Provenance::AssignmentFlipped],
        })
        .collect()
}

fn merge_vertex_candidates(
    program: &CandidateProgram,
    options: RepairCandidateOptions,
) -> Vec<RepairCandidate> {
    let mut candidates = Vec::new();
    for (left_index, left) in program.vertices.iter().enumerate() {
        for right in program.vertices.iter().skip(left_index + 1) {
            let distance = distance(left.position, right.position);
            if distance > options.merge_distance {
                continue;
            }
            candidates.push(RepairCandidate {
                kind: RepairCandidateKind::MergeVertices {
                    vertices: [left.id, right.id],
                },
                score: 1.0 / (1.0 + distance),
                reason: "near-duplicate vertices can be merged".to_owned(),
                provenance: vec![Provenance::LegacyDecoder],
            });
        }
    }
    candidates
}

fn split_intersection_candidates(
    program: &CandidateProgram,
    options: RepairCandidateOptions,
) -> Vec<RepairCandidate> {
    let mut candidates = Vec::new();
    for (left_index, left) in program.carriers.iter().enumerate() {
        for right in program.carriers.iter().skip(left_index + 1) {
            let det = left.normal.x * right.normal.y - left.normal.y * right.normal.x;
            if det.abs() < 1e-9 {
                continue;
            }
            let x = (left.rho * right.normal.y - right.rho * left.normal.y) / det;
            let y = (left.normal.x * right.rho - right.normal.x * left.rho) / det;
            let point = Point2::new(x, y);
            if !(-1e-9..=1.0 + 1e-9).contains(&x) || !(-1e-9..=1.0 + 1e-9).contains(&y) {
                continue;
            }
            if program
                .vertices
                .iter()
                .any(|vertex| distance(vertex.position, point) <= options.merge_distance)
            {
                continue;
            }
            candidates.push(RepairCandidate {
                kind: RepairCandidateKind::SplitAtCarrierIntersection {
                    carriers: [left.id, right.id],
                    point,
                },
                score: 0.5,
                reason: "carrier intersection has no nearby vertex".to_owned(),
                provenance: vec![Provenance::LegacyDecoder],
            });
        }
    }
    candidates
}

fn dedupe_candidates(candidates: &mut Vec<RepairCandidate>) {
    let mut seen = Vec::<String>::new();
    candidates.retain(|candidate| {
        let key = serde_json::to_string(&candidate.kind).unwrap_or_default();
        if seen.contains(&key) {
            false
        } else {
            seen.push(key);
            true
        }
    });
}

fn opposite(label: AssignmentLabel) -> AssignmentLabel {
    match label {
        AssignmentLabel::Mountain => AssignmentLabel::Valley,
        AssignmentLabel::Valley => AssignmentLabel::Mountain,
        other => other,
    }
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

fn unit_direction(angle_degrees: f64) -> Point2 {
    let radians = angle_degrees.to_radians();
    Point2::new(radians.cos(), radians.sin())
}

fn target_distance(origin: Point2, target: &RepairTarget) -> f64 {
    match target {
        RepairTarget::ExistingVertex { point, .. }
        | RepairTarget::BoundaryContact { point, .. } => distance(origin, *point),
    }
}

fn distance(left: Point2, right: Point2) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
}

fn round_degrees(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AssignmentCandidate, CandidateCarrier, CandidateEdge, CandidateVertex, CarrierFamily,
        EvidenceSource, VertexKind,
    };

    #[test]
    fn degree_three_vertex_produces_kawasaki_missing_crease() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (90.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (180.0, AssignmentLabel::Valley, 1.0, 1.0),
        ]);

        let repairs = generate_repair_candidates(&program, Default::default());

        assert!(repairs.candidates.iter().any(|candidate| matches!(
            candidate.kind,
            RepairCandidateKind::AddMissingCrease {
                vertex_id: 0,
                angle_degrees,
                target: RepairTarget::BoundaryContact { side: SquareSide::Top, .. },
            } if (angle_degrees - 270.0).abs() < 1e-6
        )));
    }

    #[test]
    fn missing_crease_prefers_existing_vertex_target() {
        let mut program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (90.0, AssignmentLabel::Mountain, 1.0, 1.0),
            (180.0, AssignmentLabel::Valley, 1.0, 1.0),
        ]);
        program
            .vertices
            .push(vertex(99, Point2::new(0.5, 0.1), VertexKind::Interior));

        let repairs = generate_repair_candidates(&program, Default::default());

        assert!(repairs.candidates.iter().any(|candidate| matches!(
            candidate.kind,
            RepairCandidateKind::AddMissingCrease {
                target: RepairTarget::ExistingVertex { vertex_id: 99, .. },
                ..
            }
        )));
    }

    #[test]
    fn strong_observed_creases_are_not_drop_candidates() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 0.95, 1.0),
            (60.0, AssignmentLabel::Mountain, 0.95, 1.0),
            (180.0, AssignmentLabel::Mountain, 0.95, 1.0),
            (270.0, AssignmentLabel::Valley, 0.95, 1.0),
        ]);

        let repairs = generate_repair_candidates(&program, Default::default());

        assert!(
            !repairs.candidates.iter().any(|candidate| matches!(
                candidate.kind,
                RepairCandidateKind::DropWeakCrease { .. }
            ))
        );
    }

    #[test]
    fn low_confidence_wrong_assignment_generates_flip_candidate() {
        let program = centered_star(&[
            (0.0, AssignmentLabel::Mountain, 1.0, 0.3),
            (90.0, AssignmentLabel::Valley, 1.0, 0.3),
            (180.0, AssignmentLabel::Mountain, 1.0, 0.3),
            (270.0, AssignmentLabel::Valley, 1.0, 0.3),
        ]);

        let repairs = generate_repair_candidates(&program, Default::default());

        assert!(repairs.candidates.iter().any(|candidate| matches!(
            candidate.kind,
            RepairCandidateKind::ChangeAssignment {
                from: AssignmentLabel::Mountain,
                to: AssignmentLabel::Valley,
                ..
            }
        )));
    }

    fn centered_star(rays: &[(f64, AssignmentLabel, f64, f64)]) -> CandidateProgram {
        let center = Point2::new(0.5, 0.5);
        let mut vertices = vec![vertex(0, center, VertexKind::Interior)];
        let mut edges = Vec::new();
        let mut carriers = Vec::new();
        for (index, (angle, assignment, support, assignment_confidence)) in rays.iter().enumerate()
        {
            let radians = angle.to_radians();
            let endpoint = Point2::new(
                center.x + radians.cos() * 0.4,
                center.y + radians.sin() * 0.4,
            );
            let vertex_id = index + 1;
            vertices.push(vertex(vertex_id, endpoint, VertexKind::Interior));
            edges.push(CandidateEdge {
                id: index,
                carrier_id: index,
                vertices: [0, vertex_id],
                assignment: AssignmentCandidate {
                    label: *assignment,
                    confidence: *assignment_confidence,
                    margin: 1.0,
                },
                line_support: *support,
                style_support: 0.0,
                selection: EdgeSelection::Selected,
                source: EvidenceSource::ObservedStrong,
                provenance: vec![Provenance::LegacyDecoder],
            });
            carriers.push(CandidateCarrier {
                id: index,
                family: CarrierFamily::Free,
                normal: Point2::new(-radians.sin(), radians.cos()),
                rho: 0.0,
                support_interval: [0.0, 1.0],
                visual_support: *support,
                dashed_support: 0.0,
                non_crease_penalty: 0.0,
                source: EvidenceSource::ObservedStrong,
                provenance: vec![Provenance::LegacyDecoder],
            });
        }
        CandidateProgram {
            coordinate_space: "unit_test".to_owned(),
            image_size: None,
            carriers,
            vertices,
            edges,
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
