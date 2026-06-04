//! Research primitives for deriving folding sequences from FOLD crease patterns.
//!
//! This crate intentionally builds on `treemaker-flatfold` instead of
//! reimplementing flat-folding. The current public surface is Phase 1 of the
//! roadmap: resolve a deterministic target folded state and expose enough
//! diagnostics for later planning stages.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use treemaker_flatfold::{
    ConstraintSummary, FlatFoldError, OverlapGraph, SolveOptions, solve_flat_fold,
};
use treemaker_fold::{
    Assignment, FoldDocument, build_edges_faces, build_faces_edges, validate_basic,
};

pub use treemaker_flatfold::SolutionLimit;

pub type Result<T> = std::result::Result<T, SequenceError>;

const ID_MAP_EPSILON: f64 = 1.0e-9;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SequenceError {
    #[error("invalid folding-sequence input: {0}")]
    InvalidInput(String),
    #[error("invalid sequence state: {diagnostics_len} diagnostic(s)")]
    InvalidState { diagnostics_len: usize },
    #[error("target layer order is ambiguous: {states} possible state(s)")]
    AmbiguousLayerOrder { states: String },
    #[error("folding-sequence component is not yet implemented: {0}")]
    NotImplemented(&'static str),
    #[error(transparent)]
    FlatFold(#[from] FlatFoldError),
}

impl SequenceError {
    pub fn code(&self) -> &'static str {
        match self {
            SequenceError::InvalidInput(_) => "invalid_input",
            SequenceError::InvalidState { .. } => "invalid_state",
            SequenceError::AmbiguousLayerOrder { .. } => "ambiguous_layer_order",
            SequenceError::NotImplemented(_) => "not_implemented",
            SequenceError::FlatFold(error) => flatfold_error_code(error),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TargetStateOptions {
    pub solution_limit: SolutionLimit,
    pub starting_face: Option<usize>,
    pub require_unique_layer_order: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TargetState {
    pub normalized: FoldDocument,
    pub folded_vertices: Vec<[f64; 2]>,
    pub faces_flip: Vec<bool>,
    pub overlap: OverlapGraph,
    pub face_orders: Vec<[i64; 3]>,
    pub selected_solution_index: usize,
    pub states: String,
    pub component_sizes: Vec<usize>,
    pub solution_counts: Vec<usize>,
    pub constraints: ConstraintSummary,
    pub id_map: TargetIdMap,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

impl TargetState {
    pub fn from_fold(document: &FoldDocument, options: TargetStateOptions) -> Result<Self> {
        reject_zero_solution_limit(&options.solution_limit)?;
        let solved = solve_flat_fold(
            document,
            SolveOptions {
                starting_face: options.starting_face,
                solution_limit: options.solution_limit.clone(),
                ..SolveOptions::default()
            },
        )?;
        let overlap = solved.analysis.overlap.clone().ok_or_else(|| {
            SequenceError::InvalidInput(
                "flat-fold target analysis did not include an overlap graph".to_string(),
            )
        })?;
        let ambiguous = solution_counts_are_ambiguous(&solved.solution_counts);
        if options.require_unique_layer_order && ambiguous {
            return Err(SequenceError::AmbiguousLayerOrder {
                states: solved.states,
            });
        }
        let normalized = solved.analysis.normalized.document;
        let id_map = TargetIdMap::from_documents(document, &normalized);
        let mut diagnostics = Vec::new();
        diagnostics.extend(
            solved
                .analysis
                .diagnostics
                .into_iter()
                .map(|diagnostic| SequenceDiagnostic::info(diagnostic.code, diagnostic.message)),
        );
        diagnostics.extend(
            solved
                .diagnostics
                .into_iter()
                .map(|diagnostic| SequenceDiagnostic::info(diagnostic.code, diagnostic.message)),
        );
        if ambiguous {
            diagnostics.push(SequenceDiagnostic::warning(
                "ambiguous_layer_order",
                format!(
                    "flat-fold solver found {} possible layer-order state(s); target state uses deterministic first-solution face orders",
                    solved.states
                ),
            ));
        }
        if solution_limit_may_have_truncated(&options.solution_limit, &solved.solution_counts) {
            diagnostics.push(SequenceDiagnostic::warning(
                "solution_limit_reached",
                "solution limit was reached for at least one layer-order component; ambiguity may be undercounted",
            ));
        }
        Ok(Self {
            normalized,
            folded_vertices: solved.analysis.folded_vertices,
            faces_flip: solved.analysis.faces_flip,
            overlap,
            face_orders: solved.face_orders,
            selected_solution_index: 0,
            states: solved.states,
            component_sizes: solved.component_sizes,
            solution_counts: solved.solution_counts,
            constraints: solved.constraints,
            id_map,
            diagnostics,
        })
    }

    pub fn has_layer_order_ambiguity(&self) -> bool {
        solution_counts_are_ambiguous(&self.solution_counts)
    }

    pub fn normalized_frame(&self) -> TargetFrame {
        TargetFrame {
            document: self.normalized.clone(),
            face_orders: self.face_orders.clone(),
        }
    }

    pub fn folded_frame(&self) -> TargetFrame {
        let mut document = self.normalized.clone();
        document.vertices_coords = self
            .folded_vertices
            .iter()
            .map(|[x, y]| vec![*x, *y])
            .collect();
        if !document
            .frame_classes
            .iter()
            .any(|class| class == "foldedForm")
        {
            document.frame_classes.push("foldedForm".to_string());
        }
        TargetFrame {
            document,
            face_orders: self.face_orders.clone(),
        }
    }
}

pub fn resolve_target_state(
    document: &FoldDocument,
    options: TargetStateOptions,
) -> Result<TargetState> {
    TargetState::from_fold(document, options)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TargetFrame {
    pub document: FoldDocument,
    pub face_orders: Vec<[i64; 3]>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TargetIdMap {
    pub normalized_vertices_to_input_vertices: Vec<Vec<usize>>,
    pub normalized_edges_to_input_edges: Vec<Vec<usize>>,
    pub normalized_faces_to_input_faces: Vec<Vec<usize>>,
}

impl TargetIdMap {
    pub fn from_documents(input: &FoldDocument, normalized: &FoldDocument) -> Self {
        let normalized_vertices_to_input_vertices = map_vertices(input, normalized);
        let normalized_edges_to_input_edges = map_edges(input, normalized);
        let normalized_faces_to_input_faces =
            map_faces(input, normalized, &normalized_vertices_to_input_vertices);
        Self {
            normalized_vertices_to_input_vertices,
            normalized_edges_to_input_edges,
            normalized_faces_to_input_faces,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SequenceDiagnostic {
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub message: String,
}

impl SequenceDiagnostic {
    pub fn info(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: DiagnosticSeverity::Info,
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn warning(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: DiagnosticSeverity::Warning,
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: DiagnosticSeverity::Error,
            code: code.into(),
            message: message.into(),
        }
    }
}

pub fn plan_folding_sequence(target: &TargetState) -> Result<SequencePlan> {
    plan_folding_sequence_with_options(target, SequencePlanOptions::default())
}

pub fn plan_folding_sequence_with_options(
    target: &TargetState,
    options: SequencePlanOptions,
) -> Result<SequencePlan> {
    let target_state = SequenceState::from_target("target", target);
    target_state.validate()?;

    let mut frontier = vec![SearchNode::initial(target_state.clone())];
    let mut best_node = frontier[0].clone();
    let mut context = PlanningContext::new(&target_state, target);
    let mut explored_states = 1usize;
    let mut branches_pruned = 0usize;
    let mut budget_exhausted = false;

    'search: while let Some(node) = frontier.pop() {
        if search_node_is_better(&node, &best_node) {
            best_node = node.clone();
        }
        if node.state.active_creases.is_empty() {
            best_node = node;
            break;
        }
        if node.reverse_steps.len() >= options.max_steps {
            budget_exhausted = true;
            continue;
        }
        let transitions = reverse_transitions_for_state(&node.state, &mut context)?;
        branches_pruned += transitions.len().saturating_sub(1);
        for transition in transitions.into_iter().rev() {
            if explored_states >= options.max_states {
                budget_exhausted = true;
                break 'search;
            }
            transition.state.validate()?;
            explored_states += 1;
            frontier.push(node.extend(transition));
        }
    }

    let current = best_node.state.clone();
    let complex_candidates = recognize_complex_moves(&current)?;
    let complex_transform_results = complex_candidates
        .iter()
        .map(|candidate| {
            apply_complex_transform(
                &current,
                &format!("diagnostic-state-{}", context.next_state_serial + 1),
                candidate,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    let unresolved_regions = unresolved_regions_for_state(&current);
    let status = if unresolved_regions.is_empty() {
        PlanStatus::Complete
    } else if complex_candidates
        .iter()
        .any(|candidate| candidate.kind == ComplexMoveKind::SimultaneousCollapse)
    {
        PlanStatus::Unsupported
    } else {
        PlanStatus::Partial
    };
    if unresolved_regions.is_empty() {
        budget_exhausted = false;
    }

    let mut diagnostics = target.diagnostics.clone();
    diagnostics.extend(best_node.transform_diagnostics.clone());
    if !unresolved_regions.is_empty() {
        diagnostics.push(SequenceDiagnostic::warning(
            "manual_collapse_required",
            "planner could not derive validated folds from the flat crease pattern into the first solved state; manual collapse is required before the generated steps",
        ));
    }
    if budget_exhausted {
        diagnostics.push(SequenceDiagnostic::warning(
            "search_budget_exhausted",
            "planner returned the best partial state reached before the configured search budget",
        ));
    }
    for transform in &complex_transform_results {
        diagnostics.extend(transform.diagnostics.clone());
    }

    let mut steps = best_node
        .reverse_steps
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    let mut states = best_node.reverse_states;
    states.reverse();
    if !unresolved_regions.is_empty() {
        let manual_before = flat_cp_state("flat-cp", target);
        let manual_after = states
            .first()
            .map(|state| state.id.clone())
            .unwrap_or_else(|| current.id.clone());
        steps.insert(
            0,
            manual_collapse_step(manual_before.id.clone(), manual_after, &unresolved_regions),
        );
        states.insert(0, manual_before);
    }
    normalize_sequence_ids(&mut states, &mut steps);
    for step in &steps {
        diagnostics.extend(inspect_step_certificate(step));
    }

    Ok(SequencePlan {
        status,
        steps,
        states,
        diagnostics,
        unresolved_regions,
        search: SearchStats {
            states_explored: explored_states,
            branches_pruned,
            repeated_states: context.repeated_states,
            timed_out: budget_exhausted,
            budget_exhausted,
            best_unresolved_creases: current.active_creases.len(),
            target_solves: context.target_solves,
            target_solve_cache_hits: context.target_solve_cache_hits,
            duplicate_candidates_pruned: context.duplicate_candidates_pruned,
        },
    })
}

#[derive(Debug, Clone)]
struct PlanningContext {
    next_state_serial: usize,
    seen_state_keys: HashSet<String>,
    seen_document_keys: HashSet<String>,
    target_cache: HashMap<String, TargetState>,
    target_solves: usize,
    target_solve_cache_hits: usize,
    duplicate_candidates_pruned: usize,
    repeated_states: usize,
}

impl PlanningContext {
    fn new(target_state: &SequenceState, target: &TargetState) -> Self {
        let mut target_cache = HashMap::new();
        target_cache.insert(sequence_document_key(&target.normalized), target.clone());
        Self {
            next_state_serial: 0,
            seen_state_keys: HashSet::from([sequence_state_key(target_state)]),
            seen_document_keys: HashSet::from([sequence_document_key(&target_state.document)]),
            target_cache,
            target_solves: 0,
            target_solve_cache_hits: 0,
            duplicate_candidates_pruned: 0,
            repeated_states: 0,
        }
    }

    fn next_state_id(&mut self) -> String {
        self.next_state_serial += 1;
        format!("search-state-{}", self.next_state_serial)
    }

    fn document_key_is_seen(&mut self, document: &FoldDocument) -> bool {
        if self
            .seen_document_keys
            .contains(&sequence_document_key(document))
        {
            self.note_duplicate_candidate();
            true
        } else {
            false
        }
    }

    fn reserve_state(&mut self, state: &SequenceState) -> bool {
        if self.seen_state_keys.insert(sequence_state_key(state)) {
            self.seen_document_keys
                .insert(sequence_document_key(&state.document));
            true
        } else {
            self.note_duplicate_candidate();
            false
        }
    }

    fn resolve_target(&mut self, document: &FoldDocument) -> Result<TargetState> {
        let key = sequence_document_key(document);
        if let Some(target) = self.target_cache.get(&key) {
            self.target_solve_cache_hits += 1;
            return Ok(target.clone());
        }
        self.target_solves += 1;
        let target = resolve_target_state(document, TargetStateOptions::default())?;
        self.target_cache.insert(key, target.clone());
        Ok(target)
    }

    fn note_duplicate_candidate(&mut self) {
        self.duplicate_candidates_pruned += 1;
        self.repeated_states += 1;
    }
}

#[derive(Debug, Clone)]
struct SearchNode {
    state: SequenceState,
    reverse_states: Vec<SequenceState>,
    reverse_steps: Vec<InstructionStep>,
    transform_diagnostics: Vec<SequenceDiagnostic>,
}

impl SearchNode {
    fn initial(state: SequenceState) -> Self {
        Self {
            state: state.clone(),
            reverse_states: vec![state],
            reverse_steps: Vec::new(),
            transform_diagnostics: Vec::new(),
        }
    }

    fn extend(&self, transition: ReverseTransition) -> Self {
        let mut reverse_states = self.reverse_states.clone();
        reverse_states.push(transition.state.clone());
        let mut reverse_steps = self.reverse_steps.clone();
        reverse_steps.push(transition.step);
        let mut transform_diagnostics = self.transform_diagnostics.clone();
        transform_diagnostics.extend(transition.diagnostics);
        Self {
            state: transition.state,
            reverse_states,
            reverse_steps,
            transform_diagnostics,
        }
    }
}

#[derive(Debug, Clone)]
struct ReverseTransition {
    state: SequenceState,
    step: InstructionStep,
    diagnostics: Vec<SequenceDiagnostic>,
}

fn reverse_transitions_for_state(
    state: &SequenceState,
    context: &mut PlanningContext,
) -> Result<Vec<ReverseTransition>> {
    let mut transitions = Vec::new();
    for simple_fold in detect_simple_folds(state)? {
        let document =
            document_with_creases_reset(state, std::slice::from_ref(&simple_fold.crease));
        if context.document_key_is_seen(&document) {
            continue;
        }
        let next_state_id = context.next_state_id();
        if let Ok(next) = apply_reverse_simple_fold_with_context(
            state,
            &next_state_id,
            &simple_fold,
            document,
            context,
        ) {
            if !context.reserve_state(&next) {
                continue;
            }
            transitions.push(ReverseTransition {
                step: simple_fold.to_forward_step(0, next.id.clone(), state.id.clone()),
                state: next,
                diagnostics: Vec::new(),
            });
        }
    }

    for candidate in recognize_complex_moves(state)? {
        let result = apply_complex_transform_with_context(state, context, &candidate)?;
        if result.status == ComplexTransformStatus::Applied
            && let (Some(next), Some(step)) = (result.after_state, result.step)
        {
            if !context.reserve_state(&next) {
                continue;
            }
            transitions.push(ReverseTransition {
                state: next,
                step,
                diagnostics: result.diagnostics,
            });
        }
    }
    Ok(transitions)
}

fn search_node_is_better(candidate: &SearchNode, incumbent: &SearchNode) -> bool {
    search_node_score(candidate) < search_node_score(incumbent)
}

fn search_node_score(node: &SearchNode) -> (usize, usize, usize) {
    (
        node.state.active_creases.len(),
        unresolved_regions_for_state(&node.state).len(),
        node.reverse_steps.len(),
    )
}

fn sequence_state_key(state: &SequenceState) -> String {
    let mut active_creases = state.active_creases.clone();
    active_creases.sort_unstable();
    sequence_assignment_key(
        &active_creases,
        &state.document.edges_assignment,
        &state.face_orders,
    )
}

fn sequence_document_key(document: &FoldDocument) -> String {
    let active_creases = active_creases_for_assignments(&document.edges_assignment);
    sequence_assignment_key(
        &active_creases,
        &document.edges_assignment,
        &document.face_orders,
    )
}

fn sequence_assignment_key(
    active_creases: &[usize],
    assignments: &[Assignment],
    face_orders: &[[i64; 3]],
) -> String {
    let assignments = assignments
        .iter()
        .map(|assignment| assignment.as_str())
        .collect::<Vec<_>>()
        .join("");
    format!("{active_creases:?}|{assignments}|{face_orders:?}")
}

fn active_creases_for_assignments(assignments: &[Assignment]) -> Vec<usize> {
    assignments
        .iter()
        .enumerate()
        .filter_map(|(edge, assignment)| {
            matches!(assignment, Assignment::Mountain | Assignment::Valley).then_some(edge)
        })
        .collect()
}

fn flat_cp_state(id: impl Into<String>, target: &TargetState) -> SequenceState {
    let document = target.normalized.clone();
    let folded_vertices = document
        .vertices_coords
        .iter()
        .map(|coord| {
            [
                coord.first().copied().unwrap_or(0.0),
                coord.get(1).copied().unwrap_or(0.0),
            ]
        })
        .collect();
    let active_creases = document
        .edges_assignment
        .iter()
        .enumerate()
        .filter_map(|(edge, assignment)| {
            matches!(assignment, Assignment::Mountain | Assignment::Valley).then_some(edge)
        })
        .collect();
    SequenceState {
        id: id.into(),
        document,
        active_creases,
        face_orders: Vec::new(),
        folded_vertices,
        unresolved_regions: Vec::new(),
        provenance: StateProvenance::input(),
        layer_order_policy: LayerOrderPolicy::Preserved,
        diagnostics: Vec::new(),
    }
}

fn manual_collapse_step(
    before_state: String,
    after_state: String,
    unresolved_regions: &[UnresolvedRegion],
) -> InstructionStep {
    let mut affected_creases = unresolved_regions
        .iter()
        .flat_map(|region| region.creases.iter().copied())
        .collect::<Vec<_>>();
    affected_creases.sort_unstable();
    affected_creases.dedup();
    let mut affected_faces = unresolved_regions
        .iter()
        .flat_map(|region| region.faces.iter().copied())
        .collect::<Vec<_>>();
    affected_faces.sort_unstable();
    affected_faces.dedup();
    let mut details = StepDetails::new(
        "manual-collapse",
        "Collapse up until this point",
        before_state,
        after_state,
    );
    details.affected_creases = affected_creases;
    details.affected_faces = affected_faces;
    details.metadata = MoveMetadata {
        difficulty: MoveDifficulty::Complex,
        layer_mode: LayerMode::Simultaneous,
        confidence: 0.0,
        notes: vec![
            "not decomposed into validated folds; this marks an explicit planner boundary"
                .to_string(),
        ],
    };
    details.diagnostics = vec![SequenceDiagnostic::warning(
        "manual_collapse_required",
        "planner could not solve this highlighted region from the flat crease pattern",
    )];
    details.certificate = Some(StepCertificate::manual(
        details.affected_creases.clone(),
        details.affected_faces.clone(),
        details.diagnostics.clone(),
    ));
    InstructionStep::ManualCollapse(details)
}

fn normalize_sequence_ids(states: &mut [SequenceState], steps: &mut [InstructionStep]) {
    let mut id_map = HashMap::new();
    let last_index = states.len().saturating_sub(1);
    let has_flat_start = states.first().is_some_and(|state| state.id == "flat-cp");
    for (index, state) in states.iter_mut().enumerate() {
        let old_id = state.id.clone();
        let new_id = if index == 0 && has_flat_start {
            "flat-cp".to_string()
        } else if index == last_index {
            "target".to_string()
        } else {
            let state_number = if has_flat_start { index } else { index + 1 };
            format!("state-{state_number}")
        };
        state.id = new_id.clone();
        id_map.insert(old_id, new_id);
    }

    for state in states {
        if let Some(predecessor) = &mut state.provenance.predecessor
            && let Some(mapped) = id_map.get(predecessor)
        {
            *predecessor = mapped.clone();
        }
    }
    for (index, step) in steps.iter_mut().enumerate() {
        rewrite_step_state_ids(step, &id_map);
        set_step_id(step, format!("step-{}", index + 1));
    }
}

fn rewrite_step_state_ids(step: &mut InstructionStep, id_map: &HashMap<String, String>) {
    match step {
        InstructionStep::PrecreaseRegion(details)
        | InstructionStep::SimpleFold(details)
        | InstructionStep::ReverseFold(details)
        | InstructionStep::SquashFold(details)
        | InstructionStep::RabbitEar(details)
        | InstructionStep::MoleculeCollapse(details)
        | InstructionStep::LocalCollapse(details)
        | InstructionStep::SimultaneousCollapse(details)
        | InstructionStep::ManualCollapse(details) => {
            rewrite_state_reference(&mut details.before_state, id_map);
            rewrite_state_reference(&mut details.after_state, id_map);
        }
        InstructionStep::ManualChoice(step) => {
            rewrite_state_reference(&mut step.before_state, id_map);
        }
        InstructionStep::UnsupportedRegion(step) => {
            rewrite_state_reference(&mut step.before_state, id_map);
            if let Some(after_state) = &mut step.after_state {
                rewrite_state_reference(after_state, id_map);
            }
        }
    }
}

fn rewrite_state_reference(value: &mut String, id_map: &HashMap<String, String>) {
    if let Some(mapped) = id_map.get(value) {
        *value = mapped.clone();
    }
}

pub fn plan_reference_precreases(document: &FoldDocument) -> Result<ReferencePlan> {
    plan_reference_precreases_with_options(document, ReferencePlanOptions::default())
}

pub fn plan_reference_precreases_with_options(
    document: &FoldDocument,
    _options: ReferencePlanOptions,
) -> Result<ReferencePlan> {
    validate_basic(document).map_err(|error| SequenceError::InvalidInput(error.to_string()))?;
    Err(SequenceError::NotImplemented(
        "V2 ReferenceFinder-style reference/precrease planner",
    ))
}

pub fn trace_plan(plan: &SequencePlan) -> PlannerTrace {
    PlannerTrace {
        schema_version: 1,
        planner_version: env!("CARGO_PKG_VERSION").to_string(),
        status: plan.status.clone(),
        score: plan.score(),
        search: plan.search.clone(),
        candidates: plan
            .steps
            .iter()
            .enumerate()
            .map(|(index, step)| trace_candidate_for_step(index, step, plan))
            .collect(),
        diagnostics: plan
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.clone())
            .collect(),
        ml_decision: ml_readiness_decision(1, usize::from(plan.status == PlanStatus::Complete)),
    }
}

pub fn ml_readiness_decision(total_traces: usize, complete_traces: usize) -> MlReadinessDecision {
    const MINIMUM_SUCCESSFUL_TRACES: usize = 500;
    if complete_traces >= MINIMUM_SUCCESSFUL_TRACES {
        MlReadinessDecision {
            recommendation: MlRecommendation::ConsiderOfflineRanker,
            reason:
                "enough successful symbolic traces exist to justify an offline ranking experiment"
                    .to_string(),
            minimum_successful_traces: MINIMUM_SUCCESSFUL_TRACES,
        }
    } else if total_traces > 0 {
        MlReadinessDecision {
            recommendation: MlRecommendation::CollectMoreTraces,
            reason: "symbolic planner traces are useful, but the successful trace count is still too small for ML"
                .to_string(),
            minimum_successful_traces: MINIMUM_SUCCESSFUL_TRACES,
        }
    } else {
        MlReadinessDecision {
            recommendation: MlRecommendation::KeepSymbolic,
            reason: "no validated trace corpus exists yet; ML must not affect production behavior"
                .to_string(),
            minimum_successful_traces: MINIMUM_SUCCESSFUL_TRACES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Complete,
    Partial,
    Unsupported,
    InvalidInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SequencePlan {
    pub status: PlanStatus,
    pub steps: Vec<InstructionStep>,
    pub states: Vec<SequenceState>,
    pub diagnostics: Vec<SequenceDiagnostic>,
    pub unresolved_regions: Vec<UnresolvedRegion>,
    pub search: SearchStats,
}

impl SequencePlan {
    pub fn score(&self) -> PlanScore {
        PlanScore {
            unresolved_creases: self
                .unresolved_regions
                .iter()
                .map(|region| region.creases.len())
                .sum(),
            unresolved_regions: self.unresolved_regions.len(),
            unsupported_steps: self
                .steps
                .iter()
                .filter(|step| {
                    matches!(
                        step,
                        InstructionStep::ManualCollapse(_) | InstructionStep::UnsupportedRegion(_)
                    )
                })
                .count(),
            total_steps: self.steps.len(),
            layer_order_ambiguity: self
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.code == "ambiguous_layer_order")
                .count(),
            simultaneous_candidates: self
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.code == "simultaneous_collapse_unsupported")
                .count(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchStats {
    pub states_explored: usize,
    pub branches_pruned: usize,
    pub repeated_states: usize,
    pub timed_out: bool,
    pub budget_exhausted: bool,
    pub best_unresolved_creases: usize,
    pub target_solves: usize,
    pub target_solve_cache_hits: usize,
    pub duplicate_candidates_pruned: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SequencePlanOptions {
    pub max_steps: usize,
    pub max_states: usize,
}

impl Default for SequencePlanOptions {
    fn default() -> Self {
        Self {
            max_steps: 64,
            max_states: 1024,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PlanScore {
    pub unresolved_creases: usize,
    pub unresolved_regions: usize,
    pub unsupported_steps: usize,
    pub total_steps: usize,
    pub layer_order_ambiguity: usize,
    pub simultaneous_candidates: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlannerTrace {
    pub schema_version: u32,
    pub planner_version: String,
    pub status: PlanStatus,
    pub score: PlanScore,
    pub search: SearchStats,
    pub candidates: Vec<TraceCandidate>,
    pub diagnostics: Vec<String>,
    pub ml_decision: MlReadinessDecision,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraceCandidate {
    pub step_id: String,
    pub kind: String,
    pub affected_creases: Vec<usize>,
    pub accepted: bool,
    pub unresolved_after: usize,
    pub certificate_status: Option<CertificateStatus>,
    pub recognizer: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MlReadinessDecision {
    pub recommendation: MlRecommendation,
    pub reason: String,
    pub minimum_successful_traces: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MlRecommendation {
    KeepSymbolic,
    CollectMoreTraces,
    ConsiderOfflineRanker,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReferencePlanOptions {
    pub max_axiom_depth: usize,
}

impl Default for ReferencePlanOptions {
    fn default() -> Self {
        Self { max_axiom_depth: 6 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferencePlanStatus {
    Complete,
    Partial,
    NotImplemented,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReferencePlan {
    pub status: ReferencePlanStatus,
    pub steps: Vec<ReferenceConstructionStep>,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReferenceConstructionStep {
    ReferenceFold {
        id: String,
        label: String,
        axiom: String,
        target_creases: Vec<usize>,
    },
    PrecreaseRegion {
        id: String,
        label: String,
        creases: Vec<usize>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimpleFoldRule {
    pub crease: usize,
    pub faces: Vec<usize>,
    pub assignment: Assignment,
    pub proof: SimpleFoldProof,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimpleFoldProof {
    BoundaryEndpoints,
    FaceGraphSeparation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComplexMoveKind {
    ReverseFold,
    SquashFold,
    RabbitEar,
    MoleculeCollapse,
    SimultaneousCollapse,
}

impl ComplexMoveKind {
    fn diagnostic_code(&self) -> &'static str {
        match self {
            ComplexMoveKind::ReverseFold => "reverse_fold_not_implemented",
            ComplexMoveKind::SquashFold => "squash_fold_not_implemented",
            ComplexMoveKind::RabbitEar => "rabbit_ear_not_implemented",
            ComplexMoveKind::MoleculeCollapse => "molecule_collapse_not_implemented",
            ComplexMoveKind::SimultaneousCollapse => "simultaneous_collapse_unsupported",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComplexMoveCandidate {
    pub kind: ComplexMoveKind,
    pub center_vertex: Option<usize>,
    pub creases: Vec<usize>,
    pub faces: Vec<usize>,
    pub metadata: MoveMetadata,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComplexTransformStatus {
    Applied,
    Unsupported,
    InvalidCandidate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComplexTransformResult {
    pub status: ComplexTransformStatus,
    pub candidate: ComplexMoveCandidate,
    pub before_state: String,
    pub after_state: Option<SequenceState>,
    pub step: Option<InstructionStep>,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SequenceState {
    pub id: String,
    pub document: FoldDocument,
    pub active_creases: Vec<usize>,
    pub face_orders: Vec<[i64; 3]>,
    pub folded_vertices: Vec<[f64; 2]>,
    pub unresolved_regions: Vec<UnresolvedRegion>,
    pub provenance: StateProvenance,
    pub layer_order_policy: LayerOrderPolicy,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

impl SequenceState {
    pub fn from_target(id: impl Into<String>, target: &TargetState) -> Self {
        let active_creases = target
            .normalized
            .edges_assignment
            .iter()
            .enumerate()
            .filter_map(|(edge, assignment)| {
                matches!(assignment, Assignment::Mountain | Assignment::Valley).then_some(edge)
            })
            .collect();
        Self {
            id: id.into(),
            document: target.normalized.clone(),
            active_creases,
            face_orders: target.face_orders.clone(),
            folded_vertices: target.folded_vertices.clone(),
            unresolved_regions: Vec::new(),
            provenance: StateProvenance::target_state(target.selected_solution_index),
            layer_order_policy: LayerOrderPolicy::Preserved,
            diagnostics: target.diagnostics.clone(),
        }
    }

    pub fn to_frame(&self) -> TargetFrame {
        TargetFrame {
            document: self.document.clone(),
            face_orders: self.face_orders.clone(),
        }
    }

    pub fn validate(&self) -> Result<ValidationReport> {
        validate_sequence_state(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateProvenance {
    pub source: StateSource,
    pub selected_solution_index: Option<usize>,
    pub predecessor: Option<String>,
    pub step_id: Option<String>,
}

impl StateProvenance {
    pub fn input() -> Self {
        Self {
            source: StateSource::Input,
            selected_solution_index: None,
            predecessor: None,
            step_id: None,
        }
    }

    pub fn target_state(selected_solution_index: usize) -> Self {
        Self {
            source: StateSource::TargetState,
            selected_solution_index: Some(selected_solution_index),
            predecessor: None,
            step_id: None,
        }
    }

    pub fn rewrite(predecessor: impl Into<String>, step_id: impl Into<String>) -> Self {
        Self {
            source: StateSource::Rewrite,
            selected_solution_index: None,
            predecessor: Some(predecessor.into()),
            step_id: Some(step_id.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StateSource {
    Input,
    TargetState,
    Rewrite,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerOrderPolicy {
    Preserved,
    RelaxedWithDiagnostic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnresolvedRegion {
    pub id: String,
    pub creases: Vec<usize>,
    pub faces: Vec<usize>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InstructionStep {
    PrecreaseRegion(StepDetails),
    SimpleFold(StepDetails),
    ReverseFold(StepDetails),
    SquashFold(StepDetails),
    RabbitEar(StepDetails),
    MoleculeCollapse(StepDetails),
    LocalCollapse(StepDetails),
    SimultaneousCollapse(StepDetails),
    ManualCollapse(StepDetails),
    ManualChoice(ManualChoiceStep),
    UnsupportedRegion(UnsupportedRegionStep),
}

impl InstructionStep {
    pub fn id(&self) -> &str {
        match self {
            InstructionStep::PrecreaseRegion(details)
            | InstructionStep::SimpleFold(details)
            | InstructionStep::ReverseFold(details)
            | InstructionStep::SquashFold(details)
            | InstructionStep::RabbitEar(details)
            | InstructionStep::MoleculeCollapse(details)
            | InstructionStep::LocalCollapse(details)
            | InstructionStep::SimultaneousCollapse(details)
            | InstructionStep::ManualCollapse(details) => &details.id,
            InstructionStep::ManualChoice(step) => &step.id,
            InstructionStep::UnsupportedRegion(step) => &step.id,
        }
    }

    pub fn certificate(&self) -> Option<&StepCertificate> {
        match self {
            InstructionStep::PrecreaseRegion(details)
            | InstructionStep::SimpleFold(details)
            | InstructionStep::ReverseFold(details)
            | InstructionStep::SquashFold(details)
            | InstructionStep::RabbitEar(details)
            | InstructionStep::MoleculeCollapse(details)
            | InstructionStep::LocalCollapse(details)
            | InstructionStep::SimultaneousCollapse(details)
            | InstructionStep::ManualCollapse(details) => details.certificate.as_ref(),
            InstructionStep::ManualChoice(_) | InstructionStep::UnsupportedRegion(_) => None,
        }
    }
}

pub fn inspect_step_certificate(step: &InstructionStep) -> Vec<SequenceDiagnostic> {
    let Some(certificate) = step.certificate() else {
        return Vec::new();
    };
    let mut diagnostics = certificate.diagnostics.clone();
    for check in certificate
        .preconditions
        .iter()
        .chain(certificate.postconditions.iter())
    {
        if check.status == CertificateCheckStatus::Failed {
            diagnostics.push(SequenceDiagnostic::error(
                "step_certificate_failed_check",
                format!("{} failed: {}", check.code, check.message),
            ));
        }
    }
    if certificate.status == CertificateStatus::Verified
        && certificate
            .preconditions
            .iter()
            .chain(certificate.postconditions.iter())
            .any(|check| {
                matches!(
                    check.status,
                    CertificateCheckStatus::Warning | CertificateCheckStatus::NotChecked
                )
            })
    {
        diagnostics.push(SequenceDiagnostic::warning(
            "verified_certificate_has_uncertain_check",
            "verified certificates should not contain warning or not_checked checks",
        ));
    }
    if certificate.layer_order.policy == LayerOrderPolicy::Preserved
        && !certificate.layer_order.preserved
    {
        diagnostics.push(SequenceDiagnostic::error(
            "step_certificate_layer_order_conflict",
            "certificate says layer-order policy is preserved but preserved is false",
        ));
    }
    diagnostics
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StepDetails {
    pub id: String,
    pub label: String,
    pub affected_creases: Vec<usize>,
    pub affected_faces: Vec<usize>,
    pub before_state: String,
    pub after_state: String,
    pub metadata: MoveMetadata,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certificate: Option<StepCertificate>,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

impl StepDetails {
    pub fn new(
        id: impl Into<String>,
        label: impl Into<String>,
        before_state: impl Into<String>,
        after_state: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            affected_creases: Vec::new(),
            affected_faces: Vec::new(),
            before_state: before_state.into(),
            after_state: after_state.into(),
            metadata: MoveMetadata::default(),
            certificate: None,
            diagnostics: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StepCertificate {
    pub status: CertificateStatus,
    pub recognizer: String,
    pub checked_creases: Vec<usize>,
    pub checked_faces: Vec<usize>,
    pub preconditions: Vec<CertificateCheck>,
    pub postconditions: Vec<CertificateCheck>,
    pub layer_order: LayerOrderCertificate,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

impl StepCertificate {
    fn simple_fold(rule: &SimpleFoldRule) -> Self {
        let (recognizer, proof_check) = match rule.proof {
            SimpleFoldProof::BoundaryEndpoints => (
                "boundary_simple_fold",
                CertificateCheck::passed(
                    "boundary_endpoints",
                    format!("crease {} has boundary endpoints", rule.crease),
                ),
            ),
            SimpleFoldProof::FaceGraphSeparation => (
                "face_graph_simple_fold",
                CertificateCheck::passed(
                    "face_graph_separation",
                    format!(
                        "removing crease {} separates the face adjacency graph",
                        rule.crease
                    ),
                ),
            ),
        };
        Self {
            status: CertificateStatus::Verified,
            recognizer: recognizer.to_string(),
            checked_creases: vec![rule.crease],
            checked_faces: rule.faces.clone(),
            preconditions: vec![
                CertificateCheck::passed(
                    "active_mv_crease",
                    format!(
                        "crease {} is active with {} assignment",
                        rule.crease,
                        rule.assignment.as_str()
                    ),
                ),
                CertificateCheck::passed(
                    "two_adjacent_faces",
                    format!("crease {} has two adjacent faces", rule.crease),
                ),
                proof_check,
            ],
            postconditions: vec![
                CertificateCheck::passed(
                    "crease_deactivated",
                    format!("crease {} is reset in the reverse state", rule.crease),
                ),
                CertificateCheck::passed(
                    "target_resolved",
                    "reverse state resolved through the flat-fold target solver",
                ),
            ],
            layer_order: LayerOrderCertificate::preserved(),
            diagnostics: Vec::new(),
        }
    }

    fn heuristic_complex(candidate: &ComplexMoveCandidate) -> Self {
        Self {
            status: CertificateStatus::Heuristic,
            recognizer: format!(
                "topology_only_{}",
                complex_kind_label(&candidate.kind).replace(' ', "_")
            ),
            checked_creases: candidate.creases.clone(),
            checked_faces: candidate.faces.clone(),
            preconditions: vec![
                CertificateCheck::passed(
                    "active_mv_group",
                    "candidate creases are active mountain/valley creases",
                ),
                CertificateCheck::passed(
                    "interior_center_vertex",
                    "candidate is grouped around an interior vertex",
                ),
                CertificateCheck::warning(
                    "move_specific_geometry_not_checked",
                    "sector geometry and named-move kinematics are not yet certified",
                ),
            ],
            postconditions: vec![
                CertificateCheck::passed(
                    "candidate_creases_deactivated",
                    "candidate creases are reset in the reverse state",
                ),
                CertificateCheck::passed(
                    "target_resolved",
                    "reverse state resolved through the flat-fold target solver",
                ),
                CertificateCheck::warning(
                    "macro_move_not_decomposed",
                    "accepted as a macro step without lower-level sub-fold certificates",
                ),
            ],
            layer_order: LayerOrderCertificate::preserved(),
            diagnostics: vec![SequenceDiagnostic::warning(
                "heuristic_step_certificate",
                "step is accepted by topology and target resolution, but the named move is not geometrically certified yet",
            )],
        }
    }

    fn manual(
        checked_creases: Vec<usize>,
        checked_faces: Vec<usize>,
        diagnostics: Vec<SequenceDiagnostic>,
    ) -> Self {
        Self {
            status: CertificateStatus::Manual,
            recognizer: "manual_collapse_boundary".to_string(),
            checked_creases,
            checked_faces,
            preconditions: vec![CertificateCheck::warning(
                "planner_boundary",
                "planner could not certify a deterministic fold decomposition for this region",
            )],
            postconditions: vec![CertificateCheck::not_checked(
                "manual_result",
                "manual collapse result is represented by the next planned state",
            )],
            layer_order: LayerOrderCertificate::preserved(),
            diagnostics,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CertificateStatus {
    Verified,
    Heuristic,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CertificateCheck {
    pub code: String,
    pub status: CertificateCheckStatus,
    pub message: String,
}

impl CertificateCheck {
    pub fn passed(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            status: CertificateCheckStatus::Passed,
            message: message.into(),
        }
    }

    pub fn warning(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            status: CertificateCheckStatus::Warning,
            message: message.into(),
        }
    }

    pub fn failed(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            status: CertificateCheckStatus::Failed,
            message: message.into(),
        }
    }

    pub fn not_checked(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            status: CertificateCheckStatus::NotChecked,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CertificateCheckStatus {
    Passed,
    Warning,
    Failed,
    NotChecked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LayerOrderCertificate {
    pub policy: LayerOrderPolicy,
    pub preserved: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

impl LayerOrderCertificate {
    fn preserved() -> Self {
        Self {
            policy: LayerOrderPolicy::Preserved,
            preserved: true,
            diagnostic: None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MoveMetadata {
    pub difficulty: MoveDifficulty,
    pub layer_mode: LayerMode,
    pub confidence: f64,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoveDifficulty {
    #[default]
    Unknown,
    Simple,
    Intermediate,
    Complex,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerMode {
    #[default]
    Unknown,
    SingleLayer,
    MultiLayer,
    Simultaneous,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManualChoiceStep {
    pub id: String,
    pub label: String,
    pub before_state: String,
    pub choices: Vec<ManualChoice>,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManualChoice {
    pub id: String,
    pub label: String,
    pub affected_creases: Vec<usize>,
    pub affected_faces: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnsupportedRegionStep {
    pub id: String,
    pub label: String,
    pub before_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_state: Option<String>,
    pub region: UnresolvedRegion,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationReport {
    pub state_id: String,
    pub diagnostics: Vec<SequenceDiagnostic>,
}

impl ValidationReport {
    pub fn is_valid(&self) -> bool {
        !self
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
    }
}

pub fn inspect_sequence_state(state: &SequenceState) -> ValidationReport {
    let mut diagnostics = Vec::new();

    if let Err(error) = validate_basic(&state.document) {
        diagnostics.push(SequenceDiagnostic::error(
            "invalid_fold_topology",
            error.to_string(),
        ));
    }
    if !state.document.faces_vertices.is_empty()
        && let Err(error) = build_faces_edges(&state.document)
    {
        diagnostics.push(SequenceDiagnostic::error(
            "invalid_face_cycles",
            error.to_string(),
        ));
    }
    let edge_count = state.document.edges_vertices.len();
    for crease in &state.active_creases {
        if *crease >= edge_count {
            diagnostics.push(SequenceDiagnostic::error(
                "active_crease_out_of_bounds",
                format!("active crease {crease} is outside edge range 0..{edge_count}"),
            ));
            continue;
        }
        let assignment = state.document.assignment_for_edge(*crease);
        if !assignment.is_driven_crease() {
            diagnostics.push(SequenceDiagnostic::error(
                "active_crease_not_driven",
                format!(
                    "active crease {crease} has assignment {}; expected M, V, or F",
                    assignment.as_str()
                ),
            ));
        }
    }
    validate_folded_vertices(state, &mut diagnostics);
    validate_face_orders(state, &mut diagnostics);
    validate_unresolved_regions(state, &mut diagnostics);

    if state.layer_order_policy == LayerOrderPolicy::RelaxedWithDiagnostic
        && !state
            .diagnostics
            .iter()
            .chain(diagnostics.iter())
            .any(|diagnostic| diagnostic.code == "layer_order_relaxed")
    {
        diagnostics.push(SequenceDiagnostic::error(
            "missing_layer_order_relaxed_diagnostic",
            "layer_order_policy is relaxed, but no layer_order_relaxed diagnostic explains why",
        ));
    }

    ValidationReport {
        state_id: state.id.clone(),
        diagnostics,
    }
}

pub fn validate_sequence_state(state: &SequenceState) -> Result<ValidationReport> {
    let report = inspect_sequence_state(state);
    if !report.is_valid() {
        return Err(SequenceError::InvalidState {
            diagnostics_len: report.diagnostics.len(),
        });
    }
    Ok(report)
}

pub fn detect_simple_fold(state: &SequenceState) -> Result<Option<SimpleFoldRule>> {
    Ok(choose_simple_fold(detect_simple_folds(state)?))
}

pub fn detect_simple_folds(state: &SequenceState) -> Result<Vec<SimpleFoldRule>> {
    let edges_faces = if state.document.edges_faces.is_empty() {
        build_edges_faces(&state.document)
            .map_err(|error| SequenceError::InvalidInput(error.to_string()))?
    } else {
        state.document.edges_faces.clone()
    };
    let boundary_vertices = boundary_vertex_flags(&state.document);
    let mut active_creases = state.active_creases.clone();
    active_creases.sort_unstable();
    let mut out = Vec::new();
    for crease in active_creases {
        let assignment = state.document.assignment_for_edge(crease);
        if !matches!(assignment, Assignment::Mountain | Assignment::Valley) {
            continue;
        }
        let Some([a, b]) = state.document.edges_vertices.get(crease).copied() else {
            continue;
        };
        let faces = edges_faces.get(crease).cloned().unwrap_or_default();
        if faces.len() != 2 {
            continue;
        }
        let proof = if boundary_vertices.get(a).copied().unwrap_or(false)
            && boundary_vertices.get(b).copied().unwrap_or(false)
        {
            Some(SimpleFoldProof::BoundaryEndpoints)
        } else if crease_separates_face_graph(
            crease,
            &edges_faces,
            state.document.faces_vertices.len(),
        ) {
            Some(SimpleFoldProof::FaceGraphSeparation)
        } else {
            None
        };
        if let Some(proof) = proof {
            out.push(SimpleFoldRule {
                crease,
                faces,
                assignment,
                proof,
            });
        }
    }
    out.sort_by_key(simple_fold_sort_key);
    Ok(out)
}

fn choose_simple_fold(mut simple_folds: Vec<SimpleFoldRule>) -> Option<SimpleFoldRule> {
    simple_folds.sort_by_key(simple_fold_sort_key);
    simple_folds.into_iter().next()
}

fn simple_fold_sort_key(rule: &SimpleFoldRule) -> (usize, usize, u8, u8) {
    let assignment_rank = match rule.assignment {
        Assignment::Valley => 0,
        Assignment::Mountain => 1,
        _ => 2,
    };
    let proof_rank = match rule.proof {
        SimpleFoldProof::BoundaryEndpoints => 0,
        SimpleFoldProof::FaceGraphSeparation => 1,
    };
    (rule.faces.len(), rule.crease, assignment_rank, proof_rank)
}

fn crease_separates_face_graph(
    crease: usize,
    edges_faces: &[Vec<usize>],
    face_count: usize,
) -> bool {
    let Some(faces) = edges_faces.get(crease) else {
        return false;
    };
    let [start, target] = faces.as_slice() else {
        return false;
    };
    if start == target || *start >= face_count || *target >= face_count {
        return false;
    }

    let mut visited = vec![false; face_count];
    let mut stack = vec![*start];
    visited[*start] = true;
    while let Some(face) = stack.pop() {
        for (edge, adjacent_faces) in edges_faces.iter().enumerate() {
            if edge == crease || adjacent_faces.len() != 2 || !adjacent_faces.contains(&face) {
                continue;
            }
            for neighbor in adjacent_faces {
                if *neighbor < face_count && !visited[*neighbor] {
                    visited[*neighbor] = true;
                    stack.push(*neighbor);
                }
            }
        }
    }
    !visited[*target]
}

pub fn recognize_complex_moves(state: &SequenceState) -> Result<Vec<ComplexMoveCandidate>> {
    if state.active_creases.is_empty() {
        return Ok(Vec::new());
    }
    let edges_faces = if state.document.edges_faces.is_empty() {
        build_edges_faces(&state.document)
            .map_err(|error| SequenceError::InvalidInput(error.to_string()))?
    } else {
        state.document.edges_faces.clone()
    };
    let boundary_vertices = boundary_vertex_flags(&state.document);
    let mut active_by_vertex = vec![Vec::new(); state.document.vertices_coords.len()];
    for crease in &state.active_creases {
        let Some([a, b]) = state.document.edges_vertices.get(*crease).copied() else {
            continue;
        };
        if let Some(creases) = active_by_vertex.get_mut(a) {
            creases.push(*crease);
        }
        if let Some(creases) = active_by_vertex.get_mut(b) {
            creases.push(*crease);
        }
    }

    let mut candidates = Vec::new();
    for (vertex, creases) in active_by_vertex.into_iter().enumerate() {
        if boundary_vertices.get(vertex).copied().unwrap_or(false) || creases.len() < 3 {
            continue;
        }
        let kind = classify_complex_candidate(state, &creases);
        let mut faces = Vec::new();
        for crease in &creases {
            if let Some(edge_faces) = edges_faces.get(*crease) {
                faces.extend(edge_faces.iter().copied());
            }
        }
        faces.sort_unstable();
        faces.dedup();
        candidates.push(ComplexMoveCandidate {
            kind: kind.clone(),
            center_vertex: Some(vertex),
            creases,
            faces,
            metadata: MoveMetadata {
                difficulty: match kind {
                    ComplexMoveKind::ReverseFold => MoveDifficulty::Intermediate,
                    ComplexMoveKind::SquashFold
                    | ComplexMoveKind::RabbitEar
                    | ComplexMoveKind::MoleculeCollapse
                    | ComplexMoveKind::SimultaneousCollapse => MoveDifficulty::Complex,
                },
                layer_mode: match kind {
                    ComplexMoveKind::SimultaneousCollapse => LayerMode::Simultaneous,
                    ComplexMoveKind::ReverseFold
                    | ComplexMoveKind::SquashFold
                    | ComplexMoveKind::RabbitEar => LayerMode::MultiLayer,
                    ComplexMoveKind::MoleculeCollapse => LayerMode::Simultaneous,
                },
                confidence: 0.6,
                notes: vec![
                    "topology-only recognition; transform intentionally not implemented"
                        .to_string(),
                ],
            },
            diagnostics: vec![SequenceDiagnostic::warning(
                kind.diagnostic_code(),
                "recognized complex move pattern, but no validated rewrite exists yet",
            )],
        });
    }
    candidates.sort_by_key(|candidate| {
        (
            complex_kind_rank(&candidate.kind),
            candidate.center_vertex.unwrap_or(usize::MAX),
        )
    });
    Ok(candidates)
}

pub fn apply_complex_transform(
    state: &SequenceState,
    next_state_id: &str,
    candidate: &ComplexMoveCandidate,
) -> Result<ComplexTransformResult> {
    let diagnostics = inspect_complex_transform_candidate(state, candidate);
    if diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
    {
        return Ok(ComplexTransformResult {
            status: ComplexTransformStatus::InvalidCandidate,
            candidate: candidate.clone(),
            before_state: state.id.clone(),
            after_state: None,
            step: None,
            diagnostics,
        });
    }

    if local_complex_transform_is_supported(state, candidate) {
        return apply_reverse_complex_group(state, next_state_id, candidate, diagnostics);
    }

    Ok(unsupported_complex_transform_result(
        state,
        candidate,
        diagnostics,
    ))
}

fn apply_complex_transform_with_context(
    state: &SequenceState,
    context: &mut PlanningContext,
    candidate: &ComplexMoveCandidate,
) -> Result<ComplexTransformResult> {
    let diagnostics = inspect_complex_transform_candidate(state, candidate);
    if diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
    {
        return Ok(ComplexTransformResult {
            status: ComplexTransformStatus::InvalidCandidate,
            candidate: candidate.clone(),
            before_state: state.id.clone(),
            after_state: None,
            step: None,
            diagnostics,
        });
    }

    if !local_complex_transform_is_supported(state, candidate) {
        return Ok(unsupported_complex_transform_result(
            state,
            candidate,
            diagnostics,
        ));
    }

    let document = document_with_creases_reset(state, &candidate.creases);
    if context.document_key_is_seen(&document) {
        return Ok(ComplexTransformResult {
            status: ComplexTransformStatus::Unsupported,
            candidate: candidate.clone(),
            before_state: state.id.clone(),
            after_state: None,
            step: None,
            diagnostics,
        });
    }
    let next_state_id = context.next_state_id();
    apply_reverse_complex_group_with_context(
        state,
        &next_state_id,
        candidate,
        diagnostics,
        document,
        context,
    )
}

fn unsupported_complex_transform_result(
    state: &SequenceState,
    candidate: &ComplexMoveCandidate,
    mut diagnostics: Vec<SequenceDiagnostic>,
) -> ComplexTransformResult {
    let diagnostic_code = match candidate.kind {
        ComplexMoveKind::SimultaneousCollapse => candidate.kind.diagnostic_code(),
        _ => "complex_transform_unsupported",
    };
    diagnostics.push(SequenceDiagnostic::warning(
        diagnostic_code,
        format!(
            "{:?} pattern recognized for creases {:?}, but this move is outside the currently validated local transform set",
            candidate.kind, candidate.creases
        ),
    ));

    ComplexTransformResult {
        status: ComplexTransformStatus::Unsupported,
        candidate: candidate.clone(),
        before_state: state.id.clone(),
        after_state: None,
        step: None,
        diagnostics,
    }
}

fn local_complex_transform_is_supported(
    state: &SequenceState,
    candidate: &ComplexMoveCandidate,
) -> bool {
    matches!(
        candidate.kind,
        ComplexMoveKind::ReverseFold
            | ComplexMoveKind::SquashFold
            | ComplexMoveKind::RabbitEar
            | ComplexMoveKind::MoleculeCollapse
    ) && candidate_creases_are_active(state, candidate)
}

fn candidate_creases_are_active(state: &SequenceState, candidate: &ComplexMoveCandidate) -> bool {
    candidate
        .creases
        .iter()
        .all(|crease| state.active_creases.contains(crease))
}

fn apply_reverse_complex_group(
    state: &SequenceState,
    next_state_id: &str,
    candidate: &ComplexMoveCandidate,
    mut diagnostics: Vec<SequenceDiagnostic>,
) -> Result<ComplexTransformResult> {
    let document = document_with_creases_reset(state, &candidate.creases);
    let target = match resolve_target_state(&document, TargetStateOptions::default()) {
        Ok(target) => target,
        Err(error) => {
            diagnostics.push(SequenceDiagnostic::warning(
                "complex_transform_target_solve_failed",
                format!(
                    "{:?} candidate could not be accepted because the reverse state failed target resolution: {error}",
                    candidate.kind
                ),
            ));
            return Ok(ComplexTransformResult {
                status: ComplexTransformStatus::Unsupported,
                candidate: candidate.clone(),
                before_state: state.id.clone(),
                after_state: None,
                step: None,
                diagnostics,
            });
        }
    };

    finish_reverse_complex_group(state, next_state_id, candidate, diagnostics, &target)
}

fn apply_reverse_complex_group_with_context(
    state: &SequenceState,
    next_state_id: &str,
    candidate: &ComplexMoveCandidate,
    mut diagnostics: Vec<SequenceDiagnostic>,
    document: FoldDocument,
    context: &mut PlanningContext,
) -> Result<ComplexTransformResult> {
    let target = match context.resolve_target(&document) {
        Ok(target) => target,
        Err(error) => {
            diagnostics.push(SequenceDiagnostic::warning(
                "complex_transform_target_solve_failed",
                format!(
                    "{:?} candidate could not be accepted because the reverse state failed target resolution: {error}",
                    candidate.kind
                ),
            ));
            return Ok(ComplexTransformResult {
                status: ComplexTransformStatus::Unsupported,
                candidate: candidate.clone(),
                before_state: state.id.clone(),
                after_state: None,
                step: None,
                diagnostics,
            });
        }
    };

    finish_reverse_complex_group(state, next_state_id, candidate, diagnostics, &target)
}

fn finish_reverse_complex_group(
    state: &SequenceState,
    next_state_id: &str,
    candidate: &ComplexMoveCandidate,
    mut diagnostics: Vec<SequenceDiagnostic>,
    target: &TargetState,
) -> Result<ComplexTransformResult> {
    let mut next = SequenceState::from_target(next_state_id.to_string(), target);
    next.provenance = StateProvenance::rewrite(
        &state.id,
        format!(
            "reverse-complex-{}",
            complex_kind_label(&candidate.kind).replace(' ', "-")
        ),
    );
    next.active_creases
        .retain(|crease| !candidate.creases.contains(crease));
    next.validate()?;

    diagnostics.push(SequenceDiagnostic::info(
        "complex_transform_applied",
        format!(
            "{:?} transform accepted as a heuristic local complex collapse over creases {:?}",
            candidate.kind, candidate.creases
        ),
    ));
    let step = complex_candidate_to_forward_step(candidate, next.id.clone(), state.id.clone());

    Ok(ComplexTransformResult {
        status: ComplexTransformStatus::Applied,
        candidate: candidate.clone(),
        before_state: state.id.clone(),
        after_state: Some(next),
        step: Some(step),
        diagnostics,
    })
}

pub fn inspect_complex_transform_candidate(
    state: &SequenceState,
    candidate: &ComplexMoveCandidate,
) -> Vec<SequenceDiagnostic> {
    let mut diagnostics = Vec::new();
    let edge_count = state.document.edges_vertices.len();
    let face_count = state.document.faces_vertices.len();
    let vertex_count = state.document.vertices_coords.len();

    if candidate.creases.is_empty() {
        diagnostics.push(SequenceDiagnostic::error(
            "complex_candidate_empty",
            "complex transform candidate has no creases",
        ));
    }
    if has_duplicates(&candidate.creases) {
        diagnostics.push(SequenceDiagnostic::error(
            "complex_candidate_duplicate_crease",
            "complex transform candidate contains duplicate creases",
        ));
    }
    if has_duplicates(&candidate.faces) {
        diagnostics.push(SequenceDiagnostic::error(
            "complex_candidate_duplicate_face",
            "complex transform candidate contains duplicate faces",
        ));
    }

    for crease in &candidate.creases {
        if *crease >= edge_count {
            diagnostics.push(SequenceDiagnostic::error(
                "complex_candidate_crease_out_of_bounds",
                format!("complex candidate crease {crease} is outside edge range 0..{edge_count}"),
            ));
            continue;
        }
        if !state.active_creases.contains(crease) {
            diagnostics.push(SequenceDiagnostic::error(
                "complex_candidate_crease_not_active",
                format!(
                    "complex candidate crease {crease} is not active in state {}",
                    state.id
                ),
            ));
        }
        let assignment = state.document.assignment_for_edge(*crease);
        if !matches!(assignment, Assignment::Mountain | Assignment::Valley) {
            diagnostics.push(SequenceDiagnostic::error(
                "complex_candidate_crease_not_mv",
                format!(
                    "complex candidate crease {crease} has assignment {}; expected M or V",
                    assignment.as_str()
                ),
            ));
        }
    }

    for face in &candidate.faces {
        if *face >= face_count {
            diagnostics.push(SequenceDiagnostic::error(
                "complex_candidate_face_out_of_bounds",
                format!("complex candidate face {face} is outside face range 0..{face_count}"),
            ));
        }
    }

    if let Some(vertex) = candidate.center_vertex {
        if vertex >= vertex_count {
            diagnostics.push(SequenceDiagnostic::error(
                "complex_candidate_center_out_of_bounds",
                format!("complex candidate center vertex {vertex} is outside vertex range 0..{vertex_count}"),
            ));
        } else if boundary_vertex_flags(&state.document)
            .get(vertex)
            .copied()
            .unwrap_or(false)
        {
            diagnostics.push(SequenceDiagnostic::error(
                "complex_candidate_center_on_boundary",
                format!("complex candidate center vertex {vertex} lies on the paper boundary"),
            ));
        }
    }

    diagnostics
}

fn classify_complex_candidate(state: &SequenceState, creases: &[usize]) -> ComplexMoveKind {
    match creases.len() {
        3 => ComplexMoveKind::ReverseFold,
        4 => ComplexMoveKind::RabbitEar,
        5..=6 => ComplexMoveKind::MoleculeCollapse,
        _ => {
            let valley_count = creases
                .iter()
                .filter(|crease| state.document.assignment_for_edge(**crease) == Assignment::Valley)
                .count();
            let mountain_count = creases.len().saturating_sub(valley_count);
            if valley_count > mountain_count {
                ComplexMoveKind::SimultaneousCollapse
            } else {
                ComplexMoveKind::SquashFold
            }
        }
    }
}

fn complex_kind_rank(kind: &ComplexMoveKind) -> usize {
    match kind {
        ComplexMoveKind::ReverseFold => 0,
        ComplexMoveKind::RabbitEar => 1,
        ComplexMoveKind::SquashFold => 2,
        ComplexMoveKind::MoleculeCollapse => 3,
        ComplexMoveKind::SimultaneousCollapse => 4,
    }
}

fn has_duplicates(values: &[usize]) -> bool {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    sorted.windows(2).any(|pair| pair[0] == pair[1])
}

fn apply_reverse_simple_fold_with_context(
    state: &SequenceState,
    next_state_id: &str,
    rule: &SimpleFoldRule,
    document: FoldDocument,
    context: &mut PlanningContext,
) -> Result<SequenceState> {
    let target = context.resolve_target(&document)?;
    let mut next = SequenceState::from_target(next_state_id.to_string(), &target);
    next.provenance =
        StateProvenance::rewrite(&state.id, format!("reverse-simple-{}", rule.crease));
    next.active_creases.retain(|crease| *crease != rule.crease);
    Ok(next)
}

fn document_with_creases_reset(state: &SequenceState, creases: &[usize]) -> FoldDocument {
    let mut document = state.document.clone();
    for crease in creases {
        if let Some(assignment) = document.edges_assignment.get_mut(*crease) {
            *assignment = Assignment::Flat;
        }
        if let Some(angle) = document.edges_fold_angle.get_mut(*crease) {
            *angle = Some(0.0);
        }
    }
    document
}

fn unresolved_regions_for_state(state: &SequenceState) -> Vec<UnresolvedRegion> {
    if state.active_creases.is_empty() {
        return Vec::new();
    }
    let edges_faces = if state.document.edges_faces.is_empty() {
        build_edges_faces(&state.document)
    } else {
        Ok(state.document.edges_faces.clone())
    };
    let edges_faces = edges_faces.unwrap_or_default();
    connected_active_crease_components(state)
        .into_iter()
        .enumerate()
        .map(|(index, creases)| {
            let mut faces = Vec::new();
            for crease in &creases {
                if let Some(edge_faces) = edges_faces.get(*crease) {
                    faces.extend(edge_faces.iter().copied());
                }
            }
            faces.sort_unstable();
            faces.dedup();
            UnresolvedRegion {
                id: format!("unresolved-{}", index + 1),
                reason: unresolved_region_reason(state, &creases),
                creases,
                faces,
            }
        })
        .collect()
}

fn connected_active_crease_components(state: &SequenceState) -> Vec<Vec<usize>> {
    let active_set = state.active_creases.iter().copied().collect::<HashSet<_>>();
    let mut active_creases = state.active_creases.clone();
    active_creases.sort_unstable();
    active_creases.dedup();
    let mut active_by_vertex = vec![Vec::new(); state.document.vertices_coords.len()];
    for crease in &active_creases {
        let Some([a, b]) = state.document.edges_vertices.get(*crease).copied() else {
            continue;
        };
        if let Some(creases) = active_by_vertex.get_mut(a) {
            creases.push(*crease);
        }
        if let Some(creases) = active_by_vertex.get_mut(b) {
            creases.push(*crease);
        }
    }

    let edges_faces = if state.document.edges_faces.is_empty() {
        build_edges_faces(&state.document)
    } else {
        Ok(state.document.edges_faces.clone())
    };
    let edges_faces = edges_faces.unwrap_or_default();
    let mut active_by_face = vec![Vec::new(); state.document.faces_vertices.len()];
    for crease in &state.active_creases {
        if let Some(edge_faces) = edges_faces.get(*crease) {
            for face in edge_faces {
                if let Some(creases) = active_by_face.get_mut(*face) {
                    creases.push(*crease);
                }
            }
        }
    }

    let mut visited = HashSet::new();
    let mut components = Vec::new();
    for start in active_creases {
        if !active_set.contains(&start) || !visited.insert(start) {
            continue;
        }
        let mut stack = vec![start];
        let mut component = Vec::new();
        while let Some(crease) = stack.pop() {
            component.push(crease);
            let Some([a, b]) = state.document.edges_vertices.get(crease).copied() else {
                continue;
            };
            for neighbor in active_by_vertex
                .get(a)
                .into_iter()
                .chain(active_by_vertex.get(b))
                .flat_map(|creases| creases.iter().copied())
            {
                if visited.insert(neighbor) {
                    stack.push(neighbor);
                }
            }
            if let Some(edge_faces) = edges_faces.get(crease) {
                for face in edge_faces {
                    for neighbor in active_by_face
                        .get(*face)
                        .into_iter()
                        .flat_map(|creases| creases.iter().copied())
                    {
                        if visited.insert(neighbor) {
                            stack.push(neighbor);
                        }
                    }
                }
            }
        }
        component.sort_unstable();
        component.dedup();
        components.push(component);
    }
    components.sort_by_key(|component| component.first().copied().unwrap_or(usize::MAX));
    components
}

fn unresolved_region_reason(state: &SequenceState, creases: &[usize]) -> String {
    if creases.len() == 1 {
        return "no validated simple-fold rewrite matches this crease".to_string();
    }
    if component_has_interior_complex_vertex(state, creases) {
        "connected region resembles a local complex move, but no certified transform matched"
            .to_string()
    } else {
        "no validated rewrite matches this connected crease region".to_string()
    }
}

fn component_has_interior_complex_vertex(state: &SequenceState, creases: &[usize]) -> bool {
    let boundary_vertices = boundary_vertex_flags(&state.document);
    let mut counts = vec![0usize; state.document.vertices_coords.len()];
    for crease in creases {
        let Some([a, b]) = state.document.edges_vertices.get(*crease).copied() else {
            continue;
        };
        if let Some(count) = counts.get_mut(a) {
            *count += 1;
        }
        if let Some(count) = counts.get_mut(b) {
            *count += 1;
        }
    }
    counts.into_iter().enumerate().any(|(vertex, count)| {
        count >= 3 && !boundary_vertices.get(vertex).copied().unwrap_or(false)
    })
}

fn boundary_vertex_flags(document: &FoldDocument) -> Vec<bool> {
    let mut flags = vec![false; document.vertices_coords.len()];
    for (edge_index, [a, b]) in document.edges_vertices.iter().copied().enumerate() {
        if document.assignment_for_edge(edge_index) == Assignment::Boundary {
            if let Some(flag) = flags.get_mut(a) {
                *flag = true;
            }
            if let Some(flag) = flags.get_mut(b) {
                *flag = true;
            }
        }
    }
    flags
}

impl SimpleFoldRule {
    fn to_forward_step(
        &self,
        index: usize,
        before_state: String,
        after_state: String,
    ) -> InstructionStep {
        let assignment = match self.assignment {
            Assignment::Mountain => "mountain",
            Assignment::Valley => "valley",
            Assignment::Flat => "flat",
            Assignment::Boundary | Assignment::Unassigned | Assignment::Cut | Assignment::Join => {
                "fold"
            }
        };
        let mut details = StepDetails::new(
            format!("step-{}", index + 1),
            format!("Make a {assignment} fold on crease {}", self.crease),
            before_state,
            after_state,
        );
        details.affected_creases = vec![self.crease];
        details.affected_faces = self.faces.clone();
        details.metadata = MoveMetadata {
            difficulty: MoveDifficulty::Simple,
            layer_mode: if self.faces.len() == 2 {
                LayerMode::SingleLayer
            } else {
                LayerMode::Unknown
            },
            confidence: 1.0,
            notes: Vec::new(),
        };
        details.certificate = Some(StepCertificate::simple_fold(self));
        InstructionStep::SimpleFold(details)
    }
}

fn complex_candidate_to_forward_step(
    candidate: &ComplexMoveCandidate,
    before_state: String,
    after_state: String,
) -> InstructionStep {
    let mut details = StepDetails::new(
        "complex-step",
        complex_step_label(candidate),
        before_state,
        after_state,
    );
    details.affected_creases = candidate.creases.clone();
    details.affected_faces = candidate.faces.clone();
    details.metadata = candidate.metadata.clone();
    details.metadata.confidence = details.metadata.confidence.max(0.7);
    details.metadata.notes.push(
        "accepted as a heuristic macro move; lower-level sub-folds are not decomposed".to_string(),
    );
    details.certificate = Some(StepCertificate::heuristic_complex(candidate));
    InstructionStep::LocalCollapse(details)
}

fn complex_step_label(candidate: &ComplexMoveCandidate) -> String {
    let center = candidate
        .center_vertex
        .map(|vertex| format!(" at vertex {vertex}"))
        .unwrap_or_default();
    format!(
        "Collapse a local {} candidate{}",
        complex_kind_label(&candidate.kind),
        center
    )
}

fn complex_kind_label(kind: &ComplexMoveKind) -> &'static str {
    match kind {
        ComplexMoveKind::ReverseFold => "reverse fold",
        ComplexMoveKind::SquashFold => "squash fold",
        ComplexMoveKind::RabbitEar => "rabbit ear",
        ComplexMoveKind::MoleculeCollapse => "molecule collapse",
        ComplexMoveKind::SimultaneousCollapse => "simultaneous collapse",
    }
}

fn set_step_id(step: &mut InstructionStep, id: String) {
    match step {
        InstructionStep::PrecreaseRegion(details)
        | InstructionStep::SimpleFold(details)
        | InstructionStep::ReverseFold(details)
        | InstructionStep::SquashFold(details)
        | InstructionStep::RabbitEar(details)
        | InstructionStep::MoleculeCollapse(details)
        | InstructionStep::LocalCollapse(details)
        | InstructionStep::SimultaneousCollapse(details)
        | InstructionStep::ManualCollapse(details) => details.id = id,
        InstructionStep::ManualChoice(step) => step.id = id,
        InstructionStep::UnsupportedRegion(step) => step.id = id,
    }
}

fn trace_candidate_for_step(
    index: usize,
    step: &InstructionStep,
    plan: &SequencePlan,
) -> TraceCandidate {
    let unresolved_after = plan
        .states
        .get(index + 1)
        .map(|state| state.active_creases.len())
        .unwrap_or_else(|| plan.search.best_unresolved_creases);
    match step {
        InstructionStep::PrecreaseRegion(details)
        | InstructionStep::SimpleFold(details)
        | InstructionStep::ReverseFold(details)
        | InstructionStep::SquashFold(details)
        | InstructionStep::RabbitEar(details)
        | InstructionStep::MoleculeCollapse(details)
        | InstructionStep::LocalCollapse(details)
        | InstructionStep::SimultaneousCollapse(details) => TraceCandidate {
            step_id: details.id.clone(),
            kind: instruction_kind(step).to_string(),
            affected_creases: details.affected_creases.clone(),
            accepted: true,
            unresolved_after,
            certificate_status: details
                .certificate
                .as_ref()
                .map(|certificate| certificate.status.clone()),
            recognizer: details
                .certificate
                .as_ref()
                .map(|certificate| certificate.recognizer.clone()),
        },
        InstructionStep::ManualCollapse(details) => TraceCandidate {
            step_id: details.id.clone(),
            kind: "manual_collapse".to_string(),
            affected_creases: details.affected_creases.clone(),
            accepted: false,
            unresolved_after,
            certificate_status: details
                .certificate
                .as_ref()
                .map(|certificate| certificate.status.clone()),
            recognizer: details
                .certificate
                .as_ref()
                .map(|certificate| certificate.recognizer.clone()),
        },
        InstructionStep::ManualChoice(step) => TraceCandidate {
            step_id: step.id.clone(),
            kind: "manual_choice".to_string(),
            affected_creases: step
                .choices
                .iter()
                .flat_map(|choice| choice.affected_creases.iter().copied())
                .collect(),
            accepted: false,
            unresolved_after,
            certificate_status: None,
            recognizer: None,
        },
        InstructionStep::UnsupportedRegion(step) => TraceCandidate {
            step_id: step.id.clone(),
            kind: "unsupported_region".to_string(),
            affected_creases: step.region.creases.clone(),
            accepted: false,
            unresolved_after,
            certificate_status: None,
            recognizer: None,
        },
    }
}

fn instruction_kind(step: &InstructionStep) -> &'static str {
    match step {
        InstructionStep::PrecreaseRegion(_) => "precrease_region",
        InstructionStep::SimpleFold(_) => "simple_fold",
        InstructionStep::ReverseFold(_) => "reverse_fold",
        InstructionStep::SquashFold(_) => "squash_fold",
        InstructionStep::RabbitEar(_) => "rabbit_ear",
        InstructionStep::MoleculeCollapse(_) => "molecule_collapse",
        InstructionStep::LocalCollapse(_) => "local_collapse",
        InstructionStep::SimultaneousCollapse(_) => "simultaneous_collapse",
        InstructionStep::ManualCollapse(_) => "manual_collapse",
        InstructionStep::ManualChoice(_) => "manual_choice",
        InstructionStep::UnsupportedRegion(_) => "unsupported_region",
    }
}

fn reject_zero_solution_limit(solution_limit: &SolutionLimit) -> Result<()> {
    if matches!(solution_limit, SolutionLimit::Count(0)) {
        return Err(SequenceError::InvalidInput(
            "solution_limit must be positive".to_string(),
        ));
    }
    Ok(())
}

fn validate_folded_vertices(state: &SequenceState, diagnostics: &mut Vec<SequenceDiagnostic>) {
    let vertex_count = state.document.vertices_coords.len();
    if state.folded_vertices.len() != vertex_count {
        diagnostics.push(SequenceDiagnostic::error(
            "folded_vertices_length",
            format!(
                "folded_vertices length {} does not match document vertex count {vertex_count}",
                state.folded_vertices.len()
            ),
        ));
        return;
    }
    for (index, [x, y]) in state.folded_vertices.iter().enumerate() {
        if !x.is_finite() || !y.is_finite() {
            diagnostics.push(SequenceDiagnostic::error(
                "non_finite_folded_vertex",
                format!("folded vertex {index} contains a non-finite coordinate"),
            ));
        }
    }
}

fn validate_face_orders(state: &SequenceState, diagnostics: &mut Vec<SequenceDiagnostic>) {
    let face_count = state.document.faces_vertices.len();
    for (index, [above, below, orientation]) in state.face_orders.iter().enumerate() {
        let Ok(above) = usize::try_from(*above) else {
            diagnostics.push(SequenceDiagnostic::error(
                "face_order_out_of_bounds",
                format!("face order {index} has negative above face {above}"),
            ));
            continue;
        };
        let Ok(below) = usize::try_from(*below) else {
            diagnostics.push(SequenceDiagnostic::error(
                "face_order_out_of_bounds",
                format!("face order {index} has negative below face {below}"),
            ));
            continue;
        };
        if above >= face_count || below >= face_count {
            diagnostics.push(SequenceDiagnostic::error(
                "face_order_out_of_bounds",
                format!(
                    "face order {index} references faces {above} and {below}; valid range is 0..{face_count}"
                ),
            ));
        }
        if !matches!(*orientation, -1 | 1) {
            diagnostics.push(SequenceDiagnostic::error(
                "face_order_orientation",
                format!("face order {index} orientation must be -1 or 1, got {orientation}"),
            ));
        }
    }
}

fn validate_unresolved_regions(state: &SequenceState, diagnostics: &mut Vec<SequenceDiagnostic>) {
    let edge_count = state.document.edges_vertices.len();
    let face_count = state.document.faces_vertices.len();
    for region in &state.unresolved_regions {
        for crease in &region.creases {
            if *crease >= edge_count {
                diagnostics.push(SequenceDiagnostic::error(
                    "unresolved_crease_out_of_bounds",
                    format!(
                        "unresolved region {} references crease {crease}; valid range is 0..{edge_count}",
                        region.id
                    ),
                ));
            }
        }
        for face in &region.faces {
            if *face >= face_count {
                diagnostics.push(SequenceDiagnostic::error(
                    "unresolved_face_out_of_bounds",
                    format!(
                        "unresolved region {} references face {face}; valid range is 0..{face_count}",
                        region.id
                    ),
                ));
            }
        }
        if region.reason.trim().is_empty() {
            diagnostics.push(SequenceDiagnostic::error(
                "unresolved_region_missing_reason",
                format!("unresolved region {} must include a reason", region.id),
            ));
        }
    }
}

fn solution_counts_are_ambiguous(solution_counts: &[usize]) -> bool {
    solution_counts.iter().any(|count| *count > 1)
}

fn solution_limit_may_have_truncated(limit: &SolutionLimit, solution_counts: &[usize]) -> bool {
    match limit {
        SolutionLimit::All => false,
        SolutionLimit::Count(limit) => solution_counts.iter().any(|count| count == limit),
    }
}

fn flatfold_error_code(error: &FlatFoldError) -> &'static str {
    match error {
        FlatFoldError::InvalidInput(_) => "invalid_input",
        FlatFoldError::PrecisionFailure(_) => "precision_failure",
        FlatFoldError::AssignmentConflict(_) => "assignment_conflict",
        FlatFoldError::UnsatisfiedComponent(_) => "unsatisfied_component",
        FlatFoldError::Unimplemented(_) => "not_implemented",
    }
}

fn map_vertices(input: &FoldDocument, normalized: &FoldDocument) -> Vec<Vec<usize>> {
    normalized
        .vertices_coords
        .iter()
        .map(|normalized_vertex| {
            input
                .vertices_coords
                .iter()
                .enumerate()
                .filter_map(|(input_index, input_vertex)| {
                    points_close(normalized_vertex, input_vertex).then_some(input_index)
                })
                .collect()
        })
        .collect()
}

fn map_edges(input: &FoldDocument, normalized: &FoldDocument) -> Vec<Vec<usize>> {
    normalized
        .edges_vertices
        .iter()
        .map(|[normalized_a, normalized_b]| {
            let Some(a) = point_at(normalized, *normalized_a) else {
                return Vec::new();
            };
            let Some(b) = point_at(normalized, *normalized_b) else {
                return Vec::new();
            };
            input
                .edges_vertices
                .iter()
                .enumerate()
                .filter_map(|(input_edge_index, [input_a, input_b])| {
                    let source_a = point_at(input, *input_a)?;
                    let source_b = point_at(input, *input_b)?;
                    normalized_edge_is_on_input_edge(a, b, source_a, source_b)
                        .then_some(input_edge_index)
                })
                .collect()
        })
        .collect()
}

fn map_faces(
    input: &FoldDocument,
    normalized: &FoldDocument,
    vertex_map: &[Vec<usize>],
) -> Vec<Vec<usize>> {
    normalized
        .faces_vertices
        .iter()
        .map(|normalized_face| {
            input
                .faces_vertices
                .iter()
                .enumerate()
                .filter_map(|(input_face_index, input_face)| {
                    face_vertices_map_to_input_face(normalized_face, input_face, vertex_map)
                        .then_some(input_face_index)
                })
                .collect()
        })
        .collect()
}

fn face_vertices_map_to_input_face(
    normalized_face: &[usize],
    input_face: &[usize],
    vertex_map: &[Vec<usize>],
) -> bool {
    if normalized_face.len() != input_face.len() {
        return false;
    }
    normalized_face.iter().all(|vertex| {
        vertex_map.get(*vertex).is_some_and(|source_vertices| {
            source_vertices
                .iter()
                .any(|source| input_face.contains(source))
        })
    }) && input_face.iter().all(|source| {
        normalized_face.iter().any(|vertex| {
            vertex_map
                .get(*vertex)
                .is_some_and(|source_vertices| source_vertices.contains(source))
        })
    })
}

fn normalized_edge_is_on_input_edge(
    normalized_a: [f64; 2],
    normalized_b: [f64; 2],
    input_a: [f64; 2],
    input_b: [f64; 2],
) -> bool {
    point_on_segment(normalized_a, input_a, input_b)
        && point_on_segment(normalized_b, input_a, input_b)
}

fn point_at(document: &FoldDocument, vertex: usize) -> Option<[f64; 2]> {
    let coords = document.vertices_coords.get(vertex)?;
    Some([*coords.first()?, *coords.get(1)?])
}

fn points_close(a: &[f64], b: &[f64]) -> bool {
    let (Some(ax), Some(ay), Some(bx), Some(by)) = (a.first(), a.get(1), b.first(), b.get(1))
    else {
        return false;
    };
    (*ax - *bx).abs() <= ID_MAP_EPSILON && (*ay - *by).abs() <= ID_MAP_EPSILON
}

fn point_on_segment(point: [f64; 2], a: [f64; 2], b: [f64; 2]) -> bool {
    let ab = [b[0] - a[0], b[1] - a[1]];
    let ap = [point[0] - a[0], point[1] - a[1]];
    let length_sq = ab[0] * ab[0] + ab[1] * ab[1];
    if length_sq <= ID_MAP_EPSILON {
        return false;
    }
    let cross = (ab[0] * ap[1] - ab[1] * ap[0]).abs();
    let scale = length_sq.sqrt().max(1.0);
    if cross > ID_MAP_EPSILON * scale {
        return false;
    }
    let dot = ap[0] * ab[0] + ap[1] * ab[1];
    dot >= -ID_MAP_EPSILON && dot <= length_sq + ID_MAP_EPSILON
}

#[cfg(test)]
mod tests {
    use super::*;
    use treemaker_fold::Assignment;

    fn two_face_valley() -> FoldDocument {
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
            ],
            vec![[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
        );
        document.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Valley,
        ];
        document.faces_vertices = vec![vec![0, 1, 2], vec![0, 2, 3]];
        document
    }

    fn rabbit_ear_local() -> FoldDocument {
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
                vec![0.5, 0.0],
                vec![1.0, 0.5],
                vec![0.5, 1.0],
                vec![0.0, 0.5],
                vec![0.5, 0.5],
            ],
            vec![
                [0, 4],
                [4, 1],
                [1, 5],
                [5, 2],
                [2, 6],
                [6, 3],
                [3, 7],
                [7, 0],
                [4, 8],
                [5, 8],
                [6, 8],
                [7, 8],
            ],
        );
        document.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Valley,
        ];
        document.faces_vertices = vec![
            vec![0, 4, 8, 7],
            vec![4, 1, 5, 8],
            vec![8, 5, 2, 6],
            vec![7, 8, 6, 3],
        ];
        document
    }

    fn squash_local() -> FoldDocument {
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
                vec![0.5, 0.0],
                vec![1.0, 0.5],
                vec![0.5, 1.0],
                vec![0.0, 0.5],
                vec![0.5, 0.5],
            ],
            vec![
                [0, 4],
                [4, 1],
                [1, 5],
                [5, 2],
                [2, 6],
                [6, 3],
                [3, 7],
                [7, 0],
                [4, 8],
                [1, 8],
                [5, 8],
                [2, 8],
                [6, 8],
                [3, 8],
                [7, 8],
                [0, 8],
            ],
        );
        document.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
            Assignment::Valley,
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Valley,
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Valley,
        ];
        document.faces_vertices = vec![
            vec![0, 4, 8],
            vec![4, 1, 8],
            vec![1, 5, 8],
            vec![5, 2, 8],
            vec![2, 6, 8],
            vec![6, 3, 8],
            vec![3, 7, 8],
            vec![7, 0, 8],
        ];
        document
    }

    fn triad_molecule() -> FoldDocument {
        let mut document = FoldDocument::new(
            vec![
                vec![0.5, 0.5],
                vec![0.5, 1.0],
                vec![0.9330127018922193, 0.75],
                vec![0.9330127018922193, 0.25],
                vec![0.5, 0.0],
                vec![0.0669872981077807, 0.25],
                vec![0.0669872981077807, 0.75],
            ],
            vec![
                [1, 2],
                [2, 3],
                [3, 4],
                [4, 5],
                [5, 6],
                [6, 1],
                [0, 1],
                [0, 2],
                [0, 3],
                [0, 4],
                [0, 5],
                [0, 6],
            ],
        );
        document.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
            Assignment::Valley,
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Valley,
            Assignment::Mountain,
        ];
        document.faces_vertices = vec![
            vec![0, 1, 2],
            vec![0, 2, 3],
            vec![0, 3, 4],
            vec![0, 4, 5],
            vec![0, 5, 6],
            vec![0, 6, 1],
        ];
        document
    }

    fn disconnected_unresolved_state() -> SequenceState {
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
                vec![3.0, 0.0],
                vec![4.0, 0.0],
                vec![4.0, 1.0],
                vec![3.0, 1.0],
            ],
            vec![
                [0, 1],
                [1, 2],
                [2, 3],
                [3, 0],
                [0, 2],
                [4, 5],
                [5, 6],
                [6, 7],
                [7, 4],
                [4, 6],
            ],
        );
        document.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Valley,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
        ];
        document.faces_vertices = vec![vec![0, 1, 2], vec![0, 2, 3], vec![4, 5, 6], vec![4, 6, 7]];
        state_from_document("disconnected", document)
    }

    fn face_graph_simple_fold_document() -> FoldDocument {
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![0.5, 1.0],
                vec![0.5, -1.0],
            ],
            vec![[0, 1], [1, 2], [2, 0], [1, 3], [3, 0]],
        );
        document.edges_assignment = vec![
            Assignment::Valley,
            Assignment::Flat,
            Assignment::Flat,
            Assignment::Flat,
            Assignment::Flat,
        ];
        document.faces_vertices = vec![vec![0, 1, 2], vec![1, 0, 3]];
        document
    }

    fn non_separating_simple_fold_lookalike() -> FoldDocument {
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![0.5, 1.0],
                vec![0.5, -1.0],
            ],
            vec![[0, 1], [1, 2], [2, 0], [1, 3], [3, 0], [2, 3]],
        );
        document.edges_assignment = vec![
            Assignment::Valley,
            Assignment::Flat,
            Assignment::Flat,
            Assignment::Flat,
            Assignment::Flat,
            Assignment::Flat,
        ];
        document.faces_vertices = vec![vec![0, 1, 2], vec![1, 0, 3], vec![0, 2, 3]];
        document
    }

    fn state_from_document(id: &str, document: FoldDocument) -> SequenceState {
        let folded_vertices = document
            .vertices_coords
            .iter()
            .map(|coord| [coord[0], coord[1]])
            .collect();
        let active_creases = document
            .edges_assignment
            .iter()
            .enumerate()
            .filter_map(|(edge, assignment)| {
                matches!(assignment, Assignment::Mountain | Assignment::Valley).then_some(edge)
            })
            .collect();
        SequenceState {
            id: id.to_string(),
            document,
            active_creases,
            face_orders: Vec::new(),
            folded_vertices,
            unresolved_regions: Vec::new(),
            provenance: StateProvenance::input(),
            layer_order_policy: LayerOrderPolicy::Preserved,
            diagnostics: Vec::new(),
        }
    }

    #[test]
    fn target_state_wraps_flatfold_result() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");

        assert_eq!(
            target.folded_vertices.len(),
            target.normalized.vertices_coords.len()
        );
        assert_eq!(
            target.faces_flip.len(),
            target.normalized.faces_vertices.len()
        );
        assert_eq!(target.selected_solution_index, 0);
        assert!(!target.overlap.cells_faces.is_empty());
        assert_eq!(
            target.id_map.normalized_vertices_to_input_vertices.len(),
            target.normalized.vertices_coords.len()
        );
    }

    #[test]
    fn folded_frame_uses_folded_coordinates_without_losing_face_orders() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let folded = target.folded_frame();

        assert_eq!(
            folded.document.vertices_coords.len(),
            target.folded_vertices.len()
        );
        assert_eq!(folded.face_orders, target.face_orders);
        assert!(
            folded
                .document
                .frame_classes
                .iter()
                .any(|class| class == "foldedForm")
        );
    }

    #[test]
    fn reference_precrease_planner_is_explicitly_not_implemented() {
        let document = two_face_valley();
        let error =
            plan_reference_precreases(&document).expect_err("reference finder is not implemented");

        assert_eq!(error.code(), "not_implemented");
    }

    #[test]
    fn simple_fold_planner_completes_single_simple_fold() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let plan = plan_folding_sequence(&target).expect("simple fold plan");

        assert_eq!(plan.status, PlanStatus::Complete);
        assert_eq!(plan.steps.len(), 1);
        assert!(plan.unresolved_regions.is_empty());
        assert_eq!(plan.search.best_unresolved_creases, 0);
        assert_eq!(plan.search.target_solves, 1);
        assert_eq!(plan.search.target_solve_cache_hits, 0);
        assert_eq!(plan.search.duplicate_candidates_pruned, 0);
        match &plan.steps[0] {
            InstructionStep::SimpleFold(details) => {
                assert_eq!(details.affected_creases, vec![4]);
                assert_eq!(details.metadata.difficulty, MoveDifficulty::Simple);
                let certificate = details
                    .certificate
                    .as_ref()
                    .expect("simple fold certificate");
                assert_eq!(certificate.status, CertificateStatus::Verified);
                assert_eq!(certificate.recognizer, "boundary_simple_fold");
                assert_eq!(certificate.checked_creases, vec![4]);
            }
            other => panic!("expected simple fold step, got {other:?}"),
        }
        assert!(inspect_step_certificate(&plan.steps[0]).is_empty());
    }

    #[test]
    fn planning_context_reuses_cached_target_resolutions() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let state = SequenceState::from_target("target", &target);
        let mut context = PlanningContext::new(&state, &target);

        let cached = context
            .resolve_target(&state.document)
            .expect("initial document is cached");
        assert_eq!(
            cached.selected_solution_index,
            target.selected_solution_index
        );
        assert_eq!(context.target_solves, 0);
        assert_eq!(context.target_solve_cache_hits, 1);

        let unfolded = document_with_creases_reset(&state, &[4]);
        let first = context
            .resolve_target(&unfolded)
            .expect("first rewritten document solve");
        let second = context
            .resolve_target(&unfolded)
            .expect("second rewritten document cache hit");

        assert_eq!(
            first.normalized.edges_assignment,
            second.normalized.edges_assignment
        );
        assert_eq!(context.target_solves, 1);
        assert_eq!(context.target_solve_cache_hits, 2);
    }

    #[test]
    fn planning_context_prunes_reserved_candidate_documents_before_solving() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let state = SequenceState::from_target("target", &target);
        let mut context = PlanningContext::new(&state, &target);
        let unfolded = document_with_creases_reset(&state, &[4]);

        assert!(!context.document_key_is_seen(&unfolded));
        let rewritten_target = context
            .resolve_target(&unfolded)
            .expect("rewritten document target");
        let mut rewritten = SequenceState::from_target("state-1", &rewritten_target);
        rewritten.active_creases.retain(|crease| *crease != 4);

        assert!(context.reserve_state(&rewritten));
        assert!(context.document_key_is_seen(&unfolded));
        assert_eq!(context.duplicate_candidates_pruned, 1);
        assert_eq!(context.repeated_states, 1);
    }

    #[test]
    fn sequence_state_key_distinguishes_selected_layer_order() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let mut first = SequenceState::from_target("first", &target);
        let mut second = first.clone();
        first.face_orders = vec![[0, 1, 1]];
        second.face_orders = vec![[0, 1, -1]];

        assert_ne!(sequence_state_key(&first), sequence_state_key(&second));
        assert_eq!(
            sequence_document_key(&first.document),
            sequence_document_key(&second.document)
        );
    }

    #[test]
    fn isolated_rabbit_ear_transform_applies_as_local_collapse_step() {
        let target = resolve_target_state(&rabbit_ear_local(), TargetStateOptions::default())
            .expect("target state");
        let state = SequenceState::from_target("target", &target);
        let candidate = recognize_complex_moves(&state)
            .expect("complex candidates")
            .into_iter()
            .find(|candidate| candidate.kind == ComplexMoveKind::RabbitEar)
            .expect("rabbit-ear candidate");

        let result =
            apply_complex_transform(&state, "state-1", &candidate).expect("transform result");

        assert_eq!(result.status, ComplexTransformStatus::Applied);
        assert!(result.after_state.is_some());
        assert!(matches!(
            result.step,
            Some(InstructionStep::LocalCollapse(_))
        ));
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "complex_transform_applied"
                && diagnostic.severity == DiagnosticSeverity::Info
        }));
    }

    #[test]
    fn local_complex_transform_allows_candidate_subset_of_active_region() {
        let target = resolve_target_state(&rabbit_ear_local(), TargetStateOptions::default())
            .expect("target state");
        let mut state = SequenceState::from_target("target", &target);
        let candidate = recognize_complex_moves(&state)
            .expect("complex candidates")
            .into_iter()
            .find(|candidate| candidate.kind == ComplexMoveKind::RabbitEar)
            .expect("rabbit-ear candidate");
        state.active_creases.push(0);

        assert!(local_complex_transform_is_supported(&state, &candidate));
    }

    #[test]
    fn detect_simple_folds_accepts_face_graph_separation() {
        let state = state_from_document("face-graph", face_graph_simple_fold_document());
        let simple_folds = detect_simple_folds(&state).expect("simple folds");

        assert_eq!(simple_folds.len(), 1);
        assert_eq!(simple_folds[0].crease, 0);
        assert_eq!(simple_folds[0].proof, SimpleFoldProof::FaceGraphSeparation);
        let step = simple_folds[0].to_forward_step(0, "before".to_string(), "after".to_string());
        let certificate = step.certificate().expect("certificate");
        assert_eq!(certificate.status, CertificateStatus::Verified);
        assert_eq!(certificate.recognizer, "face_graph_simple_fold");
    }

    #[test]
    fn detect_simple_folds_rejects_non_separating_internal_crease() {
        let state = state_from_document("lookalike", non_separating_simple_fold_lookalike());
        let simple_folds = detect_simple_folds(&state).expect("simple folds");

        assert!(simple_folds.is_empty());
        let regions = unresolved_regions_for_state(&state);
        assert_eq!(regions.len(), 1);
        assert_eq!(
            regions[0].reason,
            "no validated simple-fold rewrite matches this crease"
        );
    }

    #[test]
    fn isolated_squash_transform_completes_as_complex_step() {
        let target =
            resolve_target_state(&squash_local(), TargetStateOptions::default()).expect("target");
        let plan = plan_folding_sequence(&target).expect("squash plan");

        assert_eq!(plan.status, PlanStatus::Complete);
        assert!(plan.unresolved_regions.is_empty());
        assert_eq!(plan.search.best_unresolved_creases, 0);
        assert!(
            plan.diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "complex_transform_applied")
        );
        match &plan.steps[0] {
            InstructionStep::LocalCollapse(details) => {
                assert_eq!(details.affected_creases.len(), 8);
                assert_eq!(details.before_state, "state-1");
                assert_eq!(details.after_state, "target");
                let certificate = details.certificate.as_ref().expect("squash certificate");
                assert_eq!(certificate.status, CertificateStatus::Heuristic);
                assert_eq!(certificate.recognizer, "topology_only_squash_fold");
                assert!(
                    certificate
                        .diagnostics
                        .iter()
                        .any(|diagnostic| diagnostic.code == "heuristic_step_certificate")
                );
            }
            other => panic!("expected local collapse step, got {other:?}"),
        }
        assert!(
            plan.states
                .first()
                .is_some_and(|state| state.active_creases.is_empty())
        );
    }

    #[test]
    fn isolated_molecule_transform_completes_as_complex_step() {
        let target =
            resolve_target_state(&triad_molecule(), TargetStateOptions::default()).expect("target");
        let plan = plan_folding_sequence(&target).expect("molecule plan");

        assert_eq!(plan.status, PlanStatus::Complete);
        assert!(plan.unresolved_regions.is_empty());
        match &plan.steps[0] {
            InstructionStep::LocalCollapse(details) => {
                assert_eq!(details.affected_creases.len(), 6);
                assert_eq!(details.after_state, "target");
                assert_eq!(
                    details
                        .certificate
                        .as_ref()
                        .map(|cert| cert.recognizer.as_str()),
                    Some("topology_only_molecule_collapse")
                );
            }
            other => panic!("expected local collapse step, got {other:?}"),
        }
    }

    #[test]
    fn unresolved_regions_are_split_by_connected_components() {
        let state = disconnected_unresolved_state();
        let regions = unresolved_regions_for_state(&state);

        assert_eq!(regions.len(), 2);
        assert_eq!(regions[0].id, "unresolved-1");
        assert_eq!(regions[0].creases, vec![4]);
        assert_eq!(regions[0].faces, vec![0, 1]);
        assert_eq!(regions[1].id, "unresolved-2");
        assert_eq!(regions[1].creases, vec![9]);
        assert_eq!(regions[1].faces, vec![2, 3]);
        assert!(
            regions
                .iter()
                .all(|region| region.reason.contains("simple-fold"))
        );
    }

    #[test]
    fn unresolved_region_reason_marks_complex_like_components() {
        let state = state_from_document("triad", triad_molecule());
        let regions = unresolved_regions_for_state(&state);

        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].creases.len(), 6);
        assert!(regions[0].reason.contains("local complex move"));
    }

    #[test]
    fn complex_transform_harness_rejects_invalid_candidates() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let state = SequenceState::from_target("target", &target);
        let candidate = ComplexMoveCandidate {
            kind: ComplexMoveKind::ReverseFold,
            center_vertex: Some(99),
            creases: vec![4, 99],
            faces: vec![0],
            metadata: MoveMetadata::default(),
            diagnostics: Vec::new(),
        };

        let result =
            apply_complex_transform(&state, "state-1", &candidate).expect("transform result");

        assert_eq!(result.status, ComplexTransformStatus::InvalidCandidate);
        assert!(result.after_state.is_none());
        assert!(result.step.is_none());
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "complex_candidate_crease_out_of_bounds"
                && diagnostic.severity == DiagnosticSeverity::Error
        }));
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "complex_candidate_center_out_of_bounds"
                && diagnostic.severity == DiagnosticSeverity::Error
        }));
    }

    #[test]
    fn search_budget_returns_best_partial_plan() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let plan = plan_folding_sequence_with_options(
            &target,
            SequencePlanOptions {
                max_steps: 0,
                ..SequencePlanOptions::default()
            },
        )
        .expect("partial plan");

        assert_eq!(plan.status, PlanStatus::Partial);
        assert!(plan.search.budget_exhausted);
        assert_eq!(plan.search.best_unresolved_creases, 1);
        assert!(plan.score().unresolved_creases > 0);
        assert!(matches!(
            plan.steps.first(),
            Some(InstructionStep::ManualCollapse(details))
                if details.label == "Collapse up until this point"
                    && details.before_state == "flat-cp"
                    && details.after_state == "target"
                    && details.certificate.as_ref().is_some_and(|certificate| {
                        certificate.status == CertificateStatus::Manual
                            && certificate.recognizer == "manual_collapse_boundary"
                    })
        ));
        assert!(
            plan.states
                .first()
                .is_some_and(|state| state.id == "flat-cp")
        );
    }

    #[test]
    fn planner_output_is_deterministic() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let first = plan_folding_sequence(&target).expect("first plan");
        let second = plan_folding_sequence(&target).expect("second plan");

        assert_eq!(
            serde_json::to_value(first).expect("first json"),
            serde_json::to_value(second).expect("second json")
        );
    }

    #[test]
    fn trace_schema_replays_plan_score() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let plan = plan_folding_sequence(&target).expect("plan");
        let trace = trace_plan(&plan);

        assert_eq!(trace.schema_version, 1);
        assert_eq!(trace.status, plan.status);
        assert_eq!(trace.score, plan.score());
        assert_eq!(trace.candidates.len(), plan.steps.len());
        assert_eq!(
            trace.candidates[0].certificate_status,
            Some(CertificateStatus::Verified)
        );
        assert_eq!(
            trace.candidates[0].recognizer.as_deref(),
            Some("boundary_simple_fold")
        );
        assert_eq!(
            trace.ml_decision.recommendation,
            MlRecommendation::CollectMoreTraces
        );
    }

    #[test]
    fn step_certificate_inspector_reports_failed_checks() {
        let mut details = StepDetails::new("step-1", "Bad certificate", "before", "after");
        details.certificate = Some(StepCertificate {
            status: CertificateStatus::Verified,
            recognizer: "test".to_string(),
            checked_creases: Vec::new(),
            checked_faces: Vec::new(),
            preconditions: vec![CertificateCheck::failed(
                "broken_precondition",
                "synthetic failure",
            )],
            postconditions: Vec::new(),
            layer_order: LayerOrderCertificate::preserved(),
            diagnostics: Vec::new(),
        });
        let step = InstructionStep::SimpleFold(details);
        let diagnostics = inspect_step_certificate(&step);

        assert!(diagnostics.iter().any(|diagnostic| {
            diagnostic.severity == DiagnosticSeverity::Error
                && diagnostic.code == "step_certificate_failed_check"
        }));
    }

    #[test]
    fn ml_decision_keeps_runtime_symbolic_without_trace_corpus() {
        let decision = ml_readiness_decision(0, 0);

        assert_eq!(decision.recommendation, MlRecommendation::KeepSymbolic);
        assert!(
            decision
                .reason
                .contains("ML must not affect production behavior")
        );
    }

    #[test]
    fn zero_solution_limit_is_rejected_before_flatfolding() {
        let error = resolve_target_state(
            &two_face_valley(),
            TargetStateOptions {
                solution_limit: SolutionLimit::Count(0),
                ..TargetStateOptions::default()
            },
        )
        .expect_err("zero limit should be invalid");

        assert_eq!(error.code(), "invalid_input");
    }

    #[test]
    fn sequence_state_from_target_validates() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let state = SequenceState::from_target("target", &target);
        let report = state.validate().expect("state validates");

        assert_eq!(report.state_id, "target");
        assert!(report.diagnostics.is_empty());
        assert_eq!(state.to_frame().face_orders, target.face_orders);
    }

    #[test]
    fn sequence_state_validator_reports_bad_active_crease() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let mut state = SequenceState::from_target("bad-active", &target);
        state.active_creases.push(0);
        state
            .active_creases
            .push(state.document.edges_vertices.len());
        let report = inspect_sequence_state(&state);

        assert!(!report.is_valid());
        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "active_crease_not_driven")
        );
        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "active_crease_out_of_bounds")
        );
        assert_eq!(
            state.validate().expect_err("state should fail").code(),
            "invalid_state"
        );
    }

    #[test]
    fn sequence_state_validator_reports_layer_order_errors() {
        let target = resolve_target_state(&two_face_valley(), TargetStateOptions::default())
            .expect("target state");
        let mut state = SequenceState::from_target("bad-order", &target);
        state.face_orders = vec![[0, 99, 0]];
        state.layer_order_policy = LayerOrderPolicy::RelaxedWithDiagnostic;
        let report = inspect_sequence_state(&state);

        assert!(!report.is_valid());
        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "face_order_out_of_bounds")
        );
        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "face_order_orientation")
        );
        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "missing_layer_order_relaxed_diagnostic")
        );
    }

    #[test]
    fn instruction_steps_serialize_with_stable_kind_names() {
        let mut details = StepDetails::new("step-1", "Fold along the diagonal", "s0", "s1");
        details.affected_creases = vec![4];
        details.metadata.difficulty = MoveDifficulty::Simple;
        details.metadata.layer_mode = LayerMode::SingleLayer;
        details.metadata.confidence = 1.0;
        let step = InstructionStep::SimpleFold(details);
        let value = serde_json::to_value(&step).expect("serialize step");

        assert_eq!(value["kind"], "simple_fold");
        assert_eq!(step.id(), "step-1");
    }
}
