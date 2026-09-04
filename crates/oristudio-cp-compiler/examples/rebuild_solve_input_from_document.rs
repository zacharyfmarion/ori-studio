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
                if std::env::var("PRINT_TRANSFORM").is_ok() {
                    println!(
                        "   transform json: {}",
                        serde_json::to_string(&xform).unwrap()
                    );
                }
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

    // Which vertices did the solver actually move, and which of those does the
    // movement report tell a caller about?
    let reported: std::collections::BTreeSet<usize> = solved.movement_report["moved_vertices"]
        .as_array()
        .map(|v| {
            v.iter()
                .filter_map(|m| m["vertex_id"].as_u64().map(|n| n as usize))
                .collect()
        })
        .unwrap_or_default();
    let mut actually_moved = Vec::new();
    for (id, vertex) in input.vertices.iter().enumerate() {
        let Some(after) = solved.vertices_exact.get(id) else {
            continue;
        };
        let d = ((after.x - vertex.point.x).powi(2) + (after.y - vertex.point.y).powi(2)).sqrt();
        if d > 1e-10 {
            actually_moved.push((id, d));
        }
    }
    let silent: Vec<usize> = actually_moved
        .iter()
        .map(|(id, _)| *id)
        .filter(|id| !reported.contains(id))
        .collect();
    // Raw degree over fold spans, before any normalisation the solver applies.
    let mut raw_degree = vec![0usize; input.vertices.len()];
    for span in &input.selected_spans {
        if span.assignment_label() == oristudio_cp_compiler::AssignmentLabel::Boundary {
            continue;
        }
        for v in span.vertices {
            if let Some(slot) = raw_degree.get_mut(v) {
                *slot += 1;
            }
        }
    }
    let raw_deg2: Vec<usize> = (0..input.vertices.len())
        .filter(|&i| raw_degree[i] == 2)
        .collect();
    println!(
        "{tag} RAW degree-2 vertices in the input: {} {:?}",
        raw_deg2.len(),
        &raw_deg2.iter().take(12).collect::<Vec<_>>()
    );
    let silent_set: std::collections::BTreeSet<usize> = silent.iter().copied().collect();
    let raw_set: std::collections::BTreeSet<usize> = raw_deg2.iter().copied().collect();
    println!(
        "{tag} silent ∩ raw-degree-2 = {:?}   silent not degree-2 = {:?}",
        silent_set.intersection(&raw_set).collect::<Vec<_>>(),
        silent_set.difference(&raw_set).collect::<Vec<_>>()
    );
    for id in silent.iter().take(6) {
        let v = &input.vertices[*id];
        let a = solved.vertices_exact[*id];
        println!(
            "{tag}   silent v{id}: kind {:?} policy {:?} side {:?}  input ({:.9},{:.9}) -> exact ({:.9},{:.9})  d={:.3e}",
            v.kind,
            v.movement_policy,
            v.boundary_side,
            v.point.x,
            v.point.y,
            a.x,
            a.y,
            ((a.x - v.point.x).powi(2) + (a.y - v.point.y).powi(2)).sqrt()
        );
    }
    println!(
        "{tag} vertices_exact len {} (input {}), moved-in-vertices_exact {}, reported {}, MOVED BUT UNREPORTED {}: {:?}",
        solved.vertices_exact.len(),
        input.vertices.len(),
        actually_moved.len(),
        reported.len(),
        silent.len(),
        &silent.iter().take(12).collect::<Vec<_>>()
    );
    println!(
        "{tag} SOLVE: {:?} accepted={} reasons={:?} maxmove={}",
        solved.status,
        solved.movement_report["accepted"],
        solved.movement_report["rejection_reasons"],
        solved.movement_report["max_vertex_movement"]
    );
}
