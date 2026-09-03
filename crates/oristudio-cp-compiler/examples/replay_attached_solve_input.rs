//! Replay the `ExactSolveInput` attached to a suppression region, with the
//! options the product's region solve uses.
//!
//! The point is to answer "why did *my* pattern refuse to solve" from a saved
//! `.osf` without a browser. Pull the attachment out of the file first — it is
//! `workspace.creasePattern.creasePattern.suppressionRegions[n].solveInput` —
//! and hand the JSON to this. It prints the topology analysis, the solver's
//! status and rejection reasons, and the movement report, which between them
//! separate the four things that look identical from the chip: a structurally
//! unfoldable graph, a movement budget refusal, a timeout, and a preflight
//! rejection that never reached the optimizer at all.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler \
//!     --example replay_attached_solve_input -- <solveinput.json>

use oristudio_cp_compiler::{
    ExactSolveInput, ExactSolveOptions, ExactSolvedGraph, analyze_candidate_topology, solve_exact,
};

/// The theorem report's headline numbers, without the per-vertex array.
fn theorem_summary(report: &serde_json::Value) -> String {
    if !report.is_object() {
        return "none".to_owned();
    }
    let count = |key: &str| report[key].as_array().map(|a| a.len()).unwrap_or(0);
    format!(
        "kawasaki {} deg, carrier {}, movement max {} mean {}, odd-degree {}, maekawa {}, degenerate {}, crossings {}, boundary failures {}",
        report["max_kawasaki_residual_degrees"],
        report["max_carrier_residual"],
        report["max_vertex_movement"],
        report["mean_vertex_movement"],
        count("odd_degree_vertices"),
        count("maekawa_failures"),
        count("degenerate_edges"),
        count("unmodeled_crossings"),
        count("boundary_failures"),
    )
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).expect("usage: <solveinput.json>");
    let bytes = std::fs::read(&path)?;
    let input: ExactSolveInput = serde_json::from_slice(&bytes)?;

    println!("== input ==");
    println!("vertices: {}", input.vertices.len());
    println!("selected_spans: {}", input.selected_spans.len());
    println!("coordinate_space: {:?}", input.coordinate_space);

    let topo = analyze_candidate_topology(&input);
    println!("\n== analyze_candidate_topology ==");
    println!("blockers: {:?}", topo.blockers);
    println!(
        "odd_degree_vertices ({}): {:?}",
        topo.combinatorial.odd_degree_vertices.len(),
        topo.combinatorial.odd_degree_vertices
    );
    println!(
        "degree_two_vertices ({}): {:?}",
        topo.combinatorial.degree_two_vertices.len(),
        topo.combinatorial.degree_two_vertices
    );
    println!(
        "maekawa_failures ({}): {:?}",
        topo.combinatorial.maekawa_failures.len(),
        topo.combinatorial.maekawa_failures
    );
    println!(
        "degenerate_edges ({}): {:?}",
        topo.combinatorial.degenerate_edges.len(),
        topo.combinatorial.degenerate_edges
    );
    println!(
        "unmodeled_crossings ({}): {:?}",
        topo.combinatorial.unmodeled_crossings.len(),
        topo.combinatorial.unmodeled_crossings
    );
    println!(
        "boundary_failures ({}): {:?}",
        topo.combinatorial.boundary_failures.len(),
        topo.combinatorial.boundary_failures
    );
    println!(
        "max_kawasaki_deg: {:.6e}  max_carrier: {:.6e}",
        topo.angle_dependent.max_kawasaki_residual_degrees,
        topo.angle_dependent.max_carrier_residual
    );
    let interior = topo.vertices.len();
    println!("interior fold vertices analysed: {interior}");

    // Stage 1: exactly what `stageOptionsJson(options, 25, false)` produces —
    // solver defaults, `polish: false`, `timeout_seconds: 25`.
    let stage1 = ExactSolveOptions {
        polish: false,
        timeout_seconds: 25.0,
        ..ExactSolveOptions::default()
    };
    println!("\n== stage 1 (geometry; polish=false, timeout=25) ==");
    let started = std::time::Instant::now();
    let solved1 = solve_exact(&input, stage1);
    let elapsed1 = started.elapsed().as_secs_f64();
    report(&solved1, elapsed1);

    // Stage 2: `polish: true`, budget = 25 - stage-1 spend.
    let remaining = (25.0 - elapsed1).max(0.0);
    let stage2 = ExactSolveOptions {
        polish: true,
        timeout_seconds: remaining,
        ..ExactSolveOptions::default()
    };
    println!("\n== stage 2 (refinement; polish=true, timeout={remaining:.3}) ==");
    let started = std::time::Instant::now();
    let solved2 = solve_exact(&input, stage2);
    report(&solved2, started.elapsed().as_secs_f64());

    // Counterfactual: is the movement budget the *cause* or a symptom? Re-run
    // with the budget effectively removed and see whether the answer is exact.
    for budget in [0.05_f64, 0.2, 1.0] {
        let opts = ExactSolveOptions {
            polish: true,
            timeout_seconds: 60.0,
            max_vertex_movement: budget,
            ..ExactSolveOptions::default()
        };
        println!("\n== counterfactual: max_vertex_movement = {budget} ==");
        let started = std::time::Instant::now();
        let solved = solve_exact(&input, opts);
        let wall = started.elapsed().as_secs_f64();
        let mr = &solved.movement_report;
        println!(
            "status {:?}  accepted {}  reasons {}  max_move {}  kawasaki_after {}  wall {wall:.2}s",
            solved.status,
            mr["accepted"],
            mr["rejection_reasons"],
            mr["max_vertex_movement"],
            solved.theorem_residual_report["after"]["max_kawasaki_residual_degrees"],
        );
    }

    Ok(())
}

fn report(solved: &ExactSolvedGraph, wall: f64) {
    let mr = &solved.movement_report;
    let tr = &solved.theorem_residual_report;
    println!("status: {:?}   wall: {wall:.3}s", solved.status);
    println!("accepted: {}", mr["accepted"]);
    println!("rejection_reasons: {}", mr["rejection_reasons"]);
    println!("termination: {}", mr["termination"]);
    println!("timed_out: {}", mr["timed_out"]);
    println!("elapsed_seconds: {}", mr["elapsed_seconds"]);
    println!("evaluations: {}", mr["evaluations"]);
    println!(
        "objective initial/final/candidate: {} / {} / {}",
        mr["initial_objective"], mr["final_objective"], mr["candidate_objective"]
    );
    println!(
        "max_vertex_movement: {}   attempted_max: {}   budget: {}",
        mr["max_vertex_movement"],
        mr["attempted_max_vertex_movement"],
        mr["max_vertex_movement_budget"]
    );
    println!(
        "moved_vertices: {}   attempted_moved_vertices: {}",
        mr["moved_vertices"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0),
        mr["attempted_moved_vertices"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0)
    );
    println!("polish: {}", mr["polish"]);
    // Summarised, not dumped. `vertex_diagnostics` is one object per interior
    // vertex and buries every line above it in a terminal.
    for phase in ["before", "after", "candidate"] {
        println!("theorem {phase}: {}", theorem_summary(&tr[phase]));
    }
    // The three largest attempted movements, to see what the budget tripped on.
    if let Some(attempted) = mr["attempted_moved_vertices"].as_array() {
        let mut rows: Vec<_> = attempted.iter().collect();
        rows.sort_by(|a, b| {
            b["movement"]
                .as_f64()
                .unwrap_or(0.0)
                .total_cmp(&a["movement"].as_f64().unwrap_or(0.0))
        });
        println!("top attempted movements:");
        for row in rows.iter().take(6) {
            println!(
                "  v{} moved {} (policy {}, support {})",
                row["vertex_id"], row["movement"], row["movement_policy"], row["support"]
            );
        }
    }
}
