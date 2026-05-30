//! Weighted candidate selection for the compiler V2 architecture.
//!
//! This stage chooses a first selected graph from the V2 arrangement without
//! mutating geometry. `select_candidate_graph` is the Phase 3 greedy scaffold;
//! `select_candidate_graph_beam` is the Phase 5 exactizability-aware selector.

use crate::arrangement_v2::{
    ArrangementAtomicEdge, ArrangementCarrierKind, ArrangementHypothesisKind, ArrangementVertex,
    ArrangementVertexKind, CandidateArrangement,
};
use crate::exact_probe::{ExactProbeOptions, probe_exactizability};
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
    pub beam_width: usize,
    pub max_beam_candidates: usize,
    pub exact_energy_cost: f64,
    pub exact_infeasible_cost: f64,
    pub exact_high_cost: f64,
    pub exact_odd_degree_cost: f64,
    pub exact_hard_kawasaki_cost: f64,
    pub minimum_exact_improvement: f64,
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
            beam_width: 10,
            max_beam_candidates: 56,
            exact_energy_cost: 0.015,
            exact_infeasible_cost: 1.15,
            exact_high_cost: 0.38,
            exact_odd_degree_cost: 0.95,
            exact_hard_kawasaki_cost: 0.75,
            minimum_exact_improvement: 0.08,
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

pub fn select_candidate_graph_beam(
    arrangement: &CandidateArrangement,
    options: SelectionOptions,
    exact_options: ExactProbeOptions,
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
            score.total_score = score.breakdown.total();
            score
        })
        .collect::<Vec<_>>();

    let mut seed_scores = scores.clone();
    for score in &mut seed_scores {
        let edge = &arrangement.atomic_edges[score.edge_id];
        if edge.line_support >= options.strong_edge_support
            && score.breakdown.total() >= options.min_selected_score
        {
            score.decision = SelectionDecision::Selected;
            score
                .reasons
                .push("seeded from strong visual line support".to_owned());
        }
    }
    reject_duplicate_selected_edges(&mut seed_scores, &options);

    let seed_selected = selected_edge_ids(&seed_scores);
    let seed_exact = exact_penalty(arrangement, &options, &exact_options, &seed_selected);
    let seed_odd = odd_degree_count(arrangement, &vertices, &seed_selected);
    let seed_base_score = seed_selected
        .iter()
        .filter_map(|edge_id| scores.get(*edge_id))
        .map(|score| score.breakdown.total())
        .sum::<f64>();
    let mut beam = vec![BeamState {
        selected: seed_selected,
        selected_base_score: seed_base_score,
        topology_reward: 0.0,
        exact_penalty: seed_exact,
        odd_degree_vertices: seed_odd,
        total_score: seed_base_score - seed_exact,
        impacts: BTreeMap::new(),
    }];

    let mut candidate_edge_ids = scores
        .iter()
        .filter(|score| {
            let edge = &arrangement.atomic_edges[score.edge_id];
            !beam[0].selected.contains(&score.edge_id)
                && score.breakdown.duplicate_cost <= 0.0
                && edge.line_support >= options.weak_edge_support
                && score.breakdown.total() >= options.weak_candidate_floor
        })
        .map(|score| score.edge_id)
        .collect::<Vec<_>>();
    candidate_edge_ids.sort_by(|left, right| {
        let left_score = beam_candidate_priority(arrangement, &scores[*left], &carriers);
        let right_score = beam_candidate_priority(arrangement, &scores[*right], &carriers);
        right_score
            .total_cmp(&left_score)
            .then_with(|| left.cmp(right))
    });
    candidate_edge_ids.truncate(options.max_beam_candidates);

    for edge_id in candidate_edge_ids {
        let mut next = Vec::with_capacity(beam.len() * 2);
        for state in &beam {
            next.push(state.clone());
            if state.selected.contains(&edge_id) {
                continue;
            }
            if has_duplicate_selected_interval(arrangement, &state.selected, edge_id) {
                continue;
            }
            let mut selected = state.selected.clone();
            selected.insert(edge_id);
            let after_odd = odd_degree_count(arrangement, &vertices, &selected);
            let topology_delta =
                (state.odd_degree_vertices as f64 - after_odd as f64) * options.odd_degree_bonus;
            let after_exact = exact_penalty(arrangement, &options, &exact_options, &selected);
            let exact_delta = state.exact_penalty - after_exact;
            let candidate_score = scores[edge_id].breakdown.total();
            let improves_topology = topology_delta > 0.0;
            let improves_exact = exact_delta >= options.minimum_exact_improvement;
            let visually_strong =
                arrangement.atomic_edges[edge_id].line_support >= options.strong_edge_support;
            if !improves_topology && !improves_exact && !visually_strong {
                continue;
            }
            let mut impacts = state.impacts.clone();
            impacts.insert(
                edge_id,
                BeamEdgeImpact {
                    topology_delta,
                    exact_delta,
                },
            );
            let selected_base_score = state.selected_base_score + candidate_score;
            let topology_reward = state.topology_reward + topology_delta;
            let total_score = selected_base_score + topology_reward - after_exact;
            next.push(BeamState {
                selected,
                selected_base_score,
                topology_reward,
                exact_penalty: after_exact,
                odd_degree_vertices: after_odd,
                total_score,
                impacts,
            });
        }
        next.sort_by(beam_state_order);
        next.dedup_by(|left, right| left.selected == right.selected);
        let width = options.beam_width.max(1);
        next.truncate(width);
        beam = next;
    }

    beam.sort_by(beam_state_order);
    let best = beam.into_iter().next().unwrap_or_else(|| BeamState {
        selected: BTreeSet::new(),
        selected_base_score: 0.0,
        topology_reward: 0.0,
        exact_penalty: 0.0,
        odd_degree_vertices: 0,
        total_score: 0.0,
        impacts: BTreeMap::new(),
    });

    for score in &mut scores {
        let edge = &arrangement.atomic_edges[score.edge_id];
        if best.selected.contains(&score.edge_id) {
            score.decision = SelectionDecision::Selected;
            if let Some(impact) = best.impacts.get(&score.edge_id) {
                score.breakdown.topology_delta = impact.topology_delta;
                score.breakdown.exactizability_cost = -impact.exact_delta;
                if impact.topology_delta > 0.0 {
                    score.reasons.push(format!(
                        "selected by beam search; improves odd-degree cost by {:.3}",
                        impact.topology_delta
                    ));
                }
                if impact.exact_delta > 0.0 {
                    score.reasons.push(format!(
                        "selected by beam search; improves exactizability penalty by {:.3}",
                        impact.exact_delta
                    ));
                }
            } else {
                score
                    .reasons
                    .push("selected by Stage 5 beam seed from strong visual support".to_owned());
            }
            score.total_score = score.breakdown.total();
            continue;
        }

        if has_duplicate_selected_interval(arrangement, &best.selected, score.edge_id) {
            score.decision = SelectionDecision::Rejected;
            score.breakdown.duplicate_cost = options.duplicate_edge_cost;
            score.total_score = score.breakdown.total();
            score.reasons.push(
                "rejected because selected graph already contains this vertex interval".to_owned(),
            );
        } else if edge.line_support >= options.weak_edge_support
            && score.breakdown.total() >= options.weak_candidate_floor
        {
            score.decision = SelectionDecision::Undecided;
            score.total_score = score.breakdown.total();
            score
                .reasons
                .push("kept as plausible but not selected by exactizability-aware beam".to_owned());
        } else {
            score.decision = SelectionDecision::Rejected;
            score.total_score = score.breakdown.total();
            score
                .reasons
                .push("rejected by visual/topology/exactizability score".to_owned());
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
    let weak_edges_promoted = selected_edge_ids
        .iter()
        .filter(|edge_id| {
            arrangement.atomic_edges[**edge_id].line_support < options.strong_edge_support
        })
        .count();
    let topology_improved_edges = best
        .impacts
        .values()
        .filter(|impact| impact.topology_delta > 0.0)
        .count();
    let total_score = scores
        .iter()
        .filter(|score| score.decision == SelectionDecision::Selected)
        .map(|score| score.total_score)
        .sum::<f64>()
        - best.exact_penalty;
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
        exactizability_evaluated: true,
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

#[derive(Debug, Clone)]
struct BeamState {
    selected: BTreeSet<usize>,
    selected_base_score: f64,
    topology_reward: f64,
    exact_penalty: f64,
    odd_degree_vertices: usize,
    total_score: f64,
    impacts: BTreeMap<usize, BeamEdgeImpact>,
}

#[derive(Debug, Clone, Copy)]
struct BeamEdgeImpact {
    topology_delta: f64,
    exact_delta: f64,
}

fn beam_state_order(left: &BeamState, right: &BeamState) -> std::cmp::Ordering {
    right
        .total_score
        .total_cmp(&left.total_score)
        .then_with(|| left.exact_penalty.total_cmp(&right.exact_penalty))
        .then_with(|| left.odd_degree_vertices.cmp(&right.odd_degree_vertices))
        .then_with(|| left.selected.len().cmp(&right.selected.len()))
}

fn beam_candidate_priority(
    arrangement: &CandidateArrangement,
    score: &SelectionEdgeScore,
    carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
) -> f64 {
    let edge = &arrangement.atomic_edges[score.edge_id];
    let carrier_bonus = carriers
        .get(&edge.carrier_id)
        .filter(|carrier| carrier.kind == ArrangementCarrierKind::SharedCollinearAlternative)
        .map(|carrier| 0.16 - carrier.hypothesis_cost)
        .unwrap_or(0.0);
    score.breakdown.total() + edge.line_support + edge.support_overlap * 0.5 + carrier_bonus
}

fn exact_penalty(
    arrangement: &CandidateArrangement,
    options: &SelectionOptions,
    exact_options: &ExactProbeOptions,
    selected_edges: &BTreeSet<usize>,
) -> f64 {
    let selection = temporary_selection_for_probe(arrangement, *options, selected_edges);
    let report = probe_exactizability(arrangement, &selection, *exact_options);
    report.summary.total_estimated_energy * options.exact_energy_cost
        + report.summary.infeasible as f64 * options.exact_infeasible_cost
        + report.summary.high_cost as f64 * options.exact_high_cost
        + report.summary.odd_degree_vertices as f64 * options.exact_odd_degree_cost
        + report.summary.hard_kawasaki_vertices as f64 * options.exact_hard_kawasaki_cost
}

fn temporary_selection_for_probe(
    arrangement: &CandidateArrangement,
    options: SelectionOptions,
    selected_edges: &BTreeSet<usize>,
) -> CandidateSelection {
    let selected_edge_ids = selected_edges.iter().copied().collect::<Vec<_>>();
    CandidateSelection {
        schema: SCHEMA.to_owned(),
        coordinate_space: arrangement.coordinate_space.clone(),
        image_size: arrangement.image_size,
        options,
        selected_edge_ids,
        rejected_edge_ids: Vec::new(),
        undecided_edge_ids: Vec::new(),
        selected_hypothesis_ids: Vec::new(),
        edge_scores: Vec::new(),
        report: CandidateSelectionReport {
            selected_edges: selected_edges.len(),
            rejected_edges: 0,
            undecided_edges: 0,
            selected_hypotheses: 0,
            weak_edges_promoted: 0,
            topology_improved_edges: 0,
            duplicate_edges_rejected: 0,
            odd_degree_vertices: 0,
            total_score: 0.0,
            exactizability_evaluated: true,
            emits_fold_graph: false,
        },
    }
}

fn has_duplicate_selected_interval(
    arrangement: &CandidateArrangement,
    selected: &BTreeSet<usize>,
    edge_id: usize,
) -> bool {
    let Some(edge) = arrangement.atomic_edges.get(edge_id) else {
        return true;
    };
    let mut key = edge.vertices;
    key.sort_unstable();
    selected.iter().any(|selected_id| {
        let Some(selected_edge) = arrangement.atomic_edges.get(*selected_id) else {
            return false;
        };
        let mut selected_key = selected_edge.vertices;
        selected_key.sort_unstable();
        selected_key == key
    })
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

    #[test]
    fn beam_marks_exactizability_as_evaluated() {
        let arrangement = fixture_arrangement(vec![edge(0, 0, [0, 1], 0.86)]);
        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert!(selection.report.exactizability_evaluated);
        assert_eq!(selection.selected_edge_ids, vec![0]);
    }

    #[test]
    fn beam_selects_weak_edge_when_it_improves_exactizability() {
        let arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.88),
            edge(1, 1, [2, 3], 0.86),
            edge(2, 2, [1, 2], 0.30),
        ]);
        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());
        let score = selection
            .edge_scores
            .iter()
            .find(|score| score.edge_id == 2)
            .expect("edge score");

        assert!(selection.selected_edge_ids.contains(&2));
        assert!(selection.report.weak_edges_promoted >= 1);
        assert!(selection.report.topology_improved_edges >= 1);
        assert!(score.breakdown.exactizability_cost < 0.0);
        assert!(
            score
                .reasons
                .iter()
                .any(|reason| reason.contains("exactizability"))
        );
    }

    #[test]
    fn beam_rejects_no_evidence_edge_even_when_it_would_repair_degree() {
        let arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.88),
            edge(1, 1, [2, 3], 0.86),
            edge(2, 2, [1, 2], 0.03),
        ]);
        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert!(!selection.selected_edge_ids.contains(&2));
        assert!(selection.rejected_edge_ids.contains(&2));
    }

    #[test]
    fn beam_rejects_duplicate_false_line_against_selected_interval() {
        let arrangement =
            fixture_arrangement(vec![edge(0, 0, [0, 1], 0.88), edge(1, 1, [0, 1], 0.50)]);
        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert_eq!(selection.selected_edge_ids, vec![0]);
        assert!(selection.rejected_edge_ids.contains(&1));
        assert_eq!(selection.report.duplicate_edges_rejected, 1);
    }

    #[test]
    fn beam_keeps_stronger_but_topology_worse_candidate_out() {
        let arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.88),
            edge(1, 1, [1, 2], 0.86),
            edge(2, 2, [2, 3], 0.86),
            edge(3, 3, [0, 3], 0.30),
            edge(4, 4, [0, 2], 0.50),
        ]);
        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert!(selection.selected_edge_ids.contains(&3));
        assert!(!selection.selected_edge_ids.contains(&4));
    }

    #[test]
    fn beam_reports_low_cost_merge_hypothesis_when_selected_graph_uses_cluster() {
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

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert!(selection.selected_hypothesis_ids.contains(&0));
    }

    #[test]
    fn beam_does_not_report_high_cost_merge_hypothesis() {
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

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert!(!selection.selected_hypothesis_ids.contains(&0));
    }

    #[test]
    fn beam_can_select_shared_carrier_hypothesis() {
        let mut arrangement = fixture_arrangement(vec![edge(0, 0, [0, 1], 0.86)]);
        arrangement.carriers[0].kind = ArrangementCarrierKind::SharedCollinearAlternative;
        arrangement.carriers[0].hypothesis_cost = 0.08;
        arrangement.hypotheses.push(ArrangementHypothesis {
            id: 9,
            kind: ArrangementHypothesisKind::SharedCarrier,
            carrier_ids: vec![0],
            vertex_ids: Vec::new(),
            atomic_edge_ids: vec![0],
            cost: 0.08,
            reason: "test shared".to_owned(),
        });

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert!(selection.selected_edge_ids.contains(&0));
        assert!(selection.selected_hypothesis_ids.contains(&9));
    }

    fn fixture_arrangement(edges: Vec<ArrangementAtomicEdge>) -> CandidateArrangement {
        let carrier_count = edges.iter().map(|edge| edge.carrier_id).max().unwrap_or(0) + 1;
        let edge_count = edges.len();
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
                atomic_edges: edge_count,
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

    fn beam_options() -> SelectionOptions {
        SelectionOptions {
            beam_width: 8,
            max_beam_candidates: 16,
            ..SelectionOptions::default()
        }
    }
}
