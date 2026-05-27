use crate::arrangement::SquareArrangementSummary;
use crate::constraints::ConstraintDiagnostics;
use crate::{COMPILER_BACKEND_ID, CandidateProgram};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompilerReport {
    pub backend: String,
    pub mode: String,
    pub summary: CompilerSummary,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arrangement: Option<SquareArrangementSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraints: Option<ConstraintDiagnostics>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy_report: Option<Value>,
}

impl CompilerReport {
    pub fn noop(
        program: &CandidateProgram,
        arrangement: Option<SquareArrangementSummary>,
        constraints: Option<ConstraintDiagnostics>,
        legacy_report: Option<Value>,
    ) -> Self {
        Self {
            backend: COMPILER_BACKEND_ID.to_owned(),
            mode: "noop_legacy_passthrough".to_owned(),
            summary: CompilerSummary::from_program(program),
            arrangement,
            constraints,
            legacy_report,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompilerSummary {
    pub carriers: usize,
    pub vertices: usize,
    pub edges: usize,
    pub border_edges: usize,
    pub interior_edges: usize,
    pub inferred_edges: usize,
}

impl CompilerSummary {
    pub fn from_program(program: &CandidateProgram) -> Self {
        let selected_vertex_ids = program
            .edges
            .iter()
            .filter(|edge| edge.selection == crate::EdgeSelection::Selected)
            .flat_map(|edge| edge.vertices)
            .collect::<std::collections::BTreeSet<_>>();
        let border_edges = program
            .edges
            .iter()
            .filter(|edge| edge.selection == crate::EdgeSelection::Selected)
            .filter(|edge| edge.assignment.label == crate::AssignmentLabel::Boundary)
            .count();
        let inferred_edges = program
            .edges
            .iter()
            .filter(|edge| edge.selection == crate::EdgeSelection::Selected)
            .filter(|edge| edge.source == crate::EvidenceSource::Inferred)
            .count();
        let edges = program
            .edges
            .iter()
            .filter(|edge| edge.selection == crate::EdgeSelection::Selected)
            .count();
        Self {
            carriers: program.carriers.len(),
            vertices: selected_vertex_ids.len(),
            edges,
            border_edges,
            interior_edges: edges.saturating_sub(border_edges),
            inferred_edges,
        }
    }
}
