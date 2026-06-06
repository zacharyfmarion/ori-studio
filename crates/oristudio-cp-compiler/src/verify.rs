use crate::assignments::{AssignmentDecision, AssignmentSolverOptions, solve_assignments};
use crate::candidate_graph::CandidateCreaseBoundaryRole;
use crate::fold_export::export_program_to_fold_document;
use crate::optimizer::{TopologyMoveRecord, TopologyOptimizerOptions, optimize_topology};
use crate::{CandidateProgram, ExactSolveInput, LegacyCandidateAdapter, SelectedGraph};
use oristudio_cp::checks::{check_camv_task, check1, check2, check3};
use oristudio_cp::io::fold::import_fold_document;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use treemaker_flatfold::{
    FlatFoldError, NormalizeOptions, SolutionLimit, SolveOptions, normalize_fold, solve_flat_fold,
};
use treemaker_fold::{Assignment, FoldAngle, FoldDocument, validate_basic};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GlobalVerificationOptions {
    pub run_oristudio_checks: bool,
    pub run_flat_folder: bool,
    pub flat_folder_solution_limit: usize,
}

impl Default for GlobalVerificationOptions {
    fn default() -> Self {
        Self {
            run_oristudio_checks: true,
            run_flat_folder: true,
            flat_folder_solution_limit: 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GlobalVerificationReport {
    pub fold_valid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold_error: Option<String>,
    pub oristudio: OrieditaCheckReport,
    pub flat_folder: FlatFolderCheckReport,
    pub classifications: Vec<GlobalFailureClassification>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GlobalVerificationLoopOptions {
    pub verification: GlobalVerificationOptions,
    pub topology: TopologyOptimizerOptions,
    pub assignments: AssignmentSolverOptions,
    pub enable_feedback: bool,
}

impl Default for GlobalVerificationLoopOptions {
    fn default() -> Self {
        Self {
            verification: GlobalVerificationOptions::default(),
            topology: TopologyOptimizerOptions::default(),
            assignments: AssignmentSolverOptions::default(),
            enable_feedback: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GlobalVerificationLoopReport {
    pub initial: GlobalVerificationReport,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_feedback: Option<GlobalVerificationReport>,
    pub feedback_applied: bool,
    pub topology_moves: Vec<TopologyMoveRecord>,
    pub assignment_decisions: Vec<AssignmentDecision>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrieditaCheckReport {
    pub attempted: bool,
    pub import_ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_error: Option<String>,
    pub check1_segments: usize,
    pub check2_segments: usize,
    pub check3_markers: usize,
    pub camv_violations: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlatFolderCheckReport {
    pub attempted: bool,
    pub solved: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_preprocess: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub input_cut_boundary_edges: Vec<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub face_orders: usize,
    pub constraint_variables: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlatFolderPreparedDocument {
    pub document: FoldDocument,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preprocess: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cut_boundary_edges: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GlobalFailureClassification {
    Clean,
    InvalidFold,
    LocalTheoremFailure,
    AssignmentConflict,
    PrecisionFailure,
    OverlapOrderConflict,
    UnsupportedGlobalAmbiguity,
}

pub fn verify_program(
    program: &CandidateProgram,
    options: GlobalVerificationOptions,
) -> GlobalVerificationReport {
    let document = export_program_to_fold_document(program);
    verify_fold_document(&document, options)
}

pub fn verify_program_with_feedback(
    program: &CandidateProgram,
    options: GlobalVerificationLoopOptions,
) -> GlobalVerificationLoopReport {
    let initial = verify_program(program, options.verification);
    if !options.enable_feedback || report_is_clean(&initial) {
        return GlobalVerificationLoopReport {
            initial,
            after_feedback: None,
            feedback_applied: false,
            topology_moves: Vec::new(),
            assignment_decisions: Vec::new(),
        };
    }

    let topology = optimize_topology(program, options.topology);
    let assignments = solve_assignments(&topology.program, options.assignments);
    let after_feedback = verify_program(&assignments.program, options.verification);
    let feedback_applied = !topology.accepted_moves.is_empty() || !assignments.decisions.is_empty();
    GlobalVerificationLoopReport {
        initial,
        after_feedback: Some(after_feedback),
        feedback_applied,
        topology_moves: topology.accepted_moves,
        assignment_decisions: assignments.decisions,
    }
}

pub fn verify_fold_json(
    fold_json: &str,
    options: GlobalVerificationOptions,
) -> Result<GlobalVerificationReport, serde_json::Error> {
    let document = serde_json::from_str::<FoldDocument>(fold_json)?;
    Ok(verify_fold_document(&document, options))
}

pub fn verify_fold_document(
    document: &FoldDocument,
    options: GlobalVerificationOptions,
) -> GlobalVerificationReport {
    let fold_validation = validate_basic(document).map_err(|error| error.to_string());
    let fold_valid = fold_validation.is_ok();
    let oristudio = if fold_valid && options.run_oristudio_checks {
        run_oristudio_checks(document)
    } else {
        OrieditaCheckReport::default()
    };
    let flat_folder = if fold_valid && options.run_flat_folder {
        run_flat_folder(document, options.flat_folder_solution_limit)
    } else {
        FlatFolderCheckReport::default()
    };
    let classifications = classify_failures(fold_valid, &oristudio, &flat_folder);
    GlobalVerificationReport {
        fold_valid,
        fold_error: fold_validation.err(),
        oristudio,
        flat_folder,
        classifications,
    }
}

fn run_oristudio_checks(document: &FoldDocument) -> OrieditaCheckReport {
    let mut report = OrieditaCheckReport {
        attempted: true,
        ..OrieditaCheckReport::default()
    };
    match import_fold_document(document) {
        Ok(model) => {
            report.import_ok = true;
            report.check1_segments = check1(&model).len();
            report.check2_segments = check2(&model).len();
            report.check3_markers = check3(&model).len();
            report.camv_violations = check_camv_task(&model).violations.len();
        }
        Err(error) => {
            report.import_error = Some(error.to_string());
        }
    }
    report
}

fn run_flat_folder(document: &FoldDocument, solution_limit: usize) -> FlatFolderCheckReport {
    let mut report = FlatFolderCheckReport {
        attempted: true,
        ..FlatFolderCheckReport::default()
    };
    let prepared = prepare_flat_folder_document(document);
    report.input_preprocess = prepared.preprocess.clone();
    report.input_cut_boundary_edges = prepared.cut_boundary_edges.clone();
    let options = SolveOptions {
        solution_limit: SolutionLimit::Count(solution_limit.max(1)),
        ..SolveOptions::default()
    };
    match solve_flat_fold(&prepared.document, options) {
        Ok(result) => {
            report.solved = true;
            report.face_orders = result.face_orders.len();
            report.constraint_variables = result.constraints.variables;
        }
        Err(error) => {
            report.error_kind = Some(flat_folder_error_kind(&error).to_owned());
            report.error_message = Some(error.to_string());
        }
    }
    report
}

pub fn prepare_flat_folder_document(document: &FoldDocument) -> FlatFolderPreparedDocument {
    let mut prepared = FlatFolderPreparedDocument {
        document: document.clone(),
        preprocess: None,
        cut_boundary_edges: Vec::new(),
    };
    if !has_treemaker_useful_polygon_hint(document) {
        return prepared;
    }

    let cut_boundary_edges = treemaker_cut_boundary_edge_ids(document);
    if cut_boundary_edges.is_empty() {
        return prepared;
    }

    if prepared.document.edges_assignment.len() != prepared.document.edges_vertices.len() {
        prepared.document.edges_assignment = (0..prepared.document.edges_vertices.len())
            .map(|edge| document.assignment_for_edge(edge))
            .collect();
    }
    if !prepared.document.edges_fold_angle.is_empty()
        && prepared.document.edges_fold_angle.len() != prepared.document.edges_vertices.len()
    {
        prepared
            .document
            .edges_fold_angle
            .resize(prepared.document.edges_vertices.len(), None);
    }

    for edge in &cut_boundary_edges {
        let Some(assignment) = prepared.document.edges_assignment.get_mut(*edge) else {
            continue;
        };
        *assignment = Assignment::Boundary;
        if let Some(fold_angle) = prepared.document.edges_fold_angle.get_mut(*edge) {
            *fold_angle = FoldAngle::default_for_assignment(Assignment::Boundary);
        }
    }

    let preprocess = "treemaker_useful_polygon_boundary".to_owned();
    if let Some(compacted) = compact_normalized_flat_folder_domain(&prepared.document) {
        prepared.document = compacted;
    }
    prepared.document.extra.insert(
        "flat_folder_preprocess".to_owned(),
        json!({
            "profile": preprocess,
            "cut_boundary_edges": cut_boundary_edges,
            "description": "promoted TreeMaker useful-polygon flat edges to boundary and compacted the normalized physical domain for flat-folder solving"
        }),
    );
    prepared.preprocess = Some(preprocess);
    prepared.cut_boundary_edges = cut_boundary_edges;
    prepared
}

fn has_treemaker_useful_polygon_hint(document: &FoldDocument) -> bool {
    document.extra.contains_key("treemaker_metadata")
        || document
            .extra
            .get("cp_detector")
            .and_then(|value| value.get("flat_folder_boundary_hint"))
            .and_then(Value::as_str)
            == Some("treemaker_useful_polygon")
}

fn treemaker_cut_boundary_edge_ids(document: &FoldDocument) -> Vec<usize> {
    let Ok(value) = serde_json::to_value(document) else {
        return Vec::new();
    };
    let Ok(program) = CandidateProgram::from_fold_value(&value) else {
        return Vec::new();
    };
    let graph = LegacyCandidateAdapter::from_program(&program);
    let selected = SelectedGraph::from_selected_span_ids(
        &graph,
        graph.crease_candidates.iter().map(|span| span.id).collect(),
    );
    let input = ExactSolveInput::from_candidate_selection(&graph, &selected);
    let mut edge_ids = input
        .selected_spans
        .iter()
        .filter(|span| span.boundary_role() == CandidateCreaseBoundaryRole::CutBoundary)
        .flat_map(|span| span.source_edge_ids.iter().copied())
        .collect::<Vec<_>>();
    edge_ids.sort_unstable();
    edge_ids.dedup();
    edge_ids
}

fn compact_normalized_flat_folder_domain(document: &FoldDocument) -> Option<FoldDocument> {
    let normalized = normalize_fold(document, NormalizeOptions::default())
        .ok()?
        .document;
    if normalized.faces_vertices.is_empty() || normalized.faces_edges.is_empty() {
        return None;
    }

    let mut used_edges = normalized
        .faces_edges
        .iter()
        .flatten()
        .copied()
        .collect::<Vec<_>>();
    used_edges.sort_unstable();
    used_edges.dedup();
    if used_edges.is_empty() {
        return None;
    }

    let mut used_vertices = normalized
        .faces_vertices
        .iter()
        .flatten()
        .copied()
        .collect::<Vec<_>>();
    used_vertices.sort_unstable();
    used_vertices.dedup();
    if used_vertices.is_empty() {
        return None;
    }

    let mut vertex_remap = vec![usize::MAX; normalized.vertices_coords.len()];
    let vertices_coords = used_vertices
        .iter()
        .enumerate()
        .filter_map(|(new_id, old_id)| {
            vertex_remap[*old_id] = new_id;
            normalized.vertices_coords.get(*old_id).cloned()
        })
        .collect::<Vec<_>>();

    let mut edge_remap = vec![usize::MAX; normalized.edges_vertices.len()];
    let mut edges_vertices = Vec::with_capacity(used_edges.len());
    let mut edges_assignment = Vec::with_capacity(used_edges.len());
    let mut edges_fold_angle = Vec::new();
    for old_edge in &used_edges {
        let edge = *normalized.edges_vertices.get(*old_edge)?;
        let a = *vertex_remap.get(edge[0])?;
        let b = *vertex_remap.get(edge[1])?;
        if a == usize::MAX || b == usize::MAX {
            return None;
        }
        edge_remap[*old_edge] = edges_vertices.len();
        edges_vertices.push([a, b]);
        edges_assignment.push(normalized.assignment_for_edge(*old_edge));
        if !normalized.edges_fold_angle.is_empty() {
            edges_fold_angle.push(
                normalized
                    .edges_fold_angle
                    .get(*old_edge)
                    .copied()
                    .flatten(),
            );
        }
    }

    let faces_vertices = normalized
        .faces_vertices
        .iter()
        .map(|face| {
            face.iter()
                .filter_map(|vertex| {
                    let remapped = vertex_remap.get(*vertex).copied().unwrap_or(usize::MAX);
                    (remapped != usize::MAX).then_some(remapped)
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let faces_edges = normalized
        .faces_edges
        .iter()
        .map(|face| {
            face.iter()
                .filter_map(|edge| {
                    let remapped = edge_remap.get(*edge).copied().unwrap_or(usize::MAX);
                    (remapped != usize::MAX).then_some(remapped)
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    let mut edges_faces = vec![Vec::<usize>::new(); edges_vertices.len()];
    for (face_id, face_edges) in faces_edges.iter().enumerate() {
        for edge in face_edges {
            edges_faces[*edge].push(face_id);
        }
    }

    let mut compacted = normalized;
    compacted.vertices_coords = vertices_coords;
    compacted.edges_vertices = edges_vertices;
    compacted.edges_assignment = edges_assignment;
    compacted.edges_fold_angle = edges_fold_angle;
    compacted.faces_vertices = faces_vertices;
    compacted.faces_edges = faces_edges;
    compacted.edges_faces = edges_faces;
    Some(compacted)
}

fn classify_failures(
    fold_valid: bool,
    oristudio: &OrieditaCheckReport,
    flat_folder: &FlatFolderCheckReport,
) -> Vec<GlobalFailureClassification> {
    let mut classifications = Vec::new();
    if !fold_valid || oristudio.import_error.is_some() {
        classifications.push(GlobalFailureClassification::InvalidFold);
    }
    if oristudio.camv_violations > 0 || oristudio.check3_markers > 0 {
        classifications.push(GlobalFailureClassification::LocalTheoremFailure);
    }
    match flat_folder.error_kind.as_deref() {
        Some("assignment_conflict") => {
            classifications.push(GlobalFailureClassification::AssignmentConflict)
        }
        Some("precision_failure") => {
            classifications.push(GlobalFailureClassification::PrecisionFailure)
        }
        Some("unsatisfied_component") => {
            classifications.push(GlobalFailureClassification::OverlapOrderConflict)
        }
        Some("unimplemented") => {
            classifications.push(GlobalFailureClassification::UnsupportedGlobalAmbiguity)
        }
        Some("invalid_input") => classifications.push(GlobalFailureClassification::InvalidFold),
        _ => {}
    }
    if classifications.is_empty() {
        classifications.push(GlobalFailureClassification::Clean);
    }
    classifications
}

fn flat_folder_error_kind(error: &FlatFoldError) -> &'static str {
    match error {
        FlatFoldError::InvalidInput(_) => "invalid_input",
        FlatFoldError::PrecisionFailure(_) => "precision_failure",
        FlatFoldError::AssignmentConflict(_) => "assignment_conflict",
        FlatFoldError::UnsatisfiedComponent(_) => "unsatisfied_component",
        FlatFoldError::Unimplemented(_) => "unimplemented",
    }
}

fn report_is_clean(report: &GlobalVerificationReport) -> bool {
    report.classifications == vec![GlobalFailureClassification::Clean]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CandidateProgram;
    use crate::repair::RepairCandidateKind;
    use treemaker_fold::{Assignment, FoldAngle};

    #[test]
    fn valid_square_fold_verifies_cleanly() {
        let document = square_only_fold();

        let report = verify_fold_document(&document, GlobalVerificationOptions::default());

        assert!(report.fold_valid);
        assert_eq!(report.oristudio.camv_violations, 0);
        assert!(report.flat_folder.solved);
        assert_eq!(
            report.classifications,
            vec![GlobalFailureClassification::Clean]
        );
    }

    #[test]
    fn maekawa_violation_is_classified_as_local_theorem_failure() {
        let document = center_star_fold(&[
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Valley,
            Assignment::Valley,
        ]);

        let report = verify_fold_document(
            &document,
            GlobalVerificationOptions {
                run_flat_folder: false,
                ..GlobalVerificationOptions::default()
            },
        );

        assert!(report.fold_valid);
        assert!(report.oristudio.camv_violations > 0);
        assert!(
            report
                .classifications
                .contains(&GlobalFailureClassification::LocalTheoremFailure)
        );
    }

    #[test]
    fn invalid_fold_reports_validation_error() {
        let document = FoldDocument::new(Vec::new(), Vec::new());

        let report = verify_fold_document(&document, GlobalVerificationOptions::default());

        assert!(!report.fold_valid);
        assert!(report.fold_error.is_some());
        assert_eq!(
            report.classifications,
            vec![GlobalFailureClassification::InvalidFold]
        );
    }

    #[test]
    fn flat_folder_error_kinds_are_classified_distinctly() {
        let oristudio = OrieditaCheckReport::default();
        let mut precision = FlatFolderCheckReport::default();
        precision.error_kind = Some("precision_failure".to_owned());
        let mut assignment = FlatFolderCheckReport::default();
        assignment.error_kind = Some("assignment_conflict".to_owned());

        assert_eq!(
            classify_failures(true, &oristudio, &precision),
            vec![GlobalFailureClassification::PrecisionFailure]
        );
        assert_eq!(
            classify_failures(true, &oristudio, &assignment),
            vec![GlobalFailureClassification::AssignmentConflict]
        );
    }

    #[test]
    fn treemaker_flat_folder_preprocess_promotes_cut_boundary_and_compacts_domain() {
        let document = treemaker_cut_cap_fold(true, true);

        let prepared = prepare_flat_folder_document(&document);

        assert_eq!(
            prepared.preprocess.as_deref(),
            Some("treemaker_useful_polygon_boundary")
        );
        assert_eq!(prepared.cut_boundary_edges, vec![6, 7]);
        assert!(
            !prepared.document.faces_vertices.is_empty(),
            "prepared flat-folder input should carry explicit normalized physical faces"
        );
        assert!(
            prepared
                .document
                .extra
                .contains_key("flat_folder_preprocess")
        );
    }

    #[test]
    fn prepared_treemaker_cut_boundary_input_flat_folds() {
        let document = treemaker_cut_cap_fold(true, true);

        let prepared = prepare_flat_folder_document(&document);

        assert_eq!(prepared.cut_boundary_edges, vec![6, 7]);
        solve_flat_fold(&prepared.document, SolveOptions::default())
            .expect("prepared TreeMaker cut-cap document should flat-fold");
    }

    #[test]
    fn flat_folder_preprocess_is_opt_in() {
        let document = treemaker_cut_cap_fold(false, true);

        let prepared = prepare_flat_folder_document(&document);

        assert!(prepared.preprocess.is_none());
        assert!(prepared.cut_boundary_edges.is_empty());
        assert_eq!(prepared.document, document);
    }

    #[test]
    fn feedback_pass_repairs_one_missing_crease_without_unbounded_looping() {
        let document = center_three_crease_fold();
        let value = serde_json::to_value(&document).expect("fold value");
        let program = CandidateProgram::from_fold_value(&value).expect("candidate program");

        let report = verify_program_with_feedback(
            &program,
            GlobalVerificationLoopOptions {
                topology: crate::optimizer::TopologyOptimizerOptions {
                    preserve_boundary: false,
                    repair_options: crate::repair::RepairCandidateOptions {
                        inferred_edge_penalty: 4.0,
                        selected_weak_edge_penalty: 8.0,
                        rejected_observed_support_penalty: 12.0,
                        ..crate::repair::RepairCandidateOptions::default()
                    },
                    ..crate::optimizer::TopologyOptimizerOptions::default()
                },
                ..GlobalVerificationLoopOptions::default()
            },
        );

        assert!(!report_is_clean(&report.initial));
        assert!(report.feedback_applied);
        assert!(report.topology_moves.iter().any(|record| matches!(
            record.candidate.kind,
            RepairCandidateKind::AddMissingCrease { .. }
        )));
        assert!(
            report
                .assignment_decisions
                .iter()
                .any(|decision| decision.provenance == crate::Provenance::AssignmentInferred)
        );
        assert_eq!(
            report
                .after_feedback
                .as_ref()
                .expect("after feedback")
                .classifications,
            vec![GlobalFailureClassification::Clean]
        );
    }

    fn square_only_fold() -> FoldDocument {
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
            ],
            vec![[0, 1], [1, 2], [2, 3], [3, 0]],
        );
        document.edges_assignment = vec![Assignment::Boundary; 4];
        document.edges_fold_angle = vec![None; 4];
        document
    }

    fn center_star_fold(assignments: &[Assignment; 4]) -> FoldDocument {
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
                vec![0.5, 0.5],
                vec![1.0, 0.5],
                vec![0.5, 1.0],
                vec![0.0, 0.5],
                vec![0.5, 0.0],
            ],
            vec![
                [0, 8],
                [8, 1],
                [1, 5],
                [5, 2],
                [2, 6],
                [6, 3],
                [3, 7],
                [7, 0],
                [4, 5],
                [4, 6],
                [4, 7],
                [4, 8],
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
            assignments[0],
            assignments[1],
            assignments[2],
            assignments[3],
        ];
        document.edges_fold_angle = document
            .edges_assignment
            .iter()
            .map(|assignment| FoldAngle::default_for_assignment(*assignment))
            .collect();
        document
    }

    fn center_three_crease_fold() -> FoldDocument {
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
                vec![0.5, 0.5],
                vec![1.0, 0.5],
                vec![0.5, 1.0],
                vec![0.0, 0.5],
            ],
            vec![
                [0, 1],
                [1, 5],
                [5, 2],
                [2, 6],
                [6, 3],
                [3, 7],
                [7, 0],
                [4, 5],
                [4, 6],
                [4, 7],
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
            Assignment::Mountain,
            Assignment::Mountain,
            Assignment::Valley,
        ];
        document.edges_fold_angle = document
            .edges_assignment
            .iter()
            .map(|assignment| FoldAngle::default_for_assignment(*assignment))
            .collect();
        document
    }

    fn treemaker_cut_cap_fold(with_hint: bool, include_internal_crease: bool) -> FoldDocument {
        let mut edges = vec![
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 4],
            [4, 5],
            [5, 0],
            [1, 6],
            [6, 2],
        ];
        if include_internal_crease {
            edges.push([6, 4]);
        }
        let mut document = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![0.25, 0.0],
                vec![0.75, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
                vec![0.5, 0.25],
                vec![0.5, 0.75],
            ],
            edges,
        );
        document.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Flat,
            Assignment::Flat,
        ];
        if include_internal_crease {
            document.edges_assignment.push(Assignment::Mountain);
        }
        document.edges_fold_angle = document
            .edges_assignment
            .iter()
            .map(|assignment| FoldAngle::default_for_assignment(*assignment))
            .collect();
        if with_hint {
            document.extra.insert(
                "cp_detector".to_owned(),
                json!({"flat_folder_boundary_hint": "treemaker_useful_polygon"}),
            );
        }
        document
    }
}
