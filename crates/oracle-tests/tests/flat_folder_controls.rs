//! Unconditional flat-fold coverage over the small hand-authored FOLD controls in
//! `tests/fixtures/folding-sequence/fold/`. Unlike the Flat-Folder oracle and
//! corpus tests, this needs no external oracle or dataset, so it runs on every
//! `cargo test -p oracle-tests`.

use std::fs;
use std::path::{Path, PathBuf};

use treemaker_flatfold::{SolutionLimit, SolveOptions, solve_flat_fold};
use treemaker_fold::{FoldDocument, validate_basic};

mod support;
use support::repo_root;

const CONTROL_DIR: &str = "tests/fixtures/folding-sequence/fold";
const CONTROL_COUNT: usize = 6;

#[test]
fn flat_fold_controls_parse_and_solve() {
    let paths = control_paths();
    assert_eq!(
        paths.len(),
        CONTROL_COUNT,
        "{CONTROL_DIR} should hold exactly the {CONTROL_COUNT} FOLD controls"
    );

    for path in &paths {
        let id = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_else(|| panic!("{}: non-UTF-8 file stem", path.display()));
        let fold = read_fold(path);
        validate_basic(&fold).unwrap_or_else(|err| panic!("{id}: {err}"));
        assert!(
            fold.frame_classes
                .iter()
                .any(|class| class == "creasePattern"),
            "{id}: expected creasePattern frame class"
        );
        assert!(
            !fold.faces_vertices.is_empty(),
            "{id}: expected explicit faces"
        );
        assert_eq!(
            fold.edges_assignment.len(),
            fold.edges_vertices.len(),
            "{id}: assignments should cover every edge"
        );

        let solved = solve_flat_fold(
            &fold,
            SolveOptions {
                solution_limit: SolutionLimit::Count(10),
                ..SolveOptions::default()
            },
        )
        .unwrap_or_else(|err| panic!("{id}: flat-fold solve failed: {err}"));
        assert_eq!(
            solved.analysis.normalized.document.faces_vertices.len(),
            solved.analysis.faces_flip.len(),
            "{id}: each normalized face should have a flip flag"
        );
        assert!(
            solved.analysis.overlap.is_some(),
            "{id}: analysis should include an overlap graph"
        );
        assert!(
            !solved.states.is_empty(),
            "{id}: solver should report at least one state marker"
        );
    }
}

fn control_paths() -> Vec<PathBuf> {
    let dir = repo_root().join(CONTROL_DIR);
    let mut paths = fs::read_dir(&dir)
        .unwrap_or_else(|err| panic!("{}: {err}", dir.display()))
        .map(|entry| {
            entry
                .unwrap_or_else(|err| panic!("{}: {err}", dir.display()))
                .path()
        })
        .filter(|path| path.extension().is_some_and(|ext| ext == "fold"))
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn read_fold(path: &Path) -> FoldDocument {
    let text = fs::read_to_string(path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}
