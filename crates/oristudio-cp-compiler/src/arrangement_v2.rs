//! Candidate planar graph arrangement for the compiler V2 architecture.
//!
//! This stage turns detector evidence into a high-recall candidate space. It
//! intentionally does not choose a final graph: near-collinear carriers,
//! crossings, boundary contacts, and atomic intervals remain alternatives for a
//! later weighted selection stage.

use crate::candidates::{AssignmentCandidate, Point2};
use crate::evidence::{EvidenceSource, Provenance};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const SCHEMA: &str = "oristudio/cp-compiler/candidate-arrangement-v2";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementV2Input {
    pub image_size: u32,
    #[serde(default)]
    pub line_primitives: Vec<ArrangementLinePrimitive>,
    #[serde(default)]
    pub junction_primitives: Vec<ArrangementJunctionPrimitive>,
    #[serde(default)]
    pub boundary_contact_primitives: Vec<ArrangementBoundaryContactPrimitive>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementLinePrimitive {
    pub id: usize,
    pub p0: Point2,
    pub p1: Point2,
    pub support: f64,
    pub votes: usize,
    pub assignment: AssignmentCandidate,
    pub style_support: f64,
    pub source: EvidenceSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementJunctionPrimitive {
    pub id: usize,
    pub point: Point2,
    pub support: f64,
    pub source: EvidenceSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementBoundaryContactPrimitive {
    pub id: usize,
    pub point: Point2,
    pub side: ArrangementBoundarySide,
    pub side_coordinate: f64,
    pub support: f64,
    pub source: EvidenceSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArrangementBoundarySide {
    Top,
    Right,
    Bottom,
    Left,
}

impl ArrangementBoundarySide {
    pub const fn all() -> [Self; 4] {
        [Self::Top, Self::Right, Self::Bottom, Self::Left]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ArrangementV2Options {
    pub epsilon: f64,
    pub vertex_merge_px: f64,
    pub carrier_membership_px: f64,
    pub junction_cluster_px: f64,
    pub collinear_angle_degrees: f64,
    pub collinear_rho_px: f64,
    pub min_atomic_interval: f64,
}

impl Default for ArrangementV2Options {
    fn default() -> Self {
        Self {
            epsilon: 1e-9,
            vertex_merge_px: 3.0,
            carrier_membership_px: 3.0,
            junction_cluster_px: 4.0,
            collinear_angle_degrees: 2.0,
            collinear_rho_px: 4.0,
            min_atomic_interval: 1e-5,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateArrangement {
    pub schema: String,
    pub coordinate_space: String,
    pub image_size: u32,
    pub options: ArrangementV2Options,
    pub carriers: Vec<ArrangementCarrier>,
    pub vertices: Vec<ArrangementVertex>,
    pub atomic_edges: Vec<ArrangementAtomicEdge>,
    pub hypotheses: Vec<ArrangementHypothesis>,
    pub report: CandidateArrangementReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementCarrier {
    pub id: usize,
    pub kind: ArrangementCarrierKind,
    pub primitive_ids: Vec<usize>,
    pub normal: Point2,
    pub direction: Point2,
    pub rho: f64,
    pub support_interval: [f64; 2],
    pub visual_support: f64,
    pub style_support: f64,
    pub assignment: AssignmentCandidate,
    pub source: EvidenceSource,
    pub provenance: Vec<Provenance>,
    pub hypothesis_cost: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArrangementCarrierKind {
    ObservedLocal,
    SharedCollinearAlternative,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementVertex {
    pub id: usize,
    pub point: Point2,
    pub kind: ArrangementVertexKind,
    pub support: f64,
    #[serde(default)]
    pub carrier_ids: Vec<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_side: Option<ArrangementBoundarySide>,
    #[serde(default)]
    pub primitive_ids: Vec<usize>,
    pub source: EvidenceSource,
    pub provenance: Vec<Provenance>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArrangementVertexKind {
    Corner,
    ObservedJunction,
    JunctionCluster,
    BoundaryContact,
    CarrierIntersection,
    ObservedLineEndpoint,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementAtomicEdge {
    pub id: usize,
    pub carrier_id: usize,
    pub vertices: [usize; 2],
    pub t_interval: [f64; 2],
    pub line_support: f64,
    pub support_overlap: f64,
    pub style_support: f64,
    pub assignment: AssignmentCandidate,
    pub source: EvidenceSource,
    #[serde(default)]
    pub hypothesis_ids: Vec<usize>,
    pub provenance: Vec<Provenance>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementHypothesis {
    pub id: usize,
    pub kind: ArrangementHypothesisKind,
    #[serde(default)]
    pub carrier_ids: Vec<usize>,
    #[serde(default)]
    pub vertex_ids: Vec<usize>,
    #[serde(default)]
    pub atomic_edge_ids: Vec<usize>,
    pub cost: f64,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArrangementHypothesisKind {
    SeparateSegment,
    SharedCarrier,
    MergeNearbyJunction,
    SplitCrossing,
    BoundaryContact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateArrangementReport {
    pub observed_carriers: usize,
    pub shared_carrier_alternatives: usize,
    pub carriers: usize,
    pub corners: usize,
    pub observed_junctions: usize,
    pub junction_clusters: usize,
    pub boundary_contacts: usize,
    pub carrier_intersections: usize,
    pub line_endpoints: usize,
    pub vertices: usize,
    pub atomic_edges: usize,
    pub hypotheses: usize,
    pub selected_edges: usize,
    pub emits_fold_graph: bool,
}

pub fn build_candidate_arrangement(
    input: &ArrangementV2Input,
    options: ArrangementV2Options,
) -> CandidateArrangement {
    let scale = coordinate_scale(input.image_size);
    let merge_tol = options.vertex_merge_px / scale;
    let membership_tol = options.carrier_membership_px / scale;
    let mut carriers = observed_carriers(input, scale, &options);
    let mut hypotheses = carriers
        .iter()
        .map(|carrier| ArrangementHypothesis {
            id: carrier.id,
            kind: ArrangementHypothesisKind::SeparateSegment,
            carrier_ids: vec![carrier.id],
            vertex_ids: Vec::new(),
            atomic_edge_ids: Vec::new(),
            cost: 0.0,
            reason: "observed line primitive remains available as its own carrier".to_owned(),
        })
        .collect::<Vec<_>>();

    let shared_carrier_start = carriers.len();
    let shared_carriers = shared_collinear_carriers(&carriers, scale, &options);
    for carrier in shared_carriers {
        let hypothesis_id = hypotheses.len();
        hypotheses.push(ArrangementHypothesis {
            id: hypothesis_id,
            kind: ArrangementHypothesisKind::SharedCarrier,
            carrier_ids: vec![carrier.id],
            vertex_ids: Vec::new(),
            atomic_edge_ids: Vec::new(),
            cost: carrier.hypothesis_cost,
            reason: "near-collinear observed carriers can be interpreted as one shared carrier"
                .to_owned(),
        });
        carriers.push(carrier);
    }

    let mut vertices = Vec::<ArrangementVertex>::new();
    add_square_corners(&mut vertices, merge_tol);
    add_observed_line_endpoints(&mut vertices, &carriers[..shared_carrier_start], merge_tol);
    add_observed_junctions(input, scale, &mut vertices, merge_tol);
    add_junction_clusters(
        input,
        scale,
        &mut vertices,
        merge_tol,
        &mut hypotheses,
        &options,
    );
    add_explicit_boundary_contacts(input, scale, &mut vertices, merge_tol, &mut hypotheses);
    add_carrier_boundary_contacts(
        &carriers,
        &mut vertices,
        merge_tol,
        &mut hypotheses,
        &options,
    );
    add_carrier_intersections(
        &carriers,
        &mut vertices,
        merge_tol,
        &mut hypotheses,
        &options,
    );

    let atomic_edges = build_atomic_edges(&carriers, &vertices, membership_tol, &options);
    let report = arrangement_report(&carriers, &vertices, &atomic_edges, &hypotheses);
    CandidateArrangement {
        schema: SCHEMA.to_owned(),
        coordinate_space: "unit_square".to_owned(),
        image_size: input.image_size,
        options,
        carriers,
        vertices,
        atomic_edges,
        hypotheses,
        report,
    }
}

fn observed_carriers(
    input: &ArrangementV2Input,
    scale: f64,
    options: &ArrangementV2Options,
) -> Vec<ArrangementCarrier> {
    let mut carriers = Vec::new();
    for primitive in &input.line_primitives {
        let p0 = normalize_point(primitive.p0, scale);
        let p1 = normalize_point(primitive.p1, scale);
        let Some(line) = line_from_points(p0, p1, options.epsilon) else {
            continue;
        };
        let mut interval = [project(line.direction, p0), project(line.direction, p1)];
        interval.sort_by(f64::total_cmp);
        carriers.push(ArrangementCarrier {
            id: carriers.len(),
            kind: ArrangementCarrierKind::ObservedLocal,
            primitive_ids: vec![primitive.id],
            normal: line.normal,
            direction: line.direction,
            rho: line.rho,
            support_interval: interval,
            visual_support: primitive.support.clamp(0.0, 1.0),
            style_support: primitive.style_support.clamp(0.0, 1.0),
            assignment: primitive.assignment,
            source: primitive.source,
            provenance: provenance_for_source(primitive.source),
            hypothesis_cost: 0.0,
        });
    }
    carriers
}

fn shared_collinear_carriers(
    observed: &[ArrangementCarrier],
    scale: f64,
    options: &ArrangementV2Options,
) -> Vec<ArrangementCarrier> {
    if observed.len() < 2 {
        return Vec::new();
    }
    let angle_tol = options.collinear_angle_degrees.to_radians();
    let rho_tol = options.collinear_rho_px / scale;
    let mut parent: Vec<usize> = (0..observed.len()).collect();
    for left in 0..observed.len() {
        for right in (left + 1)..observed.len() {
            if carriers_nearly_collinear(&observed[left], &observed[right], angle_tol, rho_tol) {
                union(&mut parent, left, right);
            }
        }
    }

    let mut groups = BTreeMap::<usize, Vec<usize>>::new();
    for index in 0..observed.len() {
        let root = find(&mut parent, index);
        groups.entry(root).or_default().push(index);
    }

    let mut shared = Vec::new();
    for group in groups.values().filter(|group| group.len() > 1) {
        let members = group
            .iter()
            .map(|index| &observed[*index])
            .collect::<Vec<_>>();
        let Some(carrier) = fit_shared_carrier(observed.len() + shared.len(), &members) else {
            continue;
        };
        shared.push(carrier);
    }
    shared
}

fn carriers_nearly_collinear(
    left: &ArrangementCarrier,
    right: &ArrangementCarrier,
    angle_tol: f64,
    rho_tol: f64,
) -> bool {
    let dot = (left.normal.x * right.normal.x + left.normal.y * right.normal.y)
        .clamp(-1.0, 1.0)
        .abs();
    let angle = dot.acos();
    angle <= angle_tol && (left.rho - right.rho).abs() <= rho_tol
}

fn fit_shared_carrier(id: usize, members: &[&ArrangementCarrier]) -> Option<ArrangementCarrier> {
    let mut weight_sum = 0.0;
    let mut nx = 0.0;
    let mut ny = 0.0;
    let mut rho = 0.0;
    let mut support = 0.0;
    let mut style = 0.0;
    let mut primitive_ids = Vec::new();
    let mut assignment = members.first()?.assignment;
    let mut best_assignment_support = -1.0;
    for carrier in members {
        let length = carrier.support_interval[1] - carrier.support_interval[0];
        let weight = (carrier.visual_support * length.max(1e-6)).max(1e-6);
        weight_sum += weight;
        nx += carrier.normal.x * weight;
        ny += carrier.normal.y * weight;
        rho += carrier.rho * weight;
        support += carrier.visual_support * weight;
        style += carrier.style_support * weight;
        primitive_ids.extend(carrier.primitive_ids.iter().copied());
        if carrier.visual_support > best_assignment_support {
            best_assignment_support = carrier.visual_support;
            assignment = carrier.assignment;
        }
    }
    if weight_sum <= 0.0 {
        return None;
    }
    let normal_len = (nx * nx + ny * ny).sqrt();
    if normal_len <= 1e-9 {
        return None;
    }
    let normal = Point2::new(nx / normal_len, ny / normal_len);
    let direction = Point2::new(-normal.y, normal.x);
    let rho = rho / weight_sum;
    let mut interval = [f64::INFINITY, f64::NEG_INFINITY];
    for carrier in members {
        for endpoint_t in carrier.support_interval {
            let point = point_on_carrier(carrier, endpoint_t);
            let shared_t = project(direction, point);
            interval[0] = interval[0].min(shared_t);
            interval[1] = interval[1].max(shared_t);
        }
    }
    Some(ArrangementCarrier {
        id,
        kind: ArrangementCarrierKind::SharedCollinearAlternative,
        primitive_ids,
        normal,
        direction,
        rho,
        support_interval: interval,
        visual_support: support / weight_sum,
        style_support: style / weight_sum,
        assignment,
        source: EvidenceSource::Inferred,
        provenance: vec![Provenance::CarrierReconciled],
        hypothesis_cost: 0.20 + 0.05 * members.len() as f64,
    })
}

fn add_square_corners(vertices: &mut Vec<ArrangementVertex>, merge_tol: f64) {
    for (point, side) in [
        (Point2::new(0.0, 0.0), Some(ArrangementBoundarySide::Top)),
        (Point2::new(1.0, 0.0), Some(ArrangementBoundarySide::Right)),
        (Point2::new(1.0, 1.0), Some(ArrangementBoundarySide::Bottom)),
        (Point2::new(0.0, 1.0), Some(ArrangementBoundarySide::Left)),
    ] {
        add_vertex(
            vertices,
            ArrangementVertex {
                id: 0,
                point,
                kind: ArrangementVertexKind::Corner,
                support: 1.0,
                carrier_ids: Vec::new(),
                boundary_side: side,
                primitive_ids: Vec::new(),
                source: EvidenceSource::Border,
                provenance: vec![Provenance::BorderPrior],
            },
            merge_tol,
        );
    }
}

fn add_observed_line_endpoints(
    vertices: &mut Vec<ArrangementVertex>,
    carriers: &[ArrangementCarrier],
    merge_tol: f64,
) {
    for carrier in carriers {
        for t in carrier.support_interval {
            add_vertex(
                vertices,
                ArrangementVertex {
                    id: 0,
                    point: point_on_carrier(carrier, t),
                    kind: ArrangementVertexKind::ObservedLineEndpoint,
                    support: carrier.visual_support,
                    carrier_ids: vec![carrier.id],
                    boundary_side: None,
                    primitive_ids: carrier.primitive_ids.clone(),
                    source: carrier.source,
                    provenance: carrier.provenance.clone(),
                },
                merge_tol,
            );
        }
    }
}

fn add_observed_junctions(
    input: &ArrangementV2Input,
    scale: f64,
    vertices: &mut Vec<ArrangementVertex>,
    merge_tol: f64,
) {
    for primitive in &input.junction_primitives {
        add_vertex(
            vertices,
            ArrangementVertex {
                id: 0,
                point: normalize_point(primitive.point, scale),
                kind: ArrangementVertexKind::ObservedJunction,
                support: primitive.support.clamp(0.0, 1.0),
                carrier_ids: Vec::new(),
                boundary_side: None,
                primitive_ids: vec![primitive.id],
                source: primitive.source,
                provenance: provenance_for_source(primitive.source),
            },
            merge_tol,
        );
    }
}

fn add_junction_clusters(
    input: &ArrangementV2Input,
    scale: f64,
    vertices: &mut Vec<ArrangementVertex>,
    merge_tol: f64,
    hypotheses: &mut Vec<ArrangementHypothesis>,
    options: &ArrangementV2Options,
) {
    let cluster_tol = options.junction_cluster_px / scale;
    let normalized = input
        .junction_primitives
        .iter()
        .map(|primitive| {
            (
                primitive.id,
                normalize_point(primitive.point, scale),
                primitive.support.clamp(0.0, 1.0),
            )
        })
        .collect::<Vec<_>>();
    let mut used = vec![false; normalized.len()];
    for index in 0..normalized.len() {
        if used[index] {
            continue;
        }
        let mut members = vec![index];
        used[index] = true;
        for other in (index + 1)..normalized.len() {
            if !used[other] && distance(normalized[index].1, normalized[other].1) <= cluster_tol {
                members.push(other);
                used[other] = true;
            }
        }
        if members.len() < 2 {
            continue;
        }
        let mut centroid = Point2::new(0.0, 0.0);
        let mut support = 0.0;
        let mut primitive_ids = Vec::new();
        for member in &members {
            centroid.x += normalized[*member].1.x;
            centroid.y += normalized[*member].1.y;
            support += normalized[*member].2;
            primitive_ids.push(normalized[*member].0);
        }
        centroid.x /= members.len() as f64;
        centroid.y /= members.len() as f64;
        support /= members.len() as f64;
        let vertex_id = add_vertex(
            vertices,
            ArrangementVertex {
                id: 0,
                point: centroid,
                kind: ArrangementVertexKind::JunctionCluster,
                support,
                carrier_ids: Vec::new(),
                boundary_side: None,
                primitive_ids,
                source: EvidenceSource::Inferred,
                provenance: vec![Provenance::CarrierReconciled],
            },
            merge_tol,
        );
        let hypothesis_id = hypotheses.len();
        hypotheses.push(ArrangementHypothesis {
            id: hypothesis_id,
            kind: ArrangementHypothesisKind::MergeNearbyJunction,
            carrier_ids: Vec::new(),
            vertex_ids: vec![vertex_id],
            atomic_edge_ids: Vec::new(),
            cost: 0.10 + 0.02 * members.len() as f64,
            reason: "nearby junction peaks can be interpreted as one vertex".to_owned(),
        });
    }
}

fn add_explicit_boundary_contacts(
    input: &ArrangementV2Input,
    scale: f64,
    vertices: &mut Vec<ArrangementVertex>,
    merge_tol: f64,
    hypotheses: &mut Vec<ArrangementHypothesis>,
) {
    for primitive in &input.boundary_contact_primitives {
        let point = snap_to_boundary(
            normalize_point(primitive.point, scale),
            primitive.side,
            primitive.side_coordinate.clamp(0.0, 1.0),
        );
        let vertex_id = add_vertex(
            vertices,
            ArrangementVertex {
                id: 0,
                point,
                kind: ArrangementVertexKind::BoundaryContact,
                support: primitive.support.clamp(0.0, 1.0),
                carrier_ids: Vec::new(),
                boundary_side: Some(primitive.side),
                primitive_ids: vec![primitive.id],
                source: primitive.source,
                provenance: provenance_for_source(primitive.source),
            },
            merge_tol,
        );
        let hypothesis_id = hypotheses.len();
        hypotheses.push(ArrangementHypothesis {
            id: hypothesis_id,
            kind: ArrangementHypothesisKind::BoundaryContact,
            carrier_ids: Vec::new(),
            vertex_ids: vec![vertex_id],
            atomic_edge_ids: Vec::new(),
            cost: 0.0,
            reason: "model boundary-contact primitive".to_owned(),
        });
    }
}

fn add_carrier_boundary_contacts(
    carriers: &[ArrangementCarrier],
    vertices: &mut Vec<ArrangementVertex>,
    merge_tol: f64,
    hypotheses: &mut Vec<ArrangementHypothesis>,
    options: &ArrangementV2Options,
) {
    for carrier in carriers {
        for (side, point) in carrier_square_contacts(carrier, options.epsilon) {
            let vertex_id = add_vertex(
                vertices,
                ArrangementVertex {
                    id: 0,
                    point,
                    kind: ArrangementVertexKind::BoundaryContact,
                    support: carrier.visual_support,
                    carrier_ids: vec![carrier.id],
                    boundary_side: Some(side),
                    primitive_ids: carrier.primitive_ids.clone(),
                    source: EvidenceSource::Inferred,
                    provenance: vec![Provenance::InferredByBoundaryContact],
                },
                merge_tol,
            );
            let hypothesis_id = hypotheses.len();
            hypotheses.push(ArrangementHypothesis {
                id: hypothesis_id,
                kind: ArrangementHypothesisKind::BoundaryContact,
                carrier_ids: vec![carrier.id],
                vertex_ids: vec![vertex_id],
                atomic_edge_ids: Vec::new(),
                cost: 0.05,
                reason: "carrier intersects the square boundary".to_owned(),
            });
        }
    }
}

fn add_carrier_intersections(
    carriers: &[ArrangementCarrier],
    vertices: &mut Vec<ArrangementVertex>,
    merge_tol: f64,
    hypotheses: &mut Vec<ArrangementHypothesis>,
    options: &ArrangementV2Options,
) {
    for left_index in 0..carriers.len() {
        for right in carriers.iter().skip(left_index + 1) {
            let left = &carriers[left_index];
            let Some(point) = carrier_intersection(left, right, options.epsilon) else {
                continue;
            };
            if !within_unit_square(point, options.epsilon) {
                continue;
            }
            let support = left.visual_support.min(right.visual_support);
            let vertex_id = add_vertex(
                vertices,
                ArrangementVertex {
                    id: 0,
                    point: clamp_unit_point(point),
                    kind: ArrangementVertexKind::CarrierIntersection,
                    support,
                    carrier_ids: vec![left.id, right.id],
                    boundary_side: boundary_side_for_point(point, options.epsilon),
                    primitive_ids: left
                        .primitive_ids
                        .iter()
                        .chain(right.primitive_ids.iter())
                        .copied()
                        .collect(),
                    source: EvidenceSource::Inferred,
                    provenance: vec![Provenance::CarrierReconciled],
                },
                merge_tol,
            );
            let hypothesis_id = hypotheses.len();
            hypotheses.push(ArrangementHypothesis {
                id: hypothesis_id,
                kind: ArrangementHypothesisKind::SplitCrossing,
                carrier_ids: vec![left.id, right.id],
                vertex_ids: vec![vertex_id],
                atomic_edge_ids: Vec::new(),
                cost: 0.08,
                reason: "two carriers geometrically cross inside the square".to_owned(),
            });
        }
    }
}

fn build_atomic_edges(
    carriers: &[ArrangementCarrier],
    vertices: &[ArrangementVertex],
    membership_tol: f64,
    options: &ArrangementV2Options,
) -> Vec<ArrangementAtomicEdge> {
    let mut edges = Vec::new();
    for carrier in carriers {
        let Some(square_range) = carrier_square_t_range(carrier, options.epsilon) else {
            continue;
        };
        let mut carrier_vertices = vertices
            .iter()
            .filter_map(|vertex| {
                let distance = point_line_distance(vertex.point, carrier);
                if distance > membership_tol {
                    return None;
                }
                let t = project(carrier.direction, vertex.point);
                if t < square_range[0] - options.epsilon || t > square_range[1] + options.epsilon {
                    return None;
                }
                Some((vertex.id, t))
            })
            .collect::<Vec<_>>();
        carrier_vertices.sort_by(|left, right| left.1.total_cmp(&right.1));
        carrier_vertices.dedup_by(|left, right| (left.1 - right.1).abs() <= membership_tol);
        for window in carrier_vertices.windows(2) {
            let t0 = window[0].1;
            let t1 = window[1].1;
            if (t1 - t0).abs() < options.min_atomic_interval {
                continue;
            }
            let overlap = interval_overlap_fraction([t0, t1], carrier.support_interval);
            edges.push(ArrangementAtomicEdge {
                id: edges.len(),
                carrier_id: carrier.id,
                vertices: [window[0].0, window[1].0],
                t_interval: [t0, t1],
                line_support: carrier.visual_support * (0.20 + 0.80 * overlap),
                support_overlap: overlap,
                style_support: carrier.style_support,
                assignment: carrier.assignment,
                source: carrier.source,
                hypothesis_ids: Vec::new(),
                provenance: carrier.provenance.clone(),
            });
        }
    }
    edges
}

fn arrangement_report(
    carriers: &[ArrangementCarrier],
    vertices: &[ArrangementVertex],
    atomic_edges: &[ArrangementAtomicEdge],
    hypotheses: &[ArrangementHypothesis],
) -> CandidateArrangementReport {
    CandidateArrangementReport {
        observed_carriers: carriers
            .iter()
            .filter(|carrier| carrier.kind == ArrangementCarrierKind::ObservedLocal)
            .count(),
        shared_carrier_alternatives: carriers
            .iter()
            .filter(|carrier| carrier.kind == ArrangementCarrierKind::SharedCollinearAlternative)
            .count(),
        carriers: carriers.len(),
        corners: vertices
            .iter()
            .filter(|vertex| vertex.kind == ArrangementVertexKind::Corner)
            .count(),
        observed_junctions: vertices
            .iter()
            .filter(|vertex| vertex.kind == ArrangementVertexKind::ObservedJunction)
            .count(),
        junction_clusters: vertices
            .iter()
            .filter(|vertex| vertex.kind == ArrangementVertexKind::JunctionCluster)
            .count(),
        boundary_contacts: vertices
            .iter()
            .filter(|vertex| vertex.kind == ArrangementVertexKind::BoundaryContact)
            .count(),
        carrier_intersections: vertices
            .iter()
            .filter(|vertex| vertex.kind == ArrangementVertexKind::CarrierIntersection)
            .count(),
        line_endpoints: vertices
            .iter()
            .filter(|vertex| vertex.kind == ArrangementVertexKind::ObservedLineEndpoint)
            .count(),
        vertices: vertices.len(),
        atomic_edges: atomic_edges.len(),
        hypotheses: hypotheses.len(),
        selected_edges: 0,
        emits_fold_graph: false,
    }
}

fn add_vertex(
    vertices: &mut Vec<ArrangementVertex>,
    mut candidate: ArrangementVertex,
    tolerance: f64,
) -> usize {
    if let Some(existing) = vertices
        .iter_mut()
        .find(|vertex| distance(vertex.point, candidate.point) <= tolerance)
    {
        existing.support = existing.support.max(candidate.support);
        merge_unique(&mut existing.carrier_ids, &candidate.carrier_ids);
        merge_unique(&mut existing.primitive_ids, &candidate.primitive_ids);
        if existing.boundary_side.is_none() {
            existing.boundary_side = candidate.boundary_side;
        }
        if vertex_kind_rank(candidate.kind) > vertex_kind_rank(existing.kind) {
            existing.kind = candidate.kind;
            existing.point = candidate.point;
            existing.source = candidate.source;
            existing.provenance = candidate.provenance;
        }
        return existing.id;
    }
    candidate.id = vertices.len();
    vertices.push(candidate);
    vertices.len() - 1
}

fn merge_unique(values: &mut Vec<usize>, incoming: &[usize]) {
    for value in incoming {
        if !values.contains(value) {
            values.push(*value);
        }
    }
}

fn vertex_kind_rank(kind: ArrangementVertexKind) -> u8 {
    match kind {
        ArrangementVertexKind::ObservedLineEndpoint => 1,
        ArrangementVertexKind::CarrierIntersection => 2,
        ArrangementVertexKind::BoundaryContact => 3,
        ArrangementVertexKind::JunctionCluster => 4,
        ArrangementVertexKind::ObservedJunction => 5,
        ArrangementVertexKind::Corner => 6,
    }
}

#[derive(Debug, Clone, Copy)]
struct LineEquation {
    normal: Point2,
    direction: Point2,
    rho: f64,
}

fn line_from_points(p0: Point2, p1: Point2, epsilon: f64) -> Option<LineEquation> {
    let dx = p1.x - p0.x;
    let dy = p1.y - p0.y;
    let length = (dx * dx + dy * dy).sqrt();
    if length <= epsilon {
        return None;
    }
    let direction = Point2::new(dx / length, dy / length);
    let mut normal = Point2::new(-direction.y, direction.x);
    let mut rho = normal.x * p0.x + normal.y * p0.y;
    if rho < -epsilon || (rho.abs() <= epsilon && (normal.x < 0.0 || normal.y < -epsilon)) {
        normal.x = -normal.x;
        normal.y = -normal.y;
        rho = -rho;
    }
    let direction = Point2::new(-normal.y, normal.x);
    Some(LineEquation {
        normal,
        direction,
        rho,
    })
}

fn carrier_intersection(
    left: &ArrangementCarrier,
    right: &ArrangementCarrier,
    epsilon: f64,
) -> Option<Point2> {
    let det = left.normal.x * right.normal.y - left.normal.y * right.normal.x;
    if det.abs() <= epsilon {
        return None;
    }
    Some(Point2::new(
        (left.rho * right.normal.y - right.rho * left.normal.y) / det,
        (left.normal.x * right.rho - right.normal.x * left.rho) / det,
    ))
}

fn carrier_square_contacts(
    carrier: &ArrangementCarrier,
    epsilon: f64,
) -> Vec<(ArrangementBoundarySide, Point2)> {
    let mut contacts = Vec::new();
    let nx = carrier.normal.x;
    let ny = carrier.normal.y;
    let rho = carrier.rho;
    if ny.abs() > epsilon {
        let y = rho / ny;
        if within_unit(y, epsilon) {
            contacts.push((
                ArrangementBoundarySide::Left,
                Point2::new(0.0, y.clamp(0.0, 1.0)),
            ));
        }
        let y = (rho - nx) / ny;
        if within_unit(y, epsilon) {
            contacts.push((
                ArrangementBoundarySide::Right,
                Point2::new(1.0, y.clamp(0.0, 1.0)),
            ));
        }
    }
    if nx.abs() > epsilon {
        let x = rho / nx;
        if within_unit(x, epsilon) {
            contacts.push((
                ArrangementBoundarySide::Top,
                Point2::new(x.clamp(0.0, 1.0), 0.0),
            ));
        }
        let x = (rho - ny) / nx;
        if within_unit(x, epsilon) {
            contacts.push((
                ArrangementBoundarySide::Bottom,
                Point2::new(x.clamp(0.0, 1.0), 1.0),
            ));
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

fn carrier_square_t_range(carrier: &ArrangementCarrier, epsilon: f64) -> Option<[f64; 2]> {
    let contacts = carrier_square_contacts(carrier, epsilon);
    if contacts.len() < 2 {
        return None;
    }
    let mut t0 = f64::INFINITY;
    let mut t1 = f64::NEG_INFINITY;
    for (_, point) in contacts {
        let t = project(carrier.direction, point);
        t0 = t0.min(t);
        t1 = t1.max(t);
    }
    Some([t0, t1])
}

fn point_on_carrier(carrier: &ArrangementCarrier, t: f64) -> Point2 {
    Point2::new(
        carrier.normal.x * carrier.rho + carrier.direction.x * t,
        carrier.normal.y * carrier.rho + carrier.direction.y * t,
    )
}

fn point_line_distance(point: Point2, carrier: &ArrangementCarrier) -> f64 {
    (carrier.normal.x * point.x + carrier.normal.y * point.y - carrier.rho).abs()
}

fn project(axis: Point2, point: Point2) -> f64 {
    axis.x * point.x + axis.y * point.y
}

fn normalize_point(point: Point2, scale: f64) -> Point2 {
    Point2::new(
        (point.x / scale).clamp(0.0, 1.0),
        (point.y / scale).clamp(0.0, 1.0),
    )
}

fn coordinate_scale(image_size: u32) -> f64 {
    image_size.saturating_sub(1).max(1) as f64
}

fn snap_to_boundary(point: Point2, side: ArrangementBoundarySide, side_coordinate: f64) -> Point2 {
    match side {
        ArrangementBoundarySide::Top => Point2::new(side_coordinate, 0.0),
        ArrangementBoundarySide::Right => Point2::new(1.0, side_coordinate),
        ArrangementBoundarySide::Bottom => Point2::new(side_coordinate, 1.0),
        ArrangementBoundarySide::Left => Point2::new(0.0, side_coordinate),
    }
    .or_else_if_invalid(point)
}

trait FallbackPoint {
    fn or_else_if_invalid(self, fallback: Point2) -> Point2;
}

impl FallbackPoint for Point2 {
    fn or_else_if_invalid(self, fallback: Point2) -> Point2 {
        if self.x.is_finite() && self.y.is_finite() {
            self
        } else {
            fallback
        }
    }
}

fn side_coordinate(point: Point2, side: ArrangementBoundarySide) -> f64 {
    match side {
        ArrangementBoundarySide::Top | ArrangementBoundarySide::Bottom => point.x.clamp(0.0, 1.0),
        ArrangementBoundarySide::Right | ArrangementBoundarySide::Left => point.y.clamp(0.0, 1.0),
    }
}

fn boundary_side_for_point(point: Point2, epsilon: f64) -> Option<ArrangementBoundarySide> {
    if (point.y - 0.0).abs() <= epsilon {
        Some(ArrangementBoundarySide::Top)
    } else if (point.x - 1.0).abs() <= epsilon {
        Some(ArrangementBoundarySide::Right)
    } else if (point.y - 1.0).abs() <= epsilon {
        Some(ArrangementBoundarySide::Bottom)
    } else if (point.x - 0.0).abs() <= epsilon {
        Some(ArrangementBoundarySide::Left)
    } else {
        None
    }
}

fn interval_overlap_fraction(interval: [f64; 2], support: [f64; 2]) -> f64 {
    let length = (interval[1] - interval[0]).abs();
    if length <= 1e-9 {
        return 0.0;
    }
    let overlap = (interval[1].min(support[1]) - interval[0].max(support[0])).max(0.0);
    (overlap / length).clamp(0.0, 1.0)
}

fn provenance_for_source(source: EvidenceSource) -> Vec<Provenance> {
    match source {
        EvidenceSource::ObservedStrong => vec![Provenance::ObservedStrong],
        EvidenceSource::ObservedWeak => vec![Provenance::ObservedWeak],
        EvidenceSource::Inferred => vec![Provenance::CarrierReconciled],
        EvidenceSource::Border => vec![Provenance::BorderPrior],
        EvidenceSource::Legacy => vec![Provenance::LegacyDecoder],
    }
}

fn within_unit(value: f64, epsilon: f64) -> bool {
    value >= -epsilon && value <= 1.0 + epsilon
}

fn within_unit_square(point: Point2, epsilon: f64) -> bool {
    within_unit(point.x, epsilon) && within_unit(point.y, epsilon)
}

fn clamp_unit_point(point: Point2) -> Point2 {
    Point2::new(point.x.clamp(0.0, 1.0), point.y.clamp(0.0, 1.0))
}

fn distance(left: Point2, right: Point2) -> f64 {
    ((right.x - left.x).powi(2) + (right.y - left.y).powi(2)).sqrt()
}

fn find(parent: &mut [usize], index: usize) -> usize {
    if parent[index] != index {
        parent[index] = find(parent, parent[index]);
    }
    parent[index]
}

fn union(parent: &mut [usize], left: usize, right: usize) {
    let left_root = find(parent, left);
    let right_root = find(parent, right);
    if left_root != right_root {
        parent[right_root] = left_root;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AssignmentLabel;

    #[test]
    fn two_crossing_carriers_create_intersection_and_four_atomic_intervals() {
        let input = ArrangementV2Input {
            image_size: 101,
            line_primitives: vec![
                line(0, [50.0, 0.0], [50.0, 100.0]),
                line(1, [0.0, 50.0], [100.0, 50.0]),
            ],
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
        };
        let arrangement = build_candidate_arrangement(&input, ArrangementV2Options::default());

        assert_eq!(arrangement.report.carrier_intersections, 1);
        assert_eq!(arrangement.report.atomic_edges, 4);
        assert!(arrangement.report.selected_edges == 0);
        assert!(!arrangement.report.emits_fold_graph);
    }

    #[test]
    fn nearly_collinear_segments_keep_separate_and_shared_hypotheses() {
        let input = ArrangementV2Input {
            image_size: 101,
            line_primitives: vec![
                line(0, [10.0, 20.0], [45.0, 20.0]),
                line(1, [48.0, 21.0], [90.0, 21.0]),
            ],
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
        };
        let arrangement = build_candidate_arrangement(&input, ArrangementV2Options::default());

        assert_eq!(arrangement.report.observed_carriers, 2);
        assert_eq!(arrangement.report.shared_carrier_alternatives, 1);
        assert!(
            arrangement
                .hypotheses
                .iter()
                .any(|hypothesis| hypothesis.kind == ArrangementHypothesisKind::SeparateSegment)
        );
        assert!(
            arrangement
                .hypotheses
                .iter()
                .any(|hypothesis| hypothesis.kind == ArrangementHypothesisKind::SharedCarrier)
        );
    }

    #[test]
    fn close_but_angled_segments_remain_separate_without_shared_hypothesis() {
        let input = ArrangementV2Input {
            image_size: 101,
            line_primitives: vec![
                line(0, [10.0, 20.0], [45.0, 20.0]),
                line(1, [48.0, 22.0], [90.0, 33.0]),
            ],
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
        };
        let arrangement = build_candidate_arrangement(&input, ArrangementV2Options::default());

        assert_eq!(arrangement.report.observed_carriers, 2);
        assert_eq!(arrangement.report.shared_carrier_alternatives, 0);
        assert_eq!(
            arrangement
                .hypotheses
                .iter()
                .filter(|hypothesis| hypothesis.kind == ArrangementHypothesisKind::SeparateSegment)
                .count(),
            2
        );
    }

    #[test]
    fn carrier_crossing_square_creates_boundary_contacts_on_correct_sides() {
        let input = ArrangementV2Input {
            image_size: 101,
            line_primitives: vec![line(0, [25.0, 0.0], [25.0, 100.0])],
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
        };
        let arrangement = build_candidate_arrangement(&input, ArrangementV2Options::default());

        assert!(arrangement.vertices.iter().any(|vertex| {
            vertex.kind == ArrangementVertexKind::BoundaryContact
                && vertex.boundary_side == Some(ArrangementBoundarySide::Top)
        }));
        assert!(arrangement.vertices.iter().any(|vertex| {
            vertex.kind == ArrangementVertexKind::BoundaryContact
                && vertex.boundary_side == Some(ArrangementBoundarySide::Bottom)
        }));
    }

    #[test]
    fn arrangement_alone_does_not_emit_selected_fold_edges() {
        let input = ArrangementV2Input {
            image_size: 101,
            line_primitives: vec![line(0, [0.0, 0.0], [100.0, 100.0])],
            junction_primitives: Vec::new(),
            boundary_contact_primitives: Vec::new(),
        };
        let arrangement = build_candidate_arrangement(&input, ArrangementV2Options::default());

        assert_eq!(arrangement.report.selected_edges, 0);
        assert!(!arrangement.report.emits_fold_graph);
        assert!(!arrangement.atomic_edges.is_empty());
    }

    fn line(id: usize, p0: [f64; 2], p1: [f64; 2]) -> ArrangementLinePrimitive {
        ArrangementLinePrimitive {
            id,
            p0: Point2::new(p0[0], p0[1]),
            p1: Point2::new(p1[0], p1[1]),
            support: 0.85,
            votes: 30,
            assignment: AssignmentCandidate {
                label: AssignmentLabel::Mountain,
                confidence: 0.9,
                margin: 0.7,
            },
            style_support: 0.1,
            source: EvidenceSource::ObservedStrong,
        }
    }
}
