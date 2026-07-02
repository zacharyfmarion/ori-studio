//! Golden regression / parity gate for `solve_exact`.
//!
//! Locks the accepted-solution behavior of exact solve against committed
//! goldens generated from real detector `ExactSolveInput` fixtures (native
//! scraped CPs, right-topology, spanning sizes). This is the guardrail for
//! solver-internals changes (e.g. swapping the dense LM linear solve for a
//! sparse one): the fast set runs in CI and must reproduce the same status,
//! accept decision, Kawasaki residual, and vertex coordinates.
//!
//! Regenerate goldens after an intentional change:
//!   UPDATE_GOLDEN=1 cargo test -p oristudio-cp-compiler --test exact_solve_parity -- --include-ignored

use oristudio_cp_compiler::{
    ExactSolveInput, ExactSolveOptions, ExactSolvedGraphStatus, LinearSolver, solve_exact,
};
use std::path::{Path, PathBuf};

/// Fast right-topology fixtures (each solves well under a second).
const FAST_FIXTURES: &[&str] = &[
    "right_small_fork",
    "right_small_cleaver",
    "right_medium_butterfly",
    "right_medium_bowl",
];

/// Large right-topology fixture (~3s with polish); excluded from the default
/// run so CI stays quick, exercised via `--include-ignored`.
const SLOW_FIXTURES: &[&str] = &["right_large_angel"];

// Effectiveness-critical fields (status, accept) must match EXACTLY. The
// numeric fields tolerate last-few-digit differences so an equivalent solve on
// a different arch / linear-algebra backend still passes, while a real
// regression (different solution) fails.
const KAWASAKI_ABS_TOL_DEG: f64 = 1e-6;
const KAWASAKI_REL_TOL: f64 = 1e-3;
const VERTEX_ABS_TOL: f64 = 1e-6;

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/exact_solve")
}

fn load_input(name: &str) -> ExactSolveInput {
    let path = fixture_dir().join(format!("{name}.json"));
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_slice(&bytes).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Golden {
    status: String,
    accepted: bool,
    max_kawasaki_deg: f64,
    vertices: Vec<[f64; 2]>,
}

fn options_for(solver: LinearSolver) -> ExactSolveOptions {
    ExactSolveOptions {
        linear_solver: solver,
        ..ExactSolveOptions::default()
    }
}

fn solve_to_golden(name: &str, solver: LinearSolver) -> Golden {
    let input = load_input(name);
    let solved = solve_exact(&input, options_for(solver));
    Golden {
        status: format!("{:?}", solved.status),
        accepted: solved.movement_report["accepted"]
            .as_bool()
            .unwrap_or(false),
        max_kawasaki_deg: solved.theorem_residual_report["after"]["max_kawasaki_residual_degrees"]
            .as_f64()
            .unwrap_or(f64::NAN),
        vertices: solved.vertices_exact.iter().map(|p| [p.x, p.y]).collect(),
    }
}

fn golden_path(name: &str) -> PathBuf {
    fixture_dir().join(format!("{name}.golden.json"))
}

fn load_golden(name: &str) -> Golden {
    let path = golden_path(name);
    let bytes = std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "missing golden {} ({e}); run UPDATE_GOLDEN=1",
            path.display()
        )
    });
    serde_json::from_slice(&bytes).unwrap()
}

/// Compare a solve result against a golden. `status`/`accepted` must match
/// exactly (the effectiveness-critical fields); numeric fields use the given
/// tolerances so an equivalent solve on a different backend still passes.
fn compare_to_golden(name: &str, got: &Golden, want: &Golden, vertex_tol: f64) {
    assert_eq!(got.status, want.status, "[{name}] status changed");
    assert_eq!(
        got.accepted, want.accepted,
        "[{name}] accept decision changed"
    );

    let ktol = KAWASAKI_ABS_TOL_DEG + KAWASAKI_REL_TOL * want.max_kawasaki_deg.abs();
    assert!(
        (got.max_kawasaki_deg - want.max_kawasaki_deg).abs() <= ktol,
        "[{name}] max Kawasaki regressed: got {} want {} (tol {ktol})",
        got.max_kawasaki_deg,
        want.max_kawasaki_deg,
    );

    assert_eq!(
        got.vertices.len(),
        want.vertices.len(),
        "[{name}] vertex count changed"
    );
    for (i, (g, w)) in got.vertices.iter().zip(&want.vertices).enumerate() {
        let dx = (g[0] - w[0]).abs();
        let dy = (g[1] - w[1]).abs();
        assert!(
            dx <= vertex_tol && dy <= vertex_tol,
            "[{name}] vertex {i} moved: got {g:?} want {w:?} (dx {dx}, dy {dy})",
        );
    }
}

fn check_fixture(name: &str) {
    let got = solve_to_golden(name, LinearSolver::Dense);

    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::write(golden_path(name), serde_json::to_vec_pretty(&got).unwrap()).unwrap();
        eprintln!("updated golden for {name}");
        return;
    }

    compare_to_golden(name, &got, &load_golden(name), VERTEX_ABS_TOL);
}

#[test]
fn fast_right_topology_fixtures_match_golden() {
    for name in FAST_FIXTURES {
        check_fixture(name);
    }
}

#[test]
#[ignore = "slow (~3s); run with --include-ignored"]
fn slow_right_topology_fixtures_match_golden() {
    for name in SLOW_FIXTURES {
        check_fixture(name);
    }
}

// The sparse LM uses a different damping schedule than the dense crate, so it
// reaches the (unique, prior-regularized) minimum along a different path and
// stops within its own tolerances. Allow a looser vertex agreement than the
// dense self-comparison while still requiring identical status/accept and a
// non-regressed Kawasaki residual.
const SPARSE_VERTEX_TOL: f64 = 1e-4;

fn check_sparse_matches_dense_golden(name: &str) {
    let got = solve_to_golden(name, LinearSolver::Sparse);
    compare_to_golden(name, &got, &load_golden(name), SPARSE_VERTEX_TOL);
}

/// Parity gate: the sparse LM backend must reproduce the dense golden
/// (status, accept, Kawasaki, vertices within tolerance).
#[test]
fn sparse_matches_dense_golden_fast() {
    for name in FAST_FIXTURES {
        check_sparse_matches_dense_golden(name);
    }
}

#[test]
#[ignore = "slow (~seconds); run with --include-ignored"]
fn sparse_matches_dense_golden_slow() {
    for name in SLOW_FIXTURES {
        check_sparse_matches_dense_golden(name);
    }
}

/// Sanity: the right-topology fixtures should all be accepted solves — a guard
/// against a fixture silently degrading to a rejected path.
#[test]
fn right_topology_fixtures_are_accepted() {
    for name in FAST_FIXTURES {
        let input = load_input(name);
        let solved = solve_exact(&input, ExactSolveOptions::default());
        assert!(
            solved.movement_report["accepted"]
                .as_bool()
                .unwrap_or(false),
            "[{name}] expected an accepted solve, got {:?}",
            solved.status,
        );
        assert_ne!(
            solved.status,
            ExactSolvedGraphStatus::Failed,
            "[{name}] failed"
        );
    }
}
