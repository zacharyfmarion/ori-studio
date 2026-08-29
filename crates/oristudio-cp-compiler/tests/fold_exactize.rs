//! Gate for `fold_exactize`. The exact-solve clears the `Angles` (Kawasaki) CAMV
//! violations and strictly reduces the total, so a real square-paper TreeMaker CP
//! is adopted (residual `LittleBigLittle`/assignment violations are left for the
//! user). A non-square (triangle-paper) CP falls back unchanged.

use oristudio_cp_compiler::{ExactSolveOptions, ExactizeStatus, exactize_fold, exactize_fold_json};
use treemaker_core::Tree;
use treemaker_fold::FoldDocument;

/// Build a real TreeMaker crease pattern FOLD the same way the app does.
fn treemaker_fold(tmd5: &str) -> FoldDocument {
    let mut tree = Tree::from_tmd_str(tmd5).expect("parse tmd5");
    tree.optimize_scale().expect("optimize");
    tree.build_polys_and_crease_pattern().expect("build cp");
    tree.to_fold_document().expect("to fold")
}

fn options() -> ExactSolveOptions {
    // Disable the wall-clock deadline so the test is deterministic; the sparse
    // solver is still bounded by its iteration cap.
    ExactSolveOptions {
        timeout_seconds: -1.0,
        ..ExactSolveOptions::default()
    }
}

#[test]
fn square_paper_cp_is_adopted_kawasaki_clean() {
    let fold = treemaker_fold(include_str!(
        "../../treemaker-core/testdata/tmModelTester_5.tmd5"
    ));
    let outcome = exactize_fold(&fold, options());

    // The raw CP fails CAMV (all `Angles`); the solve clears Kawasaki and strictly
    // reduces total violations, so the result is adopted. Residual `LittleBigLittle`
    // (assignment) violations may remain — those are the user's to fix.
    assert_eq!(
        outcome.status,
        ExactizeStatus::Exactized,
        "square CP should be adopted (reason: {:?})",
        outcome.fallback_reason
    );
    assert!(
        outcome.camv_violations_before > 0,
        "precondition: raw CP fails CAMV"
    );
    assert!(
        outcome.camv_violations_after < outcome.camv_violations_before,
        "must strictly reduce violations: {} -> {}",
        outcome.camv_violations_before,
        outcome.camv_violations_after,
    );
    // Topology preserved; movement is sub-pixel (default budget 0.01 of the paper).
    assert_eq!(outcome.fold.edges_vertices.len(), fold.edges_vertices.len());
    assert!(
        outcome.max_vertex_movement < 0.01,
        "vertex movement exceeded budget: {:.3e}",
        outcome.max_vertex_movement
    );
}

#[test]
fn non_square_paper_falls_back_unchanged() {
    // tmModelTester_1 has triangular paper, which the unit-square solver can't
    // model yet — exactize must return the original untouched, not error.
    let fold = treemaker_fold(include_str!(
        "../../treemaker-core/testdata/tmModelTester_1.tmd5"
    ));
    let outcome = exactize_fold(&fold, options());

    assert_eq!(outcome.status, ExactizeStatus::Unchanged);
    assert!(outcome.fallback_reason.is_some());
    assert_eq!(
        outcome.fold.vertices_coords, fold.vertices_coords,
        "fallback must return the original FOLD verbatim"
    );
}

/// The string-in/string-out entry point the wasm binding calls: always returns a
/// valid FOLD (exactized when clean, else the original) and never throws.
#[test]
fn exactize_fold_json_round_trips_and_passes_garbage_through() {
    let fold = treemaker_fold(include_str!(
        "../../treemaker-core/testdata/tmModelTester_5.tmd5"
    ));
    let input_json = serde_json::to_string(&fold).expect("serialize fold");
    let output_json = exactize_fold_json(&input_json, options());
    // The output parses as a FOLD with the same topology (whether snapped or not).
    let out: FoldDocument = serde_json::from_str(&output_json).expect("output parses");
    assert_eq!(out.edges_vertices.len(), fold.edges_vertices.len());

    // Unparseable input is returned verbatim (never throws).
    assert_eq!(exactize_fold_json("not a fold", options()), "not a fold");
}
