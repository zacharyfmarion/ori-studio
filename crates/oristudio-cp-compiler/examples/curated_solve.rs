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
//!   ANSWER_OUT=f write the final answer as a FOLD in the case's own frame, to
//!                compare with the truth by correspondence rather than distance
//!   REPORT_OUT=f write the final stage's reports as JSON, to diff against
//!                another build's
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
    if let Ok(path) = std::env::var("REPORT_OUT") {
        let report = json!({
            "status": format!("{:?}", solved.status),
            "movement_report": solved.movement_report,
            "theorem_residual_report": solved.theorem_residual_report,
        });
        std::fs::write(&path, serde_json::to_string_pretty(&report).expect("json"))
            .expect("write report");
        println!("  report written to {path}");
    }
    if let Ok(path) = std::env::var("ANSWER_OUT") {
        let mut fold = topology.clone();
        for (coord, point) in fold.vertices_coords.iter_mut().zip(&solved.vertices_exact) {
            let p = xform.invert(*point);
            coord[0] = p.x;
            coord[1] = p.y;
        }
        std::fs::write(&path, serde_json::to_string(&fold).expect("json")).expect("write answer");
        println!("  answer written to {path}");
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
    let merges = solved.merged_vertices.len();
    let collapsed = polish["pinned_family"]["attempts"]
        .as_array()
        .map(|attempts| {
            attempts
                .iter()
                .filter_map(|attempt| attempt["collapsed_edges"].as_array().map(Vec::len))
                .max()
                .unwrap_or(0)
        })
        .unwrap_or(0);
    if merges > 0 || collapsed > 0 {
        println!(
            "  merges: {merges} vertex pairs made one (pin collapsed up to {collapsed} edges in an attempt)"
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
                    "{}→{} {} {} (join moved {})",
                    round["carriers_before"],
                    round["carriers_after"],
                    if round["adopted"] == Value::Bool(true) {
                        "adopted"
                    } else {
                        "refused"
                    },
                    round["refusals"],
                    px(&round["join_movement"])
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

/// How far the answer sits from the truth, vertex to vertex.
///
/// Correspondence, not nearest distance: each truth vertex is paired with the
/// answer vertex that is its mutual nearest neighbour within a generous
/// radius, and only paired vertices are measured. A hand-corrected truth can
/// carry split points on creases and the endpoints of aux lines, which have no
/// counterpart in the answer at all; measured by nearest distance they read
/// as tens of pixels of error where the solve was within five. The unpaired
/// count is reported separately.
fn distance_summary(points: &[Point2], truth: &[Point2]) -> String {
    if points.is_empty() || truth.is_empty() {
        return format!("? ({} vs {} vertices)", points.len(), truth.len());
    }
    let nearest = |p: Point2, set: &[Point2]| {
        set.iter()
            .enumerate()
            .map(|(k, q)| (k, ((p.x - q.x).powi(2) + (p.y - q.y).powi(2)).sqrt()))
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(k, _)| k)
            .unwrap_or(0)
    };
    let radius = 40.0 / 400.0;
    let mut d: Vec<f64> = Vec::new();
    let mut unpaired = 0usize;
    for (j, t) in truth.iter().enumerate() {
        let i = nearest(*t, points);
        let back = nearest(points[i], truth);
        let dist = ((points[i].x - t.x).powi(2) + (points[i].y - t.y).powi(2)).sqrt();
        if back == j && dist <= radius {
            d.push(dist * PX);
        } else {
            unpaired += 1;
        }
    }
    if d.is_empty() {
        return format!("no vertex correspondence ({} truth vertices)", truth.len());
    }
    d.sort_by(|a, b| a.total_cmp(b));
    let n = d.len();
    format!(
        "max {:.2}px  p90 {:.2}px  median {:.2}px  over 1px {} of {} paired; {} truth vertices unpaired",
        d[n - 1],
        d[n * 9 / 10],
        d[n / 2],
        d.iter().filter(|&&x| x > 1.0).count(),
        n,
        unpaired
    )
}
