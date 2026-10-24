//! Flat-Folder-derived flat-foldability and layer-order solver.
//!
//! This crate is intentionally independent from TreeMaker's tree engine. It
//! exposes a stage-oriented API so the Rust port can be validated against the
//! original Flat-Folder implementation without substituting approximate
//! algorithms while the port is in progress.
//!
//! [`solve_flat_fold`] runs the whole pipeline on a crease pattern.
//! [`complete_layer_order`] runs only its propagation and search, over
//! variables, constraints and cells the caller built.

mod avl;
mod completion;
mod constraints;
mod conversion;
mod math;
mod session;
mod tables;

pub use session::{
    CheckFit, CheckNoOrder, CheckOptions, CheckOutcome, CheckStage, CompletionSession, Deduced,
    Deduction, Enumeration, EnumerationStep, SessionStart,
};

pub use completion::{
    BudgetLimit, Completion, CompletionConflict, CompletionError, CompletionOptions,
    CompletionProblem, CompletionSolution, ComponentSolutions, ConstraintKind, Deadline,
    FixedAssignment, FixedKind, PairOrder, SearchBudget, UnsatisfiedComponent, VariableConstraints,
    complete_layer_order, flat_folder_completion_problem,
};
use conversion::{build_overlap_graph, normalize_document, project_normalized};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use treemaker_fold::{Assignment, FoldDocument};

pub type Result<T> = std::result::Result<T, FlatFoldError>;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum FlatFoldError {
    #[error("invalid FOLD input: {0}")]
    InvalidInput(String),
    #[error("flat-folder precision failure: {0}")]
    PrecisionFailure(String),
    #[error("assignment conflict: {0}")]
    AssignmentConflict(String),
    #[error("unsatisfied component: {0}")]
    UnsatisfiedComponent(String),
    #[error("flat-folder stage is not yet implemented: {0}")]
    Unimplemented(&'static str),
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum PaperSide {
    #[default]
    Front,
    Back,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SolutionLimit {
    All,
    Count(usize),
}

impl Default for SolutionLimit {
    fn default() -> Self {
        Self::Count(10)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub enum EpsilonPolicy {
    #[default]
    FlatFolderDefault,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct NormalizeOptions {
    pub side: PaperSide,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyzeOptions {
    pub normalize: NormalizeOptions,
    pub epsilon_policy: EpsilonPolicy,
    pub include_overlap_graph: bool,
}

impl Default for AnalyzeOptions {
    fn default() -> Self {
        Self {
            normalize: NormalizeOptions::default(),
            epsilon_policy: EpsilonPolicy::default(),
            include_overlap_graph: true,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SolveOptions {
    pub analyze: AnalyzeOptions,
    pub starting_face: Option<usize>,
    pub solution_limit: SolutionLimit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NormalizedFold {
    pub document: FoldDocument,
    pub vertex_vertices: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Analysis {
    pub normalized: NormalizedFold,
    pub folded_vertices: Vec<[f64; 2]>,
    pub faces_flip: Vec<bool>,
    pub overlap: Option<OverlapGraph>,
    pub diagnostics: Vec<FlatFoldDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OverlapGraph {
    pub points: Vec<[f64; 2]>,
    pub segments_points: Vec<[usize; 2]>,
    pub segments_edges: Vec<Vec<usize>>,
    pub segments_cells: Vec<Vec<usize>>,
    pub cells_segments: Vec<Vec<usize>>,
    pub cells_points: Vec<Vec<usize>>,
    pub cells_faces: Vec<Vec<usize>>,
    pub faces_cells: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SolveResult {
    pub analysis: Analysis,
    pub constraints: ConstraintSummary,
    pub component_sizes: Vec<usize>,
    pub solution_counts: Vec<usize>,
    pub states: String,
    pub face_orders: Vec<[i64; 3]>,
    pub diagnostics: Vec<FlatFoldDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConstraintSummary {
    pub variables: usize,
    pub taco_taco: usize,
    pub taco_tortilla: usize,
    pub tortilla_tortilla: usize,
    pub transitivity: usize,
    pub reduced_transitivity: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlatFoldDiagnostic {
    pub code: String,
    pub message: String,
}

pub fn normalize_fold(
    document: &FoldDocument,
    options: NormalizeOptions,
) -> Result<NormalizedFold> {
    normalize_document(document, options)
}

pub fn analyze_flat_fold(document: &FoldDocument, options: AnalyzeOptions) -> Result<Analysis> {
    let normalized = normalize_fold(document, options.normalize)?;
    let (folded_vertices, faces_flip) = project_normalized(&normalized)?;
    let overlap = if options.include_overlap_graph {
        Some(build_overlap_graph(&normalized, &folded_vertices)?)
    } else {
        None
    };
    Ok(Analysis {
        normalized,
        folded_vertices,
        faces_flip,
        overlap,
        diagnostics: Vec::new(),
    })
}

pub fn solve_flat_fold(document: &FoldDocument, options: SolveOptions) -> Result<SolveResult> {
    if let Some(starting_face) = options.starting_face
        && starting_face != 0
    {
        return Err(FlatFoldError::Unimplemented("custom starting_face"));
    }
    let mut analyze_options = options.analyze;
    analyze_options.include_overlap_graph = true;
    let analysis = analyze_flat_fold(document, analyze_options)?;
    let constraints = constraints::build_constraint_state(&analysis)?;
    let solution =
        constraints::solve_constraint_state(&analysis, &constraints, &options.solution_limit)?;
    Ok(SolveResult {
        analysis,
        constraints: constraints.summary(),
        component_sizes: solution.component_sizes,
        solution_counts: solution.solution_counts,
        states: solution.states,
        face_orders: solution.face_orders,
        diagnostics: Vec::new(),
    })
}

/// Infer simulator-friendly mountain/valley assignments from solved face orders.
pub fn infer_edge_assignments_from_face_orders(
    document: &FoldDocument,
    face_orders: &[[i64; 3]],
) -> Vec<Assignment> {
    let mut assignments = (0..document.edges_vertices.len())
        .map(|edge| document.assignment_for_edge(edge))
        .collect::<Vec<_>>();
    let mut orientation_by_faces = BTreeMap::new();
    for [face_a, face_b, orientation] in face_orders {
        let (Ok(face_a), Ok(face_b)) = (usize::try_from(*face_a), usize::try_from(*face_b)) else {
            continue;
        };
        orientation_by_faces.insert(unordered_pair(face_a, face_b), *orientation);
    }

    for (edge_index, faces) in document.edges_faces.iter().enumerate() {
        if edge_index >= assignments.len()
            || assignments[edge_index] != Assignment::Unassigned
            || faces.len() != 2
        {
            continue;
        }
        let Some(orientation) = orientation_by_faces.get(&unordered_pair(faces[0], faces[1]))
        else {
            continue;
        };
        assignments[edge_index] = if *orientation < 0 {
            Assignment::Mountain
        } else {
            Assignment::Valley
        };
    }

    assignments
}

fn unordered_pair(a: usize, b: usize) -> [usize; 2] {
    if a < b { [a, b] } else { [b, a] }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square_doc() -> FoldDocument {
        FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
            ],
            vec![[0, 1], [1, 2], [2, 3], [3, 0]],
        )
    }

    #[test]
    fn solve_boundary_square_has_empty_face_orders() {
        let doc = square_doc();
        let solved = solve_flat_fold(&doc, SolveOptions::default()).unwrap();

        assert_eq!(solved.constraints.variables, 0);
        assert_eq!(solved.component_sizes, vec![0]);
        assert_eq!(solved.solution_counts, vec![1]);
        assert_eq!(solved.states, "1");
        assert!(solved.face_orders.is_empty());
    }

    #[test]
    fn normalize_defaults_missing_assignments_to_unassigned() {
        let doc = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
            ],
            vec![[0, 1], [1, 2], [2, 3], [3, 0]],
        );

        let normalized = normalize_fold(&doc, NormalizeOptions::default()).unwrap();

        assert_eq!(normalized.document.vertices_coords.len(), 4);
        assert_eq!(normalized.document.edges_vertices.len(), 4);
        assert_eq!(normalized.document.faces_vertices.len(), 1);
        assert_eq!(
            normalized.document.edges_assignment,
            vec![Assignment::Boundary; 4]
        );
    }

    #[test]
    fn normalize_flips_faceless_front_side_mountain_valley_assignments() {
        let mut doc = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
                vec![0.0, 0.5],
                vec![1.0, 0.5],
            ],
            vec![[0, 1], [1, 2], [2, 3], [3, 0], [4, 5]],
        );
        doc.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
        ];

        let normalized = normalize_fold(&doc, NormalizeOptions::default()).unwrap();

        assert_eq!(normalized.document.faces_vertices.len(), 2);
        assert_eq!(
            normalized
                .document
                .edges_assignment
                .iter()
                .filter(|assignment| **assignment == Assignment::Valley)
                .count(),
            1
        );
        assert!(
            !normalized
                .document
                .edges_assignment
                .contains(&Assignment::Mountain)
        );
    }

    #[test]
    fn normalize_splits_crossing_and_vertex_on_segment_lines() {
        let mut doc = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
                vec![0.0, 0.5],
                vec![1.0, 0.5],
                vec![0.5, 0.0],
                vec![0.5, 1.0],
            ],
            vec![[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [6, 7]],
        );
        doc.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
            Assignment::Valley,
        ];

        let normalized = normalize_fold(&doc, NormalizeOptions::default()).unwrap();

        assert_eq!(normalized.document.vertices_coords.len(), 9);
        assert_eq!(normalized.document.edges_vertices.len(), 12);
        assert_eq!(normalized.document.faces_vertices.len(), 4);
        assert_eq!(
            normalized
                .document
                .edges_assignment
                .iter()
                .filter(|assignment| **assignment == Assignment::Boundary)
                .count(),
            8
        );
        assert_eq!(
            normalized
                .document
                .edges_assignment
                .iter()
                .filter(|assignment| **assignment == Assignment::Mountain)
                .count(),
            2
        );
        assert_eq!(
            normalized
                .document
                .edges_assignment
                .iter()
                .filter(|assignment| **assignment == Assignment::Valley)
                .count(),
            2
        );
    }

    #[test]
    fn analyze_projects_flat_fold_when_overlap_graph_is_not_requested() {
        let mut doc = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
            ],
            vec![[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
        );
        doc.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
        ];
        doc.faces_vertices = vec![vec![0, 1, 2], vec![0, 2, 3]];

        let analysis = analyze_flat_fold(
            &doc,
            AnalyzeOptions {
                include_overlap_graph: false,
                ..AnalyzeOptions::default()
            },
        )
        .unwrap();

        assert_eq!(analysis.folded_vertices.len(), 4);
        assert_eq!(analysis.faces_flip, vec![false, true]);
        assert!(analysis.overlap.is_none());
    }

    #[test]
    fn infer_edge_assignments_from_face_orders_assigns_unassigned_two_face_creases() {
        let mut doc = square_doc();
        doc.edges_vertices.push([0, 2]);
        doc.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Unassigned,
        ];
        doc.faces_vertices = vec![vec![0, 1, 2], vec![0, 2, 3]];
        doc.edges_faces = vec![vec![0], vec![0], vec![1], vec![1], vec![0, 1]];

        let mountain = infer_edge_assignments_from_face_orders(&doc, &[[0, 1, -1]]);
        let valley = infer_edge_assignments_from_face_orders(&doc, &[[0, 1, 1]]);

        assert_eq!(mountain[4], Assignment::Mountain);
        assert_eq!(valley[4], Assignment::Valley);
    }

    #[test]
    fn infer_edge_assignments_from_face_orders_preserves_explicit_and_unresolved_edges() {
        let mut doc = square_doc();
        doc.edges_vertices.push([0, 2]);
        doc.edges_assignment = vec![
            Assignment::Unassigned,
            Assignment::Mountain,
            Assignment::Valley,
            Assignment::Boundary,
            Assignment::Unassigned,
        ];
        doc.faces_vertices = vec![vec![0, 1, 2], vec![0, 2, 3]];
        doc.edges_faces = vec![vec![0], vec![0], vec![1], vec![1], vec![0, 1]];

        let assignments = infer_edge_assignments_from_face_orders(&doc, &[]);

        assert_eq!(assignments[0], Assignment::Unassigned);
        assert_eq!(assignments[1], Assignment::Mountain);
        assert_eq!(assignments[2], Assignment::Valley);
        assert_eq!(assignments[3], Assignment::Boundary);
        assert_eq!(assignments[4], Assignment::Unassigned);
    }

    #[test]
    fn analyze_builds_overlap_graph_by_default() {
        let mut doc = FoldDocument::new(
            vec![
                vec![0.0, 0.0],
                vec![1.0, 0.0],
                vec![1.0, 1.0],
                vec![0.0, 1.0],
            ],
            vec![[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
        );
        doc.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
        ];
        doc.faces_vertices = vec![vec![0, 1, 2], vec![0, 2, 3]];

        let analysis = analyze_flat_fold(&doc, AnalyzeOptions::default()).unwrap();
        let overlap = analysis.overlap.unwrap();

        assert!(!overlap.points.is_empty());
        assert!(!overlap.segments_points.is_empty());
        assert_eq!(
            overlap.faces_cells.len(),
            analysis.normalized.document.faces_vertices.len()
        );
    }

    #[test]
    fn constraint_counts_match_flat_folder_kabuto_fixture() {
        let document: FoldDocument = serde_json::from_str(include_str!(
            "../../../tests/fixtures/flat-folder/kabuto.fold"
        ))
        .unwrap();
        let analysis = analyze_flat_fold(&document, AnalyzeOptions::default()).unwrap();
        let constraints = crate::constraints::build_constraint_state(&analysis).unwrap();

        assert_eq!(constraints.variables.len(), 117);
        assert_eq!(constraints.constraint_counts.taco_taco, 21);
        assert_eq!(constraints.constraint_counts.taco_tortilla, 88);
        assert_eq!(constraints.constraint_counts.tortilla_tortilla, 0);
        assert_eq!(constraints.transitivity_counts.all / 3, 420);
        assert_eq!(constraints.transitivity_counts.reduced / 3, 284);
        assert_eq!(constraints.groups.len(), 3);
        assert_eq!(
            constraints.groups.iter().map(Vec::len).collect::<Vec<_>>(),
            vec![81, 18, 18]
        );
    }

    #[test]
    fn solve_matches_flat_folder_kabuto_fixture_counts() {
        let document: FoldDocument = serde_json::from_str(include_str!(
            "../../../tests/fixtures/flat-folder/kabuto.fold"
        ))
        .unwrap();
        let solved = solve_flat_fold(&document, SolveOptions::default()).unwrap();

        assert_eq!(solved.constraints.variables, 117);
        assert_eq!(solved.component_sizes, vec![81, 18, 18]);
        assert_eq!(solved.solution_counts, vec![1, 3, 3]);
        assert_eq!(solved.states, "9");
        assert_eq!(solved.face_orders.len(), 117);
    }
}
