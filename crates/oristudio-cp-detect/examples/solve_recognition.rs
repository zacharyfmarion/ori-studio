//! Replay a recognized input through the product solver. Never reads truth.
//! solve_recognition INPUT_JSON OUT_DIR SECONDS [lattice-only]
use oristudio_cp_compiler::{
    ExactSolveInput, ExactSolveOptions, solve_exact, solve_exact_on_lattice,
};
use std::{path::PathBuf, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 3 {
        return Err("usage: solve_recognition INPUT_JSON OUT_DIR SECONDS [lattice-only]".into());
    }
    let raw = std::fs::read_to_string(&args[0])?;
    let input: ExactSolveInput = serde_json::from_str(&raw)?;
    let auxiliary = oristudio_cp_detect::auxiliary::segments_from_solve_request(&raw)?;
    let out = PathBuf::from(&args[1]);
    std::fs::create_dir_all(&out)?;
    let options = ExactSolveOptions {
        timeout_seconds: args[2].parse()?,
        polish: true,
        ..Default::default()
    };
    let start = Instant::now();
    let solved = if args.get(3).is_some_and(|v| v == "lattice-only") {
        solve_exact_on_lattice(&input, options)
    } else {
        solve_exact(&input, options)
    };
    let seconds = start.elapsed().as_secs_f64();
    let fold =
        oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document(&input, &solved)?;
    let fold = oristudio_cp_detect::auxiliary::append_auxiliary(
        &serde_json::to_string(&fold)?,
        &auxiliary,
    )?;
    std::fs::write(out.join("solved.fold"), fold)?;
    let report = serde_json::json!({"seconds": seconds, "solved": solved});
    std::fs::write(out.join("result.json"), serde_json::to_string(&report)?)?;
    println!(
        "{}",
        serde_json::json!({"seconds": seconds, "status": report["solved"]["status"],
        "accepted": report["solved"]["movement_report"]["accepted"]})
    );
    Ok(())
}
