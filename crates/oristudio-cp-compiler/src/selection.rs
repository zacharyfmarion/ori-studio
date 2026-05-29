//! Weighted candidate selection for the compiler V2 architecture.
//!
//! This stage chooses a first selected graph from the V2 arrangement without
//! mutating geometry. Exactizability probes are intentionally reported as not
//! evaluated here; Phase 4 adds those costs.

use crate::arrangement_v2::{
    ArrangementAtomicEdge, ArrangementCarrierKind, ArrangementHypothesisKind, ArrangementVertex,
    ArrangementVertexKind, CandidateArrangement,
};
use crate::{AssignmentLabel, EvidenceSource};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const SCHEMA: &str = "oristudio/cp-compiler/candidate-selection-v2";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SelectionOptions {
    pub strong_edge_support: f64,
    pub weak_edge_support: f64,
    pub min_selected_score: f64,
    pub weak_candidate_floor: f64,
    pub odd_degree_bonus: f64,
    pub inferred_geometry_cost: f64,
    pub min_edge_length: f64,
    pub tiny_edge_cost: f64,
    pub duplicate_edge_cost: f64,
    pub max_merge_hypothesis_cost: f64,
}

impl Default for SelectionOptions {
    fn default() -> Self {
        Self {
            strong_edge_support: 0.52,
            weak_edge_support: 0.22,
            min_selected_score: 0.0,
            weak_candidate_floor: -0.35,
            odd_degree_bonus: 0.42,
            inferred_geometry_cost: 0.18,
            min_edge_length: 0.012,
            tiny_edge_cost: 0.65,
            duplicate_edge_cost: 1.0,
            max_merge_hypothesis_cost: 0.22,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateSelection {
    pub schema: String,
    pub coordinate_space: String,
    pub image_size: u32,
    pub options: SelectionOptions,
    pub selected_edge_ids: Vec<usize>,
    pub rejected_edge_ids: Vec<usize>,
    pub undecided_edge_ids: Vec<usize>,
    pub selected_hypothesis_ids: Vec<usize>,
    pub edge_scores: Vec<SelectionEdgeScore>,
    pub report: CandidateSelectionReport,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionDecision {
    Selected,
    Rejected,
    Undecided,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectionEdgeScore {
    pub edge_id: usize,
    pub carrier_id: usize,
    pub vertices: [usize; 2],
    pub decision: SelectionDecision,
    pub total_score: f64,
    pub breakdown: SelectionScoreBreakdown,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectionScoreBreakdown {
    pub visual_reward: f64,
    pub vertex_anchor_reward: f64,
    pub assignment_reward: f64,
    pub topology_delta: f64,
    pub weak_support_cost: f64,
    pub inferred_geometry_cost: f64,
    pub shared_carrier_cost: f64,
    pub tiny_edge_cost: f64,
    pub duplicate_cost: f64,
    pub exactizability_cost: f64,
}

impl SelectionScoreBreakdown {
    fn total(&self) -> f64 {
        self.visual_reward
            + self.vertex_anchor_reward
            + self.assignment_reward
            + self.topology_delta
            - self.weak_support_cost
            - self.inferred_geometry_cost
            - self.shared_carrier_cost
            - self.tiny_edge_cost
            - self.duplicate_cost
            - self.exactizability_cost
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateSelectionReport {
    pub selected_edges: usize,
    pub rejected_edges: usize,
    pub undecided_edges: usize,
    pub selected_hypotheses: usize,
    pub weak_edges_promoted: usize,
    pub topology_improved_edges: usize,
    pub duplicate_edges_rejected: usize,
    pub odd_degree_vertices: usize,
    pub total_score: f64,
    pub exactizability_evaluated: bool,
    pub emits_fold_graph: bool,
}

pub fn select_candidate_graph(
    arrangement: &CandidateArrangement,
    options: SelectionOptions,
) -> CandidateSelection {
    let vertices = arrangement
        .vertices
        .iter()
        .map(|vertex| (vertex.id, vertex))
        .collect::<BTreeMap<_, _>>();
    let carriers = arrangement
        .carriers
        .iter()
        .map(|carrier| (carrier.id, carrier))
        .collect::<BTreeMap<_, _>>();

    let mut scores = arrangement
        .atomic_edges
        .iter()
        .map(|edge| {
            let mut score = base_score(edge, &vertices, &carriers, &options);
            if edge.line_support >= options.strong_edge_support
                && score.breakdown.total() >= options.min_selected_score
            {
                score.decision = SelectionDecision::Selected;
                score
                    .reasons
                    .push("selected from strong visual line support".to_owned());
            }
            score.total_score = score.breakdown.total();
            score
        })
        .collect::<Vec<_>>();

    reject_duplicate_selected_edges(&mut scores, &options);

    let mut selected = selected_edge_ids(&scores);
    let mut weak_edges_promoted = 0usize;
    let mut topology_improved_edges = 0usize;
    let mut changed = true;
    while changed {
        changed = false;
        let before = odd_degree_count(arrangement, &vertices, &selected);
        let mut best: Option<(usize, f64, usize)> = None;
        for (index, score) in scores.iter().enumerate() {
            if score.decision != SelectionDecision::Rejected
                && score.decision != SelectionDecision::Undecided
            {
                continue;
            }
            if score.breakdown.duplicate_cost > 0.0 {
                continue;
            }
            let edge = &arrangement.atomic_edges[score.edge_id];
            if edge.line_support < options.weak_edge_support
                || score.breakdown.total() < options.weak_candidate_floor
            {
                continue;
            }
            let mut trial = selected.clone();
            trial.insert(edge.id);
            let after = odd_degree_count(arrangement, &vertices, &trial);
            if after >= before {
                continue;
            }
            let delta = (before - after) as f64 * options.odd_degree_bonus;
            let total = score.breakdown.total() + delta;
            if total >= options.min_selected_score
                && best
                    .as_ref()
                    .is_none_or(|(_, best_total, _)| total > *best_total)
            {
                best = Some((index, total, before - after));
            }
        }
        if let Some((index, total, fixed_odd_vertices)) = best {
            let score = &mut scores[index];
            score.decision = SelectionDecision::Selected;
            score.breakdown.topology_delta = fixed_odd_vertices as f64 * options.odd_degree_bonus;
            score.total_score = total;
            score.reasons.push(format!(
                "promoted because it fixes {fixed_odd_vertices} odd-degree vertices"
            ));
            if arrangement.atomic_edges[score.edge_id].line_support < options.strong_edge_support {
                weak_edges_promoted += 1;
            }
            topology_improved_edges += 1;
            selected.insert(score.edge_id);
            changed = true;
        }
    }

    for score in &mut scores {
        if score.decision == SelectionDecision::Selected {
            continue;
        }
        if score.breakdown.duplicate_cost > 0.0 {
            score.decision = SelectionDecision::Rejected;
            score.total_score = score.breakdown.total();
            continue;
        }
        let edge = &arrangement.atomic_edges[score.edge_id];
        score.total_score = score.breakdown.total();
        if edge.line_support >= options.weak_edge_support
            && score.total_score >= options.weak_candidate_floor
        {
            score.decision = SelectionDecision::Undecided;
            score
                .reasons
                .push("kept as plausible but not selected by current costs".to_owned());
        } else {
            score.decision = SelectionDecision::Rejected;
            score
                .reasons
                .push("rejected by visual/topology score".to_owned());
        }
    }

    let selected = selected_edge_ids(&scores);
    let selected_hypotheses = selected_hypotheses(arrangement, &selected, &options);
    let selected_edge_ids = ordered_ids(&scores, SelectionDecision::Selected);
    let rejected_edge_ids = ordered_ids(&scores, SelectionDecision::Rejected);
    let undecided_edge_ids = ordered_ids(&scores, SelectionDecision::Undecided);
    let duplicate_edges_rejected = scores
        .iter()
        .filter(|score| score.breakdown.duplicate_cost > 0.0)
        .count();
    let total_score = scores
        .iter()
        .filter(|score| score.decision == SelectionDecision::Selected)
        .map(|score| score.total_score)
        .sum();
    let report = CandidateSelectionReport {
        selected_edges: selected_edge_ids.len(),
        rejected_edges: rejected_edge_ids.len(),
        undecided_edges: undecided_edge_ids.len(),
        selected_hypotheses: selected_hypotheses.len(),
        weak_edges_promoted,
        topology_improved_edges,
        duplicate_edges_rejected,
        odd_degree_vertices: odd_degree_count(arrangement, &vertices, &selected),
        total_score,
        exactizability_evaluated: false,
        emits_fold_graph: false,
    };

    CandidateSelection {
        schema: SCHEMA.to_owned(),
        coordinate_space: arrangement.coordinate_space.clone(),
        image_size: arrangement.image_size,
        options,
        selected_edge_ids,
        rejected_edge_ids,
        undecided_edge_ids,
        selected_hypothesis_ids: selected_hypotheses.into_iter().collect(),
        edge_scores: scores,
        report,
    }
}

fn base_score(
    edge: &ArrangementAtomicEdge,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
    options: &SelectionOptions,
) -> SelectionEdgeScore {
    let carrier = carriers.get(&edge.carrier_id).copied();
    let p0 = vertices.get(&edge.vertices[0]).copied();
    let p1 = vertices.get(&edge.vertices[1]).copied();
    let visual_reward = 1.85 * edge.line_support + 0.25 * edge.support_overlap;
    let vertex_anchor_reward =
        p0.map(vertex_anchor_reward).unwrap_or(0.0) + p1.map(vertex_anchor_reward).unwrap_or(0.0);
    let assignment_reward = if edge.assignment.label == AssignmentLabel::Unknown {
        0.0
    } else {
        0.18 * edge.assignment.confidence.clamp(0.0, 1.0)
    };
    let weak_support_cost = if edge.line_support < options.strong_edge_support {
        (options.strong_edge_support - edge.line_support).max(0.0) * 0.9
    } else {
        0.0
    };
    let inferred_geometry_cost = if edge.source == EvidenceSource::Inferred {
        options.inferred_geometry_cost
    } else {
        0.0
    };
    let shared_carrier_cost = carrier
        .filter(|carrier| carrier.kind == ArrangementCarrierKind::SharedCollinearAlternative)
        .map(|carrier| carrier.hypothesis_cost)
        .unwrap_or(0.0);
    let length = (edge.t_interval[1] - edge.t_interval[0]).abs();
    let tiny_edge_cost = if length < options.min_edge_length {
        options.tiny_edge_cost * (1.0 - length / options.min_edge_length).max(0.0)
    } else {
        0.0
    };
    let breakdown = SelectionScoreBreakdown {
        visual_reward,
        vertex_anchor_reward,
        assignment_reward,
        topology_delta: 0.0,
        weak_support_cost,
        inferred_geometry_cost,
        shared_carrier_cost,
        tiny_edge_cost,
        duplicate_cost: 0.0,
        exactizability_cost: 0.0,
    };
    SelectionEdgeScore {
        edge_id: edge.id,
        carrier_id: edge.carrier_id,
        vertices: edge.vertices,
        decision: SelectionDecision::Rejected,
        total_score: breakdown.total(),
        breakdown,
        reasons: Vec::new(),
    }
}

fn vertex_anchor_reward(vertex: &ArrangementVertex) -> f64 {
    let support = vertex.support.clamp(0.0, 1.0);
    match vertex.kind {
        ArrangementVertexKind::ObservedJunction => 0.30 * support,
        ArrangementVertexKind::JunctionCluster => 0.22 * support,
        ArrangementVertexKind::BoundaryContact | ArrangementVertexKind::Corner => 0.18 * support,
        ArrangementVertexKind::CarrierIntersection => 0.10 * support,
        ArrangementVertexKind::ObservedLineEndpoint => 0.04 * support,
    }
}

fn reject_duplicate_selected_edges(scores: &mut [SelectionEdgeScore], options: &SelectionOptions) {
    let mut by_vertices = BTreeMap::<[usize; 2], Vec<usize>>::new();
    for (index, score) in scores.iter().enumerate() {
        if score.decision != SelectionDecision::Selected {
            continue;
        }
        let mut key = score.vertices;
        key.sort_unstable();
        by_vertices.entry(key).or_default().push(index);
    }
    for indexes in by_vertices.values().filter(|indexes| indexes.len() > 1) {
        let keep = indexes
            .iter()
            .copied()
            .max_by(|left, right| {
                scores[*left]
                    .total_score
                    .total_cmp(&scores[*right].total_score)
            })
            .expect("non-empty duplicate group");
        for index in indexes {
            if *index == keep {
                continue;
            }
            let score = &mut scores[*index];
            score.decision = SelectionDecision::Rejected;
            score.breakdown.duplicate_cost = options.duplicate_edge_cost;
            score.total_score = score.breakdown.total();
            score
                .reasons
                .push("rejected duplicate interval between the same vertices".to_owned());
        }
    }
}

fn selected_edge_ids(scores: &[SelectionEdgeScore]) -> BTreeSet<usize> {
    scores
        .iter()
        .filter(|score| score.decision == SelectionDecision::Selected)
        .map(|score| score.edge_id)
        .collect()
}

fn ordered_ids(scores: &[SelectionEdgeScore], decision: SelectionDecision) -> Vec<usize> {
    scores
        .iter()
        .filter(|score| score.decision == decision)
        .map(|score| score.edge_id)
        .collect()
}

fn selected_hypotheses(
    arrangement: &CandidateArrangement,
    selected_edges: &BTreeSet<usize>,
    options: &SelectionOptions,
) -> BTreeSet<usize> {
    let selected_carriers = arrangement
        .atomic_edges
        .iter()
        .filter(|edge| selected_edges.contains(&edge.id))
        .map(|edge| edge.carrier_id)
        .collect::<BTreeSet<_>>();
    let selected_vertices = arrangement
        .atomic_edges
        .iter()
        .filter(|edge| selected_edges.contains(&edge.id))
        .flat_map(|edge| edge.vertices)
        .collect::<BTreeSet<_>>();
    arrangement
        .hypotheses
        .iter()
        .filter(|hypothesis| match hypothesis.kind {
            ArrangementHypothesisKind::SeparateSegment
            | ArrangementHypothesisKind::SharedCarrier => hypothesis
                .carrier_ids
                .iter()
                .any(|carrier_id| selected_carriers.contains(carrier_id)),
            ArrangementHypothesisKind::MergeNearbyJunction => {
                hypothesis.cost <= options.max_merge_hypothesis_cost
                    && hypothesis
                        .vertex_ids
                        .iter()
                        .any(|vertex_id| selected_vertices.contains(vertex_id))
            }
            ArrangementHypothesisKind::BoundaryContact
            | ArrangementHypothesisKind::SplitCrossing => false,
        })
        .map(|hypothesis| hypothesis.id)
        .collect()
}

fn odd_degree_count(
    arrangement: &CandidateArrangement,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    selected_edges: &BTreeSet<usize>,
) -> usize {
    let mut degrees = BTreeMap::<usize, usize>::new();
    for edge in arrangement
        .atomic_edges
        .iter()
        .filter(|edge| selected_edges.contains(&edge.id))
    {
        *degrees.entry(edge.vertices[0]).or_default() += 1;
        *degrees.entry(edge.vertices[1]).or_default() += 1;
    }
    degrees
        .into_iter()
        .filter(|(vertex_id, degree)| {
            degree % 2 == 1
                && vertices
                    .get(vertex_id)
                    .is_some_and(|vertex| is_interior_vertex(vertex))
        })
        .count()
}

fn is_interior_vertex(vertex: &ArrangementVertex) -> bool {
    !matches!(
        vertex.kind,
        ArrangementVertexKind::BoundaryContact | ArrangementVertexKind::Corner
    ) && vertex.boundary_side.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arrangement_v2::{
        ArrangementAtomicEdge, ArrangementCarrier, ArrangementCarrierKind, ArrangementHypothesis,
        ArrangementV2Options,
    };
    use crate::{AssignmentCandidate, AssignmentLabel, Point2, Provenance};

    #[test]
    fn strong_visual_edge_is_selected() {
        let arrangement = fixture_arrangement(vec![edge(0, 0, [0, 1], 0.86)]);
        let selection = select_candidate_graph(&arrangement, SelectionOptions::default());

        assert_eq!(selection.report.selected_edges, 1);
        assert_eq!(selection.selected_edge_ids, vec![0]);
    }

    #[test]
    fn weak_edge_is_selected_when_it_repairs_odd_degree() {
        let arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.88),
            edge(1, 1, [2, 3], 0.86),
            edge(2, 2, [1, 2], 0.30),
        ]);
        let selection = select_candidate_graph(&arrangement, SelectionOptions::default());

        assert!(selection.selected_edge_ids.contains(&2));
        assert_eq!(selection.report.weak_edges_promoted, 1);
        assert!(selection.report.odd_degree_vertices < 4);
    }

    #[test]
    fn no_evidence_edge_is_rejected_even_when_topologically_useful() {
        let arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.88),
            edge(1, 1, [2, 3], 0.86),
            edge(2, 2, [1, 2], 0.03),
        ]);
        let selection = select_candidate_graph(&arrangement, SelectionOptions::default());

        assert!(!selection.selected_edge_ids.contains(&2));
        assert!(selection.rejected_edge_ids.contains(&2));
    }

    #[test]
    fn duplicate_selected_interval_keeps_highest_score() {
        let arrangement =
            fixture_arrangement(vec![edge(0, 0, [0, 1], 0.88), edge(1, 1, [0, 1], 0.72)]);
        let selection = select_candidate_graph(&arrangement, SelectionOptions::default());

        assert_eq!(selection.selected_edge_ids, vec![0]);
        assert!(selection.rejected_edge_ids.contains(&1));
        assert_eq!(selection.report.duplicate_edges_rejected, 1);
    }

    #[test]
    fn low_cost_merge_hypothesis_is_reported_when_selected_edge_uses_cluster() {
        let mut arrangement = fixture_arrangement(vec![edge(0, 0, [0, 4], 0.82)]);
        arrangement.vertices.push(vertex(
            4,
            Point2::new(0.5, 0.5),
            ArrangementVertexKind::JunctionCluster,
        ));
        arrangement.hypotheses.push(ArrangementHypothesis {
            id: 0,
            kind: ArrangementHypothesisKind::MergeNearbyJunction,
            carrier_ids: Vec::new(),
            vertex_ids: vec![4],
            atomic_edge_ids: Vec::new(),
            cost: 0.12,
            reason: "test merge".to_owned(),
        });

        let selection = select_candidate_graph(&arrangement, SelectionOptions::default());

        assert!(selection.selected_hypothesis_ids.contains(&0));
    }

    #[test]
    fn high_cost_merge_hypothesis_is_not_selected() {
        let mut arrangement = fixture_arrangement(vec![edge(0, 0, [0, 4], 0.82)]);
        arrangement.vertices.push(vertex(
            4,
            Point2::new(0.5, 0.5),
            ArrangementVertexKind::JunctionCluster,
        ));
        arrangement.hypotheses.push(ArrangementHypothesis {
            id: 0,
            kind: ArrangementHypothesisKind::MergeNearbyJunction,
            carrier_ids: Vec::new(),
            vertex_ids: vec![4],
            atomic_edge_ids: Vec::new(),
            cost: 0.80,
            reason: "test expensive merge".to_owned(),
        });

        let selection = select_candidate_graph(&arrangement, SelectionOptions::default());

        assert!(!selection.selected_hypothesis_ids.contains(&0));
    }

    fn fixture_arrangement(edges: Vec<ArrangementAtomicEdge>) -> CandidateArrangement {
        let carrier_count = edges.iter().map(|edge| edge.carrier_id).max().unwrap_or(0) + 1;
        CandidateArrangement {
            schema: "test".to_owned(),
            coordinate_space: "unit_square".to_owned(),
            image_size: 101,
            options: ArrangementV2Options::default(),
            carriers: (0..carrier_count).map(carrier).collect(),
            vertices: vec![
                vertex(
                    0,
                    Point2::new(0.2, 0.2),
                    ArrangementVertexKind::ObservedJunction,
                ),
                vertex(
                    1,
                    Point2::new(0.4, 0.2),
                    ArrangementVertexKind::ObservedJunction,
                ),
                vertex(
                    2,
                    Point2::new(0.6, 0.2),
                    ArrangementVertexKind::ObservedJunction,
                ),
                vertex(
                    3,
                    Point2::new(0.8, 0.2),
                    ArrangementVertexKind::ObservedJunction,
                ),
            ],
            atomic_edges: edges,
            hypotheses: Vec::new(),
            report: crate::arrangement_v2::CandidateArrangementReport {
                observed_carriers: carrier_count,
                shared_carrier_alternatives: 0,
                carriers: carrier_count,
                corners: 0,
                observed_junctions: 4,
                junction_clusters: 0,
                boundary_contacts: 0,
                carrier_intersections: 0,
                suppressed_carrier_intersections: 0,
                line_endpoints: 0,
                vertices: 4,
                atomic_edges: 0,
                hypotheses: 0,
                selected_edges: 0,
                emits_fold_graph: false,
            },
        }
    }

    fn carrier(id: usize) -> ArrangementCarrier {
        ArrangementCarrier {
            id,
            kind: ArrangementCarrierKind::ObservedLocal,
            primitive_ids: vec![id],
            normal: Point2::new(0.0, 1.0),
            direction: Point2::new(1.0, 0.0),
            rho: id as f64 * 0.01,
            support_interval: [0.0, 1.0],
            visual_support: 0.8,
            style_support: 0.0,
            assignment: assignment(),
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::ObservedStrong],
            hypothesis_cost: 0.0,
        }
    }

    fn vertex(id: usize, point: Point2, kind: ArrangementVertexKind) -> ArrangementVertex {
        ArrangementVertex {
            id,
            point,
            kind,
            support: 0.8,
            carrier_ids: Vec::new(),
            boundary_side: None,
            primitive_ids: Vec::new(),
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::ObservedStrong],
        }
    }

    fn edge(
        id: usize,
        carrier_id: usize,
        vertices: [usize; 2],
        support: f64,
    ) -> ArrangementAtomicEdge {
        ArrangementAtomicEdge {
            id,
            carrier_id,
            vertices,
            t_interval: [0.0, 0.2],
            line_support: support,
            support_overlap: support,
            style_support: 0.0,
            assignment: assignment(),
            source: if support >= 0.5 {
                EvidenceSource::ObservedStrong
            } else if support >= 0.1 {
                EvidenceSource::ObservedWeak
            } else {
                EvidenceSource::Inferred
            },
            hypothesis_ids: Vec::new(),
            provenance: vec![Provenance::ObservedStrong],
        }
    }

    fn assignment() -> AssignmentCandidate {
        AssignmentCandidate {
            label: AssignmentLabel::Mountain,
            confidence: 0.8,
            margin: 0.6,
        }
    }
}
