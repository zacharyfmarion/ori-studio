//! Categorize every remaining foldability failure in a saved `.osf`.
//!
//! Reads the document exactly as the editor holds it, runs the same CAMV
//! checker the canvas draws its markers from, and groups what is left by rule
//! and by vertex — with the degree, the assignment mix and the Kawasaki
//! residual at each site, so a marker can be told apart from a real defect.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler --example categorize_failures -- <file.osf>

use oristudio_cp::checks::{FlatFoldabilityRule, check_camv_task};
use oristudio_cp::model::CreasePatternModel;
use serde_json::Value;
use std::collections::BTreeMap;

fn label_of(colour: &str) -> &str {
    match colour {
        "Black0" => "edge",
        "Red1" => "MOUNTAIN",
        "Blue2" => "valley",
        "Cyan3" => "aux",
        other => other,
    }
}

fn main() {
    let path = std::env::args().nth(1).expect("usage: <file.osf>");
    let raw = std::fs::read_to_string(&path).expect("read");
    let root: Value = serde_json::from_str(&raw).expect("json");
    let cp = &root["workspace"]["creasePattern"]["creasePattern"];
    let model: CreasePatternModel =
        serde_json::from_value(cp["document"]["crease_pattern"].clone()).expect("model");

    println!("== {} ==", path.rsplit('/').next().unwrap_or(&path));
    let mut by_colour: BTreeMap<String, usize> = BTreeMap::new();
    for segment in &model.line_segments {
        *by_colour.entry(format!("{:?}", segment.color)).or_default() += 1;
    }
    println!("{} creases: {by_colour:?}", model.line_segments.len());
    println!(
        "regions {}   images {}",
        cp["suppressionRegions"].as_array().map_or(0, Vec::len),
        cp["images"].as_array().map_or(0, Vec::len)
    );

    // Vertex degree over folding creases only, exactly as foldability reads it.
    let mut degree: BTreeMap<(i64, i64), (usize, usize, usize)> = BTreeMap::new();
    let key = |x: f64, y: f64| ((x * 1e6).round() as i64, (y * 1e6).round() as i64);
    for segment in &model.line_segments {
        let colour = format!("{:?}", segment.color);
        for point in [segment.a, segment.b] {
            let slot = degree.entry(key(point.x, point.y)).or_insert((0, 0, 0));
            match colour.as_str() {
                "Black0" => slot.2 += 1,
                "Cyan3" => {}
                "Red1" => {
                    slot.0 += 1;
                    slot.1 += 1;
                }
                _ => slot.0 += 1,
            }
        }
    }

    // The structural half, which CAMV does not cover: odd degree, stray
    // degree-2 splits, Maekawa parity, crossings the model does not represent.
    let fold = oristudio_cp::io::fold::export_fold_document(&model, None);
    match oristudio_cp_compiler::exact_solve_input_from_fold(&fold) {
        Err(reason) => println!("\n-- topology: could not rebuild ({reason}) --"),
        Ok((input, _)) => {
            let full = oristudio_cp_compiler::analyze_candidate_topology(&input);
            let a = &full.combinatorial;
            println!("\n-- topology --");
            println!("  blockers            {:?}", full.blockers);
            println!("  odd-degree vertices {:?}", a.odd_degree_vertices);
            println!("  degree-2 vertices   {:?}", a.degree_two_vertices);
            println!("  Maekawa failures    {:?}", a.maekawa_failures);
            println!("  degenerate edges    {}", a.degenerate_edges.len());
            println!("  unmodelled crossings {}", a.unmodeled_crossings.len());
            println!("  boundary failures   {}", a.boundary_failures.len());
        }
    }

    let result = check_camv_task(&model);
    let mut by_rule: BTreeMap<String, Vec<(f64, f64)>> = BTreeMap::new();
    for violation in &result.violations {
        by_rule
            .entry(format!("{:?}", violation.rule))
            .or_default()
            .push((violation.point.x, violation.point.y));
    }
    println!("\n-- CAMV: {} violations --", result.violations.len());
    for (rule, points) in &by_rule {
        println!("  {rule}: {}", points.len());
    }

    println!("\n-- every violation, with the fan that produced it --");
    for violation in &result.violations {
        let (x, y) = (violation.point.x, violation.point.y);
        let (folds, mountains, boundary) = degree.get(&key(x, y)).copied().unwrap_or((0, 0, 0));
        let on_edge = x.abs() >= 199.999 || y.abs() >= 199.999;
        let kind = if matches!(violation.rule, FlatFoldabilityRule::Angles) {
            if folds % 2 == 1 {
                "ODD DEGREE — unsolvable by moving points"
            } else if folds == 2 {
                "DEGREE 2 — collinear pair, should have been dissolved"
            } else {
                "angles — Kawasaki residual"
            }
        } else {
            "assignment / sector ordering"
        };
        println!(
            "\n  ({x:>9.3}, {y:>9.3})  {:<14} deg {folds} (M {mountains}, V {}) boundary {boundary}{}  {kind}",
            format!("{:?}", violation.rule),
            folds.saturating_sub(mountains),
            if on_edge { " ON-EDGE" } else { "" }
        );
        // The fan: every ray leaving this vertex, by bearing, with the sector
        // that follows it. BigLittleBig is a statement about these numbers.
        let mut rays: Vec<(f64, String)> = Vec::new();
        for segment in &model.line_segments {
            for (from, to) in [(segment.a, segment.b), (segment.b, segment.a)] {
                if key(from.x, from.y) != key(x, y) {
                    continue;
                }
                let bearing = (to.y - from.y).atan2(to.x - from.x).to_degrees();
                rays.push(((bearing + 360.0) % 360.0, format!("{:?}", segment.color)));
            }
        }
        rays.sort_by(|a, b| a.0.total_cmp(&b.0));
        for i in 0..rays.len() {
            let next = &rays[(i + 1) % rays.len()];
            let mut sector = next.0 - rays[i].0;
            if sector <= 0.0 {
                sector += 360.0;
            }
            println!(
                "      {:>8.3} deg  {:<7}  -> sector {sector:>8.3} deg -> {}",
                rays[i].0,
                label_of(&rays[i].1),
                label_of(&next.1)
            );
        }
    }
}
