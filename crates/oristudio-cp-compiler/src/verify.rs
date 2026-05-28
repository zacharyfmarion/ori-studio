use crate::CandidateProgram;
use crate::assignments::{AssignmentDecision, AssignmentSolverOptions, solve_assignments};
use crate::fold_export::export_program_to_fold_document;
use crate::optimizer::{TopologyMoveRecord, TopologyOptimizerOptions, optimize_topology};
use oristudio_cp::checks::{check_camv_task, check1, check2, check3};
use oristudio_cp::io::fold::import_fold_document;
use serde::{Deserialize, Serialize};
use treemaker_flatfold::{FlatFoldError, SolutionLimit, SolveOptions, solve_flat_fold};
use treemaker_fold::{FoldDocument, validate_basic};

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
    pub error_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub face_orders: usize,
    pub constraint_variables: usize,
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
    let options = SolveOptions {
        solution_limit: SolutionLimit::Count(solution_limit.max(1)),
        ..SolveOptions::default()
    };
    match solve_flat_fold(document, options) {
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
}
