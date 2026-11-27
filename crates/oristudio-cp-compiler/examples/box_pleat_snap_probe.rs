//! What snapping a box-pleated detection to its grid does to the product
//! solve, four ways, on one recognized input. Never reads truth.
//!
//!   box_pleat_snap_probe INPUT_JSON OUT_DIR [SECONDS]
//!
//! - `base`: the product's solve as it runs today.
//! - `snap_then_solve`: snap the detection, then solve holding the snapped
//!   grid points where they are.
//! - `solve_then_snap`: snap the base answer and only judge it (every vertex
//!   held), the way a snap applied to what is added would have to be checked.
//! - `solve_snap_solve`: snap the base answer, then solve again holding its
//!   grid points, so the rest re-equilibrates around them.
//!
//! Writes `<way>.fold` for each and prints one JSON line.
use oristudio_cp_compiler::candidate_graph::CandidateVertexMovementPolicy;
use oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document;
use oristudio_cp_compiler::{
    ConstructionRecoveryMode, ExactSolveInput, ExactSolveOptions, ExactSolveOptionsWithExemptions,
    ExactSolvedGraph, GridSnapMode, read_box_pleat_grid, snap_to_box_pleat_grid,
    solve_exact_with_exemptions,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let [input_path, out, ..] = args.as_slice() else {
        return Err("usage: box_pleat_snap_probe INPUT_JSON OUT_DIR [SECONDS]".into());
    };
    let seconds: f64 = args.get(2).map_or(Ok(25.0), |value| value.parse())?;
    let input: ExactSolveInput = serde_json::from_str(&std::fs::read_to_string(input_path)?)?;
    let Some(grid) = read_box_pleat_grid(&input) else {
        println!("{}", json!({"input": input_path, "grid": null}));
        return Ok(());
    };
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out)?;
    let options = ExactSolveOptions {
        recognition_fallback: true,
        construction_recovery: ConstructionRecoveryMode::Constructions,
        polish: true,
        timeout_seconds: seconds,
        ..Default::default()
    };
    let solve = |input: &ExactSolveInput, pinned: BTreeSet<usize>| {
        let started = Instant::now();
        let solved = solve_exact_with_exemptions(
            input,
            &ExactSolveOptionsWithExemptions {
                options,
                exempt_vertex_ids: BTreeSet::new(),
                pinned_vertex_ids: pinned,
            },
        );
        (solved, started.elapsed().as_secs_f64())
    };
    let summary = |solved: &ExactSolvedGraph, seconds: f64| {
        json!({
            "status": solved.status,
            "accepted": solved.movement_report["accepted"],
            "reasons": solved.movement_report["rejection_reasons"],
            "seconds": seconds,
            "merged": solved.merged_vertices.len(),
        })
    };
    let mut report = json!({"input": input_path, "grid": grid});

    let (base, base_seconds) = solve(&input, BTreeSet::new());
    write(&out, "base", &input, &base)?;
    report["base"] = summary(&base, base_seconds);

    // The product's option: the solver's own judged round.
    let started = Instant::now();
    let with_option = solve_exact_with_exemptions(
        &input,
        &ExactSolveOptionsWithExemptions::from(ExactSolveOptions {
            grid_snap: GridSnapMode::BoxPleat,
            ..options
        }),
    );
    write(&out, "grid_snap_option", &input, &with_option)?;
    report["grid_snap_option"] = summary(&with_option, started.elapsed().as_secs_f64());
    report["grid_snap_option"]["round"] = with_option.movement_report["grid_snap"].clone();

    let snapped = snap_to_box_pleat_grid(&input, &grid);
    report["snap"] = json!({
        "moved": snapped.moved_vertices.len(),
        "on_grid": snapped.on_grid_vertex_ids.len(),
        "vertices": input.vertices.len(),
    });
    let (first, first_seconds) = solve(
        &snapped.input,
        snapped.on_grid_vertex_ids.iter().copied().collect(),
    );
    write(&out, "snap_then_solve", &snapped.input, &first)?;
    report["snap_then_solve"] = summary(&first, first_seconds);

    // The base answer as an input of its own, the way the solver rejudges a
    // proposal (`judge_original`): its coordinates written in, carriers refit.
    if base.vertices_exact.len() == input.vertices.len() && base.merged_vertices.is_empty() {
        let mut answered = input.clone();
        for (vertex, point) in answered.vertices.iter_mut().zip(&base.vertices_exact) {
            vertex.point = *point;
        }
        let answered = refit(answered);
        let resnapped = snap_to_box_pleat_grid(&answered, &grid);
        let everything = resnapped
            .input
            .vertices
            .iter()
            .filter(|vertex| vertex.movement_policy != CandidateVertexMovementPolicy::Locked)
            .map(|vertex| vertex.id)
            .collect::<BTreeSet<_>>();
        let (judged, judged_seconds) = solve(&resnapped.input, everything);
        write(&out, "solve_then_snap", &resnapped.input, &judged)?;
        report["solve_then_snap"] = summary(&judged, judged_seconds);
        let (again, again_seconds) = solve(
            &resnapped.input,
            resnapped.on_grid_vertex_ids.iter().copied().collect(),
        );
        write(&out, "solve_snap_solve", &resnapped.input, &again)?;
        report["solve_snap_solve"] = summary(&again, again_seconds);
    } else {
        report["solve_then_snap"] = json!({"skipped": "base merged vertices"});
        report["solve_snap_solve"] = json!({"skipped": "base merged vertices"});
    }
    println!("{report}");
    Ok(())
}

/// Every span's carrier through its endpoints, as the solver refits a
/// completed proposal.
fn refit(mut input: ExactSolveInput) -> ExactSolveInput {
    let points = input
        .vertices
        .iter()
        .map(|vertex| vertex.point)
        .collect::<Vec<_>>();
    for span in &mut input.selected_spans {
        let [a, b] = span.vertices.map(|id| points[id]);
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let len = (dx * dx + dy * dy).sqrt().max(1e-12);
        let direction = oristudio_cp_compiler::Point2::new(dx / len, dy / len);
        let mut normal = oristudio_cp_compiler::Point2::new(direction.y, -direction.x);
        let mut rho = normal.x * a.x + normal.y * a.y;
        if rho < 0.0 {
            normal = oristudio_cp_compiler::Point2::new(-normal.x, -normal.y);
            rho = -rho;
        }
        let (ta, tb) = (
            a.x * direction.x + a.y * direction.y,
            b.x * direction.x + b.y * direction.y,
        );
        span.carrier.direction = direction;
        span.carrier.normal = normal;
        span.carrier.rho = rho;
        span.t_interval = [ta.min(tb), ta.max(tb)];
    }
    input
}

fn write(
    out: &std::path::Path,
    way: &str,
    input: &ExactSolveInput,
    solved: &ExactSolvedGraph,
) -> Result<(), Box<dyn std::error::Error>> {
    let fold: Value = serde_json::to_value(export_exact_solved_to_fold_document(input, solved)?)?;
    std::fs::write(
        out.join(format!("{way}.fold")),
        serde_json::to_string(&fold)?,
    )?;
    Ok(())
}
