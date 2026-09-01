//! Run a region's solve exactly the way the product does: rebuild the input from
//! the live document, then two stages on one 25s budget — geometry without
//! polish, then refinement with it.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler --example replay_product_solve -- <file.osf>

use oristudio_cp::io::fold::export_fold_document;
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp_compiler::{
    ExactSolveOptions, ExactSolvedGraph, analyze_candidate_topology, exact_solve_input_from_fold,
    solve_exact,
};
use serde_json::Value;
use std::time::Instant;

const BUDGET: f64 = 25.0;

fn main() {
    let path = std::env::args().nth(1).expect("usage: <file.osf>");
    let raw = std::fs::read_to_string(&path).expect("read");
    let root: Value = serde_json::from_str(&raw).expect("json");
    let cp = &root["workspace"]["creasePattern"]["creasePattern"];
    let model: CreasePatternModel =
        serde_json::from_value(cp["document"]["crease_pattern"].clone()).expect("model");
    let region = &cp["suppressionRegions"][0];
    let (cx, cy) = (
        region["center"]["x"].as_f64().unwrap_or(0.0),
        region["center"]["y"].as_f64().unwrap_or(0.0),
    );
    let hw = region["width"].as_f64().unwrap_or(0.0) / 2.0;
    let hh = region["height"].as_f64().unwrap_or(0.0) / 2.0;
    let inside = |x: f64, y: f64| x >= cx - hw && x <= cx + hw && y >= cy - hh && y <= cy + hh;

    let mut owned = model.clone();
    owned.line_segments = model
        .line_segments
        .iter()
        .filter(|s| inside(s.a.x, s.a.y) && inside(s.b.x, s.b.y))
        .cloned()
        .collect();
    let fold = export_fold_document(&owned, None);
    let (input, _) = exact_solve_input_from_fold(&fold).expect("rebuild");

    println!("== {} ==", path.rsplit('/').next().unwrap_or(&path));
    println!(
        "{} owned creases -> {} vertices, {} spans",
        owned.line_segments.len(),
        input.vertices.len(),
        input.selected_spans.len()
    );
    let topology = analyze_candidate_topology(&input);
    println!(
        "topology: blockers {:?} odd {:?} maekawa {:?}",
        topology.blockers,
        topology.combinatorial.odd_degree_vertices,
        topology.combinatorial.maekawa_failures
    );

    // The same two stages on the ATTACHMENT — the input a build that had not
    // yet learned to rebuild would have solved instead.
    if let Ok(attached) = serde_json::from_value::<oristudio_cp_compiler::ExactSolveInput>(
        region["solveInput"].clone(),
    ) {
        let t = analyze_candidate_topology(&attached);
        println!(
            "\n########## ATTACHMENT ({} vertices, {} spans) ##########",
            attached.vertices.len(),
            attached.selected_spans.len()
        );
        println!(
            "topology: blockers {:?} odd {:?} maekawa {:?}",
            t.blockers, t.combinatorial.odd_degree_vertices, t.combinatorial.maekawa_failures
        );
        let a1 = Instant::now();
        let s1 = solve_exact(
            &attached,
            ExactSolveOptions {
                polish: false,
                timeout_seconds: BUDGET,
                ..Default::default()
            },
        );
        let e1 = a1.elapsed().as_secs_f64();
        report("attachment stage 1", &s1, e1);
        let a2 = Instant::now();
        let s2 = solve_exact(
            &attached,
            ExactSolveOptions {
                polish: true,
                timeout_seconds: (BUDGET - e1).max(0.0),
                ..Default::default()
            },
        );
        report("attachment stage 2", &s2, a2.elapsed().as_secs_f64());
        println!("\n########## DOCUMENT ##########");
    }

    let started = Instant::now();
    let stage1 = solve_exact(
        &input,
        ExactSolveOptions {
            polish: false,
            timeout_seconds: BUDGET,
            ..Default::default()
        },
    );
    let stage1_secs = started.elapsed().as_secs_f64();
    report("stage 1 (geometry, no polish)", &stage1, stage1_secs);

    let remaining = (BUDGET - stage1_secs).max(0.0);
    println!("\nbudget left for stage 2: {remaining:.3}s");
    let started2 = Instant::now();
    let stage2 = solve_exact(
        &input,
        ExactSolveOptions {
            polish: true,
            timeout_seconds: remaining,
            ..Default::default()
        },
    );
    report(
        "stage 2 (refinement, polish)",
        &stage2,
        started2.elapsed().as_secs_f64(),
    );
}

fn report(label: &str, solved: &ExactSolvedGraph, wall: f64) {
    let mr = &solved.movement_report;
    let tr = &solved.theorem_residual_report;
    println!("\n-- {label} --");
    println!("  status {:?}   wall {wall:.3}s", solved.status);
    println!(
        "  accepted {}   timed_out {}   termination {}   evaluations {}",
        mr["accepted"], mr["timed_out"], mr["termination"], mr["evaluations"]
    );
    println!("  rejection_reasons {}", mr["rejection_reasons"]);
    println!(
        "  max_vertex_movement {}   budget {}",
        mr["max_vertex_movement"], mr["max_vertex_movement_budget"]
    );
    println!("  polish {}", mr["polish"]);
    for phase in ["before", "after"] {
        println!(
            "  {phase}: kawasaki {} deg, carrier {}, odd-degree {}, maekawa {}",
            tr[phase]["max_kawasaki_residual_degrees"],
            tr[phase]["max_carrier_residual"],
            tr[phase]["odd_degree_vertices"],
            tr[phase]["maekawa_failures"]
        );
    }
}
