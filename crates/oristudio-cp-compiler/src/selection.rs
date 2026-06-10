//! Weighted candidate selection for the compiler V2 architecture.
//!
//! This stage chooses a first selected graph from the V2 arrangement without
//! mutating geometry. `select_candidate_graph` is the Phase 3 greedy scaffold;
//! `select_candidate_graph_beam` is the Phase 5 exactizability-aware selector.

use crate::arrangement_v2::{
    ArrangementAtomicEdge, ArrangementCarrier, ArrangementCarrierKind, ArrangementHypothesisKind,
    ArrangementVertex, ArrangementVertexKind, CandidateArrangement,
};
use crate::candidate_graph::{
    ArrangementCandidateAdapter, AssignmentEvidence, AssignmentEvidenceSource, CandidateConflict,
    CandidateConflictKind, CandidateCreaseBoundaryRole, CandidateCreaseSourceKind,
    CandidateCreaseSpan, CandidateCreaseSpanKind, CandidateGraph, CandidateGraphReport,
    CandidateSelectionPolicy, CandidateVertexKind, SelectedGraph,
};
use crate::exact_probe::{ExactProbeOptions, probe_exactizability};
use crate::{AssignmentLabel, EvidenceSource, Point2};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const SCHEMA: &str = "oristudio/cp-compiler/candidate-selection-v2";
const LOCAL_FRAGMENT_SELECTION_COST_MULTIPLIER: f64 = 6.0;
const SPAN_COMPLEXITY_COST: f64 = 0.08;
const IR_RESCUE_MIN_IMPROVEMENT: f64 = 0.02;

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
    /// Post-selection local search that flips single candidates incident to
    /// odd-degree interior vertices when the flip reduces the odd count.
    #[serde(default)]
    pub parity_repair: bool,
    #[serde(default = "default_parity_repair_budget")]
    pub parity_repair_budget: usize,
    /// Maximum total-score regression a parity-fixing flip may cost.
    #[serde(default = "default_parity_repair_max_cost")]
    pub parity_repair_max_cost: f64,
}

const fn default_parity_repair_budget() -> usize {
    24
}

const fn default_parity_repair_max_cost() -> f64 {
    0.35
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
            parity_repair: false,
            parity_repair_budget: default_parity_repair_budget(),
            parity_repair_max_cost: default_parity_repair_max_cost(),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint_points: Option<[Point2; 2]>,
    pub t_interval: [f64; 2],
    pub assignment: crate::AssignmentCandidate,
    #[serde(default)]
    pub boundary_role: CandidateCreaseBoundaryRole,
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
    NormalizedPassThroughSpan,
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

pub fn select_candidate_graph_from_ir(
    graph: &CandidateGraph,
    options: SelectionOptions,
) -> CandidateSelection {
    select_candidate_graph_beam_from_ir(graph, options, ExactProbeOptions::default())
}

pub fn candidate_graph_from_arrangement_for_selection(
    arrangement: &CandidateArrangement,
    options: SelectionOptions,
) -> CandidateGraph {
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
    let scores = arrangement
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
    let mut graph = ArrangementCandidateAdapter::from_arrangement(arrangement);
    graph.crease_candidates = span_candidates
        .iter()
        .map(|candidate| {
            candidate_graph_span_from_selection_candidate(candidate, &carriers, &options)
        })
        .collect();
    graph.conflicts = candidate_graph_conflicts_from_span_candidates(&span_candidates);
    graph.alternatives = graph.conflicts.clone();
    graph.boundary.generated_border_span_ids = graph
        .crease_candidates
        .iter()
        .filter(|span| span.source_kind == CandidateCreaseSourceKind::BorderGenerated)
        .map(|span| span.id)
        .collect();
    graph.report = candidate_graph_report_from_selection_graph(&graph);
    graph
}

pub fn select_candidate_graph_beam_from_ir(
    graph: &CandidateGraph,
    options: SelectionOptions,
    _exact_options: ExactProbeOptions,
) -> CandidateSelection {
    let conflict_map = candidate_conflict_map(graph);
    let locked_ids = graph
        .crease_candidates
        .iter()
        .filter(|span| span.selection_policy == CandidateSelectionPolicy::Locked)
        .map(|span| span.id)
        .collect::<BTreeSet<_>>();
    let seed_ids = graph
        .crease_candidates
        .iter()
        .filter(|span| {
            span.selection_policy == CandidateSelectionPolicy::Locked
                || (span.selection_policy == CandidateSelectionPolicy::StrongOptional
                    && span.selection_score(graph) >= options.min_selected_score)
        })
        .map(|span| span.id)
        .collect::<BTreeSet<_>>();
    let seed_state = score_ir_beam_state(graph, &seed_ids, &options);
    let mut candidate_ids = graph
        .crease_candidates
        .iter()
        .filter(|span| span.selection_policy != CandidateSelectionPolicy::Locked)
        .map(|span| span.id)
        .collect::<Vec<_>>();
    candidate_ids.sort_by(|left, right| {
        ir_candidate_priority(
            graph,
            &seed_state,
            *right,
            &conflict_map,
            &locked_ids,
            &options,
        )
        .total_cmp(&ir_candidate_priority(
            graph,
            &seed_state,
            *left,
            &conflict_map,
            &locked_ids,
            &options,
        ))
        .then_with(|| left.cmp(right))
    });
    candidate_ids.truncate(options.max_beam_candidates);

    let mut beam = vec![seed_state];
    for candidate_id in candidate_ids {
        let mut next = Vec::with_capacity(beam.len() * 2);
        for state in &beam {
            next.push(state.clone());
            if state.selected_span_ids.contains(&candidate_id) {
                continue;
            }
            if let Some(selected) = ir_selected_with_candidate(
                graph,
                &state.selected_span_ids,
                candidate_id,
                &conflict_map,
                &locked_ids,
            ) {
                next.push(score_ir_beam_state(graph, &selected, &options));
            }
        }
        next.sort_by(ir_beam_state_order);
        next.dedup_by(|left, right| left.selected_span_ids == right.selected_span_ids);
        next.truncate(options.beam_width.max(1));
        beam = next;
    }

    beam.sort_by(ir_beam_state_order);
    let best = beam
        .into_iter()
        .next()
        .unwrap_or_else(|| score_ir_beam_state(graph, &seed_ids, &options));
    let best = rescue_ir_weak_candidates(graph, best, &conflict_map, &locked_ids, &options);
    let best = parity_repair_ir_state(graph, best, &conflict_map, &locked_ids, &options);
    candidate_selection_from_ir_state(graph, &best, &options)
}

/// Local search that converts odd-degree interior vertices into parity-correct
/// ones via single candidate flips (add an unselected span or drop a selected
/// one incident to an odd vertex). The beam can miss these flips because it
/// only explores the top-priority candidate prefix; here the search is exact
/// but restricted to spans touching an odd vertex. A flip is accepted only if
/// it strictly reduces the odd count and costs at most
/// `parity_repair_max_cost` total score.
fn parity_repair_ir_state(
    graph: &CandidateGraph,
    mut best: IrBeamState,
    conflict_map: &BTreeMap<usize, BTreeSet<usize>>,
    locked_ids: &BTreeSet<usize>,
    options: &SelectionOptions,
) -> IrBeamState {
    if !options.parity_repair {
        return best;
    }
    for _ in 0..options.parity_repair_budget {
        if best.residuals.odd_degree_vertices == 0 {
            break;
        }
        let odd_vertices = ir_odd_interior_vertices(graph, &best.selected_span_ids);
        if odd_vertices.is_empty() {
            break;
        }
        let mut next_best: Option<IrBeamState> = None;
        for span in &graph.crease_candidates {
            if span.selection_policy == CandidateSelectionPolicy::Locked
                || span.selection_policy == CandidateSelectionPolicy::Discouraged
                || !span_counts_for_local_theorems(span)
            {
                continue;
            }
            if !odd_vertices.contains(&span.vertices[0])
                && !odd_vertices.contains(&span.vertices[1])
            {
                continue;
            }
            let trial_ids = if best.selected_span_ids.contains(&span.id) {
                let mut without = best.selected_span_ids.clone();
                without.remove(&span.id);
                without
            } else {
                let Some(with) = ir_selected_with_candidate(
                    graph,
                    &best.selected_span_ids,
                    span.id,
                    conflict_map,
                    locked_ids,
                ) else {
                    continue;
                };
                with
            };
            let trial = score_ir_beam_state(graph, &trial_ids, options);
            if trial.residuals.odd_degree_vertices >= best.residuals.odd_degree_vertices {
                continue;
            }
            if trial.total_score < best.total_score - options.parity_repair_max_cost {
                continue;
            }
            let better = next_best.as_ref().is_none_or(|current| {
                trial.residuals.odd_degree_vertices < current.residuals.odd_degree_vertices
                    || (trial.residuals.odd_degree_vertices
                        == current.residuals.odd_degree_vertices
                        && trial.total_score > current.total_score)
            });
            if better {
                next_best = Some(trial);
            }
        }
        let Some(improved) = next_best else {
            break;
        };
        best = improved;
    }
    best
}

fn ir_odd_interior_vertices(
    graph: &CandidateGraph,
    selected_span_ids: &BTreeSet<usize>,
) -> BTreeSet<usize> {
    let mut degrees = BTreeMap::<usize, usize>::new();
    for span_id in selected_span_ids {
        let Some(span) = graph.crease_candidates.get(*span_id) else {
            continue;
        };
        if !span_counts_for_local_theorems(span) {
            continue;
        }
        for vertex_id in span.vertices {
            *degrees.entry(vertex_id).or_default() += 1;
        }
    }
    degrees
        .into_iter()
        .filter(|(vertex_id, degree)| {
            degree % 2 == 1
                && graph
                    .vertices
                    .get(*vertex_id)
                    .is_some_and(ir_vertex_is_interior_fold_vertex)
        })
        .map(|(vertex_id, _)| vertex_id)
        .collect()
}

fn candidate_graph_span_from_selection_candidate(
    candidate: &SpanCandidate,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    options: &SelectionOptions,
) -> CandidateCreaseSpan {
    let span = &candidate.span;
    let carrier = carriers.get(&span.carrier_id).copied();
    let source_kind = if span.assignment.label == AssignmentLabel::Boundary {
        CandidateCreaseSourceKind::BorderGenerated
    } else if span.kind == SelectionSpanKind::SharedCarrierSpan {
        CandidateCreaseSourceKind::ArrangementShared
    } else {
        CandidateCreaseSourceKind::ArrangementObserved
    };
    CandidateCreaseSpan {
        id: candidate.id,
        kind: match span.kind {
            SelectionSpanKind::AtomicInterval => CandidateCreaseSpanKind::AtomicInterval,
            SelectionSpanKind::ObservedCarrierSpan => CandidateCreaseSpanKind::ObservedCarrierSpan,
            SelectionSpanKind::NormalizedPassThroughSpan => {
                CandidateCreaseSpanKind::NormalizedPassThroughSpan
            }
            SelectionSpanKind::SharedCarrierSpan => CandidateCreaseSpanKind::SharedCarrierSpan,
        },
        vertices: span.vertices,
        carrier: crate::candidate_graph::CandidateCarrierGeometry {
            normal: carrier
                .map(|carrier| carrier.normal)
                .unwrap_or(Point2::new(0.0, 1.0)),
            direction: carrier
                .map(|carrier| carrier.direction)
                .unwrap_or(Point2::new(1.0, 0.0)),
            rho: carrier.map(|carrier| carrier.rho).unwrap_or(0.0),
        },
        t_interval: span.t_interval,
        assignment_evidence: AssignmentEvidence::from_candidate(
            span.assignment,
            AssignmentEvidenceSource::ModelAssignmentHead,
        ),
        presence_probability: span.line_support_mean.clamp(0.01, 0.99),
        line_support_min: span.line_support_min,
        line_support_mean: span.line_support_mean,
        line_support_max: span.line_support_max,
        style_support: 0.0,
        non_crease_support: 0.0,
        source_kind,
        selection_policy: if source_kind == CandidateCreaseSourceKind::BorderGenerated {
            CandidateSelectionPolicy::Locked
        } else if span.line_support_mean >= options.strong_edge_support {
            CandidateSelectionPolicy::StrongOptional
        } else {
            CandidateSelectionPolicy::WeakOptional
        },
        boundary_role: if source_kind == CandidateCreaseSourceKind::BorderGenerated {
            CandidateCreaseBoundaryRole::PaperBoundary
        } else {
            CandidateCreaseBoundaryRole::None
        },
        source_edge_ids: span.source_atomic_edge_ids.clone(),
        source_atomic_edge_ids: span.source_atomic_edge_ids.clone(),
        source_carrier_ids: vec![span.carrier_id],
        replaced_span_ids: span.replaced_atomic_edge_ids.clone(),
        replaced_atomic_edge_ids: span.replaced_atomic_edge_ids.clone(),
        collapsed_vertex_ids: span.collapsed_vertex_ids.clone(),
        provenance: Vec::new(),
        reasons: span.reasons.clone(),
    }
}

fn candidate_graph_conflicts_from_span_candidates(
    candidates: &[SpanCandidate],
) -> Vec<CandidateConflict> {
    let mut seen = BTreeSet::<Vec<usize>>::new();
    let mut conflicts = Vec::new();
    for candidate in candidates {
        if candidate.conflicts.is_empty() {
            continue;
        }
        let mut ids = vec![candidate.id];
        ids.extend(candidate.conflicts.iter().copied());
        ids.sort_unstable();
        ids.dedup();
        if ids.len() < 2 || !seen.insert(ids.clone()) {
            continue;
        }
        conflicts.push(CandidateConflict {
            id: conflicts.len(),
            kind: CandidateConflictKind::SpanReplacesFragments,
            candidate_ids: ids,
            hard: true,
            reason: "selection span alternatives cannot both be selected".to_owned(),
        });
    }
    conflicts
}

fn candidate_graph_report_from_selection_graph(graph: &CandidateGraph) -> CandidateGraphReport {
    CandidateGraphReport {
        vertices: graph.vertices.len(),
        crease_candidates: graph.crease_candidates.len(),
        locked_border_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.selection_policy == CandidateSelectionPolicy::Locked)
            .count(),
        legacy_selected_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::LegacySelected)
            .count(),
        legacy_low_threshold_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold)
            .count(),
        arrangement_observed_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::ArrangementObserved)
            .count(),
        arrangement_shared_spans: graph
            .crease_candidates
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::ArrangementShared)
            .count(),
        conflicts: graph.conflicts.len(),
    }
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

#[derive(Debug, Clone)]
struct IrBeamState {
    selected_span_ids: BTreeSet<usize>,
    total_score: f64,
    residuals: IrStateResiduals,
}

#[derive(Debug, Clone, Default)]
struct IrStateResiduals {
    odd_degree_vertices: usize,
    dangling_interior_vertices: usize,
    non_collinear_degree_two_vertices: usize,
    hard_kawasaki_vertices: usize,
    maekawa_impossible_vertices: usize,
    maekawa_ambiguous_vertices: usize,
    topology_penalty: f64,
    local_theorem_penalty: f64,
}

impl IrStateResiduals {
    fn total_penalty(&self) -> f64 {
        self.topology_penalty + self.local_theorem_penalty
    }
}

fn score_ir_beam_state(
    graph: &CandidateGraph,
    selected_span_ids: &BTreeSet<usize>,
    options: &SelectionOptions,
) -> IrBeamState {
    let base_score = selected_span_ids
        .iter()
        .filter_map(|span_id| graph.crease_candidates.get(*span_id))
        .map(|span| span.selection_score(graph))
        .sum::<f64>();
    let residuals = ir_state_residuals(graph, selected_span_ids, options);
    IrBeamState {
        selected_span_ids: selected_span_ids.clone(),
        total_score: base_score - residuals.total_penalty(),
        residuals,
    }
}

fn ir_beam_state_order(left: &IrBeamState, right: &IrBeamState) -> std::cmp::Ordering {
    right
        .total_score
        .total_cmp(&left.total_score)
        .then_with(|| {
            left.residuals
                .odd_degree_vertices
                .cmp(&right.residuals.odd_degree_vertices)
        })
        .then_with(|| {
            left.residuals
                .dangling_interior_vertices
                .cmp(&right.residuals.dangling_interior_vertices)
        })
        .then_with(|| {
            left.selected_span_ids
                .len()
                .cmp(&right.selected_span_ids.len())
        })
}

#[derive(Debug, Clone, Copy, Default)]
struct IrCandidateDelta {
    topology_delta: f64,
    local_theorem_delta: f64,
    degree_two_delta: isize,
}

impl IrCandidateDelta {
    fn combined_score_delta(self) -> f64 {
        self.topology_delta + self.local_theorem_delta
    }
}

fn ir_candidate_priority(
    graph: &CandidateGraph,
    state: &IrBeamState,
    candidate_id: usize,
    conflict_map: &BTreeMap<usize, BTreeSet<usize>>,
    locked_ids: &BTreeSet<usize>,
    options: &SelectionOptions,
) -> f64 {
    let Some(span) = graph.crease_candidates.get(candidate_id) else {
        return f64::NEG_INFINITY;
    };
    let delta = ir_candidate_delta(
        graph,
        state,
        candidate_id,
        conflict_map,
        locked_ids,
        options,
    )
    .unwrap_or_default();
    span.selection_score(graph) + delta.combined_score_delta()
}

fn rescue_ir_weak_candidates(
    graph: &CandidateGraph,
    mut best: IrBeamState,
    conflict_map: &BTreeMap<usize, BTreeSet<usize>>,
    locked_ids: &BTreeSet<usize>,
    options: &SelectionOptions,
) -> IrBeamState {
    for _ in 0..graph.crease_candidates.len().min(16) {
        let mut next_best: Option<IrBeamState> = None;
        for span in &graph.crease_candidates {
            if span.source_kind != CandidateCreaseSourceKind::LegacyLowThreshold
                || span.selection_policy == CandidateSelectionPolicy::Discouraged
                || best.selected_span_ids.contains(&span.id)
            {
                continue;
            }
            let Some(selected) = ir_selected_with_candidate(
                graph,
                &best.selected_span_ids,
                span.id,
                conflict_map,
                locked_ids,
            ) else {
                continue;
            };
            let trial = score_ir_beam_state(graph, &selected, options);
            if trial.total_score >= best.total_score + IR_RESCUE_MIN_IMPROVEMENT
                && next_best
                    .as_ref()
                    .is_none_or(|candidate| trial.total_score > candidate.total_score)
            {
                next_best = Some(trial);
            }
        }
        let Some(improved) = next_best else {
            break;
        };
        best = improved;
    }
    best
}

fn ir_selected_with_candidate(
    graph: &CandidateGraph,
    selected_span_ids: &BTreeSet<usize>,
    candidate_id: usize,
    conflict_map: &BTreeMap<usize, BTreeSet<usize>>,
    locked_ids: &BTreeSet<usize>,
) -> Option<BTreeSet<usize>> {
    let span = graph.crease_candidates.get(candidate_id)?;
    if span.selection_policy == CandidateSelectionPolicy::Discouraged {
        return None;
    }
    let conflicts = conflict_map.get(&candidate_id).cloned().unwrap_or_default();
    if !locked_ids.is_empty() && !conflicts.is_disjoint(locked_ids) {
        return None;
    }
    let mut selected = selected_span_ids.clone();
    for conflict_id in conflicts {
        selected.remove(&conflict_id);
    }
    selected.insert(candidate_id);
    Some(selected)
}

fn ir_candidate_delta(
    graph: &CandidateGraph,
    state: &IrBeamState,
    candidate_id: usize,
    conflict_map: &BTreeMap<usize, BTreeSet<usize>>,
    locked_ids: &BTreeSet<usize>,
    options: &SelectionOptions,
) -> Option<IrCandidateDelta> {
    let selected = state.selected_span_ids.contains(&candidate_id);
    let trial_ids = if selected {
        let mut without = state.selected_span_ids.clone();
        without.remove(&candidate_id);
        without
    } else {
        ir_selected_with_candidate(
            graph,
            &state.selected_span_ids,
            candidate_id,
            conflict_map,
            locked_ids,
        )?
    };
    let trial = ir_state_residuals(graph, &trial_ids, options);
    let (before, after) = if selected {
        (&trial, &state.residuals)
    } else {
        (&state.residuals, &trial)
    };
    Some(IrCandidateDelta {
        topology_delta: before.topology_penalty - after.topology_penalty,
        local_theorem_delta: before.local_theorem_penalty - after.local_theorem_penalty,
        degree_two_delta: before.non_collinear_degree_two_vertices as isize
            - after.non_collinear_degree_two_vertices as isize,
    })
}

fn candidate_conflict_map(graph: &CandidateGraph) -> BTreeMap<usize, BTreeSet<usize>> {
    let mut map = BTreeMap::<usize, BTreeSet<usize>>::new();
    for conflict in &graph.conflicts {
        if !conflict.hard {
            continue;
        }
        for id in &conflict.candidate_ids {
            map.entry(*id).or_default().extend(
                conflict
                    .candidate_ids
                    .iter()
                    .copied()
                    .filter(|other| other != id),
            );
        }
    }
    map
}

#[derive(Debug, Clone, Copy)]
struct IrIncidentRay {
    angle_degrees: f64,
    assignment: AssignmentLabel,
}

fn ir_state_residuals(
    graph: &CandidateGraph,
    selected_span_ids: &BTreeSet<usize>,
    options: &SelectionOptions,
) -> IrStateResiduals {
    let mut incident = BTreeMap::<usize, Vec<IrIncidentRay>>::new();
    for span_id in selected_span_ids {
        let Some(span) = graph.crease_candidates.get(*span_id) else {
            continue;
        };
        if !span_counts_for_local_theorems(span) {
            continue;
        }
        let [a, b] = span.vertices;
        let Some(vertex_a) = graph.vertices.get(a) else {
            continue;
        };
        let Some(vertex_b) = graph.vertices.get(b) else {
            continue;
        };
        incident.entry(a).or_default().push(IrIncidentRay {
            angle_degrees: angle_degrees(vertex_a.point, vertex_b.point),
            assignment: span.assignment_label(),
        });
        incident.entry(b).or_default().push(IrIncidentRay {
            angle_degrees: angle_degrees(vertex_b.point, vertex_a.point),
            assignment: span.assignment_label(),
        });
    }

    let mut residuals = IrStateResiduals::default();
    for (vertex_id, mut rays) in incident {
        let Some(vertex) = graph.vertices.get(vertex_id) else {
            continue;
        };
        if !ir_vertex_is_interior_fold_vertex(vertex) {
            continue;
        }
        rays.sort_by(|left, right| left.angle_degrees.total_cmp(&right.angle_degrees));
        let degree = rays.len();
        if degree == 0 {
            continue;
        }
        if degree % 2 == 1 {
            residuals.odd_degree_vertices += 1;
            residuals.topology_penalty += options.odd_degree_bonus;
        }
        if degree == 1 {
            residuals.dangling_interior_vertices += 1;
            residuals.topology_penalty += options.odd_degree_bonus * 1.25;
        } else if degree == 2 && !degree_two_is_collinear(&rays) {
            residuals.non_collinear_degree_two_vertices += 1;
            residuals.topology_penalty += options.non_collinear_degree_two_cost;
        }
        if let Some(kawasaki) = kawasaki_residual_degrees(&rays) {
            let normalized = (kawasaki / 12.0).min(3.0);
            residuals.local_theorem_penalty +=
                normalized * normalized * options.exact_hard_kawasaki_cost;
            if kawasaki > 12.0 {
                residuals.hard_kawasaki_vertices += 1;
            }
        }
        if degree >= 4 {
            let (maekawa_cost, ambiguous) = maekawa_cost(&rays, options);
            residuals.local_theorem_penalty += maekawa_cost;
            if maekawa_cost > 0.0 && !ambiguous {
                residuals.maekawa_impossible_vertices += 1;
            } else if ambiguous {
                residuals.maekawa_ambiguous_vertices += 1;
            }
        }
    }
    residuals
}

fn span_counts_for_local_theorems(span: &CandidateCreaseSpan) -> bool {
    span.boundary_role() == CandidateCreaseBoundaryRole::None
        && !matches!(
            span.assignment_label(),
            AssignmentLabel::Boundary | AssignmentLabel::Flat
        )
}

fn ir_vertex_is_interior_fold_vertex(vertex: &crate::candidate_graph::CandidateVertex) -> bool {
    vertex.boundary_side.is_none()
        && !matches!(
            vertex.kind,
            CandidateVertexKind::Corner | CandidateVertexKind::BoundaryContact
        )
}

fn degree_two_is_collinear(rays: &[IrIncidentRay]) -> bool {
    let diff = angle_delta_degrees(rays[0].angle_degrees, rays[1].angle_degrees);
    (180.0 - diff).abs() <= 3.0
}

fn kawasaki_residual_degrees(rays: &[IrIncidentRay]) -> Option<f64> {
    if rays.len() < 4 || rays.len() % 2 == 1 {
        return None;
    }
    let mut odd = 0.0;
    let mut even = 0.0;
    for index in 0..rays.len() {
        let next = (index + 1) % rays.len();
        let sector = (rays[next].angle_degrees - rays[index].angle_degrees).rem_euclid(360.0);
        if index % 2 == 0 {
            even += sector;
        } else {
            odd += sector;
        }
    }
    Some((even - odd).abs())
}

fn maekawa_cost(rays: &[IrIncidentRay], options: &SelectionOptions) -> (f64, bool) {
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
    if unknown_count > 0 {
        let satisfiable = (0..=unknown_count).any(|unknown_mountains| {
            let mountains = mountain_count + unknown_mountains;
            let valleys = valley_count + unknown_count - unknown_mountains;
            mountains.abs_diff(valleys) == 2
        });
        return if satisfiable {
            (options.odd_degree_bonus * 0.08, true)
        } else {
            (options.odd_degree_bonus, false)
        };
    }
    let residual = mountain_count.abs_diff(valley_count).abs_diff(2);
    (residual as f64 * options.odd_degree_bonus, false)
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

fn angle_delta_degrees(left: f64, right: f64) -> f64 {
    let diff = (left - right).abs().rem_euclid(360.0);
    diff.min(360.0 - diff)
}

fn candidate_selection_from_ir_state(
    graph: &CandidateGraph,
    state: &IrBeamState,
    options: &SelectionOptions,
) -> CandidateSelection {
    let selected_graph = SelectedGraph::from_selected_span_ids(
        graph,
        state.selected_span_ids.iter().copied().collect(),
    );
    let mut selected_edge_ids = state
        .selected_span_ids
        .iter()
        .filter_map(|span_id| graph.crease_candidates.get(*span_id))
        .flat_map(|span| {
            if span.source_atomic_edge_ids.is_empty() {
                vec![span.id]
            } else {
                span.source_atomic_edge_ids.clone()
            }
        })
        .collect::<Vec<_>>();
    selected_edge_ids.sort_unstable();
    selected_edge_ids.dedup();

    let conflict_map = candidate_conflict_map(graph);
    let locked_ids = graph
        .crease_candidates
        .iter()
        .filter(|span| span.selection_policy == CandidateSelectionPolicy::Locked)
        .map(|span| span.id)
        .collect::<BTreeSet<_>>();
    let mut edge_scores = Vec::new();
    let mut rejected_edge_ids = Vec::new();
    let mut undecided_edge_ids = Vec::new();
    for span in &graph.crease_candidates {
        let selected = state.selected_span_ids.contains(&span.id);
        let decision = if selected {
            SelectionDecision::Selected
        } else if span.selection_policy == CandidateSelectionPolicy::Discouraged {
            SelectionDecision::Rejected
        } else {
            SelectionDecision::Undecided
        };
        if decision == SelectionDecision::Rejected {
            rejected_edge_ids.push(span.id);
        } else if decision == SelectionDecision::Undecided {
            undecided_edge_ids.push(span.id);
        }
        let mut reasons = span.reasons.clone();
        if selected {
            reasons.push("selected by source-neutral CandidateGraph beam".to_owned());
        } else if decision == SelectionDecision::Undecided {
            reasons.push("kept as plausible but not selected by CandidateGraph beam".to_owned());
        } else {
            reasons.push("rejected by CandidateGraph policy/cost".to_owned());
        }
        let delta = ir_candidate_delta(graph, state, span.id, &conflict_map, &locked_ids, options)
            .unwrap_or_default();
        if delta.topology_delta.abs() > 1e-6 {
            reasons.push(format!("local topology delta {:+.3}", delta.topology_delta));
        }
        if delta.local_theorem_delta.abs() > 1e-6 {
            reasons.push(format!(
                "local theorem delta {:+.3}",
                delta.local_theorem_delta
            ));
        }
        if delta.degree_two_delta != 0 {
            reasons.push(format!(
                "non-collinear degree-2 vertex delta {:+}",
                delta.degree_two_delta
            ));
        }
        let breakdown = SelectionScoreBreakdown {
            visual_reward: span.line_support_mean,
            vertex_anchor_reward: delta.local_theorem_delta.max(0.0),
            assignment_reward: -span.selection_assignment_cost(graph),
            topology_delta: delta.topology_delta.max(0.0),
            weak_support_cost: graph.cost_model.probability_cost(span.presence_probability),
            inferred_geometry_cost: (-delta.topology_delta).max(0.0),
            shared_carrier_cost: span.selection_source_cost(graph),
            tiny_edge_cost: 0.0,
            duplicate_cost: 0.0,
            exactizability_cost: (-delta.local_theorem_delta).max(0.0),
            continuity_reward: if matches!(
                span.kind,
                CandidateCreaseSpanKind::ObservedCarrierSpan
                    | CandidateCreaseSpanKind::NormalizedPassThroughSpan
                    | CandidateCreaseSpanKind::SharedCarrierSpan
            ) {
                graph.cost_model.continuity_reward
            } else {
                0.0
            },
            fragmentation_cost: span.collapsed_vertex_ids.len() as f64
                * graph.cost_model.fragmentation_cost_weight,
            degree_two_cost: if delta.degree_two_delta < 0 {
                -delta.degree_two_delta as f64 * options.non_collinear_degree_two_cost
            } else {
                0.0
            },
        };
        edge_scores.push(SelectionEdgeScore {
            edge_id: span.id,
            carrier_id: span.source_carrier_ids.first().copied().unwrap_or(span.id),
            vertices: span.vertices,
            decision,
            total_score: breakdown.total(),
            breakdown,
            reasons,
        });
    }

    let selected_spans = state
        .selected_span_ids
        .iter()
        .filter_map(|span_id| graph.crease_candidates.get(*span_id))
        .map(|span| selection_span_from_ir_span(graph, span))
        .collect::<Vec<_>>();
    let weak_edges_promoted = state
        .selected_span_ids
        .iter()
        .filter_map(|span_id| graph.crease_candidates.get(*span_id))
        .filter(|span| {
            span.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold
                || span.line_support_mean < options.strong_edge_support
        })
        .count();
    let topology_improved_edges = edge_scores
        .iter()
        .filter(|score| {
            score.decision == SelectionDecision::Selected && score.breakdown.topology_delta > 0.0
        })
        .count();
    CandidateSelection {
        schema: "oristudio/cp-compiler/candidate-selection-v2-from-candidate-graph".to_owned(),
        coordinate_space: graph.coordinate_space.clone(),
        image_size: graph.image_size.unwrap_or_default(),
        options: *options,
        selected_edge_ids,
        selected_spans,
        rejected_edge_ids,
        undecided_edge_ids,
        selected_hypothesis_ids: Vec::new(),
        edge_scores,
        structural_edits: selected_graph
            .structural_edit_accounting
            .iter()
            .map(|edit| SelectionStructuralEdit {
                kind: SelectionStructuralEditKind::SharedCarrierReplacement,
                vertex_ids: edit.vertex_ids.clone(),
                carrier_ids: Vec::new(),
                added_edge_ids: edit.span_ids.clone(),
                removed_edge_ids: Vec::new(),
                score_delta: 0.0,
                reason: edit.reason.clone(),
            })
            .collect(),
        report: CandidateSelectionReport {
            selected_edges: state.selected_span_ids.len(),
            selected_spans: state.selected_span_ids.len(),
            rejected_edges: graph
                .crease_candidates
                .iter()
                .filter(|span| span.selection_policy == CandidateSelectionPolicy::Discouraged)
                .count(),
            undecided_edges: graph
                .crease_candidates
                .len()
                .saturating_sub(state.selected_span_ids.len()),
            selected_hypotheses: 0,
            weak_edges_promoted,
            topology_improved_edges,
            duplicate_edges_rejected: graph.conflicts.len(),
            odd_degree_vertices: state.residuals.odd_degree_vertices,
            total_score: state.total_score,
            exactizability_evaluated: false,
            shared_replacements: graph
                .crease_candidates
                .iter()
                .filter(|span| {
                    state.selected_span_ids.contains(&span.id)
                        && span.kind == CandidateCreaseSpanKind::SharedCarrierSpan
                })
                .count(),
            local_fragments_replaced: graph
                .crease_candidates
                .iter()
                .filter(|span| state.selected_span_ids.contains(&span.id))
                .map(|span| span.replaced_span_ids.len() + span.replaced_atomic_edge_ids.len())
                .sum(),
            local_fragments_retained: 0,
            collapsible_degree_two_vertices: 0,
            non_collinear_degree_two_vertices: state.residuals.non_collinear_degree_two_vertices,
            structural_penalty: state.residuals.total_penalty(),
            continuity_reward: graph.cost_model.continuity_reward,
            emits_fold_graph: false,
        },
    }
}

fn selection_span_from_ir_span(
    graph: &CandidateGraph,
    span: &CandidateCreaseSpan,
) -> SelectionSpan {
    SelectionSpan {
        id: span.id,
        kind: match span.kind {
            CandidateCreaseSpanKind::AtomicInterval | CandidateCreaseSpanKind::BorderSpan => {
                SelectionSpanKind::AtomicInterval
            }
            CandidateCreaseSpanKind::ObservedCarrierSpan => SelectionSpanKind::ObservedCarrierSpan,
            CandidateCreaseSpanKind::NormalizedPassThroughSpan => {
                SelectionSpanKind::NormalizedPassThroughSpan
            }
            CandidateCreaseSpanKind::SharedCarrierSpan => SelectionSpanKind::SharedCarrierSpan,
        },
        carrier_id: span.source_carrier_ids.first().copied().unwrap_or(span.id),
        vertices: span.vertices,
        endpoint_points: match (
            graph.vertices.get(span.vertices[0]),
            graph.vertices.get(span.vertices[1]),
        ) {
            (Some(a), Some(b)) => Some([a.point, b.point]),
            _ => None,
        },
        t_interval: span.t_interval,
        assignment: span.assignment_evidence.to_assignment_candidate(),
        boundary_role: span.boundary_role(),
        source_atomic_edge_ids: span.source_atomic_edge_ids.clone(),
        replaced_atomic_edge_ids: span.replaced_atomic_edge_ids.clone(),
        collapsed_vertex_ids: span.collapsed_vertex_ids.clone(),
        line_support_min: span.line_support_min,
        line_support_mean: span.line_support_mean,
        line_support_max: span.line_support_max,
        score: span.selection_score(graph),
        reasons: span.reasons.clone(),
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
    let normalized_paths =
        normalized_pass_through_span_paths(arrangement, scores, vertices, carriers, options);
    let normalized_edge_ids = normalized_paths
        .iter()
        .flat_map(|(_, path)| path.edge_ids.iter().copied())
        .collect::<BTreeSet<_>>();
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
        if normalized_edge_ids.contains(&edge.id) {
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

    for (carrier_id, path) in normalized_paths {
        let Some(mut span) = selection_span_from_path(
            arrangement,
            scores,
            carriers,
            SelectionSpanKind::NormalizedPassThroughSpan,
            carrier_id,
            path,
            Vec::new(),
            vec!["candidate normalized pass-through span".to_owned()],
        ) else {
            continue;
        };
        let Some(carrier) = carriers.get(&carrier_id).copied() else {
            continue;
        };
        span.score =
            normalized_pass_through_span_score(arrangement, &span, vertices, carrier, options);
        span.reasons.push(format!(
            "span-level objective score {:.3}; normalizes {} atomic evidence interval(s) through {} degree-2 pass-through vertex/vertices",
            span.score,
            span.source_atomic_edge_ids.len(),
            span.collapsed_vertex_ids.len()
        ));
        if span.score >= options.weak_candidate_floor {
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

fn normalized_pass_through_span_paths(
    arrangement: &CandidateArrangement,
    scores: &[SelectionEdgeScore],
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    options: &SelectionOptions,
) -> Vec<(usize, SpanPath)> {
    let edge_ids = arrangement
        .atomic_edges
        .iter()
        .filter(|edge| edge.assignment.label != AssignmentLabel::Boundary)
        .filter(|edge| {
            carriers
                .get(&edge.carrier_id)
                .is_some_and(|carrier| carrier.kind == ArrangementCarrierKind::ObservedLocal)
        })
        .filter(|edge| edge.line_support >= options.weak_edge_support)
        .filter(|edge| {
            scores
                .get(edge.id)
                .is_some_and(|score| score.breakdown.total() >= options.weak_candidate_floor)
        })
        .map(|edge| edge.id)
        .collect::<Vec<_>>();
    if edge_ids.len() < 2 {
        return Vec::new();
    }

    let edge_set = edge_ids.iter().copied().collect::<BTreeSet<_>>();
    let incident = selected_incident_edges(arrangement, &edge_set);
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

    let pass_through_vertices = adjacency
        .keys()
        .copied()
        .filter(|vertex_id| {
            is_semantic_pass_through_vertex(*vertex_id, &incident, arrangement, vertices, carriers)
        })
        .collect::<BTreeSet<_>>();
    if pass_through_vertices.is_empty() {
        return Vec::new();
    }

    let keep_vertices = adjacency
        .keys()
        .copied()
        .filter(|vertex_id| !pass_through_vertices.contains(vertex_id))
        .collect::<BTreeSet<_>>();
    let mut visited_edges = BTreeSet::<usize>::new();
    let mut paths = Vec::<(usize, SpanPath)>::new();

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

            while pass_through_vertices.contains(&current_id) {
                collapsed_vertex_ids.push(current_id);
                let Some((following_vertex_id, following_edge_id)) =
                    next_semantic_pass_through_edge(
                        current_id,
                        previous_id,
                        adjacency.get(&current_id),
                        &visited_edges,
                        arrangement,
                        vertices,
                    )
                else {
                    break;
                };
                previous_id = current_id;
                current_id = following_vertex_id;
                visited_edges.insert(following_edge_id);
                path_edge_ids.push(following_edge_id);
            }

            if collapsed_vertex_ids.is_empty() || path_edge_ids.len() < 2 {
                continue;
            }
            let Some(carrier_id) =
                representative_carrier_for_path(arrangement, carriers, &path_edge_ids)
            else {
                continue;
            };
            let Some(path) = normalized_span_path(
                arrangement,
                vertices,
                carriers,
                carrier_id,
                [*start_id, current_id],
                path_edge_ids,
                collapsed_vertex_ids,
            ) else {
                continue;
            };
            paths.push((carrier_id, path));
        }
    }

    for edge_id in edge_set {
        if visited_edges.contains(&edge_id) {
            continue;
        }
        let Some(edge) = arrangement.atomic_edges.get(edge_id) else {
            continue;
        };
        if !edge
            .vertices
            .iter()
            .any(|vertex_id| pass_through_vertices.contains(vertex_id))
        {
            continue;
        }
        visited_edges.insert(edge_id);
    }

    paths.sort_by(|left, right| {
        path_min_t(vertices, carriers, left.0, &left.1)
            .total_cmp(&path_min_t(vertices, carriers, right.0, &right.1))
            .then_with(|| left.1.vertices.cmp(&right.1.vertices))
            .then_with(|| left.0.cmp(&right.0))
    });
    paths
}

fn is_semantic_pass_through_vertex(
    vertex_id: usize,
    incident: &BTreeMap<usize, Vec<usize>>,
    arrangement: &CandidateArrangement,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
) -> bool {
    let Some(vertex) = vertices.get(&vertex_id).copied() else {
        return false;
    };
    if vertex.boundary_side.is_some()
        || matches!(
            vertex.kind,
            ArrangementVertexKind::Corner | ArrangementVertexKind::BoundaryContact
        )
    {
        return false;
    }
    let Some(edge_ids) = incident.get(&vertex_id) else {
        return false;
    };
    if edge_ids.len() != 2 {
        return false;
    }
    incident_edges_are_pass_through_collinear(arrangement, vertices, carriers, vertex_id, edge_ids)
}

fn assignments_compatible(left: AssignmentLabel, right: AssignmentLabel) -> bool {
    left == right || left == AssignmentLabel::Unknown || right == AssignmentLabel::Unknown
}

fn incident_edges_are_pass_through_collinear(
    arrangement: &CandidateArrangement,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    vertex_id: usize,
    edge_ids: &[usize],
) -> bool {
    if edge_ids.len() < 2 {
        return false;
    }
    let Some(first_edge) = arrangement.atomic_edges.get(edge_ids[0]) else {
        return false;
    };
    let Some(center) = vertices.get(&vertex_id).copied() else {
        return false;
    };
    let Some(first_other) =
        other_edge_vertex(first_edge, vertex_id).and_then(|id| vertices.get(&id))
    else {
        return false;
    };
    let Some(reference) = normalized_vector(center.point, first_other.point) else {
        return false;
    };
    let angle_tol = arrangement
        .options
        .collinear_angle_degrees
        .max(6.0)
        .to_radians();
    let cos_tol = angle_tol.cos();
    let mut has_forward = false;
    let mut has_backward = false;

    for edge_id in edge_ids {
        let Some(edge) = arrangement.atomic_edges.get(*edge_id) else {
            return false;
        };
        if !assignments_compatible(first_edge.assignment.label, edge.assignment.label) {
            return false;
        }
        if !edges_are_carrier_collinear(arrangement, carriers, first_edge, edge) {
            return false;
        }
        let Some(other) = other_edge_vertex(edge, vertex_id).and_then(|id| vertices.get(&id))
        else {
            return false;
        };
        let Some(direction) = normalized_vector(center.point, other.point) else {
            return false;
        };
        let dot = (reference.x * direction.x + reference.y * direction.y).clamp(-1.0, 1.0);
        if dot >= cos_tol {
            has_forward = true;
        } else if dot <= -cos_tol {
            has_backward = true;
        } else {
            return false;
        }
    }

    has_forward && has_backward
}

fn edges_are_carrier_collinear(
    arrangement: &CandidateArrangement,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    left: &ArrangementAtomicEdge,
    right: &ArrangementAtomicEdge,
) -> bool {
    if left.carrier_id == right.carrier_id {
        return true;
    }
    let Some(left_carrier) = carriers.get(&left.carrier_id).copied() else {
        return false;
    };
    let Some(right_carrier) = carriers.get(&right.carrier_id).copied() else {
        return false;
    };
    let carrier_dot = (left_carrier.normal.x * right_carrier.normal.x
        + left_carrier.normal.y * right_carrier.normal.y)
        .clamp(-1.0, 1.0)
        .abs();
    let carrier_angle = carrier_dot.acos();
    let carrier_angle_tol = arrangement
        .options
        .collinear_angle_degrees
        .max(6.0)
        .to_radians();
    carrier_angle <= carrier_angle_tol
}

fn next_semantic_pass_through_edge(
    current_id: usize,
    previous_id: usize,
    neighbors: Option<&Vec<(usize, usize)>>,
    visited_edges: &BTreeSet<usize>,
    arrangement: &CandidateArrangement,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
) -> Option<(usize, usize)> {
    let center = vertices.get(&current_id)?.point;
    let previous = vertices.get(&previous_id)?.point;
    let reference = normalized_vector(center, previous)?;
    let angle_tol = arrangement
        .options
        .collinear_angle_degrees
        .max(6.0)
        .to_radians();
    let cos_tol = angle_tol.cos();
    neighbors?
        .iter()
        .filter(|(candidate_vertex_id, candidate_edge_id)| {
            *candidate_vertex_id != previous_id && !visited_edges.contains(candidate_edge_id)
        })
        .filter_map(|(candidate_vertex_id, candidate_edge_id)| {
            let candidate = vertices.get(candidate_vertex_id)?.point;
            let direction = normalized_vector(center, candidate)?;
            let dot = (reference.x * direction.x + reference.y * direction.y).clamp(-1.0, 1.0);
            if dot > -cos_tol {
                return None;
            }
            let support = arrangement
                .atomic_edges
                .get(*candidate_edge_id)
                .map(|edge| edge.line_support)
                .unwrap_or(0.0);
            Some((*candidate_vertex_id, *candidate_edge_id, support))
        })
        .max_by(|left, right| {
            left.2
                .total_cmp(&right.2)
                .then_with(|| right.1.cmp(&left.1))
                .then_with(|| right.0.cmp(&left.0))
        })
        .map(|(vertex_id, edge_id, _)| (vertex_id, edge_id))
}

fn other_edge_vertex(edge: &ArrangementAtomicEdge, vertex_id: usize) -> Option<usize> {
    if edge.vertices[0] == vertex_id {
        Some(edge.vertices[1])
    } else if edge.vertices[1] == vertex_id {
        Some(edge.vertices[0])
    } else {
        None
    }
}

fn normalized_vector(from: crate::Point2, to: crate::Point2) -> Option<crate::Point2> {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let length = (dx * dx + dy * dy).sqrt();
    (length > 1e-9).then_some(crate::Point2::new(dx / length, dy / length))
}

fn representative_carrier_for_path(
    arrangement: &CandidateArrangement,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    edge_ids: &[usize],
) -> Option<usize> {
    let mut by_carrier = BTreeMap::<usize, f64>::new();
    for edge_id in edge_ids {
        let edge = arrangement.atomic_edges.get(*edge_id)?;
        let carrier = carriers.get(&edge.carrier_id)?;
        if carrier.kind != ArrangementCarrierKind::ObservedLocal {
            continue;
        }
        *by_carrier.entry(edge.carrier_id).or_default() += edge.line_support;
    }
    by_carrier
        .into_iter()
        .max_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| right.0.cmp(&left.0))
        })
        .map(|(carrier_id, _)| carrier_id)
}

fn normalized_span_path(
    arrangement: &CandidateArrangement,
    vertices: &BTreeMap<usize, &ArrangementVertex>,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    carrier_id: usize,
    endpoints: [usize; 2],
    mut edge_ids: Vec<usize>,
    mut collapsed_vertex_ids: Vec<usize>,
) -> Option<SpanPath> {
    if endpoints[0] == endpoints[1] {
        return None;
    }
    let carrier = carriers.get(&carrier_id).copied()?;
    let start = vertices.get(&endpoints[0]).copied()?;
    let end = vertices.get(&endpoints[1]).copied()?;
    let t0 = start.point.x * carrier.direction.x + start.point.y * carrier.direction.y;
    let t1 = end.point.x * carrier.direction.x + end.point.y * carrier.direction.y;
    if (t1 - t0).abs() < arrangement.options.min_atomic_interval {
        return None;
    }
    edge_ids.sort_unstable();
    edge_ids.dedup();
    collapsed_vertex_ids.sort_unstable();
    collapsed_vertex_ids.dedup();
    Some(SpanPath {
        vertices: endpoints,
        edge_ids,
        collapsed_vertex_ids,
    })
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

fn normalized_pass_through_span_score(
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
    let fragment_count = span.source_atomic_edge_ids.len().saturating_sub(1) as f64;
    let fragmentation_avoidance =
        fragment_count * options.local_fragment_cost * LOCAL_FRAGMENT_SELECTION_COST_MULTIPLIER;
    let pass_through_reward = span.collapsed_vertex_ids.len() as f64 * 0.20;
    let semantic_span_reward = 0.45;

    visual_reward
        + endpoint_reward
        + assignment_reward
        + fragmentation_avoidance
        + pass_through_reward
        + semantic_span_reward
        - weak_support_cost
        - inferred_geometry_cost
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
        if !is_seed_span_candidate(arrangement, carriers, candidate, options) {
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

fn is_seed_span_candidate(
    arrangement: &CandidateArrangement,
    carriers: &BTreeMap<usize, &ArrangementCarrier>,
    candidate: &SpanCandidate,
    options: &SelectionOptions,
) -> bool {
    if candidate.span.score < options.min_selected_score {
        return false;
    }
    match candidate.span.kind {
        SelectionSpanKind::AtomicInterval => {
            let Some(edge_id) = candidate.span.source_atomic_edge_ids.first().copied() else {
                return false;
            };
            let Some(edge) = arrangement.atomic_edges.get(edge_id) else {
                return false;
            };
            let Some(carrier) = carriers.get(&edge.carrier_id).copied() else {
                return false;
            };
            carrier.kind == ArrangementCarrierKind::ObservedLocal
                && edge.line_support >= options.strong_edge_support
        }
        SelectionSpanKind::ObservedCarrierSpan
        | SelectionSpanKind::NormalizedPassThroughSpan
        | SelectionSpanKind::SharedCarrierSpan => {
            candidate.span.line_support_mean >= options.strong_edge_support
                || candidate.span.line_support_max >= options.strong_edge_support
                || candidate.span.score >= options.min_selected_score + 0.5
        }
    }
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

#[allow(clippy::too_many_arguments)]
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
    let normalized_bonus = if candidate.span.kind == SelectionSpanKind::NormalizedPassThroughSpan {
        candidate
            .span
            .source_atomic_edge_ids
            .len()
            .saturating_sub(1) as f64
            * 0.55
            + candidate.span.collapsed_vertex_ids.len() as f64 * 0.20
    } else {
        0.0
    };
    candidate.span.score + shared_bonus + observed_chain_bonus + normalized_bonus
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

#[allow(clippy::too_many_arguments)]
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
    if kind == SelectionSpanKind::NormalizedPassThroughSpan {
        let start = arrangement.vertices.get(path.vertices[0])?;
        let end = arrangement.vertices.get(path.vertices[1])?;
        let t0 = start.point.x * carrier.direction.x + start.point.y * carrier.direction.y;
        let t1 = end.point.x * carrier.direction.x + end.point.y * carrier.direction.y;
        t_min = t0.min(t1);
        t_max = t0.max(t1);
    }
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
        if kind != SelectionSpanKind::NormalizedPassThroughSpan {
            t_min = t_min.min(edge.t_interval[0]).min(edge.t_interval[1]);
            t_max = t_max.max(edge.t_interval[0]).max(edge.t_interval[1]);
        }
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
        endpoint_points: None,
        t_interval: [t_min, t_max],
        assignment: carrier.assignment,
        boundary_role: CandidateCreaseBoundaryRole::None,
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
    use crate::candidate_graph::{
        AssignmentEvidence, AssignmentEvidenceSource, BoundaryModel, BoundaryReconstructionPolicy,
        BoundarySide, BoundarySideModel, CandidateConflict, CandidateConflictKind,
        CandidateCreaseSourceKind, CandidateCreaseSpan, CandidateCreaseSpanKind, CandidateGraph,
        CandidateGraphProvenance, CandidateGraphReport, CandidateSelectionPolicy,
        CandidateSourceAdapter, CandidateVertexKind, CandidateVertexMovementPolicy, CostModel,
    };
    use crate::{AssignmentCandidate, AssignmentLabel, Point2, Provenance};

    #[test]
    fn ir_selector_selects_from_candidate_graph_without_arrangement_source() {
        let graph = fixture_candidate_graph(Vec::new());
        let selection = select_candidate_graph_beam_from_ir(
            &graph,
            SelectionOptions::default(),
            ExactProbeOptions::default(),
        );

        assert!(selection.selected_spans.iter().any(|span| span.id == 0));
        assert!(selection.selected_spans.iter().any(|span| span.id == 1));
        assert_eq!(
            selection.schema,
            "oristudio/cp-compiler/candidate-selection-v2-from-candidate-graph"
        );
    }

    #[test]
    fn ir_selector_chooses_long_span_over_conflicting_fragments() {
        let mut graph = fixture_candidate_graph(Vec::new());
        graph.crease_candidates.push(candidate_span(
            2,
            [0, 1],
            CandidateCreaseSpanKind::AtomicInterval,
            CandidateCreaseSourceKind::ArrangementObserved,
            CandidateSelectionPolicy::StrongOptional,
            0.72,
        ));
        graph.crease_candidates.push(candidate_span(
            3,
            [1, 2],
            CandidateCreaseSpanKind::AtomicInterval,
            CandidateCreaseSourceKind::ArrangementObserved,
            CandidateSelectionPolicy::StrongOptional,
            0.72,
        ));
        let mut long = candidate_span(
            4,
            [0, 2],
            CandidateCreaseSpanKind::SharedCarrierSpan,
            CandidateCreaseSourceKind::ArrangementShared,
            CandidateSelectionPolicy::StrongOptional,
            0.90,
        );
        long.replaced_span_ids = vec![2, 3];
        long.replaced_atomic_edge_ids = vec![2, 3];
        long.collapsed_vertex_ids = vec![1];
        graph.crease_candidates.push(long);
        graph.conflicts.push(CandidateConflict {
            id: 0,
            kind: CandidateConflictKind::SpanReplacesFragments,
            candidate_ids: vec![2, 3, 4],
            hard: true,
            reason: "long span replaces fragments".to_owned(),
        });
        graph.report = CandidateGraphReport {
            vertices: graph.vertices.len(),
            crease_candidates: graph.crease_candidates.len(),
            locked_border_spans: 0,
            legacy_selected_spans: 0,
            legacy_low_threshold_spans: 0,
            arrangement_observed_spans: 2,
            arrangement_shared_spans: 1,
            conflicts: graph.conflicts.len(),
        };

        let selection = select_candidate_graph_beam_from_ir(
            &graph,
            SelectionOptions {
                beam_width: 8,
                max_beam_candidates: 8,
                ..SelectionOptions::default()
            },
            ExactProbeOptions::default(),
        );

        let selected = selection
            .selected_spans
            .iter()
            .map(|span| span.id)
            .collect::<BTreeSet<_>>();
        assert!(selected.contains(&4), "long shared span should win");
        assert!(!selected.contains(&2), "fragment should be excluded");
        assert!(!selected.contains(&3), "fragment should be excluded");
    }

    #[test]
    fn ir_selector_promotes_low_threshold_edge_that_repairs_local_topology() {
        let graph = interior_candidate_graph(
            vec![
                Point2::new(0.0, 0.5),
                Point2::new(0.33, 0.5),
                Point2::new(0.66, 0.5),
                Point2::new(1.0, 0.5),
            ],
            vec![
                candidate_span_with_evidence(
                    0,
                    [0, 1],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Mountain,
                ),
                candidate_span_with_evidence(
                    1,
                    [2, 3],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Valley,
                ),
                candidate_span_with_evidence(
                    2,
                    [1, 2],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacyLowThreshold,
                    CandidateSelectionPolicy::WeakOptional,
                    0.45,
                    0.62,
                    AssignmentLabel::Mountain,
                ),
            ],
            Vec::new(),
        );

        let selection = select_candidate_graph_beam_from_ir(
            &graph,
            beam_options(),
            ExactProbeOptions::default(),
        );
        let selected = selected_span_ids(&selection);

        assert!(
            selected.contains(&2),
            "weak bridge should repair the local chain"
        );
        let score = selection
            .edge_scores
            .iter()
            .find(|score| score.edge_id == 2)
            .expect("weak candidate score");
        assert!(score.breakdown.topology_delta > 0.0);
        assert!(
            score
                .reasons
                .iter()
                .any(|reason| reason.contains("local topology delta"))
        );
    }

    #[test]
    fn ir_selector_rejects_low_threshold_edge_that_creates_dangling_topology() {
        let graph = interior_candidate_graph(
            vec![
                Point2::new(0.0, 0.5),
                Point2::new(1.0, 0.5),
                Point2::new(0.25, 0.2),
                Point2::new(0.75, 0.2),
            ],
            vec![
                candidate_span_with_evidence(
                    0,
                    [0, 1],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Mountain,
                ),
                candidate_span_with_evidence(
                    1,
                    [2, 3],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacyLowThreshold,
                    CandidateSelectionPolicy::WeakOptional,
                    0.45,
                    0.96,
                    AssignmentLabel::Valley,
                ),
            ],
            Vec::new(),
        );

        let selection = select_candidate_graph_beam_from_ir(
            &graph,
            beam_options(),
            ExactProbeOptions::default(),
        );
        let selected = selected_span_ids(&selection);
        let score = selection
            .edge_scores
            .iter()
            .find(|score| score.edge_id == 1)
            .expect("false weak candidate score");

        assert!(
            !selected.contains(&1),
            "isolated weak edge should remain out"
        );
        assert!(score.breakdown.inferred_geometry_cost > 0.0);
    }

    #[test]
    fn ir_selector_allows_unknown_assignment_when_maekawa_is_satisfiable() {
        let mut graph = interior_candidate_graph(
            vec![
                Point2::new(0.5, 0.5),
                Point2::new(1.0, 0.5),
                Point2::new(0.5, 1.0),
                Point2::new(0.0, 0.5),
                Point2::new(0.5, 0.0),
            ],
            vec![
                candidate_span_with_evidence(
                    0,
                    [0, 1],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Mountain,
                ),
                candidate_span_with_evidence(
                    1,
                    [0, 2],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Mountain,
                ),
                candidate_span_with_evidence(
                    2,
                    [0, 3],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Valley,
                ),
                candidate_span_with_evidence(
                    3,
                    [0, 4],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacyLowThreshold,
                    CandidateSelectionPolicy::WeakOptional,
                    0.45,
                    0.80,
                    AssignmentLabel::Unknown,
                ),
            ],
            Vec::new(),
        );
        for (vertex_id, side) in [
            (1, BoundarySide::Right),
            (2, BoundarySide::Top),
            (3, BoundarySide::Left),
            (4, BoundarySide::Bottom),
        ] {
            graph.vertices[vertex_id].kind = CandidateVertexKind::BoundaryContact;
            graph.vertices[vertex_id].movement_policy = CandidateVertexMovementPolicy::BoundaryOnly;
            graph.vertices[vertex_id].boundary_side = Some(side);
        }

        let selection = select_candidate_graph_beam_from_ir(
            &graph,
            beam_options(),
            ExactProbeOptions::default(),
        );
        let selected = selected_span_ids(&selection);

        assert!(
            selected.contains(&3),
            "unknown assignment should not block a satisfiable repair"
        );
    }

    #[test]
    fn ir_selector_rejects_extra_weak_edge_that_breaks_clean_vertex() {
        let graph = interior_candidate_graph(
            vec![
                Point2::new(0.5, 0.5),
                Point2::new(1.0, 0.5),
                Point2::new(0.5, 1.0),
                Point2::new(0.0, 0.5),
                Point2::new(0.5, 0.0),
                Point2::new(0.86, 0.86),
            ],
            vec![
                candidate_span_with_evidence(
                    0,
                    [0, 1],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Mountain,
                ),
                candidate_span_with_evidence(
                    1,
                    [0, 2],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Mountain,
                ),
                candidate_span_with_evidence(
                    2,
                    [0, 3],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Valley,
                ),
                candidate_span_with_evidence(
                    3,
                    [0, 4],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Valley,
                ),
                candidate_span_with_evidence(
                    4,
                    [0, 5],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacyLowThreshold,
                    CandidateSelectionPolicy::WeakOptional,
                    0.45,
                    0.96,
                    AssignmentLabel::Mountain,
                ),
            ],
            Vec::new(),
        );

        let selection = select_candidate_graph_beam_from_ir(
            &graph,
            beam_options(),
            ExactProbeOptions::default(),
        );
        let selected = selected_span_ids(&selection);
        let score = selection
            .edge_scores
            .iter()
            .find(|score| score.edge_id == 4)
            .expect("extra weak candidate score");

        assert!(
            !selected.contains(&4),
            "extra crease should not break a clean degree-4 vertex"
        );
        assert!(score.breakdown.inferred_geometry_cost > 0.0);
    }

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
        assert_eq!(selection.report.selected_spans, 1);
        assert_eq!(
            selection.selected_spans[0].kind,
            SelectionSpanKind::AtomicInterval
        );
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
        assert_eq!(span.kind, SelectionSpanKind::NormalizedPassThroughSpan);
        assert_eq!(span.vertices, [0, 3]);
        assert_eq!(span.source_atomic_edge_ids, vec![0, 1, 2]);
        assert_eq!(span.collapsed_vertex_ids, vec![1, 2]);
    }

    #[test]
    fn arrangement_candidate_graph_preserves_normalized_pass_through_span_candidate() {
        let mut arrangement = observed_carrier_chain_fixture();
        arrangement.vertices[1].kind = ArrangementVertexKind::ObservedLineEndpoint;
        arrangement.vertices[2].kind = ArrangementVertexKind::CarrierIntersection;

        let mut options = beam_options();
        options.max_beam_candidates = 32;
        let graph = candidate_graph_from_arrangement_for_selection(&arrangement, options);

        assert!(graph.crease_candidates.iter().any(|span| {
            span.kind == CandidateCreaseSpanKind::NormalizedPassThroughSpan
                && span.vertices == [0, 3]
                && span.source_atomic_edge_ids == vec![0, 1, 2]
                && span.collapsed_vertex_ids == vec![1, 2]
        }));
    }

    #[test]
    fn normalized_pass_through_span_collapses_degree_two_observed_junction() {
        let mut arrangement = observed_carrier_chain_fixture();
        arrangement.vertices[1].kind = ArrangementVertexKind::ObservedLineEndpoint;
        arrangement.vertices[2].kind = ArrangementVertexKind::ObservedJunction;

        let mut options = beam_options();
        options.max_beam_candidates = 32;
        let selection =
            select_candidate_graph_beam(&arrangement, options, ExactProbeOptions::default());

        assert_eq!(selection.selected_edge_ids, vec![0, 1, 2]);
        assert_eq!(selection.report.selected_spans, 1);
        let span = &selection.selected_spans[0];
        assert_eq!(span.kind, SelectionSpanKind::NormalizedPassThroughSpan);
        assert_eq!(span.vertices, [0, 3]);
        assert_eq!(span.source_atomic_edge_ids, vec![0, 1, 2]);
        assert_eq!(span.collapsed_vertex_ids, vec![1, 2]);
    }

    #[test]
    fn normalized_pass_through_span_preserves_branch_junction_as_endpoint() {
        let mut arrangement = observed_carrier_chain_fixture();
        arrangement.vertices[1].kind = ArrangementVertexKind::ObservedLineEndpoint;
        arrangement.vertices[2].kind = ArrangementVertexKind::ObservedJunction;
        arrangement.vertices.push(vertex(
            4,
            Point2::new(0.6, 0.4),
            ArrangementVertexKind::ObservedJunction,
        ));
        let mut branch_carrier = carrier(3);
        branch_carrier.normal = Point2::new(1.0, 0.0);
        branch_carrier.direction = Point2::new(0.0, 1.0);
        branch_carrier.rho = 0.6;
        arrangement.carriers.push(branch_carrier);
        arrangement.atomic_edges.push(edge(3, 3, [2, 4], 0.88));
        arrangement.report.vertices += 1;
        arrangement.report.carriers += 1;
        arrangement.report.observed_carriers += 1;
        arrangement.report.atomic_edges += 1;

        let mut options = beam_options();
        options.max_beam_candidates = 32;
        let selection =
            select_candidate_graph_beam(&arrangement, options, ExactProbeOptions::default());

        assert!(selection.selected_spans.iter().all(|span| !(span.kind
            == SelectionSpanKind::NormalizedPassThroughSpan
            && span.vertices == [0, 3]
            && span.collapsed_vertex_ids.contains(&2))));
        assert!(
            selection.selected_spans.iter().any(|span| {
                span.vertices.contains(&2) && !span.collapsed_vertex_ids.contains(&2)
            })
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
    fn local_fragments_on_degree_two_chain_normalize_without_shared_replacement() {
        let arrangement =
            fixture_arrangement(vec![edge(0, 0, [0, 1], 0.86), edge(1, 1, [1, 2], 0.84)]);

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert_eq!(selection.report.shared_replacements, 0);
        assert_eq!(selection.selected_edge_ids, vec![0, 1]);
        assert_eq!(selection.report.selected_spans, 1);
        let span = &selection.selected_spans[0];
        assert_eq!(span.kind, SelectionSpanKind::NormalizedPassThroughSpan);
        assert_eq!(span.vertices, [0, 2]);
        assert_eq!(span.source_atomic_edge_ids, vec![0, 1]);
        assert_eq!(span.collapsed_vertex_ids, vec![1]);
    }

    #[test]
    fn beam_normalizes_collinear_degree_two_vertices_before_structural_report() {
        let arrangement =
            fixture_arrangement(vec![edge(0, 0, [0, 1], 0.86), edge(1, 1, [1, 2], 0.84)]);

        let selection =
            select_candidate_graph_beam(&arrangement, beam_options(), ExactProbeOptions::default());

        assert_eq!(selection.report.collapsible_degree_two_vertices, 0);
        assert_eq!(selection.report.non_collinear_degree_two_vertices, 0);
        assert_eq!(
            selection.selected_spans[0].kind,
            SelectionSpanKind::NormalizedPassThroughSpan
        );
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
        assert!(
            selection
                .selected_spans
                .iter()
                .all(|span| span.kind != SelectionSpanKind::NormalizedPassThroughSpan)
        );
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

    fn fixture_candidate_graph(extra_conflicts: Vec<CandidateConflict>) -> CandidateGraph {
        let vertices = vec![
            ir_vertex(0, Point2::new(0.0, 0.0), Some(BoundarySide::Top)),
            ir_vertex(1, Point2::new(0.5, 0.0), Some(BoundarySide::Top)),
            ir_vertex(2, Point2::new(1.0, 0.0), Some(BoundarySide::Right)),
            ir_vertex(3, Point2::new(0.0, 1.0), Some(BoundarySide::Left)),
        ];
        let crease_candidates = vec![
            candidate_span(
                0,
                [0, 3],
                CandidateCreaseSpanKind::BorderSpan,
                CandidateCreaseSourceKind::BorderGenerated,
                CandidateSelectionPolicy::Locked,
                0.99,
            ),
            candidate_span(
                1,
                [0, 2],
                CandidateCreaseSpanKind::AtomicInterval,
                CandidateCreaseSourceKind::LegacySelected,
                CandidateSelectionPolicy::StrongOptional,
                0.94,
            ),
        ];
        CandidateGraph {
            schema: "test/candidate-graph".to_owned(),
            coordinate_space: "unit_square".to_owned(),
            image_size: Some(128),
            vertices,
            boundary: BoundaryModel {
                corners: [0, 2, 2, 3],
                sides: vec![
                    BoundarySideModel {
                        side: BoundarySide::Top,
                        corner_vertices: [0, 2],
                        contact_vertices: vec![0, 1, 2],
                    },
                    BoundarySideModel {
                        side: BoundarySide::Right,
                        corner_vertices: [2, 2],
                        contact_vertices: vec![2],
                    },
                    BoundarySideModel {
                        side: BoundarySide::Bottom,
                        corner_vertices: [3, 2],
                        contact_vertices: Vec::new(),
                    },
                    BoundarySideModel {
                        side: BoundarySide::Left,
                        corner_vertices: [0, 3],
                        contact_vertices: vec![0, 3],
                    },
                ],
                generated_border_span_ids: vec![0],
                reconstruction_policy: BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts,
            },
            crease_candidates,
            conflicts: extra_conflicts.clone(),
            alternatives: extra_conflicts,
            cost_model: CostModel::default(),
            provenance: CandidateGraphProvenance {
                source_adapter: CandidateSourceAdapter::Legacy,
                source_ids: Vec::new(),
                notes: Vec::new(),
            },
            report: CandidateGraphReport {
                vertices: 4,
                crease_candidates: 2,
                locked_border_spans: 1,
                legacy_selected_spans: 1,
                legacy_low_threshold_spans: 0,
                arrangement_observed_spans: 0,
                arrangement_shared_spans: 0,
                conflicts: 0,
            },
        }
    }

    fn selected_span_ids(selection: &CandidateSelection) -> BTreeSet<usize> {
        selection
            .selected_spans
            .iter()
            .map(|span| span.id)
            .collect()
    }

    fn interior_candidate_graph(
        points: Vec<Point2>,
        crease_candidates: Vec<CandidateCreaseSpan>,
        extra_conflicts: Vec<CandidateConflict>,
    ) -> CandidateGraph {
        let vertices = points
            .into_iter()
            .enumerate()
            .map(|(id, point)| ir_vertex(id, point, None))
            .collect::<Vec<_>>();
        let vertex_count = vertices.len();
        let conflict_count = extra_conflicts.len();
        CandidateGraph {
            schema: "test/interior-candidate-graph".to_owned(),
            coordinate_space: "unit_square".to_owned(),
            image_size: Some(128),
            vertices,
            boundary: BoundaryModel {
                corners: [0, 0, 0, 0],
                sides: Vec::new(),
                generated_border_span_ids: Vec::new(),
                reconstruction_policy: BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts,
            },
            conflicts: extra_conflicts.clone(),
            alternatives: extra_conflicts,
            report: CandidateGraphReport {
                vertices: vertex_count,
                crease_candidates: crease_candidates.len(),
                locked_border_spans: crease_candidates
                    .iter()
                    .filter(|span| span.selection_policy == CandidateSelectionPolicy::Locked)
                    .count(),
                legacy_selected_spans: crease_candidates
                    .iter()
                    .filter(|span| span.source_kind == CandidateCreaseSourceKind::LegacySelected)
                    .count(),
                legacy_low_threshold_spans: crease_candidates
                    .iter()
                    .filter(|span| {
                        span.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold
                    })
                    .count(),
                arrangement_observed_spans: crease_candidates
                    .iter()
                    .filter(|span| {
                        span.source_kind == CandidateCreaseSourceKind::ArrangementObserved
                    })
                    .count(),
                arrangement_shared_spans: crease_candidates
                    .iter()
                    .filter(|span| span.source_kind == CandidateCreaseSourceKind::ArrangementShared)
                    .count(),
                conflicts: conflict_count,
            },
            crease_candidates,
            cost_model: CostModel::default(),
            provenance: CandidateGraphProvenance {
                source_adapter: CandidateSourceAdapter::Legacy,
                source_ids: Vec::new(),
                notes: Vec::new(),
            },
        }
    }

    fn parity_square_graph() -> CandidateGraph {
        // Open square cycle: spans 0..=2 are strong/selected, span 3 closes the
        // cycle but is weak. With only 0..=2 selected, v0 and v3 are odd.
        interior_candidate_graph(
            vec![
                Point2::new(0.3, 0.3),
                Point2::new(0.7, 0.3),
                Point2::new(0.7, 0.7),
                Point2::new(0.3, 0.7),
            ],
            vec![
                candidate_span_with_evidence(
                    0,
                    [0, 1],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Mountain,
                ),
                candidate_span_with_evidence(
                    1,
                    [1, 2],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Valley,
                ),
                candidate_span_with_evidence(
                    2,
                    [2, 3],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSelectionPolicy::StrongOptional,
                    0.94,
                    0.94,
                    AssignmentLabel::Mountain,
                ),
                candidate_span_with_evidence(
                    3,
                    [3, 0],
                    CandidateCreaseSpanKind::AtomicInterval,
                    CandidateCreaseSourceKind::LegacyLowThreshold,
                    CandidateSelectionPolicy::WeakOptional,
                    0.50,
                    0.50,
                    AssignmentLabel::Unknown,
                ),
            ],
            Vec::new(),
        )
    }

    #[test]
    fn parity_repair_adds_weak_span_that_fixes_odd_vertices() {
        let graph = parity_square_graph();
        let options = SelectionOptions {
            parity_repair: true,
            ..SelectionOptions::default()
        };
        let conflict_map = candidate_conflict_map(&graph);
        let locked_ids = BTreeSet::new();
        let state = score_ir_beam_state(&graph, &BTreeSet::from([0, 1, 2]), &options);
        assert_eq!(state.residuals.odd_degree_vertices, 2);
        let repaired = parity_repair_ir_state(&graph, state, &conflict_map, &locked_ids, &options);
        assert!(
            repaired.selected_span_ids.contains(&3),
            "parity repair should select the cycle-closing weak span"
        );
        assert_eq!(repaired.residuals.odd_degree_vertices, 0);
    }

    #[test]
    fn parity_repair_disabled_leaves_state_unchanged() {
        let graph = parity_square_graph();
        let options = SelectionOptions::default();
        assert!(!options.parity_repair);
        let conflict_map = candidate_conflict_map(&graph);
        let locked_ids = BTreeSet::new();
        let state = score_ir_beam_state(&graph, &BTreeSet::from([0, 1, 2]), &options);
        let repaired = parity_repair_ir_state(
            &graph,
            state.clone(),
            &conflict_map,
            &locked_ids,
            &options,
        );
        assert_eq!(repaired.selected_span_ids, state.selected_span_ids);
    }

    #[allow(clippy::too_many_arguments)]
    fn candidate_span_with_evidence(
        id: usize,
        vertices: [usize; 2],
        kind: CandidateCreaseSpanKind,
        source_kind: CandidateCreaseSourceKind,
        policy: CandidateSelectionPolicy,
        presence: f64,
        support: f64,
        label: AssignmentLabel,
    ) -> CandidateCreaseSpan {
        let mut span = candidate_span(id, vertices, kind, source_kind, policy, presence);
        span.line_support_min = support;
        span.line_support_mean = support;
        span.line_support_max = support;
        span.assignment_evidence = AssignmentEvidence::from_candidate(
            AssignmentCandidate {
                label,
                confidence: if label == AssignmentLabel::Unknown {
                    0.50
                } else {
                    0.80
                },
                margin: 0.60,
            },
            AssignmentEvidenceSource::LegacyColor,
        );
        span
    }

    fn ir_vertex(
        id: usize,
        point: Point2,
        boundary_side: Option<BoundarySide>,
    ) -> crate::candidate_graph::CandidateVertex {
        crate::candidate_graph::CandidateVertex {
            id,
            point,
            kind: if boundary_side.is_some() {
                CandidateVertexKind::BoundaryContact
            } else {
                CandidateVertexKind::InteriorJunction
            },
            support: 1.0,
            movement_policy: if boundary_side.is_some() {
                CandidateVertexMovementPolicy::BoundaryOnly
            } else {
                CandidateVertexMovementPolicy::Movable
            },
            boundary_side,
            source_vertex_ids: vec![id],
            source_carrier_ids: Vec::new(),
            source_adapter: CandidateSourceAdapter::Legacy,
            provenance: vec![Provenance::LegacyDecoder],
        }
    }

    fn candidate_span(
        id: usize,
        vertices: [usize; 2],
        kind: CandidateCreaseSpanKind,
        source_kind: CandidateCreaseSourceKind,
        policy: CandidateSelectionPolicy,
        presence: f64,
    ) -> CandidateCreaseSpan {
        CandidateCreaseSpan {
            id,
            kind,
            vertices,
            carrier: crate::candidate_graph::CandidateCarrierGeometry {
                normal: Point2::new(0.0, 1.0),
                direction: Point2::new(1.0, 0.0),
                rho: 0.0,
            },
            t_interval: [0.0, 1.0],
            assignment_evidence: AssignmentEvidence::from_candidate(
                assignment(),
                AssignmentEvidenceSource::LegacyColor,
            ),
            presence_probability: presence,
            line_support_min: presence,
            line_support_mean: presence,
            line_support_max: presence,
            style_support: 0.0,
            non_crease_support: 0.0,
            source_kind,
            selection_policy: policy,
            boundary_role: if source_kind == CandidateCreaseSourceKind::BorderGenerated {
                CandidateCreaseBoundaryRole::PaperBoundary
            } else {
                CandidateCreaseBoundaryRole::None
            },
            source_edge_ids: vec![id],
            source_atomic_edge_ids: vec![id],
            source_carrier_ids: vec![id],
            replaced_span_ids: Vec::new(),
            replaced_atomic_edge_ids: Vec::new(),
            collapsed_vertex_ids: Vec::new(),
            provenance: vec![Provenance::LegacyDecoder],
            reasons: Vec::new(),
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
