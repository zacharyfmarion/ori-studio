//! Rebuild a region's `ExactSolveInput` from the **live document** in an `.osf`,
//! the way the browser will, and report what changes versus the attachment.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler \
//!     --example rebuild_solve_input_from_document -- <file.osf>

use oristudio_cp::io::fold::export_fold_document;
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp_compiler::{
    ExactSolveInput, ExactSolveOptions, analyze_candidate_topology, exact_solve_input_from_fold,
    solve_exact,
};
use serde_json::Value;

fn main() {
    let path = std::env::args().nth(1).expect("usage: <file.osf>");
    let raw = std::fs::read_to_string(&path).expect("read");
    let root: Value = serde_json::from_str(&raw).expect("json");
    let cp = &root["workspace"]["creasePattern"]["creasePattern"];

    let model: CreasePatternModel =
        serde_json::from_value(cp["document"]["crease_pattern"].clone()).expect("model");
    let regions = cp["suppressionRegions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    println!("== {} ==", path.rsplit('/').next().unwrap_or(&path));
    println!("document segments: {}", model.line_segments.len());

    for (n, region) in regions.iter().enumerate() {
        let cx = region["center"]["x"].as_f64().unwrap_or(0.0);
        let cy = region["center"]["y"].as_f64().unwrap_or(0.0);
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
        println!(
            "\n-- region {n} -- owned segments: {}",
            owned.line_segments.len()
        );

        let fold = export_fold_document(&owned, None);
        println!(
            "   FOLD: {} vertices, {} edges",
            fold.vertices_coords.len(),
            fold.edges_vertices.len()
        );

        match exact_solve_input_from_fold(&fold) {
            Err(reason) => println!("   REBUILD REFUSED: {reason}"),
            Ok((input, xform)) => {
                println!(
                    "   rebuilt: {} vertices, {} spans   (side {:.4}, flip {:+.0})",
                    input.vertices.len(),
                    input.selected_spans.len(),
                    xform.side,
                    xform.flip
                );
                report("   rebuilt", &input);
            }
        }

        if let Ok(attached) =
            serde_json::from_value::<ExactSolveInput>(region["solveInput"].clone())
        {
            println!(
                "   attached: {} vertices, {} spans",
                attached.vertices.len(),
                attached.selected_spans.len()
            );
            report("   attached", &attached);
        }
    }
}

fn report(tag: &str, input: &ExactSolveInput) {
    let a = analyze_candidate_topology(input);
    println!(
        "{tag} analysis: blockers {:?} odd {:?} deg2 {:?} maekawa {:?} crossings {} boundary {}",
        a.blockers.len(),
        a.combinatorial.odd_degree_vertices,
        a.combinatorial.degree_two_vertices,
        a.combinatorial.maekawa_failures,
        a.combinatorial.unmodeled_crossings.len(),
        a.combinatorial.boundary_failures.len()
    );
    if !a.blockers.is_empty() {
        println!("{tag} blocker detail: {:?}", a.blockers);
        return;
    }
    let solved = solve_exact(input, ExactSolveOptions::default());
    println!(
        "{tag} SOLVE: {:?} accepted={} reasons={:?} maxmove={}",
        solved.status,
        solved.movement_report["accepted"],
        solved.movement_report["rejection_reasons"],
        solved.movement_report["max_vertex_movement"]
    );
}
