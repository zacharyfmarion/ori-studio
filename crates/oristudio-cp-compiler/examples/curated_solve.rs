//! The solver-only gate of the curated benchmark: a case's repaired
//! `topology.fold` through the product's two stages, compared with its
//! `truth.fold`. No model involved, so it is the cheap check after any
//! compiler change. See `implementation-plans/cp-detect-curated-ground-truth.md`.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler --example curated_solve -- <case dir>
//!
//! Environment:
//!   ROUNDS=n     after stage 2, re-solve from the answer n more times — what
//!                "solve again" does in the editor, where the accepted answer is
//!                written into the document and the next solve starts from it
//!   OPTIONS=json fields merged into every stage's options, e.g.
//!                '{"max_vertex_movement":0.02}'
//!   REEXPORT=1   between rounds, rebuild the FOLD from the answer and derive
//!                the input again, as the editor does: which creases share a
//!                carrier is then read off the solved geometry, not the
//!                detected one
use oristudio_cp_compiler::{
    ExactSolveInput, ExactSolvedGraph, Point2, exact_solve_input_from_fold,
    parse_exact_solve_request, solve_exact_with_exemptions,
};
use serde_json::{Value, json};
use std::path::Path;
use treemaker_fold::FoldDocument;

const PX: f64 = 1024.0;

fn main() {
    let case = std::env::args().nth(1).expect("usage: <case dir>");
    let case = Path::new(&case);
    let topology = read_fold(&case.join("topology.fold"));
    let truth = case.join("truth.fold");
    let truth = truth.exists().then(|| read_fold(&truth));
    let rounds: usize = std::env::var("ROUNDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let extra: Value = std::env::var("OPTIONS")
        .ok()
        .map(|v| serde_json::from_str(&v).expect("OPTIONS must be JSON"))
        .unwrap_or(json!({}));

    let (input, xform) = exact_solve_input_from_fold(&topology).expect("rebuild");
    let truth_points: Option<Vec<Point2>> = truth.as_ref().map(|fold| {
        fold.vertices_coords
            .iter()
            .map(|v| xform.apply(Point2::new(v[0], v[1])))
            .collect()
    });
    println!(
        "== {} == {} vertices, {} spans",
        case.file_name().and_then(|n| n.to_str()).unwrap_or("?"),
        input.vertices.len(),
        input.selected_spans.len()
    );
    if let Some(truth) = &truth_points {
        let start: Vec<Point2> = input.vertices.iter().map(|v| v.point).collect();
        println!(
            "  truth sits {} from the repaired topology",
            distance_summary(&start, truth)
        );
    }

    let stage = |label: &str, input: &ExactSolveInput, polish: bool| -> ExactSolvedGraph {
        let mut options = json!({ "polish": polish, "timeout_seconds": -1 });
        if let (Some(target), Some(extra)) = (options.as_object_mut(), extra.as_object()) {
            for (key, value) in extra {
                target.insert(key.clone(), value.clone());
            }
        }
        let input_json = serde_json::to_string(input).expect("json");
        let (parsed, options) =
            parse_exact_solve_request(&input_json, &options.to_string()).expect("request");
        let solved = solve_exact_with_exemptions(&parsed, &options);
        report(label, &solved, truth_points.as_deref());
        solved
    };

    stage("stage 1 (geometry)", &input, false);
    let mut solved = stage("stage 2 (refinement)", &input, true);
    let reexport = std::env::var("REEXPORT").is_ok();
    let mut current = input;
    for round in 1..=rounds {
        if solved.movement_report["accepted"] != Value::Bool(true) {
            println!("  (round {round} not run: the previous answer was not accepted)");
            break;
        }
        if reexport {
            let mut fold = topology.clone();
            for (coord, point) in fold.vertices_coords.iter_mut().zip(&solved.vertices_exact) {
                let p = xform.invert(*point);
                coord[0] = p.x;
                coord[1] = p.y;
            }
            let (next, _) = exact_solve_input_from_fold(&fold).expect("rebuild");
            let carriers = |input: &ExactSolveInput| {
                input
                    .selected_spans
                    .iter()
                    .flat_map(|span| span.source_carrier_ids.iter().copied())
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
            };
            println!(
                "  (re-exported: {} carriers, was {})",
                carriers(&next),
                carriers(&current)
            );
            current = next;
        } else {
            for (vertex, point) in current.vertices.iter_mut().zip(&solved.vertices_exact) {
                vertex.point = *point;
            }
        }
        solved = stage(&format!("solve again #{round}"), &current, true);
    }
}

fn read_fold(path: &Path) -> FoldDocument {
    let raw =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

fn report(label: &str, solved: &ExactSolvedGraph, truth: Option<&[Point2]>) {
    let mr = &solved.movement_report;
    let tr = &solved.theorem_residual_report;
    let polish = &mr["polish"];
    println!("-- {label} --");
    println!(
        "  status {:?}  accepted {}  reasons {}  max move {} (attempted {}) of budget {}",
        solved.status,
        mr["accepted"],
        mr["rejection_reasons"],
        px(&mr["max_vertex_movement"]),
        px(&mr["attempted_max_vertex_movement"]),
        px(&mr["max_vertex_movement_budget"])
    );
    for phase in ["before", "after", "candidate_after"] {
        let a = &tr[phase];
        println!(
            "  {phase:15} kawasaki {:>14} camv {} blb {} crossings {} degenerate {}",
            a["max_kawasaki_residual_degrees"],
            a["camv_angle_violations"],
            a["big_little_big_violations"],
            a["unmodeled_crossings"].as_array().map_or(0, |v| v.len()),
            a["degenerate_edges"].as_array().map_or(0, |v| v.len())
        );
    }
    if !polish.is_null() {
        println!(
            "  polish {} rounds {}  refused {}  pinned {} ({}°)  symmetry {}  pleats {}",
            polish["stop_reason"],
            polish["rounds_adopted"],
            polish["refused_round"]["rejection_reasons"],
            polish["pinned_family"]["adopted"],
            polish["pinned_family"]["step_degrees"],
            polish["symmetry_round"]["adopted"],
            polish["pleat_runs"]["adopted"]
        );
    }
    let join = &mr["carrier_join"];
    if !join.is_null() {
        let rounds: Vec<String> = join["rounds"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|round| {
                format!(
                    "{}→{} {} {}",
                    round["carriers_before"],
                    round["carriers_after"],
                    if round["adopted"] == Value::Bool(true) {
                        "adopted"
                    } else {
                        "refused"
                    },
                    round["refusals"]
                )
            })
            .collect();
        println!(
            "  carriers: {}",
            if rounds.is_empty() {
                "no join found".to_owned()
            } else {
                rounds.join("; ")
            }
        );
    }
    if let Some(truth) = truth {
        println!(
            "  answer sits {} from truth",
            distance_summary(&solved.vertices_exact, truth)
        );
    }
}

fn px(value: &Value) -> String {
    value
        .as_f64()
        .map_or_else(|| value.to_string(), |v| format!("{:.2}px", v * PX))
}

/// How far the answer sits from the truth: for every truth vertex, the nearest
/// answer vertex. Matched by geometry rather than index because a solve merges
/// detector-split junctions, so the answer can have fewer vertices than the
/// topology it started from, and the truth exported after that solve has fewer
/// still.
fn distance_summary(points: &[Point2], truth: &[Point2]) -> String {
    if points.is_empty() || truth.is_empty() {
        return format!("? ({} vs {} vertices)", points.len(), truth.len());
    }
    let mut d: Vec<f64> = truth
        .iter()
        .map(|t| {
            points
                .iter()
                .map(|p| ((p.x - t.x).powi(2) + (p.y - t.y).powi(2)).sqrt() * PX)
                .fold(f64::INFINITY, f64::min)
        })
        .collect();
    d.sort_by(|a, b| a.total_cmp(b));
    let n = d.len();
    format!(
        "max {:.2}px  p90 {:.2}px  median {:.2}px  over 1px {} of {}",
        d[n - 1],
        d[n * 9 / 10],
        d[n / 2],
        d.iter().filter(|&&x| x > 1.0).count(),
        n
    )
}
