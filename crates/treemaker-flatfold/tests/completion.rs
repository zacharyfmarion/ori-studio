//! The completion entry point over Flat-Folder's own constraints must give
//! back exactly what the full pipeline gives: same components, same counts,
//! same first solution, and on a conflict the faces upstream names.

use treemaker_flatfold::{
    AnalyzeOptions, Completion, CompletionConflict, CompletionOptions, CompletionProblem,
    CompletionSolution, ConstraintKind, FlatFoldError, PairOrder, SolutionLimit, SolveOptions,
    analyze_flat_fold, complete_layer_order, flat_folder_completion_problem, solve_flat_fold,
};
use treemaker_fold::FoldDocument;

const FIXTURES: [&str; 8] = [
    "flat-folder/kabuto.fold",
    "flat-folder/r271-s03.fold",
    "folding-sequence/fold/accordion-book-fold.fold",
    "folding-sequence/fold/kite-rabbit-ear-local.fold",
    "folding-sequence/fold/simple-valley.fold",
    "folding-sequence/fold/simultaneous-collapse-unsupported.fold",
    "folding-sequence/fold/squash-local.fold",
    "folding-sequence/fold/treemaker-triad-base.fold",
];

fn fixture(name: &str) -> FoldDocument {
    let path = format!("{}/../../tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{path}: {err}"));
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("{path}: {err}"))
}

fn own_problem(document: &FoldDocument) -> (CompletionProblem, Vec<bool>) {
    let analysis = analyze_flat_fold(document, AnalyzeOptions::default()).expect("analysis");
    let problem = flat_folder_completion_problem(&analysis).expect("problem");
    (problem, analysis.faces_flip)
}

/// The first solution as FOLD face orders, in the order `solve_flat_fold`
/// lists them: the forced variables by index, then each component's.
fn first_face_orders(
    problem: &CompletionProblem,
    solution: &CompletionSolution,
    faces_flip: &[bool],
) -> Vec<[i64; 3]> {
    let triple = |variable: usize, order: PairOrder| {
        let [f, g] = problem.variables[variable];
        let (above, below) = match order {
            PairOrder::FirstAbove => (f, g),
            PairOrder::SecondAbove => (g, f),
        };
        [
            above as i64,
            below as i64,
            if faces_flip[below] { 1 } else { -1 },
        ]
    };
    let forced = solution
        .forced
        .iter()
        .enumerate()
        .filter_map(|(variable, order)| order.map(|order| triple(variable, order)));
    let free = solution.components.iter().flat_map(|component| {
        component
            .variables
            .iter()
            .zip(&component.solutions[0])
            .map(|(variable, order)| triple(*variable, *order))
    });
    forced.chain(free).collect()
}

#[test]
fn flat_folders_own_problem_reproduces_solve_flat_fold() {
    for name in FIXTURES {
        let document = fixture(name);
        let solved = solve_flat_fold(&document, SolveOptions::default())
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        let (problem, faces_flip) = own_problem(&document);
        let options = CompletionOptions {
            solution_limit: SolveOptions::default().solution_limit,
            ..CompletionOptions::default()
        };
        let Completion::Solved(completed) =
            complete_layer_order(&problem, &options).unwrap_or_else(|err| panic!("{name}: {err}"))
        else {
            panic!("{name}: the completion did not solve");
        };
        assert_eq!(
            problem.variables.len(),
            solved.constraints.variables,
            "{name}"
        );
        let forced = completed.forced.iter().flatten().count();
        let sizes = std::iter::once(forced)
            .chain(completed.components.iter().map(|c| c.variables.len()))
            .collect::<Vec<_>>();
        assert_eq!(sizes, solved.component_sizes, "{name} component sizes");
        assert_eq!(
            completed.solution_counts(),
            solved.solution_counts,
            "{name}"
        );
        assert_eq!(completed.states(), solved.states, "{name}");
        assert_eq!(
            first_face_orders(&problem, &completed, &faces_flip),
            solved.face_orders,
            "{name} first solution"
        );
    }
}

#[test]
fn a_seed_conflict_names_the_faces_upstream_names() {
    // The JS oracle reports this fixture as an assignment conflict on
    // transitivity [2, 3, 1], with conflict faces [0, 1, 2, 3].
    let document = fixture("flat-folder/bad_twist.fold");
    assert!(matches!(
        solve_flat_fold(&document, SolveOptions::default()),
        Err(FlatFoldError::AssignmentConflict(_))
    ));
    let (problem, _) = own_problem(&document);
    assert_eq!(
        complete_layer_order(&problem, &CompletionOptions::default()),
        Ok(Completion::Conflict(CompletionConflict {
            constraint: ConstraintKind::Transitivity,
            faces: vec![2, 3, 1],
            error_faces: vec![0, 1, 2, 3],
        }))
    );
}

#[test]
fn every_solution_of_a_component_is_returned() {
    // kabuto has two free components of three solutions each.
    let (problem, _) = own_problem(&fixture("flat-folder/kabuto.fold"));
    let options = CompletionOptions {
        solution_limit: SolutionLimit::All,
        ..CompletionOptions::default()
    };
    let Ok(Completion::Solved(completed)) = complete_layer_order(&problem, &options) else {
        panic!("kabuto did not solve");
    };
    assert_eq!(completed.solution_counts(), vec![1, 3, 3]);
    assert!(!completed.truncated());
    let mut distinct = std::collections::BTreeSet::new();
    for first in 0..3 {
        for second in 0..3 {
            let orders = completed
                .assignment(&[first, second])
                .expect("a complete order");
            assert!(distinct.insert(format!("{orders:?}")));
        }
    }
    assert_eq!(completed.assignment(&[3, 0]), None);
}
