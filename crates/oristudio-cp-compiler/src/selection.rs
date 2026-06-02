//! Weighted candidate selection for the compiler V2 architecture.
//!
//! This stage chooses a first selected graph from the V2 arrangement without
//! mutating geometry. `select_candidate_graph` is the Phase 3 greedy scaffold;
//! `select_candidate_graph_beam` is the Phase 5 exactizability-aware selector.

use crate::arrangement_v2::{
    ArrangementAtomicEdge, ArrangementCarrier, ArrangementCarrierKind, ArrangementHypothesisKind,
    ArrangementVertex, ArrangementVertexKind, CandidateArrangement,
};
use crate::exact_probe::{ExactProbeOptions, probe_exactizability};
use crate::{AssignmentLabel, EvidenceSource};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const SCHEMA: &str = "oristudio/cp-compiler/candidate-selection-v2";
const LOCAL_FRAGMENT_SELECTION_COST_MULTIPLIER: f64 = 6.0;
const SPAN_COMPLEXITY_COST: f64 = 0.08;

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
    #[serde(default)]
    pub selected_spans: Vec<SelectionSpan>,
    pub rejected_edge_ids: Vec<usize>,
    pub undecided_edge_ids: Vec<usize>,
    pub selected_hypothesis_ids: Vec<usize>,
    pub edge_scores: Vec<SelectionEdgeScore>,
    #[serde(default)]
    pub structural_edits: Vec<SelectionStructuralEdit>,
    pub report: CandidateSelectionReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectionSpan {
    pub id: usize,
    pub kind: SelectionSpanKind,
    pub carrier_id: usize,
    pub vertices: [usize; 2],
    pub t_interval: [f64; 2],
    pub assignment: crate::AssignmentCandidate,
    #[serde(default)]
    pub source_atomic_edge_ids: Vec<usize>,
    #[serde(default)]
    pub replaced_atomic_edge_ids: Vec<usize>,
    #[serde(default)]
    pub collapsed_vertex_ids: Vec<usize>,
    pub line_support_min: f64,
    pub line_support_mean: f64,
    pub line_support_max: f64,
    pub score: f64,
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionSpanKind {
    AtomicInterval,
    ObservedCarrierSpan,
    SharedCarrierSpan,
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
    pub selected_spans: usize,
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
    let selected_spans =
        selected_spans_from_selection(arrangement, &scores, &selected, &[], &vertices, &carriers);
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
        selected_spans: selected_spans.len(),
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
        selected_spans,
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

    let span_candidates = build_span_candidates(
        arrangement,
        &scores,
        &vertices,
        &carriers,
        &structural_index,
        &options,
    );
    let seed_span_ids = seed_span_ids(arrangement, &span_candidates, &carriers, &options);
    let seed_odd = odd_degree_count_from_span_ids(&span_candidates, &vertices, &seed_span_ids);
    let mut exact_cache = BTreeMap::<Vec<usize>, f64>::new();
    let seed_state = score_span_beam_state(
        arrangement,
        &span_candidates,
        &vertices,
        &carriers,
        &structural_index,
        &options,
        &exact_options,
        seed_odd,
        seed_span_ids,
        &mut exact_cache,
    );
    let mut beam = vec![seed_state];

    let mut candidate_ids = span_candidates
        .iter()
        .filter(|candidate| !beam[0].selected_span_ids.contains(&candidate.id))
        .map(|candidate| candidate.id)
        .collect::<Vec<_>>();
    candidate_ids.sort_by(|left, right| {
        span_candidate_priority(&span_candidates[*right])
            .total_cmp(&span_candidate_priority(&span_candidates[*left]))
            .then_with(|| left.cmp(right))
    });
    candidate_ids.truncate(options.max_beam_candidates);

    for candidate_id in candidate_ids {
        let mut next = Vec::with_capacity(beam.len() * 2);
        for state in &beam {
            next.push(state.clone());
            let next_span_ids = apply_span_candidate(&span_candidates, state, candidate_id);
            if next_span_ids == state.selected_span_ids {
                continue;
            }
            let candidate_state = score_span_beam_state(
                arrangement,
                &span_candidates,
                &vertices,
                &carriers,
                &structural_index,
                &options,
                &exact_options,
                seed_odd,
                next_span_ids,
                &mut exact_cache,
            );
            next.push(candidate_state);
        }
        next.sort_by(span_beam_state_order);
        next.dedup_by(|left, right| left.selected_span_ids == right.selected_span_ids);
        let width = options.beam_width.max(1);
        next.truncate(width);
        beam = next;
    }

    beam.sort_by(span_beam_state_order);
    let best = beam.into_iter().next().unwrap_or_else(|| SpanBeamState {
        selected_span_ids: BTreeSet::new(),
        selected_edge_ids: BTreeSet::new(),
        exact_penalty: 0.0,
        odd_degree_vertices: 0,
        total_score: 0.0,
    });

    let final_structural = analyze_span_structural(
        &span_candidates,
        &best.selected_span_ids,
        arrangement,
        &carriers,
        &structural_index,
        &vertices,
        &options,
    );
    let replaced_edge_ids = final_structural
        .edits
        .iter()
        .flat_map(|edit| edit.removed_edge_ids.iter().copied())
        .collect::<BTreeSet<_>>();
    for score in &mut scores {
        let edge = &arrangement.atomic_edges[score.edge_id];
        if best.selected_edge_ids.contains(&score.edge_id) {
            score.decision = SelectionDecision::Selected;
            score
                .reasons
                .push("selected as provenance for a Stage 5 span hypothesis".to_owned());
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
        } else if has_duplicate_selected_interval(
            arrangement,
            &best.selected_edge_ids,
            score.edge_id,
        ) {
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
                .push("kept as plausible but not selected by span-level beam".to_owned());
        } else {
            score.decision = SelectionDecision::Rejected;
            score.total_score = score.breakdown.total();
            score
                .reasons
                .push("rejected by visual/topology/span objective score".to_owned());
        }
    }

    let selected = best.selected_edge_ids.clone();
    let selected_hypotheses = selected_hypotheses(arrangement, &selected, &options);
    let selected_edge_ids = ordered_ids(&scores, SelectionDecision::Selected);
    let rejected_edge_ids = ordered_ids(&scores, SelectionDecision::Rejected);
    let undecided_edge_ids = ordered_ids(&scores, SelectionDecision::Undecided);
    let selected_spans = selected_spans_from_candidates(&span_candidates, &best.selected_span_ids);
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
    let topology_improved_edges = weak_edges_promoted;
    let total_score = best.total_score;
    let report = CandidateSelectionReport {
        selected_edges: selected_edge_ids.len(),
        selected_spans: selected_spans.len(),
        rejected_edges: rejected_edge_ids.len(),
        undecided_edges: undecided_edge_ids.len(),
        selected_hypotheses: selected_hypotheses.len(),
        weak_edges_promoted,
        topology_improved_edges,
        duplicate_edges_rejected,
        odd_degree_vertices: odd_degree_count_from_span_ids(
            &span_candidates,
            &vertices,
            &best.selected_span_ids,
        ),
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
        selected_spans,
        rejected_edge_ids,
        undecided_edge_ids,
        selected_hypothesis_ids: selected_hypotheses.into_iter().collect(),
        edge_scores: scores,
        structural_edits: final_structural.edits,
        report,
    }
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

#[derive(Debug, Clone)]
struct SpanCandidate {
    id: usize,
    span: SelectionSpan,
    conflicts: BTreeSet<usize>,
}

#[derive(Debug, Clone)]
struct SpanBeamState {
    selected_span_ids: BTreeSet<usize>,
    selected_edge_ids: BTreeSet<usize>,
    exact_penalty: f64,
    odd_degree_vertices: usize,
    total_score: f64,
}

fn build_span_candidates(
    arrangement: &CandidateArrangement,
    scores: &[SelectionEdgeScore],
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    structural_index: &StructuralIndex,
    options: &SelectionOptions,
) -> Vec<SpanCandidate> {
    let mut candidates = Vec::<SpanCandidate>::new();
    let observed_chain_paths =
        observed_carrier_span_paths(arrangement, scores, vertices, carriers, options);
    let observed_chain_edge_ids = observed_chain_paths
        .iter()
        .flat_map(|(_, path)| path.edge_ids.iter().copied())
        .collect::<BTreeSet<_>>();

    for edge in &arrangement.atomic_edges {
        let Some(carrier) = carriers.get(&edge.carrier_id).copied() else {
            continue;
        };
        if carrier.kind == ArrangementCarrierKind::SharedCollinearAlternative {
            continue;
        }
        let Some(score) = scores.get(edge.id) else {
            continue;
        };
        if edge.line_support < options.weak_edge_support
            || score.breakdown.total() < options.weak_candidate_floor
        {
            continue;
        }
        let path = SpanPath {
            vertices: edge.vertices,
            edge_ids: vec![edge.id],
            collapsed_vertex_ids: Vec::new(),
        };
        let Some(mut span) = selection_span_from_path(
            arrangement,
            scores,
            carriers,
            SelectionSpanKind::AtomicInterval,
            edge.carrier_id,
            path,
            Vec::new(),
            vec!["candidate atomic interval span".to_owned()],
        ) else {
            continue;
        };
        span.score = atomic_span_score(
            edge,
            score,
            structural_index,
            &observed_chain_edge_ids,
            options,
            &mut span.reasons,
        );
        if span.score >= options.weak_candidate_floor
            || edge.line_support >= options.strong_edge_support
        {
            candidates.push(SpanCandidate {
                id: 0,
                span,
                conflicts: BTreeSet::new(),
            });
        }
    }

    for (carrier_id, path) in observed_chain_paths {
        let Some(mut span) = selection_span_from_path(
            arrangement,
            scores,
            carriers,
            SelectionSpanKind::ObservedCarrierSpan,
            carrier_id,
            path,
            Vec::new(),
            vec!["candidate observed carrier span".to_owned()],
        ) else {
            continue;
        };
        let Some(carrier) = carriers.get(&carrier_id).copied() else {
            continue;
        };
        span.score = observed_carrier_span_score(arrangement, &span, vertices, carrier, options);
        span.reasons.push(format!(
            "span-level objective score {:.3}; collapses {} pass-through vertex/vertices over {} atomic evidence interval(s)",
            span.score,
            span.collapsed_vertex_ids.len(),
            span.source_atomic_edge_ids.len()
        ));
        if span.score >= options.weak_candidate_floor {
            candidates.push(SpanCandidate {
                id: 0,
                span,
                conflicts: BTreeSet::new(),
            });
        }
    }

    for carrier in carriers
        .values()
        .copied()
        .filter(|carrier| carrier.kind == ArrangementCarrierKind::SharedCollinearAlternative)
    {
        let source_edge_ids = arrangement
            .atomic_edges
            .iter()
            .filter(|edge| edge.carrier_id == carrier.id)
            .filter(|edge| edge.line_support >= options.weak_edge_support)
            .filter(|edge| {
                scores
                    .get(edge.id)
                    .is_some_and(|score| score.breakdown.total() >= options.weak_candidate_floor)
            })
            .map(|edge| edge.id)
            .collect::<Vec<_>>();
        if source_edge_ids.is_empty() {
            continue;
        }
        let source_edge_set = source_edge_ids.iter().copied().collect::<BTreeSet<_>>();
        let incident = selected_incident_edges(arrangement, &source_edge_set);
        for path in shared_carrier_span_paths(
            arrangement,
            vertices,
            carriers,
            &incident,
            carrier.id,
            &source_edge_ids,
        ) {
            let Some(path_interval) = span_path_t_interval(arrangement, &path.edge_ids) else {
                continue;
            };
            let replaced_edge_ids = local_edges_replaced_by_shared_span(
                arrangement,
                vertices,
                carrier,
                structural_index,
                path_interval,
                options,
            );
            if replaced_edge_ids.is_empty() {
                continue;
            }
            let Some(mut span) = selection_span_from_path(
                arrangement,
                scores,
                carriers,
                SelectionSpanKind::SharedCarrierSpan,
                carrier.id,
                path,
                replaced_edge_ids,
                vec!["candidate shared carrier span".to_owned()],
            ) else {
                continue;
            };
            span.score = shared_span_score(arrangement, &span, vertices, carrier, options);
            span.reasons.push(format!(
                "span-level objective score {:.3}; replaces {} local fragment(s)",
                span.score,
                span.replaced_atomic_edge_ids.len()
            ));
            if span.score >= options.weak_candidate_floor {
                candidates.push(SpanCandidate {
                    id: 0,
                    span,
                    conflicts: BTreeSet::new(),
                });
            }
        }
    }

    candidates.sort_by(|left, right| {
        span_candidate_priority(right)
            .total_cmp(&span_candidate_priority(left))
            .then_with(|| left.span.vertices.cmp(&right.span.vertices))
            .then_with(|| left.span.carrier_id.cmp(&right.span.carrier_id))
            .then_with(|| left.span.kind.cmp(&right.span.kind))
    });
    for (id, candidate) in candidates.iter_mut().enumerate() {
        candidate.id = id;
        candidate.span.id = id;
    }
    let conflicts = span_candidate_conflicts(&candidates);
    for candidate in &mut candidates {
        candidate.conflicts = conflicts.get(&candidate.id).cloned().unwrap_or_default();
    }
    candidates
}

fn atomic_span_score(
    edge: &ArrangementAtomicEdge,
    score: &SelectionEdgeScore,
    structural_index: &StructuralIndex,
    observed_chain_edge_ids: &BTreeSet<usize>,
    options: &SelectionOptions,
    reasons: &mut Vec<String>,
) -> f64 {
    let mut total = score.breakdown.total() - SPAN_COMPLEXITY_COST;
    if structural_index
        .local_edges_with_shared_alternative
        .contains(&edge.id)
    {
        let cost = options.local_fragment_cost * LOCAL_FRAGMENT_SELECTION_COST_MULTIPLIER;
        total -= cost;
        reasons.push(format!(
            "penalized {:.3} because a shared carrier can explain this local fragment",
            cost
        ));
    }
    if observed_chain_edge_ids.contains(&edge.id) {
        let cost = options.local_fragment_cost * LOCAL_FRAGMENT_SELECTION_COST_MULTIPLIER;
        total -= cost;
        reasons.push(format!(
            "penalized {:.3} because an observed carrier span can explain this pass-through fragment",
            cost
        ));
    }
    reasons.push(format!("span-level objective score {:.3}", total));
    total
}

fn observed_carrier_span_paths(
    arrangement: &CandidateArrangement,
    scores: &[SelectionEdgeScore],
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    options: &SelectionOptions,
) -> Vec<(usize, SpanPath)> {
    let mut paths = Vec::new();
    for carrier in carriers.values().copied().filter(|carrier| {
        carrier.kind == ArrangementCarrierKind::ObservedLocal
            && carrier.assignment.label != AssignmentLabel::Boundary
    }) {
        let edge_ids = arrangement
            .atomic_edges
            .iter()
            .filter(|edge| edge.carrier_id == carrier.id)
            .filter(|edge| edge.assignment.label != AssignmentLabel::Boundary)
            .filter(|edge| edge.line_support >= options.weak_edge_support)
            .filter(|edge| {
                scores
                    .get(edge.id)
                    .is_some_and(|score| score.breakdown.total() >= options.weak_candidate_floor)
            })
            .map(|edge| edge.id)
            .collect::<Vec<_>>();
        if edge_ids.len() < 2 {
            continue;
        }
        let source_edge_set = edge_ids.iter().copied().collect::<BTreeSet<_>>();
        let incident = selected_incident_edges(arrangement, &source_edge_set);
        for path in shared_carrier_span_paths(
            arrangement,
            vertices,
            carriers,
            &incident,
            carrier.id,
            &edge_ids,
        ) {
            if path.edge_ids.len() < 2 && path.collapsed_vertex_ids.is_empty() {
                continue;
            }
            paths.push((carrier.id, path));
        }
    }
    paths
}

fn observed_carrier_span_score(
    arrangement: &CandidateArrangement,
    span: &SelectionSpan,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carrier: &ArrangementCarrier,
    options: &SelectionOptions,
) -> f64 {
    let (support_min, support_mean, support_max) = combined_support_stats(arrangement, span)
        .unwrap_or((
            span.line_support_min,
            span.line_support_mean,
            span.line_support_max,
        ));
    let visual_reward = 1.85 * support_mean + 0.25 * support_max;
    let endpoint_reward = span
        .vertices
        .iter()
        .filter_map(|vertex_id| vertices.get(vertex_id).copied())
        .map(vertex_anchor_reward)
        .sum::<f64>();
    let assignment_reward = if span.assignment.label == AssignmentLabel::Unknown {
        0.0
    } else {
        0.18 * span.assignment.confidence.clamp(0.0, 1.0)
    };
    let weak_support_cost = if support_min < options.weak_edge_support {
        (options.weak_edge_support - support_min).max(0.0) * 0.9
    } else if support_mean < options.strong_edge_support {
        (options.strong_edge_support - support_mean).max(0.0) * 0.45
    } else {
        0.0
    };
    let length = (span.t_interval[1] - span.t_interval[0]).abs();
    let tiny_edge_cost = if length < options.min_edge_length {
        options.tiny_edge_cost * (1.0 - length / options.min_edge_length).max(0.0)
    } else {
        0.0
    };
    let fragment_count = span.source_atomic_edge_ids.len().saturating_sub(1) as f64;
    let fragmentation_avoidance =
        fragment_count * options.local_fragment_cost * LOCAL_FRAGMENT_SELECTION_COST_MULTIPLIER;
    let pass_through_reward = span.collapsed_vertex_ids.len() as f64 * 0.12;

    visual_reward
        + endpoint_reward
        + assignment_reward
        + fragmentation_avoidance
        + pass_through_reward
        - weak_support_cost
        - carrier.hypothesis_cost
        - tiny_edge_cost
        - SPAN_COMPLEXITY_COST
}

fn shared_span_score(
    arrangement: &CandidateArrangement,
    span: &SelectionSpan,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carrier: &ArrangementCarrier,
    options: &SelectionOptions,
) -> f64 {
    let (support_min, support_mean, support_max) = combined_support_stats(arrangement, span)
        .unwrap_or((
            span.line_support_min,
            span.line_support_mean,
            span.line_support_max,
        ));
    let visual_reward = 1.85 * support_mean + 0.25 * support_max;
    let endpoint_reward = span
        .vertices
        .iter()
        .filter_map(|vertex_id| vertices.get(vertex_id).copied())
        .map(vertex_anchor_reward)
        .sum::<f64>();
    let assignment_reward = if span.assignment.label == AssignmentLabel::Unknown {
        0.0
    } else {
        0.18 * span.assignment.confidence.clamp(0.0, 1.0)
    };
    let weak_support_cost = if support_min < options.weak_edge_support {
        (options.weak_edge_support - support_min).max(0.0) * 0.9
    } else if support_mean < options.strong_edge_support {
        (options.strong_edge_support - support_mean).max(0.0) * 0.45
    } else {
        0.0
    };
    let inferred_geometry_cost = if carrier.source == EvidenceSource::Inferred {
        options.inferred_geometry_cost
    } else {
        0.0
    };
    let length = (span.t_interval[1] - span.t_interval[0]).abs();
    let tiny_edge_cost = if length < options.min_edge_length {
        options.tiny_edge_cost * (1.0 - length / options.min_edge_length).max(0.0)
    } else {
        0.0
    };
    let replaced = span.replaced_atomic_edge_ids.len() as f64;
    let continuity_reward = replaced * options.shared_carrier_continuity_reward;
    let fragmentation_avoidance =
        replaced * options.local_fragment_cost * LOCAL_FRAGMENT_SELECTION_COST_MULTIPLIER;
    let pass_through_reward = span.collapsed_vertex_ids.len() as f64 * 0.06;

    visual_reward
        + endpoint_reward
        + assignment_reward
        + continuity_reward
        + fragmentation_avoidance
        + pass_through_reward
        - weak_support_cost
        - inferred_geometry_cost
        - carrier.hypothesis_cost
        - tiny_edge_cost
        - SPAN_COMPLEXITY_COST
}

fn combined_support_stats(
    arrangement: &CandidateArrangement,
    span: &SelectionSpan,
) -> Option<(f64, f64, f64)> {
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut sum = 0.0;
    let mut count = 0usize;
    for edge_id in span
        .source_atomic_edge_ids
        .iter()
        .chain(span.replaced_atomic_edge_ids.iter())
    {
        let Some(edge) = arrangement.atomic_edges.get(*edge_id) else {
            continue;
        };
        min = min.min(edge.line_support);
        max = max.max(edge.line_support);
        sum += edge.line_support;
        count += 1;
    }
    (count > 0).then_some((min, sum / count as f64, max))
}

fn span_path_t_interval(
    arrangement: &CandidateArrangement,
    edge_ids: &[usize],
) -> Option<[f64; 2]> {
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for edge_id in edge_ids {
        let edge = arrangement.atomic_edges.get(*edge_id)?;
        min = min.min(edge.t_interval[0]).min(edge.t_interval[1]);
        max = max.max(edge.t_interval[0]).max(edge.t_interval[1]);
    }
    (min.is_finite() && max.is_finite() && min < max).then_some([min, max])
}

fn local_edges_replaced_by_shared_span(
    arrangement: &CandidateArrangement,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    shared_carrier: &ArrangementCarrier,
    structural_index: &StructuralIndex,
    span_interval: [f64; 2],
    options: &SelectionOptions,
) -> Vec<usize> {
    let mut edge_ids = structural_index
        .shared_explainable_local_edges
        .get(&shared_carrier.id)
        .into_iter()
        .flatten()
        .copied()
        .filter(|edge_id| {
            let Some(edge) = arrangement.atomic_edges.get(*edge_id) else {
                return false;
            };
            if edge.line_support < options.weak_edge_support {
                return false;
            }
            edge_projection_interval_on_carrier(edge, vertices, shared_carrier)
                .is_some_and(|local_interval| intervals_overlap(span_interval, local_interval))
        })
        .collect::<Vec<_>>();
    edge_ids.sort_unstable();
    edge_ids.dedup();
    edge_ids
}

fn edge_projection_interval_on_carrier(
    edge: &ArrangementAtomicEdge,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carrier: &ArrangementCarrier,
) -> Option<[f64; 2]> {
    let a = vertices.get(&edge.vertices[0]).copied()?;
    let b = vertices.get(&edge.vertices[1]).copied()?;
    let t0 = a.point.x * carrier.direction.x + a.point.y * carrier.direction.y;
    let t1 = b.point.x * carrier.direction.x + b.point.y * carrier.direction.y;
    Some([t0.min(t1), t0.max(t1)])
}

fn intervals_overlap(left: [f64; 2], right: [f64; 2]) -> bool {
    let overlap = left[1].min(right[1]) - left[0].max(right[0]);
    overlap > 1e-6
}

fn span_candidate_conflicts(candidates: &[SpanCandidate]) -> BTreeMap<usize, BTreeSet<usize>> {
    let mut conflicts = BTreeMap::<usize, BTreeSet<usize>>::new();
    for left_index in 0..candidates.len() {
        for right_index in (left_index + 1)..candidates.len() {
            if !span_candidates_conflict(&candidates[left_index], &candidates[right_index]) {
                continue;
            }
            conflicts
                .entry(candidates[left_index].id)
                .or_default()
                .insert(candidates[right_index].id);
            conflicts
                .entry(candidates[right_index].id)
                .or_default()
                .insert(candidates[left_index].id);
        }
    }
    conflicts
}

fn span_candidates_conflict(left: &SpanCandidate, right: &SpanCandidate) -> bool {
    let left_source = left
        .span
        .source_atomic_edge_ids
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    let right_source = right
        .span
        .source_atomic_edge_ids
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if !left_source.is_disjoint(&right_source) {
        return true;
    }
    if left
        .span
        .replaced_atomic_edge_ids
        .iter()
        .any(|edge_id| right_source.contains(edge_id))
        || right
            .span
            .replaced_atomic_edge_ids
            .iter()
            .any(|edge_id| left_source.contains(edge_id))
    {
        return true;
    }

    let mut left_vertices = left.span.vertices;
    let mut right_vertices = right.span.vertices;
    left_vertices.sort_unstable();
    right_vertices.sort_unstable();
    left_vertices == right_vertices
}

fn seed_span_ids(
    arrangement: &CandidateArrangement,
    candidates: &[SpanCandidate],
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    options: &SelectionOptions,
) -> BTreeSet<usize> {
    let mut selected = BTreeSet::new();
    for candidate in candidates {
        if candidate.span.kind != SelectionSpanKind::AtomicInterval {
            continue;
        }
        let Some(edge_id) = candidate.span.source_atomic_edge_ids.first().copied() else {
            continue;
        };
        let Some(edge) = arrangement.atomic_edges.get(edge_id) else {
            continue;
        };
        let Some(carrier) = carriers.get(&edge.carrier_id).copied() else {
            continue;
        };
        if carrier.kind != ArrangementCarrierKind::ObservedLocal
            || edge.line_support < options.strong_edge_support
            || candidate.span.score < options.min_selected_score
        {
            continue;
        }
        if selected
            .iter()
            .any(|selected_id| candidate.conflicts.contains(selected_id))
        {
            continue;
        }
        selected.insert(candidate.id);
    }
    selected
}

fn apply_span_candidate(
    candidates: &[SpanCandidate],
    state: &SpanBeamState,
    candidate_id: usize,
) -> BTreeSet<usize> {
    let Some(candidate) = candidates.get(candidate_id) else {
        return state.selected_span_ids.clone();
    };
    let mut selected = state.selected_span_ids.clone();
    for conflict_id in &candidate.conflicts {
        selected.remove(conflict_id);
    }
    selected.insert(candidate_id);
    selected
}

fn score_span_beam_state(
    arrangement: &CandidateArrangement,
    candidates: &[SpanCandidate],
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    structural_index: &StructuralIndex,
    options: &SelectionOptions,
    exact_options: &ExactProbeOptions,
    baseline_odd_vertices: usize,
    selected_span_ids: BTreeSet<usize>,
    exact_cache: &mut BTreeMap<Vec<usize>, f64>,
) -> SpanBeamState {
    let selected_edge_ids = selected_edge_ids_for_span_ids(candidates, &selected_span_ids);
    let odd_degree_vertices =
        odd_degree_count_from_span_ids(candidates, vertices, &selected_span_ids);
    let topology_reward =
        (baseline_odd_vertices as f64 - odd_degree_vertices as f64) * options.odd_degree_bonus;
    let span_score = selected_span_ids
        .iter()
        .filter_map(|span_id| candidates.get(*span_id))
        .map(|candidate| candidate.span.score)
        .sum::<f64>();
    let structural = analyze_span_structural(
        candidates,
        &selected_span_ids,
        arrangement,
        carriers,
        structural_index,
        vertices,
        options,
    );
    let exact_penalty = exact_penalty_cached(
        arrangement,
        options,
        exact_options,
        exact_cache,
        &selected_edge_ids,
    );
    let total_score = span_score + topology_reward - structural.penalty - exact_penalty;
    SpanBeamState {
        selected_span_ids,
        selected_edge_ids,
        exact_penalty,
        odd_degree_vertices,
        total_score,
    }
}

fn span_beam_state_order(left: &SpanBeamState, right: &SpanBeamState) -> std::cmp::Ordering {
    right
        .total_score
        .total_cmp(&left.total_score)
        .then_with(|| left.exact_penalty.total_cmp(&right.exact_penalty))
        .then_with(|| left.odd_degree_vertices.cmp(&right.odd_degree_vertices))
        .then_with(|| {
            left.selected_span_ids
                .len()
                .cmp(&right.selected_span_ids.len())
        })
}

fn span_candidate_priority(candidate: &SpanCandidate) -> f64 {
    let shared_bonus = if candidate.span.kind == SelectionSpanKind::SharedCarrierSpan {
        candidate.span.replaced_atomic_edge_ids.len() as f64 * 0.5
            + candidate.span.collapsed_vertex_ids.len() as f64 * 0.12
    } else {
        0.0
    };
    let observed_chain_bonus = if candidate.span.kind == SelectionSpanKind::ObservedCarrierSpan {
        candidate
            .span
            .source_atomic_edge_ids
            .len()
            .saturating_sub(1) as f64
            * 0.35
            + candidate.span.collapsed_vertex_ids.len() as f64 * 0.12
    } else {
        0.0
    };
    candidate.span.score + shared_bonus + observed_chain_bonus
}

fn selected_edge_ids_for_span_ids(
    candidates: &[SpanCandidate],
    selected_span_ids: &BTreeSet<usize>,
) -> BTreeSet<usize> {
    selected_span_ids
        .iter()
        .filter_map(|span_id| candidates.get(*span_id))
        .flat_map(|candidate| candidate.span.source_atomic_edge_ids.iter().copied())
        .collect()
}

fn selected_spans_from_candidates(
    candidates: &[SpanCandidate],
    selected_span_ids: &BTreeSet<usize>,
) -> Vec<SelectionSpan> {
    let mut spans = selected_span_ids
        .iter()
        .filter_map(|span_id| candidates.get(*span_id))
        .map(|candidate| candidate.span.clone())
        .collect::<Vec<_>>();
    spans.sort_by(|left, right| {
        left.vertices
            .cmp(&right.vertices)
            .then_with(|| left.carrier_id.cmp(&right.carrier_id))
            .then_with(|| left.t_interval[0].total_cmp(&right.t_interval[0]))
            .then_with(|| left.t_interval[1].total_cmp(&right.t_interval[1]))
            .then_with(|| left.kind.cmp(&right.kind))
    });
    for (id, span) in spans.iter_mut().enumerate() {
        span.id = id;
    }
    spans
}

fn odd_degree_count_from_span_ids(
    candidates: &[SpanCandidate],
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    selected_span_ids: &BTreeSet<usize>,
) -> usize {
    let mut degrees = BTreeMap::<usize, usize>::new();
    for candidate in selected_span_ids
        .iter()
        .filter_map(|span_id| candidates.get(*span_id))
    {
        *degrees.entry(candidate.span.vertices[0]).or_default() += 1;
        *degrees.entry(candidate.span.vertices[1]).or_default() += 1;
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

fn analyze_span_structural(
    candidates: &[SpanCandidate],
    selected_span_ids: &BTreeSet<usize>,
    arrangement: &CandidateArrangement,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    structural_index: &StructuralIndex,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    options: &SelectionOptions,
) -> StructuralAnalysis {
    let mut penalty = 0.0;
    let mut continuity_reward = 0.0;
    let mut edits = Vec::new();
    let mut local_fragments_retained = 0usize;
    let mut collapsible_degree_two_vertices = 0usize;
    let mut non_collinear_degree_two_vertices = 0usize;

    let mut incident_spans = BTreeMap::<usize, Vec<usize>>::new();
    for span_id in selected_span_ids {
        let Some(candidate) = candidates.get(*span_id) else {
            continue;
        };
        incident_spans
            .entry(candidate.span.vertices[0])
            .or_default()
            .push(candidate.id);
        incident_spans
            .entry(candidate.span.vertices[1])
            .or_default()
            .push(candidate.id);
    }
    for (vertex_id, span_ids) in &incident_spans {
        let Some(vertex) = vertices.get(vertex_id).copied() else {
            continue;
        };
        if !is_interior_vertex(vertex) || span_ids.len() != 2 {
            continue;
        }
        if selected_spans_are_collinear(arrangement, carriers, candidates, span_ids[0], span_ids[1])
        {
            collapsible_degree_two_vertices += 1;
            edits.push(SelectionStructuralEdit {
                kind: SelectionStructuralEditKind::CollapsibleDegreeTwoVertex,
                vertex_ids: vec![*vertex_id],
                carrier_ids: span_ids
                    .iter()
                    .filter_map(|span_id| candidates.get(*span_id))
                    .map(|candidate| candidate.span.carrier_id)
                    .collect(),
                added_edge_ids: span_ids
                    .iter()
                    .filter_map(|span_id| candidates.get(*span_id))
                    .flat_map(|candidate| candidate.span.source_atomic_edge_ids.iter().copied())
                    .collect(),
                removed_edge_ids: Vec::new(),
                score_delta: 0.0,
                reason: "degree-2 collinear vertex remains collapsible in selected span graph"
                    .to_owned(),
            });
        } else {
            non_collinear_degree_two_vertices += 1;
            penalty += options.non_collinear_degree_two_cost;
            edits.push(SelectionStructuralEdit {
                kind: SelectionStructuralEditKind::NonCollinearDegreeTwoVertex,
                vertex_ids: vec![*vertex_id],
                carrier_ids: span_ids
                    .iter()
                    .filter_map(|span_id| candidates.get(*span_id))
                    .map(|candidate| candidate.span.carrier_id)
                    .collect(),
                added_edge_ids: span_ids
                    .iter()
                    .filter_map(|span_id| candidates.get(*span_id))
                    .flat_map(|candidate| candidate.span.source_atomic_edge_ids.iter().copied())
                    .collect(),
                removed_edge_ids: Vec::new(),
                score_delta: -options.non_collinear_degree_two_cost,
                reason: "degree-2 interior vertex is not collinear in selected span graph"
                    .to_owned(),
            });
        }
    }

    let mut replacement_by_carrier = BTreeMap::<usize, (BTreeSet<usize>, BTreeSet<usize>)>::new();
    for candidate in selected_span_ids
        .iter()
        .filter_map(|span_id| candidates.get(*span_id))
    {
        if candidate.span.kind == SelectionSpanKind::SharedCarrierSpan {
            let entry = replacement_by_carrier
                .entry(candidate.span.carrier_id)
                .or_default();
            entry
                .0
                .extend(candidate.span.source_atomic_edge_ids.iter().copied());
            entry
                .1
                .extend(candidate.span.replaced_atomic_edge_ids.iter().copied());
        }
        if candidate.span.kind == SelectionSpanKind::AtomicInterval
            && candidate.span.source_atomic_edge_ids.iter().any(|edge_id| {
                structural_index
                    .local_edges_with_shared_alternative
                    .contains(edge_id)
            })
        {
            local_fragments_retained += 1;
            penalty += options.local_fragment_cost * LOCAL_FRAGMENT_SELECTION_COST_MULTIPLIER;
        }
    }

    let mut replaced_local_edge_ids = BTreeSet::new();
    for (carrier_id, (added, removed)) in replacement_by_carrier {
        if removed.is_empty() {
            continue;
        }
        replaced_local_edge_ids.extend(removed.iter().copied());
        let reward = removed.len() as f64 * options.shared_carrier_continuity_reward;
        continuity_reward += reward;
        edits.push(SelectionStructuralEdit {
            kind: SelectionStructuralEditKind::SharedCarrierReplacement,
            vertex_ids: Vec::new(),
            carrier_ids: vec![carrier_id],
            added_edge_ids: added.into_iter().collect(),
            removed_edge_ids: removed.into_iter().collect(),
            score_delta: reward,
            reason:
                "selected shared span replaces local observed fragments from the same primitives"
                    .to_owned(),
        });
    }

    StructuralAnalysis {
        penalty,
        continuity_reward,
        shared_replacements: edits
            .iter()
            .filter(|edit| edit.kind == SelectionStructuralEditKind::SharedCarrierReplacement)
            .count(),
        local_fragments_replaced: replaced_local_edge_ids.len(),
        local_fragments_retained,
        collapsible_degree_two_vertices,
        non_collinear_degree_two_vertices,
        edits,
    }
}

fn selected_spans_are_collinear(
    arrangement: &CandidateArrangement,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    candidates: &[SpanCandidate],
    left_span_id: usize,
    right_span_id: usize,
) -> bool {
    let Some(left) = candidates.get(left_span_id) else {
        return false;
    };
    let Some(right) = candidates.get(right_span_id) else {
        return false;
    };
    if left.span.carrier_id == right.span.carrier_id {
        return true;
    }
    let Some(left_carrier) = carriers.get(&left.span.carrier_id).copied() else {
        return false;
    };
    let Some(right_carrier) = carriers.get(&right.span.carrier_id).copied() else {
        return false;
    };
    let dot = (left_carrier.normal.x * right_carrier.normal.x
        + left_carrier.normal.y * right_carrier.normal.y)
        .clamp(-1.0, 1.0)
        .abs();
    let angle_tol = arrangement
        .options
        .collinear_angle_degrees
        .to_radians()
        .max(3.0_f64.to_radians());
    let rho_tol = arrangement.options.collinear_rho_px / arrangement.image_size.max(1) as f64;
    dot.acos() <= angle_tol && (left_carrier.rho - right_carrier.rho).abs() <= rho_tol.max(0.006)
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

#[derive(Debug, Clone)]
struct SpanPath {
    vertices: [usize; 2],
    edge_ids: Vec<usize>,
    collapsed_vertex_ids: Vec<usize>,
}

fn selected_spans_from_selection(
    arrangement: &CandidateArrangement,
    scores: &[SelectionEdgeScore],
    selected_edges: &BTreeSet<usize>,
    structural_edits: &[SelectionStructuralEdit],
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
) -> Vec<SelectionSpan> {
    let incident = selected_incident_edges(arrangement, selected_edges);
    let mut consumed_shared_edges = BTreeSet::<usize>::new();
    let mut spans = Vec::<SelectionSpan>::new();

    for edit in structural_edits
        .iter()
        .filter(|edit| edit.kind == SelectionStructuralEditKind::SharedCarrierReplacement)
    {
        for carrier_id in &edit.carrier_ids {
            let selected_carrier_edges = edit
                .added_edge_ids
                .iter()
                .copied()
                .filter(|edge_id| selected_edges.contains(edge_id))
                .filter(|edge_id| {
                    arrangement
                        .atomic_edges
                        .get(*edge_id)
                        .is_some_and(|edge| edge.carrier_id == *carrier_id)
                })
                .collect::<Vec<_>>();
            if selected_carrier_edges.is_empty() {
                continue;
            }
            for path in shared_carrier_span_paths(
                arrangement,
                vertices,
                carriers,
                &incident,
                *carrier_id,
                &selected_carrier_edges,
            ) {
                consumed_shared_edges.extend(path.edge_ids.iter().copied());
                if let Some(span) = selection_span_from_path(
                    arrangement,
                    scores,
                    carriers,
                    SelectionSpanKind::SharedCarrierSpan,
                    *carrier_id,
                    path,
                    edit.removed_edge_ids.clone(),
                    vec![
                        "selected shared carrier span".to_owned(),
                        format!(
                            "replaces {} local atomic fragment(s)",
                            edit.removed_edge_ids.len()
                        ),
                    ],
                ) {
                    spans.push(span);
                }
            }
        }
    }

    for edge_id in selected_edges {
        if consumed_shared_edges.contains(edge_id) {
            continue;
        }
        let Some(edge) = arrangement.atomic_edges.get(*edge_id) else {
            continue;
        };
        let path = SpanPath {
            vertices: edge.vertices,
            edge_ids: vec![edge.id],
            collapsed_vertex_ids: Vec::new(),
        };
        if let Some(span) = selection_span_from_path(
            arrangement,
            scores,
            carriers,
            SelectionSpanKind::AtomicInterval,
            edge.carrier_id,
            path,
            Vec::new(),
            vec![
                "selected atomic interval".to_owned(),
                "no selected shared-carrier span covers this evidence interval".to_owned(),
            ],
        ) {
            spans.push(span);
        }
    }

    spans.sort_by(|left, right| {
        left.vertices
            .cmp(&right.vertices)
            .then_with(|| left.carrier_id.cmp(&right.carrier_id))
            .then_with(|| left.t_interval[0].total_cmp(&right.t_interval[0]))
            .then_with(|| left.t_interval[1].total_cmp(&right.t_interval[1]))
            .then_with(|| left.kind.cmp(&right.kind))
    });
    for (id, span) in spans.iter_mut().enumerate() {
        span.id = id;
    }
    spans
}

fn shared_carrier_span_paths(
    arrangement: &CandidateArrangement,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    incident: &BTreeMap<usize, Vec<usize>>,
    carrier_id: usize,
    edge_ids: &[usize],
) -> Vec<SpanPath> {
    let edge_set = edge_ids.iter().copied().collect::<BTreeSet<_>>();
    let mut adjacency = BTreeMap::<usize, Vec<(usize, usize)>>::new();
    for edge_id in &edge_set {
        let Some(edge) = arrangement.atomic_edges.get(*edge_id) else {
            continue;
        };
        adjacency
            .entry(edge.vertices[0])
            .or_default()
            .push((edge.vertices[1], edge.id));
        adjacency
            .entry(edge.vertices[1])
            .or_default()
            .push((edge.vertices[0], edge.id));
    }
    for neighbors in adjacency.values_mut() {
        neighbors.sort_by_key(|(vertex_id, edge_id)| (*vertex_id, *edge_id));
    }

    let keep_vertices = adjacency
        .keys()
        .copied()
        .filter(|vertex_id| {
            !is_selection_span_pass_through_vertex(
                *vertex_id,
                carrier_id,
                incident,
                arrangement,
                vertices,
            )
        })
        .collect::<BTreeSet<_>>();
    let mut visited_edges = BTreeSet::<usize>::new();
    let mut paths = Vec::<SpanPath>::new();

    for start_id in &keep_vertices {
        let Some(neighbors) = adjacency.get(start_id) else {
            continue;
        };
        for (next_id, edge_id) in neighbors {
            if visited_edges.contains(edge_id) {
                continue;
            }
            let mut path_edge_ids = vec![*edge_id];
            let mut collapsed_vertex_ids = Vec::new();
            visited_edges.insert(*edge_id);
            let mut previous_id = *start_id;
            let mut current_id = *next_id;

            while is_selection_span_pass_through_vertex(
                current_id,
                carrier_id,
                incident,
                arrangement,
                vertices,
            ) {
                collapsed_vertex_ids.push(current_id);
                let Some((following_vertex_id, following_edge_id)) = adjacency
                    .get(&current_id)
                    .and_then(|neighbors| {
                        neighbors
                            .iter()
                            .find(|(candidate_vertex_id, candidate_edge_id)| {
                                *candidate_vertex_id != previous_id
                                    && !visited_edges.contains(candidate_edge_id)
                            })
                    })
                    .copied()
                else {
                    break;
                };
                previous_id = current_id;
                current_id = following_vertex_id;
                visited_edges.insert(following_edge_id);
                path_edge_ids.push(following_edge_id);
            }

            paths.push(SpanPath {
                vertices: [*start_id, current_id],
                edge_ids: path_edge_ids,
                collapsed_vertex_ids,
            });
        }
    }

    for edge_id in edge_set {
        if visited_edges.contains(&edge_id) {
            continue;
        }
        let Some(edge) = arrangement.atomic_edges.get(edge_id) else {
            continue;
        };
        let mut collapsed_vertex_ids = edge
            .vertices
            .iter()
            .copied()
            .filter(|vertex_id| {
                is_selection_span_pass_through_vertex(
                    *vertex_id,
                    carrier_id,
                    incident,
                    arrangement,
                    vertices,
                )
            })
            .collect::<Vec<_>>();
        collapsed_vertex_ids.sort_unstable();
        paths.push(SpanPath {
            vertices: edge.vertices,
            edge_ids: vec![edge.id],
            collapsed_vertex_ids,
        });
    }

    paths.sort_by(|left, right| {
        path_min_t(vertices, carriers, carrier_id, left)
            .total_cmp(&path_min_t(vertices, carriers, carrier_id, right))
            .then_with(|| left.vertices.cmp(&right.vertices))
    });
    paths
}

fn is_selection_span_pass_through_vertex(
    vertex_id: usize,
    carrier_id: usize,
    incident: &BTreeMap<usize, Vec<usize>>,
    arrangement: &CandidateArrangement,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
) -> bool {
    let Some(vertex) = vertices.get(&vertex_id).copied() else {
        return false;
    };
    if vertex.boundary_side.is_some()
        || matches!(
            vertex.kind,
            ArrangementVertexKind::Corner
                | ArrangementVertexKind::BoundaryContact
                | ArrangementVertexKind::ObservedJunction
                | ArrangementVertexKind::JunctionCluster
        )
    {
        return false;
    }
    let Some(edge_ids) = incident.get(&vertex_id) else {
        return false;
    };
    edge_ids.len() == 2
        && edge_ids.iter().all(|edge_id| {
            arrangement
                .atomic_edges
                .get(*edge_id)
                .is_some_and(|edge| edge.carrier_id == carrier_id)
        })
}

fn selection_span_from_path(
    arrangement: &CandidateArrangement,
    scores: &[SelectionEdgeScore],
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    kind: SelectionSpanKind,
    carrier_id: usize,
    path: SpanPath,
    replaced_atomic_edge_ids: Vec<usize>,
    mut reasons: Vec<String>,
) -> Option<SelectionSpan> {
    if path.vertices[0] == path.vertices[1] || path.edge_ids.is_empty() {
        return None;
    }
    let carrier = carriers.get(&carrier_id).copied()?;
    let mut t_min = f64::INFINITY;
    let mut t_max = f64::NEG_INFINITY;
    let mut support_min = f64::INFINITY;
    let mut support_max = f64::NEG_INFINITY;
    let mut support_sum = 0.0;
    let mut support_count = 0usize;
    let mut score = 0.0;
    let mut edge_ids = path.edge_ids;
    edge_ids.sort_unstable();
    edge_ids.dedup();
    for edge_id in &edge_ids {
        let edge = arrangement.atomic_edges.get(*edge_id)?;
        t_min = t_min.min(edge.t_interval[0]).min(edge.t_interval[1]);
        t_max = t_max.max(edge.t_interval[0]).max(edge.t_interval[1]);
        support_min = support_min.min(edge.line_support);
        support_max = support_max.max(edge.line_support);
        support_sum += edge.line_support;
        support_count += 1;
        if let Some(edge_score) = scores.get(*edge_id) {
            score += edge_score.total_score;
        }
    }
    if !t_min.is_finite() || !t_max.is_finite() || t_min >= t_max {
        return None;
    }
    reasons.push(format!(
        "uses {} selected atomic evidence interval(s)",
        edge_ids.len()
    ));
    if !path.collapsed_vertex_ids.is_empty() {
        reasons.push(format!(
            "collapses {} pass-through vertex/vertices",
            path.collapsed_vertex_ids.len()
        ));
    }
    Some(SelectionSpan {
        id: 0,
        kind,
        carrier_id,
        vertices: path.vertices,
        t_interval: [t_min, t_max],
        assignment: carrier.assignment,
        source_atomic_edge_ids: edge_ids,
        replaced_atomic_edge_ids,
        collapsed_vertex_ids: path.collapsed_vertex_ids,
        line_support_min: if support_count == 0 { 0.0 } else { support_min },
        line_support_mean: if support_count == 0 {
            0.0
        } else {
            support_sum / support_count as f64
        },
        line_support_max: if support_count == 0 { 0.0 } else { support_max },
        score,
        reasons,
    })
}

fn selected_incident_edges(
    arrangement: &CandidateArrangement,
    selected_edges: &BTreeSet<usize>,
) -> BTreeMap<usize, Vec<usize>> {
    let mut incident = BTreeMap::<usize, Vec<usize>>::new();
    for edge in arrangement
        .atomic_edges
        .iter()
        .filter(|edge| selected_edges.contains(&edge.id))
    {
        incident.entry(edge.vertices[0]).or_default().push(edge.id);
        incident.entry(edge.vertices[1]).or_default().push(edge.id);
    }
    for edge_ids in incident.values_mut() {
        edge_ids.sort_unstable();
    }
    incident
}

fn path_min_t(
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    carrier_id: usize,
    path: &SpanPath,
) -> f64 {
    let Some(carrier) = carriers.get(&carrier_id).copied() else {
        return f64::INFINITY;
    };
    path.vertices
        .iter()
        .filter_map(|vertex_id| vertices.get(vertex_id).copied())
        .map(|vertex| vertex.point.x * carrier.direction.x + vertex.point.y * carrier.direction.y)
        .fold(f64::INFINITY, f64::min)
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
        selected_spans: Vec::new(),
        rejected_edge_ids: Vec::new(),
        undecided_edge_ids: Vec::new(),
        selected_hypothesis_ids: Vec::new(),
        edge_scores: Vec::new(),
        structural_edits: Vec::new(),
        report: CandidateSelectionReport {
            selected_edges: selected_edges.len(),
            selected_spans: 0,
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
        assert_eq!(selection.report.selected_spans, 1);
        assert_eq!(selection.selected_edge_ids, vec![0]);
        assert_eq!(
            selection.selected_spans[0].kind,
            SelectionSpanKind::AtomicInterval
        );
        assert_eq!(selection.selected_spans[0].source_atomic_edge_ids, vec![0]);
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
    fn beam_selects_weak_edge_when_it_improves_topology_before_pruning() {
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
        arrangement.vertices[1].kind = ArrangementVertexKind::ObservedLineEndpoint;
        arrangement.vertices[2].kind = ArrangementVertexKind::CarrierIntersection;
        arrangement.carriers[3].kind = ArrangementCarrierKind::SharedCollinearAlternative;
        arrangement.carriers[3].primitive_ids = vec![0, 1, 2];
        arrangement.carriers[3].hypothesis_cost = 0.08;
        arrangement.carriers[3].source = EvidenceSource::Inferred;
        for (offset, edge) in arrangement.atomic_edges[3..=5].iter_mut().enumerate() {
            edge.source = EvidenceSource::Inferred;
            edge.t_interval = [0.2 + offset as f64 * 0.2, 0.2 + (offset + 1) as f64 * 0.2];
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
        assert_eq!(selection.report.selected_spans, 1);
        assert!(selection.structural_edits.iter().any(|edit| {
            edit.kind == SelectionStructuralEditKind::SharedCarrierReplacement
                && edit.removed_edge_ids == vec![0, 1, 2]
        }));
    }

    #[test]
    fn beam_prefers_shared_span_over_high_scoring_local_fragment_chain() {
        let mut arrangement = shared_carrier_replacement_fixture();
        arrangement.vertices[1].kind = ArrangementVertexKind::ObservedLineEndpoint;
        arrangement.vertices[2].kind = ArrangementVertexKind::CarrierIntersection;
        for edge in &mut arrangement.atomic_edges[0..=2] {
            edge.line_support = 0.94;
            edge.support_overlap = 0.94;
            edge.source = EvidenceSource::ObservedStrong;
        }
        for edge in &mut arrangement.atomic_edges[3..=5] {
            edge.line_support = 0.42;
            edge.support_overlap = 0.42;
            edge.source = EvidenceSource::Inferred;
        }

        let mut options = beam_options();
        options.max_beam_candidates = 32;
        let selection =
            select_candidate_graph_beam(&arrangement, options, ExactProbeOptions::default());

        assert_eq!(selection.selected_edge_ids, vec![3, 4, 5]);
        assert!(!selection.selected_edge_ids.contains(&0));
        assert!(!selection.selected_edge_ids.contains(&1));
        assert!(!selection.selected_edge_ids.contains(&2));
        assert_eq!(selection.report.shared_replacements, 1);
        assert_eq!(selection.report.local_fragments_replaced, 3);
        assert_eq!(selection.report.local_fragments_retained, 0);
        assert_eq!(selection.report.selected_spans, 1);
        let span = &selection.selected_spans[0];
        assert_eq!(span.kind, SelectionSpanKind::SharedCarrierSpan);
        assert_eq!(span.vertices, [0, 3]);
        assert_eq!(span.source_atomic_edge_ids, vec![3, 4, 5]);
        assert_eq!(span.replaced_atomic_edge_ids, vec![0, 1, 2]);
    }

    #[test]
    fn beam_prefers_observed_carrier_span_over_tiny_pass_through_fragments() {
        let mut arrangement = observed_carrier_chain_fixture();
        arrangement.vertices[1].kind = ArrangementVertexKind::ObservedLineEndpoint;
        arrangement.vertices[2].kind = ArrangementVertexKind::CarrierIntersection;

        let mut options = beam_options();
        options.max_beam_candidates = 32;
        let selection =
            select_candidate_graph_beam(&arrangement, options, ExactProbeOptions::default());

        assert_eq!(selection.selected_edge_ids, vec![0, 1, 2]);
        assert_eq!(selection.report.selected_spans, 1);
        let span = &selection.selected_spans[0];
        assert_eq!(span.kind, SelectionSpanKind::ObservedCarrierSpan);
        assert_eq!(span.vertices, [0, 3]);
        assert_eq!(span.source_atomic_edge_ids, vec![0, 1, 2]);
        assert_eq!(span.collapsed_vertex_ids, vec![1, 2]);
    }

    #[test]
    fn observed_carrier_span_preserves_real_junction_as_endpoint() {
        let mut arrangement = observed_carrier_chain_fixture();
        arrangement.vertices[1].kind = ArrangementVertexKind::ObservedLineEndpoint;
        arrangement.vertices[2].kind = ArrangementVertexKind::ObservedJunction;

        let mut options = beam_options();
        options.max_beam_candidates = 32;
        let selection =
            select_candidate_graph_beam(&arrangement, options, ExactProbeOptions::default());

        assert_eq!(selection.selected_edge_ids, vec![0, 1, 2]);
        assert_eq!(selection.report.selected_spans, 2);
        assert!(selection.selected_spans.iter().any(|span| span.kind
            == SelectionSpanKind::ObservedCarrierSpan
            && span.vertices == [0, 2]
            && span.source_atomic_edge_ids == vec![0, 1]
            && span.collapsed_vertex_ids == vec![1]));
        assert!(
            selection
                .selected_spans
                .iter()
                .any(|span| span.kind == SelectionSpanKind::AtomicInterval
                    && span.vertices == [2, 3]
                    && span.source_atomic_edge_ids == vec![2])
        );
    }

    #[test]
    fn shared_carrier_replacement_emits_final_span_with_atomic_provenance() {
        let mut arrangement = shared_carrier_replacement_fixture();
        arrangement.vertices[1].kind = ArrangementVertexKind::ObservedLineEndpoint;
        arrangement.vertices[2].kind = ArrangementVertexKind::CarrierIntersection;

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert_eq!(selection.selected_edge_ids, vec![3, 4, 5]);
        assert_eq!(selection.report.shared_replacements, 1);
        assert_eq!(selection.report.selected_spans, 1);
        let span = &selection.selected_spans[0];
        assert_eq!(span.kind, SelectionSpanKind::SharedCarrierSpan);
        assert_eq!(span.vertices, [0, 3]);
        assert_eq!(span.source_atomic_edge_ids, vec![3, 4, 5]);
        assert_eq!(span.replaced_atomic_edge_ids, vec![0, 1, 2]);
        assert_eq!(span.collapsed_vertex_ids, vec![1, 2]);
    }

    #[test]
    fn shared_carrier_span_preserves_real_observed_junction_as_split_point() {
        let mut arrangement = shared_carrier_replacement_fixture();
        arrangement.vertices[1].kind = ArrangementVertexKind::ObservedLineEndpoint;
        arrangement.vertices[2].kind = ArrangementVertexKind::ObservedJunction;

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert_eq!(selection.report.shared_replacements, 1);
        let shared_spans = selection
            .selected_spans
            .iter()
            .filter(|span| span.kind == SelectionSpanKind::SharedCarrierSpan)
            .collect::<Vec<_>>();
        assert_eq!(shared_spans.len(), 2);
        assert_eq!(shared_spans[0].vertices, [0, 2]);
        assert_eq!(shared_spans[0].source_atomic_edge_ids, vec![3, 4]);
        assert_eq!(shared_spans[0].collapsed_vertex_ids, vec![1]);
        assert_eq!(shared_spans[1].vertices, [2, 3]);
        assert_eq!(shared_spans[1].source_atomic_edge_ids, vec![5]);
        assert!(shared_spans[1].collapsed_vertex_ids.is_empty());
    }

    #[test]
    fn local_fragments_remain_atomic_spans_without_shared_replacement() {
        let arrangement =
            fixture_arrangement(vec![edge(0, 0, [0, 1], 0.86), edge(1, 1, [1, 2], 0.84)]);

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert_eq!(selection.report.shared_replacements, 0);
        assert_eq!(selection.selected_edge_ids, vec![0, 1]);
        assert_eq!(selection.report.selected_spans, 2);
        assert!(
            selection
                .selected_spans
                .iter()
                .all(|span| span.kind == SelectionSpanKind::AtomicInterval)
        );
        assert_eq!(selection.selected_spans[0].source_atomic_edge_ids, vec![0]);
        assert_eq!(selection.selected_spans[1].source_atomic_edge_ids, vec![1]);
    }

    #[test]
    fn beam_reports_collinear_degree_two_vertices_as_collapsible() {
        let arrangement =
            fixture_arrangement(vec![edge(0, 0, [0, 1], 0.86), edge(1, 1, [1, 2], 0.84)]);

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
        let mut arrangement =
            fixture_arrangement(vec![edge(0, 0, [0, 1], 0.86), edge(1, 1, [1, 2], 0.84)]);
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

    fn shared_carrier_replacement_fixture() -> CandidateArrangement {
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
        for (offset, edge) in arrangement.atomic_edges[3..=5].iter_mut().enumerate() {
            edge.source = EvidenceSource::Inferred;
            edge.t_interval = [0.2 + offset as f64 * 0.2, 0.2 + (offset + 1) as f64 * 0.2];
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
        arrangement
    }

    fn observed_carrier_chain_fixture() -> CandidateArrangement {
        let mut arrangement = fixture_arrangement(vec![
            edge(0, 0, [0, 1], 0.94),
            edge(1, 0, [1, 2], 0.93),
            edge(2, 0, [2, 3], 0.92),
        ]);
        for (offset, edge) in arrangement.atomic_edges.iter_mut().enumerate() {
            edge.t_interval = [0.2 + offset as f64 * 0.2, 0.2 + (offset + 1) as f64 * 0.2];
        }
        arrangement
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
