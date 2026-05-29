//! Local exactizability probes for the compiler V2 architecture.
//!
//! These probes score whether a selected candidate graph looks locally
//! exactizable without mutating geometry. Full coordinate solving belongs to
//! `exact_solve`.

use crate::arrangement_v2::{
    ArrangementAtomicEdge, ArrangementBoundarySide, ArrangementCarrier, ArrangementCarrierKind,
    ArrangementVertex, ArrangementVertexKind, CandidateArrangement,
};
use crate::selection::CandidateSelection;
use crate::{AssignmentLabel, Point2};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const SCHEMA: &str = "oristudio/cp-compiler/exactizability-probe-v2";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ExactProbeOptions {
    pub angle_epsilon_degrees: f64,
    pub low_cost_residual_degrees: f64,
    pub max_exactizable_residual_degrees: f64,
    pub low_cost_vertex_move: f64,
    pub max_vertex_move: f64,
    pub high_confidence_support: f64,
    pub high_confidence_move_budget: f64,
    pub carrier_endpoint_move_budget: f64,
    pub boundary_move_budget: f64,
}

impl Default for ExactProbeOptions {
    fn default() -> Self {
        Self {
            angle_epsilon_degrees: 1e-4,
            low_cost_residual_degrees: 2.0,
            max_exactizable_residual_degrees: 12.0,
            low_cost_vertex_move: 0.010,
            max_vertex_move: 0.025,
            high_confidence_support: 0.85,
            high_confidence_move_budget: 0.010,
            carrier_endpoint_move_budget: 0.012,
            boundary_move_budget: 0.002,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExactizabilityReport {
    pub schema: String,
    pub coordinate_space: String,
    pub image_size: u32,
    pub options: ExactProbeOptions,
    pub summary: ExactProbeSummary,
    pub vertex_probes: Vec<VertexExactizabilityProbe>,
    pub carrier_probes: Vec<CarrierExactizabilityProbe>,
    pub boundary_probes: Vec<BoundaryExactizabilityProbe>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExactProbeSummary {
    pub exactizability_evaluated: bool,
    pub vertex_probes: usize,
    pub carrier_probes: usize,
    pub boundary_probes: usize,
    pub feasible: usize,
    pub low_cost: usize,
    pub high_cost: usize,
    pub infeasible: usize,
    pub odd_degree_vertices: usize,
    pub hard_kawasaki_vertices: usize,
    pub max_kawasaki_residual_degrees: f64,
    pub max_estimated_vertex_move: f64,
    pub max_carrier_endpoint_move: f64,
    pub max_boundary_move: f64,
    pub total_estimated_energy: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExactProbeStatus {
    Feasible,
    LowCost,
    HighCost,
    Infeasible,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VertexExactizabilityProbe {
    pub vertex_id: usize,
    pub point: Point2,
    pub degree: usize,
    pub feasible: bool,
    pub status: ExactProbeStatus,
    pub estimated_energy: f64,
    pub max_vertex_move: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residual_before_degrees: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residual_after_degrees: Option<f64>,
    pub ray_angles_degrees: Vec<f64>,
    pub sector_angles_degrees: Vec<f64>,
    pub incident_edge_ids: Vec<usize>,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CarrierExactizabilityProbe {
    pub carrier_id: usize,
    pub carrier_kind: ArrangementCarrierKind,
    pub selected_edges: usize,
    pub feasible: bool,
    pub status: ExactProbeStatus,
    pub estimated_energy: f64,
    pub max_endpoint_move: f64,
    pub mean_endpoint_move: f64,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BoundaryExactizabilityProbe {
    pub vertex_id: usize,
    pub point: Point2,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<ArrangementBoundarySide>,
    pub feasible: bool,
    pub status: ExactProbeStatus,
    pub estimated_energy: f64,
    pub max_vertex_move: f64,
    pub residual_before: f64,
    pub residual_after: f64,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone)]
struct IncidentEdgeRay {
    edge_id: usize,
    angle_degrees: f64,
    length: f64,
    line_support: f64,
}

pub fn probe_exactizability(
    arrangement: &CandidateArrangement,
    selection: &CandidateSelection,
    options: ExactProbeOptions,
) -> ExactizabilityReport {
    let vertices = arrangement
        .vertices
        .iter()
        .map(|vertex| (vertex.id, vertex))
        .collect::<BTreeMap<_, _>>();
    let edges = arrangement
        .atomic_edges
        .iter()
        .map(|edge| (edge.id, edge))
        .collect::<BTreeMap<_, _>>();
    let carriers = arrangement
        .carriers
        .iter()
        .map(|carrier| (carrier.id, carrier))
        .collect::<BTreeMap<_, _>>();
    let selected_edge_ids = selection
        .selected_edge_ids
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    let selected_edges = selection
        .selected_edge_ids
        .iter()
        .filter_map(|edge_id| edges.get(edge_id).copied())
        .collect::<Vec<_>>();

    let vertex_probes = vertex_probes(&vertices, &selected_edges, &options);
    let carrier_probes = carrier_probes(&vertices, &carriers, &selected_edges, &options);
    let boundary_probes = boundary_probes(&vertices, &selected_edges, &selected_edge_ids, &options);
    let summary = ExactProbeSummary::from_probes(&vertex_probes, &carrier_probes, &boundary_probes);

    ExactizabilityReport {
        schema: SCHEMA.to_owned(),
        coordinate_space: arrangement.coordinate_space.clone(),
        image_size: arrangement.image_size,
        options,
        summary,
        vertex_probes,
        carrier_probes,
        boundary_probes,
    }
}

fn vertex_probes(
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    selected_edges: &[&ArrangementAtomicEdge],
    options: &ExactProbeOptions,
) -> Vec<VertexExactizabilityProbe> {
    let mut incident = BTreeMap::<usize, Vec<IncidentEdgeRay>>::new();
    for edge in selected_edges {
        if matches!(
            edge.assignment.label,
            AssignmentLabel::Boundary | AssignmentLabel::Flat
        ) {
            continue;
        }
        let Some(a) = vertices.get(&edge.vertices[0]).copied() else {
            continue;
        };
        let Some(b) = vertices.get(&edge.vertices[1]).copied() else {
            continue;
        };
        incident.entry(a.id).or_default().push(ray(edge, a, b));
        incident.entry(b.id).or_default().push(ray(edge, b, a));
    }

    incident
        .into_iter()
        .filter_map(|(vertex_id, mut rays)| {
            let vertex = vertices.get(&vertex_id).copied()?;
            if !is_interior_vertex(vertex) {
                return None;
            }
            rays.sort_by(|left, right| left.angle_degrees.total_cmp(&right.angle_degrees));
            Some(vertex_probe(vertex, &rays, options))
        })
        .collect()
}

fn vertex_probe(
    vertex: &ArrangementVertex,
    rays: &[IncidentEdgeRay],
    options: &ExactProbeOptions,
) -> VertexExactizabilityProbe {
    let degree = rays.len();
    let incident_edge_ids = rays.iter().map(|ray| ray.edge_id).collect::<Vec<_>>();
    let sector_angles = sector_angles(rays);
    let residual = kawasaki_residual(&sector_angles);
    let min_length = rays
        .iter()
        .map(|ray| ray.length)
        .filter(|length| *length > 1e-9)
        .fold(f64::INFINITY, f64::min);
    let max_support = rays.iter().map(|ray| ray.line_support).fold(0.0, f64::max);
    let mut blockers = Vec::new();
    let mut estimated_move = 0.0;
    let mut estimated_energy = 0.0;
    let status = if degree == 0 {
        ExactProbeStatus::Feasible
    } else if degree % 2 == 1 {
        blockers.push("odd degree cannot be fixed by geometry-only exactization".to_owned());
        ExactProbeStatus::Infeasible
    } else if let Some(residual) = residual {
        estimated_move = estimate_vertex_move(residual, min_length);
        estimated_energy = residual * residual * 0.01 + estimated_move * estimated_move * 1_000.0;
        if residual <= options.angle_epsilon_degrees {
            ExactProbeStatus::Feasible
        } else if residual > options.max_exactizable_residual_degrees
            || estimated_move > options.max_vertex_move
        {
            blockers.push("Kawasaki residual exceeds local movement budget".to_owned());
            ExactProbeStatus::Infeasible
        } else if max_support >= options.high_confidence_support
            && estimated_move > options.high_confidence_move_budget
        {
            blockers.push("would move high-confidence visual evidence too far".to_owned());
            ExactProbeStatus::HighCost
        } else if residual <= options.low_cost_residual_degrees
            && estimated_move <= options.low_cost_vertex_move
        {
            ExactProbeStatus::LowCost
        } else {
            ExactProbeStatus::HighCost
        }
    } else {
        blockers.push("Kawasaki is not evaluable for this local topology".to_owned());
        ExactProbeStatus::Infeasible
    };
    let feasible = status != ExactProbeStatus::Infeasible;
    VertexExactizabilityProbe {
        vertex_id: vertex.id,
        point: vertex.point,
        degree,
        feasible,
        status,
        estimated_energy: round6(estimated_energy),
        max_vertex_move: round6(estimated_move),
        residual_before_degrees: residual.map(round6),
        residual_after_degrees: residual.map(|value| if feasible { 0.0 } else { round6(value) }),
        ray_angles_degrees: rays.iter().map(|ray| round6(ray.angle_degrees)).collect(),
        sector_angles_degrees: sector_angles.into_iter().map(round6).collect(),
        incident_edge_ids,
        blockers,
    }
}

fn carrier_probes(
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    selected_edges: &[&ArrangementAtomicEdge],
    options: &ExactProbeOptions,
) -> Vec<CarrierExactizabilityProbe> {
    let mut by_carrier = BTreeMap::<usize, Vec<&ArrangementAtomicEdge>>::new();
    for edge in selected_edges {
        by_carrier.entry(edge.carrier_id).or_default().push(*edge);
    }
    by_carrier
        .into_iter()
        .filter_map(|(carrier_id, edges)| {
            let carrier = carriers.get(&carrier_id).copied()?;
            let mut distances = Vec::new();
            for edge in &edges {
                for vertex_id in edge.vertices {
                    if let Some(vertex) = vertices.get(&vertex_id) {
                        distances.push(point_line_distance(vertex.point, carrier));
                    }
                }
            }
            if distances.is_empty() {
                return None;
            }
            let max_endpoint_move = distances.iter().copied().fold(0.0, f64::max);
            let mean_endpoint_move = distances.iter().sum::<f64>() / distances.len() as f64;
            let estimated_energy = max_endpoint_move * max_endpoint_move * 1_000.0
                + mean_endpoint_move * mean_endpoint_move * 500.0;
            let mut blockers = Vec::new();
            let status = if max_endpoint_move <= 1e-9 {
                ExactProbeStatus::Feasible
            } else if max_endpoint_move <= options.carrier_endpoint_move_budget {
                ExactProbeStatus::LowCost
            } else if max_endpoint_move <= options.max_vertex_move {
                ExactProbeStatus::HighCost
            } else {
                blockers.push("selected endpoints are too far from carrier line".to_owned());
                ExactProbeStatus::Infeasible
            };
            Some(CarrierExactizabilityProbe {
                carrier_id,
                carrier_kind: carrier.kind,
                selected_edges: edges.len(),
                feasible: status != ExactProbeStatus::Infeasible,
                status,
                estimated_energy: round6(estimated_energy),
                max_endpoint_move: round6(max_endpoint_move),
                mean_endpoint_move: round6(mean_endpoint_move),
                blockers,
            })
        })
        .collect()
}

fn boundary_probes(
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    selected_edges: &[&ArrangementAtomicEdge],
    _selected_edge_ids: &BTreeSet<usize>,
    options: &ExactProbeOptions,
) -> Vec<BoundaryExactizabilityProbe> {
    let touched_boundary_vertices = selected_edges
        .iter()
        .flat_map(|edge| edge.vertices)
        .filter(|vertex_id| vertices.contains_key(vertex_id))
        .collect::<BTreeSet<_>>();
    touched_boundary_vertices
        .into_iter()
        .filter_map(|vertex_id| {
            let vertex = vertices.get(&vertex_id).copied()?;
            if !matches!(
                vertex.kind,
                ArrangementVertexKind::BoundaryContact | ArrangementVertexKind::Corner
            ) && vertex.boundary_side.is_none()
            {
                return None;
            }
            let side = vertex
                .boundary_side
                .or_else(|| closest_boundary_side(vertex.point));
            let residual = side
                .map(|side| boundary_distance(vertex.point, side))
                .unwrap_or_else(|| distance_to_square(vertex.point));
            let mut blockers = Vec::new();
            let status = if residual <= 1e-9 {
                ExactProbeStatus::Feasible
            } else if residual <= options.boundary_move_budget {
                ExactProbeStatus::LowCost
            } else if residual <= options.max_vertex_move {
                ExactProbeStatus::HighCost
            } else {
                blockers.push("boundary contact is too far from the square boundary".to_owned());
                ExactProbeStatus::Infeasible
            };
            Some(BoundaryExactizabilityProbe {
                vertex_id,
                point: vertex.point,
                side,
                feasible: status != ExactProbeStatus::Infeasible,
                status,
                estimated_energy: round6(residual * residual * 1_000.0),
                max_vertex_move: round6(residual),
                residual_before: round6(residual),
                residual_after: if status == ExactProbeStatus::Infeasible {
                    round6(residual)
                } else {
                    0.0
                },
                blockers,
            })
        })
        .collect()
}

impl ExactProbeSummary {
    fn from_probes(
        vertex_probes: &[VertexExactizabilityProbe],
        carrier_probes: &[CarrierExactizabilityProbe],
        boundary_probes: &[BoundaryExactizabilityProbe],
    ) -> Self {
        let statuses = vertex_probes
            .iter()
            .map(|probe| probe.status)
            .chain(carrier_probes.iter().map(|probe| probe.status))
            .chain(boundary_probes.iter().map(|probe| probe.status))
            .collect::<Vec<_>>();
        Self {
            exactizability_evaluated: true,
            vertex_probes: vertex_probes.len(),
            carrier_probes: carrier_probes.len(),
            boundary_probes: boundary_probes.len(),
            feasible: statuses
                .iter()
                .filter(|status| **status == ExactProbeStatus::Feasible)
                .count(),
            low_cost: statuses
                .iter()
                .filter(|status| **status == ExactProbeStatus::LowCost)
                .count(),
            high_cost: statuses
                .iter()
                .filter(|status| **status == ExactProbeStatus::HighCost)
                .count(),
            infeasible: statuses
                .iter()
                .filter(|status| **status == ExactProbeStatus::Infeasible)
                .count(),
            odd_degree_vertices: vertex_probes
                .iter()
                .filter(|probe| probe.degree % 2 == 1)
                .count(),
            hard_kawasaki_vertices: vertex_probes
                .iter()
                .filter(|probe| {
                    probe
                        .residual_before_degrees
                        .is_some_and(|residual| residual > 12.0)
                })
                .count(),
            max_kawasaki_residual_degrees: round6(
                vertex_probes
                    .iter()
                    .filter_map(|probe| probe.residual_before_degrees)
                    .fold(0.0, f64::max),
            ),
            max_estimated_vertex_move: round6(
                vertex_probes
                    .iter()
                    .map(|probe| probe.max_vertex_move)
                    .fold(0.0, f64::max),
            ),
            max_carrier_endpoint_move: round6(
                carrier_probes
                    .iter()
                    .map(|probe| probe.max_endpoint_move)
                    .fold(0.0, f64::max),
            ),
            max_boundary_move: round6(
                boundary_probes
                    .iter()
                    .map(|probe| probe.max_vertex_move)
                    .fold(0.0, f64::max),
            ),
            total_estimated_energy: round6(
                vertex_probes
                    .iter()
                    .map(|probe| probe.estimated_energy)
                    .chain(carrier_probes.iter().map(|probe| probe.estimated_energy))
                    .chain(boundary_probes.iter().map(|probe| probe.estimated_energy))
                    .sum(),
            ),
        }
    }
}

fn ray(
    edge: &ArrangementAtomicEdge,
    origin: &ArrangementVertex,
    target: &ArrangementVertex,
) -> IncidentEdgeRay {
    IncidentEdgeRay {
        edge_id: edge.id,
        angle_degrees: angle_degrees(origin.point, target.point),
        length: distance(origin.point, target.point),
        line_support: edge.line_support,
    }
}

fn sector_angles(rays: &[IncidentEdgeRay]) -> Vec<f64> {
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

fn estimate_vertex_move(residual_degrees: f64, min_length: f64) -> f64 {
    if !min_length.is_finite() {
        return 0.0;
    }
    min_length * (0.5 * residual_degrees.to_radians()).tan().abs()
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

fn point_line_distance(point: Point2, carrier: &ArrangementCarrier) -> f64 {
    (point.x * carrier.normal.x + point.y * carrier.normal.y - carrier.rho).abs()
}

fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn is_interior_vertex(vertex: &ArrangementVertex) -> bool {
    !matches!(
        vertex.kind,
        ArrangementVertexKind::BoundaryContact | ArrangementVertexKind::Corner
    ) && vertex.boundary_side.is_none()
}

fn boundary_distance(point: Point2, side: ArrangementBoundarySide) -> f64 {
    match side {
        ArrangementBoundarySide::Top => point.y.abs(),
        ArrangementBoundarySide::Right => (point.x - 1.0).abs(),
        ArrangementBoundarySide::Bottom => (point.y - 1.0).abs(),
        ArrangementBoundarySide::Left => point.x.abs(),
    }
}

fn closest_boundary_side(point: Point2) -> Option<ArrangementBoundarySide> {
    let distances = [
        (ArrangementBoundarySide::Top, point.y.abs()),
        (ArrangementBoundarySide::Right, (point.x - 1.0).abs()),
        (ArrangementBoundarySide::Bottom, (point.y - 1.0).abs()),
        (ArrangementBoundarySide::Left, point.x.abs()),
    ];
    distances
        .into_iter()
        .min_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(side, _)| side)
}

fn distance_to_square(point: Point2) -> f64 {
    [
        point.y.abs(),
        (point.x - 1.0).abs(),
        (point.y - 1.0).abs(),
        point.x.abs(),
    ]
    .into_iter()
    .fold(f64::INFINITY, f64::min)
}

fn round6(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arrangement_v2::{
        ArrangementCarrier, ArrangementCarrierKind, ArrangementV2Options,
        CandidateArrangementReport,
    };
    use crate::selection::{CandidateSelection, SelectionOptions, select_candidate_graph};
    use crate::{EvidenceSource, Provenance};

    #[test]
    fn small_kawasaki_residual_is_low_cost_if_movement_is_small() {
        let arrangement = star(&[
            (0.0, AssignmentLabel::Mountain),
            (90.0, AssignmentLabel::Mountain),
            (180.0, AssignmentLabel::Mountain),
            (270.5, AssignmentLabel::Valley),
        ]);
        let selection = select_all(&arrangement);
        let report = probe_exactizability(&arrangement, &selection, ExactProbeOptions::default());
        let center = report
            .vertex_probes
            .iter()
            .find(|probe| probe.vertex_id == 0)
            .expect("center probe");

        assert_eq!(center.status, ExactProbeStatus::LowCost);
        assert!(center.feasible);
        assert_eq!(center.residual_after_degrees, Some(0.0));
    }

    #[test]
    fn odd_degree_is_infeasible_by_geometry_only_exactization() {
        let arrangement = star(&[
            (0.0, AssignmentLabel::Mountain),
            (120.0, AssignmentLabel::Valley),
            (240.0, AssignmentLabel::Mountain),
        ]);
        let selection = select_all(&arrangement);
        let report = probe_exactizability(&arrangement, &selection, ExactProbeOptions::default());
        let center = report
            .vertex_probes
            .iter()
            .find(|probe| probe.vertex_id == 0)
            .expect("center probe");

        assert_eq!(center.status, ExactProbeStatus::Infeasible);
        assert!(
            center
                .blockers
                .iter()
                .any(|blocker| blocker.contains("odd degree"))
        );
    }

    #[test]
    fn high_confidence_large_move_is_high_cost() {
        let arrangement = star(&[
            (0.0, AssignmentLabel::Mountain),
            (80.0, AssignmentLabel::Mountain),
            (180.0, AssignmentLabel::Mountain),
            (270.0, AssignmentLabel::Valley),
        ]);
        let selection = select_all(&arrangement);
        let options = ExactProbeOptions {
            max_exactizable_residual_degrees: 30.0,
            max_vertex_move: 0.20,
            high_confidence_move_budget: 0.001,
            ..ExactProbeOptions::default()
        };
        let report = probe_exactizability(&arrangement, &selection, options);
        let center = report
            .vertex_probes
            .iter()
            .find(|probe| probe.vertex_id == 0)
            .expect("center probe");

        assert_eq!(center.status, ExactProbeStatus::HighCost);
        assert!(
            center
                .blockers
                .iter()
                .any(|blocker| blocker.contains("high-confidence"))
        );
    }

    #[test]
    fn boundary_vertices_are_checked_against_the_square() {
        let mut arrangement = star(&[
            (0.0, AssignmentLabel::Mountain),
            (90.0, AssignmentLabel::Mountain),
            (180.0, AssignmentLabel::Mountain),
            (270.0, AssignmentLabel::Valley),
        ]);
        let boundary_id = arrangement.vertices.len();
        arrangement.vertices.push(ArrangementVertex {
            id: boundary_id,
            point: Point2::new(1.003, 0.5),
            kind: ArrangementVertexKind::BoundaryContact,
            support: 0.8,
            carrier_ids: Vec::new(),
            boundary_side: Some(ArrangementBoundarySide::Right),
            primitive_ids: Vec::new(),
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::ObservedStrong],
        });
        let edge_id = arrangement.atomic_edges.len();
        arrangement.atomic_edges.push(ArrangementAtomicEdge {
            id: edge_id,
            carrier_id: 0,
            vertices: [0, boundary_id],
            t_interval: [0.0, 1.0],
            line_support: 0.9,
            support_overlap: 0.9,
            style_support: 0.0,
            assignment: assignment(AssignmentLabel::Mountain),
            source: EvidenceSource::ObservedStrong,
            hypothesis_ids: Vec::new(),
            provenance: vec![Provenance::ObservedStrong],
        });
        let selection = select_all(&arrangement);
        let report = probe_exactizability(&arrangement, &selection, ExactProbeOptions::default());
        let boundary = report
            .boundary_probes
            .iter()
            .find(|probe| probe.vertex_id == boundary_id)
            .expect("boundary probe");

        assert_eq!(boundary.status, ExactProbeStatus::HighCost);
        assert_eq!(boundary.residual_after, 0.0);
    }

    fn star(rays: &[(f64, AssignmentLabel)]) -> CandidateArrangement {
        let mut vertices = vec![ArrangementVertex {
            id: 0,
            point: Point2::new(0.0, 0.0),
            kind: ArrangementVertexKind::ObservedJunction,
            support: 1.0,
            carrier_ids: Vec::new(),
            boundary_side: None,
            primitive_ids: Vec::new(),
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::ObservedStrong],
        }];
        let mut carriers = Vec::new();
        let mut atomic_edges = Vec::new();
        for (index, (angle, label)) in rays.iter().enumerate() {
            let radians = angle.to_radians();
            let vertex_id = index + 1;
            let point = Point2::new(radians.cos(), radians.sin());
            vertices.push(ArrangementVertex {
                id: vertex_id,
                point,
                kind: ArrangementVertexKind::ObservedJunction,
                support: 1.0,
                carrier_ids: Vec::new(),
                boundary_side: None,
                primitive_ids: Vec::new(),
                source: EvidenceSource::ObservedStrong,
                provenance: vec![Provenance::ObservedStrong],
            });
            carriers.push(carrier(index, *angle));
            atomic_edges.push(ArrangementAtomicEdge {
                id: index,
                carrier_id: index,
                vertices: [0, vertex_id],
                t_interval: [0.0, 1.0],
                line_support: 0.9,
                support_overlap: 0.9,
                style_support: 0.0,
                assignment: assignment(*label),
                source: EvidenceSource::ObservedStrong,
                hypothesis_ids: Vec::new(),
                provenance: vec![Provenance::ObservedStrong],
            });
        }
        CandidateArrangement {
            schema: "test".to_owned(),
            coordinate_space: "unit_square".to_owned(),
            image_size: 101,
            options: ArrangementV2Options::default(),
            carriers,
            vertices,
            atomic_edges,
            hypotheses: Vec::new(),
            report: CandidateArrangementReport {
                observed_carriers: rays.len(),
                shared_carrier_alternatives: 0,
                carriers: rays.len(),
                corners: 0,
                observed_junctions: rays.len() + 1,
                junction_clusters: 0,
                boundary_contacts: 0,
                carrier_intersections: 0,
                suppressed_carrier_intersections: 0,
                line_endpoints: 0,
                vertices: rays.len() + 1,
                atomic_edges: rays.len(),
                hypotheses: 0,
                selected_edges: 0,
                emits_fold_graph: false,
            },
        }
    }

    fn carrier(id: usize, angle_degrees: f64) -> ArrangementCarrier {
        let radians = angle_degrees.to_radians();
        let direction = Point2::new(radians.cos(), radians.sin());
        let normal = Point2::new(-direction.y, direction.x);
        ArrangementCarrier {
            id,
            kind: ArrangementCarrierKind::ObservedLocal,
            primitive_ids: vec![id],
            normal,
            direction,
            rho: 0.0,
            support_interval: [0.0, 1.0],
            visual_support: 0.9,
            style_support: 0.0,
            assignment: assignment(AssignmentLabel::Mountain),
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::ObservedStrong],
            hypothesis_cost: 0.0,
        }
    }

    fn select_all(arrangement: &CandidateArrangement) -> CandidateSelection {
        let mut selection = select_candidate_graph(arrangement, SelectionOptions::default());
        selection.selected_edge_ids = arrangement
            .atomic_edges
            .iter()
            .map(|edge| edge.id)
            .collect();
        for score in &mut selection.edge_scores {
            score.decision = crate::selection::SelectionDecision::Selected;
        }
        selection
    }

    fn assignment(label: AssignmentLabel) -> crate::AssignmentCandidate {
        crate::AssignmentCandidate {
            label,
            confidence: 1.0,
            margin: 1.0,
        }
    }
}
