//! Constraint-aware crease-pattern compiler core.
//!
//! Phase 2 establishes the compiler data model and a no-op compile path. Later
//! phases replace the no-op path with exact arrangement, diagnostics, repair,
//! assignment solving, and verification.

pub mod arrangement;
pub mod assignments;
pub mod border;
pub mod candidates;
pub mod constraints;
pub mod evidence;
pub mod exactize;
pub mod fold_export;
pub mod optimizer;
pub mod repair;
pub mod report;
pub mod verify;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use candidates::{
    AssignmentCandidate, AssignmentLabel, CandidateCarrier, CandidateEdge, CandidateProgram,
    CandidateVertex, CarrierFamily, EdgeSelection, Point2, VertexKind,
};
pub use constraints::{ConstraintDiagnostics, ConstraintSeverity, VertexConstraintDiagnostic};
pub use evidence::{EvidenceSource, Provenance};
pub use report::{CompilerReport, CompilerSummary};

pub const COMPILER_BACKEND_ID: &str = "constraint_compiler_v1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompilerOutput {
    pub fold_json: String,
    pub program: CandidateProgram,
    pub report: CompilerReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NoopCompileInput {
    pub fold_json: String,
    #[serde(default)]
    pub legacy_report: Option<Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum CompilerError {
    #[error("invalid FOLD JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("FOLD document is missing {0}")]
    MissingField(&'static str),
    #[error("FOLD {field} entry {index} is invalid")]
    InvalidEntry { field: &'static str, index: usize },
}

pub fn compile_noop(input: NoopCompileInput) -> Result<CompilerOutput, CompilerError> {
    let fold_value: Value = serde_json::from_str(&input.fold_json)?;
    let program = CandidateProgram::from_fold_value(&fold_value)?;
    let arrangement =
        arrangement::build_square_arrangement(&program, arrangement::ArrangementOptions::default());
    let diagnostics = constraints::diagnose_constraints(
        &program,
        constraints::ConstraintDiagnosticOptions::default(),
    );
    let report = CompilerReport::noop(
        &program,
        Some(arrangement.summary()),
        Some(diagnostics),
        input.legacy_report,
    );
    Ok(CompilerOutput {
        fold_json: input.fold_json,
        program,
        report,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn noop_compiler_preserves_fold_json_and_reports_program_summary() {
        let fold = json!({
            "file_spec": 1.1,
            "vertices_coords": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
            "edges_vertices": [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
            "edges_assignment": ["B", "B", "B", "B", "M"],
            "cp_detector": {
                "edge_support": [1.0, 1.0, 1.0, 1.0, 0.75],
                "assignment_confidence": [1.0, 1.0, 1.0, 1.0, 0.8],
                "assignment_source": ["observed", "observed", "observed", "observed", "observed"]
            }
        });
        let fold_json = serde_json::to_string_pretty(&fold).expect("fold JSON");
        let output = compile_noop(NoopCompileInput {
            fold_json: fold_json.clone(),
            legacy_report: Some(json!({"status": "valid"})),
        })
        .expect("noop compile");

        assert_eq!(output.fold_json, fold_json);
        assert_eq!(output.program.vertices.len(), 4);
        assert_eq!(output.program.edges.len(), 5);
        assert_eq!(output.program.carriers.len(), 5);
        assert_eq!(output.report.backend, COMPILER_BACKEND_ID);
        assert_eq!(output.report.summary.border_edges, 4);
        assert_eq!(output.report.summary.interior_edges, 1);
        assert!(
            output.report.constraints.is_some(),
            "compiler report should carry import-mode diagnostics"
        );
    }

    #[test]
    fn candidate_program_round_trips_through_json() {
        let fold = json!({
            "vertices_coords": [[0.0, 0.0], [1.0, 1.0]],
            "edges_vertices": [[0, 1]],
            "edges_assignment": ["V"]
        });
        let program = CandidateProgram::from_fold_value(&fold).expect("program");
        let encoded = serde_json::to_string(&program).expect("encode");
        let decoded: CandidateProgram = serde_json::from_str(&encoded).expect("decode");

        assert_eq!(decoded, program);
        assert_eq!(decoded.edges[0].assignment.label, AssignmentLabel::Valley);
    }
}
