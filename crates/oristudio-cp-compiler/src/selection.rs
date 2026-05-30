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
    pub non_collinear_degree_two_cost: f64,
    pub local_fragment_cost: f64,
    pub shared_carrier_continuity_reward: f64,
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
            non_collinear_degree_two_cost: 0.65,
            local_fragment_cost: 0.18,
            shared_carrier_continuity_reward: 0.36,
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
    #[serde(default)]
    pub structural_edits: Vec<SelectionStructuralEdit>,
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
    pub continuity_reward: f64,
    pub fragmentation_cost: f64,
    pub degree_two_cost: f64,
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
            + self.continuity_reward
            - self.fragmentation_cost
            - self.degree_two_cost
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectionStructuralEdit {
    pub kind: SelectionStructuralEditKind,
    #[serde(default)]
    pub vertex_ids: Vec<usize>,
    #[serde(default)]
    pub carrier_ids: Vec<usize>,
    #[serde(default)]
    pub added_edge_ids: Vec<usize>,
    #[serde(default)]
    pub removed_edge_ids: Vec<usize>,
    pub score_delta: f64,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionStructuralEditKind {
    SharedCarrierReplacement,
    CollapsibleDegreeTwoVertex,
    NonCollinearDegreeTwoVertex,
    LocalFragmentRetained,
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
    pub shared_replacements: usize,
    pub local_fragments_replaced: usize,
    pub local_fragments_retained: usize,
    pub collapsible_degree_two_vertices: usize,
    pub non_collinear_degree_two_vertices: usize,
    pub structural_penalty: f64,
    pub continuity_reward: f64,
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
        shared_replacements: 0,
        local_fragments_replaced: 0,
        local_fragments_retained: 0,
        collapsible_degree_two_vertices: 0,
        non_collinear_degree_two_vertices: 0,
        structural_penalty: 0.0,
        continuity_reward: 0.0,
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
        structural_edits: Vec::new(),
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
    let structural_index = StructuralIndex::build(arrangement, &carriers, &options);

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
        let Some(carrier) = carriers.get(&edge.carrier_id) else {
            continue;
        };
        if edge.line_support >= options.strong_edge_support
            && carrier.kind == ArrangementCarrierKind::ObservedLocal
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
    let seed_odd = odd_degree_count(arrangement, &vertices, &seed_selected);
    let mut beam = vec![score_beam_state(
        arrangement,
        &options,
        &scores,
        &vertices,
        &carriers,
        &structural_index,
        seed_odd,
        seed_selected,
        BTreeMap::new(),
    )];

    let mut moves = scores
        .iter()
        .filter(|score| {
            let edge = &arrangement.atomic_edges[score.edge_id];
            !beam[0].selected.contains(&score.edge_id)
                && score.breakdown.duplicate_cost <= 0.0
                && edge.line_support >= options.weak_edge_support
                && score.breakdown.total() >= options.weak_candidate_floor
                && carriers
                    .get(&edge.carrier_id)
                    .is_some_and(|carrier| carrier.kind == ArrangementCarrierKind::ObservedLocal)
        })
        .map(|score| BeamMove::Edge { edge_id: score.edge_id })
        .collect::<Vec<_>>();

    moves.extend(shared_carrier_moves(
        arrangement,
        &scores,
        &carriers,
        &structural_index,
        &options,
        &beam[0].selected,
    ));

    moves.sort_by(|left, right| {
        let left_score = beam_move_priority(
            arrangement,
            left,
            &scores,
            &carriers,
            &structural_index,
            &options,
        );
        let right_score = beam_move_priority(
            arrangement,
            right,
            &scores,
            &carriers,
            &structural_index,
            &options,
        );
        right_score
            .total_cmp(&left_score)
            .then_with(|| left.stable_id().cmp(&right.stable_id()))
    });
    moves.dedup_by_key(|candidate| candidate.stable_id());
    moves.truncate(options.max_beam_candidates);

    for candidate_move in moves {
        let mut next = Vec::with_capacity(beam.len() * 2);
        for state in &beam {
            next.push(state.clone());
            let Some(applied) =
                apply_beam_move(arrangement, &scores, &carriers, &options, &state.selected, &candidate_move)
            else {
                continue;
            };
            if applied.selected == state.selected {
                continue;
            }
            let after_state = score_beam_state(
                arrangement,
                &options,
                &scores,
                &vertices,
                &carriers,
                &structural_index,
                seed_odd,
                applied.selected,
                state.impacts.clone(),
            );
            let topology_delta =
                (state.odd_degree_vertices as f64 - after_state.odd_degree_vertices as f64)
                    * options.odd_degree_bonus;
            let exact_delta = 0.0;
            let structural_delta = (state.structural_penalty - after_state.structural_penalty)
                + (after_state.continuity_reward - state.continuity_reward);
            let improves_topology = topology_delta > 0.0;
            let improves_structure = structural_delta > 0.0 || !applied.removed_edge_ids.is_empty();
            let visually_strong = applied.added_edge_ids.iter().any(|edge_id| {
                arrangement.atomic_edges[*edge_id].line_support >= options.strong_edge_support
            });
            if !improves_structure && !improves_topology && !visually_strong {
                continue;
            }
            let mut candidate_state = after_state;
            for edge_id in applied.added_edge_ids {
                candidate_state.impacts.insert(
                    edge_id,
                    BeamEdgeImpact {
                        topology_delta,
                        exact_delta,
                        structural_delta,
                        removed_edge_ids: applied.removed_edge_ids.clone(),
                    },
                );
            }
            next.push(candidate_state);
        }
        next.sort_by(beam_state_order);
        next.dedup_by(|left, right| left.selected == right.selected);
        let width = options.beam_width.max(1);
        next.truncate(width);
        beam = next;
    }

    let mut exact_cache = BTreeMap::<Vec<usize>, f64>::new();
    let best = rescore_exact_survivors(
        arrangement,
        &options,
        &exact_options,
        &mut exact_cache,
        beam,
    )
    .unwrap_or_else(|| BeamState {
        selected: BTreeSet::new(),
        exact_penalty: 0.0,
        structural_penalty: 0.0,
        continuity_reward: 0.0,
        odd_degree_vertices: 0,
        total_score: 0.0,
        impacts: BTreeMap::new(),
    });

    let final_structural = analyze_structural(
        arrangement,
        &carriers,
        &structural_index,
        &vertices,
        &best.selected,
        &options,
    );
    let replaced_edge_ids = final_structural
        .edits
        .iter()
        .flat_map(|edit| edit.removed_edge_ids.iter().copied())
        .collect::<BTreeSet<_>>();
    for score in &mut scores {
        let edge = &arrangement.atomic_edges[score.edge_id];
        if best.selected.contains(&score.edge_id) {
            score.decision = SelectionDecision::Selected;
            if let Some(impact) = best.impacts.get(&score.edge_id) {
                score.breakdown.topology_delta = impact.topology_delta;
                score.breakdown.exactizability_cost = -impact.exact_delta;
                score.breakdown.continuity_reward = impact.structural_delta.max(0.0);
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
                if impact.structural_delta > 0.0 {
                    score.reasons.push(format!(
                        "selected by structural replacement; improves continuity by {:.3}",
                        impact.structural_delta
                    ));
                }
                if !impact.removed_edge_ids.is_empty() {
                    score.reasons.push(format!(
                        "replaces {} local fragment(s)",
                        impact.removed_edge_ids.len()
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

        if replaced_edge_ids.contains(&score.edge_id) {
            score.decision = SelectionDecision::Rejected;
            score.total_score = score.breakdown.total();
            score.reasons.push(
                "rejected because a selected shared carrier explains this local fragment"
                    .to_owned(),
            );
        } else if has_duplicate_selected_interval(arrangement, &best.selected, score.edge_id) {
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
    let total_score = best.total_score;
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
        shared_replacements: final_structural.shared_replacements,
        local_fragments_replaced: final_structural.local_fragments_replaced,
        local_fragments_retained: final_structural.local_fragments_retained,
        collapsible_degree_two_vertices: final_structural.collapsible_degree_two_vertices,
        non_collinear_degree_two_vertices: final_structural.non_collinear_degree_two_vertices,
        structural_penalty: final_structural.penalty,
        continuity_reward: final_structural.continuity_reward,
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
        structural_edits: final_structural.edits,
        report,
    }
}

#[derive(Debug, Clone)]
struct BeamState {
    selected: BTreeSet<usize>,
    exact_penalty: f64,
    structural_penalty: f64,
    continuity_reward: f64,
    odd_degree_vertices: usize,
    total_score: f64,
    impacts: BTreeMap<usize, BeamEdgeImpact>,
}

#[derive(Debug, Clone)]
struct BeamEdgeImpact {
    topology_delta: f64,
    exact_delta: f64,
    structural_delta: f64,
    removed_edge_ids: Vec<usize>,
}

#[derive(Debug, Clone)]
enum BeamMove {
    Edge { edge_id: usize },
    SharedCarrier { carrier_id: usize, edge_ids: Vec<usize> },
}

impl BeamMove {
    fn stable_id(&self) -> (u8, usize) {
        match self {
            Self::Edge { edge_id } => (0, *edge_id),
            Self::SharedCarrier { carrier_id, .. } => (1, *carrier_id),
        }
    }
}

#[derive(Debug, Clone)]
struct AppliedBeamMove {
    selected: BTreeSet<usize>,
    added_edge_ids: Vec<usize>,
    removed_edge_ids: Vec<usize>,
}

#[derive(Debug, Clone)]
struct StructuralIndex {
    shared_explainable_local_edges: BTreeMap<usize, Vec<usize>>,
    local_edges_with_shared_alternative: BTreeSet<usize>,
}

impl StructuralIndex {
    fn build(
        arrangement: &CandidateArrangement,
        carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
        options: &SelectionOptions,
    ) -> Self {
        let shared_carriers = carriers
            .values()
            .filter(|carrier| carrier.kind == ArrangementCarrierKind::SharedCollinearAlternative)
            .copied()
            .collect::<Vec<_>>();
        let mut local_edges_by_primitive = BTreeMap::<usize, Vec<usize>>::new();
        for edge in &arrangement.atomic_edges {
            let Some(carrier) = carriers.get(&edge.carrier_id).copied() else {
                continue;
            };
            if carrier.kind != ArrangementCarrierKind::ObservedLocal {
                continue;
            }
            for primitive_id in &carrier.primitive_ids {
                local_edges_by_primitive
                    .entry(*primitive_id)
                    .or_default()
                    .push(edge.id);
            }
        }

        let mut shared_explainable_local_edges = BTreeMap::new();
        let mut local_edges_with_shared_alternative = BTreeSet::new();
        for shared in shared_carriers {
            let mut edge_ids = BTreeSet::new();
            for primitive_id in &shared.primitive_ids {
                if let Some(local_ids) = local_edges_by_primitive.get(primitive_id) {
                    edge_ids.extend(local_ids.iter().copied());
                }
            }
            for edge_id in &edge_ids {
                local_edges_with_shared_alternative.insert(*edge_id);
            }
            let explainable = edge_ids
                .into_iter()
                .filter(|edge_id| {
                    arrangement
                        .atomic_edges
                        .get(*edge_id)
                        .is_some_and(|edge| edge.line_support >= options.weak_edge_support)
                })
                .collect::<Vec<_>>();
            if !explainable.is_empty() {
                shared_explainable_local_edges.insert(shared.id, explainable);
            }
        }

        Self {
            shared_explainable_local_edges,
            local_edges_with_shared_alternative,
        }
    }
}

#[derive(Debug, Clone)]
struct StructuralAnalysis {
    penalty: f64,
    continuity_reward: f64,
    shared_replacements: usize,
    local_fragments_replaced: usize,
    local_fragments_retained: usize,
    collapsible_degree_two_vertices: usize,
    non_collinear_degree_two_vertices: usize,
    edits: Vec<SelectionStructuralEdit>,
}

fn beam_state_order(left: &BeamState, right: &BeamState) -> std::cmp::Ordering {
    right
        .total_score
        .total_cmp(&left.total_score)
        .then_with(|| left.exact_penalty.total_cmp(&right.exact_penalty))
        .then_with(|| left.odd_degree_vertices.cmp(&right.odd_degree_vertices))
        .then_with(|| left.selected.len().cmp(&right.selected.len()))
}

fn score_beam_state(
    arrangement: &CandidateArrangement,
    options: &SelectionOptions,
    scores: &[SelectionEdgeScore],
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
    structural_index: &StructuralIndex,
    baseline_odd_vertices: usize,
    selected: BTreeSet<usize>,
    impacts: BTreeMap<usize, BeamEdgeImpact>,
) -> BeamState {
    let selected_base_score = selected
        .iter()
        .filter_map(|edge_id| scores.get(*edge_id))
        .map(|score| score.breakdown.total())
        .sum::<f64>();
    let odd_degree_vertices = odd_degree_count(arrangement, vertices, &selected);
    let topology_reward =
        (baseline_odd_vertices as f64 - odd_degree_vertices as f64) * options.odd_degree_bonus;
    let structural = analyze_structural(
        arrangement,
        carriers,
        structural_index,
        vertices,
        &selected,
        options,
    );
    let total_score =
        selected_base_score + topology_reward + structural.continuity_reward - structural.penalty;
    BeamState {
        selected,
        exact_penalty: 0.0,
        structural_penalty: structural.penalty,
        continuity_reward: structural.continuity_reward,
        odd_degree_vertices,
        total_score,
        impacts,
    }
}

fn rescore_exact_survivors(
    arrangement: &CandidateArrangement,
    options: &SelectionOptions,
    exact_options: &ExactProbeOptions,
    cache: &mut BTreeMap<Vec<usize>, f64>,
    mut states: Vec<BeamState>,
) -> Option<BeamState> {
    states.sort_by(beam_state_order);
    let survivor_count = options.beam_width.max(1);
    states.truncate(survivor_count);
    for state in &mut states {
        let penalty = exact_penalty_cached(arrangement, options, exact_options, cache, &state.selected);
        state.exact_penalty = penalty;
        state.total_score -= penalty;
    }
    states.sort_by(beam_state_order);
    states.into_iter().next()
}

fn shared_carrier_moves(
    arrangement: &CandidateArrangement,
    scores: &[SelectionEdgeScore],
    carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
    structural_index: &StructuralIndex,
    options: &SelectionOptions,
    seed_selected: &BTreeSet<usize>,
) -> Vec<BeamMove> {
    carriers
        .values()
        .filter(|carrier| carrier.kind == ArrangementCarrierKind::SharedCollinearAlternative)
        .filter_map(|carrier| {
            let edge_ids = arrangement
                .atomic_edges
                .iter()
                .filter(|edge| edge.carrier_id == carrier.id)
                .filter(|edge| !seed_selected.contains(&edge.id))
                .filter(|edge| edge.line_support >= options.weak_edge_support)
                .filter(|edge| {
                    scores
                        .get(edge.id)
                        .is_some_and(|score| score.breakdown.total() >= options.weak_candidate_floor)
                })
                .map(|edge| edge.id)
                .collect::<Vec<_>>();
            let explains_local = structural_index
                .shared_explainable_local_edges
                .get(&carrier.id)
                .is_some_and(|edge_ids| !edge_ids.is_empty());
            if edge_ids.is_empty() || !explains_local {
                None
            } else {
                Some(BeamMove::SharedCarrier {
                    carrier_id: carrier.id,
                    edge_ids,
                })
            }
        })
        .collect()
}

fn apply_beam_move(
    arrangement: &CandidateArrangement,
    scores: &[SelectionEdgeScore],
    carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
    options: &SelectionOptions,
    selected: &BTreeSet<usize>,
    candidate_move: &BeamMove,
) -> Option<AppliedBeamMove> {
    let mut next = selected.clone();
    let mut added_edge_ids = Vec::new();
    let mut removed_edge_ids = Vec::new();
    match candidate_move {
        BeamMove::Edge { edge_id } => {
            let edge = arrangement.atomic_edges.get(*edge_id)?;
            let carrier = carriers.get(&edge.carrier_id)?;
            if carrier.kind == ArrangementCarrierKind::ObservedLocal {
                let conflicts = selected
                    .iter()
                    .copied()
                    .filter(|selected_id| selected_edge_conflicts_with_carrier(arrangement, carriers, *selected_id, carrier.id))
                    .collect::<Vec<_>>();
                for selected_id in conflicts {
                    if next.remove(&selected_id) {
                        removed_edge_ids.push(selected_id);
                    }
                }
            }
            if !next.contains(edge_id) && !has_duplicate_selected_interval(arrangement, &next, *edge_id) {
                next.insert(*edge_id);
                added_edge_ids.push(*edge_id);
            }
        }
        BeamMove::SharedCarrier {
            carrier_id,
            edge_ids,
        } => {
            let carrier = carriers.get(carrier_id)?;
            let conflicts = selected
                .iter()
                .copied()
                .filter(|selected_id| selected_edge_conflicts_with_carrier(arrangement, carriers, *selected_id, carrier.id))
                .collect::<Vec<_>>();
            for selected_id in conflicts {
                if next.remove(&selected_id) {
                    removed_edge_ids.push(selected_id);
                }
            }
            for edge_id in edge_ids {
                let edge = arrangement.atomic_edges.get(*edge_id)?;
                if edge.line_support < options.weak_edge_support {
                    continue;
                }
                if scores
                    .get(*edge_id)
                    .is_none_or(|score| score.breakdown.total() < options.weak_candidate_floor)
                {
                    continue;
                }
                if next.contains(edge_id) || has_duplicate_selected_interval(arrangement, &next, *edge_id) {
                    continue;
                }
                next.insert(*edge_id);
                added_edge_ids.push(*edge_id);
            }
        }
    }
    if added_edge_ids.is_empty() {
        None
    } else {
        Some(AppliedBeamMove {
            selected: next,
            added_edge_ids,
            removed_edge_ids,
        })
    }
}

fn selected_edge_conflicts_with_carrier(
    arrangement: &CandidateArrangement,
    carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
    selected_edge_id: usize,
    candidate_carrier_id: usize,
) -> bool {
    let Some(selected_edge) = arrangement.atomic_edges.get(selected_edge_id) else {
        return false;
    };
    if selected_edge.carrier_id == candidate_carrier_id {
        return false;
    }
    let Some(selected_carrier) = carriers.get(&selected_edge.carrier_id) else {
        return false;
    };
    let Some(candidate_carrier) = carriers.get(&candidate_carrier_id) else {
        return false;
    };
    carriers_share_any_primitive(selected_carrier, candidate_carrier)
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

fn beam_move_priority(
    arrangement: &CandidateArrangement,
    candidate_move: &BeamMove,
    scores: &[SelectionEdgeScore],
    carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
    structural_index: &StructuralIndex,
    options: &SelectionOptions,
) -> f64 {
    match candidate_move {
        BeamMove::Edge { edge_id } => beam_candidate_priority(arrangement, &scores[*edge_id], carriers),
        BeamMove::SharedCarrier {
            carrier_id,
            edge_ids,
        } => {
            let edge_score = edge_ids
                .iter()
                .filter_map(|edge_id| scores.get(*edge_id))
                .map(|score| beam_candidate_priority(arrangement, score, carriers))
                .sum::<f64>();
            let explained = carriers
                .get(carrier_id)
                .and_then(|carrier| {
                    structural_index
                        .shared_explainable_local_edges
                        .get(&carrier.id)
                })
                .map(Vec::len)
                .unwrap_or(0);
            edge_score
                + explained as f64 * options.shared_carrier_continuity_reward
                + edge_ids.len() as f64 * 0.04
        }
    }
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

fn exact_penalty_cached(
    arrangement: &CandidateArrangement,
    options: &SelectionOptions,
    exact_options: &ExactProbeOptions,
    cache: &mut BTreeMap<Vec<usize>, f64>,
    selected_edges: &BTreeSet<usize>,
) -> f64 {
    let key = selected_edges.iter().copied().collect::<Vec<_>>();
    if let Some(value) = cache.get(&key) {
        return *value;
    }
    let value = exact_penalty(arrangement, options, exact_options, selected_edges);
    cache.insert(key, value);
    value
}

fn analyze_structural(
    arrangement: &CandidateArrangement,
    carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
    structural_index: &StructuralIndex,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    selected_edges: &BTreeSet<usize>,
    options: &SelectionOptions,
) -> StructuralAnalysis {
    let mut penalty = 0.0;
    let mut continuity_reward = 0.0;
    let mut edits = Vec::new();
    let mut local_fragments_retained = 0usize;
    let mut collapsible_degree_two_vertices = 0usize;
    let mut non_collinear_degree_two_vertices = 0usize;
    let mut incident_edges = BTreeMap::<usize, Vec<usize>>::new();
    for edge in arrangement
        .atomic_edges
        .iter()
        .filter(|edge| selected_edges.contains(&edge.id))
    {
        incident_edges.entry(edge.vertices[0]).or_default().push(edge.id);
        incident_edges.entry(edge.vertices[1]).or_default().push(edge.id);
    }

    for (vertex_id, edge_ids) in &incident_edges {
        let Some(vertex) = vertices.get(vertex_id).copied() else {
            continue;
        };
        if !is_interior_vertex(vertex) || edge_ids.len() != 2 {
            continue;
        }
        if incident_edges_are_collinear(arrangement, carriers, edge_ids[0], edge_ids[1]) {
            collapsible_degree_two_vertices += 1;
            edits.push(SelectionStructuralEdit {
                kind: SelectionStructuralEditKind::CollapsibleDegreeTwoVertex,
                vertex_ids: vec![*vertex_id],
                carrier_ids: edge_ids
                    .iter()
                    .filter_map(|edge_id| arrangement.atomic_edges.get(*edge_id))
                    .map(|edge| edge.carrier_id)
                    .collect(),
                added_edge_ids: edge_ids.clone(),
                removed_edge_ids: Vec::new(),
                score_delta: 0.0,
                reason: "degree-2 collinear vertex is a pass-through point on a crease"
                    .to_owned(),
            });
        } else {
            non_collinear_degree_two_vertices += 1;
            penalty += options.non_collinear_degree_two_cost;
            edits.push(SelectionStructuralEdit {
                kind: SelectionStructuralEditKind::NonCollinearDegreeTwoVertex,
                vertex_ids: vec![*vertex_id],
                carrier_ids: edge_ids
                    .iter()
                    .filter_map(|edge_id| arrangement.atomic_edges.get(*edge_id))
                    .map(|edge| edge.carrier_id)
                    .collect(),
                added_edge_ids: edge_ids.clone(),
                removed_edge_ids: Vec::new(),
                score_delta: -options.non_collinear_degree_two_cost,
                reason: "degree-2 interior vertex is not collinear, so it is likely a bad pseudo-junction"
                    .to_owned(),
            });
        }
    }

    let mut replaced_local_edge_ids = BTreeSet::new();
    let selected_shared_carriers = selected_edges
        .iter()
        .filter_map(|edge_id| arrangement.atomic_edges.get(*edge_id))
        .map(|edge| edge.carrier_id)
        .filter(|carrier_id| {
            carriers
                .get(carrier_id)
                .is_some_and(|carrier| carrier.kind == ArrangementCarrierKind::SharedCollinearAlternative)
        })
        .collect::<BTreeSet<_>>();
    let mut shared_replacements = 0usize;
    for carrier_id in selected_shared_carriers {
        let Some(carrier) = carriers.get(&carrier_id) else {
            continue;
        };
        let added_edge_ids = selected_edges
            .iter()
            .copied()
            .filter(|edge_id| {
                arrangement
                    .atomic_edges
                    .get(*edge_id)
                    .is_some_and(|edge| edge.carrier_id == carrier_id)
            })
            .collect::<Vec<_>>();
        let removed_edge_ids = structural_index
            .shared_explainable_local_edges
            .get(&carrier.id)
            .into_iter()
            .flatten()
            .copied()
            .filter(|edge_id| !selected_edges.contains(edge_id))
            .collect::<Vec<_>>();
        if removed_edge_ids.is_empty() {
            continue;
        }
        shared_replacements += 1;
        for edge_id in &removed_edge_ids {
            replaced_local_edge_ids.insert(*edge_id);
        }
        let reward = removed_edge_ids.len() as f64 * options.shared_carrier_continuity_reward;
        continuity_reward += reward;
        edits.push(SelectionStructuralEdit {
            kind: SelectionStructuralEditKind::SharedCarrierReplacement,
            vertex_ids: Vec::new(),
            carrier_ids: vec![carrier_id],
            added_edge_ids,
            removed_edge_ids,
            score_delta: reward,
            reason: "shared straight carrier replaces local observed fragments from the same primitives"
                .to_owned(),
        });
    }

    for edge_id in selected_edges {
        let Some(edge) = arrangement.atomic_edges.get(*edge_id) else {
            continue;
        };
        let Some(carrier) = carriers.get(&edge.carrier_id) else {
            continue;
        };
        if carrier.kind != ArrangementCarrierKind::ObservedLocal {
            continue;
        }
        if structural_index
            .local_edges_with_shared_alternative
            .contains(&edge.id)
        {
            local_fragments_retained += 1;
            penalty += options.local_fragment_cost;
        }
    }

    StructuralAnalysis {
        penalty,
        continuity_reward,
        shared_replacements,
        local_fragments_replaced: replaced_local_edge_ids.len(),
        local_fragments_retained,
        collapsible_degree_two_vertices,
        non_collinear_degree_two_vertices,
        edits,
    }
}

fn incident_edges_are_collinear(
    arrangement: &CandidateArrangement,
    carriers: &BTreeMap<usize, &crate::arrangement_v2::ArrangementCarrier>,
    left_edge_id: usize,
    right_edge_id: usize,
) -> bool {
    let Some(left_edge) = arrangement.atomic_edges.get(left_edge_id) else {
        return false;
    };
    let Some(right_edge) = arrangement.atomic_edges.get(right_edge_id) else {
        return false;
    };
    if left_edge.carrier_id == right_edge.carrier_id {
        return true;
    }
    let Some(left) = carriers.get(&left_edge.carrier_id) else {
        return false;
    };
    let Some(right) = carriers.get(&right_edge.carrier_id) else {
        return false;
    };
    let dot = (left.normal.x * right.normal.x + left.normal.y * right.normal.y)
        .clamp(-1.0, 1.0)
        .abs();
    let angle_tol = arrangement.options.collinear_angle_degrees.to_radians().max(3.0_f64.to_radians());
    let rho_tol = arrangement.options.collinear_rho_px / arrangement.image_size.max(1) as f64;
    dot.acos() <= angle_tol && (left.rho - right.rho).abs() <= rho_tol.max(0.006)
}

fn carriers_share_any_primitive(
    left: &crate::arrangement_v2::ArrangementCarrier,
    right: &crate::arrangement_v2::ArrangementCarrier,
) -> bool {
    left.primitive_ids
        .iter()
        .any(|primitive_id| right.primitive_ids.contains(primitive_id))
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
        structural_edits: Vec::new(),
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
            shared_replacements: 0,
            local_fragments_replaced: 0,
            local_fragments_retained: 0,
            collapsible_degree_two_vertices: 0,
            non_collinear_degree_two_vertices: 0,
            structural_penalty: 0.0,
            continuity_reward: 0.0,
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
        continuity_reward: 0.0,
        fragmentation_cost: 0.0,
        degree_two_cost: 0.0,
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
    fn beam_selects_weak_edge_when_it_improves_topology_before_lazy_exact_rescore() {
        let arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.88),
            edge(1, 1, [2, 3], 0.86),
            edge(2, 2, [1, 2], 0.30),
        ]);
        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());
        assert!(selection.selected_edge_ids.contains(&2));
        assert!(selection.report.weak_edges_promoted >= 1);
        assert!(selection.report.topology_improved_edges >= 1);
        assert!(selection.report.exactizability_evaluated);
        assert!(
            selection.report.total_score
                < selection
                    .edge_scores
                    .iter()
                    .filter(|score| score.decision == SelectionDecision::Selected)
                    .map(|score| score.total_score)
                    .sum::<f64>()
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
        let mut arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.86),
            edge(1, 1, [1, 2], 0.84),
            edge(2, 2, [2, 3], 0.83),
            edge(3, 3, [0, 1], 0.78),
            edge(4, 3, [1, 2], 0.78),
            edge(5, 3, [2, 3], 0.78),
        ]);
        arrangement.carriers[3].kind = ArrangementCarrierKind::SharedCollinearAlternative;
        arrangement.carriers[3].primitive_ids = vec![0, 1, 2];
        arrangement.carriers[3].hypothesis_cost = 0.08;
        arrangement.carriers[3].source = EvidenceSource::Inferred;
        for edge in &mut arrangement.atomic_edges[3..=5] {
            edge.source = EvidenceSource::Inferred;
        }
        arrangement.hypotheses.push(ArrangementHypothesis {
            id: 9,
            kind: ArrangementHypothesisKind::SharedCarrier,
            carrier_ids: vec![3],
            vertex_ids: Vec::new(),
            atomic_edge_ids: vec![3, 4, 5],
            cost: 0.08,
            reason: "test shared".to_owned(),
        });

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert!(!selection.selected_edge_ids.contains(&0));
        assert!(!selection.selected_edge_ids.contains(&1));
        assert!(!selection.selected_edge_ids.contains(&2));
        assert!(selection.selected_edge_ids.contains(&3));
        assert!(selection.selected_edge_ids.contains(&4));
        assert!(selection.selected_edge_ids.contains(&5));
        assert!(selection.selected_hypothesis_ids.contains(&9));
        assert_eq!(selection.report.shared_replacements, 1);
        assert_eq!(selection.report.local_fragments_replaced, 3);
        assert_eq!(selection.report.local_fragments_retained, 0);
        assert!(selection.structural_edits.iter().any(|edit| {
            edit.kind == SelectionStructuralEditKind::SharedCarrierReplacement
                && edit.removed_edge_ids == vec![0, 1, 2]
        }));
    }

    #[test]
    fn beam_reports_collinear_degree_two_vertices_as_collapsible() {
        let arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.86),
            edge(1, 1, [1, 2], 0.84),
        ]);

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert_eq!(selection.report.collapsible_degree_two_vertices, 1);
        assert_eq!(selection.report.non_collinear_degree_two_vertices, 0);
        assert!(selection.structural_edits.iter().any(|edit| {
            edit.kind == SelectionStructuralEditKind::CollapsibleDegreeTwoVertex
                && edit.vertex_ids == vec![1]
        }));
    }

    #[test]
    fn beam_penalizes_non_collinear_degree_two_vertices() {
        let mut arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.86),
            edge(1, 1, [1, 2], 0.84),
        ]);
        arrangement.carriers[1].normal = Point2::new(1.0, 0.0);
        arrangement.carriers[1].direction = Point2::new(0.0, 1.0);
        arrangement.carriers[1].rho = 0.4;

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert_eq!(selection.report.non_collinear_degree_two_vertices, 1);
        assert!(selection.report.structural_penalty > 0.0);
        assert!(selection.structural_edits.iter().any(|edit| {
            edit.kind == SelectionStructuralEditKind::NonCollinearDegreeTwoVertex
                && edit.vertex_ids == vec![1]
        }));
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
