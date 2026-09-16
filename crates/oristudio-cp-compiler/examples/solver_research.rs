//! Isolated solver research: input JSON/FOLD, output directory, options JSON.
//! Does not read truth. Reports the unchanged product checks and wall time.
use oristudio_cp_compiler::{
    ExactSolveInput, analyze_candidate_topology, exact_solve_input_from_fold,
    fold_export::export_exact_solved_to_fold_document, parse_exact_solve_request,
    solve_exact_with_exemptions,
};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Instant};
use treemaker_fold::FoldDocument;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !(3..=4).contains(&args.len()) {
        return Err("usage: solver_research INPUT OUT_DIR OPTIONS_JSON [projection]".into());
    }
    let raw = std::fs::read_to_string(&args[0])?;
    let value: Value = serde_json::from_str(&raw)?;
    let started = Instant::now();
    let (input, transform): (ExactSolveInput, _) = if value.get("selected_spans").is_some() {
        (serde_json::from_value(value)?, None)
    } else {
        let fold: FoldDocument = serde_json::from_value(value)?;
        let (input, transform) = exact_solve_input_from_fold(&fold)?;
        (input, Some(transform))
    };
    let preparation_seconds = started.elapsed().as_secs_f64();
    let topology = analyze_candidate_topology(&input);
    let (parsed, options) = parse_exact_solve_request(&serde_json::to_string(&input)?, &args[2])?;
    let start = Instant::now();
    let solved = if args.get(3).is_some_and(|s| s == "projection") {
        oristudio_cp_compiler::exact_solve::solve_exact_projection(&parsed, &options)
    } else {
        solve_exact_with_exemptions(&parsed, &options)
    };
    let seconds = start.elapsed().as_secs_f64();
    let mut fold = export_exact_solved_to_fold_document(&input, &solved)?;
    if let Some(transform) = transform {
        for coord in &mut fold.vertices_coords {
            let point = transform.invert(oristudio_cp_compiler::Point2::new(coord[0], coord[1]));
            coord[0] = point.x;
            coord[1] = point.y;
        }
    }
    let out = PathBuf::from(&args[1]);
    std::fs::create_dir_all(&out)?;
    std::fs::write(out.join("input.json"), serde_json::to_string(&input)?)?;
    std::fs::write(out.join("solved.fold"), serde_json::to_string(&fold)?)?;
    let report = json!({"seconds": seconds, "preparation_seconds": preparation_seconds,
        "input_transform": transform, "topology": topology, "solved": solved});
    std::fs::write(out.join("result.json"), serde_json::to_string(&report)?)?;
    println!(
        "{}",
        json!({"seconds": seconds, "status": report["solved"]["status"],
        "accepted": report["solved"]["movement_report"]["accepted"]})
    );
    Ok(())
}
