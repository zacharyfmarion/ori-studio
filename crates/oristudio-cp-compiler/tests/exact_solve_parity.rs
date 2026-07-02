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
    ExactSolveInput, ExactSolveOptions, ExactSolvedGraphStatus, solve_exact,
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

fn solve_to_golden(name: &str) -> Golden {
    let input = load_input(name);
    let solved = solve_exact(&input, ExactSolveOptions::default());
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

fn check_fixture(name: &str) {
    let got = solve_to_golden(name);

    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::write(golden_path(name), serde_json::to_vec_pretty(&got).unwrap()).unwrap();
        eprintln!("updated golden for {name}");
        return;
    }

    let path = golden_path(name);
    let bytes = std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "missing golden {} ({e}); run UPDATE_GOLDEN=1",
            path.display()
        )
    });
    let want: Golden = serde_json::from_slice(&bytes).unwrap();

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
            dx <= VERTEX_ABS_TOL && dy <= VERTEX_ABS_TOL,
            "[{name}] vertex {i} moved: got {g:?} want {w:?} (dx {dx}, dy {dy})",
        );
    }
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
