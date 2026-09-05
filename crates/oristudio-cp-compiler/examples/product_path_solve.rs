//! The product's region solve, step for step, with its JSON round-trips: the
//! scratch document the frontend loads into the kernel, `export_fold_json`,
//! `exact_solve_input_from_fold` through JSON, and the two stages parsed from
//! the option strings the frontend sends. Exists to tell a solver difference
//! from an input difference when the app and `replay_product_solve` disagree.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler --example product_path_solve -- <file.osf>
use oristudio_cp::io::fold::export_fold_json;
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp_compiler::{
    ExactSolvedGraph, exact_solve_input_from_fold, parse_exact_solve_request,
    solve_exact_with_exemptions,
};
use serde_json::Value;

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
    // No region in the file means the whole pattern is the region.
    let whole = region.is_null();
    let inside =
        |x: f64, y: f64| whole || (x >= cx - hw && x <= cx + hw && y >= cy - hh && y <= cy + hh);

    // `exportOristudioCpCreasesAsFold`: the model with only the owned lines and
    // no aux lines, circles, points or texts; exported the way the session does.
    let mut scratch = model.clone();
    scratch.line_segments = model
        .line_segments
        .iter()
        .filter(|s| inside(s.a.x, s.a.y) && inside(s.b.x, s.b.y))
        .cloned()
        .collect();
    scratch.aux_line_segments.clear();
    scratch.circles.clear();
    scratch.points.clear();
    scratch.texts.clear();
    let fold_json = export_fold_json(&scratch, None).expect("export");

    // `rebuildCpExactSolveInput`: FOLD string -> input -> JSON -> string.
    let fold: treemaker_fold::FoldDocument = serde_json::from_str(&fold_json).expect("fold");
    let (input, _transform) = exact_solve_input_from_fold(&fold).expect("rebuild");
    let mut input_value = serde_json::to_value(&input).expect("json");
    // `JS_ROUNDTRIP=1` does what the page does to the numbers on their way
    // through `JSON.parse` / `JSON.stringify`: every integer becomes a double.
    if std::env::var("JS_ROUNDTRIP").is_ok() {
        round_through_doubles(&mut input_value);
        println!("(integers rounded through JavaScript doubles)");
    }
    if let Ok(out) = std::env::var("FOLD_OUT") {
        std::fs::write(&out, &fold_json).expect("write fold");
        println!("fold written to {out}");
        // `EXPORT_ONLY=1` stops here: the document's pattern as a FOLD, for a
        // curated case that was left as a document because its solve failed.
        if std::env::var("EXPORT_ONLY").is_ok() {
            return;
        }
    }
    let input_json = serde_json::to_string(&input_value).expect("json");
    // `INPUT_OUT=<path>` writes the input the frontend would send, for feeding
    // the same bytes to another solver build.
    if let Ok(out) = std::env::var("INPUT_OUT") {
        std::fs::write(&out, &input_json).expect("write input");
        println!("input written to {out}");
    }
    println!(
        "== {} ==\nowned {} -> {} vertices, {} spans",
        path.rsplit('/').next().unwrap_or(&path),
        scratch.line_segments.len(),
        input.vertices.len(),
        input.selected_spans.len()
    );

    // `stageOptionsJson`: exactly the strings the frontend sends.
    for (label, options_json) in [
        (
            "stage 1 (geometry)",
            r#"{"polish":false,"timeout_seconds":-1}"#,
        ),
        (
            "stage 2 (refinement)",
            r#"{"polish":true,"timeout_seconds":-1}"#,
        ),
    ] {
        let (input, options) =
            parse_exact_solve_request(&input_json, options_json).expect("request");
        let solved = solve_exact_with_exemptions(&input, &options);
        report(label, &solved);
    }
}

fn report(label: &str, solved: &ExactSolvedGraph) {
    let mr = &solved.movement_report;
    let tr = &solved.theorem_residual_report;
    println!("-- {label} --");
    println!(
        "  status {:?}   accepted {}   reasons {}   max_move {}   budget {}",
        solved.status,
        mr["accepted"],
        mr["rejection_reasons"],
        mr["max_vertex_movement"],
        mr["max_vertex_movement_budget"]
    );
    let pleats = &mr["polish"]["pleat_runs"];
    if !pleats.is_null() {
        println!(
            "  pleats: {} ties {} spread {} -> {} refusals {}",
            pleats["stop_reason"],
            pleats["ties"],
            pleats["spread_before"],
            pleats["spread_after"],
            pleats["refusals"]
        );
        for run in pleats["runs"].as_array().into_iter().flatten() {
            let px = |gaps: &Value| {
                gaps.as_array()
                    .map(|gaps| {
                        gaps.iter()
                            .filter_map(Value::as_f64)
                            .map(|gap| format!("{:.2}", gap * 1024.0))
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .unwrap_or_default()
            };
            println!(
                "    {}° x{}: before [{}] after [{}]",
                run["family_degrees"],
                run["creases"],
                px(&run["gaps_before"]),
                px(&run["gaps_after"])
            );
        }
    }
    for phase in ["before", "after", "candidate_after"] {
        let a = &tr[phase];
        println!(
            "  {phase}: kawasaki {} odd {} crossings {} degenerate {} boundary {} camv {} blb {}",
            a["max_kawasaki_residual_degrees"],
            a["odd_degree_vertices"].as_array().map_or(0, |v| v.len()),
            a["unmodeled_crossings"].as_array().map_or(0, |v| v.len()),
            a["degenerate_edges"].as_array().map_or(0, |v| v.len()),
            a["boundary_failures"].as_array().map_or(0, |v| v.len()),
            a["camv_angle_violations"],
            a["big_little_big_violations"]
        );
    }
}

fn round_through_doubles(value: &mut Value) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(round_through_doubles),
        Value::Object(map) => map.values_mut().for_each(round_through_doubles),
        Value::Number(number) => {
            if let Some(int) = number.as_u64()
                && int > (1u64 << 53)
            {
                *value = Value::from((int as f64) as u64);
            }
        }
        _ => {}
    }
}
